'use strict';
// 航空母舰与舰载机联队：甲板弹射起飞、侦察 / 空袭 / 对地支援三种任务、防空火力、舰尾进近着舰与整备；
// 航母机动与受损（岸防炮可打）；绘制航母、甲板停机、飞机剪影（无文字）
const AIR_SPEC = {
  recon: { name: '空警-600 侦察机', n: 2, aa: .06, spd: 190, size: 17 },
  strike: { name: '歼-15 攻击机', n: 4, aa: .09, spd: 180, size: 15 },
  cas: { name: '攻击-2 对地支援无人机', n: 4, aa: .09, spd: 170, size: 15 },
  bomber: { name: '轰炸机', n: 0, aa: .07, spd: 150, size: 22 },   // 沙盒购买：重型轰炸机（地毯轰炸）/ 俯冲轰炸机（点目标）
  fighter: { name: '歼-15 舰载战斗机', n: 2, aa: .05, spd: 230, size: 15 }   // 制空（airwar.js）：在指定空域巡逻，拦截敌机、夺取制空权
};
const AIR_TYPES = ['recon', 'strike', 'cas', 'bomber', 'fighter'];
const AIR_TURN = 1.5;      // 最大转弯角速度（弧度/秒）：巡航转弯半径约 120
const AIR_REARM = 45;      // 着舰后整备时间（秒）
const AIR_TRAILS = new Map();   // 仅渲染用：飞机尾迹点（不进 S）
const CV_LEN = 150;
// 航母局部坐标：u 指向舰首，v 指向右舷（绘制时 rotate(heading) 后 x = u、y = v）
const CVG = {
  deck: [[77, 0], [70, 7], [46, 14], [-20, 15], [-74, 13], [-77, 8], [-77, -8], [-70, -12], [-30, -15], [20, -18], [34, -14], [60, -9]],
  cats: [[8, -3, 76], [8, 4, 76]],              // 舰首两条弹射器：起点 u、v、离舰 u
  land: { u0: -70, v0: 2, u1: 24, v1: -14 },     // 斜角着舰区中线（舰尾 → 左舷前方）
  td: .15,                                        // 接地点在着舰中线上的位置
  // 停机位 [u, v, 机头相对舰首的角度]：侦察 2、攻击 4、对地支援 4、战斗机 2
  slots: [[50, -9.5, 2.2], [41, -10.5, 2.2], [56, 9, -2.2], [47, 10.5, -2.2], [38, 11.5, -2.2], [29, 12, -2.2],
    [-10, 11, -2.2], [-20, 11, -2.2], [-30, 11, -2.2], [-40, 11, -2.2], [-50, 11, -2.2], [-60, 10.5, -2.2]],
  fires: [[-30, 5], [12, -9], [44, 4], [-58, -4]]
};
const CV_LLEN = Math.hypot(CVG.land.u1 - CVG.land.u0, CVG.land.v1 - CVG.land.v0);
const CV_LANG = Math.atan2(CVG.land.v1 - CVG.land.v0, CVG.land.u1 - CVG.land.u0);
// 舰载机俯视剪影（半边轮廓，机头 +x，长、翼展均约 21）
const AIR_SIL = {
  recon: [[10, 0], [8, 1], [3, 1.3], [2.5, 10.5], [0, 10.5], [-.5, 1.3], [-7, 1], [-8.5, 4], [-10, 4], [-9.6, .6], [-10.5, 0]],
  strike: [[10.5, 0], [7, 1], [3, 1.6], [-3, 8.5], [-5.5, 8.8], [-4.5, 2.2], [-7, 2], [-9.5, 5], [-11, 5], [-10, 1.2], [-10.5, 0]],
  cas: [[9.5, 0], [7, 1.3], [2, 1.5], [1.5, 9.5], [-1.5, 9.5], [-2, 1.6], [-6, 1.4], [-7, 4.6], [-10, 4.6], [-10, 1], [-11, 0]],
  bomber: [[11, 0], [9, 1.3], [3.5, 1.6], [2.5, 11.5], [-1, 11.5], [-2.5, 1.6], [-8, 1.3], [-9, 5.2], [-11, 5.2], [-10.6, .8], [-11.5, 0]],   // 重型轰炸机：长直翼四发
  dive: [[10, 0], [8, 1.1], [3, 1.4], [1.2, 5.2], [.6, 9.8], [-2, 9.8], [-1.6, 5.2], [-2.6, 1.4], [-7, 1.1], [-8.5, 4.2], [-10, 4.2], [-9.6, .6], [-10.5, 0]],   // 俯冲轰炸机：倒海鸥翼
  fb: [[11, 0], [8, 1], [2.5, 1.4], [-3.5, 7.8], [-6, 7.8], [-5, 1.8], [-8, 1.6], [-10, 4.2], [-11, 4.2], [-10.5, .8], [-11, 0]],
  fighter: [[11, 0], [9, .9], [4, 1.3], [-1, 6.5], [-4.5, 7.5], [-4, 2.2], [-7.5, 2], [-9.5, 4.4], [-11, 4.4], [-10.3, 1], [-11, 0]],   // 制空战斗机：大后掠翼（双垂尾另画）
  heli: [[8, 0], [7, 1.6], [3, 2.6], [-2, 2.4], [-4, 1], [-11, .6], [-12, 3], [-13, 3], [-12.5, 0]]   // 武装直升机：机身 + 尾梁（旋翼另画）
};
// 变体机型的剪影与名称（沙盒）
const airSilKey = (type, v) => v === 'dive' || v === 'fb' || v === 'heli' ? v : type;
const AIR_VNAME = { heavy: '轰-6K 轰炸机', dive: '攻击-11 无人攻击机', fb: '歼-15T 战斗攻击机', heli: '直-10 武装直升机', lr: '无侦-7 侦察机', adv: '歼-35 隐身战斗机' };   // 进攻方按解放军装备命名
const airName = (type, v) => AIR_VNAME[v] || (AIR_SPEC[type] || AIR_SPEC.strike).name;
// HUD 图标（24×24，描边风格，与 hud.js ICON 一致）
const CARRIER_ICONS = {
  cv: '<path d="M10 2h4l2 3v15.5l-1 1.5H9l-1-1.5V16l-2.5-1.5v-4L8 9V5z"/><path d="M9.2 20.5L7 11" stroke-dasharray="1.6 1.6"/><path d="M11 4v5M13 4v5"/><rect class="f" x="13.8" y="11" width="1.8" height="4.5"/>',
  recon: '<path d="M12 2v19M2.5 11.5L12 10l9.5 1.5M8.5 20.5L12 19l3.5 1.5"/><circle cx="12" cy="13" r="3"/>',
  strike: '<path d="M12 2l1.6 5 7.4 7v2l-7.4-2.6-.4 5 2.8 2v1.6L12 21l-4 1.4v-1.6l2.8-2-.4-5L3 16v-2l7.4-7z"/><circle class="f" cx="8" cy="15.5" r="1"/><circle class="f" cx="16" cy="15.5" r="1"/>',
  cas: '<path d="M12 3v17M3 10.5h18M7.5 20h9M7.5 18v4M16.5 18v4"/><rect x="8.6" y="13" width="2" height="3.5"/><rect x="13.4" y="13" width="2" height="3.5"/>',
  bomber: '<path d="M12 2.5v18M2 10.6l10-1.1 10 1.1v1.8l-10-.6-10 .6zM8 20.5l4-1.3 4 1.3"/><path d="M5.6 9.6v3.2M8.6 9.4v3.4M15.4 9.4v3.4M18.4 9.6v3.2"/><circle class="f" cx="12" cy="15.5" r="1.1"/>',
  airauto: '<path d="M12 5l1 3.5 5 4v1.5l-5-1.8-.3 3.3 1.8 1.3v1.2L12 17l-2.5 1v-1.2l1.8-1.3-.3-3.3-5 1.8v-1.5l5-4z"/><path d="M4.5 8.5A8.5 8.5 0 0 1 10 3.3M19.5 15.5A8.5 8.5 0 0 1 14 20.7"/>',
  fighter: '<path d="M12 2l1.4 5.6 7.6 6.4v2l-7.6-2.2-.3 3.8 2.6 2v1.6L12 20.4l-3.7 1.2V20l2.6-2-.3-3.8L3 16v-2l7.6-6.4z"/><path d="M10.4 18.4l-1.2 2.4M13.6 18.4l1.2 2.4"/>'
};

const airAng = a => Math.atan2(Math.sin(a), Math.cos(a));
// 航母局部坐标 ↔ 世界坐标
function cvW(u, v, c) {
  c = c || S.cv;
  const ch = Math.cos(c.heading), sh = Math.sin(c.heading);
  return [c.x + ch * u - sh * v, c.y + sh * u + ch * v];
}
function cvL(x, y, c) {
  c = c || S.cv;
  const dx = x - c.x, dy = y - c.y, ch = Math.cos(c.heading), sh = Math.sin(c.heading);
  return [dx * ch + dy * sh, -dx * sh + dy * ch];
}
// 多艘航母（沙盒）：S.cv 为旗舰（母舰号 0），S.cvx 为其余航母（1..n）；舰载机与飞机以 home 记所属母舰
const cvHome = o => (o && o.home) || 0;
const cvOf = h => h ? (S.cvx && S.cvx[h - 1]) || null : S.cv;
const cvAll = () => [S.cv, ...(S.cvx || [])].filter(c => c && isFinite(c.x) && isFinite(c.y));
// 甲板停机位分配（只供绘制与甲板中弹用）：前 12 架各有固定机位；联队超过 12 架时其余待命 / 整备的飞机在机库，
// 甲板有空位就按顺序补上，补上后位置不再变。返回 Map(飞机 id → 机位序号)，wing = 这艘航母的全部舰载机
const CV_PARK = new WeakMap();
function cvPark(c, wing) {
  const n = CVG.slots.length, on = w => w.state === 'deck' || w.state === 'rearm', m = CV_PARK.get(c) || new Map();
  for (const id of [...m.keys()]) if (!wing.some(w => w.id === id && on(w))) m.delete(id);
  const used = new Set(m.values());
  wing.forEach((w, i) => { if (i < n && on(w) && !m.has(w.id) && !used.has(i)) { m.set(w.id, i); used.add(i); } });
  for (let j = 0, i = 0; j < n && i < wing.length; j++) {
    if (used.has(j)) continue;
    while (i < wing.length && (!on(wing[i]) || m.has(wing[i].id))) i++;
    if (i < wing.length) { m.set(wing[i].id, j); used.add(j); i++; }
  }
  CV_PARK.set(c, m);
  return m;
}
// 临时把 S.cv 换成某艘航母执行 fn：复用以 S.cv 为准的起降、受损与绘制代码
function withCV(c, fn) { const keep = S.cv; S.cv = c; try { return fn(); } finally { S.cv = keep; } }
// 从 (x,y) 沿角度 a 延伸 len，但不越出地图（保持方向不变）
function airRay(x, y, a, len, m = 30) {
  const dx = Math.cos(a), dy = Math.sin(a);
  let t = len;
  if (dx > 1e-6) t = Math.min(t, (W - m - x) / dx); else if (dx < -1e-6) t = Math.min(t, (m - x) / dx);
  if (dy > 1e-6) t = Math.min(t, (H - m - y) / dy); else if (dy < -1e-6) t = Math.min(t, (m - y) / dy);
  t = Math.max(0, t);
  return [x + dx * t, y + dy * t];
}

