'use strict';
// 写实地形：WebGL 着色器按真实俯视画面渲染——海水（按水深着色、波纹、阳光反光、岸边浪花）、沙滩、农田拼块、林冠、丘陵山岩、沼泽、城镇地面、道路、河流，西北光源山体阴影；视野外去饱和压暗
// 地形材质先在 CPU 上算成平滑过的权重纹理（每格一个像素，线性插值），海岸线用 TER.coast 的平滑曲线；着色器用噪声扰动边界、叠加细节，细节按缩放淡入（远看不闪）
const TRX = { ok: false, tried: false, gl: null, cv: null, vs: null, P: {}, tex: {}, seed: null, sig: -1, chk: 0, c0: 0, cr: 1, fb: null, fbSeed: null,
  ver: 0, fbs: [], blit: null, fbOk: null, key: null, prev: null, lastSig: null, lastKey: null, lastT: 0 };   // ver 地形贴图版本；fbs 陆地缓存（全 / 低分辨率）；key 缓存对应的镜头，prev 上一帧的镜头；last* 上次合成
const TRX_KS = Math.ceil((W + 1) / 4096);   // 海岸线纹理每几个世界单位一个采样：纹理宽 W / TRX_KS + 1，不超过手机常见的 4096 上限（8400 宽的地图每 3 个）

