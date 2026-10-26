'use strict';
// 战线（v7）：30 米粗网格上的兵力影响场 → 控制场 → 从海面连通的登陆场 → 每 30 米一列的双方前沿、无人地带、空隙、侧翼、孤立分队、进攻地段
// 两个视角各每秒重建一次（错开 .5 秒）：'p' 进攻方所知、'e' 守方所知；两个视角里 fp 都是进攻方前沿、fe 都是守方前沿
// 类型数组只放在 FRC（不进 S），S.front 为纯 JSON；画面上只有线、齿、淡影与虚圈，不写字
const FR_G = 30, FR_NX = 100, FR_NY = 67, FR_N = FR_NX * FR_NY, FR_RS = [100, 120, 150, 170, 180];
const FR_RC = { 100: 0, 120: 1, 150: 2, 170: 3, 180: 4 };
const FR_ROLEW = { rifle: 1, mg: 1.6, radio: .7, eng: .5, aa: .8 };
const FR_VPOW = { lt_tank: 5, tank: 8, hv_tank: 11, amtank: 5, apc: 3, spg: 4, td: 7, aa_veh: 3, sam_veh: 3, recon: 2, flame_tank: 7, mine_tank: 6 };
const FR_SPOW = { bunker: 6, coastal: 3, arty: 2, mortar: 1.5, aa: 1, tel: .5, ascm: .5, airfield: 0 };
const frOn = () => !!S && !(S.v7off && S.v7off.front);
const frStat = (k, n = 1) => { const o = S.v7s || (S.v7s = {}); o[k] = (o[k] || 0) + n; };
const frCell = (x, y) => clamp(Math.floor(y / FR_G), 0, FR_NY - 1) * FR_NX + clamp(Math.floor(x / FR_G), 0, FR_NX - 1);
const frBand = x => clamp(Math.floor(x / FR_G), 0, FR_NX - 1);
const frBX = b => (b + .5) * FR_G;

// —— 兵力（人当量）：F、G、H、I 共用 ——
function frPowTeam(q) {
  if (!q || !q.men || !q.men.length) return 0;
  let s = 0; for (const m of q.men) s += FR_ROLEW[m] || 1;
  const u = typeof unitOf === 'function' ? unitOf(q) : null, mo = clamp(u && u.morale != null ? u.morale : 60, 0, 100);
  const amm = q.side === 'e' ? 1 : clamp(.35 + (q.ammo != null ? q.ammo : 60) / 40, .35, 1);
  return s * ((q.mod && q.mod.pow) || 1) * (.5 + mo / 160) * amm * (1 - .4 * clamp(q.sup || 0, 0, 100) / 100) * (u && u.state === 'rout' ? .2 : 1);
}
function frPowVeh(v) {
  if (!v || v.dead || v.lst) return 0;
  const sp = typeof VEH_SPEC === 'object' ? VEH_SPEC[v.type] : null, g = sp && sp.gun;
  return (FR_VPOW[v.type] || 4) * clamp(v.hp / (v.maxhp || 1), 0, 1) * (v.immob ? .6 : 1) * (g && !g.flame && v.ammo <= 0 ? .3 : 1);
}
// own = 守方自己的真值视角：假目标不算兵力（进攻方看来它就是碉堡）
function frPowStruct(e, own) { if (!e || e.dead || (own && e.decoy)) return 0; const k = FR_SPOW[e.kind]; return (k != null ? k : .5) * clamp(e.hp / (e.maxhp || 1), 0, 1); }
function frPowCar(a) { return !a || a.dead ? 0 : 4 * clamp(a.hp / (a.maxhp || 1), 0, 1); }

// 枚举 persp 视角已知的兵力源：fn(side, x, y, w, R, age, kind)；己方取真值，对方按情报（此刻可见 / 记忆按龄衰减 / 已标定）
function frEach(persp, fn) {
  const t = S.t, P = persp === 'p', SEEN = P ? PV : EV;
  for (const q of S.teams) {
    if (!q.men.length || q.ride) continue;
    if (q.side === persp || SEEN[ci(q.x, q.y)]) { fn(q.side, q.x, q.y, frPowTeam(q), 150, 0, 'team'); continue; }
    const s = P ? q.seen : q.es;
    if (s != null && t - s < 90) { const a = t - s; fn(q.side, P ? q.sx : q.ex, P ? q.sy : q.ey, frPowTeam(q) * (1 - a / 90), 150, a, 'team'); }
  }
  for (const v of S.veh || []) {
    if (v.dead || v.lst) continue;
    if (v.side === persp) fn(v.side, v.x, v.y, frPowVeh(v), 180, 0, 'veh');
    else if (P) { if (v.kx != null) fn(v.side, v.kx, v.ky, frPowVeh(v), 180, PV[ci(v.x, v.y)] ? 0 : Math.max(0, t - (v.seen > 0 ? v.seen : t)), 'veh'); }
    else if (SEEN[ci(v.x, v.y)]) fn(v.side, v.x, v.y, frPowVeh(v), 180, 0, 'veh');
    else if (v.es != null && t - v.es < 90) { const a = t - v.es; fn(v.side, v.ex, v.ey, frPowVeh(v) * (1 - a / 90), 180, a, 'veh'); }
  }
  for (const a of S.armor || []) {
    if (a.dead) continue;
    if (!P) fn('e', a.x, a.y, frPowCar(a), 170, 0, 'car');
    else if (a.kx != null) fn('e', a.kx, a.ky, frPowCar(a), 170, PV[ci(a.x, a.y)] ? 0 : Math.max(0, t - (a.seen > 0 ? a.seen : t)), 'car');
  }
  for (const e of S.enemies) {
    if (e.dead || (P && e.kx == null)) continue;
    fn('e', P ? e.kx : e.x, P ? e.ky : e.y, frPowStruct(e, !P), e.kind === 'bunker' ? 170 : 120, 0, e.kind);
  }
  for (const p of S.points) {
    const vp = p.vp || 1;
    if (p.owner === 'p') { if (p.prog >= .99) fn('p', p.x, p.y, 3 * vp, 120, 0, 'pt'); }
    else if (p.owner === 'e') {
      if (P) { const v = PV[ci(p.x, p.y)] === 1; fn('e', p.x, p.y, v ? vp : 2 + 2 * vp, 120, v ? 0 : 90, 'pt'); }   // 未侦察的敌据点：先验兵力
      else fn('e', p.x, p.y, 3 * vp * (1 - clamp(p.prog || 0, 0, 1)), 120, 0, 'pt');
    }
  }
  for (const s of S.ships) if ((s.state === 'beached' || s.state === 'unloading') && s.load && s.load.teams > 0 && (P || SEEN[ci(s.x, s.y)])) fn('p', s.bx != null ? s.bx : s.x, s.by != null ? s.by : s.y, 3 * s.load.teams, 120, 0, 'ship');
}