// —— 状态初始化：newGame 部署舰队后调用；从快照恢复时也可重复调用（只补缺） ——
function initCarrier() {
  if (!S) return;
  if (!S.cv || !isFinite(S.cv.x) || !isFinite(S.cv.y))
    S.cv = { x: W / 2, y: CARRIER_Y, tx: W / 2, ty: CARRIER_Y, heading: -Math.PI / 2, hp: 30, maxhp: 30, moving: false };
  const c = S.cv;
  if (!isFinite(c.heading)) c.heading = -Math.PI / 2;
  if (!isFinite(c.tx) || !isFinite(c.ty)) { c.tx = c.x; c.ty = c.y; c.moving = false; }
  if (!isFinite(c.maxhp) || c.maxhp <= 0) c.maxhp = 30;
  if (!isFinite(c.hp)) c.hp = c.maxhp;
  if (!Array.isArray(c.cat) || c.cat.length !== 2) c.cat = [0, 0];
  if (c.exposedUntil == null) c.exposedUntil = 0;
  if (c.hitT == null) c.hitT = -99;
  if (c.auto == null) c.auto = false;
  if (c.autoT == null) c.autoT = 2;
  if (Array.isArray(S.cvx)) S.cvx.forEach((x, i) => {   // 其余航母：补齐字段
    x.home = i + 1;
    if (!isFinite(x.heading)) x.heading = -Math.PI / 2;
    if (!isFinite(x.tx) || !isFinite(x.ty)) { x.tx = x.x; x.ty = x.y; x.moving = false; }
    if (!isFinite(x.maxhp) || x.maxhp <= 0) x.maxhp = 30;
    if (!isFinite(x.hp)) x.hp = x.maxhp;
    if (!Array.isArray(x.cat) || x.cat.length !== 2) x.cat = [0, 0];
    if (x.exposedUntil == null) x.exposedUntil = 0;
    if (x.hitT == null) x.hitT = -99;
  });
  if (!S.air || !Array.isArray(S.air.wing)) {
    const wing = [];
    for (const type of AIR_TYPES) for (let k = 0; k < AIR_SPEC[type].n; k++) wing.push({ id: S.nid++, type, state: 'deck', rearmT: 0 });
    S.air = { wing, wrecks: [] };
  }
  if (!Array.isArray(S.air.wrecks)) S.air.wrecks = [];
  if (!Array.isArray(S.planes)) S.planes = [];
  if (!Array.isArray(S.recon)) S.recon = [];
  if (!S.assets) S.assets = {};
  // 旧版存档里的飞机（没有 phase）：沿原任务飞完，返航后直接消失
  for (const p of S.planes) if (!p.phase) {
    const tx = isFinite(p.tx) ? p.tx : p.x, ty = isFinite(p.ty) ? p.ty : p.y;
    Object.assign(p, { phase: p.dropped ? 'rtb' : 'out', heading: -Math.PI / 2, spd: 180, alt: 1, bank: 0, wid: null, tx, ty, cx: tx, cy: ty,
      wp: p.kind === 'recon' ? [{ x: tx, y: ty }, { x: tx, y: 40 }] : [{ x: tx, y: ty }], leg: 0, aaT: 0, rt: 0, gunT: 0, strafeT: 1, loiterT: 40, rtbT: 0 });
    if (!AIR_SPEC[p.kind]) p.kind = 'strike';
  }
  airCount();
}

// HUD 读取：各机型可出击（在甲板待命）的架数
function airCount() {
  const ok = S.air && cvAll().some(c => c.hp > 0), up = w => { const c = cvOf(cvHome(w)); return c && c.hp > 0; };
  for (const t of AIR_TYPES) S.assets[t] = ok ? S.air.wing.filter(w => w.type === t && w.state === 'deck' && up(w)).length : 0;
}

const airWing = p => p.wid != null && S.air ? S.air.wing.find(w => w.id === p.wid) : null;
const AIR_WSTATE = { cat: 'launch', roll: 'launch', out: 'out', loiter: 'out', rtb: 'return', hold: 'return', final: 'return', trap: 'return' };
function airSet(p, phase) {
  p.phase = phase;
  const w = airWing(p);
  if (w && w.state !== 'lost') w.state = AIR_WSTATE[phase] || w.state;
}

// —— 出击：kind = recon / strike / cas；从甲板待命的飞机中派出一架 ——
function launchPlane(kind, tx, ty) {
  if (!S.cv || !S.air) initCarrier();
  const sp = AIR_SPEC[kind];
  if (!sp || !isFinite(tx) || !isFinite(ty)) return false;
  if (!cvAll().some(c => c.hp > 0)) { log('航母飞行甲板瘫痪，舰载机无法起飞', 'warn', 'cvdead', 2); return false; }
  // 多艘航母时：从离目标最近、且有该机型待命的那艘起飞
  const pref = kind === 'bomber' ? (S.enemies.some(e => !e.dead && e.kx != null && dist(e.kx, e.ky, tx, ty) < 40) ? 'dive' : 'heavy') : null;
  let w = null, bd = Infinity;
  for (const o of S.air.wing) if (o.type === kind && o.state === 'deck') {
    const c = cvOf(cvHome(o)), d = c && c.hp > 0 ? dist(c.x, c.y, tx, ty) + (pref && (o.v || 'heavy') !== pref ? 1e4 : 0) : Infinity;
    if (d < bd) { bd = d; w = o; }
  }
  if (!w) {
    const left = S.air.wing.filter(w => w.type === kind && w.state !== 'lost'), r = left.filter(w => w.state === 'rearm').map(w => w.rearmT);
    log(!left.length ? `${sp.name}已全部损失` : r.length ? `${sp.name}均在出击或整备中（最快 ${Math.ceil(Math.min(...r))} 秒）` : `${sp.name}均已升空`, 'warn', 'air' + kind, 2);
    return false;
  }
  return withCV(cvOf(cvHome(w)), () => launchFrom(w, kind, sp, tx, ty));
}
function launchFrom(w, kind, sp, tx, ty) {
  const c = S.cv;
  tx = clamp(tx, 10, W - 10); ty = clamp(ty, 10, H - 10);
  // 两条弹射器轮流使用：同一条间隔 2.4 秒，两条之间至少错开 1.2 秒
  const k = c.cat[0] <= c.cat[1] ? 0 : 1, at = Math.max(S.t, c.cat[k], c.cat[1 - k] - 1.2);
  c.cat[k] = at + 2.4;
  const [u0, v0] = CVG.cats[k], [x, y] = cvW(u0, v0);
  const p = { id: S.nid++, wid: w.id, home: cvHome(w), kind, v: w.v || null, phase: 'cat', wait: at - S.t, cat: k, lu: u0, lv: v0, x, y, heading: c.heading, spd: 0, alt: 0, bank: 0,
    tx, ty, cx: tx, cy: ty, wp: [{ x: tx, y: ty }], leg: 0, aaT: Math.random() * .5, rt: 0, gunT: 0, strafeT: 1, loiterT: 40, odir: 1, dropped: false, rtbT: 0 };
  if (kind === 'recon') {   // 侦察机：飞越目标后沿同一方向再向纵深飞 700
    const a = Math.atan2(ty - c.y, tx - c.x), [bx, by] = airRay(tx, ty, a, 700);
    p.wp.push({ x: bx, y: by });
  }
  if (kind === 'fighter') Object.assign(p, { aam: w.v === 'adv' ? 6 : 4, gun: 40, capT: 90 });   // 空空导弹 · 机炮点射次数 · 巡逻秒数（airwar.js）
  S.planes.push(p);
  w.state = 'launch';
  c.exposedUntil = Math.max(c.exposedUntil || 0, S.t + 10);   // 起降作业：甲板灯光与弹射蒸汽，10 秒内易被岸防炮发现
  airCount();
  log(`${airName(kind, w.v)}弹射起飞，目标方位 ${fmtBrg(bearing(c.x, c.y, tx, ty))}`, 'info', 'airup', 1.5);
  return true;
}

