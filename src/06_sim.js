/* =====================================================================
   Simulation (god-game edition): state, diplomacy, orders, terraforming
   ===================================================================== */
function newState(seed) {
  WORLD = genWorld(seed);
  S = {
    v: 4, doct: {}, aiFeed: [], rails: {}, milDoc: {}, milPref: {}, seed, year: START_YEAR, tick: 0, rng: (seed ^ 0x9e3779b9) | 0,
    co2: 280, tanom: 0, seaRise: 0, co2Peak: 280,
    cities: [], nations: [], wars: [], orders: [], log: [], history: [], firsts: {}, names: {}, flags: { maxEra: 0 },
    forest: WORLD.forest0.slice(), res: {}, owner: new Int16Array(N).fill(-1), cityOf: new Int16Array(N).fill(-1),
    farm: new Float32Array(N), smog: new Float32Array(N),
    nextCity: 1, nextOrder: 1, sats: 0, orbital: 0, orbPop: 0, ships: 0, moon: null, moonDue: 0, moonBy: -1, forestFrac: 1,
    resLeft: {}, deforest: 0, terrDirty: true, borders: [], lastShip: 0,
    terra: [], stats: { blessed: [], landMade: 0, lastWarYear: START_YEAR, maxWarNations: 0, impact: 0, conquer: 0, seeds: 0 },
    mode: 'god', player: null, trust: {}, gcd: {}, games: [], ideoWorld: {}, realmCount: 7,
    space: { col: {}, terra: {}, transit: [], factions: [], battles: [], firsts: {}, unlocked: false },
  };
  for (const r of RES) { S.res[r] = WORLD.res0[r].slice(); S.resLeft[r] = WORLD.resTotal[r]; }
  seedCivs();
}

function createNation(techsFrom, parent) {
  const id = S.nations.length;
  const col = NATION_COLORS[id % NATION_COLORS.length];
  const n = {
    id, name: nationName(techsFrom ? 2 : 0), color: col, rgb: hexRgb(col), techs: techsFrom ? Object.assign({}, techsFrom) : { agri: S.year },
    research: 0, target: null, alive: true, born: S.year, aggr: 0.4 + rand() * 1.2, stab: rand(),
    renew: 0, fusion: 0, nuke: 0, ccs: 0, golden: 0, capital: -1, crisis: -999, rr: 0, allies: [], legions: 0, rebel: false,
    st: { pop: 0, cities: 0, fac: 0, labs: 0, rp: 0, E: 0, emit: 0, cap: 0, sat: 1, ironSat: 1, rareSat: 1, newFac: 0, mix: [0, 0, 0, 0, 0] },
  };
  initIdeology(n, parent);
  n.mult = computeMult(n);
  if (!parent) {
    const av = ideoAvailable(n), e = n.mult.era;
    const best = av.sort((a, b) => b.fit[e] - a.fit[e])[0];
    if (best && best.id !== n.ideo) { n.ideo = best.id; n.sup = { [best.id]: 1 }; n.mult = computeMult(n); }
  }
  n.dep = { coal: [], oil: [], iron: [], uran: [], rare: [] };
  n.cl = [];
  ensureMil(n);
  S.nations.push(n);
  return n;
}

function createCity(i, nid, pop, isCap) {
  const y = (i / W) | 0, x = i - y * W;
  const c = {
    id: S.nextCity++, name: cityName(i), n: nid, x, y, i, pop, born: S.year, fac: 0, labs: 0, cap: !!isCap,
    K: pop * 1.5, fertSum: 0, fishSum: 0, cells: 0, mines: 0, rp: 0, goods: 0, coastal: isCoastal(i), drought: 0, smog: 0,
    lat: CELL_LAT[y] + (rand() - 0.5) * 0.02, lon: cellLon(x) + (rand() - 0.5) * 0.02, links: [],
  };
  S.cities.push(c);
  if (isCap) S.nations[nid].capital = c.id;
  S.terrDirty = true;
  return c;
}

/* ---------- log ---------- */
const TYPE_COLOR = { tech: '--sea', war: '--blood', disaster: '--ember', climate: '--leaf', space: '--violet', civ: '--sodium', god: '--sodium' };
const TYPE_NAME = { tech: '科技', war: '战争', disaster: '灾害', climate: '气候', space: '太空', civ: '文明' };
let logVersion = 0;
function log(type, text, cell, major = true) {
  S.log.unshift({ y: S.year, t: type, s: text, i: cell ?? -1 });
  if (S.log.length > 500) S.log.length = 500;
  logVersion++;
  if (!booting) {
    if (cell !== undefined && cell >= 0) addFx(cell, type);
    if (major) showTicker(type, text);
    busEmit('log', { type, text, cell: cell ?? -1, major });
  }
}

function tick() {
  S.tick++;
  S.year++; if (S.year === 0) S.year = 1;
  if (S.terrDirty || S.tick % 5 === 0) territory();
  for (const n of S.nations) n.cl.length = 0;
  for (const c of S.cities) S.nations[c.n].cl.push(c);
  for (const c of S.cities) cityTick(c, S.nations[c.n]);
  for (const n of S.nations) if (n.alive) nationTick(n);
  aiTick();
  if (S.tick % 20 === 7) doctrineTick();
  doctrineDecay();
  if (S.tick % 2 === 0) ideologyTick();
  warTick();
  if (S.tick % 3 === 0) gameTick();
  eventsTick();
  if (S.tick % 10 === 0) vassalTick();
  if (S.tick % 5 === 2) unrestTick();
  if (S.tick % 5 === 0) unificationCheck();
  climateTick();
  spaceTick();
  spaceColTick();
  playerTick();
  if (S.year % 5 === 0) sampleHistory();
  if (S.tick % 3 === 0 && !booting) checkAchievements();
}

