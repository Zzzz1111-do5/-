/* =====================================================================
   Leader mode: play one civilization (national focuses, decisions,
   diplomacy, game-theory choices, peace conferences, victory)
   ===================================================================== */
function isPlayer(n) { return !!(S && S.mode === 'leader' && S.player && n && S.player.n === n.id); }
function playerNation() { return S.mode === 'leader' && S.player ? S.nations[S.player.n] : null; }
function secYears(sec) { return Math.max(1, Math.round(sec * AUTO_SPEED[S.flags.maxEra || 0])); }

/* ---------- modal queue ---------- */
let modalOpen = false, resumeAfterModal = false;
const MQ = [];
function queueModal(m) { MQ.push(m); if (!modalOpen) nextModal(); }
function nextModal() {
  const el = $('evModal');
  const m = MQ.shift();
  if (!m) { modalOpen = false; el.hidden = true; if (resumeAfterModal) setPlaying(true); resumeAfterModal = false; return; }
  if (!modalOpen) { resumeAfterModal = playing; setPlaying(false); }
  modalOpen = true;
  el.innerHTML = `<div class="evcard" role="dialog" aria-modal="true" aria-labelledby="evTitle">
    ${m.kicker ? `<div class="kicker">${esc(m.kicker)}</div>` : ''}<h2 id="evTitle">${esc(m.title)}</h2>
    <div class="evbody">${m.html || ''}</div>
    <div class="evbtns">${m.buttons.map((b, k) => `<button class="btn ${b.primary ? 'primary' : ''} ${b.danger ? 'danger' : ''}" data-k="${k}" ${b.disabled ? 'disabled' : ''}>${esc(b.label)}${b.note ? `<small>${esc(b.note)}</small>` : ''}</button>`).join('')}</div></div>`;
  el.hidden = false;
  el._m = m;
  const first = el.querySelector('button:not([disabled])'); if (first) setTimeout(() => first.focus(), 0);
}
$('evModal').addEventListener('click', e => {
  const b = e.target.closest('button[data-k]'); if (!b) return;
  const m = $('evModal')._m; const btn = m && m.buttons[+b.dataset.k];
  if (btn && btn.fn) btn.fn();
  nextModal();
});

