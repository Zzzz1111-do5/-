/* =====================================================================
   Economy and national AI agents
   Every nation is run by its own agent. Each year it reads its situation,
   picks a strategic goal, sets the tax rate, splits the budget by its
   ideology's priorities, builds railways and institutes, and decides on
   war, alliances, trade and mergers. Ideologies rewrite their own
   doctrines when they fall behind.
   ===================================================================== */
const BUD = ['mil', 'sci', 'infra', 'ind', 'welfare', 'prop', 'space'];
const BUD_NAME = { mil: '军费', sci: '科研', infra: '基建', ind: '产业', welfare: '民生', prop: '宣传', space: '航天' };
const BUD_COLOR = { mil: '#e25555', sci: '#3987e5', infra: '#c98500', ind: '#8a8f99', welfare: '#199e70', prop: '#9a6ad8', space: '#d55181' };
// budget priorities per ideology: [mil, sci, infra, ind, welfare, prop, space], base tax rate, market freedom
const DOCTRINE0 = {
  tribal: { w: [0.35, 0.10, 0.15, 0.00, 0.25, 0.15, 0], tax: 0.08, market: 1.0 },
  theocracy: { w: [0.25, 0.10, 0.10, 0.10, 0.15, 0.30, 0], tax: 0.14, market: 0.9 },
  monarchy: { w: [0.35, 0.10, 0.20, 0.10, 0.10, 0.15, 0], tax: 0.15, market: 1.0 },
  republic: { w: [0.20, 0.20, 0.25, 0.15, 0.15, 0.05, 0], tax: 0.12, market: 1.15 },
  liberal: { w: [0.15, 0.22, 0.18, 0.10, 0.22, 0.05, 0.08], tax: 0.22, market: 1.3 },
  communist: { w: [0.22, 0.14, 0.16, 0.30, 0.10, 0.08, 0], tax: 0.40, market: 0.55 },
  fascist: { w: [0.42, 0.08, 0.10, 0.22, 0.03, 0.15, 0], tax: 0.30, market: 0.85 },
  technocracy: { w: [0.10, 0.38, 0.18, 0.14, 0.08, 0, 0.12], tax: 0.25, market: 1.05 },
  cosmo: { w: [0.05, 0.22, 0.15, 0.10, 0.25, 0.05, 0.18], tax: 0.28, market: 1.15 },
  transhuman: { w: [0.10, 0.35, 0.10, 0.12, 0.08, 0, 0.25], tax: 0.20, market: 1.25 },
  hive: { w: [0.22, 0.20, 0.15, 0.28, 0, 0, 0.15], tax: 0.55, market: 0.40 },
};
const SCHOOLS = {
  tribal: ['长老会议', '军事酋邦', '部落联盟'],
  theocracy: ['原教旨主义', '经院神学', '宗教改革派', '世俗化神权', '灵性复兴派'],
  monarchy: ['绝对君主制', '开明专制', '重商主义王权', '君主立宪派'],
  republic: ['贵族共和', '平民共和', '商业共和', '联邦共和'],
  liberal: ['古典自由主义', '凯恩斯主义', '社会民主主义', '新自由主义', '第三条道路'],
  communist: ['马列主义', '战时共产主义', '修正主义', '市场社会主义', '新左翼'],
  fascist: ['国家社团主义', '军国主义', '技术法西斯'],
  technocracy: ['专家委员会', '算法治理', '数据主权派'],
  cosmo: ['联邦主义', '全球民主', '星际宪政'],
  transhuman: ['增强主义', '意识上传派', '后人类共识'],
  hive: ['统一意志', '分布式意识', '星海之心'],
};
const GOAL_NAME = { expand: '扩张', defend: '自保', develop: '科技立国', industrialize: '工业化', stabilize: '维稳', spread: '输出思想', colonize: '星辰大海', unify: '寻求联合', recover: '休养生息' };
let aiVersion = 0;
const pctS = v => Math.round(v * 100) + '%';

