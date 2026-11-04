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
// 一帧里哪里抛了错（比如某型飞机接手时缺数据），原来 requestAnimationFrame 排不到下一帧，整个画面就停住——用户：点驾驶某架飞机会突然死机。
//   现在出错照样排下一帧；驾驶中出的错先退出驾驶（交回 AI），战报里写出错误（同一个错 5 秒只报一次），控制台留完整堆栈
function frame(now) {
  try { frameBody(now); }
  catch (e) {
    console.error(e);
    const msg = String((e && e.message) || e).slice(0, 120);
    if (!(R.errT > now - 5000 && R.errM === msg)) { R.errT = now; R.errM = msg; if (typeof log === 'function') { try { log(`画面这一帧出错，已跳过（${typeof V3FP === 'object' && V3FP.on ? '退出驾驶，' : ''}截图发给开发者）：${msg}`, 'bad'); } catch (er) { /* 战报也坏了就算了 */ } } }
    try { if (typeof V3FP === 'object' && V3FP.on && typeof fpExit === 'function') fpExit(); } catch (er) { /* 退不出也继续 */ }
    requestAnimationFrame(frame);
  }
}
// 开飞机时画面太重的保险（用户：所有飞机点驾驶立马死机——镜头一下到了一两千米高的云层边上，开飞机时云又不淡出，
//   Mac 的 Retina 屏上一帧画好几秒）：连着两帧间隔超过 0.7 秒就把像素密度降到 1 倍、开飞机时不画云、气动特效减半，战报里说一声（只降一次）
function fpHeavyGuard(now) {
  const air = typeof V3FP === 'object' && V3FP.on && V3FP.k === 'air', gap = now - lastT;
  if (!air || !(gap < 60000)) { R.fpSlowN = 0; return; }
  R.fpSlowN = gap > 700 ? (R.fpSlowN || 0) + 1 : 0;
  if (R.fpSlowN < 2 || R.fpLite) return;
  R.fpLite = true; R.autoLow = true;
  if ((window.devicePixelRatio || 1) > 1.01) { R.dprLv = DPR_STEPS.length - 1; R.dprCap = 1; R.dprHold = now + 120000; resize(); }
  if (typeof log === 'function') log(`开飞机的画面太重（一帧要 ${(gap / 1000).toFixed(1)} 秒）：已把像素密度降到 1 倍、开飞机时不画云、气动特效减半；设置里可以再调`, 'warn');
}
function frameBody(now) {
  fpHeavyGuard(now);
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
  // 像素密度降到底（或屏幕本来就是 1 倍）还是持续卡（平均帧间隔超过约 45ms 达 4 秒）：自动降画质——3D 不做后期辉光、不画实时阴影、星云少画点；
  //   持续 15 秒流畅（约 45 帧以上）再恢复。原来 1 倍屏上卡了没有任何退路
  if (now > 8000 && ((window.devicePixelRatio || 1) <= 1.01 || (R.dprCap && R.dprCap <= 1) || R.lowCap)) {
    R.slowLT = ema > .045 ? (R.slowLT || 0) + dt : 0; R.fastLT = ema < .022 ? (R.fastLT || 0) + dt : 0;
    if (!R.autoLow && R.slowLT > 4) { R.autoLow = true; R.fastLT = 0; }
    else if (R.autoLow && R.fastLT > 15) { R.autoLow = false; R.slowLT = 0; }
  }
  camKeys(dt);
  if (S.phase === 'battle' && !S.paused && !S.over && S.briefed) {
    const sp = typeof V3FP === 'object' && V3FP.on && V3FP.k === 'air' ? 1 : S.speed;   // 亲自开飞机时按真实时间推演：快进时飞机的动态跟着变快，根本没法操纵（v3pilot.js）
    acc += dt * sp;
    let n = 0;
    // 这一帧按正常节奏（含快进倍数）该推的步数照推；卡了一下之后积压的补算才受时间预算限制——超过约 7 毫秒就留到下一帧
    //   （原来一卡就连补八步，下一帧又被拖慢，一顿接一顿）；积压最多留四步，再多就不追了
    const t0 = performance.now(), due = Math.ceil(dt * sp * 30 - 1e-6);   // 和上面同一个倍数（原来驾驶时这里还按快进倍数，卡顿补帧的预算判断失准）
    const cap = sp > 4 ? 20 : 8;   // 远海航渡的时间压缩 8、16 倍（farsea.js）：一帧要推的步数多
    while (acc >= 1 / 30 && n < cap) { step(1 / 30); acc -= 1 / 30; n++; if (n >= due && performance.now() - t0 > 7) break; }
    if (n >= cap || acc > 4 / 30) acc = Math.min(acc, 4 / 30);
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
    S = data.S; buildMap(S.seed, !!S.dry); aiCache(); rebuildForts(); rebuildCraters(); indexUnits();
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