/* ---------- national focuses ---------- */
const FOCUS_LANES = ['内政', '经济', '科学', '军事', '外交', '民主', '共产', '法西斯', '君主', '神权', '技术官僚', '星际'];
const IDEO_PATHS = ['f_dem', 'f_com', 'f_fas', 'f_mon', 'f_theo', 'f_tec'];
const FOCUS = [];
function FZ(id, name, lane, tier, req, sec, opt, desc, fxt, fx) { FOCUS.push(Object.assign({ id, name, lane, tier, req, sec, desc, fxt, fx, minEra: 0, tech: null, excl: [] }, opt)); }
const addB = (n, k, v) => { n.bonus[k] = (n.bonus[k] || 0) + v; };
const pushIdeo = (n, id, v) => { n.sup[id] = (n.sup[id] || 0) + v; let s = 0; for (const k in n.sup) s += n.sup[k]; for (const k in n.sup) n.sup[k] /= s; };
FZ('f_census', '人口普查', '内政', 0, [], 8, {}, '清点户口与土地，政府第一次知道自己有多少子民。', '稳定 +5%，政治点数 +0.1/年', n => { addB(n, 'stab', 0.05); addB(n, 'pp', 0.1); });
FZ('f_bureau', '官僚体系', '内政', 1, ['f_census'], 10, { minEra: 1 }, '科举与文官让国家机器运转起来。', '稳定 +8%，政治点数 +0.2/年', n => { addB(n, 'stab', 0.08); addB(n, 'pp', 0.2); });
FZ('f_reform', '宪政改革', '内政', 2, ['f_bureau'], 12, { minEra: 3 }, '用法律而不是刀剑来解决分歧。', '稳定 +10%，内战风险降低', n => { addB(n, 'stab', 0.1); });
FZ('f_welfare', '社会保障', '内政', 3, ['f_reform'], 12, { minEra: 5 }, '让每个人都有饭吃、有病可医。', '稳定 +10%，人口增长加快', n => { addB(n, 'stab', 0.1); addB(n, 'growth', 0.001); });
FZ('f_irrig', '兴修水利', '经济', 0, [], 8, {}, '开渠引水，旱涝保收。', '粮食 +8%', n => addB(n, 'food', 0.08));
FZ('f_roads', '修筑驰道', '经济', 1, ['f_irrig'], 9, {}, '车同轨，四方通达。', '陆地扩张 +1，粮食 +4%', n => { addB(n, 'range', 1); addB(n, 'food', 0.04); });
FZ('f_5year', '工业化计划', '经济', 2, ['f_roads'], 12, { minEra: 4, tech: 'steam' }, '五年之内，烟囱林立。', '工业 +15%', n => addB(n, 'ind', 0.15));
FZ('f_rail', '国家铁路网', '经济', 3, ['f_5year'], 12, { minEra: 4 }, '铁路把粮食和兵员送到四面八方。', '粮食 +10%，陆地扩张 +1', n => { addB(n, 'food', 0.1); addB(n, 'range', 1); });
FZ('f_green', '绿色转型', '经济', 4, ['f_rail'], 14, { minEra: 6, tech: 'renewables' }, '告别煤炭。', '清洁能源普及 +80%', n => addB(n, 'renew', 0.8));
FZ('f_academy', '设立学院', '科学', 0, [], 8, {}, '招揽天下贤士。', '科研 +8%', n => addB(n, 'sci', 0.08));
FZ('f_library', '皇家图书馆', '科学', 1, ['f_academy'], 10, { minEra: 1 }, '收藏天下典籍。', '科研 +8%', n => addB(n, 'sci', 0.08));
FZ('f_univ', '国立大学', '科学', 2, ['f_library'], 12, { minEra: 2 }, '为国家培养工程师与学者。', '科研 +10%', n => addB(n, 'sci', 0.1));
FZ('f_acad', '国家科学院', '科学', 3, ['f_univ'], 12, { minEra: 4 }, '集中力量办大事。', '科研 +12%', n => addB(n, 'sci', 0.12));
FZ('f_manhattan', '曼哈顿计划', '科学', 4, ['f_acad'], 14, { minEra: 5, tech: 'relativity' }, '秘密研制终极武器。', '立即获得「核裂变」与「核武器」', n => { godGrantTechQuiet(n, 'nukeweapons'); });
FZ('f_space', '国家太空计划', '科学', 4, ['f_acad'], 14, { minEra: 5, tech: 'flight' }, '我们选择登月。', '立即获得「航天」，太空殖民 +50%', n => { godGrantTechQuiet(n, 'rocketry'); addB(n, 'space', 0.5); });
FZ('f_ai', '国家 AI 战略', '科学', 5, ['f_manhattan'], 14, { minEra: 6 }, '算力即国力。', '科研 +15%', n => addB(n, 'sci', 0.15));
FZ('f_triad', '核三位一体', '科学', 5, ['f_manhattan'], 14, { minEra: 6 }, '陆基导弹、战略轰炸机与核潜艇，任何一击都无法解除我们的反击能力。', '获得「洲际弹道导弹」「战略核潜艇」', n => { grantMil(n, 'icbm'); grantMil(n, 'ssbn'); });
FZ('f_army', '扩充军队', '军事', 0, [], 7, {}, '招募青壮，操练兵马。', '获得 4 个军团', n => { n.legions += 4; });
FZ('f_fort', '边境要塞', '军事', 1, ['f_army'], 9, {}, '在边境线上筑起堡垒。', '防御 +20%', n => addB(n, 'def', 0.2));
FZ('f_navy', '建立舰队', '军事', 1, ['f_army'], 10, { minEra: 1, tech: 'sailing' }, '控制海洋就控制了贸易。', '跨海距离 +6，军力 +5%，获得「桨帆战船」', n => { addB(n, 'sea', 6); addB(n, 'mil', 0.05); grantMil(n, 'trireme'); });
FZ('f_conscript', '义务兵役', '军事', 2, ['f_fort'], 10, { minEra: 3 }, '全民皆兵。', '军力 +15%，获得 6 个军团', n => { addB(n, 'mil', 0.15); n.legions += 6; });
FZ('f_general', '总参谋部', '军事', 3, ['f_conscript'], 12, { minEra: 4 }, '现代化的指挥体系。', '军力 +15%', n => addB(n, 'mil', 0.15));
FZ('f_armor', '装甲兵团', '军事', 3, ['f_conscript'], 12, { minEra: 5, tech: 'tank' }, '把坦克集中起来使用，而不是分散给步兵。', '获得「中型坦克」，装甲 +10%', n => { grantMil(n, 'tankmed'); addB(n, 'arm', 0.1); });
FZ('f_airforce', '独立空军', '军事', 3, ['f_conscript'], 12, { minEra: 5, tech: 'flight' }, '空军从陆军中独立出来，成为第三个军种。', '获得「军用航空」「单翼战斗机」，空军经费 +10%', n => { grantMil(n, 'milaviation'); grantMil(n, 'monoplane'); const mx = ensureMil(n); mx.split[2] += 0.1; normW(mx.split); mx.tick = -1; });
FZ('f_bluewater', '远洋海军', '军事', 4, ['f_navy'], 12, { minEra: 5 }, '舰队驶出近海，保护全球航线。', '获得「驱逐舰」「轻巡洋舰」，海军 +10%', n => { grantMil(n, 'destroyer'); grantMil(n, 'cruiser'); addB(n, 'navy', 0.1); });
FZ('f_envoy', '派遣使节', '外交', 0, [], 7, {}, '与邻国互通往来。', '与所有邻国互信 +0.15', n => { for (const o of neighborNations(n)) addTrust(n.id, o.id, 0.15); });
FZ('f_trade', '开放港口', '外交', 1, ['f_envoy'], 9, { minEra: 1 }, '让商船自由来往。', '贸易收益 +1，渔业 +15%', n => { addB(n, 'trade', 1); });
FZ('f_explore', '远洋探索', '外交', 2, ['f_trade'], 12, { minEra: 3, tech: 'navigation' }, '寻找新大陆。', '跨海距离 +10', n => addB(n, 'sea', 10));
FZ('f_un', '倡议国际组织', '外交', 3, ['f_explore'], 12, { minEra: 5 }, '用规则而不是枪炮维护和平。', '与所有国家互信 +0.2，合作倾向 +0.1', n => { addB(n, 'coop', 0.1); for (const o of S.nations) if (o.alive && o !== n) addTrust(n.id, o.id, 0.2); });
FZ('f_dem', '制宪会议', '民主', 1, ['f_census'], 10, { tech: 'socialcontract', excl: IDEO_PATHS }, '起草一部保障自由的宪法。', '自由民主支持 +30%', n => pushIdeo(n, 'liberal', 0.3));
FZ('f_dem2', '普选权', '民主', 2, ['f_dem'], 10, {}, '每个成年人都有一票。', '稳定 +10%，自由民主支持 +10%', n => { addB(n, 'stab', 0.1); pushIdeo(n, 'liberal', 0.1); });
FZ('f_dem3', '自由贸易体系', '民主', 3, ['f_dem2'], 12, {}, '把世界编织成一张市场之网。', '贸易收益 +1.5，所有民主国家互信 +0.3', n => { addB(n, 'trade', 1.5); for (const o of S.nations) if (o.alive && o !== n && o.ideo === 'liberal') addTrust(n.id, o.id, 0.3); });
FZ('f_dem4', '民主同盟', '民主', 4, ['f_dem3'], 12, {}, '自由世界团结起来。', '与所有自由民主国家结盟', n => { for (const o of S.nations) if (o.alive && o !== n && o.ideo === n.ideo) formAlliance(n.id, o.id, null); });
FZ('f_dem5', '全球联邦倡议', '民主', 5, ['f_dem4'], 14, { minEra: 6 }, '民主国家组成联邦。', '联合谈判收益 +2，合作倾向 +0.15', n => { addB(n, 'coop', 0.15); n.unionBoost = 2; });
FZ('f_com', '工人运动', '共产', 1, ['f_census'], 10, { tech: 'marxism', excl: IDEO_PATHS }, '罢工与集会席卷工厂。', '共产主义支持 +30%', n => pushIdeo(n, 'communist', 0.3));
FZ('f_com2', '计划经济', '共产', 2, ['f_com'], 10, {}, '国家安排一切生产。', '工业 +20%，科研 +5%', n => { addB(n, 'ind', 0.2); addB(n, 'sci', 0.05); });
FZ('f_com3', '共产国际', '共产', 3, ['f_com2'], 12, {}, '全世界的同志联合起来。', '意识形态传播 +60%，共产主义国家互信 +0.3', n => { addB(n, 'spread', 0.6); for (const o of S.nations) if (o.alive && o !== n && o.ideo === 'communist') addTrust(n.id, o.id, 0.3); });
FZ('f_com4', '世界革命', '共产', 4, ['f_com3'], 12, {}, '把红旗插遍全球。', '对所有非共产主义邻国获得战争借口，军力 +10%', n => { addB(n, 'mil', 0.1); for (const o of neighborNations(n)) if (o.ideo !== 'communist') S.player.claims[o.id] = S.year; });
FZ('f_fas', '民族复兴', '法西斯', 1, ['f_census'], 10, { tech: 'propaganda', excl: IDEO_PATHS }, '洗刷屈辱，重振民族。', '法西斯主义支持 +30%', n => pushIdeo(n, 'fascist', 0.3));
FZ('f_fas2', '军国主义', '法西斯', 2, ['f_fas'], 10, {}, '一切为了战争机器。', '军力 +25%，获得 8 个军团', n => { addB(n, 'mil', 0.25); n.legions += 8; });
FZ('f_fas3', '生存空间', '法西斯', 3, ['f_fas2'], 12, {}, '我们需要更多土地。', '对所有邻国获得战争借口', n => { for (const o of neighborNations(n)) S.player.claims[o.id] = S.year; });
FZ('f_fas4', '总体战', '法西斯', 4, ['f_fas3'], 12, {}, '全民动员，不惜代价。', '军力 +30%，科研 -10%', n => { addB(n, 'mil', 0.3); addB(n, 'sci', -0.1); });
FZ('f_mon', '王权神授', '君主', 1, ['f_census'], 10, { tech: 'monarchy', excl: IDEO_PATHS }, '君王的权力来自上天。', '君主专制支持 +30%，稳定 +5%', n => { pushIdeo(n, 'monarchy', 0.3); addB(n, 'stab', 0.05); });
FZ('f_mon2', '宫廷联姻', '君主', 2, ['f_mon'], 10, {}, '一场婚礼胜过十场战争。', '与一个君主制国家结盟并互信 +0.4', n => { const o = S.nations.find(o => o.alive && o !== n && o.ideo === 'monarchy'); if (o) { formAlliance(n.id, o.id, `${n.name}与${o.name}王室联姻，结为同盟`); addTrust(n.id, o.id, 0.4); } });
FZ('f_mon3', '帝国荣耀', '君主', 3, ['f_mon2'], 12, {}, '为皇帝开疆拓土。', '军力 +15%，稳定 +10%', n => { addB(n, 'mil', 0.15); addB(n, 'stab', 0.1); });
FZ('f_theo', '确立国教', '神权', 1, ['f_census'], 10, { tech: 'theology', excl: IDEO_PATHS }, '一个国家，一个信仰。', '神权政体支持 +30%，稳定 +8%', n => { pushIdeo(n, 'theocracy', 0.3); addB(n, 'stab', 0.08); });
FZ('f_theo2', '圣战', '神权', 2, ['f_theo'], 12, {}, '为信仰而战。', '对不同信仰的邻国获得战争借口，军力 +10%', n => { addB(n, 'mil', 0.1); for (const o of neighborNations(n)) if (o.ideo !== n.ideo) S.player.claims[o.id] = S.year; });
FZ('f_tec', '专家治国', '技术官僚', 1, ['f_census'], 12, { tech: 'ai', excl: IDEO_PATHS }, '让最懂行的人做决定。', '技术官僚支持 +30%', n => pushIdeo(n, 'technocracy', 0.3));
FZ('f_tec2', '算法治理', '技术官僚', 2, ['f_tec'], 12, {}, '政策由模型推演。', '科研 +25%，稳定 +5%', n => { addB(n, 'sci', 0.25); addB(n, 'stab', 0.05); });
FZ('f_star', '星际殖民计划', '星际', 2, ['f_space'], 12, { tech: 'moonbase' }, '人类的未来在星辰大海。', '太空殖民速度 ×2', n => addB(n, 'space', 1));
FZ('f_star2', '太空军', '星际', 3, ['f_star'], 12, { tech: 'orbitalwar' }, '从轨道俯瞰战场。', '军力 +20%', n => addB(n, 'mil', 0.2));
FZ('f_star3', '方舟计划', '星际', 4, ['f_star2'], 14, { tech: 'warp' }, '为人类准备一艘诺亚方舟。', '太空殖民速度再 ×2，系外殖民加速', n => addB(n, 'space', 2));
const FOCUS_BY_ID = Object.fromEntries(FOCUS.map(f => [f.id, f]));
// grant a military tech together with its military prerequisites, but only when its civil prerequisites are already known
function grantMil(n, id) { const t = TECH_BY_ID[id]; if (!t || n.techs[id] !== undefined) return; const ok = x => TECH_BY_ID[x].req.every(r => n.techs[r] !== undefined || (TECH_BY_ID[r].mil && ok(r))); if (ok(id)) godGrantTechQuiet(n, id); }
function godGrantTechQuiet(n, id) { const was = booting; godGrantTech(n, id); }
function neighborNations(n) { const out = new Set(); for (const [a, b] of S.borders) { if (a === n.id) out.add(b); else if (b === n.id) out.add(a); } return [...out].map(i => S.nations[i]).filter(o => o && o.alive); }
function focusState(f, n) {
  const P = S.player;
  if (P.done.includes(f.id)) return 'done';
  if (P.focus && P.focus.id === f.id) return 'cur';
  if (f.excl.length && P.done.some(d => f.excl.includes(d) && d !== f.id)) return 'blocked';
  if (!f.req.every(r => P.done.includes(r))) return 'locked';
  if (f.minEra > n.mult.era || (f.tech && n.techs[f.tech] === undefined)) return 'locked';
  return 'avail';
}

