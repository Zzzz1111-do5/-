'use strict';
// 驾驶歼-35 时的画面（pilot.js 管飞行与武器）：座舱镜头 / 机后跟随镜头、座舱单独一遍、座舱里的显示器与平显
//   座舱：用的就是外面那架歼-35 的模型（SB-129 的 Shenyang J-35，模型自带座椅、驾驶杆、仪表台、座舱盖与风挡框），按真实比例单独画一遍
//     （先画完整个战场，清掉深度再画自己这架，近裁剪面 3 厘米，凑在眼前的仪表台也不会被切掉、远处的地形也不闪）
//   显示器（「一平三下」：舰载型歼-35 沿用平显 + 三块下显，陆基的歼-35A 才换成一块大横屏）都是每帧按飞机、传感器、武器状态实时画的仪表，不是贴图：
//     平显（广角平显，屏幕空间矢量画，准直到无穷远——符号跟着外景走）：俯仰梯、速度矢量、水平基准、航向带、表速 / 马赫 / 过载、高度、目标框、发射区、告警
//     左下显：战术态势（航向朝上的地图：海岸、友机、友舰、数据链与雷达看到的敌机、已知防空火力圈、母舰方位）
//     中下显：火控雷达（空空：B 型显示，方位 ±60°，扫描线、目标、锁定目标的数据、导弹到达时间；对地：前方地面目标）
//     右下显：武器挂载（主弹舱 4 枚霹雳-15E + 2 枚飞腾-8，两侧弹舱各 1 枚霹雳-10）+ 双发转速、排气温度、燃油
//     前上方控制板：通信、导航（惯导 / 北斗组合）、塔康（母舰方位距离）、主模式、数据链
//     遮光罩两侧两块辅助小屏：备份姿态仪；告警灯与液压
//   显示器的位置按模型的仪表台量出来（模型坐标，米：x 机头、y 左、z 离着地点高）
const CK_EYE = [3.09, 0, 2.64];   // 飞行员眼睛：头靠前约 0.18 米、坐垫上方约 0.77 米
const CK_TILT = -.1;   // 默认视线略低头（看得到平显和下显上沿）
const CK_HUDP = { x: 4.105, y: .17, z0: 2.36, z1: 2.70 };   // 广角平显的组合玻璃（比模型自带的那块大，按广角平显的视场）
// 显示器：四个角（飞行员看过去的 左下、右下、右上、左上），画布图集里的区域 [x, y, 宽, 高]
const CK_D = {
  L: { q: [[4.032, .355, 1.955], [4.032, .185, 1.955], [4.075, .185, 2.13], [4.075, .355, 2.13]], a: [0, 0, 448, 448] },
  C: { q: [[3.987, .1, 1.66], [3.987, -.1, 1.66], [4.018, -.1, 1.86], [4.018, .1, 1.86]], a: [448, 0, 448, 448] },
  R: { q: [[4.032, -.185, 1.955], [4.032, -.355, 1.955], [4.075, -.355, 2.13], [4.075, -.185, 2.13]], a: [0, 448, 448, 448] },
  U: { q: [[3.931, .09, 2.19], [3.931, -.09, 2.19], [3.941, -.09, 2.36], [3.941, .09, 2.36]], a: [448, 448, 256, 240] },
  AL: { q: [[3.99, .366, 2.26], [3.99, .222, 2.26], [4.027, .222, 2.362], [4.027, .366, 2.362]], a: [704, 448, 256, 196] },
  AR: { q: [[3.99, -.222, 2.26], [3.99, -.366, 2.26], [4.027, -.366, 2.362], [4.027, -.222, 2.362]], a: [704, 644, 256, 196] }
};
const CK = { ok: false, tried: false, pr: null, a: {}, u: {}, buf: null, tex: null, cv: null, ctx: null, t: -1, land: null, landSig: null, cam: null, sweep: 0, gmax: 1 };
const CK_FONT = '"IBM Plex Mono", "Noto Sans SC", monospace';
function v3ckReset() { CK.cam = null; CK.gmax = 1; }
// 现在是座舱视角吗（飞行员还在登机、在升降机上时先用机外视角）
const ckIn = () => PC.on && PC.view === 'ck' && !PC.dead && !!PC.p && !(PC.wait && (PC.p.dk === 'brd' || PC.p.dk === 'lift'));

// —— 姿态：这一帧自己这架飞机的朝向、机身中线位置（GL 坐标）；自己飞时按飞行模型，甲板上（等弹射）按甲板位置 ——
function ckPose() {
  const p = PC.p;
  if (!p) return null;
  if (p.pc && typeof pcBody === 'function') { const B = pcBody(); return { h: B.h, pt: B.pt, rl: B.rl, C: PC.P.slice(), gear: PC.gear > 0, deck: false, F: B.F, L: B.L, U: B.U }; }
  const h = p.heading || 0, deck = p.phase === 'cat' || p.phase === 'roll' || p.phase === 'trap';
  let z;
  if (deck) { const c = typeof cvOf === 'function' ? cvOf(typeof cvHome === 'function' ? cvHome(p) : 0) || S.cv : S.cv, sink = typeof cvDeckSink === 'function' ? cvDeckSink(p) : 0; z = -2.6 + (typeof CVG === 'object' ? CVG.zd - CVG.hang * sink : 17); }
  else z = typeof v3AirZ === 'function' ? v3AirZ(p) : 200;
  const pt = deck ? 0 : typeof v3dPitchOf === 'function' ? v3dPitchOf(p, 0) : 0, rl = deck ? 0 : p.bank || 0, R = ckR(h, pt, rl);
  return { h, pt, rl, C: [p.x, -p.y, z], gear: deck || (p.alt ?? 1) < .2, deck, F: [R[0], R[3], R[6]], L: [R[1], R[4], R[7]], U: [R[2], R[5], R[8]] };
}
// 与 v3units.js 实例着色器同一个旋转：先绕 x 滚转、再绕 y 俯仰、再绕 z 转（GL 角 = −世界航向）；行主序 3 × 3
function ckR(h, pt, rl) { return v3dMul(v3dMul(v3dRz(-h), v3dRy(pt)), v3dRx(rl)); }
// 这架飞机的模型（收 / 放起落架）与原点（着地点）：空中时机身中线对准 C（v3det.js v3dPlaneX 同一算法），甲板上 C 就是着地点
function ckModel(P) {
  const key = P.gear ? 'j35' : 'j35_a', M = typeof v3xMesh === 'function' ? v3xMesh(key) : null;
  if (!M) return null;
  const R = ckR(P.h, P.pt, P.rl), o = P.deck ? [0, 0, 0] : v3dMv(R, [0, 0, M.zc]);
  return { key, M, R, O: [P.C[0] - o[0], P.C[1] - o[1], P.C[2] - o[2]] };
}
const ckMv = (R, v) => [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]];

