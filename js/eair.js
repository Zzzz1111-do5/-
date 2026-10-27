'use strict';
// 守方航空（v7）：野战机场 → 对地攻击机（一次通场：6 枚火箭齐射 + 机炮扫射）与武装直升机（300–380 外悬停，反坦克导弹 + 火箭）；
// 双方单兵防空导弹组（防空导弹在 missile.js 飞行与结算）；我方自行高炮、驱逐舰舰空导弹与近防炮、机枪打直升机；
// 守方视野（飞机是视野源）、绘制（剪影、旋翼、火箭、导弹、残骸，只用形状）
// 状态：S.eair = { wing: [{id, type, state: ready|out|rearm|lost, rearmT}], fly: [飞机], proj: [弹药], wr: [残骸], flash: [发射暴露], cratT, nextT, first, gap }
const eaOn = () => !!S && !(S.v7off && S.v7off.air);
const eaStat = (k, n = 1) => { const o = S.v7s || (S.v7s = {}); o[k] = (o[k] || 0) + n; };
POWER.erk = { men: .45, ship: 2, struct: 0, seg: false, R: 18 };   // 机载火箭（守方只打进攻方，不伤自家工事）
// 战役各难度：机队、首次出击时刻、两次出击的间隔（v13 出动更快、机队更大）
const EA_H5 = ['heli', 'heli', 'heli', 'heli', 'heli'];   // 阿帕奇 5 架，一次全部出动
const EA_DIFF = { normal: { wing: [...EA_H5, 'ga'], first: 120, gap: 80 }, hard: { wing: ['ga', 'ga', ...EA_H5, 'ftr', 'ftrb'], first: 80, gap: 50 },
  hell: { wing: ['ga', 'ga', 'ga', ...EA_H5, 'ftr', 'ftrb', 'ftrb', 'f22', 'f22'], first: 55, gap: 35 } };
// 守方（美军）：A-10C 慢而皮实（钛合金座舱浴盆，挨一发还能飞），AH-64E，F-35A 隐身（我方雷达发现距离打折），F-22A 更隐身、超音速巡航、推力矢量
const EA_SPEC = { ga: { name: 'A-10C 攻击机', spd: 170, turn: 1.4, hp: 2, flares: 2 }, heli: { name: 'AH-64E 武装直升机', spd: 90, turn: 2.4, hp: 2, flares: 1 },
  uh60: { name: 'UH-60M 黑鹰运输直升机', spd: 85, turn: 2.2, hp: 2, flares: 1 },
  c17: { name: 'C-17A 环球霸王 III 运输机', spd: 150, turn: .9, hp: 4, flares: 3 },   // 第 101 空降师空降（a101.js）：大、慢、扛打
  ftr: { name: 'F-35A 战斗机', spd: 240, turn: 1.9, hp: 1, flares: 2, stealth: .45 },   // 守方按美军装备命名   // 歼击机：巡逻、拦截、争夺制空权（airwar.js）
  ftrb: { name: 'F-35B 战斗机', spd: 230, turn: 1.8, hp: 1, flares: 2, stealth: .45, vtol: true },   // 短距起飞 / 垂直降落型：不要跑道，从机位、直升机坪或机场外的前沿加油弹药点垂直起降；空空导弹 2 枚 + 小直径炸弹 4 枚
  f22: { name: 'F-22A 猛禽战斗机', spd: 285, turn: 2.4, hp: 1, flares: 3, stealth: .3 },   // 制空专用：6 枚 AIM-120D + 2 枚 AIM-9X、雷达看得更远（airwar.js EA_FTR）
  b2: { name: 'B-2A 幽灵隐身轰炸机', spd: 200, turn: .8, hp: 3, flares: 4, stealth: .1 },
  p8: { name: 'P-8A 海神海上巡逻机', spd: 150, turn: .6, hp: 2, flares: 2, stealth: 1 } };   // 反航母体系的眼睛（antiship.js）：在海岸外高空巡逻，雷达搜索海面   // 从图外远程奔袭（b2.js）：约 12000 米高空，雷达反射截面极小
const eaFtr = t => t === 'ftr' || t === 'ftrb' || t === 'f22';
const eaVtol = t => !!(EA_SPEC[t] && EA_SPEC[t].vtol);   // 垂直起降（F-35B）   // 歼击机（空战由 airwar.js 接管）
// 在巡逻高度上的战斗机（双方）：便携防空导弹、高炮、机枪、近防炮都够不着，只有舰空 / 车载防空导弹和对方战斗机能打
// 攻击-2 察打一体无人机在中空待机（alt > .8）：单兵防空导弹、高炮够不着，只怕防空车的导弹与歼击机
// 高空飞行的空警-600（约 9000 米）、无侦-7（约 18000 米）与高跳低开的运-20（蛟龙突击队，p.halo）：比毒刺类近程防空的射高（约 3800 米）高得多——
//   高炮、单兵防空导弹、弹炮防空车都够不着，只有爱国者等中远程防空（M.hi）与歼击机能打；起降阶段除外
const eaHighUav = o => !!o && o.kind === 'cas' && (!o.v || o.v === 'gj2') && o.alt > .8;
const eaHighAlt = o => !!o && ((o.kind === 'recon' && o.alt > .6) || (o.kind === 'transport' && !!o.halo && o.alt > .5)) && !['cat', 'roll', 'trap', 'final', 'hold'].includes(o.phase);
const eaHigh = o => !!o && (o.kind === 'fighter' ? o.alt > .6 && !['cat', 'roll', 'trap', 'final'].includes(o.phase) : o.kind === 'recon' || o.kind === 'transport' ? eaHighAlt(o) : (eaFtr(o.type) || o.type === 'b2' || o.type === 'p8') && o.alt > .6);   // B-2A 在 12000 米高空；P-8A 在 8000 米巡逻
const EA_SIL = { ga: 'a10', heli: 'ah64', uh60: 'uh60', c17: 'c17', ftr: 'f35', ftrb: 'f35b', f22: 'f22', b2: 'b2', p8: 'c17' };
const eaSil = t => EA_SIL[t] || 'a10';
const EA_TRAILS = new Map();   // 仅渲染用：固定翼尾迹点（不进 S）
const EA_MANPADS = { normal: 0, hard: 1, hell: 2 };   // 战役守军单兵防空组数
const EA_GUNV = ['tank', 'hv_tank', 'td', 'flame_tank', 'lt_tank', 'amtank', 'mine_tank'];
const eaAng = a => Math.atan2(Math.sin(a), Math.cos(a));

// —— 野战机场：版图（跑道、滑行道、机位、直升机坪、设施范围）与绘制在 afbase.js；跑道方向在选址时按地形定（e.rh），营区在离海更远的一侧（e.rs）
// 局部坐标与世界同一尺度：u 沿跑道方向，v 垂直于跑道、指向营区一侧；跑道 |u| ≤ 460、|v| ≤ 15，平行滑行道 v = 75
function eaW(b, u, v) { const h = b.rh || 0, s = b.rs || 1, c = Math.cos(h), n = Math.sin(h); return [b.x + c * u - n * v * s, b.y + n * u + c * v * s]; }
function eaL(b, x, y) { const h = b.rh || 0, s = b.rs || 1, c = Math.cos(h), n = Math.sin(h), dx = x - b.x, dy = y - b.y; return [dx * c + dy * n, (-dx * n + dy * c) * s]; }
const eaBaseSeen = b => EA_EYE.some(([u, v]) => { const [x, y] = eaW(b, u, v); return inVision(x, y); });
// 设施（跑道、滑行道、停机坪与机库、机库群、油库、弹药库等，afbase.js AFB_FAC）到点的距离：局部坐标里到几块矩形的最近距离
function eaFacDist(b, x, y) {
  const [u, v] = eaL(b, x, y);
  let m = Infinity;
  for (const [u0, u1, v0, v1] of AFB_FAC) m = Math.min(m, Math.hypot(Math.max(0, u0 - u, u - u1), Math.max(0, v0 - v, v - v1)));
  return m;
}
// 跑道选址：在 (x, y) 处试 12 个方向 × 营区两侧：跑道、滑行道与整个场区都落在可用陆地上（不跨水、河、悬崖、山地，不出图），
// 跑道离海处处不少于 minD，不压 avoid 里的据点 / 工事 {x, y, r}；返回地形最平整、离海最远、营区背海的方案 {h, s, sc}，放不下返回 null
function eaRunwayFit(x, y, minD = 380, avoid) {
  const cost = t => t === T.FIELD || t === T.ROAD ? 0 : t === T.HILL || t === T.BEACH ? .5 : t === T.FOREST || t === T.MARSH || t === T.TOWN || t === T.FORD ? 1.5 : -1;
  let best = null;
  for (let k = 0; k < 12; k++) {
    const h = k * Math.PI / 12, c = Math.cos(h), n = Math.sin(h);
    for (const s of [1, -1]) {
      const P = (u, v) => [x + c * u - n * v * s, y + n * u + c * v * s];
      let soft = 0, depth = Infinity, bad = false;
      const at = (u, v, w) => {
        const [px, py] = P(u, v);
        if (px < 15 || px > W - 15 || py < 15 || py > H - 15) return (bad = true);
        const t = cost(typeAt(px, py));
        if (t < 0) return (bad = true);
        soft += t * w;
        if (v === 0) depth = Math.min(depth, coastAt(px) - py);
        return false;
      };
      for (let u = -480; u <= 480 && !bad; u += 30) for (const v of [-16, 0, 16, 75]) if (at(u, v, 1)) break;   // 跑道、平行滑行道
      for (let u = -520; u <= 520 && !bad; u += 40) for (const v of [-120, 130, 220, 310, 400, 490, 580]) if (at(u, v, .5)) break;   // 场区
      if (bad || depth < minD) continue;
      const [x0, y0] = P(-470, 0), [x1, y1] = P(470, 0), [a0x, a0y] = P(-520, 200), [a1x, a1y] = P(520, 200), [b0x, b0y] = P(-520, 450), [b1x, b1y] = P(520, 450), [ax, ay] = P(0, 300);
      if (avoid && avoid.some(o => segDist(o.x, o.y, x0, y0, x1, y1) < o.r + 24 || segDist(o.x, o.y, a0x, a0y, a1x, a1y) < o.r + 110 || segDist(o.x, o.y, b0x, b0y, b1x, b1y) < o.r + 140)) continue;
      const sc = -soft * 1.2 + (coastAt(ax) - ay > coastAt(x) - y ? 2 : 0) + Math.min(depth, 700) / 200;
      if (!best || sc > best.sc) best = { h, s, sc };
    }
  }
  return best;
}
// 已放下的机场补定跑道方向（沙盒开战时）：先避开据点与其他工事，实在放不下就只看地形
function eaFitBase(b) {
  const avoid = [...S.points.map(p => ({ x: p.x, y: p.y, r: 50 })), ...S.enemies.filter(o => o !== b).map(o => ({ x: o.x, y: o.y, r: o.kind === 'airfield' ? 260 * AF_K : 15 }))];
  const f = eaRunwayFit(b.x, b.y, 300, avoid) || eaRunwayFit(b.x, b.y, 200) || { h: 0, s: -1 };
  b.rh = f.h; b.rs = f.s;
  return b;
}
// 停在地面的飞机（待命 / 整备）平均分到各机场：第一架直升机停起降坪、其余停直升机位；固定翼一架进机堡、一架上停机线交替（疏散停放）；
// 返回 {w, u, v, a 机头朝向, k 位置类型}
function eaParked(b) {
  const E = S.eair, bases = eaBases(), i0 = bases.indexOf(b);
  if (!E || i0 < 0) return [];
  const gnd = E.wing.filter(w => (w.state === 'ready' || w.state === 'rearm') && !w.farp), per = Math.ceil(gnd.length / bases.length), out = [], used = new Set();
  let pad = false, nf = 0;
  for (const w of gnd.slice(i0 * per, (i0 + 1) * per)) {
    const rot = w.type === 'heli' || w.type === 'uh60', want = rot ? 'heli' : nf++ % 2 ? 'line' : 'has';
    if (rot && !pad) { pad = true; out.push({ w, u: EA_PAD[0], v: EA_PAD[1], a: -Math.PI / 2, k: 'pad' }); continue; }
    let i = w.sb === b.id && w.st != null && !used.has(w.st) && EA_STAND[w.st] && (EA_STAND[w.st][3] === 'heli') === rot ? w.st : -1;   // 记住的机位：别的飞机起飞了也不挪位
    if (i < 0) i = EA_STAND.findIndex((st, j) => !used.has(j) && st[3] === want && !gnd.some(o => o !== w && o.sb === b.id && o.st === j));
    if (i < 0) i = EA_STAND.findIndex((st, j) => !used.has(j) && (st[3] === 'heli') === rot);
    if (i < 0) i = EA_STAND.findIndex((st, j) => !used.has(j));
    if (i < 0) break;
    used.add(i); w.st = i; w.sb = b.id;
    const [u, v, a, k] = EA_STAND[i];
    out.push({ w, u, v, a, k });
  }
  return out;
}

function eaEnsure() {
  if (!S.eair) S.eair = { wing: [], fly: [], proj: [], wr: [], flash: [], cratT: 0, nextT: 50, first: 50, gap: 40, aaT: 0, thinkT: 2, said: {} };
  return S.eair;
}
function eaAddWing(type) { const E = eaEnsure(); E.wing.push({ id: S.nid++, type: EA_SPEC[type] ? type : 'ga', state: 'ready', rearmT: 0 }); }
const eaBases = () => S.enemies.filter(e => e.kind === 'airfield' && !e.dead);
const eaOpen = () => eaBases().filter(b => !(b.cratT > S.t));   // 跑道完好、能起降的机场
function eaNearBase(x, y, list) { let b = null, bd = Infinity; for (const e of list || eaBases()) { const d = dist(e.x, e.y, x, y); if (d < bd) { bd = d; b = e; } } return b; }
const eaWhere = (x, y) => typeof cmdWhere === 'function' ? cmdWhere(x, y) : gridRef(x, y);

