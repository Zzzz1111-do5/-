'use strict';
// 进攻方协同（v7）：① 攻击组凑足兵力再统一发起（按兵力比，攻坚 3:1、近战地形 2:1、开阔地 1.5:1；超时接受风险或绕开）、
// 等待时先请舰炮准备；② 友邻互相支援：连队遭压制时，附近空闲连队前出到侧翼以侧射火力支援；③ 前沿空隙补位；
// ④ 步坦协同：坦克 / 装甲车与步兵连绑定，停在步兵线后 35–55、左右错开；步兵被压制时前出敲掉压制火力点，但绝不超出步兵线 30；
//    敌步兵贴近坦克时，伙伴连派一个小组掩护。执行器 vehEscort 双方共用（守方的绑定由 ai4.js 负责）。
// 状态：S.tf = {mass: {据点 key: {t0, x, y, prep}}, help: {连队 id: {b, until}}, gap: {}, go: [最近发起的冲击（画箭头）], ...}
const tfOn = () => !!S && !(S.v7off && S.v7off.tf);
const tfStat = (k, n = 1) => { const o = S.v7s || (S.v7s = {}); o[k] = (o[k] || 0) + n; };
const VEH_BACK7 = { lt_tank: 35, tank: 40, hv_tank: 35, amtank: 40, apc: 55, td: 70, flame_tank: 25, mine_tank: 30, recon: 60, aa_veh: 90 };
const TF_GUNV = ['lt_tank', 'tank', 'hv_tank', 'amtank', 'td', 'flame_tank', 'mine_tank'];
function tfEnsure() { if (!S.tf || S.tf.v !== 1) S.tf = { v: 1, mass: {}, help: {}, gap: {}, go: [], thinkT: 1, bindT: 0, sitT: 150 }; return S.tf; }
const tfUN = u => typeof cmdUName === 'function' ? cmdUName(u) : unitName(u);
const tfWhere = (x, y) => typeof cmdWhere === 'function' ? cmdWhere(x, y) : gridRef(x, y);
const tfPow = q => typeof frPowTeam === 'function' ? frPowTeam(q) : q.men.length;
const tfPowV = v => typeof frPowVeh === 'function' ? frPowVeh(v) : 6;
function tfCent(u) { let x = 0, y = 0, n = 0; for (const q of teamsOf(u)) if (q.men.length && !q.ride) { x += q.x; y += q.y; n++; } return n ? [x / n, y / n, n] : null; }

