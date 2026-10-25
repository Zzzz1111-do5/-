'use strict';
// 指挥体系（双方）：司令 → 旅 → 团
// 司令（hqCmd）：开战时把机动兵力编成旅、团，按兵力与地形定一个战术，只给各旅下命令（通联里只显示这些命令）；
//   之后围绕这个战术执行，到了预定的节点（判明敌主攻方向、夺取目标、反冲击得手 / 受挫）才给旅下新命令，不来回改
// 旅（hqBde）：把司令的命令分给各团——进攻：第一梯队一两个团左右并进、其余为第二梯队跟进；防御：前沿一线团、纵深一个团；
//   待机：各团在集结地域隐蔽；反冲击：各团先到攻击出发位置，到齐（或时限到）同时发起
// 团（regThink，团长）：在 orbat.js 战斗群上扩展，按战法表（doctrine.js docOf：命令 × 本团编成 × 当面敌情）选队形与打法——
//   集合 → 行军纵队 → 展开（攻击出发位置）→ 火力准备 → 冲击（交替跃进、迂回）→ 巩固；防御：占领阵地、就地反冲击、劣势后撤重整
// 守备部队（守备排、伏击组、碉堡、炮兵）不编团，仍由原来的守军 AI 在阵地上打；开了指挥体系，旧的零散调兵（brain.js）关掉
// 状态（纯 JSON）：S.hq = { on, e: 司令, p: 司令 }；司令 = { tac 战术, bdes: [旅], n 团编号, mem 敌情记忆, main 判明的主攻滩头, said }
//   旅 = { id, side, no, name, role, regs: [团 id], ord: { v, objs, i, why }, ordT, st }；团 = S.bgs 里 reg 为真的战斗群（bde 旅 id，task 旅给的任务）
const HQ = { think: 3, orgT: 2, memT: 120, link: 350, maxU: 4, maxV: 8, attack: 340, follow: 420, firm: 90 };
const HQ_ECH = { reg: 'III', bde: 'X' };
const hqOn = () => !!S && !!S.hq && S.hq.on && S.phase === 'battle';
const hqSideOn = side => hqOn() && !!S.hq[side] && S.hq[side].live;
const hqVis = side => side === 'e' ? spotted : inVision;
const hqPt = k => (k != null && S.points.find(p => p.key === k)) || null;
const hqMine = (side, p) => !!p && (side === 'p' ? p.owner === 'p' && p.prog >= .99 : p.owner === 'e' && p.prog < .25);
const hqRegs = (side, B) => (S.bgs || []).filter(G => G.reg && !G.dead && G.side === side && (!B || G.bde === B.id));
const hqBdeOf = G => G && S.hq && S.hq[G.side] ? S.hq[G.side].bdes.find(B => B.id === G.bde) : null;
const hqWhere = (x, y) => typeof cmdWhere === 'function' ? cmdWhere(x, y) : gridRef(x, y);
const hqTank = v => BG_TANK.includes(v.type) || v.type === 'flame_tank' || v.type === 'mine_tank';
const hqAA = v => v.type === 'sam_veh' || v.type === 'aa_veh';

// ———————————————— 通联：只播司令对旅的命令 ————————————————
function hqSay(side, B, text, at) {
  if (typeof chatSay !== 'function') return;
  const who = B ? `司令 → ${B.name}` : '司令';
  chatSay(side, `${who}：${text}`, { kind: 'order', at: at || (B && hqBdeAt(B)) || undefined, lv: 0, hq: true });
}

// ———————————————— 团：战斗力与编成 ————————————————
function hqRegPow(G) {
  let inf = 0, veh = 0;
  for (const u of bgUnits(G)) for (const q of teamsOf(u)) inf += q.men.length;
  for (const v of bgVehs(G)) veh += bgPow(v);
  return { inf, veh, tot: inf + veh };
}
function hqRegType(G) { const P = hqRegPow(G), f = P.veh / Math.max(1, P.tot); return f >= .6 ? 'armor' : f >= .25 ? 'mech' : 'inf'; }
const HQ_TYPE = { armor: '装甲', mech: '机步', inf: '步兵' };
// 当面敌情：本方看得见的敌步兵、车辆、工事（碉堡按 6 人计）
function hqFoe(side, x, y, r) {
  const vis = hqVis(side);
  let inf = 0, veh = 0, fort = 0, cx = 0, cy = 0;
  const add = (o, w) => { cx += o.x * w; cy += o.y * w; };
  for (const q of S.teams) if (q.side !== side && q.men.length && !q.ride && isLand(q.x, q.y) && dist(q.x, q.y, x, y) < r && vis(q.x, q.y)) { inf += q.men.length; add(q, q.men.length); }
  for (const v of S.veh || []) if (v.side !== side && !v.dead && !v.lst && isLand(v.x, v.y) && dist(v.x, v.y, x, y) < r && vis(v.x, v.y)) { const w = bgPow(v); veh += w; add(v, w); }
  if (side === 'p') for (const e of S.enemies) if (!e.dead && e.kx != null && (e.kind === 'bunker') && dist(e.kx, e.ky, x, y) < r) { fort += 6; add({ x: e.kx, y: e.ky }, 6); }
  const n = inf + veh + fort;
  const t = !n ? 'inf' : fort >= n * .3 ? 'fort' : veh >= n * .5 ? 'armor' : veh >= n * .2 ? 'mixed' : 'inf';
  return { t, n, inf, veh, fort, x: n ? cx / n : x, y: n ? cy / n : y };
}

// 编入团：步兵连交给团指挥（守方 role bg；攻方自动指挥转入 bg 阶段），车辆交给团（v.bgG，团每秒下 v.cmd）
function hqTake(G, us, vs) {
  const P = G.side === 'p' && typeof apEnsure === 'function' ? apEnsure() : null;
  for (const u of us) {
    if (!G.us.includes(u.id)) G.us.push(u.id);
    if (G.side === 'e') Object.assign(u, { role: 'bg', obj: G.key });
    else { const pl = P.u[u.id] || (P.u[u.id] = { ph: 'idle', obj: null, next: S.t }); apIdle(pl); pl.ph = 'bg'; }
    for (const q of teamsOf(u)) Object.assign(q, G.side === 'e' ? { role: 'bg', bg: true, obj: G.key, hold: false, px: null } : { bg: true });
    u.bgX = null;
  }
  for (const v of vs) { if (!G.vs.includes(v.id)) G.vs.push(v.id); Object.assign(v, { bgG: G.id, cmd: null, buddy: null, esc: null }); }
}
// 团解散 / 交还：攻方交回自动指挥，守方编入就近据点守备
function hqRelease(G) {
  const P = G.side === 'p' && typeof apEnsure === 'function' ? apEnsure() : null;
  const own = S.points.filter(p => hqMine(G.side, p)).sort((a, b) => dist(a.x, a.y, G.ax, G.ay) - dist(b.x, b.y, G.ax, G.ay))[0];
  for (const u of bgUnits(G)) {
    if (P) { const pl = P.u[u.id]; if (pl) apIdle(pl); for (const q of teamsOf(u)) q.bg = null; }
    else { Object.assign(u, { role: 'garrison', obj: own && own.key }); for (const q of teamsOf(u)) Object.assign(q, { role: 'garrison', bg: null, obj: own && own.key, px: null }); }
  }
  for (const v of bgVehs(G)) Object.assign(v, { cmd: null, bgG: null, hx: v.x, hy: v.y });
  G.dead = true; G.done = true;
}
function hqNewReg(side, B, us, vs, at) {
  const H = S.hq[side], n = ++H.n;
  B.rn = (B.rn || 0) + 1;
  const G = bgNew(side, `${B.no}旅${B.rn}团`, '团长', { us: [], vs: [], rec: [], ax: Math.round(at.x), ay: Math.round(at.y), key: null, ech: HQ_ECH.reg, reg: true, bde: B.id, no: n,
    task: { v: 'reserve', x: Math.round(at.x), y: Math.round(at.y), face: side === 'e' ? SOUTH : NORTH }, asmT: 40, face: side === 'e' ? SOUTH : NORTH });
  hqTake(G, us, vs);
  const far = Math.max(0, ...us.map(u => dist(u.x, u.y, at.x, at.y)), ...vs.map(v => dist(v.x, v.y, at.x, at.y) / 2));
  G.asmT = Math.round(clamp(far / 9 + 15, 25, 120));
  G.type = hqRegType(G); G.p0 = hqRegPow(G).tot;
  B.regs.push(G.id);
  return G;
}

