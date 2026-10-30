'use strict';
// 3D 后期（view3d.js v3Draw 画完地形、建筑、模型、弹道后调用 v3Post）：像指挥部里压暗灯光的一张电子沙盘桌——
//   辉光：亮线、曳光、爆炸、发光的棱线向外泛一圈光（亮部提取 → 四分之一分辨率两遍高斯模糊 → 叠加回去）；
//   移轴景深：斜着看时画面上下两边虚化、中间一条清楚，整片战场像桌上的微缩沙盘；正俯视时不虚化；
//   调色：亮部柔和压缩、中间调略提、饱和度加一成；暗角与细颗粒：四角压暗、极轻的胶片颗粒，不是一张「干净的电脑图」。
// 在 WebGL 里做完再交给主画布（文字、标号由 v3Overlay 之后画在主画布上，不跟着泛光、不虚化，照样清楚）
// 画质「低」时不做；帧间隔偏大（设备跟不上）时先关景深，辉光留着
const V3P = { ok: false, tried: false, pr: {}, buf: null, scene: null, fb: [], w: 0, h: 0 };

const V3P_VS = 'attribute vec2 p; varying vec2 vU; void main() { vU = p * .5 + .5; gl_Position = vec4(p, 0., 1.); }';
const V3P_HEAD = '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\nvarying vec2 vU;\n';
const V3P_FS = {
  // 四个双线性采样合成一个 4×4 块的平均（缩到四分之一）；uTh > 0 时只留亮部（柔和过渡的阈值，免得亮线边上一刀切）
  down: V3P_HEAD + `uniform sampler2D uS; uniform vec2 uPx; uniform float uTh, uKn;
void main() {
  vec3 c = (texture2D(uS, vU + uPx * vec2(-1., -1.)).rgb + texture2D(uS, vU + uPx * vec2(1., -1.)).rgb
          + texture2D(uS, vU + uPx * vec2(-1., 1.)).rgb + texture2D(uS, vU + uPx * vec2(1., 1.)).rgb) * .25;
  if (uTh > 0.) {
    float br = max(c.r, max(c.g, c.b)), rq = clamp(br - uTh + uKn, 0., 2. * uKn);
    c *= max(rq * rq / (4. * uKn + 1e-4), br - uTh) / max(br, 1e-4);
  }
  gl_FragColor = vec4(c, 1.);
}`,
  // 九点高斯（借双线性插值只采五次），uDir 是一个方向上的步长
  blur: V3P_HEAD + `uniform sampler2D uS; uniform vec2 uDir;
void main() {
  vec3 c = texture2D(uS, vU).rgb * .227027;
  c += (texture2D(uS, vU + uDir * 1.3846).rgb + texture2D(uS, vU - uDir * 1.3846).rgb) * .316216;
  c += (texture2D(uS, vU + uDir * 3.2308).rgb + texture2D(uS, vU - uDir * 3.2308).rgb) * .07027;
  gl_FragColor = vec4(c, 1.);
}`,
  // 合成：景深（按屏幕纵向离清晰带的距离混入模糊图）→ 叠辉光 → 暗角 → 颗粒
  comp: V3P_HEAD + `uniform sampler2D uS, uB, uD; uniform vec4 uTs; uniform float uBk, uVig, uGr, uT; uniform vec2 uRes;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec3 c = texture2D(uS, vU).rgb;
  if (uTs.x > 0.) c = mix(c, texture2D(uD, vU).rgb, smoothstep(uTs.z, uTs.z + uTs.w, abs(vU.y - uTs.y)) * uTs.x);
  c += texture2D(uB, vU).rgb * uBk;
  // 调色：亮部柔和地压一点（辉光叠上去不发白）、中间调略提、饱和度加一成——像胶片，不是平的电脑图
  c = c / (1. + c * .12);
  c = pow(max(c, 0.), vec3(.94));
  c = mix(vec3(dot(c, vec3(.299, .587, .114))), c, 1.1);
  vec2 d = (vU - .5) * vec2(uRes.x / uRes.y, 1.);
  c *= 1. - uVig * smoothstep(.3, 1.05, length(d));
  c += (hash(floor(vU * uRes) + uT) - .5) * uGr;
  gl_FragColor = vec4(c, 1.);
}`
};

