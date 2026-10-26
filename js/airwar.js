'use strict';
// 空战与制空权（v7）：进攻方舰载战斗机（carrier.js，kind = fighter）与守方歼击机（eair.js，type = ftr）
// 在指定空域巡逻（CAP），拦截对方飞机：中距空空导弹（missile.js 飞行与结算，src = aam）与近距机炮，双方战斗机互相缠斗。
// 制空权：双方在空战斗机实力（含导弹余量；在地面待命的按三分之一计）之比，平滑后 ≥ .45 我方掌握、≤ −.45 敌方掌握、其余为争夺；
//   掌握制空权的一方，对方的攻击机 / 直升机 / 轰炸机出动受限（AI 等护航或只打高价值目标），而且会被巡逻的战斗机拦截。
// 界面：据点条下方的制空权条；支援栏「战斗机」按钮（W）在指定空域巡逻；航母自动派机时 AI 自动派战斗机，守方机场自动派歼击机。
// 状态：S.airw = { v1, v 制空权 −1..1, st 'p' | 'e' | 'c' | null, k: {p, e} 空战击落数, seenP / seenE 最近发现对方飞机的时刻, thT, lnE, said }
const AW_RNG = 700, AW_CAP = 160, AW_LEASH = 950;   // 拦截搜索半径 · 巡逻圈半径 · 目标离巡逻中心多远就不再追（不被诱离防区）
const AW_PK = { fighter: .42, ftr: .42, f22: .36, transport: .65, recon: .62, strike: .55, cas: .55, ga: .55, bomber: .6, heli: .5, c17: .65 };   // 空空导弹单发命中率（干扰弹另算）
// 守方歼击机按型号的挂载与实力：aam 空空导弹数、aamR 射程、pkK 命中修正、gun 机炮、radar 机载雷达发现距离、pw 制空权实力（在空 / 地面待命）
const EA_FTR = { ftr: { aam: 4, aamR: 480, pkK: 1.1, gun: 30, radar: 520, pw: 1.25, pw0: .35 },   // F-35A：4 枚 AIM-120D
  f22: { aam: 8, aamR: 520, pkK: 1.25, gun: 40, gunK: 1.3, radar: 640, pw: 1.75, pw0: .5 } };   // F-22A：6 枚 AIM-120D + 2 枚 AIM-9X，AN/APG-77 雷达
const AW_ICON = typeof WI === 'object' ? WI.j20 : '<path d="M12 2l1.4 5.6 7.6 6.4v2l-7.6-2.2-.3 3.8 2.6 2v1.6L12 20.4l-3.7 1.2V20l2.6-2-.3-3.8L3 16v-2l7.6-6.4z"/>';   // 制空权条：歼-20
const awStat = (k, n = 1) => { const o = S.v7s || (S.v7s = {}); o[k] = (o[k] || 0) + n; };
const awAng = a => Math.atan2(Math.sin(a), Math.cos(a));
function awEnsure() { if (!S.airw || S.airw.v1 !== 1) S.airw = { v1: 1, v: 0, st: null, k: { p: 0, e: 0 }, seenP: -1e9, seenE: -1e9, thT: 0, lnE: -99, said: {} }; return S.airw; }
const awState = () => S && S.airw ? S.airw.st : null;
const awTgt = t => t && typeof msTgtObj === 'function' ? msTgtObj(t) : null;
const awWhere = (x, y) => typeof cmdWhere === 'function' ? cmdWhere(x, y) : gridRef(x, y);