function trySettle(c, n) {
  const m = n.mult;
  let bestI = -1, bs = -1e9, viaSea = false;
  for (let k = 0; k < 22; k++) {
    const sea = m.sea > 0 && c.coastal && rand() < 0.45;
    const R = sea ? m.sea : m.range;
    const dy = Math.round((rand() * 2 - 1) * R), y = c.y + dy;
    if (y < 1 || y >= H - 1) continue;
    const rx = R / Math.max(COSLAT[y], 0.3);
    const i = y * W + (c.x + Math.round((rand() * 2 - 1) * rx) + W) % W;
    if (!isLand(i)) continue;
    const own = S.owner[i];
    if (own !== -1 && own !== n.id) continue;
    const b = WORLD.biome[i];
    if (b === B.MOUNTAIN || (b === B.ICE && cellTeff(i) < -9)) continue;
    const f = fertEff(i, m);
    let rs = 0; for (const r of RES) if (S.res[r][i] > 0) rs += 1;
    if (f < 0.12 && rs === 0) continue;
    const coast = isCoastal(i);
    if (sea && !coast) continue;
    if (!farFromCities(i, 3.3)) continue;
    const d = cellDist(c.i, i);
    const s = f * 1.6 + rs * 0.25 + (coast ? 0.25 : 0) + (own === -1 ? 0.35 : 0) - d / R * 0.25 + rand() * 0.25;
    if (s > bs) { bs = s; bestI = i; viaSea = sea && d > m.range; }
  }
  if (bestI < 0) return;
  const take = Math.min(c.pop * 0.25, 45000 + rand() * 30000);
  c.pop -= take;
  const nc = createCity(bestI, n.id, take, false);
  if (viaSea && !n.colony) { n.colony = 1; log('civ', `${n.name}的船队跨海建立了第一块殖民地「${nc.name}」`, bestI, false); }
  onSettle(c, nc);
}
function farFromCities(i, dmin) {
  const y = (i / W) | 0;
  for (const o of S.cities) if (Math.abs(o.y - y) < dmin + 1 && cellDist(o.i, i) < dmin) return false;
  return true;
}

// cost of a tech for nation n now: cheaper when others know it, more expensive when researched ahead of its reference year
function techCost(n, id) {
  const t = TECH_BY_ID[id];
  const alive = S.nations.filter(o => o.alive && o !== n);
  const known = alive.length ? alive.filter(o => o.techs[id] !== undefined).length / alive.length : 0;
  const a = ERA_REF[t.era], b = ERA_REF[t.era + 1], diff = 1 - Math.min(0.75, 0.5 * known * n.mult.diff);
  if (t.mil) {
    const tau = Math.min((b - a) / 3, MTAU), pace = clamp(Math.pow(2, (t.ry - S.year) / tau), 0.5, 40);
    return MCOST[t.era] * (1 + 0.4 * clamp((t.ry - a) / (b - a), 0, 1)) * diff * pace;
  }
  const ref = a + (b - a) * t.idx / t.per, tau = Math.min((b - a) / 3, CTAU);
  const pace = clamp(Math.pow(2, (ref - S.year) / tau), 0.5, 40);
  return COST[t.era] * (1 + 0.4 * t.idx / t.per) * diff * pace;
}
const MTAU = 14;   // military techs: years per doubling of the ahead-of-time penalty
const CTAU = 25;   // civil techs: the same, capped so the long late eras cannot be raced through a century early

function discover(n, id) {
  n.techs[id] = S.year;
  const oldEra = n.mult.era;
  n.mult = computeMult(n);
  techVersion++;
  const first = !S.firsts[id];
  if (first) firstTech(n, id);
  busEmit('tech', { n, id, first });
  if (n.mult.era > oldEra) {
    const firstEra = n.mult.era > S.flags.maxEra;
    if (firstEra) { S.flags.maxEra = n.mult.era; log('civ', `${n.name}率先迈入${ERA_NAME[n.mult.era]}时代`, capitalCell(n), false); }
    busEmit('era', { n, era: n.mult.era, first: firstEra });
  }
}
function firstTech(n, id) {
  const t = TECH_BY_ID[id], big = largestCity(n);
  S.firsts[id] = { n: n.id, name: n.name, y: S.year };
  if (t.mil) { if (!milFirst(n, id, big ? big.i : -1)) log('tech', `${n.name}在${big ? big.name : '国都'}率先掌握「${t.name}」，${t.desc.replace(/。$/, '')}`, big ? big.i : -1, false); return; }
  log('tech', `${n.name}在${big ? big.name : '国都'}率先掌握「${t.name}」，${t.desc.replace(/。$/, '')}`, big ? big.i : -1);
  if (id === 'rocketry') { log('space', `${n.name}发射了人类第一颗人造卫星`, big ? big.i : -1); S.moonDue = S.year + 8 + ((rand() * 6) | 0); S.moonBy = n.id; }
  if (id === 'spacecol') log('space', `${n.name}建成第一座轨道城市，人类开始在太空中生活`, -1);
  if (id === 'warp') log('space', `${n.name}掌握曲率航行，星际方舟开始建造`, -1);
  if (id === 'steam') showBanner('工业革命', `${n.name}的第一座蒸汽工厂在${big ? big.name : '国都'}投产`);
}

function killNation(n, cell) {
  if (!n.alive) return;
  n.alive = false; n.died = S.year;
  log('war', `${n.name}灭亡了`, cell, true);
  S.wars = S.wars.filter(w => w.a !== n.id && w.b !== n.id);
  for (const o of S.nations) { o.allies = o.allies.filter(x => x !== n.id); if (o.overlord === n.id) o.overlord = -1; }
  n.allies = [];
  busEmit('fall', { n, cell });
  if (isPlayer(n)) playerNationLost(n, null);
}

/* ---------- war & diplomacy ---------- */
function atWar(a, b) { return S.wars.some(w => (w.a === a && w.b === b) || (w.a === b && w.b === a)); }
function warCount(a) { let k = 0; for (const w of S.wars) if (w.a === a || w.b === a) k++; return k; }
function allied(a, b) { const A = S.nations[a]; return !!A && A.allies.includes(b); }
function enemiesOf(a) { const out = []; for (const w of S.wars) { if (w.a === a) out.push(w.b); else if (w.b === a) out.push(w.a); } return out; }
// power(n) lives in 06m_war.js (army + navy + air forces)