// ———————————————— 团长：队形 ————————————————
// 锚点坐标系：x 向前、y 向右；锚点是第一线步兵的中心
function regSlots(G, mode) {
  const D = G.doc || DOC_BASE, us = bgUnits(G).filter(u => u.state !== 'rout'), vs = bgVehs(G), out = [];
  const fx = Math.cos(G.face), fy = Math.sin(G.face), px = -fy, py = fx;
  const at = (x, y) => [clamp(G.ax + fx * x + px * y, 15, W - 15), clamp(G.ay + fy * x + py * y, 15, H - 15)];
  const lat = o => (o.x - G.ax) * px + (o.y - G.ay) * py;
  const vcls = G.side === 'e' ? 'vehe' : 'veh';
  const put = (m, k, x, y, t) => { const [sx, sy] = bgSnap(G, ...at(x, y), k === 'u' ? G.side : vcls); out.push({ m, k, x: sx, y: sy, t }); };
  const tk = vs.filter(hqTank), ifv = vs.filter(v => v.type === 'apc' || v.type === 'abv'), td = vs.filter(v => v.type === 'td' || v.type === 'recon');
  const aa = vs.filter(hqAA), art = vs.filter(v => v.type === 'spg'), rest = vs.filter(v => ![...tk, ...ifv, ...td, ...aa, ...art].includes(v));
  const row = (list, x, w, t) => list.slice().sort((a, b) => lat(a) - lat(b)).forEach((v, i) => put(v, 'v', x, list.length > 1 ? (i / (list.length - 1) - .5) * w : 0, t));
  if (mode === 'march') {   // 行军纵队：前卫坦克在前，各连依次跟进（间隔 70），步战车夹在连间，防空居中，火炮殿后
    let x = 0;
    tk.slice(0, 2).forEach((v, i) => put(v, 'v', 60 - i * 22, 0));
    us.forEach((u, i) => { put(u, 'u', x, 0); x -= 70; if (ifv[i]) put(ifv[i], 'v', x + 35, 14); });
    tk.slice(2).forEach((v, i) => put(v, 'v', x - i * 24, (i % 2 ? 12 : -12)));
    x -= Math.max(0, tk.length - 2) * 24;
    [...ifv.slice(us.length), ...td, ...aa, ...rest].forEach((v, i) => put(v, 'v', x - 20 - i * 26, 0));
    art.forEach((v, i) => put(v, 'v', x - 90 - i * 28, 0));
    return out;
  }
  if (mode === 'sweep') {
    const n = us.length;
    us.slice().sort((a, b) => lat(a) - lat(b)).forEach((u, i) => { const a = (i / Math.max(1, n) - .5) * 2.6, r = n > 1 ? 55 : 0; put(u, 'u', Math.cos(a) * r * .6, Math.sin(a) * r * 1.4); });
    vs.forEach((v, i) => put(v, 'v', -70 - (i % 2) * 25, (i / Math.max(1, vs.length - 1) - .5) * 160));
    return out;
  }
  // 战斗 / 防御 / 待机：按战法表的队形展开
  const hold = mode === 'hold', res = mode === 'reserve', sp = 95 * (res ? .65 : D.wid);
  const sorted = us.slice().sort((a, b) => lat(a) - lat(b));
  let fl = [];
  if (!hold && !res && G.flk && D.flank > 0 && sorted.length >= 3) {   // 迂回：最外侧一两个连从侧翼包抄
    const k = Math.max(1, Math.round(sorted.length * D.flank));
    fl = G.flk > 0 ? sorted.splice(sorted.length - k, k) : sorted.splice(0, k);
  }
  const nd = hold || sorted.length >= 4 ? Math.min(sorted.length - 1, Math.round(sorted.length * (hold ? D.depth : .2))) : 0;   // 二线（纵深）连
  const second = nd > 0 ? sorted.splice(Math.floor((sorted.length - nd) / 2), nd) : [];
  const n = sorted.length, half = (n - 1) / 2;
  const formX = j => {
    const y = (j - half) * sp, a = Math.abs(y);
    switch (hold ? 'line' : D.form) {
      case 'wedge': return -a * .45;
      case 'vee': return a * .45 - half * sp * .45;
      case 'echL': return -j * 38;
      case 'echR': return -(n - 1 - j) * 38;
      default: return 0;
    }
  };
  const bnd = !hold && !res && D.bound && G.st === 'assault' && n >= 2;
  sorted.forEach((u, j) => {
    const over = bnd && j % 2 !== (G.bh || 0);   // 交替跃进：掩护的一半停在上一个跃进线上原地火力掩护
    put(u, 'u', formX(j) - (over ? (G.bd || 0) : 0), (j - half) * sp, over ? 'hold' : null);
  });
  second.forEach((u, j) => put(u, 'u', -130, (j - (second.length - 1) / 2) * sp));
  const wid = Math.max(1, n) * sp;
  fl.forEach((u, j) => put(u, 'u', G.st === 'assault' ? 40 : -20, G.flk * (wid / 2 + 170 + j * 70)));
  const tx = hold ? (D.arm === 'front' ? 25 : -55) : D.arm === 'front' ? 55 : D.arm === 'rear' ? -60 : 8;
  if (D.arm === 'mixed' && !hold && n >= 2) {   // 步坦交错：坦克插在各连之间
    tk.slice().sort((a, b) => lat(a) - lat(b)).forEach((v, i) => { const g = (i % Math.max(1, n - 1)) + .5, row2 = Math.floor(i / Math.max(1, n - 1)); put(v, 'v', formX(Math.min(n - 1, Math.round(g))) + tx - row2 * 26, (g - half) * sp + (row2 % 2 ? 14 : 0)); });
  } else row(tk, tx, Math.max(wid, tk.length * 26));
  row(ifv, hold ? -40 : -28, wid * .8);
  td.forEach((v, i) => put(v, 'v', hold ? -10 : 15, (i % 2 ? 1 : -1) * (wid / 2 + 40 + Math.floor(i / 2) * 25)));
  row(aa, -100, Math.min(140, aa.length * 40));
  row(art, -260, Math.min(100, art.length * 35));
  row(rest, -70, 60);
  return out;
}
// 下令：各连按三三制槽位、车辆按位置；位置没变不重下，停着不动的组 8 秒后重下（与 bgOrder 一致），t 可逐个指定
function regOrder(G, sl, t0) {
  const fx = G.ax + Math.cos(G.face) * 300, fy = G.ay + Math.sin(G.face) * 300;
  for (const s of sl) {
    const t = s.t || t0;
    if (s.k === 'u') {
      const u = s.m, ts = teamsOf(u).filter(q => q.men.length && !q.ride);
      if (!ts.length) continue;
      const idle = t !== 'hold' && S.t - (u.bgOT ?? -99) > 8 && ts.some(q => (q.order.t === 'hold' || q.order.x == null) && q.sup < 60 && dist(q.x, q.y, s.x, s.y) > 40);
      if (u.bgX != null && dist(u.bgX, u.bgY, s.x, s.y) < BG.reorder && u.bgT2 === t && !idle) continue;
      u.bgX = s.x; u.bgY = s.y; u.bgT2 = t; u.face = G.face; u.bgOT = S.t;
      const fs = formationSlots(ts.length, s.x, s.y, G.face);
      ts.forEach((q, i) => { if (t === 'hold' && dist(q.x, q.y, fs[i][0], fs[i][1]) < 6) return; aiGo(q, fs[i][0], fs[i][1], t === 'hold' ? 'move' : t, fx, fy); q.px = null; });
    } else {
      const v = s.m;
      if (v.ai === 'repair' || v.ai === 'resup' || vehAmmoF(v) < .25 || (v.fuel ?? 1) < .2 || v.hp < v.maxhp * .35) continue;   // 该补给 / 抢修的车交给车辆 AI
      v.cmd = { x: s.x, y: s.y, t: t === 'amove' && v.type !== 'spg' && !hqAA(v) ? 'amove' : 'move', face: G.face, until: S.t + 4, ai: 'bg' };
    }
  }
}

