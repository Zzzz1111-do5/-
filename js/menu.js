'use strict';
// 开始界面：标题、主菜单（继续 / 闯关 / 沙盒 / 图鉴 / 设置，电脑版与安卓版还有退出）、难度选择、设置面板；右上角 ≡ 菜单按钮
// 菜单打开时：背景是整张沙盘桌（3D）、战场暗化，HUD 隐藏，游戏暂停（从对局中打开时）
const MENU = { open: false, el: null, set: null, view: 'main', game: false, pausedBy: false, idx: 0, last: 'pve', toastT: 0, drift: 0 };
const MN_ICON = {
  cont: '<path d="M7 5l11 7-11 7z"/>',
  pve: '<path d="M3 17l5-9 4 6 3-4 6 7z"/><path d="M15 4v6M15 4l4 1.5-4 1.5"/>',
  sbx: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7" stroke-dasharray="2 2"/><rect x="3" y="14" width="7" height="7" stroke-dasharray="2 2"/><path d="M17.5 14v7M14 17.5h7"/>',
  cdx: '<path d="M4 4h7a2 2 0 012 2v14a2 2 0 00-2-2H4z"/><path d="M20 4h-5a2 2 0 00-2 2v14a2 2 0 012-2h5z"/>',
  isle: '<path d="M2 19c3-2 6-2 9 0s6 2 11 0"/><path d="M5 16c2-4 6-6 11-5 2 .4 3 2 4 5"/><path d="M11 11c0-3 1-6 3-8M14 3c-2 0-4 1-5 3M14 3c2 1 3 2 3 4"/>',
  set: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  quit: '<path d="M12 3v8"/><path d="M6.3 6.8a8 8 0 1011.4 0"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>'
};
const MN_ITEMS = [
  ['cont', '继续作战', 'RESUME', '返回当前战局'],
  ['pve', '闯关', 'CAMPAIGN', '三章十关：每关给预算，自己挑兵种、布置兵力——先夺制海权，再登陆，再向纵深推进'],
  ['isle', '海岛战役', 'ISLAND', '架空热带海岛：超大海域，先海战、再登岛'],
  ['sbx', '沙盒模式', 'SANDBOX', '自由部署双方兵力，观战或亲自指挥'],
  ['cdx', '兵力图鉴', 'CODEX', '全部单位的属性、定位与克制关系'],
  ['set', '设置', 'SETTINGS', '音量、画面、开场转场与指挥官通讯'],
  ...(typeof platCanQuit === 'function' && platCanQuit() ? [['quit', '退出游戏', 'QUIT', '关闭暗剑，回到桌面']] : [])   // 电脑版、安卓版（platform.js）
];
const MN_LV = [
  ['normal', '普通', 'NORMAL', '守军较少，士气易崩', COL.g],
  ['hard', '困难', 'HARD', '纵深防御，集火、提前量', COL.amber],
  ['hell', '地狱', 'HELL', '兵力更多，死战不退', COL.enemy]
];
const mnSvg = (k, cls = '') => `<svg viewBox="0 0 24 24" class="ic ${cls}" aria-hidden="true">${MN_ICON[k]}</svg>`;
const mnSfx = k => { if (typeof auUi === 'function') auUi(k); };

