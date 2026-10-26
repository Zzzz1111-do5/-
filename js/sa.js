'use strict';
// 态势感知与边打边撤（双方每个团 hq.js regThink、每个战斗群 orbat.js bgThink、守方守备连 saGarrison）
// saLook(G)：每 3 秒看一次全局——
//   我方：本团（战斗群）战斗力，加上 450 以内友邻团 / 战斗群、守备部队的一半；
//   敌方：当面 320 以内看得见的敌人；敌人钻进林子看不见了不算没了——按 25 秒慢慢淡忘（记忆）；
//   趋势：敌兵力 15 秒内涨了三成以上（后续梯队上来了）按 1.25 倍算；
//   火力支援：攻方——驱逐舰舰炮够得着、垂发导弹还有、空中有对地支援机；守方——炮兵 / 迫击炮 / 自行火炮够得着；
//   地形：阵地的掩蔽（林地、城镇比开阔地好打）；
//   → 有效兵力比 odds，团长拿它跟战法表的 press（压上）/ ret（后撤）比：够了就打，不够就就地拖住，打不过就边打边撤；
//     打不过、本团又只剩三成五：脱离接触（break），两组一起撤、放烟幕，一口气撤到后方
// saDelay(G, L, slots)：边打边撤——全团按战斗队形分成两组交替：一组停在原地向追兵射击掩护，另一组后撤一跃（110）到掩护组身后再停下，然后互换；
//   正面始终朝着追兵。撤往：附近有比自己强的友邻（主力）就往主力那边撤，到它身边（260 以内）与主力汇合；
//   否则往本方的大后方——攻方往海边（驱逐舰舰炮、舰空导弹的保护伞下），守方往纵深（炮兵阵地、指挥所方向）；
//   一路每 12 秒对追兵的中心叫一次火力（攻方舰炮、垂发导弹、对地支援机；守方炮兵；101 空降师还能叫 B-2A），把追兵一点点消耗掉；
//   兵力比回到 ret × 1.3 以上（追兵被打掉、或与主力汇合）就停下重整再战；撤出 700 还没摆脱也转入重整
// saGarrison：守方不编团的守备连——据点还没丢、连队在阵地外（不在碉堡、城镇里）被三倍以上的敌人压上来，交替掩护退到据点后方的二线位置，
//   不在开阔地上被一口吃掉；退到位或兵力比好转就交还守军 AI（ai2.js 跳过 q.saFall 的组）
const SA = { r: 320, mem: 25, friend: 450, fw: .5, trendT: 15, trendK: 1.3, trendW: 1.25, bound: 110, swap: 24, fireGap: 12, link: 260, linkMax: 1200, maxW: 700, brk: .5, brkPw: .35, cover: .5, sup: .3, every: 3, smoke: 30 };
const saStat = (k, n = 1) => { if (typeof v8Stat === 'function') v8Stat(k, n); };
// 按方的协同参数（jointdoc.js saDoc：每跃距离、叫火力间隔、脱离接触线、汇合距离，联合训练场训练）
const saP = side => typeof saDoc === 'function' ? saDoc(side) : { bound: SA.bound, fire: SA.fireGap, brk: SA.brk, link: SA.link };