function doct(id) {
  if (!S.doct) S.doct = {};
  let d = S.doct[id];
  if (!d) { const b = DOCTRINE0[id] || DOCTRINE0.tribal; d = S.doct[id] = { w: b.w.slice(), tax: b.tax, market: b.market, ver: 0, school: (SCHOOLS[id] || ['正统'])[0], vigor: 1, hist: [], note: '' }; }
  return d;
}
function normW(w) { let s = 0; for (const v of w) s += Math.max(0, v); for (let k = 0; k < w.length; k++) w[k] = s ? Math.max(0, w[k]) / s : 1 / w.length; return w; }
function ensureEco(n) {
  if (!n.eco) {
    const d = doct(n.ideo);
    n.eco = { tax: d.tax, treasury: 0, gdp: 0, exp: 0, will: 1, rev: 0, spend: 0, alloc: d.w.slice(), stock: [0, 0, 0, 0, 0, 0, 0], lv: [1, 1, 1, 1, 1, 1, 1], fund: [0, 0], K: { mil: 1, sci: 1, ind: 1, infra: 1, stab: 0, prop: 1, space: 1, wel: 1 }, rails: 0, railCov: 0, inst: 0, hist: [], init: 0, snap: null };
  }
  if (!n.ai) n.ai = { goal: 'develop', since: S.year, target: -1, prep: 0, weary: 0, log: [], grudge: {}, persona: { zeal: 0.5 + rand(), caution: 0.5 + rand(), coop: 0.5 + rand() }, advice: '' };
  return n.eco;
}
function think(n, text, feed) {
  const a = n.ai; if (!a) return;
  a.log.unshift({ y: S.year, t: text }); if (a.log.length > 8) a.log.length = 8;
  if (feed !== false) { if (!S.aiFeed) S.aiFeed = []; S.aiFeed.unshift({ y: S.year, n: n.id, t: text }); if (S.aiFeed.length > 40) S.aiFeed.length = 40; }
  aiVersion++;
}

