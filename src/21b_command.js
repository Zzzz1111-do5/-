/* =====================================================================
   军务 (military affairs) for leader mode: where to build which factories
   and bases, which units to produce and how many, how many soldiers to keep
   (conscription law), and which units to retire. The simulation side lives
   in 06p_prod.js; this file is only the modal and its handlers.
   ===================================================================== */
let mmTab = 'build', mmOpen = false, mmDom = 'land';
const BLD_SHORT = { cf: '民', mf: '军', dock: '坞', army: '陆', navy: '海', air: '空', fort: '塞' };
function openMil(tab) {
  if (!playerNation()) return;
  if (tab) mmTab = tab;
  $('milModal').hidden = false; mmOpen = true;
  $('mmBody')._tab = null; renderMil();
}
function closeMil() { $('milModal').hidden = true; mmOpen = false; }
function renderMil() {
  if (!mmOpen) return;
  const n = playerNation(), body = $('mmBody');
  if (!n || !n.alive) { closeMil(); return; }
  for (const b of $('mmTabs').children) b.setAttribute('aria-selected', b.dataset.mm === mmTab);
  if (body._tab !== mmTab) { body.innerHTML = '<div class="mm-wrap"><div id="mmA"></div><div id="mmB"></div></div>'; body._tab = mmTab; body.scrollTop = 0; }
  const [a, b] = mmTab === 'build' ? [milBuildTop(n), milBuildCities(n)] : mmTab === 'prod' ? [milProdTop(n), milProdCards(n)] : [milForceTop(n), milForceStock(n)];
  setHTML($('mmA'), a); setHTML($('mmB'), b);
}
function yrs(v) { return !isFinite(v) ? '—' : v < 1 ? '<1 年' : v < 10 ? v.toFixed(1) + ' 年' : Math.round(v) + ' 年'; }

/* ---------- 建设 ---------- */
function milBuildTop(n) {
  const e = n.eco, P = S.player, q = n.bq || [], conc = buildConc(n), sp = e.spend || 0, a = e.alloc;
  const inflow = sp * (0.35 * a[3] + 0.15 * a[2]);
  let act = 0;
  const rows = q.slice(0, 40).map((it, k) => {
    const c = cityById(it.c), K = BLD_KINDS[it.k]; if (!c || !K) return '';
    const running = it.paid && act < conc; if (running) act++;
    const afford = (e.fund[2] || 0) + Math.max(0, e.treasury - 0.3 * (e.rev || 0)) >= buildCost(n, it.k, c);
    const st = it.paid ? (running ? `施工 ${Math.round(it.p * 100)}%` : '排队') : k < conc ? (afford ? '待开工' : '等待资金') : '排队';
    return `<span>${esc(c.name)}</span><span>${esc(bldName(it.k, n))}${K.lv ? ` → ${bget(c, it.k) + 1} 级` : ''}</span><span class="st">${st}</span><button class="btn small" data-bx="${k}" aria-label="取消">×</button>
      <span class="track" style="grid-column:1/-1"><span class="fill" style="width:${(it.p * 100).toFixed(0)}%"></span></span>`;
  }).join('');
  return `<div class="kpis">
      <div class="kpi"><span class="k">建设资金</span><span class="v">${fmtMoney(e.fund[2] || 0)} <small>+${fmtMoney(inflow)}/年</small></span></div>
      <div class="kpi"><span class="k">国库</span><span class="v">${fmtMoney(e.treasury)}</span></div>
      <div class="kpi"><span class="k">同时施工</span><span class="v">${act} / ${conc}</span></div>
    </div>
    <p class="note">建设资金来自「产业」和「基建」预算，不够时动用国库（保留三成年税收作储备）。工业越发达，能同时开工的项目越多。</p>
    <label class="chk"><input type="checkbox" data-mmauto="build"${P.autoBuild !== false ? ' checked' : ''}> 自动建设：你的队列有空位时，由顾问补建缺少的军工厂、船坞和基地</label>
    <h3>建设队列 <small>${q.length ? q.length + ' 项' : ''}</small></h3>
    ${q.length ? `<div class="bq">${rows}</div>${q.length > 40 ? `<p class="note">还有 ${q.length - 40} 项排在后面。</p>` : ''}` : '<p class="note">队列是空的。在下面的城市列表里，或者点地图上的本国城市来下令建设。</p>'}`;
}
function milBuildCities(n) {
  const cities = n.cl.slice().sort((a, b) => b.cap - a.cap || b.pop - a.pop), ref = cities[0];
  const leg = BLD_ORDER.map(k => `<span><b>${BLD_SHORT[k]}</b> ${esc(bldName(k, n))} ${ref ? fmtMoney(buildCost(n, k, ref)) : ''}</span>`).join('');
  return `<h3>城市 <small>用地 = 民用工厂 + 军工厂 + 船坞；基地和要塞最高 3 级</small></h3>
    <div class="bleg">${leg}</div>
    ${cities.map(c => cityBuildRow(n, c)).join('')}`;
}
function bldSummary(c, n) { return BLD_ORDER.filter(k => bget(c, k)).map(k => `${BLD_SHORT[k]}${BLD_KINDS[k].lv ? bget(c, k) + '级' : '×' + bget(c, k)}`).join(' '); }
function bldButtons(n, c, cls) {
  return BLD_ORDER.map(k => {
    const why = canBuild(n, c, k), K = BLD_KINDS[k];
    return `<button class="${cls}" data-bc="${c.id}" data-bk="${k}" ${why ? `disabled title="${esc(bldName(k, n))}：${esc(why)}"` : `title="${esc(bldName(k, n))}：${fmtMoney(buildCost(n, k, c))}，${esc(K.desc)}"`}>${BLD_SHORT[k]}${K.lv ? '↑' : '+'}</button>`;
  }).join('');
}
function cityBuildRow(n, c) {
  const have = bldSummary(c, n), q = queuedAt(n, c);
  return `<div class="crow"><span class="cn">${esc(c.name)}${c.cap ? ' · 首都' : ''}<small>${fmtPop(c.pop)}${c.coastal ? ' · 沿海' : ''}</small></span>
    <span class="cb">用地 ${slotsUsed(c) + queuedSlots(n, c)}/${citySlots(c)}${have ? ' · ' + have : ''}${q ? ` · 在建 ${q}` : ''}</span>
    <span class="bchips">${bldButtons(n, c, 'bchip')}</span></div>`;
}

