'use strict';
// 战斗：伤亡与压制、步兵交火、爆炸与爆破、曳光与弹道、守军固定火力
const RANGE = 140;
const POWER = {
  arty: { men: .38, ship: 1.8, struct: 0, seg: true, R: 30 },
  mortar: { men: .3, ship: 1, struct: 0, seg: false, R: 18 },
  coastal: { men: .6, ship: 3, struct: 0, seg: true, R: 26 },
  naval: { men: .7, ship: 3, struct: 7, seg: false, R: 36 },
  bomb: { men: .75, ship: 3, struct: 9, seg: false, R: 34 }
};

function killMan(q, prefer) {
  if (!q.men.length) return;
  const pi = prefer ? q.men.indexOf(prefer) : -1;
  const role = q.men.splice(pi >= 0 ? pi : Math.floor(Math.random() * q.men.length), 1)[0];
  const u = unitOf(q);
  if (u) { u.morale -= 5 * (S.t - u.flankT < 3 ? 1.5 : 1); u.hitT = S.t; }
  if (q.side === 'e') { S.stats.killed++; return; }
  S.stats.lost++;
  if (role === 'radio') log('通讯兵阵亡，视野丢失', 'bad', 'radio', 4, q);
  if (!q.men.length && q.kind === 'eng') log(`${teamName(q)}全员阵亡`, 'bad');
}
// 压制：来自侧后方（偏离朝向 100° 以上）的火力压制翻倍并打击士气
function suppress(q, v, sx, sy) {
  if (sx != null && angDiff(Math.atan2(sy - q.y, sx - q.x), faceOf(q)) > 1.75) {
    v *= 1.6;
    const u = unitOf(q);
    if (u) u.flankT = S.t;
  }
  q.sup = Math.min(100, q.sup + v); q.hitT = S.t;
  const u = unitOf(q);
  if (u) u.hitT = S.t;
}
// 掩体系数：战壕只挡来自海面一侧（南面）的火力；原地构筑工事；弹坑
function shelter(q, sx, sy) {
  const tr = q.inTrench && (sy == null || sy > q.y - 12) ? .55 : 1;
  return tr * (S.t - q.movedT > 5 ? (q.side === 'e' ? aiD().dig : .75) : 1) * (CRATERC[ci(q.x, q.y)] ? .8 : 1);
}

function damageShip(s, dmg) {
  if (!alive(s)) return;
  s.hp -= dmg;
  if (s.hp > 0) return;
  s.state = 'sunk';
  const aboard = s.load.teams * 3 + s.load.eng;
  S.stats.lost += aboard;
  s.load = { teams: 0, eng: 0 };
  S.fx.push({ kind: 'boom', x: s.x, y: s.y, r: 30, life: 0, max: 1.4, side: 'p' });
  log(aboard ? `${s.label} 被击沉，舰上 ${aboard} 人阵亡` : `${s.label} 残骸被击毁`, 'bad');
}

function damageEnemy(e, dmg) {
  if (e.dead) return;
  e.hp -= dmg;
  if (e.hp > 0) return;
  Object.assign(e, { dead: true, kx: e.x, ky: e.y, moving: false });
  S.stats.structs++;
  S.fx.push({ kind: 'boom', x: e.x, y: e.y, r: 34, life: 0, max: 1.4, side: 'e' });
  log(inVision(e.x, e.y) ? `摧毁${ENEMY_SPEC[e.kind].name}` : `远处殉爆，疑似${ENEMY_SPEC[e.kind].name}被毁`, 'good', null, 0, e);
}