/* ---------- national accounts ---------- */
// GDP = labour output + industry, scaled by how willing private enterprise is to invest, plus exports.
// Tax revenue = tax rate × GDP × compliance. Enterprise willingness falls with the tax rate (Laffer),
// rises with market freedom, stability and trade, and drops in wartime.
function econTick(n) {
  const e = ensureEco(n), m = n.mult, d = doct(n.ideo), era = m.era;
  const pop = n.st.pop, fac = n.st.fac, pm = Math.max(0.05, pop / 1e6);
  let trade = 0; for (const id in n.trade) if (S.nations[id] && S.nations[id].alive) trade++;
  let coast = 0; for (const c of n.cl) if (c.coastal) coast++; coast /= Math.max(1, n.cl.length);
  const war = enemiesOf(n.id).length;
  const prodPerM = 2 * Math.pow(1.55, era) * (1 + 0.5 * Math.min(1.5, fac / pm / 2.5)) * (1 + 0.25 * e.railCov);
  const L = pm * prodPerM, I = fac * 3 * Math.pow(1.2, Math.max(0, era - 4)) * n.st.sat;
  const W = clamp(d.market * Math.pow((1 - e.tax) / 0.82, 1.5) * (0.55 + 0.6 * n.stabV) * (war ? 0.85 : 1) * (1 + 0.08 * Math.min(4, trade)), 0.15, 2);
  const mx = ensureMil(n);
  if (!war) mx.block *= 0.8;
  // exports are cut by submarine raiding and blockade; strategic bombing wrecks output
  const X = (I * 0.25 + L * 0.05) * ideoOf(n).trade * (1 + 0.15 * Math.min(5, trade) + 0.3 * coast) * (1 + 0.3 * e.railCov) * (1 - mx.block);
  const Y = ((L + I) * (0.6 + 0.4 * W) + X * W) * (1 - 0.25 * mx.block - 0.3 * mx.bombed);
  const R = e.tax * Y * (0.65 + 0.35 * n.stabV);
  e.will = W; e.exp = X; e.gdp = Y; e.rev = R;
  let spend = R * 0.95 + Math.max(0, e.treasury - 2 * R) * 0.25;
  if (war && e.treasury > 0) spend += Math.min(e.treasury, R * 0.3);
  e.treasury = Math.max(0, e.treasury + R - spend);
  e.spend = spend;
  const a = e.alloc.slice(); if (!m.space) a[6] = 0; normW(a);
  const ref = Math.max(1e-6, Y * 0.18 / 7);
  if (!e.init) { for (let k = 0; k < 7; k++) e.stock[k] = 20 * spend * a[k]; e.init = 1; }
  for (let k = 0; k < 7; k++) { e.stock[k] = e.stock[k] * 0.95 + spend * a[k]; e.lv[k] = e.stock[k] / (20 * ref); }
  e.fund[0] += spend * a[2] * 0.35; e.fund[1] += spend * a[1] * 0.25;
  if (S.tick % 3 === n.id % 3) buildProjects(n);
  const L3 = k => Math.min(3, e.lv[k]);
  e.K.mil = 0.75 + 0.25 * L3(0);
  e.K.sci = 0.8 + 0.2 * L3(1);
  e.K.infra = 1 + 0.03 * (L3(2) - 1) + 0.05 * e.railCov;
  e.K.ind = (0.85 + 0.15 * L3(3)) * (0.85 + 0.15 * W);
  e.K.stab = clamp(0.05 * (L3(4) - 1) + 0.03 * (L3(5) - 1) - Math.max(0, e.tax - d.tax - 0.05) * 0.6, -0.15, 0.12);
  e.K.prop = 1 + 0.15 * (L3(5) - 1);
  e.K.space = 0.5 + 0.5 * L3(6);
  e.K.wel = 1 + 0.02 * (L3(4) - 1);
  if (S.year % 5 === 0) { e.hist.push(Math.round(Y)); if (e.hist.length > 16) e.hist.shift(); }
}
function railKey(a, b) { return a < b ? a + ':' + b : b + ':' + a; }
const WET = new Map();
function linkWet(c, o) {
  const k = railKey(c.id, o.id) + '|' + ((S.seaRise * 1000) | 0) + '|' + S.terra.length;
  let v = WET.get(k);
  if (v === undefined) { const [cx, cy] = cityMpx(c), [ox, oy] = cityMpx(o); let wet = 0; for (let s = 1; s < 8; s++) if (!landAt(cx + wrapDx(ox - cx) * s / 8, cy + (oy - cy) * s / 8)) wet++; v = wet > 1; if (WET.size > 4000) WET.clear(); WET.set(k, v); }
  return v;
}
function buildProjects(n) {
  const e = n.eco, m = n.mult;
  if (!S.rails) S.rails = {};
  // railways along the existing road network, growing outward from the capital
  if (m.rail) {
    const own = new Set(n.cl.map(c => c.id)), byId = new Map(n.cl.map(c => [c.id, c]));
    const onNet = new Set(); const cap = cityById(n.capital); if (cap) onNet.add(cap.id);
    let have = 0;
    for (const c of n.cl) for (const id of c.links) if (own.has(id) && S.rails[railKey(c.id, id)]) { onNet.add(c.id); onNet.add(id); if (c.id < id) have++; }
    e.railCov = clamp(have / Math.max(1, n.cl.length - 1), 0, 1); e.rails = have;
    let best = null, bc = 1e18;
    for (const c of n.cl) for (const id of c.links) {
      if (!own.has(id) || c.id > id || S.rails[railKey(c.id, id)]) continue;
      const o = byId.get(id), dist = cellDist(c.i, o.i);
      if (linkWet(c, o)) continue;
      const score = dist * (onNet.has(c.id) || onNet.has(id) ? 1 : 2.5);
      if (score < bc) { bc = score; best = [c, o, dist]; }
    }
    if (best) {
      const cost = e.gdp * 0.012 * Math.max(2, best[2]) / 4;
      if (e.fund[0] >= cost) {
        e.fund[0] -= cost; S.rails[railKey(best[0].id, best[1].id)] = { n: n.id, y: S.year }; e.rails++; e.railCov = clamp(e.rails / Math.max(1, n.cl.length - 1), 0, 1);
        if (!S.firsts.rail_built) { S.firsts.rail_built = { n: n.id, y: S.year, name: n.name }; log('tech', `${n.name}的第一条铁路通车：${best[0].name}—${best[1].name}`, best[0].i, true); }
        if (e.rails % 5 === 1) think(n, `修建${best[0].name}—${best[1].name}铁路（全国已有 ${e.rails} 段）`, false);
      } else e.fund[0] = Math.min(e.fund[0], cost * 3);
    } else e.fund[0] = Math.min(e.fund[0], e.gdp * 0.02);
  } else e.fund[0] = Math.min(e.fund[0], e.gdp * 0.02);
  // research institutes in the biggest under-served city
  let inst = 0; for (const c of n.cl) inst += c.inst || 0; e.inst = inst;
  const costI = e.gdp * 0.08 * (1 + 2 * inst / Math.max(1, n.cl.length));
  if (m.era >= 1 && e.fund[1] >= costI) {
    let best = null, bs = -1;
    for (const c of n.cl) { const inst = c.inst || 0; if (inst >= 5) continue; const s = c.pop / (1 + inst * 2); if (s > bs) { bs = s; best = c; } }
    if (best) {
      best.inst = (best.inst || 0) + 1; best.lay = null; e.inst++; e.fund[1] -= costI;
      const nm = m.era < 3 ? '学宫' : m.era < 5 ? '大学' : m.era < 7 ? '国家实验室' : '超级研究院';
      if (best.inst === 1 || e.inst % 4 === 0) think(n, `在${best.name}兴建${nm}（第 ${best.inst} 座）`, false);
    }
  } else e.fund[1] = Math.min(e.fund[1], costI * 3);
}

