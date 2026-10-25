'use strict';
// 空降（v8）：战区运输机从南面海上飞来，向指定地点空投伞兵或补给（Shift+P 空降伞兵，Shift+O 空投补给；字母键都已有用途）。
// 运输机走 S.planes（kind 'transport'，carrier.js updatePlanes 交给 paFly）：敌高炮、单兵防空导弹、弹炮防空车与歼击机都会打它。
// 伞兵（v13 起为海军陆战队「蛟龙突击队」）：两架运-20 各载 3 个三人组共 18 人——突击组 ×2、红箭-12 反坦克组、双机枪火力组、
//   QBU-202 狙击组、前卫-2 防空组；高跳低开，散布小（σ 16）、下降快（4 秒），空中挨打的概率减半。
//   特种部队加成（JL_MOD）：射击精度 1.6 倍、射速 1.3 倍、射程 1.2 倍、压制力 1.4 倍；防弹插板与战斗素养——致命一击有 45% 只是负伤（combat.js killMan mod.hard）；
//   被压制程度减半（mod.calm）；连队士气 100、伤亡和压制对士气的打击减半（u.elite）。
//   落进水里的组全部损失；运输机在跳伞前被击落，机上的组一并损失。落地后编成「蛟龙突击队」，交自动指挥就近夺取据点
// 补给：一架运输机投下 3 个弹药箱，落地后成为空投补给点（每箱 120 份弹药、4 分钟内有效）：120 以内的我方步兵每秒补 6 份弹药、恢复士气，
//   90 以内停着的车辆补炮弹；也算补给点（supplynet.js supplyPoints：自动指挥的连队弹药不足会来这里补）；敌人先到（30 以内无我方）就被缴获
// AI（观战，或航母开了自动派机）：攻势展开后向正在攻击的目标后方空降一次，与正面夹击；有连队弹药告急、又离接通的补给点很远时空投补给
// 状态：S.para = { tr: 在途运输机, ch: 下降中的伞兵组 / 弹药箱, ca: 空投补给点, n: 架次编号, aiT, dropT }；S.assets.para / S.assets.drop 剩余次数
const PA = { spd: 140, alt: .55, jump: 5, sig: 28, crate: 120, life: 240, feed: 6, r: 120, rv: 90, jlJump: 4, jlSig: 16 };
// 蛟龙突击队：每架运-20 的三个组 {men, role}
const PA_STICKS = [
  [{ men: ['radio', 'rifle', 'mg'], role: 'assault' }, { men: ['rifle', 'rifle', 'mg'], role: 'assault' }, { men: ['rifle', 'rifle', 'rifle'], role: 'at' }],
  [{ men: ['rifle', 'mg', 'mg'], role: 'mg' }, { men: ['rifle', 'rifle', 'rifle'], role: 'sniper' }, { men: ['rifle', 'aa', 'rifle'], role: 'aa' }]
];
const JL_MOD = { pow: 1.6, rof: 1.3, rng: 1.2, sup: 1.4, hard: .45, calm: .5 };
const JL_ROLE = { assault: {}, mg: { sup: 1.9 }, at: { at: 1.8, atPen: 3.4, rng: 1.5 }, sniper: { rng: 1.9, pow: 2.3, rof: .8 }, aa: {} };
const JL_NM = { assault: '突击组', mg: '火力组', at: '红箭-12 反坦克组', sniper: 'QBU-202 狙击组', aa: '前卫-2 防空组' };
const PA_ICONS = {
  para: '<path d="M4 11a8 6.5 0 0 1 16 0z"/><path d="M4 11l8 7 8-7M9 11l3 7 3-7"/><circle class="f" cx="12" cy="19.6" r="1.7"/>',
  drop: '<path d="M4 9a8 6 0 0 1 16 0z"/><path d="M4 9l5 6.5M20 9l-5 6.5"/><rect x="8.5" y="15" width="7" height="6" rx=".6"/><path d="M8.5 18h7M12 15v6"/>'
};
if (typeof AIR_SPEC === 'object' && !AIR_SPEC.transport) AIR_SPEC.transport = { name: '运-20 运输机', n: 0, aa: .07, spd: PA.spd, size: 26 };
const paMen = i => PA_STICKS[i].reduce((a, o) => a + o.men.length, 0);
if (typeof AIR_SIL === 'object' && !AIR_SIL.transport) AIR_SIL.transport = [[11, 0], [10, 1.6], [5, 2.1], [3.2, 11.8], [.2, 11.8], [-.6, 2.1], [-7.5, 1.6], [-8.6, 5.4], [-10.6, 5.4], [-10.2, 1], [-11, 0]];

