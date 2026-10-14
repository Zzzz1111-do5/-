/* =====================================================================
   The little people
   ===================================================================== */
const AG = [], TRACERS = [];
let agentSeq = 1;
const KIND_LABEL = { tank: '坦克', drone: '无人机', mech: '机甲', horse: '骑兵', cart: '大篷车', ship: '战舰', cannon: '炮兵', archer: '弓箭手', flag: '旗手' };
const ROLE_NAME = { farmer: '农夫', wood: '樵夫', miner: '矿工', worker: '工人', scholar: '学者', trader: '商人', soldier: '卫兵', builder: '工匠', child: '孩童', army: '士兵', settler: '拓荒者' };
const ROLE_SHIRT = { farmer: '#c09a48', wood: '#5d7a3c', miner: '#6a5a4a', worker: '#4a6a8a', scholar: '#e6e6ee', trader: '#9a5030', builder: '#d98a2a', child: '#e07a8a', settler: '#9a7a5a' };
const CARRY = { farmer: '#d8bc5a', wood: '#7a5230', miner: '#6a6a72', worker: '#a0a8b0', trader: '#d8b060' };
function personName() { return SYL[(rand2() * SYL.length) | 0] + SYL[(rand2() * SYL.length) | 0]; }
function pick2(a) { return a && a.length ? a[(rand2() * a.length) | 0] : null; }
function doingText(a, phase, c) {
  const n = S.nations[a.n];
  const tgt = n && n.target ? TECH_BY_ID[n.target].name : '古老的典籍';
  const T = {
    farmer: { go: '扛着锄头去田里', work: '正在田里耕作', home: '挑着收成回家' },
    wood: { go: '去林子里伐木', work: '正在砍树', home: '背着木材回城' },
    miner: { go: '前往矿山', work: '正在挖矿', home: '推着一车矿石回城' },
    worker: { go: '去工厂上班', work: '正在工厂做工', home: '下班回家' },
    scholar: { go: '去研究所', work: `正在钻研「${tgt}」`, home: '边走边思考' },
    builder: { go: '去工地', work: '正在盖房子', home: '收工回家' },
    soldier: { go: '在城中巡逻', work: '站岗放哨', home: '换岗回营' },
    child: { go: '在街上跑来跑去', work: '和小伙伴玩耍', home: '被叫回家吃饭' },
    trader: { go: '出发去做生意', work: '在集市做买卖', home: '满载而归' },
  }[a.role] || { go: '走在路上', work: '忙碌着', home: '回家' };
  return T[phase] || '';
}
function spawnCivilian(c, lay) {
  const n = S.nations[c.n];
  const wts = [
    ['farmer', lay.farms.length ? 4 : 0], ['wood', lay.forests.length ? 1 : 0], ['miner', lay.mines.length ? 1.4 : 0],
    ['worker', lay.factories.length ? 3 : 0], ['scholar', lay.labs.length ? 1.6 : 0], ['trader', c.links.length ? 0.9 : 0],
    ['soldier', 1.1], ['builder', 0.6], ['child', 0.8],
  ];
  let tot = 0; for (const w of wts) tot += w[1];
  let r = rand2() * tot, role = 'farmer';
  for (const w of wts) { r -= w[1]; if (r <= 0) { role = w[0]; break; } }
  const home = pick2(lay.homes) || [lay.cx, lay.cy];
  const a = { id: agentSeq++, c: c.id, n: c.n, role, x: home[0], y: home[1], tx: home[0], ty: home[1], st: 'rest', t: 0, sp: 3 + rand2() * 1.6, name: personName(), age: role === 'child' ? 5 + ((rand2() * 9) | 0) : 16 + ((rand2() * 48) | 0), dir: 1, ph: rand2() * 10, leg: '', doing: '', home, carry: null, hide: false, skin: SKINS[(n.id * 7 + (rand2() * 2 | 0)) % SKINS.length], hair: HAIRS[(rand2() * HAIRS.length) | 0] };
  nextTask(a, lay);
  const f = rand2();
  a.x = home[0] + wrapDx(a.tx - home[0]) * f; a.y = home[1] + (a.ty - home[1]) * f;
  AG.push(a);
  return a;
}
function walkTo(a, x, y, leg, doing) { a.tx = x; a.ty = y; a.leg = leg; a.st = 'walk'; a.doing = doing; a.hide = false; }
function nextTask(a, lay) {
  const c = cityById(a.c);
  if (!c) { a.st = 'dead'; a.t = 0.01; a.vanish = true; return; }
  lay = lay || layoutFor(c);
  if (a.st === 'work' && a.leg === 'job') { a.carry = CARRY[a.role] || null; walkTo(a, a.home[0], a.home[1], 'home', doingText(a, 'home', c)); return; }
  let p = null;
  switch (a.role) {
    case 'farmer': p = pick2(lay.farms); break;
    case 'wood': p = pick2(lay.forests); break;
    case 'miner': p = pick2(lay.mines); break;
    case 'worker': p = pick2(lay.factories); break;
    case 'scholar': p = pick2(lay.labs); break;
    case 'builder': p = pick2(lay.homes); break;
    case 'soldier': p = pick2(lay.patrol); break;
    case 'trader': { const o = cityById(pick2(c.links)); if (o) { const [ox, oy] = cityMpx(o); a.dest = o.id; walkTo(a, ox + (rand2() - 0.5) * 4, oy + (rand2() - 0.5) * 3, 'trade', `带着货物前往${o.name}`); a.carry = '#d8b060'; return; } break; }
    case 'child': p = [lay.cx + (rand2() - 0.5) * lay.r * 1.4, lay.cy + (rand2() - 0.5) * lay.r]; break;
  }
  if (!p) p = [lay.cx + (rand2() - 0.5) * lay.r, lay.cy + (rand2() - 0.5) * lay.r * 0.7];
  walkTo(a, p[0] + (rand2() - 0.5) * 1.6, p[1] + (rand2() - 0.5) * 1.2, 'job', doingText(a, 'go', c));
}
function onArrive(a) {
  const c = cityById(a.c);
  if (a.leg === 'job') { a.st = 'work'; a.t = 2.5 + rand2() * 4; a.carry = null; a.doing = doingText(a, 'work', c); }
  else if (a.leg === 'home') { a.st = 'rest'; a.t = 1.2 + rand2() * 3; a.carry = null; a.hide = rand2() < 0.45; a.doing = a.hide ? '在屋里休息' : '在家门口歇脚'; }
  else if (a.leg === 'trade') { const o = cityById(a.dest); a.st = 'work'; a.leg = 'job'; a.t = 2 + rand2() * 2; a.doing = o ? `在${o.name}的集市上做买卖` : '在集市上做买卖'; }
  else if (a.leg === 'settle' || a.leg === 'retreat' || a.leg === 'enter') { a.st = 'dead'; a.t = 0.01; a.vanish = true; if (a.leg === 'settle') particleBurst(a.x, a.y - 2, '#ffd27a', 10); }
  else if (a.leg === 'march') { a.st = 'siege'; a.t = 0; const d = cityById(a.dest); a.doing = d ? `围攻${d.name}` : '攻城'; }
}
function moveAgent(a, dt, sp) {
  const dx = wrapDx(a.tx - a.x), dy = a.ty - a.y, d = Math.hypot(dx, dy);
  if (d < 1e-3) return true;
  const step = (sp || a.sp) * (a.boat ? 1.8 : 1) * dt;
  if (Math.abs(dx) > 0.05) a.dir = dx > 0 ? 1 : -1;
  if (d <= step) { a.x = ((a.tx % MW) + MW) % MW; a.y = a.ty; return true; }
  a.x += dx / d * step; a.y += dy / d * step;
  a.x = ((a.x % MW) + MW) % MW;
  const yi = clamp(a.y | 0, 0, MH - 1);
  a.boat = MWATER[yi * MW + (a.x | 0)] === 1 && a.kind !== 'drone';
  return false;
}
function killAgent(e) { e.st = 'dead'; e.t = 2.5; e.doing = '阵亡'; if (cam.follow === e) cam.follow = null; }
function updateAgents(dt) {
  for (let k = AG.length - 1; k >= 0; k--) {
    const a = AG[k];
    a.ph += dt;
    if (a.flash > 0) a.flash -= dt;
    if (a.st === 'dead') { a.t -= dt; if (a.t <= 0) AG.splice(k, 1); continue; }
    if (a.role === 'army') { armyStep(a, dt); continue; }
    if (a.st === 'walk') { if (moveAgent(a, dt)) onArrive(a); }
    else { a.t -= dt; if (a.t <= 0) nextTask(a); }
  }
  for (let k = TRACERS.length - 1; k >= 0; k--) { TRACERS[k].t -= dt; if (TRACERS[k].t <= 0) TRACERS.splice(k, 1); }
  updateProjectiles(dt);
}
function manageAgents() {
  if (viewMode !== 'map' || cam.z < AGENT_Z || !showPeople) { if (AG.length) AG.length = 0; return; }
  const inR = viewRect(40);
  const counts = new Map(), live = new Set();
  for (const a of AG) if (a.role !== 'army' && a.role !== 'settler' && a.st !== 'dead') counts.set(a.c, (counts.get(a.c) || 0) + 1);
  for (const c of S.cities) {
    const [cx, cy] = cityMpx(c);
    if (!inR(cx, cy)) continue;
    live.add(c.id);
    const tc = clamp(Math.round(3 + Math.log2(c.pop / 1e4 + 1) * 2.4), 3, 30);
    let have = counts.get(c.id) || 0;
    if (have >= tc) continue;
    const lay = layoutFor(c);
    for (; have < tc; have++) spawnCivilian(c, lay);
  }
  const far = viewRect(160);
  for (let k = AG.length - 1; k >= 0; k--) {
    const a = AG[k];
    if (a.role === 'army' || a.role === 'settler' || a.leg === 'trade') { if (!far(a.x, a.y)) AG.splice(k, 1); continue; }
    if (!live.has(a.c)) AG.splice(k, 1);
  }
  if (AG.length > 2600) AG.splice(0, AG.length - 2600);
}
const BATTLES = [], PROJ = [];
function wetBetween(ax, ay, bx, by) { let wet = 0; for (let k = 1; k < 10; k++) if (!landAt(ax + wrapDx(bx - ax) * k / 10, ay + (by - ay) * k / 10)) wet++; return wet; }
function seaPoint(ax, ay, bx, by) { const pts = []; for (let k = 1; k < 24; k++) { const x = ax + wrapDx(bx - ax) * k / 24, y = ay + (by - ay) * k / 24; if (!landAt(x, y)) pts.push([x, y]); } return pts.length ? pts[(pts.length / 2) | 0] : [ax + wrapDx(bx - ax) / 2, (ay + by) / 2]; }
function landPoint(ax, ay, bx, by) { for (let k = 0; k < 11; k++) { const f = 0.5 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.045, x = ax + wrapDx(bx - ax) * f, y = ay + (by - ay) * f; if (landAt(x, y)) return [((x % MW) + MW) % MW, y]; } return [ax + wrapDx(bx - ax) / 2, (ay + by) / 2]; }
function portOf(c) { const lay = layoutFor(c); const p = lay.items.find(it => it.t === 'port'); return p ? [p.x + (p.dir || 1) * 4, p.y] : null; }
function manageArmies() {
  BATTLES.length = 0;
  if (viewMode !== 'map' || cam.z < AGENT_Z || !showPeople) return;
  const vis = viewRect(90);
  for (const w of S.wars) {
    const A = S.nations[w.a], Bn = S.nations[w.b];
    if (!A.alive || !Bn.alive || !A.cl.length || !Bn.cl.length) continue;
    const pa = nearestPair(A, Bn), pb = nearestPair(Bn, A);
    if (!pa || !pb || pa.d > 40) continue;
    const ca = pa.c, cb = pb.c;
    const [ax, ay] = cityMpx(ca), [bx, by] = cityMpx(cb);
    const pairKey = ca.id + ':' + cb.id;
    if (!w.bp || w.bp.k !== pairKey) { const nv = wetBetween(ax, ay, bx, by) > 4; const pt = nv ? seaPoint(ax, ay, bx, by) : landPoint(ax, ay, bx, by); w.bp = { k: pairKey, x: pt[0], y: pt[1], naval: nv }; }
    const naval = w.bp.naval, px = w.bp.x, py = w.bp.y;
    if (naval && (!portOf(ca) || !portOf(cb))) continue;
    if (!vis(px, py) && !vis(ax, ay) && !vis(bx, by)) continue;
    if (!w.dead) w.dead = [0, 0];
    BATTLES.push({ w, x: px, y: py, a: A, b: Bn, naval });
    const powA = power(A), powB = power(Bn), share = powA / (powA + powB);
    const base = clamp(9 + Math.max(A.mult.era, Bn.mult.era), 9, 18) * (naval ? 0.5 : 1);
    const want = [Math.round(base * clamp(share * 2, 0.5, 1.6)), Math.round(base * clamp((1 - share) * 2, 0.5, 1.6))];
    const have = [0, 0], slots = [0, 0];
    for (const a of AG) if (a.role === 'army' && a.war === w.id && !a.order) { slots[a.side] = Math.max(slots[a.side], (a.slot || 0) + 1); if (a.st !== 'dead') have[a.side]++; }
    for (let sd = 0; sd < 2; sd++) for (let j = 0; j < Math.min(3, want[sd] - have[sd]); j++) spawnSoldier(sd === 0 ? ca : cb, sd === 0 ? cb : ca, w.id, sd, null, { px, py, slot: have[sd] === 0 && j === 0 ? 0 : slots[sd] + j + 1, naval });
  }
}
function spawnSoldier(src, dst, warId, side, orderId, opt) {
  opt = opt || {};
  const n = S.nations[src.n];
  let [sx, sy] = cityMpx(src);
  const [tx, ty] = cityMpx(dst);
  const wp = n.mult.weapon, slot = opt.slot || 0;
  let kind = 'foot';
  if (opt.naval) { const port = portOf(src); if (!port) return null; sx = port[0]; sy = port[1]; kind = 'ship'; }
  else if (slot === 0 && opt.px !== undefined) kind = 'flag';
  else if (n.mult.cannon && wp >= 3 && wp <= 5 && slot % 7 === 3) kind = 'cannon';
  else if (wp <= 3 && n.mult.bow && rand2() < 0.32) kind = 'archer';
  else if (wp === 3 && rand2() < 0.45) kind = 'horse';
  else if (wp >= 8 && rand2() < 0.3) kind = 'mech';
  else if (wp >= 7 && rand2() < 0.3) kind = 'drone';
  else if (wp >= 6 && rand2() < 0.4) kind = 'tank';
  let rally = null;
  if (opt.px !== undefined) {
    const ux0 = wrapDx(opt.px - sx), uy0 = opt.py - sy, ul = Math.hypot(ux0, uy0) || 1, ux = ux0 / ul, uy = uy0 / ul, vx = -uy, vy = ux;
    const back = kind === 'cannon' ? 17 : kind === 'flag' ? 13 : kind === 'archer' ? 11 : kind === 'ship' ? 5 : 8;
    const row = Math.floor(slot / 6), col = slot % 6;
    const sp2 = kind === 'ship' ? 5 : 2.6;
    rally = [opt.px - ux * (back + row * sp2) + vx * (col - 2.5) * sp2, opt.py - uy * (back + row * sp2) + vy * (col - 2.5) * sp2];
    // reinforcements arrive from just behind the line instead of marching all the way from the city
    const far = Math.min(ul, 30 + rand2() * 22), jx = opt.px - ux * far + vx * (rand2() - 0.5) * 24, jy = opt.py - uy * far + vy * (rand2() - 0.5) * 24;
    if (kind === 'ship' ? !landAt(jx, jy) : landAt(jx, jy)) { sx = jx; sy = jy; }
  }
  const ranged = kind === 'archer' || kind === 'cannon' || kind === 'ship' || (wp >= 4 && kind !== 'horse' && kind !== 'flag');
  const a = { id: agentSeq++, c: src.id, n: src.n, role: 'army', kind, wp, x: sx + (kind === 'ship' ? 0 : (rand2() - 0.5) * 6), y: sy + (kind === 'ship' ? 0 : (rand2() - 0.5) * 4), tx: rally ? rally[0] : tx + (rand2() - 0.5) * 6, ty: rally ? rally[1] : ty + (rand2() - 0.5) * 6,
    st: 'walk', leg: rally ? 'rally' : 'march', war: warId, side, order: orderId, dest: dst.id, rally, slot,
    sp: kind === 'tank' ? 5.5 : kind === 'drone' ? 8 : kind === 'horse' ? 6.5 : kind === 'ship' ? 6 : kind === 'cannon' ? 3 : 4.4 + rand2(),
    name: personName(), age: 18 + ((rand2() * 20) | 0), dir: 1, ph: rand2() * 10, hp: kind === 'tank' || kind === 'mech' || kind === 'ship' ? 3 : 1,
    ranged, range: kind === 'cannon' ? 28 : kind === 'archer' ? 13 : kind === 'ship' ? 16 : wp >= 6 ? 11 : 8, cd: rand2() * 0.3, enemy: null,
    doing: rally ? `赶赴前线列阵` : `行军前往${dst.name}`, skin: SKINS[(n.id * 7) % SKINS.length], hair: HAIRS[(rand2() * HAIRS.length) | 0], atk: rand2() };
  AG.push(a);
  return a;
}
function fire(a, e) {
  const sy0 = a.y - (a.kind === 'drone' ? 9 : a.kind === 'ship' ? 2 : 2.5), ey = e.y - 2;
  const kind = a.kind === 'archer' || a.wp <= 2 ? 'arrow' : a.kind === 'cannon' ? 'ball' : a.kind === 'ship' ? (a.wp >= 6 ? 'missile' : 'ball') : a.kind === 'tank' ? 'shell' : a.kind === 'drone' ? 'bomb' : a.kind === 'mech' ? 'laser' : 'bullet';
  if (kind === 'bullet' || kind === 'laser') {
    TRACERS.push({ x0: a.x, y0: sy0, x1: e.x, y1: ey, t: kind === 'laser' ? 0.15 : 0.09, col: kind === 'laser' ? '#7ff6ff' : a.wp >= 5 ? '#fff3b0' : '#ffe6a0', w: kind === 'laser' ? 0.6 : 0.18 });
    if (a.wp <= 5) particle(a.x + a.dir * 2, sy0, a.dir * 1.5, -0.8, 1.2, '#e8e8e8', 1, 2, 0.5);
    hitRoll(a, e, 1);
    return;
  }
  const dur = kind === 'arrow' ? 0.7 : kind === 'ball' ? 1 : kind === 'missile' ? 0.8 : kind === 'bomb' ? 0.5 : 0.35;
  PROJ.push({ x0: a.x, y0: sy0, x1: e.x + (rand2() - 0.5) * 1.5, y1: ey, t: 0, dur, kind, a, e, arc: kind === 'arrow' ? 9 : kind === 'ball' ? 12 : kind === 'missile' ? 6 : 0 });
  if (kind === 'ball' || kind === 'shell') particle(a.x + a.dir * 2.5, sy0, a.dir * 2, -1, 1.5, '#d8d8d8', 1.6, 3, 0.6);
}
function hitRoll(a, e, k) {
  if (!e || e.st === 'dead') return;
  const pa = power(S.nations[a.n] || S.nations[0]), pe = power(S.nations[e.n] || S.nations[0]);
  const pk = 0.3 * clamp(pa / (pa + pe) * 2, 0.4, 1.6) * k * (a.kind === 'tank' || a.kind === 'mech' || a.kind === 'cannon' ? 1.6 : 1);
  if (rand2() < pk) { e.hp--; if (e.hp <= 0) { killAgent(e); const w = S.wars.find(x => x.id === a.war); if (w) { if (w.vis) w.vis[a.side]++; if (w.dead) w.dead[e.side]++; } for (let k2 = 0; k2 < 4; k2++) particle(e.x, e.y - 1.5, (rand2() - 0.5) * 4, -rand2() * 3, 0.6, '#8a1c1c', 0.5, 0); } }
}
function updateProjectiles(dt) {
  for (let k = PROJ.length - 1; k >= 0; k--) {
    const p = PROJ[k]; p.t += dt;
    if (p.t < p.dur) continue;
    PROJ.splice(k, 1);
    if (p.kind === 'arrow') hitRoll(p.a, p.e, 1);
    else {
      const big = p.kind === 'ball' || p.kind === 'missile' || p.kind === 'bomb';
      for (let j = 0; j < (big ? 14 : 8); j++) { const an = rand2() * TAU, sp = 2 + rand2() * (big ? 9 : 6); particle(p.x1, p.y1, Math.cos(an) * sp, Math.sin(an) * sp - 2, 0.5 + rand2() * 0.4, rand2() < 0.5 ? '#ffb347' : '#ff6a2a', 0.8, 0.5); }
      particle(p.x1, p.y1 - 1, 0, -1.5, 1.6, '#6a6460', 2, 4, 0.5);
      for (const e of AG) if (e.role === 'army' && e.st !== 'dead' && e.side !== p.a.side && e.war === p.a.war && Math.hypot(wrapDx(e.x - p.x1), e.y - p.y1) < (big ? 3.2 : 2.2)) hitRoll(p.a, e, e === p.e ? 1.2 : 0.6);
    }
  }
}
function armyStep(a, dt) {
  const w = a.war ? S.wars.find(x => x.id === a.war) : null;
  if (!w && !a.order && a.leg !== 'retreat' && a.leg !== 'enter') {
    const c = cityById(a.c);
    if (c) { const [hx, hy] = a.kind === 'ship' && portOf(c) ? portOf(c) : cityMpx(c); walkTo(a, hx, hy, 'retreat', '战争结束，返回家乡'); a.enemy = null; }
    else { a.st = 'dead'; a.t = 0.01; a.vanish = true; return; }
  }
  if (a.leg === 'retreat' || a.leg === 'enter') { if (moveAgent(a, dt)) onArrive(a); return; }
  a.cd -= dt;
  if (a.cd <= 0) {
    a.cd = 0.25 + rand2() * 0.1;
    let best = null, bd = a.ranged ? a.range + 3 : 13;
    for (const e of AG) {
      if (e.role !== 'army' || e.st === 'dead' || e.side === a.side) continue;
      if (a.war ? e.war !== a.war : e.n === a.n) continue;
      if ((a.kind === 'ship') !== (e.kind === 'ship') && a.kind !== 'drone' && e.kind !== 'drone' && !(a.kind === 'cannon')) continue;
      const d = Math.hypot(wrapDx(e.x - a.x), e.y - a.y) + (e.kind === 'flag' ? 4 : 0);
      if (d < bd) { bd = d; best = e; }
    }
    a.enemy = best;
  }
  const e = a.enemy && a.enemy.st !== 'dead' ? a.enemy : null;
  const ed = e ? Math.hypot(wrapDx(e.x - a.x), e.y - a.y) : 1e9;
  if (e && a.kind !== 'flag' && (a.ranged ? ed <= a.range : ed <= 1.9)) {
    a.dir = wrapDx(e.x - a.x) >= 0 ? 1 : -1;
    a.st = 'fight'; a.doing = `与${S.nations[e.n].name}的${KIND_LABEL[e.kind] || WEAPON_NAME[e.wp] + '兵'}交战`;
    a.atk -= dt;
    if (a.atk <= 0) { a.atk = (a.kind === 'cannon' ? 2.4 : a.ranged ? 1 : 0.6) + rand2() * 0.5; a.flash = 0.12; if (a.ranged) fire(a, e); else { spark(e.x, e.y - 2); hitRoll(a, e, 1); } }
    return;
  }
  if (a.leg === 'rally') {
    if (a.st === 'walk' || a.st === 'fight') { a.st = 'walk'; if (moveAgent(a, dt)) { a.st = 'hold'; a.t = 1.5 + rand2() * 2; a.doing = a.kind === 'flag' ? '高举军旗' : '列阵待命'; } return; }
    a.t -= dt;
    if (a.t <= 0 && a.kind !== 'flag' && a.kind !== 'cannon') { const d = cityById(a.dest); a.leg = 'march'; a.st = 'walk'; if (d) { const [dx2, dy2] = a.kind === 'ship' && portOf(d) ? portOf(d) : cityMpx(d); a.tx = dx2 + (rand2() - 0.5) * 8; a.ty = dy2 + (rand2() - 0.5) * 6; } a.doing = '冲锋！'; }
    return;
  }
  if (e && a.kind !== 'flag' && !a.ranged && ed < 14) { const tx = a.tx, ty = a.ty; a.tx = e.x; a.ty = e.y; a.st = 'walk'; moveAgent(a, dt); a.tx = tx; a.ty = ty; a.doing = `冲向${S.nations[e.n].name}的士兵`; return; }
  if (a.st === 'fight') { a.st = 'walk'; const d0 = cityById(a.dest); a.doing = d0 ? `行军前往${d0.name}` : '行军'; }
  if (a.st === 'siege') {
    a.t -= dt;
    const c = cityById(a.dest);
    if (a.t <= 0) { if (c) { const [cx, cy] = cityMpx(c); a.tx = cx + (rand2() - 0.5) * 14; a.ty = cy + (rand2() - 0.5) * 10; } a.t = 1.2 + rand2(); a.flash = 0.15; spark(a.x + a.dir * 1.5, a.y - 2); }
    if (c && rand2() < dt * 0.5) { const lay = layoutFor(c); const it = pick2(lay.items); if (it) for (let k = 0; k < 3; k++) particle(it.x + (rand2() - 0.5) * 3, it.y - 2 - rand2() * 2, (rand2() - 0.5) * 0.6, -2.5 - rand2() * 2, 1 + rand2(), rand2() < 0.6 ? '#ff7a2a' : '#ffcf5a', 0.9, 0.4); particle(it ? it.x : a.x, (it ? it.y : a.y) - 5, 0.3, -2, 2.5, '#4a4440', 1.6, 3.5, 0.45); }
    moveAgent(a, dt, a.sp * 0.4);
    return;
  }
  if (moveAgent(a, dt)) onArrive(a);
}