// —— 战役：在指挥所以北纵深找一块放得下 300 米跑道的平整陆地修野战机场；按难度配飞机、守军单兵防空组；我方两个排各带一个便携防空组 ——
function eaPlaceBase() {
  if (TER.af) {   // 地图自带的空军基地（mapgen2.js afSite）
    const e = addEnemy('airfield', TER.af.x, TER.af.y);
    e.rh = TER.af.h; e.rs = TER.af.s; e.mapAF = true;
    return e;
  }
  const hq = S.points.find(p => p.key === 'HQ') || S.points.reduce((a, p) => p.y < a.y ? p : a, S.points[0]);
  const avoid = [...S.points.map(p => ({ x: p.x, y: p.y, r: 50 })), ...S.enemies.map(e => ({ x: e.x, y: e.y, r: 15 }))];
  let best = null, bs = -1e9;
  for (let dx = -600; dx <= 600; dx += 40) for (let y = 60; y <= hq.y - 150; y += 30) {
    const x = clamp(hq.x + dx, 170, W - 170);
    if (!isLand(x, y) || coastAt(x) - y < 500) continue;
    const f = eaRunwayFit(x, y, 400, avoid);
    if (!f) continue;
    const sc = f.sc - Math.abs(dx) / 300 + Math.random() * 1.2;
    if (sc > bs) { bs = sc; best = { x, y, f }; }
  }
  for (let k = 0; k < 800 && !best; k++) {   // 指挥所以北放不下：在全图纵深里找
    const x = 170 + Math.random() * (W - 340), y = 50 + Math.random() * 700;
    if (!isLand(x, y) || coastAt(x) - y < 480) continue;
    const f = eaRunwayFit(x, y, 380, avoid);
    if (f) best = { x, y, f };
  }
  if (!best) return null;
  const e = addEnemy('airfield', best.x, best.y);
  e.rh = best.f.h; e.rs = best.f.s;
  return e;
}
function eaAddManpads(p) {
  const g = S.teams.find(q => q.side === 'e' && q.obj === p.key && q.role === 'garrison' && q.u != null);
  for (let k = 0; k < 20; k++) {
    const x = p.x + gauss() * 25, y = p.y + gauss() * 25;
    if (passInf(x, y)) return addTeam('e', x, y, ['rifle', 'rifle', 'aa'], { role: 'garrison', obj: p.key, u: g ? g.u : undefined, aam: 3 });
  }
  return null;
}
HOOK.newGame.push(function eaNewGame(opts) {
  if (!S) return;
  S.eair = null;
  if ((opts && opts.sandbox) || !eaOn()) return;
  const D = EA_DIFF[S.level];
  if (D && eaPlaceBase()) { const E = eaEnsure(); E.first = E.nextT = D.first; E.gap = D.gap; for (const t of D.wing) eaAddWing(t); }
  for (const s of S.ships) if (s.label === 'LA-3' || s.label === 'LS-1') s.aaN = 1;
  const n = EA_MANPADS[S.level] || 0, keys = ['HQ', 'RD', 'T1'];
  for (let i = 0, k = 0; i < n && k < keys.length; k++) { const p = S.points.find(p => p.key === keys[k]); if (p && eaAddManpads(p)) i++; }
});

// —— 每步 ——
function eaStep(dt) {
  if (!S || S.phase !== 'battle' || !eaOn()) return;
  eaConvert();
  // 跑道抢修完毕；进攻方看见机场任何一部分（跑道很长，中心不一定在视野里）就标定
  for (const b of S.enemies) if (b.kind === 'airfield' && !b.dead) {
    if (b.cratT && S.t >= b.cratT) { b.cratT = 0; b.rc = []; if (eaBaseSeen(b)) log('敌机场跑道抢修完毕，恢复起降', 'warn', 'earep' + b.id, 30, b); }
    if (b.kx == null && eaBaseSeen(b)) { b.kx = b.x; b.ky = b.y; log('发现敌野战机场', 'warn', null, 0, b); }
  }
  eaRepair(dt);
  const E = S.eair;
  if (E) {
    // 机场被毁：机位（每座 EA_RW.cap 个）不够的地面飞机随之损失
    const cap = eaBases().length * EA_RW.cap, gnd = E.wing.filter(w => (w.state === 'ready' || w.state === 'rearm') && !w.farp);   // 疏散在前沿加油弹药点的不算
    let over = E.wing.filter(w => w.state !== 'lost' && !w.farp).length - cap, lost = 0;
    for (let i = gnd.length - 1; i >= 0 && over > 0; i--, over--) { gnd[i].state = 'lost'; lost++; }
    if (lost && !cap && !E.said.base) { E.said.base = 1; log('敌野战机场被毁，停在地面的敌机全部损失', 'good'); }
    for (const w of E.wing) if (w.state === 'rearm' && (w.rearmT -= dt) <= 0) w.state = 'ready';
    for (const a of E.fly) if (!a.dead) { if (a.type === 'b2') { if (typeof b2Fly === 'function') b2Fly(a, dt); else a.dead = true; } else if (a.type === 'p8') { if (typeof asP8Fly === 'function') asP8Fly(a, dt); else a.dead = true; } else if (a.type === 'uh60' || a.type === 'c17') { if (typeof a101Fly === 'function') a101Fly(a, dt); else a.dead = true; } else if (a.ph === 'gnd') eaGnd(a, dt); else if (a.ph === 'roll') eaRoll(a, dt); else if (a.ph === 'vto') eaVto(a, dt); else if (a.ph === 'vl') eaRtb(a, dt); else if (a.type === 'heli') eaFlyHeli(a, dt); else if (eaFtr(a.type) && typeof awFlyE === 'function') awFlyE(a, dt); else eaFlyGA(a, dt); }
    E.fly = E.fly.filter(a => !a.dead);
    eaProj(dt);
    for (const w of E.wr) if (!w.hit && S.t - w.t >= 2) { w.hit = true; const x = w.x + Math.cos(w.h) * w.spd * 2, y = w.y + Math.sin(w.h) * w.spd * 2; S.fx.push({ kind: isLand(x, y) ? 'boom' : 'flash', x, y, r: 14, life: 0, max: .8, side: 'e' }); }
    E.wr = E.wr.filter(w => S.t - w.t < 2.4);
    E.flash = E.flash.filter(f => S.t - f.t < 2);
    if ((E.thinkT -= dt) <= 0) { E.thinkT = 2; eaThink(); }
    if ((E.scrT = (E.scrT ?? 0) - dt) <= 0) { E.scrT = 1; eaScramble(); }
  }
  if (((E || eaEnsureLight()).aaT -= dt) <= 0) { (E || S.eaLight).aaT = .5; eaAA(); }
}
// 没有守方航空时也要跑单兵防空（守方打我方舰载机）：只用一个计时器
function eaEnsureLight() { if (!S.eaLight) S.eaLight = { aaT: 0 }; return S.eaLight; }

// 战役：LA-3、LS-1 抢滩后，本排最后一个小组的机枪手换成防空导弹手
function eaConvert() {
  for (const s of S.ships) {
    if (!s.aaN || s.aaDone || s.state !== 'beached') continue;
    s.aaDone = true;
    const u = S.units.find(u => u.side === 'p' && u.ship === s.label && u.kind === 'inf'), ts = u ? teamsOf(u).filter(q => q.men.length) : [];
    const q = ts[ts.length - 1];
    if (!q) continue;
    const i = q.men.lastIndexOf('mg') >= 0 ? q.men.lastIndexOf('mg') : q.men.lastIndexOf('rifle');
    if (i >= 0) { q.men[i] = 'aa'; q.aam = 3; }
  }
}

