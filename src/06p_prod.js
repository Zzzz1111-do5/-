/* =====================================================================
   Production and construction (国家建设与军队指挥).
   Every nation's forces are a stock of units: mx.stock maps a unit id to
   "unit equivalents" (UE, roughly a brigade, a squadron or one big ship).
   Military factories build land units and aircraft, dockyards build ships,
   and the establishment (编制: population, military budget, conscription law)
   caps how many units can be kept in service. A full stock laid out by the
   old split × mix gives the same strength as the old formula, so the AI's
   balance is anchored; what is new is that losses have to be rebuilt, new
   models replace old ones gradually, and the player decides where to build
   which factories and bases and which units to produce.
   City buildings (city.bld): cf 民用工厂, mf 军工厂, dock 船坞 share the city's
   building slots; army / navy / air bases and forts have levels 0–3.
   ===================================================================== */
const UEK = 1e5;                                           // strength scale of one UE (milForces)
const UCE = [1.3, 1.6, 2.5, 4.5, 8, 20, 40, 80, 150];      // typical unit cost per era (production points per UE)
const LAW_NAME = ['志愿兵役', '有限征兵', '广泛征兵', '全面动员'];
const LAW_CAP = [0.7, 1, 1.3, 1.65], LAW_GROW = [0, 0, 0.05, 0.12], LAW_SCI = [0, 0, 0.03, 0.08], LAW_STAB = [0.03, 0, -0.03, -0.08], LAW_WILL = [0, 0, 0.05, 0.12], LAW_MRP = [0, 0, 0.15, 0.3];
const LAW_DESC = ['编制 ×0.7，稳定 +3', '编制 ×1（默认）', '编制 ×1.3，人口增长 −5%，科研 −3%，稳定 −3，企业意愿 −5%', '编制 ×1.65，人口增长 −12%，科研 −8%，稳定 −8，企业意愿 −12%'];
function lawOf(n) { return n.law === undefined ? 1 : n.law; }
function setLaw(n, L) { L = clamp(L | 0, 0, 3); if (lawOf(n) === L) return false; n.law = L; n.mult = computeMult(n); if (n.mx) n.mx.tick = -1; return true; }

// how one UE reads to the player: [count per UE, noun]
const DISP = {
  spear: [1000, '人'], bronze_inf: [1000, '人'], legion: [1500, '人'], musketeer: [3000, '人'], rifleman: [5000, '人'], inf_ww: [8000, '人'], mech_inf: [6000, '人'], exo_inf: [4000, '人'],
  archer: [800, '人'], crossbowman: [800, '人'], cannon: [20, '门'], fieldgun: [60, '门'], howitzer: [80, '门'], spg: [60, '辆'], mlrs: [40, '辆'], railgun: [20, '辆'],
  aa_gun: [60, '门'], sam: [30, '辆'], laser_aa: [30, '辆'], tank_destroyer: [50, '辆'],
  chariot: [100, '辆'], horse: [800, '骑'], knight: [500, '骑'], tank_light: [50, '辆'], tank_medium: [50, '辆'], tank_heavy: [40, '辆'], mbt: [50, '辆'], mech: [20, '台'], grav_tank: [20, '辆'],
  galley: [6, '艘'], carrack: [2, '艘'], galleon: [1, '艘'], frigate: [2, '艘'], ship_line: [0.5, '艘'], ironclad: [0.3, '艘'], torpedo_boat: [4, '艘'], destroyer: [1, '艘'],
  light_cruiser: [0.4, '艘'], heavy_cruiser: [0.25, '艘'], battleship: [0.1, '艘'], carrier: [0.1, '艘'], submarine: [1, '艘'], nuke_sub: [0.3, '艘'], missile_destroyer: [0.5, '艘'],
  missile_cruiser: [0.2, '艘'], supercarrier: [0.06, '艘'], stealth_destroyer: [0.4, '艘'], drone_carrier: [0.06, '艘'], uuv: [2, '艘'],
  airship: [3, '艘'], biplane: [40, '架'], fighter: [30, '架'], dive_bomber: [30, '架'], tac_bomber: [25, '架'], naval_bomber: [25, '架'], strat_bomber: [10, '架'], jet_fighter: [25, '架'],
  multirole: [20, '架'], attack_heli: [20, '架'], drone: [30, '架'], stealth_fighter: [10, '架'], stealth_bomber: [4, '架'], drone_swarm: [200, '架'], spacefighter: [6, '架'],
};
function dispOf(u) { return DISP[u.id] || [1, '个']; }
function dispNum(u, ue) { const v = ue * dispOf(u)[0]; return v >= 1e4 ? fmtNum(v) : v >= 10 ? String(Math.round(v)) : v >= 1 ? v.toFixed(v < 3 ? 1 : 0) : v > 0 ? v.toFixed(2) : '0'; }
// the combat roles a unit counts toward (multi-role aircraft split their strength evenly)
const CROLE = {}; for (const u of UNITS) CROLE[u.id] = u.roles.filter(r => ROLE_OF_DOM[r]);