// 某点周围 persp 视角的已知兵力：foe / own 为人当量，n 对方兵力源数，bunk / trench 为守方工事（persp 所知），age 对方情报最新的龄（秒）
function frKnown(persp, x, y, r) {
  const o = { foe: 0, own: 0, n: 0, bunk: 0, trench: 0, age: 999 };
  if (!S || !S.teams) return o;
  const P = persp !== 'e', mine = P ? 'p' : 'e', r2 = r * r;
  frEach(P ? 'p' : 'e', (side, sx, sy, w, R, age, k) => {
    const dx = sx - x, dy = sy - y; if (dx * dx + dy * dy > r2) return;
    if (side === mine) o.own += w; else { o.foe += w; o.n++; if (age < o.age) o.age = age; }
    if (k === 'bunker') o.bunk++;
  });
  for (const t of S.trench || []) if ((!P || t.known) && t.pts && t.pts.some(([a, b]) => (a - x) * (a - x) + (b - y) * (b - y) < r2)) o.trench++;
  return o;
}

// —— 缓存（类型数组，S 换了或地图换了就重建）——
const FRC = { S: null, T: null, ker: null, sea: null, bp: null, be: null, bl: null, bn: 0, st: null, tmp: null, qx: null, qy: null, qn: 0,
  r1: null, r2: null, r3: null, r4: null, s1: null, s2: null, p: null, e: null, nP: -1, nE: -1, ver: 0 };
function frKer(R) { const r = Math.ceil(R / FR_G), o = []; for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) { const d = Math.hypot(di, dj) * FR_G; if (d < R) o.push(di, dj, 1 - d / R); } return Float32Array.from(o); }
const frGrid = () => ({ ip: new Float32Array(FR_N), ie: new Float32Array(FR_N), c: new Float32Array(FR_N), lod: new Uint8Array(FR_N), ag: new Float32Array(FR_N), fet: new Float64Array(FR_NX).fill(-99), init: false });
function frReset() {
  if (!FRC.ker) {
    FRC.ker = FR_RS.map(frKer); FRC.sea = new Uint8Array(FR_N); FRC.bp = new Float32Array(FR_N * 5); FRC.be = new Float32Array(FR_N * 5); FRC.bl = new Int32Array(FR_N * 5);
    FRC.st = new Int32Array(FR_N); FRC.tmp = new Float32Array(FR_N); FRC.qx = new Float32Array(4096); FRC.qy = new Float32Array(4096);
    for (const k of ['r1', 'r2', 'r3', 'r4', 's1', 's2']) FRC[k] = new Float64Array(FR_NX);
    FRC.p = frGrid(); FRC.e = frGrid();
  }
  FRC.S = S; FRC.T = TER;
  for (let j = 0; j < FR_NY; j++) for (let i = 0; i < FR_NX; i++) FRC.sea[j * FR_NX + i] = (j + .5) * FR_G > coastAt(Math.min(W, (i + .5) * FR_G)) + 5 ? 1 : 0;   // 海面格（河流算陆地，线可以跨河）
  for (const G of [FRC.p, FRC.e]) { G.init = false; G.fet.fill(-99); }
  FRC.nP = FRC.nE = -1; FRC.ver++;
}
const frView = e => ({ t: -1, fp: Array(FR_NX).fill(null), fe: Array(FR_NX).fill(null), ...(e ? {} : { fa: Array(FR_NX).fill(null) }), ft: Array(FR_NX).fill(-99), seg: [], gap: [],
  ...(e ? { breach: [], ref: Array(FR_NX).fill(null), refT: -99 } : { flank: [], isl: [] }) });
function frNew() { S.front = { v: 1, bw: FR_G, nb: FR_NX, nid: 1, p: frView(false), e: frView(true), sec: [] }; }

// HOOK.step：仅战斗阶段；'p' 与 'e' 各 1 Hz，错开半秒；首个战斗步两边都建
function frUpdate(dt) {
  if (!S || S.phase !== 'battle' || !frOn() || typeof TER === 'undefined' || !TER || !TER.coast) return;
  if (FRC.S !== S || FRC.T !== TER) frReset();
  if (!S.front || S.front.v !== 1) frNew();
  if (FRC.nP < 0 || S.t >= FRC.nP) { FRC.nP = S.t + 1; frBuild('p'); }
  if (FRC.nE < 0 || S.t >= FRC.nE) { FRC.nE = S.t + (FRC.nE < 0 ? 1.5 : 1); frBuild('e'); }
}
function frNewGame() { if (S) S.front = null; FRC.S = null; }