/* ---------- the agents ---------- */
function canPlay(a, b) {
  const key = trustKey(a.id, b.id);
  if ((S.gcd[key] || -1e9) > S.year) return false;
  if ((isPlayer(a) || isPlayer(b)) && (modalOpen || (S.player.gcd || -1e9) > S.year)) return false;
  return true;
}
function agentGame(type, a, b, ctx) {
  if (!canPlay(a, b)) return null;
  S.gcd[trustKey(a.id, b.id)] = S.year + 6;
  if (isPlayer(a) || isPlayer(b)) S.player.gcd = S.year + secYears(25);
  return playGame(type, a.id, b.id, ctx || {});
}
function aiAssess(n) {
  const my = Math.max(1, power(n)), nb = neighborNations(n);
  let threat = null, tr = 0, prey = null, ps = 0;
  for (const o of nb) {
    if (realmOf(o.id) === realmOf(n.id)) continue;
    const po = power(o), ratio = po / my, gr = (n.ai.grudge && n.ai.grudge[o.id]) || 0;
    const host = (atWar(n.id, o.id) ? 2 : 0) + ideoDist(n.ideo, o.ideo) + (1 - getTrust(n.id, o.id)) + gr;
    const t = ratio * host * ideoOf(o).aggr * o.ambition;
    if (t > tr) { tr = t; threat = o; }
    if (!allied(n.id, o.id) && !hasNap(n, o) && o.overlord < 0 && o.cl.length) {
      const s = (1 / Math.max(0.2, ratio) - 1) * (1 + ideoDist(n.ideo, o.ideo)) * (1 + gr) + (o.civilOf === n.id ? 1 : 0);
      if (s > ps) { ps = s; prey = o; }
    }
  }
  let lead = 0; for (const o of S.nations) if (o.alive && o.mult.count > lead) lead = o.mult.count;
  const wars = S.wars.filter(w => w.a === n.id || w.b === n.id);
  const same = n.mult.era >= 5 ? nb.find(o => o.ideo === n.ideo && o.overlord < 0 && getTrust(n.id, o.id) > 0.55 && !isPlayer(o)) : null;
  let wp = 0, top = null; for (const o of S.nations) if (o.alive && o.cl.length) { const p = power(o); wp += p; if (!top || p > power(top)) top = o; }
  const hegemon = top && power(top) > wp * 0.4 && nb.includes(top) ? top : null;
  if (hegemon && hegemon !== n && !threat) threat = hegemon;
  let occ = 0; for (const c of n.cl) if (c.origin !== undefined && c.origin !== n.id && S.year - (c.capturedAt || -1e9) < 80) occ++;
  return { my, threat, tr, prey, ps, gap: lead - n.mult.count, wars, same, nb, hegemon, occupied: occ / Math.max(1, n.cl.length) };
}
function chooseGoal(n, A) {
  const I = ideoOf(n), P = n.ai.persona, d = doct(n.ideo), m = n.mult;
  const U = {
    expand: A.prey ? n.ambition * I.aggr * Math.min(3, A.ps) * 0.55 * Math.min(1, m.peace) * (1 - n.ai.weary) * (A.wars.length ? 0.3 : 1) / (1 + n.cl.length / 30) * (n.stabV > 0.5 ? 1 : 0.5) * (1 - 0.6 * (A.occupied || 0)) : 0,
    defend: (A.tr > 1 ? Math.min(3, A.tr - 0.6) * P.caution * 0.5 : 0) + (A.hegemon && A.hegemon !== n ? 0.5 * P.caution : 0),
    develop: 0.35 + A.gap * 0.05 + d.w[1],
    industrialize: m.ind > 0 ? 0.25 + Math.max(0, 1 - n.st.fac / Math.max(0.1, n.st.pop / 1e6)) * 0.6 : 0,
    stabilize: Math.max(0, 0.6 - n.stabV) * 4,
    spread: A.nb.some(o => ideoDist(o.ideo, n.ideo) > 0.3) ? (I.spread * P.zeal - 0.7) * 0.8 : 0,
    colonize: m.space ? 0.45 + d.w[6] * 2.5 : 0,
    unify: A.same ? 0.35 + I.coop + m.unionK * 0.3 : 0,
    recover: A.wars.length ? 0 : n.ai.weary * 1.3,
  };
  if (A.wars.some(w => w.b === n.id && !w.civil)) U.defend += 0.8;
  if (U[n.ai.goal] > 0) U[n.ai.goal] += 0.12;
  let g = 'develop', best = -1; for (const k in U) if (U[k] > best) { best = U[k]; g = k; }
  return g;
}
function goalReason(n, g, A) {
  const I = ideoOf(n);
  switch (g) {
    case 'expand': if (!A.prey) return '寻找扩张的机会'; return `${A.prey.name}的军力只有我们的 ${pctS(power(A.prey) / A.my)}${ideoDist(n.ideo, A.prey.ideo) > 0.3 ? `，而且奉行${ideoOf(A.prey).short}` : ''}，扩军备战`;
    case 'defend': if (!A.threat) return '国土遭到入侵，全力抵抗'; return `${A.threat.name}虎视眈眈（军力是我们的 ${(power(A.threat) / A.my).toFixed(1)} 倍），加强国防`;
    case 'develop': return A.gap > 2 ? `科技落后领先者 ${A.gap} 项，加大科研投入` : '把资源投向大学与实验室';
    case 'industrialize': return '工厂太少，补贴工业，建设基础设施';
    case 'stabilize': return `国内稳定度跌到 ${pctS(n.stabV)}，增加民生与宣传开支`;
    case 'spread': return `${I.name}应当传遍世界，增加宣传与渗透`;
    case 'colonize': return '人类的未来在群星之间，增加航天预算';
    case 'unify': if (!A.same) return '寻找可以合并的盟友'; return `与同为${I.short}的${A.same.name}商谈合并`;
    case 'recover': return '连年征战，国力疲惫，休养生息';
  }
  return '';
}
const GOAL_ADJ = { expand: [[0, 0.15]], defend: [[0, 0.18]], develop: [[1, 0.15]], industrialize: [[3, 0.12], [2, 0.06]], stabilize: [[4, 0.12], [5, 0.06]], spread: [[5, 0.15]], colonize: [[6, 0.2]], unify: [[5, 0.04], [4, 0.04]], recover: [[4, 0.1], [2, 0.05]] };
function aiBudget(n, A, speak) {
  const e = n.eco, d = doct(n.ideo), w = d.w.slice();
  for (const [k, v] of GOAL_ADJ[n.ai.goal] || []) w[k] += v;
  if (A.wars.length) w[0] += 0.12;
  if (!n.mult.space) w[6] = 0;
  normW(w);
  for (let k = 0; k < 7; k++) e.alloc[k] += (w[k] - e.alloc[k]) * 0.35;
  normW(e.alloc);
  let tt = d.tax + (A.wars.length ? 0.06 : 0) + (e.treasury < e.rev * 0.5 ? 0.02 : 0) - (n.stabV < 0.45 ? 0.04 : 0);
  tt = clamp(tt, 0.04, 0.7);
  if (Math.abs(tt - e.tax) > 0.025) {
    const old = e.tax; e.tax = clamp(e.tax + Math.sign(tt - e.tax) * 0.02, 0.03, 0.75);
    if (speak && rand() < 0.35) think(n, `税率 ${pctS(old)} → ${pctS(e.tax)}${A.wars.length ? '，为战争筹款' : n.stabV < 0.45 ? '，减轻民众负担' : ''}`, false);
  }
}
function warPicture(n, w) {
  const side = w.a === n.id ? 0 : 1, o = S.nations[side === 0 ? w.b : w.a];
  return { o, net: w.caps[side] - w.caps[1 - side], ratio: theatrePower(n, w) / Math.max(1, theatrePower(o, w)), age: S.year - w.start };
}
function agentThink(n) {
  const A = aiAssess(n), ai = n.ai;
  ai.weary = clamp(ai.weary + (A.wars.length ? 0.05 : -0.03), 0, 1);
  for (const k in ai.grudge) { ai.grudge[k] *= 0.97; if (ai.grudge[k] < 0.02) delete ai.grudge[k]; }
  const g = chooseGoal(n, A);
  if (g !== ai.goal) { ai.goal = g; ai.since = S.year; ai.prep = 0; think(n, `新战略「${GOAL_NAME[g]}」：${goalReason(n, g, A)}`); }
  ai.target = g === 'expand' && A.prey ? A.prey.id : g === 'defend' && A.threat ? A.threat.id : g === 'unify' && A.same ? A.same.id : -1;
  aiBudget(n, A, true);
  milThink(n, A);
  // losing wars: sue for peace
  for (const w of A.wars) {
    if (w.civil) continue;
    const p = warPicture(n, w);
    if (p.age > 4 && (p.net <= -2 || (p.net < 0 && p.ratio < 0.6)) && rand() < 0.3) {
      if (isPlayer(p.o)) { if (!modalOpen && (!w.offered || S.year - w.offered > secYears(20))) { w.offered = S.year; aiPeaceOffer(w); } }
      else { makePeace(n.id, p.o.id, `${n.name}战局不利（丢失 ${-p.net} 座城市），向${p.o.name}求和`); think(n, `战局不利，向${p.o.name}求和`); }
      return;
    }
  }
  const m = n.mult;
  switch (g) {
    case 'expand': {
      const T = A.prey; if (!T || warCount(n.id) >= 2 || atWar(n.id, T.id)) break;
      ai.prep++;
      if (ai.prep < 2) break;
      const pr = nearestPair(T, n);
      if (pr && pr.d < 9 && T.cl.length > 1 && rand() < 0.35 && agentGame('crisis', n, T, { city: pr.c.id, v: 1 + Math.min(3, Math.log10(pr.c.pop / 1e5 + 1) * 1.5) })) { think(n, `向${T.name}施压，索要${pr.c.name}`); break; }
      let p = 0.3 * clamp(A.ps / 2, 0.15, 1) * Math.min(1, m.peace) * [0.3, 0.5, 0.7, 0.9, 1, 0.9, 0.6, 0.45, 0.4][m.era];
      p *= nukeWarK(n, T);
      // a prey across the sea needs a fleet first (and landing craft in the modern era)
      if (overseasPair(n, T)) {
        const F = milForces(n), FT = milForces(T);
        if ((FT.S > 0 && F.S < FT.S * 0.8) || (m.era >= 5 && !m.amphib)) {
          if (!(n.mx.prepSea > S.year)) { n.mx.prepSea = S.year + 20; think(n, `${T.name}远在海外，先扩建舰队${m.era >= 5 && !m.amphib ? '、研制登陆艇' : ''}，为渡海进攻做准备`); }
          p *= 0.25;
        }
      }
      if (ideoOf(n).demo && ideoOf(T).demo) p *= 0.2;
      if (rand() < p) {
        const dist = ideoDist(n.ideo, T.ideo);
        const why = n.ideo === 'theocracy' && dist > 0.2 ? '讨伐异端' : (n.ideo === 'communist' || n.ideo === 'hive') && dist > 0.3 ? '解放被压迫的人民' : n.ideo === 'fascist' ? '为民族争夺生存空间' : T.civilOf === n.id ? '收复叛乱的国土' : (ai.grudge[T.id] || 0) > 0.3 ? '报仇雪恨' : '开疆拓土';
        const w = startWar(n.id, T.id, false, `${n.name}向${T.name}宣战，理由：${why}`);
        if (w) { think(n, `${T.name}的军力只有我们的 ${pctS(power(T) / A.my)}，宣战（${why}）`); ai.prep = 0; T.ai && (T.ai.grudge[n.id] = Math.min(1, (T.ai.grudge[n.id] || 0) + 0.4)); }
      }
      break;
    }
    case 'defend': {
      const T = A.threat; if (!T) break;
      const cand = A.nb.filter(o => o !== T && !allied(n.id, o.id) && !atWar(n.id, o.id) && o.overlord < 0 && getTrust(n.id, o.id) > 0.3).sort((a, b) => getTrust(n.id, b.id) - getTrust(n.id, a.id))[0]
        || S.nations.filter(o => o.alive && o.cl.length && o !== n && o !== T && !allied(n.id, o.id) && enemiesOf(T.id).includes(o.id))[0];
      if (cand && rand() < 0.5 && agentGame('alliance', n, cand, { threat: 1 + Math.min(2, A.tr / 2) })) think(n, `为对抗${T.name}，向${cand.name}提议共同防御`);
      else if (rand() < 0.15 && !hasNap(n, T) && !atWar(n.id, T.id) && !isPlayer(T)) { if (getTrust(n.id, T.id) * (1.4 - T.ambition * ideoOf(T).aggr * 0.5) > 0.3) { n.nap[T.id] = T.nap[n.id] = S.year + 30; think(n, `与${T.name}签订互不侵犯条约，争取时间`); } }
      break;
    }
    case 'develop': case 'industrialize': case 'recover': {
      if (m.era < 1) break;
      const cand = A.nb.concat(S.nations.filter(o => o.alive && o.cl.length && o !== n && (o.trade || {})[n.id] === undefined)).filter(o => o !== n && !atWar(n.id, o.id) && !(n.trade || {})[o.id]).sort((a, b) => getTrust(n.id, b.id) - getTrust(n.id, a.id))[0];
      if (cand && rand() < 0.4 && agentGame('trade', n, cand)) think(n, `向${cand.name}提议自由贸易`, false);
      else if (m.era >= 3 && rand() < 0.2) { const r = A.nb.find(o => !atWar(n.id, o.id) && power(o) > A.my * 0.6); if (r && agentGame('arms', n, r)) think(n, `与${r.name}进行军备谈判`, false); }
      break;
    }
    case 'spread': {
      const T = A.nb.filter(o => ideoDist(o.ideo, n.ideo) > 0.3 && !atWar(n.id, o.id)).sort((a, b) => b.st.pop - a.st.pop)[0];
      if (T && rand() < 0.5 && agentGame('ideology', n, T)) think(n, `向${T.name}输出${ideoOf(n).short}思想`);
      break;
    }
    case 'unify': {
      if (A.same && rand() < 0.4 && agentGame('union', n, A.same)) think(n, `与${A.same.name}举行合并谈判`);
      break;
    }
    case 'stabilize': {
      if (n.stabV < 0.3 && rand() < 0.2) { const [riv] = topRival(n); if (riv) { n.sup[riv] *= 0.85; let s = 0; for (const k in n.sup) s += n.sup[k]; for (const k in n.sup) n.sup[k] /= s; think(n, `镇压${IDEO_BY_ID[riv].short}派的集会`, false); } }
      break;
    }
  }
}
function aiAdvise(n) {
  const A = aiAssess(n), g = chooseGoal(n, A);
  const txt = `${GOAL_NAME[g]}：${goalReason(n, g, A)}`;
  if (txt !== n.ai.advice) { n.ai.advice = txt; aiVersion++; }
  n.ai.weary = clamp(n.ai.weary + (A.wars.length ? 0.05 : -0.03), 0, 1);
  if (S.player && S.player.autoBudget) { n.ai.goal = g; aiBudget(n, A, true); }
  if (ensureMil(n).auto) milThink(n, A);
}
function aiTick() {
  if (!S.aiFeed) S.aiFeed = [];
  for (const n of S.nations) {
    if (!n.alive || !n.cl.length) continue;
    ensureEco(n);
    econTick(n);
    if ((S.tick + n.id) % 4) continue;
    if (isPlayer(n)) { aiAdvise(n); continue; }
    if (n.overlord >= 0) { const A = aiAssess(n); n.ai.goal = 'develop'; aiBudget(n, A, false); milThink(n, A); continue; }
    agentThink(n);
  }
}

