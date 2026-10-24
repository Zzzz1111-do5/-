'use strict';
// 守方航空（v7）：野战机场 → 对地攻击机（一次通场：6 枚火箭齐射 + 机炮扫射）与武装直升机（300–380 外悬停，反坦克导弹 + 火箭）；
// 双方单兵防空导弹组（防空导弹在 missile.js 飞行与结算）；我方自行高炮、驱逐舰舰空导弹与近防炮、机枪打直升机；
// 守方视野（飞机是视野源）、绘制（剪影、旋翼、火箭、导弹、残骸，只用形状）
// 状态：S.eair = { wing: [{id, type, state: ready|out|rearm|lost, rearmT}], fly: [飞机], proj: [弹药], wr: [残骸], flash: [发射暴露], cratT, nextT, first, gap }
const eaOn = () => !!S && !(S.v7off && S.v7off.air);
const eaStat = (k, n = 1) => { const o = S.v7s || (S.v7s = {}); o[k] = (o[k] || 0) + n; };
POWER.erk = { men: .45, ship: 2, struct: 0, seg: false, R: 18 };   // 机载火箭（守方只打进攻方，不伤自家工事）
const EA_DIFF = { normal: { wing: ['heli'], first: 210, gap: 150 }, hard: { wing: ['ga', 'heli', 'ftr'], first: 150, gap: 100 }, hell: { wing: ['ga', 'ga', 'heli', 'ftr', 'f22'], first: 100, gap: 70 } };
// 守方（美军）：A-10C 慢而皮实（钛合金座舱浴盆，挨一发还能飞），AH-64E，F-35A 隐身（我方雷达发现距离打折），F-22A 更隐身、超音速巡航、推力矢量
const EA_SPEC = { ga: { name: 'A-10C 攻击机', spd: 170, turn: 1.4, hp: 2, flares: 2 }, heli: { name: 'AH-64E 武装直升机', spd: 90, turn: 2.4, hp: 2, flares: 1 },
  uh60: { name: 'UH-60M 黑鹰运输直升机', spd: 85, turn: 2.2, hp: 2, flares: 1 },
  c17: { name: 'C-17A 环球霸王 III 运输机', spd: 150, turn: .9, hp: 4, flares: 3 },   // 第 101 空降师空降（a101.js）：大、慢、扛打
  ftr: { name: 'F-35A 战斗机', spd: 240, turn: 1.9, hp: 1, flares: 2, stealth: .45 },   // 守方按美军装备命名   // 歼击机：巡逻、拦截、争夺制空权（airwar.js）
  f22: { name: 'F-22A 猛禽战斗机', spd: 285, turn: 2.4, hp: 1, flares: 3, stealth: .3 } };   // 制空专用：6 枚 AIM-120D + 2 枚 AIM-9X、雷达看得更远（airwar.js EA_FTR）
const eaFtr = t => t === 'ftr' || t === 'f22';   // 歼击机（空战由 airwar.js 接管）
// 在巡逻高度上的战斗机（双方）：便携防空导弹、高炮、机枪、近防炮都够不着，只有舰空 / 车载防空导弹和对方战斗机能打
const eaHigh = o => !!o && (o.kind === 'fighter' ? o.alt > .6 && !['cat', 'roll', 'trap', 'final'].includes(o.phase) : eaFtr(o.type) && o.alt > .6);
const EA_SIL = { ga: 'a10', heli: 'heli', uh60: 'uh60', c17: 'transport', ftr: 'f35', f22: 'f22' };
const eaSil = t => EA_SIL[t] || 'a10';
const EA_TRAILS = new Map();   // 仅渲染用：固定翼尾迹点（不进 S）
const EA_MANPADS = { normal: 0, hard: 1, hell: 2 };   // 战役守军单兵防空组数
const EA_GUNV = ['tank', 'hv_tank', 'td', 'flame_tank', 'lt_tank', 'amtank', 'mine_tank'];
const eaAng = a => Math.atan2(Math.sin(a), Math.cos(a));

