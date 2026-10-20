'use strict';
// 模拟（二）：驱逐舰与损管、空军、炮弹、补给线与工兵、增援线、目标、玩家指令

// —— 驱逐舰 ——
function destroyerFire(tx, ty) {
  const D = S.destroyer;
  if (D.state !== 'ready' || D.cool > 0) return false;
  const sc = 10 + dist(D.x, D.y, tx, ty) / 45;
  fireShell(D.x, D.y, tx + gauss() * sc, ty + gauss() * sc, 'p', 'naval', 2.2, false);
  D.cool = 5; D.aim = { x: tx, y: ty }; S.stats.shots++;
  S.fx.push({ kind: 'flash', x: D.x, y: D.y, r: 16, life: 0, max: .5, side: 'p' });
  if (Math.random() < .7) {
    D.exposedUntil = S.t + 6; S.stats.exposed++;
    const arty = S.enemies.filter(e => e.kind === 'arty' && !e.dead);
    if (arty.length) {
      const a = pick(arty);
      fireShell(a.x, a.y, D.x, D.y, 'e', 'cb', 4.2, !inVision(a.x, a.y), { t: -1.2 });
      log(`驱逐舰炮口闪光暴露坐标（${gridRef(D.x, D.y)}），敌反炮兵射击来袭`, 'bad');
    } else log('驱逐舰坐标暴露，敌方已无炮兵可以还击', 'info', 'ddsafe', 4);
  } else log(`驱逐舰齐射，方位 ${fmtBrg(bearing(D.x, D.y, tx, ty))}，未暴露`, 'info', 'dd', 2);
  return true;
}

function damageDestroyer() {
  const D = S.destroyer;
  if (D.state === 'sunk') return;
  D.hull--;
  S.fx.push({ kind: 'boom', x: D.x, y: D.y, r: 30, life: 0, max: 1.2, side: 'p' });
  if (D.hull <= 0) { D.state = 'sunk'; log('驱逐舰第三次中弹沉没，舰炮掩护永久丧失', 'bad'); return; }
  D.state = 'repair'; D.repairT = 0;
  log(`驱逐舰中弹（船体 ${D.hull}/3），损管抢修中，暂停火力掩护`, 'bad');
}

function updateDestroyer(dt) {
  const D = S.destroyer;
  if (D.state === 'sunk') return;
  D.cool = Math.max(0, D.cool - dt);
  if (D.state === 'repair') {
    D.repairT += dt;
    if (D.repairT >= D.repairDur) { D.state = 'ready'; log('损管完成，驱逐舰恢复火力掩护', 'good'); }
    return;
  }
  if (!D.auto || D.cool > 0) return;
  // 自动掩护：射击视野内、靠近我方小队（但不贴脸）的敌人
  let best = null, bd = 160;
  const foes = S.enemies.filter(e => !e.dead).concat(S.squads.filter(q => q.side === 'e' && q.men.length));
  for (const e of foes) {
    if (!inVision(e.x, e.y)) continue;
    let near = 1e9;
    for (const q of S.squads) if (q.side === 'p' && q.men.length) near = Math.min(near, dist(e.x, e.y, q.x, q.y));
    if (near < bd && near > 50) { bd = near; best = e; }
  }
  if (best) destroyerFire(best.x, best.y);
}

// —— 空军 ——
function launchPlane(kind, tx, ty) {
  if (S.cards[kind] <= 0) return false;
  S.cards[kind]--;
  S.planes.push({ id: S.nid++, kind, x: tx, y: H + 30, tx, ty, dropped: false, aaT: 0, rt: 0 });
  log(kind === 'strike' ? `空袭编队起飞，目标 ${gridRef(tx, ty)}` : `侦察机起飞，沿 ${'ABCDEFGHIJKL'[clamp(Math.floor(tx / 100), 0, 11)]} 列向北侦察`, 'info');
  return true;
}

