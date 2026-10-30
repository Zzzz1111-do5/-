'use strict';
// 飞控物理引擎（第一人称驾驶的飞机用，v3pilot.js）：六自由度刚体——位置、速度、姿态（四元数）、机体角速度，每帧切成 1/120 秒的小步积分。
//   气动：升力（线性段 + 失速后的平板升力）、零升阻力 + 诱导阻力 + 跨声速波阻 + 大迎角阻力、侧力；
//         俯仰 / 滚转 / 偏航力矩（静稳定、阻尼、舵面），陀螺耦合项；发动机：军用推力 + 加力，随空气密度衰减、随马赫数略增；重力。
//   飞控（电传，正常律）：拉杆量 → 过载指令（-3 到 +9 g；松杆时按坡度补偿，保持飞行轨迹），压杆量 → 滚转角速度指令（松杆保持坡度，小坡度自动改平）；
//         迎角限制、过载限制，偏航阻尼与协调转弯；舵面用动态逆算出（按当前动压求要多大舵偏才能得到想要的角加速度），舵偏与舵偏速率有限。
//   直接律（X 键切换）：杆直接对舵面，没有任何保护——会失速、会掉高度，静稳定会把机头压回来。
// 坐标：北东地（NED），机体系前右下（FRD）；游戏坐标（x 东、y 南、z 上，1 单位 = 1 米）↔ NED：n = −y、e = x、d = −z
const FL_G = 9.81, FL_DT = 1 / 120;
// 机型（公开资料估算）：m 质量 kg、S 翼面积 m²、b 翼展、c 平均气动弦长、I 转动惯量 [Ixx, Iyy, Izz]、Tm 军用推力、Ta 加力推力（两台合计，N）、
//   CLa 升力线斜率 /rad、as 失速迎角、CLmax、CD0、K 诱导阻力因子、alim 正常律迎角限制、nz 过载限制 [负, 正]、pmax 最大滚转角速度 rad/s、L 机长（座舱位置）
const FL_AC = {
  j35: { nm: '歼-35', m: 20000, S: 50, b: 11.5, c: 4.9, I: [3.6e4, 1.75e5, 2.0e5], Tm: 1.3e5, Ta: 2.0e5, CLa: 3.9, as: .46, CLmax: 1.75, CD0: .021, K: .12, alim: .43, nz: [-3, 9], pmax: 3.0, L: 17.3 },
  j16d: { nm: '歼-16D', m: 26000, S: 62, b: 14.7, c: 5.3, I: [6.0e4, 2.6e5, 3.0e5], Tm: 1.5e5, Ta: 2.5e5, CLa: 4.2, as: .5, CLmax: 1.9, CD0: .03, K: .12, alim: .45, nz: [-3, 8.5], pmax: 2.4, L: 21.9 }
};
// 气动导数（机体系前右下，常见战斗机的量级；角速度按 p b / 2V、q c / 2V 无量纲化）
const FL_D = { Cm0: .02, Cma: -.35, Cmq: -6, Cmde: -1.1, Clb: -.09, Clp: -.38, Clr: .06, Clda: .14, Cldr: .02, Cnb: .13, Cnr: -.28, Cnp: -.03, Cndr: -.09, Cnda: -.01, CYb: -.85, CYdr: .18 };
const FL_DMAX = [.44, .38, .52], FL_DRATE = [1.3, 2.4, 1.6];   // 舵偏上限、舵偏速率（rad、rad/s）：升降舵（全动平尾）、副翼、方向舵

// —— 四元数与旋转 ——
const flQmul = (a, b) => [a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3], a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2], a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1], a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0]];
function flRot(q) {   // 机体 → NED 的旋转矩阵（行主序）
  const [w, x, y, z] = q;
  return [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y), 2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x), 2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)];
}
const flMv = (R, v) => [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]];
const flMtv = (R, v) => [R[0] * v[0] + R[3] * v[1] + R[6] * v[2], R[1] * v[0] + R[4] * v[1] + R[7] * v[2], R[2] * v[0] + R[5] * v[1] + R[8] * v[2]];   // NED → 机体
function flQe(phi, th, psi) {   // 欧拉角（3-2-1：偏航、俯仰、滚转）→ 四元数
  const cr = Math.cos(phi / 2), sr = Math.sin(phi / 2), cp = Math.cos(th / 2), sp = Math.sin(th / 2), cy = Math.cos(psi / 2), sy = Math.sin(psi / 2);
  return [cr * cp * cy + sr * sp * sy, sr * cp * cy - cr * sp * sy, cr * sp * cy + sr * cp * sy, cr * cp * sy - sr * sp * cy];
}
function flEul(q) {   // 四元数 → [滚转, 俯仰, 偏航]
  const [w, x, y, z] = q;
  return [Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y)), Math.asin(clamp(2 * (w * y - z * x), -1, 1)), Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z))];
}
const flRho = h => 1.225 * Math.exp(-Math.max(0, h) / 9000);   // 空气密度（指数大气）
const flGround = (n, e) => typeof v3Ht === 'function' ? v3Ht(clamp(e, 0, W - 1), clamp(-n, 0, H - 1)) : 0;   // 3D 地面高度（海面 -2.6）
const flKey = p => p.v === 'ew' ? 'j16d' : 'j35';

