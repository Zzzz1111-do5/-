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
// 机身仰角跟着画面上的实际航迹走（爬升抬头、俯冲低头、平飞放平）：每帧按高度变化与水平位移算航迹角，平滑约 1/3 秒；
//   刚离舰：抬头离舰的姿态（v3dLaunch）兜底，速度还低的头几秒迎角大一点。o 飞机、sd 1 = 敌方、z 画面高度、L = v3dLaunch(o)
const V3D_PT = new Map();
function v3dPitch(o, sd, z, L) {
  const key = (sd ? 'e' : 'p') + o.id;
  let P = V3D_PT.get(key);
  if (!P || P.S !== S || S.t < P.t) { P = { x: o.x, y: o.y, z, t: S.t, g: 0, pt: 0, S }; V3D_PT.set(key, P); }
  const dt = S.t - P.t;
  if (dt > 1e-4) {
    const dh = Math.hypot(o.x - P.x, o.y - P.y), g = clamp(Math.atan2(z - P.z, Math.max(dh, .3)), -.6, .5);
    P.g += (g - P.g) * Math.min(1, dt * 3); P.x = o.x; P.y = o.y; P.z = z; P.t = S.t;
  }
  if (V3D_PT.size > 400) for (const [k, v] of V3D_PT) if (v.S !== S || S.t - v.t > 5) V3D_PT.delete(k);
  const u = o.lT != null ? S.t - o.lT : -1, aoa = u >= 0 && u < 8 ? .07 * sm01(u / .4) * (1 - sm01((u - 3) / 4)) : 0;
  P.pt = Math.max(L ? L.pitch : -9, P.g + aoa);
  return P.pt;
}
// v3fx.js：这一帧算好的仰角（加力尾焰的方向）
const v3dPitchOf = (o, sd) => { const P = V3D_PT.get((sd ? 'e' : 'p') + o.id); return P && P.S === S ? P.pt : 0; };

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
  const msl = typeof v3MslInst === 'function' ? v3MslInst('st3:x:', 'pl15') : null, K = .86;   // 导弹跟飞机同一比例
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
    if (msl) for (const o of [-.45, .45]) { const [mx, my] = at(Tu - sa * o, Tv + ca * o); v3mAdd(msl[0], msl[1], mx, my, top + 1.1, h + a, K, 0); }
    // 托架上的导弹：开过去时托着，举升送进弹舱（r .3–.5），之后托架空着，倒回原位后再从拖车上取一枚
    if (msl && !(r >= .5 && r < .8)) {
      const q = r >= .3 && r < .5 ? sm01((r - .3) / .2) : 0, cr = V3D_LOAD.cradle, reach = lerp(dl - cr[0], 0, q);
      const [mx, my] = at(B[0] + lat[0] * reach, B[1] + lat[1] * reach);
      v3mAdd(msl[0], msl[1], mx, my, top + lerp(cr[1], V3D_LOAD.bayZ, q), h + a, K, 0);
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