// —— 每个推演步：航母机动、自动派机、整备、各架飞机飞行与任务、防空火力 ——
function updatePlanes(dt) {
  if (!S.cv || !S.air) initCarrier();
  updateCarrier(dt);
  updateAirAuto(dt);
  for (const w of S.air.wing) if (w.state === 'rearm' && (w.rearmT -= dt) <= 0) {
    w.state = 'deck'; w.rearmT = 0;
    if (S.cv.hp > 0) log(`${airName(w.type, w.v)}整备完毕`, 'good', 'rearm' + w.type + (w.v || ''), 8);
  }
  for (const p of S.planes) {
    if (p.dead) continue;
    if (p.kind === 'transport') {   // 战区运输机（para.js）：不归航母，照样挨高炮
      if (typeof paFly === 'function') paFly(p, dt); else p.dead = true;
      if (!p.dead && p.alt > .4) airAA(p, dt);
      continue;
    }
    let c = cvOf(cvHome(p)) || S.cv;
    if (c.hp <= 0 && p.phase !== 'cat' && p.phase !== 'roll') {   // 母舰瘫痪：改降其他还能起降的航母
      const alt = cvAll().find(o => o.hp > 0), w = airWing(p);
      if (alt) { p.home = cvHome(alt); if (w) w.home = p.home; c = alt; }
    }
    withCV(c, () => flyPlane(p, dt));
    if (!isFinite(p.x) || !isFinite(p.y) || !isFinite(p.heading)) { airAbort(p); continue; }   // 防御：数值异常直接收回
    if (!p.dead && p.alt > .4) airAA(p, dt);
  }
  S.planes = S.planes.filter(p => !p.dead);
  for (const w of S.air.wrecks) if (!w.hit && S.t - w.t >= 2.2) {   // 残骸坠地
    w.hit = true;
    const [x, y] = airWreckPos(w, 2.2);
    S.fx.push({ kind: isLand(x, y) ? 'boom' : 'flash', x, y, r: 14, life: 0, max: .8, side: 'p' });
  }
  S.air.wrecks = S.air.wrecks.filter(w => S.t - w.t < 2.6);
  airCount();
}

// 转向飞行：限制角速度；固定目标落在转弯圈内时先直飞拉开（带回差，避免贴着转弯圈绕圈）
// free：追踪前方移动的引导点（盘旋、最后进近）时不做此判断
function airSteer(p, tx, ty, dt, free) {
  const d = dist(p.x, p.y, tx, ty), df = airAng(Math.atan2(ty - p.y, tx - p.x) - p.heading), spd = Math.max(20, p.spd);
  let turn = clamp(df, -AIR_TURN * dt, AIR_TURN * dt);
  if (!free && Math.abs(df) > .15) {
    const r = spd / AIR_TURN, s = df > 0 ? 1 : -1, ox = p.x - Math.sin(p.heading) * r * s, oy = p.y + Math.cos(p.heading) * r * s;
    if (dist(ox, oy, tx, ty) < r * (p.ext ? 1.4 : 1.02)) { turn = 0; p.ext = true; } else p.ext = false;
  } else p.ext = false;
  p.heading = airAng(p.heading + turn);
  p.bank = lerp(p.bank || 0, dt > 0 ? turn / (AIR_TURN * dt) : 0, Math.min(1, dt * 6));
  p.x += Math.cos(p.heading) * p.spd * dt; p.y += Math.sin(p.heading) * p.spd * dt;
  return d;
}
// 绕圆盘旋：瞄准圆周上前方的点（dir = 1 顺时针）
function airOrbit(p, cx, cy, R, dir, dt) {
  const d = dist(p.x, p.y, cx, cy);
  if (d > R * 2.2) return airSteer(p, cx, cy, dt);
  const a = Math.atan2(p.y - cy, p.x - cx) + dir * .55;
  return airSteer(p, cx + Math.cos(a) * R, cy + Math.sin(a) * R, dt, true);
}
// 着舰几何：斜角甲板中线方向与接地点（随航母移动）
function cvLanding() {
  const L = CVG.land, a = S.cv.heading + CV_LANG, [x, y] = cvW(lerp(L.u0, L.u1, CVG.td), lerp(L.v0, L.v1, CVG.td));
  return { x, y, a, dx: Math.cos(a), dy: Math.sin(a) };
}
const cvDeckBusy = p => S.planes.some(o => o !== p && !o.dead && cvHome(o) === cvHome(p) && (o.phase === 'final' || o.phase === 'trap'));

function flyPlane(p, dt) {
  const c = S.cv, sp = AIR_SPEC[p.kind] || AIR_SPEC.strike, dead = c.hp <= 0;
  const speed = v => { p.spd += clamp(v - p.spd, -70 * dt, 45 * dt); };
  p.gunT = Math.max(0, (p.gunT || 0) - dt);
  if (!Array.isArray(p.wp) || !p.wp.length) p.wp = [{ x: isFinite(p.tx) ? p.tx : p.x, y: isFinite(p.ty) ? p.ty : p.y }];
  // 甲板阶段：弹射器上等待 → 滑跑加速离舰（随航母移动，用局部坐标）
  if (p.phase === 'cat' || p.phase === 'roll') {
    if (dead) { airAbort(p); return; }
    if (p.phase === 'cat') { if ((p.wait -= dt) <= 0) { airSet(p, 'roll'); p.spd = 15; } }
    else { p.spd += 85 * dt; p.lu += p.spd * dt; }
    [p.x, p.y] = cvW(p.lu, p.lv); p.heading = c.heading; p.alt = 0; p.bank = 0;
    if (p.phase === 'roll' && p.lu >= CVG.cats[p.cat || 0][2]) { airSet(p, 'out'); p.alt = .05; }
    return;
  }
  if (p.phase === 'trap') {   // 拦阻索减速，停稳后入库整备
    const L = CVG.land;
    p.tl =(p.tl ?? CVG.td) + p.spd * dt / CV_LLEN; p.spd = Math.max(0, p.spd - 170 * dt);
    [p.x, p.y] = cvW(lerp(L.u0, L.u1, p.tl), lerp(L.v0, L.v1, p.tl)); p.heading = airAng(c.heading + CV_LANG); p.alt = 0; p.bank = 0;
    if (p.spd <= 0 && (p.rest = (p.rest || 0) + dt) > .6) {
      p.dead = true;
      const w = airWing(p);
      if (w && w.state !== 'lost') { w.state = 'rearm'; w.rearmT = AIR_REARM; }
    }
    return;
  }
  if (p.kind === 'fighter' && (p.phase === 'out' || p.phase === 'loiter') && typeof awFlyP === 'function') { awFlyP(p, dt, speed); return; }   // 战斗机巡逻 / 拦截（airwar.js）
  if (p.phase === 'out') {
    p.alt = Math.min(1, p.alt + dt / 2.2); speed(sp.spd);
    if (p.kind === 'recon') {
      const wp = p.wp[Math.min(p.leg, p.wp.length - 1)], d = airSteer(p, wp.x, wp.y, dt);
      const ahead = (wp.x - p.x) * Math.cos(p.heading) + (wp.y - p.y) * Math.sin(p.heading);
      if (d < 45 || (ahead < 0 && d < 160)) p.leg++;
      if (p.y < STAGING_Y && (p.rt -= dt) <= 0) { p.rt = .2; S.recon.push({ x: p.x, y: p.y, until: S.t + 25 }); }
      if (p.leg >= p.wp.length) airSet(p, 'rtb');
    } else if (p.kind === 'strike' || p.kind === 'bomber') {
      const dive = p.kind === 'bomber' && p.v === 'dive', heavy = p.kind === 'bomber' && !dive;
      if (!p.dropped) {
        const df = Math.abs(airAng(Math.atan2(p.ty - p.y, p.tx - p.x) - p.heading)), d = airSteer(p, p.tx, p.ty, dt);
        if (dive && d < 280 && df < .5) { p.diving = true; speed(235); p.alt = Math.max(.32, p.alt - dt * .9); }   // 俯冲：压低高度加速
        if (dive ? d < 42 : heavy ? d < 95 && df < .3 : d < 80 && df < .35) (p.kind === 'bomber' ? bomberDrop : strikeDrop)(p);
      } else {
        airSteer(p, p.x + Math.cos(p.heading) * 200, p.y + Math.sin(p.heading) * 200, dt);
        if ((p.egT -= dt) <= 0) { p.diving = false; airSet(p, 'rtb'); }
      }
    } else {
      const d = airSteer(p, p.tx, p.ty, dt);
      if (d < 150) {
        const cross = Math.cos(p.heading) * (p.ty - p.y) - Math.sin(p.heading) * (p.tx - p.x);
        Object.assign(p, { cx: p.tx, cy: p.ty, odir: cross >= 0 ? 1 : -1, loiterT: 40, strafeT: .8 });
        airSet(p, 'loiter');
      }
    }
    return;
  }
  if (p.phase === 'loiter') {   // 对地支援：盘旋并周期性扫射
    p.alt = Math.min(1, p.alt + dt / 2); speed(130);
    airOrbit(p, p.cx, p.cy, 110, p.odir || 1, dt);
    if ((p.strafeT -= dt) <= 0) p.strafeT = casStrafe(p) ? 1.5 : .5;
    if ((p.loiterT -= dt) <= 0) airSet(p, 'rtb');
    return;
  }
  // —— 返航：rtb 飞到舰尾一侧的顺风点（偏离中线约两个转弯半径）→ final 转弯切入斜角甲板中线下滑 → trap 着舰；
  //    甲板占用时 hold 在右舷外盘旋等待 ——
  p.rtbT = (p.rtbT || 0) + dt;
  if (dead) {   // 航母瘫痪：无处降落，飞回航母附近迫降
    p.alt = Math.max(.3, p.alt - dt * .1); speed(140);
    if (airSteer(p, c.x, c.y, dt) < 140 || p.rtbT > 60) airLost(p, '航母瘫痪，舰载机无处降落，迫降海面', true);
    return;
  }
  const G = cvLanding(), rx = p.x - G.x, ry = p.y - G.y, along = rx * G.dx + ry * G.dy, lat = -rx * G.dy + ry * G.dx, hd = Math.abs(airAng(p.heading - G.a));
  const s = lat >= 0 ? 1 : -1, ax = G.x - G.dx * 380 - G.dy * s * 150, ay = G.y - G.dy * 380 + G.dx * s * 150;
  if (p.rtbT > 90) {   // 兜底：长时间未能着舰，直接收回
    Object.assign(p, { tl: CVG.td, spd: 60, rest: 0 }); airSet(p, 'trap');
    return;
  }
  if (p.phase === 'final') {
    const k = clamp(-along / 330, 0, 1);
    speed(lerp(78, 130, k)); p.alt = Math.min(p.alt, .06 + k * .94);
    const look = Math.min(along + 100, 30);
    airSteer(p, G.x + G.dx * look, G.y + G.dy * look, dt, true);
    if (along >= -3) {
      if (Math.abs(lat) < 12 && hd < .5) { Object.assign(p, { tl: CVG.td, spd: Math.min(p.spd, 90), rest: 0 }); airSet(p, 'trap'); }
      else { airSet(p, 'rtb'); p.alt = Math.max(p.alt, .35); }   // 复飞
    } else if (Math.abs(lat) > 320 || along < -900) airSet(p, 'rtb');
    return;
  }
  p.alt = Math.min(1, p.alt + dt / 3);
  const busy = cvDeckBusy(p), da = dist(p.x, p.y, ax, ay);
  if (p.phase === 'hold') {
    speed(140);
    const [hx, hy] = cvW(-40, 240);
    airOrbit(p, hx, hy, 130, 1, dt);
    if (!busy) airSet(p, 'rtb');
    return;
  }
  speed(sp.spd);
  if (!busy && along < -200 && along > -650 && Math.abs(lat) < 90 && hd < .6) { airSet(p, 'final'); return; }   // 已在进近航线上
  if (busy && da < 300) { airSet(p, 'hold'); return; }
  airSteer(p, ax, ay, dt);
  if (da < 70 && !busy) airSet(p, 'final');
}

