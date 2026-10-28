'use strict';
// 数码雨：WebGL 着色器把地形渲染成字符矩阵。每种地形用不同字符与色调，叠加下落代码流与视野明暗
// 近看时：字符按缩放细分（屏幕上约 9–18px），对比度逐渐淡出，过渡为安静的着色战术地图（地形底色、山体阴影、等高线、林/沼/田小纹理）
// 四个着色器变体（按缩放切换，只算需要的部分）：0 纯数码矩阵（全图）· 1 矩阵→地图过渡（只混底色）· 2 过渡后段（加等高线与地形小纹理）· 3 纯地图（不算代码流）
const MX = { ok: false, tried: false, gl: null, cv: null, P: [], u: {}, tex: {}, seed: null, gp: 0, sub: 1, map: 0, der: false, mode: -1 };
const KANA = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲンガギグゲゴザジズゼゾダヂ';
const SYMS = '=+-*:.<>|¦_"!#$%&()[]{}~^/Z@;?';
const SPECIAL = '~≈x^|‖#=·+:-*/\\%';   // 96 起：浅滩 河流 暗礁 礁岸 悬崖 悬崖 桥 路 路 …
const GLYPHS = KANA.slice(0, 56) + '0123456789' + SYMS.slice(0, 30);
const MX_GLYPH = 12;            // 目标字符屏幕尺寸（CSS px）
const MX_MAP = [6, 26];         // 每格屏幕像素在此区间内，从数码矩阵过渡到战术地图
// 战术地图底色（暗色），按地形类型
const MX_TINT = [[3, 10, 12], [6, 22, 25], [30, 9, 14], [30, 31, 17], [19, 25, 21], [36, 46, 40], [10, 23, 13], [6, 30, 14],
  [13, 29, 16], [26, 34, 28], [7, 23, 21], [8, 32, 46], [52, 60, 54], [30, 40, 32], [17, 21, 19], [10, 40, 46]];
// 地图小纹理参数：[颜色 rgb, 形式(0 横线 1 竖线 2/3 斜线 4 田垄按地块 5 圆点 6 无), 尺寸(线半宽/点半径), 间距, 划线周期, 占空]；河流/渡口的划线随时间流动
const MX_MARK = [
  [[.016, .05, .06], 0, .22, 12, 12, .22], [[.03, .1, .11], 0, .28, 10, 10, .3], [[.3, .06, .1], 5, .8], [[.09, .085, .04], 5, .42],
  [[.06, .08, .07], 5, 1], [[.055, .075, .065], 2, .22, 2.4], [[.014, .032, .017], 4, .2, 2.8], [[.035, .14, .06], 5, 1.7],
  [[0, 0, 0], 6], [[.05, .07, .06], 3, .3, 3.2], [[.03, .15, .14], 0, .3, 4.2, 5, .45], [[.03, .13, .17], 0, .27, 3.4, 6, .38],
  [[0, 0, 0], 6], [[0, 0, 0], 6], [[0, 0, 0], 6], [[.03, .13, .17], 0, .27, 3.4, 6, .38]];

