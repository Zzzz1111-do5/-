'use strict';
// 单位（一）：舰船航行与抢滩、步兵指令、三三制队形、寻路移动、雷区/铁丝网、工兵作业

// —— 舰船 ——
function landingPoint(x, y) {
  let best = null, bd = 140;
  eachCellIn(x, y, 140, i => {
    if (TER.type[i] !== T.BEACH) return;
    const bx = cellCX(i), by = cellCY(i), d = dist(bx, by, x, y);
    if (d >= bd) return;
    for (const [dx, dy] of NB) {
      const sx = bx + dx * CELL, sy = by + dy * CELL, t = typeAt(sx, sy);
      if (t === T.SHOAL || t === T.DEEP) { bd = d; best = { bx, by, sx, sy }; return; }
    }
  });
  return best;
}

function orderShips(ships, x, y) {
  ships = ships.filter(s => s.state === 'idle' || s.state === 'move');
  if (!ships.length) return 0;
  const cxs = ships.reduce((a, s) => a + s.x, 0) / ships.length, cys = ships.reduce((a, s) => a + s.y, 0) / ships.length;
  const ang = Math.atan2(y - cys, x - cxs), px = -Math.sin(ang), py = Math.cos(ang);
  ships.sort((a, b) => (a.x * px + a.y * py) - (b.x * px + b.y * py));
  let blocked = 0;
  ships.forEach((s, i) => {
    const k = (i - (ships.length - 1) / 2) * 30, tx = clamp(x + px * k, 8, W - 8), ty = clamp(y + py * k, 8, H - 8);
    s.land = false;
    if (isLand(tx, ty)) {
      const lp = landingPoint(tx, ty);
      if (lp) Object.assign(s, { land: true, tx: lp.sx, ty: lp.sy, bx: lp.bx, by: lp.by });
      else { blocked++; const j = nearestPassable(ci(tx, ty), 'ship'); s.tx = cellCX(j); s.ty = cellCY(j); }
    } else { s.tx = tx; s.ty = ty; }
    s.state = 'move';
  });
  if (blocked) log('目标处是悬崖或礁岸，无法抢滩，舰船将停在近岸海面', 'warn', 'noland', 2);
  else log(`${ships.length} 艘舰船 → ${gridRef(x, y)}${ships.some(s => s.land) ? '（抢滩）' : ''}`, 'info', 'mv', 1);
  return ships.length;
}

function sailTo(s, dt, speed) {
  const d = dist(s.x, s.y, s.tx, s.ty);
  if (d < 2) return true;
  let tx = s.tx, ty = s.ty;
  if (d > 20) { const f = field(s.tx, s.ty, 'ship'), n = f && nextStep(f, s.x, s.y); if (n) [tx, ty] = n; }
  const sp = speed * (typeAt(s.x, s.y) === T.SHOAL ? .55 : 1) * dt, l = dist(s.x, s.y, tx, ty) || 1;
  s.heading = Math.atan2(ty - s.y, tx - s.x);
  s.x += (tx - s.x) / l * Math.min(sp, l); s.y += (ty - s.y) / l * Math.min(sp, l);
  return false;
}

function updateShips(dt) {
  for (const s of S.ships) {
    if (s.state === 'unloading') { if ((s.ut += dt) >= 3) disembark(s); continue; }
    if (s.state !== 'move') continue;
    // 未清除的反登陆障碍
    if (OBSC[ci(s.x, s.y)]) for (const o of S.obst) if (!o.dead && dist(o.x, o.y, s.x, s.y) < 12) {
      o.dead = true; o.known = true; damageShip(s, 1.6); rebuildForts();
      log(`${s.label} 撞上反登陆障碍（${gridRef(s.x, s.y)}）`, 'bad');
    }
    if (!sailTo(s, dt, 26)) continue;
    if (s.land) { s.state = 'unloading'; s.ut = 0; log(`${s.label} 抢滩（${gridRef(s.bx, s.by)}），开始卸载`, 'good'); }
    else s.state = 'idle';
  }
}