// 把兵力源累加到“格 × 半径档”的桶里（同格同半径只盖一次核）
function frBin(side, x, y, w, R) {
  if (!(w > 0)) return;
  const k = frCell(x, y) * 5 + (FR_RC[R] != null ? FR_RC[R] : 2);
  if (!FRC.bp[k] && !FRC.be[k]) FRC.bl[FRC.bn++] = k;
  (side === 'p' ? FRC.bp : FRC.be)[k] += w;
}
// 守方视角：记下被我方看到的进攻方小组 / 车辆的位置（es / ex / ey），供 90 秒记忆
function frMemo() {
  for (const q of S.teams) if (q.side === 'p' && q.men.length && !q.ride && EV[ci(q.x, q.y)]) { q.es = S.t; q.ex = Math.round(q.x); q.ey = Math.round(q.y); }
  for (const v of S.veh || []) if (v.side === 'p' && !v.dead && !v.lst && EV[ci(v.x, v.y)]) { v.es = S.t; v.ex = Math.round(v.x); v.ey = Math.round(v.y); }
}
const frMed3 = (a, b, c) => a > b ? (b > c ? b : a > c ? c : a) : (a > c ? a : b > c ? c : b);
// 列向平滑：三点中值 → [1,2,1]/4（跳过空列）→ 时间低通 y += (raw − y)·.4；消失的列保留 5 秒
function frSmooth(raw, prev, ft) {
  const a = FRC.s1, m = FRC.s2, n = FR_NX, t = S.t;
  for (let b = 0; b < n; b++) { const v = raw[b]; if (v !== v) { a[b] = NaN; continue; } const l = b > 0 ? raw[b - 1] : NaN, r = b < n - 1 ? raw[b + 1] : NaN; a[b] = l === l && r === r ? frMed3(l, v, r) : v; }
  for (let b = 0; b < n; b++) { const v = a[b]; if (v !== v) { m[b] = NaN; continue; } let s = 2 * v, w = 2; const l = b > 0 ? a[b - 1] : NaN, r = b < n - 1 ? a[b + 1] : NaN; if (l === l) { s += l; w++; } if (r === r) { s += r; w++; } m[b] = s / w; }
  for (let b = 0; b < n; b++) {
    const v = m[b], p = prev[b];
    if (v === v) { prev[b] = Math.round(p == null ? v : p + (v - p) * .4); ft[b] = t; } else if (p != null && !(t - ft[b] < 5)) prev[b] = null;
  }
}
// 连续有值的列成段，相隔 ≤ 3 列的并段（段内空列线性插补）
function frSegs(fp) {
  const out = []; let b0 = -1, last = -9;
  for (let b = 0; b <= FR_NX; b++) {
    const on = b < FR_NX && fp[b] != null;
    if (on && b0 >= 0 && b - last <= 4) { for (let k = last + 1; k < b; k++) fp[k] = Math.round(lerp(fp[last], fp[b], (k - last) / (b - last))); last = b; continue; }
    if ((on || b === FR_NX) && b0 >= 0) { let s = 0; for (let k = b0; k <= last; k++) s += fp[k]; out.push({ b0, b1: last, x0: b0 * FR_G, x1: (last + 1) * FR_G, fy: Math.round(s / (last - b0 + 1)), w: (last - b0 + 1) * FR_G }); b0 = -1; }
    if (on) { b0 = b; last = b; }
  }
  return out;
}
// 带 ±1 列补洞的前沿查询
function frAt(arr, b) { const v = arr[b]; if (v != null) return v; const l = b > 0 ? arr[b - 1] : null, r = b < FR_NX - 1 ? arr[b + 1] : null; return l != null && r != null ? (l + r) / 2 : l != null ? l : r; }

