'use strict';
// 亲自驾驶战斗机的光电吊舱、地面目标锁定、热诱弹、武器栏、音障云（v3pilot.js / fpwpn.js 调用）：
//   光电吊舱（Y 进出）：从机腹吊舱看出去。真实变焦——投影的视场角从 40° 缩到 0.6°（滚轮连续，U 按档：宽 40° / 中 12° / 窄 4° / 超窄 1.2°），
//     整幅画面按这个视场角重新渲染，不是把图放大；模型的细节档也按真实视场角挑（v3g.js），远处的车放大了照样是精细模型。
//     画面：红外白热 / 红外黑热 / 可见光电视（N 切换；红外在 v3post.js 后期里换算：发动机、人、火、爆炸亮，草木、水面、天空冷），热的东西（车辆发动机舱、人）另外点亮（ftFx）。
//     视线：锁在机头正前方（用户：光电视角锁向前的视角），飞机往哪飞就看哪；鼠标在这个基础上偏转视线（相对机头的方位、俯仰偏角 T.oa / T.oe）；锁了目标就跟着目标走；
//     吊舱在机腹，看不到机身上方和正后方（画面提示「遮挡」）。
//     开吊舱时鼠标用来转视线，飞机按进吊舱前的准星方向直飞（键盘照样能飞）。
//   锁定（吊舱里按 R / 右键单击，再按解锁；吊舱外 R 是平显里换目标）：吊舱里锁十字附近的目标（车辆、阵地、装甲车、敌舰、步兵；没有就锁那一点的地面坐标）；平常的视角锁视线方向附近看得见的地面目标。
//     对地武器（飞腾-8、KD-88、雷电-10）开火时先打锁定的目标；锁定的目标在画面上画红色菱形框（距离、名称）。
//   热诱弹（Z）：一次一组 4 发，从两侧向后下方弹出，烧约 4 秒；飞向本机的红外制导导弹（单兵防空、弹炮防空车、近距空空弹）3 公里内六成被骗走。
//     载弹量（公开资料多是估计，按同级战斗机常见的投放器容量）：歼-20、歼-50 48 发，歼-35 32 发，歼-15T、歼-16D 60 发。
//   武器栏（画面下方）：每型弹的按键、名称、剩余枚数（打光了变暗、选中的高亮），热诱弹剩余，吊舱、锁定、开火的按键。
//   音障云：跨音速（马赫 0.93–1.03）时机身后半段套着一圈白色的蒸汽锥；越过 1 马赫那一下一圈白雾往外炸开、一声闷响（音爆）。
const FT = { fovs: [40, 12, 4, 1.2].map(d => d * Math.PI / 180), fmin: .6 * Math.PI / 180, fmax: 40 * Math.PI / 180, flN: { j20: 48, j50: 48, j35: 32, j35s: 32, j15t: 60, j16d: 60 } };
const ftMode = { wh: '红外 白热', bh: '红外 黑热', tv: '电视' };

