'use strict';
// 编制与阵型：排由若干三人组构成；横队 / 三三制楔形 / 散开；拖拽定宽定向；士气、溃退与重整；冲锋白刃
let UNIT_MAP = new Map(), UNIT_TEAMS = new Map();
const NORTH = -Math.PI / 2, SOUTH = Math.PI / 2;

function addUnit(side, kind, extra) {
  const u = { id: S.nid++, side, kind, form: 'line', face: side === 'p' ? NORTH : SOUTH, width: 0, morale: side === 'p' ? 80 : aiD().morale,
    state: 'ok', men0: 0, order: 'hold', hitT: -99, flankT: -99, ...extra };
  S.units.push(u);
  UNIT_MAP.set(u.id, u);
  return u;
}

function indexUnits() {
  UNIT_MAP = new Map(S.units.map(u => [u.id, u]));
  UNIT_TEAMS = new Map();
  for (const q of S.teams) if (q.u && q.men.length) {
    if (!UNIT_TEAMS.has(q.u)) UNIT_TEAMS.set(q.u, []);
    UNIT_TEAMS.get(q.u).push(q);
  }
}
const teamsOf = u => UNIT_TEAMS.get(u.id) || [];
const unitOf = q => UNIT_MAP.get(q.u);
const angDiff = (a, b) => { const d = Math.abs(a - b) % 6.2832; return d > 3.1416 ? 6.2832 - d : d; };
// 朝向：刚开过火（2.5 秒内）就面朝所打的目标——边走边打、后撤时也面朝敌人；否则行进中朝前进方向，停下朝排正面
const faceOf = q => q.fx != null && S.t - (q.fT ?? -9) < 2.5 ? Math.atan2(q.fy - q.y, q.fx - q.x) : S.t - q.movedT < .5 && q.heading != null ? q.heading : unitOf(q) ? unitOf(q).face : SOUTH;
const unitName = u => u.side === 'p' ? (u.kind === 'eng' ? `${u.ship || ''}工兵` : /队\d*$/.test(u.ship || '') ? u.ship : `${u.ship || '增援'}排`) : '敌军';   // 「蛟龙突击队」这类本身是队名的不再加「排」

function defWidth(form, n) { return form === 'loose' ? Math.max(20, n * 34) : form === 'wedge' ? 28 + (n > 3 ? 84 : 0) : Math.max(16, n * 20); }

// 阵型槽位：face 为朝向（屏幕坐标角度），横轴垂直于朝向
function unitSlots(n, form, cx0, cy0, face, width) {
  const fx = Math.cos(face), fy = Math.sin(face), lx = -fy, ly = fx, out = [];
  const sc = width / defWidth(form, n);
  for (let i = 0; i < n; i++) {
    let lat, back;
    if (form === 'wedge') {
      // 三三制：三组成三角，三个三角再成三角
      const tri = [[0, 0], [-1, 1], [1, 1]], [a1, b1] = tri[i % 3], [a2, b2] = tri[Math.floor(i / 3) % 3];
      lat = (a1 * 14 + a2 * 42) * sc; back = (b1 * 13 + b2 * 36) * sc + Math.floor(i / 9) * 60;
    } else {
      const sp = n > 1 ? width / (n - 1) : 0;
      lat = -width / 2 + i * sp; back = form === 'loose' ? (i % 2) * 22 : 0;
    }
    let x = clamp(cx0 + lx * lat - fx * back, 5, W - 5), y = clamp(cy0 + ly * lat - fy * back, 5, H - 5);
    if (!passInf(x, y)) { const j = nearestPassable(ci(x, y), 'p'); if (j >= 0) { x = cellCX(j); y = cellCY(j); } }
    out.push([x, y]);
  }
  return out;
}

// 多个排沿一条线展开：total 为总宽（拖拽长度），不给则用各自默认宽度
function orderUnits(units, x, y, face, total, t) {
  units = units.filter(u => u.state !== 'rout' && teamsOf(u).length);
  if (!units.length) return 0;
  if (t === 'hold') { for (const u of units) { u.order = 'hold'; for (const q of teamsOf(u)) q.order = { t: 'hold' }; } return units.length; }
  if (t === 'retreat') { for (const u of units) { u.order = 'retreat'; orderTeams(teamsOf(u), 0, 0, 'retreat'); } return units.length; }
  if (!field(x, y, 'p')) { log('该位置无法到达', 'warn', 'unreach', 2); return 0; }
  for (const L of layoutUnits(units, x, y, face, total)) {
    Object.assign(L.u, { face, width: L.w, order: t, tx: L.ux, ty: L.uy });
    L.ts.forEach((q, k) => { q.order = { t, x: L.slots[k][0], y: L.slots[k][1], gx: L.ux, gy: L.uy }; q.pathT = -9; });
  }
  return units.length;
}

