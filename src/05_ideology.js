/* =====================================================================
   Ideologies: spread, elections, revolutions, civil wars, puppets
   ===================================================================== */
// x: economic left(-1) .. right(+1); y: libertarian(-1) .. authoritarian(+1)
const IDEO = [
  { id: 'tribal', name: '部落酋邦', short: '部落', color: '#b08d5f', req: null, x: 0, y: 0.3, aggr: 1.0, coop: 0, stab: 0, sci: 1, mil: 1, growth: 1, spread: 0.5, trade: 0.7, suffix: ['部落联盟', '酋邦'], fit: [1, 0.35, 0.08, 0.02, 0, 0, 0, 0, 0], desc: '长老与酋长依照血缘和习俗治理部落。' },
  { id: 'theocracy', name: '神权政体', short: '神权', color: '#e0b84a', req: 'theology', x: 0.2, y: 0.8, aggr: 1.15, coop: -0.05, stab: 0.12, sci: 0.85, mil: 1.05, growth: 1, spread: 1.1, trade: 0.7, suffix: ['神圣国', '教国'], fit: [0, 0.8, 1, 0.6, 0.25, 0.12, 0.08, 0.05, 0.03], desc: '祭司以神的名义统治，信仰即法律。对异教徒发动圣战是神圣的义务。' },
  { id: 'monarchy', name: '君主专制', short: '君主', color: '#9a6ad8', req: 'monarchy', x: 0.4, y: 0.85, aggr: 1.25, coop: 0, stab: 0.1, sci: 1, mil: 1.1, growth: 1, spread: 0.8, trade: 0.8, suffix: ['王国', '帝国'], fit: [0, 0.9, 1, 0.9, 0.5, 0.2, 0.08, 0.04, 0.02], desc: '王权世袭，贵族拱卫，开疆拓土是君王的荣耀。' },
  { id: 'republic', name: '古典共和', short: '共和', color: '#3fb5a3', req: 'republic', x: 0.2, y: 0, aggr: 0.9, coop: 0.1, stab: 0, sci: 1.08, mil: 1, growth: 1, spread: 0.8, trade: 1.1, demo: true, suffix: ['共和国', '城邦共和国'], fit: [0, 0.6, 0.6, 0.6, 0.4, 0.2, 0.1, 0.05, 0.03], desc: '元老院与公民大会共同治理国家。' },
  { id: 'liberal', name: '自由民主', short: '民主', color: '#4a8fe7', req: 'socialcontract', x: 0.5, y: -0.6, aggr: 0.6, coop: 0.25, stab: 0.05, sci: 1.12, mil: 0.95, growth: 1.02, spread: 1.1, trade: 1.35, demo: true, suffix: ['民主共和国', '合众国', '联邦'], fit: [0, 0, 0, 0.5, 0.9, 1, 1, 0.8, 0.6], desc: '选举、法治、市场与个人自由。民主国家之间极少开战。' },
  { id: 'communist', name: '共产主义', short: '共产', color: '#e25555', req: 'marxism', x: -0.9, y: 0.7, aggr: 1.15, coop: 0.05, stab: 0.05, sci: 1.05, mil: 1.1, growth: 1, spread: 1.35, trade: 0.6, suffix: ['人民共和国', '苏维埃联盟'], fit: [0, 0, 0, 0, 0.7, 1, 0.6, 0.35, 0.2], desc: '消灭私有制，由先锋党领导无产阶级革命，并把革命输出到全世界。' },
  { id: 'fascist', name: '法西斯主义', short: '法西斯', color: '#8b5a2b', req: 'propaganda', x: 0.6, y: 1, aggr: 1.9, coop: -0.2, stab: 0.08, sci: 0.95, mil: 1.25, growth: 1, spread: 0.9, trade: 0.5, suffix: ['民族国', '帝国'], fit: [0, 0, 0, 0, 0.5, 0.7, 0.25, 0.1, 0.05], desc: '极端民族主义与领袖崇拜，崇尚扩张与战争。经济危机和战败是它的温床。' },
  { id: 'technocracy', name: '技术官僚', short: '技术', color: '#22c3c3', req: 'ai', x: 0, y: 0.25, aggr: 0.8, coop: 0.2, stab: 0.1, sci: 1.25, mil: 1, growth: 1, spread: 0.9, trade: 1.1, suffix: ['技术联邦', '理事国'], fit: [0, 0, 0, 0, 0, 0, 0.8, 1, 0.8], desc: '由专家与算法决策，效率至上。' },
  { id: 'cosmo', name: '全球联邦', short: '联邦', color: '#9fd25a', req: 'worldgov', x: -0.2, y: -0.45, aggr: 0.45, coop: 0.4, stab: 0.08, sci: 1.15, mil: 0.9, growth: 1, spread: 1.2, trade: 1.4, demo: true, suffix: ['联邦', '联合体'], fit: [0, 0, 0, 0, 0, 0, 0.4, 1, 1], desc: '国界终将消失，全人类组成一个联邦。' },
  { id: 'transhuman', name: '超人类主义', short: '超人类', color: '#f07ad0', req: 'mindupload', x: 0.15, y: -0.25, aggr: 0.9, coop: 0.15, stab: 0, sci: 1.35, mil: 1.05, growth: 0.95, spread: 1.1, trade: 1.2, suffix: ['超人联合体', '升华国'], fit: [0, 0, 0, 0, 0, 0, 0, 0.8, 1], desc: '用科技超越肉体、疾病与死亡。' },
  { id: 'hive', name: '蜂巢集体', short: '蜂巢', color: '#ffae1a', req: 'hivemind', x: -0.6, y: 0.95, aggr: 1.35, coop: 0.1, stab: 0.2, sci: 1.3, mil: 1.15, growth: 1, spread: 1.3, trade: 0.8, suffix: ['蜂巢', '集合体'], fit: [0, 0, 0, 0, 0, 0, 0, 0.2, 1], desc: '个体意识融为一体，集体即是一切。' },
];
const IDEO_BY_ID = Object.fromEntries(IDEO.map(i => [i.id, i]));
const ALL_SUFFIX = [...new Set(IDEO.flatMap(i => i.suffix).concat(['王国', '帝国', '城邦', '部落联盟', '公国', '共和国', '联邦', '合众国', '联合体']))].sort((a, b) => b.length - a.length);
function ideoOf(n) { return IDEO_BY_ID[n.ideo || 'tribal']; }
function ideoDist(a, b) { const A = IDEO_BY_ID[a], Bb = IDEO_BY_ID[b]; return Math.hypot(A.x - Bb.x, A.y - Bb.y) / 2.4; }
function ideoAvailable(n) { return IDEO.filter(i => !i.req || n.techs[i.req] !== undefined); }
function baseName(name) { for (const s of ALL_SUFFIX) if (name.endsWith(s) && name.length > s.length + 1) return name.slice(0, -s.length); return name; }
function regimeName(n, id) { const I = IDEO_BY_ID[id]; return baseName(n.name) + I.suffix[n.id % I.suffix.length]; }
function initIdeology(n, from) {
  n.ideo = from ? from.ideo : 'tribal';
  n.sup = from ? Object.assign({}, from.sup) : { tribal: 1 };
  n.stabV = 0.7; n.ambition = 0.55 + rand() * 0.9; n.bonus = n.bonus || {};
  n.overlord = -1; n.trade = {}; n.nap = {}; n.claims = {}; n.warLoss = 0;
}
function realmOf(id) { const n = S.nations[id]; return n && n.overlord >= 0 && S.nations[n.overlord] && S.nations[n.overlord].alive ? n.overlord : id; }
function puppetsOf(id) { return S.nations.filter(o => o.alive && o.overlord === id); }

