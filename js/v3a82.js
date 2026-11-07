'use strict';
// 第 82 空降师的三维画面（a82.js 的推演；模型都是用户给的 / Sketchfab CC-BY，tools/v3gmodels.json）：
//   1）手里的枪：82 师的伞兵不拿程序补的方块步枪，按各人的武器（A82_T 的 w）拿真实模型——M4A1、M249、M110、M240B、标枪发射器（含 CLU）、毒刺。
//      姿势、两手握枪的位置照 v3man.js（v3manSpec 的枪架势 + 反向运动学）：同一套关节算出不带枪的身体（v3manSkin 不接方块枪），
//      再按 FK 给的枪托底板、枪口方向、枪的上方（G = {o, u, up}）把枪模型摆上去（每型的握把、枪管轴线位置量过，V3A_GUN）。
//   2）伞降：T-11 伞下吊着的伞兵（与 101 同一套伞衣），重装平台三具大伞（G-11 直径约 30 米）吊着 JLTV 实车模型 / M119A3；高度是真实的 244 / 335 米往下落。
//   3）CH-47F（模型旋翼前后反转）：吊索挂着 M777A2，放下后炮班（飞机比例的人）围着炮作业；落地卸载、旋翼下洗卷起尘土。
//   4）阵地：M777 榴弹炮阵地用 M777A2 模型、M270 火箭炮排用 M270 模型、82 师的迫击炮班用 M224A1 模型（两人跪着装填）。
//   5）标枪导弹：GoldbergR 的弹体模型按攻顶弹道飞，出筒的一团烟、主发动机的火焰与白色烟迹（a82Fx，v3fx.js 调用）。
// 尺寸：地面装备按游戏的地面比例（士兵 V3_MAN、车辆约 2 倍、火炮约 2.1 倍），飞机按飞机比例（CH-47F 0.9）；吊在飞机下面的炮跟飞机同一比例，架成阵地时换成阵地比例
if (typeof V3G_AIR === 'object') Object.assign(V3G_AIR, { ch47: 'ch47', sh60b: 'sh60b' });
if (typeof V3G_HELI === 'object') Object.assign(V3G_HELI, { ch47: 1, sh60b: 1 });
// 旋翼转速（弧度 / 秒）：CH-47F 225 转 / 分（前后两副反向转，模型里后旋翼的轴朝下）；SH-60B 与 UH-60 相同 258 转 / 分
if (typeof V3G_ROTOR === 'object') Object.assign(V3G_ROTOR, { ch47: [23.6, 0], sh60b: [27, 60] });
if (typeof V3G_VEH === 'object') V3G_VEH.jltv = 'jltv';   // JLTV 用用户给的 JLTV 模型（原来借 M-ATV）
const V3A = { P: new Map(), bf: -1, n: 0, S: null };
const V3A_K = { ch47: 20.8 / 23.1, gun: 2.1, m270: 2.0 };   // CH-47F 画 20.8（与黑鹰 17 / 19.8 同比例）；阵地火炮约 2.1 倍（与原来程序画的 M777 一样大）
// 枪在手里：off 枪模型 x 处沿枪身离枪托底板多远（s = x + off）、az 枪管轴线高（模型 z）、cy 枪身中线（模型 y）——
//   握把落在右手（s ≈ 0.33）、护木在左手（s ≈ 0.62），枪托抵在肩窝；发射筒架在右肩上（轴线比肩窝高 8 厘米），CLU / 瞄具在眼前
const V3A_GUN = {
  m4a1: { off: .45, az: .058, cy: 0 }, m249: { off: .52, az: .125, cy: 0 }, m110: { off: .53, az: .02, cy: 0 }, m240: { off: .58, az: .05, cy: .48 },
  javl: { off: .52, az: 0, cy: .16 }, stinger: { off: -.15, az: -.1, cy: .053 }
};
const a82Rz = (t, v) => { const c = Math.cos(t), s = Math.sin(t); return [v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2]]; };
const a82Ry = (p, v) => { const c = Math.cos(p), s = Math.sin(p); return [v[0] * c - v[2] * s, v[1], v[0] * s + v[2] * c]; };
// 这个姿势不带方块枪的身体 + 枪的位置（v3man.js 的函数；没有就返回 null，照原样画）。每帧最多新生成一个
function a82Pose(pk) {
  if (V3A.S !== S) { V3A.S = S; }
  let P = V3A.P.get(pk);
  if (P) return P;
  const M = typeof V3G === 'object' && V3G.M.army;
  if (typeof v3manSpec !== 'function' || typeof v3manFK !== 'function' || typeof v3manSkin !== 'function' || typeof V3MAN !== 'object' || !V3MAN.ok || !M || !M.ready) return null;
  if (V3A.bf !== V3G.frame) { V3A.bf = V3G.frame; V3A.n = 0; }
  if (V3A.n >= 1) return false;
  V3A.n++;
  const Sp = v3manSpec(pk, true), F = v3manFK(Sp);
  if (!F || !F.G) { V3A.P.set(pk, P = { none: true }); return P; }
  const lie = !!Sp.lie, Sk = v3manSkin(Object.assign({}, Sp, { lie: true }), false), z0 = lie ? 0 : Sk.bb[2], st = V3MAN.st, nv = V3MAN.nv, VB = Sk.VB, bb = Sk.bb.slice();
  if (!lie) { for (let i = 0; i < nv; i++) VB[i * st + 2] -= z0; bb[2] = 0; bb[5] -= z0; }
  const gl = V3G.gl, vb = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, VB, gl.STATIC_DRAW);
  const key = 'army@' + pk + '!82';
  V3G.M[key] = Object.assign({}, M, { key, vb });
  P = { key, bb, lie, G: F.G, z0 };
  V3A.P.set(pk, P);
  return P;
}
// 画一个 82 师的伞兵（v3units.js 画步兵时先问这里）：画了返回 true
function a82Man(q, i, kind, pose, x, y, z, a, k, sd) {
  const gk = q.a82w && q.a82w[i], E = V3G.C && V3G.C.E;
  if (!gk || !V3A_GUN[gk] || typeof v3manAlias !== 'function' || typeof V3MAN_NOGUN !== 'object') return false;
  if (E && Math.hypot(x - E[0], -y - E[1], z - E[2]) > 260) return false;   // 远处看不清手里拿的什么：照普通士兵画（和别的步兵合批，少画一个枪模型）
  const pk = v3manAlias('rifle', pose || 'st');
  if (V3MAN_NOGUN.test(pk)) return false;
  const P = a82Pose(pk);
  if (P === false) return true;   // 这一帧没轮到生成：先不画（不闪一下方块枪）
  if (!P || P.none || !v3gModel(gk)) return false;
  const c = Math.cos(a), s = Math.sin(a), mm = (P.bb[2] + P.bb[5]) / 2 * k;
  if (!P.lie) v3gAdd(P.key, x, y, z, a, k, sd, 0, 0);
  else v3gAdd(P.key, x - c * mm, y - s * mm, z + P.bb[3] * k, a, k, sd, 0, -Math.PI / 2);
  // 枪：枪模型坐标 → 人的模型坐标（G 的三个方向）→ 世界（与人同一套变换：先放平（趴着的）、再转朝向）
  const C = V3A_GUN[gk], G = P.G, o = P.lie ? G.o : [G.o[0], G.o[1], G.o[2] - P.z0], u = G.u, up = G.up;
  const l = [up[1] * u[2] - up[2] * u[1], up[2] * u[0] - up[0] * u[2], up[0] * u[1] - up[1] * u[0]];
  const tg = [0, 1, 2].map(j => o[j] + u[j] * C.off - l[j] * C.cy - up[j] * C.az), th = -a;
  const Rs = v => P.lie ? a82Rz(th, a82Ry(-Math.PI / 2, v)) : a82Rz(th, v);
  const T0 = P.lie ? [x - c * mm, -(y - s * mm), z + P.bb[3] * k] : [x, -y, z], ts = Rs(tg);
  const X = Rs(u), Z = Rs(up), pt = Math.asin(clamp(X[2], -1, 1)), hd = Math.atan2(X[1], X[0]), Zh = a82Rz(-hd, Z), rl = Math.atan2(-Zh[1], Zh[2] * Math.cos(pt) - Zh[0] * Math.sin(pt));
  v3gAdd(gk, T0[0] + k * ts[0], -(T0[1] + k * ts[1]), T0[2] + k * ts[2], -hd, k, sd, rl, pt);
  return true;
}
// 用户给的模型画的守方阵地（v3units.js 画阵地时先问这里；画了返回 true，不再画程序建的）
const a82Plain = e => !e.mod || !Object.keys(e.mod).length;
function a82Emp(e, a, z, seat) {
  if (e.decoy) return false;
  const sd = e.dead ? 2 : 1;
  if (e.kind === 'arty') {
    const g = e.a82g || (e.mod && e.mod.salvo ? 'm270' : a82Plain(e) ? 'm777' : null);
    if (g === 'm777') return !!v3gAdd('m777', e.x, e.y, seat(e.x, e.y, 9) + .3, a, V3A_K.gun, sd, e.dead ? .1 : 0, 0);
    if (g === 'm270') {   // M270：发射箱朝车体右侧转出、起竖（模型的摆法）——车头朝射向左转 90°；车体中心在模型 y = 2.84 处
      const h = a - Math.PI / 2, kk = V3A_K.m270, ox = 2.84 * kk * Math.sin(h), oy = -2.84 * kk * Math.cos(h);
      return !!v3gAdd('m270', e.x - ox, e.y - oy, v3Ht(e.x, e.y), h, kk, sd, e.dead ? .08 : 0, 0);
    }
    return false;
  }
  if (e.kind === 'mortar' && e.a82m) {   // M224A1 + 两个炮手（一个跪着装填、一个跪在瞄准镜旁）
    const kk = typeof V3_MAN === 'number' ? V3_MAN : 1.9, zz = seat(e.x, e.y, 3) + .3;
    if (!v3gAdd('m224', e.x, e.y, zz, a, kk, sd, 0, 0)) return false;
    if (!e.dead && typeof v3gMan === 'function') for (const [u, v, p] of [[.9, -1.1, 'kw'], [-.5, .9, 'kn']]) { const c = Math.cos(a), s = Math.sin(a); v3gMan('rifle', p, e.x + (u * c - v * s) * kk, e.y + (u * s + v * c) * kk, zz, a, kk, 1); }
    return true;
  }
  return false;
}
// 推演里的高度（米，离地）→ 3D：地面 + 高度
const a82Z = (x, y, h) => v3Ht(clamp(x, 0, W - 1), clamp(y, 0, H - 1)) + h;
// 吊索：四根，从机腹吊钩到炮的四个吊点（炮模型单位）
function v3mA82Sling() {
  const M = mbNew();
  for (const [x, y] of [[2.6, 1.1], [2.6, -1.1], [-2.2, 1.4], [-2.2, -1.4]]) mbTube(M, [0, 0, 6.2], [x, y, 2.6], .03, .03, 4, .45);
  return M;
}
// 每帧（v3units.js v3mCollect 调用）：伞、重装平台、吊着 / 放在地上的火炮、炮班、标枪
function a82Collect(inB, seen, spec, t) {
  const E8 = S && S.e82;
  if (!E8) return;
  const VM = typeof V3_MAN === 'number' ? V3_MAN : 1.9, VP = typeof V3_PIL === 'number' ? V3_PIL : .95;
  for (const c of E8.ch) {   // 天上的伞老远就看得见：双方都画
    if (!inB(c.x, c.y, 120) || !isFinite(c.z)) continue;
    const g = v3Ht(clamp(c.x, 0, W - 1), clamp(c.y, 0, H - 1)), id = c.id || 0, sw = Math.sin(t * 1.3 + id) * .08, a = Math.sin(id) * 3;
    if (c.k === 'team') {
      if (!c.men.length) continue;
      const hang = 5.4 * 2.2 + 1.85 * VM, zf = g + Math.max(0, c.z), op = clamp(c.t / A82.open, .25, 1);   // 开伞的头几秒伞衣还没张满
      if (typeof v3mChute === 'function') v3mAdd('chute:team', () => v3mChute('team'), c.x, c.y, zf + hang, a, 2.2 * op, 1, sw);
      const s = Math.sin(sw) * hang;
      v3gMan('rifle', 'hang', c.x + s * Math.sin(a), c.y - s * Math.cos(a), zf, a, VM, 1, sw);
    } else {   // 重装平台：三具 G-11 大伞吊着平台，平台上是 JLTV 实车 / M119A3（程序建的牵引炮外形）
      const zf = g + Math.max(0, c.z), kc = 5.6 * clamp(c.t / 4, .3, 1), top = zf + 3.6 + 5.4 * kc;
      for (const [ox, oy] of [[-11, -6], [11, -6], [0, 11]]) if (typeof v3mChute === 'function') v3mAdd('chute:team', () => v3mChute('team'), c.x + ox, c.y + oy, top, a, kc, 1, sw * .5);
      v3mAdd('a82plat', () => { const M = mbNew(); mbBox(M, -3.2, 3.2, -1.4, 1.4, 0, .45, .55); return M; }, c.x, c.y, zf, c.h || 0, 2, 1);
      if (c.v.k === 'jltv') v3gAdd('jltv', c.x, c.y, zf + .9, c.h || 0, 12 / 6.24, 1);
      else v3mAdd('st:arty', () => v3mFort('arty'), c.x, c.y, zf + .9, c.h || 0, .55, 1);
    }
  }
  // CH-47F 吊着的 M777A2（飞机比例），吊索；落地卸载时机舱里走出来的炮班
  for (const a of (S.eair && S.eair.fly) || []) {
    if (!a.a82 || a.type !== 'ch47' || a.dead || !inB(a.x, a.y, 200) || !(spec || a.pv || seen(a.x, a.y))) continue;
    const k = V3A_K.ch47, zc = typeof v3gPlaneZc === 'function' ? v3gPlaneZc('ch47', 23.1 * k) : 2.6, za = v3AirZ(a), belly = za - zc + .9 * k;
    if (a.load) {
      const zl = Math.max(v3Ht(a.x, a.y), belly - 6.2 * k);   // 炮底（模型原点）：吊钩下 6.2 米；着地就停在地上
      v3gAdd('m777', a.x, a.y, zl, a.heading, k, 1, 0, 0);
      v3mAdd('a82sling', v3mA82Sling, a.x, a.y, zl, a.heading, k, 1);
    }
    if (a.ph === 'gnd82') {   // 炮班从后跳板下来，往炮那边走
      const u = clamp((S.t - a.pT) / 20, 0, 1), c = Math.cos(a.heading), s = Math.sin(a.heading);
      for (let i = 0; i < 6; i++) { const back = 6 + u * 30 + (i % 3) * 2.2, side = (i - 2.5) * 1.6, x = a.x - c * back - s * side, y = a.y - s * back + c * side; v3gMan('rifle', 'w' + ((Math.floor(S.t * 3 + i) % 8 + 8) % 8), x, y, v3Ht(x, y), a.heading + Math.PI, VP, 1); }
    }
  }
  // 放在地上、正在架设的 M777A2（还是飞机比例）：炮班围着炮作业
  for (const g of E8.cx) {
    if (g.done || !inB(g.x, g.y) || !(spec || seen(g.x, g.y))) continue;
    const k = V3A_K.ch47, z = v3Ht(g.x, g.y);
    v3gAdd('m777', g.x, g.y, z, g.face, k, 1, 0, 0);
    if (S.t - g.t > 8 && typeof v3gMan === 'function') {
      const c = Math.cos(g.face), s = Math.sin(g.face), crew = [[-3.5, 1.6, 'kw'], [-3.5, -1.6, 'kw'], [-1.2, 2.2, 'st'], [.6, -2, 'y' + (Math.floor(S.t * 2) & 7)], [-6, 0, 'kn'], [1.5, 2.4, 'st']];
      for (const [u, v, p] of crew) { const x = g.x + (u * c - v * s) * k, y = g.y + (u * s + v * c) * k; v3gMan('rifle', p, x, y, v3Ht(x, y), g.face, VP, 1); }
    }
  }
  // 飞行中的标枪：弹体（士兵比例），头 1.5 秒从肩上的高度过渡到推演高度
  for (const m of E8.jv) {
    if (m.done || !inB(m.x, m.y, 60) || !(spec || seen(m.x, m.y) || seen(m.x0, m.y0))) continue;
    const z = a82Z(m.x, m.y, m.h) + (1 - clamp(m.t / 1.5, 0, 1)) * 1.4;
    v3gAdd('javm', m.x, m.y, z, m.hd, VM, 1, m.t * 9, m.pt);   // 弹体按弹翼导转慢慢滚
  }
}
// 特效（v3fx.js 调用；out 发光、sm 遮挡的烟）：标枪出筒的烟团、主发动机火焰、白色烟迹；CH-47F 低飞时旋翼下洗卷起的尘土
function a82Fx(out, sm, C, inB, seen) {
  const E8 = S && S.e82;
  if (!E8 || typeof v3fSpark !== 'function' || typeof v3fP !== 'function') return;
  for (const m of E8.jv) {
    if (!inB(m.x, m.y, 200) || !(seen(m.x, m.y) || seen(m.x0, m.y0))) continue;
    if (!m.puff && typeof V3F === 'object') { m.puff = true; V3F.puff.push({ x: m.x0, y: m.y0, z: a82Z(m.x0, m.y0, 1.2), t0: S.t, big: false, side: 'e' }); }   // 软发射：出筒的一小团烟
    const age = S.t - (m.doneT ?? S.t);
    for (let i = 0; i < m.tr.length; i++) {   // 烟迹：点出来后慢慢胀大、变淡、随风飘
      const p = m.tr[i], a = m.t - p[3] + age, f = clamp(1 - a / 9, 0, 1);
      if (f <= 0) continue;
      v3fSpark(sm, C, v3fP(p[0] + a * 1.5, p[1] - a, a82Z(p[0], p[1], p[2]) + a * .4), .9 + a * 1.1, [.86, .87, .85, .42 * f]);
    }
    if (!m.done && m.t > .3) {   // 主发动机的火焰（头 4 秒亮，之后是暗一些的尾焰）
      const b = m.t < 4 ? 1 : .5, hz = a82Z(m.x, m.y, m.h), bx = m.x - Math.cos(m.hd) * 1.2, by = m.y - Math.sin(m.hd) * 1.2;
      v3fSpark(out, C, v3fP(bx, by, hz), 1.2 * b, [1, .95, .8, .95]);
      v3fSpark(out, C, v3fP(bx, by, hz), 2.6 * b * (.85 + .15 * Math.sin(S.t * 50 + m.id)), [1, .6, .25, .45]);
    }
  }
  for (const a of (S.eair && S.eair.fly) || []) {   // 旋翼下洗：离地 30 米以下卷起一圈土
    if (!a.a82 || a.type !== 'ch47' || a.dead || !inB(a.x, a.y, 150) || !seen(a.x, a.y)) continue;
    const g = v3Ht(clamp(a.x, 0, W - 1), clamp(a.y, 0, H - 1)), hh = v3AirZ(a) - g;
    if (hh > 30) continue;
    const k = clamp(1 - hh / 30, 0, 1), sea = !isLand(a.x, a.y), col = sea ? [.88, .91, .93] : [.72, .66, .55];
    for (let i = 0; i < 14; i++) {
      const an = i * .4488 + S.t * .7, r = 16 + ((S.t * 9 + i * 7) % 18);
      v3fSpark(sm, C, v3fP(a.x + Math.cos(an) * r, a.y + Math.sin(an) * r, g + 1.5 + (i % 3)), 7 + (i % 4) * 2, [col[0], col[1], col[2], .32 * k]);
    }
  }
}
