'use strict';
// 飞控物理引擎（第一人称驾驶的飞机用，v3pilot.js）：六自由度刚体——位置、速度、姿态（四元数）、机体角速度，每帧切成 1/120 秒的小步积分。
//   气动：升力（线性段 + 失速后的平板升力）、零升阻力 + 诱导阻力 + 跨声速波阻 + 大迎角阻力、侧力；
//         俯仰 / 滚转 / 偏航力矩（静稳定、阻尼、舵面），陀螺耦合项；发动机：军用推力 + 加力，随空气密度衰减、随马赫数略增；重力。
//   飞控（电传，正常律）：拉杆量 → 过载指令（-3 到 +9 g；松杆时按坡度补偿，保持飞行轨迹），压杆量 → 滚转角速度指令（松杆保持坡度，小坡度自动改平）；
//         迎角限制、过载限制，偏航阻尼与协调转弯；舵面用动态逆算出（按当前动压求要多大舵偏才能得到想要的角加速度），舵偏与舵偏速率有限。
//   直接律（X 键切换）：杆直接对舵面，没有任何保护——会失速、会掉高度，静稳定会把机头压回来。
//   起降：起落架（放下约 5 秒，加阻力；160 米 / 秒以上放不下）、襟翼（两档，加升力也加阻力）、减速板；
//         接地（flSurf：航母飞行甲板、夺取的机场跑道才能落，别处、没放起落架、下沉太快、坡度 / 俯仰太大都是摔）→ 地面滑跑：
//         横滚压平、前轮落地，蹬舵 / 压杆转弯，推力 − 阻力 − 滚动摩擦（按住减速板键刹车），升力够了离地；放下尾钩在斜角甲板上挂住拦阻索（F.ev）
// 坐标：北东地（NED），机体系前右下（FRD）；游戏坐标（x 东、y 南、z 上，1 单位 = 1 米）↔ NED：n = −y、e = x、d = −z
const FL_G = 9.81, FL_DT = 1 / 120;
// 机型（公开资料估算）：m 质量 kg、S 翼面积 m²、b 翼展、c 平均气动弦长、I 转动惯量 [Ixx, Iyy, Izz]、Tm 军用推力、Ta 加力推力（两台合计，N）、
//   CLa 升力线斜率 /rad、as 失速迎角、CLmax、CD0、K 诱导阻力因子、alim 正常律迎角限制、nz 过载限制 [负, 正]、pmax 最大滚转角速度 rad/s、L 机长（座舱位置）
const FL_AC = {
  j35: { nm: '歼-35', cv: true, m: 20000, S: 50, b: 11.5, c: 4.9, I: [3.6e4, 1.75e5, 2.0e5], Tm: 1.3e5, Ta: 2.0e5, CLa: 3.9, as: .46, CLmax: 1.75, CD0: .021, K: .12, alim: .43, nz: [-3, 9], pmax: 3.8, L: 17.3 },
  // 歼-16 对地满挂：6 枚 500 公斤级炸弹 + 4 枚空空弹约 3.8 吨外挂——更重、阻力更大、过载限制降到 7.5 g、滚转慢
  j16: { nm: '歼-16', m: 30500, S: 62, b: 14.7, c: 5.3, I: [6.8e4, 2.8e5, 3.3e5], Tm: 1.5e5, Ta: 2.5e5, CLa: 4.2, as: .5, CLmax: 1.9, CD0: .038, K: .12, alim: .42, nz: [-2.5, 7.5], pmax: 2.6, L: 21.9 },
  // 歼-16 导弹卡车：8 枚霹雳-15 + 2 枚霹雳-10 约 1.9 吨外挂，挂架多、阻力比 D 型的吊舱小一点
  j16m: { nm: '歼-16 导弹卡车', m: 26500, S: 62, b: 14.7, c: 5.3, I: [6.2e4, 2.65e5, 3.05e5], Tm: 1.5e5, Ta: 2.5e5, CLa: 4.2, as: .5, CLmax: 1.9, CD0: .03, K: .12, alim: .45, nz: [-3, 8.5], pmax: 3, L: 21.9 },
  j16d: { nm: '歼-16D', m: 26000, S: 62, b: 14.7, c: 5.3, I: [6.0e4, 2.6e5, 3.0e5], Tm: 1.5e5, Ta: 2.5e5, CLa: 4.2, as: .5, CLmax: 1.9, CD0: .03, K: .12, alim: .45, nz: [-3, 8.5], pmax: 3.2, L: 21.9 },
  j15t: { nm: '歼-15T', cv: true, m: 24000, S: 62, b: 14.7, c: 5.3, I: [5.4e4, 2.5e5, 2.9e5], Tm: 1.55e5, Ta: 2.5e5, CLa: 4.2, as: .5, CLmax: 1.9, CD0: .026, K: .12, alim: .45, nz: [-3, 8.5], pmax: 3.3, L: 21.9 },
  // 歼-20：鸭翼 + 三角翼，两台涡扇-10C（军用推力各约 90 千牛、加力约 142 千牛），作战重量约 25 吨
  j20: { nm: '歼-20', m: 25000, S: 73, b: 13, c: 6.6, I: [5.5e4, 2.6e5, 3.0e5], Tm: 1.8e5, Ta: 2.84e5, CLa: 3.6, as: .52, CLmax: 1.85, CD0: .019, K: .14, alim: .47, nz: [-3, 9], pmax: 3.6, L: 20.4 },
  // 歼-50：官方未公布，按外界估算
  j50: { nm: '歼-50', cv: true, m: 24000, S: 70, b: 12.5, c: 6.5, I: [5.0e4, 2.4e5, 2.8e5], Tm: 1.7e5, Ta: 2.6e5, CLa: 3.5, as: .48, CLmax: 1.7, CD0: .018, K: .14, alim: .43, nz: [-3, 9], pmax: 3.5, L: 19 },
};
// 型号键（carrier.js AIR_MDL）→ 上面的飞控参数
const FL_KEY = { j35: 'j35', j35s: 'j35', j16d: 'j16d', j16: 'j16', j16m: 'j16m', j15t: 'j15t', j20: 'j20', j50: 'j50' };
// 耗油率（千克 / 牛 / 秒）：军用推力约 0.8、加力约 1.9 磅 / 磅力 / 小时（涡扇战斗机的典型值）
const FL_TSFC = [2.27e-5, 5.4e-5];
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
const flGround = (n, e) => typeof v3HtX === 'function' ? v3HtX(e, -n) : typeof v3Ht === 'function' ? v3Ht(clamp(e, 0, W - 1), clamp(-n, 0, H - 1)) : 0;   // 3D 地面高度（海面 -2.6）；飞出地图也按画面上的（无边海面、北面延伸的岛）
const flKey = p => FL_KEY[typeof airMdlKey === 'function' ? airMdlKey(p.kind, p.v) : ''] || (p.v === 'ew' ? 'j16d' : 'j35');
// 起降：机轮着地时重心离地面的高度（与 view3d.js V3_DECK 的 1.5 一致）、各种限制
const FL_GH = 1.5, FL_LND = { vle: 160, sinkCv: 7.6, sinkRw: 4.2, roll: .35, pmin: -.12, pmax: .38, mu: .03, muB: .45 };   // 起落架限速（米 / 秒）、舰载机 / 陆基接地下沉率上限、坡度、俯仰、滚动 / 刹车摩擦系数
// 能落的地面：航母飞行甲板（多边形里，甲板离水线 CVG.zd）、夺取且能用的机场跑道（abn.js），别处是陆地 / 海面
function flSurf(n, e) {
  const x = e, y = -n;
  if (typeof cvAll === 'function' && typeof CVG === 'object') for (const c of cvAll()) {
    if (!(c.hp > 0) || c.x < -999) continue;
    const [u, v] = cvL(x, y, c);
    if (u < -160 || u > 160 || v < -45 || v > 40 || !flIn(CVG.deck, u, v)) continue;
    return { z: -2.6 + CVG.zd, k: 'deck', c, u, v };
  }
  const hb = typeof S === 'object' && S && S.afP;   // 进攻方战区机场（afp.js，南缘外）的跑道
  if (hb && typeof eaL === 'function' && typeof EA_RW === 'object') { const [u, v] = eaL(hb, x, y); if (Math.abs(u) <= EA_RW.hl && Math.abs(v) <= EA_RW.hw) return { z: AFP.z, k: 'rwy', u, v, b: hb }; }
  const b = typeof S === 'object' && S && S.abBase;
  if (b && !b.dead && typeof eaL === 'function' && typeof EA_RW === 'object') {
    const [u, v] = eaL(b, x, y);
    if (Math.abs(u) <= EA_RW.hl && Math.abs(v) <= EA_RW.hw) return { z: flGround(n, e), k: typeof abAfOpen === 'function' && abAfOpen() ? 'rwy' : 'land', u, v, b };
  }
  const g = flGround(n, e);
  return { z: g, k: g <= -2 ? 'sea' : 'land' };
}
const flIn = (P, x, y) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) if ((P[i][1] > y) !== (P[j][1] > y) && x < (P[j][0] - P[i][0]) * (y - P[i][1]) / (P[j][1] - P[i][1]) + P[i][0]) c = !c; return c; };
// 斜角甲板着舰中线上的位置（0 舰尾端 — 1 前端）与离中线的横向距离（carrier.js CVG.land）
function flLandT(u, v) {
  const L = CVG.land, du = L.u1 - L.u0, dv = L.v1 - L.v0, l2 = du * du + dv * dv;
  return { t: ((u - L.u0) * du + (v - L.v0) * dv) / l2, lat: Math.abs((u - L.u0) * dv - (v - L.v0) * du) / Math.sqrt(l2) };
}