// ———————————————— 团长：打法 ————————————————
const regFace = (G, x, y) => { const a = Math.atan2(y - G.ay, x - G.ax); G.face = G.face + clamp(Math.atan2(Math.sin(a - G.face), Math.cos(a - G.face)), -.3, .3); };
// 火力准备：攻方叫舰炮（指挥官受理），守方炮兵按 hqFocus 打
function regPrep(G, x, y) {
  if (G.side === 'p' && typeof cmdFire === 'function' && S.cmd && S.cmd.p) { cmdFire(x, y, 3, 'reg'); if (typeof cmdAir === 'function') cmdAir('cas', x, y); }
  G.fireReq = { x: Math.round(x), y: Math.round(y), t: S.t };
}
function regGoal(G) {
  const T = G.task || {};
  const p = hqPt(T.key);
  return { T, p, x: T.x ?? G.ax, y: T.y ?? G.ay, face: T.face ?? G.face };
}
function regSet(G, st, why) { if (G.st === st) return; G.st = st; G.stT = S.t; G.stWhy = why || null; }
function regThink(G) {
  const us = bgUnits(G), vs = bgVehs(G);
  if (!us.length && !vs.length) { G.dead = true; G.done = true; return; }
  bgSplit(G);
  const pw = hqRegPow(G);
  G.type = hqRegType(G);
  const { T, p, x: tx, y: ty, face: tf } = regGoal(G);
  const look = p ? { x: p.x, y: p.y } : { x: G.ax + Math.cos(G.face) * 250, y: G.ay + Math.sin(G.face) * 250 };
  const F = hqFoe(G.side, (G.ax + look.x) / 2, (G.ay + look.y) / 2, 420), near = hqFoe(G.side, G.ax, G.ay, 320);
  const atk = T.v === 'attack' || T.v === 'counter';
  G.foeT = F.n ? F.t : 'inf';
  G.doc = G.docFix ? { ...DOC_BASE, ...G.docFix, key: 'fix' } : docOf(atk || G.st === 'assault' ? 'atk' : 'def', G.type, G.foeT);   // docFix：训练场指定的打法
  const D = G.doc, r = pw.tot / Math.max(1, near.n);
  // 任务变了：重新开进
  if (T.k !== G.tk) { G.tk = T.k; if (G.st !== 'asm') regSet(G, 'move'); G.flk = 0; G.bd = 0; G.bh = 0; }
  if (G.st === 'asm') {
    const sl = regSlots(G, 'reserve'); regOrder(G, sl, 'move');
    if (bgLag(G, sl) < 45 || S.t - G.stT > (G.asmT || 40)) regSet(G, 'move');
    return;
  }
  if (pw.tot < (G.p0 || pw.tot) * .25 && G.st !== 'withdraw') { regSet(G, 'withdraw', 'weak'); G.wx = null; }
  let mode = 'fight', ot = 'move';
  switch (G.st) {
    case 'move': {   // 行军：沿寻路场开向任务位置；途中接敌按任务处置
      mode = 'march';
      const sl = regSlots(G, mode), lag = bgLag(G, sl);
      if (near.n >= 4) { regFace(G, near.x, near.y); regSet(G, atk || r >= D.press * 1.3 ? 'deploy' : 'hold', 'contact'); break; }
      if (lag < BG.lag && bgAdvance(G, tx, ty, BG.pace)) { G.face = tf; regSet(G, atk ? 'deploy' : T.v === 'reserve' || T.v === 'follow' ? 'reserve' : 'hold'); }
      break;
    }
    case 'deploy': {   // 攻击出发位置：展开成战斗队形，火力准备，等旅长统一发起
      if (p) regFace(G, p.x, p.y);
      const sl = regSlots(G, 'fight'), lag = bgLag(G, sl);
      if (!G.prepT && D.prep > 0 && p && S.t - G.stT > 6) { G.prepT = S.t; regPrep(G, p.x, p.y); }
      const ready = (lag < 50 || S.t - G.stT > 40) && (!D.prep || (G.prepT && S.t - G.prepT >= D.prep) || S.t - G.stT > 60);
      G.ready = ready;
      if (!atk) { regSet(G, 'hold'); break; }
      if (ready && T.go !== false) {
        G.prepT = 0; G.bd = 0; G.bh = 0;
        if (D.flank > 0 && us.length >= 3) G.flk = hqFlankSide(G, p) || 1;
        regSet(G, 'assault');
        if (typeof shout === 'function') shout(G, `${G.name}，冲击！`, { side: G.side });
      }
      break;
    }
    case 'assault': {   // 冲击：攻击前进，交替跃进；夺下目标转入巩固，打不动后撤重整
      ot = 'amove';
      const gx = p ? p.x : tx, gy = p ? p.y : ty;
      regFace(G, gx, gy);
      if (near.n && r < D.ret) { regSet(G, 'withdraw', 'repulsed'); G.wx = null; G.fail = S.t; break; }
      const sl = regSlots(G, 'fight'), lag = bgLag(G, sl);
      if (D.bound && us.length >= 2) {   // 跃进一段（70）：前进的一半到位后换另一半
        if ((G.bd || 0) <= 0 || lag < 30 || S.t - (G.bT ?? 0) > 25) { G.bh = (G.bh || 0) ^ 1; G.bd = 70; G.bT = S.t; }
      }
      const go = r >= D.press || !near.n;
      if (go && lag < BG.lag * 1.4) {
        const st = BG.pace * D.pace * (near.n ? .6 : 1);
        if (bgAdvance(G, gx, gy, st) || dist(G.ax, G.ay, gx, gy) < 40) regSet(G, p && !hqMine(G.side, p) ? 'clear' : 'hold', 'took');
      }
      if (S.t - G.stT > 70 && !G.prep2 && p) { G.prep2 = true; regPrep(G, p.x, p.y); }   // 打了一阵没进展：再叫一次火力
      break;
    }
    case 'clear': {   // 肃清：冲到目标后各连在目标一带搜索前进，把藏在工事里的守敌找出来打掉，直到目标真正到手
      ot = 'amove'; mode = 'sweep';
      if (p) { G.ax = p.x; G.ay = p.y; }
      if (near.n >= 3 && r < D.ret) { regSet(G, 'withdraw', 'repulsed'); G.wx = null; G.fail = S.t; break; }
      if (!p || hqMine(G.side, p)) { G.won = S.t; regSet(G, 'hold', 'took'); }
      else if (S.t - G.stT > 60) { G.won = null; regSet(G, 'regroup'); }
      break;
    }
    case 'regroup': {   // 重整：退下来的就地整顿 25 秒，进攻任务再叫一次火力、重新展开攻击（至多三次）
      mode = 'hold'; ot = 'hold';
      if (near.n) regFace(G, near.x, near.y);
      if (near.n >= 3 && r < D.ret * .7) { regSet(G, 'withdraw', 'pressed'); G.wx = null; break; }
      if (S.t - G.stT > 25) { G.tries = (G.tries || 0) + 1; regSet(G, atk && G.tries < 3 ? 'deploy' : 'hold'); G.prepT = 0; }
      break;
    }
    case 'hold': {   // 防御 / 巩固：占领阵地；敌人逼近而我占优就地反冲击，劣势后撤
      mode = 'hold'; ot = 'hold';
      if (dist(G.ax, G.ay, tx, ty) > 70 && !G.won) { regSet(G, 'move'); break; }
      if (G.won && atk && p && !hqMine(G.side, p) && S.t - G.stT > 10 && r >= D.ret) { regSet(G, 'clear'); break; }   // 巩固中目标又被夺：肃清
      if (near.n) regFace(G, near.x, near.y); else G.face = G.face + clamp(Math.atan2(Math.sin(tf - G.face), Math.cos(tf - G.face)), -.2, .2);
      if (near.n >= 3 && r < D.ret * .8) { regSet(G, 'withdraw', 'pressed'); G.wx = null; break; }
      if (near.n >= 3 && near.fort === 0 && r >= D.press * 1.2 && dist(near.x, near.y, G.ax, G.ay) < 260) { G.cx0 = G.ax; G.cy0 = G.ay; regSet(G, 'local'); }
      break;
    }
    case 'local': {   // 就地反冲击：不离开阵地 220 以上，40 秒或打退了就回来
      ot = 'amove';
      if (!near.n || S.t - G.stT > 40 || dist(G.ax, G.ay, G.cx0, G.cy0) > 220 || r < D.ret) { regSet(G, 'hold'); G.won = G.won || null; break; }
      regFace(G, near.x, near.y); bgAdvance(G, near.x, near.y, BG.pace * .6);
      break;
    }
    case 'reserve': {   // 待机：在集结地域隐蔽，正面朝威胁方向
      mode = 'reserve'; ot = 'hold';
      if (dist(G.ax, G.ay, tx, ty) > 80) { regSet(G, 'move'); break; }
      if (near.n >= 4) { regFace(G, near.x, near.y); regSet(G, r >= D.press ? 'local' : 'hold'); G.cx0 = G.ax; G.cy0 = G.ay; }
      break;
    }
    case 'withdraw': {   // 后撤：交替掩护退 250，到位后重整
      if (G.wx == null) { const a = G.face + Math.PI; let x = G.ax + Math.cos(a) * 250, y = G.ay + Math.sin(a) * 250; if (!passInf(x, y)) { const j = nearestPassable(ci(x, y), G.side); if (j >= 0) { x = cellCX(j); y = cellCY(j); } } G.wx = x; G.wy = y; }
      const keep = G.face;
      if (bgAdvance(G, G.wx, G.wy, BG.pace * .8) || S.t - G.stT > 40) { G.face = keep; G.won = null; regSet(G, 'regroup'); if (!atk) { G.task = { ...T, x: Math.round(G.ax), y: Math.round(G.ay) }; G.tk = T.k; } G.fail = S.t; }
      G.face = keep;
      break;
    }
  }
  if (!passInf(G.ax, G.ay)) { const j = nearestPassable(ci(G.ax, G.ay), G.side); if (j >= 0) { G.ax = cellCX(j); G.ay = cellCY(j); } }
  regOrder(G, regSlots(G, mode), G.st === 'withdraw' ? 'move' : ot);
}
// 迂回方向：目标两侧哪边敌人少、掩护好
function hqFlankSide(G, p) {
  if (!p) return 1;
  const a = Math.atan2(p.y - G.ay, p.x - G.ax), sc = s => { const x = p.x + Math.cos(a + s * 1.2) * 200, y = p.y + Math.sin(a + s * 1.2) * 200; return (passInf(x, y) ? 0 : -5) - hqFoe(G.side, x, y, 160).n * .3 + (1 - coverAt(x, y)) * 2; };
  return sc(1) >= sc(-1) ? 1 : -1;
}

