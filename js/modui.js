'use strict';
// 编辑器界面（主菜单「编辑器」；数据与套用在 mod.js）：左边按页签列出型号，右边一项项参数——改了的高亮，每项能单独恢复默认，「保存」后下一局生效
//   （正在打的这一局里的车辆也马上重新套）。页签：坦克装甲车（各面装甲、穿深、爆反、速度、加速度、转向……）、飞机（性能、推力重量、挂载、航炮，攻守双方）、机载武器、
//   导弹（速度、加速度、弹道、毁伤）、模型与挂点（导入模型，预览里点炮口 / 航炮口 / 挂点 / 尾喷口，尾焰参数，modimp.js）、特效贴图（导入序列帧换掉爆炸、炮口焰……）、
//   战场大小、画面、模组包（导出 / 导入 JSON）
const MDX = { el: null, tab: 'veh', sel: null, q: '', dirty: false, pk: '', hg: 'ext', mir: true, nzR: .45, imp: { kind: 'veh', fwd: '+z', up: '+y', tex: 2048 }, impF: null, fxImp: { n: 8, f: 64, mode: 2 }, fxF: null };
const mdxEsc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const mdxR = (v, d = 1) => modNum(v) ? Math.round(v * d) / d : v;
// —— 车辆型号：模型键 → 名称、车种（VEH_SPEC 的键）、目录里的修正（spawn.mod）——
function mdxVehList() {
  const L = new Map(), add = (k, nm, type, side, md) => { if (!k || !(typeof RLM === 'object' && RLM[k]) || L.has(k)) return; L.set(k, { k, nm, type, side, md: md || {} }); };
  if (typeof CATALOG === 'object') for (const c of CATALOG) {
    if (!c.spawn || c.spawn.kind !== 'veh' || !VEH_SPEC[c.spawn.type]) continue;
    const k = (RLM_NAME.find(([re]) => re.test(c.name)) || [])[1] || (RLM_TYPE[c.side === 'e' ? 'e' : 'p'] || {})[c.spawn.type];
    add(k, c.name, c.spawn.type, c.side, c.spawn.mod);
  }
  for (const sd of ['p', 'e']) for (const t in RLM_TYPE[sd] || {}) add(RLM_TYPE[sd][t], (VEH_MODEL[sd] || {})[t] || RLM_TYPE[sd][t], t, sd);
  return [...L.values()];
}
const mdxMM = a => Math.round(a * MOD_MM);
const MDX_VEH_F = [
  ['hp', '结构值', '', o => o.sp.hp],
  ['speed', '最高速度', '千米 / 时', o => mdxR(o.sp.speed * 3.6, 1)],
  ['armF', '正面装甲', '毫米', o => mdxMM(o.sp.armor)],
  ['armS', '侧面装甲', '毫米', o => mdxMM(vehArcArm(o.sp.armor, 's'))],
  ['armR', '后部装甲', '毫米', o => mdxMM(vehArcArm(o.sp.armor, 'r'))],
  ['armT', '顶部装甲', '毫米', o => mdxMM(vehArcArm(o.sp.armor, 't'))],
  ['pen', '主炮穿深', '毫米', o => o.sp.gun && o.sp.gun.ap ? mdxMM(o.sp.gun.ap * (o.md.pow || 1)) : null],
  ['range', '主炮射程', '米', o => o.sp.gun ? Math.round(o.sp.gun.range * (o.md.rng || 1)) : null],
  ['rof', '装填时间', '秒', o => o.sp.gun ? mdxR(o.sp.gun.rof / (o.md.rof || 1), 10) : null],
  ['acc', '加速度（空着 = 一下就到速度）', '米 / 秒²', o => null],
  ['turn', '车体转向速度', '度 / 秒', o => o.sp.turn ? mdxR(o.sp.turn * 180 / Math.PI, 10) : null],
  ['trav', '炮塔回转速度', '度 / 秒', o => { const F = typeof VFN === 'object' && VFN[V3G_VEH[o.k] || o.k]; return F && F.trav ? F.trav : mdxR(2.4 * 180 / Math.PI, 10); }],
  ['sight', '视野', '米', o => o.sp.sight],
  ['era', '爆炸反应装甲', [['auto', '照模型'], ['on', '挂上'], ['off', '拆掉']], o => 'auto'],
  ['eraHeat', '爆反挡破甲弹', '%', o => 92],
  ['eraKe', '爆反挡穿甲弹', '%', o => RLM[o.k] && RLM[o.k].era && RLM[o.k].era.heavy ? 30 : 0],
  ['eraCov', '爆反覆盖率（模型上没有块时）', '%', o => 60],
  ['eraN', '爆反块数（模型上没有块时）', '块', o => 16]
];
// 飞机：[字段, 名称, 单位, 默认值（显示单位）(a 型号表, k 型号键), 显示 → 存的值, 存的值 → 显示]
const mdxAP0 = k => MOD_DEF.ap[k] || (typeof AP === 'object' && AP[k]) || null;
const mdxFL0 = k => typeof FL_KEY === 'object' && FL_KEY[k] === k ? MOD_DEF.fl[k] || FL_AC[k] : null;
const mdxGun0 = k => k in MOD_DEF.gun ? MOD_DEF.gun[k] : typeof FW_GUN === 'object' ? FW_GUN[k] : null;
const MDX_PERF_F = [
  ['apM', '作战重量', '千克', (a, k) => mdxAP0(k) && mdxAP0(k).m], ['apT', '最大推力（开加力）', '千牛', (a, k) => mdxAP0(k) && mdxR(mdxAP0(k).T / 1000, 10), v => v * 1000, v => mdxR(v / 1000, 10)],
  ['flTm', '军用推力（不开加力，亲自驾驶时）', '千牛', (a, k) => mdxFL0(k) && mdxR(mdxFL0(k).Tm / 1000, 10), v => v * 1000, v => mdxR(v / 1000, 10), 'fl'],
  ['apS', '翼面积', '平方米', (a, k) => mdxAP0(k) && mdxAP0(k).S], ['apCD0', '零升阻力系数', '', (a, k) => mdxAP0(k) && mdxAP0(k).CD0], ['apK', '诱导阻力因子', '', (a, k) => mdxAP0(k) && mdxAP0(k).K],
  ['apCL', '最大升力系数', '', (a, k) => mdxAP0(k) && mdxAP0(k).CL], ['apNz', '最大过载', 'G', (a, k) => mdxAP0(k) && mdxAP0(k).nz],
  ['flP', '最大滚转速度（亲自驾驶）', '度 / 秒', (a, k) => mdxFL0(k) && mdxR(mdxFL0(k).pmax * 180 / Math.PI), null, null, 'fl'], ['flA', '最大迎角（亲自驾驶）', '度', (a, k) => mdxFL0(k) && mdxR(mdxFL0(k).alim * 180 / Math.PI, 10), null, null, 'fl']
];
const MDX_GUN_F = [['gunN', '航炮备弹（0 = 没有航炮）', '发', (a, k) => (mdxGun0(k) || { n: 0 }).n], ['gunRpm', '航炮射速', '发 / 分', (a, k) => (mdxGun0(k) || { rpm: 1650 }).rpm], ['gunV0', '航炮初速', '米 / 秒', (a, k) => (mdxGun0(k) || { v0: 860 }).v0]];
const MDX_EAIR_F = [
  ['spd', '巡航速度', '千米 / 时', a => mdxR(a.spd * 3.6), v => v / 3.6, v => mdxR(v * 3.6)], ['turn', '转弯（推演）', '', a => a.turn], ['hp', '耐打（挨几下才掉）', '', a => a.hp],
  ['flares', '热诱弹（组）', '', a => a.flares], ['stealth', '雷达截面系数（越小越隐身，1 = 不隐身）', '', a => a.stealth ?? 1]
];
const MDX_AIR_F = [
  ['spd', '巡航速度', '千米 / 时', a => mdxR(a.spd * 3.6), v => v / 3.6, v => mdxR(v * 3.6)],
  ['aa', '被高炮打中的概率', '%', a => mdxR((a.aa || 0) * 100, 10), v => v / 100, v => mdxR(v * 100, 10)],
  ['stealth', '雷达截面系数（越小越隐身，1 = 不隐身）', '', a => a.stealth ?? 1],
  ['radar', '机载雷达距离（推演）', '米', a => a.radar ?? null],
  ['aamR', '空空弹射程（推演）', '米', a => a.aamR ?? null],
  ['pkK', '空空弹命中修正', '倍', a => a.pkK ?? 1],
  ['agmR', '空地弹射程（推演）', '米', a => a.agmR ?? null],
  ['std', '防区外投弹距离（推演）', '米', a => a.std ?? null],
  ['turn', '转弯修正', '倍', a => a.turn ?? 1],
  ['loiter', '盘旋时间', '秒', a => a.loiter ?? null]
];
const MDX_WPN_F = [['M', '速度', '马赫'], ['R', '射程', '公里'], ['Rmin', '最小射程', '米'], ['tb', '发动机工作时间', '秒'], ['g', '最大过载', 'G'], ['cone', '导引头视场', '度'], ['lk', '锁定时间', '秒'], ['pk', '命中概率', '0–1'], ['acc', '助推加速度（默认 20）', 'G']];
const MDX_PROF = [['cruise', '平飞巡航'], ['skim', '掠海超低空'], ['loft', '高抛（中段爬高）'], ['popup', '末段跃升俯冲']];
const MDX_MSL_F = [
  ['spd', '飞行速度', '米 / 秒', m => m.spd], ['acc', '加速度（空着 = 一出筒就是巡航速度）', '米 / 秒²', m => m.acc ?? null], ['v0', '出筒速度（设了加速度时）', '米 / 秒', m => m.v0 ?? null],
  ['sprint', '末段冲刺速度', '米 / 秒', m => m.sprint ?? null], ['sr', '末段冲刺距离', '米', m => m.sr ?? null],
  ['prof', '弹道', MDX_PROF, m => m.prof || 'cruise'], ['z', '巡航高度（0 贴地 – 1 高空）', '', m => m.z], ['lz', '高抛 / 跃升高度（加多少）', '', m => m.lz ?? .5], ['pd', '跃升开始离目标', '米', m => m.pd ?? 700],
  ['dmg', '毁伤', '', m => m.dmg], ['pen', '穿深', '毫米', m => mdxMM(m.pen), v => v / MOD_MM], ['R', '爆炸半径', '米', m => m.pw && m.pw.R], ['icp', '被拦截修正（越小越难拦）', '', m => m.icp]
];
const MDX_TABS = [['veh', '坦克装甲车'], ['air', '飞机'], ['wpn', '机载武器'], ['msl', '导弹'], ['mdl', '模型与挂点'], ['fx', '特效贴图'], ['map', '战场'], ['ren', '画面'], ['pack', '模组包']];
const MDX_CSS = `
#mdx { position: fixed; inset: 0; z-index: 46; display: grid; place-items: center; background: rgba(var(--bg-rgb), .86); padding: max(10px, env(safe-area-inset-top, 0px)) 12px; }
#mdx[hidden] { display: none; }
#mdx .mdx-win { width: min(1180px, 100%); height: min(780px, 100%); display: grid; grid-template-rows: auto auto minmax(0, 1fr) auto; background: rgba(var(--pn-rgb), .95); border: 1px solid var(--line-hi); border-radius: 8px; overflow: hidden; }
#mdx header { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-bottom: 1px solid var(--line); }
#mdx header h2 { margin: 0; font-size: 18px; color: var(--g-hi); letter-spacing: .08em; flex: 1; }
#mdx .mdx-tabs { display: flex; gap: 4px; padding: 6px 10px; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
#mdx .mdx-tabs button, #mdx .mdx-btn { background: transparent; color: var(--text); border: 1px solid var(--line); border-radius: 5px; padding: 6px 12px; font: inherit; font-size: 13px; cursor: pointer; }
#mdx .mdx-tabs button.on { background: rgba(var(--g-rgb), .16); border-color: var(--g); color: var(--g-hi); }
#mdx .mdx-btn:hover, #mdx .mdx-tabs button:hover { border-color: var(--g); }
#mdx .mdx-btn.pri { background: rgba(var(--g-rgb), .2); border-color: var(--g); color: var(--g-hi); }
#mdx .mdx-body { display: grid; grid-template-columns: 260px minmax(0, 1fr); min-height: 0; }
#mdx .mdx-body.one { grid-template-columns: minmax(0, 1fr); }
#mdx .mdx-list { border-right: 1px solid var(--line); overflow: auto; padding: 6px; display: flex; flex-direction: column; gap: 3px; }
#mdx .mdx-list input { margin-bottom: 4px; }
#mdx .mdx-it { text-align: left; background: transparent; color: var(--text); border: 1px solid transparent; border-radius: 4px; padding: 6px 8px; font: inherit; font-size: 13px; cursor: pointer; }
#mdx .mdx-it.on { border-color: var(--g); background: rgba(var(--g-rgb), .12); }
#mdx .mdx-it .md { color: var(--amber, #ffc24a); margin-left: 6px; font-size: 11px; }
#mdx .mdx-it small { display: block; color: var(--mute); font-size: 11px; }
#mdx .mdx-form { overflow: auto; padding: 12px 16px; }
#mdx .mdx-form h3 { margin: 0 0 4px; font-size: 16px; color: var(--g-hi); }
#mdx .mdx-form p.note { margin: 2px 0 12px; color: var(--mute); font-size: 12px; line-height: 1.5; }
#mdx .mdx-row { display: grid; grid-template-columns: minmax(150px, 1.3fr) minmax(110px, 1fr) auto auto; gap: 8px; align-items: center; padding: 5px 0; border-bottom: 1px dashed rgba(var(--g-rgb), .1); }
#mdx .mdx-row label { font-size: 13px; color: var(--text); }
#mdx .mdx-row .def { font-size: 11px; color: var(--mute); white-space: nowrap; }
#mdx .mdx-row.chg label { color: var(--amber, #ffc24a); }
#mdx input[type=number], #mdx input[type=text], #mdx select, #mdx textarea { background: rgba(0, 0, 0, .35); color: var(--text); border: 1px solid var(--line); border-radius: 4px; padding: 5px 7px; font: inherit; font-size: 13px; width: 100%; box-sizing: border-box; }
#mdx textarea { min-height: 260px; font-family: var(--mono, monospace); font-size: 12px; }
#mdx .mdx-rst { background: transparent; border: 0; color: var(--mute); cursor: pointer; font-size: 14px; padding: 2px 6px; }
#mdx .mdx-rst:hover { color: var(--g-hi); }
#mdx footer { display: flex; gap: 8px; align-items: center; padding: 8px 14px; border-top: 1px solid var(--line); }
#mdx footer .msg { flex: 1; color: var(--mute); font-size: 12px; }
#mdx .mdx-load { display: grid; grid-template-columns: 1.6fr 1fr .7fr auto; gap: 6px; align-items: center; margin: 4px 0; }
#mdx .mdx-it.add { color: var(--g-hi); border-style: dashed; border-color: rgba(var(--g-rgb), .35); }
#mdx .mdx-view { margin: 0 0 4px; }
#mdx .mdx-stk { position: sticky; top: -12px; z-index: 3; margin: 0 -16px 8px; padding: 8px 16px 2px; background: rgba(var(--pn-rgb), .98); border-bottom: 1px solid var(--line); }   /* 预览和点选那一行钉在表单顶上：往下翻按钮时还能在模型上点 */
#mdx .miv { position: relative; width: 100%; height: min(40vh, 340px); border: 1px solid var(--line); border-radius: 6px; overflow: hidden; background: #202528; }
#mdx .miv canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
#mdx .miv .miv-ov { pointer-events: none; }
#mdx .miv .miv-msg { position: absolute; left: 10px; bottom: 8px; color: var(--mute); font-size: 12px; pointer-events: none; }
#mdx .mdx-pick { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 4px 0 8px; font-size: 13px; }
#mdx .mdx-pick label { display: flex; gap: 4px; align-items: center; color: var(--mute); }
#mdx .mdx-xyz { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 4px; }
#mdx .mdx-bind { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 4px 10px; font-size: 13px; }
#mdx .mdx-bind label { display: flex; gap: 6px; align-items: center; }
#mdx .mdx-fxv { width: 192px; height: 192px; border: 1px solid var(--line); border-radius: 6px; display: block; margin: 6px 0; }
#mdx .mdx-btn[disabled] { opacity: .45; cursor: default; }
#mdx .mdx-pcbar { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 6px 0; font-size: 13px; }
#mdx .mdx-pcbar .mdx-btn { padding: 4px 9px; font-size: 12px; }
#mdx .mdx-pcbar label { display: inline-flex; gap: 4px; align-items: center; color: var(--mute); }
#mdx .mdx-pcbar input[type=number] { padding: 3px 5px; }
#mdx .mdx-pcbar select { width: auto; }
#mdx .mdx-pcsel { color: var(--amber, #ffc24a); margin-left: auto; }
#mdx .mdx-ax { border-left: 2px solid var(--line); padding-left: 8px; margin: 6px 0; }
#mdx .mdx-nodes { margin: 8px 0; font-size: 13px; }
#mdx .mdx-nodes summary { cursor: pointer; color: var(--g-hi); padding: 4px 0; }
#mdx .mdx-nodes .mdx-it { display: block; width: 100%; }
#mdx .mdx-row input[type=range] { width: 100%; }
#mdx .mdx-row .def input[type=number] { width: 74px; padding: 2px 4px; }
@media (max-width: 720px) { #mdx .mdx-body { grid-template-columns: 1fr; grid-template-rows: 160px minmax(0, 1fr); } #mdx .mdx-list { border-right: 0; border-bottom: 1px solid var(--line); } #mdx .mdx-row { grid-template-columns: 1fr 1fr auto; } #mdx .mdx-row .def { display: none; } }`;
function mdxBuild() {
  if (MDX.el) return MDX.el;
  const st = document.createElement('style'); st.textContent = MDX_CSS; document.head.appendChild(st);
  const el = document.createElement('div');
  el.id = 'mdx'; el.className = 'mn-layer'; el.hidden = true; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', '编辑器');   // mn-layer：主菜单开着时别的页面元素都被藏起来（menu.js），只有这一类浮层看得见
  el.innerHTML = `<div class="mdx-win"><header><h2>编辑器 · 自定义装备与战场</h2><button type="button" class="mdx-btn" data-a="close">关闭</button></header>
    <nav class="mdx-tabs">${MDX_TABS.map(([k, n]) => `<button type="button" data-tab="${k}">${n}</button>`).join('')}</nav><div class="mdx-body"></div>
    <footer><span class="msg"></span><button type="button" class="mdx-btn" data-a="undo">放弃没保存的改动</button><button type="button" class="mdx-btn pri" data-a="save">保存</button></footer></div>`;
  document.body.appendChild(el);
  el.addEventListener('click', mdxClick);
  el.addEventListener('change', mdxChange);
  el.addEventListener('input', e => { if (e.target.matches('.mdx-list input')) { MDX.q = e.target.value.trim(); mdxRender(true); } else if (!mdxHzInput(e.target)) mdxPtInput(e.target); });
  MDX.el = el;
  return el;
}
let MDX_W = null;   // 正在编辑的副本（保存才写回 MOD）
function openModEditor() {
  if (typeof document === 'undefined') return;
  const el = mdxBuild();
  MDX_W = JSON.parse(JSON.stringify(MOD)); MDX.dirty = false;
  el.hidden = false;
  if (typeof lyPush === 'function') lyPush(el, e => { if (e.key === 'Escape') { e.preventDefault(); closeModEditor(); } });
  mdxRender();
}
function closeModEditor() {
  if (!MDX.el || MDX.el.hidden) return;
  if (MDX.dirty && !confirm('有没保存的改动，关掉就不要了？')) return;
  MDX.el.hidden = true;
  if (typeof lyPop === 'function') lyPop(MDX.el);
  if (typeof MENU === 'object' && MENU.open && typeof mnFocus === 'function') mnFocus();
}
const mdxMsg = t => { const m = MDX.el && MDX.el.querySelector('footer .msg'); if (m) m.textContent = t; };
// —— 3D 模型：内置的（飞机按剪影键、车辆按型号的原表）+ 导入的 ——
const mdxLibOf = k => (MDX_W && MDX_W.lib && MDX_W.lib[k]) || MOD.lib[k] || null;
const mdxAirDef = () => Object.keys(MOD_DEF.v3air).length ? MOD_DEF.v3air : V3G_AIR;
function mdxModels() {
  const L = [], seen = new Map(), add = (id, nm, kind, imp) => { if (!id) return; const o = seen.get(id); if (o) { if (nm && !o.nms.includes(nm)) o.nms.push(nm); return; } const r = { id, nms: nm ? [nm] : [], kind, imp }; seen.set(id, r); L.push(r); };
  for (const id in MOD.lib) if (MOD.lib[id].k === 'mdl' && !MODX.bad.has(id)) add(id, MOD.lib[id].nm, MOD.lib[id].kind || 'veh', 1);
  const AD = mdxAirDef();
  for (const k in AIR_MDL) { const id = AD[modAirSil(k)]; if (id) add(id, (MOD_DEF.air[k] || AIR_MDL[k]).name, 'air', 0); }
  if (typeof EA_SPEC === 'object') for (const t in EA_SPEC) { const id = AD[modEairSil(t)]; if (id) add(id, (MOD_DEF.eair[t] || EA_SPEC[t]).name, 'air', 0); }
  for (const s in AD) if (typeof AD[s] === 'string' && AD[s] !== 'podm') add(AD[s], null, 'air', 0);   // 运输机、直升机……没在型号表里的也列上
  for (const o of mdxVehList()) add(V3G_VEH[o.k] || (o.side === 'e' ? 'm1a1' : 'ztz96'), o.nm, 'veh', 0);
  for (const r of L) r.nm = (r.imp ? r.nms[0] : r.nms.slice(0, 2).join('、') + (r.nms.length > 2 ? ' 等' : '')) || r.id;
  return L;
}
// 选模型的下拉框：原来的 + 导入的 + 内置的（同类在前）
function mdxMdlSel(path, cur, defId, kind) {
  const L = mdxModels(), opt = r => `<option value="${mdxEsc(r.id)}"${r.id === cur ? ' selected' : ''}>${mdxEsc(r.nm)}${r.imp ? '（导入）' : ''}</option>`;
  const imp = L.filter(r => r.imp), bi = L.filter(r => !r.imp && r.id !== defId).sort((a, b) => (a.kind !== kind) - (b.kind !== kind));
  const dn = (L.find(r => r.id === defId) || { nm: defId }).nm;
  return `<div class="mdx-row${cur ? ' chg' : ''}"><label>3D 模型</label><select data-p="${path}" data-f="mdl"><option value="">原来的（${mdxEsc(dn)}）</option>${imp.length ? `<optgroup label="导入的">${imp.map(opt).join('')}</optgroup>` : ''}<optgroup label="游戏里的">${bi.map(opt).join('')}</optgroup></select><span class="def">「模型与挂点」页导入</span><button type="button" class="mdx-rst" data-rst="${path}|mdl" title="恢复默认" aria-label="3D 模型恢复默认">↺</button></div>`;
}
// 列表项：[{ id, nm, sub, mod（改过） }]
function mdxItems() {
  const W0 = MDX_W;
  if (MDX.tab === 'veh') return mdxVehList().map(o => ({ id: o.k, nm: o.nm, sub: (o.side === 'e' ? '守方 · ' : '攻方 · ') + (VEH_SPEC[o.type].name || o.type), mod: !!W0.veh[o.k] }));
  if (MDX.tab === 'air') return [...Object.keys(AIR_MDL).map(k => ({ id: k, nm: (MOD_DEF.air[k] || AIR_MDL[k]).name, sub: '攻方 · ' + k, mod: !!W0.air[k] })),
    ...(typeof EA_SPEC === 'object' ? Object.keys(EA_SPEC).map(t => ({ id: 'e:' + t, nm: (MOD_DEF.eair[t] || EA_SPEC[t]).name, sub: '守方 · ' + t, mod: !!W0.eair[t] })) : [])];
  if (MDX.tab === 'wpn') return Object.keys(FW_W).map(k => ({ id: k, nm: (MOD_DEF.wpn[k] || FW_W[k]).nm, sub: { aam: '空空导弹', agm: '空地导弹', arm: '反辐射导弹', gb: '制导炸弹' }[FW_W[k].k] || '', mod: !!W0.wpn[k] }));
  if (MDX.tab === 'msl') return Object.keys(MS_PGM).map(k => ({ id: k, nm: (MOD_DEF.msl[k] || MS_PGM[k]).nm, sub: k, mod: !!W0.msl[k] }));
  if (MDX.tab === 'mdl') return [{ id: '+imp', nm: '＋ 导入模型', sub: '.glb / .gltf / Sketchfab 压缩包', mod: false },
    ...mdxModels().map(r => ({ id: r.id, nm: r.nm, sub: (r.kind === 'air' ? '飞机' : '车辆') + (r.imp ? ' · 导入 · ' + (mdxLibOf(r.id) || {}).tri + ' 个三角形' : ' · ' + r.id), mod: !!W0.mdl[r.id] }))];
  if (MDX.tab === 'fx') return [{ id: '+imp', nm: '＋ 导入序列帧贴图', sub: 'PNG / WebP / JPEG 拼图', mod: false }, { id: 'slots', nm: '换掉游戏里的特效', sub: '爆炸、残骸火、炮口焰、烟团', mod: !!Object.keys(W0.fx).length },
    ...Object.keys(MOD.lib).filter(id => MOD.lib[id].k === 'fx').map(id => ({ id, nm: MOD.lib[id].nm, sub: `${MOD.lib[id].n} × ${MOD.lib[id].n} 格 · ${MOD.lib[id].f} 帧`, mod: false }))];
  return [];
}
function mdxRender(listOnly) {
  const el = MDX.el, body = el.querySelector('.mdx-body');
  el.querySelectorAll('.mdx-tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === MDX.tab));
  const items = mdxItems();
  if (items.length) {
    if (!items.some(i => i.id === MDX.sel)) MDX.sel = (items.find(i => i.id[0] !== '+') || items[0]).id;
    const q = MDX.q.toLowerCase(), shown = items.filter(i => !q || i.id[0] === '+' || i.nm.toLowerCase().includes(q) || i.id.includes(q));
    const list = `<input type="text" placeholder="搜索" value="${mdxEsc(MDX.q)}" aria-label="搜索">${shown.map(i => `<button type="button" class="mdx-it${i.id === MDX.sel ? ' on' : ''}${i.id[0] === '+' ? ' add' : ''}" data-it="${mdxEsc(i.id)}">${mdxEsc(i.nm)}${i.mod ? '<span class="md">已改</span>' : ''}<small>${mdxEsc(i.sub)}</small></button>`).join('')}`;
    if (listOnly) { const L = body.querySelector('.mdx-list'); if (L) { const inp = L.querySelector('input'), pos = inp && inp.selectionStart; L.innerHTML = list; const i2 = L.querySelector('input'); if (i2) { i2.focus(); i2.setSelectionRange(pos, pos); } return; } }
    body.className = 'mdx-body';
    const sc = body.querySelector('.mdx-form'), top = sc && MDX.keep ? sc.scrollTop : 0;
    body.innerHTML = `<div class="mdx-list">${list}</div><div class="mdx-form">${mdxForm()}</div>`;
    if (top) body.querySelector('.mdx-form').scrollTop = top;
  } else { body.className = 'mdx-body one'; body.innerHTML = `<div class="mdx-form">${mdxForm()}</div>`; }
  MDX.keep = false;
  // 模型预览：画布留着（不随表单重建），挂回占位处
  const vh = body.querySelector('.mdx-view');
  if (vh && typeof mivInit === 'function') {
    vh.appendChild(mivInit()); MIV.marks = mdxMarks(); MIV.pick = MDX.pk ? mdxOnPick : null;
    MIV.hz = MDX.tab === 'mdl' && MDX.sel && MDX.sel[0] !== '+' ? (MDX_W.mdl[MDX.sel] || {}).hz || null : null;
    mdxPtSync(); mdxPcBar();
    MIV.onLoad = k => { if (MDX.tab === 'mdl' && MDX.el && !MDX.el.hidden && MDX.sel && MDX.sel.replace(/~$/, '') === k) { MDX.keep = true; mdxRender(); } };
    mivShow(vh.dataset.k);
  }
  else { if (typeof MIV === 'object') MIV.hz = null; mdxPtSync(); }
  const fv = body.querySelector('.mdx-fxv');
  if (fv) mdxFxAnim(fv);
}
// 一行参数：值（改过的用改过的）、默认值、恢复默认
function mdxRow(path, f, nm, unit, def, cur, conv) {
  const chg = cur !== undefined && cur !== null && cur !== '', v = chg ? (conv ? conv[0](cur) : cur) : def;
  const inp = Array.isArray(unit) ? `<select data-p="${path}" data-f="${f}">${unit.map(([k, n]) => `<option value="${k}"${String(v) === k ? ' selected' : ''}>${n}</option>`).join('')}</select>`
    : `<input type="number" step="any" data-p="${path}" data-f="${f}" value="${v ?? ''}" placeholder="${def == null ? '（没有）' : ''}">`;
  const du = Array.isArray(unit) ? (unit.find(o => o[0] === String(def)) || [, def])[1] : (def ?? '—') + (unit ? ' ' + unit : '');
  return `<div class="mdx-row${chg ? ' chg' : ''}"><label>${nm}${!Array.isArray(unit) && unit ? `（${unit}）` : ''}</label>${inp}<span class="def">默认 ${mdxEsc(du)}</span><button type="button" class="mdx-rst" data-rst="${path}|${f}" title="恢复默认" aria-label="${nm}恢复默认">↺</button></div>`;
}
// 飞机的一组参数行（F 的格式见 MDX_AIR_F）
const mdxAirRows = (path, F, a, k, cur, hide) => F.filter(r => !hide || r[3](a, k) != null || cur[r[0]] != null).map(([f, nm, unit, d, back, show]) => mdxRow(path, f, nm, unit, d(a, k), cur[f], back ? [show, back] : null)).join('');
// 按现在的参数算一下真实性能（airperf.js apPerf）：巡航速度下的平飞加速度、持续 / 瞬时转弯
function mdxPerf(k, cur, spd) {
  const A0 = mdxAP0(k);
  if (!A0 || typeof apPerf !== 'function') return '';
  const A = { ...A0 };
  for (const f in MOD_APF) if (modNum(cur[f])) A[MOD_APF[f]] = cur[f];
  AP.__mdx = A;
  const out = [];
  for (const V of [spd, 250]) { const P = apPerf('__mdx', V); if (P) out.push(`${Math.round(V * 3.6)} 千米 / 时：平飞加速度 ${P.acc.toFixed(1)} 米 / 秒²，持续过载 ${P.ns.toFixed(1)} G（转弯 ${(P.ws * 57.3).toFixed(1)}° / 秒），瞬时 ${P.ni.toFixed(1)} G（${(P.wi * 57.3).toFixed(1)}° / 秒）`); }
  delete AP.__mdx;
  return `<p class="note">按现在的参数（真实值，推演里空战机动按它算，地图小所以再快 ${typeof AP_K === 'number' ? AP_K : 6} 倍）：<br>${out.join('<br>')}</p>`;
}
function mdxForm() {
  const W0 = MDX_W, k = MDX.sel;
  if (MDX.tab === 'veh') {
    const o = mdxVehList().find(x => x.k === k);
    if (!o) return '';
    o.sp = VEH_SPEC[o.type];
    const cur = W0.veh[k] || {}, hasEra = RLM[k] && RLM[k].era;
    return `<h3>${mdxEsc(o.nm)}</h3><p class="note">车种：${mdxEsc(o.sp.name)}${hasEra ? ' · 模型上挂着爆炸反应装甲块' : ''}。装甲、穿深按毫米均质钢写（推演里 ${MOD_MM} 毫米算一级：穿深够装甲才打得穿，差一级以内打掉一部分）。
      空着或恢复默认就用原来的数。保存后下一局生效，正在打的这一局里的这型车也马上更新。</p>` +
      mdxMdlSel('veh|' + k, cur.mdl, V3G_VEH[k] || (o.side === 'e' ? 'm1a1' : 'ztz96'), 'veh') +
      MDX_VEH_F.map(([f, nm, unit, d]) => mdxRow('veh|' + k, f, nm, unit, d(o), cur[f])).join('');
  }
  if (MDX.tab === 'air' && k.startsWith('e:')) {
    const t = k.slice(2), a = MOD_DEF.eair[t] || EA_SPEC[t], cur = W0.eair[t] || {};
    return `<h3>${mdxEsc(a.name)}</h3><p class="note">守方飞机。速度是真实的；作战重量、推力、阻力这几项是能量机动的物理量（转得多急、加速多快按它们算）。</p>` +
      mdxMdlSel('eair|' + t, cur.mdl, mdxAirDef()[modEairSil(t)], 'air') + mdxAirRows('eair|' + t, MDX_EAIR_F, a, t, cur) +
      (mdxAP0(t) ? `<h3 style="margin-top:14px">性能（加速度、转弯）</h3>${mdxPerf(t, cur, a.spd)}` + mdxAirRows('eair|' + t, MDX_PERF_F.filter(r => r[6] !== 'fl'), a, t, cur, 1) : '');
  }
  if (MDX.tab === 'air') {
    const a = MOD_DEF.air[k] || AIR_MDL[k], cur = W0.air[k] || {}, load = cur.load || (MOD_DEF.load[k] !== undefined ? MOD_DEF.load[k] : FW_LOAD[k]) || [];
    const rows = (cur.load || load.map(r => ({ w: r.w, bay: r.bay, n: mdxLoadN(k, r) }))).map((r, i) => `<div class="mdx-load"><select data-ld="${i}" data-lf="w">${Object.keys(FW_W).map(w => `<option value="${w}"${w === r.w ? ' selected' : ''}>${mdxEsc((MOD_DEF.wpn[w] || FW_W[w]).nm)}</option>`).join('')}</select>
      <select data-ld="${i}" data-lf="bay">${[['main', '主弹舱'], ['side', '侧弹舱'], ['ext', '外挂']].map(([b, n]) => `<option value="${b}"${b === r.bay ? ' selected' : ''}>${n}</option>`).join('')}</select>
      <input type="number" min="0" max="16" step="1" data-ld="${i}" data-lf="n" value="${r.n}" aria-label="枚数"><button type="button" class="mdx-rst" data-ldx="${i}" title="去掉这一项">✕</button></div>`).join('');
    return `<h3>${mdxEsc(a.name)}</h3><p class="note">推演里的距离是游戏尺度（地图比真实小），速度是真实的。挂载改的是驾驶时的武器表、3D 挂架上画的弹，以及 AI 出击时带几枚；挂点、尾喷口的位置在「模型与挂点」页。</p>` +
      mdxMdlSel('air|' + k, cur.mdl, mdxAirDef()[modAirSil(k)], 'air') + mdxAirRows('air|' + k, MDX_AIR_F, a, k, cur) +
      (mdxAP0(k) ? `<h3 style="margin-top:14px">性能（加速度、转弯、推力）</h3>${mdxPerf(k, cur, a.spd)}` + mdxAirRows('air|' + k, MDX_PERF_F, a, k, cur, 1) : '') +
      `<h3 style="margin-top:14px">航炮</h3><p class="note">亲自驾驶时空格开炮；炮口位置在「模型与挂点」页点。</p>` + mdxAirRows('air|' + k, MDX_GUN_F, a, k, cur) +
      `<h3 style="margin-top:14px">挂载</h3><p class="note">${cur.load ? '已改过（' : '原来的挂法（'}武器 · 位置 · 枚数）</p>${rows}<button type="button" class="mdx-btn" data-a="ldadd">加一项武器</button> <button type="button" class="mdx-btn" data-a="ldrst">恢复原来的挂载</button>`;
  }
  if (MDX.tab === 'wpn') {
    const w = MOD_DEF.wpn[k] || FW_W[k], cur = W0.wpn[k] || {};
    return `<h3>${mdxEsc(w.nm)}</h3><p class="note">亲自驾驶时用的机载武器（真实参数）：速度、射程、导引头视场、锁定时间、过载、助推加速度。</p>` + MDX_WPN_F.map(([f, nm, unit]) => mdxRow('wpn|' + k, f, nm, unit, w[f] ?? (f === 'acc' ? 20 : null), cur[f])).join('');
  }
  if (MDX.tab === 'msl') {
    const m = MOD_DEF.msl[k] || MS_PGM[k], cur = W0.msl[k] || {};
    return `<h3>${mdxEsc(m.nm)}</h3><p class="note">推演里飞的导弹、制导炸弹：速度、加速度、弹道（平飞、掠海、高抛、末段跃升俯冲）、毁伤。巡航高度 0 是贴地 / 贴海，1 是高空。</p>` +
      MDX_MSL_F.map(([f, nm, unit, d, back]) => mdxRow('msl|' + k, f, nm, unit, d(m), cur[f], back ? [v => mdxR(d({ ...m, [f]: v })), back] : null)).join('');
  }
  if (MDX.tab === 'mdl') return k === '+imp' ? mdxImpForm() : mdxMdlForm(k);
  if (MDX.tab === 'fx') return mdxFxForm(k);
  if (MDX.tab === 'map') {
    const w = W0.map.w ?? W0_DEF(), h = W0.map.h ?? H0_DEF();
    return `<h3>战场大小</h3><p class="note">程序生成的「海岸登陆」地图（沙盒、闯关里选它时）的宽（东西）和纵深（南北，海在南边），单位米；默认 8400 × 5600。宽 4000–30000、纵深 3000–20000；太大的地图按 20 米一格算，推演会慢一些。台湾东海岸是按真实地形做的，大小固定。</p>` +
      mdxRow('map', 'w', '宽', '米', 8400, W0.map.w) + mdxRow('map', 'h', '纵深', '米', 5600, W0.map.h) +
      `<p class="note">现在：${Math.round(w)} × ${Math.round(h)} 米（${(w * h / 1e6).toFixed(1)} 平方公里）。保存后新开的一局生效。</p>`;
  }
  if (MDX.tab === 'ren') {
    const s = SETTINGS, sl = (k, nm, mn, mx, stp, tip) => `<div class="mdx-row"><label>${nm}</label><input type="range" min="${mn}" max="${mx}" step="${stp}" data-set="${k}" value="${s[k]}"><span class="def">${tip(s[k])}</span><span></span></div>`;
    const sw = (k, nm) => `<div class="mdx-row"><label>${nm}</label><select data-set="${k}"><option value="true"${s[k] !== false ? ' selected' : ''}>开</option><option value="false"${s[k] === false ? ' selected' : ''}>关</option></select><span></span><span></span></div>`;
    return `<h3>画面</h3><p class="note">改了马上生效（不用点保存）。卡的话先关阴影、把渲染距离调近、云量调低。</p>` +
      sl('rdist', '3D 渲染距离', .5, 4, .25, v => (+v).toFixed(2) + ' 倍') +
      `<div class="mdx-row"><label>画质</label><select data-set="quality"><option value="high"${s.quality !== 'low' ? ' selected' : ''}>高</option><option value="low"${s.quality === 'low' ? ' selected' : ''}>低（不画阴影、贴图小一些）</option></select><span></span><span></span></div>` +
      sw('shadow', '实时阴影') + sl('cloud', '云量', 0, 1, .05, v => Math.round(v * 100) + '%') + sw('vfx', '序列帧爆炸特效') + sw('film', '电影后期（光束、胶片颗粒、景深）') + sl('bloom', '辉光强度', 0, 1.5, .05, v => Math.round(v * 100) + '%');
  }
  if (MDX.tab === 'pack') {
    return `<h3>模组包</h3><p class="note">把这里改的全部参数（坦克、飞机、挂载、武器、导弹、模型上的点、特效、战场大小、画面）存成一个 JSON 文件，换台设备或分享给别人；
      「连同导入的模型和贴图」会把导入的文件也打进去（文件会大）。也可以直接在下面的文本框里改参数再点「应用文本」。</p>
      <p><button type="button" class="mdx-btn pri" data-a="export">导出模组包</button> <button type="button" class="mdx-btn" data-a="exportf">导出（连同导入的模型和贴图）</button> <label class="mdx-btn">导入模组包<input type="file" accept=".json,application/json" data-a="import" hidden></label> <button type="button" class="mdx-btn" data-a="wipe">全部恢复默认</button></p>
      <textarea spellcheck="false" aria-label="模组包内容">${mdxEsc(JSON.stringify(Object.fromEntries([['v', 1], ...MOD_SEC.filter(s => s !== 'lib').map(s => [s, W0[s]])]), null, 1))}</textarea><p><button type="button" class="mdx-btn" data-a="applytxt">应用文本</button></p>`;
  }
  return '';
}
// —— 模型与挂点 ——
const MDX_AXO = [['+z', '+Z（glTF 常见）'], ['-z', '−Z'], ['+x', '+X'], ['-x', '−X'], ['+y', '+Y'], ['-y', '−Y']];
function mdxImpForm() {
  const I = MDX.imp, sel = (k, L) => `<select data-imp="${k}">${L.map(([v, n]) => `<option value="${v}"${String(I[k]) === v ? ' selected' : ''}>${n}</option>`).join('')}</select>`;
  const row = (nm, inp, tip = '') => `<div class="mdx-row"><label>${nm}</label>${inp}<span class="def">${tip}</span><span></span></div>`;
  return `<h3>导入模型</h3><p class="note">支持 .glb、.gltf（连同 .bin 和贴图一起选）、Sketchfab 下载的 glTF 压缩包（.zip）。导入后存在这台设备的浏览器里，在左边列表里选它：预览里点炮口、挂点、尾喷口，
    再到「坦克装甲车」/「飞机」页把它换到型号上（或者在它的页面里直接勾）。模型的前方、上方不对就在预览下面转一下。网格压缩（Draco / meshopt）的模型解不开，导出时选不压缩。
    署名：Sketchfab 导出的文件里带着作者和授权，会列进「设置 → 素材致谢」；自己做的或别处下载的注意授权。</p>
    ${row('文件', '<input type="file" multiple accept=".glb,.gltf,.zip,.bin,.png,.jpg,.jpeg,.webp" data-imp="files">', MDX.impF ? MDX.impF.length + ' 个文件' : '')}
    ${row('名称', `<input type="text" data-imp="name" value="${mdxEsc(I.name || '')}">`)}
    ${row('类型', sel('kind', [['veh', '坦克装甲车'], ['air', '飞机']]))}
    ${row('实际全长（米）', `<input type="number" step="any" data-imp="len" value="${I.len ?? ''}" placeholder="空着 = 文件里的单位就是米">`, '机头到机尾 / 车头到车尾（含炮管）')}
    ${I.kind === 'veh' ? row('车体长（米）', `<input type="number" step="any" data-imp="hl" value="${I.hl ?? ''}" placeholder="空着 = 全长">`, '游戏按车体长（不含炮管）摆') : ''}
    ${row('模型的前方', sel('fwd', MDX_AXO), '文件里哪根轴朝前')}
    ${row('模型的上方', sel('up', [['+y', '+Y（glTF 标准）'], ['+z', '+Z'], ['-y', '−Y'], ['-z', '−Z']]))}
    ${row('贴图最大边', sel('tex', [['1024', '1024'], ['2048', '2048（推荐）'], ['4096', '4096']]), '太大的缩小，省显存')}
    <p><button type="button" class="mdx-btn pri" data-a="doimp"${MDX.impF ? '' : ' disabled'}>导入</button></p>`;
}
// 模型上现有的点（编辑器改过的用改过的，没改的用游戏原来的）
function mdxMdlCur(mk) {
  const A = MDX_W.mdl[mk] || {}, M = typeof MIV === 'object' && MIV.key === mk.replace(/~$/, '') && MIV.M ? MIV.M.m : null, M3 = typeof V3G === 'object' && V3G.M[mk.replace(/~$/, '')];
  const st0 = (mk in MOD_DEF.st ? MOD_DEF.st[mk] : FW_ST[mk]) || {}, noz0 = (M && M.noz) || (M3 && M3.meta && M3.meta.noz) || [];
  const gk = Object.keys(MOD_DEF.gun).length ? MOD_DEF.gun : FW_GUN, gun0 = (Object.keys(gk).map(k => gk[k] && mdxAirDef()[modAirSil(k)] === mk ? gk[k].at : null).find(x => x)) || null;
  return { A, st: A.st || st0, stD: !A.st, noz: A.noz || noz0, nozD: !A.noz, gun: A.gun || gun0, gunD: !A.gun, muz: A.muz || null, mg: A.mg || null, mgOn: A.mgOn || '', fx: A.fx || {} };
}
// 预览上的标记
function mdxMarks() {
  const mk = MDX.sel;
  if (MDX.tab !== 'mdl' || !mk || mk[0] === '+') return [];
  const C = mdxMdlCur(mk), out = [];
  const pv = (p, rr) => typeof mivXf === 'function' && MIV.pt ? mivXf(p.slice(), rr, 0) : p;   // 装在试转着的部件上的点：画在转过的位置
  if (C.muz) out.push({ p: pv(C.muz, 2), c: '#ff8a3d', t: '炮口', r: 6 });
  if (C.mg) { const G = modMgOf(mk) || { on: 'hull' }, on = C.mgOn || (MDX_W.mdl[mk] && MDX_W.mdl[mk].pt && (MDX_W.mdl[mk].pt.mg || MDX_W.mdl[mk].pt.mt) ? 'mg' : G.on); out.push({ p: pv(C.mg, { hull: 0, t: 1, g: 2, mg: 8 }[on] || 0), c: '#ff6bb8', t: '机枪口', r: 5.5 }); }
  if (C.gun) out.push({ p: C.gun, c: '#ff4d4d', t: '航炮', r: 5, dim: C.gunD });
  for (const g in C.st) (C.st[g] || []).forEach((p, i) => out.push({ p, c: g === MDX.hg ? '#3de0ff' : '#7fa8b8', t: g === MDX.hg ? g + ' ' + (i + 1) : '', r: g === MDX.hg ? 5 : 3.5, dim: C.stD }));
  for (const n of C.noz) for (const sg of n[1] ? [1, -1] : [1]) out.push({ p: [n[0], n[1] * sg, n[2]], c: '#ff5cf0', t: sg > 0 ? '喷口' : '', r: Math.max(4, 6), dim: C.nozD });
  return out;
}
function mdxOnPick(h, e) {
  if (mdxPtPick(h, e)) return;
  const mk = MDX.sel, A = MDX_W.mdl[mk] = MDX_W.mdl[mk] || {}, C = mdxMdlCur(mk), p = typeof mivXf === 'function' && MIV.pt ? mivXf(h.p.slice(), h.rr || 0, 1).map(v => Math.round(v * 1000) / 1000) : h.p;   // 点在试转着的部件上：记没转时的位置
  if (MDX.pk === 'muz') A.muz = p;
  else if (MDX.pk === 'gun') A.gun = p;
  else if (MDX.pk === 'hp') {
    if (!A.st) A.st = modClone(C.st) || {};
    const g = MDX.hg || 'ext', L = A.st[g] = A.st[g] || [];
    L.push(p);
    if (MDX.mir && Math.abs(p[1]) > .05) L.push([p[0], -p[1], p[2]]);   // 左右对称：另一边也挂一个
  } else if (MDX.pk === 'mgm') A.mg = p;
  else if (MDX.pk.startsWith('hz:')) { const m = mdxHzPick(p); MDX.keep = true; mdxRender(); mdxMsg(m); return; }
  else if (MDX.pk === 'noz') {
    if (!A.noz) A.noz = modClone(C.noz) || [];
    A.noz.push([p[0], Math.abs(p[1]) < .05 ? 0 : Math.abs(p[1]), p[2], MDX.nzR || .45, .6]);
  } else return;
  MDX.dirty = true; MDX.keep = true; mdxRender(); mdxMsg('点上了（' + p.join(', ') + '），点「保存」生效');
}
function mdxMdlForm(mk) {
  const md = mdxModels().find(r => r.id === mk);
  if (!md) return '';
  const C = mdxMdlCur(mk), air = md.kind === 'air', L = md.imp ? mdxLibOf(mk) : null, num = (path, v) => `<input type="number" step="any" data-mf="${path}" value="${v ?? ''}">`;
  const xyz = (path, P) => `<span class="mdx-xyz">${[0, 1, 2].map(i => num(path + '.' + i, P ? P[i] : '')).join('')}</span>`;
  const pk = (k, n) => `<button type="button" class="mdx-btn${MDX.pk === k ? ' pri' : ''}" data-pk="${k}">${n}</button>`;
  let h = `<h3>${mdxEsc(md.nm)}</h3><p class="note">${md.imp ? `导入的模型 · ${L.tri} 个三角形 · 全长 ${L.len} 米 · ${Math.round(L.kb / 1024 * 10) / 10} MB` : '游戏里的模型 · ' + mdxEsc(mk)}。坐标是模型坐标（米）：x 朝前、y 朝左、z 朝上，原点在底面中间。
    拖动转、滚轮缩放、右键拖动平移（手机上两个手指捏合缩放、一起挪平移）。先选下面要点的东西，再在模型上点一下。</p>
    <div class="mdx-stk"><div class="mdx-view" data-k="${mdxEsc(mk.replace(/~$/, ''))}"></div>
    <div class="mdx-pick">点选：${pk('', '不点')}${md.imp ? pk('pc', '选部件') : ''}${air ? pk('hp', '挂点') + pk('noz', '尾喷口') + pk('gun', '航炮口') : pk('muz', '主炮炮口') + pk('mgm', '机枪口')}
      ${MDX.pk === 'hp' ? `<label><input type="checkbox" data-mir="1"${MDX.mir ? ' checked' : ''}> 左右对称</label>` : ''}${MDX.pk === 'noz' ? `<label>喷口内半径 <input type="number" step="any" data-nzr="1" value="${MDX.nzR}" style="width:70px"> 米</label>` : ''}${md.imp ? '<span class="mdx-pcsel"></span>' : ''}</div></div>`;
  if (md.imp) {
    h += mdxPtForm(mk, air);
    h += `<h3 style="margin-top:12px">模型</h3><div class="mdx-row"><label>名称</label><input type="text" data-lib="nm" value="${mdxEsc(L.nm)}"><span></span><span></span></div>
      <div class="mdx-row"><label>类型</label><select data-lib="kind"><option value="veh"${L.kind !== 'air' ? ' selected' : ''}>坦克装甲车</option><option value="air"${L.kind === 'air' ? ' selected' : ''}>飞机</option></select><span></span><span></span></div>
      <p>朝向不对：<button type="button" class="mdx-btn" data-a="turn" data-ax="z">绕竖轴转 90°</button> <button type="button" class="mdx-btn" data-a="turn" data-ax="fz">前后掉头</button> <button type="button" class="mdx-btn" data-a="turn" data-ax="y">抬头 90°</button> <button type="button" class="mdx-btn" data-a="turn" data-ax="x">侧滚 90°</button>
      <button type="button" class="mdx-btn" data-a="mdel">删除这个模型</button></p>`;
    // 装到哪些型号上
    const ts = air ? [...Object.keys(AIR_MDL).map(k => ['air', k, (MOD_DEF.air[k] || AIR_MDL[k]).name]), ...(typeof EA_SPEC === 'object' ? Object.keys(EA_SPEC).map(t => ['eair', t, (MOD_DEF.eair[t] || EA_SPEC[t]).name]) : [])]
      : mdxVehList().map(o => ['veh', o.k, o.nm]);
    h += `<h3 style="margin-top:12px">用在这些型号上</h3><div class="mdx-bind">${ts.map(([s, k, n]) => `<label><input type="checkbox" data-bind="${s}|${k}"${(MDX_W[s][k] || {}).mdl === mk ? ' checked' : ''}> ${mdxEsc(n)}</label>`).join('')}</div>`;
  }
  const rst = (s, d) => d ? '<span class="def">（游戏原来的）</span>' : `<button type="button" class="mdx-btn" data-mrst="${s}">恢复原来的</button>`;
  if (!air) {
    h += `<h3 style="margin-top:12px">主炮炮口 ${rst('muz', !C.A.muz)}</h3><p class="note">坦克炮的曳光弹、炮口焰从这里出（跟着炮塔转、炮管俯仰）；没设的从车顶出。</p><div class="mdx-row"><label>炮口 x / y / z</label>${xyz('muz', C.muz)}<span></span><span></span></div>`;
    h += `<h3 style="margin-top:12px">机枪口 ${rst('mg', !C.A.mg)}</h3><p class="note">车载机枪打步兵时曳光弹、枪口焰从这里出；装在哪就跟着哪动（机枪塔：转向机枪的目标）。没设的从车中间出。</p>
      <div class="mdx-row"><label>机枪口 x / y / z</label>${xyz('mg', C.mg)}<span></span><span></span></div>
      <div class="mdx-row"><label>机枪装在</label><select data-mf="mgOn"><option value=""${!C.mgOn ? ' selected' : ''}>自动（有机枪塔就在机枪塔上，否则在炮塔上）</option>${[['mg', '机枪塔（遥控武器站）'], ['g', '炮管（并列机枪）'], ['t', '炮塔'], ['hull', '车体']].map(([v, n]) => `<option value="${v}"${C.mgOn === v ? ' selected' : ''}>${n}</option>`).join('')}</select><span></span><span></span></div>`;
    h += mdxHzForm(mk, false);
    return h;
  }
  // 挂点
  const groups = [...new Set(['main', 'side', 'ext', ...Object.keys(C.st), ...(FW_W[MDX.hg] ? [MDX.hg] : [])])];   // 刚选的「新建：专挂 某型弹」还没有点，也要留着
  if (!groups.includes(MDX.hg)) MDX.hg = 'ext';
  const gname = g => ({ main: '主弹舱', mainS: '主弹舱（短弹两排）', side: '侧弹舱', sideX: '侧弹舱（推出舱外）', ext: '外挂', tip: '翼尖', jpod: '干扰吊舱' })[g] || ((MOD_DEF.wpn[g] || FW_W[g] || {}).nm ? '专挂 ' + (MOD_DEF.wpn[g] || FW_W[g]).nm : g);
  const P = C.st[MDX.hg] || [];
  h += `<h3 style="margin-top:12px">挂点 ${rst('st', C.stD)}</h3><p class="note">按挂载里的「位置」挂：主弹舱、侧弹舱、外挂；某型武器有专门的一组（「专挂 霹雳-15」）就挂在那组。先打的排在前面。</p>
    <div class="mdx-row"><label>挂点组</label><select data-hg="1">${groups.map(g => `<option value="${g}"${g === MDX.hg ? ' selected' : ''}>${mdxEsc(gname(g))}（${(C.st[g] || []).length}）</option>`).join('')}${Object.keys(FW_W).filter(w => !groups.includes(w)).map(w => `<option value="${w}">新建：专挂 ${mdxEsc((MOD_DEF.wpn[w] || FW_W[w]).nm)}</option>`).join('')}</select><span></span><span></span></div>
    ${P.map((p, i) => `<div class="mdx-row"><label>${i + 1}</label>${xyz(`st.${MDX.hg}.${i}`, p)}<span></span><button type="button" class="mdx-rst" data-mdel="st.${MDX.hg}.${i}" title="去掉">✕</button></div>`).join('') || '<p class="note">这一组还没有挂点：选「挂点」后在模型上点。</p>'}`;
  // 尾喷口
  h += `<h3 style="margin-top:12px">尾喷口 ${rst('noz', C.nozD)}</h3><p class="note">喷口出口截面的中心、内半径、出口到喉道的深（米）；y 不为 0 的左右各一个。尾焰、热浪、喷口里的发光都按它画。</p>
    ${C.noz.map((n, i) => `<div class="mdx-row"><label>${i + 1}（x y z · 半径 · 深）</label><span class="mdx-xyz">${[0, 1, 2, 3, 4].map(j => num(`noz.${i}.${j}`, n[j])).join('')}</span><span></span><button type="button" class="mdx-rst" data-mdel="noz.${i}" title="去掉">✕</button></div>`).join('') || '<p class="note">没有喷口（螺旋桨飞机、直升机不用）。</p>'}`;
  // 尾焰
  const fx = C.fx, fsel = (f, L) => `<select data-mf="fx.${f}">${L.map(([v, n]) => `<option value="${v}"${String(fx[f] ?? L[0][0]) === v ? ' selected' : ''}>${n}</option>`).join('')}</select>`;
  const frow = (f, nm, d, unit = '倍') => `<div class="mdx-row${fx[f] != null ? ' chg' : ''}"><label>${nm}（${unit}）</label>${num('fx.' + f, fx[f] ?? d)}<span class="def">默认 ${d}</span><button type="button" class="mdx-rst" data-mdel="fx.${f}" title="恢复默认">↺</button></div>`;
  const fxs = Object.keys(MOD.lib).filter(id => MOD.lib[id].k === 'fx');
  h += `<h3 style="margin-top:12px">尾焰（开加力时）</h3>` + frow('len', '长度', 1) + frow('wid', '粗细', 1) + frow('bri', '亮度', 1) + frow('dia', '马赫环个数', 5, '个') + frow('haze', '热浪', 1) +
    `<div class="mdx-row"><label>体渲染尾焰</label>${fsel('vol', [['true', '画'], ['false', '不画（只用序列帧）']])}<span></span><span></span></div>
    <div class="mdx-row"><label>序列帧尾焰</label><select data-mf="fx.spr"><option value="">不用</option>${fxs.map(id => `<option value="${id}"${fx.spr === id ? ' selected' : ''}>${mdxEsc(MOD.lib[id].nm)}</option>`).join('')}</select><span class="def">「特效贴图」页导入</span><span></span></div>` +
    (fx.spr ? frow('sprS', '序列帧大小', 1) : '');
  // 航炮口
  h += `<h3 style="margin-top:12px">航炮炮口 ${rst('gun', C.gunD)}</h3><p class="note">亲自驾驶时航炮的炮弹从这里出（有没有航炮、备弹在「飞机」页）。</p><div class="mdx-row"><label>炮口 x / y / z</label>${xyz('gun', C.gun)}<span></span><span></span></div>`;
  h += mdxHzForm(mk, true);
  return h;
}
// 改模型上的一个值：path 「muz.0」「st.ext.3.1」「noz.0.3」「fx.len」
function mdxMdlSet(path, v) {
  const mk = MDX.sel, A = MDX_W.mdl[mk] = MDX_W.mdl[mk] || {}, C = mdxMdlCur(mk), ks = path.split('.');
  if (ks[0] === 'st' && !A.st) A.st = modClone(C.st) || {};
  if (ks[0] === 'noz' && !A.noz) A.noz = modClone(C.noz) || [];
  if (ks[0] === 'gun' && !A.gun) A.gun = C.gun ? C.gun.slice() : [0, 0, 0];
  if (ks[0] === 'muz' && !A.muz) A.muz = [0, 0, 0];
  if (ks[0] === 'mg' && !A.mg) A.mg = [0, 0, 0];
  let o = A;
  for (let i = 0; i < ks.length - 1; i++) { const kk = ks[i]; if (o[kk] == null) o[kk] = /^\d+$/.test(ks[i + 1]) ? [] : {}; o = o[kk]; }
  const last = ks[ks.length - 1];
  if (v === '' || v == null) { if (Array.isArray(o)) o[+last] = 0; else delete o[last]; } else o[last] = v;
  if (A.fx && !Object.keys(A.fx).length) delete A.fx;
  if (!Object.keys(A).length) delete MDX_W.mdl[mk];
  MDX.dirty = true;
}
function mdxMdlDel(path) {
  const mk = MDX.sel, A = MDX_W.mdl[mk] = MDX_W.mdl[mk] || {}, C = mdxMdlCur(mk), ks = path.split('.');
  if (ks[0] === 'st' && !A.st) A.st = modClone(C.st) || {};
  if (ks[0] === 'noz' && !A.noz) A.noz = modClone(C.noz) || [];
  let o = A;
  for (let i = 0; i < ks.length - 1; i++) { o = o[ks[i]]; if (o == null) return; }
  const last = ks[ks.length - 1];
  if (Array.isArray(o)) o.splice(+last, 1); else delete o[last];
  if (A.fx && !Object.keys(A.fx).length) delete A.fx;
  if (!Object.keys(A).length) delete MDX_W.mdl[mk];
  MDX.dirty = true;
}
// —— 部件（导入的模型：切开、选块、手动定转轴；数据在 MDX_W.mdl[模型键].pt，格式见 mod.js MOD_PTR）——
//   pc：选中的块（sel）、按一块 / 整个物体选（g）、框选（box）、显示删掉的（gh）、试转角度（ta 炮塔、el 炮管、rs 旋翼，度）、
//   切割薄片（cut：on 打开、c 中心（删过以后的坐标）、az 法线方位角、el 法线仰角（90 = 水平薄片）、sp 绕法线转、w / h 宽高，米）、
//   圆心定位器（cc：tgt 定哪根轴、pts 点了的点、res 算出的圆）、snap 点模型时吸附到最近的顶点、ud 撤销（改之前的整条记录）、cutUd 撤销切割
MDX.pc = { k: null, sel: new Set(), g: 'pc', box: false, gh: false, ta: 0, el: 0, my: 0, me: 0, rs: 0, cut: { on: false, c: [0, 0, 1], az: 0, el: 90, sp: 0, w: 4, h: 4 }, cc: { tgt: '', pts: [], res: null }, snap: true, ud: [], cutUd: [] };
const MDX_AXN = { ta: '炮塔转轴', ga: '炮管俯仰轴（炮耳）', ma: '机枪塔转轴', mb: '机枪俯仰轴', ra: '主旋翼轴', qa: '尾桨轴' }, MDX_AXD = { ta: [0, 0, 1], ga: [0, 1, 0], ma: [0, 0, 1], mb: [0, 1, 0], ra: [0, 0, 1], qa: [0, 1, 0] };
const MDX_ROLE = { veh: [[1, '炮塔'], [2, '炮管'], [7, '机枪塔'], [8, '机枪'], [0, '车体（不动）'], [6, '删除']], air: [[3, '起落架'], [4, '主旋翼'], [5, '尾桨'], [0, '机身（不动）'], [6, '删除']] };
const MDX_ROLE_N = ['车体 / 机身', '炮塔', '炮管', '起落架', '主旋翼', '尾桨', '删掉', '机枪塔', '机枪'];
// 预览里读出来的就是这个导入模型（有分块）
const mdxPcM = mk => typeof MIV === 'object' && MIV.M && MIV.key === mk && MIV.M.pv ? MIV.M : null;
// 换了模型：选择、圆心定位器清掉，切割薄片放到模型中间
function mdxPcReset(mk) {
  const P = MDX.pc;
  if (P.k === mk) return;
  P.k = mk; P.sel.clear(); P.cc = { tgt: '', pts: [], res: null }; P.ta = P.el = P.my = P.me = P.rs = 0; P.ud = [];
  const M = mdxPcM(mk);
  if (M) { const b = M.m.bb; P.cut.c = [0, 0, +((b[5] - b[2]) * .55).toFixed(3)]; P.cut.w = +((b[3] - b[0]) * .7).toFixed(2); P.cut.h = +((b[4] - b[1]) * .9).toFixed(2); }
}
// 这个模型现在各块的用途、删过以后的原点（按 pt 缓存）
function mdxPtState(mk, A = MDX_W.mdl[mk]) {
  const M = mdxPcM(mk);
  if (!M) return null;
  const pt = A && A.pt, sig = JSON.stringify(pt ? MOD_PTR.map(k => pt[k] || '') : null);
  if (M.ptC && M.ptC.sig === sig) return M.ptC;
  const R = modPtRoles(pt, M.pn), off = modPtOff(M.VB, M.st, M.nv, M.pv, R);
  return (M.ptC = { sig, R, off });
}
// 每一块的包围盒（原始坐标；框选、物体列表用）
function mdxPcBB(M) {
  if (M.pbb) return M.pbb;
  const n = M.pn, B = new Float32Array(n * 6), T = new Uint32Array(n);
  for (let i = 0; i < n; i++) { B[i * 6] = B[i * 6 + 1] = B[i * 6 + 2] = 1e30; B[i * 6 + 3] = B[i * 6 + 4] = B[i * 6 + 5] = -1e30; }
  for (let v = 0; v < M.nv; v++) { const i = M.pv[v] * 6, o = v * M.st; for (let k = 0; k < 3; k++) { const x = M.VB[o + k]; if (x < B[i + k]) B[i + k] = x; if (x > B[i + k + 3]) B[i + k + 3] = x; } }
  for (const [, , i0, cnt] of M.m.lod[0]) for (let t = i0; t < i0 + cnt; t += 3) T[M.pv[M.IB[t]]]++;
  M.ptri = T;
  return (M.pbb = B);
}
// 切割薄片（删过以后的坐标）：法线按方位角、仰角；两条边先取和法线垂直的「水平」方向，再绕法线转
function mdxCutPlane() {
  const K = MDX.pc.cut, D = Math.PI / 180, az = K.az * D, el = K.el * D, n = [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)];
  let u = Math.abs(n[2]) > .999 ? [Math.cos(az), Math.sin(az), 0] : mimCross([0, 0, 1], n);
  const ul = Math.hypot(...u); u = u.map(x => x / ul);
  let v = mimCross(n, u);
  const c = Math.cos(K.sp * D), s = Math.sin(K.sp * D), u2 = u.map((x, k) => x * c + v[k] * s), v2 = v.map((x, k) => -u[k] * s + x * c);
  return { c: K.c.slice(), n, u: u2, v: v2, hu: Math.max(.01, K.w / 2), hv: Math.max(.01, K.h / 2) };
}
// 转轴（删过以后的坐标；没定的 null）：炮塔、炮管按游戏里的正方向摆（mod.js modAxUp / modAxEl），试转的方向和游戏一致
function mdxAxes(pt) {
  return { T: modAxUp(modAx(pt && pt.ta)), G: modAxEl(modAx(pt && pt.ga)), Ma: modAxUp(modAx(pt && pt.ma)), Mb: modAxEl(modAx(pt && pt.mb)), Rt: modAx(pt && pt.ra), Qt: modAx(pt && pt.qa) };
}
// 把部件的显示同步给预览：每个顶点的用途代码（选中的 + 10）、原点、转轴、试转角度、切割薄片、转轴线和圆心定位器
function mdxPtSync() {
  const mk = MDX.sel, M = mk && mdxPcM(mk);
  if (!M || MDX.tab !== 'mdl') { if (typeof MIV === 'object') { MIV.gz = null; MIV.deco = []; MIV.box = null; if (MIV.pt) mivSetPt(null); } return; }
  const P = MDX.pc, S = mdxPtState(mk), A = MDX_W.mdl[mk] || {}, X = mdxAxes(A.pt), D = Math.PI / 180;
  const ck = S.sig + '|' + [...P.sel].join(',');
  if (!M.codes || M.codesK !== ck) {
    const C = M.codes && M.codes.length === M.nv && M.codesK == null ? M.codes : new Float32Array(M.nv), R = S.R, sel = P.sel;
    for (let v = 0; v < M.nv; v++) { const i = M.pv[v]; C[v] = R[i] + (sel.has(i) ? 10 : 0); }
    M.codes = C; M.codesK = ck;
  }
  const b = M.m.bb, L = Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]) * .35, deco = [];
  const axLine = (X1, col, t) => { if (X1) deco.push({ k: 'line', a: X1.p.map((x, k) => x - X1.a[k] * L), b: X1.p.map((x, k) => x + X1.a[k] * L), col, w: 2, dash: 1 }, { k: 'pt', p: X1.p, col, t, r: 4.5 }); };
  axLine(X.T, MIV_ROLE_C[1], '炮塔转轴'); axLine(X.G, MIV_ROLE_C[2], '炮耳'); axLine(X.Ma, MIV_ROLE_C[7], '机枪塔转轴'); axLine(X.Mb, MIV_ROLE_C[8], '机枪俯仰轴'); axLine(X.Rt, MIV_ROLE_C[4], '旋翼轴'); axLine(X.Qt, MIV_ROLE_C[5], '尾桨轴');
  P.cc.pts.forEach((p, i) => deco.push({ k: 'pt', p, col: '#ffd84a', t: '圆边 ' + (i + 1), r: 4 }));
  if (P.cc.res) { const r = P.cc.res; deco.push({ k: 'ring', c: r.c, n: r.n, r: r.r, col: '#ffd84a', w: 2 }, { k: 'pt', p: r.c, col: '#ffd84a', t: '圆心', r: 4 }); }
  MIV.deco = deco;
  MIV.gz = P.cut.on ? mdxCutPlane() : null;
  MIV.box = MDX.pk === 'pc' && P.box ? mdxPcBox : null;
  mivSetPt({ codes: M.codes, off: S.off, ...X, ta: P.ta * D, el: P.el * D, my: P.my * D, me: P.me * D, rs: P.rs * D, gh: P.gh, tint: true });
  MIV.marks = mdxMarks(); mivDraw();   // 炮口、机枪口跟着试转的部件走
}
// 点选一块（或它所在的整个物体）：选上 / 取消
function mdxPcPick(h, e) {
  const M = mdxPcM(MDX.sel), P = MDX.pc;
  if (!M || h.pc < 0) return;
  const ids = P.g === 'nd' && M.pnd ? mdxNodePieces(M, M.pnd[h.pc], false) : [h.pc], on = !P.sel.has(h.pc);
  for (const i of ids) if (on) P.sel.add(i); else P.sel.delete(i);
  mdxPtSync(); mdxPcBar();
  mdxMsg((on ? '选上了' : '取消了') + ' ' + ids.length + ' 块（块号 ' + h.pc + (M.pnd && M.nodes && M.nodes[M.pnd[h.pc]] ? '，物体「' + M.nodes[M.pnd[h.pc]].n + '」' : '') + '）');
}
// 一个物体（及它下面所有物体，sub）的块
function mdxNodePieces(M, nd, sub) {
  const out = [], N = M.nodes || [], under = q => { for (let d = 0; q >= 0 && d < 80; d++, q = N[q] ? N[q].p : -1) if (q === nd) return true; return false; };
  for (let i = 0; i < M.pn; i++) if (sub ? under(M.pnd[i]) : M.pnd[i] === nd) out.push(i);
  return out;
}
// 框选：整块都在方框里的块选上（试转着的部件按转过的样子算）
function mdxPcBox(B) {
  const M = mdxPcM(MDX.sel), P = MDX.pc, S = mdxPtState(MDX.sel);
  if (!M || !S) return;
  const bb = mdxPcBB(M), C = mivCam(), off = S.off;
  let k = 0;
  for (let i = 0; i < M.pn; i++) {
    if (S.R[i] === MOD_PT_DEL && !P.gh) continue;
    if (bb[i * 6] > bb[i * 6 + 3]) continue;
    let all = true;
    for (let c = 0; c < 8 && all; c++) {
      const q = mivXf([bb[i * 6 + (c & 1 ? 3 : 0)] - off[0], bb[i * 6 + 1 + (c & 2 ? 3 : 0)] - off[1], bb[i * 6 + 2 + (c & 4 ? 3 : 0)] - off[2]], S.R[i], 0), s = mivProj(q, C);
      if (!s || s[0] < B[0] || s[0] > B[2] || s[1] < B[1] || s[1] > B[3]) all = false;
    }
    if (all && !P.sel.has(i)) { P.sel.add(i); k++; }
  }
  mdxPtSync(); mdxPcBar(); mdxMsg(k ? '框选：多选上 ' + k + ' 块' : '框里没有整块落在里面的块（框大一点，或者转个角度）');
}
// 撤销记录：改之前这个模型的整条（部件、点、转轴）
function mdxPtPush(mk) { const P = MDX.pc; P.ud.push({ mk, A: JSON.stringify(MDX_W.mdl[mk] || null) }); if (P.ud.length > 60) P.ud.shift(); }
// 模型上记着的点、转轴一起变（fp：点怎么变，fd：方向怎么变）——删东西挪了原点、转了模型方向都用它
function mdxXfPts(A, fp, fd) {
  if (!A) return;
  const R = v => Math.round(v * 1e4) / 1e4, P3 = p => Array.isArray(p) && p.length >= 3 ? [...fp(p.slice(0, 3)).map(R), ...p.slice(3)] : p;
  if (A.muz) A.muz = P3(A.muz);
  if (A.mg) A.mg = P3(A.mg);
  if (A.gun) A.gun = P3(A.gun);
  if (A.st) for (const g in A.st) A.st[g] = (A.st[g] || []).map(P3);
  if (A.noz) A.noz = A.noz.map(P3);
  if (Array.isArray(A.hz)) for (const e of A.hz) { if (Array.isArray(e.p)) e.p = fp(e.p).map(R); if (fd && Array.isArray(e.d)) e.d = fd(e.d).map(v => Math.round(v * 1e6) / 1e6); }
  if (A.pt) for (const k in MDX_AXN) { const X = A.pt[k]; if (X && Array.isArray(X.p)) { X.p = fp(X.p).map(R); if (fd && Array.isArray(X.a)) X.a = fd(X.a).map(v => Math.round(v * 1e6) / 1e6); } }
}
// 把选中的块设成某种用途（0 车体 / 机身、6 删除……）；删的东西变了，原点跟着变，已经点好的位置一起挪
function mdxPcSet(code) {
  const mk = MDX.sel, M = mdxPcM(mk), P = MDX.pc;
  if (!M || !P.sel.size) { mdxMsg('先选中块：点「选部件」，再在预览里点要设的那几块'); return; }
  mdxPtPush(mk);
  const A = MDX_W.mdl[mk] = MDX_W.mdl[mk] || {}, pt = A.pt = A.pt || {}, S0 = mdxPtState(mk), R = S0.R.slice(), off0 = S0.off;
  for (const i of P.sel) R[i] = code;
  for (let c = 1; c < MOD_PTR.length; c++) { const ids = []; for (let i = 0; i < M.pn; i++) if (R[i] === c) ids.push(i); if (ids.length) pt[MOD_PTR[c]] = modIdsEnc(ids); else delete pt[MOD_PTR[c]]; }
  const off1 = mdxPtState(mk).off, d = [0, 1, 2].map(k => off0[k] - off1[k]);
  if (d.some(x => Math.abs(x) > 1e-7)) { mdxXfPts(A, p => p.map((x, k) => x + d[k])); P.cut.c = P.cut.c.map((x, k) => x + d[k]); P.cc.pts = P.cc.pts.map(p => p.map((x, k) => x + d[k])); if (P.cc.res) P.cc.res.c = P.cc.res.c.map((x, k) => x + d[k]); }
  if (!Object.keys(pt).length) delete A.pt;
  if (!Object.keys(A).length) delete MDX_W.mdl[mk];
  const n = P.sel.size; P.sel.clear();
  MDX.dirty = true; MDX.keep = true; mdxRender();
  mdxMsg(n + ' 块设成了「' + MDX_ROLE_N[code] + '」' + (d.some(x => Math.abs(x) > 1e-7) ? '；删了东西，模型按剩下的部分重新落地、居中（点好的位置跟着挪了）' : '') + '，点「保存」生效');
}
// 圆心定位器：三点定圆（圆心、半径、圆所在平面的法线 = 转轴方向）
function mdxCircle(a, b, c) {
  const s = (p, q) => [p[0] - q[0], p[1] - q[1], p[2] - q[2]], dt = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
  const ab = s(b, a), ac = s(c, a), n = mimCross(ab, ac), nn = dt(n, n);
  if (nn < 1e-10) return null;   // 三点在一条线上
  const t1 = mimCross(n, ab), t2 = mimCross(ac, n), k1 = dt(ac, ac) / (2 * nn), k2 = dt(ab, ab) / (2 * nn), ctr = [0, 1, 2].map(i => a[i] + t1[i] * k1 + t2[i] * k2), nl = Math.sqrt(nn);
  return { c: ctr, n: n.map(x => x / nl), r: Math.hypot(...s(a, ctr)) };
}
// 改一根转轴（没有就按默认方向建）
function mdxAxSet(ax, fn) {
  const mk = MDX.sel;
  mdxPtPush(mk);
  const A = MDX_W.mdl[mk] = MDX_W.mdl[mk] || {}, pt = A.pt = A.pt || {}, X = pt[ax] = pt[ax] || { p: [0, 0, 0], a: MDX_AXD[ax].slice() };
  fn(X, pt);
  if (pt[ax] === null) delete pt[ax];
  if (!Object.keys(pt).length) delete A.pt;
  if (!Object.keys(A).length) delete MDX_W.mdl[mk];
  MDX.dirty = true;
}
// 在模型上点了一下（部件、切割、转轴的点选模式）：返回 true 表示处理了
function mdxPtPick(h, e) {
  const P = MDX.pc, pk = MDX.pk, q = mivXf((P.snap ? h.vp : h.p).slice(), h.rr || 0, 1), R3 = v => Math.round(v * 1e4) / 1e4;   // 点在试转着的部件上：换回没转时的位置
  if (pk === 'pc') { mdxPcPick(h, e); return true; }
  if (pk === 'cutp') { P.cut.c = q.map(R3); MDX.pk = 'pc'; MDX.keep = true; mdxRender(); mdxMsg('薄片挪到了（' + P.cut.c.join(', ') + '）：再调方向、大小，点「切开」'); return true; }
  if (pk.startsWith('ap:')) { const ax = pk.slice(3); mdxAxSet(ax, X => { X.p = q.map(R3); }); MDX.pk = ''; MDX.keep = true; mdxRender(); mdxMsg(MDX_AXN[ax] + '过（' + q.map(R3).join(', ') + '），方向不变；点「保存」生效'); return true; }
  if (pk.startsWith('cc:')) {
    const ax = pk.slice(3);
    P.cc.tgt = ax; P.cc.pts.push(q.slice()); P.cc.res = null;
    if (P.cc.pts.length < 3) { mdxPtSync(); mdxMsg('圆心定位器：圆边上第 ' + P.cc.pts.length + ' 个点点好了，再点第 ' + (P.cc.pts.length + 1) + ' 个（三个点尽量隔开）'); return true; }
    const r = mdxCircle(...P.cc.pts);
    P.cc.pts = [];
    if (!r) { mdxPtSync(); mdxMsg('三个点差不多在一条直线上，定不出圆：重新点'); return true; }
    P.cc.res = r;
    mdxAxSet(ax, X => { X.p = r.c.map(R3); X.a = r.n.map(v => Math.round(v * 1e6) / 1e6); });
    MDX.pk = ''; MDX.keep = true; mdxRender();
    mdxMsg('圆心（' + r.c.map(R3).join(', ') + '），半径 ' + R3(r.r) + ' 米；' + MDX_AXN[ax] + '过圆心、垂直于这个圆。点「保存」生效');
    return true;
  }
  return false;
}
// 切开（直接改存着的模型文件，能撤销）：切开的块拆出来的新块继承原来的用途
async function mdxDoCut() {
  const mk = MDX.sel, P = MDX.pc, S = mdxPtState(mk);
  if (!S) return;
  const G = mdxCutPlane(), off = S.off, only = P.sel.size ? new Set(P.sel) : null;
  mdxMsg('正在切…');
  const rec0 = await modFileGet(mk);
  if (!rec0) { mdxMsg('模型文件不见了'); return; }
  mimEnsure(rec0);
  const R = mimCut(rec0, { c: G.c.map((x, k) => x + off[k]), n: G.n, u: G.u, v: G.v, hu: G.hu, hv: G.hv }, only);
  if (!R.n) { mdxMsg('薄片没有切到东西：把它挪到要切开的地方（半透明的面要穿过模型），大小盖住要切的那一圈' + (only ? '；现在只切选中的块' : '')); return; }
  const back = { mk, rec: await modFileGet(mk), W: JSON.stringify(MDX_W.mdl[mk] || null), S: JSON.stringify(MOD.mdl[mk] || null) };
  let nNew = 0;
  for (const W1 of [MDX_W, MOD]) {   // 新块继承原块的用途（已保存的和正在改的两份都改：模型文件已经变了）
    const pt = W1.mdl[mk] && W1.mdl[mk].pt;
    if (!pt) continue;
    for (let c = 1; c < MOD_PTR.length; c++) { const ids = modIdsDec(pt[MOD_PTR[c]]), add = []; for (const i of ids) if (R.map.has(i)) add.push(...R.map.get(i)); if (add.length) pt[MOD_PTR[c]] = modIdsEnc([...ids, ...add]); }
  }
  for (const L of R.map.values()) nNew += L.length;
  modStoreSave();
  await modFilePut(mk, R.rec);
  modReg(mk, R.rec);
  if (MOD.lib[mk]) { MOD.lib[mk].tri = R.rec.meta.imp ? R.rec.meta.imp.tri : MOD.lib[mk].tri; modStoreSave(); if (MDX_W.lib) MDX_W.lib[mk] = MOD.lib[mk]; }
  P.cutUd.push(back); if (P.cutUd.length > 3) P.cutUd.shift();
  P.sel.clear();
  if (typeof MIV === 'object') { MIV.key = null; MIV.keepCam = mk; }
  MDX.pk = 'pc'; MDX.keep = true; mdxRender();
  mdxMsg('切开了（切了 ' + R.n + ' 处），多出 ' + nNew + ' 块：点切下来的那块选中它，再「设为……」' + (nNew ? '' : '——没有多出块：薄片没把它整圈切断（薄片再大一点，或者位置再准一点）'));
}
async function mdxUndoCut() {
  const P = MDX.pc, b = P.cutUd.pop();
  if (!b) return;
  await modFilePut(b.mk, b.rec);
  modReg(b.mk, b.rec);
  const W = JSON.parse(b.W), S2 = JSON.parse(b.S);
  if (W) MDX_W.mdl[b.mk] = W; else delete MDX_W.mdl[b.mk];
  if (S2) MOD.mdl[b.mk] = S2; else delete MOD.mdl[b.mk];
  if (MOD.lib[b.mk] && b.rec.meta.imp) MOD.lib[b.mk].tri = b.rec.meta.imp.tri;
  modStoreSave();
  P.sel.clear();
  if (typeof MIV === 'object') { MIV.key = null; MIV.keepCam = b.mk; }
  MDX.keep = true; mdxRender(); mdxMsg('切割撤销了');
}
// 部件工具栏里「选中几块」那一行（选择变了只刷新这一小块，不重建整页）
function mdxPcBar() {
  const el = MDX.el && MDX.el.querySelector('.mdx-pcsel'), M = mdxPcM(MDX.sel);
  if (!el || !M) return;
  mdxPcBB(M);
  let t = 0;
  for (const i of MDX.pc.sel) t += M.ptri[i] || 0;
  el.textContent = MDX.pc.sel.size ? '选中 ' + MDX.pc.sel.size + ' 块（' + t + ' 个三角形）' : '没选中';
}
// 部件这一段的表单
function mdxPtForm(mk, air) {
  const M = mdxPcM(mk), P = MDX.pc;
  if (!M) return `<h3 style="margin-top:12px">部件：切开、选块、定转轴</h3><p class="note">模型读出来以后才能拆部件……</p>`;
  mdxPcReset(mk);
  const A = MDX_W.mdl[mk] || {}, pt = A.pt || {}, S = mdxPtState(mk), cnt = new Array(7).fill(0);
  for (let i = 0; i < M.pn; i++) cnt[S.R[i]]++;
  const btn = (attr, t, on, tip) => `<button type="button" class="mdx-btn${on ? ' pri' : ''}" ${attr}${tip ? ` title="${mdxEsc(tip)}"` : ''}>${t}</button>`;
  const num = (attr, v, w = 74) => `<input type="number" step="any" ${attr} value="${v ?? ''}" style="width:${w}px">`;
  const R3 = v => Math.round(v * 1000) / 1000, b = M.m.bb;
  let h = `<h3 style="margin-top:12px">部件：切开、选块、定转轴</h3><p class="note">模型按连在一起的网格分成一块一块（这个模型 ${M.pn} 块）。点「选部件」后在预览里点一块就选上 / 取消（黄色）；
    炮塔和车体连成一整块的，先用下面的「切割薄片」切开。选好了点「设为……」（蓝 = 炮塔、橙 = 炮管${air ? '、紫 = 起落架、青 = 旋翼' : ''}）。
    ${air ? '旋翼' : '炮塔'}转的时候只有设成${air ? '旋翼的块' : '炮塔、炮管的块'}跟着转，其余不动。转轴不自动估：自己输数、在模型上点，或用圆心定位器在圆边上点三个点。</p>
    <div class="mdx-pcbar">
      <label>按 <select data-pcg="1"><option value="pc"${P.g === 'pc' ? ' selected' : ''}>一块</option>${M.pnd && M.nodes ? `<option value="nd"${P.g === 'nd' ? ' selected' : ''}>整个物体</option>` : ''}</select> 选</label>
      ${btn('data-pca="box"', '框选', P.box, '打开后在预览里拖出方框，整块都在框里的选上')}${btn('data-pca="all"', '全选')}${btn('data-pca="inv"', '反选')}${btn('data-pca="none"', '清空')}${M.pnd && M.nodes ? btn('data-pca="up"', '扩到上一级物体', false, '选中的块所在物体的上一级（比如「炮塔」下面的全部）都选上') : ''}</div>
    <div class="mdx-pcbar">设为：${MDX_ROLE[air ? 'air' : 'veh'].map(([c, n]) => `<button type="button" class="mdx-btn" data-pcs="${c}"${c ? ` style="border-color:${MIV_ROLE_C[c]}"` : ''}>${n}</button>`).join('')}
      <label><input type="checkbox" data-pcgh="1"${P.gh ? ' checked' : ''}> 显示删掉的</label>${btn('data-pca="undo"', '撤销', false, '撤销上一步（选块、设用途、转轴）')}</div>
    <p class="note">${cnt.map((k, c) => c && k ? MDX_ROLE_N[c] + ' ' + k + ' 块' : '').filter(Boolean).join(' · ') || '还没设部件：全部是' + (air ? '机身' : '车体') + '，不动'}</p>`;
  // 切割薄片
  const K = P.cut;
  h += `<div class="mdx-pcbar"><b>切割薄片</b>${btn('data-cuta="on"', K.on ? '收起薄片' : '拿出薄片', K.on)}${K.on ? btn('data-cuta="pick"', '放到点击处', MDX.pk === 'cutp', '再在模型上点一下，薄片中心挪到那里') + btn('data-cuta="cut"', '切开', false, '沿薄片把穿过它的网格切开') + (P.cutUd.length ? btn('data-cuta="undo"', '撤销切割') : '') : ''}</div>`;
  if (K.on) {
    const sl = (f, nm, mn, mx, stp, v, unit) => `<div class="mdx-row"><label>${nm}</label><input type="range" min="${mn}" max="${mx}" step="${stp}" data-cut="${f}" value="${v}"><span class="def">${num(`data-cut="${f}"`, v)} ${unit}</span><span></span></div>`;
    const ext = Math.max(b[3] - b[0], b[4] - b[1], b[5] - b[2]) * .7 + 1;
    h += `<p class="note">半透明蓝色的面就是薄片，穿过模型的地方就是要切的地方；只切交线落在薄片范围里的（大小别盖住不想切的东西）。${P.sel.size ? '<b>现在只切选中的 ' + P.sel.size + ' 块</b>（清空选择就切薄片范围里的全部）。' : '没选中块：切薄片范围里的全部。'}</p>
      <div class="mdx-pcbar">方向：${btn('data-cuta="hz"', '水平')}${btn('data-cuta="fx"', '竖直·前后切')}${btn('data-cuta="fy"', '竖直·左右切')}　沿法线挪：${[-.05, -.01, .01, .05].map(d => btn(`data-cutn="${d}"`, (d > 0 ? '+' : '−') + Math.abs(d * 100) + ' 厘米')).join('')}</div>` +
      sl('c.0', '中心 x（前后）', R3(b[0] - 1), R3(b[3] + 1), .005, K.c[0], '米') + sl('c.1', '中心 y（左右）', R3(b[1] - 1), R3(b[4] + 1), .005, K.c[1], '米') + sl('c.2', '中心 z（高低）', R3(b[2] - .5), R3(b[5] + .5), .005, K.c[2], '米') +
      sl('el', '倾角（90 = 水平）', -90, 90, .5, K.el, '度') + sl('az', '方位', -180, 180, .5, K.az, '度') + sl('sp', '绕法线转', -180, 180, .5, K.sp, '度') +
      sl('w', '宽', .05, R3(ext * 2), .01, K.w, '米') + sl('h', '高', .05, R3(ext * 2), .01, K.h, '米');
  }
  // 转轴
  const axes = air ? ['ra', 'qa'] : ['ta', 'ga', 'ma', 'mb'];
  h += `<div class="mdx-pcbar"><b>转轴</b><label><input type="checkbox" data-snap="1"${P.snap ? ' checked' : ''}> 点模型时吸附到最近的顶点</label></div>`;
  for (const ax of axes) {
    const X = pt[ax], has = !!modAx(X), cc = MDX.pk === 'cc:' + ax;
    h += `<div class="mdx-ax"><div class="mdx-pcbar"><b style="color:${MIV_ROLE_C[MOD_PT_AX[ax]]}">${MDX_AXN[ax]}</b>${has ? '' : '<span class="def">还没定（这种部件不会动）</span>'}
        ${btn(`data-axa="cc" data-ax="${ax}"`, cc ? '圆心定位器：点第 ' + (P.cc.pts.length + 1) + ' 个点…' : '圆心定位器', cc, '在圆边上点三个点：圆心就是转轴经过的点，方向垂直于这个圆（比如沿炮塔座圈点三下）')}${btn(`data-axa="pick" data-ax="${ax}"`, '点一下定中心', MDX.pk === 'ap:' + ax, '在模型上点一下：转轴经过这一点，方向不变')}
        ${btn(`data-axa="dz" data-ax="${ax}"`, '竖直')}${btn(`data-axa="dy" data-ax="${ax}"`, '左右')}${btn(`data-axa="dx" data-ax="${ax}"`, '前后')}${has ? btn(`data-axa="clr" data-ax="${ax}"`, '清除') : ''}</div>
      <div class="mdx-pcbar">经过 ${[0, 1, 2].map(i => 'xyz'[i] + ' ' + num(`data-axf="${ax}.p.${i}"`, has ? X.p[i] : '')).join(' ')}　方向 ${[0, 1, 2].map(i => 'xyz'[i] + ' ' + num(`data-axf="${ax}.a.${i}"`, has ? X.a[i] : '', 64)).join(' ')}</div></div>`;
  }
  // 试转（只在预览里）、动作参数
  const tsl = (f, nm, mn, mx, v) => `<div class="mdx-row"><label>${nm}</label><input type="range" min="${mn}" max="${mx}" step="1" data-pct="${f}" value="${v}"><span class="def" data-pctv="${f}">${v}°</span><span></span></div>`;
  if (air) h += tsl('rs', '试转旋翼（只在预览里）', 0, 360, P.rs);
  else {
    h += tsl('ta', '试转炮塔（只在预览里）', -180, 180, P.ta) + tsl('el', '试抬炮管（只在预览里）', -20, 60, P.el) + tsl('my', '试转机枪塔（只在预览里）', -180, 180, P.my) + tsl('me', '试抬机枪（只在预览里）', -20, 70, P.me);
    const el = Array.isArray(pt.el) ? pt.el : [];
    h += `<div class="mdx-pcbar"><b>炮塔、炮管怎么动（游戏里）</b></div>
      <div class="mdx-pcbar">炮管俯仰 ${num('data-ptf="el.0"', el[0] ?? '', 60)} 到 ${num('data-ptf="el.1"', el[1] ?? '', 60)} 度（默认 −6 到 18）　俯仰速度 ${num('data-ptf="elR"', pt.elR ?? '', 60)} 度 / 秒（默认 20）</div>
      <div class="mdx-pcbar">后坐 ${num('data-ptf="rc"', pt.rc ?? '', 60)} 米（默认 0.3）　炮塔转速 ${num('data-ptf="trav"', pt.trav ?? '', 60)} 度 / 秒（推演里没有炮塔的车种上用，默认 40；有炮塔的按「坦克装甲车」页的炮塔回转速度）</div>
      <div class="mdx-pcbar"><b>机枪塔、机枪怎么动（游戏里）</b>：机枪开火时机枪塔转向机枪的目标、机枪按目标高低抬，不打了 3 秒回正</div>
      <div class="mdx-pcbar">机枪塔转速 ${num('data-ptf="mtr"', pt.mtr ?? '', 60)} 度 / 秒（默认 90）　机枪俯仰 ${num('data-ptf="mel.0"', (pt.mel || [])[0] ?? '', 60)} 到 ${num('data-ptf="mel.1"', (pt.mel || [])[1] ?? '', 60)} 度（默认 −10 到 60）　俯仰速度 ${num('data-ptf="melR"', pt.melR ?? '', 60)} 度 / 秒（默认 60）</div>`;
  }
  // 物体列表（glTF 节点）
  if (M.pnd && M.nodes && M.nodes.length > 1) {
    const N = M.nodes, kids = N.map(() => []), dep = N.map(() => 0), per = new Map();
    N.forEach((d, i) => { if (d.p >= 0 && N[d.p]) kids[d.p].push(i); });
    N.forEach((d, i) => { let k = 0; for (let q = d.p; q >= 0 && k < 80; q = N[q] ? N[q].p : -1) k++; dep[i] = k; });
    for (let i = 0; i < M.pn; i++) per.set(M.pnd[i], (per.get(M.pnd[i]) || 0) + 1);
    const rows = [], walk = i => { if (rows.length >= 400) return; rows.push(i); for (const c of kids[i]) walk(c); };
    N.forEach((d, i) => { if (d.p < 0) walk(i); });
    h += `<details class="mdx-nodes"><summary>物体列表（${N.length} 个，点名字把它和它下面的全部选上 / 取消）</summary>${rows.map(i => `<button type="button" class="mdx-it" data-pcn="${i}" style="padding-left:${8 + dep[i] * 14}px">${mdxEsc(N[i].n)}<small>${per.get(i) ? per.get(i) + ' 块' : '（只是分组）'}</small></button>`).join('')}${N.length > rows.length ? '<p class="note">太多了，只列出前 400 个</p>' : ''}</details>`;
  }
  return h;
}
// 部件面板的点击
function mdxPtClick(b) {
  const mk = MDX.sel, M = mdxPcM(mk), P = MDX.pc, d = b.dataset;
  if (!M) return false;
  if (d.pca) {
    const a = d.pca;
    if (a === 'box') { P.box = !P.box; if (P.box) MDX.pk = 'pc'; MDX.keep = true; mdxRender(); mdxMsg(P.box ? '框选：在预览里按住左键拖出方框（右键或 Shift 拖动还是平移）' : ''); return true; }
    if (a === 'all' || a === 'inv' || a === 'none') { const S = mdxPtState(mk); for (let i = 0; i < M.pn; i++) { const on = a === 'all' ? S.R[i] !== MOD_PT_DEL || P.gh : a === 'inv' ? !P.sel.has(i) && (S.R[i] !== MOD_PT_DEL || P.gh) : false; if (on) P.sel.add(i); else P.sel.delete(i); } mdxPtSync(); mdxPcBar(); return true; }
    if (a === 'up' && M.pnd && M.nodes) { const par = new Set(); for (const i of P.sel) { const nd = M.pnd[i], p = M.nodes[nd] ? M.nodes[nd].p : -1; par.add(p >= 0 ? p : nd); } for (const nd of par) for (const i of mdxNodePieces(M, nd, true)) P.sel.add(i); mdxPtSync(); mdxPcBar(); mdxMsg('扩到上一级：选中 ' + P.sel.size + ' 块'); return true; }
    if (a === 'undo') { const u = P.ud.pop(); if (!u || u.mk !== mk) { if (u) P.ud.push(u); mdxMsg('没有可以撤销的了'); return true; } const o = JSON.parse(u.A); if (o) MDX_W.mdl[mk] = o; else delete MDX_W.mdl[mk]; MDX.dirty = true; MDX.keep = true; mdxRender(); mdxMsg('撤销了一步'); return true; }
  }
  if (d.pcs != null) { mdxPcSet(+d.pcs); return true; }
  if (d.pcn != null) { const ids = mdxNodePieces(M, +d.pcn, true), on = ids.some(i => !P.sel.has(i)); for (const i of ids) if (on) P.sel.add(i); else P.sel.delete(i); mdxPtSync(); mdxPcBar(); mdxMsg((on ? '选上了' : '取消了') + '「' + M.nodes[+d.pcn].n + '」' + ids.length + ' 块'); return true; }
  if (d.cuta) {
    const a = d.cuta, K = P.cut;
    if (a === 'on') K.on = !K.on;
    else if (a === 'pick') MDX.pk = MDX.pk === 'cutp' ? 'pc' : 'cutp';
    else if (a === 'hz') { K.el = 90; K.az = 0; K.sp = 0; }
    else if (a === 'fx') { K.el = 0; K.az = 0; K.sp = 0; }
    else if (a === 'fy') { K.el = 0; K.az = 90; K.sp = 0; }
    else if (a === 'cut') { mdxDoCut().catch(err => mdxMsg('切不了：' + err.message)); return true; }
    else if (a === 'undo') { mdxUndoCut().catch(err => mdxMsg('撤销不了：' + err.message)); return true; }
    MDX.keep = true; mdxRender(); if (a === 'pick' && MDX.pk === 'cutp') mdxMsg('在模型上点一下：薄片中心挪到那里');
    return true;
  }
  if (d.cutn != null) { const G = mdxCutPlane(), s = +d.cutn; P.cut.c = P.cut.c.map((x, k) => Math.round((x + G.n[k] * s) * 1e4) / 1e4); MDX.keep = true; mdxRender(); return true; }
  if (d.axa) {
    const a = d.axa, ax = d.ax;
    if (a === 'cc') { MDX.pk = MDX.pk === 'cc:' + ax ? '' : 'cc:' + ax; P.cc = { tgt: ax, pts: [], res: null }; MDX.keep = true; mdxRender(); if (MDX.pk) mdxMsg('圆心定位器：在圆的边上点三个点（比如炮塔座圈、炮塔底边一圈），尽量隔开'); return true; }
    if (a === 'pick') { MDX.pk = MDX.pk === 'ap:' + ax ? '' : 'ap:' + ax; MDX.keep = true; mdxRender(); if (MDX.pk) mdxMsg('在模型上点一下：' + MDX_AXN[ax] + '经过那一点'); return true; }
    if (a === 'clr') { mdxAxSet(ax, (X, pt) => { pt[ax] = null; }); }
    else mdxAxSet(ax, X => { X.a = { dz: [0, 0, 1], dy: [0, 1, 0], dx: [1, 0, 0] }[a]; });
    MDX.keep = true; mdxRender(); mdxMsg('改了，点「保存」生效');
    return true;
  }
  return false;
}
// 部件面板的输入（change）
function mdxPtChange(t) {
  const mk = MDX.sel, P = MDX.pc, d = t.dataset;
  if (d.pcg) { P.g = t.value; return true; }
  if (d.pcgh) { P.gh = t.checked; mdxPtSync(); return true; }
  if (d.snap) { P.snap = t.checked; return true; }
  if (d.axf) {
    const [ax, f, i] = d.axf.split('.'), v = t.value === '' ? null : +t.value;
    if (v != null && !isFinite(v)) return true;
    mdxAxSet(ax, X => { X[f][+i] = v ?? (f === 'a' ? MDX_AXD[ax][+i] : 0); });
    MDX.keep = true; mdxRender(); mdxMsg('改了，点「保存」生效');
    return true;
  }
  if (d.ptf) {
    const f = d.ptf, v = t.value === '' ? null : +t.value;
    if (v != null && !isFinite(v)) return true;
    mdxPtPush(mk);
    const A = MDX_W.mdl[mk] = MDX_W.mdl[mk] || {}, pt = A.pt = A.pt || {};
    if (/^m?el\.\d$/.test(f)) { const k = f.slice(0, -2), D0 = k === 'el' ? [-6, 18] : [-10, 60], i = +f.slice(-1), el = Array.isArray(pt[k]) ? pt[k].slice() : D0.slice(); el[i] = v ?? D0[i]; pt[k] = el; if (el[0] === D0[0] && el[1] === D0[1]) delete pt[k]; }
    else if (v == null) delete pt[f]; else pt[f] = v;
    if (!Object.keys(pt).length) delete A.pt;
    if (!Object.keys(A).length) delete MDX_W.mdl[mk];
    MDX.dirty = true; mdxMsg('改了，点「保存」生效');
    return true;
  }
  return false;
}
// 部件面板的拖动（input）：试转、切割薄片——只刷新预览，不重建整页
function mdxPtInput(t) {
  const P = MDX.pc, d = t.dataset;
  if (d.pct) { P[d.pct] = +t.value; const s = MDX.el.querySelector(`[data-pctv="${d.pct}"]`); if (s) s.textContent = t.value + '°'; mdxPtSync(); return true; }
  if (d.cut) {
    const v = +t.value;
    if (!isFinite(v) || t.value === '') return true;
    const f = d.cut;
    if (f.startsWith('c.')) P.cut.c[+f[2]] = v; else P.cut[f] = v;
    for (const o of MDX.el.querySelectorAll(`[data-cut="${f}"]`)) if (o !== t) o.value = v;
    mdxPtSync();
    return true;
  }
  return false;
}
// —— 热浪（三维，按模型：MDX_W.mdl[模型键].hz，格式见 mod.js modHazeOf）——
//   [字段, 名称, 单位, 最小, 最大, 步长]；默认值车辆按柴油机排气（慢、往上飘），飞机按喷气发动机（快、顺着往后）
const MDX_HZF = [['r', '起点半径', '米', .02, 3, .01], ['len', '长度', '米', .2, 40, .1], ['k', '强度', '倍', 0, 3, .05], ['sp', '末端变粗', '倍', .3, 6, .05], ['rise', '往上飘', '米', -3, 8, .05], ['tb', '湍流疏密', '倍', .2, 4, .05], ['spd', '流速', '倍', 0, 5, .05], ['warm', '发暖', '倍', 0, 3, .05]];
const mdxHzDef = air => air ? { r: .45, len: 7, k: 1.2, sp: 2.6, rise: 0, tb: 1, spd: 1.6, warm: 1 } : { r: .25, len: 2.5, k: 1, sp: 2.2, rise: .8, tb: 1, spd: .6, warm: .6 };
const MDX_HZD = { back: [-1, 0, 0], up: [0, 0, 1], bu: [-1, 0, .6], left: [0, 1, 0], right: [0, -1, 0] };
const mdxIsAir = mk => { const r = mdxModels().find(o => o.id === mk); return !!r && r.kind === 'air'; };
function mdxHzForm(mk, air) {
  const A = MDX_W.mdl[mk] || {}, L = Array.isArray(A.hz) ? A.hz : [], D = mdxHzDef(air), R3 = v => Math.round(v * 1000) / 1000;
  const btn = (attr, t, on) => `<button type="button" class="mdx-btn${on ? ' pri' : ''}" ${attr}>${t}</button>`, num = (attr, v, w = 64) => `<input type="number" step="any" ${attr} value="${v ?? ''}" style="width:${w}px">`;
  let h = `<h3 style="margin-top:12px">热浪（三维）</h3><p class="note">排气口、喷口后面被烤热的空气：是一个立体的热气柱——侧面看、顺着看都不一样，厚的地方扭得多，前面的东西挡得住它，不是贴在屏幕上的平面。
    点「加一个热浪源」再在模型上点排气口；方向、粗细、长度、往上飘这些拖滑块调，预览里直接看到。${air ? '尾喷口本身的热浪在上面「尾焰」里调倍数，这里是另外加的（辅助动力、发动机舱的热气……）。' : '设计了热浪的车，游戏里就不用默认的排气位置了。'}</p>
    <div class="mdx-pcbar">${btn('data-hza="add"', MDX.pk === 'hz:new' ? '在模型上点排气口…' : '＋ 加一个热浪源', MDX.pk === 'hz:new')}<label><input type="checkbox" data-hzanim="1"${typeof MIV === 'object' && MIV.hzAnim ? ' checked' : ''}> 预览里一直动</label></div>`;
  L.forEach((e, i) => {
    h += `<div class="mdx-ax"><div class="mdx-pcbar"><b>热浪 ${i + 1}</b>${btn(`data-hza="pick" data-i="${i}"`, MDX.pk === 'hz:' + i ? '在模型上点…' : '换起点', MDX.pk === 'hz:' + i)}${btn(`data-hza="mir" data-i="${i}"`, '左右对称复制一个')}${btn(`data-hza="del" data-i="${i}"`, '删除')}</div>
      <div class="mdx-pcbar">起点 ${[0, 1, 2].map(k => 'xyz'[k] + ' ' + num(`data-hzp="${i}.p.${k}"`, R3(e.p[k]))).join(' ')}　方向 ${[0, 1, 2].map(k => 'xyz'[k] + ' ' + num(`data-hzp="${i}.d.${k}"`, R3(e.d[k]), 58)).join(' ')}</div>
      <div class="mdx-pcbar">方向：${[['back', '向后'], ['bu', '向后上方'], ['up', '向上'], ['left', '向左'], ['right', '向右']].map(([k, n]) => btn(`data-hzd="${k}" data-i="${i}"`, n)).join('')}</div>` +
      MDX_HZF.map(([f, nm, unit, mn, mx, stp]) => { const v = e[f] ?? D[f]; return `<div class="mdx-row"><label>${nm}（${unit}）</label><input type="range" min="${mn}" max="${mx}" step="${stp}" data-hzs="${i}.${f}" value="${v}"><span class="def">${num(`data-hzs="${i}.${f}"`, v)}</span><span></span></div>`; }).join('') + '</div>';
  });
  return h;
}
// 改热浪（没有就建）；fn 返回 false 表示不算改动
function mdxHzEdit(fn) {
  const mk = MDX.sel, A = MDX_W.mdl[mk] = MDX_W.mdl[mk] || {};
  if (!Array.isArray(A.hz)) A.hz = [];
  fn(A.hz, A);
  if (!A.hz.length) delete A.hz;
  if (!Object.keys(A).length) delete MDX_W.mdl[mk];
  MDX.dirty = true;
  if (typeof MIV === 'object') MIV.hz = (MDX_W.mdl[mk] || {}).hz || null;
}
// 在模型上点了一下：加热浪源 / 换起点
function mdxHzPick(p) {
  const pk = MDX.pk, air = mdxIsAir(MDX.sel);
  if (pk === 'hz:new') { mdxHzEdit(L => L.push({ p: p.slice(), d: (air ? MDX_HZD.back : MDX_HZD.bu).slice(), ...mdxHzDef(air) })); MDX.pk = ''; return '加了一个热浪源：拖下面的滑块调方向、粗细、长度'; }
  const i = +pk.slice(3);
  mdxHzEdit(L => { if (L[i]) L[i].p = p.slice(); });
  MDX.pk = '';
  return '热浪 ' + (i + 1) + ' 的起点换到（' + p.join(', ') + '）';
}
function mdxHzClick(b) {
  const d = b.dataset;
  if (d.hza) {
    const i = +d.i;
    if (d.hza === 'add') MDX.pk = MDX.pk === 'hz:new' ? '' : 'hz:new';
    else if (d.hza === 'pick') MDX.pk = MDX.pk === 'hz:' + i ? '' : 'hz:' + i;
    else if (d.hza === 'del') mdxHzEdit(L => L.splice(i, 1));
    else if (d.hza === 'mir') mdxHzEdit(L => { const e = L[i]; if (e) L.splice(i + 1, 0, { ...e, p: [e.p[0], -e.p[1], e.p[2]], d: [e.d[0], -e.d[1], e.d[2]] }); });
    MDX.keep = true; mdxRender(); mdxMsg(MDX.pk.startsWith('hz:') ? '在模型上点一下：热浪从那里出' : '改了，点「保存」生效');
    return true;
  }
  if (d.hzd) { mdxHzEdit(L => { if (L[+d.i]) L[+d.i].d = MDX_HZD[d.hzd].slice(); }); MDX.keep = true; mdxRender(); mdxMsg('改了，点「保存」生效'); return true; }
  return false;
}
function mdxHzChange(t) {
  const d = t.dataset;
  if (d.hzanim) { MIV.hzAnim = t.checked; mivDraw(); return true; }
  if (d.hzp) {
    const [i, f, k] = d.hzp.split('.'), v = +t.value;
    if (t.value === '' || !isFinite(v)) return true;
    mdxHzEdit(L => { if (L[+i]) L[+i][f][+k] = v; });
    MDX.keep = true; mdxRender(); mdxMsg('改了，点「保存」生效');
    return true;
  }
  return false;
}
// 拖滑块：只改数、刷新预览，不重建整页
function mdxHzInput(t) {
  const d = t.dataset;
  if (!d.hzs) return false;
  const [i, f] = d.hzs.split('.'), v = +t.value;
  if (t.value === '' || !isFinite(v)) return true;
  mdxHzEdit(L => { if (L[+i]) L[+i][f] = v; });
  for (const o of MDX.el.querySelectorAll(`[data-hzs="${d.hzs}"]`)) if (o !== t) o.value = v;
  if (typeof MIV === 'object' && !MIV.hzAnim) mivDraw();
  mdxMsg('改了，点「保存」生效');
  return true;
}
// —— 特效贴图 ——
const MDX_SLOT = [['expl', '爆炸（火球 + 烟，放一遍）'], ['fire', '残骸起火（循环）'], ['mzl', '坦克 / 车炮炮口焰'], ['mzla', '火炮炮口焰'], ['puff', '烟团']];
const MDX_FXM = [['2', '发光（火焰、尾焰、爆炸）'], ['1', '受光（烟）'], ['0', '分通道（ArmyVFX 的格式：A 透明、B 火光、R / G 受光）']];
function mdxFxForm(k) {
  const row = (nm, inp, tip = '') => `<div class="mdx-row"><label>${nm}</label>${inp}<span class="def">${tip}</span><span></span></div>`;
  const fxs = Object.keys(MOD.lib).filter(id => MOD.lib[id].k === 'fx'), ms = (cur, attr) => `<select ${attr}>${MDX_FXM.map(([v, n]) => `<option value="${v}"${String(cur) === v ? ' selected' : ''}>${n}</option>`).join('')}</select>`;
  if (k === '+imp') {
    const I = MDX.fxImp;
    return `<h3>导入序列帧贴图</h3><p class="note">一张图里按行排好的动画帧（每行 n 格、共 n 行，从左上角开始一行行往下），比如虚幻、Unity 特效包里的 SubUV / Flipbook 贴图。
      导入后可以换掉游戏里的爆炸、炮口焰、烟（「换掉游戏里的特效」），或者在「模型与挂点」里当飞机的尾焰。</p>
      ${row('图片', '<input type="file" accept="image/png,image/webp,image/jpeg" data-fxi="file">', MDX.fxF ? mdxEsc(MDX.fxF.name) : '')}
      ${row('名称', `<input type="text" data-fxi="name" value="${mdxEsc(I.name || '')}">`)}
      ${row('每行几格', `<input type="number" min="1" max="32" step="1" data-fxi="n" value="${I.n}">`, '8 × 8、11 × 11 这样')}
      ${row('一共几帧', `<input type="number" min="1" max="1024" step="1" data-fxi="f" value="${I.f}">`, '最后一行没排满就写实际帧数')}
      ${row('画法', ms(I.mode, 'data-fxi="mode"'))}
      <p><button type="button" class="mdx-btn pri" data-a="fximp"${MDX.fxF ? '' : ' disabled'}>导入</button></p>`;
  }
  if (k === 'slots') return `<h3>换掉游戏里的特效</h3><p class="note">用导入的序列帧换掉写实画面里的特效（帧数不一样也行，按总帧数换算）。保存后马上生效。</p>` +
    MDX_SLOT.map(([s, n]) => row(n, `<select data-fxs="${s}"><option value="">原来的（ArmyVFX）</option>${fxs.map(id => `<option value="${id}"${MDX_W.fx[s] === id ? ' selected' : ''}>${mdxEsc(MOD.lib[id].nm)}</option>`).join('')}</select>`)).join('') +
    (fxs.length ? '' : '<p class="note">还没有导入的贴图：先点左边「＋ 导入序列帧贴图」。</p>');
  const L = MOD.lib[k];
  if (!L) return '';
  return `<h3>${mdxEsc(L.nm)}</h3><canvas class="mdx-fxv" data-k="${mdxEsc(k)}" width="256" height="256"></canvas>
    ${row('名称', `<input type="text" data-lib="nm" value="${mdxEsc(L.nm)}">`)}${row('每行几格', `<input type="number" min="1" max="32" step="1" data-lib="n" value="${L.n}">`)}${row('一共几帧', `<input type="number" min="1" max="1024" step="1" data-lib="f" value="${L.f}">`)}
    ${row('画法', ms(L.mode, 'data-lib="mode"'))}<p><button type="button" class="mdx-btn" data-a="fxdel">删除这张贴图</button></p>`;
}
// 序列帧预览：按帧循环播放
const MDXF = { raf: 0, img: null, k: null };
function mdxFxAnim(cv) {
  const k = cv.dataset.k, L = MOD.lib[k];
  cancelAnimationFrame(MDXF.raf);
  if (!L) return;
  const go = () => {
    if (!cv.isConnected) return;
    const g = cv.getContext('2d'), I = MDXF.img, n = L.n, f = L.f, t = performance.now() / 1000, fr = Math.floor(t * 24) % f;
    g.fillStyle = '#1c2124'; g.fillRect(0, 0, cv.width, cv.height);
    if (I) { const cw = I.width / n, ch = I.height / n; g.globalCompositeOperation = L.mode === 2 ? 'lighter' : 'source-over'; g.drawImage(I, (fr % n) * cw, Math.floor(fr / n) * ch, cw, ch, 0, 0, cv.width, cv.height); g.globalCompositeOperation = 'source-over'; }
    MDXF.raf = requestAnimationFrame(go);
  };
  if (MDXF.k !== k) { MDXF.k = k; MDXF.img = null; modFileGet(k).then(rec => rec && rec.blob && createImageBitmap(rec.blob)).then(img => { if (MDXF.k === k) MDXF.img = img; }).catch(() => {}); }
  go();
}
const W0_DEF = () => 8400, H0_DEF = () => 5600;
// 原挂载里每一项的枚数（从机型表的计数分出来，同 fpwpn.js fwLoadout 的规则）
function mdxLoadN(k, r) {
  const a = MOD_DEF.air[k] || AIR_MDL[k], W1 = FW_W[r.w];
  if (!a || !W1) return 0;
  if (W1.k === 'aam') return r.sr ? r.sr : Math.max(0, (r.w === 'pl17' ? a.aamL || 0 : a.aam || 0) - ((MOD_DEF.load[k] || FW_LOAD[k] || []).find(o => o.sr && o !== r) || { sr: 0 }).sr);
  return W1.k === 'agm' ? a.agmN || 0 : a.gbN || 0;
}
function mdxSet(path, f, raw) {
  const [tab, k] = path.split('|'), W0 = MDX_W;
  const o = k ? (W0[tab][k] = W0[tab][k] || {}) : W0[tab];
  if (raw === '' || raw == null) delete o[f]; else o[f] = raw;
  if (k && !Object.keys(o).length) delete W0[tab][k];
  MDX.dirty = true;
}
// 库里的条目（导入的模型、贴图）：改了马上存（文件已经在 IndexedDB 里了）
function mdxLibSet(id, f, v) {
  const L = MOD.lib[id];
  if (!L) return;
  L[f] = v;
  if (MDX_W.lib) MDX_W.lib[id] = L;
  modStoreSave();
  if (L.k === 'fx' && f !== 'nm') modFileGet(id).then(rec => { modReg(id, rec); modApply(); });
}
function mdxChange(e) {
  const t = e.target;
  if (MDX.tab === 'mdl' && (mdxHzChange(t) || mdxPtChange(t))) return;
  if (t.dataset.set) {   // 画面：直接改设置
    const v = t.tagName === 'SELECT' && (t.value === 'true' || t.value === 'false') ? t.value === 'true' : t.type === 'range' ? +t.value : t.value;
    if (typeof setSetting === 'function') setSetting(t.dataset.set, v);
    mdxRender(); mdxMsg('画面设置已生效');
    return;
  }
  if (t.dataset.a === 'import' && t.files && t.files[0]) {
    const fr = new FileReader();
    fr.onload = () => { modImport(String(fr.result)).then(() => { MDX_W = modClone(MOD); MDX.dirty = false; mdxRender(); mdxMsg('模组包已导入并保存'); }, err => mdxMsg('导入失败：' + err.message)); };
    fr.readAsText(t.files[0]);
    return;
  }
  if (t.dataset.imp) {   // 导入模型的表单
    const f = t.dataset.imp;
    if (f === 'files') { MDX.impF = t.files && t.files.length ? [...t.files] : null; if (MDX.impF && !MDX.imp.name) MDX.imp.name = MDX.impF[0].name.replace(/\.(glb|gltf|zip)$/i, ''); }
    else MDX.imp[f] = t.type === 'number' ? (t.value === '' ? undefined : +t.value) : t.value;
    mdxRender();
    return;
  }
  if (t.dataset.fxi) {   // 导入序列帧的表单
    const f = t.dataset.fxi;
    if (f === 'file') { MDX.fxF = t.files && t.files[0] || null; if (MDX.fxF && !MDX.fxImp.name) MDX.fxImp.name = MDX.fxF.name.replace(/\.\w+$/, ''); }
    else MDX.fxImp[f] = t.type === 'number' || f === 'mode' ? Math.max(f === 'mode' ? 0 : 1, Math.round(+t.value || 0)) : t.value;
    mdxRender();
    return;
  }
  if (t.dataset.lib) { const f = t.dataset.lib, v = t.type === 'number' || f === 'mode' ? Math.max(f === 'mode' ? 0 : 1, Math.round(+t.value || 0)) : t.value; mdxLibSet(MDX.sel, f, v); MDX.keep = true; mdxRender(); mdxMsg('已改'); return; }
  if (t.dataset.bind) {   // 导入的模型换到型号上
    const [s, k] = t.dataset.bind.split('|');
    if (t.checked) mdxSet(s + '|' + k, 'mdl', MDX.sel); else if ((MDX_W[s][k] || {}).mdl === MDX.sel) mdxSet(s + '|' + k, 'mdl', '');
    mdxMsg('改了，点「保存」生效');
    return;
  }
  if (t.dataset.fxs) { if (t.value) MDX_W.fx[t.dataset.fxs] = t.value; else delete MDX_W.fx[t.dataset.fxs]; MDX.dirty = true; mdxMsg('改了，点「保存」生效'); return; }
  if (t.dataset.hg) { MDX.hg = t.value; MDX.keep = true; mdxRender(); return; }
  if (t.dataset.mir) { MDX.mir = t.checked; return; }
  if (t.dataset.nzr) { MDX.nzR = Math.max(.05, +t.value || .45); return; }
  if (t.dataset.mf) {
    const p = t.dataset.mf;
    let v = t.tagName === 'SELECT' ? (t.value === 'true' ? true : t.value === 'false' ? false : t.value) : t.value === '' ? '' : +t.value;
    if (t.tagName !== 'SELECT' && v !== '' && !isFinite(v)) return;
    if (p === 'fx.vol' && v === true) v = '';
    mdxMdlSet(p, v); MDX.keep = true; mdxRender(); mdxMsg('改了，点「保存」生效');
    return;
  }
  if (t.dataset.ld != null) {   // 挂载
    const k = MDX.sel, A = MDX_W.air[k] = MDX_W.air[k] || {};
    if (!A.load) A.load = (FW_LOAD[k] || []).map(r => ({ w: r.w, bay: r.bay, n: mdxLoadN(k, r) }));
    const r = A.load[+t.dataset.ld];
    if (r) r[t.dataset.lf] = t.dataset.lf === 'n' ? Math.max(0, Math.round(+t.value || 0)) : t.value;
    MDX.dirty = true; MDX.keep = true; mdxRender(); mdxMsg('挂载改了，点「保存」生效');
    return;
  }
  if (t.dataset.p) {
    const [tab, k] = t.dataset.p.split('|'), f = t.dataset.f;
    let v = t.tagName === 'SELECT' ? t.value : t.value === '' ? '' : +t.value;
    if (v !== '' && t.tagName !== 'SELECT' && !isFinite(v)) return;
    // 换回表里的单位
    const F = tab === 'air' ? [...MDX_AIR_F, ...MDX_PERF_F, ...MDX_GUN_F] : tab === 'eair' ? [...MDX_EAIR_F, ...MDX_PERF_F] : tab === 'msl' ? MDX_MSL_F : null, d = F && F.find(x => x[0] === f);
    if (d && d[4] && v !== '') v = d[4](v);
    if (tab === 'veh' && f === 'era' && v === 'auto') v = '';
    mdxSet(t.dataset.p, f, v);
    MDX.keep = true; mdxRender(); mdxMsg('改了，点「保存」生效');
  }
}
// 导入的模型改了文件以后：重新登记、预览重新读
async function mdxRecUpdate(id, fn) {
  const rec = await modFileGet(id);
  if (!rec) throw new Error('模型文件不见了');
  fn(rec);
  await modFilePut(id, rec);
  modReg(id, rec);
  if (MOD.lib[id]) { MOD.lib[id].len = rec.meta.len; modStoreSave(); }
  if (typeof MIV === 'object') { MIV.key = null; MIV.keepCam = id; }
}
function mdxClick(e) {
  const b = e.target.closest('button, [data-tab], [data-it], [data-rst], [data-ldx]');
  if (!b) return;
  if (b.dataset.tab) { MDX.tab = b.dataset.tab; MDX.sel = null; MDX.q = ''; MDX.pk = ''; mdxRender(); return; }
  if (b.dataset.it) { MDX.sel = b.dataset.it; MDX.pk = ''; mdxRender(); return; }
  if (b.dataset.rst) { const [p, f] = b.dataset.rst.split('|').length > 2 ? [b.dataset.rst.split('|').slice(0, 2).join('|'), b.dataset.rst.split('|')[2]] : b.dataset.rst.split('|'); mdxSet(p, f, ''); MDX.keep = true; mdxRender(); mdxMsg('恢复成默认，点「保存」生效'); return; }
  if (b.dataset.ldx != null) { const A = MDX_W.air[MDX.sel]; if (A && A.load) { A.load.splice(+b.dataset.ldx, 1); MDX.dirty = true; MDX.keep = true; mdxRender(); } return; }
  if (MDX.tab === 'mdl' && (mdxHzClick(b) || mdxPtClick(b))) return;
  if (b.dataset.pk != null) { MDX.pk = b.dataset.pk; MDX.keep = true; mdxRender(); mdxMsg(MDX.pk ? '在上面的模型上点一下' : ''); return; }
  if (b.dataset.mrst) { const A = MDX_W.mdl[MDX.sel]; if (A) { delete A[b.dataset.mrst]; if (!Object.keys(A).length) delete MDX_W.mdl[MDX.sel]; } MDX.dirty = true; MDX.keep = true; mdxRender(); mdxMsg('恢复成游戏原来的，点「保存」生效'); return; }
  if (b.dataset.mdel) { mdxMdlDel(b.dataset.mdel); MDX.keep = true; mdxRender(); return; }
  const a = b.dataset.a;
  if (a === 'close') closeModEditor();
  else if (a === 'save') { for (const k of MOD_SEC) if (k !== 'lib') MOD[k] = modClone(MDX_W[k]); modSave(); MDX.dirty = false; MDX.keep = true; mdxRender(); mdxMsg('已保存：下一局生效，正在打的这一局里的车辆也已更新'); }
  else if (a === 'undo') { MDX_W = modClone(MOD); MDX.dirty = false; mdxRender(); mdxMsg('已放弃没保存的改动'); }
  else if (a === 'ldadd') { const k = MDX.sel, A = MDX_W.air[k] = MDX_W.air[k] || {}; if (!A.load) A.load = (FW_LOAD[k] || []).map(r => ({ w: r.w, bay: r.bay, n: mdxLoadN(k, r) })); A.load.push({ w: 'pl15', bay: 'ext', n: 2 }); MDX.dirty = true; MDX.keep = true; mdxRender(); }
  else if (a === 'ldrst') { const A = MDX_W.air[MDX.sel]; if (A) { delete A.load; if (!Object.keys(A).length) delete MDX_W.air[MDX.sel]; } MDX.dirty = true; MDX.keep = true; mdxRender(); }
  else if (a === 'export' || a === 'exportf') {
    mdxMsg('正在打包…');
    modExport(a === 'exportf').then(txt => {
      const blob = new Blob([txt], { type: 'application/json' }), u = URL.createObjectURL(blob), l = document.createElement('a');
      l.href = u; l.download = '暗剑模组包.json'; document.body.appendChild(l); l.click(); l.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000);
      mdxMsg('已导出（导出的是已保存的内容，' + Math.round(blob.size / 1024) + ' KB）');
    }, err => mdxMsg('导出失败：' + err.message));
  }
  else if (a === 'wipe') { if (!confirm('把编辑器里改的全部恢复成默认？（导入的模型、贴图还留着）')) return; for (const k of MOD_SEC) if (k !== 'lib') MDX_W[k] = {}; MDX.dirty = true; mdxRender(); mdxMsg('已清空，点「保存」生效'); }
  else if (a === 'applytxt') {
    const ta = MDX.el.querySelector('textarea');
    try { const o = JSON.parse(ta.value); for (const k of MOD_SEC) if (k !== 'lib') MDX_W[k] = o[k] && typeof o[k] === 'object' ? o[k] : {}; MDX.dirty = true; mdxRender(); mdxMsg('文本已读进来，点「保存」生效'); }
    catch (err) { mdxMsg('文本不是合法的 JSON：' + err.message); }
  }
  else if (a === 'doimp') {
    if (!MDX.impF || typeof mimImport !== 'function') return;
    const I = MDX.imp;
    b.disabled = true; MIM.texMax = +I.tex || 2048;
    mdxMsg('正在导入…');
    mimImport(MDX.impF, { name: I.name, kind: I.kind, len: +I.len || 0, hl: I.kind === 'veh' ? +I.hl || 0 : 0, fwd: I.fwd, up: I.up, prog: t => mdxMsg('正在导入：' + t + '…') }).then(id => {
      MDX_W.lib = modClone(MOD.lib); MDX.impF = null; MDX.imp = { kind: I.kind, fwd: I.fwd, up: I.up, tex: I.tex };
      MDX.sel = id; MDX.pk = ''; mdxRender();
      mdxMsg('导入好了：在预览里看看朝向对不对，再点炮口 / 挂点 / 尾喷口；勾上要用它的型号，点「保存」');
    }, err => { b.disabled = false; mdxMsg('导入失败：' + err.message); console.warn(err); });
  }
  else if (a === 'turn') {
    const id = MDX.sel, offOf = (rec, W1) => { const V = mimViews(rec); return V.pv ? modPtOff(V.VB, V.st, V.nv, V.pv, modPtRoles(W1.mdl[id] && W1.mdl[id].pt, rec.meta.pn || 0)) : [0, 0, 0]; };
    mdxMsg('正在转…');
    mdxRecUpdate(id, rec => {   // 点好的位置、转轴跟着一起转（已保存的和正在改的两份：模型文件已经转了）
      mimEnsure(rec);
      const W2 = [MDX_W, MOD], o0 = W2.map(W1 => offOf(rec, W1)), X = mimTurn(rec, b.dataset.ax), o1 = W2.map(W1 => offOf(rec, W1));
      if (X) W2.forEach((W1, i) => mdxXfPts(W1.mdl[id], p => { const q = X.xf([p[0] + o0[i][0], p[1] + o0[i][1], p[2] + o0[i][2]]); return [q[0] - o1[i][0], q[1] - o1[i][1], q[2] - o1[i][2]]; }, X.xd));
      MDX.pc.cc = { tgt: '', pts: [], res: null };
    }).then(() => { modStoreSave(); MDX.keep = true; mdxRender(); mdxMsg('转好了（点好的位置、转轴跟着转了）'); }, err => mdxMsg('转不了：' + err.message));
  }
  else if (a === 'mdel' || a === 'fxdel') {
    const id = MDX.sel, L = MOD.lib[id];
    if (!L || !confirm(`删除「${L.nm}」？用它的型号会换回原来的。`)) return;
    modFileDel(id).catch(() => {});
    delete MOD.lib[id];
    if (MDX_W.lib) delete MDX_W.lib[id];
    for (const W1 of [MOD, MDX_W]) {
      for (const s of ['veh', 'air', 'eair']) for (const k in W1[s]) if (W1[s][k].mdl === id) { delete W1[s][k].mdl; if (!Object.keys(W1[s][k]).length) delete W1[s][k]; }
      delete W1.mdl[id];
      for (const s in W1.fx) if (W1.fx[s] === id) delete W1.fx[s];
      for (const mk in W1.mdl) if (W1.mdl[mk].fx && W1.mdl[mk].fx.spr === id) delete W1.mdl[mk].fx.spr;
    }
    if (typeof modUnreg === 'function') modUnreg(id);
    if (typeof V3G_CRED === 'object') { const i = V3G_CRED.findIndex(c => c.uid === id); if (i >= 0) V3G_CRED.splice(i, 1); }
    modStoreSave(); modApply();
    MDX.sel = null; mdxRender(); mdxMsg('已删除');
  }
  else if (a === 'fximp') {
    const F = MDX.fxF, I = MDX.fxImp;
    if (!F) return;
    const id = modNewId('uf_');
    b.disabled = true;
    modFilePut(id, { blob: F }).then(() => {
      MOD.lib[id] = { k: 'fx', nm: I.name || F.name, n: clamp(I.n | 0, 1, 32), f: clamp(I.f | 0, 1, (I.n | 0) ** 2), mode: I.mode | 0, kb: Math.round(F.size / 1024) };
      if (MDX_W.lib) MDX_W.lib[id] = MOD.lib[id];
      modStoreSave(); modReg(id, { blob: F });
      MDX.fxF = null; MDX.fxImp = { n: I.n, f: I.f, mode: I.mode }; MDX.sel = id; mdxRender(); mdxMsg('导入好了：到「换掉游戏里的特效」或「模型与挂点」的尾焰里用它');
    }, err => { b.disabled = false; mdxMsg('导入失败：' + err.message); });
  }
}
// 主菜单加一项「编辑器」（menu.js 的 MN_ITEMS / mnAct）
if (typeof MN_ITEMS === 'object' && Array.isArray(MN_ITEMS) && !MN_ITEMS.some(i => i[0] === 'edit')) {
  const i = MN_ITEMS.findIndex(it => it[0] === 'set');
  MN_ITEMS.splice(i < 0 ? MN_ITEMS.length : i, 0, ['edit', '编辑器', 'EDITOR', '改坦克、飞机、导弹的参数与弹道、挂载，战场大小，画质；导出导入模组包']);
  if (typeof MN_ICON === 'object' && !MN_ICON.edit) MN_ICON.edit = '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>';
  if (typeof mnAct === 'function') { const f0 = mnAct; mnAct = function (k) { if (k === 'edit') { if (typeof mnSfx === 'function') mnSfx('open'); openModEditor(); return; } return f0.apply(this, arguments); }; }
  // 菜单在 menu.js 加载时已经建好了：把这一项补进列表（同样的写法），放在「设置」前面
  const list = typeof MENU === 'object' && MENU.el && MENU.el.querySelector('.mn-list');
  if (list && !list.querySelector('[data-k="edit"]') && typeof mnSvg === 'function') {
    const it = MN_ITEMS.find(x => x[0] === 'edit'), b = document.createElement('button');
    b.type = 'button'; b.setAttribute('role', 'menuitem'); b.className = 'mn-it'; b.dataset.k = 'edit';
    b.innerHTML = `${mnSvg('edit')}<div><b>${it[1]}<small>${it[2]}</small></b><span>${it[3]}</span></div><kbd></kbd>`;
    list.insertBefore(b, list.querySelector('[data-k="set"]'));
  }
}
