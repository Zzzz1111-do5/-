/* =====================================================================
   Simulation state
   ===================================================================== */
const best = new Float32Array(N);
const prevOwner = new Int16Array(N);

const isLand = i => WORLD.elev[i] > S.seaRise;
const isShallow = i => WORLD.elev[i] <= S.seaRise && WORLD.elev[i] > S.seaRise - 0.1;
const cellTeff = i => WORLD.cT[i] + S.tanom * AMP_CELL[(i / W) | 0];
function neighbors4(i) { const y = (i / W) | 0, x = i - y * W; const out = [y * W + (x + 1) % W, y * W + (x + W - 1) % W]; if (y > 0) out.push(i - W); if (y < H - 1) out.push(i + W); return out; }
function isCoastal(i) { for (const j of neighbors4(i)) if (!isLand(j)) return true; return false; }
function nearBiome(i, b, r) {
  const y0 = (i / W) | 0, x0 = i - y0 * W;
  for (let dy = -r; dy <= r; dy++) { const y = y0 + dy; if (y < 0 || y >= H) continue; for (let dx = -r; dx <= r; dx++) if (WORLD.biome[y * W + (x0 + dx + W) % W] === b) return true; }
  return false;
}


function seedCivs() {
  const starts = [];
  for (let minD = 24; starts.length < 7 && minD > 8; minD -= 4) {
    for (let t = 0; t < 6000 && starts.length < 7; t++) {
      const i = (rand() * N) | 0; if (!isLand(i)) continue;
      const y = (i / W) | 0; if (Math.abs(CELL_LAT[y]) > 0.95) continue;
      if (WORLD.fert0[i] < 0.55 || WORLD.biome[i] === B.MOUNTAIN) continue;
      if (starts.some(j => cellDist(i, j) < minD)) continue;
      starts.push(i);
    }
  }
  S.firsts.agri = { n: -1, name: '各部落', y: START_YEAR };
  for (const i of starts) { const n = createNation(null); createCity(i, n.id, 150000 + rand() * 100000, true); }
  log('civ', `${starts.length} 个部落在大河两岸定居，人类文明由此开始`, starts[0]);
}



/* ---------- log ---------- */

/* =====================================================================
   Territory
   ===================================================================== */
function cityRadius(c) { return clamp(1.25 + Math.sqrt(c.pop / 160000) * 0.42, 1.25, 6.5); }

function territory() {
  S.terrDirty = false;
  prevOwner.set(S.owner);
  best.fill(1e9);
  S.cityOf.fill(-1);
  const cities = S.cities;
  for (let ci = 0; ci < cities.length; ci++) {
    const c = cities[ci], R = cityRadius(c), R2 = R * R, Rs2 = R2 * 0.5, rc = Math.ceil(R);
    for (let dy = -rc; dy <= rc; dy++) {
      const y = c.y + dy; if (y < 0 || y >= H) continue;
      const cl = COSLAT[y], rx = Math.min(W / 2 - 1, Math.ceil(R / Math.max(cl, 0.2)));
      for (let dx = -rx; dx <= rx; dx++) {
        const i = y * W + (c.x + dx + W) % W;
        const ddx = dx * cl, d2 = ddx * ddx + dy * dy;
        if (d2 > R2) continue;
        const land = WORLD.elev[i] > S.seaRise;
        if (!land && (d2 > Rs2 || WORLD.elev[i] < S.seaRise - 0.1)) continue;
        const sc = Math.sqrt(d2) / R + ci * 1e-6;
        if (sc < best[i]) { best[i] = sc; S.cityOf[i] = ci; }
      }
    }
  }
  for (const n of S.nations) { for (const r of RES) n.dep[r].length = 0; }
  for (const c of cities) { c.cells = 0; c.fertSum = 0; c.fishSum = 0; c.mines = 0; }
  const bmap = new Map();
  for (let i = 0; i < N; i++) { const ci = S.cityOf[i]; S.owner[i] = ci >= 0 ? cities[ci].n : -1; }
  for (let i = 0; i < N; i++) {
    const ci = S.cityOf[i];
    const own = S.owner[i];
    if (own !== prevOwner[i]) { markGlobeDirty(i); for (const j of neighbors4(i)) markGlobeDirty(j); }
    let farm = 0, smog = 0;
    if (ci >= 0) {
      const c = cities[ci], n = S.nations[own];
      if (WORLD.elev[i] > S.seaRise) {
        c.cells++;
        c.fertSum += fertEff(i, n.mult);
        farm = FARMABLE[WORLD.biome[i]] ? clamp(c.pop / c.K, 0, 1) * clamp(WORLD.fert0[i] * 1.6, 0.2, 1) : 0;
        smog = c.smog;
      } else c.fishSum += WORLD.fish[i];
      for (const r of RES) if (S.res[r][i] > 0) { n.dep[r].push(i); c.mines++; }
    }
    if (Math.abs(farm - S.farm[i]) > 0.08) { S.farm[i] = farm; markDirty(i); }
    if (Math.abs(smog - S.smog[i]) > 0.08) { S.smog[i] = smog; if (layer === 4) markDirty(i); }
    // borders between nations
    if (own >= 0) {
      const y = (i / W) | 0, x = i - y * W;
      const o1 = S.owner[y * W + (x + 1) % W];
      if (o1 >= 0 && o1 !== own) { const k = Math.min(own, o1) * 1000 + Math.max(own, o1); bmap.set(k, (bmap.get(k) || 0) + 1); }
      if (y > 0) { const o2 = S.owner[i - W]; if (o2 >= 0 && o2 !== own) { const k = Math.min(own, o2) * 1000 + Math.max(own, o2); bmap.set(k, (bmap.get(k) || 0) + 1); } }
    }
  }
  S.borders = [...bmap].map(([k, len]) => [Math.floor(k / 1000), k % 1000, len]);
  // road links for night lights
  for (const c of cities) {
    c.links.length = 0;
    let a = null, ad = 11, b2 = null, bd = 11;
    for (const o of cities) {
      if (o === c || o.n !== c.n) continue;
      const d = cellDist(c.i, o.i);
      if (d < ad) { b2 = a; bd = ad; a = o; ad = d; } else if (d < bd) { b2 = o; bd = d; }
    }
    if (a) c.links.push(a.id); if (b2) c.links.push(b2.id);
  }
}

