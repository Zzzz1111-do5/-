'use strict';
// 进攻方协同（v7）：① 攻击组凑足兵力再统一发起（按兵力比，攻坚 3:1、近战地形 2:1、开阔地 1.5:1；超时接受风险或绕开）、
// 等待时先请舰炮准备；② 友邻互相支援：连队遭压制时，附近空闲连队前出到侧翼以侧射火力支援；③ 前沿空隙补位；
// ④ 步坦协同：坦克 / 装甲车与步兵连绑定，停在步兵线后 35–55、左右错开；步兵被压制时前出敲掉压制火力点，但绝不超出步兵线 30；
//    敌步兵贴近坦克时，伙伴连派一个小组掩护。执行器 vehEscort 双方共用（守方的绑定由 ai4.js 负责）。
// 状态：S.tf = {mass: {据点 key: {t0, x, y, prep}}, help: {连队 id: {b, until}}, gap: {}, go: [最近发起的冲击（ai4.js frDrawPlans 画箭头）], main: 主攻地段 id, ...}
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
  T.go.push({ x0: M.x, y0: M.y, x1: p.x, y1: p.y, t: now, key: p.key });
  if (T.go.length > 6) T.go.shift();
  const F = T.fm && T.fm[p.key], fm = F && F.ph === 'adv' ? `，成${F.fn}队形分两个梯次交替跃进` : '';
  if (typeof chatSay === 'function') chatSay('p', `命令：${units.map(tfUN).join('、')}向${p.name}统一发起冲击（约 ${Math.round(pow)} 人对 ${Math.round(est)} 人${risk ? '，兵力不足，接受风险' : ''}）${fm}${nv ? `，坦克 ${nv} 辆在步兵线后抵近支援` : ''}。`, { kind: 'order', at: p, key: 'tfgo' + p.key, gap: 20, lv: 1 });
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

