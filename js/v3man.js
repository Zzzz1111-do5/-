'use strict';
// 人物姿势与着装（js/v3g.js v3gMan 调用）：用户给的士兵模型是 T 字站姿的 OBJ，没有骨骼——游戏里要的姿势（走、跑、跪射、卧倒、匍匐、爬梯、坐着开车、
//   指挥手势、跪着挂弹……）原来全被画成两臂平伸。这里给它程序化绑骨：
//   1）焊接：OBJ 每个面的三个顶点都单独存（法线按面，一棱一棱的）——按位置合并，法线按相邻面平滑（夹角超过 60° 的折边照样分开），3.6 万个顶点减到约 1 万；
//   2）权重：按身体部位把每个顶点分到 11 块骨上（骨盆、胸、头、左右上臂 / 前臂、左右大腿 / 小腿），关节附近两块骨平滑过渡（肩、肘、髋、膝不撕裂、不折死角）。
//      关节位置照模型量的：肩 |y| 0.19、肘 0.49、腕 0.75（手臂中心高 1.41）；髋 |y| 0.095、高 0.93，膝 0.50，踝 0.10；腰 1.08，颈 1.55（模型 1.8 米高，面朝 +x）；
//   3）姿势：每种姿势给关节角度（手臂下放、前摆、屈肘、扭转；髋屈、外展、屈膝；躯干前倾、扭转；点头、转头；骨盆下沉），正向运动学算出各骨的转动与关节位置，
//      线性混合蒙皮（法线一起转），最低点落地；趴着的姿势按站立的样子摆好，v3gMan 再整个放平。每种姿势第一次用到时生成一份顶点缓冲（索引、贴图与原模型共用）；
//   4）着装：甲板人员按分工换马甲颜色（调用处给颜色：牵引车蓝、弹药红、调度 / 弹射官黄……），裤子深蓝，头盔同马甲色；飞行员换橄榄绿飞行服、白色头盔——
//      贴图里上衣、裤子、头盔那几块 UV 按模型部位画出遮罩，模糊掉迷彩花纹、保留明暗褶皱后重新着色
const V3MAN = { ok: false, VB: null, st: 8, nv: 0, W: null, v: new Map(), P: new Map(), img: null, tri: null, tex: new Map() };
const V3MAN_J = { pel: [-.02, 0, .95], ch: [-.03, 0, 1.08], hd: [-.04, 0, 1.55], sh: [-.07, .19, 1.41], el: [-.08, .49, 1.40], hp: [-.02, .095, .93], kn: [.01, .115, .50] };
const V3MAN_NB = 11;   // 骨：0 骨盆 1 胸 2 头 3 左上臂 4 左前臂 5 右上臂 6 右前臂 7 左大腿 8 左小腿 9 右大腿 10 右小腿（左 = 模型 +y）

