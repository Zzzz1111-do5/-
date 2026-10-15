#!/usr/bin/env python3
"""Post-process index.html into an offline, China-friendly, old-WebView-compatible single file.

Usage:
  python3 tools/build_app.py [--in index.html] [--target web|android] [--out PATH]
                             [--minify] [--verify] [--quiet]

Defaults: --in <repo>/index.html; --target web writes dist/blue-planet-offline.html,
--target android writes dist/blue-planet-android.html.

What it does (index.html and src/ are never modified):
  a. strips every reference to fonts.googleapis.com / fonts.gstatic.com (the CSS font stacks
     already fall back to system CJK fonts) and refuses to write a file that still makes the
     browser fetch anything from the network;
  b. transpiles every inline classic <script> with esbuild to chrome61 + safari12 (identifiers are
     never renamed, so window.__earth and stack traces stay readable; --minify only drops
     whitespace) and proves with acorn that no syntax newer than ES2018 (and no regex feature
     Chrome 61 lacks) is left; the 'use strict' directives are counted before and after;
  c. lowers the <style> CSS with esbuild (inset -> top/right/bottom/left, -webkit- prefixes,
     modern colour syntax) and adds fallback declarations in front of anything old WebViews
     would drop (min()/max()/clamp()/env() before Chrome 79/69, padding-block & co. before
     Chrome 87, color-mix() before Chrome 111, gap on grids before Chrome 66 via grid-gap).
     A fallback always precedes the original
     declaration, so browsers that understand the original keep using it;
  d. prepends a small ES5 polyfill <script> for runtime APIs esbuild cannot transpile and that
     Chrome 61-72 WebViews lack (only the ones the transpiled code actually references), and
     warns about any newer API it has no polyfill for;
  e. injects <script>window.__APP_TARGET__='web'|'android'</script> right after <meta charset>;
     for android the viewport also gets maximum-scale=1, user-scalable=no (viewport-fit=cover
     is kept).

Requires node + the devDependencies in tools/package.json (esbuild, acorn). If
tools/node_modules is missing the script runs `npm ci --prefix tools` once.
--verify loads the result in headless Chromium through Playwright (PLAYWRIGHT_MODULE env var or
/opt/node22/lib/node_modules/playwright or a resolvable `playwright`), fails on any non-file
network request or page error, then plays: god mode, run to 1900, globe and back, tech tree.
"""
import argparse
import gzip
import json
import os
import re
import shutil
import subprocess
import sys

TOOLS = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(TOOLS)
DEFAULT_IN = os.path.join(ROOT, 'index.html')
DEFAULT_OUT = {
    'web': os.path.join(ROOT, 'dist', 'blue-planet-offline.html'),
    'android': os.path.join(ROOT, 'dist', 'blue-planet-android.html'),
}
# Old Android WebViews (Chromium 6x on un-updated Huawei/Xiaomi/OPPO/vivo phones) and iOS 12 Safari.
TARGETS = ['chrome61', 'safari12']
FONT_HOST_RE = re.compile(r'fonts\.(?:googleapis|gstatic)\.com', re.I)


def die(msg):
    sys.stderr.write('build_app: error: ' + msg + '\n')
    sys.exit(1)