const MN_CSS = `
body.mn-open #bgrain { z-index: 30; opacity: .42; }
:root[data-look="real"] #mnSet .ms-row[data-only="matrix"], :root[data-look="real"] #mnSet .ms-row[data-only="glow"], :root[data-look="green"] #mnSet .ms-row[data-only="matrix"] { display: none; }
body.mn-open > :not(#bgrain):not(#stage):not(.mn-layer):not(script):not(style), body.mn-open #stage > :not(#cv) { visibility: hidden; }
#diff { display: none; }
#mn { position: fixed; inset: 0; z-index: 40; overflow-y: auto; color: var(--text); font-family: var(--f-ui);
  background: linear-gradient(90deg, rgba(var(--bg-rgb), .82), rgba(var(--bg-rgb), .5) 55%, rgba(var(--bg-rgb), .3)), radial-gradient(ellipse at 50% 50%, transparent 55%, rgba(0, 0, 0, .55)), repeating-linear-gradient(to bottom, transparent 0 2px, rgba(0, 0, 0, .22) 2px 3px); }
#mn .mn-wrap { min-height: 100%; box-sizing: border-box; display: flex; flex-direction: column; gap: 28px;
  padding: max(6vh, 28px) max(9vw, 20px) 22px; padding-left: max(9vw, 20px, env(safe-area-inset-left, 0px)); }
#mn header { display: grid; gap: 2px; margin-top: auto; }
#mn footer { margin-top: auto; }
#mn .mn-kick { font: 10px var(--f-px); letter-spacing: .3em; color: var(--mute); }
#mn h1 { margin: 0; font: 700 clamp(44px, 7vw, 84px)/1.05 "Noto Sans SC", var(--f-ui); letter-spacing: .16em; color: var(--g);
  text-shadow: 0 0 18px rgba(var(--g-rgb), .55), 0 0 2px rgba(216, 255, 232, .8); }
#mn .mn-en { font: clamp(15px, 1.8vw, 22px) var(--f-px); letter-spacing: .62em; color: rgba(198, 247, 216, .75); margin-top: 4px; }
#mn .mn-rule { height: 1px; width: min(520px, 80vw); margin-top: 14px; background: linear-gradient(90deg, var(--g), rgba(var(--g-rgb), 0)); box-shadow: 0 0 8px var(--g); }
#mn .mn-main { display: grid; grid-template-columns: minmax(260px, 380px) minmax(0, 400px); gap: 28px; align-items: start; }
#mn .mn-list { display: grid; gap: 8px; }
#mn .mn-it { position: relative; display: grid; grid-template-columns: 40px minmax(0, 1fr) auto; align-items: center; gap: 12px; text-align: left; min-height: 58px; padding: 8px 14px 8px 10px;
  background: linear-gradient(90deg, rgba(var(--pn-rgb), .82), rgba(var(--pn-rgb), .55)); border: 1px solid var(--line); border-radius: 6px; color: var(--text); transition: border-color .15s, background .15s, transform .15s; }
#mn .mn-it .ic { width: 26px; height: 26px; color: var(--g); justify-self: center; }
#mn .mn-it b { display: block; font: 700 17px/1.25 "Noto Sans SC", var(--f-ui); letter-spacing: .06em; }
#mn .mn-it b small { font: 10px var(--f-px); color: var(--mute); letter-spacing: .18em; margin-left: 10px; }
#mn .mn-it span { display: block; font-size: 12px; color: var(--mute); margin-top: 1px; }
#mn .mn-it kbd { font: 11px var(--f-ui); color: var(--mute); border: 1px solid var(--line); border-radius: 3px; padding: 0 5px; }
#mn .mn-it::before { content: ""; position: absolute; left: -1px; top: 10px; bottom: 10px; width: 3px; border-radius: 2px; background: var(--g); opacity: 0; box-shadow: 0 0 8px var(--g); transition: opacity .15s; }
#mn .mn-it:hover, #mn .mn-it:focus-visible, #mn .mn-it.on { border-color: var(--line-hi); background: linear-gradient(90deg, rgba(var(--g-rgb), .14), rgba(var(--pn-rgb), .6)); transform: translateX(4px); outline: none; }
#mn .mn-it.on::before, #mn .mn-it:focus-visible::before { opacity: 1; }
#mn .mn-it.on kbd { color: var(--g); border-color: var(--line-hi); }
#mn .mn-it[data-k="cont"] { border-color: rgba(var(--sel-rgb), .45); } #mn .mn-it[data-k="cont"] .ic { color: var(--sel); }
#mn .mn-info { position: relative; padding: 16px 18px; background: rgba(var(--pn-rgb), .78); border: 1px solid var(--line); border-radius: 6px; display: grid; gap: 10px; min-height: 150px; }
#mn .mn-info::before, #mn .mn-info::after { content: ""; position: absolute; width: 10px; height: 10px; border: 2px solid var(--g); }
#mn .mn-info::before { left: -1px; top: -1px; border-right: 0; border-bottom: 0; } #mn .mn-info::after { right: -1px; bottom: -1px; border-left: 0; border-top: 0; }
#mn .mn-info h2 { margin: 0; font: 11px var(--f-px); letter-spacing: .25em; color: var(--g); }
#mn .mn-info p { margin: 0; line-height: 1.75; font-family: "Noto Sans SC", var(--f-ui); }
#mn .mn-info dl { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 3px 14px; font-size: 12px; }
#mn .mn-info dt { color: var(--mute); } #mn .mn-info dd { margin: 0; color: var(--text); font-variant-numeric: tabular-nums; }
#mn .mn-pve { display: grid; gap: 16px; max-width: 980px; }
#mn .mn-pve h2 { margin: 0; font: 700 20px "Noto Sans SC", var(--f-ui); letter-spacing: .12em; display: flex; align-items: baseline; gap: 12px; }
#mn .mn-pve h2 small { font: 10px var(--f-px); color: var(--mute); letter-spacing: .25em; }
#mn .mn-lvs { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
#mn .mn-lv { --c: var(--g); position: relative; display: grid; gap: 10px; align-content: start; text-align: left; padding: 16px 16px 14px; min-height: 210px;
  background: linear-gradient(180deg, color-mix(in srgb, var(--c) 10%, transparent), rgba(var(--pn-rgb), .82) 60%); border: 1px solid color-mix(in srgb, var(--c) 35%, transparent); border-radius: 6px; color: var(--text); transition: transform .15s, box-shadow .15s, border-color .15s; }
#mn .mn-lv:hover, #mn .mn-lv:focus-visible, #mn .mn-lv.on { border-color: var(--c); box-shadow: 0 0 22px color-mix(in srgb, var(--c) 35%, transparent); transform: translateY(-3px); outline: none; }
#mn .mn-lv b { font: 700 24px "Noto Sans SC", var(--f-ui); color: var(--c); letter-spacing: .12em; display: flex; align-items: baseline; justify-content: space-between; }
#mn .mn-lv b small { font: 11px var(--f-px); letter-spacing: .25em; color: var(--mute); }
#mn .mn-lv > span { font-size: 13px; font-family: "Noto Sans SC", var(--f-ui); }
#mn .mn-lv dl { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 3px 12px; font-size: 12px; }
#mn .mn-lv dt { color: var(--mute); } #mn .mn-lv dd { margin: 0; display: flex; gap: 2px; align-items: center; }
#mn .mn-lv dd i { display: inline-block; width: 6px; height: 10px; background: var(--c); opacity: .85; border-radius: 1px; }
#mn .mn-lv dd i.o { opacity: .15; }
#mn .mn-lv .go2 { justify-self: start; margin-top: 4px; font-size: 12px; color: var(--c); border: 1px solid var(--c); border-radius: 3px; padding: 2px 10px; opacity: .55; }
#mn .mn-lv.on .go2, #mn .mn-lv:hover .go2 { opacity: 1; }
#mn .mn-back { justify-self: start; background: transparent; border: 1px solid var(--line); border-radius: 4px; padding: 6px 16px; color: var(--text); min-height: 36px; }
#mn .mn-back:hover, #mn .mn-back:focus-visible { border-color: var(--line-hi); outline: none; }
#mn footer { display: flex; justify-content: space-between; gap: 12px; font-size: 11px; color: var(--mute); flex-wrap: wrap; }
#mn footer .mn-adv { flex-basis: 100%; text-align: center; opacity: .8; }
#mn footer kbd { border: 1px solid var(--line); border-radius: 3px; padding: 0 4px; font: 10px var(--f-ui); color: var(--text); }
#mn .mn-toast { position: fixed; left: 50%; bottom: 60px; transform: translateX(-50%); background: rgba(20, 12, 3, .92); border: 1px solid var(--amber); color: #ffe2a3; padding: 6px 16px; border-radius: 4px; font-size: 13px; pointer-events: none; }
#btnMenu .ic { width: 18px; height: 18px; vertical-align: middle; }
/* 设置面板 */
#mnSet { position: fixed; inset: 0; z-index: 46; display: grid; place-items: center; background: rgba(var(--bg-rgb), .7); padding: 16px; }
#mnSet .ms-win { width: min(600px, 100%); max-height: calc(100vh - 32px); overflow-y: auto; box-sizing: border-box; background: rgba(4, 11, 8, .97); border: 1px solid var(--line-hi); border-radius: 8px;
  box-shadow: 0 0 0 4px rgba(var(--g-rgb), .06), 0 0 40px rgba(var(--g-rgb), .16); padding: 16px 20px 18px; display: grid; gap: 6px; scrollbar-width: thin; }
#mnSet header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
#mnSet h2 { margin: 0; font: 700 20px "Noto Sans SC", var(--f-ui); color: var(--g); letter-spacing: .12em; display: flex; gap: 10px; align-items: baseline; }
#mnSet h2 small { font: 10px var(--f-px); color: var(--mute); letter-spacing: .25em; }
#mnSet .ms-x { background: transparent; border: 1px solid var(--line); border-radius: 5px; width: 34px; height: 32px; font-size: 18px; line-height: 1; color: var(--text); }
#mnSet .ms-x:hover { border-color: var(--enemy); color: var(--enemy); }
#mnSet h3 { margin: 10px 0 2px; font: 10px var(--f-px); letter-spacing: .25em; color: var(--g); display: flex; align-items: center; gap: 8px; }
#mnSet h3::after { content: ""; flex: 1; height: 1px; background: var(--line); }
#mnSet .ms-row { display: grid; grid-template-columns: 132px minmax(0, 1fr) 54px; align-items: center; gap: 12px; min-height: 36px; }
#mnSet .ms-row > label, #mnSet .ms-row > span:first-child { font-family: "Noto Sans SC", var(--f-ui); font-size: 13px; }
#mnSet .ms-row output { text-align: right; font-variant-numeric: tabular-nums; color: var(--g); font-size: 12px; }
#mnSet input[type=range] { -webkit-appearance: none; appearance: none; width: 100%; height: 22px; background: transparent; margin: 0; cursor: pointer; }
#mnSet input[type=range]::-webkit-slider-runnable-track { height: 4px; border-radius: 2px; background: linear-gradient(90deg, var(--g) var(--v, 50%), rgba(var(--g-rgb), .14) var(--v, 50%)); }
#mnSet input[type=range]::-moz-range-track { height: 4px; border-radius: 2px; background: rgba(var(--g-rgb), .14); }
#mnSet input[type=range]::-moz-range-progress { height: 4px; border-radius: 2px; background: var(--g); }
#mnSet input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 16px; height: 16px; margin-top: -6px; border-radius: 50%; background: var(--bg); border: 2px solid var(--g); box-shadow: 0 0 8px rgba(var(--g-rgb), .6); }
#mnSet input[type=range]::-moz-range-thumb { width: 12px; height: 12px; border-radius: 50%; background: var(--bg); border: 2px solid var(--g); }
#mnSet input[type=range]:focus-visible { outline: 2px solid var(--sel); outline-offset: 2px; }
#mnSet .ms-seg { display: flex; border: 1px solid var(--line); border-radius: 5px; overflow: hidden; justify-self: start; }
#mnSet .ms-seg button { background: transparent; border: 0; padding: 5px 14px; color: var(--mute); min-height: 30px; }
#mnSet .ms-seg button + button { border-left: 1px solid var(--line); }
#mnSet .ms-seg button[aria-pressed="true"] { color: var(--g); background: rgba(var(--g-rgb), .14); }
#mnSet .ms-file { display: flex; gap: 6px; justify-self: start; }
#mnSet .ms-fbtn, #mnSet .ms-fclr { border: 1px solid var(--line); border-radius: 5px; padding: 4px 12px; color: var(--g); background: rgba(var(--g-rgb), .06); cursor: pointer; font-size: 13px; min-height: 30px; display: inline-flex; align-items: center; }
#mnSet .ms-fclr { color: var(--mute); background: transparent; }
#mnSet .ms-fbtn:focus-within { outline: 2px solid var(--g); }
#mnSet .ms-fname { color: var(--mute); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#mnSet .ms-sw { justify-self: start; position: relative; width: 46px; height: 24px; border-radius: 12px; border: 1px solid var(--line); background: rgba(255, 255, 255, .04); padding: 0; }
#mnSet .ms-sw::after { content: ""; position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%; background: var(--mute); transition: left .15s, background .15s; }
#mnSet .ms-sw[aria-checked="true"] { border-color: var(--line-hi); background: rgba(var(--g-rgb), .16); }
#mnSet .ms-sw[aria-checked="true"]::after { left: 25px; background: var(--g); box-shadow: 0 0 8px var(--g); }
#mnSet .ms-note { grid-column: 2 / -1; font-size: 11px; color: var(--mute); margin-top: -6px; }
#mnSet .ms-cred { margin: 4px 0 6px; padding-left: 18px; font-size: 11px; line-height: 1.6; color: var(--mute); } #mnSet .ms-cred a { color: var(--g); }
#mnSet footer { display: flex; justify-content: space-between; margin-top: 12px; gap: 10px; }
#mnSet footer button { background: transparent; border: 1px solid var(--line); border-radius: 4px; padding: 6px 16px; color: var(--text); min-height: 34px; }
#mnSet footer .go { border-color: var(--g); color: var(--g); }
#mnSet .ms-about { margin-top: 12px; text-align: center; font-size: 11px; color: var(--mute); }
#mnSet .ms-about button { background: none; border: 0; padding: 2px 4px; color: var(--mute); text-decoration: underline; text-underline-offset: 3px; }
#mnSet .ms-about button:hover { color: var(--g); }
@media (max-width: 900px) {
  #mn .mn-main { grid-template-columns: minmax(0, 1fr); }
  #mn .mn-info { display: none; }
  #mn .mn-lv { min-height: 0; }
}
@media (max-width: 640px) { #mn .mn-lvs { grid-template-columns: minmax(0, 1fr); } }
/* 横屏手机等矮屏：标题收小，菜单两列，难度卡片紧凑 */
@media (max-height: 560px) {
  #mn .mn-wrap { padding-top: 14px; padding-bottom: 10px; gap: 14px; }
  #mn .mn-kick { display: none; } #mn h1 { font-size: 34px; } #mn .mn-en { font-size: 13px; margin-top: 0; } #mn .mn-rule { margin-top: 6px; }
  #mn .mn-list { grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 6px; }
  #mn .mn-it { min-height: 46px; padding-top: 4px; padding-bottom: 4px; } #mn .mn-it b { font-size: 15px; } #mn .mn-it span { font-size: 11px; }
  #mn .mn-pve { gap: 10px; } #mn .mn-pve h2 { font-size: 16px; }
  #mn .mn-lv { padding: 8px 12px 10px; gap: 5px; min-height: 0; } #mn .mn-lv b { font-size: 18px; } #mn .mn-lv > span { font-size: 12px; }
  #mn .mn-lv dl { font-size: 11px; gap: 1px 10px; } #mn .mn-lv .go2 { display: none; }
  #mn .mn-back { min-height: 30px; padding: 3px 14px; }
}
@media (pointer: coarse) { #mn footer .mn-keys { display: none; } }   /* 手机、平板：没有键盘，不显示按键提示 */
@media (max-width: 560px) {
  #mn .mn-wrap { padding: 32px 16px 16px; gap: 20px; }
  #mn .mn-en { letter-spacing: .4em; }
  #mn .mn-it { min-height: 54px; }
  #mn footer .mn-keys { display: none; }
  #mn .mn-pve { gap: 12px; } #mn .mn-lvs { gap: 8px; }
  #mn .mn-lv { padding: 10px 14px 12px; gap: 6px; } #mn .mn-lv b { font-size: 20px; } #mn .mn-lv > span { font-size: 12px; }
  #mn .mn-lv dl { grid-template-columns: auto 1fr auto 1fr; gap: 3px 8px; font-size: 11px; } #mn .mn-lv dd i { width: 5px; height: 9px; }
  #mn .mn-lv .go2 { display: none; }
  #mnSet { padding: 0; } #mnSet .ms-win { max-height: 100vh; height: 100%; border-radius: 0; border: 0; padding: 14px 16px; }
  #mnSet .ms-row { grid-template-columns: 96px minmax(0, 1fr) 44px; gap: 8px; }
}
@media (prefers-reduced-motion: reduce) { #mn .mn-it, #mn .mn-lv { transition: none; } }
/* 写实画面：去扫描线与霓虹辉光，标题白字压暗影 */
:root[data-look="real"] #mn { background: linear-gradient(90deg, rgba(var(--bg-rgb), .86), rgba(var(--bg-rgb), .52) 55%, rgba(var(--bg-rgb), .25)), radial-gradient(ellipse at 50% 50%, transparent 55%, rgba(0, 0, 0, .5)); }
:root[data-look="real"] #mn h1 { color: #f2f5f7; text-shadow: 0 2px 14px rgba(0, 0, 0, .6); }
:root[data-look="real"] #mn .mn-en { color: rgba(230, 237, 242, .7); }
:root[data-look="real"] #mn .mn-rule { box-shadow: none; }
:root[data-look="real"] #mn .mn-it::before { box-shadow: none; }`;