function fertEff(i, m) {
  const b = WORLD.biome[i];
  let f = WORLD.fert0[i];
  if (b === B.ICE) { if (cellTeff(i) > -9) f = 0.08; else return 0; }
  if (m.dry && (b === B.DESERT || b === B.STEPPE || b === B.SAVANNA)) f += 0.12;
  const t = S.tanom;
  if (t > 0) { const ct = WORLD.cT[i]; f *= ct > 20 ? 1 - 0.08 * t : ct > 10 ? 1 - 0.03 * t : 1 + 0.04 * t; }
  f *= 1 - S.forest[i] * 0.6;
  f *= 1 - Math.min(0.5, S.smog[i] * 0.5);
  return Math.max(0, f);
}

/* =====================================================================
   Yearly tick
   ===================================================================== */
const CAP_FERT = 170000, CAP_FISH = 50000;
const COAL_USE = 0.4, OIL_USE = 0.4, U_USE = 0.1, RARE_USE = 0.03, IRON_BUILD = 2, IRON_MAINT = 0.02;
const EMIT_K = 0.00034;


function cityTick(c, n) {
  const m = n.mult;
  let K = (c.fertSum * CAP_FERT * m.food + c.fishSum * CAP_FISH * m.fish) * (1 + 0.3 * Math.min(1, c.goods));
  if (m.orbital) K *= 1.1;
  if (c.drought > 0) { K *= 0.6; c.drought--; }
  K = Math.max(K * Math.pow(m.birth, 1.3) * (n.eco ? n.eco.K.infra * n.eco.K.wel : 1), 15000);
  c.K = K;
  const r = m.growth * m.birth * (n.golden > 0 ? 1.15 : 1);
  if (c.pop < K) c.pop += r * c.pop * (1 - c.pop / K) + 100;
  else c.pop -= (c.pop - K) * 0.06;
  // industry
  if (m.ind > 0) {
    const target = c.pop / 1e6 * 1.1 * m.ind * (n.eco ? n.eco.K.ind : 1) + bget(c, 'cf');      // built civilian factories add to the private base
    let d = target - c.fac;
    d = d > 0 ? d * 0.05 * n.st.ironSat * (0.25 + 0.75 * n.st.sat) : d * 0.03;
    c.fac = Math.max(0, c.fac + d);
    if (d > 0) n.st.newFac += d;
  }
  c.goods = c.fac * n.st.sat / Math.max(0.05, c.pop / 1e6) / 2.5;
  const fossil = Math.max(0, 1 - n.nuke - n.renew - n.fusion);
  c.smog = clamp(c.fac * fossil * n.st.sat / Math.max(4, c.cells * 2.5), 0, 1);
  if (m.lab > 0) { const tl = c.pop / 1e6 * m.lab * 1.2 + (c.inst || 0) * 0.5; c.labs += (tl - c.labs) * 0.04; }
  c.rp = Math.pow(c.pop / 1e5, 0.7) * 0.12 * m.sci * (1 + Math.sqrt(c.labs) * 0.25) * (1 + 0.3 * Math.min(1, c.goods)) * (n.golden > 0 ? 1.5 : 1) * (1 + 0.06 * Math.min(5, c.inst || 0));
  // land use: clear forests under population pressure, regrow with green tech
  if (c.pop > 0.6 * K && rand() < 0.12) {
    const i = randomOwnedCell(c);
    const floor = WORLD.forest0[i] * (m.ind > 0 ? 0.25 : 0.45);
    if (i >= 0 && S.forest[i] > floor + 0.01) { const d = Math.min(S.forest[i] - floor, 0.025 * (m.ind > 0 ? 1.6 : 1)); S.forest[i] -= d; S.deforest += d; markDirty(i); }
  }
  if ((m.renew || m.ccs) && rand() < 0.35) {
    const i = randomOwnedCell(c);
    if (i >= 0 && S.forest[i] < WORLD.forest0[i]) { S.forest[i] = Math.min(WORLD.forest0[i], S.forest[i] + 0.02 * (m.ccs ? 2 : 1)); markDirty(i); }
  }
  // settlers
  if (S.cities.length < MAX_CITIES && c.pop > 0.45 * K && c.pop > 120000 && rand() < 0.035) trySettle(c, n);
}

