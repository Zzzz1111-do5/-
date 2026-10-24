'use strict';
// 空战与制空权（v7）：进攻方舰载战斗机（carrier.js，kind = fighter）与守方歼击机（eair.js，type = ftr）
// 在指定空域巡逻（CAP），拦截对方飞机：中距空空导弹（missile.js 飞行与结算，src = aam）与近距机炮，双方战斗机互相缠斗。
// 制空权：双方在空战斗机实力（含导弹余量；在地面待命的按三分之一计）之比，平滑后 ≥ .45 我方掌握、≤ −.45 敌方掌握、其余为争夺；
//   掌握制空权的一方，对方的攻击机 / 直升机 / 轰炸机出动受限（AI 等护航或只打高价值目标），而且会被巡逻的战斗机拦截。
// 界面：据点条下方的制空权条；支援栏「战斗机」按钮（W）在指定空域巡逻；航母自动派机时 AI 自动派战斗机，守方机场自动派歼击机。
// 状态：S.airw = { v1, v 制空权 −1..1, st 'p' | 'e' | 'c' | null, k: {p, e} 空战击落数, seenP / seenE 最近发现对方飞机的时刻, thT, lnE, said }
const AW_RNG = 700, AW_CAP = 160, AW_LEASH = 950;   // 拦截搜索半径 · 巡逻圈半径 · 目标离巡逻中心多远就不再追（不被诱离防区）
const AW_PK = { fighter: .42, ftr: .42, recon: .62, strike: .55, cas: .55, ga: .55, bomber: .6, heli: .5 };   // 空空导弹单发命中率（干扰弹另算）
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
  if (side === 'e') { for (const p of S.planes || []) if (!p.dead && p.alt > .25 && !['cat', 'roll', 'trap', 'final'].includes(p.phase) && p.kind !== 'transport') out.push({ o: p, k: 'plane', type: p.kind, x: p.x, y: p.y, ftr: p.kind === 'fighter', st: typeof airStealth === 'function' ? airStealth(p) : 1 }); }
  else if (S.eair) for (const a of S.eair.fly) if (!a.dead && a.alt > .1 && !['roll', 'land', 'final'].includes(a.ph)) out.push({ o: a, k: 'eair', type: a.type, x: a.x, y: a.y, ftr: a.type === 'ftr', st: (EA_SPEC[a.type] && EA_SPEC[a.type].stealth) || 1 });
  return out;
}
// side 方是否发现了 (x, y) 处的飞机：进攻方 = 视野、战斗机机载雷达 520、驱逐舰 720、航母 600；守方 = 视野、雷达站 820、歼击机 520、机场 450、沙盒雷达站
// st：目标的隐身系数（歼-20 0.35、歼-35 0.4、F-35A 0.45……）——雷达发现距离乘 st × 1.2（不超过原距离），目视发现不受影响
function awSeen(side, x, y, st = 1) {
  const k = Math.min(1, st * 1.2);
  if (side === 'p') {
    if (inVision(x, y)) return true;
    for (const p of S.planes || []) if (!p.dead && p.kind === 'fighter' && p.alt > .3 && dist(p.x, p.y, x, y) < 520 * k) return true;
    if (typeof msDefShips === 'function') for (const s of msDefShips()) if (dist(s.x, s.y, x, y) < 720 * k) return true;
    if (typeof cvAll === 'function') for (const c of cvAll()) if (c.hp > 0 && dist(c.x, c.y, x, y) < 600 * k) return true;
    return false;
  }
  if (spotted(x, y)) return true;
  const rd = typeof radarUp === 'function' ? radarUp() : null;
  if (rd && dist(rd.x, rd.y, x, y) < 820 * k) return true;
  if (S.eair) for (const a of S.eair.fly) if (!a.dead && a.type === 'ftr' && a.alt > .2 && dist(a.x, a.y, x, y) < 520 * k) return true;
  if (typeof eaBases === 'function') for (const b of eaBases()) if (dist(b.x, b.y, x, y) < 450 * k) return true;
  for (const o of S.sbxObs || []) if (!o.dead && o.kind === 'e_radar' && dist(o.x, o.y, x, y) < o.r * 1.4 * k) return true;
  return false;
}
// 我方舰队防空伞：驱逐舰舰空导弹 650（护航舰 550）、航母 450 以内（m 为外扩余量）；舰空导弹打光的舰不算
// 守方歼击机不追进来、不在里面设巡逻点，守方攻击机 / 直升机也不单机闯进来送
function awFleetCover(x, y, m = 0) {
  if (typeof msDefShips === 'function') for (const s of msDefShips()) if ((typeof vlsHas !== 'function' || vlsHas(s.o, 'sam')) && dist(s.x, s.y, x, y) < (s.esc ? 550 : 650) + m) return true;
  if (typeof cvAll === 'function') for (const c of cvAll()) if (c.hp > 0 && dist(c.x, c.y, x, y) < 450 + m) return true;
  return false;
}
// 追踪：瞄准目标的提前位置（按目标速度与距离，最多 1.2 秒），转弯率 turn（战斗机比攻击机灵活）
function awPursue(f, T, dt, turn) {
  const d = dist(f.x, f.y, T.x, T.y), lead = Math.min(1.2, d / Math.max(120, f.spd * 1.5)), h = T.heading ?? 0, v = T.spd || 0;
  const tx = clamp(T.x + Math.cos(h) * v * lead, 20, W - 20), ty = clamp(T.y + Math.sin(h) * v * lead, 20, H - 20);
  const tr = clamp(awAng(Math.atan2(ty - f.y, tx - f.x) - f.heading), -turn * dt, turn * dt);
  f.heading = awAng(f.heading + tr); f.bank = lerp(f.bank || 0, dt > 0 ? tr / (turn * dt) : 0, Math.min(1, dt * 6));
  f.x += Math.cos(f.heading) * f.spd * dt; f.y += Math.sin(f.heading) * f.spd * dt;
}