// —— 飞行 ——
// 起飞：固定翼在跑道一端排队（前一架离地后 6 秒再滑跑），选起飞后离目标方向更顺的一端；直升机从直升机坪垂直起飞
function eaNewAir(b, w, tx, ty, extra) {
  if (w.farp && S.eair.farp) b = eaFarpBase();   // 疏散在机场外前沿加油弹药点的：从那里起飞
  const sp = EA_SPEC[w.type], h = b.rh || 0, dir = Math.cos(Math.atan2(ty - b.y, tx - b.x) - h) >= 0 ? 1 : -1, a = { id: S.nid++, wid: w.id, type: w.type, base: b.id, spd: 0, bank: 0,
    tx, ty, flares: sp.flares, hp: sp.hp, t: S.t, pv: false, ...extra };
  if (w.type === 'heli') { if (b.farp) { const s = eaFarpSlot(w); [a.x, a.y] = s; } else [a.x, a.y] = eaW(b, EA_PAD[0], EA_PAD[1]); Object.assign(a, { heading: Math.atan2(ty - a.y, tx - a.x), alt: .02, ph: 'out' }); }
  else if (eaVtol(w.type)) {   // F-35B：不上跑道——机场里飞行员登机、开车后在机位上垂直起飞；前沿加油弹药点的飞行员在座舱待命，开车就起飞
    const P = b.farp ? null : eaParked(b).find(o => o.w === w), G = P ? eaGndPlan(b, P) : null;
    Object.assign(a, { spd: 0, alt: 0, vt: b.farp ? -4 : -3, ph: 'vto' });
    if (G) { Object.assign(a, { ph: 'gnd', g: G, vto: true }); [a.x, a.y] = eaW(b, G.P[0][0], G.P[0][1]); a.heading = eaGndHd(b, G, 0); }
    else if (b.farp) { const s = eaFarpSlot(w); [a.x, a.y] = s; a.heading = s[2]; }
    else { [a.x, a.y] = eaW(b, EA_PAD[0], EA_PAD[1]); a.heading = Math.atan2(ty - a.y, tx - a.x); }
  }
  else {
    const P = eaParked(b).find(o => o.w === w), G = P ? eaGndPlan(b, P) : null, d2 = G ? G.dir : dir;
    const t0 = S.t + (G ? G.dur : 0), go = Math.max(t0, b.rwT || 0), wait = go - S.t;   // 跑道排队：前一架滑跑 3.5 秒后才轮到
    b.rwT = go + 3.5;
    Object.assign(a, { ru: -d2 * 440, dir: d2, wait, heading: h + (d2 < 0 ? Math.PI : 0), alt: 0, ph: 'roll' });
    [a.x, a.y] = eaW(b, a.ru, 0);
    if (G) { Object.assign(a, { ph: 'gnd', g: G }); [a.x, a.y] = eaW(b, G.P[0][0], G.P[0][1]); a.heading = eaGndHd(b, G, 0); }
  }
  return a;
}
// —— 机场地面作业（固定翼出动全过程）——
//   机组：飞行员从中队楼 / 机堡侧门跑到飞机左侧登机梯（EA_GND.run 米每秒），顺梯子爬进座舱（climb 秒），座舱盖合上（cnp 秒），
//     地勤在机头前打手势、发动机启动（start 秒）；
//   滑行：从机位沿机库群的鱼骨滑行道 / 停机坪滑到平行滑行道，再经联络道进跑道头（离机位近的那一端），滑行 EA_GND.taxi 米每秒，转弯处是圆弧；
//   到跑道头对准跑道，轮到自己就开始滑跑（eaRoll）。直升机仍从起降坪直接起飞
const EA_GND = { run: 4.2, climb: 2.2, cnp: 1.6, start: 2.6, taxi: 19, door: 30 };
function eaGndPlan(b, P) {
  const [u0, v0, a0, k] = [P.u, P.v, P.a, P.k], dir = u0 > 0 ? -1 : 1, ue = -dir * 450;   // 离机位近的那一端
  const pts = [[u0, v0]];
  if (k === 'has') { const su = AFB_SP.reduce((m, x) => Math.abs(x - u0) < Math.abs(m - u0) ? x : m, AFB_SP[0]); pts.push([su, v0], [su, 75]); }   // 机头朝鱼骨滑行道：先出机堡，再沿鱼骨道出来
  else pts.push([u0, 75]);   // 停机线：机头朝滑行道，直接滑出
  pts.push([ue + dir * 30, 75], [ue, 45], [ue, 10], [ue + dir * 10, 0]);
  // 圆角：Chaikin 切一遍（起点、终点不动）
  const Q = [pts[0]];
  for (let i = 1; i < pts.length; i++) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; if (i > 1) Q.push([x0 * .75 + x1 * .25, y0 * .75 + y1 * .25]); if (i < pts.length - 1) Q.push([x0 * .25 + x1 * .75, y0 * .25 + y1 * .75]); }
  Q.push(pts[pts.length - 1]);
  const L = [0];
  for (let i = 1; i < Q.length; i++) L.push(L[i - 1] + Math.hypot(Q[i][0] - Q[i - 1][0], Q[i][1] - Q[i - 1][1]));
  // 飞行员出发点：停机线在机位后方的中队楼一侧，机堡在机堡侧门
  const door = k === 'has' ? [u0 - Math.cos(a0) * 12, v0 + 13] : [u0 + 9, v0 + EA_GND.door];
  const crew = Math.hypot(door[0] - u0, door[1] - v0) / EA_GND.run + EA_GND.climb + EA_GND.cnp + EA_GND.start;
  return { P: Q, L, dir, door, a0, crew, s: 0, t0: S.t, dur: crew + L[L.length - 1] / EA_GND.taxi };
}
// 沿滑行路线 s 米处的位置（局部 u, v）与朝向
function eaGndAt(G, s) {
  const { P, L } = G;
  let i = 1;
  while (i < L.length - 1 && L[i] < s) i++;
  const f = clamp((s - L[i - 1]) / Math.max(1e-6, L[i] - L[i - 1]), 0, 1);
  return { u: lerp(P[i - 1][0], P[i][0], f), v: lerp(P[i - 1][1], P[i][1], f), a: Math.atan2(P[i][1] - P[i - 1][1], P[i][0] - P[i - 1][0]) };
}
const eaGndHd = (b, G, s) => { const h = b.rh || 0, sg = b.rs || 1; if (s <= 0) return h + Math.atan2(Math.sin(G.a0) * sg, Math.cos(G.a0)); const q = eaGndAt(G, s); return h + Math.atan2(Math.sin(q.a) * sg, Math.cos(q.a)); };
function eaGnd(a, dt) {
  const b = S.enemies.find(e => e.id === a.base && !e.dead);
  if (!b) { a.dead = true; const w = S.eair.wing.find(w => w.id === a.wid); if (w) w.state = 'lost'; return; }
  const G = a.g, t = S.t - G.t0;
  if (a.wait > 0) a.wait -= dt;
  if (t < G.crew) return;   // 机组登机、开车
  if (a.vto) { a.ph = 'vto'; a.vt = 0; a.g = null; a.vto = false; return; }   // F-35B：在机位上直接垂直起飞
  const end = G.L[G.L.length - 1];
  G.s = Math.min(end, G.s + EA_GND.taxi * Math.min(1, (t - G.crew) / 2.5) * dt);   // 起步慢慢加速
  const q = eaGndAt(G, G.s);
  [a.x, a.y] = eaW(b, q.u, q.v); a.heading = eaGndHd(b, G, Math.max(.01, G.s)); a.spd = EA_GND.taxi;
  if (G.s >= end - .01) { a.ph = 'roll'; a.spd = 0; a.g = null; a.wait = Math.max(0, a.wait); [a.x, a.y] = eaW(b, a.ru, 0); a.heading = (b.rh || 0) + (a.dir < 0 ? Math.PI : 0); }
}
// 机组动作（画面用）：{ pilot: {u, v, a, z, run, ph} | null, cpo 座舱盖开度, crew 地勤手势, eng 发动机启动中 }
function eaGndCrew(a) {
  const G = a.g;
  if (!G || a.ph !== 'gnd') return null;
  const t = S.t - G.t0, [u0, v0] = G.P[0], walk = Math.hypot(G.door[0] - u0, G.door[1] - v0) / EA_GND.run, k = (EA_SPEC[a.type] && a.type === 'ga' ? 18 : 17) / 21;
  const ca = Math.cos(G.a0), sa = Math.sin(G.a0), lad = [u0 + ca * 2.4 * k + sa * 2.6 * k, v0 + sa * 2.4 * k - ca * 2.6 * k];   // 登机梯在座舱左侧（机头前 2.4、左 2.6）
  let pilot = null;
  if (t < walk) { const f = t / walk; pilot = { u: lerp(G.door[0], lad[0], f), v: lerp(G.door[1], lad[1], f), a: Math.atan2(lad[1] - G.door[1], lad[0] - G.door[0]), z: 0, run: true, ph: t * 6.5 }; }
  else if (t < walk + EA_GND.climb) { const q = (t - walk) / EA_GND.climb; pilot = { u: lad[0], v: lad[1], a: G.a0 + Math.PI / 2, z: Math.min(q / .7, 1) * 2.6 * k, run: false, ph: q * 9 }; }
  const tc = t - walk - EA_GND.climb, cpo = tc < 0 ? clamp(t / 1.2, 0, 1) : 1 - clamp(tc / EA_GND.cnp, 0, 1);
  return { pilot, cpo, lad: t < walk + EA_GND.climb + .4 ? lad : null, crew: t < G.crew + 4, mar: [u0 + ca * 15 * k, v0 + sa * 15 * k], mh: G.a0 + Math.PI, eng: tc > EA_GND.cnp && t < G.crew + 1, k };   // mar：地勤站在机位前方指挥开车、引导滑出
}
// 起飞滑跑：从跑道入口沿跑道加速，到 150 离地转入出航（a.next 指定离地后的阶段）；机场在滑跑中被毁则损失
function eaRoll(a, dt) {
  const b = S.enemies.find(e => e.id === a.base && !e.dead);
  if (!b) { a.dead = true; const w = S.eair.wing.find(w => w.id === a.wid); if (w) w.state = 'lost'; return; }
  if (a.wait > 0) a.wait -= dt;
  else { a.spd = Math.min(EA_SPEC[a.type].spd, a.spd + 80 * dt); a.ru += a.dir * a.spd * dt; }
  [a.x, a.y] = eaW(b, a.ru, 0); a.heading = (b.rh || 0) + (a.dir < 0 ? Math.PI : 0); a.alt = 0; a.bank = 0;
  if (a.spd >= 150 || a.ru * a.dir > 450) { a.ph = a.next || 'out'; a.alt = .06; }
}
// F-35B 垂直起飞：发动机推力转向下（升力风扇舱门打开），离地悬停爬升约 3 秒、机头转向航向，然后边加速边转平飞；a.next 指定转平飞后的阶段
function eaVto(a, dt) {
  a.vt = (a.vt || 0) + dt;
  if (a.vt < 0) return;   // 开车
  const want = Math.atan2(a.ty - a.y, a.tx - a.x), yaw = r => { a.heading = eaAng(a.heading + clamp(eaAng(want - a.heading), -r * dt, r * dt)); };
  a.bank = 0;
  if (a.vt < 3.2) { a.alt = Math.min(.1, a.vt * .032); a.spd = 0; yaw(.6); return; }
  a.spd = Math.min(EA_SPEC[a.type].spd, a.spd + 45 * dt); a.alt = Math.min(.45, a.alt + dt * .07); yaw(.9);
  a.x += Math.cos(a.heading) * a.spd * airK(a) * dt; a.y += Math.sin(a.heading) * a.spd * airK(a) * dt;
  if (a.spd >= 120) { a.ph = a.next || 'out'; a.next = null; }
}
// 垂直降落（F-35B、疏散到机场外的直升机）：飞到着陆点上空减速，转悬停平移对正、按停放朝向转好机头，再垂直下降落地
function eaVLand(a, H, dt) {
  const d = dist(a.x, a.y, H.x, H.y);
  if (a.ph !== 'vl') {
    if (a.type !== 'heli') a.alt = Math.max(d > 320 ? .3 : .1, a.alt - dt * .1);
    eaSteer(a, H.x, H.y, dt, d < 280 ? Math.max(14, d * .45) : undefined);
    if (d < 36) a.ph = 'vl';
    return;
  }
  const k = Math.min(1, dt * 1.4);
  a.x += (H.x - a.x) * k; a.y += (H.y - a.y) * k; a.spd = 0; a.bank = 0;
  a.heading = eaAng(a.heading + clamp(eaAng(H.h - a.heading), -.7 * dt, .7 * dt));
  if (d < 4) a.alt = Math.max(0, a.alt - dt * .045);
  if (a.alt <= .002) eaLanded(a, H);
}
// —— 机场受威胁（敌地面部队逼近、空降场就在附近）：直升机与 F-35B 不等机场陷落，立即升空——有弹的冲上去打，整备中的直接疏散；
//    疏散到机场外的前沿加油弹药补给点（FARP：一块平整的野地，几个停放点、油囊和弹药箱），在那里停放、加油挂弹、继续出动 ——
const EA_FARP = { foe: 520, dz: 1100, rings: [760, 920, 1080], gap: 36, rearm: 1.4 };
function eaThreatened(b) {
  if (!b || b.dead) return true;
  const R0 = EA_FARP.foe, A = S.ab;
  if (S.teams.some(q => q.side === 'p' && q.men.length && !q.ride && dist(q.x, q.y, b.x, b.y) < R0)) return true;
  if ((S.veh || []).some(v => v.side === 'p' && !v.dead && !v.lst && dist(v.x, v.y, b.x, b.y) < R0)) return true;
  return !!(A && A.dz && ['pf', 'air', 'asm', 'dfd', 'atk'].includes(A.st) && dist(A.dz.x, A.dz.y, b.x, b.y) < EA_FARP.dz);
}
function eaFarpBase() { const F = S.eair && S.eair.farp; return F ? { id: 'farp', farp: true, x: F.x, y: F.y, rh: 0, rs: 1 } : null; }
function eaFarpEnsure(b) {
  const E = S.eair;
  if (E.farp) return E.farp;
  if (!b) return null;
  const foes = S.teams.filter(q => q.side === 'p' && q.men.length);
  let best = null, bs = -1e9;
  for (let k = 0; k < 24; k++) for (const r of EA_FARP.rings) {
    const an = k / 24 * 6.283, x = b.x + Math.cos(an) * r, y = b.y + Math.sin(an) * r;
    if (x < 80 || x > W - 80 || y < 80 || y > H - 80 || coastAt(clamp(x, 0, W - 1)) - y < 500) continue;
    const [lu, lv] = eaL(b, x, y);
    if (Math.abs(lu) < 640 && lv > -280 && lv < 720) continue;   // 要在机场场区（跑道、营区、机库群）外面
    if ([[0, 0], [40, 0], [-40, 0], [0, 34], [0, -34], [40, 34], [-40, -34]].some(([dx, dy]) => { const t = typeAt(x + dx, y + dy); return t !== T.FIELD && t !== T.HILL; })) continue;
    const foe = foes.reduce((m, q) => Math.min(m, dist(q.x, q.y, x, y)), 3000);
    const sc = Math.min(foe, 1500) / 300 + Math.min(coastAt(clamp(x, 0, W - 1)) - y, 1600) / 400 - Math.abs(r - 900) / 600 + (typeAt(x, y) === T.FIELD ? .5 : 0);
    if (sc > bs) { bs = sc; best = { x, y }; }
  }
  if (!best) best = { x: clamp(b.x, 100, W - 100), y: clamp(b.y - 650, 60, H - 100) };
  const h = Math.PI / 2, slots = [];
  for (let r = 0; r < 2; r++) for (let i = 0; i < 5; i++) slots.push([Math.round(best.x + (i - 2) * EA_FARP.gap), Math.round(best.y + (r - .5) * 46), h]);
  E.farp = { x: Math.round(best.x), y: Math.round(best.y), h, slots, occ: {} };
  if (typeof chatSay === 'function') chatSay('e', `命令：在${eaWhere(best.x, best.y)}开设前沿加油弹药补给点，直升机和 F-35B 疏散过去，在机场外的野地上停放、加油挂弹。`, { kind: 'order', at: best, lv: 1 });
  eaStat('farp');
  return E.farp;
}
// 该机在前沿加油弹药点的停放位置（占住了就一直是它的，被击毁 / 损失的让出来）
function eaFarpSlot(w) {
  const F = S.eair.farp;
  if (!F) return null;
  const live = id => S.eair.wing.some(o => o.id === id && o.state !== 'lost');
  if (w.fs != null && F.occ[w.fs] === w.id) return F.slots[w.fs];
  let i = F.slots.findIndex((_, j) => F.occ[j] == null || !live(F.occ[j]));
  if (i < 0) i = (w.id % F.slots.length);
  F.occ[i] = w.id; w.fs = i;
  return F.slots[i];
}
// 每秒：受威胁的机场上的直升机、F-35B 立即升空——有弹、有目标的一起出击，其余直接疏散到前沿加油弹药点
function eaScramble() {
  const E = S.eair;
  for (const b of eaBases()) {
    if (!eaThreatened(b)) { b.scr = false; continue; }
    const ws = eaParked(b).map(P => P.w).filter(w => (w.type === 'heli' || eaVtol(w.type)) && (w.state === 'ready' || w.state === 'rearm') && !w.farp);
    if (!ws.length) { b.scr = true; continue; }
    const F = eaFarpEnsure(b);
    if (!F) continue;
    const T = eaTargets().filter(t => t.v > 0 && dist(t.x, t.y, b.x, b.y) < 1000).sort((p, q) => q.v - p.v)[0] || (typeof abeAirTargets === 'function' ? abeAirTargets()[0] : null);
    const hAtk = ws.filter(w => w.type === 'heli' && w.state === 'ready' && T && eaHeliOk(T)), vAtk = ws.filter(w => eaVtol(w.type) && w.state === 'ready' && T);
    const rest = ws.filter(w => !hAtk.includes(w) && !vAtk.includes(w));
    if (hAtk.length) eaPkg(b, hAtk, () => T);
    for (const w of vAtk) { const L = EA_FTR[w.type]; const a = eaNewAir(b, w, T.x, T.y, { tgt: T.k && T.id != null ? { k: T.k, id: T.id } : { k: 'pt' }, role: 'strike', cx: T.x, cy: T.y, capT: 40, aam: L.aam, gun: L.gun, aamR: L.aamR, pkK: L.pkK, gunK: L.gunK || 1, sdb: L.sdb || 4 }); a.vt = Math.max(a.vt || 0, -1.5); if (a.g) a.g.t0 -= a.g.crew * .5; w.state = 'out'; E.fly.push(a); }   // 告警待命：登机快一半
    for (const w of rest) {   // 疏散：起飞后直接飞向前沿加油弹药点降落
      const s = eaFarpSlot(w), a = eaNewAir(b, w, s[0], s[1], { tgt: { k: 'pt' }, atgm: 0, rk: 0, ammo: 0, sdb: 0, aam: 0, gun: 0 });
      if (w.type === 'heli') a.ph = 'rtb'; else { a.next = 'rtb'; if (a.g) a.g.t0 -= a.g.crew * .5; }
      w.state = 'out'; E.fly.push(a);
    }
    for (const w of ws) { w.farp = true; eaFarpSlot(w); }   // 这一批回来都落到前沿加油弹药点
    if (!b.scr) {
      b.scr = true; eaStat('scramble', ws.length);
      const nh = ws.filter(w => w.type === 'heli').length, nv = ws.length - nh;
      if (typeof chatSay === 'function') chatSay('e', `机场有敌情！${nh ? `直升机 ${nh} 架` : ''}${nh && nv ? '、' : ''}${nv ? `F-35B ${nv} 架` : ''}马上升空，${hAtk.length || vAtk.length ? `能打的先去打${T ? eaWhere(T.x, T.y) : '机场外围'}的敌人，` : ''}其余的先撤到外面的前沿加油点落地待命。`, { kind: 'order', at: b, lv: 1 });
    }
  }
}
// 停在前沿加油弹药点的飞机：[{ w, x, y, h }]
function eaFarpParked() {
  const E = S && S.eair, F = E && E.farp;
  if (!F) return [];
  return E.wing.filter(w => w.farp && (w.state === 'ready' || w.state === 'rearm')).map(w => { const s = eaFarpSlot(w); return { w, x: s[0], y: s[1], h: s[2] }; });
}
const eaFarpSeen = () => { const F = S.eair && S.eair.farp; return !!F && (specAll() || inVision(F.x, F.y) || F.kx != null); };
// 平面画面：野地上一圈停放点（白色圆圈 + H）、油囊、弹药箱，停着的直升机 / F-35B（3D 时是立体模型）
HOOK.drawUnder.push(function eaDrawFarp() {
  const F = S && S.eair && S.eair.farp;
  if (!F || typeof R !== 'object' || !R.ctx || !inView(F.x, F.y, 160)) return;
  const vis = specAll() || inVision(F.x, F.y);
  if (vis && F.kx == null && !specAll()) { F.kx = F.x; log('发现敌军在机场外开设的前沿加油弹药点', 'warn', null, 0, F); }
  if (!vis && F.kx == null) return;
  const ctx = R.ctx, rl = typeof realLook === 'function' && realLook(), col = rl ? 'rgba(235,235,225,.75)' : rgba(COL.enemy, .55);
  ctx.save(); ctx.globalAlpha = vis ? 1 : .45; ctx.setLineDash([]);
  for (const [x, y] of F.slots) { ctx.strokeStyle = col; ctx.lineWidth = px(1); ctx.beginPath(); ctx.arc(x, y, 9, 0, 6.283); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x - 2.6, y - 3.4); ctx.lineTo(x - 2.6, y + 3.4); ctx.moveTo(x + 2.6, y - 3.4); ctx.lineTo(x + 2.6, y + 3.4); ctx.moveTo(x - 2.6, y); ctx.lineTo(x + 2.6, y); ctx.stroke(); }
  ctx.fillStyle = rl ? '#3b3f33' : 'rgba(10,30,18,.9)'; ctx.strokeStyle = col;
  for (const [dx, dy] of [[-62, -40], [-62, -28], [62, -40]]) { ctx.beginPath(); ctx.ellipse(F.x + dx, F.y + dy, 7, 3.6, 0, 0, 6.283); ctx.fill(); ctx.stroke(); }   // 油囊
  for (let i = 0; i < 4; i++) { ctx.fillRect(F.x + 50 + (i % 2) * 5, F.y + 34 + (i >> 1) * 4, 4, 3); }   // 弹药箱
  if (!R.m3d) for (const P of eaFarpParked()) drawAircraft(ctx, P.x, P.y, P.h, eaSil(P.w.type), P.w.type === 'heli' ? 13 : 15, COL.enemy, P.w.state === 'ready' ? .95 : .5, 0, px(1), undefined, { still: true });
  ctx.restore();
});
// —— 机场抢修与重建（守方地勤 / 工程兵）——
// 受损：最近 15 秒没再中弹、600 以内没有进攻方地面部队时，每秒修复 0.3（50 点约 3 分钟修满）；
// 被毁：90 秒后开始重建（同样要求附近无敌、没再挨炸），150 秒后恢复到四成耐久、跑道重新开放——停在地面的飞机已随机场损失，
// 空中的飞机可以回来降落；重建中挨炸进度倒退（eaImpact）。b.hp0 上一步耐久（伤害来自多处，靠它判断刚挨过打）· b.hitE 最近中弹 · b.rb 重建进度
const EA_FIX = { quiet: 15, foe: 600, rate: .3, wait: 90, build: 150, hp: .4 };
function eaRepair(dt) {
  for (const b of S.enemies) {
    if (b.kind !== 'airfield') continue;
    if (b.hp0 != null && b.hp < b.hp0 - .001) b.hitE = S.t;
    const foe = S.teams.some(q => q.side === 'p' && q.men.length && dist(q.x, q.y, b.x, b.y) < EA_FIX.foe) || (S.veh || []).some(v => v.side === 'p' && !v.dead && !v.lst && dist(v.x, v.y, b.x, b.y) < EA_FIX.foe);
    const quiet = S.t - (b.hitE ?? -99) > EA_FIX.quiet && !foe;
    if (!b.dead) {
      b.rb = null; b.deadE = null;
      if (b.hp < b.maxhp && quiet) {
        if (!b.fixing) { b.fixing = true; if (eaBaseSeen(b) || specAll()) log('敌野战机场地勤正在抢修受损设施', 'warn', 'eafix' + b.id, 90, b); }
        b.hp = Math.min(b.maxhp, b.hp + EA_FIX.rate * dt);
      } else b.fixing = false;
      b.hp0 = b.hp;
      continue;
    }
    b.hp0 = b.hp; b.fixing = false;
    if (b.deadE == null) b.deadE = S.t;
    if (S.t - b.deadE < EA_FIX.wait) continue;
    if (b.rb == null) {
      b.rb = 0;
      if (typeof chatSay === 'function') chatSay('e', '命令：工程兵抢修被毁的野战机场，清理跑道、重建机库与油库，力争尽快恢复起降。', { kind: 'order', at: b, lv: 1 });
    }
    if (!quiet) continue;
    if ((b.rb += dt / EA_FIX.build) < 1) continue;
    Object.assign(b, { dead: false, hp: b.maxhp * EA_FIX.hp, hp0: b.maxhp * EA_FIX.hp, rb: null, deadE: null, rc: [], cratT: 0 });
    if (S.eair) S.eair.said.base = 0;
    eaStat('eaRebuilt');
    log(eaBaseSeen(b) || specAll() ? '敌野战机场抢修完毕，跑道恢复起降' : '侦听到敌机场方向恢复飞行活动，疑似机场已修复', 'warn', null, 0, b);
    if (typeof chatSay === 'function') chatSay('e', `报告：野战机场重建完毕（耐久恢复至 ${Math.round(EA_FIX.hp * 100)}%），跑道恢复起降。`, { kind: 'report', at: b, lv: 1 });
  }
}
// 固定翼着陆：飞到跑道延长线上入口外 500 处的进近点 → 对准跑道下滑 → 入口内 80 接地、滑跑减速 → 滑进机位整备；跑道弹坑未修复时在机场上空盘旋
function eaLand(a, b, dt) {
  a.rtbT = (a.rtbT || 0) + dt;
  if (a.rtbT > 100) { eaLanded(a); return; }   // 兜底：久久落不下来直接收回
  const h = b.rh || 0;
  if (a.ph === 'land') {
    a.spd = Math.max(0, a.spd - 75 * dt); a.ru += a.ld * a.spd * dt;
    [a.x, a.y] = eaW(b, a.ru, 0); a.heading = h + (a.ld < 0 ? Math.PI : 0); a.alt = 0; a.bank = 0;
    if (a.spd < 25 || a.ru * a.ld > 450) eaLanded(a);
    return;
  }
  if (b.cratT > S.t) {
    a.ph = 'hold'; a.ld = null;
    const g = Math.atan2(a.y - b.y, a.x - b.x) + .5;
    eaSteer(a, b.x + Math.cos(g) * 260 * AF_K, b.y + Math.sin(g) * 260 * AF_K, dt, 150);
    return;
  }
  if (a.ld == null || a.ph === 'hold' || a.ph === 'rtb') { const [lu] = eaL(b, a.x, a.y); a.ld = lu < 0 ? 1 : -1; a.ph = 'app'; }   // 从飞机所在的一侧进近
  if (a.ph === 'final') {
    const [tx, ty] = eaW(b, -a.ld * 380, 0), d = eaSteer(a, tx, ty, dt, 105);
    a.alt = clamp((d - 15) / 300 * .3, 0, .3);
    if (d < 20) { a.ph = 'land'; a.ru = -a.ld * 380; a.spd = Math.min(a.spd, 105); }
    else if (d < 140 && Math.abs(eaAng(a.heading - h - (a.ld < 0 ? Math.PI : 0))) > .6) a.ph = 'app';   // 没对准跑道：复飞再进近
    return;
  }
  const [ax, ay] = eaW(b, -a.ld * 960, 0), d = eaSteer(a, ax, ay, dt, 160);
  if (d < 70) a.ph = 'final';
}
const EA_REARM = 35;   // 落地后加油挂弹秒数
function eaLanded(a, H) {
  a.dead = true; eaStat('eaLand');
  const w = S.eair.wing.find(w => w.id === a.wid);
  if (w && w.state !== 'lost') { w.state = 'rearm'; w.farp = !!(H && H.farp); w.rearmT = EA_REARM * (w.farp ? EA_FARP.rearm : 1); }   // 野外加油挂弹慢一些
}
// 回哪儿落：疏散过的（或机场都没了 / 受威胁）落到前沿加油弹药点自己的停放位置；否则直升机、F-35B 落回最近的安全机场的直升机坪
function eaHomeSpot(a) {
  const E = S.eair, w = E.wing.find(o => o.id === a.wid), safe = eaBases().filter(b => !eaThreatened(b));
  if (!(w && w.farp) && safe.length) { const b = eaNearBase(a.x, a.y, safe), [x, y] = eaW(b, EA_PAD[0] + (a.type === 'heli' ? 0 : -40), EA_PAD[1]); return { x, y, h: (b.rh || 0) - Math.PI / 2, b }; }
  const F = E.farp || eaFarpEnsure(eaNearBase(a.x, a.y) || S.abBase);
  if (!F || !w) return null;
  const s = eaFarpSlot(w);
  return { x: s[0], y: s[1], h: s[2], farp: true };
}
function eaSteer(a, tx, ty, dt, spd) {
  const sp = EA_SPEC[a.type], df = eaAng(Math.atan2(ty - a.y, tx - a.x) - a.heading), turn = airYaw(a, df, sp.turn, dt), k = airK(a);   // 平滑转向、地速减半（carrier.js）
  a.heading = eaAng(a.heading + turn); a.bank = lerp(a.bank || 0, clamp(a.hr / sp.turn, -1, 1), Math.min(1, dt * 5));
  a.spd += clamp((spd ?? sp.spd) - a.spd, -60 * dt, 50 * dt);
  a.x += Math.cos(a.heading) * a.spd * k * dt; a.y += Math.sin(a.heading) * a.spd * k * dt;
  return dist(a.x, a.y, tx, ty);
}
// 跟踪目标的当前位置（只在守方看得见时更新）
function eaTgtObj(t) {
  if (!t) return null;
  if (t.k === 'ship') { const s = S.ships.find(o => o.id === t.id); return s && alive(s) ? s : null; }
  if (t.k === 'veh') { const v = (S.veh || []).find(o => o.id === t.id); return v && !v.dead ? v : null; }
  if (t.k === 'team') { const q = S.teams.find(o => o.id === t.id); return q && q.men.length ? q : null; }
  return null;
}
function eaTrack(a) {
  const o = eaTgtObj(a.tgt);
  if (a.tgt.k !== 'pt' && !o) { a.lost = true; return; }
  if (o && (spotted(o.x, o.y) || dist(o.x, o.y, a.x, a.y) < 160)) { a.tx = o.x; a.ty = o.y; }
}
// —— 编队飞行（编队里都是在册飞机）：其余各机按长机的位置与航向保持队形（长机右后、左后依次排开的楔形 / 梯队），离自己的目标近了（或长机转入攻击、返航）再散开各自攻击；
//    长机起飞后头几秒放慢等后面的飞机跟上（a.join）——
const EA_SLOT = [[0, 0], [-24, 20], [-24, -20], [-48, 40], [-48, -40], [-72, 60]];
function eaForm(a, dt, brk) {
  const L = S.eair.fly.find(o => o.id === a.lead && !o.dead);
  if (L && L.ph === 'rtb' && eaFtr(a.type) && !a.tg) a.ph = 'rtb';   // 歼击机长机返航：僚机跟着回
  const capOk = L && L.ph === 'cap' && eaFtr(L.type);   // 歼击机双机巡逻：僚机跟着长机飞跑马场航线
  const onGnd = L && (L.ph === 'roll' || L.ph === 'gnd' || L.ph === 'vto');   // 长机还在地面 / 垂直起飞中：先不跟
  if (!L || (L.ph !== 'out' && !onGnd && !capOk) || L.tg || a.tg || (brk && dist(a.x, a.y, a.tx, a.ty) < brk)) { if (!L || !onGnd) a.lead = null; return false; }
  if (onGnd) return false;
  const [sx0, sy0] = EA_SLOT[Math.min(a.slot || 1, EA_SLOT.length - 1)], k = a.type === 'heli' ? .8 : 1, h = L.heading, c = Math.cos(h), n = Math.sin(h);
  const px = L.x + c * sx0 * k - n * sy0 * k, py = L.y + n * sx0 * k + c * sy0 * k, err = (px - a.x) * c + (py - a.y) * n, sp = EA_SPEC[a.type];
  eaSteer(a, px + c * 40, py + n * 40, dt, clamp(L.spd + err * .9, L.spd * .6, sp.spd * 1.5));
  a.alt += (L.alt - a.alt) * Math.min(1, dt * 2);
  return true;
}
function eaFlyGA(a, dt) {
  if (a.ph === 'out' && a.lead != null && eaForm(a, dt, 460)) return;
  if (a.ph === 'out' && typeof atoIngressE === 'function' && atoIngressE(a, dt)) return;   // 先飞到起始点（ato.js 固定进入航线）
  if (a.ph === 'out' || a.ph === 'attack') {
    eaTrack(a);
    const d = eaSteer(a, a.tx, a.ty, dt, a.ph === 'out' && a.join > S.t ? EA_SPEC[a.type].spd * .7 : undefined);
    a.alt = a.ph === 'attack' ? Math.max(.35, a.alt - dt * .25) : Math.min(.7, a.alt + dt * .4);
    if (a.type === 'ga') eaAim9(a);
    // 真实战法：导弹告警就放干扰弹脱离；AGM-65 小牛在 380 外先打车辆 / 舰船；目标附近有我方已知防空，打完小牛即走，不进去通场；没小牛又防空太强就放弃
    const thr = typeof airThreats === 'function' ? airThreatAt(airThreats('e'), a.tx, a.ty, 30) : 0;
    if (typeof airMslWarn === 'function' && airMslWarn('e', 'eair', a.id) && a.ph === 'attack') { a.ph = 'egress'; a.egT = 2.5; a.pass = (a.pass || 0) + 1; eaStat('gaBreak'); }
    else if (a.mav > 0 && d < 380 && (a.tgt.k === 'veh' || a.tgt.k === 'ship') && S.t >= (a.mavT || 0) && Math.abs(eaAng(Math.atan2(a.ty - a.y, a.tx - a.x) - a.heading)) < .6) {
      if (a.mav0 == null) a.mav0 = a.mav;
      eaATGM(a); a.mav--; a.mavT = S.t + 1.4; eaStat('eaMav');
      log(`敌 A-10C 在 ${Math.round(d)} 米外发射 AGM-65 小牛导弹`, 'bad', 'eamav', 8, a);
      if (!a.mav && thr >= 1) { a.ph = 'egress'; a.egT = 2.5; a.ammo = 0; eaStat('gaStandoff'); }
    } else if (a.ph === 'out' && d < 700 && (!(a.mav > 0) || (a.tgt.k !== 'veh' && a.tgt.k !== 'ship')) && thr >= 2) { a.ph = 'rtb'; eaStat('gaAbort'); if (typeof chatSay === 'function') chatSay('e', `报告：${EA_SPEC[a.type].name}发现目标上空敌防空火力很强，小牛已打光，放弃通场返航。`, { kind: 'report', at: a, key: 'gaab', gap: 30, lv: 2 }); return; }
    if (a.ph === 'out' && d < 420) { a.ph = 'attack'; eaSpotSay(a); if (thr >= 1) a.pass = Math.max(a.pass || 0, 1); }   // 有防空：只通场一次
    if (a.ph === 'attack') {
      const df = Math.abs(eaAng(Math.atan2(a.ty - a.y, a.tx - a.x) - a.heading));
      if (d < 190 && df < .3 && a.ammo > 0) { if (!a.rkDone) { eaRockets(a, 6, 20, .6, a.tx, a.ty); a.rkDone = true; } eaStrafe(a); a.ammo--; a.ph = 'egress'; a.egT = 3; }   // 第一次通场火箭 + 机炮，之后只用机炮
      else if (d < 140 && df > 1.2) { a.ph = 'egress'; a.egT = 2.5; a.pass = (a.pass || 0) + 1; }   // 冲过头：拉起重新进入
    }
  } else if (a.ph === 'egress') {
    eaSteer(a, a.x + Math.cos(a.heading) * 200, a.y + Math.sin(a.heading) * 200, dt);
    a.alt = Math.min(.7, a.alt + dt * .3);
    if ((a.egT -= dt) <= 0) a.ph = a.ammo > 0 && !a.rkDone && !(a.mav0 > a.mav) && !(a.pass > 1) && !a.lost ? 'out' : 'rtb';   // 打完一波（打过火箭 / 小牛）就返航，不掉头再来；冲过头没打着的才重新进入一次
  } else eaRtb(a, dt);
}
// 直升机：在目标与机场连线上、离目标 340 处悬停（守方一侧），面向目标开火
function eaStandoff(a) {
  const b = eaNearBase(a.x, a.y) || { x: a.tx, y: 0 }, d = Math.max(1, dist(a.tx, a.ty, b.x, b.y)), r = Math.min(340, d * .8), o = ((a.slot || 0) % 2 ? 1 : -1) * Math.ceil((a.slot || 0) / 2) * 38 + Math.sin((a.hop || 0) * 1.9) * 110;   // 编队各机横向错开悬停；换位时再错开
  let x = a.tx + (b.x - a.tx) / d * r - (b.y - a.ty) / d * o, y = a.ty + (b.y - a.ty) / d * r + (b.x - a.tx) / d * o;
  // 真实战法：悬停点必须完全在我方已知防空圈外（含机组挨打记下的火力点），优先林地 / 高地遮蔽；地狱火射程内找不到就不进去（airwar.js heliSpot）
  a.noSafe = false;
  if (typeof heliSpot === 'function') {
    const p = heliSpot(a.tx, a.ty, r, 420, heliT('e', a), x, y, (px, py) => coverAt(px, py) * 2 + (elevAt(px, py) - elevAt(a.tx, a.ty)) * 3);
    if (p) { x = p.x; y = p.y; } else a.noSafe = true;
  }
  x = clamp(x, 20, W - 20); y = clamp(y, 20, H - 20);
  a.sx = x; a.sy = y; a.stx = a.tx; a.sty = a.ty;
}
// 这个目标阿帕奇能不能打：地狱火射程内有没有我方已知防空圈外的悬停点（派机前就筛掉，不派进去送）
function eaHeliOk(t) {
  if (typeof heliSpot !== 'function') return true;
  const b = eaNearBase(t.x, t.y) || { x: t.x, y: t.y - 400 };
  return !!heliSpot(t.x, t.y, 340, 420, airThreats('e'), b.x, b.y);
}
// 直升机返航（不硬闯）
function eaHeliAbort(a, why) {
  a.ph = 'rtb'; eaStat('heliAbortE');
  if (typeof chatSay === 'function') chatSay('e', `报告：${EA_SPEC[a.type].name}${why}，返航。`, { kind: 'report', at: { x: a.x, y: a.y }, key: 'heliab', gap: 30, lv: 2 });
}
// 直升机飞向 (x, y)：直线穿过我方已知防空圈就先飞绕行点
function eaHeliGo(a, x, y, dt, sp) {
  const v = typeof heliVia === 'function' ? heliVia(a.x, a.y, x, y, heliT('e', a).filter(t => dist(t.x, t.y, a.x, a.y) < t.r + 900)) : null;
  if (v) { eaSteer(a, v.x, v.y, dt); return Infinity; }
  return eaSteer(a, x, y, dt, sp);
}
function eaFlyHeli(a, dt) {
  a.alt = a.ph === 'rtb' ? Math.min(.3, a.alt + dt * .25) : Math.min(.3, a.alt + dt * .25);
  if (a.ph === 'out' && a.lead != null && eaForm(a, dt, 480)) return;
  if (a.ph === 'out' && typeof atoIngressE === 'function' && atoIngressE(a, dt)) return;   // 先飞到起始点（ato.js）
  if (a.ph === 'out') {
    eaTrack(a);
    if (a.sx == null || dist(a.tx, a.ty, a.stx, a.sty) > 80 || S.t - (a.sdT ?? -99) > 3) { eaStandoff(a); a.sdT = S.t; }   // 途中每 3 秒按新发现的防空重算悬停点
    if (a.noSafe) { const ok = eaRetarget(a, true); if (ok) eaStandoff(a); if (!ok || a.noSafe) { eaHeliAbort(a, '发现目标周边都在敌防空火力覆盖下，找不到安全的悬停发射位置'); return; } }
    const dd = dist(a.x, a.y, a.sx, a.sy), d = eaHeliGo(a, a.sx, a.sy, dt, dd < 90 ? Math.max(15, dd * .8) : undefined);
    if (d < 22 || (d < 60 && dist(a.x, a.y, a.tx, a.ty) < 390)) { a.ph = 'loiter'; a.loT = 12 + Math.random() * 28; a.fireT = 1.2; eaSpotSay(a); }
    if (a.lost && !eaRetarget(a, true)) a.ph = 'rtb';
  } else if (a.ph === 'loiter') {
    eaTrack(a);
    if (typeof airMslWarn === 'function' && airMslWarn('e', 'eair', a.id)) {   // 导弹告警：记下导弹从哪儿来，放干扰弹、低飞换一个避开它的位置；第二次就返航
      const m = S.missiles.find(o => o.kind === 'sam' && o.side === 'p' && !o.done && o.tgt && o.tgt.k === 'eair' && o.tgt.id === a.id);
      if (m && typeof heliShotAt === 'function') heliShotAt(a, m.x0, m.y0, m.src === 'dd' || m.src === 'esc' || m.src === 'cv' ? 600 : 300, 1);
      if ((a.shotN || 0) >= (typeof HELI === 'object' ? HELI.hits : 2)) { eaHeliAbort(a, '两次遭导弹攻击'); return; }
      a.hop = (a.hop || 0) + 1; a.ph = 'out'; a.sx = null; eaStat('heliBreak'); return;
    }
    if (a.shotT != null && S.t - a.shotT < .6 && a.shotSeen !== a.shotT) {   // 遭高炮 / 机枪射击：同样换位，挨打两次返航
      a.shotSeen = a.shotT;
      if ((a.shotN || 0) >= (typeof HELI === 'object' ? HELI.hits : 2)) { eaHeliAbort(a, '两次遭对空火力射击'); return; }
      a.hop = (a.hop || 0) + 1; a.ph = 'out'; a.sx = null; eaStat('heliBreak'); return;
    }
    a.spd = Math.max(0, a.spd - 60 * dt);
    const want = Math.atan2(a.ty - a.y, a.tx - a.x);
    a.heading = eaAng(a.heading + clamp(eaAng(want - a.heading), -2 * dt, 2 * dt)); a.bank = 0;
    a.x += (Math.cos(a.heading) * a.spd + Math.sin(S.t * .7 + a.id) * 4) * airK(a) * dt; a.y += (Math.sin(a.heading) * a.spd + Math.cos(S.t * .9 + a.id) * 3) * airK(a) * dt;
    if ((a.fireT -= dt) <= 0) { a.fireT = 3.5; eaHeliFire(a); }
    if ((a.loT -= dt) <= 0 || (a.atgm <= 0 && a.rk <= 0)) a.ph = 'rtb';
  } else eaRtb(a, dt);
}
function eaHeliFire(a) {
  if (a.lost && !eaRetarget(a, true)) { a.ph = 'rtb'; return; }
  const d = dist(a.x, a.y, a.tx, a.ty);
  if (d > 430) { a.ph = 'out'; a.sx = null; return; }
  if (a.atgm > 0 && (a.tgt.k === 'veh' || a.tgt.k === 'ship')) {   // 每打两发换一个悬停点；打完四发（一波）就返航
    eaATGM(a); a.atgm--;
    if ((a.shots = (a.shots || 0) + 1) >= 4) a.ph = 'rtb';
    else if (a.shots % 2 === 0) { a.hop = (a.hop || 0) + 1; a.ph = 'out'; a.sx = null; eaStat('heliHopE'); }
    return;
  }
  if (a.rk > 0) {
    let tg = null, bm = 0;   // 火箭：目标附近（或机下 380 以内）最密集的步兵
    for (const q of S.teams) {
      if (q.side !== 'p' || !q.men.length || q.ride || !spotted(q.x, q.y) || dist(q.x, q.y, a.x, a.y) > 380 || ownNear('e', q.x, q.y, 45)) continue;
      let m = 0; for (const o of S.teams) if (o.side === 'p' && o.men.length && !o.ride && dist(o.x, o.y, q.x, q.y) < 35) m += o.men.length;
      if (m > bm) { bm = m; tg = q; }
    }
    if (tg) { eaRockets(a, 4, 22, .9, tg.x, tg.y); a.rk--; if ((a.shots = (a.shots || 0) + 1) >= 4) a.ph = 'rtb'; return; }
  }
  if (!eaRetarget(a, true)) a.ph = 'rtb';
}
// 原目标没了：直升机就近另找车辆 / 舰船
function eaRetarget(a, safe) {   // safe：只挑悬停点能在防空圈外的目标
  let best = null, bv = 0;
  const ok = (x, y) => !safe || !(a.type === 'heli' || a.type === 'uh60') || eaHeliOk({ x, y });
  for (const v of S.veh || []) if (v.side === 'p' && !v.dead && !v.lst && spotted(v.x, v.y) && dist(v.x, v.y, a.x, a.y) < 450) { const val = EA_GUNV.includes(v.type) ? 6 : 4; if (val > bv && ok(v.x, v.y)) { bv = val; best = { k: 'veh', id: v.id, x: v.x, y: v.y }; } }
  if (!best) for (const s of S.ships) if (alive(s) && s.state === 'unloading' && dist(s.x, s.y, a.x, a.y) < 450 && ok(s.x, s.y)) { best = { k: 'ship', id: s.id, x: s.x, y: s.y }; break; }
  if (!best) return false;
  a.tgt = { k: best.k, id: best.id }; a.tx = best.x; a.ty = best.y; a.lost = false; a.sx = null;
  return true;
}
// 返航：固定翼回跑道完好的最近机场（都被炸了就回最近的、在上空等抢修）走进近着陆；直升机回直升机坪悬停降落
function eaRtb(a, dt) {
  const Hs = eaVtol(a.type) || a.type === 'heli' ? eaHomeSpot(a) : null;
  if (a.type === 'heli' && typeof heliVia === 'function' && a.ph !== 'vl') {   // 直升机返航：先绕出 / 绕开我方已知防空圈
    const b0 = Hs || eaNearBase(a.x, a.y), v = b0 ? heliVia(a.x, a.y, b0.x, b0.y, heliT('e', a).filter(t => dist(t.x, t.y, a.x, a.y) < t.r + 900)) : null;
    if (v) { eaSteer(a, v.x, v.y, dt); return; }
  }
  if (typeof atoEgressE === 'function' && atoEgressE(a, dt)) return;   // 返航先走出航点（ato.js），不原路折返
  if (Hs && (eaVtol(a.type) || Hs.farp)) { eaVLand(a, Hs, dt); return; }   // F-35B 垂直降落；疏散的直升机落到前沿加油弹药点
  const fw = a.type !== 'heli';
  let b = a.lb != null ? S.enemies.find(e => e.id === a.lb && !e.dead) : null;
  if (!b || (fw && b.cratT > S.t && a.ph !== 'land')) { b = eaNearBase(a.x, a.y, eaOpen()) || eaNearBase(a.x, a.y); a.lb = b ? b.id : null; }
  if (!b) {   // 没有机场可回：向北转场离开
    if (fw) a.alt = Math.min(.7, a.alt + dt * .3);
    eaSteer(a, a.x, -300, dt);
    if (a.y < -30) { a.dead = true; const w = S.eair.wing.find(w => w.id === a.wid); if (w) w.state = 'lost'; }
    return;
  }
  if (!fw) {
    const [px, py] = eaW(b, EA_PAD[0], EA_PAD[1]), dd = dist(a.x, a.y, px, py);
    if (eaSteer(a, px, py, dt, dd < 80 ? Math.max(12, dd * .4) : undefined) < 20) eaLanded(a);
    return;
  }
  if (a.lbPrev !== b.id) { a.lbPrev = b.id; a.ld = null; if (a.ph !== 'land') a.ph = 'rtb'; }
  if (a.ph !== 'final' && a.ph !== 'land') a.alt = a.alt > .3 ? Math.max(.3, a.alt - dt * .1) : Math.min(.3, a.alt + dt * .2);
  eaLand(a, b, dt);
}