/* ---------- establishment, quality, stock ---------- */
function capUE(n) {
  const m = n.mult;
  return Math.pow((n.st.pop || 0) + 1, 0.8) * (n.eco ? n.eco.K.mil : 1) * m.manpower * LAW_CAP[lawOf(n)] * (1 + 0.08 * Math.max(0, n.legions || 0)) * PWR_K / UEK;
}
function qualK(n) { const m = n.mult, mx = n.mx; return m.mil * (1 + 0.08 * m.era) * (1 - 0.5 * mx.bombed) * (mx.nukeHit > S.year ? 0.85 : 1); }
// UE per role the nation aims for: the establishment laid out by split × mix (the old milForces shares)
function stockTargets(n, cap) {
  const m = n.mult, mx = n.mx, sp = effSplit(n), T = {};
  for (let d = 0; d < 3; d++) {
    const rs = ROLES[DOMS[d]], mix = mx.mix[DOMS[d]];
    let w = 0; for (const r of rs) if (m.best[r]) w += (mix[r] || 0) + 0.02;
    for (const r of rs) T[r] = m.best[r] && w > 0 ? cap * sp[d] * ((mix[r] || 0) + 0.02) / w : 0;
  }
  return T;
}
function roleStock(n) {
  const R = {}; for (const r in ROLE_OF_DOM) R[r] = 0;
  const st = n.mx.stock || {};
  for (const id in st) { const rs = CROLE[id]; if (rs) for (const r of rs) R[r] += st[id] / rs.length; }
  return R;
}
function stockTotal(n) { let t = 0; const st = n.mx.stock || {}; for (const id in st) t += st[id]; return t; }
function domStock(n) { const D = [0, 0, 0], st = n.mx.stock || {}; for (const id in st) { const u = UNIT_BY_ID[id]; if (u) D[DOM[u.dom]] += st[id]; } return D; }
// a fresh nation (or an old save) starts with a full establishment of its current best models
function initStock(n) {
  const mx = n.mx, T = stockTargets(n, capUE(n)), st = {};
  for (const r in T) if (T[r] > 0) { const id = n.mult.best[r]; st[id] = (st[id] || 0) + T[r]; }
  mx.stock = st; mx.tick = -1;
}
// combat losses: readiness drops (att, recovers by itself) and part of the equipment is destroyed for good
function milHit(n, d, delta, cap) {
  const mx = n.mx; mx.att[d] = Math.min(cap, mx.att[d] + delta);
  stockLoss(n, d, delta * 0.6);
}
function stockLoss(n, d, frac) {
  const st = n.mx.stock; if (!st || frac <= 0) return;
  const dom = DOMS[d];
  for (const id in st) { const u = UNIT_BY_ID[id]; if (u && u.dom === dom) st[id] *= 1 - frac; }
  n.mx.tick = -1;
}