function randomOwnedCell(c) {
  const R = Math.ceil(cityRadius(c));
  for (let k = 0; k < 6; k++) {
    const dy = Math.round((rand() * 2 - 1) * R), y = c.y + dy; if (y < 0 || y >= H) continue;
    const rx = R / Math.max(COSLAT[y], 0.25);
    const i = y * W + (c.x + Math.round((rand() * 2 - 1) * rx) + W) % W;
    if (S.cityOf[i] >= 0 && S.cities[S.cityOf[i]] === c && isLand(i)) return i;
  }
  return -1;
}


// civil research track only (military techs: pickMilTech in 06m_war.js)
function pickTech(n) {
  const avail = TECHS.filter(t => !t.mil && n.techs[t.id] === undefined && t.req.every(r => n.techs[r] !== undefined));
  if (!avail.length) return null;
  let minEra = 9; for (const t of avail) minEra = Math.min(minEra, t.era);
  const pool = avail.filter(t => t.era === minEra || (t.era === minEra + 1 && rand() < 0.2));
  const alive = S.nations.filter(o => o.alive && o !== n).length || 1;
  // from the industrial era on, techs come roughly in their historical (declaration) order: engines before aircraft before rockets
  let mi = 99; for (const t of pool) if (t.era === minEra && t.idx < mi) mi = t.idx;
  if (minEra < 4) mi = -1;
  let tot = 0;
  const w = pool.map(t => { const k = S.nations.filter(o => o.alive && o !== n && o.techs[t.id] !== undefined).length / alive; const v = (1 + 2 * k) * (mi < 0 ? 1 : t.era === minEra ? Math.pow(0.8, t.idx - mi) : 0.4); tot += v; return v; });
  let r = rand() * tot;
  for (let k = 0; k < pool.length; k++) { r -= w[k]; if (r <= 0) return pool[k].id; }
  return pool[0].id;
}