function impact(x, y, pw, side, src) {
  const R = pw.R;
  let forts = false;
  S.fx.push({ kind: 'boom', x, y, r: R, life: 0, max: .9, side });
  if (isLand(x, y)) addCrater(x, y, R * .35);
  for (const q of S.teams) {
    const d = dist(x, y, q.x, q.y);
    if (d < R * 1.7) suppress(q, 70 * (1 - d / (R * 1.7)));
    if (d >= R) continue;
    const p = pw.men * (1 - d / R * .5) * coverAt(q.x, q.y) * shelter(q);
    for (let k = q.men.length; k > 0; k--) if (Math.random() < p) killMan(q);
  }
  for (const s of S.ships) { const d = dist(x, y, s.x, s.y); if (alive(s) && d < R + 6) damageShip(s, pw.ship * (1 - d / (R + 6) * .5)); }
  if (S.dd.state !== 'sunk' && dist(x, y, S.dd.x, S.dd.y) < R * .6) damageDD(src && src.side === 'e' ? { kind: src.kind === 'coastal' ? 'coastal' : 'arty', x: src.x0, y: src.y0 } : null);
  if (S.cv && typeof cvImpact === 'function') cvImpact(x, y, pw);   // 航母甲板受损（carrier.js）
  if (pw.struct) for (const e of S.enemies) {
    const d = dist(x, y, e.x, e.y);
    if (!e.dead && d < R * 2) e.sup = Math.min(100, (e.sup || 0) + 80 * (1 - d / (R * 2)));
    if (!e.dead && d < R + 4) damageEnemy(e, pw.struct * (1 - d / (R + 4) * .4));
  }
  if (typeof supplyImpact === 'function') supplyImpact(x, y, R, pw);   // 补给节点（supplynet.js）
  if (typeof armorImpact === 'function') armorImpact(x, y, R, pw, side);   // 装甲车辆（ai3.js）
  runHook('impact', x, y, R, pw, side);
  if (pw.seg) for (const L of S.supply) for (const g of L.segs)
    if (g.ok && segDist(x, y, g.x0, g.y0, g.x1, g.y1) < R * .8) { g.ok = false; g.rep = 0; log('补给线被炮火切断，工兵前往抢修', 'warn', 'segcut', 3); }
  for (const b of S.boats) if (!b.dead && dist(x, y, b.x, b.y) < R) { b.dead = true; S.stats.lost += 3 * (b.n || 1); log('一艘增援艇在途中被击沉', 'bad', 'boat', 3); }
  // 爆破效果：炸断铁丝网、削弱雷区、摧毁障碍
  for (const w of S.wire) if (!w.cut && segDist(x, y, w.x0, w.y0, w.x1, w.y1) < R * .7) { w.cut = true; forts = true; }
  for (const m of S.mines) if (m.clr < 1 && dist(x, y, m.x, m.y) < R + m.r * .5) { m.clr = Math.min(1, m.clr + .3); forts = true; }
  for (const o of S.obst) if (!o.dead && dist(x, y, o.x, o.y) < R) { o.dead = true; forts = true; }
  if (forts) rebuildForts();
}

// 曳光：敌方火力源不在视野内时只给出带误差的模糊弹道
function tracer(sx, sy, tx, ty, side, srcVisible) {
  let x0 = sx, y0 = sy;
  const fuzzy = side === 'e' && !srcVisible;
  if (fuzzy) { x0 += gauss() * 55; y0 += gauss() * 55; }
  S.tracers.push({ x0, y0, x1: tx, y1: ty, life: 0, max: fuzzy ? .9 : .3, side, fuzzy });
  if (S.tracers.length > 300) S.tracers.splice(0, S.tracers.length - 300);
}

function fireShell(x0, y0, x1, y1, side, kind, dur, fuzzy, extra) {
  const fx0 = fuzzy ? x0 + gauss() * 70 : x0, fy0 = fuzzy ? y0 + gauss() * 70 : y0;
  S.shells.push({ x0, y0, x1, y1, fx0, fy0, t: 0, dur, side, kind, fuzzy, ...extra });
  if (!fuzzy && side === 'e') S.fx.push({ kind: 'flash', x: x0, y: y0, r: 10, life: 0, max: .4, side });
  if (fuzzy) log(`炮击来自方位约 ${fmtBrg(bearing(x1, y1, fx0, fy0))}`, 'warn', 'arty', 6, { x: fx0, y: fy0 });
}

// —— 步兵交火：目标须在本方视野内或近在 50 以内 ——
const canSee = (side, x, y, d) => d < 50 || (side === 'p' ? PV : EV)[ci(x, y)] === 1;
// 兵种修正 mod（目录/沙盒写入，可缺省）：{ pow 命中倍率, rng 射程倍率, rof 射速倍率, sup 压制倍率 }
const modOf = o => o.mod || {};
function findTarget(q, range) {
  let best = null, bd = range * (modOf(q).rng || 1);
  for (const o of S.teams) if (o.side !== q.side && o.men.length && !o.ride) {   // ride：搭乘装甲运兵车中
    const d = dist(q.x, q.y, o.x, o.y);
    if (d < bd && canSee(q.side, o.x, o.y, d)) { bd = d; best = { t: o, d, k: 'tm' }; }
  }
  // 对方车辆（vehicles.js）：轻武器只能压制乘员，优先打步兵；带反坦克手段（mod.at）的小组优先打车
  if (typeof vehFoes === 'function') for (const v of vehFoes(q.side)) {
    const d = dist(q.x, q.y, v.x, v.y), w = d * (modOf(q).at ? .7 : 1.5);
    if (w < bd && canSee(q.side, v.x, v.y, d)) { bd = w; best = { t: v, d, k: 'veh' }; }
  }
  if (q.side === 'p') for (const e of S.enemies) if (!e.dead) {
    const d = dist(q.x, q.y, e.x, e.y);
    if (d < bd && canSee('p', e.x, e.y, d)) { bd = d; best = { t: e, d, k: 'st' }; }
  }
  return best;
}