// side 方要打的对方飞机（在空中、已离开跑道 / 甲板）：[{o, k, type, x, y, ftr}]
function awFoes(side) {
  const out = [];
  if (side === 'e') { for (const p of S.planes || []) if (!p.dead && p.alt > .25 && !['cat', 'roll', 'trap', 'final'].includes(p.phase) && !p.afPh) out.push({ o: p, k: 'plane', type: p.kind, x: p.x, y: p.y, ftr: p.kind === 'fighter', st: typeof airStealth === 'function' ? airStealth(p) : 1 }); }
  else if (S.eair) for (const a of S.eair.fly) if (!a.dead && a.alt > .1 && !['roll', 'land', 'final'].includes(a.ph)) out.push({ o: a, k: 'eair', type: a.type, x: a.x, y: a.y, ftr: eaFtr(a.type), st: eaStl(a) });
  return out;
}
// side 方是否发现了 (x, y) 处的飞机：进攻方 = 视野、战斗机机载雷达 520、驱逐舰 720、航母 600；守方 = 视野、雷达站 820、歼击机 520（F-22A 640）、机场 450、沙盒雷达站
// st：目标的隐身系数（F-22A 0.3、歼-20 0.35、歼-35 0.4、F-35A 0.45……）——雷达发现距离乘 st × 1.2（不超过原距离），目视发现不受影响
function awSeen(side, x, y, st = 1) {
  const k = Math.min(1, st * 1.2);
  if (side === 'p') {
    if (inVision(x, y)) return true;
    const aew = awAew();
    if (aew && dist(aew.x, aew.y, x, y) < 900 * k) return true;   // 空警-600 预警机
    for (const p of S.planes || []) if (!p.dead && p.kind === 'fighter' && p.alt > .3 && dist(p.x, p.y, x, y) < (p.radar || 520) * (aew ? 1.25 : 1) * k) return true;   // 歼-36 雷达 900；预警机引导时战斗机发现距离 +25%
    if (typeof msDefShips === 'function') for (const s of msDefShips()) if (dist(s.x, s.y, x, y) < 720 * k) return true;
    if (typeof cvAll === 'function') for (const c of cvAll()) if (c.hp > 0 && dist(c.x, c.y, x, y) < 600 * k) return true;
    return false;
  }
  if (spotted(x, y)) return true;
  const rd = typeof radarUp === 'function' ? radarUp() : null;
  if (rd && dist(rd.x, rd.y, x, y) < 820 * k) return true;
  if (S.eair) for (const a of S.eair.fly) if (!a.dead && eaFtr(a.type) && a.alt > .2 && dist(a.x, a.y, x, y) < EA_FTR[a.type].radar * k) return true;
  if (typeof eaBases === 'function') for (const b of eaBases()) if (dist(b.x, b.y, x, y) < 450 * k) return true;
  for (const o of S.sbxObs || []) if (!o.dead && o.kind === 'e_radar' && dist(o.x, o.y, x, y) < o.r * 1.4 * k) return true;
  if (typeof afdRadarSees === 'function' && afdRadarSees(x, y, k)) return true;   // 机场雷达站（afdef.js）
  return false;
}
// —— 隐身暴露：隐身机在对方雷达覆盖下（按不隐身的目标算的探测范围：雷达站、机场、预警机、战斗机雷达、舰载雷达、地面部队的眼睛）待得越久，
//    被多部雷达反复照射、积累航迹，隐身效果越差——连续 AW_EXP.t0 秒后开始打折，再过 AW_EXP.t1 秒完全暴露（隐身系数回到 1，防空导弹也好锁定了）；
//    离开覆盖后按 AW_EXP.rec 倍的速度慢慢恢复。o.exp：在覆盖下累计的秒数 ——
const AW_EXP = { t0: 15, t1: 30, rec: .6, every: .5 };
function awStl(o, base) {
  if (!(base < 1)) return 1;
  return !o || !(o.exp > AW_EXP.t0) ? base : base + (1 - base) * clamp((o.exp - AW_EXP.t0) / AW_EXP.t1, 0, 1);
}
const eaStl = a => awStl(a, (EA_SPEC[a.type] && EA_SPEC[a.type].stealth) || 1);
function awExpose(dt) {
  const go = (o, base, foe, nm, side) => {
    if (!(base < 1)) return;
    if (awSeen(foe, o.x, o.y, 1)) {
      o.exp = (o.exp || 0) + dt;
      if (o.exp > AW_EXP.t0 + AW_EXP.t1 && !o.expSaid) {
        o.expSaid = true; awStat('stlExp' + side);
        log(side === 'p' ? `${nm}在敌雷达覆盖下停留太久，已被敌方稳定跟踪——隐身失效` : `敌${nm}在我方雷达覆盖下停留太久，已形成稳定航迹，可以锁定`, side === 'p' ? 'warn' : 'info', 'stlexp' + o.id, 20, o);
      }
    } else if (o.exp > 0) { o.exp = Math.max(0, o.exp - dt * AW_EXP.rec); if (o.exp < AW_EXP.t0) o.expSaid = false; }
  };
  for (const p of S.planes || []) if (!p.dead && p.alt > .25) go(p, (typeof airMdl === 'function' ? airMdl(p.kind, p.v).stealth : 1) || 1, 'e', typeof airName === 'function' ? airName(p.kind, p.v).split(' ')[0] : '隐身机', 'p');
  if (S.eair) for (const a of S.eair.fly) if (!a.dead && a.alt > .1) go(a, (EA_SPEC[a.type] && EA_SPEC[a.type].stealth) || 1, 'p', (EA_SPEC[a.type] || {}).name || '隐身机', 'e');
}
// —— 防空威胁图（真实战法：每架飞机在保全自己的前提下打击目标）——
// side 方飞机眼中已知的对方防空圈 [{x, y, r, w, k}]：进攻方看已标定的高炮、看见过的防空车、近 90 秒暴露的单兵防空、发现的敌舰；守方看见到的我方防空车、暴露过的单兵防空、我方舰队防空伞
function airThreats(side) {
  const out = [];
  if (side === 'p') {
    if (typeof airAASites === 'function') for (const a of airAASites()) out.push({ x: a.x, y: a.y, r: a.k === 'gun' ? 200 : a.k === 'mp' ? 240 : (a.o.samX && a.o.samX.range) || (a.o.type === 'sam_veh' ? 520 : 240), w: a.w, k: a.k });
    for (const e of S.eships || []) if (!e.dead && S.t - (e.det ?? -99) < 30 && typeof NV_CLS === 'object' && NV_CLS[e.cls].samR) out.push({ x: e.kx ?? e.x, y: e.ky ?? e.y, r: NV_CLS[e.cls].samR, w: 3, k: 'ship' });
  } else {
    for (const v of S.veh || []) if (v.side === 'p' && !v.dead && (vehSp(v).aa || v.type === 'sam_veh') && spotted(v.x, v.y)) out.push({ x: v.x, y: v.y, r: v.type === 'sam_veh' ? (v.samX && v.samX.range) || 520 : vehSp(v).aa || 230, w: v.type === 'sam_veh' ? 2 : 1.3, k: 'veh' });
    for (const q of S.teams) if (q.side === 'p' && q.men.length && q.men.includes('aa') && q.aaSeenE != null && S.t - q.aaSeenE < 120) out.push({ x: q.x, y: q.y, r: 240, w: .8, k: 'mp' });
    if (typeof msDefShips === 'function') for (const s of msDefShips()) out.push({ x: s.x, y: s.y, r: s.esc ? 550 : 650, w: 3, k: 'ship' });
  }
  return out;
}
const airThreatAt = (T, x, y, m = 0) => T.reduce((a, t) => a + (dist(t.x, t.y, x, y) < t.r + m ? t.w : 0), 0);
// 目标 (tx, ty) 周围半径 rng 的圆上，偏向 (fx, fy) 一侧，找离已知防空圈最远的发射 / 待机点（risk = 仍在其中的威胁值）
function airSafePos(tx, ty, rng, T, fx, fy, m = 40, bonus) {
  let best = null, bs = -Infinity;
  const a0 = fx != null ? Math.atan2(fy - ty, fx - tx) : Math.PI / 2;
  for (let i = 0; i < 18; i++) {
    const a = a0 + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * .35, x = clamp(tx + Math.cos(a) * rng, 30, W - 30), y = clamp(ty + Math.sin(a) * rng, 30, H - 30);
    const risk = airThreatAt(T, x, y, m), s = -risk * 10 - Math.abs(Math.atan2(Math.sin(a - a0), Math.cos(a - a0))) * .5 + (bonus ? bonus(x, y) : 0);
    if (s > bs) { bs = s; best = { x, y, risk }; }
  }
  return best;
}
// —— 直升机防空规避（双方通用）：低空慢速的直升机最怕高炮、单兵防空导弹和野战防空导弹，真实战法是「不进防空圈」——
//   ① 悬停发射点：目标周围找不到已知防空圈（外加 50 余量）以外的点，就不进去——换目标或返航，不挑一个「最不坏」的点硬闯
//   ② 进出航线：从当前位置到悬停点的直线穿过已知防空圈，就从圈外绕（圈外 1.25 倍半径的航路点）；本身在圈里先径直出圈
//   ③ 遭到射击（高炮曳光、导弹告警、机枪）：机组看得见火力从哪来，把那一点记成威胁 60 秒，马上离开、换一个避开它的点；
//      同一架挨打第二次就返航
const HELI = { m: 50, mem: 60, hits: 2 };
// 这架直升机眼中的威胁：本方掌握的已知防空 + 机组自己挨打记下的火力点
function heliT(side, h) {
  const T = typeof airThreats === 'function' ? airThreats(side) : [];
  if (h && h.dz) { h.dz = h.dz.filter(z => S.t - z.t < HELI.mem); for (const z of h.dz) T.push({ x: z.x, y: z.y, r: z.r, w: z.w || 1, k: 'dz' }); }
  return T;
}
// 挨打：记下火力点（同一处 60 以内合并），4 秒内的连续射击只算一次
function heliShotAt(h, x, y, r, w) {
  if (!h || !isFinite(x) || !isFinite(y)) return;
  const dz = h.dz || (h.dz = []), o = dz.find(z => dist(z.x, z.y, x, y) < 60);
  if (o) { o.t = S.t; o.r = Math.max(o.r, r); } else dz.push({ x: Math.round(x), y: Math.round(y), r, w: w || 1, t: S.t });
  if (S.t - (h.shotT ?? -99) > 4) h.shotN = (h.shotN || 0) + 1;
  h.shotT = S.t;
}
// 悬停发射点：目标周围 rng（打不到就放大到 rMax）的圆上、偏向 (fx, fy) 一侧，找一个完全在已知防空圈外的点；找不到返回 null
function heliSpot(tx, ty, rng, rMax, T, fx, fy, bonus) {
  for (const r of [rng, (rng + rMax) / 2, rMax]) {
    const p = airSafePos(tx, ty, r, T, fx, fy, HELI.m, bonus);
    if (p && p.risk <= 0) return p;
  }
  return null;
}
// 绕行航路点：(x0, y0) → (x1, y1) 的直线穿过某个防空圈（r + m）时，返回圈外的绕行点；直线干净返回 null
function heliVia(x0, y0, x1, y1, T, m = HELI.m) {
  let best = null, bt = Infinity;
  const L = dist(x0, y0, x1, y1) || 1, ux = (x1 - x0) / L, uy = (y1 - y0) / L;
  for (const t of T) {
    const R0 = t.r + m, d0 = dist(x0, y0, t.x, t.y);
    if (dist(x1, y1, t.x, t.y) < R0) continue;   // 终点本身在圈里（悬停点已避开，只会是返航点之类）：不绕，也不往外躲（否则在圈边来回）
    if (d0 < R0) { const k = R0 * 1.12 / Math.max(1, d0); return { x: clamp(t.x + (x0 - t.x) * k, 20, W - 20), y: clamp(t.y + (y0 - t.y) * k, 20, H - 20), out: true }; }   // 已在圈里：先径直出圈
    const s = clamp((t.x - x0) * ux + (t.y - y0) * uy, 0, L), cx = x0 + ux * s, cy = y0 + uy * s;
    if (dist(cx, cy, t.x, t.y) >= R0 || s >= bt) continue;
    let nx = cx - t.x, ny = cy - t.y, nl = Math.hypot(nx, ny);
    if (nl < 1) { nx = -uy; ny = ux; nl = 1; }   // 穿心而过：先试左边
    const at = sg => ({ x: clamp(t.x + nx / nl * R0 * 1.25 * sg, 20, W - 20), y: clamp(t.y + ny / nl * R0 * 1.25 * sg, 20, H - 20) });
    let wp = at(1);
    const r1 = airThreatAt(T, wp.x, wp.y, m * .5);
    if (r1 > 0) { const w2 = at(-1); if (airThreatAt(T, w2.x, w2.y, m * .5) < r1) wp = w2; }   // 这一侧也有防空：走另一侧
    bt = s; best = wp;
  }
  return best;
}
// 导弹告警：有对方防空导弹正飞向这架飞机
const airMslWarn = (side, k, id) => S.missiles.some(m => m.kind === 'sam' && m.side !== side && !m.done && m.t >= 0 && m.tgt && m.tgt.k === k && m.tgt.id === id);

