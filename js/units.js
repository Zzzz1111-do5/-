'use strict';
// 单位（一）：舰船航行与抢滩、步兵指令、三三制队形、寻路移动、雷区/铁丝网、工兵作业

// —— 舰船 ——
function landingPoint(x, y, r = 140) {
  let best = null, bd = r;
  eachCellIn(x, y, r, i => {
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

// 抢滩点：沿岸线左右找一处不和别的登陆舰（已抢滩或正驶向滩头）船宽重叠的位置——舰艏并排靠岸，不叠在一起
const shipW = s => ((typeof SHIP_DIM === 'object' && SHIP_DIM[s.kind]) || [32, 11])[1];
function beachSlot(s, x, y, r) {
  const taken = S.ships.filter(o => o !== s && alive(o) && o.land && o.bx != null && (o.state === 'move' || o.state === 'unloading' || o.state === 'beached'));
  let best = null, bn = Infinity, seen = new Set();
  for (let k = 0; k <= 12; k++) for (const sg of k ? [1, -1] : [1]) {
    const ox = clamp(x + sg * k * 14, 8, W - 8), lp = landingPoint(ox, k ? coastAt(ox) : y, k ? 140 : r);
    if (!lp || seen.has(lp.bx + ',' + lp.by)) continue;
    seen.add(lp.bx + ',' + lp.by);
    const n = taken.filter(o => Math.abs(o.bx - lp.bx) < (shipW(s) + shipW(o)) / 2 + 5 && Math.abs(o.by - lp.by) < 40).length;
    if (!n) return lp;
    if (n < bn) { bn = n; best = lp; }   // 滩头全满：挑最不挤的位置
  }
  return best;
}
// 舰船避碰：前方航路上有别的船（停着的，或编号小、有优先权的）就转向绕开、靠近了减速让行；不推挤船身（以前推来推去看着像抽搐）
const shipDim = s => (typeof SHIP_DIM === 'object' && SHIP_DIM[s.kind]) || [32, 11];
function shipAvoid(s, want) {
  const L = shipDim(s), fx = Math.cos(s.heading ?? want), fy = Math.sin(s.heading ?? want);
  let slow = 1;
  for (const o of S.ships) {
    if (o === s || !alive(o) || o.kind === 'boat') continue;
    const dx = o.x - s.x, dy = o.y - s.y, d = Math.hypot(dx, dy), M = shipDim(o), look = (L[0] + M[0]) * .5 + 14;
    if (d > look || d < .01) continue;
    const along = dx * fx + dy * fy, lat = dy * fx - dx * fy, oh = o.heading ?? 0;
    const half = (L[1] + M[1]) * .5 + 4 + Math.abs(Math.sin(oh - (s.heading ?? want))) * M[0] * .5;   // 对方横着时占的宽度更大
    if (along <= 0 || Math.abs(lat) > half) continue;
    if (o.state === 'move' && o.id > s.id) continue;   // 对方会让我
    want -= (Math.abs(lat) < 2 ? 1 : Math.sign(lat)) * .5 * clamp(1 - along / look, 0, 1);
    slow = Math.min(slow, clamp((along - (L[0] + M[0]) * .5 * .7) / 14, 0, 1));
  }
  return [want, slow];
}

// 护航舰火力支援阵位：岸线外约 250 的海面格
const ddStand = x => nearestPassable(ci(x, clamp(coastAt(x) + 250, 8, H - 8)), 'ship');
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
    if (isLand(tx, ty) && s.kind === 'dd') { const j = ddStand(tx); s.tx = cellCX(j); s.ty = cellCY(j); }   // 护航舰不抢滩，停在滩头外火力支援阵位
    else if (isLand(tx, ty)) {
      const lp = beachSlot(s, tx, ty);
      if (lp) Object.assign(s, { land: true, tx: lp.sx, ty: lp.sy, bx: lp.bx, by: lp.by });
      else { blocked++; const j = nearestPassable(ci(tx, ty), 'ship'); s.tx = cellCX(j); s.ty = cellCY(j); }
    } else {
      const lp = s.kind !== 'dd' && !s.sbxRole && beachSlot(s, tx, ty, 40);   // 点在海岸线外沿的浅水里（距滩头 40 内）仍按抢滩处理，不在水线边空停
      if (lp) Object.assign(s, { land: true, tx: lp.sx, ty: lp.sy, bx: lp.bx, by: lp.by }); else { s.tx = tx; s.ty = ty; }
    }
    s.state = 'move';
  });
  if (blocked) log('目标处是悬崖或礁岸，无法抢滩，舰船将停在近岸海面', 'warn', 'noland', 2);
  return ships.length;
}