function disembark(s) {
  s.state = 'beached';
  const n = s.load.teams;
  for (let k = 0; k < n; k++) {
    let x = s.bx + (k - (n - 1) / 2) * 17, y = s.by - 6 - (k % 2) * 12;
    if (!passInf(x, y)) { x = s.bx; y = s.by; }
    addTeam('p', x, y, ['radio', 'rifle', 'mg'], { unit: s.label });
  }
  if (s.load.eng) {
    const e = addTeam('p', s.bx, s.by, ['eng', 'eng', 'eng'], { unit: s.label, depot: s.id });
    makeSupplyLine(s, e);
    log(`${s.label} 建立滩头补给站，补给线接通后方`, 'good');
  }
  s.load = { teams: 0, eng: 0 };
}

function makeSupplyLine(s, eng) {
  const x1 = s.x, y1 = s.y, x2 = lerp(s.x, W / 2, .2), y2 = H - 6, n = 7, segs = [];
  for (let i = 0; i < n; i++)
    segs.push({ x0: lerp(x1, x2, i / n), y0: lerp(y1, y2, i / n), x1: lerp(x1, x2, (i + 1) / n), y1: lerp(y1, y2, (i + 1) / n), ok: true, rep: 0 });
  S.supply.push({ id: S.nid++, ship: s.id, eng: eng.id, x: s.bx, y: s.by, segs, connected: true });
}

// —— 步兵：三三制队形（三人组成三角，三组成班，三班成排）——
function formationSlots(n, x, y, ang) {
  const fx = Math.cos(ang), fy = Math.sin(ang), px = -fy, py = fx, tri = [[0, 0], [-1, -1], [1, -1]], pls = Math.ceil(n / 9);
  const out = [];
  for (let k = 0; k < n; k++) {
    const [a1, b1] = tri[k % 3], [a2, b2] = tri[Math.floor(k / 3) % 3], pl = Math.floor(k / 9);
    const lat = a1 * 14 + a2 * 46 + (pl - (pls - 1) / 2) * 150, back = -b1 * 13 - b2 * 40;
    let sx = clamp(x + px * lat - fx * back, 5, W - 5), sy = clamp(y + py * lat - fy * back, 5, H - 5);
    if (!passInf(sx, sy)) { const j = nearestPassable(ci(sx, sy), 'p'); if (j >= 0) { sx = cellCX(j); sy = cellCY(j); } }
    out.push([sx, sy]);
  }
  return out;
}

// t：move 移动（行进间射击）/ amove 攻击前进（遇敌停下交火）/ hold 坚守 / retreat 撤退 / clear 工兵排雷剪网
function orderTeams(teams, x, y, t) {
  if (!teams.length) return 0;
  if (t === 'hold') { for (const q of teams) q.order = { t: 'hold' }; log(`${teams.length} 个小组原地坚守`, 'info', 'ord', 1); return teams.length; }
  if (t === 'retreat') {
    for (const q of teams) {
      const bh = S.ships.filter(s => s.state === 'beached').sort((a, b) => dist(a.bx, a.by, q.x, q.y) - dist(b.bx, b.by, q.x, q.y))[0];
      const tx = bh ? bh.bx : q.x, ty = bh ? bh.by - 10 : Math.min(q.y + 80, coastAt(q.x) - 10);
      q.order = { t: 'retreat', x: tx, y: ty, gx: tx, gy: ty };
    }
    log(`${teams.length} 个小组撤向滩头`, 'warn', 'ord', 1);
    return teams.length;
  }
  if (!field(x, y, 'p')) { log('该位置无法到达', 'warn', 'unreach', 2); return 0; }
  const cxs = teams.reduce((a, q) => a + q.x, 0) / teams.length, cys = teams.reduce((a, q) => a + q.y, 0) / teams.length;
  const ang = Math.atan2(y - cys, x - cxs), slots = formationSlots(teams.length, x, y, ang);
  const px = -Math.sin(ang), py = Math.cos(ang), key = (a, b) => a[0] * px + a[1] * py - (b[0] * px + b[1] * py);
  const ts = teams.slice().sort((a, b) => key([a.x, a.y], [b.x, b.y])), ss = slots.slice().sort(key);
  ts.forEach((q, k) => { q.order = { t, x: ss[k][0], y: ss[k][1], gx: x, gy: y }; q.pathT = -9; });
  const nm = { move: '移动', amove: '攻击前进', clear: '排雷剪网' }[t];
  log(`${teams.length} 个小组${nm} → ${gridRef(x, y)}（三三制队形）`, 'info', 'ord', 1);
  return teams.length;
}