const TRX_VS = 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }';
// pass：0 一遍画完整帧（开场快照、镜头正在移动、没有帧缓冲时）· 1 只画陆地，存进缓存贴图（镜头不动就不重画）
// · 2 合成：读陆地缓存，海面、河水流动、视野、闪光每帧现算——陆地着色是整个画面最重的部分，镜头不动时每帧只剩合成
const TRX_FS = (lite, pass = 0) => `precision highp float;
#define LITE ${lite ? 1 : 0}
#define PASS ${pass}
uniform vec2 uRes, uCoast, uShift; uniform vec3 uView; uniform float uTime, uFlash;
uniform sampler2D uA, uB, uC, uD, uK, uFog, uL, uR;
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
#if PASS != 2
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
#endif
// 海岸线 y：16 位（高低两字节）存储，最近点采样后手动线性插值，避免 8 位量化在岸边浪线上出现竖条
// 每 TRX_KS 个世界单位一个采样（纹理宽 W / TRX_KS + 1，不超过手机常见的 4096 上限）
const float KN = ${W / TRX_KS}.;
float coastY(float x) {
  float fx = clamp(x, 0., WORLD.x) / ${TRX_KS}., i = floor(fx);
  vec2 a = texture2D(uK, vec2((i + .5) / (KN + 1.), .5)).ra, b = texture2D(uK, vec2((min(i + 1., KN) + .5) / (KN + 1.), .5)).ra;
  return uCoast.x + mix(a.x * 65280. + a.y * 255., b.x * 65280. + b.y * 255., fx - i) / 65535. * uCoast.y;
}
#if !LITE && PASS != 2
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
// 海岸：到平滑海岸线的距离（>0 陆地）。竖直差按海岸坡度换算成垂直于岸线的距离，斜岸处水色与浪线不被压扁
float coastD(vec2 w) {
  float cy = coastY(w.x), slope = (coastY(w.x + 6.) - coastY(w.x - 6.)) / 12.;
  return (cy - w.y) / sqrt(1. + slope * slope) + (vn(w * .07) - .5) * 5.;
}
#if PASS != 1
// —— 海 ——（随时间动：波纹、涌浪、阳光碎光、浪花）；各项只在它不为零的地方算（远看没有碎光、远岸没有浪花）
vec3 seaCol(vec2 w, float pw, float t, float sd, vec4 C, vec4 D) {
  float dpt = max(0., -sd) / mix(1., 2.6, D.g);   // 浅滩处坡缓
  vec3 sea = mix(vec3(.47, .66, .58), vec3(.16, .5, .54), smoothstep(0., 16., dpt));
  sea = mix(sea, vec3(.07, .3, .42), smoothstep(14., 80., dpt));
  sea = mix(sea, vec3(.04, .17, .28), smoothstep(70., 380., dpt));
  sea = mix(sea, vec3(.025, .1, .19), smoothstep(380., 900., dpt));
  float det = 1. - smoothstep(1.5, 4., pw);
  float wv = vn(w * .045 + vec2(t * .12, t * .05)) * .6 + vn(w * .11 - vec2(t * .15, -t * .08)) * .4;
  sea *= .9 + .2 * wv;
  float sw = det * smoothstep(20., 80., dpt);
  if (sw > 0.) sea *= 1. + .05 * sin(dpt * .12 - t * .9 + vn(w * .01) * 6.) * sw;   // 涌浪：长条明暗
  float gk = (1. - smoothstep(.25, .5, pw)) * smoothstep(15., 120., dpt);
  if (gk > 0.) {   // 阳光碎光：细小，像素大于光斑时不画
    float gn = vn(w * .45 + t * vec2(.6, .3)) * vn(w * .57 - t * vec2(.4, .5));
    sea += vec3(.4, .45, .45) * smoothstep(.55, .85, gn) * .07 * gk;
  }
  // 河口：入海的泥沙水
  sea = mix(sea, vec3(.3, .42, .38), smoothstep(.08, .4, C.g) * .55 * smoothstep(45., 0., dpt));
  // 暗礁：水下礁盘 + 一圈白浪
  float rf = smoothstep(.3, .55, C.a + (vn(w * .08) - .5) * .4);
  if (rf > .002) sea = mix(sea, mix(vec3(.22, .57, .56), vec3(.3, .44, .38), smoothstep(.5, .72, fbm(w * .09, pw * .09))), rf * .7);
  float foam = rf * (1. - rf) > 0. ? rf * (1. - rf) * 2.4 * smoothstep(.45, .85, vn(w * .2 + t * .4)) : 0.;
  // 岸边浪花：向岸推进的浪线 + 拍岸白线
  if (dpt < 16.) {
    float bands = sin(dpt * .42 - t * 1.7 + vn(w * .03) * 7.);
    foam += smoothstep(16., 0., dpt) * smoothstep(.6, .97, bands) * (.45 + .55 * vn(w * .35 + t * .5));
    if (dpt < 3.5) foam += smoothstep(3.5, 0., dpt) * (.55 + .45 * vn(w * .5 - t * .6));
  }
  return mix(sea, vec3(.9, .93, .92), clamp(foam, 0., 1.) * .85);
}
#endif
void main() {
  vec2 fc = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 w = (fc - uView.yz) / uView.x;
  float pw = 1. / uView.x, t = uTime;
  // 地图边界外照样画（南边是外海，东西两侧按边缘延伸），只略微压暗，放大到边缘不会露出黑底
  float outD = length(max(max(-w, w - WORLD), 0.));
  w = vec2(WORLD.x - abs(WORLD.x - abs(w.x)), abs(w.y));   // 东西两侧、北侧按边界镜像（以前截在边缘像素上，拉成一道道横条）
  vec2 uv0 = w / WORLD;
  // 材质边缘：权重加多尺度噪声后取一条窄过渡带（约 1–2 个像素），边缘清楚但形状自然
  float eb = .03 + pw * .02;
  vec3 c = vec3(0.);
#if PASS == 2
  // 合成：陆地读缓存（rgb 按 1/1.5 存，亮沙坡等超过 1 的颜色不被截掉；a 是陆地覆盖度），震动时按偏移平移着读
  vec4 Lc = texture2D(uL, (gl_FragCoord.xy + uShift) / uRes);
  c = Lc.rgb * 1.5;
  vec4 Lf = texture2D(uR, uv0);
  bool sea = Lc.a < .999, riv = Lc.a > .001 && Lf.g < .45;
  if (sea || riv) {
    vec2 wq = w + (vec2(vn(w * .045), vn(w * .045 + 31.7)) - .5) * 6.;
    vec4 C = texture2D(uC, (w + (wq - w) * .3) / WORLD), D = texture2D(uD, wq / WORLD);
    // 河水流动：缓存里的河面按噪声中值画，这里补上随时间变的那一份（后面盖上的路肩、桥面按各自覆盖度扣掉）
    if (riv) {
      float rv = 1. - smoothstep(1. - pw / 7., 1. + pw / 7., Lf.g * 2.5), hw = max(Lf.b * 8., 1.5);
      if (rv > .002) {
        float rd = 1. - smoothstep(hw - pw * .6, hw + pw * .6, Lf.r * 12.);
        float k = rv * (1. - smoothstep(.2, .5, D.b) * .6) * (1. - rd);
        c += (vn(w * .15 + vec2(0., -t * .6)) - .5) * k * vec3(.07, .07, .05);
      }
    }
    if (sea) { float sd = coastD(w); c = mix(seaCol(w, pw, t, sd, C, D), c, smoothstep(-pw, pw, sd)); }
  }
#else
  // 边界扰动：材质边缘不沿格子走
  vec2 wq = w + (vec2(vn(w * .045), vn(w * .045 + 31.7)) - .5) * 6.;
  vec2 uv = wq / WORLD, uvr = (w + (wq - w) * .3) / WORLD;
  vec4 A = texture2D(uA, uv), B = texture2D(uB, uv), C = texture2D(uC, uvr), D = texture2D(uD, uv);
  float sd = coastD(w), land = smoothstep(-pw, pw, sd);
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
    // 河流（含桥下、渡口）与河岸：按河道中心线的距离场画（uR.g，rq = 到中心的水平距离 / 半宽，水面 rq < 1，与格子判河一致）——
    //   水面中间深、近岸浅，岸线一道浅色水痕；岸外一道泥沙滩，再外一圈偏深的湿草、芦苇；河口入海的部分照旧由海水着色接上
    vec4 Lf = texture2D(uR, uv0);
    float rq = Lf.g * 2.5, rfw = pw / 7.;
    float rv = 1. - smoothstep(1. - rfw, 1. + rfw, rq + (vn(w * .21) - .5) * .05);
    float bank = (1. - smoothstep(1.12, 1.42, rq + (vn(w * .13) - .5) * .22)) * (1. - rv);
    float verge = (1. - smoothstep(1.35, 2.2, rq + (vn(w * .08) - .5) * .5)) * (1. - rv) * (1. - bank);
    lc = mix(lc, lc * vec3(.78, .88, .7), verge * .8);
    lc = mix(lc, mix(vec3(.45, .4, .29), vec3(.56, .51, .39), vn(w * .32)), bank * .9);
    if (rv > .002) {
#if PASS == 1
      float rvn = .5;   // 缓存：取噪声中值，流动由合成补上
#else
      float rvn = vn(w * .15 + vec2(0., -t * .6));
#endif
      vec3 river = mix(vec3(.11, .21, .23), vec3(.22, .34, .32), smoothstep(.1, .95, rq));   // 中间深、近岸浅
      river *= .93 + .14 * rvn;
      river += vec3(.07, .08, .06) * smoothstep(.78, .96, rq);   // 岸线水痕
      lc = mix(lc, mix(river, vec3(.42, .5, .44), smoothstep(.2, .5, D.b) * .6), rv);
    }
    // 道路：按中心线距离场画（uR.r 距离、uR.b 半宽、uR.a 路程相位）——干线是沥青路面，有车辙、白色边线与中心虚线；
    //   村道、滩头出口路是碎石路面；两侧土路肩；过河处是桥面（混凝土、两边护栏，桥下水面落影）
    float dR = Lf.r * 12., hw = max(Lf.b * 8., 1.5), mainR = step(3.2, hw);
    float rd = 1. - smoothstep(hw - pw * .6, hw + pw * .6, dR);
    float sho = (1. - smoothstep(hw + .3, hw + 1.5 + pw, dR + (vn(w * .37) - .5) * .7)) * (1. - rd);
    lc = mix(lc, mix(vec3(.47, .42, .33), vec3(.55, .5, .4), vn(w * .5)), sho * .7 * (1. - rv));
    lc *= 1. - .3 * (1. - smoothstep(.0, .5 + pw * .5, abs(dR - hw - .15))) * (1. - rv);   // 路缘一道暗线：路面在黑绿画面里也分得清边
    float brg = rd * rv, rdm = rd;
    lc *= 1. - .35 * rv * (1. - rd) * (1. - smoothstep(hw, hw + 3.5, dR));   // 桥下水面落影（路只在桥上跨河）
    if (rdm > .002) {
      float gn = vn(w * .35), track = (1. - smoothstep(.25, .9, abs(abs(dR) - hw * .45))) * (1. - smoothstep(.6, 1.6, pw));
      vec3 asph = mix(vec3(.5, .5, .48), vec3(.57, .57, .54), gn) * (1. - .1 * track);
      vec3 grav = mix(vec3(.62, .59, .52), vec3(.7, .66, .58), gn) * (1. - .08 * track);
      vec3 road = mix(grav, asph, mainR);
      float fine = 1. - smoothstep(.35, .7, pw);   // 标线只在近看时画
      road = mix(road, vec3(.86, .86, .82), mainR * fine * (1. - smoothstep(.12, .26 + pw * .3, abs(dR - (hw - .45)))) * (1. - brg));   // 白色边线
      road = mix(road, vec3(.88, .82, .55), mainR * fine * (1. - smoothstep(.1, .2 + pw * .3, dR)) * step(.55, Lf.a) * (1. - brg));   // 中心虚线
      vec3 deck = mix(vec3(.62, .61, .58), vec3(.7, .69, .66), gn);
      deck = mix(deck, vec3(.2, .2, .19), 1. - smoothstep(.25, .6 + pw * .4, hw - dR));   // 护栏
      lc = mix(lc, mix(road, deck, brg), rdm);
    }
    // 近看的细碎颗粒（草叶、土粒），像素大于颗粒时淡出
    float gr = 0.;
    if (pw < .6) gr = (vn(w * 1.7) - .5) * .16 * (1. - smoothstep(.25, .6, pw)) + (vn(w * 4.3) - .5) * .12 * (1. - smoothstep(.1, .25, pw));
    c = lc * (1. + gr * (1. - rd));
  }
#if PASS == 1
  gl_FragColor = vec4(c / 1.5, land);
#else
  if (land < .999) c = mix(seaCol(w, pw, t, sd, C, D), c, land);
#endif
#endif
#if PASS != 1
  c *= mix(1., .78, smoothstep(0., 160., outD));
  // 视野外：去饱和、压暗、偏冷
  float vis = texture2D(uFog, uv0).r, lum = dot(c, vec3(.3, .59, .11));
  c = mix(mix(vec3(lum), c, .35) * vec3(.84, .9, .98) * .62, c, vis);
  c += vec3(1., .95, .85) * uFlash * .18;
  gl_FragColor = vec4(c, 1.);
#endif
}`;