// ———————————————— 旅长：把任务分给各团 ————————————————
function hqBdeAt(B) {
  const Rs = hqRegs(B.side, B);
  if (Rs.length) { let x = 0, y = 0, w = 0; for (const G of Rs) { const k = Math.max(1, hqRegPow(G).tot); x += G.ax * k; y += G.ay * k; w += k; } return { x: x / w, y: y / w }; }
  return B.home || null;
}
const hqObj = B => B.ord && B.ord.objs ? hqPt(B.ord.objs[Math.min(B.ord.i || 0, B.ord.objs.length - 1)]) : null;
// 威胁方向：守方朝海（敌人来路），攻方朝指挥所
function hqThreat(side, p) {
  const H = S.hq[side], m = H && H.mem ? hqMemNear(H, p.x, p.y, 900) : null;
  if (m && m.n > 2) return Math.atan2(m.y - p.y, m.x - p.x);
  if (side === 'e') return SOUTH;
  const hq = hqPt('HQ');
  return hq ? Math.atan2(hq.y - p.y, hq.x - p.x) : NORTH;
}
// 从 (x0,y0) 沿寻路场走向 p，停在离 p 还有 r 的地方
function hqApproach(side, x0, y0, p, r) {
  const f = field(p.x, p.y, side);
  let x = x0, y = y0;
  if (f && isFinite(f[ci(x, y)])) for (let k = 0; k < 900 && dist(x, y, p.x, p.y) > r; k++) { const n = nextStep(f, x, y); if (!n) break; [x, y] = n; }
  else { const d = dist(x0, y0, p.x, p.y) || 1; if (d > r) { x = p.x + (x0 - p.x) * r / d; y = p.y + (y0 - p.y) * r / d; } }
  return { x: Math.round(x), y: Math.round(y) };
}
function hqSlot(side, x, y) { x = clamp(x, 40, W - 40); y = clamp(y, 40, H - 40); if (passInf(x, y)) return { x, y }; const j = nearestPassable(ci(x, y), side); return j < 0 ? { x, y } : { x: cellCX(j), y: cellCY(j) }; }
function hqBdeThink(B) {
  const Rs = hqRegs(B.side, B).sort((a, b) => hqRegPow(b).tot - hqRegPow(a).tot);
  B.regs = B.regs.filter(id => Rs.some(G => G.id === id));
  if (!Rs.length || !B.ord) return;
  const O = B.ord, p = hqObj(B), c = hqBdeAt(B);
  // 当前目标拿下了：按命令向下一个目标发展（命令里写明的，不再请示）
  const there = p && Rs.some(G => (G.st === 'hold' && G.won) || dist(G.ax, G.ay, p.x, p.y) < 160);   // 本旅真打到了目标（不是目标本来就在手里）
  if (p && there && (O.v === 'attack' || O.v === 'counter' || O.v === 'feint') && hqMine(B.side, p) && hqFoe(B.side, p.x, p.y, 280).n < 3) {
    if ((O.i || 0) < O.objs.length - 1) { O.i = (O.i || 0) + 1; B.stepT = S.t; }
    else if (!O.done) { O.done = S.t; }
  }
  const P = hqObj(B);
  if (!P) return;
  const key = `${O.v}:${P.key}:${O.i || 0}`;
  if (O.v === 'attack' || O.v === 'counter' || O.v === 'feint') {
    if (O.done) {   // 最后一个目标已拿下：就地巩固
      const th = hqThreat(B.side, P);
      Rs.forEach((G, i) => { const a = th + (i - (Rs.length - 1) / 2) * .9, s = hqSlot(B.side, P.x + Math.cos(a) * 60 * (i ? 1.6 : .8), P.y + Math.sin(a) * 60 * (i ? 1.6 : .8)); G.task = { k: 'cons:' + P.key, v: 'defend', key: P.key, x: Math.round(s.x), y: Math.round(s.y), face: th }; });
      return;
    }
    // 攻击出发位置：从旅的位置沿路走到离目标 340；第一梯队一两个团左右展开，第二梯队在后 420 跟进
    if (B.atkK !== key || !B.atk) { B.atkK = key; B.atk = hqApproach(B.side, c.x, c.y, P, HQ.attack); B.goT = null; }
    const A = B.atk, a = Math.atan2(P.y - A.y, P.x - A.x), lx = -Math.sin(a), ly = Math.cos(a);
    const n1 = O.v === 'feint' ? Rs.length : Rs.length >= 3 ? 2 : Rs.length === 2 && hqRegPow(Rs[1]).tot > hqRegPow(Rs[0]).tot * .45 ? 2 : 1;
    const e1 = Rs.slice(0, n1), e2 = Rs.slice(n1);
    const wd = G => Math.max(1, bgUnits(G).length) * 95 * ((G.doc && G.doc.wid) || 1);
    let off = -e1.reduce((s, G) => s + wd(G), 0) / 2 - (e1.length - 1) * 30;
    for (const G of e1) {
      const w = wd(G), o = off + w / 2; off += w + 60;
      const s = hqSlot(B.side, A.x + lx * o, A.y + ly * o);
      G.task = { k: key + ':1', v: O.v === 'counter' ? 'counter' : 'attack', key: P.key, x: Math.round(s.x), y: Math.round(s.y), face: a, go: B.go !== false, ech: 1 };
    }
    // 同时发起：第一梯队都到攻击出发位置（或等满 60 秒）
    const allReady = e1.every(G => G.st === 'assault' || G.ready || G.st === 'hold' && G.won);
    if (!B.goT && (allReady || S.t - (B.atkT ?? (B.atkT = S.t)) > 60)) B.goT = S.t;
    for (const G of e1) G.task.go = !!B.goT;
    if (B.atkK !== B.goK) { B.goK = B.atkK; B.atkT = S.t; B.goT = null; for (const G of e1) G.task.go = false; }
    e2.forEach((G, i) => {
      // 第一梯队受挫（后撤或兵力不足四成）：第二梯队超越接替冲击；否则在后跟进
      const lead = e1.find(o => o.st === 'withdraw' || hqRegPow(o).tot < (o.p0 || 1) * .4);
      if (lead && !B.pass) { B.pass = S.t; }
      if (B.pass && S.t - B.pass < 240 && i === 0) { const s = hqSlot(B.side, A.x, A.y); G.task = { k: key + ':pass', v: 'attack', key: P.key, x: Math.round(s.x), y: Math.round(s.y), face: a, go: true, ech: 1 }; return; }
      const o = (i - (e2.length - 1) / 2) * 150, s = hqSlot(B.side, A.x - Math.cos(a) * HQ.follow + lx * o, A.y - Math.sin(a) * HQ.follow + ly * o);
      G.task = { k: key + ':2', v: 'follow', key: P.key, x: Math.round(s.x), y: Math.round(s.y), face: a, ech: 2 };
    });
  } else if (O.v === 'defend' || O.v === 'block') {
    // 防御：一线团在目标前方（威胁方向）左右展开，最后一个团在纵深 260 作预备队
    const th = O.face ?? hqThreat(B.side, P), lx = -Math.sin(th), ly = Math.cos(th), n1 = Rs.length >= 3 ? Rs.length - 1 : Rs.length;
    Rs.forEach((G, i) => {
      let s;
      if (i < n1) { const o = (i - (n1 - 1) / 2) * 230; s = hqSlot(B.side, P.x + Math.cos(th) * 60 + lx * o, P.y + Math.sin(th) * 60 + ly * o); }
      else s = hqSlot(B.side, P.x - Math.cos(th) * 260, P.y - Math.sin(th) * 260);
      G.task = { k: key + ':' + i, v: i < n1 ? 'defend' : 'reserve', key: P.key, x: Math.round(s.x), y: Math.round(s.y), face: th };
    });
  } else if (O.v === 'reserve' || O.v === 'follow') {
    // 待机 / 跟进：在集结地域（命令给的点，跟进时在被跟进旅后方 500）各团隐蔽，正面朝威胁
    let X = O.at ? O.at : { x: P.x, y: P.y };
    const th = O.face ?? hqThreat(B.side, P), lx = -Math.sin(th), ly = Math.cos(th);
    if (O.v === 'follow') { const L = S.hq[B.side].bdes.find(o => o.id === O.lead), lc = L && hqBdeAt(L); if (lc) X = { x: lc.x - Math.cos(th) * 450, y: lc.y - Math.sin(th) * 450 }; }   // 跟在被跟进旅背敌一侧 450
    Rs.forEach((G, i) => {
      const o = (i - (Rs.length - 1) / 2) * 200, s0 = hqSlot(B.side, X.x + lx * o, X.y + ly * o), s = O.v === 'reserve' ? hqCover(B.side, s0.x, s0.y) : s0;
      G.task = { k: `${O.v}:${Math.round(X.x / 60)}:${Math.round(X.y / 60)}:${i}`, v: O.v === 'follow' ? 'follow' : 'reserve', key: P.key, x: Math.round(s.x), y: Math.round(s.y), face: th };
    });
  }
}
// 隐蔽处：附近林地、村镇
function hqCover(side, x, y) {
  let best = { x, y }, bs = -1e9;
  for (let i = 0; i < 20; i++) {
    const a = i * 2.4, r = i ? 20 + i * 6 : 0, sx = clamp(x + Math.cos(a) * r, 20, W - 20), sy = clamp(y + Math.sin(a) * r, 20, H - 20);
    if (!passInf(sx, sy)) continue;
    const sc = (1 - coverAt(sx, sy)) * 2 - r / 80;
    if (sc > bs) { bs = sc; best = { x: sx, y: sy }; }
  }
  return best;
}