// —— ① 集结与统一发起（autopilot.js 的 wait 阶段调用）——
// 攻坚所需兵力比：已知碉堡 120 内 / 堑壕 60 内 3:1；城镇、林地 2:1；开阔地 1.5:1
function tfReq(p) {
  if (S.enemies.some(e => !e.dead && e.kx != null && e.kind === 'bunker' && dist(e.kx, e.ky, p.x, p.y) < 120)) return 3;
  if ((S.trench || []).some(t => t.known && t.pts && t.pts.some(([a, b]) => dist(a, b, p.x, p.y) < 60))) return 3;
  return coverAt(p.x, p.y) < .75 ? 2 : 1.5;
}
function tfMass(u, p, grp, ready, exposed, pl, P, O) {
  const T = tfEnsure(), now = S.t;
  let M = T.mass[p.key];
  if (!M) M = T.mass[p.key] = { t0: now, x: u.x, y: u.y, prep: null, said: 0 };
  const est = Math.max(2, typeof cmdEst === 'function' ? cmdEst(p, apEstimate(p)) : apEstimate(p)), req = tfReq(p);
  let pow = 0, cx = 0, cy = 0, n = 0;
  for (const g of ready) {
    for (const q of teamsOf(g)) if (q.men.length && !q.ride) { pow += tfPow(q); cx += q.x; cy += q.y; n++; }
    for (const v of S.veh || []) if (v.buddy === g.id && !v.dead && v.side === 'p') pow += .8 * tfPowV(v);
  }
  if (n) { M.x = cx / n; M.y = cy / n; }
  const need = req * est, beach = coastAt(u.x) - u.y < 90, Tm = beach ? 15 : 40, wait = now - M.t0, R = pow / est;
  // 炮火准备：第一次进入待攻时请舰炮压制目标附近已标定的火力点
  if (!M.prep && typeof cmdFire === 'function' && S.cmd && S.cmd.p) {
    M.prep = now;
    const tg = S.enemies.filter(e => !e.dead && e.kx != null && (e.kind === 'bunker' || e.kind === 'mortar') && dist(e.kx, e.ky, p.x, p.y) < 150).slice(0, 2);
    for (const e of tg) if (!S.teams.some(q => q.side === 'p' && q.men.length && dist(q.x, q.y, e.kx, e.ky) < 90)) cmdFire(e.kx, e.ky, 2, 'prep');
  }
  let go = false, risk = false;
  if (pow >= .85 * need) go = true;
  else if (beach && (pow >= .5 * need || wait >= Tm)) go = true;   // 滩头不久留
  else if (exposed && pow >= .5 * need) go = true;   // 挨炮 / 被压制：凑够一半就压上，不在原地挨打
  else if (wait >= Tm && pow >= .6 * need) { go = true; risk = true; }
  else if (wait >= 75) {
    if (pow < .4 * need && grp.length === ready.length) {   // 兵力悬殊：暂不强攻，绕开此点
      P.hard[p.key] = now;
      for (const g of grp) apIdle(P.u[g.id]);
      delete T.mass[p.key]; delete P.o[p.key];
      tfStat('tfBypass');
      if (typeof chatSay === 'function') chatSay('p', `决心：${p.name}守备坚固（约 ${Math.round(est)} 人），我仅约 ${Math.round(pow)} 人，暂不强攻，以火力钳制，转攻他处。`, { kind: 'plan', at: p, key: 'tfbyp' + p.key, gap: 60 });
      return;
    }
    go = true; risk = true;
  }
  if (!go) {
    O.boost = Math.min(4, Math.max(O.boost || 0, grp.length + 1));   // 请求加强：分配时向此点多派连队
    if (!M.said && wait > 4 && typeof chatSay === 'function') {
      M.said = 1;
      const bk = S.enemies.filter(e => !e.dead && e.kx != null && e.kind === 'bunker' && dist(e.kx, e.ky, p.x, p.y) < 120).length;
      chatSay('p', `判断：${p.name}守军约 ${Math.round(est)} 人${bk ? `、碉堡 ${bk} 座` : ''}，我 ${ready.length} 个连约 ${Math.round(pow)} 人，兵力比 ${R.toFixed(1)}:1，不足攻坚所需 ${req}:1。决心：在出发阵地待命，抽调兵力加强${M.prep && S.dd && S.dd.state !== 'sunk' ? '，舰炮先行压制' : ''}。`, { kind: 'plan', at: p, key: 'tfmass' + p.key, gap: 45 });
    }
    return;
  }
  const units = ready.length ? ready : [u];
  apLaunch(units, p, P);
  delete T.mass[p.key];
  tfStat('tfLaunch'); tfStat('tfLaunchU', units.length);
  const nv = (S.veh || []).filter(v => !v.dead && v.side === 'p' && units.some(g => g.id === v.buddy) && TF_GUNV.includes(v.type)).length;
  if (nv) tfStat('tfLaunchV', nv);
  T.go.push({ x0: M.x, y0: M.y, x1: p.x, y1: p.y, t: now });
  if (T.go.length > 6) T.go.shift();
  if (typeof chatSay === 'function') chatSay('p', `命令：${units.map(tfUN).join('、')}向${p.name}统一发起冲击（约 ${Math.round(pow)} 人对 ${Math.round(est)} 人${risk ? '，兵力不足，接受风险' : ''}）${nv ? `，坦克 ${nv} 辆在步兵线后抵近支援` : ''}。`, { kind: 'order', at: p, key: 'tfgo' + p.key, gap: 20, lv: 1 });
}

