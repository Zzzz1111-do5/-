'use strict';
// 步兵野战工事与卧倒（固定机制，双方通用）：
//   散兵坑：小组原地停 DIG.still 秒以上就开挖，约 DIG.t 秒挖成（被压制时慢，工兵快）；坑留在原地（S.holes），本方谁进来直接用。
//     挖成后：防炮（无来源方向的爆炸）减伤 DIG.pit、防直射减伤 DIG.pitD；与原有「停下即简易隐蔽」取较强者，不叠加
//   交通壕：同一连相邻（DIG.link 以内）的坑都挖到七成以上，画面上连成壕
//   卧倒：被压制、刚挨打、身边刚落炮弹 / 炸弹、被看得见自己的敌坦克盯着时卧倒，平静 DIG.calm 秒后起身；卧倒中弹面小，移动改为匍匐 / 短促跃进
//   躲坦克：没有反坦克武器、在开阔地坚守、坑还没挖好的小组被敌坦克盯上：背着坦克就近躲进林地 / 房屋 / 弹坑 / 散兵坑
const DIG = { t: 35, still: 3, holeR: 5, pit: .55, pitD: .45, prone: .65, proneDug: .85, calm: 4, link: 30, max: 700, tankR: 260 };
let DIG_BL = [];   // 最近 2.5 秒的爆炸点（不存档）

function digHole(q) {
  if (q.hole == null || !S.holes) return null;
  const h = S.holes.find(h => h.id === q.hole);
  return h && dist(h.x, h.y, q.x, q.y) <= DIG.holeR ? h : null;
}
// 掩体系数里属于工事 / 卧倒的部分：直射（有来源 sx）与炮击分开算
function digShelter(q, direct, still) {
  const h = digHole(q), d = h ? h.d : 0;
  const pit = 1 - (direct ? DIG.pitD : DIG.pit) * d;
  let k = Math.min(still, pit);
  if (q.prone) k *= d > .5 ? DIG.proneDug : DIG.prone;
  return Math.max(.18, k);
}

// 身边刚落的炮弹 / 炸弹，或看得见自己的敌坦克（每 0.5 秒查一次）
function digThreat(q) {
  for (const b of DIG_BL) if (S.t - b.t < 2 && dist(b.x, b.y, q.x, q.y) < Math.max(45, b.R * 1.6)) return 'blast';
  if (S.t >= (q.tkN ?? 0)) {
    q.tkN = S.t + .5; q.tk = null;
    for (const v of S.veh || []) {
      if (v.dead || v.side === q.side || v.lst) continue;
      const g = vehSp(v).gun, d = dist(v.x, v.y, q.x, q.y);
      if (!g || g.ind || d > DIG.tankR || !vehSees(v, q.x, q.y, d)) continue;
      q.tk = { x: v.x, y: v.y, d }; break;
    }
  }
  return q.tk ? 'tank' : null;
}

// 躲坦克：背离坦克方向找掩蔽点（林地、房屋旁、弹坑、本方散兵坑），找不到就原地卧倒挖坑
function digDodge(q) {
  const t = q.tk, away = Math.atan2(q.y - t.y, q.x - t.x);
  let best = null, bs = -1e9;
  for (const r of [18, 32, 48]) for (let k = -3; k <= 3; k++) {
    const a = away + k * .45, x = q.x + Math.cos(a) * r, y = q.y + Math.sin(a) * r;
    if (!isLand(x, y) || !passInf(x, y)) continue;
    const hole = (S.holes || []).some(h => h.side === q.side && h.d > .5 && dist(h.x, h.y, x, y) < DIG.holeR);
    const sc = (1 - coverAt(x, y)) * 3 + (hole ? 2 : 0) + (CRATERC[ci(x, y)] ? .6 : 0) + dist(x, y, t.x, t.y) / 200 - r / 60;
    if (sc > bs) { bs = sc; best = { x, y }; }
  }
  if (!best || bs < .6) return false;
  q.order = { t: 'move', x: best.x, y: best.y, dodge: true }; q.dodgeT = S.t;
  v8Stat('digDodge');
  return true;
}

