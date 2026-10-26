'use strict';
// 战场侦察与态势判断（双方 AI 司令；hq.js hqStep 每 3 秒调用 rcThink，侦察分队每秒 rcStep）
// 为什么要有：两边各守一个点、隔得很远，谁也看不见谁——攻方旅打完预定目标就转入巩固，守方判明不了敌主攻方向就一直待机，全场卡住。
// ① 僵持：本方地面部队 RC.contact 以内一直没有看得见的敌人（沉寂），攻方 RC.quietP 秒、守方 RC.quietE 秒；
//    或者有接触，但据点 RC.stuck 秒没有易手（互相看着谁也不动）→ 判定敌情不明、战线僵持
// ② 派侦察分队：每个旅一个——优先侦察车（跑得快、看得远），其次步战车、反坦克车这类轻型车，都没有就从团里抽一个步兵组；
//    要看的目标：攻方——还没拿下的敌占据点（近 RC.stale 秒没看过的）；守方——被敌夺占的据点、各滩头出口；
//    观察点：目标朝我一侧 RC.opMin–RC.opMax、掩蔽好或地势高、离已知敌人 RC.foeR 以外；到了停下观察 RC.look 秒，报告「X一带敌约 N / 未见敌人」，
//    再去下一个目标；途中与敌接触（RC.foeR 以内出现敌人、挨打）：立即报告、掉头撤回，不恋战；看完或超时（RC.max 秒）归建回原来的团。
//    攻方另派侦察机 / 无人侦察机沿目标照相（甲板、战区机场有待命的）
// ③ 敌情图：每个据点记「一带的敌兵力估计、看到的时刻」，看见了就更新；侦察分队失去联络的地方至少记 RC.lostN
// ④ 定下决心（打破僵局）：
//    攻方——把空闲的旅（任务完成在巩固、或打不动退下来、附近没有敌人的）派去打「分值 × 兵力比 / 距离」最高的敌占据点；
//      一个旅兵力不够（不到敌估计的 RC.ratio 倍）就把空闲的旅集中起来打一处；还没看清的据点先侦察，侦察回来再定；
//      作战时间过了六成门槛放低到八成，过了八成只要有七成兵力也打（攻方拖下去就是败）
//    守方——侦察到的敌人照样记进司令的敌情记忆，据此判明敌主攻方向转入反击（hq.js hqCmdE）；
//      敌占据点兵力空虚（空闲机动旅兵力是它的 RC.ctr 倍以上）就派这个旅反冲击夺回；否则继续防御，隔 RC.again 秒再派侦察盯住敌人
//    派侦察与定下的决心由司令在通联里说出来（第一次派侦察与每个决心是大战术，之后再派只进详档）
// 状态（纯 JSON）：S.hq[side].rc = { q0 沉寂起点, sig 据点归属, flipT 上次易手, pat: [侦察分队], pt: { 据点 key: [估计兵力, 时刻] }, n 分队编号, t 上次派侦察, dT 上次定决心, spT 上次分兵, said }
//   侦察分队 = { id, k: 'v' | 't', oid 车 / 组 id, g 原团 id, b 旅 id, tg: [目标 {k, x, y, nm}], i, op: {x, y}, st: 'go' | 'look' | 'back', t0, tl, hp0, nm }
const RC = { quietP: 45, quietE: 70, stuck: 90, contact: 380, stale: 120, look: 10, max: 200, opMin: 240, opMax: 320, foeR: 200, lostN: 10, again: 90, dGap: 20,
  ratio: 1.2, conc: 1.2, ctr: 1.4, prior: 15, maxPat: 3, est: 340 };