// 本方在 (x, y) 一带叫得到的火力支援（0–1）
function saSup(side, x, y) {
  let s = 0;
  if (side === 'p') {
    const dd = S.dd;
    if (dd && dd.state !== 'sunk' && isFinite(dd.x) && dist(dd.x, dd.y, x, y) < 980) s += .45;
    if (typeof vlsCan === 'function' && vlsCan('lacm', x, y)) s += .25;
    if ((S.planes || []).some(p => !p.dead && (p.kind === 'cas' || p.kind === 'strike') && (p.phase === 'out' || p.phase === 'loiter'))) s += .3;
  } else {
    for (const e of S.enemies) if (!e.dead && (e.kind === 'arty' || e.kind === 'mortar') && dist(e.x, e.y, x, y) < (e.kind === 'arty' ? 1500 : 650)) s += e.kind === 'arty' ? .3 : .15;
    for (const v of S.veh || []) if (v.side === 'e' && !v.dead && v.type === 'spg' && dist(v.x, v.y, x, y) < 1300) s += .2;
  }
  return Math.min(1, s);
}
// 团 / 战斗群的成员连（id 集合）——算友邻守备时不重复算
function saMembers() {
  const k = S.t;
  if (SA.memK === k) return SA.memS;
  const m = new Set();
  for (const G of S.bgs || []) if (!G.dead) for (const id of G.us) m.add(id);
  SA.memK = k; SA.memS = m;
  return m;
}
// 态势：返回 { odds 有效兵力比, raw 当面兵力比, ours, friends, theirs, rising, sup, cover, fx, fy 敌中心, main 可汇合的主力 }
function saLook(G, pw, near) {
  if (G.sa && S.t - G.sa.t < SA.every && G.sa.n0 === (near ? near.n : -1)) return G.sa;
  pw = pw || hqRegPow(G);
  near = near || hqFoe(G.side, G.ax, G.ay, SA.r);
  // 记忆：看不见的敌人按 25 秒淡忘
  const dt = Math.max(0, S.t - (G.saT ?? S.t));
  G.saM = Math.max(near.n, (G.saM || 0) * Math.exp(-dt / SA.mem));
  G.saT = S.t;
  if (near.n) { G.saFx = near.x; G.saFy = near.y; }
  // 趋势：15 秒前的敌兵力
  const H0 = G.saH || (G.saH = []);
  H0.push([Math.round(S.t), near.n]);
  while (H0.length > 2 && S.t - H0[1][0] >= SA.trendT) H0.shift();
  const old = H0[0][1], rising = S.t - H0[0][0] >= SA.trendT * .6 && near.n > old * SA.trendK + 3;
  // 友邻：别的团 / 战斗群（450 以内），守方另算阵地上的守备组；可汇合的主力 = 1200 以内比自己强、不在敌人那一边的团
  const mem = saMembers(), own = new Set(G.us);
  let fr = 0, main = null, mp = pw.tot * .8;
  const ex = G.saFx ?? G.ax + Math.cos(G.face) * 200, ey = G.saFy ?? G.ay + Math.sin(G.face) * 200, ea = Math.atan2(ey - G.ay, ex - G.ax);
  for (const O of S.bgs || []) {
    if (O === G || O.dead || O.side !== G.side) continue;
    const d = dist(O.ax, O.ay, G.ax, G.ay);
    if (d > SA.linkMax) continue;
    const P = hqRegPow(O).tot;
    if (d < SA.friend) fr += P;
    const toward = Math.cos(Math.atan2(O.ay - G.ay, O.ax - G.ax) - ea);   // 1：在敌人方向
    if (d > 150 && P > mp && toward < .35 && !(O.sa && O.sa.dec === 'delay')) { mp = P; main = O; }
  }
  for (const q of S.teams) if (q.side === G.side && q.men.length && !q.ride && !own.has(q.u) && !mem.has(q.u) && dist(q.x, q.y, G.ax, G.ay) < SA.friend * .7) fr += q.men.length * .7;
  const sup = saSup(G.side, ex, ey), cover = 1 - coverAt(G.ax, G.ay);
  const theirs = Math.max(1, G.saM) * (rising ? SA.trendW : 1), ours = pw.tot + fr * SA.fw;
  const odds = ours * (1 + SA.cover * cover) * (1 + SA.sup * sup) / theirs;
  return (G.sa = { t: S.t, n0: near.n, odds, raw: pw.tot / Math.max(1, near.n), ours: pw.tot, friends: fr, theirs: G.saM, rising, sup, cover, fx: ex, fy: ey, main, dec: G.sa ? G.sa.dec : null });
}
// 往哪儿撤：主力那边，否则大后方（攻方海边、守方纵深），同时背离追兵；落在可走的陆地上
function saRear(G, L) {
  if (L.main) return { x: L.main.ax, y: L.main.ay, link: L.main.id };
  const away = Math.atan2(G.ay - L.fy, G.ax - L.fx), home = G.side === 'p' ? Math.PI / 2 : -Math.PI / 2;
  const vx = Math.cos(away) * .7 + Math.cos(home), vy = Math.sin(away) * .7 + Math.sin(home), l = Math.hypot(vx, vy) || 1;
  let x = clamp(G.ax + vx / l * 500, 40, W - 40), y = clamp(G.ay + vy / l * 500, 40, H - 40);
  if (G.side === 'p') y = Math.min(y, coastAt(x) - 50);   // 攻方撤到海边为止，不下海
  if (!passInf(x, y)) { const j = nearestPassable(ci(x, y), G.side); if (j >= 0) { x = cellCX(j); y = cellCY(j); } }
  return { x, y, link: null };
}
// 对追兵叫火力
function saFire(G, L, why) {
  if (S.t - (G.saFT ?? -99) < saP(G.side).fire || !isFinite(L.fx)) return;
  G.saFT = S.t;
  const x = L.fx, y = L.fy;
  let ok = false;
  if (G.side === 'p') {
    if (typeof cmdFire === 'function' && S.cmd && S.cmd.p && cmdFire(x, y, 3, why || 'delay')) ok = true;
    const tk = (S.veh || []).filter(v => v.side === 'e' && !v.dead && inVision(v.x, v.y) && dist(v.x, v.y, x, y) < 160).sort((a, b) => bgPow(b) - bgPow(a))[0];
    if (tk && typeof vlsFire === 'function' && typeof vlsCan === 'function' && vlsCan('lacm', tk.x, tk.y) && vlsFire('lacm', tk.x, tk.y, 1, why || 'delay') > 0) ok = true;
    if (!ok && typeof cmdAir === 'function' && S.cmd && S.cmd.p && cmdAir('cas', x, y)) ok = true;
  } else {
    G.fireReq = { x: Math.round(x), y: Math.round(y), t: S.t, sa: true };   // 守方炮兵按 hqFocus 打（后撤掩护优先）
    ok = true;
    if (G.a101 && typeof b2Call === 'function') b2Call(x, y, G.name);
  }
  if (ok) saStat('saFire' + G.side);
}
// 在敌我之间放一道烟幕（掩护脱离接触，30 秒一次）
function saSmoke(G, L) {
  if (S.t - (G.saSmT ?? -99) < SA.smoke || !Array.isArray(S.smoke)) return;
  G.saSmT = S.t;
  const a = Math.atan2(L.fy - G.ay, L.fx - G.ax), d = Math.min(90, dist(G.ax, G.ay, L.fx, L.fy) * .45);
  S.smoke.push({ x: G.ax + Math.cos(a) * d, y: G.ay + Math.sin(a) * d, r: 70, until: S.t + 28 });
  saStat('saSmoke');
}
// 开始边打边撤：记下起点、撤往何处；break：脱离接触
function saDelayStart(G, L, brk) {
  const R0 = saRear(G, L);
  G.wd = { h: 0, t: S.t - 99, ov: null, x0: G.ax, y0: G.ay, rx: R0.x, ry: R0.y, link: R0.link, brk: !!brk, n: 0 };
  if (G.sa) G.sa.dec = 'delay';
  saFire(G, L, brk ? 'break' : 'delay');
  if (brk || L.theirs >= 12) saSmoke(G, L);
  saStat(brk ? 'saBreak' : 'saDelay');
  if (S.t - (G.saSayT ?? -99) < 40) return;   // 通联里同一个团 40 秒内只说一次
  G.saSayT = S.t;
  const Lm = R0.link != null && bgOf(R0.link), arty = G.side === 'e' && S.enemies.some(e => !e.dead && (e.kind === 'arty' || e.kind === 'mortar'));
  const to = Lm ? `向${Lm.name}靠拢、与主力汇合` : G.side === 'p' ? (typeof navGunUp === 'function' && navGunUp() ? '往海边撤到舰炮掩护下' : '往海边撤回滩头阵地') : arty ? '往纵深撤到炮兵掩护下' : '往纵深撤回二线阵地';
  if (typeof bgSay === 'function') bgSay(G, brk ? `${L.odds < 1 ? `伤亡过大、打不过（有效兵力比约 ${L.odds.toFixed(1)}）` : '本团伤亡过大、已无力再战'}，放烟幕脱离接触，${to}。` : `敌我有效兵力约 ${L.odds.toFixed(1)} 比 1，交替掩护、边打边撤，${to}，沿途叫火力消耗追兵。`, null, 'order', brk ? '放烟幕，脱离接触！' : '交替掩护，边打边撤！');
}
// 一步边打边撤：返回 { sl 带 t 的槽位, done 结束原因 }；slotsFn 给出当前锚点的战斗队形（regSlots / bgSlots）
function saDelay(G, L, slotsFn) {
  const D = G.wd || (saDelayStart(G, L), G.wd);
  // 正面朝追兵
  const fa = Math.atan2(L.fy - G.ay, L.fx - G.ax);
  G.face = G.face + clamp(Math.atan2(Math.sin(fa - G.face), Math.cos(fa - G.face)), -.35, .35);
  // 主力动了：跟着它
  const Lm = D.link != null ? bgOf(D.link) : null;
  if (Lm && !Lm.dead) { D.rx = Lm.ax; D.ry = Lm.ay; }
  const gTag = sl => { let i = 0; for (const s of sl) if (s.g == null) s.g = i++ % 2; return sl; };
  let sl = gTag(slotsFn());
  const key = s => s.k + s.m.id, posOf = s => s.k === 'u' ? regUnitAt(s.m) : [s.m.x, s.m.y];
  if (!D.ov) { D.ov = {}; for (const s of sl) if (s.g !== D.h) D.ov[key(s)] = posOf(s); }   // 第一跃：另一组原地掩护
  const mv = sl.filter(s => s.g === D.h), lag = mv.length ? bgLag(G, mv) : 0, dRear = dist(G.ax, G.ay, D.rx, D.ry);
  // 跃进到位（或时限到）：换组——刚到位的这组停下掩护，另一组从原地后撤一跃
  if ((lag < 35 && S.t - D.t > 5) || S.t - D.t > SA.swap || D.brk) {
    if (!D.brk) { D.ov = {}; for (const s of sl) if (s.g === D.h) D.ov[key(s)] = posOf(s); D.h ^= 1; }
    D.t = S.t; D.n++;
    if (dRear > 30) {
      const keep = G.face, x0 = G.ax, y0 = G.ay;
      const bd = saP(G.side).bound;
      bgAdvance(G, D.rx, D.ry, D.brk ? bd * 1.6 : bd);
      G.face = keep;
      if (!passInf(G.ax, G.ay)) { const j = nearestPassable(ci(G.ax, G.ay), G.side); if (j >= 0) { G.ax = cellCX(j); G.ay = cellCY(j); } }
      if (dist(x0, y0, G.ax, G.ay) < 5) D.stuck = (D.stuck || 0) + 1;
    }
    saFire(G, L);
    if (D.brk && L.theirs >= 6) saSmoke(G, L);
    sl = gTag(slotsFn());
  }
  // 掩护组：钉在原地（t hold）；后撤组：开到新锚点的队形位置（t move）；脱离接触时两组一起撤
  const out = sl.map(s => {
    const f = !D.brk && s.g !== D.h && D.ov[key(s)];
    return f ? { ...s, x: f[0], y: f[1], t: 'hold' } : { ...s, t: 'move' };
  });
  // 结束：兵力比好转（追兵被打掉 / 与主力汇合）、到了主力身边、撤够了、撤不动了
  let done = null;
  if (L.odds >= (G.saRet || .6) * 1.3 && S.t - (G.stT ?? 0) > 10) done = 'ok';
  else if (Lm && dist(G.ax, G.ay, Lm.ax, Lm.ay) < saP(G.side).link) done = 'link';
  else if (dist(G.ax, G.ay, D.x0, D.y0) > SA.maxW || (dRear < 40 && lag < 50 && D.n >= 2)) done = 'far';
  else if ((D.stuck || 0) >= 3) done = 'stuck';
  if (done) {
    saStat('saEnd_' + done);
    if (G.sa) G.sa.dec = null;
    G.wdEnd = S.t;
    if (typeof bgSay === 'function' && (done === 'link' || done === 'ok')) bgSay(G, done === 'link' ? `已与${Lm.name}汇合，就地展开，与主力一起打。` : done === 'ok' ? '追兵已被打退（或援兵已到），停止后撤，就地重整再战。' : '已撤到预定位置，就地重整。', null, 'order', done === 'link' ? '与主力汇合，展开！' : '停止后撤，就地重整！');
    G.wd = null;
  }
  return { sl: out, done, link: done === 'link' ? Lm : null };
}