// —— 重建一个视角 ——
function frBuild(view) {
  const G = FRC[view], F = S.front, V = F[view], P = view === 'p', NX = FR_NX, sea = FRC.sea, T = FRC.tmp;
  const ip = G.ip, ie = G.ie, c = G.c, lod = G.lod, ag = G.ag;
  ip.fill(0); ie.fill(0); if (P) ag.fill(999);
  if (!P) frMemo();
  FRC.bn = 0; FRC.qn = 0;
  frEach(view, (side, x, y, w, R, age, k) => {
    frBin(side, x, y, w, R);
    if (P && side === 'e') { const i = frCell(x, y); if (age < ag[i]) ag[i] = age; }
    else if (side === 'p' && k === 'team' && FRC.qn < 4096) { FRC.qx[FRC.qn] = x; FRC.qy[FRC.qn++] = y; }
  });
  // 盖核
  for (let n = 0; n < FRC.bn; n++) {
    const k = FRC.bl[n], rc = k % 5, cell = (k - rc) / 5, i0 = cell % NX, j0 = (cell - i0) / NX, K = FRC.ker[rc], wp = FRC.bp[k], we = FRC.be[k];
    FRC.bp[k] = 0; FRC.be[k] = 0;
    for (let m = 0; m < K.length; m += 3) {
      const i = i0 + K[m], j = j0 + K[m + 1];
      if (i < 0 || j < 0 || i >= NX || j >= FR_NY) continue;
      const idx = j * NX + i, w = K[m + 2];
      if (wp) ip[idx] += wp * w; if (we) ie[idx] += we * w;
    }
  }
  // 控制场：进攻方视角给陆地加 .6 的先验（未拿下的地方算敌控）；海面 = +1；3×3 盒式平滑；时间低通 .6/.4
  const pr = P ? .6 : 0;
  for (let i = 0; i < FR_N; i++) T[i] = sea[i] ? 1 : (ip[i] - ie[i] - pr) / (ip[i] + ie[i] + pr + 2);
  for (let j = 0; j < FR_NY; j++) for (let i = 0; i < NX; i++) {
    const idx = j * NX + i; if (sea[idx]) { c[idx] = 1; continue; }
    let s = 0, w = 0;
    for (let dj = -1; dj <= 1; dj++) { const jj = j + dj; if (jj < 0 || jj >= FR_NY) continue; for (let di = -1; di <= 1; di++) { const ii = i + di; if (ii < 0 || ii >= NX) continue; s += T[jj * NX + ii]; w++; } }
    c[idx] = G.init ? .6 * c[idx] + .4 * s / w : s / w;
  }
  G.init = true;
  // 登陆场：从海面四连通泛洪进 C ≥ .15 的陆地格
  const st = FRC.st; let sp = 0;
  for (let i = 0; i < FR_N; i++) { lod[i] = sea[i]; if (sea[i]) st[sp++] = i; }
  while (sp) {
    const i = st[--sp], x = i % NX;
    if (x > 0 && !lod[i - 1] && c[i - 1] >= .15) { lod[i - 1] = 1; st[sp++] = i - 1; }
    if (x < NX - 1 && !lod[i + 1] && c[i + 1] >= .15) { lod[i + 1] = 1; st[sp++] = i + 1; }
    if (i >= NX && !lod[i - NX] && c[i - NX] >= .15) { lod[i - NX] = 1; st[sp++] = i - NX; }
    if (i + NX < FR_N && !lod[i + NX] && c[i + NX] >= .15) { lod[i + NX] = 1; st[sp++] = i + NX; }
  }
  // 进攻方前沿：每列登陆场北缘；该列站在登陆场里（或紧贴其北缘）的已知步兵 → 最北小组以北 10；无步兵的列不越过相邻步兵线 25 以上
  const raw = FRC.r1, tb = FRC.r2;
  tb.fill(NaN);
  for (let n = 0; n < FRC.qn; n++) { const i = frCell(FRC.qx[n], FRC.qy[n]); if (!lod[i] && !(i + NX < FR_N && lod[i + NX])) continue; const b = i % NX, y = FRC.qy[n]; if (!(tb[b] <= y)) tb[b] = y; }
  for (let b = 0; b < NX; b++) {
    let top = -1; for (let j = 0; j < FR_NY; j++) { const i = j * NX + b; if (lod[i] && !sea[i]) { top = j; break; } }
    let y = tb[b] === tb[b] ? tb[b] - 10 : top < 0 ? NaN : top * FR_G;
    if (tb[b] !== tb[b] && y === y) {
      let l = NaN, r = NaN, dl = 0, dr = 0;
      for (let k = 1; k <= 3; k++) { if (l !== l && b - k >= 0 && tb[b - k] === tb[b - k]) { l = tb[b - k]; dl = k; } if (r !== r && b + k < NX && tb[b + k] === tb[b + k]) { r = tb[b + k]; dr = k; } }
      const ref = l === l && r === r ? (l * dr + r * dl) / (dl + dr) : l === l ? l : r;
      if (ref === ref) y = Math.max(y, ref - 35);
    }
    raw[b] = y === y && coastAt(frBX(b)) - y >= 25 ? y : NaN;
  }
  frSmooth(raw, V.fp, V.ft);
  V.seg = frSegs(V.fp);
  // 守方前沿：从进攻方前沿向北 450 内找第一个“对方兵力 ≥ 2 且 C ≤ −.1”的格（段两端外 3 列从海岸起找）；fa = 附近 5×5 最新情报龄
  const near = FRC.r3; near.fill(0);
  for (const s of V.seg) for (let k = 1; k <= 3; k++) { if (s.b0 - k >= 0) near[s.b0 - k] = 1; if (s.b1 + k < NX) near[s.b1 + k] = 1; }
  const fa = FRC.r4; fa.fill(NaN);
  for (let b = 0; b < NX; b++) {
    raw[b] = NaN;
    const y0 = V.fp[b] != null ? V.fp[b] : near[b] ? coastAt(frBX(b)) : null;
    if (y0 == null) continue;
    const j0 = clamp(Math.floor(y0 / FR_G), 0, FR_NY - 1);
    for (let j = j0; j >= Math.max(0, j0 - 15); j--) {
      const i = j * NX + b;
      if (ie[i] >= 2 && c[i] <= -.1) {
        raw[b] = (j + 1) * FR_G;
        if (P) { let a = 999; for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) { const jj = j + dj, ii = b + di; if (jj >= 0 && ii >= 0 && jj < FR_NY && ii < NX && ag[jj * NX + ii] < a) a = ag[jj * NX + ii]; } fa[b] = a; }
        break;
      }
    }
  }
  frSmooth(raw, V.fe, G.fet);
  if (P) for (let b = 0; b < NX; b++) V.fa[b] = V.fe[b] == null ? null : fa[b] === fa[b] ? Math.round(fa[b]) : V.fa[b] != null ? V.fa[b] : 999;
  V.t = S.t;
  if (P) { frExtrasP(V); frSecBuild(); } else frExtrasE(V);
  FRC.ver++;
  frStat('frBuild');
}