// 航道：目的地在近岸（离岸 SHIP_LANE 以内）而横向还差得远时，先在深水航道（离岸约 SHIP_LANE）里横向机动到目的地正前方，再垂直驶向海岸——
// 不贴着海岸线航行（以前按最短路线斜插过去，一路离岸七八十米从别的滩头守军眼前经过）。返回航道上的下一个路标，或 null（直接驶向目的地）
const SHIP_LANE = 340;
function shipLaneY(x) { const c = coastAt(clamp(x, 0, W - 1)); for (let o = SHIP_LANE; o < SHIP_LANE + 220; o += 20) if (typeAt(x, c + o) === T.DEEP) return c + o; return c + SHIP_LANE + 220; }
function shipLaneWP(s) {
  const dx = s.tx - s.x, toff = s.ty - coastAt(clamp(s.tx, 0, W - 1));
  if (Math.abs(dx) < 140 || toff > SHIP_LANE - 40) return null;
  const x = clamp(s.x + Math.sign(dx) * Math.min(Math.abs(dx), 160), 20, W - 20), ly = shipLaneY(x), cur = shipLaneY(s.x);
  if (s.y < cur - 30) return [clamp(s.x + Math.sign(dx) * 30, 20, W - 20), cur + 20];   // 已经贴岸：先退回航道
  return [x, Math.max(ly, Math.min(s.y, ly + 150))];   // 航道深度上下 150 以内横向机动
}
const vehAngS = a => Math.atan2(Math.sin(a), Math.cos(a));
const shipClear = (x0, y0, x1, y1) => { const n = Math.ceil(dist(x0, y0, x1, y1) / 10); for (let k = 1; k <= n; k++) if (stepCost(ci(lerp(x0, x1, k / n), lerp(y0, y1, k / n)), 'ship') === Infinity) return false; return true; };
function sailTo(s, dt, speed) {
  const d = dist(s.x, s.y, s.tx, s.ty);
  if (d < 2) return true;
  let tx = s.tx, ty = s.ty;
  const wp = shipLaneWP(s);
  if (TER.pathY && s.y > TER.pathY - 150) s.lane = false;   // 大海域的远海（寻路带以外，没有礁石岛屿）：直接朝目标开
  else if (wp && shipClear(s.x, s.y, wp[0], wp[1])) { [tx, ty] = wp; s.lane = true; }
  else if (d > 20) {   // 沿路点（grid.js pathStep）往前看最多 8 格，取直线可达的最远一点当航路点（只看下一格会走成之字形）
    s.lane = false;
    const r = pathStep(s, s.tx, s.ty, 'ship', () => field(s.tx, s.ty, 'ship'), shipClear, 8, 60);
    if (r && r.x != null) [tx, ty] = [r.x, r.y];
  }
  let sp = speed * (typeAt(s.x, s.y) === T.SHOAL ? .55 : 1) * dt, want = Math.atan2(ty - s.y, tx - s.x);
  // 被挡住 6 秒没有进展的船暂时不避让，保证能靠岸
  if (S.t - (s.pkT ?? -99) > 6) { if (s.pkD != null && s.pkD - d < 3) s.noSep = S.t + 15; s.pkT = S.t; s.pkD = d; }
  if (s.kind !== 'boat' && !(s.noSep > S.t)) { let k; [want, k] = shipAvoid(s, want); sp *= k; }
  // 船头按转向速度慢慢转过去，船只沿船头方向走；离目标很近时直接对准靠上去
  s.wf = s.wf == null ? want : vehAngS(s.wf + vehAngS(want - s.wf) * Math.min(1, dt * 3));   // 目标航向先平滑，避免避让、换航路点时来回摆
  const turn = (s.kind === 'boat' ? 2.2 : s.spdK > 1 ? 1.4 : .9) * dt, da = vehAngS(s.wf - (s.heading ?? want));
  if (Math.abs(da) > .01 && d >= 14) s.heading = vehAngS((s.heading ?? want) + clamp(da, -turn, turn));   // 最后十几米保持船头不动直接靠上去
  if (d < 14) { const l = d || 1; s.x += (s.tx - s.x) / l * Math.min(sp, l); s.y += (s.ty - s.y) / l * Math.min(sp, l); return false; }
  const v = sp * (Math.abs(da) > 1.2 ? .3 : 1 - Math.abs(da) * .45);
  const nx = s.x + Math.cos(s.heading) * v, ny = s.y + Math.sin(s.heading) * v;
  if (stepCost(ci(nx, ny), 'ship') < Infinity || stepCost(ci(s.x, s.y), 'ship') === Infinity) { s.x = nx; s.y = ny; }
  else { const l = dist(s.x, s.y, tx, ty) || 1; s.x += (tx - s.x) / l * Math.min(v, l); s.y += (ty - s.y) / l * Math.min(v, l); }   // 船头前方是浅滩礁石：沿航路点走
  return false;
}

