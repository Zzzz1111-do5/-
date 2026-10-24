'use strict';
// 写实地形：WebGL 着色器按真实俯视画面渲染——海水（按水深着色、波纹、阳光反光、岸边浪花）、沙滩、农田拼块、林冠、丘陵山岩、沼泽、城镇地面、道路、河流，西北光源山体阴影；视野外去饱和压暗
// 地形材质先在 CPU 上算成平滑过的权重纹理（每格一个像素，线性插值），海岸线用 TER.coast 的平滑曲线；着色器用噪声扰动边界、叠加细节，细节按缩放淡入（远看不闪）
const TRX = { ok: false, tried: false, gl: null, cv: null, P: [], cur: null, tex: {}, seed: null, sig: -1, chk: 0, c0: 0, cr: 1, fb: null, fbSeed: null };

const TRX_VS = 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }';
const TRX_FS = lite => `precision highp float;
#define LITE ${lite ? 1 : 0}
uniform vec2 uRes, uCoast; uniform vec3 uView; uniform float uTime, uFlash;
uniform sampler2D uA, uB, uC, uD, uK, uFog;
const vec2 WORLD = vec2(${W}., ${H}.);
const vec2 GRID = vec2(${GW}., ${GH}.);
float h21(vec2 p) { vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
vec2 h22(vec2 p) { vec3 q = fract(vec3(p.xyx) * vec3(.1031, .103, .0973)); q += dot(q, q.yzx + 33.33); return fract((q.xx + q.yz) * q.zy); }
float vn(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3. - 2. * f);
  return mix(mix(h21(i), h21(i + vec2(1., 0.)), u.x), mix(h21(i + vec2(0., 1.)), h21(i + vec2(1., 1.)), u.x), u.y);
}
// 分形噪声：某层波长小于约 2 个像素时换成平均值；pw 为一个像素在 p 坐标里的大小
float fbm(vec2 p, float pw) {
  float s = 0., a = .5, f = 1.;
  for (int i = 0; i < ${lite ? 3 : 5}; i++) {
    if (pw * f > .5) { s += a * .5; } else s += a * mix(.5, vn(p * f + float(i) * 17.3), 1. - smoothstep(.25, .5, pw * f));
    f *= 2.07; a *= .5;
  }
  return s / ${lite ? '.875' : '.96875'};
}
// 农田：先分成约 260 单位的田区（泰森格），每个田区一个固定朝向，区内是笔直的矩形地块（行高 30、列宽 30–64），每块一种作物
// 返回颜色，ed 为到田埂 / 田区边界的距离（世界单位）
vec3 farm(vec2 w, float pw, out float ed) {
  vec2 p = w / 260., i = floor(p), f = fract(p), id0 = i;
  float d1 = 9., d2 = 9.;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y)), r = g + h22(i + g) * .8 + .1 - f;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; id0 = i + g; } else if (d < d2) d2 = d;
  }
  float zb = (sqrt(d2) - sqrt(d1)) * 130.;   // 约等于到田区边界的距离
  float ang = (h21(id0 + 2.7) - .5) * 1.3, ca = cos(ang), sa = sin(ang);
  vec2 q = vec2(ca * w.x + sa * w.y, -sa * w.x + ca * w.y) + h22(id0) * 200.;
  float ry = floor(q.y / 30.), hr = h21(vec2(ry, 7.) + id0), cw = 30. + 34. * hr, qx = q.x + hr * 97.;
  vec2 id = vec2(floor(qx / cw), ry) + id0 * 31.;
  float fx = fract(qx / cw), fy = fract(q.y / 30.);
  ed = min(min(min(fx, 1. - fx) * cw, min(fy, 1. - fy) * 30.), zb);
  float k = h21(id + 13.1), k2 = h21(id + 5.3);
  vec3 c = k < .26 ? vec3(.42, .54, .24) : k < .48 ? vec3(.33, .45, .19) : k < .62 ? vec3(.67, .61, .34) : k < .78 ? vec3(.46, .37, .26) : k < .9 ? vec3(.52, .53, .33) : vec3(.38, .5, .3);
  c *= .9 + .2 * k2;
  float rows = sin((k2 < .5 ? q.x : q.y) * 2.4) * (1. - smoothstep(.15, .3, pw));   // 垄沟：只在很近时淡淡可见
  return c * (1. + rows * .03) * (.94 + .12 * vn(w * .09));
}
// 海岸线 y：16 位（高低两字节）存储，最近点采样后手动线性插值，避免 8 位量化在岸边浪线上出现竖条
float coastY(float x) {
  float fx = clamp(x, 0., WORLD.x), i = floor(fx);
  vec2 a = texture2D(uK, vec2((i + .5) / (WORLD.x + 1.), .5)).ra, b = texture2D(uK, vec2((min(i + 1., WORLD.x) + .5) / (WORLD.x + 1.), .5)).ra;
  return uCoast.x + mix(a.x * 65280. + a.y * 255., b.x * 65280. + b.y * 255., fx - i) / 65535. * uCoast.y;
}
#if !LITE
// 林冠：泰森格里每格一棵树（半径约 2–3.3 世界单位），按格随机决定有无（林缘稀疏）；树冠按西北光源做球面明暗
vec3 canopy(vec2 w, float dens) {
  vec2 p = w / 5.2, i = floor(p), f = fract(p), br = vec2(0.);
  float best = 9., bh = 0.;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y)), c = i + g, r = g + h22(c) - f;
    float sz = .5 + .32 * h21(c + 5.), d = length(r) / sz;
    if (h21(c + 11.) < dens && d < best) { best = d; br = -r / sz; bh = h21(c + 2.); }
  }
  float inside = 1. - smoothstep(.82, 1.02, best);
  float lit = clamp(.72 + .42 * dot(br, vec2(-.68, -.73)) + .22 * sqrt(max(0., 1. - best * best)), .38, 1.35);
  vec3 crown = mix(vec3(.15, .26, .1), vec3(.29, .4, .17), bh) * lit;
  return mix(vec3(.1, .14, .07), crown, inside);
}
#endif
void main() {
  vec2 fc = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 w = (fc - uView.yz) / uView.x;
  float pw = 1. / uView.x, t = uTime;
  if (w.x < 0. || w.y < 0. || w.x >= WORLD.x || w.y >= WORLD.y) { gl_FragColor = vec4(.02, .05, .08, 1.); return; }
  // 边界扰动：材质边缘不沿格子走
  vec2 wq = w + (vec2(vn(w * .045), vn(w * .045 + 31.7)) - .5) * 6.;
  vec2 uv = wq / WORLD, uv0 = w / WORLD, uvr = (w + (wq - w) * .3) / WORLD;
  vec4 A = texture2D(uA, uv), B = texture2D(uB, uv), C = texture2D(uC, uvr), D = texture2D(uD, uv);
  float vis = texture2D(uFog, uv0).r;
  // 海岸：到平滑海岸线的距离（>0 陆地）。竖直差按海岸坡度换算成垂直于岸线的距离，斜岸处水色与浪线不被压扁
  float cy = coastY(w.x), slope = (coastY(w.x + 6.) - coastY(w.x - 6.)) / 12.;
  float sd = (cy - w.y) / sqrt(1. + slope * slope) + (vn(w * .07) - .5) * 5.;
  float land = smoothstep(-pw, pw, sd);
  vec3 c = vec3(0.);
  // —— 陆地 ——（各材质只在权重非零处计算）
  if (land > .001) {
    float e = A.r, n1 = fbm(w * .02, pw * .02), n2 = vn(w * .11);
    vec3 grass = mix(vec3(.31, .39, .18), vec3(.5, .53, .3), n1) * (.94 + .12 * n2);
    vec3 lc = grass;
    float fm = smoothstep(.25, .55, A.a * smoothstep(.4, .6, vn(w * .0035 + 3.) + .25 - e * .6));
    if (fm > .002) {
      float ed = 99.;
      lc = mix(lc, farm(w, pw, ed), fm);
      float hedge = (1. - smoothstep(.6, 1.5 + pw * .5, ed)) * fm * (1. - smoothstep(2.5, 5., pw));
      lc = mix(lc, mix(vec3(.24, .3, .14), vec3(.55, .5, .38), step(.6, h21(floor(w / 40.)))), hedge * .75);
    }
    // 丘陵：干草与灌丛
    float hl = smoothstep(.3, .65, D.r + (n1 - .5) * .4);
    if (hl > .002) lc = mix(lc, mix(vec3(.44, .45, .27), vec3(.27, .34, .16), smoothstep(.45, .7, fbm(w * .035 + 9., pw * .035))), hl);
    // 沼泽：橄榄色芦苇地夹水洼
    float ms = smoothstep(.3, .6, B.b + (n1 - .5) * .3);
    if (ms > .002) {
      float pool = smoothstep(.54, .6, fbm(w * .06 + 3., pw * .06));
      lc = mix(lc, mix(vec3(.33, .37, .22) * (.9 + .2 * vn(w * .5)), vec3(.13, .21, .21), pool), ms);
    }
    // 林地
    float fo = smoothstep(.25, .55, A.g + (n1 - .5) * .45);
    if (fo > .002) {
      vec3 far = mix(vec3(.15, .25, .1), vec3(.24, .34, .15), fbm(w * .05 + 7., pw * .05));
#if LITE
      vec3 fcol = far;
#else
      vec3 fcol = mix(canopy(w, clamp(A.g * 1.6, 0., 1.)), far, smoothstep(.7, 1.7, pw));
#endif
      lc = mix(lc, fcol, fo);
    }
    // 岩石 / 山地 / 悬崖
    float rk = smoothstep(.3, .6, B.g + D.a + (n1 - .5) * .35), cl = smoothstep(.3, .6, B.a);
    if (rk + cl > .002) {
      float rn = fbm(w * .07 + 21., pw * .07);
      vec3 rock = mix(vec3(.34, .32, .28), vec3(.52, .49, .43), rn);
      rock = mix(rock, vec3(.3, .35, .2), smoothstep(.55, .72, fbm(w * .025 + 2., pw * .025)) * (1. - D.a * .5) * .7);
      lc = mix(lc, rock, rk);
      lc = mix(lc, mix(vec3(.3, .28, .25), vec3(.47, .44, .39), rn), cl);
    }
    // 城镇地面（房屋另画）：硬化地面夹小菜园
    float tw = smoothstep(.3, .6, A.b + (n2 - .5) * .3);
    if (tw > .002) {
      vec3 town = mix(vec3(.43, .42, .38), vec3(.52, .5, .45), vn(w * .2));
      lc = mix(lc, mix(town, vec3(.36, .45, .22), smoothstep(.62, .72, vn(w * .06 + 8.)) * .8), tw);
    }
    // 沙滩：干沙 → 湿沙
    float sn = smoothstep(.25, .55, B.r + (n2 - .5) * .25) * smoothstep(-2., 1., sd);
    if (sn > .002) {
      vec3 sand = mix(vec3(.78, .7, .5), vec3(.88, .81, .62), fbm(w * .05 + 13., pw * .05));
      lc = mix(lc, mix(vec3(.55, .51, .4), sand, smoothstep(1., 9., sd)), sn);
    }
    // 山体阴影：高程梯度，西北高处来光
    float dx = texture2D(uA, uv + vec2(1. / GRID.x, 0.)).r - texture2D(uA, uv - vec2(1. / GRID.x, 0.)).r;
    float dy = texture2D(uA, uv + vec2(0., 1. / GRID.y)).r - texture2D(uA, uv - vec2(0., 1. / GRID.y)).r;
    vec3 N = normalize(vec3(-dx * 9., -dy * 9., 1.)), L = normalize(vec3(-.55, -.65, .62));
    float sh = clamp(dot(N, L) / L.z, .42, 1.4);
    lc *= mix(1., sh, .9) * (.95 + e * .12);
    // 河流（含桥下、渡口）与河岸
    float rvW = C.g, rv = smoothstep(.2, .3, rvW), bank = smoothstep(.1, .2, rvW) * (1. - rv);
    lc = mix(lc, vec3(.42, .38, .28), bank * .8);
    if (rv > .002) {
      vec3 river = mix(vec3(.17, .29, .29), vec3(.24, .37, .35), vn(w * .15 + vec2(0., -t * .6)));
      lc = mix(lc, mix(river, vec3(.42, .5, .44), smoothstep(.2, .5, D.b) * .6), rv);
    }
    // 道路：水泥路面 + 土路肩；桥面两侧压暗
    float rdW = C.r, rd = smoothstep(.22, .32, rdW), sho = smoothstep(.12, .22, rdW) * (1. - rd);
    lc = mix(lc, vec3(.47, .42, .33), sho * .7 * (1. - rv));
    float bg = smoothstep(.15, .3, C.b), rdm = max(rd, bg * rv);
    if (rdm > .002) {
      vec3 road = mix(vec3(.6, .58, .54), vec3(.68, .66, .62), vn(w * .3)) * (1. - .08 * smoothstep(.6, 1., vn(w * .9)));
      lc = mix(lc, mix(vec3(.1, .1, .1), road, smoothstep(.25, .4, rdW)), rdm);
    }
    // 近看的细碎颗粒（草叶、土粒），像素大于颗粒时淡出
    float gr = 0.;
    if (pw < .6) gr = (vn(w * 1.7) - .5) * .16 * (1. - smoothstep(.25, .6, pw)) + (vn(w * 4.3) - .5) * .12 * (1. - smoothstep(.1, .25, pw));
    c = lc * (1. + gr * (1. - rd));
  }
  // —— 海 ——
  if (land < .999) {
    float dpt = max(0., -sd) / mix(1., 2.6, D.g);   // 浅滩处坡缓
    vec3 sea = mix(vec3(.47, .66, .58), vec3(.16, .5, .54), smoothstep(0., 16., dpt));
    sea = mix(sea, vec3(.07, .3, .42), smoothstep(14., 80., dpt));
    sea = mix(sea, vec3(.04, .17, .28), smoothstep(70., 380., dpt));
    sea = mix(sea, vec3(.025, .1, .19), smoothstep(380., 900., dpt));
    float det = 1. - smoothstep(1.5, 4., pw);
    float wv = vn(w * .045 + vec2(t * .12, t * .05)) * .6 + vn(w * .11 - vec2(t * .15, -t * .08)) * .4;
    sea *= .9 + .2 * wv;
    float gn = vn(w * .13 + t * vec2(.3, .16)) * vn(w * .17 - t * vec2(.2, .27));   // 阳光反光：波长约 7 单位，像素大于半个波长就不画（远看不闪）
    sea += vec3(.5, .55, .55) * smoothstep(.42, .75, gn) * .35 * (1. - smoothstep(.8, 2., pw)) * smoothstep(15., 120., dpt);
    // 暗礁：水下礁盘 + 一圈白浪
    float rf = smoothstep(.3, .55, C.a + (vn(w * .08) - .5) * .4);
    if (rf > .002) sea = mix(sea, mix(vec3(.22, .57, .56), vec3(.3, .44, .38), smoothstep(.5, .72, fbm(w * .09, pw * .09))), rf * .7);
    float foam = rf * (1. - rf) * 2.4 * smoothstep(.45, .85, vn(w * .2 + t * .4));
    // 岸边浪花：向岸推进的浪线 + 拍岸白线
    float bands = sin(dpt * .42 - t * 1.7 + vn(w * .03) * 7.);
    foam += smoothstep(16., 0., dpt) * smoothstep(.6, .97, bands) * (.45 + .55 * vn(w * .35 + t * .5));
    foam += smoothstep(3.5, 0., dpt) * (.55 + .45 * vn(w * .5 - t * .6));
    foam += smoothstep(80., 30., dpt) * smoothstep(.93, 1., bands) * .22 * det * smoothstep(.45, .75, vn(w * .05 + t * .08));   // 外海浪涌：断续的白线
    sea = mix(sea, vec3(.9, .93, .92), clamp(foam, 0., 1.) * .85);
    c = mix(sea, c, land);
  }
  // 视野外：去饱和、压暗、偏冷
  float lum = dot(c, vec3(.3, .59, .11));
  c = mix(mix(vec3(lum), c, .35) * vec3(.84, .9, .98) * .62, c, vis);
  c += vec3(1., .95, .85) * uFlash * .18;
  gl_FragColor = vec4(c, 1.);
}`;