const TRX_U = ['uA', 'uB', 'uC', 'uD', 'uK', 'uFog', 'uL', 'uR'];   // 依次占贴图单元 0–7（uR 线状地物距离场 terLines）
function trxSh(gl, type, src) {
  const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}
// 着色程序按用到时编译（pass 见 TRX_FS）
function trxProg(pass, lite) {
  const key = pass * 2 + (lite ? 1 : 0);
  if (TRX.P[key]) return TRX.P[key];
  const { gl } = TRX, pr = gl.createProgram();
  gl.attachShader(pr, TRX.vs); gl.attachShader(pr, trxSh(gl, gl.FRAGMENT_SHADER, TRX_FS(lite, pass)));
  gl.bindAttribLocation(pr, 0, 'p');
  gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
  gl.useProgram(pr);
  const u = {};
  for (const n of ['uRes', 'uView', 'uTime', 'uFlash', 'uCoast', 'uShift', ...TRX_U]) u[n] = gl.getUniformLocation(pr, n);
  TRX_U.forEach((n, i) => { if (u[n]) gl.uniform1i(u[n], i); });
  return (TRX.P[key] = { pr, u });
}

function trxInit() {
  TRX.tried = true;
  try {
    const cv = document.createElement('canvas');
    const gl = cv.getContext('webgl', { antialias: false, preserveDrawingBuffer: true, premultipliedAlpha: false });
    if (!gl) return;
    Object.assign(TRX, { gl, cv, P: {}, vs: trxSh(gl, gl.VERTEX_SHADER, TRX_VS) });
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    trxProg(0, false); trxProg(0, true);
    ['a', 'b', 'c', 'd', 'k', 'fog', null, 'lf'].forEach((k, i) => {
      if (!k) return;   // 单元 6 是陆地缓存（帧缓冲贴图）
      const t = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, t);
      const filt = k === 'k' ? gl.NEAREST : gl.LINEAR;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filt); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filt);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      TRX.tex[k] = t;
    });
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    TRX.ok = true;
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

