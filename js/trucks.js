'use strict';
// 补给卡车（陕汽 SX2190 6×6 军用越野卡车，载重 5 吨）：从滩头补给站沿运输线把弹药、油料运到前沿补给点——有了卡车，补给线就能拉得更长。
//   前沿补给点有存量（stock 0..1，一车 0.7）：步兵补弹药、车辆补炮弹和加油都要消耗存量，见底的点不再补给，等卡车送到；
//   卡车还给规划中的前沿补给点运预制器材（没有工兵也能在 10 秒内卸成一个补给点），给油尽趴窝的车辆送油（加到五成）。
//   卡车没有装甲：90 以内看得见它的敌步兵、170 以内的碉堡、220 以内的敌战车、炮弹 / 炸弹落点 14 以内都可能把它打掉；
//   每条接通的滩头补给线最多 2 + 前沿点数 / 3 辆（不超过 6），打掉一辆 25 秒后补一辆。
// 状态：S.trk = { v: 1, list: [{id, root, x, y, h, ph: idle|load|out|drop|back, t, job: {k: feed|build|fuel, id}, pts, i, dead, deadT}], spT: {线 id: 可补车时刻}, thT }
const TRK = { spd: 30, load: 5, drop: 4, build: 10, give: .7, fuel: .5, gap: 25, cap: 6, near: 90, rng: 260, model: '陕汽 SX2190 越野卡车' };
const trkOn = () => !!S && S.phase === 'battle' && !S.over;
function trkEnsure() { if (!S.trk || S.trk.v !== 1) S.trk = { v: 1, list: [], spT: {}, thT: 0 }; return S.trk; }
const trkAny = () => !!(S && S.trk && S.trk.list.some(t => !t.dead));
const trkStock = n => n.stock ?? 1;
// 前沿点的用户：220 以内的我方步兵组与车辆（越多越该先送）
const trkUsers = n => S.teams.filter(q => q.side === 'p' && q.men.length && dist(q.x, q.y, n.x, n.y) < 220).length + (S.veh || []).filter(v => v.side === 'p' && !v.dead && dist(v.x, v.y, n.x, n.y) < 220).length;

// 从滩头补给站到节点 n 的行车路线（沿各级运输线的路径点）；链上有节点被删返回 null
function trkRoute(L, n) {
  const chain = [];
  for (let o = n, k = 0; o && k < 40; o = o.parent != null ? snById(o.parent) : null, k++) chain.push(o);
  if (!chain.length || chain[chain.length - 1].parent != null) return null;
  const pts = [[L.x, L.y]];
  for (let k = chain.length - 1; k >= 0; k--) {
    const c = chain[k], P = c.path && c.path.length > 1 ? c.path.slice(1) : [[c.x, c.y]];
    for (const p of P) pts.push([p[0], p[1]]);
  }
  return pts;
}
// 上级（节点 id，null = 滩头补给站）已接通，卡车能开到
const trkReach = id => id == null || (() => { const p = snById(id); return !!p && p.connected; })();
// 本线可以送油的趴窝车辆：油尽、离本线某个接通的点（或补给站）260 以内能直线开到、附近 120 没有敌人
function trkStranded(L) {
  const out = [];
  for (const v of S.veh || []) {
    if (v.side !== 'p' || v.dead || v.lst || (v.fuel ?? 1) > .05 || vehWater(v.x, v.y)) continue;
    const pts = [{ x: L.x, y: L.y, n: null }, ...(S.snet ? S.snet.nodes.filter(n => n.root === L.id && n.connected).map(n => ({ x: n.x, y: n.y, n })) : [])];
    let best = null, bd = TRK.rng;
    for (const p of pts) { const d = dist(p.x, p.y, v.x, v.y); if (d < bd && vehLine(p.x, p.y, v.x, v.y, 'veh')) { bd = d; best = p; } }
    if (best && !snDanger(v.x, v.y, 120)) out.push({ v, via: best });
  }
  return out;
}

function trkStep(dt) {
  if (!trkOn() || !Array.isArray(S.supply)) return;
  const T = trkEnsure();
  if ((T.thT -= dt) <= 0) { T.thT = 1; trkThink(T); }
  for (const t of T.list) if (!t.dead) trkMove(t, dt);
  if (T.list.some(t => t.dead && S.t - t.deadT > 20)) T.list = T.list.filter(t => !t.dead || S.t - t.deadT <= 20);   // 残骸留 20 秒
}

function trkThink(T) {
  const N = S.snet ? S.snet.nodes : [];
  for (const L of S.supply) {
    if (!L.connected) continue;
    const mine = T.list.filter(t => !t.dead && t.root === L.id), nn = N.filter(n => n.root === L.id && !n.dead).length;
    const want = Math.min(TRK.cap, 2 + Math.floor(nn / 3));
    if (mine.length < want && (nn > 0 || trkStranded(L).length) && S.t >= (T.spT[L.id] ?? 0)) {
      mine.push(T.list[T.list.push({ id: S.nid++, root: L.id, x: L.x, y: L.y, h: -Math.PI / 2, ph: 'idle', t: S.t, job: null, pts: null, i: 0, dead: false }) - 1]);
      T.spT[L.id] = S.t + (mine.length <= 2 ? 3 : TRK.gap);
      v8Stat('trkNew');
    }
    for (const t of mine) if (t.ph === 'idle') trkJob(t, L, T);
  }
  for (const t of T.list) if (!t.dead && t.ph !== 'idle' && t.ph !== 'load') trkThreat(t);
}