// —— 镜头（view3d.js v3Camera 在驾驶时改调这里）——
function ckCamera() {
  const P = ckPose();
  if (!P) return v3FcCamera();
  const X = ckModel(P), asp = CAM.vw / Math.max(1, CAM.vh), ck = ckIn() && !!X;
  let E, x, y, z, fov;
  if (ck) {
    // 座舱：眼睛在模型的座舱里，跟着机体转；鼠标转头（左右 ±150°、上下），按住右键 / Z 拉近
    const R = X.R, e = ckMv(R, CK_EYE), ps = PC.look[0], th = PC.look[1] + CK_TILT, cp = Math.cos(th);
    const d = ckMv(R, [cp * Math.cos(ps), cp * Math.sin(ps), Math.sin(th)]), up = ckMv(R, [-Math.sin(th) * Math.cos(ps), -Math.sin(th) * Math.sin(ps), Math.cos(th)]);
    E = [X.O[0] + e[0], X.O[1] + e[1], X.O[2] + e[2]]; z = [-d[0], -d[1], -d[2]]; x = v3Norm(v3Cross(up, z)); y = v3Cross(z, x);
    fov = lerp(1.2, .52, PC.zoom);
    CK.eRel = e;
  } else {
    // 机后跟随：在飞机后上方约 36 米（只跟航向，不跟着滚转，地平线不歪），鼠标绕着转；被击落时看着坠落处
    const h = P.h + Math.PI + PC.orbit[0], op = PC.orbit[1], D = PC.dead ? 70 : 38, T = PC.dead && PC.p ? ckWreck() || P.C : P.C;
    const want = [T[0] + Math.cos(-h) * Math.cos(op) * D, T[1] + Math.sin(-h) * Math.cos(op) * D, T[2] - Math.sin(op) * D + 4];
    if (!CK.cam || CK.camV !== 'ext') CK.cam = want.slice();
    for (let i = 0; i < 3; i++) CK.cam[i] += (want[i] - CK.cam[i]) * .25;
    const g = v3Gnd(clamp(CK.cam[0], 0, W - 1), clamp(-CK.cam[1], 0, H - 1)) + 3; if (CK.cam[2] < g) CK.cam[2] = g;
    E = CK.cam.slice(); const f = v3Norm([T[0] - E[0], T[1] - E[1], T[2] + 2 - E[2]]);
    z = [-f[0], -f[1], -f[2]]; x = v3Norm(v3Cross([0, 0, 1], z)); y = v3Cross(z, x);
    fov = lerp(.95, .5, PC.zoom);
  }
  CK.camV = ck ? 'ck' : 'ext';
  const view = new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -v3Dot(x, E), -v3Dot(y, E), -v3Dot(z, E), 1]);
  const agl = Math.max(1, E[2] - v3Gnd(clamp(E[0], 0, W - 1), clamp(-E[1], 0, H - 1))), D = clamp(agl * 4 + 600, 700, 2800), rd = v3RD(), fog = [D * 1.3 * rd, D * 2.8 * rd];
  const fo = 1 / Math.tan(fov / 2), n = ck ? .5 : 1, fa = Math.max(D * 9, fog[1] * 1.5), nf = 1 / (n - fa);
  const proj = new Float32Array([fo / asp, 0, 0, 0, 0, fo, 0, 0, 0, 0, (fa + n) * nf, -1, 0, 0, 2 * fa * n * nf, 0]);
  const C = V3.cam = { E, x, y, z, D, rd, fog, asp, fo, M: v3Mul(proj, view), ck: null };
  if (ck) {   // 座舱那一遍：以本机原点为原点（数小，近处不抖），近裁剪面 3 厘米
    const Er = CK.eRel, vr = new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -v3Dot(x, Er), -v3Dot(y, Er), -v3Dot(z, Er), 1]);
    const n2 = .03, f2 = 90, nf2 = 1 / (n2 - f2), pr2 = new Float32Array([fo / asp, 0, 0, 0, 0, fo, 0, 0, 0, 0, (f2 + n2) * nf2, -1, 0, 0, 2 * f2 * n2 * nf2, 0]);
    C.ck = { M: v3Mul(pr2, vr), E: Er, X, P };
  }
  // 画面中心（俯视贴图、细节档按它）：视线落地点，缩放按离地高度（同观察者模式）
  const fx = -z[0], fy = z[1], cp = Math.hypot(fx, fy) || 1, down = z[2], reach = down > .08 ? Math.min(1600, agl / down * cp) : 900;
  CAM.x = clamp(E[0] + fx / cp * reach, 0, W); CAM.y = clamp(-E[1] + fy / cp * reach, 0, H);
  CAM.z = CAM.fit * clamp(1800 / Math.max(60, agl + reach * .35), 1.2, 9);
  return C;
}
// 被击落：残骸此刻的位置（GL）
function ckWreck() {
  const p = PC.p, L = (S.air && S.air.wrecks) || [];
  const w = L.find(o => Math.abs(o.t - PC.deadT) < .2 && dist(o.x, o.y, p.x, p.y) < 80);
  if (!w || typeof v3WreckAt !== 'function') return null;
  const Q = v3WreckAt(w, Math.min(2.2, S.t - w.t), 2.2);
  return [Q.x, -Q.y, Q.z];
}

