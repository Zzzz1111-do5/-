'use strict';
// 编辑器：游戏里自带的模型也能拆（用户：载具任何一个部件都能精准去掉、单独拿出来 360 度看，再设计，比如炮塔）——modui.js「模型与挂点」页里，内置模型多一段「部件」：
//   分块：预览读模型时按连通块分（modimp.js mivShow → mod.js modPieces；不跨模型自带的部件，炮塔、炮管、车轮、起落架各自分开），游戏里解码时同一套（mod.js modPrepB），块号对得上；
//   选：点一块 / 按整个部件（炮塔、车轮……）/ 框选 / 全选反选（选择、框选、删除沿用 modui.js 导入模型的那一套：MDX.pc、mdxPcSet，删掉的记在 pt.x）；
//   看：只看选中的（别的藏起来）、对准选中的、360° 转台（自己转着看）、前后左右顶底几个视角；
//   改造：选中的块平移、旋转、缩放、换颜色（MDX_W.mdl[模型键].ed，预览马上照着改，游戏里解码时套）；炮塔、炮管怎么动（回转速度、俯仰范围 / 速度、后坐：.fn → vfn.js VFN）
const MPT = { iso: null, turn: false, tspd: 36, raf: 0, last: 0, ed: { t: [0, 0, 0], r: [0, 0, 0], s: 1, c: '#7a8a6a', cm: .85, paint: false } };
const mptM = mk => { const M = typeof mdxPcM === 'function' ? mdxPcM(mk) : null; return M && M.bi ? M : null; };
const mptIds = () => modIdsEnc([...MDX.pc.sel]);
// 选中块的包围盒（现在显示的坐标）
function mptBox(M, ids) {
  const b = [1e30, 1e30, 1e30, -1e30, -1e30, -1e30], S = ids instanceof Set ? ids : new Set(ids), VB = M.VB, st = M.st;
  for (let v = 0; v < M.nv; v++) { if (!S.has(M.pv[v])) continue; const o = v * st; for (let k = 0; k < 3; k++) { const x = VB[o + k]; if (x < b[k]) b[k] = x; if (x > b[k + 3]) b[k + 3] = x; } }
  return b[0] > b[3] ? null : b;
}
// 改造照着正在改的那份重新套到预览的网格上（原件 VB0 / IB0 / lod0 / mats0 留着）
function mptPreview(M, A) {
  const ed = (A && Array.isArray(A.ed)) ? A.ed : [], sig = JSON.stringify(ed);
  if (M.edSig === sig) return;
  const gl = MIV.gl, VB = M.VB0.slice(), IB = M.IB0.slice();
  M.m.lod = JSON.parse(JSON.stringify(M.lod0)); M.m.mats = JSON.parse(JSON.stringify(M.mats0));
  const col = modEdApply(ed, VB, M.st, M.pv, M.pn);
  modEdSplit(M.m, IB, M.pv, col, ed, null);
  M.VB = VB; M.IB = IB; M.pbb = null; M.ptri = null; M.edSig = sig;
  gl.bindBuffer(gl.ARRAY_BUFFER, M.vb); gl.bufferData(gl.ARRAY_BUFFER, VB, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, M.ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, IB, gl.STATIC_DRAW);
}
// 这一段表单
function mptForm(mk, air) {
  const M = mptM(mk), P = MDX.pc;
  if (!M) return `<h3 style="margin-top:12px">部件：选、去掉、单独看、改造</h3><p class="note">模型读出来以后才能拆（上面的预览加载完会自动刷新这一段）。</p>`;
  if (typeof mdxPcReset === 'function') mdxPcReset(mk);
  const A = MDX_W.mdl[mk] || {}, pt = A.pt || {}, S = mdxPtState(mk), nDel = modIdsDec(pt.x).length, ed = Array.isArray(A.ed) ? A.ed : [];
  const btn = (attr, t, on, tip) => `<button type="button" class="mdx-btn${on ? ' pri' : ''}" ${attr}${tip ? ` title="${mdxEsc(tip)}"` : ''}>${t}</button>`;
  const num = (attr, v, w = 70) => `<input type="number" step="any" ${attr} value="${v ?? ''}" style="width:${w}px">`;
  const ids = mptIds(), cur = ed.find(e => e.id === ids), E = cur || MPT.ed;
  let h = `<h3 style="margin-top:12px">部件：选、去掉、单独看、改造</h3><p class="note">模型按连在一起的网格分成 ${M.pn} 块（模型自带的炮塔、车轮、起落架这些各自分开）。点「选部件」后在预览里点一块就选上 / 取消（黄色），
    按「整个部件」选一下就是整个炮塔；选好了可以去掉、只看它（360° 转着看），或者挪、转、放大缩小、换颜色。去掉的、改造的保存后游戏里照着画。</p>
    <div class="mdx-pcbar">${btn('data-pk="pc"', '选部件', MDX.pk === 'pc', '打开后在预览里点一块选上 / 取消')}
      <label>按 <select data-pcg="1"><option value="pc"${P.g === 'pc' ? ' selected' : ''}>一块</option><option value="nd"${P.g === 'nd' ? ' selected' : ''}>整个部件</option></select> 选</label>
      ${btn('data-pca="box"', '框选', P.box, '打开后在预览里拖出方框，整块都在框里的选上')}${btn('data-pca="all"', '全选')}${btn('data-pca="inv"', '反选')}${btn('data-pca="none"', '清空')}<span class="mdx-pcsel def"></span></div>
    <div class="mdx-pcbar">${(() => { const U = new Map(); M.nodes.forEach((d, i) => { const n = d.n.replace(/（[^）]*）$/, ''); if (!U.has(n)) U.set(n, []); U.get(n).push(i); }); return [...U].map(([n, L]) => btn(`data-mpt="nd:${L.join(',')}"`, mdxEsc(n) + (L.length > 1 ? ' × ' + L.length : ''), false, '把' + n + '全部选上 / 取消')).join(''); })()}</div>
    <div class="mdx-pcbar"><b>选中的</b>${btn('data-pcs="6"', '去掉', false, '游戏里不画这些块')}${btn('data-pcs="0"', '恢复', false, '去掉的再放回来')}
      <label><input type="checkbox" data-pcgh="1"${P.gh ? ' checked' : ''}> 显示去掉的（半透明）</label>${btn('data-pca="undo"', '撤销')}${nDel ? `<span class="def">已去掉 ${nDel} 块</span>${btn('data-mpt="undel"', '全部放回来')}` : ''}</div>
    <div class="mdx-pcbar"><b>看</b>${btn('data-mpt="iso"', MPT.iso ? '只看选中的（' + MPT.iso.size + ' 块）' : '只看选中的', !!MPT.iso, '别的先藏起来（只在预览里）')}${MPT.iso ? btn('data-mpt="all"', '全部显示') : ''}
      ${btn('data-mpt="fit"', '对准选中的')}${btn('data-mpt="turn"', MPT.turn ? '360° 转台：转着' : '360° 转台', MPT.turn, '自己慢慢转一圈一圈地看')}
      <label>转速 <input type="range" min="5" max="120" step="1" data-mpt-s="1" value="${MPT.tspd}" style="width:90px"></label></div>
    <div class="mdx-pcbar">视角 ${[['front', '前'], ['back', '后'], ['left', '左'], ['right', '右'], ['top', '顶'], ['bottom', '底'], ['iso', '斜 45°']].map(([k, n]) => btn(`data-mpt="v:${k}"`, n)).join('')}</div>`;
  // 改造
  h += `<div class="mdx-pcbar"><b>改造选中的${P.sel.size ? '（' + P.sel.size + ' 块）' : ''}</b>${cur ? '<span class="def">这几块已经改造过，下面是改过的数</span>' : P.sel.size ? '' : '<span class="def">先选中块</span>'}</div>
    <div class="mdx-pcbar">挪 ${[0, 1, 2].map(i => 'xyz'[i] + ' ' + num(`data-mpe="t.${i}"`, E.t[i])).join(' ')} 米　转 ${[0, 1, 2].map(i => ['侧滚', '俯仰', '方位'][i] + ' ' + num(`data-mpe="r.${i}"`, E.r[i], 60)).join(' ')} 度　缩放 ${num('data-mpe="s"', E.s, 60)} 倍</div>
    <div class="mdx-pcbar">颜色 <input type="color" data-mpe="c" value="${mdxEsc(E.c || '#7a8a6a')}"> <label><input type="checkbox" data-mpe="paint"${E.c && (cur ? true : MPT.ed.paint) ? ' checked' : ''}> 换颜色</label>
      涂多少 <input type="range" min="0" max="100" step="1" data-mpe="cm" value="${Math.round((E.cm ?? .85) * 100)}" style="width:110px"> <span class="def">100% = 完全盖住原来的贴图</span></div>
    <div class="mdx-pcbar">${btn('data-mpt="apply"', cur ? '更新这几块的改造' : '套到选中的块上', false)}${cur ? btn('data-mpt="unapply"', '去掉这几块的改造') : ''}${btn('data-mpt="reset0"', '数清零')}</div>`;
  if (ed.length) h += `<div class="mdx-pcbar"><b>改造过的</b>${ed.map((e, i) => `${btn(`data-mpt="sel:${i}"`, (i + 1) + '：' + modIdsDec(e.id).length + ' 块' + (modHex(e.c) ? ' <span style="display:inline-block;width:10px;height:10px;background:' + mdxEsc(e.c) + ';border:1px solid #000"></span>' : ''), false, '选中这一条改造的块')}${btn(`data-mpt="del:${i}"`, '✕', false, '删掉这一条')}`).join('')}</div>`;
  // 炮塔、炮管怎么动（游戏里自带的炮塔：vfn.js VFN）
  const F0 = !air && typeof VFN === 'object' ? ((MOD_DEF.vfn && mk in MOD_DEF.vfn ? MOD_DEF.vfn[mk] : VFN[mk])) : null;
  if (F0 && (F0.trav || F0.el)) {
    const f = A.fn || {}, el = f.el || F0.el || [-6, 18];
    h += `<div class="mdx-pcbar"><b>炮塔、炮管怎么动（游戏里）</b></div>
      <div class="mdx-pcbar">炮塔回转 ${num('data-mpf="trav"', f.trav ?? '', 60)} 度 / 秒（默认 ${F0.trav ?? '—'}，推演里的转速也按它）　炮管俯仰 ${num('data-mpf="el.0"', f.el ? el[0] : '', 56)} 到 ${num('data-mpf="el.1"', f.el ? el[1] : '', 56)} 度（默认 ${(F0.el || [-6, 18]).join(' 到 ')}）</div>
      <div class="mdx-pcbar">俯仰速度 ${num('data-mpf="elR"', f.elR ?? '', 60)} 度 / 秒（默认 ${F0.elR ?? 20}）　后坐 ${num('data-mpf="rc"', f.rc ?? '', 60)} 米（默认 ${F0.rc ?? .3}）${A.fn ? btn('data-mpt="fnrst"', '恢复默认') : ''}</div>`;
  }
  return h;
}
// 一条改造：没有就新建（中心 = 选中块现在的包围盒中心）
function mptEdSet(fn) {
  const mk = MDX.sel, M = mptM(mk), P = MDX.pc;
  if (!M || !P.sel.size) { mdxMsg('先选中块：点「选部件」，再在预览里点'); return false; }
  const A = MDX_W.mdl[mk] = MDX_W.mdl[mk] || {}, ed = A.ed = Array.isArray(A.ed) ? A.ed : [], id = mptIds();
  let e = ed.find(x => x.id === id);
  if (!e) {
    const b = mptBox(M, P.sel), R4 = v => Math.round(v * 1e4) / 1e4;
    e = { id, t: MPT.ed.t.slice(), r: MPT.ed.r.slice(), s: MPT.ed.s, cp: b ? [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2].map(R4) : [0, 0, 0], ...(MPT.ed.paint ? { c: MPT.ed.c, cm: MPT.ed.cm } : {}) };
    ed.push(e);
  }
  fn(e);
  if (!modHex(e.c)) { delete e.c; delete e.cm; }
  MDX.dirty = true;
  return true;
}
function mptView(k) {
  const M = MIV.M, b = M && M.m.bb;
  if (!b) return;
  const V = { front: [0, .05], back: [Math.PI, .05], left: [Math.PI / 2, .05], right: [-Math.PI / 2, .05], top: [MIV.yaw, 1.45], bottom: [MIV.yaw, -1.45], iso: [Math.PI / 4, .55] }[k];
  if (V) { MIV.yaw = V[0]; MIV.pit = V[1]; mivDraw(); }
}
function mptFit() {
  const M = MIV.M, P = MDX.pc;
  if (!M) return;
  const b = (P.sel.size && mptBox(M, P.sel)) || M.m.bb;
  MIV.tgt = [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2]; MIV.dist = Math.max(.6, Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]) * 1.5);
  mivDraw();
}
// 360° 转台
function mptTurn() {
  cancelAnimationFrame(MPT.raf);
  if (!MPT.turn) return;
  MPT.last = performance.now();
  const go = now => {
    if (!MPT.turn || !MDX.el || MDX.el.hidden || MDX.tab !== 'mdl' || !MIV.wrap || !MIV.wrap.isConnected) { MPT.turn = false; return; }
    const dt = Math.min(.1, (now - MPT.last) / 1000); MPT.last = now;
    MIV.yaw += dt * MPT.tspd * Math.PI / 180;
    mivDraw();
    MPT.raf = requestAnimationFrame(go);
  };
  MPT.raf = requestAnimationFrame(go);
}
function mptClick(b) {
  const a = b.dataset.mpt, mk = MDX.sel, M = mptM(mk), P = MDX.pc;
  if (!a || !M) return false;
  if (a === 'iso') { if (!P.sel.size) { mdxMsg('先选中要单独看的块'); return true; } MPT.iso = new Set(P.sel); mptFit(); }
  else if (a === 'all') MPT.iso = null;
  else if (a === 'fit') { mptFit(); return true; }
  else if (a === 'turn') { MPT.turn = !MPT.turn; mptTurn(); }
  else if (a.startsWith('v:')) { mptView(a.slice(2)); return true; }
  else if (a.startsWith('nd:')) {   // 同名的部件一起选（模型里每个车轮各是一个部件）
    const ids = []; for (const nd of a.slice(3).split(',').map(Number)) ids.push(...mdxNodePieces(M, nd, false));
    const on = ids.some(i => !P.sel.has(i)); for (const i of ids) if (on) P.sel.add(i); else P.sel.delete(i);
    mdxPtSync(); mdxPcBar(); mdxMsg((on ? '选上了 ' : '取消了 ') + ids.length + ' 块'); return true;
  }
  else if (a === 'undel') { const A = MDX_W.mdl[mk]; if (A && A.pt) { delete A.pt.x; if (!Object.keys(A.pt).length) delete A.pt; if (!Object.keys(A).length) delete MDX_W.mdl[mk]; MDX.dirty = true; } mdxMsg('去掉的全部放回来了，点「保存」生效'); }
  else if (a === 'apply') { if (!mptEdSet(e => { const E = MPT.ed; e.t = E.t.slice(); e.r = E.r.slice(); e.s = E.s; if (E.paint) { e.c = E.c; e.cm = E.cm; } else { delete e.c; delete e.cm; } })) return true; mdxMsg('改造套上了（预览里马上看得到），点「保存」生效'); }
  else if (a === 'unapply') { const A = MDX_W.mdl[mk], id = mptIds(); if (A && Array.isArray(A.ed)) { A.ed = A.ed.filter(e => e.id !== id); if (!A.ed.length) delete A.ed; if (!Object.keys(A).length) delete MDX_W.mdl[mk]; MDX.dirty = true; } }
  else if (a === 'reset0') MPT.ed = { t: [0, 0, 0], r: [0, 0, 0], s: 1, c: MPT.ed.c, cm: MPT.ed.cm, paint: false };
  else if (a.startsWith('sel:')) { const e = (MDX_W.mdl[mk] || {}).ed[+a.slice(4)]; if (e) { P.sel = new Set(modIdsDec(e.id)); MPT.ed = { t: e.t.slice(), r: e.r.slice(), s: e.s, c: e.c || MPT.ed.c, cm: e.cm ?? .85, paint: !!e.c }; } }
  else if (a.startsWith('del:')) { const A = MDX_W.mdl[mk]; if (A && Array.isArray(A.ed)) { A.ed.splice(+a.slice(4), 1); if (!A.ed.length) delete A.ed; if (!Object.keys(A).length) delete MDX_W.mdl[mk]; MDX.dirty = true; } }
  else if (a === 'fnrst') { const A = MDX_W.mdl[mk]; if (A) { delete A.fn; if (!Object.keys(A).length) delete MDX_W.mdl[mk]; MDX.dirty = true; } }
  else return false;
  MDX.keep = true; mdxRender();
  return true;
}
// 改造的数（输入框、颜色）：改的时候已经有这几块的改造就直接更新，预览马上变
function mptChange(t) {
  const d = t.dataset, mk = MDX.sel;
  if (d.mptS) { MPT.tspd = +t.value; return true; }
  if (d.mpe) {
    const f = d.mpe, E = MPT.ed;
    if (f === 'c') E.c = t.value; else if (f === 'cm') E.cm = (+t.value || 0) / 100; else if (f === 'paint') E.paint = t.checked;
    else if (f === 's') E.s = +t.value > 0 ? +t.value : 1;
    else { const [k, i] = f.split('.'), v = +t.value; if (!isFinite(v)) return true; E[k][+i] = v; }
    const id = mptIds(), A = MDX_W.mdl[mk], cur = A && Array.isArray(A.ed) && A.ed.find(e => e.id === id);
    if (cur) mptEdSet(e => { e.t = E.t.slice(); e.r = E.r.slice(); e.s = E.s; if (E.paint) { e.c = E.c; e.cm = E.cm; } else { delete e.c; delete e.cm; } });
    if (cur || t.type === 'checkbox') { MDX.keep = true; mdxRender(); } else mdxMsg('数改好了，点「套到选中的块上」');
    return true;
  }
  if (d.mpf) {
    const f = d.mpf, v = t.value === '' ? null : +t.value;
    if (v != null && !isFinite(v)) return true;
    const A = MDX_W.mdl[mk] = MDX_W.mdl[mk] || {}, fn = A.fn = A.fn || {};
    if (f.startsWith('el.')) { const F0 = (MOD_DEF.vfn && mk in MOD_DEF.vfn ? MOD_DEF.vfn[mk] : VFN[mk]) || {}, el = fn.el ? fn.el.slice() : (F0.el || [-6, 18]).slice(); el[+f[3]] = v ?? (F0.el || [-6, 18])[+f[3]]; fn.el = el; }
    else if (v == null) delete fn[f]; else fn[f] = v;
    if (!Object.keys(fn).length) delete A.fn;
    if (!Object.keys(A).length) delete MDX_W.mdl[mk];
    MDX.dirty = true; mdxMsg('改了，点「保存」生效');
    return true;
  }
  return false;
}
// —— 接到 modui.js 上 ——
if (typeof mdxPtState === 'function') {   // 游戏里的模型去掉东西不重新落地居中（挂点、喷口、座舱这些都按原来的坐标）
  const s0 = mdxPtState;
  mdxPtState = function (mk) { const S = s0.apply(this, arguments); if (S && mptM(mk)) S.off = [0, 0, 0]; return S; };
}
if (typeof mdxPtSync === 'function') {   // 预览：改造照着改；只看选中的时别的块藏起来（用途码 6）
  const y0 = mdxPtSync;
  mdxPtSync = function () {
    const mk = MDX.sel, M = MDX.tab === 'mdl' && mk ? mptM(mk) : null;
    if (M) mptPreview(M, MDX_W.mdl[mk]);
    const r = y0.apply(this, arguments);
    if (M && MPT.iso && MIV.pt && MIV.pt.codes) {
      const C = new Float32Array(MIV.pt.codes);
      for (let v = 0; v < M.nv; v++) if (!MPT.iso.has(M.pv[v])) C[v] = 6;
      mivSetPt({ ...MIV.pt, codes: C });
    }
    return r;
  };
}
if (typeof mdxMdlForm === 'function') {   // 内置模型的表单：预览下面插「部件」一段，点选栏里多一个「选部件」
  const f0 = mdxMdlForm;
  mdxMdlForm = function (mk) {
    let h = f0.apply(this, arguments);
    const md = typeof mdxModels === 'function' && mdxModels().find(r => r.id === mk);
    if (!md || md.imp) return h;
    if (MPT.k !== mk) { MPT.k = mk; MPT.iso = null; }
    const i = h.indexOf('<h3 style="margin-top:12px">'), part = mptForm(mk, md.kind === 'air');
    return i < 0 ? h + part : h.slice(0, i) + part + h.slice(i);
  };
}
if (typeof mdxBuild === 'function') {
  const b0 = mdxBuild;
  mdxBuild = function () {
    if (MDX.el) return MDX.el;
    const el = b0.apply(this, arguments);
    el.addEventListener('click', e => { const b = e.target.closest('[data-mpt]'); if (b && MDX.tab === 'mdl' && mptClick(b)) e.stopPropagation(); }, true);
    el.addEventListener('change', e => { if (MDX.tab === 'mdl' && (e.target.dataset.mpe != null || e.target.dataset.mpf != null || e.target.dataset.mptS != null) && mptChange(e.target)) e.stopPropagation(); }, true);
    el.addEventListener('input', e => { const t = e.target; if (MDX.tab === 'mdl' && t.dataset.mptS != null) { MPT.tspd = +t.value; e.stopPropagation(); } }, true);
    return el;
  };
}
// 预览加载完：内置模型的「部件」一段要等分好块才能画（modui.js 的 onLoad 会整页重画）
