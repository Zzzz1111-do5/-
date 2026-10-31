'use strict';
// 自动指挥：auto === true 的舰船自行选滩抢滩；步兵排自选据点 → 集结 → 攻击前进 → 冲锋 → 留守 / 继续推进，
// 弹药不足或动摇时退回最近的接通补给点，恢复后继续；工兵自动修建补给网、抢修运输线、排除进攻路线上的已知雷区，没活干时跟进保障
// 计划（纯数据）存于 S.autoPlan：u[排 id] = {ph, obj, sx, sy, dx, dy, waitT, sp, job, ...}
//   ph：idle 待命 / stage 前往集结点 / wait 集结待命 / go 攻击 / garrison 留守 / supply 回补弹药 / regroup 重整 / bg 编入战斗群（brain.js，由战斗群指挥）
//   o[据点 key] = {go, t, need, pg, pgT} 攻击组状态；hard[据点 key] = 近期受挫时刻；s[舰船 id] = {b, x} 预定滩头
// 指挥官（commander.js，可缺省）的指令：pri[据点 key] 目标加权 · mis[排 id] 任务式指挥的既定目标 · 舰船梯队经 cmdShipTask
const AP_THINK = 1.5, AP_WAIT = 20, AP_STAGE_MIN = 140, AP_STAGE_MAX = 180;
const AP_ROUTES = new Map();   // 渲染缓存（不进 S）：排 id → 路线采样点

function apEnsure() {
  if (!S.autoPlan || typeof S.autoPlan !== 'object') S.autoPlan = {};
  const P = S.autoPlan;
  for (const k of ['u', 'o', 'hard', 's']) if (!P[k] || typeof P[k] !== 'object') P[k] = {};
  return P;
}
const apPt = key => (key != null && S.points.find(p => p.key === key)) || null;
const apTaken = p => p.owner === 'p' && p.prog >= .99;
const apAng = (x0, y0, x1, y1) => Math.atan2(y1 - y0, x1 - x0);
const apNeed = est => clamp(1 + Math.floor(est / 8), 1, 3);
const apCap = u => 35 + 65 * (u.men || 0) / Math.max(1, u.men0 || u.men || 1);   // 与 updateUnits 的士气上限一致
const apWeak = u => (u.men || 0) <= 4 || apCap(u) < 54;
function apIdle(pl) { Object.assign(pl, { ph: 'idle', obj: null, sx: null, sy: null, dx: null, dy: null, waitT: null, sp: null, back: null, halt: null, raid: null }); }

function updateAutopilot(dt) {
  if (!S || S.phase !== 'battle' || S.over) return;
  const P = apEnsure();
  if ((P.shipT = (P.shipT ?? 0) - dt) <= 0) { P.shipT = AP_THINK; apShips(P); }
  if ((P.asgT = (P.asgT ?? 0) - dt) <= 0) { P.asgT = 3; apPrune(P); apAssign(P); }
  // 各排错峰思考（约 1.5 秒一次）
  for (const u of S.units) {
    if (u.side !== 'p' || u.auto !== true || u.x == null || !isFinite(u.x)) continue;
    const pl = P.u[u.id];
    if (!pl || (pl.next ?? 0) > S.t) continue;
    pl.next = S.t + AP_THINK + Math.random() * .4;
    if (u.kind === 'eng') apEngineer(u, pl, P); else apInfantry(u, pl, P);
  }
}

function apPrune(P) {
  for (const id in P.u) { const u = UNIT_MAP.get(+id); if (!u || u.auto !== true || u.side !== 'p' || !teamsOf(u).length) delete P.u[id]; }
  for (const id in P.s) { const s = S.ships.find(s => s.id === +id); if (!s || !alive(s) || s.state === 'beached' || s.auto !== true) delete P.s[id]; }
  const live = Object.values(P.u);
  for (const k in P.o) if (!live.some(pl => pl.obj === k && pl.ph !== 'garrison')) delete P.o[k];
  for (const k in P.hard) if (S.t - P.hard[k] > 180) delete P.hard[k];
}

// —— 舰船：空闲且载员的自动舰船自行选滩抢滩（已知防御、雷区、距离、同滩友舰数、滩头是否已被我方控制）——
function apBeachCount(b, except) {
  return S.ships.filter(o => o !== except && alive(o) && o.land && (o.state === 'move' || o.state === 'unloading' || o.state === 'beached') &&
    o.bx >= b.x0 - 30 && o.bx <= b.x1 + 30).length;
}
function apBeachScore(s, b, i) {
  const ex = b.cx, ey = coastAt(b.cx) - 50;
  let def = 0, fr = 0;
  for (const e of S.enemies) if (!e.dead && e.kx != null) {
    const d = dist(e.kx, e.ky, ex, ey);
    if (e.kind === 'coastal' && d < 650) def += 4;
    else if (e.kind === 'bunker' && d < 260) def += 3;
    else if (e.kind === 'mortar' && d < 420) def += 1.2;
    else if (e.kind === 'arty' && d < 900) def += .6;
  }
  for (const m of S.mines) if (m.known && m.clr < 1 && m.x > b.x0 - 30 && m.x < b.x1 + 30 && Math.abs(m.y - coastAt(m.x)) < 80) def += 1;
  for (const o of S.obst) if (o.known && !o.dead && o.x > b.x0 && o.x < b.x1) def += .3;
  for (const q of S.teams) {
    if (q.side === 'e' && q.seen != null && S.t - q.seen < 60 && dist(q.sx, q.sy, ex, ey) < 200) def += q.men.length * .3;
    if (q.side === 'p' && q.kind === 'inf' && dist(q.x, q.y, ex, ey) < 260) fr += q.men.length;
  }
  const n = apBeachCount(b, s), pt = apPt('E' + (i + 1)), own = pt && pt.owner === 'p';
  let sc = -def * 1.3 - dist(s.x, s.y, b.cx, coastAt(b.cx)) / 260 + Math.min(fr, 30) * .08 + (own ? 2.5 : 0);
  // 补给舰：去我方兵力多、出口已占的滩头；尽量各占一处滩头（一处被炮火切断时其余仍能补给）
  const ls = S.ships.filter(o => o !== s && o.kind === 'supply' && alive(o) && o.land && o.bx >= b.x0 - 30 && o.bx <= b.x1 + 30).length;
  if (s.kind === 'supply' || s.kind === 'lst') sc += Math.min(fr, 30) * .12 + (own ? 3 : 0) - ls * 2.5 - (fr < 6 && !own ? 3 : 0);
  else if (n >= 1 && n <= 4) sc += 1.2;   // 突击舰：与友舰同滩，互相支援
  return sc - Math.max(0, n - 4) * 2.2;
}
const apLoaded = s => !!s.load && (s.load.teams > 0 || s.load.eng > 0 || (Array.isArray(s.load.veh) && s.load.veh.length > 0));
function apShips(P) {
  const first = S.ships.some(s => s.kind === 'assault' && (s.state === 'beached' || s.state === 'unloading'));
  let sent = 0, at = null;
  for (const s of S.ships) {
    if (s.auto !== true || s.state !== 'idle' || !alive(s) || !apLoaded(s)) continue;
    if (s.plan && isFinite(s.plan.x) && isFinite(s.plan.y)) { const pl = s.plan; s.plan = null; orderShips([s], pl.x, pl.y); continue; }
    // 指挥官的梯队计划：待命，或指定滩头与落点
    const T = typeof cmdShipTask === 'function' ? cmdShipTask(s) : null;
    if (T && T.hold) continue;
    if (T && isFinite(T.x)) {
      if (orderShips([s], T.x, coastAt(T.x) - 20)) { P.s[s.id] = { b: T.b, x: T.x }; sent++; at = { x: T.x, y: coastAt(T.x) }; }
      continue;
    }
    if (s.kind === 'lst' && typeof vehLSTTick === 'function') continue;   // 坦克登陆舰由 vehicles.js 自行择机抢滩
    if ((s.kind === 'supply' || s.kind === 'lst') && !first && S.t < 45) continue;   // 补给舰、坦克登陆舰等第一波突击舰上滩后再靠岸
    let best = null, bs = -Infinity, bi = -1;
    TER.beaches.forEach((b, i) => { const sc = apBeachScore(s, b, i); if (sc > bs) { bs = sc; best = b; bi = i; } });
    if (!best) continue;
    const k = apBeachCount(best, s), x = clamp(best.cx + ((k % 6) - 2.5) * 27, best.x0 + 12, best.x1 - 12);
    if (orderShips([s], x, coastAt(x) - 20)) { P.s[s.id] = { b: bi, x }; sent++; at = { x, y: coastAt(x) }; }
  }
  if (sent) log(`自动指挥：${sent} 艘登陆舰驶向滩头`, 'info', 'apship', 8, at);
}