function mnBuild() {
  if (MENU.el) return MENU.el;
  const st = document.createElement('style'); st.id = 'mnCss'; st.textContent = MN_CSS; document.head.appendChild(st);
  const el = MENU.el = document.createElement('div');
  el.id = 'mn'; el.className = 'mn-layer'; el.hidden = true;
  el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', '主菜单');
  el.innerHTML = `<div class="mn-wrap">
  <header><div class="mn-kick">AMPHIBIOUS ASSAULT SANDTABLE // v6</div><h1 id="mnT">暗剑</h1><div class="mn-en" id="mnE">DARKSWORD</div><div class="mn-rule"></div></header>
  <div class="mn-views">
    <div class="mn-main"><nav class="mn-list" role="menu" aria-label="主菜单">${MN_ITEMS.map(([k, n, en, d]) =>
    `<button type="button" role="menuitem" class="mn-it" data-k="${k}">${mnSvg(k)}<div><b>${n}<small>${en}</small></b><span>${d}</span></div><kbd></kbd></button>`).join('')}</nav>
    <aside class="mn-info" aria-live="polite"></aside></div>
    <div class="mn-pve" hidden><h2>选择守军难度<small>SELECT DIFFICULTY</small></h2><div class="mn-lvs">${MN_LV.map(([k, n, en, d, c]) =>
    `<button type="button" class="mn-lv" data-lv="${k}" style="--c:${c}"><b>${n}<small>${en}</small></b><span>${d}</span><dl>${mnLvStats(k)}</dl><span class="go2">出发 ▸</span></button>`).join('')}</div>
    <button type="button" class="mn-back">‹ 返回</button></div>
  </div>
  <footer><span class="mn-keys"><kbd>↑</kbd><kbd>↓</kbd> 选择 · <kbd>Enter</kbd> 确认 · <kbd>Esc</kbd> 返回</span><span id="mnSeed"></span>${typeof PLAT === 'object' && PLAT.android ? `<span class="mn-adv">${PLAT_ADVICE}</span>` : ''}</footer></div>`;
  document.body.appendChild(el);
  const list = el.querySelector('.mn-list');
  list.addEventListener('click', e => { const b = e.target.closest('.mn-it'); if (b) mnAct(b.dataset.k); });
  list.addEventListener('pointerover', e => { const b = e.target.closest('.mn-it'); if (b && !b.classList.contains('on')) mnHi(b.dataset.k, true); });
  list.addEventListener('focusin', e => { const b = e.target.closest('.mn-it'); if (b) mnHi(b.dataset.k, false); });
  const lvs = el.querySelector('.mn-lvs');
  lvs.addEventListener('click', e => { const b = e.target.closest('.mn-lv'); if (b) { mnSfx('ok'); startPvE(b.dataset.lv); } });
  lvs.addEventListener('pointerover', e => { const b = e.target.closest('.mn-lv'); if (b) mnLvHi(b); });
  lvs.addEventListener('focusin', e => { const b = e.target.closest('.mn-lv'); if (b) mnLvHi(b); });
  el.querySelector('.mn-back').addEventListener('click', () => mnView('main'));
  return el;
}

