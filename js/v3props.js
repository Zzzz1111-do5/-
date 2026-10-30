'use strict';
// 3D 地图物件：免费可商用的写实模型（tools/mdl/tbuild.mjs 转换成 assets/models/<包>.bin + 贴图；作者与授权在 V3P_PACKS，设置面板「素材致谢」里列出）
// · 树木（云杉、松、桦、落叶松）、灌木、草丛、岩石按地形格子种（森林、丘陵、山地、沼泽、田边、礁石海岸），悬崖海岸摆崖壁；
// · 城镇：每个房屋格按占地挑最合适的模型（坡顶民房、平顶水泥楼），正面朝向街道；
// · 机场：维修机库、直升机库换成拱顶机库，库房、营房换成半圆铁皮营房，塔台换成塔台模型；
// 没载入好（或设置「外部精细模型」关掉）时仍画原来自己生成的几何体（view3d.js v3Bld / v3Trees），载入好后由 v3Bld 跳过被替换的部分
// 绘制：树离镜头 V3P_NEAR 米内每帧挑出来按模型实例化画完整模型（树冠随风轻摆）；更远的树画「替身」——载入后把每种树从侧面、正上方
//   渲染进一张图集，用两片交叉的竖面片 + 一片横面片画（俯看时换成横片），一块地（300 米见方）一次画完；灌木、岩石只画近处；
//   楼房、机场设施数量少，全部常驻（每种模型一个静态实例缓冲区）
const V3P_PACKS = {
  treepack: { name: '树木、灌木、岩石', title: 'Low Poly Forest Tree Pack', author: '99.Miles', license: 'CC BY 4.0', url: 'https://sketchfab.com/3d-models/low-poly-forest-tree-pack-5ff5a51e74324845a4e4905f182dfb2b' },
  cliffs: { name: '海岸崖壁', title: 'Cliffs', author: 'DJMaesen', license: 'CC BY 4.0', url: 'https://sketchfab.com/3d-models/cliffs-14fe5023840146179c8515093e88fae0' },
  jph1: { name: '民房', title: 'Japanese Residential Home 01', author: 'Morrissey Alexander', license: 'CC BY 4.0', url: 'https://sketchfab.com/3d-models/japanese-residential-home-01-d690f83d8e8d48e6a532bebe84901595' },
  jph2: { name: '民房', title: 'Japanese Residential Home 02', author: 'Morrissey Alexander', license: 'CC BY 4.0', url: 'https://sketchfab.com/3d-models/japanese-residential-home-02-c31697f09152453cb3ed215482e7a810' },
  jph3: { name: '民房', title: 'Japanese Residential Home 03', author: 'Morrissey Alexander', license: 'CC BY 4.0', url: 'https://sketchfab.com/3d-models/japanese-residential-home-03-1c53f4f37fc44c32a8874464025aea48' },
  house: { name: '瓦房', title: 'House', author: 'SpatialNeglect', license: 'CC BY 4.0', url: 'https://sketchfab.com/3d-models/house-e70c4aebc911429ba9a894b38146892c' },
  oldconc: { name: '水泥楼', title: 'Old Concete Building Pack | Lowpoly', author: 'Frid.blend', license: 'CC BY 4.0', url: 'https://sketchfab.com/3d-models/old-concete-building-pack-lowpoly-6d070fcc86b0430dadf53da67545c6f3' },
  hangar: { name: '机库', title: 'j type hanger', author: 'ElectricL', license: 'CC BY 4.0', url: 'https://sketchfab.com/3d-models/j-type-hanger-d86713d61b4941378a6ad21569e0cbac' },
  atc: { name: '塔台', title: 'Air Traffic Control Tower', author: 'abass20', license: 'CC BY 4.0', url: 'https://sketchfab.com/3d-models/air-traffic-control-tower-84f215391662453680e646649d42b264' },
  quonset: { name: '铁皮营房', title: 'Military Style Building (with animations)', author: 'TampaJoey', license: 'CC BY 4.0', url: 'https://sketchfab.com/3d-models/military-style-building-with-animations-1671685e1dd94b6e9216ead632f08f6e' },
  firestation: { name: '消防站', title: 'Fire Station No. 1', author: 'CommonSpence', license: 'CC BY 4.0', url: 'https://sketchfab.com/3d-models/fire-station-no-1-87edf04deb28434993274d9f05070865' },
  wh3: { name: '库房', title: 'Pack - Realistic - 3 Warehouse', author: 'Islide', license: 'CC BY 4.0', url: 'https://sketchfab.com/3d-models/pack-realistic-3-warehouse-320c272513a94c0482dbb3c4e79d61f5' },
  sawtooth: { name: '厂房', title: 'Warehouse Building', author: 'OmegaRedZA', license: 'CC BY 4.0', url: 'https://sketchfab.com/3d-models/warehouse-building-0c37b0f92cb54e07a1e1c6c3df9f8439' },
  smallwh: { name: '小库房', title: 'Small Warehouse', author: 'Wardster', license: 'CC BY 4.0', url: 'https://sketchfab.com/3d-models/small-warehouse-c7f4c017c20943cb9e9e559822a5c402' },
  industrial: { name: '办公楼', title: 'industrial building', author: 'spicybamer', license: 'CC BY 4.0', url: 'https://sketchfab.com/3d-models/industrial-building-770acf6b0da74af397f748d95141f8be' },
  flats1: { name: '公寓楼', title: 'Davison Street Flats 1 - Flat Roof', author: 'Charlie_Zane', license: 'CC BY 4.0', url: 'https://sketchfab.com/3d-models/davison-street-flats-1-flat-roof-0f461ea81f8541db8d6a5f5e35133588' },
  wh99: { name: '砖砌库房', title: 'Warehouses', author: '99.Miles', license: 'CC BY 4.0', url: 'https://sketchfab.com/3d-models/warehouses-e6e105d35b3f486292c42ffa52f363c0' },
  girder: { name: '公路桥', title: 'Concrete Girder Beam Bridges/Tunnels [Free]', author: 'JoTrain The Aussie', license: 'CC BY 4.0', url: 'https://sketchfab.com/3d-models/concrete-girder-beam-bridgestunnels-free-1c5d6642796843c198b94124518b9f04' },
  pillbox: { name: '海滩地堡', title: 'WWII Pill Box - Saltney Quay, Flintshire, UK', author: 'al3xfoster', license: 'CC BY 4.0', url: 'https://sketchfab.com/3d-models/wwii-pill-box-saltney-quay-flintshire-uk-be8136976b294e1fb764b5b1cba7a72c' },
  teeth: { name: '龙牙', title: "Dragon's Teeth Anti-Tank obstacle", author: 'AdamKozakGrafika', license: 'CC BY 4.0', url: 'https://sketchfab.com/3d-models/dragons-teeth-anti-tank-obstacle-f7a6c987711d4ed2871707da47d2f3fb' },
  palms: { name: '棕榈树', title: 'Palm Trees', author: 'YadroGames', license: 'CC BY 4.0', url: 'https://sketchfab.com/3d-models/palm-trees-55690379305145488e20afb05fc687e6' },
  rocks3: { name: '岩石', title: 'Rocks Set 3', author: 'DJMaesen', license: 'CC BY 4.0', url: 'https://sketchfab.com/3d-models/rocks-set-3-9a160330d1c14268948248f387889b35' },
  sky: { name: '天空', title: 'Kloofendal 48d Partly Cloudy (Pure Sky)', author: 'Greg Zaal / Poly Haven', license: 'CC0', url: 'https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky' },
  terrain: { name: '地表贴图', title: 'Grass004、Ground037、Rock060、Ground054', author: 'ambientCG', license: 'CC0', url: 'https://ambientcg.com/' },
  water: { name: '水面法线', title: 'waternormals.jpg（three.js 示例）', author: 'three.js authors', license: 'MIT', url: 'https://github.com/mrdoob/three.js/blob/dev/examples/textures/waternormals.jpg' }
};
// 树种：针叶（山地、高处多）、阔叶（桦、落叶松）；h：模型原高（米，载入后按包围盒取）
const V3P_CON = ['bg0', 'bg2', 'bg3', 'bg5', 'bg6', 'bg7', 'treeA', 'treeB', 'treeC'], V3P_BRD = ['bg1', 'bg4', 'treeD'];
const V3P_BUSH = ['bush1', 'bush2', 'bush3', 'bush4'], V3P_ROCK = ['rock0', 'rock1', 'rock2', 'rock3', 'rock4', 'rock5', 'rock6', 'rock7', 'rock8'];
const V3P_TINT = { bg1: [.56, .84, .44], bg4: [.6, .86, .42], treeD: [.55, .82, .42] };   // 模型里的桦树、落叶松是秋天的黄叶：压成夏天的绿
const V3P_MUL = { girder: [.5, .5, .48], teeth: [.85, .85, .82] };   // 没贴图（纯白底色）的模型压成混凝土灰
// 楼房：rot 把模型的正面转到 +x（有的模型正面朝 +y）
const V3P_HOUSE = [['jph1', 'jph1', 0], ['jph2', 'jph2', -Math.PI / 2], ['jph3', 'jph3', -Math.PI / 2], ['house', 'house', 0]];
const V3P_FLAT = [['oldconc', 'conc1', 0], ['oldconc', 'conc2', 0], ['oldconc', 'conc3', 0]];
const V3P = { tried: false, ok: false, pr: null, a: {}, u: {}, packs: new Map(), sig: null, P: null, B: null, imp: null, ib: null, ibA: null, rep: new Set(), want: null };
const V3P_NEAR = () => (typeof V3 === 'object' && V3.coarse ? 170 : SETTINGS && SETTINGS.quality === 'low' ? 200 : 300) * clamp(Math.sqrt(typeof v3RD === 'function' ? v3RD() : 1), .8, 1.4);