// —— 吊舱 ——
function ftOn() {
  const o = V3FP.o;
  if (!o || !o.fl || V3FP.k !== 'air') return;   // 飞控还没接上（刚接手的头一步）
  if (V3FP.mv != null) V3FP.mBig = false;   // 导弹全屏视角缩回小屏（小屏照样跟着弹）
  const E = ftEye(o), B = fpBody(o), cf = V3FP.camF || B.f;
  let f = v3Norm([cf[0], cf[1], Math.min(cf[2], -.25)]);   // 进吊舱时看视线前方的地面（视线朝天就压到下视 15°）
  let p = ftRay(E, f);
  if (!p) { f = v3Norm([B.f[0], B.f[1], -.45]); p = ftRay(E, f) || [E[0] + f[0] * 3000, E[1] + f[1] * 3000, 0]; }
  V3FP.tg = { prev: V3FP.vw === 'tgp' ? 'chase' : V3FP.vw, fov: FT.fovs[0], mode: (V3FP.tg && V3FP.tg.mode) || 'wh', gx: p[0], gy: -p[1], gz: p[2], dist: 3000, mask: false, oa: 0, oe: 0 };
  V3FP.vw = 'tgp'; V3FP.look = [0, 0];
}
function ftOff() { const T = V3FP.tg; V3FP.vw = T && T.prev && T.prev !== 'tgp' ? T.prev : 'chase'; }
// 吊舱在机腹下 1.6 米（GL 坐标：东、北、上）
function ftEye(o) { const rs = fpRS(o); if (!rs) return null; const B = fpBody(o); return [rs.x - B.u[0] * 1.6, -rs.y - B.u[1] * 1.6, rs.z - B.u[2] * 1.6]; }
// 吊舱现在盯着的点（GL）：锁了目标跟目标，否则是稳定住的地面点
function ftPt() {
  const L = ftLockPos();
  if (L) return [L.x, -L.y, L.z];
  const T = V3FP.tg, o = V3FP.o, E = T && o && ftEye(o);
  if (!T) return null;
  if (!E) return [T.gx, -T.gy, T.gz];
  // 机头正前方（加上鼠标偏的角）：视线打到的地面点；看着天、地平线时取前方 20 公里的点（同一帧里只算一次）
  const k = E.map(v => v.toFixed(1)).join() + ',' + T.oa.toFixed(4) + ',' + T.oe.toFixed(4);
  if (T.fk === k && T.fp) return T.fp;
  const B = fpBody(o);
  let f = fpRot(B.f, [0, 0, 1], T.oa);
  f = fpRot(f, v3Norm(v3Cross(f, [0, 0, 1])), T.oe);
  const p = ftRay(E, f, 20000) || [E[0] + f[0] * 20000, E[1] + f[1] * 20000, E[2] + f[2] * 20000];
  T.gx = p[0]; T.gy = -p[1]; T.gz = p[2]; T.fk = k; T.fp = p;
  return p;
}
// 视线和地面的交点（GL）：先粗步进、再二分；朝天的视线没有交点
function ftRay(E, f, max = 45000) {
  if (!(f[2] < -.003)) return null;
  const above = t => { const x = E[0] + f[0] * t, y = -(E[1] + f[1] * t); return E[2] + f[2] * t - Math.max(fwGz(x, y), -2.6); };
  let t0 = 0, t = 25;
  while (t < max && above(t) > 0) { t0 = t; t += Math.max(20, t * .03); }
  if (t >= max) return null;
  for (let i = 0; i < 16; i++) { const m = (t0 + t) / 2; if (above(m) > 0) t0 = m; else t = m; }
  const x = E[0] + f[0] * t, y = E[1] + f[1] * t;
  return [x, y, Math.max(fwGz(x, -y), -2.6)];
}
// 鼠标转动视线（按视场角换算：视场越窄转得越细），转了就从锁定改成跟踪新的地面点
function ftSlew(dx, dy) {
  const T = V3FP.tg;
  if (!T) return;
  const k = T.fov / Math.max(240, CAM.vh) * .85;
  T.oa = clamp(T.oa - dx * k, -2.6, 2.6); T.oe = clamp(T.oe - dy * k, -1.45, .35);   // 相对机头的偏角：吊舱万向架的转动范围（看不到的方向画面提示遮挡）
  if (V3FP.gl) V3FP.gl = null;
}
function ftZoom(dy) { const T = V3FP.tg; if (T) T.fov = clamp(T.fov * Math.exp(dy * .0016), FT.fmin, FT.fmax); }
function ftZoomStep() { const T = V3FP.tg; if (!T) return; const i = FT.fovs.findIndex(v => v < T.fov * .98); T.fov = i < 0 ? FT.fovs[0] : FT.fovs[i]; }
function ftModeNext() { const T = V3FP.tg; if (T) T.mode = T.mode === 'wh' ? 'bh' : T.mode === 'bh' ? 'tv' : 'wh'; }
// 后期（v3post.js）用的光电画面：0 不换算，1 白热，2 黑热，3 电视黑白——吊舱按选的模式（吊舱的电视是彩色的，0）；
//   导弹导引头画面（v3pilot.js：小屏那一遍 V3FP.pipEO，全屏导弹视角）按导引头：红外白热、电视黑白
function ftEO() {
  if (!V3FP.on) return 0;
  if (V3FP.pipEO != null) return V3FP.pipEO;
  if (V3FP.mv != null && V3FP.mBig && typeof fpMslEO === 'function') return fpMslEO();
  const T = V3FP.tg;
  return V3FP.vw === 'tgp' && T ? (T.mode === 'wh' ? 1 : T.mode === 'bh' ? 2 : 0) : 0;
}
// 红外（白热 / 黑热）：v3g.js 按温度提亮模型、ftFx 点亮发动机舱
function ftIR() { const e = ftEO(); return e === 1 || e === 2 ? e : 0; }
// 红外里每型模型有多热（v3g.js 画这一型时给 uIRh，0–1）：人体温比地面高最亮；车辆、直升机的发动机、履带、晒热的车体次之；
//   飞机机体在空中被气流吹凉一些（尾喷口另有尾焰的光）；导弹发动机最亮；炮、枪这些铁家伙只比地面稍热
const FT_HOT = { man: .72, veh: .5, heli: .55, air: .42, msl: .9, gun: .3, other: .25 };
function ftHeat(key) {
  const C = FT.hk || (FT.hk = new Map());
  let h = C.get(key);
  if (h != null) return h;
  const has = (o, k) => typeof o === 'object' && Object.values(o).includes(k);
  h = /^army@/.test(key) ? FT_HOT.man
    : ['z10w', 'z21', 'ah64', 'uh60', 'ch47', 'sh60b'].includes(key) ? FT_HOT.heli
    : has(typeof V3G_AIR === 'object' ? V3G_AIR : null, key) ? FT_HOT.air
    : has(typeof V3G_MSL === 'object' ? V3G_MSL : null, key) || key === 'javm' ? FT_HOT.msl
    : has(typeof V3G_VEH === 'object' ? V3G_VEH : null, key) || ['jltv', 'm270', 'matv', 'hmmwv', 'lav25'].includes(key) ? FT_HOT.veh
    : ['m777', 'm224', 'm4a1', 'm249', 'm110', 'm240', 'javl', 'stinger', 'm2hb'].includes(key) ? FT_HOT.gun : FT_HOT.other;
  C.set(key, h);
  return h;
}
// 吊舱的镜头：从吊舱看着那一点，上方取世界的上（地平线不歪）；视场角 fpFov 用吊舱的
function ftCam() {
  const o = V3FP.o, T = V3FP.tg, G = ftPt();
  const E = o && T && G && ftEye(o);
  if (!E) return null;
  const d = [G[0] - E[0], G[1] - E[1], G[2] - E[2]], dist = Math.hypot(d[0], d[1], d[2]) || 1, f = [d[0] / dist, d[1] / dist, d[2] / dist], B = fpBody(o);
  T.mask = v3Dot(f, B.u) > .35 || v3Dot(f, B.f) < -.8;   // 万向架：机腹下的吊舱看不到机身上方、正后方
  T.dist = dist;
  const ref = Math.abs(f[2]) > .995 ? B.f : [0, 0, 1], r = v3Norm(v3Cross(f, ref)), u = v3Cross(r, f), z = [-f[0], -f[1], -f[2]], x = v3Norm(v3Cross(u, z)), y = v3Cross(z, x);
  V3FP.camF = f;
  return fpProj(E, x, y, z, Math.max(dist * 1.15, 2600), clamp(dist * .002, .5, 30));
}
// 画面中心（俯视贴图、细节档按它）：吊舱盯着的那一点，按看得见的地面宽度定缩放
function ftCenter() {
  const T = V3FP.tg, G = ftPt();
  if (!T || !G) return;
  CAM.x = clamp(G[0], 0, W); CAM.y = clamp(-G[1], 0, H);
  CAM.z = CAM.fit * clamp(1800 / Math.max(40, T.dist * T.fov * 1.4), 1.2, 14);
}

