'use strict';
// 守军指挥官 AI：只依据己方观察哨、部队与雷达看到的情报决策，不开全图
const DIFF = {
  normal: { name: '普通', beachBunkers: 1, beachMines: 1, coastal: 2, arty: 3, mortars: 3, aa: 3, garrison: 0, ambush: 1, reserves: 3, waves: 2, waveEvery: 240, waveSize: 2,
    morale: 55, nerve: 1.2, think: 2.5, err: 30, lead: .5, radio: .15, hold: 100, scoot: 3, ratio: 1.6, acc: .9, dig: .8 },
  hard: { name: '困难', beachBunkers: 2, beachMines: 2, coastal: 3, arty: 4, mortars: 5, aa: 3, garrison: 0, ambush: 2, reserves: 6, waves: 5, waveEvery: 180, waveSize: 2,
    morale: 65, nerve: 1, think: 1.4, err: 21, lead: .85, radio: .4, hold: 120, scoot: 2, ratio: 1.25, acc: 1.05, dig: .55 },
  hell: { name: '地狱', beachBunkers: 2, beachMines: 3, coastal: 4, arty: 6, mortars: 7, aa: 5, garrison: 1, ambush: 3, reserves: 9, waves: 7, waveEvery: 130, waveSize: 3,
    morale: 80, nerve: .75, think: .7, err: 15, lead: 1, radio: .6, hold: 130, scoot: 1, ratio: 1.05, acc: 1.2, dig: .45 }
};
let AIC = null;   // 由地形派生的缓存（据点周围掩体格），不进 S
const aiD = () => DIFF[S && S.level] || DIFF.hard;
const ptByKey = k => S.points.find(p => p.key === k);

function aiInit(level) {
  S.ai = { level, cd: 2, waves: 0, nextWave: DIFF[level].waveEvery * .6, reg: [], said: {} };
  aiCache();
  if (typeof a4Init === 'function') a4Init();   // v7 守方协同状态（ai4.js）
}

function aiCache() {
  AIC = { cover: {} };
  for (const p of (typeof S === 'object' && S && S.points) || TER.points) {   // 含开战后加入的据点（abn.js 野战机场）
    const spots = [];
    eachCellIn(p.x, p.y, 55, i => { const t = TER.type[i]; if (TP[t].sp) spots.push({ x: cellCX(i), y: cellCY(i), c: 1 - TP[t].cv }); });
    AIC.cover[p.key] = spots;
  }
}

function sayOnce(key, msg, p, kind = 'warn', at) {
  if (S.ai.said[key]) return;
  S.ai.said[key] = 1;
  if (Math.random() < p) log(msg, kind, null, 0, at);
}

// 调往某据点的散兵编入该据点的预备排（不超过 4 组）；正由 ai4 整排调动 / 反冲击的排不编（散兵不会跟着走，反而拖住整排）
function aiUnitFor(k) {
  return S.units.find(u => u.side === 'e' && u.obj === k && u.role === 'reserve' && u.state !== 'rout' && teamsOf(u).length < 4 && !(typeof a4UnitBusy === 'function' && a4UnitBusy(u.id))) ||
    addUnit('e', 'inf', { role: 'reserve', obj: k });
}

const aiGo = (q, x, y, t, gx, gy) => { q.order = { t, x, y, gx: gx ?? x, gy: gy ?? y }; q.pathT = -9; };

function aiRout(q) {
  const p = ptByKey(q.obj) || S.points[0];
  aiGo(q, p.x + gauss() * 15, p.y - 30, 'retreat', p.x, p.y);
  q.px = null;
  if (inVision(q.x, q.y)) log('敌军被压制后撤', 'good', 'erout', 8, q);
}

// 据点附近、面向威胁一侧且掩护好的位置：能挖散兵坑的地方（道路、桥梁、城镇以外）挖好后约相当于林地的掩护；
// 各组散开（18 以内重罚、30 以内轻罚）——挤在一处，一发舰炮（杀伤半径 36）就能打掉几个组
function aiSpotSc(q, p, s, fx, fy) {
  const dx0 = fx - p.x, dy0 = fy - p.y, l = Math.hypot(dx0, dy0) || 1, dx = s.x - p.x, dy = s.y - p.y, dd = Math.hypot(dx, dy) || 1;
  let crowd = 0;
  for (const o of S.teams) if (o !== q && o.side === 'e' && o.px != null && o.men.length) { const d = dist(o.px, o.py, s.x, s.y); if (d < 18) crowd += 2.5; else if (d < 30) crowd += .8; }
  const t = typeAt(s.x, s.y), dig = t !== T.TOWN && t !== T.ROAD && t !== T.BRIDGE ? .45 : 0;
  return Math.max(s.c ?? 1 - coverAt(s.x, s.y), dig) * 2 + (dx * dx0 + dy * dy0) / dd / l * .8 - crowd - dd / 110;
}
function aiSpot(q, p, fx, fy) {
  let best = null, bs = -1e9;
  for (const s of AIC.cover[p.key] || []) {
    const sc = aiSpotSc(q, p, s, fx, fy) + Math.random() * .1;
    if (sc > bs) { bs = sc; best = s; }
  }
  return best || p;
}
// 不来回挪位：换到新位置要比现在明显好（已在挖好的坑里再加一截）——每挪一次就暴露（conceal.js）、坑也白挖了
function aiSpotKeep(q, p, cur, nx, fx, fy) {
  if (!cur || dist(cur.x, cur.y, p.x, p.y) > 70 || dist(q.x, q.y, cur.x, cur.y) > 8) return false;
  const h = typeof digHole === 'function' ? digHole(q) : null;
  return aiSpotSc(q, p, nx, fx, fy) - aiSpotSc(q, p, cur, fx, fy) < .6 + (h && h.d > .5 ? .8 : 0);
}