// —— 弹药：火箭（齐射，落点散布）与反坦克导弹（制导，八成命中）——
function eaRockets(a, n, spread, dur, tx, ty) {
  const E = S.eair;
  for (let i = 0; i < n; i++) E.proj.push({ k: 'rk', x0: a.x, y0: a.y, tx: tx + gauss() * spread, ty: ty + gauss() * spread, t: -i * .08, dur });
  eaStat('eaAtk');
}
function eaATGM(a) {
  const o = eaTgtObj(a.tgt);
  if (!o) return;
  S.eair.proj.push({ k: 'atgm', x0: a.x, y0: a.y, x: a.x, y: a.y, tx: o.x, ty: o.y, t: 0, dur: Math.max(.6, dist(a.x, a.y, o.x, o.y) / 260), tgt: { ...a.tgt } });
  eaStat('eaAtk');
}
// 扫射：A-10C 的 GAU-8「复仇者」30 毫米机炮——目标 32 以内的我方小组重压制、有伤亡（掩体里少些），26 以内的车辆挨贫铀穿甲弹（轻装甲打得穿，主战坦克只伤皮毛）；其他机型只压制
function eaStrafe(a) {
  const gau = a.type === 'ga';
  for (const q of S.teams) if (q.side === 'p' && q.men.length && !q.ride && dist(q.x, q.y, a.tx, a.ty) < (gau ? 32 : 30)) {
    suppress(q, gau ? 55 : 30, a.x, a.y);
    if (gau && Math.random() < .35 * (1 - coverAt(q.x, q.y) * .5)) killMan(q);
  }
  if (gau) for (const v of S.veh || []) if (v.side === 'p' && !v.dead && !v.lst && dist(v.x, v.y, a.tx, a.ty) < 26) vehDamage(v, 12, 2.3, a.x, a.y, 'gau8');
  for (let i = 0; i < (gau ? 7 : 4); i++) tracer(a.x, a.y, a.tx + gauss() * 14, a.ty + gauss() * 14, 'e', true);
  if (gau) eaStat('gau8');
}
// A-10C 自卫：2 枚 AIM-9X「响尾蛇」空空导弹，打 260 以内、机头前方、低空的我方直升机 / 无人机 / 对地支援机
function eaAim9(a) {
  if (!(a.aim9 > 0) || S.t < (a.aimT || 0)) return;
  a.aimT = S.t + .5;
  let tg = null, bd = 260;
  for (const p of S.planes || []) {
    if (p.dead || p.alt < .15 || p.alt > .95 || (p.kind !== 'cas' && p.kind !== 'strike') || ['cat', 'roll', 'trap', 'final'].includes(p.phase)) continue;
    const d = dist(a.x, a.y, p.x, p.y);
    if (d > bd || Math.abs(eaAng(Math.atan2(p.y - a.y, p.x - a.x) - a.heading)) > 1 || S.missiles.some(m => !m.done && m.side === 'e' && m.tgt && m.tgt.k === 'plane' && m.tgt.id === p.id)) continue;
    bd = d; tg = p;
  }
  if (!tg) return;
  msLaunch('sam', 'e', a.x, a.y, { x: tg.x, y: tg.y }, { tgt: { k: 'plane', id: tg.id }, src: 'aam', spd: 560, dur: 1.8, pk: tg.v === 'heli' ? .6 : .5 });
  a.aim9--; a.aimT = S.t + 3; eaStat('aim9');
  log(`敌 A-10C 发射 AIM-9 响尾蛇导弹，攻击我${typeof airName === 'function' ? airName(tg.kind, tg.v).split(' ')[0] : '飞机'}`, 'bad', 'aim9', 6, a);
}
const eaMenNear = (x, y, r) => { let n = 0; for (const q of S.teams) if (q.side === 'p' && dist(q.x, q.y, x, y) < r) n += q.men.length; return n; };
function eaProj(dt) {
  const E = S.eair;
  for (const p of E.proj) {
    if (p.done || (p.t += dt) < 0) continue;
    if (p.k === 'atgm') {
      const o = eaTgtObj(p.tgt);
      if (o) { p.tx = o.x; p.ty = o.y; }
      const u = clamp(p.t / p.dur, 0, 1);
      p.x = lerp(p.x0, p.tx, u); p.y = lerp(p.y0, p.ty, u);
      if (u < 1) continue;
      p.done = true;
      if (o && Math.random() < .8) {
        if (p.tgt.k === 'veh') { vehDamage(o, 50, 4, p.x0, p.y0, 'atgm'); log(`${vehName(o)}被敌直升机反坦克导弹击中`, 'bad', 'eatgm' + o.id, 4, o); }   // 地狱火：攻顶，一发基本打掉一辆坦克
        else if (p.tgt.k === 'ship') { log(`${o.label} 被敌直升机反坦克导弹击中`, 'bad', 'eatgms' + o.id, 4, o); damageShip(o, 3); }
        S.fx.push({ kind: 'boom', x: p.tx, y: p.ty, r: 12, life: 0, max: .7, side: 'e' });
      } else S.fx.push({ kind: 'flash', x: p.tx + gauss() * 10, y: p.ty + gauss() * 10, r: 8, life: 0, max: .5, side: 'e' });
      continue;
    }
    if (p.t < p.dur) continue;
    p.done = true;
    const before = eaMenNear(p.tx, p.ty, POWER.erk.R);
    impact(p.tx, p.ty, POWER.erk, 'e');
    const k = before - eaMenNear(p.tx, p.ty, POWER.erk.R);
    if (k > 0) eaStat('eaKillMen', k);
  }
  E.proj = E.proj.filter(p => !p.done);
}