function updatePlanes(dt) {
  for (const p of S.planes) {
    p.y -= 150 * dt;
    if (p.kind === 'recon' && (p.rt -= dt) <= 0) { p.rt = .2; S.recon.push({ x: p.x, y: p.y, until: S.t + 20 }); }
    if (p.kind === 'strike' && !p.dropped && p.y <= p.ty + 70) {
      p.dropped = true;
      for (let i = 0; i < 3; i++)
        fireShell(p.x, p.y, p.tx + gauss() * 10, p.ty + 34 - i * 34 + gauss() * 6, 'p', 'bomb', .7, false, { t: -i * .18 });
    }
    if ((p.aaT -= dt) > 0) continue;
    p.aaT = .5;
    for (const a of S.enemies) {
      if (a.dead || a.kind !== 'aa' || dist(a.x, a.y, p.x, p.y) > 170) continue;
      tracer(a.x, a.y, p.x + gauss() * 14, p.y + gauss() * 14, 'e', inVision(a.x, a.y));
      if (Math.random() < (p.kind === 'strike' ? .09 : .06)) {
        p.dead = true;
        S.fx.push({ kind: 'boom', x: p.x, y: p.y, r: 22, life: 0, max: 1, side: 'p' });
        log(`${p.kind === 'strike' ? '攻击机' : '侦察机'}在 ${gridRef(p.x, p.y)} 被防空火力击落`, 'bad');
        break;
      }
    }
  }
  S.planes = S.planes.filter(p => !p.dead && p.y > -40);
}

// —— 炮弹 ——
function updateShells(dt) {
  for (const s of S.shells) {
    if ((s.t += dt) < s.dur) continue;
    s.done = true;
    if (s.kind === 'cb') damageDestroyer();
    else impact(s.x1, s.y1, POWER[s.kind], s.side);
  }
  S.shells = S.shells.filter(s => !s.done);
}

// —— 补给线与工兵 ——
function updateSupply(dt) {
  for (const L of S.supply) {
    L.connected = L.segs.every(g => g.ok);
    if (L.connected) for (const q of S.squads)
      if (q.side === 'p' && q.kind === 'inf' && dist(q.x, q.y, L.x, L.y) < 170) q.ammo = Math.min(40, q.ammo + 6 * dt);
    const eng = S.squads.find(q => q.id === L.eng && q.men.length);
    if (!eng) continue;
    let tg = null, bd = 1e9;
    for (const g of L.segs) if (!g.ok) {
      const d = dist(eng.x, eng.y, (g.x0 + g.x1) / 2, (g.y0 + g.y1) / 2);
      if (d < bd) { bd = d; tg = g; }
    }
    eng.working = false;
    if (!tg) { if (dist(eng.x, eng.y, L.x, L.y - 6) > 4) moveSquad(eng, L.x, L.y - 6, dt); continue; }
    if (bd > 5) { moveSquad(eng, (tg.x0 + tg.x1) / 2, (tg.y0 + tg.y1) / 2, dt); continue; }
    eng.working = true;
    tg.rep += dt * eng.men.length / 3 / 5;
    if (tg.rep >= 1) { tg.ok = true; tg.rep = 0; log('工兵修复了一段补给线', 'good', 'segfix', 3); }
  }
}

// —— 增援线 ——
function buildRLine(ship) {
  if (S.cards.rline <= 0 || S.rlines.some(l => l.ship === ship.id)) return false;
  S.cards.rline--;
  const x0 = clamp(ship.x - (600 - ship.x) * .15, 20, W - 20);
  S.rlines.push({ id: S.nid++, ship: ship.id, x0, y0: H - 6, x1: ship.x, y1: ship.y + 2, timer: 2 });
  log(`增援线已开辟：后方 → ${ship.label} 滩头（${gridRef(ship.x, ship.y)}）`, 'good');
  return true;
}

function updateRLines(dt) {
  for (const L of S.rlines)
    if ((L.timer -= dt) <= 0 && S.cards.reinf > 0) {
      L.timer = 14; S.cards.reinf--;
      S.boats.push({ id: S.nid++, line: L.id, u: 0, x: L.x0, y: L.y0 });
    }
  for (const b of S.boats) {
    if (b.dead) continue;
    const L = S.rlines.find(l => l.id === b.line);
    b.u += 40 * dt / dist(L.x0, L.y0, L.x1, L.y1);
    b.x = lerp(L.x0, L.x1, b.u); b.y = lerp(L.y0, L.y1, b.u);
    if (b.u < 1) continue;
    b.done = true;
    const x = L.x1 + gauss() * 8;
    addSquad('p', x, coastAt(x) - 6, ['radio', 'rifle', 'rifle']);
    log(`增援小队经增援线抵达 ${gridRef(L.x1, L.y1)}`, 'good', 'reinf', 4);
  }
  S.boats = S.boats.filter(b => !b.dead && !b.done);
}