/* ---------- player tick ---------- */
function playerTick() {
  const n = playerNation(); if (!n || !n.alive) return;
  const P = S.player, sp = AUTO_SPEED[S.flags.maxEra || 0];
  const I = ideoOf(n);
  P.ppRate = (0.8 + 0.9 * n.stabV + (['monarchy', 'fascist', 'communist', 'hive'].includes(n.ideo) ? 0.25 : 0) + (n.bonus.pp || 0)) * 1.4;
  P.pp = Math.min(999, P.pp + P.ppRate / sp);
  if (P.focus) {
    P.focus.prog += 1 / sp;
    const f = FOCUS_BY_ID[P.focus.id];
    if (P.focus.prog >= f.sec) { P.done.push(f.id); P.focus = null; f.fx(n); n.mult = computeMult(n); log('civ', `${n.name}完成国策「${f.name}」：${f.fxt}`, capitalCell(n), true); }
  }
  if (S.tick % 10 === 0) checkVictory();
}
function checkVictory() {
  const n = playerNation(); if (!n || S.player.victory) return;
  const realmCities = S.cities.filter(c => realmOf(c.n) === n.id).length;
  if (S.cities.length > 10 && realmCities === S.cities.length) return victory('unify', '世界统一', `${n.name}统一了整个蓝星。`);
  const share = (S.ideoWorld || {})[n.ideo] || 0;
  const others = S.nations.filter(o => o.alive && o.cl.length && realmOf(o.id) !== n.id);
  const otherPop = others.reduce((a, o) => a + o.st.pop, 0), sameOther = others.filter(o => o.ideo === n.ideo).reduce((a, o) => a + o.st.pop, 0);
  if (n.ideo !== 'tribal' && n.mult.era >= 4 && S.year - S.player.started >= 100 && share >= 0.8 && otherPop > 0 && sameOther / otherPop >= 0.7) return victory('ideo', '意识形态胜利', `世界上八成的人口生活在${ideoOf(n).name}之下。你没有征服世界，你说服了它。`);
  const planets = new Set(coloniesOf(n.id).map(([k]) => k));
  if (planets.size >= 5 && [...planets].some(k => PLANET_BY_ID[k].inter)) return victory('stars', '星际胜利', `${n.name}的殖民地遍布 ${planets.size} 颗星球，包括另一颗恒星旁的世界。`);
}
function victory(kind, title, text) {
  S.player.victory = { kind, y: S.year };
  unlock('leader_' + kind);
  queueModal({ kicker: '胜利', title, html: `<p>${esc(text)}</p><p class="note">${fmtYear(S.year)}。你可以继续玩下去，看看这个世界的后续。</p>`, buttons: [{ label: '继续统治', primary: true }, { label: '开启新世界', fn: () => openModeOverlay() }] });
}

/* ---------- hooks called by the simulation ---------- */
function playerRegimeCrisis(n, top) {
  const P = S.player;
  if ((P.regimeCD || -1e9) > S.year || modalOpen) return;
  P.regimeCD = S.year + secYears(30);
  const J = IDEO_BY_ID[top], I = ideoOf(n);
  queueModal({ kicker: '政治危机', title: `${J.name}派的呼声已压过政府`, html: `<p>${esc(J.name)}的支持率达到 ${Math.round(n.sup[top] * 100)}%，而执政的${esc(I.name)}只有 ${Math.round((n.sup[n.ideo] || 0) * 100)}%。街头的集会越来越多。</p><p class="note">${esc(J.desc)}</p>`,
    buttons: [
      { label: `顺应民意，改行${J.short}`, note: '和平过渡', primary: true, fn: () => setIdeology(n, top, `${n.name}政府顺应民意，改行${J.name}`) },
      { label: '承诺改革', note: '花费 40 政治点数，安抚民众', disabled: P.pp < 40, fn: () => { P.pp -= 40; n.sup[top] *= 0.8; pushIdeo(n, n.ideo, 0.08); } },
      { label: '武力镇压', note: '稳定 -15%，可能引发内战', danger: true, fn: () => { n.stabV = Math.max(0, n.stabV - 0.15); n.sup[top] *= 0.7; pushIdeo(n, n.ideo, 0.05); if (rand() < 0.35 && n.cl.length >= 4) startCivilWar(n, top); } },
    ] });
}
function playerCivilWarNotice(n, rb) {
  queueModal({ kicker: '内战', title: `${rb.name}举起了叛旗`, html: `<p>${esc(ideoOf(rb).name)}派控制了 ${rb.cl.length} 座城市，与政府军隔线对峙。内战结束时，胜者将吞并败者。</p>`,
    buttons: [{ label: '全力镇压', note: '获得 6 个军团', primary: true, fn: () => { n.legions += 6; } }, { label: '承认其独立', note: '停止内战，失去这些城市', fn: () => { makePeace(n.id, rb.id, `${n.name}承认了${rb.name}的独立`); rb.civilOf = undefined; } }] });
}
function playerWarDeclared(w, attacker) {
  const n = playerNation();
  const Fn = milForces(n), Fa = milForces(attacker), th = theatre(w), r1 = v => fmtNum(v / 1000);
  queueModal({ kicker: '战争', title: `${attacker.name}向你宣战！`, html: `<p>军力对比（你 : 对方）：<b>陆 ${r1(Fn.L)} : ${r1(Fa.L)}</b> · 海 ${r1(Fn.S)} : ${r1(Fa.S)} · 空 ${r1(Fn.A)} : ${r1(Fa.A)}。${th.land ? '两国陆地相连，主战场在陆上。' : '两国隔海相望，谁控制海洋谁就能登陆。'}${deterrent(attacker) ? '<b>对方拥有核武器。</b>' : ''}${attacker.allies.length ? `对方的盟友：${esc(attacker.allies.map(i => S.nations[i].name).join('、'))}。` : ''}</p>`,
    buttons: [{ label: '迎战', primary: true, fn: () => { const p = nearestPair(n, attacker); if (p && viewMode === 'map') flyToWar(w); } }, { label: '割让一座边境城市求和', fn: () => { const p = nearestPair(n, attacker); if (p && n.cl.length > 1) transferCity(p.c, attacker, n); makePeace(n.id, attacker.id, `${n.name}割地求和，${attacker.name}接受`); } }] });
}
function aiPeaceOffer(w) {
  const n = playerNation(); if (!n) return;
  const o = S.nations[w.a === n.id ? w.b : w.a];
  const sc = warScore(w);
  queueModal({ kicker: '和谈', title: `${o.name}提出停战`, html: `<p>战争已经持续 ${S.year - w.start} 年，当前战争分数 ${sc >= 0 ? '+' : ''}${sc}。对方愿意维持现有战线停火。</p>`,
    buttons: [{ label: '接受停战', primary: true, fn: () => makePeace(n.id, o.id, `${n.name}与${o.name}停战`) }, { label: '继续战斗', fn: () => {} }, { label: '召开和会', note: '按战争分数提出条件', fn: () => peaceConference(w) }] });
}
function playerNationLost(n, by) {
  if (S.mode !== 'leader') return;
  S.player.lost = true;
  queueModal({ kicker: '终局', title: `${n.name}灭亡了`, html: `<p>${by ? esc(by.name) + '吞并了你的最后一座城市。' : '你的最后一座城市陷落了。'}历史不会停下，你可以扮演另一个文明，或者成为造物主继续观看。</p>`,
    buttons: [{ label: '扮演另一个文明', primary: true, fn: () => openNationPicker() }, { label: '成为造物主', fn: () => setMode('god') }, { label: '开启新世界', fn: () => openModeOverlay() }] });
}