// 派活：送油（趴窝车辆）> 建点（规划中、上级已接通）> 补存量（接通的点里最缺、用户最多的）；同一件活只派一辆
function trkJob(t, L, T) {
  const N = S.snet ? S.snet.nodes : [], taken = (k, id) => T.list.some(o => o !== t && !o.dead && o.job && o.job.k === k && o.job.id === id);
  let best = null, bs = 0;
  for (const s of trkStranded(L)) if (!taken('fuel', s.v.id) && 5 > bs) { bs = 5; best = { k: 'fuel', id: s.v.id, via: s.via }; }
  for (const n of N) {
    if (n.root !== L.id || n.dead) continue;
    if (!snLive(n) && n.built < 1 && trkReach(n.parent) && !taken('build', n.id) && !snDanger(n.x, n.y, 110) && 3 > bs) { bs = 3; best = { k: 'build', id: n.id, n }; }
    else if (n.connected && trkStock(n) < .75 && !taken('feed', n.id)) { const s = 1 + (1 - trkStock(n)) * 2 + trkUsers(n) * .3; if (s > bs) { bs = s; best = { k: 'feed', id: n.id, n }; } }
  }
  if (!best) return;
  let pts;
  if (best.k === 'fuel') {
    const v = vehById(best.id);
    if (!v) return;
    pts = best.via.n ? trkRoute(L, best.via.n) : [[L.x, L.y]];
    if (!pts) return;
    pts.push([v.x, v.y]);
  } else pts = trkRoute(L, best.n);
  if (!pts || pts.length < 2) return;
  Object.assign(t, { job: { k: best.k, id: best.id }, pts, i: 1, ph: 'load', t: S.t });
  v8Stat('trkGo');
}

// 行车：沿路径点开，路况按车辆地形系数（公路最快）；到终点卸车，卸完原路返回补给站
function trkMove(t, dt) {
  if (t.ph === 'idle') return;
  if (t.ph === 'load') { if (S.t - t.t >= TRK.load) { t.ph = 'out'; t.t = S.t; } return; }
  if (t.ph === 'drop') { trkDrop(t, dt); return; }
  const back = t.ph === 'back', P = t.pts;
  if (!P || !P.length) { t.ph = 'idle'; return; }
  // 去程中活没了（目标点断了 / 被毁、车辆已加上油或已损失）：掉头回去
  if (!back && !trkValid(t)) { trkBack(t); return; }
  const [tx, ty] = P[t.i], d = dist(t.x, t.y, tx, ty);
  const tp = TER.type[ci(t.x, t.y)], sp = TRK.spd * (VEH_TSP[tp] || .45) * dt;
  if (d <= sp) {
    t.x = tx; t.y = ty;
    if (back ? t.i <= 0 : t.i >= P.length - 1) {
      if (back) { t.ph = 'idle'; t.job = null; t.pts = null; return; }
      t.ph = 'drop'; t.t = S.t; return;
    }
    t.i += back ? -1 : 1;
    return;
  }
  const a = Math.atan2(ty - t.y, tx - t.x);
  t.h = a; t.x += Math.cos(a) * sp; t.y += Math.sin(a) * sp;
}
function trkBack(t) { t.ph = 'back'; t.i = Math.max(0, Math.min(t.i, (t.pts || []).length) - 1); }
function trkValid(t) {
  const j = t.job;
  if (!j) return false;
  if (j.k === 'fuel') { const v = vehById(j.id); return !!v && !v.dead && (v.fuel ?? 1) <= .05; }
  const n = snById(j.id);
  if (!n || n.dead) return false;
  return j.k === 'build' ? !snLive(n) && trkReach(n.parent) : n.connected;
}
function trkDrop(t, dt) {
  const j = t.job, el = S.t - t.t;
  if (!j || !trkValid(t) && j.k !== 'build') { trkBack(t); return; }
  if (j.k === 'build') {
    const n = snById(j.id);
    if (!n || n.dead) { trkBack(t); return; }
    if (!snLive(n)) {
      n.built = Math.min(1, (n.built || 0) + dt / TRK.build);
      if (n.built < 1) return;
      Object.assign(n, { dead: false, hp: n.maxhp, cut: false, rep: 0, sab: 0, stock: Math.max(trkStock(n), TRK.give) });
      log('补给卡车卸下预制器材，前沿补给点建成', 'good', 'trkbuild', 8, n);
      v8Stat('trkBuild');
    }
    trkBack(t); return;
  }
  if (el < TRK.drop) return;
  if (j.k === 'feed') {
    const n = snById(j.id);
    n.stock = Math.min(1, trkStock(n) + TRK.give);
    log('补给卡车把弹药、油料送到前沿补给点', 'info', 'trkfeed', 30, n);
    v8Stat('trkFeed');
  } else {
    const v = vehById(j.id);
    v.fuel = Math.max(v.fuel ?? 0, TRK.fuel);
    log(`补给卡车给油尽的${vehName(v)}加油，可以继续机动`, 'good', 'trkfuel' + v.id, 20, v);
    v8Stat('trkFuel');
  }
  trkBack(t);
}