// 接手：按游戏里这架飞机现在的位置、航向、速度、坡度建状态（配平迎角：升力等于重力）
function flInit(p) {
  const A = FL_AC[flKey(p)], z = typeof v3AirZ === 'function' ? v3AirZ(p) : 200, h = p.heading || 0, psi = Math.atan2(Math.cos(h), -Math.sin(h));
  const Va = clamp((p.spd || 250) * (typeof airK === 'function' ? airK(p) : 1), 70, 340), qb = .5 * flRho(z) * Va * Va, at = clamp(A.m * FL_G / (qb * A.S) / A.CLa, 0, .2);
  const cap = (typeof airReal === 'function' && airReal(p.kind, p.v).fuel) || 8000;   // 机内燃油（carrier.js AIR_REAL）；接手时按已经飞了一段、剩七成五算
  const phi = clamp(p.bank || 0, -1, 1), q = flQe(phi, at, psi), R = flRot(q);
  const vb = [Va * Math.cos(at), 0, Va * Math.sin(at)];   // 机体系：迎角 at 时气流从下前方来
  const sz = typeof airMdl === 'function' ? airMdl(p.kind, p.v).size || 15 : 15, gh = typeof v3gPlaneZc === 'function' && typeof airSilKey === 'function' ? clamp(v3gPlaneZc(airSilKey(p.kind, p.v), sz), 1, 2.6) : FL_GH;   // 机轮着地时重心离地多高：按画出来的模型（起落架长短、补起落架抬高的都不一样），落地时机轮正好贴着地面
  return (p.fl = { k: flKey(p), P: [-p.y, p.x, -z], V: flMv(R, vb), q, w: [0, 0, 0], d: [0, 0, 0], ab: false, law: 'n', nz: 1, a: at, b: 0, M: Va / 340, Va, T: 0, stall: 0, sy: 0, sx: 0, cap, fuel: clamp(p.fuel ?? cap * .75, 0, cap), ff: 0,
    gear: 0, flap: 0, gnd: false, gs: 0, ev: null, gh });
}

