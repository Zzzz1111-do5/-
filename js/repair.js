'use strict';
// 步兵抢修补给线：工兵不在位时，普通步兵也能修浮桥断段、接通运输线、重建被毁的补给点（速度约为工兵的四成）。
// 一、被动：坚守中的步兵小组正站在断点上（16 以内）就顺手抢修；
// 二、主动：断点 10 秒无工兵处理，从附近自动指挥的连队抽一个小组前去抢修，修好后归建。
// 状态：S.rep = { since: {断点键: 首次发现时刻}, det: {断点键: 小组 id} }；小组 q.detail = {k, kind, ...}
const RP_RATE = .42, RP_WAIT = 10, RP_REACH = 700;

function rpEnsure() { if (!S.rep) S.rep = { since: {}, det: {} }; return S.rep; }

// 当前所有断点：浮桥断段、陆上运输线断点、被毁的补给点
function rpBreaks() {
  const out = [];
  for (const L of S.supply) L.segs.forEach((g, i) => { if (!g.ok) out.push({ k: 's' + L.id + '_' + i, kind: 'seg', L, g, x: (g.x0 + g.x1) / 2, y: (g.y0 + g.y1) / 2 }); });
  if (S.snet && Array.isArray(S.snet.nodes) && typeof snLive === 'function') for (const n of S.snet.nodes) {
    if (snLive(n) && n.cut) { const m = snMid(n); out.push({ k: 'e' + n.id, kind: 'edge', n, x: m[0], y: m[1] }); }
    else if (n.dead) out.push({ k: 'n' + n.id, kind: 'node', n, x: n.x, y: n.y });
  }
  return out;
}
// 工兵是否已在处理：本线工兵在抢修，或有工兵小组在断点附近 / 工兵连的任务就是它
function rpEngOn(b) {
  if (b.kind === 'seg') { const e = S.teams.find(q => q.id === b.L.eng && q.men.length); if (e && e.repairing) return true; }
  for (const q of S.teams) if (q.side === 'p' && q.kind === 'eng' && q.men.length && dist(q.x, q.y, b.x, b.y) < 60) return true;
  const P = S.autoPlan && S.autoPlan.u;
  if (P) for (const id in P) {
    const j = P[id] && P[id].job, u = UNIT_MAP.get(+id);
    if (!j || !u || !teamsOf(u).some(q => q.kind === 'eng' && q.men.length)) continue;   // 工兵连已打光：它的旧任务不算
    if (j.k === b.k || (b.kind === 'seg' && j.k === 'pontoon' + b.L.id)) return true;
  }
  return false;
}
const rpFoeNear = (x, y, r) => S.teams.some(o => o.side === 'e' && o.men.length && dist(o.x, o.y, x, y) < r);
const rpName = b => b.kind === 'seg' ? '浮桥' : b.kind === 'edge' ? '运输线' : '补给点';

// 推进一个断点的修理进度（rate 为人数折算后的速度）；修好返回 true
function rpWork(b, rate, who) {
  if (b.kind === 'seg') {
    b.g.rep = (b.g.rep || 0) + rate / 5;
    if (b.g.rep >= 1) { b.g.ok = true; b.g.rep = 0; log(`${who}修复了一段浮桥补给线`, 'good', 'rpseg', 3, b); return true; }
  } else if (b.kind === 'edge') {
    b.n.rep = (b.n.rep || 0) + rate / 5;
    if (b.n.rep >= 1) { b.n.cut = false; b.n.rep = 0; b.n.sab = 0; log(`${who}接通了一段运输线`, 'good', 'rpedge', 4, b); return true; }
  } else {
    b.n.built = Math.min(1, (b.n.built || 0) + rate / 15);
    if (b.n.built >= 1) { Object.assign(b.n, { dead: false, hp: b.n.maxhp, cut: false, rep: 0, sab: 0 }); log(`${who}重建了前沿补给点`, 'good', 'rpnode', 4, b); return true; }
  }
  return false;
}

// 浮桥在海上：先沿陆路回到滩头补给站，再沿浮桥直走到断点（同工兵的走法）
function rpWalk(q, L, x, y, dt) {
  let tx = x, ty = y;
  if (isLand(q.x, q.y) && dist(q.x, q.y, L.x, L.y) > 40) {
    const f = field(L.x, L.y, 'p'), n = f && nextStep(f, q.x, q.y);
    if (n) [tx, ty] = n; else { tx = L.x; ty = L.y; }
  }
  const d = dist(q.x, q.y, tx, ty), sp = Math.min(d, 20 * dt);
  if (d > .5) { q.x += (tx - q.x) / d * sp; q.y += (ty - q.y) / d * sp; q.movedT = S.t; q.heading = Math.atan2(ty - q.y, tx - q.x); }
  return dist(q.x, q.y, x, y);
}

function rpRelease(q, back) {
  const R0 = rpEnsure();
  if (q.detail) delete R0.det[q.detail.k];
  q.detail = null; q.repairing = false; q.working = false;
  if (!back) return;
  const u = unitOf(q);   // 归建：回到本连附近，等下一道命令
  if (u && u.x != null && field(u.x, u.y, 'p')) q.order = { t: 'move', x: u.x + gauss() * 8, y: u.y + gauss() * 8, gx: u.x, gy: u.y };
  else q.order = { t: 'hold' };
}

