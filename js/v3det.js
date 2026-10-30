'use strict';
// 3D 细节（只是画面，不进推演）：电磁弹射、加力尾焰、甲板车辆——
//   v3units.js 画航母、飞机、降落伞时调这里加模型实例（v3dCatUnits / v3dLaunch），v3fx.js 调 v3dFx 加发光与烟
// 机型坐标（airmdl.js AIRD）：x 机头、y 右翼、z 向上，单位是机型单位（乘 k = 画面尺寸 / 21 成世界单位）；
//   换到世界（朝向 a）：x' = x cos a − y sin a、y' = x sin a + y cos a（与 v3units.js 的实例着色器一致）

const v3dKey = p => typeof airSilKey === 'function' ? airSilKey(p.kind, p.v) : 'j35';
const v3dSz = p => typeof airSize3 === 'function' ? airSize3(p, 'p') : (typeof airMdl === 'function' && airMdl(p.kind, p.v).size) || 15, v3dK = p => v3dSz(p) / 21;   // 与 v3units.js 画机体用同一个尺寸

// ———————————————— 电磁弹射（carrier.js CVG.cats、cvdeck.js 的 'cat' / 'roll'）————————————————
//   弹射滑块：从甲板滑槽里露出一截，挂杆时卡在前起落架的弹射杆上；弹射时随飞机冲到行程末端，刹停，约 1.5 秒退回起点
//   直线电机：挂杆后整条滑轨微微发光（储能），越接近弹射越亮；弹射时滑块所在的一段定子最亮、身后一段渐暗、前面一小段刚通电
//   喷气机挂杆后推到最大推力、弹射前约 2 秒点加力（v3dDeckEng），尾焰打在升起的偏流板上（板面映亮）；离舰后先略微下沉、抬头爬升，约 2 秒后收起落架
const V3D_NOSE0 = 6;   // 没有飞机时滑块停在起点前 6 米（前起落架大致的位置）
const V3D_JET = { j35: 1, j20: 1, j15: 1, j15t: 1, j36: 1, j50: 1, f35: 1, f22: 1, f35b: 1 };   // 有加力的喷气机
// 前起落架离机身中心多远（世界单位）：用户给的模型里量的前轮位置（米，模型坐标）；没有起落架的模型按机长的两成
const V3D_NOSEX = { j31: 4, j20: 3.18 };
function v3dNose(key, k) {
  const mk = typeof V3G_AIR === 'object' && V3G_AIR[key], M = mk && typeof V3G === 'object' && V3G.M[mk];
  if (!M || !M.ready) return V3D_NOSE0;
  return (V3D_NOSEX[mk] ?? M.meta.len * .2) * k * 21 / M.meta.len;
}
// 弹射器 k 此刻：滑块位置 s（沿弹射器离起点多远）、阶段 m、挂着的飞机 p、挂杆进度 q、加力程度 burn
function v3dCat(cv, k, live) {
  const C = cvCat(k), p = live.find(o => o.cat === k && ((o.phase === 'cat' && (o.dk === 'line' || o.dk === 'hook')) || o.phase === 'roll'));
  if (p) {
    const nose = v3dNose(v3dKey(p), v3dK(p));
    if (p.phase === 'roll') return { s: (p.cs || 0) + nose, m: 'roll', p, q: 1, burn: 1 };
    if (p.dk === 'hook') return { s: nose, m: 'hook', p, q: (p.dkT || 0) / CVD.hook, burn: v3dDeckEng(p)[1] };
    return { s: V3D_NOSE0, m: 'line', p, q: 0, burn: 0 };   // 正滑上弹射器：滑块在起点等着
  }
  const u = S.t - ((cv.jl && cv.jl[k]) ?? -99), end = C.L + V3D_NOSE0 + 1;
  if (u < .3) return { s: end + 4 * (1 - (1 - u / .3) ** 2), m: 'brake', q: 0, burn: 0, u };   // 刹停：冲过行程末端一小段
  if (u < 2.2) return { s: lerp(end + 4, V3D_NOSE0, sm01((u - .5) / 1.7)), m: 'ret', q: 0, burn: 0, u };   // 退回起点
  return { s: V3D_NOSE0, m: 'rest', q: 0, burn: 0 };
}
// 弹射滑块（舰体坐标：x 沿弹射方向）：露出滑槽的一截、挂弹射杆的立板与前钩
function v3mdShuttle() {
  const M = mbNew();
  mbBox(M, -1.6, 1.6, -.55, .55, -.12, .18, .7, { taper: .12 });
  mbBox(M, -.55, .5, -.16, .16, .18, 1.05, .78, { taper: .05 });
  mbBox(M, .5, .95, -.16, .16, .72, 1.05, .78);
  return M;
}
// v3units.js：每条弹射器的滑块（top 飞行甲板顶面、h 航母朝向）
function v3dCatUnits(cv, live, top, h) {
  if (typeof CVG !== 'object' || typeof cvCat !== 'function') return;
  for (let k = 0; k < CVG.cats.length; k++) {
    const st = v3dCat(cv, k, live), [u, v] = cvCatPt(k, st.s), [x, y] = cvW(u, v, cv);
    v3mAdd('cvshut', v3mdShuttle, x, y, top + .02, h + cvCat(k).a, 1, 3);
  }
}
// v3fx.js：滑轨通电的光带、滑块亮点、挂杆末段与弹射时的加力、偏流板被尾焰映亮
function v3dCatFx(out, C, inB) {
  if (typeof cvAll !== 'function' || typeof CVG !== 'object' || typeof cvCat !== 'function') return;
  const E = C.E, zd = -2.6 + CVG.zd + .12;
  for (const cv of cvAll()) {
    if (!(cv.hp > 0) || cv.x < -999 || !inB(cv.x, cv.y, 220) || /075/.test(cv.name || '')) continue;
    const home = cvHome(cv), live = (S.planes || []).filter(p => !p.dead && cvHome(p) === home && !p.land && (p.phase === 'cat' || p.phase === 'roll'));
    for (const p of live) {   // 甲板上开着车的喷气机：喷口发热，挂杆后点加力（v3dDeckEng 的时间轴）
      const key = v3dKey(p), [th, tb] = V3D_JET[key] ? v3dDeckEng(p) : [0, 0];
      if (th > .03 || tb > .02) v3dBurner(out, C, p, key, v3dSz(p), { x: p.x, y: p.y, z: zd - .12, h: p.heading || 0, ground: true }, v3dEng('p' + p.id, th, tb, true));
    }
    for (let k = 0; k < CVG.cats.length; k++) {
      const st = v3dCat(cv, k, live), C0 = cvCat(k), L = C0.L + V3D_NOSE0 + 6;
      const P = s => { const [u, v] = cvCatPt(k, s), [x, y] = cvW(u, v, cv); return v3fP(x, y, zd); };
      const base = st.m === 'hook' ? .1 + .28 * sm01((st.q - .2) / .7) + .1 * st.burn * (.5 + .5 * Math.sin(S.t * 26)) : st.m === 'roll' ? .2 : st.m === 'brake' || st.m === 'ret' ? .2 * Math.max(0, 1 - st.u / 1.2) : 0;
      if (base > 0 || st.m === 'roll') for (let i = 0, n = 26; i < n; i++) {
        const s0 = L * i / n, s1 = L * (i + 1) / n, d = (s0 + s1) / 2 - st.s;
        let a = base;
        if (st.m === 'roll') a += d > 0 ? .5 * Math.max(0, 1 - d / 9) : .95 * Math.max(0, 1 + d / 26);   // 滑块前一小段刚通电，身后一段渐暗
        if (a < .02) continue;
        const c = [.55, 1, .92, Math.min(1, a)];
        v3fRib(out, E, P(s0 + .35), P(s1 - .35), 1.7, c, c);
      }
      if (st.m === 'roll' || st.m === 'brake') v3fSpark(out, C, P(st.s), st.m === 'roll' ? 2.6 : 1.6, [.8, 1, .95, st.m === 'roll' ? .9 : .5]);   // 滑块
      if (st.p && st.burn > .02) {
        const p = st.p, g = sm01((st.burn - .38) / .62), wash = st.burn * (st.m === 'roll' ? Math.max(0, 1 - (p.cs || 0) / 45) : 1), [ju, jv] = [C0.u - Math.cos(C0.a) * 9.5, C0.v - Math.sin(C0.a) * 9.5], [jx, jy] = cvW(ju, jv, cv);
        if (wash > .02) v3fSpark(out, C, v3fP(jx, jy, zd + 2.2), 6, [1, lerp(.42, .55, g), lerp(.15, .25, g), .22 * wash * (.8 + .2 * Math.sin(S.t * 43 + k))]);   // 偏流板被尾焰映亮
      }
    }
  }
}
// ———————————————— 飞行姿态：js/aero.js（tools/aero_jsbsim.py 用 JSBSim 离线算）————————————————
//   弹射离舰的头 14 秒：高度（含离舰后先下沉约 3 米）、俯仰、平尾、前缘襟翼、起落架照 JSBSim 的时间历程；
//   之后：俯仰 = 画面上的航迹角 + 迎角，迎角按升力线从速度、过载、翼载算（AERO.a0 / cla），平尾按配平规律 + 俯仰角速度
const V3_WS = { j35: 500, j20: 450, j15: 470, j36: 480, j50: 480, h6k: 520, y20: 620, kj600: 380 };   // 翼载（公斤 / 平方米，公开估算）：算迎角
const V3D_D2R = Math.PI / 180;
// 离舰后 u 秒的一行 [离甲板高, 俯仰, 迎角, 速度, 平尾, 前缘襟翼, 起落架]（插值）；超出 14 秒返回 null
function v3dAeroAt(u) {
  if (typeof AERO !== 'object' || !(u >= 0)) return null;
  const R = AERO.launch.rows, f = u / AERO.launch.dt, i = Math.floor(f);
  if (i >= R.length - 1) return null;
  const A = R[i], B = R[i + 1], t = f - i;
  return A.map((v, j) => v + (B[j] - v) * t);
}
// v3units.js plane()：刚离舰的舰载机（cvdeck.js 记的离舰时刻 p.lT）——起落架、俯仰、平尾照 JSBSim；高度在 view3d.js v3ClimbZ
function v3dLaunch(p) {
  const u = p.lT != null && p.phase === 'out' ? S.t - p.lT : -1, A = u >= 0 ? v3dAeroAt(u) : null;
  if (!A) return null;
  return { gear: A[6] > .5, pitch: A[1] * V3D_D2R, dz: 0, de: A[4] * V3D_D2R, lef: A[5] * V3D_D2R, u };
}
// 迎角（弧度）：升力系数 CL = n · 翼载 · g / (½ρV²)，α = a0 + CL / CLα（JSBSim 配平拟合的升力线），限在 −4°…18°
function v3dAlpha(o, key, n) {
  if (typeof AERO !== 'object') return 0;
  const V = Math.max(45, o.spd || 200), q = .5 * 1.15 * V * V, CL = n * (V3_WS[key] || 450) * 9.81 / q;
  return clamp(AERO.a0 + CL / AERO.cla, -4, 18) * V3D_D2R;
}
// 机身俯仰：航迹角（画面上每帧的高度变化与水平位移，平滑约 1/3 秒）+ 迎角（过载按航迹角变化率与坡度算）；刚离舰按 JSBSim 的俯仰，
//   12–14 秒平滑接上。顺带算舵面：平尾 / 鸭翼的偏角（配平 + 俯仰角速度）、左右差动（滚转角速度）。o 飞机、sd 1 = 敌方、z 画面高度、L = v3dLaunch(o)
const V3D_PT = new Map();
function v3dPitch(o, sd, z, L, key) {
  const id = (sd ? 'e' : 'p') + o.id;
  let P = V3D_PT.get(id);
  if (!P || P.S !== S || S.t < P.t) { P = { x: o.x, y: o.y, z, t: S.t, g: 0, gd: 0, pt: 0, q: 0, b: o.bank || 0, p: 0, de: 0, da: 0, S }; V3D_PT.set(id, P); }
  const dt = S.t - P.t;
  if (dt > 1e-4) {
    const dh = Math.hypot(o.x - P.x, o.y - P.y), g = clamp(Math.atan2(z - P.z, Math.max(dh, .3)), -.6, .5), g0 = P.g;
    P.g += (g - P.g) * Math.min(1, dt * 3); P.gd += ((P.g - g0) / dt - P.gd) * Math.min(1, dt * 2);
    const b = o.bank || 0; P.p += ((b - P.b) / dt - P.p) * Math.min(1, dt * 4); P.b = b;
    P.x = o.x; P.y = o.y; P.z = z;
  }
  if (V3D_PT.size > 400) for (const [k, v] of V3D_PT) if (v.S !== S || S.t - v.t > 5) V3D_PT.delete(k);
  const k = key || (o.kind && typeof v3dKey === 'function' ? v3dKey(o) : 'j35'), n = clamp((1 + Math.max(45, o.spd || 200) * P.gd / 9.81) / Math.max(.3, Math.cos(o.bank || 0)), -1, 9);
  const al = v3dAlpha(o, k, n), pf = P.g + al, w = L ? sm01((L.u - 12) / 2) : 1;
  const pt = L ? L.pitch * (1 - w) + pf * w : pf, q = dt > 1e-4 ? (pt - P.pt) / dt : P.q;
  P.q += (q - P.q) * Math.min(1, Math.max(dt, 0) * 4);
  // 平尾（JSBSim 符号：负 = 后缘上偏 = 抬头）：离舰照数据；之后按配平规律 δe = d0 + d1 α，再加俯仰角速度的一项
  const trim = typeof AERO === 'object' ? (AERO.d0 + AERO.d1 * al / V3D_D2R) * V3D_D2R : 0;
  P.de = L ? lerp(V3D_TOTRIM, L.de, sm01(L.u / .8)) * (1 - w) + (trim - .35 * P.q) * w : clamp(trim - .35 * P.q, -.3, .15);   // 离舰：从起飞配平过渡到 JSBSim 的平尾
  P.da = clamp(.3 * P.p, -.2, .2);   // 滚转：左右舵面差动
  P.t = S.t; P.pt = pt;
  return pt;
}
// 甲板上的舰载机：挂杆后先做舵面检查（杆前后左右推一遍，平尾上下摆、左右差动），之后停在起飞配平（后缘上偏约 10°）直到弹射
const V3D_TOTRIM = -.18;
function v3dDeckSurf(p) {
  if (p.phase === 'roll') return { de: V3D_TOTRIM, da: 0 };
  if (p.phase !== 'cat' || p.dk !== 'hook') return null;
  const t = p.dkT || 0, c = t < .5 ? -.35 * Math.sin(t / .5 * Math.PI) : t < 1 ? .25 * Math.sin((t - .5) / .5 * Math.PI) : 0, r = t >= 1 && t < 1.7 ? .22 * Math.sin((t - 1) / .7 * Math.PI * 2) : 0;
  return { de: c + V3D_TOTRIM * sm01((t - 1.5) / .5), da: r };
}
// 这一帧的舵面偏角（弧度）：de 平尾 / 鸭翼（负 = 抬头），da 差动
const v3dSurf = (o, sd) => { const P = V3D_PT.get((sd ? 'e' : 'p') + o.id); return P && P.S === S ? P : { de: 0, da: 0 }; };
// 3 × 3 旋转（与 v3units.js 实例着色器同一约定：先绕 x 滚转、再绕 y 俯仰（机头抬起为正）、再绕 z 转向；GL 坐标 y 取反）
const v3dRx = r => { const c = Math.cos(r), s = Math.sin(r); return [1, 0, 0, 0, c, -s, 0, s, c]; };
const v3dRy = p => { const c = Math.cos(p), s = Math.sin(p); return [c, 0, -s, 0, 1, 0, s, 0, c]; };
const v3dRz = a => { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; };
const v3dMul = (A, B) => { const o = []; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o.push(A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j]); return o; };
const v3dMv = (M, v) => [M[0] * v[0] + M[1] * v[1] + M[2] * v[2], M[3] * v[0] + M[4] * v[1] + M[5] * v[2], M[6] * v[0] + M[7] * v[1] + M[8] * v[2]];
// v3fx.js：这一帧算好的仰角（加力尾焰的方向）
const v3dPitchOf = (o, sd) => { const P = V3D_PT.get((sd ? 'e' : 'p') + o.id); return P && P.S === S ? P.pt : 0; };