function startWar(a, b, forced, text) {
  if (a === b || atWar(a, b)) return null;
  let A = S.nations[a], Bn = S.nations[b];
  if (!A || !Bn || !A.alive || !Bn.alive) return null;
  if (realmOf(a) === realmOf(b) && !(A.civilOf === b || Bn.civilOf === a)) return null;
  if (Bn.overlord >= 0 && S.nations[Bn.overlord] && S.nations[Bn.overlord].alive && Bn.overlord !== a) { Bn = S.nations[Bn.overlord]; b = Bn.id; if (atWar(a, b)) return null; }
  if (allied(a, b)) breakAlliance(a, b, true);
  const fr = nearestPair(A, Bn);
  const w = { id: S.nextOrder++, a, b, start: S.year, dur: forced ? 14 + ((rand() * 18) | 0) : 6 + ((rand() * 16) | 0), front: fr ? fr.i : -1, caps: [0, 0], forced: !!forced, sc: [A.cl.length, Bn.cl.length], vis: [0, 0], air: 0.5, sea: 0.5, ls: 0.5, blockade: [0, 0], capLost: [0, 0], yr: {} };
  S.wars.push(w);
  log('war', text || `${A.name}向${Bn.name}宣战`, w.front);
  for (const id of Bn.allies.slice()) { const o = S.nations[id]; if (o && o.alive && id !== a && !atWar(id, a) && rand() < 0.7) joinWar(id, a, Bn); }
  for (const id of A.allies.slice()) { const o = S.nations[id]; if (o && o.alive && id !== b && !atWar(id, b) && rand() < 0.45) joinWar(id, b, A); }
  for (const p of puppetsOf(Bn.id)) if (!atWar(p.id, a)) joinWar(p.id, a, Bn);
  for (const p of puppetsOf(A.id)) if (!atWar(p.id, b)) joinWar(p.id, b, A);
  if (isPlayer(Bn) && !booting) playerWarDeclared(w, A);
  if (!forced || !isPlayer(A)) balanceOfPower(w);
  busEmit('war', { w, a: A, b: Bn });
  return w;
}
function joinWar(id, enemy, friend) {
  const O = S.nations[id], E = S.nations[enemy];
  if (allied(id, enemy)) breakAlliance(id, enemy, true);
  const fr = nearestPair(O, E);
  S.wars.push({ id: S.nextOrder++, a: id, b: enemy, start: S.year, dur: 6 + ((rand() * 12) | 0), front: fr ? fr.i : -1, caps: [0, 0], forced: false, sc: [O.cl.length, E.cl.length], vis: [0, 0], air: 0.5, sea: 0.5, ls: 0.5, blockade: [0, 0], capLost: [0, 0], yr: {} });
  if (isPlayer(E) && !booting) showTicker('war', `${O.name}作为${friend.name}的盟友向你宣战`);
  log('war', `${O.name}履行与${friend.name}的盟约，向${E.name}宣战`, fr ? fr.i : -1, false);
}
function warBetween(a, b) { return S.wars.find(w => (w.a === a && w.b === b) || (w.a === b && w.b === a)); }
function makePeace(a, b, text) {
  const w = warBetween(a, b);
  if (!w) return false;
  S.wars.splice(S.wars.indexOf(w), 1);
  S.orders = S.orders.filter(o => !((o.a === a && o.tn === b) || (o.a === b && o.tn === a)));
  log('war', text || `${S.nations[a].name}与${S.nations[b].name}停战`, w.front, false);
  busEmit('peace', { a: S.nations[a], b: S.nations[b], w });
  return true;
}
function formAlliance(a, b, text) {
  if (a === b) return false;
  const A = S.nations[a], Bn = S.nations[b];
  if (atWar(a, b)) makePeace(a, b, null);
  if (!A.allies.includes(b)) A.allies.push(b);
  if (!Bn.allies.includes(a)) Bn.allies.push(a);
  log('civ', text || `${A.name}与${Bn.name}结成同盟`, capitalCell(A), false);
  return true;
}
function breakAlliance(a, b, silent) {
  const A = S.nations[a], Bn = S.nations[b];
  if (!A || !Bn || !A.allies.includes(b)) return false;
  A.allies = A.allies.filter(x => x !== b); Bn.allies = Bn.allies.filter(x => x !== a);
  if (!silent) log('civ', `${A.name}与${Bn.name}的同盟破裂`, -1, false);
  return true;
}
function annexNation(big, small, text, major = true) {
  if (!big.alive || !small.alive || big === small) return false;
  for (const c of S.cities) if (c.n === small.id) { c.n = big.id; c.cap = false; c.origin = small.id; c.lay = null; }
  big.cl.push(...small.cl); small.cl = [];
  for (const k in small.techs) if (big.techs[k] === undefined && TECH_BY_ID[k] && !exclBlocked(big, TECH_BY_ID[k])) big.techs[k] = S.year;
  big.mult = computeMult(big);
  small.alive = false; small.died = S.year;
  S.wars = S.wars.filter(w => w.a !== small.id && w.b !== small.id);
  for (const o of S.nations) { o.allies = o.allies.filter(x => x !== small.id); if (o.overlord === small.id) o.overlord = big.id; }
  small.allies = [];
  log('civ', text || `${small.name}并入${big.name}`, capitalCell(big), major);
  S.terrDirty = true;
  techVersion++;
  if (isPlayer(small)) playerNationLost(small, big);
  return true;
}
// a city (and its neighbours) breaks away and founds a new nation
function splitFrom(core, byGod) {
  const n = S.nations[core.n];
  if (!n || !n.alive) return null;
  const mine = S.cities.filter(c => c.n === n.id);
  if (mine.length < 2) return null;
  const group = mine.filter(c => c === core || (cellDist(c.i, core.i) < 6 && !c.cap)).slice(0, 8);
  if (!group.includes(core)) group.unshift(core);
  if (group.length >= mine.length) group.length = Math.max(1, mine.length - 1);
  const nn = createNation(n.techs, n);
  nn.rebel = !!byGod;
  const [riv, rsup] = topRival(n);
  if (riv && rsup > 0.15 && rand() < 0.6) { nn.ideo = riv; nn.sup[riv] = Math.max(0.5, nn.sup[riv] || 0); let s2 = 0; for (const k in nn.sup) s2 += nn.sup[k]; for (const k in nn.sup) nn.sup[k] /= s2; delete S.names[nn.name]; nn.name = civilName(nn, riv); nn.mult = computeMult(nn); }
  for (const c of group) { if (c.cap) { c.cap = false; } c.n = nn.id; }
  core.cap = true; nn.capital = core.id;
  if (!S.cities.some(c => c.n === n.id && c.cap)) { const nc = largestCity(n); if (nc) { nc.cap = true; n.capital = nc.id; } }
  n.cl = n.cl.filter(c => !group.includes(c)); nn.cl = group;
  log('civ', `${core.name}宣布脱离${n.name}独立，建立${nn.name}`, core.i);
  S.terrDirty = true;
  if (rand() < (byGod ? 0.6 : 0.35)) startWar(n.id, nn.id, false, `${n.name}出兵镇压${nn.name}的独立运动`);
  return nn;
}

