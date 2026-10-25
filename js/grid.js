'use strict';
// 视线与寻路：双方可见格（高程、林地/城镇/悬崖/烟幕遮挡）、Dijkstra 流场
const PV = new Uint8Array(GW * GH), EV = new Uint8Array(GW * GH);   // 我方 / 敌方当前可见格
const SMOKE = new Uint8Array(GW * GH);
const MINEC = new Uint8Array(GW * GH);   // 1 = 未发现的雷区，2 = 已标定雷区
const WIREC = new Uint8Array(GW * GH);   // 铁丝网所在格
const OBSC = new Uint8Array(GW * GH);    // 反登陆障碍：1 未发现，2 已发现
const CRATERC = new Uint8Array(GW * GH);   // 弹坑：提供少量掩护
let fieldGen = 0;
const FIELDS = new Map();
// 流场按通行类别分组失效：舰船只看障碍，车辆看障碍与雷区（铁丝网只慢 1.2 倍，不重算），步兵看雷区与铁丝网；地形（炸桥 / 修桥）变了全部重算
const FGEN = { ship: 0, veh: 0, inf: 0 }, FG_PREV = { m: new Uint8Array(GW * GH), w: new Uint8Array(GW * GH), o: new Uint8Array(GW * GH), t: new Uint8Array(GW * GH), ter: null };
const fgKey = cls => cls === 'ship' ? 'ship' : cls === 'veh' || cls === 'vehe' || cls === 'amph' ? 'veh' : 'inf';

const inVision = (x, y) => PV[ci(x, y)] === 1;
const spotted = (x, y) => EV[ci(x, y)] === 1;

function eachCellIn(x, y, rad, fn) {
  for (let gy = Math.max(0, Math.floor((y - rad) / CELL)); gy <= Math.min(GH - 1, Math.floor((y + rad) / CELL)); gy++)
    for (let gx = Math.max(0, Math.floor((x - rad) / CELL)); gx <= Math.min(GW - 1, Math.floor((x + rad) / CELL)); gx++)
      if (dist(gx * CELL + 5, gy * CELL + 5, x, y) <= rad) fn(gy * GW + gx);
}

function smokeMask() {
  SMOKE.fill(0);
  for (const s of S.smoke) if (s.until > S.t) eachCellIn(s.x, s.y, s.r * Math.min(1, (s.until - S.t) / 6), i => { SMOKE[i] = 1; });
}

// 射线投射：地表坡度不低于此前最高遮挡坡度即可见
function castVision(out, sources) {
  out.fill(0);
  for (const s of sources) {
    const gx0 = s.x / CELL, gy0 = s.y / CELL, i0 = ci(s.x, s.y), rc = s.r / CELL;
    const eye = (isWater(TER.type[i0]) ? 0 : TER.elev[i0] * ELEV_H) + (s.h || .35);
    out[i0] = 1;
    const n = Math.ceil(rc * 7.5);
    for (let k = 0; k < n; k++) {
      const a = k / n * 6.2832, dx = Math.cos(a), dy = Math.sin(a);
      let maxS = -1e9;
      for (let st = 1; st <= rc; st += .7) {
        const fx = gx0 + dx * st, fy = gy0 + dy * st;
        if (fx < 0 || fy < 0 || fx >= GW || fy >= GH) break;
        const i = (fy | 0) * GW + (fx | 0), t = TER.type[i];
        const ground = isWater(t) ? 0 : TER.elev[i] * ELEV_H;
        if ((ground - eye) / st >= maxS - .02) out[i] = 1;
        const top = (ground + TP[t].bl - eye) / st;
        if (top > maxS) maxS = top;
        if (SMOKE[i]) break;
      }
    }
  }
}

function addCrater(x, y, r) {
  S.craters.push({ x, y, r });
  if (S.craters.length > 260) S.craters.shift();
  eachCellIn(x, y, r, i => { CRATERC[i] = 1; });
}
function rebuildCraters() { CRATERC.fill(0); for (const c of S.craters) eachCellIn(c.x, c.y, c.r, i => { CRATERC[i] = 1; }); }