// —— 着色器：带贴图、透明裁剪（树叶）、实例化；黑绿 / 写实两种画风；替身面片按俯角在竖片、横片之间过渡 ——
const V3P_VS = `attribute vec3 p; attribute vec3 n; attribute vec2 t; attribute vec3 b; attribute vec4 iA; attribute vec4 iB;
uniform mat4 uM; uniform vec3 uEye; uniform float uT, uSway, uImp, uNear;
uniform vec4 uImpF[16], uImpT[16], uImpX[16];
varying vec3 vN, vB, vV; varying vec2 vT; varying float vD, vSd, vK, vUp;
${typeof V3_SHV === 'string' ? V3_SHV : ''}
void main() {
  vec3 q; vec2 tt = t; float k = 0.;
  if (uImp > .5) {   // 替身：iB = (宽, 高, 变体序号, 随机数)；竖片 n.z = 0、横片 n.z = 1
    int vi = int(iB.z + .5);
    vec4 R = n.z > .5 ? uImpT[vi] : uImpF[vi], X = uImpX[vi];
    q = n.z > .5 ? vec3(p.xy * iB.x * X.y, X.x * iB.y) : vec3(p.xy * iB.x, p.z * iB.y);
    tt = R.xy + t * R.zw; k = n.z > .5 ? 2. : 1.;
    vec2 dh = iA.xy - uEye.xy;
    if (dot(dh, dh) < uNear * uNear) { gl_Position = vec4(2., 2., 2., 1.); return; }   // 这一棵在近处画完整模型
  } else {
    q = p * iB.xyz;
    if (uSway > 0.) { float h = max(q.z, 0.), s = uSway * h * h * .0008 * (sin(uT * 1.6 + iB.w * 40.) + .35 * sin(uT * 3.3 + iB.w * 17.)); q.x += s; q.y += s * .6; }
  }
  float c = cos(iA.w), s = sin(iA.w);
  vec3 w = vec3(iA.x + q.x * c - q.y * s, iA.y + q.x * s + q.y * c, iA.z + q.z);
  vec3 m = uImp > .5 ? vec3(0., 0., 1.) : normalize(n / iB.xyz);
  vN = vec3(m.x * c - m.y * s, m.x * s + m.y * c, m.z);
  vB = b; vT = tt; vSd = iB.w; vK = k; vV = uEye - w; vD = length(vV); vUp = vV.z / max(vD, 1e-3);
  ${typeof V3_SHV === 'string' ? 'vSh = uShM * vec4(w, 1.);' : ''}
  gl_Position = uM * vec4(w, 1.);
}`;
const V3P_FS = der => `${der ? '#extension GL_OES_standard_derivatives : enable\n#define DER 1\n' : ''}precision mediump float;
uniform sampler2D uTex; uniform float uCut, uMode, uFol, uGlass, uEdge; uniform vec4 uCol; uniform vec2 uFog; uniform vec3 uBg, uSun, uGlow, uBody;
varying vec3 vN, vB, vV; varying vec2 vT; varying float vD, vSd, vK, vUp;
${typeof V3_SHF === 'string' ? V3_SHF : 'float shadowAt() { return 1.; }'}
void main() {
  vec4 tx = texture2D(uTex, vT) * uCol;
  if (uMode > 2.5) { if (vK > 1.5 || tx.a < uCut) discard; gl_FragColor = vec4(1.); return; }   // 阴影图：只写深度（替身只用竖片）
  float cut = uCut;
  if (vK > 1.5) cut = mix(1.01, uCut, smoothstep(.55, .8, vUp));       // 横片：俯看时才出现
  else if (vK > .5) cut = mix(uCut, 1.01, smoothstep(.82, .97, vUp));  // 竖片：快正俯视时淡出
  if (tx.a < cut) discard;
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  if (uMode > 1.5) { gl_FragColor = vec4(tx.rgb * (.8 + .2 * clamp(N.z * .5 + .5, 0., 1.)), 1.); return; }   // 烘焙替身图集：只要底色
  vec3 V = normalize(vV);
  float ndl = dot(N, uSun), dif = uFol > .5 ? clamp(ndl * .45 + .55, 0., 1.) : clamp(ndl, 0., 1.);
  if (vK > .5) dif = .7;   // 替身没有真法线：取平均受光
  if (uMode > .5) dif *= shadowAt();
  vec3 alb = tx.rgb * (uFol > .5 ? .84 + .3 * vSd : 1.);   // 每棵树颜色略有不同
  float e = min(min(vB.x, vB.y), vB.z);
#ifdef DER
  float fw = max(fwidth(e), 1e-4), ed = 1. - smoothstep(fw * .6, fw * 1.9, e);
#else
  float ed = 1. - smoothstep(.015, .06, e);
#endif
  ed *= uEdge;
  float rim = pow(1. - clamp(abs(dot(N, V)), 0., 1.), 3.);
  vec3 c;
  if (uMode < .5) {   // 黑绿：深色实体按底色深浅、发光棱线与轮廓光
    float l = dot(alb, vec3(.3, .59, .11));
    c = uBody * (uFol > .5 ? .9 + 2.2 * l : .55 + .9 * l) * (.55 + .9 * dif) + uGlow * (ed * .7 + rim * (uFol > .5 ? .2 : .22));
    if (uGlass > .5) c += uGlow * .3;
  } else {   // 写实：天光（上冷下暖）+ 太阳；树叶逆光透亮；棱线略压暗
    vec3 sky = mix(vec3(.3, .29, .27), vec3(.47, .52, .6), N.z * .5 + .5);
    c = alb * (sky + vec3(1., .95, .86) * dif * .82) * 1.08 * (1. - ed * .2);
    if (uFol > .5) c += alb * vec3(.2, .24, .06) * pow(clamp(dot(-V, uSun), 0., 1.), 4.);
    if (uGlass > .5) c = mix(c, vec3(.5, .62, .7), .45 + .3 * rim);
  }
  gl_FragColor = vec4(mix(c, uBg, smoothstep(uFog.x, uFog.y, vD)), 1.);
}`;
function v3pInit(gl) {
  V3P.tried = true;
  try {
    const der = !!gl.getExtension('OES_standard_derivatives');
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, V3P_VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, V3P_FS(der)));
    gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
    V3P.pr = pr; V3P.gl = gl; V3P.ext = gl.getExtension('ANGLE_instanced_arrays');
    for (const k of ['p', 'n', 't', 'b', 'iA', 'iB']) V3P.a[k] = gl.getAttribLocation(pr, k);
    for (const k of ['uM', 'uEye', 'uT', 'uSway', 'uImp', 'uNear', 'uTex', 'uCut', 'uMode', 'uFol', 'uGlass', 'uEdge', 'uCol', 'uFog', 'uBg', 'uSun', 'uGlow', 'uBody', 'uImpF', 'uImpT', 'uImpX', 'uShM', 'uShT', 'uShOn', 'uShP']) V3P.u[k] = gl.getUniformLocation(pr, k);
    V3P.ib = gl.createBuffer();
    V3P.white = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, V3P.white); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    V3P.aniso = gl.getExtension('EXT_texture_filter_anisotropic') || gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic');
    V3P.ok = !!V3P.ext;   // 没有实例化扩展的老设备：仍画原来的几何体
  } catch (e) { V3P.ok = false; console.warn('3D 地图物件不可用', e); }
}