// —— ② 友邻支援：连队遭压制（4 秒内挨打、平均压制 ≥ 40），350 内的空闲连队前出到压制源侧翼 110–130 处侧射 ——
function tfSource(u, c) {
  let best = null, bd = 280;
  for (const q of S.teams) if (q.side === 'e' && q.men.length && inVision(q.x, q.y)) { const d = dist(q.x, q.y, c[0], c[1]); if (d < bd) { bd = d; best = { x: q.x, y: q.y, k: '敌火力' }; } }
  for (const e of S.enemies) if (!e.dead && e.kx != null && (e.kind === 'bunker' || e.kind === 'mortar')) { const d = dist(e.kx, e.ky, c[0], c[1]) + 20; if (d < bd) { bd = d; best = { x: e.kx, y: e.ky, k: e.kind === 'bunker' ? '碉堡' : '迫击炮' }; } }
  return best;
}
function tfHelp(P) {
  const T = tfEnsure(), act = Object.values(T.help).filter(h => h.until > S.t).length;
  if (act >= 2) return;
  for (const u of S.units) {
    if (u.side !== 'p' || u.kind !== 'inf' || u.auto !== true || u.state === 'rout' || S.t - (u.hitT ?? -99) > 4) continue;
    if (T.help[u.id] && T.help[u.id].until > S.t) continue;
    const ts = teamsOf(u).filter(q => q.men.length && !q.ride);
    if (!ts.length || ts.reduce((a, q) => a + q.sup, 0) / ts.length < 40) continue;
    const c = tfCent(u), src = c && tfSource(u, c);
    if (!src) continue;
    let best = null, bd = 350;
    for (const g of S.units) {
      const pl = P.u[g.id];
      if (g === u || g.side !== 'p' || g.kind !== 'inf' || g.auto !== true || g.state === 'rout' || !pl || S.t - (g.hitT ?? -99) < 8 || (g.men || 0) < 5) continue;
      if (!['idle', 'wait', 'stage', 'garrison'].includes(pl.ph) || (pl.ph === 'garrison' && pl.obj === 'HQ')) continue;
      const gc = tfCent(g); if (!gc) continue;
      const d = dist(gc[0], gc[1], c[0], c[1]);
      if (d < bd) { bd = d; best = { g, gc, pl }; }
    }
    if (!best) continue;
    // 侧射阵位：压制源周围、与“被压制连队 → 压制源”方向成 70°、靠近支援连队的一侧
    const a0 = Math.atan2(c[1] - src.y, c[0] - src.x);
    let spot = null, sd = Infinity, side = 1;
    for (const s of [1, -1]) {
      const x = src.x + Math.cos(a0 + s * 1.22) * 120, y = src.y + Math.sin(a0 + s * 1.22) * 120, d = dist(x, y, best.gc[0], best.gc[1]);
      if (d < sd && x > 10 && x < W - 10 && y > 10 && y < coastAt(clamp(x, 0, W - 1)) - 10) { sd = d; spot = { x, y }; side = s; }
    }
    if (!spot) continue;
    let bs = -Infinity, cell = null;
    eachCellIn(spot.x, spot.y, 30, i => { const t = TER.type[i]; if (!TP[t].sp || MINEC[i] === 2 || WIREC[i]) return; const s = (1 - TP[t].cv) * 2 - dist(cellCX(i), cellCY(i), spot.x, spot.y) / 30; if (s > bs) { bs = s; cell = { x: cellCX(i), y: cellCY(i) }; } });
    if (!cell) continue;
    const pl = best.pl, hb = { ph: pl.ph, obj: pl.obj };
    if (!apMove(best.g, pl, cell.x, cell.y, Math.atan2(src.y - cell.y, src.x - cell.x), 'amove')) continue;
    Object.assign(pl, { ph: 'help', hb, helpT: S.t + 40 });
    T.help[u.id] = { b: best.g.id, until: S.t + 40 };
    tfStat('sreq'); tfStat('sreqHelp');
    if (typeof chatSay === 'function') {
      const lr = (Math.cos(a0 + side * 1.22) * -Math.sin(a0) + Math.sin(a0 + side * 1.22) * Math.cos(a0)) > 0 ? '右' : '左';
      chatSay('p', `报告：${tfUN(u)}遭${src.k}压制；命令：${tfUN(best.g)}向其${lr}翼前出，以侧射火力支援。`, { kind: 'order', at: { x: c[0], y: c[1] }, key: 'tfhelp' + u.id, gap: 40, lv: 1 });
    }
    if (Object.values(T.help).filter(h => h.until > S.t).length >= 2) return;
  }
}
// 支援 / 补位任务到期：回到原来的任务（守备回原据点，其余重新分配）
function tfExpire(P) {
  const T = tfEnsure();
  for (const id in T.help) if (T.help[id].until < S.t - 30) delete T.help[id];
  for (const id in P.u) {
    const pl = P.u[id];
    if ((pl.ph === 'help' && S.t > pl.helpT) || (pl.ph === 'gap' && S.t > pl.gapT)) {
      const u = UNIT_MAP.get(+id), hb = pl.hb || {}, p = hb.obj && apPt(hb.obj);
      pl.hb = null;
      if (u && hb.ph === 'garrison' && p && apTaken(p)) apGarrison(u, p, P); else apIdle(pl);
    }
  }
}