function visBias(w, side) { if (!w.vis) return 1; const my = w.vis[side], th = w.vis[1 - side]; return 1 + 0.6 * (my - th) / (w.vis[0] + w.vis[1] + 8); }
function warTick() {
  if (S.tick % 2 === 0) {
    for (const [a, b, len] of S.borders) {
      const A = S.nations[a], Bn = S.nations[b];
      if (!A || !Bn || !A.alive || !Bn.alive || atWar(a, b) || allied(a, b) || warCount(a) > 1 || warCount(b) > 1) continue;
      if (A.overlord >= 0 || Bn.overlord >= 0 || realmOf(a) === realmOf(b) || hasNap(A, Bn)) continue;
      const era = Math.min(A.mult.era, Bn.mult.era);
      const amb = (A.ambition * ideoOf(A).aggr + Bn.ambition * ideoOf(Bn).aggr) / 2;
      const ratio = Math.max(power(A), power(Bn)) / Math.max(1, Math.min(power(A), power(Bn)));
      let p = 0.004 * amb * [0.55, 0.75, 0.9, 1, 0.9, 0.75, 0.45, 0.3, 0.25][era] * Math.min(A.mult.peace, Bn.mult.peace) * (1 + Math.min(len, 60) / 40) * (1 + ideoDist(A.ideo, Bn.ideo) * 1.5) * (1 + Math.min(2, Math.log(ratio) * 0.8));
      if (ideoOf(A).demo && ideoOf(Bn).demo) p *= 0.15;
      const da = deterrent(A), db = deterrent(Bn);
      p *= da && db ? nukeWarK(A, Bn) : S.flags.nukeTaboo > S.year ? 0.5 : 1;
      if (rand() < p) {
        let sa = A.ambition * ideoOf(A).aggr * power(A), sb = Bn.ambition * ideoOf(Bn).aggr * power(Bn);
        if (da !== db) { if (da) { sa *= 1.3; sb *= 0.5; } else { sb *= 1.3; sa *= 0.5; } }
        const att = rand() < sa / (sa + sb) ? A : Bn, def = att === A ? Bn : A;
        if (isPlayer(att)) continue;
        startWar(att.id, def.id, false);
      }
    }
  }
  if (S.tick % 10 === 0) {
    for (const [a, b] of S.borders) {
      const A = S.nations[a], Bn = S.nations[b];
      if (!A || !Bn || !A.alive || !Bn.alive || atWar(a, b) || allied(a, b) || A.allies.length > 2 || Bn.allies.length > 2) continue;
      if (isPlayer(A) || isPlayer(Bn) || A.overlord >= 0 || Bn.overlord >= 0) continue;
      const common = enemiesOf(a).some(e => atWar(b, e));
      if (rand() < (common ? 0.25 : 0.012) * (1 - ideoDist(A.ideo, Bn.ideo))) formAlliance(a, b, null);
    }
    for (const A of S.nations) if (A.alive && !isPlayer(A)) for (const b of A.allies.slice()) if (b > A.id && !isPlayer(S.nations[b]) && rand() < 0.015) breakAlliance(A.id, b, false);
  }
  for (let k = S.wars.length - 1; k >= 0; k--) {
    const w = S.wars[k]; if (!w) continue;
    const A = S.nations[w.a], Bn = S.nations[w.b];
    if (!A.alive || !Bn.alive) { S.wars.splice(k, 1); continue; }
    if (w.vis) { w.vis[0] *= 0.97; w.vis[1] *= 0.97; }
    for (const c of S.cities) if (c.i === w.front && (c.n === w.a || c.n === w.b)) c.pop *= 0.985;
    warYear(w);
    if (!S.wars.includes(w)) continue;
    if (S.year - w.start >= w.dur) {
      if (w.civil) { S.wars.splice(S.wars.indexOf(w), 1); endCivilWar(w); continue; }
      if (isPlayer(A) || isPlayer(Bn)) { if (!modalOpen && (!w.offered || S.year - w.offered > secYears(20))) { w.offered = S.year; aiPeaceOffer(w); } continue; }
      S.wars.splice(S.wars.indexOf(w), 1);
      const ca = w.caps[0], cb = w.caps[1];
      const res = ca === cb ? '双方回到战前边界' : `${ca > cb ? A.name : Bn.name}获得 ${Math.abs(ca - cb)} 座城市`;
      log('war', `${A.name}与${Bn.name}签订和约，${res}`, w.front, false);
    }
  }
  for (let k = S.orders.length - 1; k >= 0; k--) {
    const o = S.orders[k];
    if (S.year < o.eta) continue;
    S.orders.splice(k, 1);
    const tc = cityById(o.to), A = S.nations[o.a];
    if (!tc || !A || !A.alive || tc.n === A.id) { onOrderResult(o, false, true); continue; }
    const D = S.nations[tc.n];
    let w = warBetween(A.id, D.id);
    if (!w) w = startWar(A.id, D.id, true, `${A.name}的大军向${D.name}开战`);
    const side = w && w.a === A.id ? 0 : 1, FA = milForces(A), FD = milForces(D);
    if (w) warInit(w);
    const sa = w ? airC(w, side) : 0, fc = cityById(o.from);
    const wet = o.amphib || (fc && seaGap(fc.i, tc.i) > 0.4 && !(w && theatre(w).land && cellDist(fc.i, tc.i) < 12));
    if (wet && w && FD.S > 0) {           // an overseas expedition must first beat the defending fleet
      if (theatre(w).sea || o.amphib) seaWar(w, w.a === A.id ? A : D, w.a === A.id ? D : A, w.a === A.id ? FA : FD, w.a === A.id ? FD : FA, theatre(w));
      if (seaC(w, side) < 0.15) { log('war', `${A.name}的登陆舰队在${tc.name}外海被${D.name}的海军击退`, tc.i, true); stockLoss(A, 0, 0.02); stockLoss(A, 1, 0.02); onOrderResult(o, false); continue; }
    }
    const amph = wet ? (A.mult.era >= 5 ? 0.35 + 0.65 * Math.min(1, A.mult.amphib) : 0.8) : 1;
    const pa = landStrength(A, D, FA, FD, sa, w) * o.str * amph * (0.6 + rand() * 0.8) * (w ? visBias(w, side) : 1) * (fc ? 1 + 0.15 * bget(fc, 'army') : 1);
    const pd = landStrength(D, A, FD, FA, -sa, w) * (0.6 + rand() * 0.8) * D.mult.def * (tc.cap ? 1.25 : 1) * (1 + 0.3 * bget(tc, 'fort'));
    if (pa > pd) { if (wet) S.stats.invasions = (S.stats.invasions || 0) + 1; stockLoss(A, 0, 0.015); stockLoss(D, 0, 0.03); captureCity(tc, A, D, w); S.stats.conquer++; onOrderResult(o, true); }
    else { log('war', `${A.name}进攻${tc.name}失败，大军溃退`, tc.i, true); stockLoss(A, 0, 0.04); stockLoss(D, 0, 0.01); onOrderResult(o, false); }
  }
  const involved = new Set(); for (const w of S.wars) { involved.add(w.a); involved.add(w.b); }
  if (involved.size > S.stats.maxWarNations) S.stats.maxWarNations = involved.size;
  if (S.wars.length) S.stats.lastWarYear = S.year;
  for (const n of S.nations) if (n.legions > 0) n.legions *= 0.99;
}
function nearestPair(of, to) {
  let bc = null, bd = 1e9;
  for (const c of of.cl) for (const o of to.cl) { const d = cellDist(c.i, o.i); if (d < bd) { bd = d; bc = c; } }
  return bc ? { c: bc, d: bd, i: bc.i } : null;
}
function captureCity(c, win, lose, w) {
  c.n = win.id; c.pop *= 0.85; c.fac *= 0.7; c.origin = lose.id; c.capturedAt = S.year; c.lay = null;
  if (c.bld) { const b = c.bld; b.mf = Math.floor(b.mf * 0.6); b.dock = Math.floor(b.dock * 0.7); b.cf = Math.floor(b.cf * 0.8); for (const k of ['army', 'navy', 'air', 'fort']) b[k] = Math.max(0, b[k] - 1); }
  const wasCap = c.cap; c.cap = false;
  if (w) { w.front = c.i; w.caps[win.id === w.a ? 0 : 1]++; if (wasCap) { warInit(w); w.capLost[lose.id === w.a ? 0 : 1] = 1; } }
  lose.cl = lose.cl.filter(x => x !== c); win.cl.push(c);
  lose.warLoss = Math.min(1.2, (lose.warLoss || 0) + 0.12);
  if (lose.ai) lose.ai.grudge[win.id] = Math.min(1, (lose.ai.grudge[win.id] || 0) + 0.15);
  log('war', `${win.name}攻占了${lose.name}的${wasCap ? '首都' : ''}${c.name}`, c.i, wasCap || isPlayer(win) || isPlayer(lose));
  if (wasCap) { const nc = largestCity(lose); if (nc) { nc.cap = true; lose.capital = nc.id; } }
  onCapture(c, win, lose);
  busEmit('capture', { c, win, lose, wasCap, w });
  if (!lose.cl.length) { killNation(lose, c.i); S.terrDirty = true; return; }
  const ls = w && w.sc ? w.sc[lose.id === w.a ? 0 : 1] : lose.cl.length + 1;
  const crushed = lose.cl.length <= ls * 0.35 || (wasCap && (lose.cl.length <= ls * 0.6 || power(lose) < power(win) * 0.3));
  if (crushed && !isPlayer(win) && !isPlayer(lose)) capitulate(win, lose, w);
  else if (crushed && isPlayer(win) && w && !w.capOffered) { w.capOffered = 1; queueModal({ kicker: '投降', title: `${lose.name}请求投降`, html: `<p>${esc(lose.name)}已无力再战。你可以在和会上决定它的命运。</p>`, buttons: [{ label: '召开和会', primary: true, fn: () => peaceConference(w) }, { label: '继续进攻' }] }); }
  else if (crushed && isPlayer(lose) && w && !w.capAsked) { w.capAsked = 1; queueModal({ kicker: '危局', title: '首都陷落', html: `<p>${esc(win.name)}的军队攻入了${esc(c.name)}。继续抵抗还是求和？</p>`, buttons: [{ label: '继续抵抗', primary: true }, { label: '召开和会', fn: () => peaceConference(w) }] }); }
  S.terrDirty = true;
}
function orderAttack(fromC, toC) {
  const A = S.nations[fromC.n], D = S.nations[toC.n];
  if (!A || !D || A === D) return null;
  if (!atWar(A.id, D.id)) startWar(A.id, D.id, true, `${A.name}奉造物主之命，从${fromC.name}出兵讨伐${D.name}`);
  const d = cellDist(fromC.i, toC.i);
  const o = { id: S.nextOrder++, a: A.id, tn: D.id, from: fromC.id, to: toC.id, start: S.year, eta: S.year + Math.max(1, Math.round(d / 7)), str: 1.6 };
  S.orders.push(o);
  log('war', `${A.name}的大军从${fromC.name}开拔，目标：${toC.name}`, fromC.i, true);
  onOrder(o, fromC, toC);
  busEmit('order', { o, from: fromC, to: toC });
  return o;
}