const MX_VS = 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }';
const MX_FS = (der, mode) => `${der && mode > 1 ? '#extension GL_OES_standard_derivatives : enable\n#define DER 1\n' : ''}#define MODE ${mode}
#define MATRIX ${mode < 3 ? 1 : 0}
#define MAP ${mode > 0 ? 1 : 0}
#define MARKS ${mode > 1 ? 1 : 0}
precision highp float;
uniform vec2 uRes; uniform vec3 uView; uniform float uTime, uFlash, uGlyph, uRain, uSub, uMap, uCont;
uniform sampler2D uTer, uFog, uAtlas, uCol, uMk;
const vec2 GRID = vec2(${GW}., ${GH}.);
const vec2 WORLD = vec2(${W}., ${H}.);
float h1(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
#if MARKS
float dotm(vec2 p, vec2 c, float r, float aa) { return 1. - smoothstep(r - aa, r + aa, length(p - c)); }
// 地图小纹理：按地形查参数表（避免分支）。圆点用格内坐标 q，线用世界坐标 w（跨格连续）
vec3 marks(float typ, vec2 q, vec2 w, float h, float h2, float patch, float aa, float t) {
  float u = (typ + .5) / 16.;
  vec4 m0 = texture2D(uMk, vec2(u, .25)), m1 = texture2D(uMk, vec2(u, .75));
  float kind = floor(m1.g * 255. / 40. + .5), sz = m0.a * 4.;
  float D = max(dotm(q, vec2(2.6 + h * 1.6, 2.6 + h2 * 1.6), sz, aa), dotm(q, vec2(7.2 - h2 * 1.2, 7. - h * 1.2), sz * .88, aa));
  D = max(D, dotm(q, vec2(7.3 - h * .8, 2.5 + h2 * .6), sz * .62, aa) * step(.35, h2));
  float dc = kind > 3.5 ? patch : kind;
  vec2 dv = dc < .5 ? vec2(0., 1.) : dc < 1.5 ? vec2(1., 0.) : dc < 2.5 ? vec2(.7071, .7071) : vec2(.7071, -.7071);
  float sp = max(m1.r * 12.75, .5), v = dot(w, dv);
  float L = 1. - smoothstep(sz - aa, sz + aa, abs(fract(v / sp) - .5) * sp);
  float per = max(m1.b * 12.75, .5);
  float flow = (step(10.5, typ) * step(typ, 11.5) + step(14.5, typ)) * 1.4;
  L *= step(fract((dot(w, vec2(dv.y, -dv.x)) + h * 7. + t * flow) / per), m1.a * .999);
  return m0.rgb * .4 * (kind > 5.5 ? 0. : kind > 4.5 ? D : L);
}
#endif
void main() {
  vec2 fc = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 w = (fc - uView.yz) / uView.x;
  vec3 bg = vec3(.004, .016, .009);
  if (w.x < 0. || w.y < 0. || w.x >= WORLD.x || w.y >= WORLD.y) { gl_FragColor = vec4(bg * .5, 1.); return; }
#if MODE < 2
  vec2 cell = floor(w / 10.), gc = cell, f = fract(w / 10.);   // 前两档每格一个字符（不细分）
#else
  vec2 cell = floor(w / 10.), sw = w / 10. * uSub, gc = floor(sw), f = fract(sw);
#endif
  vec4 ter = texture2D(uTer, (cell + .5) / GRID);
  float elev = ter.r, typ = floor(ter.g * 255. / 16. + .5);
  float land = step(2.5, typ);
  float vis = texture2D(uFog, w / WORLD).r;
  float contour = 0.;
#if MODE == 0
  float b0 = floor(elev * 6.);
  float bR = floor(texture2D(uTer, (cell + vec2(1.5, .5)) / GRID).r * 6.);
  float bD = floor(texture2D(uTer, (cell + vec2(.5, 1.5)) / GRID).r * 6.);
  contour = land * step(.5, b0) * max(step(.5, abs(bR - b0)), step(.5, abs(bD - b0))) * uCont;
#endif
  float rain = 0., head = 0.;
#if MATRIX
  for (int k = 0; k < ${mode > 1 ? 1 : 2}; k++) {   // 代码流按字符列计算：细分后屏幕密度不变（过渡后段只算一条，此时字符层已很淡）
    float fk = float(k);
    float sp = 3. + h1(vec2(gc.x, 7. + fk)) * 9.;
    float len = 6. + h1(vec2(gc.x, 3. + fk)) * 24.;
    float total = GRID.y + len + h1(vec2(gc.x, 19. + fk)) * 80.;
#if MODE < 2
    float d = mod(uTime * sp + h1(vec2(gc.x, 11. + fk)) * total, total) - gc.y;
    if (d >= 0. && d < len) { rain = max(rain, 1. - d / len); head = max(head, step(d, 1.)); }
#else
    float d = mod(mod(uTime * sp + h1(vec2(gc.x, 11. + fk)) * total, total) - gc.y, total);   // 细分后行数超过周期：环绕
    if (d < len) { rain = max(rain, 1. - d / len); head = max(head, step(d, 1.)); }
#endif
  }
#endif
  float rate = (.12 + h1(gc + 5.) * 1.4 + rain * uRain * 7.)${mode ? ' * mix(1., .25, uMap)' : ''};
  float n = h1(gc + floor(uTime * rate + h1(gc) * 10.));
  float gi = floor(n * 66.), base = 0.;
  vec3 tint = vec3(.17, 1., .47);
  vec3 cyan = vec3(.25, .85, 1.);
  if (typ < .5) { base = 0.; }
  else if (typ < 1.5) { gi = 96. + step(.5, n); base = .11; tint = mix(tint, cyan, .5); }
  else if (typ < 2.5) { gi = 98.; base = .5; tint = vec3(1., .26, .4); }
  else if (typ < 3.5) { gi = 66. + floor(n * 30.); base = .55; }
  else if (typ < 4.5) { gi = 99.; base = .32; }
  else if (typ < 5.5) { gi = 100. + step(.5, n); base = .85; }
  else if (typ < 6.5) { gi = floor(n * 56.); base = .14 + elev * .4; }
  else if (typ < 7.5) { gi = floor(n * 56.); base = .3 + elev * .4; tint = vec3(.3, 1., .38); }
  else if (typ < 8.5) { gi = floor(n * 56.); base = .25 + elev * .55; }
  else if (typ < 9.5) { gi = floor(n * 56.); base = .55 + elev * .4; tint = vec3(.55, 1., .7); }
  else if (typ < 10.5) { gi = 97.; base = .22; tint = mix(tint, cyan, .35); }
  else if (typ < 11.5) { gi = 96. + step(.5, fract(n + uTime * .7 - gc.y * .13)); base = .5; tint = cyan; }
  else if (typ < 12.5) { gi = 102.; base = 1.; tint = vec3(.85, 1., .9); }
  else if (typ < 13.5) { gi = 103. + step(.6, n); base = .5; tint = vec3(.6, 1., .72); }
  else if (typ < 14.5) { gi = 56. + floor(n * 10.); base = .6; }
  else { gi = 97.; base = .7; tint = cyan; }
  vec2 g = vec2(mod(gi, 16.), floor(gi / 16.));
  float a = texture2D(uAtlas, (g + mix(vec2(.05), vec2(.95), f)) / vec2(16., 7.)).a;
  a = mix(.5, a, smoothstep(4., 8., uGlyph));
  float lit = mix(.45, 1., vis);
  rain *= uRain; head *= uRain;
  float r = rain * (land > .5 ? .45 : .32) * mix(.55, 1., vis);
  vec3 c = vec3(0.);
#if MATRIX
  c = bg + tint * ((base + contour * .4 * land) * lit + r) * a;
  c += vec3(.78, 1., .88) * head * a * (land > .5 ? .75 : .55) * mix(.5, 1., vis);
  c += land * tint * (.025 + elev * .06 + contour * .05) * mix(.6, 1., vis);
  c += vec3(.17, 1., .47) * (vis * .012 + uFlash * .07);
#endif
#if MAP
  // 战术地图：底色（含山体阴影）+ 等高线 + 小纹理 + 极淡的字符与代码流
  vec4 tc = texture2D(uCol, w / WORLD);
  vec3 m = bg + tc.rgb;
#if MARKS
  m += marks(typ, fract(w / 10.) * 10., w, ter.b, fract(ter.b * 13.7 + .31), ter.a, 1. / uView.x, uTime) * smoothstep(.55, .85, uMap);
#endif
#ifdef DER
  float ev = tc.a * 12., fw = max(fwidth(ev), 1e-4);
  float cl = 1. - smoothstep(.45, 1.3, abs(fract(ev + .5) - .5) / fw);
  float major = step(abs(mod(floor(ev + .5), 4.)), .5);
  m += vec3(.12, .5, .26) * cl * land * mix(.1, .2, major) * step(.04, tc.a) * smoothstep(.55, .85, uMap);
#endif
  m *= mix(.5, 1., vis);
  m += tint * (base * lit * .1 + r * .35) * a + vec3(.78, 1., .88) * head * a * .08 * mix(.5, 1., vis);
  m += vec3(.17, 1., .47) * (vis * .008 + uFlash * .03);
  c = MATRIX == 0 ? m : mix(c, m, uMap);
#endif
  gl_FragColor = vec4(c, 1.);
}`;