// 难度卡片上的兵力条（取 DIFF，相对地狱档）
function mnLvStats(k) {
  const D = DIFF[k], H = DIFF.hell;
  return [['滩头碉堡', 'beachBunkers'], ['岸防重炮', 'coastal'], ['榴弹炮', 'arty'], ['迫击炮', 'mortars'], ['机动预备队', 'reserves'], ['增援波次', 'waves']]
    .map(([n, f]) => { const v = Math.round(D[f] / H[f] * 8); return `<dt>${n}</dt><dd>${Array.from({ length: 8 }, (_, i) => `<i class="${i < v ? '' : 'o'}"></i>`).join('')}</dd>`; }).join('');
}

const mnItems = () => [...MENU.el.querySelectorAll('.mn-it')].filter(b => !b.hidden);
function mnHi(k, snd) {
  for (const b of MENU.el.querySelectorAll('.mn-it')) b.classList.toggle('on', b.dataset.k === k);
  if (snd) mnSfx('tick');
  const info = MENU.el.querySelector('.mn-info'), it = MN_ITEMS.find(i => i[0] === k);
  if (!it) return;
  let body = '';
  if (k === 'cont' && S) {
    const pts = S.points || [], own = pts.filter(p => p.owner === 'p').length, crew = typeof vehCrewOf === 'function' ? vehCrewOf('p') : 0, men = (S.teams || []).filter(q => q.side === 'p').reduce((a, q) => a + q.men.length, 0) + crew;
    body = `<p>返回当前战局，${S.phase === 'battle' ? '推演从暂停处继续' : S.phase === 'deploy' ? '继续排兵布阵' : '继续编辑部署'}。</p><dl><dt>模式</dt><dd>${S.lv && S.lv.isle ? `海岛战役「${S.lv.nm}」` : S.lv ? `闯关 · 第 ${S.lv.n} 关「${S.lv.nm}」` : S.mode === 'sandbox' ? (S.role === 'spectate' ? '沙盒 · 观战' : '沙盒') : '战役 · ' + (DIFF[S.level] ? DIFF[S.level].name : S.level)}</dd><dt>作战用时</dt><dd>${fmtT(S.t)}</dd><dt>${S.role === 'spectate' ? '进攻方据点' : '我方据点'}</dt><dd>${own} / ${pts.length}</dd><dt>在场兵力</dt><dd>${men} 人${crew ? `（含车组 ${crew} 人）` : ''}</dd></dl>`;
  } else if (k === 'pve') { const P = typeof lvProg === 'function' ? lvProg() : null, done = P && P.done ? P.done.length : 0; body = `<p>三章十关，按真实作战顺序递进：海战夺取制海权 → 强行登陆夺取登陆场 → 从滩头向纵深推进。每关给定预算，你自己挑兵种、布置进攻兵力；守军由 AI 按本关风格布防，你只拿到一份有误差的情报。</p><dl><dt>进度</dt><dd>已通过 ${done} / ${typeof LV_DEFS === 'object' ? LV_DEFS.length : 10} 关</dd></dl>`; }
  else if (k === 'isle') body = `<p>架空的热带海岛「棕榈岛」（印度洋风格，岛名、地名、设施与守军都是虚构的）。舰队在南边大洋上集结，横渡约 8 公里：先击退守方舰队、顶住岸舰导弹与岛上航空兵，夺取制海权，再强行登岛，同一张图打完。</p><dl><dt>守方</dt><dd>固定部署</dd><dt>我方</dt><dd>按预算 ${typeof ISLE === 'object' ? ISLE.p : 17000} 点自己编成</dd><dt>胜利条件</dt><dd>控制指挥所与七成据点分值 30 秒</dd></dl>`;
  else if (k === 'sbx') body = `<p>在同一张海岸地图上自由部署岸防与进攻部队，按预算对抗；可以观战 AI 对 AI，也可以亲自指挥进攻方。</p><dl><dt>状态</dt><dd>${typeof openSandbox === 'function' ? '可用' : '模块加载中'}</dd></dl>`;
  else if (k === 'cdx') { const n = typeof CATALOG !== 'undefined' && Array.isArray(CATALOG) ? CATALOG.length : 0; body = `<p>查看全部兵力：步兵、装甲、火炮、航空、舰艇、工事与支援单位的属性条、定位与克制关系。</p><dl><dt>收录</dt><dd>${n ? n + ' 种单位' : '目录加载中'}</dd></dl>`; }
  else if (k === 'set') body = `<p>主音量、音乐、音效、无线电；画面风格（写实 / 黑绿 / 数码）、辉光、画质、3D 渲染距离、屏幕震动；开场转场；AI 指挥官通讯详略。</p><dl><dt>当前</dt><dd>主音量 ${Math.round(SETTINGS.master * 100)}% · 画质${SETTINGS.quality === 'low' ? '低' : '高'}</dd></dl>`;
  else if (k === 'quit') body = `<p>关闭暗剑。设置、闯关进度和部署存档都存在本机，下次打开还在。</p>${mnCanResume() ? '<p>打到一半的这一局不会保存。</p>' : ''}`;
  info.innerHTML = `<h2>${it[2]}</h2>${body}`;
}
function mnLvHi(b) {
  if (b.classList.contains('on')) return;
  for (const x of MENU.el.querySelectorAll('.mn-lv')) x.classList.toggle('on', x === b);
  mnSfx('tick');
}

