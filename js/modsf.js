'use strict';
// 编辑器：直接在 Sketchfab 上搜模型、一键导入（用户：能自己从网上找模型导入）——「模型与挂点」页「＋ 导入模型」下面多一段：
//   搜索走 Sketchfab 公开的搜索接口（只列能下载的），导入走下载接口（要用户自己的 API 密钥，Sketchfab 网站「设置 → 密码与 API」里有）：
//   拿到 .glb 的临时下载地址 → 下载 → 交给 modimp.js mimImport（和选本地文件导入同一条路：同样的类型、全长、朝向设置）。
//   密钥只存在这台设备的浏览器里（localStorage MSF_KEY），只发给 Sketchfab 自己的接口；代码里、发布的网页里都没有。
//   授权：CC-BY 要署名（模型文件里带着作者、授权，导入时记进素材致谢；文件里没有的按搜索结果补上），带 NC 的不能商用、ND 的不许改；
//   简介写着从别的游戏里扒的（Ripped、War Thunder……）别用（项目的规矩，见 CLAUDE.md）。
const MSF_KEY = 'bh-sf-token', MSF_API = 'https://api.sketchfab.com/v3';
const MSF = { q: '', res: [], next: null, busy: '', biz: true, err: '' };
const msfTok = () => { try { return localStorage.getItem(MSF_KEY) || ''; } catch (e) { return ''; } };
const msfBiz = r => !/nc|nd/i.test((r.license && (r.license.slug || r.license.label)) || '');   // 能商用、能改（CC0、CC-BY、CC-BY-SA）
function msfCard(r) {
  const th = ((r.thumbnails && r.thumbnails.images) || []).filter(i => i.width >= 200).sort((a, b) => a.width - b.width)[0] || ((r.thumbnails && r.thumbnails.images) || [])[0];
  const lic = (r.license && r.license.label) || '授权不明', user = (r.user && (r.user.displayName || r.user.username)) || '';
  return `<div class="msf-it"><img src="${mdxEsc(th ? th.url : '')}" alt="" loading="lazy"><b>${mdxEsc(r.name)}</b><small>${mdxEsc(user)} · ${mdxEsc(lic)}${msfBiz(r) ? '' : ' · <span style="color:var(--amber, #ffc24a)">不能商用 / 不许改</span>'} · ${(r.faceCount || 0).toLocaleString()} 面</small>
    <span><button type="button" class="mdx-btn pri" data-msf="imp" data-uid="${mdxEsc(r.uid)}"${MSF.busy ? ' disabled' : ''}>导入</button> <a href="${mdxEsc(r.viewerUrl || 'https://sketchfab.com/3d-models/' + r.uid)}" target="_blank" rel="noopener">在网站上看</a></span></div>`;
}
function msfForm() {
  const tok = msfTok(), L = MSF.biz ? MSF.res.filter(msfBiz) : MSF.res;
  return `<h3 style="margin-top:16px">从 Sketchfab 搜索导入</h3><p class="note">搜 Sketchfab 上能下载的模型，点「导入」直接下载进编辑器（用上面同样的类型、全长、朝向、贴图设置）。下载要用你自己的 Sketchfab API 密钥（网站「设置 → 密码与 API」），
    只存在这台设备的浏览器里、只发给 Sketchfab。CC-BY 要署名（自动列进「设置 → 素材致谢」），带 NC 的不能商用、ND 的不许改；简介写着从别的游戏里扒的（Ripped、War Thunder……）别用。</p>
    <div class="mdx-row"><label>API 密钥</label><input type="password" data-msf="tok" value="${mdxEsc(tok)}" placeholder="粘贴 Sketchfab 的 API 密钥" autocomplete="off"><span class="def">${tok ? '已存在这台设备' : '还没填'}</span><span>${tok ? '<button type="button" class="mdx-btn" data-msf="forget">忘掉</button>' : ''}</span></div>
    <div class="mdx-row"><label>搜索</label><input type="text" data-msf="q" value="${mdxEsc(MSF.q)}" placeholder="比如 T-90、F-16、destroyer"><span><label><input type="checkbox" data-msf="biz"${MSF.biz ? ' checked' : ''}> 只看能商用、能改的</label></span><button type="button" class="mdx-btn" data-msf="go"${MSF.busy ? ' disabled' : ''}>搜索</button></div>
    ${MSF.busy || MSF.err ? `<p class="note" style="color:${MSF.err ? 'var(--amber, #ffc24a)' : 'inherit'}">${mdxEsc(MSF.err || MSF.busy)}</p>` : ''}
    <div class="msf-grid">${L.map(msfCard).join('')}</div>${MSF.next ? '<p><button type="button" class="mdx-btn" data-msf="more">再多一些</button></p>' : ''}`;
}
async function msfSearch(more) {
  const url = more ? MSF.next : `${MSF_API}/search?type=models&downloadable=true&count=24&q=${encodeURIComponent(MSF.q)}`;
  if (!url) return;
  MSF.busy = '正在搜索…'; MSF.err = ''; msfRedraw();
  try {
    const r = await fetch(url), j = await r.json();
    if (!r.ok) throw new Error((j && (j.detail || j.message)) || r.status);
    MSF.res = more ? MSF.res.concat(j.results || []) : (j.results || []); MSF.next = j.next || null;
    if (!MSF.res.length) MSF.err = '没搜到能下载的模型，换个词试试';
  } catch (e) { MSF.err = '搜索失败：' + e.message; }
  MSF.busy = ''; msfRedraw();
}
async function msfImport(uid) {
  const tok = msfTok(), r = MSF.res.find(x => x.uid === uid);
  if (!tok) { MSF.err = '先在上面填 Sketchfab 的 API 密钥'; msfRedraw(); return; }
  if (!r || typeof mimImport !== 'function') return;
  MSF.busy = `正在向 Sketchfab 要「${r.name}」的下载地址…`; MSF.err = ''; msfRedraw();
  try {
    const q = await fetch(`${MSF_API}/models/${encodeURIComponent(uid)}/download`, { headers: { Authorization: 'Token ' + tok } }), j = await q.json();
    if (q.status === 401 || q.status === 403) throw new Error('密钥不对或没有下载权限');
    if (!q.ok) throw new Error((j && (j.detail || j.message)) || q.status);
    const g = j.glb || j.gltf;
    if (!g || !g.url) throw new Error('这个模型没有 glTF 格式的下载');
    MSF.busy = `正在下载「${r.name}」（约 ${Math.round((g.size || 0) / 1048576 * 10) / 10} MB）…`; msfRedraw();
    const b = await (await fetch(g.url)).blob(), nm = String(r.name || 'sketchfab').replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 60);
    const file = new File([b], nm + (j.glb ? '.glb' : '.zip'), { type: j.glb ? 'model/gltf-binary' : 'application/zip' }), I = MDX.imp;
    MSF.busy = '正在导入…'; msfRedraw();
    MIM.texMax = +I.tex || 2048;
    const id = await mimImport([file], { name: I.name || r.name, kind: I.kind, len: +I.len || 0, hl: I.kind === 'veh' ? +I.hl || 0 : 0, fwd: I.fwd, up: I.up, prog: t => mdxMsg('正在导入：' + t + '…') });
    const L = MOD.lib[id];
    if (L && !(L.credit && L.credit.author)) L.credit = { title: r.name, author: (r.user && (r.user.displayName || r.user.username)) || '', license: (r.license && r.license.label) || '', url: r.viewerUrl || 'https://sketchfab.com/3d-models/' + uid };   // 文件里没带署名：按搜索结果补
    if (L) { L.sf = uid; modStoreSave(); }
    MDX_W.lib = modClone(MOD.lib); MDX.sel = id; MDX.pk = ''; MSF.busy = '';
    mdxRender(); mdxMsg(`「${r.name}」导入好了：在预览里看看朝向对不对，再点炮口 / 挂点；用到型号上或加进兵种栏，点「保存」`);
  } catch (e) { MSF.busy = ''; MSF.err = '导入失败：' + e.message; msfRedraw(); console.warn(e); }
}
const msfRedraw = () => { if (MDX.el && !MDX.el.hidden && MDX.tab === 'mdl' && MDX.sel === '+imp') { MDX.keep = true; mdxRender(); } };
// 接到 modui.js 上：导入页下面加这一段；点、改由这里先接
if (typeof mdxImpForm === 'function') { const f0 = mdxImpForm; mdxImpForm = function () { return f0.apply(this, arguments) + msfForm(); }; }
if (typeof mdxBuild === 'function') {
  const b0 = mdxBuild;
  mdxBuild = function () {
    if (MDX.el) return MDX.el;
    const el = b0.apply(this, arguments), st = document.createElement('style');
    st.textContent = `#mdx .msf-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 10px; margin: 8px 0; }
#mdx .msf-it { display: flex; flex-direction: column; gap: 4px; border: 1px solid var(--line); border-radius: 6px; padding: 6px; font-size: 12px; }
#mdx .msf-it img { width: 100%; aspect-ratio: 16 / 10; object-fit: cover; border-radius: 4px; background: #202528; }
#mdx .msf-it b { font-size: 13px; color: var(--text); } #mdx .msf-it small { color: var(--mute); line-height: 1.4; } #mdx .msf-it a { color: var(--g-hi); font-size: 12px; }`;
    document.head.appendChild(st);
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-msf]');
      if (!b || MDX.tab !== 'mdl' || b.tagName === 'INPUT') return;
      e.stopPropagation();
      const a = b.dataset.msf;
      if (a === 'go') { const q = el.querySelector('input[data-msf="q"]'); MSF.q = q ? q.value.trim() : MSF.q; if (MSF.q) msfSearch(false); }
      else if (a === 'more') msfSearch(true);
      else if (a === 'imp') msfImport(b.dataset.uid);
      else if (a === 'forget') { try { localStorage.removeItem(MSF_KEY); } catch (er) { /* 存不了就算了 */ } msfRedraw(); mdxMsg('密钥已从这台设备删掉'); }
    }, true);
    el.addEventListener('change', e => {
      const t = e.target, a = t.dataset && t.dataset.msf;
      if (!a) return;
      e.stopPropagation();
      if (a === 'tok') { try { if (t.value.trim()) localStorage.setItem(MSF_KEY, t.value.trim()); else localStorage.removeItem(MSF_KEY); } catch (er) { /* 存不了 */ } msfRedraw(); mdxMsg('密钥存在这台设备的浏览器里了'); }
      else if (a === 'q') MSF.q = t.value.trim();
      else if (a === 'biz') { MSF.biz = t.checked; msfRedraw(); }
    }, true);
    el.addEventListener('keydown', e => { const t = e.target; if (t.dataset && t.dataset.msf === 'q' && e.key === 'Enter') { e.preventDefault(); MSF.q = t.value.trim(); if (MSF.q) msfSearch(false); } }, true);
    return el;
  };
}
