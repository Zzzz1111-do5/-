'use strict';
// 3D 细节（只是画面，不进推演）：电磁弹射、弹舱弹射发射导弹、伞降——
//   v3units.js 画航母、飞机、降落伞时调这里加模型实例（v3dCatUnits / v3dLaunch），v3fx.js 调 v3dFx 加发光与烟
// 机型坐标（airmdl.js AIRD）：x 机头、y 右翼、z 向上，单位是机型单位（乘 k = 画面尺寸 / 21 成世界单位）；
//   换到世界（朝向 a）：x' = x cos a − y sin a、y' = x sin a + y cos a（与 v3units.js 的实例着色器一致）

const v3dKey = p => typeof airSilKey === 'function' ? airSilKey(p.kind, p.v) : 'j35';
const v3dK = p => ((typeof airMdl === 'function' && airMdl(p.kind, p.v).size) || 15) / 21;

// ———————————————— 电磁弹射（carrier.js CVG.cats、cvdeck.js 的 'cat' / 'roll'）————————————————
//   弹射滑块：从甲板滑槽里露出一截，挂杆时卡在前起落架的弹射杆上；弹射时随飞机冲到行程末端，刹停，约 1.5 秒退回起点
//   直线电机：挂杆后整条滑轨微微发光（储能），越接近弹射越亮；弹射时滑块所在的一段定子最亮、身后一段渐暗、前面一小段刚通电
//   喷气机挂杆最后一秒多与弹射时开加力，尾焰打在升起的偏流板上（板面映亮）；离舰后先略微下沉、抬头爬升，约 1 秒后收起落架
const V3D_NOSE0 = 6;   // 没有飞机时滑块停在起点前 6 米（前起落架大致的位置）
const V3D_JET = { j35: 1, j20: 1, j15: 1, j15t: 1, j36: 1, j50: 1, f35: 1, f22: 1, f35b: 1 };   // 有加力的喷气机
// 前起落架离机身中心多远（世界单位，与 v3mAir 的起落架同一算法）
function v3dNose(key, k) {
  const D = typeof AIRD === 'object' && AIRD[key];
  if (!D) return V3D_NOSE0;
  const xf = D.body ? D.body[0][0] : 10;
  return (D.cp ? Math.min(D.cp[1] + .6, xf - 1.6) : xf * .6) * k;
}
// 弹射器 k 此刻：滑块位置 s（沿弹射器离起点多远）、阶段 m、挂着的飞机 p、挂杆进度 q、加力程度 burn
function v3dCat(cv, k, live) {
  const C = cvCat(k), p = live.find(o => o.cat === k && ((o.phase === 'cat' && (o.dk === 'line' || o.dk === 'hook')) || o.phase === 'roll'));
  if (p) {
    const nose = v3dNose(v3dKey(p), v3dK(p));
    if (p.phase === 'roll') return { s: (p.cs || 0) + nose, m: 'roll', p, q: 1, burn: 1 };
    if (p.dk === 'hook') return { s: nose, m: 'hook', p, q: (p.dkT || 0) / CVD.hook, burn: sm01(((p.dkT || 0) - (CVD.hook - 1.25)) / .35) };
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
// 喷气机加力：每个喷口（分件数据 noz，左右对称）一束橙白的火舌 + 光晕，长度抖动；o = 位置 (x, y, z 机身中心)、朝向 h、俯仰 pt
function v3dBurner(out, C, p, a, o) {
  const key = v3dKey(p), D = typeof AIRD === 'object' && AIRD[key];
  if (!D || !D.noz || !V3D_JET[key] || a <= .02) return;
  const k = v3dK(p), ch = Math.cos(o.h), sh = Math.sin(o.h), cp = Math.cos(o.pt || 0), sp = Math.sin(o.pt || 0);
  const Wp = (x, y, z) => { const xx = x * cp - z * sp, zz = x * sp + z * cp; return v3fP(o.x + (xx * ch - y * sh) * k, o.y + (xx * sh + y * ch) * k, o.z + zz * k); };
  for (const nz of D.noz) for (const sg of nz[1] ? [1, -1] : [1]) {
    const r = nz[4] === 'flat' ? nz[2] : nz[2], L = (4.6 + Math.sin(S.t * 31 + p.id + sg) * .7) * (.55 + .45 * a), y = nz[1] * sg;
    v3fRib(out, C.E, Wp(nz[0], y, 0), Wp(nz[0] - L, y, 0), (r * 2.1 + .3) * k, [1, .95, .8, .95 * a], [1, .45, .1, 0]);
    v3fRib(out, C.E, Wp(nz[0], y, 0), Wp(nz[0] - L * .45, y, 0), r * 1.2 * k, [.75, .85, 1, .8 * a], [1, .8, .5, 0]);   // 内焰（发白、带一点蓝）
    v3fSpark(out, C, Wp(nz[0] - .4, y, 0), (r * 3.2 + 1) * k, [1, .6, .2, .5 * a]);
  }
}
// v3fx.js：滑轨通电的光带、滑块亮点、挂杆末段与弹射时的加力、偏流板被尾焰映亮
function v3dCatFx(out, C, inB) {
  if (typeof cvAll !== 'function' || typeof CVG !== 'object' || typeof cvCat !== 'function') return;
  const E = C.E, zd = -2.6 + CVG.zd + .12;
  for (const cv of cvAll()) {
    if (!(cv.hp > 0) || cv.x < -999 || !inB(cv.x, cv.y, 220) || /075/.test(cv.name || '')) continue;
    const home = cvHome(cv), live = (S.planes || []).filter(p => !p.dead && cvHome(p) === home && !p.land && (p.phase === 'cat' || p.phase === 'roll'));
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
        const p = st.p, kk = v3dK(p);
        v3dBurner(out, C, p, st.burn, { x: p.x, y: p.y, z: -2.6 + CVG.zd + (V3_GEAR + V3_AIRZ) * kk, h: p.heading || 0 });
        const wash = st.burn * (st.m === 'roll' ? Math.max(0, 1 - (p.cs || 0) / 45) : 1), [ju, jv] = [C0.u - Math.cos(C0.a) * 9.5, C0.v - Math.sin(C0.a) * 9.5], [jx, jy] = cvW(ju, jv, cv);
        if (wash > .02) v3fSpark(out, C, v3fP(jx, jy, zd + 2.2), 6, [1, .5, .18, .22 * wash * (.8 + .2 * Math.sin(S.t * 43 + k))]);   // 偏流板被尾焰映亮
      }
    }
  }
}
// v3units.js plane()：刚离舰的舰载机——先略微下沉、抬头爬升，约 1 秒后收起落架（cvdeck.js 记的离舰时刻 p.lT）
function v3dLaunch(p) {
  const u = p.lT != null && p.phase === 'out' ? S.t - p.lT : -1;
  if (!(u >= 0 && u < 2.6)) return null;
  return { gear: u < 1.05, pitch: .2 * sm01(u / .45) * (1 - sm01((u - 1.4) / 1.2)), dz: -1.3 * Math.sin(Math.PI * clamp(u / .9, 0, 1)) };
}