function updateShips(dt) {
  for (const s of S.ships) {
    if (s.state === 'unloading') {
      if (s.kind === 'lst' && typeof vehUnload === 'function') { vehUnload(s, dt); continue; }   // 坦克登陆舰：车辆逐辆驶下跳板
      if ((s.ut += dt) >= 3) disembark(s);
      continue;
    }
    // 坦克登陆舰卸空后退出滩头、回到近岸海面待命，把抢滩位置让给后续舰艇（拉着增援线的船留下）
    if (s.state === 'beached' && s.kind === 'lst' && alive(s) && !apLoadedShip(s) && S.t - (s.beT ?? S.t) > 15 && !(S.rlines || []).some(l => l.ship === s.id)) {
      const j = nearestPassable(ci(s.x, clamp(coastAt(s.x) + 170, 8, H - 8)), 'ship');
      if (j >= 0) { Object.assign(s, { land: false, bx: null, by: null, tx: cellCX(j), ty: cellCY(j), state: 'move', pkD: null }); log(`${s.label} 卸载完毕，退出滩头`, 'info', 'lstout' + s.id, 30, s); }
      continue;
    }
    if (s.state !== 'move') continue;
    // 未清除的反登陆障碍
    if (OBSC[ci(s.x, s.y)] && !s.hover) for (const o of S.obst) if (!o.dead && dist(o.x, o.y, s.x, s.y) < 12) {   // 气垫艇（hover）从障碍上越过
      o.dead = true; o.known = true; damageShip(s, 1.6); rebuildForts();
      log(`${s.label} 撞上反登陆障碍`, 'bad', null, 0, s);
    }
    if (!sailTo(s, dt, 26 * (s.spdK || 1))) continue;   // spdK：气垫登陆艇约 2.2 倍
    if (s.land) { s.state = 'unloading'; s.ut = 0; log(`${s.label} 抢滩`, 'good', null, 0, { x: s.bx, y: s.by }); }
    else s.state = 'idle';
  }
}

const apLoadedShip = s => !!s.load && (s.load.teams > 0 || s.load.eng > 0 || (Array.isArray(s.load.veh) && s.load.veh.length > 0));
function disembark(s) {
  s.state = 'beached'; s.beT = S.t;
  const n = s.load.teams;
  if (n) {
    // 按登陆前预设的阵型在滩头展开
    const u = addUnit('p', 'inf', { ship: s.label, emblem: s.kind, form: s.form || 'line', face: NORTH, auto: s.unitAuto !== false });
    for (const [x, y] of unitSlots(n, u.form, s.bx, s.by - 14, NORTH, defWidth(u.form, n))) addTeam('p', x, y, ['radio', 'rifle', 'mg'], { unit: s.label, u: u.id });
  }
  if (s.load.eng) {
    const ue = addUnit('p', 'eng', { ship: s.label, emblem: 'eng', face: NORTH, auto: true });
    const e = addTeam('p', s.bx, s.by, ['eng', 'eng', 'eng'], { unit: s.label, depot: s.id, u: ue.id });
    makeSupplyLine(s, e);
    log(`${s.label} 建立滩头补给站，补给线接通后方`, 'good');
  }
  if (s.load.veh && s.load.veh.length && typeof vehDisembark === 'function') vehDisembark(s);   // 舱内仍有车辆：一次放下
  s.load = { teams: 0, eng: 0, veh: [] };
}