/* ---------- random events ---------- */
function eventsTick() {
  const alive = S.nations.filter(n => n.alive);
  if (!alive.length) return;
  let pm = 0; for (const n of alive) pm += n.mult.plague; pm /= alive.length;
  if (rand() < 0.006 * pm) plague(pickByPop(alive), false);
  for (const n of alive) if (n.golden <= 0 && rand() < 0.0012) { n.golden = 25; log('civ', `${n.name}迎来文化与科学的黄金时代`, capitalCell(n), false); }
  if (S.tick % 5 === 0) {
    for (const [a, b] of S.borders) {
      const A = S.nations[a], Bn = S.nations[b];
      if (!A || !Bn || !A.alive || !Bn.alive || atWar(a, b)) continue;
      const big = A.st.pop >= Bn.st.pop ? A : Bn, small = big === A ? Bn : A;
      if (small.rebel && S.year - small.born < 300) continue;
      if (isPlayer(small) || small.civilOf !== undefined) continue;
      if (small.st.pop > big.st.pop * 0.03 || (big.mult.era < small.mult.era + 2 && small.st.pop > big.st.pop * 0.01) || rand() > 0.04) continue;
      annexNation(big, small, `${small.name}和平并入${big.name}`, false);
      break;
    }
  }
  if (S.tick % 10 === 0 && alive.length < 16) {
    for (const n of alive) {
      if (isPlayer(n) || n.overlord >= 0 || n.cl.length < 10 || rand() > 0.03 * (1.15 - n.stabV) * (1 + Math.max(0, n.cl.length - 25) / 25)) continue;
      const cap = cityById(n.capital) || largestCity(n); if (!cap) continue;
      const far = n.cl.filter(c => c !== cap && c.pop > 300000 && cellDist(c.i, cap.i) > 14);
      if (!far.length) continue;
      splitFrom(pick(far), false);
      break;
    }
  }
  const T = Math.max(0, S.tanom);
  const cs = S.cities;
  if (!cs.length) return;
  if (rand() < 0.012) { const c = pick(cs); if (nearBiome(c.i, B.MOUNTAIN, 3) || rand() < 0.25) quake(c.i, false); }
  if (rand() < 0.004) { for (let k = 0; k < 30; k++) { const i = (rand() * N) | 0; if (WORLD.biome[i] === B.MOUNTAIN) { volcano(i, false); break; } } }
  if (rand() < 0.008 * (1 + T * 0.7)) {
    const coast = cs.filter(c => c.coastal && Math.abs(c.lat) < 0.6);
    if (coast.length) { const c = pick(coast); const loss = c.pop * (0.01 + rand() * 0.03 * (1 + T * 0.3)); c.pop -= loss; log('disaster', `${T > 1 ? '超强' : ''}台风登陆${c.name}，${fmtPop(loss)}人遇难`, c.i, false); }
  }
  if (rand() < 0.007 * (1 + T * 0.6)) {
    const hot = cs.filter(c => WORLD.cT[c.i] > 12);
    if (hot.length) { const c = pick(hot); c.drought = 4 + ((rand() * 6) | 0); log('disaster', `${c.name}周边遭遇持续 ${c.drought} 年的大旱`, c.i, false); }
  }
  if (rand() < 0.00012) meteor((rand() * N) | 0, false);
}

