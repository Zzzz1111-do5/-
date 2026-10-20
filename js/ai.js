'use strict';
// 守军指挥官 AI：只依据己方观察哨/部队看得到的情报决策，不开全图
const DIFF = {
  normal: { name: '普通', bunkers: 4, arty: 2, waveSize: 2, garrison: 3, dig: .8, think: 2.5, err: 30, lead: .5, radio: .15, hold: 95, scoot: 3, waves: 2, waveEvery: 200, ratio: 1.6, acc: .9 },
  hard: { name: '困难', bunkers: 5, arty: 3, waveSize: 2, garrison: 4, dig: .55, think: 1.4, err: 21, lead: .85, radio: .4, hold: 115, scoot: 2, waves: 5, waveEvery: 100, ratio: 1.25, acc: 1.05 },
  hell: { name: '地狱', bunkers: 6, arty: 4, waveSize: 3, garrison: 5, dig: .45, think: .7, err: 15, lead: 1, radio: .6, hold: 125, scoot: 1, waves: 7, waveEvery: 80, ratio: 1.05, acc: 1.2 }
};
let AIC = null;   // 由地形派生的缓存（掩体点），不进 S
const aiD = () => DIFF[S.ai && S.ai.level] || DIFF.hard;
const objByKey = k => S.objectives.find(o => o.key === k);

function aiInit(level) {
  S.ai = { level, cd: 2, waves: 0, nextWave: DIFF[level].waveEvery * .6, reg: [], said: {} };
  for (const q of S.squads) if (q.side === 'e') {
    let best = S.objectives[0], bd = 1e9;
    for (const o of S.objectives) { const d = dist(q.x, q.y, o.x, o.y); if (d < bd) { bd = d; best = o; } }
    q.obj = best.key; q.role = bd < 90 ? 'garrison' : 'ambush'; q.order = 'hold';
    q.hold = q.role === 'ambush'; q.px = q.x; q.py = q.y;
  }
  for (let k = 0; k < 2; k++) {
    const q = addSquad('e', 520 + k * 140, 36, ['rifle', 'rifle', 'rifle']);
    Object.assign(q, { role: 'reserve', obj: 'B', order: 'hold', px: q.x, py: q.y });
  }
  aiCache();
}

function aiCache() {
  AIC = { cover: {} };
  for (const o of TER.obj) {
    const spots = [];
    for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
      const x = gx * CELL + 5, y = gy * CELL + 5, t = TER.type[gy * GW + gx];
      if ((t === T.FOREST || t === T.HILL || t === T.TOWN) && dist(x, y, o.x, o.y) < 65) spots.push({ x, y, c: 1 - COVER[t] });
    }
    AIC.cover[o.key] = spots;
  }
}

function sayOnce(key, msg, p, kind = 'warn') {
  if (S.ai.said[key]) return;
  S.ai.said[key] = 1;
  if (Math.random() < p) log(msg, kind);
}

// 目标附近、面向威胁一侧的掩体位置
function aiSpot(q, o, fx, fy) {
  const dx0 = fx - o.x, dy0 = fy - o.y, l = Math.hypot(dx0, dy0) || 1;
  let best = null, bs = -1e9;
  for (const s of AIC.cover[o.key]) {
    const dx = s.x - o.x, dy = s.y - o.y, dd = Math.hypot(dx, dy) || 1;
    const crowd = S.squads.some(o2 => o2 !== q && o2.side === 'e' && o2.px != null && dist(o2.px, o2.py, s.x, s.y) < 14);
    const sc = s.c * 2 + (dx * dx0 + dy * dy0) / dd / l * .8 - (crowd ? 3 : 0) - dd / 120;
    if (sc > bs) { bs = sc; best = s; }
  }
  return best || { x: o.x + gauss() * 20, y: o.y + gauss() * 20 };
}

// 失守目标外围、背向威胁的集结点
function stagingSpot(o, I) {
  const away = Math.atan2(o.y - I.fy, o.x - I.fx);
  let best = null, bs = -1e9;
  for (let i = 0; i < 16; i++) {
    const a = away + (i / 16 - .5) * 2.4, r = 110 + (i % 4) * 15;
    const x = clamp(o.x + Math.cos(a) * r, 15, W - 15), y = clamp(o.y + Math.sin(a) * r, 15, H - 15);
    if (!isLand(x, y) || coastAt(x) - y < 40) continue;
    const sc = 1 - COVER[terrainAt(x, y)] + Math.random() * .3;
    if (sc > bs) { bs = sc; best = { x, y }; }
  }
  return best || { x: o.x, y: Math.max(20, o.y - 120) };
}

