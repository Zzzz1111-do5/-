// Lua 语法检查 + 未定义全局变量检查（这台机器上没有 Luau / Lua，自己写一个）
// 只认 Lua 5.1 语法（Luau 兼容它）：脚本里不用 Luau 专有写法（+=、continue、类型标注、`字符串插值`），这样这里能查到。
// 用法：node roblox/tools/luacheck.mjs [文件或目录…]（默认查 roblox/src）
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const KW = new Set(['and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function', 'if', 'in', 'local', 'nil', 'not', 'or', 'repeat', 'return', 'then', 'true', 'until', 'while']);
// Roblox 里的全局变量
const GLOBALS = new Set(('game workspace script plugin shared _G _VERSION Instance Vector3 Vector2 CFrame Color3 BrickColor UDim UDim2 Rect Ray ' +
  'RaycastParams OverlapParams TweenInfo NumberRange NumberSequence NumberSequenceKeypoint ColorSequence ColorSequenceKeypoint ' +
  'PhysicalProperties Region3 Region3int16 Vector3int16 Vector2int16 Faces Axes Font Random DateTime Enum PathWaypoint CatalogSearchParams ' +
  'task math string table coroutine os debug utf8 bit32 buffer pairs ipairs next select type typeof tostring tonumber print warn error ' +
  'assert pcall xpcall require setmetatable getmetatable rawget rawset rawequal rawlen unpack tick time elapsedTime settings ' +
  'UserSettings version gcinfo newproxy collectgarbage').split(/\s+/));

class LuaError extends Error {}

function lex(src, file) {
  const toks = [];
  let i = 0, line = 1;
  const n = src.length;
  const err = m => { throw new LuaError(`${file}:${line}: ${m}`); };
  const longLevel = at => { // at 指向 '['：返回长括号层级，不是长括号返回 -1
    let j = at + 1, lv = 0;
    while (src[j] === '=') { lv++; j++; }
    return src[j] === '[' ? lv : -1;
  };
  const readLong = lv => {
    const close = ']' + '='.repeat(lv) + ']';
    const k = src.indexOf(close, i + lv + 2);
    if (k < 0) err('长字符串 / 长注释没有结束');
    const s = src.slice(i + lv + 2, k);
    for (const c of s) if (c === '\n') line++;
    i = k + close.length;
    return s;
  };
  while (i < n) {
    const c = src[i];
    if (c === '\n') { line++; i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r' || c === '﻿') { i++; continue; }
    if (c === '-' && src[i + 1] === '-') {
      i += 2;
      if (src[i] === '[') { const lv = longLevel(i); if (lv >= 0) { readLong(lv); continue; } }
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    const tl = line;
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_]/.test(src[j])) j++;
      const w = src.slice(i, j);
      i = j;
      toks.push({ t: KW.has(w) ? w : 'name', v: w, line: tl });
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      let j = i;
      if (c === '0' && /[xX]/.test(src[i + 1] || '')) { j += 2; while (/[0-9a-fA-F]/.test(src[j] || '')) j++; }
      else {
        while (/[0-9]/.test(src[j] || '')) j++;
        if (src[j] === '.') { j++; while (/[0-9]/.test(src[j] || '')) j++; }
        if (/[eE]/.test(src[j] || '')) {
          j++;
          if (src[j] === '+' || src[j] === '-') j++;
          if (!/[0-9]/.test(src[j] || '')) err('数字写错了');
          while (/[0-9]/.test(src[j] || '')) j++;
        }
      }
      if (/[A-Za-z_]/.test(src[j] || '')) err('数字写错了');
      toks.push({ t: 'number', v: Number(src.slice(i, j)), line: tl });
      i = j;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1, s = '';
      for (;;) {
        if (j >= n || src[j] === '\n') err('字符串没有结束');
        const d = src[j];
        if (d === c) break;
        if (d === '\\') {
          const e = src[j + 1];
          const map = { n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', f: '\f', v: '\v', '\\': '\\', '"': '"', "'": "'", '\n': '\n' };
          if (e === '\n') line++;
          if (e in map) { s += map[e]; j += 2; continue; }
          if (/[0-9]/.test(e)) { let k = j + 1, num = ''; while (k < j + 4 && /[0-9]/.test(src[k])) num += src[k++]; s += String.fromCharCode(+num); j = k; continue; }
          err('字符串里有不认识的转义 \\' + e);
        }
        s += d;
        j++;
      }
      i = j + 1;
      toks.push({ t: 'string', v: s, line: tl });
      continue;
    }
    if (c === '`') err('Luau 字符串插值（反引号）：这里只认 Lua 5.1 写法');
    if (c === '[') {
      const lv = longLevel(i);
      if (lv >= 0) { const s = readLong(lv); toks.push({ t: 'string', v: s, line: tl }); continue; }
    }
    if (src.startsWith('...', i)) { toks.push({ t: '...', line: tl }); i += 3; continue; }
    const two = src.substr(i, 2);
    if (['+=', '-=', '*=', '/=', '..=', '//', '::', '->'].includes(two) || src.startsWith('..=', i)) err(`Luau / 5.2 专有写法 ${two}：这里只认 Lua 5.1 写法`);
    if (['==', '~=', '<=', '>=', '..'].includes(two)) { toks.push({ t: two, line: tl }); i += 2; continue; }
    if ('+-*/%^#<>=(){}[];:,.'.includes(c)) { toks.push({ t: c, line: tl }); i++; continue; }
    err('不认识的字符 ' + JSON.stringify(c));
  }
  toks.push({ t: 'eof', v: '<eof>', line });
  return toks;
}

