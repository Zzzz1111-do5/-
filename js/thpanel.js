'use strict';
// 编队面板与战线画面（钢铁雄心式，配合 theater.js）：
//   左侧竖排本方的师 / 团 / 营 / 连卡片——编制记号、番号、当前命令、兵力条、组织度条、状态（人数、车数）、命令传达中的倒计时；
//   点卡片选中（Shift / Ctrl 多选），▸ 展开下级，双击把镜头移过去；下令：推进 · 穿插（再点地图选目标）· 坚守 · 后撤 · 预备队 · 自动（交还战区）
//   观战（双方都由 AI 指挥）时面板只看不下令，可切换看攻方 / 守方
//   地图上：编队标号（远看画师、近看画营连）、地段分界、命令箭头（推进宽箭头、穿插长箭头、后撤回头箭头、坚守弧线、预备队虚圈）、
//     攻方阶段线；选中的编队高亮它的战线地段，并用虚线连到下级
//   玩家不能直接操控舰船、航母、单个排：左键点部队只显示型号卡，并在面板里选中它所属的营；左键拖动 / WASD / 方向键移动视角
const THU = { sel: new Set(), open: {}, side: 'p', pick: null, min: null, t: 0, hit: [], hit3: [], key: '' };
const THU_ST = { asm: '集结', move: '开进', deploy: '展开', assault: '交战', clear: '肃清', regroup: '重整', hold: '防御', local: '就地反冲击', reserve: '待机', withdraw: '后撤' };
const THU_ORD = [['advance', '推进', '整条地段战线一步步往前压，据点随战线推进夺取'], ['spear', '穿插', '选中后点地图上的目标：最能打的一个营（装甲优先）向目标突击，其余跟着推进'],
  ['hold', '坚守', '就地挖工事坚守地段战线'], ['retreat', '后撤', '后撤约 240 米再坚守'], ['reserve', '预备队', '撤出战线，到后方隐蔽集结待命'], ['auto', '自动', '交还战区 AI 统一指挥']];
const thuActive = () => !!S && S.phase === 'battle';   // 编队指挥模式：不再点选 / 下令单个部队
const thuCan = () => !!S && !!S.ctl && S.phase === 'battle' && THU.side === S.ctl;