// ———————————————— 司令：敌情 ————————————————
function hqIntel(H, side) {
  const vis = hqVis(side), M = H.mem || (H.mem = {});
  for (const q of S.teams) if (q.side !== side && q.men.length && !q.ride && isLand(q.x, q.y) && vis(q.x, q.y)) M['t' + q.id] = [Math.round(q.x), Math.round(q.y), q.men.length, S.t];
  for (const v of S.veh || []) if (v.side !== side && !v.dead && !v.lst && isLand(v.x, v.y) && vis(v.x, v.y)) M['v' + v.id] = [Math.round(v.x), Math.round(v.y), bgPow(v), S.t];
  for (const k in M) { const m = M[k]; if (S.t - m[3] > HQ.memT || (m[3] < S.t - 2 && vis(m[0], m[1]) && !hqStill(k, side))) delete M[k]; }
}
function hqStill(k, side) {   // 记忆里的那个敌人还在原地附近吗（再看那里已空就划掉）
  const id = +k.slice(1), o = k[0] === 't' ? S.teams.find(q => q.id === id && q.men.length) : (S.veh || []).find(v => v.id === id && !v.dead);
  return !!o && hqVis(side)(o.x, o.y);
}
function hqMemNear(H, x, y, r) {
  let n = 0, sx = 0, sy = 0;
  for (const k in H.mem || {}) { const m = H.mem[k]; if (dist(m[0], m[1], x, y) < r) { n += m[2]; sx += m[0] * m[2]; sy += m[1] * m[2]; } }
  return { n, x: n ? sx / n : x, y: n ? sy / n : y };
}
// 各滩头登陆之敌（守方判断主攻方向）：上岸的与靠近滩头的
function hqBeachForce(H) {
  return TER.beaches.map((b, i) => {
    const E = typeof cmdExit === 'function' ? cmdExit(i) : { x: b.cx, y: coastAt(b.cx) - 50 };
    let n = hqMemNear(H, E.x, E.y + 60, 520).n;
    for (const s of S.ships) if (alive(s) && s.land && s.bx != null && s.bx >= b.x0 - 40 && s.bx <= b.x1 + 40 && (s.state === 'move' || s.state === 'unloading') && spotted(s.x, s.y)) n += ((s.load && s.load.teams) || 0) * 2 + (((s.load && s.load.veh) || []).length * 6);
    return { i, b, E, n };
  });
}

// ———————————————— 司令：编成 ————————————————
// 把一批兵力（连、车）按位置聚成若干团：相距 350 以内连成一片，一片太大就按横向位置切开（每团至多 4 个连、8 辆车）
function hqCluster(items) {
  const par = items.map((_, i) => i), f = i => par[i] === i ? i : (par[i] = f(par[i]));
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) if (dist(items[i].x, items[i].y, items[j].x, items[j].y) < HQ.link) par[f(i)] = f(j);
  const m = new Map();
  items.forEach((o, i) => { const r = f(i); if (!m.has(r)) m.set(r, []); m.get(r).push(o); });
  const out = [];
  for (const g of m.values()) {
    const nu = g.filter(o => o.u).length, nv = g.filter(o => o.v).length, k = Math.max(1, Math.ceil(nu / HQ.maxU), Math.ceil(nv / HQ.maxV));
    g.sort((a, b) => a.x - b.x);
    for (let i = 0; i < k; i++) out.push(g.slice(Math.round(i * g.length / k), Math.round((i + 1) * g.length / k)));
  }
  // 太小的（一个连、一两辆车）并进最近的团
  const big = out.filter(g => g.filter(o => o.u).length >= 2 || g.filter(o => o.v).length >= 3 || (g.some(o => o.u) && g.some(o => o.v)));
  const small = out.filter(g => !big.includes(g));
  const cen = g => ({ x: g.reduce((a, o) => a + o.x, 0) / g.length, y: g.reduce((a, o) => a + o.y, 0) / g.length });
  for (const g of small) {
    const c = cen(g), t = big.slice().sort((a, b) => dist(cen(a).x, cen(a).y, c.x, c.y) - dist(cen(b).x, cen(b).y, c.x, c.y))[0];
    if (t && dist(cen(t).x, cen(t).y, c.x, c.y) < 1200) t.push(...g); else big.push(g);
  }
  return big.filter(g => g.length);
}
// 守方机动兵力：预备队、反击连（不含据点守备、伏击组、101 空降师、机场防御）与机动车辆
function hqPoolE() {
  const us = S.units.filter(u => u.side === 'e' && u.kind === 'inf' && (u.role === 'reserve' || u.role === 'bg') && !u.a101 && u.state !== 'rout' && teamsOf(u).some(q => q.men.length && !q.ride && !q.afG && !q.raid) &&
    !(S.bgs || []).some(G => !G.dead && G.us.includes(u.id)));
  const vs = (S.veh || []).filter(v => v.side === 'e' && !v.dead && !v.fixed && !v.afD && !v.a101 && v.auto !== false && !v.lst && v.bgG == null && !(v.mod && v.mod.cram) && isLand(v.x, v.y) && !v.immob);
  return { us, vs };
}
function hqPoolP(B, x, y, r) {
  const P = typeof apEnsure === 'function' ? apEnsure() : { u: {} };
  const us = S.units.filter(u => {
    if (u.side !== 'p' || u.kind !== 'inf' || u.auto !== true || u.state === 'rout' || u.x == null || !isLand(u.x, u.y) || dist(u.x, u.y, x, y) > r) return false;
    const pl = P.u[u.id], ts = teamsOf(u).filter(q => q.men.length && !q.ride);
    if (!pl || pl.ph === 'bg' || pl.ph === 'supply' || ts.reduce((a, q) => a + q.men.length, 0) < 4) return false;
    if (pl.ph === 'garrison' && ts.length < 2) return false;
    return !(S.bgs || []).some(G => !G.dead && G.us.includes(u.id));
  });
  const vs = (S.veh || []).filter(v => v.side === 'p' && !v.dead && v.auto && !v.man && !v.lst && !v.swim && v.bgG == null && isLand(v.x, v.y) && v.ai !== 'repair' && !v.immob && dist(v.x, v.y, x, y) < r);
  return { us, vs };
}
// 攻方留守：据点上留一个组警戒（与 brain.js 一致），其余编走
function hqKeepGuard(u) {
  const P = apEnsure(), pl = P.u[u.id];
  if (!pl || pl.ph !== 'garrison') return;
  const gp = apPt(pl.obj), ts = teamsOf(u).filter(q => q.men.length && !q.ride);
  if (!gp || ts.length < 2) return;
  ts.sort((a, b) => dist(a.x, a.y, gp.x, gp.y) - dist(b.x, b.y, gp.x, gp.y));
  const k = addUnit('p', 'inf', { ship: `${u.ship || ''}警戒分队`, auto: true, form: 'line', face: u.face, morale: u.morale });
  ts[0].u = k.id;
  P.u[k.id] = { ph: 'garrison', obj: gp.key, next: S.t + 1, garT: S.t };
  indexUnits();
}
function hqMakeRegs(side, B, us, vs) {
  const items = [...us.map(u => ({ u, x: u.x, y: u.y })), ...vs.map(v => ({ v, x: v.x, y: v.y }))];
  const made = [];
  for (const g of hqCluster(items)) {
    const gu = g.filter(o => o.u).map(o => o.u), gv = g.filter(o => o.v).map(o => o.v);
    if (!gu.length && gv.length < 2) continue;
    const c = { x: g.reduce((a, o) => a + o.x, 0) / g.length, y: g.reduce((a, o) => a + o.y, 0) / g.length }, at = hqSlot(side, c.x, c.y);
    made.push(hqNewReg(side, B, gu, gv, at));
  }
  return made;
}
function hqNewBde(side, no, name, role, home) {
  const B = { id: S.nid++, side, no, name, role, regs: [], ord: null, ordT: -99, home: home ? { x: Math.round(home.x), y: Math.round(home.y) } : null };
  S.hq[side].bdes.push(B);
  return B;
}
// 下命令（一个旅一条；同样的命令不重复下）
function hqOrder(side, B, ord, text, force) {
  const k = JSON.stringify([ord.v, ord.objs, ord.lead, ord.at && [Math.round(ord.at.x / 80), Math.round(ord.at.y / 80)]]);
  if (B.ordK === k || (!force && S.t - (B.ordT ?? -99) < 40)) return false;   // 命令下了至少执行 40 秒，不朝令夕改
  B.ordK = k; B.ord = { i: 0, ...ord }; B.ordT = S.t; B.atkK = null; B.pass = null; B.goT = null;
  if (text) hqSay(side, B, text, hqObj(B) || ord.at);
  return true;
}
const hqNames = ks => ks.map(k => (hqPt(k) || {}).name).filter(Boolean).join('、');

