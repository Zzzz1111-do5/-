'use strict';
// 数码雨：WebGL 着色器把地形渲染成字符矩阵，叠加下落的代码流与视野明暗。失败时退回像素地形
const MX = { ok: false, gl: null, cv: null, u: {}, tex: {}, fog: null, seed: null };
const KANA = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲンガギグゲゴザジズゼゾダヂ';
const SYMS = '=+-*:.<>|¦_"!#$%&()[]{}~^/Z@;?';
const GLYPHS = KANA.slice(0, 56) + '0123456789' + SYMS.slice(0, 30);

const MX_VS = 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }';
const MX_FS = `
precision highp float;
uniform vec2 uRes; uniform vec3 uView; uniform float uTime; uniform float uFlash;
uniform sampler2D uTer; uniform sampler2D uFog; uniform sampler2D uAtlas;
const vec2 GRID = vec2(120., 80.);
float h1(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec2 fc = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 w = (fc - uView.yz) / uView.x;
  vec3 bg = vec3(.004, .016, .009);
  if (w.x < 0. || w.y < 0. || w.x >= 1200. || w.y >= 800.) { gl_FragColor = vec4(bg, 1.); return; }
  vec2 cell = floor(w / 10.), f = fract(w / 10.);
  vec4 ter = texture2D(uTer, (cell + .5) / GRID);
  float land = step(.5, ter.a), elev = ter.r, typ = floor(ter.g * 255. / 40. + .5);
  float vis = texture2D(uFog, w / vec2(1200., 800.)).r;
  float b0 = floor(elev * 5.);
  float bR = floor(texture2D(uTer, (cell + vec2(1.5, .5)) / GRID).r * 5.);
  float bD = floor(texture2D(uTer, (cell + vec2(.5, 1.5)) / GRID).r * 5.);
  float contour = land * step(.5, b0) * max(step(.5, abs(bR - b0)), step(.5, abs(bD - b0)));
  float rain = 0., head = 0.;
  for (int k = 0; k < 2; k++) {
    float fk = float(k);
    float sp = 3. + h1(vec2(cell.x, 7. + fk)) * 9.;
    float len = 6. + h1(vec2(cell.x, 3. + fk)) * 22.;
    float total = 80. + len + h1(vec2(cell.x, 19. + fk)) * 70.;
    float d = mod(uTime * sp + h1(vec2(cell.x, 11. + fk)) * total, total) - cell.y;
    if (d >= 0. && d < len) { rain = max(rain, 1. - d / len); head = max(head, step(d, 1.)); }
  }
  float rate = .12 + h1(cell + 5.) * 1.4 + rain * 7.;
  float n = h1(cell + floor(uTime * rate + h1(cell) * 10.));
  float gi = land < .5 ? floor(n * 66.) : typ > 4.5 ? 56. + floor(n * 10.) : (typ > .5 && typ < 1.5) ? 66. + floor(n * 30.) : floor(n * 56.);
  vec2 g = vec2(mod(gi, 16.), floor(gi / 16.));
  float a = texture2D(uAtlas, (g + mix(vec2(.05), vec2(.95), f)) / vec2(16., 6.)).a;
  float lit = mix(.46, 1., vis);
  float beach = (typ > .5 && typ < 1.5) ? .42 : 0.;
  float base = land * (.2 + elev * .55 + contour * .42 + beach) * lit;
  float r = rain * (land > .5 ? .5 : .34) * mix(.55, 1., vis);
  vec3 green = vec3(.17, 1., .47);
  vec3 c = bg + green * (base + r) * a;
  c += vec3(.78, 1., .88) * head * a * (land > .5 ? .8 : .55) * mix(.5, 1., vis);
  c += land * green * (.03 + elev * .06 + contour * .05) * mix(.6, 1., vis);
  c += green * vis * .012 + green * uFlash * .07;
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
    for (const n of ['uRes', 'uView', 'uTime', 'uFlash', 'uTer', 'uFog', 'uAtlas']) MX.u[n] = gl.getUniformLocation(pr, n);
    ['ter', 'fog', 'atlas'].forEach((k, i) => {
      const t = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, t);
      const filt = k === 'ter' ? gl.NEAREST : gl.LINEAR;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filt); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filt);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      MX.tex[k] = t;
    });
    gl.uniform1i(MX.u.uTer, 0); gl.uniform1i(MX.u.uFog, 1); gl.uniform1i(MX.u.uAtlas, 2);
    MX.fog = document.createElement('canvas'); MX.fog.width = 240; MX.fog.height = 160;
    Object.assign(MX, { gl, cv, ok: true });
    if (document.fonts && document.fonts.load)
      Promise.all([document.fonts.load('24px "Noto Sans SC"', KANA), document.fonts.load('24px "IBM Plex Mono"', '0123456789')])
        .then(() => MX.ok && mxAtlas()).catch(() => {});
  } catch (e) { MX.ok = false; console.warn('WebGL 不可用，使用像素地形', e); }
}

function mxTerrain() {
  const { gl } = MX, d = new Uint8Array(GW * GH * 4);
  for (let i = 0; i < GW * GH; i++) {
    d[i * 4] = Math.round(TER.elev[i] * 255); d[i * 4 + 1] = TER.type[i] * 40; d[i * 4 + 3] = TER.type[i] ? 255 : 0;
  }
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, MX.tex.ter);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, GW, GH, 0, gl.RGBA, gl.UNSIGNED_BYTE, d);
  MX.seed = TER.seed;
}

// 字形图集：片假名镜像（黑客帝国式）+ 数字 + 符号，按当前缩放生成以保证清晰
function mxAtlas() {
  const gp = clamp(Math.round(CELL * R.s * R.dpr), 10, 40), c = document.createElement('canvas'), g = c.getContext('2d');
  c.width = 16 * gp; c.height = 6 * gp;
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  [...GLYPHS].forEach((ch, i) => {
    const x = (i % 16 + .5) * gp, y = (Math.floor(i / 16) + .5) * gp;
    g.save(); g.translate(x, y);
    if (i < 56) { g.scale(-1, 1); g.font = `${gp * .88}px "Noto Sans SC", sans-serif`; }
    else g.font = `600 ${gp * .82}px "IBM Plex Mono", monospace`;
    g.fillText(ch, 0, gp * .04); g.restore();
  });
  const { gl } = MX;
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, MX.tex.atlas);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
}

function mxResize() {
  MX.cv.width = R.cv.width; MX.cv.height = R.cv.height;
  MX.gl.viewport(0, 0, MX.cv.width, MX.cv.height);
  mxAtlas();
}

function mxDraw(time, flash) {
  const { gl } = MX;
  if (MX.seed !== TER.seed) mxTerrain();
  const g = MX.fog.getContext('2d');
  g.globalCompositeOperation = 'source-over'; g.fillStyle = '#000'; g.fillRect(0, 0, 240, 160);
  g.globalCompositeOperation = 'lighter';
  for (const c of VIS) {
    const x = c.x / 5, y = c.y / 5, r = c.r / 5, gr = g.createRadialGradient(x, y, r * .55, x, y, r);
    gr.addColorStop(0, '#fff'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  }
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, MX.tex.fog);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, MX.fog);
  gl.uniform2f(MX.u.uRes, MX.cv.width, MX.cv.height);
  gl.uniform3f(MX.u.uView, R.s * R.dpr, R.ox * R.dpr, R.oy * R.dpr);
  gl.uniform1f(MX.u.uTime, time % 1000);
  gl.uniform1f(MX.u.uFlash, flash);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}