// 在空的空警-600 预警机（舰载预警机，carrier.js recon 默认型号）
const awAew = () => (S.planes || []).find(p => !p.dead && p.kind === 'recon' && (p.v || 'kj600') === 'kj600' && p.alt > .4) || null;
// 我方舰队防空伞：驱逐舰舰空导弹 650（护航舰 550）、航母 450 以内（m 为外扩余量）；舰空导弹打光的舰不算
// 守方歼击机不追进来、不在里面设巡逻点，守方攻击机 / 直升机也不单机闯进来送
function awFleetCover(x, y, m = 0) {
  if (typeof msDefShips === 'function') for (const s of msDefShips()) if ((typeof vlsHas !== 'function' || vlsHas(s.o, 'sam')) && dist(s.x, s.y, x, y) < (s.esc ? 550 : 650) + m) return true;
  if (typeof cvAll === 'function') for (const c of cvAll()) if (c.hp > 0 && dist(c.x, c.y, x, y) < 450 + m) return true;
  return false;
}
// 追踪：瞄准目标的提前位置（按目标速度与距离，最多 1.2 秒），转弯率 turn（战斗机比攻击机灵活）
function awPursue(f, T, dt, turn) {
  const k = airK(f), d = dist(f.x, f.y, T.x, T.y), lead = Math.min(1.2, d / Math.max(60, f.spd * k * 1.5)), h = T.heading ?? 0, v = (T.spd || 0) * (T.alt != null ? airK(T) : 1);
  const tx = clamp(T.x + Math.cos(h) * v * lead, 20, W - 20), ty = clamp(T.y + Math.sin(h) * v * lead, 20, H - 20);
  const tr = airYaw(f, awAng(Math.atan2(ty - f.y, tx - f.x) - f.heading), turn, dt);   // 平滑转向（carrier.js）
  f.heading = awAng(f.heading + tr); f.bank = lerp(f.bank || 0, clamp(f.hr / turn, -1, 1), Math.min(1, dt * 6));
  f.x += Math.cos(f.heading) * f.spd * k * dt; f.y += Math.sin(f.heading) * f.spd * k * dt;
}

// —— 五代机（隐身，st < 1）的超视距战法：只打远距离——进入射程发射导弹后偏开约 50° 侧转（目标留在雷达扫描范围边缘、降低接近速度），
//    敌机逼近 AW_BVR.min 以内就转身加速拖开，不进入格斗、不用机炮；导弹打光即返航（现实中的「发射—侧转—脱离」）——
const AW_BVR = { crank: .9, crankT: 5, min: 260, ext: 420, idle: 30, step: 320 };
const awFifth = (side, f) => side === 'p' ? !!((typeof airSpec === 'function' ? airSpec('fighter', f.v) : {}).stealth) : !!((EA_SPEC[f.type] || {}).stealth);
// 返回 [朝向点 x, y, 速度倍数]；不需要特殊机动时返回 null（照常飞向目标、进到射程就发射）
function awBvrMove(f, T) {
  const d = dist(f.x, f.y, T.x, T.y), a = Math.atan2(T.y - f.y, T.x - f.x);
  if (d < AW_BVR.min || f.extT > S.t) {
    if (!(f.extT > S.t)) { f.extT = S.t + 3; awStat('bvrExtend'); }
    return [f.x - Math.cos(a) * AW_BVR.ext, f.y - Math.sin(a) * AW_BVR.ext, 1.15];
  }
  if (f.crankT > S.t) { const b = a + AW_BVR.crank * (f.crankS || 1); return [f.x + Math.cos(b) * 300, f.y + Math.sin(b) * 300, 1.05]; }
  return null;
}
// 巡逻 AW_BVR.idle 秒都没目标：巡逻点向敌方空域前推（避开已知防空圈）主动找敌机，不在自己头上空转
function awSweep(f, side) {
  f.idleT = (f.idleT || 0) + .5;
  if (f.idleT < AW_BVR.idle) return;
  f.idleT = 0;
  const T = typeof airThreats === 'function' ? airThreats(side) : [];
  const goal = side === 'p' ? (S.enemies.find(e => e.kind === 'airfield' && !e.dead && e.kx != null) || { x: f.cx, y: Math.max(80, f.cy - 600) }) : { x: f.cx, y: Math.min(H - 80, f.cy + 600) };
  const a = Math.atan2(goal.y - f.cy, goal.x - f.cx);
  for (const k of [1, .6, .3]) {
    const x = clamp(f.cx + Math.cos(a) * AW_BVR.step * k, 60, W - 60), y = clamp(f.cy + Math.sin(a) * AW_BVR.step * k, 60, H - 60);
    if (airThreatAt(T, x, y, 80) > 0 || (side === 'e' && awFleetCover(x, y, 80))) continue;
    f.cx = x; f.cy = y; awStat('capSweep' + side);
    if (side === 'p' && typeof chatSay === 'function') chatSay('p', `报告：${typeof airName === 'function' ? airName('fighter', f.v) : '战斗机'}巡逻空域内无敌情，前出至${awWhere(x, y)}上空扫荡搜索敌机。`, { kind: 'report', at: { x, y }, key: 'sweep', gap: 40, lv: 2 });
    return;
  }
}