// ———————————————— 面板 ————————————————
const THU_CSS = `
#thPanel { left: max(16px, env(safe-area-inset-left, 0px)); top: calc(118px + env(safe-area-inset-top, 0px)); bottom: calc(206px + env(safe-area-inset-bottom, 0px));
  width: 276px; display: flex; flex-direction: column; padding: 0; font-size: 12px; pointer-events: auto; z-index: 4; }
#thPanel.min { bottom: auto; }
#thPanel header { display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-bottom: 1px solid var(--line); }
#thPanel header b { flex: 1; color: var(--g-hi); font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#thPanel header button { background: transparent; border: 1px solid var(--line); border-radius: 4px; padding: 1px 7px; color: var(--mute); font-size: 11px; }
#thPanel header button.on { color: var(--g-hi); border-color: var(--line-hi); }
#thPanel .th-list { overflow-y: auto; flex: 1; padding: 5px; display: grid; gap: 3px; align-content: start; scrollbar-width: thin; }
#thPanel.min .th-list, #thPanel.min footer, #thPanel.min .th-tip { display: none; }
#thPanel .th-row { display: grid; grid-template-columns: 12px 28px minmax(0, 1fr) auto; grid-template-areas: "car ech nm chip" ". bar bar bar" ". st st tx"; gap: 2px 5px;
  padding: 4px 6px; border: 1px solid var(--line); border-radius: 4px; background: rgba(var(--pn-rgb), .55); cursor: pointer; user-select: none; }
#thPanel .th-row:hover { border-color: var(--line-hi); }
#thPanel .th-row.lv-bde { margin-left: 9px; } #thPanel .th-row.lv-reg { margin-left: 18px; }
#thPanel .th-row.sel { border-color: var(--amber); background: rgba(var(--amber-rgb), .13); }
#thPanel .th-car { grid-area: car; color: var(--mute); font-size: 10px; align-self: center; }
#thPanel .th-ech { grid-area: ech; font: 600 10px var(--f-ui); color: var(--g); text-align: center; border: 1px solid var(--line-hi); border-radius: 3px; line-height: 15px; align-self: center; }
#thPanel .e .th-ech { color: var(--enemy); border-color: rgba(var(--enemy-rgb), .6); }
#thPanel .th-nm { grid-area: nm; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; align-self: center; }
#thPanel .th-chip { grid-area: chip; font-size: 11px; padding: 0 6px; border-radius: 9px; border: 1px solid var(--line-hi); align-self: center; white-space: nowrap; }
#thPanel .th-chip.pl { border-color: var(--amber); color: var(--amber); }
#thPanel .th-bar { grid-area: bar; display: grid; grid-template-columns: 1fr 1fr; gap: 5px; }
#thPanel .th-bar span { height: 4px; background: rgba(255, 255, 255, .09); border-radius: 2px; overflow: hidden; }
#thPanel .th-bar i { display: block; height: 100%; background: var(--g); }
#thPanel .th-bar .org i { background: var(--amber); }
#thPanel .th-st { grid-area: st; color: var(--mute); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#thPanel .th-tx { grid-area: tx; color: var(--amber); font-size: 11px; white-space: nowrap; }
#thPanel .th-empty { color: var(--mute); padding: 8px; }
#thPanel footer { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px; padding: 6px; border-top: 1px solid var(--line); }
#thPanel footer button { padding: 5px 0; border: 1px solid var(--line-hi); border-radius: 4px; background: rgba(var(--pn-rgb), .9); font-size: 12px; }
#thPanel footer button.on { border-color: var(--amber); color: var(--amber); }
#thPanel .th-tip { padding: 0 8px 6px; color: var(--mute); font-size: 11px; }
body.th-on #cards, body.th-on #cmdBox, body.th-on #reserveBox { display: none !important; }
body.th-on #info { left: auto; right: max(16px, env(safe-area-inset-right, 0px)); }
body.th-on #feed li:nth-child(n+4) { display: none; }
@media (max-width: 760px) {
  #thPanel { top: calc(96px + env(safe-area-inset-top, 0px)); width: min(276px, 74vw); bottom: calc(230px + env(safe-area-inset-bottom, 0px)); }
}`;
function thuEl() {
  if (typeof document === 'undefined' || !document.getElementById) return null;
  let el = document.getElementById('thPanel');
  if (el) return el;
  const st = document.createElement('style'); st.textContent = THU_CSS; document.head.appendChild(st);
  el = document.createElement('div'); el.id = 'thPanel'; el.className = 'ov box';
  el.innerHTML = `<header><b id="thTitle">战区</b><span class="th-sw"><button type="button" data-side="p">攻方</button> <button type="button" data-side="e">守方</button></span>` +
    `<button type="button" class="th-mn" title="收起 / 展开编队列表">–</button></header><div class="th-list" role="list"></div>` +
    `<footer>${THU_ORD.map(([k, n, tip]) => `<button type="button" data-ord="${k}" title="${tip}">${n}</button>`).join('')}</footer><div class="th-tip"></div>`;
  (document.getElementById('stage') || document.body).appendChild(el);
  el.addEventListener('click', thuPanelClick);
  el.addEventListener('dblclick', e => { const r = e.target.closest('[data-f]'); if (r) thuCenter(thF(r.dataset.f)); });
  if (THU.min == null) THU.min = typeof innerWidth === 'number' && innerWidth < 760;
  return el;
}
function thuPanelClick(e) {
  const t = e.target;
  if (t.closest('.th-mn')) { THU.min = !THU.min; THU.key = ''; thuRender(true); return; }
  const sw = t.closest('[data-side]');
  if (sw) { THU.side = sw.dataset.side; THU.sel.clear(); THU.pick = null; THU.key = ''; thuRender(true); return; }
  const ob = t.closest('[data-ord]');
  if (ob) { thuOrder(ob.dataset.ord); return; }
  const r = t.closest('[data-f]');
  if (!r) return;
  const F = thF(r.dataset.f);
  if (!F) return;
  if (t.closest('.th-car') && F.lvl !== 'reg') { THU.open[F.id] = THU.open[F.id] === false; THU.key = ''; thuRender(true); return; }
  if (e.shiftKey || e.ctrlKey || e.metaKey) { THU.sel.has(F.id) ? THU.sel.delete(F.id) : THU.sel.add(F.id); } else { THU.sel.clear(); THU.sel.add(F.id); }
  THU.pick = null; THU.key = '';
  thuRender(true);
}
// 下令：同时选中了上级和它的下级，只对上级下（命令会自己传下去）
function thuOrder(v) {
  if (!thuCan()) return;
  const sel = [...THU.sel].map(thF).filter(F => F && F.side === S.ctl);
  const top = sel.filter(F => !sel.some(P => P !== F && thuAnc(P, F)));
  if (!top.length) return;
  if (v === 'spear') { THU.pick = THU.pick === 'spear' ? null : 'spear'; THU.key = ''; thuRender(true); return; }
  THU.pick = null;
  for (const F of top) thPlayer(F, v);
  THU.key = ''; thuRender(true);
}
const thuAnc = (P, F) => { for (let k = thF(F.par); k; k = thF(k.par)) if (k === P) return true; return false; };
function thuCenter(F) {
  const c = F && (F.lvl === 'reg' ? (G => G && { x: G.ax, y: G.ay })(thG(F)) : thAt(F));
  if (!c || typeof camCenter !== 'function') return;
  if (CAM.z < CAM.fit * 2.6) CAM.z = CAM.fit * 2.6;
  camCenter(c.x, c.y);
}
function thuPct(v) { return Math.round(clamp(v, 0, 1) * 100); }
function thuStat(F) {
  if (F.lvl === 'reg') {
    const G = thG(F);
    if (!G) return '—';
    const m = G.thMode === 'stall' ? '受阻·请求火力' : G.thMode === 'fb' ? '顶不住·后撤一段' : THU_ST[G.st] || G.st || '';
    return m;
  }
  const regs = thRegsOf(F).map(thG).filter(Boolean), n = s => regs.filter(G => G.st === s).length;
  return n('assault') || n('clear') ? '交战' : n('withdraw') ? '后撤' : n('move') || n('deploy') || n('asm') ? '开进' : n('reserve') ? '待机' : '防御';
}
function thuRow(F) {
  const e = F.side === 'e', O = thOrdOf(F), p0 = F.lvl === 'reg' ? F.p0 || 1 : thP0(F) || 1, str = thPow(F) / p0, org = thOrg(F) / 100;
  const men = thMen(F), nv = thVehN(F), ech = F.lvl === 'div' ? 'XX' : F.lvl === 'bde' ? 'III' : F.ech || 'II';
  const kids = F.lvl === 'reg' ? [] : thKids(F).filter(K => thRegsOf(K).length), open = THU.open[F.id] !== false;
  const tx = F.box && F.box.length ? `⏳ 传达中 ${Math.max(0, Math.ceil(F.box[0].at - S.t))}s` : '';
  const chip = `${F.man ? '✋' : ''}${thVerb(O)}`;
  return `<div class="th-row lv-${F.lvl}${e ? ' e' : ''}${THU.sel.has(F.id) ? ' sel' : ''}" data-f="${F.id}" role="listitem">` +
    `<i class="th-car">${kids.length ? (open ? '▾' : '▸') : ''}</i><span class="th-ech">${ech}</span><span class="th-nm" title="${F.name}">${F.name}</span>` +
    `<span class="th-chip${F.man ? ' pl' : ''}" title="${F.man ? '玩家命令' : '战区 AI'}">${chip}</span>` +
    `<div class="th-bar"><span title="兵力 ${thuPct(str)}%"><i style="width:${thuPct(str)}%"></i></span><span class="org" title="组织度 ${thuPct(org)}%"><i style="width:${thuPct(org)}%"></i></span></div>` +
    `<span class="th-st">${thuStat(F)} · ${men} 人${nv ? ` · ${nv} 车` : ''}${F.lvl !== 'reg' && kids.length ? ` · ${kids.length} 个${F.lvl === 'div' ? '团' : '营连'}` : ''}</span><span class="th-tx">${tx}</span></div>`;
}
function thuRows(side) {
  const R = thRoot(side);
  if (!R) return '';
  const out = [], add = F => {
    if (!thRegsOf(F).length) return;
    out.push(thuRow(F));
    if (F.lvl !== 'reg' && THU.open[F.id] !== false) for (const K of thKids(F)) add(K);
  };
  for (const D of thKids(R)) add(D);
  return out.join('');
}
function thuRender(force) {
  const el = thuEl();
  if (!el) return;
  const on = thuActive() && !!S.th && S.phase === 'battle';
  document.body.classList.toggle('th-on', thuActive());
  el.hidden = !on;
  if (!on) return;
  if (!S.ctl) { if (!['p', 'e'].includes(THU.side)) THU.side = 'p'; } else THU.side = S.ctl;
  for (const id of [...THU.sel]) if (!thF(id)) THU.sel.delete(id);
  el.classList.toggle('min', !!THU.min);
  el.querySelector('.th-mn').textContent = THU.min ? '编队 ▾' : '–';
  const sw = el.querySelector('.th-sw');
  sw.hidden = !!S.ctl;
  for (const b of sw.querySelectorAll('button')) b.classList.toggle('on', b.dataset.side === THU.side);
  const R = thRoot(THU.side), T = S.th[THU.side];
  el.querySelector('#thTitle').textContent = `${R ? R.name : '战区'}${THU.side === 'p' && T ? ` · 阶段线 ${T.k}` : ''}`;
  const rows = thuRows(THU.side) || `<div class="th-empty">${THU.side === 'p' ? '部队还在海上：上岸后按地段编成师、团、营。' : '机动兵力编组中。'}</div>`;
  const list = el.querySelector('.th-list');
  if (force || rows !== THU.key) { const top = list.scrollTop; list.innerHTML = rows; list.scrollTop = top; THU.key = rows; }
  const can = thuCan(), has = [...THU.sel].some(id => { const F = thF(id); return F && F.side === S.ctl; });
  const ft = el.querySelector('footer');
  ft.hidden = !can;
  for (const b of ft.querySelectorAll('button')) { b.disabled = !has; b.classList.toggle('on', b.dataset.ord === 'spear' && THU.pick === 'spear'); }
  el.querySelector('.th-tip').textContent = !S.ctl ? '观战：双方都由 AI 指挥，面板只看不下令。' : THU.pick === 'spear' ? '穿插：在地图上点目标（右键 / Esc 取消）' : has ? '选中的编队：点下方命令；命令按级传达需要几秒。' : '点卡片选中编队（Shift 多选）；双击卡片移到它那里。';
}
HOOK.frame.push(() => {
  if (!S) return;
  if (thuActive() && S.sel && S.sel.length) S.sel = [];   // 部署时选中的舰船 / 排开战后不再留着（编队指挥模式下不能直接操控）
  const now = performance.now(); if (now - THU.t < 400) return; THU.t = now; thuRender(false);
});
HOOK.newGame.push(() => { THU.sel.clear(); THU.pick = null; THU.open = {}; THU.key = ''; thuRender(true); });