function mxInit() {
  MX.tried = true;
  try {
    const cv = document.createElement('canvas');
    const gl = cv.getContext('webgl', { antialias: false, preserveDrawingBuffer: true, premultipliedAlpha: false });
    if (!gl) return;
    const sh = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    MX.der = !!gl.getExtension('OES_standard_derivatives');
    const vs = sh(gl.VERTEX_SHADER, MX_VS), buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    MX.P = [0, 1, 2, 3].map(mode => {
      const pr = gl.createProgram();
      gl.attachShader(pr, vs); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, MX_FS(MX.der, mode)));
      gl.linkProgram(pr);
      if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
      gl.useProgram(pr);
      const loc = gl.getAttribLocation(pr, 'p'), u = {};
      gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      for (const n of ['uRes', 'uView', 'uTime', 'uFlash', 'uGlyph', 'uRain', 'uSub', 'uMap', 'uCont', 'uTer', 'uFog', 'uAtlas', 'uCol', 'uMk']) u[n] = gl.getUniformLocation(pr, n);
      ['uTer', 'uFog', 'uAtlas', 'uCol', 'uMk'].forEach((n, i) => { if (u[n]) gl.uniform1i(u[n], i); });
      return { pr, u };
    });
    ['ter', 'fog', 'atlas', 'col', 'mk'].forEach((k, i) => {
      const t = gl.createTexture(), filt = k === 'ter' || k === 'mk' ? gl.NEAREST : gl.LINEAR;
      gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filt); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filt);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      MX.tex[k] = t;
    });
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    Object.assign(MX, { gl, cv, ok: true });
    mxMarks();
    if (document.fonts && document.fonts.load)
      Promise.all([document.fonts.load('24px "Noto Sans SC"', KANA + SPECIAL), document.fonts.load('24px "IBM Plex Mono"', '0123456789')])
        .then(() => { if (MX.ok) { MX.gp = 0; mxAtlas(); } }).catch(() => {});
  } catch (e) { MX.ok = false; console.warn('WebGL 不可用，使用像素地形', e); }
}