// 攻击机：沿进场方向投下三连弹（以目标为中心，间隔 34）
function strikeDrop(p) {
  p.dropped = true; p.egT = 1.4;
  const ch = Math.cos(p.heading), sh = Math.sin(p.heading);
  for (let i = 0; i < 3; i++) {
    const off = (i - 1) * 34 + gauss() * 8, side = gauss() * 6;
    fireShell(p.x, p.y, clamp(p.tx + ch * off - sh * side, 0, W), clamp(p.ty + sh * off + ch * side, 0, H), 'p', 'bomb', .7, false, { t: -i * .18 });
  }
}

// 轰炸机投弹：俯冲轰炸机两枚重磅弹几乎正中目标；重型轰炸机沿进场方向六弹地毯轰炸（间隔 26）
function bomberDrop(p) {
  p.dropped = true; p.egT = 1.6;
  const ch = Math.cos(p.heading), sh = Math.sin(p.heading);
  if (p.v === 'dive') for (let i = 0; i < 2; i++) fireShell(p.x, p.y, clamp(p.tx + gauss() * 7, 0, W), clamp(p.ty + gauss() * 7, 0, H), 'p', 'bomb', .45, false, { t: -i * .12 });
  else for (let i = 0; i < 6; i++) {
    const off = (i - 2.5) * 26 + gauss() * 6, side = gauss() * 10;
    fireShell(p.x, p.y, clamp(p.tx + ch * off - sh * side, 0, W), clamp(p.ty + sh * off + ch * side, 0, H), 'p', 'bomb', .9, false, { t: -i * .14 });
  }
}

// 对地支援机扫射：盘旋中心 160 内、我方视野内、距任何我方小组 45 以上的最近目标
function casStrafe(p) {
  const pT = S.teams.filter(q => q.side === 'p' && q.men.length), safe = (x, y) => !pT.some(q => dist(q.x, q.y, x, y) <= 45);
  let best = null, bd = 260, team = false;
  for (const q of S.teams) if (q.side === 'e' && q.men.length && dist(q.x, q.y, p.cx, p.cy) <= 160 && inVision(q.x, q.y)) {
    const d = dist(p.x, p.y, q.x, q.y);
    if (d < bd && safe(q.x, q.y)) { bd = d; best = q; team = true; }
  }
  for (const e of S.enemies) if (!e.dead && dist(e.x, e.y, p.cx, p.cy) <= 160 && inVision(e.x, e.y)) {
    const d = dist(p.x, p.y, e.x, e.y);
    if (d < bd && safe(e.x, e.y)) { bd = d; best = e; team = false; }
  }
  if (!best) return false;
  if (team) {
    suppress(best, 30, p.x, p.y);
    if (Math.random() < .25 * coverAt(best.x, best.y) / .9 * (SMOKE[ci(best.x, best.y)] ? .5 : 1)) killMan(best);
    for (const o of S.teams) if (o !== best && o.side === 'e' && o.men.length && dist(o.x, o.y, best.x, best.y) < 22) suppress(o, 12, p.x, p.y);
  } else {
    damageEnemy(best, 1.5);
    best.sup = Math.min(100, (best.sup || 0) + 45);
  }
  for (let k = 0; k < 4; k++) tracer(p.x, p.y, best.x + gauss() * 7, best.y + gauss() * 7, 'p', true);
  Object.assign(p, { gunT: .35, gx: best.x, gy: best.y });
  S.stats.shots++;
  log('对地支援机开始扫射', 'info', 'strafe', 20, best);
  return true;
}

// 防空炮：190 内每 0.5 秒判定一次；被压制的炮位命中率下降
function airAA(p, dt) {
  if ((p.aaT = (p.aaT || 0) - dt) > 0) return;
  p.aaT = .5;
  const sp = AIR_SPEC[p.kind] || AIR_SPEC.strike;
  for (const a of S.enemies) {
    if (a.dead || a.kind !== 'aa' || dist(a.x, a.y, p.x, p.y) > 190) continue;
    tracer(a.x, a.y, p.x + gauss() * 14, p.y + gauss() * 14, 'e', inVision(a.x, a.y));
    if (a.kx == null && Math.random() < .15) { a.kx = a.x; a.ky = a.y; log('防空炮火暴露位置', 'warn', null, 0, a); }
    const k = p.kind === 'bomber' ? (p.v === 'dive' ? (p.diving ? 1.3 : 1) : .75) : 1;
    if (Math.random() < sp.aa * k * (1 - (a.sup || 0) / 130)) { airLost(p, `${airName(p.kind, p.v)}被击落`); break; }
  }
}

// 损失一架飞机：击落（空中爆炸 + 翻滚坠落）或迫降（水花）
function airLost(p, msg, ditch) {
  if (p.dead) return;
  p.dead = true;
  const w = airWing(p);
  if (w) w.state = 'lost';
  if (ditch) S.fx.push({ kind: 'flash', x: p.x, y: p.y, r: 12, life: 0, max: .8, side: 'p' });
  else {
    S.fx.push({ kind: 'boom', x: p.x, y: p.y, r: 22, life: 0, max: 1, side: 'p' });
    S.air.wrecks.push({ x: p.x, y: p.y, h: p.heading, spd: Math.min(80, p.spd * .4), kind: p.kind, v: p.v || null, t: S.t, hit: false });
  }
  if (msg) log(msg, 'bad', null, 0, { x: p.x, y: p.y });
}
const airWreckPos = (w, age) => [w.x + Math.cos(w.h) * w.spd * age, w.y + Math.sin(w.h) * w.spd * age];
// 中止起飞（航母瘫痪时仍在弹射器上的飞机）
function airAbort(p) {
  p.dead = true;
  const w = airWing(p);
  if (w && w.state !== 'lost') { w.state = p.phase === 'cat' || p.phase === 'roll' ? 'deck' : 'lost'; w.rearmT = 0; }
}

// —— 航母机动：只在集结线以北 150 以南的深水区；转向平缓 ——
function orderCV(x, y) {
  if (!S.cv || !S.air) initCarrier();
  const c = S.cv;
  if (c.hp <= 0) { log('航母已瘫痪，无法机动', 'warn', 'cvmv', 2); return false; }
  if (!isFinite(x) || !isFinite(y)) return false;
  const deploy = S.phase === 'deploy', ymin = deploy ? STAGING_Y + 40 : STAGING_Y - 150;
  x = clamp(x, 90, W - 90); y = Math.min(y, H - 30);
  if (y < ymin || typeAt(x, y) !== T.DEEP) {
    log(deploy ? '部署阶段航母只能停在集结海域' : '航母只能在集结线以北 150 以南的深水区机动', 'warn', 'cvl', 2);
    return false;
  }
  if (deploy) Object.assign(c, { x, y, tx: x, ty: y, moving: false });
  else Object.assign(c, { tx: x, ty: y, moving: true, pathT: -9 });
  return true;
}

function cvClear(x0, y0, x1, y1) {
  const n = Math.ceil(dist(x0, y0, x1, y1) / 15);
  for (let s = 1; s <= n; s++) if (typeAt(lerp(x0, x1, s / n), lerp(y0, y1, s / n)) > T.SHOAL) return false;
  return true;
}

function updateCarrier(dt) {
  if (!S.cv || !S.air) initCarrier();
  cvMove(S.cv, dt);
  for (const x of S.cvx || []) cvMove(x, dt);
}
function cvMove(c, dt) {
  if (c.stepT === S.t) return;   // 同一推演步只更新一次（step 中另有调用也无妨）
  c.stepT = S.t;
  if (c.hp <= 0) { c.moving = false; return; }
  if (!c.moving) return;
  const d = dist(c.x, c.y, c.tx, c.ty);
  if (d < 6) { c.moving = false; return; }
  if (S.t - (c.pathT ?? -9) > 1) { c.pathT = S.t; c.direct = cvClear(c.x, c.y, c.tx, c.ty); }
  let wx = c.tx, wy = c.ty;
  if (!c.direct && d > 30) { const f = field(c.tx, c.ty, 'ship'), n = f && nextStep(f, c.x, c.y); if (n) [wx, wy] = n; }
  const df = airAng(Math.atan2(wy - c.y, wx - c.x) - c.heading);
  c.heading = airAng(c.heading + clamp(df, -.18 * dt, .18 * dt));
  const sp = 10 * clamp(Math.cos(df), .25, 1) * clamp(d / 50, .35, 1) * (typeAt(c.x, c.y) === T.SHOAL ? .55 : 1) * dt;
  const nx = c.x + Math.cos(c.heading) * sp, ny = c.y + Math.sin(c.heading) * sp;
  if (typeAt(nx, ny) <= T.SHOAL && ny >= STAGING_Y - 200) { c.x = clamp(nx, 60, W - 60); c.y = Math.min(ny, H - 20); }
}