// —— 防空：双方单兵防空导弹组；我方自行高炮、舰空导弹、近防炮、机枪打直升机 ——
function eaAA() {
  const E = S.eair, fly = E ? E.fly.filter(a => !a.dead && a.alt > .1) : [];
  const busy = (side, k, id) => S.missiles && S.missiles.some(m => m.kind === 'sam' && m.side === side && !m.done && m.tgt && m.tgt.k === k && m.tgt.id === id);
  const canMs = typeof msLaunch === 'function';
  for (const q of S.teams) {
    if (!q.men.length || q.ride || !q.men.includes('aa')) continue;
    if (q.aam == null) q.aam = 3;
    q.aaCd = Math.max(0, (q.aaCd || 0) - .5);
    // 补弹：每 60 秒 1 枚（我方在接通的补给点附近，守方在本方据点附近）
    if (q.aam < 3 && S.t - (q.aaRe || 0) > 60) {
      const ok = q.side === 'p' ? (typeof nearestSupply === 'function' && (() => { const s = nearestSupply(q.x, q.y, true); return s && dist(s.x, s.y, q.x, q.y) < 120; })()) : S.points.some(p => p.owner === 'e' && dist(p.x, p.y, q.x, q.y) < 120);
      if (ok) { q.aam++; q.aaRe = S.t; }
    }
    if (!canMs || q.aam <= 0 || q.aaCd > 0 || q.sup >= 60 || S.t - q.movedT < .6) continue;
    let tg = null, bd = Infinity, k = null;
    if (q.side === 'e') {
      for (const p of S.planes) {
        if (p.dead || !(p.alt > .25) || ['cat', 'roll', 'trap', 'final'].includes(p.phase) || eaHigh(p) || eaHighUav(p)) continue;
        const r = (p.v === 'heli' ? 260 : p.kind === 'bomber' && p.v !== 'dive' ? 150 : 230) * ((typeof airStealth === 'function' ? airStealth(p) : 1) < 1 ? .8 : 1), d = dist(p.x, p.y, q.x, q.y);   // 隐身机红外特征也小些
        if (d < r && d < bd && !busy('e', 'plane', p.id)) { bd = d; tg = p; k = 'plane'; }
      }
    } else for (const a of fly) {
      const d = dist(a.x, a.y, q.x, q.y);
      if (eaHigh(a)) continue;
      if (d < (a.type === 'heli' ? 260 : 230) && d < bd && !busy('p', 'eair', a.id)) { bd = d; tg = a; k = 'eair'; }
    }
    if (!tg) continue;
    msLaunch('sam', q.side, q.x, q.y, { x: tg.x, y: tg.y }, { tgt: { k, id: tg.id }, src: 'manpads', dur: 2.2, spd: 380, sup: q.sup });
    q.aaCd = 7; q.aam--;
    eaStat('aaShot');
    if (q.side === 'e') { q.seen = S.t; q.sx = q.x; q.sy = q.y; q.aaSeen = S.t; q.aax = q.x; q.aay = q.y; log('敌单兵防空导弹发射，位置暴露', 'warn', 'emanpads', 8, q); }
    else { q.aaSeenE = S.t; if (E) E.flash.push({ x: q.x, y: q.y, t: S.t }); }
  }
  if (!fly.length) return;
  const hit = (a, how, p) => {
    if (Math.random() >= p) return false;
    if ((a.hp -= 1) <= 0) eaLost(a, how); else if (a.ph !== 'rtb') { a.ph = 'rtb'; log(`敌${EA_SPEC[a.type].name}中弹${a.type === 'c17' ? `（剩余耐久 ${a.hp}）` : '，放弃攻击'}`, 'good', 'eahit' + a.id, 6, a); }
    return true;
  };
  const D = typeof msDefShips === 'function' ? msDefShips() : [];
  for (const a of fly) {
    a.pv = PV[ci(clamp(a.x, 0, W - 1), clamp(a.y, 0, H - 1))] === 1 || S.teams.some(q => q.side === 'p' && q.men.length && dist(q.x, q.y, a.x, a.y) < 400) || (S.veh || []).some(v => v.side === 'p' && !v.dead && dist(v.x, v.y, a.x, a.y) < 400);
    let gone = false;
    for (const v of S.veh || []) {
      if (gone || v.dead || v.side !== 'p' || !vehSp(v).aa || v.lst || eaHigh(a) || dist(v.x, v.y, a.x, a.y) > vehSp(v).aa) continue;   // 自行高炮、弹炮防空车的机炮
      for (let i = 0; i < 3; i++) tracer(v.x, v.y, a.x + gauss() * 10, a.y + gauss() * 10, 'p', true);
      if (a.type === 'heli' && typeof heliShotAt === 'function') heliShotAt(a, v.x, v.y, (vehSp(v).aa || 230) + 20, 1.3);
      if (hit(a, 'aa', .1)) gone = a.dead;
    }
    for (const s of D) {
      if (gone) break;
      const d = dist(s.x, s.y, a.x, a.y);
      if (d < (s.esc ? 260 : 300) && !eaHigh(a)) {   // 近防炮
        for (let i = 0; i < 2; i++) tracer(s.x, s.y, a.x + gauss() * 8, a.y + gauss() * 8, 'p', true);
        if (a.type === 'heli' && typeof heliShotAt === 'function') heliShotAt(a, s.x, s.y, s.esc ? 560 : 660, 3);
        if (hit(a, 'ciws', s.esc ? .05 : a.type === 'heli' ? .1 : .06)) gone = a.dead;
      } else if (canMs && d < (s.esc ? 550 : 650) * Math.min(1, (typeof eaStl === 'function' ? eaStl(a) : (EA_SPEC[a.type] && EA_SPEC[a.type].stealth) || 1) * 1.2) && (s.o.samCd || 0) <= S.t && !busy('p', 'eair', a.id) && (typeof vlsUse !== 'function' || vlsUse(s.o, 'sam'))) {   // 舰空导弹（垂发里的红旗-9B，打光就只剩近防炮）；隐身机要飞得更近才被舰载雷达锁定
        s.o.samCd = S.t + (s.esc ? 5 : 4);
        msLaunch('sam', 'p', s.x, s.y, { x: a.x, y: a.y }, { tgt: { k: 'eair', id: a.id }, src: s.esc ? 'esc' : 'dd', spd: 520, dur: 3 });
        eaStat('aaShot');
      }
    }
    if (typeof cvDefs === 'function') for (const s of cvDefs()) {   // 航母：近防炮 + 红旗-10
      if (gone) break;
      const d = dist(s.x, s.y, a.x, a.y);
      if (d < CV_DEF.cwR && !eaHigh(a)) { for (let i = 0; i < 3; i++) tracer(s.x, s.y, a.x + gauss() * 8, a.y + gauss() * 8, 'p', true); if (hit(a, 'ciws', a.type === 'heli' ? .12 : .08)) gone = a.dead; }
      else if (canMs && d < CV_DEF.hqR && !eaHigh(a) && (s.o.hqCd || 0) <= S.t && s.o.hq10 > 0 && !busy('p', 'eair', a.id)) {
        s.o.hqCd = S.t + 3; s.o.hq10--;
        msLaunch('sam', 'p', s.x, s.y, { x: a.x, y: a.y }, { tgt: { k: 'eair', id: a.id }, src: 'cv', spd: 560, dur: 2 });
        eaStat('cvHq10');
      }
    }
    if (!gone && a.type === 'heli') for (const q of S.teams) {   // 机枪打直升机
      if (q.side !== 'p' || !q.men.includes('mg') || q.ride || q.sup >= 60 || dist(q.x, q.y, a.x, a.y) > 150) continue;
      tracer(q.x, q.y, a.x + gauss() * 6, a.y + gauss() * 6, 'p', true);
      if (typeof heliShotAt === 'function') heliShotAt(a, q.x, q.y, 170, .6);
      if (hit(a, 'mg', .02)) { gone = a.dead; if (gone) break; }
    }
  }
}
// 击落一架守方飞机：空中爆炸 + 翻滚坠落 2 秒
function eaLost(a, how) {
  if (!a || a.dead) return;
  a.dead = true;
  if ((a.type === 'uh60' || a.type === 'c17') && typeof a101Down === 'function') a101Down(a);
  if (a.type === 'b2' && typeof b2Down === 'function') b2Down(a);   // B-2A 机群少一架（b2.js）   // 空降运输机：机上的人员装备一起损失
  const E = S.eair, w = E && E.wing.find(w => w.id === a.wid);
  if (w) w.state = 'lost';
  S.fx.push({ kind: 'boom', x: a.x, y: a.y, r: 20, life: 0, max: 1, side: 'e' });
  if (E) E.wr.push({ x: a.x, y: a.y, h: a.heading, spd: Math.min(70, a.spd * .4 + 10), t: S.t, type: a.type, hit: false });
  eaStat('eaLost');
  const nm = EA_SPEC[a.type].name, by = { manpads: '便携防空导弹', sam: '舰空导弹', samv: '弹炮防空车', aa: '防空车机炮', mg: '机枪火力', ciws: '舰上近防炮', aam: '我方战斗机空空导弹', aaml: '歼-36 的霹雳-17 远程空空导弹', gun: '我方战斗机机炮', nuke: '核爆冲击波' }[how] || '防空火力';
  log(`${by}击落敌${nm}`, 'good', null, 0, a);
  if (typeof chatSay === 'function') {
    chatSay('p', `报告：${by}击落敌${nm} 1 架。`, { kind: 'report', at: { x: a.x, y: a.y }, key: 'eakill' + a.id, gap: 5 });
    chatSay('e', `报告：一架${nm}未能返航。`, { kind: 'report', lv: 1, key: 'ealost', gap: 20 });
  }
}
// 我方发现来袭敌机：报告 + 补救（便携防空组就地停下对空、自动指挥的自行高炮前出掩护）
function eaSpotSay(a) {
  if (a.said) return;
  a.said = true;
  const nm = EA_SPEC[a.type].name, o = eaTgtObj(a.tgt), what = !o ? '前沿阵地' : a.tgt.k === 'ship' ? `${o.label}登陆舰` : a.tgt.k === 'veh' ? vehName(o) : '步兵';
  if (typeof chatSay !== 'function') return;
  if (!a.pv && !specAll()) return;
  chatSay('p', `报告：敌${nm}出现在${eaWhere(a.x, a.y)}，正扑向我${what}。`, { kind: 'report', at: { x: a.x, y: a.y }, key: 'easpot', gap: 25 });
  let n = 0;
  for (const q of S.teams) if (q.side === 'p' && q.men.includes('aa') && (q.aam ?? 3) > 0 && dist(q.x, q.y, a.tx, a.ty) < 450) {
    const u = unitOf(q);
    if (u && u.auto && q.order.t !== 'charge') { q.order = { t: 'hold' }; n++; }
  }
  for (const v of S.veh || []) if (v.side === 'p' && !v.dead && (v.type === 'aa_veh' || v.type === 'sam_veh') && v.auto && dist(v.x, v.y, a.tx, a.ty) < 700 && typeof vehGo === 'function') {
    const d = Math.max(1, dist(v.x, v.y, a.tx, a.ty)), k = Math.max(0, d - (v.type === 'sam_veh' ? 300 : 140)) / d;
    if (vehGo(v, v.x + (a.tx - v.x) * k, v.y + (a.ty - v.y) * k, 'move')) n++;
  }
  if (n) chatSay('p', '命令：便携防空组就地对空，自行高炮前出掩护。', { kind: 'remedy', at: { x: a.tx, y: a.ty }, key: 'earem', gap: 40 });
}