function mnFocus() {
  if (!MENU.el || !MENU.open) return;
  const coarse = matchMedia('(pointer: coarse)').matches;
  if (MENU.view === 'pve') {
    const b = MENU.el.querySelector(`.mn-lv[data-lv="${U.level}"]`) || MENU.el.querySelector('.mn-lv');
    mnLvHi(b); if (!coarse) b.focus({ preventScroll: true });
  } else {
    const items = mnItems(), b = items.find(x => x.classList.contains('on')) || items[0];
    if (b) { mnHi(b.dataset.k, false); if (!coarse) b.focus({ preventScroll: true }); }
  }
}

function mnView(v, quiet) {
  const back = MENU.view === 'pve' && v === 'main';
  MENU.view = v;
  MENU.el.querySelector('.mn-main').hidden = v !== 'main';
  MENU.el.querySelector('.mn-pve').hidden = v !== 'pve';
  if (back && !quiet) mnSfx('back');
  mnFocus();
}

const mnCanResume = () => !!(MENU.game && S && !S.over);

// 显示开始界面；从对局中打开时暂停推演
function showMenu(view) {
  if (typeof document === 'undefined') return;
  const el = mnBuild();
  if (!MENU.open && S && S.phase === 'battle' && !S.over && !S.paused) { S.paused = true; MENU.pausedBy = true; }
  MENU.open = true; el.hidden = false;
  document.body.classList.add('mn-open');
  if (typeof U === 'object') { U.tool = null; U.box = null; U.down = null; U.fdrag = null; }
  if (typeof KEYS === 'object') KEYS.clear();
  const cont = el.querySelector('[data-k="cont"]');
  cont.hidden = !mnCanResume();
  mnItems().forEach((b, i) => { b.querySelector('kbd').textContent = i + 1; });
  for (const b of el.querySelectorAll('.mn-it')) b.classList.remove('on');
  const first = cont.hidden ? el.querySelector(`[data-k="${MENU.last}"]`) || mnItems()[0] : cont;
  first.classList.add('on');
  el.querySelector('#mnSeed').textContent = [typeof window !== 'undefined' && window.DS_BUILD ? `版本 ${window.DS_BUILD}` : '', S ? `SEED ${S.seed}` : ''].filter(Boolean).join(' · ');
  typeof lyPush === 'function' && lyPush(el, mnKey);
  if (typeof decode === 'function') { decode(el.querySelector('#mnT'), '暗剑', 700); decode(el.querySelector('#mnE'), 'DARKSWORD', 1000); }
  mnView(view === 'pve' ? 'pve' : 'main', true);
  if (typeof updateHud === 'function' && typeof $ === 'function' && $('clock')) updateHud();
}

