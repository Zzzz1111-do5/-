'use strict';
// 模拟（一）：视野、伤害、登陆舰、步兵小队、敌方火力
let VIS = [];
const RANGE = 115;
const POWER = {
  arty: { men: .5, ship: 2.2, struct: 0, seg: true, R: 30 },
  naval: { men: .7, ship: 3, struct: 7, seg: false, R: 38 },
  bomb: { men: .75, ship: 3, struct: 9, seg: false, R: 34 }
};

// —— 视野：通讯兵、舰船、飞机、侦察航迹 ——
function computeVision() {
  const v = [];
  for (const q of S.squads) if (q.side === 'p' && q.men.includes('radio')) v.push({ x: q.x, y: q.y, r: 95 });
  for (const s of S.ships) if (alive(s)) v.push({ x: s.x, y: s.y, r: s.state === 'beached' ? 40 : 45 });
  for (const p of S.planes) v.push({ x: p.x, y: p.y, r: 70 });
  S.recon = S.recon.filter(p => p.until > S.t);
  for (const p of S.recon) v.push({ x: p.x, y: p.y, r: 75 });
  if (S.destroyer.state !== 'sunk') v.push({ x: S.destroyer.x, y: S.destroyer.y, r: 30 });
  VIS = v;
  for (const e of S.enemies) if (!e.dead && inVision(e.x, e.y)) e.known = true;
  for (const q of S.squads) if (q.side === 'e' && inVision(q.x, q.y)) { q.seen = S.t; q.sx = q.x; q.sy = q.y; }
}
function inVision(x, y, pad = 0) {
  for (const c of VIS) if ((x - c.x) ** 2 + (y - c.y) ** 2 < (c.r + pad) ** 2) return true;
  return false;
}

// —— 伤害 ——
function killMan(q) {
  if (!q.men.length) return;
  const role = q.men.splice(Math.floor(Math.random() * q.men.length), 1)[0];
  if (q.side === 'e') { S.stats.killed++; return; }
  S.stats.lost++;
  if (role === 'radio') { q.radioLost = true; log(`第 ${q.no} 小队通讯兵阵亡，${gridRef(q.x, q.y)} 视野消失`, 'bad'); }
  if (!q.men.length && q.kind === 'eng') log('工兵组全员阵亡，补给线无人维修', 'bad');
}

function damageShip(s, dmg) {
  if (!alive(s)) return;
  s.hp -= dmg;
  if (s.hp > 0) return;
  s.state = 'sunk';
  const aboard = s.load.squads * 3 + s.load.eng;
  S.stats.lost += aboard;
  s.load = { squads: 0, eng: 0 };
  S.fx.push({ kind: 'boom', x: s.x, y: s.y, r: 30, life: 0, max: 1.4, side: 'p' });
  log(aboard ? `${s.label} 被击沉，舰上 ${aboard} 人阵亡` : `${s.label} 残骸被击毁`, 'bad');
}

function damageEnemy(e, dmg) {
  if (e.dead) return;
  e.hp -= dmg;
  if (e.hp > 0) return;
  e.dead = true; e.known = true;
  S.stats.structs = (S.stats.structs || 0) + 1;
  S.fx.push({ kind: 'boom', x: e.x, y: e.y, r: 34, life: 0, max: 1.4, side: 'e' });
  if (inVision(e.x, e.y)) log(`已摧毁敌方${ENEMY_SPEC[e.kind].name}（${gridRef(e.x, e.y)}）`, 'good');
  else log(`${gridRef(e.x, e.y)} 方向发生殉爆，疑似敌方${ENEMY_SPEC[e.kind].name}被毁`, 'good');
}