// —— 资源包：下载、解析（每组展开成平直三角形：位置 3、法线 3、UV 2、棱线坐标 3 = 11 个浮点）、贴图 ——
function v3pPack(id) {
  let P = V3P.packs.get(id);
  if (P) return P.st === 1 ? P : null;
  P = { id, st: 0, vars: new Map(), mats: [], tex: [] };
  V3P.packs.set(id, P);
  const v = typeof window === 'object' && window.DS_BUILD ? '?v=' + window.DS_BUILD : '';
  fetch('assets/models/' + id + '.bin' + v).then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); }).then(buf => {
    const D = v3pParse(buf), gl = V3P.gl;
    P.mats = D.mats;
    for (const V of D.vars) P.vars.set(V.name, { bb: V.bb, groups: V.groups.map(g => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, g.data, gl.STATIC_DRAW); return { mi: g.mi, b, n: g.data.length / 11 }; }) });
    let left = D.tex.length;
    const done = () => { if (--left <= 0) { P.st = 1; V3P.sig = null; } };
    if (!left) { P.st = 1; V3P.sig = null; }
    D.tex.forEach((fmt, k) => {
      const img = new Image();
      img.onload = () => {
        const t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        const pot = !(img.width & (img.width - 1)) && !(img.height & (img.height - 1));
        if (pot) { gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); if (V3P.aniso) gl.texParameterf(gl.TEXTURE_2D, V3P.aniso.TEXTURE_MAX_ANISOTROPY_EXT, 4); }
        else { gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); }
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        P.tex[k] = t; done();
      };
      img.onerror = () => { P.tex[k] = null; done(); };
      img.src = 'assets/models/' + id + '_' + k + '.' + (fmt ? 'webp' : 'jpg') + v;
    });
  }).catch(e => { P.st = -1; console.warn('地图物件 ' + id + ' 没载入，用自带几何体', e); });
  return null;
}
function v3pParse(buf) {
  const dv = new DataView(buf), u8 = new Uint8Array(buf);
  if (String.fromCharCode(u8[0], u8[1], u8[2], u8[3]) !== 'DSM2') throw new Error('格式不对');
  let o = 4;
  const nV = dv.getUint32(o, true), nM = dv.getUint32(o + 4, true), nT = dv.getUint32(o + 8, true); o += 12;
  const al = () => { o = (o + 3) & ~3; };
  const tex = Array.from(u8.slice(o, o + nT)); o += nT; al();
  const mats = [];
  for (let i = 0; i < nM; i++) { mats.push({ ti: u8[o], mode: u8[o + 1], two: u8[o + 2], bf: [0, 1, 2, 3].map(k => dv.getFloat32(o + 4 + k * 4, true)), cut: dv.getFloat32(o + 20, true) }); o += 24; }
  const vars = [];
  for (let i = 0; i < nV; i++) {
    const ln = u8[o], name = new TextDecoder().decode(u8.slice(o + 1, o + 1 + ln)); o += 1 + ln; al();
    const mn = [0, 1, 2].map(k => dv.getFloat32(o + k * 4, true)), mx = [0, 1, 2].map(k => dv.getFloat32(o + 12 + k * 4, true)); o += 24;
    const nG = dv.getUint32(o, true); o += 4;
    const groups = [];
    for (let g = 0; g < nG; g++) {
      const mi = dv.getUint32(o, true), nv = dv.getUint32(o + 4, true), ni = dv.getUint32(o + 8, true); o += 12;
      const Q = new Uint16Array(buf.slice(o, o + nv * 6)); o += nv * 6; al();
      const Nn = new Int8Array(buf.slice(o, o + nv * 3)); o += nv * 3; al();
      const Uv = new Float32Array(buf.slice(o, o + nv * 8)); o += nv * 8; al();
      const I = new Uint16Array(buf.slice(o, o + ni * 2)); o += ni * 2; al();
      const F = u8.slice(o, o + ni / 3); o += ni / 3; al();
      const data = new Float32Array(ni * 11);
      for (let t = 0; t < ni / 3; t++) for (let k = 0; k < 3; k++) {
        const vi = I[t * 3 + k], w = (t * 3 + k) * 11;
        // 与 v3units.js 的模型一样：y 取反（模型 y 向右，GL 的 y 向北）
        data[w] = mn[0] + Q[vi * 3] / 65535 * (mx[0] - mn[0]); data[w + 1] = -(mn[1] + Q[vi * 3 + 1] / 65535 * (mx[1] - mn[1])); data[w + 2] = mn[2] + Q[vi * 3 + 2] / 65535 * (mx[2] - mn[2]);
        data[w + 3] = Nn[vi * 3] / 127; data[w + 4] = -Nn[vi * 3 + 1] / 127; data[w + 5] = Nn[vi * 3 + 2] / 127;
        data[w + 6] = Uv[vi * 2]; data[w + 7] = Uv[vi * 2 + 1];
        for (let e = 0; e < 3; e++) data[w + 8 + e] = (e === k ? 1 : 0) + (F[t] >> e & 1 ? 0 : 1);
      }
      groups.push({ mi, data });
    }
    vars.push({ name, bb: [mn, mx], groups });
  }
  return { tex, mats, vars };
}
const v3pVar = (pk, name) => { const P = v3pPack(pk); return P ? P.vars.get(name) || null : null; };