// —— 地面目标锁定 ——
// all：吊舱（传感器自己看得见，不管本方视野）；否则只要本方看得见的
function ftGnd(all) {
  if (!all) return fpFoes(false).filter(c => c.k !== 'air');
  const out = [], nm = e => (typeof KIND_NAME === 'object' && KIND_NAME[e.kind]) || '阵地';
  for (const e of S.enemies) if (!e.dead && e.kind !== 'airfield') out.push({ o: e, k: 'gnd', t: 'enemy', x: e.x, y: e.y, nm: nm(e) });
  for (const v of S.veh || []) if (v.side === 'e' && !v.dead) out.push({ o: v, k: 'gnd', t: 'veh', x: v.x, y: v.y, nm: typeof vehModel === 'function' ? vehModel(v) : '装甲车辆' });
  for (const a of S.armor || []) if (!a.dead) out.push({ o: a, k: 'gnd', t: 'armor', x: a.x, y: a.y, nm: '装甲车' });
  for (const e of S.eships || []) if (!e.dead) out.push({ o: e, k: 'sea', t: 'eship', x: e.x, y: e.y, nm: (typeof NV_CLS === 'object' && NV_CLS[e.cls] && NV_CLS[e.cls].nm) || '敌舰' });
  for (const q of S.teams) if (q.side === 'e' && q.men.length && !q.ride) out.push({ o: q, k: 'gnd', t: 'team', x: q.x, y: q.y, nm: '步兵' });
  return out;
}
function ftLock() {
  const o = V3FP.o;
  if (!o || V3FP.k !== 'air') return;
  if (V3FP.gl) { V3FP.gl = null; if (typeof fwMsg === 'function') fwMsg('解除锁定'); return; }
  const tgp = V3FP.vw === 'tgp' && V3FP.tg;
  let P;
  if (tgp) P = { x: V3FP.tg.gx, y: V3FP.tg.gy, z: V3FP.tg.gz };
  else {
    const C = V3.cam, p = C && ftRay(C.E, V3FP.camF || fpBody(o).f);
    if (!p) { if (typeof fwMsg === 'function') fwMsg('视线里没有地面，压低机头或开吊舱（Y）再锁'); return; }
    P = { x: p[0], y: -p[1], z: p[2] };
  }
  const R = tgp ? Math.max(15, V3FP.tg.dist * V3FP.tg.fov * .07) : Math.max(60, Math.hypot(P.x - fpPose().x, P.y - fpPose().y) * .035);   // 吊舱：十字附近一小片（视场越窄越准）
  let best = null, bd = R;
  for (const c of ftGnd(!!tgp)) { const d = Math.hypot(c.x - P.x, c.y - P.y); if (d < bd) { bd = d; best = c; } }
  V3FP.gl = best ? { o: best.o, t: best.t, nm: best.nm, sea: best.k === 'sea' } : { pt: P, nm: '地面坐标点' };
  if (typeof fwMsg === 'function') fwMsg(best ? `锁定：${best.nm}` : '锁定地面坐标点');
}
// 锁定的目标现在在哪（游戏坐标、高度）；目标没了就解锁
function ftLockPos() {
  const G = V3FP.gl;
  if (!G) return null;
  if (G.pt) return G.pt;
  const o = G.o;
  if (!o || o.dead || (G.t === 'team' && !(o.men && o.men.length))) { V3FP.gl = null; return null; }
  return { x: o.x, y: o.y, z: G.sea ? 4 : Math.max(fwGz(o.x, o.y), -2.6) + 2 };
}
// fpwpn.js fwFire：对地武器先打锁定的目标（在射程外返回 'far'）
function ftLockTgt(o, s) {
  if (!V3FP.gl) return null;
  const T = ftLockPos();
  if (!T) return null;
  const P = fpPose(), d = Math.hypot(T.x - P.x, T.y - P.y, T.z - P.z), G = V3FP.gl;
  if (d > fwRange(o, s.W)) { fwMsg(`锁定的目标在射程外（${(d / 1000).toFixed(1)} 公里，${s.W.nm}射程 ${(fwRange(o, s.W) / 1000).toFixed(0)} 公里）`); return 'far'; }
  const obj = G.o && G.t !== 'team' ? G.o : null;
  return { o: obj, t: obj ? G.t : undefined, x: T.x, y: T.y, z: T.z, nm: G.nm, d, red: true };
}