// ———————————————— 发动机尾焰：喷口发热 → 加力点火的小火 → 变色的大火 ————————————————
//   照加力式涡扇的结构画：涡轮后面是尾锥、涡轮后机匣的支板与喷油杆，再往后两圈同心的 V 形火焰稳定器，外面是隔热衬套和收敛扩散喷管的调节片。
//   推油门时这些从里往外热起来：暗红 → 橙 → 橙黄（喷口里发动机变热的纹路）；开加力先在稳定器上点着一小团火（分区加力一区一区点），
//   根部蓝紫、尖上橙红；其余几区接连点着，火舌变长、变成白芯黄焰；全加力时喷流欠膨胀，喷口后约一个直径起一串激波马赫环，间隔约 1.2 个直径，越往后越暗、越偏橙粉
// 一架飞机的喷口（世界单位，相对锚点：空中是机身中线，ground 时是机轮着地点）：{ x, y, z, r 半径, w、hh 半宽、半高, d 喷管深 }——
//   用户给的模型里量的（tools/v3gmodels.json 的 noz，米，模型坐标 x 机头、y 左、z 离着地点高），按画面尺寸缩放；模型还没加载完就不画尾焰
function v3dNoz(key, sz, ground) {
  const mk = typeof V3G_AIR === 'object' && V3G_AIR[key], M = mk && typeof V3G === 'object' && V3G.M[mk], N = [];
  if (!M || !M.ready || !M.meta.noz) return N;
  const s = sz / M.meta.len, z0 = ground ? 0 : M.meta.zc;
  for (const n of M.meta.noz) for (const sg of n[1] ? [1, -1] : [1]) N.push({ x: n[0] * s, y: n[1] * sg * s, z: (n[2] - z0) * s, r: n[3] * s, d: n[4] * s, w: n[3] * s, hh: n[3] * s });
  return N;
}
// 炽热金属的颜色（近似黑体）：t 0 暗红 → .5 橙 → 1 淡黄；a 不透明度
const V3D_HOT = [[.4, .03, .01], [.85, .13, .03], [1, .3, .06], [1, .5, .15], [1, .7, .32], [1, .87, .58]];
function v3dHot(t, a) {
  const f = clamp(t, 0, 1) * 5, i = Math.min(4, f | 0), u = f - i, A = V3D_HOT[i], B = V3D_HOT[i + 1];
  return [A[0] + (B[0] - A[0]) * u, A[1] + (B[1] - A[1]) * u, A[2] + (B[2] - A[2]) * u, a];
}
// 发动机（画面用）：h 热度（0 冷、.3 慢车、.65 巡航、1 最大推力），b 加力（0 关 – 1 全加力）；th、tb 是此刻该有的值——
//   hard 时直接用（甲板上按时间轴），否则按速率追：推油门约 1.2 秒热起来、收油门约 8 秒才凉；加力约 .5 秒点满、.6 秒熄（火舌缩回小火再灭）
//   tL：加力点着的时刻（画点火那一下的闪光）
const V3D_ENG = new Map();
function v3dEng(id, th, tb, hard) {
  let E = V3D_ENG.get(id);
  if (!E || E.S !== S || S.t < E.t || S.t - E.t > 1.5) { E = { h: th, b: tb, t: S.t, tL: -99, S }; V3D_ENG.set(id, E); }
  const dt = S.t - E.t, b0 = E.b;
  if (hard) { E.h = th; E.b = tb; }
  else { E.h += clamp(th - E.h, -dt / 8, dt / 1.2); E.b += clamp(tb - E.b, -dt / .6, dt / .5); }
  if (b0 <= .02 && E.b > .02) E.tL = S.t;
  E.t = S.t;
  if (V3D_ENG.size > 300) for (const [k, v] of V3D_ENG) if (v.S !== S || S.t - v.t > 5) V3D_ENG.delete(k);
  return E;
}
// 甲板上的舰载机（cvdeck.js）：启动后慢车，喷口深处微微发红；挂上弹射杆后边做舵面检查边推到最大推力，喷口从里往外热透；
//   弹射前 CVD.ab 秒点加力：先一小团火（.3 → .38），约 .7 秒后其余四区每隔 .2 秒点着一区，涨到全加力，稳住约 .6 秒弹射。返回 [热度, 加力]
function v3dDeckEng(p) {
  if (p.phase === 'roll') return [1, 1];
  if (p.phase !== 'cat' || p.dk === 'brd' || p.dk === 'lift') return [0, 0];
  if (p.dk === 'eng') return [.3 * sm01((p.dkT || 0) / 2.5), 0];
  if (p.dk !== 'hook') return [.3, 0];
  const t = p.dkT || 0, lo = CVD.hook - CVD.ab, u = t - lo;
  let b = 0;
  if (u >= 0) { b = .3 * sm01(u / .12) + .08 * sm01((u - .12) / .6); for (let z = 0; z < 4; z++) b += .155 * sm01((u - .7 - z * .2) / .15); }
  return [lerp(.3, 1, sm01((t - .4) / (lo - .4))), Math.min(1, b)];
}
// 画一架喷气机的喷口与尾焰。o：锚点 x、y、z（ground 时是机轮着地点，否则是机身中线），朝向 h、俯仰 pt、滚转 rl；E = v3dEng(...)
//   喷口坐标：u 沿喷流向后（出口截面 u = 0，喷管里为负），v、w 在喷口平面里向右、向上；离镜头远了只画光，不画纹路
function v3dBurner(out, C, p, key, sz, o, E) {
  if (!E || !V3D_JET[key] || (E.h < .03 && E.b < .02)) return;
  const N = v3dNoz(key, sz, o.ground);
  if (!N.length) return;
  const R = v3dMul(v3dMul(v3dRz(-o.h), v3dRy(o.pt || 0)), v3dRx(o.rl || 0)), Ey = C.E, id = p.id || 0;
  const ht = E.h, ab = E.b, s1 = Math.min(1, ab / .3), g = sm01((ab - .38) / .62), fsh = Math.exp(-(S.t - E.tL) / .15);   // s1 小火、g 大火的程度，fsh 点火的闪光
  const hk = dl => clamp((ht - dl) / (1 - dl), 0, 1);   // 从里往外热：越靠外的部件热得越晚
  for (const n of N) {
    const c = [o.x + R[0] * n.x + R[1] * n.y + R[2] * n.z, -o.y + R[3] * n.x + R[4] * n.y + R[5] * n.z, o.z + R[6] * n.x + R[7] * n.y + R[8] * n.z];
    const P = (u, v, w) => [c[0] - R[0] * u + R[1] * v + R[2] * w, c[1] - R[3] * u + R[4] * v + R[5] * w, c[2] - R[6] * u + R[7] * v + R[8] * w];
    const r = n.r || Math.min(n.w, n.hh * 1.6), d = n.d, w0 = r * .075;
    const q = 1 - sm01((Math.hypot(c[0] - Ey[0], c[1] - Ey[1], c[2] - Ey[2]) / Math.max(r, .05) - 120) / 100);   // 纹路：离镜头近才画
    const rib = (a, b, w, c0, c1) => v3fRib(out, Ey, a, b, w, c0, c1 || c0);
    // —— 喷口里发热的纹路 ——
    if (ht > .03) {
      v3fSpark(out, C, P(-d * .8, 0, 0), (n.r ? r : Math.max(n.w, n.hh)) * .9, v3dHot(hk(0), .5 * hk(0)));   // 喷管深处涡轮、尾锥的光（外圈被喷管壁挡住）
      if (q > .01 && n.r) {
        const ring = (u, rr, col) => { for (let i = 0; i < 18; i++) { const a0 = i / 18 * 6.2832, a1 = a0 + .349; rib(P(u, Math.cos(a0) * rr, Math.sin(a0) * rr), P(u, Math.cos(a1) * rr, Math.sin(a1) * rr), w0, col); } };
        v3fSpark(out, C, P(-d * .78, 0, 0), r * .3, v3dHot(hk(0), .75 * hk(0) * q));   // 尾锥
        const cs = v3dHot(hk(.08), .5 * hk(.08) * q);
        for (let i = 0; i < 9; i++) { const a = i / 9 * 6.2832 + .3, ca = Math.cos(a), sa = Math.sin(a); rib(P(-d * .62, ca * r * .3, sa * r * .3), P(-d * .62, ca * r * .84, sa * r * .84), w0, cs); }   // 涡轮后机匣支板、喷油杆
        for (const [rr, dl] of [[.5, .15], [.78, .25]]) { const t = Math.max(hk(dl), .92 * s1); ring(-d * .48, r * rr, v3dHot(t, (.55 * hk(dl) + .45 * s1) * q)); }   // 火焰稳定器（点了加力火挂在上面，最亮）
        const cw = v3dHot(hk(.4) * .85, .3 * hk(.4) * q), ce = v3dHot(hk(.4) * .7, .1 * hk(.4) * q);
        for (let i = 0; i < 14; i++) { const a = i / 14 * 6.2832, ca = Math.cos(a), sa = Math.sin(a); rib(P(-d * .42, ca * r * .93, sa * r * .93), P(-d * .04, ca * r * .98, sa * r * .98), w0 * .8, cw, ce); }   // 调节片内壁受热的条纹
        ring(-d * .02, r * .99, v3dHot(hk(.55) * .8, .18 * hk(.55) * q));   // 喷口唇口
      } else if (q > .01) {   // 扁平喷口：几道横的导流片
        const cs = v3dHot(Math.max(hk(.1), .92 * s1), (.5 * hk(.1) + .4 * s1) * q);
        for (const f of [-.5, 0, .5]) rib(P(-d * .5, -n.w * .88, f * n.hh), P(-d * .5, n.w * .88, f * n.hh), w0, cs);
      }
    }
    if (ab <= .02) continue;
    // —— 加力：小火 → 大火（扁平喷口按宽度分几股） ——
    const K = n.r ? 1 : clamp(Math.round(n.w / (n.hh * 1.6)), 1, 3);
    for (let j = 0; j < K; j++) {
      const v0 = n.r ? 0 : -n.w + (2 * j + 1) * n.w / K, rf = n.r ? r : Math.min(n.w / K, n.hh * 1.6), D2 = rf * 2, F = u => P(u, v0, 0);
      const fk = 1 + .1 * Math.sin(S.t * 37 + id * 1.7 + v0 * 5 + n.y * 3) + .06 * Math.sin(S.t * 61 + id + j);   // 火舌抖动
      const cone = (u0, u1, wa, wb, ca, cb, ns) => { for (let i = 0; i < ns; i++) { const f0 = i / ns, f1 = (i + 1) / ns, cm = f => ca.map((x, m) => x + (cb[m] - x) * f); rib(F(lerp(u0, u1, f0)), F(lerp(u0, u1, f1)), lerp(wa, wb, (f0 + f1) / 2), cm(f0), cm(f1)); } };
      if (fsh > .02) v3fSpark(out, C, F(rf * .4), rf * 1.8, [1, .72, .4, .6 * fsh]);   // 点火那一下
      const Ls = D2 * (.7 + 1.4 * s1) * fk, k1 = s1 * (1 - .6 * g);   // 小火：一截半透明的火舌，根部蓝紫、中段粉橙、尖上橙红（大火起来后并进去）
      cone(0, Ls * .45, rf * 1.5, rf * 1.2, [.45, .48, 1, .42 * k1], [1, .5, .42, .32 * k1], 2);
      cone(Ls * .45, Ls, rf * 1.2, rf * .6, [1, .5, .42, .32 * k1], [1, .32, .12, 0], 2);
      cone(0, Ls * .4, rf * .7, rf * .4, [.8, .8, 1, .4 * k1], [1, .7, .5, 0], 2);
      if (g > .01) {   // 大火：外层橙红的混合层、黄色的焰身、白芯（根部带蓝紫），焰身里一串激波马赫环；火色随加力加大从橙变到白黄，再慢慢起伏
        const Lb = D2 * (1.8 + 4.6 * g) * fk, hu = .5 + .5 * Math.sin(S.t * 4.3 + id + j);
        cone(0, Lb, rf * 1.9, rf * 1.1, [1, lerp(.32, .42, g), lerp(.12, .2, g), .3 * g], [1, .22, .1, 0], 3);   // 外焰
        cone(0, Lb * .85, rf * 1.3, rf * .7, [1, lerp(.55, .72, g) - .06 * hu, lerp(.22, .4, g), .38 * g], [1, .42, .2, 0], 3);   // 焰身
        cone(0, D2 * (.8 + .5 * g), rf * .95, rf * .45, [lerp(1, .86, g), lerp(.8, .92, g), lerp(.55, 1, g), .7 * g], [1, .85, .65, .1 * g], 2);   // 白芯
        v3fSpark(out, C, F(rf * .15), rf * 1.25, [.55, .45, 1, .28 * g]);   // 根部蓝紫
        for (let i = 0; i < 5; i++) {   // 激波马赫环：喷口后约一个直径起、间隔约 1.2 个直径，越往后越暗、越偏橙粉
          const u = D2 * (1 + 1.2 * i) * (1 + .03 * Math.sin(S.t * 23 + i + id)), a = .5 * sm01((g - .2 - i * .12) / .3) * (1 - i * .17) * fk;
          if (a < .02 || u > Lb * .85) continue;
          const cd = [[1, .93, .82], [1, .82, .66], [1, .7, .58], [1, .64, .56], [1, .6, .55]][i], w = rf * (.8 - .06 * i);
          cone(u - rf * .7, u, w * .3, w, [...cd, 0], [...cd, a], 2);
          cone(u, u + rf * .5, w, w * .3, [...cd, a], [...cd, 0], 2);
        }
      }
      v3fSpark(out, C, F(rf * .8), rf * (2.6 + 1.6 * g) + .3, [1, lerp(.5, .6, g), lerp(.2, .3, g), (.13 + .15 * g) * Math.min(1, ab * 3)]);   // 映亮周围
    }
  }
}

