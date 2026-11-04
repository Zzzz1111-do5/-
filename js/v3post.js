'use strict';
// 3D 后期（view3d.js v3Draw 画完地形、建筑、模型、弹道后调用 v3Post）：像指挥部里压暗灯光的一张电子沙盘桌——
//   辉光：亮线、曳光、爆炸、发光的棱线向外泛一圈光（亮部提取 → 四分之一分辨率两遍高斯模糊 → 叠加回去）；
//   移轴景深：斜着看时画面上下两边虚化、中间一条清楚，整片战场像桌上的微缩沙盘；正俯视时不虚化；
//   调色：亮部柔和压缩、中间调略提、饱和度加一成；暗角与细颗粒：四角压暗、极轻的胶片颗粒，不是一张「干净的电脑图」。
//   写实画面另加电影感的一层：中间调 S 形对比、暗部偏青蓝亮部偏暖金的分色、高光略压饱和；镜头色差（四角红蓝错开一两个像素）；
//   太阳在镜头前方时的光晕、横向拉丝与鬼影（太阳被挡住就没有，v3poSun 算太阳在画面上的位置）。
// 在 WebGL 里做完再交给主画布（文字、标号由 v3Overlay 之后画在主画布上，不跟着泛光、不虚化，照样清楚）
// 画质「低」时不做；帧间隔偏大（设备跟不上）时先关景深，辉光留着
const V3PO = { ok: false, tried: false, pr: {}, buf: null, scene: null, fb: [], w: 0, h: 0 };

