'use strict';
// 运行平台：网页版、电脑版（Steam：desktop/ 的 Electron 外壳在页面里放了 window.dsDesktop）、安卓版（TapTap：Capacitor）
//   电脑版、安卓版：菜单里有「退出游戏」；电脑版设置里有「全屏」（F11 / Alt+Enter 也能切，外壳记住，下次照此打开）
//   安卓版：第一次打开先请玩家同意《用户协议》《隐私政策》（国内应用商店的合规要求）；返回键当 Esc 用（关浮层、开菜单），
//          开始界面上连按两次返回键退出；切到后台时声音停下、推演暂停
//   各版本：设置面板底部随时能打开两份协议与素材署名（legal/ 下的网页，网页版、电脑版、安卓版都带着）
// 要在 menu.js 之前加载：菜单、设置的条目在 menu.js 加载时就按 PLAT 建好
const PLAT = (() => {
  const w = typeof window !== 'undefined' ? window : {}, C = w.Capacitor;
  const cap = C && typeof C.isNativePlatform === 'function' && C.isNativePlatform() ? C : null;
  return { desk: w.dsDesktop || null, cap, app: cap && cap.Plugins && cap.Plugins.App || null, android: !!cap && cap.getPlatform() === 'android', back: 0, quitT: 0, auOff: false };
})();
const PLAT_LEGAL_V = 1;   // 协议有实质改动时加一：玩家下次打开要重新同意
const PLAT_ADVICE = '抵制不良游戏，拒绝盗版游戏。注意自我保护，谨防受骗上当。适度游戏益脑，沉迷游戏伤身。合理安排时间，享受健康生活。';   // 健康游戏忠告（国内发行的游戏要在开始界面展示）

const platCanQuit = () => !!(PLAT.desk || PLAT.app);
const platCanFs = () => !!(PLAT.desk || (!PLAT.cap && typeof document !== 'undefined' && document.fullscreenEnabled));
const platFs = () => PLAT.desk ? !!PLAT.desk.fullscreen() : !!(typeof document !== 'undefined' && document.fullscreenElement);
function platQuit() { if (PLAT.desk) PLAT.desk.quit(); else if (PLAT.app) PLAT.app.exitApp(); }
function platSetFs(on) {
  if (PLAT.desk) PLAT.desk.setFullscreen(!!on);
  else if (on) document.documentElement.requestFullscreen().catch(() => {});
  else if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

const PLAT_CSS = `
.pl-layer { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; padding: 16px; background: rgba(var(--bg-rgb), .78); }
.pl-win { width: min(560px, 100%); max-height: calc(100vh - 32px); overflow-y: auto; box-sizing: border-box; padding: 18px 22px; background: rgba(4, 11, 8, .97);
  border: 1px solid var(--line-hi); border-radius: 8px; box-shadow: 0 12px 40px rgba(0, 0, 0, .6), inset 0 1px 0 rgba(var(--g-rgb), .1); animation: pnIn .22s cubic-bezier(.2, .8, .2, 1); }
.pl-win h2 { margin: 0 0 10px; font: 700 19px "Noto Sans SC", var(--f-ui); color: var(--g); letter-spacing: .1em; }
.pl-win p { margin: 0 0 10px; font: 14px/1.7 "Noto Sans SC", var(--f-ui); color: var(--text); }
.pl-win p.pl-adv { font-size: 11px; line-height: 1.6; color: var(--mute); }
.pl-win a, .pl-win .pl-ln { color: var(--g); background: none; border: 0; padding: 0; font: inherit; text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
.pl-win footer { display: flex; justify-content: flex-end; gap: 10px; margin-top: 14px; }
.pl-win footer button { min-width: 108px; min-height: 40px; padding: 6px 18px; border: 1px solid var(--line); border-radius: 4px; background: transparent; color: var(--text); font-size: 14px; }
.pl-win footer .go { border-color: var(--g); color: var(--g); background: rgba(var(--g-rgb), .1); }
.pl-doc { width: min(760px, 100%); height: calc(100vh - 32px); display: flex; flex-direction: column; padding: 14px 16px 16px; }
.pl-doc header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.pl-doc header h2 { margin: 0; }
.pl-doc .pl-x { width: 36px; height: 34px; border: 1px solid var(--line); border-radius: 5px; background: transparent; color: var(--text); font-size: 18px; line-height: 1; }
.pl-doc iframe { flex: 1; width: 100%; border: 1px solid var(--line); border-radius: 4px; background: #020704; }
`;
function platCss() {
  if (document.getElementById('plCss')) return;
  const st = document.createElement('style'); st.id = 'plCss'; st.textContent = PLAT_CSS; document.head.appendChild(st);
}
// 浮层统一用 mn-layer：菜单打开时其余页面元素都被隐藏（menu.js），只有 mn-layer 留着
function platLayer(id, html, key) {
  platCss();
  const el = document.createElement('div');
  el.id = id; el.className = 'mn-layer pl-layer'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
  el.innerHTML = html;
  document.body.appendChild(el);
  if (typeof lyPush === 'function') lyPush(el, key);
  return el;
}
function platClose(el) { if (typeof lyPop === 'function') lyPop(el); el.remove(); }

// 查看协议与素材署名：legal/ 下的网页装在浮层里（网页版、电脑版、安卓版同一份，商店填的隐私政策网址也是它）
const PLAT_DOCS = { terms: '用户协议', privacy: '隐私政策', credits: '素材署名' };
function platDoc(which) {
  if (!PLAT_DOCS[which]) which = 'privacy';
  const name = PLAT_DOCS[which];
  const el = platLayer('plDoc', `<div class="pl-win pl-doc"><header><h2>${name}</h2><button type="button" class="pl-x" aria-label="关闭" title="关闭（Esc）">×</button></header>
    <iframe src="legal/${which}.html" title="${name}"></iframe></div>`, e => { if (e.key === 'Escape') { e.preventDefault(); close(); } });
  const close = () => { platClose(el); if (typeof auUi === 'function') auUi('back'); };
  el.querySelector('.pl-x').addEventListener('click', close);
  el.addEventListener('pointerdown', e => { if (e.target === el) close(); });
  el.querySelector('.pl-x').focus({ preventScroll: true });
}

// 安卓版第一次打开：同意两份协议才能进游戏；不同意可以退出（?consent 时在浏览器里也弹，方便检查）
function platConsent() {
  const test = typeof location !== 'undefined' && /[?&]consent\b/.test(location.search);
  if (!PLAT.android && !test) return;
  let v = null;
  try { v = localStorage.getItem('bh-consent'); } catch (e) { /* 存不了就每次都问 */ }
  if (v === String(PLAT_LEGAL_V) && !test) return;
  const ln = (k, n) => `<button type="button" class="pl-ln" data-doc="${k}">《${n}》</button>`;
  const main = `<h2>用户协议与隐私政策</h2>
    <p>欢迎来到《暗剑》。这是一款单机游戏：不用注册登录，不收集、不上传你的任何个人信息；设置、闯关进度和部署存档只保存在这台设备上。</p>
    <p>请先阅读${ln('terms', '用户协议')}和${ln('privacy', '隐私政策')}。点「同意」即表示你已阅读并同意这两份协议。</p>
    <p class="pl-adv">${PLAT_ADVICE}</p>
    <footer><button type="button" data-act="no">不同意</button><button type="button" class="go" data-act="ok">同意</button></footer>`;
  const no = `<h2>需要你的同意</h2>
    <p>同意${ln('terms', '用户协议')}和${ln('privacy', '隐私政策')}之后才能使用《暗剑》。你可以再看看，也可以先退出，之后随时回来。</p>
    <footer><button type="button" data-act="quit">退出游戏</button><button type="button" class="go" data-act="back">再看看</button></footer>`;
  const el = platLayer('plCon', `<div class="pl-win">${main}</div>`, e => { if (e.key === 'Escape') e.preventDefault(); });   // 不能 Esc 跳过
  const win = el.querySelector('.pl-win'), touch = matchMedia('(pointer: coarse)').matches;
  const focus = () => { if (!touch) win.querySelector('.go').focus({ preventScroll: true }); };   // 有键盘时焦点放在「同意」上，手机上不显示焦点框
  const show = h => { win.innerHTML = h; focus(); };
  el.platBack = () => { if (win.querySelector('[data-act="quit"]')) platQuit(); else show(no); };   // 安卓返回键：先到「需要你的同意」，再按一次退出
  win.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.doc) platDoc(b.dataset.doc);
    else if (b.dataset.act === 'ok') {
      try { localStorage.setItem('bh-consent', String(PLAT_LEGAL_V)); } catch (err) { /* 只在本次有效 */ }
      platClose(el);
      if (typeof mnFocus === 'function') mnFocus();
    }
    else if (b.dataset.act === 'no') show(no);
    else if (b.dataset.act === 'back') show(main);
    else if (b.dataset.act === 'quit') platQuit();
  });
  focus();
}

