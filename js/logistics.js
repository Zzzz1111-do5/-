'use strict';
// 战场循环：小组行为、补给线与工兵抢修、增援线、据点争夺、视野与情报记忆、胜负

function polyDist(x, y, pts) {
  let d = 1e9;
  for (let k = 1; k < pts.length; k++) d = Math.min(d, segDist(x, y, pts[k - 1][0], pts[k - 1][1], pts[k][0], pts[k][1]));
  return d;
}

function updateTeams(dt) {
  for (const q of S.teams) {
    if (!q.men.length) continue;
    if (S.t - q.hitT > 2) q.sup = Math.max(0, q.sup - (q.order.t === 'hold' ? 16 : 11) * dt);
    if (S.t - (q.trT ?? -9) > 1) { q.trT = S.t; q.inTrench = S.trench.some(t => polyDist(q.x, q.y, t.pts) < 10); }
    q.cd -= dt;
    mineCheck(q, dt);
    if (!q.men.length) continue;
    const o = q.order;
    // 压制值过高：崩溃后撤（守军在战壕里会死守）
    if (q.sup >= 95 && o.t !== 'retreat' && !(q.side === 'e' && q.inTrench)) {
      if (q.side === 'p') { orderTeams([q], 0, 0, 'retreat'); log(`${teamName(q)}在火力压制下溃退`, 'bad', 'rout' + q.id, 15); }
      else aiRout(q);
      continue;
    }
    let tg = null;
    if (q.kind === 'inf' && o.t !== 'retreat') {
      tg = findTarget(q, RANGE);
      const silent = q.side === 'e' && q.hold && tg && tg.d > 80 && S.t - q.hitT > 8;   // 伏击组隐蔽待机
      if (tg && q.cd <= 0 && !silent) teamFire(q, tg);
    }
    if (q.kind === 'eng' && !q.repairing && (o.t === 'clear' || o.t === 'hold') && o.x == null) {
      if (engineerWork(q, dt)) continue;
      if (o.t === 'clear') q.order = { t: 'hold' };
    }
    if (q.repairing || (q.sup >= 60 && o.t !== 'retreat') || o.t === 'hold' || o.x == null) continue;
    if (o.t === 'amove' && tg) continue;   // 攻击前进：遇敌停下交火
    if (moveTeam(q, dt, o.t === 'retreat' ? 1.15 : o.t === 'amove' ? .9 : 1)) q.order = { t: o.t === 'clear' ? 'clear' : 'hold' };
  }
}

// —— 补给线：接通时为附近小组补充弹药；断点由该线工兵沿浮桥自动抢修 ——
function updateSupply(dt) {
  for (const L of S.supply) {
    L.connected = L.segs.every(g => g.ok);
    if (L.connected) for (const q of S.teams)
      if (q.side === 'p' && q.kind === 'inf' && dist(q.x, q.y, L.x, L.y) < 200) q.ammo = Math.min(60, q.ammo + 6 * dt);
    const eng = S.teams.find(q => q.id === L.eng && q.men.length);
    if (!eng) continue;
    let tg = null, bd = 1e9;
    for (const g of L.segs) if (!g.ok) { const d = dist(eng.x, eng.y, (g.x0 + g.x1) / 2, (g.y0 + g.y1) / 2); if (d < bd) { bd = d; tg = g; } }
    if (!tg && !eng.repairing) continue;
    if (eng.order.t !== 'hold' && !eng.repairing) continue;   // 被另派任务时不抢修
    const go = (x, y) => { const d = dist(eng.x, eng.y, x, y), sp = Math.min(d, 22 * dt); if (d > .5) { eng.x += (x - eng.x) / d * sp; eng.y += (y - eng.y) / d * sp; eng.movedT = S.t; } return d; };
    if (!tg) { if (go(L.x, L.y - 6) < 2) { eng.repairing = false; eng.working = false; } continue; }
    eng.repairing = true;
    if (go((tg.x0 + tg.x1) / 2, (tg.y0 + tg.y1) / 2) > 5) continue;
    eng.working = true;
    tg.rep += dt * eng.men.length / 3 / 5;
    if (tg.rep >= 1) { tg.ok = true; tg.rep = 0; log('工兵修复了一段补给线', 'good', 'segfix', 3); }
  }
}