// 进攻方步兵连队（岸上有小组）的形心：[{u, x, y, n}]
function frUnitsP(all) {
  const out = [];
  for (const u of S.units) {
    if (u.side !== 'p' || (!all && u.state === 'rout')) continue;
    let sx = 0, sy = 0, n = 0;
    for (const q of teamsOf(u)) if (!q.ride && q.men.length && isLand(q.x, q.y)) { sx += q.x; sy += q.y; n++; }
    if (n) out.push({ u, x: sx / n, y: sy / n, n });
  }
  return out;
}
// 'p' 视角附加：覆盖空隙、侧翼威胁、孤立连队
function frExtrasP(V) {
  const fp = V.fp, U = frUnitsP(true), C = U.filter(o => o.u.state !== 'rout'), VG = [];
  for (const v of S.veh || []) if (v.side === 'p' && !v.dead && !v.lst && !v.swim && typeof VEH_SPEC === 'object' && VEH_SPEC[v.type] && VEH_SPEC[v.type].gun && isLand(v.x, v.y)) VG.push(v);
  V.gap = []; V.flank = [];
  for (const s of V.seg) {
    let r0 = -1;
    for (let b = s.b0; b <= s.b1 + 1; b++) {
      let cov = true;
      if (b <= s.b1) { const xb = frBX(b), y = fp[b]; cov = C.some(o => Math.abs(o.x - xb) <= 75 && Math.abs(o.y - y) <= 160) || VG.some(v => Math.abs(v.x - xb) <= 75 && Math.abs(v.y - y) <= 160); }
      if (!cov && r0 < 0) r0 = b;
      if (cov && r0 >= 0) {
        if (b - r0 >= 3) { let sy = 0; for (let k = r0; k < b; k++) sy += fp[k]; const x = (r0 + b) / 2 * FR_G, y = Math.round(sy / (b - r0)); V.gap.push({ b0: r0, b1: b - 1, x, y, w: (b - r0) * FR_G, th: Math.round(frKnown('p', x, y - 150, 250).foe * 10) / 10 }); }
        r0 = -1;
      }
    }
    for (const [b, dir] of [[s.b0, -1], [s.b1, 1]]) { const x = dir < 0 ? s.x0 : s.x1, y = fp[b]; V.flank.push({ b, x, y, dir, th: Math.round(frKnown('p', x + dir * 150, y - 100, 300).foe * 10) / 10 }); }
  }
  V.isl = [];
  for (const o of U) { const f = frAt(fp, frBand(o.x)); if (f != null ? o.y < f - 80 : o.y < coastAt(o.x) - 60) V.isl.push(o.u.id); }
}
// 'e' 视角附加：守方空隙（进攻方前沿当面无我兵）、30 秒前的守方前沿快照、突破
function frExtrasE(V) {
  const fp = V.fp, fe = V.fe, ex = FRC.qx, ey = FRC.qy; let n = 0;
  for (const q of S.teams) if (q.side === 'e' && q.men.length && !q.ride && n < 4096) { ex[n] = q.x; ey[n++] = q.y; }
  for (const e of S.enemies) if (!e.dead && e.kind === 'bunker' && !e.decoy && n < 4096) { ex[n] = e.x; ey[n++] = e.y; }
  for (const v of S.veh || []) if (v.side === 'e' && !v.dead && n < 4096) { ex[n] = v.x; ey[n++] = v.y; }
  V.gap = [];
  let r0 = -1;
  for (let b = 0; b <= FR_NX; b++) {
    let open = false;
    if (b < FR_NX && fp[b] != null) {
      const x = frBX(b), y = fe[b] != null ? fe[b] : fp[b], r = fe[b] != null ? 120 : 250, r2 = r * r; open = true;
      for (let k = 0; k < n; k++) { const dx = ex[k] - x, dy = ey[k] - y; if (dx * dx + dy * dy < r2) { open = false; break; } }
    }
    if (open && r0 < 0) r0 = b;
    if (!open && r0 >= 0) { if (b - r0 >= 2) { let sy = 0; for (let k = r0; k < b; k++) sy += fe[k] != null ? fe[k] : fp[k]; V.gap.push({ b0: r0, b1: b - 1, x: (r0 + b) / 2 * FR_G, y: Math.round(sy / (b - r0)), w: (b - r0) * FR_G }); } r0 = -1; }
  }
  if (!(S.t - V.refT < 30)) { V.ref = fe.slice(); V.refT = S.t; }
  const old = V.breach || []; V.breach = []; r0 = -1;
  for (let b = 0; b <= FR_NX; b++) {
    const on = b < FR_NX && fp[b] != null && V.ref[b] != null && fp[b] < V.ref[b] - 60;
    if (on && r0 < 0) r0 = b;
    if (!on && r0 >= 0) { if (b - r0 >= 3) { const o = old.find(k => k.b0 <= b - 1 && k.b1 >= r0); V.breach.push({ b0: r0, b1: b - 1, t: o ? o.t : S.t }); } r0 = -1; }
  }
}