// 工事网格（地雷/铁丝网/障碍）变化后重建并让寻路缓存失效
function rebuildForts() {
  MINEC.fill(0); WIREC.fill(0); OBSC.fill(0);
  for (const m of S.mines) if (m.clr < 1) eachCellIn(m.x, m.y, m.r, i => { MINEC[i] = m.known ? 2 : Math.max(MINEC[i], 1); });
  for (const w of S.wire) if (!w.cut) {
    const n = Math.ceil(dist(w.x0, w.y0, w.x1, w.y1) / 5);
    for (let s = 0; s <= n; s++) WIREC[ci(lerp(w.x0, w.x1, s / n), lerp(w.y0, w.y1, s / n))] = 1;
  }
  for (const o of S.obst) if (!o.dead) OBSC[ci(o.x, o.y)] = o.known ? 2 : 1;
  fieldGen++;
  const diff = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return true; return false; };
  const t = FG_PREV.ter !== TER || diff(TER.type, FG_PREV.t), m = diff(MINEC, FG_PREV.m), w = diff(WIREC, FG_PREV.w), o = diff(OBSC, FG_PREV.o);
  if (t || o) FGEN.ship++;
  if (t || o || m) FGEN.veh++;
  if (t || m || w) FGEN.inf++;
  FG_PREV.m.set(MINEC); FG_PREV.w.set(WIREC); FG_PREV.o.set(OBSC); FG_PREV.t.set(TER.type); FG_PREV.ter = TER;
}

// cls：'p' 我方步兵（只回避已知雷区），'e' 守军（熟悉自己的雷区），'ship' 舰船，
// 'raid' 敌袭扰分队（同守军，另外偏好林地/城镇、回避开阔地与我方视野内的格；PV 在流场计算时取快照）
// 车辆：'veh' 我方轮履式（回避已知雷区/障碍，碾过铁丝网）、'vehe' 守军车辆（熟悉自己的雷区与障碍）、'amph' 两栖坦克（另可泅渡深海与浅滩）
// 林地慢、沼泽很慢、悬崖/山地/河流不可通行（桥梁与渡口除外），道路最快
const VCOST = [Infinity, Infinity, Infinity, 1.25, 4, Infinity, 1, 3, 1.5, Infinity, 5, Infinity, .8, .72, 1.4, 2.5];
function stepCost(i, cls) {
  const t = TER.type[i];
  if (cls === 'ship') return t === T.DEEP ? (OBSC[i] === 2 ? 4 : 1) : t === T.SHOAL ? (OBSC[i] === 2 ? 6 : 1.6) : Infinity;
  if (cls === 'veh' || cls === 'vehe' || cls === 'amph') {
    let c = cls === 'amph' && (t === T.DEEP || t === T.SHOAL) ? 1.7 : VCOST[t];
    if (c === Infinity || OBSC[i] === 2 || (cls === 'vehe' && OBSC[i])) return Infinity;
    if (MINEC[i] && (cls === 'vehe' || MINEC[i] === 2)) c *= cls === 'vehe' ? 25 : 8;
    return WIREC[i] ? c * 1.2 : c;
  }
  const sp = TP[t].sp;
  if (!sp) return Infinity;
  let c = 1 / sp;
  const ec = cls === 'e' || cls === 'raid';
  if (MINEC[i] && (ec || MINEC[i] === 2)) c *= ec ? 25 : 6;
  if (WIREC[i]) c *= ec ? 1.5 : 3;
  if (cls === 'raid') c *= (t === T.FOREST || t === T.TOWN ? .7 : t === T.FIELD || t === T.ROAD || t === T.BEACH ? 1.6 : 1) * (PV[i] ? 3 : 1);
  return c;
}

function nearestPassable(i, cls) {
  if (stepCost(i, cls) < Infinity) return i;
  const x = cellCX(i), y = cellCY(i);
  for (let r = 1; r < 12; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    const gx = (x / CELL | 0) + dx, gy = (y / CELL | 0) + dy;
    if (gx < 0 || gy < 0 || gx >= GW || gy >= GH) continue;
    if (stepCost(gy * GW + gx, cls) < Infinity) return gy * GW + gx;
  }
  return -1;
}