/* ---------- 生产 ---------- */
function batchUE(u) { const per = dispOf(u)[0]; return u.dom === 'sea' && per < 1 ? 1 / per : 1; }
function milProdTop(n) {
  const mx = ensureMil(n), F = milForces(n), P = prodCap(n), q = mx.queue || [];
  let poolLeft = [P.pm, P.pd];
  const rows = q.map((o, k) => {
    const u = UNIT_BY_ID[o.u]; if (!u) return '';
    const sea = u.dom === 'sea' ? 1 : 0, cost = o.n * u.cost, eta = poolLeft[sea] > 0 ? cost / poolLeft[sea] : Infinity;
    const done = o.done || 0, frac = done / Math.max(1e-6, done + o.n);
    return `<span>${esc(u.name)} <small class="dim">${MIL_ROLE_NAME[CROLE[u.id][0]]}</small></span><span>还差 ${dispNum(u, o.n)} ${dispOf(u)[1]}</span><span class="st">约 ${yrs(eta)}</span>
      <span class="ob"><button class="btn small" data-oq="${k}" data-d="1" aria-label="多造一批">+</button><button class="btn small" data-oq="${k}" data-d="-1" aria-label="少造一批">−</button><button class="btn small" data-ox="${k}" aria-label="取消订单">×</button></span>
      <span class="track" style="grid-column:1/-1"><span class="fill" style="width:${(frac * 100).toFixed(0)}%"></span></span>`;
  }).join('');
  const over = F.tot > F.cap * 1.02;
  return `<div class="kpis">
      <div class="kpi"><span class="k">军工产能 · ${P.mf} 座${bldName('mf', n)}</span><span class="v">${fmtNum(P.pm)} <small>点/年</small></span></div>
      <div class="kpi"><span class="k">船坞产能 · ${P.dk} 座${bldName('dock', n)}</span><span class="v">${fmtNum(P.pd)} <small>点/年</small></span></div>
      <div class="kpi"><span class="k">现役 / 编制</span><span class="v">${Math.round(F.tot)} / ${Math.round(F.cap)}</span></div>
    </div>
    <p class="note">军工厂造陆军装备和飞机，船坞只造舰船。${over ? '<b style="color:var(--blood)">部队已超编：多出来的装备只能封存，不增加战斗力。</b>' : '编制没满时，新造的部队直接形成战斗力。'}</p>
    <label class="chk"><input type="checkbox" data-mmauto="prod"${mx.prodAuto !== false ? ' checked' : ''}> 自动补充：订单之外剩余的产能，按「国家」页的军种比例自动补齐编制、换装新型号</label>
    <h3>生产订单 <small>${q.length ? '按顺序优先分配产能' : ''}</small></h3>
    ${q.length ? `<div class="oq">${rows}</div>` : '<p class="note">还没有订单。在下面选择要生产的装备。</p>'}`;
}
function milProdCards(n) {
  const P = prodCap(n), m = n.mult;
  const seg = DOMS.map(d => `<button data-mmdom="${d}" aria-pressed="${mmDom === d}">${DOM_NAME[d]}</button>`).join('');
  const cards = [];
  for (const r of ROLES[mmDom]) {
    const best = UNIT_BY_ID[m.best[r]];
    const list = (UNITS_BY_ROLE[r] || []).filter(u => CROLE[u.id][0] === r && unitBuildable(n, u) && (!best || u.rating >= best.rating * 0.4)).sort((a, b) => b.rating - a.rating).slice(0, 3);
    for (const u of list) {
      const bu = batchUE(u), cost = bu * u.cost, pool = u.dom === 'sea' ? P.pd : P.pm, d = dispOf(u);
      cards.push(`<div class="ucard${best && u.id !== best.id ? ' old' : ''}">
        <div class="un"><span>${esc(u.name)}</span><small>${MIL_ROLE_NAME[r]}${best && u.id === best.id ? ' · 最新' : ''}</small></div>
        <div class="us">攻 ${u.atk} · 防 ${u.def} · 每批 ${dispNum(u, bu)} ${d[1]} · ${fmtNum(cost)} 点 · 约 ${yrs(pool > 0 ? cost / pool : Infinity)}</div>
        ${u.desc ? `<div class="us">${esc(u.desc)}</div>` : ''}
        <div class="ub"><button class="btn small" data-ou="${u.id}" data-k="1">下单 1 批</button><button class="btn small" data-ou="${u.id}" data-k="5">5 批</button><button class="btn small" data-ou="${u.id}" data-k="20">20 批</button></div>
      </div>`);
    }
  }
  const note = mmDom === 'sea' && !n.cl.some(c => c.coastal) ? '没有沿海城市，造不了船。' : mmDom === 'sea' && !P.dk ? '还没有船坞：舰船只能靠沿海渔港慢慢补充。先在沿海城市建船坞。' : mmDom === 'air' && !m.airOK ? '尚未掌握军用航空。' : '';
  return `<h3>下单生产</h3><div class="seg useg">${seg}</div>${note ? `<p class="note">${note}</p>` : ''}<div class="ucards">${cards.join('') || '<p class="note">这个军种暂时没有可以生产的装备。</p>'}</div>`;
}