// —— 出击决策（每 3 秒，守方所知）：卸载中的登陆舰 8、坦克 6、装甲车 4、密集步兵 人数·0.6、补给站 5；
//    已知我方防空每处 −6、驱逐舰 300 以内 −4；够 6 分才出击，两次出击至少间隔 gap 秒 ——
function eaTargets() {
  const out = [], radar = typeof radarUp === 'function' ? radarUp() : null;
  for (const s of S.ships) if (alive(s) && (s.state === 'unloading' || (s.load && s.load.teams > 0 && s.y < coastAt(s.x) + 380)) && shipSeen(s.x, s.y, radar)) out.push({ k: 'ship', id: s.id, x: s.x, y: s.y, v: s.state === 'unloading' ? 8 : 6, nm: `${s.label}登陆舰` });
  for (const v of S.veh || []) if (v.side === 'p' && !v.dead && !v.lst && spotted(v.x, v.y)) out.push({ k: 'veh', id: v.id, x: v.x, y: v.y, v: EA_GUNV.includes(v.type) ? 6 : v.type === 'apc' ? 4 : v.type === 'aa_veh' || v.type === 'sam_veh' ? 0 : 3, nm: vehName(v) });
  const pT = S.teams.filter(q => q.side === 'p' && q.men.length && !q.ride && spotted(q.x, q.y));
  for (const q of pT) { let m = 0; for (const o of pT) if (dist(o.x, o.y, q.x, q.y) < 50) m += o.men.length; if (m >= 9) out.push({ k: 'team', id: q.id, x: q.x, y: q.y, v: m * .6, nm: `${m} 人的集结步兵` }); }
  for (const L of S.supply) if (L.connected && spotted(L.x, L.y)) out.push({ k: 'pt', x: L.x, y: L.y, v: 5, nm: '滩头补给站' });
  if (typeof abeAirTargets === 'function') out.push(...abeAirTargets());   // 集结中的空降场（abn.js）
  const CA = S.ai && S.ai.co && S.ai.co.ca;
  if (CA) for (const c of CA) if (c.st === 'prep') { const p = S.points.find(p => p.key === c.key); if (p) out.push({ k: 'pt', x: p.x, y: p.y, v: 7, nm: `${p.name}的守敌` }); }
  const aaV = (S.veh || []).filter(v => v.side === 'p' && !v.dead && (v.type === 'aa_veh' || v.type === 'sam_veh') && (spotted(v.x, v.y) || (v.es != null && S.t - v.es < 120)));
  const aaQ = S.teams.filter(q => q.side === 'p' && q.men.length && q.men.includes('aa') && q.aaSeenE != null && S.t - q.aaSeenE < 120);
  const dd = S.dd && S.dd.state !== 'sunk' ? S.dd : null;
  for (const t of out) {
    t.v -= 6 * (aaV.filter(v => dist(v.x, v.y, t.x, t.y) < (v.type === 'sam_veh' ? 450 : 260)).length + aaQ.filter(q => dist(q.x, q.y, t.x, t.y) < 260).length);
    if (dd && dist(dd.x, dd.y, t.x, t.y) < 300) t.v -= 4;
    if (typeof awFleetCover === 'function' && awFleetCover(t.x, t.y)) { t.v -= 5; t.fc = true; }   // 我舰队防空伞里：单机进去就是送，除非目标价值很高才两机一起去
    if (ownNear('e', t.x, t.y, 55)) t.v = 0;
  }
  return out;
}
// 一个编队起飞：fl 待命的在册飞机（第一架为长机，派几架飞几架，不再带不占名额的僚机）；tgt(i) 第 i 架的目标；后面几架编入长机队形（eaForm），长机放慢等它们集合
function eaPkg(b, fl, tgt) {
  const E = S.eair;
  let lead = null;
  fl.forEach((w, i) => {
    const T = tgt(i);
    const L = eaFtr(w.type) ? EA_FTR[w.type] : null, FT = L ? { role: 'strike', cx: T.x, cy: T.y, capT: 40, aam: Math.min(2, L.aam), gun: L.gun, aamR: L.aamR, pkK: L.pkK, gunK: L.gunK || 1, sdb: L.sdb || 4 } : {};   // F-35 对地：4 枚 GBU-53/B 小直径炸弹 + 2 枚 AIM-120D 自卫
    const a = eaNewAir(b, w, T.x + (i % 2 ? gauss() * 20 : 0), T.y + (i % 2 ? gauss() * 20 : 0), { tgt: { k: T.k, id: T.id }, ammo: 1, atgm: w.type === 'heli' ? 2 : 0, rk: w.type === 'heli' ? 2 : 0, mav: w.type === 'ga' ? 2 : 0, aim9: w.type === 'ga' ? 2 : 0, ...(w.type === 'ga' ? { ammo: 2 } : {}), ...FT });   // A-10C：2 枚 AGM-65、2 枚 AIM-9X、机炮两次通场
    if (i) { a.lead = lead.id; a.slot = i; if (a.wait == null) { a.x += 14 * i; a.y += i % 2 ? 8 : -8; } }   // 直升机并排离坪；固定翼按跑道排队依次滑跑
    else { lead = a; a.join = S.t + (a.wait || 0) + 4 + 3.5 * (fl.length - 1); }
    w.state = 'out';
    E.fly.push(a);
  });
  // 综合打击群：攻击机编队、三机以上的武装直升机编队都配歼击机扫荡与护航（airwar.js）
  if (lead && typeof awEscortE === 'function' && (fl[0].type === 'ga' || fl.length >= 3)) { const T = tgt(0); awEscortE(T.x, T.y, `${EA_SPEC[fl[0].type].name}编队`, lead); }
  return lead;
}
// 总攻 / 反冲击的航空火力（ai5.js 调用）：待命的武装直升机（最多 5 架）、攻击机（最多 4 架）各编一个队同时出动，打 (x, y) 一带的目标；不受出击间隔限制
function eaMass(x, y, nm) {
  const E = S.eair;
  if (!E || !eaOn() || (typeof atoPhase === 'function' && atoPhase('e') < 3)) return 0;   // 空中作战计划：近距支援阶段才配合总攻
  const all = eaBases(), open = eaOpen();
  if (!all.length) return 0;
  const tg = eaTargets().filter(t => dist(t.x, t.y, x, y) < 400 && t.v > 0).sort((p, q) => q.v - p.v), pt = { k: 'pt', x, y, v: 6, nm: nm || '总攻目标' }, tgH = tg.filter(eaHeliOk);
  let n = 0;
  const said = [];
  for (const type of ['heli', 'ga']) {
    const ws = E.wing.filter(w => w.state === 'ready' && w.type === type && (type === 'heli' || open.length)).slice(0, type === 'heli' ? 5 : 4), L = type === 'heli' ? tgH : tg;
    if (!ws.length || (type === 'heli' && !L.length && !eaHeliOk(pt))) continue;   // 直升机：总攻方向全在防空圈里就不派
    eaPkg(eaNearBase(x, y, type === 'heli' ? all : open), ws, i => L[Math.floor(i / 2) % Math.max(1, L.length)] || pt);
    n += ws.length; said.push(`${EA_SPEC[type].name} ${ws.length} 架`);
  }
  if (!n) return 0;
  E.nextT = Math.max(E.nextT, S.t + E.gap * .5);
  eaStat('eaMass', n);
  if (typeof chatSay === 'function') chatSay('e', `命令：${said.join('、')}编队同时出击，支援${eaWhere(x, y)}方向的${nm || '总攻'}，打掉当面之敌的坦克和集结的步兵。`, { kind: 'order', at: { x, y }, lv: 0 });
  return n;
}
const EA_PREF = { heli: { veh: 1.3, ship: 1.1, team: .9, pt: .8 }, ga: { veh: 1, ship: 1.3, team: 1.2, pt: 1.1 }, ftr: { veh: 1.15, ship: 1.2, team: .6, pt: .8 }, ftrb: { veh: 1.15, ship: 1.2, team: .6, pt: .8 } };   // F-35：小直径炸弹点目标精确，打车、打舰最划算
function eaThink() {
  const E = S.eair, all = eaBases(), open = eaOpen();
  if (!all.length && !E.farp) return;
  // 两次出击间隔 gap 秒；另一机种可提前一半时间出动（直升机与攻击机各打各的）；固定翼要有跑道完好的机场，直升机从直升机坪起飞不受弹坑影响
  // 空中作战计划（ato.js）：第一阶段不出对地飞机；第二阶段只出 A-10C 打防空车；第三阶段全部放开
  const ph = typeof atoPhase === 'function' ? atoPhase('e') : 3;
  if (ph < 2) return;
  const ready = E.wing.filter(w => w.state === 'ready' && (ph >= 3 || w.type === 'ga') && (((w.type === 'heli' || eaVtol(w.type)) && all.length) || (w.farp && E.farp) || open.length) && S.t >= E.first && (S.t >= E.nextT || (E.lastType && w.type !== E.lastType && S.t >= E.nextT - E.gap / 2)));
  if (!ready.length) return;
  // 制空权（airwar.js）：敌方掌握时只打高价值目标、不进敌战斗机巡逻区；我方掌握时出击间隔缩短
  const AW = typeof awState === 'function' ? awState() : null, capP = AW === 'p' ? S.planes.filter(p => !p.dead && p.kind === 'fighter' && (p.phase === 'loiter' || p.phase === 'out')) : [];
  let best = null, bs = AW === 'p' ? 10 : 6, bw = null;
  // F-35A / F-35B 也挂小直径炸弹出对地打击：制空权不在敌手、手里的歼击机够留一个双机巡逻时才派（F-35B 不要跑道）
  const ftrUp = E.fly.filter(a => !a.dead && eaFtr(a.type) && a.role !== 'strike').length, ftrRdy = E.wing.filter(w => eaFtr(w.type) && w.state === 'ready').length;
  const quiet = typeof awEnsure === 'function' && S.t - (awEnsure().seenP ?? -999) > 60;   // 近一分钟没见到敌机
  const ftrOk = ph >= 3 && AW !== 'p' && (ftrUp + ftrRdy >= 3 || (ftrUp + ftrRdy >= 2 && (quiet || AW === 'e')));
  for (const t of ph === 2 ? atoSeadTgtE() : eaTargets()) for (const type of ph === 2 ? ['ga'] : ftrOk ? ['heli', 'ga', 'ftrb', 'ftr'] : ['heli', 'ga']) {
    const w = ready.find(w => w.type === type && (type !== 'ftr' || open.length || w.farp));
    if (!w || capP.some(p => dist(p.cx, p.cy, t.x, t.y) < 500)) continue;
    if (t.fc && ready.filter(o => o.type === type).length < 2) continue;   // 舰队防空伞里的目标：凑不齐双机不去
    if (type === 'heli' && !eaHeliOk(t)) continue;   // 阿帕奇：找不到防空圈外的悬停发射点的目标不派
    const s = t.v * EA_PREF[type][t.k];
    if (s >= bs) { bs = s; best = t; bw = w; }
  }
  if (!best) return;
  const b = (all.length ? eaNearBase(best.x, best.y, bw.type === 'heli' || eaVtol(bw.type) ? all : open) : null) || eaFarpBase(), sp = EA_SPEC[bw.type];
  // 编队（都是在册飞机）：同型待命的有两架以上就出双机（打同一目标、错开 2 秒），只剩一架就单机；目标价值高或阿帕奇再凑到四机——后两架打附近另一个目标；
  // 直升机并排离坪
  const same = ready.filter(w => w !== bw && w.type === bw.type), four = same.length >= 2 && (bw.type === 'heli' || bs >= 8) && !eaFtr(bw.type);   // 歼击机对地：最多双机
  const fl = [bw, ...same.slice(0, four ? 3 : 1)], nA = fl.length;
  const T2 = four ? eaTargets().filter(t => !(t.k === best.k && t.id === best.id) && dist(t.x, t.y, best.x, best.y) > 80 && dist(t.x, t.y, best.x, best.y) < 600 && t.v * EA_PREF[bw.type][t.k] >= bs * .5)
    .sort((p, q) => q.v * EA_PREF[bw.type][q.k] - p.v * EA_PREF[bw.type][p.k])[0] : null;
  eaPkg(b, fl, i => i >= 2 && T2 ? T2 : best);
  E.nextT = S.t + E.gap * (AW === 'e' ? .6 : 1) * (nA > 2 ? 1.25 : 1.1); E.lastType = bw.type;
  eaStat('eaSortie', nA);
  if (typeof chatSay === 'function') chatSay('e', `命令：${sp.name}${['单机', '双机', '三机', '四机'][nA - 1]}${nA > 1 ? '编队' : ''}出击，打击${eaWhere(best.x, best.y)}的${best.nm}${T2 ? `，其中一部打击${eaWhere(T2.x, T2.y)}的${T2.nm}` : ''}。`, { kind: 'order', at: { x: best.x, y: best.y }, lv: 1, key: 'easort', gap: 15 });
}
// 已知（被我方看到发射过）的敌单兵防空组：攻方派机时避开
function eaThreat(x, y) {
  let n = 0;
  if (!S) return 0;
  for (const q of S.teams) if (q.side === 'e' && q.men.length && q.aaSeen != null && S.t - q.aaSeen < 120 && q.men.includes('aa') && dist(q.aax, q.aay, x, y) < 260) n++;
  return n;
}

