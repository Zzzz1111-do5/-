'use strict';
// 3D 立体地图（黑绿画风）：对局默认就是 3D（SETTINGS.v3，玩家切回平面后记住）；右上角「3D」按钮或 Shift + L 切换
// 画法：地形按高程做成立体网格（每 2 格一个顶点，高程放大 V3_HZ 倍，海面平铺，四周有沙盘围边）；
//   当前整帧战场（地形、单位、标记，已过黑绿着色器）先在屏外按俯视画好，作为贴图披在地形上；
//   再叠加西北来光的山体明暗、等高线（每 14 一条，每 5 条加粗）、200 一格的方格网、远处渐暗
// 镜头：绕画面中心转向（< > 键、中键横拖、双指旋转）、俯仰（; ' 键、中键竖拖）、滚轮 / 双指缩放、拖动平移；
//   点选、框选、下令都用视线与地形求交（v3Pick），操作与平面地图一样
// 坐标：GL 里用 (x, -y, 高) 的右手系（x 东、y 北、z 上），世界坐标 y 向南，换算时取负
const V3 = { on: false, ok: false, tried: false, gl: null, cv: null, pr: null, u: {}, a: {}, buf: null, n: 0, seed: null, sig: null,
  top: null, tex: null, base: null, hf: null, nx: 0, ny: 0, yaw: 0, tilt: .95, yawT: 0, tiltT: .95, box: null, cam: null, keep: null };