// 线状地物距离场（道路、河流按中心线算，4 倍网格精度 = 每 2.5 米一个像素，路面、河岸的边是光滑的曲线，不再是一格格的台阶）：
//   R 到最近道路中心线的距离 / 12 米 · G 到河道中心线的水平距离 / 河道半宽 / 2.5（与格子里判河的规则一致）·
//   B 最近那条路的半宽 / 8 · A 沿路程的相位 0.5 + 0.5cos(2πs / 9)（干线中心虚线）。按地图缓存在 TER.lf，2D 地形与 3D 地面共用
const LF_K = 4;
function terLines() {
  if (TER.lf && TER.lf.seed === TER.seed) return TER.lf;
  const w = GW * LF_K, h = GH * LF_K, px = CELL / LF_K, n = w * h;
  const dR = new Float32Array(n).fill(99), hR = new Float32Array(n), sR = new Float32Array(n), dV = new Float32Array(n).fill(9);
  for (const rd of TER.roads || []) {
    let s0 = 0;
    for (let k = 1; k < rd.pts.length; k++) {
      const [x0, y0] = rd.pts[k - 1], [x1, y1] = rd.pts[k], L = Math.hypot(x1 - x0, y1 - y0) || 1e-6, ux = (x1 - x0) / L, uy = (y1 - y0) / L, pad = rd.hw + 9;
      const i0 = Math.max(0, Math.floor((Math.min(x0, x1) - pad) / px)), i1 = Math.min(w - 1, Math.ceil((Math.max(x0, x1) + pad) / px));
      const j0 = Math.max(0, Math.floor((Math.min(y0, y1) - pad) / px)), j1 = Math.min(h - 1, Math.ceil((Math.max(y0, y1) + pad) / px));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = (i + .5) * px, y = (j + .5) * px, t = clamp((x - x0) * ux + (y - y0) * uy, 0, L), d = Math.hypot(x - x0 - ux * t, y - y0 - uy * t), q = j * w + i;
        if (d < dR[q]) { dR[q] = d; hR[q] = rd.hw; sR[q] = s0 + t; }
      }
      s0 += L;
    }
  }
  for (const rv of TER.rivers || []) {
    const top = rv.top, X = gy => rv.rx[clamp(gy, 0, GH - 1)];
    for (let j = 0; j < h; j++) {
      const y = (j + .5) * px, g = (y - 5) / CELL, g0 = Math.floor(g), f = g - g0, a = X(g0), b = X(g0 + 1);
      if (a < -1e8 || b < -1e8 || y < top) continue;
      const cx = a + (b - a) * f, hw = rv.w * (y - top < 80 && top > 0 ? .55 + .45 * (y - top) / 80 : 1);   // 河源一段渐窄
      const i0 = Math.max(0, Math.floor((cx - hw * 2.6) / px)), i1 = Math.min(w - 1, Math.ceil((cx + hw * 2.6) / px));
      for (let i = i0; i <= i1; i++) { const q = j * w + i, d = Math.abs((i + .5) * px - cx) / hw; if (d < dV[q]) dV[q] = d; }
    }
  }
  const d = new Uint8Array(n * 4);
  for (let q = 0; q < n; q++) {
    d[q * 4] = Math.round(Math.min(1, dR[q] / 12) * 255);
    d[q * 4 + 1] = Math.round(Math.min(1, dV[q] / 2.5) * 255);
    d[q * 4 + 2] = Math.round(Math.min(1, hR[q] / 8) * 255);
    d[q * 4 + 3] = Math.round((.5 + .5 * Math.cos(sR[q] * Math.PI * 2 / 9)) * 255);
  }
  return (TER.lf = { seed: TER.seed, w, h, d });
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
  // 海岸线：每 TRX_KS 个世界单位一个采样（共 W / TRX_KS + 1 个），按本图最高 / 最低点归一化到 16 位（亮度 = 高字节、透明度 = 低字节）
  const co = TER.coast, KN = W / TRX_KS; let lo = 1e9, hi = -1e9;
  for (let x = 0; x <= W; x++) { lo = Math.min(lo, co[x]); hi = Math.max(hi, co[x]); }
  const cr = Math.max(1, hi - lo), k = new Uint8Array((KN + 1) * 2);
  for (let j = 0; j <= KN; j++) { const v = Math.round((co[Math.min(W, j * TRX_KS)] - lo) / cr * 65535); k[j * 2] = v >> 8; k[j * 2 + 1] = v & 255; }
  gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, TRX.tex.k);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE_ALPHA, KN + 1, 1, 0, gl.LUMINANCE_ALPHA, gl.UNSIGNED_BYTE, k);
  const lf = terLines();
  gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D, TRX.tex.lf);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, lf.w, lf.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, lf.d);
  Object.assign(TRX, { seed: TER.seed, sig: trxSig(), c0: lo, cr, ver: TRX.ver + 1 });
}

