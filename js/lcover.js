'use strict';
// 登陆火力掩护（攻方，战役与沙盒通用）：武器按真实参数以后，抢滩最怕纵深阵地上的坦克、步战车、装甲警戒车用热像远远盯着海滩——
//   车辆约 3.5–6 公里、站着的步兵 1.5–2.5 公里就能发现（spot.js），主炮 2.5–3 公里、并列机枪 1–1.5 公里就能打，部队还挤在沙滩上就被一个个点名。
//   不改武器参数，按两栖作战条令补上：
//   1）登陆烟幕：登陆舰艇抵近、卸载、部队还在滩头时，舰炮在登陆正面向陆约 110 米处打一道烟幕墙（多光谱烟幕挡热像，spotLos 遇烟幕格挡住视线），
//      快散了就补；抢滩的艇放下跳板时点燃艇载发烟罐，把下船的人车罩住；
//   2）压制直瞄火力：刚对我开过火、位置已经暴露的敌坦克、步战车、装甲警戒车（炮口焰，spot.js spotFlash），舰炮优先打它；
//   3）其余照旧：自动掩护打工事、步兵（support.js updateDD、sandbox.js 护航舰），指挥官的火力任务（commander.js）。
//   火力分配：每 0.5 秒看一次要补的烟幕点、要压制的敌车，派空闲的舰（旗舰驱逐舰、沙盒护航舰），装填时间照常算；烟幕弹每舰 40 发
// 状态：S.lcv = { t 下次检查, sites: [{ x, y, nx, ny 向陆方向, w 半宽, t0, tAp 最近一次有艇抵近 / 卸载, said }], mag: { 舰号: 剩余烟幕弹 } }
const LCV = { D: 110, gap: 90, ext: 120, near: 900, hold: 240, lead: 6, cover: 45, mag: 40, pot: 60, potGap: 30, pots: 3, armorT: 10, armorR: 3500, merge: 300 };