// —— 座舱那一遍（view3d.js v3Draw 在立体弹道之后、贴回主画布之前调）——
const CK_VS = `attribute vec3 p; attribute vec2 uv; uniform mat4 uM; uniform mat3 uR; varying vec2 vU; void main() { vU = uv; gl_Position = uM * vec4(uR * p, 1.); }`;
const CK_FS = `precision mediump float; uniform sampler2D uT; uniform vec4 uC; uniform float uK; varying vec2 vU;
void main() { vec3 c = texture2D(uT, vU).rgb; gl_FragColor = uK > .5 ? vec4(c * 1.05 + vec3(.012, .016, .02), 1.) : uC; }`;
function ckInit(gl) {
  CK.tried = true;
  try {
    const sh = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, CK_VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, CK_FS)); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
    CK.pr = pr; for (const k of ['p', 'uv']) CK.a[k] = gl.getAttribLocation(pr, k); for (const k of ['uM', 'uR', 'uT', 'uC', 'uK']) CK.u[k] = gl.getUniformLocation(pr, k);
    CK.buf = gl.createBuffer(); CK.tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE10); gl.bindTexture(gl.TEXTURE_2D, CK.tex);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    CK.cv = document.createElement('canvas'); CK.cv.width = CK.cv.height = 1024; CK.ctx = CK.cv.getContext('2d');
    // 显示器四边形（模型坐标、图集 UV）：每块 2 个三角形；平显组合玻璃另画
    const V = [], uv = (D, u, v) => [(D.a[0] + u * D.a[2]) / 1024, (D.a[1] + v * D.a[3]) / 1024];
    for (const k in CK_D) { const D = CK_D[k], q = D.q, t = [uv(D, 0, 1), uv(D, 1, 1), uv(D, 1, 0), uv(D, 0, 0)]; for (const i of [0, 1, 2, 0, 2, 3]) V.push(...q[i], ...t[i]); }
    const H = CK_HUDP; for (const [y, z] of [[H.y, H.z0], [-H.y, H.z0], [-H.y, H.z1], [H.y, H.z0], [-H.y, H.z1], [H.y, H.z1]]) V.push(H.x, y, z, 0, 0);
    CK.nD = Object.keys(CK_D).length * 6;
    gl.bindBuffer(gl.ARRAY_BUFFER, CK.buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(V), gl.STATIC_DRAW);
    CK.ok = true;
  } catch (e) { CK.ok = false; console.warn('座舱显示器不可用', e); }
}
function ckPass(C) {
  if (!PC.on || !C || !C.ck || typeof V3M !== 'object' || !V3M.ok) return;
  const gl = V3.gl, K = C.ck, X = K.X, P = K.P;
  if (!CK.tried) ckInit(gl);
  gl.clear(gl.DEPTH_BUFFER_BIT);
  // 自己这架：真实比例、以原点为原点；不要座舱里的飞行员（镜头就在他眼睛里），座舱盖玻璃最后透明地画
  const m = v3mGet('ck:' + X.key, () => X.M), U = V3M.u;
  gl.useProgram(V3M.pr);
  gl.uniformMatrix4fv(U.uM, false, K.M); gl.uniform3f(U.uEye, K.E[0], K.E[1], K.E[2]);
  gl.uniform2f(U.uFog, 1e5, 2e5); gl.uniform3f(U.uBg, ...v3Bg());
  v3mPalette(gl); v3ShUni(gl, U, false); gl.uniform1f(U.uHl, 0); gl.uniform1f(U.uGP, 0);
  const inst = [new Float32Array([0, 0, 0, -P.h, 1, 3, P.rl, P.pt])];   // 实例朝向是 GL 角（= −世界航向，同 v3mAdd）
  v3mDrawM(gl, m, inst[0], 1, false);
  // 平尾（全动）：按杆量偏转
  const Mg = typeof v3xMesh === 'function' ? v3xMesh('j35') : null, sf = PC.p && PC.p.pcA ? PC.p.pcA : { de: 0, da: 0 };
  if (Mg && Mg.parts) for (const nm in Mg.parts) for (const sd of ['L', 'R']) {
    const Pm = V3X.mesh['j35_' + nm + sd];
    if (!Pm) { v3xMesh('j35_' + nm + sd); continue; }
    const [px, pz] = Mg.parts[nm], d = (sf.de || 0) + (sd === 'L' ? sf.da || 0 : -(sf.da || 0)), Rp = v3dMul(X.R, v3dRy(d)), o = v3dMv(X.R, [px, 0, pz]);
    const mp = v3mGet('ck:j35_' + nm + sd, () => Pm);
    v3mDrawM(gl, mp, new Float32Array([o[0], o[1], o[2], Math.atan2(Rp[3], Rp[0]), 1, 3, Math.atan2(Rp[7], Rp[8]), Math.asin(clamp(Rp[6], -1, 1))]), 1, false);
  }
  for (const k of ['p', 'n', 's', 'b']) gl.disableVertexAttribArray(V3M.a[k]);
  // 显示器：每 1/20 秒重画一次图集
  if (CK.ok) {
    if (performance.now() - CK.t > 50) { CK.t = performance.now(); ckPaint(); gl.activeTexture(gl.TEXTURE10); gl.bindTexture(gl.TEXTURE_2D, CK.tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, CK.cv); }
    gl.useProgram(CK.pr);
    const R = X.R, R3 = new Float32Array([R[0], R[3], R[6], R[1], R[4], R[7], R[2], R[5], R[8]]);   // 列主序
    gl.uniformMatrix4fv(CK.u.uM, false, K.M); gl.uniformMatrix3fv(CK.u.uR, false, R3);
    gl.activeTexture(gl.TEXTURE10); gl.bindTexture(gl.TEXTURE_2D, CK.tex); gl.uniform1i(CK.u.uT, 10);
    gl.bindBuffer(gl.ARRAY_BUFFER, CK.buf);
    gl.enableVertexAttribArray(CK.a.p); gl.vertexAttribPointer(CK.a.p, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(CK.a.uv); gl.vertexAttribPointer(CK.a.uv, 2, gl.FLOAT, false, 20, 12);
    gl.uniform1f(CK.u.uK, 1); gl.drawArrays(gl.TRIANGLES, 0, CK.nD);
    // 平显组合玻璃：淡淡的绿色镀膜
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
    gl.uniform1f(CK.u.uK, 0); gl.uniform4f(CK.u.uC, .25, .75, .45, .07); gl.drawArrays(gl.TRIANGLES, CK.nD, 6);
    gl.depthMask(true); gl.disable(gl.BLEND);
    gl.disableVertexAttribArray(CK.a.p); gl.disableVertexAttribArray(CK.a.uv);
  }
  // 座舱盖玻璃：透明那一遍（uGP 2：从里往外看更通透）
  if (m.gl) {
    gl.useProgram(V3M.pr);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); gl.uniform1f(U.uGP, 2);
    v3mDrawM(gl, m, inst[0], 1, true);
    gl.depthMask(true); gl.disable(gl.BLEND); gl.uniform1f(U.uGP, 0);
    for (const k of ['p', 'n', 's', 'b']) gl.disableVertexAttribArray(V3M.a[k]);
  }
}