// —— 热诱弹 ——
const ftFlareN = o => { if (o.flN == null) o.flN = FT.flN[airMdlKey(o.kind, o.v)] ?? 40; return o.flN; };
function ftFlare() {
  const o = V3FP.o;
  if (!o || !o.fl || V3FP.k !== 'air') return;
  if (S.t - (V3FP.flT ?? -9) < .7) return;   // 投放器一组一组打
  if (!(ftFlareN(o) > 0)) { fwMsg('热诱弹打光了'); return; }
  const n = Math.min(4, o.flN), rs = fpRS(o), B = fpBody(o), F = o.fl, V = [F.V[1], F.V[0], -F.V[2]], L = V3FP.flr || (V3FP.flr = []);
  o.flN -= n; V3FP.flT = S.t;
  for (let i = 0; i < n; i++) {
    const s = i % 2 ? 1 : -1, j = Math.floor(i / 2), p0 = [rs.x - B.f[0] * 5, -rs.y - B.f[1] * 5, rs.z - B.f[2] * 5 - 1];
    L.push({ p: p0, v: [0, 1, 2].map(k => V[k] * .82 + B.r[k] * s * (22 + j * 6) - B.u[k] * 14 - B.f[k] * 8), t0: S.t + j * .12, tr: [], id: Math.random() * 99 });
  }
  if (L.length > 60) L.splice(0, L.length - 60);
  if (typeof auOk === 'function' && auOk() && typeof auWhoosh === 'function') auWhoosh(.25, false, .25);
  // 来袭的红外制导弹（单兵防空、弹炮防空车、近距空空弹）：3 公里内六成被骗走（导引头追着热诱弹走，在它旁边自毁）
  let fooled = 0;
  for (const m of S.missiles || []) {
    if (m.done || m.side !== 'e' || !m.tgt || m.tgt.k !== 'plane' || m.tgt.id !== o.id) continue;
    const ir = m.src === 'manpads' || m.src === 'samv' || (m.src === 'aam' && !m.lr && Math.hypot(m.x0 - o.x, m.y0 - o.y) < 12000);
    if (ir && Math.hypot(m.x - o.x, m.y - o.y) < 3000 && Math.random() < .6) { m.tgt = null; fooled++; }
  }
  fwMsg(fooled ? `投放热诱弹，骗走 ${fooled} 枚来袭导弹（剩 ${o.flN} 发）` : `投放热诱弹（剩 ${o.flN} 发）`);
}
HOOK.step.push(dt => {
  const L = V3FP.flr;
  if (!L || !L.length) return;
  for (const f of L) {
    if (S.t < f.t0) continue;
    const k = Math.exp(-dt * .9);
    f.v[0] *= k; f.v[1] *= k; f.v[2] = f.v[2] * k - 9.8 * .55 * dt;
    for (let i = 0; i < 3; i++) f.p[i] += f.v[i] * dt;
    if (!f.tr.length || S.t - f.tr[f.tr.length - 1][3] > .08) { f.tr.push([f.p[0], f.p[1], f.p[2], S.t]); if (f.tr.length > 70) f.tr.shift(); }
  }
  V3FP.flr = L.filter(f => S.t - f.t0 < 9);
});