// 计算各排沿线展开后的位置与槽位（下令和拖拽预览共用）
function layoutUnits(units, x, y, face, total) {
  const lx = -Math.sin(face), ly = Math.cos(face), gap = 26, proj = u => (u.x ?? 0) * lx + (u.y ?? 0) * ly;
  units = units.slice().sort((a, b) => proj(a) - proj(b));
  const ws = units.map(u => defWidth(u.form, teamsOf(u).length)), sum = ws.reduce((a, b) => a + b, 0) + gap * (units.length - 1);
  const sc = total ? clamp(total / sum, .4, 3) : 1;
  let off = -sum * sc / 2;
  return units.map((u, i) => {
    const w = ws[i] * sc, c = off + w / 2, ux = x + lx * c, uy = y + ly * c;
    off += w + gap * sc;
    const ts = teamsOf(u).slice(), slots = unitSlots(ts.length, u.form, ux, uy, face, w), key = p => p[0] * lx + p[1] * ly;
    ts.sort((a, b) => key([a.x, a.y]) - key([b.x, b.y])); slots.sort((a, b) => key(a) - key(b));
    return { u, ux, uy, w, ts, slots };
  });
}

// —— 部署阶段：在集结海域内重新布阵、预定登陆点、开始战斗 ——
function deployOrder(ships, dd, x, y, cv) {
  const zone = y >= STAGING_Y && typeAt(x, y) === T.DEEP;
  ships.forEach((s, i) => {
    const k = (i - (ships.length - 1) / 2) * 32;
    if (zone) {
      const nx = clamp(x + k, 15, W - 15), ny = clamp(y + (i % 2) * 14, STAGING_Y + 10, H - 12);
      if (typeAt(nx, ny) === T.DEEP) Object.assign(s, { x: nx, y: ny, tx: nx, ty: ny, plan: null });
    } else if (s.kind === 'dd' && isLand(x + k, y)) { const j = ddStand(clamp(x + k, 8, W - 8)); s.plan = { x: cellCX(j), y: cellCY(j) }; }   // 护航舰不领登陆计划：改为滩头外海阵位
    else s.plan = { x: clamp(x + k, 8, W - 8), y };
  });
  if (ships.length && !zone && !isLand(x, y) && !landingPoint(x, y, 40)) log('该点不在滩头，舰船将停在海面', 'info', 'noplan', 2);
  if (dd) {
    if (zone) Object.assign(S.dd, { x, y: clamp(y, STAGING_Y + 10, H - 12), tx: x, ty: y, plan: null });
    else if (!isLand(x, y)) S.dd.plan = { x, y };
  }
  if (cv && S.cv && zone) Object.assign(S.cv, { x: clamp(x, 90, W - 90), y: clamp(y, STAGING_Y + 60, H - 30), tx: x, ty: y, moving: false });
}

function startBattle() {
  if (S.phase !== 'deploy') return;
  S.phase = 'battle'; S.paused = false;
  if (S.role === 'spectate') {   // AI 接管全部兵力：舰船自选滩头抢滩，驱逐舰、航母、车辆、各排自动
    for (const u of S.units) if (u.side === 'p') u.auto = true;
    for (const s of S.ships) if (!s.sbxHold) s.auto = true;
    for (const v of S.veh || []) if (v.side === 'p') v.auto = true;
    if (S.dd) S.dd.auto = S.dd.state !== 'sunk';
    if (S.cv) S.cv.auto = S.cv.hp > 0;
  }
  for (const s of S.ships) if (s.plan) { orderShips([s], s.plan.x, s.plan.y); s.plan = null; }
  if (S.dd.plan) { orderDD(S.dd.plan.x, S.dd.plan.y); S.dd.plan = null; }
  if (typeof vehStartBattle === 'function') vehStartBattle();   // 车辆的预定上陆点（vehicles.js）
  if (typeof cvShoo === 'function') cvShoo(0, true);   // 部署时压在航母舰体上的舰艇挪开（cvdeck.js）
  log('H 时已到，登陆开始', 'warn');
}

