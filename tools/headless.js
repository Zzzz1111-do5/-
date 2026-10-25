// 无头加载暗剑（Node）：按 index.html 顺序把 js/ 拼成一个脚本、包进函数作用域，在 vm 上下文里运行；DOM 用「黑洞」代理顶替
// 用法：const { load } = require('./headless.js'); const g = load(); g.__run('openSandbox(1)')（__run 在游戏作用域里执行代码字符串）
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
function hole() {
  const f = function () { return P; };
  const P = new Proxy(f, {
    get(t, k) {
      if (k === Symbol.toPrimitive) return () => 0;
      if (k === Symbol.iterator) return function* () {};
      if (k === 'length') return 0;
      if (k === 'then') return undefined;
      if (k in t && typeof k === 'symbol') return t[k];
      return P;
    },
    set() { return true; }, apply() { return P; }, construct() { return P; }, has() { return false; }
  });
  return P;
}
function load(opts = {}) {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  let files = [...html.matchAll(/<script src="(js\/[^"]+)"/g)].map(m => m[1]).filter(f => f !== 'js/main.js');
  const store = {};
  const H = hole();
  const doc = { addEventListener() {}, removeEventListener() {}, getElementById: () => H, querySelector: () => H, querySelectorAll: () => [], createElement: () => H,
    documentElement: H, body: H, head: H, fonts: { ready: Promise.resolve(), load: () => Promise.resolve() }, hidden: false, visibilityState: 'visible' };
  const ctx = {
    console, Math, Date, JSON, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    performance: { now: () => Date.now() }, requestAnimationFrame: () => 0, cancelAnimationFrame() {},
    localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    navigator: { userAgent: 'node', language: 'zh-CN', maxTouchPoints: 0 }, matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    addEventListener() {}, removeEventListener() {}, innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1,
    ResizeObserver: function () { return { observe() {} }; }, Image: function () { return H; }, OffscreenCanvas: undefined,
    AudioContext: undefined, webkitAudioContext: undefined,
    Map, Set, WeakMap, WeakSet, Array, Object, Float32Array, Float64Array, Int32Array, Uint8Array, Uint16Array, Uint32Array, Int16Array, Int8Array, Uint8ClampedArray,
    structuredClone, Promise, Symbol, Number, String, Boolean, Error, TypeError, RangeError, isFinite, isNaN, parseInt, parseFloat, Proxy, Reflect, BigInt,
  };
  ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx; ctx.document = doc; ctx.location = { search: '', hash: '', href: '' };
  vm.createContext(ctx);
  let src = '(function () {\n';
  for (const f of files) src += fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/^'use strict';/, '') + '\n;\n';
  src += '\nglobalThis.__run = c => eval(c);\n})();';
  vm.runInContext(src, ctx, { filename: 'darksword.js' });
  return ctx;
}
module.exports = { load };
if (require.main === module) { const c = load(); console.log('loaded', c.__run('typeof step')); }