function makeSupplyLine(s, eng) {
  const x1 = s.x, y1 = s.y, x2 = lerp(s.x, W / 2, .2), y2 = STAGING_Y + 60, n = 7, segs = [];
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

// 撤退落脚点：退到搁滩舰船旁，但在滩顶 25–55 内找掩蔽最好的地方趴下（弹坑、堤坎、林缘），各组错开——不在水线上挤成一团挨打
function retreatSpot(bx, by, k) {
  let best = [bx, by], bc = Infinity;
  const a0 = (k || 0) * 2.4;
  for (let i = 0; i < 12; i++) {
    const a = a0 + i * .52, r = 25 + (i % 3) * 15, x = clamp(bx + Math.cos(a) * r, 5, W - 5), y = clamp(by - Math.abs(Math.sin(a)) * r, 5, H - 5);
    if (!isLand(x, y) || !passInf(x, y)) continue;
    const c = coverAt(x, y) + i * .004;
    if (c < bc) { bc = c; best = [x, y]; }
  }
  return best;
}
// t：move 移动（行进间射击）/ amove 攻击前进（遇敌停下交火）/ hold 坚守 / retreat 撤退 / clear 工兵排雷剪网
function orderTeams(teams, x, y, t) {
  if (!teams.length) return 0;
  if (t === 'hold') { for (const q of teams) q.order = { t: 'hold' }; log(`${teams.length} 个小组原地坚守`, 'info', 'ord', 1); return teams.length; }
  if (t === 'retreat') {
    teams.forEach((q, k) => {
      const bh = S.ships.filter(s => s.state === 'beached').sort((a, b) => dist(a.bx, a.by, q.x, q.y) - dist(b.bx, b.by, q.x, q.y))[0];
      const bx = bh ? bh.bx : q.x, by = bh ? bh.by - 10 : Math.min(q.y + 80, coastAt(q.x) - 10), [tx, ty] = retreatSpot(bx, by, k);
      q.order = { t: 'retreat', x: tx, y: ty, gx: tx, gy: ty };
    });
    log(`${teams.length} 个小组撤向滩头`, 'warn', 'ord', 1);
    return teams.length;
  }
  if (!fieldOk(x, y, 'p')) { log('该位置无法到达', 'warn', 'unreach', 2); return 0; }   // 只判断目标点附近有没有能站的格（下令时不为它整图算流场）
  const cxs = teams.reduce((a, q) => a + q.x, 0) / teams.length, cys = teams.reduce((a, q) => a + q.y, 0) / teams.length;
  const ang = Math.atan2(y - cys, x - cxs), slots = formationSlots(teams.length, x, y, ang);
  const px = -Math.sin(ang), py = Math.cos(ang), key = (a, b) => a[0] * px + a[1] * py - (b[0] * px + b[1] * py);
  const ts = teams.slice().sort((a, b) => key([a.x, a.y], [b.x, b.y])), ss = slots.slice().sort(key);
  ts.forEach((q, k) => { q.order = { t, x: ss[k][0], y: ss[k][1], gx: x, gy: y }; q.pathT = -9; });
  return teams.length;
}

function clearLine(x0, y0, x1, y1, side) {
  const n = Math.ceil(dist(x0, y0, x1, y1) / 8);
  for (let s = 1; s <= n; s++) {
    const i = ci(lerp(x0, x1, s / n), lerp(y0, y1, s / n));
    if (!spInf(TER.type[i]) || WIREC[i] || (MINEC[i] && (side === 'e' || MINEC[i] === 2))) return false;
  }
  return true;
}

function moveTeam(q, dt, mul) {
  const o = q.order;
  if (!o.bf) { o.bf = true; const b = bldOut(o.x, o.y); if (b && passInf(b[0], b[1])) [o.x, o.y] = b; }   // 落脚点在房子里：改到墙根街边
  const dd = dist(q.x, q.y, o.x, o.y);
  if (dd < 3) return true;
  if (S.t - (q.pathT ?? -9) > 1) { q.pathT = S.t; q.direct = clearLine(q.x, q.y, o.x, o.y, q.side); }
  let tx = o.x, ty = o.y;
  if (!q.direct && dd > 16) {   // 沿路点走（grid.js pathStep：取一次流场管 50 格；往前多看两个路点，能直线走到就直接朝那里走）
    const gx = o.gx ?? o.x, gy = o.gy ?? o.y, r = pathStep(q, gx, gy, q.side, () => field(gx, gy, q.side), (x0, y0, x1, y1) => clearLine(x0, y0, x1, y1, q.side));
    // 已走到编组中心而本组槽位不能直达（隔水、隔崖）：就地停下，免得在中心与槽位之间来回打转
    if (r && r.end && o.gx != null && (o.gx !== o.x || o.gy !== o.y)) return true;
    if (r && r.x != null) [tx, ty] = [r.x, r.y];
  }
  const i = ci(q.x, q.y);
  const crawl = q.prone ? (o.t === 'retreat' || o.dodge ? .75 : o.t === 'charge' || o.t === 'amove' ? .6 : .4) : 1;   // 卧倒：匍匐 / 短促跃进
  const sp = (q.side === 'p' ? (q.kind === 'eng' ? 18 : 16) : 14) * (spInf(TER.type[i]) || .5) * (WIREC[i] ? .3 : 1) * (q.sup > 30 ? .7 : 1) * crawl * mul * dt;
  const l = dist(q.x, q.y, tx, ty) || 1;
  const rx = q.x + (tx - q.x) / l * Math.min(sp, l), ry = q.y + (ty - q.y) / l * Math.min(sp, l);
  let px = 0, py = 0;
  for (const o2 of S.teams) if (o2 !== q && o2.side === q.side) {
    const d2 = dist(rx, ry, o2.x, o2.y);
    if (d2 < 9 && d2 > .01) { px += (rx - o2.x) / d2 * (9 - d2) * .3; py += (ry - o2.y) / d2 * (9 - d2) * .3; }
  }
  // 避让只横向错开，不把小组往回推（桥上对向两组否则互相顶住，整排卡死）
  const ux = (tx - q.x) / l, uy = (ty - q.y) / l, back = px * ux + py * uy;
  if (back < 0) { px -= back * ux; py -= back * uy; }
  let nx = rx + px, ny = ry + py;
  // 避让把小组推到不能走的格时改走原步；原步斜切不可走格的角（卡在格角上）时沿单轴滑过；都不行则改按寻路场走（河流可以涉水，算能走）
  if (!wadeInf(nx, ny)) {
    if (wadeInf(rx, ry)) { nx = rx; ny = ry; }
    else if (wadeInf(rx, q.y)) { nx = rx; ny = q.y; }
    else if (wadeInf(q.x, ry)) { nx = q.x; ny = ry; }
    else { q.direct = false; q.pathT = S.t; return false; }
  }
  const bo = bldOut(nx, ny, .6);   // 避让推进了房子：贴墙走
  if (bo && passInf(bo[0], bo[1])) [nx, ny] = bo;
  q.x = nx; q.y = ny; q.movedT = S.t;
  if (dd > 8 || q.heading == null) { q.heading = Math.atan2(ty - q.y, tx - q.x); q.hT = S.t; }   // 离落脚点几米内的小幅修正不转身（否则槽位一挪，三个人就绕着小组中心来回甩）
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
  if (q.side === 'p') log('触雷！雷区已标定', 'bad', 'mine' + m.id, 6, q);
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
    if (m.clr >= 1) { m.clr = 1; rebuildForts(); log('雷区已清除', 'good', null, 0, m); }
  }
  if (w) { w.prog = (w.prog || 0) + rate / 4; if (w.prog >= 1) { w.cut = true; w.known = true; rebuildForts(); log('工兵剪开一段铁丝网', 'good', 'wire', 3); } }
  return q.working;
}