// —— ③ 前沿空隙：登陆场正面出现宽 200 以上（或当面有敌 4 人以上）的空隙，抽空闲连队进至空隙占领阵地 ——
function tfGap(P) {
  const F = S.front && S.front.p;
  if (!F || !F.gap || !F.gap.length) return;
  const T = tfEnsure();
  for (const g of F.gap) {
    if (g.w < 200 && !(g.th >= 4)) continue;
    const k = Math.round(g.x / 150);
    if (T.gap[k] && T.gap[k] > S.t) continue;
    let best = null, bd = 650;
    for (const u of S.units) {
      const pl = P.u[u.id];
      if (u.side !== 'p' || u.kind !== 'inf' || u.auto !== true || u.state === 'rout' || !pl || (u.men || 0) < 5) continue;
      if (pl.ph !== 'idle' && !(pl.ph === 'garrison' && pl.obj !== 'HQ' && apPt(pl.obj) && apEstimate(apPt(pl.obj), true) < 1)) continue;
      const d = dist(u.x, u.y, g.x, g.y);
      if (d < bd) { bd = d; best = u; }
    }
    T.gap[k] = S.t + 45;
    if (!best) continue;
    const pl = P.u[best.id], hb = { ph: pl.ph, obj: pl.obj }, y = Math.min(g.y + 30, coastAt(g.x) - 20);
    if (!apMove(best, pl, g.x, y, NORTH, 'move')) continue;
    Object.assign(pl, { ph: 'gap', hb, gapT: S.t + 60 });
    T.gap[k] = S.t + 90;
    tfStat('gapFill');
    if (typeof chatSay === 'function') {
      chatSay('p', `报告：${tfWhere(g.x, g.y)}一带出现约 ${Math.round(g.w / 10) * 10} 米空隙，侧翼暴露。`, { kind: 'friction', at: { x: g.x, y: g.y }, key: 'tfgap' + k, gap: 60 });
      chatSay('p', `补救：${tfUN(best)}进至空隙占领阵地，与两翼连成一线。`, { kind: 'remedy', at: { x: g.x, y: g.y }, key: 'tfgapr' + k, gap: 60 });
    }
  }
}