// —— 目标与胜负 ——
function updateObjectives(dt) {
  for (const o of S.objectives) {
    const pN = S.squads.some(q => q.side === 'p' && q.kind === 'inf' && q.men.length && dist(q.x, q.y, o.x, o.y) < 45);
    const eN = S.squads.some(q => q.side === 'e' && q.men.length && dist(q.x, q.y, o.x, o.y) < 70) ||
      S.enemies.some(e => !e.dead && e.kind === 'bunker' && dist(e.x, e.y, o.x, o.y) < 70);
    o.contested = pN && eN;
    if (pN && !eN) {
      o.prog = Math.min(1, o.prog + dt / 15);
      if (o.prog >= 1 && o.owner !== 'p') { o.owner = 'p'; log(`已占领目标 ${o.key}「${o.name}」`, 'good'); }
    } else if (eN && !pN) {
      o.prog = Math.max(0, o.prog - dt / 10);
      if (o.prog <= 0 && o.owner === 'p') { o.owner = 'e'; log(`目标 ${o.key}「${o.name}」被敌军夺回`, 'bad'); }
    }
  }
}

function checkEnd(dt) {
  if (S.over) return;
  if (S.objectives.every(o => o.owner === 'p')) {
    if (!S.holdT) log(`三个目标已全部占领，坚守 ${HOLD} 秒即可巩固滩头`, 'good');
    S.holdT += dt;
    if (S.holdT >= HOLD) { S.over = 'win'; log('滩头已巩固，登陆作战胜利', 'good'); return; }
  } else if (S.holdT) { S.holdT = 0; log('目标被夺回，巩固计时中断', 'bad'); }
  const forces = S.squads.some(q => q.side === 'p' && q.kind === 'inf') || S.ships.some(s => alive(s) && s.load.squads > 0) ||
    S.cards.assault + S.cards.supply > 0 || S.boats.length > 0 || (S.cards.reinf > 0 && S.rlines.length > 0);
  if (!forces) { S.over = 'lose'; log('登陆部队已全部损失', 'bad'); }
  else if (S.t >= LIMIT) { S.over = 'lose'; log('作战时限已到，未能达成全部目标', 'bad'); }
}

function step(dt) {
  S.t += dt;
  computeVision();
  updateShips(dt); updateSquads(dt); updateSupply(dt); updateEnemies(dt); aiUpdate(dt);
  updateDestroyer(dt); updatePlanes(dt); updateShells(dt); updateRLines(dt); updateObjectives(dt);
  S.squads = S.squads.filter(q => q.men.length);
  for (const t of S.tracers) t.life += dt;
  S.tracers = S.tracers.filter(t => t.life < t.max);
  for (const f of S.fx) f.life += dt;
  S.fx = S.fx.filter(f => f.life < f.max);
  checkEnd(dt);
}

// —— 玩家指令 ——
function deployShip(kind, x, y) {
  if (S.cards[kind] <= 0) return null;
  if (y < STAGING_Y || isLand(x, y)) { log('登陆舰只能部署在集结海域（沙盘下方虚线以南）', 'warn', 'deploy', 2); return null; }
  S.cards[kind]--;
  const s = addShip(kind, clamp(x, 12, W - 12), Math.min(y, H - 12));
  log(`${s.label} 进入集结海域 ${gridRef(s.x, s.y)}`, 'info');
  return s;
}

function orderMove(ids, x, y) {
  const ships = ids.map(shipById).filter(s => s && (s.state === 'idle' || s.state === 'move'));
  if (!ships.length) return 0;
  const cx = ships.reduce((a, s) => a + s.x, 0) / ships.length, cy = ships.reduce((a, s) => a + s.y, 0) / ships.length;
  const ang = Math.atan2(y - cy, x - cx), px = -Math.sin(ang), py = Math.cos(ang);
  ships.sort((a, b) => (a.x * px + a.y * py) - (b.x * px + b.y * py));
  ships.forEach((s, i) => {
    const k = (i - (ships.length - 1) / 2) * 28;
    s.tx = clamp(x + px * k, 8, W - 8); s.ty = clamp(y + py * k, 8, H - 8); s.state = 'move';
  });
  log(`${ships.length} 艘登陆舰 → ${gridRef(x, y)}${isLand(x, y) ? '（抢滩）' : ''}`, 'info', 'move', 1);
  return ships.length;
}