// ———————————————— 司令（守方）————————————————
const HQ_TAC_E = {
  bal: { nm: '纵深防御、机动反击', d: '滩头守备部队依托工事迟滞消耗，机动旅隐蔽待机；判明敌主攻方向后，集中机动旅向敌主攻滩头出口反冲击，趁敌立足未稳把登陆场压回海里' },
  armor: { nm: '装甲机动防御', d: '前沿只留守备部队，装甲旅集中隐蔽；敌主力上陆后，装甲旅从侧翼集中实施反突击' },
  fort: { nm: '要塞固守、逐次反击', d: '各滩头依托防御地带固守，机动兵力就近加强受威胁最大的滩头，只打局部反冲击' },
  deep: { nm: '诱敌深入、两翼合围', d: '前沿轻兵迟滞，放敌上岸、拉长补给线；敌突入纵深后，两个机动旅从两翼合围反击' }
};
function hqTacE(H) {
  let sty = S.sbx && S.sbx.aiSty ? S.sbx.aiSty.e : null;   // AI 部署的按部署方案；玩家自己部署的按兵力结构判断
  const pool = hqRegs('e'), pw = pool.reduce((a, G) => a + hqRegPow(G).tot, 0), vw = pool.reduce((a, G) => a + hqRegPow(G).veh, 0);
  if (!HQ_TAC_E[sty]) sty = null;
  if (!sty) sty = pool.length <= 1 && pw < 60 ? 'fort' : vw >= pw * .55 ? 'armor' : 'bal';
  if (sty === 'air') sty = 'bal';
  if (sty === 'deep' && hqRegs('e').length < 2) sty = 'bal';
  return sty;
}
function hqOrgE(H) {
  const { us, vs } = hqPoolE();
  if (!us.length && !vs.length) { H.live = true; H.tac = { k: 'fort', ...HQ_TAC_E.fort }; return; }
  // 机动兵力按地域编团，再按东西向分成一到三个旅
  const tmp = hqNewBde('e', 0, '机动旅', 'mobile', null), regs = hqMakeRegs('e', tmp, us, vs);
  S.hq.e.bdes = S.hq.e.bdes.filter(B => B !== tmp);
  const nb = regs.length >= 7 ? 3 : regs.length >= 4 ? 2 : 1;
  regs.sort((a, b) => a.ax - b.ax);
  for (let k = 0; k < nb; k++) {
    const part = regs.slice(Math.round(k * regs.length / nb), Math.round((k + 1) * regs.length / nb));
    if (!part.length) continue;
    const arm = part.reduce((a, G) => a + hqRegPow(G).veh, 0) >= part.reduce((a, G) => a + hqRegPow(G).tot, 0) * .55;
    const c = { x: part.reduce((a, G) => a + G.ax, 0) / part.length, y: part.reduce((a, G) => a + G.ay, 0) / part.length };
    const B = hqNewBde('e', k + 1, `${arm ? '装甲' : '机动'}第${k + 1}旅`, 'mobile', c);
    part.forEach((G, i) => { G.bde = B.id; G.name = `${B.no}旅${i + 1}团`; B.regs.push(G.id); });
    B.rn = part.length;
  }
  H.live = true;
  const k = hqTacE(H);
  H.tac = { k, ...HQ_TAC_E[k], t: S.t };
  hqSay('e', null, `本次作战采取「${H.tac.nm}」：${H.tac.d}。`);
  for (const B of H.bdes) {
    const P = hqNearPt('e', B.home, p => !/^E\d/.test(p.key)) || hqPt('HQ');
    if (!P) continue;
    if (k === 'fort') {   // 就近加强最要紧的滩头出口
      const E = hqNearPt('e', B.home, p => /^E\d/.test(p.key)) || P;
      hqOrder('e', B, { v: 'defend', objs: [E.key] }, `占领${E.name}后方阵地，加强${E.name}防御，严防敌突破。`);
    } else hqOrder('e', B, { v: 'reserve', objs: [P.key], at: B.home }, `在${P.name}一带隐蔽待机，判明敌主攻方向后听令反冲击。`);
  }
}
function hqNearPt(side, at, f) {
  if (!at) return null;
  return S.points.filter(p => hqMine(side, p) && (!f || f(p))).sort((a, b) => dist(a.x, a.y, at.x, at.y) - dist(b.x, b.y, at.x, at.y))[0] || null;
}
function hqCmdE(H) {
  hqIntel(H, 'e');
  const bf = hqBeachForce(H).sort((a, b) => b.n - a.n), top = bf[0], sec = bf[1];
  const tac = H.tac.k, mob = H.bdes.filter(B => hqRegs('e', B).length);
  // ① 判明主攻方向：某滩头之敌明显多于其他（或已上陆两成以上），一旦判明就定下来；只有别处之敌超过它 2.5 倍、持续 60 秒才改判
  if (top && top.n >= 12) {
    if (H.main == null) {
      if (top.n >= 30 || top.n >= (sec ? sec.n : 0) * 1.6 || S.t > 240) { H.main = top.i; H.mainT = S.t; H.mainN = top.n; }
    } else if (top.i !== H.main) {
      const cur = bf.find(o => o.i === H.main);
      if (top.n > (cur ? cur.n : 0) * 2.5 + 10) { H.swT = H.swT ?? S.t; if (S.t - H.swT > 60) { H.main = top.i; H.mainT = S.t; H.swT = null; H.reMain = true; } } else H.swT = null;
    } else H.swT = null;
  }
  if (H.main == null) return;
  const M = bf.find(o => o.i === H.main), E = M.E, exitPt = hqPt(E.key) || hqNearPt('e', E, () => true);
  if (!exitPt) return;
  const sorted = mob.slice().sort((a, b) => dist(hqBdeAt(a).x, hqBdeAt(a).y, E.x, E.y) - dist(hqBdeAt(b).x, hqBdeAt(b).y, E.x, E.y));
  const bn = cmdBN(H.main);
  // ② 按战术给机动旅下反冲击 / 加强防御的命令（每个旅只在决心变化时下令）
  const enemyIn = hqMemNear(H, exitPt.x, exitPt.y - 150, 400).n;   // 已突入出口以北纵深的敌人
  for (const [k, B] of sorted.entries()) {
    const pw = hqRegs('e', B).reduce((a, G) => a + hqRegPow(G).tot, 0), p0 = B.p0 || (B.p0 = pw);
    if (B.spent) continue;
    if (pw < p0 * .35) {   // 打残了：转入防御，不再派反冲击
      const P = hqNearPt('e', hqBdeAt(B), () => true);
      if (P) { B.spent = S.t; hqOrder('e', B, { v: 'defend', objs: [P.key] }, `伤亡过大，残部撤至${P.name}转入防御。`, true); }
      continue;
    }
    if (B.ord && B.ord.v === 'counter' && !B.ord.done && !H.reMain) continue;   // 反冲击既定，不改
    if (B.ord && B.ord.v === 'counter' && B.ord.done) {
      const th = hqThreat('e', exitPt);
      hqOrder('e', B, { v: 'defend', objs: [exitPt.key], face: th }, `${exitPt.name}已夺回，就地转入防御，巩固${bn}滩头阵地。`);
      continue;
    }
    if (tac === 'fort') {
      if (k === 0) hqOrder('e', B, { v: 'defend', objs: [exitPt.key] }, `敌主攻${bn}。加强${exitPt.name}防御，以局部反冲击消灭突入之敌。`);
      continue;
    }
    if (tac === 'deep' && enemyIn < 25 && !hqMine('p', exitPt) && S.t - H.mainT < 300) {   // 诱敌深入：敌还没突入纵深，两翼旅在出口两侧待机
      const side = (k % 2 ? 1 : -1), at = hqSlot('e', exitPt.x + side * 520, exitPt.y - 280);
      hqOrder('e', B, { v: 'reserve', objs: [exitPt.key], at }, `敌主攻${bn}。在${hqWhere(at.x, at.y)}隐蔽待机，放敌突入后从${side > 0 ? '东' : '西'}翼合围。`);
      continue;
    }
    if (k === 0 || tac === 'armor' || tac === 'deep' || (k === 1 && mob.length >= 3)) {
      const via = tac === 'deep' || (tac === 'armor' && k > 0) ? (k % 2 ? '东' : '西') + '翼' : '';
      hqOrder('e', B, { v: 'counter', objs: [exitPt.key] }, `敌主攻${bn}。${via ? `从${via}` : ''}向${exitPt.name}反冲击，歼灭登陆之敌，恢复滩头阵地。`);
    } else {
      const L = sorted[0];
      hqOrder('e', B, { v: 'follow', objs: [exitPt.key], lead: L.id }, `作为第二梯队，跟进${L.name}，准备投入${exitPt.name}方向。`);
    }
  }
  H.reMain = false;
}