const V3_HZ = 230, V3_FOV = .8, V3_TILT = [.05, 1.45], V3_SKIRT = -70;   // 俯仰：从几乎正俯视到几乎平视
const V3_ZMAX = 11000, V3_OUT = 2400;   // 镜头最高高度、能飞出地图边多远：拉远能看见整张地图（黑绿画面是整张沙盘桌，v3table.js）
const V3_AIR = 230 * V3_HZ / 150;   // 飞机、导弹高度 alt 1.0 对应的 3D 高度：随地形高程放大，高空飞机始终在最高的山顶之上
let V3_ST = 2;   // 地形网格每几格一个顶点：显卡支持 32 位索引时为 1（每 10 米一个顶点，山脊、河谷的轮廓更细），否则 2
// 光照（所有 3D 着色器共用）：太阳方向（GL 坐标，指向太阳；与天空图 assets/sky/sky.jpg 里太阳的方位、48° 高度角一致）、日光、天光；
//   写实画面的背景是真实天空（Poly Haven「kloofendal_48d_partly_cloudy_puresky」，CC0），远处雾成地平线的天色（大气透视）；黑绿画面仍是近黑的底
const V3_SUN = [-.4236, .5178, .743], V3_SUNG = `normalize(vec3(${V3_SUN.join(', ')}))`, V3_HZ_COL = [.74, .75, .8];
const V3_SKYU = .595 - Math.atan2(V3_SUN[1], V3_SUN[0]) / (2 * Math.PI);   // 天空图横坐标的偏移：太阳在图里的位置（u = 0.595）对准太阳方向
const v3Bg = () => v3Mx() ? [.004, .02, .011] : V3_HZ_COL;   // 雾色 / 背景色
// 太阳阴影（写实画面）：镜头注视点周围一块（几百米到一千多米见方）从太阳方向渲染成深度图；各着色器的顶点里算 vSh = uShM × 世界坐标，
//   片元里比较深度（4 点柔化），只压暗日光那一项（天光照旧）；阴影范围边上渐变消失。需要深度纹理扩展与片元高精度浮点，老设备没有就不画
const V3_SHV = `uniform mat4 uShM; varying vec4 vSh;`;
const V3_SHF = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
varying highp vec4 vSh; uniform highp sampler2D uShT;
#else
varying vec4 vSh; uniform sampler2D uShT;
#endif
uniform float uShOn; uniform vec2 uShP;
float shadowAt() {
#ifdef GL_FRAGMENT_PRECISION_HIGH
  if (uShOn < .5) return 1.;
  highp vec3 q = vSh.xyz / vSh.w * .5 + .5;
  vec2 e = abs(q.xy - .5);
  float edge = smoothstep(.5, .4, max(e.x, e.y));
  if (edge <= 0. || q.z >= 1.) return 1.;
  float s = 0.;
  for (int i = 0; i < 4; i++) {
    vec2 o = i == 0 ? vec2(-.7, -.3) : i == 1 ? vec2(.3, -.7) : i == 2 ? vec2(.7, .3) : vec2(-.3, .7);
    highp float d = texture2D(uShT, q.xy + o * uShP.x).r;
    s += step(q.z - uShP.y, d);
  }
  return mix(1., s * .25, edge);
#else
  return 1.;
#endif
}`;

const V3_VS = `attribute vec3 p; attribute vec3 n;
uniform mat4 uM; uniform vec3 uEye, uOff; uniform float uScl;
varying vec3 vP, vN, vV; varying float vD;
${V3_SHV}
void main() { vec3 q = p * uScl + uOff; vP = q; vN = n; vV = uEye - q; vD = length(vV); vSh = uShM * vec4(q, 1.); gl_Position = uM * vec4(q, 1.); }`;   // uScl / uOff：地形网格是 1 / 0；无边海面按镜头平移、按能见距离缩放
// 片元着色器精度：支持就用 highp（世界坐标上千米，mediump 在手机上只有约 8 米的精度，网格线、字符会成块抖动）
const V3_PREC = '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n';
// 黑客帝国式数码风（黑绿画面）：地形网格的每个面都画出发光的网格线（粗糙的多边形地形反而像数字模型）、按等高线分层的明暗台阶，
//   地面上一列列下落的点阵字符流（「数字雨」，向海的方向流下去、字形不断变换、头部最亮、拖着渐暗的尾巴），海面是暗色的字符雨与扫描线，
//   沙盘围边与房屋墙面上字符竖着往下落；字小到看不清时只留亮度带，不闪烁
const V3_MX = `
float mxH(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
// 一格里的点阵字形（5 × 7 个圆点，按格子与时间换字）；px：一格在屏幕上有几个像素，太小就只给平均亮度
float mxGlyph(vec2 cell, vec2 f, float t, float px) {
  float id = mod(floor(t * (.6 + mxH(cell) * 2.2)), 61.);
  vec2 g = floor(f * vec2(5., 7.)), q = fract(f * vec2(5., 7.)) - .5;
  float on = step(.48, mxH(cell * 1.7 + g * 13.1 + id * 7.3));
  float m = step(.08, f.x) * step(f.x, .92) * step(.06, f.y) * step(f.y, .94);
  float dd = on * m * (1. - smoothstep(.22, .48, length(q)));
  return mix(.26, dd, smoothstep(5., 12., px));
}
// 字符雨：沿 v 方向流动的一列列字符（cell 格子号，f 格内坐标）；返回亮度（头部 > 1）
float mxRain(vec2 cell, vec2 f, float t, float px) {
  float col = cell.x, sp = 4. + mxH(vec2(col, 1.)) * 9., len = 12. + mxH(vec2(col, 2.)) * 30.;
  float d = mod(t * sp + mxH(vec2(col, 3.)) * 140. - cell.y, 90.);
  float tr = (d < len ? 1. - d / len : 0.) * step(.15, mxH(vec2(col, 4.)));
  float hd = 1. - smoothstep(0., 1.2, d);
  return mxGlyph(cell, f, t, px) * (tr * tr * .9 + hd * 1.6);
}`;
// 数码风地面（黑绿画面的 3D）：不再披平面地图的底图（树林、田块那些写实纹理），地面全由地形数据在着色器里画成数字模型——
//   底色近黑、按高度台阶分层（网格面量化，台阶边是直角折线，不画平滑的等高线曲线）、山坡是一块块平面（低多边形）；坦克上不去的高山加斜向扫描线；
//   地形多边形的网格线与交点；树林是成片缓慢闪变的点阵字符，边缘一道亮线；城镇是细方格；
//   田地是稀疏的数据点阵；沼泽横向虚线；沙滩细密点、礁石稀疏亮点；道路是带亮边的通道，中线上一段段「数据包」沿路流动；
//   河流是暗色水道、两岸亮线，水道里的字符顺流而下；海岸线一道亮光；没看见的地方压暗（战争迷雾）；字符雨照常落下。
//   单位、标号、箭头、弹坑等仍来自俯视贴图（这时贴图底色是黑的，叠加上去）
const V3_FS = der => `${der ? '#extension GL_OES_standard_derivatives : enable\n#define DER 1\n' : ''}${V3_PREC}
uniform sampler2D uTop, uBase, uCls, uCls2, uFogT, uHt, uLf, uTopF; uniform vec4 uBox, uBoxF; uniform vec2 uWorld, uGrid, uHG; uniform vec2 uFog; uniform float uSea, uT, uMx, uLmOn; uniform vec3 uBg;
uniform sampler2D uDg, uDf, uDr, uDs; uniform float uDet;   // 写实地表细节贴图（ambientCG，CC0）：草地、林下地面、岩石、沙滩
uniform sampler2D uCls3, uSky, uWn; uniform float uSkyOn, uSkyU, uWnOn;   // 水深分类（浅滩、礁石、近岸）、天空图（海面反射）、水面法线贴图（three.js 示例，MIT）
uniform float uRing, uOcn; uniform vec4 uRect;   // 地图外：1 = 无边海面（地图里面丢掉，那里是地形网格），2 = 北面延伸的陆地（贴图照地图北缘镜像）
varying vec3 vP, vN, vV; varying float vD;
${V3_SHF}
#ifdef GL_FRAGMENT_PRECISION_HIGH
#define HP highp
#else
#define HP mediump
#endif
${typeof V3L_BOOM_GLSL === 'string' ? V3L_BOOM_GLSL : 'vec3 boomLight(vec2 w) { return vec3(0.); }'}
${V3_MX}
#ifdef DER
#define FW(x) fwidth(x)
#else
#define FW(x) .03
#endif
// 地物通道的走向：沿掩码梯度的垂直方向（世界坐标）
vec2 mxTan(sampler2D T, vec2 cu, vec2 e, int ch) {
  vec4 a = texture2D(T, cu + vec2(e.x, 0.)), b = texture2D(T, cu - vec2(e.x, 0.)), c = texture2D(T, cu + vec2(0., e.y)), d = texture2D(T, cu - vec2(0., e.y));
  vec2 g = ch == 0 ? vec2(a.r - b.r, c.r - d.r) : vec2(a.b - b.b, c.b - d.b);
  return normalize(vec2(-g.y, g.x) + vec2(1e-4, 0.));
}
// 海面波浪的斜率：十组方向围绕风向（西南风）散开、波长 60 米到 2 米的波叠加（波矢取 2000 米周期的整数倍，取模后无缝）；
//   fw：一个像素在海面上有几米——比两个像素还短的波去掉（远处不闪、不出摩尔纹）；振幅再按低频噪声起伏，看不出重复；需要高精度浮点，没有就只留平静的水面
float wNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); float a = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5453), b = fract(sin(dot(i + vec2(1., 0.), vec2(127.1, 311.7))) * 43758.5453), c = fract(sin(dot(i + vec2(0., 1.), vec2(127.1, 311.7))) * 43758.5453), d = fract(sin(dot(i + vec2(1., 1.), vec2(127.1, 311.7))) * 43758.5453); return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }
// 水面法线：同一张法线贴图按四种尺度、四个方向流动叠加（大的慢、小的快）；
//   每层按一个像素在海面上有几米（fw）淡出成平的：这层的浪纹（约一圈的 1/40）比像素还细时，多级渐远纹理平均剩下的零碎起伏
//   会让每个像素反射的天空、太阳各跳各的，远看是一层颗粒噪点——细浪先退，远处只剩大浪，再远是平静的镜面
vec3 wnL(vec2 uv, float L, float fw) { return mix(vec3(0., 0., 1.), texture2D(uWn, uv).rgb * 2. - 1., 1. - smoothstep(L / 90., L / 30., fw)); }   // 比原来早一倍淡出：苹果显卡上中远处还是一层颗粒
vec3 waterNrm(HP vec2 w, float t, float fw) {
  vec3 n = wnL(w / 113. + vec2(t * .012, t * .008), 113., fw) + wnL(w / 67. + vec2(-t * .01, t * .014), 67., fw)
         + wnL(w / 29. + vec2(t * .021, -t * .016), 29., fw) + wnL(w / 13. + vec2(-t * .033, -t * .026), 13., fw);
  n *= .25;   // 四层的平均
  return vec3(n.x, -n.y, n.z * 2.2 + 1.);   // 贴图 v 朝南（w.y），GL 的 y 朝北
}
vec2 waveSlope(HP vec2 w, float t, float fw) {
  vec2 g = vec2(0.);
#ifdef GL_FRAGMENT_PRECISION_HIGH
  HP vec2 m = mod(w, 2000.);
  float mod1 = .55 + .9 * wNoise(m / 170.), mod2 = .5 + 1. * wNoise(m / 47. + 7.3);
  for (int i = 0; i < 10; i++) {
    vec2 K = i == 0 ? vec2(23., 21.) : i == 1 ? vec2(37., 12.) : i == 2 ? vec2(18., 47.) : i == 3 ? vec2(71., 40.) : i == 4 ? vec2(52., 96.) : i == 5 ? vec2(140., 61.) : i == 6 ? vec2(97., 188.) : i == 7 ? vec2(270., 151.) : i == 8 ? vec2(203., 402.) : vec2(560., 310.);
    float k = 6.2831853 * length(K) / 2000., st = i < 4 ? .035 : i < 7 ? .055 : .07;   // 陡度：长涌缓、短的碎浪陡
    float aa = 1. - smoothstep(.25, .5, fw * k / 6.2831853), om = sqrt(9.8 * k);
    HP float ph = fract(dot(K, m) / 2000. - om * t / 6.2831853) * 6.2831853;
    g += st * aa * (i < 5 ? mod1 : mod2) * normalize(K) * cos(ph);
  }
#endif
  return g;
}
void main() {
  vec2 w = vec2(vP.x, -vP.y);
  float vDp = length(vV * .01) * 100.;   // 到镜头的距离逐像素算：远海是一整块平面，顶点上的距离插值到近处全错（近处的海被当成远处、糊成雾色）；先缩小再平方，中精度不溢出
#ifdef DER
  vec2 fq = fwidth(w) * 2. + .5;
#else
  vec2 fq = vec2(.5 + vDp * .003);
#endif
  // 无边海面：地图里面由地形网格画——只丢掉离图边两个像素以上的部分。丢弃是整个像素一起丢、深度却按多重采样的子样本测，
  //   正好丢在边上的话，这个像素里图外的子样本两边都没画，露出背景，图边上一串亮点
  if (uRing > .5 && uRing < 1.5 && w.x > uRect.x + fq.x && w.y > uRect.y + fq.y && w.x < uRect.z - fq.x && w.y < uRect.w - fq.y) discard;
  if (uRing > 1.5) w.y = abs(w.y);   // 北面延伸的陆地：地形照地图北缘镜像，贴图坐标也镜像——接缝处连续
  vec3 bg = uBg;
#ifdef DER
  float pw = max(length(fwidth(w)), 1e-3);
#else
  float pw = vDp * .0015;
#endif
  if (vN.z < -.5) {   // 沙盘围边（法线朝下作标记）：地形模型切开的侧面——土层
    if (uOcn > .5) discard;   // 地图外是无边海面 / 延伸陆地时不要围边：它的顶边和海面一样高，从上往下看图边上漏出一串灰点
    vec3 c0 = mix(vec3(.2, .15, .1), vec3(.33, .26, .18), clamp(vP.z / 60. + .6, 0., 1.)) * (.6 + .4 * clamp(dot(normalize(vN.xy), vec2(-.6, .62)) * .5 + .5, 0., 1.));
    if (uMx > .5) { vec2 u = vec2(vP.x + vP.y, -vP.z) / vec2(9., 12.); c0 = c0 * .45 + vec3(.15, .95, .45) * mxRain(floor(u), fract(u), uT, 9. / pw) * .6; }
    gl_FragColor = vec4(mix(c0, bg, smoothstep(uFog.x, uFog.y, vDp)), 1.); return;
  }
  // 俯视贴图：近处一张高清（uTop / uBox），远到地平线一张低清（uTopF / uBoxF，隔几帧更新），再远是底图
  vec2 uv = (w - uBox.xy) / uBox.zw, uvF = (w - uBoxF.xy) / uBoxF.zw;
  bool inBox = uv.x > 0. && uv.y > 0. && uv.x < 1. && uv.y < 1., inF = uvF.x > 0. && uvF.y > 0. && uvF.x < 1. && uvF.y < 1.;
  float wN = inBox ? smoothstep(0., .07, min(min(uv.x, uv.y), min(1. - uv.x, 1. - uv.y))) : 0.;   // 近处贴图的边上渐变到远处那张，看不出一圈分界
  vec3 N = normalize(vN);
  float lit = clamp(dot(N, ${V3_SUNG}), 0., 1.);
  float h = vP.z, land = step(uSea, h);
  vec3 c;
  // 等高线与方格网（两种画风共用）
  float fw = max(FW(h / 14.), .001), fg = max(FW(w.x / 200.), FW(w.y / 200.)), fm = max(FW(w.x / 20.), FW(w.y / 20.));
  float t14 = h / 14., e = .5 - abs(fract(t14) - .5), major = 1. - step(.5, mod(floor(t14 + .5), 5.));
  float cl = (1. - smoothstep(0., fw * (1.2 + major), e)) * land * (.35 + .4 * major);
  vec2 g2 = abs(fract(w / 200.) - .5);
  float gl = (1. - smoothstep(0., fg * 1.5, .5 - max(g2.x, g2.y))) * .16;
  if (uMx < .5) {   // 写实 / 关闭数码风：披俯视贴图，叠山体明暗、等高线、方格网
    vec3 cF = inF ? texture2D(uTopF, uvF).rgb : texture2D(uBase, w / uWorld).rgb, top = wN > 0. ? mix(cF, texture2D(uTop, uv).rgb, wN) : cF;
    // 写实：天光（上冷下暖，按坡面朝天的程度）+ 日光；地图底色偏暗，整体提亮到白天的亮度；等高线、方格网淡一些
    vec3 amb = mix(vec3(.3, .29, .27), vec3(.47, .52, .6), clamp(N.z, 0., 1.)), col = top * 1.22;
    if (uDet > .5 && land > .5) {
      // 自然地表换成真实贴图：按地形类别（林地、礁石 / 悬崖、沙滩、沼泽）和坡度（陡坡露岩）混合；两种尺度叠加避免一张贴图重复的痕迹
      vec2 cu = w / uWorld;
      vec4 k1 = texture2D(uCls, cu), k2 = texture2D(uCls2, cu), LF = texture2D(uLf, cu), HT = texture2D(uHt, (floor(w / 20.) + .5) / uHG);
      float fo = smoothstep(.25, .7, k1.g), be = smoothstep(.3, .7, k2.g), rk = max(max(smoothstep(.25, .6, k2.b), HT.g * .8), smoothstep(.8, .55, N.z)), mr = smoothstep(.3, .7, k2.r);
      float fd = smoothstep(.3, .7, k2.a), tw = smoothstep(.3, .7, k1.a);
      vec3 G = texture2D(uDg, w / 9.).rgb, F = texture2D(uDf, w / 8.).rgb, Rk = texture2D(uDr, w / 15.).rgb, Sd = texture2D(uDs, w / 7.).rgb;
      float mac = dot(texture2D(uDg, w / 73. + .31).rgb, vec3(.6, .3, .1)) * 1.7 + .38;   // 大尺度的明暗起伏
      vec3 nat = mix(G, F * vec3(.9, .92, .8), max(fo, mr * .6));
      nat = mix(nat, Rk, rk); nat = mix(nat, Sd * 1.05, be);
      nat *= mix(1., mac, .5);
      // 人造的（道路、城镇、田块颜色）和弹坑、车辙、标号仍在俯视贴图里：道路、城镇、河流全用贴图，田地留七成，别处留三成
      float dR = LF.r * 12., hwR = max(LF.b * 8., 1.5), road = 1. - smoothstep(hwR - .5, hwR + 1.8, dR), riv = 1. - smoothstep(.9, 1.2, LF.g * 2.5);
      float keep = max(max(tw, road), max(riv, .3 + .4 * fd));
      col = mix(nat * 1.1, col, keep);
    }
    if (uRing > 1.5) col = mix(col, vec3(.6, .56, .45), (1. - smoothstep(1.5, 7., h)) * .75);   // 延伸陆地新收出来的北岸：一圈沙滩、礁石色
    c = col * (amb + vec3(1., .95, .86) * lit * .8 * shadowAt());
    c += boomLight(w) * (.35 + .65 * lit);   // 近处爆炸的火光照亮地面（v3light.js）
    c += vec3(.12, .62, .32) * (cl + gl) * .55 * land;
    if (h < uSea + .6) {   // 海面：波浪法线、天空反射（菲涅尔）、太阳反光、深浅水颜色（浅滩、礁石泛青绿）、近岸白浪；俯视贴图里的航迹等留一点
      // 离地图边 400 米内慢慢变成纯深海（不再混图里的浅滩分类和俯视贴图）：图外的无边海面就是纯深海，边上接得上；
      //   图外原来按图边那一圈的贴图着色，北边那一圈是陆地和浅滩，拉长成一条条青绿色的光带伸到天边
      float ek = uRing > .5 ? 0. : smoothstep(0., 400., min(min(w.x, uWorld.x - w.x), min(w.y, uWorld.y - w.y)));
      vec4 k3 = texture2D(uCls3, w / uWorld) * ek;
#ifdef DER
      float fwm = max(FW(w.x), FW(w.y)) * 1.4;   // 一个像素在海面上有几米
#else
      float fwm = vDp * .002;
#endif
      vec3 Nw = uWnOn > .5 ? waterNrm(w, uT, fwm) : vec3(waveSlope(w, uT, fwm) * vec2(-1., 1.), 1.);   // 斜率按 w（y 朝南）算的，法线换到 GL 坐标（y 朝北，与视线 vV 一致）
      Nw = normalize(vec3(Nw.xy * (1. - k3.r * .45), Nw.z));   // 浅水、礁盘上浪小
      vec3 V = normalize(vV), Rf = reflect(-V, Nw);
      Rf.z = abs(Rf.z);
      float bl = clamp(log2(max(fwm, .1) * 4.), 0., 6.);   // 远处的反射模糊一些（粗糙的海面平均了很多方向）
      float su = atan(Rf.y, Rf.x) / 6.2831853 + uSkyU;
#ifdef DER
      float sa = fract(su), sb = fract(su + .5) - .5; su = fwidth(sa) < fwidth(sb) ? sa : sb;   // 方位角在 ±180° 处跳一整圈：取导数小的那种写法，接缝上不会掉到最糊的一级（一条竖线）
#endif
      vec3 sk = uSkyOn > .5 ? texture2D(uSky, vec2(su, .5 - asin(clamp(Rf.z, 0., 1.)) / 3.1415927), bl).rgb * .84 : mix(uBg, vec3(.5, .62, .8), sqrt(Rf.z));
      float fr = .02 + .98 * pow(1. - clamp(dot(Nw, V), 0., 1.), 5.);
      vec3 body = mix(vec3(.04, .15, .25), vec3(.05, .28, .3), k3.r);   // 深海是深蓝（原来近乎纯黑：一千米高往远处看七成是这个颜色，整片海像一块黑板，亮点落在上面格外扎眼）
      body = mix(body, vec3(.1, .4, .38), k3.g * .6);
      float shw = shadowAt();   // 舰船、码头在海面上的影子
      body *= (.55 + .45 * clamp(dot(Nw, ${V3_SUNG}), 0., 1.)) * (.6 + .4 * shw);
      // 太阳反光：相邻像素的法线差得越多，光斑放得越宽、亮度按面积摊薄（总的反光不变）——不然只有零星像素恰好对上太阳，一闪一闪成白点
#ifdef DER
      vec3 dnx = dFdx(Nw), dny = dFdy(Nw);
      float vn = min(max(dot(dnx, dnx), dot(dny, dny)) * 4., .2);
#else
      float vn = 0.;
#endif
      float sp = max(dot(Rf, ${V3_SUNG}), 0.), e1 = 2. / (2. / 420. + vn) - 2., e2 = 2. / (2. / 62. + vn) - 2.;   // 碎光的瓣宽一些、亮度低三成：一动起来满屏白点在闪，像噪点
      float gs = pow(sp, e1) * 3.5 * (e1 + 2.) / 420. + pow(sp, e2) * .12 * (e2 + 2.) / 62.;
      gs = gs * 1.4 / (1. + gs);   // 亮处柔和地压住：成片的反光不再是一刀切的纯白斑块
      vec3 wat = mix(body, sk * (.75 + .25 * shw), fr) + vec3(1., .96, .88) * gs * shw;
      float fo = k3.b * (.55 + .45 * sin(w.x * .21 + w.y * .17 - uT * 1.3)) * smoothstep(.2, .8, k3.b);   // 近岸白浪：一条条随时间起伏
      wat = mix(wat, vec3(.86, .9, .92), fo * .55);
      wat = mix(wat, top * 1.2, .14 * ek);   // 航迹、标号等
      c = mix(wat, c, smoothstep(uSea - .4, uSea + .5, h));
    }
    gl_FragColor = vec4(mix(c, bg, smoothstep(uFog.x, uFog.y, vDp)), 1.); return;
  }
  vec2 cu = w / uWorld, ex = 1. / uGrid;
  vec4 k1 = texture2D(uCls, cu), k2 = texture2D(uCls2, cu);
  float vis = texture2D(uFogT, cu).r, hn = clamp(h / 150., 0., 1.);
  vec3 G = vec3(.14, .9, .46);   // 荧光绿
  // 山体明暗：每个三角面一个平面法线（低多边形的数字模型，山坡是一块块平面，不是平滑曲面），明暗再量化成五档
#ifdef DER
  vec3 Nf = normalize(cross(dFdx(vP), dFdy(vP)));
  if (Nf.z < 0.) Nf = -Nf;
  float litF = clamp(dot(Nf, ${V3_SUNG}), 0., 1.);
#else
  float litF = lit;
#endif
  litF = mix(lit, litF, .45);   // 平滑的山体受光为主，掺一点平面多边形的块面感（原来量化成五档，像色块）
  // 数码高程（取代平滑的等高线曲线）：每个 20 × 20 的网格面按平均高度量化成一级台阶（uHt：R 级数 / 16，G 坦克上不去的高山，B 水面），
  //   越高越亮；级数变化处沿网格边画直角折线（数码等高线）；远看折线细到看不清时淡出，只留台阶的明暗
  vec2 hc = w / 20., hi = floor(hc), hq = fract(hc);
  vec4 HT = texture2D(uHt, (hi + .5) / uHG);
  float Lx = texture2D(uHt, (hi + vec2(hq.x < .5 ? -1. : 1., 0.) + .5) / uHG).r, Ly = texture2D(uHt, (hi + vec2(0., hq.y < .5 ? -1. : 1.) + .5) / uHG).r;
  float lw = fm * 1.7, far2 = 1. - smoothstep(.12, .45, fm);
  float stp = max(step(.01, abs(Lx - HT.r)) * (1. - smoothstep(0., lw, .5 - abs(hq.x - .5))), step(.01, abs(Ly - HT.r)) * (1. - smoothstep(0., lw, .5 - abs(hq.y - .5))));
  // 底色：近黑，陆地按高度台阶提亮
  c = mix(vec3(.005, .028, .034), vec3(.026, .1, .06) + vec3(.035, .13, .07) * hn + vec3(.025, .12, .06) * HT.r, land) * (.28 + 1.6 * litF);   // 灯下的沙盘：迎光面亮、背光面暗，明暗拉得开（底色够亮，影子才看得出）
  c += G * (stp * (.13 + .3 * HT.r) * far2 * land + gl * .7);
  // 坦克上不去的高山：斜向扫描线（远看成一层淡淡的亮度）
  float hz = step(.86, fract((w.x - w.y) / 9.));
  c += G * HT.g * land * mix(hz * .16, .025, smoothstep(.1, .35, FW((w.x - w.y) / 9.)));
  // 地形网格线（多边形的边）与交点
  vec2 m = abs(fract(w / 20.) - .5);
  float far = 1. - smoothstep(.06, .25, fm);
  c += G * ((1. - smoothstep(0., fm * 1.4, .5 - max(m.x, m.y))) * (.05 + .07 * land) + (1. - smoothstep(0., fm * 2.2, length(m - .5))) * .3) * far;
  // 海岸线：一道细亮线（按屏幕像素的宽度）
  c += G * (1. - smoothstep(0., max(FW(h), .05) * 1.6, abs(h - uSea))) * .6;
  // 田地：稀疏数据点阵
  float fd = smoothstep(.3, .7, k2.a);
  vec2 d10 = fract(w / 10.) - .5;
  c += G * fd * (1. - smoothstep(.06, .12, length(d10))) * .16 * far;
  // 城镇：细方格
  float tw = smoothstep(.3, .7, k1.a), f8 = FW(w.x / 8.);
  vec2 d8 = abs(fract(w / 8.) - .5);
  c += G * tw * mix(1. - smoothstep(0., f8 * 1.5, .5 - max(d8.x, d8.y)), .22, smoothstep(.15, .45, f8)) * .16;   // 远看细方格挤成一片时取平均亮度（不再糊成亮块）
  // 沼泽：错开的横向虚线
  float mr = smoothstep(.3, .7, k2.r);
  c += G * mr * step(.84, fract(w.y / 5.)) * step(.45, fract(w.x / 9. + floor(w.y / 5.) * .37)) * .3;
  // 沙滩细密点、礁石 / 悬崖稀疏亮点
  float bc = smoothstep(.3, .7, k2.g), rk = smoothstep(.25, .6, k2.b);
  vec2 q3 = floor(w / 3.), f3 = fract(w / 3.) - .5;
  c += G * bc * mix(step(.55, mxH(q3)) * (1. - smoothstep(.12, .22, length(f3))), .05, smoothstep(.15, .45, FW(w.x / 3.))) * .3;   // 远看点挤成一片时取平均亮度，不闪
  vec2 q6 = floor(w / 6.), f6 = fract(w / 6.) - .5;
  c += G * rk * mix(step(.7, mxH(q6 + 3.1)) * (1. - smoothstep(.15, .3, length(f6))), .045, smoothstep(.15, .45, FW(w.x / 6.))) * .55;
  // 树林：成片缓慢闪变的点阵字符，边缘一道亮线
  float fo = smoothstep(.3, .7, k1.g);
  if (k1.g > .05) {
    vec2 g6 = w / 6.5;
    float gg = mxGlyph(floor(g6), fract(g6), uT * .3, 6.5 / pw);
    c += G * (.025 + (gg - .26 * (1. - smoothstep(5., 12., 6.5 / pw)) * .55) * .2) * fo;   // 暗暗的一片，字点微亮（远看不糊成亮块）
    c += G * (1. - smoothstep(0., max(FW(k1.g), .004) * 1.6, abs(k1.g - .5))) * .16;   // 导数取下限：掩码平在 0.5 附近的小片林地不会整片发亮
  }
  // 河流、道路按中心线距离场画（uLf：R 到路中心 / 12 米、G 到河中心 / 半宽 / 2.5、B 路半宽 / 8；4 倍网格精度，边是光滑的曲线）
  vec4 LF = texture2D(uLf, cu);
  vec2 el = ex / 4.;
  // 河流：暗色水道、两岸亮线，水道里的字符顺流而下
  float rq = LF.g * 2.5;
  if (rq < 1.6) {
    float band = 1. - smoothstep(.92, 1.04, rq);
    vec2 gr = vec2(texture2D(uLf, cu + vec2(el.x, 0.)).g - texture2D(uLf, cu - vec2(el.x, 0.)).g, texture2D(uLf, cu + vec2(0., el.y)).g - texture2D(uLf, cu - vec2(0., el.y)).g);
    vec2 tg = normalize(vec2(-gr.y, gr.x) + vec2(0., 1e-4)); if (tg.y < 0.) tg = -tg;   // 顺流（向海，y 增大）
    vec2 nr = vec2(tg.y, -tg.x);
    c = mix(c, vec3(.0, .022, .028), band * .85);
    c += vec3(.15, .95, .7) * (1. - smoothstep(0., max(FW(rq), .01) * 1.5, abs(rq - 1.))) * .6;
    vec2 q = vec2(dot(w, nr) / 4.5, dot(w, tg) / 5.5 - uT * 1.6);
    c += vec3(.2, 1., .8) * mxGlyph(floor(q), fract(q), uT, 4.5 / pw) * band * .5;
  }
  // 道路：带亮边的通道，中线上一段段「数据包」沿路流动
  float dR = LF.r * 12., hwR = max(LF.b * 8., 1.5);
  if (dR < hwR + 2.) {
    float band = 1. - smoothstep(hwR - .3, hwR + .3, dR);
    vec2 gd = vec2(texture2D(uLf, cu + vec2(el.x, 0.)).r - texture2D(uLf, cu - vec2(el.x, 0.)).r, texture2D(uLf, cu + vec2(0., el.y)).r - texture2D(uLf, cu - vec2(0., el.y)).r);
    vec2 tg = normalize(vec2(-gd.y, gd.x) + vec2(1e-4, 0.));
    float sl = dot(w, tg);
    c = mix(c, vec3(.008, .05, .03), band * .75);
    c += G * (1. - smoothstep(0., max(FW(dR), .05) * 1.4, abs(dR - hwR))) * .6;
    float pk = step(.62, fract(sl / 18. - uT * .7 + mxH(floor(w / 60.)))) * (1. - smoothstep(.6, 1.2, dR));
    c += vec3(.55, 1., .75) * pk * .75;
  }
  // 字符雨：两档字格（近处 9 × 12，远看换 27 × 36），向海的方向流下去
  vec2 cu1 = w / vec2(9., 12.), cu2 = w / vec2(27., 36.);
  float r = mix(mxRain(floor(cu1), fract(cu1), uT, 9. / pw), mxRain(floor(cu2) + 500., fract(cu2), uT * .6, 27. / pw), smoothstep(7., 3.5, 9. / pw));
  c += vec3(.16, 1., .5) * r * mix(.5, .26, land) + vec3(.6, 1., .8) * max(r - 1., 0.) * .3;
  if (land < .5) c += vec3(.02, .1, .07) * (.5 + .5 * sin(w.y * .35 - uT * 3.)) * .45;   // 海面扫描线
  // 光影（v3light.js 烘焙的光照贴图）：R 投影、G 环境光遮蔽、B 近岸浅水；再按桌子上方那盏灯的远近压暗四周
  vec3 lm = uLmOn > .5 ? texture2D(uDg, cu).rgb : vec3(1., 1., 0.);   // 光照贴图借用细节贴图的采样器（同在第 9 个单元，黑绿画面不用细节贴图）：采样器总数压在 16 个以内，多数显卡只支持 16 个
  float lampR = length((w - uWorld * .5) / (uWorld * .5));
  c *= mix(.3, 1., lm.r) * mix(.45, 1., lm.g) * (.72 + .28 * (1. - smoothstep(.55, 1.5, lampR)));
  c += boomLight(w) * (.3 + .7 * lit);   // 爆炸火光照亮周围的地面
  if (land < .5) {
    // 海面：几层缓慢移动的波纹斜着反射头顶的灯（粼粼的亮点），近岸的浅水亮一些、岸边一道来回涌的浪线
    vec2 wq = w * vec2(.029, .041); float t2 = uT * .55;
    vec3 nw = normalize(vec3(sin(wq.x + t2) * .5 + sin(wq.y * 1.7 - t2 * .8) * .35 + sin((wq.x + wq.y) * 2.6 + t2 * 1.4) * .2,
                             cos(wq.y - t2 * .7) * .5 + cos(wq.x * 1.9 + t2) * .3 + cos((wq.x - wq.y) * 3.1 - t2) * .15, 5.5));
    vec3 Hs = normalize(${V3_SUNG} + normalize(vV));
    float glint = pow(max(dot(nw, Hs), 0.), 90.) * lm.r, sheen = pow(max(dot(nw, Hs), 0.), 12.) * lm.r;
    c += vec3(.55, 1., .82) * (glint * .9 + sheen * .05) * (1. - smoothstep(uFog.x * .5, uFog.y, vDp));
    c += vec3(.012, .07, .05) * lm.b * lm.b;
    c += G * smoothstep(.86, .97, lm.b) * (.5 + .5 * sin(uT * 1.3 - lm.b * 40. + w.x * .02)) * .16;
  }
  // 战争迷雾：没看见的地方压暗
  c *= mix(.42, 1., vis);
  // 单位、标号、箭头等（俯视贴图，底色是黑的）叠加上去
  vec3 oF = inF ? texture2D(uTopF, uvF).rgb : vec3(0.);
  c += wN > 0. ? mix(oF, texture2D(uTop, uv).rgb, wN) : oF;
  gl_FragColor = vec4(mix(c, bg, smoothstep(uFog.x, uFog.y, vDp)), 1.);
}`;

// 城镇房屋：挤出成立体方块——屋顶取俯视贴图（与平面画面同一张），墙面暗绿，棱线发光
const V3_BVS = `attribute vec3 p; attribute vec3 n; attribute vec2 e;
uniform mat4 uM; uniform vec3 uEye;
varying vec3 vP, vN; varying vec2 vE; varying float vD;
${V3_SHV}
void main() { vP = p; vN = n; vE = e; vD = distance(p, uEye); vSh = uShM * vec4(p, 1.); gl_Position = uM * vec4(p, 1.); }`;
const V3_BFS = () => `${V3_PREC}
uniform sampler2D uTop, uBase, uTopF, uLm; uniform vec4 uBox, uBoxF; uniform vec2 uWorld, uFog; uniform float uT, uMx, uLmOn; uniform vec3 uBg;
varying vec3 vP, vN; varying vec2 vE; varying float vD;
${V3_SHF}
${V3_MX}
${typeof V3L_BOOM_GLSL === 'string' ? V3L_BOOM_GLSL : 'vec3 boomLight(vec2 w) { return vec3(0.); }'}
void main() {
  vec2 w = vec2(vP.x, -vP.y), uv = (w - uBox.xy) / uBox.zw, uvF = (w - uBoxF.xy) / uBoxF.zw;
  bool inF = uvF.x > 0. && uvF.y > 0. && uvF.x < 1. && uvF.y < 1.;
  vec3 N = normalize(vN), bg = uBg;
  float lit = clamp(dot(N, ${V3_SUNG}), 0., 1.);
  float ed = min(min(vE.x, 1. - vE.x), min(vE.y, 1. - vE.y)), edge = 1. - smoothstep(.02, .1, ed);
  vec3 c;
  if (vE.x > 1.5) {   // 树：树冠（e.x 2.5）、树干（3.5）；不画棱线，边缘（侧面）一圈淡淡的轮廓光
    float tk = step(3., vE.x), hv = fract(sin(dot(floor(vP.xy * .25), vec2(12.9898, 78.233))) * 43758.5453), rim = smoothstep(.15, .9, 1. - abs(N.z));
    if (uMx > .5) c = mix(vec3(.004, .03, .016) * (.5 + 1.4 * lit) + vec3(.1, .7, .36) * rim * .1, vec3(.01, .02, .012), tk);
    else c = mix(mix(vec3(.05, .1, .04), vec3(.09, .15, .06), hv) * (.45 + .9 * lit) + vec3(.05, .09, .04) * rim * .3, vec3(.07, .05, .03) * (.5 + .7 * lit), tk);
  } else if (uMx > .5) {   // 数码风：楼是数字模型——深色实体、发光棱线；屋顶细方格，墙面上随机亮着的「窗格」，字符竖着往下落
    vec3 G = vec3(.14, .9, .46);
    c = vec3(.006, .035, .02) * (.6 + 1.2 * lit) + G * edge * (N.z > .5 ? .6 : .95);
    if (N.z > .5) { vec2 d = abs(fract(w / 3.) - .5); c += G * step(.42, max(d.x, d.y)) * .12; }
    else {
      vec2 u = vec2((vP.x * N.y - vP.y * N.x), -vP.z) / vec2(4., 5.), win = floor(vec2(vP.x * N.y - vP.y * N.x, vP.z) / vec2(3., 3.5)), fw = fract(vec2(vP.x * N.y - vP.y * N.x, vP.z) / vec2(3., 3.5));
      float px = 4. / max(vD * .0015, 1e-3);
      c += G * step(.78, mxH(win + floor(uT * .1) * .37)) * step(.25, fw.x) * step(fw.x, .75) * step(.3, fw.y) * step(fw.y, .7) * .35;
      c += vec3(.15, .95, .45) * mxRain(floor(u), fract(u), uT * 1.3, px) * .5;
    }
  } else {   // 写实：屋顶取俯视贴图，墙面是水泥色（受日光、天光），棱线略压暗
    vec3 amb = mix(vec3(.3, .29, .27), vec3(.47, .52, .6), N.z * .5 + .5), L = amb + vec3(1., .95, .86) * lit * .8 * shadowAt();
    c = N.z > .5 ? ((uv.x > 0. && uv.y > 0. && uv.x < 1. && uv.y < 1.) ? texture2D(uTop, uv).rgb : inF ? texture2D(uTopF, uvF).rgb : texture2D(uBase, w / uWorld).rgb) * L * 1.15
      : vec3(.6, .6, .57) * L;
    c *= 1. - edge * .3;
  }
  // 山的投影、街巷与林下的遮蔽也落在房屋、树上（v3light.js 光照贴图）；墙脚比屋顶暗一点
  vec2 lmB = uLmOn > .5 ? texture2D(uLm, w / uWorld).rg : vec2(1.);
  c *= mix(.42, 1., lmB.r) * mix(.62, 1., lmB.g);
  c += boomLight(w) * (.25 + .75 * lit);
  gl_FragColor = vec4(mix(c, bg, smoothstep(uFog.x, uFog.y, vD)), 1.);
}`;

// —— 天空（写实画面）：全屏三角形，顶点着色器把屏幕角点反投影到远裁剪面求视线方向（插值后在片元里归一），按方位角、高度角查天空图；
//   地平线以下渐变成雾色（地图外围看到的「地面」）——
const V3_SKY_VS = `attribute vec2 p; uniform mat4 uInv; uniform vec3 uEye; varying vec3 vR;
void main() { vec4 b = uInv * vec4(p, 1., 1.); vR = b.xyz / b.w - uEye; gl_Position = vec4(p, .99999, 1.); }`;
const V3_SKY_FS = `precision mediump float;
uniform sampler2D uSky; uniform float uU; uniform vec3 uBg; varying vec3 vR;
void main() {
  vec3 d = normalize(vR);
  vec2 uv = vec2(atan(d.y, d.x) / 6.2831853 + uU, .5 - asin(clamp(d.z, -1., 1.)) / 3.1415927);
  vec3 c = texture2D(uSky, uv, -16.).rgb;   // 天空图一个像素比屏幕像素大，总用最清楚的一级（方位角的接缝处导数很大，不加偏置会糊出一条竖线）
  gl_FragColor = vec4(mix(c, uBg, smoothstep(.03, -.08, d.z)), 1.);
}`;
// 地表细节贴图（写实画面）：第一次用到时载入，四张都好了才启用；绑在 8–11 号纹理单元
function v3DetTex() {
  const D = V3.det, gl = V3.gl;
  if (!D) return false;
  if (!D.req) {
    D.req = true;
    const v = typeof window === 'object' && window.DS_BUILD ? '?v=' + window.DS_BUILD : '';
    ['grass', 'forest', 'rock', 'sand'].forEach((nm, i) => {
      const img = new Image();
      img.onload = () => {
        const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE8 + i); gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img); gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
        if (V3.aniso) gl.texParameterf(gl.TEXTURE_2D, V3.aniso.TEXTURE_MAX_ANISOTROPY_EXT, V3.anMax);
        D.t[i] = t; D.n++;
      };
      img.src = 'assets/terrain/' + nm + '.jpg' + v;
    });
  }
  if (D.n < 4) return false;
  for (let i = 0; i < 4; i++) { gl.activeTexture(gl.TEXTURE8 + i); gl.bindTexture(gl.TEXTURE_2D, D.t[i]); }
  return true;
}
// 水面法线贴图（写实海面）：第一次用到时载入，绑在 14 号纹理单元
function v3WaterTex() {
  const D = V3.wn, gl = V3.gl;
  if (!D) return false;
  if (!D.req) {
    D.req = true;
    const img = new Image();
    img.onload = () => {
      const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE14); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img); gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      if (V3.aniso) gl.texParameterf(gl.TEXTURE_2D, V3.aniso.TEXTURE_MAX_ANISOTROPY_EXT, V3.anMax);
      D.t = t; D.ok = true;
    };
    img.src = 'assets/water/normals.jpg' + (typeof window === 'object' && window.DS_BUILD ? '?v=' + window.DS_BUILD : '');
  }
  if (!D.ok) return false;
  gl.activeTexture(gl.TEXTURE14); gl.bindTexture(gl.TEXTURE_2D, D.t);
  return true;
}
const V3SH = { tried: false, ok: false, size: 2048, M: null, on: false, box: null };
function v3ShInit(gl) {
  V3SH.tried = true;
  try {
    const dt = gl.getExtension('WEBGL_depth_texture') || gl.getExtension('WEBKIT_WEBGL_depth_texture'), hp = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
    if (!dt || !hp || hp.precision < 16 || gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) < 16) return;
    const S0 = V3SH.size = V3.coarse ? 1024 : 2048;
    const tex = gl.createTexture(); gl.activeTexture(gl.TEXTURE15); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT, S0, S0, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, tex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {   // 有的实现必须有颜色附件
      const rb = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, rb); gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA4, S0, S0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, rb);
    }
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!ok) return;
    // 只写深度的小着色器（地形、自己挤出的房屋）
    const sh = (type, src) => { const o = gl.createShader(type); gl.shaderSource(o, src); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
    const pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, 'attribute vec3 p; uniform mat4 uM; void main() { gl_Position = uM * vec4(p, 1.); }'));
    gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, 'precision mediump float; void main() { gl_FragColor = vec4(1.); }'));
    gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
    Object.assign(V3SH, { tex, fb, pr, a: gl.getAttribLocation(pr, 'p'), uM: gl.getUniformLocation(pr, 'uM'), ok: true });
  } catch (e) { V3SH.ok = false; console.warn('阴影不可用', e); }
}
// 光源矩阵：以注视点为中心、边长 2R 的正交投影，从太阳方向看；中心按阴影图的像素对齐（镜头移动时阴影边不闪）
function v3ShMatrix(C) {
  // 范围按镜头离地高度（贴地看时一百米左右，越高越大）；中心取画面中心的落地点，但离镜头脚下不超过范围的七成（平视时影子落在近处）
  const ex = C.E[0], ey = -C.E[1], hE = Math.max(1, C.E[2] - v3Gnd(ex, ey)), R = clamp(hE * 2.2 + 70, 90, 1100);
  let cx = CAM.x, cy = CAM.y;
  const dd = Math.hypot(cx - ex, cy - ey), lim = R * .7;
  if (dd > lim) { cx = ex + (cx - ex) * lim / dd; cy = ey + (cy - ey) * lim / dd; }
  const cz = Math.max(v3Ht(clamp(cx, 0, W - 1), clamp(cy, 0, H - 1)), -2.6), L = v3Norm(V3_SUN);
  const up0 = Math.abs(L[2]) > .95 ? [0, 1, 0] : [0, 0, 1], f = [-L[0], -L[1], -L[2]], r = v3Norm(v3Cross(f, up0)), u = v3Cross(r, f);
  const C0 = [cx, -cy, cz], tx = 2 * R / V3SH.size;
  let a = v3Dot(C0, r), b = v3Dot(C0, u);
  a = Math.round(a / tx) * tx; b = Math.round(b / tx) * tx;   // 对齐像素
  const dz = 2 * R + 1600, c0 = v3Dot(C0, f) - (R + 800);   // 深度范围：注视点前后
  // 视图：x = 点·r − a，y = 点·u − b，深度 = 点·f − c0；正交：x / R，y / R，深度 [0, dz] → [-1, 1]
  const M = new Float32Array(16);
  M[0] = r[0] / R; M[4] = r[1] / R; M[8] = r[2] / R; M[12] = -a / R;
  M[1] = u[0] / R; M[5] = u[1] / R; M[9] = u[2] / R; M[13] = -b / R;
  M[2] = f[0] * 2 / dz; M[6] = f[1] * 2 / dz; M[10] = f[2] * 2 / dz; M[14] = -c0 * 2 / dz - 1;
  M[3] = 0; M[7] = 0; M[11] = 0; M[15] = 1;
  V3SH.M = M; V3SH.bias = .5 / dz + 1.5 * tx / dz; V3SH.box = [cx - R * 1.5, cy - R * 1.5, cx + R * 1.5, cy + R * 1.5];
  return M;
}
// 这一帧画阴影吗（写实画面、设备支持）；画就先从太阳方向把会投影的东西画进深度图
function v3ShPass(C) {
  const gl = V3.gl;
  V3SH.on = false;
  if (v3Mx() || (SETTINGS && SETTINGS.quality === 'low')) return false;
  if (!V3SH.tried) v3ShInit(gl);
  if (!V3SH.ok) return false;
  const M = v3ShMatrix(C), S0 = V3SH.size;
  gl.activeTexture(gl.TEXTURE15); gl.bindTexture(gl.TEXTURE_2D, null);   // 正在写的深度图不能同时绑在采样单元上
  gl.bindFramebuffer(gl.FRAMEBUFFER, V3SH.fb);
  gl.viewport(0, 0, S0, S0);
  gl.colorMask(false, false, false, false);
  gl.clear(gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1.5, 3);
  // 地形（山体互相投影；触屏设备省掉这一遍）与自己挤出的房屋
  gl.useProgram(V3SH.pr); gl.uniformMatrix4fv(V3SH.uM, false, M);
  gl.enableVertexAttribArray(V3SH.a);
  if (!V3.coarse) {
    gl.bindBuffer(gl.ARRAY_BUFFER, V3.buf); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, V3.ib);
    gl.vertexAttribPointer(V3SH.a, 3, gl.FLOAT, false, 24, 0);
    gl.drawElements(gl.TRIANGLES, V3.n, V3.it || gl.UNSIGNED_SHORT, 0);
  }
  for (const c of V3.bch || []) {
    if (c.bb && (c.bb[2] < V3SH.box[0] || c.bb[0] > V3SH.box[2] || c.bb[3] < V3SH.box[1] || c.bb[1] > V3SH.box[3])) continue;
    gl.bindBuffer(gl.ARRAY_BUFFER, c.b); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, c.i);
    gl.vertexAttribPointer(V3SH.a, 3, gl.FLOAT, false, 32, 0);
    gl.drawElements(gl.TRIANGLES, c.n, gl.UNSIGNED_SHORT, 0);
  }
  gl.disableVertexAttribArray(V3SH.a);
  // 地图物件、兵种模型
  if (typeof v3pDraw === 'function') v3pDraw(C, M);
  if (typeof v3mDraw === 'function' && !(SETTINGS && SETTINGS.models3d === false)) v3mDraw(C, M);
  gl.disable(gl.POLYGON_OFFSET_FILL);
  gl.colorMask(true, true, true, true);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.activeTexture(gl.TEXTURE15); gl.bindTexture(gl.TEXTURE_2D, V3SH.tex);
  V3SH.on = true;
  return true;
}
// 接收阴影的着色器：设好 uniform（on = false：这一遍本身是在画阴影图，不查阴影）
function v3ShUni(gl, U, on) {
  const use = on && V3SH.on;
  if (U.uShOn) gl.uniform1f(U.uShOn, use ? 1 : 0);
  if (U.uShM) gl.uniformMatrix4fv(U.uShM, false, V3SH.M || new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]));
  if (U.uShT) gl.uniform1i(U.uShT, use ? 15 : 0);
  if (U.uShP) gl.uniform2f(U.uShP, 1 / V3SH.size, V3SH.bias || .001);
}
function v3Inv(m) {   // 4×4 求逆（列主序）
  const a = m, o = new Float32Array(16);
  const b00 = a[0] * a[5] - a[1] * a[4], b01 = a[0] * a[6] - a[2] * a[4], b02 = a[0] * a[7] - a[3] * a[4], b03 = a[1] * a[6] - a[2] * a[5], b04 = a[1] * a[7] - a[3] * a[5], b05 = a[2] * a[7] - a[3] * a[6];
  const b06 = a[8] * a[13] - a[9] * a[12], b07 = a[8] * a[14] - a[10] * a[12], b08 = a[8] * a[15] - a[11] * a[12], b09 = a[9] * a[14] - a[10] * a[13], b10 = a[9] * a[15] - a[11] * a[13], b11 = a[10] * a[15] - a[11] * a[14];
  let d = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!d) return null;
  d = 1 / d;
  o[0] = (a[5] * b11 - a[6] * b10 + a[7] * b09) * d; o[1] = (a[2] * b10 - a[1] * b11 - a[3] * b09) * d; o[2] = (a[13] * b05 - a[14] * b04 + a[15] * b03) * d; o[3] = (a[10] * b04 - a[9] * b05 - a[11] * b03) * d;
  o[4] = (a[6] * b08 - a[4] * b11 - a[7] * b07) * d; o[5] = (a[0] * b11 - a[2] * b08 + a[3] * b07) * d; o[6] = (a[14] * b02 - a[12] * b05 - a[15] * b01) * d; o[7] = (a[8] * b05 - a[10] * b02 + a[11] * b01) * d;
  o[8] = (a[4] * b10 - a[5] * b08 + a[7] * b06) * d; o[9] = (a[1] * b08 - a[0] * b10 - a[3] * b06) * d; o[10] = (a[12] * b04 - a[13] * b02 + a[15] * b00) * d; o[11] = (a[9] * b02 - a[8] * b04 - a[11] * b00) * d;
  o[12] = (a[5] * b07 - a[4] * b09 - a[6] * b06) * d; o[13] = (a[0] * b09 - a[1] * b07 + a[2] * b06) * d; o[14] = (a[13] * b01 - a[12] * b03 - a[14] * b00) * d; o[15] = (a[8] * b03 - a[9] * b01 + a[10] * b00) * d;
  return o;
}
function v3Sky(C) {
  const gl = V3.gl;
  if (!V3.sky) {
    V3.sky = { ok: false };
    try {
      const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
      const pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, V3_SKY_VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, V3_SKY_FS)); gl.linkProgram(pr);
      if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
      const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      Object.assign(V3.sky, { pr, b, a: gl.getAttribLocation(pr, 'p'), u: Object.fromEntries(['uInv', 'uEye', 'uSky', 'uU', 'uBg'].map(k => [k, gl.getUniformLocation(pr, k)])) });
      const img = new Image();
      img.onload = () => {
        const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img); gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        V3.sky.tex = t; V3.sky.ok = true;
      };
      img.src = 'assets/sky/sky.jpg' + (typeof window === 'object' && window.DS_BUILD ? '?v=' + window.DS_BUILD : '');
    } catch (e) { console.warn('天空不可用', e); }
  }
  const K = V3.sky, inv = K.ok && v3Inv(C.M);
  if (!inv) return;
  gl.useProgram(K.pr);
  gl.uniformMatrix4fv(K.u.uInv, false, inv); gl.uniform3f(K.u.uEye, C.E[0], C.E[1], C.E[2]);
  gl.uniform1f(K.u.uU, V3_SKYU); gl.uniform1i(K.u.uSky, 6); gl.uniform3f(K.u.uBg, ...V3_HZ_COL);
  gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, K.tex);
  gl.depthMask(false); gl.disable(gl.DEPTH_TEST);
  gl.bindBuffer(gl.ARRAY_BUFFER, K.b); gl.enableVertexAttribArray(K.a); gl.vertexAttribPointer(K.a, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.disableVertexAttribArray(K.a);
  gl.depthMask(true); gl.enable(gl.DEPTH_TEST);
  gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, V3.lf);   // 6 号单元原本是道路、河流的距离场
}

// —— 3D 数学（列主序 4×4）——
const v3Sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const v3Dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const v3Cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const v3Norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
function v3Mul(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; }
  return o;
}

// 高度场：每 V3_ST 格一个顶点，取四周格子的平均（海面略低于 0）
function v3H0(gx, gy) {
  gx = clamp(gx, 0, GW - 1); gy = clamp(gy, 0, GH - 1);
  const i = gy * GW + gx;
  return isWater(TER.type[i]) ? -3 : TER.elev[i] * V3_HZ + 2;
}
// 世界坐标 (x, y) 处的地面高度（双线性插值）
// 飞机在 3D 里的绝对高度（模型、标识、机上射出的弹共用）：舰载机在甲板上（弹射、滑跑、拦阻）贴着飞行甲板，海上起降以甲板为基准；
//   高度 alt 0.05 以下贴着基准面（地面 / 甲板），往上每 1.0 为 V3_AIR（约 350，直升机悬停 0.3 约离地 90）——见 v3AltZ：高空按海拔平飞，不随山起伏
const V3_DECK = -2.6 + 17 + 1.5;   // 舰载机在飞行甲板上的高度：甲板离水线 17（carrier.js CVG.zd）+ 放下起落架的机身高度
function v3AirZ(o) {
  if (o.fl && o.fp) return -o.fl.P[2];   // 玩家亲自开（v3pilot.js 飞控物理引擎）：真实高度，不受游戏里高度档的上限（筋斗能翻到一千多米）
  const ph = o.phase || o.ph;
  if (o.kind && (ph === 'cat' || ph === 'roll' || ph === 'trap')) return V3_DECK;
  const z = v3AltZ(o.x, o.y, Math.max(0, clamp(o.alt ?? 1, 0, 1) - .05) * V3_AIR, o.kind && !o.land && !o.afPh ? V3_DECK - 1.5 : -2.6, 1.5);
  return o.kind && o.lT != null ? v3ClimbZ(o, z) : z;
}
// 刚弹射离舰的舰载机（cvdeck.js 记的离舰时刻 lT）：推演里 2 秒就升到巡航高度，照着画像坐电梯直上——
//   画面按 JSBSim 算的离舰时间历程（js/aero.js：先下沉约 3 米，再抬头加速爬升，14 秒约 220 米），之后按末了的爬升率继续；
//   赶上推演的高度时平滑改平；推演更低时（俯冲、低空突防）照推演
function v3ClimbZ(o, zs) {
  const u = S.t - o.lT;
  if (!(u >= 0 && u < 40) || typeof AERO !== 'object') return zs;
  const R = AERO.launch.rows, n = R.length - 1, f = u / AERO.launch.dt, i = Math.min(n - 1, Math.floor(f));
  const h = f < n ? lerp(R[i][0], R[i + 1][0], f - i) : R[n][0] + (u - n * AERO.launch.dt) * (R[n][0] - R[n - 10][0]) / (10 * AERO.launch.dt);
  const zp = V3_DECK + h, d = zs - zp;
  return d <= 0 ? zs : zs - d * Math.max(sm01(d / 60), 1 - sm01((u - 2) / 2));   // 头 2 秒完全照数据（含下沉），之后只在快赶上时圆滑过渡
}
// 离地高度 h → 绝对高度：贴地时按脚下实际地面（lo 是海上的最低基准：舰载机 = 飞行甲板，其余 = 海面），一离地参考面就换成平滑的地形包络
//   （v3Env，不跟着每个小山包上下抖），越高越接近海拔基准——巡航高度（约 V3_AIR）完全按海拔平飞；低空过山时沿包络平缓爬升、越过山脊再下来
const sm01 = v => { v = clamp(v, 0, 1); return v * v * (3 - 2 * v); };
function v3AltZ(x, y, h, lo, lift) {
  const g = Math.max(v3Ht(x, y), lo);
  if (!(h > 0)) return g + lift;
  const F = Math.max(v3Env(x, y), g), gr = lerp(g, F, sm01(h / 20));
  return Math.max(h + lift + lerp(gr, lo, sm01(h / (V3_AIR * .96))), g + lift + Math.min(h, 6));
}
// 地形包络：每 40 一个点，取 140 以内的最高地面，再在 80 内取平均——比实际地形略宽、略高，处处平缓
const V3_ENV = 40;
function v3EnvBuild() {
  const nx = Math.ceil(W / V3_ENV) + 1, ny = Math.ceil(H / V3_ENV) + 1, A = new Float32Array(nx * ny), B = new Float32Array(nx * ny);
  const hf = V3.hf, hn = V3.nx, hm = V3.ny, sp = CELL * V3_ST, r = Math.ceil(140 / sp);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const ci = Math.round(i * V3_ENV / sp), cj = Math.round(j * V3_ENV / sp);
    let m = -3;
    for (let b = Math.max(0, cj - r); b <= Math.min(hm - 1, cj + r); b++) for (let a = Math.max(0, ci - r); a <= Math.min(hn - 1, ci + r); a++) if ((a - ci) ** 2 + (b - cj) ** 2 <= r * r && hf[b * hn + a] > m) m = hf[b * hn + a];
    A[j * nx + i] = m;
  }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    let s = 0, n = 0;
    for (let b = j - 2; b <= j + 2; b++) for (let a = i - 2; a <= i + 2; a++) if (a >= 0 && b >= 0 && a < nx && b < ny && (a - i) ** 2 + (b - j) ** 2 <= 4) { s += A[b * nx + a]; n++; }
    B[j * nx + i] = s / n;
  }
  V3.env = B; V3.enx = nx; V3.eny = ny;
}
function v3Env(x, y) {
  if (!V3.env) return v3Ht(x, y);
  const fx = clamp(x / V3_ENV, 0, V3.enx - 1.001), fy = clamp(y / V3_ENV, 0, V3.eny - 1.001), i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j, E = V3.env, n = V3.enx;
  return lerp(lerp(E[j * n + i], E[j * n + i + 1], u), lerp(E[(j + 1) * n + i], E[(j + 1) * n + i + 1], u), v);
}
function v3Ht(x, y) {
  if (!V3.hf) return 0;
  const fx = clamp(x / (CELL * V3_ST), 0, V3.nx - 1.001), fy = clamp(y / (CELL * V3_ST), 0, V3.ny - 1.001), i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j, H = V3.hf, n = V3.nx;
  return lerp(lerp(H[j * n + i], H[j * n + i + 1], u), lerp(H[(j + 1) * n + i], H[(j + 1) * n + i + 1], u), v);
}
// 网格：地形 + 四边围边（沙盘侧壁，法线 z = -1 作标记）；桥被炸 / 地形变了按签名重建
function v3Mesh() {
  // 每格一个顶点要 32 位索引；细网格的部分（大海域地图只到寻路带）超过 30 万格时每 2 格一个（默认大地图 8400 × 5600 近百万个三角形，手机画不动）
  V3_ST = V3.u32 && GW * Math.min(GH, TER.pathY ? Math.ceil(TER.pathY / CELL) + 20 : GH) <= 300000 ? 1 : 2;
  const gl = V3.gl, st = V3_ST, nx = Math.floor((GW - 1) / st) + 1, ny = Math.floor((GH - 1) / st) + 1, hf = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const gx = i * st, gy = j * st; hf[j * nx + i] = (v3H0(gx - 1, gy - 1) + v3H0(gx, gy - 1) + v3H0(gx - 1, gy) + v3H0(gx, gy)) / 4; }
  V3.hf = hf; V3.nx = nx; V3.ny = ny;
  const d = CELL * st, verts = [], idx = [];
  const P = (i, j) => [i * d, -j * d, hf[j * nx + i]];
  const nor = (i, j) => { const hx = hf[j * nx + Math.min(nx - 1, i + 1)] - hf[j * nx + Math.max(0, i - 1)], hy = hf[Math.max(0, j - 1) * nx + i] - hf[Math.min(ny - 1, j + 1) * nx + i]; return v3Norm([-hx / (2 * d), -hy / (2 * d), 1]); };
  // 大海域地图：只有陆地与近岸（寻路带 + 一点余量）铺细网格，更南的远海是一块平的海面（整片大海逐格建网格有几百万个索引）
  const jMax = TER.pathY ? Math.min(ny - 1, Math.ceil(TER.pathY / d) + 2) : ny - 1;
  for (let j = 0; j <= jMax; j++) for (let i = 0; i < nx; i++) { const p = P(i, j), n = nor(i, j); verts.push(p[0], p[1], p[2], n[0], n[1], n[2]); }
  for (let j = 0; j < jMax; j++) for (let i = 0; i < nx - 1; i++) { const a = j * nx + i, b = a + 1, c = a + nx, e = c + 1; idx.push(a, c, b, b, c, e); }
  // 远海平面切成约 250 米一格：原来是一整块（几公里长的两个三角形），苹果 M 系列等显卡在这么大的三角形上插值精度不够，
  //   逐像素算的到镜头距离、视线方向乱跳——海面成一片雾色 / 海色随机交替的方块噪点（软件渲染器精度高，看不出来）
  const FS = 250, fk = Math.max(1, Math.round(FS / d));
  if (jMax < ny - 1) {
    const s0 = verts.length / 6, zs = hf[jMax * nx], y0 = -jMax * d, y1 = -(ny - 1) * d, x1 = (nx - 1) * d;
    const cx = Math.max(1, Math.ceil(x1 / FS)), cy = Math.max(1, Math.ceil((y0 - y1) / FS));
    for (let j = 0; j <= cy; j++) for (let i = 0; i <= cx; i++) verts.push(x1 * i / cx, lerp(y0, y1, j / cy), zs, 0, 0, 1);
    for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) { const a = s0 + j * (cx + 1) + i, b = a + 1, c = a + cx + 1, e = c + 1; idx.push(a, c, b, b, c, e); }
  }
  // 围边：沿四条边走一圈，每个边点一上一下两个顶点（远海那一段同样约 250 米一个点）
  const ring = [];
  for (let i = 0; i < nx; i++) ring.push([i, 0]);
  for (let j = 1; j <= jMax; j++) ring.push([nx - 1, j]);
  if (jMax < ny - 1) {
    for (let j = jMax + fk; j < ny - 1; j += fk) ring.push([nx - 1, j]);
    ring.push([nx - 1, ny - 1]);
    for (let i = nx - 1 - fk; i > 0; i -= fk) ring.push([i, ny - 1]);
    ring.push([0, ny - 1]);
    for (let j = ny - 1 - fk; j > jMax; j -= fk) ring.push([0, j]);
    ring.push([0, jMax]);
  } else for (let i = nx - 2; i >= 0; i--) ring.push([i, ny - 1]);
  for (let j = (jMax < ny - 1 ? jMax : ny - 1) - 1; j > 0; j--) ring.push([0, j]);
  ring.push([0, 0]);
  const base = verts.length / 6;
  for (const [i, j] of ring) { const p = P(i, j); verts.push(p[0], p[1], p[2], 0, 0, -1, p[0], p[1], V3_SKIRT, 0, 0, -1); }
  for (let k = 0; k < ring.length - 1; k++) { const a = base + k * 2, b = a + 1, c = a + 2, e = a + 3; idx.push(a, b, c, c, b, e); }
  if (!V3.buf) { V3.buf = gl.createBuffer(); V3.ib = gl.createBuffer(); }
  gl.bindBuffer(gl.ARRAY_BUFFER, V3.buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
  const big = verts.length / 6 > 65535 && V3.u32;   // 顶点超过 16 位索引的上限：用 32 位索引（OES_element_index_uint）
  V3.it = big ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, V3.ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, big ? new Uint32Array(idx) : new Uint16Array(idx), gl.STATIC_DRAW);
  V3.n = idx.length; V3.seed = TER.seed; V3.sig = typeof trxSig === 'function' ? trxSig() : null;
  v3OceanBuild(d);
  v3Bld();
  // 底图（俯视贴图以外的远处）：小地图同款黑绿配色，每格一个像素
  const c = document.createElement('canvas'), g = c.getContext('2d'), img = g.createImageData(GW, GH);
  for (let i = 0; i < GW * GH; i++) {
    const t = TER.type[i], col = (typeof MM_COL === 'object' && MM_COL[t]) || '#0a2a18', e = isWater(t) ? .5 : .45 + TER.elev[i] * .5;
    for (let k = 0; k < 3; k++) img.data[i * 4 + k] = parseInt(col.slice(1 + k * 2, 3 + k * 2), 16) * e;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  V3.baseMM = c;
  v3BaseTex();
  v3Cls();
  v3HtTex();
  v3EnvBuild();
  if (typeof v3LightBake === 'function') v3LightBake();   // 光照贴图（v3light.js）
}
// —— 地图外的海：海岛这类四周是海的地图，地图边外一直是海，铺到天边（雾的尽头），看不见地图的边 ——
//   无边海面：一块跟着镜头走的方形网格（中间密、往外按等比加宽，约 2400 个顶点），按能见距离缩放，地图里面的部分在着色器里丢掉；
//     海面的浪、反光全按世界坐标逐像素算，所以网格跟着镜头挪也看不出来；贴图坐标出了图就取图边那一圈（深海），颜色和图里接得上
//   北面延伸：地图北边是陆地时（海岛的图里只有岛的南半部），把岛顺着北缘镜像延伸出去，地形、林地贴图在接缝处连续，
//     再按北缘陆地那一段的宽度收出一道圆弧形的北岸（最远约 3 公里），沉到无边海面下面；只是远景，部队到不了
// 条件：西、东、南三条边九成五以上是海（默认地图北边是陆地、东西两边一半是陆地，不加）；北边也全是海时不用延伸
const V3_OC = { n: 0, b: null, i: null, ext: null };
function v3OceanBuild(d) {
  const gl = V3.gl, edge = (pts) => { let w = 0; for (const [x, y] of pts) if (isWater(TER.type[y * GW + x])) w++; return w / Math.max(1, pts.length); };
  const col = x => Array.from({ length: GH }, (_, y) => [x, y]), row = y => Array.from({ length: GW }, (_, x) => [x, y]);
  V3.ocean = edge(col(0)) > .95 && edge(col(GW - 1)) > .95 && edge(row(GH - 1)) > .95;
  V3_OC.ext = null;
  if (!V3.ocean) return;
  V3.ocRect = [0, 0, (V3.nx - 1) * d, (V3.ny - 1) * d];
  // 无边海面网格：[-1, 1]² 上每边 24 段、按等比从中间往外加宽（第一段约是半边长的 0.5%）
  if (!V3_OC.b) {
    const K = 24, a = .16, t = k => (Math.exp(a * k) - 1) / (Math.exp(a * K) - 1), xs = [];
    for (let k = K; k > 0; k--) xs.push(-t(k));
    xs.push(0); for (let k = 1; k <= K; k++) xs.push(t(k));
    const N = xs.length, v = [], ix = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) v.push(xs[i], xs[j], 0, 0, 0, 1);
    for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) { const p = j * N + i; idx2(ix, p, p + 1, p + N, p + N + 1); }
    V3_OC.b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, V3_OC.b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STATIC_DRAW);
    V3_OC.i = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, V3_OC.i); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(ix), gl.STATIC_DRAW);
    V3_OC.n = ix.length;
  }
  if (edge(row(0)) > .95) return;
  // 北面延伸：列与地图同一套（接缝那一行顶点完全重合），行每 40 米一行；高度取地图北缘往南同样距离那一行（镜像）
  const nx = V3.nx, ny = V3.ny, hf = V3.hf, ds = 40, Dmax = 3200, K = Math.ceil((Dmax + 300) / ds), Dn = new Float32Array(nx);
  // 北缘每一段连续的陆地：往北延伸的距离按圆弧收（段中间最远，两头为 0），最远约 3.2 公里、不超过段宽的八成
  for (let i = 0; i < nx;) {
    if (hf[i] <= -2.9) { i++; continue; }
    let j = i; while (j < nx && hf[j] > -2.9) j++;
    const L = (j - i) * d, Dm = Math.min(Dmax, L * .8);
    for (let k = i; k < j; k++) { const u = ((k + .5) - (i + j) / 2) / ((j - i) / 2); Dn[k] = Dm * Math.sqrt(Math.max(0, 1 - Math.abs(u) ** 2.2)) * (.9 + .1 * Math.sin(k * d / 430) * Math.sin(k * d / 170 + 1.3)); }
    i = j;
  }
  const hz = new Float32Array(nx * (K + 1));
  for (let k = 0; k <= K; k++) {
    const s = k * ds, jm = Math.min(ny - 1, Math.round(s / d));
    for (let i = 0; i < nx; i++) {
      const zm = k === 0 ? hf[i] : hf[jm * nx + i];
      hz[k * nx + i] = k === 0 ? zm : zm <= -2.9 ? -9 : lerp(-9, zm, smooth(0, 380, Dn[i] - s));   // 水下压到 -9：别和无边海面（-3）抢深度
    }
  }
  const v = [], ix = [];
  for (let k = 0; k <= K; k++) for (let i = 0; i < nx; i++) {
    const z = hz[k * nx + i], zx = hz[k * nx + Math.min(nx - 1, i + 1)] - hz[k * nx + Math.max(0, i - 1)], zy = hz[Math.min(K, k + 1) * nx + i] - hz[Math.max(0, k - 1) * nx + i];
    const nr = v3Norm([-zx / (2 * d), -zy / (k > 0 && k < K ? 2 * ds : ds), 1]);
    v.push(i * d, k * ds, z, nr[0], nr[1], nr[2]);   // GL y 朝北：北缘外 s 米 = y = +s
  }
  for (let k = 0; k < K; k++) for (let i = 0; i < nx - 1; i++) { const a = k * nx + i, b = a + 1, c = a + nx, e = c + 1; idx2(ix, a, b, c, e); }
  const big = v.length / 6 > 65535;
  if (big && !V3.u32) return;
  const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STATIC_DRAW);
  const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, big ? new Uint32Array(ix) : new Uint16Array(ix), gl.STATIC_DRAW);
  if (V3_OC.ext) { gl.deleteBuffer(V3_OC.ext.b); gl.deleteBuffer(V3_OC.ext.i); }
  V3_OC.ext = { b, i: ib, n: ix.length, it: big ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, hz, K, ds, nx, d };   // hz 留着：延伸陆地上空的地面高度（镜头不钻地）
}
const idx2 = (ix, a, b, c, e) => ix.push(a, b, c, b, e, c);   // 一格两个三角形（与地形网格同一绕向）
function v3OceanDraw(C) {
  if (!V3.ocean || !V3_OC.b) return;
  const gl = V3.gl, u = V3.u, A = V3.a;
  const dr = (b, i, n, it) => { gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, i); gl.vertexAttribPointer(A.p, 3, gl.FLOAT, false, 24, 0); gl.vertexAttribPointer(A.n, 3, gl.FLOAT, false, 24, 12); gl.drawElements(gl.TRIANGLES, n, it, 0); };
  const E = V3_OC.ext;
  if (E) { gl.uniform1f(u.uRing, 2); dr(E.b, E.i, E.n, E.it); }   // 先画延伸的陆地，再画海（海面在陆地低处、水下的地方盖上去）
  const R = Math.max(3000, v3FogE(C) * 1.1), r = V3.ocRect;
  gl.uniform1f(u.uRing, 1); gl.uniform4f(u.uRect, r[0], r[1], r[2], r[3]);
  gl.uniform1f(u.uScl, R); gl.uniform3f(u.uOff, C.E[0], C.E[1], -2.97);   // 比图里的海面高 3 厘米：图边围边的顶和海面一样高，抢深度时图边上一条虚线
  dr(V3_OC.b, V3_OC.i, V3_OC.n, gl.UNSIGNED_SHORT);
  gl.uniform1f(u.uScl, 1); gl.uniform3f(u.uOff, 0, 0, 0); gl.uniform1f(u.uRing, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, V3.buf); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, V3.ib);   // 后面还有画地形网格的（沙盘桌之类）按原来的缓冲
  gl.vertexAttribPointer(A.p, 3, gl.FLOAT, false, 24, 0); gl.vertexAttribPointer(A.n, 3, gl.FLOAT, false, 24, 12);
}
// 底图（远处、俯视贴图以外）：写实画面用整图地形渲染（terrain.js trxSnapshot，约 1.5 米一个像素，有农田、林冠、河流道路），
//   不再是每 10 米一个色块；黑绿 / 数码风的地面由着色器画，底图只在写实画面里用，用小地图配色就够
function v3BaseTex() {
  const gl = V3.gl, real = typeof realLook === 'function' && realLook() && !v3Mx();
  let src = V3.baseMM;
  const pw = V3.coarse || (V3.maxTex || 2048) < 4096 ? 2048 : 4096;   // 底图按 2 的幂（2:1）存，好生成多级渐远纹理
  if (real && typeof trxSnapshot === 'function') { const snap = trxSnapshot(pw); if (snap) src = snap; }
  V3.baseReal = real;
  if (!src) return;
  const P = V3.basePot || (V3.basePot = document.createElement('canvas'));
  if (P.width !== pw) { P.width = pw; P.height = pw / 2; }
  const cx = P.getContext('2d'); cx.imageSmoothingQuality = 'high'; cx.drawImage(src, 0, 0, P.width, P.height);
  v3Upload(1, V3.base, P, gl.RGBA);
}
// 上传贴图：边长都是 2 的幂时生成多级渐远纹理、开各向异性过滤——斜着看远处的地面不再糊成一片，也不闪烁
function v3Upload(unit, tex, src, fmt) {
  const gl = V3.gl, pot = n => n > 0 && (n & (n - 1)) === 0, mip = pot(src.width) && pot(src.height);
  gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, fmt, fmt, gl.UNSIGNED_BYTE, src);
  if (mip) gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  if (V3.aniso) gl.texParameterf(gl.TEXTURE_2D, V3.aniso.TEXTURE_MAX_ANISOTROPY_EXT, mip ? V3.anMax : 1);
}
// 数码高程贴图（每个网格面一个像素，不插值）：R 高度台阶级数（每 15 一级）/ 16 · G 坦克上不去（山地，或高程超过 grid.js VEH_ELEV 的高地）· B 水面
function v3HtTex() {
  const gl = V3.gl, nx = V3.nx, ny = V3.ny, hf = V3.hf, w = nx - 1, h = ny - 1, a = new Uint8Array(w * h * 4), ve = typeof VEH_ELEV === 'number' ? VEH_ELEV : .68;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const m = (hf[j * nx + i] + hf[j * nx + i + 1] + hf[(j + 1) * nx + i] + hf[(j + 1) * nx + i + 1]) / 4, k = (j * w + i) * 4;
    let blk = 0;
    for (let dy = 0; dy < V3_ST && !blk; dy++) for (let dx = 0; dx < V3_ST; dx++) {
      const gx = Math.min(GW - 1, i * V3_ST + dx), gy = Math.min(GH - 1, j * V3_ST + dy), t = TER.type[gy * GW + gx];
      if (t === T.MOUNT || (t === T.HILL && TER.elev[gy * GW + gx] > ve)) { blk = 1; break; }
    }
    a[k] = Math.round(clamp(Math.floor(Math.max(0, m) / 15) / 16, 0, 1) * 255); a[k + 1] = blk * 255; a[k + 2] = m < 1.5 ? 255 : 0; a[k + 3] = 255;
  }
  gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, V3.ht);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, a);
}
// 数码风地面用的地物掩码（每格一个像素，线性插值后取等值线就是平滑的边）：
//   uCls：R 道路 / 桥 · G 树林 · B 河流（渡口淡一些，桥下也算河）· A 城镇；uCls2：R 沼泽 · G 沙滩 · B 礁岸 / 悬崖 · A 田地
//   掩码先模糊再上传，边缘不再是一格一格的台阶：道路、河流只模糊一格（[1 2 1]），成片的地物模糊两格
function v3Cls() {
  const gl = V3.gl, N = GW * GH, a = new Uint8Array(N * 4), b = new Uint8Array(N * 4);
  const ch = f => { const m = new Float32Array(N); for (let i = 0; i < N; i++) m[i] = f(TER.type[i]); return m; };
  const blur = (m, r) => {   // 可分离的二项式模糊，r 遍 [1 2 1]
    const tmp = new Float32Array(N);
    for (let k = 0; k < r; k++) {
      for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) { const i = y * GW + x; tmp[i] = (m[y * GW + Math.max(0, x - 1)] + 2 * m[i] + m[y * GW + Math.min(GW - 1, x + 1)]) / 4; }
      for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) { const i = y * GW + x; m[i] = (tmp[Math.max(0, y - 1) * GW + x] + 2 * tmp[i] + tmp[Math.min(GH - 1, y + 1) * GW + x]) / 4; }
    }
    return m;
  };
  const C = [blur(ch(t => t === T.ROAD || t === T.BRIDGE ? 1 : 0), 1), blur(ch(t => t === T.FOREST ? 1 : 0), 2), blur(ch(t => t === T.RIVER || t === T.BRIDGE ? 1 : t === T.FORD ? .7 : 0), 1), blur(ch(t => t === T.TOWN ? 1 : 0), 2),
    blur(ch(t => t === T.MARSH ? 1 : 0), 2), blur(ch(t => t === T.BEACH ? 1 : 0), 2), blur(ch(t => t === T.CLIFF ? 1 : t === T.ROCKS ? .7 : 0), 1), blur(ch(t => t === T.FIELD ? 1 : 0), 2)];
  for (let i = 0; i < N; i++) for (let k = 0; k < 4; k++) { a[i * 4 + k] = Math.round(C[k][i] * 255); b[i * 4 + k] = Math.round(C[4 + k][i] * 255); }
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, V3.cls); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, GW, GH, 0, gl.RGBA, gl.UNSIGNED_BYTE, a);
  if (V3.cls3) {   // 水深分类（写实海面）：R 浅水（浅滩、礁石、紧挨岸的水）、G 礁石、B 近岸白浪（挨着陆地的水格）
    const land = i => !isWater(TER.type[i]);
    const nearL = i => { const x = i % GW, y = (i / GW) | 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < GW && yy < GH && land(yy * GW + xx)) return true; } return false; };
    const C3 = [new Float32Array(N), new Float32Array(N), new Float32Array(N)];
    for (let i = 0; i < N; i++) { const t = TER.type[i]; if (!isWater(t)) { C3[0][i] = 1; continue; } const nl = nearL(i); C3[0][i] = t === T.SHOAL || t === T.REEF || nl ? 1 : 0; C3[1][i] = t === T.REEF ? 1 : 0; C3[2][i] = nl ? 1 : 0; }
    blur(C3[0], 3); blur(C3[1], 2); blur(C3[2], 1);
    const c3 = new Uint8Array(N * 4);
    for (let i = 0; i < N; i++) { c3[i * 4] = Math.round(C3[0][i] * 255); c3[i * 4 + 1] = Math.round(C3[1][i] * 255); c3[i * 4 + 2] = Math.round(C3[2][i] * 255); c3[i * 4 + 3] = 255; }
    gl.activeTexture(gl.TEXTURE12); gl.bindTexture(gl.TEXTURE_2D, V3.cls3); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, GW, GH, 0, gl.RGBA, gl.UNSIGNED_BYTE, c3);
  }
  gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, V3.cls2); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, GW, GH, 0, gl.RGBA, gl.UNSIGNED_BYTE, b);
  if (typeof terLines === 'function') { const lf = terLines(); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1); gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, V3.lf); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, lf.w, lf.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, lf.d); }   // 道路、河流的中心线距离场（terrain.js）
}
// 3D 地图用数码风画地面吗（黑绿画面；设置里可关）
const v3Mx = () => typeof SETTINGS === 'object' && !!SETTINGS && (SETTINGS.look === 'green' || SETTINGS.look === 'matrix') && SETTINGS.matrix3d !== false;   // 黑绿、数码两种画面都用数码风地面
// 写实画面的天空 / 远处的大气（雾的颜色、背景）：淡灰蓝
const V3_BG = [.63, .69, .75], V3_BGG = `vec3(${V3_BG.join(', ')})`;

// 房屋几何：民房是坡顶（两面坡 + 山墙，屋脊顺着长边），楼房是平顶（女儿墙、楼梯间 / 水箱），镇中心的更高；坐落在地面高度上；
// 机场建筑（afbase.js：机库、机堡、塔台、营房、油罐等，任意朝向的多边形柱体，塔台玻璃顶与水塔水箱架空）排在前面，机场被发现 / 夺取时重建；
// 树木（v3Trees）：林地成片、丘陵山地零星、田野里偶尔一棵孤树；按块（每块不超过 16 位索引）静态缓冲区
const v3Hsh = (x, y) => { const v = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; return v - Math.floor(v); };
function v3Chunks() {
  const out = [];
  let cur = null;
  const need = n => { if (!cur || cur.vb.length / 8 + n > 65000) out.push(cur = { vb: [], ib: [] }); return cur; };
  return { out, need };
}
function v3Bld() {
  const gl = V3.gl, L = typeof townBld === 'function' ? townBld().list : [];
  const A = typeof afb3dBlocks === 'function' ? afb3dBlocks() : [];
  V3.asig = typeof afb3dSig === 'function' ? afb3dSig() : '';
  const K = v3Chunks();
  const rep = typeof v3pRep === 'function' ? v3pRep : () => false;   // 换成外部模型的（v3props.js）不再自己挤出
  for (let ai = 0; ai < A.length; ai++) {
    const k = A[ai];
    if (rep(ai)) continue;
    const n = k.pts.length, ch = K.need(n * 5 + 2), vb = ch.vb, ib = ch.ib;
    const P = k.pts.map(([x, y]) => [x, -y]), g = Math.min(...k.pts.map(([x, y]) => v3Ht(x, y))) - .5, z0 = g + k.z0 * 1.6, top = g + k.z * 1.6;
    const cx = P.reduce((a, p) => a + p[0], 0) / n, cy = P.reduce((a, p) => a + p[1], 0) / n, b0 = vb.length / 8;
    vb.push(cx, cy, top, 0, 0, 1, .5, .5);   // 顶面：从中心扇形三角化，边缘的 e 取 0（棱线发光）
    for (const [x, y] of P) vb.push(x, y, top, 0, 0, 1, 0, .5);
    for (let i = 0; i < n; i++) ib.push(b0, b0 + 1 + i, b0 + 1 + (i + 1) % n);
    for (let i = 0; i < n; i++) {   // 墙：法线朝外
      const [x0, y0] = P[i], [x1, y1] = P[(i + 1) % n], l = Math.hypot(x1 - x0, y1 - y0) || 1;
      let nx = (y1 - y0) / l, ny = -(x1 - x0) / l;
      if (((x0 + x1) / 2 - cx) * nx + ((y0 + y1) / 2 - cy) * ny < 0) { nx = -nx; ny = -ny; }
      const q = vb.length / 8;
      vb.push(x0, y0, z0, nx, ny, 0, 0, 0, x1, y1, z0, nx, ny, 0, 1, 0, x1, y1, top, nx, ny, 0, 1, 1, x0, y0, top, nx, ny, 0, 0, 1);
      ib.push(q, q + 1, q + 2, q, q + 2, q + 3);
    }
  }
  const TW = typeof TER === 'object' && TER.towns ? [...(TER.towns.vills || []), TER.towns.town1, TER.towns.town2, TER.towns.town3, TER.towns.hq].filter(Boolean) : [];
  for (const b of rep('town') ? [] : L) {
    const ch = K.need(48), vb = ch.vb, ib = ch.ib;
    const quad = (pts, n, e) => { const k = vb.length / 8; pts.forEach(([x, y, z], i) => vb.push(x, y, z, n[0], n[1], n[2], e ? e[i][0] : (i === 1 || i === 2 ? 1 : 0), e ? e[i][1] : (i >= 2 ? 1 : 0))); ib.push(k, k + 1, k + 2, k, k + 2, k + 3); };
    const box = (X0, X1, Y0, Y1, z0, z1, roof = true) => {   // GL 坐标的方块（Y 已取负）：四面墙 + 平顶
      if (roof) quad([[X0, Y0, z1], [X1, Y0, z1], [X1, Y1, z1], [X0, Y1, z1]], [0, 0, 1]);
      quad([[X0, Y0, z0], [X1, Y0, z0], [X1, Y0, z1], [X0, Y0, z1]], [0, 1, 0]);    // 北墙
      quad([[X1, Y1, z0], [X0, Y1, z0], [X0, Y1, z1], [X1, Y1, z1]], [0, -1, 0]);   // 南墙
      quad([[X1, Y0, z0], [X1, Y1, z0], [X1, Y1, z1], [X1, Y0, z1]], [1, 0, 0]);    // 东墙
      quad([[X0, Y1, z0], [X0, Y0, z0], [X0, Y0, z1], [X0, Y1, z1]], [-1, 0, 0]);   // 西墙
    };
    const w = (b.r ? b.h : b.w) / 2, h = (b.r ? b.w : b.h) / 2, cx = b.x + b.dx, cy = b.y + b.dy, g = v3Ht(cx, cy) - .5;
    const dc = TW.length ? Math.min(...TW.map(t => Math.hypot(t.x - cx, t.y - cy))) : 99, core = dc < 24 ? 2 : dc < 40 ? 1 : 0, hs = v3Hsh(cx, cy), hs2 = v3Hsh(cy, cx);
    const X0 = cx - w, X1 = cx + w, Y0 = -(cy - h), Y1 = -(cy + h);   // GL 坐标：y 取负（北为正）
    if (b.f) {   // 平顶楼房：4–7 层（镇中心再高两层）、女儿墙、屋顶楼梯间 / 水箱
      const top = g + (4 + Math.floor(hs * 4) + core) * 2.6, pw = .35;
      box(X0, X1, Y0, Y1, g, top, false);
      quad([[X0 + pw, Y0 - pw, top - .5], [X1 - pw, Y0 - pw, top - .5], [X1 - pw, Y1 + pw, top - .5], [X0 + pw, Y1 + pw, top - .5]], [0, 0, 1]);   // 屋面（比墙顶低半格）
      quad([[X0, Y0, top], [X1, Y0, top], [X1 - pw, Y0 - pw, top], [X0 + pw, Y0 - pw, top]], [0, 0, 1], [[0, 0], [1, 0], [1, .5], [0, .5]]);   // 女儿墙顶
      quad([[X1, Y1, top], [X0, Y1, top], [X0 + pw, Y1 + pw, top], [X1 - pw, Y1 + pw, top]], [0, 0, 1], [[0, 0], [1, 0], [1, .5], [0, .5]]);
      quad([[X1, Y0, top], [X1, Y1, top], [X1 - pw, Y1 + pw, top], [X1 - pw, Y0 - pw, top]], [0, 0, 1], [[0, 0], [1, 0], [1, .5], [0, .5]]);
      quad([[X0, Y1, top], [X0, Y0, top], [X0 + pw, Y0 - pw, top], [X0 + pw, Y1 + pw, top]], [0, 0, 1], [[0, 0], [1, 0], [1, .5], [0, .5]]);
      const sx = lerp(X0 + 1, X1 - 2.2, hs2), sy = lerp(Y1 + 1, Y0 - 2, hs);   // 楼梯间
      box(sx, sx + 1.4, sy, sy + 1.2, top - .5, top + 1.8);
      if (hs2 > .45) { const tx = lerp(X0 + .8, X1 - 1.6, 1 - hs2), ty = lerp(Y1 + .8, Y0 - 1.6, 1 - hs); box(tx, tx + .9, ty, ty + .9, top + .4, top + 1.5); }   // 水箱
    } else {   // 坡顶民房：2–3 层，两面坡屋顶（屋脊顺长边），两头山墙
      const ew = g + (2 + Math.floor(hs * 2) + (core > 1 ? 1 : 0)) * 2.8, rh = 1.8 + hs2 * 1.2, ov = .35;
      box(X0, X1, Y0, Y1, g, ew, false);
      const ex = [[0, 0], [1, 0], [1, 1], [0, 1]];
      if (X1 - X0 >= Y0 - Y1) {   // 屋脊东西向
        const ym = (Y0 + Y1) / 2, nz = (Y0 - Y1) / 2 + ov, l = Math.hypot(nz, rh), N = [0, rh / l, nz / l], S2 = [0, -rh / l, nz / l];
        quad([[X0 - ov, Y0 + ov, ew - .3], [X1 + ov, Y0 + ov, ew - .3], [X1 + ov, ym, ew + rh], [X0 - ov, ym, ew + rh]], N, ex);
        quad([[X1 + ov, Y1 - ov, ew - .3], [X0 - ov, Y1 - ov, ew - .3], [X0 - ov, ym, ew + rh], [X1 + ov, ym, ew + rh]], S2, ex);
        quad([[X1, Y0, ew], [X1, Y1, ew], [X1, ym, ew + rh], [X1, ym, ew + rh]], [1, 0, 0], ex);   // 山墙（三角形：上面两点重合）
        quad([[X0, Y1, ew], [X0, Y0, ew], [X0, ym, ew + rh], [X0, ym, ew + rh]], [-1, 0, 0], ex);
      } else {   // 屋脊南北向
        const xm = (X0 + X1) / 2, nz = (X1 - X0) / 2 + ov, l = Math.hypot(nz, rh), E = [rh / l, 0, nz / l], Wn = [-rh / l, 0, nz / l];
        quad([[X1 + ov, Y0 + ov, ew - .3], [X1 + ov, Y1 - ov, ew - .3], [xm, Y1 - ov, ew + rh], [xm, Y0 + ov, ew + rh]], E, ex);
        quad([[X0 - ov, Y1 - ov, ew - .3], [X0 - ov, Y0 + ov, ew - .3], [xm, Y0 + ov, ew + rh], [xm, Y1 - ov, ew + rh]], Wn, ex);
        quad([[X0, Y0, ew], [X1, Y0, ew], [xm, Y0, ew + rh], [xm, Y0, ew + rh]], [0, 1, 0], ex);
        quad([[X1, Y1, ew], [X0, Y1, ew], [xm, Y1, ew + rh], [xm, Y1, ew + rh]], [0, -1, 0], ex);
      }
    }
  }
  const up = L => L.filter(c => c.ib.length).map(c => {
    const o = { b: gl.createBuffer(), i: gl.createBuffer(), n: c.ib.length, bb: c.bb };
    gl.bindBuffer(gl.ARRAY_BUFFER, o.b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(c.vb), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, o.i); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(c.ib), gl.STATIC_DRAW);
    return o;
  }), drop = L => { for (const c of L || []) { gl.deleteBuffer(c.b); gl.deleteBuffer(c.i); } };
  drop((V3.bch || []).filter(c => !c.tree));   // 只删房屋块：树块沿用（以前连树的缓冲区一起删了，机场被发现、重建房屋后全图的树就不见了）
  const TL = typeof v3pReady === 'function' && v3pReady() ? [] : v3Trees();   // 树换成外部模型后不再种自己的
  if (V3.tchL !== TL) { drop(V3.tch); V3.tch = up(TL).map(c => Object.assign(c, { tree: true })); V3.tchL = TL; }   // 树只在地图 / 地形变了时重传（机场被发现时只重建房屋）
  V3.bch = [...up(K.out), ...V3.tch];
  V3.bn = V3.bch.reduce((a, c) => a + c.n, 0);
}
// 树：阔叶树（两层收拢的多面树冠）、针叶树（尖塔形）、细树干；e.x = 2.5 标记树冠、3.5 树干（着色器另配颜色，不画棱线）
// 返回若干小块（每块的顶点、索引，按地图种子缓存；地形改了（弹坑等）重算高度）
function v3Trees() {
  if (!(typeof TER === 'object' && TER && TER.type)) return [];
  const sig = TER.seed + ':' + (V3.sig || '');
  if (V3.trees && V3.trees.sig === sig) return V3.trees.list;
  const r = rng(TER.seed + 77), list = [];
  let cur = { vb: [], ib: [] };
  const af = TER.af, roadNear = (gx, gy) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const x = gx + dx, y = gy + dy; if (x < 0 || y < 0 || x >= GW || y >= GH) continue; const t = TER.type[y * GW + x]; if (t === T.ROAD || t === T.BRIDGE || t === T.TOWN || t === T.RIVER || t === T.BEACH) return true; } return false; };
  const ptsNear = (x, y) => (TER.points || []).some(p => Math.abs(p.x - x) < 26 && Math.abs(p.y - y) < 26);
  const tree = (x, y, hgt, rad, con) => {
    if (cur.vb.length / 8 > 60000) { list.push(cur); cur = { vb: [], ib: [], bb: cur.bb }; }
    const vb = cur.vb, ib = cur.ib, g = v3Ht(x, y) - .2, X = x, Y = -y, a0 = r() * 6.28, n = 5, base = vb.length / 8;
    const tr = .22 + rad * .05;   // 树干：三棱柱
    for (let i = 0; i < 3; i++) { const a = a0 + i * 2.094, c = Math.cos(a), s = Math.sin(a); vb.push(X + c * tr, Y + s * tr, g, c, s, 0, 3.5, .5, X + c * tr * .7, Y + s * tr * .7, g + hgt * .45, c, s, 0, 3.5, .5); }
    for (let i = 0; i < 3; i++) { const j = (i + 1) % 3, a = base + i * 2, b2 = base + j * 2; ib.push(a, b2, b2 + 1, a, b2 + 1, a + 1); }
    const c0 = vb.length / 8, ring = (z, rr, nz, k) => { for (let i = 0; i < n; i++) { const a = a0 + i * 6.2832 / n + k, c = Math.cos(a), s = Math.sin(a), jr = rr * (.85 + .3 * r()); vb.push(X + c * jr, Y + s * jr, z, c * (1 - Math.abs(nz)), s * (1 - Math.abs(nz)), nz, 2.5, .5); } };
    // 针叶：两层尖塔（下层宽、上层收）；阔叶：腰宽、上收的多面树冠；底下一个尖收到树干
    if (con) { ring(g + hgt * .22, rad, -.25, 0); ring(g + hgt * .55, rad * .62, .35, .6); }
    else { ring(g + hgt * .55, rad, .05, 0); ring(g + hgt * .85, rad * .62, .6, .63); }
    vb.push(X, Y, g + hgt, 0, 0, 1, 2.5, .5, X, Y, g + hgt * (con ? .2 : .32), 0, 0, -1, 2.5, .5);
    const tip = c0 + 2 * n;
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; ib.push(c0 + i, c0 + j, c0 + n + j, c0 + i, c0 + n + j, c0 + n + i, c0 + n + i, c0 + n + j, tip, tip + 1, c0 + j, c0 + i); }
  };
  const TS = 30;   // 按 30 × 30 格的方块分块（每块一个缓冲区、带包围盒，远处雾里的整块不画）
  for (let ty = 0; ty < GH; ty += TS) for (let tx = 0; tx < GW; tx += TS) {
  if (cur.ib.length) list.push(cur);
  cur = { vb: [], ib: [], bb: [tx * CELL - 6, ty * CELL - 6, (tx + TS) * CELL + 6, (ty + TS) * CELL + 6] };
  for (let gy = ty; gy < Math.min(GH, ty + TS); gy++) for (let gx = tx; gx < Math.min(GW, tx + TS); gx++) {
    const i = gy * GW + gx, t = TER.type[i];
    let n = 0;
    if (t === T.FOREST) n = 1 + (r() < (V3.coarse ? .15 : .45) ? 1 : 0) + (!V3.coarse && r() < .12 ? 1 : 0);   // 触屏（手机、平板）少种一些
    else if (t === T.HILL) n = r() < .16 ? 1 : 0;
    else if (t === T.MOUNT) n = r() < .09 ? 1 : 0;
    else if (t === T.FIELD) n = r() < .01 ? 1 : 0;
    else if (t === T.MARSH) n = r() < .06 ? 1 : 0;
    if (!n || (t !== T.FOREST && roadNear(gx, gy))) continue;
    const cx = gx * CELL + CELL / 2, cy = gy * CELL + CELL / 2;
    if (af && Math.hypot(cx - af.x, cy - af.y) < 520) continue;   // 机场场区（跑道、滑行道）不长树
    if (ptsNear(cx, cy)) continue;   // 据点、阵地上不长树（挡住工事）
    for (let k = 0; k < n; k++) {
      const x = cx + (r() - .5) * CELL * .9, y = cy + (r() - .5) * CELL * .9, el = TER.elev[i] || 0, con = el > .62 || t === T.MOUNT || r() < .28;
      const hgt = (t === T.FOREST ? 7.5 + r() * 4 : 6 + r() * 3) * (t === T.MARSH ? .6 : 1), rad = (con ? 1.9 : 2.6) + r() * 1.1;
      tree(x, y, hgt, rad, con);
    }
  }
  }
  if (cur.ib.length) list.push(cur);
  V3.trees = { sig, list };
  return list;
}

function v3Init() {
  V3.tried = true;
  try {
    const cv = document.createElement('canvas');
    const gl = cv.getContext('webgl', { antialias: true, preserveDrawingBuffer: true, alpha: false });
    if (!gl) return;
    const der = !!gl.getExtension('OES_standard_derivatives');
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, V3_VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, V3_FS(der)));
    gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
    const u = {}, a = { p: gl.getAttribLocation(pr, 'p'), n: gl.getAttribLocation(pr, 'n') };
    for (const k of ['uM', 'uEye', 'uTop', 'uBase', 'uCls', 'uCls2', 'uFogT', 'uHt', 'uLf', 'uTopF', 'uBox', 'uBoxF', 'uWorld', 'uGrid', 'uHG', 'uFog', 'uSea', 'uT', 'uMx', 'uLm', 'uLmOn', 'uBm', 'uBg', 'uDg', 'uDf', 'uDr', 'uDs', 'uDet', 'uCls3', 'uSky', 'uSkyOn', 'uSkyU', 'uWn', 'uWnOn', 'uShM', 'uShT', 'uShOn', 'uShP', 'uOff', 'uScl', 'uRing', 'uRect', 'uOcn']) u[k] = gl.getUniformLocation(pr, k);
    const pb = gl.createProgram();
    gl.attachShader(pb, sh(gl.VERTEX_SHADER, V3_BVS)); gl.attachShader(pb, sh(gl.FRAGMENT_SHADER, V3_BFS()));   // 着色器源码用到时再拼：爆炸火光的 GLSL 在后加载的 v3light.js 里
    gl.linkProgram(pb);
    if (!gl.getProgramParameter(pb, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pb));
    const ub = {}, ab = { p: gl.getAttribLocation(pb, 'p'), n: gl.getAttribLocation(pb, 'n'), e: gl.getAttribLocation(pb, 'e') };
    for (const k of ['uM', 'uEye', 'uTop', 'uBase', 'uTopF', 'uBox', 'uBoxF', 'uWorld', 'uFog', 'uT', 'uMx', 'uBg', 'uShM', 'uShT', 'uShOn', 'uShP', 'uLm', 'uLmOn', 'uBm']) ub[k] = gl.getUniformLocation(pb, k);
    const lmU = (gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) || 8) > 8 ? 8 : 0;   // 光照贴图（黑绿画面）在第 9 个单元——写实画面这个单元是地表细节贴图，那时 uLmOn = 0 不读它
    gl.useProgram(pb); gl.uniform1i(ub.uTop, 0); gl.uniform1i(ub.uBase, 1); gl.uniform1i(ub.uTopF, 7); gl.uniform1i(ub.uLm, lmU);
    Object.assign(V3, { pb, ub, ab });
    const mk = (unit, filt) => { const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); for (const [p, v] of [[gl.TEXTURE_MIN_FILTER, filt], [gl.TEXTURE_MAG_FILTER, filt], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, p, v); return t; };
    Object.assign(V3, { gl, cv, pr, u, a, tex: mk(0, gl.LINEAR), base: mk(1, gl.LINEAR), cls: mk(2, gl.LINEAR), cls2: mk(3, gl.LINEAR), fog: mk(4, gl.LINEAR), ht: mk(5, gl.NEAREST), lf: mk(6, gl.LINEAR), texF: mk(7, gl.LINEAR), topF: document.createElement('canvas'), u32: !!gl.getExtension('OES_element_index_uint'), top: document.createElement('canvas'), coarse: V3.coarse ?? (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches), maxTex: Math.min(4096, gl.getParameter(gl.MAX_TEXTURE_SIZE) || 2048), ok: true });
    gl.useProgram(pr);
    gl.uniform1f(u.uScl, 1); gl.uniform3f(u.uOff, 0, 0, 0); gl.uniform1f(u.uRing, 0);   // 地形网格原样画（无边海面、延伸陆地画时临时改，画完改回）
    gl.uniform1i(u.uTop, 0); gl.uniform1i(u.uBase, 1); gl.uniform1i(u.uCls, 2); gl.uniform1i(u.uCls2, 3); gl.uniform1i(u.uFogT, 4); gl.uniform1i(u.uHt, 5); gl.uniform1i(u.uLf, 6); gl.uniform1i(u.uTopF, 7);
    const tu = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS);
    gl.uniform1i(u.uDg, lmU);
    if (tu >= 14) { gl.uniform1i(u.uDg, 8); gl.uniform1i(u.uDf, 9); gl.uniform1i(u.uDr, 10); gl.uniform1i(u.uDs, 11); gl.uniform1i(u.uCls3, 12); gl.uniform1i(u.uSky, 13); }
    if (tu >= 15) gl.uniform1i(u.uWn, 14);
    V3.wn = tu >= 15 ? { ok: false } : null;
    V3.det = tu >= 14 ? { n: 0, t: [] } : null;   // 地表细节贴图、水深分类、海面反射要 14 个纹理单元（老设备不够就不用）
    V3.cls3 = tu >= 14 ? mk(12, gl.LINEAR) : null;
    V3.aniso = gl.getExtension('EXT_texture_filter_anisotropic') || gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic'); V3.anMax = V3.aniso ? Math.min(8, gl.getParameter(V3.aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) || 1) : 1;
    gl.enable(gl.DEPTH_TEST);
  } catch (e) { V3.ok = false; console.warn('3D 地图不可用', e); if (typeof log === 'function') log('3D 地图在这台设备上打不开（显卡着色器出错）：' + String(e && e.message || e).slice(0, 160), 'bad', 'v3err', 8); }
}

// —— 3D 镜头：自由镜头（V3.fc）——镜头本身就是一个在战场上空自由移动的视点：位置 (x, y, z) + 偏航 yaw（0 朝东、π/2 朝南）+ 俯仰 pitch（向上为正）。
//   不再绕着地面上的某一点转（不是第三人称）：拖动 / R F 是原地转头、抬头低头；Q E 降低 / 升高；W S 沿视线方向前后飞（抬头往上、低头往下）、A D 左右平移；
//   滚轮朝鼠标指着的地方推近 / 拉远；左键拖动平移（地面跟着手走）；小地图、编队栏双击等「把镜头移到某处」保持当前朝向和距离平移过去。
//   画面中心（CAM.x, CAM.y）与缩放 CAM.z 每帧由镜头推算（视线落地点、离地高度），贴图范围、细节档、平面地图的切换都照旧按它们
// 渲染距离（设置「3D 渲染距离」）：雾、远景贴图、远裁剪面一起放远 / 拉近
const v3RD = () => clamp(+(typeof SETTINGS === 'object' && SETTINGS && SETTINGS.rdist) || 1, .5, 4);
// 能见距离（雾的起点、终点）：按镜头尺度 D，再乘玩家设的渲染距离（设置里的「3D 渲染距离」、3D 里 [ ] 键）；贴近地面时也至少看得到 1000 × 倍数 米
const v3Fog = (D, rd = v3RD()) => { const f1 = Math.max(D * 3.2, 1000) * rd; return [f1 * .5, f1]; };   // 远处清楚的范围放远（原来 2.8 倍、雾从 46% 起，远处的地面一片暗）
const v3FogR = C => C.fog || [C.D * 1.3, C.D * 2.8], v3FogE = C => v3FogR(C)[1];
// 从「注视点 + 距离 + 俯角 + 方位」（原来的环绕参数）换算成自由镜头：进 3D 时画面和平面地图一致
function v3FcFromOrbit(tx, ty, tz, D, th, ps) {
  const x = tx + D * Math.sin(th) * Math.sin(ps), y = ty + D * Math.sin(th) * Math.cos(ps), z = tz + D * Math.cos(th);
  const yaw = Math.atan2(ty - y, tx - x), pitch = th - Math.PI / 2;
  return { x, y, z, yaw, pitch, yawT: yaw, pitchT: pitch, cx: null, cy: null, cz: null, d: D };
}
function v3FcInit() {
  let D = (CAM.vh / CAM.z) / (2 * Math.tan(V3_FOV / 2)), th = V3.tiltT ?? .95;
  const ps = V3.yawT ?? 0, tz = v3Ht(CAM.x, CAM.y), ux = Math.sin(ps), uy = Math.cos(ps);
  // 平面地图缩得很远时换算出的镜头会在地图外、高度上限以上：改成更陡地俯看、再降低距离，镜头仍对着原来的画面中心
  const lim = (p, u, a, b) => u > 1e-6 ? (b - p) / u : u < -1e-6 ? (a - p) / u : 1e9;
  const hmax = Math.max(0, Math.min(lim(CAM.x, ux, -V3_OUT, W + V3_OUT), lim(CAM.y, uy, -V3_OUT, H + V3_OUT)));
  if (D * Math.sin(th) > hmax) th = Math.asin(clamp(hmax / D, 0, 1));
  if (D * Math.cos(th) > V3_ZMAX - tz) D = (V3_ZMAX - tz) / Math.max(.2, Math.cos(th));
  V3.fc = v3FcFromOrbit(CAM.x, CAM.y, tz, D, th, ps);
  V3.fc0 = { x: CAM.x, y: CAM.y, tz, D, th, ps };   // 进 3D 过渡的终点（v3TiltIn）
}
// 进 3D 的过渡：先从接近正俯视（和平面地图看到的一样）开始，绕画面中心约 1.2 秒压低到默认俯角，不突然跳成透视
const V3_TIN = 1.2;
function v3TiltStep(dt) {
  const T = V3.tin, A = V3.fc0;
  if (!T || !A) return;
  T.t += dt;
  const u = clamp(T.t / V3_TIN, 0, 1), e = u * u * (3 - 2 * u);
  Object.assign(V3.fc, v3FcFromOrbit(A.x, A.y, A.tz, A.D, lerp(Math.min(.1, A.th), A.th, e), A.ps));
  if (u >= 1) V3.tin = null;
}
const v3Gnd = (x, y) => Math.max(v3Ht(clamp(x, 0, W - 1), clamp(y, 0, H - 1)), -2.6, typeof cvCamZ === 'function' ? cvCamZ(x, y) ?? -99 : -99);
// 镜头离最近的东西有多远：脚下的地面 / 甲板，空中的飞机、直升机（近裁剪面按它定）
function v3NearGap(F) {
  let g = Math.max(.5, F.z - v3Gnd(F.x, F.y));
  const near = o => { if (!o || o.dead || !isFinite(o.x)) return; const d = Math.hypot(o.x - F.x, o.y - F.y); if (d < g + 40) g = Math.min(g, Math.max(.5, Math.hypot(d, v3AirZ(o) - F.z) - 20)); };   // 减去半个翼展
  for (const p of (S && S.planes) || []) near(p);
  if (S && S.eair) for (const a of S.eair.fly || []) near(a);
  return g;
}
function v3FcCamera() {
  const F = V3.fc || (v3FcInit(), V3.fc), cp = Math.cos(F.pitch), f = [cp * Math.cos(F.yaw), -cp * Math.sin(F.yaw), Math.sin(F.pitch)];   // 视线方向（GL 坐标）
  const E = [F.x, -F.y, F.z], z = [-f[0], -f[1], -f[2]], x = v3Norm(v3Cross([0, 0, 1], z)), y = v3Cross(z, x);
  const view = new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -v3Dot(x, E), -v3Dot(y, E), -v3Dot(z, E), 1]);
  const D = clamp(F.d || 600, 80, 16000), rd = v3RD(), fog = v3Fog(D, rd);
  const asp = CAM.vw / Math.max(1, CAM.vh), fo = 1 / Math.tan(V3_FOV / 2), n = clamp(Math.min(D * .012, v3NearGap(F) * .45), .3, 25), fa = Math.max(D * 9, fog[1] * 1.5), nf = 1 / (n - fa);   // 近裁剪面：离最近的东西（地面、飞机）越近越小，凑近飞机不会被切掉
  const proj = new Float32Array([fo / asp, 0, 0, 0, 0, fo, 0, 0, 0, 0, (fa + n) * nf, -1, 0, 0, 2 * fa * n * nf, 0]);
  return (V3.cam = { E, x, y, z, D, rd, fog, asp, M: v3Mul(proj, view) });
}
// 每帧：转头缓动、按键飞行、外部「移镜头」的平移、不钻地；再推算画面中心与缩放
function v3FcStep(dt) {
  const F = V3.fc || (v3FcInit(), V3.fc);
  v3TiltStep(dt);
  if (F.cx != null && (Math.abs(CAM.x - F.cx) > .5 || Math.abs(CAM.y - F.cy) > .5)) { F.x += CAM.x - F.cx; F.y += CAM.y - F.cy; }   // 别处把画面中心移走了（小地图、双击编队、点消息定位）：镜头平移过去
  F.yaw += Math.atan2(Math.sin(F.yawT - F.yaw), Math.cos(F.yawT - F.yaw)) * Math.min(1, dt * 14);
  F.pitch += (F.pitchT - F.pitch) * Math.min(1, dt * 14);
  F.x = clamp(F.x, -V3_OUT, W + V3_OUT); F.y = clamp(F.y, -V3_OUT, H + V3_OUT);
  F.z = clamp(F.z, v3Gnd(F.x, F.y) + 3, V3_ZMAX);
  const alt = Math.max(1, F.z - v3Gnd(F.x, F.y)), cp = Math.cos(F.pitch), down = -Math.sin(F.pitch);
  const reach = down > .05 ? Math.min(16000, alt / down * cp) : 2600 * Math.min(1, alt / 200 + .3);   // 视线落地点（看天时取前方一段）
  F.d = Math.hypot(reach, Math.min(alt, reach * 3));
  CAM.x = F.x + Math.cos(F.yaw) * reach; CAM.y = F.y + Math.sin(F.yaw) * reach;
  CAM.z = clamp((CAM.vh / Math.max(30, F.d)) / (2 * Math.tan(V3_FOV / 2)), CAM.fit, Math.max(CAM.fit * 12, 4));   // 与原来的环绕镜头同一换算：画面中心的比例接近平面地图
  camClamp();
  F.cx = CAM.x; F.cy = CAM.y; F.cz = CAM.z;
  V3.yaw = V3.yawT = Math.atan2(-Math.cos(F.yaw), -Math.sin(F.yaw)); V3.tilt = V3.tiltT = clamp(F.pitch + Math.PI / 2, V3_TILT[0], V3_TILT[1]);   // 兼容：旧的方位 / 俯角
}
// 原地转头（偏航）、抬头低头（俯仰）
function v3Look(dyaw, dpitch, now) {
  const F = V3.fc || (v3FcInit(), V3.fc);
  V3.tin = null;   // 玩家自己动了镜头：过渡停下
  F.yawT += dyaw; F.pitchT = clamp(F.pitchT + dpitch, -1.52, 1.45);   // 可以抬头看到接近头顶（仰看飞过头顶的飞机）
  if (now) { F.yaw = F.yawT; F.pitch = F.pitchT; }
}
// 沿视线飞：fw 前后（沿视线方向，含高低）、rt 左右平移，按离地高度定速度
function v3Fly(fw, rt, dt) {
  V3.tin = null;
  const F = V3.fc || (v3FcInit(), V3.fc), alt = Math.max(1, F.z - v3Gnd(F.x, F.y)), sp = clamp(alt * 1.25, 50, 1100) * dt, cp = Math.cos(F.pitch);
  F.x += (Math.cos(F.yaw) * cp * fw - Math.sin(F.yaw) * rt) * sp; F.y += (Math.sin(F.yaw) * cp * fw + Math.cos(F.yaw) * rt) * sp; F.z += Math.sin(F.pitch) * fw * sp;
}
// 升高 / 降低（k > 0 升高）：速度和前后飞一样按离地高度定，贴近地面时慢
function v3Rise(k, dt) {
  V3.tin = null;
  const F = V3.fc || (v3FcInit(), V3.fc), alt = Math.max(1, F.z - v3Gnd(F.x, F.y));
  F.z += k * clamp(alt * 1.25, 50, 1100) * dt;
}
// 推近 / 拉远：朝屏幕上 (sx, sy) 指着的地面点移动（k > 1 推近）
function v3Dolly(sx, sy, k) {
  V3.tin = null;
  const F = V3.fc || (v3FcInit(), V3.fc), P = v3Pick(sx, sy), pz = v3Gnd(P.x, P.y), dx = P.x - F.x, dy = P.y - F.y, dz = pz - F.z, d = Math.hypot(dx, dy, dz) || 1;
  let m = d * (1 - 1 / k);
  if (k > 1) m = Math.min(m, d - 6);   // 推近：停在离那一点 6 米外
  else m = Math.max(m, dz < 0 ? -Math.max(0, V3_ZMAX - F.z) / Math.max(.05, -dz / d) : -d * 3);   // 拉远：到了最高高度就停，不再贴着高度上限水平往后飘出地图
  F.x += dx / d * m; F.y += dy / d * m; F.z += dz / d * m;
}
// 镜头：画面中心（CAM.x, CAM.y）为目标点；距离按平面地图的缩放换算，使画面中心的比例与平面时相同（开始界面背景的环绕展示用）
function v3Camera() {
  if (typeof V3FP === 'object' && V3FP.on) return v3fpCamera();   // 第一人称驾驶（v3pilot.js）
  if (typeof V3O === 'object' && V3O.on) return v3oCamera();   // 观察者模式（v3obs.js）
  if (V3.on) return v3FcCamera();   // 自由镜头
  const th = V3.tilt, ps = V3.yaw, D = (CAM.vh / CAM.z) / (2 * Math.tan(V3_FOV / 2)) * (V3.dk || 1), o = V3.tofs || [0, 0];
  const T = [CAM.x + o[0], -(CAM.y + o[1]), V3.tz ?? v3Ht(CAM.x, CAM.y)];   // 注视点高度按帧平滑跟随地形 / 航母甲板（v3TzStep），翻过山头、掠过航母时镜头不突然冒高
  const E = [T[0] + D * Math.sin(th) * Math.sin(ps), T[1] - D * Math.sin(th) * Math.cos(ps), T[2] + D * Math.cos(th)];
  { const g = v3Ht(clamp(E[0], 0, W - 1), clamp(-E[1], 0, H - 1)); if (E[2] < g + 8) E[2] = g + 8; }   // 平视时镜头不钻进身后的山里
  const z = v3Norm(v3Sub(E, T)), x = v3Norm(v3Cross([-Math.sin(ps), Math.cos(ps), 0], z)), y = v3Cross(z, x);
  const view = new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -v3Dot(x, E), -v3Dot(y, E), -v3Dot(z, E), 1]);
  const asp = CAM.vw / Math.max(1, CAM.vh), f = 1 / Math.tan(V3_FOV / 2), n = D * .03, fa = D * 9, nf = 1 / (n - fa);
  const proj = new Float32Array([f / asp, 0, 0, 0, 0, f, 0, 0, 0, 0, (fa + n) * nf, -1, 0, 0, 2 * fa * n * nf, 0]);
  return (V3.cam = { E, x, y, z, D, rd: 1, fog: [D * 1.3, D * 2.8], asp, M: v3Mul(proj, view) });
}
// 注视点高度：画面中心脚下的地形包络（比实际地形平缓）与航母飞行甲板取高者，按真实时间平滑过去（时间常数约 0.35 秒）
function v3TzStep(dt) {
  const cz = typeof cvCamZ === 'function' ? cvCamZ(CAM.x, CAM.y) : null, g = V3.env ? v3Env(CAM.x, CAM.y) : v3Ht(CAM.x, CAM.y), want = Math.max(g, cz ?? -99);
  if (V3.tz == null || !isFinite(V3.tz)) V3.tz = want;
  else V3.tz += (want - V3.tz) * (1 - Math.exp(-dt / .35));
}
// 按住 Q / E 降低 / 升高镜头（Shift 加速），R / F 连续俯仰；转向用右键 / 中键拖动或 < >
function v3HoldStep(dt) {
  const K = V3.hold;
  if (!K || !K.size || !V3.on) return;
  const up = (K.has('KeyE') ? 1 : 0) - (K.has('KeyQ') ? 1 : 0), pt = (K.has('KeyR') ? 1 : 0) - (K.has('KeyF') ? 1 : 0);
  if (up) v3Rise(up, dt * (typeof KEYS === 'object' && KEYS.has('Shift') ? 3 : 1));
  if (pt) v3Look(0, pt * dt, true);   // R 抬头、F 低头
}
// 屏幕点 → 视线 → 与地形求交（先粗步进，再二分）；打不到地面时取视线与海平面的交点
function v3Ray(sx, sy) {
  const C = V3.cam || v3Camera(), tf = Math.tan(V3_FOV / 2), nx = (sx / CAM.vw * 2 - 1) * tf * C.asp, ny = (1 - sy / CAM.vh * 2) * tf;
  return { o: C.E, d: v3Norm([-C.z[0] + C.x[0] * nx + C.y[0] * ny, -C.z[1] + C.x[1] * nx + C.y[1] * ny, -C.z[2] + C.x[2] * nx + C.y[2] * ny]), C };
}
function v3Pick(sx, sy) {
  const { o, d, C } = v3Ray(sx, sy), above = t => o[2] + d[2] * t - v3Ht(o[0] + d[0] * t, -(o[1] + d[1] * t));
  const tMax = C.D * 8, stp = C.D / 80;
  let t0 = 0, t = stp, hit = false;
  for (; t < tMax; t += stp) { if (above(t) <= 0) { hit = true; break; } t0 = t; }
  if (hit) { for (let k = 0; k < 10; k++) { const m = (t0 + t) / 2; if (above(m) > 0) t0 = m; else t = m; } }
  else t = d[2] < -1e-4 ? -o[2] / d[2] : tMax;
  return { x: o[0] + d[0] * t, y: -(o[1] + d[1] * t) };
}
// 俯视贴图要覆盖的地面范围：画面四角、四边中点的视线落点（最远 2.6 倍镜头距离），外扩一点，夹在地图内
// lim：视线最远取到几倍的镜头尺度（2.6 = 一直到地平线的雾里；近处的高清贴图取 1.15）
const V3_SKY = 700;   // 最高的飞行高度（战术弹道导弹弹道顶点附近）
function v3Box(lim = 2.6) {
  const C = V3.cam, pts = [];
  for (const [sx, sy] of [[0, 0], [CAM.vw / 2, 0], [CAM.vw, 0], [0, CAM.vh / 2], [CAM.vw, CAM.vh / 2], [0, CAM.vh], [CAM.vw / 2, CAM.vh], [CAM.vw, CAM.vh]]) {
    const { o, d } = v3Ray(sx, sy);
    let t = d[2] < -1e-4 ? (V3_HZ * .3 - o[2]) / d[2] : d[2] > 1e-4 ? (V3_SKY - o[2]) / d[2] : C.D * lim;   // 往上看的视线：飞机、导弹只会在它穿过最高飞行高度之前出现
    t = Math.min(Math.max(t, 0), C.D * lim);   // 再远的地方已经暗下去了（雾），用底图
    pts.push([o[0] + d[0] * t, -(o[1] + d[1] * t)]);
  }
  pts.push([C.E[0], -C.E[1]]);   // 镜头脚下：仰看时头顶的飞机就在这附近（原来只按视线远处的落点圈范围，正下方往上看时飞机被当成在范围外不画）
  const m = 60, x0 = clamp(Math.min(...pts.map(p => p[0])) - m, 0, W), x1 = clamp(Math.max(...pts.map(p => p[0])) + m, 0, W);
  const y0 = clamp(Math.min(...pts.map(p => p[1])) - m, 0, H), y1 = clamp(Math.max(...pts.map(p => p[1])) + m, 0, H);
  return [x0, y0, Math.max(20, x1 - x0), Math.max(20, y1 - y0)];
}

// 每帧（render.js draw 调用）：屏外按俯视画战场 → 贴到地形网格上 → 画回主画布
function v3Draw(now) {
  if (!V3.tried) v3Init();
  if (!V3.ok) { V3.on = false; return false; }
  const gl = V3.gl;
  if (V3.seed !== TER.seed || (typeof trxSig === 'function' && (V3.chk = (V3.chk || 0) - 1) <= 0 && (V3.chk = 60) && trxSig() !== V3.sig)) v3Mesh();
  else if (typeof afb3dSig === 'function' && (V3.achk = (V3.achk || 0) - 1) <= 0 && (V3.achk = 30) && afb3dSig() !== V3.asig) v3Bld();   // 机场刚被发现 / 夺取
  // 转向 / 俯仰缓动；注视点高度平滑
  const fdt = clamp((now - (V3.lastNow || now)) / 1000, 0, .1); V3.lastNow = now;
  if (typeof V3FP === 'object' && V3FP.on) v3fpStep(now);
  else if (typeof V3O === 'object' && V3O.on) v3oStep(now);
  else if (V3.on) { v3HoldStep(fdt); v3FcStep(fdt); }   // 自由镜头
  else { v3TzStep(fdt); V3.yaw += Math.atan2(Math.sin(V3.yawT - V3.yaw), Math.cos(V3.yawT - V3.yaw)) * .18; V3.tilt += (V3.tiltT - V3.tilt) * .18; }   // 开始界面背景的环绕展示
  const C = v3Camera(), box = V3.box = v3Box(Math.max(2.6, v3FogE(C) * .93 / C.D)), boxN = v3Box(1.15);   // 远处贴图（与立体模型）铺到能见距离
  if (V3.baseReal !== (typeof realLook === 'function' && realLook() && !v3Mx())) v3BaseTex();   // 切换了画面风格：底图跟着换
  // 俯视贴图：近处一张高清（每帧画），整个可见范围一张低清（每 3 帧画一次）；近处已经盖住大半个可见范围（俯看时）就只画一张
  const cap = Math.min(V3.maxTex, R.lowCap || (SETTINGS && SETTINGS.quality === 'low') ? 1280 : V3.coarse ? 1600 : 2048, Math.max(1024, Math.max(R.cv.width, R.cv.height) * 1.3));   // 屏外俯视画布最长边（按屏幕大小，手机、低画质更小）
  // 跟不上（主循环帧间隔滑动平均超过 40ms）就把屏外画布逐步缩小，最低 45%；流畅后再慢慢放大
  if (typeof ema === 'number') V3.capK = clamp((V3.capK || 1) * (ema > .04 ? .985 : ema < .022 ? 1.004 : 1), .45, 1);
  const dpr = R.dpr || 1, one = boxN[2] * boxN[3] > box[2] * box[3] * .7;
  const bN = one ? box : boxN, sTop = Math.min(CAM.z * dpr, cap * (V3.capK || 1) / Math.max(bN[2], bN[3]));
  const K = { cv: R.cv, ctx: R.ctx, s: R.s, ox: R.ox, oy: R.oy, dpr: R.dpr, vw: CAM.vw, vh: CAM.vh, z: CAM.z, x: CAM.x, y: CAM.y };
  // 有立体模型的东西（飞机、车辆、舰船、阵地，近看时的步兵）贴图里不再画平面图标——否则地面上多一层「倒影」
  //   画布边长取最接近的 2 的幂（上传后生成多级渐远纹理）：比例按装得下整个范围取，多出来的一边把范围往两边放宽；返回实际铺的范围
  const pot = n => 2 ** clamp(Math.round(Math.log2(Math.max(64, n))), 6, 12);
  const paint = (cv, b0, sc0) => {
    const tw = pot(b0[2] * sc0), th = pot(b0[3] * sc0), sc = Math.min(tw / b0[2], th / b0[3]), bw = tw / sc, bh = th / sc;
    const b = [b0[0] + b0[2] / 2 - bw / 2, b0[1] + b0[3] / 2 - bh / 2, bw, bh];
    if (cv.width !== tw || cv.height !== th) { cv.width = tw; cv.height = th; }
    V3.drawing = true;
    R.fx3d = typeof v3Fx === 'function' && !(SETTINGS && SETTINGS.models3d === false);   // 弹道在 3D 里立体画（v3fx.js），贴图里不再画
    R.m3d = R.fx3d && typeof V3M === 'object' && !!V3M.ok; R.m3dNear = true;   // 士兵远近都是立体模型（远处低模，v3units.js），贴图里不再画平的小人
    try {
      R.cv = cv; R.ctx = cv.getContext('2d'); R.dpr = 1;
      CAM.vw = tw; CAM.vh = th; CAM.z = R.s = sc; CAM.x = b[0] + b[2] / 2; CAM.y = b[1] + b[3] / 2;
      R.ox = -b[0] * sc; R.oy = -b[1] * sc;
      drawScene(now);
    } finally {
      V3.drawing = false; R.fx3d = false; R.m3d = false;
      Object.assign(R, { cv: K.cv, ctx: K.ctx, s: K.s, ox: K.ox, oy: K.oy, dpr: K.dpr });
      Object.assign(CAM, { vw: K.vw, vh: K.vh, z: K.z, x: K.x, y: K.y });
    }
    return b;
  };
  // 近处这张隔一帧画一次（范围移动超过边长 3%、缩放变了、换了大小时马上重画）：屏外 2D 画布画好再传成贴图，
  //   在 Mac 的 Safari 上每张都要从显卡读回再上传，是 3D 每帧最贵的一步；地面上的东西（弹坑、烟、标号）变化慢，隔一帧看不出来
  const nb = V3.nBox, nMove = !nb || nb[4] !== sTop || Math.abs(nb[0] - bN[0]) + Math.abs(nb[1] - bN[1]) > bN[2] * .03 || Math.abs(nb[2] - bN[2]) > bN[2] * .03;
  V3.nT = (V3.nT || 0) + 1;
  if (nMove || V3.nT % 2 === 0) { V3.boxN = paint(V3.top, bN, sTop); V3.nBox = [bN[0], bN[1], bN[2], bN[3], sTop]; V3.nNew = true; }
  if (!one && (!V3.boxB || (V3.fT = (V3.fT || 0) + 1) % 4 === 0 || Math.abs(V3.boxB[0] - box[0]) + Math.abs(V3.boxB[1] - box[1]) > box[2] * .12)) {
    V3.boxF = paint(V3.topF, box, Math.min(sTop, cap * (V3.capK || 1) / Math.max(box[2], box[3])));   // 远处这张也按整幅分辨率画（原来只有六成，远景糊）
    V3.boxB = box.slice(); V3.fNew = true;
  }
  if (one) { V3.boxF = [0, 0, 0, 0]; V3.boxB = null; }
  // 这一帧的兵种、地图物件实例先收集好，太阳阴影图与正常画面各画一遍
  const m3 = !(SETTINGS && SETTINGS.models3d === false);
  if (m3 && typeof v3mCollect === 'function') v3mCollect(C, box);
  const pOn = typeof v3pPrep === 'function' && v3pPrep(C);
  v3ShPass(C);
  // 3D 网格
  const W0 = R.cv.width, H0 = R.cv.height;
  if (V3.cv.width !== W0 || V3.cv.height !== H0) { V3.cv.width = W0; V3.cv.height = H0; }
  gl.viewport(0, 0, W0, H0);
  gl.useProgram(V3.pr);
  if (V3.nNew !== false) { v3Upload(0, V3.tex, V3.top, gl.RGB); V3.nNew = false; }   // 这一帧没重画就不重传（只重新绑上：别的模块用过 0 号单元）
  else { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, V3.tex); }
  if (V3.fNew) { v3Upload(7, V3.texF, V3.topF, gl.RGB); V3.fNew = false; }
  gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D, V3.texF);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, V3.base);
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, V3.cls);
  gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, V3.cls2);
  gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, V3.ht);
  gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, V3.fog);
  if (typeof FOGB === 'object') gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, GW, GH, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, FOGB);   // 视野（drawScene 刚按当前观察视野算好）
  const lmOn = v3Mx() && typeof v3LightBind === 'function' && v3LightBind(gl) ? 1 : 0;   // 光照贴图（v3light.js，第 9 个贴图单元）：只给黑绿 / 数码画面；写实画面用实时阴影
  const bgc = v3Bg();
  gl.clearColor(bgc[0], bgc[1], bgc[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  if (!v3Mx()) v3Sky(C);   // 写实画面：先画天空（不写深度）
  gl.useProgram(V3.pr);
  const u = V3.u;
  gl.uniformMatrix4fv(u.uM, false, C.M);
  gl.uniform3f(u.uEye, C.E[0], C.E[1], C.E[2]);
  gl.uniform4f(u.uBox, V3.boxN[0], V3.boxN[1], V3.boxN[2], V3.boxN[3]); gl.uniform4f(u.uBoxF, V3.boxF[0], V3.boxF[1], V3.boxF[2] || 1, V3.boxF[3] || 1);
  gl.uniform2f(u.uWorld, W, H); gl.uniform2f(u.uGrid, GW, GH); gl.uniform2f(u.uHG, Math.max(1, V3.nx - 1), Math.max(1, V3.ny - 1));
  gl.uniform2f(u.uFog, ...v3FogR(C));
  gl.uniform1f(u.uSea, 1.5); gl.uniform3f(u.uBg, bgc[0], bgc[1], bgc[2]);
  const mx = v3Mx() ? 1 : 0, tm = (now / 1000) % 3600;   // 黑绿画面：黑客帝国式数码风
  gl.uniform1f(u.uDet, !mx && v3DetTex() ? 1 : 0);
  const skyT = !mx && V3.sky && V3.sky.ok && V3.cls3 ? V3.sky.tex : null;
  if (V3.cls3) { gl.activeTexture(gl.TEXTURE12); gl.bindTexture(gl.TEXTURE_2D, V3.cls3); }
  if (skyT) { gl.activeTexture(gl.TEXTURE13); gl.bindTexture(gl.TEXTURE_2D, skyT); }
  gl.uniform1f(u.uSkyOn, skyT ? 1 : 0); gl.uniform1f(u.uSkyU, V3_SKYU);
  gl.uniform1f(u.uWnOn, !mx && v3WaterTex() ? 1 : 0);
  gl.uniform1f(u.uOcn, !mx && V3.ocean ? 1 : 0);
  v3ShUni(gl, u, true);
  gl.uniform1f(u.uT, tm); gl.uniform1f(u.uMx, mx); gl.uniform1f(u.uLmOn, lmOn);
  const bm = typeof v3Booms === 'function' ? v3Booms() : null;   // 爆炸火光（v3light.js）
  if (bm && u.uBm) gl.uniform4fv(u.uBm, bm);
  gl.bindBuffer(gl.ARRAY_BUFFER, V3.buf); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, V3.ib);
  gl.enableVertexAttribArray(V3.a.p); gl.vertexAttribPointer(V3.a.p, 3, gl.FLOAT, false, 24, 0);
  gl.enableVertexAttribArray(V3.a.n); gl.vertexAttribPointer(V3.a.n, 3, gl.FLOAT, false, 24, 12);
  gl.drawElements(gl.TRIANGLES, V3.n, V3.it || gl.UNSIGNED_SHORT, 0);
  if (!mx) v3OceanDraw(C);   // 地图外的海（海岛：三面无边大洋 + 北面延伸的岛）
  if (typeof v3Table === 'function') { gl.disableVertexAttribArray(V3.a.p); gl.disableVertexAttribArray(V3.a.n); v3Table(C); gl.useProgram(V3.pr); }   // 沙盘桌：边框、桌面（v3table.js）
  if (V3.bn && V3.pb && V3.bch) {   // 城镇房屋、机场建筑、树木（分块的静态缓冲区）
    const ub = V3.ub, ab = V3.ab;
    gl.useProgram(V3.pb);
    gl.uniformMatrix4fv(ub.uM, false, C.M); gl.uniform3f(ub.uEye, C.E[0], C.E[1], C.E[2]);
    gl.uniform4f(ub.uBox, V3.boxN[0], V3.boxN[1], V3.boxN[2], V3.boxN[3]); gl.uniform4f(ub.uBoxF, V3.boxF[0], V3.boxF[1], V3.boxF[2] || 1, V3.boxF[3] || 1); gl.uniform2f(ub.uWorld, W, H); gl.uniform2f(ub.uFog, ...v3FogR(C));
    gl.uniform1f(ub.uT, tm); gl.uniform1f(ub.uMx, mx); gl.uniform3f(ub.uBg, bgc[0], bgc[1], bgc[2]); v3ShUni(gl, ub, true); gl.uniform1f(ub.uLmOn, lmOn);
    if (bm && ub.uBm) gl.uniform4fv(ub.uBm, bm);
    gl.disableVertexAttribArray(V3.a.p); gl.disableVertexAttribArray(V3.a.n);
    gl.enableVertexAttribArray(ab.p); gl.enableVertexAttribArray(ab.n); gl.enableVertexAttribArray(ab.e);
    const fe = v3FogE(C), ex = C.E[0], ey = -C.E[1], ez = Math.max(0, C.E[2] - 120), rk = v3RD() * CAM.vh / 768, ft = Math.min(fe * .6, 4500 * rk), fb = Math.min(fe, 9000 * rk);   // ez：镜头比地面高出多少（拉得很高时树、房屋也算远）
    for (const c of V3.bch) {
      // 整块在雾外不画；树（约 10 高）只画屏幕上两个像素以上的近处，房屋九千以内——远处的林地、村镇由地面贴图表现（大地图上全图的树有几百万个三角形）
      if (c.bb && Math.hypot(Math.max(c.bb[0] - ex, 0, ex - c.bb[2]), Math.max(c.bb[1] - ey, 0, ey - c.bb[3]), ez) > (c.tree ? ft : fb)) continue;
      gl.bindBuffer(gl.ARRAY_BUFFER, c.b); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, c.i);
      gl.vertexAttribPointer(ab.p, 3, gl.FLOAT, false, 32, 0); gl.vertexAttribPointer(ab.n, 3, gl.FLOAT, false, 32, 12); gl.vertexAttribPointer(ab.e, 2, gl.FLOAT, false, 32, 24);
      gl.drawElements(gl.TRIANGLES, c.n, gl.UNSIGNED_SHORT, 0);
    }
    gl.disableVertexAttribArray(ab.p); gl.disableVertexAttribArray(ab.n); gl.disableVertexAttribArray(ab.e);
  }
  if (pOn) { gl.disableVertexAttribArray(V3.a.p); gl.disableVertexAttribArray(V3.a.n); v3pDraw(C); }   // 地图物件：树木、岩石、楼房、机场设施（v3props.js，免费资源模型）
  if (m3 && typeof v3mDraw === 'function') { gl.disableVertexAttribArray(V3.a.p); gl.disableVertexAttribArray(V3.a.n); v3mDraw(C); }   // 兵种立体模型（v3units.js）
  if (m3 && typeof v3dkDraw === 'function') v3dkDraw(C);   // 福建舰飞行甲板：纹路与光影（v3deck.js）
  if (typeof v3Fx === 'function' && !(SETTINGS && SETTINGS.models3d === false)) { gl.disableVertexAttribArray(V3.a.p); gl.disableVertexAttribArray(V3.a.n); v3Fx(C); }   // 立体弹道（v3fx.js）
  if (typeof v3Post === 'function') { gl.disableVertexAttribArray(V3.a.p); gl.disableVertexAttribArray(V3.a.n); v3Post(now); }   // 辉光、景深、暗角（v3post.js）
  const ctx = R.ctx;
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = 'copy'; ctx.drawImage(V3.cv, 0, 0); ctx.restore();
  v3Overlay(ctx, now / 1000);
  return true;
}

// 世界坐标（含高度）→ 屏幕（CSS 像素）；在镜头背后返回 null。f：按距离的雾（0 清楚 … 1 看不见）
function v3Proj(x, y, z) {
  const M = V3.cam.M, X = x, Y = -y, cw = M[3] * X + M[7] * Y + M[11] * z + M[15];
  if (cw <= 1e-3) return null;
  const cx = M[0] * X + M[4] * Y + M[8] * z + M[12], cy = M[1] * X + M[5] * Y + M[9] * z + M[13], E = V3.cam.E;
  const [f0, f1] = v3FogR(V3.cam), f = smooth(f0, f1, Math.hypot(X - E[0], Y - E[1], z - E[2]));
  return { x: (cx / cw + 1) / 2 * CAM.vw, y: (1 - cy / cw) / 2 * CAM.vh, f };
}
// 立在地形上方的标识（屏幕空间，不随透视变形）：据点旗杆与菱形、战斗群北约标号、飞机按高度悬空并向地面引垂线
function v3Overlay(ctx, time) {
  ctx.save(); ctx.setTransform(R.dpr, 0, 0, R.dpr, 0, 0);
  // 坐在飞机座舱里（v3pilot.js）：地名、方格号、番号牌会透过仪表板画在上面——只画平显
  if (typeof V3FP === 'object' && V3FP.on && V3FP.k === 'air' && V3FP.vw === 'cock') { if (typeof v3fpOverlay === 'function') v3fpOverlay(ctx); ctx.restore(); return; }
  ctx.lineCap = 'round'; ctx.font = '11px "IBM Plex Mono", "Noto Sans SC", monospace'; ctx.textAlign = 'center';
  const near = CAM.z / CAM.fit > 2.2, spec = specAll() || R.eye === 'all', used = [];
  if (typeof v3TableMarks === 'function') v3TableMarks(ctx);   // 沙盘桌边框上的方格坐标
  // 名称标签：和已画的标签重叠就不画（近处的先画，远处的让位）
  const label = (t, x, y, col, al) => {
    const w = ctx.measureText(t).width + 4, r = [x - w / 2, y - 11, x + w / 2, y + 2];
    if (used.some(o => r[0] < o[2] && r[2] > o[0] && r[1] < o[3] && r[3] > o[1])) return;
    used.push(r); ctx.fillStyle = rgba(col, al); ctx.fillText(t, x, y);
  };
  const stem = (x, y, hgt, col, a) => {
    const g = v3Ht(x, y), p0 = v3Proj(x, y, g), p1 = v3Proj(x, y, g + hgt);
    if (!p0 || !p1 || p1.f > .97) return null;
    const al = a * (1 - p1.f);
    ctx.strokeStyle = rgba(col, al * .55); ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = rgba(col, al * .8); ctx.beginPath(); ctx.arc(p0.x, p0.y, 1.6, 0, 7); ctx.fill();
    return { ...p1, al };
  };
  // 据点（离镜头近的先画，名称优先）
  const C = V3.cam, byNear = (a, b) => dist(a.x, -a.y, C.E[0], C.E[1]) - dist(b.x, -b.y, C.E[0], C.E[1]);
  for (const p of S.points.slice().sort(byNear)) {
    const col = p.owner === 'p' ? COL.g : COL.enemy, q = stem(p.x, p.y, 34 + (p.vp || 1) * 8, col, .9);
    if (!q) continue;
    const r = 4 + (p.vp || 1);
    ctx.fillStyle = rgba(COL.bg, .75 * q.al); ctx.strokeStyle = rgba(col, q.al); ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(q.x, q.y - r); ctx.lineTo(q.x + r, q.y); ctx.lineTo(q.x, q.y + r); ctx.lineTo(q.x - r, q.y); ctx.closePath(); ctx.fill(); ctx.stroke();
    if (p.owner === 'e' && p.prog > 0) { ctx.fillStyle = rgba(COL.g, q.al); ctx.fillRect(q.x - r, q.y + r + 2, r * 2 * p.prog, 2); }
    if (q.f < .6) label(p.name, q.x, q.y - r - 4, COL.text, q.al * .85);   // 地名（通联里说的据点名）一直标着，压住了就让近处的
  }
  // 海滩名（海面上）、方格号（近看时贴在地面每格左上角，与通联里的「D7 方格」对应）
  for (const b of TER.beaches) { const q = v3Proj(b.cx, coastAt(b.cx) + 70, 0); if (q && q.f < .7) label(b.name, q.x, q.y, COL.amber, .75 * (1 - q.f)); }
  if (near) {
    const gx0 = Math.floor(CAM.x / 200), gy0 = Math.floor(CAM.y / 200);
    for (let gx = gx0 - 3; gx <= gx0 + 3; gx++) for (let gy = gy0 - 3; gy <= gy0 + 3; gy++) {
      if (gx < 0 || gy < 0 || gx * 200 >= W || gy * 200 >= H) continue;
      const x = gx * 200 + 14, y = gy * 200 + 16, q = v3Proj(x, y, v3Ht(x, y));
      if (q && q.f < .5) label(gridRef(x, y), q.x, q.y, COL.g, .45 * (1 - q.f));
    }
  }
  // 战斗群（编制标号）
  for (const G of S.bgs || []) {
    if (G.dead) continue;
    const c = bgAt(G);   // 部队实际所在处（不是队形锚点）
    if (G.side === 'e' && !spec && !spotted(c.x, c.y)) continue;
    if ((G.th || G.thx) && typeof thMarks3 === 'function' && typeof thOn === 'function' && thOn()) continue;   // 战区编队的营、连由番号牌标（thpanel.js thMarks3）
    const col = G.side === 'p' ? COL.g : COL.enemy, q = stem(c.x, c.y, 70, col, 1);
    if (!q) continue;
    const w = 20, h = 13;
    ctx.fillStyle = rgba(COL.bg, .8 * q.al); ctx.strokeStyle = rgba(col, q.al); ctx.lineWidth = 1.3;
    ctx.fillRect(q.x - w / 2, q.y - h / 2, w, h); ctx.strokeRect(q.x - w / 2, q.y - h / 2, w, h);
    ctx.beginPath(); ctx.moveTo(q.x - w / 2, q.y + h / 2); ctx.lineTo(q.x + w / 2, q.y - h / 2); ctx.moveTo(q.x - w / 2, q.y - h / 2); ctx.lineTo(q.x + w / 2, q.y + h / 2); ctx.stroke();
    ctx.fillStyle = rgba(col, q.al); ctx.fillText(G.ech || 'X', q.x, q.y - h / 2 - 3);
    if (near && q.f < .6) label(G.name, q.x, q.y + h / 2 + 11, COL.text, q.al * .85);
  }
  // 飞机：离地高度按 alt（0–1）放大，机头朝向按投影
  const air = (o, col) => {
    if (typeof V3M === 'object' && V3M.ok && !(SETTINGS && SETTINGS.models3d === false)) return;   // 立体模型已经画了飞机：不再画到地面的垂线（看着假）
    const x = o.x, y = o.y, hd = o.heading || 0, Z = v3AirZ(o), g = v3Ht(x, y), z = Z - g, q = stem(x, y, z, col, .9);
    if (!q) return;
    const p2 = v3Proj(x + Math.cos(hd) * 12, y + Math.sin(hd) * 12, Z);
    const a = p2 ? Math.atan2(p2.y - q.y, p2.x - q.x) : 0;
    ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(a);
    ctx.fillStyle = rgba(col, q.al); ctx.beginPath(); ctx.moveTo(7, 0); ctx.lineTo(-5, -4.5); ctx.lineTo(-2.5, 0); ctx.lineTo(-5, 4.5); ctx.closePath(); ctx.fill();
    ctx.restore();
  };
  for (const p of S.planes || []) if (!p.dead && isFinite(p.x) && p.phase !== 'cat' && p.phase !== 'roll' && p.phase !== 'trap') air(p, COL.g);   // 甲板上的不画垂线
  if (S.eair) for (const a of S.eair.fly) if (!a.dead && (spec || a.pv) && isFinite(a.x) && a.ph !== 'roll' && a.ph !== 'gnd') air(a, COL.enemy);
  if (typeof sfx3 === 'function') sfx3(ctx);   // 选中编队的成员：脚下光圈、血量、结构值（selfx.js）
  if (typeof hqMarks3 === 'function') hqMarks3(ctx, stem);   // 团标：立在团的上空（hq.js）
  if (typeof thMarks3 === 'function') thMarks3(ctx, stem);   // 营标：战区编队的番号牌立在每个营（连）头顶（thpanel.js）
  if (typeof shOverlay3D === 'function') shOverlay3D(ctx, (x, y, h) => v3Proj(x, y, v3Ht(x, y) + h));   // 士兵喊话气泡（shout.js）
  if (typeof v3oOverlay === 'function') v3oOverlay(ctx);   // 观察者模式的准星
  if (typeof v3fpOverlay === 'function') v3fpOverlay(ctx);   // 第一人称驾驶的平显
  ctx.restore();
}

// —— 开关与操作 ——
const v3Can = () => !!S && !(typeof INTRO === 'object' && INTRO.on);   // 部署、沙盒编辑、开战后都能开 3D
// 开始界面背景：电脑上（非低画质）用 3D 地形缓慢转动展示
function v3Att() {
  if (!(typeof MENU === 'object' && MENU.open && !MENU.game) || V3.ok === false && V3.tried || R.lowCap || (typeof SETTINGS === 'object' && SETTINGS.quality === 'low')) return false;
  if (V3.coarse == null) V3.coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  if (V3.coarse) return false;
  V3.yaw = V3.yawT = (MENU.drift || 0) * .5; V3.tilt = V3.tiltT = .98;
  // 拉远看整张沙盘桌，注视点往镜头左边挪，桌子落在菜单右边的空处
  V3.dk = 1.32; V3.tofs = [-Math.cos(V3.yaw) * 2900, Math.sin(V3.yaw) * 2900];
  return true;
}
// user：玩家自己按的（按钮、Shift + L）——记住选择，下一局照此默认
function v3Toggle(on = !V3.on, user = false) {
  if (on && !v3Can()) return;
  if (on && !V3.tried) v3Init();
  const was = V3.on;
  V3.on = on && V3.ok;
  if (V3.on && !was) { v3FcInit(); V3.tin = { t: 0 }; }   // 进 3D：自由镜头从平面地图当前的画面接着看，从俯视慢慢压低成透视
  if (user && typeof setSetting === 'function') setSetting('v3', V3.on);
  const b = typeof $ === 'function' && $('btn3d'), c = typeof $ === 'function' && $('v3ctl');
  if (b) { b.classList.toggle('on', V3.on); b.setAttribute('aria-pressed', V3.on ? 'true' : 'false'); }
  if (c) c.hidden = !V3.on;
  if (!V3.on && typeof trxResize === 'function' && TRX.ok) trxResize();
  if (typeof log === 'function' && S && S.t != null) log(V3.on ? '3D 自由镜头：中键 / 右键拖动转头，R F 抬头低头，Q E 降低 / 升高，W S 沿视线飞、A D 平移，滚轮朝鼠标处推拉，左键拖动平移，O 观察者模式' : '平面地图', 'info', 'v3', 1);
}
const v3Turn = k => { if (V3.on) v3Look(k * Math.PI / 8, 0); else V3.yawT += k * Math.PI / 8; };
const v3Tilt = k => { if (V3.on) v3Look(0, -k * .12); else V3.tiltT = clamp(V3.tiltT + k * .12, V3_TILT[0], V3_TILT[1]); };

// 平移：拖动的屏幕方向换算到地面（地面跟着手走），镜头高度、朝向不变
function v3Pan(dx, dy) {
  const F = V3.fc || (v3FcInit(), V3.fc), k = Math.max(30, F.d || 600) * 2 * Math.tan(V3_FOV / 2) / Math.max(1, CAM.vh), c = Math.cos(F.yaw), s = Math.sin(F.yaw), down = Math.max(.35, -Math.sin(F.pitch));
  F.x -= (-s * dx) * k - (c * dy) * k / down; F.y -= (c * dx) * k - (s * dy) * k / down;
}

// 输入：中键（或 Ctrl + 左键）拖动 → 横向转向、纵向俯仰；双指旋转 → 转向
// 右键拖动（编队指挥模式里右键不再下命令）：同样转视角；只点一下不拖，照旧是取消（穿插选目标 / 选择）
HOOK.pointer.push((e, kind) => {
  if (!V3.on || (typeof V3O === 'object' && V3O.on) || (typeof V3FP === 'object' && V3FP.on)) return false;
  const { sx, sy } = evPos(e), rDrag = e.button === 2 && typeof thuActive === 'function' && thuActive();
  if (kind === 'down' && (e.button === 1 || (e.button === 0 && e.ctrlKey) || rDrag)) { V3.orb = { sx, sy, x0: sx, y0: sy, id: e.pointerId, r: rDrag, moved: false }; return true; }
  if (V3.orb && V3.orb.id === e.pointerId) {
    if (kind === 'move') {
      if (!V3.orb.moved && Math.hypot(sx - V3.orb.x0, sy - V3.orb.y0) < 4) return true;
      V3.orb.moved = true;
      v3Look((sx - V3.orb.sx) * .005, -(sy - V3.orb.sy) * .005, true); V3.orb.sx = sx; V3.orb.sy = sy; return true;   // 原地转头：往右拖看右边、往上拖抬头
    }
    if (kind === 'up') { const o = V3.orb; V3.orb = null; if (o.r && !o.moved && typeof thuCancel === 'function') thuCancel(); return true; }
  }
  return false;
});
if (typeof window === 'object' && window.addEventListener) {
  const hk = { KeyQ: 1, KeyE: 1, KeyR: 1, KeyF: 1 };
  window.addEventListener('keyup', e => { if (V3.hold) V3.hold.delete(e.code); });
  window.addEventListener('blur', () => { if (V3.hold) V3.hold.clear(); });
  HOOK.key.push(e => {   // 3D：按住 Q / E 降低 / 升高（Q E 原来的冲锋、增援线快捷键只在平面地图里用）；编队指挥模式里按住 R / F 连续俯仰
    if (!V3.on || !hk[e.code] || (typeof V3O === 'object' && V3O.on) || e.ctrlKey || e.metaKey || e.altKey) return false;
    if ((e.code === 'KeyR' || e.code === 'KeyF') && !(typeof thuActive === 'function' && thuActive())) return false;
    (V3.hold || (V3.hold = new Set())).add(e.code);
    return true;
  });
}
HOOK.key.push(e => {
  const k = e.key;
  if ((k === 'l' || k === 'L') && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) { v3Toggle(!V3.on, true); return true; }   // 单按 L 是通讯面板（chat.js）
  if (!V3.on) return false;
  if (k === ',' || k === '<') { v3Turn(-1); return true; }
  if (k === '.' || k === '>') { v3Turn(1); return true; }
  if (k === ';') { v3Tilt(-1); return true; }
  if (k === "'") { v3Tilt(1); return true; }
  if ((k === '[' || k === ']') && typeof setSetting === 'function') {   // 渲染距离：每下 ±0.25 倍（0.5–4）
    const v = setSetting('rdist', Math.round((v3RD() + (k === ']' ? .25 : -.25)) * 4) / 4);
    if (typeof log === 'function') log(`3D 渲染距离 ${v.toFixed(2).replace(/0$/, '')}×${v >= 2.5 ? '（远景很多，慢的设备会掉帧）' : ''}`, 'info');
    return true;
  }
  return false;
});

// 默认 3D：进了对局（部署、沙盒、闯关、开战后）就自动打开，每局只开一次——玩家中途切回平面不再强开；低画质、显卡不支持时留在平面
HOOK.frame.push(() => {
  if (V3.on || !S || V3.auto === S || S.attract || !v3Can() || (typeof MENU === 'object' && MENU.open)) return;
  V3.auto = S;
  if (typeof SETTINGS === 'object' && (SETTINGS.v3 === false || SETTINGS.quality === 'low')) return;
  v3Toggle(true);
});

// 右上角按钮
function v3Button() {
  if (typeof document === 'undefined' || !document.getElementById('topr') || document.getElementById('btn3d')) return;
  const b = document.createElement('button');
  b.id = 'btn3d'; b.className = 'tb'; b.type = 'button'; b.textContent = '3D'; b.title = '3D 立体地图（Shift + L）'; b.setAttribute('aria-pressed', 'false');
  b.addEventListener('click', () => v3Toggle(!V3.on, true));
  const help = document.getElementById('btnHelp');
  help.parentNode.insertBefore(b, help);
  // 3D 时显示的转向 / 俯仰按钮（手机没有键盘、中键）
  const c = document.createElement('div');
  c.id = 'v3ctl'; c.className = 'ov box'; c.hidden = true; c.setAttribute('role', 'group'); c.setAttribute('aria-label', '3D 镜头');
  for (const [t, ti, f] of [['⟲', '向左转（<）', () => v3Turn(-1)], ['⟳', '向右转（>）', () => v3Turn(1)], ['⤒', '抬高视角、更俯视（;）', () => v3Tilt(-1)], ['⤓', '压低视角、更平视（\'）', () => v3Tilt(1)],
    ['▲', '升高镜头（按住 E）', () => v3Rise(1, .5)], ['▼', '降低镜头（按住 Q）', () => v3Rise(-1, .5)]]) {
    const k = document.createElement('button');
    k.type = 'button'; k.className = 'tb'; k.textContent = t; k.title = ti; k.setAttribute('aria-label', ti);
    k.addEventListener('click', f);
    c.appendChild(k);
  }
  document.getElementById('stage').appendChild(c);
  const st = document.createElement('style');
  st.textContent = '#btn3d.on { color: var(--bg); background: var(--g); border-color: var(--g); }' +
    '#v3ctl { top: calc(58px + env(safe-area-inset-top, 0px)); right: max(16px, env(safe-area-inset-right, 0px)); display: flex; gap: 4px; padding: 4px; }' +
    '#v3ctl[hidden] { display: none; } #v3ctl .tb { min-width: 34px; font-size: 16px; }' +
    '@media (max-height: 520px) { #v3ctl { top: calc(44px + env(safe-area-inset-top, 0px)); right: max(8px, env(safe-area-inset-right, 0px)); } #v3ctl .tb { height: 28px; min-width: 30px; } }';
  document.head.appendChild(st);
}
if (typeof document !== 'undefined') { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', v3Button); else setTimeout(v3Button, 0); }