function digStep(dt) {
  if (!S.holes) S.holes = [];
  const hs = S.holes;
  DIG_BL = DIG_BL.filter(b => S.t - b.t < 2.5);
  for (const q of S.teams) {
    if (!q.men.length || q.ride || q.boarded) { q.prone = false; q.hole = null; continue; }
    // 卧倒
    const th = digThreat(q);
    if (q.sup > 25 || S.t - (q.hitT ?? -99) < 2 || th) q.proneT = S.t;
    const was = q.prone;
    q.prone = S.t - (q.proneT ?? -99) < DIG.calm;
    if (q.prone && !was) v8Stat('digProne');
    // 躲坦克：无反坦克武器、坚守在开阔地、坑没挖好、不是玩家亲自下令的
    if (th === 'tank' && (!q.order || q.order.t === 'hold') && !q.man && S.t - (q.dodgeT ?? -99) > 12 &&
        !q.men.includes('at') && !(q.mod && q.mod.at) && coverAt(q.x, q.y) > .8 && !((digHole(q) || {}).d > .5)) digDodge(q);
    // 挖坑：停下 DIG.still 秒后开挖；离开坑 5 以上就不再算在坑里
    if (S.t - q.movedT < DIG.still) { q.hole = null; continue; }
    let h = digHole(q);
    if (!h) {
      h = hs.find(o => o.side === q.side && dist(o.x, o.y, q.x, q.y) < DIG.holeR) || null;
      if (!h && isLand(q.x, q.y) && TER.type[ci(q.x, q.y)] !== T.TOWN && TER.type[ci(q.x, q.y)] !== T.ROAD) {
        h = { id: S.nid++, x: +q.x.toFixed(1), y: +q.y.toFixed(1), side: q.side, u: q.u ?? null, a: +faceOf(q).toFixed(2), d: 0 };
        hs.push(h);
        if (hs.length > DIG.max) { const k = hs.findIndex(o => o.d < .3 && !S.teams.some(t => t.hole === o.id)); hs.splice(k >= 0 ? k : 0, 1); }
      }
      q.hole = h ? h.id : null;
    }
    if (h && h.d < 1) {
      const rate = (q.sup > 60 ? .15 : q.sup > 30 ? .5 : 1) * Math.min(1, q.men.length / 3) * (q.kind === 'eng' ? 1.6 : 1);
      const d0 = h.d; h.d = Math.min(1, h.d + dt / DIG.t * rate);
      if (d0 < 1 && h.d >= 1) v8Stat('digDone');
    }
  }
}
HOOK.step.push(digStep);
HOOK.impact.push((x, y, R) => { DIG_BL.push({ x, y, R: R || 20, t: S.t }); });

// —— 画面：散兵坑（翻出的土堆在朝敌一侧）与交通壕 ——
let DIG_LINKS = { t: -9, n: -1, a: [] };
function digLinks() {
  const hs = S.holes || [];
  if (S.t - DIG_LINKS.t < 2 && DIG_LINKS.n === hs.length) return DIG_LINKS.a;
  const a = [], ok = hs.filter(h => h.d > .7);
  for (let i = 0; i < ok.length; i++) for (let j = i + 1; j < ok.length; j++) {
    const p = ok[i], q = ok[j];
    if (p.side === q.side && p.u != null && p.u === q.u && dist(p.x, p.y, q.x, q.y) < DIG.link) a.push([p, q]);
  }
  DIG_LINKS = { t: S.t, n: hs.length, a };
  return a;
}
function digDraw() {
  const hs = S.holes;
  if (!hs || !hs.length || R.s < .8) return;
  const ctx = R.ctx, [x0, y0, x1, y1] = viewRect(), real = realLook();
  const vis = h => h.side === 'p' || S.role === 'spectate' || R.eye === 'all' || (typeof SEEN !== 'undefined' && SEEN[ci(h.x, h.y)]);
  ctx.save(); ctx.lineCap = 'round';
  for (const [p, q] of digLinks()) {   // 交通壕：先画土，再画壕底
    if (!vis(p) || Math.max(p.x, q.x) < x0 || Math.min(p.x, q.x) > x1 || Math.max(p.y, q.y) < y0 || Math.min(p.y, q.y) > y1) continue;
    ctx.strokeStyle = real ? 'rgba(122,104,74,.7)' : rgba(COL.gDim, .8); ctx.lineWidth = 3.2;
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
    ctx.strokeStyle = real ? 'rgba(40,32,22,.85)' : rgba(COL.bg, .9); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
  }
  for (const h of hs) {
    if (h.d < .08 || h.x < x0 - 6 || h.x > x1 + 6 || h.y < y0 - 6 || h.y > y1 + 6 || !vis(h)) continue;
    const k = .35 + .65 * h.d;
    ctx.save(); ctx.translate(h.x, h.y); ctx.rotate(h.a);
    ctx.fillStyle = real ? `rgba(126,108,78,${.75 * k})` : rgba(COL.gDim, .7 * k);   // 胸墙土：朝敌一侧的月牙
    ctx.beginPath(); ctx.ellipse(1.6, 0, 1.5, 3.3 * k, 0, -1.6, 1.6); ctx.fill();
    ctx.fillStyle = real ? `rgba(38,30,20,${.85 * k})` : rgba(COL.bg, .9 * k);   // 坑
    ctx.beginPath(); ctx.ellipse(0, 0, 1.1, 2.6 * k, 0, 0, 7); ctx.fill();
    if (!real) { ctx.strokeStyle = rgba(COL.gMid, .5 * k); ctx.lineWidth = px(.8); ctx.stroke(); }
    ctx.restore();
  }
  ctx.restore();
}
HOOK.drawUnder.push(digDraw);
