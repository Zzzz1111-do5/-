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
}

function aiCache() {
  AIC = { cover: {} };
  for (const p of TER.points) {
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

// 调往某据点的散兵编入该据点的预备连（不超过 4 组）
function aiUnitFor(k) {
  return S.units.find(u => u.side === 'e' && u.obj === k && u.role === 'reserve' && u.state !== 'rout' && teamsOf(u).length < 4) ||
    addUnit('e', 'inf', { role: 'reserve', obj: k });
}

const aiGo = (q, x, y, t, gx, gy) => { q.order = { t, x, y, gx: gx ?? x, gy: gy ?? y }; q.pathT = -9; };

function aiRout(q) {
  const p = ptByKey(q.obj) || S.points[0];
  aiGo(q, p.x + gauss() * 15, p.y - 30, 'retreat', p.x, p.y);
  q.px = null;
  if (inVision(q.x, q.y)) log('敌军被压制后撤', 'good', 'erout', 8, q);
}

// 据点附近、面向威胁一侧且掩护好的位置
function aiSpot(q, p, fx, fy) {
  const dx0 = fx - p.x, dy0 = fy - p.y, l = Math.hypot(dx0, dy0) || 1;
  let best = null, bs = -1e9;
  for (const s of AIC.cover[p.key]) {
    const dx = s.x - p.x, dy = s.y - p.y, dd = Math.hypot(dx, dy) || 1;
    const crowd = S.teams.some(o => o !== q && o.side === 'e' && o.px != null && dist(o.px, o.py, s.x, s.y) < 14);
    const sc = s.c * 2 + (dx * dx0 + dy * dy0) / dd / l * .8 - (crowd ? 3 : 0) - dd / 110 + Math.random() * .1;
    if (sc > bs) { bs = sc; best = s; }
  }
  return best || p;
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

function relocate(e) {
  const mortar = e.kind === 'mortar';
  let best = null, bs = -1;
  for (let i = 0; i < 14; i++) {
    const a = Math.random() * 6.283, r = (mortar ? 40 : 60) + Math.random() * 60;
    const x = clamp(e.x + Math.cos(a) * r, 20, W - 20), y = clamp(e.y + Math.sin(a) * r, 15, H - 15), d = coastAt(x) - y;
    if (!passInf(x, y) || d < (mortar ? 110 : 250) || (mortar && d > 260)) continue;
    const sc = 1 - coverAt(x, y) + Math.random() * .2;
    if (sc > bs) { bs = sc; best = { x, y }; }
  }
  if (best) Object.assign(e, { moving: true, mx: best.x, my: best.y, salvos: 0 });
}

function aiUpdate(dt) {
  const A = S.ai, D = aiD();
  for (const e of S.enemies) if (e.moving && !e.dead) {
    const d = dist(e.x, e.y, e.mx, e.my), sp = Math.min(d, 9 * dt);
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