// 爆炸落在舰体 30 以内：甲板受损；直接命中可能毁掉甲板上的飞机；归零即瘫痪（由 combat.js impact 调用）
function cvImpact(x, y, pw) { for (const c of cvAll()) withCV(c, () => cvImpact1(x, y, pw)); }
function cvImpact1(x, y, pw) {
  const c = S.cv, h = cvHome(c), nm = c.name || '航母';
  if (!c || c.hp <= 0 || !pw || !pw.ship) return;
  const [u, v] = cvL(x, y), d = Math.hypot(Math.max(0, Math.abs(u) - 75), Math.max(0, Math.abs(v) - 13));
  if (d >= 30) return;
  c.hp = Math.max(0, c.hp - pw.ship * (1 - d / 30 * .6)); c.hitT = S.t;
  if (d === 0) {
    for (const p of S.planes) if (!p.dead && cvHome(p) === h && (p.phase === 'cat' || p.phase === 'roll' || p.phase === 'trap') && dist(p.x, p.y, x, y) < 16) airLost(p, `${(AIR_SPEC[p.kind] || AIR_SPEC.strike).name}在甲板上被炸毁`);
    if (Math.random() < .3) {
      let best = null, bd = 40;
      const wing = S.air.wing.filter(w => cvHome(w) === h);
      for (const [id, j] of cvPark(c, wing)) {   // 只有停在甲板上的会被炸到，机库里的不受影响
        const s = CVG.slots[j], dd = dist(s[0], s[1], u, v);
        if (dd < bd) { bd = dd; best = wing.find(w => w.id === id); }
      }
      if (best) { best.state = 'lost'; log(`${AIR_SPEC[best.type].name}在甲板上被炸毁`, 'bad', null, 0, c); }
    }
  }
  if (c.hp > 0) { log(`${nm}中弹，飞行甲板受损（${Math.ceil(c.hp)}/${c.maxhp}）`, 'bad', 'cvhit' + h, 4, c); return; }
  c.moving = false;
  for (const p of S.planes) if (cvHome(p) === h && (p.phase === 'cat' || p.phase === 'roll')) airAbort(p);
  S.fx.push({ kind: 'boom', x: c.x, y: c.y, r: 60, life: 0, max: 1.6, side: 'p' });
  const alt = cvAll().some(o => o !== c && o.hp > 0);
  log(alt ? `${nm}遭重创，飞行甲板瘫痪：舰载机改由其他航母起降` : '航母遭重创，飞行甲板瘫痪，舰载机无法再起降', 'bad', null, 0, c);
  if (alt) for (const w of S.air.wing) if (cvHome(w) === h && w.state !== 'lost' && w.state !== 'deck' && w.state !== 'rearm') w.home = cvHome(cvAll().find(o => o !== c && o.hp > 0));
  airCount();
}

// 视野来源（由 updateVision 合并到我方视野）
function carrierVision() {
  return S && S.cv ? cvAll().map(c => ({ x: c.x, y: c.y, r: 90, h: 1.5 })) : [];
}

// —— 自动派机（S.cv.auto）：对地支援压制我军的敌人、空袭已标定火力点、侦察前线方向的敌占据点 ——
function updateAirAuto(dt) {
  const c = S.cv;
  if (!c || !c.auto || !cvAll().some(o => o.hp > 0) || S.phase !== 'battle') return;   // 旗舰的自动开关统管全部航母
  if ((c.autoT = (c.autoT ?? 2) - dt) > 0) return;
  c.autoT = 3;
  if (typeof awAutoP === 'function' && awAutoP()) return;   // 制空（airwar.js）：先派战斗机拦截 / 巡逻
  // 敌方掌握制空权、我又没有战斗机在空：攻击机与轰炸机暂缓，对地支援只在我军压力很大时出动
  const awBad = typeof awState === 'function' && awState() === 'e' && !S.planes.some(p => !p.dead && p.kind === 'fighter' && p.alt > .3);
  // 指挥官的航空任务（commander.js）：H 时侦察、受阻攻击的对地支援、假目标后的复查与再次出击
  const T = typeof cmdAirTask === 'function' ? cmdAirTask(c) : null;
  if (T && launchPlane(T.k, T.x, T.y)) { if (typeof cmdAirLaunched === 'function') cmdAirLaunched(T, S.planes[S.planes.length - 1]); return; }
  const pT = S.teams.filter(q => q.side === 'p' && q.men.length);
  const near = (x, y, r) => pT.filter(q => dist(q.x, q.y, x, y) < r);
  const busy = (kind, x, y, r) => S.planes.some(p => p.kind === kind && !p.dead && (p.phase === 'cat' || p.phase === 'roll' || p.phase === 'out' || p.phase === 'loiter') && dist(p.cx ?? p.tx, p.cy ?? p.ty, x, y) < r);
  if (S.assets.cas > 0 && pT.length) {
    let best = null, bs = 0;
    for (const o of S.teams) if (o.side === 'e' && o.men.length && inVision(o.x, o.y)) {
      const nb = near(o.x, o.y, 220);
      if (!nb.length || nb.some(q => dist(q.x, q.y, o.x, o.y) < 60) || busy('cas', o.x, o.y, 200)) continue;
      const s = nb.reduce((a, q) => a + 1 + q.sup / 50, 0);
      if (typeof eaThreat === 'function' && eaThreat(o.x, o.y) >= 1 && s < 8) continue;   // 已知敌单兵防空：盘旋的对地支援机不去送（我方压力很大时例外）
      if (s > bs) { bs = s; best = o; }
    }
    if (best && bs >= (awBad ? 6 : 2) && launchPlane('cas', best.x, best.y)) return;
  }
  if (S.assets.strike > 0 && !awBad) {
    const PRI = { coastal: 5, ascm: 5, tel: 5, airfield: 4.5, arty: 4, aa: 3.5, mortar: 3, bunker: 2 };
    let best = null, bs = 0;
    for (const e of S.enemies) if (!e.dead && e.kx != null) {
      if (near(e.kx, e.ky, typeof cmdAirSafe === 'function' ? cmdAirSafe() : 90).length || busy('strike', e.kx, e.ky, 70) || S.shells.some(s => s.side === 'p' && s.kind === 'bomb' && dist(s.x1, s.y1, e.kx, e.ky) < 60)) continue;
      const s = (PRI[e.kind] || 1) * (e.kind === 'bunker' && !near(e.kx, e.ky, 320).length ? .3 : 1) * (typeof eaThreat === 'function' && eaThreat(e.kx, e.ky) >= 1 ? .4 : 1);
      if (s > bs) { bs = s; best = e; }
    }
    if (best && launchPlane('strike', best.kx, best.ky)) { if (typeof cmdAirLaunched === 'function') cmdAirLaunched({ k: 'strike', x: best.kx, y: best.ky, eid: best.id }, S.planes[S.planes.length - 1]); return; }
  }
  if (S.assets.bomber > 0 && !awBad) {   // 轰炸机：炮兵阵地群、岸防炮、碉堡（周围已标定目标越多越优先）；我军 150 以内不投
    const PRI = { coastal: 5, airfield: 5, ascm: 4.5, tel: 4.5, arty: 4.5, aa: 3, mortar: 3, bunker: 2.5 };
    let best = null, bs = 0;
    for (const e of S.enemies) if (!e.dead && e.kx != null) {
      if (near(e.kx, e.ky, 150).length || busy('bomber', e.kx, e.ky, 90) || S.shells.some(s => s.side === 'p' && s.kind === 'bomb' && dist(s.x1, s.y1, e.kx, e.ky) < 60)) continue;
      const s = (PRI[e.kind] || 1) + .8 * S.enemies.filter(o => o !== e && !o.dead && o.kx != null && dist(o.kx, o.ky, e.kx, e.ky) < 90).length;
      if (s > bs) { bs = s; best = e; }
    }
    if (best && launchPlane('bomber', best.kx, best.ky)) return;
  }
  if (S.assets.recon > 0 && !S.planes.some(p => p.kind === 'recon' && !p.dead) && S.t - (c.reconT ?? -99) > 40) {
    // 前线方向：我方步兵重心；尚未登陆时用登陆舰队重心
    const inf = pT.filter(q => q.kind === 'inf'), sh = S.ships.filter(s => alive(s)), src = inf.length ? inf : pT.length ? pT : sh.length ? sh : [c];
    const fx = src.reduce((a, q) => a + q.x, 0) / src.length, fy = src.reduce((a, q) => a + q.y, 0) / src.length;
    const tgt = S.points.filter(p => p.owner !== 'p').sort((a, b) => dist(a.x, a.y, fx, fy) - dist(b.x, b.y, fx, fy))[0];
    if (tgt && launchPlane('recon', tgt.x, tgt.y)) c.reconT = S.t;
  }
}
function toggleCvAuto() {
  if (!S.cv || !S.air) initCarrier();
  S.cv.auto = !S.cv.auto;
  log(S.cv.auto ? '航母自动派机支援：开启' : '航母自动派机支援：关闭', 'info', 'cvauto', 0);
  if (typeof updateHud === 'function') updateHud();
}

// 单位卡数据（hud.js updateCards 使用）
function cvCard() {
  if (!S.cv || !S.air) initCarrier();
  const c = S.cv, live = S.air.wing.filter(w => w.state !== 'lost'), n = live.length || 1;
  const ready = live.filter(w => w.state === 'deck' && (cvOf(cvHome(w)) || { hp: 0 }).hp > 0).length, up = live.filter(w => w.state === 'launch' || w.state === 'out' || w.state === 'return').length;
  return { n: ready, hp: clamp(c.hp / c.maxhp, 0, 1), ready: ready / n, air: up / n,
    state: c.hp <= 0 ? 'rout' : c.hp < c.maxhp * .4 || S.t < (c.exposedUntil || 0) ? 'waver' : 'ok', mini: c.auto ? 'auto' : c.moving ? 'move' : 'hold' };
}

// 点选：世界坐标落在航母舰体上返回 'CV'
function pickCarrier(p) {
  const c = S && S.cv;
  if (!c || !p || !isFinite(p.x) || !isFinite(p.y)) return null;
  const rd = typeof R !== 'undefined' && R.s > 0, k = rd ? cvScale() : 1, pad = rd ? px(4) : 0, [u, v] = cvL(p.x, p.y);
  return Math.abs(u) <= 78 * k + pad && Math.abs(v) <= 19 * k + pad ? 'CV' : null;
}

// —— 绘制 ——
const cvScale = () => Math.max(1, 56 / (CV_LEN * R.s));   // 小屏全图时放大，保证航母至少约 56px 长