// —— 显示器的内容（画进 1024 × 1024 图集）——
const CKC = { bg: '#04090d', g: '#46f08a', gd: '#1f7a48', c: '#56d8ff', y: '#ffd84a', r: '#ff4a4a', w: '#e8f2f0', m: '#ff7ad9', dim: '#5d7a74', land: '#1b2a1a', sea: '#071622' };
function ckPaint() {
  const g = CK.ctx;
  g.fillStyle = '#000'; g.fillRect(0, 0, 1024, 1024);
  const reg = (D, f) => { const [x, y, w, h] = D.a; g.save(); g.translate(x, y); g.beginPath(); g.rect(0, 0, w, h); g.clip(); g.fillStyle = CKC.bg; g.fillRect(0, 0, w, h); try { f(g, w, h); } catch (e) { if (!CK.err) { CK.err = 1; console.warn('座舱显示器', e); } } g.restore(); };
  const T = ckState();
  reg(CK_D.L, (g, w, h) => ckSit(g, w, h, T));
  reg(CK_D.C, (g, w, h) => ckFcr(g, w, h, T));
  reg(CK_D.R, (g, w, h) => ckSms(g, w, h, T));
  reg(CK_D.U, (g, w, h) => ckUfc(g, w, h, T));
  reg(CK_D.AL, (g, w, h) => ckAdi(g, w, h, T));
  reg(CK_D.AR, (g, w, h) => ckCau(g, w, h, T));
}
// 这一帧显示要用的数：表速、马赫、高度、航向、姿态、目标、威胁
function ckState() {
  const p = PC.p, P = ckPose() || { h: 0, pt: 0, rl: 0, C: [0, 0, 0] }, fl = typeof pcFlying === 'function' && pcFlying();
  const V = fl ? PC.V : (p && p.spd ? p.spd * (typeof airK === 'function' ? airK(p) : .5) : 0), ias = V / (typeof AIR_K === 'number' ? AIR_K : .5);
  const gz = typeof v3Gnd === 'function' ? v3Gnd(clamp(P.C[0], 0, W - 1), clamp(-P.C[1], 0, H - 1)) : 0;
  const hdg = (((P.h * 180 / Math.PI) + 90) % 360 + 360) % 360;   // 世界航向角 → 罗盘（北 0°、东 90°）
  const air = fl ? pcAir() : [], gnd = fl && PC.mode === 'ag' ? pcGnd() : [], th = fl ? pcThreats() : { msl: [], lock: false };
  const tg = fl ? pcTgt() : null;
  if (fl) CK.gmax = Math.max(CK.gmax, PC.n);
  return { p, P, fl, V, ias, kmh: ias * 3.6, mach: ias / 340, alt: P.C[2], agl: P.C[2] - gz, hdg, air, gnd, th, tg, n: fl ? PC.n : 1, al: fl ? PC.al : 0, vs: fl ? PC.F[2] * PC.V : 0 };
}
const ckTxt = (g, t, x, y, col, sz = 14, al = 'left', bold) => { g.font = `${bold ? 'bold ' : ''}${sz}px ${CK_FONT}`; g.textAlign = al; g.textBaseline = 'middle'; g.fillStyle = col; g.fillText(t, x, y); };
const ckFrame = (g, w, h, title, keys) => {   // 每块下显的外框：上方标题、四周软键标签
  g.strokeStyle = CKC.gd; g.lineWidth = 2; g.strokeRect(3, 3, w - 6, h - 6);
  ckTxt(g, title, w / 2, 18, CKC.g, 16, 'center', true);
  (keys || []).forEach((k, i, A) => ckTxt(g, k, (i + .5) * w / A.length, h - 14, CKC.dim, 12, 'center'));
};
// 航向朝上的地图坐标：返回 [屏幕 x, 屏幕 y]
function ckMapXY(T, x, y, cx, cy, k) {
  const dx = x - T.p.x, dy = y - T.p.y, a = T.P.h + Math.PI / 2, c = Math.cos(a), s = Math.sin(a);
  return [cx + (dx * c + dy * s) * k, cy + (-dx * s + dy * c) * k];
}
// 陆地的俯视剪影（一次算好：每 20 米一个点）
function ckLand() {
  const sig = (TER && TER.seed) + ':' + W + 'x' + H;
  if (CK.land && CK.landSig === sig) return CK.land;
  const cw = Math.ceil(W / 20), ch = Math.ceil(H / 20), cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
  const g = cv.getContext('2d'), im = g.createImageData(cw, ch);
  for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
    const land = typeof isLand === 'function' ? isLand(i * 20 + 10, j * 20 + 10) : false, o = (j * cw + i) * 4;
    im.data[o] = land ? 38 : 8; im.data[o + 1] = land ? 58 : 22; im.data[o + 2] = land ? 34 : 38; im.data[o + 3] = 255;
  }
  g.putImageData(im, 0, 0);
  CK.land = cv; CK.landSig = sig;
  return cv;
}
// 左下显：战术态势
function ckSit(g, w, h, T) {
  if (!T.p) return;
  const cx = w / 2, cy = h * .64, Rm = 1600, k = (h * .52) / Rm;   // 量程 1600 米（外圈）
  // 地图：陆地剪影按航向朝上转过去
  g.save(); g.translate(cx, cy); g.rotate(-(T.P.h + Math.PI / 2)); g.scale(k, k); g.translate(-T.p.x, -T.p.y);
  g.imageSmoothingEnabled = true; g.globalAlpha = .9; g.drawImage(ckLand(), 0, 0, W, H); g.globalAlpha = 1;
  g.restore();
  // 距离圈、罗盘
  g.strokeStyle = 'rgba(70,240,138,.35)'; g.lineWidth = 1;
  for (const r of [.5, 1]) { g.beginPath(); g.arc(cx, cy, Rm * r * k, 0, 7); g.stroke(); }
  for (let d = 0; d < 360; d += 30) {
    const a = (d - T.hdg) * Math.PI / 180 - Math.PI / 2, r0 = Rm * k, x0 = cx + Math.cos(a) * r0, y0 = cy + Math.sin(a) * r0;
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(cx + Math.cos(a) * (r0 - 8), cy + Math.sin(a) * (r0 - 8)); g.stroke();
    if (y0 > 30) ckTxt(g, d === 0 ? '北' : String(d / 10).padStart(2, '0'), cx + Math.cos(a) * (r0 + 12), cy + Math.sin(a) * (r0 + 12), CKC.g, 12, 'center');
  }
  const P = (x, y) => ckMapXY(T, x, y, cx, cy, k), inR = q => q[0] > 8 && q[0] < w - 8 && q[1] > 30 && q[1] < h - 26;
  // 已知防空火力圈
  if (typeof airAASites === 'function') for (const s of airAASites().slice(0, 40)) { const q = P(s.x, s.y); if (!inR(q)) continue; g.strokeStyle = 'rgba(255,74,74,.55)'; g.beginPath(); g.arc(q[0], q[1], Math.max(6, (s.k === 'veh' ? 300 : s.k === 'mp' ? 150 : 220) * k), 0, 7);   // 防空导弹车 / 便携防空 / 高炮的大致射程 g.stroke(); ckTxt(g, 'S', q[0], q[1], CKC.r, 11, 'center', true); }
  // 友舰（方块）、母舰
  for (const s of S.ships || []) if ((typeof alive !== 'function' || alive(s)) && s.side !== 'e') { const q = P(s.x, s.y); if (inR(q)) { g.fillStyle = 'rgba(86,216,255,.7)'; g.fillRect(q[0] - 2.5, q[1] - 2.5, 5, 5); } }
  for (const c of typeof cvAll === 'function' ? cvAll() : []) { const q = P(c.x, c.y); if (inR(q)) { g.strokeStyle = CKC.c; g.lineWidth = 2; g.strokeRect(q[0] - 6, q[1] - 4, 12, 8); ckTxt(g, '福建', q[0], q[1] + 13, CKC.c, 11, 'center'); } }
  // 友机
  const sym = (q, a, col, foe) => { g.save(); g.translate(q[0], q[1]); g.rotate(a); g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); if (foe) { g.moveTo(-6, 4); g.lineTo(0, -5); g.lineTo(6, 4); } else { g.arc(0, 0, 5, Math.PI, 0); } g.moveTo(0, -5); g.lineTo(0, -13); g.stroke(); g.restore(); };
  const rel = hd => hd - T.P.h;
  for (const o of S.planes || []) if (o !== T.p && !o.dead && isFinite(o.x) && !['cat', 'roll', 'trap'].includes(o.phase)) { const q = P(o.x, o.y); if (inR(q)) sym(q, rel(o.heading || 0), CKC.c, false); }
  // 敌机（数据链、本机雷达）
  for (const c of T.air) { const q = P(c.x, c.y); if (!inR(q)) continue; const lk = T.tg && T.tg.o === c.o; sym(q, rel(c.o.heading || 0), lk ? CKC.y : CKC.r, true); if (lk) { g.strokeStyle = CKC.y; g.strokeRect(q[0] - 9, q[1] - 9, 18, 18); } }
  // 地面目标（对地模式）
  for (const c of T.gnd.slice(0, 60)) { const q = P(c.x, c.y); if (!inR(q)) continue; g.fillStyle = T.tg && T.tg.o === c.o ? CKC.y : 'rgba(255,74,74,.8)'; g.beginPath(); g.moveTo(q[0], q[1] - 4); g.lineTo(q[0] + 4, q[1]); g.lineTo(q[0], q[1] + 4); g.lineTo(q[0] - 4, q[1]); g.fill(); }
  // 本机
  g.strokeStyle = CKC.w; g.lineWidth = 2; g.beginPath(); g.moveTo(cx, cy - 9); g.lineTo(cx, cy + 9); g.moveTo(cx - 8, cy); g.lineTo(cx + 8, cy); g.moveTo(cx - 4, cy + 7); g.lineTo(cx + 4, cy + 7); g.stroke();
  // 母舰方位、距离
  const c0 = S.cv;
  if (c0 && isFinite(c0.x)) { const b = Math.round(((Math.atan2(c0.y - T.p.y, c0.x - T.p.x) * 180 / Math.PI + 90) % 360 + 360) % 360), d = Math.round(dist(T.p.x, T.p.y, c0.x, c0.y)); ckTxt(g, `母舰 ${String(b).padStart(3, '0')}° ${d}`, 10, 42, CKC.c, 13); }
  ckTxt(g, `量程 ${Rm}`, w - 10, 42, CKC.dim, 12, 'right');
  ckFrame(g, w, h, '战术态势', ['导航', '态势', '数据链', '威胁', '量程']);
}
// 中下显：火控雷达（空空 B 型显示 / 对地前方目标）
function ckFcr(g, w, h, T) {
  const x0 = 34, x1 = w - 20, y0 = 40, y1 = h - 44, aw = x1 - x0, ah = y1 - y0;
  if (!T.fl) { ckFrame(g, w, h, '火控雷达 · 待机', ['空空', '对地', '对海', '量程']); ckTxt(g, PC.wait ? '等待弹射' : '—', w / 2, h / 2, CKC.dim, 20, 'center'); return; }
  const aa = PC.mode === 'aa', W0 = PC_W[PC.wpn], far = T.tg ? T.tg.d : 0, Rr = aa ? (far > 380 || !T.tg ? 800 : far > 180 ? 400 : 200) : 800;
  g.strokeStyle = 'rgba(70,240,138,.28)'; g.lineWidth = 1;
  for (let i = 1; i < 4; i++) { const y = y0 + ah * i / 4; g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke(); }
  for (const a of [-30, 0, 30]) { const x = x0 + aw * (a + 60) / 120; g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y1); g.stroke(); }
  g.strokeStyle = CKC.gd; g.strokeRect(x0, y0, aw, ah);
  for (let i = 0; i <= 4; i++) ckTxt(g, String(Math.round(Rr * (4 - i) / 4)), x0 - 4, y0 + ah * i / 4, CKC.dim, 11, 'right');
  for (const a of [-60, -30, 0, 30, 60]) ckTxt(g, String(a), x0 + aw * (a + 60) / 120, y1 + 10, CKC.dim, 10, 'center');
  if (aa) {
    // 扫描线（±60° 来回）
    CK.sweep = (CK.sweep || 0) + .055; const sa = Math.sin(CK.sweep) * 60, sx = x0 + aw * (sa + 60) / 120;
    if (PC.radarOn) { g.strokeStyle = 'rgba(70,240,138,.55)'; g.lineWidth = 2; g.beginPath(); g.moveTo(sx, y0); g.lineTo(sx, y1); g.stroke(); }
    for (const c of T.air) {
      const az = c.az * 180 / Math.PI, x = x0 + aw * (az + 60) / 120, y = y1 - ah * Math.min(1, c.d / Rr);
      if (az < -62 || az > 62 || c.d > Rr) continue;
      const lk = T.tg && T.tg.o === c.o, col = lk ? CKC.y : c.radar ? CKC.r : CKC.m;
      g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 2;
      if (c.radar) g.fillRect(x - 5, y - 5, 10, 10); else g.strokeRect(x - 5, y - 5, 10, 10);
      const hv = (c.o.heading || 0) - T.P.h; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.sin(hv) * 14, y - Math.cos(hv) * 14); g.stroke();   // 目标航向（朝上 = 与本机同向飞远）
      if (lk) { g.beginPath(); g.arc(x, y, 11, 0, 7); g.stroke(); }
    }
    ckTxt(g, PC.radarOn ? (T.tg ? '单目标跟踪' : '边扫描边跟踪') : '雷达静默', x0 + 4, y0 + 12, PC.radarOn ? CKC.g : CKC.y, 12);
    if (T.tg) {   // 锁定目标的数据：型号、距离、高度、接近率、导弹到达时间
      const c = T.tg, vc = Math.round(((c.o.spd || 0) * Math.cos((c.o.heading || 0) - T.P.h - Math.PI) + T.ias) * 3.6), msl = S.missiles.filter(m => m.pcw && !m.done && m.tgt && m.tgt.id === c.o.id);
      ckTxt(g, `${c.nm}`, w - 24, y0 + 12, CKC.y, 13, 'right');
      ckTxt(g, `距 ${Math.round(c.d)}  高 ${Math.round(c.z)}  接近 ${vc}`, w - 24, y0 + 30, CKC.y, 12, 'right');
      if (msl.length) { const m = msl[0], ti = Math.max(0, dist(m.x, m.y, c.x, c.y) / (m.spd || 600)), ta = Math.max(0, m.dur * .45 - m.t); ckTxt(g, `${PC_W[m.pcw].ab} ${ta > 0 ? '主动前 ' + ta.toFixed(1) : '已主动'}  命中 ${ti.toFixed(1)}s`, w - 24, y0 + 48, CKC.w, 12, 'right'); }
    }
  } else {
    // 对地：前方扇区的地面目标（距离 × 方位）
    for (const c of T.gnd) {
      const B = pcBody(), dx = c.x - PC.P[0], dy = -c.y - PC.P[1], hd = Math.atan2(dy, dx) - Math.atan2(B.F[1], B.F[0]), az = -Math.atan2(Math.sin(hd), Math.cos(hd)) * 180 / Math.PI;
      if (Math.abs(az) > 60 || c.dh > Rr) continue;
      const x = x0 + aw * (az + 60) / 120, y = y1 - ah * c.dh / Rr, lk = T.tg && T.tg.o === c.o;
      g.fillStyle = lk ? CKC.y : CKC.r; g.beginPath(); g.moveTo(x, y - 5); g.lineTo(x + 5, y); g.lineTo(x, y + 5); g.lineTo(x - 5, y); g.fill();
      if (lk) { g.strokeStyle = CKC.y; g.strokeRect(x - 9, y - 9, 18, 18); }
    }
    ckTxt(g, '对地 · 地面动目标', x0 + 4, y0 + 12, CKC.g, 12);
    if (T.tg) { ckTxt(g, T.tg.nm, w - 24, y0 + 12, CKC.y, 13, 'right'); ckTxt(g, `距 ${Math.round(T.tg.d)}  ${T.tg.d < W0.rmax && T.tg.off < W0.off ? '可投放' : '接近中'}`, w - 24, y0 + 30, T.tg.d < W0.rmax ? CKC.y : CKC.dim, 12, 'right'); }
  }
  ckFrame(g, w, h, `火控雷达 · ${aa ? '空空' : '对地'}  ${Rr}`, ['空空', '对地', '对海', '量程']);
}
// 右下显：武器挂载 + 发动机 / 燃油
function ckSms(g, w, h, T) {
  // 平面图：机身、两侧弹舱、主弹舱的挂点
  const cx = w / 2, ty = 58;
  g.strokeStyle = CKC.gd; g.lineWidth = 2; g.beginPath(); g.moveTo(cx, ty - 22); g.lineTo(cx + 18, ty); g.lineTo(cx + 88, ty + 46); g.lineTo(cx + 22, ty + 60); g.lineTo(cx + 14, ty + 92); g.lineTo(cx - 14, ty + 92); g.lineTo(cx - 22, ty + 60); g.lineTo(cx - 88, ty + 46); g.lineTo(cx - 18, ty); g.closePath(); g.stroke();
  const ld = PC.ld || {}, sel = PC.wpn, slot = (x, y, w0, full, nm, on) => { g.strokeStyle = on ? CKC.y : CKC.g; g.fillStyle = full ? (on ? CKC.y : CKC.g) : 'transparent'; g.lineWidth = 2; g.beginPath(); g.rect(x - w0 / 2, y - 9, w0, 18); if (full) g.fill(); g.stroke(); if (nm) ckTxt(g, nm, x, y + 18, on ? CKC.y : CKC.dim, 10, 'center'); };
  const n15 = ld.pl15 || 0, n8 = ld.ft8 || 0, n10 = ld.pl10 || 0;
  for (let i = 0; i < 4; i++) slot(cx - 27 + i * 18, ty + 36, 12, i < n15, i === 0 ? '' : '', sel === 'pl15');
  for (let i = 0; i < 2; i++) slot(cx - 9 + i * 18, ty + 66, 12, i < n8, '', sel === 'ft8');
  slot(cx - 40, ty + 20, 10, n10 > 1, '', sel === 'pl10'); slot(cx + 40, ty + 20, 10, n10 > 0, '', sel === 'pl10');
  ckTxt(g, `霹雳-15E ×${n15}`, 12, 172, sel === 'pl15' ? CKC.y : CKC.g, 13);
  ckTxt(g, `霹雳-10 ×${n10}`, cx, 172, sel === 'pl10' ? CKC.y : CKC.g, 13, 'center');
  ckTxt(g, `飞腾-8 ×${n8}`, w - 12, 172, sel === 'ft8' ? CKC.y : CKC.g, 13, 'right');
  ckTxt(g, `干扰弹 ${PC.cm ? PC.cm.n : 0}`, 12, 192, CKC.dim, 12);
  ckTxt(g, PC.mode === 'aa' ? '主模式 空空' : '主模式 对地', w - 12, 192, CKC.c, 12, 'right');
  // 发动机：双发转速、排气温度
  const eng = T.fl ? PC.eng : .7, ab = T.fl ? PC.abL : 0, n2 = Math.round(62 + 36 * eng + 4 * ab), egt = Math.round(420 + 380 * eng + 120 * ab), ff = Math.round((T.fl ? .55 + 1.6 * eng + 7.5 * ab : 1.5) * 1800);
  for (const [i, nm] of [[0, '左发'], [1, '右发']]) {
    const ax = w * (.27 + i * .46), ay = 268, r = 40;
    g.strokeStyle = CKC.gd; g.lineWidth = 6; g.beginPath(); g.arc(ax, ay, r, Math.PI * .75, Math.PI * 2.25); g.stroke();
    g.strokeStyle = ab > .3 ? CKC.y : CKC.g; g.beginPath(); g.arc(ax, ay, r, Math.PI * .75, Math.PI * (.75 + 1.5 * clamp((n2 - 40) / 70, 0, 1))); g.stroke();
    ckTxt(g, `${n2}%`, ax, ay - 2, CKC.w, 16, 'center', true); ckTxt(g, nm, ax, ay + 18, CKC.dim, 11, 'center');
    ckTxt(g, `排温 ${egt}°`, ax, ay + 52, CKC.g, 12, 'center');
  }
  if (ab > .3) ckTxt(g, '加力', w / 2, 262, CKC.y, 15, 'center', true);
  const fuel = Math.round(T.fl ? PC.fuel : PC_FUEL), endu = T.fl ? Math.round(PC.fuel / Math.max(.3, .55 + 1.6 * PC.eng + 7.5 * PC.abL) / 60) : 0;
  ckTxt(g, `燃油 ${fuel} 公斤`, 12, 350, fuel < 600 ? CKC.r : CKC.g, 14); ckTxt(g, `耗油 ${ff} 公斤/时`, w - 12, 350, CKC.dim, 12, 'right');
  ckTxt(g, `续航 ${endu} 分`, 12, 372, CKC.dim, 12); ckTxt(g, `过载 ${T.n.toFixed(1)}  最大 ${CK.gmax.toFixed(1)}`, w - 12, 372, T.n > 8 ? CKC.y : CKC.g, 12, 'right');
  ckFrame(g, w, h, '武器 · 发动机', ['挂载', '发动机', '燃油', '液压', '自检']);
}
// 前上方控制板：通信、导航、塔康、主模式、数据链
function ckUfc(g, w, h, T) {
  g.fillStyle = '#020604'; g.fillRect(0, 0, w, h);
  const c0 = S.cv, b = c0 && T.p ? Math.round(((Math.atan2(c0.y - T.p.y, c0.x - T.p.x) * 180 / Math.PI + 90) % 360 + 360) % 360) : 0, d = c0 && T.p ? dist(T.p.x, T.p.y, c0.x, c0.y) : 0;
  const L = [['通信1', '243.00 空中指挥'], ['通信2', '舰面 引导'], ['导航', '惯导/北斗 组合'], ['塔康', `18X ${String(b).padStart(3, '0')}° ${(d / 1000).toFixed(1)}千`], ['主模式', PC.mode === 'aa' ? '空空 · 中距' : '对地 · 精确'], ['数据链', typeof awAew === 'function' && awAew() ? '预警机 在网' : '舰队 在网']];
  L.forEach(([k, v], i) => { ckTxt(g, k, 8, 22 + i * 36, '#9dffb8', 15); ckTxt(g, v, w - 8, 22 + i * 36, '#c8ffd8', 15, 'right'); });
}
// 左辅助屏：备份姿态仪（天蓝地褐的姿态球、坡度刻度），两边小字表速、高度
function ckAdi(g, w, h, T) {
  const cx = w / 2, cy = h / 2 + 4, r = Math.min(w, h) * .4, pt = T.P.pt || 0, rl = T.P.rl || 0;
  g.save(); g.beginPath(); g.arc(cx, cy, r, 0, 7); g.clip();
  g.translate(cx, cy); g.rotate(-rl);
  const k = r / .6, off = pt * k;
  g.fillStyle = '#2d78c8'; g.fillRect(-r * 2, -r * 3 + off, r * 4, r * 3);
  g.fillStyle = '#7a4b22'; g.fillRect(-r * 2, off, r * 4, r * 3);
  g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.moveTo(-r * 2, off); g.lineTo(r * 2, off); g.stroke();
  g.lineWidth = 1;
  for (let d = -30; d <= 30; d += 10) { if (!d) continue; const y = off - d * Math.PI / 180 * k, l = d % 20 === 0 ? r * .45 : r * .25; g.beginPath(); g.moveTo(-l, y); g.lineTo(l, y); g.stroke(); }
  g.restore();
  g.strokeStyle = CKC.y; g.lineWidth = 3; g.beginPath(); g.moveTo(cx - r * .55, cy); g.lineTo(cx - r * .18, cy); g.lineTo(cx - r * .1, cy + 7); g.moveTo(cx + r * .55, cy); g.lineTo(cx + r * .18, cy); g.lineTo(cx + r * .1, cy + 7); g.stroke();
  g.fillStyle = CKC.y; g.fillRect(cx - 2, cy - 2, 4, 4);
  ckTxt(g, String(Math.round(T.kmh)), 6, 16, CKC.w, 14); ckTxt(g, String(Math.round(T.alt)), w - 6, 16, CKC.w, 14, 'right');
  ckTxt(g, '备份姿态', cx, h - 10, CKC.dim, 11, 'center');
}
// 右辅助屏：告警灯（亮着的是有事）+ 液压
function ckCau(g, w, h, T) {
  const W0 = PC.warn || '', lit = { '导弹来袭': T.th.msl.length > 0, '被锁定': T.th.lock, '失速': W0 === '失速', '燃油低': W0 === '燃油低', '拉起': W0 === '拉起', '起落架': PC.gear > 0, '减速板': PC.brk > 0, '加力': PC.abL > .3 };
  const ks = Object.keys(lit), cw = (w - 12) / 2, chh = 30;
  ks.forEach((k, i) => {
    const x = 6 + (i % 2) * cw, y = 8 + Math.floor(i / 2) * (chh + 6), on = lit[k], red = on && /导弹|锁定|失速|燃油|拉起/.test(k), flash = red && Math.floor(performance.now() / 300) % 2;
    g.fillStyle = on ? (red ? (flash ? '#ff3030' : '#6a1010') : k === '起落架' ? '#1f9a4a' : '#9a8a20') : '#101814'; g.fillRect(x + 2, y, cw - 4, chh);
    ckTxt(g, k, x + cw / 2, y + chh / 2, on ? '#fff' : '#3a4a44', 14, 'center', on);
  });
  ckTxt(g, '液压 28 / 28 兆帕', w / 2, h - 12, CKC.dim, 12, 'center');
}