const NB = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
const NDX = NB.map(n => n[0]), NDY = NB.map(n => n[1]), NDM = NB.map(n => n[2]);

// 流场缓存：地形/工事变化只让版本号递增；每个推演步最多重算 FBUDGET 个，超出时先用旧流场，避免大地图卡顿
let FBUDGET = 3, FCOUNT = 0;   // FCOUNT：累计重算次数（性能统计）
const COSTS = new Map();
const HEAP_N = new Int32Array(GW * GH * 8), HEAP_P = new Float64Array(GW * GH * 8);
function field(tx, ty, cls) {
  const ti = nearestPassable(ci(tx, ty), cls);
  if (ti < 0) return null;
  const key = cls + ti, f = FIELDS.get(key), gen = FGEN[fgKey(cls)], now = typeof S === 'object' && S && S.phase === 'battle' && isFinite(S.t) ? S.t : null;
  // 交战中 3 秒内算过的流场：工事网格又变了也先照用（炮火连连时铁丝网、雷区几乎每秒在变，每变一次就整图重算太卡）
  if (f && (f.gen === gen || FBUDGET <= 0 || (now != null && f.t != null && now - f.t >= 0 && now - f.t < 3))) { FIELDS.delete(key); FIELDS.set(key, f); return f.d; }
  FBUDGET--; FCOUNT++;
  const d = f ? f.d : new Float64Array(GW * GH);
  d.fill(Infinity);
  // 通行代价按地形版本缓存（同一版本内多个流场共用，大地图上省掉每次整图重算）；raid 依赖实时视野，每次重算
  let C = COSTS.get(cls);
  if (!C || C.gen !== gen || cls === 'raid') { C = { gen, a: (C && C.a) || new Float64Array(GW * GH) }; for (let k = 0; k < GW * GH; k++) C.a[k] = stepCost(k, cls); COSTS.set(cls, C); }
  const cost = C.a;
  let n = 0;
  const push = (i, p) => {
    let k = n++;
    while (k > 0) { const pa = (k - 1) >> 1; if (HEAP_P[pa] <= p) break; HEAP_N[k] = HEAP_N[pa]; HEAP_P[k] = HEAP_P[pa]; k = pa; }
    HEAP_N[k] = i; HEAP_P[k] = p;
  };
  d[ti] = 0; push(ti, 0);
  while (n) {
    const i = HEAP_N[0], p = HEAP_P[0], li = HEAP_N[--n], lp = HEAP_P[n];
    let k = 0;
    for (;;) {
      let c = 2 * k + 1;
      if (c >= n) break;
      if (c + 1 < n && HEAP_P[c + 1] < HEAP_P[c]) c++;
      if (HEAP_P[c] >= lp) break;
      HEAP_N[k] = HEAP_N[c]; HEAP_P[k] = HEAP_P[c]; k = c;
    }
    HEAP_N[k] = li; HEAP_P[k] = lp;
    if (p > d[i]) continue;
    const gx = i % GW, gy = (i / GW) | 0, c0 = cost[i];
    for (let k2 = 0; k2 < 8; k2++) {
      const nx = gx + NDX[k2], ny = gy + NDY[k2];
      if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
      const j = ny * GW + nx, cj = cost[j];
      if (cj === Infinity) continue;
      const nd = p + (cj + c0) * .5 * NDM[k2];
      if (nd < d[j] && n < HEAP_N.length) { d[j] = nd; push(j, nd); }
    }
  }
  FIELDS.delete(key);
  FIELDS.set(key, { d, gen, t: now });
  while (FIELDS.size > 48) FIELDS.delete(FIELDS.keys().next().value);
  return d;
}