function relocate(e) {
  let best = null, bs = -1;
  for (let i = 0; i < 12; i++) {
    const a = Math.random() * 6.283, r = 60 + Math.random() * 70;
    const x = clamp(e.x + Math.cos(a) * r, 20, W - 20), y = clamp(e.y + Math.sin(a) * r, 15, 420);
    if (!isLand(x, y) || coastAt(x) - y < 120) continue;
    const sc = 1 - COVER[terrainAt(x, y)] + Math.random() * .2;
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
    const o = S.objectives.find(o => o.owner === 'p') || pick(S.objectives);
    for (let k = 0; k < D.waveSize; k++) {
      const q = addSquad('e', clamp(o.x + gauss() * 50, 20, W - 20), 10, ['rifle', 'rifle', 'rifle']);
      Object.assign(q, { role: 'reserve', obj: o.key, order: 'hold', px: null });
    }
    log('截获敌方无线电：北面有增援部队接近', 'warn');
  }
  if ((A.cd -= dt) > 0) return;
  A.cd = D.think;
  aiThink(D);
}

function aiThink(D) {
  const A = S.ai;
  const seenSq = S.squads.filter(q => q.side === 'p' && q.men.length && spotted(q.x, q.y));
  const seenShips = S.ships.filter(s => alive(s) && s.state !== 'beached' && spotted(s.x, s.y));
  const foes = S.squads.filter(q => q.side === 'e' && q.men.length);
  for (const s of S.ships)
    if ((s.state === 'unloading' || s.state === 'beached') && spotted(s.x, s.y) && !A.reg.some(r => dist(r.x, r.y, s.x, s.y) < 50)) A.reg.push({ x: s.x, y: s.y });

  // 威胁评估
  const info = {};
  for (const o of S.objectives) {
    let th = 0, cx = 0, cy = 0, w = 0, near = 0;
    for (const q of seenSq) {
      const d = dist(q.x, q.y, o.x, o.y);
      if (d < 320) { const k = (320 - d) / 320; th += q.men.length * k; cx += q.x * k; cy += q.y * k; w += k; }
      if (d < 120) near += q.men.length;
    }
    for (const s of seenShips) {
      const d = dist(s.x, s.y, o.x, o.y);
      if (d < 420 && s.load.squads) { const k = (420 - d) / 420 * .6; th += s.load.squads * 3 * k; cx += s.x * k; cy += s.y * k; w += k; }
    }
    const def = foes.filter(q => q.obj === o.key).reduce((a, q) => a + q.men.length, 0);
    info[o.key] = { o, th, near, def, fx: w ? cx / w : o.x, fy: w ? cy / w : o.y + 250 };
  }
  const keys = S.objectives.map(o => o.key);
  const need = k => (info[k].th + (info[k].o.owner === 'p' ? 8 : 0) + 1) / (info[k].def + 1);

  // 预备队流向压力最大的目标；平静目标抽调多余兵力支援
  for (const q of foes) {
    if (q.order === 'attack') continue;
    const k = keys.reduce((a, b) => need(b) > need(a) ? b : a);
    if (k === q.obj || need(k) < need(q.obj) * 1.5) continue;
    const spare = q.role === 'reserve' || (q.role === 'garrison' && info[q.obj].th < 2 && foes.filter(o => o.obj === q.obj && o.role === 'garrison').length > 1);
    if (!spare) continue;
    info[q.obj].def -= q.men.length; info[k].def += q.men.length;
    Object.assign(q, { obj: k, role: 'reserve', px: null });
  }

  for (const q of foes) {
    // 散兵合并，残兵后撤
    if (q.men.length === 1) {
      const m = foes.find(o => o !== q && o.men.length && o.men.length < 3 && dist(o.x, o.y, q.x, q.y) < 25);
      if (m) { m.men.push(...q.men); q.men = []; continue; }
      if (q.order !== 'retreat') { const o = objByKey(q.obj); Object.assign(q, { order: 'retreat', hold: false, px: o.x + gauss() * 15, py: o.y - 30 }); }
    }
    // 滩头伏击组：被压倒性兵力接近时边打边撤
    if (q.role === 'ambush') {
      const near = seenSq.filter(p => dist(p.x, p.y, q.x, q.y) < 120).reduce((a, p) => a + p.men.length, 0);
      if (near > q.men.length * 2.5) { Object.assign(q, { role: 'garrison', hold: false, px: null }); sayOnce('fall' + q.id, `${gridRef(q.x, q.y)} 方向敌军正在后撤`, .6, 'info'); }
    }
  }

  // 反击或坚守
  for (const k of keys) {
    const I = info[k], o = I.o, mine = foes.filter(q => q.obj === k && q.men.length > 1 && q.role !== 'ambush');
    const men = mine.reduce((a, q) => a + q.men.length, 0), lost = o.owner === 'p' || o.prog > .25;
    if (lost && men >= Math.max(4, I.near * D.ratio)) {
      for (const q of mine) if (q.order !== 'attack') { q.order = 'attack'; q.hold = false; }
      sayOnce('atk' + k + Math.floor(S.t / 60), `截获敌方通讯片段：「……向 ${gridRef(o.x, o.y)} 反击……」`, .5);
      continue;
    }
    for (const q of mine) {
      if (q.order === 'attack') { q.order = 'hold'; q.px = null; }
      if (q.order !== 'hold') continue;
      if (lost) {
        if (q.px == null || dist(q.px, q.py, o.x, o.y) < 90) { const sp = stagingSpot(o, I); q.px = sp.x; q.py = sp.y; }
      } else if (q.px == null || S.t - (q.posT || 0) > 12) {
        const sp = aiSpot(q, o, I.fx, I.fy); q.px = sp.x; q.py = sp.y; q.posT = S.t;
      }
    }
  }
  aiArtillery(D, seenSq, seenShips);
}

