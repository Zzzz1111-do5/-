'use strict';
// 主循环与启动；字符解码动效与页面背景数码雨
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
function frame(now) {
  const dt = Math.min(.1, (now - lastT) / 1000);
  lastT = now;
  // 设备跟不上时降到 1 倍像素密度
  ema = ema * .95 + dt * .05;
  if (ema > .045 && !R.dprCap && now > 6000 && (window.devicePixelRatio || 1) > 1) { R.dprCap = 1; resize(); }
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
  bgRain();
  // 开始界面；热重载恢复的对局直接继续
  if (typeof showMenu === 'function') { if (hot && !S.attract) MENU.game = true; else { $('brief').hidden = true; showMenu(); } }
  requestAnimationFrame(frame);
}

window.claude?.hot?.snapshot?.(() => ({ S }));
window.claude?.hot?.ready ? window.claude.hot.ready(start) : start(window.claude?.hot?.data ?? {});