function trxInit() {
  TRX.tried = true;
  try {
    const cv = document.createElement('canvas');
    const gl = cv.getContext('webgl', { antialias: false, preserveDrawingBuffer: true, premultipliedAlpha: false });
    if (!gl) return;
    const sh = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const vs = sh(gl.VERTEX_SHADER, TRX_VS), buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const names = ['uA', 'uB', 'uC', 'uD', 'uK', 'uFog'];
    TRX.P = [false, true].map(lite => {
      const pr = gl.createProgram();
      gl.attachShader(pr, vs); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, TRX_FS(lite)));
      gl.linkProgram(pr);
      if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
      gl.useProgram(pr);
      const loc = gl.getAttribLocation(pr, 'p'), u = {};
      gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      for (const n of ['uRes', 'uView', 'uTime', 'uFlash', 'uCoast', ...names]) u[n] = gl.getUniformLocation(pr, n);
      names.forEach((n, i) => { if (u[n]) gl.uniform1i(u[n], i); });
      return { pr, u };
    });
    ['a', 'b', 'c', 'd', 'k', 'fog'].forEach((k, i) => {
      const t = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, t);
      const filt = k === 'k' ? gl.NEAREST : gl.LINEAR;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filt); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filt);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      TRX.tex[k] = t;
    });
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    Object.assign(TRX, { gl, cv, ok: true });
  } catch (e) { TRX.ok = false; console.warn('写实地形着色器不可用，改用简化地形', e); }
}

