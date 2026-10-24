'use strict';
// 守军 AI（二）：威胁评估、兵力调度、反击、火炮/迫击炮火控
function aiThink(D) {
  const A = S.ai, radar = radarUp();
  const seenT = S.teams.filter(q => q.side === 'p' && spotted(q.x, q.y));
  const seenShips = S.ships.filter(s => alive(s) && s.state !== 'beached' && shipSeen(s.x, s.y, radar));
  const foes = S.teams.filter(q => q.side === 'e' && q.men.length && !(unitOf(q) && unitOf(q).state === 'rout'));
  for (const s of S.ships)
    if ((s.state === 'unloading' || s.state === 'beached') && spotted(s.bx, s.by) && !A.reg.some(r => dist(r.x, r.y, s.bx, s.by) < 50)) A.reg.push({ x: s.bx, y: s.by });

  // 威胁评估：看得见的我方兵力按距离加权
  const info = {};
  for (const p of S.points) {
    let th = 0, cx0 = 0, cy0 = 0, w = 0, near = 0;
    for (const q of seenT) {
      const d = dist(q.x, q.y, p.x, p.y);
      if (d < 350) { const k = (350 - d) / 350; th += q.men.length * k; cx0 += q.x * k; cy0 += q.y * k; w += k; }
      if (d < 120) near += q.men.length;
    }
    for (const v of S.veh || []) if (v.side === 'p' && !v.dead && !v.lst && spotted(v.x, v.y)) {   // 坦克：车组人数计入，威胁加权 1.5（火力远强于同样人数的步兵）
      const d = dist(v.x, v.y, p.x, p.y), c = vehCrew(v);
      if (d < 350) { const k = (350 - d) / 350; th += c * 1.5 * k; cx0 += v.x * k; cy0 += v.y * k; w += k; }
      if (d < 120) near += c;
    }
    for (const s of seenShips) {
      const d = dist(s.x, s.y, p.x, p.y);
      if (d < 450 && s.load.teams) { const k = (450 - d) / 450 * .6; th += s.load.teams * 3 * k; cx0 += s.x * k; cy0 += s.y * k; w += k; }
    }
    const def = foes.filter(q => q.obj === p.key).reduce((a, q) => a + q.men.length, 0);
    info[p.key] = { p, th, near, def, fx: w ? cx0 / w : p.x, fy: w ? cy0 / w : p.y + 250 };
  }
  const a4 = typeof a4On === 'function' && a4On() && !!(S.ai.co);   // v7 守方协同（ai4.js）：预备队整连机动、有计划的反冲击、借兵侧射
  if (a4) for (const k in info) S.ai.co.thr[k] = [Math.round(info[k].fx), Math.round(info[k].fy), +info[k].th.toFixed(1), info[k].near];
  for (const u of S.units) if (u.side === 'e' && u.state !== 'rout') {
    const I = info[u.obj];
    u.face = u.role === 'ambush' || !I || !I.th ? SOUTH : Math.atan2(I.fy - I.p.y, I.fx - I.p.x);
  }
  // 指挥官（commander.js）加权：判定的主攻方向加重、佯动方向减轻
  const bias = typeof cmdBias === 'function' ? cmdBias : () => 1;
  const need = k => (info[k].th * bias(k) + (info[k].p.owner === 'p' ? 8 : 0) + 1) / (info[k].def + 1) * Math.sqrt(info[k].p.vp);
  const keys = S.points.map(p => p.key);

  // 预备队与平静据点的多余守备流向压力最大处
  for (const q of foes) {
    if (q.order.t === 'amove' || q.order.t === 'retreat' || q.role === 'ambush' || !info[q.obj]) continue;
    if (typeof cmdHeld === 'function' && cmdHeld(q)) continue;   // 预备队尚未获准出动
    if (a4) continue;   // 有 ai4：预备队整连机动、平静据点的多余守备由远方抽调编成支队成建制机动，不再一组一组地抽（逐次添油）
    const k = keys.reduce((a, b) => need(b) > need(a) ? b : a);
    if (k === q.obj || need(k) < need(q.obj) * 1.5) continue;
    const spare = q.role === 'reserve' || (info[q.obj].th < 2 && foes.filter(o => o.obj === q.obj && o.role === 'garrison').length > 1);
    if (!spare || (a4 && Math.abs(info[k].p.x - info[q.obj].p.x) > 600)) continue;   // 守备只沿内线就近调剂
    info[q.obj].def -= q.men.length; info[k].def += q.men.length;
    Object.assign(q, { obj: k, role: 'reserve', px: null, u: aiUnitFor(k).id });
  }

  for (const q of foes) {
    // 散兵合并
    if (q.men.length === 1) {
      const m = foes.find(o => o !== q && o.men.length && o.men.length < 3 && dist(o.x, o.y, q.x, q.y) < 25);
      if (m) { m.men.push(...q.men); q.men = []; continue; }
    }
    // 滩头伏击组：被压倒性兵力接近时边打边撤到出口据点
    if (q.role === 'ambush') {
      const near = seenT.filter(p => dist(p.x, p.y, q.x, q.y) < 120).reduce((a, p) => a + p.men.length, 0);
      if (near > q.men.length * 2.5 || q.men.length === 1) {
        Object.assign(q, { role: 'garrison', hold: false, px: null });
        sayOnce('fall' + q.id, '滩头敌军正在后撤', .6, 'info', q);
      }
    }
  }

  // 反击或坚守
  for (const k of keys) {
    const I = info[k], p = I.p;
    let mine = foes.filter(q => q.obj === k && q.men.length > 1 && q.role !== 'ambush' && q.order.t !== 'retreat' && !(a4 && a4Busy(q)));
    const men = mine.reduce((a, q) => a + q.men.length, 0), lost = p.owner === 'p' || p.prog > .25;
    // 仓促反击：有计划反冲击的据点交给计划；否则至少两个组、人数够兵力比才出击（不一组一组地送）
    if (lost && !(a4 && a4OwnsPt(k)) && (a4 ? mine.length >= 2 && men >= Math.max(6, I.near * D.ratio) : men >= Math.max(4, I.near * D.ratio))) {
      // 指挥官：可能逐次投入（只出动一部分），受挫后集中兵力再统一反击
      const atk = (typeof cmdCounter === 'function' && cmdCounter(p, mine, men, I)) || mine, am = atk.reduce((a, q) => a + q.men.length, 0);
      const shaken = seenT.some(o => dist(o.x, o.y, p.x, p.y) < 90 && o.sup > 45);
      const t = shaken && am >= I.near * 1.5 ? 'charge' : 'amove';
      for (const q of atk) if (q.order.t !== t) { aiGo(q, p.x + gauss() * 15, p.y + gauss() * 15, t, p.x, p.y); q.px = null; }
      if (atk.length) sayOnce('atk' + k + Math.floor(S.t / 90), `截获敌方通讯片段：「……向${p.name}反击……」`, .5);
      if (atk.length === mine.length) continue;
      mine = mine.filter(q => !atk.includes(q));   // 未投入的组照常占位
    }
    for (const q of mine) {
      if (q.afG) continue;   // 机场常驻守备队守自己的外围阵地（afdef.js）
      if (q.order.t === 'amove' || q.order.t === 'charge') q.order = { t: 'hold' };
      if (q.order.t === 'move') continue;
      let spot = q.px != null ? { x: q.px, y: q.py } : null;
      if (lost) { if (!spot || dist(spot.x, spot.y, p.x, p.y) < 90) spot = stagingSpot(p, I); }
      else if (!spot || S.t - (q.posT || 0) > 15 || dist(spot.x, spot.y, p.x, p.y) > 70) { spot = aiSpot(q, p, I.fx, I.fy); q.posT = S.t; }
      q.px = spot.x; q.py = spot.y;
      if (dist(q.x, q.y, spot.x, spot.y) > 6) aiGo(q, spot.x, spot.y, 'move', p.x, p.y);
    }
  }
  aiArtillery(D, seenT, seenShips);
}