/* ---------- game theory decisions for the player ---------- */
function matrixHTML(rec, asRow) {
  const G = GAMES[rec.type];
  const rowS = asRow ? G.s : G.t, colS = asRow ? G.t : G.s;
  const me = (i, j) => asRow ? rec.A[i][j] : rec.B[j][i], them = (i, j) => asRow ? rec.B[i][j] : rec.A[j][i];
  const isEq = (i, j) => rec.pure.some(e => asRow ? e[0] === i && e[1] === j : e[0] === j && e[1] === i);
  const sel = (i, j) => rec.pick && (asRow ? rec.pick[0] === i && rec.pick[1] === j : rec.pick[0] === j && rec.pick[1] === i);
  let h = `<table class="mtx"><thead><tr><th></th>${colS.map(s => `<th>对方：${esc(s)}</th>`).join('')}</tr></thead><tbody>`;
  for (let i = 0; i < 2; i++) {
    h += `<tr><th>你：${esc(rowS[i])}</th>`;
    for (let j = 0; j < 2; j++) h += `<td class="${isEq(i, j) ? 'eq' : ''} ${sel(i, j) ? 'sel' : ''}"><b>${me(i, j)}</b> , ${them(i, j)}</td>`;
    h += '</tr>';
  }
  return h + '</tbody></table>';
}
function playerGame(rec) {
  const n = playerNation(), asRow = rec.a === n.id;
  const other = S.nations[asRow ? rec.b : rec.a], G = GAMES[rec.type];
  const myS = asRow ? G.s : G.t;
  // what the AI is expected to play: its strategy in the selected equilibrium, or its mixed probability
  const aiIdx = asRow ? rec.eq[1] : rec.eq[0];
  const q = rec.mixed ? (asRow ? rec.mixed.q : rec.mixed.p) : (aiIdx === 0 ? 1 : 0);
  const ev = i => { let s = 0; for (let j = 0; j < 2; j++) { const pj = j === 0 ? q : 1 - q; s += pj * (asRow ? rec.A[i][j] : rec.B[j][i]); } return s; };
  const eqTxt = rec.pure.length ? rec.pure.map(e => `（${G.s[e[0]]}，${G.t[e[1]]}）`).join(' 和 ') : '没有纯策略均衡';
  const ctxTxt = rec.type === 'crisis' ? (asRow ? `你向${other.name}索要${(cityById(rec.ctx.city) || {}).name || '边境城市'}。` : `${other.name}要求你割让${(cityById(rec.ctx.city) || {}).name || '一座边境城市'}。`) : '';
  const html = `<p><b>${esc(G.kind)}</b> · 对手：${sw(other)}${esc(other.name)}（${esc(ideoOf(other).name)}，军力 ${fmtNum(power(other) / 1000)}，互信 ${Math.round(rec.trust * 100)}%）</p>
    ${ctxTxt ? `<p>${esc(ctxTxt)}</p>` : ''}
    ${matrixHTML(rec, asRow)}
    <p class="note">格子里是“你的收益 , 对方的收益”。高亮的格子是纳什均衡：${esc(eqTxt)}。</p>
    <p class="note">按均衡推算，对方选择「${esc((asRow ? G.t : G.s)[0])}」的概率约为 ${Math.round(q * 100)}%。</p>
    <p class="phil">${esc(G.note)}</p>`;
  queueModal({ kicker: '博弈 · ' + G.name, title: `与${other.name}的${G.name}`, html,
    buttons: [0, 1].map(i => ({ label: myS[i], note: `预期收益 ${ev(i).toFixed(1)}`, primary: i === (ev(0) >= ev(1) ? 0 : 1), fn: () => {
      let ai = rec.mixed && rec.pure.length === 0 ? (rand() < q ? 0 : 1) : aiIdx;
      if (rand() < 0.05) ai = 1 - ai;
      if (asRow) resolveGame(rec, i, ai); else resolveGame(rec, ai, i);
      showTicker('civ', `${G.name}：你选择「${myS[i]}」，${other.name}选择「${(asRow ? G.t : G.s)[ai]}」。${rec.out || ''}`);
    } })) });
}
function playerInitiate(type, target) {
  const n = playerNation(); if (!n || !target || !target.alive || target === n) return;
  let ctx = {};
  if (type === 'crisis') { const pr = nearestPair(target, n); if (!pr || pr.d > 10 || target.cl.length < 2) { flashHint('对方没有与你接壤、可以索要的城市'); return false; } ctx = { city: pr.c.id, v: 1 + Math.min(3, Math.log10(pr.c.pop / 1e5 + 1) * 1.5) }; }
  if (type === 'union' && (n.ideo !== target.ideo || getTrust(n.id, target.id) < 0.5)) { flashHint('合并需要相同的意识形态与 50% 以上的互信'); return false; }
  if (type === 'alliance') ctx = { threat: 1.5 };
  playGame(type, n.id, target.id, ctx);
  return true;
}

/* ---------- war score & peace conference ---------- */
function warScore(w) {
  const n = playerNation(); if (!n) return 0;
  const side = w.a === n.id ? 0 : 1;
  const myCaps = w.caps[side], thCaps = w.caps[1 - side];
  const vis = w.vis ? (w.vis[side] - w.vis[1 - side]) / (w.vis[0] + w.vis[1] + 10) : 0;
  const o = S.nations[side === 0 ? w.b : w.a];
  const pr = power(n) / (power(n) + power(o) || 1);
  return Math.round(clamp((myCaps - thCaps) * 18 + vis * 25 + (pr - 0.5) * 30, -100, 100));
}
function peaceConference(w) {
  const n = playerNation(); const o = S.nations[w.a === n.id ? w.b : w.a];
  const sc = warScore(w);
  const border = () => { const p = nearestPair(o, n); return p ? p.c : null; };
  const opts = [];
  if (sc >= 60) opts.push({ label: `吞并${o.name}`, note: '战争分数 ≥ 60', danger: true, fn: () => annexNation(n, o, `${o.name}在和会上被${n.name}吞并`) });
  if (sc >= 40) opts.push({ label: '扶植傀儡政权', note: '对方成为你的附庸', primary: true, fn: () => { makePuppet(n, o, `${o.name}在和会上沦为${n.name}的附庸`); } });
  if (sc >= 15) opts.push({ label: '割让边境城市', note: '获得 1–3 座城市', fn: () => { const k = Math.min(3, 1 + Math.floor(sc / 30)); for (let t = 0; t < k && o.cl.length > 1; t++) { const c = border(); if (c) transferCity(c, n, o); } makePeace(n.id, o.id, `${o.name}在和会上向${n.name}割让 ${k} 座城市`); } });
  opts.push({ label: '白和平', note: sc >= 0 ? '维持现状' : `对方接受的概率 ${Math.round(clamp(0.4 + sc / 100, 0.05, 0.95) * 100)}%`, fn: () => { if (sc >= 0 || rand() < 0.4 + sc / 100) makePeace(n.id, o.id, `${n.name}与${o.name}达成白和平`); else showTicker('war', `${o.name}拒绝了你的停战提议`); } });
  if (sc < 0) opts.push({ label: '割地求和', note: '割让一座城市', fn: () => { const p = nearestPair(n, o); if (p && n.cl.length > 1) transferCity(p.c, o, n); makePeace(n.id, o.id, `${n.name}割地求和`); } });
  opts.push({ label: '返回' });
  queueModal({ kicker: '和会', title: `与${o.name}的和谈`, html: `<p>战争分数：<b>${sc >= 0 ? '+' : ''}${sc}</b>（攻城数、前线伤亡与军力对比）。分数越高，能提出的条件越苛刻。</p>`, buttons: opts });
}

