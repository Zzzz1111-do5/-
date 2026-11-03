'use strict';
// 编辑器的便捷功能（用户：增加编辑的设计便捷度与功能；界面主体在 modui.js，这里只往上加，不改它的结构）：
//   撤销 / 重做（Ctrl + Z / Ctrl + Y，或 Ctrl + Shift + Z）：每次操作前后比较正在编辑的副本 MDX_W（不含导入的文件库），变了就记一步，拖滑块连着拖只记一步；
//     切割、转方向这些直接改文件的操作另有自己的撤销（modui.js 部件页）；
//   Ctrl + S 保存、标题上显示「有没保存的改动」；Ctrl + F 筛选参数（按名称，只留下对得上的行）；Alt + ↑ / ↓ 换上一个 / 下一个型号；
//   每型表单上面一条工具栏：复制这一型的改动、粘贴到这一型、这一型全部恢复默认、套用到同类（同车种 / 同一方的飞机 / 全部导弹……）；
//   「改动」页：所有改过的参数一览（改成多少、默认多少），点名字跳过去、点 ↺ 单项恢复；
//   「批量」页：按类别、阵营、车种挑一批型号，对某一项参数一起乘 / 加 / 设成某个数（先预览改哪些、改成多少）；
//   「保存并试玩」：保存、关掉编辑器、直接开一局沙盒
const MUX = { ud: [], rd: [], pre: null, preT: 0, fq: '', clip: null, bulk: { cat: 'veh', side: 'all', cls: 'all', f: '', op: 'mul', v: 1.1 } };
const muxSnap = () => { if (!MDX_W) return 'null'; const o = {}; for (const k of MOD_SEC) if (k !== 'lib') o[k] = MDX_W[k]; return JSON.stringify(o); };
function muxRestore(s) {
  const o = JSON.parse(s);
  for (const k of MOD_SEC) if (k !== 'lib') MDX_W[k] = o[k] || {};
  MDX.dirty = true; MDX.keep = true;
  mdxRender(); muxBadge();
}
function muxUndo() { if (!MUX.ud.length) { mdxMsg('没有可以撤销的了'); return; } MUX.rd.push(muxSnap()); muxRestore(MUX.ud.pop()); mdxMsg('已撤销（还能撤 ' + MUX.ud.length + ' 步）'); }
function muxRedo() { if (!MUX.rd.length) { mdxMsg('没有可以重做的了'); return; } MUX.ud.push(muxSnap()); muxRestore(MUX.rd.pop()); mdxMsg('已重做'); }
// 一次操作前记下副本，操作完（同一轮事件之后）比较：变了就进撤销栈
function muxBefore(cont) {
  if (!MDX_W) return;
  const now = performance.now();
  if (cont && MUX.pre && now - MUX.preT < 900) { MUX.preT = now; return; }   // 连着拖滑块、连着打字：算一步
  if (MUX.pre == null) MUX.pre = muxSnap();
  MUX.preT = now;
  queueMicrotask(() => setTimeout(muxAfter, 0));
}
function muxAfter() {
  if (MUX.pre == null || !MDX_W) return;
  if (performance.now() - MUX.preT < 850 && MUX.cont) { setTimeout(muxAfter, 300); return; }
  const s = muxSnap();
  if (s !== MUX.pre) { MUX.ud.push(MUX.pre); if (MUX.ud.length > 80) MUX.ud.shift(); MUX.rd.length = 0; }
  MUX.pre = null; MUX.cont = false;
  muxBadge();
}
function muxBadge() {
  const h = MDX.el && MDX.el.querySelector('header h2');
  if (!h) return;
  let b = h.querySelector('.mux-dirty');
  if (!b) { b = document.createElement('span'); b.className = 'mux-dirty'; h.appendChild(b); }
  b.textContent = MDX.dirty ? '● 有没保存的改动' : '';
  const u = MDX.el.querySelector('[data-mux="undo"]'), r = MDX.el.querySelector('[data-mux="redo"]');
  if (u) u.disabled = !MUX.ud.length;
  if (r) r.disabled = !MUX.rd.length;
}
// —— 每型的参数表（统一成：字段、名称、单位、默认值（显示单位）、存的值 ↔ 显示）——
const muxId = v => v;
function muxFields(tab, k) {
  const W0 = MDX_W;
  if (tab === 'veh') {
    const o = mdxVehList().find(x => x.k === k);
    if (!o) return null;
    o.sp = VEH_SPEC[o.type];
    return { path: 'veh|' + k, cur: W0.veh[k] || {}, nm: o.nm, F: MDX_VEH_F.map(([f, nm, unit, d]) => ({ f, nm, unit, def: d(o), show: muxId, back: muxId })) };
  }
  if (tab === 'air' && k.startsWith('e:')) {
    const t = k.slice(2), a = MOD_DEF.eair[t] || (typeof EA_SPEC === 'object' && EA_SPEC[t]);
    if (!a) return null;
    return { path: 'eair|' + t, cur: W0.eair[t] || {}, nm: a.name, F: [...MDX_EAIR_F, ...MDX_PERF_F.filter(r => r[6] !== 'fl')].map(([f, nm, unit, d, back, show]) => ({ f, nm, unit, def: d(a, t), show: show || muxId, back: back || muxId })) };
  }
  if (tab === 'air') {
    const a = MOD_DEF.air[k] || AIR_MDL[k];
    if (!a) return null;
    return { path: 'air|' + k, cur: W0.air[k] || {}, nm: a.name, F: [...MDX_AIR_F, ...MDX_PERF_F, ...MDX_GUN_F].map(([f, nm, unit, d, back, show]) => ({ f, nm, unit, def: d(a, k), show: show || muxId, back: back || muxId })) };
  }
  if (tab === 'wpn') {
    const w = MOD_DEF.wpn[k] || FW_W[k];
    if (!w) return null;
    return { path: 'wpn|' + k, cur: W0.wpn[k] || {}, nm: w.nm, F: MDX_WPN_F.map(([f, nm, unit]) => ({ f, nm, unit, def: w[f] ?? (f === 'acc' ? 20 : null), show: muxId, back: muxId })) };
  }
  if (tab === 'msl') {
    const m = MOD_DEF.msl[k] || MS_PGM[k];
    if (!m) return null;
    return { path: 'msl|' + k, cur: W0.msl[k] || {}, nm: m.nm, F: MDX_MSL_F.map(([f, nm, unit, d, back]) => ({ f, nm, unit, def: d(m), back: back || muxId, show: back ? v => mdxR(d({ ...m, [f]: v })) : muxId })) };
  }
  return null;
}
const muxSec = tab => tab === 'veh' ? 'veh' : tab === 'wpn' ? 'wpn' : tab === 'msl' ? 'msl' : 'air';
const muxObjOf = (tab, k) => { const p = (muxFields(tab, k) || {}).path; if (!p) return null; const [s, kk] = p.split('|'); return { s, k: kk }; };
// 同类：车辆按车种（VEH_SPEC 的键）、飞机按攻守方、武器和导弹全部
function muxSame(tab, k) {
  if (tab === 'veh') { const L = mdxVehList(), o = L.find(x => x.k === k); return o ? L.filter(x => x.type === o.type).map(x => x.k) : []; }
  if (tab === 'air') return mdxItems().map(i => i.id).filter(id => id.startsWith('e:') === k.startsWith('e:'));
  return mdxItems().map(i => i.id);
}
// 工具栏（坦克、飞机、武器、导弹页的表单最上面）
function muxTools() {
  const k = MDX.sel, Fd = k && muxFields(MDX.tab, k);
  if (!Fd) return '';
  const nc = Object.keys(Fd.cur).length, cl = MUX.clip && MUX.clip.tab === MDX.tab;
  return `<div class="mux-tool"><input type="search" data-mux="fq" placeholder="筛选参数（Ctrl + F）" value="${mdxEsc(MUX.fq)}" aria-label="筛选参数">
    <button type="button" class="mdx-btn" data-mux="copy"${nc ? '' : ' disabled'} title="把这一型改过的参数记下来">复制改动</button>
    <button type="button" class="mdx-btn" data-mux="paste"${cl ? '' : ' disabled'} title="${cl ? '粘贴「' + mdxEsc(MUX.clip.nm) + '」的改动' : '先在别的型号上复制'}">粘贴${cl ? '「' + mdxEsc(MUX.clip.nm) + '」' : ''}</button>
    <button type="button" class="mdx-btn" data-mux="same"${nc ? '' : ' disabled'} title="把这一型的改动套到同类的每一型上">套用到同类（${muxSame(MDX.tab, k).length} 型）</button>
    <button type="button" class="mdx-btn" data-mux="clear"${nc ? '' : ' disabled'}>这一型全部恢复默认</button></div>`;
}
// 筛选参数：只留下名称对得上的行（小标题跟着它下面的行）
function muxFilter() {
  const f = MDX.el && MDX.el.querySelector('.mdx-form');
  if (!f) return;
  const q = MUX.fq.trim().toLowerCase();
  for (const r of f.querySelectorAll('.mdx-row')) { const l = r.querySelector('label'); r.style.display = !q || (l && l.textContent.toLowerCase().includes(q)) ? '' : 'none'; }
}
// 把一型的改动贴到另一型（只贴对方也有的字段；不贴换模型、挂载——那是按型号的）
function muxPasteTo(tab, k, data, keep) {
  const Fd = muxFields(tab, k);
  if (!Fd) return 0;
  const ok = new Set(Fd.F.map(r => r.f)), [s, kk] = Fd.path.split('|'), o = keep ? { ...(MDX_W[s][kk] || {}) } : { ...((MDX_W[s][kk] || {}).mdl ? { mdl: MDX_W[s][kk].mdl } : {}), ...((MDX_W[s][kk] || {}).load ? { load: MDX_W[s][kk].load } : {}) };
  let n = 0;
  for (const f in data) if (ok.has(f)) { o[f] = modClone(data[f]); n++; }
  if (Object.keys(o).length) MDX_W[s][kk] = o; else delete MDX_W[s][kk];
  MDX.dirty = true;
  return n;
}
function muxToolClick(b) {
  const a = b.dataset.mux, k = MDX.sel;
  if (a === 'undo') { muxUndo(); return true; }
  if (a === 'redo') { muxRedo(); return true; }
  if (a === 'play') { muxPlay(); return true; }
  if (a === 'go') { MDX.tab = b.dataset.tab; MDX.sel = b.dataset.k; MDX.q = ''; MDX.pk = ''; MUX.fq = b.dataset.f || ''; mdxRender(); return true; }
  if (a === 'bulkgo') { muxBulk(true); return true; }
  const Fd = k && muxFields(MDX.tab, k);
  if (!Fd) return false;
  const data = {};
  for (const f in Fd.cur) if (f !== 'mdl' && f !== 'load') data[f] = Fd.cur[f];
  if (a === 'copy') { MUX.clip = { tab: MDX.tab, k, nm: Fd.nm, data: modClone(data) }; MDX.keep = true; mdxRender(); mdxMsg('已复制「' + Fd.nm + '」的 ' + Object.keys(data).length + ' 项改动：选别的型号点「粘贴」'); return true; }
  if (a === 'paste' && MUX.clip) { const n = muxPasteTo(MDX.tab, k, MUX.clip.data, true); MDX.keep = true; mdxRender(); mdxMsg(`粘贴了 ${n} 项，点「保存」生效`); return true; }
  if (a === 'same') {
    const L = muxSame(MDX.tab, k).filter(x => x !== k);
    if (!confirm(`把「${Fd.nm}」改过的 ${Object.keys(data).length} 项套到同类的 ${L.length} 型上？`)) return true;
    for (const x of L) muxPasteTo(MDX.tab, x, data, true);
    MDX.keep = true; mdxRender(); mdxMsg(`已套到 ${L.length} 型，点「保存」生效`); return true;
  }
  if (a === 'clear') { const [s, kk] = Fd.path.split('|'); delete MDX_W[s][kk]; MDX.dirty = true; MDX.keep = true; mdxRender(); mdxMsg('这一型全部恢复默认，点「保存」生效'); return true; }
  return false;
}
// —— 「改动」页：改过的全部列出来 ——
const MUX_MDL = { muz: '主炮炮口', gun: '航炮口', st: '挂点', noz: '尾喷口', fx: '尾焰', hz: '热浪', pt: '部件', mg: '机枪口' };
function muxChgForm() {
  const W0 = MDX_W, out = [], row = (go, nm, val, def, rst) => `<div class="mdx-row"><label>${go}${nm}</label><span class="mux-v">${mdxEsc(val)}</span><span class="def">${def == null ? '' : '默认 ' + mdxEsc(def)}</span>${rst ? `<button type="button" class="mdx-rst" data-mux-rst="${rst}" title="恢复默认">↺</button>` : '<span></span>'}</div>`;
  const fmt = (r, v) => Array.isArray(r.unit) ? ((r.unit.find(o => o[0] === String(v)) || [, v])[1]) : (v ?? '—') + (r.unit ? ' ' + r.unit : '');
  const sec = (tab, ids, title) => {
    const parts = [];
    for (const id of ids) {
      const Fd = muxFields(tab, id);
      if (!Fd || !Object.keys(Fd.cur).length) continue;
      const go = `<button type="button" class="mux-go" data-mux="go" data-tab="${tab}" data-k="${mdxEsc(id)}">${mdxEsc(Fd.nm)}</button> · `;
      for (const f in Fd.cur) {
        const r = Fd.F.find(x => x.f === f), v = Fd.cur[f];
        if (f === 'mdl') { parts.push(row(go, '3D 模型', ((mdxModels().find(m => m.id === v) || { nm: v }).nm), null, Fd.path + '|mdl')); continue; }
        if (f === 'load') { parts.push(row(go, '挂载', v.map(x => ((MOD_DEF.wpn[x.w] || FW_W[x.w] || { nm: x.w }).nm) + ' × ' + x.n).join('、'), null, Fd.path + '|load')); continue; }
        if (!r) continue;
        parts.push(row(go, r.nm, fmt(r, r.show(v)), r.def == null ? '—' : fmt(r, r.def), Fd.path + '|' + f));
      }
    }
    if (parts.length) out.push(`<h3 style="margin-top:12px">${title}</h3>${parts.join('')}`);
  };
  sec('veh', mdxVehList().map(o => o.k), '坦克装甲车');
  sec('air', [...Object.keys(AIR_MDL), ...(typeof EA_SPEC === 'object' ? Object.keys(EA_SPEC).map(t => 'e:' + t) : [])], '飞机');
  sec('wpn', Object.keys(FW_W), '机载武器');
  sec('msl', Object.keys(MS_PGM), '导弹');
  const ml = [];
  for (const mk in W0.mdl) {
    const md = mdxModels().find(r => r.id === mk), go = `<button type="button" class="mux-go" data-mux="go" data-tab="mdl" data-k="${mdxEsc(mk)}">${mdxEsc(md ? md.nm : mk)}</button> · `;
    for (const f in W0.mdl[mk]) ml.push(row(go, MUX_MDL[f] || f, Array.isArray(W0.mdl[mk][f]) ? W0.mdl[mk][f].length + ' 个' : '已设', null, 'mdl|' + mk + '|' + f));
  }
  if (ml.length) out.push(`<h3 style="margin-top:12px">模型与挂点</h3>${ml.join('')}`);
  const fx = Object.keys(W0.fx).map(s => row('', (typeof MDX_SLOT === 'object' ? (MDX_SLOT.find(x => x[0] === s) || [, s])[1] : s), (MOD.lib[W0.fx[s]] || { nm: W0.fx[s] }).nm, '原来的', 'fx||' + s));
  if (fx.length) out.push(`<h3 style="margin-top:12px">特效贴图</h3>${fx.join('')}`);
  const mp = ['w', 'h'].filter(f => W0.map[f] != null).map(f => row('', f === 'w' ? '战场宽' : '战场纵深', W0.map[f] + ' 米', f === 'w' ? '8400 米' : '5600 米', 'map||' + f));
  if (mp.length) out.push(`<h3 style="margin-top:12px">战场</h3>${mp.join('')}`);
  return `<h3>改动一览</h3><p class="note">正在编辑的全部改动（没保存的也在里面）。点型号名跳过去，点 ↺ 单项恢复默认；Ctrl + Z 撤销。</p>` + (out.join('') || '<p class="note">还没有改过任何参数。</p>');
}
function muxChgRst(spec) {
  const [s, k, f] = spec.split('|');
  if (s === 'mdl') { const A = MDX_W.mdl[k]; if (A) { delete A[f]; if (!Object.keys(A).length) delete MDX_W.mdl[k]; } }
  else if (s === 'fx' || s === 'map') delete MDX_W[s][f];
  else { const o = MDX_W[s][k]; if (o) { delete o[f]; if (!Object.keys(o).length) delete MDX_W[s][k]; } }
  MDX.dirty = true; MDX.keep = true; mdxRender(); mdxMsg('已恢复默认，点「保存」生效');
}
// —— 「批量」页 ——
const MUX_CAT = [['veh', '坦克装甲车'], ['air', '飞机'], ['wpn', '机载武器'], ['msl', '导弹']];
function muxBulkIds() {
  const B = MUX.bulk;
  if (B.cat === 'veh') return mdxVehList().filter(o => (B.side === 'all' || (B.side === 'e') === (o.side === 'e')) && (B.cls === 'all' || o.type === B.cls)).map(o => o.k);
  if (B.cat === 'air') return [...Object.keys(AIR_MDL).filter(() => B.side !== 'e'), ...(typeof EA_SPEC === 'object' && B.side !== 'p' ? Object.keys(EA_SPEC).map(t => 'e:' + t) : [])];
  return Object.keys(B.cat === 'wpn' ? FW_W : MS_PGM);
}
// 一批型号里这一项改成多少：[{ id, nm, from, to }]（显示单位）
function muxBulkPlan() {
  const B = MUX.bulk, out = [];
  for (const id of muxBulkIds()) {
    const Fd = muxFields(B.cat, id), r = Fd && Fd.F.find(x => x.f === B.f);
    if (!r || Array.isArray(r.unit)) continue;
    const from = Fd.cur[B.f] != null && Fd.cur[B.f] !== '' ? r.show(Fd.cur[B.f]) : r.def;
    if (!modNum(from) && B.op !== 'set') continue;
    const v = +B.v, to = B.op === 'mul' ? from * v : B.op === 'add' ? from + v : v;
    if (!modNum(to)) continue;
    out.push({ id, nm: Fd.nm, from, to: Math.round(to * 1000) / 1000, Fd, r });
  }
  return out;
}
function muxBulk(apply) {
  const P = muxBulkPlan();
  if (!apply) return P;
  if (!P.length) { mdxMsg('没有可以改的型号'); return P; }
  for (const p of P) mdxSet(p.Fd.path, MUX.bulk.f, p.r.back(p.to));
  MDX.keep = true; mdxRender(); mdxMsg(`已改 ${P.length} 型，点「保存」生效（Ctrl + Z 撤销）`);
  return P;
}
function muxBulkForm() {
  const B = MUX.bulk, sel = (k, L) => `<select data-mux-b="${k}">${L.map(([v, n]) => `<option value="${v}"${String(B[k]) === String(v) ? ' selected' : ''}>${mdxEsc(n)}</option>`).join('')}</select>`;
  const ids = muxBulkIds(), F0 = ids.length ? muxFields(B.cat, ids.find(id => muxFields(B.cat, id)) || ids[0]) : null;
  const fl = [];   // 这一类里能批量改的参数（数值型；飞机把各型都有的并起来）
  const seen = new Set();
  for (const id of ids.slice(0, 40)) { const Fd = muxFields(B.cat, id); if (Fd) for (const r of Fd.F) if (!Array.isArray(r.unit) && !seen.has(r.f)) { seen.add(r.f); fl.push([r.f, r.nm + (r.unit ? '（' + r.unit + '）' : '')]); } }
  if (!fl.some(x => x[0] === B.f)) B.f = fl.length ? fl[0][0] : '';
  const cls = B.cat === 'veh' ? [['all', '全部车种'], ...[...new Set(mdxVehList().map(o => o.type))].map(t => [t, VEH_SPEC[t].name || t])] : null;
  const P = muxBulkPlan(), row = (nm, inp) => `<div class="mdx-row"><label>${nm}</label>${inp}<span></span><span></span></div>`;
  return `<h3>批量修改</h3><p class="note">挑一批型号，对同一项参数一起改：乘一个倍数（1.2 = 加两成）、加一个数，或者都设成同一个数。下面先列出每一型会从多少改成多少，确认了再点「改这些」。改完点「保存」生效，Ctrl + Z 能撤销。</p>` +
    row('类别', sel('cat', MUX_CAT)) + (B.cat === 'veh' || B.cat === 'air' ? row('阵营', sel('side', [['all', '双方'], ['p', '攻方'], ['e', '守方']])) : '') + (cls ? row('车种', sel('cls', cls)) : '') +
    row('参数', sel('f', fl)) + row('怎么改', sel('op', [['mul', '乘以'], ['add', '加上'], ['set', '设成']])) +
    row('数值', `<input type="number" step="any" data-mux-b="v" value="${B.v}">`) +
    `<p><button type="button" class="mdx-btn pri" data-mux="bulkgo"${P.length ? '' : ' disabled'}>改这些（${P.length} 型）</button></p>` +
    (P.length ? `<div class="mux-plan">${P.map(p => `<div><span>${mdxEsc(p.nm)}</span><span>${mdxR(p.from, 1000)} → <b>${mdxR(p.to, 1000)}</b>${p.r.unit ? ' ' + mdxEsc(p.r.unit) : ''}</span></div>`).join('')}</div>` : '<p class="note">这一批型号都没有这一项。</p>') +
    (F0 ? '' : '');
}
// 保存并试玩：存盘、关掉编辑器、开一局沙盒
function muxPlay() {
  for (const k of MOD_SEC) if (k !== 'lib') MOD[k] = modClone(MDX_W[k]);
  modSave(); MDX.dirty = false;
  closeModEditor();
  if (typeof mnAct === 'function') mnAct('sbx');
}
// —— 接到 modui.js 上 ——
if (typeof MDX_TABS === 'object' && !MDX_TABS.some(t => t[0] === 'chg')) {
  const i = MDX_TABS.findIndex(t => t[0] === 'map');
  MDX_TABS.splice(i < 0 ? MDX_TABS.length : i, 0, ['chg', '改动'], ['bulk', '批量']);
}
if (typeof mdxForm === 'function') {
  const f0 = mdxForm;
  mdxForm = function () {
    if (MDX.tab === 'chg') return muxChgForm();
    if (MDX.tab === 'bulk') return muxBulkForm();
    const h = f0.apply(this, arguments);
    return ['veh', 'air', 'wpn', 'msl'].includes(MDX.tab) ? muxTools() + h : h;
  };
}
if (typeof mdxRender === 'function') {
  const r0 = mdxRender;
  mdxRender = function (listOnly) {
    const out = r0.apply(this, arguments);
    if (!listOnly) { muxFilter(); muxBadge(); }
    return out;
  };
}
if (typeof mdxBuild === 'function') {
  const b0 = mdxBuild;
  mdxBuild = function () {
    if (MDX.el) return MDX.el;
    const el = b0.apply(this, arguments), st = document.createElement('style');
    st.textContent = `#mdx .mux-dirty { margin-left: 12px; font-size: 12px; color: var(--amber, #ffc24a); letter-spacing: 0; font-weight: normal; }
#mdx .mux-tool { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 0 0 10px; padding-bottom: 8px; border-bottom: 1px solid var(--line); }
#mdx .mux-tool input[type=search] { flex: 1 1 180px; width: auto; background: rgba(0, 0, 0, .35); color: var(--text); border: 1px solid var(--line); border-radius: 4px; padding: 5px 7px; font: inherit; font-size: 13px; }
#mdx .mux-go { background: none; border: 0; padding: 0; color: var(--g-hi); cursor: pointer; font: inherit; text-decoration: underline dotted; }
#mdx .mux-v { font-size: 13px; color: var(--amber, #ffc24a); }
#mdx .mux-plan { display: grid; gap: 2px; font-size: 13px; max-height: 340px; overflow: auto; border: 1px solid var(--line); border-radius: 5px; padding: 6px 8px; }
#mdx .mux-plan div { display: flex; justify-content: space-between; gap: 10px; border-bottom: 1px dashed rgba(var(--g-rgb), .1); padding: 2px 0; }
#mdx .mux-plan b { color: var(--amber, #ffc24a); font-weight: normal; }`;
    document.head.appendChild(st);
    // 底栏：撤销、重做、保存并试玩
    const ft = el.querySelector('footer'), sv = ft && ft.querySelector('[data-a="save"]');
    if (ft && sv) {
      const mk = (a, t, tip) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'mdx-btn'; b.dataset.mux = a; b.textContent = t; b.title = tip; return b; };
      ft.insertBefore(mk('undo', '↶ 撤销', '撤销（Ctrl + Z）'), ft.querySelector('[data-a="undo"]'));
      ft.insertBefore(mk('redo', '↷ 重做', '重做（Ctrl + Y）'), ft.querySelector('[data-a="undo"]'));
      ft.insertBefore(mk('play', '保存并试玩', '保存，关掉编辑器，开一局沙盒'), sv);
    }
    // 记撤销：捕获阶段（modui.js 的处理之前）记下副本，处理完比较
    el.addEventListener('click', e => { const b = e.target.closest('button'); if (b && !b.dataset.mux && !b.dataset.tab && !b.dataset.it) muxBefore(false); }, true);
    el.addEventListener('change', e => { if (!e.target.closest('.mdx-list') && !(e.target.dataset && e.target.dataset.mux != null)) muxBefore(false); }, true);
    el.addEventListener('input', e => { const t = e.target; if (t.closest('.mdx-list') || (t.dataset && (t.dataset.mux != null || t.dataset.muxB != null))) return; MUX.cont = true; muxBefore(true); }, true);
    // 工具栏、改动页、批量页的按钮先处理（处理了就不再交给 modui.js）
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-mux], [data-mux-rst]');
      if (!b) return;
      if (b.dataset.muxRst) { e.stopPropagation(); muxBefore(false); muxChgRst(b.dataset.muxRst); return; }
      if (b.dataset.mux === 'fq') return;
      e.stopPropagation();
      if (!['undo', 'redo', 'go', 'play'].includes(b.dataset.mux)) muxBefore(false);
      muxToolClick(b);
    }, true);
    el.addEventListener('input', e => {
      const t = e.target;
      if (t.dataset.mux === 'fq') { e.stopPropagation(); MUX.fq = t.value; muxFilter(); }
    }, true);
    el.addEventListener('change', e => {
      const t = e.target;
      if (t.dataset.mux === 'fq') { e.stopPropagation(); return; }
      if (t.dataset.muxB != null) { e.stopPropagation(); const k = t.dataset.muxB; MUX.bulk[k] = k === 'v' ? +t.value : t.value; if (k === 'cat') { MUX.bulk.f = ''; MUX.bulk.cls = 'all'; } MDX.keep = true; mdxRender(); }
    }, true);
    // 快捷键（编辑器开着时）
    document.addEventListener('keydown', e => {
      if (!MDX.el || MDX.el.hidden) return;
      const k = e.key.toLowerCase(), c = e.ctrlKey || e.metaKey, ae = document.activeElement || {}, typing = ae.tagName === 'TEXTAREA' || (ae.tagName === 'INPUT' && !/^(checkbox|radio|range|button|file)$/.test(ae.type));   // 正在输入框里打字：撤销交给输入框自己
      if (c && k === 's') { e.preventDefault(); const b = MDX.el.querySelector('[data-a="save"]'); if (b) b.click(); }
      else if (c && k === 'z' && !e.shiftKey && !typing) { e.preventDefault(); muxUndo(); }
      else if (c && (k === 'y' || (k === 'z' && e.shiftKey)) && !typing) { e.preventDefault(); muxRedo(); }
      else if (c && k === 'f') { const i = MDX.el.querySelector('[data-mux="fq"]'); if (i) { e.preventDefault(); i.focus(); i.select(); } }
      else if (e.altKey && (k === 'arrowdown' || k === 'arrowup')) {
        const L = [...MDX.el.querySelectorAll('.mdx-list .mdx-it')].filter(b => !b.classList.contains('add')), i = L.findIndex(b => b.classList.contains('on'));
        const n = L[clamp(i + (k === 'arrowdown' ? 1 : -1), 0, L.length - 1)];
        if (n) { e.preventDefault(); MDX.sel = n.dataset.it; MDX.pk = ''; mdxRender(); }
      }
    }, true);
    return el;
  };
}
if (typeof openModEditor === 'function') {
  const o0 = openModEditor;
  openModEditor = function () { MUX.ud.length = 0; MUX.rd.length = 0; MUX.pre = null; const r = o0.apply(this, arguments); muxBadge(); return r; };
}