// —— ④ 步坦协同：绑定（每 3 秒）——
// 炮车 / 装甲车绑到正在进攻（集结、待攻、攻击、支援）的自动步兵连：每连最多 2 辆炮车 + 1 辆装甲车；已有伙伴且仍有效就不换
function tfBind(P) {
  const units = S.units.filter(u => u.side === 'p' && u.kind === 'inf' && u.auto === true && u.state !== 'rout' && P.u[u.id] && ['stage', 'wait', 'go', 'help', 'gap', 'garrison'].includes(P.u[u.id].ph) && tfCent(u));
  const load = {};
  const kindOf = v => TF_GUNV.includes(v.type) ? 'g' : v.type === 'apc' ? 'a' : 'o';
  const cap = { g: 2, a: 1, o: 1 };
  const vs = (S.veh || []).filter(v => v.side === 'p' && !v.dead && !v.lst && v.auto && !v.swim && !v.immob && v.type !== 'spg' && isLand(v.x, v.y));
  for (const v of S.veh || []) if (v.side === 'p' && v.buddy != null && !vs.includes(v)) { v.buddy = null; v.esc = null; }
  // 先保留仍有效的绑定
  for (const v of vs) {
    const u = v.buddy != null && units.find(o => o.id === v.buddy), k = kindOf(v), L = u && (load[u.id] || (load[u.id] = { g: 0, a: 0, o: 0 }));
    if (u && L[k] < cap[k] && (v.ai !== 'repair')) L[k]++; else { v.buddy = null; v.esc = null; }
  }
  for (const v of vs) {
    if (v.buddy != null || v.ai === 'repair' || v.ride && v.ride.length || v.pick) continue;
    const k = kindOf(v);
    let best = null, bs = -Infinity;
    for (const u of units) {
      const L = load[u.id] || { g: 0, a: 0, o: 0 }, c = tfCent(u), ph = P.u[u.id].ph;
      if (L[k] >= cap[k]) continue;
      const d = dist(v.x, v.y, c[0], c[1]);
      if (d > 900) continue;
      const s = -d / 100 + (ph === 'go' || ph === 'wait' ? 2.5 : ph === 'stage' || ph === 'help' ? 1.5 : 0) - (L.g + L.a) * 1.2;
      if (s > bs) { bs = s; best = u; }
    }
    if (!best) continue;
    const L = load[best.id] || (load[best.id] = { g: 0, a: 0, o: 0 });
    L[k]++;
    v.buddy = best.id; v.esc = { back: VEH_BACK7[v.type] ?? 45, lat: 0, mode: 'travel' };
    tfStat('tfBind');
  }
  tfLat('p');
}
// 同一伙伴连的车辆左右错开：±(12 + 22k)
function tfLat(side) {
  const by = {};
  for (const v of S.veh || []) if (v.side === side && !v.dead && v.buddy != null && v.esc) (by[v.buddy] || (by[v.buddy] = [])).push(v);
  for (const k in by) by[k].sort((a, b) => a.id - b.id).forEach((v, i) => { v.esc.lat = (i % 2 ? 1 : -1) * (12 + 22 * Math.floor(i / 2)) * (side === 'e' ? 1.1 : 1); });
}
// 敌步兵贴近坦克（70 内）而身边没有我方步兵（40 内）：伙伴连派最近的未被压制小组前出掩护
function tfScreen() {
  for (const v of S.veh || []) {
    if (v.side !== 'p' || v.dead || v.buddy == null || !v.esc) continue;
    let th = null, td = 70;
    for (const q of S.teams) if (q.side === 'e' && q.men.length && inVision(q.x, q.y)) { const d = dist(q.x, q.y, v.x, v.y); if (d < td) { td = d; th = q; } }
    if (!th || S.teams.some(q => q.side === 'p' && q.men.length && !q.ride && dist(q.x, q.y, v.x, v.y) < 40)) continue;
    const u = UNIT_MAP.get(v.buddy);
    if (!u) continue;
    const q = teamsOf(u).filter(q => q.men.length && !q.ride && q.sup < 45 && q.order.t !== 'charge' && !(q.scr && q.scr.until > S.t)).sort((a, b) => dist(a.x, a.y, v.x, v.y) - dist(b.x, b.y, v.x, v.y))[0];
    if (!q || dist(q.x, q.y, v.x, v.y) > 220) continue;
    const a = Math.atan2(th.y - v.y, th.x - v.x), x = v.x + Math.cos(a) * 20, y = v.y + Math.sin(a) * 20;
    if (!passInf(x, y) || !field(x, y, 'p')) continue;
    q.order = { t: 'amove', x, y, gx: x, gy: y }; q.pathT = -9; q.scr = { v: v.id, until: S.t + 10 };
    tfStat('scr');
    if (typeof chatSay === 'function') chatSay('p', `命令：${vehName(v)}遭敌步兵抵近，${tfUN(u)}派一个小组上前掩护坦克。`, { kind: 'order', at: v, key: 'tfscr' + v.id, gap: 45, lv: 2 });
  }
}