/* ---------- decisions ---------- */
const DECISIONS = [
  { id: 'justify', name: '制造战争借口', pp: 30, tgt: 1, desc: '编造理由，几年后可以合法开战' },
  { id: 'declare', name: '宣战', pp: 0, tgt: 1, desc: '有借口或意识形态理由时免费，否则 60 点并损失稳定' },
  { id: 'demand', name: '要求割地', pp: 20, tgt: 1, desc: '发起「边境危机」（懦夫博弈）' },
  { id: 'alliance', name: '提议同盟', pp: 15, tgt: 1, desc: '发起「共同防御」（猎鹿博弈）' },
  { id: 'trade', name: '提议贸易', pp: 10, tgt: 1, desc: '发起「贸易协定」（囚徒困境）' },
  { id: 'arms', name: '军备谈判', pp: 10, tgt: 1, desc: '发起「军备竞赛」（囚徒困境）' },
  { id: 'export', name: '输出意识形态', pp: 20, tgt: 1, desc: '发起「意识形态渗透」' },
  { id: 'union', name: '提议合并', pp: 40, tgt: 1, desc: '发起「联合谈判」（协调博弈）' },
  { id: 'nap', name: '互不侵犯条约', pp: 20, tgt: 1, desc: '对方接受后双方都不能开战' },
  { id: 'subvert', name: '扶植反对派', pp: 30, tgt: 1, desc: '在对方国内传播你的意识形态' },
  { id: 'amnesty', name: '大赦天下', pp: 20, desc: '稳定 +10%' },
  { id: 'purge', name: '清洗反对派', pp: 25, desc: '执政意识形态支持 +15%，稳定 -5%' },
];
function canJustifiedWar(n, o) {
  if (S.player.claims[o.id] !== undefined && S.player.claims[o.id] <= S.year) return true;
  if (['fascist', 'communist', 'theocracy', 'hive'].includes(n.ideo) && o.ideo !== n.ideo) return true;
  return enemiesOf(o.id).some(e => allied(n.id, e));
}
function doDecision(id, target) {
  const n = playerNation(), P = S.player, D = DECISIONS.find(d => d.id === id);
  if (!n || !D) return;
  if (D.tgt && (!target || !target.alive || target === n)) { flashHint('先选择一个对象国家'); return; }
  let cost = D.pp;
  if (id === 'declare') { if (atWar(n.id, target.id)) { flashHint('已经在交战'); return; } if (hasNap(n, target)) { flashHint('你们签有互不侵犯条约'); return; } if (!canJustifiedWar(n, target)) cost = 60; }
  if (P.pp < cost) { flashHint(`政治点数不足（需要 ${cost}）`); return; }
  let ok = true;
  switch (id) {
    case 'justify': if (P.claims[target.id] !== undefined) { flashHint('已经有战争借口或正在制造'); ok = false; break; } P.claims[target.id] = S.year + secYears(12); showTicker('civ', `开始制造对${target.name}的战争借口，约 ${secYears(12)} 年后完成`); break;
    case 'declare': { const just = canJustifiedWar(n, target); if (!just) { n.stabV = Math.max(0, n.stabV - 0.15); } const w = startWar(n.id, target.id, true, `${n.name}向${target.name}宣战${just ? '' : '（师出无名，国内哗然）'}`); if (w) flyToWar(w); delete P.claims[target.id]; break; }
    case 'demand': ok = playerInitiate('crisis', target) !== false; break;
    case 'alliance': ok = playerInitiate('alliance', target) !== false; break;
    case 'trade': ok = playerInitiate('trade', target) !== false; break;
    case 'arms': ok = playerInitiate('arms', target) !== false; break;
    case 'export': ok = playerInitiate('ideology', target) !== false; break;
    case 'union': ok = playerInitiate('union', target) !== false; break;
    case 'nap': { const accept = getTrust(n.id, target.id) * (1.4 - target.ambition * ideoOf(target).aggr * 0.5) > 0.35; if (accept) { n.nap[target.id] = target.nap[n.id] = S.year + secYears(40); log('civ', `${n.name}与${target.name}签订互不侵犯条约`, capitalCell(n), true); } else showTicker('civ', `${target.name}拒绝签订互不侵犯条约`); break; }
    case 'subvert': target.push = target.push || {}; target.push[n.ideo] = (target.push[n.ideo] || 0) + 1.2; addTrust(n.id, target.id, -0.1); showTicker('civ', `${ideoOf(n).name}的地下组织在${target.name}活跃起来`); break;
    case 'amnesty': n.stabV = Math.min(1, n.stabV + 0.1); break;
    case 'purge': pushIdeo(n, n.ideo, 0.15); n.stabV = Math.max(0, n.stabV - 0.05); break;
  }
  if (ok) P.pp -= cost;
  $('pane-me')._html = '';
}
function flyToWar(w) {
  const A = S.nations[w.a], Bn = S.nations[w.b];
  const pa = nearestPair(A, Bn), pb = nearestPair(Bn, A);
  if (!pa || !pb) return;
  const [ax, ay] = cityMpx(pa.c), [bx, by] = cityMpx(pb.c);
  flyTo(ax + wrapDx(bx - ax) / 2, (ay + by) / 2, 5);
}

/* ---------- mode selection & nation picker ---------- */
function setMode(mode, nid) {
  S.mode = mode; S.modeChosen = true;
  if (mode === 'leader') {
    const n = S.nations[nid];
    S.player = { autoBudget: true, n: nid, pp: 40, ppRate: 1, focus: null, done: [], claims: {}, gcd: S.year + secYears(20), victory: null, started: S.year };
    selectedNation = -1;
    const c = cityById(n.capital) || largestCity(n);
    if (c) { selected = { city: c.id }; flyToCity(c, 3.2); }
    log('civ', `你成为了${n.name}的领袖`, capitalCell(n), true);
  } else { S.player = null; }
  applyModeUI();
  switchTab(mode === 'leader' ? 'me' : 'ov');
}
function applyModeUI() {
  const leader = S.mode === 'leader';
  document.querySelector('.tabs [data-tab="me"]').hidden = !leader;
  for (const b of $('toolbar').querySelectorAll('.tgroup')) { const g = b.dataset.g; b.hidden = leader && !(g === '查看' || g === '战争'); }
  const dp = $('toolbar').querySelector('[data-tool="diplo"]'); if (dp) dp.hidden = leader;
  $('btnMode').textContent = leader ? '领袖模式' : '造物主模式';
  if (leader && tool !== 'inspect' && tool !== 'attack' && tool !== 'diplo') setTool('inspect');
}
function openModeOverlay() { $('modeSel').hidden = false; $('modeNations').hidden = true; $('modeCards').hidden = false; $('modeCancel').hidden = !S.modeChosen; setPlaying(false); }
function openNationPicker() {
  $('modeSel').hidden = false; $('modeCards').hidden = true; $('modeNations').hidden = false; setPlaying(false);
  const list = S.nations.filter(n => n.alive && n.cl.length).sort((a, b) => b.st.pop - a.st.pop);
  $('modeNationList').innerHTML = list.map(n => {
    const cap = cityById(n.capital) || largestCity(n);
    const diff = power(n) > list.reduce((s, o) => s + power(o), 0) / list.length * 1.3 ? '强国' : n.cl.length <= 2 ? '小国 · 困难' : '中等';
    return `<button class="pick" data-n="${n.id}">${sw(n)}<span class="pn">${esc(n.name)}</span><span class="pd">${esc(ideoOf(n).name)} · ${n.cl.length} 城 · ${fmtPop(n.st.pop)} · ${ERA_NAME[n.mult.era]}时代 · ${diff}</span><span class="pd">首都 ${esc(cap ? cap.name : '—')}，${cap ? BIOME_NAME[WORLD.biome[cap.i]] : ''}${cap && cap.coastal ? '，沿海' : ''}</span></button>`;
  }).join('');
}
$('modeSel').addEventListener('click', e => {
  const b = e.target.closest('[data-mode]');
  if (b) { if (b.dataset.mode === 'god') { $('modeSel').hidden = true; setMode('god'); setPlaying(true); try { localStorage.setItem('blue-planet-intro', '1'); } catch (er) {} } else openNationPicker(); return; }
  const p = e.target.closest('.pick');
  if (p) { $('modeSel').hidden = true; setMode('leader', +p.dataset.n); setPlaying(true); try { localStorage.setItem('blue-planet-intro', '1'); } catch (er) {} return; }
  if (e.target.closest('#modeBack')) { $('modeCards').hidden = false; $('modeNations').hidden = true; }
  if (e.target.closest('#modeNew')) bootFresh(openModeOverlay);
});
$('btnMode').addEventListener('click', () => openModeOverlay());