function paEnsure() {
  if (!S) return null;
  if (!S.para || !Array.isArray(S.para.tr)) S.para = { tr: [], ch: [], ca: [], n: 0, aiT: 30 };
  if (!S.assets) S.assets = {};
  if (S.assets.para == null) S.assets.para = 0;
  if (S.assets.drop == null) S.assets.drop = 0;
  return S.para;
}
HOOK.newGame.push(function paNewGame(opts) {
  if (!S) return;
  S.para = null;
  paEnsure();
  if (!(opts && opts.sandbox)) { S.assets.para = 1; S.assets.drop = 2; }   // 战役：空降伞兵一次、空投补给两次（沙盒从目录购买）
});

// 起飞：kind 'para'（两架运输机）/ 'drop'（一架）；空降场须是可通行的陆地
function paLaunch(kind, x, y, ai) {
  const P = paEnsure();
  if (!P || S.phase !== 'battle') { if (!ai) log('空降与空投在 H 时之后才能使用', 'warn', 'pa0', 2); return false; }
  if (!(S.assets[kind] > 0)) { if (!ai) log(kind === 'para' ? '空降伞兵已用完' : '空投补给已用完', 'warn', 'pa1', 2); return false; }
  if (!isLand(x, y) || !passInf(x, y)) { if (!ai) log('空降场必须选在可通行的陆地上', 'warn', 'pa2', 2); return false; }
  S.assets[kind]--;
  v8Stat(kind === 'para' ? 'paGo' : 'dropGo');
  const n = kind === 'para' ? 2 : 1, ev = ++P.n;
  for (let i = 0; i < n; i++) {
    const sx = clamp(x + (i - (n - 1) / 2) * 50 + gauss() * 20, 40, W - 40), sy = H + 60 + i * 30;
    const p = { id: S.nid++, kind: 'transport', x: sx, y: sy, heading: -Math.PI / 2, spd: PA.spd, alt: PA.alt, bank: 0, phase: 'in', tx: x, ty: y, cx: x, cy: y, ox: 1, dropped: false, halo: kind === 'para' };   // 高跳低开：运输机在近程防空射高以上（eair.js eaHigh）
    S.planes.push(p);
    P.tr.push({ id: p.id, k: kind, ev, i, dz: { x: Math.round(x), y: Math.round(y) }, dropped: false, men: kind === 'para' ? paMen(i) : 0 });
  }
  const sec = Math.max(5, Math.round((H + 60 - y) / PA.spd));
  log(kind === 'para' ? `空降：两架运-20 载蛟龙突击队 ${paMen(0) + paMen(1)} 人从海上飞来，约 ${sec} 秒后在 ${gridRef(x, y)} 高跳低开` : `空投：运输机载弹药 3 箱，约 ${sec} 秒后在 ${gridRef(x, y)} 投下`, 'info', null, 0, { x, y });
  return true;
}

// carrier.js updatePlanes 对运输机调用：飞向空降场 → 跳伞 / 投箱 → 掉头飞回海上（飞出图外即返航，不算损失）
function paFly(p, dt) {
  if (p.ab && typeof abFly === 'function') { abFly(p, dt); return; }   // 空降兵营伞降 / 机降（abn.js）
  if (p.phase === 'in') {
    airSteer(p, p.tx, p.ty, dt);
    if (dist(p.x, p.y, p.tx, p.ty) < 40 || (p.y < p.ty - 10 && Math.abs(p.x - p.tx) < 80)) { p.dropped = true; p.phase = 'out'; p.ox = p.x < W / 2 ? 1 : -1; paRelease(p); }
    return;
  }
  airSteer(p, clamp(p.x + p.ox * 220, 0, W), H + 220, dt);
  if (p.y > H + 50) p.dead = true;
}
function paRelease(p) {
  const P = paEnsure(), r = P.tr.find(o => o.id === p.id);
  if (!r) return;
  r.dropped = true;
  if (r.k === 'para') PA_STICKS[r.i].forEach((o, j) => P.ch.push({ k: 'team', ev: r.ev, men: o.men.slice(), role: o.role, x: p.x + gauss() * PA.jlSig, y: p.y + gauss() * PA.jlSig, t: -j * .5, hT: 0 }));
  else for (let j = 0; j < 3; j++) P.ch.push({ k: 'crate', ev: r.ev, x: p.x + gauss() * PA.sig * .7, y: p.y + gauss() * PA.sig * .7, t: -j * .5 });
  log(r.k === 'para' ? '蛟龙突击队开始跳伞' : '弹药箱已投下', 'info', 'padrop' + r.ev, 5, p);
}