// 局部流场：只在 (x0, y0)、(tx, ty) 外扩 pad 格的小窗口里算（近距离绕行、近距离可达性检查用，不进全图流场缓存）；
// 返回 {d 窗口距离图, gx0, gy0, w, h}，窗口超过 LOCF.max 格返回 null（交给全图流场）
const LOCF = { max: 2500, d: new Float64Array(2500), hn: new Int32Array(2500 * 8), hp: new Float64Array(2500 * 8) };
function localField(x0, y0, tx, ty, cls, pad = 6) {
  const gx0 = Math.max(0, Math.floor(Math.min(x0, tx) / CELL) - pad), gy0 = Math.max(0, Math.floor(Math.min(y0, ty) / CELL) - pad);
  const gx1 = Math.min(GW - 1, Math.floor(Math.max(x0, tx) / CELL) + pad), gy1 = Math.min(GH - 1, Math.floor(Math.max(y0, ty) / CELL) + pad);
  const w = gx1 - gx0 + 1, h = gy1 - gy0 + 1;
  if (w * h > LOCF.max) return null;
  const ti = nearestPassable(ci(tx, ty), cls);
  if (ti < 0) return null;
  const tx0 = ti % GW - gx0, ty0 = ((ti / GW) | 0) - gy0;
  if (tx0 < 0 || ty0 < 0 || tx0 >= w || ty0 >= h) return null;
  const d = LOCF.d, HN = LOCF.hn, HP = LOCF.hp;
  d.fill(Infinity, 0, w * h);
  let n = 0;
  const push = (i, p) => { let k = n++; while (k > 0) { const pa = (k - 1) >> 1; if (HP[pa] <= p) break; HN[k] = HN[pa]; HP[k] = HP[pa]; k = pa; } HN[k] = i; HP[k] = p; };
  const t0 = ty0 * w + tx0;
  d[t0] = 0; push(t0, 0);
  while (n) {
    const i = HN[0], p = HP[0], li = HN[--n], lp = HP[n];
    let k = 0;
    for (;;) { let c = 2 * k + 1; if (c >= n) break; if (c + 1 < n && HP[c + 1] < HP[c]) c++; if (HP[c] >= lp) break; HN[k] = HN[c]; HP[k] = HP[c]; k = c; }
    HN[k] = li; HP[k] = lp;
    if (p > d[i]) continue;
    const lx = i % w, ly = (i / w) | 0, c0 = stepCost((ly + gy0) * GW + lx + gx0, cls);
    for (let k2 = 0; k2 < 8; k2++) {
      const nx = lx + NDX[k2], ny = ly + NDY[k2];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const cj = stepCost((ny + gy0) * GW + nx + gx0, cls);
      if (cj === Infinity) continue;
      const j = ny * w + nx, nd = p + (cj + c0) * .5 * NDM[k2];
      if (nd < d[j] && n < HN.length) { d[j] = nd; push(j, nd); }
    }
  }
  return { d, gx0, gy0, w, h };
}
// 局部流场里 (x, y) 的距离（窗口外为 Infinity）与下降一步
function localAt(L, x, y) { const gx = Math.floor(x / CELL) - L.gx0, gy = Math.floor(y / CELL) - L.gy0; return gx < 0 || gy < 0 || gx >= L.w || gy >= L.h ? Infinity : L.d[gy * L.w + gx]; }
function localNext(L, x, y) {
  const gx = Math.floor(x / CELL) - L.gx0, gy = Math.floor(y / CELL) - L.gy0;
  if (gx < 0 || gy < 0 || gx >= L.w || gy >= L.h) return null;
  let best = -1, bv = L.d[gy * L.w + gx];
  for (let k = 0; k < 8; k++) {
    const nx = gx + NDX[k], ny = gy + NDY[k];
    if (nx < 0 || ny < 0 || nx >= L.w || ny >= L.h) continue;
    const j = ny * L.w + nx;
    if (L.d[j] < bv) { bv = L.d[j]; best = j; }
  }
  return best < 0 ? null : [((best % L.w) + L.gx0) * CELL + CELL / 2, (((best / L.w) | 0) + L.gy0) * CELL + CELL / 2];
}

// 沿流场下降一步：返回下一格中心，已在目标格返回 null
function nextStep(d, x, y) {
  const i = ci(x, y), gx = i % GW, gy = (i / GW) | 0;
  let best = -1, bv = d[i];
  for (const [dx, dy] of NB) {
    const nx = gx + dx, ny = gy + dy;
    if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
    const j = ny * GW + nx;
    if (d[j] < bv) { bv = d[j]; best = j; }
  }
  return best < 0 ? null : [cellCX(best), cellCY(best)];
}