function setForm(units, form) {
  for (const u of units) {
    u.form = form;
    if (u.x != null && u.state !== 'rout') orderUnits([u], u.tx ?? u.x, u.ty ?? u.y, u.face, null, u.order === 'hold' ? 'move' : u.order);
  }
}

// —— 士气：伤亡、压制、侧后受袭、友军在侧、溃逃友军都会影响 ——
function updateUnits(dt) {
  const D = aiD();
  for (const u of S.units) {
    const ts = teamsOf(u);
    if (!ts.length) { u.dead = true; continue; }
    const men = ts.reduce((a, q) => a + q.men.length, 0);
    u.men = men; u.men0 = Math.max(u.men0 || 0, men);
    u.x = ts.reduce((a, q) => a + q.x, 0) / ts.length; u.y = ts.reduce((a, q) => a + q.y, 0) / ts.length;
    const sup = ts.reduce((a, q) => a + q.sup, 0) / ts.length, hit = S.t - u.hitT < 3;
    // 溃退到位（撤到落脚点、趴在掩蔽处 12 秒以上）：压制的影响减半以上，军官、骨干收拢溃兵——不会一直卡在 0
    const settled = u.state === 'rout' && S.t - (u.routT ?? 0) > 12 && ts.every(q => !q.order || q.order.t !== 'retreat');
    let dm = -sup / 100 * (settled ? 2 : 5) * (u.elite ? .5 : 1);   // 精锐排（蛟龙突击队等）：压制下士气掉得慢
    if (S.t - u.flankT < 3) dm -= 4;
    if (!hit) dm += u.order === 'hold' ? 5 : 2.5;
    if (settled) dm += hit ? 2 : 3;
    // 友邻：在侧的友军打气，溃逃的友军动摇军心——只影响还没溃的部队，最多扣 3（溃兵挤在一起不再互相拖到 0）
    let fr = 0;
    for (const o of S.units) if (o !== u && !o.dead && o.side === u.side && o.x != null && dist(o.x, o.y, u.x, u.y) < 150) fr += o.state === 'rout' ? (u.state === 'rout' ? 0 : -1.5) : 1;
    dm += clamp(fr, -3, 3);
    if (u.side === 'p' && ts.every(q => q.kind !== 'inf' || q.ammo < 5)) dm -= 1.5;
    if (u.side === 'e' && dm < 0) dm *= D.nerve;
    const cap = 35 + 65 * men / u.men0;
    u.morale = clamp(u.morale + dm * dt, 0, cap);
    // 刚重整的部队 25 秒内只有士气跌到 6 以下才会再溃（避免溃—整—溃来回跳）
    if (u.state !== 'rout' && u.morale < (S.t - (u.rallyT ?? -99) < 25 ? 6 : 22)) routUnit(u, ts);
    else if (u.state === 'rout') {
      // 背水一战：在滩头趴了 25 秒，退无可退，士气回到 30（或上限六成）就算还在挨打也重整
      const last = settled && S.t - (u.routT ?? 0) > 25;
      if ((u.morale > Math.min(45, cap * .8) && !hit) || (last && u.morale > Math.min(30, cap * .6))) rallyUnit(u, ts);
    }
    else u.state = u.morale < 50 ? 'waver' : 'ok';
  }
  if (S.units.some(u => u.dead)) S.units = S.units.filter(u => !u.dead);
}

function routUnit(u, ts) {
  u.state = 'rout'; u.routT = S.t;
  if (u.side === 'p') { orderTeams(ts, 0, 0, 'retreat'); log(`${unitName(u)}溃退`, 'bad', 'rt' + u.id, 20, u); }
  else { for (const q of ts) aiRout(q); if (inVision(u.x, u.y)) log('敌军阵线崩溃', 'good', 'ert' + u.id, 20, u); }
}
function rallyUnit(u, ts) {
  u.state = 'waver'; u.order = 'hold'; u.rallyT = S.t; v8Stat('rally');
  for (const q of ts) q.order = { t: 'hold' };
  if (u.side === 'p') log(`${unitName(u)}重整完毕`, 'info', 'rl' + u.id, 20, u);
}