// 机场中弹：跑道上留下弹坑（b.rc），固定翼 60 秒内无法起降（工兵抢修）；停机坪上的爆炸可能毁掉机位上的飞机（防爆墙挡住大部分破片）；
// 落在跑道、停机坪一带也损伤机场本身（中心附近的直接伤害由 combat.js impact 结算，这里补跑道两端与停机坪）
function eaImpact(x, y, R, pw, side) {
  if (side !== 'p' || !eaOn()) return;
  if (S.eair && S.eair.farp && dist(x, y, S.eair.farp.x, S.eair.farp.y) < 120 + R) for (const P of eaFarpParked()) {   // 野地上停着的飞机没有机堡遮挡
    const d = dist(x, y, P.x, P.y);
    if (d < R * .7 + 8 && Math.random() < (d < 10 ? .9 : .55)) { P.w.state = 'lost'; if (eaFarpSeen()) log(`敌${EA_SPEC[P.w.type].name}在前沿加油弹药点被炸毁`, 'good', null, 0, { x, y }); }
  }
  for (const b of S.enemies) if (b.kind === 'airfield' && b.dead && b.rb != null && eaFacDist(b, x, y) < R + 6) { b.hitE = S.t; b.rb = Math.max(0, b.rb - .15 * Math.max(.5, (pw.struct || 3) / 7)); }   // 重建中的机场挨炸：进度倒退
  for (const b of eaBases()) {
    const [u, v] = eaL(b, x, y);
    if (Math.abs(u) > 560 + R || v < -190 - R || v > 630 + R) continue;
    if (Math.abs(u) < EA_RW.hl + R * .3 && Math.abs(v) < EA_RW.hw + R * .4) {
      b.cratT = Math.max(b.cratT || 0, S.t + 60);
      (b.rc || (b.rc = [])).push({ u: Math.round(clamp(u, -455, 455)), v: Math.round(clamp(v, -13, 13)), r: Math.round(clamp(R * .25, 4, 12)) });
      if (b.rc.length > 10) b.rc.shift();
      if (eaBaseSeen(b)) log('敌野战机场跑道中弹，敌固定翼飞机暂时无法起降', 'good', 'eacrat', 20, b);
    }
    for (const P of eaParked(b)) {   // 机堡挡得住大部分破片，只怕近处直接命中
      const d = Math.hypot(u - P.u, v - P.v), has = P.k === 'has';
      if (d < (has ? R * .35 + 3 : R * .6 + 8) && Math.random() < (has ? .3 : d < 12 ? .85 : .4)) {
        P.w.state = 'lost';
        if (eaBaseSeen(b)) log(`敌${EA_SPEC[P.w.type].name}在机位上被炸毁`, 'good', null, 0, { x, y });
      }
    }
    if (pw.struct && dist(x, y, b.x, b.y) >= R + 4) { const d = eaFacDist(b, x, y); if (d < R + 6) damageEnemy(b, pw.struct * .3 * (1 - d / (R + 6) * .4)); }
  }
}
// 守方视野：飞机（半径 120）与我方防空导弹的发射尾焰（2 秒，半径 60）
function eaVision() {
  if (!S || !S.eair || !eaOn()) return [];
  const o = [];
  for (const a of S.eair.fly) if (!a.dead && a.alt > .1 && a.type !== 'b2') o.push({ x: a.x, y: a.y, r: 120, h: 1.5 });   // B-2A 只管轰炸，不当侦察用
  for (const f of S.eair.flash) o.push({ x: f.x, y: f.y, r: 60, h: .5 });
  return o;
}