// —— 空战（每架战斗机每 0.5 秒）：选目标（对方战斗机优先，其次攻击机 / 轰炸机 / 直升机，侦察机最后，同类取近；离巡逻中心太远的不追），
//    中距空空导弹（130–480、机头 ±40° 以内、同一目标同时只打一枚、间隔 3 秒）与近距机炮（95 以内、机头 ±20°）——
function awFight(f, side, dt) {
  if ((f.awT = (f.awT || 0) - dt) > 0) return;
  f.awT = .5;
  const foes = awFoes(side), A = awEnsure();
  let T = null;
  const deep = t => side === 'e' && awFleetCover(t.x, t.y, 60);   // 守方：目标进了我舰队防空伞就放掉，不追进去送
  const rng = Math.max(AW_RNG, (f.radar || 0) * 1.1), leash = AW_LEASH * (f.radar > 700 ? 1.4 : 1);   // 歼-36：雷达大，搜索、追击范围都更远
  if (f.tg) { const t = foes.find(o => o.k === f.tg.k && o.o.id === f.tg.id); if (t && awSeen(side, t.x, t.y, t.st) && dist(t.x, t.y, f.cx, f.cy) < leash && !deep(t)) T = t; }
  if (!T || S.t - (f.tgT || 0) > 3) {
    let bs = T ? dist(f.x, f.y, T.x, T.y) * (T.ftr ? .6 : .8) : Infinity;
    for (const t of foes) {
      const d = dist(f.x, f.y, t.x, t.y);
      if (d > rng || dist(t.x, t.y, f.cx, f.cy) > leash || !awSeen(side, t.x, t.y, t.st) || deep(t)) continue;
      const s = d * (t.ftr ? .6 : t.type === 'recon' ? 1.1 : .8);
      if (s < bs) { bs = s; T = t; }
    }
    f.tgT = S.t;
  }
  f.tg = T ? { k: T.k, id: T.o.id } : null;
  if (!T) { if (f.cx != null && !f.escOf && f.lead == null && f.wm == null) awSweep(f, side); return; }
  f.idleT = 0;
  const g5 = f.g5 ?? (f.g5 = awFifth(side, f));
  if (side === 'p') A.seenE = S.t; else A.seenP = S.t;
  const d = dist(f.x, f.y, T.x, T.y), off = Math.abs(awAng(Math.atan2(T.y - f.y, T.x - f.x) - f.heading));
  // 中距弹：射程按弹种（霹雳-15 560、AIM-120 480）；隐身目标要飞进本机雷达的锁定距离（雷达距离 × 隐身系数 × 1.6）才能发射，命中打八五折
  //   ——F-22A（0.3）只有 250 以内才被歼-20 锁定，而它在 360 外就能锁定歼-20：先敌发现、先敌开火
  //   远程弹（歼-36 的霹雳-17，aamL）：目标在中距弹射程外、或中距弹打光时才用；打运输机、攻击机这种大而笨的目标最准，打战斗机差些。歼-36 能同时制导多枚，间隔 1.2 秒
  const lock = (side === 'p' ? f.radar || 520 : (EA_FTR[f.type] || EA_FTR.ftr).radar) * Math.min(1, (T.st || 1) * 1.6);
  const aR = Math.min(f.aamR || 480, lock), aLR = f.aamL > 0 ? Math.min(f.aamLR || 900, lock) : 0;
  if (d > 130 && off < .7 && (f.aamT || 0) <= S.t && !S.missiles.some(m => m.src === 'aam' && m.side === side && !m.done && m.tgt && m.tgt.k === T.k && m.tgt.id === T.o.id)) {
    const st = (T.st || 1) < .6 ? .85 : 1, gap = f.radar > 700 ? 1.2 : 3;
    if (f.aam > 0 && d < aR) {
      const pk = (AW_PK[T.type] || .5) * (f.pkK || 1) * (d > aR * .8 ? .85 : 1) * st;
      msLaunch('sam', side, f.x, f.y, { x: T.x, y: T.y }, { tgt: { k: T.k, id: T.o.id }, src: 'aam', spd: 640, dur: 2.6, pk });
      f.aam--; f.aamT = S.t + gap; f.fired = S.t;
      awStat(side === 'p' ? 'aamP' : 'aamE');
      if (g5) { f.crankT = S.t + AW_BVR.crankT; f.crankS = Math.random() < .5 ? 1 : -1; }   // 五代机：发射后侧转
    } else if (f.aamL > 0 && d < aLR) {
      const pk = (AW_PK[T.type] || .5) * (T.ftr ? .75 : 1.15) * (f.pkK || 1) * st;
      msLaunch('sam', side, f.x, f.y, { x: T.x, y: T.y }, { tgt: { k: T.k, id: T.o.id }, src: 'aam', spd: 760, dur: Math.max(2.6, d / 640 + 1), pk, lr: true });
      f.aamL--; f.aamT = S.t + gap; f.fired = S.t;
      awStat('aamL');
      if (g5) { f.crankT = S.t + AW_BVR.crankT; f.crankS = Math.random() < .5 ? 1 : -1; }
      log(`歼-36 发射霹雳-17 远程空空导弹，攻击 ${Math.round(d)} 米外的敌${(EA_SPEC[T.type] || {}).name || '机'}（余 ${f.aamL} 枚）`, 'info', 'aaml' + f.id, 3, T);
    }
  }
  if (!g5 && d < 95 && off < .35 && (f.gun || 0) > 0) {   // 五代机不进格斗、不用机炮
    f.gun--; f.gunT = .35; f.fired = S.t;
    for (let i = 0; i < 2; i++) tracer(f.x, f.y, T.x + gauss() * 6, T.y + gauss() * 6, side, true);
    if (Math.random() < (T.ftr ? .1 : .17) * (f.gunK || 1) * (T.type === 'f22' ? .35 : T.o.v === 'j36' || T.o.v === 'j36s' ? 1.4 : 1)) {   // F-22A 推力矢量：缠斗中难被咬住；歼-36 体型大、无尾，被咬住就难甩掉
      if (T.k === 'plane') { if (typeof airLost === 'function') airLost(T.o, `${typeof airName === 'function' ? airName(T.o.kind, T.o.v) : '飞机'}被敌歼击机机炮击落`); }
      else if (typeof eaLost === 'function') eaLost(T.o, 'gun');
      awScore(side);
    }
  }
}
// 空战击落（导弹由 missile.js msSamHit 报来，机炮在上面）
function awScore(side) { const A = awEnsure(); A.k[side]++; awStat(side === 'p' ? 'awKillP' : 'awKillE'); }