function clearLine(x0, y0, x1, y1, side) {
  const n = Math.ceil(dist(x0, y0, x1, y1) / 8);
  for (let s = 1; s <= n; s++) {
    const i = ci(lerp(x0, x1, s / n), lerp(y0, y1, s / n));
    if (!TP[TER.type[i]].sp || WIREC[i] || (MINEC[i] && (side === 'e' || MINEC[i] === 2))) return false;
  }
  return true;
}

function moveTeam(q, dt, mul) {
  const o = q.order, dd = dist(q.x, q.y, o.x, o.y);
  if (dd < 3) return true;
  if (S.t - (q.pathT ?? -9) > 1) { q.pathT = S.t; q.direct = clearLine(q.x, q.y, o.x, o.y, q.side); }
  let tx = o.x, ty = o.y;
  if (!q.direct && dd > 16) {
    const f = field(o.gx ?? o.x, o.gy ?? o.y, q.side), n = f && nextStep(f, q.x, q.y);
    if (n) [tx, ty] = n;
  }
  const i = ci(q.x, q.y);
  const sp = (q.side === 'p' ? (q.kind === 'eng' ? 18 : 16) : 14) * (TP[TER.type[i]].sp || .5) * (WIREC[i] ? .3 : 1) * (q.sup > 30 ? .7 : 1) * mul * dt;
  const l = dist(q.x, q.y, tx, ty) || 1;
  let nx = q.x + (tx - q.x) / l * Math.min(sp, l), ny = q.y + (ty - q.y) / l * Math.min(sp, l);
  for (const o2 of S.teams) if (o2 !== q && o2.side === q.side) {
    const d2 = dist(nx, ny, o2.x, o2.y);
    if (d2 < 9 && d2 > .01) { nx += (nx - o2.x) / d2 * (9 - d2) * .3; ny += (ny - o2.y) / d2 * (9 - d2) * .3; }
  }
  if (passInf(nx, ny)) { q.x = nx; q.y = ny; q.movedT = S.t; q.heading = Math.atan2(ty - q.y, tx - q.x); }
  return false;
}

// 雷区：我方踩到未标定雷区会伤亡并就此标定；守军熟悉雷区，极少误触
function mineCheck(q, dt) {
  if (!MINEC[ci(q.x, q.y)]) return;
  const m = S.mines.find(m => m.clr < 1 && dist(m.x, m.y, q.x, q.y) < m.r);
  if (!m) return;
  const moving = S.t - q.movedT < .5, p = (q.side === 'p' ? .45 : .04) * (1 - m.clr) * (moving ? 1 : .04) * dt;
  if (Math.random() >= p) return;
  killMan(q); q.sup = Math.min(100, q.sup + 45); q.hitT = S.t;
  S.fx.push({ kind: 'boom', x: q.x, y: q.y, r: 12, life: 0, max: .7, side: 'e' });
  if (!m.known) { m.known = true; rebuildForts(); }
  if (q.side === 'p') log(`${teamName(q)}在 ${gridRef(q.x, q.y)} 触雷，雷区已标定`, 'bad', 'mine' + m.id, 6);
}

// 工兵：排雷、剪铁丝网（指令或在已知雷区附近待命时自动作业）
function engineerWork(q, dt) {
  const rate = q.men.length / 3 * dt;
  const m = S.mines.find(m => m.clr < 1 && m.known && dist(m.x, m.y, q.x, q.y) < m.r + 30);
  const w = S.wire.find(w => !w.cut && segDist(q.x, q.y, w.x0, w.y0, w.x1, w.y1) < 26);
  q.working = !!(m || w);
  if (m) {
    if (dist(m.x, m.y, q.x, q.y) > m.r * .5) { const o = q.order; q.order = { t: 'move', x: m.x, y: m.y + m.r * .3 }; moveTeam(q, dt, .8); q.order = o; }
    m.clr += rate / 16;
    if (m.clr >= 1) { m.clr = 1; rebuildForts(); log(`工兵清除了 ${gridRef(m.x, m.y)} 的雷区`, 'good'); }
  }
  if (w) { w.prog = (w.prog || 0) + rate / 4; if (w.prog >= 1) { w.cut = true; w.known = true; rebuildForts(); log('工兵剪开一段铁丝网', 'good', 'wire', 3); } }
  return q.working;
}