// —— 进攻方地段：每个登陆场段按 360 米一份等分（每份 ≥ 150）；id 按重叠 ≥ 50 % 继承；段宽变化 > 25 % 或每 20 秒才重划 ——
function frSecParts() {
  const F = S.front, segs = F.p.seg, parts = [];
  if (segs.length) {
    const sg = F.sig || [];
    const ch = F.prov || sg.length !== segs.length || segs.some((s, i) => { const o = sg[i], w0 = Math.max(30, o[1] - o[0]); return Math.abs(s.w - w0) > .25 * w0 || Math.abs((s.x0 + s.x1 - o[0] - o[1]) / 2) > .25 * w0; });
    if (!ch && S.t - (F.sigT != null ? F.sigT : -99) < 20 && F.sec.length) return F.sec.map(s => [s.b0, s.b1]);
    F.sig = segs.map(s => [s.x0, s.x1]); F.sigT = S.t; F.prov = false;
    for (const s of segs) { const nb = s.b1 - s.b0 + 1, k = Math.max(1, Math.min(Math.ceil(s.w / 360), Math.floor(s.w / 150))); for (let i = 0; i < k; i++) parts.push([s.b0 + Math.round(nb * i / k), s.b0 + Math.round(nb * (i + 1) / k) - 1]); }
    return parts;
  }
  // 还没有登陆场：按计划滩头（指挥官主攻 / 佯攻 → 舰船抢滩点 → 自动驾驶的滩头）
  F.prov = true;
  const B = TER.beaches || [], bs = new Set(), C = S.cmd && S.cmd.p, pl = C && C.plan;
  if (pl) { if (pl.main >= 0) bs.add(pl.main); if (pl.feint >= 0) bs.add(pl.feint); }
  if (!bs.size) for (const s of S.ships) if (alive(s) && s.land && s.bx != null) { const i = B.findIndex(b => s.bx >= b.x0 && s.bx <= b.x1); if (i >= 0) bs.add(i); }
  if (!bs.size && S.autoPlan && S.autoPlan.s) for (const k in S.autoPlan.s) { const o = S.autoPlan.s[k]; if (o && o.b >= 0 && B[o.b]) bs.add(o.b); }
  for (const i of [...bs].sort((a, b) => B[a].x0 - B[b].x0)) {
    const b0 = frBand(B[i].x0), b1 = Math.max(b0, frBand(B[i].x1 - 1)), w = (b1 - b0 + 1) * FR_G, k = Math.max(1, Math.min(Math.ceil(w / 360), Math.floor(w / 150))), nb = b1 - b0 + 1;
    for (let m = 0; m < k; m++) parts.push([b0 + Math.round(nb * m / k), b0 + Math.round(nb * (m + 1) / k) - 1]);
  }
  return parts;
}
function frSecBuild() {
  const F = S.front, P = F.p, old = F.sec || [], parts = frSecParts();
  // 继承 id：按重叠比例从大到小配对
  const ids = parts.map(() => null), used = new Set(), pairs = [];
  parts.forEach(([b0, b1], i) => old.forEach(o => { const ov = Math.min(b1, o.b1) - Math.max(b0, o.b0) + 1; if (ov > 0) pairs.push([Math.max(ov / (b1 - b0 + 1), ov / (o.b1 - o.b0 + 1)), i, o.id]); }));
  pairs.sort((a, b) => b[0] - a[0]);
  for (const [f, i, id] of pairs) if (f >= .5 && ids[i] == null && !used.has(id)) { ids[i] = id; used.add(id); }
  const B = TER.beaches || [];
  const sec = parts.map(([b0, b1], i) => {
    let sy = 0, n = 0, sn = 0, nn = 0;
    for (let b = b0; b <= b1; b++) { if (P.fp[b] != null) { sy += P.fp[b]; n++; if (P.fe[b] != null) { sn += P.fp[b] - P.fe[b]; nn++; } } }
    const x0 = b0 * FR_G, x1 = (b1 + 1) * FR_G, cx = (x0 + x1) / 2;
    let bi = B.findIndex(b => cx >= b.x0 && cx <= b.x1);
    if (bi < 0) { let best = 0; B.forEach((b, k) => { const ov = Math.min(x1, b.x1) - Math.max(x0, b.x0); if (ov > best) { best = ov; bi = k; } }); }
    return { id: ids[i] || 'S' + F.nid++, b0, b1, x0, x1, cx, fy: Math.round(n ? sy / n : coastAt(cx) - 30), kind: 'quiet', pw: 0, ew: 0, R: 0, beach: bi, nml: nn ? sn / nn : Infinity };
  });
  if (sec.length) frEach('p', (side, x, y, w) => {
    for (const s of sec) {
      if (side === 'p') { if (x >= s.x0 && x < s.x1 && y > s.fy - 150) s.pw += w; }
      else if (x >= s.x0 - 100 && x <= s.x1 + 100 && y >= s.fy - 300 && y <= s.fy + 60) s.ew += w;
    }
  });
  for (const s of sec) { s.kind = s.nml < 250 || s.ew >= 3 ? 'contact' : 'quiet'; s.pw = Math.round(s.pw * 10) / 10; s.ew = Math.round(s.ew * 10) / 10; s.R = Math.round(s.pw / Math.max(1, s.ew) * 100) / 100; delete s.nml; }
  F.sec = sec;
}

// —— 对外接口（§3.2）——
function frFront(persp, x) {
  const b = frBand(x), o = { b, fp: null, fe: null, nml: null };
  if (!S || !S.front) return o;
  const V = S.front[persp === 'e' ? 'e' : 'p'];
  o.fp = frAt(V.fp, b); o.fe = frAt(V.fe, b); if (o.fp != null && o.fe != null) o.nml = o.fp - o.fe;
  return o;
}
function frSectors() { return S && S.front && frOn() ? S.front.sec : null; }
function frSectorAt(x) { const sec = frSectors(); if (!sec) return null; for (const s of sec) if (x >= s.x0 && x < s.x1) return s; return null; }
// 把点限制在己方前沿以北 maxAhead 以内（贴最近可通行格）；没有前沿时原样返回
function frLeash(x, y, maxAhead) {
  const f = frFront('p', x);
  if (f.fp == null || y >= f.fp - maxAhead) return { x, y };
  const j = nearestPassable(ci(x, f.fp - maxAhead), 'p');
  return j >= 0 ? { x: cellCX(j), y: cellCY(j) } : { x, y: f.fp - maxAhead };
}
function frInside(persp, x, y, pad = 60) { const f = frFront(persp, x); return f.fp != null && y >= f.fp - pad; }
function frSummary() {
  const o = { w: 0, depth: 0, seg: 0, gaps: [] };
  if (!S || !S.front) return o;
  const P = S.front.p; let d = 0, n = 0;
  for (const s of P.seg) { o.w += s.w; for (let b = s.b0; b <= s.b1; b++) if (P.fp[b] != null) { d += coastAt(frBX(b)) - P.fp[b]; n++; } }
  o.seg = P.seg.length; o.depth = n ? Math.round(d / n) : 0; o.gaps = P.gap.map(g => ({ x: g.x, y: g.y, w: g.w }));
  return o;
}