function teamFire(q, tg) {
  const D = aiD(), t = tg.t, moving = S.t - q.movedT < .3, M = modOf(q);
  q.cd = (1.3 + Math.random() * .4) / (M.rof || 1);
  if (q.side === 'p') {
    if (q.ammo <= 0) return;
    q.ammo = Math.max(0, q.ammo - q.men.length - (q.men.includes('mg') ? 2 : 0));
    S.stats.shots++;
  }
  const uq = unitOf(q), acc = (q.side === 'e' ? D.acc : 1) * (1 - q.sup / 130) * (moving ? .5 : 1) * (1 - tg.d / RANGE * .5) * (uq && uq.state === 'waver' ? .8 : 1) * (M.pow || 1);
  if (tg.k === 'tm') {
    const def = coverAt(t.x, t.y) * shelter(t, q.x, q.y) * (SMOKE[ci(t.x, t.y)] ? .4 : 1);
    if (t.side === 'e') t.hitT = S.t;
    for (const m of q.men) {
      if (m === 'eng') continue;
      const shots = m === 'mg' ? 3 : 1, ph = m === 'mg' ? .08 : m === 'radio' ? .15 : .22;
      for (let s = 0; s < shots; s++) {
        suppress(t, (m === 'mg' ? 7 : 4) * (M.sup || 1), q.x, q.y);
        if (t.men.length && Math.random() < ph * acc * def) killMan(t, q.side === 'e' && Math.random() < D.radio ? 'radio' : null);
      }
    }
  } else if (tg.k === 'veh') vehSmallArms(t, q, acc);
  else for (const m of q.men) {
    if (m === 'eng') continue;
    t.sup = Math.min(100, (t.sup || 0) + (m === 'mg' ? 9 : 5));
    if (Math.random() < .45 * acc) damageEnemy(t, tg.d < 35 ? 2 : .5);
  }
  const vis = q.side === 'p' || inVision(q.x, q.y);
  tracer(q.x, q.y, t.x + gauss() * 5, t.y + gauss() * 5, q.side, vis);
  if (q.men.includes('mg')) tracer(q.x, q.y, t.x + gauss() * 8, t.y + gauss() * 8, q.side, vis);
}

// —— 守军固定火力：碉堡（火力纪律）与岸防重炮（雷达引导）——
function bunkerFire(e) {
  const D = aiD(), M = modOf(e);
  let best = null, bd = 170 * (M.rng || 1);
  for (const q of S.teams) if (q.side === 'p' && q.men.length && !q.ride) {
    const d = dist(e.x, e.y, q.x, q.y);
    if (d < bd && spotted(q.x, q.y)) { bd = d; best = { t: q, k: 'tm' }; }
  }
  // 我方车辆：机枪只能压制乘员、对轻装甲偶有损伤，故优先打步兵（反坦克炮位 mod.at 例外）
  if (typeof vehFoes === 'function') for (const v of vehFoes('e')) {
    const d = dist(e.x, e.y, v.x, v.y), w = d * (M.at ? .7 : 1.4);
    if (w < bd && d < 170 * (M.rng || 1) && spotted(v.x, v.y)) { bd = w; best = { t: v, k: 'veh' }; }
  }
  for (const s of S.ships) if (alive(s) && s.state !== 'beached') {
    const d = dist(e.x, e.y, s.x, s.y);
    if (d < bd && (d < D.hold || s.state === 'unloading')) { bd = d; best = { t: s, k: 'ship' }; }
  }
  for (const b of S.boats) if (!b.dead) { const d = dist(e.x, e.y, b.x, b.y); if (d < bd && d < D.hold) { bd = d; best = { t: b, k: 'boat' }; } }
  if (!best) { e.cd = .8; return; }
  e.cd = 1.2 / (M.rof || 1);
  if (Math.random() < (e.sup || 0) / 110) return;   // 被火力压制，射手缩回掩体
  const t = best.t, vis = inVision(e.x, e.y);
  if (best.k === 'tm') for (let s = 0; s < 3; s++) {
    suppress(t, 9, e.x, e.y);
    if (t.men.length && Math.random() < .1 * D.acc * (M.pow || 1) * coverAt(t.x, t.y) * shelter(t, e.x, e.y)) killMan(t, Math.random() < D.radio ? 'radio' : null);
  } else if (best.k === 'ship') { if (Math.random() < .5 * D.acc) damageShip(t, .35); }
  else if (best.k === 'veh') vehBunkerHit(t, e, D);
  else if (Math.random() < .3) { t.dead = true; S.stats.lost += 3 * (t.n || 1); log('一艘增援艇被机枪击沉', 'bad', 'boat', 3); }
  tracer(e.x, e.y, t.x + gauss() * 5, t.y + gauss() * 5, 'e', vis);
  tracer(e.x, e.y, t.x + gauss() * 9, t.y + gauss() * 9, 'e', vis);
  if (!vis) log(`遭机枪压制，方位约 ${fmtBrg(bearing(t.x, t.y, e.x, e.y) + gauss() * 14)}`, 'warn', 'mg' + e.id, 9, t);
}

