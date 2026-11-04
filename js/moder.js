'use strict';
// 编辑器：在模型上点选爆反块（用户：编辑器里设置哪些部位是爆反）——「模型与挂点」页车辆模型多一段「爆炸反应装甲块」：
//   用上面的「选部件」（点一块 / 框选 / 按物体选）选好爆反砖，点「选中的设为爆反」；块多时按位置、朝向分成最多 64 组（一组一起炸开、游戏里一起消失）。
//   每组的包围盒、朝外的平均法线、在不在炮塔上算好存进 MOD.mdl[键].erb，车体 / 炮塔的参照存 .erp——推演只看这几个数（mod.js modEraModel），
//   游戏里解码时按 .erb 的块号把每组拆成一个部件（mod.js modEraSplit）。预览里每组画一个琥珀色的框。
const MER = { c: '#ffb02e' };
const merR = x => Math.round(x * 1000) / 1000;
// 每块的包围盒（显示坐标：导入的模型删过部件后重新落地居中）、在不在炮塔上、删没删；点成爆反的块再算朝外的法线：
//   砖是封闭的小盒子，各面法线加起来正好抵消——只累加背离车体 / 炮塔中心的那几面（前面那块砖就是正面加顶面，车顶的砖就是顶面）
function merPieces(mk, M, on) {
  const A = MDX_W.mdl[mk] || {}, pbb = mdxPcBB(M), S = mdxPtState(mk), off = (S && S.off) || [0, 0, 0], n = M.pn;
  const bi = !!M.bi, parts = (M.m && M.m.parts) || [], del = new Set(modIdsDec(A.pt && A.pt.x));
  const turOf = i => {   // 在炮塔上：导入的按「炮塔」用途；游戏里的按模型自带的炮塔部件（绕竖轴转、跟着炮塔角度）
    if (!bi) return S && S.R ? S.R[i] === 1 : false;
    const P = M.pnd ? parts[M.pnd[i] - 1] : null;
    return !!(P && P.k === 'rot' && Array.isArray(P.w) && P.w[0] === 1);
  };
  const out = [], T = new Uint8Array(n), PB = [[1e30, 1e30, 1e30, -1e30, -1e30, -1e30], [1e30, 1e30, 1e30, -1e30, -1e30, -1e30]];
  for (let i = 0; i < n; i++) {
    const r = [0, 1, 2, 3, 4, 5].map(k => pbb[i * 6 + k]);
    if (!(r[0] <= r[3])) continue;
    const t = turOf(i), x = bi ? del.has(i) : !!(S && S.R && S.R[i] === MOD_PT_DEL);
    T[i] = t ? 1 : 0;
    if (!x) for (let k = 0; k < 3; k++) { PB[T[i]][k] = Math.min(PB[T[i]][k], r[k]); PB[T[i]][k + 3] = Math.max(PB[T[i]][k + 3], r[k + 3]); }
    out.push({ i, b: r.map((v, k) => v - off[k % 3]), t, x, n: [0, 0, 0], hb: bi ? !M.pnd || M.pnd[i] === 0 : !(S && S.R) || S.R[i] === 0 });   // hb：车体本身（不算炮管、车轮、机枪这些）
  }
  const C = PB.map(b => [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2]), N = new Float32Array(n * 3), V = M.VB, st = M.st;
  for (const [, , i0, cnt] of M.m.lod[0]) for (let t = i0; t + 2 < i0 + cnt; t += 3) {   // 按三角形面积加权（砖的侧边窄、面积小）
    const a = M.IB[t] * st, b = M.IB[t + 1] * st, c = M.IB[t + 2] * st, i = M.pv[M.IB[t]];
    if (!on.has(i)) continue;
    const ux = V[b] - V[a], uy = V[b + 1] - V[a + 1], uz = V[b + 2] - V[a + 2], vx = V[c] - V[a], vy = V[c + 1] - V[a + 1], vz = V[c + 2] - V[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * V[a + 3] + ny * V[a + 4] + nz * V[a + 5] < 0) { nx = -nx; ny = -ny; nz = -nz; }   // 绕向反了的按顶点法线翻过来
    const q = C[T[i]], mx = (V[a] + V[b] + V[c]) / 3 - q[0], my = (V[a + 1] + V[b + 1] + V[c + 1]) / 3 - q[1], mz = (V[a + 2] + V[b + 2] + V[c + 2]) / 3 - q[2];
    if (nx * mx + ny * my + nz * mz > 0) { N[i * 3] += nx; N[i * 3 + 1] += ny; N[i * 3 + 2] += nz; }
  }
  for (const p of out) p.n = [N[p.i * 3], N[p.i * 3 + 1], N[p.i * 3 + 2]];
  let piv = null;   // 炮塔转轴（显示坐标）
  if (!bi) { const Tq = A.pt && A.pt.ta; if (Tq && Array.isArray(Tq.p)) piv = Tq.p; }
  else { const P = parts.find(q => q && q.k === 'rot' && Array.isArray(q.w) && q.w[0] === 1); if (P) piv = P.p; }
  return { L: out, piv };
}
// 朝向分桶：前 / 后 / 左 / 右 / 顶（推演里只有朝着来弹的块才挡，同一组别混着不同朝向的面）
const merDir = nn => { const [x, y, z] = nn, ax = Math.abs(x), ay = Math.abs(y); return z > Math.max(ax, ay) ? 4 : ax >= ay ? (x >= 0 ? 0 : 1) : (y >= 0 ? 2 : 3); };
// 分组：块不多（≤ 64）一块一组；多了按网格合并——格子从 5 厘米往上加大，直到组数 ≤ 64（炮塔、车体、朝向不同的不合在一起）
function merGroup(L) {
  if (!L.length) return [];
  const key = (p, c) => [p.t ? 1 : 0, merDir(p.n), Math.floor((p.b[0] + p.b[3]) / 2 / c), Math.floor((p.b[1] + p.b[4]) / 2 / c), Math.floor((p.b[2] + p.b[5]) / 2 / c)].join(',');
  const cnt = c => new Set(L.map(p => key(p, c))).size;
  let G;
  if (L.length <= 64) G = L.map(p => [p]);
  else {
    let lo = .05, hi = .05;
    while (cnt(hi) > 64 && hi < 100) { lo = hi; hi *= 2; }
    for (let k = 0; k < 12; k++) { const m = (lo + hi) / 2; if (cnt(m) > 64) lo = m; else hi = m; }
    const M = new Map();
    for (const p of L) { const k = key(p, hi); if (!M.has(k)) M.set(k, []); M.get(k).push(p); }
    G = [...M.values()];
  }
  G.sort((a, b) => a[0].i - b[0].i);
  return G.slice(0, 64).map(g => {
    const b = [1e30, 1e30, 1e30, -1e30, -1e30, -1e30], n = [0, 0, 0];
    for (const p of g) { for (let k = 0; k < 3; k++) { b[k] = Math.min(b[k], p.b[k]); b[k + 3] = Math.max(b[k + 3], p.b[k + 3]); n[k] += p.n[k]; } }
    const l = Math.hypot(...n) || 1;
    return { id: modIdsEnc(g.map(p => p.i).sort((a, c) => a - c)), t: g[0].t ? 1 : 0, b: b.map(merR), n: n.map(x => merR(x / l)) };
  });
}
// 按现在点的块重算分组和参照（MDX_W.mdl[键].erb / erp）；返回有没有变
function merCompute(mk) {
  const M = mdxPcM(mk), A = MDX_W.mdl[mk];
  if (!M || !A || !A.era) return false;
  const S0 = mdxPtState(mk), sig = [A.era, S0 && S0.sig, S0 && S0.off && S0.off.join(','), JSON.stringify((A.pt && A.pt.x) || '')].join('|');
  if (M.merSig === sig && M.merPbb === mdxPcBB(M) && A.erb) return false;   // 没变（每次刷新预览都会来问，大模型逐顶点算一遍要几十毫秒）
  M.merSig = sig; M.merPbb = mdxPcBB(M);
  const on = new Set(modIdsDec(A.era)), { L, piv } = merPieces(mk, M, on), box = sel => { const b = [1e30, 1e30, 1e30, -1e30, -1e30, -1e30]; for (const p of L) if (sel(p)) for (let k = 0; k < 3; k++) { b[k] = Math.min(b[k], p.b[k]); b[k + 3] = Math.max(b[k + 3], p.b[k + 3]); } return b[0] <= b[3] ? b.map(merR) : null; };
  const erb = merGroup(L.filter(p => on.has(p.i) && !p.x));
  const erp = { h: box(p => !p.x && p.hb) || box(p => !p.x && !p.t), ...(L.some(p => p.t && !p.x) ? { t: box(p => p.t && !p.x), tp: piv ? [merR(piv[0]), merR(piv[1])] : null } : {}) };
  const was = JSON.stringify([A.erb || null, A.erp || null]);
  if (erb.length) { A.erb = erb; A.erp = erp; } else { delete A.erb; delete A.erp; }
  return was !== JSON.stringify([A.erb || null, A.erp || null]);
}
function merForm(mk) {
  const M = mdxPcM(mk), A = MDX_W.mdl[mk] || {}, n = modIdsDec(A.era).length, E = A.erb || [], nt = E.filter(e => e.t).length;
  const btn = (a, t, tip) => `<button type="button" class="mdx-btn" data-mer="${a}"${tip ? ` title="${mdxEsc(tip)}"` : ''}>${t}</button>`;
  return `<h3 style="margin-top:12px">爆炸反应装甲块</h3><p class="note">用上面的「选部件」（点一块、框选、按物体选）选好爆反砖，点「选中的设为爆反」。游戏里来弹按方向打在迎弹面某一点，那一点上有朝着来弹、还没炸的块才被挡
    （破甲弹、火箭弹挡掉九成多；坦克炮穿甲弹要在「坦克装甲车」页设了「爆反挡穿甲弹」才挡），车顶朝上的块也挡攻顶导弹；炸掉的块从模型上消失，那里就只剩本体装甲。
    块多时按位置、朝向分成最多 64 组，一组一起炸开。预览里每组画一个琥珀色的框。</p>
    ${M ? `<div class="mdx-pcbar">${btn('add', '选中的设为爆反', '把选中的块加进爆反')}${btn('del', '选中的取消爆反')}${n ? btn('sel', '选出全部爆反块') + btn('clear', '全部清掉') : ''}
      <span class="def">${n ? `已设 ${n} 块 · 分成 ${E.length} 组（炮塔上 ${nt} 组、车体上 ${E.length - nt} 组）` : '还没有设爆反块'}</span></div>` : '<p class="note">模型读出来以后才能点。</p>'}`;
}
function merClick(b) {
  const a = b.dataset.mer, mk = MDX.sel, M = mdxPcM(mk), P = MDX.pc;
  if (!a || !M) return false;
  const A = MDX_W.mdl[mk] = MDX_W.mdl[mk] || {}, cur = new Set(modIdsDec(A.era));
  if (a === 'add' || a === 'del') {
    if (!P.sel.size) { mdxMsg('先在上面「选部件」选中块'); return true; }
    for (const i of P.sel) if (a === 'add') cur.add(i); else cur.delete(i);
  } else if (a === 'clear') cur.clear();
  else if (a === 'sel') { P.sel = new Set(cur); mdxPtSync(); mdxPcBar(); mdxMsg('选上了全部 ' + cur.size + ' 块爆反'); return true; }
  if (cur.size) A.era = modIdsEnc([...cur].sort((x, y) => x - y)); else { delete A.era; delete A.erb; delete A.erp; }
  if (A.era) merCompute(mk);
  if (!Object.keys(A).length) delete MDX_W.mdl[mk];
  MDX.dirty = true; MDX.keep = true; mdxRender();
  mdxMsg(a === 'clear' ? '爆反块全部清掉了，点「保存」生效' : `爆反：${cur.size} 块，分成 ${(A.erb || []).length} 组，点「保存」生效`);
  return true;
}
// 接到 modui.js 上：车辆模型的表单在「主炮炮口」前面插这一段；预览里画每组的框；删块、改造、换炮塔以后分组跟着重算
if (typeof mdxMdlForm === 'function') {
  const f0 = mdxMdlForm;
  mdxMdlForm = function (mk) {
    const h = f0.apply(this, arguments), md = typeof mdxModels === 'function' && mdxModels().find(r => r.id === mk);
    if (!md || md.kind === 'air') return h;
    const i = h.indexOf('<h3 style="margin-top:12px">主炮炮口');
    return i < 0 ? h + merForm(mk) : h.slice(0, i) + merForm(mk) + h.slice(i);
  };
}
if (typeof mdxPtSync === 'function') {
  const s0 = mdxPtSync;
  mdxPtSync = function () {
    const r = s0.apply(this, arguments), mk = MDX.sel, A = mk && MDX.tab === 'mdl' && MDX_W && MDX_W.mdl[mk];
    if (!A || !A.era || typeof MIV !== 'object' || !mdxPcM(mk)) return r;
    if (merCompute(mk)) MDX.dirty = true;   // 删了块、换了炮塔用途、改造挪了位置：分组和包围盒跟着变
    const E = (A.erb || []).map(e => e.b), deco = MIV.deco || (MIV.deco = []);
    for (const b of E) {
      const c = [[b[0], b[1], b[2]], [b[3], b[1], b[2]], [b[3], b[4], b[2]], [b[0], b[4], b[2]], [b[0], b[1], b[5]], [b[3], b[1], b[5]], [b[3], b[4], b[5]], [b[0], b[4], b[5]]];
      for (const [p, q] of [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]) deco.push({ k: 'line', a: c[p], b: c[q], col: MER.c, w: 1.5 });
    }
    if (typeof mivDraw === 'function') mivDraw();
    return r;
  };
}
if (typeof mdxBuild === 'function') {
  const b0 = mdxBuild;
  mdxBuild = function () {
    if (MDX.el) return MDX.el;
    const el = b0.apply(this, arguments);
    el.addEventListener('click', e => { const b = e.target.closest('[data-mer]'); if (b && MDX.tab === 'mdl' && merClick(b)) e.stopPropagation(); }, true);
    return el;
  };
}