// —— 绘制 ——
function eaDraw(time) {
  if (!S || !S.eair || !eaOn() || typeof R !== 'object' || !R.ctx) return;
  const ctx = R.ctx, E = S.eair, spec = specAll(), lw = px(1.3);
  // 弹药（机场与停在机位上的飞机在地面层画：afbase.js eaDrawBases）
  for (const p of E.proj) {
    if (p.t < 0 || p.done || R.fx3d) continue;   // 3D 时立体画（v3fx.js）
    if (!spec && !inVision(p.tx, p.ty) && !inVision(p.x0, p.y0)) continue;
    if (p.k === 'rk') {
      const u = clamp(p.t / p.dur, 0, 1), x = lerp(p.x0, p.tx, u), y = lerp(p.y0, p.ty, u), a = Math.atan2(p.ty - p.y0, p.tx - p.x0);
      ctx.strokeStyle = rgba(COL.enemy, .9); ctx.lineWidth = px(1.6); ctx.beginPath(); ctx.moveTo(x - Math.cos(a) * 9, y - Math.sin(a) * 9); ctx.lineTo(x, y); ctx.stroke();
      ctx.fillStyle = rgba(COL.amber, .9); ctx.beginPath(); ctx.arc(x, y, Math.max(.8, px(1.6)), 0, 7); ctx.fill();
    } else {
      ctx.strokeStyle = rgba(COL.enemy, .55); ctx.lineWidth = px(1); ctx.beginPath(); ctx.moveTo(p.x0, p.y0); ctx.lineTo(p.x, p.y); ctx.stroke();
      ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(1, px(2.2)), 0, 7); ctx.fill();
    }
  }
  // 坠落残骸：翻滚、拖烟
  for (const w of E.wr) {
    const age = S.t - w.t, x = w.x + Math.cos(w.h) * w.spd * age, y = w.y + Math.sin(w.h) * w.spd * age;
    if (!spec && !inVision(x, y)) continue;
    ctx.strokeStyle = rgba(COL.smoke, .35); ctx.lineWidth = px(3); ctx.beginPath(); ctx.moveTo(w.x, w.y); ctx.lineTo(x, y); ctx.stroke();
    if (typeof drawAircraft === 'function') drawAircraft(ctx, x, y, w.h + age * 5, eaSil(w.type), 14 * (1 - age * .2), COL.enemy, .6 * (1 - age / 2.4), 0, lw);
  }
  // 飞机：固定翼尾迹 + 地面投影 + 剪影；直升机加旋转的主旋翼；歼击机开炮时机头口焰
  if (EA_TRAILS.size) { const ids = new Set(E.fly.map(a => a.id)); for (const id of [...EA_TRAILS.keys()]) if (!ids.has(id)) EA_TRAILS.delete(id); }
  for (const a of E.fly) {
    if (a.dead || !(spec || a.pv || inVision(a.x, a.y))) continue;
    if (R.m3d) continue;   // 3D：立体模型（v3units.js；地面滑行、滑跑放下起落架）
    const heli = a.type === 'heli' || a.type === 'uh60', big = a.type === 'c17' || a.type === 'b2', size = big ? Math.max(28, px(30)) : Math.max(heli ? 15 : 17, px(heli ? 17 : 19));
    if (!heli && a.alt > .2) {
      let tr = EA_TRAILS.get(a.id);
      if (!tr) EA_TRAILS.set(a.id, tr = []);
      const l = tr[tr.length - 1];
      if (!l || dist(l[0], l[1], a.x, a.y) > 6) { tr.push([a.x, a.y]); if (tr.length > 22) tr.shift(); }
      ctx.lineWidth = px(1.2);
      for (let i = 1; i < tr.length; i++) { ctx.strokeStyle = rgba(COL.enemy, .15 * i / tr.length); ctx.beginPath(); ctx.moveTo(tr[i - 1][0], tr[i - 1][1]); ctx.lineTo(tr[i][0], tr[i][1]); ctx.stroke(); }
    }
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(a.x + a.alt * 14, a.y + a.alt * 22, size * .35, size * .22, a.heading, 0, 7); ctx.fill();
    if (typeof drawAircraft === 'function') drawAircraft(ctx, a.x, a.y, a.heading, eaSil(a.type), size, COL.enemy, 1, a.bank || 0, lw, undefined, { t: time, ...(typeof airRelState === 'function' ? airRelState('e', a.id) : null) });   // 弹舱开度、外挂消耗（airmdl.js）
    if (a.gunT > 0) { const nx = a.x + Math.cos(a.heading) * size * .55, ny = a.y + Math.sin(a.heading) * size * .55; ctx.fillStyle = rgba('#fff3d6', .5 + .5 * Math.sin(time * 60)); ctx.beginPath(); ctx.arc(nx, ny, size * .14, 0, 7); ctx.fill(); }
    if (heli && !(typeof AIRD === 'object' && AIRD[eaSil(a.type)] && size * R.s >= 26)) {   // 精细模型自己画旋翼（airmdl.js）
      const r = size * 9.5 / 21, cx = a.x + Math.cos(a.heading) * size * 1.5 / 21, cy = a.y + Math.sin(a.heading) * size * 1.5 / 21, ang = time * 22 + a.id;
      ctx.strokeStyle = rgba(COL.enemy, .6); ctx.lineWidth = px(1.2); ctx.beginPath();
      for (let k = 0; k < 2; k++) { const b = ang + k * Math.PI / 2; ctx.moveTo(cx - Math.cos(b) * r, cy - Math.sin(b) * r); ctx.lineTo(cx + Math.cos(b) * r, cy + Math.sin(b) * r); }
      ctx.stroke();
    }
  }
}

HOOK.step.push(eaStep);
HOOK.impact.push(eaImpact);
HOOK.visionE.push(eaVision);
HOOK.drawOver.push(eaDraw);