// —— 进攻方战斗机（carrier.js flyPlane 在 out / loiter 阶段调用）：出航到巡逻点 → 绕 160 的圈巡逻 → 发现敌机就拦截；
//    巡逻时间（capT）到或弹尽返航，着舰与整备沿用 carrier.js ——
function awFlyP(p, dt, speed) {
  const sp = typeof airSpec === 'function' ? airSpec('fighter', p.v) : AIR_SPEC.fighter;
  p.alt = Math.min(1, p.alt + dt / 2);
  if (sp.radar > 700) awJ36(p);
  // 随队护航：跟着轰炸机长机（巡逻中心随它移动，敌机逼近它才迎击）；轰炸机返航 / 损失后在目标上空再巡逻一会儿
  let B = null;
  if (p.escOf != null) {
    B = S.planes.find(o => o.id === p.escOf && !o.dead && o.phase === 'out');
    if (B) { p.cx = B.x; p.cy = B.y; } else { p.escOf = null; p.cx = clamp(p.tx, 60, W - 60); p.cy = clamp(p.ty, 60, H - 60); p.capT = Math.min(p.capT, 30); }
  }
  awFight(p, 'p', dt);
  if (sp.agm) awJ36Strike(p, sp);
  const T = p.tg && awTgt(p.tg);
  if (B && !(T && dist(T.x, T.y, B.x, B.y) < 450)) {   // 编队：轰炸机右后 / 左后；离得远先全速飞向轰炸机会合
    if (dist(p.x, p.y, B.x, B.y) > 240) { speed(sp.spd * 1.15); airSteer(p, B.x, B.y, dt, true); return; }
    const c = Math.cos(B.heading), n = Math.sin(B.heading), side = (p.slot || 1) % 2 ? 1 : -1, ox = -34, oy = 30 * side;
    const px = B.x + c * ox - n * oy, py = B.y + n * ox + c * oy, err = (px - p.x) * c + (py - p.y) * n;
    speed(clamp(B.spd + err * .9, B.spd * .7, sp.spd * 1.2));
    airSteer(p, px + c * 40, py + n * 40, dt, true);
    if (!(p.aam > 0) && !(p.aamL > 0) && !(p.gun > 0)) airSet(p, 'rtb');
    return;
  }
  if (T && sp.turn < 2 && eaFtr(T.type) && dist(p.x, p.y, T.x, T.y) < 300) {   // 歼-36：体型大、无尾、不带航炮——敌战斗机逼近就加速拉开，不进缠斗
    speed(sp.spd * 1.15);
    const a = Math.atan2(p.y - T.y, p.x - T.x);
    airSteer(p, clamp(p.x + Math.cos(a) * 400, 40, W - 40), clamp(p.y + Math.sin(a) * 400, 40, H - 40), dt, true);
  }
  else if (T) {
    const mv = sp.stealth ? awBvrMove(p, T) : null;
    if (mv) { speed(sp.spd * mv[2]); airSteer(p, clamp(mv[0], 40, W - 40), clamp(mv[1], 40, H - 40), dt, true); }
    else { speed(sp.spd * 1.12); awPursue(p, T, dt, sp.turn || 2.3); }
    p.ext = false;
  }
  else if (p.phase === 'out') { speed(sp.spd); if (airSteer(p, p.cx, p.cy, dt) < AW_CAP + 40) { airSet(p, 'loiter'); p.leg2 = atoLeg(p, p.cx, p.cy, ATO_LEG.ftr); } }
  else {   // 扫荡航段：沿岸线直飞一段，飞完返航（不兜圈子）
    if (!p.leg2) p.leg2 = atoLeg(p, p.x, p.y, ATO_LEG.ftr);
    speed(sp.spd * .8);
    if (airSteer(p, p.leg2.x, p.leg2.y, dt) < 90) airSet(p, 'rtb');
  }
  if (!T && p.fired != null && S.t - p.fired > 4 && p.phase !== 'rtb') airSet(p, 'rtb');   // 打完一波（发射过、四秒内没有新目标）就返航
  if (p.phase === 'loiter' && (p.capT -= dt) <= 0) airSet(p, 'rtb');
  else if (!(p.aam > 0) && !(p.aamL > 0) && !(p.agmN > 0) && (sp.stealth || !(p.gun > 0))) airSet(p, 'rtb');   // 五代机导弹打光就回，不拿机炮去格斗
}
// 歼-36 首次进入战区：双方通报（每局一次）
function awJ36(p) {
  const A = awEnsure();
  if (A.said.j36 || p.alt < .5 || typeof chatSay !== 'function') return;
  A.said.j36 = 1;
  chatSay('p', `报告：${airName('fighter', p.v)}从战区机场起飞进入战场，机载雷达接管战场空情，远程导弹先打敌运输机、攻击机与战斗机。`, { kind: 'report', at: p, lv: 1 });
  chatSay('e', '报告：雷达上偶尔闪现一个很大的回波又消失了……目视确认是一架无尾、三台发动机的大型隐身飞机，判断为中国歼-36！各机注意，它看得见我们，我们很难锁定它。', { kind: 'report', at: p, lv: 1, delay: 6 });
}
// 歼-36 打击型：每 1.6 秒在 900 以内挑一个已发现的高价值目标投一枚雷石-6 滑翔制导炸弹（防空 > 发射车 > 机场跑道 > 岸炮 / 炮兵 > 装甲）
const AW_J36E = { aa: 9, tel: 9, ascm: 9, airfield: 7.5, coastal: 7, arty: 6.5, mortar: 4, bunker: 4 }, AW_J36V = { sam_veh: 9.5, aa_veh: 8.5, spg: 6, hv_tank: 5.5, tank: 5, td: 5, flame_tank: 5, apc: 3.5 };
function awJ36Strike(p, sp) {
  if (!(p.agmN > 0) || (p.agmT || 0) > S.t || p.alt < .6 || typeof msPgm !== 'function') return;
  p.agmT = S.t + 1.6;
  const own = (x, y) => S.teams.some(q => q.side === 'p' && q.men.length && dist(q.x, q.y, x, y) < 45);
  const flying = (k, id) => S.missiles.some(m => m.kind === 'pgm' && !m.done && m.side === 'p' && m.tgt && m.tgt.k === k && m.tgt.id === id);
  const known = o => o.kx != null || inVision(o.x, o.y) || (o.seen != null && S.t - o.seen < 60);
  let best = null, bs = 0;
  const cand = (k, o, v) => {
    if (!v) return;
    const d = dist(p.x, p.y, o.x, o.y);
    if (d > sp.agmR || !known(o) || own(o.x, o.y) || flying(k, o.id) || (o.kind === 'airfield' && o.cratT > S.t)) return;   // 跑道刚炸坏的机场等修好再炸
    const s = v / (1 + d / 900);
    if (s > bs) { bs = s; best = { k, id: o.id, x: o.x, y: o.y, o }; }
  };
  for (const e of S.enemies) if (!e.dead && !(e.kind === 'airfield' && typeof abKeep === 'function' && abKeep())) cand('enemy', e, AW_J36E[e.kind]);
  for (const v of S.veh || []) if (v.side === 'e' && !v.dead) cand('veh', v, AW_J36V[v.type]);
  if (!best) return;
  msPgm(sp.agm, 'p', p.x, p.y, best, 'j36');
  p.agmN--;
  awStat('j36Bomb');
  const nm = best.k === 'veh' ? (typeof vehName === 'function' ? vehName(best.o) : '敌战车') : best.o.kind === 'airfield' ? '敌机场跑道' : (ENEMY_SPEC[best.o.kind] || {}).name || '目标';
  log(`歼-36 投下${MS_PGM[sp.agm].nm}，打击${nm}（余 ${p.agmN} 枚）`, 'info', 'j36b' + p.id, 2, best);
}
// —— 守方歼击机（eair.js eaStep 调用）：同上；返航沿用 eair.js 的进近着陆 ——
function awFlyE(a, dt) {
  if (a.ph !== 'out' && a.ph !== 'cap') { eaRtb(a, dt); return; }
  const sp = EA_SPEC[a.type] || EA_SPEC.ftr;
  a.alt = Math.min(.9, a.alt + dt * .4);
  a.gunT = Math.max(0, (a.gunT || 0) - dt);
  awFight(a, 'e', dt);
  const T = a.tg && awTgt(a.tg);
  if (!T && a.sdb > 0 && (a.sdbT || 0) <= S.t) awSdbE(a);
  const mv = T && sp.stealth ? awBvrMove(a, T) : null;
  if (mv) { a.spd += clamp(sp.spd * mv[2] - a.spd, -60 * dt, 50 * dt); eaSteer(a, clamp(mv[0], 40, W - 40), clamp(mv[1], 40, H - 40), dt); }
  else if (T) { a.spd += clamp(sp.spd * 1.12 - a.spd, -60 * dt, 50 * dt); awPursue(a, T, dt, sp.turn); }
  else if (awFleetCover(a.x, a.y, 30)) { a.spd += clamp(sp.spd * 1.1 - a.spd, -60 * dt, 50 * dt); eaSteer(a, a.cx, a.cy, dt); if (!a.brk) { a.brk = true; awStat('ftrBreakE'); } }   // 误入我舰队防空伞：加速脱离
  else if ((a.ph === 'out' || a.ph === 'cap') && a.lead != null && eaForm(a, dt)) { /* 跟着长机保持编队（扫荡航段也一起飞） */ }
  else if (a.ph === 'out') { if (eaSteer(a, a.cx, a.cy, dt, a.join > S.t ? sp.spd * .75 : undefined) < AW_CAP + 40) { a.ph = 'cap'; a.leg2 = atoLeg(a, a.cx, a.cy, ATO_LEG.ftr); } }
  else {   // 扫荡航段：沿岸线直飞一段，飞完返航（不兜圈子）
    if (!a.leg2) a.leg2 = atoLeg(a, a.x, a.y, ATO_LEG.ftr);
    if (eaSteer(a, a.leg2.x, a.leg2.y, dt, sp.spd * .8) < 90) a.ph = 'rtb';
  }
  if (!T && a.fired != null && S.t - a.fired > 4) a.ph = 'rtb';   // 打完一波就返航
  if (a.ph === 'cap' && (a.capT -= dt) <= 0) a.ph = 'rtb';
  else if (!(a.aam > 0) && (sp.stealth || !(a.gun > 0))) a.ph = 'rtb';
}