const RC_VEH = { recon: 0, apc: 2, abv: 2, td: 3, lt_tank: 4, amtank: 5 };   // 侦察车优先，其次轻型车（数字越小越优先）；主战坦克、火炮、防空车不派
const rcStat = (k, n = 1) => { if (typeof v8Stat === 'function') v8Stat(k, n); };
const rcVis = side => side === 'e' ? spotted : inVision;
function rcEnsure(H) { return H.rc || (H.rc = { q0: null, pat: [], pt: {}, n: 0, t: -999, dT: -999, said: 0 }); }
const rcPat = side => S && S.hq && S.hq[side] && S.hq[side].rc ? S.hq[side].rc.pat : [];
// 侦察分队的车 / 组
function rcObj(P) {
  if (P.k === 'v') { const v = (S.veh || []).find(o => o.id === P.oid); return v && !v.dead ? v : null; }
  const q = S.teams.find(o => o.id === P.oid);
  return q && q.men.length ? q : null;
}
// 地面接触：本方在陆上的部队 RC.contact 以内有看得见的敌人（或据点一带双方都有人）
function rcContact(side) {
  const vis = rcVis(side), land = o => isLand(o.x, o.y);
  const us = [...S.teams.filter(q => q.side === side && q.men.length && !q.ride && land(q)), ...(S.veh || []).filter(v => v.side === side && !v.dead && !v.lst && land(v))];
  const them = [...S.teams.filter(q => q.side !== side && q.men.length && !q.ride && land(q)), ...(S.veh || []).filter(v => v.side !== side && !v.dead && !v.lst && land(v))].filter(o => vis(o.x, o.y));
  const r = RC.contact;
  for (const a of us) for (const b of them) if (Math.abs(a.x - b.x) < r && Math.abs(a.y - b.y) < r && dist(a.x, a.y, b.x, b.y) < r) return true;
  return false;
}
// 看得见的敌兵力（x, y 一带 r 以内）：步兵每人 1、车按战斗力；攻方另算已标定的工事（碉堡 6、其余 3）
function rcFoe(side, x, y, r) {
  const vis = rcVis(side);
  let n = 0;
  for (const q of S.teams) if (q.side !== side && q.men.length && !q.ride && dist(q.x, q.y, x, y) < r && vis(q.x, q.y)) n += q.men.length;
  for (const v of S.veh || []) if (v.side !== side && !v.dead && !v.lst && dist(v.x, v.y, x, y) < r && vis(v.x, v.y)) n += bgPow(v);
  if (side === 'p') for (const e of S.enemies) if (!e.dead && e.kx != null && e.kind !== 'airfield' && dist(e.kx, e.ky, x, y) < r) n += e.kind === 'bunker' ? 6 : 3;
  return n;
}
// 本方有没有眼睛看着 (x, y)：那里在本方视野里（附近有部队但视线被挡也不算——看不见里面就不能说「未见敌」）
const rcEyes = (side, x, y) => rcVis(side)(x, y);
// ③ 敌情图：看得见的据点一带记下敌兵力估计
function rcIntel(H, side) {
  const R = rcEnsure(H);
  for (const p of S.points) if (rcEyes(side, p.x, p.y)) R.pt[p.key] = [Math.round(rcFoe(side, p.x, p.y, RC.est)), Math.round(S.t)];
}
// 据点一带的敌兵力估计：近 2 × RC.stale 秒看过的取估计，没看过返回 null
const rcEst = (R, key) => { const m = R.pt[key]; return m && S.t - m[1] < RC.stale * 2 ? m[0] : null; };
// 要侦察的目标（近 RC.stale 秒没看过的）：攻方——没拿下的据点；守方——被敌夺占的据点、各滩头出口
function rcTargets(H, side) {
  const R = rcEnsure(H), out = [], stale = k => { const m = R.pt[k]; return !m || S.t - m[1] > RC.stale; };
  if (side === 'p') { for (const p of S.points) if (p.owner !== 'p' && stale(p.key)) out.push({ k: p.key, x: p.x, y: p.y, nm: p.name, w: (p.vp || 1) + (p.key === 'HQ' ? 2 : 0) }); }
  else {
    for (const p of S.points) if (p.owner === 'p' && stale(p.key)) out.push({ k: p.key, x: p.x, y: p.y, nm: p.name, w: (p.vp || 1) + 1 });
    for (let i = 0; i < TER.beaches.length; i++) {
      const E = typeof cmdExit === 'function' ? cmdExit(i) : null, p = E && hqPt(E.key);
      if (p && p.owner !== 'p' && stale(p.key) && !out.some(o => o.k === p.key)) out.push({ k: p.key, x: p.x, y: p.y + 120, nm: p.name + '以南', w: 1 });   // 出口外的滩头一带
    }
  }
  return out;
}
// 观察点：目标朝侦察分队一侧 RC.opMin–RC.opMax，可走、掩蔽好或地势高、离已知敌人 RC.foeR 以外
function rcOP(Hq, P, o, tg) {
  const a0 = Math.atan2(o.y - tg.y, o.x - tg.x), mem = Object.values(Hq.mem || {}), veh = P.k === 'v';
  let best = null, bs = -1e9;
  for (let k = 0; k < 18; k++) {
    const a = a0 + (k / 17 - .5) * 2.2, r = RC.opMin + (k % 3) * (RC.opMax - RC.opMin) / 2, x = clamp(tg.x + Math.cos(a) * r, 30, W - 30), y = clamp(tg.y + Math.sin(a) * r, 30, H - 30);
    if (!isLand(x, y) || !(veh ? vehPass(x, y, o.side === 'e' ? 'vehe' : 'veh') : passInf(x, y))) continue;
    if (mem.some(m => dist(m[0], m[1], x, y) < RC.foeR)) continue;
    const sc = (1 - coverAt(x, y)) * 2 + (TER.elev[ci(x, y)] || 0) * 2 - dist(x, y, o.x, o.y) / 600 + Math.random() * .2;
    if (sc > bs) { bs = sc; best = { x: Math.round(x), y: Math.round(y) }; }
  }
  return best || { x: Math.round(tg.x + Math.cos(a0) * RC.opMax), y: Math.round(tg.y + Math.sin(a0) * RC.opMax) };
}
// 从旅里挑侦察分队：先挑车（侦察车优先），没有就从没在打仗的团里抽一个步兵组
function rcPick(side, B) {
  const Rs = hqRegs(side, B).filter(G => !['assault', 'deploy', 'local', 'withdraw', 'clear'].includes(G.st));
  let best = null, bs = 99;
  for (const G of Rs) for (const v of bgVehs(G)) {
    const r = RC_VEH[v.type];
    if (r == null || v.rc || v.hp < v.maxhp * .6 || (v.fuel ?? 1) < .3 || v.ride && v.ride.length || !isLand(v.x, v.y)) continue;
    if (r < bs) { bs = r; best = { k: 'v', o: v, G }; }
  }
  if (best) return best;
  for (const G of Rs) for (const u of bgUnits(G)) {
    const ts = teamsOf(u).filter(q => q.men.length >= 2 && !q.ride && !q.rc && isLand(q.x, q.y) && !q.men.includes('aa'));
    if (ts.length >= 2) return { k: 't', o: ts.sort((a, b) => a.men.length - b.men.length)[0], G };   // 连里至少留下一个组
  }
  return null;
}
// ② 派侦察：每个旅一个分队，分到最近的一两个目标；攻方另派侦察机
function rcLaunch(H, side, quiet, stuck) {
  const R = rcEnsure(H), T = rcTargets(H, side);
  if (!T.length) return 0;
  const busy = new Set(R.pat.flatMap(P => P.tg.map(t => t.k)));
  let left = T.filter(t => !busy.has(t.k)).sort((a, b) => b.w - a.w), n = 0;
  for (const B of H.bdes) {
    if (!left.length || R.pat.length >= RC.maxPat || R.pat.some(P => P.b === B.id)) continue;
    const c = hqBdeAt(B);
    if (!c) continue;
    const pk = rcPick(side, B);
    if (!pk) continue;
    left.sort((a, b) => dist(a.x, a.y, c.x, c.y) / a.w - dist(b.x, b.y, c.x, c.y) / b.w);
    const tg = left.splice(0, Math.min(2, left.length));
    const o = pk.o, P = { id: ++R.n, side, k: pk.k, oid: o.id, g: pk.G.id, b: B.id, tg, i: 0, op: null, st: 'go', t0: S.t, tl: 0, hp0: o.hp ?? null, nm: `${B.name}侦察分队` };
    o.rc = P.id;
    P.op = rcOP(H, P, o, tg[0]);
    R.pat.push(P); n++;
    rcStat('rcPat' + side);
    if (typeof shout === 'function') shout(o, `侦察分队出发，看清${tg[0].nm}！`, { side });
  }
  // 攻方：侦察机 / 无人侦察机照相（沿目标飞越）
  let plane = false;
  if (side === 'p' && typeof launchPlane === 'function' && S.air && S.air.wing.some(w => w.type === 'recon' && w.state === 'deck') && T[0]) {
    const tg = T.slice().sort((a, b) => b.w - a.w)[0];
    if (launchPlane('recon', tg.x, tg.y)) { rcStat('rcPlane'); n++; plane = true; }
  }
  if (!n) return 0;
  R.t = S.t;
  const nm = [...new Set(R.pat.flatMap(P => P.tg.map(t => t.nm)))].slice(0, 4).join('、');
  const txt = `${stuck ? `战线僵持已 ${Math.round(quiet)} 秒、据点没有易手` : `战场沉寂已 ${Math.round(quiet)} 秒`}，敌情不明。各旅派出侦察分队（${R.pat.length} 个）前出侦察${nm}一带${plane ? '，侦察机沿线照相' : ''}，查明敌情后再定下一步决心。`;
  if (!R.said++) hqBig(side, 'rc' + R.n, txt); else hqSay(side, null, txt);
  return n;
}
// 报告：目标一带的敌情记进敌情图；chat 进详档
function rcReport(H, P, tg, contact) {
  const R = rcEnsure(H), n = Math.round(rcFoe(P.side, tg.x, tg.y, RC.est));
  if (tg.k && hqPt(tg.k)) R.pt[tg.k] = [Math.max(n, contact ? 4 : 0), Math.round(S.t)];
  rcStat('rcRep' + P.side);
  const txt = contact ? `${P.nm}报告：在${hqWhere(P.x ?? tg.x, P.y ?? tg.y)}与敌接触，当面敌约 ${Math.max(n, contact)} 人（车按战斗力折算），正在撤回。` : n ? `${P.nm}报告：${tg.nm}一带发现敌约 ${n} 人（车按战斗力折算）。` : `${P.nm}报告：${tg.nm}一带未发现敌人。`;
  if (typeof chatSay === 'function') chatSay(P.side, txt, { kind: 'intel', at: { x: tg.x, y: tg.y }, lv: 2 });
}
// 侦察分队每秒：开到观察点 → 观察 → 报告 → 下一个目标 → 归建；接敌就撤
function rcStep(dt) {
  if (!S || S.phase !== 'battle' || S.over || !S.hq) return;
  if ((RC.stT = (RC.stT ?? 0) - dt) > 0) return;
  RC.stT = 1;
  for (const side of ['p', 'e']) {
    const H = S.hq[side];
    if (!H || !H.rc || !H.rc.pat.length) continue;
    const R = H.rc;
    for (const P of R.pat) {
      const o = rcObj(P);
      if (!o) {   // 失去联络：那里有敌人
        const tg = P.tg[Math.min(P.i, P.tg.length - 1)];
        if (P.st !== 'back' && tg && tg.k) R.pt[tg.k] = [Math.max(RC.lostN, (R.pt[tg.k] || [0])[0]), Math.round(S.t)];
        if (typeof chatSay === 'function') chatSay(side, `${P.nm}在${tg ? tg.nm : '前方'}一带失去联络，判断该处有敌。`, { kind: 'intel', at: tg || undefined, lv: 2 });
        rcStat('rcLost' + side);
        P.done = true;
        continue;
      }
      P.x = Math.round(o.x); P.y = Math.round(o.y);
      const tg = P.tg[P.i];
      // 接敌：RC.foeR 以内看得见敌人、或挨打 → 报告，掉头
      if (P.st !== 'back') {
        const n = rcFoe(side, o.x, o.y, RC.foeR), hit = P.k === 't' ? o.sup > 35 : P.hp0 != null && o.hp < P.hp0 - .5;
        if (n >= 2 || hit) { rcReport(H, P, tg || { x: o.x, y: o.y, nm: hqWhere(o.x, o.y) }, Math.max(1, n)); P.st = 'back'; rcStat('rcContact' + side); }
      }
      if (P.st !== 'back' && S.t - P.t0 > RC.max) P.st = 'back';
      if (P.st === 'go') {
        if (dist(o.x, o.y, P.op.x, P.op.y) < 25) { P.st = 'look'; P.tl = S.t; }
        else rcGo(P, o, P.op.x, P.op.y, tg);
      } else if (P.st === 'look') {
        rcHold(P, o, tg);
        if (S.t - P.tl >= RC.look) {
          rcReport(H, P, tg, 0);
          if (++P.i < P.tg.length) { P.st = 'go'; P.op = rcOP(H, P, o, P.tg[P.i]); }
          else P.st = 'back';
        }
      }
      if (P.st === 'back') {
        const G = bgOf(P.g), B = H.bdes.find(b => b.id === P.b), home = G && !G.dead ? { x: G.ax, y: G.ay } : (B && hqBdeAt(B)) || hqNearPt(side, o, () => true) || o;
        if (dist(o.x, o.y, home.x, home.y) < 70) P.done = true;
        else rcGo(P, o, home.x, home.y, null);
      }
      if (P.done) rcFree(P, o);
    }
    if (R.pat.some(P => P.done)) R.pat = R.pat.filter(P => !P.done);
  }
}
function rcGo(P, o, x, y, tg) {
  if (P.k === 'v') { o.cmd = { x, y, t: 'move', face: tg ? Math.atan2(tg.y - o.y, tg.x - o.x) : o.heading, until: S.t + 3, ai: 'rc' }; return; }
  if (o.order.t !== 'move' || o.order.x == null || dist(o.order.x, o.order.y, x, y) > 12) aiGo(o, x, y, 'move', tg ? tg.x : x, tg ? tg.y : y);
}
function rcHold(P, o, tg) {
  if (P.k === 'v') { o.cmd = { x: o.x, y: o.y, t: 'move', face: tg ? Math.atan2(tg.y - o.y, tg.x - o.x) : o.heading, until: S.t + 3, ai: 'rc' }; return; }
  if (o.order.t !== 'hold') o.order = { t: 'hold' };
}
// 归建：交还原来的团（团的队形、命令照常接管）
function rcFree(P, o) {
  if (!o) return;
  o.rc = null;
  if (P.k === 'v') o.cmd = null;
  else { o.order = { t: 'hold' }; const u = UNIT_MAP.get(o.u); if (u) u.bgX = null; }
}
// 守方：空闲机动旅能不能反冲击夺回兵力空虚的敌占据点
function rcDecideE(H) {
  const R = rcEnsure(H), out = [];
  const taken = new Set(H.bdes.filter(B => B.ord && B.ord.v === 'counter' && !B.ord.done).map(B => (hqObj(B) || {}).key));
  for (const B of H.bdes) {
    if (B.spent || B.res || (B.ord && B.ord.v === 'counter' && !B.ord.done)) continue;
    const Rs = hqRegs('e', B);
    if (!Rs.length || Rs.some(G => (G.sa && G.sa.theirs >= 3) || ['assault', 'deploy', 'local', 'withdraw'].includes(G.st))) continue;
    const pw = Rs.reduce((a, G) => a + hqRegPow(G).tot, 0), c = hqBdeAt(B);
    let best = null, bs = 0;
    for (const p of S.points) {
      if (p.owner !== 'p' || taken.has(p.key)) continue;
      const e = rcEst(R, p.key);
      if (e == null || pw < e * RC.ctr + 6) continue;
      const s = (p.vp || 1) * Math.min(2, pw / (e + 4)) / (1 + dist(c.x, c.y, p.x, p.y) / 1500);
      if (s > bs) { bs = s; best = { p, e }; }
    }
    if (!best) continue;
    taken.add(best.p.key);
    if (hqOrder('e', B, { v: 'counter', objs: [best.p.key], rc: true }, `侦察查明${best.p.name}之敌约 ${best.e} 人、兵力空虚。向${best.p.name}反冲击，夺回据点。`)) out.push(`${B.name}反冲击${best.p.name}（敌约 ${best.e}）`);
  }
  return out;
}
// 攻方：空闲的旅转兵进攻；一个旅不够就集中几个旅打一处
function rcDecideP(H, calm) {
  // 时间过了六成门槛放低到八成；过了八成（再拖就输了）只要有七成兵力也打——攻方拖下去就是败
  const R = rcEnsure(H), out = [], lim = typeof LIMIT === 'number' ? LIMIT : 2700, late = S.t > lim * .6, k = S.t > lim * .8 ? .58 : late ? .8 : 1, ratio = RC.ratio * k;
  // 空闲：任务完成在巩固（或进攻打了两分钟没进展），各团没在冲击、展开、后撤，附近没有压上来的敌人（当面敌人很弱的不算）
  const free = B => {
    const Rs = hqRegs('p', B);
    if (!Rs.length || Rs.some(G => (G.sa && G.sa.theirs >= 3 && G.sa.odds < 2) || ['assault', 'deploy', 'local', 'withdraw', 'clear', 'move'].includes(G.st))) return false;
    if (!B.ord || (B.ord.done && S.t - B.ord.done >= 30)) return true;   // 拿下目标巩固半分钟后
    return calm && B.ord.v !== 'feint' && S.t - (B.ordT ?? 0) > 120;   // 僵持时：进攻打了两分钟没进展、跟进待命太久的也转用
  };
  const atHQ = B => B.ord && B.ord.done && (hqObj(B) || {}).key === 'HQ';   // 守着指挥所的旅：不整个调走
  let idle = H.bdes.filter(B => free(B) && !atHQ(B));
  if (!idle.length && S.t - (R.spT ?? -99) > 90) {   // 都挤在指挥所：分出一部去夺外围据点（攻方要占七成据点分值才算赢）
    const B = H.bdes.filter(B => free(B) && atHQ(B) && hqRegs('p', B).length >= 2)[0], nb = B && rcSplitP(H, B);
    if (nb) { R.spT = S.t; idle = [nb]; out.push(`${B.name}留一部坚守指挥所，分出${nb.name}（${hqRegs('p', nb).length} 个团）夺取外围据点`); }
  }
  if (!idle.length) return out;
  const pending = R.pat.length > 0;   // 侦察分队还在外面：没看清的据点先等报告
  const T = S.points.filter(p => p.owner !== 'p').map(p => { const e = rcEst(R, p.key); return { p, e: e ?? RC.prior, known: e != null }; }).filter(o => o.known || !pending);
  if (!T.length) return out;
  const pw = B => hqRegs('p', B).reduce((a, G) => a + hqRegPow(G).tot, 0), cen = B => hqBdeAt(B) || B.home;
  const score = (o, P, c) => (o.p.vp || 1) * (o.p.key === 'HQ' ? 1.5 : 1) * Math.min(2, P / (o.e + 4)) / (1 + dist(c.x, c.y, o.p.x, o.p.y) / 1500) * (o.known ? 1 : .7);
  const used = new Set(), left = idle.slice().sort((a, b) => pw(b) - pw(a));
  for (const B of left) {
    const P = pw(B), c = cen(B);
    let best = null, bs = 0;
    for (const o of T) if (!used.has(o.p.key) && P >= (o.e + 4) * ratio) { const s = score(o, P, c); if (s > bs) { bs = s; best = o; } }
    if (!best) continue;
    used.add(best.p.key);
    if (hqOrder('p', B, { v: 'attack', objs: [best.p.key] }, `${best.known ? `侦察查明${best.p.name}之敌约 ${best.e} 人` : `${best.p.name}敌情不明`}，我旅兵力足够。转兵攻击${best.p.name}。`, true)) { out.push(`${B.name}攻击${best.p.name}（敌约 ${best.known ? best.e : '?'}）`); B.rcGo = S.t; }
  }
  // 单个旅都不够：空闲的旅集中起来打一处（最强的旅主攻、其余同时攻击同一目标）
  const rest = left.filter(B => B.rcGo !== S.t);
  if (rest.length >= 2 && !out.length) {
    const P = rest.reduce((a, B) => a + pw(B), 0), c = cen(rest[0]);
    let best = null, bs = 0;
    for (const o of T) if (!used.has(o.p.key) && P >= (o.e + 4) * RC.conc * k) { const s = score(o, P, c); if (s > bs) { bs = s; best = o; } }
    if (best) {
      for (const B of rest) if (hqOrder('p', B, { v: 'attack', objs: [best.p.key] }, `各旅兵力单独都不够，集中力量会攻${best.p.name}（敌约 ${best.known ? best.e : '?'}）。`, true)) B.rcGo = S.t;
      out.push(`${rest.map(B => B.name).join('、')}集中会攻${best.p.name}（敌约 ${best.known ? best.e : '?'}）`);
    }
  }
  return out;
}
// 守着指挥所的旅一分为二：最强的三分之一（至少一个团）留下坚守，其余编成一个新旅出去打
function rcSplitP(H, B) {
  const Rs = hqRegs('p', B).sort((a, b) => hqRegPow(b).tot - hqRegPow(a).tot);
  if (Rs.length < 2) return null;
  const keep = Math.max(1, Math.floor(Rs.length / 3)), go = Rs.slice(keep), no = H.bdes.length + 1;
  const nb = hqNewBde('p', no, `第${no}旅`, 'main', { x: go[0].ax, y: go[0].ay });
  for (const G of go) { G.bde = nb.id; nb.regs.push(G.id); B.regs = B.regs.filter(id => id !== G.id); }
  rcStat('rcSplit');
  hqSay('p', nb, `从${B.name}分出 ${go.length} 个团编成${nb.name}，出去夺取外围据点；${B.name}留 ${keep} 个团坚守指挥所。`);
  return nb;
}
// 司令每 3 秒：更新敌情图、判断战场是否沉寂、派侦察、定决心
function rcThink(H, side) {
  if (!H || !H.live) return;
  const R = rcEnsure(H);
  rcIntel(H, side);
  const ashore = S.teams.some(q => q.side === 'p' && q.men.length && !q.ride && isLand(q.x, q.y));
  if (!ashore) { R.q0 = null; R.flipT = S.t; return; }   // 还没上岸：不算沉寂
  // 两种僵持：没有接触（沉寂），或者有接触但据点 RC.stuck 秒没有易手（互相看着谁也不动）
  const sig = S.points.map(p => p.owner === 'p' ? 1 : 0).join('');
  if (R.sig !== sig) { R.sig = sig; R.flipT = S.t; }
  if (rcContact(side)) R.q0 = null; else if (R.q0 == null) R.q0 = S.t;
  const quiet = R.q0 == null ? 0 : S.t - R.q0, stuck = S.t - (R.flipT ?? S.t), need = side === 'p' ? RC.quietP : RC.quietE, calm = quiet >= need || stuck >= RC.stuck;
  // 派侦察（僵持时）：敌情不明的目标还有、外面的侦察分队不够、上次派出去已过 RC.again 秒（分队都回来了就隔一半）
  if (calm && S.t - R.t > (R.pat.length ? RC.again : RC.again / 2) && R.pat.length < RC.maxPat) rcLaunch(H, side, Math.max(quiet, stuck), quiet < need);   // 分队都回来（或折损）了也至少隔 45 秒再派
  // 定决心：上次决心后 RC.dGap 秒；攻方的空闲旅随时转用（攻方要的是进展），守方只在僵持时
  if (S.t - R.dT < RC.dGap || (side === 'e' && !calm)) return;
  const dec = side === 'p' ? rcDecideP(H, calm) : rcDecideE(H);
  if (!dec.length) return;
  R.dT = S.t; R.q0 = S.t; R.flipT = S.t;   // 下了决心：沉寂、僵持重新计时
  rcStat('rcDecide' + side);
  // 常规通联只播大的：分兵、集中会攻，或离上次大决心两分钟以上；其余进详档
  const txt = `据侦察判明当面敌情，打破僵持：${dec.join('；')}。`;
  if (S.t - (R.bigT ?? -999) > 120 || dec.some(d => /集中|分出/.test(d))) { R.bigT = S.t; hqBig(side, 'rcd' + Math.round(S.t), txt); } else hqSay(side, null, txt);
}
HOOK.step.push(rcStep);