/* ---------- leader panel: army block ---------- */
let armyMixOpen = false, docPick = '';
function presetOn(n, k) { const p = MIL_PRESET[k] || (MIL_DOCT[n.ideo] || MIL_DOCT.tribal).split, s = n.mx.split; let t = 0; for (const v of p) t += v; return p.every((v, i) => Math.abs(v / t - s[i]) < 0.006); }
function doctrineOptions(n) { const out = []; for (const d of DOMS) for (const t of EXCL[d] || []) if (n.techs[t.id] === undefined && t.req.every(r => n.techs[r] !== undefined) && t.era <= n.mult.era) out.push(t); return out; }
function armyBlock(n) {
  const mx = ensureMil(n), F = milForces(n), m = n.mult, P = S.player, es = effSplit(n), r = researchBars(n);
  const notes = [];
  if (mx.split[1] > 0.01 && es[1] === 0) notes.push(mx.coast ? '还没有战舰，海军经费暂时转给陆军' : '没有海岸城市，海军经费转给陆军');
  if (mx.split[2] > 0.01 && es[2] === 0) notes.push('尚未掌握军用航空，空军经费转给陆军');
  const opts = doctrineOptions(n); if (!opts.some(t => t.id === docPick)) docPick = opts.length ? opts[0].id : '';
  const pick = TECH_BY_ID[docPick], reform = pick && EXCL[pick.excl].some(o => n.techs[o.id] !== undefined);
  const PC = prodCap(n), q = n.bq || [], oq = mx.queue || [];
  return `<h3>军队 <small><label class="chk"><input type="checkbox" data-me="milauto"${mx.auto ? ' checked' : ''}> 顾问代管军种比例</label></small></h3>
    <div class="kpis">
      <div class="kpi"><span class="k">陆军</span><span class="v">${fmtNum(F.L / 1000)}</span></div>
      <div class="kpi"><span class="k">海军</span><span class="v">${fmtNum(F.S / 1000)}</span></div>
      <div class="kpi"><span class="k">空军</span><span class="v">${fmtNum(F.A / 1000)}</span></div>
    </div>
    <p class="note">现役 ${Math.round(F.tot)} / 编制 ${Math.round(F.cap)}${F.tot > F.cap * 1.02 ? '（超编）' : ''} · 兵员约 ${fmtNum(soldiersOf(n))} 人 · ${bldName('mf', n)} ${PC.mf} 座 · ${bldName('dock', n)} ${PC.dk} 座${q.length ? ` · 在建 ${q.length} 项` : ''}${oq.length ? ` · 订单 ${oq.length} 个` : ''}</p>
    <div class="decs"><button class="btn small primary" data-mil="build">建设工厂与基地…</button><button class="btn small" data-mil="prod">生产订单…</button><button class="btn small" data-mil="force">兵力与征兵…</button></div>
    <div class="acts"><span class="note" style="margin:0">军费结构：</span><div class="seg">${Object.keys(MIL_PRESET_NAME).map(k => `<button data-milp="${k}" aria-pressed="${presetOn(n, k)}">${MIL_PRESET_NAME[k]}</button>`).join('')}</div></div>
    <div class="alloc">${DOMS.map((d, k) => `<span class="swatch" style="background:${DOM_BAR[d]}"></span><span>${DOM_NAME[d]}</span><span class="track"><span class="fill" style="width:${(mx.split[k] * 100).toFixed(0)}%;background:${DOM_BAR[d]}"></span></span><span class="mono">${pctS(mx.split[k])}</span><button class="btn small" data-ms="${k}" data-d="-1" aria-label="减少${DOM_NAME[d]}经费">−</button><button class="btn small" data-ms="${k}" data-d="1" aria-label="增加${DOM_NAME[d]}经费">+</button>`).join('')}</div>
    ${notes.length ? `<p class="note">${notes.join('；')}。</p>` : ''}
    <details class="fold"${armyMixOpen ? ' open' : ''}><summary data-me="mixfold">编制：各兵种占比与现役型号</summary><div class="mixgrid">${DOMS.map(d => `<span class="dh">${DOM_NAME[d]}</span>` + ROLES[d].map(ro => { const u = UNIT_BY_ID[m.best[ro]]; return `<span>${MIL_ROLE_NAME[ro]} <small>· ${u ? esc(u.name) : '未解锁'}</small></span><span class="mono">${pctS(mx.mix[d][ro] || 0)}</span><button class="btn small" data-mix="${d}:${ro}" data-d="-1" aria-label="减少${MIL_ROLE_NAME[ro]}">−</button><button class="btn small" data-mix="${d}:${ro}" data-d="1" aria-label="增加${MIL_ROLE_NAME[ro]}">+</button>`; }).join('')).join('')}</div></details>
    <div class="rrow" style="margin-top:12px"><span class="swatch" style="background:#e8a25a"></span><span>军工研究 · ${r.mt ? esc(r.mt.name) : '暂无目标'}</span><span class="mono">${r.mt ? Math.round(r.mp * 100) + '%' : ''} <button class="btn small" data-me="miltree">选择</button></span><span class="track"><span class="fill mil" style="width:${(r.mp * 100).toFixed(0)}%"></span></span></div>
    <div class="milrow" style="margin-top:10px"><span class="k">学说</span>${doctrineChips(n)}</div>
    ${opts.length ? `<div class="acts"><select class="msel" data-me="docpick" aria-label="新学说">${opts.map(t => `<option value="${t.id}"${t.id === docPick ? ' selected' : ''}>${DOM_NAME[t.excl]} · ${esc(t.name)}</option>`).join('')}</select><button class="btn small" data-me="doctrine" ${reform && P.pp < 60 ? 'disabled' : ''}>${reform ? '学说改革 · 60' : '研究此学说'}</button></div>` : ''}`;
}
function warControlRows(n, w) {
  const c = warControl(n, w), th = theatre(w), o = S.nations[w.a === n.id ? w.b : w.a];
  const bar = (k, v) => `<span>${k}</span><span class="track"><span class="fill" style="width:${(v * 100).toFixed(0)}%"></span></span><b>${Math.round(v * 100)}%</b>`;
  const btns = [];
  if (!w.civil && !th.land && o && o.cl.some(x => x.coastal)) btns.push(`<button class="btn small" data-war="${w.id}" data-wa="amphib" title="对最近的敌方沿海城市发起两栖登陆，需要制海 58% 以上">两栖登陆</button>`);
  if (deterrent(n)) btns.push(`<button class="btn small danger" data-war="${w.id}" data-wa="nuke">核打击…</button>`);
  // main thrust: the enemy city the army pushes toward (stepping through closer cities when it is out of reach)
  const obj = w.obj ? w.obj[sideOf(w, n)] : null, f = w.front;
  const cands = o ? o.cl.slice().sort((a, b) => (f >= 0 ? cellDist(a.i, f) - cellDist(b.i, f) : 0) || b.pop - a.pop).slice(0, 14) : [];
  if (obj != null && !cands.some(x => x.id === obj)) { const oc = cityById(obj); if (oc) cands.unshift(oc); }
  const objSel = cands.length ? `<div class="milrow" style="margin:2px 0 6px 16px"><span class="k">主攻</span><select class="objsel" data-obj="${w.id}" aria-label="主攻方向"><option value="">前线自行选择</option>${cands.map(x => `<option value="${x.id}"${x.id === obj ? ' selected' : ''}>${esc(x.name)}${x.cap ? '（首都）' : ''}</option>`).join('')}</select></div>` : '';
  return `<div class="warctl">${bar('地面', c.land)}${bar('制空', c.air)}${th.sea || c.sea !== 0.5 ? bar('制海', c.sea) : ''}${c.block > 0.01 ? `<span>被封锁</span><span></span><b>${Math.round(c.block * 100)}%</b>` : ''}</div>${objSel}${btns.length ? `<div class="decs" style="margin:2px 0 6px 16px">${btns.join('')}</div>` : ''}`;
}
function confirmNuke(n, w) {
  const o = S.nations[w.a === n.id ? w.b : w.a]; if (!o) return;
  queueModal({ kicker: '核打击', title: `对${o.name}动用核武器？`, html: `<p>这是不可撤回的决定。后果：</p><ul class="evlist">
      <li>${esc(o.name)}前线附近人口最多的城市将有 ${n.mult.nukeY >= 2 ? '80%' : '60%'} 的居民罹难，九成工业化为灰烬，周边城市同样受创。</li>
      <li>世界上所有国家对你的互信 −40%，本国稳定 −10%。</li>
      <li>尘埃遮蔽阳光，全球降温；此后 50 年人类将笼罩在核禁忌之下。</li>
      ${o.mult.secondStrike && deterrent(o) ? `<li><b>${esc(o.name)}拥有二次打击能力，极有可能立即发动核反击。</b></li>` : deterrent(o) ? `<li>${esc(o.name)}同样拥有核武器。</li>` : ''}
    </ul>`,
    buttons: [{ label: '取消', primary: true, fn: () => {} }, { label: '发射', note: n.mult.icbm ? '洲际导弹' : '战略轰炸机', danger: true, fn: () => { const r = milCommand(n, w, 'nuke'); showTicker('war', r.msg); $('pane-me')._html = ''; } }] });
}