function plague(n, forced) {
  if (!n || !n.alive) return;
  const era = n.mult.era;
  const name = era <= 2 ? pick(['大瘟疫', '黑死病', '鼠疫']) : era <= 4 ? pick(['天花', '霍乱', '伤寒']) : era === 5 ? '大流感' : '新型病毒';
  const sev = (0.06 + rand() * 0.18) * n.mult.plague * (forced ? 2.2 : 1);
  let dead = 0;
  const hit = (nat, s) => { for (const c of S.cities) if (c.n === nat.id) { const d = c.pop * Math.min(0.8, s * (0.6 + rand() * 0.8)); c.pop -= d; dead += d; addFx(c.i, 'plague', true); } };
  hit(n, sev);
  for (const [a, b] of S.borders) { const o = a === n.id ? b : b === n.id ? a : -1; if (o >= 0 && rand() < 0.5) hit(S.nations[o], sev * 0.5 * S.nations[o].mult.plague / Math.max(0.05, n.mult.plague)); }
  log('disaster', `${name}席卷${n.name}${forced ? '（天罚）' : ''}，约 ${fmtPop(dead)} 人罹难`, capitalCell(n));
}
function quake(i, forced) {
  let total = 0, worst = null;
  for (const c of S.cities) {
    const d = cellDist(c.i, i);
    if (d > (forced ? 4 : 2.5)) continue;
    const k = (forced ? 0.18 : 0.06) * (1 - d / 5) * (0.5 + rand());
    const loss = c.pop * clamp(k, 0, 0.6); c.pop -= loss; total += loss;
    if (!worst || loss > worst.l) worst = { c, l: loss };
  }
  const mag = (forced ? 8.2 : 6.8) + rand() * 1.2;
  addFx(i, 'quake', true);
  if (worst) log('disaster', `里氏 ${mag.toFixed(1)} 级地震袭击${worst.c.name}，${fmtPop(total)}人遇难`, worst.c.i, forced);
  else if (forced) log('disaster', `里氏 ${mag.toFixed(1)} 级地震撼动荒野`, i, true);
}
function volcano(i, forced) {
  S.tanom -= forced ? 0.35 : 0.15 + rand() * 0.25;
  for (const c of S.cities) if (cellDist(c.i, i) < (forced ? 5 : 4)) c.pop *= forced ? 0.75 : 0.9;
  if (forced && WORLD.biome[i] !== B.MOUNTAIN && isLand(i)) terraform(i, 'mountain', true);
  addFx(i, 'volcano', true);
  log('disaster', forced ? '造物主唤醒了一座火山，火山灰遮天蔽日，全球降温' : '一座火山猛烈喷发，火山灰让全球短暂降温', i, true);
}
function meteor(i, forced) {
  let destroyed = 0;
  for (let k = S.cities.length - 1; k >= 0; k--) {
    const c = S.cities[k], d = cellDist(c.i, i);
    if (d < 4.5) { c.pop *= clamp(d / 4.5, 0, 1) * 0.6; if (c.pop < 20000) { removeCity(c, false); destroyed++; } }
  }
  const y0 = (i / W) | 0, x0 = i - y0 * W;
  for (let dy = -4; dy <= 4; dy++) for (let dx = -6; dx <= 6; dx++) {
    const y = y0 + dy; if (y < 0 || y >= H) continue;
    const j = y * W + (x0 + dx + W) % W;
    if (cellDist(i, j) < 4) { S.forest[j] *= 0.2; markDirty(j); }
  }
  if (forced && isLand(i)) terraform(i, 'sink', true);
  S.tanom -= forced ? 0.6 : 0.4;
  if (forced) S.stats.impact += destroyed;
  log('disaster', `一颗${forced ? '被召唤的' : ''}陨石撞击地表${destroyed ? `，${destroyed} 座城市化为灰烬` : '，冲击波摧毁了方圆数百公里'}`, i, true);
  addFx(i, 'meteor', true);
  S.terrDirty = true;
}
function removeCity(c, drowned) {
  const idx = S.cities.indexOf(c); if (idx < 0) return;
  S.cities.splice(idx, 1);
  const n = S.nations[c.n];
  n.cl = n.cl.filter(x => x !== c);
  if (drowned) {
    let best2 = null, bd = 1e9;
    for (const o of S.cities) if (o.n === c.n) { const d = cellDist(o.i, c.i); if (d < bd) { bd = d; best2 = o; } }
    if (best2) best2.pop += c.pop * 0.7;
  }
  if (c.cap) { const nc = largestCity(n); if (nc) { nc.cap = true; n.capital = nc.id; } }
  if (!S.cities.some(o => o.n === c.n)) killNation(n, c.i);
  onCityRemoved(c);
  S.terrDirty = true;
}