function mnHide() {
  if (!MENU.el) return;
  MENU.open = false; MENU.el.hidden = true;
  document.body.classList.remove('mn-open');
  typeof lyPop === 'function' && lyPop(MENU.el);
}

function mnResume() {
  mnHide();
  if (MENU.pausedBy && S && S.phase === 'battle' && !S.over) S.paused = false;
  MENU.pausedBy = false;
  updateHud();
}

function mnAct(k) {
  if (k !== 'cont') MENU.last = k;
  if (k === 'cont') { mnSfx('ok'); mnResume(); }
  else if (k === 'pve') { mnSfx('open'); if (typeof lvOpen === 'function') { mnHide(); lvOpen(); } else mnView('pve'); }   // 闯关（levels.js）：关卡列表 → 给预算自己布兵
  else if (k === 'sbx') mnSandbox();
  else if (k === 'isle') { if (typeof isleStart === 'function') { mnSfx('ok'); try { isleStart(); } catch (e) { console.error('isleStart', e); } } else mnToast('海岛战役模块尚未就绪'); }
  else if (k === 'cdx') { if (typeof openCodex === 'function') openCodex(); else mnToast('图鉴模块尚未就绪'); }
  else if (k === 'set') openSettings();
  else if (k === 'quit') mnQuit();
}
// 退出游戏：有打到一半的对局时先提示一次，三秒内再点才退出（对局不存档）
function mnQuit() {
  if (mnCanResume() && performance.now() - PLAT.quitT > 3000) { PLAT.quitT = performance.now(); mnSfx('tick'); mnToast('这一局不会保存——再点一次「退出游戏」就退出'); return; }
  mnSfx('back'); platQuit();
}

function mnToast(msg) {
  let t = MENU.el.querySelector('.mn-toast');
  if (!t) { t = document.createElement('div'); t.className = 'mn-toast'; t.setAttribute('role', 'status'); MENU.el.appendChild(t); }
  t.textContent = msg; t.hidden = false;
  clearTimeout(MENU.toastT); MENU.toastT = setTimeout(() => { t.hidden = true; }, 2200);
}

// 战役：新地图 → 转场 → 作战简报 → 部署
function startPvE(level) {
  level = DIFF[level] ? level : 'hard';
  mnHide();
  MENU.pausedBy = false; MENU.game = true; MENU.last = 'pve';
  U.level = level;
  if (S && S.mode === 'sandbox' && typeof closeSandbox === 'function') try { closeSandbox(); } catch (e) { console.error('closeSandbox', e); }
  restart(false);
  S.mode = 'pve'; S.role = 'spectate'; S.ctl = 'p';   // 战役：舰船、航母、各排由 AI 执行，玩家在编队面板给攻方的师 / 团 / 营下令（thpanel.js）
  mnFrameDeploy();
  $('brief').hidden = true;
  updateHud();
  playIntro(() => { if (S.phase === 'deploy' && !S.briefed) $('brief').hidden = false; updateHud(); });
}

// 部署镜头：同时看到海滩与集结海域的舰队；上下避开压在画布上的 HUD（按实际布局测量，桌面与手机通用）
function mnFrameDeploy() {
  const bs = TER.beaches.length ? TER.beaches : [{ cx: W / 2 }], cm = bs.reduce((a, b) => a + coastAt(b.cx), 0) / bs.length;
  const { head, foot } = mnInsets(), top = cm - 70, bot = STAGING_Y + 210;
  const x0 = Math.min(...bs.map(b => b.x0 ?? b.cx)) - 60, x1 = Math.max(...bs.map(b => b.x1 ?? b.cx)) + 60;   // 横向也要装下最外侧两个滩头
  CAM.z = clamp(Math.min((CAM.vh - head - foot) / (bot - top), CAM.vw / Math.max(1, x1 - x0)), CAM.fit, CAM.fit * 2.4);
  CAM.x = (x0 + x1) / 2; CAM.y = top + (CAM.vh / 2 - head) / CAM.z;
  camClamp();
}
// 画布上方 / 下方被 HUD 浮层遮住的高度（H-HOUR 按钮此时还隐藏，临时显示量一下）
function mnInsets() {
  const cv = R.cv, dep = $('deploy');
  if (!cv || !cv.getBoundingClientRect().height) return { head: 60, foot: 0 };
  const c = cv.getBoundingClientRect(), was = dep ? dep.hidden : true;
  if (dep) dep.hidden = false;
  let head = 0, foot = 0;
  for (const id of ['topr', 'feed', 'objs', 'deploy', 'bottom']) {
    const el = $(id), r = el && el.getBoundingClientRect();
    if (!r || !r.width || !r.height || r.bottom <= c.top || r.top >= c.bottom) continue;
    if (r.top + r.bottom < 2 * c.top + c.height) head = Math.max(head, r.bottom - c.top); else foot = Math.max(foot, c.bottom - r.top);
  }
  if (dep) dep.hidden = was;
  return { head: Math.min(head + 14, c.height * .45), foot: Math.min(foot + 6, c.height * .45) };
}

// 沙盒：先建沙盒地图，再在其上播放转场（转场显示的就是这张地图）
function mnSandbox() {
  if (typeof openSandbox !== 'function') { mnToast('沙盒模块尚未就绪'); return; }
  mnSfx('ok');
  mnHide();
  MENU.pausedBy = false; MENU.last = 'sbx';
  $('brief').hidden = true; $('end').hidden = true;
  CAM.x = W / 2; CAM.y = H / 2; CAM.z = CAM.fit * 1.4; camClamp();
  try { openSandbox(); } catch (e) { console.error('openSandbox', e); }
  MENU.game = true;
  playIntro(() => { if (typeof updateHud === 'function') updateHud(); });
}