// —— 画面：侦察分队（眼睛标记 + 去观察点的虚线）、据点上的敌情标注（侦：敌≈N）——观战时双方都画，平时只画看得见的 ——
function rcDraw() {
  if (!S || !S.hq || (typeof V3 === 'object' && V3.drawing && false)) return;
  const spec = S.role === 'spectate' || R.eye === 'all' || R.eye === 'both' || R.eye === 'e', ctx = R.ctx;
  ctx.save();
  for (const side of ['p', 'e']) {
    const H = S.hq[side];
    if (!H || !H.rc || (side === 'e' && !spec) || (side === 'p' && S.role !== 'spectate')) continue;
    const col = side === 'p' ? COL.g : COL.enemy;
    for (const P of H.rc.pat) {
      const o = rcObj(P);
      if (!o || !inView(o.x, o.y, 300)) continue;
      const tx = P.st === 'back' ? null : P.op;
      if (tx) { ctx.strokeStyle = rgba(col, .55); ctx.lineWidth = px(1.2); ctx.setLineDash([px(4), px(4)]); ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(tx.x, tx.y); ctx.stroke(); ctx.setLineDash([]); }
      // 眼睛标记
      const x = o.x, y = o.y - px(16), w = px(8), h = px(4.5);
      ctx.fillStyle = rgba(COL.bg, .85); ctx.beginPath(); ctx.ellipse(x, y, w + px(2), h + px(2), 0, 0, 6.283); ctx.fill();
      ctx.strokeStyle = rgba(col, .95); ctx.lineWidth = px(1.2);
      ctx.beginPath(); ctx.moveTo(x - w, y); ctx.quadraticCurveTo(x, y - h * 2, x + w, y); ctx.quadraticCurveTo(x, y + h * 2, x - w, y); ctx.stroke();
      ctx.fillStyle = rgba(col, .95); ctx.beginPath(); ctx.arc(x, y, px(2), 0, 6.283); ctx.fill();
      if (R.zr > 1.6) { ctx.font = font(9); ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText(P.st === 'back' ? '侦察·撤回' : P.st === 'look' ? '侦察·观察' : '侦察', x, y - h - px(3)); }
    }
    // 敌情标注：近 RC.stale 秒侦察到的据点
    ctx.font = font(9); ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (const p of S.points) {
      const m = H.rc.pt[p.key];
      if (!m || S.t - m[1] > RC.stale || (side === 'p' ? p.owner === 'p' : p.owner !== 'p') || !inView(p.x, p.y, 80)) continue;
      const t = `侦：${m[0] ? `敌≈${m[0]}` : '未见敌'}`, yy = p.y + px(side === 'p' ? 18 : 30), w2 = ctx.measureText(t).width + px(6);
      ctx.globalAlpha = clamp(1 - (S.t - m[1]) / RC.stale, .35, 1);
      ctx.fillStyle = rgba(COL.bg, .75); ctx.fillRect(p.x - w2 / 2, yy - px(1), w2, px(12));
      ctx.fillStyle = rgba(col, .95); ctx.fillText(t, p.x, yy);
      ctx.globalAlpha = 1;
    }
  }
  ctx.restore();
}
HOOK.drawOver.push(rcDraw);