/* ---------- terraforming ---------- */
const TERRA_CODE = { raise: 1, sink: 2, mountain: 3, forest: 4 };
const TERRA_KIND = ['', 'raise', 'sink', 'mountain', 'forest'];
function terraform(ci, kind, quiet, replay) {
  const cy = (ci / W) | 0, cx = ci - cy * W;
  const wasLand = WORLD.elev[ci] > S.seaRise;
  for (let sy = 0; sy < TS; sy++) for (let sx = 0; sx < TS; sx++) {
    const ti = (cy * TS + sy) * TW + cx * TS + sx;
    const h = WORLD.tHash[ti] / 255;
    const old = WORLD.tElev[ti];
    let e = old;
    if (kind === 'raise') e = Math.max(e, S.seaRise + 0.015 + 0.06 * h);
    else if (kind === 'sink') e = Math.min(e, S.seaRise - 0.03 - 0.07 * h);
    else if (kind === 'mountain') e = Math.max(e, WORLD.mtn + 0.03 + 0.22 * h);
    WORLD.tElev[ti] = e;
    WORLD.tT[ti] -= (Math.max(0, e) - Math.max(0, old)) * 30;
    if (e > 0) {
      let b = classify(e, WORLD.tT[ti], 0.35 + 0.3 * h + (WORLD.tBiome[ti] === B.FOREST || WORLD.tBiome[ti] === B.JUNGLE ? 0.25 : 0), WORLD.mtn);
      if (kind === 'forest') { const T = WORLD.tT[ti]; if (T > -2 && b !== B.MOUNTAIN && b !== B.ICE) b = T < 5 ? B.TAIGA : T < 18 ? B.FOREST : B.JUNGLE; }
      else if (old > 0 && kind !== 'mountain' && WORLD.tBiome[ti] !== B.SHALLOW && WORLD.tBiome[ti] !== B.DEEP && b !== B.MOUNTAIN) b = WORLD.tBiome[ti];
      WORLD.tBiome[ti] = b;
    } else WORLD.tBiome[ti] = e > -0.1 ? B.SHALLOW : B.DEEP;
  }
  // refresh the cell's aggregates
  let se = 0, st = 0, mn = 9, mt = 99;
  for (let sy = 0; sy < TS; sy++) for (let sx = 0; sx < TS; sx++) {
    const ti = (cy * TS + sy) * TW + cx * TS + sx;
    se += WORLD.tElev[ti]; st += WORLD.tT[ti]; if (WORLD.tElev[ti] < mn) mn = WORLD.tElev[ti]; if (WORLD.tT[ti] < mt) mt = WORLD.tT[ti];
  }
  const k = TS * TS;
  WORLD.elev[ci] = se / k; WORLD.cT[ci] = st / k; WORLD.minTE[ci] = mn; WORLD.minTT[ci] = mt;
  const land = WORLD.elev[ci] > 0;
  let b = land ? classify(WORLD.elev[ci], WORLD.cT[ci], WORLD.moist[ci], WORLD.mtn) : (WORLD.elev[ci] > -0.1 ? B.SHALLOW : B.DEEP);
  if (kind === 'forest' && land && b !== B.MOUNTAIN && b !== B.ICE) { const T = WORLD.cT[ci]; b = T < 5 ? B.TAIGA : T < 18 ? B.FOREST : B.JUNGLE; WORLD.moist[ci] = Math.max(WORLD.moist[ci], 0.62); }
  WORLD.biome[ci] = b;
  WORLD.fert0[ci] = BIOME_FERT[b] * (0.75 + 0.5 * WORLD.moist[ci]);
  WORLD.forest0[ci] = BIOME_FOREST[b];
  WORLD.fish[ci] = b === B.SHALLOW ? Math.max(WORLD.fish[ci], 0.45) : 0;
  if (!replay) {
    if (kind === 'forest' || (kind === 'raise' && !wasLand)) S.forest[ci] = WORLD.forest0[ci];
    else S.forest[ci] = Math.min(S.forest[ci], WORLD.forest0[ci]);
    if (!land) S.forest[ci] = 0;
    S.terra.push([ci, TERRA_CODE[kind]]);
    if (kind === 'raise' && !wasLand && WORLD.elev[ci] > S.seaRise) S.stats.landMade++;
  }
  const nowLand = WORLD.elev[ci] > S.seaRise;
  if (wasLand && !nowLand && !replay) {
    for (const c of S.cities.slice()) if (c.i === ci) { log('disaster', `${c.name}沉入了海底`, ci, true); removeCity(c, true); }
  }
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const y = cy + dy; if (y >= 0 && y < H) markDirty(y * W + (cx + dx + W) % W); }
  for (const c of S.cities) if (Math.abs(c.y - cy) <= 1) c.coastal = isCoastal(c.i);
  S.terrDirty = true;
}