// —— 平显（view3d.js v3Overlay 在驾驶时改调这里；屏幕空间，CSS 像素）——
// 方向（GL）→ 屏幕：准直到无穷远，只用镜头的转向
function ckDir(C, d) {
  const zz = -(d[0] * C.z[0] + d[1] * C.z[1] + d[2] * C.z[2]);
  if (zz <= .02) return null;
  const k = C.fo * CAM.vh / 2;
  return [CAM.vw / 2 + (d[0] * C.x[0] + d[1] * C.x[1] + d[2] * C.x[2]) / zz * k, CAM.vh / 2 - (d[0] * C.y[0] + d[1] * C.y[1] + d[2] * C.y[2]) / zz * k];
}
// 世界点（GL）→ 屏幕
function ckPt(C, q) { return ckDir(C, [q[0] - C.E[0], q[1] - C.E[1], q[2] - C.E[2]]); }
function ckHud(ctx) {
  const C = V3.cam;
  if (!C || !PC.on) return;
  const T = ckState(), hud = '#5cff8e', hudD = 'rgba(92,255,142,.45)';
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (C.ck && !PC.dead) {
    const X = C.ck.X, R = X.R, wp = v => { const e = ckMv(R, v); return [X.O[0] + e[0], X.O[1] + e[1], X.O[2] + e[2]]; };
    const H = CK_HUDP, cn = [[H.x, H.y, H.z1], [H.x, -H.y, H.z1], [H.x, -H.y, H.z0], [H.x, H.y, H.z0]].map(v => ckPt(C, wp(v)));
    if (cn.every(Boolean)) {
      ctx.save();
      ctx.beginPath(); cn.forEach((q, i) => i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])); ctx.closePath(); ctx.clip();
      ckHudSym(ctx, C, T, cn, hud, hudD);
      ctx.restore();
    }
  } else ckHudExt(ctx, C, T, hud);
  // 告警（屏幕中间偏上，闪）、消息
  const wn = PC.dead ? '弹射跳伞' : PC.warn;
  if (wn && Math.floor(performance.now() / 350) % 2) { ctx.font = `bold 26px ${CK_FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = /拉起|导弹|失速|弹射/.test(wn) ? '#ff5050' : '#ffd84a'; ctx.fillText(wn, CAM.vw / 2, CAM.vh * .3); }
  if (PC.msg && S.t - PC.msgT < 3.5) { ctx.font = `14px ${CK_FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = 'rgba(0,0,0,.45)'; const tw = ctx.measureText(PC.msg).width; ctx.fillRect(CAM.vw / 2 - tw / 2 - 8, CAM.vh - 92, tw + 16, 24); ctx.fillStyle = '#d8ffe4'; ctx.fillText(PC.msg, CAM.vw / 2, CAM.vh - 80); }
  if (PC.wait) { ctx.font = `15px ${CK_FONT}`; ctx.textAlign = 'center'; ctx.fillStyle = '#ffd84a'; ctx.fillText(`甲板作业中，离舰后由你驾驶（按住 F 快进）  ${PC.p ? ({ brd: '飞行员登机', eng: '开车', taxi: '滑行', hold: '等待', line: '上弹射器', hook: '挂弹射杆', lift: '升降机' })[PC.p.dk] || (PC.p.phase === 'roll' ? '弹射！' : '') : ''}`, CAM.vw / 2, CAM.vh * .2); }
  if (!(typeof document !== 'undefined' && document.pointerLockElement) && !PC.wait && !PC.dead) { ctx.font = `12px ${CK_FONT}`; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(216,255,228,.7)'; ctx.fillText('点一下画面锁定鼠标转头 · W S 俯仰 A D 滚转 Q E 方向舵 · Shift/Ctrl 油门 · Tab 目标 · 空格发射 · 1 2 3 武器 · X 干扰弹 · V 视角 · Esc 退出', CAM.vw / 2, CAM.vh - 54); }
  ctx.restore();
}
// 平显符号（裁在组合玻璃里）
function ckHudSym(ctx, C, T, cn, hud, hudD) {
  const B = pcFlying() ? pcBody() : { F: ckPose().F, L: ckPose().L, U: ckPose().U };
  const fpm = T.fl ? ckDir(C, PC.F) : ckDir(C, B.F), bore = ckDir(C, B.F);
  const xs = cn.map(q => q[0]), ys = cn.map(q => q[1]), hx0 = Math.min(...xs), hx1 = Math.max(...xs), hy0 = Math.min(...ys), hy1 = Math.max(...ys), hw = hx1 - hx0, hcx = (hx0 + hx1) / 2;
  const sc = clamp(hw / 520, .55, 1.6);
  ctx.strokeStyle = hud; ctx.fillStyle = hud; ctx.lineWidth = 1.6 * sc; ctx.shadowColor = 'rgba(92,255,142,.6)'; ctx.shadowBlur = 4;
  const font = s => { ctx.font = `${Math.round(s * sc)}px ${CK_FONT}`; };
  // 俯仰梯：每 5°，以航迹方位为中心；正的实线、负的虚线；地平线长
  const Fv = T.fl ? PC.F : B.F, pv = Math.atan2(Fv[1], Fv[0]);
  for (let d = -85; d <= 85; d += 5) {
    const th = d * Math.PI / 180, half = d === 0 ? .16 : .05, gap = d === 0 ? 0 : .018;
    const dir = (a, t) => [Math.cos(t) * Math.cos(a), Math.cos(t) * Math.sin(a), Math.sin(t)];
    const a0 = ckDir(C, dir(pv + half, th)), a1 = ckDir(C, dir(pv + gap, th)), b0 = ckDir(C, dir(pv - gap, th)), b1 = ckDir(C, dir(pv - half, th));
    if (!a0 || !b1) continue;
    if ((a0[1] < hy0 - 40 && b1[1] < hy0 - 40) || (a0[1] > hy1 + 40 && b1[1] > hy1 + 40)) continue;
    ctx.setLineDash(d < 0 ? [6 * sc, 5 * sc] : []);
    ctx.beginPath();
    if (d === 0) { ctx.moveTo(a0[0], a0[1]); ctx.lineTo(b1[0], b1[1]); }
    else { ctx.moveTo(a0[0], a0[1]); ctx.lineTo(a1[0], a1[1]); ctx.moveTo(b0[0], b0[1]); ctx.lineTo(b1[0], b1[1]); }
    ctx.stroke(); ctx.setLineDash([]);
    if (d) { font(12); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; for (const q of [a0, b1]) ctx.fillText(String(Math.abs(d)), q[0] + (q === a0 ? -1 : 1) * 0, q[1] - 8 * sc); }
  }
  // 速度矢量（飞到哪）与水平基准（机头指向）
  if (fpm) { const [x, y] = fpm, r = 7 * sc; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.moveTo(x - r, y); ctx.lineTo(x - r * 2.6, y); ctx.moveTo(x + r, y); ctx.lineTo(x + r * 2.6, y); ctx.moveTo(x, y - r); ctx.lineTo(x, y - r * 2); ctx.stroke(); }
  if (bore) { const [x, y] = bore, s = 9 * sc; ctx.beginPath(); ctx.moveTo(x - s * 2, y); ctx.lineTo(x - s, y); ctx.lineTo(x - s / 2, y + s / 2); ctx.lineTo(x, y); ctx.lineTo(x + s / 2, y + s / 2); ctx.lineTo(x + s, y); ctx.lineTo(x + s * 2, y); ctx.stroke(); }
  // 航向带（顶部）
  const ty = hy0 + 22 * sc, span = 30;
  font(12); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let a = Math.floor((T.hdg - span) / 5) * 5; a <= T.hdg + span; a += 5) {
    const x = hcx + (a - T.hdg) / span * hw * .32, big = a % 10 === 0;
    ctx.beginPath(); ctx.moveTo(x, ty); ctx.lineTo(x, ty + (big ? 9 : 5) * sc); ctx.stroke();
    if (a % 10 === 0) ctx.fillText(String(((a % 360) + 360) % 360 / 10 | 0).padStart(2, '0'), x, ty - 9 * sc);
  }
  ctx.beginPath(); ctx.moveTo(hcx, ty + 12 * sc); ctx.lineTo(hcx - 5 * sc, ty + 19 * sc); ctx.lineTo(hcx + 5 * sc, ty + 19 * sc); ctx.closePath(); ctx.stroke();
  // 表速（左）、高度（右）
  const my = (hy0 + hy1) / 2, bx = 62 * sc, bh = 22 * sc;
  ctx.strokeRect(hx0 + 18 * sc, my - bh / 2, bx, bh); ctx.strokeRect(hx1 - 18 * sc - bx, my - bh / 2, bx, bh);
  font(16); ctx.textAlign = 'center'; ctx.fillText(String(Math.round(T.kmh)), hx0 + 18 * sc + bx / 2, my); ctx.fillText(String(Math.round(T.alt)), hx1 - 18 * sc - bx / 2, my);
  font(12); ctx.textAlign = 'left';
  ctx.fillText(`M ${T.mach.toFixed(2)}`, hx0 + 18 * sc, my + 24 * sc); ctx.fillText(`G ${T.n.toFixed(1)}`, hx0 + 18 * sc, my + 40 * sc); ctx.fillText(`α ${(T.al * 180 / Math.PI).toFixed(0)}`, hx0 + 18 * sc, my - 24 * sc);
  ctx.textAlign = 'right';
  ctx.fillText(`离地 ${Math.round(T.agl)}`, hx1 - 18 * sc, my + 24 * sc); ctx.fillText(`${T.vs >= 0 ? '+' : ''}${Math.round(T.vs * 60)}`, hx1 - 18 * sc, my + 40 * sc);
  if (PC.abL > .3) ctx.fillText('加力', hx1 - 18 * sc, my - 24 * sc);
  // 武器与目标
  if (T.fl) {
    const W0 = PC_W[PC.wpn], n = PC.ld[PC.wpn] || 0;
    font(13); ctx.textAlign = 'left'; ctx.fillText(`${W0.ab} ×${n}`, hx0 + 18 * sc, hy1 - 20 * sc);
    ctx.textAlign = 'right'; ctx.fillText(PC.mode === 'aa' ? (PC.radarOn ? '空空' : '空空 静默') : '对地', hx1 - 18 * sc, hy1 - 20 * sc);
    if (PC.gear) { ctx.textAlign = 'center'; ctx.fillText('起落架', hcx, hy1 - 20 * sc); }
    const tg = T.tg;
    if (tg) {
      const q = ckPt(C, [tg.x, -tg.y, tg.z]), inH = q && q[0] > hx0 && q[0] < hx1 && q[1] > hy0 && q[1] < hy1;
      if (inH) {   // 目标框（菱形是红外弹的导引头），距离
        const s = 13 * sc; ctx.strokeRect(q[0] - s, q[1] - s, s * 2, s * 2);
        if (W0.ir) { ctx.beginPath(); ctx.arc(q[0], q[1], s * 1.7, 0, 7); ctx.stroke(); }
        font(12); ctx.textAlign = 'center'; ctx.fillText(String(Math.round(tg.d)), q[0], q[1] + s + 12 * sc);
      } else if (bore) {   // 目标在平显外：从中心指过去，标离轴角
        const B2 = pcBody(), dx = tg.x - PC.P[0], dy = -tg.y - PC.P[1], dz = tg.z - PC.P[2], u = [dx, dy, dz], l = Math.hypot(dx, dy, dz) || 1;
        const sx = (u[0] * B2.L[0] + u[1] * B2.L[1] + u[2] * B2.L[2]) / l, sy = (u[0] * B2.U[0] + u[1] * B2.U[1] + u[2] * B2.U[2]) / l, a = Math.atan2(-sy, -sx), L0 = 60 * sc;
        ctx.beginPath(); ctx.moveTo(bore[0], bore[1]); ctx.lineTo(bore[0] + Math.cos(a) * L0, bore[1] + Math.sin(a) * L0); ctx.stroke();
        font(12); ctx.textAlign = 'center'; ctx.fillText(`${Math.round(tg.off * 180 / Math.PI)}°`, bore[0] + Math.cos(a) * (L0 + 14 * sc), bore[1] + Math.sin(a) * (L0 + 14 * sc));
      }
      // 发射区（右侧竖条）：最大、最小射程与当前距离
      const dx0 = hx1 - 12 * sc, dy0 = my - 70 * sc, dl = 140 * sc, Rm = Math.max(W0.rmax * 1.3, 100), yy = v => dy0 + dl * (1 - clamp(v / Rm, 0, 1));
      ctx.beginPath(); ctx.moveTo(dx0, yy(W0.rmax)); ctx.lineTo(dx0, yy(W0.rmin)); ctx.moveTo(dx0 - 6 * sc, yy(W0.rmax)); ctx.lineTo(dx0, yy(W0.rmax)); ctx.moveTo(dx0 - 6 * sc, yy(W0.rmin)); ctx.lineTo(dx0, yy(W0.rmin)); ctx.stroke();
      const cy2 = yy(tg.d); ctx.beginPath(); ctx.moveTo(dx0 - 4 * sc, cy2); ctx.lineTo(dx0 - 12 * sc, cy2 - 5 * sc); ctx.lineTo(dx0 - 12 * sc, cy2 + 5 * sc); ctx.closePath(); ctx.stroke();
      const ok = tg.d <= W0.rmax && tg.d >= W0.rmin && tg.off <= W0.off && (W0.k !== 'aa' || W0.ir || tg.radar);
      if (ok && n > 0 && Math.floor(performance.now() / 250) % 2) { font(18); ctx.textAlign = 'center'; ctx.fillText(W0.k === 'aa' ? '可发射' : '可投放', hcx, my + 58 * sc); }
    }
  }
  ctx.shadowBlur = 0;
}
// 机后跟随视角：屏幕四边的简易读数、目标框
function ckHudExt(ctx, C, T, hud) {
  ctx.fillStyle = hud; ctx.strokeStyle = hud; ctx.lineWidth = 1.5;
  ctx.font = `15px ${CK_FONT}`; ctx.textBaseline = 'middle';
  ctx.textAlign = 'left'; ctx.fillText(`速度 ${Math.round(T.kmh)} 公里/时  M ${T.mach.toFixed(2)}  G ${T.n.toFixed(1)}`, 18, CAM.vh * .5);
  ctx.textAlign = 'right'; ctx.fillText(`高度 ${Math.round(T.alt)}  离地 ${Math.round(T.agl)}  航向 ${String(Math.round(T.hdg)).padStart(3, '0')}°`, CAM.vw - 18, CAM.vh * .5);
  if (T.fl) {
    const W0 = PC_W[PC.wpn]; ctx.textAlign = 'center'; ctx.fillText(`${W0.nm} ×${PC.ld[PC.wpn] || 0}  ·  ${PC.mode === 'aa' ? '空空' : '对地'}  ·  油门 ${Math.round(PC.thr * 100)}%${PC.abL > .3 ? ' 加力' : ''}`, CAM.vw / 2, CAM.vh - 120);
    const tg = T.tg;
    if (tg) { const q = ckPt(C, [tg.x, -tg.y, tg.z]); if (q) { ctx.strokeStyle = '#ffd84a'; ctx.strokeRect(q[0] - 12, q[1] - 12, 24, 24); ctx.fillStyle = '#ffd84a'; ctx.font = `12px ${CK_FONT}`; ctx.fillText(`${tg.nm} ${Math.round(tg.d)}`, q[0], q[1] + 22); } }
    for (const c of T.air) if (!tg || c.o !== tg.o) { const q = ckPt(C, [c.x, -c.y, c.z]); if (q) { ctx.strokeStyle = 'rgba(255,80,80,.8)'; ctx.beginPath(); ctx.moveTo(q[0], q[1] - 9); ctx.lineTo(q[0] + 9, q[1]); ctx.lineTo(q[0], q[1] + 9); ctx.lineTo(q[0] - 9, q[1]); ctx.closePath(); ctx.stroke(); } }
  }
}