/* ---------- 兵力 ---------- */
function soldiersOf(n) { let s = 0; const st = n.mx.stock || {}, act = milForces(n).act; for (const id in st) { const u = UNIT_BY_ID[id]; if (u && dispOf(u)[1] === '人') s += st[id] * dispOf(u)[0] * act; } return s; }
function milForceTop(n) {
  const F = milForces(n), L = lawOf(n), fillW = Math.min(1, F.tot / Math.max(1e-6, F.cap)), over = F.tot > F.cap ? (F.tot - F.cap) / F.tot : 0;
  return `<h3>征兵法令 <small>决定能养多少兵（编制）</small></h3>
    <div class="lawseg">${LAW_NAME.map((t, k) => `<button data-law="${k}" aria-pressed="${L === k}">${t}<small>${LAW_DESC[k]}</small></button>`).join('')}</div>
    <h3>编制 <small>现役 ${Math.round(F.tot)} / 编制 ${Math.round(F.cap)}（单位：营 / 中队 / 舰）</small></h3>
    <div class="capbar"><span class="fill" style="width:${(fillW * 100).toFixed(1)}%"></span>${over > 0.005 ? `<span class="over" style="width:${(over * 100).toFixed(1)}%"></span>` : ''}</div>
    <p class="note">编制由人口、军费预算（「国家」页）和征兵法令决定。${over > 0.02 ? `超编 ${Math.round(over * 100)}%：多出来的部队封存待命，不增加战斗力，可以退役旧型号腾出编制。` : F.tot < F.cap * 0.9 ? '编制没满：多建军工厂、船坞，或者下生产订单来补齐。' : '编制已满。'}现役兵员约 ${fmtNum(soldiersOf(n))} 人。</p>`;
}
function milForceStock(n) {
  const st = ensureMil(n).stock || {}, m = n.mult, act = milForces(n).act;
  const by = { land: [], sea: [], air: [] };
  for (const id in st) { const u = UNIT_BY_ID[id]; if (u && CROLE[id].length) by[u.dom].push([u, st[id]]); }
  return DOMS.map(d => {
    const list = by[d].sort((a, b) => b[1] - a[1]); if (!list.length) return '';
    return `<h3>${DOM_NAME[d]}</h3>` + list.map(([u, ue]) => {
      const r = CROLE[u.id][0], best = UNIT_BY_ID[m.best[r]], main = best && best.id === u.id, old = best && u.rating < best.rating * 0.8;
      return `<div class="stk"><span>${esc(u.name)}<span class="tagx${main ? ' main' : ''}">${main ? '主力' : old ? '老旧' : MIL_ROLE_NAME[r]}</span></span><span>${dispNum(u, ue * act)} ${dispOf(u)[1]}${act < 0.995 ? ` <span class="dim">(另封存 ${dispNum(u, ue * (1 - act))})</span>` : ''}</span><span class="dim">攻防 ${Math.round(u.rating)}</span><button class="btn small" data-rt="${u.id}" title="退役四分之一，腾出编制">退役¼</button></div>`;
    }).join('');
  }).join('') || '<p class="note">还没有任何部队。</p>';
}