function nationTick(n) {
  const m = n.mult;
  let pop = 0, fac = 0, labs = 0, rp = 0, mf = 0, dock = 0;
  for (const c of n.cl) { pop += c.pop; fac += c.fac; labs += c.labs; rp += c.rp; if (c.bld) { mf += c.bld.mf; dock += c.bld.dock; } }
  if (!n.cl.length) { killNation(n, -1); return; }
  n.st.pop = pop; n.st.cities = n.cl.length; n.st.fac = fac; n.st.labs = labs; n.st.rp = rp; n.st.mf = mf; n.st.dock = dock;
  if (n.golden > 0) n.golden--;
  // research: civil track, then the military track funded by the army budget
  if (n.target && TECH_BY_ID[n.target] && TECH_BY_ID[n.target].mil) { if (!n.mtarget || n.techs[n.mtarget] !== undefined) n.mtarget = n.target; n.target = null; }
  if (!n.target || n.techs[n.target] !== undefined) n.target = pickTech(n);
  if (n.target) {
    n.research += rp * (n.eco ? n.eco.K.sci : 1);
    const cost = techCost(n, n.target);
    if (n.research >= cost) { n.research -= cost; discover(n, n.target); n.target = pickTech(n); }
  }
  milResearch(n, rp);
  milRecover(n);
  buildTick(n);
  prodTick(n);
  // energy
  if (m.nuke) n.nuke = Math.min(0.14, n.nuke + 0.004);
  if (m.fusion) n.fusion = Math.min(0.95, n.fusion + 0.015);
  if (m.renew) n.renew = Math.max(0, Math.min(0.85 * (1 - n.fusion) - n.nuke * 0.2, n.renew + 0.011 * m.renewK * n.st.rareSat));
  if (m.ccs) n.ccs = Math.min(1, n.ccs + 0.01);
  if (n.fusion > 0.5) n.nuke = Math.max(0, n.nuke - 0.005);
  const E = fac + (m.ind > 0 ? mf + dock : 0);      // industrial war plants burn coal and oil too (pre-industrial armories do not)
  n.st.E = E;
  const fossil = Math.max(0, 1 - n.nuke - n.renew - n.fusion);
  const oilShare = m.oil ? 0.45 : 0;
  if (E > 0.01) {
    const gC = extract(n, 'coal', E * fossil * (1 - oilShare) * COAL_USE);
    const gO = oilShare > 0 ? extract(n, 'oil', E * fossil * oilShare * OIL_USE) : 1;
    let gSub = 0;
    if (oilShare > 0 && gO < 1) gSub = (1 - gO) * extract(n, 'coal', E * fossil * oilShare * (1 - gO) * COAL_USE);
    const gU = n.nuke > 0 ? extract(n, 'uran', E * n.nuke * U_USE) : 1;
    n.st.rareSat = m.renew ? Math.max(0.15, extract(n, 'rare', E * Math.max(0.03, n.renew) * RARE_USE)) : 1;
    const coalPart = fossil * (1 - oilShare) * gC, oilPart = fossil * oilShare * (gO + gSub), nukePart = n.nuke * gU;
    n.st.sat = clamp(coalPart + oilPart + nukePart + n.renew + n.fusion, 0, 1);
    n.st.mix = [coalPart + fossil * oilShare * gSub, fossil * oilShare * gO, nukePart, n.renew, n.fusion];
    n.st.emit = E * (coalPart * 1.0 + fossil * oilShare * gO * 0.75 + fossil * oilShare * gSub * 1.0);
    n.st.cap = n.ccs * E * 0.32;
    n.st.ironSat = Math.max(0.1, extract(n, 'iron', n.st.newFac * IRON_BUILD + E * IRON_MAINT));
    if (n.st.sat < 0.6 && S.year - n.crisis > 40 && m.ind > 0) { n.crisis = S.year; log('disaster', `${n.name}陷入能源危机，工厂开工率跌至 ${Math.round(n.st.sat * 100)}%`, capitalCell(n), false); }
  } else { n.st.sat = 1; n.st.emit = 0; n.st.cap = 0; n.st.mix = [0, 0, 0, 0, 0]; }
  n.st.newFac = 0;
}

function extract(n, r, amount) {
  if (amount <= 1e-6) return 1;
  let need = amount;
  const arr = S.res[r], m = n.mult;
  const rate = 30 * m.rate;
  const cells = n.dep[r];
  const L = cells.length;
  for (let k = 0; k < L && need > 0; k++) {
    const i = cells[(k + n.rr) % L];
    const take = Math.min(arr[i], rate, need);
    if (take > 0) { arr[i] -= take; need -= take; if (arr[i] < 0.01) { arr[i] = 0; markDirty(i); } }
  }
  n.rr = (n.rr + 1) % 9973;
  if (need > 0) {
    const g = GLOBAL_DEP[r];
    for (let k = 0; k < 40 && need > 0 && g.length; k++) {
      const i = g[(rand() * g.length) | 0];
      if (arr[i] <= 0 || S.owner[i] === n.id) continue;
      const take = Math.min(arr[i], rate * 0.7, need);
      arr[i] -= take; need -= take;
      if (arr[i] < 0.01) { arr[i] = 0; markDirty(i); }
    }
  }
  const got = amount - need;
  S.resLeft[r] = Math.max(0, S.resLeft[r] - got);
  return got / amount;
}
let GLOBAL_DEP = null;
function buildGlobalDep() { GLOBAL_DEP = {}; for (const r of RES) { GLOBAL_DEP[r] = []; for (let i = 0; i < N; i++) if (WORLD.res0[r][i] > 0) GLOBAL_DEP[r].push(i); } }