// 接手：按游戏里这架飞机现在的位置、航向、速度、坡度建状态（配平迎角：升力等于重力）
function flInit(p) {
  const A = FL_AC[flKey(p)], z = typeof v3AirZ === 'function' ? v3AirZ(p) : 200, h = p.heading || 0, psi = Math.atan2(Math.cos(h), -Math.sin(h));
  const Va = clamp((p.spd || 200) * (typeof airK === 'function' ? airK(p) : .5) * 1.6, 170, 320), qb = .5 * flRho(z) * Va * Va, at = clamp(A.m * FL_G / (qb * A.S) / A.CLa, 0, .2);
  const phi = clamp(p.bank || 0, -1, 1), q = flQe(phi, at, psi), R = flRot(q);
  const vb = [Va * Math.cos(at), 0, Va * Math.sin(at)];   // 机体系：迎角 at 时气流从下前方来
  return (p.fl = { k: flKey(p), P: [-p.y, p.x, -z], V: flMv(R, vb), q, w: [0, 0, 0], d: [0, 0, 0], ab: false, law: 'n', nz: 1, a: at, b: 0, M: Va / 340, Va, T: 0, stall: 0, sy: 0, sx: 0 });
}

// 推演一帧：inp = { x 压杆（右正，−1–1）, y 拉杆（拉为正）, r 蹬舵, thr 油门 0–1, ab 加力, law 'n' 正常律 / 'd' 直接律, ap 自动驾驶（离开作战区域时）}；返回 'ground' / 'sea' 表示撞地 / 落海
function flStep(F, dt, inp) {
  const A = FL_AC[F.k], D = FL_D, I = A.I;
  let hit = null;
  for (let t = 0; t < dt - 1e-9 && !hit; t += FL_DT) {
    const h = Math.min(FL_DT, dt - t), R = flRot(F.q), vb = flMtv(R, F.V), Va = Math.max(1, Math.hypot(vb[0], vb[1], vb[2]));
    const al = Math.atan2(vb[2], vb[0]), be = Math.asin(clamp(vb[1] / Va, -1, 1)), hm = -F.P[2], rho = flRho(hm), qb = .5 * rho * Va * Va, M = Va / 340;
    const [p, q, r] = F.w, Vn = Math.max(Va, 40), ph = p * A.b / (2 * Vn), qh = q * A.c / (2 * Vn), rh = r * A.b / (2 * Vn);
    const [phi, th] = flEul(F.q), qS = Math.max(qb * A.S, 50);
    // —— 飞控：算三个舵面想要的偏度 ——
    let de, da, dr;
    if (inp.law === 'd') { de = -inp.y * FL_DMAX[0]; da = inp.x * FL_DMAX[1]; dr = (inp.r || 0) * FL_DMAX[2]; }   // 直接律：杆对舵面
    else {
      // 俯仰：过载指令（松杆时按坡度补偿到能保持飞行轨迹的过载——倒飞时是负过载；拉杆往 +9 g、推杆往 −3 g）→ 迎角指令（不超迎角限制）→ 俯仰角速度指令 → 动态逆求升降舵
      const n0 = Math.abs(phi) < 1.4 ? clamp(Math.cos(th) / Math.max(Math.cos(phi), .35), 0, 2.6) : Math.cos(th) * Math.cos(phi), nzc = inp.y >= 0 ? lerp(n0, A.nz[1], inp.y) : lerp(n0, A.nz[0], -inp.y);
      const ac = clamp(nzc * A.m * FL_G / (qS * A.CLa), -.2, A.alim);
      const qc = clamp(2.8 * (ac - al) + FL_G / Vn * (nzc - Math.cos(th) * Math.cos(phi)), -1.3, 1.3);
      const Mreq = I[1] * 7 * (qc - q) - (I[2] - I[0]) * p * r, M0 = qS * A.c * (D.Cm0 + D.Cma * al + D.Cmq * qh);
      de = (Mreq - M0) / (qS * A.c * D.Cmde);
      // 滚转：角速度指令（松杆保持坡度，坡度小于 8° 时自动改平）
      const pc = inp.x ? inp.x * A.pmax : Math.abs(phi) < .14 ? -2.5 * phi : 0;
      const Lreq = I[0] * 13 * (pc - p) - (I[1] - I[2]) * q * r, L0 = qS * A.b * (D.Clb * be + D.Clp * ph + D.Clr * rh);
      da = (Lreq - L0) / (qS * A.b * D.Clda);
      // 偏航：协调转弯（偏航角速度跟着坡度）+ 侧滑归零（偏航阻尼）
      const rc = FL_G / Vn * Math.sin(phi) * Math.cos(th) + 3 * be + (inp.r || 0) * .4;
      const Nreq = I[2] * 4.5 * (rc - r) - (I[0] - I[1]) * p * q, N0 = qS * A.b * (D.Cnb * be + D.Cnr * rh + D.Cnp * ph + D.Cnda * F.d[1]);
      dr = (Nreq - N0) / (qS * A.b * D.Cndr);
    }
    // 舵机：限偏度、限速率
    const cmd = [de, da, dr];
    for (let i = 0; i < 3; i++) F.d[i] = clamp(F.d[i] + clamp(clamp(cmd[i], -FL_DMAX[i], FL_DMAX[i]) - F.d[i], -FL_DRATE[i] * h, FL_DRATE[i] * h), -FL_DMAX[i], FL_DMAX[i]);
    // —— 气动力 ——
    const sa = smooth(A.as, A.as + .25, Math.abs(al)), CL = lerp(clamp(A.CLa * al, -A.CLmax, A.CLmax), 1.05 * Math.sin(2 * al), sa);   // 过了失速迎角升力掉下来、变成平板升力
    const CD = A.CD0 * (1 + 1.3 * smooth(.85, 1.05, M) - .4 * smooth(1.2, 1.8, M)) + A.K * CL * CL + 1.3 * Math.sin(al) ** 2 * sa + .04 * (Math.abs(F.d[0]) + Math.abs(F.d[2]));
    const CY = D.CYb * be + D.CYdr * F.d[2];
    const ab = !!inp.ab, thr = clamp(inp.thr, 0, 1), T = (A.Tm * thr + (ab ? A.Ta - A.Tm : 0)) * (rho / 1.225) ** .75 * (1 + .25 * Math.min(M, 1.6));
    const ca = Math.cos(al), sn = Math.sin(al);
    const Fb = [qb * A.S * (CL * sn - CD * ca) + T, qb * A.S * CY, qb * A.S * (-CL * ca - CD * sn)];
    // —— 力矩 ——
    const Lm = qb * A.S * A.b * (D.Clb * be + D.Clp * ph + D.Clr * rh + D.Clda * F.d[1] + D.Cldr * F.d[2]);
    const Mm = qb * A.S * A.c * (D.Cm0 + D.Cma * al + D.Cmq * qh + D.Cmde * F.d[0] - .25 * sa * Math.sign(al));   // 失速后机头往下掉
    const Nm = qb * A.S * A.b * (D.Cnb * be + D.Cnr * rh + D.Cnp * ph + D.Cndr * F.d[2] + D.Cnda * F.d[1]);
    // —— 积分（半隐式欧拉）——
    const an = flMv(R, Fb);
    for (let i = 0; i < 3; i++) F.V[i] += (an[i] / A.m + (i === 2 ? FL_G : 0)) * h;
    F.w[0] += (Lm + (I[1] - I[2]) * q * r) / I[0] * h;
    F.w[1] += (Mm + (I[2] - I[0]) * p * r) / I[1] * h;
    F.w[2] += (Nm + (I[0] - I[1]) * p * q) / I[2] * h;
    for (let i = 0; i < 3; i++) F.P[i] += F.V[i] * h;
    const dq = flQmul(F.q, [0, F.w[0], F.w[1], F.w[2]]);
    for (let i = 0; i < 4; i++) F.q[i] += .5 * dq[i] * h;
    const ql = Math.hypot(...F.q); for (let i = 0; i < 4; i++) F.q[i] /= ql;
    Object.assign(F, { a: al, b: be, M, Va, T, nz: -Fb[2] / (A.m * FL_G), stall: sa, ab });
    // 撞地 / 落海
    const g = flGround(F.P[0], F.P[1]);
    if (-F.P[2] < g + 1.5) hit = g <= -2 ? 'sea' : 'ground';
  }
  return hit;
}
// 写回游戏状态：位置、航向（机头）、坡度、速度表、高度档（防空、特效按它）
function flToGame(p) {
  const F = p.fl, [phi, th, psi] = flEul(F.q), g = flGround(F.P[0], F.P[1]);
  p.x = F.P[1]; p.y = -F.P[0];
  p.heading = Math.atan2(-Math.cos(psi), Math.sin(psi));
  p.bank = phi; p.pt3 = th;
  p.spd = F.Va / (typeof airK === 'function' ? Math.max(airK(p), .3) : .5);
  p.alt = clamp((-F.P[2] - Math.max(g, -2.6)) / (typeof V3_AIR === 'number' ? V3_AIR : 230) + .05, .05, 1);
}