// 键盘 Esc 走的那套逻辑：最上层浮层（codex.js 的 LY）先拿到，没有浮层时是游戏里的 Esc（取消选中、开菜单）
function platEsc() { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true })); }
function platBack() {
  const top = typeof LY === 'object' && LY.length ? LY[LY.length - 1].el : null;
  if (top && top.platBack) { top.platBack(); return; }
  if (top && typeof MENU === 'object' && top === MENU.el && MENU.view === 'main' && !(typeof mnCanResume === 'function' && mnCanResume())) {
    const now = performance.now();   // 开始界面：两秒内连按两次退出，免得误触
    if (now - PLAT.back < 2000) platQuit();
    else { PLAT.back = now; if (typeof mnToast === 'function') mnToast('再按一次返回键退出游戏'); }
    return;
  }
  platEsc();
}

// 切到后台（安卓回到桌面、网页切走标签、电脑版最小化）：声音停下；安卓上推演也暂停，回来由玩家自己继续
function platActive(on) {
  const c = typeof AU === 'object' && AU ? AU.ctx : null;
  if (c && !on && c.state === 'running') { PLAT.auOff = true; c.suspend().catch(() => {}); }
  else if (c && on && PLAT.auOff) { PLAT.auOff = false; c.resume().catch(() => {}); }
  if (!on && PLAT.android && typeof S === 'object' && S && S.phase === 'battle' && !S.over && !S.paused) { S.paused = true; if (typeof updateHud === 'function') updateHud(); }
}

// main.js 启动完（开始界面已经显示）后调用
function platBoot() {
  if (typeof document === 'undefined') return;
  document.addEventListener('visibilitychange', () => platActive(!document.hidden));
  if (PLAT.app) { PLAT.app.addListener('backButton', platBack); PLAT.app.addListener('appStateChange', s => platActive(!!(s && s.isActive))); }
  const fsSync = () => { if (typeof MENU === 'object' && MENU.set && !MENU.set.hidden && typeof mnSetSync === 'function') mnSetSync(); };
  if (PLAT.desk && PLAT.desk.onFullscreen) PLAT.desk.onFullscreen(fsSync);
  else document.addEventListener('fullscreenchange', fsSync);
  platConsent();
}