function largestCity(n) { let b = null; for (const c of S.cities) if (c.n === n.id && (!b || c.pop > b.pop)) b = c; return b; }
function capitalCell(n) { const c = S.cities.find(c => c.id === n.capital) || largestCity(n); return c ? c.i : -1; }
function cityById(id) { return S.cities.find(c => c.id === id); }


/* ---------- war ---------- */

// returns the city of `of` closest to any city of `to`

/* ---------- random events ---------- */
function pickByPop(list) { let t = 0; for (const n of list) t += n.st.pop; let r = rand() * t; for (const n of list) { r -= n.st.pop; if (r <= 0) return n; } return list[0]; }




/* ---------- climate ---------- */
let lastRiseDrawn = 0, lastTanomDrawn = 0;

/* ---------- space ---------- */
function spaceTick() {
  for (const n of S.nations) {
    if (!n.alive) continue;
    const m = n.mult;
    if (m.space) S.sats += (4 + n.st.pop / 4e8) * Math.max(0, 1 - S.sats / 15000);
    if (m.orbital) { S.orbital = Math.min(1, S.orbital + 0.01); S.orbPop = Math.min(3e8, S.orbPop + 4e5 + S.orbPop * 0.01); }
  }
  if (S.moonBy >= 0 && !S.moon && S.year >= S.moonDue) {
    const n = S.nations[S.moonBy];
    S.moon = { n: n.id, y: S.year };
    log('space', `${n.name}的宇航员第一次踏上月球`, -1, true);
    showBanner('登月', `${n.name}的宇航员在月面留下第一个脚印`);
  }
  const warpers = S.nations.filter(n => n.alive && n.mult.warp);
  if (warpers.length && S.year - S.lastShip >= 8 && rand() < 0.15) {
    const n = pick(warpers);
    S.ships++; S.lastShip = S.year;
    const loud = S.ships <= 5 || S.ships % 10 === 0;
    if (loud) log('space', `${n.name}的第 ${S.ships} 艘星际方舟启航，目标：${pick(STARS)}`, capitalCell(n), true);
    launchShip(n);
    if (S.ships === 5) showBanner('星际文明', '人类不再只属于这一颗星球');
  }
  for (const v of [1e8, 1e9, 5e9, 1e10]) if (worldPop() >= v && !S.flags['p' + v]) { S.flags['p' + v] = 1; log('civ', `世界人口突破 ${fmtPop(v)}`, -1, v >= 1e9); }
}

function worldPop() { let p = 0; for (const c of S.cities) p += c.pop; return p + S.orbPop + spacePop(); }
function sampleHistory() {
  let fac = 0, rp = 0;
  for (const c of S.cities) { fac += c.fac; rp += c.rp; }
  S.history.push([S.year, Math.round(worldPop()), +S.co2.toFixed(1), +S.tanom.toFixed(3), Math.round(fac), Math.round(rp), IDEO.map(I => +((S.ideoWorld || {})[I.id] || 0).toFixed(3)), S.realmCount || 0]);
  if (S.history.length > 1400) S.history = S.history.filter((_, k) => k % 2 === 0 || k > S.history.length - 200);
}

/* =====================================================================
   Formatting
   ===================================================================== */
function fmtPop(p) {
  if (p >= 1e8) return (p / 1e8).toFixed(p >= 1e9 ? 1 : 2).replace(/\.0$/, '') + ' 亿';
  if (p >= 1e4) return (p / 1e4).toFixed(p >= 1e6 ? 0 : 1).replace(/\.0$/, '') + ' 万';
  return String(Math.round(p));
}
function fmtNum(v) { if (v >= 1e4) return (v / 1e4).toFixed(1).replace(/\.0$/, '') + ' 万'; return Math.round(v).toLocaleString('zh-CN'); }
function fmtYear(y) { return y < 0 ? `公元前 ${-y} 年` : `公元 ${y} 年`; }
function fmtYearShort(y) { return y < 0 ? `前${-y}` : `${y}`; }