// —— 增援线：从后方到某个滩头，预备队乘艇逐批上岸 ——
function buildRLine(ship) {
  if (S.assets.rline <= 0) { log('增援线额度已用完', 'warn', 'rl', 2); return false; }
  if (S.rlines.some(l => l.ship === ship.id)) { log('该滩头已有增援线', 'warn', 'rl2', 2); return false; }
  S.assets.rline--;
  const x0 = clamp(ship.x - (W / 2 - ship.x) * .15, 20, W - 20);
  S.rlines.push({ id: S.nid++, ship: ship.id, x0, y0: H - 6, x1: ship.x, y1: ship.y, bx: ship.bx, by: ship.by, timer: 2 });
  log(`增援线已开辟：后方 → ${ship.label} 滩头（${gridRef(ship.bx, ship.by)}）`, 'good');
  return true;
}

function updateRLines(dt) {
  for (const L of S.rlines)
    if ((L.timer -= dt) <= 0 && S.assets.reserve > 0) { L.timer = 15; S.assets.reserve--; S.boats.push({ id: S.nid++, line: L.id, u: 0, x: L.x0, y: L.y0 }); }
  for (const b of S.boats) {
    if (b.dead) continue;
    const L = S.rlines.find(l => l.id === b.line);
    b.u += 40 * dt / dist(L.x0, L.y0, L.x1, L.y1);
    b.x = lerp(L.x0, L.x1, b.u); b.y = lerp(L.y0, L.y1, b.u);
    if (b.u < 1) continue;
    b.done = true;
    addTeam('p', L.bx + gauss() * 8, L.by - 8, ['radio', 'rifle', 'mg'], { unit: '增援' });
    log(`增援小组经增援线抵达 ${gridRef(L.bx, L.by)}`, 'good', 'reinf', 4);
  }
  S.boats = S.boats.filter(b => !b.dead && !b.done);
}

// —— 据点：圈内只有我方步兵即推进占领；碉堡未拔除前无法占领 ——
function updatePoints(dt) {
  for (const p of S.points) {
    const pT = S.teams.filter(q => q.side === 'p' && q.kind === 'inf' && dist(q.x, q.y, p.x, p.y) < 45).length;
    const eN = S.teams.some(q => q.side === 'e' && dist(q.x, q.y, p.x, p.y) < 60) || S.enemies.some(e => !e.dead && e.kind === 'bunker' && dist(e.x, e.y, p.x, p.y) < 60);
    p.contested = pT > 0 && eN;
    if (pT && !eN) {
      p.prog = Math.min(1, p.prog + dt / 15 * (pT >= 3 ? 1.5 : 1));
      if (p.prog >= 1 && p.owner !== 'p') { p.owner = 'p'; log(`已夺取据点「${p.name}」`, 'good'); }
    } else if (eN && !pT) {
      p.prog = Math.max(0, p.prog - dt / 15);
      if (p.prog <= 0 && p.owner === 'p') { p.owner = 'e'; log(`据点「${p.name}」被敌军夺回`, 'bad'); }
    }
  }
}