// 着陆：落水全组损失；落在悬崖、山地等不可通行处就近找 30 以内可走的格，找不到同样损失
function paLand(c) {
  const P = S.para;
  let x = clamp(c.x, 10, W - 10), y = clamp(c.y, 10, H - 10);
  const lost = why => { if (c.k === 'team' && c.men.length) { S.stats.lost += c.men.length; log(`蛟龙突击队一个组${why}，${c.men.length} 人损失`, 'bad', 'palost', 5, { x, y }); } };
  if (isWater(typeAt(x, y))) { lost('落入水中'); return; }
  if (!passInf(x, y)) {
    const j = nearestPassable(ci(x, y), 'p');
    if (j < 0 || dist(cellCX(j), cellCY(j), x, y) > 30) { lost('落在无法通行的山崖上'); return; }
    x = cellCX(j); y = cellCY(j);
  }
  if (c.k === 'crate') {
    const k = P.ca.find(o => o.ev === c.ev && dist(o.x, o.y, x, y) < 70);
    if (k) k.amt += PA.crate; else P.ca.push({ id: S.nid++, ev: c.ev, x: Math.round(x), y: Math.round(y), amt: PA.crate, t: S.t });
    return;
  }
  if (!c.men.length) return;
  let u = S.units.find(o => o.side === 'p' && o.paEv === c.ev);
  if (!u) {
    const n = S.units.filter(o => o.side === 'p' && o.emblem === 'para').length + 1;
    u = addUnit('p', 'inf', { ship: n > 1 ? `蛟龙突击队${n}` : '蛟龙突击队', emblem: 'para', form: 'wedge', face: NORTH, auto: true, paEv: c.ev, morale: 100, elite: true });
    log(`${unitName(u)}着陆，正在集结`, 'good', null, 0, { x, y });
  }
  addTeam('p', x, y, c.men, { unit: u.ship, u: u.id, ammo: 60, sup: 10, jl: c.role || 'assault', mod: { ...JL_MOD, ...(JL_ROLE[c.role] || {}) } });
  v8Stat('paMen', c.men.length);
}