# ---------------------------------------------------------------------------------------------
# Node side: esbuild transform + acorn verification, run once per build over stdin/stdout JSON.
# ---------------------------------------------------------------------------------------------
NODE_HELPER = r"""
const path = require('path'), fs = require('fs');
const dir = process.argv[1];
const esbuild = require(path.join(dir, 'node_modules', 'esbuild'));
const acorn = require(path.join(dir, 'node_modules', 'acorn'));
const job = JSON.parse(fs.readFileSync(0, 'utf8'));
const out = { scripts: [], styles: [], errors: [], warnings: [], esbuild: esbuild.version, acorn: acorn.version };
const common = {
  target: job.targets, charset: 'utf8', legalComments: 'none', logLevel: 'silent',
  minifyWhitespace: !!job.minify, minifyIdentifiers: false, minifySyntax: false,
};
function walk(node, fn) {
  if (!node || typeof node.type !== 'string') return;
  fn(node);
  for (const k in node) {
    const v = node[k];
    if (Array.isArray(v)) { for (const c of v) if (c && typeof c.type === 'string') walk(c, fn); }
    else if (v && typeof v.type === 'string' && k !== 'loc') walk(v, fn);
  }
}
function strictCount(ast) { let n = 0; walk(ast, nd => { if (nd.directive === 'use strict') n++; }); return n; }
// regex syntax that ES2018 allows but Chrome 61 / Safari 12 do not (acorn at 2018 accepts it)
function regexIssue(pattern, flags) {
  const bad = [];
  if (/\(\?<[A-Za-z_$]/.test(pattern)) bad.push('named capture group (Chrome 64)');
  if (/\(\?<[=!]/.test(pattern)) bad.push('lookbehind (Chrome 62, Safari 16.4)');
  if (/\\[pP]\{/.test(pattern) && flags.includes('u')) bad.push('unicode property escape (Chrome 64)');
  if (flags.includes('s')) bad.push('dotAll flag (Chrome 62)');
  return bad;
}
function lineOf(code, pos) { return code.slice(0, pos).split('\n').length; }
job.scripts.forEach((src, idx) => {
  let code;
  try {
    const r = esbuild.transformSync(src, Object.assign({ loader: 'js', supported: job.supported }, common));
    code = r.code;
    for (const w of r.warnings) out.warnings.push('esbuild (script ' + idx + '): ' + w.text);
  } catch (e) {
    for (const er of e.errors || [{ text: String(e) }]) out.errors.push('esbuild (script ' + idx + '): ' + er.text + (er.location ? ' @ line ' + er.location.line + ': ' + er.location.lineText.trim().slice(0, 120) : ''));
    out.scripts.push(null); return;
  }
  // 1) no syntax newer than ES2018 may survive, 2) no regex feature Chrome 61 cannot compile
  const tokens = [];
  let ast;
  try {
    ast = acorn.parse(code, { ecmaVersion: 2018, sourceType: 'script', onToken: tokens });
  } catch (e) {
    out.errors.push('acorn ecmaVersion 2018 rejects transpiled script ' + idx + ': ' + e.message + ' :: ' + code.split('\n')[(e.loc ? e.loc.line : 1) - 1].trim().slice(0, 160));
    out.scripts.push(null); return;
  }
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type.label === 'regexp') {
      for (const b of regexIssue(t.value.pattern, t.value.flags)) out.errors.push('script ' + idx + ' line ' + lineOf(code, t.start) + ': regex /' + t.value.pattern.slice(0, 60) + '/ uses ' + b);
    } else if (t.type.label === 'name' && t.value === 'RegExp' && tokens[i + 1] && tokens[i + 1].type.label === '(' && tokens[i + 2] && tokens[i + 2].type.label === 'string') {
      const fl = tokens[i + 3] && tokens[i + 3].type.label === ',' && tokens[i + 4] && tokens[i + 4].type.label === 'string' ? tokens[i + 4].value : '';
      for (const b of regexIssue(tokens[i + 2].value, fl)) out.errors.push('script ' + idx + ' line ' + lineOf(code, t.start) + ': new RegExp(' + JSON.stringify(tokens[i + 2].value.slice(0, 60)) + ') uses ' + b);
    }
  }
  // strict-mode semantics: every 'use strict' directive of the source must still be a directive
  let before = -1;
  try { before = strictCount(acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script' })); }
  catch (e) { out.warnings.push('acorn could not parse source script ' + idx + ' for the strict-mode check: ' + e.message); }
  const after = strictCount(ast);
  if (before >= 0 && after !== before) out.errors.push('script ' + idx + ': ' + before + " 'use strict' directive(s) in the source but " + after + ' after transpiling');
  if (/<\/script/i.test(code)) out.errors.push('script ' + idx + ': transpiled code contains "</script" and would end the <script> element early');
  if (/<!--/.test(code)) out.errors.push('script ' + idx + ': transpiled code contains "<!--" (HTML script-data escape hazard)');
  out.scripts.push({ code, strict: after, tokens: tokens.length });
});
job.styles.forEach((src, idx) => {
  try {
    const r = esbuild.transformSync(src, Object.assign({ loader: 'css' }, common));
    for (const w of r.warnings) out.warnings.push('esbuild (style ' + idx + '): ' + w.text);
    out.styles.push(r.code);
  } catch (e) {
    for (const er of e.errors || [{ text: String(e) }]) out.errors.push('esbuild (style ' + idx + '): ' + er.text);
    out.styles.push(null);
  }
});
// the polyfill and the app-target snippet are hand-written ES5 and must parse as such
for (const [name, code] of Object.entries(job.es5 || {})) {
  try { acorn.parse(code, { ecmaVersion: 5, sourceType: 'script' }); }
  catch (e) { out.errors.push(name + ' is not valid ES5: ' + e.message); }
}
process.stdout.write(JSON.stringify(out));
"""


def ensure_node_modules():
    if not shutil.which('node'):
        die('node is not on PATH (needed for esbuild / acorn)')
    have = all(os.path.isdir(os.path.join(TOOLS, 'node_modules', m)) for m in ('esbuild', 'acorn'))
    if have:
        return
    print('build_app: tools/node_modules missing - running npm ci --prefix tools', file=sys.stderr)
    r = subprocess.run(['npm', 'ci', '--prefix', TOOLS, '--no-audit', '--no-fund'])
    if r.returncode != 0:
        die('npm ci failed; run: npm ci --prefix ' + TOOLS)