/* ---------- leader panel ---------- */
let decisionTarget = -1;
function renderMe() {
  const n = playerNation(), el = $('pane-me');
  if (!n) { setHTML(el, '<p class="note">你当前是造物主。点击右上角的「造物主模式」切换为领袖模式。</p>'); return; }
  if (!n.alive) { setHTML(el, `<p class="note">${esc(n.name)}已经灭亡。</p><button class="btn primary" data-me="pick">扮演另一个文明</button>`); return; }
  const P = S.player, I = ideoOf(n);
  const others = S.nations.filter(o => o.alive && o !== n && o.cl.length).sort((a, b) => (enemiesOf(n.id).includes(b.id) - enemiesOf(n.id).includes(a.id)) || power(b) - power(a));
  if (!others.some(o => o.id === decisionTarget)) decisionTarget = others.length ? (neighborNations(n)[0] || others[0]).id : -1;
  const T = S.nations[decisionTarget];
  const f = P.focus ? FOCUS_BY_ID[P.focus.id] : null;
  const wars = S.wars.filter(w => w.a === n.id || w.b === n.id);
  const sup = Object.entries(n.sup).sort((a, b) => b[1] - a[1]);
  const cols = coloniesOf(n.id);
  const share = (S.ideoWorld || {})[n.ideo] || 0, realmC = S.cities.filter(c => realmOf(c.n) === n.id).length;
  const planets = new Set(cols.map(([k]) => k)).size;
  const claim = T ? P.claims[T.id] : undefined;
  setHTML(el, `
    <div class="me-head">${sw(n)}<div><div class="me-name">${esc(n.name)}</div><div class="me-sub"><span class="ibadge" style="--ic:${I.color}">${esc(I.name)}</span> ${ERA_NAME[n.mult.era]}时代 · ${n.cl.length} 城 · ${fmtPop(n.st.pop)}</div></div></div>
    <div class="kpis">
      <div class="kpi"><span class="k">政治点数</span><span class="v">${Math.floor(P.pp)} <small>+${(P.ppRate).toFixed(1)}</small></span></div>
      <div class="kpi"><span class="k">稳定度</span><span class="v">${Math.round(n.stabV * 100)}%</span></div>
      <div class="kpi"><span class="k">军力</span><span class="v">${fmtNum(power(n) / 1000)}</span></div>
    </div>
    <h3>国策 <small><button class="btn small" data-me="focus">打开国策树</button></small></h3>
    ${f ? `<div class="rrow"><span class="swatch" style="background:var(--sodium)"></span><span>${esc(f.name)}</span><span class="mono">${Math.round(P.focus.prog / f.sec * 100)}%</span><span class="track"><span class="fill" style="width:${(P.focus.prog / f.sec * 100).toFixed(0)}%"></span></span></div>` : '<p class="note">当前没有推进中的国策。打开国策树选择一项。</p>'}
    <h3>民意</h3>
    <div class="supbar">${sup.map(([id, v]) => `<span style="width:${(v * 100).toFixed(1)}%;background:${IDEO_BY_ID[id].color}" title="${IDEO_BY_ID[id].name} ${Math.round(v * 100)}%"></span>`).join('')}</div>
    <div class="mixlegend">${sup.slice(0, 4).map(([id, v]) => `<div><span class="swatch" style="background:${IDEO_BY_ID[id].color}"></span>${IDEO_BY_ID[id].short}<b>${Math.round(v * 100)}%</b></div>`).join('')}</div>
    <div class="acts"><span class="note" style="margin:0">征兵：</span><div class="seg">${LAW_NAME.map((t, k) => `<button data-law="${k}" aria-pressed="${lawOf(n) === k}" title="${esc(LAW_DESC[k])}">${t}</button>`).join('')}</div></div>
    ${n.eco ? `<h3>财政 <small><label class="chk"><input type="checkbox" data-me="auto"${P.autoBudget ? ' checked' : ''}> AI 顾问代管</label></small></h3>
    <div class="kpis">
      <div class="kpi"><span class="k">GDP</span><span class="v">${fmtMoney(n.eco.gdp)}</span></div>
      <div class="kpi"><span class="k">税收 / 年</span><span class="v">${fmtMoney(n.eco.rev)}</span></div>
      <div class="kpi"><span class="k">国库</span><span class="v">${fmtMoney(n.eco.treasury)}</span></div>
    </div>
    <div class="taxrow"><span>税率</span><button class="btn small" data-tax="-1" aria-label="降低税率">−</button><b class="mono">${pctS(n.eco.tax)}</b><button class="btn small" data-tax="1" aria-label="提高税率">+</button><span class="note" style="margin:0">企业意愿 ${n.eco.will.toFixed(2)} · 出口 ${fmtMoney(n.eco.exp)}${n.eco.tax > doct(n.ideo).tax + 0.05 ? ' · <b style="color:var(--blood)">高于惯例，民怨上升</b>' : ''}</span></div>
    <div class="alloc">${BUD.map((b, k) => (b === 'space' && !n.mult.space) ? '' : `<span class="swatch" style="background:${BUD_COLOR[b]}"></span><span>${BUD_NAME[b]}</span><span class="track"><span class="fill" style="width:${(n.eco.alloc[k] * 100).toFixed(0)}%;background:${BUD_COLOR[b]}"></span></span><span class="mono">${pctS(n.eco.alloc[k])}</span><button class="btn small" data-al="${k}" data-d="-1" aria-label="减少${BUD_NAME[b]}">−</button><button class="btn small" data-al="${k}" data-d="1" aria-label="增加${BUD_NAME[b]}">+</button>`).join('')}</div>
    <p class="note">铁路 ${n.eco.rails} 段 · 研究院 ${n.eco.inst} 座 · 本国路线「${esc(doct(n.ideo).school)}」</p>
    ${n.ai && n.ai.advice ? `<p class="note">顾问建议：${esc(n.ai.advice)}</p>` : ''}` : ''}
    ${armyBlock(n)}
    <h3>外交与决议</h3>
    <div class="acts"><select data-me="target" aria-label="对象国家" class="msel">${others.map(o => `<option value="${o.id}"${o.id === decisionTarget ? ' selected' : ''}>${esc(o.name)}${atWar(n.id, o.id) ? '（交战）' : allied(n.id, o.id) ? '（同盟）' : o.overlord === n.id ? '（附庸）' : ''}</option>`).join('')}</select></div>
    ${T ? `<p class="note">${sw(T)}${esc(T.name)} · ${esc(ideoOf(T).name)} · 军力 ${fmtNum(power(T) / 1000)} · 互信 ${Math.round(getTrust(n.id, T.id) * 100)}% · ${T.ambition * ideoOf(T).aggr > 1.2 ? '野心勃勃' : '相对温和'}${claim !== undefined ? (claim <= S.year ? ' · <b style="color:var(--sodium)">已有战争借口</b>' : ` · 借口还需 ${claim - S.year} 年`) : ''}${hasNap(n, T) ? ' · 互不侵犯' : ''}</p>` : ''}
    <div class="decs">${DECISIONS.filter(d => d.tgt).map(d => { const c = d.id === 'declare' && T && !canJustifiedWar(n, T) ? 60 : d.pp; return `<button class="btn small${d.id === 'declare' ? ' danger' : ''}" data-dec="${d.id}" title="${esc(d.desc)}" ${P.pp < c ? 'disabled' : ''}>${d.name}${c ? ` · ${c}` : ''}</button>`; }).join('')}</div>
    <div class="decs">${DECISIONS.filter(d => !d.tgt).map(d => `<button class="btn small" data-dec="${d.id}" title="${esc(d.desc)}" ${P.pp < d.pp ? 'disabled' : ''}>${d.name} · ${d.pp}</button>`).join('')}<button class="btn small" data-me="attack">派兵进攻…</button></div>
    <h3>战争</h3>
    ${wars.length ? wars.map(w => { const o = S.nations[w.a === n.id ? w.b : w.a], sc = warScore(w); return `<div class="warrow">${sw(o)}<span>${esc(o.name)}${w.civil ? '（内战）' : ''}</span><span class="mono ${sc >= 0 ? 'pos' : 'neg'}">${sc >= 0 ? '+' : ''}${sc}</span><button class="btn small" data-war="${w.id}" data-wa="watch">观战</button><button class="btn small" data-war="${w.id}" data-wa="peace">和谈</button></div>${warControlRows(n, w)}`; }).join('') + `<div class="acts"><label class="chk"><input type="checkbox" data-me="sbomb"${ensureMil(n).policy.sbomb ? ' checked' : ''}> 战略轰炸</label><label class="chk" title="中立国会愤怒，民主国家可能参战"><input type="checkbox" data-me="unres"${ensureMil(n).policy.unrestricted ? ' checked' : ''}> 无限制潜艇战</label></div>` : '<p class="note">和平时期。</p>'}
    <h3>胜利目标</h3>
    <div class="res">
      <span class="name">世界统一</span><span class="track"><span class="fill" style="width:${(realmC / Math.max(1, S.cities.length) * 100).toFixed(1)}%"></span></span><span class="pct">${realmC}/${S.cities.length} 城</span>
      <span class="name">思想</span><span class="track"><span class="fill" style="width:${Math.min(100, share / 0.8 * 100).toFixed(1)}%"></span></span><span class="pct">${Math.round(share * 100)}%/80%</span>
      <span class="name">星际</span><span class="track"><span class="fill" style="width:${Math.min(100, planets / 5 * 100).toFixed(0)}%"></span></span><span class="pct">${planets}/5 星球</span>
    </div>
    <div class="acts" style="margin-top:16px"><button class="btn small" data-me="god">放弃统治，回到造物主模式</button></div>`);
}
$('pane-me').addEventListener('click', e => {
  const n = playerNation();
  const me = e.target.closest('[data-me]');
  if (me) {
    const k = me.dataset.me;
    if (k === 'focus') openFocusTree();
    if (k === 'god') setMode('god');
    if (k === 'pick') openNationPicker();
    if (k === 'attack') { setTool('attack'); flashHint('先点你的一座城市，再点要攻打的敌城'); }
    if (k === 'mixfold') armyMixOpen = !armyMixOpen;
    if (k === 'miltree' && n) openTree(String(n.id), 'land');
    if (k === 'doctrine' && n && docPick) {
      const t = TECH_BY_ID[docPick], reform = EXCL[t.excl].some(o => n.techs[o.id] !== undefined);
      if (reform && S.player.pp < 60) flashHint('学说改革需要 60 政治点数');
      else { const r = chooseDoctrine(n, docPick); if (r.ok && reform) S.player.pp -= 60; showTicker('war', r.msg); }
    }
  }
  const mp = e.target.closest('[data-milp]');
  if (mp && n) milPreset(n, mp.dataset.milp);
  const ms = e.target.closest('[data-ms]');
  if (ms && n) { const sp = ensureMil(n).split.slice(), k = +ms.dataset.ms; sp[k] = Math.max(0, sp[k] + 0.05 * +ms.dataset.d); setMilSplit(n, sp); }
  const mi = e.target.closest('[data-mix]');
  if (mi && n) { const [d, ro] = mi.dataset.mix.split(':'); setMilMix(n, d, ro, (ensureMil(n).mix[d][ro] || 0) + 0.05 * +mi.dataset.d); }
  const tx = e.target.closest('[data-tax]');
  if (tx && n && n.eco) { n.eco.tax = clamp(n.eco.tax + 0.02 * +tx.dataset.tax, 0.03, 0.75); S.player.autoBudget = false; }
  const al = e.target.closest('[data-al]');
  if (al && n && n.eco) { const k = +al.dataset.al; n.eco.alloc[k] = Math.max(0, n.eco.alloc[k] + 0.05 * +al.dataset.d); normW(n.eco.alloc); S.player.autoBudget = false; }
  const lw = e.target.closest('[data-law]');
  if (lw && n && setLaw(n, +lw.dataset.law)) showTicker('war', `征兵法令改为「${LAW_NAME[n.law]}」`);
  const mo = e.target.closest('[data-mil]');
  if (mo && n) openMil(mo.dataset.mil);
  const d = e.target.closest('[data-dec]');
  if (d) doDecision(d.dataset.dec, S.nations[decisionTarget]);
  const w = e.target.closest('[data-war]');
  if (w) {
    const war = S.wars.find(x => x.id === +w.dataset.war), wa = w.dataset.wa;
    if (war) {
      if (wa === 'watch') flyToWar(war);
      else if (wa === 'amphib') { const r = milCommand(n, war, 'amphib'); if (r.ok) { showTicker('war', r.msg); if (r.order && viewMode === 'map') flyToWar(war); } else flashHint(r.msg); }
      else if (wa === 'nuke') confirmNuke(n, war);
      else peaceConference(war);
    }
  }
  $('pane-me')._hold = 0; $('pane-me')._html = ''; renderMe();
});
$('pane-me').addEventListener('change', e => {
  const n = playerNation(), k = e.target.dataset && e.target.dataset.me;
  if (n && (k === 'milauto' || k === 'sbomb' || k === 'unres' || k === 'docpick')) {
    if (k === 'milauto') { ensureMil(n).auto = e.target.checked; n.mx.tick = -1; }
    else if (k === 'docpick') docPick = e.target.value;
    else { const r = milCommand(n, null, k === 'sbomb' ? 'sbomb' : 'unrestricted'); showTicker('war', r.msg); }
    $('pane-me')._hold = 0; $('pane-me')._html = ''; renderMe(); return;
  }
  if (e.target.matches('[data-obj]')) {
    const w = S.wars.find(x => x.id === +e.target.dataset.obj);
    if (w && n) showTicker('war', setWarObjective(n, w, e.target.value === '' ? null : +e.target.value));
    $('pane-me')._hold = 0; $('pane-me')._html = ''; renderMe(); return;
  }
  if (e.target.matches('[data-me="auto"]')) { S.player.autoBudget = e.target.checked; $('pane-me')._hold = 0; $('pane-me')._html = ''; renderMe(); return; } if (e.target.matches('[data-me="target"]')) { decisionTarget = +e.target.value; $('pane-me')._hold = 0; $('pane-me')._html = ''; renderMe(); } });