// 小纹理参数表 → 16×2 纹理（行 0 颜色/尺寸 · 行 1 间距/形式/周期/占空）
function mxMarks() {
  const d = new Uint8Array(16 * 2 * 4), b = v => clamp(Math.round(v), 0, 255);
  MX_MARK.forEach(([c, kind, sz = 0, sp = 1, per = 1, duty = 1], t) => {
    const r0 = t * 4, r1 = (16 + t) * 4;
    d[r0] = b(c[0] / .4 * 255); d[r0 + 1] = b(c[1] / .4 * 255); d[r0 + 2] = b(c[2] / .4 * 255); d[r0 + 3] = b(sz / 4 * 255);
    d[r1] = b(sp * 20); d[r1 + 1] = b(kind * 40); d[r1 + 2] = b(per * 20); d[r1 + 3] = b(duty * 255);
  });
  const { gl } = MX;
  gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, MX.tex.mk);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 16, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, d);
}

// 地形纹理：R 高程 · G 类型 · B 每格随机数 · A 田块走向；底色纹理：RGB 战术地图底色（高程提亮 + 西北光源山体阴影）· A 高程（线性插值后画等高线）
function mxTerrain() {
  const { gl } = MX, d = new Uint8Array(GW * GH * 4), m = new Uint8Array(GW * GH * 4), E = TER.elev, hr = rng((TER.seed || 1) + 77);
  const patch = [];
  for (let i = 0; i < Math.ceil(GW / 4) * Math.ceil(GH / 4); i++) patch.push(hr() < .5 ? 0 : 255);
  for (let i = 0; i < GW * GH; i++) {
    const t = TER.type[i], e = E[i], gx = i % GW, gy = (i / GW) | 0;
    d[i * 4] = Math.round(e * 255); d[i * 4 + 1] = t * 16; d[i * 4 + 2] = (hr() * 255) | 0; d[i * 4 + 3] = patch[(gy >> 2) * Math.ceil(GW / 4) + (gx >> 2)];
    const ex = E[gy * GW + Math.min(GW - 1, gx + 1)] - E[gy * GW + Math.max(0, gx - 1)];
    const ey = E[Math.min(GH - 1, gy + 1) * GW + gx] - E[Math.max(0, gy - 1) * GW + gx];
    const k = isWater(t) ? 1 : clamp((.78 + e * .6) * (1 + (ex + ey) * 7), .55, 1.6), c = MX_TINT[t] || MX_TINT[0];
    for (let j = 0; j < 3; j++) m[i * 4 + j] = Math.min(255, Math.round(c[j] * k));
    m[i * 4 + 3] = isWater(t) ? 0 : Math.round(e * 255);
  }
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, MX.tex.ter);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, GW, GH, 0, gl.RGBA, gl.UNSIGNED_BYTE, d);
  gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, MX.tex.col);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, GW, GH, 0, gl.RGBA, gl.UNSIGNED_BYTE, m);
  MX.seed = TER.seed;
}