/* ---------- occupation unrest & balance of power ---------- */
// Recently conquered cities resent their occupiers: they may defect back to their old country or break away.
function unrestTick() {
  for (const n of S.nations) {
    if (!n.alive || n.cl.length < 4 || isPlayer(n)) continue;
    let occ = 0; for (const c of n.cl) if (c.origin !== undefined && c.origin !== n.id && S.year - (c.capturedAt || -1e9) < 80) occ++;
    n.occupied = occ / n.cl.length;
    if (!occ) continue;
    for (const c of n.cl.slice()) {
      if (c.cap || c.origin === undefined || c.origin === n.id || S.year - (c.capturedAt || -1e9) >= 80) continue;
      const p = 0.012 * (1.25 - n.stabV) * (1 + n.cl.length / 50) * (1 + n.occupied);
      if (rand() > p) continue;
      const O = S.nations[c.origin];
      if (O && O.alive && O.cl.length && !atWar(n.id, O.id) && nearestPair(O, n) && nearestPair(O, n).d < 12) { transferCity(c, O, n); log('war', `${c.name}的民众赶走了${n.name}的驻军，重归${O.name}`, c.i, false); }
      else if (n.cl.length > 3) { const nn = splitFrom(c, false); if (nn) nn.name && log('war', `被占领的${c.name}发动起义，建立了${nn.name}`, c.i, false); }
      break;
    }
  }
}
// When one power grows too strong, its neighbours gang up on it.
function balanceOfPower(w) {
  const A = S.nations[w.a], Bn = S.nations[w.b]; if (!A || !Bn) return;
  let wp = 0; for (const o of S.nations) if (o.alive && o.cl.length) wp += power(o);
  if (power(A) < wp * 0.35) return;
  for (const o of S.nations) {
    if (!o.alive || !o.cl.length || o === A || o === Bn || isPlayer(o) || atWar(o.id, A.id) || allied(o.id, A.id) || o.overlord >= 0 || warCount(o.id) >= 2) continue;
    if (!(o.ai && (o.ai.goal === 'defend' || o.ai.target === A.id)) || rand() > 0.45) continue;
    if (!neighborNations(o).includes(A)) continue;
    joinWar(o.id, A.id, Bn);
    think(o, `${A.name}已成霸权，加入${Bn.name}一方对抗它`);
  }
}