// [1,2,1] 可分离模糊 n 遍（格子权重 → 平滑过渡）
function trxBlur(a, n) {
  const b = new Float32Array(a.length);
  for (let k = 0; k < n; k++) {
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) { const i = y * GW + x; b[i] = (a[i - (x > 0)] + 2 * a[i] + a[i + (x < GW - 1)]) / 4; }
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) { const i = y * GW + x; a[i] = (b[i - (y > 0) * GW] + 2 * b[i] + b[i + (y < GH - 1) * GW]) / 4; }
  }
  return a;
}

// 材质权重：每格 0/1 → 模糊 → 打包成四张 RGBA 纹理
function trxWeights() {
  const ty = TER.type, N = GW * GH, f = () => new Float32Array(N), m = {};
  for (const k of ['elev', 'forest', 'town', 'field', 'sand', 'rock', 'marsh', 'cliff', 'road', 'river', 'bridge', 'reef', 'hill', 'shoal', 'ford', 'mount']) m[k] = f();
  for (let i = 0; i < N; i++) {
    const t = ty[i];
    m.elev[i] = isWater(t) ? 0 : TER.elev[i];
    m.forest[i] = t === T.FOREST; m.town[i] = t === T.TOWN; m.field[i] = t === T.FIELD;
    m.sand[i] = t === T.BEACH; m.rock[i] = t === T.ROCKS; m.marsh[i] = t === T.MARSH; m.cliff[i] = t === T.CLIFF;
    m.road[i] = t === T.ROAD || t === T.BRIDGE; m.river[i] = t === T.RIVER || t === T.FORD || t === T.BRIDGE; m.bridge[i] = t === T.BRIDGE;
    m.reef[i] = t === T.REEF; m.hill[i] = t === T.HILL; m.shoal[i] = t === T.SHOAL || t === T.REEF; m.ford[i] = t === T.FORD; m.mount[i] = t === T.MOUNT;
  }
  for (const k of ['elev', 'town', 'sand', 'cliff', 'road', 'river', 'bridge', 'ford']) trxBlur(m[k], 1);
  for (const k of ['forest', 'field', 'rock', 'marsh', 'reef', 'hill', 'mount']) trxBlur(m[k], 2);
  trxBlur(m.shoal, 4);
  const pack = (r, g, b, a) => {
    const d = new Uint8Array(N * 4);
    for (let i = 0; i < N; i++) { d[i * 4] = r[i] * 255; d[i * 4 + 1] = g[i] * 255; d[i * 4 + 2] = b[i] * 255; d[i * 4 + 3] = a[i] * 255; }
    return d;
  };
  return {
    a: pack(m.elev, m.forest, m.town, m.field), b: pack(m.sand, m.rock, m.marsh, m.cliff),
    c: pack(m.road, m.river, m.bridge, m.reef), d: pack(m.hill, m.shoal, m.ford, m.mount)
  };
}