function radarUp() { const p = S.points.find(p => p.key === 'RD'); return p && p.owner === 'e' ? p : null; }
const shipSeen = (x, y, radar) => spotted(x, y) || (radar && dist(radar.x, radar.y, x, y) < 520 && !isLand(x, y));

function coastalFire(e) {
  const D = aiD(), radar = radarUp(), dd = S.dd, M = modOf(e), RG = 600 * (M.rng || 1);
  let best = null, bv = 0;
  for (const s of S.ships) if (alive(s) && s.state !== 'beached' && dist(e.x, e.y, s.x, s.y) < RG && shipSeen(s.x, s.y, radar)) {
    const v = 2 + s.load.teams * 3 + s.load.eng + (s.load.veh ? s.load.veh.length * 4 : 0) + (s.state === 'unloading' ? 8 : 0);
    if (v > bv) { bv = v; best = s; }
  }
  if (dd.state !== 'sunk' && dist(e.x, e.y, dd.x, dd.y) < RG && (S.t < dd.exposedUntil || shipSeen(dd.x, dd.y, radar)) && 6 > bv) { bv = 6; best = dd; }
  // 航母（carrier.js）：600 以内且被发现、或起降作业暴露时也是目标；航速 10，提前量按此计算
  const cv = S.cv;
  if (cv && cv.hp > 0 && dist(e.x, e.y, cv.x, cv.y) < RG && (S.t < (cv.exposedUntil || 0) || shipSeen(cv.x, cv.y, radar)) && 7 > bv) { bv = 7; best = cv; }
  // 我方车辆（vehicles.js）：泅渡中的两栖坦克是好靶子；上岸的车辆只在 450 以内且被看见时才打
  if (typeof vehFoes === 'function') for (const v of vehFoes('e')) {
    const d = dist(e.x, e.y, v.x, v.y), val = v.swim ? 3 : 2.2;
    if (val > bv && d < (v.swim ? RG : Math.min(RG, 450)) && (v.swim ? shipSeen(v.x, v.y, radar) : spotted(v.x, v.y))) { bv = val; best = v; }
  }
  if (!best) { e.cd = 2; return; }
  e.cd = (12 + Math.random() * 3) / (M.rof || 1);
  const mv = best.state === 'move' || best.moving, a = best.type ? best.heading : Math.atan2(best.ty - best.y, best.tx - best.x), lead = mv ? (best === cv ? 10 : best.type ? 12 : 26) * 3 * D.lead : 0;
  fireShell(e.x, e.y, best.x + Math.cos(a) * lead + gauss() * D.err * 1.2, best.y + Math.sin(a) * lead + gauss() * D.err * 1.2, 'e', 'coastal', 3, !inVision(e.x, e.y));
  if (e.kx == null && Math.random() < .35) { e.kx = e.x; e.ky = e.y; log('岸防重炮炮口闪光，已标定', 'warn', null, 0, e); }
}

function updateEnemies(dt) {
  for (const e of S.enemies) {
    if (e.sup) e.sup = Math.max(0, e.sup - 15 * dt);
    if (e.dead || e.moving || (e.cd -= dt) > 0) continue;
    if (e.kind === 'bunker') bunkerFire(e);
    else if (e.kind === 'coastal') coastalFire(e);
  }
}