// 字形图集：按当前字符设备像素生成（变化超过 25% 才重建）
function mxAtlas() {
  const gp = clamp(Math.round(CELL * R.s * R.dpr / MX.sub), 8, 48);
  if (MX.gp && Math.abs(gp - MX.gp) / MX.gp < .25) return;
  MX.gp = gp;
  const c = document.createElement('canvas'), g = c.getContext('2d');
  c.width = 16 * gp; c.height = 7 * gp;
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  [...GLYPHS + SPECIAL].forEach((ch, i) => {
    g.save(); g.translate((i % 16 + .5) * gp, (Math.floor(i / 16) + .5) * gp);
    if (i < 56) { g.scale(-1, 1); g.font = `${gp * .88}px "Noto Sans SC", sans-serif`; }
    else g.font = `600 ${gp * .84}px "IBM Plex Mono", "Noto Sans SC", monospace`;
    g.fillText(ch, 0, gp * .04); g.restore();
  });
  const { gl } = MX;
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, MX.tex.atlas);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
}

function mxResize() {
  MX.cv.width = R.cv.width; MX.cv.height = R.cv.height;
  MX.gl.viewport(0, 0, MX.cv.width, MX.cv.height);
}

// 缩放档：每格屏幕像素 → 字符细分数与地图过渡系数（其他渲染也读 MX.map 来减弱辉光等）
function mxZoom() {
  const cpx = CELL * R.s;
  MX.sub = Math.max(1, Math.round(cpx / MX_GLYPH));
  MX.map = smooth(MX_MAP[0], MX_MAP[1], cpx);
  return cpx;
}

function mxDraw(time, flash) {
  const { gl } = MX;
  if (MX.seed !== TER.seed) mxTerrain();
  const cpx = mxZoom(), mode = MX.map <= 0 && MX.sub === 1 ? 0 : MX.map < .55 && MX.sub === 1 ? 1 : MX.map < .985 ? 2 : 3, P = MX.P[mode], u = P.u;
  if (MX.mode !== mode) { gl.useProgram(P.pr); MX.mode = mode; }
  MX.u = u;
  mxAtlas();
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, MX.tex.fog);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, GW, GH, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, FOGB);
  gl.uniform2f(u.uRes, MX.cv.width, MX.cv.height);
  gl.uniform3f(u.uView, R.s * R.dpr, R.ox * R.dpr, R.oy * R.dpr);
  gl.uniform1f(u.uTime, time % 1000);
  gl.uniform1f(u.uFlash, flash);
  gl.uniform1f(u.uGlyph, cpx * R.dpr / MX.sub);
  gl.uniform1f(u.uSub, MX.sub);
  gl.uniform1f(u.uMap, MX.map);
  gl.uniform1f(u.uCont, 1 - smooth(MX_MAP[0] - 2.5, MX_MAP[0], cpx));   // 旧式格子等高线在过渡前淡出
  gl.uniform1f(u.uRain, R.rain * (1 - MX.map * .7));   // 近看时代码流变淡
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

// 视野字节图（0/255），供着色器与像素降级方案共用
let FOGB = new Uint8Array(GW * GH);
onWorld(() => { FOGB = new Uint8Array(GW * GH); });
function fogBytes() { const D = typeof CVL_DISP === 'object' ? CVL_DISP : null; for (let i = 0; i < GW * GH; i++) FOGB[i] = PV[i] || (D && D[i]) ? 255 : 0; }   // 隐蔽小组所在格照常显示为可见（conceal.js）