/* ---------- production ---------- */
// production points per year: pm from military factories (land units, aircraft), pd from dockyards (ships);
// a small baseline (militia, smiths, fishing fleets) lets every nation slowly replace losses
function prodCap(n) {
  const era = n.mult.era, mx = n.mx, sat = n.st.sat === undefined ? 1 : n.st.sat, k = (0.35 + 0.65 * sat) * (1 - 0.5 * mx.bombed);
  const mf = n.st.mf || 0, dk = n.st.dock || 0, cap = capUE(n), sp = effSplit(n), base = cap * UCE[era] * 0.03;
  return { mf, dk, cap, pm: mf * UCE[era] * 0.1 * k + base * (1 - sp[1]), pd: dk * UCE[era] * 0.12 * k + base * sp[1] };
}
function unitBuildable(n, u) {
  if (!CROLE[u.id].length || n.techs[u.tech] === undefined) return false;
  if (u.dom === 'sea' && !n.cl.some(c => c.coastal)) return false;
  if (u.dom === 'air' && !n.mult.airOK) return false;
  return true;
}
function prodTick(n) {
  const mx = ensureMil(n); if (!mx.stock) return;
  const m = n.mult, P = prodCap(n), cap = P.cap, st = mx.stock;
  let pm = P.pm, pd = P.pd;
  const give = (u, pts) => { st[u.id] = (st[u.id] || 0) + pts / u.cost; if (u.dom === 'sea') pd -= pts; else pm -= pts; };
  // 1. the player's own orders, first come first served
  if (mx.queue && mx.queue.length) {
    for (const o of mx.queue) {
      const u = UNIT_BY_ID[o.u]; if (!u || o.n <= 0) continue;
      const pool = u.dom === 'sea' ? pd : pm; if (pool <= 0) continue;
      const use = Math.min(pool, o.n * u.cost);
      give(u, use); o.n -= use / u.cost; o.done = (o.done || 0) + use / u.cost;
      if (o.n <= 1e-6 && isPlayer(n) && !booting) showTicker('war', `生产完成：${u.name} ${dispNum(u, o.done)} ${dispOf(u)[1]}`);
    }
    mx.queue = mx.queue.filter(o => o.n > 1e-6 && UNIT_BY_ID[o.u]);
  }
  const auto = !isPlayer(n) || mx.prodAuto !== false;
  if (!auto) { mx.pp = [P.pm, P.pd, P.pm - pm, P.pd - pd]; mx.tick = -1; return; }
  // 2. refill the establishment: deficits per role, production shared in proportion to their cost
  const T = stockTargets(n, cap), cur = roleStock(n), def = [];
  let dm = 0, dd = 0;
  for (const r in T) {
    const g = T[r] - cur[r], u = UNIT_BY_ID[m.best[r]];
    if (g > 1e-3 && u) { def.push([u, g]); if (u.dom === 'sea') dd += g * u.cost; else dm += g * u.cost; }
  }
  const pm0 = pm, pd0 = pd;
  for (const [u, g] of def) {
    const sea = u.dom === 'sea', pool = sea ? pd0 : pm0, tot = sea ? dd : dm;
    if (pool > 0 && tot > 0) give(u, Math.min(pool * g * u.cost / tot, g * u.cost));
  }
  // 3. with production to spare, retire obsolete models (and surplus of roles the mix no longer wants) so the
  //    spare capacity rebuilds them next year as current ones
  if (pm > 1e-6 || pd > 1e-6) {
    const old = [];
    for (const id in st) {
      const u = UNIT_BY_ID[id], rs = CROLE[id]; if (!u || !rs || !rs.length) continue;
      const b = UNIT_BY_ID[m.best[rs[0]]];
      if (b && b.id !== id && u.rating < b.rating * 0.8) old.push([u, b, u.rating / b.rating]);
    }
    old.sort((a, b) => a[2] - b[2]);
    for (const [u, b] of old) {
      const sea = u.dom === 'sea', pool = sea ? pd : pm; if (pool <= 1e-6) continue;
      const x = Math.min(st[u.id] * 0.25, pool / b.cost);
      st[u.id] -= x; if (sea) pd -= x * b.cost; else pm -= x * b.cost;
    }
  }
  // 4. roles the mix no longer wants (and anything over the establishment after cities were lost or the budget
  //    was cut) are stood down gradually, weakest units first
  const cur2 = roleStock(n), byRating = Object.keys(st).sort((a, b) => UNIT_BY_ID[a].rating - UNIT_BY_ID[b].rating);
  for (const r in T) {
    let ex = (cur2[r] - T[r] * 1.1 - 0.05) * 0.2; if (ex <= 0) continue;
    for (const id of byRating) { if (CROLE[id][0] !== r || !(st[id] > 0)) continue; const x = Math.min(st[id], ex); st[id] -= x; ex -= x; if (ex <= 0) break; }
  }
  const total = stockTotal(n);
  if (total > cap * 1.05) {
    let ex = (total - cap * 1.05) * 0.2;
    for (const id of byRating) { if (!(st[id] > 0)) continue; const x = Math.min(st[id], ex); st[id] -= x; ex -= x; if (ex <= 0) break; }
  }
  for (const id in st) if (!(st[id] > 1e-4)) delete st[id];
  mx.pp = [P.pm, P.pd, P.pm - Math.max(0, pm), P.pd - Math.max(0, pd)];
  mx.tick = -1;
}
// player orders: qty in display units ("2 艘航母", "500 辆坦克")
function queueUnit(n, uid, qty) {
  const u = UNIT_BY_ID[uid], mx = ensureMil(n);
  if (!u || !unitBuildable(n, u)) return { ok: false, msg: '现在无法生产这种装备' };
  const ue = Math.max(1e-3, qty / dispOf(u)[0]);
  mx.queue = mx.queue || [];
  const o = mx.queue.find(x => x.u === uid);
  if (o) o.n += ue; else mx.queue.push({ u: uid, n: ue, done: 0 });
  return { ok: true, msg: `已下单：${u.name} ${dispNum(u, ue)} ${dispOf(u)[1]}` };
}
function retireUnit(n, uid, frac) {
  const st = ensureMil(n).stock; if (!st || !st[uid]) return 0;
  const x = st[uid] * clamp(frac, 0, 1); st[uid] -= x; if (st[uid] < 1e-4) delete st[uid];
  n.mx.tick = -1; return x;
}