// —— 空战（每架战斗机每 0.5 秒）：选目标（对方战斗机优先，其次攻击机 / 轰炸机 / 直升机，侦察机最后，同类取近；离巡逻中心太远的不追），
//    中距空空导弹（130–480、机头 ±40° 以内、同一目标同时只打一枚、间隔 3 秒）与近距机炮（95 以内、机头 ±20°）——
function awFight(f, side, dt) {
  if ((f.awT = (f.awT || 0) - dt) > 0) return;
  f.awT = .5;
  const foes = awFoes(side), A = awEnsure();
  let T = null;
  const deep = t => side === 'e' && awFleetCover(t.x, t.y, 60);   // 守方：目标进了我舰队防空伞就放掉，不追进去送
  if (f.tg) { const t = foes.find(o => o.k === f.tg.k && o.o.id === f.tg.id); if (t && awSeen(side, t.x, t.y, t.st) && dist(t.x, t.y, f.cx, f.cy) < AW_LEASH && !deep(t)) T = t; }
  if (!T || S.t - (f.tgT || 0) > 3) {
    let bs = T ? dist(f.x, f.y, T.x, T.y) * (T.ftr ? .6 : .8) : Infinity;
    for (const t of foes) {
      const d = dist(f.x, f.y, t.x, t.y);
      if (d > AW_RNG || dist(t.x, t.y, f.cx, f.cy) > AW_LEASH || !awSeen(side, t.x, t.y, t.st) || deep(t)) continue;
      const s = d * (t.ftr ? .6 : t.type === 'recon' ? 1.1 : .8);
      if (s < bs) { bs = s; T = t; }
    }
    f.tgT = S.t;
  }
  f.tg = T ? { k: T.k, id: T.o.id } : null;
  if (!T) return;
  if (side === 'p') A.seenE = S.t; else A.seenP = S.t;
  const d = dist(f.x, f.y, T.x, T.y), off = Math.abs(awAng(Math.atan2(T.y - f.y, T.x - f.x) - f.heading));
  // 中距弹：射程按弹种（霹雳-15 560、AIM-120 480）；隐身目标难锁定，命中打八五折
  const aR = f.aamR || 480;
  if (f.aam > 0 && d > 130 && d < aR && off < .7 && (f.aamT || 0) <= S.t && !S.missiles.some(m => m.src === 'aam' && m.side === side && !m.done && m.tgt && m.tgt.k === T.k && m.tgt.id === T.o.id)) {
    const pk = (AW_PK[T.type] || .5) * (f.pkK || 1) * (d > aR * .8 ? .85 : 1) * ((T.st || 1) < .6 ? .85 : 1);
    msLaunch('sam', side, f.x, f.y, { x: T.x, y: T.y }, { tgt: { k: T.k, id: T.o.id }, src: 'aam', spd: 640, dur: 2.6, pk });
    f.aam--; f.aamT = S.t + 3;
    awStat(side === 'p' ? 'aamP' : 'aamE');
  }
  if (d < 95 && off < .35 && (f.gun || 0) > 0) {
    f.gun--; f.gunT = .35;
    for (let i = 0; i < 2; i++) tracer(f.x, f.y, T.x + gauss() * 6, T.y + gauss() * 6, side, true);
    if (Math.random() < (T.ftr ? .1 : .17)) {
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
  awFight(p, 'p', dt);
  const T = p.tg && awTgt(p.tg);
  if (T) { speed(sp.spd * 1.12); awPursue(p, T, dt, 2.3); p.ext = false; }
  else if (p.phase === 'out') { speed(sp.spd); if (airSteer(p, p.cx, p.cy, dt) < AW_CAP + 40) { airSet(p, 'loiter'); p.odir = p.odir || 1; } }
  else { speed(150); airOrbit(p, p.cx, p.cy, AW_CAP, p.odir || 1, dt); }
  if (p.phase === 'loiter' && (p.capT -= dt) <= 0) airSet(p, 'rtb');
  else if (!(p.aam > 0) && !(p.gun > 0)) airSet(p, 'rtb');
}
// —— 守方歼击机（eair.js eaStep 调用）：同上；返航沿用 eair.js 的进近着陆 ——
function awFlyE(a, dt) {
  if (a.ph !== 'out' && a.ph !== 'cap') { eaRtb(a, dt); return; }
  const sp = EA_SPEC.ftr;
  a.alt = Math.min(.9, a.alt + dt * .4);
  a.gunT = Math.max(0, (a.gunT || 0) - dt);
  awFight(a, 'e', dt);
  const T = a.tg && awTgt(a.tg);
  if (T) { a.spd += clamp(sp.spd * 1.12 - a.spd, -60 * dt, 50 * dt); awPursue(a, T, dt, sp.turn); }
  else if (awFleetCover(a.x, a.y, 30)) { a.spd += clamp(sp.spd * 1.1 - a.spd, -60 * dt, 50 * dt); eaSteer(a, a.cx, a.cy, dt); if (!a.brk) { a.brk = true; awStat('ftrBreakE'); } }   // 误入我舰队防空伞：加速脱离
  else if (a.ph === 'out') { if (eaSteer(a, a.cx, a.cy, dt) < AW_CAP + 40) a.ph = 'cap'; }
  else { const g = Math.atan2(a.y - a.cy, a.x - a.cx) + .55 * (a.odir || 1); eaSteer(a, a.cx + Math.cos(g) * AW_CAP, a.cy + Math.sin(g) * AW_CAP, dt, 160); }
  if (a.ph === 'cap' && (a.capT -= dt) <= 0) a.ph = 'rtb';
  else if (!(a.aam > 0) && !(a.gun > 0)) a.ph = 'rtb';
}

// —— 守方派歼击机（每秒）：发现敌机就起飞拦截（敌机越多、有敌战斗机时派得越多，最多 3 架）；近 2 分钟见过敌机就保持一架巡逻；
//    跑道被炸则等抢修。巡逻点：敌机群形心，没有时取受威胁最大的据点向海一侧 ——
function awThinkE() {
  const E = S.eair;
  if (!E || typeof eaOpen !== 'function' || !(typeof eaOn === 'function' && eaOn())) return;
  const ready = E.wing.filter(w => w.type === 'ftr' && w.state === 'ready'), open = eaOpen(), A = awEnsure();
  const seen = awFoes('e').filter(t => awSeen('e', t.x, t.y));
  if (seen.length) A.seenP = S.t;
  const foes = seen.filter(t => !awFleetCover(t.x, t.y, AW_CAP));   // 在我舰队防空伞里（刚起飞、正着舰）的不去拦
  if (!ready.length || !open.length) return;
  const up = E.fly.filter(a => !a.dead && a.type === 'ftr' && (a.ph === 'out' || a.ph === 'cap' || a.ph === 'roll')).length;
  const want = foes.length ? Math.min(3, Math.ceil(foes.length / 2) + (foes.some(t => t.ftr) ? 1 : 0)) : S.t - A.seenP < 120 ? 1 : 0;
  if (up >= want || S.t - A.lnE < 4) return;
  let cx, cy;
  if (foes.length) { cx = foes.reduce((s, t) => s + t.x, 0) / foes.length; cy = foes.reduce((s, t) => s + t.y, 0) / foes.length; }
  else ({ x: cx, y: cy } = awCapE());
  if (awFleetCover(cx, cy, AW_CAP)) ({ x: cx, y: cy } = awCapE());
  cx = clamp(cx, 60, W - 60); cy = clamp(cy, 60, H - 60);
  // 双机编队：要两架以上、或对面有战斗机时，两架一起起飞（F-35A：4 枚 AIM-120D）
  const n = Math.min(ready.length, want - up >= 2 || foes.some(t => t.ftr) ? 2 : 1);
  for (let i = 0; i < n; i++) {
    const w = ready[i], b = eaNearBase(cx, cy, open), a = eaNewAir(b, w, cx, cy, { cx, cy, capT: 80, aam: 4, gun: 30, aamR: 480, pkK: 1.1, odir: i ? -1 : 1 });
    w.state = 'out'; E.fly.push(a);
  }
  A.lnE = S.t;
  awStat('ftrE', n);
  if (typeof chatSay === 'function') chatSay('e', foes.length ? `命令：歼击机${n > 1 ? '双机' : '一个架次'}紧急起飞，拦截${awWhere(cx, cy)}上空的敌机（${foes.length} 架）。` : `命令：歼击机${n > 1 ? '双机' : '一个架次'}起飞，在${awWhere(cx, cy)}上空巡逻，掩护防区。`, { kind: 'order', at: { x: cx, y: cy }, key: 'awE', gap: 15, lv: 1 });
}
function awCapE() {
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
  if (up >= want) return false;
  let cx, cy;
  if (foes.length) { cx = foes.reduce((s, t) => s + t.x, 0) / foes.length; cy = foes.reduce((s, t) => s + t.y, 0) / foes.length; }
  else ({ x: cx, y: cy } = awCapP());
  cx = clamp(cx, 60, W - 60); cy = clamp(cy, 60, H - 60);
  if (!launchPlane('fighter', cx, cy)) return false;
  awStat('ftrP');
  const lead = S.planes[S.planes.length - 1];
  if ((want - up >= 2 || foes.some(t => t.ftr)) && typeof airReady === 'function' && airReady('fighter') && launchPlane('fighter', cx, cy)) { const p = S.planes[S.planes.length - 1]; p.odir = -1; p.pkg = lead.id; lead.pkg = lead.id; awStat('ftrP'); }   // 双机编队
  const nm = typeof airName === 'function' ? airName('fighter', (S.planes[S.planes.length - 1] || {}).v) : '战斗机';
  if (typeof chatSay === 'function') chatSay('p', foes.length ? `命令：${nm}起飞，拦截${awWhere(cx, cy)}上空的敌机（${foes.length} 架）。` : `命令：${nm}起飞，在${awWhere(cx, cy)}上空巡逻，掩护登陆场与对地支援机。`, { kind: 'order', at: { x: cx, y: cy }, key: 'awP', gap: 15, lv: 1 });
  return true;
}
// 进攻方巡逻点：岸上步兵形心以北 200（掩护登陆场）；还没上岸时取主攻滩头上空
function awCapP() {
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
  if ((A.thT -= dt) > 0) return;
  A.thT = 1;
  awThinkE();
  // 战斗机实力：歼-20（隐身、霹雳-15）1.3，F-35A 1.25；乘弹药余量
  const pw = (o, k, a0) => k * (.55 + .45 * clamp((o.aam ?? a0) / a0, 0, 1));
  let P = 0, E = 0;
  for (const p of S.planes || []) if (!p.dead && p.kind === 'fighter') P += p.alt > .3 && (p.phase === 'out' || p.phase === 'loiter') ? pw(p, 1.3, 6) : .2;
  if (S.eair) for (const a of S.eair.fly) if (!a.dead && a.type === 'ftr') E += a.alt > .2 && (a.ph === 'out' || a.ph === 'cap') ? pw(a, 1.25, 4) : .2;
  const cvOk = typeof cvAll === 'function' && cvAll().some(c => c.hp > 0), rwOk = typeof eaOpen === 'function' && eaOpen().length > 0;
  if (S.air) for (const w of S.air.wing) if (w.type === 'fighter' && (cvOk || (typeof airLandW === 'function' && airLandW(w)))) P += (w.state === 'deck' ? .35 : w.state === 'rearm' ? .2 : 0) * 1.3;
  if (S.eair) for (const w of S.eair.wing) if (w.type === 'ftr') E += w.state === 'ready' ? (rwOk ? .35 : .1) : w.state === 'rearm' ? .2 : 0;
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
  background: linear-gradient(90deg, rgba(61, 255, 138, .6), rgba(61, 255, 138, .08) 36%, rgba(255, 194, 74, .14) 50%, rgba(255, 61, 110, .08) 64%, rgba(255, 61, 110, .6)); }
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
    if (a.dead || a.type !== 'ftr' || !(spec || a.pv)) continue;
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