const V3PO_VS = 'attribute vec2 p; varying vec2 vU; void main() { vU = p * .5 + .5; gl_Position = vec4(p, 0., 1.); }';
const V3PO_HEAD = '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\nvarying vec2 vU;\n';
const V3PO_FS = {
  // 导弹导引头的光电画面（v3pilot.js 导弹小屏，v3poEO）：uMode 1 红外白热——偏暖的亮、偏蓝的天空和水面冷（同下面 comp 里吊舱红外的换算），
  //   3 电视黑白——中间调 S 形对比；加传感器噪声（每秒 24 帧换一次）、一点扫描线、暗角
  eo: V3PO_HEAD + `uniform sampler2D uS; uniform float uMode, uT; uniform vec2 uRes;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec3 c = texture2D(uS, vU).rgb;
  float l;
  if (uMode < 2.) {
    float cold = smoothstep(.03, .2, c.b - c.r);
    l = clamp((dot(c, vec3(.52, .36, .12)) * (1. - .7 * cold) - .1) * 1.6, 0., 1.);
    l = pow(l, .85);
  } else {
    l = clamp(dot(c, vec3(.299, .587, .114)), 0., 1.);
    l = mix(l, l * l * (3. - 2. * l), .55);
  }
  l += (hash(floor(vU * uRes) + floor(uT * 24.)) - .5) * .05;
  l *= .965 + .035 * sin(vU.y * uRes.y * 1.5708);
  vec2 d = (vU - .5) * vec2(uRes.x / uRes.y, 1.);
  l *= 1. - .38 * smoothstep(.35, .95, length(d));
  gl_FragColor = vec4(vec3(l), 1.);
}`,
  // 四个双线性采样合成一个 4×4 块的平均（缩到四分之一）；uTh > 0 时只留亮部（柔和过渡的阈值，免得亮线边上一刀切）
  down: V3PO_HEAD + `uniform sampler2D uS; uniform vec2 uPx; uniform float uTh, uKn;
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
  blur: V3PO_HEAD + `uniform sampler2D uS; uniform vec2 uDir;
void main() {
  vec3 c = texture2D(uS, vU).rgb * .227027;
  c += (texture2D(uS, vU + uDir * 1.3846).rgb + texture2D(uS, vU - uDir * 1.3846).rgb) * .316216;
  c += (texture2D(uS, vU + uDir * 3.2308).rgb + texture2D(uS, vU - uDir * 3.2308).rgb) * .07027;
  gl_FragColor = vec4(c, 1.);
}`,
  // 体积光束（写实画面的白天，太阳在镜头前方）：从每个像素朝太阳在画面上的位置走 32 步，累加沿途亮的天空（太阳附近发亮的天）——
  //   云、山、飞机、烟挡住的地方是暗的，于是从它们的边缘透出一道道光（电影里逆光的「耶稣光」）；离太阳越远越淡。四分之一分辨率算，合成时放大叠上
  rays: V3PO_HEAD + `uniform sampler2D uS; uniform vec3 uSun; uniform vec2 uRes;
void main() {
  vec2 asp = vec2(uRes.x / uRes.y, 1.), d = uSun.xy - vU;
  vec3 acc = vec3(0.); float il = 1.;
  for (int i = 0; i < 32; i++) {
    vec3 s = texture2D(uS, clamp(vU + d * (float(i) / 32.), .002, .998)).rgb;
    acc += s * smoothstep(.6, .9, dot(s, vec3(.2126, .7152, .0722))) * il;
    il *= .955;
  }
  gl_FragColor = vec4(acc / 32. * exp(-length(d * asp) * 2.4) * uSun.z, 1.);
}`,
  // 合成：景深（按屏幕纵向离清晰带的距离混入模糊图）→ 叠辉光 → 暗角 → 颗粒
  comp: V3PO_HEAD + `uniform sampler2D uS, uB, uD, uRy; uniform vec4 uTs; uniform float uBk, uVig, uGr, uT, uIR, uCA, uGrade, uRyK, uRad; uniform vec2 uRes; uniform vec3 uSun;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec2 dc = vU - .5;
  vec3 c;
  // 镜头色差（写实画面）：越往画面四角红、蓝通道错开得越多，正中没有——真实镜头的样子，量很轻（角上一两个像素）
  if (uCA > 0. && uIR < .5) { vec2 o = dc * dot(dc, dc) * uCA; c = vec3(texture2D(uS, vU + o).r, texture2D(uS, vU).g, texture2D(uS, vU - o).b); }
  else c = texture2D(uS, vU).rgb;
  // 景深：沙盘画面是移轴（上下两边虚），电影镜头是以画面中心为焦点的浅景深（四周虚，uRad）
  if (uTs.x > 0.) c = mix(c, texture2D(uD, vU).rgb, (uRad > .5 ? smoothstep(.2, .62, length(dc * vec2(uRes.x / uRes.y, 1.))) : smoothstep(uTs.z, uTs.z + uTs.w, abs(vU.y - uTs.y))) * uTs.x);
  c += texture2D(uB, vU).rgb * uBk;
  if (uRyK > 0. && uIR < .5) c += texture2D(uRy, vU).rgb * vec3(1., .9, .74) * uRyK;   // 体积光束（暖色）
  // 太阳眩光（写实画面的白天，太阳在镜头前方）：太阳周围的光晕、一道横向的镜头拉丝、沿太阳过画面中心那条线上的几个淡淡的鬼影；
  //   太阳被地形、飞机挡住就没有（看辉光图里太阳那一块亮不亮）
  if (uSun.z > 0. && uIR < .5) {
    vec2 asp = vec2(uRes.x / uRes.y, 1.), ds = (vU - uSun.xy) * asp;
    float occ = smoothstep(.2, .7, dot(texture2D(uB, clamp(uSun.xy, .002, .998)).rgb, vec3(.3333))), k = uSun.z * occ, r = length(ds);
    c += vec3(1., .86, .66) * k * (.3 * exp(-r * 5.5) + .09 * exp(-r * 1.5));
    c += vec3(.8, .88, 1.) * k * .16 * exp(-abs(ds.y) * 140.) * exp(-abs(ds.x) * 2.4);
    for (int i = 0; i < 3; i++) {
      float f = i == 0 ? -.3 : i == 1 ? -.7 : -1.2, rr = i == 0 ? .045 : i == 1 ? .085 : .03;
      vec2 gp = .5 + (uSun.xy - .5) * f;
      c += (i == 1 ? vec3(.45, .75, .6) : vec3(.95, .6, .35)) * k * .045 * smoothstep(rr, rr * .35, length((vU - gp) * asp));
    }
  }
  // 调色：亮部柔和地压一点（辉光叠上去不发白）、中间调略提、饱和度加一成——像胶片，不是平的电脑图
  c = c / (1. + c * .12);
  c = pow(max(c, 0.), vec3(.94));
  c = mix(vec3(dot(c, vec3(.299, .587, .114))), c, 1.1);
  // 光电吊舱的红外（驾驶战斗机时 B 键，fptgp.js）：按「温度」换成灰度——偏暖的颜色亮、偏蓝的天空和水面冷；热源（发动机、人、火）在特效里已经点得很亮；
  //   拉开对比、加一点热像传感器的噪声；黑热把明暗反过来
  if (uIR > 2.5) {   // 电视导引头的黑白画面（全屏导弹视角）
    float l = clamp(dot(c, vec3(.299, .587, .114)), 0., 1.);
    l = mix(l, l * l * (3. - 2. * l), .55) + (hash(floor(vU * uRes) + floor(uT * 24.)) - .5) * .04;
    c = vec3(l);
  } else if (uIR > .5) {
    float l = dot(c, vec3(.52, .36, .12)), cold = smoothstep(.03, .2, c.b - c.r);
    l = clamp((l * (1. - .7 * cold) - .1) * 1.6, 0., 1.);
    l = pow(l, .85) + (hash(floor(vU * uRes) + floor(uT * 24.)) - .5) * .035;
    c = vec3(uIR > 1.5 ? 1. - l : l);
  } else if (uGrade > 0.) {
    // 电影感调色（写实画面）：中间调加一点 S 形对比；暗部偏青蓝、亮部偏暖金（大片里常见的冷暖分离，量很轻）；高光略压饱和，不刺眼
    vec3 cc = clamp(c, 0., 1.);
    c = mix(c, cc * cc * (3. - 2. * cc), .18 * uGrade);
    float L = dot(c, vec3(.2126, .7152, .0722));
    c *= mix(vec3(1.), mix(vec3(.94, .99, 1.05), vec3(1.045, 1., .93), smoothstep(.12, .72, L)), uGrade);
    c = mix(vec3(L), c, 1. - .12 * uGrade * smoothstep(.75, 1., L));
  }
  vec2 d = (vU - .5) * vec2(uRes.x / uRes.y, 1.);
  c *= 1. - uVig * smoothstep(.3, 1.05, length(d));
  float Lg = clamp(dot(c, vec3(.2126, .7152, .0722)), 0., 1.);
  c += (hash(floor(vU * uRes) + floor(uT * 24.)) - .5) * uGr * (uGrade > 0. ? 4. * Lg * (1. - Lg) : 1.);   // 胶片颗粒：每秒 24 格换一次；写实画面只落在中间调（暗的海面、亮的天空不起噪点）
  gl_FragColor = vec4(c, 1.);
}`
};

function v3poInit(gl) {
  V3PO.tried = true;
  try {
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const vs = sh(gl.VERTEX_SHADER, V3PO_VS);
    for (const k in V3PO_FS) {
      const p = gl.createProgram();
      gl.attachShader(p, vs); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, V3PO_FS[k])); gl.bindAttribLocation(p, 0, 'p'); gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      const u = {};
      for (const n of ['uS', 'uB', 'uD', 'uRy', 'uRyK', 'uRad', 'uPx', 'uTh', 'uKn', 'uDir', 'uTs', 'uBk', 'uVig', 'uGr', 'uT', 'uRes', 'uIR', 'uCA', 'uGrade', 'uSun', 'uMode']) u[n] = gl.getUniformLocation(p, n);
      V3PO.pr[k] = { p, u };
    }
    V3PO.buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, V3PO.buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);   // 盖满屏幕的一个三角形
    const mk = () => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); for (const [p, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, p, v); return t; };
    gl.activeTexture(gl.TEXTURE0);
    V3PO.scene = mk();
    V3PO.fb = [0, 1, 2].map(() => ({ t: mk(), f: gl.createFramebuffer() }));
    V3PO.mk = mk; V3PO.ok = true;
  } catch (e) { V3PO.ok = false; console.warn('3D 后期不可用', e); }
}
// 四分之一分辨率的三张屏外图：A 缩小的整幅（景深用）、B 亮部（辉光）、T 模糊的中间结果
function v3poSize(gl, w, h) {
  gl.activeTexture(gl.TEXTURE0);
  for (const F of V3PO.fb) {
    gl.bindTexture(gl.TEXTURE_2D, F.t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, w, h, 0, gl.RGB, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, F.f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, F.t, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) { V3PO.ok = false; break; }
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  V3PO.w = w; V3PO.h = h;
}

// 景深强度：俯角越斜越强（正俯视没有远近，不虚化）；观察者模式（贴地第一人称）不做
function v3poDof() {
  if ((typeof V3O === 'object' && V3O.on) || (typeof ema === 'number' && ema > .045)) return 0;
  const pitch = V3.on && V3.fc ? V3.fc.pitch : (V3.tilt ?? .95) - Math.PI / 2;
  return .85 * clamp((pitch + 1.38) / .55, 0, 1);
}

// 太阳在画面上的位置（0–1，左下为原点）与眩光强度：写实画面的白天；太阳在镜头前方，出了画面一点也还有一圈光晕
function v3poSun() {
  const C = V3.cam;
  if (!C || !C.M || (typeof S === 'object' && S && S.night) || (typeof TER === 'object' && TER && TER.flat) || typeof V3_SUN !== 'object') return [0, 0, 0];
  const M = C.M, s = V3_SUN, l = Math.hypot(s[0], s[1], s[2]) || 1, x = C.E[0] + s[0] / l * 1e4, y = C.E[1] + s[1] / l * 1e4, z = C.E[2] + s[2] / l * 1e4;
  const w = M[3] * x + M[7] * y + M[11] * z + M[15];
  if (w <= 0) return [0, 0, 0];
  const u = ((M[0] * x + M[4] * y + M[8] * z + M[12]) / w + 1) / 2, v = ((M[1] * x + M[5] * y + M[9] * z + M[13]) / w + 1) / 2;
  const off = Math.max(0, -u, u - 1, -v, v - 1);
  return [u, v, off > .3 ? 0 : 1 - off / .3];
}
function v3Post(now) {
  const st = typeof SETTINGS === 'object' && SETTINGS ? SETTINGS : {};
  if ((st.quality === 'low' || R.lowCap || R.autoLow) && !(typeof ftEO === 'function' && ftEO())) return;   // 画质低（或持续卡顿自动降画质，main.js）时不做后期；吊舱红外例外（换算在这一遍里）
  const gl = V3.gl;
  if (!V3PO.tried) v3poInit(gl);
  if (!V3PO.ok) return;
  const w = V3.cv.width, h = V3.cv.height, qw = Math.max(1, w >> 2), qh = Math.max(1, h >> 2);
  if (V3PO.w !== qw || V3PO.h !== qh) v3poSize(gl, qw, qh);
  if (!V3PO.ok) return;
  const mx = typeof v3Mx === 'function' && v3Mx();   // 写实画面：不做移轴虚化和胶片颗粒（颗粒在暗的海面上就是一层噪点），暗角减半——只留辉光
  const cine = typeof V3C === 'object' && V3C.on && !mx;   // 电影镜头（v3cine.js）：浅景深、调色加重、暗角、颗粒
  const [A, B, T] = V3PO.fb, film = !(typeof SETTINGS === 'object' && SETTINGS && SETTINGS.film === false), dof = mx ? v3poDof() : cine && film ? .7 : 0, bk = (mx ? .85 : .55) * clamp(isFinite(st.bloom) ? st.bloom / .7 : 1, 0, 2.2);
  const tex = (unit, t) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); };
  const pass = (k, F, vw, vh, set) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, F ? F.f : null); gl.viewport(0, 0, vw, vh);
    const P = V3PO.pr[k]; gl.useProgram(P.p); set(P.u); gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
  gl.bindBuffer(gl.ARRAY_BUFFER, V3PO.buf); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  tex(0, V3PO.scene); gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGB, 0, 0, w, h, 0);   // 抓下刚画好的一帧（已做过多重采样抗锯齿）
  pass('down', A, qw, qh, u => { tex(0, V3PO.scene); gl.uniform1i(u.uS, 0); gl.uniform2f(u.uPx, 1 / w, 1 / h); gl.uniform1f(u.uTh, 0); });
  pass('down', B, qw, qh, u => { tex(0, A.t); gl.uniform1i(u.uS, 0); gl.uniform2f(u.uPx, .5 / qw, .5 / qh); gl.uniform1f(u.uTh, mx ? .42 : S && S.night ? .5 : .86); gl.uniform1f(u.uKn, mx ? .2 : S && S.night ? .16 : .12); });   // 夜里：车灯、火光这些亮点晕开一圈   // 黑绿：亮线都泛光；写实：只有很亮的（爆炸、火光、阳光反射）泛光
  for (const r of [1, 2.2]) {   // 第二遍半径大一些：近处一圈亮、外面一圈淡淡的光晕
    pass('blur', T, qw, qh, u => { tex(0, B.t); gl.uniform1i(u.uS, 0); gl.uniform2f(u.uDir, r / qw, 0); });
    pass('blur', B, qw, qh, u => { tex(0, T.t); gl.uniform1i(u.uS, 0); gl.uniform2f(u.uDir, 0, r / qh); });
  }
  if (dof > .01) for (const r of [1, 1.8]) {
    pass('blur', T, qw, qh, u => { tex(0, A.t); gl.uniform1i(u.uS, 0); gl.uniform2f(u.uDir, r / qw, 0); });
    pass('blur', A, qw, qh, u => { tex(0, T.t); gl.uniform1i(u.uS, 0); gl.uniform2f(u.uDir, 0, r / qh); });
  }
  const sun = mx ? [0, 0, 0] : v3poSun(), ir = typeof ftEO === 'function' ? ftEO() : 0, ry = !mx && !ir && film && sun[2] > .01 ? (cine ? 1.1 : .85) : 0;   // 光束：写实画面白天太阳在镜头前方（景深那两遍做完 T 就空出来了）
  if (ry) pass('rays', T, qw, qh, u => { tex(0, A.t); gl.uniform1i(u.uS, 0); gl.uniform3f(u.uSun, sun[0], sun[1], sun[2]); gl.uniform2f(u.uRes, w, h); });
  pass('comp', null, w, h, u => {
    tex(0, V3PO.scene); tex(1, B.t); tex(2, A.t); tex(7, T.t);   // 光束图放 7 号单元：地形每帧都会重绑它（3 号常驻水深分类图，不能占）
    gl.uniform1i(u.uS, 0); gl.uniform1i(u.uB, 1); gl.uniform1i(u.uD, 2); gl.uniform1i(u.uRy, 7); gl.uniform1f(u.uRyK, ry); gl.uniform1f(u.uRad, cine && film ? 1 : 0);
    gl.uniform4f(u.uTs, dof, .5, .1, .32); gl.uniform1f(u.uBk, bk); gl.uniform1f(u.uVig, mx ? .42 : cine ? .38 : .22); gl.uniform1f(u.uGr, mx ? .022 : !film ? 0 : cine ? .045 : .03);   // 电影后期关掉（编辑器 / 设置）：不加颗粒、光束、景深
    gl.uniform1f(u.uT, (now / 1000) % 100); gl.uniform2f(u.uRes, w, h); gl.uniform1f(u.uIR, ir);
    gl.uniform1f(u.uCA, mx ? 0 : .005); gl.uniform1f(u.uGrade, mx ? 0 : cine ? 1.45 : 1.15); gl.uniform3f(u.uSun, sun[0], sun[1], sun[2]);
  });
  gl.disableVertexAttribArray(0); gl.enable(gl.DEPTH_TEST); gl.activeTexture(gl.TEXTURE0);   // 下一帧画地形时 0、1、2 号贴图单元都会重新绑定
}
// 导弹小屏的光电画面（v3pilot.js v3fpPip 画完那一块后调）：vp 是那一块（绘图缓冲区像素，左下为原点），mode 1 红外白热 / 3 电视黑白
function v3poEO(vp, mode, now) {
  const gl = V3.gl;
  if (!V3PO.tried) v3poInit(gl);
  if (!V3PO.ok || !V3PO.pr.eo) return;
  const [x, y, w, h] = vp;
  if (w < 2 || h < 2) return;
  gl.activeTexture(gl.TEXTURE0);
  if (!V3PO.eoT) V3PO.eoT = V3PO.mk();
  gl.bindTexture(gl.TEXTURE_2D, V3PO.eoT);
  if (V3PO.eoW !== w || V3PO.eoH !== h) { gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGB, x, y, w, h, 0); V3PO.eoW = w; V3PO.eoH = h; }
  else gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, x, y, w, h);
  gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
  gl.enable(gl.SCISSOR_TEST); gl.scissor(x, y, w, h); gl.viewport(x, y, w, h);
  const P = V3PO.pr.eo;
  gl.useProgram(P.p);
  gl.uniform1i(P.u.uS, 0); gl.uniform1f(P.u.uMode, mode); gl.uniform1f(P.u.uT, (now / 1000) % 100); gl.uniform2f(P.u.uRes, w, h);
  gl.bindBuffer(gl.ARRAY_BUFFER, V3PO.buf); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.disableVertexAttribArray(0); gl.disable(gl.SCISSOR_TEST); gl.enable(gl.DEPTH_TEST);
  gl.viewport(0, 0, V3.cv.width, V3.cv.height);
}
