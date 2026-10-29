'use strict';
// 3D 里带贴图的精细兵种模型（坦克、装甲车、飞机、舰艇）：免费可商用的真实模型（CC BY，作者与来源见 V3U_LIST，设置面板「素材致谢」里列出），
//   用 tools/mdl/tbuild.mjs 离线转换成 assets/models/<id>.bin + 贴图（格式同地图物件，v3props.js v3pParse 解析）；
//   车辆拆成车体 hull、炮塔 tur 两个变体（炮塔绕转轴 piv 转，坐标原点是整车底面中心）；
//   第一次用到时后台下载，下载好之前（或下载失败、设置里关掉、离得远）仍画游戏自己的模型（v3units.js）
// 实例参数与 v3units.js 的模型完全一样（位置、朝向、比例、阵营、滚转、俯仰），着色也照它：黑绿画风按贴图深浅调暗实体 + 发光棱线，写实画风用贴图本色
const V3U_LIST = {
  u_m1a2s: { name: 'M1A2 SEPv2 主战坦克', title: 'M1A2 SEPV2 Abrams Main Battle Tank DC', author: 'Muhamad Mirza Arrafi', license: 'CC BY 4.0', url: 'https://sketchfab.com/3d-models/m1a2-sepv2-abrams-main-battle-tank-dc-bcc1741c924d4c259dbc801de9b5c1bb' },
  u_m109a6: { name: 'M109A6 自行榴弹炮', title: 'M109A6 Paladin Self-Propelled Howitzer', author: 'Muhamad Mirza Arrafi', license: 'CC BY 4.0', url: 'https://sketchfab.com/3d-models/m109a6-paladin-self-propelled-howitzer-7bc24252d4b84ac5bb7fd3b67f119b0a' },
  u_stryker: { name: '斯特赖克装甲车', title: 'M1126 Infantry Carrier Vehicle', author: 'cenobyte', license: 'CC BY 4.0', url: 'https://sketchfab.com/3d-models/m1126-infantry-carrier-vehicle-b0c559a02c1842b0976a241c9a998360' },
  u_t625: { name: '625 型弹炮防空系统', title: 'Type-625 Anti Aircraft Gun Missile System', author: 'Muhamad Mirza Arrafi', license: 'CC BY 4.0', url: 'https://sketchfab.com/3d-models/type-625-anti-aircraft-gun-missile-system-8b7e85f45b954592bd4bb8e72cdd6312' },
  u_vt5: { name: '15 式轻型坦克（VT-5）', title: 'VT-5 Tank', author: 'Nieve5677', license: 'CC BY 4.0', url: 'https://sketchfab.com/3d-models/vt-5-tank-df1e74dbddb44cbbb9d359422a81d587' },
  u_m1a2: { name: 'M1A2 主战坦克', title: 'General Dynamics M1A2 Abrams Main Battle Tank', author: 'Muhamad Mirza Arrafi', license: 'CC BY 4.0', url: 'https://sketchfab.com/3d-models/general-dynamics-m1a2-abrams-main-battle-tank-10a16c96ca8b4ebc855915f5d5202046' },
  u_milpack: { name: '99A 主战坦克', title: '军事装甲车坦克 Military armored vehicle and tank', author: '小王子', license: 'CC BY 4.0', url: 'https://sketchfab.com/3d-models/military-armored-vehicle-and-tank-f809eb8491e64efc92b1b41687e8da08' },
  u_type80: { name: 'ZTZ-80 主战坦克', title: '[OD] Type-80 MBT basic', author: 'EXcaliburK117', license: 'Sketchfab Free Standard', url: 'https://sketchfab.com/3d-models/od-type-80-mbt-basic-7e9652d9872a4ff1a724d025952ced0f' },
  u_brad4: { name: 'M2A3 布雷德利步兵战车', title: "Low Poly M2 Bradley Free Model", author: "Lasha-Georgy Bajadze", license: 'CC BY 4.0', url: 'https://sketchfab.com/3d-models/low-poly-m2-bradley-free-model-f5fbaf2aa97641b082e8d2acc91092a3' },
  u_aav7: { name: 'AAV-7 两栖突击车', title: "AAV7", author: "unbekanntespezies", license: 'CC BY 4.0', url: 'https://sketchfab.com/3d-models/aav7-yC4xcavDg89GZgqjJtUs5KYbrgz' },
  u_jltv: { name: 'JLTV 联合轻型战术车', title: "JLTV", author: "ALI1388", license: 'CC BY 4.0', url: 'https://sketchfab.com/3d-models/jltv-429bf4a57386462db28781d910511e40' },
  u_cram: { name: '「百夫长」陆基密集阵', title: "Centurion C-RAM", author: "Muhamad Mirza Arrafi", license: 'CC BY 4.0', url: 'https://sketchfab.com/3d-models/centurion-c-ram-10ea7349c7574ca7a43991eece92c9a9' },
  u_e2d: { name: '空警-600（用 E-2D 外形代替，去掉原机标志）', title: "Grumman E-2D Advanced Hawkeye", author: "Muhamad Mirza Arrafi", license: 'CC BY 4.0', url: 'https://sketchfab.com/3d-models/grumman-e-2d-advanced-hawkeye-0082cf8f15044cfd80ebd4e11b96789d' },
  u_su33: { name: '歼-15（用 Su-33 外形代替，改成海军灰）', title: "Sukhoi Su-33 Сухой Су-33", author: "andertan", license: 'CC BY 4.0', url: 'https://sketchfab.com/3d-models/sukhoi-su-33-33-d80603a8a13b49bda90f19d80cac61d4' },
  u_h6m: { name: '轰-6 轰炸机', title: "Xian H-6 Strategic Bomber", author: "Muhamad Mirza Arrafi", license: 'CC BY 4.0', url: 'https://sketchfab.com/3d-models/xian-h-6-strategic-bomber-07b448a2e9924f48a5fc1c91529f2280' },
  u_x47b: { name: '攻击-11（用 X-47B 外形代替，去掉原机标志）', title: "Northrop Grumman X-47B", author: "Yakudami", license: 'CC BY 4.0', url: 'https://sketchfab.com/3d-models/northrop-grumman-x-47b-8d5fa8ab10ba4b8486d40248eeb9332d' },
  u_mq9: { name: 'MQ-9 无人机', title: "MQ-9 Reaper", author: "Tyler V Howell", license: 'CC BY 4.0', url: 'https://sketchfab.com/3d-models/mq-9-reaper-eff549610fee4f20904f7b388a3a0830' },
  u_f35: { name: 'F-35 战斗机', title: "Lockheed Martin F35 Lightning II", author: "andertan", license: 'CC BY 4.0', url: 'https://sketchfab.com/3d-models/lockheed-martin-f35-lightning-ii-db911de503c74285a8d506951df786d6' },
  u_f22: { name: 'F-22 战斗机', title: "Lockheed Martin F-22 \"Raptor\"", author: "andertan", license: 'CC BY 4.0', url: 'https://sketchfab.com/3d-models/lockheed-martin-f-22-raptor-7e7b3c372e374dda98e70208d09cfdcf' },
  u_a10: { name: 'A-10 攻击机', title: "A-10 ThunderBolt II", author: "KOG_THORNS", license: 'CC BY 4.0', url: 'https://sketchfab.com/3d-models/a-10-thunderbolt-ii-623514b5f1f9483a9bbee7f25da77468' },
  u_ah64: { name: 'AH-64 武装直升机', title: "Boeing AH-64D Apache Combat Helicopter", author: "Muhamad Mirza Arrafi", license: 'CC BY 4.0', url: 'https://sketchfab.com/3d-models/boeing-ah-64d-apache-combat-helicopter-c3b58008c46b45048fdd7dd283a3c8c8' },
  u_uh60m: { name: 'UH-60 通用直升机', title: "Sikorsky UH-60M Blackhawk", author: "Muhamad Mirza Arrafi", license: 'CC BY 4.0', url: 'https://sketchfab.com/3d-models/sikorsky-uh-60m-blackhawk-12b4e525676a49678ac3006b360c8750' },
  u_c17: { name: 'C-17 运输机', title: "C17 Globemaster III", author: "AnirudhRao", license: 'CC BY 4.0', url: 'https://sketchfab.com/3d-models/c17-globemaster-iii-597e0d7f9e3446719a2f2de3dd3fa67d' },
  u_b2b: { name: 'B-2 轰炸机', title: "[PBR] B-2 Spirit", author: "Immersive3D", license: 'CC BY 4.0', url: 'https://sketchfab.com/3d-models/pbr-b-2-spirit-b16592b1083948a49ae2afa90d190a08' },
  u_p8: { name: 'P-8 巡逻机', title: "Boeing P-8 Poseidon", author: "Muhamad Mirza Arrafi", license: 'CC BY 4.0', url: 'https://sketchfab.com/3d-models/boeing-p-8-poseidon-3fc134024b69403bb5df5ab3aff48919' },
  u_t054a: { name: '054A 型护卫舰', title: "Type-054A Class Frigate", author: "Muhamad Mirza Arrafi", license: 'CC BY 4.0', url: 'https://sketchfab.com/3d-models/type-054a-class-frigate-948cca64a5274644a35e4600e023d61d' },
  u_ddg125: { name: '阿利·伯克级驱逐舰（Flight III）', title: "USS Jack H. Lucas DDG-125", author: "SB-129", license: 'CC BY 4.0', url: 'https://sketchfab.com/3d-models/uss-jack-h-lucas-ddg-125-1c9229b49915454c8ff22605f8cc7b66' },
  u_cg47: { name: '提康德罗加级巡洋舰', title: "Ticonderoga Missile Cruiser", author: "waelXcm", license: 'CC BY 4.0', url: 'https://sketchfab.com/3d-models/ticonderoga-missile-cruiser-397bd2b7bcd946e4b508869f4ca1e1cf' },
  u_lcs2: { name: '独立级濒海战斗舰', title: "USS INDEPENDENCE  LCS-2", author: "Muhamad Mirza Arrafi", license: 'CC BY 4.0', url: 'https://sketchfab.com/3d-models/uss-independence-lcs-2-7db04398d9524a36a6e08bead0050b76' }
};
// 游戏里的车型（models.js RLM 键）→ 外部模型；piv：炮塔转轴在车体坐标里的位置（米，x 向前、y 向右），与 tools/mdl/sources.json 的 split.piv 相同
const V3U_VEH = {
  ztz99a: { id: 'u_milpack', piv: [-2.8, 0] },
  ztq15: { id: 'u_vt5', piv: [-1.382, 0] },
  ztz96b: { id: 'u_type80', piv: [-1.45, 0] },   // 中型坦克（原 ZTZ-96B，换成 ZTZ-80 外形）
  pgl625: { id: 'u_t625', piv: [-1.9, 0] },
  m1a2: { id: 'u_m1a2s', piv: [-.3, 0] },
  m1a1: { id: 'u_m1a2', piv: [-1.2, 0] },   // M1A1 与 M1A2 外形几乎一样（差在车长独立热像仪），用较轻的那个模型
  m109: { id: 'u_m109a6', piv: [-2.501, 0] },
  m1134: { id: 'u_stryker', piv: [.3, .8] }, m1127: { id: 'u_stryker', piv: [.3, .8] }, mshorad: { id: 'u_stryker', piv: [.3, .8] },
  m2a3: { id: 'u_brad4', piv: [-.511, .248] }, aav7: { id: 'u_aav7', piv: [0, 0] }, jltv: { id: 'u_jltv', piv: [0, 0] }, lpws: { id: 'u_cram', piv: [-.55, -.65], L: 6.5 }   // L：按这个车长缩放（自带模型连拖车算车长，模型只有炮座：给个等效车长，比例与坦克一致）
};
// 飞机：游戏里的机型键（carrier.js airSilKey、v3units.js EA_K）→ 外部模型；zc：机身中线离机轮着地点多高（米，空中按机身中线对准飞行高度）
//   piv：直升机主旋翼桨毂（变体 tur 绕它转）；deck：舰载机在甲板 / 机场地勤作业时仍画自带模型（折翼、座舱盖开合、飞行员登机都在那上面），只在空中换
//   gp：机场外加油弹药点停放时也用（直升机）
const V3U_AIR = {
  kj600: { id: 'u_e2d', zc: 2.4, wings: { wl: [.2, -5.3, 3.2], wr: [.2, 5.3, 3.2] }, props: { pl: [3.9, -3.3, 2.95], pr: [3.9, 3.3, 2.95] } },   // E-2 外形改的空警-600：外翼斜轴折叠、螺旋桨转 j15: { id: 'u_su33', zc: 1.5, deck: true }, gj11: { id: 'u_x47b', zc: 2.1, deck: true },
  h6k: { id: 'u_h6m', zc: 1.7 },
  mq9: { id: 'u_mq9', zc: 1.55 }, f35: { id: 'u_f35', zc: 2.2 }, f35b: { id: 'u_f35', zc: 2.2 }, f22: { id: 'u_f22', zc: 1 }, a10: { id: 'u_a10', zc: 2.1 },
  ah64: { id: 'u_ah64', zc: 1.8, piv: [1.95, 0], gp: true }, uh60: { id: 'u_uh60m', zc: 2.1, piv: [2, 0], gp: true },
  c17: { id: 'u_c17', zc: 4.6 }, b2: { id: 'u_b2b', zc: 3.1 }, p8: { id: 'u_p8', zc: 3.8 }
};
// 舰艇：舰型（v3units.js：我方 vls.js vlsCls 的 052D / 054A……，守方 navy.js NV_CLS 的 ddg / cg……）→ 外部模型；原点在水线、x 向船头；dz：水线再往下压多少（米）
const V3U_SHIP = { '054A': { id: 'u_t054a', dz: -.9 }, ddg: { id: 'u_ddg125' }, ddg3: { id: 'u_ddg125' }, cg: { id: 'u_cg47' }, lcs: { id: 'u_lcs2' } };
const V3U = { tried: false, ok: false, pr: null, a: {}, u: {}, packs: new Map(), inst: new Map(), ib: null, fr: 0 };
// 多远以内画精细模型（再远就画自带的简化模型：省三角形，远处也看不出差别）
const V3U_NEAR = () => (typeof V3 === 'object' && V3.coarse ? 220 : typeof SETTINGS === 'object' && SETTINGS && SETTINGS.quality === 'low' ? 260 : 420) * clamp(Math.sqrt(typeof v3RD === 'function' ? v3RD() : 1), .8, 1.4);