// ———————————————— 地图点击 ————————————————
// 左键：穿插选目标 → 编队标号 → 部队（显示型号卡、选中它所属的营）→ 空地取消选择
function thuClick(p, add) {
  if (!S || !p) return;
  if (THU.pick === 'spear' && thuCan()) {
    const sel = [...THU.sel].map(thF).filter(F => F && F.side === S.ctl), top = sel.filter(F => !sel.some(P => P !== F && thuAnc(P, F)));
    for (const F of top) thPlayer(F, 'spear', p.x, p.y);
    THU.pick = null; THU.key = ''; thuRender(true);
    return;
  }
  const h = THU.hit.find(o => p.x >= o.r[0] && p.x <= o.r[2] && p.y >= o.r[1] && p.y <= o.r[3]);
  if (h) { thuSelect(h.F, add); return; }
  const r = Math.max(10, px(14));
  let best = null, bd = r;
  const seen = o => S.ctl ? o.side === S.ctl || (o.side === 'e' ? inVision(o.x, o.y) : spotted(o.x, o.y)) : true;
  for (const q of S.teams) if (q.men.length && !q.ride && seen(q)) { const d = dist(q.x, q.y, p.x, p.y); if (d < bd) { bd = d; best = { k: 'team', o: q }; } }
  for (const v of S.veh || []) if (!v.dead && !v.lst && seen(v)) { const d = dist(v.x, v.y, p.x, p.y); if (d < bd) { bd = d; best = { k: 'veh', o: v }; } }
  if (best) {
    S.sel = [];
    if (typeof U === 'object') U.info = { k: best.k, id: best.o.id };
    const G = best.k === 'veh' ? (S.bgs || []).find(g => g.id === best.o.bgG && !g.dead) : (S.bgs || []).find(g => !g.dead && g.th && g.us.includes(best.o.u));
    const F = G && thF(G.th);
    if (F && (!S.ctl || F.side === S.ctl || THU.side === F.side)) thuSelect(F, add, true);
    if (typeof infoRender === 'function') infoRender(true);
    if (typeof updateHud === 'function') updateHud();
    return;
  }
  if (!add) { THU.sel.clear(); THU.key = ''; if (typeof U === 'object') U.info = null; if (typeof infoRender === 'function') infoRender(true); thuRender(true); }
}
function thuSelect(F, add, keepInfo) {
  if (!add) THU.sel.clear();
  if (add && THU.sel.has(F.id)) THU.sel.delete(F.id); else THU.sel.add(F.id);
  if (!S.ctl) THU.side = F.side;
  for (let k = thF(F.par); k; k = thF(k.par)) THU.open[k.id] = true;   // 展开到它
  THU.min = false; THU.key = '';
  if (!keepInfo && typeof U === 'object') { U.info = null; if (typeof infoRender === 'function') infoRender(true); }
  thuRender(true);
  const el = document.querySelector(`#thPanel [data-f="${F.id}"]`);
  if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
}
function thuCancel() { if (THU.pick) { THU.pick = null; THU.key = ''; thuRender(true); return true; } return false; }