const trxSig = () => { let n = 0; for (let i = 0; i < GW * GH; i++) if (TER.type[i] === T.BRIDGE) n++; return n; };

function trxTerrain() {
  const { gl } = TRX, w = trxWeights();
  ['a', 'b', 'c', 'd'].forEach((k, i) => {
    gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, TRX.tex[k]);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, GW, GH, 0, gl.RGBA, gl.UNSIGNED_BYTE, w[k]);
  });
  // 海岸线：W+1 个采样，按本图最高 / 最低点归一化到 16 位（亮度 = 高字节、透明度 = 低字节）
  const co = TER.coast; let lo = 1e9, hi = -1e9;
  for (let x = 0; x <= W; x++) { lo = Math.min(lo, co[x]); hi = Math.max(hi, co[x]); }
  const cr = Math.max(1, hi - lo), k = new Uint8Array((W + 1) * 2);
  for (let x = 0; x <= W; x++) { const v = Math.round((co[x] - lo) / cr * 65535); k[x * 2] = v >> 8; k[x * 2 + 1] = v & 255; }
  gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, TRX.tex.k);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE_ALPHA, W + 1, 1, 0, gl.LUMINANCE_ALPHA, gl.UNSIGNED_BYTE, k);
  Object.assign(TRX, { seed: TER.seed, sig: trxSig(), c0: lo, cr });
}

