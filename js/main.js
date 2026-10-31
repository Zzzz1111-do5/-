'use strict';
// 主循环与启动；字符解码动效
function decode(el, text, dur) {
  const t0 = performance.now(), chars = [...text];
  const f = now => {
    const u = Math.min(1, (now - t0) / dur);
    el.textContent = chars.map((ch, i) => i < u * chars.length || ch === ' ' ? ch : GLYPHS[Math.random() * GLYPHS.length | 0]).join('');
    if (u < 1) requestAnimationFrame(f);
  };
  requestAnimationFrame(f);
}

function bgRain() {
  const c = $('bgrain');
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const g = c.getContext('2d'), fs = 16;
  let cols = [], last = 0;
  const fit = () => {
    c.width = innerWidth; c.height = innerHeight;
    cols = Array.from({ length: Math.ceil(c.width / fs) }, () => -Math.random() * 60);
    g.fillStyle = '#020704'; g.fillRect(0, 0, c.width, c.height);
  };
  fit(); addEventListener('resize', fit);
  const tick = t => {
    requestAnimationFrame(tick);
    if (t - last < 60 || (typeof realLook === 'function' && realLook() && !(typeof greenLook === 'function' && greenLook()))) return;   // 写实画面不显示数码雨（黑绿画面照常）
    last = t;
    g.fillStyle = 'rgba(2,7,4,0.14)'; g.fillRect(0, 0, c.width, c.height);
    g.font = fs + 'px "Noto Sans SC", monospace';
    cols.forEach((y, i) => {
      g.fillStyle = Math.random() < .06 ? '#d8ffe8' : '#3dff8a';
      g.fillText(GLYPHS[Math.random() * GLYPHS.length | 0], i * fs, y * fs);
      cols[i] = y * fs > c.height && Math.random() > .97 ? 0 : y + 1;
    });
  };
  requestAnimationFrame(tick);
}

let lastT = performance.now(), acc = 0, hudT = 0, mmT = 0, ema = 1 / 60;
const DPR_STEPS = [2, 1.5, 1.25, 1];   // 像素密度的几档（不超过屏幕本身的）
function frame(now) {
  const dt = Math.min(.1, (now - lastT) / 1000);
  lastT = now;
  // 像素密度按帧率逐档升降（2 → 1.5 → 1.25 → 1）：持续 2.5 秒跟不上（平均帧间隔超过约 36ms）降一档，持续 10 秒很流畅（约 48 帧以上）升一档；
  //   刚降过的档 30 秒内不再升回去（免得来回切）。原来一卡就永久降到 1 倍——Mac 的 Retina 屏上整个画面糊一倍，海面的细浪放大成颗粒
  ema = ema * .95 + dt * .05;
  if (!R.lowCap && now > 6000 && (window.devicePixelRatio || 1) > 1) {
    R.slowT = ema > .036 ? (R.slowT || 0) + dt : 0; R.fastT = ema < .021 ? (R.fastT || 0) + dt : 0;
    const lv = R.dprLv || 0, set = k => { R.dprLv = k; R.dprCap = DPR_STEPS[k]; R.slowT = R.fastT = 0; resize(); };
    if (R.slowT > 2.5 && lv < DPR_STEPS.length - 1 && DPR_STEPS[lv + 1] < (window.devicePixelRatio || 1) + .01) { R.dprHold = now + 30000; set(lv + 1); }
    else if (R.fastT > 10 && lv > 0 && now > (R.dprHold || 0)) set(lv - 1);
  }
  camKeys(dt);
  if (S.phase === 'battle' && !S.paused && !S.over && S.briefed) {
    acc += dt * S.speed;
    let n = 0;
    while (acc >= 1 / 30 && n++ < 8) { step(1 / 30); acc -= 1 / 30; }
    if (n >= 8) acc = 0;
  }
  if (!(typeof INTRO === 'object' && INTRO.on && INTRO.cover)) draw(now);   // 开场转场完全遮住战场时不画
  runHook('frame', now, dt);
  if (now - hudT > 200) { hudT = now; updateHud(); }
  if (now - mmT > 200) { mmT = now; mmDraw(); }
  requestAnimationFrame(frame);
}

function start(data) {
  const hot = !!(data && data.S && data.S.points && data.S.dd);
  if (hot) {
    S = data.S; buildMap(S.seed); aiCache(); rebuildForts(); rebuildCraters(); indexUnits();
    if (typeof initCarrier === 'function') initCarrier();
  } else { newGame(undefined, 'hard'); S.attract = true; }   // attract：开始界面背后的展示局，尚未开打
  U.level = S.level;
  initRender($('cv'));
  if (typeof SETTINGS === 'object') R.rain = SETTINGS.rain;
  buildHud(); bindInput();
  mmInit($('mm'));
  $('brief').hidden = !!S.briefed;
  new ResizeObserver(() => resize()).observe($('stage'));
  updateVision(); updateHud();
  // 开始界面；热重载恢复的对局直接继续
  if (typeof showMenu === 'function') { if (hot && !S.attract) MENU.game = true; else { $('brief').hidden = true; showMenu(); } }
  if (typeof platBoot === 'function') platBoot();   // 电脑版 / 安卓版的接入：返回键、全屏、首次打开的协议确认（platform.js）
  requestAnimationFrame(frame);
}

window.claude?.hot?.snapshot?.(() => ({ S }));
window.claude?.hot?.ready ? window.claude.hot.ready(start) : start(window.claude?.hot?.data ?? {});