function mnKey(e) {
  const k = e.key;
  if (MENU.view === 'pve') {
    const cards = [...MENU.el.querySelectorAll('.mn-lv')], i = Math.max(0, cards.findIndex(b => b.classList.contains('on')));
    if (k === 'Escape' || k === 'Backspace') { e.preventDefault(); mnView('main'); }
    else if (['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'].includes(k)) {
      e.preventDefault();
      const j = clamp(i + (k === 'ArrowLeft' || k === 'ArrowUp' ? -1 : 1), 0, cards.length - 1);
      mnLvHi(cards[j]); cards[j].focus({ preventScroll: true });
    } else if (/^[1-3]$/.test(k)) { e.preventDefault(); mnSfx('ok'); startPvE(cards[+k - 1].dataset.lv); }
    else if (k === 'Enter' && !e.target.closest('.mn-lv, .mn-back')) { e.preventDefault(); mnSfx('ok'); startPvE(cards[i].dataset.lv); }
    return;
  }
  const items = mnItems(), i = Math.max(0, items.findIndex(b => b.classList.contains('on')));
  if (k === 'ArrowDown' || k === 'ArrowUp') {
    e.preventDefault();
    const b = items[(i + (k === 'ArrowDown' ? 1 : items.length - 1)) % items.length];
    mnHi(b.dataset.k, true); b.focus({ preventScroll: true });
  } else if (k === 'Escape') { e.preventDefault(); if (mnCanResume()) { mnSfx('back'); mnResume(); } }
  else if (/^[1-9]$/.test(k) && items[+k - 1]) { e.preventDefault(); mnHi(items[+k - 1].dataset.k, false); mnAct(items[+k - 1].dataset.k); }
  else if (k === 'Enter' && !e.target.closest('button')) { e.preventDefault(); mnAct(items[i].dataset.k); }
}

// —— 设置面板 ——
const MN_SET = [
  ['音量', 'VOLUME', [['master', '主音量', 'vol'], ['music', '音乐', 'vol'], ['musicStyle', '背景音乐', [['march', '进行曲'], ['custom', '我的歌'], ['ambient', '氛围']], '进行曲：明亮的军乐，战况越激烈编制越全；我的歌：用下面导入的歌'], ['bgm', '导入音乐', 'file', '选一首你设备上的歌（mp3 / m4a / ogg / wav），循环播放；只保存在这台设备上'], ['sfx', '音效', 'vol'], ['radio', '无线电通话', 'vol']]],
  ['画面', 'DISPLAY', [...(typeof platCanFs === 'function' && platCanFs() ? [['fs', '全屏', 'sw', PLAT.desk ? 'F11 或 Alt+Enter 也能切换，下次打开照此' : '按 Esc 退出全屏']] : []), ['look', '画面风格', [['real', '写实'], ['green', '黑绿'], ['matrix', '数码']], '写实：真实的天空、地表、海面与光影（默认）；黑绿：写实的地形与模型，黑底绿色磷光、发光轮廓（敌方红）；数码：原来的字符矩阵风格'], ['rain', '数码雨密度', 'rain'], ['bloom', '辉光强度', 'pct'], ['quality', '画质', [['high', '高'], ['low', '低']]], ['rdist', '3D 渲染距离', 'rd', '3D 里能看多远（远处的地形、建筑、部队模型）；调远更耗性能。3D 中也可按 [ ] 键调'], ['extMdl', '外部精细模型', 'sw', '3D 里的树木、岩石、楼房、机场设施和舰船换成免费可商用的真实模型（作者与授权见下方「素材致谢」）；关掉用游戏自己画的模型'], ['shake', '屏幕震动', 'sw'], ['front', '战线与态势图形', 'sw', '显示双方战线、无人地带、空隙、突击群调整线']]],
  ['流程', 'FLOW', [['intro', '开场转场', 'sw', '从国家全图推近到战场，约 7 秒']]],
  ['AI 指挥官通讯', 'COMMANDER CHAT', [['chat', '通讯详略', [['brief', '简要'], ['normal', '标准'], ['verbose', '详细']]], ['enemyChat', '显示敌方（截获）', 'sw', '战役中敌方通话以「截获」形式延迟出现']]]
];
const mnFmt = (k, v) => k === 'rdist' ? (v < .9 ? '近 ' : v <= 1.1 ? '标准 ' : v < 2.5 ? '远 ' : '极远 ') + (+v).toFixed(2).replace(/0$/, '') + '×' : k === 'rain' ? (v <= 0 ? '关' : v < .45 ? '淡 ' : '强 ') + (v > 0 ? Math.round(v * 100) + '%' : '') : Math.round(v * 100) + '%';

function mnSetBuild() {
  if (MENU.set) return MENU.set;
  mnBuild();
  const el = MENU.set = document.createElement('div');
  el.id = 'mnSet'; el.className = 'mn-layer'; el.hidden = true;
  el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', '设置');
  const row = ([k, n, ty, note]) => {
    let ctl;
    if (ty === 'file') ctl = `<div class="ms-file"><label class="ms-fbtn"><input type="file" accept="audio/*" data-file="${k}" hidden>选择文件…</label><button type="button" class="ms-fclr" data-fclr="${k}">清除</button></div><span class="ms-fname" data-fn="${k}"></span>`;
    else if (ty === 'sw') ctl = `<button type="button" class="ms-sw" role="switch" data-k="${k}" aria-label="${n}"></button><span></span>`;
    else if (Array.isArray(ty)) ctl = `<div class="ms-seg" role="group" aria-label="${n}">${ty.map(([v, l]) => `<button type="button" data-k="${k}" data-v="${v}">${l}</button>`).join('')}</div><span></span>`;
    else ctl = `<input type="range" id="ms-${k}" data-k="${k}" ${ty === 'rd' ? 'min="0.5" max="4" step="0.25"' : 'min="0" max="1" step="0.05"'} aria-label="${n}"><output for="ms-${k}" data-o="${k}"></output>`;
    return `<div class="ms-row"${k === 'rain' ? ' data-only="matrix"' : k === 'bloom' ? ' data-only="glow"' : ''}><label ${ty === 'vol' || ty === 'pct' || ty === 'rain' || ty === 'rd' ? `for="ms-${k}"` : ''}>${n}</label>${ctl}${note ? `<span class="ms-note">${note}</span>` : ''}</div>`;
  };
  el.innerHTML = `<div class="ms-win"><header><h2>设置<small>SETTINGS</small></h2><button type="button" class="ms-x" aria-label="关闭" title="关闭（Esc）">×</button></header>
    ${MN_SET.map(([h, en, rows]) => `<h3>${h} · ${en}</h3>${rows.map(row).join('')}`).join('')}
    ${typeof v3imCredits === 'function' ? `<h3>素材致谢 · CREDITS</h3><ul class="ms-cred">${v3imCredits()}</ul>` : ''}
    <footer><button type="button" class="ms-reset">恢复默认</button><button type="button" class="go ms-ok">完成</button></footer>
    <div class="ms-about">${typeof window !== 'undefined' && window.DS_BUILD ? `版本 ${window.DS_BUILD} · ` : ''}<button type="button" data-doc="terms">用户协议</button> · <button type="button" data-doc="privacy">隐私政策</button> · <button type="button" data-doc="credits">素材署名</button></div></div>`;
  document.body.appendChild(el);
  el.addEventListener('input', e => { const i = e.target.closest('input[type=range]'); if (i) { setSetting(i.dataset.k, +i.value); mnSetSync(); } });
  el.addEventListener('change', async e => {
    const f = e.target.closest('input[type=file]');
    if (f) {   // 导入背景音乐
      const fn = el.querySelector('[data-fn="bgm"]'), file = f.files && f.files[0];
      if (!file || typeof auBgmImport !== 'function') return;
      fn.textContent = '正在载入…';
      const r = await auBgmImport(file);
      f.value = '';
      if (r.ok) { setSetting('musicStyle', 'custom'); fn.textContent = `♪ ${auBgmName()}${r.saved ? '' : '（本次有效，没能存到这台设备上）'}`; }
      else fn.textContent = r.why;
      mnSetSync();
      return;
    }
    const i = e.target.closest('input[type=range]'); if (i && typeof auTest === 'function') auTest(i.dataset.k);
  });
  el.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.doc) { if (typeof platDoc === 'function') platDoc(b.dataset.doc); return; }   // 两份协议（platform.js）
    if (b.dataset.fclr) { if (typeof auBgmForget === 'function') auBgmForget().then(mnSetSync); if (SETTINGS.musicStyle === 'custom') setSetting('musicStyle', 'march'); }
    else if (b.classList.contains('ms-sw')) { if (b.dataset.k === 'fs') platSetFs(!platFs()); else setSetting(b.dataset.k, !SETTINGS[b.dataset.k]); }   // 全屏归外壳 / 浏览器管，不进 SETTINGS
    else if (b.dataset.v) setSetting(b.dataset.k, b.dataset.v);
    else if (b.classList.contains('ms-reset')) resetSettings();
    else if (b.classList.contains('ms-x') || b.classList.contains('ms-ok')) { closeSettings(); return; }
    mnSetSync();
  });
  el.addEventListener('pointerdown', e => { if (e.target === el) closeSettings(); });
  return el;
}