// —— 情报估计：只用看得见 / 近期看见过 / 已标定的敌情；情报空白时按据点等级估计 ——
function apEstimate(p, noPrior) {
  let m = 0, seen = false;
  for (const q of S.teams) if (q.side === 'e' && q.men.length) {
    const vis = inVision(q.x, q.y);
    if (!vis && !(q.seen != null && S.t - q.seen < 90)) continue;
    if (dist(vis ? q.x : q.sx, vis ? q.y : q.sy, p.x, p.y) < 140) { m += q.men.length; seen = true; }
  }
  for (const e of S.enemies) if (!e.dead && e.kx != null && dist(e.kx, e.ky, p.x, p.y) < 160) { m += e.kind === 'bunker' ? 5 : e.kind === 'coastal' ? 3 : 1.5; seen = true; }
  for (const v of S.veh || []) if (v.side === 'e' && !v.dead && v.kx != null && dist(v.kx, v.ky, p.x, p.y) < 160) { m += vehCrew(v); seen = true; }   // 守军坦克按车组人数计
  for (const a of S.armor || []) if (!a.dead && a.kx != null && dist(a.kx, a.ky, p.x, p.y) < 160) { m += 3; seen = true; }
  if (!noPrior && !seen && !inVision(p.x, p.y) && p.owner !== 'p') m += 2 + p.vp * 2;
  return m;
}
function apDanger(x, y) {
  for (const q of S.teams) if (q.side === 'e' && q.men.length) {
    if (inVision(q.x, q.y) ? dist(q.x, q.y, x, y) < 120 : q.seen != null && S.t - q.seen < 15 && dist(q.sx, q.sy, x, y) < 100) return true;
  }
  for (const e of S.enemies) if (!e.dead && e.kx != null && e.kind === 'bunker' && dist(e.kx, e.ky, x, y) < 170) return true;
  return false;
}
const apShelling = (x, y, r) => S.shells.some(sh => sh.side === 'e' && sh.kind !== 'cb' && dist(sh.x1, sh.y1, x, y) < r);
function apThreatDir(p) {
  let best = null, bd = Infinity;
  for (const o of S.points) if (o !== p && o.owner !== 'p') { const d = dist(o.x, o.y, p.x, p.y); if (d < bd) { bd = d; best = o; } }
  return best ? apAng(p.x, p.y, best.x, best.y) : NORTH;
}

// —— 目标分配：价值、距离、已知敌情、已有多少自动排在攻（强点集中 2–3 个排）——
function apScore(u, p, est, cnt, P) {
  const need = apNeed(est);
  let s = p.vp * 3 + (p.key === 'HQ' ? 3 : 0) - dist(u.x, u.y, p.x, p.y) / 70 - est * .3;
  if (cnt > 0 && cnt < need) s += 3;
  if (cnt >= need) s -= 3.5 * (cnt - need + 1);
  if (P.hard[p.key] != null && S.t - P.hard[p.key] < 75) s -= 5;
  if (p.owner === 'p') s += 4;   // 已占据点正被反夺：回援
  if ((u.men || 0) < (u.men0 || 1) * .5) s -= est * .3;   // 残部挑软目标
  if (P.pri && P.pri[p.key]) s += P.pri[p.key];   // 指挥官的主要方向与重点目标
  if (P.mis && P.mis[u.id] === p.key) s += 4;     // 任务式指挥：命令未送达时按既定意图行动
  return s;
}
const apAutoInf = () => S.units.filter(u => u.side === 'p' && u.auto === true && u.kind === 'inf' && u.x != null && isFinite(u.x) && teamsOf(u).length);
const apGroup = (key, P) => apAutoInf().filter(u => u.state !== 'rout' && P.u[u.id] && P.u[u.id].obj === key && ['stage', 'wait', 'go'].includes(P.u[u.id].ph));