function paStep(dt) {
  const P = paEnsure();
  if (!P || S.phase !== 'battle') return;
  // 在途运输机：跳伞 / 投箱前被击落，机上人员与物资损失
  for (const r of P.tr) {
    const p = S.planes.find(o => o.id === r.id);
    if (p && !p.dead) continue;
    r.gone = true;
    if (!r.dropped) {
      if (r.men) S.stats.lost += r.men;
      log(r.k === 'para' ? `运输机在空降场前被击落，机上伞兵 ${r.men} 人损失` : '空投运输机被击落，弹药未能投下', 'bad', null, 0, r.dz);
    }
  }
  if (P.tr.some(r => r.gone)) P.tr = P.tr.filter(r => !r.gone);
  // 下降：东北风飘移；伞兵组每 0.5 秒挨一次地面火力（150 内没被压住的敌步兵、190 内的高炮）
  for (const c of P.ch) {
    if ((c.t += dt) < 0) continue;
    c.x += 3 * dt; c.y -= 2 * dt;
    if (c.k === 'team' && c.men.length && (c.hT -= dt) <= 0) {
      c.hT = .5;
      let pk = 0, src = null;
      for (const q of S.teams) if (q.side === 'e' && q.men.length && q.sup < 70 && dist(q.x, q.y, c.x, c.y) < 150) { pk += .04 * q.men.length / 3; src = src || q; }
      for (const e of S.enemies) if (!e.dead && e.kind === 'aa' && (e.sup || 0) < 60 && dist(e.x, e.y, c.x, c.y) < 190) { pk += .08; src = e; }
      if (src) tracer(src.x, src.y, c.x + gauss() * 4, c.y - (1 - c.t / (c.role ? PA.jlJump : PA.jump)) * 34, 'e', inVision(src.x, src.y));
      if (c.role) pk *= .5;   // 蛟龙突击队：高跳低开，空中暴露时间短
      if (pk && Math.random() < pk) { c.men.splice(Math.floor(Math.random() * c.men.length), 1); S.stats.lost++; if (!c.men.length) log('一个伞兵组在空中被敌火力全部击中', 'bad', 'pakill', 6, c); }
    }
    if (c.t < (c.role ? PA.jlJump : PA.jump)) continue;
    c.done = true;
    paLand(c);
  }
  if (P.ch.some(c => c.done)) P.ch = P.ch.filter(c => !c.done);
  // 空投补给点
  for (const k of P.ca) {
    if (k.amt <= 0 || S.t - k.t > PA.life) { k.done = true; continue; }
    if (!S.teams.some(q => q.side === 'p' && q.men.length && dist(q.x, q.y, k.x, k.y) < 60) && S.teams.some(q => q.side === 'e' && q.men.length && dist(q.x, q.y, k.x, k.y) < 30)) {
      k.done = true; log('空投补给点被敌缴获', 'bad', null, 0, k); continue;
    }
    for (const q of S.teams) {
      if (k.amt <= 0) break;
      if (q.side !== 'p' || !q.men.length || q.ammo >= 60 || dist(q.x, q.y, k.x, k.y) > PA.r) continue;
      const a = Math.min(PA.feed * dt, 60 - q.ammo, k.amt);
      q.ammo += a; k.amt -= a;
      const u = unitOf(q);
      if (u) u.morale = Math.min(100, u.morale + 1.5 * dt);
    }
    for (const v of S.veh || []) {
      if (k.amt <= 0) break;
      if (v.dead || v.side !== 'p' || v.moving || v.lst || dist(v.x, v.y, k.x, k.y) > PA.rv) continue;
      const sp = vehSp(v);
      if (!(v.ammo < sp.ammo)) continue;
      const a = Math.min(2 * dt, sp.ammo - v.ammo, k.amt / 3);
      v.ammo += a; k.amt -= a * 3;   // 一发炮弹折 3 份
    }
  }
  if (P.ca.some(k => k.done)) P.ca = P.ca.filter(k => !k.done);
  paAI(dt);
}
HOOK.step.push(paStep);

