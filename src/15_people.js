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
  a.boat = MWATER[yi * MW + (a.x | 0)] === 1 && a.dom !== 'sea' && a.dom !== 'air';
  return false;
}
function killAgent(e) { e.st = 'dead'; e.t = 2.5; e.doing = '阵亡'; if (cam.follow === e) cam.follow = null; }
function updateAgents(dt) {
  ARMY = [];
  for (const a of AG) if (a.role === 'army' && a.st !== 'dead') ARMY.push(a);
  for (let k = AG.length - 1; k >= 0; k--) {
    const a = AG[k];
    a.ph += dt;
    if (a.flash > 0) a.flash -= dt;
    if (a.st === 'dead') { a.t -= dt; if (a.unit) deadStep(a, dt); if (a.t <= 0) AG.splice(k, 1); continue; }
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
  let civ = 0;
  for (const a of AG) if (a.role !== 'army' && a.role !== 'settler' && a.st !== 'dead') { counts.set(a.c, (counts.get(a.c) || 0) + 1); civ++; }
  // cap the crowd: fewer people per city at mid zoom (they are tiny there) and a total cap per quality level
  const cap = [120, 220, 330, 440][GFX.level], zk = clamp((cam.z - 1.4) / 3.6, 0.3, 1);
  for (const c of S.cities) {
    const [cx, cy] = cityMpx(c);
    if (!inR(cx, cy)) continue;
    live.add(c.id);
    const tc = Math.max(2, Math.round(clamp(Math.round(3 + Math.log2(c.pop / 1e4 + 1) * 2.4), 3, 30) * zk));
    if (civ >= cap) continue;
    let have = counts.get(c.id) || 0;
    if (have >= tc) continue;
    const lay = layoutFor(c);
    for (; have < tc && civ < cap; have++, civ++) spawnCivilian(c, lay);
  }
  const far = viewRect(160);
  for (let k = AG.length - 1; k >= 0; k--) {
    const a = AG[k];
    if (a.role === 'army' || a.role === 'settler' || a.leg === 'trade') { if (!far(a.x, a.y)) AG.splice(k, 1); continue; }
    if (!live.has(a.c)) AG.splice(k, 1);
  }
  if (AG.length > 2600) AG.splice(0, AG.length - 2600);
}
/* =====================================================================
   Battles: every war shows up to three theatres — the land front
   (landPoint), a sea front (when both sides have coasts and navies) and an
   air layer over the hotter of the two. Units come from milUnitsFor(), hits
   follow hitChance() so the picture agrees with the war's numbers.
   ===================================================================== */
const BATTLES = [], PROJ = [];
const AIRK = 0.62;                       // altitude units → map px of lift (same scale as sprites)
const SIDE_CAP = { land: 24, sea: 10, air: 10 };
const BACK = { inf: 8, art: 19, arm: 6, at: 9, aa: 13, siege: 16, scr: 6, cap: 10, cv: 30, sub: 4 };
let ARMY = [], AIRL = [];                // live army agents (rebuilt per frame); aircraft drawn in their own pass
const pN = n => Math.max(1, Math.round(n * GFX.parts / 1.5));
const projCap = () => Math.round(400 * clamp(GFX.parts / 1.5, 0.3, 1));
function wetBetween(ax, ay, bx, by) { let wet = 0; for (let k = 1; k < 10; k++) if (!landAt(ax + wrapDx(bx - ax) * k / 10, ay + (by - ay) * k / 10)) wet++; return wet; }
function seaPoint(ax, ay, bx, by) { const pts = []; for (let k = 1; k < 24; k++) { const x = ax + wrapDx(bx - ax) * k / 24, y = ay + (by - ay) * k / 24; if (!landAt(x, y)) pts.push([x, y]); } return pts.length ? pts[(pts.length / 2) | 0] : [ax + wrapDx(bx - ax) / 2, (ay + by) / 2]; }
function landPoint(ax, ay, bx, by) { for (let k = 0; k < 11; k++) { const f = 0.5 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.045, x = ax + wrapDx(bx - ax) * f, y = ay + (by - ay) * f; if (landAt(x, y)) return [((x % MW) + MW) % MW, y]; } return [ax + wrapDx(bx - ax) / 2, (ay + by) / 2]; }
function portOf(c) { const lay = layoutFor(c); const p = lay.items.find(it => it.t === 'port'); return p ? [p.x + (p.dir || 1) * 4, p.y] : null; }
function openWater(x, y) { return !landAt(x, y) && !landAt(x + 4, y) && !landAt(x - 4, y) && !landAt(x, y + 3) && !landAt(x, y - 3); }
function nearWater(x, y, R) {
  if (openWater(x, y)) return [x, y];
  for (let r = 5; r <= (R || 42); r += 5) for (let k = 0; k < 16; k++) { const an = k / 16 * TAU, px = x + Math.cos(an) * r, py = y + Math.sin(an) * r * 0.7; if (openWater(px, py)) return [((px % MW) + MW) % MW, py]; }
  return null;
}
function lineGeo(sx, sy, px, py) { const ux0 = wrapDx(px - sx), uy0 = py - sy, ul = Math.hypot(ux0, uy0) || 1; return { ux: ux0 / ul, uy: uy0 / ul, ul }; }
function pickUnit(n, dom, host) {
  let L = milUnitsFor(n, dom);
  if (dom === 'air') { const f = L.filter(o => host === 'land' ? o.role !== 'nb' : true); if (f.length) L = f; }
  if (!L.length) return null;
  let t = 0; for (const o of L) t += o.w;
  let r = rand2() * t;
  for (const o of L) { r -= o.w; if (r <= 0) return o.unit; }
  return L[L.length - 1].unit;
}
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
    const key = ca.id + ':' + cb.id;
    if (!w.bp || w.bp.k !== key || w.bp.v !== 2) {
      const wet = wetBetween(ax, ay, bx, by), th = theatre(w);
      const lp = th.land || wet <= 4 ? landPoint(ax, ay, bx, by) : null;
      let sp = null;
      if (th.sea || wet > 4) { const s0 = wet > 0 ? seaPoint(ax, ay, bx, by) : lp || [(ax + bx) / 2, (ay + by) / 2]; sp = nearWater(s0[0], s0[1]); }
      if (lp && sp && Math.hypot(wrapDx(sp[0] - lp[0]), sp[1] - lp[1]) < 26) { const g = lineGeo(lp[0], lp[1], sp[0], sp[1]); const s2 = nearWater(lp[0] + g.ux * 34, lp[1] + g.uy * 34, 20); sp = s2 && Math.hypot(wrapDx(s2[0] - lp[0]), s2[1] - lp[1]) >= 26 ? s2 : null; }
      w.bp = { k: key, v: 2, land: lp, sea: sp };
    }
    const bp = w.bp;
    const seaOK = bp.sea && milUnitsFor(A, 'sea').length && milUnitsFor(Bn, 'sea').length;
    const airOK = milUnitsFor(A, 'air').length || milUnitsFor(Bn, 'air').length;
    const theatres = [];
    if (bp.land) theatres.push(['land', bp.land]);
    if (seaOK) theatres.push(['sea', bp.sea]);
    if (!theatres.length) continue;
    if (airOK) theatres.push(['air', theatres[0][1], theatres[0][0]]);
    if (!w.dead) w.dead = [0, 0];
    const FA = milForces(A), FB = milForces(Bn), era = Math.max(A.mult.era, Bn.mult.era);
    const base = clamp(9 + era, 9, 18);
    for (const [dom, pt, host] of theatres) {
      const [px, py] = pt;
      if (!vis(px, py) && (dom !== 'land' || (!vis(ax, ay) && !vis(bx, by)))) continue;
      BATTLES.push({ w, x: px, y: py, a: A, b: Bn, dom, host, air: airOK, airSup: w.air, seaCtl: w.sea, naval: dom === 'sea' });
      const fa = dom === 'land' ? FA.L : dom === 'sea' ? FA.S : FA.A, fb = dom === 'land' ? FB.L : dom === 'sea' ? FB.S : FB.A;
      const share = fa / (fa + fb || 1), mul = dom === 'land' ? 1 : dom === 'sea' ? 0.5 : 0.45 * (GFX.level === 0 ? 0.4 : 1);
      const has = [milUnitsFor(A, dom).length > 0, milUnitsFor(Bn, dom).length > 0];
      const want = [0, 1].map(sd => has[sd] ? Math.min(SIDE_CAP[dom], Math.max(dom === 'land' ? 1 : 1, Math.round(base * mul * clamp((sd ? 1 - share : share) * 2, 0.5, 1.6)))) : 0);
      const have = [0, 0], slots = [0, 0];
      for (const a of AG) if (a.role === 'army' && a.war === w.id && !a.order && (a.dom || 'land') === dom && !a.carrier) { slots[a.side] = Math.max(slots[a.side], (a.slot || 0) + 1); if (a.st !== 'dead') have[a.side]++; }
      const siege = dom === 'land' && era <= 3 && !!layoutFor(cb).wall;
      for (let sd = 0; sd < 2; sd++) for (let j = 0; j < Math.min(3, want[sd] - have[sd]); j++)
        spawnSoldier(sd === 0 ? ca : cb, sd === 0 ? cb : ca, w.id, sd, null, { px, py, dom, host, slot: dom === 'land' && have[sd] === 0 && j === 0 ? 0 : slots[sd] + j + 1, siege: siege && sd === 0 && S.nations[ca.n].techs.siege !== undefined });
    }
  }
}
function spawnSoldier(src, dst, warId, side, orderId, opt) {
  opt = opt || {};
  const n = S.nations[src.n]; if (!n) return null;
  const dom = opt.dom || 'land', slot = opt.slot || 0, flag = dom === 'land' && slot === 0 && opt.px !== undefined;
  let uid = opt.unit || (flag && n.mult.best ? n.mult.best.inf : null) || pickUnit(n, dom, opt.host);
  if (dom === 'land' && !flag && opt.siege && rand2() < 0.16) uid = 'catapult';
  const u = UNIT_BY_ID[uid] || UNIT_BY_ID.spear;
  if (dom === 'air') return spawnAir(n, src, u, warId, side, opt);
  let [sx, sy] = cityMpx(src);
  const [tx, ty] = cityMpx(dst), role = u.roles[0];
  let rally = null;
  if (opt.px !== undefined) {
    const g = lineGeo(sx, sy, opt.px, opt.py), vx = -g.uy, vy = g.ux;
    const back = flag ? 13 : (BACK[role] || 8) + (role === 'art' ? rand2() * 3 : 0);
    const row = Math.floor(slot / 6), col = slot % 6, sp2 = dom === 'sea' ? 6.5 : 2.6;
    rally = [opt.px - g.ux * (back + row * sp2) + vx * (col - 2.5) * sp2, opt.py - g.uy * (back + row * sp2) + vy * (col - 2.5) * sp2];
    if (dom === 'sea' && !openWater(rally[0], rally[1])) { rally = nearWater(rally[0], rally[1], 24); if (!rally) return null; }
    // reinforcements arrive from just behind the line instead of marching all the way from the city
    const far = Math.min(g.ul, 30 + rand2() * 22), jx = opt.px - g.ux * far + vx * (rand2() - 0.5) * 24, jy = opt.py - g.uy * far + vy * (rand2() - 0.5) * 24;
    if (dom === 'sea' ? openWater(jx, jy) : landAt(jx, jy)) { sx = jx; sy = jy; }
    else if (dom === 'sea') { const bx = rally[0] - g.ux * 18, by = rally[1] - g.uy * 18; if (openWater(bx, by)) { sx = bx; sy = by; } else { sx = rally[0]; sy = rally[1]; } }
  } else if (dom === 'sea') return null;
  const v = u.vis, range = clamp(u.range, 1.9, 60);
  const a = { id: agentSeq++, c: src.id, n: src.n, role: 'army', kind: flag ? 'flag' : u.id, unit: u.id, dom, wp: n.mult.weapon,
    x: sx + (dom === 'sea' ? 0 : (rand2() - 0.5) * 6), y: sy + (dom === 'sea' ? 0 : (rand2() - 0.5) * 4), tx: rally ? rally[0] : tx + (rand2() - 0.5) * 6, ty: rally ? rally[1] : ty + (rand2() - 0.5) * 6,
    st: 'walk', leg: rally ? 'rally' : 'march', war: warId, side, order: orderId, dest: dst.id, rally, slot,
    sp: dom === 'sea' ? 3 + u.sp * 0.45 : u.sp * (0.92 + rand2() * 0.16), hp: dom === 'sea' ? clamp(Math.round(u.hp * 0.5), 2, 6) : clamp(Math.round(u.hp * 0.6), 1, 4),
    ranged: range > 2.5, range, cd: rand2() * 0.3, enemy: null, atk: 0.5 + rand2() * 1.5, rec: 0, truck: !!v.truck, launch: 3 + rand2() * 4,
    name: personName(), age: 18 + ((rand2() * 20) | 0), dir: 1, ph: rand2() * 10,
    doing: rally ? (dom === 'sea' ? '驶向战位' : v.truck ? '乘卡车赶赴前线' : '赶赴前线列阵') : `行军前往${dst.name}`, skin: SKINS[(n.id * 7) % SKINS.length], hair: HAIRS[(rand2() * HAIRS.length) | 0] };
  AG.push(a);
  return a;
}
function airBeh(u, host) {
  if (u.spr === 'heli') return 'heli';
  const r = u.roles[0];
  if (r === 'fi') return host === 'sea' && u.roles.includes('nb') && rand2() < 0.35 ? 'torp' : 'fighter';
  if (r === 'nb') return host === 'sea' ? 'torp' : 'strike';
  if (r === 'bomb') return 'bomber';
  return 'strike';
}
function spawnAir(n, src, u, warId, side, opt) {
  const cx = opt.px, cy = opt.py; if (cx === undefined) return null;
  const [sx0, sy0] = cityMpx(src), g = lineGeo(sx0, sy0, cx, cy), vx = -g.uy, vy = g.ux, v = u.vis;
  const beh = airBeh(u, opt.host);
  const alt = v.alt || (beh === 'torp' ? 4 : beh === 'bomber' ? 19 + (v.size || 1) * 1.5 : beh === 'fighter' ? 14 + rand2() * 5 : u.spr === 'drone' ? (v.swarm ? 9 : 13) : 12);
  const fromDeck = opt.ox !== undefined;
  const x = fromDeck ? opt.ox : cx - g.ux * (60 + rand2() * 25) + vx * (rand2() - 0.5) * 50, y = fromDeck ? opt.oy : cy - g.uy * (60 + rand2() * 25) + vy * (rand2() - 0.5) * 50;
  const a = { id: agentSeq++, c: src.id, n: src.n, role: 'army', kind: u.id, unit: u.id, dom: 'air', beh, war: warId, side, dest: src.id, carrier: !!fromDeck,
    x: ((x % MW) + MW) % MW, y: clamp(y, 4, MH - 4), alt: fromDeck ? 1.5 : alt, talt: alt, hd: fromDeck ? Math.atan2(g.uy, g.ux) : Math.atan2(cy - y, wrapDx(cx - x)), bank: 0,
    st: 'fly', leg: 'air', phase: 'orbit', pt: 0, spd: beh === 'heli' ? 7 : u.spr === 'airship' ? 5 : 6 + u.sp * 0.6, range: Math.max(8, u.range), hp: clamp(Math.round(u.hp * 0.6), 1, 2),
    cx, cy, ux: g.ux, uy: g.uy, off: (rand2() - 0.5) * 30, orb: rand2() * TAU, cd: rand2() * 0.4, atk: 1 + rand2() * 3, enemy: null, nb: 0,
    name: personName(), age: 20 + ((rand2() * 16) | 0), dir: 1, ph: rand2() * 10, doing: beh === 'fighter' ? '争夺制空权' : beh === 'heli' ? '低空悬停支援' : '出击', skin: SKINS[(n.id * 7) % SKINS.length], hair: HAIRS[0] };
  AG.push(a);
  return a;
}