// —— ⑤ 队形进攻：统一发起后，攻击组沿进攻轴线成队形展开（开阔地三三制楔形、城镇 / 林地横队、挨炮时散开），
//    分两个梯次交替跃进：一个梯次停下以火力掩护，另一个梯次跃进约 45 米到前方掩蔽处，再互换；
//    以最慢的组为准同步推进（被压制、卡住的组超时不等），不让个别组冲到前面孤立；推进到冲击出发线后统一冲击
// 状态：S.tf.fm[据点 key] = {ox, oy 出发线中心, ax, ay 轴线, L 推进总长, sE: [两个梯次的推进距离], lead 正在跃进的梯次, bT, n 跃进次数,
//        ph: adv 推进 / assault 冲击, u: [连队 id], q: {组 id: [横向, 纵深, 梯次]}, w0, w1 队形横向范围, fn 队形名}
const TF_BOUND = 45, TF_FN = { wedge: '三三制楔形', line: '横队', loose: '散开' };
// 连内第 i 组相对连中心的 [横向, 纵深]（与 formation.js unitSlots 同一套队形，但不钳到地图内、不找可通行格）
function tfSlotOff(i, n, form, width) {
  const sc = width / defWidth(form, n);
  if (form === 'wedge') { const tri = [[0, 0], [-1, 1], [1, 1]], [a1, b1] = tri[i % 3], [a2, b2] = tri[Math.floor(i / 3) % 3]; return [(a1 * 14 + a2 * 42) * sc, (b1 * 13 + b2 * 36) * sc + Math.floor(i / 9) * 60]; }
  const sp = n > 1 ? width / (n - 1) : 0;
  return [-width / 2 + i * sp, form === 'loose' ? (i % 2) * 22 : 0];
}
// 本连队正在队形推进中（autopilot 不再自行重下攻击前进令，冲锋距离收到 110）
function tfFormOf(id) {
  const F = S.tf && S.tf.fm;
  if (!F) return null;
  for (const k in F) if (F[k].ph === 'adv' && F[k].u.includes(id)) return F[k];
  return null;
}
// 发起（autopilot.js apLaunch 调用）：返回队形（apLaunch 把各连转入 go 后用 tfFormOrder 下第一次跃进令），否则由 apLaunch 直接攻击前进
function tfFormGo(units, p, cx, cy, P) {
  if (!tfOn()) return false;
  const T = tfEnsure(), d = dist(cx, cy, p.x, p.y);
  if (!T.fm) T.fm = {};
  let F = T.fm[p.key];
  if (F && F.ph !== 'adv') return false;
  if (!F) {
    if (d - 55 < TF_BOUND * 1.3) return false;   // 已在冲击距离内：直接攻击前进
    const ax = (p.x - cx) / d, ay = (p.y - cy) / d, arty = units.some(g => P.u[g.id] && S.t - (P.u[g.id].artyT ?? -99) < 30);
    const form = arty ? 'loose' : coverAt(p.x, p.y) < .75 ? 'line' : 'wedge';
    F = T.fm[p.key] = { ox: cx, oy: cy, ax, ay, L: Math.round(d - 55), sE: [0, 0], lead: 0, bT: S.t, n: 0, ph: 'adv', u: [], q: {}, w0: 0, w1: 0, form, fn: TF_FN[form] };
  }
  const lx = -F.ay, ly = F.ax, face = Math.atan2(F.ay, F.ax), proj = (x, y) => (x - F.ox) * lx + (y - F.oy) * ly;
  const add = units.filter(u => !F.u.includes(u.id) && teamsOf(u).length).sort((a, b) => proj(a.x, a.y) - proj(b.x, b.y));
  if (!add.length) return F;
  const ws = add.map(u => { u.form = F.form; return defWidth(F.form, teamsOf(u).length); }), gap = 26;
  // 首批：沿出发线居中展开；后到的连：接在现有队形更靠近自己的一侧——本就在更外侧的就地展开，不横穿过来收拢（最多离开现有队形 120 米）
  let off;
  const sw = ws.reduce((a, b) => a + b + gap, -gap), own = proj(add[0].x, add[0].y) - ws[0] / 2;
  if (!F.u.length) off = -sw / 2;
  else if (own + sw / 2 < (F.w0 + F.w1) / 2) { const tight = F.w0 - gap - sw; off = Math.max(tight - 120, Math.min(tight, own)); }
  else off = Math.min(F.w1 + gap + 120, Math.max(F.w1 + gap, own));
  const base = F.u.length;
  add.forEach((u, i) => {
    const w = ws[i], lat = off + w / 2, ts = teamsOf(u).filter(q => q.men.length && !q.ride);
    off += w + gap;
    F.w0 = Math.min(F.w0, lat - w / 2); F.w1 = Math.max(F.w1, lat + w / 2);
    // 连内槽位 → 轴线坐标 [横向（加上连的横向位置）, 在推进线之后的纵深]；组与槽位按横向顺序配对
    const sl = ts.map((q, k) => { const [a, b] = tfSlotOff(k, ts.length, F.form, w); return [a + lat, b]; });
    const tsS = ts.slice().sort((a, b) => proj(a.x, a.y) - proj(b.x, b.y)); sl.sort((a, b) => a[0] - b[0]);
    const multi = base + add.length > 1, ue = (base + i) % 2;   // 多个连：按连分梯次；单个连：连内按组交替
    tsS.forEach((q, k) => { F.q[q.id] = [Math.round(sl[k][0]), Math.round(sl[k][1]), multi ? ue : k % 2]; });
    F.u.push(u.id);
    Object.assign(u, { face, order: 'amove', tx: p.x, ty: p.y });
  });
  if (F.n === 0) { F.sE[F.lead] = TF_BOUND; F.bT = S.t; }
  tfStat('fmGo', add.length);
  return F;
}
// 下令：跃进梯次 → 前方槽位附近掩护最好的格（行进间射击）；掩护梯次在位（或已在槽位之前、横向没偏开）的停下以火力掩护，
//      落在后面或偏到一侧的先补位。fill：每秒的补位检查——只把停下来却离位置太远、没被压制的组再派回位置（每组 8 秒一次）
function tfFormOrder(F, p, fill) {
  const lx = -F.ay, ly = F.ax;
  for (const id of F.u) {
    const u = UNIT_MAP.get(id), pl = S.autoPlan && S.autoPlan.u && S.autoPlan.u[id];
    if (!u || u.state === 'rout' || !pl || pl.ph !== 'go' || (pl.halt != null && S.t - pl.halt < 45)) continue;
    // 寻路目标取本连该梯次各槽位的中心（和 orderUnits 用连的目的地中心一样）：不能取据点——桥被炸后会沿去据点的路绕远
    const slot = o => { const s = F.sE[o[2]] - o[1]; return [F.ox + F.ax * s + lx * o[0], F.oy + F.ay * s + ly * o[0]]; }, G = [[0, 0, 0], [0, 0, 0]];
    for (const q of teamsOf(u)) { const o = F.q[q.id]; if (o && q.men.length) { const [x, y] = slot(o), g = G[o[2]]; g[0] += x; g[1] += y; g[2]++; } }
    for (const q of teamsOf(u)) {
      const o = F.q[q.id];
      if (!o || !q.men.length || q.ride || q.order.t === 'charge' || q.order.t === 'retreat') continue;
      const [x0, y0] = slot(o), dx = q.x - x0, dy = q.y - y0, g = G[o[2]];
      const near = Math.hypot(dx, dy) < (fill ? 30 : 16) || (dx * F.ax + dy * F.ay > -8 && Math.abs(dx * lx + dy * ly) < 20);
      if (fill) { if (q.order.t !== 'hold' || near || q.sup >= 50 || S.t - (q.fmT ?? -99) < 8) continue; }
      else if (o[2] !== F.lead && near) { q.order = { t: 'hold' }; continue; }
      let x = x0, y = y0, bs = -Infinity;
      eachCellIn(x0, y0, 14, i => { const t = TER.type[i]; if (!TP[t].sp || MINEC[i] === 2 || WIREC[i]) return; const v = (1 - TP[t].cv) * 2 - dist(cellCX(i), cellCY(i), x0, y0) / 14; if (v > bs) { bs = v; x = cellCX(i); y = cellCY(i); } });
      q.order = { t: 'move', x, y, gx: Math.round(g[0] / g[2]), gy: Math.round(g[1] / g[2]) }; q.pathT = -9; q.fmT = S.t;
    }
  }
}
// 每秒：跃进梯次都到位（或被压制、停下超过 6 秒、跃进超过 25 秒）→ 互换梯次，前移 45；推进到冲击出发线 → 统一冲击
function tfForm(P) {
  const T = tfEnsure();
  if (!T.fm) return;
  for (const k in T.fm) {
    const F = T.fm[k], p = apPt(k), O = P.o[k];
    if (!p || !O || !O.go || apTaken(p)) { delete T.fm[k]; continue; }
    if (F.ph !== 'adv') { if (!F.u.some(id => P.u[id] && P.u[id].obj === k)) delete T.fm[k]; continue; }
    const us = F.u.map(id => UNIT_MAP.get(id)).filter(u => u && u.state !== 'rout' && P.u[u.id] && P.u[u.id].ph === 'go' && P.u[u.id].obj === k);
    if (!us.length) { delete T.fm[k]; continue; }
    if (us.some(u => S.t - (P.u[u.id].chT ?? -99) < 15)) { F.ph = 'assault'; continue; }   // autopilot 已下令冲锋
    const lx = -F.ay, ly = F.ax, mv = us.flatMap(u => teamsOf(u)).filter(q => q.men.length && !q.ride && F.q[q.id] && F.q[q.id][2] === F.lead);
    const at = q => { const o = F.q[q.id], s = F.sE[o[2]] - o[1]; return dist(q.x, q.y, F.ox + F.ax * s + lx * o[0], F.oy + F.ay * s + ly * o[0]) < 18; };
    const done = mv.every(q => at(q) || q.sup >= 60 || (q.order.t === 'hold' && S.t - q.movedT > 6) || q.order.t === 'charge');
    if (!done && S.t - F.bT < 25) { tfFormOrder(F, p, true); continue; }
    const front = Math.max(F.sE[0], F.sE[1]);
    if (front >= F.L) {   // 推进到冲击出发线：统一冲击
      F.ph = 'assault';
      const cx = us.reduce((a, g) => a + g.x, 0) / us.length, cy = us.reduce((a, g) => a + g.y, 0) / us.length;
      orderUnits(us, p.x, p.y, apAng(cx, cy, p.x, p.y), null, 'amove');
      for (const g of us) { P.u[g.id].ordT = S.t; P.u[g.id].dx = p.x; P.u[g.id].dy = p.y; }
      tfStat('fmAssault');
      if (typeof chatSay === 'function') chatSay('p', `命令：${us.map(tfUN).join('、')}已交替跃进 ${F.n + 1} 次推进至冲击出发线，向${p.name}发起冲击！`, { kind: 'order', at: p, key: 'tffm' + k, gap: 30, lv: 1 });
      continue;
    }
    F.lead = 1 - F.lead; F.sE[F.lead] = Math.min(F.L, front + TF_BOUND); F.bT = S.t; F.n++;
    tfFormOrder(F, p);
    tfStat('fmBound');
  }
}