/* ---------- god actions ---------- */
function godBless(n) {
  n.golden = 30;
  if (!S.stats.blessed.includes(n.id)) S.stats.blessed.push(n.id);
  log('civ', `造物主眷顾${n.name}，黄金时代降临`, capitalCell(n));
  addFx(capitalCell(n), 'bless', true);
}
function godInspire(n) {
  if (!n.target || n.techs[n.target] !== undefined) n.target = pickTech(n);
  if (!n.target) {
    if (!n.mtarget || n.techs[n.mtarget] !== undefined) n.mtarget = pickMilTech(n);
    if (!n.mtarget) return false;
    n.mresearch += techCost(n, n.mtarget) * 0.95;
    log('tech', `神启降临${n.name}，工程师们在「${TECH_BY_ID[n.mtarget].name}」上取得突破`, capitalCell(n));
    addFx(capitalCell(n), 'inspire', true);
    return true;
  }
  const t = TECH_BY_ID[n.target];
  n.research += techCost(n, n.target) * 0.95;
  log('tech', `神启降临${n.name}，学者们在「${t.name}」上取得突破`, capitalCell(n));
  addFx(capitalCell(n), 'inspire', true);
  return true;
}
function godArmy(n) {
  n.legions += 4;
  const mx = ensureMil(n); mx.att = [0, 0, 0]; mx.tick = -1;
  if (mx.stock) { const T = stockTargets(n, capUE(n) * 0.35); for (const r in T) if (T[r] > 0) { const id = n.mult.best[r]; mx.stock[id] = (mx.stock[id] || 0) + T[r]; } }      // a divine gift arrives fully equipped
  log('war', `${n.name}的军队得到神力加持，战力大增`, capitalCell(n), false);
  addFx(capitalCell(n), 'army', true);
  onArmyGift(n);
}
function godGrantTech(n, id) {
  if (n.techs[id] !== undefined) return false;
  const T0 = TECH_BY_ID[id];
  if (T0.excl) for (const o of EXCL[T0.excl]) if (o !== T0 && n.techs[o.id] !== undefined) { delete n.techs[o.id]; ensureMil(n).pref[T0.excl] = id; log('war', `造物主改写了${n.name}的军事学说：「${o.name}」→「${T0.name}」`, capitalCell(n), false); }
  const added = [];
  const add = tid => { if (n.techs[tid] !== undefined) return; for (const r of TECH_BY_ID[tid].req) add(r); n.techs[tid] = S.year; added.push(tid); };
  add(id);
  n.mult = computeMult(n);
  for (const tid of added) if (!S.firsts[tid]) firstTech(n, tid);
  if (n.mult.era > S.flags.maxEra) S.flags.maxEra = n.mult.era;
  if (n.target && n.techs[n.target] !== undefined) n.target = null;
  if (n.mtarget && n.techs[n.mtarget] !== undefined) n.mtarget = null;
  techVersion++;
  log('tech', `造物主把「${TECH_BY_ID[id].name}」${added.length > 1 ? `连同 ${added.length - 1} 项前置科技` : ''}赐给了${n.name}`, capitalCell(n));
  addFx(capitalCell(n), 'inspire', true);
  return true;
}
function godSeed(i) {
  if (!isLand(i)) return '需要一块陆地';
  if (S.owner[i] >= 0) return '这里已有国家，请选择无人的土地';
  const b = WORLD.biome[i];
  if (b === B.ICE && cellTeff(i) < -9) return '冰原上无法定居';
  if (!farFromCities(i, 3)) return '离其他城市太近了';
  const alive = S.nations.filter(n => n.alive);
  const common = { agri: S.year };
  for (const t of TECHS) if (alive.length && alive.every(n => n.techs[t.id] !== undefined)) common[t.id] = S.year;
  const n = createNation(common);
  createCity(i, n.id, 120000, true);
  S.stats.seeds++;
  log('civ', `一个新的文明在荒野中诞生：${n.name}`, i);
  addFx(i, 'bless', true);
  territory();
  return n;
}
function godCity(i) {
  if (!isLand(i)) return '需要一块陆地';
  if (!farFromCities(i, 2.5)) return '离其他城市太近了';
  let n = S.owner[i] >= 0 ? S.nations[S.owner[i]] : null;
  if (!n) { const c = nearestCityTo(i, 25); if (c) n = S.nations[c.n]; }
  if (!n || !n.alive) return '附近没有任何国家，可以用「播种文明」';
  const src = n.cl.length ? n.cl.reduce((a, c) => cellDist(c.i, i) < cellDist(a.i, i) ? c : a) : null;
  const pop = 60000;
  if (src) src.pop = Math.max(20000, src.pop - pop * 0.5);
  const c = createCity(i, n.id, pop, false);
  log('civ', `${n.name}在造物主指引下建立了新城「${c.name}」`, i, false);
  if (src) onSettle(src, c);
  territory();
  return c;
}
function nearestCityTo(cell, maxD) { let b = null, bd = maxD; for (const c of S.cities) { const d = cellDist(c.i, cell); if (d < bd) { bd = d; b = c; } } return b; }

function climateTick() {
  let emit = 0, cap = 0;
  for (const n of S.nations) if (n.alive) { emit += n.st.emit; cap += n.st.cap; }
  cap *= clamp((S.co2 - 290) / 80, 0, 1);
  const sink = (S.co2 - 280) * 0.0055 * (0.55 + 0.45 * S.forestFrac);
  S.co2 = Math.max(270, S.co2 + (emit - cap) * EMIT_K + S.deforest * 0.06 - sink);
  S.deforest = 0;
  const teq = 3 * Math.log2(S.co2 / 280);
  S.tanom += (teq - S.tanom) * 0.035;
  if (S.nations.some(n => n.alive && n.mult.geo)) S.tanom -= 0.012;
  const seaT = Math.max(0, S.tanom) * 0.0055;
  S.seaRise += (seaT - S.seaRise) * (seaT > S.seaRise ? 0.012 : 0.002);
  if (S.tick % 20 === 0) { let f = 0, f0 = 0; for (let i = 0; i < N; i += 3) { f += S.forest[i]; f0 += WORLD.forest0[i]; } S.forestFrac = f0 ? f / f0 : 1; }
  for (let k = 0; k < 25; k++) { const i = (rand() * N) | 0; if (S.owner[i] < 0 && S.forest[i] < WORLD.forest0[i]) { S.forest[i] = Math.min(WORLD.forest0[i], S.forest[i] + 0.03); markDirty(i); } }
  if (S.co2 > S.co2Peak) S.co2Peak = S.co2;
  for (const v of [350, 400, 450, 500, 560, 650]) if (S.co2 >= v && !S.flags['co2' + v]) { S.flags['co2' + v] = 1; log('climate', `大气二氧化碳浓度突破 ${v} ppm`, -1, v >= 400); }
  for (const v of [1, 1.5, 2, 3, 4]) if (S.tanom >= v && !S.flags['t' + v]) { S.flags['t' + v] = 1; log('climate', `全球平均气温比工业化前升高 ${v} °C`, -1, true); }
  if (S.co2Peak > 380 && S.co2 < S.co2Peak - 8 && !S.flags.co2down) { S.flags.co2down = 1; log('climate', `大气二氧化碳浓度越过峰值（${Math.round(S.co2Peak)} ppm），开始下降`, -1, true); }
  for (const r of ['oil', 'coal']) {
    const f = S.resLeft[r] / WORLD.resTotal[r];
    if (f < 0.5 && !S.flags[r + '50']) { S.flags[r + '50'] = 1; log('climate', `全球${RES_NAME[r]}储量已消耗过半`, -1, false); }
    if (f < 0.1 && !S.flags[r + '10']) { S.flags[r + '10'] = 1; log('climate', `${RES_NAME[r]}濒临枯竭，仅剩不到一成`, -1, true); }
  }
  if (S.seaRise - lastRiseDrawn > 0.0004 || lastRiseDrawn - S.seaRise > 0.0004) {
    const lo = Math.min(lastRiseDrawn, S.seaRise) - 0.001, hi = Math.max(lastRiseDrawn, S.seaRise) + 0.001;
    for (let i = 0; i < N; i++) if (WORLD.minTE[i] < hi && WORLD.elev[i] > lo - 0.05) markDirty(i);
    lastRiseDrawn = S.seaRise;
    for (let k = S.cities.length - 1; k >= 0; k--) {
      const c = S.cities[k];
      if (WORLD.elev[c.i] <= S.seaRise) { log('climate', `海平面上升，${c.name}被海水吞没，居民向内陆迁徙`, c.i, true); removeCity(c, true); }
    }
    S.terrDirty = true;
  }
  if (Math.abs(S.tanom - lastTanomDrawn) > 0.06) {
    lastTanomDrawn = S.tanom;
    for (let i = 0; i < N; i++) if (WORLD.minTT[i] < 4) markDirty(i);
  }
}