// —— 画面特效（v3pilot.js fpFx 调；out 发光、sm 遮挡的烟）——
function ftFx(out, sm, C) {
  const o = V3FP.o, F = o && o.fl, now = S.t;
  // 热诱弹：燃烧的镁光（亮白、一闪一闪）和拖着的白烟
  for (const f of V3FP.flr || []) {
    if (now < f.t0) continue;
    const a = now - f.t0, burn = a < 4.2;
    if (burn) { const fl = .85 + .15 * Math.sin(now * 60 + f.id); v3fSpark(out, C, f.p, 1.6 * fl, [1, .97, .85, .95]); v3fSpark(out, C, f.p, 6 * fl, [1, .78, .45, .3]); }
    for (const t of f.tr) { const ag = now - t[3], fd = clamp(1 - ag / 6, 0, 1); if (fd > 0) v3fSpark(sm, C, [t[0], t[1], t[2] + ag * .3], .7 + ag * 1.3, [.92, .92, .9, .38 * fd]); }
  }
  if (!F) return;
  const rs = fpRS(o), B = fpBody(o), P = [rs.x, -rs.y, rs.z], sz = typeof airSize3 === 'function' ? airSize3(o, 'p') : 15, k = sz / 21;
  const D = typeof AIRD === 'object' && typeof airSilKey === 'function' ? AIRD[airSilKey(o.kind, o.v)] : null, hs = (D && D.wing ? D.wing.reduce((m, q) => Math.max(m, q[1]), 0) : 7) * k;
  const V = [F.V[1], F.V[0], -F.V[2]], vl = Math.hypot(V[0], V[1], V[2]) || 1, ax = [V[0] / vl, V[1] / vl, V[2] / vl];
  const ring = (x, r, n, a, s, ph) => { for (let i = 0; i < n; i++) { const th = i / n * 6.2832 + ph, c = Math.cos(th), si = Math.sin(th);
    v3fSpark(sm, C, [P[0] + ax[0] * x + (B.r[0] * c + B.u[0] * si) * r, P[1] + ax[1] * x + (B.r[1] * c + B.u[1] * si) * r, P[2] + ax[2] * x + (B.r[2] * c + B.u[2] * si) * r], s, [.96, .97, .98, a]); } };
  // 蒸汽锥：马赫 0.93–1.03，机翼前缘往后张开的一圈白雾（前沿清楚、往后淡）
  const M = F.M || 0, vc = smooth(.93, .985, M) * smooth(1.035, 1.0, M);
  const AV = typeof v3aeroPlane === 'function' && typeof v3aK === 'function' && v3aK() > 0;   // 有三维的气动特效（v3aero.js）就不画这一圈贴片了
  if (vc > .02 && !AV) for (let i = 0; i < 6; i++) { const u = i / 5; ring(sz * (.12 - .32 * u), hs * (.35 + .75 * u), 22, .3 * vc * (1 - .6 * u) * (.85 + .15 * Math.sin(now * 13 + i)), hs * (.16 + .08 * u), i * .7 + now * 2); }
  // 音爆：刚越过 1 马赫那一下
  if ((V3FP.Mp ?? M) < 1 && M >= 1) {
    V3FP.boomT = now; V3FP.imp = Math.max(V3FP.imp || 0, .9);
    if (typeof auOk === 'function' && auOk() && typeof auBoom === 'function') auBoom(1.9, 0, .9);
  }
  V3FP.Mp = M;
  const ba = now - (V3FP.boomT ?? -99);
  if (ba >= 0 && ba < .8 && !AV) { const u = ba / .8; ring(-sz * .1 - u * sz * .6, hs * (.8 + 3.2 * u), 30, .55 * (1 - u), hs * (.25 + .4 * u), 0); }
  // 吊舱红外：车身、人按模型外形提亮（v3g.js uIRh、ftHeat）；这里再点亮最热的发动机舱、排气口（白热 / 黑热都由后期换算）
  if (ftIR()) {   // 吊舱：盯着的那一片；导弹导引头（v3pilot.js 小屏、全屏）：导引头跟踪的目标点那一片
    const T = V3FP.tg, ms = V3FP.pipEO != null || (V3FP.mBig && V3FP.mv != null), G = ms ? V3FP.mq || V3FP.mhp : ftPt();
    const R0 = ms ? Math.max(400, (V3FP.md || 1500) * (V3FP.mFov || .5) * 1.2) : Math.max(400, ((T && T.dist) || 3000) * ((T && T.fov) || .7) * 1.2);
    for (const v of S.veh || []) {
      if (!G || Math.hypot(v.x - G[0], -v.y - G[1]) > R0) continue;
      const L = typeof vehSp === 'function' ? vehSp(v).len : 12, g = v3Ht(clamp(v.x, 0, W - 1), clamp(v.y, 0, H - 1)), hd = v.heading || 0;
      const hot = v.dead ? (S.t - (v.deadT ?? 0) < 90 ? 1 : .25) : .8, ex = v.x - Math.cos(hd) * L * .32, ey = v.y - Math.sin(hd) * L * .32;
      v3fSpark(out, C, [ex, -ey, g + L * .2], L * .14, [1, 1, 1, .5 * hot]);   // 发动机舱、排气（坦克在车尾）
    }
  }
}