function stagingSpot(p, I) {
  const away = Math.atan2(p.y - I.fy, p.x - I.fx);
  let best = null, bs = -1e9;
  for (let i = 0; i < 16; i++) {
    const a = away + (i / 16 - .5) * 2.4, r = 110 + (i % 4) * 15;
    const x = clamp(p.x + Math.cos(a) * r, 15, W - 15), y = clamp(p.y + Math.sin(a) * r, 15, H - 15);
    if (!passInf(x, y)) continue;
    const sc = 1 - coverAt(x, y) + Math.random() * .3;
    if (sc > bs) { bs = sc; best = { x, y }; }
  }
  return best || { x: p.x, y: Math.max(20, p.y - 120) };
}

// 发射阵地（条令：基本发射阵地 + 预备发射阵地）：火炮、迫击炮开战时就有主阵地和两处预先构筑的预备阵地（e.pos），
//   打完转移只在这几处之间换——沙袋、土堤留在原地不动（guns.js、v3units.js 按 e.pos 画），转移途中是卡车牵引 / 炮组扛着走；
//   开过火的阵地已经暴露，90 秒内不回去；几处都刚用过再另选一处（最多 4 处）
function gunSpot(e, P) {
  const mortar = e.kind === 'mortar', o = P[0] || e;
  let best = null, bs = -1;
  for (let i = 0; i < 14; i++) {
    const a = Math.random() * 6.283, r = (mortar ? 40 : 60) + Math.random() * 60;
    const x = clamp(o.x + Math.cos(a) * r, 20, W - 20), y = clamp(o.y + Math.sin(a) * r, 15, H - 15), d = coastAt(x) - y;
    if (!passInf(x, y) || d < (mortar ? 110 : 250) || (mortar && d > 260) || P.some(p => dist(p.x, p.y, x, y) < (mortar ? 25 : 40))) continue;
    const sc = 1 - coverAt(x, y) + Math.random() * .2;
    if (sc > bs) { bs = sc; best = { x: Math.round(x), y: Math.round(y) }; }
  }
  return best;
}
const gunMobile = e => (e.kind === 'arty' || e.kind === 'mortar') && !e.decoy;
function gunPos(e) {
  if (!e.pos) { e.pos = [{ x: e.x, y: e.y }]; for (let k = 0; k < 2; k++) { const p = gunSpot(e, e.pos); if (p) e.pos.push(p); } }
  return e.pos;
}
function relocate(e) {
  const P = gunPos(e), cur = P.find(p => dist(p.x, p.y, e.x, e.y) < 4);
  if (cur) cur.used = S.t;
  let best = null, bs = -Infinity;
  for (const p of P) {
    if (p === cur || S.t - (p.used ?? -999) < 90) continue;
    const s = (p.used != null ? -1 : 0) + Math.random() * .5;   // 没用过的预备阵地优先
    if (s > bs) { bs = s; best = p; }
  }
  if (!best && P.length < 4) { best = gunSpot(e, P); if (best) P.push(best); }
  if (!best) best = P.filter(p => p !== cur).sort((a, b) => (a.used ?? -999) - (b.used ?? -999))[0];
  if (best) Object.assign(e, { moving: true, mx: best.x, my: best.y, salvos: 0, mspd: e.kind === 'mortar' ? 5 : e.mspd });   // 迫击炮组扛着炮走，慢
}

function aiUpdate(dt) {
  const A = S.ai, D = aiD();
  for (const e of S.enemies) if (!e.pos && !e.dead && gunMobile(e)) gunPos(e);
  for (const e of S.enemies) if (e.moving && !e.dead) {
    const d = dist(e.x, e.y, e.mx, e.my), sp = Math.min(d, (e.mspd || 9) * dt);   // 火炮牵引转移 9；导弹发射车开得快（mspd）
    if (d < 1) { e.moving = false; e.cd = Math.max(e.cd, 2); continue; }
    e.x += (e.mx - e.x) / d * sp; e.y += (e.my - e.y) / d * sp;
  }
  if (A.waves < D.waves && S.t >= A.nextWave) {
    A.waves++; A.nextWave += D.waveEvery;
    const p = S.points.filter(p => p.owner === 'p').sort((a, b) => b.vp - a.vp)[0] || ptByKey('HQ') || S.points[0];
    const uw = addUnit('e', 'inf', { role: 'reserve', obj: p.key });
    for (let k = 0; k < D.waveSize; k++) {
      const q = addTeam('e', clamp(p.x + gauss() * 60, 20, W - 20), 12, ['rifle', 'rifle', 'mg'], { role: 'reserve', obj: p.key, u: uw.id });
      aiGo(q, p.x + gauss() * 20, p.y + gauss() * 20, 'move', p.x, p.y);
    }
    log('截获敌方无线电：北面有增援部队开来', 'warn');
  }
  if ((A.cd -= dt) > 0) return;
  A.cd = D.think;
  aiThink(D);
}