function trxResize() {
  TRX.cv.width = R.cv.width; TRX.cv.height = R.cv.height; TRX.lastSig = null;   // 改尺寸会清空画布，下一帧必须重画
  TRX.gl.viewport(0, 0, TRX.cv.width, TRX.cv.height);
}

// 地形三种画法：镜头不动（震动不算）→ 读全分辨率陆地缓存 + 合成；镜头在动（拖动、缩放）→ 整个地形按低分辨率一遍画完再放大贴上
// （像素少一半到四分之三，运动中看不出糊）；停下来的那一帧建全分辨率缓存。3D 的屏外俯视、没有帧缓冲时照旧全分辨率一遍画完
const trxSame = (a, b) => !!a && a.w === b.w && a.h === b.h && a.lite === b.lite && a.v === b.v && Math.abs(a.s - b.s) <= b.s * 1e-6 && Math.abs(a.x - b.x) < .05 && Math.abs(a.y - b.y) < .05;
// 缓存贴图 + 帧缓冲：n = 0 全分辨率、1 低分辨率；尺寸变了重新分配
function trxFbo(n, w, h) {
  const { gl } = TRX, F = TRX.fbs[n] || (TRX.fbs[n] = { fbo: gl.createFramebuffer(), tex: gl.createTexture(), w: 0, h: 0 });
  if (F.w === w && F.h === h) return F;
  gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, F.tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.LINEAR);
  for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE);
  gl.bindFramebuffer(gl.FRAMEBUFFER, F.fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, F.tex, 0);
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (!ok) throw new Error('帧缓冲不完整');
  F.w = w; F.h = h;
  return F;
}
// 返回 2：陆地缓存可用（合成）· 1：镜头在动（低分辨率一遍画完）· 0：不支持缓存
function trxCache(k) {
  if (TRX.fbOk === false) return 0;
  if (trxSame(TRX.key, k)) return 2;
  const still = trxSame(TRX.prev, k);   // 和上一帧同一个镜头：已经停下
  TRX.prev = k;
  if (!still) return 1;
  const { gl } = TRX;
  try {
    const L = trxProg(1, k.lite); trxProg(2, k.lite);
    const F = trxFbo(0, k.w, k.h);
    gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, null);   // 画进缓存时它不能同时被绑成贴图
    gl.bindFramebuffer(gl.FRAMEBUFFER, F.fbo);
    gl.useProgram(L.pr);
    gl.uniform2f(L.u.uRes, k.w, k.h); gl.uniform3f(L.u.uView, k.s, k.x, k.y); gl.uniform2f(L.u.uCoast, TRX.c0, TRX.cr);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    TRX.key = k;
    return 2;
  } catch (e) {
    TRX.fbOk = false; gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    console.warn('地形缓存不可用，改为每帧整帧绘制', e);
    return 0;
  }
}
// 低分辨率贴图放大贴到画布上
const TRX_BLIT = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D uL; uniform vec2 uRes;
void main() { gl_FragColor = texture2D(uL, gl_FragCoord.xy / uRes); }`;
function trxBlitProg() {
  if (TRX.blit) return TRX.blit;
  const { gl } = TRX, pr = gl.createProgram();
  gl.attachShader(pr, TRX.vs); gl.attachShader(pr, trxSh(gl, gl.FRAGMENT_SHADER, TRX_BLIT));
  gl.bindAttribLocation(pr, 0, 'p'); gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
  gl.useProgram(pr); gl.uniform1i(gl.getUniformLocation(pr, 'uL'), 6);
  return (TRX.blit = { pr, uRes: gl.getUniformLocation(pr, 'uRes') });
}

function trxDraw(time, flash) {
  const { gl, cv } = TRX;
  if (TRX.seed !== TER.seed) trxTerrain();
  else if (--TRX.chk <= 0) { TRX.chk = 30; if (trxSig() !== TRX.sig) trxTerrain(); }   // 桥被炸 / 修复
  const lite = typeof SETTINGS === 'object' && !!SETTINGS && SETTINGS.quality === 'low';
  const s = R.s * R.dpr, ox = R.ox * R.dpr, oy = R.oy * R.dpr;
  // 缓存按不带震动的镜头算（R.shx / R.shy 是 drawScene 加上的震动），震动只把缓存平移着读；3D 的屏外俯视每帧都在变，不用缓存
  const k = { w: cv.width, h: cv.height, s, x: ox - (R.shx || 0) * R.dpr, y: oy - (R.shy || 0) * R.dpr, lite, v: TRX.ver };
  let mode = typeof V3 === 'object' && V3.drawing ? 0 : trxCache(k), F = null, sc = 1;
  if (mode === 1) {
    sc = R.dpr >= 1.5 ? .5 : .7;
    try { F = trxFbo(1, Math.max(1, Math.round(cv.width * sc)), Math.max(1, Math.round(cv.height * sc))); trxBlitProg(); sc = F.w / cv.width; }
    catch (e) { TRX.fbOk = false; console.warn('地形缓存不可用，改为每帧整帧绘制', e); mode = 0; sc = 1; F = null; }
  }
  // 合成也省着画：镜头（含震动）、闪光都没变时，海浪、河水按每秒 30 次更新就够平滑，其余帧沿用画布上的上一张（preserveDrawingBuffer）
  const sig = mode === 2 ? `${TRX.key.x - ox},${oy - TRX.key.y},${flash}` : null;
  if (mode === 2 && TRX.lastSig === sig && TRX.lastKey === TRX.key && time >= TRX.lastT && time - TRX.lastT < 1 / 31) return;
  TRX.lastSig = sig; TRX.lastKey = mode === 2 ? TRX.key : null; TRX.lastT = time;
  gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, TRX.tex.fog);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, GW, GH, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, FOGB);
  const P = trxProg(mode === 2 ? 2 : 0, lite), u = P.u;
  gl.useProgram(P.pr);
  gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, mode === 2 ? TRX.fbs[0].tex : null);
  if (u.uShift) gl.uniform2f(u.uShift, TRX.key.x - ox, oy - TRX.key.y);
  if (F) { gl.bindFramebuffer(gl.FRAMEBUFFER, F.fbo); gl.viewport(0, 0, F.w, F.h); }
  gl.uniform2f(u.uRes, cv.width * sc, cv.height * sc);
  gl.uniform3f(u.uView, s * sc, ox * sc, oy * sc);
  gl.uniform2f(u.uCoast, TRX.c0, TRX.cr);
  gl.uniform1f(u.uTime, time % 1000);
  gl.uniform1f(u.uFlash, flash);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  if (F) {   // 低分辨率画好的地形放大贴到画布上
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, cv.width, cv.height);
    const B = TRX.blit;
    gl.useProgram(B.pr); gl.uniform2f(B.uRes, cv.width, cv.height);
    gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, F.tex);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
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
  cv.width = wpx; cv.height = hp; gl.viewport(0, 0, wpx, hp); TRX.lastSig = null;
  const P = trxProg(0, false), u = P.u;
  gl.useProgram(P.pr);
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