function check(src, file) {
  const out = [];
  const toks = lex(src, file);
  let p = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];
  const is = t => toks[p].t === t;
  const accept = t => { if (toks[p].t === t) { p++; return true; } return false; };
  const show = tk => tk.t === 'name' || tk.t === 'number' ? String(tk.v) : tk.t === 'string' ? JSON.stringify(tk.v) : tk.t;
  const err = (m, line) => { throw new LuaError(`${file}:${line ?? toks[p].line}: ${m}`); };
  const expect = (t, what) => {
    if (toks[p].t !== t) err(`这里应该是 '${t}'${what ? '（' + what + '）' : ''}，实际是 '${show(toks[p])}'`);
    return toks[p++];
  };

  // 作用域：每层一个 Map（名字 → 声明）
  const scopes = [];
  const open = () => scopes.push(new Map());
  const close = () => {
    const s = scopes.pop();
    for (const [name, d] of s) if (!d.used && !name.startsWith('_') && name !== 'self' && name !== '...' && d.kind === 'local') out.push({ level: 'note', msg: `${file}:${d.line}: 局部变量 '${name}' 没用到` });
  };
  const declare = (tk, kind = 'local') => scopes[scopes.length - 1].set(tk.v, { line: tk.line, used: false, kind });
  const resolve = name => {
    for (let k = scopes.length - 1; k >= 0; k--) { const d = scopes[k].get(name); if (d) { d.used = true; return true; } }
    return false;
  };
  const useName = (tk, assign) => {
    if (resolve(tk.v)) return;
    if (assign) out.push({ level: 'error', msg: `${file}:${tk.line}: 给全局变量 '${tk.v}' 赋值（忘了 local？）` });
    else if (!GLOBALS.has(tk.v)) out.push({ level: 'error', msg: `${file}:${tk.line}: 未定义的变量 '${tk.v}'（拼错了，或者在声明之前就用了）` });
  };

  let loops = 0;
  const fnLoops = [];
  const varargs = [true];
  const blockEnd = () => ['return', 'end', 'else', 'elseif', 'until', 'eof'].includes(peek().t);

  function block() {
    while (!blockEnd()) {
      if (is('break')) {
        const tk = next();
        if (!loops) err('break 不在循环里', tk.line);
        accept(';');
        if (!blockEnd()) err('break 必须是块里最后一句（Lua 5.1）', tk.line);
        return;
      }
      statement();
    }
    if (is('return')) {
      next();
      if (!blockEnd() && !is(';')) explist();
      accept(';');
      if (!['end', 'else', 'elseif', 'until', 'eof'].includes(peek().t)) err('return 必须是块里最后一句');
    }
  }
  function funcbody(isMethod, nameTk) {
    expect('(');
    open();
    fnLoops.push(loops); loops = 0;
    let va = false;
    if (isMethod) declare({ v: 'self', line: nameTk ? nameTk.line : 0 }, 'param');
    if (!is(')')) {
      do {
        if (accept('...')) { va = true; break; }
        declare(expect('name'), 'param');
      } while (accept(','));
    }
    expect(')');
    varargs.push(va);
    block();
    expect('end', `函数从第 ${nameTk ? nameTk.line : '?'} 行开始`);
    varargs.pop();
    loops = fnLoops.pop();
    close();
  }
  function statement() {
    const tk = peek();
    switch (tk.t) {
      case ';': next(); return;
      case 'if': {
        next(); expr(); expect('then');
        open(); block(); close();
        while (is('elseif')) { next(); expr(); expect('then'); open(); block(); close(); }
        if (accept('else')) { open(); block(); close(); }
        expect('end', `'if' 在第 ${tk.line} 行`);
        return;
      }
      case 'while': {
        next(); expr(); expect('do');
        loops++; open(); block(); close(); loops--;
        expect('end', `'while' 在第 ${tk.line} 行`);
        return;
      }
      case 'do': next(); open(); block(); close(); expect('end', `'do' 在第 ${tk.line} 行`); return;
      case 'for': {
        next();
        const n1 = expect('name');
        if (accept('=')) {
          expr(); expect(','); expr();
          if (accept(',')) expr();
          expect('do');
          open(); declare(n1, 'param');
        } else {
          const names = [n1];
          while (accept(',')) names.push(expect('name'));
          expect('in'); explist(); expect('do');
          open(); names.forEach(nm => declare(nm, 'param'));
        }
        loops++; block(); loops--; close();
        expect('end', `'for' 在第 ${tk.line} 行`);
        return;
      }
      case 'repeat': {
        next(); open(); loops++; block(); loops--;
        expect('until', `'repeat' 在第 ${tk.line} 行`); expr(); close();
        return;
      }
      case 'function': {
        next();
        const n = expect('name');
        let plain = true, method = false;
        while (accept('.')) { expect('name'); plain = false; }
        if (accept(':')) { expect('name'); method = true; plain = false; }
        useName(n, plain);
        funcbody(method, n);
        return;
      }
      case 'local': {
        next();
        if (accept('function')) { const n = expect('name'); declare(n, 'fn'); funcbody(false, n); return; }
        const names = [expect('name')];
        while (accept(',')) names.push(expect('name'));
        if (accept('=')) explist();
        names.forEach(nm => declare(nm));
        return;
      }
      default: exprstat();
    }
  }
  function exprstat() {
    const first = suffixed();
    if (is('=') || is(',')) {
      const targets = [first];
      while (accept(',')) targets.push(suffixed());
      expect('=');
      for (const t of targets) if (t.kind === 'call' || t.kind === 'paren') err('不能给这个赋值');
      explist();
      for (const t of targets) if (t.kind === 'name') useName(t.tok, true);
    } else if (first.kind !== 'call') {
      err(`语法错误：'${show(peek())}' 附近（这一句既不是赋值也不是函数调用）`);
    }
  }
  const BIN = { or: [1, 1], and: [2, 2], '<': [3, 3], '>': [3, 3], '<=': [3, 3], '>=': [3, 3], '~=': [3, 3], '==': [3, 3], '..': [5, 4], '+': [6, 6], '-': [6, 6], '*': [7, 7], '/': [7, 7], '%': [7, 7], '^': [10, 9] };
  function expr(limit = 0) {
    if (is('not') || is('-') || is('#')) { next(); expr(8); }
    else simple();
    for (;;) {
      const op = BIN[peek().t];
      if (!op || op[0] <= limit) break;
      next();
      expr(op[1]);
    }
  }
  function simple() {
    const tk = peek();
    switch (tk.t) {
      case 'number': case 'string': case 'nil': case 'true': case 'false': next(); return;
      case '...': next(); if (!varargs[varargs.length - 1]) err("'...' 不在可变参数函数里"); return;
      case '{': table(); return;
      case 'function': next(); funcbody(false, tk); return;
      default: { const e = suffixed(); if (e.kind === 'name') useName(e.tok, false); }
    }
  }
  function primary() {
    const tk = peek();
    if (tk.t === 'name') { next(); return { kind: 'name', tok: tk }; }
    if (tk.t === '(') { next(); expr(); expect(')'); return { kind: 'paren' }; }
    err(`语法错误：意外的 '${show(tk)}'`);
  }
  function suffixed() {
    let e = primary();
    for (;;) {
      const tk = peek();
      if (!['.', '[', ':', '(', '{', 'string'].includes(tk.t)) return e;
      if (e.kind === 'name') { useName(e.tok, false); }
      if (tk.t === '.') { next(); expect('name'); e = { kind: 'index' }; }
      else if (tk.t === '[') { next(); expr(); expect(']'); e = { kind: 'index' }; }
      else if (tk.t === ':') { next(); expect('name'); args(); e = { kind: 'call' }; }
      else {
        if (tk.t === '(' && toks[p - 1].line !== tk.line) err("有歧义：'(' 在新的一行，会被当成上一句的函数调用（前面加分号）");
        args(); e = { kind: 'call' };
      }
    }
  }
  function args() {
    if (is('string')) { next(); return; }
    if (is('{')) { table(); return; }
    const o = expect('(');
    if (!is(')')) explist();
    expect(')', `'(' 在第 ${o.line} 行`);
  }
  function explist() { expr(); while (accept(',')) expr(); }
  function table() {
    const o = expect('{');
    while (!is('}')) {
      if (is('[')) { next(); expr(); expect(']'); expect('='); expr(); }
      else if (is('name') && toks[p + 1].t === '=') { next(); next(); expr(); }
      else expr();
      if (!accept(',') && !accept(';')) break;
    }
    expect('}', `'{' 在第 ${o.line} 行`);
  }

  open();
  block();
  if (!is('eof')) err(`这里多了 '${show(peek())}'（end 多写了？）`);
  close();
  return out;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const targets = args.length ? args : [path.join(here, '..', 'src')];
const files = [];
const walk = f => {
  if (fs.statSync(f).isDirectory()) for (const g of fs.readdirSync(f).sort()) walk(path.join(f, g));
  else if (f.endsWith('.lua')) files.push(f);
};
targets.forEach(walk);
let bad = 0, notes = 0;
for (const f of files) {
  const rel = path.relative(process.cwd(), f);
  try {
    for (const r of check(fs.readFileSync(f, 'utf8'), rel)) {
      if (r.level === 'error') { bad++; console.log('错误 ' + r.msg); }
      else { notes++; console.log('提示 ' + r.msg); }
    }
  } catch (e) {
    if (!(e instanceof LuaError)) throw e;
    bad++;
    console.log('语法 ' + e.message);
  }
}
console.log(`${files.length} 个文件，${bad} 个错误，${notes} 条提示`);
process.exit(bad ? 1 : 0);