function updateRepair(dt) {
  if (!S || S.phase !== 'battle') return;
  const R0 = rpEnsure(), B = rpBreaks(), byK = new Map(B.map(b => [b.k, b]));
  // 已修好的断点清掉计时；派出的小组完成任务归建
  for (const k in R0.since) if (!byK.has(k)) delete R0.since[k];
  for (const b of B) if (R0.since[b.k] == null) R0.since[b.k] = S.t;
  for (const q of S.teams) {
    if (q.side !== 'p' || !q.detail) continue;
    const b = byK.get(q.detail.k), u = unitOf(q), D = q.detail;
    if (D.back) {   // 浮桥上的小组：先沿浮桥走回滩头补给站，再归建
      const L = S.supply.find(l => l.id === D.lid);
      if (!L || !q.men.length || rpWalk(q, L, L.x, L.y - 6, dt) < 3 || isLand(q.x, q.y) && dist(q.x, q.y, L.x, L.y) < 40) rpRelease(q, !!q.men.length);
      continue;
    }
    // 中止：断点已修好、小组被打残 / 压制、连队溃退、超时
    if (!b || !q.men.length || q.sup > 70 || (u && u.state === 'rout') || S.t - D.t0 > 100) {
      if (D.kind === 'seg' && q.men.length && !isLand(q.x, q.y)) { D.back = true; delete R0.det[D.k]; q.working = false; } else rpRelease(q, !!q.men.length);
      continue;
    }
    if (b.kind === 'seg') {
      D.lid = b.L.id;
      q.repairing = true; q.order = { t: 'hold' };
      if (rpWalk(q, b.L, b.x, b.y, dt) > 5) { q.working = false; continue; }
    } else {
      const d = dist(q.x, q.y, b.x, b.y);
      if (d > 14) { if (!q.order.x || dist(q.order.gx ?? q.order.x, q.order.gy ?? q.order.y, b.x, b.y) > 10) q.order = { t: 'move', x: b.x, y: b.y, gx: b.x, gy: b.y }; q.working = false; continue; }
      q.order = { t: 'hold' };
    }
    q.working = true;
    if (rpWork(b, dt * q.men.length / 3 * RP_RATE, '步兵')) {
      delete R0.since[b.k]; delete R0.det[D.k]; q.working = false;
      if (b.kind !== 'seg') { rpRelease(q, true); continue; }
      // 同一条浮桥还有断段：就近接着修，全部修好再走回滩头
      let nx = null, nd = 1e9;
      b.L.segs.forEach((g, i) => { if (!g.ok) { const d = dist(q.x, q.y, (g.x0 + g.x1) / 2, (g.y0 + g.y1) / 2); if (d < nd) { nd = d; nx = 's' + b.L.id + '_' + i; } } });
      if (nx && R0.det[nx] == null) { D.k = nx; D.t0 = S.t; R0.det[nx] = q.id; } else D.back = true;
    }
  }
  // 被动抢修：坚守中、没被压制的步兵正好站在断点上
  for (const b of B) {
    if (R0.det[b.k] != null || rpEngOn(b)) continue;
    const q = S.teams.find(q => q.side === 'p' && q.kind === 'inf' && q.men.length && !q.detail && !q.ride && q.order.t === 'hold' && q.order.x == null && q.sup < 50 && dist(q.x, q.y, b.x, b.y) < 16);
    if (q) { q.working = true; if (rpWork(b, dt * q.men.length / 3 * RP_RATE, '步兵')) q.working = false; }
  }
  // 主动派人：每 2 秒检查一次，10 秒没人修的断点从附近自动指挥的连队抽一个小组
  if ((R0.chkT = (R0.chkT ?? 0) - dt) > 0) return;
  R0.chkT = 2;
  const busy = new Set(Object.keys(R0.det).filter(k => k[0] === 's').map(k => k.split('_')[0]));   // 同一条浮桥一次只派一个组，逐段修
  for (const b of B) {
    if (Object.keys(R0.det).length >= 4) break;   // 同时最多抽 4 个小组，不把前线抽空
    if (b.kind === 'seg' && busy.has(b.k.split('_')[0])) continue;
    if (R0.det[b.k] != null || S.t - R0.since[b.k] < RP_WAIT || rpEngOn(b) || rpFoeNear(b.x, b.y, 120)) continue;
    const ax = b.kind === 'seg' ? b.L.x : b.x, ay = b.kind === 'seg' ? b.L.y : b.y;
    let best = null, bd = RP_REACH;
    for (const q of S.teams) {
      if (q.side !== 'p' || q.kind !== 'inf' || q.men.length < 2 || q.detail || q.ride || q.sup > 40) continue;
      const u = unitOf(q);
      if (!u || u.auto !== true || u.state === 'rout' || u.order === 'charge' || q.order.t === 'charge') continue;
      if (teamsOf(u).filter(o => o.men.length && !o.detail).length < 2) continue;   // 不把一个连抽空
      if (rpFoeNear(q.x, q.y, 110)) continue;   // 正在交火的不抽
      const d = dist(q.x, q.y, ax, ay) + (q.men.includes('radio') ? 60 : 0);   // 尽量不派带电台的组
      if (d < bd) { bd = d; best = q; }
    }
    if (!best) continue;
    best.detail = { k: b.k, kind: b.kind, t0: S.t };
    R0.det[b.k] = best.id;
    if (b.kind === 'seg') busy.add(b.k.split('_')[0]);
    const u = unitOf(best), nm = (u && (u.ship || u.label)) || '前沿';
    log(`${nm}连抽调一个小组抢修${rpName(b)}`, 'info', 'rpgo' + b.k, 20, b);
    if (typeof chatSay === 'function') chatSay('p', `命令：工兵不在位，${nm}连抽一个小组抢修 ${gridRef(b.x, b.y)} 的${rpName(b)}断点，修复后归建。`, { kind: 'order', at: { x: b.x, y: b.y }, key: 'rp' + b.k, gap: 60 });
  }
}
HOOK.step.push(function rpStep(dt) { updateRepair(dt); });
HOOK.newGame.push(function rpNewGame() { if (S) S.rep = null; });
