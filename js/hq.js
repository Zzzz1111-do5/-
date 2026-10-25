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
// bound 跃进—掩护每一跃的距离
const HQ = { think: 3, orgT: 2, memT: 120, link: 350, maxU: 4, maxV: 8, attack: 340, follow: 420, firm: 90, bound: 90 };
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

// ———————————————— 通联：常规档只播双方司令的大战术 ————————————————
// hqBig：定下的战术与战术阶段的转换（判明主攻方向转入反击、夺取出口向纵深发展、转入巩固……），每个阶段一句，一局每方几句话；
// hqSay：司令对各旅的具体命令，只进通联详档（旅的去向看地图上的箭头与旅标）
function hqBig(side, key, text, at) {
  const H = S.hq[side];
  if (typeof chatSay !== 'function' || !H || (H.said || (H.said = {}))[key] != null) return;
  H.said[key] = S.t;
  chatSay(side, `司令：${text}`, { kind: 'plan', at: at || undefined, lv: 0, hq: true });
}
function hqSay(side, B, text, at) {
  if (typeof chatSay !== 'function') return;
  chatSay(side, `司令 → ${B ? B.name : '各旅'}：${text}`, { kind: 'order', at: at || (B && hqBdeAt(B)) || undefined, lv: 2, hq: true });
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
  // 战斗 / 防御 / 待机：按战法表的队形展开——各连、各坦克排按团的队形（横队 / 楔形 / 倒楔形 / 梯形）摆在正面上，
  //   坦克排内部也成队形（楔形、横队……）；坦克在步兵前（装甲先导）、与步兵交错、还是在后面火力掩护，按战法表
  const hold = mode === 'hold', res = mode === 'reserve', sp = 95 * (res ? .65 : D.wid), form = hold ? 'line' : res ? 'wedge' : D.form;
  const sorted = us.slice().sort((a, b) => lat(a) - lat(b));
  let fl = [];
  if (!hold && !res && G.flk && D.flank > 0 && sorted.length >= 3) {   // 迂回：最外侧一两个连从侧翼包抄
    const k = Math.max(1, Math.round(sorted.length * D.flank));
    fl = G.flk > 0 ? sorted.splice(sorted.length - k, k) : sorted.splice(0, k);
  }
  const nd = hold || sorted.length >= 4 ? Math.min(sorted.length - 1, Math.round(sorted.length * (hold ? D.depth : .2))) : 0;   // 二线（纵深）连
  const second = nd > 0 ? sorted.splice(Math.floor((sorted.length - nd) / 2), nd) : [];
  const n = sorted.length, half = (n - 1) / 2;
  const fX = (j, m, s) => {   // m 个分队里第 j 个在队形里的纵向位置（向前为正）
    const y = (j - (m - 1) / 2) * s, a = Math.abs(y);
    switch (form) {
      case 'wedge': return -a * .45;
      case 'vee': return a * .45 - (m - 1) / 2 * s * .45;
      case 'echL': return -j * 38;
      case 'echR': return -(m - 1 - j) * 38;
      default: return 0;
    }
  };
  const formX = j => fX(j, n, sp);
  // 跃进—掩护（冲击中）：分队按序号分成两组，一组前进时另一组停在原地（冻结在跃进开始时的位置）火力掩护，到位后互换、超越前进
  const BD = !hold && !res && G.st === 'assault' ? G.bnd : null;
  const putE = (m, k, x, y, g) => { const f = BD && g === BD.h && BD.ov[k + m.id]; if (f) out.push({ m, k, x: f[0], y: f[1], t: 'hold', g }); else { put(m, k, x, y); out[out.length - 1].g = g; } };
  sorted.forEach((u, j) => putE(u, 'u', formX(j), (j - half) * sp, j % 2));
  second.forEach((u, j) => put(u, 'u', -130, (j - (second.length - 1) / 2) * sp));
  const wid = Math.max(1, n) * sp;
  fl.forEach((u, j) => put(u, 'u', G.st === 'assault' ? 40 : -20, G.flk * (wid / 2 + 170 + j * 70)));
  // 步战车：跟在所属的连后面（下车步兵的火力支援），多出来的在二线
  const ifvL = ifv.slice().sort((a, b) => lat(a) - lat(b));
  sorted.forEach((u, j) => { const v = ifvL.shift(); if (v) putE(v, 'v', formX(j) - (hold ? 40 : 30), (j - half) * sp + 16, j % 2); });
  if (ifvL.length) row(ifvL, hold ? -60 : -50, wid * .8);
  // 坦克：三辆一排，排内成队形；各排按团的队形摆在正面上
  const pls = regPlatoonsG(G, tk, lat), np = pls.length, arm = D.arm;
  const tx = hold ? (arm === 'front' ? 25 : -55) : arm === 'front' ? 60 : arm === 'rear' ? -70 : 6;
  const pf = hold ? 'line' : res ? 'wedge' : G.st === 'assault' ? (form === 'echL' || form === 'echR' || form === 'line' ? form : 'wedge') : 'wedge';
  pls.forEach((pl, i) => {
    let cx, cy;
    if (arm === 'mixed' && !hold && n >= 2) { const g = (i % (n - 1)) + .5, r2 = Math.floor(i / (n - 1)); cx = (formX(Math.floor(g)) + formX(Math.ceil(g))) / 2 + tx - r2 * 45; cy = (g - half) * sp; }   // 步坦交错：坦克排插在两个连之间
    else { const ps = Math.max(80, np > 1 ? Math.max(wid, np * 80) / np : 0); cx = tx + fX(i, np, ps); cy = (i - (np - 1) / 2) * ps; }
    const off = regPltOff(pf, pl.length).sort((a, b) => a[1] - b[1]);
    pl.forEach((v, k) => putE(v, 'v', cx + off[k][0], cy + off[k][1], i % 2));
  });
  td.forEach((v, i) => put(v, 'v', hold ? -10 : 15, (i % 2 ? 1 : -1) * (wid / 2 + 40 + Math.floor(i / 2) * 25)));
  row(aa, -100, Math.min(140, aa.length * 40));
  row(art, -260, Math.min(100, art.length * 35));
  row(rest, -70, 60);
  return out;
}
// 坦克排固定编制：团里的坦克有增减才重新分排（G.plts 记各排车辆 id），各排按当前横向位置从左到右排
function regPlatoonsG(G, tk, lat) {
  const key = tk.map(v => v.id).sort((a, b) => a - b).join(',');
  if (G.pltK !== key) { G.pltK = key; G.plts = regPlatoons(tk, lat).map(pl => pl.map(v => v.id)); }
  const by = new Map(tk.map(v => [v.id, v])), pls = G.plts.map(ids => ids.map(id => by.get(id)).filter(Boolean)).filter(pl => pl.length);
  const ml = pl => pl.reduce((a, v) => a + lat(v), 0) / pl.length;
  return pls.sort((a, b) => ml(a) - ml(b));
}
// 坦克分排：按横向位置三辆一排（四辆以内一个排）
function regPlatoons(list, lat) {
  const L = list.slice().sort((a, b) => lat(a) - lat(b)), n = L.length, k = n <= 4 ? Math.min(1, n) : Math.round(n / 3);
  return Array.from({ length: k }, (_, i) => L.slice(Math.round(i * n / k), Math.round((i + 1) * n / k)));
}
// 排内队形（相对排中心，x 向前、y 向右）：楔形（排长车居中突前）、横队、倒楔形（两翼突前）、左 / 右梯形
function regPltOff(f, m) {
  return Array.from({ length: m }, (_, k) => {
    const r = Math.ceil(k / 2), s = k % 2 ? -1 : 1;
    switch (f) {
      case 'line': return [0, (k - (m - 1) / 2) * 26];
      case 'vee': return [r * 18 - 18, k ? s * r * 24 : 0];
      case 'echL': return [k * 16, -k * 24];
      case 'echR': return [k * 16, k * 24];
      default: return [-r * 18, k ? s * r * 24 : 0];
    }
  });
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
      // 队形整体移动：锚点在走时，目标放在槽位前方一小段、车速压到锚点的速度（落后就稍快追上，超前就放慢），整排匀速前进
      let x = s.x, y = s.y, cap = null;
      if (G.vel > 1.5 && t !== 'hold') {
        const fx2 = Math.cos(G.face), fy2 = Math.sin(G.face), lead = Math.min(40, G.vel * 3), ahead = (v.x - s.x) * fx2 + (v.y - s.y) * fy2, dS = dist(v.x, v.y, s.x, s.y);
        [x, y] = bgSnap(G, s.x + fx2 * lead, s.y + fy2 * lead, G.side === 'e' ? 'vehe' : 'veh');
        if (dS < 45) cap = ahead > 4 ? G.vel * .7 : ahead < -12 ? G.vel * 1.4 : G.vel * 1.05;
      }
      v.cmd = { x, y, t: t === 'amove' && v.type !== 'spg' && !hqAA(v) ? 'amove' : 'move', face: G.face, until: S.t + 4, ai: 'bg', cap: cap && Math.max(3, cap) };
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
function regSet(G, st, why) { if (G.st === st) return; G.st = st; G.stT = S.t; G.stWhy = why || null; G.bnd = null; }
const regUnitAt = u => { const ts = teamsOf(u).filter(q => q.men.length && !q.ride); return ts.length ? [ts.reduce((a, q) => a + q.x, 0) / ts.length, ts.reduce((a, q) => a + q.y, 0) / ts.length] : [u.x, u.y]; };
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
  if (T.k !== G.tk) { G.tk = T.k; if (G.st !== 'asm') regSet(G, 'move'); G.flk = 0; }
  const ax0 = G.ax, ay0 = G.ay;
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
        G.prepT = 0;
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
      // 跃进—掩护：两组分队交替，一组跃进 90 时另一组停在原地掩护；跃进的一组到位后互换（掩护组从原地出发、超越前进）
      let sl = regSlots(G, 'fight');
      if ((D.bound || near.n >= 3) && sl.some(s => s.g === 0) && sl.some(s => s.g === 1)) {   // 战法要求、或已与敌接触：跃进—掩护
        const Bd = G.bnd || (G.bnd = { h: 0, d: HQ.bound, t: S.t - 99, ov: {} });
        const mv = sl.filter(s => s.g != null && s.g !== Bd.h), lagM = mv.length ? bgLag(G, mv) : 0;
        if ((Bd.d >= HQ.bound && lagM < 35) || S.t - Bd.t > 35) {
          Bd.h ^= 1; Bd.d = 0; Bd.t = S.t; Bd.ov = {};
          for (const s of sl) if (s.g === Bd.h) Bd.ov[s.k + s.m.id] = s.k === 'u' ? regUnitAt(s.m) : [s.m.x, s.m.y];
          sl = regSlots(G, 'fight');
        }
      } else G.bnd = null;
      const lag = bgLag(G, sl.filter(s => s.t !== 'hold'));
      const go = r >= D.press || !near.n;
      if (go && lag < BG.lag * 1.4 && (!G.bnd || G.bnd.d < HQ.bound)) {
        const st = BG.pace * D.pace * (near.n ? .6 : 1), x0 = G.ax, y0 = G.ay, arrived = bgAdvance(G, gx, gy, st);
        if (G.bnd) G.bnd.d += dist(x0, y0, G.ax, G.ay);
        if (arrived || dist(G.ax, G.ay, gx, gy) < 40) regSet(G, p && !hqMine(G.side, p) ? 'clear' : 'hold', 'took');
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
  G.vel = Math.min(30, dist(ax0, ay0, G.ax, G.ay));   // 锚点这一秒走了多远：车辆按这个速度跟着走（regOrder），不跑到位就停、停了再走
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
// 编组（合成团）：先把步兵连按地域聚成团（每团两到四个连），再按兵种把车辆配属下去——
//   坦克：mix（合成）按各团步兵连数配坦克排（就近、三辆一排），步兵太少配不完的坦克另编装甲团；mass（装甲集中）坦克全部另编装甲团（每团至多九辆）；
//   步战车随步兵（按连数配）；防空车每团一辆（装甲团优先）；自行火炮编进最大的团（旅炮兵群）；反坦克车、侦察车等分给各团护侧翼。
//   一辆坦克都不落下；只有车辆没有步兵时全部编成装甲团
function hqMakeRegs(side, B, us, vs, mode = 'mix', quiet = false) {
  const T = vs.filter(hqTank), IFV = vs.filter(v => v.type === 'apc' || v.type === 'abv'), AA = vs.filter(hqAA), ART = vs.filter(v => v.type === 'spg');
  const OTH = vs.filter(v => !T.includes(v) && !IFV.includes(v) && !AA.includes(v) && !ART.includes(v));
  const cen = L => ({ x: L.reduce((a, o) => a + o.x, 0) / L.length, y: L.reduce((a, o) => a + o.y, 0) / L.length });
  const regs = (us.length ? hqCluster(us.map(u => ({ u, x: u.x, y: u.y }))) : []).map(g => ({ us: g.map(o => o.u), vs: [], arm: false }));
  for (const r of regs) r.c = cen(r.us);
  const nU = regs.reduce((a, r) => a + r.us.length, 0);
  // 就近按名额分配：所有（车, 团）按距离从近到远，团还有名额、车还没分就配给它
  const deal = (list, quota) => {
    const left = new Set(list), pairs = [];
    for (const v of list) regs.forEach((r, i) => { if (quota[i] > 0) pairs.push([dist(v.x, v.y, r.c.x, r.c.y), v, i]); });
    pairs.sort((a, b) => a[0] - b[0]);
    for (const [, v, i] of pairs) if (left.has(v) && quota[i] > 0) { regs[i].vs.push(v); quota[i]--; left.delete(v); }
    return [...left];
  };
  // 坦克
  let tLeft = T;
  if (mode !== 'mass' && regs.length) {
    const want = regs.map(r => Math.min(9, Math.round(T.length * r.us.length / Math.max(1, nU) / 3) * 3 || (T.length >= regs.length * 2 ? 3 : 0)));
    const cap = regs.map(r => Math.max(3, r.us.length * 3));   // 每个连至多配一个坦克排，多出来的另编装甲团
    tLeft = deal(T, want.map((w, i) => Math.min(w, cap[i])));
  }
  if (tLeft.length >= 3 || (!regs.length && tLeft.length)) {   // 装甲团：按地域聚，每团至多九辆
    const groups = hqCluster(tLeft.map(v => ({ v, x: v.x, y: v.y }))).flatMap(g => { const L = g.map(o => o.v), k = Math.ceil(L.length / 9); L.sort((a, b) => a.x - b.x); return Array.from({ length: k }, (_, i) => L.slice(Math.round(i * L.length / k), Math.round((i + 1) * L.length / k))); });
    for (const L of groups) { const r = { us: [], vs: L.slice(), arm: true }; r.c = cen(L); regs.push(r); }
    tLeft = [];
  }
  if (tLeft.length) deal(tLeft, regs.map(() => 99));   // 一两辆零散的：就近补进合成团
  if (!regs.length) return [];
  // 步战车：随步兵（每连两辆为限），装甲团各带两辆；配不完的就近
  const ifvQ = regs.map(r => r.arm ? 2 : r.us.length * 2), ifvL = deal(IFV, ifvQ);
  if (ifvL.length) deal(ifvL, regs.map(() => 99));
  // 防空车：每团一辆（装甲团优先），多的给车多的团
  const aaQ = regs.map(r => 1), order = regs.map((r, i) => i).sort((a, b) => (regs[b].arm - regs[a].arm) || regs[b].vs.length - regs[a].vs.length);
  for (const i of order.slice(AA.length)) aaQ[i] = 0;
  const aaL = deal(AA, aaQ);
  if (aaL.length) deal(aaL, regs.map(() => 99));
  // 自行火炮：编进最大的团（旅炮兵群，在团的后方 260 支援）
  if (ART.length) { const big = regs.slice().sort((a, b) => (b.us.length * 3 + b.vs.length) - (a.us.length * 3 + a.vs.length))[0]; big.vs.push(...ART); }
  // 其余车辆（反坦克车、侦察车、工程车）：平均分给各团
  const oL = deal(OTH, regs.map(() => Math.ceil(OTH.length / regs.length)));
  if (oL.length) deal(oL, regs.map(() => 99));
  const made = [];
  for (const r of regs) {
    if (!r.us.length && !r.vs.length) continue;
    const at = hqSlot(side, r.us.length ? r.c.x : cen(r.vs).x, r.us.length ? r.c.y : cen(r.vs).y);
    const G = hqNewReg(side, B, r.us, r.vs, at);
    G.arm = r.arm;
    made.push(G);
  }
  if (!quiet && made.length) hqSay(side, B, `编组——${made.map(hqOrgText).join('；')}。`);   // 编组情况进通联详档
  return made;
}
function hqOrgText(G) {
  const n = k => bgVehs(G).filter(k).length, t = n(hqTank), f = n(v => v.type === 'apc' || v.type === 'abv'), a = n(hqAA), g = n(v => v.type === 'spg'), u = bgUnits(G).length;
  return `${G.name}${G.arm ? '（装甲团）' : ''}：${[u && `步兵 ${u} 个连`, t && `坦克 ${t} 辆（${Math.max(1, Math.round(t / 3))} 个排）`, f && `步战车 ${f} 辆`, a && `防空车 ${a} 辆`, g && `自行火炮 ${g} 门`].filter(Boolean).join('、')}`;
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
// 战术按兵力结构定（AI 部署的按部署方案）：车辆占五成五以上装甲机动防御；机动兵力很少就要塞固守
function hqTacE(us, vs) {
  let sty = S.sbx && S.sbx.aiSty ? S.sbx.aiSty.e : null;   // AI 部署的按部署方案；玩家自己部署的按兵力结构判断
  const inf = us.reduce((a, u) => a + teamsOf(u).reduce((b, q) => b + q.men.length, 0), 0), vw = vs.reduce((a, v) => a + bgPow(v), 0), pw = inf + vw;
  if (!HQ_TAC_E[sty]) sty = null;
  if (!sty) sty = us.length + vs.length / 3 <= 3 && pw < 60 ? 'fort' : vw >= pw * .55 ? 'armor' : 'bal';
  if (sty === 'deep' && us.length + vs.length / 3 < 5) sty = 'bal';
  return sty;
}
// 守方司令编组：先定战术，再按战术编团、编旅——
//   纵深防御 / 要塞固守：合成团（坦克分到各团），按东西向地域编成一到三个机动旅（各管一片，就近反冲击）
//   装甲机动防御：坦克集中编成装甲团、组成一个装甲旅（集中使用打反突击），步兵团另编机步旅
//   诱敌深入：合成团分成东、西两个旅（两翼合围）
function hqOrgE(H) {
  const { us, vs } = hqPoolE();
  if (!us.length && !vs.length) { H.live = true; H.tac = { k: 'fort', ...HQ_TAC_E.fort }; H.doc = { ...CMD_BASE }; return; }
  // 司令战法（cmddoc.js，司令训练场训练出来的）：按机动兵力编成查表；训练场里由 S.cmdFix 指定
  const D = H.doc = S.cmdFix ? { ...CMD_BASE, ...S.cmdFix, key: 'fix' } : typeof cmdDocOf === 'function' ? cmdDocOf('e', cmdForceKey(us, vs)) : { ...CMD_BASE };
  let k = D.tac && HQ_TAC_E[D.tac] ? D.tac : hqTacE(us, vs);
  if (k === 'deep' && us.length + vs.length / 3 < 5) k = 'bal';
  H.tac = { k, ...HQ_TAC_E[k], t: S.t };
  const mass = k === 'armor' || !!D.mass;
  const tmp = hqNewBde('e', 0, '机动旅', 'mobile', null), regs = hqMakeRegs('e', tmp, us, vs, mass ? 'mass' : 'mix', true);
  S.hq.e.bdes = S.hq.e.bdes.filter(B => B !== tmp);
  const mkB = (part, no, nm) => {
    if (!part.length) return null;
    const c = { x: part.reduce((a, G) => a + G.ax, 0) / part.length, y: part.reduce((a, G) => a + G.ay, 0) / part.length };
    const B = hqNewBde('e', no, nm, 'mobile', c);
    part.forEach((G, i) => { G.bde = B.id; G.name = `${B.no}旅${i + 1}团`; B.regs.push(G.id); });
    B.rn = part.length;
    hqSay('e', B, `编组——${part.map(hqOrgText).join('；')}。`);
    return B;
  };
  regs.sort((a, b) => a.ax - b.ax);
  const split = (L, nb, nm0) => { for (let i = 0; i < nb; i++) mkB(L.slice(Math.round(i * L.length / nb), Math.round((i + 1) * L.length / nb)), H.bdes.length + 1, nm0(H.bdes.length + 1, i, nb)); };
  const nbAuto = n => Math.min(n, D.nb || (n >= 7 ? 3 : n >= 4 ? 2 : 1));
  if (mass && regs.some(G => G.arm)) {
    mkB(regs.filter(G => G.arm), 1, '装甲第1旅');
    const rest = regs.filter(G => !G.arm);
    split(rest, Math.min(rest.length, D.nb ? Math.max(1, D.nb - 1) : rest.length >= 5 ? 2 : 1), no => `合成第${no}旅`);
  } else if (k === 'deep' && regs.length >= 2) {
    split(regs, 2, (no, i) => `${i ? '东' : '西'}翼第${no}旅`);
  } else split(regs, nbAuto(regs.length), (no, i, nb) => { const L = regs.slice(Math.round(i * regs.length / nb), Math.round((i + 1) * regs.length / nb)); return `${L.every(G => G.arm) ? '装甲' : L.some(G => bgVehs(G).some(hqTank)) ? '合成' : '步兵'}第${no}旅`; });
  // 战役预备队：留离海最远（离指挥所最近）的一个旅不动，等第一次反击受挫或敌突入纵深才投入
  if (D.resv && H.bdes.length >= 2 && k !== 'deep') {
    const hp = hqPt('HQ') || { x: W / 2, y: 0 }, R0 = H.bdes.slice().sort((a, b) => dist(a.home.x, a.home.y, hp.x, hp.y) - dist(b.home.x, b.home.y, hp.x, hp.y))[0];
    R0.res = true; R0.name = R0.name.replace(/第(\d+)旅/, '预备第$1旅');
  }
  H.live = true;
  hqBig('e', 'tac', `本次作战采取「${H.tac.nm}」——${H.tac.d}。机动兵力编成${H.bdes.map(B => B.name).join('、')}。`);
  for (const B of H.bdes) {
    const P = hqNearPt('e', B.home, p => !/^E\d/.test(p.key)) || hqPt('HQ');
    if (!P) continue;
    if (k === 'fort') {   // 就近加强最要紧的滩头出口
      const E = hqNearPt('e', B.home, p => /^E\d/.test(p.key)) || P;
      hqOrder('e', B, { v: 'defend', objs: [E.key] }, `占领${E.name}后方阵地，加强${E.name}防御，严防敌突破。`);
    } else if (B.res) { const Q = hqPt('HQ') || P; hqOrder('e', B, { v: 'reserve', objs: [Q.key], at: B.home }, `作为战役预备队在${Q.name}一带隐蔽待机，没有命令不得投入。`); }
    else hqOrder('e', B, { v: 'reserve', objs: [P.key], at: B.home }, `在${P.name}一带隐蔽待机，判明敌主攻方向后听令反冲击。`);
  }
}
function hqNearPt(side, at, f) {
  if (!at) return null;
  return S.points.filter(p => hqMine(side, p) && (!f || f(p))).sort((a, b) => dist(a.x, a.y, at.x, at.y) - dist(b.x, b.y, at.x, at.y))[0] || null;
}
function hqCmdE(H) {
  hqIntel(H, 'e');
  const bf = hqBeachForce(H).sort((a, b) => b.n - a.n), top = bf[0], sec = bf[1];
  const tac = H.tac.k, mob = H.bdes.filter(B => hqRegs('e', B).length), D = H.doc || CMD_BASE, [dN, dR, dT] = CMD_DET[D.det] || CMD_DET.mid;
  // ① 判明主攻方向：某滩头之敌明显多于其他（或已上陆够多），一旦判明就定下来；只有别处之敌超过它 2.5 倍、持续 60 秒才改判（快慢按司令战法 det）
  if (top && top.n >= 12) {
    if (H.main == null) {
      if (top.n >= dN || top.n >= (sec ? sec.n : 0) * dR || S.t > dT) { H.main = top.i; H.mainT = S.t; H.mainN = top.n; }
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
  const enemyIn = hqMemNear(H, exitPt.x, exitPt.y - 150, 400).n;   // 已突入出口以北纵深的敌人
  for (const p of S.points) if (p.owner === 'p') (H.lostPt || (H.lostPt = {}))[p.key] = 1;
  // 大战术的阶段：判明主攻方向 → 按既定战术转入反击（诱敌深入先放敌突入，再两翼合围）
  const stage = { bal: `机动旅集中向${exitPt.name}反冲击，趁敌立足未稳压回海里`, armor: `装甲旅集中，从侧翼向${exitPt.name}反突击`, fort: `就近加强${exitPt.name}，以局部反冲击消灭突入之敌`,
    deep: `前沿迟滞、放敌突入，两翼旅在${exitPt.name}两侧待机合围` }[tac];
  if (H.said && H.said.main != null && H.said['main' + H.main] == null) hqBig('e', 'main' + H.main, `敌主攻方向改为${bn}。机动兵力转向${exitPt.name}：${stage}。`, exitPt);
  hqBig('e', 'main', `判明敌主攻${bn}。按「${H.tac.nm}」转入反击阶段：${stage}。`, exitPt);
  if (H.said) H.said['main' + H.main] = H.said['main' + H.main] ?? S.t;
  if (tac === 'deep' && (enemyIn >= 25 || hqMine('p', exitPt) || S.t - H.mainT >= 300)) hqBig('e', 'deep2', `敌已突入纵深。两翼旅同时出击，合围${exitPt.name}一带之敌。`, exitPt);
  if (mob.length && mob.every(B => B.spent)) hqBig('e', 'spent', '机动兵力伤亡过大，全线转入防御，依托既设阵地坚守。');
  // 战役预备队：第一梯队的反击受挫（打残或撤下来）、敌突入纵深、或反击打了四分钟还没拿下，才投入
  const front = sorted.filter(B => !B.res), resGo = sorted.some(B => B.res) && (front.every(B => B.spent || hqRegs('e', B).some(G => G.st === 'withdraw')) || enemyIn >= 40 || (S.t - H.mainT > 240 && hqMine('p', exitPt)));
  if (resGo) hqBig('e', 'resv', `第一梯队反击受挫、敌向纵深发展，投入战役预备队向${exitPt.name}反冲击。`, exitPt);
  // ② 按战术给机动旅下反冲击 / 加强防御的命令（每个旅只在决心变化时下令）
  let kk = -1;
  for (const B of sorted) {
    if (B.res && !resGo) continue;
    const k = B.res ? 0 : ++kk;   // 预备队投入时按第一梯队对待
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
      const back = H.lostPt && H.lostPt[exitPt.key] ? '已夺回' : '已稳住';   // 丢过才叫夺回
      hqOrder('e', B, { v: 'defend', objs: [exitPt.key], face: th }, `${exitPt.name}${back}，就地转入防御，巩固${bn}滩头阵地。`);
      hqBig('e', 'won' + exitPt.key, `${exitPt.name}${back}，反击告一段落：各旅就地转入防御，巩固${bn}滩头阵地。`, exitPt);
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
    if (k === 0 || tac === 'armor' || tac === 'deep' || D.ctr === 'all' || (k === 1 && mob.length >= 3 && D.ctr !== 'echelon')) {
      const via = tac === 'deep' || (tac === 'armor' && k > 0) ? (k % 2 ? '东' : '西') + '翼' : '';
      hqOrder('e', B, { v: 'counter', objs: [exitPt.key] }, `敌主攻${bn}。${via ? `从${via}` : ''}向${exitPt.name}反冲击，歼灭登陆之敌，恢复滩头阵地。`);
    } else {
      const L = front[0] || sorted[0];
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
  hqBig('p', 'tac', `本次作战采取「${H.tac.nm}」——${H.tac.d}。`);
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
    // 已经上岸、没编进团的坦克与车辆（后续梯队、离出口远的）：编进本旅最近的团，一辆都不落下
    const Rs = hqRegs('p', B);
    if (Rs.length && S.t - (B.lateT ?? -99) > 15) {
      B.lateT = S.t;
      for (const v of (S.veh || []).filter(v => v.side === 'p' && !v.dead && v.auto && !v.man && !v.lst && !v.swim && v.bgG == null && isLand(v.x, v.y) && v.ai !== 'repair' && !v.immob && dist(v.x, v.y, E.x, E.y) < 1400)) {
        if (H.bdes.some(o => o !== B && o.beach != null && dist(v.x, v.y, cmdExit(o.beach).x, cmdExit(o.beach).y) < dist(v.x, v.y, E.x, E.y))) continue;   // 离别的旅更近：归别的旅
        const G = Rs.slice().sort((a, b) => dist(a.ax, a.ay, v.x, v.y) - dist(b.ax, b.ay, v.x, v.y))[0];
        hqTake(G, [], [v]);
      }
    }
    // 佯攻旅出口拿下、兵力尚可：转入助攻，向主攻旅的下一个目标会攻
    const L = H.bdes.find(o => o.role === 'main' && o !== B);
    if (B.role === 'feint' && B.ord && B.ord.v === 'feint' && hqMine('p', hqPt(E.key)) && hqRegs('p', B).length && L && hqObj(L)) {
      const T = hqObj(L);
      hqOrder('p', B, { v: 'attack', objs: [T.key] }, `佯攻得手，转入助攻：向${T.name}攻击，与${L.name}会攻。`);
      hqBig('p', 'feint2', `佯攻滩头得手，佯攻部队转为助攻，与主攻部队会攻${T.name}。`, T);
    }
    // 主攻旅夺下滩头出口：转入向纵深发展的阶段
    if (B.role === 'main' && B.ord && B.ord.v === 'attack' && (B.ord.i || 0) >= 1 && !B.ord.done) { const T = hqObj(B); if (T) hqBig('p', 'depth', `滩头出口已拿下，转入纵深发展阶段：主力沿主要方向向${T.name}发展进攻。`, T); }
    // 主攻旅打到头：巩固
    if (B.ord && B.ord.done && B.ord.v === 'attack' && !B.consSaid) {
      B.consSaid = true;
      const P = hqObj(B);
      if (P) hqSay('p', B, `已夺取${P.name}，就地转入防御，巩固既得阵地，严防反冲击。`, P);
      if (P && B.role === 'main') hqBig('p', 'cons', `已夺取${P.name}，进攻目标达成：全线转入巩固，严防反冲击。`, P);
    }
  }
}

// 开战后新出现的守方机动兵力（增援波次、弃车乘员、隔河归建的连）：就近补进没满编的团；附近没有就凑够了另编一个团，归最近的旅
function hqLate(H) {
  const { us, vs } = hqPoolE(), rest = { us: [], vs: [] };
  const live = hqRegs('e').filter(G => { const B = hqBdeOf(G); return B && !B.spent; });
  for (const o of [...us.map(u => ({ u })), ...vs.map(v => ({ v }))]) {
    const m = o.u || o.v, by = (a, b) => dist(a.ax, a.ay, m.x, m.y) - dist(b.ax, b.ay, m.x, m.y);
    let G = live.filter(G => dist(G.ax, G.ay, m.x, m.y) < 900 && (o.u ? bgUnits(G).length < HQ.maxU : bgVehs(G).length < HQ.maxV + 4)).sort(by)[0];
    if (!G && o.v && hqTank(o.v)) G = live.slice().sort(by)[0];   // 坦克一辆都不落下：附近没有合适的团就编进最近的团
    if (G) hqTake(G, o.u ? [o.u] : [], o.v ? [o.v] : []); else (o.u ? rest.us : rest.vs).push(m);
  }
  if (rest.us.length >= 2 || rest.vs.length >= 3 || rest.vs.some(hqTank)) {
    const c = [...rest.us, ...rest.vs][0], B = H.bdes.filter(B => !B.spent).sort((a, b) => { const A = hqBdeAt(a) || a.home, Bc = hqBdeAt(b) || b.home; return dist(A.x, A.y, c.x, c.y) - dist(Bc.x, Bc.y, c.x, c.y); })[0];
    if (B) hqMakeRegs('e', B, rest.us, rest.vs);
  }
}

// ———————————————— 归属：每个兵都有建制（连 → 团 → 旅） ————————————————
// 编进机动团的连按团、旅；其余的也都有建制，不留散兵：
//   守方：据点守备、伏击组、民兵、警卫队按地段编守备团（某滩守备团 / 纵深守备团 / 机场守备营），统归「海防守备旅」；
//     碉堡、机枪巢、岸炮、炮兵、迫击炮、高炮、导弹发射车等阵地上的兵也归所在地段的守备团（炮兵、导弹阵地归「火力群」）；
//     第 101 空降师自成一个旅级单位；突击队（raider）归海防守备旅直属
//   攻方：没编进团的连（刚上岸的、留守据点的警戒分队、空降兵、弃车乘员）归登陆滩头所属旅的直属分队，编团时再编进团；
//     玩家指挥攻方时也按登陆滩头编成登陆旅（只是建制，不替玩家下命令）
//   没有连的散兵组（打散的、弃车乘员）编进就近的同方连队；附近没有就编成收容连
// 记在 u.org = { b 旅名, r 团名, k 'reg' 机动团 / 'gar' 守备 / 'att' 旅直属 / 'aux' 独立单位 }，阵地记在 e.org；每 2 秒刷新
function hqSector(x, y) {
  if (typeof eaBases === 'function' && eaBases().some(b => dist(b.x, b.y, x, y) < 700)) return { k: 'af', nm: '机场守备营' };
  const B = TER.beaches || [];
  let bi = -1, bd = 1e9;
  B.forEach((b, i) => { const d = Math.abs(clamp(x, b.x0, b.x1) - x) + Math.max(0, coastAt(clamp(x, 0, W - 1)) - y) * .8; if (d < bd) { bd = d; bi = i; } });
  return bi >= 0 && bd < 650 ? { k: 'b' + bi, nm: `${B[bi].name}守备团` } : { k: 'deep', nm: '纵深守备团' };
}
function hqAffil() {
  if (!S || !S.hq) return;
  // ① 散兵组：编进就近的同方连队（300 以内、同兵种）；附近没有就编成收容连
  let changed = false;
  for (const q of S.teams) {
    if (!q.men.length || q.ride || UNIT_MAP.get(q.u)) continue;
    const near = S.units.filter(u => u.side === q.side && u.kind === (q.kind === 'eng' ? 'eng' : 'inf') && u.state !== 'rout' && teamsOf(u).some(o => o.men.length)).map(u => [u, dist(u.x ?? q.x, u.y ?? q.y, q.x, q.y)]).sort((a, b) => a[1] - b[1])[0];
    if (near && near[1] < 300) { q.u = near[0].id; if (near[0].role) Object.assign(q, { role: near[0].role, obj: near[0].obj }); }
    else {
      const p = S.points.slice().sort((a, b) => dist(a.x, a.y, q.x, q.y) - dist(b.x, b.y, q.x, q.y))[0];
      const u = q.side === 'e' ? addUnit('e', 'inf', { role: 'garrison', obj: p && p.key, a4n: `${p ? p.name : ''}收容连` }) : addUnit('p', q.kind === 'eng' ? 'eng' : 'inf', { ship: '收容', auto: true, form: 'line' });
      q.u = u.id; u.x = q.x; u.y = q.y;
      if (q.side === 'e') Object.assign(q, { role: 'garrison', obj: p && p.key });
    }
    changed = true;
  }
  if (changed) indexUnits();
  for (const side of ['e', 'p']) {
    const H = S.hq[side];
    if (!H) continue;
    const reg = new Map();
    const vreg = new Map();
    for (const G of S.bgs || []) if (!G.dead && G.side === side) {
      const B = G.reg ? hqBdeOf(G) : null, o = { b: B ? B.name : side === 'e' ? '海防守备旅' : '', r: G.name, k: G.reg ? 'reg' : 'bg' };
      for (const id of G.us) reg.set(id, o);
      for (const id of G.vs) vreg.set(id, o);
    }
    const vlive = (S.veh || []).filter(v => v.side === side && !v.dead && !v.lst);
    const live = S.units.filter(u => u.side === side && teamsOf(u).some(q => q.men.length));
    if (side === 'e') {
      for (const u of live) {
        if (reg.has(u.id)) { u.org = reg.get(u.id); continue; }
        if (u.a101) { u.org = { b: '第101空降师', r: u.a4n || '空降连', k: 'aux' }; continue; }
        if (u.role === 'raider') { u.org = { b: '海防守备旅', r: '旅直属突击队', k: 'gar' }; continue; }
        const P = hqPt(u.obj), c = P || u, sc = hqSector(c.x, c.y);
        u.org = { b: '海防守备旅', r: sc.nm, k: 'gar' };
      }
      for (const v of vlive) v.org = vreg.get(v.id) || (v.a101 ? { b: '第101空降师', r: '空降装甲分队', k: 'aux' } : { b: '海防守备旅', r: v.afD ? '机场守备营' : v.mod && v.mod.cram ? '旅防空群' : hqSector(v.x, v.y).nm, k: 'gar' });
      for (const e of S.enemies) if (!e.dead && e.kind !== 'airfield') { const sc = hqSector(e.x, e.y), fire = ['arty', 'mortar', 'tel', 'ascm', 'typhon', 'coastal'].includes(e.kind); e.org = { b: '海防守备旅', r: fire ? '旅火力群' : sc.nm, k: 'gar' }; }
    } else {
      // 攻方：登陆旅按滩头；AI 指挥时用司令编的旅，玩家指挥时按登陆滩头编（只是建制）
      const bdes = H.bdes.filter(B => B.beach != null);
      const adm = H.adm || (H.adm = {});
      const bdeAt = (x, y) => {
        if (bdes.length) return bdes.slice().sort((a, b) => { const A = cmdExit(a.beach), Bx = cmdExit(b.beach); return dist(A.x, A.y, x, y) - dist(Bx.x, Bx.y, x, y); })[0].name;
        const Bs = TER.beaches || [];
        let bi = 0, bd = 1e9;
        Bs.forEach((b, i) => { const d = Math.abs(clamp(x, b.x0, b.x1) - x); if (d < bd) { bd = d; bi = i; } });
        return adm[bi] || (adm[bi] = `登陆第${Object.keys(adm).length + 1}旅（${(Bs[bi] || {}).name || ''}）`);
      };
      for (const u of live) {
        if (reg.has(u.id)) { u.org = reg.get(u.id); continue; }
        const ts = teamsOf(u).filter(q => q.men.length), x = ts.reduce((a, q) => a + q.x, 0) / ts.length, y = ts.reduce((a, q) => a + q.y, 0) / ts.length;
        // 工兵、警戒分队配属最近的团（700 以内）；其余归旅直属，等编团
        const G = (S.bgs || []).filter(G => G.reg && !G.dead && G.side === 'p' && dist(G.ax, G.ay, x, y) < 700).sort((a, b) => dist(a.ax, a.ay, x, y) - dist(b.ax, b.ay, x, y))[0];
        const what = u.emblem === 'para' || u.ab != null ? '空降分队' : /警戒/.test(u.ship || '') ? '警戒分队' : u.emblem === 'crew' ? '车组（弃车乘员）' : u.kind === 'eng' ? '工兵分队' : null;
        if (G && what && what !== '空降分队') { const B = hqBdeOf(G); u.org = { b: B ? B.name : bdeAt(x, y), r: `${G.name}配属${what}`, k: 'att' }; continue; }
        u.org = { b: bdeAt(x, y), r: `旅直属${what || '（待编团）'}`, k: 'att' };
      }
      for (const v of vlive) v.org = vreg.get(v.id) || { b: bdeAt(v.x, v.y), r: hqTank(v) ? '旅直属坦克分队' : hqAA(v) ? '旅直属防空分队' : '旅直属装甲分队', k: 'att' };
    }
  }
}
const hqOrgName = u => u && u.org ? `${u.org.b}${u.org.b && u.org.r ? ' · ' : ''}${u.org.r}` : '';

// ———————————————— 主循环 ————————————————
function hqInit() {
  if (!S || S.hq) return;
  S.hq = { on: true, e: { bdes: [], n: 0, mem: {}, main: null, live: false, thT: HQ.orgT }, p: { bdes: [], n: 0, mem: {}, live: false, thT: HQ.orgT } };
  S.v7off = { ...(S.v7off || {}), br: true };   // 旧的零散调兵（brain.js）让位给指挥体系
  for (const m of S.chat || []) if (!m.hq) m.lv = Math.max(m.lv ?? 1, 2);   // 开战前各部门的部署通报也只进详档，常规档只留司令的大战术
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
  if ((S.hq.affT = (S.hq.affT ?? 0) - dt) <= 0) { S.hq.affT = 2; try { hqAffil(); } catch (e) { if (!HQ.err2) { HQ.err2 = 1; console.error('hq affil', e); } } }   // 归属：双方都刷新（玩家指挥攻方时也按滩头编登陆旅）
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
function hqDraw() {
  if (!hqOn() || typeof R === 'undefined' || !R.ctx || (typeof V3 === 'object' && V3.drawing && false)) return;
  const ctx = R.ctx, zr = typeof CAM === 'object' && CAM.fit ? CAM.z / CAM.fit : 1, A0 = clamp(1.25 - zr / 7, .3, 1);
  const spec = S.role === 'spectate' || R.eye === 'all' || R.eye === 'both' || R.eye === 'e';
  ctx.save(); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  const marks = [];
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
      const tag = HQ_VERB[O.v] || '';
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
      } else if (O.v === 'defend' || O.v === 'block') {
        const th = O.face ?? hqThreat(side, P), lx = -Math.sin(th), ly = Math.cos(th), L = 120 + Rs.length * 70, cx = P.x + Math.cos(th) * 75, cy = P.y + Math.sin(th) * 75;
        ctx.strokeStyle = rgba(col, .85 * a); ctx.lineWidth = px(2.4);
        ctx.beginPath();
        for (let k = 0; k <= 16; k++) { const t = k / 16 - .5, bow = (1 - 4 * t * t) * 22, x = cx + lx * t * L + Math.cos(th) * bow, y = cy + ly * t * L + Math.sin(th) * bow; k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
        ctx.stroke();
        ctx.lineWidth = px(1.6);
        for (let k = 1; k < 8; k++) { const t = k / 8 - .5, bow = (1 - 4 * t * t) * 22, x = cx + lx * t * L + Math.cos(th) * bow, y = cy + ly * t * L + Math.sin(th) * bow; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(th) * 14, y + Math.sin(th) * 14); ctx.stroke(); }
      } else {   // 待机 / 跟进：集结地域虚线椭圆，跟进再画一支细虚线箭头指向目标方向
        const r = 70 + Rs.length * 45;
        ctx.strokeStyle = rgba(col, .75 * a); ctx.lineWidth = px(1.5); ctx.setLineDash([px(6), px(5)]);
        ctx.beginPath(); ctx.ellipse(c.x, c.y, r, r * .62, 0, 0, 6.283); ctx.stroke(); ctx.setLineDash([]);
        if (O.v === 'follow') { const d = dist(c.x, c.y, P.x, P.y), e = d > 200 ? [lerp(c.x, P.x, (d - 160) / d), lerp(c.y, P.y, (d - 160) / d)] : null; if (e) { ctx.lineWidth = px(1.1); hqArrow(ctx, [[c.x, c.y], e], w * .5, null, rgba(col, .55 * a), [px(5), px(5)]); } }
      }
      marks.push({ B, c, tag, col });
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
  if (!(typeof V3 === 'object' && V3.drawing)) for (const m of marks) hqBdeMark(ctx, m.B, m.c, m.tag, m.col);   // 旅标最后画，压在箭头与团标上面（3D 地图里另外立在旅的上空：hqMarks3）
  ctx.restore();
}
// 3D 地图里的旅标（view3d.js v3Overlay 调用，屏幕空间）：旅的中心立一根 110 高的杆，杆顶一块番号牌，不随透视变形、远近都看得清
function hqMarks3(ctx, stem) {
  if (!hqOn()) return;
  const spec = S.role === 'spectate' || R.eye === 'all' || R.eye === 'both' || R.eye === 'e';
  for (const side of ['p', 'e']) {
    const H = S.hq[side];
    if (!H || !H.live || (side === 'e' && !spec) || (side === 'p' && S.role !== 'spectate')) continue;
    const col = side === 'p' ? COL.g : COL.enemy;
    for (const B of H.bdes) {
      if (!B.ord || !hqObj(B) || !hqRegs(side, B).length) continue;
      const c = hqBdeAt(B), q = c && stem(c.x, c.y, 110, col, 1);
      if (!q) continue;
      let inf = 0, veh = 0;
      for (const G of hqRegs(side, B)) { const P = hqRegPow(G); inf += P.inf; veh += P.veh; }
      const t = veh >= (inf + veh) * .6 ? 'armor' : veh >= (inf + veh) * .25 ? 'mech' : 'inf', verb = HQ_VERB[B.ord.v] || '';
      ctx.save(); ctx.globalAlpha = Math.max(.35, q.al);
      ctx.font = 'bold 14px "IBM Plex Mono", "Noto Sans SC", monospace'; const w1 = ctx.measureText(B.name).width;
      ctx.font = '11px "IBM Plex Mono", "Noto Sans SC", monospace'; const w2 = verb ? ctx.measureText(verb).width + 8 : 0;
      const fw = 22, fh = 15, W0 = fw + 8 + w1 + w2 + 16, h0 = 26, x0 = q.x - W0 / 2, yc = q.y - h0 / 2;
      ctx.fillStyle = rgba(COL.bg, .9); ctx.fillRect(x0, yc - h0 / 2, W0, h0);
      ctx.strokeStyle = rgba(col, 1); ctx.lineWidth = 1.6; ctx.strokeRect(x0, yc - h0 / 2, W0, h0);
      ctx.fillStyle = rgba(col, .9); ctx.fillRect(x0, yc - h0 / 2, 3, h0);
      const fx = x0 + 8 + fw / 2, fy = yc + 2.5;
      ctx.lineWidth = 1.3; ctx.strokeRect(fx - fw / 2, fy - fh / 2, fw, fh);
      ctx.beginPath();
      if (t !== 'armor') { ctx.moveTo(fx - fw / 2, fy + fh / 2); ctx.lineTo(fx + fw / 2, fy - fh / 2); ctx.moveTo(fx - fw / 2, fy - fh / 2); ctx.lineTo(fx + fw / 2, fy + fh / 2); }
      if (t !== 'inf') ctx.ellipse(fx, fy, fw * .32, fh * .3, 0, 0, 6.283);
      ctx.stroke();
      ctx.fillStyle = rgba(col, 1); ctx.font = 'bold 8px "IBM Plex Mono", monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.fillText('X', fx, fy - fh / 2 - 1.5);
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.font = 'bold 14px "IBM Plex Mono", "Noto Sans SC", monospace'; ctx.fillText(B.name, fx + fw / 2 + 7, yc + .5);
      if (verb) { ctx.font = '11px "IBM Plex Mono", "Noto Sans SC", monospace'; ctx.fillStyle = rgba(col, .75); ctx.fillText(verb, fx + fw / 2 + 7 + w1 + 8, yc + 1); }
      ctx.restore();
    }
  }
}
// 旅标：每个旅头顶一块番号牌——北约式兵种框（步兵 ×、装甲椭圆、机步两者都有）上加旅级记号「X」，旁边大字写番号与当前任务；
//   牌子立在全旅最北（屏幕上方）那支部队的头顶，一根引线落到旅的中心；大小按屏幕像素固定，远近都看得清
function hqBdeMark(ctx, B, c, verb, col) {
  let top = c.y, n = 0, inf = 0, veh = 0;
  for (const G of hqRegs(B.side, B)) {
    for (const u of bgUnits(G)) for (const q of teamsOf(u)) if (q.men.length && !q.ride) { top = Math.min(top, q.y); inf += q.men.length; n++; }
    for (const v of bgVehs(G)) { top = Math.min(top, v.y); veh += bgPow(v); n++; }
    top = Math.min(top, G.ay);
  }
  if (!n) return;
  const t = veh >= (inf + veh) * .6 ? 'armor' : veh >= (inf + veh) * .25 ? 'mech' : 'inf';
  const yb = top - px(14), yc = yb - px(20), fw = px(22), fh = px(15);
  ctx.font = `bold ${font(14)}`; const w1 = ctx.measureText(B.name).width;
  ctx.font = font(11); const w2 = verb ? ctx.measureText(verb).width + px(8) : 0;
  const W0 = fw + px(8) + w1 + w2 + px(16), x0 = c.x - W0 / 2, h0 = px(26);
  // 引线
  ctx.strokeStyle = rgba(col, .85); ctx.lineWidth = px(1.2); ctx.setLineDash([px(3), px(3)]);
  ctx.beginPath(); ctx.moveTo(c.x, yc + h0 / 2); ctx.lineTo(c.x, Math.max(yc + h0 / 2, c.y - px(4))); ctx.stroke(); ctx.setLineDash([]);
  // 牌子
  ctx.fillStyle = rgba(COL.bg, .9); ctx.fillRect(x0, yc - h0 / 2, W0, h0);
  ctx.strokeStyle = rgba(col, 1); ctx.lineWidth = px(1.6); ctx.strokeRect(x0, yc - h0 / 2, W0, h0);
  ctx.fillStyle = rgba(col, .9); ctx.fillRect(x0, yc - h0 / 2, px(3), h0);
  // 兵种框 + X
  const fx = x0 + px(8) + fw / 2, fy = yc + px(2.5);
  ctx.strokeStyle = rgba(col, 1); ctx.lineWidth = px(1.3); ctx.strokeRect(fx - fw / 2, fy - fh / 2, fw, fh);
  ctx.beginPath();
  if (t !== 'armor') { ctx.moveTo(fx - fw / 2, fy + fh / 2); ctx.lineTo(fx + fw / 2, fy - fh / 2); ctx.moveTo(fx - fw / 2, fy - fh / 2); ctx.lineTo(fx + fw / 2, fy + fh / 2); }
  if (t !== 'inf') ctx.ellipse(fx, fy, fw * .32, fh * .3, 0, 0, 6.283);
  ctx.stroke();
  ctx.fillStyle = rgba(col, 1); ctx.font = `bold ${font(8)}`; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.fillText('X', fx, fy - fh / 2 - px(1.5));
  // 番号与任务
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.font = `bold ${font(14)}`; ctx.fillStyle = rgba(col, 1); ctx.fillText(B.name, fx + fw / 2 + px(7), yc + px(.5));
  if (verb) { ctx.font = font(11); ctx.fillStyle = rgba(col, .75); ctx.fillText(verb, fx + fw / 2 + px(7) + w1 + px(8), yc + px(1)); }
}
function hqFlag(ctx, x, y, col, a) {
  ctx.strokeStyle = rgba(col, .9 * a); ctx.fillStyle = rgba(col, .55 * a); ctx.lineWidth = px(1.4);
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - px(18)); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x, y - px(18)); ctx.lineTo(x + px(11), y - px(14)); ctx.lineTo(x, y - px(10)); ctx.closePath(); ctx.fill(); ctx.stroke();
}
HOOK.drawOver.push(hqDraw);

// ———————————————— 远看画编队符号 ————————————————
// 缩小到 HQ_AGG 倍全图以下：编进团的连、坦克排、团属车辆（步战车、防空车、自行火炮按种类各一个）不再一个个画单兵单车，
//   改画北约式分队符号（连「I」、排「•••」；步兵 ×、装甲椭圆、机步两者、防空拱形、炮兵实心点），立在分队的中心，朝向画一根短线；
//   放大才画单车单兵。观战时双方都画，平时只画看得见的
const HQ_AGG = 1.8;
const hqAggOn = () => hqOn() && typeof R === 'object' && R.zr < HQ_AGG && !(typeof SETTINGS === 'object' && SETTINGS && SETTINGS.agg === false) && !(typeof V3 === 'object' && V3.drawing);
function hqAggSet() {
  const k = S.t + ':' + R.zr;
  if (HQ.aggK === k) return HQ.agg;
  HQ.aggK = k;
  const u = new Set(), v = new Set(), spec = S.role === 'spectate' || R.eye === 'all' || R.eye === 'both' || R.eye === 'e';
  const ok = side => side === 'p' ? S.role === 'spectate' : spec;   // 敌方的编制看不见：只有观战时才合成符号
  const rest = [];
  if (hqAggOn()) {
    for (const G of S.bgs || []) {
      if (!G.reg || G.dead || !S.hq[G.side] || !S.hq[G.side].live || !ok(G.side)) continue;
      for (const id of G.us) u.add(id);
      for (const id of G.vs) v.add(id);
    }
    for (const o of S.units) if (o.org && o.org.k !== 'reg' && ok(o.side) && !u.has(o.id) && teamsOf(o).some(q => q.men.length && !q.ride)) { u.add(o.id); rest.push(o); }   // 守备团、旅直属、独立单位的连也画成连符号
  }
  return (HQ.agg = { u, v, rest });
}
// 单兵单车画不画（render2.js drawTeams / drawEnemies、vehicles.js vehDrawOver 调用）
const hqAggHide = (k, id) => hqAggOn() && hqAggSet()[k].has(id);
function hqAggSym(ctx, x, y, t, ech, col, face, n) {
  const w = px(15), h = px(10);
  ctx.fillStyle = rgba(COL.bg, .8); ctx.fillRect(x - w / 2, y - h / 2, w, h);
  ctx.strokeStyle = rgba(col, .95); ctx.lineWidth = px(1.1); ctx.strokeRect(x - w / 2, y - h / 2, w, h);
  ctx.beginPath();
  if (t === 'inf' || t === 'mech') { ctx.moveTo(x - w / 2, y + h / 2); ctx.lineTo(x + w / 2, y - h / 2); ctx.moveTo(x - w / 2, y - h / 2); ctx.lineTo(x + w / 2, y + h / 2); }
  if (t === 'armor' || t === 'mech') ctx.ellipse(x, y, w * .32, h * .3, 0, 0, 6.283);
  if (t === 'aa') { ctx.moveTo(x - w * .38, y + h / 2); ctx.quadraticCurveTo(x, y - h * .7, x + w * .38, y + h / 2); }
  if (t === 'art') ctx.arc(x, y, px(1.8), 0, 6.283);
  ctx.stroke();
  if (t === 'art') { ctx.fillStyle = rgba(col, .95); ctx.fill(); }
  ctx.fillStyle = rgba(col, .95); ctx.font = font(7); ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.fillText(ech, x, y - h / 2 - px(1.5));
  if (n > 1) { ctx.textAlign = 'left'; ctx.fillText(n, x + w / 2 + px(2), y + h / 2); }
  if (face != null) { ctx.beginPath(); ctx.moveTo(x + Math.cos(face) * w * .55, y + Math.sin(face) * h * .55); ctx.lineTo(x + Math.cos(face) * w * .95, y + Math.sin(face) * h * 1.1); ctx.stroke(); }
}
function hqAggDraw() {
  if (!S || !hqAggOn()) return;
  const A = hqAggSet();
  if (!A.u.size && !A.v.size) return;
  const ctx = R.ctx;
  ctx.save();
  for (const G of S.bgs || []) {
    if (!G.reg || G.dead || !G.us.concat(G.vs).some(id => A.u.has(id) || A.v.has(id))) continue;
    const col = G.side === 'p' ? COL.g : COL.enemy, f = G.face;
    for (const u of bgUnits(G)) { const ts = teamsOf(u).filter(q => q.men.length && !q.ride); if (!ts.length) continue; const [x, y] = regUnitAt(u); if (inView(x, y, 30)) hqAggSym(ctx, x, y, 'inf', 'I', col, f, 0); }
    const vs = bgVehs(G), tk = vs.filter(hqTank), inP = new Set();
    for (const ids of G.plts || []) {
      const pl = ids.map(id => tk.find(v => v.id === id)).filter(Boolean);
      if (!pl.length) continue;
      pl.forEach(v => inP.add(v.id));
      const x = pl.reduce((a, v) => a + v.x, 0) / pl.length, y = pl.reduce((a, v) => a + v.y, 0) / pl.length;
      if (inView(x, y, 30)) hqAggSym(ctx, x, y, 'armor', '•••', col, f, pl.length);
    }
    const grp = { armor: tk.filter(v => !inP.has(v.id)), mech: vs.filter(v => v.type === 'apc' || v.type === 'abv'), aa: vs.filter(hqAA), art: vs.filter(v => v.type === 'spg') };
    grp.armor.push(...vs.filter(v => !hqTank(v) && !grp.mech.includes(v) && !grp.aa.includes(v) && !grp.art.includes(v)));
    for (const t in grp) {
      const L = grp[t];
      if (!L.length) continue;
      const x = L.reduce((a, v) => a + v.x, 0) / L.length, y = L.reduce((a, v) => a + v.y, 0) / L.length;
      if (inView(x, y, 30)) hqAggSym(ctx, x, y, t, '•••', col, f, L.length);
    }
  }
  // 没编进机动团的连（守备团、旅直属、101）：连符号；同一个团的连中心标团名
  const grp = new Map();
  for (const u of A.rest) {
    const [x, y] = regUnitAt(u), col = u.side === 'p' ? COL.g : COL.enemy;
    if (inView(x, y, 30)) hqAggSym(ctx, x, y, 'inf', 'I', col, u.face, 0);
    const k = u.side + u.org.b + u.org.r, g = grp.get(k) || (grp.set(k, { n: 0, x: 0, y: 0, col, t: u.org.r }), grp.get(k));
    g.n++; g.x += x; g.y += y;
  }
  ctx.font = font(10); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const g of grp.values()) { const x = g.x / g.n, y = g.y / g.n - px(16); if (!inView(x, y, 60)) continue; ctx.fillStyle = rgba(COL.bg, .7); const w = ctx.measureText(g.t).width + px(8); ctx.fillRect(x - w / 2, y - px(7), w, px(14)); ctx.fillStyle = rgba(g.col, .9); ctx.fillText(g.t, x, y); }
  ctx.restore();
}
HOOK.drawOver.unshift(hqAggDraw);   // 先画分队符号，团标、旅标与箭头压在上面