// —— 摆放：按地图格子种树、灌木、岩石，城镇房屋、机场设施换模型（地图或地形变了重算）——
const V3P_TS = 30;   // 远处替身按 30 × 30 格（300 米）分块
function v3pPlace() {
  const isle = !!TER.isle;   // 架空海岛（isle.js）：热带植被——沿海一带棕榈，雨林用阔叶树，针叶树只长在高山上
  const need = ['treepack', 'cliffs', 'jph1', 'jph2', 'jph3', 'house', 'oldconc', 'hangar', 'atc', 'quonset', 'firestation', 'wh3', 'sawtooth', 'smallwh', 'industrial', 'flats1', 'wh99', 'girder', 'pillbox', 'teeth', ...(isle ? ['palms'] : [])];
  const got = need.map(id => v3pPack(id) || (V3P.packs.get(id) || {}).st === -1);   // 先全部发起下载（同时载入），再看是不是都好了
  if (!got.every(Boolean)) return false;
  const tp = v3pPack('treepack');
  if (!tp) return false;
  const VL = [], vIdx = new Map(), vOf = (pk, nm) => { const k = pk + '/' + nm; if (vIdx.has(k)) return vIdx.get(k); const V = v3pVar(pk, nm); if (!V) return -1; vIdx.set(k, VL.length); VL.push({ pk, nm, V, h: V.bb[1][2] - V.bb[0][2], w: Math.max(V.bb[1][0] - V.bb[0][0], V.bb[1][1] - V.bb[0][1]), tint: pk === 'treepack' ? V3P_TINT[nm] || null : null, mul: V3P_MUL[pk] || null, veg: pk === 'treepack' && !/^rock/.test(nm) }); return VL.length - 1; };
  const con = V3P_CON.map(n => vOf('treepack', n)).filter(i => i >= 0), brd = V3P_BRD.map(n => vOf('treepack', n)).filter(i => i >= 0);
  const bush = V3P_BUSH.map(n => vOf('treepack', n)).filter(i => i >= 0), grass = vOf('treepack', 'bush0'), rock = V3P_ROCK.map(n => vOf('treepack', n)).filter(i => i >= 0);
  const cliff = ['cliffA', 'cliffB'].map(n => vOf('cliffs', n)).filter(i => i >= 0);
  const palm = isle ? ['palm1', 'palm2', 'palm3', 'palm4'].map(n => vOf('palms', n)).filter(i => i >= 0) : [], SD = isle && typeof terSdf === 'function' ? terSdf() : null;
  // —— 植被与岩石：x, y, z, 朝向, 横比例, 竖比例, 随机数, 变体；kind：0 树（有替身）1 灌木 / 草 2 岩石 / 崖壁 ——
  const L = { x: [], y: [], z: [], a: [], s: [], sz: [], sd: [], v: [], k: [] };
  const put = (x, y, v, s, sz, k, a, sink = .15) => { L.x.push(x); L.y.push(y); L.z.push(v3Ht(clamp(x, 0, W - 1), clamp(y, 0, H - 1)) - sink); L.a.push(a); L.s.push(s); L.sz.push(sz); L.sd.push(Math.random()); L.v.push(v); L.k.push(k); };
  const r = rng(TER.seed + 77), af = TER.af;
  const roadNear = (gx, gy) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const x = gx + dx, y = gy + dy; if (x < 0 || y < 0 || x >= GW || y >= GH) continue; const t = TER.type[y * GW + x]; if (t === T.ROAD || t === T.BRIDGE || t === T.TOWN || t === T.RIVER || t === T.BEACH) return true; } return false; };
  const ptsNear = (x, y) => (TER.points || []).some(p => Math.abs(p.x - x) < 26 && Math.abs(p.y - y) < 26);
  const edge = (gx, gy, t) => { for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const x = gx + dx, y = gy + dy; if (x >= 0 && y >= 0 && x < GW && y < GH && TER.type[y * GW + x] !== t) return true; } return false; };
  const coarse = typeof V3 === 'object' && V3.coarse;
  for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
    const i = gy * GW + gx, t = TER.type[i], cx = gx * CELL + CELL / 2, cy = gy * CELL + CELL / 2, el = TER.elev[i] || 0;
    if (af && Math.hypot(cx - af.x, cy - af.y) < 520) continue;   // 机场场区（跑道、滑行道）不长树
    let n = 0;
    const cd = SD ? SD[i] : 1e9;   // 海岛：离海岸多远（米）
    if (t === T.FOREST) n = 1 + (r() < (coarse ? .15 : .45) ? 1 : 0) + (!coarse && r() < .12 ? 1 : 0);
    else if (t === T.HILL) n = r() < .16 ? 1 : 0;
    else if (t === T.MOUNT) n = r() < .09 ? 1 : 0;
    else if (t === T.FIELD) n = r() < (cd < 600 ? .07 : .01) ? 1 : 0;   // 海岛沿海平地：椰林种植园
    else if (t === T.MARSH) n = r() < .06 ? 1 : 0;
    else if (t === T.BEACH && isle) n = cd > 18 && r() < .07 ? 1 : 0;   // 海滩后沿稀疏的椰树
    const okHere = !(t !== T.FOREST && roadNear(gx, gy)) && !ptsNear(cx, cy);
    if (n && okHere) for (let k = 0; k < n; k++) {
      const x = cx + (r() - .5) * CELL * .9, y = cy + (r() - .5) * CELL * .9, pm = palm.length > 0 && t !== T.MARSH && (cd < 260 || t === T.FIELD || t === T.BEACH || (el < .3 && r() < .3));
      const isCon = !pm && (isle ? el > .9 || t === T.MOUNT : el > .62 || t === T.MOUNT || r() < .55);   // 海岛：山地雨林也是阔叶树，针叶只在山顶附近
      const L0 = pm ? palm : isCon ? con : brd, v = L0[(r() * L0.length) | 0] ?? con[0];
      if (v == null) continue;
      const hgt = pm ? 9 + r() * 8 : (t === T.FOREST ? 10 + r() * 7 : 7 + r() * 5) * (t === T.MARSH ? .6 : 1), s = hgt / VL[v].h;
      put(x, y, v, s * (.9 + r() * .2), s, 0, r() * 6.283);
    }
    if (!okHere) continue;
    // 灌木、草丛：林缘、丘陵、沼泽、田边
    let nb = 0;
    if (t === T.FOREST && edge(gx, gy, T.FOREST)) nb = r() < .55 ? 1 + (r() < .35 ? 1 : 0) : 0;
    else if (t === T.HILL) nb = r() < .1 ? 1 : 0;
    else if (t === T.MARSH) nb = r() < .25 ? 1 : 0;
    else if (t === T.FIELD) nb = r() < .012 ? 1 : 0;
    for (let k = 0; k < nb && bush.length; k++) {
      const x = cx + (r() - .5) * CELL * .9, y = cy + (r() - .5) * CELL * .9, gr = t === T.MARSH || r() < .25, v = gr && grass >= 0 ? grass : bush[(r() * bush.length) | 0], s = (gr ? .7 : .45) + r() * .35;
      put(x, y, v, s, s, 1, r() * 6.283, .05);
    }
    // 岩石：山地、丘陵、礁石海岸；悬崖海岸摆崖壁
    let nr = 0;
    if (t === T.MOUNT) nr = r() < .12 ? 1 + (r() < .3 ? 1 : 0) : 0;
    else if (t === T.HILL) nr = r() < .03 ? 1 : 0;
    else if (t === T.ROCKS) nr = r() < .45 ? 1 + (r() < .4 ? 1 : 0) : 0;
    else if (t === T.BEACH) nr = r() < .01 ? 1 : 0;
    for (let k = 0; k < nr && rock.length; k++) {
      const x = cx + (r() - .5) * CELL * .9, y = cy + (r() - .5) * CELL * .9, s = (t === T.ROCKS ? 1.2 : 1) * (.8 + r() * 2.2);
      put(x, y, rock[(r() * rock.length) | 0], s, s * (.8 + r() * .4), 2, r() * 6.283, .25 * s);
    }
    if (t === T.CLIFF && cliff.length && r() < .22) {
      const v = cliff[(r() * cliff.length) | 0], s = (6 + r() * 6) / VL[v].h;
      put(cx + (r() - .5) * 4, cy + (r() - .5) * 4, v, s, s, 2, r() * 6.283, 3 * s);
    }
  }
  const N = L.x.length, F = k => new Float32Array(L[k]);
  const PL = { n: N, x: F('x'), y: F('y'), z: F('z'), a: F('a'), s: F('s'), sz: F('sz'), sd: F('sd'), v: Int16Array.from(L.v), k: Uint8Array.from(L.k) };
  // 近处挑选用的桶（100 米）
  const BS = 100, bx = Math.ceil(W / BS), by = Math.ceil(H / BS), cnt = new Int32Array(bx * by + 1);
  const bOf = i => clamp(Math.floor(PL.y[i] / BS), 0, by - 1) * bx + clamp(Math.floor(PL.x[i] / BS), 0, bx - 1);
  for (let i = 0; i < N; i++) cnt[bOf(i) + 1]++;
  for (let i = 0; i < bx * by; i++) cnt[i + 1] += cnt[i];
  const idx = new Int32Array(N), fill = cnt.slice(0, bx * by);
  for (let i = 0; i < N; i++) idx[fill[bOf(i)]++] = i;
  Object.assign(PL, { BS, bx, by, cnt, idx });
  V3P.P = PL; V3P.VL = VL;
  v3pImpBuild(con.concat(brd, palm));   // 远处的替身面片（最多 16 种：针叶 9、阔叶 3、棕榈 4）
  v3pFar();
  v3pStatic(vOf);
  return true;
}