// 挨打：看得见它的敌步兵（没被压住）、碉堡、敌战车在射程内，每秒有一定概率把卡车打掉
function trkThreat(t) {
  let p = 0;
  for (const q of S.teams) if (q.side === 'e' && q.men.length && q.sup < 60 && !q.ride && dist(q.x, q.y, t.x, t.y) < TRK.near) p += q.men.includes('mg') ? .25 : .12;
  for (const e of S.enemies) if (!e.dead && e.kind === 'bunker' && (e.sup || 0) < 50 && dist(e.x, e.y, t.x, t.y) < 170) p += .2;
  for (const v of vehFoes('p')) if (vehSp(v).gun && dist(v.x, v.y, t.x, t.y) < 220) p += .35;
  if (p > 0 && spotted(t.x, t.y) && Math.random() < p) trkKill(t, '敌火力');
}
function trkKill(t, why) {
  if (t.dead) return;
  t.dead = true; t.deadT = S.t;
  S.fx.push({ kind: 'boom', x: t.x, y: t.y, r: 12, life: 0, max: .9, side: 'p' });
  log(`补给卡车被${why}击毁`, 'bad', 'trkdead', 6, t);
  v8Stat('trkLost');
  const T = trkEnsure();
  T.spT[t.root] = Math.max(T.spT[t.root] ?? 0, S.t + TRK.gap);
}
function trkImpact(x, y, R, pw, side) {
  if (side !== 'e' || !S.trk) return;
  for (const t of S.trk.list) if (!t.dead && t.ph !== 'idle' && dist(t.x, t.y, x, y) < Math.max(10, (R || 0) * .5) + 8) trkKill(t, '炮火');
}

// —— 绘制：俯视的 6×6 卡车（驾驶室 + 带篷货厢、三轴车轮）；载货时货厢里画三个弹药箱，空车返回时货厢空着；残骸冒烟 ——
function trkDraw(time) {
  if (!S || !S.trk || typeof R !== 'object' || !R.ctx) return;
  const ctx = R.ctx, k = Math.max(1, px(11) / 12);
  for (const t of S.trk.list) {
    if (t.ph === 'idle' && !t.dead) continue;   // 在补给站待命的不画（站里有车的意思已由补给站图标表达）
    if (!inView(t.x, t.y, 20)) continue;
    ctx.save(); ctx.translate(t.x, t.y); ctx.rotate(t.h); ctx.scale(k, k);
    const col = t.dead ? COL.enemy : COL.g, a = t.dead ? .5 : .95, full = !t.dead && (t.ph === 'load' || t.ph === 'out' || t.ph === 'drop');
    ctx.fillStyle = 'rgba(2,10,6,.9)'; ctx.strokeStyle = rgba(col, a); ctx.lineWidth = px(1.1) / k;
    for (const u of [-3.8, -1.2, 3.4]) for (const s of [-1, 1]) ctx.fillRect(u - 1, s * 2.6 - .5, 2, 1);   // 三轴车轮
    ctx.fillRect(-6, -2.2, 8.4, 4.4); ctx.strokeRect(-6, -2.2, 8.4, 4.4);   // 货厢
    ctx.fillRect(3, -1.9, 3, 3.8); ctx.strokeRect(3, -1.9, 3, 3.8);         // 驾驶室
    if (full) { ctx.fillStyle = rgba(COL.amber, .85); for (const u of [-5, -2.6, -.2]) ctx.fillRect(u, -1.3, 1.9, 2.6); }
    ctx.restore();
    if (t.dead) { const g = (S.t - t.deadT) % 1; ctx.fillStyle = rgba(COL.smoke, .25 * (1 - g)); ctx.beginPath(); ctx.arc(t.x + g * 6, t.y - g * 10, 4 + g * 6, 0, 7); ctx.fill(); }
    else if (t.ph === 'drop' && t.job && t.job.k === 'build') {   // 卸器材建点：进度环
      const n = snById(t.job.id);
      if (n) { ctx.strokeStyle = COL.amber; ctx.lineWidth = px(1.6); ctx.beginPath(); ctx.arc(t.x, t.y, 9 * k, -1.57, -1.57 + (n.built || 0) * 6.283); ctx.stroke(); }
    }
  }
}

HOOK.step.push(trkStep);
HOOK.impact.push(trkImpact);
HOOK.drawUnder.push(trkDraw);
HOOK.newGame.push(() => { if (S) S.trk = null; });