// —— 1）焊接、平滑法线（v3gPrep 里，上传缓冲区之前）——
function v3manPrep(m, VB, IB) {
  const st = m.st, nv = VB.length / st, pk = new Int32Array(nv), pm = new Map();
  for (let i = 0; i < nv; i++) { const o = i * st, k = Math.round(VB[o] * 1e4) + ',' + Math.round(VB[o + 1] * 1e4) + ',' + Math.round(VB[o + 2] * 1e4); let j = pm.get(k); if (j == null) pm.set(k, j = pm.size); pk[i] = j; }
  const tris = [];
  for (const [, , i0, cnt] of m.lod[0]) for (let t = i0; t + 2 < i0 + cnt; t += 3) tris.push(t);
  const fn = new Float32Array(tris.length * 3), adj = Array.from({ length: pm.size }, () => []), vf = new Int32Array(nv).fill(-1);
  tris.forEach((t, f) => {
    const a = IB[t] * st, b = IB[t + 1] * st, c = IB[t + 2] * st, e1 = [VB[b] - VB[a], VB[b + 1] - VB[a + 1], VB[b + 2] - VB[a + 2]], e2 = [VB[c] - VB[a], VB[c + 1] - VB[a + 1], VB[c + 2] - VB[a + 2]];
    fn[f * 3] = e1[1] * e2[2] - e1[2] * e2[1]; fn[f * 3 + 1] = e1[2] * e2[0] - e1[0] * e2[2]; fn[f * 3 + 2] = e1[0] * e2[1] - e1[1] * e2[0];   // 面积加权
    for (let j = 0; j < 3; j++) { const v = IB[t + j]; adj[pk[v]].push(f); if (vf[v] < 0) vf[v] = f; }
  });
  const un = (x, y, z) => { const l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; }, C60 = .5;
  const out = [], key = new Map(), remap = new Uint32Array(nv);
  for (let i = 0; i < nv; i++) {
    const o = i * st, f0 = vf[i];
    let n = [VB[o + 3], VB[o + 4], VB[o + 5]];
    if (f0 >= 0) {
      const a = un(fn[f0 * 3], fn[f0 * 3 + 1], fn[f0 * 3 + 2]);
      let sx = 0, sy = 0, sz = 0;
      for (const g of adj[pk[i]]) { const b = un(fn[g * 3], fn[g * 3 + 1], fn[g * 3 + 2]); if (a[0] * b[0] + a[1] * b[1] + a[2] * b[2] > C60) { sx += fn[g * 3]; sy += fn[g * 3 + 1]; sz += fn[g * 3 + 2]; } }
      n = un(sx, sy, sz);
      if (n[0] * VB[o + 3] + n[1] * VB[o + 4] + n[2] * VB[o + 5] < 0) n = n.map(v => -v);   // 和原法线同一侧（个别反着绕的面）
    }
    const k = pk[i] + '|' + n.map(v => Math.round(v * 200)).join(',') + '|' + Math.round(VB[o + 6] * 4096) + ',' + Math.round(VB[o + 7] * 4096);
    let j = key.get(k);
    if (j == null) { key.set(k, j = out.length / st); for (let q = 0; q < st; q++) out.push(VB[o + q]); out[j * st + 3] = n[0]; out[j * st + 4] = n[1]; out[j * st + 5] = n[2]; }
    remap[i] = j;
  }
  const nv2 = out.length / st, it = nv2 > 65535 ? 4 : 2, IB2 = it === 4 ? new Uint32Array(IB.length) : new Uint16Array(IB.length);
  for (let i = 0; i < IB.length; i++) IB2[i] = remap[IB[i]];
  const VB2 = new Float32Array(out);
  V3MAN.VB = VB2; V3MAN.st = st; V3MAN.nv = nv2; V3MAN.W = v3manWeights(VB2, st, nv2);
  V3MAN.tri = m.lod[0].map(([mi, , i0, cnt]) => ({ mi, I: IB2.subarray(i0, i0 + cnt) }));   // 第 0 级的三角形（画着装遮罩用）
  m.it = it; V3MAN.ok = true;
  return { VB: VB2, IB: IB2, it };
}
// 贴图原图的字节（换装时重新着色用）：v3gDecode 解完就放掉了，这里留一份
function v3manImgs(m, bin) { V3MAN.img = m.imgs.map(I => new Blob([bin.slice(I.o, I.o + I.n)], { type: I.m })); }

// —— 2）权重 ——
const v3manSS = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function v3manWeights(VB, st, nv) {
  const W = new Float32Array(nv * V3MAN_NB), S = v3manSS;
  for (let i = 0; i < nv; i++) {
    const o = i * st, y = VB[o + 1], z = VB[o + 2], ay = Math.abs(y), L = y >= 0, w = i * V3MAN_NB;
    const arm = S(.15, .25, ay) * S(1.22, 1.32, z), fa = S(.44, .54, ay);   // 手臂：肩外侧、腋窝以上；肘前后 5 厘米过渡
    const leg = (1 - S(.8, .97, z)) * (1 - arm), sn = 1 - S(.44, .56, z), sl = S(-.035, .035, y);   // 腿：臀部过渡到骨盆；膝前后 6 厘米过渡；两腿之间按左右分
    const rest = 1 - arm - leg, hd = S(1.5, 1.6, z) * (1 - S(.12, .17, ay)), ch = S(.98, 1.2, z);
    W[w + (L ? 3 : 5)] = arm * (1 - fa); W[w + (L ? 4 : 6)] = arm * fa;
    W[w + 7] = leg * sl * (1 - sn); W[w + 8] = leg * sl * sn; W[w + 9] = leg * (1 - sl) * (1 - sn); W[w + 10] = leg * (1 - sl) * sn;
    W[w + 2] = rest * hd; W[w + 1] = rest * (1 - hd) * ch; W[w] = rest * (1 - hd) * (1 - ch);
  }
  return W;
}