function mnSetSync() {
  const el = MENU.set;
  for (const i of el.querySelectorAll('input[type=range]')) {
    const v = SETTINGS[i.dataset.k];
    if (document.activeElement !== i || +i.value !== v) i.value = v;
    i.style.setProperty('--v', (v - +i.min) / ((+i.max - +i.min) || 1) * 100 + '%');
    el.querySelector(`[data-o="${i.dataset.k}"]`).textContent = mnFmt(i.dataset.k, v);
  }
  for (const b of el.querySelectorAll('.ms-sw')) b.setAttribute('aria-checked', b.dataset.k === 'fs' ? platFs() : !!SETTINGS[b.dataset.k]);
  for (const b of el.querySelectorAll('.ms-seg button')) b.setAttribute('aria-pressed', SETTINGS[b.dataset.k] === b.dataset.v);
  const fn = el.querySelector('[data-fn="bgm"]');
  if (fn && fn.textContent !== '正在载入…') fn.textContent = typeof auBgmName === 'function' && auBgmName() ? `♪ ${auBgmName()}` : '还没有导入';
}

function openSettings() {
  if (typeof document === 'undefined') return;
  const el = mnSetBuild();
  mnSetSync();
  el.hidden = false;
  typeof lyPush === 'function' && lyPush(el, e => { if (e.key === 'Escape') { e.preventDefault(); closeSettings(); } });
  mnSfx('open');
  if (!matchMedia('(pointer: coarse)').matches) el.querySelector('input').focus({ preventScroll: true });
}
function closeSettings() {
  if (!MENU.set || MENU.set.hidden) return;
  MENU.set.hidden = true;
  typeof lyPop === 'function' && lyPop(MENU.set);
  mnSfx('back');
  if (MENU.open) { mnHi('set', false); mnFocus(); }
}

// 右上角 ≡ 菜单按钮（注入，不改 index.html）
function mnInstall() {
  if (typeof document === 'undefined' || document.getElementById('btnMenu')) return;
  const tr = document.getElementById('topr');
  if (!tr) return;
  const b = document.createElement('button');
  b.className = 'tb'; b.id = 'btnMenu'; b.type = 'button'; b.title = '菜单（Esc）'; b.setAttribute('aria-label', '菜单');
  b.innerHTML = mnSvg('menu');
  b.addEventListener('click', () => showMenu());
  tr.appendChild(b);
  if (!document.getElementById('mnCss')) mnBuild();
}
mnInstall();
if (typeof onSettings === 'function') onSettings(() => { if (MENU.set && !MENU.set.hidden) mnSetSync(); });

// 游戏中：无选中、无工具时 Esc（或 F10）打开菜单
HOOK.key.push(e => {
  if (MENU.open || !S) return false;
  if (e.key === 'Escape' && S.briefed && !$('brief').hidden) { $('brief').hidden = true; return true; }   // ？帮助（简报）打开时 Esc 先关它
  if (e.key === 'F10' || (e.key === 'Escape' && !U.tool && !S.sel.length && !U.fdrag && !(typeof thuActive === 'function' && thuActive() && (THU.sel.size || THU.pick)) && !(typeof SPU === 'object' && SPU.k) && !e.spuEsc && (S.phase !== 'sandbox' || (typeof SBX === 'object' && !SBX.line && !SBX.pick && !SBX.drag)))) { e.preventDefault(); showMenu(); return true; }   // 沙盒编辑：无选中兵种 / 画线 / 拖动时 Esc 也开菜单
  return false;
});

// 每帧：HUD 数码雨按钮改动同步进设置；无对局时菜单背景镜头缓慢巡航
HOOK.frame.push((now, dt) => {
  if (typeof R === 'object' && R.cv && typeof SETTINGS === 'object' && R.rain !== SETTINGS.rain) setSetting('rain', R.rain);
  if (MENU.open && !MENU.game && S && CAM.vw > 1) {
    MENU.drift += dt * .05;
    if (typeof V3 === 'object' && V3.ok && V3.dk > 1) { CAM.z = CAM.fit; CAM.x = W / 2; CAM.y = H / 2; }   // 3D 背景：整张沙盘桌绕着慢慢转（view3d.js v3Att）
    else { CAM.z = CAM.fit * 1.9; CAM.x = W / 2 + Math.sin(MENU.drift) * W * .3; CAM.y = (TER ? coastAt(CAM.x) : H / 2) - 60 + Math.sin(MENU.drift * 1.7) * 90; }
    camClamp();
  }
});
