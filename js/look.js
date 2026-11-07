'use strict';
// 黑绿画面（SETTINGS.look === 'green'，默认）：沿用写实画面的全部轮廓与模型（地形、房屋、车辆、舰船、飞机），整帧画完后过一遍着色器——
// 亮度映射成黑底绿色磷光（像夜视 / 战术显示屏），亮度边缘（Sobel）加亮成发光轮廓线，亮处带一点辉光；
// 鲜艳的标识色（敌方红、琥珀、青、紫、火光）保留原色，敌方的涂装在这个画面里改成暗红（lkPaint），一眼分清敌我
// 实现：主画布（2D）作纹理上传到一个 WebGL 画布，着色后再整张画回主画布（用 copy 合成，不影响点击、截图等）；没有 WebGL 时退回 CSS 滤镜（全图绿、不保留红）
const LK = { ok: false, tried: false, gl: null, cv: null, pr: null, u: {}, tex: null, w: 0, h: 0, css: false };
const greenLook = () => typeof SETTINGS === 'object' && !!SETTINGS && SETTINGS.look === 'green';

const LK_VS = 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }';
const LK_FS = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D uSrc; uniform vec2 uRes; uniform float uEdge, uGlow, uDark;
float L(vec3 c) { return dot(c, vec3(.299, .587, .114)); }
vec3 S(vec2 uv) { return texture2D(uSrc, uv).rgb; }
void main() {
  vec2 px = 1. / uRes, uv = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) * px;
  vec3 c = S(uv);
  float l = L(c);
  // 轮廓：亮度 Sobel（一个设备像素的间隔）。在四个对角的半像素处线性插值采样，每次正好是 2×2 个像素的平均，
  // 四个采样相减就合出完整的 3×3 Sobel 核（亮度对颜色是线性的），比逐个读 8 个邻点少一半采样
  float a = L(S(uv + px * vec2(-.5, -.5))), b = L(S(uv + px * vec2(.5, -.5))), d = L(S(uv + px * vec2(-.5, .5))), e = L(S(uv + px * vec2(.5, .5)));
  float gx = 4. * ((b + e) - (a + d)), gy = 4. * ((d + e) - (a + b));
  float ed = smoothstep(.09, .5, sqrt(gx * gx + gy * gy));
  // 辉光：周围八个点里亮的部分（半径约 3 像素）
  float gl = 0.;
  if (uGlow > 0.) {
    for (int i = 0; i < 8; i++) {
      float an = float(i) * .7854;
      vec2 o = vec2(cos(an), sin(an)) * 3.2 * px;
      gl += max(0., L(S(uv + o)) - .55);
    }
    gl *= uGlow / 8.;
  }
  // 单色：亮度 → 黑底绿色磷光（中间调压暗，像夜视屏），轮廓线更亮
  float m = pow(clamp(l, 0., 1.), uDark);
  vec3 mono = vec3(.006, .024, .013) + m * vec3(.16, .92, .47) + ed * uEdge * vec3(.15, .66, .36) * (.35 + m) + gl * vec3(.25, 1., .55);
  // 鲜艳又够亮的标识色保留原色（敌方红、琥珀、青、紫、火光）；地形、房顶、我方涂装饱和度低或偏暗，不受影响
  float mx = max(c.r, max(c.g, c.b)), sat = (mx - min(c.r, min(c.g, c.b))) / max(mx, .001);
  float keep = smoothstep(.6, .74, sat) * smoothstep(.4, .58, mx);
  keep *= mix(1., smoothstep(.82, .95, mx), step(c.r, c.b) * step(c.g * .85, c.b));   // 偏蓝的（海水、浅滩反光）要很亮才保留——只留青色标识线
  gl_FragColor = vec4(mix(mono, c * 1.06 + gl * .6, keep), 1.);
}`;

function lkInit() {
  LK.tried = true;
  try {
    const cv = document.createElement('canvas');
    const gl = cv.getContext('webgl', { antialias: false, preserveDrawingBuffer: true, premultipliedAlpha: false, alpha: false });
    if (!gl) return;
    const sh = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, LK_VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, LK_FS));
    gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
    gl.useProgram(pr);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(pr, 'p');
    gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const u = {};
    for (const n of ['uSrc', 'uRes', 'uEdge', 'uGlow', 'uDark']) u[n] = gl.getUniformLocation(pr, n);
    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
    for (const [p, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, p, v);
    gl.uniform1i(u.uSrc, 0);
    Object.assign(LK, { gl, cv, pr, u, tex, ok: true });
  } catch (e) { LK.ok = false; console.warn('黑绿画面着色器不可用，改用 CSS 滤镜', e); }
}

// 每帧最后调用（render.js draw）：把主画布整张换成黑绿画面
function lkPost() {
  const src = R.cv;
  if (!src) return;
  if (!LK.tried) lkInit();
  if (!LK.ok) { lkCss(true); return; }
  lkCss(false);
  const { gl, cv, u } = LK, w = src.width, h = src.height;
  if (LK.w !== w || LK.h !== h) { cv.width = w; cv.height = h; LK.w = w; LK.h = h; gl.viewport(0, 0, w, h); }
  const q = typeof SETTINGS === 'object' && SETTINGS ? SETTINGS.quality : 'high';
  gl.useProgram(LK.pr);
  gl.bindTexture(gl.TEXTURE_2D, LK.tex);
  try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, src); } catch (e) { LK.ok = false; lkCss(true); return; }
  gl.uniform2f(u.uRes, w, h);
  const zk = clamp((R.s - .2) / .9, .3, 1);   // 远看时地物很小：轮廓线淡一些，免得满屏噪点
  gl.uniform1f(u.uEdge, (q === 'low' ? .6 : 1) * zk);
  gl.uniform1f(u.uDark, 1.2);
  gl.uniform1f(u.uGlow, q === 'high' && !R.lowCap ? 1.3 * (SETTINGS.bloom ?? .7) : 0);   // 辉光强度跟设置走（默认 .7 → .9）
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  const ctx = R.ctx;
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = 'copy'; ctx.globalAlpha = 1;
  ctx.drawImage(cv, 0, 0);
  ctx.restore();
}
// 退路：整张画布加 CSS 滤镜（全图变绿，敌方红色也变绿）
function lkCss(on) {
  if (LK.css === on || !R.cv) return;
  LK.css = on;
  R.cv.style.filter = on ? 'grayscale(1) sepia(1) hue-rotate(75deg) saturate(2.4) brightness(.82)' : '';
}

// 敌方涂装：黑绿画面里换成同样明暗的暗红（饱和度够高，过着色器时保留红色）；其他画面原样返回
const _lkp = {};
function lkPaint(hex, side) {
  if (side !== 'e' || !greenLook() || typeof hex !== 'string' || hex[0] !== '#' || hex.length !== 7) return hex;
  const c = _lkp[hex];
  if (c) return c;
  const v = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255), l = .3 * v[0] + .59 * v[1] + .11 * v[2];
  const r = clamp(l * 1.75 + .08, 0, 1), g = clamp(l * .55, 0, 1), b = clamp(l * .5, 0, 1);
  return (_lkp[hex] = '#' + [r, g, b].map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join(''));
}