/* ---------- visual hooks called by the simulation ---------- */
function agentsVisible() { return viewMode === 'map' && cam.z >= AGENT_Z && showPeople && !booting; }
function onSettle(src, dst) {
  if (!agentsVisible()) return;
  const vis = viewRect(60), [sx, sy] = cityMpx(src), [dx, dy] = cityMpx(dst);
  if (!vis(sx, sy) && !vis(dx, dy)) return;
  const n = S.nations[src.n];
  for (let k = 0; k < 2; k++) {
    const a = { id: agentSeq++, c: dst.id, n: src.n, role: 'settler', kind: k === 0 ? 'cart' : 'foot', x: sx + k * 1.5, y: sy + k, tx: dx + k, ty: dy, st: 'walk', leg: 'settle', sp: 4.5, name: personName(), age: 20 + ((rand2() * 30) | 0), dir: 1, ph: rand2() * 10, doing: `举家迁往新城${dst.name}`, skin: SKINS[(n.id * 7) % SKINS.length], hair: HAIRS[(rand2() * HAIRS.length) | 0] };
    AG.push(a);
  }
}
function onCapture(c, win, lose) {
  addFx(c.i, 'capture', true, win.color);
  c.lay = null;
  for (const a of AG) {
    if (a.c !== c.id) continue;
    if (a.role === 'army' && a.n === lose.id) killAgent(a);
    else if (a.role !== 'army') { a.n = win.id; }
  }
}
function onOrder(o, fromC, toC) {
  if (!agentsVisible()) return;
  const vis = viewRect(80), [sx, sy] = cityMpx(fromC);
  if (!vis(sx, sy)) return;
  const w = warBetween(o.a, o.tn);
  for (let k = 0; k < 14; k++) spawnSoldier(fromC, toC, w ? w.id : 0, w && w.a === o.a ? 0 : 1, o.id);
}
function onOrderResult(o, ok, silent) {
  const tc = cityById(o.to);
  for (const a of AG) {
    if (a.order !== o.id || a.st === 'dead') continue;
    if (ok && tc) { const [cx, cy] = cityMpx(tc); walkTo(a, cx + (rand2() - 0.5) * 4, cy, 'enter', `开进${tc.name}`); }
    else if (rand2() < 0.6) killAgent(a);
    else { const c = cityById(a.c); if (c) { const [hx, hy] = cityMpx(c); walkTo(a, hx, hy, 'retreat', '溃败撤退'); } else killAgent(a); }
  }
  if (tc && !silent) addFx(tc.i, ok ? 'capture' : 'war', true, ok ? S.nations[o.a].color : null);
}
function onArmyGift(n) {
  if (!agentsVisible()) return;
  const c = cityById(n.capital) || largestCity(n); if (!c) return;
  const [cx, cy] = cityMpx(c); if (!viewRect(40)(cx, cy)) return;
  for (let k = 0; k < 8; k++) { const a = spawnSoldier(c, c, 0, 0, null); a.leg = 'retreat'; a.tx = cx + (rand2() - 0.5) * 16; a.ty = cy + (rand2() - 0.5) * 10; a.doing = '接受神力加持，列队操练'; }
}
function onCityRemoved(c) { for (const a of AG) if (a.c === c.id && a.role !== 'army' && a.st !== 'dead') killAgent(a); if (selected && selected.city === c.id) selected = { cell: c.i }; }