// —— 野战机场（固定建模，世界尺寸）：300×18 跑道（入口斑马线、接地区标志、中线）、平行滑行道与 4 条联络道、
//    停机坪五排共 50 个带防爆墙的机位、机库、塔台、油库、直升机坪。跑道方向在选址时按地形定（e.rh），停机坪在离海更远的一侧（e.rs）
// 局部坐标：u 沿跑道方向，v 垂直于跑道、指向停机坪一侧；跑道 |u| ≤ 150、|v| ≤ 9，滑行道 v = 34，停机坪 v 44–238、|u| ≤ 128
// （第一排开口朝主滑行道，其余各排前面各有一条机坪滑行道 v ≈ 82 / 122 / 162 / 202，西端联络道把它们接到主滑行道）；塔台、油库在西侧，直升机坪、机库在东侧
const EA_RW = { L: 300, hw: 9, cap: 50 };   // cap：每座机场的机位数
const EA_ROWS = [63, 103, 143, 183, 223], EA_LANES = [82.5, 122.5, 162.5, 202.5], EA_APRON = 238;
const EA_STAND = EA_ROWS.flatMap(v => Array.from({ length: 10 }, (_, k) => [-112.5 + 25 * k, v]));   // 机位：机头都朝 -v，开口朝前面的滑行道
const EA_PAD = [143, 62];   // 直升机坪
const EA_EYE = [[-140, 0], [-70, 0], [0, 0], [70, 0], [140, 0], [-100, 63], [0, 63], [100, 63], [-60, 103], [60, 103], [147, 96], [-100, 143], [100, 143], [0, 183], [-60, 223], [60, 223]];   // 判断机场是否被看见的采样点
function eaW(b, u, v) { const h = b.rh || 0, s = b.rs || 1, c = Math.cos(h), n = Math.sin(h); return [b.x + c * u - n * v * s, b.y + n * u + c * v * s]; }
function eaL(b, x, y) { const h = b.rh || 0, s = b.rs || 1, c = Math.cos(h), n = Math.sin(h), dx = x - b.x, dy = y - b.y; return [dx * c + dy * n, (-dx * n + dy * c) * s]; }
const eaBaseSeen = b => EA_EYE.some(([u, v]) => { const [x, y] = eaW(b, u, v); return inVision(x, y); });
// 设施（跑道、滑行道、停机坪与机库、直升机坪）到点的距离：局部坐标里到几块矩形的最近距离
function eaFacDist(b, x, y) {
  const [u, v] = eaL(b, x, y), box = (u0, u1, v0, v1) => Math.hypot(Math.max(0, u0 - u, u - u1), Math.max(0, v0 - v, v - v1));
  return Math.min(box(-150, 150, -11, 11), box(-139, 139, 9, 38), box(-139, 128, 37, EA_APRON), box(132, 162, 52, 112), box(-166, -143, 44, 114));
}
// 跑道选址：在 (x, y) 处试 12 个方向 × 停机坪两侧：跑道、滑行道、停机坪都落在可用陆地上（不跨水、河、悬崖、山地，不出图），
// 跑道离海处处不少于 minD，不压 avoid 里的据点 / 工事 {x, y, r}；返回地形最平整、离海最远、停机坪背海的方案 {h, s, sc}，放不下返回 null
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
      for (let u = -150; u <= 150 && !bad; u += 15) for (const v of [-8, 0, 8, 34]) if (at(u, v, 1)) break;
      for (let u = -160; u <= 160 && !bad; u += 20) for (const v of [50, 90, 130, 170, 210, 236]) if (at(u, v, .5)) break;
      if (bad || depth < minD) continue;
      const [x0, y0] = P(-150, 0), [x1, y1] = P(150, 0), [a0x, a0y] = P(-155, 90), [a1x, a1y] = P(155, 90), [b0x, b0y] = P(-155, 190), [b1x, b1y] = P(155, 190), [ax, ay] = P(0, 140);
      if (avoid && avoid.some(o => segDist(o.x, o.y, x0, y0, x1, y1) < o.r + 12 || segDist(o.x, o.y, a0x, a0y, a1x, a1y) < o.r + 52 || segDist(o.x, o.y, b0x, b0y, b1x, b1y) < o.r + 52)) continue;
      const sc = -soft * 1.2 + (coastAt(ax) - ay > coastAt(x) - y ? 2 : 0) + Math.min(depth, 700) / 200;
      if (!best || sc > best.sc) best = { h, s, sc };
    }
  }
  return best;
}
// 已放下的机场补定跑道方向（沙盒开战时）：先避开据点与其他工事，实在放不下就只看地形
function eaFitBase(b) {
  const avoid = [...S.points.map(p => ({ x: p.x, y: p.y, r: 50 })), ...S.enemies.filter(o => o !== b).map(o => ({ x: o.x, y: o.y, r: o.kind === 'airfield' ? 260 : 15 }))];
  const f = eaRunwayFit(b.x, b.y, 300, avoid) || eaRunwayFit(b.x, b.y, 200) || { h: 0, s: -1 };
  b.rh = f.h; b.rs = f.s;
  return b;
}
// 停在地面的飞机（待命 / 整备）平均分到各机场：直升机先占直升机坪，其余依次占机位
function eaParked(b) {
  const E = S.eair, bases = eaBases(), i0 = bases.indexOf(b);
  if (!E || i0 < 0) return [];
  const gnd = E.wing.filter(w => w.state === 'ready' || w.state === 'rearm'), per = Math.ceil(gnd.length / bases.length), out = [];
  let k = 0, pad = false;
  for (const w of gnd.slice(i0 * per, (i0 + 1) * per)) {
    if (w.type === 'heli' && !pad) { pad = true; out.push({ w, u: EA_PAD[0], v: EA_PAD[1] }); }
    else if (k < EA_STAND.length) { out.push({ w, u: EA_STAND[k][0], v: EA_STAND[k][1] }); k++; }
  }
  return out;
}

function eaEnsure() {
  if (!S.eair) S.eair = { wing: [], fly: [], proj: [], wr: [], flash: [], cratT: 0, nextT: 90, first: 90, gap: 80, aaT: 0, thinkT: 2, said: {} };
  return S.eair;
}
function eaAddWing(type) { const E = eaEnsure(); E.wing.push({ id: S.nid++, type: EA_SPEC[type] ? type : 'ga', state: 'ready', rearmT: 0 }); }
const eaBases = () => S.enemies.filter(e => e.kind === 'airfield' && !e.dead);
const eaOpen = () => eaBases().filter(b => !(b.cratT > S.t));   // 跑道完好、能起降的机场
function eaNearBase(x, y, list) { let b = null, bd = Infinity; for (const e of list || eaBases()) { const d = dist(e.x, e.y, x, y); if (d < bd) { bd = d; b = e; } } return b; }
const eaWhere = (x, y) => typeof cmdWhere === 'function' ? cmdWhere(x, y) : gridRef(x, y);

// —— 战役：在指挥所以北纵深找一块放得下 300 米跑道的平整陆地修野战机场；按难度配飞机、守军单兵防空组；我方两个连各带一个便携防空组 ——
function eaPlaceBase() {
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
    const cap = eaBases().length * EA_RW.cap, gnd = E.wing.filter(w => w.state === 'ready' || w.state === 'rearm');
    let over = E.wing.filter(w => w.state !== 'lost').length - cap, lost = 0;
    for (let i = gnd.length - 1; i >= 0 && over > 0; i--, over--) { gnd[i].state = 'lost'; lost++; }
    if (lost && !cap && !E.said.base) { E.said.base = 1; log('敌野战机场被毁，停在地面的敌机全部损失', 'good'); }
    for (const w of E.wing) if (w.state === 'rearm' && (w.rearmT -= dt) <= 0) w.state = 'ready';
    for (const a of E.fly) if (!a.dead) { if (a.type === 'uh60' || a.type === 'c17') { if (typeof a101Fly === 'function') a101Fly(a, dt); else a.dead = true; } else if (a.ph === 'roll') eaRoll(a, dt); else if (a.type === 'heli') eaFlyHeli(a, dt); else if (eaFtr(a.type) && typeof awFlyE === 'function') awFlyE(a, dt); else eaFlyGA(a, dt); }
    E.fly = E.fly.filter(a => !a.dead);
    eaProj(dt);
    for (const w of E.wr) if (!w.hit && S.t - w.t >= 2) { w.hit = true; const x = w.x + Math.cos(w.h) * w.spd * 2, y = w.y + Math.sin(w.h) * w.spd * 2; S.fx.push({ kind: isLand(x, y) ? 'boom' : 'flash', x, y, r: 14, life: 0, max: .8, side: 'e' }); }
    E.wr = E.wr.filter(w => S.t - w.t < 2.4);
    E.flash = E.flash.filter(f => S.t - f.t < 2);
    if ((E.thinkT -= dt) <= 0) { E.thinkT = 3; eaThink(); }
  }
  if (((E || eaEnsureLight()).aaT -= dt) <= 0) { (E || S.eaLight).aaT = .5; eaAA(); }
}
// 没有守方航空时也要跑单兵防空（守方打我方舰载机）：只用一个计时器
function eaEnsureLight() { if (!S.eaLight) S.eaLight = { aaT: 0 }; return S.eaLight; }