// —— 守方派歼击机（每秒）：发现敌机就起飞拦截（敌机越多、有敌战斗机时派得越多，最多 3 架）；近 2 分钟见过敌机就保持一架巡逻；
//    跑道被炸则等抢修。巡逻点：敌机群形心，没有时取受威胁最大的据点向海一侧 ——
function awThinkE() {
  const E = S.eair;
  if (!E || typeof eaOpen !== 'function' || !(typeof eaOn === 'function' && eaOn())) return;
  const ready = E.wing.filter(w => eaFtr(w.type) && w.state === 'ready'), open = eaOpen(), A = awEnsure();
  const seen = awFoes('e').filter(t => awSeen('e', t.x, t.y));
  if (seen.length) A.seenP = S.t;
  const foes = seen.filter(t => !awFleetCover(t.x, t.y, AW_CAP));   // 在我舰队防空伞里（刚起飞、正着舰）的不去拦
  if (!ready.length || !open.length) return;
  // 有敌战斗机时 F-22A 打头阵；平时巡逻先派 F-35A，F-22A 留着对付敌战斗机
  const vsF = foes.some(t => t.ftr);
  ready.sort((a, b) => ((b.type === 'f22') - (a.type === 'f22')) * (vsF ? 1 : -1));
  const up = E.fly.filter(a => !a.dead && eaFtr(a.type) && (a.ph === 'out' || a.ph === 'cap' || a.ph === 'roll')).length;
  const g5 = S.ai && S.ai.g5 && (S.ai.g5.st === 'prep' || S.ai.g5.st === 'go');
  const want = Math.max(g5 ? 2 : 0, typeof atoPhase === 'function' && atoPhase('e') === 1 && atoFtrP() ? 2 : 0, foes.length ? Math.min(4, Math.ceil(foes.length / 2) + (foes.some(t => t.ftr) ? 2 : 0)) : S.t - A.seenP < 120 ? (ready.length + up >= 4 ? 2 : 1) : 0);   // 敌机越多、有敌战斗机时派得越多（最多 4 架）；总攻时至少双机掩护
  if (up >= want || S.t - A.lnE < 3) return;
  let cx, cy;
  if (foes.length) { cx = foes.reduce((s, t) => s + t.x, 0) / foes.length; cy = foes.reduce((s, t) => s + t.y, 0) / foes.length; }
  else ({ x: cx, y: cy } = awCapE());
  if (awFleetCover(cx, cy, AW_CAP)) ({ x: cx, y: cy } = awCapE());
  cx = clamp(cx, 60, W - 60); cy = clamp(cy, 60, H - 60);
  // 编队：派出的都是在册飞机——待命的有两架以上就成双机起飞（最多四机），只剩一架就单机（挂载按型号见 EA_FTR）
  const n = Math.min(ready.length, 4, Math.max(2, want - up)), fl = ready.slice(0, n);
  let lead = null;
  for (let i = 0; i < n; i++) {
    const w = fl[i], L = EA_FTR[w.type], b = eaNearBase(cx, cy, open), a = eaNewAir(b, w, cx, cy, { cx, cy, capT: 80, aam: L.aam, gun: L.gun, aamR: L.aamR, pkK: L.pkK, gunK: L.gunK || 1, odir: i ? -1 : 1 });
    if (i) { a.lead = lead.id; a.slot = i; } else { lead = a; a.join = S.t + (a.wait || 0) + 3 + 3.5 * (n - 1); }   // 双机 / 四机编队（eair.js eaForm）
    w.state = 'out';
    E.fly.push(a);
  }
  A.lnE = S.t;
  awStat('ftrE', n);
  if (fl.some(w => w.type === 'f22')) awStat('f22E');
  const nm = [...new Set(fl.map(w => EA_SPEC[w.type].name))].join('与');
  if (typeof chatSay === 'function') chatSay('e', foes.length ? `命令：${nm}${n > 3 ? '四机' : n > 2 ? '三机' : n > 1 ? '双机' : '一个架次'}紧急起飞，拦截${awWhere(cx, cy)}上空的敌机（${foes.length} 架）。` : `命令：${nm}${n > 3 ? '四机' : n > 2 ? '三机' : n > 1 ? '双机' : '一个架次'}起飞，在${awWhere(cx, cy)}上空巡逻，掩护防区。`, { kind: 'order', at: { x: cx, y: cy }, key: 'awE', gap: 15, lv: 1 });
}
// —— 守方综合打击群（美军 COMAO：扫荡 + 防空压制 + 护航 + 打击）：攻击机 / 武装直升机编队出击时（eair.js eaPkg 调用），
//    F-22A 先前出扫荡目标空域，F-35A 随队护航，并用 GBU-53/B 小直径炸弹在防区外先打目标附近的我方防空车（awSdbE）；
//    目标 320 以内已有歼击机在巡逻就不重复派。返回派出的架次 ——
function awEscortE(x, y, nm, pl) {   // pl：被护航编队的长机（攻击机编队时护航机编入其队形）
  const E = S.eair;
  if (!E || typeof eaOpen !== 'function' || !(typeof eaOn === 'function' && eaOn())) return 0;
  const open = eaOpen();
  if (!open.length) return 0;
  const up = E.fly.filter(a => !a.dead && eaFtr(a.type) && ['roll', 'out', 'cap'].includes(a.ph) && dist(a.cx, a.cy, x, y) < 320).length;
  if (up >= 2) return 0;
  const ready = E.wing.filter(w => eaFtr(w.type) && w.state === 'ready');
  if (!ready.length) return 0;
  const sw = ready.find(w => w.type === 'f22'), es = ready.find(w => w.type === 'ftr') || ready.find(w => w !== sw);
  const fl = [sw, es].filter(Boolean).filter((w, i, a) => a.indexOf(w) === i).slice(0, 2 - up);
  let cx = clamp(x, 60, W - 60), cy = clamp(y, 60, H - 60);
  const b = eaNearBase(cx, cy, open);
  for (let i = 0; i < 12 && awFleetCover(cx, cy, AW_CAP); i++) { const l = Math.max(1, dist(cx, cy, b.x, b.y)); cx += (b.x - cx) / l * 60; cy += (b.y - cy) / l * 60; }   // 巡逻点不设在我舰队防空伞里
  // 在册的护航机：F-22A 前出扫荡，F-35A 随队护航
  fl.forEach((w, i) => {
    const L = EA_FTR[w.type], sweep = w.type === 'f22' && fl.length > 1 && i === 0;
    const a = eaNewAir(b, w, cx, cy, { cx: sweep ? clamp(cx, 60, W - 60) : cx, cy: sweep ? clamp(cy + 90, 60, H - 60) : cy, capT: 75, aam: L.aam, gun: L.gun, aamR: L.aamR, pkK: L.pkK, gunK: L.gunK || 1, odir: i ? -1 : 1, role: sweep ? 'sweep' : 'esc', sdb: w.type === 'ftr' ? 4 : 0 });
    if (!sweep && pl && pl.type === 'ga' && !pl.dead) { a.lead = pl.id; a.slot = 4; }   // 随队护航：在攻击机编队左后方（eaForm 槽位 4）
    w.state = 'out';
    E.fly.push(a);
  });
  if (!fl.length) return 0;
  awEscSay(fl, cx, cy, nm);
  return fl.length;
}
function awEscSay(fl, x, y, nm) {
  awStat('escE', fl.length);
  if (typeof chatSay !== 'function') return;
  const t = fl.map((w, i) => w.type === 'f22' && fl.length > 1 && i === 0 ? 'F-22A 前出扫荡目标空域' : `${EA_SPEC[w.type].name}随队护航${w.type === 'ftr' ? '、以小直径炸弹先打敌防空车' : ''}`).join('，');
  chatSay('e', `命令：综合打击群编成——${t}，掩护${nm || '攻击编队'}，不让敌战斗机和防空武器各个击破我攻击机。`, { kind: 'order', at: { x, y }, key: 'awEsc', gap: 15, lv: 1 });
}
// F-35A 防区外压制防空：420 以内、我方看得见的敌防空车（弹炮 / 导弹防空车、近防炮车），一次一枚，间隔 2.5 秒
function awSdbE(a) {
  a.sdbT = S.t + 1;
  if (typeof msPgm !== 'function' || (typeof atoOk === 'function' && !atoOk('e', 'sdb', true))) return;   // 空中作战计划：第一阶段只争制空权
  let best = null, bd = 420;
  for (const v of S.veh || []) {
    if (v.side !== 'p' || v.dead || (v.type !== 'aa_veh' && v.type !== 'sam_veh') || !spotted(v.x, v.y)) continue;
    if (S.missiles.some(m => m.kind === 'pgm' && !m.done && m.side === 'e' && m.tgt && m.tgt.k === 'veh' && m.tgt.id === v.id)) continue;
    const d = dist(a.x, a.y, v.x, v.y);
    if (d < bd) { bd = d; best = v; }
  }
  if (!best) return;
  msPgm('gbu53', 'e', a.x, a.y, { k: 'veh', id: best.id, x: best.x, y: best.y }, 'f35');
  a.sdb--; a.sdbT = S.t + 2.5;
  awStat('sdbE');
  log(`敌 F-35A 投下 GBU-53/B 小直径炸弹，攻击我${typeof vehName === 'function' ? vehName(best) : '防空车'}`, 'bad', 'sdbE', 6, best);
}
function awCapE() {
  const G = S.ai && S.ai.g5;
  if (G && G.key && (G.st === 'prep' || G.st === 'go')) return { x: G.tx, y: Math.min(G.ty + 80, coastAt(G.tx) + 60) };   // 总攻时：在主攻目标上空掩护
  const bg = typeof brIsAA === 'function' ? awCapBG('e') : null;
  if (bg) return { x: clamp(bg.x, 60, W - 60), y: Math.min(bg.y, coastAt(clamp(bg.x, 0, W - 1)) + 60) };   // 没有伴随防空的机动营 / 团：在它上空掩护
  const thr = S.ai && S.ai.co && S.ai.co.thr;
  let best = null, bt = 0;
  if (thr) for (const p of S.points) { const T = thr[p.key]; if (T && T[2] > bt) { bt = T[2]; best = p; } }
  const p = best || S.points.find(p => p.key === 'HQ') || S.points[0];
  return { x: p.x, y: Math.min(p.y + (best ? 150 : 300), coastAt(p.x) + 100) };
}
// —— 进攻方派战斗机（航母自动派机时，carrier.js updateAirAuto 每 3 秒先问这里；返回 true 表示本轮已派机）：
//    发现敌机就拦截；已知敌机场或近 2 分钟见过敌机，就在登陆场上空保持一架巡逻；敌方掌握制空权时至少两架 ——
function awAutoP() {
  if (!S.air || !(S.assets.fighter > 0)) return false;
  const A = awEnsure(), foes = awFoes('p').filter(t => awSeen('p', t.x, t.y));
  if (foes.length) A.seenE = S.t;
  const up = S.planes.filter(p => !p.dead && p.kind === 'fighter' && ['cat', 'roll', 'out', 'loiter'].includes(p.phase)).length;
  const known = S.enemies.some(e => e.kind === 'airfield' && !e.dead && e.kx != null);
  let want = foes.length ? Math.min(3, Math.ceil(foes.length / 2) + (foes.some(t => t.ftr) ? 1 : 0)) : known || S.t - A.seenE < 120 ? 1 : 0;
  if (A.st === 'e') want = Math.max(want, 2);
  if (typeof atoPhase === 'function' && atoPhase('p') === 1) want = Math.max(want, 2);   // 夺取制空权阶段：至少一个双机编队在空
  if (up >= want) return false;
  let cx, cy;
  if (foes.length) { cx = foes.reduce((s, t) => s + t.x, 0) / foes.length; cy = foes.reduce((s, t) => s + t.y, 0) / foes.length; }
  else ({ x: cx, y: cy } = awCapP());
  cx = clamp(cx, 60, W - 60); cy = clamp(cy, 60, H - 60);
  if (!launchPlane('fighter', cx, cy)) return false;
  awStat('ftrP');
  const lead = S.planes[S.planes.length - 1];
  if (typeof atoWing === 'function' && want - up >= 2) atoWing(lead, 'fighter', cx, cy);   // 双机编队：长机带僚机
  const nm = typeof airName === 'function' ? airName('fighter', (S.planes[S.planes.length - 1] || {}).v) : '战斗机';
  if (typeof chatSay === 'function') chatSay('p', foes.length ? `命令：${nm}起飞，拦截${awWhere(cx, cy)}上空的敌机（${foes.length} 架）。` : `命令：${nm}起飞，在${awWhere(cx, cy)}上空巡逻，掩护登陆场与对地支援机。`, { kind: 'order', at: { x: cx, y: cy }, key: 'awP', gap: 15, lv: 1 });
  return true;
}
// 进攻方巡逻点：岸上步兵形心以北 200（掩护登陆场）；还没上岸时取主攻滩头上空
// 没有伴随防空的战斗群在行军 / 接敌：巡逻点设在它上空（brain.js 编组时报「请航空兵掩护」）
function awCapBG(side) {
  const G = (S.bgs || []).find(o => o.side === side && o.br && !o.dead && (o.st === 'move' || o.st === 'fight') && !bgVehs(o).some(brIsAA) && !bgUnits(o).some(u => teamsOf(u).some(brTAA)));
  return G ? { x: G.ax, y: G.ay + (side === 'p' ? -120 : 120) } : null;
}
function awCapP() {
  const bg = typeof brIsAA === 'function' ? awCapBG('p') : null;
  if (bg) return { x: clamp(bg.x, 60, W - 60), y: clamp(bg.y, 60, H - 60) };
  const inf = S.teams.filter(q => q.side === 'p' && q.men.length && isLand(q.x, q.y));
  if (inf.length) return { x: inf.reduce((s, q) => s + q.x, 0) / inf.length, y: Math.max(60, inf.reduce((s, q) => s + q.y, 0) / inf.length - 200) };
  const B = TER.beaches || [], pl = S.cmd && S.cmd.p && S.cmd.p.plan, b = pl && pl.main >= 0 ? B[pl.main] : B[0];
  return b ? { x: b.cx, y: coastAt(b.cx) - 150 } : { x: W / 2, y: H / 2 };
}