function cvPath(ctx, pts) { ctx.beginPath(); for (const [u, v] of pts) ctx.lineTo(u, v); ctx.closePath(); }

function airShape(ctx, type) {
  const h = AIR_SIL[type] || AIR_SIL.strike;
  if (type === 'heli') { ctx.beginPath(); ctx.ellipse(1.5, 0, 6.5, 2.8, 0, 0, 7); ctx.moveTo(-4, .7); ctx.lineTo(-12.5, .5); ctx.lineTo(-12.5, -.5); ctx.lineTo(-4, -.7); return; }
  ctx.beginPath();
  for (const [x, y] of h) ctx.lineTo(x, y);
  for (let i = h.length - 1; i >= 0; i--) ctx.lineTo(h[i][0], -h[i][1]);
  ctx.closePath();
}

// 飞机剪影：机身 + 机翼 + 尾翼；侦察机带雷达圆盘，对地支援机带双发动机舱，攻击机挂弹
function drawAircraft(ctx, x, y, a, type, size, col, alpha, bank, lw, bombs) {
  const sc = size / 21;
  ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.scale(sc, sc * (1 - .32 * Math.min(1, Math.abs(bank || 0))));
  airShape(ctx, type);
  ctx.fillStyle = `rgba(2,10,6,${.88 * alpha})`; ctx.fill();
  ctx.strokeStyle = rgba(col, alpha); ctx.lineWidth = lw / sc; ctx.stroke();
  ctx.lineWidth = lw / sc * .7;
  ctx.beginPath(); ctx.moveTo(8.5, 0); ctx.lineTo(4, 0); ctx.stroke();   // 座舱
  if (type === 'recon') {
    ctx.beginPath(); ctx.arc(-1.5, 0, 3.4, 0, 7); ctx.fillStyle = `rgba(2,10,6,${alpha})`; ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-4.9, 0); ctx.lineTo(1.9, 0); ctx.stroke();
  } else if (type === 'cas') {
    for (const s of [-1, 1]) ctx.strokeRect(-6.5, s * 2.9 - 1, 3.4, 2);
  } else if (type === 'bomber') {   // 四台发动机
    for (const s of [-1, 1]) for (const y of [4.2, 8]) ctx.strokeRect(1.2, s * y - .8, 3.2, 1.6);
  } else if (type === 'dive') {   // 机翼下的俯冲减速板
    ctx.beginPath(); for (const s of [-1, 1]) { ctx.moveTo(-.8, s * 6.2); ctx.lineTo(-.8, s * 8.6); } ctx.stroke();
  } else if (type === 'heli') {   // 主旋翼
    ctx.setLineDash([2.2, 1.6]); ctx.beginPath(); ctx.arc(1.5, 0, 9.5, 0, 7); ctx.stroke(); ctx.setLineDash([]);
  } else if (type === 'fighter') {   // 外倾双垂尾
    ctx.beginPath(); for (const s of [-1, 1]) { ctx.moveTo(-6.5, s * 1.7); ctx.lineTo(-10, s * 2.4); } ctx.stroke();
  }
  if (bombs) {
    ctx.fillStyle = rgba(COL.amber, alpha);
    for (const s of [-1, 0, 1]) { ctx.beginPath(); ctx.ellipse(-1.5 + Math.abs(s) * .5, s * 4.6, 1.6, .8, 0, 0, 7); ctx.fill(); }
  }
  ctx.restore();
}