const V3U_VS = `attribute vec3 p; attribute vec3 n; attribute vec2 t; attribute vec3 b; attribute vec4 iA; attribute vec4 iB;
uniform mat4 uM; uniform vec3 uEye;
varying vec3 vN, vB, vV; varying vec2 vT; varying float vSide, vD;
${typeof V3_SHV === 'string' ? V3_SHV : ''}
void main() {
  float c = cos(iA.w), sn = sin(iA.w), cr = cos(iB.z), sr = sin(iB.z), cp = cos(iB.w), sp = sin(iB.w);
  vec3 q = p * iB.x; q = vec3(q.x, q.y * cr - q.z * sr, q.y * sr + q.z * cr); q = vec3(q.x * cp - q.z * sp, q.y, q.x * sp + q.z * cp);
  vec3 m = vec3(n.x, n.y * cr - n.z * sr, n.y * sr + n.z * cr); m = vec3(m.x * cp - m.z * sp, m.y, m.x * sp + m.z * cp);
  vec3 w = vec3(iA.x + q.x * c - q.y * sn, iA.y + q.x * sn + q.y * c, iA.z + q.z);
  vN = vec3(m.x * c - m.y * sn, m.x * sn + m.y * c, m.z); vB = b; vT = t; vSide = iB.y; vV = uEye - w; vD = length(vV);
  ${typeof V3_SHV === 'string' ? 'vSh = uShM * vec4(w, 1.);' : ''}
  gl_Position = uM * vec4(w, 1.);
}`;
const V3U_FS = der => `${der ? '#extension GL_OES_standard_derivatives : enable\n#define DER 1\n' : ''}precision mediump float;
uniform sampler2D uTex; uniform vec4 uCol; uniform float uCut, uGlass, uMode, uHl; uniform vec3 uHlC;
uniform vec2 uFog; uniform vec3 uBg, uBody0, uBody1, uBody2, uGlow0, uGlow1, uGlow2;
varying vec3 vN, vB, vV; varying vec2 vT; varying float vSide, vD;
${typeof V3_SHF === 'string' ? V3_SHF : 'float shadowAt() { return 1.; }'}
void main() {
  vec4 tx = texture2D(uTex, vT) * uCol;
  if (tx.a < uCut) discard;
  float hl = step(7.5, vSide), sd = vSide - hl * 8.;   // 阵营号 + 8：选中编队的成员（selfx.js），全身发光
  bool ours = sd < .5 || (sd > 2.5 && sd < 3.5), dead = sd > 1.5 && sd < 2.5;   // 0 / 3 我方、1 / 4 敌方、2 残骸
  vec3 body = ours ? uBody0 : dead ? uBody2 : uBody1, glow = ours ? uGlow0 : dead ? uGlow2 : uGlow1;
  vec3 N = normalize(vN), V = normalize(vV);
  if (dot(N, V) < -.2 && !gl_FrontFacing) N = -N;   // 双面材质的背面
  float lit = clamp(dot(N, ${typeof V3_SUNG === 'string' ? V3_SUNG : 'normalize(vec3(-.45, .55, .7))'}), 0., 1.), up = clamp(N.z, 0., 1.);
  float e = min(min(vB.x, vB.y), vB.z);
#ifdef DER
  float w = max(fwidth(e), 1e-4), ed = 1. - smoothstep(w * .6, w * 1.9, e);
#else
  float ed = 1. - smoothstep(.015, .06, e);
#endif
  float rim = pow(1. - clamp(abs(dot(N, V)), 0., 1.), 3.);
  vec3 c;
  if (uMode < .5) {   // 黑绿：深色实体（按贴图深浅）+ 发光棱线 + 边缘光；玻璃发光
    float l = dot(tx.rgb, vec3(.3, .59, .11));
    c = body * (.45 + .95 * lit + .25 * up) * (.5 + 1.1 * l) + glow * ed * .75 + glow * rim * .22;
    if (uGlass > .5) c += glow * .6;
  } else {   // 写实：贴图本色受日光、半球天光，残骸烧黑；边缘描一道很淡的阵营色
    vec3 alb = dead ? tx.rgb * .16 + vec3(.025, .022, .02) : tx.rgb;
    c = alb * (mix(vec3(.3, .29, .27), vec3(.45, .5, .58), N.z * .5 + .5) + vec3(1., .95, .86) * lit * .82 * shadowAt()) * (1. - ed * .12) + (dead ? vec3(0.) : glow * rim * .1);
    if (uGlass > .5) c = mix(c, vec3(.36, .48, .56), .55) + vec3(.5, .55, .6) * rim * .5;
  }
  if (hl > .5) c += uHlC * uHl * (.28 + .9 * rim + .55 * ed);
  gl_FragColor = vec4(mix(c, uBg, smoothstep(uFog.x, uFog.y, vD)), 1.);
}`;
function v3uInit(gl) {
  V3U.tried = true;
  try {
    const der = !!gl.getExtension('OES_standard_derivatives');
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, V3U_VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, V3U_FS(der)));
    gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
    V3U.pr = pr; V3U.gl = gl; V3U.ext = gl.getExtension('ANGLE_instanced_arrays');
    for (const k of ['p', 'n', 't', 'b', 'iA', 'iB']) V3U.a[k] = gl.getAttribLocation(pr, k);
    for (const k of ['uM', 'uEye', 'uTex', 'uCol', 'uCut', 'uGlass', 'uMode', 'uHl', 'uHlC', 'uFog', 'uBg', 'uBody0', 'uBody1', 'uBody2', 'uBody3', 'uBody4', 'uGlow0', 'uGlow1', 'uGlow2', 'uShM', 'uShT', 'uShOn', 'uShP']) V3U.u[k] = gl.getUniformLocation(pr, k);
    V3U.ib = gl.createBuffer();
    V3U.white = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, V3U.white); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    V3U.aniso = gl.getExtension('EXT_texture_filter_anisotropic') || gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic');
    V3U.ok = !!V3U.ext && typeof v3pParse === 'function';   // 没有实例化扩展的老设备：仍画自带模型
  } catch (e) { V3U.ok = false; console.warn('3D 精细兵种模型不可用', e); }
}
// 资源包：下载、解析、上传（每组：位置 3、法线 3、UV 2、棱线坐标 3 = 11 个浮点）、贴图；好了 st = 1，失败 st = -1
function v3uPack(id) {
  let P = V3U.packs.get(id);
  if (P) return P.st === 1 ? P : null;
  P = { id, st: 0, vars: new Map(), mats: [], tex: [] };
  V3U.packs.set(id, P);
  const gl = V3U.gl, v = typeof window === 'object' && window.DS_BUILD ? '?v=' + window.DS_BUILD : '';
  if (typeof fetch !== 'function') { P.st = -1; return null; }
  fetch('assets/models/' + id + '.bin' + v).then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); }).then(buf => {
    const D = v3pParse(buf);
    P.mats = D.mats;
    for (const V of D.vars) P.vars.set(V.name, { bb: V.bb, groups: V.groups.map(g => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, g.data, gl.STATIC_DRAW); return { mi: g.mi, b, n: g.data.length / 11 }; }) });
    let left = D.tex.length;
    const done = () => { if (--left <= 0) P.st = 1; };
    if (!left) P.st = 1;
    D.tex.forEach((fmt, k) => {
      const img = new Image();
      img.onload = () => {
        const t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        const pot = !(img.width & (img.width - 1)) && !(img.height & (img.height - 1));
        if (pot) { gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); if (V3U.aniso) gl.texParameterf(gl.TEXTURE_2D, V3U.aniso.TEXTURE_MAX_ANISOTROPY_EXT, 4); }
        else { gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); }
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        P.tex[k] = t; done();
      };
      img.onerror = () => { P.tex[k] = null; done(); };
      img.src = 'assets/models/' + id + '_' + k + '.' + (fmt ? 'webp' : 'jpg') + v;
    });
  }).catch(e => { P.st = -1; console.warn('精细模型 ' + id + ' 没载入，用自带模型', e); });
  return null;
}
// 这个外部模型现在能画吗（设置开着、着色器可用、已经载入）：能就返回资源包，否则 null（第一次问的时候开始下载）
function v3uOn(id) {
  if (!id || (typeof SETTINGS === 'object' && SETTINGS && SETTINGS.extMdl === false) || !V3.gl) return null;
  if (!V3U.tried) v3uInit(V3.gl);
  return V3U.ok ? v3uPack(id) : null;
}
// 车型的外部模型（好了的话）：{ id, piv, L 车体长（米）}；距离 d 超过近景范围也返回 null（画自带模型）
function v3uVeh(key, d) {
  const E = V3U_VEH[key];
  if (!E || d > V3U_NEAR()) return null;
  const P = v3uOn(E.id), H = P && P.vars.get('hull');
  if (!H) return null;
  if (!E.L) E.L = H.bb[1][0] - H.bb[0][0];
  return E;
}
// 3 × 3 矩阵（行主序）与旋转（GL 坐标：x 东、y 北、z 上）；实例着色器的姿态 = Rz(朝向) · Ry(−俯仰) · Rx(滚转)
const v3uM3 = (a, b) => { const o = []; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o.push(a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j]); return o; };
const v3uRx = t => { const c = Math.cos(t), s = Math.sin(t); return [1, 0, 0, 0, c, -s, 0, s, c]; };
const v3uRy = t => { const c = Math.cos(t), s = Math.sin(t); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
const v3uRz = t => { const c = Math.cos(t), s = Math.sin(t); return [c, -s, 0, s, c, 0, 0, 0, 1]; };
const v3uMv = (M, v) => [M[0] * v[0] + M[1] * v[1] + M[2] * v[2], M[3] * v[0] + M[4] * v[1] + M[5] * v[2], M[6] * v[0] + M[7] * v[1] + M[8] * v[2]];
function v3uAxis(k, t) {   // 绕单位轴 k 转 t（罗德里格斯公式）
  const c = Math.cos(t), s = Math.sin(t), d = 1 - c;
  return [c + k[0] * k[0] * d, k[0] * k[1] * d - k[2] * s, k[0] * k[2] * d + k[1] * s, k[1] * k[0] * d + k[2] * s, c + k[1] * k[1] * d, k[1] * k[2] * d - k[0] * s, k[2] * k[0] * d - k[1] * s, k[2] * k[1] * d + k[0] * s, c + k[2] * k[2] * d];
}
// 姿态矩阵 → v3uAdd 的 [朝向, 滚转, 俯仰]
const v3uEul = R => [-Math.atan2(R[3], R[0]), Math.atan2(R[7], R[8]), Math.asin(clamp(R[6], -1, 1))];
// 斜轴折翼（E-2 / 空警-600）：右翼绕 (−1, 1, 1) 轴转 120° 从水平展开转到贴着机身、翼弦竖直；GL 坐标 y 取反，左翼是右翼的镜像
const V3U_FOLDK = [-1 / Math.sqrt(3), 1 / Math.sqrt(3), 1 / Math.sqrt(3)], V3U_MIR = R => [R[0], -R[1], R[2], -R[3], R[4], -R[5], R[6], -R[7], R[8]];
// 画一架外部模型的飞机（参数同 v3det.js v3dPlaneX）：没有这型、还没载入、离得太远返回 false（照旧画自带模型）
//   sz 游戏里的机型尺寸（机长），ground：z 是地面（机轮着地，放下起落架）；否则 z 是机身中线高度；gear 空中也放着起落架；spin 旋翼转角
function v3uPlane(key, sz, x, y, z, ground, h, side, roll = 0, pitch = 0, gear = false, spin = 0, fold = 0) {   // fold：外翼折起程度 0–1（有 wings 的机型）
  const E = V3U_AIR[key];
  if (!E) return false;
  if (V3U.E && Math.hypot(x - V3U.E[0], -y - V3U.E[1], z - V3U.E[2]) > V3U_NEAR() * 2.4) return false;
  const P = v3uOn(E.id), hn = P && (P.vars.has('hull') ? 'hull' : P.vars.keys().next().value), H = hn && P.vars.get(hn);   // 没拆件的模型只有一个变体（名字是模型号）
  if (!H) return false;
  if (!E.L) E.L = H.bb[1][0] - H.bb[0][0];
  const s = sz / E.L, vn = ground || gear || !P.vars.has('fly') ? hn : 'fly';
  // 与 v3units.js 实例着色器同一约定：先绕 x 滚转、再绕 y 俯仰、再绕 z 转向（GL 坐标 y 取反）
  const ch = Math.cos(-h), sh = Math.sin(-h), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
  const rot = v => { const a = [v[0], v[1] * cr - v[2] * sr, v[1] * sr + v[2] * cr], b = [a[0] * cp - a[2] * sp, a[1], a[0] * sp + a[2] * cp]; return [b[0] * ch - b[1] * sh, b[0] * sh + b[1] * ch, b[2]]; };
  let ox = x, oy = y, oz = z;
  if (!ground) { const o = rot([0, 0, E.zc * s]); ox -= o[0]; oy += o[1]; oz -= o[2]; }   // 机身中线对准 z
  v3uAdd(E.id, vn, ox, oy, oz, h, s, side, roll, pitch);
  if (E.piv && P.vars.has('tur')) { const o = rot([E.piv[0] * s, -E.piv[1] * s, 0]); v3uAdd(E.id, 'tur', ox + o[0], oy - o[1], oz + o[2], h + spin, s, side, roll, pitch); }
  if (E.wings || E.props) {
    const RA = v3uM3(v3uM3(v3uRz(-h), v3uRy(-pitch)), v3uRx(roll)), at = q => { const o = v3uMv(RA, [q[0] * s, -q[1] * s, q[2] * s]); return [ox + o[0], oy - o[1], oz + o[2]]; };
    if (E.wings) {
      const RF = v3uAxis(V3U_FOLDK, clamp(fold, 0, 1) * 2.0944);
      for (const [vn2, q] of Object.entries(E.wings)) {
        if (!P.vars.has(vn2)) continue;
        const [wx, wy, wz] = at(q), [a2, r2, p2] = v3uEul(v3uM3(RA, q[1] > 0 ? V3U_MIR(RF) : RF));
        v3uAdd(E.id, vn2, wx, wy, wz, a2, s, side, r2, p2);
      }
    }
    if (E.props) for (const [vn2, q] of Object.entries(E.props)) { if (!P.vars.has(vn2)) continue; const [px, py, pz] = at(q); v3uAdd(E.id, vn2, px, py, pz, h, s, side, roll + spin * (q[1] > 0 ? 1 : -1), pitch); }
  }
  return true;
}
// 画一艘外部模型的舰艇：len 游戏里的舰长，z 水线高度；没有这型、还没载入返回 false（照旧画自带模型）
function v3uShip(cls, x, y, z, h, len, side) {
  const E = V3U_SHIP[cls];
  if (!E) return false;
  if (V3U.E && Math.hypot(x - V3U.E[0], -y - V3U.E[1], z - V3U.E[2]) > V3U_NEAR() * 4) return false;   // 船大：远一些才换回简化模型
  const P = v3uOn(E.id), hn = P && P.vars.keys().next().value, H = hn && P.vars.get(hn);
  if (!H) return false;
  if (!E.L) E.L = H.bb[1][0] - H.bb[0][0];
  v3uAdd(E.id, hn, x, y, z + (E.dz || 0) * len / E.L, h, len / E.L, side);
  return true;
}
function v3uClear(C) { for (const L of V3U.inst.values()) L.d.length = 0; V3U.fr++; V3U.E = C && C.E; }   // 每帧开头（v3units.js v3mCollect）；记下眼睛位置（远处的飞机画自带模型）
// 一个实例：参数同 v3units.js v3mAdd（x、y 世界坐标，z 高度，a 世界朝向，k 比例，side 阵营，roll 滚转，pitch 俯仰）
function v3uAdd(id, vn, x, y, z, a, k, side, roll = 0, pitch = 0) {
  const key = id + ':' + vn;
  let L = V3U.inst.get(key);
  if (!L) { L = { id, vn, d: [] }; V3U.inst.set(key, L); }
  L.d.push(x, -y, z, -a, k, side, roll, pitch);
}
// 画（阴影图那一遍 LM 是光源矩阵；v3units.js v3mDraw 末尾调用，两遍都画）
function v3uDraw(C, LM) {
  if (!V3U.ok || !V3U.inst.size) return;
  const gl = V3U.gl, A = V3U.a, U = V3U.u, X = V3U.ext;
  let any = false;
  for (const L of V3U.inst.values()) if (L.d.length) { any = true; break; }
  if (!any) return;
  gl.useProgram(V3U.pr);
  gl.uniformMatrix4fv(U.uM, false, LM || C.M);
  gl.uniform3f(U.uEye, C.E[0], C.E[1], C.E[2]);
  gl.uniform2f(U.uFog, ...(typeof v3FogR === 'function' ? v3FogR(C) : [C.D * 1.3, C.D * 2.8]));
  gl.uniform3f(U.uBg, ...(typeof v3Bg === 'function' ? v3Bg() : [.004, .02, .011]));
  if (typeof v3mPalette === 'function') v3mPalette(gl, U);
  if (typeof v3ShUni === 'function') v3ShUni(gl, U, !LM);
  gl.uniform1i(U.uTex, 0); gl.activeTexture(gl.TEXTURE0);
  for (const L of V3U.inst.values()) {
    const n = L.d.length / 8, P = n && V3U.packs.get(L.id), V = P && P.st === 1 && P.vars.get(L.vn);
    if (!V) continue;
    if (L.fr !== V3U.fr) { L.fr = V3U.fr; L.f = new Float32Array(L.d); }   // 这一帧的实例数据只转一次（两遍共用）
    gl.bindBuffer(gl.ARRAY_BUFFER, V3U.ib); gl.bufferData(gl.ARRAY_BUFFER, L.f, gl.DYNAMIC_DRAW);
    for (const g of V.groups) {
      const M = P.mats[g.mi], t = M && M.ti !== 255 ? P.tex[M.ti] : null, bf = M ? M.bf : [1, 1, 1, 1];
      gl.bindTexture(gl.TEXTURE_2D, t || V3U.white);
      gl.uniform1f(U.uCut, M && M.mode === 1 ? Math.max(.3, Math.min(.6, M.cut)) : -1);
      gl.uniform1f(U.uGlass, M && M.mode === 2 ? 1 : 0);
      gl.uniform4f(U.uCol, bf[0], bf[1], bf[2], bf[3]);
      gl.bindBuffer(gl.ARRAY_BUFFER, g.b);
      gl.enableVertexAttribArray(A.p); gl.vertexAttribPointer(A.p, 3, gl.FLOAT, false, 44, 0);
      gl.enableVertexAttribArray(A.n); gl.vertexAttribPointer(A.n, 3, gl.FLOAT, false, 44, 12);
      gl.enableVertexAttribArray(A.t); gl.vertexAttribPointer(A.t, 2, gl.FLOAT, false, 44, 24);
      gl.enableVertexAttribArray(A.b); gl.vertexAttribPointer(A.b, 3, gl.FLOAT, false, 44, 32);
      gl.bindBuffer(gl.ARRAY_BUFFER, V3U.ib);
      gl.enableVertexAttribArray(A.iA); gl.vertexAttribPointer(A.iA, 4, gl.FLOAT, false, 32, 0); X.vertexAttribDivisorANGLE(A.iA, 1);
      gl.enableVertexAttribArray(A.iB); gl.vertexAttribPointer(A.iB, 4, gl.FLOAT, false, 32, 16); X.vertexAttribDivisorANGLE(A.iB, 1);
      X.drawArraysInstancedANGLE(gl.TRIANGLES, 0, g.n, n);
      X.vertexAttribDivisorANGLE(A.iA, 0); X.vertexAttribDivisorANGLE(A.iB, 0);
      gl.disableVertexAttribArray(A.iA); gl.disableVertexAttribArray(A.iB);
    }
  }
  for (const k of ['p', 'n', 't', 'b']) gl.disableVertexAttribArray(A[k]);
  if (V3.tex) gl.bindTexture(gl.TEXTURE_2D, V3.tex);   // 地形的俯视贴图在 0 号纹理单元
}