function impact(x, y, pw, side) {
  const R = pw.R;
  S.fx.push({ kind: 'boom', x, y, r: R, life: 0, max: .9, side });
  for (const q of S.squads) {
    const d = dist(x, y, q.x, q.y);
    if (d >= R) continue;
    const p = pw.men * (1 - d / R * .5) * COVER[terrainAt(q.x, q.y)];
    for (let k = q.men.length; k > 0; k--) if (Math.random() < p) killMan(q);
  }
  for (const s of S.ships) {
    const d = dist(x, y, s.x, s.y);
    if (alive(s) && d < R + 6) damageShip(s, pw.ship * (1 - d / (R + 6) * .5));
  }
  if (pw.struct) for (const e of S.enemies) {
    const d = dist(x, y, e.x, e.y);
    if (!e.dead && d < R + 4) damageEnemy(e, pw.struct * (1 - d / (R + 4) * .4));
  }
  if (pw.seg) for (const L of S.supply) for (const g of L.segs)
    if (g.ok && segDist(x, y, g.x0, g.y0, g.x1, g.y1) < R * .8) {
      g.ok = false; g.rep = 0;
      log('补给线被炮火切断，工兵正前往抢修', 'warn', 'segcut', 3);
    }
  for (const b of S.boats) if (!b.dead && dist(x, y, b.x, b.y) < R) { b.dead = true; S.stats.lost += 3; log('一艘增援艇在途中被击沉', 'bad', 'boat', 3); }
}

// 曳光：敌方火力源不在视野内时只给出带误差的模糊弹道
function tracer(sx, sy, tx, ty, side, srcVisible) {
  let x0 = sx, y0 = sy;
  const fuzzy = side === 'e' && !srcVisible;
  if (fuzzy) { x0 += gauss() * 55; y0 += gauss() * 55; }
  S.tracers.push({ x0, y0, x1: tx, y1: ty, life: 0, max: fuzzy ? .9 : .3, side, fuzzy });
  if (S.tracers.length > 240) S.tracers.splice(0, S.tracers.length - 240);
}

function fireShell(x0, y0, x1, y1, side, kind, dur, fuzzy, extra) {
  const fx0 = fuzzy ? x0 + gauss() * 70 : x0, fy0 = fuzzy ? y0 + gauss() * 70 : y0;
  S.shells.push({ x0, y0, x1, y1, fx0, fy0, t: 0, dur, side, kind, fuzzy, ...extra });
  if (!fuzzy && side === 'e') S.fx.push({ kind: 'flash', x: x0, y: y0, r: 10, life: 0, max: .4, side });
  if (fuzzy) log(`侦测到炮弹弹道，来源方位约 ${fmtBrg(bearing(x1, y1, fx0, fy0))}，大致在 ${gridRef(fx0, fy0)}`, 'warn', 'arty', 6);
}

// —— 登陆舰 ——
function updateShips(dt) {
  for (const s of S.ships) {
    if (s.state === 'unloading') { s.ut += dt; if (s.ut >= 2.5) disembark(s); continue; }
    if (s.state !== 'move') continue;
    const d = dist(s.x, s.y, s.tx, s.ty);
    if (d < 1.5) { s.state = 'idle'; continue; }
    const step = Math.min(d, 26 * dt);
    const nx = s.x + (s.tx - s.x) / d * step, ny = s.y + (s.ty - s.y) / d * step;
    s.heading = Math.atan2(s.ty - s.y, s.tx - s.x);
    if (ny < coastAt(nx) + 3) {
      s.state = 'unloading'; s.ut = 0;
      log(`${s.label} 抢滩（${gridRef(s.x, s.y)}），开始卸载`, 'good');
      continue;
    }
    s.x = nx; s.y = ny;
  }
}

function disembark(s) {
  s.state = 'beached';
  const n = s.load.squads;
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i - (n - 1) / 2) * .5, x = s.x + Math.cos(a) * 18;
    addSquad('p', x, Math.min(s.y + Math.sin(a) * 18, coastAt(x) - 4), ['radio', 'rifle', 'rifle']);
  }
  if (s.load.eng) {
    const e = addSquad('p', s.x, coastAt(s.x) - 3, ['eng', 'eng', 'eng'], { depot: s.id });
    makeSupplyLine(s, e);
    log(`${s.label} 建立滩头补给站，补给线已接通后方`, 'good');
  }
  s.load = { squads: 0, eng: 0 };
}