// —— 步坦协同执行器（双方共用；vehicles.js 的 vehThinkP / vehThinkE 在思考周期调用）——
// 轴线：我方 = 伙伴连的目标据点；守方 = 反冲击计划的目标 / 威胁方向（ai4.js 的 a4Axis）
function tfAxisPt(v, u, c) {
  if (v.side === 'e') return typeof a4Axis === 'function' ? a4Axis(v, u, c) : [c[0], c[1] + 200];
  const P = S.autoPlan && S.autoPlan.u, pl = P && P[u.id], p = pl && pl.obj ? apPt(pl.obj) : null;
  if (p && dist(p.x, p.y, c[0], c[1]) > 20) return [p.x, p.y];
  let best = null, bd = Infinity;
  for (const o of S.points) if (o.owner !== 'p') { const d = dist(o.x, o.y, c[0], c[1]); if (d < bd) { bd = d; best = o; } }
  return best ? [best.x, best.y] : [c[0], c[1] - 200];
}
// 压制伙伴步兵的火力源：优先取被压制小组记下的射击来源附近的已知敌人，否则取步兵前沿 240 内最近的已知敌火力点
function tfPinner(v, ts, Fx, Fy) {
  const foe = v.side === 'p' ? 'e' : 'p', seen = (x, y) => foe === 'e' ? inVision(x, y) : spotted(x, y);
  const src = ts.filter(q => q.supT != null && S.t - q.supT < 4 && q.supX != null).map(q => [q.supX, q.supY]);
  let best = null, bs = Infinity;
  const cand = (x, y, w) => {
    let d = dist(x, y, Fx, Fy);
    if (d > 260) return;
    if (src.some(([sx, sy]) => dist(sx, sy, x, y) < 30)) d *= .4;
    d /= w;
    if (d < bs) { bs = d; best = { x, y }; }
  };
  for (const q of S.teams) if (q.side === foe && q.men.length && !q.ride && seen(q.x, q.y)) cand(q.x, q.y, q.men.includes('mg') ? 1.5 : 1);
  if (foe === 'e') for (const e of S.enemies) if (!e.dead && e.kx != null && (e.kind === 'bunker' || e.kind === 'mortar')) cand(e.kx, e.ky, e.kind === 'bunker' ? 2 : 1.2);
  for (const o of S.veh || []) if (o.side === foe && !o.dead && !o.lst && seen(o.x, o.y)) cand(o.x, o.y, 2.5);
  return best;
}
function vehEscort(v) {
  const u = UNIT_MAP.get(v.buddy), E = v.esc, sp = vehSp(v);
  const ts = u && u.state !== 'rout' ? teamsOf(u).filter(q => q.men.length && !q.ride) : [];
  if (!ts.length || !E) { v.buddy = null; v.esc = null; return false; }
  let cx = 0, cy = 0;
  for (const q of ts) { cx += q.x; cy += q.y; }
  cx /= ts.length; cy /= ts.length;
  const [ox, oy] = tfAxisPt(v, u, [cx, cy]);
  let ax = ox - cx, ay = oy - cy;
  const l = Math.hypot(ax, ay);
  if (l < 1) { ax = 0; ay = v.side === 'p' ? -1 : 1; } else { ax /= l; ay /= l; }
  let sInf = -Infinity;
  for (const q of ts) sInf = Math.max(sInf, (q.x - cx) * ax + (q.y - cy) * ay);
  const Fx = cx + ax * sInf, Fy = cy + ay * sInf, lx = -ay, ly = ax, back = E.back ?? 45, lat = E.lat || 0;
  let sx = Fx - ax * back + lx * lat, sy = Fy - ay * back + ly * lat, mode = 'ovw';
  const pinned = ts.filter(q => q.sup > 45).length >= Math.max(1, ts.length * .3);
  E.eng = null;
  if (pinned && sp.gun && !sp.gun.ind) {
    const pin = tfPinner(v, ts, Fx, Fy);
    if (pin) {
      const d = dist(pin.x, pin.y, Fx, Fy), fl = sp.gun.flame && S.teams.some(q => q.side === v.side && q.men.length && dist(q.x, q.y, pin.x, pin.y) < 90);
      const rr = fl ? 40 : Math.min(sp.gun.range * .75, Math.max(d - 5, 70));
      const ex = Fx - pin.x, ey = Fy - pin.y, el = Math.hypot(ex, ey) || 1;
      let nx = pin.x + ex / el * rr + lx * lat * .5, ny = pin.y + ey / el * rr + ly * lat * .5;
      const pr = (nx - cx) * ax + (ny - cy) * ay, lim = sInf + (fl ? 60 : 30);
      if (pr > lim) { nx -= ax * (pr - lim); ny -= ay * (pr - lim); }
      sx = nx; sy = ny; mode = 'engage';
      E.eng = { x: pin.x, y: pin.y, until: S.t + 4 };
    }
  }
  E.mode = mode; v.ai = mode === 'engage' ? 'engage' : 'escort';
  sx = clamp(sx, 10, W - 10); sy = clamp(sy, 10, H - 10);
  // 硬规则：车在步兵线前方（交战时 30 以外、平时 8 以外）立即退回阵位
  const vp = (v.x - cx) * ax + (v.y - cy) * ay, ahead = vp > sInf + (mode === 'engage' ? 38 : 8);
  if (!ahead && E.sx != null && dist(E.sx, E.sy, sx, sy) < 20 && v.order.x != null && dist(v.order.x, v.order.y, E.hx ?? sx, E.hy ?? sy) < 30) return true;
  if (!ahead && E.sx != null && dist(E.sx, E.sy, sx, sy) < 20 && v.order.t === 'hold' && dist(v.x, v.y, E.hx ?? sx, E.hy ?? sy) < 25) return true;
  E.sx = sx; E.sy = sy;
  // 车体半埋：阵位 20 以内掩护最好的可通行格（避开弹坑减速只给小奖励）
  let hx = sx, hy = sy, bs = -Infinity;
  if (typeof eachCellIn === 'function') eachCellIn(sx, sy, 20, i => {
    const t = TER.type[i]; if (!TP[t].sp) return;
    const x = cellCX(i), y = cellCY(i), s = (1 - TP[t].cv) * 2 + (CRATERC[i] ? .4 : 0) - dist(x, y, sx, sy) / 20;
    if (s > bs) { bs = s; hx = x; hy = y; }
  });
  E.hx = hx; E.hy = hy;
  const face = mode === 'engage' && E.eng ? Math.atan2(E.eng.y - hy, E.eng.x - hx) : Math.atan2(ay, ax);
  if (vehGo(v, hx, hy, 'move', face)) return true;
  if (vehGo(v, Fx - ax * back * .5, Fy - ay * back * .5, 'move', face)) return true;
  return false;   // 到不了：交回原有逻辑
}