// ———————————————— 甲板车辆（只是画面）：挂弹车、弹药拖车、牵引车 ————————————————
//   挂弹车、牵引车用 Sketchfab 上的模型（v3x.js 的 loader、tug，CC-BY），还没加载完时画代码建的；车辆按米画（航母是 1 比 1）
//   每个停着飞机的机位内侧停一辆挂弹车，旁边一辆弹药拖车（两枚霹雳-15）。飞机着舰停好后整备 45 秒（carrier.js 的 rearm）：
//   挂弹车托着导弹开到飞机侧面，举升、把导弹送进弹舱，再倒回原位，拖车上再取一枚放上托架
//   着舰后的飞机滑到机位前：牵引车从内侧开过来，用拖杆挂上前起落架；原地转向、倒进机位都是它推着，停好后脱钩开走
const V3D_TUG = new Map();
const V3D_LOAD = { cradle: [1.75, .55], bayZ: 1.15 };   // 托架（挂弹车坐标：离车中心前方、离甲板高）、弹舱口离甲板高
function v3dVeh(key, fb, x, y, z, a) {
  const X = typeof v3xMesh === 'function' ? v3xMesh(key) : null;
  v3mAdd(X ? 'x:' + key : 'cvsvc:' + key, X ? () => X : fb, x, y, z, a, 1, 3);
}
function v3dDeckVeh(cv, C, live, wing, top, h, at) {
  if (typeof cvPark !== 'function' || typeof AIR_REARM !== 'number') return;
  const msl = typeof v3gMsl === 'function', K = .86;   // 导弹（用户给的模型，js/v3g.js）跟飞机同一比例
  // 挂弹车：每个有飞机的机位一辆
  for (const [id, j] of cvPark(cv, wing)) {
    const w = wing.find(o => o.id === id), sl = C.slots[j];
    if (!w || !sl) continue;
    const a = sl[2], ca = Math.cos(a), sa = Math.sin(a), lat = ca * sl[1] < 0 ? [-sa, ca] : [sa, -ca], la = Math.atan2(-lat[1], -lat[0]);   // lat：朝甲板内侧
    const key = typeof airSilKey === 'function' ? airSilKey(w.type, w.v) : 'j35', D = typeof AIRD === 'object' && AIRD[key], sz = (typeof airMdl === 'function' && airMdl(w.type, w.v).size) || 15;
    const bx = D && D.bay ? (D.bay[0] + D.bay[1]) / 2 * sz / 21 : 0, B = [sl[0] + ca * bx, sl[1] + sa * bx];   // 弹舱中点
    const r = w.state === 'rearm' ? 1 - clamp(w.rearmT / AIR_REARM, 0, 1) : 1, d0 = 9.5, d1 = 3.6;
    const dl = r < .1 ? d0 : r < .3 ? lerp(d0, d1, sm01((r - .1) / .2)) : r < .58 ? d1 : r < .78 ? lerp(d1, d0, sm01((r - .58) / .2)) : d0;
    const Lu = B[0] + lat[0] * dl, Lv = B[1] + lat[1] * dl, [lx, ly] = at(Lu, Lv);
    v3dVeh('loader', v3mDeckCart, lx, ly, top + .02, h + la);
    // 弹药拖车：挂弹车原位旁边、顺着飞机方向
    const Tu = B[0] + lat[0] * (d0 + .3) + ca * 4.6, Tv = B[1] + lat[1] * (d0 + .3) + sa * 4.6, [tx, ty] = at(Tu, Tv);
    v3mAdd('cvsvc:cart', v3mDeckCart, tx, ty, top + .02, h + a, 1, 3);
    if (msl) for (const o of [-.45, .45]) { const [mx, my] = at(Tu - sa * o, Tv + ca * o); v3gMsl('pl15', mx, my, top + 1.1, h + a, K, 0); }
    // 托架上的导弹：开过去时托着，举升送进弹舱（r .3–.5），之后托架空着，倒回原位后再从拖车上取一枚
    if (msl && !(r >= .5 && r < .8)) {
      const q = r >= .3 && r < .5 ? sm01((r - .3) / .2) : 0, cr = V3D_LOAD.cradle, reach = lerp(dl - cr[0], 0, q);
      const [mx, my] = at(B[0] + lat[0] * reach, B[1] + lat[1] * reach);
      v3gMsl('pl15', mx, my, top + lerp(cr[1], V3D_LOAD.bayZ, q), h + a, K, 0);
    }
  }
  // 牵引车：着舰后滑到机位前、原地转向、倒进机位
  const seen = new Set();
  for (const p of live) {
    if (p.phase !== 'trap' || !Array.isArray(p.path) || !p.path.length || p.lu == null) continue;
    const s0 = p.path[0], tow = s0[0] === 'P' || s0[0] === 'R', near = !tow && p.path[1] && p.path[1][0] === 'P';
    if (!tow && !near) continue;
    const kk = v3dK(p), nose = v3dNose(v3dKey(p), kk), c = Math.cos(p.lh), sn = Math.sin(p.lh);
    let u = p.lu + c * (nose + 2.66), v = p.lv + sn * (nose + 2.66), a = p.lh;   // 拖杆一头挂在前起落架上（牵引车模型的拖杆端在车后 2.66 米）
    if (near) {   // 还在往机位前滑：牵引车从内侧开过来，飞机停下时正好挂上
      const f = sm01(1 - clamp(Math.hypot(s0[0] - p.lu, s0[1] - p.lv) / 25, 0, 1)), q = (p.lv > 0) === (c > 0) ? [sn, -c] : [-sn, c];   // q：朝甲板内侧
      const a0 = Math.atan2(-q[1], -q[0]);
      u = lerp(u + q[0] * 10, u, f); v = lerp(v + q[1] * 10, v, f); a = a0 + airAng(p.lh - a0) * sm01((f - .6) / .4);
    }
    V3D_TUG.set(p.id, { u, v, a, t: S.t, cv }); seen.add(p.id);
    const [x, y] = at(u, v);
    v3dVeh('tug', v3mDeckTractor, x, y, top + .02, h + a);
  }
  for (const [id, T] of V3D_TUG) {   // 飞机停好了：牵引车脱钩，往前开走（3 秒）
    if (seen.has(id) || T.cv !== cv) continue;
    const age = S.t - T.t;
    if (age > 3 || age < 0) { V3D_TUG.delete(id); continue; }
    const a = T.a + age * .35, dd = 2.5 * age * age / 2 + age, [x, y] = at(T.u + Math.cos(a) * dd, T.v + Math.sin(a) * dd);
    v3dVeh('tug', v3mDeckTractor, x, y, top + .02, h + a);
  }
}

// v3fx.js 每帧调用：本文件各部分的发光与烟
function v3dFx(out, C, inB, seen) {
  v3dCatFx(out, C, inB);
}