holdOnInteract($('pane-me'));

/* ---------- focus tree modal ---------- */
let fSel = null;
function openFocusTree() { $('focusModal').hidden = false; renderFocusTree(); setTimeout(() => $('fmClose').focus(), 0); }
function renderFocusTree() {
  const n = playerNation(); if (!n) return;
  const colW = 172, rowH = 56, left = 96, top = 30;
  // focuses sharing a lane and tier stack inside that lane
  const sub = {}, depth = {}, laneY = {};
  for (const f of FOCUS) { const k = f.lane + f.tier; sub[f.id] = depth[k] = (depth[k] === undefined ? 0 : depth[k] + 1); }
  let yy = top; for (const l of FOCUS_LANES) { laneY[l] = yy; let d = 1; for (let t = 0; t < 8; t++) if (depth[l + t] !== undefined) d = Math.max(d, depth[l + t] + 1); yy += d * rowH; }
  const Wd = left + 6 * colW + 20, Ht = yy + 10;
  let svg = `<svg width="${Wd}" height="${Ht}" aria-hidden="true">`;
  const pos = f => ({ x: left + f.tier * colW, y: laneY[f.lane] + sub[f.id] * rowH });
  for (const f of FOCUS) for (const r of f.req) { const a = pos(FOCUS_BY_ID[r]), b = pos(f); const x1 = a.x + 150, y1 = a.y + 23, x2 = b.x, y2 = b.y + 23, mx = (x1 + x2) / 2; svg += `<path d="M${x1} ${y1}C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}" fill="none" stroke="${S.player.done.includes(r) ? '#3d6a90' : '#1f2d4a'}" stroke-width="1.3"/>`; }
  svg += '</svg>';
  let html = svg;
  FOCUS_LANES.forEach(l => { html += `<div class="tm-era" style="left:10px;top:${laneY[l] + 15}px">${l}</div>`; });
  for (const f of FOCUS) {
    const p = pos(f), st = focusState(f, n);
    const cls = { done: 'known', cur: 'cur', avail: 'avail', locked: '', blocked: 'dim' }[st];
    const sub = st === 'done' ? '已完成' : st === 'cur' ? `进行中 ${Math.round(S.player.focus.prog / f.sec * 100)}%` : st === 'blocked' ? '与已选道路互斥' : st === 'avail' ? `约 ${secYears(f.sec)} 年` : f.tech && n.techs[f.tech] === undefined ? `需要「${TECH_BY_ID[f.tech].name}」` : f.minEra > n.mult.era ? `需要${ERA_NAME[f.minEra]}时代` : '前置未完成';
    html += `<button class="tn ${cls}${fSel === f.id ? ' sel' : ''}" data-f="${f.id}" style="left:${p.x}px;top:${p.y}px;--bc:${laneColor(f.lane)}"><div class="n1">${esc(f.name)}</div><div class="n2">${esc(sub)}</div>${st === 'cur' ? `<span class="pb" style="width:${(S.player.focus.prog / f.sec * 146).toFixed(0)}px"></span>` : ''}</button>`;
  }
  const cv = $('fmCanvas'); cv.style.width = Wd + 'px'; cv.style.height = Ht + 'px'; cv.innerHTML = html;
  const F = fSel ? FOCUS_BY_ID[fSel] : null, d = $('fmDetail');
  if (!F) { d.innerHTML = `<h3>国策树</h3><p>国策是你治理国家的长期方向。每次只能推进一项，完成后永久生效。</p><p>中间的意识形态道路彼此互斥：选择一条，就会在国内培植这种思想，并可能引发政体更替甚至内战。</p><p class="note">政治点数 ${Math.floor(S.player.pp)}。</p>`; return; }
  const st = focusState(F, n);
  d.innerHTML = `<h3>${esc(F.name)}</h3><div class="tags"><span class="tag">${esc(F.lane)}</span><span class="tag">约 ${secYears(F.sec)} 年</span></div><p>${esc(F.desc)}</p><div class="fx">效果：${esc(F.fxt)}</div>
    ${F.req.length ? `<h4>前置国策</h4><p>${F.req.map(r => esc(FOCUS_BY_ID[r].name)).join('、')}</p>` : ''}${F.excl.length ? '<h4>互斥</h4><p>其他意识形态道路</p>' : ''}
    <div class="acts"><button class="btn primary" data-fstart="${F.id}" ${st !== 'avail' ? 'disabled' : ''}>${st === 'done' ? '已完成' : st === 'cur' ? '正在推进' : S.player.focus ? '替换当前国策' : '开始推进'}</button></div>
    ${S.player.focus && st === 'avail' ? '<p class="note">替换会丢失当前国策的进度。</p>' : ''}`;
}
function laneColor(l) { return { 内政: '#b8a2ff', 经济: '#ffb547', 科学: '#5cc4e6', 军事: '#ff6b6b', 外交: '#7fd18b', 民主: IDEO_BY_ID.liberal.color, 共产: IDEO_BY_ID.communist.color, 法西斯: IDEO_BY_ID.fascist.color, 君主: IDEO_BY_ID.monarchy.color, 神权: IDEO_BY_ID.theocracy.color, 技术官僚: IDEO_BY_ID.technocracy.color, 星际: '#d7a6ff' }[l]; }
$('fmCanvas').addEventListener('click', e => { const b = e.target.closest('[data-f]'); if (b) { fSel = b.dataset.f; renderFocusTree(); } });
$('fmDetail').addEventListener('click', e => { const b = e.target.closest('[data-fstart]'); if (!b) return; S.player.focus = { id: b.dataset.fstart, prog: 0 }; renderFocusTree(); $('pane-me')._html = ''; });
$('fmClose').addEventListener('click', () => { $('focusModal').hidden = true; });