def run_node(job):
    r = subprocess.run(['node', '-e', NODE_HELPER, TOOLS], input=json.dumps(job).encode('utf-8'),
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if r.returncode != 0:
        die('node helper failed:\n' + r.stderr.decode('utf-8', 'replace'))
    return json.loads(r.stdout.decode('utf-8'))


# ---------------------------------------------------------------------------------------------
# Runtime polyfills (ES5). Each entry: name, regex over the transpiled code that decides whether
# the API is referenced, ES5 snippet. Snippets only patch what is missing, so they are no-ops on
# modern engines. They run inside one IIFE that defines def(obj, name, fn).
# ---------------------------------------------------------------------------------------------
POLYFILLS = [
    ('Array.prototype.flat', r'\.flat\(', r"""
def(Array.prototype, 'flat', function flat(depth) {
  var d = depth === undefined ? 1 : Number(depth);
  function into(out, src, d) {
    for (var i = 0, n = src.length >>> 0; i < n; i++) {
      if (!(i in src)) continue;
      var v = src[i];
      if (d >= 1 && Array.isArray(v)) into(out, v, d - 1); else out.push(v);
    }
    return out;
  }
  return into([], Object(this), d === d ? d : 0);
});"""),
    ('Array.prototype.flatMap', r'\.flatMap\(', r"""
def(Array.prototype, 'flatMap', function flatMap(fn, thisArg) {
  if (typeof fn !== 'function') throw new TypeError('flatMap: callback is not a function');
  var src = Object(this), out = [];
  for (var i = 0, n = src.length >>> 0; i < n; i++) {
    if (!(i in src)) continue;
    var v = fn.call(thisArg, src[i], i, src);
    if (Array.isArray(v)) { for (var j = 0; j < v.length; j++) if (j in v) out.push(v[j]); }
    else out.push(v);
  }
  return out;
});"""),
    ('Object.fromEntries', r'Object\.fromEntries\b', r"""
def(Object, 'fromEntries', function fromEntries(entries) {
  var list = Array.isArray(entries) ? entries : Array.from(entries), obj = {};
  for (var i = 0; i < list.length; i++) {
    var e = list[i];
    if (Object(e) !== e) throw new TypeError('Object.fromEntries: entry ' + i + ' is not an object');
    Object.defineProperty(obj, e[0], { value: e[1], writable: true, enumerable: true, configurable: true });
  }
  return obj;
});"""),
    ('String.prototype.padStart/padEnd', r'\.pad(?:Start|End)\(', r"""
(function () {
  function pad(s, len, fill, atStart) {
    s = String(s); len = len >> 0; fill = fill === undefined ? ' ' : String(fill);
    if (len <= s.length || !fill) return s;
    var need = len - s.length, p = '';
    while (p.length < need) p += fill;
    p = p.slice(0, need);
    return atStart ? p + s : s + p;
  }
  def(String.prototype, 'padStart', function padStart(len, fill) { return pad(this, len, fill, true); });
  def(String.prototype, 'padEnd', function padEnd(len, fill) { return pad(this, len, fill, false); });
})();"""),
    ('String.prototype.trimStart/trimEnd', r'\.trim(?:Start|End)\(', r"""
def(String.prototype, 'trimStart', String.prototype.trimLeft || function trimStart() { return String(this).replace(/^\s+/, ''); });
def(String.prototype, 'trimEnd', String.prototype.trimRight || function trimEnd() { return String(this).replace(/\s+$/, ''); });"""),
    ('Promise.prototype.finally', r'\.finally\(', r"""
if (typeof Promise === 'function') def(Promise.prototype, 'finally', function (fn) {
  if (typeof fn !== 'function') return this.then(fn, fn);
  var C = this.constructor || Promise;
  return this.then(function (v) { return C.resolve(fn()).then(function () { return v; }); },
                   function (e) { return C.resolve(fn()).then(function () { throw e; }); });
});"""),
    ('Promise.allSettled', r'Promise\.allSettled\b', r"""
if (typeof Promise === 'function') def(Promise, 'allSettled', function allSettled(items) {
  return Promise.all(Array.from(items, function (p) {
    return Promise.resolve(p).then(function (value) { return { status: 'fulfilled', value: value }; },
                                   function (reason) { return { status: 'rejected', reason: reason }; });
  }));
});"""),
    ('globalThis', r'\bglobalThis\b', r"""
if (typeof globalThis === 'undefined') Object.defineProperty(window, 'globalThis', { value: window, writable: true, configurable: true });"""),
    ('Array/String.prototype.at', r'\.at\(', r"""
(function () {
  function at(i) { var o = Object(this), n = o.length >>> 0; i = Math.trunc(i) || 0; if (i < 0) i += n; return i < 0 || i >= n ? undefined : o[i]; }
  def(Array.prototype, 'at', at);
  def(String.prototype, 'at', function (i) { return at.call(String(this), i); });
  ['Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array', 'Float32Array', 'Float64Array'].forEach(function (k) { if (window[k]) def(window[k].prototype, 'at', at); });
})();"""),
    ('Array.prototype.findLast/findLastIndex', r'\.findLast(?:Index)?\(', r"""
def(Array.prototype, 'findLastIndex', function findLastIndex(fn, thisArg) { var o = Object(this); for (var i = (o.length >>> 0) - 1; i >= 0; i--) if (fn.call(thisArg, o[i], i, o)) return i; return -1; });
def(Array.prototype, 'findLast', function findLast(fn, thisArg) { var o = Object(this); for (var i = (o.length >>> 0) - 1; i >= 0; i--) if (fn.call(thisArg, o[i], i, o)) return o[i]; return undefined; });"""),
    ('String.prototype.replaceAll', r'\.replaceAll\(', r"""
def(String.prototype, 'replaceAll', function replaceAll(search, repl) {
  if (search instanceof RegExp) {
    if (search.flags.indexOf('g') < 0) throw new TypeError('replaceAll must be called with a global RegExp');
    return String(this).replace(search, repl);
  }
  var s = String(this), f = String(search), out = '', i = 0, j, step = Math.max(1, f.length);
  if (!f.length) return s.split('').join(typeof repl === 'function' ? repl('') : repl);
  while ((j = s.indexOf(f, i)) >= 0) { out += s.slice(i, j) + (typeof repl === 'function' ? repl(f, j, s) : String(repl).replace(/\$&/g, f)); i = j + step; }
  return out + s.slice(i);
});"""),
    ('Object.hasOwn', r'Object\.hasOwn\b', r"""
def(Object, 'hasOwn', function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(Object(o), k); });"""),
    ('queueMicrotask', r'\bqueueMicrotask\b', r"""
if (typeof window.queueMicrotask !== 'function') window.queueMicrotask = function (fn) { Promise.resolve().then(fn).catch(function (e) { setTimeout(function () { throw e; }); }); };"""),
    # Chrome < 68: CanvasPattern#setTransform is missing and calling it throws in the render loop.
    # A no-op keeps rendering alive; the pattern is then anchored to the canvas origin instead.
    ('CanvasPattern.prototype.setTransform', r'createPattern\(', r"""
if (typeof CanvasPattern !== 'undefined') def(CanvasPattern.prototype, 'setTransform', function setTransform() {});"""),
    # Chrome < 68: Path2D#addPath is missing. Record the drawing ops of every Path2D (only on such
    # engines) and replay them, transformed by the DOMMatrix-like second argument, in addPath.
    ('Path2D.prototype.addPath', r'\.addPath\(', r"""
if (typeof Path2D === 'function' && typeof Path2D.prototype.addPath !== 'function') (function () {
  var P = Path2D.prototype, spec = { moveTo: [0, 2], lineTo: [1, 2], closePath: [2, 0], rect: [3, 4], quadraticCurveTo: [4, 4], bezierCurveTo: [5, 6], arc: [6, 6], ellipse: [7, 8], arcTo: [8, 5] };
  Object.keys(spec).forEach(function (name) {
    var nat = P[name], code = spec[name][0], n = spec[name][1];
    if (typeof nat !== 'function') return;
    Object.defineProperty(P, name, { writable: true, configurable: true, value: function () {
      var ops = this.__bpOps || (this.__bpOps = []);
      ops.push(code);
      for (var i = 0; i < n; i++) ops.push(arguments[i]);
      return nat.apply(this, arguments);
    } });
  });
  function num(v, d) { return typeof v === 'number' && v === v ? v : d; }
  Object.defineProperty(P, 'addPath', { writable: true, configurable: true, value: function addPath(path, m) {
    var ops = path && path.__bpOps, self = this;
    if (!ops) return;
    var a = 1, b = 0, c = 0, d = 1, e = 0, f = 0;
    if (m) { a = num(m.a, 1); b = num(m.b, 0); c = num(m.c, 0); d = num(m.d, 1); e = num(m.e, 0); f = num(m.f, 0); }
    var s = Math.sqrt(Math.abs(a * d - b * c)), rot = Math.atan2(b, a);
    function X(x, y) { return a * x + c * y + e; }
    function Y(x, y) { return b * x + d * y + f; }
    var o = ops.slice();
    for (var i = 0; i < o.length;) {
      var k = o[i++], x, y, w, h;
      if (k === 0) { self.moveTo(X(o[i], o[i + 1]), Y(o[i], o[i + 1])); i += 2; }
      else if (k === 1) { self.lineTo(X(o[i], o[i + 1]), Y(o[i], o[i + 1])); i += 2; }
      else if (k === 2) self.closePath();
      else if (k === 3) {
        x = o[i]; y = o[i + 1]; w = o[i + 2]; h = o[i + 3]; i += 4;
        self.moveTo(X(x, y), Y(x, y)); self.lineTo(X(x + w, y), Y(x + w, y)); self.lineTo(X(x + w, y + h), Y(x + w, y + h));
        self.lineTo(X(x, y + h), Y(x, y + h)); self.closePath(); self.moveTo(X(x, y), Y(x, y));
      }
      else if (k === 4) { self.quadraticCurveTo(X(o[i], o[i + 1]), Y(o[i], o[i + 1]), X(o[i + 2], o[i + 3]), Y(o[i + 2], o[i + 3])); i += 4; }
      else if (k === 5) { self.bezierCurveTo(X(o[i], o[i + 1]), Y(o[i], o[i + 1]), X(o[i + 2], o[i + 3]), Y(o[i + 2], o[i + 3]), X(o[i + 4], o[i + 5]), Y(o[i + 4], o[i + 5])); i += 6; }
      else if (k === 6) { self.arc(X(o[i], o[i + 1]), Y(o[i], o[i + 1]), o[i + 2] * s, o[i + 3] + rot, o[i + 4] + rot, !!o[i + 5]); i += 6; }
      else if (k === 7) { self.ellipse(X(o[i], o[i + 1]), Y(o[i], o[i + 1]), o[i + 2] * s, o[i + 3] * s, o[i + 4] + rot, o[i + 5], o[i + 6], !!o[i + 7]); i += 8; }
      else if (k === 8) { self.arcTo(X(o[i], o[i + 1]), Y(o[i], o[i + 1]), X(o[i + 2], o[i + 3]), Y(o[i + 2], o[i + 3]), o[i + 4] * s); i += 5; }
      else break;
    }
  } });
})();"""),
]

# roundRect (Chrome 99) is only polyfilled when some call is not feature-guarded.
ROUNDRECT_POLYFILL = ('CanvasRenderingContext2D.prototype.roundRect', r"""
(function () {
  function rr(x, y, w, h, r) {
    var v = typeof r === 'number' ? r : r && r.length ? (typeof r[0] === 'number' ? r[0] : r[0].x || 0) : 0;
    v = Math.max(0, Math.min(v || 0, Math.abs(w) / 2, Math.abs(h) / 2));
    this.moveTo(x + v, y); this.arcTo(x + w, y, x + w, y + h, v); this.arcTo(x + w, y + h, x, y + h, v);
    this.arcTo(x, y + h, x, y, v); this.arcTo(x, y, x + w, y, v); this.closePath();
  }
  if (typeof CanvasRenderingContext2D !== 'undefined') def(CanvasRenderingContext2D.prototype, 'roundRect', rr);
  if (typeof Path2D === 'function') def(Path2D.prototype, 'roundRect', rr);
})();""")

# Newer runtime APIs with no polyfill here: referencing one is reported (it would throw on old
# WebViews unless the source feature-detects it).
UNPOLYFILLED = [
    (r'\bstructuredClone\b', 'structuredClone (Chrome 98)'),
    (r'\.matchAll\(', 'String.prototype.matchAll (Chrome 73)'),
    (r'\bResizeObserver\b', 'ResizeObserver (Chrome 64, Safari 13.1)'),
    (r'\bIntl\.(?:Segmenter|ListFormat|RelativeTimeFormat|DisplayNames|PluralRules|Locale)\b', 'newer Intl constructors'),
    (r'\bWeakRef\b|\bFinalizationRegistry\b', 'WeakRef / FinalizationRegistry (Chrome 84)'),
    (r'\.(?:toSorted|toReversed|toSpliced)\(|\.with\(\s*-?\d', 'change-array-by-copy methods (Chrome 110)'),
    (r'\b(?:Object|Map)\.groupBy\b', 'Object/Map.groupBy (Chrome 117)'),
    (r'\bPromise\.any\b|\bAggregateError\b', 'Promise.any (Chrome 85)'),
    (r'\bcrypto\.randomUUID\b', 'crypto.randomUUID (Chrome 92)'),
    (r'\bOffscreenCanvas\b', 'OffscreenCanvas (Chrome 69, Safari 16.4)'),
    (r'\bcreateConicGradient\b', 'createConicGradient (Chrome 99)'),
    (r'\.replaceChildren\(', 'Element.replaceChildren (Chrome 86)'),
    (r'\bnavigator\.clipboard\b', 'navigator.clipboard (Chrome 66)'),
    (r'\bAbortSignal\.timeout\b', 'AbortSignal.timeout (Chrome 103)'),
    (r'\.getTransform\(', 'CanvasRenderingContext2D.getTransform (Chrome 68)'),
]


def unguarded_roundrect(js):
    n = 0
    for m in re.finditer(r'\.roundRect\(', js):
        before = js[max(0, m.start() - 160):m.start()]
        if not re.search(r'roundRect\s*(?:\?|&&|\)|!==?\s*(?:undefined|void 0)|===?\s*["\']function)', before):
            n += 1
    return n


def build_polyfills(js_all):
    used, snippets = [], []
    for name, rx, code in POLYFILLS:
        if re.search(rx, js_all):
            used.append(name)
            snippets.append(code.strip('\n'))
    if unguarded_roundrect(js_all):
        used.append(ROUNDRECT_POLYFILL[0])
        snippets.append(ROUNDRECT_POLYFILL[1].strip('\n'))
    if not snippets:
        return used, ''
    body = '\n'.join('try {\n%s\n} catch (e) { warn(%s, e); }' % (s, json.dumps(n)) for n, s in zip(used, snippets))
    code = ("/* runtime polyfills for old Android WebViews / iOS 12, added by tools/build_app.py */\n"
            "(function () {\n'use strict';\n"
            "function def(obj, name, fn) {\n"
            "  if (obj && typeof obj[name] !== 'function') Object.defineProperty(obj, name, { value: fn, writable: true, configurable: true });\n"
            "}\n"
            "function warn(name, e) { if (window.console) console.warn('polyfill ' + name + ' failed', e); }\n"
            + body + "\n})();")
    return used, code


# ---------------------------------------------------------------------------------------------
# CSS fallbacks for old WebViews (run on esbuild's already-lowered CSS)
# ---------------------------------------------------------------------------------------------
LENGTH_RE = re.compile(r'^\s*(-?(?:\d+\.?\d*|\.\d+))(px|em|rem|%|vw|vh|vmin|vmax|pt)?\s*$')
RELATIVE_RE = re.compile(r'%|\bv(?:w|h|min|max)\b|\d(?:vw|vh|vmin|vmax)')
GRID_GAP = {'gap': 'grid-gap', 'row-gap': 'grid-row-gap', 'column-gap': 'grid-column-gap'}
LOGICAL = {
    'padding-block': ('padding-top', 'padding-bottom'), 'padding-inline': ('padding-left', 'padding-right'),
    'margin-block': ('margin-top', 'margin-bottom'), 'margin-inline': ('margin-left', 'margin-right'),
    'inset-block': ('top', 'bottom'), 'inset-inline': ('left', 'right'),
    'padding-block-start': ('padding-top',), 'padding-block-end': ('padding-bottom',),
    'padding-inline-start': ('padding-left',), 'padding-inline-end': ('padding-right',),
    'margin-block-start': ('margin-top',), 'margin-block-end': ('margin-bottom',),
    'margin-inline-start': ('margin-left',), 'margin-inline-end': ('margin-right',),
    'inset-block-start': ('top',), 'inset-block-end': ('bottom',),
    'inset-inline-start': ('left',), 'inset-inline-end': ('right',),
}


def split_args(s):
    """Split a function argument list on top-level commas."""
    out, depth, cur = [], 0, ''
    for ch in s:
        if ch == '(':
            depth += 1
        elif ch == ')':
            depth -= 1
        if ch == ',' and depth == 0:
            out.append(cur.strip())
            cur = ''
        else:
            cur += ch
    out.append(cur.strip())
    return out


def split_ws(s):
    """Split a value on top-level whitespace."""
    out, depth, cur = [], 0, ''
    for ch in s.strip():
        depth += (ch == '(') - (ch == ')')
        if ch.isspace() and depth == 0:
            if cur:
                out.append(cur)
            cur = ''
        else:
            cur += ch
    if cur:
        out.append(cur)
    return out


def find_call(value, names):
    """Return (start, end, name, argstr) of an innermost call to one of names, or None."""
    rx = re.compile(r'(?<![-\w])(' + '|'.join(names) + r')\(')
    for m in rx.finditer(value):
        depth, i = 1, m.end()
        while i < len(value) and depth:
            depth += (value[i] == '(') - (value[i] == ')')
            i += 1
        if depth:
            return None  # unbalanced: leave the declaration alone
        inner = value[m.end():i - 1]
        if not rx.search(inner):  # nothing of these kinds nested inside -> innermost
            return (m.start(), i, m.group(1), inner)
    return None


def resolve_minmax(name, args):
    """Pick the value an old engine should use instead of min()/max()/clamp().

    Exact when every argument is a plain number of one unit; otherwise approximate the result on
    a phone-sized viewport (where old WebViews live): min() takes the viewport-relative argument,
    max() the absolute one, clamp() its preferred value.
    """
    if name == 'clamp':
        return args[1] if len(args) == 3 else None
    parsed = [LENGTH_RE.match(a) for a in args]
    if all(parsed):
        units = {(p.group(2) or '') for p in parsed if float(p.group(1)) != 0}
        if len(units) <= 1:
            vals = [float(p.group(1)) for p in parsed]
            v = min(vals) if name == 'min' else max(vals)
            i = vals.index(v)
            return args[i]
    rel = [a for a in args if RELATIVE_RE.search(a)]
    absl = [a for a in args if not RELATIVE_RE.search(a)]
    if name == 'min':
        return (rel or args)[0]
    return (absl or args)[0]


def css_fallback_value(value):
    """Return an old-engine-safe rewrite of a declaration value, or None if nothing to do."""
    v = value
    changed = False
    for _ in range(50):
        c = find_call(v, ['env'])
        if not c:
            break
        a = split_args(c[3])
        v = v[:c[0]] + (a[1] if len(a) > 1 and a[1] else '0px') + v[c[1]:]
        changed = True
    for _ in range(50):
        c = find_call(v, ['min', 'max', 'clamp'])
        if not c:
            break
        pick = resolve_minmax(c[2], split_args(c[3]))
        if pick is None:
            return None
        v = v[:c[0]] + pick + v[c[1]:]
        changed = True
    for _ in range(10):
        c = find_call(v, ['color-mix'])
        if not c:
            break
        a = split_args(c[3])
        # only the common "color-mix(in srgb, X p%, transparent)" shape has a sane fallback
        m = re.match(r'^(.*\S)\s+(\d+(?:\.\d+)?)%$', a[1]) if len(a) == 3 else None
        if not (m and a[0].replace(' ', '') == 'insrgb' and a[2] == 'transparent' and float(m.group(2)) >= 50):
            return None
        v = v[:c[0]] + m.group(1) + v[c[1]:]
        changed = True
    if re.search(r'(?<![-\w])(?:env|min|max|clamp|color-mix)\(', v):
        return None
    return v if changed and v != value else None


DECL_RE = re.compile(r'(?P<lead>[{;]\s*)(?P<prop>-?[a-zA-Z][-a-zA-Z]*)\s*:\s*(?P<val>[^;{}]+?)\s*(?P<imp>!important)?\s*(?=[;}])')


def css_fallbacks(css):
    stats = {'minmax/env': 0, 'logical': 0, 'color-mix': 0, 'gap': 0}

    def sub(m):
        prop, val, imp = m.group('prop').lower(), m.group('val'), m.group('imp') or ''
        if val.count('(') != val.count(')') or 'url(' in val.lower():
            return m.group(0)
        fb = []
        newval = css_fallback_value(val)
        if newval is not None:
            fb.append((prop, newval))
            stats['color-mix' if 'color-mix(' in val else 'minmax/env'] += 1
        if prop in GRID_GAP:
            # Chrome 57-65 only know the grid-* names for grid gutters; modern engines treat
            # grid-gap as an alias of gap, and the original declaration follows anyway
            fb.append((GRID_GAP[prop], newval if newval is not None else val))
            stats['gap'] += 1
        if prop in LOGICAL:
            v = newval if newval is not None else val
            longs = LOGICAL[prop]
            parts = split_ws(v)
            if len(longs) == 1:
                fb.append((longs[0], v))
                stats['logical'] += 1
            elif 1 <= len(parts) <= 2:
                fb.extend(zip(longs, [parts[0], parts[-1]]))
                stats['logical'] += 1
            # an engine without the logical property gains nothing from "logical-prop: fallback"
            fb = [f for f in fb if f[0] != prop]
        if not fb:
            return m.group(0)
        lead = m.group('lead')
        ws = lead[1:]  # keep the formatting esbuild produced (newline + indent, or nothing)
        text = ''.join('%s: %s%s;%s' % (p, v, ' !important' if imp else '', ws) for p, v in fb)
        return lead + text + m.group(0)[len(lead):]

    out = DECL_RE.sub(sub, css)
    return out, stats


# ---------------------------------------------------------------------------------------------
# HTML plumbing
# ---------------------------------------------------------------------------------------------
SCRIPT_RE = re.compile(r'<script\b(?P<attrs>[^>]*)>(?P<body>.*?)</script\s*>', re.S | re.I)
STYLE_RE = re.compile(r'<style\b(?P<attrs>[^>]*)>(?P<body>.*?)</style\s*>', re.S | re.I)


def is_classic_inline(attrs):
    if re.search(r'\bsrc\s*=', attrs, re.I):
        return False
    t = re.search(r'\btype\s*=\s*["\']?([^"\'\s>]+)', attrs, re.I)
    return not t or t.group(1).lower() in ('text/javascript', 'application/javascript', 'javascript')


def strip_font_refs(html):
    n_before = len(FONT_HOST_RE.findall(html))
    html = re.sub(r'[ \t]*<link\b[^>]*?(?:https?:)?//fonts\.(?:googleapis|gstatic)\.com[^>]*>[ \t]*\r?\n?', '', html, flags=re.I)
    html = re.sub(r'@import\s+(?:url\()?\s*["\']?(?:https?:)?//fonts\.(?:googleapis|gstatic)\.com[^;]*;', '', html, flags=re.I)
    left = FONT_HOST_RE.findall(html)
    if left:
        i = FONT_HOST_RE.search(html).start()
        die('a Google Fonts reference survived stripping near: ' + html[max(0, i - 80):i + 80].replace('\n', ' '))
    return html, n_before


def external_fetches(html):
    """Return remote URLs the browser would fetch from markup / CSS, and inert http(s) mentions."""
    fetch, inert = [], []
    markup = SCRIPT_RE.sub('<script></script>', html)
    styles = ' '.join(m.group('body') for m in STYLE_RE.finditer(markup))
    markup_only = STYLE_RE.sub('<style></style>', markup)
    for m in re.finditer(r'<(?!!--)[a-zA-Z][^>]*>', markup_only):
        tag = m.group(0)
        for a in re.finditer(r'\b(src|href|srcset|poster|data|action|formaction|background|imagesrcset|content)\s*=\s*("[^"]*"|\'[^\']*\'|[^\s>]+)', tag, re.I):
            val = a.group(2).strip('"\'')
            if a.group(1).lower() == 'content' and not re.search(r'http-equiv\s*=\s*["\']?refresh', tag, re.I):
                continue
            if re.search(r'(?:^|[\s,;=])(?:https?:)?//', val, re.I):
                fetch.append(tag[:160])
    # <style> blocks and style="" attributes
    for m in re.finditer(r'url\(\s*["\']?\s*((?:https?:)?//[^)"\']+)|@import\s+["\']((?:https?:)?//[^"\']+)', styles + ' ' + markup_only, re.I):
        fetch.append('css: ' + (m.group(1) or m.group(2)))
    for m in SCRIPT_RE.finditer(html):
        for u in re.finditer(r'https?://[^\s"\'`)<>]+', m.group('body')):
            inert.append(u.group(0))
    return fetch, inert


def set_viewport(html, android):
    m = re.search(r'<meta\s+name=["\']viewport["\']\s+content=["\']([^"\']*)["\'][^>]*>', html, re.I)
    if not android:
        return html
    if m:
        items = [p.strip() for p in m.group(1).split(',') if p.strip()]
        kv = []
        for p in items:
            k, _, v = p.partition('=')
            kv.append([k.strip().lower(), v.strip()])
        keys = [k for k, _ in kv]
        for k, v in (('maximum-scale', '1'), ('user-scalable', 'no'), ('viewport-fit', 'cover')):
            if k in keys:
                if k != 'viewport-fit':
                    kv[keys.index(k)][1] = v
            else:
                kv.append([k, v])
        content = ', '.join(k + ('=' + v if v else '') for k, v in kv)
        return html[:m.start()] + '<meta name="viewport" content="%s">' % content + html[m.end():]
    tag = '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">'
    return re.sub(r'(<head\b[^>]*>)', lambda mm: mm.group(1) + '\n' + tag, html, count=1, flags=re.I)


def inject_target(html, target):
    snippet = "<script>window.__APP_TARGET__='%s'</script>" % target
    m = re.search(r'<meta\s+charset\s*=\s*["\']?utf-8["\']?\s*/?>[ \t]*\r?\n?', html, re.I)
    if m:
        return html[:m.end()] + snippet + '\n' + html[m.end():], snippet
    h = re.search(r'<head\b[^>]*>\s*', html, re.I)
    if not h:
        die('no <head> in input')
    return html[:h.end()] + '<meta charset="utf-8">\n' + snippet + '\n' + html[h.end():], snippet


# ---------------------------------------------------------------------------------------------
# Optional headless verification
# ---------------------------------------------------------------------------------------------
VERIFY_JS = r"""
const path = require('path');
function loadPw() {
  const tries = [process.env.PLAYWRIGHT_MODULE, '/opt/node22/lib/node_modules/playwright', 'playwright'].filter(Boolean);
  for (const t of tries) { try { return require(t); } catch (e) {} }
  throw new Error('playwright not found (set PLAYWRIGHT_MODULE)');
}
(async () => {
  const { chromium } = loadPw();
  const file = path.resolve(process.argv[1]);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const remote = [], errors = [];
  page.on('request', r => { const u = r.url(); if (!/^(file|data|blob|about):/i.test(u)) remote.push(u); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto('file://' + file);
  await page.waitForTimeout(1000);
  const r = {};
  r.target = await page.evaluate(() => window.__APP_TARGET__);
  await page.click('[data-mode="god"]');
  await page.waitForTimeout(300);
  r.year = await page.evaluate(() => { const E = window.__earth; let g = 0; while (E.S.year < 1900 && g++ < 50000) E.tick(1); return E.S.year; });
  await page.evaluate(() => window.__earth.switchView('globe')); await page.waitForTimeout(700);
  await page.evaluate(() => window.__earth.switchView('map')); await page.waitForTimeout(700);
  await page.click('#btnTree'); await page.waitForTimeout(700);
  r.treeOpen = await page.evaluate(() => !document.getElementById('techModal').hidden);
  await browser.close();
  r.remote = remote; r.errors = errors;
  process.stdout.write(JSON.stringify(r));
})().catch(e => { process.stdout.write(JSON.stringify({ fatal: String(e && e.stack || e) })); });
"""


def verify(out_path, target):
    r = subprocess.run(['node', '-e', VERIFY_JS, out_path], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=600)
    try:
        res = json.loads(r.stdout.decode('utf-8'))
    except ValueError:
        die('verify: no result\n' + r.stderr.decode('utf-8', 'replace'))
    if res.get('fatal'):
        die('verify: ' + res['fatal'])
    problems = []
    if res['remote']:
        problems.append('network requests: ' + ', '.join(res['remote'][:10]))
    if res['errors']:
        problems.append('errors: ' + ' | '.join(res['errors'][:10]))
    if res['target'] != target:
        problems.append('__APP_TARGET__ is %r' % res['target'])
    if res['year'] < 1900:
        problems.append('simulation stopped at year %s' % res['year'])
    if not res['treeOpen']:
        problems.append('tech tree did not open')
    if problems:
        die('verify failed: ' + '; '.join(problems))
    print('verify: ok (0 network requests, 0 page errors, year %s, globe<->map, tech tree open)' % res['year'])


# ---------------------------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description='Build the offline / Android single-file version of index.html.')
    ap.add_argument('--in', dest='inp', default=DEFAULT_IN, help='input HTML (default: index.html)')
    ap.add_argument('--target', choices=['web', 'android'], default='web')
    ap.add_argument('--out', default=None, help='output path (default: dist/blue-planet-offline.html or dist/blue-planet-android.html)')
    ap.add_argument('--minify', action='store_true', help='drop whitespace in JS/CSS (identifiers are never renamed)')
    ap.add_argument('--verify', action='store_true', help='load the result in headless Chromium (Playwright) and play a short session')
    ap.add_argument('--quiet', action='store_true', help='print only the summary line')
    args = ap.parse_args()
    out_path = os.path.abspath(args.out or DEFAULT_OUT[args.target])
    inp = os.path.abspath(args.inp)
    if out_path == inp:
        die('refusing to overwrite the input file')
    with open(inp, encoding='utf-8') as fh:
        html = fh.read()

    ensure_node_modules()

    # a. no Google Fonts
    html, n_font = strip_font_refs(html)

    # b./c. collect inline scripts and styles, transform them in one node run
    scripts = [m for m in SCRIPT_RE.finditer(html) if is_classic_inline(m.group('attrs')) and m.group('body').strip()]
    styles = list(STYLE_RE.finditer(html))
    if not scripts:
        die('no inline <script> found in ' + inp)
    target_snippet = "window.__APP_TARGET__='%s'" % args.target
    job = {'targets': TARGETS, 'minify': args.minify,
           # esbuild flags destructuring as unsupported before Safari 14.1 over an edge-case
           # conformance bug and cannot lower it anyway; plain destructuring works in Safari 10+
           # and Chrome 49+, so keep it.
           'supported': {'destructuring': True},
           'scripts': [m.group('body') for m in scripts], 'styles': [m.group('body') for m in styles],
           'es5': {'app-target snippet': target_snippet}}
    res = run_node(job)
    js_all = '\n'.join(s['code'] for s in res['scripts'] if s)
    poly_names, poly_code = build_polyfills(js_all)
    if poly_code:
        res2 = run_node({'targets': TARGETS, 'minify': False, 'supported': {}, 'scripts': [], 'styles': [], 'es5': {'polyfill script': poly_code}})
        res['errors'] += res2['errors']
    if res['errors']:
        die('\n  '.join(['transform/verification failed:'] + res['errors']))

    missing = [label for rx, label in UNPOLYFILLED if re.search(rx, js_all)]

    css_stats = {'minmax/env': 0, 'logical': 0, 'color-mix': 0, 'gap': 0}
    new_styles = []
    for css in res['styles']:
        css2, st = css_fallbacks(css)
        for k in css_stats:
            css_stats[k] += st[k]
        new_styles.append(css2)

    # splice transformed bodies back (from the end so offsets stay valid)
    edits = [(m.start('body'), m.end('body'), s['code'].rstrip('\n') + '\n') for m, s in zip(scripts, res['scripts'])]
    edits += [(m.start('body'), m.end('body'), '\n' + c.rstrip('\n') + '\n') for m, c in zip(styles, new_styles)]
    for a, b, text in sorted(edits, key=lambda e: e[0], reverse=True):
        html = html[:a] + text + html[b:]

    # d. polyfills right before the first inline script
    if poly_code:
        first = next(m for m in SCRIPT_RE.finditer(html) if is_classic_inline(m.group('attrs')) and m.group('body').strip())
        html = html[:first.start()] + '<script>\n' + poly_code + '\n</script>\n' + html[first.start():]

    # e. app target marker + android viewport
    html, _ = inject_target(html, args.target)
    html = set_viewport(html, args.target == 'android')

    fetch, inert = external_fetches(html)
    if fetch:
        die('output would still fetch remote resources:\n  ' + '\n  '.join(fetch))
    if re.search(r'(?:https?:)?//fonts\.(?:googleapis|gstatic)\.com', html, re.I):
        die('Google Fonts reference reintroduced')

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    data = html.encode('utf-8')
    with open(out_path, 'wb') as fh:
        fh.write(data)
    gz = len(gzip.compress(data, 9))

    if not args.quiet:
        print('esbuild %s, acorn %s, targets %s' % (res['esbuild'], res['acorn'], ','.join(TARGETS)))
        print('removed %d Google Fonts reference(s); transpiled %d script(s), %d style block(s); '
              "'use strict' directives kept: %s" % (n_font, len(scripts), len(styles), ','.join(str(s['strict']) for s in res['scripts'])))
        print('acorn ecmaVersion 2018: ok (no ES2019+ syntax, no Chrome 62+ regex features)')
        print('CSS fallbacks added: %d min/max/clamp/env, %d logical-property, %d color-mix, %d grid-gap'
              % (css_stats['minmax/env'], css_stats['logical'], css_stats['color-mix'], css_stats['gap']))
        print('polyfills (%d): %s' % (len(poly_names), ', '.join(poly_names) or 'none'))
        for w in res['warnings']:
            print('warning: ' + w)
        if missing:
            print('WARNING: referenced APIs without a polyfill (must be feature-detected in src): ' + '; '.join(missing))
        if inert:
            print('note: %d http(s) string(s) inside scripts (not fetched by markup/CSS): %s' % (len(inert), ', '.join(sorted(set(inert))[:5])))
    print('%s [%s]: %d bytes, %d gzip, %d polyfill(s)' % (out_path, args.target, len(data), gz, len(poly_names)))

    if args.verify:
        verify(out_path, args.target)


if __name__ == '__main__':
    main()