/* ---------- targeting ---------- */
const ARMOR_SPR = { tracked: 1, mech: 1, hover: 1 };
function canHit(a, e) {
  if (e.st === 'dead' || e.side === a.side || e === a) return false;
  if (a.war ? e.war !== a.war : e.n === a.n) return false;
  const ua = UNIT_BY_ID[a.unit], ue = UNIT_BY_ID[e.unit];
  if (!ua || !ue) return true;
  const ad = a.dom, ed = e.dom;
  if (ed === 'air') { if (e.carrier && e.alt < 3) return false; if (ad === 'air') return a.beh === 'fighter'; return !!(ua.vis.antiAir || ua.vis.intercept || (ad === 'sea' && ua.vis.vls)); }
  if (ua.vis.antiAir) return false;
  if (ad === 'air') { if (a.beh === 'fighter') return false; if (a.beh === 'torp') return ed === 'sea'; return true; }
  if (ad !== ed) return false;
  if (ue.spr === 'sub' && !(e.surf > 0)) return !!(ua.vis.depth || ua.spr === 'sub');
  if (ua.spr === 'carrier') return false;
  return true;
}
function findTarget(a, R) {
  const ua = UNIT_BY_ID[a.unit], pref = ua && ua.vis.prefer === 'arm';
  let best = null, bd = R;
  for (const e of ARMY) {
    if (!canHit(a, e)) continue;
    let d = Math.hypot(wrapDx(e.x - a.x), e.y - a.y);
    if (d > R + 12) continue;
    if (e.kind === 'flag') d += 4;
    if (pref) { const ue = UNIT_BY_ID[e.unit]; if (ue && ARMOR_SPR[ue.spr]) d -= 12; }
    if (a.beh === 'bomber' || a.beh === 'strike') d += Math.abs(Math.hypot(wrapDx(e.x - a.cx), e.y - a.cy) - 14) * 0.3;
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}
const visY = e => e.y - (e.alt || 0) * AIRK - (e.dom === 'sea' ? 1.2 : e.dom === 'air' ? 0 : 1.6);

/* ---------- weapons ---------- */
function shoot(a, e, kind, dur, arc, k, o) {
  o = o || {};
  if (PROJ.length >= projCap()) { if (!o.delay) hitRoll(a, e, k); return; }
  const sp = o.spread || 0, ex = e.x + (rand2() - 0.5) * sp, ey = (o.ground ? e.y : visY(e)) + (rand2() - 0.5) * sp * 0.6;
  PROJ.push({ x0: o.x0 !== undefined ? o.x0 : a.x + a.dir * 1.6, y0: o.y0 !== undefined ? o.y0 : a.y - (a.dom === 'sea' ? 2 : 2.6), x1: ex, y1: ey, t: -(o.delay || 0), dur, kind, arc, a, e, k, sea: e.dom === 'sea', home: !!o.home, big: !!o.big, sm: 0 });
}
function tracer(a, e, col, w, t) {
  TRACERS.push({ x0: a.x + a.dir * 1.4, y0: a.y - (a.dom === 'air' ? a.alt * AIRK : a.dom === 'sea' ? 2 : 2.6), x1: e.x + (rand2() - 0.5) * 0.8, y1: visY(e), t: t || 0.09, t0: t || 0.09, col, w: w || 0.18 });
}
function puff(x, y, col, n, sz) { for (let k = 0; k < pN(n); k++) particle(x + (rand2() - 0.5) * 1.2, y + (rand2() - 0.5) * 0.6, (rand2() - 0.5) * 1.2, -0.6 - rand2() * 0.6, 1 + rand2() * 0.8, col, sz || 1.2, 2.5, 0.55); }
function boom(x, y, big) {
  const n = pN(big ? 14 : 8);
  for (let j = 0; j < n; j++) { const an = rand2() * TAU, sp = 2 + rand2() * (big ? 9 : 6); particle(x, y, Math.cos(an) * sp, Math.sin(an) * sp - 2, 0.5 + rand2() * 0.4, rand2() < 0.5 ? '#ffb347' : '#ff6a2a', 0.8, 0.5); }
  particle(x, y - 1, 0, -1.5, 1.6, '#5a5450', big ? 2.4 : 2, 4, 0.5);
}
function splash(x, y, big) {
  const n = pN(big ? 12 : 7), h = big ? 9 : 5.5;
  for (let j = 0; j < n; j++) particle(x + (rand2() - 0.5) * (big ? 2.4 : 1.4), y, (rand2() - 0.5) * 1.6, -h * (0.6 + rand2() * 0.6), 0.8 + rand2() * 0.4, rand2() < 0.7 ? '#f4fbff' : '#bfe0f0', big ? 1.1 : 0.8, 0.6, 0.85);
  particle(x, y, 0, 0, 1.2, '#e8f6ff', big ? 3 : 2, 3, 0.4);
}
// one shot (or salvo) of agent a at enemy e, chosen by sprite family and vis parameters
function fireMil(a, e) {
  const u = UNIT_BY_ID[a.unit]; if (!u) return;
  const v = u.vis, spr = u.spr, air = e.dom === 'air';
  a.flash = 0.12;
  if (air) {
    if (v.beam) { tracer(a, e, v.beam, 0.5, 0.18); hitRoll(a, e, 0.9); return; }
    if (spr === 'gun' || (spr === 'foot')) { shoot(a, e, 'flak', 0.55 + rand2() * 0.2, 0, 0.55, { spread: 3, x0: a.x + a.dir * 1.6, y0: a.y - 6 }); return; }
    shoot(a, e, 'sam', 0.9 + rand2() * 0.3, 4, 0.9, { home: 1, y0: a.y - 3.5 }); return;
  }
  switch (spr) {
    case 'foot': {
      if (v.proj === 'arrow' || v.proj === 'bolt') { shoot(a, e, 'arrow', 0.7, v.proj === 'bolt' ? 3 : 9, 1); return; }
      if (!a.ranged) { spark(e.x, e.y - 2); hitRoll(a, e, 1); return; }
      const col = v.wpn === 'heavy' ? '#8ff8ff' : v.tracer ? '#ffe36a' : '#fff3b0';
      tracer(a, e, col, v.wpn === 'heavy' ? 0.35 : 0.18);
      if (v.smoke) puff(a.x + a.dir * 2.4, a.y - 4.5 * 0.62, '#f2f2ee', 2, 1.4);
      hitRoll(a, e, UNIT_BY_ID[e.unit] && ARMOR_SPR[UNIT_BY_ID[e.unit].spr] ? 0.25 : 1);
      return;
    }
    case 'horse': spark(e.x, e.y - 2); hitRoll(a, e, 1.1); return;
    case 'gun':
      a.rec = 1;
      if (v.type === 'catapult') { shoot(a, e, 'stone', 1.4, v.arc || 14, 1.3, { spread: 2, ground: 1, big: 1 }); return; }
      shoot(a, e, v.proj === 'shell' ? 'shell' : 'ball', 1 + (v.arc || 12) * 0.02, v.arc || 12, 1.4, { spread: 2.5, ground: 1, big: 1 });
      puff(a.x + a.dir * 3, a.y - 2, '#e0e0dc', 3, 1.6);
      return;
    case 'tracked': case 'hover': case 'mech': {
      a.rec = 1;
      if (v.launcher === 'box') { for (let k = 0; k < (v.salvo || 6); k++) shoot(a, e, 'rocket', 1.1 + rand2() * 0.2, 10, 0.8, { spread: 5, ground: 1, big: 1, delay: k * 0.12, y0: a.y - 3.4 }); return; }
      if (v.beam || spr === 'mech' || spr === 'hover') { tracer(a, e, v.beam || v.glow || '#7ff6ff', v.turret === 'rails' ? 0.7 : 0.45, 0.16); if (v.turret === 'rails') boom(e.x, e.y - 1, true); hitRoll(a, e, 1.5); return; }
      if (v.hull === 'spg') { shoot(a, e, 'shell', 1.3, v.arc || 14, 1.4, { spread: 2.5, ground: 1, big: 1 }); puff(a.x + a.dir * 3, a.y - 3, '#e0e0dc', 2); return; }
      if (v.hull === 'ifv') { tracer(a, e, '#ffd27a', 0.28); hitRoll(a, e, 0.8); return; }
      shoot(a, e, 'tshell', 0.28, 2, 1.5, { spread: 1, y0: a.y - 2.6 }); puff(a.x + a.dir * 4.4, a.y - 2.8, '#d8d8d4', 1, 1.2);
      return;
    }
    case 'oared': spark(e.x, e.y - 1.5); spark(a.x + a.dir * 4, a.y - 1.5); hitRoll(a, e, 1); return;
    case 'sail': {
      const nb = (v.broadside || 3) + (v.decks ? 1 : 0), L = (v.len || 9) * 0.62;
      for (let k = 0; k < nb; k++) { const ox = a.x + (k / Math.max(1, nb - 1) - 0.5) * L; shoot(a, e, 'ball', 0.9 + rand2() * 0.2, 5, 0.8, { spread: 3.5, delay: k * 0.09, x0: ox, y0: a.y - 1 }); if (k % 2 === 0) puff(ox, a.y - 1.2, '#f0f0ec', 2, 1.6); }
      return;
    }
    case 'steam': {
      if (v.torp) { shootTorp(a, e); return; }
      if (v.depth && UNIT_BY_ID[e.unit] && UNIT_BY_ID[e.unit].spr === 'sub' && !(e.surf > 0)) { shoot(a, e, 'depth', 0.9, 3, 1.1, { spread: 2 }); return; }
      if (v.vls) { for (let k = 0; k < (v.salvo ? 2 : 1); k++) shoot(a, e, 'missile', 1.3, 16, 1.4, { delay: k * 0.3, y0: a.y - 2.5, home: 1 }); puff(a.x, a.y - 2.5, '#e8e8e8', 3, 1.4); return; }
      const sal = v.salvo || Math.min(2, v.turrets || 1);
      for (let k = 0; k < sal; k++) shoot(a, e, 'shell', 0.9 + rand2() * 0.25, 6, 1.1, { spread: v.bigSplash ? 4 : 3, delay: k * 0.07, big: !!v.bigSplash });
      puff(a.x + a.dir * 3, a.y - 2.4, '#d8d8d4', 2, v.bigSplash ? 2 : 1.4);
      return;
    }
    case 'sub': a.surf = 2.4; shootTorp(a, e); return;
  }
}
function shootTorp(a, e) {
  const d = Math.hypot(wrapDx(e.x - a.x), e.y - a.y);
  shoot(a, e, 'torp', clamp(d / 15, 0.7, 2.6), 0, 1.6, { y0: a.y - 0.2, x0: a.x + a.dir * 2 });
  const p = PROJ[PROJ.length - 1]; if (p && p.kind === 'torp') p.y1 = e.y - 0.2;
}
function hitRoll(a, e, k) {
  if (!e || e.st === 'dead') return false;
  if (rand2() < hitChance(a, e) * (k || 1)) { e.hp--; if (e.hp <= 0) { downed(a, e); return true; } }
  return false;
}
function downed(a, e) {
  killAgent(e);
  const u = UNIT_BY_ID[e.unit];
  if (u) {
    if (e.dom === 'sea') { e.t = 3.6; e.doing = '沉没'; boom(e.x, e.y - 1.5, true); }
    else if (e.dom === 'air') { e.t = 9; e.doing = '被击落'; }
    else if (u.spr !== 'foot' && u.spr !== 'horse') { e.t = 4; e.doing = '被击毁'; e.burn = 1; boom(e.x, e.y - 1.5, true); }
  }
  const w = S.wars.find(x => x.id === a.war);
  if (w) { if (w.vis) w.vis[a.side]++; const key = e.dom === 'sea' ? 'sunk' : e.dom === 'air' ? 'downed' : 'dead'; (w[key] || (w[key] = [0, 0]))[e.side]++; }
  if (!u || u.spr === 'foot' || u.spr === 'horse') for (let k2 = 0; k2 < pN(4); k2++) particle(e.x, e.y - 1.5, (rand2() - 0.5) * 4, -rand2() * 3, 0.6, '#8a1c1c', 0.5, 0);
}
function projPos(p, f) {
  const x = p.x0 + wrapDx(p.x1 - p.x0) * f;
  let y = p.y0 + (p.y1 - p.y0) * f - Math.sin(f * PI) * p.arc;
  if (p.kind === 'missile') y = p.y0 + (p.y1 - p.y0) * f - (f < 0.3 ? f / 0.3 : 1 - (f - 0.3) / 0.7) * p.arc;
  if (p.kind === 'bomb' || p.kind === 'depth') y = p.y0 + (p.y1 - p.y0) * f * f;
  return [x, y];
}
function updateProjectiles(dt) {
  for (let k = PROJ.length - 1; k >= 0; k--) {
    const p = PROJ[k]; p.t += dt;
    if (p.t < 0) continue;
    if (p.home && p.e && p.e.st !== 'dead') { p.x1 = p.e.x; p.y1 = visY(p.e); }
    const f = Math.min(1, p.t / p.dur);
    // trails (smoke for rockets & missiles, white wake for torpedoes)
    p.sm -= dt;
    if (p.sm <= 0 && (p.kind === 'rocket' || p.kind === 'sam' || p.kind === 'missile' || p.kind === 'atgm' || p.kind === 'torp')) {
      p.sm = p.kind === 'torp' ? 0.07 : 0.05; p.sm *= 1.5 / Math.max(0.4, GFX.parts);
      const [x, y] = projPos(p, f);
      if (p.kind === 'torp') particle(x, y, 0, 0, 1.6, '#f2faff', 0.7, 0.8, 0.8);
      else particle(x, y, (rand2() - 0.5) * 0.4, -0.3, p.kind === 'sam' ? 1.2 : 0.8, p.kind === 'missile' ? '#e8e8e8' : '#d8d8d4', 0.7, 1.6, 0.6);
    }
    if (p.t < p.dur) continue;
    PROJ.splice(k, 1);
    impact(p);
  }
}
function impact(p) {
  const e = p.e, a = p.a, x = p.x1, y = p.y1;
  if (p.kind === 'arrow') { hitRoll(a, e, p.k); return; }
  if (p.kind === 'flak') { for (let j = 0; j < pN(3); j++) particle(x + (rand2() - 0.5) * 2, y + (rand2() - 0.5) * 1.5, 0, 0, 1.2 + rand2() * 0.6, '#2a2826', 1.2, 2.2, 0.75); particle(x, y, 0, 0, 0.12, '#ffd27a', 1.4, 0); hitRoll(a, e, p.k); return; }
  if (e && e.dom === 'air') { boom(x, y, false); hitRoll(a, e, p.k); return; }
  const hit = hitRoll(a, e, p.k);
  if (p.sea) {
    if (hit || (e && e.st === 'dead')) boom(x, y - 1, true);
    else { const near = e && Math.hypot(wrapDx(e.x - x), e.y - y) < 1.5; splash(near ? x + (rand2() < 0.5 ? -2 : 2) : x, y + 1, p.big || p.kind === 'torp' || p.kind === 'depth'); if (p.kind === 'torp' && hit) boom(x, y, true); }
    return;
  }
  boom(x, y, p.big);
  if (p.big && p.kind !== 'tshell') for (const o of ARMY) if (o !== e && o.dom === 'land' && o.st !== 'dead' && o.side !== a.side && o.war === a.war && Math.hypot(wrapDx(o.x - x), o.y - y) < 3.2) hitRoll(a, o, 0.5);
}

/* ---------- behaviour ---------- */
function armyStep(a, dt) {
  const w = a.war ? S.wars.find(x => x.id === a.war) : null;
  if (a.rec > 0) a.rec = Math.max(0, a.rec - dt * 3);
  if (a.surf > 0) a.surf -= dt;
  if (a.dom === 'air') { airStep(a, dt, w); return; }
  if (!w && !a.order && a.leg !== 'retreat' && a.leg !== 'enter') {
    const c = cityById(a.c);
    if (c && a.dom !== 'sea') { const [hx, hy] = cityMpx(c); walkTo(a, hx, hy, 'retreat', '战争结束，返回家乡'); a.enemy = null; }
    else { a.st = 'dead'; a.t = 0.01; a.vanish = true; return; }
  }
  if (a.leg === 'retreat' || a.leg === 'enter') { if (moveAgent(a, dt)) onArrive(a); return; }
  const u = UNIT_BY_ID[a.unit], v = u ? u.vis : {}, sea = a.dom === 'sea';
  a.cd -= dt;
  if (a.cd <= 0) { a.cd = 0.25 + rand2() * 0.1; a.enemy = findTarget(a, v.antiAir ? a.range + 4 : a.ranged ? a.range + 3 : sea ? 30 : 13); }
  const e = a.enemy && a.enemy.st !== 'dead' ? a.enemy : null;
  const ed = e ? Math.hypot(wrapDx(e.x - a.x), e.y - a.y) : 1e9;
  // carriers launch aircraft from the rear
  if (u && u.spr === 'carrier' && a.st !== 'walk' && w) {
    a.launch -= dt;
    if (a.launch <= 0) {
      a.launch = 6 + rand2() * 5;
      const n = S.nations[a.n]; let mine = 0; for (const o of ARMY) if (o.dom === 'air' && o.side === a.side && o.war === a.war) mine++;
      if (n && mine < SIDE_CAP.air * (GFX.level === 0 ? 0.5 : 1)) {
        const L = milUnitsFor(n, 'air').filter(o => o.role === 'fi' || o.role === 'nb' || o.role === 'uav');
        const pick = v.planes === 'drone' ? (UNIT_BY_ID.drone_swarm && n.techs.swarm !== undefined ? 'drone_swarm' : 'drone') : L.length ? L[(rand2() * L.length) | 0].unit : null;
        if (pick && UNIT_BY_ID[pick]) { const src = cityById(a.c) || cityById(a.dest); if (src) { spawnAir(n, src, UNIT_BY_ID[pick], a.war, a.side, { px: a.rally ? a.rally[0] + (a.side ? -1 : 1) * 0 : a.x, py: a.y, ox: a.x + a.dir * 3, oy: a.y, host: 'sea' }); const pl = AG[AG.length - 1]; if (pl && pl.dom === 'air') { const b = BATTLES.find(b2 => b2.w === w && b2.dom === 'sea'); if (b) { pl.cx = b.x; pl.cy = b.y; } } } }
      }
    }
  }
  if (e && a.kind !== 'flag' && (a.ranged ? ed <= a.range : ed <= (sea ? 3.2 : 1.9)) && !(u && u.spr === 'carrier')) {
    a.dir = wrapDx(e.x - a.x) >= 0 ? 1 : -1;
    if (a.st !== 'fight') a.doing = `与${S.nations[e.n].name}的${KIND_LABEL[e.kind] || '士兵'}交战`;
    a.st = 'fight';
    a.atk -= dt;
    if (a.atk <= 0) { a.atk = reload(u, v, a) * (0.85 + rand2() * 0.4); fireMil(a, e); }
    if (sea) seaDrift(a, dt, v);
    return;
  }
  if (a.leg === 'rally') {
    if (a.st === 'walk' || a.st === 'fight') { a.st = 'walk'; if (moveAgent(a, dt)) { a.st = 'hold'; a.t = 1.5 + rand2() * 2; a.doing = a.kind === 'flag' ? '高举军旗' : sea ? '在战位游弋' : '列阵待命'; } return; }
    a.t -= dt;
    const stay = a.kind === 'flag' || sea || !u || u.roles[0] === 'art' || u.roles[0] === 'aa' || u.roles[0] === 'siege';
    if (sea) { seaDrift(a, dt, v); if (!a.ranged && e && ed < 34) { const tx = a.tx, ty = a.ty; a.tx = e.x; a.ty = e.y; const ox = a.x, oy = a.y; moveAgent(a, dt); if (!openWater(a.x, a.y)) { a.x = ox; a.y = oy; } a.tx = tx; a.ty = ty; a.doing = '划桨冲撞敌舰'; } return; }
    if (a.t <= 0 && !stay) { const d = cityById(a.dest); a.leg = 'march'; a.st = 'walk'; if (d) { const [dx2, dy2] = cityMpx(d); a.tx = dx2 + (rand2() - 0.5) * 8; a.ty = dy2 + (rand2() - 0.5) * 6; } a.doing = '冲锋！'; }
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
function reload(u, v, a) {
  if (!u) return 1;
  switch (u.spr) {
    case 'foot': return v.proj ? 1.4 : a.ranged ? (v.wpn === 'musket' ? 2.2 : v.wpn === 'smg' ? 0.5 : 0.9) : 0.6;
    case 'horse': return 0.6;
    case 'gun': return v.type === 'aa' ? 0.7 : v.type === 'catapult' ? 3.6 : 2.6;
    case 'tracked': return v.launcher === 'box' ? 7 : v.launcher ? 3 : v.beam ? 1.3 : v.hull === 'ifv' ? 0.5 : v.hull === 'spg' ? 2.8 : 2;
    case 'mech': case 'hover': return 0.9;
    case 'oared': return 0.8;
    case 'sail': return 3.6;
    case 'steam': return v.torp ? 4 : v.vls ? 3.4 : v.bigSplash ? 4 : 2.4;
    case 'sub': return 5;
  }
  return 1.5;
}
// ships do not stand still: slow drifting around their station, destroyers zig-zag and lay smoke
function seaDrift(a, dt, v) {
  if (!a.rally) return;
  a.pt = (a.pt || 0) - dt;
  if (a.pt <= 0 || !a.dx) { a.pt = v.zigzag ? 1.6 + rand2() : 4 + rand2() * 4; const amp = v.zigzag ? 7 : 3.5; a.dx = a.rally[0] + (rand2() - 0.5) * amp * 2; a.dy = a.rally[1] + (rand2() - 0.5) * amp; if (!openWater(a.dx, a.dy)) { a.dx = a.rally[0]; a.dy = a.rally[1]; } }
  const dx = wrapDx(a.dx - a.x), dy = a.dy - a.y, d = Math.hypot(dx, dy);
  if (d > 0.3) { const s = Math.min(d, a.sp * (v.zigzag ? 0.7 : 0.3) * dt); a.x = (((a.x + dx / d * s) % MW) + MW) % MW; a.y += dy / d * s; if (a.st !== 'fight' && Math.abs(dx) > 0.2) a.dir = dx > 0 ? 1 : -1; a.mv = 1; } else a.mv = 0;
  if (v.smokeScreen && a.st === 'fight' && rand2() < dt * 0.6) for (let k = 0; k < pN(3); k++) particle(a.x - a.dir * (2 + k), a.y - 1 - rand2(), -a.dir * 0.4, -0.2, 3 + rand2() * 2, '#c8ccd0', 2.2, 4, 0.5);
  if (v.smoke === 'black' && rand2() < dt * 2 * GFX.parts) particle(a.x - a.dir * 0.6, a.y - 4.2, -a.dir * 0.5, -1, 1.6, '#2a2826', 0.9, 2, 0.5);
}
function angDiff(a, b) { let d = a - b; return Math.atan2(Math.sin(d), Math.cos(d)); }
function steer(a, gx, gy, tr, dt) {
  const des = Math.atan2(gy - a.y, wrapDx(gx - a.x)), d = angDiff(des, a.hd), t = clamp(d, -tr * dt, tr * dt);
  a.hd += t; a.bank = a.bank * 0.85 + (dt > 0 ? t / dt / tr : 0) * 0.06;
  return Math.abs(d);
}
function airStep(a, dt, w) {
  const u = UNIT_BY_ID[a.unit]; if (!u) { a.st = 'dead'; a.t = 0.01; a.vanish = true; return; }
  const v = u.vis, side = a.side ? -1 : 1;
  let spd = a.spd, gx, gy, tr = a.beh === 'fighter' ? 2.4 : a.beh === 'bomber' ? 0.9 : 1.6;
  if (!w) {   // war over: fly home and vanish
    gx = a.x - a.ux * 300; gy = a.y - a.uy * 300; a.doing = '返航';
    if (Math.hypot(wrapDx(a.x - a.cx), a.y - a.cy) > 160) { a.st = 'dead'; a.t = 0.01; a.vanish = true; return; }
  } else {
    a.cd -= dt; a.atk -= dt;
    if (a.cd <= 0) { a.cd = 0.35 + rand2() * 0.2; if (a.beh !== 'awacs' && (a.phase === 'orbit' || a.beh === 'fighter' || a.beh === 'heli')) a.enemy = findTarget(a, a.beh === 'fighter' ? 70 : a.beh === 'heli' ? 26 : 90); }
    const e = a.enemy && a.enemy.st !== 'dead' && canHit(a, a.enemy) ? a.enemy : null;
    const ocx = a.cx - a.ux * 10, ocy = a.cy - a.uy * 10, th = a.orb + a.ph * (a.spd / (a.beh === 'bomber' ? 60 : 36));
    gx = ocx + Math.cos(th) * 36; gy = ocy + Math.sin(th) * 20;
    const ed = e ? Math.hypot(wrapDx(e.x - a.x), e.y - a.y) : 1e9;
    switch (a.beh) {
      case 'fighter':
        if (e) {
          gx = e.x + Math.cos(e.hd || 0) * 3; gy = e.y + Math.sin(e.hd || 0) * 3; a.talt = e.alt || a.talt;
          const ang = Math.abs(angDiff(Math.atan2(e.y - a.y, wrapDx(e.x - a.x)), a.hd));
          if (ed < a.range + 6 && ang < 0.55 && a.atk <= 0) {
            a.atk = 0.45 + rand2() * 0.35; a.flash = 0.1;
            if (v.msl && ed > 8 && rand2() < 0.4) shoot(a, e, 'aam', 0.6, 0, 1.3, { home: 1, x0: a.x, y0: a.y - a.alt * AIRK });
            else { tracer(a, e, v.plasma || v.tracer || (v.jet ? '#ffe9a0' : '#ffd84a'), v.plasma ? 0.45 : 0.22, 0.1); hitRoll(a, e, 0.55); }
          }
          a.doing = `与${S.nations[e.n].name}的${KIND_LABEL[e.kind] || '敌机'}缠斗`;
        } else a.doing = '巡逻争夺制空权';
        break;
      case 'heli': {
        const hx = a.cx - a.ux * 12 + -a.uy * a.off * 0.5, hy = a.cy - a.uy * 12 + a.ux * a.off * 0.5, hd = Math.hypot(wrapDx(hx - a.x), hy - a.y);
        gx = hx; gy = hy; if (hd < 6) { spd = a.spd * (hd / 6) * 0.6; tr = 1.2; if (e) { gx = e.x; gy = e.y; } }
        a.talt = 6 + Math.sin(a.ph * 1.3) * 0.6;
        if (e && ed < Math.max(16, a.range + 4) && a.atk <= 0) { a.atk = 2.6 + rand2(); a.flash = 0.1; shoot(a, e, 'atgm', 0.8, 1, 1.5, { home: 1, x0: a.x, y0: a.y - a.alt * AIRK }); }
        a.doing = e ? '向坦克发射反坦克导弹' : '低空悬停支援';
        break;
      }
      case 'strike': case 'torp': case 'bomber': {
        if (a.phase === 'orbit') { if (e && a.atk <= 0) { a.phase = 'run'; a.tgt = e; } a.talt = a.beh === 'torp' ? 9 : v.alt || (a.beh === 'bomber' ? 19 + (v.size || 1) * 1.5 : 13); a.doing = '在战区上空盘旋'; break; }
        const t = a.tgt && a.tgt.st !== 'dead' ? a.tgt : null;
        if (a.phase === 'run') {
          if (!t) { a.phase = 'orbit'; break; }
          const td = Math.hypot(wrapDx(t.x - a.x), t.y - a.y);
          gx = t.x; gy = t.y; tr = a.beh === 'bomber' ? 1.1 : 2;
          if (a.beh === 'torp') { a.talt = 3.5; a.doing = '贴着浪尖进入鱼雷攻击航线'; if (td < 16 && Math.abs(angDiff(Math.atan2(t.y - a.y, wrapDx(t.x - a.x)), a.hd)) < 0.5) { shoot(a, t, 'torp', clamp(td / 15, 0.7, 2), 0, 1.6, { x0: a.x, y0: a.y - 0.2 }); const p = PROJ[PROJ.length - 1]; if (p && p.kind === 'torp') p.y1 = t.y - 0.2; a.phase = 'exit'; a.pt = 2.2; a.atk = 6 + rand2() * 3; } }
          else if (a.beh === 'bomber') { a.doing = '进入轰炸航线'; if (td < 5) { a.phase = 'drop'; a.nb = v.bombs || (u.spr === 'airship' ? 3 : 4); a.pt = 0; } }
          else if (v.swarm) { a.talt = Math.max(2, td * 0.3); a.doing = '蜂群俯冲攻击'; if (td < 3) { for (let k = 0; k < pN(5); k++) boom(t.x + (rand2() - 0.5) * 5, t.y - 1 + (rand2() - 0.5) * 3, false); hitRoll(a, t, 1.6); a.phase = 'exit'; a.pt = 2; a.atk = 5 + rand2() * 3; } }
          else if (v.dive) { a.talt = td < 22 ? Math.max(2.5, td * 0.5) : 20; spd = a.spd * (td < 22 ? 1.35 : 1); a.doing = '俯冲轰炸！'; if (td < 4) { shoot(a, t, 'bomb', 0.35, 0, 1.8, { x0: a.x, y0: a.y - a.alt * AIRK, ground: 1, big: 1 }); a.phase = 'exit'; a.pt = 2.4; a.atk = 6 + rand2() * 4; } }
          else { a.doing = '对地攻击'; if (td < 14) { shoot(a, t, 'missile', 0.6, 0, 1.5, { home: 1, x0: a.x, y0: a.y - a.alt * AIRK, big: 1 }); a.phase = 'exit'; a.pt = 2; a.atk = 4 + rand2() * 3; } }
        } else if (a.phase === 'drop') {
          gx = a.x + Math.cos(a.hd) * 20; gy = a.y + Math.sin(a.hd) * 20; tr = 0;
          a.pt -= dt;
          if (a.pt <= 0 && a.nb > 0) {
            a.pt = 0.14; a.nb--;
            const bx = a.x + Math.cos(a.hd) * 2.5, by = a.y + Math.sin(a.hd) * 2.5;
            const tgt = { x: bx, y: by, st: 'x', dom: 'land', alt: 0 };
            if (PROJ.length < projCap()) PROJ.push({ x0: a.x, y0: a.y - a.alt * AIRK, x1: bx, y1: by, t: 0, dur: 0.75, kind: 'bomb', arc: 0, a, e: t && Math.hypot(wrapDx(t.x - bx), t.y - by) < 3.5 ? t : null, k: 1.4, sea: t ? t.dom === 'sea' : false, big: true, sm: 0 });
          }
          if (a.nb <= 0) { a.phase = 'exit'; a.pt = 2.8; a.atk = 7 + rand2() * 4; }
          a.doing = '投弹！';
        } else {   // exit: climb away on the current heading, then rejoin the orbit
          gx = a.x + Math.cos(a.hd) * 20; gy = a.y + Math.sin(a.hd) * 20; tr = 0.4;
          a.talt = a.beh === 'torp' ? 10 : v.alt || (a.beh === 'bomber' ? 20 : 14); a.pt -= dt; if (a.pt <= 0) a.phase = 'orbit'; a.doing = '拉起脱离';
        }
        break;
      }
    }
  }
  steer(a, gx, gy, tr, dt);
  a.x = (((a.x + Math.cos(a.hd) * spd * dt) % MW) + MW) % MW; a.y = clamp(a.y + Math.sin(a.hd) * spd * dt, 2, MH - 2);
  a.alt += (a.talt - a.alt) * Math.min(1, dt * (a.carrier && a.alt < 4 ? 0.8 : 1.6));
  a.dir = Math.cos(a.hd) >= 0 ? 1 : -1;
  if (v.trail && a.alt > 10 && rand2() < dt * 8 * GFX.parts / 1.5) particle(a.x - Math.cos(a.hd) * 2, a.y - a.alt * AIRK - Math.sin(a.hd) * 2, 0, 0, 1.4, '#f4f6f8', 0.5, 0.8, 0.5);
}
// what dead units keep doing: aircraft spiral down trailing smoke, wrecks burn, ships sink
function deadStep(a, dt) {
  if (a.dom === 'air') {
    if (a.alt > 0) {
      a.alt -= dt * (5 + (9 - a.t) * 3); a.hd += dt * 2.6;
      a.x = (((a.x + Math.cos(a.hd) * a.spd * 0.45 * dt) % MW) + MW) % MW; a.y = clamp(a.y + Math.sin(a.hd) * a.spd * 0.45 * dt, 2, MH - 2);
      if (rand2() < dt * 14 * GFX.parts / 1.5) particle(a.x, a.y - a.alt * AIRK, 0, -0.4, 1.4, rand2() < 0.25 ? '#ff8a2a' : '#2a2624', 0.9, 2.2, 0.7);
      if (a.alt <= 0) { const sea = !landAt(a.x, a.y); if (sea) splash(a.x, a.y, false); else boom(a.x, a.y, false); a.t = 0; }
    }
    return;
  }
  if (a.burn && rand2() < dt * 5 * GFX.parts / 1.5) particle(a.x + (rand2() - 0.5), a.y - 2.6, 0.2 + (rand2() - 0.5) * 0.4, -1.6, 1.8, '#1e1c1a', 1, 2.6, 0.55);
  if (a.dom === 'sea') { if (rand2() < dt * 4 * GFX.parts / 1.5) particle(a.x + (rand2() - 0.5) * 2, a.y - 2, 0.3, -1.4, 1.8, '#26221e', 1.2, 3, 0.55); if (a.t < 1.6 && !a.oil) { a.oil = 1; particle(a.x, a.y, 0, 0, 6, '#0e0d0c', 3, 4, 0.45); } }
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


/* ---------- civilians: era clothing, 4-frame walk, work animations ---------- */
const TROUSERS = ['#6a5038', '#5a4a3a', '#4a4038', '#3e3a36', '#2e2c30', '#3a4a6a', '#3a4a6a', '#5a6470', '#d8dce4'];
function drawCivilian(a, z, n, sx, sy) {
  const era = n.mult ? Math.min(8, n.mult.era) : 0, d = a.dir || 1, moving = a.st === 'walk';
  const kid = a.role === 'child', k = z * (kid ? 0.45 : 0.62);
  MDIR = d; SPX = sx; SPY = sy; SPZ = k;
  const skin = a.skin || SKINS[0], hair = a.hair || HAIRS[0];
  let shirt = a.role === 'soldier' ? n.color : (ROLE_SHIRT[a.role] || '#a0a0a0');
  if (GFX.shadows) { ctx.globalAlpha = 0.22; q(-1.4, -0.35, 2.8, 0.6, '#000'); ctx.globalAlpha = 1; }
  const t4 = moving ? Math.floor(a.ph * 8 + a.id) & 3 : 0, sw = t4 === 0 ? 0.45 : t4 === 2 ? -0.45 : 0, bob = moving && (t4 & 1) ? -0.15 : 0;
  const work = a.st === 'work', p3 = work ? Math.floor(a.ph * (a.role === 'worker' ? 5 : 3.2)) % 3 : 0;
  const jump = kid && work ? -Math.abs(Math.sin(a.ph * 6)) * 1.2 : 0;
  SPY = sy + (bob + jump) * k;
  // legs: bare / tunic in early eras, trousers later
  const legs = era <= 1 && a.role !== 'soldier' ? skin : TROUSERS[era];
  const bend = work && (a.role === 'farmer' || a.role === 'miner' || a.role === 'wood') && p3 === 2;
  q(-0.95 + sw, -2, 0.85, 2, legs); q(0.1 - sw, -2, 0.85, 2, legs);
  if (era >= 3) { q(-1 + sw, -0.4, 1, 0.4, '#24201c'); q(0.05 - sw, -0.4, 1, 0.4, '#24201c'); }
  const by = bend ? 0.5 : 0;
  if (era <= 1) { q(-1, -4.1 + by, 2, 2.7, shirt); q(-1, -2.6 + by, 2, 0.3, '#5a4028'); }     // knee-length tunic and belt
  else if (era <= 3) { q(-1, -4.1 + by, 2, 2.4, shirt); q(-1.05, -2.1 + by, 2.1, 0.35, shade(shirt[0] === '#' ? shirt : '#a0a0a0', 0.7)); }
  else if (era <= 5) { q(-1, -4.1 + by, 2, 2.2, shirt); q(-0.3, -4.1 + by, 0.6, 1.4, era === 4 ? '#e8e2d0' : '#d8d8d8'); }   // coat / shirt collar
  else { q(-1, -4.1 + by, 2, 2.1, shirt); q(-1, -4.1 + by, 2, 0.35, shade(shirt[0] === '#' ? shirt : '#a0a0a0', 1.2)); }
  const hx = bend ? 0.5 : 0;
  q(-0.9 + hx, -6 + by, 1.8, 1.9, skin);
  q(0.45 + hx, -5.4 + by, 0.3, 0.3, '#1a1410');                                  // eye
  // headgear by role and era
  const hy = -6.3 + by;
  if (a.role === 'farmer') { if (era <= 3) { q(-1.6 + hx, hy, 3.2, 0.5, '#e2c46a'); q(-0.7 + hx, hy - 0.6, 1.4, 0.6, '#d6b45a'); } else { q(-1.2 + hx, hy, 2.4, 0.6, '#d6b45a'); q(0.6 + hx, hy + 0.2, 1, 0.3, '#c0a050'); } }
  else if (a.role === 'miner') { q(-1.1 + hx, hy - 0.2, 2.2, 0.8, era >= 4 ? '#e8c040' : '#6a5a4a'); if (era >= 4) q(0.6 + hx, hy, 0.5, 0.5, '#fff6c0'); }
  else if (a.role === 'builder') { q(-1.1 + hx, hy - 0.2, 2.2, 0.8, era >= 5 ? '#f0a020' : '#c8a060'); if (era >= 5) q(-1.4 + hx, hy + 0.4, 2.8, 0.25, '#f0a020'); }
  else if (a.role === 'worker' && era >= 4) { q(-1 + hx, hy - 0.1, 2, 0.6, '#3a4458'); q(0.6 + hx, hy + 0.3, 0.9, 0.25, '#2a3040'); }
  else if (a.role === 'trader' && era <= 3) { q(-1.1 + hx, hy - 0.4, 2.2, 1, '#e8d8b0'); q(-0.4 + hx, hy - 0.6, 0.8, 0.4, '#c84a3a'); }
  else if ((a.role === 'scholar' || a.role === 'trader') && era === 4) { q(-0.8 + hx, hy - 1.2, 1.6, 1.3, '#1e1e22'); q(-1.3 + hx, hy + 0.05, 2.6, 0.3, '#1e1e22'); }
  else if (a.role === 'soldier') { const wp = n.mult.weapon; if (wp >= 5) { q(-1.3, hy + 0.2, 2.6, 0.4, '#454a36'); q(-0.95, hy - 0.4, 1.9, 0.7, '#4e5440'); } else if (wp >= 2) q(-1, hy - 0.1, 2, 0.9, '#8a9098'); else q(-1, hy, 2, 0.6, hair); }
  else q(-1 + hx, hy, 2, 0.6, hair);
  if (a.carry && moving) {
    if (a.role === 'wood') { q(-2.4, -5.2, 0.9, 3.2, '#7a5230'); q(-2.2, -5.4, 0.5, 0.4, '#a07a48'); }
    else if (a.role === 'farmer') { q(-2.4, -5.6, 1.8, 1.6, '#c8a048'); q(-2.2, -5.9, 1.4, 0.4, a.carry); }
    else q(-2.2, -5, 1.2, 1.6, a.carry);
  }
  // tools & work animation: three-frame swings
  const sw3 = [-6.6, -5.2, -3.4][p3];
  switch (a.role) {
    case 'farmer': if (work) { q(0.8, sw3 + by, 0.4, 2.8, '#7a5a30'); q(0.8, sw3 + by + (p3 === 2 ? 2.6 : -0.2), 1.3, 0.4, era >= 4 ? '#9aa0a8' : '#8a8070'); if (p3 === 2 && GFX.detail >= 2 && rand2() < 0.05) particle(a.x + d * 1.2, a.y, d * 0.6, -0.8, 0.5, '#8a6a40', 0.5, 0); } break;
    case 'wood': if (work) { q(0.8, sw3 + by, 0.4, 2.6, '#7a5a30'); q(1.1, sw3 + by - 0.2, 0.9, 0.9, '#9aa0a8'); if (p3 === 2 && GFX.detail >= 2 && rand2() < 0.06) particle(a.x + d * 2, a.y - 2, d, -1, 0.5, '#c8a060', 0.5, 0); } break;
    case 'miner': if (work) { q(0.8, sw3 + by, 0.4, 2.6, '#7a5a30'); q(0.2, sw3 + by - 0.2, 1.9, 0.4, '#8a9098'); if (p3 === 2 && GFX.detail >= 2 && rand2() < 0.08) spark(a.x + d * 1.5, a.y - 0.5); } break;
    case 'worker': case 'builder': if (work) { const hy2 = [-5.8, -5, -4.3][p3]; q(0.9, hy2, 0.4, 1.6, '#7a5a30'); q(0.7, hy2 - 0.3, 0.9, 0.5, '#7a7e86'); if (p3 === 2 && era >= 4 && GFX.detail >= 2 && rand2() < 0.06) spark(a.x + d * 1.2, a.y - 2.6); } else if (a.role === 'worker' && era >= 6) q(0.8, -4, 1, 0.8, '#3a4048'); break;
    case 'scholar': if (work) { q(0.5, -4.4, 1.4, 1, '#f4f0e0'); q(1.15, -4.4, 0.12, 1, '#8a7a5a'); if (Math.floor(a.ph * 0.7 + a.id) % 3 === 0) q(0.5, -4.6, 0.7, 0.3, '#e0dccc'); } else if (era >= 6) q(0.6, -4.2, 0.9, 1.2, '#2a3038'); break;
    case 'trader': if (era >= 5) q(0.6, -2.8, 1.2, 0.9, '#5a3a24'); else { q(-2, -4.8, 1, 2, '#8a5a30'); q(-2, -4.8, 1, 0.3, '#6a4020'); } break;
    case 'soldier': { const wp = n.mult.weapon; if (wp >= 4) q(0.6, -4.3, 2.2, 0.45, '#2a2420'); else q(0.9, -7.6, 0.4, 5, '#7a5a30'); break; }
    case 'child': if (work) q(1, -4 + jump * 0.3, 0.8, 0.8, '#e05a4a'); break;
  }
}
// civilian craft crossing water: a sail skiff, a steam launch or a motor boat, all with a wake
function drawBoat(a, z, n, sx, sy) {
  const era = n.mult ? n.mult.era : 0, d = a.dir || 1;
  MDIR = d; SPX = sx; SPY = sy; SPZ = z * 0.62;
  const moving = a.st === 'walk' || a.leg === 'trade' || a.role === 'army';
  if (GFX.water || GFX.level > 0) wakeFx(5.4, moving, a.ph);
  if (a.role === 'army') { q(-3, -1.6, 6, 1.6, era >= 5 ? '#5a6068' : '#6a4a2a'); q(2.6, -1.9, 0.5, 1.9, era >= 5 ? '#4a5058' : '#6a4a2a'); for (let k = 0; k < 3; k++) { q(-2.2 + k * 1.4, -3, 0.9, 1.4, milPal(n).camo); q(-2.2 + k * 1.4, -3.5, 0.9, 0.5, era >= 5 ? '#4e5440' : (a.hair || HAIRS[0])); } q(-2.8, -2, 1, 0.4, n.color); return; }
  const skin = a.skin || SKINS[0];
  if (era < 4) {
    q(-3, -1.5, 6, 1.5, '#7a5230'); q(-2.6, -2, 5.2, 0.5, '#9a6a40'); q(2.6, -2, 0.8, 0.6, '#7a5230');
    q(-0.2, -7, 0.4, 5, '#4a3424'); q(0.2, -6.6, 2.2, 3.6 - (moving ? 0 : 0.4), '#f2efe6'); q(0.2, -6.6, 2.2, 0.4, n.color);
    q(-1.9, -3.5, 1.3, 1.5, skin); q(-1.9, -3.9, 1.3, 0.5, a.hair || HAIRS[0]);
  } else if (era < 6) {
    q(-3.2, -1.6, 6.4, 1.6, '#3e3a38'); q(-3.2, -0.5, 6.4, 0.5, '#7a2a24'); q(-1.8, -3, 3, 1.4, '#e8e2d0'); q(-1.2, -4.8, 0.8, 1.8, '#2a2624'); q(-1.2, -4.4, 0.8, 0.3, n.color);
    if (moving && rand2() < 0.05 * GFX.parts) particle(a.x - d * 0.6, a.y - 3.4, -d * 0.6, -1, 1.4, '#3a3634', 0.8, 1.8, 0.5);
  } else {
    q(-3, -1.3, 6, 1.3, '#f2f4f6'); q(-3, -0.4, 6, 0.4, n.color); q(-0.8, -2.6, 2.2, 1.3, '#cfd8e0'); q(0.6, -2.4, 0.8, 0.8, '#5a8ab0');
    q(-1.9, -2.9, 1.1, 1.5, skin);
  }
}
function drawPerson(a, z) {
  const sx = sxOf(a.x), sy = syOf(a.y);
  if (sx < -60 || sx > view.w + 60 || sy < -60 || sy > view.h + 20) return;
  if (a.hide && a.st === 'rest') return;
  const n = S.nations[a.n]; if (!n) return;
  const dead = a.st === 'dead';
  if (a.unit) {
    if (dead) { if (a.vanish) return; if (drawMilDead(a, sx, sy, z, n)) return; ctx.globalAlpha = clamp(a.t / 2.5, 0, 1); SPX = sx; SPY = sy; SPZ = z * 0.62; MDIR = a.dir || 1; q(-2, -1.1, 3, 1.1, milPal(n).era >= 5 ? milPal(n).camo : n.color); q(1, -1.3, 1.4, 1.3, a.skin || SKINS[0]); ctx.globalAlpha = 1; return; }
    if (a.boat && a.dom === 'land') { drawBoat(a, z, n, sx, sy); return; }
    const u = UNIT_BY_ID[a.unit];
    if (GFX.shadows && u.dom === 'land') { const L = (u.vis.len || (u.spr === 'horse' ? 6 : u.spr === 'gun' ? 6 : 2.4)) * z * 0.62; ctx.globalAlpha = 0.2; ctx.fillStyle = '#000'; ctx.fillRect(sx - L * 0.55, sy - z * 0.25, L * 1.1, z * 0.5); ctx.globalAlpha = 1; }
    const st = a.st; if (u.dom === 'sea' && a.mv && st === 'hold') a.st = 'walk';
    const sub = u.spr === 'sub' && !(a.surf > 0);
    if (sub) ctx.globalAlpha = 0.55;
    drawMilUnit(a, sx, sy, z, n);
    a.st = st; ctx.globalAlpha = 1;
    return;
  }
  if (dead) {
    if (a.vanish) return;
    ctx.globalAlpha = clamp(a.t / 2.5, 0, 1); SPX = sx; SPY = sy; SPZ = z * 0.62; MDIR = a.dir || 1;
    q(-2, -1.2, 3, 1.2, a.role === 'army' || a.role === 'soldier' ? n.color : (ROLE_SHIRT[a.role] || '#a0a0a0')); q(1, -1.4, 1.4, 1.4, a.skin || SKINS[0]); ctx.globalAlpha = 1; return;
  }
  if (a.boat) { drawBoat(a, z, n, sx, sy); return; }
  if (a.kind === 'cart') {
    SPX = sx; SPY = sy; SPZ = z * 0.62; MDIR = a.dir || 1;
    if (GFX.shadows) { ctx.globalAlpha = 0.2; q(-3.4, -0.4, 9, 0.7, '#000'); ctx.globalAlpha = 1; }
    const st = Math.floor(a.ph * 7) & 1;
    q(-3, -3, 5, 2, '#8a6438'); q(-3.2, -4.6, 5.4, 1.6, '#efe6d0'); q(-3.2, -4.6, 5.4, 0.3, '#d8ccb0'); q(-2.6, -1.2, 1.3, 1.3, '#2a2018'); q(0.6, -1.2, 1.3, 1.3, '#2a2018');
    q(2, -2.4, 0.4, 0.4, '#5a4028'); q(2.4, -3.6, 3, 1.6, '#7a5a3a'); q(5, -4.2, 1, 1, '#7a5a3a'); q(2.6 + st * 0.4, -2, 0.5, 2, '#5a3a20'); q(4.6 - st * 0.4, -2, 0.5, 2, '#5a3a20');
    return;
  }
  drawCivilian(a, z, n, sx, sy);
}

function drawAgents(z) {
  const list = [], air = [];
  for (const a of AG) (a.dom === 'air' ? air : list).push(a);
  list.sort((a, b) => a.y - b.y);
  AIRL = air;
  if (air.length && GFX.level > 0) drawAircraft(air, z, true);
  for (const a of list) drawPerson(a, z);
  for (const t of TRACERS) {
    ctx.globalAlpha = clamp(t.t / (t.t0 || 0.09), 0, 1); ctx.strokeStyle = t.col; ctx.lineWidth = Math.max(1, z * t.w);
    const x0 = sxOf(t.x0), y0 = syOf(t.y0);
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + wrapDx(t.x1 - t.x0) * z, syOf(t.y1)); ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

let r2s = 77;
function rand2() { r2s = (r2s * 16807) % 2147483647; return r2s / 2147483647; }

const PROJ_COL = { ball: '#2a2624', stone: '#6a6056', shell: '#3a3632', tshell: '#ffe08a', bomb: '#2a2a28', depth: '#2a2e33', flak: '#3a3632' };
function drawProjectiles(z) {
  for (const p of PROJ) {
    if (p.t < 0) continue;
    const f = Math.min(1, p.t / p.dur), [x, y] = projPos(p, f), sx = sxOf(x), sy = syOf(y);
    if (sx < -40 || sx > view.w + 40 || sy < -40 || sy > view.h + 40) continue;
    const k = p.kind;
    if (k === 'arrow' || k === 'tshell' || k === 'torp') {
      const f2 = Math.max(0, f - (k === 'torp' ? 0.08 : 0.06)), [x2, y2] = projPos(p, f2);
      ctx.strokeStyle = k === 'arrow' ? '#d8c8a0' : k === 'torp' ? '#f4fbff' : '#ffe08a'; ctx.lineWidth = Math.max(1, z * (k === 'arrow' ? 0.15 : 0.22));
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sxOf(x2), syOf(y2)); ctx.stroke();
      continue;
    }
    if (k === 'rocket' || k === 'sam' || k === 'missile' || k === 'atgm' || k === 'aam') {
      ctx.fillStyle = '#e8e8e8'; ctx.fillRect(sx - z * 0.3, sy - z * 0.15, z * 0.6, z * 0.3);
      ctx.fillStyle = (animT * 20 | 0) & 1 ? '#ffd27a' : '#ff8a2a'; ctx.beginPath(); ctx.arc(sx, sy, Math.max(1.2, z * 0.25), 0, TAU); ctx.fill();
      continue;
    }
    if (k === 'bomb') { ctx.fillStyle = '#2a2a28'; ctx.fillRect(sx - z * 0.15, sy - z * 0.35, z * 0.3, z * 0.7); continue; }
    const r = Math.max(1.2, z * (k === 'stone' ? 0.5 : k === 'ball' ? 0.4 : 0.3));
    ctx.fillStyle = PROJ_COL[k] || '#2a2624'; ctx.beginPath(); ctx.arc(sx, sy, r, 0, TAU); ctx.fill();
  }
  if (AIRL.length) drawAircraft(AIRL, z, false);
}
function drawBattleLabels(z) {
  ctx.font = `12px ${CSSV.font}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const lead = (s, A, B) => s >= 0.5 ? `${A.name} ${Math.round(s * 100)}%` : `${B.name} ${Math.round((1 - s) * 100)}%`;
  for (const b of BATTLES) {
    const sx = sxOf(b.x), sy = syOf(b.y) - (b.dom === 'air' ? 48 + 9 * z : 22 + 6 * z);
    if (sx < -160 || sx > view.w + 160 || sy < -20 || sy > view.h + 20) continue;
    const w = b.w;
    let txt = `${b.a.name}  ⚔  ${b.b.name}${w.civil ? '（内战）' : ''}`;
    if (b.dom === 'land') { const d = w.dead || [0, 0]; txt += ` · 陆战${b.air ? ` · 制空 ${lead(w.air ?? 0.5, b.a, b.b)}` : ''} · 阵亡 ${d[0]} : ${d[1]}`; }
    else if (b.dom === 'sea') { const d = w.sunk || [0, 0]; txt += ` · 海战 · 制海 ${lead(w.sea ?? 0.5, b.a, b.b)} · 沉没 ${d[0]} : ${d[1]} 艘`; }
    else { const d = w.downed || [0, 0]; txt += ` · 空战 · 击落 ${d[0]} : ${d[1]} 架`; }
    const tw = ctx.measureText(txt).width + 22;
    ctx.fillStyle = 'rgba(6,10,20,.82)'; ctx.fillRect(sx - tw / 2, sy - 11, tw, 22);
    ctx.fillStyle = b.a.color; ctx.fillRect(sx - tw / 2, sy - 11, 4, 22);
    ctx.fillStyle = b.b.color; ctx.fillRect(sx + tw / 2 - 4, sy - 11, 4, 22);
    ctx.fillStyle = b.dom === 'sea' ? '#d8ecff' : b.dom === 'air' ? '#e8f0ff' : '#ffdfe2'; ctx.fillText(txt, sx, sy);
  }
  ctx.textAlign = 'left';
}