// —— 远处替身：每块地一个实例缓冲区（x, y, z, 朝向 | 宽, 高, 替身序号, 随机数）——
function v3pFar() {
  const gl = V3P.gl, PL = V3P.P, I = V3P.imp;
  for (const c of V3P.far || []) gl.deleteBuffer(c.b);
  V3P.far = [];
  if (!I) return;
  const cw = V3P_TS * CELL, nx = Math.ceil(W / cw), ny = Math.ceil(H / cw), lists = Array.from({ length: nx * ny }, () => []);
  for (let i = 0; i < PL.n; i++) {
    if (PL.k[i] !== 0) continue;
    const ii = I.of.get(PL.v[i]);
    if (ii == null) continue;
    const V = V3P.VL[PL.v[i]], c = clamp(Math.floor(PL.y[i] / cw), 0, ny - 1) * nx + clamp(Math.floor(PL.x[i] / cw), 0, nx - 1);
    lists[c].push(PL.x[i], -PL.y[i], PL.z[i], -PL.a[i], V.w * PL.s[i], V.h * PL.sz[i], ii, PL.sd[i]);
  }
  lists.forEach((d, c) => {
    if (!d.length) return;
    const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(d), gl.STATIC_DRAW);
    const tx = c % nx, ty = (c / nx) | 0;
    V3P.far.push({ b, n: d.length / 8, bb: [tx * cw - 20, ty * cw - 20, (tx + 1) * cw + 20, (ty + 1) * cw + 20] });
  });
}
// 替身图集：每种树从侧面（竖片用）、正上方（横片用）各渲染一张；网格是单位尺寸的两片交叉竖片 + 一片横片
function v3pImpBuild(trees) {
  const gl = V3P.gl, S0 = 1024, CW = 128, FH = 384, TH = 128, per = Math.floor(S0 / CW), vp = gl.getParameter(gl.VIEWPORT);   // 每种树占一列：上面竖图 128 × 384，下面俯视图 128 × 128
  if (V3P.imp) { gl.deleteTexture(V3P.imp.tex); gl.deleteBuffer(V3P.imp.mb); }
  V3P.imp = null;
  if (!trees.length || trees.length > 16) return;
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, S0, S0, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fb = gl.createFramebuffer(), rb = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, rb); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, S0, S0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
  const okFb = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  const F = new Float32Array(64), T4 = new Float32Array(64), X = new Float32Array(64), of = new Map();
  if (okFb) {
    gl.viewport(0, 0, S0, S0); gl.clearColor(.2, .26, .14, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(V3P.pr);
    const U = V3P.u, A = V3P.a;
    gl.uniform1f(U.uMode, 2); gl.uniform1f(U.uImp, 0); gl.uniform1f(U.uSway, 0); gl.uniform3f(U.uEye, 0, 0, 1e4);
    gl.disableVertexAttribArray(A.iA); gl.disableVertexAttribArray(A.iB);
    gl.vertexAttrib4f(A.iA, 0, 0, 0, 0); gl.vertexAttrib4f(A.iB, 1, 1, 1, .5);
    trees.forEach((vi, j) => {
      const VV = V3P.VL[vi], [mn, mx] = VV.V.bb, hw = Math.max(mx[0] - mn[0], mx[1] - mn[1]) / 2, h = mx[2] - mn[2], col = j % per, row = Math.floor(j / per);
      const x0 = col * CW, y0 = row * (FH + TH);
      // 侧视：看 GL 的 y 方向——屏幕横向是 x、纵向是 z；正交投影把 [-hw, hw] × [0, h] 铺满这一格
      const side = [1 / hw, 0, 0, 0, 0, 0, -.01, 0, 0, 2 / h, 0, 0, 0, -1, 0, 1];
      const top = [1 / hw, 0, 0, 0, 0, 1 / hw, 0, 0, 0, 0, -.01, 0, 0, 0, 0, 1];
      for (const [M, vy, vh] of [[side, y0, FH], [top, y0 + FH, TH]]) {
        gl.viewport(x0, vy, CW, vh); gl.uniformMatrix4fv(U.uM, false, M);
        v3pDrawVar(VV.V, VV.pk, null, 0, undefined, VV);
      }
      F.set([x0 / S0, y0 / S0, CW / S0, FH / S0], j * 4); T4.set([x0 / S0, (y0 + FH) / S0, CW / S0, TH / S0], j * 4);
      X.set([.62, 1, 0, 0], j * 4);
      of.set(vi, j);
    });
    gl.bindTexture(gl.TEXTURE_2D, tex); gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(fb); gl.deleteRenderbuffer(rb);
  gl.viewport(vp[0], vp[1], vp[2], vp[3]);   // 在一帧中间烘焙的：恢复主画面的视口
  if (!okFb) { gl.deleteTexture(tex); return; }
  // 替身网格（单位尺寸）：竖片 x、y ∈ [-.5, .5]、z ∈ [0, 1]，横片 n.z = 1（高度按 uImpX.x 放到树冠）；UV 的 v 向上（图集里侧视图下方是树根）
  const q = [], quad = (P, n) => { const uv = [[0, 0], [1, 0], [1, 1], [0, 1]]; for (const k of [0, 1, 2, 0, 2, 3]) q.push(...P[k], ...n, ...uv[k], 1, 1, 1); };
  quad([[-.5, 0, 0], [.5, 0, 0], [.5, 0, 1], [-.5, 0, 1]], [0, 1, 0]); quad([[0, -.5, 0], [0, .5, 0], [0, .5, 1], [0, -.5, 1]], [1, 0, 0]);
  quad([[-.5, -.5, 0], [.5, -.5, 0], [.5, .5, 0], [-.5, .5, 0]], [0, 0, 1]);
  const mb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, mb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(q), gl.STATIC_DRAW);
  V3P.imp = { tex, mb, mn: q.length / 11, F, T: T4, X, of };
}