// 战役：LA-3、LS-1 抢滩后，本连最后一个小组的机枪手换成防空导弹手
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
  const sp = EA_SPEC[w.type], h = b.rh || 0, dir = Math.cos(Math.atan2(ty - b.y, tx - b.x) - h) >= 0 ? 1 : -1, a = { id: S.nid++, wid: w.id, type: w.type, base: b.id, spd: 0, bank: 0,
    tx, ty, flares: sp.flares, hp: sp.hp, t: S.t, pv: false, ...extra };
  if (w.type === 'heli') { [a.x, a.y] = eaW(b, EA_PAD[0], EA_PAD[1]); Object.assign(a, { heading: Math.atan2(ty - a.y, tx - a.x), alt: .02, ph: 'out' }); }
  else {
    const wait = Math.max(0, (b.rwT || 0) - S.t);
    b.rwT = S.t + wait + 6;
    Object.assign(a, { ru: -dir * 138, dir, wait, heading: h + (dir < 0 ? Math.PI : 0), alt: 0, ph: 'roll' });
    [a.x, a.y] = eaW(b, a.ru, 0);
  }
  return a;
}
// 起飞滑跑：沿跑道加速，到 150 离地转入出航（a.next 指定离地后的阶段）；机场在滑跑中被毁则损失
function eaRoll(a, dt) {
  const b = S.enemies.find(e => e.id === a.base && !e.dead);
  if (!b) { a.dead = true; const w = S.eair.wing.find(w => w.id === a.wid); if (w) w.state = 'lost'; return; }
  if (a.wait > 0) a.wait -= dt;
  else { a.spd = Math.min(EA_SPEC[a.type].spd, a.spd + 80 * dt); a.ru += a.dir * a.spd * dt; }
  [a.x, a.y] = eaW(b, a.ru, 0); a.heading = (b.rh || 0) + (a.dir < 0 ? Math.PI : 0); a.alt = 0; a.bank = 0;
  if (a.spd >= 150 || a.ru * a.dir > 135) { a.ph = a.next || 'out'; a.alt = .06; }
}
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
        if (!b.fixing) { b.fixing = true; if (eaBaseSeen(b) || S.role === 'spectate') log('敌野战机场地勤正在抢修受损设施', 'warn', 'eafix' + b.id, 90, b); }
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
    log(eaBaseSeen(b) || S.role === 'spectate' ? '敌野战机场抢修完毕，跑道恢复起降' : '侦听到敌机场方向恢复飞行活动，疑似机场已修复', 'warn', null, 0, b);
    if (typeof chatSay === 'function') chatSay('e', `报告：野战机场重建完毕（耐久恢复至 ${Math.round(EA_FIX.hp * 100)}%），跑道恢复起降。`, { kind: 'report', at: b, lv: 1 });
  }
}
// 固定翼着陆：飞到跑道延长线上 420 处的进近点 → 对准跑道下滑 → 接地滑跑减速 → 滑进机位整备；跑道弹坑未修复时在机场上空盘旋
function eaLand(a, b, dt) {
  a.rtbT = (a.rtbT || 0) + dt;
  if (a.rtbT > 100) { eaLanded(a); return; }   // 兜底：久久落不下来直接收回
  const h = b.rh || 0;
  if (a.ph === 'land') {
    a.spd = Math.max(0, a.spd - 75 * dt); a.ru += a.ld * a.spd * dt;
    [a.x, a.y] = eaW(b, a.ru, 0); a.heading = h + (a.ld < 0 ? Math.PI : 0); a.alt = 0; a.bank = 0;
    if (a.spd < 25 || a.ru * a.ld > 135) eaLanded(a);
    return;
  }
  if (b.cratT > S.t) {
    a.ph = 'hold'; a.ld = null;
    const g = Math.atan2(a.y - b.y, a.x - b.x) + .5;
    eaSteer(a, b.x + Math.cos(g) * 260, b.y + Math.sin(g) * 260, dt, 150);
    return;
  }
  if (a.ld == null || a.ph === 'hold' || a.ph === 'rtb') { const [lu] = eaL(b, a.x, a.y); a.ld = lu < 0 ? 1 : -1; a.ph = 'app'; }   // 从飞机所在的一侧进近
  if (a.ph === 'final') {
    const [tx, ty] = eaW(b, -a.ld * 110, 0), d = eaSteer(a, tx, ty, dt, 105);
    a.alt = clamp((d - 15) / 300 * .3, 0, .3);
    if (d < 20) { a.ph = 'land'; a.ru = -a.ld * 110; a.spd = Math.min(a.spd, 105); }
    else if (d < 140 && Math.abs(eaAng(a.heading - h - (a.ld < 0 ? Math.PI : 0))) > .6) a.ph = 'app';   // 没对准跑道：复飞再进近
    return;
  }
  const [ax, ay] = eaW(b, -a.ld * 420, 0), d = eaSteer(a, ax, ay, dt, 160);
  if (d < 70) a.ph = 'final';
}
function eaLanded(a) {
  a.dead = true; eaStat('eaLand');
  const w = S.eair.wing.find(w => w.id === a.wid);
  if (w && w.state !== 'lost') { w.state = 'rearm'; w.rearmT = 60; }
}
function eaSteer(a, tx, ty, dt, spd) {
  const sp = EA_SPEC[a.type], df = eaAng(Math.atan2(ty - a.y, tx - a.x) - a.heading), turn = clamp(df, -sp.turn * dt, sp.turn * dt);
  a.heading = eaAng(a.heading + turn); a.bank = lerp(a.bank || 0, dt > 0 ? turn / (sp.turn * dt) : 0, Math.min(1, dt * 5));
  a.spd += clamp((spd ?? sp.spd) - a.spd, -60 * dt, 50 * dt);
  a.x += Math.cos(a.heading) * a.spd * dt; a.y += Math.sin(a.heading) * a.spd * dt;
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
function eaFlyGA(a, dt) {
  if (a.ph === 'out' || a.ph === 'attack') {
    eaTrack(a);
    const d = eaSteer(a, a.tx, a.ty, dt);
    a.alt = a.ph === 'attack' ? Math.max(.35, a.alt - dt * .25) : Math.min(.7, a.alt + dt * .4);
    if (a.ph === 'out' && d < 420) { a.ph = 'attack'; eaSpotSay(a); }
    if (a.ph === 'attack') {
      const df = Math.abs(eaAng(Math.atan2(a.ty - a.y, a.tx - a.x) - a.heading));
      if (d < 190 && df < .3 && a.ammo > 0) { eaRockets(a, 6, 20, .6, a.tx, a.ty); eaStrafe(a); a.ammo = 0; a.ph = 'egress'; a.egT = 3; }
      else if (d < 140 && df > 1.2) { a.ph = 'egress'; a.egT = 2.5; a.pass = (a.pass || 0) + 1; }   // 冲过头：拉起重新进入
    }
  } else if (a.ph === 'egress') {
    eaSteer(a, a.x + Math.cos(a.heading) * 200, a.y + Math.sin(a.heading) * 200, dt);
    a.alt = Math.min(.7, a.alt + dt * .3);
    if ((a.egT -= dt) <= 0) a.ph = a.ammo > 0 && (a.pass || 0) < 2 && !a.lost ? 'out' : 'rtb';
  } else eaRtb(a, dt);
}
// 直升机：在目标与机场连线上、离目标 340 处悬停（守方一侧），面向目标开火
function eaStandoff(a) {
  const b = eaNearBase(a.x, a.y) || { x: a.tx, y: 0 }, d = Math.max(1, dist(a.tx, a.ty, b.x, b.y)), r = Math.min(340, d * .8);
  let x = a.tx + (b.x - a.tx) / d * r, y = a.ty + (b.y - a.ty) / d * r;
  x = clamp(x, 20, W - 20); y = clamp(y, 20, H - 20);
  a.sx = x; a.sy = y; a.stx = a.tx; a.sty = a.ty;
}
function eaFlyHeli(a, dt) {
  a.alt = a.ph === 'rtb' ? Math.min(.3, a.alt + dt * .25) : Math.min(.3, a.alt + dt * .25);
  if (a.ph === 'out') {
    eaTrack(a);
    if (a.sx == null || dist(a.tx, a.ty, a.stx, a.sty) > 80) eaStandoff(a);
    const dd = dist(a.x, a.y, a.sx, a.sy), d = eaSteer(a, a.sx, a.sy, dt, dd < 90 ? Math.max(15, dd * .8) : undefined);
    if (d < 22 || (d < 60 && dist(a.x, a.y, a.tx, a.ty) < 390)) { a.ph = 'loiter'; a.loT = 12 + Math.random() * 28; a.fireT = 1.2; eaSpotSay(a); }
    if (a.lost && !eaRetarget(a)) a.ph = 'rtb';
  } else if (a.ph === 'loiter') {
    eaTrack(a);
    a.spd = Math.max(0, a.spd - 60 * dt);
    const want = Math.atan2(a.ty - a.y, a.tx - a.x);
    a.heading = eaAng(a.heading + clamp(eaAng(want - a.heading), -2 * dt, 2 * dt)); a.bank = 0;
    a.x += (Math.cos(a.heading) * a.spd + Math.sin(S.t * .7 + a.id) * 4) * dt; a.y += (Math.sin(a.heading) * a.spd + Math.cos(S.t * .9 + a.id) * 3) * dt;
    if ((a.fireT -= dt) <= 0) { a.fireT = 3.5; eaHeliFire(a); }
    if ((a.loT -= dt) <= 0 || (a.atgm <= 0 && a.rk <= 0)) a.ph = 'rtb';
  } else eaRtb(a, dt);
}
function eaHeliFire(a) {
  if (a.lost && !eaRetarget(a)) { a.ph = 'rtb'; return; }
  const d = dist(a.x, a.y, a.tx, a.ty);
  if (d > 430) { a.ph = 'out'; a.sx = null; return; }
  if (a.atgm > 0 && (a.tgt.k === 'veh' || a.tgt.k === 'ship')) { eaATGM(a); a.atgm--; return; }
  if (a.rk > 0) {
    let tg = null, bm = 0;   // 火箭：目标附近（或机下 380 以内）最密集的步兵
    for (const q of S.teams) {
      if (q.side !== 'p' || !q.men.length || q.ride || !spotted(q.x, q.y) || dist(q.x, q.y, a.x, a.y) > 380 || ownNear('e', q.x, q.y, 45)) continue;
      let m = 0; for (const o of S.teams) if (o.side === 'p' && o.men.length && !o.ride && dist(o.x, o.y, q.x, q.y) < 35) m += o.men.length;
      if (m > bm) { bm = m; tg = q; }
    }
    if (tg) { eaRockets(a, 4, 22, .9, tg.x, tg.y); a.rk--; return; }
  }
  if (!eaRetarget(a)) a.ph = 'rtb';
}
// 原目标没了：直升机就近另找车辆 / 舰船
function eaRetarget(a) {
  let best = null, bv = 0;
  for (const v of S.veh || []) if (v.side === 'p' && !v.dead && !v.lst && spotted(v.x, v.y) && dist(v.x, v.y, a.x, a.y) < 450) { const val = EA_GUNV.includes(v.type) ? 6 : 4; if (val > bv) { bv = val; best = { k: 'veh', id: v.id, x: v.x, y: v.y }; } }
  if (!best) for (const s of S.ships) if (alive(s) && s.state === 'unloading' && dist(s.x, s.y, a.x, a.y) < 450) { best = { k: 'ship', id: s.id, x: s.x, y: s.y }; break; }
  if (!best) return false;
  a.tgt = { k: best.k, id: best.id }; a.tx = best.x; a.ty = best.y; a.lost = false; a.sx = null;
  return true;
}
// 返航：固定翼回跑道完好的最近机场（都被炸了就回最近的、在上空等抢修）走进近着陆；直升机回直升机坪悬停降落
function eaRtb(a, dt) {
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
// 扫射：目标 30 以内的我方小组受压制（无直接杀伤），曳光示意
function eaStrafe(a) {
  for (const q of S.teams) if (q.side === 'p' && q.men.length && !q.ride && dist(q.x, q.y, a.tx, a.ty) < 30) suppress(q, 30, a.x, a.y);
  for (let i = 0; i < 4; i++) tracer(a.x, a.y, a.tx + gauss() * 14, a.ty + gauss() * 14, 'e', true);
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
        if (p.tgt.k === 'veh') { vehDamage(o, 22, 3, p.x0, p.y0, 'atgm'); log(`${vehName(o)}被敌直升机反坦克导弹击中`, 'bad', 'eatgm' + o.id, 4, o); }
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
        if (p.dead || !(p.alt > .25) || ['cat', 'roll', 'trap', 'final'].includes(p.phase) || eaHigh(p)) continue;
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
      if (hit(a, 'aa', .1)) gone = a.dead;
    }
    for (const s of D) {
      if (gone) break;
      const d = dist(s.x, s.y, a.x, a.y);
      if (d < (s.esc ? 260 : 300) && !eaHigh(a)) {   // 近防炮
        for (let i = 0; i < 2; i++) tracer(s.x, s.y, a.x + gauss() * 8, a.y + gauss() * 8, 'p', true);
        if (hit(a, 'ciws', s.esc ? .05 : a.type === 'heli' ? .1 : .06)) gone = a.dead;
      } else if (canMs && d < (s.esc ? 550 : 650) * Math.min(1, ((EA_SPEC[a.type] && EA_SPEC[a.type].stealth) || 1) * 1.2) && (s.o.samCd || 0) <= S.t && !busy('p', 'eair', a.id) && (typeof vlsUse !== 'function' || vlsUse(s.o, 'sam'))) {   // 舰空导弹（垂发里的红旗-9B，打光就只剩近防炮）；隐身机要飞得更近才被舰载雷达锁定
        s.o.samCd = S.t + (s.esc ? 5 : 4);
        msLaunch('sam', 'p', s.x, s.y, { x: a.x, y: a.y }, { tgt: { k: 'eair', id: a.id }, src: s.esc ? 'esc' : 'dd', spd: 520, dur: 3 });
        eaStat('aaShot');
      }
    }
    if (!gone && a.type === 'heli') for (const q of S.teams) {   // 机枪打直升机
      if (q.side !== 'p' || !q.men.includes('mg') || q.ride || q.sup >= 60 || dist(q.x, q.y, a.x, a.y) > 150) continue;
      tracer(q.x, q.y, a.x + gauss() * 6, a.y + gauss() * 6, 'p', true);
      if (hit(a, 'mg', .02)) { gone = a.dead; if (gone) break; }
    }
  }
}
// 击落一架守方飞机：空中爆炸 + 翻滚坠落 2 秒
function eaLost(a, how) {
  if (!a || a.dead) return;
  a.dead = true;
  if ((a.type === 'uh60' || a.type === 'c17') && typeof a101Down === 'function') a101Down(a);   // 空降运输机：机上的人员装备一起损失
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
  if (!a.pv && S.role !== 'spectate') return;
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
const EA_PREF = { heli: { veh: 1.3, ship: 1.1, team: .9, pt: .8 }, ga: { veh: 1, ship: 1.3, team: 1.2, pt: 1.1 } };
function eaThink() {
  const E = S.eair, all = eaBases(), open = eaOpen();
  if (!all.length) return;
  // 两次出击间隔 gap 秒；另一机种可提前一半时间出动（直升机与攻击机各打各的）；固定翼要有跑道完好的机场，直升机从直升机坪起飞不受弹坑影响
  const ready = E.wing.filter(w => w.state === 'ready' && (w.type === 'heli' || open.length) && S.t >= E.first && (S.t >= E.nextT || (E.lastType && w.type !== E.lastType && S.t >= E.nextT - E.gap / 2)));
  if (!ready.length) return;
  // 制空权（airwar.js）：敌方掌握时只打高价值目标、不进敌战斗机巡逻区；我方掌握时出击间隔缩短
  const AW = typeof awState === 'function' ? awState() : null, capP = AW === 'p' ? S.planes.filter(p => !p.dead && p.kind === 'fighter' && (p.phase === 'loiter' || p.phase === 'out')) : [];
  let best = null, bs = AW === 'p' ? 10 : 6, bw = null;
  for (const t of eaTargets()) for (const type of ['heli', 'ga']) {
    const w = ready.find(w => w.type === type);
    if (!w || capP.some(p => dist(p.cx, p.cy, t.x, t.y) < 500)) continue;
    if (t.fc && ready.filter(o => o.type === type).length < 2) continue;   // 舰队防空伞里的目标：凑不齐双机不去
    const s = t.v * EA_PREF[type][t.k];
    if (s >= bs) { bs = s; best = t; bw = w; }
  }
  if (!best) return;
  const b = eaNearBase(best.x, best.y, bw.type === 'heli' ? all : open), sp = EA_SPEC[bw.type];
  // 双机编队：同型还有一架待命就一起出（僚机打同一目标、错开 3 秒）；直升机两架一组互相掩护
  const fl = [bw, ...ready.filter(w => w !== bw && w.type === bw.type).slice(0, 1)];
  fl.forEach((w, i) => {
    const a = eaNewAir(b, w, best.x + (i ? gauss() * 20 : 0), best.y + (i ? gauss() * 20 : 0), { tgt: { k: best.k, id: best.id }, ammo: 1, atgm: bw.type === 'heli' ? 2 : 0, rk: bw.type === 'heli' ? 2 : 0 });
    if (i) { if (a.wait != null) a.wait += 3; else { a.x += 14; a.y += 8; } }   // 固定翼僚机错开 3 秒滑跑；直升机并排离坪
    w.state = 'out'; E.fly.push(a);
  });
  E.nextT = S.t + E.gap * (AW === 'e' ? .6 : 1) * (fl.length > 1 ? 1.4 : 1); E.lastType = bw.type;
  eaStat('eaSortie', fl.length);
  if (typeof chatSay === 'function') chatSay('e', `命令：${sp.name}${fl.length > 1 ? '双机编队' : '一个架次'}出击，打击${eaWhere(best.x, best.y)}的${best.nm}。`, { kind: 'order', at: { x: best.x, y: best.y }, lv: 1, key: 'easort', gap: 15 });
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
  for (const b of S.enemies) if (b.kind === 'airfield' && b.dead && b.rb != null && eaFacDist(b, x, y) < R + 6) { b.hitE = S.t; b.rb = Math.max(0, b.rb - .15 * Math.max(.5, (pw.struct || 3) / 7)); }   // 重建中的机场挨炸：进度倒退
  for (const b of eaBases()) {
    const [u, v] = eaL(b, x, y);
    if (Math.abs(u) > 170 + R || v < -20 - R || v > 125 + R) continue;
    if (Math.abs(u) < 150 + R * .3 && Math.abs(v) < EA_RW.hw + R * .4) {
      b.cratT = Math.max(b.cratT || 0, S.t + 60);
      (b.rc || (b.rc = [])).push({ u: Math.round(clamp(u, -146, 146)), v: Math.round(clamp(v, -7, 7)), r: Math.round(clamp(R * .22, 3, 9)) });
      if (b.rc.length > 10) b.rc.shift();
      if (eaBaseSeen(b)) log('敌野战机场跑道中弹，敌固定翼飞机暂时无法起降', 'good', 'eacrat', 20, b);
    }
    for (const P of eaParked(b)) {
      const d = Math.hypot(u - P.u, v - P.v);
      if (d < R * .6 + 4 && Math.random() < (d < 6 ? .85 : .4)) {
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
  for (const a of S.eair.fly) if (!a.dead && a.alt > .1) o.push({ x: a.x, y: a.y, r: 120, h: 1.5 });
  for (const f of S.eair.flash) o.push({ x: f.x, y: f.y, r: 60, h: .5 });
  return o;
}

// —— 绘制 ——
function eaDraw(time) {
  if (!S || !S.eair || !eaOn() || typeof R !== 'object' || !R.ctx) return;
  const ctx = R.ctx, E = S.eair, spec = S.role === 'spectate', lw = px(1.3);
  // 弹药（机场与停在机位上的飞机在 drawUnder 的 eaDrawBases 里画）
  for (const p of E.proj) {
    if (p.t < 0 || p.done) continue;
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
    const heli = a.type === 'heli' || a.type === 'uh60', big = a.type === 'c17', size = big ? Math.max(28, px(30)) : Math.max(heli ? 15 : 17, px(heli ? 17 : 19));
    if (!heli && a.alt > .2) {
      let tr = EA_TRAILS.get(a.id);
      if (!tr) EA_TRAILS.set(a.id, tr = []);
      const l = tr[tr.length - 1];
      if (!l || dist(l[0], l[1], a.x, a.y) > 6) { tr.push([a.x, a.y]); if (tr.length > 22) tr.shift(); }
      ctx.lineWidth = px(1.2);
      for (let i = 1; i < tr.length; i++) { ctx.strokeStyle = rgba(COL.enemy, .15 * i / tr.length); ctx.beginPath(); ctx.moveTo(tr[i - 1][0], tr[i - 1][1]); ctx.lineTo(tr[i][0], tr[i][1]); ctx.stroke(); }
    }
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(a.x + a.alt * 14, a.y + a.alt * 22, size * .35, size * .22, a.heading, 0, 7); ctx.fill();
    if (typeof drawAircraft === 'function') drawAircraft(ctx, a.x, a.y, a.heading, eaSil(a.type), size, COL.enemy, 1, a.bank || 0, lw);
    if (a.gunT > 0) { const nx = a.x + Math.cos(a.heading) * size * .55, ny = a.y + Math.sin(a.heading) * size * .55; ctx.fillStyle = rgba('#fff3d6', .5 + .5 * Math.sin(time * 60)); ctx.beginPath(); ctx.arc(nx, ny, size * .14, 0, 7); ctx.fill(); }
    if (heli) {
      const r = size * 9.5 / 21, cx = a.x + Math.cos(a.heading) * size * 1.5 / 21, cy = a.y + Math.sin(a.heading) * size * 1.5 / 21, ang = time * 22 + a.id;
      ctx.strokeStyle = rgba(COL.enemy, .6); ctx.lineWidth = px(1.2); ctx.beginPath();
      for (let k = 0; k < 2; k++) { const b = ang + k * Math.PI / 2; ctx.moveTo(cx - Math.cos(b) * r, cy - Math.sin(b) * r); ctx.lineTo(cx + Math.cos(b) * r, cy + Math.sin(b) * r); }
      ctx.stroke();
    }
  }
}

// —— 绘制：野战机场（drawUnder，压在部队与飞机之下；render2.js 不再画它的图标）——
// 远看（跑道在屏幕上不到约 110 像素）只画道面、滑行道、停机坪与建筑轮廓；近看再画标线、防爆墙、停放的飞机与整备进度
// 看不见但已标定：半透明虚线轮廓；跑道中弹：弹坑 + 琥珀色封闭框与抢修进度；受损 / 被毁：机库、油库起火冒烟
function eaDrawBases(time) {
  if (!S || !eaOn() || typeof R !== 'object' || !R.ctx) return;
  const ctx = R.ctx, spec = S.role === 'spectate';
  for (const b of S.enemies) {
    if (b.kind !== 'airfield' || !inView(b.x, b.y, 220)) continue;
    const vis = spec || eaBaseSeen(b);
    if (vis || b.kx != null) eaDrawBase(ctx, b, vis, time);
  }
  if (S.abBase && inView(S.abBase.x, S.abBase.y, 220)) eaDrawBase(ctx, S.abBase, true, time, true);   // 我方夺取的机场（abn.js）
}
function eaDrawBase(ctx, b, vis, time, own) {
  const det = EA_RW.L * R.s, dead = b.dead, a = vis ? 1 : .5, f = clamp(b.hp / b.maxhp, 0, 1), C0 = own ? COL.g : COL.enemy;
  const edge = rgba(dead ? COL.smoke : C0, (dead ? .4 : .85) * a), con = rgba(STRUCT, .42 * a), paint = rgba('#e8fff0', .5 * a);
  const pave = `rgba(16,20,18,${.93 * a})`, slab = `rgba(30,36,33,${.9 * a})`, dark = `rgba(2,10,6,${.92 * a})`, dash = vis ? [] : [px(4), px(3)];
  ctx.save();
  ctx.translate(b.x, b.y); ctx.rotate(b.rh || 0); ctx.scale(1, b.rs || 1);
  ctx.lineJoin = 'miter'; ctx.setLineDash(dash);
  ctx.fillStyle = `rgba(0,0,0,${.26 * a})`; ctx.fillRect(-170, -18, 340, EA_APRON + 26);   // 推平的场区
  // 跑道：道肩 + 道面
  ctx.fillStyle = slab; ctx.fillRect(-152, -11.5, 304, 23);
  ctx.fillStyle = pave; ctx.fillRect(-150, -9, 300, 18);
  ctx.strokeStyle = edge; ctx.lineWidth = px(1.4); ctx.strokeRect(-150, -9, 300, 18);
  // 滑行道、联络道（含西端通往各条机坪滑行道的一条）、五排机位的停机坪、直升机坪底板
  const lastL = EA_LANES[EA_LANES.length - 1];
  ctx.fillStyle = slab;
  ctx.fillRect(-138.5, 30.5, 277, 7);
  for (const u of [-135, -45, 45, 135]) ctx.fillRect(u - 3.5, 9, 7, 22);
  for (const u of [-40, 40]) ctx.fillRect(u - 4, 37, 8, 8);
  ctx.fillRect(-138.5, 37, 10.5, lastL - 28.5);
  ctx.fillRect(-128, 44, 256, EA_APRON - 44); ctx.fillRect(133, 52, 20, 20);
  ctx.strokeStyle = con; ctx.lineWidth = px(1);
  ctx.strokeRect(-128, 44, 256, EA_APRON - 44); ctx.strokeRect(133, 52, 20, 20);
  ctx.beginPath(); ctx.moveTo(-138.5, 30.5); ctx.lineTo(138.5, 30.5); ctx.moveTo(-128, 37.5); ctx.lineTo(138.5, 37.5);
  ctx.moveTo(-138.5, 30.5); ctx.lineTo(-138.5, lastL + 8.5); ctx.lineTo(-128, lastL + 8.5); ctx.stroke();
  if (det >= 110) {
    ctx.setLineDash([]); ctx.fillStyle = paint; ctx.strokeStyle = paint; ctx.lineWidth = Math.max(.7, px(1));
    if (!dead) { ctx.setLineDash([7, 6]); ctx.beginPath(); ctx.moveTo(-126, 0); ctx.lineTo(126, 0); ctx.stroke(); ctx.setLineDash([]); }   // 跑道中线
    for (const e of [-1, 1]) {
      for (const v of [-7.5, -5, -2.5, 2.5, 5, 7.5]) ctx.fillRect(e > 0 ? 138 : -147, v - .6, 9, 1.2);   // 入口斑马线
      for (const v of [-4.5, 4.5]) ctx.fillRect(e * 116 - 6, v - 1, 12, 2);   // 接地区标志
    }
    ctx.strokeStyle = rgba(COL.amber, .35 * a); ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(-132, 34); ctx.lineTo(132, 34);   // 滑行道中线
    ctx.moveTo(-133, 40); ctx.lineTo(-133, lastL); for (const v of EA_LANES) { ctx.moveTo(-133, v); ctx.lineTo(124, v); } ctx.stroke();   // 联络道 → 各条机坪滑行道中线
    ctx.setLineDash(dash);
    ctx.strokeStyle = con; ctx.lineWidth = Math.max(1, px(2.2));   // 机位：U 形防爆墙，开口朝滑行道
    for (const [u, v] of EA_STAND) { ctx.beginPath(); ctx.moveTo(u - 11, v - 13); ctx.lineTo(u - 11, v + 12); ctx.lineTo(u + 11, v + 12); ctx.lineTo(u + 11, v - 13); ctx.stroke(); }
    ctx.lineWidth = px(1); ctx.beginPath(); ctx.arc(EA_PAD[0], EA_PAD[1], 7.5, 0, 7);   // 直升机坪：圆圈与十字
    ctx.moveTo(EA_PAD[0] - 4, EA_PAD[1]); ctx.lineTo(EA_PAD[0] + 4, EA_PAD[1]); ctx.moveTo(EA_PAD[0], EA_PAD[1] - 4); ctx.lineTo(EA_PAD[0], EA_PAD[1] + 4); ctx.stroke();
  }
  // 机库（拱顶，门朝滑行道）、塔台（顶上旋转的雷达）、油库（三个油罐与防火堤）
  ctx.fillStyle = dark; ctx.strokeStyle = edge; ctx.lineWidth = px(1.3);
  ctx.fillRect(132, 80, 30, 32); ctx.strokeRect(132, 80, 30, 32);
  ctx.fillRect(-156, 44, 10, 10); ctx.strokeRect(-156, 44, 10, 10);
  ctx.strokeStyle = con; ctx.lineWidth = px(1);
  ctx.strokeRect(-166, 92, 23, 22);
  for (const [u, v] of [[-159.5, 98], [-149.5, 98], [-154.5, 108]]) { ctx.beginPath(); ctx.arc(u, v, 4.2, 0, 7); ctx.fillStyle = dark; ctx.fill(); ctx.strokeStyle = edge; ctx.stroke(); }
  if (det >= 110) {
    ctx.strokeStyle = con; ctx.beginPath(); for (let u = 137; u < 160; u += 5) { ctx.moveTo(u, 80); ctx.lineTo(u, 112); } ctx.stroke();   // 拱顶肋
    ctx.strokeStyle = paint; ctx.lineWidth = Math.max(1, px(2)); ctx.beginPath(); ctx.moveTo(136, 80); ctx.lineTo(158, 80); ctx.stroke();   // 机库大门
    const ra = dead ? 0 : time * 2.4;
    ctx.strokeStyle = edge; ctx.lineWidth = px(1); ctx.beginPath(); ctx.arc(-151, 49, 2.6, 0, 7); ctx.moveTo(-151, 49); ctx.lineTo(-151 + Math.cos(ra) * 4.5, 49 + Math.sin(ra) * 4.5); ctx.stroke();
  }
  // 停在机位上的飞机：待命亮、整备中暗 + 进度弧
  if (own && !dead && typeof drawAircraft === 'function' && typeof abParked === 'function') abParked().forEach((w, k) => {   // 我方停在机场整备的飞机
    if (k >= EA_STAND.length) return;
    const [u, v] = EA_STAND[k], ready = w.state === 'deck';
    drawAircraft(ctx, u, v, -Math.PI / 2, airSilKey(w.type, w.v), 14, COL.intel, (ready ? .95 : .5) * a, 0, px(1));
    if (!ready && det >= 110) { ctx.strokeStyle = rgba(COL.amber, .8 * a); ctx.lineWidth = px(1.4); ctx.beginPath(); ctx.arc(u, v, 9, -1.57, -1.57 + (1 - clamp(w.rearmT / 45, 0, 1)) * 6.283); ctx.stroke(); }
  });
  if (!own && !dead && typeof drawAircraft === 'function') for (const P of eaParked(b)) {
    const w = P.w, ready = w.state === 'ready';
    drawAircraft(ctx, P.u, P.v, -Math.PI / 2, eaSil(w.type), w.type === 'heli' ? 13 : w.type === 'f22' ? 15 : 14, COL.enemy, (ready ? .9 : .45) * a, 0, px(1));
    if (!ready && det >= 110) { ctx.strokeStyle = rgba(COL.amber, .8 * a); ctx.lineWidth = px(1.4); ctx.beginPath(); ctx.arc(P.u, P.v, 9, -1.57, -1.57 + (1 - clamp(w.rearmT / 60, 0, 1)) * 6.283); ctx.stroke(); }
  }
  // 跑道弹坑；封闭期间琥珀色虚线框住道面，下沿是抢修进度
  ctx.setLineDash([]);
  for (const c of b.rc || []) {
    const g = ctx.createRadialGradient(c.u, c.v, 0, c.u, c.v, c.r * 1.6);
    g.addColorStop(0, `rgba(0,0,0,${.9 * a})`); g.addColorStop(.6, `rgba(0,0,0,${.55 * a})`); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c.u, c.v, c.r * 1.6, 0, 7); ctx.fill();
    ctx.strokeStyle = rgba(COL.amber, .45 * a); ctx.lineWidth = px(1); ctx.beginPath(); ctx.arc(c.u, c.v, c.r, 0, 7); ctx.stroke();
  }
  if (!dead && b.cratT > S.t) {
    ctx.strokeStyle = rgba(COL.amber, (.5 + .3 * Math.sin(time * 5)) * a); ctx.lineWidth = px(1.6); ctx.setLineDash([px(6), px(5)]);
    ctx.strokeRect(-153, -12.5, 306, 25); ctx.setLineDash([]);
    ctx.fillStyle = rgba(COL.amber, .75 * a); ctx.fillRect(-150, -17, 300 * (1 - clamp((b.cratT - S.t) / (own ? b.fixD || 60 : 60), 0, 1)), Math.max(1.5, px(2.5)));
  }
  if (vis && !dead && f < 1) {   // 耐久条（停机坪外侧）；地勤抢修时右端闪一个琥珀色「＋」
    ctx.fillStyle = rgba(C0, .2); ctx.fillRect(-40, 120, 80, Math.max(1.5, px(2.5)));
    ctx.fillStyle = rgba(C0, .85); ctx.fillRect(-40, 120, 80 * f, Math.max(1.5, px(2.5)));
    if (b.fixing) { ctx.strokeStyle = rgba(COL.amber, (.5 + .4 * Math.sin(time * 6)) * a); ctx.lineWidth = Math.max(1, px(1.6)); ctx.beginPath(); ctx.moveTo(46, 121); ctx.lineTo(54, 121); ctx.moveTo(50, 117); ctx.lineTo(50, 125); ctx.stroke(); }
  }
  if (vis && dead && b.rb != null) {   // 重建：琥珀色进度条与虚线框（跑道）
    ctx.fillStyle = rgba(COL.amber, .2); ctx.fillRect(-60, 120, 120, Math.max(1.5, px(2.5)));
    ctx.fillStyle = rgba(COL.amber, .85); ctx.fillRect(-60, 120, 120 * clamp(b.rb, 0, 1), Math.max(1.5, px(2.5)));
    ctx.strokeStyle = rgba(COL.amber, (.35 + .25 * Math.sin(time * 4)) * a); ctx.lineWidth = px(1.4); ctx.setLineDash([px(6), px(5)]); ctx.strokeRect(-153, -12.5, 306, 25); ctx.setLineDash([]);
  }
  ctx.restore();
  // 受损过半 / 被毁：机库、油库、跑道中段起火，黑烟向东北飘（世界坐标）
  if (vis && (dead || f < .5)) for (const [u, v, k] of [[147, 96, .5], [-154.5, 103, .25], [0, 0, 0]]) {
    if (!dead && f > k) continue;
    const [x, y] = eaW(b, u, v), fl = 6 + 2.5 * Math.sin(time * 9 + u), g = ctx.createRadialGradient(x, y, 0, x, y, fl);
    g.addColorStop(0, 'rgba(255,243,214,.85)'); g.addColorStop(.4, rgba(COL.amber, .7)); g.addColorStop(1, rgba(COL.enemy, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, fl, 0, 7); ctx.fill();
    for (let i = 0; i < 4; i++) {
      const ph = ((time * .22 + i / 4 + u * .01) % 1 + 1) % 1, sx = x + 12 + ph * 90, sy = y - 8 - ph * 50, r = 8 + ph * 22, sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
      sg.addColorStop(0, rgba(COL.smoke, .2 * (1 - ph))); sg.addColorStop(1, rgba(COL.smoke, 0));
      ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(sx, sy, r, 0, 7); ctx.fill();
    }
  }
}

HOOK.step.push(eaStep);
HOOK.impact.push(eaImpact);
HOOK.visionE.push(eaVision);
HOOK.drawUnder.push(eaDrawBases);
HOOK.drawOver.push(eaDraw);