// 火控：按预期杀伤挑目标，移动目标打提前量，高价值目标多炮同时弹着，打完转移
function aiArtillery(D, seenT, seenShips) {
  const guns = S.enemies.filter(e => (e.kind === 'arty' || e.kind === 'mortar') && !e.dead && !e.moving && e.cd <= 0);
  if (!guns.length) return;
  const T = [];
  for (const s of seenShips) {
    const men = s.load.teams * 3 + s.load.eng, mv = s.state === 'move', a = s.heading;
    const v = s.state === 'unloading' ? (men + 6) * 1.5 : mv ? men + 2 : men * 1.2 + 2;
    T.push({ x: s.x, y: s.y, v, vx: mv ? Math.cos(a) * 26 : 0, vy: mv ? Math.sin(a) * 26 : 0, sea: true });
  }
  for (const q of seenT) {
    let m = 0;
    for (const o of seenT) if (dist(o.x, o.y, q.x, q.y) < 32) m += o.men.length;
    T.push({ x: q.x, y: q.y, v: m * .9 * coverAt(q.x, q.y) * (q.inTrench ? .6 : 1) + (q.kind === 'eng' ? (q.working ? 6 : 3) : 0), vx: 0, vy: 0 });
  }
  for (const L of S.supply) if (L.connected) {
    const g = L.segs[0], users = seenT.filter(q => dist(q.x, q.y, L.x, L.y) < 200).length;
    T.push({ x: (g.x0 + g.x1) / 2, y: (g.y0 + g.y1) / 2, v: 2 + users * 1.2, vx: 0, vy: 0, sea: true });
  }
  // 陆上补给网：被看见的补给站与运输线也是炮击目标
  if (typeof supplyTargets === 'function') for (const t of supplyTargets())
    if ((t.kind === 'node' || t.kind === 'edge') && spotted(t.x, t.y)) T.push({ x: t.x, y: t.y, v: 1.5 + (t.value || 1), vx: 0, vy: 0 });
  if (typeof abeArtyTargets === 'function') T.push(...abeArtyTargets());   // 被我方夺取的机场跑道（abn.js）
  for (const b of S.boats) if (!b.dead && spotted(b.x, b.y)) {
    const L = S.rlines.find(l => l.id === b.line), a = Math.atan2(L.y1 - L.y0, L.x1 - L.x0);
    T.push({ x: b.x, y: b.y, v: 4, vx: Math.cos(a) * 40, vy: Math.sin(a) * 40, sea: true });
  }
  const FO = typeof a4Focus === 'function' ? a4Focus() : null;   // 反冲击火力准备 / 延伸射击（ai4.js）
  if (FO) for (const t of T) if (dist(t.x, t.y, FO.x, FO.y) < FO.r) t.v = t.v * 3 + 4;
  for (const t of T) for (const sh of S.shells) if (sh.side === 'e' && dist(sh.x1, sh.y1, t.x, t.y) < 40) t.v *= .35;
  T.sort((a, b) => b.v - a.v);
  const used = new Set();
  for (const t of T) {
    if (t.v < 2) break;
    const n = t.v >= 10 ? 9 : t.v >= 5 ? 2 : 1;
    const reg = S.ai.reg.some(r => dist(r.x, r.y, t.x, t.y) < 60) ? .55 : 1;
    let fired = 0;
    for (const e of guns) {
      if (fired >= n || used.has(e)) continue;
      // 兵种修正 e.mod：rng 射程、pow 精度（散布反比）、rof 射速；shell 弹种、salvo 齐射发数（沙盒变体）
      const mortar = e.kind === 'mortar', M = e.mod || {}, range = (mortar ? 420 : 1100) * (M.rng || 1);
      if (dist(e.x, e.y, t.x, t.y) > range || (mortar && t.sea)) continue;
      const dur = mortar ? 2.2 : 3.2, err = D.err * reg * (mortar ? .8 : 1) / (M.pow || 1), ax = t.x + t.vx * dur * D.lead, ay = t.y + t.vy * dur * D.lead;
      const kind = POWER[M.shell] ? M.shell : mortar ? 'mortar' : 'arty', R0 = POWER[kind].R;
      if (ownNear('e', ax, ay, R0 + err * 1.6)) continue;   // 危险近距：自己人在散布范围内，换目标（火箭炮散布大，留的距离也大）
      for (let k = 0; k < (M.salvo || 1); k++) { const pt = safeAim('e', ax, ay, err, R0); if (pt) fireShell(e.x, e.y, pt[0], pt[1], 'e', kind, dur + k * .22, !inVision(e.x, e.y)); }
      e.cd = (mortar ? 5 + Math.random() * 2 : 8 + Math.random() * 3) / (M.rof || 1);
      e.salvos = (e.salvos || 0) + 1;
      if (e.salvos >= D.scoot + (mortar ? 1 : 0)) relocate(e);
      used.add(e); fired++;
    }
    if (fired > 1) log(`${fired} 个方向同时传来炮声，敌炮兵正在集火`, 'warn', 'tot', 20);
    if (used.size === guns.length) break;
  }
}