// —— 3）姿势 ——
// 参数（度）：aL / aR 手臂 [下放（90 = 自然下垂）, 前摆, 屈肘, 绕臂扭转]；lL / lR 腿 [髋屈（向前为正）, 外展, 屈膝]；t 躯干 [前倾, 扭转]；h 头 [低头, 转头]；
//   dz 骨盆下沉（米）；lie 趴着的（按站立的样子摆，v3gMan 整个放平：站立时的「上」是趴下后的「前」，站立时的「后」是趴下后的「上」）
const V3MAN_A0 = [82, 3, 12, 0];   // 手臂自然下垂：稍离开身体，肘微屈
const V3MAN_BASE = { aL: V3MAN_A0, aR: V3MAN_A0, lL: [0, 2, 3], lR: [0, 2, 3], t: [2, 0], h: [0, 0], dz: 0, lie: false };
const V3MAN_AIM = { aR: [62, 58, 115, 0], aL: [72, 82, 35, 0] };   // 端枪：右手在胸前握把、左手前伸托护木（游戏里没画枪，样子是端着的）
const V3MAN_KNL = { lL: [88, 8, 92], lR: [-4, 6, 96], dz: .44 };   // 单膝跪：右膝着地（小腿平贴地面）、左脚踏地（大腿水平、小腿竖直）
function v3manSpec(p) {
  const B = V3MAN_BASE, mk = o => Object.assign({}, B, o), cyc = /^(w|r|y|cl|c|L)\d+$/.test(p), n = cyc ? +p.match(/\d+$/)[0] : 0, ph = c => n * Math.PI / c;
  switch (cyc ? p.replace(/\d+$/, '') : p) {
    case 'sa': return mk({ ...V3MAN_AIM, lL: [8, 4, 4], lR: [-6, 4, 2], t: [6, 0], h: [6, 0] });
    case 'w': { const f = ph(4), s = Math.sin(f), c = Math.cos(f);   // 走：步幅 ±24°，摆动腿屈膝最多约 60°，两臂反向摆 ±20°，肩微转
      return mk({ lL: [24 * s, 2, 6 + 55 * Math.max(0, c) ** 2], lR: [-24 * s, 2, 6 + 55 * Math.max(0, -c) ** 2], aL: [82, -20 * s, 14 + Math.max(0, -12 * s), 0], aR: [82, 20 * s, 14 + Math.max(0, 12 * s), 0], t: [3, 4 * s], dz: .02 * Math.abs(s) }); }
    case 'r': { const f = ph(4), s = Math.sin(f), c = Math.cos(f);   // 跑：步幅 ±40°，摆动腿高抬（屈膝到 110°），两臂屈肘 90° 大幅前后摆，身体前倾
      return mk({ lL: [40 * s, 3, 15 + 95 * Math.max(0, c) ** 1.5], lR: [-40 * s, 3, 15 + 95 * Math.max(0, -c) ** 1.5], aL: [75, -38 * s, 88, 0], aR: [75, 38 * s, 88, 0], t: [11, 7 * s], h: [-4, 0], dz: .03 }); }
    case 'y': { const f = ph(4), s = Math.sin(f), c = Math.cos(f);   // 弯腰抬着东西走（弹药兵抬弹）：屈膝、前倾 30°，两手在身前
      return mk({ lL: [30 + 18 * s, 4, 50 + 40 * Math.max(0, c) ** 2], lR: [30 - 18 * s, 4, 50 + 40 * Math.max(0, -c) ** 2], aL: [72, 50, 75, 0], aR: [72, 50, 75, 0], t: [30, 0], h: [-12, 0], dz: .2 }); }
    case 'kn': return mk({ ...V3MAN_KNL, ...V3MAN_AIM, t: [6, 0], h: [6, 0] });   // 跪射
    case 'knp': return mk({ ...V3MAN_KNL, aR: [90, 55, 5, 0], aL: [82, 35, 55, 0], t: [12, 0], h: [5, 0] });   // 弹射官：单膝跪下、右手指向前方（放飞）
    case 'kw': return mk({ ...V3MAN_KNL, aL: [88, 68, 48, 0], aR: [88, 68, 48, 0], t: [22, 0], h: [16, 0] });   // 跪在机腹下双手扶弹
    case 'pt': return mk({ aL: [0, 0, 85, -90], aR: [0, 0, 85, -90], lL: [0, 7, 3], lR: [0, 7, 3] });   // 调度手势：两臂平举、小臂竖起（向前滑行 / 看我）
    case 'pt2': return mk({ aL: [0, 0, 125, -90], aR: [0, 0, 125, -90], lL: [0, 7, 3], lR: [0, 7, 3] });   // 同一手势的另一拍：小臂往里招
    case 'hp': return mk({ aR: [90, 165, 8, 0], h: [-12, 0] });   // 举起拔下的保险销给飞行员看
    case 'hang': return mk({ aL: [90, 168, 18, 0], aR: [90, 168, 18, 0], lL: [12, 2, 18], lR: [6, 2, 12], h: [-8, 0] });   // 吊在伞下：两手上举抓着操纵带，腿并拢微屈
    case 'sit': return mk({ lL: [88, 6, 88], lR: [88, 6, 88], aL: [76, 50, 55, 0], aR: [76, 50, 55, 0], t: [-4, 0] });   // 坐着开车：两手在身前握方向盘
    case 'cl': { const s = Math.sin(ph(4));   // 爬梯子：两手交替往上抓、两腿交替上蹬，身体贴着梯子
      return mk({ aL: [90, 130 + 22 * s, 45 - 15 * s, 0], aR: [90, 130 - 22 * s, 45 + 15 * s, 0], lL: [38 + 28 * s, 4, 55 + 30 * s], lR: [38 - 28 * s, 4, 55 - 30 * s], t: [12, 0], h: [-15, 0] }); }
    case 'pr': return mk({ aL: [90, 155, 70, 0], aR: [90, 155, 70, 0], lL: [0, 9, 4], lR: [0, 9, 4], h: [-45, 0], lie: true });   // 卧倒：肘撑地、两手在脸前（端枪），两腿分开
    case 'c': { const s = Math.sin(ph(2)), u = Math.max(0, s), d = Math.max(0, -s);   // 匍匐：一侧手前伸、对侧膝往上收
      return mk({ aL: [90, 150 + 20 * s, 75, 0], aR: [90, 150 - 20 * s, 75, 0], lL: [25 * u, 12 + 25 * u, 60 * u], lR: [25 * d, 12 + 25 * d, 60 * d], h: [-40, 0], lie: true }); }
    case 'dead': return mk({ aL: [35, 25, 30, 0], aR: [55, -20, 45, 0], lL: [8, 14, 25], lR: [-4, 6, 8], t: [0, 10], h: [10, 50], lie: true });   // 阵亡：趴着、手脚摊开、头偏向一边
    case 'L': {   // 站 → 跪 → 卧的过渡（manim.js 姿态高度 × 8）：跪下一半、跪着俯身两手撑地
      const l = n / 8, kn = v3manSpec('kn');
      if (l <= 1) return v3manMix(B, kn, l);
      return v3manMix(kn, mk({ ...V3MAN_KNL, aL: [90, 55, 8, 0], aR: [90, 55, 8, 0], t: [48, 0], h: [-20, 0] }), Math.min(1, (l - 1) / .45));
    }
  }
  return mk({});
}
const v3manMix = (A, B, k) => { const o = {}; for (const key of Object.keys(A)) { const a = A[key], b = B[key]; o[key] = Array.isArray(a) ? a.map((v, i) => v + (b[i] - v) * k) : typeof a === 'number' ? a + (b - a) * k : k < .5 ? a : b; } return o; };
// 正向运动学：各骨的转动 R（3×3 行主序）、静止时的关节点 J、摆好后的关节点 T
function v3manFK(S) {
  const J = V3MAN_J, D = Math.PI / 180;
  const rot = (ax, a) => { const c = Math.cos(a * D), s = Math.sin(a * D); return ax === 0 ? [1, 0, 0, 0, c, -s, 0, s, c] : ax === 1 ? [c, 0, s, 0, 1, 0, -s, 0, c] : [c, -s, 0, s, c, 0, 0, 0, 1]; };
  const mm = (A, B) => [0, 1, 2].flatMap(i => [0, 1, 2].map(j => A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j]));
  const mv = (A, v) => [A[0] * v[0] + A[1] * v[1] + A[2] * v[2], A[3] * v[0] + A[4] * v[1] + A[5] * v[2], A[6] * v[0] + A[7] * v[1] + A[8] * v[2]];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], sd = (j, s) => [j[0], j[1] * s, j[2]];
  const R = [], T = [], P = [];
  R[0] = [1, 0, 0, 0, 1, 0, 0, 0, 1]; P[0] = J.pel; T[0] = [J.pel[0], J.pel[1], J.pel[2] - S.dz];
  R[1] = mm(R[0], mm(rot(1, S.t[0]), rot(2, S.t[1]))); P[1] = J.ch; T[1] = add(T[0], mv(R[0], sub(J.ch, J.pel)));
  R[2] = mm(R[1], mm(rot(1, S.h[0]), rot(2, S.h[1]))); P[2] = J.hd; T[2] = add(T[1], mv(R[1], sub(J.hd, J.ch)));
  for (const [s, u, f, A] of [[1, 3, 4, S.aL], [-1, 5, 6, S.aR]]) {   // 手臂：先绕臂扭转、再下放（绕 x）、再前摆（绕横轴）；肘按 T 字时的竖直轴屈（小臂向前）
    const Js = sd(J.sh, s), Je = sd(J.el, s), [dn, sw, el, tw] = A;
    R[u] = mm(R[1], mm(rot(1, -sw), mm(rot(0, -s * dn), rot(1, tw || 0)))); P[u] = Js; T[u] = add(T[1], mv(R[1], sub(Js, J.ch)));
    R[f] = mm(R[u], rot(2, -s * el)); P[f] = Je; T[f] = add(T[u], mv(R[u], sub(Je, Js)));
  }
  for (const [s, u, f, Lg] of [[1, 7, 8, S.lL], [-1, 9, 10, S.lR]]) {   // 腿：先外展、再屈髋；膝绕横轴屈（小腿向后）
    const Jh = sd(J.hp, s), Jk = sd(J.kn, s), [fl, ab, kn] = Lg;
    R[u] = mm(R[0], mm(rot(1, -fl), rot(0, s * ab))); P[u] = Jh; T[u] = add(T[0], mv(R[0], sub(Jh, J.pel)));
    R[f] = mm(R[u], rot(1, kn)); P[f] = Jk; T[f] = add(T[u], mv(R[u], sub(Jk, Jh)));
  }
  return { R, T, P };
}
// 这一姿势的顶点（线性混合蒙皮）与包围盒；站着的最低点落到地面
function v3manSkin(S) {
  const { R, T, P } = v3manFK(S), VB = V3MAN.VB, st = V3MAN.st, nv = V3MAN.nv, W = V3MAN.W, out = new Float32Array(VB);
  for (let i = 0; i < nv; i++) {
    const o = i * st, x = VB[o], y = VB[o + 1], z = VB[o + 2], nx = VB[o + 3], ny = VB[o + 4], nz = VB[o + 5];
    let px = 0, py = 0, pz = 0, qx = 0, qy = 0, qz = 0;
    for (let b = 0; b < V3MAN_NB; b++) {
      const w = W[i * V3MAN_NB + b];
      if (!w) continue;
      const A = R[b], j = P[b], t = T[b], dx = x - j[0], dy = y - j[1], dz = z - j[2];
      px += w * (A[0] * dx + A[1] * dy + A[2] * dz + t[0]); py += w * (A[3] * dx + A[4] * dy + A[5] * dz + t[1]); pz += w * (A[6] * dx + A[7] * dy + A[8] * dz + t[2]);
      qx += w * (A[0] * nx + A[1] * ny + A[2] * nz); qy += w * (A[3] * nx + A[4] * ny + A[5] * nz); qz += w * (A[6] * nx + A[7] * ny + A[8] * nz);
    }
    const l = Math.hypot(qx, qy, qz) || 1;
    out[o] = px; out[o + 1] = py; out[o + 2] = pz; out[o + 3] = qx / l; out[o + 4] = qy / l; out[o + 5] = qz / l;
  }
  const bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = 0; i < nv; i++) for (let k = 0; k < 3; k++) { const v = out[i * st + k]; if (v < bb[k]) bb[k] = v; if (v > bb[k + 3]) bb[k + 3] = v; }
  if (!S.lie) { const z0 = bb[2]; for (let i = 0; i < nv; i++) out[i * st + 2] -= z0; bb[2] = 0; bb[5] -= z0; }
  return { VB: out, bb };
}
// 调用处的姿势码 → 生成用的姿势：甲板人员跪下是弹射官的「跪下指向前方」；站 → 卧的过渡按姿态高度取几档（不必每一档都单独存一份）
function v3manAlias(kind, p) {
  if (p === 'kn' && /^deck/.test(kind)) return 'knp';
  if (p[0] === 'L') { const n = +p.slice(1); return n <= 2 ? 'L2' : n <= 4 ? 'L4' : n <= 6 ? 'L6' : n <= 9 ? 'kn' : n <= 11 ? 'L10' : 'pr'; }
  if (p[0] === 'c' && p[1] !== 'l' && !/^c[0-3]$/.test(p)) return 'pr';
  return p;
}