// 炮兵火控：按预期杀伤挑目标、对移动目标提前量射击、高价值目标多炮齐射，打完就转移
function aiArtillery(D, seenSq, seenShips) {
  const ready = S.enemies.filter(e => e.kind === 'arty' && !e.dead && !e.moving && e.cd <= 0);
  if (!ready.length) return;
  const T = [];
  for (const s of seenShips) {
    const men = s.load.squads * 3 + s.load.eng, moving = s.state === 'move', a = Math.atan2(s.ty - s.y, s.tx - s.x);
    const v = s.state === 'unloading' ? (men + 6) * 1.5 : moving ? men + 2 : men * 1.2 + 2;
    T.push({ x: s.x, y: s.y, v, vx: moving ? Math.cos(a) * 26 : 0, vy: moving ? Math.sin(a) * 26 : 0 });
  }
  for (const q of seenSq) {
    let m = 0;
    for (const o of seenSq) if (dist(o.x, o.y, q.x, q.y) < 32) m += o.men.length;
    T.push({ x: q.x, y: q.y, v: m * .9 * COVER[terrainAt(q.x, q.y)] + (q.kind === 'eng' ? (q.working ? 6 : 3) : 0), vx: 0, vy: 0 });
  }
  for (const L of S.supply) if (L.connected) {
    const g = L.segs[0], users = seenSq.filter(q => dist(q.x, q.y, L.x, L.y) < 170).length;
    T.push({ x: (g.x0 + g.x1) / 2, y: (g.y0 + g.y1) / 2, v: 2 + users * 1.2, vx: 0, vy: 0 });
  }
  for (const b of S.boats) if (!b.dead && spotted(b.x, b.y)) {
    const L = S.rlines.find(l => l.id === b.line), a = Math.atan2(L.y1 - L.y0, L.x1 - L.x0);
    T.push({ x: b.x, y: b.y, v: 4, vx: Math.cos(a) * 40, vy: Math.sin(a) * 40 });
  }
  for (const t of T) for (const sh of S.shells) if (sh.side === 'e' && dist(sh.x1, sh.y1, t.x, t.y) < 40) t.v *= .35;
  T.sort((a, b) => b.v - a.v);
  const best = T[0];
  if (!best || best.v < 2) return;
  const n = best.v >= 10 ? ready.length : best.v >= 5 ? Math.min(2, ready.length) : 1;
  const reg = S.ai.reg.some(r => dist(r.x, r.y, best.x, best.y) < 60) ? .55 : 1;
  for (let i = 0; i < n; i++) {
    const e = ready[i], dur = 3.2, err = D.err * reg;
    fireShell(e.x, e.y, best.x + best.vx * dur * D.lead + gauss() * err, best.y + best.vy * dur * D.lead + gauss() * err, 'e', 'arty', dur, !inVision(e.x, e.y));
    e.cd = 8 + Math.random() * 3;
    e.salvos = (e.salvos || 0) + 1;
    if (e.salvos >= D.scoot) relocate(e);
  }
  if (n > 1) log(`${n} 个方向同时传来炮声，敌炮兵正在集火`, 'warn', 'tot', 20);
}
