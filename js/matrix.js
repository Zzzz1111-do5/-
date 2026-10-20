'use strict';
// 数码雨：WebGL 着色器把地形渲染成字符矩阵。每种地形用不同字符与色调，叠加下落代码流与视野明暗
const MX = { ok: false, gl: null, cv: null, u: {}, tex: {}, seed: null, gp: 0 };
const KANA = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲンガギグゲゴザジズゼゾダヂ';
const SYMS = '=+-*:.<>|¦_"!#$%&()[]{}~^/Z@;?';
const SPECIAL = '~≈x^|‖#=·+:-*/\\%';   // 96 起：浅滩 河流 暗礁 礁岸 悬崖 悬崖 桥 路 路 …
const GLYPHS = KANA.slice(0, 56) + '0123456789' + SYMS.slice(0, 30);

const MX_VS = 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }';
const MX_FS = `
precision highp float;
uniform vec2 uRes; uniform vec3 uView; uniform float uTime, uFlash, uGlyph;
uniform sampler2D uTer, uFog, uAtlas;
const vec2 GRID = vec2(160., 100.);
float h1(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec2 fc = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 w = (fc - uView.yz) / uView.x;
  vec3 bg = vec3(.004, .016, .009);
  if (w.x < 0. || w.y < 0. || w.x >= 1600. || w.y >= 1000.) { gl_FragColor = vec4(bg * .5, 1.); return; }
  vec2 cell = floor(w / 10.), f = fract(w / 10.);
  vec4 ter = texture2D(uTer, (cell + .5) / GRID);
  float elev = ter.r, typ = floor(ter.g * 255. / 16. + .5);
  float land = step(2.5, typ);
  float vis = texture2D(uFog, w / vec2(1600., 1000.)).r;
  float b0 = floor(elev * 6.);
  float bR = floor(texture2D(uTer, (cell + vec2(1.5, .5)) / GRID).r * 6.);
  float bD = floor(texture2D(uTer, (cell + vec2(.5, 1.5)) / GRID).r * 6.);
  float contour = land * step(.5, b0) * max(step(.5, abs(bR - b0)), step(.5, abs(bD - b0)));
  float rain = 0., head = 0.;
  for (int k = 0; k < 2; k++) {
    float fk = float(k);
    float sp = 3. + h1(vec2(cell.x, 7. + fk)) * 9.;
    float len = 6. + h1(vec2(cell.x, 3. + fk)) * 24.;
    float total = 100. + len + h1(vec2(cell.x, 19. + fk)) * 80.;
    float d = mod(uTime * sp + h1(vec2(cell.x, 11. + fk)) * total, total) - cell.y;
    if (d >= 0. && d < len) { rain = max(rain, 1. - d / len); head = max(head, step(d, 1.)); }
  }
  float rate = .12 + h1(cell + 5.) * 1.4 + rain * 7.;
  float n = h1(cell + floor(uTime * rate + h1(cell) * 10.));
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
  else if (typ < 11.5) { gi = 96. + step(.5, fract(n + uTime * .7 - cell.y * .13)); base = .5; tint = cyan; }
  else if (typ < 12.5) { gi = 102.; base = 1.; tint = vec3(.85, 1., .9); }
  else if (typ < 13.5) { gi = 103. + step(.6, n); base = .5; tint = vec3(.6, 1., .72); }
  else if (typ < 14.5) { gi = 56. + floor(n * 10.); base = .6; }
  else { gi = 97.; base = .7; tint = cyan; }
  vec2 g = vec2(mod(gi, 16.), floor(gi / 16.));
  float a = texture2D(uAtlas, (g + mix(vec2(.05), vec2(.95), f)) / vec2(16., 7.)).a;
  a = mix(.5, a, smoothstep(4., 8., uGlyph));
  float lit = mix(.45, 1., vis) * mix(1., .5, smoothstep(14., 34., uGlyph));   // 近看时压暗地形，让部队更醒目
  base = (base + contour * .4 * land) * lit;
  float r = rain * (land > .5 ? .45 : .32) * mix(.55, 1., vis) * mix(1., .55, smoothstep(14., 34., uGlyph));
  vec3 c = bg + tint * (base + r) * a;
  c += vec3(.78, 1., .88) * head * a * (land > .5 ? .75 : .55) * mix(.5, 1., vis);
  c += land * tint * (.025 + elev * .06 + contour * .05) * mix(.6, 1., vis);
  c += vec3(.17, 1., .47) * (vis * .012 + uFlash * .07);
  gl_FragColor = vec4(c, 1.);
}`;

function mxInit() {
  try {
    const cv = document.createElement('canvas');
    const gl = cv.getContext('webgl', { antialias: false, preserveDrawingBuffer: true, premultipliedAlpha: false });
    if (!gl) return;
    const sh = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, MX_VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, MX_FS));
    gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
    gl.useProgram(pr);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(pr, 'p');
    gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    for (const n of ['uRes', 'uView', 'uTime', 'uFlash', 'uGlyph', 'uTer', 'uFog', 'uAtlas']) MX.u[n] = gl.getUniformLocation(pr, n);
    ['ter', 'fog', 'atlas'].forEach((k, i) => {
      const t = gl.createTexture(), filt = k === 'ter' ? gl.NEAREST : gl.LINEAR;
      gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filt); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filt);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      MX.tex[k] = t;
    });
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.uniform1i(MX.u.uTer, 0); gl.uniform1i(MX.u.uFog, 1); gl.uniform1i(MX.u.uAtlas, 2);
    Object.assign(MX, { gl, cv, ok: true });
    if (document.fonts && document.fonts.load)
      Promise.all([document.fonts.load('24px "Noto Sans SC"', KANA + SPECIAL), document.fonts.load('24px "IBM Plex Mono"', '0123456789')])
        .then(() => { if (MX.ok) { MX.gp = 0; mxAtlas(); } }).catch(() => {});
  } catch (e) { MX.ok = false; console.warn('WebGL 不可用，使用像素地形', e); }
}

function mxTerrain() {
  const { gl } = MX, d = new Uint8Array(GW * GH * 4);
  for (let i = 0; i < GW * GH; i++) { d[i * 4] = Math.round(TER.elev[i] * 255); d[i * 4 + 1] = TER.type[i] * 16; d[i * 4 + 3] = 255; }
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, MX.tex.ter);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, GW, GH, 0, gl.RGBA, gl.UNSIGNED_BYTE, d);
  MX.seed = TER.seed;
}

// 字形图集：按当前缩放生成（变化超过 25% 才重建）
function mxAtlas() {
  const gp = clamp(Math.round(CELL * R.s * R.dpr), 8, 48);
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

function mxDraw(time, flash) {
  const { gl } = MX;
  if (MX.seed !== TER.seed) mxTerrain();
  mxAtlas();
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, MX.tex.fog);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, GW, GH, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, FOGB);
  gl.uniform2f(MX.u.uRes, MX.cv.width, MX.cv.height);
  gl.uniform3f(MX.u.uView, R.s * R.dpr, R.ox * R.dpr, R.oy * R.dpr);
  gl.uniform1f(MX.u.uTime, time % 1000);
  gl.uniform1f(MX.u.uFlash, flash);
  gl.uniform1f(MX.u.uGlyph, CELL * R.s * R.dpr);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

// 视野字节图（0/255），供着色器与像素降级方案共用
const FOGB = new Uint8Array(GW * GH);
function fogBytes() { for (let i = 0; i < GW * GH; i++) FOGB[i] = PV[i] ? 255 : 0; }