function drawCarrier(time) {
  if (!S || !S.cv) return;
  drawCarrier1(time);
  for (const x of S.cvx || []) withCV(x, () => drawCarrier1(time));
}
function drawCarrier1(time) {
  const c = S && S.cv, h = cvHome(c);
  if (!c || !R.ctx || !isFinite(c.x) || !isFinite(c.y)) return;
  const ctx = R.ctx, k = cvScale(), lw = n => px(n) / k, dead = c.hp <= 0, det = CV_LEN * k * R.s;
  const col = dead ? COL.amber : COL.g, hit = S.t - (c.hitT ?? -99) < .35, sel = !h && typeof isSel === 'function' && isSel('CV');
  const wing = S.air ? S.air.wing.filter(w => cvHome(w) === h) : [], deckPl = S.planes.filter(p => !p.dead && cvHome(p) === h && (p.phase === 'cat' || p.phase === 'roll'));
  if (c.moving && !dead) {   // 航向指示
    ctx.strokeStyle = rgba(COL.sel, sel ? .6 : .25); ctx.lineWidth = px(1); ctx.setLineDash([px(4), px(4)]);
    ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(c.tx, c.ty); ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(c.tx, c.ty, px(5), 0, 7); ctx.stroke();
  }
  ctx.save();
  ctx.translate(c.x, c.y); ctx.rotate(c.heading); ctx.scale(k, k);
  if (c.moving && !dead) {   // 舰尾 V 形尾流与舰首浪
    for (const s of [-1, 1]) {
      const g = ctx.createLinearGradient(-77, 0, -190, 0);
      g.addColorStop(0, rgba(COL.intel, .35)); g.addColorStop(1, rgba(COL.intel, 0));
      ctx.strokeStyle = g; ctx.lineWidth = lw(1.4);
      ctx.beginPath(); ctx.moveTo(-74, s * 9); ctx.lineTo(-190, s * (30 + 4 * Math.sin(time * 2 + s))); ctx.stroke();
    }
    const g = ctx.createLinearGradient(-77, 0, -150, 0);
    g.addColorStop(0, rgba('#d4fff0', .1)); g.addColorStop(1, rgba('#d4fff0', 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(-76, -6); ctx.lineTo(-150, -10); ctx.lineTo(-150, 10); ctx.lineTo(-76, 6); ctx.fill();
    ctx.strokeStyle = rgba('#d4fff0', .35); ctx.lineWidth = lw(1.2);
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(79, 0); ctx.quadraticCurveTo(70, s * 12, 52, s * 19); ctx.stroke(); }
  }
  // 舰体投影与飞行甲板
  ctx.save(); ctx.translate(4 * Math.sin(c.heading) + 3 * Math.cos(c.heading), 4 * Math.cos(c.heading) - 3 * Math.sin(c.heading));
  cvPath(ctx, CVG.deck); ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fill(); ctx.restore();
  cvPath(ctx, CVG.deck);
  ctx.fillStyle = 'rgba(2,10,6,.9)'; ctx.fill();
  ctx.strokeStyle = hit ? rgba('#ffffff', .95) : rgba(col, dead ? .65 : .95); ctx.lineWidth = lw(hit ? 2.6 : 1.6); ctx.stroke();
  const L = CVG.land, nx = -(L.v1 - L.v0) / CV_LLEN, ny = (L.u1 - L.u0) / CV_LLEN;
  if (det >= 70) {
    // 斜角着舰区：两侧边线、中线虚线、拦阻索
    ctx.strokeStyle = rgba(col, .35); ctx.lineWidth = lw(1);
    ctx.beginPath();
    for (const s of [-8, 8]) { ctx.moveTo(L.u0 + nx * s, L.v0 + ny * s); ctx.lineTo(L.u1 + nx * s, L.v1 + ny * s); }
    ctx.stroke();
    ctx.setLineDash([lw(5), lw(4)]); ctx.strokeStyle = rgba(STRUCT, .45);
    ctx.beginPath(); ctx.moveTo(L.u0, L.v0); ctx.lineTo(L.u1, L.v1); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = rgba(STRUCT, .3);
    ctx.beginPath();
    for (const t of [.1, .14, .18, .22]) { const u = lerp(L.u0, L.u1, t), v = lerp(L.v0, L.v1, t); ctx.moveTo(u + nx * 6, v + ny * 6); ctx.lineTo(u - nx * 6, v - ny * 6); }
    ctx.stroke();
    // 舰首轴向中线
    ctx.setLineDash([lw(4), lw(4)]); ctx.strokeStyle = rgba(STRUCT, .25);
    ctx.beginPath(); ctx.moveTo(-74, 6); ctx.lineTo(-30, 6); ctx.stroke(); ctx.setLineDash([]);
  }
  // 弹射器：有飞机待射或滑跑时发光
  for (let i = 0; i < 2; i++) {
    const [u0, v0, u1] = CVG.cats[i], on = deckPl.find(p => (p.cat || 0) === i && (p.phase === 'roll' || p.wait < 1.2));
    ctx.strokeStyle = on ? rgba(COL.amber, .55 + .4 * Math.sin(time * 14)) : rgba(STRUCT, det >= 70 ? .3 : .18);
    ctx.lineWidth = lw(on ? 2.2 : 1);
    ctx.beginPath(); ctx.moveTo(u0, v0); ctx.lineTo(u1 - 2, v0); ctx.stroke();
    if (on && on.phase === 'roll') {   // 弹射蒸汽
      const g = ctx.createLinearGradient(u0, v0, on.lu, v0);
      g.addColorStop(0, rgba('#d4fff0', 0)); g.addColorStop(1, rgba('#d4fff0', .5));
      ctx.strokeStyle = g; ctx.lineWidth = lw(4); ctx.beginPath(); ctx.moveTo(u0, v0); ctx.lineTo(on.lu, v0); ctx.stroke();
    }
  }
  if (det >= 160) {   // 升降机
    ctx.strokeStyle = rgba(STRUCT, .22); ctx.lineWidth = lw(1);
    ctx.strokeRect(-62, 9.5, 10, 5); ctx.strokeRect(22, -14.5, 9, 5);
  }
  // 舰岛：右舷上层建筑、烟囱、桅杆与旋转雷达
  ctx.fillStyle = 'rgba(2,10,6,1)'; ctx.strokeStyle = rgba(STRUCT, dead ? .5 : .85); ctx.lineWidth = lw(1.3);
  ctx.beginPath(); ctx.moveTo(-4, 11); ctx.lineTo(18, 11); ctx.lineTo(21, 13.5); ctx.lineTo(18, 17); ctx.lineTo(-4, 17); ctx.closePath(); ctx.fill(); ctx.stroke();
  if (det >= 70) {
    ctx.lineWidth = lw(1); ctx.strokeRect(5, 12.3, 5, 3.4);
    const ra = dead ? 0 : time * 3;
    ctx.beginPath(); ctx.moveTo(14 - Math.cos(ra) * 3, 14 - Math.sin(ra) * 3); ctx.lineTo(14 + Math.cos(ra) * 3, 14 + Math.sin(ra) * 3); ctx.stroke();
    ctx.fillStyle = rgba(dead ? COL.enemy : COL.g, .5 + .5 * Math.sin(time * 4)); ctx.beginPath(); ctx.arc(1, 14, lw(1.6), 0, 7); ctx.fill();
  }
  // 甲板停机：待命（青）、整备中（琥珀 + 进度）、空位（机位原主出击中 ＋、已损失 ×）；机库里的飞机不画，只在舰下状态点里
  const park = cvPark(c, wing), slotOf = new Map([...park].map(([id, j]) => [j, id]));
  for (let j = 0; j < Math.min(CVG.slots.length, wing.length); j++) {
    const [u, v, r] = CVG.slots[j], id = slotOf.get(j), w = id != null ? wing.find(o => o.id === id) : null;
    if (w) {
      const rearm = w.state === 'rearm', cl = rearm ? COL.amber : COL.intel;
      if (det < 80) { ctx.fillStyle = rgba(cl, rearm ? .55 : .9); ctx.fillRect(u - 2.6, v - 2.6, 5.2, 5.2); continue; }
      drawAircraft(ctx, u, v, r, airSilKey(w.type, w.v), w.type === 'bomber' ? 10.5 : 8.5, cl, rearm ? .7 : 1, 0, lw(1.1), (w.type === 'strike' || w.type === 'bomber') && !rearm);
      if (rearm && det >= 160) {
        ctx.strokeStyle = rgba(COL.amber, .8); ctx.lineWidth = lw(1.4);
        ctx.beginPath(); ctx.arc(u, v, 5.6, -1.57, -1.57 + (1 - clamp(w.rearmT / AIR_REARM, 0, 1)) * 6.283); ctx.stroke();
      }
    } else if (det >= 160) {
      const lost = wing[j].state === 'lost';
      ctx.strokeStyle = rgba(lost ? COL.enemy : STRUCT, .22); ctx.lineWidth = lw(1);
      ctx.beginPath();
      if (lost) { ctx.moveTo(u - 2.5, v - 2.5); ctx.lineTo(u + 2.5, v + 2.5); ctx.moveTo(u + 2.5, v - 2.5); ctx.lineTo(u - 2.5, v + 2.5); }
      else { ctx.moveTo(u - 3, v); ctx.lineTo(u + 3, v); ctx.moveTo(u, v - 2); ctx.lineTo(u, v + 2); }
      ctx.stroke();
    }
  }
  if (dead) {   // 甲板火灾
    CVG.fires.forEach(([u, v], i) => {
      const r = 7 + 2.5 * Math.sin(time * 9 + i * 1.7), g = ctx.createRadialGradient(u, v, 0, u, v, r);
      g.addColorStop(0, rgba('#fff3d6', .85)); g.addColorStop(.35, rgba(COL.amber, .7)); g.addColorStop(1, rgba(COL.enemy, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(u, v, r, 0, 7); ctx.fill();
    });
  }
  if (S.t < (c.exposedUntil || 0) && !dead && c.y - coastAt(c.x) < 760) {   // 起降作业暴露（处于岸防炮可及海域）
    ctx.strokeStyle = rgba(COL.enemy, .35 + .35 * Math.sin(time * 10)); ctx.lineWidth = lw(1.5); ctx.setLineDash([lw(5), lw(4)]);
    ctx.beginPath(); ctx.ellipse(0, 0, 96, 32, 0, 0, 7); ctx.stroke(); ctx.setLineDash([]);
  }
  if (sel) {   // 选中：四角括线
    ctx.strokeStyle = COL.sel; ctx.lineWidth = lw(2.2);
    for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      ctx.beginPath(); ctx.moveTo(su * 84, sv * 13); ctx.lineTo(su * 84, sv * 23); ctx.lineTo(su * 70, sv * 23); ctx.stroke();
    }
  }
  ctx.restore();
  if (dead) {   // 黑烟向东北飘散
    for (let i = 0; i < 6; i++) {
      const ph = (time * .25 + i / 6) % 1, sx = c.x + 20 + ph * 140, sy = c.y - 10 - ph * 70, r = (10 + ph * 34) * Math.max(1, k * .7);
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
      g.addColorStop(0, rgba(COL.smoke, .22 * (1 - ph))); g.addColorStop(1, rgba(COL.smoke, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, r, 0, 7); ctx.fill();
    }
  }
  // 舰体下方：甲板耐久条 + 联队状态点（侦察 ○、攻击 △、对地支援 ◇）
  const ey = (78 * Math.abs(Math.sin(c.heading)) + 19 * Math.abs(Math.cos(c.heading))) * k;
  const bw = clamp(100 * k, px(46), px(130)), by = c.y + ey + px(7), f = clamp(c.hp / c.maxhp, 0, 1);
  ctx.fillStyle = rgba(col, .2); ctx.fillRect(c.x - bw / 2, by, bw, px(3));
  ctx.fillStyle = f > .5 ? COL.g : f > .25 ? COL.amber : COL.enemy; ctx.fillRect(c.x - bw / 2, by, bw * f, px(3));
  const gap = px(6.5), list = AIR_TYPES.flatMap(t => wing.filter(w => w.type === t)), tw = list.length * gap + px(5) * 2;
  let x = c.x - tw / 2 + gap / 2, prev = null;
  const yy = by + px(9), r = px(2.3);
  for (const w of list) {
    if (prev && prev !== w.type) x += px(5);
    prev = w.type;
    const st = w.state, cl = st === 'deck' ? (dead ? COL.amber : COL.intel) : st === 'rearm' ? COL.amber : st === 'lost' ? COL.enemy : COL.intel;
    ctx.strokeStyle = rgba(cl, st === 'lost' ? .4 : .95); ctx.fillStyle = rgba(cl, .95); ctx.lineWidth = px(1.1);
    if (st === 'lost') { ctx.beginPath(); ctx.moveTo(x - r, yy - r); ctx.lineTo(x + r, yy + r); ctx.moveTo(x + r, yy - r); ctx.lineTo(x - r, yy + r); ctx.stroke(); }
    else {
      ctx.beginPath();
      if (w.type === 'recon') ctx.arc(x, yy, r, 0, 7);
      else if (w.type === 'strike') { ctx.moveTo(x, yy - r * 1.2); ctx.lineTo(x + r * 1.1, yy + r * .9); ctx.lineTo(x - r * 1.1, yy + r * .9); ctx.closePath(); }
      else if (w.type === 'bomber') ctx.rect(x - r * 1.1, yy - r * 1.1, r * 2.2, r * 2.2);
      else if (w.type === 'fighter') { ctx.moveTo(x - r * 1.2, yy - r * .9); ctx.lineTo(x, yy + r * 1.1); ctx.lineTo(x + r * 1.2, yy - r * .9); ctx.lineTo(x, yy - r * .2); ctx.closePath(); }   // 战斗机：V 形
      else { ctx.moveTo(x, yy - r * 1.25); ctx.lineTo(x + r * 1.1, yy); ctx.lineTo(x, yy + r * 1.25); ctx.lineTo(x - r * 1.1, yy); ctx.closePath(); }
      if (st === 'deck') ctx.fill(); else ctx.stroke();
      if (st === 'rearm') { ctx.save(); ctx.clip(); const p = 1 - clamp(w.rearmT / AIR_REARM, 0, 1); ctx.fillRect(x - r * 1.3, yy + r * 1.3 - p * r * 2.6, r * 2.6, p * r * 2.6); ctx.restore(); }
    }
    x += gap;
  }
  const g = !h && typeof groupOf === 'function' ? groupOf('CV') : 0;
  if (g && typeof pips === 'function') pips(ctx, g, c.x, yy + px(7), COL.sel);
}

function drawPlanes(time) {
  const ctx = R.ctx, c = S.cv, k = c ? cvScale() : 1, big = n => Math.max(n, px(20));
  ctx.fillStyle = rgba(COL.intel, .16);
  for (const r of S.recon) ctx.fillRect(r.x - 1, r.y - 1, 2, 2);
  if (AIR_TRAILS.size) { const ids = new Set(S.planes.map(p => p.id)); for (const id of [...AIR_TRAILS.keys()]) if (!ids.has(id)) AIR_TRAILS.delete(id); }
  // 被击落：翻滚、拖着黑烟坠落
  for (const w of (S.air && S.air.wrecks) || []) {
    const age = S.t - w.t, u = clamp(age / 2.2, 0, 1);
    if (age < 0 || age > 2.2) continue;
    for (let j = 1; j <= 6; j++) {
      const a2 = age - j * .09;
      if (a2 < 0) break;
      const [sx, sy] = airWreckPos(w, a2);
      ctx.fillStyle = rgba(COL.smoke, .3 * (1 - j / 7)); ctx.beginPath(); ctx.arc(sx, sy, px(2) + j * 1.2, 0, 7); ctx.fill();
    }
    const [x, y] = airWreckPos(w, age);
    drawAircraft(ctx, x, y, w.h + age * 5, airSilKey(w.kind, w.v), big((AIR_SPEC[w.kind] || AIR_SPEC.strike).size) * (1 - u * .55), COL.amber, 1 - u * .6, Math.sin(age * 9), px(1.3), false);
  }
  for (const p of S.planes) {
    if (p.dead) continue;
    const sp = AIR_SPEC[p.kind] || AIR_SPEC.strike, onDeck = p.phase === 'cat' || p.phase === 'roll' || p.phase === 'trap';
    const air = clamp((p.alt || 0) * 1.6, 0, 1), size = lerp(8.5 * k, big(sp.size), air);
    let x = p.x, y = p.y;
    if (onDeck && c && k > 1) { const cc = cvOf(cvHome(p)) || c, [u, v] = cvL(p.x, p.y, cc); [x, y] = cvW(u * k, v * k, cc); }
    if (!isFinite(x) || !isFinite(y)) continue;
    // 任务标记
    if (p.phase === 'loiter' && p.kind !== 'fighter') {   // 战斗机的巡逻圈在 airwar.js 画
      ctx.strokeStyle = rgba(COL.intel, .4); ctx.lineWidth = px(1.2); ctx.setLineDash([px(3), px(5)]); ctx.lineDashOffset = -time * 20 * (p.odir || 1);
      ctx.beginPath(); ctx.arc(p.cx, p.cy, 110, 0, 7); ctx.stroke(); ctx.setLineDash([]); ctx.lineDashOffset = 0;
      ctx.strokeStyle = rgba(COL.intel, .7); ctx.lineWidth = px(2);
      ctx.beginPath(); ctx.arc(p.cx, p.cy, 118, -1.57, -1.57 + clamp(p.loiterT / 40, 0, 1) * 6.283); ctx.stroke();
      ctx.strokeStyle = rgba(COL.intel, .12); ctx.lineWidth = px(1); ctx.beginPath(); ctx.arc(p.cx, p.cy, 160, 0, 7); ctx.stroke();
    } else if (p.phase === 'out' && p.kind === 'recon') {
      const e = p.wp[p.wp.length - 1];
      ctx.strokeStyle = rgba(COL.intel, .3); ctx.lineWidth = px(1); ctx.setLineDash([px(2), px(6)]);
      ctx.beginPath(); ctx.moveTo(x, y); for (let i = Math.min(p.leg, p.wp.length - 1); i < p.wp.length; i++) ctx.lineTo(p.wp[i].x, p.wp[i].y); ctx.stroke();
      ctx.beginPath(); ctx.arc(e.x, e.y, px(4), 0, 7); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, 100, time * 2, time * 2 + 4.5); ctx.stroke(); ctx.setLineDash([]);
    } else if (p.phase === 'out' && p.kind === 'strike' && !p.dropped) {
      ctx.strokeStyle = rgba(COL.amber, .55 + .3 * Math.sin(time * 6)); ctx.lineWidth = px(1.2); ctx.setLineDash([px(3), px(3)]);
      ctx.beginPath(); ctx.arc(p.tx, p.ty, POWER.bomb.R, 0, 7); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(p.tx - px(6), p.ty); ctx.lineTo(p.tx + px(6), p.ty); ctx.moveTo(p.tx, p.ty - px(6)); ctx.lineTo(p.tx, p.ty + px(6)); ctx.stroke();
    } else if (p.phase === 'out' && p.kind === 'cas') {
      ctx.strokeStyle = rgba(COL.intel, .25); ctx.lineWidth = px(1); ctx.setLineDash([px(3), px(5)]);
      ctx.beginPath(); ctx.arc(p.tx, p.ty, 110, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    }
    // 尾迹（只在空中）
    if (air > .5) {
      let tr = AIR_TRAILS.get(p.id);
      if (!tr) AIR_TRAILS.set(p.id, tr = []);
      const l = tr[tr.length - 1];
      if (!l || dist(l[0], l[1], x, y) > 6) { tr.push([x, y]); if (tr.length > 26) tr.shift(); }
      ctx.lineWidth = px(1.3);
      for (let i = 1; i < tr.length; i++) {
        ctx.strokeStyle = rgba(COL.intel, .16 * i / tr.length * air);
        ctx.beginPath(); ctx.moveTo(tr[i - 1][0], tr[i - 1][1]); ctx.lineTo(tr[i][0], tr[i][1]); ctx.stroke();
      }
    }
    // 地面投影：高度越高偏得越远
    if (air > .05) {
      const o = size * .9 * air, sc = size / 21;
      ctx.save(); ctx.translate(x + o * .7, y + o); ctx.rotate(p.heading); ctx.scale(sc, sc * (1 - .32 * Math.min(1, Math.abs(p.bank || 0))));
      airShape(ctx, airSilKey(p.kind, p.v)); ctx.fillStyle = `rgba(0,0,0,${.38 * air})`; ctx.fill(); ctx.restore();
    }
    drawAircraft(ctx, x, y, p.heading, airSilKey(p.kind, p.v), size, COL.intel, 1, p.bank, px(1.4), (p.kind === 'strike' || p.kind === 'bomber') && !p.dropped);
    if (p.gunT > 0) {   // 机炮口焰
      const nx = x + Math.cos(p.heading) * size * .55, ny = y + Math.sin(p.heading) * size * .55;
      ctx.fillStyle = rgba('#fff3d6', .5 + .5 * Math.sin(time * 60)); ctx.beginPath(); ctx.arc(nx, ny, size * .14, 0, 7); ctx.fill();
    }
  }
}

function arrowAir(ctx, x, y, a, col) {
  const l = px(14);
  ctx.strokeStyle = col; ctx.setLineDash([]);
  ctx.beginPath(); ctx.moveTo(x - Math.cos(a) * l, y - Math.sin(a) * l); ctx.lineTo(x, y);
  ctx.moveTo(x - Math.cos(a - .5) * l * .6, y - Math.sin(a - .5) * l * .6); ctx.lineTo(x, y); ctx.lineTo(x - Math.cos(a + .5) * l * .6, y - Math.sin(a + .5) * l * .6); ctx.stroke();
}

// 出击工具预览（render3.js drawTool 调用）：侦察航带、三连弹落点、盘旋圈；无可用飞机时显示为红色
function drawAirTool(time) {
  const t = U.tool, m = U.mouse;
  if (!m || (t !== 'recon' && t !== 'strike' && t !== 'cas' && t !== 'bomber' && t !== 'fighter')) return false;
  const ctx = R.ctx, c = cvAll().filter(o => o.hp > 0).sort((a, b) => dist(a.x, a.y, m.x, m.y) - dist(b.x, b.y, m.x, m.y))[0] || S.cv, ok = !!(S.assets && S.assets[t] > 0 && c && c.hp > 0), col = ok ? COL.intel : COL.enemy;
  const ox = c ? c.x : m.x, oy = c ? c.y : H, a = Math.atan2(m.y - oy, m.x - ox);
  ctx.lineWidth = px(1.2); ctx.strokeStyle = rgba(col, .35); ctx.setLineDash([px(3), px(5)]);
  ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(m.x, m.y); ctx.stroke();
  if (t === 'recon') {
    const [bx, by] = airRay(m.x, m.y, a, 700), nx = -Math.sin(a) * 100, ny = Math.cos(a) * 100;
    ctx.fillStyle = rgba(col, .08);
    ctx.beginPath(); ctx.moveTo(m.x + nx, m.y + ny); ctx.lineTo(bx + nx, by + ny); ctx.lineTo(bx - nx, by - ny); ctx.lineTo(m.x - nx, m.y - ny); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = rgba(col, .55); ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(bx, by); ctx.stroke();
    ctx.strokeStyle = rgba(col, .38); ctx.beginPath(); ctx.moveTo(m.x + nx, m.y + ny); ctx.lineTo(bx + nx, by + ny); ctx.moveTo(m.x - nx, m.y - ny); ctx.lineTo(bx - nx, by - ny); ctx.stroke();
  } else if (t === 'bomber') {   // 会出击的变体：点目标 → 俯冲轰炸机（单个小圈）；其余 → 重型轰炸机（六弹地毯）
    const pt = S.enemies.some(e => !e.dead && e.kx != null && dist(e.kx, e.ky, m.x, m.y) < 40), has = v => S.air.wing.some(w => w.type === 'bomber' && w.state === 'deck' && (w.v || 'heavy') === v);
    const dive = pt ? has('dive') || !has('heavy') : !has('heavy') && has('dive');
    ctx.strokeStyle = rgba(ok ? COL.amber : COL.enemy, .9); ctx.lineWidth = px(1.7);
    const offs = dive ? [0] : [-2.5, -1.5, -.5, .5, 1.5, 2.5].map(i => i * 26);
    for (const o of offs) {
      const bx = m.x + Math.cos(a) * o, by = m.y + Math.sin(a) * o;
      ctx.setLineDash([px(3), px(4)]); ctx.beginPath(); ctx.arc(bx, by, dive ? 14 : POWER.bomb.R, 0, 7); ctx.stroke();
      ctx.setLineDash([]); ctx.beginPath(); ctx.arc(bx, by, px(2.5), 0, 7); ctx.stroke();
    }
    arrowAir(ctx, m.x - Math.cos(a) * 110, m.y - Math.sin(a) * 110, a, rgba(ok ? COL.amber : COL.enemy, .9));
  } else if (t === 'strike') {
    ctx.strokeStyle = rgba(ok ? COL.amber : COL.enemy, .9); ctx.lineWidth = px(1.7);
    for (let i = 0; i < 3; i++) {
      const o = (i - 1) * 34, bx = m.x + Math.cos(a) * o, by = m.y + Math.sin(a) * o;
      ctx.setLineDash([px(3), px(4)]); ctx.beginPath(); ctx.arc(bx, by, POWER.bomb.R, 0, 7); ctx.stroke();
      ctx.setLineDash([]); ctx.beginPath(); ctx.arc(bx, by, px(2.5), 0, 7); ctx.stroke();
    }
    arrowAir(ctx, m.x - Math.cos(a) * 90, m.y - Math.sin(a) * 90, a, rgba(ok ? COL.amber : COL.enemy, .9));
  } else if (t === 'fighter') {   // 战斗机：巡逻圈与拦截搜索范围（airwar.js）
    ctx.strokeStyle = rgba(col, .7); ctx.lineDashOffset = -time * 14;
    ctx.beginPath(); ctx.arc(m.x, m.y, typeof AW_CAP === 'number' ? AW_CAP : 160, 0, 7); ctx.stroke(); ctx.lineDashOffset = 0;
    ctx.strokeStyle = rgba(col, .18); ctx.beginPath(); ctx.arc(m.x, m.y, typeof AW_RNG === 'number' ? AW_RNG : 700, 0, 7); ctx.stroke();
  } else {
    ctx.strokeStyle = rgba(col, .6); ctx.lineDashOffset = -time * 20;
    ctx.beginPath(); ctx.arc(m.x, m.y, 110, 0, 7); ctx.stroke(); ctx.lineDashOffset = 0;
    ctx.strokeStyle = rgba(col, .2); ctx.beginPath(); ctx.arc(m.x, m.y, 160, 0, 7); ctx.stroke();
  }
  ctx.setLineDash([]);
  return true;
}