function apGarrisonSpot(u, P) {
  let best = null, bd = 650;
  for (const p of S.points) {
    if (!apTaken(p) || Object.values(P.u).some(pl => pl.ph === 'garrison' && pl.obj === p.key)) continue;
    const d = dist(u.x, u.y, p.x, p.y) - p.vp * 40;
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

function apAssign(P) {
  const all = S.units.filter(u => u.side === 'p' && u.auto === true && u.x != null && isFinite(u.x) && teamsOf(u).length);
  for (const u of all) if (!P.u[u.id]) P.u[u.id] = { ph: 'idle', obj: null, next: S.t + Math.random() * AP_THINK };
  // 战区指挥（theater.js）开着：步兵排由师 / 团 / 营沿战线指挥，不再各自挑据点（只有空降兵、突击队仍自己选目标）
  const inf = all.filter(u => u.kind === 'inf' && !(typeof thOn === 'function' && thOn('p') && !thAir(u)));
  const cand = S.points.filter(p => p.owner !== 'p' || p.prog < .9);
  const est = {}, cnt = {};
  for (const p of cand) {
    est[p.key] = typeof cmdEst === 'function' ? cmdEst(p, apEstimate(p)) : apEstimate(p);   // 指挥官的估计带误差（情报误判）
    cnt[p.key] = 0;
    if (P.o[p.key]) P.o[p.key].need = Math.max(apNeed(est[p.key]), P.o[p.key].boost || 0);
  }
  for (const u of inf) { const pl = P.u[u.id]; if (pl.obj && cnt[pl.obj] != null && pl.ph !== 'garrison') cnt[pl.obj]++; }
  const near = u => cand.reduce((a, p) => Math.min(a, dist(u.x, u.y, p.x, p.y)), Infinity);
  const free = inf.filter(u => P.u[u.id].ph === 'idle' && u.state !== 'rout').sort((a, b) => near(a) - near(b));
  for (const u of free) {
    const pl = P.u[u.id];
    if (apWeak(u)) { const g = apGarrisonSpot(u, P); if (g) { apGarrison(u, g, P); continue; } }   // 残部：守备无人驻守的已占据点
    let best = null, bs = -Infinity;
    for (const p of cand) { const s = apScore(u, p, est[p.key], cnt[p.key], P); if (s > bs) { bs = s; best = p; } }
    if (!best) continue;
    cnt[best.key]++;
    Object.assign(pl, { ph: 'stage', obj: best.key, sx: null, sy: null, waitT: null, sp: null, t0: S.t, men0: u.men || 0, next: S.t });
    if (!P.o[best.key]) P.o[best.key] = { go: false, t: 0, need: apNeed(est[best.key]) };
  }
  // 进攻兵力不足时，释放低价值、无威胁据点的守备
  const gars = inf.filter(u => P.u[u.id].ph === 'garrison'), attackers = inf.length - gars.length;
  if (cand.length && gars.length && (attackers < 2 || gars.length > Math.ceil(inf.length * .45)) && S.t - (P.relT ?? -99) > 20) {
    const pick = gars.map(u => ({ u, p: apPt(P.u[u.id].obj) }))
      .filter(g => g.p && g.p.key !== 'HQ' && g.p.owner === 'p' && apEstimate(g.p, true) < 1).sort((a, b) => a.p.vp - b.p.vp)[0];
    if (pick) { apIdle(P.u[pick.u.id]); P.relT = S.t; }
  }
}

// 自动排下令：先检查可达，避免“无法到达”刷屏；近期挨过炮击用散开队形，否则横队
function apMove(u, pl, x, y, face, t) {
  if (!isFinite(x) || !isFinite(y)) return false;
  x = clamp(x, 6, W - 6); y = clamp(y, 6, H - 6);
  if (!passInf(x, y)) { const j = nearestPassable(ci(x, y), 'p'); if (j < 0) return false; x = cellCX(j); y = cellCY(j); }
  if (!teamsOf(u).some(q => reachable(q.x, q.y, x, y, 'p'))) return false;   // 只判断走不走得到：连通分量就够，不为它整图算流场
  u.form = S.t - (pl.artyT ?? -99) < 30 ? 'loose' : 'line';
  const n = orderUnits([u], x, y, isFinite(face) ? face : NORTH, null, t);
  if (n) { pl.dx = x; pl.dy = y; pl.ordT = S.t; }
  return n > 0;
}

function apGarrison(u, p, P) {
  const pl = P.u[u.id];
  Object.assign(pl, { ph: 'garrison', obj: p.key, sx: null, sy: null, waitT: null, sp: null, back: null, garT: S.t });
  apMove(u, pl, p.x, p.y, apThreatDir(p), 'move');
}

// —— 指挥官指派（commander.js 经通信延迟后调用）——
// 排改攻指定据点（集结 → 攻击）；flank = ±1 时先到侧翼集结点，再从侧翼发起
function apTask(u, key, flank) {
  const P = apEnsure(), p = apPt(key);
  if (!p || !u || u.side !== 'p' || u.auto !== true || u.state === 'rout' || !teamsOf(u).length) return false;
  const pl = P.u[u.id] || (P.u[u.id] = { ph: 'idle', obj: null, next: S.t });
  if (pl.ph === 'bg') return false;   // 战斗群行军中：到攻击出发位置展开后才归各排自己打
  apIdle(pl);
  Object.assign(pl, { ph: 'stage', obj: key, t0: S.t, men0: u.men || 0, next: S.t + .5, task: S.t });
  if (!P.o[key]) P.o[key] = { go: false, t: 0, need: 1 };
  if (flank) {
    const sp = apFlankSpot(u, p, flank);
    if (sp && apMove(u, pl, sp.x, sp.y, apAng(sp.x, sp.y, p.x, p.y), 'move')) { pl.sx = sp.x; pl.sy = sp.y; }
    if (P.o[key].go && apGroup(key, P).every(g => P.u[g.id].ph !== 'go')) P.o[key].go = false;   // 整组撤下：重新集结后再发起
  }
  return true;
}
// 侧翼集结点：据点侧前方 120–180，不在已知雷区、铁丝网上
function apFlankSpot(u, p, side) {
  const a = apAng(u.x, u.y, p.x, p.y), lx = -Math.sin(a), ly = Math.cos(a);
  for (const s of [side, -side]) for (const r of [150, 120, 185]) {
    const x = p.x - Math.cos(a) * 100 + lx * s * r, y = p.y - Math.sin(a) * 100 + ly * s * r;
    if (x < 10 || x > W - 10 || y < 10 || y > coastAt(clamp(x, 0, W - 1)) - 15) continue;
    const j = nearestPassable(ci(x, y), 'p');
    if (j < 0 || MINEC[j] === 2 || WIREC[j]) continue;
    const cx = cellCX(j), cy = cellCY(j);
    if (dist(cx, cy, p.x, p.y) < 105) continue;
    return { x: cx, y: cy };
  }
  return null;
}
// 拦截渗透的袭扰分队
function apIntercept(u, raidId) {
  const P = apEnsure();
  if (!u || u.auto !== true || u.state === 'rout') return false;
  const pl = P.u[u.id] || (P.u[u.id] = { ph: 'idle', obj: null, next: S.t });
  if (pl.ph === 'bg') return false;
  apIdle(pl);
  Object.assign(pl, { ph: 'icpt', raid: raidId, icT: S.t, next: S.t });
  return true;
}

// 集结点：沿寻路走向据点，停在距离据点 140–180 处，附近找掩护好、不在已知雷区和铁丝网上的格子
function apStageSpot(u, p) {
  const f = field(p.x, p.y, 'p');
  if (!f) return null;
  const q0 = teamsOf(u).find(q => isFinite(f[ci(q.x, q.y)]));
  if (!q0) return null;
  const bunker = S.enemies.some(e => !e.dead && e.kx != null && e.kind === 'bunker' && dist(e.kx, e.ky, p.x, p.y) < 90);
  const off = bunker ? AP_STAGE_MAX : 160;
  let x = isFinite(f[ci(u.x, u.y)]) ? u.x : q0.x, y = isFinite(f[ci(u.x, u.y)]) ? u.y : q0.y;
  for (let k = 0; k < 800 && dist(x, y, p.x, p.y) > off; k++) { const n = nextStep(f, x, y); if (!n) break; [x, y] = n; }
  let best = { x, y }, bs = -Infinity;
  eachCellIn(x, y, 34, i => {
    const t = TER.type[i];
    if (!TP[t].sp || MINEC[i] === 2 || WIREC[i] || !isFinite(f[i])) return;
    const cx = cellCX(i), cy = cellCY(i), dp = dist(cx, cy, p.x, p.y);
    if (dp < AP_STAGE_MIN - 10 || dp > AP_STAGE_MAX + 25) return;
    const s = (1 - TP[t].cv) * 3 - dist(cx, cy, x, y) / 25 + (CRATERC[i] ? .3 : 0);
    if (s > bs) { bs = s; best = { x: cx, y: cy }; }
  });
  return best;
}

// 据点附近可见的敌人已被压制（平均压制 > 50），已知碉堡也被压住
function apShaken(p) {
  let n = 0, sup = 0;
  for (const q of S.teams) if (q.side === 'e' && q.men.length && dist(q.x, q.y, p.x, p.y) < 85 && inVision(q.x, q.y)) { n++; sup += q.sup; }
  const bk = S.enemies.filter(e => !e.dead && e.kind === 'bunker' && e.kx != null && dist(e.x, e.y, p.x, p.y) < 70);
  if (n) return sup / n > 50 && bk.every(e => (e.sup || 0) > 40);
  return bk.length > 0 && bk.every(e => (e.sup || 0) > 50);
}

// 冲锋的兵力条件：本方在据点 130 以内的人数（含坦克车组）至少是据点 85 以内目视之敌（敌坦克按车组、装甲车折 3 人）的 k 倍——
// 守敌已被压住时持平即可，否则要 1.3 倍；兵力不够就继续以火力压制，不硬冲
function apOdds(p, k) {
  let own = 0, opp = 0;
  for (const q of S.teams) {
    if (!q.men.length || q.ride) continue;
    if (q.side === 'p') { if (dist(q.x, q.y, p.x, p.y) < 130) own += q.men.length; }
    else if (dist(q.x, q.y, p.x, p.y) < 85 && inVision(q.x, q.y)) opp += q.men.length;
  }
  for (const v of S.veh || []) if (v.side === 'e' && !v.dead && dist(v.x, v.y, p.x, p.y) < 100 && inVision(v.x, v.y)) opp += vehCrew(v);
  for (const a of S.armor || []) if (!a.dead && dist(a.x, a.y, p.x, p.y) < 100 && inVision(a.x, a.y)) opp += 3;
  for (const v of S.veh || []) if (v.side === 'p' && !v.dead && !v.lst && dist(v.x, v.y, p.x, p.y) < 130) own += vehCrew(v);   // 我方坦克车组同样计入
  return own >= opp * k;
}

function apLaunch(units, p, P) {
  units = units.filter(g => g.state !== 'rout' && teamsOf(g).length && g.x != null && P.u[g.id]);
  if (!units.length) return;
  if (!fieldOk(p.x, p.y, 'p')) { P.hard[p.key] = S.t; for (const g of units) apIdle(P.u[g.id]); return; }
  const cx = units.reduce((a, g) => a + g.x, 0) / units.length, cy = units.reduce((a, g) => a + g.y, 0) / units.length;
  // v7 队形进攻（tf.js）：成队形交替跃进到冲击出发线；已在冲击距离内或未启用时直接攻击前进
  const fm = typeof tfFormGo === 'function' ? tfFormGo(units, p, cx, cy, P) : null;
  if (!fm) {
    for (const g of units) g.form = S.t - (P.u[g.id].artyT ?? -99) < 30 ? 'loose' : 'line';
    if (!orderUnits(units, p.x, p.y, apAng(cx, cy, p.x, p.y), null, 'amove')) return;
  }
  const O = P.o[p.key] || (P.o[p.key] = { need: units.length }), first = !O.go;
  if (!O.go) Object.assign(O, { go: true, t: S.t, pg: p.prog, pgT: S.t });
  for (const g of units) Object.assign(P.u[g.id], { ph: 'go', obj: p.key, goT: S.t, men0: g.men || 0, dx: g.tx, dy: g.ty, ordT: S.t });
  if (fm) tfFormOrder(fm, p);   // 各排转入 go 后再下第一次跃进令（tfFormOrder 只管 go 阶段的排）
  if (first && typeof cmdOnLaunch === 'function') cmdOnLaunch(units, p);   // 摩擦：个别排可能在调整线前停顿
}

// 占领后：留一个排守备（指挥所必留；多排攻击组或高价值据点），其余继续前进
function apCaptured(p, P) {
  const grp = apGroup(p.key, P).filter(u => dist(u.x, u.y, p.x, p.y) < 320), all = apAutoInf();
  const gars = all.filter(u => P.u[u.id] && P.u[u.id].ph === 'garrison');
  if (!gars.some(u => P.u[u.id].obj === p.key) && grp.length && gars.length < Math.max(1, Math.ceil(all.length * .4)) &&
    (p.key === 'HQ' || grp.length >= 2 || (p.vp >= 2 && gars.length < all.length * .35))) {
    apGarrison(grp.slice().sort((a, b) => (a.men || 0) - (b.men || 0))[0], p, P);
  }
  for (const u of apGroup(p.key, P)) apIdle(P.u[u.id]);
  delete P.o[p.key];
}

// 回补 / 重整：去最近的接通补给点（停在其补给范围内侧），没有补给点时就地后撤一段重整
const apSpValid = sp => sp && (sp.kind === 'depot' ? S.supply.some(L => L.id === sp.id && L.connected) : sp.kind === 'cache' ? typeof paCacheOk === 'function' && paCacheOk(sp.id) :
  !!(S.snet && S.snet.nodes.some(n => n.id === sp.id && n.connected && n.built >= 1 && !n.dead)));
// 最近的接通补给点；any = 没有接通的就退而求其次，去等工兵修通的补给点
function apSupplyPt(x, y, any) {
  if (typeof nearestSupply === 'function') return nearestSupply(x, y, true) || (any ? nearestSupply(x, y, false) : null);
  let best = null, bd = Infinity;
  for (const L of S.supply) if (L.connected || any) { const d = dist(L.x, L.y, x, y) + (L.connected ? 0 : 1e4); if (d < bd) { bd = d; best = { kind: 'depot', id: L.id, x: L.x, y: L.y }; } }
  return best;
}
function apFallback(u, pl, kind, maxD, again) {
  const sp = apSupplyPt(u.x, u.y, kind === 'supply'), p = apPt(pl.obj);
  if (!again && pl.ph !== 'supply' && pl.ph !== 'regroup') pl.back = pl.ph;
  if (sp && dist(sp.x, sp.y, u.x, u.y) <= maxD) {
    Object.assign(pl, { ph: kind, sp: { kind: sp.kind, id: sp.id, x: sp.x, y: sp.y }, spT: again ? pl.spT ?? S.t : S.t, sx: null, sy: null, waitT: null });
    const d = dist(u.x, u.y, sp.x, sp.y), face = p ? apAng(sp.x, sp.y, p.x, p.y) : NORTH;
    if (d > 150) apMove(u, pl, sp.x + (u.x - sp.x) * 110 / d, sp.y + (u.y - sp.y) * 110 / d, face, 'move');
    else orderUnits([u], 0, 0, 0, null, 'hold');
    return true;
  }
  if (kind === 'regroup' && !again) {   // 无补给点：就近找掩护停下（坚守时士气恢复最快），不退回开阔的滩头
    Object.assign(pl, { ph: 'regroup', sp: null, spT: S.t, sx: null, sy: null, waitT: null });
    const c = apCoverSpot(u.x, u.y, 50), face = p ? apAng(u.x, u.y, p.x, p.y) : NORTH;
    if (!c || dist(c.x, c.y, u.x, u.y) < 12 || !apMove(u, pl, c.x, c.y, face, 'move')) orderUnits([u], 0, 0, 0, null, 'hold');
    return true;
  }
  return false;
}
// 附近掩护最好的位置：林地/城镇/弹坑，远离已知敌人，不在已知雷区与铁丝网上
function apCoverSpot(x, y, r) {
  const foes = [];
  for (const q of S.teams) if (q.side === 'e' && q.men.length && (inVision(q.x, q.y) || (q.seen != null && S.t - q.seen < 30))) foes.push(inVision(q.x, q.y) ? [q.x, q.y] : [q.sx, q.sy]);
  for (const e of S.enemies) if (!e.dead && e.kx != null && e.kind === 'bunker') foes.push([e.kx, e.ky]);
  const away = (cx, cy) => foes.reduce((a, f) => Math.min(a, dist(cx, cy, f[0], f[1])), 400);
  let best = null, bs = -Infinity;
  eachCellIn(x, y, r, i => {
    const t = TER.type[i];
    if (!TP[t].sp || MINEC[i] === 2 || WIREC[i] || t === T.BEACH) return;
    const cx = cellCX(i), cy = cellCY(i);
    const s = (1 - TP[t].cv) * 3 + (CRATERC[i] ? .4 : 0) + away(cx, cy) / 150 - dist(cx, cy, x, y) / 40;
    if (s > bs) { bs = s; best = { x: cx, y: cy }; }
  });
  return best;
}

function apResume(u, pl, P) {
  const p = apPt(pl.obj), back = pl.back;
  pl.sp = null; pl.back = null;
  if (p && back === 'garrison' && apTaken(p)) { apGarrison(u, p, P); return; }
  if (p && (p.owner !== 'p' || p.prog < .9)) Object.assign(pl, { ph: 'stage', sx: null, sy: null, waitT: null });
  else apIdle(pl);
}

function apInfantry(u, pl, P) {
  if (u.state === 'rout' || pl.ph === 'bg') return;
  const ts = teamsOf(u);
  if (!ts.length) return;
  const inf = ts.filter(q => q.kind === 'inf'), ammo = inf.length ? inf.reduce((a, q) => a + q.ammo, 0) / inf.length : 60;
  for (const sh of S.shells) if (sh.side === 'e' && (sh.kind === 'arty' || sh.kind === 'mortar' || sh.kind === 'coastal') && dist(sh.x1, sh.y1, u.x, u.y) < 110) { pl.artyT = S.t; break; }
  const p = apPt(pl.obj);
  if (pl.obj != null && !p) { apIdle(pl); return; }
  const gar = pl.ph === 'garrison', cap = apCap(u);
  if (pl.ph !== 'supply' && pl.ph !== 'regroup') {
    // 轮流补给：同一目标还有别的排在场掩护、又没有排在补给时，弹药不足 30 就轮到本排下去补（补给点 600 以内）；不足 15 则不等
    const mates = Object.keys(P.u).filter(id => +id !== u.id && P.u[id].obj != null && P.u[id].obj === pl.obj);
    if (ammo < 30 && ammo >= (gar ? 8 : 15) && pl.obj != null && mates.some(id => P.u[id].ph === pl.ph) && !mates.some(id => P.u[id].ph === 'supply')) {
      const sp = apSupplyPt(u.x, u.y);
      if (sp && dist(sp.x, sp.y, u.x, u.y) < 600 && apFallback(u, pl, 'supply', 600)) {
        v8Stat('uRepTurn');
        if (typeof chatSay === 'function') chatSay('p', `命令：${typeof cmdUName === 'function' ? cmdUName(u) : unitName(u)}轮换下去补充弹药，其余各排留在原地接替掩护。`, { kind: 'order', at: u, key: 'aprot' + pl.obj, gap: 60, lv: 2 });
        return;
      }
    }
    if (ammo < (gar ? 8 : 15)) {
      if (apFallback(u, pl, 'supply', gar ? 300 : Infinity)) return;
      // 弹尽且无处补给：不在敌前干站着，退到附近掩蔽处等补给线修通
      if (ammo < 5 && !gar && apFallback(u, pl, 'regroup', 0)) return;
    }
    else if (u.state === 'waver' && !gar && cap >= 54 && apFallback(u, pl, 'regroup', 450)) return;
  }
  for (const q of ts) if (q.order.t === 'move' && q.order.x != null && S.t - q.movedT > 12 && q.sup < 50 && S.t - (pl.ordT ?? -99) > 12) q.order = { t: 'hold' };   // 槽位走不到而卡住
  const holding = ts.every(q => q.order.t === 'hold'), nHold = ts.filter(q => q.order.t === 'hold').length;
  switch (pl.ph) {
    case 'supply': case 'regroup': {
      const done = pl.ph === 'supply' ? ammo >= 50 : u.state === 'ok' && u.morale >= Math.min(62, cap - 4) && ammo >= 15;
      if (done || S.t - (pl.spT ?? S.t) > 120) { apResume(u, pl, P); return; }
      if (pl.sp && !apSpValid(pl.sp) && apSupplyPt(u.x, u.y)) apFallback(u, pl, pl.ph, Infinity, true);   // 补给点被毁或断开：换一个接通的
      return;
    }
    case 'icpt': {   // 拦截渗透之敌：追向袭扰分队最后被看见的位置，60 秒或目标消失后归建
      const r = (S.raids || []).find(r => r.id === pl.raid), tq = r && S.teams.find(q => r.teams.includes(q.id) && q.men.length && q.seen != null);
      if (!tq || S.t - (pl.icT ?? S.t) > 60) { apIdle(pl); return; }
      if (S.t - (pl.ordT ?? -99) > 6 || dist(pl.dx ?? 0, pl.dy ?? 0, tq.sx, tq.sy) > 60) apMove(u, pl, tq.sx, tq.sy, apAng(u.x, u.y, tq.sx, tq.sy), 'amove');
      return;
    }
    case 'garrison': {
      if (!p) { apIdle(pl); return; }
      if (p.owner !== 'p') { apLaunch([u], p, P); return; }   // 失守：就地反击
      if (holding && dist(u.x, u.y, p.x, p.y) > 70 && S.t - (pl.ordT ?? -99) > 8) apMove(u, pl, p.x, p.y, apThreatDir(p), 'move');
      return;
    }
    case 'stage': {
      if (!p || apTaken(p)) { if (p) apCaptured(p, P); else apIdle(pl); return; }
      if (pl.sx == null) {
        if (dist(u.x, u.y, p.x, p.y) <= AP_STAGE_MAX + 15) { Object.assign(pl, { ph: 'wait', sx: u.x, sy: u.y, waitT: S.t }); return; }
        const sp = apStageSpot(u, p);
        if (!sp) { P.hard[p.key] = S.t; apIdle(pl); return; }
        pl.sx = sp.x; pl.sy = sp.y;
        if (!apMove(u, pl, sp.x, sp.y, apAng(sp.x, sp.y, p.x, p.y), 'move')) { P.hard[p.key] = S.t; apIdle(pl); }
        return;
      }
      const d = dist(u.x, u.y, pl.sx, pl.sy);
      if (S.t - (pl.t0 ?? S.t) > 200) { Object.assign(pl, { ph: 'wait', waitT: S.t }); return; }   // 集结久不到位（指挥官缺席时的兜底）：就地转入待攻
      if (d < 28 || (holding && d < 70) || (nHold * 2 >= ts.length && d < 90)) { Object.assign(pl, { ph: 'wait', waitT: S.t }); return; }
      if ((holding && S.t - (pl.ordT ?? -99) > 6) || S.t - (pl.ordT ?? -99) > 100) apMove(u, pl, pl.sx, pl.sy, apAng(pl.sx, pl.sy, p.x, p.y), 'move');
      return;
    }
    case 'wait': {
      if (!p || apTaken(p)) { if (p) apCaptured(p, P); else apIdle(pl); return; }
      const O = P.o[p.key] || (P.o[p.key] = { go: false, t: 0, need: 1 });
      if (O.go) { apLaunch([u], p, P); return; }   // 攻击已发起：直接跟进
      const grp = apGroup(p.key, P), ready = grp.filter(g => P.u[g.id].ph === 'wait');
      // 不在滩头或炮火下干等：滩头上、刚挨炮击或被压制时立即发起
      const exposed = coastAt(u.x) - u.y < 90 || S.t - (pl.artyT ?? -99) < 6 || ts.reduce((a, q) => a + q.sup, 0) / ts.length > 40;
      if (typeof tfOn === 'function' && tfOn()) { tfMass(u, p, grp, ready, exposed, pl, P, O); return; }   // v7：按兵力比凑足再统一发起（tf.js）
      if (exposed || ready.length >= Math.min(O.need || 1, grp.length) || S.t - (pl.waitT ?? S.t) >= AP_WAIT) apLaunch(exposed ? [u] : ready, p, P);
      return;
    }
    case 'go': {
      if (!p || apTaken(p)) { if (p) apCaptured(p, P); else apIdle(pl); return; }
      const O = P.o[p.key] || (P.o[p.key] = { go: true, t: S.t, need: 1, pg: p.prog, pgT: S.t });
      if (p.prog > (O.pg ?? 0) + .01) { O.pg = p.prog; O.pgT = S.t; } else if (p.prog < (O.pg ?? 0)) O.pg = p.prog;
      // 伤亡过半：退下重整，此据点暂缓
      if ((u.men || 0) < (pl.men0 || 0) * .45 && S.t - (pl.goT ?? S.t) > 15) {
        P.hard[p.key] = S.t; pl.obj = null;
        if (!apFallback(u, pl, 'regroup', 600)) apIdle(pl);
        return;
      }
      // 久攻不下：整组放弃，重新选择目标
      if (S.t - (O.t || S.t) > 200) {
        P.hard[p.key] = S.t;
        for (const g of apGroup(p.key, P)) apIdle(P.u[g.id]);
        delete P.o[p.key];
        return;
      }
      // 停顿（指挥官催促前不自行再压上）；指挥官缺席时 45 秒后自行恢复
      if (pl.halt != null) { if (S.t - pl.halt < 45) return; pl.halt = null; }
      const d = dist(u.x, u.y, p.x, p.y), stuck = ts.some(q => dist(q.x, q.y, p.x, p.y) < 70) && S.t - (O.pgT ?? S.t) > 25;
      const fm = typeof tfFormOf === 'function' ? tfFormOf(u.id) : null;   // 队形推进中（tf.js 管跃进）：冲锋距离收到 110
      if (u.morale >= 55 && d < (fm ? 110 : 150) && S.t - (pl.chT ?? -99) > 15 && (apShaken(p) || stuck) && apOdds(p, apShaken(p) ? 1 : 1.3)) {
        if (orderUnits([u], p.x, p.y, apAng(u.x, u.y, p.x, p.y), null, 'charge')) { pl.chT = S.t; pl.ordT = S.t; if (stuck) O.pgT = S.t; }
        return;
      }
      if (fm) return;
      if (holding && d > 35 && S.t - (pl.ordT ?? -99) > 6) apLaunch([u], p, P);   // 指令走完仍未占领：再次压上
      return;
    }
  }
}

// —— 工兵：浮桥抢修 > 运输线抢修 > 重建 / 修补补给点 > 新建补给点 > 排除进攻路线上的已知雷区 ——
function apTeamGo(q, x, y, t) {
  if (!isFinite(x) || !isFinite(y)) return false;
  if (!passInf(x, y)) { const j = nearestPassable(ci(x, y), 'p'); if (j < 0) return false; x = cellCX(j); y = cellCY(j); }
  if (!reachable(q.x, q.y, x, y, 'p')) return false;
  if (q.order.t === t && q.order.x != null && dist(q.order.x, q.order.y, x, y) < 8) return true;   // 已在途中
  orderTeams([q], x, y, t);
  return true;
}
function apMineTasks(P) {
  const out = [], routes = [];
  for (const u of S.units) if (u.side === 'p' && u.auto === true && u.kind === 'inf' && u.x != null) {
    const pl = P.u[u.id];
    if (!pl) continue;
    const tx = pl.dx ?? pl.sx, ty = pl.dy ?? pl.sy;
    if (tx != null && isFinite(tx)) routes.push([u.x, u.y, tx, ty]);
    const p = apPt(pl.obj);
    if (p) routes.push([pl.sx ?? u.x, pl.sy ?? u.y, p.x, p.y]);
  }
  const N = S.snet && Array.isArray(S.snet.nodes) ? S.snet.nodes : [];
  for (const m of S.mines) if (m.known && m.clr < 1) {
    const hit = routes.some(r => segDist(m.x, m.y, r[0], r[1], r[2], r[3]) < m.r + 25) || N.some(n => n.path && n.path.length > 1 && polyDist(m.x, m.y, n.path) < m.r + 15);
    if (hit) out.push({ k: 'm' + m.id, kind: 'mine', id: m.id, x: m.x, y: m.y, pri: 4 });
  }
  return out;
}
function apEngineer(u, pl, P) {
  const q = teamsOf(u).find(t => t.kind === 'eng' && t.men.length);
  if (!q) return;
  if (q.repairing) { pl.job = { k: 'pontoon', kind: 'pontoon', x: q.x, y: q.y }; return; }
  const L = S.supply.find(l => l.eng === q.id && l.segs.some(g => !g.ok));
  if (L) {   // 本线浮桥断了：先回滩头，由 updateSupply 接手抢修
    pl.job = { k: 'pontoon' + L.id, kind: 'pontoon', x: L.x, y: L.y };
    if (dist(q.x, q.y, L.x, L.y) > 45) apTeamGo(q, L.x, L.y - 8, 'move');
    else if (q.order.x != null || q.order.t !== 'hold') q.order = { t: 'hold' };
    return;
  }
  const claimed = new Set();
  for (const o of S.units) if (o !== u && o.side === 'p' && o.auto === true && o.kind === 'eng' && P.u[o.id] && P.u[o.id].job) claimed.add(P.u[o.id].job.k);
  pl.skip = pl.skip && typeof pl.skip === 'object' ? pl.skip : {};
  for (const k in pl.skip) if (S.t - pl.skip[k] > 60) delete pl.skip[k];
  const tasks = (typeof snTasks === 'function' ? snTasks() : []).concat(apMineTasks(P), typeof cmdEngTasks === 'function' ? cmdEngTasks() : []);
  let best = null, bs = Infinity;
  for (const t of tasks) {
    const cur = pl.job && pl.job.k === t.k;
    if ((claimed.has(t.k) && !cur) || pl.skip[t.k] != null || apDanger(t.x, t.y) || apShelling(t.x, t.y, 70) || (typeof cbWait === 'function' && cbWait(t.x, t.y))) continue;   // 打补给线的炮正被反炮兵射击：等打掉再修
    const s = t.pri + dist(q.x, q.y, t.x, t.y) / 400 - (cur ? .6 : 0);   // 已接手的任务优先保持
    if (s < bs) { bs = s; best = t; }
  }
  if (!best) { pl.job = null; apEngFollow(u, q, pl, P); return; }   // 无事可做：跟进保障
  pl.job = { k: best.k, kind: best.kind, x: best.x, y: best.y };
  if (best.kind === 'mine') {
    const m = S.mines.find(m => m.id === best.id);
    if (!m) return;
    const d = dist(q.x, q.y, m.x, m.y);
    if (d < m.r + 26) { if (q.order.t !== 'clear' || q.order.x != null) q.order = { t: 'clear' }; return; }   // engineerWork 接手排雷
    if (!apTeamGo(q, m.x + (q.x - m.x) / d * (m.r + 10), m.y + (q.y - m.y) / d * (m.r + 10), 'clear')) { pl.skip[best.k] = S.t; pl.job = null; }
    return;
  }
  if (best.kind === 'bridge') {   // 修桥（ai3.js a3Repair）：站到本侧桥头 40 以内坚守即施工
    const d = dist(q.x, q.y, best.x, best.y) || 1, sx = best.x + (q.x - best.x) / d * 18, sy = best.y + (q.y - best.y) / d * 18;
    if (d > 32) { if (!apTeamGo(q, sx, sy, 'move')) { pl.skip[best.k] = S.t; pl.job = null; } }
    else if (q.order.x != null || q.order.t !== 'hold') q.order = { t: 'hold' };
    return;
  }
  if (dist(q.x, q.y, best.x, best.y) > 12) { if (!apTeamGo(q, best.x, best.y, 'move')) { pl.skip[best.k] = S.t; pl.job = null; } }
  else if (q.order.x != null || q.order.t !== 'hold') q.order = { t: 'hold' };   // 到位：updateSupplyNet 计施工进度
}

// 跟进保障：没有活干的工兵跟在离自己最近的进攻排后方约 130（背向目标一侧、敌火力以外），到时就近排雷、剪网、修路，不在滩头干等
function apEngFollow(u, q, pl, P) {
  const ok = g => !!g && g.side === 'p' && g.kind === 'inf' && g.auto === true && g.state !== 'rout' && g.x != null && !!P.u[g.id] && ['stage', 'wait', 'go', 'bg'].includes(P.u[g.id].ph);
  let best = null, bd = 1400;
  for (const g of S.units) {
    if (!ok(g)) continue;
    const d = dist(g.x, g.y, q.x, q.y);
    if (d < bd) { bd = d; best = g; }
  }
  // 跟定一个排：原来跟的那个排还能跟、又没比最近的远出太多，就继续跟它——否则两个排离得差不多远时，工兵每走几步「最近的排」就换一个，来回掉头
  const cur = pl.fol != null ? UNIT_MAP.get(pl.fol) : null;
  if (ok(cur) && (!best || dist(cur.x, cur.y, q.x, q.y) < bd * 1.6 + 150)) best = cur;
  if (!best) { pl.fol = null; return; }
  const g = best, gp = P.u[g.id], p = apPt(gp.obj), a = p ? apAng(g.x, g.y, p.x, p.y) : NORTH;
  let x = g.x - Math.cos(a) * 130 + (u.id % 3 - 1) * 25, y = g.y - Math.sin(a) * 130;
  if (apDanger(x, y)) { x = g.x - Math.cos(a) * 200; y = g.y - Math.sin(a) * 200; }
  pl.fol = g.id;
  if (dist(q.x, q.y, x, y) < 45 || (q.order.x != null && dist(q.order.x, q.order.y, x, y) < 45 && S.t - (pl.folT ?? -99) < 15)) return;
  if (apTeamGo(q, x, y, 'move')) pl.folT = S.t;
}

// —— 渲染（仅图形）：自动排的计划路线（虚线流动箭头）、集结点标记与等待倒计时、攻击目标角框、自动指挥标记 ——
function apRoute(u, x, y) {
  const c = AP_ROUTES.get(u.id);
  if (c && c.S === S && dist(c.tx, c.ty, x, y) < 15 && Math.abs(S.t - c.t) < 3) return c.pts;
  const pts = [[u.x, u.y]], ti = nearestPassable(ci(x, y), 'p'), f = ti >= 0 ? FIELDS.get('p' + ti) : null;   // 只用已缓存的流场，渲染时不新算
  if (f && f.d && isFinite(f.d[ci(u.x, u.y)])) {
    let px0 = u.x, py0 = u.y;
    for (let k = 0; k < 500; k++) {
      const n = nextStep(f.d, px0, py0);
      if (!n) break;
      [px0, py0] = n;
      if (k % 3 === 2) pts.push(n);
      if (dist(px0, py0, x, y) < 12) break;
    }
  }
  pts.push([x, y]);
  if (AP_ROUTES.size > 160) AP_ROUTES.clear();
  AP_ROUTES.set(u.id, { S, tx: x, ty: y, t: S.t, pts });
  return pts;
}

function apChevron(ctx, x, y, a, r) {
  ctx.beginPath();
  ctx.moveTo(x + Math.cos(a - 2.5) * r, y + Math.sin(a - 2.5) * r); ctx.lineTo(x, y); ctx.lineTo(x + Math.cos(a + 2.5) * r, y + Math.sin(a + 2.5) * r);
  ctx.stroke();
}

function drawAutoRoutes(time) {
  const P = S && S.autoPlan && S.autoPlan.u;
  if (!P || S.phase !== 'battle') return;
  const ctx = R.ctx, objs = new Map(), sel = id => typeof isSel === 'function' && isSel(id), mid = R.s >= .75;
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const u of S.units) {
    if (u.side !== 'p' || u.auto !== true || u.x == null || !isFinite(u.x)) continue;
    const pl = P[u.id], ts = teamsOf(u);
    if (!pl || !ts.length) continue;
    const on = sel(u.id), eng = u.kind === 'eng';
    // 自动指挥标记：排旗右侧的小旋转标（与 HUD“自动”按钮同形）
    const top = Math.min(...ts.map(q => q.y)), mx = u.x + px(24), my = top - px(25), r0 = px(3.2), spin = time * 1.5;
    ctx.setLineDash([]); ctx.lineWidth = px(1.1); ctx.strokeStyle = rgba(COL.intel, on ? .95 : .7);
    ctx.beginPath(); ctx.arc(mx, my, r0, 0, 7); ctx.stroke();
    ctx.beginPath();
    for (let k = 0; k < 4; k++) { const a = spin + k * 1.5708; ctx.moveTo(mx + Math.cos(a) * r0 * 1.35, my + Math.sin(a) * r0 * 1.35); ctx.lineTo(mx + Math.cos(a) * r0 * 2, my + Math.sin(a) * r0 * 2); }
    ctx.stroke();
    // 目的地：正在执行的移动指令终点
    const moving = ts.some(q => q.order.x != null && q.order.t !== 'hold');
    let tx = null, ty = null;
    if (moving) {
      if (eng) { const q = ts.find(q => q.order.x != null); tx = q.order.x; ty = q.order.y; }
      else { tx = u.tx ?? pl.dx; ty = u.ty ?? pl.dy; }
    }
    const col = pl.ph === 'go' ? COL.enemy : pl.ph === 'supply' || pl.ph === 'regroup' || eng ? COL.intel : COL.g;
    if (tx != null && isFinite(tx) && isFinite(ty) && dist(u.x, u.y, tx, ty) > 20 && (on || !(typeof hqOn === 'function' && hqOn()))) {   // 指挥体系开着：满屏的排路线只在选中时画，大方向看团的箭头
      const pts = apRoute(u, tx, ty), d0 = dist(u.x, u.y, tx, ty);
      const path = [[u.x, u.y]];
      for (let i = 1; i < pts.length; i++) if (dist(pts[i][0], pts[i][1], tx, ty) < d0 - 6 || i === pts.length - 1) path.push(pts[i]);
      ctx.strokeStyle = rgba(col, on ? .7 : .32); ctx.lineWidth = px(on ? 1.6 : 1.1);
      ctx.setLineDash([px(5), px(6)]); ctx.lineDashOffset = -time * px(14);
      ctx.beginPath(); ctx.moveTo(path[0][0], path[0][1]);
      for (let i = 1; i < path.length; i++) ctx.lineTo(path[i][0], path[i][1]);
      ctx.stroke();
      ctx.setLineDash([]); ctx.lineDashOffset = 0;
      if (mid) {   // 沿途箭头
        let acc = 0;
        for (let i = 1; i < path.length - 1; i++) {
          acc += dist(path[i - 1][0], path[i - 1][1], path[i][0], path[i][1]);
          if (acc < Math.max(70, px(80))) continue;
          acc = 0;
          apChevron(ctx, path[i][0], path[i][1], apAng(path[i - 1][0], path[i - 1][1], path[i][0], path[i][1]), px(4));
        }
      }
      const n = path.length, a = apAng(path[Math.max(0, n - 2)][0], path[Math.max(0, n - 2)][1], tx, ty);
      ctx.strokeStyle = rgba(col, on ? .9 : .55); ctx.lineWidth = px(1.4);
      apChevron(ctx, tx, ty, a, px(7));
    }
    if (eng) {   // 工兵任务点：小菱形
      if (pl.job && isFinite(pl.job.x)) {
        ctx.strokeStyle = rgba(COL.intel, .55); ctx.lineWidth = px(1.1);
        shape(ctx, pl.job.x, pl.job.y, Math.max(5, px(5)), 4, 0); ctx.stroke();
      }
      continue;
    }
    // 集结点：虚线集结圈 + 四向刻度；等待时琥珀色倒计时弧
    if ((pl.ph === 'stage' || pl.ph === 'wait') && pl.sx != null && isFinite(pl.sx)) {
      const r = Math.max(24, px(10));
      ctx.strokeStyle = rgba(COL.g, on ? .7 : .38); ctx.lineWidth = px(1.1); ctx.setLineDash([px(3), px(4)]);
      ctx.beginPath(); ctx.arc(pl.sx, pl.sy, r, 0, 7); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath();
      for (let k = 0; k < 4; k++) { const a = k * 1.5708 + .785; ctx.moveTo(pl.sx + Math.cos(a) * r * .75, pl.sy + Math.sin(a) * r * .75); ctx.lineTo(pl.sx + Math.cos(a) * r * 1.15, pl.sy + Math.sin(a) * r * 1.15); }
      ctx.stroke();
      if (pl.ph === 'wait' && pl.waitT != null) {
        ctx.strokeStyle = rgba(COL.amber, .75); ctx.lineWidth = px(2);
        ctx.beginPath(); ctx.arc(pl.sx, pl.sy, r + px(3), -1.57, -1.57 + clamp((S.t - pl.waitT) / AP_WAIT, 0, 1) * 6.283); ctx.stroke();
      }
      const p = apPt(pl.obj);
      if (p && pl.ph === 'wait') {   // 预定突击方向
        ctx.strokeStyle = rgba(COL.enemy, .22); ctx.lineWidth = px(1); ctx.setLineDash([px(2), px(6)]);
        ctx.beginPath(); ctx.moveTo(pl.sx, pl.sy); ctx.lineTo(p.x, p.y); ctx.stroke(); ctx.setLineDash([]);
      }
    }
    if (pl.obj && pl.ph !== 'supply' && pl.ph !== 'regroup') {
      const o = objs.get(pl.obj) || { ph: pl.ph, sel: false };
      if (pl.ph === 'go' || o.ph === 'garrison') o.ph = pl.ph;   // 攻击 > 集结 > 留守
      o.sel = o.sel || on;
      objs.set(pl.obj, o);
    }
  }
  // 攻击目标：四角框（攻击中为脉动红色，集结中为淡色，留守为绿色虚圈）
  for (const [key, o] of objs) {
    const p = apPt(key);
    if (!p) continue;
    if (o.ph === 'garrison') {
      ctx.strokeStyle = rgba(COL.g, o.sel ? .6 : .3); ctx.lineWidth = px(1.2); ctx.setLineDash([px(1.5), px(4)]);
      ctx.beginPath(); ctx.arc(p.x, p.y, 54, 0, 7); ctx.stroke(); ctx.setLineDash([]);
      continue;
    }
    const go = o.ph === 'go', r = 56, c = r * .35;
    ctx.strokeStyle = go ? rgba(COL.enemy, .45 + .3 * Math.sin(time * 5)) : rgba(COL.enemy, o.sel ? .55 : .28); ctx.lineWidth = px(go ? 1.8 : 1.2);
    ctx.beginPath();
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      ctx.moveTo(p.x + sx * r, p.y + sy * (r - c)); ctx.lineTo(p.x + sx * r, p.y + sy * r); ctx.lineTo(p.x + sx * (r - c), p.y + sy * r);
    }
    ctx.stroke();
  }
  ctx.restore();
}