function makeSupplyLine(s, eng) {
  const x1 = s.x, y1 = s.y + 4, x2 = clamp(s.x + (600 - s.x) * .15, 20, W - 20), y2 = H - 6, n = 6, segs = [];
  for (let i = 0; i < n; i++)
    segs.push({ x0: lerp(x1, x2, i / n), y0: lerp(y1, y2, i / n), x1: lerp(x1, x2, (i + 1) / n), y1: lerp(y1, y2, (i + 1) / n), ok: true, rep: 0 });
  S.supply.push({ id: S.nid++, ship: s.id, eng: eng.id, x: s.x, y: s.y, segs, connected: true });
}

// —— 步兵小队（双方共用）——
function nearestTarget(q, range) {
  let best = null, bd = range;
  for (const o of S.squads) if (o.side !== q.side && o.men.length) {
    const d = dist(q.x, q.y, o.x, o.y);
    if (d < bd) { bd = d; best = { t: o, d, kind: 'sq' }; }
  }
  if (q.side === 'p') for (const e of S.enemies) if (!e.dead) {
    const d = dist(q.x, q.y, e.x, e.y);
    if (d < bd) { bd = d; best = { t: e, d, kind: 'st' }; }
  }
  return best;
}

function objectiveFor(q) {
  let best = null, bd = 1e9;
  const open = S.objectives.filter(o => o.owner !== 'p');
  for (const o of (open.length ? open : S.objectives)) {
    const d = dist(q.x, q.y, o.x, o.y);
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}

function moveSquad(q, gx, gy, dt) {
  const d = dist(q.x, q.y, gx, gy);
  if (d < 3) return;
  const sp = Math.min(d, (q.side === 'p' ? (q.kind === 'eng' ? 30 : 15) : 13) * SPEED[terrainAt(q.x, q.y)] * dt);
  let nx = q.x + (gx - q.x) / d * sp, ny = q.y + (gy - q.y) / d * sp;
  for (const o of S.squads) if (o !== q && o.side === q.side && o.kind === q.kind) {
    const dd = dist(nx, ny, o.x, o.y);
    if (dd < 12 && dd > .01) { nx += (nx - o.x) / dd * (12 - dd) * .3; ny += (ny - o.y) / dd * (12 - dd) * .3; }
  }
  if (q.kind === 'eng' || isLand(nx, ny)) { q.x = clamp(nx, 4, W - 4); q.y = clamp(ny, 4, H - 4); }
}

function fireSquad(q, tg) {
  const t = tg.t, shooters = q.men.length;
  q.cd = 1.15 + Math.random() * .4;
  if (q.side === 'p') { q.ammo = Math.max(0, q.ammo - shooters); S.stats.shots += shooters; }
  for (let i = 0; i < shooters; i++) {
    if (tg.kind === 'sq') {
      if (t.men.length && Math.random() < .26 * (1 - tg.d / RANGE * .45) * COVER[terrainAt(t.x, t.y)]) killMan(t);
    } else if (Math.random() < .55) damageEnemy(t, tg.d < 40 ? 1.4 : .6);
  }
  tracer(q.x, q.y, t.x + gauss() * 6, t.y + gauss() * 6, q.side, q.side === 'p' || inVision(q.x, q.y));
}

function updateSquads(dt) {
  for (const q of S.squads) {
    if (!q.men.length || q.kind === 'eng') continue;
    q.cd -= dt;
    const tg = nearestTarget(q, q.side === 'e' ? 230 : RANGE);
    if (tg && tg.d <= RANGE && q.cd <= 0 && (q.side === 'e' || q.ammo > 0)) fireSquad(q, tg);
    if (q.side === 'p') {
      if (tg && tg.d <= RANGE * .85 && q.ammo > 0) continue;   // 交火中，原地坚守
      const o = objectiveFor(q);
      if (o) moveSquad(q, o.x + q.ox * .6, o.y + q.oy * .6, dt);
    } else if (tg && tg.d > RANGE * .8 && dist(q.home.x, q.home.y, tg.t.x, tg.t.y) < 300) {
      moveSquad(q, tg.t.x, tg.t.y, dt);
    } else if (!tg && dist(q.x, q.y, q.home.x, q.home.y) > 15) moveSquad(q, q.home.x, q.home.y, dt);
  }
}

// —— 敌方固定火力 ——
function spotted(x, y) {
  return S.enemies.some(o => !o.dead && dist(o.x, o.y, x, y) < 260) ||
    S.squads.some(o => o.side === 'e' && o.men.length && dist(o.x, o.y, x, y) < 200);
}

function bunkerFire(e) {
  let best = null, bd = 150;
  for (const q of S.squads) if (q.side === 'p' && q.men.length) {
    const d = dist(e.x, e.y, q.x, q.y);
    if (d < bd) { bd = d; best = { t: q, k: 'sq' }; }
  }
  for (const s of S.ships) if (alive(s) && s.state !== 'beached') {
    const d = dist(e.x, e.y, s.x, s.y);
    if (d < bd) { bd = d; best = { t: s, k: 'ship' }; }
  }
  for (const b of S.boats) if (!b.dead) {
    const d = dist(e.x, e.y, b.x, b.y);
    if (d < bd) { bd = d; best = { t: b, k: 'boat' }; }
  }
  if (!best) { e.cd = .8; return; }
  e.cd = .65;
  const t = best.t, vis = inVision(e.x, e.y);
  if (best.k === 'sq') { if (Math.random() < .14 * COVER[terrainAt(t.x, t.y)]) killMan(t); }
  else if (best.k === 'ship') { if (Math.random() < .5) damageShip(t, .35); }
  else if (Math.random() < .3) { t.dead = true; S.stats.lost += 3; log('一艘增援艇被机枪击沉', 'bad', 'boat', 3); }
  tracer(e.x, e.y, t.x + gauss() * 5, t.y + gauss() * 5, 'e', vis);
  if (!vis) log(`${gridRef(t.x, t.y)} 遭机枪压制，火力来自方位约 ${fmtBrg(bearing(t.x, t.y, e.x, e.y) + gauss() * 14)}`, 'warn', 'mg' + e.id, 9);
}

function artyFire(e) {
  e.cd = 8 + Math.random() * 4;
  const c = [];
  for (const s of S.ships) if (alive(s) && s.state !== 'beached' && spotted(s.x, s.y)) c.push({ x: s.x, y: s.y, w: 3 });
  for (const q of S.squads) if (q.side === 'p' && q.men.length && spotted(q.x, q.y)) c.push({ x: q.x, y: q.y, w: q.kind === 'eng' ? 2 : 1.5 });
  for (const L of S.supply) for (const g of L.segs) if (g.ok) c.push({ x: (g.x0 + g.x1) / 2, y: (g.y0 + g.y1) / 2, w: .25 });
  for (const b of S.boats) if (spotted(b.x, b.y)) c.push({ x: b.x, y: b.y, w: 2 });
  if (!c.length) return;
  let r = Math.random() * c.reduce((a, o) => a + o.w, 0), tg = c[0];
  for (const o of c) { r -= o.w; if (r <= 0) { tg = o; break; } }
  fireShell(e.x, e.y, tg.x + gauss() * 24, tg.y + gauss() * 24, 'e', 'arty', 3.2, !inVision(e.x, e.y));
}

function updateEnemies(dt) {
  for (const e of S.enemies) {
    if (e.dead || (e.cd -= dt) > 0) continue;
    if (e.kind === 'bunker') bunkerFire(e);
    else if (e.kind === 'arty') artyFire(e);
    else e.cd = 1;
  }
}