/* ---------- particles & effects ---------- */
const PARTS = [], FX = [], SHIPS = [];
function particle(x, y, vx, vy, life, col, size, grow, alpha) { if (PARTS.length < 1000) PARTS.push({ x, y, vx, vy, life, t: 0, col, size, grow: grow || 0, a: alpha ?? 1 }); }
function spark(x, y) { for (let k = 0; k < 3; k++) particle(x, y, (rand2() - 0.5) * 8, (rand2() - 0.8) * 6, 0.25, rand2() < 0.5 ? '#fff4b0' : '#ffb347', 0.5, 0); }
function particleBurst(x, y, col, n) { for (let k = 0; k < n; k++) { const a = rand2() * TAU, s = 3 + rand2() * 6; particle(x, y, Math.cos(a) * s, Math.sin(a) * s - 2, 0.8 + rand2() * 0.6, col, 0.8, 0); } }
function updateParticles(dt) { for (let k = PARTS.length - 1; k >= 0; k--) { const p = PARTS[k]; p.t += dt; if (p.t >= p.life) { PARTS.splice(k, 1); continue; } p.x += p.vx * dt; p.y += p.vy * dt; } }
function addFx(cell, type, strong, col) {
  if (cell === undefined || cell < 0) return;
  const ll = cellLatLon(cell), [mx, my] = cellMpx(cell);
  FX.push({ lat: ll.lat, lon: ll.lon, mx, my, t0: animT, type, col });
  if (FX.length > 60) FX.shift();
  if (viewMode !== 'map' || booting) return;
  const vis = viewRect(30)(mx, my);
  if (!vis) return;
  if (type === 'quake' && strong) cam.shake = 1;
  if (type === 'meteor') cam.shake = 1.2;
  if (type === 'volcano') for (let k = 0; k < 40; k++) particle(mx + (rand2() - 0.5) * 4, my - 4, (rand2() - 0.5) * 10, -6 - rand2() * 10, 1.5 + rand2(), rand2() < 0.5 ? '#ff6a2a' : '#ffb347', 1, 0);
  if (type === 'bless') for (let k = 0; k < 30; k++) particle(mx + (rand2() - 0.5) * 30, my + (rand2() - 0.5) * 20, 0, -3 - rand2() * 3, 1.5 + rand2(), '#ffd86a', 0.8, 0);
  if (type === 'inspire') for (let k = 0; k < 24; k++) particle(mx + (rand2() - 0.5) * 26, my + (rand2() - 0.5) * 18, 0, -2.5 - rand2() * 2, 1.4 + rand2(), '#8fd8ff', 0.8, 0);
  if (type === 'plague') for (let k = 0; k < 10; k++) particle(mx + (rand2() - 0.5) * 30, my + (rand2() - 0.5) * 20, (rand2() - 0.5) * 2, -0.5, 3 + rand2() * 2, '#7fd36a', 5, 6, 0.25);
  if (type === 'meteor') for (let k = 0; k < 60; k++) { const a = rand2() * TAU, s = 6 + rand2() * 22; particle(mx, my, Math.cos(a) * s, Math.sin(a) * s, 1 + rand2(), rand2() < 0.5 ? '#ff7a2a' : '#5a4a3a', 1.4, 1); }
}
function launchShip(n) { const c = cityById(n.capital) || largestCity(n); if (c) SHIPS.push({ lat: c.lat, lon: c.lon, t0: animT, ang: (rand() - 0.5) * 1.2 - PI / 2 }); }