// —— 态势简报（每 150 秒，用战线模型）——
function tfSitrep() {
  if (typeof frSummary !== 'function' || !S.front || typeof chatSay !== 'function') return;
  const f = frSummary();
  if (!f.w) return;
  const g = f.gaps.filter(o => o.w >= 120);
  chatSay('p', `判断：登陆场正面约 ${Math.round(f.w / 10) * 10} 米、纵深约 ${Math.round(f.depth / 10) * 10} 米，分 ${f.seg} 段${g.length ? `；${g.map(o => tfWhere(o.x, o.y) + '约 ' + Math.round(o.w / 10) * 10 + ' 米空隙').join('、')}` : '，正面连贯'}。`, { kind: 'report', key: 'tfsit', gap: 100, lv: 1 });
}

// 主攻地段（战线图上加粗）：指挥官主攻滩头所在地段中我兵力最强的一段；没有登陆计划时取接敌地段中兵力最强的
function tfMain() {
  const sec = typeof frSectors === 'function' ? frSectors() : null;
  if (!sec || !sec.length) return null;
  const pl = S.cmd && S.cmd.p && S.cmd.p.plan, main = pl && pl.main >= 0 ? pl.main : -1;
  let L = main >= 0 ? sec.filter(s => s.beach === main) : [];
  if (!L.length) L = sec.filter(s => s.kind === 'contact');
  if (!L.length) L = sec;
  return L.reduce((a, s) => s.pw > a.pw ? s : a).id;
}

function tfThink(dt) {
  if (!S || S.phase !== 'battle' || S.over || !tfOn()) return;
  const T = tfEnsure();
  if ((T.thinkT -= dt) > 0) return;
  T.thinkT = 1;
  if ((T.mainT = (T.mainT ?? 0) - 1) <= 0) { T.mainT = 5; T.main = tfMain(); }
  const P = S.autoPlan && S.autoPlan.u ? S.autoPlan : null;
  if (!P) return;
  for (const k in T.mass) if (!P.o[k] || S.t - T.mass[k].t0 > 120) delete T.mass[k];
  tfExpire(P); tfHelp(P); tfGap(P); tfScreen(); tfForm(P);
  if ((T.bindT -= 1) <= 0) { T.bindT = 3; tfBind(P); }
  if ((T.sitT -= 1) <= 0) { T.sitT = 150; tfSitrep(); }
}
HOOK.step.push(tfThink);
HOOK.newGame.push(function tfNewGame() { if (S) S.tf = null; });