// —— 楼房、机场设施：静态实例（按变体分组）——
function v3pStatic(vOf) {
  const gl = V3P.gl, groups = new Map(), add = (v, x, y, z, a, sx, sy, sz) => { if (v < 0) return; let g = groups.get(v); if (!g) groups.set(v, g = []); g.push(x, -y, z, -a, sx, sy, sz, .5); };
  V3P.rep = new Set();
  // 城镇：每栋房子按占地挑模型（两个朝向都试），正面朝街
  const B = typeof townBld === 'function' ? townBld().list : [];
  const hv = V3P_HOUSE.map(([pk, nm, rot]) => [vOf(pk, nm), rot]).filter(o => o[0] >= 0), fv = V3P_FLAT.map(([pk, nm, rot]) => [vOf(pk, nm), rot]).filter(o => o[0] >= 0);
  const sc = (b, x) => { const t = TER.type[b]; return t === T.ROAD || t === T.BRIDGE ? 3 : t === T.TOWN ? 0 : t === T.RIVER || isWater(t) ? .5 : 1; };
  const hr = rng(TER.seed + 913);
  // 据点房屋占的地方（城镇里的指挥所）：这里的普通民房不放，免得叠在一起
  const ptR = [];
  if (typeof V3_PTHOUSE === 'object') for (const p of (typeof S === 'object' && S && S.points) || []) { const L = V3_PTHOUSE[typeof PKIND === 'function' ? PKIND(p.key) : '']; if (L) for (const [hx, hy, w, h] of L) ptR.push([p.x + hx - w / 2 - 2, p.y + hy - h / 2 - 2, p.x + hx + w / 2 + 2, p.y + hy + h / 2 + 2]); }
  if (hv.length && fv.length) for (const b of B) {
    const fw = (b.r ? b.h : b.w) + 1, fh = (b.r ? b.w : b.h) + 1, cx = b.x + b.dx, cy = b.y + b.dy, gx = Math.floor(b.x / CELL), gy = Math.floor(b.y / CELL);
    if (ptR.some(r => cx + fw / 2 > r[0] && cx - fw / 2 < r[2] && cy + fh / 2 > r[1] && cy - fh / 2 < r[3])) continue;
    // 朝街的一面：四个邻格里路最优先，其次空地
    const dirs = [[1, 0, 0], [0, 1, Math.PI / 2], [-1, 0, Math.PI], [0, -1, -Math.PI / 2]].map(([dx, dy, a]) => { const x = gx + dx, y = gy + dy; return [x >= 0 && y >= 0 && x < GW && y < GH ? sc(y * GW + x) + hr() * .3 : 0, a]; }).sort((p, q) => q[0] - p[0]);
    const face = dirs[0][1], alongX = Math.abs(Math.cos(face)) > .5;   // 正面朝东西：模型的进深（x）沿世界 x
    let best = null;
    for (const [v, rot] of b.f ? fv : hv) {
      const bb = V3P.VL[v].V.bb, mw0 = bb[1][0] - bb[0][0], mh0 = bb[1][1] - bb[0][1], rq = Math.abs(Math.sin(rot)) > .5, md = rq ? mh0 : mw0, mwid = rq ? mw0 : mh0;   // 转正后的进深、面宽
      const ex = alongX ? md : mwid, ey = alongX ? mwid : md, s = Math.min(fw / ex, fh / ey), k = s > 1 ? s : 1 / s;
      const score = Math.abs(Math.log(Math.min(s, 1.05) / .95)) + hr() * .25;
      if (s >= .55 && (!best || score < best.score)) best = { v, rot, s: Math.min(s, 1.05), score, k };
    }
    if (!best) continue;
    const zc = Math.min(...[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => v3Ht(cx + sx * fw / 2, cy + sy * fh / 2)), v3Ht(cx, cy)) - .3;
    add(best.v, cx, cy, zc, face + best.rot, best.s, best.s, best.s * (b.f ? 1.05 : 1));
  }
  if (hv.length && fv.length) V3P.rep.add('town');
  // 据点里的房屋（指挥所、雷达站、炮兵排的平房，哨所，渔村的坡顶房）：按占地放水泥楼 / 民房模型，整体缩放（不压扁），朝向随机转 180°
  if (hv.length && fv.length && typeof V3_PTHOUSE === 'object') for (const p of (typeof S === 'object' && S && S.points) || []) {
    const k = typeof PKIND === 'function' ? PKIND(p.key) : null, L = V3_PTHOUSE[k];
    if (!L) continue;
    for (const [hx, hy, w, h, , roof] of L) {
      const cx = p.x + hx, cy = p.y + hy, opts = roof ? hv : fv;
      let best = null;
      for (const [v, rot] of opts) for (const q of [0, 1]) {   // 两个朝向：模型长边对着占地长边
        const bb = V3P.VL[v].V.bb, rq = (Math.abs(Math.sin(rot)) > .5) !== !!q, mw = rq ? bb[1][1] - bb[0][1] : bb[1][0] - bb[0][0], mh = rq ? bb[1][0] - bb[0][0] : bb[1][1] - bb[0][1];
        const s0 = Math.min((w + 1) / mw, (h + 1) / mh), sc0 = Math.abs(Math.log(s0)) + hr() * .2;
        if (!best || sc0 < best.sc) best = { v, a: rot + (q ? Math.PI / 2 : 0) + (hr() < .5 ? Math.PI : 0), s: s0, sc: sc0 };
      }
      const zc = Math.min(...[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => v3Ht(cx + sx * w / 2, cy + sy * h / 2))) - .3;
      add(best.v, cx, cy, zc, best.a, best.s, best.s, best.s);
    }
  }
  // 海滩出口：两座地堡（射孔朝海，+y 是南）、一排龙牙；公路桥的桥墩（桥面按炸没炸每帧加，见 v3pPrep）
  const pb = vOf('pillbox', 'pillbox'), th = vOf('teeth', 'teeth'), gp = vOf('girder', 'pier'), gs = vOf('girder', 'span');
  V3P.brg = [];
  for (const p of (typeof S === 'object' && S && S.points) || []) {
    const k = typeof PKIND === 'function' ? PKIND(p.key) : null;
    if (k === 'exit' && pb >= 0 && th >= 0) {
      for (const sx of [-17, 17]) add(pb, p.x + sx, p.y, v3Ht(p.x + sx, p.y) - .4, Math.PI / 2, 1, 1, 1);
      for (const ox of [-18, -6, 6, 18]) add(th, p.x + ox, p.y + 11.5, v3Ht(p.x + ox, p.y + 11.5) - .1, -Math.PI / 2, 1.1, 1.1, 1.3);
    } else if (k === 'bridge' && gp >= 0 && gs >= 0) {
      const z = Math.max(v3Ht(p.x - 26, p.y), v3Ht(p.x + 26, p.y), -2) - 2.4;   // 与自带的桥同一套高度（v3units.js）
      for (const bx of [-9, 9]) add(gp, p.x + bx, p.y, z - 3, 0, .45, .56, 3.7 / 37.5);
      V3P.brg.push({ key: p.key, x: p.x, y: p.y, z: z + 3 - 4 * .6, v: gs });
    }
  }
  // 机场：拱顶的换机库 / 铁皮营房，坡顶的库房换成排库房（金属）/ 砖砌库房，平顶的按材质与大小换消防站、办公楼、公寓楼、厂房、小库房，塔台换塔台；
  //   模型长边对着建筑长边，长宽比差得多就沿长边并排放几栋（每栋按自己的一份占地缩放）
  const blocks = typeof afb3dBlocks === 'function' ? afb3dBlocks() : [], hg = vOf('hangar', 'hangar'), qs = vOf('quonset', 'quonset'), tw = vOf('atc', 'atc');
  const fs = vOf('firestation', 'firestation'), w3 = vOf('wh3', 'wh3'), st = vOf('sawtooth', 'sawtooth'), sw = vOf('smallwh', 'smallwh'), ind = vOf('industrial', 'industrial'), fl = vOf('flats1', 'flats1'), w99 = vOf('wh99', 'wh99');
  let fire = false;
  const pick = (k, big, small) => {
    const asp = big / small, or = (...vs) => vs.find(v => v >= 0) ?? -1;
    if (k.r === 'arch') return big >= 30 ? or(hg, qs) : or(qs);
    if (k.r === 'has') return or(qs);   // 加固机堡：拱顶，外形接近半圆营房
    if (k.r === 'gable') return k.m === 'mound' ? -1 : k.m === 'metal' ? or(w3, qs) : or(w99, w3, qs);
    if (k.r !== 'flat' || k.m === 'canopy') return -1;
    if (big < 16) return or(sw);
    if (k.m === 'dark') return or(st, ind);
    if (k.m === 'white') return or(fl, ind);
    if (k.m === 'conc' && !fire && asp >= 1.5 && asp <= 2.4 && fs >= 0) { fire = true; return fs; }
    return asp < 1.45 ? or(ind, fl) : or(fl, ind);
  };
  blocks.forEach((k, i) => {
    const P = k.pts;
    if (P.length !== 4 && k.k !== 'cab') return;
    if (k.k === 'tower' || k.k === 'cab') {
      if (tw < 0) return;
      V3P.rep.add(i);
      if (k.k === 'cab') return;
      const cx = P.reduce((a, p) => a + p[0], 0) / 4, cy = P.reduce((a, p) => a + p[1], 0) / 4, s = 60 / V3P.VL[tw].h;
      add(tw, cx, cy, v3Ht(cx, cy) - .4, 0, s, s, s);
      return;
    }
    const L = Math.hypot(P[1][0] - P[0][0], P[1][1] - P[0][1]), Wd = Math.hypot(P[2][0] - P[1][0], P[2][1] - P[1][1]), a = Math.atan2(P[1][1] - P[0][1], P[1][0] - P[0][0]);
    const big = Math.max(L, Wd), small = Math.min(L, Wd), v = pick(k, big, small);
    if (v < 0) return;
    const cx = P.reduce((s, p) => s + p[0], 0) / 4, cy = P.reduce((s, p) => s + p[1], 0) / 4, g = Math.min(...P.map(([x, y]) => v3Ht(x, y))) - .4;
    const bb = V3P.VL[v].V.bb, mL = bb[1][0] - bb[0][0], mW = bb[1][1] - bb[0][1], mBig = Math.max(mL, mW), mSmall = Math.min(mL, mW);
    const aL = L >= Wd ? a : a + Math.PI / 2, yaw = mL >= mW ? aL : aL - Math.PI / 2;   // 模型长边转到建筑长边
    const n = v === hg ? 1 : Math.max(1, Math.round((big / small) / (mBig / mSmall))), seg = big / n;
    const sLong = seg / mBig, sShort = small / mSmall, sx = mL >= mW ? sLong : sShort, sy = mL >= mW ? sShort : sLong;
    const sz = v === qs ? sShort * .9 : v === hg ? Math.min(sLong, sShort) : Math.min(sLong, sShort) * 1.05;
    for (let j = 0; j < n; j++) { const o = ((j + .5) / n - .5) * big; add(v, cx + Math.cos(aL) * o, cy + Math.sin(aL) * o, g, yaw, v === hg ? Math.min(sx, sy * 1.15) : sx, sy, sz); }
    V3P.rep.add(i);
  });
  for (const c of V3P.B || []) gl.deleteBuffer(c.b);
  V3P.B = [...groups].map(([v, d]) => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(d), gl.STATIC_DRAW); return { v, b, n: d.length / 8 }; });
  V3P.asig = typeof afb3dSig === 'function' ? afb3dSig() : '';
}