// —— 制空权（每秒）：在空巡逻 / 拦截的战斗机实力 = 每架 1（先进型 1.3）×（.55 + .45 × 导弹余量比例）；在地面待命、随时能起飞的按 .35 计，
//    起飞、返航、整备中的按 .2 计——一方的战斗机打光了，另一方哪怕都在整备也掌握制空权；双方都没有战斗机时回到均势 ——
function awUpdate(dt) {
  if (!S || S.phase !== 'battle') return;
  const A = awEnsure();
  if (S.eair) for (const a of S.eair.fly) if (!a.dead && !a.pv && awSeen('p', a.x, a.y)) a.pv = true;   // 机载 / 舰载雷达发现的敌机也显示（eaAA 每 0.5 秒按视野重算）
  if ((A.exT = (A.exT || 0) - dt) <= 0) { A.exT = AW_EXP.every; awExpose(AW_EXP.every); }
  if ((A.thT -= dt) > 0) return;
  A.thT = 1;
  awThinkE();
  // 战斗机实力：歼-20（隐身、霹雳-15）1.3，F-35A 1.25，F-22A 1.75，歼-36 2.2；乘弹药余量
  const pw = (o, k, a0) => k * (.55 + .45 * clamp((o.aam ?? a0) / a0, 0, 1));
  let P = 0, E = 0;
  for (const p of S.planes || []) if (!p.dead && p.kind === 'fighter') P += p.alt > .3 && (p.phase === 'out' || p.phase === 'loiter') ? (p.radar > 700 ? 2.2 : 1.3) * (.55 + .45 * clamp(((p.aam || 0) + (p.aamL || 0)) / (p.aam0 || 6), 0, 1)) : .2;   // 歼-36 2.2
  if (S.eair) for (const a of S.eair.fly) if (!a.dead && eaFtr(a.type)) E += a.alt > .2 && (a.ph === 'out' || a.ph === 'cap') ? pw(a, EA_FTR[a.type].pw, EA_FTR[a.type].aam) : .2;
  const cvOk = typeof cvAll === 'function' && cvAll().some(c => c.hp > 0), rwOk = typeof eaOpen === 'function' && eaOpen().length > 0;
  if (S.air) for (const w of S.air.wing) if (w.type === 'fighter' && (cvOk || (typeof airLandW === 'function' && airLandW(w)))) P += (w.state === 'deck' ? .35 : w.state === 'rearm' ? .2 : 0) * (w.v === 'j36' || w.v === 'j36s' ? 2.2 : 1.3);
  if (S.eair) for (const w of S.eair.wing) if (eaFtr(w.type)) E += w.state === 'ready' ? (rwOk ? EA_FTR[w.type].pw0 : .1) : w.state === 'rearm' ? .2 : 0;
  A.v += ((P + E > 0 ? (P - E) / (P + E) : 0) - A.v) / 8;   // 约 8 秒的低通：空战胜负要打一会儿才见分晓
  // 迟滞：取得制空权要过 ±0.45，已掌握的一方跌破 ±0.3 才转为争夺，免得在门槛附近来回报
  const keep = A.st === 'p' ? .3 : .45, keepE = A.st === 'e' ? .3 : .45;
  // 双方的战斗机都已损失（打过空战、现在一架不剩）：n 无人掌握
  const st = !(P + E > 0 || A.k.p + A.k.e > 0) ? null : P + E === 0 ? 'n' : A.v >= keep ? 'p' : A.v <= -keepE ? 'e' : 'c';
  if (st !== A.st) awSay(A.st, st);
  A.st = st;
}
function awSay(prev, st) {
  const say = typeof chatSay === 'function' ? chatSay : () => null;
  if (st === 'p') {
    log('我方掌握战场制空权，敌攻击机与直升机难以出动', 'good', 'awst', 10);
    say('p', prev == null ? '判断：敌方空中力量薄弱，我战斗机掌握战场制空权，对地支援机、攻击机可以放手出动。' : '报告：我战斗机已控制战场上空，夺取制空权。', { kind: prev == null ? 'plan' : 'report', key: 'awp', gap: 30 });
    say('e', '判断：敌战斗机控制战场上空。决心：攻击机与直升机非必要不出动，待歼击机夺回制空权。', { kind: 'plan', key: 'awe1', gap: 60, lv: 1 });
  } else if (st === 'e') {
    log('敌方夺取制空权：我空中支援将遭拦截', 'bad', 'awst', 10);
    say('p', '判断：敌歼击机控制战场上空。决心：攻击机、轰炸机暂缓出动，先以战斗机夺回制空权，对地支援机须有战斗机掩护。', { kind: 'plan', key: 'awp2', gap: 30 });
    say('e', '报告：我歼击机已控制战场上空，攻击机与直升机加紧出击。', { kind: 'report', key: 'awe2', gap: 60, lv: 1 });
  } else if (st === 'c' && prev) {
    log('制空权争夺中', 'warn', 'awst', 10);
    say('p', '报告：双方战斗机正在争夺战场制空权。', { kind: 'report', key: 'awp3', gap: 40, lv: 1 });
  } else if (st === 'n') {
    log('双方战斗机均已损失，战场上空无人掌握制空权', 'warn', 'awst', 10);
    say('p', '报告：双方战斗机均已损失，战场上空无人掌握制空权；对地支援机注意敌防空火力。', { kind: 'report', key: 'awp4', gap: 40, lv: 1 });
  }
}