/* ---------- construction ---------- */
const BLD_KINDS = {
  cf: { name: '民用工厂', slot: 1, lv: 0, cost: 1.0, time: 1.0, desc: '提高这座城市的工业产出：更多税收、出口和商品' },
  mf: { name: '军工厂', old: '军械坊', slot: 1, lv: 0, cost: 1.2, time: 1.0, desc: '生产陆军装备和飞机' },
  dock: { name: '船坞', old: '造船厂', slot: 1, lv: 0, cost: 1.5, time: 1.5, coast: true, desc: '建造舰船' },
  army: { name: '陆军基地', slot: 0, lv: 3, cost: 2.0, time: 1.5, desc: '补给线从这里算起；从这里出发的进攻更有力' },
  navy: { name: '海军基地', slot: 0, lv: 3, cost: 2.5, time: 2.0, coast: true, desc: '附近海域的舰队更强，两栖登陆从这里出发' },
  air: { name: '空军基地', slot: 0, lv: 3, cost: 2.5, time: 1.5, desc: '附近战区的制空权和对地支援更强' },
  fort: { name: '要塞', slot: 0, lv: 3, cost: 1.6, time: 2.0, desc: '这座城市被围攻时更难攻破' },
};
const BLD_ORDER = ['cf', 'mf', 'dock', 'army', 'navy', 'air', 'fort'];
function bldName(k, n) { const K = BLD_KINDS[k]; return K.old && n && n.mult.era < 4 ? K.old : K.name; }
function bldOf(c) { return c.bld || (c.bld = { cf: 0, mf: 0, dock: 0, army: 0, navy: 0, air: 0, fort: 0 }); }
function bget(c, k) { return c.bld ? c.bld[k] || 0 : 0; }
function citySlots(c) { return Math.min(50, 3 + Math.floor(c.pop / 1e6)); }
function slotsUsed(c) { return bget(c, 'cf') + bget(c, 'mf') + bget(c, 'dock'); }
function eraPrice(n) { return 2 * Math.pow(1.55, n.mult.era); }
function bldCount(n, k) { let s = 0; for (const c of n.cl) s += bget(c, k); return s; }
function buildCost(n, k, c) {
  const K = BLD_KINDS[k];
  return 0.5 * K.cost * eraPrice(n) * (1 + 0.01 * bldCount(n, k)) * (K.lv ? 1 + bget(c, k) : 1);
}
function queuedAt(n, c, k) { let q = 0; for (const it of n.bq || []) if (it.c === c.id && (!k || it.k === k)) q++; return q; }
function queuedSlots(n, c) { let q = 0; for (const it of n.bq || []) if (it.c === c.id && BLD_KINDS[it.k].slot) q++; return q; }
// '' when allowed, otherwise the reason
function canBuild(n, c, k) {
  const K = BLD_KINDS[k], m = n.mult;
  if (!K || !c || c.n !== n.id) return '不是本国城市';
  if (K.coast && !c.coastal) return '需要沿海城市';
  if (k === 'cf' && !(m.ind > 0)) return '需要先进入工业时代（蒸汽机）';
  if ((k === 'dock' || k === 'navy') && !hasNavy(m)) return '尚未掌握造船技术';
  if (k === 'air' && !m.airOK) return '尚未掌握军用航空';
  if (K.slot && slotsUsed(c) + queuedSlots(n, c) >= citySlots(c)) return '这座城市的建筑用地已满';
  if (K.lv && bget(c, k) + queuedAt(n, c, k) >= K.lv) return '已经是最高等级';
  return '';
}
function buildConc(n) { return Math.min(6, 1 + Math.floor(((n.st.fac || 0) + (n.st.mf || 0)) / 120)); }
function payBuild(n, cost, treasuryOK) {
  const e = n.eco; if (!e) return true;
  if (e.fund[2] === undefined) e.fund[2] = 0;
  if (e.fund[2] >= cost) { e.fund[2] -= cost; return true; }
  const need = cost - e.fund[2];
  if (treasuryOK && e.treasury - need >= 0.3 * (e.rev || 0)) { e.treasury -= need; e.fund[2] = 0; return true; }
  return false;
}
function queueBuild(n, c, k, times) {
  n.bq = n.bq || [];
  let added = 0, why = '';
  for (let t = 0; t < (times || 1); t++) { why = canBuild(n, c, k); if (why) break; n.bq.push({ c: c.id, k, p: 0, paid: 0 }); added++; }
  if (!added) return { ok: false, msg: why };
  return { ok: true, n: added, msg: `${c.name}：${bldName(k, n)}${added > 1 ? ' ×' + added : ''} 已加入建设队列` };
}
function cancelBuild(n, idx) {
  const it = n.bq && n.bq[idx]; if (!it) return false;
  if (it.paid && n.eco) n.eco.fund[2] = (n.eco.fund[2] || 0) + it.paid * 0.5;
  n.bq.splice(idx, 1); return true;
}
function finishBuild(n, c, k) {
  const b = bldOf(c); b[k] = (b[k] || 0) + 1; c.lay = null;
  if (n.mx) n.mx.tick = -1;
  if (isPlayer(n) && !booting) showTicker('civ', `${c.name}的${bldName(k, n)}${BLD_KINDS[k].lv ? `升到 ${b[k]} 级` : '建成投产'}`);
}
// yearly progress of the build queue: a few projects at a time (more with more industry), each paid when it starts
function buildTick(n) {
  const q = n.bq; if (!q || !q.length) return;
  const conc = buildConc(n), money = isPlayer(n) || warCount(n.id) > 0, slow = n.mult.era < 4 ? 1.5 : 1;
  let act = 0;
  for (let k = 0; k < q.length && act < conc; k++) {
    const it = q[k], c = cityById(it.c);
    if (!c || c.n !== n.id || !BLD_KINDS[it.k]) { q.splice(k--, 1); continue; }
    if (!it.paid) { const cost = buildCost(n, it.k, c); if (!payBuild(n, cost, money)) continue; it.paid = cost; }
    act++;
    it.p += 1 / (BLD_KINDS[it.k].time * slow);
    if (it.p >= 1 - 1e-9) { finishBuild(n, c, it.k); q.splice(k--, 1); }
  }
}
// AI (and the player with 自动建设 on): keep enough military factories to rebuild the establishment in ~15 years,
// dockyards for the navy, civilian factories when developing, and a few bases toward the main rival
function aiBuild(n) {
  if (!n.cl.length || !n.eco) return;
  n.bq = n.bq || [];
  const m = n.mult, conc = buildConc(n);
  if (n.bq.length >= conc) return;
  const cap = capUE(n), war = warCount(n.id) > 0, goal = n.ai ? n.ai.goal : '';
  const qd = k => n.bq.filter(it => it.k === k).length;
  const sp = effSplit(n)[1];
  const enemy = warEnemy(n) || (n.ai && n.ai.target != null && n.ai.target >= 0 ? S.nations[n.ai.target] : null), rival = enemy && enemy.alive && enemy.cl.length ? enemy : null;
  // how many more of each the nation wants right now
  const need = {
    mf: Math.round(cap * 0.6 * (war ? 1.3 : 1) * (goal === 'expand' || goal === 'defend' ? 1.15 : 1)) - (n.st.mf || 0) - qd('mf'),
    dock: sp > 0.02 ? Math.round(cap * sp * 0.5) - (n.st.dock || 0) - qd('dock') : 0,
    cf: m.ind > 0 && (goal === 'industrialize' || goal === 'develop' || goal === 'recover' || rand() < 0.25) ? 2 - qd('cf') : 0,
    army: rival ? 1 + (war ? 1 : 0) - bldCount(n, 'army') - qd('army') : 0,
    navy: sp > 0.1 ? 1 - bldCount(n, 'navy') - qd('navy') : 0,
    air: m.airOK && rival ? 1 - bldCount(n, 'air') - qd('air') : 0,
    fort: goal === 'defend' && rival ? 2 - bldCount(n, 'fort') - qd('fort') : 0,
  };
  // fill the free build slots round-robin, military factories first
  for (let guard = 0; n.bq.length < conc && guard < 12; guard++) {
    let added = false;
    for (const k of ['mf', 'dock', 'cf', 'army', 'navy', 'air', 'fort']) {
      if (need[k] <= 0 || n.bq.length >= conc) continue;
      const c = pickBuildCity(n, k, rival);
      if (c) { n.bq.push({ c: c.id, k, p: 0, paid: 0 }); need[k]--; added = true; } else need[k] = 0;
    }
    if (!added) break;
  }
}
function warEnemy(n) { const w = S.wars.find(x => x.a === n.id || x.b === n.id); return w ? S.nations[w.a === n.id ? w.b : w.a] : null; }
function nearestTo(n, other) { const p = nearestPair(n, other); return p ? p.c : null; }
function pickBuildCity(n, k, rival) {
  const K = BLD_KINDS[k];
  if (K.lv) {
    // bases and forts go to the buildable city nearest the rival (or the capital), bigger cities first on ties
    const anchor = rival ? nearestTo(n, rival) : cityById(n.capital), cands = n.cl.filter(x => !canBuild(n, x, k));
    if (!cands.length) return null;
    return cands.sort((a, b) => (anchor ? cellDist(a.i, anchor.i) - cellDist(b.i, anchor.i) : 0) || b.pop - a.pop)[0];
  }
  // factories: the biggest city with a free slot, away from the front for military factories
  let best = null, bs = -1e18;
  for (const c of n.cl) {
    if (canBuild(n, c, k)) continue;
    let s = c.pop;
    if (k === 'mf' && rival) { const p = nearestPair(rival, { cl: [c] }); s *= p ? Math.min(1, 0.4 + p.d / 40) : 1; }
    if (s > bs) { bs = s; best = c; }
  }
  return best;
}