// —— 冲锋：直扑最近的敌人，贴身后白刃 / 手榴弹；接敌前不射击 ——
// 不无脑冲：每秒按局部兵力判一次——冲击目标周围 45 以内的敌人（敌坦克按车组人数、装甲车折 3 人）比本组周围 45 以内的自己人（含坦克车组）多出 25% 以上、
// 又没被压住（平均压制 < 50），或要冲的碉堡还没被压制（< 40）而身边不到 9 人，就停止冲锋、就地火力压制，12 秒内不再冲
function chargeOdds(q, t) {
  let own = 0, opp = 0, sup = 0;
  for (const o of S.teams) {
    if (!o.men.length || o.ride) continue;
    if (o.side === q.side) { if (dist(o.x, o.y, q.x, q.y) < 45) own += o.men.length; }
    else if (dist(o.x, o.y, t.x, t.y) < 45) { opp += o.men.length; sup += o.sup * o.men.length; }
  }
  const vs = typeof vehFoes === 'function' ? vehFoes(q.side) : [];
  for (const v of vs) if (!v.lst && dist(v.x, v.y, t.x, t.y) < 60) opp += vehCrew(v);
  for (const v of S.veh || []) if (v.side === q.side && !v.dead && !v.lst && dist(v.x, v.y, q.x, q.y) < 45) own += vehCrew(v);   // 坦克按车组人数计
  if (q.side === 'p' && S.armor) for (const a of S.armor) if (!a.dead && dist(a.x, a.y, t.x, t.y) < 60) opp += 3;
  return { own, opp, sup: opp ? sup / opp : 100 };
}
function chargeStop(q, why) {
  q.order = { t: 'hold' }; q.chStop = S.t; v8Stat('chStop');
  const u = unitOf(q);
  if (q.side === 'p' && u) log(`${unitName(u)}冲锋受阻（${why}），转为就地火力压制`, 'warn', 'chstop' + u.id, 30, q);
}
// 返回 true：本步已处理（updateTeams 跳过后续的射击与机动——冲锋叫停时命令已改成坚守，不能再按旧的冲锋命令移动）
function chargeTick(q, dt) {
  if (S.t - (q.chStop ?? -99) < 12) { q.order = { t: 'hold' }; return true; }
  let best = null, bd = 90;
  for (const o of S.teams) if (o.side !== q.side && o.men.length) { const d = dist(q.x, q.y, o.x, o.y); if (d < bd) { bd = d; best = { t: o, d, k: 'tm' }; } }
  if (q.side === 'p') for (const e of S.enemies) if (!e.dead) { const d = dist(q.x, q.y, e.x, e.y); if (d < bd) { bd = d; best = { t: e, d, k: 'st' }; } }
  if (!best) return false;
  const t = best.t;
  if ((q.chkT = (q.chkT ?? 0) - dt) <= 0) {
    q.chkT = 1;
    const o = chargeOdds(q, t);
    if (best.k === 'tm' && o.opp > o.own * 1.25 && o.sup < 50) { chargeStop(q, `当面之敌约 ${o.opp} 人未被压制`); return true; }
    if (best.k === 'st' && t.kind === 'bunker' && (t.sup || 0) < 40 && o.own < 9) { chargeStop(q, '碉堡火力未被压制'); return true; }
  }
  if (best.d > (best.k === 'st' ? 20 : 13)) {
    const sp = 22 * (spInf(typeAt(q.x, q.y)) || .5) * (WIREC[ci(q.x, q.y)] ? .3 : 1) * dt, l = best.d;
    const nx = q.x + (t.x - q.x) / l * sp, ny = q.y + (t.y - q.y) / l * sp;
    if (passInf(nx, ny)) { q.x = nx; q.y = ny; q.movedT = S.t; q.heading = Math.atan2(t.y - q.y, t.x - q.x); }
    return true;
  }
  if (best.k === 'st') { damageEnemy(t, 2.2 * q.men.length / 3 * dt); t.sup = 100; return true; }
  const ua = unitOf(q), ud = unitOf(t);
  const atk = q.men.length * (.6 + (ua ? ua.morale : 60) / 100);
  const def = t.men.length * (.6 + (ud ? ud.morale : 60) / 100) * (t.inTrench ? 1.3 : 1) * (1 - t.sup / 150);
  if (Math.random() < .9 * atk / (atk + def) * dt) killMan(t);
  if (Math.random() < .9 * def / (atk + def) * dt) killMan(q);
  if (ud) ud.morale -= 8 * dt * (ua && ua.morale > ud.morale ? 1.5 : .7);
  suppress(t, 30 * dt, q.x, q.y);
  return true;
}