/* ---------- ideologies rewrite themselves ---------- */
// Every 20 years each ideology is judged by how its countries did: growth of output per head,
// change in share of world power, and stability. Laggards borrow from the best performer
// (with some random mutation) and become a new school; winners grow more confident.
function doctrineTick() {
  milDoctrineTick();
  const alive = S.nations.filter(n => n.alive && n.cl.length && n.eco);
  let wp = 0; for (const n of alive) wp += power(n);
  const agg = {};
  for (const n of alive) {
    const e = n.eco, now = { gdp: e.gdp, pop: n.st.pop, pw: power(n) / Math.max(1, wp) };
    if (e.snap && e.snap.pop > 0 && e.snap.gdp > 0) {
      const g = Math.log(Math.max(1e-6, now.gdp / Math.max(1, now.pop)) / Math.max(1e-6, e.snap.gdp / e.snap.pop));
      const p = Math.log(Math.max(1e-4, now.pw) / Math.max(1e-4, e.snap.pw));
      const score = g + 0.5 * clamp(p, -1, 1) + 0.3 * (n.stabV - 0.5);
      const wgt = Math.sqrt(n.st.pop + 1), a = agg[n.ideo] = agg[n.ideo] || { s: 0, w: 0, n: 0 };
      a.s += score * wgt; a.w += wgt; a.n++;
    }
    e.snap = now;
  }
  const ids = Object.keys(agg).filter(k => agg[k].w > 0);
  if (ids.length < 1) return;
  for (const k of ids) agg[k].v = agg[k].s / agg[k].w;
  let mean = 0, tw = 0; for (const k of ids) { mean += agg[k].v * agg[k].w; tw += agg[k].w; } mean /= tw || 1;
  const bestId = ids.slice().sort((a, b) => agg[b].v - agg[a].v)[0];
  for (const id of ids) {
    const d = doct(id), I = IDEO_BY_ID[id], rel = agg[id].v - mean;
    if (ids.length > 1 && id !== bestId && rel < -0.08 && S.year - (d.lastRef || -1e9) >= 60 && rand() < 0.4) {
      d.lastRef = S.year;
      const B = doct(bestId), before = d.w.slice(), oldTax = d.tax;
      for (let k = 0; k < 7; k++) d.w[k] = d.w[k] * 0.7 + B.w[k] * 0.3 + (rand() - 0.5) * 0.06;
      normW(d.w);
      d.tax = clamp(d.tax * 0.7 + B.tax * 0.3 + (rand() - 0.5) * 0.03, 0.05, 0.6);
      d.market = clamp(d.market * 0.75 + B.market * 0.25 + (rand() - 0.5) * 0.06, 0.3, 1.5);
      d.ver++;
      const list = SCHOOLS[id] || ['正统'];
      d.school = d.ver < list.length ? list[d.ver] : `新${list[list.length - 1]}`;
      d.vigor = 1.2;
      const diff = BUD.map((b, k) => [b, d.w[k] - before[k]]).sort((x, y) => Math.abs(y[1]) - Math.abs(x[1])).slice(0, 2).map(([b, v]) => `${BUD_NAME[b]}${v > 0 ? '↑' : '↓'}`).join('、');
      d.note = `向${IDEO_BY_ID[bestId].short}取经：${diff}，税率 ${pctS(oldTax)} → ${pctS(d.tax)}`;
      d.hist.unshift({ y: S.year, school: d.school, note: d.note }); if (d.hist.length > 8) d.hist.length = 8;
      log('civ', `思潮迭代：${I.name}进入「${d.school}」阶段（${d.note}）`, -1, true);
      for (const n of alive) if (n.ideo === id && n.ai && !isPlayer(n)) think(n, `本国接受${d.school}路线：${diff}`, false);
    } else if (rel > 0.04) {
      d.vigor = Math.min(1.45, d.vigor + 0.1);
      const top = d.w.indexOf(Math.max(...d.w)); d.w[top] += 0.02; normW(d.w);
      if (rand() < 0.3) { d.note = `「${d.school}」路线被证明成功，影响力上升`; d.hist.unshift({ y: S.year, school: d.school, note: d.note }); if (d.hist.length > 8) d.hist.length = 8; }
    }
  }
  aiVersion++;
}
function doctrineDecay() { if (!S.doct) return; for (const k in S.doct) { const d = S.doct[k]; d.vigor += (1 - d.vigor) * 0.03; } }