// —— 画一个变体（各组：贴图、透明裁剪、双面）；inst：实例缓冲区（null 时用常量属性），n 实例数 ——
function v3pDrawVar(V, pk, inst, n, fol, VV) {
  const gl = V3P.gl, A = V3P.a, U = V3P.u, X = V3P.ext, P = V3P.packs.get(pk), tn = VV && VV.tint;
  gl.uniform1f(U.uEdge, VV && VV.veg ? 0 : 1);
  for (const g of V.groups) {
    const M = P.mats[g.mi], t = M && M.ti !== 255 ? P.tex[M.ti] : null;
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, t || V3P.white);
    gl.uniform1f(U.uCut, M && M.mode === 1 ? Math.max(.3, Math.min(.6, M.cut)) : -1);
    gl.uniform1f(U.uFol, fol ?? (M && M.mode === 1 ? 1 : 0)); gl.uniform1f(U.uGlass, M && M.mode === 2 ? 1 : 0);
    const bf = M ? M.bf : [1, 1, 1, 1], ml = VV && VV.mul;
    if (tn && M && M.mode === 1) gl.uniform4f(U.uCol, bf[0] * tn[0], bf[1] * tn[1], bf[2] * tn[2], bf[3]);
    else if (ml) gl.uniform4f(U.uCol, bf[0] * ml[0], bf[1] * ml[1], bf[2] * ml[2], bf[3]);
    else gl.uniform4f(U.uCol, bf[0], bf[1], bf[2], bf[3]);
    gl.bindBuffer(gl.ARRAY_BUFFER, g.b);
    gl.enableVertexAttribArray(A.p); gl.vertexAttribPointer(A.p, 3, gl.FLOAT, false, 44, 0);
    gl.enableVertexAttribArray(A.n); gl.vertexAttribPointer(A.n, 3, gl.FLOAT, false, 44, 12);
    gl.enableVertexAttribArray(A.t); gl.vertexAttribPointer(A.t, 2, gl.FLOAT, false, 44, 24);
    gl.enableVertexAttribArray(A.b); gl.vertexAttribPointer(A.b, 3, gl.FLOAT, false, 44, 32);
    if (inst) {
      gl.bindBuffer(gl.ARRAY_BUFFER, inst);
      gl.enableVertexAttribArray(A.iA); gl.vertexAttribPointer(A.iA, 4, gl.FLOAT, false, 32, 0); X.vertexAttribDivisorANGLE(A.iA, 1);
      gl.enableVertexAttribArray(A.iB); gl.vertexAttribPointer(A.iB, 4, gl.FLOAT, false, 32, 16); X.vertexAttribDivisorANGLE(A.iB, 1);
      X.drawArraysInstancedANGLE(gl.TRIANGLES, 0, g.n, n);
      X.vertexAttribDivisorANGLE(A.iA, 0); X.vertexAttribDivisorANGLE(A.iB, 0);
      gl.disableVertexAttribArray(A.iA); gl.disableVertexAttribArray(A.iB);
    } else gl.drawArrays(gl.TRIANGLES, 0, g.n);
  }
}

// 现在画外部物件吗（设置开着、着色器可用）；town：城镇房屋已经换成模型
const v3pOn = () => !(typeof SETTINGS === 'object' && SETTINGS && SETTINGS.extMdl === false) && (!V3P.tried || V3P.ok);
const v3pReady = () => v3pOn() && !!V3P.P;
const v3pRep = i => v3pReady() && V3P.rep.has(i);