// —— AI 运用（每 3 秒）：观战，或航母开了自动派机（航空兵归 AI 指挥）——
function paAI(dt) {
  const P = S.para;
  if ((P.aiT = (P.aiT ?? 30) - dt) > 0) return;
  P.aiT = 3;
  if (!(S.role === 'spectate' || (S.cv && S.cv.auto === true))) return;
  const say = (t, at) => { if (typeof chatSay === 'function') chatSay('p', t, { kind: 'order', at, lv: 1 }); };
  // 空降：正在攻击（联合火力已展开）、攻击群已进到 400 以内的目标，空降场选在其后方 120–220（背离攻击群）、
  //   220 内无已知高炮、80 内看不见守敌的陆地
  if (S.assets.para > 0 && S.t > 120 && !P.tr.some(r => r.k === 'para')) {
    const pts = typeof cmdJointPts === 'function' ? cmdJointPts() : [];
    outer: for (const p of pts) {
      const ts = S.teams.filter(q => q.side === 'p' && q.kind === 'inf' && q.men.length && !q.ride && dist(q.x, q.y, p.x, p.y) < 400);
      if (ts.length < 3) continue;
      const cx = ts.reduce((a, q) => a + q.x, 0) / ts.length, cy = ts.reduce((a, q) => a + q.y, 0) / ts.length, l = Math.max(1, dist(cx, cy, p.x, p.y)), ux = (p.x - cx) / l, uy = (p.y - cy) / l;
      for (const r of [180, 150, 220, 120]) for (const a of [0, .45, -.45]) {
        const dx = ux * Math.cos(a) - uy * Math.sin(a), dy = ux * Math.sin(a) + uy * Math.cos(a), x = p.x + dx * r, y = p.y + dy * r;
        if (x < 40 || x > W - 40 || y < 40 || !isLand(x, y) || !passInf(x, y)) continue;
        if (S.enemies.some(e => !e.dead && e.kind === 'aa' && e.kx != null && dist(e.kx, e.ky, x, y) < 220)) continue;
        if (S.teams.some(q => q.side === 'e' && q.men.length && inVision(q.x, q.y) && dist(q.x, q.y, x, y) < 80)) continue;
        if (paLaunch('para', x, y, true)) say(`命令：蛟龙突击队在${p.name}后方 ${gridRef(x, y)} 高跳低开，与正面进攻部队前后夹击${p.name}。`, { x, y });
        break outer;
      }
    }
  }
  // 空投补给：弹药告急（小组平均不足 22 份）、离接通的补给点 350 以外的连队，人数最多的优先；投在连队位置稍后方
  if (S.assets.drop > 0 && S.t - (P.dropT ?? -99) > 60 && !P.tr.some(r => r.k === 'drop')) {
    let best = null, bs = 0;
    for (const u of S.units) {
      if (u.side !== 'p' || u.kind !== 'inf' || u.state === 'rout' || u.x == null || !isFinite(u.x)) continue;
      const ts = teamsOf(u).filter(q => q.men.length && !q.ride);
      if (!ts.length || ts.reduce((a, q) => a + q.ammo, 0) / ts.length > 22) continue;
      const sp = typeof nearestSupply === 'function' ? nearestSupply(u.x, u.y, true) : null;
      if (sp && dist(sp.x, sp.y, u.x, u.y) < 350) continue;
      const men = ts.reduce((a, q) => a + q.men.length, 0);
      if (men > bs) { bs = men; best = u; }
    }
    if (best) {
      const x = clamp(best.x, 40, W - 40), y = clamp(best.y + 30, 40, H - 40);
      if (isLand(x, y) && passInf(x, y) && paLaunch('drop', x, y, true)) { P.dropT = S.t; say(`命令：${unitName(best)}弹药告急、远离补给点，运输机向 ${gridRef(x, y)} 空投弹药 3 箱。`, { x, y }); }
    }
  }
}

// 自动指挥判断补给点仍有效（autopilot.js apSpValid 对 kind 'cache' 调用）
const paCacheOk = id => !!(S && S.para && S.para.ca.some(k => k.id === id && k.amt > 0));

// —— HUD：Shift+P 空降伞兵、Shift+O 空投补给（hud.js 支援栏按钮 para / drop，ui.js applyTool 点地面发起）——
HOOK.key.push(function paKey(e) {
  const k = e.key.toUpperCase();
  if (!S || !e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || (k !== 'P' && k !== 'O') || S.phase === 'sandbox') return false;
  if (typeof setTool === 'function') setTool(k === 'P' ? 'para' : 'drop');
  return true;
});