function trxResize() {
  TRX.cv.width = R.cv.width; TRX.cv.height = R.cv.height;
  TRX.gl.viewport(0, 0, TRX.cv.width, TRX.cv.height);
}

function trxDraw(time, flash) {
  const { gl } = TRX;
  if (TRX.seed !== TER.seed) trxTerrain();
  else if (--TRX.chk <= 0) { TRX.chk = 30; if (trxSig() !== TRX.sig) trxTerrain(); }   // 桥被炸 / 修复
  const P = TRX.P[typeof SETTINGS === 'object' && SETTINGS && SETTINGS.quality === 'low' ? 1 : 0], u = P.u;
  if (TRX.cur !== P) { gl.useProgram(P.pr); TRX.cur = P; }
  gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, TRX.tex.fog);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, GW, GH, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, FOGB);
  gl.uniform2f(u.uRes, TRX.cv.width, TRX.cv.height);
  gl.uniform3f(u.uView, R.s * R.dpr, R.ox * R.dpr, R.oy * R.dpr);
  gl.uniform2f(u.uCoast, TRX.c0, TRX.cr);
  gl.uniform1f(u.uTime, time % 1000);
  gl.uniform1f(u.uFlash, flash);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

// 无 WebGL 时：每格一种写实底色（含山体阴影），平滑放大
const TRX_FLAT = [[16, 62, 94], [58, 128, 134], [52, 70, 60], [214, 194, 145], [125, 118, 104], [92, 86, 76], [104, 124, 62], [52, 80, 34],
  [112, 114, 70], [140, 134, 120], [84, 94, 56], [48, 78, 76], [150, 146, 136], [160, 155, 145], [128, 124, 114], [96, 120, 110]];
