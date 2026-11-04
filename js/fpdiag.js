'use strict';
// 开飞机卡死的现场记录（用户：所有飞机点驾驶立马死机——开发环境里怎么也复现不出来）：接手一架飞机后的前 40 帧，
//   推演、画面的每一大步开始前在浏览器本地记一笔（localStorage bh-fpdiag：哪一步、第几帧、什么机型、版本），走完 40 帧或正常退出记「ok」。
//   真卡死了刷新页面，开局画面上弹一行：上次卡在哪一步——截图发给开发者就能定位。只记步骤名，不记别的
const FPD = { n: 0, key: '', last: '', on: false };
const FPD_KEY = 'bh-fpdiag';
const fpdOn = () => FPD.on && typeof V3FP === 'object' && V3FP.on && V3FP.k === 'air';
function fpdMark(s) {
  if (FPD.last === s) return;
  FPD.last = s;
  try { localStorage.setItem(FPD_KEY, JSON.stringify({ s, f: FPD.n, k: FPD.key, t: Date.now(), v: (typeof window === 'object' && window.DS_BUILD) || '' })); } catch (e) { /* 存不了就算了 */ }
}
function fpdDone() { if (FPD.on) { FPD.on = false; fpdMark('ok'); } }
// 包一层：这一步开始前记下名字（只在接手后的前 40 帧里记）
function fpdWrap(name) {
  const f0 = typeof window === 'object' ? window[name] : null;
  if (typeof f0 !== 'function') return;
  window[name] = function () { if (fpdOn()) fpdMark(name); return f0.apply(this, arguments); };
}
if (typeof window === 'object') {
  for (const n of ['step', 'fpFly', 'fpChaseCam', 'fpFx', 'v3Draw', 'v3Scene', 'v3gDraw', 'v3mDraw', 'v3pDraw', 'v3Fx', 'v3dBurner', 'v3jDraw', 'v3aeroDraw', 'v3dHaze', 'v3cloudAdd', 'v3fpOverlay', 'fpRwr', 'fwDoors', 'v3PostEnd', 'v3poEnd']) fpdWrap(n);
  // 接手：从头记；退出：记「ok」
  if (typeof fpTake === 'function') { const t0 = fpTake; window.fpTake = function (E) { FPD.n = 0; FPD.last = ''; FPD.on = true; try { FPD.key = E && E.o ? airMdlKey(E.o.kind, E.o.v) : ''; } catch (e) { FPD.key = ''; } fpdMark('take'); const r = t0.apply(this, arguments); fpdMark('taken'); return r; }; }
  if (typeof fpExit === 'function') { const x0 = fpExit; window.fpExit = function () { fpdDone(); return x0.apply(this, arguments); }; }
  // 每一帧：画之前记帧号，画完记「drawn」；满 40 帧算平安
  if (typeof draw === 'function') { const d0 = draw; window.draw = function () { const on = fpdOn(); if (on) { FPD.n++; fpdMark('frame' + FPD.n); } const r = d0.apply(this, arguments); if (on) { fpdMark('drawn' + FPD.n); if (FPD.n >= 40) fpdDone(); } return r; }; }
  // 打开页面时：上次开飞机没走完 40 帧也没正常退出（卡死、被关掉）——屏幕上方弹一行
  const show = () => {
    let o = null;
    try { o = JSON.parse(localStorage.getItem(FPD_KEY) || 'null'); localStorage.removeItem(FPD_KEY); } catch (e) { o = null; }
    if (!o || o.s === 'ok' || !(Date.now() - o.t < 3 * 864e5)) return;
    const el = document.createElement('div');
    el.className = 'ov box mn-layer';
    el.style.cssText = 'position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:9999;max-width:min(640px,calc(100vw - 32px));padding:10px 14px;font-size:13px;line-height:1.6';
    el.textContent = `上次开飞机时画面停在了「${o.s}」这一步（接手后第 ${o.f} 帧，机型 ${o.k || '未知'}，版本 ${o.v || '未知'}）。把这一行截图发给开发者就能定位问题。（点这里关掉）`;
    el.addEventListener('click', () => el.remove());
    document.body.appendChild(el);
  };
  if (typeof document === 'object') { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show); else setTimeout(show, 0); }
}