function updateVision() {
  smokeMask();
  const ps = [];
  for (const q of S.teams) if (q.side === 'p' && q.men.includes('radio')) ps.push({ x: q.x, y: q.y, r: 150 });
  for (const s of S.ships) if (alive(s)) ps.push({ x: s.x, y: s.y, r: s.state === 'beached' ? 60 : 80, h: .8 });
  if (S.dd.state !== 'sunk') ps.push({ x: S.dd.x, y: S.dd.y, r: 70, h: 1 });
  for (const p of S.planes) ps.push({ x: p.x, y: p.y, r: 110, h: 12 });
  S.recon = S.recon.filter(p => p.until > S.t);
  for (const p of S.recon) ps.push({ x: p.x, y: p.y, r: 100, h: 12 });
  castVision(PV, ps);
  const es = [];
  for (const q of S.teams) if (q.side === 'e') es.push({ x: q.x, y: q.y, r: 160 });
  for (const e of S.enemies) if (!e.dead) es.push({ x: e.x, y: e.y, r: e.kind === 'coastal' ? 220 : e.kind === 'bunker' ? 170 : 90, h: e.kind === 'coastal' ? 1.2 : .6 });
  castVision(EV, es);
  // 情报记忆：看到过的火力点与工事留下标定；回头再看已空则撤销
  let forts = false;
  for (const e of S.enemies) {
    if (PV[ci(e.x, e.y)]) { e.kx = e.x; e.ky = e.y; }
    else if (e.kx != null && !e.dead && dist(e.kx, e.ky, e.x, e.y) > 20 && PV[ci(e.kx, e.ky)]) {
      e.kx = e.ky = null;
      log(`原标定位置已无目标，敌${ENEMY_SPEC[e.kind].name}疑似转移`, 'warn', 'stale' + e.id, 15);
    }
  }
  for (const q of S.teams) if (q.side === 'e' && PV[ci(q.x, q.y)]) { q.seen = S.t; q.sx = q.x; q.sy = q.y; }
  for (const w of S.wire) if (!w.known && PV[ci((w.x0 + w.x1) / 2, (w.y0 + w.y1) / 2)]) { w.known = true; forts = true; }
  for (const o of S.obst) if (!o.known && PV[ci(o.x, o.y)]) { o.known = true; forts = true; }
  for (const t of S.trench) if (!t.known && t.pts.some(([x, y]) => PV[ci(x, y)])) t.known = true;
  for (const m of S.mines) if (!m.known && m.clr < 1 && PV[ci(m.x, m.y)] && Math.random() < .02) {
    m.known = true; forts = true; log(`在 ${gridRef(m.x, m.y)} 发现雷区标志`, 'warn');
  }
  if (forts) rebuildForts();
}

function checkEnd(dt) {
  if (S.over) return;
  if (S.points.every(p => p.owner === 'p')) {
    if (!S.holdT) log(`全部据点已夺取，坚守 ${HOLD} 秒即可巩固滩头`, 'good');
    S.holdT += dt;
    if (S.holdT >= HOLD) { S.over = 'win'; log('登陆场已巩固，作战胜利', 'good'); return; }
  } else if (S.holdT) { S.holdT = 0; log('有据点被夺回，巩固计时中断', 'bad'); }
  const forces = S.teams.some(q => q.side === 'p' && q.kind === 'inf') || S.ships.some(s => alive(s) && s.load.teams > 0) ||
    S.boats.length > 0 || (S.assets.reserve > 0 && S.rlines.length > 0);
  if (!forces) { S.over = 'lose'; log('登陆部队已全部损失', 'bad'); }
  else if (S.t >= LIMIT) { S.over = 'lose'; log('作战时限已到，未能夺取全部据点', 'bad'); }
}

function step(dt) {
  S.t += dt;
  if ((S.visT = (S.visT ?? 0) - dt) <= 0) { S.visT = .25; updateVision(); }
  updateShips(dt); updateDD(dt); updateTeams(dt); updateEnemies(dt); aiUpdate(dt);
  updatePlanes(dt); updateShells(dt); updateSupply(dt); updateRLines(dt); updatePoints(dt);
  if (S.teams.some(q => !q.men.length)) {
    S.teams = S.teams.filter(q => q.men.length);
    S.sel = S.sel.filter(id => byId(id));
  }
  for (const t of S.tracers) t.life += dt;
  S.tracers = S.tracers.filter(t => t.life < t.max);
  for (const f of S.fx) f.life += dt;
  S.fx = S.fx.filter(f => f.life < f.max);
  checkEnd(dt);
}