// —— 界面：据点条下方的制空权条（左绿右红，白色游标为当前态势）；没有任何战斗机时不显示 ——
const AW_UI = { el: null, t: 0 };
function awHud() {
  if (typeof document === 'undefined' || typeof $ !== 'function' || !$('stage')) return;
  let el = AW_UI.el;
  if (!el) {
    el = AW_UI.el = document.createElement('div');
    el.id = 'airsup'; el.className = 'ov box'; el.hidden = true; el.setAttribute('aria-label', '制空权');
    el.innerHTML = `<svg viewBox="0 0 24 24" class="ic" aria-hidden="true">${AW_ICON}</svg><b>制空权</b><span class="aw-bar"><i></i></span><em></em>`;
    const st = document.createElement('style');
    st.textContent = `#airsup { left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 8px; padding: 3px 10px; font-size: 12px; pointer-events: none; }
#airsup[hidden] { display: none; } #airsup .ic { width: 16px; height: 16px; } #airsup b { font-weight: 400; color: var(--mute); }
#airsup .aw-bar { position: relative; width: 140px; height: 6px; border-radius: 3px; border: 1px solid var(--line);
  background: linear-gradient(90deg, rgba(var(--g-rgb), .6), rgba(var(--g-rgb), .08) 36%, rgba(var(--amber-rgb), .14) 50%, rgba(var(--enemy-rgb), .08) 64%, rgba(var(--enemy-rgb), .6)); }
#airsup .aw-bar i { position: absolute; top: -4px; width: 3px; height: 12px; margin-left: -1.5px; background: #fff; box-shadow: 0 0 6px #fff; border-radius: 1px; transition: left .25s; }
#airsup em { font-style: normal; min-width: 4.5em; } #airsup.p em { color: var(--g); } #airsup.e em { color: var(--enemy); } #airsup.c em { color: var(--amber); } #airsup.n em { color: var(--mute); }`;
    document.head.appendChild(st);
    $('stage').appendChild(el);
  }
  const A = S && S.airw, show = !!(A && A.st && S.phase === 'battle');
  if (el.hidden !== !show) el.hidden = !show;
  if (!show) return;
  const now = performance.now();
  if (now - AW_UI.t < 250) return;
  AW_UI.t = now;
  const o = $('objs'), r = o && o.getBoundingClientRect(), top = (r && r.height ? Math.round(r.bottom + 6) : 56) + 'px';
  if (el.style.top !== top) el.style.top = top;
  const pb = $('pauseBand'), pt = Math.round(el.getBoundingClientRect().bottom + 6) + 'px';   // 暂停条放到制空权条下面，不叠在一起
  if (pb && pb.style.top !== pt) pb.style.top = pt;
  el.className = 'ov box ' + A.st;
  el.querySelector('i').style.left = (50 - A.v * 50).toFixed(1) + '%';   // v = +1（我方）在左端
  const t = A.st === 'p' ? '我方掌握' : A.st === 'e' ? '敌方掌握' : A.st === 'n' ? '无人掌握' : '争夺中', em = el.querySelector('em');
  if (em.textContent !== t) em.textContent = t;
}

// —— 绘制：进攻方战斗机的巡逻圈（青色虚线缓转，外圈弧为剩余巡逻时间）与锁定线；守方歼击机的巡逻圈只在观战时画，锁定线在看得见时画 ——
function awDraw(time) {
  if (!S || typeof R !== 'object' || !R.ctx) return;
  const ctx = R.ctx, spec = S.role === 'spectate';
  ctx.save(); ctx.lineWidth = px(1.1);
  for (const p of S.planes || []) {
    if (p.dead || p.kind !== 'fighter') continue;
    if (p.phase === 'loiter' || p.phase === 'out') {
      ctx.strokeStyle = rgba(COL.intel, .3); ctx.setLineDash([px(6), px(6)]); ctx.lineDashOffset = -time * 14;
      ctx.beginPath(); ctx.arc(p.cx, p.cy, AW_CAP, 0, 6.283); ctx.stroke();
      if (p.phase === 'loiter') { ctx.strokeStyle = rgba(COL.intel, .6); ctx.lineWidth = px(1.8); ctx.setLineDash([]); ctx.beginPath(); ctx.arc(p.cx, p.cy, AW_CAP + 8, -1.57, -1.57 + clamp(p.capT / 90, 0, 1) * 6.283); ctx.stroke(); ctx.lineWidth = px(1.1); }
    }
    const T = p.tg && awTgt(p.tg);
    if (T) { ctx.strokeStyle = rgba(COL.intel, .45); ctx.setLineDash([px(2), px(4)]); ctx.lineDashOffset = 0; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(T.x, T.y); ctx.stroke(); }
  }
  if (S.eair) for (const a of S.eair.fly) {
    if (a.dead || !eaFtr(a.type) || !(spec || a.pv)) continue;
    if (spec && (a.ph === 'cap' || a.ph === 'out')) { ctx.strokeStyle = rgba(COL.enemy, .25); ctx.setLineDash([px(6), px(6)]); ctx.lineDashOffset = time * 14; ctx.beginPath(); ctx.arc(a.cx, a.cy, AW_CAP, 0, 6.283); ctx.stroke(); }
    const T = a.tg && awTgt(a.tg);
    if (T) { ctx.strokeStyle = rgba(COL.enemy, .4); ctx.setLineDash([px(2), px(4)]); ctx.lineDashOffset = 0; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(T.x, T.y); ctx.stroke(); }
  }
  ctx.restore();
}

HOOK.step.push(awUpdate);
HOOK.frame.push(function awHudHook() { awHud(); });
HOOK.drawOver.push(awDraw);
HOOK.newGame.push(() => { if (S) S.airw = null; });