// —— 4）着装 ——
// 颜色（sRGB 0–1）：调用处在兵种后面跟 #rrggbb（甲板人员按分工）；飞行员固定飞行服
const V3MAN_DECK = '#e3b505';   // 没给颜色的甲板人员：黄马甲（调度员 / 弹射官）
const v3manHex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
function v3manCol(kind) {
  if (kind === 'pilot') return 'pil';
  if (!/^deck/.test(kind)) return null;
  const m = kind.match(/#[0-9a-fA-F]{6}$/);
  return (m ? m[0] : V3MAN_DECK).toLowerCase();
}
// 贴图遮罩：身体那张贴图上，按三角形在模型上的部位分区（R 上衣、G 裤子、B 头盔；手套、靴子不动）
function v3manMask(w, h) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const g = cv.getContext('2d'), VB = V3MAN.VB, st = V3MAN.st;
  g.fillStyle = '#000'; g.fillRect(0, 0, w, h); g.lineJoin = 'round'; g.lineWidth = 2.5;
  const T = V3MAN.tri.find(t => t.mi === 1);
  if (!T) return null;
  const zone = (x, y, z) => Math.abs(y) > .74 || z < .17 ? 0 : z > 1.6 ? 3 : z >= .98 ? 1 : 2;
  for (const pass of [2, 1, 3]) {
    const col = ['', '#ff0000', '#00ff00', '#0000ff'][pass];
    g.fillStyle = col; g.strokeStyle = col;
    for (let t = 0; t + 2 < T.I.length; t += 3) {
      const o = [T.I[t] * st, T.I[t + 1] * st, T.I[t + 2] * st], cx = (VB[o[0]] + VB[o[1]] + VB[o[2]]) / 3, cy = (VB[o[0] + 1] + VB[o[1] + 1] + VB[o[2] + 1]) / 3, cz = (VB[o[0] + 2] + VB[o[1] + 2] + VB[o[2] + 2]) / 3;
      if (zone(cx, cy, cz) !== pass) continue;
      g.beginPath(); g.moveTo(VB[o[0] + 6] * w, VB[o[0] + 7] * h); g.lineTo(VB[o[1] + 6] * w, VB[o[1] + 7] * h); g.lineTo(VB[o[2] + 6] * w, VB[o[2] + 7] * h); g.closePath(); g.fill(); g.stroke();
    }
  }
  return g.getImageData(0, 0, w, h).data;
}
async function v3manPaint(ck) {
  const M = V3G.M.army, ti = M.mats[1] && M.mats[1].t ? M.mats[1].t[0] : 1, blob = V3MAN.img && V3MAN.img[ti];
  if (!blob) throw new Error('没有身体贴图');
  const img = typeof createImageBitmap === 'function' ? await createImageBitmap(blob) : await new Promise((ok, no) => { const u = URL.createObjectURL(blob), I = new Image(); I.onload = () => { URL.revokeObjectURL(u); ok(I); }; I.onerror = no; I.src = u; });
  const w = img.width, h = img.height, cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const g = cv.getContext('2d'); g.drawImage(img, 0, 0);
  const D = g.getImageData(0, 0, w, h), px = D.data, mask = v3manMask(w, h);
  if (!mask) throw new Error('没有遮罩');
  // 亮度先模糊（去掉迷彩的数码方块花纹，留下大的明暗、褶皱）：积分图做 11 × 11 盒式模糊
  const lum = new Float32Array(w * h), I = new Float64Array((w + 1) * (h + 1));
  for (let i = 0; i < w * h; i++) lum[i] = (.299 * px[i * 4] + .587 * px[i * 4 + 1] + .114 * px[i * 4 + 2]) / 255;
  for (let y = 0; y < h; y++) { let s = 0; for (let x = 0; x < w; x++) { s += lum[y * w + x]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + s; } }
  const r = 5, blur = (x, y) => { const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1), y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1); return (I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0]) / ((x1 - x0) * (y1 - y0)); };
  const pil = ck === 'pil', jk = pil ? [.43, .46, .34] : v3manHex(ck), pants = pil ? jk : [.12, .14, .2], helm = pil ? [.9, .9, .88] : jk, avg = [0, 0, 0, 0], cnt = [0, 0, 0, 0];
  const zoneOf = i => mask[i * 4] > 127 ? 1 : mask[i * 4 + 1] > 127 ? 2 : mask[i * 4 + 2] > 127 ? 3 : 0;
  for (let i = 0; i < w * h; i++) { const z = zoneOf(i); if (z) { avg[z] += lum[i]; cnt[z]++; } }
  for (let z = 1; z < 4; z++) avg[z] = cnt[z] ? avg[z] / cnt[z] : .5;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, z = zoneOf(i);
    if (!z) continue;
    const c = z === 1 ? jk : z === 2 ? pants : helm, f = Math.min(1.25, Math.max(.45, .62 + 1.1 * (blur(x, y) - avg[z]) + .25 * (lum[i] - blur(x, y))));   // 大的明暗 + 一点细节（缝线、口袋边）
    px[i * 4] = Math.min(255, c[0] * f * 255); px[i * 4 + 1] = Math.min(255, c[1] * f * 255); px[i * 4 + 2] = Math.min(255, c[2] * f * 255);
  }
  g.putImageData(D, 0, 0);
  if (img.close) try { img.close(); } catch (e) { /* 已经关了 */ }
  const tex = M.tex.slice();
  tex[ti] = v3gUpload(cv);
  return tex;
}
function v3manTex(ck) {
  let E = V3MAN.tex.get(ck);
  if (E) return E.tex;
  E = { tex: null }; V3MAN.tex.set(ck, E);
  v3manPaint(ck).then(tex => { E.tex = tex; for (const [k, V] of V3MAN.v) if (V.ck === ck && V3G.M[k]) V3G.M[k].tex = tex; }).catch(e => console.warn('人物换装没成功：' + ck, e));
  return null;
}

// 这个人画哪一份：{ key 模型键（姿势 + 着装）, bb 包围盒, lie 要不要放平 }；模型还没好返回 null（v3gMan 照旧）
function v3manGet(kind, pose) {
  const M = V3G.M.army;
  if (!V3MAN.ok || !M || !M.ready) return null;
  const pk = v3manAlias(kind, pose || 'st'), ck = v3manCol(kind), key = 'army@' + pk + (ck ? '~' + ck : '');
  let V = V3MAN.v.get(key);
  if (V) return V;
  let P = V3MAN.P.get(pk);
  if (!P) {
    const S = v3manSpec(pk), Sk = v3manSkin(S), gl = V3G.gl, vb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, Sk.VB, gl.STATIC_DRAW);
    P = { vb, bb: Sk.bb, lie: !!S.lie }; V3MAN.P.set(pk, P);
  }
  V3G.M[key] = Object.assign({}, M, { key, vb: P.vb, tex: (ck && v3manTex(ck)) || M.tex });   // 换装的贴图还在画：先用原贴图
  V = { key, bb: P.bb, lie: P.lie, ck };
  V3MAN.v.set(key, V);
  return V;
}