// 每帧：v3pPrep 在画之前调用一次（载入、摆放、挑出近处的实例并上传），v3pDraw 画（太阳阴影图一遍、正常画面一遍）
function v3Props(C) { if (v3pPrep(C)) v3pDraw(C); }
function v3pPrep(C) {
  V3P.live = false;
  const on = v3pOn();
  if (on !== V3P.was) { V3P.was = on; if (V3P.P && typeof v3Bld === 'function') v3Bld(); }   // 设置里开关：自带的房屋、树跟着换回来 / 换掉
  if (!on || typeof V3 !== 'object' || !V3.gl || !TER || !TER.type) return false;
  const gl = V3.gl;
  if (!V3P.tried) v3pInit(gl);
  if (!V3P.ok) return false;
  const sig = TER.seed + ':' + (V3.sig || '') + ':' + W + 'x' + H;
  if (V3P.sig !== sig) {
    const prev = !!V3P.P;
    if (v3pPlace()) { V3P.sig = sig; if (typeof v3Bld === 'function') v3Bld(); }   // 换好模型：房屋、树的旧几何体重建（跳过被替换的）
    else if (prev) V3P.P = null;
    if (!V3P.P) return false;
  } else if (typeof afb3dSig === 'function' && afb3dSig() !== V3P.asig) { v3pStatic((pk, nm) => V3P.VL.findIndex(o => o.pk === pk && o.nm === nm)); if (typeof v3Bld === 'function') v3Bld(); }   // 机场刚被发现 / 夺取
  // 近处的树、灌木、岩石：挑出镜头附近的，按变体分好、上传（两遍共用）
  const PL = V3P.P, near = V3P_NEAR(), ex = C.E[0], ey = -C.E[1];
  const fe = typeof v3FogE === 'function' ? v3FogE(C) : 3000, rN = [near, Math.min(near * 1.6, fe), Math.min(near * 1.8, fe)];   // 灌木、岩石小，比树稍远一点就不画
  const R2 = Math.max(...rN), b0x = clamp(Math.floor((ex - R2) / PL.BS), 0, PL.bx - 1), b1x = clamp(Math.floor((ex + R2) / PL.BS), 0, PL.bx - 1), b0y = clamp(Math.floor((ey - R2) / PL.BS), 0, PL.by - 1), b1y = clamp(Math.floor((ey + R2) / PL.BS), 0, PL.by - 1);
  const per = V3P.per || (V3P.per = new Map());
  for (const a of per.values()) a.n = 0;
  for (let by = b0y; by <= b1y; by++) for (let bx = b0x; bx <= b1x; bx++) {
    const bi = by * PL.bx + bx;
    for (let j = PL.cnt[bi]; j < PL.cnt[bi + 1]; j++) {
      const i = PL.idx[j], dx = PL.x[i] - ex, dy = PL.y[i] - ey, rr = rN[PL.k[i]];
      if (dx * dx + dy * dy > rr * rr) continue;
      let a = per.get(PL.v[i]);
      if (!a) per.set(PL.v[i], a = { d: new Float32Array(8 * 256), n: 0, b: gl.createBuffer() });
      if ((a.n + 1) * 8 > a.d.length) { const d2 = new Float32Array(a.d.length * 2); d2.set(a.d); a.d = d2; }
      a.d.set([PL.x[i], -PL.y[i], PL.z[i], -PL.a[i], PL.s[i], PL.s[i], PL.sz[i], PL.sd[i]], a.n * 8); a.n++;
    }
  }
  for (const B of V3P.brg || []) {   // 公路桥的桥面：炸断了就不画（只剩桥墩）
    if (typeof isBlown === 'function' && isBlown(B.key)) continue;
    let a = per.get(B.v);
    if (!a) per.set(B.v, a = { d: new Float32Array(8 * 16), n: 0, b: gl.createBuffer() });
    if ((a.n + 1) * 8 > a.d.length) { const d2 = new Float32Array(a.d.length * 2); d2.set(a.d); a.d = d2; }
    a.d.set([B.x, -B.y, B.z, 0, 48 / 51.6, 10 / 18, .6, .5], a.n * 8); a.n++;
  }
  for (const a of per.values()) if (a.n) { gl.bindBuffer(gl.ARRAY_BUFFER, a.b); gl.bufferData(gl.ARRAY_BUFFER, a.d.subarray(0, a.n * 8), gl.DYNAMIC_DRAW); }
  V3P.fe = fe; V3P.near = near; V3P.live = true;
  return true;
}
// LM：太阳阴影图的光源矩阵（这一遍只写深度：树叶照样按透明裁剪，替身只用竖片）
function v3pDraw(C, LM) {
  if (!V3P.live) return;
  const gl = V3.gl, U = V3P.u, A = V3P.a, mx = typeof v3Mx === 'function' && v3Mx(), ex = C.E[0], ey = -C.E[1], fe = V3P.fe, tm = (performance.now() / 1000) % 3600;
  gl.useProgram(V3P.pr);
  gl.uniformMatrix4fv(U.uM, false, LM || C.M); gl.uniform3f(U.uEye, C.E[0], C.E[1], C.E[2]);
  gl.uniform1f(U.uT, tm); gl.uniform1f(U.uNear, V3P.near); gl.uniform1i(U.uTex, 0);
  gl.uniform2f(U.uFog, ...(typeof v3FogR === 'function' ? v3FogR(C) : [C.D * 1.3, C.D * 2.8]));
  gl.uniform3f(U.uBg, ...(typeof v3Bg === 'function' ? v3Bg() : [.004, .02, .011]));
  const SU = typeof V3_SUN === 'object' ? V3_SUN : [-.45, .55, .7], sl = Math.hypot(...SU); gl.uniform3f(U.uSun, SU[0] / sl, SU[1] / sl, SU[2] / sl);
  gl.uniform1f(U.uMode, LM ? 3 : mx ? 0 : 1); gl.uniform3f(U.uBody, .015, .085, .045); gl.uniform3f(U.uGlow, .12, .68, .36);
  gl.uniform1f(U.uImp, 0); gl.uniform1f(U.uSway, 0);
  if (typeof v3ShUni === 'function') v3ShUni(gl, U, !LM);
  // 楼房、机场设施
  for (const c of V3P.B || []) { const VV = V3P.VL[c.v]; v3pDrawVar(VV.V, VV.pk, c.b, c.n, undefined, VV); }
  // 近处的树、灌木、岩石
  for (const [v, a] of V3P.per) {
    if (!a.n) continue;
    const VV = V3P.VL[v];
    gl.uniform1f(U.uSway, VV.veg ? 1 : 0);
    v3pDrawVar(VV.V, VV.pk, a.b, a.n, undefined, VV);
  }
  gl.uniform1f(U.uSway, 0);
  // 远处的树：替身（近处那几棵在着色器里丢掉）
  const I = V3P.imp;
  if (I && V3P.far && V3P.far.length) {
    gl.uniform1f(U.uImp, 1); gl.uniform1f(U.uFol, 1); gl.uniform1f(U.uGlass, 0); gl.uniform1f(U.uEdge, 0); gl.uniform4f(U.uCol, 1, 1, 1, 1); gl.uniform1f(U.uCut, .5);
    gl.uniform4fv(U.uImpF, I.F); gl.uniform4fv(U.uImpT, I.T); gl.uniform4fv(U.uImpX, I.X);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, I.tex);
    gl.bindBuffer(gl.ARRAY_BUFFER, I.mb);
    gl.enableVertexAttribArray(A.p); gl.vertexAttribPointer(A.p, 3, gl.FLOAT, false, 44, 0);
    gl.enableVertexAttribArray(A.n); gl.vertexAttribPointer(A.n, 3, gl.FLOAT, false, 44, 12);
    gl.enableVertexAttribArray(A.t); gl.vertexAttribPointer(A.t, 2, gl.FLOAT, false, 44, 24);
    gl.enableVertexAttribArray(A.b); gl.vertexAttribPointer(A.b, 3, gl.FLOAT, false, 44, 32);
    const X = V3P.ext, sb = LM && V3SH.box;   // 阴影这一遍：只画阴影范围里的块
    for (const c of V3P.far) {
      if (sb ? c.bb[2] < sb[0] || c.bb[0] > sb[2] || c.bb[3] < sb[1] || c.bb[1] > sb[3] : Math.hypot(Math.max(c.bb[0] - ex, 0, ex - c.bb[2]), Math.max(c.bb[1] - ey, 0, ey - c.bb[3])) > fe) continue;   // 整块在雾外
      gl.bindBuffer(gl.ARRAY_BUFFER, c.b);
      gl.enableVertexAttribArray(A.iA); gl.vertexAttribPointer(A.iA, 4, gl.FLOAT, false, 32, 0); X.vertexAttribDivisorANGLE(A.iA, 1);
      gl.enableVertexAttribArray(A.iB); gl.vertexAttribPointer(A.iB, 4, gl.FLOAT, false, 32, 16); X.vertexAttribDivisorANGLE(A.iB, 1);
      X.drawArraysInstancedANGLE(gl.TRIANGLES, 0, I.mn, c.n);
    }
    X.vertexAttribDivisorANGLE(A.iA, 0); X.vertexAttribDivisorANGLE(A.iB, 0);
    gl.disableVertexAttribArray(A.iA); gl.disableVertexAttribArray(A.iB);
    gl.uniform1f(U.uImp, 0);
  }
  for (const k of ['p', 'n', 't', 'b']) gl.disableVertexAttribArray(A[k]);
  if (V3.tex) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, V3.tex); }   // 地形的俯视贴图在 0 号纹理单元
}