function trxFallback(ctx) {
  if (TRX.fbSeed !== TER.seed) {
    const c = TRX.fb || (TRX.fb = document.createElement('canvas')), g = c.getContext('2d'), E = TER.elev;
    c.width = GW; c.height = GH;
    const img = g.createImageData(GW, GH);
    for (let i = 0; i < GW * GH; i++) {
      const t = TER.type[i], gx = i % GW, gy = (i / GW) | 0, col = TRX_FLAT[t] || TRX_FLAT[0];
      const ex = E[gy * GW + Math.min(GW - 1, gx + 1)] - E[gy * GW + Math.max(0, gx - 1)], ey = E[Math.min(GH - 1, gy + 1) * GW + gx] - E[Math.max(0, gy - 1) * GW + gx];
      const k = isWater(t) ? 1 - clamp((cellCY(i) - coastAt(cellCX(i))) / 900, 0, .6) : clamp(1 - (ex + ey) * 4, .55, 1.35);
      for (let j = 0; j < 3; j++) img.data[i * 4 + j] = clamp(col[j] * k, 0, 255);
      img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    TRX.fbSeed = TER.seed;
  }
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(TRX.fb, 0, 0, W, H);
  const g = R.fog.getContext('2d'), img = g.createImageData(GW, GH);
  for (let i = 0; i < GW * GH; i++) img.data[i * 4 + 3] = FOGB[i] ? 0 : 120;
  g.putImageData(img, 0, 0);
  ctx.drawImage(R.fog, 0, 0, W, H);
}