// ———————————————— 画面 ————————————————
// 北约式标号：步兵 ×、装甲椭圆、机步两者都有；上方编制记号，下方兵力条；选中的琥珀色描边
function thuMark(ctx, x, y, F, col, sel, a) {
  // 番号牌（营 / 连 / 师都一样）：左边北约兵种框（步兵 ×、装甲椭圆、机步两者都有）上加编制记号，右边番号、当前命令，底边兵力条；
  //   按屏幕像素定大小，立在部队头顶，引线落到部队位置
  const big = F.lvl === 'div', G = F.lvl === 'reg' ? thG(F) : null;
  const t = G ? G.type || 'inf' : (() => { let v = 0, n = 0; for (const R of thRegsOf(F)) { const g = thG(R); if (g) { const P = hqRegPow(g); v += P.veh; n += P.tot; } } return v / Math.max(1, n) >= .6 ? 'armor' : v / Math.max(1, n) >= .25 ? 'mech' : 'inf'; })();
  const fw = px(big ? 22 : 18), fh = px(big ? 15 : 12), verb = thVerb(thOrdOf(F)) + (F.box && F.box.length ? ' ⏳' : ''), named = CAM.z / CAM.fit > 1.2 || big;
  ctx.globalAlpha = a;
  ctx.font = 'bold ' + font(big ? 12 : 11); const w1 = named ? ctx.measureText(F.name).width : 0;
  ctx.font = font(9); const w2 = named ? ctx.measureText(verb).width : 0;
  const W0 = fw + px(10) + (named ? Math.max(w1, w2) + px(8) : 0), H0 = px(big ? 30 : 26), x0 = x - W0 / 2, y0 = y - H0 / 2;
  ctx.fillStyle = rgba(COL.bg, .85); ctx.fillRect(x0, y0, W0, H0);
  ctx.strokeStyle = sel ? COL.amber : rgba(col, .95); ctx.lineWidth = px(sel ? 2.4 : 1.3); ctx.strokeRect(x0, y0, W0, H0);
  ctx.fillStyle = rgba(col, .9); ctx.fillRect(x0, y0, px(2.5), H0);
  const fx = x0 + px(5) + fw / 2, fy = y + px(3);
  ctx.strokeStyle = rgba(col, .95); ctx.lineWidth = px(1.2); ctx.strokeRect(fx - fw / 2, fy - fh / 2, fw, fh);
  ctx.beginPath();
  if (t !== 'armor') { ctx.moveTo(fx - fw / 2, fy + fh / 2); ctx.lineTo(fx + fw / 2, fy - fh / 2); ctx.moveTo(fx - fw / 2, fy - fh / 2); ctx.lineTo(fx + fw / 2, fy + fh / 2); }
  if (t !== 'inf') ctx.ellipse(fx, fy, fw * .32, fh * .3, 0, 0, 6.283);
  ctx.stroke();
  ctx.fillStyle = rgba(col, .95); ctx.font = 'bold ' + font(big ? 9 : 8); ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.fillText(F.lvl === 'div' ? 'XX' : F.lvl === 'bde' ? 'III' : F.ech || 'II', fx, fy - fh / 2 - px(1.5));
  if (named) {
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.font = 'bold ' + font(big ? 12 : 11); ctx.fillText(F.name, fx + fw / 2 + px(5), y - px(5));
    ctx.font = font(9); ctx.fillStyle = F.man ? COL.amber : rgba(col, .75); ctx.fillText(verb, fx + fw / 2 + px(5), y + px(7));
  }
  const p0 = F.lvl === 'reg' ? F.p0 || 1 : thP0(F) || 1, s = clamp(thPow(F) / p0, 0, 1);
  ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(x0 + px(2.5), y0 + H0 - px(2.5), W0 - px(2.5), px(2.5));
  ctx.fillStyle = s > .5 ? rgba(col, .95) : s > .25 ? COL.amber : COL.enemy; ctx.fillRect(x0 + px(2.5), y0 + H0 - px(2.5), (W0 - px(2.5)) * s, px(2.5));
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.globalAlpha = 1;
  THU.hit.push({ F, r: [x0 - px(2), y0 - px(2), x0 + W0 + px(2), y0 + H0 + px(2)] });
}
// 命令箭头（从标号出发）：推进 = 向前的宽箭头；穿插 = 指向目标的长箭头 + 小旗；后撤 = 回头箭头；坚守 = 正面的弧线；预备队 / 第二梯队 = 虚圈
function thuArrow(ctx, F, x, y, col, a, side) {
  const O = thOrdOf(F), v = O.v, dir = thDir(side), w = px(F.lvl === 'div' ? 11 : 8);
  ctx.lineWidth = px(1.3);
  if (v === 'advance' || v === 'retreat') {
    const L = (v === 'advance' ? 1 : -1) * dir * (F.lvl === 'div' ? 150 : 95), y0 = y + dir * (v === 'advance' ? px(12) : -px(12));
    if (typeof hqArrow === 'function') hqArrow(ctx, [[x, y0], [x, y0 + L * .5], [x, y0 + L]], w, rgba(col, (v === 'advance' ? .3 : .18) * a), rgba(col, .85 * a), v === 'retreat' ? [px(5), px(4)] : null);
  } else if (v === 'spear' && O.x != null) {
    const d = dist(x, y, O.x, O.y), u = d > 60 ? 1 - 30 / d : .6;
    if (typeof hqArrow === 'function') hqArrow(ctx, [[x, y], [lerp(x, O.x, .5), lerp(y, O.y, .5)], [lerp(x, O.x, u), lerp(y, O.y, u)]], w * .9, rgba(COL.amber, .32 * a), rgba(COL.amber, .95 * a));
    if (typeof hqFlag === 'function') hqFlag(ctx, O.x, O.y, COL.amber, a);
  } else if (v === 'hold') {
    ctx.strokeStyle = rgba(col, .8 * a); ctx.lineWidth = px(2);
    ctx.beginPath(); ctx.arc(x, y + dir * px(4), px(16), dir < 0 ? Math.PI * 1.15 : Math.PI * .15, dir < 0 ? Math.PI * 1.85 : Math.PI * .85); ctx.stroke();
  } else if (v === 'reserve' || v === 'follow') {
    ctx.strokeStyle = rgba(col, .7 * a); ctx.setLineDash([px(4), px(4)]); ctx.lineWidth = px(1.3);
    ctx.beginPath(); ctx.ellipse(x, y, px(22), px(16), 0, 0, 6.283); ctx.stroke(); ctx.setLineDash([]);
  }
}
function thuDraw(time) {
  THU.hit = [];
  if (!thOn() || typeof R === 'undefined' || !R.ctx || (typeof V3 === 'object' && V3.drawing)) return;
  const ctx = R.ctx, zr = CAM.z / CAM.fit, far = zr < 2.1;
  ctx.save(); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  // 攻方阶段线（攻方视角或观战时）：沿当前战线所在的范围画虚线
  const T = S.th.p, cols = thCols('p');
  if (T && cols.length && (S.ctl === 'p' || !S.ctl) && S.points.some(p => p.owner !== 'p')) {
    const x0 = Math.max(0, frBX(cols[0]) - 300), x1 = Math.min(W, frBX(cols[cols.length - 1]) + 300);
    ctx.strokeStyle = rgba(COL.g, .5); ctx.lineWidth = px(1.4); ctx.setLineDash([px(10), px(6)]);
    ctx.beginPath(); for (let x = x0; x <= x1; x += 30) { const y = thPL(T.k, x); x === x0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); } ctx.stroke(); ctx.setLineDash([]);
    if (zr > 1.2) { ctx.fillStyle = rgba(COL.g, .75); ctx.font = font(10); ctx.textAlign = 'left'; ctx.fillText(`阶段线 ${T.k}`, x0 + px(6), thPL(T.k, x0) - px(5)); }
  }
  for (const side of ['e', 'p']) {
    const R0 = thRoot(side);
    if (!R0) continue;
    const col = side === 'p' ? COL.g : COL.enemy, mine = !S.ctl || side === S.ctl;
    const vis = (x, y) => mine || (side === 'e' ? inVision(x, y) : spotted(x, y));
    // 地段分界：本方战线上各营（连）地段的接缝画短竖线，师的接缝画长
    if (mine && !far) for (const D of thKids(R0)) {
      for (const F of thRegsOf(D)) if (F.cols && F.cols.length) {
        const xb = F.cols[0] * FR_G, y = thLineY(side, xb + 15);
        if (y == null) continue;
        ctx.strokeStyle = rgba(col, .55); ctx.lineWidth = px(1.2);
        ctx.beginPath(); ctx.moveTo(xb, y - px(7)); ctx.lineTo(xb, y + px(7)); ctx.stroke();
      }
    }
    const list = far ? thKids(R0).filter(D => thRegsOf(D).some(thG)) : thRegsOf(R0).filter(thG);
    for (const F of list) {
      const c = F.lvl === 'reg' ? (G => ({ x: G.ax, y: G.ay }))(thG(F)) : thAt(F);
      if (!c || !vis(c.x, c.y)) continue;
      const sel = THU.sel.has(F.id) || [...THU.sel].some(id => { const P = thF(id); return P && thuAnc(P, F); }), y = c.y - px(30);   // 番号牌都立在部队头顶（屏幕上方）
      ctx.strokeStyle = rgba(col, mine ? .5 : .35); ctx.lineWidth = px(1); ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(c.x, y + px(13)); ctx.stroke();   // 引线
      thuArrow(ctx, F, c.x, thDir(side) < 0 ? y - px(15) : c.y, col, mine ? .9 : .55, side);   // 箭头从牌子上沿（向北推进）或部队位置（向南）出发，不压住番号
      thuMark(ctx, c.x, y, F, col, sel, mine ? 1 : .7);
    }
  }
  // 选中的编队：高亮地段战线，虚线连到各下级的标号
  for (const id of THU.sel) {
    const F = thF(id);
    if (!F) continue;
    const side = F.side;
    if (F.cols && F.cols.length) {
      ctx.strokeStyle = rgba(COL.amber, .75); ctx.lineWidth = px(3.2);
      ctx.beginPath(); let on = false;
      for (const b of F.cols) { const x = frBX(b), y = thLineY(side, x); if (y == null) { on = false; continue; } on ? ctx.lineTo(x, y) : ctx.moveTo(x, y); on = true; }
      ctx.stroke();
    }
    if (F.lvl !== 'reg') {
      const c = thAt(F);
      if (!c) continue;
      ctx.strokeStyle = rgba(COL.amber, .55); ctx.lineWidth = px(1); ctx.setLineDash([px(3), px(4)]);
      for (const R1 of thRegsOf(F)) { const G = thG(R1); if (!G) continue; ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(G.ax, G.ay - thDir(side) * px(22)); ctx.stroke(); }
      ctx.setLineDash([]);
    }
  }
  ctx.restore();
}
HOOK.drawOver.push(thuDraw);
// 隶属（型号卡）：编进战区编队的排、车每 2 秒刷新「师 · 团 / 营」
HOOK.step.push(dt => {
  if (!S || !S.th || (THU.affT = (THU.affT ?? 0) - dt) > 0) return;
  THU.affT = 2;
  for (const G of S.bgs || []) {
    if (G.dead || !G.th) continue;
    const F = thF(G.th), B = F && thF(F.par), D = B && thF(B.par);
    if (!F) continue;
    const org = { b: [D && D.name, B && B.name].filter(Boolean).join(' · '), r: F.name, k: 'reg' };
    for (const id of G.us) { const u = UNIT_MAP.get(id); if (u) u.org = org; }
    for (const id of G.vs) { const v = vehById(id); if (v) v.org = org; }
  }
});