// —— 守方守备连：在阵地外被压倒性的敌人压上来，交替掩护退到据点后方的二线 ——
function saGarrison() {
  if (!S || S.phase !== 'battle' || !S.ai) return;
  const mem = saMembers();
  for (const u of S.units) {
    if (u.side !== 'e' || u.state === 'rout' || mem.has(u.id) || u.a101 || u.role === 'bg') continue;
    const ts = teamsOf(u).filter(q => q.men.length && !q.ride && !q.afG && q.role !== 'ambush');
    if (!ts.length) continue;
    const F = u.saF;
    if (F && S.t < F.until) { saGarStep(u, ts, F); continue; }
    if (F) { for (const q of ts) q.saFall = null; u.saF = null; }
    const p = ptByKey(u.obj);
    if (!p || p.owner === 'p' || p.prog > .25) continue;   // 据点已丢：守军 AI 本来就退到集结位置
    const [cx, cy] = regUnitAt(u);
    if (dist(cx, cy, p.x, p.y) < 70) continue;   // 就在据点里：死守
    const inFort = ts.filter(q => coverAt(q.x, q.y) <= .55 || S.enemies.some(e => !e.dead && e.kind === 'bunker' && dist(e.x, e.y, q.x, q.y) < 30)).length;
    if (inFort >= ts.length * .6) continue;   // 大半在城镇 / 碉堡里：守
    const near = hqFoe('e', cx, cy, 230);
    if (near.n < 6) continue;
    const ours = ts.reduce((a, q) => a + q.men.length, 0);
    let fr = 0;
    for (const q of S.teams) if (q.side === 'e' && q.men.length && q.u !== u.id && dist(q.x, q.y, cx, cy) < 160) fr += q.men.length;
    if ((ours + fr * .6) / near.n >= .34) continue;
    // 二线：据点背向敌人一侧 110 处，挑掩蔽好的
    const away = Math.atan2(p.y - near.y, p.x - near.x);
    let best = null, bs = -1e9;
    for (let k = 0; k < 12; k++) {
      const a = away + (k / 12 - .5) * 1.6, r = 100 + (k % 3) * 25, x = clamp(p.x + Math.cos(a) * r, 15, W - 15), y = clamp(p.y + Math.sin(a) * r, 15, H - 15);
      if (!passInf(x, y)) continue;
      const sc = (1 - coverAt(x, y)) * 2 - dist(x, y, cx, cy) / 400;
      if (sc > bs) { bs = sc; best = { x, y }; }
    }
    if (!best) continue;
    u.saF = { x: best.x, y: best.y, fx: near.x, fy: near.y, h: 0, t: S.t, until: S.t + 45, key: p.key };
    saStat('saGar');
    if (typeof shout === 'function') shout(ts[0], '敌人太多，交替掩护退回二线！', { side: 'e' });
    saGarStep(u, ts, u.saF);
  }
}
// 守备连一步：半数组后撤（每 10 秒换一次），另一半原地射击；全到位就结束
function saGarStep(u, ts, F) {
  if (S.t - F.t > 10) { F.h ^= 1; F.t = S.t; }
  let done = true;
  ts.forEach((q, i) => {
    const a = (i / Math.max(1, ts.length)) * 6.283, gx = F.x + Math.cos(a) * 14, gy = F.y + Math.sin(a) * 14;
    q.saFall = { until: F.until };
    if (dist(q.x, q.y, gx, gy) < 12) { q.order = { t: 'hold' }; q.px = gx; q.py = gy; return; }
    done = false;
    if (i % 2 === F.h) { if (q.order.t !== 'move' || dist(q.order.x ?? 0, q.order.y ?? 0, gx, gy) > 10) aiGo(q, gx, gy, 'move', F.fx, F.fy); }
    else if (q.order.t !== 'hold') q.order = { t: 'hold' };   // 掩护：原地朝追兵射击
  });
  if (done) F.until = Math.min(F.until, S.t + 3);
}
HOOK.step.push(dt => { if (!S || S.phase !== 'battle') return; if ((SA.gT = (SA.gT ?? 0) - dt) <= 0) { SA.gT = SA.every; try { saGarrison(); } catch (e) { if (!SA.err) { SA.err = 1; console.error('sa', e); } } } });