HOOK.step.push(frUpdate);
HOOK.newGame.push(frNewGame);

// —— 画面（HOOK.drawUnder）：己方前沿绿线（齿朝北）、敌前沿红线（齿朝南，情报超过 30 秒画虚线）、无人地带淡琥珀斜纹、空隙琥珀点线、孤立连队虚圈 ——
// 全图时最醒目，放大后渐隐（近看以单兵为主）；低画质只画线
const FRD = { x: new Float64Array(FR_NX + 2), y: new Float64Array(FR_NX + 2), fe: Array(FR_NX).fill(null) };
const frYAt = (arr, x) => { const f = x / FR_G - .5, b = clamp(Math.floor(f), 0, FR_NX - 1), c = Math.min(FR_NX - 1, b + 1), l = arr[b], r = arr[c]; return l == null ? r : r == null ? l : lerp(l, r, clamp(f - b, 0, 1)); };
// 一段连续的列 b0..b1：两端取与邻列的中值，二次中点平滑；tick ±1 画齿（−1 朝北）
function frRun(ctx, arr, b0, b1, col, a, lw, tick, dash) {
  const X = FRD.x, Y = FRD.y; let n = 0;
  X[n] = b0 * FR_G; Y[n++] = b0 > 0 && arr[b0 - 1] != null ? (arr[b0 - 1] + arr[b0]) / 2 : arr[b0];
  for (let b = b0; b <= b1; b++) { X[n] = frBX(b); Y[n++] = arr[b]; }
  X[n] = (b1 + 1) * FR_G; Y[n++] = b1 < FR_NX - 1 && arr[b1 + 1] != null ? (arr[b1] + arr[b1 + 1]) / 2 : arr[b1];
  ctx.setLineDash(dash || []); ctx.beginPath(); ctx.moveTo(X[0], Y[0]);
  for (let i = 1; i < n - 1; i++) ctx.quadraticCurveTo(X[i], Y[i], (X[i] + X[i + 1]) / 2, (Y[i] + Y[i + 1]) / 2);
  ctx.lineTo(X[n - 1], Y[n - 1]);
  if (!dash) { ctx.strokeStyle = rgba(COL.bg, a * .7); ctx.lineWidth = lw + px(2.2); ctx.stroke(); }   // 暗衬边：压在绿色地形上也看得清
  ctx.strokeStyle = rgba(col, a); ctx.lineWidth = lw; ctx.stroke();
  if (!tick) return;
  const L = px(4) * tick; ctx.setLineDash([]); ctx.lineWidth = lw * .8; ctx.beginPath();
  for (let x = Math.ceil((X[0] + 8) / 45) * 45; x < X[n - 1] - 8; x += 45) { const y = frYAt(arr, x); ctx.moveTo(x, y); ctx.lineTo(x, y + L); }
  ctx.stroke();
}
// 斜纹（世界坐标锚定，间距 40）填满当前裁剪区 [x0,x1]×[y0,y1]
function frHatch(ctx, x0, x1, y0, y1, a) {
  const h = y1 - y0; ctx.strokeStyle = rgba(COL.amber, a); ctx.lineWidth = px(1); ctx.setLineDash([]); ctx.beginPath();
  for (let k = Math.floor((x0 - h) / 40) * 40; k < x1; k += 40) { ctx.moveTo(k, y1); ctx.lineTo(k + h, y0); }
  ctx.stroke();
}
// 无人地带：fe 与 fp 之间 ≥ 20 的列连成带；犬牙交错（fe ≥ fp − 10）的列斜纹加密
function frNml(ctx, fp, fe, fA) {
  let b0 = -1, m0 = -1;
  for (let b = 0; b <= FR_NX; b++) {
    const both = b < FR_NX && fp[b] != null && fe[b] != null, on = both && fp[b] - fe[b] >= 20, mix = both && fe[b] >= fp[b] - 10;
    if (on && b0 < 0) b0 = b;
    if (!on && b0 >= 0) {
      const b1 = b - 1; let y0 = Infinity, y1 = -Infinity;
      ctx.beginPath(); ctx.moveTo(b0 * FR_G, fe[b0]);
      for (let k = b0; k <= b1; k++) { ctx.lineTo(frBX(k), fe[k]); y0 = Math.min(y0, fe[k]); }
      ctx.lineTo((b1 + 1) * FR_G, fe[b1]); ctx.lineTo((b1 + 1) * FR_G, fp[b1]);
      for (let k = b1; k >= b0; k--) { ctx.lineTo(frBX(k), fp[k]); y1 = Math.max(y1, fp[k]); }
      ctx.lineTo(b0 * FR_G, fp[b0]); ctx.closePath();
      ctx.fillStyle = rgba(COL.amber, .045 * fA); ctx.fill();
      ctx.save(); ctx.clip(); frHatch(ctx, b0 * FR_G, (b1 + 1) * FR_G, y0, y1, .07 * fA); ctx.restore();
      b0 = -1;
    }
    if (mix && m0 < 0) m0 = b;
    if (!mix && m0 >= 0) {
      let y0 = Infinity, y1 = -Infinity; for (let k = m0; k < b; k++) { y0 = Math.min(y0, fp[k] - 22); y1 = Math.max(y1, fp[k] + 14); }
      ctx.save(); ctx.beginPath(); ctx.rect(m0 * FR_G, y0, (b - m0) * FR_G, y1 - y0); ctx.clip(); frHatch(ctx, m0 * FR_G, b * FR_G, y0, y1, .12 * fA); ctx.restore();
      m0 = -1;
    }
  }
}
// 敌前沿：连续有值的列成段，段内按情报龄切成实线 / 虚线小段
function frEnemy(ctx, fe, fa, a, teeth) {
  const dash = [px(5), px(4)];
  let b0 = -1, d0 = false;
  for (let b = 0; b <= FR_NX; b++) {
    const on = b < FR_NX && fe[b] != null, d = on && !!fa && fa[b] != null && fa[b] > 30;
    if (b0 >= 0 && (!on || d !== d0)) { frRun(ctx, fe, b0, b - 1, COL.enemy, a, px(1.4), teeth ? 1 : 0, d0 ? dash : null); b0 = -1; }
    if (on && b0 < 0) { b0 = b; d0 = d; }
  }
}
function frCentroid(u) { let sx = 0, sy = 0, n = 0; for (const q of teamsOf(u)) if (q.men.length && !q.ride) { sx += q.x; sy += q.y; n++; } return n ? [sx / n, sy / n] : null; }
function frDraw(time) {
  if (!S || S.phase !== 'battle' || !S.front || !S.front.p || !frOn() || typeof R !== 'object' || !R.ctx) return;
  if (typeof SETTINGS === 'object' && SETTINGS && SETTINGS.front === false) return;
  const ctx = R.ctx, F = S.front, P = F.p, spec = specAll(), zr = CAM.z / CAM.fit, low = typeof SETTINGS === 'object' && SETTINGS && SETTINGS.quality === 'low';
  const fA = low ? 0 : clamp((3.5 - zr) / 1.5, 0, 1), fL = clamp((6 - zr) / 3, .25, 1), teeth = zr <= 4;
  const EF0 = spec && F.e && F.e.fe ? F.e.fe : P.fe, EA = spec ? null : P.fa, EF = FRD.fe;
  for (let b = 0; b < FR_NX; b++) { const e = EF0[b], f = P.fp[b]; EF[b] = e == null ? null : f == null ? e : Math.min(e, f - 8); }   // 犬牙交错处敌线画在我线北侧贴边，不交叉
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (fA > 0) frNml(ctx, P.fp, EF, fA);
  frEnemy(ctx, EF, EA, .5 * fL, teeth);
  const mainId = S.tf && S.tf.main, sec = F.sec || [];
  for (const s of P.seg) frRun(ctx, P.fp, s.b0, s.b1, COL.g, .55 * fL, px(1.6), teeth ? -1 : 0);
  for (const s of sec) if (s.id === mainId && P.fp[s.b0] != null && P.fp[s.b1] != null) frRun(ctx, P.fp, s.b0, s.b1, COL.g, .5 * fL, px(2.6), 0);
  // 空隙：琥珀点线覆盖这段前沿，两端各一个指向空隙的小尖角
  for (const g of P.gap) {
    if (P.fp[g.b0] == null || P.fp[g.b1] == null) continue;
    frRun(ctx, P.fp, g.b0, g.b1, COL.amber, .8 * fL, px(1.8), 0, [px(2), px(4)]);
    const s = px(5); ctx.setLineDash([]); ctx.lineWidth = px(1.4); ctx.beginPath();
    for (const [x, dir, b] of [[g.b0 * FR_G, 1, g.b0], [(g.b1 + 1) * FR_G, -1, g.b1]]) { const y = P.fp[b]; ctx.moveTo(x, y - s); ctx.lineTo(x + dir * s, y); ctx.lineTo(x, y + s); }
    ctx.stroke();
  }
  // 孤立连队：虚线圈
  if (P.isl && P.isl.length) {
    ctx.strokeStyle = rgba(COL.g, .5 * fL); ctx.lineWidth = px(1.2); ctx.setLineDash([px(2), px(3)]); ctx.beginPath();
    for (const id of P.isl) { const u = UNIT_MAP.get(id), c = u && frCentroid(u); if (c) { ctx.moveTo(c[0] + 30, c[1]); ctx.arc(c[0], c[1], 30, 0, Math.PI * 2); } }
    ctx.stroke();
  }
  // 地段分界：观战，或选中的连队所在地段
  if (sec.length) {
    let sx = null;
    if (!spec && S.sel && S.sel.length) { const u = UNIT_MAP.get(S.sel[0]), c = u && u.side === 'p' && frCentroid(u); if (c) sx = c[0]; }
    if (spec || sx != null) {
      ctx.strokeStyle = rgba(COL.g, .25 * fL); ctx.lineWidth = px(1.2); ctx.setLineDash([px(3), px(3)]); ctx.beginPath();
      for (const s of sec) {
        if (!spec && !(sx >= s.x0 && sx < s.x1)) continue;
        for (const x of [s.x0, s.x1]) { const y = frYAt(P.fp, x); if (y != null) { ctx.moveTo(x, y + 4); ctx.lineTo(x, y + 28 + px(6)); } }
      }
      ctx.stroke();
    }
  }
  if (typeof frDrawPlans === 'function') frDrawPlans(ctx, fL, spec, time);
  ctx.setLineDash([]); ctx.restore();
}
HOOK.drawUnder.push(frDraw);