function drawPerson(a, z) {
  const sx = sxOf(a.x), sy = syOf(a.y);
  if (sx < -30 || sx > view.w + 30 || sy < -40 || sy > view.h + 20) return;
  if (a.hide && a.st === 'rest') return;
  const n = S.nations[a.n]; if (!n) return;
  SPX = sx; SPY = sy; SPZ = z * 0.62;
  const dead = a.st === 'dead';
  if (dead) { if (a.vanish) return; ctx.globalAlpha = clamp(a.t / 2.5, 0, 1); }
  const shirt = a.role === 'army' || a.role === 'soldier' ? n.color : (ROLE_SHIRT[a.role] || '#a0a0a0');
  const skin = a.skin || SKINS[0], hair = a.hair || HAIRS[0];
  if (dead) { pr(-2, -1.2, 3, 1.2, shirt); pr(1, -1.4, 1.4, 1.4, skin); ctx.globalAlpha = 1; return; }
  const moving = a.st === 'walk';
  const step = moving ? (Math.floor(a.ph * 7) & 1) : 0;
  const d = a.dir || 1;
  if (a.boat) {
    pr(-3, -1.6, 6, 1.6, '#7a5230'); pr(-2.4, -2.1, 4.8, 0.5, '#9a6a40');
    pr(-0.2, -7, 0.4, 5, '#4a3424'); pr(0.2 * d, -6.6, 2.2 * d, 3.6, '#f2efe6');
    pr(-1.8, -3.6, 1.4, 1.5, skin); pr(-1.8, -4, 1.4, 0.5, hair);
    return;
  }
  if (a.kind === 'ship') {
    const hull = a.wp >= 5 ? '#5c6670' : '#6a4626', era = a.wp;
    pr(-4.5, -1.8, 9, 1.8, hull); pr(-5, -2.3, 10, 0.5, shade(hull.length === 7 ? hull : '#6a4626', 1.2)); pr(d > 0 ? 3.5 : -5, -1.4, 1.5, 1, hull);
    if (era < 4) { pr(-0.3, -9, 0.6, 7, '#4a3424'); pr(-3, -8.5, 6, 4.5, '#efe9da'); pr(-3, -8.5, 6, 0.6, n.color); }
    else if (era < 6) { for (const mx of [-2.6, 0, 2.6]) { pr(mx - 0.2, -9, 0.4, 7, '#4a3424'); pr(mx - 1.4, -8.4, 2.8, 2.4, '#efe9da'); pr(mx - 1.2, -5.6, 2.4, 2, '#efe9da'); } }
    else { pr(-2.5, -4, 5, 1.8, '#8a949e'); pr(-1, -5.6, 2, 1.6, '#9aa4ae'); pr(d > 0 ? 1.5 : -4.5, -3.6, 3, 0.5, '#4a525a'); }
    pr(d > 0 ? -4.4 : 3.2, -4.6, 1.2, 0.8, n.color);
    if (a.flash > 0) pr(d > 0 ? 4.8 : -5.8, -2.6, 1, 1, '#ffd27a');
    return;
  }
  if (a.kind === 'cannon') {
    pr(-2.6, -1.6, 1.4, 1.4, '#5a3a20'); pr(0.4, -1.6, 1.4, 1.4, '#5a3a20');
    pr(d > 0 ? -2 : -2.6, -2.6, 4.6, 1, '#3a3a3e'); pr(d > 0 ? 2 : -3.6, -2.9, 1.6, 0.8, '#2a2a2e');
    if (a.flash > 0) pr(d > 0 ? 3.6 : -5, -3.2, 1.4, 1.4, '#ffd27a');
    SPX = sx - d * z * 0.62 * 3.2;
  }
  if (a.kind === 'cart') {
    pr(-3, -3, 5, 2, '#8a6438'); pr(-3, -4.2, 5, 1.2, '#efe6d0'); pr(-2.6, -1, 1.2, 1, '#2a2018'); pr(0.6, -1, 1.2, 1, '#2a2018');
    pr(2 * d + (d > 0 ? 0 : -3), -3, 3, 1.6, '#7a5a3a'); pr(d > 0 ? 4.4 : -5, -3.6, 1, 1, '#7a5a3a');
    return;
  }
  if (a.kind === 'tank') {
    const tc = shade(n.color, 0.55);
    pr(-4, -1.4, 8, 1.4, '#2e2e2a'); pr(-3.6, -3, 7.2, 1.8, tc); pr(-1.6, -4.4, 3.2, 1.6, shade(n.color, 0.7)); pr(d > 0 ? 1.6 : -5.6, -4, 4, 0.6, '#2a2a26');
    if (a.flash > 0) pr(d > 0 ? 5.6 : -6.8, -4.3, 1.2, 1.2, '#ffd27a');
    return;
  }
  if (a.kind === 'drone') {
    ctx.globalAlpha = 0.35; pr(-1.5, -0.6, 3, 0.6, '#000'); ctx.globalAlpha = 1;
    const hy = -9 + Math.sin(a.ph * 4) * 0.6;
    pr(-0.8, hy, 1.6, 1.2, '#3a3e46'); pr(-3, hy - 0.4, 2.2, 0.4, '#3a3e46'); pr(0.8, hy - 0.4, 2.2, 0.4, '#3a3e46');
    const rp = (Math.floor(a.ph * 20) & 1) ? '#c8d0d8' : '#8a9098'; pr(-3.4, hy - 0.8, 1.2, 0.3, rp); pr(2.2, hy - 0.8, 1.2, 0.3, rp);
    pr(-0.3, hy + 0.2, 0.6, 0.5, n.color);
    return;
  }
  if (a.kind === 'mech') {
    SPZ = z * 1.1;
    const mc = '#9aa2aa';
    pr(-1.4, -2, 1, 2 - step * 0.4, '#5a6068'); pr(0.4, -2, 1, 2 - (1 - step) * 0.4, '#5a6068');
    pr(-1.8, -4.4, 3.6, 2.4, mc); pr(-0.8, -5.4, 1.6, 1, '#7a828a'); pr(-0.4, -5.1, 0.8, 0.4, '#ff4a4a');
    pr(d > 0 ? 1.8 : -3.4, -4.2, 1.6, 0.6, '#5a6068'); pr(-1.8, -3.8, 3.6, 0.5, n.color);
    if (a.flash > 0) pr(d > 0 ? 3.4 : -4.4, -4.3, 1, 1, '#ffd27a');
    return;
  }
  if (a.kind === 'horse') {
    pr(-3, -3.4, 6, 1.8, '#7a4e2a'); pr(d > 0 ? 2.4 : -3.8, -4.6, 1.4, 1.6, '#7a4e2a');
    pr(-2.6, -1.6, 0.6, 1.6 - step * 0.5, '#5a3a20'); pr(1.8, -1.6, 0.6, 1.6 - (1 - step) * 0.5, '#5a3a20');
    SPY = sy - 2.2 * z * 0.62;
  }
  const kid = a.role === 'child';
  if (kid) SPZ = z * 0.45;
  if (a.kind !== 'horse') { pr(-1, -2, 0.9, 2 - step * 0.5, '#3a3430'); pr(0.1, -2, 0.9, 2 - (1 - step) * 0.5, '#3a3430'); }
  pr(-1, -4, 2, 2, shirt);
  pr(-1, -6, 2, 2, skin);
  const hat = a.role === 'farmer' ? '#e2c46a' : a.role === 'miner' || a.role === 'builder' ? '#f0c040' : null;
  if (hat) { pr(-1.5, -6.4, 3, 0.6, hat); pr(-0.8, -7, 1.6, 0.6, hat); } else pr(-1, -6.3, 2, 0.6, hair);
  if (a.role === 'army' && a.wp >= 5) pr(-1.1, -6.6, 2.2, 0.8, shade(n.color, 0.6));
  if (a.carry) pr(d > 0 ? -2.2 : 1, -5, 1.2, 1.6, a.carry);
  const work = a.st === 'work' || a.st === 'fight' || a.st === 'siege';
  const up = work && (Math.floor(a.ph * (a.st === 'fight' ? 5 : 3)) & 1);
  switch (a.role) {
    case 'farmer': if (work) { pr(d > 0 ? 0.8 : -1.2, up ? -6 : -4.6, 0.4, 2.6, '#7a5a30'); pr(d > 0 ? 0.8 : -1.8, up ? -6.2 : -2.2, 1, 0.4, '#9aa0a8'); } break;
    case 'wood': if (work) { pr(d > 0 ? 0.8 : -1.2, up ? -6.2 : -4.8, 0.4, 2.4, '#7a5a30'); pr(d > 0 ? 1.1 : -1.9, up ? -6.4 : -3, 0.8, 0.8, '#9aa0a8'); } break;
    case 'miner': if (work) { pr(d > 0 ? 0.8 : -1.2, up ? -6.4 : -4.8, 0.4, 2.4, '#7a5a30'); pr(d > 0 ? 0.2 : -1.6, up ? -6.6 : -3.2, 1.8, 0.4, '#8a9098'); } break;
    case 'worker': case 'builder': if (work) { pr(d > 0 ? 0.9 : -1.3, up ? -5.6 : -4.4, 0.4, 1.6, '#7a5a30'); pr(d > 0 ? 0.7 : -1.5, up ? -5.9 : -4.6, 0.8, 0.5, '#7a7e86'); } break;
    case 'scholar': if (work) pr(d > 0 ? 0.6 : -1.8, -4.2, 1.2, 0.9, '#f4f0e0'); break;
    case 'trader': pr(d > 0 ? -2 : 1, -4.8, 1, 2, '#8a5a30'); break;
    case 'soldier': case 'army': {
      const wp = a.role === 'soldier' ? n.mult.weapon : a.wp;
      if (a.kind === 'flag') { pr(d > 0 ? 1 : -1.4, -11, 0.4, 9, '#5a4028'); const wv = Math.sin(animT * 5 + a.id) > 0 ? 0.3 : 0; pr(d > 0 ? 1.4 : -5.4, -11 + wv, 4, 2.6, n.color); pr(d > 0 ? 1.4 : -5.4, -8.6 + wv, 4, 0.4, shade(n.color, 0.6)); break; }
      if (a.kind === 'archer') { pr(d > 0 ? 1 : -1.4, -6.4, 0.4, 4, '#7a5230'); pr(d > 0 ? 1.4 : -1.8, -6.2, 0.3, 3.6, '#e8e0c8'); if (up && a.st === 'fight') pr(d > 0 ? 1.2 : -2.6, -4.6, 1.6, 0.25, '#c8b080'); pr(d > 0 ? -1.8 : 1, -5, 0.8, 2, '#6a4a2a'); break; }
      if (wp >= 4) { pr(d > 0 ? 0.6 : -3, up && a.st === 'fight' ? -4.6 : -4.2, 2.4, 0.45, '#2a2420'); if (a.flash > 0) pr(d > 0 ? 3 : -3.8, -4.7, 0.9, 0.9, '#ffe08a'); }
      else if (wp === 2 || wp === 3) { pr(d > 0 ? 0.9 : -1.3, up ? -6.8 : -5.6, 0.4, 2.8, '#c8ccd2'); pr(d > 0 ? 0.6 : -1.6, -4.2, 1, 0.4, '#8a6a3a'); }
      else { pr(d > 0 ? 1 : -1.4, up ? -8 : -7.2, 0.4, 5, '#7a5a30'); pr(d > 0 ? 0.9 : -1.5, up ? -8.6 : -7.8, 0.6, 0.8, wp >= 1 ? '#c08a3a' : '#8a8a8a'); }
      if (a.role === 'army' && wp < 4 && a.kind !== 'horse') pr(d > 0 ? -1.8 : 1, -4.4, 0.9, 1.8, shade(n.color, 0.7));
      break;
    }
  }
}