function v3pInit(gl) {
  V3P.tried = true;
  try {
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const vs = sh(gl.VERTEX_SHADER, V3P_VS);
    for (const k in V3P_FS) {
      const p = gl.createProgram();
      gl.attachShader(p, vs); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, V3P_FS[k])); gl.bindAttribLocation(p, 0, 'p'); gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      const u = {};
      for (const n of ['uS', 'uB', 'uD', 'uPx', 'uTh', 'uKn', 'uDir', 'uTs', 'uBk', 'uVig', 'uGr', 'uT', 'uRes']) u[n] = gl.getUniformLocation(p, n);
      V3P.pr[k] = { p, u };
    }
    V3P.buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, V3P.buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);   // 盖满屏幕的一个三角形
    const mk = () => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); for (const [p, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, p, v); return t; };
    gl.activeTexture(gl.TEXTURE0);
    V3P.scene = mk();
    V3P.fb = [0, 1, 2].map(() => ({ t: mk(), f: gl.createFramebuffer() }));
    V3P.mk = mk; V3P.ok = true;
  } catch (e) { V3P.ok = false; console.warn('3D 后期不可用', e); }
}
// 四分之一分辨率的三张屏外图：A 缩小的整幅（景深用）、B 亮部（辉光）、T 模糊的中间结果
function v3pSize(gl, w, h) {
  gl.activeTexture(gl.TEXTURE0);
  for (const F of V3P.fb) {
    gl.bindTexture(gl.TEXTURE_2D, F.t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, w, h, 0, gl.RGB, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, F.f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, F.t, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) { V3P.ok = false; break; }
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  V3P.w = w; V3P.h = h;
}

// 景深强度：俯角越斜越强（正俯视没有远近，不虚化）；观察者模式（贴地第一人称）不做
function v3pDof() {
  if ((typeof V3O === 'object' && V3O.on) || (typeof ema === 'number' && ema > .045)) return 0;
  const pitch = V3.on && V3.fc ? V3.fc.pitch : (V3.tilt ?? .95) - Math.PI / 2;
  return .85 * clamp((pitch + 1.38) / .55, 0, 1);
}

function v3Post(now) {
  const st = typeof SETTINGS === 'object' && SETTINGS ? SETTINGS : {};
  if (st.quality === 'low' || R.lowCap) return;
  const gl = V3.gl;
  if (!V3P.tried) v3pInit(gl);
  if (!V3P.ok) return;
  const w = V3.cv.width, h = V3.cv.height, qw = Math.max(1, w >> 2), qh = Math.max(1, h >> 2);
  if (V3P.w !== qw || V3P.h !== qh) v3pSize(gl, qw, qh);
  if (!V3P.ok) return;
  const [A, B, T] = V3P.fb, dof = v3pDof(), bk = .55 * clamp(isFinite(st.bloom) ? st.bloom / .7 : 1, 0, 2.2);
  const tex = (unit, t) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); };
  const pass = (k, F, vw, vh, set) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, F ? F.f : null); gl.viewport(0, 0, vw, vh);
    const P = V3P.pr[k]; gl.useProgram(P.p); set(P.u); gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
  gl.bindBuffer(gl.ARRAY_BUFFER, V3P.buf); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  tex(0, V3P.scene); gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGB, 0, 0, w, h, 0);   // 抓下刚画好的一帧（已做过多重采样抗锯齿）
  pass('down', A, qw, qh, u => { tex(0, V3P.scene); gl.uniform1i(u.uS, 0); gl.uniform2f(u.uPx, 1 / w, 1 / h); gl.uniform1f(u.uTh, 0); });
  pass('down', B, qw, qh, u => { tex(0, A.t); gl.uniform1i(u.uS, 0); gl.uniform2f(u.uPx, .5 / qw, .5 / qh); gl.uniform1f(u.uTh, .86); gl.uniform1f(u.uKn, .12); });   // 写实：只有很亮的（爆炸、火光、阳光反射）才泛光
  for (const r of [1, 2.2]) {   // 第二遍半径大一些：近处一圈亮、外面一圈淡淡的光晕
    pass('blur', T, qw, qh, u => { tex(0, B.t); gl.uniform1i(u.uS, 0); gl.uniform2f(u.uDir, r / qw, 0); });
    pass('blur', B, qw, qh, u => { tex(0, T.t); gl.uniform1i(u.uS, 0); gl.uniform2f(u.uDir, 0, r / qh); });
  }
  if (dof > .01) for (const r of [1, 1.8]) {
    pass('blur', T, qw, qh, u => { tex(0, A.t); gl.uniform1i(u.uS, 0); gl.uniform2f(u.uDir, r / qw, 0); });
    pass('blur', A, qw, qh, u => { tex(0, T.t); gl.uniform1i(u.uS, 0); gl.uniform2f(u.uDir, 0, r / qh); });
  }
  pass('comp', null, w, h, u => {
    tex(0, V3P.scene); tex(1, B.t); tex(2, A.t);
    gl.uniform1i(u.uS, 0); gl.uniform1i(u.uB, 1); gl.uniform1i(u.uD, 2);
    gl.uniform4f(u.uTs, dof, .5, .1, .32); gl.uniform1f(u.uBk, bk); gl.uniform1f(u.uVig, .42); gl.uniform1f(u.uGr, .022);
    gl.uniform1f(u.uT, (now / 1000) % 100); gl.uniform2f(u.uRes, w, h);
  });
  gl.disableVertexAttribArray(0); gl.enable(gl.DEPTH_TEST); gl.activeTexture(gl.TEXTURE0);   // 下一帧画地形时 0、1、2 号贴图单元都会重新绑定
}
