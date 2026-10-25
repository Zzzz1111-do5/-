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
// 返回颜色；ed 为到田埂 / 田区边界的距离（世界单位），wc 为本块地中心（世界坐标，用来整块决定有没有这块地），fk 为本块随机数
vec3 farm(vec2 w, float pw, out float ed, out vec2 wc, out float fk) {
  vec2 p = w / 260., i = floor(p), f = fract(p), id0 = i;
  float d1 = 9., d2 = 9.;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y)), r = g + h22(i + g) * .8 + .1 - f;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; id0 = i + g; } else if (d < d2) d2 = d;
  }
  float zb = (sqrt(d2) - sqrt(d1)) * 130.;   // 约等于到田区边界的距离
  float ang = (h21(id0 + 2.7) - .5) * 1.3, ca = cos(ang), sa = sin(ang);
  vec2 o = h22(id0) * 200., q = vec2(ca * w.x + sa * w.y, -sa * w.x + ca * w.y) + o;
  float ry = floor(q.y / 30.), hr = h21(vec2(ry, 7.) + id0), cw = 30. + 34. * hr, qx = q.x + hr * 97., cx = floor(qx / cw);
  vec2 id = vec2(cx, ry) + id0 * 31.;
  float fx = fract(qx / cw), fy = fract(q.y / 30.);
  ed = min(min(min(fx, 1. - fx) * cw, min(fy, 1. - fy) * 30.), zb);
  vec2 qc = vec2((cx + .5) * cw - hr * 97., (ry + .5) * 30.) - o;
  wc = vec2(ca * qc.x - sa * qc.y, sa * qc.x + ca * qc.y);
  float k = h21(id + 13.1), k2 = h21(id + 5.3);
  fk = h21(id + 21.7);
  vec3 c = k < .26 ? vec3(.41, .52, .24) : k < .48 ? vec3(.33, .44, .2) : k < .62 ? vec3(.6, .57, .34) : k < .78 ? vec3(.45, .38, .27) : k < .9 ? vec3(.5, .51, .32) : vec3(.38, .48, .29);
  c *= .92 + .16 * k2;
  float rows = sin((k2 < .5 ? q.x : q.y) * 2.4) * (1. - smoothstep(.15, .3, pw));   // 垄沟：只在很近时淡淡可见
  return c * (1. + rows * .03) * (.94 + .12 * vn(w * .09));
}
// 海岸线 y：16 位（高低两字节）存储，最近点采样后手动线性插值，避免 8 位量化在岸边浪线上出现竖条
// 每 2 个世界单位一个采样（纹理宽 W/2+1，不超过手机常见的 4096 上限）
const float KN = ${W / 2}.;
float coastY(float x) {
  float fx = clamp(x, 0., WORLD.x) * .5, i = floor(fx);
  vec2 a = texture2D(uK, vec2((i + .5) / (KN + 1.), .5)).ra, b = texture2D(uK, vec2((min(i + 1., KN) + .5) / (KN + 1.), .5)).ra;
  return uCoast.x + mix(a.x * 65280. + a.y * 255., b.x * 65280. + b.y * 255., fx - i) / 65535. * uCoast.y;
}
#if !LITE
// 林冠：泰森格里每格一棵树（半径约 2–3.3 世界单位），按密度随机决定有无（林缘逐渐稀疏成散树）；树冠按西北光源做球面明暗
// 返回 rgb 树冠颜色、a 覆盖度（树冠外为 0，露出下面的地面）
vec4 canopy(vec2 w, float dens) {
  vec2 p = w / 5.2, i = floor(p), f = fract(p), br = vec2(0.);
  float best = 9., bh = 0.;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y)), c = i + g, r = g + h22(c) - f;
    float sz = .5 + .32 * h21(c + 5.), d = length(r) / sz;
    if (h21(c + 11.) < dens && d < best) { best = d; br = -r / sz; bh = h21(c + 2.); }
  }
  float inside = 1. - smoothstep(.82, 1.02, best);
  float lit = clamp(.72 + .42 * dot(br, vec2(-.68, -.73)) + .22 * sqrt(max(0., 1. - best * best)), .38, 1.35);
  return vec4(mix(vec3(.15, .26, .1), vec3(.29, .4, .17), bh) * lit, inside);
}
// 礁石 / 山岩：泰森格里每格一块石头（约 3 世界单位），按西北光源做明暗，石缝发暗
vec3 stones(vec2 w, vec3 base) {
  vec2 p = w / 3.2, i = floor(p), f = fract(p), br = vec2(0.);
  float d1 = 9., d2 = 9., bh = 0.;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y)), r = g + h22(i + g) - f;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; br = -r; bh = h21(i + g + 4.); } else if (d < d2) d2 = d;
  }
  float crev = smoothstep(0., .18, sqrt(d2) - sqrt(d1));
  float lit = clamp(.8 + .5 * dot(br, vec2(-.68, -.73)), .55, 1.3);
  return base * (.82 + .3 * bh) * lit * mix(.55, 1., crev);
}
#endif
void main() {
  vec2 fc = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 w = (fc - uView.yz) / uView.x;
  float pw = 1. / uView.x, t = uTime;
  // 地图边界外照样画（南边是外海，东西两侧按边缘延伸），只略微压暗，放大到边缘不会露出黑底
  float outD = length(max(max(-w, w - WORLD), 0.));
  w = vec2(WORLD.x - abs(WORLD.x - abs(w.x)), abs(w.y));   // 东西两侧、北侧按边界镜像（以前截在边缘像素上，拉成一道道横条）
  // 边界扰动：材质边缘不沿格子走
  vec2 wq = w + (vec2(vn(w * .045), vn(w * .045 + 31.7)) - .5) * 6.;
  vec2 uv = wq / WORLD, uv0 = w / WORLD, uvr = (w + (wq - w) * .3) / WORLD;
  vec4 A = texture2D(uA, uv), B = texture2D(uB, uv), C = texture2D(uC, uvr), D = texture2D(uD, uv);
  float vis = texture2D(uFog, uv0).r;
  // 海岸：到平滑海岸线的距离（>0 陆地）。竖直差按海岸坡度换算成垂直于岸线的距离，斜岸处水色与浪线不被压扁
  float cy = coastY(w.x), slope = (coastY(w.x + 6.) - coastY(w.x - 6.)) / 12.;
  float sd = (cy - w.y) / sqrt(1. + slope * slope) + (vn(w * .07) - .5) * 5.;
  float land = smoothstep(-pw, pw, sd);
  // 材质边缘：权重加多尺度噪声后取一条窄过渡带（约 1–2 个像素），边缘清楚但形状自然
  float eb = .03 + pw * .02;
  vec3 c = vec3(0.);
  // —— 陆地 ——（各材质只在权重非零处计算）
  if (land > .001) {
    float e = A.r, n1 = fbm(w * .02, pw * .02), n2 = vn(w * .11), n3 = pw < 1.2 ? vn(w * .4) : .5;
    float nz = (n1 - .5) * .32 + (n2 - .5) * .12 + (n3 - .5) * .06;
    vec3 grass = mix(vec3(.34, .41, .2), vec3(.47, .51, .29), n1) * (.95 + .1 * n2);
    vec3 lc = grass;
    // 农田：整块地决定有无（按地块中心的田地权重），边缘一圈地块颜色偏向荒草，交界是田埂而不是渐隐
    if (A.a > .03) {
      float ed = 99., fk = 0.; vec2 wc = w;
      vec3 crop = farm(w, pw, ed, wc, fk);
      vec4 Ac = texture2D(uA, wc / WORLD);
      float fp = Ac.a * smoothstep(.4, .6, vn(wc * .0035 + 3.) + .25 - Ac.r * .6) + (fk - .5) * .3;
      float on = step(.4, fp), wild = 1. - smoothstep(.4, .75, fp);
      crop = mix(crop, mix(grass, vec3(.5, .5, .32), .35), wild * .55);
      lc = mix(lc, crop, on);
      float hedge = on * (1. - smoothstep(.6, 1.5 + pw * .5, ed)) * (1. - smoothstep(2.5, 5., pw));
      lc = mix(lc, mix(vec3(.25, .31, .15), vec3(.52, .48, .36), step(.6, h21(floor(wc / 40.)))), hedge * .7);
    }
    // 丘陵：偏干的草坡，色差小，边缘随噪声走；近看点缀灌丛（画在林地那一步）
    float hl = smoothstep(.4 - eb * 2., .4 + eb * 2., D.r + nz);
    if (hl > .002) lc = mix(lc, mix(vec3(.45, .47, .29), vec3(.39, .43, .24), n2) * (.95 + .1 * n1), hl * .85);
    // 沼泽：橄榄色芦苇地夹水洼
    float ms = smoothstep(.42 - eb, .42 + eb, B.b + nz);
    if (ms > .002) {
      float pool = smoothstep(.54, .58, fbm(w * .06 + 3., pw * .06));
      lc = mix(lc, mix(vec3(.34, .38, .22) * (.9 + .2 * vn(w * .5)), vec3(.14, .22, .22), pool), ms);
    }
    // 山地：先是灌木坡（随高程渐深），岩石只在高处、按噪声成片露出，不是整块灰色
    float mt = smoothstep(.3, .6, D.a + nz * .5);
    if (mt > .002) lc = mix(lc, mix(vec3(.3, .36, .19), vec3(.24, .3, .15), n2), mt * .8);
    float rk = max(smoothstep(.42 - eb, .42 + eb, B.g + nz), smoothstep(.55 - eb, .55 + eb, D.a * (.32 + .22 * smoothstep(.85, 1., e)) + (fbm(w * .03 + 5., pw * .03) - .5) * 1.6 + nz * .3));
    float cl = smoothstep(.4 - eb, .4 + eb, B.a + nz * .5);
    // 林地：林内是暗色林下地面；林缘的树一棵棵变稀，散树之间露出草地
    float fv = A.g + nz * 1.1;
    float fo = smoothstep(.42 - eb, .42 + eb, fv);
    if (fv > .2 || hl > .05 || mt > .05) {
      vec3 far = mix(vec3(.16, .26, .1), vec3(.25, .35, .16), fbm(w * .05 + 7., pw * .05));
      vec3 fl = mix(lc, mix(lc, vec3(.12, .16, .08), fo), 1.);
#if LITE
      lc = mix(lc, far, fo);
#else
      float near = 1. - smoothstep(.7, 1.7, pw);
      vec4 cn = near > 0. ? canopy(w, max(smoothstep(.22, .46, fv), max(hl * .1, mt * .45 * (1. - rk)))) : vec4(0.);
      lc = mix(mix(lc, far, fo), mix(fl, cn.rgb, cn.a), near);
#endif
    }
    // 岩石 / 山地 / 悬崖：灰褐岩面，近看有石块明暗；海边礁岩靠水一侧被打湿发暗
    if (rk + cl > .002) {
      float rn = fbm(w * .07 + 21., pw * .07);
      vec3 rock = mix(vec3(.4, .38, .34), vec3(.58, .55, .5), rn);
#if !LITE
      if (pw < 1.3) rock = mix(stones(w * mix(1., .45, mt), rock), rock, smoothstep(.6, 1.3, pw));   // 山上的岩块比海边礁石大
#endif
      rock = mix(rock, vec3(.32, .37, .21), smoothstep(.6, .74, fbm(w * .025 + 2., pw * .025)) * .5);
      rock *= mix(.72, 1., smoothstep(0., 6., sd));
      lc = mix(lc, rock, max(rk, cl));
    }
    // 城镇地面（房屋另画）：硬化地面夹小菜园
    float tw = smoothstep(.42 - eb, .42 + eb, A.b + nz * .8);
    if (tw > .002) {
      vec3 town = mix(vec3(.43, .42, .38), vec3(.52, .5, .45), vn(w * .2));
      lc = mix(lc, mix(town, vec3(.36, .45, .22), smoothstep(.64, .7, vn(w * .06 + 8.)) * .8), tw);
    }
    // 沙滩：干沙 → 靠水的湿沙
    float sn = smoothstep(.36 - eb, .36 + eb, B.r + nz * .7) * smoothstep(-2., 1., sd);
    if (sn > .002) {
      vec3 sand = mix(vec3(.78, .7, .5), vec3(.87, .8, .61), fbm(w * .05 + 13., pw * .05));
      lc = mix(lc, mix(vec3(.58, .53, .41), sand, smoothstep(1., 9., sd)), sn);
    }
    // 山体阴影：高程梯度，西北高处来光
    float dx = texture2D(uA, uv + vec2(1. / GRID.x, 0.)).r - texture2D(uA, uv - vec2(1. / GRID.x, 0.)).r;
    float dy = texture2D(uA, uv + vec2(0., 1. / GRID.y)).r - texture2D(uA, uv - vec2(0., 1. / GRID.y)).r;
    vec3 N = normalize(vec3(-dx * 9., -dy * 9., 1.)), L = normalize(vec3(-.55, -.65, .62));
    float sh = clamp(dot(N, L) / L.z, .55, 1.35);
    lc *= mix(1., sh, .85) * (.95 + e * .12);
    // 河流（含桥下、渡口）与河岸；河口一直通到海里
    float rvW = C.g, rv = smoothstep(.22 - eb * .5, .22 + eb * .5, rvW), bank = smoothstep(.12, .2, rvW) * (1. - rv);
    lc = mix(lc, vec3(.42, .38, .28), bank * .75);
    if (rv > .002) {
      vec3 river = mix(vec3(.18, .3, .3), vec3(.25, .37, .35), vn(w * .15 + vec2(0., -t * .6)));
      lc = mix(lc, mix(river, vec3(.42, .5, .44), smoothstep(.2, .5, D.b) * .6), rv);
    }
    // 道路：水泥路面 + 土路肩；桥面两侧压暗
    float rdW = C.r, rd = smoothstep(.27 - eb * .5, .27 + eb * .5, rdW), sho = smoothstep(.15, .25, rdW) * (1. - rd);
    lc = mix(lc, vec3(.47, .42, .33), sho * .6 * (1. - rv));
    float bg = smoothstep(.15, .3, C.b), rdm = max(rd, bg * rv);
    if (rdm > .002) {
      vec3 road = mix(vec3(.6, .58, .54), vec3(.68, .66, .62), vn(w * .3)) * (1. - .08 * smoothstep(.6, 1., vn(w * .9)));
      lc = mix(lc, mix(road, vec3(.12, .12, .11), bg * rv * (1. - smoothstep(.25, .4, rdW))), rdm);   // 只有桥面两侧有阴影
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
    sea *= 1. + .05 * sin(dpt * .12 - t * .9 + vn(w * .01) * 6.) * det * smoothstep(20., 80., dpt);   // 涌浪：长条明暗
    float gn = vn(w * .45 + t * vec2(.6, .3)) * vn(w * .57 - t * vec2(.4, .5));   // 阳光碎光：细小，像素大于光斑时不画
    sea += vec3(.4, .45, .45) * smoothstep(.55, .85, gn) * .07 * (1. - smoothstep(.25, .5, pw)) * smoothstep(15., 120., dpt);
    // 河口：入海的泥沙水
    sea = mix(sea, vec3(.3, .42, .38), smoothstep(.08, .4, C.g) * .55 * smoothstep(45., 0., dpt));
    // 暗礁：水下礁盘 + 一圈白浪
    float rf = smoothstep(.3, .55, C.a + (vn(w * .08) - .5) * .4);
    if (rf > .002) sea = mix(sea, mix(vec3(.22, .57, .56), vec3(.3, .44, .38), smoothstep(.5, .72, fbm(w * .09, pw * .09))), rf * .7);
    float foam = rf * (1. - rf) * 2.4 * smoothstep(.45, .85, vn(w * .2 + t * .4));
    // 岸边浪花：向岸推进的浪线 + 拍岸白线
    float bands = sin(dpt * .42 - t * 1.7 + vn(w * .03) * 7.);
    foam += smoothstep(16., 0., dpt) * smoothstep(.6, .97, bands) * (.45 + .55 * vn(w * .35 + t * .5));
    foam += smoothstep(3.5, 0., dpt) * (.55 + .45 * vn(w * .5 - t * .6));
    sea = mix(sea, vec3(.9, .93, .92), clamp(foam, 0., 1.) * .85);
    c = mix(sea, c, land);
  }
  c *= mix(1., .78, smoothstep(0., 160., outD));
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
  for (let i = 0; i < N - GW; i++) if (m.river[i] && !m.bridge[i] && isWater(ty[i + GW])) {   // 河口：入海处向南延伸 4 格并逐渐变宽
    const gx = i % GW, gy = (i / GW) | 0;
    for (let k = 1; k <= 4; k++) for (let dx = -(k >> 1); dx <= k >> 1; dx++) {
      const x = gx + dx, y = gy + k;
      if (x >= 0 && x < GW && y < GH) m.river[y * GW + x] = 1;
    }
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
  // 海岸线：每 2 个世界单位一个采样（共 W/2+1 个），按本图最高 / 最低点归一化到 16 位（亮度 = 高字节、透明度 = 低字节）
  const co = TER.coast, KN = W / 2; let lo = 1e9, hi = -1e9;
  for (let x = 0; x <= W; x++) { lo = Math.min(lo, co[x]); hi = Math.max(hi, co[x]); }
  const cr = Math.max(1, hi - lo), k = new Uint8Array((KN + 1) * 2);
  for (let j = 0; j <= KN; j++) { const v = Math.round((co[Math.min(W, j * 2)] - lo) / cr * 65535); k[j * 2] = v >> 8; k[j * 2 + 1] = v & 255; }
  gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, TRX.tex.k);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE_ALPHA, KN + 1, 1, 0, gl.LUMINANCE_ALPHA, gl.UNSIGNED_BYTE, k);
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

// 整张地图的写实地形快照（开场转场用）：宽 wpx 像素、全视野、无战争迷雾；画完把着色器画布还原成战场尺寸
function trxSnapshot(wpx) {
  if (!TRX.tried) trxInit();
  if (!TRX.ok || typeof TER !== 'object' || !TER) return null;
  const { gl } = TRX, hp = Math.round(wpx * H / W), cv = TRX.cv;
  if (TRX.seed !== TER.seed) trxTerrain();
  cv.width = wpx; cv.height = hp; gl.viewport(0, 0, wpx, hp);
  const P = TRX.P[0], u = P.u;
  gl.useProgram(P.pr); TRX.cur = P;
  gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, TRX.tex.fog);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, 1, 1, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, new Uint8Array([255]));
  gl.uniform2f(u.uRes, wpx, hp); gl.uniform3f(u.uView, wpx / W, 0, 0); gl.uniform2f(u.uCoast, TRX.c0, TRX.cr);
  gl.uniform1f(u.uTime, 0); gl.uniform1f(u.uFlash, 0);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  const out = document.createElement('canvas');
  out.width = wpx; out.height = hp; out.getContext('2d').drawImage(cv, 0, 0);
  if (R.cv) trxResize(); else { cv.width = 1; cv.height = 1; }
  return out;
}