function worldIdeoShares() {
  const sh = {}; let tot = 0;
  for (const n of S.nations) if (n.alive) { sh[n.ideo] = (sh[n.ideo] || 0) + n.st.pop; tot += n.st.pop; }
  for (const k in sh) sh[k] /= tot || 1;
  return sh;
}
function ideologyTick() {
  const world = worldIdeoShares(); S.ideoWorld = world;
  const nb = {};
  for (const [a, b, len] of S.borders) { (nb[a] = nb[a] || []).push([b, len]); (nb[b] = nb[b] || []).push([a, len]); }
  for (const n of S.nations) {
    if (!n.alive || !n.cl.length) continue;
    const avail = ideoAvailable(n), e = n.mult.era;
    const pull = {}; let pw = 0;
    for (const [o, len] of nb[n.id] || []) { const O = S.nations[o]; if (!O || !O.alive) continue; const w = Math.min(len, 30) * Math.pow(O.st.pop + 1, 0.25) * O.mult.spread; pull[O.ideo] = (pull[O.ideo] || 0) + w; pw += w; }
    for (const pid in n.trade) { const O = S.nations[pid]; if (O && O.alive) { const w = 12 * O.mult.spread; pull[O.ideo] = (pull[O.ideo] || 0) + w; pw += w; } }
    if (n.overlord >= 0) { const O = S.nations[n.overlord]; if (O && O.alive) { pull[O.ideo] = (pull[O.ideo] || 0) + 40; pw += 40; } }
    const crisis = clamp((1 - n.st.sat) * 0.8 + n.warLoss + (n.famine || 0), 0, 1.5);
    const appeal = {}; let tot = 0;
    for (const I of avail) {
      let a = I.fit[e] + 0.02;
      const ws = world[I.id] || 0;
      a *= 1 + 0.7 * (pw ? (pull[I.id] || 0) / pw : 0) + 0.35 * ws * Math.min(2, n.mult.diff);
      if (ws > 0.6) a *= 1 - 0.35 * (ws - 0.6) / 0.4;
      a *= doct(I.id).vigor;
      if (I.id === n.ideo) a *= (1.25 + 0.35 * n.stabV) * (n.eco ? n.eco.K.prop : 1);
      else a *= 1 + 0.6 * ideoDist(I.id, n.ideo) * (1 - n.stabV);
      if (I.id === 'fascist' || I.id === 'communist') a *= 1 + crisis * 2;
      if (I.id === 'communist' && e >= 4) a *= 1 + 0.6 * clamp(n.st.fac / Math.max(1, n.st.cities) / 2, 0, 1);
      if (I.id === 'fascist') a *= 1 + 0.25 * enemiesOf(n.id).length + n.warLoss;
      if (I.demo && crisis < 0.2) a *= 1.1;
      a *= 1 + (n.push && n.push[I.id] ? n.push[I.id] : 0);
      appeal[I.id] = a; tot += a;
    }
    const rate = 0.04 * Math.min(2, n.mult.spread);
    for (const id in appeal) n.sup[id] = (n.sup[id] || 0) + (appeal[id] / tot - (n.sup[id] || 0)) * rate;
    let s = 0; for (const id in n.sup) { if (!appeal[id]) delete n.sup[id]; else s += n.sup[id]; }
    for (const id in n.sup) n.sup[id] /= s || 1;
    if (n.push) for (const id in n.push) { n.push[id] *= 0.9; if (n.push[id] < 0.02) delete n.push[id]; }
    const rs = n.sup[n.ideo] || 0;
    const target = clamp(0.18 + rs * 0.7 + n.mult.stab * 0.6 - enemiesOf(n.id).length * 0.04 - crisis * 0.25 + (n.golden > 0 ? 0.1 : 0) - clamp((n.cl.length - 25) / 120, 0, 0.25) - 0.2 * (n.occupied || 0) + (n.eco ? n.eco.K.stab : 0), 0, 1);
    n.stabV += (target - n.stabV) * 0.12;
    n.warLoss *= 0.93; n.famine = (n.famine || 0) * 0.9;
    if (!appeal[n.ideo]) { const best = Object.keys(appeal).sort((a, b) => appeal[b] - appeal[a])[0]; setIdeology(n, best, null); }
    regime(n);
  }
}
function topRival(n) { let top = null, ts = 0; for (const id in n.sup) if (id !== n.ideo && n.sup[id] > ts) { ts = n.sup[id]; top = id; } return [top, ts]; }
function regime(n) {
  const rs = n.sup[n.ideo] || 0, [top, ts] = topRival(n);
  if (!top || ts < 0.3 || ts < rs + 0.06) return;
  if (isPlayer(n)) { playerRegimeCrisis(n, top); return; }
  const I = ideoOf(n), J = IDEO_BY_ID[top];
  if (I.demo && J.demo) { setIdeology(n, top, `${n.name}举行大选，${J.name}派赢得执政权`); return; }
  if (I.demo) { if (rand() < 0.15) setIdeology(n, top, `${J.name}势力在${n.name}的选举中胜出，随后修改了宪法`); return; }
  const p = (0.35 * (ts - 0.24) + Math.max(0, 0.2 - rs) * 0.8) * (1.3 - n.stabV);
  if (rand() > p) return;
  if (n.cl.length >= 4 && ts - rs < 0.3 && rand() < 0.5) startCivilWar(n, top);
  else setIdeology(n, top, `${n.name}爆发${J.short}革命，旧政权被推翻`);
}
function setIdeology(n, id, text) {
  if (!id || n.ideo === id) return;
  const old = n.ideo, oldName = n.name;
  n.ideo = id;
  n.sup[id] = Math.max(n.sup[id] || 0, 0.5);
  let s = 0; for (const k in n.sup) s += n.sup[k]; for (const k in n.sup) n.sup[k] /= s;
  const nm = regimeName(n, id);
  if (!S.names[nm]) { delete S.names[n.name]; n.name = nm; S.names[nm] = 1; }
  n.mult = computeMult(n);
  n.stabV = Math.max(0.3, n.stabV - 0.12);
  S.stats.revolutions = (S.stats.revolutions || 0) + 1;
  if (text) log('civ', n.name !== oldName ? `${text}，国号改为「${n.name}」` : text, capitalCell(n), true);
  for (const id2 of n.allies.slice()) { const O = S.nations[id2]; if (O && ideoDist(O.ideo, id) > 0.45 && rand() < 0.5) breakAlliance(n.id, id2, false); }
  techVersion++;
}
function civilName(n, id) {
  const I = IDEO_BY_ID[id];
  for (const pre of ['', '新', '自由', '北', '南', '东', '西', '真']) { const nm = pre + baseName(n.name) + I.suffix[(n.id + 1) % I.suffix.length]; if (!S.names[nm] && nm !== n.name) { S.names[nm] = 1; return nm; } }
  return nationName(4);
}
function startCivilWar(n, id) {
  const cap = cityById(n.capital) || largestCity(n);
  if (!cap) return null;
  const others = n.cl.filter(c => c !== cap);
  if (others.length < 2) { setIdeology(n, id, `${n.name}发生政变，${IDEO_BY_ID[id].name}派夺取政权`); return null; }
  const share = clamp(n.sup[id] || 0.4, 0.25, 0.6);
  const scored = others.map(c => ({ c, s: cellDist(c.i, cap.i) / 30 + (c.origin !== undefined && c.origin !== n.id ? 0.5 : 0) + rand() * 0.6 })).sort((a, b) => b.s - a.s);
  const k = clamp(Math.round(n.cl.length * share), 1, others.length - 1);
  const group = scored.slice(0, k).map(x => x.c);
  const rb = createNation(n.techs);
  delete S.names[rb.name];
  rb.name = civilName(n, id);
  rb.ideo = id; rb.sup = Object.assign({}, n.sup); rb.sup[id] = Math.max(0.55, rb.sup[id] || 0); rb.civilOf = n.id; rb.stabV = 0.55;
  rb.mult = computeMult(rb);
  const core = group.reduce((a, c) => c.pop > a.pop ? c : a);
  for (const c of group) { c.n = rb.id; c.cap = false; }
  core.cap = true; rb.capital = core.id;
  n.cl = n.cl.filter(c => !group.includes(c)); rb.cl = group;
  n.sup[id] = (n.sup[id] || 0) * 0.35; let s = 0; for (const k2 in n.sup) s += n.sup[k2]; for (const k2 in n.sup) n.sup[k2] /= s;
  S.stats.civilWars = (S.stats.civilWars || 0) + 1;
  showBanner('内战爆发', `${n.name}的${ideoOf(n).short}政府 对 ${IDEO_BY_ID[id].short}派的${rb.name}`);
  const w = startWar(n.id, rb.id, true, `${n.name}爆发内战！${IDEO_BY_ID[id].name}派以${core.name}为中心建立${rb.name}`);
  if (w) { w.civil = true; w.dur = 6 + ((rand() * 10) | 0); }
  S.terrDirty = true;
  if (isPlayer(n)) playerCivilWarNotice(n, rb);
  return rb;
}
function endCivilWar(w) {
  const A = S.nations[w.a], Bn = S.nations[w.b];
  if (!A.alive || !Bn.alive) return;
  const sa = power(A) * (1 + w.caps[0] * 0.3), sb = power(Bn) * (1 + w.caps[1] * 0.3);
  const win = sa >= sb ? A : Bn, lose = win === A ? Bn : A, share = sa / (sa + sb || 1);
  if (share > 0.3 && share < 0.7 && rand() < 0.55) { A.civilOf = undefined; Bn.civilOf = undefined; log('war', `${A.name}的内战陷入僵局，双方划线而治：${A.name}与${Bn.name}从此成为两个国家`, capitalCell(Bn), true); return; }
  annexNation(win, lose, `内战结束：${ideoOf(win).name}派获胜，${lose.name}并入${win.name}，国家重归统一`, true);
}
function makePuppet(over, sub, text) {
  if (!over.alive || !sub.alive || over === sub) return;
  for (const w of S.wars.slice()) if (w.a === sub.id || w.b === sub.id) S.wars.splice(S.wars.indexOf(w), 1);
  for (const o of S.nations) o.allies = o.allies.filter(x => x !== sub.id);
  sub.allies = [];
  sub.overlord = over.id; sub.puppetSince = S.year;
  sub.push = sub.push || {}; sub.push[over.ideo] = (sub.push[over.ideo] || 0) + 1;
  log('war', text || `${sub.name}向${over.name}投降，沦为其附庸`, capitalCell(sub), true);
  for (const p of puppetsOf(sub.id)) p.overlord = over.id;
}
function capitulate(win, lose, w) {
  if (!win.alive || !lose.alive) return;
  const small = lose.cl.length <= 3 || power(lose) < power(win) * 0.15;
  const greedy = win.ambition * ideoOf(win).aggr > 1.45;
  if (w && w.civil) { annexNation(win, lose, `内战结束：${ideoOf(win).name}派攻克了对手的首都，国家重归统一`, true); return; }
  if (small || greedy) annexNation(win, lose, `${lose.name}向${win.name}无条件投降，被其吞并`, true);
  else makePuppet(win, lose);
}
function vassalTick() {
  for (const n of S.nations) {
    if (!n.alive || n.overlord < 0) continue;
    const O = S.nations[n.overlord];
    if (!O || !O.alive) { n.overlord = -1; continue; }
    if (S.year - n.puppetSince > 60 && power(O) > power(n) * 1.5 && rand() < 0.06) { annexNation(O, n, `${n.name}被正式并入宗主国${O.name}`, false); continue; }
    if (power(n) > power(O) * 0.9 && rand() < 0.04) { n.overlord = -1; log('war', `${n.name}摆脱了${O.name}的控制，重获独立`, capitalCell(n), true); }
  }
}
let unifiedShown = false;
function unificationCheck() {
  const realms = new Set();
  for (const c of S.cities) realms.add(realmOf(c.n));
  S.realmCount = realms.size;
  if (realms.size === 1 && S.cities.length > 20) {
    const r = S.nations[[...realms][0]];
    if (!S.flags.unified) { S.flags.unified = S.year; log('civ', `世界统一！${r.name}的旗帜飘扬在蓝星的每一座城市`, capitalCell(r), true); showBanner('世界统一', `${r.name}（${ideoOf(r).name}）统一了蓝星`); }
  }
}