// —— 绘制：空降场标记、下降中的伞衣与弹药箱、空投补给点 ——
function paDraw(time) {
  const P = S && S.para;
  if (!P || typeof R !== 'object' || !R.ctx) return;
  const ctx = R.ctx, r = Math.max(4, px(5));
  for (const t of P.tr) if (!t.dropped && inView(t.dz.x, t.dz.y, 80)) {   // 运输机在途：空降场虚线圈与落点十字
    ctx.strokeStyle = rgba(COL.g, .45 + .25 * Math.sin(time * 4)); ctx.lineWidth = px(1.3); ctx.setLineDash([px(4), px(4)]);
    ctx.beginPath(); ctx.arc(t.dz.x, t.dz.y, PA.sig * 1.6, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(t.dz.x - px(6), t.dz.y); ctx.lineTo(t.dz.x + px(6), t.dz.y); ctx.moveTo(t.dz.x, t.dz.y - px(6)); ctx.lineTo(t.dz.x, t.dz.y + px(6)); ctx.stroke();
  }
  for (const c of P.ch) {
    if (c.t < 0 || !inView(c.x, c.y, 60)) continue;
    const u = clamp(c.t / (c.role ? PA.jlJump : PA.jump), 0, 1), h = (1 - u) * 34, x = c.x, y = c.y - h;
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(c.x, c.y, r * .9, r * .45, 0, 0, 7); ctx.fill();   // 地面投影
    if (realLook()) { ctx.fillStyle = c.k === 'crate' || c.k === 'veh' ? '#d9d6c8' : '#6d7650'; ctx.strokeStyle = 'rgba(30,32,26,.75)'; ctx.lineWidth = px(.9); }   // 写实：橄榄绿人员伞、白色货运伞
    else { ctx.fillStyle = 'rgba(2,10,6,.85)'; ctx.strokeStyle = rgba(COL.g, .95); ctx.lineWidth = px(1.2); }
    ctx.beginPath(); ctx.arc(x, y - r * 1.6, r, Math.PI, 0); ctx.closePath(); ctx.fill(); ctx.stroke();   // 伞衣
    ctx.beginPath(); ctx.moveTo(x - r, y - r * 1.6); ctx.lineTo(x, y); ctx.lineTo(x + r, y - r * 1.6); ctx.stroke();   // 吊索
    if (c.k === 'crate') { ctx.fillStyle = rgba(COL.amber, .95); ctx.fillRect(x - r * .4, y - r * .2, r * .8, r * .6); }
    else { ctx.fillStyle = rgba(COL.g, .95); ctx.beginPath(); ctx.arc(x, y, Math.max(1.5, px(2)), 0, 7); ctx.fill(); }
  }
  for (const k of P.ca) {   // 空投补给点：弹药箱、补给范围、余量条
    if (!inView(k.x, k.y, PA.r + 20)) continue;
    ctx.strokeStyle = rgba(COL.g, .22); ctx.lineWidth = px(1); ctx.setLineDash([px(2), px(5)]);
    ctx.beginPath(); ctx.arc(k.x, k.y, PA.r, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(2,10,6,.9)'; ctx.strokeStyle = rgba(COL.amber, .95); ctx.lineWidth = px(1.3);
    ctx.fillRect(k.x - r, k.y - r * .7, r * 2, r * 1.4); ctx.strokeRect(k.x - r, k.y - r * .7, r * 2, r * 1.4);
    ctx.beginPath(); ctx.moveTo(k.x - r, k.y); ctx.lineTo(k.x + r, k.y); ctx.moveTo(k.x, k.y - r * .7); ctx.lineTo(k.x, k.y + r * .7); ctx.stroke();
    const f = clamp(k.amt / (PA.crate * 3), 0, 1), w = r * 3;
    ctx.fillStyle = rgba(COL.amber, .25); ctx.fillRect(k.x - w / 2, k.y + r * 1.2, w, Math.max(1.5, px(2)));
    ctx.fillStyle = rgba(COL.amber, .9); ctx.fillRect(k.x - w / 2, k.y + r * 1.2, w * f, Math.max(1.5, px(2)));
  }
}
HOOK.drawOver.push(paDraw);
// 选空降场时的瞄准圈：落点散布范围，海面 / 不可通行处显示红色
HOOK.drawTop.push(function paDrawTop() {
  if (typeof U !== 'object' || (U.tool !== 'para' && U.tool !== 'drop') || !U.mouse || typeof R !== 'object' || !R.ctx) return;
  const ctx = R.ctx, m = U.mouse, ok = S.assets[U.tool] > 0 && isLand(m.x, m.y) && passInf(m.x, m.y), col = ok ? COL.g : COL.enemy;
  ctx.strokeStyle = rgba(col, .9); ctx.lineWidth = px(1.5); ctx.setLineDash([px(4), px(4)]);
  ctx.beginPath(); ctx.arc(m.x, m.y, PA.sig * 1.6, 0, 7); ctx.stroke(); ctx.setLineDash([]);
  ctx.beginPath(); ctx.moveTo(m.x - px(7), m.y); ctx.lineTo(m.x + px(7), m.y); ctx.moveTo(m.x, m.y - px(7)); ctx.lineTo(m.x, m.y + px(7)); ctx.stroke();
});