/* ---------- bases and objectives in war ---------- */
// best level of base kind k among n's cities within range cells of cell
function baseNear(n, k, cell, range) {
  if (cell < 0) return 0;
  let best = 0; for (const c of n.cl) { const L = bget(c, k); if (L > best && cellDist(c.i, cell) <= range) best = L; }
  return best;
}
// distance from the front to the nearest supply hub: the capital, or an army base (each level reaches 8 cells further)
function supplyDist(X, w) {
  const f = w.front; if (f < 0) return 0;
  const cc = capitalCell(X); let d = cc >= 0 ? cellDist(cc, f) : 0;
  for (const c of X.cl) { const L = bget(c, 'army'); if (L) d = Math.min(d, cellDist(c.i, f) - 8 * L); }
  return Math.max(0, d);
}
function minDistTo(n, cell) { let d = 1e9; for (const c of n.cl) { const x = cellDist(c.i, cell); if (x < d) d = x; } return d; }
function setWarObjective(n, w, cityId) {
  if (!w.obj) w.obj = [null, null];
  w.obj[sideOf(w, n)] = cityId;
  const c = cityId == null ? null : cityById(cityId);
  return c ? `主攻方向：${c.name}` : '主攻方向：由前线自行选择';
}
// siege target for the side that won this year's land battle: its objective when within reach, otherwise the enemy
// city within reach that is closest to the objective, otherwise the nearest enemy city (the old behaviour)
function siegeTarget(w, win, lose, reach) {
  const near = nearestPair(lose, win), side = sideOf(w, win), oid = w.obj ? w.obj[side] : null;
  if (oid == null) return near;
  const oc = cityById(oid);
  if (!oc || oc.n !== lose.id) { w.obj[side] = null; return near; }
  const d0 = minDistTo(win, oc.i);
  if (d0 < reach) return { c: oc, d: d0, i: oc.i };
  let best = null, bd = 1e9;
  for (const c of lose.cl) { const d = minDistTo(win, c.i); if (d < reach) { const t = cellDist(c.i, oc.i); if (t < bd) { bd = t; best = { c, d, i: c.i }; } } }
  return best || near;
}
// AI conscription: default in peace, wider when a war goes badly, total when the capital has fallen
function aiLaw(n) {
  const ws = S.wars.filter(w => w.a === n.id || w.b === n.id);
  let L = 1;
  if (ws.length) {
    let net = 0, capLost = false, worse = false;
    for (const w of ws) { const s = sideOf(w, n); net += (w.caps ? w.caps[s] - w.caps[1 - s] : 0); if (w.capLost && w.capLost[s]) capLost = true; const o = S.nations[s === 0 ? w.b : w.a]; if (o && power(o) > power(n) * 1.15) worse = true; }
    L = capLost || net <= -3 ? 3 : (worse || net < 0) && S.year - ws[0].start >= 2 ? 2 : 1;
  }
  setLaw(n, L);
}
// old saves: give every nation its establishment, move the old mobilisation setting to the conscription law
function migrateProd(st) {
  for (const n of st.nations) {
    if (n.mobil && n.law === undefined) n.law = Math.min(3, 1 + n.mobil);
    delete n.mobil;
    if (n.eco && n.eco.fund && n.eco.fund[2] === undefined) n.eco.fund[2] = 0;
  }
}