// 3D：每个营（连）头顶立一块番号牌——北约兵种框（步兵 ×、装甲椭圆、机步两者都有）上加编制记号（II 营 / I 连），旁边写番号、当前命令，
//   下面一条兵力条；引线落到营的位置。远看（镜头拉远）只立师的牌子。牌子按屏幕像素定大小，远近都看得清；互相不叠；点牌子选中这个编队
function thMarks3(ctx, stem) {
  THU.hit3 = [];
  if (!thOn() || !thuActive()) return;
  const far = CAM.z / CAM.fit < 2.1, occ = [], C = V3.cam, list = [];
  for (const side of ['p', 'e']) {
    const R0 = thRoot(side);
    if (!R0) continue;
    const mine = !S.ctl || side === S.ctl, col = side === 'p' ? COL.g : COL.enemy;
    for (const F of far ? thKids(R0).filter(D => thRegsOf(D).some(thG)) : thRegsOf(R0).filter(thG)) {
      const c = F.lvl === 'reg' ? (G => ({ x: G.ax, y: G.ay }))(thG(F)) : thAt(F);
      if (!c || !(mine || (side === 'e' ? inVision(c.x, c.y) : spotted(c.x, c.y)))) continue;
      list.push({ F, c, col, d: C ? dist(c.x, -c.y, C.E[0], C.E[1]) : 0 });
    }
  }
  list.sort((a, b) => a.d - b.d);
  for (const { F, c, col } of list) {
    const q = stem(c.x, c.y, F.lvl === 'div' ? 90 : 55, col, 1);
    if (!q) continue;
    const G = F.lvl === 'reg' ? thG(F) : null, sel = THU.sel.has(F.id) || [...THU.sel].some(id => { const P = thF(id); return P && thuAnc(P, F); });
    const t = G ? G.type || 'inf' : (() => { let v = 0, n = 0; for (const R of thRegsOf(F)) { const g = thG(R); if (g) { const P = hqRegPow(g); v += P.veh; n += P.tot; } } return v / Math.max(1, n) >= .6 ? 'armor' : v / Math.max(1, n) >= .25 ? 'mech' : 'inf'; })();
    const ech = F.lvl === 'div' ? 'XX' : F.lvl === 'bde' ? 'III' : F.ech || 'II', verb = thVerb(thOrdOf(F)) + (F.box && F.box.length ? ' ⏳' : '');
    ctx.save(); ctx.globalAlpha = Math.max(.4, q.al);
    ctx.font = 'bold 13px "IBM Plex Mono", "Noto Sans SC", monospace'; const w1 = ctx.measureText(F.name).width;
    ctx.font = '11px "IBM Plex Mono", "Noto Sans SC", monospace'; const w2 = ctx.measureText(verb).width;
    const fw = 22, fh = 15, W0 = fw + 8 + Math.max(w1, w2) + 14, h0 = 34, x0 = q.x - W0 / 2;
    let yc = q.y - h0 / 2;
    for (let k = 0; k < 6; k++) { const r = occ.find(r => x0 < r[2] && x0 + W0 > r[0] && yc - h0 / 2 < r[3] + 3 && yc + h0 / 2 > r[1] - 3); if (!r) break; yc = r[1] - h0 / 2 - 5; }
    occ.push([x0, yc - h0 / 2, x0 + W0, yc + h0 / 2]);
    if (yc < q.y - h0 / 2 - 1) { ctx.strokeStyle = rgba(col, .5 * q.al); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(q.x, yc + h0 / 2); ctx.stroke(); }
    THU.hit3.push({ F, r: [x0, yc - h0 / 2, x0 + W0, yc + h0 / 2] });
    ctx.fillStyle = rgba(COL.bg, .9); ctx.fillRect(x0, yc - h0 / 2, W0, h0);
    ctx.strokeStyle = sel ? COL.amber : rgba(col, 1); ctx.lineWidth = sel ? 2.6 : 1.5; ctx.strokeRect(x0, yc - h0 / 2, W0, h0);
    ctx.fillStyle = rgba(col, .9); ctx.fillRect(x0, yc - h0 / 2, 3, h0);
    const fx = x0 + 8 + fw / 2, fy = yc + 3;
    ctx.strokeStyle = rgba(col, 1); ctx.lineWidth = 1.3; ctx.strokeRect(fx - fw / 2, fy - fh / 2, fw, fh);
    ctx.beginPath();
    if (t !== 'armor') { ctx.moveTo(fx - fw / 2, fy + fh / 2); ctx.lineTo(fx + fw / 2, fy - fh / 2); ctx.moveTo(fx - fw / 2, fy - fh / 2); ctx.lineTo(fx + fw / 2, fy + fh / 2); }
    if (t !== 'inf') ctx.ellipse(fx, fy, fw * .32, fh * .3, 0, 0, 6.283);
    ctx.stroke();
    ctx.fillStyle = rgba(col, 1); ctx.font = 'bold 8px "IBM Plex Mono", monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.fillText(ech, fx, fy - fh / 2 - 1.5);
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.font = 'bold 13px "IBM Plex Mono", "Noto Sans SC", monospace'; ctx.fillText(F.name, fx + fw / 2 + 7, yc - 6);
    ctx.font = '11px "IBM Plex Mono", "Noto Sans SC", monospace'; ctx.fillStyle = F.man ? COL.amber : rgba(col, .78); ctx.fillText(verb, fx + fw / 2 + 7, yc + 8);
    const p0 = F.lvl === 'reg' ? F.p0 || 1 : thP0(F) || 1, st = clamp(thPow(F) / p0, 0, 1);
    ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(x0 + 3, yc + h0 / 2 - 3, W0 - 3, 3);
    ctx.fillStyle = st > .5 ? rgba(col, .95) : st > .25 ? COL.amber : COL.enemy; ctx.fillRect(x0 + 3, yc + h0 / 2 - 3, (W0 - 3) * st, 3);
    ctx.restore();
  }
}
// 3D：点番号牌选中编队（Shift / Ctrl 多选）
HOOK.pointer.push((e, kind) => {
  if (kind !== 'down' || e.button !== 0 || !thuActive() || typeof V3 !== 'object' || !V3.on || (typeof V3O === 'object' && V3O.on) || !THU.hit3 || !THU.hit3.length) return false;
  const { sx, sy } = evPos(e), h = THU.hit3.find(o => sx >= o.r[0] && sx <= o.r[2] && sy >= o.r[1] && sy <= o.r[3]);
  if (!h) return false;
  thuSelect(h.F, e.shiftKey || e.ctrlKey);
  return true;
});