// —— 画面上的武器栏、吊舱的符号、锁定框（v3pilot.js v3fpOverlay 调）——
function ftOverlay(ctx) {
  const o = V3FP.o;
  if (!o || V3FP.k !== 'air') return;
  if (V3FP.vw === 'tgp' && V3FP.tg && V3FP.mv == null) ftTgpHud(ctx);
  else ftLockMark(ctx);
  if (typeof fiDraw === 'function') fiDraw(ctx);   // 机型与挂载参数面板（按 I，fpinfo.js）
}
function ftLockMark(ctx) {
  const T = ftLockPos();
  if (!T || typeof v3Proj !== 'function') return;
  const q = v3Proj(T.x, T.y, T.z);
  if (!q || q.x < -50 || q.x > CAM.vw + 50 || q.y < -50 || q.y > CAM.vh + 50) return;
  const P = fpPose(), d = Math.hypot(T.x - P.x, T.y - P.y, T.z - P.z), r = 15;
  ctx.save(); ctx.strokeStyle = FW_RED; ctx.fillStyle = FW_RED; ctx.lineWidth = 2; ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 3;
  ctx.beginPath(); ctx.moveTo(q.x, q.y - r); ctx.lineTo(q.x + r, q.y); ctx.lineTo(q.x, q.y + r); ctx.lineTo(q.x - r, q.y); ctx.closePath(); ctx.stroke();
  ctx.font = '12px "IBM Plex Mono", "Noto Sans SC", monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(`${V3FP.gl.nm} ${(d / 1000).toFixed(1)} km`, q.x + r + 6, q.y);
  ctx.restore();
}
function ftTgpHud(ctx) {
  const T = V3FP.tg, w = CAM.vw, h = CAM.vh, cx = w / 2, cy = h / 2, P = fpPose(), G = ftPt(), INK = '#f4f4ee', EDGE = 'rgba(0,0,0,.8)';
  // 符号都描一圈暗边：黑热（背景大片发白）、白热（背景发黑）、电视里都看得清
  const line = (path, col = INK, lw = 1.5) => { ctx.beginPath(); path(); ctx.strokeStyle = EDGE; ctx.lineWidth = lw + 2.5; ctx.stroke(); ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.stroke(); };
  const text = (t, x, y, col = INK) => { ctx.lineWidth = 3; ctx.strokeStyle = EDGE; ctx.strokeText(t, x, y); ctx.fillStyle = col; ctx.fillText(t, x, y); };
  ctx.save(); ctx.lineJoin = 'round';
  // 十字（中间留空）与四角取景框
  const g = 14, L = Math.min(w, h) * .09, bx = w * .3, by = h * .3, c = Math.min(w, h) * .05;
  line(() => {
    ctx.moveTo(cx - g - L, cy); ctx.lineTo(cx - g, cy); ctx.moveTo(cx + g, cy); ctx.lineTo(cx + g + L, cy);
    ctx.moveTo(cx, cy - g - L); ctx.lineTo(cx, cy - g); ctx.moveTo(cx, cy + g); ctx.lineTo(cx, cy + g + L);
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { ctx.moveTo(cx + sx * bx, cy + sy * (by - c)); ctx.lineTo(cx + sx * bx, cy + sy * by); ctx.lineTo(cx + sx * (bx - c), cy + sy * by); }
  });
  // 锁定的目标：跟踪框
  const LP = ftLockPos();
  if (LP) { const q = v3Proj(LP.x, LP.y, LP.z); if (q) line(() => ctx.rect(q.x - 18, q.y - 18, 36, 36), FW_RED, 2); }
  ctx.font = '13px "IBM Plex Mono", "Noto Sans SC", monospace'; ctx.textBaseline = 'top';
  const fovD = T.fov * 180 / Math.PI, fv = fovD > 20 ? '宽视场' : fovD > 6 ? '中视场' : fovD > 2 ? '窄视场' : '超窄视场';
  ctx.textAlign = 'left';
  text(`光电吊舱 · ${ftMode[T.mode]}`, 18, 16);
  text(`${fv} ${fovD.toFixed(1)}° · ×${(40 / fovD).toFixed(1)}`, 18, 36);
  ctx.textAlign = 'right';
  const dist = G ? Math.hypot(G[0] - P.x, -G[1] - P.y, G[2] - P.z) : 0;
  text(`斜距 ${(dist / 1000).toFixed(2)} km`, w - 18, 16);
  if (G) text(`${typeof gridRef === 'function' ? gridRef(clamp(G[0], 0, W - 1), clamp(-G[1], 0, H - 1)) : ''} · 高 ${Math.round(G[2])} m`, w - 18, 36);
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  text(LP ? `跟踪：${V3FP.gl.nm}` : '地面点稳定（R 锁定）', cx, h - 64);
  if (T.mask) { ctx.font = '15px "IBM Plex Mono", "Noto Sans SC", monospace'; text('遮挡：目标在机身上方 / 后方，吊舱看不到', cx, cy - L - g - 12, FW_RED); }
  ctx.font = '11px "IBM Plex Mono", "Noto Sans SC", monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  text('鼠标 转视线 · 滚轮 / U 变焦 · N 白热 / 黑热 / 电视 · R 锁定 · Y 退出', 18, 56, 'rgba(244,244,238,.85)');
  if (V3FP.msg && performance.now() - V3FP.msg.at < 1800) { ctx.font = '14px "IBM Plex Mono", "Noto Sans SC", monospace'; ctx.textAlign = 'center'; text(V3FP.msg.t, cx, h * .72, FW_RED); }
  ctx.restore();
}
// 武器栏：一排，按键 + 名称 + 剩余
function ftBar(ctx) {
  const o = V3FP.o;
  if (typeof fwInit === 'function') fwInit(o);
  const L = typeof fwList === 'function' ? fwList(o) : [], it = L.map((s, i) => ({ k: String(i + 1), t: s.W.nm, n: s.n, sel: V3FP.ws === i }));
  it.push({ k: 'Z', t: '热诱弹', n: ftFlareN(o) }, { k: 'Y', t: V3FP.vw === 'tgp' ? '退出吊舱' : '光电吊舱', sel: V3FP.vw === 'tgp' }, { k: 'R', t: V3FP.gl ? '解除锁定' : '锁定地面', sel: !!V3FP.gl }, { k: 'F', t: '开火' });
  if (typeof FI === 'object') it.push({ k: 'I', t: '参数', sel: FI.on });   // 机型与挂载参数面板（fpinfo.js）
  ctx.save();
  ctx.font = '13px "IBM Plex Mono", "Noto Sans SC", monospace'; ctx.textBaseline = 'middle';
  const h = 28, gap = 6, kw = 20, wd = it.map(x => kw + 10 + ctx.measureText(x.t + (x.n != null ? ` ×${x.n}` : '')).width + 12);
  // 左下角的小地图挡着时，放在它右边的空当里居中（小地图的位置每半秒量一次，不每帧读版面）
  const nowMs = performance.now();
  if (!FT.mmAt || nowMs - FT.mmAt > 500) {
    FT.mmAt = nowMs; FT.mmX = 0;
    const mb = typeof document !== 'undefined' && document.getElementById('mmBox'), cv = typeof R === 'object' && R.cv;
    if (mb && cv && cv.getBoundingClientRect && mb.offsetParent !== null) { const r = mb.getBoundingClientRect(), c = cv.getBoundingClientRect(); if (r.width > 0 && r.height > 0) FT.mmX = { right: r.right - c.left, top: r.top - c.top }; }
  }
  const tot = wd.reduce((a, b) => a + b, 0) + gap * (it.length - 1), x1 = CAM.vw - 12;
  let x0 = 12;
  if (FT.mmX && FT.mmX.top < CAM.vh - 14 - h) x0 = Math.max(x0, Math.min(FT.mmX.right + 10, x1 - 200));
  const sc = Math.min(1, (x1 - x0) / tot), cx = tot * sc <= CAM.vw - 24 && CAM.vw / 2 - tot * sc / 2 >= x0 ? CAM.vw / 2 : (x0 + x1) / 2;   // 屏幕正中放得下就放正中
  ctx.translate(cx, CAM.vh - 14 - h * sc); ctx.scale(sc, sc);
  let x = -tot / 2;
  it.forEach((t, i) => {
    const empty = t.n === 0;
    ctx.fillStyle = t.sel ? 'rgba(0,0,0,.72)' : 'rgba(0,0,0,.55)'; ctx.fillRect(x, 0, wd[i], h);   // 底色都压暗：黑热时背景大片发白也看得清
    ctx.strokeStyle = t.sel ? 'rgba(255,255,255,.85)' : 'rgba(255,255,255,.12)'; ctx.lineWidth = t.sel ? 1.5 : 1; ctx.strokeRect(x + .75, .75, wd[i] - 1.5, h - 1.5);
    ctx.fillStyle = empty ? 'rgba(255,255,255,.18)' : 'rgba(255,255,255,.88)'; ctx.fillRect(x + 6, 5, kw, h - 10);   // 按键
    ctx.fillStyle = '#111'; ctx.textAlign = 'center'; ctx.fillText(t.k, x + 6 + kw / 2, h / 2 + 1);
    ctx.fillStyle = empty ? 'rgba(255,255,255,.35)' : t.sel ? '#ffffff' : 'rgba(255,255,255,.85)'; ctx.textAlign = 'left';
    ctx.fillText(t.t + (t.n != null ? ` ×${t.n}` : ''), x + kw + 12, h / 2 + 1);
    x += wd[i] + gap;
  });
  ctx.restore();
}
HOOK.newGame.push(() => { V3FP.flr = []; V3FP.gl = null; V3FP.tg = null; });
// 吊舱也是本方的传感器：盯着的那一片（画面看得见的地面范围）里的敌人被发现、在三维里画出来，全军共享（logistics.js updateVision）。
//   只在画面上一辆车至少占几个像素时才算看得清：看得见的地面宽度（斜距 × 视场角）超过约 2.2 公里就不算（宽视场看远处只是一片，要拉近了才分辨得出）
HOOK.visionP.push(() => {
  const T = V3FP.tg;
  if (!V3FP.on || V3FP.k !== 'air' || V3FP.vw !== 'tgp' || !T || T.mask) return [];
  const G = ftPt(), fw = (T.dist || 3000) * T.fov;
  if (!G || fw > 2200) return [];
  return [{ x: clamp(G[0], 0, W - 1), y: clamp(-G[1], 0, H - 1), r: clamp(fw * .55, 40, 900), h: 12 }];
});