// —— 态势简报（每 150 秒，用战线模型）——
function tfSitrep() {
  if (typeof frSummary !== 'function' || !S.front || typeof chatSay !== 'function') return;
  const f = frSummary();
  if (!f.w) return;
  const g = f.gaps.filter(o => o.w >= 120);
  chatSay('p', `判断：登陆场正面约 ${Math.round(f.w / 10) * 10} 米、纵深约 ${Math.round(f.depth / 10) * 10} 米，分 ${f.seg} 段${g.length ? `；${g.map(o => tfWhere(o.x, o.y) + '约 ' + Math.round(o.w / 10) * 10 + ' 米空隙').join('、')}` : '，正面连贯'}。`, { kind: 'report', key: 'tfsit', gap: 100, lv: 1 });
}

function tfThink(dt) {
  if (!S || S.phase !== 'battle' || S.over || !tfOn()) return;
  const T = tfEnsure();
  if ((T.thinkT -= dt) > 0) return;
  T.thinkT = 1;
  const P = S.autoPlan && S.autoPlan.u ? S.autoPlan : null;
  if (!P) return;
  for (const k in T.mass) if (!P.o[k] || S.t - T.mass[k].t0 > 120) delete T.mass[k];
  tfExpire(P); tfHelp(P); tfGap(P); tfScreen();
  if ((T.bindT -= 1) <= 0) { T.bindT = 3; tfBind(P); }
  if ((T.sitT -= 1) <= 0) { T.sitT = 150; tfSitrep(); }
}
HOOK.step.push(tfThink);
HOOK.newGame.push(function tfNewGame() { if (S) S.tf = null; });