// ———————————————— 司令（攻方，观战时）————————————————
const HQ_TAC_P = {
  main: { nm: '中央突破', d: '集中主力于一处滩头抢滩，夺取滩头出口后沿主要方向向纵深发展，直取指挥所' },
  feint: { nm: '声东击西', d: '以一部在别处滩头佯动登陆、牵制守军，主力在主攻滩头抢滩突破，向纵深发展' },
  pincer: { nm: '两翼钳击', d: '两个旅在相邻两处滩头同时抢滩，夺取出口后向指挥所会攻' }
};
function hqOrgP(H) {
  const C = S.cmd && S.cmd.p, pl = C && C.plan;
  if (!pl || pl.main < 0) return;
  const b = TER.beaches[pl.main], E = cmdExit(pl.main);
  const k = pl.wide != null ? 'pincer' : pl.feint >= 0 ? 'feint' : 'main';
  H.tac = { k, ...HQ_TAC_P[k], t: S.t };
  H.live = true;
  const home = i => ({ x: TER.beaches[i].cx, y: Math.min(STAGING_Y, coastAt(TER.beaches[i].cx) + 380) });
  const B1 = hqNewBde('p', 1, '第1旅', 'main', home(pl.main)); B1.beach = pl.main;
  hqSay('p', null, `本次作战采取「${H.tac.nm}」：${H.tac.d}。`);
  const axis = cmdAxis(E).filter(k => k !== E.key);
  hqOrder('p', B1, { v: 'attack', objs: [E.key, ...axis] }, `主攻${cmdBN(pl.main)}：抢滩夺取${E.name}，尔后经${hqNames(axis) || '纵深'}向前发展进攻。`);
  if (pl.wide != null) {
    const B2 = hqNewBde('p', 2, '第2旅', 'main', home(pl.wide)); B2.beach = pl.wide;
    const E2 = cmdExit(pl.wide);
    hqOrder('p', B2, { v: 'attack', objs: [E2.key, ...axis.slice(-1)] }, `在${cmdBN(pl.wide)}同时抢滩，夺取${E2.name}后与第1旅会攻${hqNames(axis.slice(-1)) || '指挥所'}。`);
  }
  if (pl.feint >= 0) {
    const B3 = hqNewBde('p', H.bdes.length + 1, `第${H.bdes.length + 1}旅`, 'feint', home(pl.feint)); B3.beach = pl.feint;
    const F = cmdExit(pl.feint);
    hqOrder('p', B3, { v: 'feint', objs: [F.key] }, `在${cmdBN(pl.feint)}佯动登陆，牵制当面守军，掩护第1旅主攻。`);
  }
}
function hqCmdP(H) {
  hqIntel(H, 'p');
  for (const B of H.bdes) {
    if (B.beach == null) continue;
    const E = cmdExit(B.beach);
    // 编团：滩头出口已拿下（或上陆满 90 秒），把滩头一带的连与车编成团；后上来的再编新团
    const ashore = hqPoolP(B, E.x, E.y, 650);
    const ok = hqMine('p', hqPt(E.key)) || (S.t - (B.ordT || 0) > 150 && ashore.us.length >= 3);
    if (ok && S.t - (B.formT ?? -99) > 12 && (ashore.us.length >= 2 || (ashore.us.length >= 1 && ashore.vs.length >= 3) || (ashore.vs.length >= 4 && hqRegs('p', B).length))) {
      B.formT = S.t;
      ashore.us.forEach(hqKeepGuard);
      const us = ashore.us.slice(0, 8), vs = ashore.vs.slice(0, 12);
      const R = hqRegs('p', B).filter(G => bgUnits(G).length < 3 && dist(G.ax, G.ay, E.x, E.y) < 900);
      if (R.length && us.length <= 1) hqTake(R[0], us, vs);
      else hqMakeRegs('p', B, us, vs);
    }
    // 佯攻旅出口拿下、兵力尚可：转入助攻，向主攻旅的下一个目标会攻
    const L = H.bdes.find(o => o.role === 'main' && o !== B);
    if (B.role === 'feint' && B.ord && B.ord.v === 'feint' && hqMine('p', hqPt(E.key)) && hqRegs('p', B).length && L && hqObj(L)) {
      const T = hqObj(L);
      hqOrder('p', B, { v: 'attack', objs: [T.key] }, `佯攻得手，转入助攻：向${T.name}攻击，与${L.name}会攻。`);
    }
    // 主攻旅打到头：巩固
    if (B.ord && B.ord.done && B.ord.v === 'attack' && !B.consSaid) {
      B.consSaid = true;
      const P = hqObj(B);
      if (P) hqSay('p', B, `已夺取${P.name}，就地转入防御，巩固既得阵地，严防反冲击。`, P);
    }
  }
}

// 开战后新出现的守方机动兵力（增援波次、弃车乘员、隔河归建的连）：就近补进没满编的团；附近没有就凑够了另编一个团，归最近的旅
function hqLate(H) {
  const { us, vs } = hqPoolE(), rest = { us: [], vs: [] };
  const live = hqRegs('e').filter(G => { const B = hqBdeOf(G); return B && !B.spent; });
  for (const o of [...us.map(u => ({ u })), ...vs.map(v => ({ v }))]) {
    const m = o.u || o.v, G = live.filter(G => dist(G.ax, G.ay, m.x, m.y) < 900 && (o.u ? bgUnits(G).length < HQ.maxU : bgVehs(G).length < HQ.maxV)).sort((a, b) => dist(a.ax, a.ay, m.x, m.y) - dist(b.ax, b.ay, m.x, m.y))[0];
    if (G) hqTake(G, o.u ? [o.u] : [], o.v ? [o.v] : []); else (o.u ? rest.us : rest.vs).push(m);
  }
  if (rest.us.length >= 2 || rest.vs.length >= 3) {
    const c = [...rest.us, ...rest.vs][0], B = H.bdes.filter(B => !B.spent).sort((a, b) => { const A = hqBdeAt(a) || a.home, Bc = hqBdeAt(b) || b.home; return dist(A.x, A.y, c.x, c.y) - dist(Bc.x, Bc.y, c.x, c.y); })[0];
    if (B) hqMakeRegs('e', B, rest.us, rest.vs);
  }
}

// ———————————————— 主循环 ————————————————
function hqInit() {
  if (!S || S.hq) return;
  S.hq = { on: true, e: { bdes: [], n: 0, mem: {}, main: null, live: false, thT: HQ.orgT }, p: { bdes: [], n: 0, mem: {}, live: false, thT: HQ.orgT } };
  S.v7off = { ...(S.v7off || {}), br: true };   // 旧的零散调兵（brain.js）让位给指挥体系
}
function hqStep(dt) {
  if (!S || S.phase !== 'battle' || S.over || !S.hq || !S.hq.on) return;
  for (const side of ['e', 'p']) {
    const H = S.hq[side];
    if (side === 'p' && S.role !== 'spectate') continue;   // 玩家指挥攻方时攻方不设 AI 司令
    if ((H.thT -= dt) > 0) continue;
    H.thT = HQ.think;
    try {
      if (!H.live) { if (side === 'e') hqOrgE(H); else hqOrgP(H); continue; }
      if (side === 'e') {
        hqCmdE(H);
        // 开战后新出现的机动兵力（增援波次、乘员弃车）：编进最近的旅
        if (S.t - (H.lateT ?? 0) > 20) { H.lateT = S.t; hqLate(H); }
      } else hqCmdP(H);
      for (const B of H.bdes) hqBdeThink(B);
    } catch (e) { if (!HQ.err) { HQ.err = 1; console.error('hq', e); } }
  }
}
HOOK.newGame.push(() => { if (S) S.hq = null; });
HOOK.step.push(dt => { if (S && S.phase === 'battle' && !S.hq && !(S.v7off && S.v7off.hq)) hqInit(); hqStep(dt); });
// 守方炮兵火力：反冲击的火力准备优先（ai4.js a4Focus 调用）
function hqFocus() {
  if (!hqSideOn('e')) return null;
  const R = hqRegs('e').filter(G => G.fireReq && S.t - G.fireReq.t < 40 && (G.st === 'deploy' || G.st === 'assault'))[0];
  if (R) return { x: R.fireReq.x, y: R.fireReq.y, r: 90 };
  const F = hqRegs('e').filter(G => G.st === 'assault' || G.st === 'hold' || G.st === 'local').map(G => ({ G, f: hqFoe('e', G.ax, G.ay, 330) })).filter(o => o.f.n >= 5).sort((a, b) => b.f.n - a.f.n)[0];
  return F ? { x: F.f.x, y: F.f.y, r: 80 } : null;
}