// 推演一帧：inp = { x 压杆（右正，−1–1）, y 拉杆（拉为正）, r 蹬舵, thr 油门 0–1, ab 加力, law 'n' 正常律 / 'd' 直接律, ap 自动驾驶（离开作战区域时）,
//   gear 起落架放下（true / false）, flap 襟翼档 0–1, sb 减速板（地面上是刹车）, hook 尾钩放下 }；返回 'ground' / 'sea' 表示撞地 / 落海；起降事件记在 F.ev
function flStep(F, dt, inp) {
  const A = FL_AC[F.k], D = FL_D, I = A.I, mk = inp.mk || 1, mp = inp.mkp || mk, mt = inp.mt || 1;   // mp：滚转角速度的放大（单独给，免得滚得太快不好控）   // mk：机动性放大（皇牌空战式操纵，v3pilot.js FP_MK）——升力、过载限制、滚转角速度一起乘上，飞机像机翼大三成、结构强三成，转得急、滚得快
  //   mt：推力放大（同上，FP_MT：推重比跟着机动性提高，耗油仍按真实推力算）
  let hit = null;
  // 起落架：放下 / 收起各约 5 秒；超过限速放不下（F.ev 提示一次）
  const gw = inp.gear ? 1 : 0;
  if (gw && F.gear < 1 && F.Va > FL_LND.vle && !F.gnd) { if (!F.vleW) F.ev = { k: 'vle' }; F.vleW = true; }
  else { F.vleW = false; F.gear = clamp(F.gear + (gw ? 1 : -1) * dt / 5, F.gnd ? 1 : 0, 1); }
  F.flap = clamp((F.flap || 0) + clamp((inp.flap || 0) - (F.flap || 0), -dt / 4, dt / 4), 0, 1);   // 襟翼约 4 秒放到底
  F.sb = !!inp.sb; F.hook = !!inp.hook;
  for (let t = 0; t < dt - 1e-9 && !hit; t += FL_DT) {
    const h = Math.min(FL_DT, dt - t);
    if (F.gnd) { hit = flRoll(F, h, inp); continue; }
    const R = flRot(F.q), vb = flMtv(R, F.V), Va = Math.max(1, Math.hypot(vb[0], vb[1], vb[2]));
    const al = Math.atan2(vb[2], vb[0]), be = Math.asin(clamp(vb[1] / Va, -1, 1)), hm = -F.P[2], rho = flRho(hm), qb = .5 * rho * Va * Va, M = Va / 340;
    const [p, q, r] = F.w, Vn = Math.max(Va, 40), ph = p * A.b / (2 * Vn), qh = q * A.c / (2 * Vn), rh = r * A.b / (2 * Vn);
    const [phi, th] = flEul(F.q), qS = Math.max(qb * A.S, 50);
    // —— 飞控：算三个舵面想要的偏度 ——
    let de, da, dr;
    if (inp.law === 'd') { de = -inp.y * FL_DMAX[0]; da = inp.x * FL_DMAX[1]; dr = (inp.r || 0) * FL_DMAX[2]; }   // 直接律：杆对舵面
    else {
      // 俯仰：过载指令（松杆时按坡度补偿到能保持飞行轨迹的过载——倒飞时是负过载；拉杆往 +9 g、推杆往 −3 g）→ 迎角指令（不超迎角限制）→ 俯仰角速度指令 → 动态逆求升降舵
      //   坡度补偿只到约 50°（再大就是在做机动，靠拉杆），50°–60° 平滑退到「只抵重力分量」——原来在 80° 处一刀切，横滚滚过去时机头猛一点头
      const cf = Math.cos(phi), n0 = Math.cos(th) * (cf + smooth(1.05, .85, Math.abs(phi)) * (1 / Math.max(cf, .4) - cf)), nzc = inp.y >= 0 ? lerp(n0, A.nz[1] * mk + (inp.hg ? 2 : 0), inp.y) : lerp(n0, A.nz[0], -inp.y);
      //   hg：高 G 急转——越过飞控的过载限制（多 2 g）、迎角多放一点，但不过失速迎角（原来多放 6°，歼-20 一拉就进失速）
      const kn = qS * A.CLa * mk / (A.m * FL_G), ac = clamp(nzc / kn, -.2, Math.min(A.alim + (inp.hg ? .1 : 0), A.as - .02));
      //   迎角回路增益按动压排（电传的增益调度）：高速 3.6（迎角约 0.28 秒跟上，拉到 9 g 约 0.6 秒），低速动压只有十分之一，舵面推不动、作动筒跟不上，
      //   还按 3.6 要就来回过冲（迎角 −19° ↔ +24° 地点头，带着左右摇：用户说的低速摇摆），慢到进近速度退到 1.4。
      //   俯仰角速度的前馈按「迎角限制下拉得出的过载」ac × kn 算（用户：很容易失速）——原来按要的过载算：速度不够、要的过载拉不出来时，
      //   前馈要的角速度比迎角回路往回收的还大，迎角一路冲过失速迎角（缠斗时 20 秒里有 17 秒在 40° 迎角的深失速里，边转边掉高度）
      const ka = lerp(1.4, 3.6, smooth(4000, 16000, qb)), qc = clamp(ka * (ac - al) + FL_G / Vn * (ac * kn - Math.cos(th) * Math.cos(phi)), -1.5, 1.5);
      const Mreq = I[1] * lerp(3.5, 7, smooth(4000, 16000, qb)) * (qc - q) - (I[2] - I[0]) * p * r, M0 = qS * A.c * (D.Cm0 + D.Cma * al + D.Cmq * qh);   // 俯仰角速度回路同样按动压排：低速舵面饱和、作动筒跟不上时不来回打满舵
      de = (Mreq - M0) / (qS * A.c * D.Cmde);
      // 滚转：角速度指令（松杆保持坡度，坡度小于 8° 时自动改平）
      const pc = inp.x ? inp.x * A.pmax * mp : Math.abs(phi) < .14 ? -2.5 * phi : 0;
      const Lreq = I[0] * lerp(7, 13, smooth(4000, 16000, qb)) * (pc - p) - (I[1] - I[2]) * q * r, L0 = qS * A.b * (D.Clb * be + D.Clp * ph + D.Clr * rh);
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
    const fl = F.flap || 0, sa = smooth(A.as, A.as + .25, Math.abs(al)), CL = mk * lerp(clamp(A.CLa * al + .45 * fl, -A.CLmax, A.CLmax + .45 * fl), 1.05 * Math.sin(2 * al), sa);   // 过了失速迎角升力掉下来、变成平板升力；襟翼加升力
    // 诱导阻力按机动性放大倍数除一下：升力放大后同样迎角的诱导阻力涨到 mk² 倍，满过载急转几秒就把速度耗光（用户：容易失速）——相当于翼展效率也跟着好一些
    const CD = A.CD0 * (1 + 1.3 * smooth(.85, 1.05, M) - .4 * smooth(1.2, 1.8, M)) + A.K * CL * CL / mk + 1.3 * Math.sin(al) ** 2 * sa + .04 * (Math.abs(F.d[0]) + Math.abs(F.d[2]))
      + .018 * F.gear + .035 * fl + (F.sb ? .06 : 0);   // 起落架、襟翼、减速板的阻力
    const CY = D.CYb * be + D.CYdr * F.d[2];
    const ab = !!inp.ab && F.fuel > 0, thr = F.fuel > 0 ? clamp(inp.thr, 0, 1) : 0, T = (A.Tm * thr + (ab ? A.Ta - A.Tm : 0)) * (rho / 1.225) ** .75 * (1 + .25 * Math.min(M, 1.6)) * mt;   // 燃油耗尽：发动机熄火，只能滑翔
    F.ff = T / mt * FL_TSFC[ab ? 1 : 0]; F.fuel = Math.max(0, F.fuel - F.ff * h);   // 耗油（千克 / 秒）
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
    F.ad = (F.ad || 0) + ((al - (F.a ?? al)) / h - (F.ad || 0)) * Math.min(1, h * 10);   // 迎角变化率（约 0.1 秒平滑）：歼-20 鸭翼画面上的拉杆前导（v3det.js v3dCtlP）
    Object.assign(F, { a: al, b: be, M, Va, T, nz: -Fb[2] / (A.m * FL_G), stall: sa, ab });
    // 接地：航母甲板、跑道上放着起落架、姿态和下沉率都在限内就转入地面滑跑；别处、没放起落架、太猛都是摔
    const sf = flSurf(F.P[0], F.P[1]), hz = -F.P[2] - sf.z, GH = F.gh || FL_GH;
    if (hz < GH) {
      const [ph2, th2] = flEul(F.q), vs = F.V[2], ok = sf.k === 'deck' || sf.k === 'rwy', lim = A.cv ? FL_LND.sinkCv : FL_LND.sinkRw;
      const why = !ok ? null : hz < GH - 2.5 ? (sf.k === 'deck' ? '撞上舰体' : '撞地') : F.gear < .95 ? '没放起落架' : vs > lim ? `接地太猛（下沉 ${vs.toFixed(1)} 米 / 秒）` : Math.abs(ph2) > FL_LND.roll ? '翼尖擦地' : th2 < FL_LND.pmin ? '前轮先着地' : th2 > FL_LND.pmax ? '机尾擦地' : '';
      if (!ok || why) { hit = sf.k === 'sea' ? 'sea' : 'ground'; F.crash = why || (sf.k === 'land' ? '在跑道外接地' : ''); }
      else {
        const psi = flEul(F.q)[2];
        Object.assign(F, { gnd: true, gk: sf.k, gs: Math.max(0, F.V[0] * Math.cos(psi) + F.V[1] * Math.sin(psi)), tdV: vs, tw: sf.k === 'deck' ? flLandT(sf.u, sf.v).t : null, w: [0, 0, 0] });
        F.P[2] = -(sf.z + GH); F.V[2] = 0;
        F.ev = { k: 'td', vs, sf: sf.k };
      }
    }
  }
  return hit;
}
// 地面滑跑一小步：横滚压平；俯仰——前轮落地，速度够了拉杆抬头（离地）；航向——蹬舵、压杆都转（低速前轮转向，高速方向舵）；
//   纵向：推力 − 气动阻力 − 滚动摩擦（按住减速板键 = 刹车）；甲板上放着尾钩、越过一道拦阻索就挂住（F.ev trap）；冲出跑道 / 甲板
function flRoll(F, h, inp) {
  const A = FL_AC[F.k], [, th0, psi0] = flEul(F.q), sf = flSurf(F.P[0], F.P[1]);
  if (sf.k !== F.gk) {
    if (sf.k === 'sea' || (F.gk === 'deck' && sf.k !== 'deck')) { F.gnd = false; F.ev = { k: 'edge' }; return null; }   // 冲出甲板前端 / 舷边：掉下去，升力够就飞起来（复飞）
    if (F.gs > 12) { F.crash = '冲出跑道'; return 'ground'; }
    F.gs = 0;
  }
  const rho = flRho(-F.P[2]), qb = .5 * rho * F.gs * F.gs, fl = F.flap || 0;
  // 俯仰：拉杆、速度够了抬头（最多约 13°），松杆前轮放下
  const thc = (inp.y || 0) > .05 && F.gs > 45 ? clamp(inp.y, 0, 1) * .23 : 0, th = th0 + clamp(thc - th0, -.35 * h, .2 * h);
  const CL = A.CLa * th + .45 * fl, L = qb * A.S * CL, CD = A.CD0 + A.K * CL * CL + .018 + .035 * fl + (F.sb ? .06 : 0) + Math.max(0, th) * .4;
  const ab = !!inp.ab && F.fuel > 0, thr = F.fuel > 0 ? clamp(inp.thr, 0, 1) : 0, T = (A.Tm * thr + (ab ? A.Ta - A.Tm : 0)) * (rho / 1.225) ** .75;
  F.ff = T * FL_TSFC[ab ? 1 : 0]; F.fuel = Math.max(0, F.fuel - F.ff * h);
  const N = Math.max(0, A.m * FL_G - L), mu = F.sb ? FL_LND.muB : FL_LND.mu;
  F.gs = Math.max(0, F.gs + (T - qb * A.S * CD - mu * N) / A.m * h);
  const st = clamp((inp.r || 0) + (inp.x || 0) * .7, -1, 1), yr = st * (F.gs < 25 ? .45 : .45 * 25 / F.gs) * Math.min(1, F.gs / 3);
  const psi = psi0 + yr * h, c = Math.cos(psi), s = Math.sin(psi);
  F.V = [F.gs * c, F.gs * s, 0];
  F.P[0] += F.V[0] * h; F.P[1] += F.V[1] * h; F.P[2] = -(sf.z + (F.gh || FL_GH));
  F.q = flQe(0, th, psi); F.w = [0, 0, 0];
  Object.assign(F, { Va: F.gs, M: F.gs / 340, a: th, b: 0, nz: 1, T, stall: 0, ab });
  if (L > A.m * FL_G * 1.02 && th > .05) { F.gnd = false; F.V[2] = -1.5; F.ev = { k: 'lo' }; return null; }   // 离地
  if (sf.k === 'deck' && F.hook && sf.c) {   // 尾钩：越过一道拦阻索就挂住（索在着舰中线上 CVG.wires，横向偏出着舰区挂不上）
    const T2 = flLandT(sf.u, sf.v), t0 = F.tw ?? T2.t;
    F.tw = T2.t;
    if (T2.lat < CVG.land.hw) for (let i = 0; i < CVG.wires.length; i++) { const w = CVG.wires[i]; if (t0 < w && T2.t >= w) { F.ev = { k: 'trap', wire: i + 1, t: T2.t, c: sf.c }; break; } }
  }
  return null;
}
// 写回游戏状态：位置、航向（机头）、坡度、速度表、高度档（防空、特效按它）
function flToGame(p) {
  const F = p.fl, [phi, th, psi] = flEul(F.q), g = flGround(F.P[0], F.P[1]);
  p.x = F.P[1]; p.y = -F.P[0];
  p.heading = Math.atan2(-Math.cos(psi), Math.sin(psi));
  p.bank = phi; p.pt3 = th;
  p.spd = F.Va / (typeof airK === 'function' ? Math.max(airK(p), .3) : .5);
  p.alt = clamp((-F.P[2] - Math.max(g, -2.6)) / (typeof V3_AIR === 'number' ? V3_AIR : 230) + .05, .05, 1);
  p.fuel = F.fuel;   // 交回 AI 再接手时接着用
}