/* ---------- handlers ---------- */
$('mmClose').addEventListener('click', closeMil);
$('mmTabs').addEventListener('click', e => { const b = e.target.closest('[data-mm]'); if (!b) return; mmTab = b.dataset.mm; renderMil(); });
$('mmBody').addEventListener('click', e => {
  const n = playerNation(); if (!n) return;
  const t = e.target;
  const bc = t.closest('[data-bc]');
  if (bc) { const c = cityById(+bc.dataset.bc); if (c) { const r = queueBuild(n, c, bc.dataset.bk, 1); if (r.ok) showTicker('civ', r.msg); else flashHint(r.msg); } }
  const bx = t.closest('[data-bx]'); if (bx) cancelBuild(n, +bx.dataset.bx);
  const ou = t.closest('[data-ou]');
  if (ou) { const u = UNIT_BY_ID[ou.dataset.ou]; if (u) { const r = queueUnit(n, u.id, batchUE(u) * dispOf(u)[0] * +ou.dataset.k); if (r.ok) showTicker('war', r.msg); else flashHint(r.msg); } }
  const oq = t.closest('[data-oq]');
  if (oq) { const o = (n.mx.queue || [])[+oq.dataset.oq], u = o && UNIT_BY_ID[o.u]; if (u) { o.n = Math.max(0, o.n + batchUE(u) * +oq.dataset.d); if (o.n <= 1e-6) n.mx.queue.splice(+oq.dataset.oq, 1); } }
  const ox = t.closest('[data-ox]'); if (ox) (n.mx.queue || []).splice(+ox.dataset.ox, 1);
  const md = t.closest('[data-mmdom]'); if (md) mmDom = md.dataset.mmdom;
  const lw = t.closest('[data-law]'); if (lw && setLaw(n, +lw.dataset.law)) showTicker('war', `征兵法令改为「${LAW_NAME[n.law]}」`);
  const rt = t.closest('[data-rt]'); if (rt) { const u = UNIT_BY_ID[rt.dataset.rt], x = retireUnit(n, rt.dataset.rt, 0.25); if (u && x) showTicker('war', `${u.name}退役 ${dispNum(u, x)} ${dispOf(u)[1]}`); }
  $('mmBody')._hold = 0; $('mmA')._html = ''; $('mmB')._html = ''; renderMil();
  $('pane-me')._html = '';
});
$('mmBody').addEventListener('change', e => {
  const n = playerNation(), k = e.target.dataset && e.target.dataset.mmauto; if (!n || !k) return;
  if (k === 'build') S.player.autoBuild = e.target.checked;
  if (k === 'prod') ensureMil(n).prodAuto = e.target.checked;
  $('mmBody')._hold = 0; $('mmA')._html = ''; renderMil();
});
holdOnInteract($('mmBody'));