// ———————————————— 画面：旅的作战箭头 ————————————————
// 进攻 / 反冲击：实心箭头，从旅的位置经攻击出发位置指向当前目标，再细一档指向后续目标；佯攻：虚线空心箭头；
// 跟进：细虚线箭头；防御：目标前方的防御线（齿朝敌）；待机：集结地域虚线椭圆。箭尾写旅名与任务，目标处小旗
const HQ_VERB = { attack: '进攻', counter: '反冲击', feint: '佯攻', defend: '防御', block: '阻击', reserve: '待机', follow: '跟进' };
function hqArrow(ctx, pts, w, fill, stroke, dash) {
  if (pts.length < 2) return;
  // 平滑：二次贝塞尔中点法
  const P = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) { const a = pts[i - 1], b = pts[i], c = pts[i + 1]; P.push([lerp(a[0], b[0], .75), lerp(a[1], b[1], .75)], b, [lerp(b[0], c[0], .25), lerp(b[1], c[1], .25)]); }
  P.push(pts[pts.length - 1]);
  const S2 = [];
  for (let i = 0; i < P.length - 1; i++) { const n = Math.max(2, Math.ceil(dist(P[i][0], P[i][1], P[i + 1][0], P[i + 1][1]) / 40)); for (let k = 0; k < n; k++) S2.push([lerp(P[i][0], P[i + 1][0], k / n), lerp(P[i][1], P[i + 1][1], k / n)]); }
  S2.push(P[P.length - 1]);
  if (typeof cmdArrow !== 'function') return;
  ctx.setLineDash(dash || []);
  cmdArrow(ctx, S2, w, .6);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
  ctx.setLineDash([]);
}
function hqLabel(ctx, x, y, text, col, a) {
  ctx.font = font(12); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width + px(10), h = px(17);
  ctx.fillStyle = rgba(COL.bg, .78 * a); ctx.fillRect(x - w / 2, y - h / 2, w, h);
  ctx.strokeStyle = rgba(col, .8 * a); ctx.lineWidth = px(1); ctx.strokeRect(x - w / 2, y - h / 2, w, h);
  ctx.fillStyle = rgba(col, a); ctx.fillText(text, x, y + px(.5));
}
function hqDraw() {
  if (!hqOn() || typeof R === 'undefined' || !R.ctx || (typeof V3 === 'object' && V3.drawing && false)) return;
  const ctx = R.ctx, zr = typeof CAM === 'object' && CAM.fit ? CAM.z / CAM.fit : 1, A0 = clamp(1.25 - zr / 7, .3, 1);
  const spec = S.role === 'spectate' || R.eye === 'all' || R.eye === 'both' || R.eye === 'e';
  ctx.save(); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  for (const side of ['p', 'e']) {
    const H = S.hq[side];
    if (!H || !H.live) continue;
    if (side === 'e' && !spec) continue;
    if (side === 'p' && S.role !== 'spectate') continue;
    const col = side === 'p' ? COL.g : COL.enemy;
    for (const B of H.bdes) {
      const O = B.ord, P = hqObj(B);
      if (!O || !P) continue;
      const c = hqBdeAt(B);
      if (!c) continue;
      const Rs = hqRegs(side, B), pw = Rs.reduce((a, G) => a + hqRegPow(G).tot, 0), w = Math.max(px(11), clamp(20 + pw * .12, 26, 50)), a = A0;
      const tag = `${B.name}·${HQ_VERB[O.v] || ''}`;
      if (O.v === 'attack' || O.v === 'counter' || O.v === 'feint') {
        const rest = (O.objs || []).slice((O.i || 0) + 1).map(hqPt).filter(Boolean);
        const pts = [[c.x, c.y]];
        if (B.beach != null && !Rs.length) { const b = TER.beaches[B.beach]; pts.push([b.cx, coastAt(b.cx) + 30]); }   // 还在海上：经滩头
        else if (B.atk && dist(B.atk.x, B.atk.y, c.x, c.y) > 120 && dist(B.atk.x, B.atk.y, P.x, P.y) > 120) pts.push([B.atk.x, B.atk.y]);
        const d = dist(pts[pts.length - 1][0], pts[pts.length - 1][1], P.x, P.y), u = d > w * 3 ? 1 - w * 1.4 / d : .7;
        pts.push([lerp(pts[pts.length - 1][0], P.x, u), lerp(pts[pts.length - 1][1], P.y, u)]);
        const feint = O.v === 'feint', go = O.v !== 'feint' && Rs.some(G => G.st === 'assault');
        ctx.lineWidth = px(feint ? 1.6 : 2.2);
        hqArrow(ctx, pts, feint ? w * .7 : w, feint ? rgba(col, .08 * a) : rgba(col, (go ? .42 : .28) * a), rgba(col, a), feint ? [px(8), px(6)] : null);
        // 后续目标：细一档的虚线箭头接着画
        if (rest.length) {
          const q = [[P.x, P.y], ...rest.map(o => [o.x, o.y])], L = q.length - 1, dd = dist(q[L - 1][0], q[L - 1][1], q[L][0], q[L][1]);
          q[L] = [lerp(q[L - 1][0], q[L][0], dd > 90 ? 1 - 60 / dd : .7), lerp(q[L - 1][1], q[L][1], dd > 90 ? 1 - 60 / dd : .7)];
          ctx.lineWidth = px(1.1); hqArrow(ctx, q, w * .55, null, rgba(col, .45 * a), [px(5), px(5)]);
        }
        hqFlag(ctx, P.x, P.y, col, a);
        hqLabel(ctx, c.x, c.y + (side === 'p' ? 1 : -1) * (w + px(14)), tag, col, a);
      } else if (O.v === 'defend' || O.v === 'block') {
        const th = O.face ?? hqThreat(side, P), lx = -Math.sin(th), ly = Math.cos(th), L = 120 + Rs.length * 70, cx = P.x + Math.cos(th) * 75, cy = P.y + Math.sin(th) * 75;
        ctx.strokeStyle = rgba(col, .85 * a); ctx.lineWidth = px(2.4);
        ctx.beginPath();
        for (let k = 0; k <= 16; k++) { const t = k / 16 - .5, bow = (1 - 4 * t * t) * 22, x = cx + lx * t * L + Math.cos(th) * bow, y = cy + ly * t * L + Math.sin(th) * bow; k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
        ctx.stroke();
        ctx.lineWidth = px(1.6);
        for (let k = 1; k < 8; k++) { const t = k / 8 - .5, bow = (1 - 4 * t * t) * 22, x = cx + lx * t * L + Math.cos(th) * bow, y = cy + ly * t * L + Math.sin(th) * bow; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(th) * 14, y + Math.sin(th) * 14); ctx.stroke(); }
        hqLabel(ctx, P.x - Math.cos(th) * 40, P.y - Math.sin(th) * 40, tag, col, a);
      } else {   // 待机 / 跟进：集结地域虚线椭圆，跟进再画一支细虚线箭头指向目标方向
        const r = 70 + Rs.length * 45;
        ctx.strokeStyle = rgba(col, .75 * a); ctx.lineWidth = px(1.5); ctx.setLineDash([px(6), px(5)]);
        ctx.beginPath(); ctx.ellipse(c.x, c.y, r, r * .62, 0, 0, 6.283); ctx.stroke(); ctx.setLineDash([]);
        if (O.v === 'follow') { const d = dist(c.x, c.y, P.x, P.y), e = d > 200 ? [lerp(c.x, P.x, (d - 160) / d), lerp(c.y, P.y, (d - 160) / d)] : null; if (e) { ctx.lineWidth = px(1.1); hqArrow(ctx, [[c.x, c.y], e], w * .5, null, rgba(col, .55 * a), [px(5), px(5)]); } }
        hqLabel(ctx, c.x, c.y, tag, col, a);
      }
    }
    // 团：北约式方框（步兵 ×、装甲椭圆、机步两者都有）+「III」，近看时显示团号
    for (const G of hqRegs(side)) {
      if (side === 'e' && !spec && !spotted(G.ax, G.ay)) continue;
      const w = px(20), h = px(13), x = G.ax, y = G.ay, t = G.type || 'inf';
      ctx.strokeStyle = rgba(col, .95 * Math.max(.6, A0)); ctx.fillStyle = rgba(COL.bg, .72); ctx.lineWidth = px(1.3);
      ctx.fillRect(x - w / 2, y - h / 2, w, h); ctx.strokeRect(x - w / 2, y - h / 2, w, h);
      ctx.beginPath();
      if (t !== 'armor') { ctx.moveTo(x - w / 2, y + h / 2); ctx.lineTo(x + w / 2, y - h / 2); ctx.moveTo(x - w / 2, y - h / 2); ctx.lineTo(x + w / 2, y + h / 2); }
      if (t !== 'inf') ctx.ellipse(x, y, w * .32, h * .3, 0, 0, 6.283);
      ctx.stroke();
      ctx.fillStyle = rgba(col, .95); ctx.font = font(9); ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.fillText('III', x, y - h / 2 - px(2.5));
      if (zr > 1.6) ctx.fillText(G.name, x, y + h / 2 + px(10));
    }
  }
  ctx.restore();
}
function hqFlag(ctx, x, y, col, a) {
  ctx.strokeStyle = rgba(col, .9 * a); ctx.fillStyle = rgba(col, .55 * a); ctx.lineWidth = px(1.4);
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - px(18)); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x, y - px(18)); ctx.lineTo(x + px(11), y - px(14)); ctx.lineTo(x, y - px(10)); ctx.closePath(); ctx.fill(); ctx.stroke();
}
HOOK.drawOver.push(hqDraw);