// ———————————————— 弹舱弹射发射（airmdl.js 的离机记录 AIRV、airRelPos / airRelZ）————————————————
//   内埋弹舱：舱门打开后，弹射臂（前后两根撑杆 + 托架）把弹从舱顶往下推出舱外，松开后收回舱里；点火的闪光、尾焰、空中那团白烟在 v3fx.js
// 弹射臂（机型单位：舱顶在 z = 0，伸出 e 时托架到 z = −e）
function v3mdEjArm(e) {
  const M = mbNew(), z1 = -e;
  for (const x of [-.9, .9]) mbTube(M, [x, 0, 0], [x * .8, 0, z1 + .15], .15, .12, 6, .8);
  mbBox(M, -1.2, 1.2, -.2, .2, z1, z1 + .2, .75);
  return M;
}
// v3units.js：主弹舱离机的弹，弹射臂伸出（推弹）→ 松开 → 收回，按四档取模型
function v3dEjArm(P, m) {
  const A = AIR_REL, ex = clamp((P.u - A.open) / A.ej, 0, 1) * (1 - clamp((P.u - A.open - A.ej - .08) / .22, 0, 1)), st = Math.round(ex * 4);
  if (!st) return;
  const o = P.o, h = o.heading || 0, c = Math.cos(h), sn = Math.sin(h), x = o.x + (P.r.ox * c - P.r.oy * sn) * P.sc, y = o.y + (P.r.ox * sn + P.r.oy * c) * P.sc;
  v3mAdd('ejarm:' + st, () => v3mdEjArm(st / 4), x, y, v3AirZ(o) - .55 * P.sc, h, P.sc, m.side === 'e' ? 1 : 0, o.bank || 0);
}

// v3fx.js 每帧调用：本文件各部分的发光与烟
function v3dFx(out, C, inB, seen) {
  v3dCatFx(out, C, inB);
}