// 目的地在不在岸上（登陆艇的目的地在水线附近：本身是陆地或 50 米内有陆地）
function lcvLandish(x, y) {
  if (isLand(x, y)) return true;
  for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; if (isLand(x + Math.cos(a) * 50, y + Math.sin(a) * 50)) return true; }
  return false;
}
// 向陆方向：在半径 160 的一圈上取 24 个点，陆地点的方向加起来
function lcvInland(x, y) {
  let sx = 0, sy = 0;
  for (let k = 0; k < 24; k++) { const a = k * Math.PI / 12, c = Math.cos(a), s = Math.sin(a); if (isLand(x + c * 160, y + s * 160)) { sx += c; sy += s; } }
  const l = Math.hypot(sx, sy);
  return l > .5 ? [sx / l, sy / l] : null;
}
// 登陆点：正在抵近（离目的地 900 以内、目的地在岸边）或已抢滩、卸载的登陆舰艇（护航舰、扫雷艇、火力艇不算）
function lcvCraft() {
  const out = [];
  for (const s of S.ships) {
    if (!alive(s) || s.kind === 'dd' || s.sbxRole) continue;
    const ap = s.state === 'move' && isFinite(s.tx) && dist(s.x, s.y, s.tx, s.ty) < LCV.near && lcvLandish(s.tx, s.ty);
    const un = s.state === 'unloading' || s.state === 'beached';
    if (ap || un) out.push({ x: ap ? s.tx : s.x, y: ap ? s.ty : s.y, ap, un, s });
  }
  return out;
}
// 更新登陆点（按 300 米并成一处），返回要维持烟幕的点
function lcvSites() {
  const L = S.lcv, C = lcvCraft();
  for (const c of C) {
    let st = L.sites.find(o => dist(o.x, o.y, c.x, c.y) < LCV.merge);
    if (!st) { const n = lcvInland(c.x, c.y); if (!n) continue; L.sites.push(st = { x: c.x, y: c.y, nx: n[0], ny: n[1], w: 0, t0: S.t, tAp: S.t, said: 0, k: 1 }); }
    else { st.x += (c.x - st.x) / (++st.k); st.y += (c.y - st.y) / st.k; }   // 中心按登陆点平均
    st.tAp = S.t;
    st.w = Math.max(st.w, Math.abs((c.x - st.x) * -st.ny + (c.y - st.y) * st.nx));
  }
  // 滩头还有没有自己人（200 以内 6 人以上）：有就在最后一艘艇靠岸后 4 分钟内接着遮
  L.sites = L.sites.filter(st => {
    if (S.t - st.tAp < 2) return true;
    let men = 0;
    for (const q of S.teams) if (q.side === 'p' && q.men.length && !q.ride && dist(q.x, q.y, st.x, st.y) < 200) men += q.men.length;
    return men >= 6 && S.t - st.tAp < LCV.hold;
  });
  const pts = [];
  for (const st of L.sites) {
    const tx = -st.ny, ty = st.nx, w = st.w + LCV.ext, n = Math.max(3, Math.round(2 * w / LCV.gap) + 1);
    for (let i = 0; i < n; i++) {
      const u = -w + 2 * w * i / (n - 1);
      let x = st.x + st.nx * LCV.D + tx * u, y = st.y + st.ny * LCV.D + ty * u;
      for (let k = 0; k < 5 && !isLand(x, y); k++) { x += st.nx * 40; y += st.ny * 40; }   // 曲折的岸线：落在水里的往陆上挪
      pts.push({ x, y, st });
    }
  }
  return pts;
}
// 这一点有没有烟幕罩着（还有 6 秒以上才散的，或者正飞过去的烟幕弹）
const lcvCovered = (x, y) => S.smoke.some(o => o.until > S.t + LCV.lead && dist(o.x, o.y, x, y) < LCV.cover) || S.shells.some(s => !s.done && s.kind === 'smoke' && dist(s.x1, s.y1, x, y) < LCV.cover);
// 暴露了的敌装甲：看得见、10 秒内开过火、离我登陆点或部队 3.5 公里以内；坦克优先，越近越先
function lcvArmor() {
  const out = [], near = (x, y) => S.lcv.sites.some(st => dist(st.x, st.y, x, y) < LCV.armorR) || S.teams.some(q => q.side === 'p' && q.men.length && dist(q.x, q.y, x, y) < LCV.armorR);
  for (const v of S.veh || []) if (v.side === 'e' && !v.dead && !v.lst && S.t - (v.fireT ?? -99) < LCV.armorT && inVision(v.x, v.y) && near(v.x, v.y)) out.push({ o: v, x: v.x, y: v.y, w: v.type === 'tank' ? 2 : 1 });
  for (const a of S.armor || []) if (!a.dead && S.t - (a.fireT ?? -99) < LCV.armorT && inVision(a.x, a.y) && near(a.x, a.y)) out.push({ o: a, x: a.x, y: a.y, w: 1 });
  return out.sort((a, b) => b.w - a.w || (b.o.fireT ?? 0) - (a.o.fireT ?? 0));
}
// 一艘舰打一发 / 一轮：kind 'smoke' 烟幕弹、'he' 榴弹（避开自己人）；装填时间照常算
function lcvShoot(o, x, y, kind) {
  const d = dist(o.x, o.y, x, y), id = o === S.dd ? 'DD' : o.id, L = S.lcv;
  if (d > DD_R || !isFinite(o.x)) return false;
  if (kind === 'smoke' && (L.mag[id] ?? LCV.mag) <= 0) return false;
  if (o === S.dd) {
    if (o.state !== 'ready' || o.cool > 0 || !o.auto || (typeof fpDriving === 'function' && fpDriving(o))) return false;
    if (kind === 'he') { if (!ddFire(x, y, false, true)) return false; navMark(o, x, y); return true; }   // 榴弹走原来的（散布、避开自己人、暴露与反炮兵）
    const sc = ddSc(d);
    fireShell(o.x, o.y, x + gauss() * sc, y + gauss() * sc, 'p', 'smoke', ddDur(d), false);
    o.cool = 5;
  } else {
    const st = o.sbxS || (o.sbxS = { n: 0, cd: 0, go: 0, sw: 0 });
    if (st.cd > 0 || (typeof fpDriving === 'function' && fpDriving(o))) return false;
    const sc = ddSc(d), salvo = kind === 'smoke' ? 1 : (o.sbxCls && o.sbxCls.salvo) || 1;
    for (let k = 0; k < salvo; k++) {
      if (kind === 'smoke') fireShell(o.x, o.y, x + gauss() * sc, y + gauss() * sc, 'p', 'smoke', ddDur(d), false, { t: -k * .2 });
      else { const pt = safeAim('p', x, y, sc, POWER.naval.R, 55); if (pt) fireShell(o.x, o.y, pt[0], pt[1], 'p', 'naval', ddDur(d), false, { t: -k * .2 }); }
    }
    st.cd = 5 / ((o.sbxCls && o.sbxCls.rof) || 1);
    Object.assign(o, { aimX: x, aimY: y, fireT: S.t });
    if (kind === 'he') navMark(o, x, y);
  }
  if (kind === 'smoke') L.mag[id] = (L.mag[id] ?? LCV.mag) - 1;
  S.fx.push({ kind: 'flash', x: o.x, y: o.y, r: 14, life: 0, max: .5, side: 'p' });
  S.stats.shots++;
  return true;
}
function lcvStep() {
  const L = S.lcv || (S.lcv = { t: 0, sites: [], mag: {} });
  if (S.t < L.t) return;
  L.t = S.t + .5;
  const pts = lcvSites();
  // 艇载发烟罐：抢滩卸载的艇在艇首向陆 60 米处点一个（每艇最多 3 个，隔 30 秒）
  for (const c of lcvCraft()) {
    if (!c.un || (c.s.lcvPots || 0) >= LCV.pots || S.t - (c.s.lcvPotT ?? -99) < LCV.potGap) continue;
    const st = L.sites.find(o => dist(o.x, o.y, c.x, c.y) < LCV.merge);
    if (!st) continue;
    c.s.lcvPots = (c.s.lcvPots || 0) + 1; c.s.lcvPotT = S.t;
    S.smoke.push({ x: c.x + st.nx * LCV.pot, y: c.y + st.ny * LCV.pot, r: 65, until: S.t + 35 });
    S.visT = 0;
  }
  // 要补的烟幕点、要压制的敌车（每 0.5 秒更新一次，舰炮装填好时来领任务：lcvTask）
  L.need = pts.filter(p => !lcvCovered(p.x, p.y)).map(p => ({ x: p.x, y: p.y, sx: p.st.x, sy: p.st.y }));
  L.armor = lcvArmor().map(a => ({ x: a.x, y: a.y, id: a.o.id }));
  L.ap = L.sites.some(st => S.t - st.tAp < 2 && S.ships.some(s => alive(s) && s.state === 'move' && !s.sbxRole && s.kind !== 'dd' && dist(s.tx, s.ty, st.x, st.y) < LCV.merge));
}
// 舰炮装填好、自己挑目标之前先来这里领任务（support.js updateDD、sandbox.js 护航舰）：打了返回 true。
//   艇还在抵近：烟幕优先（先把滩头遮起来）；艇都靠岸了：先压制开火的敌车、再补烟幕
function lcvTask(o) {
  const L = S.lcv;
  if (!L || (!(L.need && L.need.length) && !(L.armor && L.armor.length))) return false;
  for (const k of L.ap || !(L.armor && L.armor.length) ? ['smoke', 'he'] : ['he', 'smoke']) {
    if (k === 'smoke' && L.need.length) {
      L.need.sort((a, b) => dist(a.x, a.y, o.x, o.y) - dist(b.x, b.y, o.x, o.y));
      const p = L.need[0];
      if (lcvShoot(o, p.x, p.y, 'smoke')) {
        L.need.shift();
        log('舰炮向登陆正面后方施放烟幕，遮断守军纵深阵地对滩头的观察', 'info', 'lcv' + Math.round(p.sx / 300), 60, { x: p.sx, y: p.sy });
        return true;
      }
    } else if (k === 'he' && L.armor.length) {
      const t = L.armor[(L.ai = ((L.ai || 0) + 1) % L.armor.length)];
      if (lcvShoot(o, t.x, t.y, 'he')) return true;
    }
  }
  return false;
}
HOOK.step.push(() => { if (S && S.phase === 'battle') lcvStep(); });
HOOK.newGame.push(() => { if (S) S.lcv = null; });
