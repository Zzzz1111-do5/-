'use strict';
// 卡死、出错的现场记录（用户：所有飞机点驾驶立马死机、一开战就死机——开发环境里怎么也复现不出来，多半跟用户浏览器里存的编辑器改动、显卡有关）：
//   ① 开战后的前 60 帧、接手一架飞机后的前 40 帧：推演、画面的每一大步开始前在浏览器本地记一笔（localStorage bh-fpdiag：哪种场合、哪一步、第几帧、机型、版本），
//      走完或正常退出记「ok」；真卡死了刷新页面，顶上弹一行：上次停在哪一步——截图发给开发者就能定位。只记步骤名，不记别的
//   ② 脚本报错（页面上任何没接住的错、主循环里接住的错）：屏幕顶上红条直接写出错误和出错的文件、行号（原来只在战报里一行，看不到），同一个错只显示一次
const FPD = { n: 0, max: 0, key: '', last: '', on: false, ctx: '' };
const FPD_KEY = 'bh-fpdiag';
const fpdOn = () => FPD.on && (FPD.ctx !== '开飞机' || (typeof V3FP === 'object' && V3FP.on && V3FP.k === 'air'));
function fpdMark(s) {
  if (FPD.last === s) return;
  FPD.last = s;
  try { localStorage.setItem(FPD_KEY, JSON.stringify({ c: FPD.ctx, s, f: FPD.n, k: FPD.key, t: Date.now(), v: (typeof window === 'object' && window.DS_BUILD) || '' })); } catch (e) { /* 存不了就算了 */ }
}
function fpdStart(ctx, max, key) { FPD.ctx = ctx; FPD.max = max; FPD.n = 0; FPD.last = ''; FPD.key = key || ''; FPD.on = true; fpdMark('开始'); }
function fpdDone() { if (FPD.on) { FPD.on = false; fpdMark('ok'); } }
// 包一层：这一步开始前记下名字（只在记录的那几十帧里记）
function fpdWrap(name) {
  const f0 = typeof window === 'object' ? window[name] : null;
  if (typeof f0 !== 'function') return;
  window[name] = function () { if (FPD.on && fpdOn()) fpdMark(name); return f0.apply(this, arguments); };
}
// —— 报错红条 ——
const FPD_ERR = { seen: new Set(), el: null };
function fpdErr(msg, src, line, stack) {
  msg = String(msg || '未知错误').replace(/^Uncaught\s+/, '').slice(0, 160);
  const at = (src ? String(src).split('/').pop().split('?')[0] : '') + (line ? ':' + line : '');
  const top = stack ? (String(stack).split('\n').find(l => /\.js/.test(l) && !/fpdiag\.js/.test(l)) || '').trim().replace(/https?:[^ )]*\//g, '').replace(/\?v=[^:)]*/g, '').slice(0, 120) : '';
  const k = msg + '|' + (top || at);
  if (FPD_ERR.seen.has(k) || FPD_ERR.seen.size > 6) return;
  FPD_ERR.seen.add(k);
  try { localStorage.setItem('bh-lasterr', JSON.stringify({ msg, at: top || at, t: Date.now(), v: (typeof window === 'object' && window.DS_BUILD) || '' })); } catch (e) { /* 存不了 */ }
  if (typeof document !== 'object' || !document.body) return;
  let el = FPD_ERR.el;
  if (!el) {
    el = FPD_ERR.el = document.createElement('div');
    el.className = 'mn-layer';
    el.style.cssText = 'position:fixed;left:50%;top:8px;transform:translateX(-50%);z-index:10000;max-width:min(760px,calc(100vw - 24px));padding:8px 12px;background:rgba(120,16,16,.92);color:#fff;font:12px/1.55 "IBM Plex Mono","Noto Sans SC",monospace;border-radius:4px;cursor:pointer;white-space:pre-wrap';
    el.title = '点一下关掉';
    el.addEventListener('click', () => { el.remove(); FPD_ERR.el = null; });
    document.body.appendChild(el);
  }
  el.textContent = (el.textContent ? el.textContent + '\n' : '程序出错了（截图发给开发者；点一下关掉）：\n') + `· ${msg}${top || at ? '  @ ' + (top || at) : ''}  [版本 ${(typeof window === 'object' && window.DS_BUILD) || '本地'}]`;
}
// 各模块自己接住、只写进控制台的错（core.js runHook 的钩子、模型解码……）也上红条：控制台看不到
if (typeof console === 'object' && typeof console.error === 'function') {
  const ce = console.error.bind(console);
  console.error = function () {
    try { for (const a of arguments) if (a instanceof Error) { fpdErr((typeof arguments[0] === 'string' ? arguments[0] + '：' : '') + a.message, '', 0, a.stack); break; } } catch (e) { /* 别让记录本身出错 */ }
    return ce.apply(console, arguments);
  };
}
if (typeof window === 'object' && window.addEventListener) {
  window.addEventListener('error', e => { if (e && e.message) fpdErr(e.message, e.filename, e.lineno, e.error && e.error.stack); });
  window.addEventListener('unhandledrejection', e => { const r = e && e.reason; if (r && (r.message || typeof r === 'string')) fpdErr(r.message || r, '', 0, r.stack); });
}
if (typeof window === 'object') {
  for (const n of ['step', 'fpFly', 'fpChaseCam', 'fpFx', 'v3Draw', 'v3Scene', 'v3gDraw', 'v3mDraw', 'v3pDraw', 'v3Fx', 'v3dBurner', 'v3jDraw', 'v3aeroDraw', 'v3dHaze', 'v3cloudAdd', 'v3fpOverlay', 'fpRwr', 'fwDoors', 'updateHud', 'mmDraw']) fpdWrap(n);
  // 开战：记开战这一步本身（生成部队、远海编队、火力准备……）和之后的 60 帧
  if (typeof startBattle === 'function') { const b0 = startBattle; window.startBattle = function () { fpdStart('开战', 60); fpdMark('startBattle'); const r = b0.apply(this, arguments); fpdMark('开战完'); return r; }; }
  if (typeof sbxStart === 'function') { const s0 = sbxStart; window.sbxStart = function () { fpdStart('开战', 60); fpdMark('sbxStart'); const r = s0.apply(this, arguments); fpdMark('开战完'); return r; }; }
  // 接手飞机：从头记 40 帧；退出：记「ok」
  if (typeof fpTake === 'function') { const t0 = fpTake; window.fpTake = function (E) { let k = ''; try { k = E && E.o ? airMdlKey(E.o.kind, E.o.v) : ''; } catch (e) { k = ''; } fpdStart('开飞机', 40, k); fpdMark('fpTake'); const r = t0.apply(this, arguments); fpdMark('接手完'); return r; }; }
  if (typeof fpExit === 'function') { const x0 = fpExit; window.fpExit = function () { if (FPD.ctx === '开飞机') fpdDone(); return x0.apply(this, arguments); }; }
  // 每一帧：画之前记帧号，画完记「drawn」；记满算平安
  if (typeof draw === 'function') { const d0 = draw; window.draw = function () { const on = FPD.on && fpdOn(); if (on) { FPD.n++; fpdMark('第' + FPD.n + '帧开始'); } const r = d0.apply(this, arguments); if (on) { fpdMark('第' + FPD.n + '帧画完'); if (FPD.n >= FPD.max) fpdDone(); } return r; }; }
  // 打开页面时：上次没走完也没正常退出（卡死、被关掉）——屏幕上方弹一行；上次的报错也一起写出来
  const show = () => {
    let o = null, er = null;
    try { o = JSON.parse(localStorage.getItem(FPD_KEY) || 'null'); localStorage.removeItem(FPD_KEY); er = JSON.parse(localStorage.getItem('bh-lasterr') || 'null'); localStorage.removeItem('bh-lasterr'); } catch (e) { o = null; }
    const lines = [];
    if (o && o.s !== 'ok' && Date.now() - o.t < 3 * 864e5) lines.push(`上次${o.c || '开飞机'}时画面停在了「${o.s}」（第 ${o.f} 帧${o.k ? '，机型 ' + o.k : ''}，版本 ${o.v || '本地'}）`);
    if (er && Date.now() - er.t < 3 * 864e5) lines.push(`上次的报错：${er.msg}${er.at ? '  @ ' + er.at : ''}（版本 ${er.v || '本地'}）`);
    if (!lines.length) return;
    const el = document.createElement('div');
    el.className = 'ov box mn-layer';
    el.style.cssText = 'position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:9999;max-width:min(680px,calc(100vw - 32px));padding:10px 14px;font-size:13px;line-height:1.6;white-space:pre-wrap;cursor:pointer';
    el.textContent = lines.join('\n') + '\n把这几行截图发给开发者就能定位问题（点这里关掉）';
    el.addEventListener('click', () => el.remove());
    document.body.appendChild(el);
  };
  if (typeof document === 'object') { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show); else setTimeout(show, 0); }
}