function drawAgents(z) {
  const list = AG.slice().sort((a, b) => a.y - b.y);
  for (const a of list) drawPerson(a, z);
  for (const t of TRACERS) {
    ctx.globalAlpha = clamp(t.t / 0.09, 0, 1); ctx.strokeStyle = t.col; ctx.lineWidth = Math.max(1, z * 0.18);
    ctx.beginPath(); ctx.moveTo(sxOf(t.x0), syOf(t.y0)); ctx.lineTo(sxOf(t.x0) + wrapDx(t.x1 - t.x0) * z, syOf(t.y1)); ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

let r2s = 77;
function rand2() { r2s = (r2s * 16807) % 2147483647; return r2s / 2147483647; }

function drawProjectiles(z) {
  for (const p of PROJ) {
    const f = p.t / p.dur, x = p.x0 + wrapDx(p.x1 - p.x0) * f, y = p.y0 + (p.y1 - p.y0) * f - Math.sin(f * PI) * p.arc;
    const sx = sxOf(x), sy = syOf(y);
    if (p.kind === 'arrow') { const f2 = Math.min(1, f + 0.05), x2 = p.x0 + wrapDx(p.x1 - p.x0) * f2, y2 = p.y0 + (p.y1 - p.y0) * f2 - Math.sin(f2 * PI) * p.arc; ctx.strokeStyle = '#d8c8a0'; ctx.lineWidth = Math.max(1, z * 0.15); ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + (sxOf(x2) - sx) * 2.5, sy + (syOf(y2) - sy) * 2.5); ctx.stroke(); }
    else { const r = Math.max(1.5, z * (p.kind === 'ball' ? 0.45 : 0.3)); ctx.fillStyle = p.kind === 'missile' ? '#ffcf6a' : '#2a2624'; ctx.beginPath(); ctx.arc(sx, sy, r, 0, TAU); ctx.fill(); if (p.kind === 'missile') particle(x, y, 0, 0, 0.4, '#d8d8d8', 0.6, 1.5, 0.5); }
  }
}
function drawBattleLabels(z) {
  ctx.font = `12px ${CSSV.font}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const b of BATTLES) {
    const sx = sxOf(b.x), sy = syOf(b.y) - (22 + 6 * z);
    if (sx < -100 || sx > view.w + 100 || sy < -20 || sy > view.h + 20) continue;
    const d = b.w.dead || [0, 0];
    const txt = `${b.a.name}  ⚔  ${b.b.name}${b.w.civil ? '（内战）' : b.naval ? '（海战）' : ''} · 阵亡 ${d[0]} : ${d[1]}`;
    const tw = ctx.measureText(txt).width + 22;
    ctx.fillStyle = 'rgba(6,10,20,.82)'; ctx.fillRect(sx - tw / 2, sy - 11, tw, 22);
    ctx.fillStyle = b.a.color; ctx.fillRect(sx - tw / 2, sy - 11, 4, 22);
    ctx.fillStyle = b.b.color; ctx.fillRect(sx + tw / 2 - 4, sy - 11, 4, 22);
    ctx.fillStyle = '#ffdfe2'; ctx.fillText(txt, sx, sy);
  }
  ctx.textAlign = 'left';
}
