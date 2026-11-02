'use strict';
// 进攻方战区机场（用户：给进攻方做个机场，地图交战区扩大，战区飞机从机场起飞）——
//   放在地图南缘以外的攻方海岸上：南缘外约 1.8 公里是海岸（中间一道海峡），机场在岸后约 0.9 公里，跑道东西向、营区在跑道南侧，版图与守方野战机场同一套（afbase.js）；
//   陆基飞机（歼-16 系列、歼-20、轰-6K、无侦-7、攻击-2……）停在机位上待命，出击时从跑道入口滑跑起飞、往北飞进战场，
//   返航飞回来进近、落地、滑跑停下、进机位加油挂弹（原来从南缘外凭空出现、飞出南缘就算回了机场）；
//   驾驶时登陆基飞机就坐在跑道上看它滑跑离地，也能自己落回这条跑道（flight.js flSurf）。
//   地面战场的格子不动（两百多处代码按「北岸以南都是海」写的）：南缘外的海峡、海岸、机场只在 3D 写实画面里画出来（view3d.js v3SouthBuild），部队到不了；
//   只有南边是海的地图才有（默认地图、海岛；白色平原没有，陆基飞机照旧从南缘外飞来）
const AFP = { off: 2700, shore: 1800, z: 4, rearm: 60, tex: [2048, 2048], rect: [-600, -380, 1200, 1200] };   // 机场图案贴图 2048²（2 的幂，好生成多级渐远），盖住场区 1200 × 1200 米
const afpOn = () => !!(S && S.afP);
function afpInit() {
  S.afP = null;
  if (!TER || TER.flat || !TER.type) return;
  let w = 0;
  for (let x = 0; x < GW; x++) if (isWater(TER.type[(GH - 1) * GW + x])) w++;
  if (w < GW * .95) return;
  S.afP = { id: 'afP', kind: 'airfield', home: true, ours: true, x: Math.round(W * .5), y: Math.round(H + AFP.off), rh: 0, rs: 1, hp: 1, maxhp: 1 };
}
HOOK.newGame.push(afpInit);
// 攻方海岸线（南缘外，起伏的岸）与南岸地面高度（3D 坐标的 z：海面 −2.6，岸上约 4 米，往南起伏的缓丘；机场场区推平）
const afpShoreY = x => H + AFP.shore + 120 * Math.sin(x / 1700 + 1.3) + 50 * Math.sin(x / 530 + .4);
function afpHt(x, y) {
  const d = y - afpShoreY(x);
  if (d < -60) return -9;
  if (d < 0) return lerp(-9, -2.6, (d + 60) / 60);
  if (d < 70) return lerp(-2.6, AFP.z - .4, d / 70);   // 沙滩
  let z = AFP.z + 7 * smooth(300, 1600, d) * (.5 + .5 * Math.sin(x / 930 + .7) * Math.sin(y / 710 + 1.9)) + 1.2 * Math.sin(x / 260) * Math.sin(y / 190) * smooth(70, 300, d);
  const b = S && S.afP;
  if (b) {   // 机场场区（外扩 150 米渐变）推平到 AFP.z
    const r = AFP.rect, u = x - b.x, v = y - b.y, ex = Math.max(r[0] - u, u - (r[0] + r[2]), 0), ey = Math.max(r[1] - v, v - (r[1] + r[3]), 0);
    z = lerp(AFP.z, z, smooth(0, 150, Math.hypot(ex, ey)));
  }
  return z;
}
// 跑道（与 abn.js abRwy 同一套：入口、进近点、方向）
const afpRwy = () => abRwy(S.afP);
// 起飞：在跑道入口对准、沿跑道加速滑跑离地（abn.js abPlaneFly 'tko'，p.afB = 'home' 按这座机场算）
function afpTakeoff(w, kind, tx, ty) {
  const b = S.afP;
  if (!b) return false;
  const R0 = afpRwy(), [x, y] = eaW(b, R0.u0, 0);
  const p = airNew(w, kind, x, y, Math.atan2(R0.hy, R0.hx), clamp(tx, 10, W - 10), clamp(ty, 10, H - 10), { phase: 'out', land: true, alt: 0, spd: 20, afPh: 'tko', afB: 'home', ru: R0.u0 });
  S.planes.push(p);
  w.state = 'out';
  if (typeof airCount === 'function') airCount();
  log(`${airName(kind, w.v)}从战区机场滑跑起飞，目标方位 ${fmtBrg(bearing(x, y, tx, ty))}`, 'info', 'airup', 1.5);
  return true;
}
// 返航：飞回这座机场进近降落（运输机照旧，见 para.js）
function afpRtb(p) {
  if (p.afPh) return true;
  if (!afpOn() || p.kind === 'transport') return false;
  Object.assign(p, { afPh: 'app', afB: 'home', afT: S.t });
  return true;
}
// 停在这座机场的我方飞机（在册、陆基、不是在夺取的机场整备的）：待命的、整备中的，按机位排（afbase.js afbParked → 2D、3D 停放的飞机）
const afpParked = () => (S.air && S.air.wing || []).filter(w => typeof airLandW === 'function' && airLandW(w) && !w.af && (w.state === 'deck' || w.state === 'rearm'));
// 3D 南岸地面上的机场图案：用 afbase.js 的平面画法把整座机场（道面、标线、建筑、草地）画进一张画布，view3d.js 当贴图铺在南岸网格上；
//   画一次就够（这座机场不挨炸，没有弹坑）；临时把缩放 R.s 设成贴图的像素密度，平面画法按它选细节档、线宽
function afpTex() {
  if (!afpOn() || typeof eaDrawBase !== 'function' || typeof document === 'undefined' || typeof R !== 'object') return null;
  const b = S.afP, key = `${b.x},${b.y}`;
  if (AFP.cv && AFP.cvK === key) return AFP.cv;
  const [tw, th] = AFP.tex, r = AFP.rect, k = tw / r[2], cv = AFP.cv || document.createElement('canvas');
  cv.width = tw; cv.height = th;
  const ctx = cv.getContext('2d'), s0 = R.s;
  ctx.clearRect(0, 0, tw, th);
  ctx.setTransform(k, 0, 0, k, -(b.x + r[0]) * k, -(b.y + r[1]) * k);
  R.s = k;
  try { eaDrawBase(ctx, b, true, 0, true); } finally { R.s = s0; }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  AFP.cv = cv; AFP.cvK = key; AFP.ver = (AFP.ver || 0) + 1;
  return cv;
}
