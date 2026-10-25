'use strict';
// 编制与战斗群（旅 / 团战斗队，固定机制部分）：成建制、按队形行动，对地、对空、地面推进能力齐全
// 战斗群 G（S.bgs，纯 JSON）：{ id, side, name, cmd 指挥员, us: [连 id], vs: [车 id], rec: [侦察组 id], st, ax, ay 锚点, face, key 任务据点, t, stT, thT }
//   st：asm 集合 → move 行军 → fight 接敌（战斗队形）→ hold 到达后防御
// 队形（锚点坐标系：x 向前、y 向右）：步兵连并排居中；主战坦克在步兵前方一线；步战车在步兵身后；反坦克车护两翼；防空车在中后；
//   自行火炮在后方 230；行军时横向收拢、纵向拉长（前卫坦克在前、火炮殿后）
// 移动：锚点沿寻路场向任务点推进，速度跟最慢的成员走；有成员离自己的位置 70 以上就停下等，不各走各的
// 接敌：锚点 300 内发现敌人就展开成战斗队形、正面朝敌；兵力比占优继续推进，劣势后撤重整
// 侦察组（rec）：单独前出 300–450 到林地 / 高地观察，视野 380 并入本方视野；敌人逼近 150 就换观察点
const BG = { asm: 50, lag: 70, pace: 9, contact: 300, reorder: 12, recR: 380, recFar: 450, recNear: 300 };
const BG_TANK = ['hv_tank', 'tank', 'lt_tank', 'amtank'];

const bgOf = id => (S.bgs || []).find(G => G.id === id);
function bgNew(side, name, cmd, o) {
  if (!S.bgs) S.bgs = [];
  const G = { id: S.nid++, side, name, cmd, us: [], vs: [], rec: [], st: 'asm', ax: 0, ay: 0, face: side === 'e' ? Math.PI / 2 : -Math.PI / 2, key: null, t: S.t, stT: S.t, thT: 0, ...o };
  S.bgs.push(G);
  return G;
}
const bgUnits = G => G.us.map(id => UNIT_MAP.get(id)).filter(u => u && teamsOf(u).some(q => q.men.length));
const bgVehs = G => G.vs.map(id => vehById(id)).filter(v => v && !v.dead);
const bgRecs = G => G.rec.map(id => S.teams.find(q => q.id === id)).filter(q => q && q.men.length);

// 队形位置（世界坐标）：返回 [{m 成员, k 'u'|'v', x, y}]
function bgSlots(G, mode) {
  const us = bgUnits(G).filter(u => u.state !== 'rout'), vs = bgVehs(G), out = [];   // 溃退的连先撤下去重整，不排进队形、不拖住全群
  const march = mode === 'march', lat = march ? .45 : 1, lon = march ? 1.5 : 1;
  const fx = Math.cos(G.face), fy = Math.sin(G.face), px = -fy, py = fx;
  const at = (x, y) => { let sx = clamp(G.ax + fx * x * lon + px * y * lat, 15, W - 15), sy = clamp(G.ay + fy * x * lon + py * y * lat, 15, H - 15); return [sx, sy]; };
  const wid = Math.max(1, us.length) * 95;
  us.forEach((u, i) => { const [x, y] = at(0, (i - (us.length - 1) / 2) * 95); out.push({ m: u, k: 'u', x, y }); });
  const tk = vs.filter(v => BG_TANK.includes(v.type)), ifv = vs.filter(v => v.type === 'apc'), td = vs.filter(v => v.type === 'td' || v.type === 'recon');
  const aa = vs.filter(v => v.type === 'sam_veh' || v.type === 'aa_veh'), art = vs.filter(v => v.type === 'spg'), rest = vs.filter(v => ![...tk, ...ifv, ...td, ...aa, ...art].includes(v));
  // 车辆位置吸附到该车能开到的最近格（河、悬崖、密林里的位置开不进去，整群会一直等它）
  const vcls = G.side === 'e' ? 'vehe' : 'veh';
  const snap = (sx, sy) => { if (vehPass(sx, sy, vcls)) return [sx, sy]; const j = nearestPassable(ci(sx, sy), vcls); return j >= 0 ? [cellCX(j), cellCY(j)] : [sx, sy]; };
  const row = (list, x, w) => list.forEach((v, i) => { const [sx, sy] = snap(...at(x, list.length > 1 ? (i / (list.length - 1) - .5) * w : 0)); out.push({ m: v, k: 'v', x: sx, y: sy }); });
  row(tk, march ? 70 : 55, Math.max(wid, tk.length * 26));
  row(ifv, -28, wid * .8);
  td.forEach((v, i) => { const [sx, sy] = snap(...at(15, (i % 2 ? 1 : -1) * (wid / 2 + 40 + Math.floor(i / 2) * 25))); out.push({ m: v, k: 'v', x: sx, y: sy }); });
  row(aa, -90, Math.min(120, aa.length * 30));
  row(art, -230, Math.min(90, art.length * 35));
  row(rest, -60, 60);
  return out;
}

// 敌情：本方看得见的敌步兵与车辆
function bgFoes(G) {
  const vis = G.side === 'e' ? (x, y) => spotted(x, y) : (x, y) => PV[ci(x, y)] === 1;
  return [...S.teams.filter(q => q.side !== G.side && q.men.length && !q.ride && vis(q.x, q.y)), ...(S.veh || []).filter(v => v.side !== G.side && !v.dead && !v.lst && vis(v.x, v.y))];
}
const bgPow = o => o.men ? o.men.length : BG_TANK.includes(o.type) ? 6 : 3;   // 粗略战斗力：每人 1，坦克 6，其余车辆 3

// 任务点：守住 / 夺回据点 key；据点在我手里就站到它前方（威胁方向）
function bgGoal(G) {
  const p = ptByKey(G.key);
  if (!p) return { x: G.ax, y: G.ay, face: G.face };
  if (G.gx != null) return { x: G.gx, y: G.gy, face: Math.atan2(p.y - G.gy, p.x - G.gx) };   // 指定了攻击出发位置（攻方战斗群，brain.js）
  const mine = p.owner === G.side && p.prog < .25;
  if (!mine) return { x: p.x, y: p.y, face: Math.atan2(p.y - G.ay, p.x - G.ax), atk: true };
  const T = G.side === 'e' && S.ai && S.ai.co && S.ai.co.thr && S.ai.co.thr[p.key];
  const tx = T ? T[0] : p.x, ty = T ? T[1] : p.y + (G.side === 'e' ? 200 : -200), a = Math.atan2(ty - p.y, tx - p.x);
  return { x: p.x + Math.cos(a) * 45, y: p.y + Math.sin(a) * 45, face: a };
}

// 下令：成员开到自己的队形位置（离得远或位置变了才重下）
function bgOrder(G, sl, t) {
  const fx = G.ax + Math.cos(G.face) * 300, fy = G.ay + Math.sin(G.face) * 300;
  for (const s of sl) {
    if (s.k === 'u') {
      const u = s.m, ts = teamsOf(u).filter(q => q.men.length && !q.ride);
      if (!ts.length) continue;
      if (u.bgX != null && dist(u.bgX, u.bgY, s.x, s.y) < BG.reorder && u.bgT2 === t) continue;
      u.bgX = s.x; u.bgY = s.y; u.bgT2 = t; u.face = G.face;
      const fs = formationSlots(ts.length, s.x, s.y, G.face);
      ts.forEach((q, i) => { if (t === 'hold' && dist(q.x, q.y, fs[i][0], fs[i][1]) < 6) return; aiGo(q, fs[i][0], fs[i][1], t === 'hold' ? 'move' : t, fx, fy); q.px = null; });
    } else {
      const v = s.m;
      if (v.ai === 'repair' || v.ai === 'resup' || vehAmmoF(v) < .25 || (v.fuel ?? 1) < .2 || v.hp < v.maxhp * .35) continue;   // 该回去补给 / 抢修的车交给车辆 AI，补好再归队
      v.cmd = { x: s.x, y: s.y, t: t === 'amove' && v.type !== 'spg' && v.type !== 'sam_veh' ? 'amove' : 'move', face: G.face, until: S.t + 4, ai: 'bg' };
    }
  }
}
// 掉队：成员离自己位置的距离，取第 75 百分位（连队按各组平均位置算）——一两辆卡住的车不拖住全群；
// 连队全部到位才算（步兵是主体，不能把步兵甩下）
function bgLag(G, sl) {
  const ds = [];
  let inf = 0;
  for (const s of sl) {
    let x, y;
    if (s.k === 'u') { const ts = teamsOf(s.m).filter(q => q.men.length && !q.ride); if (!ts.length) continue; x = ts.reduce((a, q) => a + q.x, 0) / ts.length; y = ts.reduce((a, q) => a + q.y, 0) / ts.length; inf = Math.max(inf, dist(x, y, s.x, s.y)); }
    else { x = s.m.x; y = s.m.y; }
    ds.push(dist(x, y, s.x, s.y));
  }
  if (!ds.length) return 0;
  ds.sort((a, b) => a - b);
  return Math.max(inf, ds[Math.floor((ds.length - 1) * .75)]);
}
// 锚点沿寻路场前进一步（最多 step），返回是否到达
function bgAdvance(G, gx, gy, step) {
  const d = dist(G.ax, G.ay, gx, gy);
  if (d < 25) return true;
  let tx = gx, ty = gy;
  if (d > 40 && !clearLine(G.ax, G.ay, gx, gy, G.side)) { const f = field(gx, gy, G.side), n = f && nextStep(f, G.ax, G.ay); if (n) [tx, ty] = n; }
  const l = dist(G.ax, G.ay, tx, ty) || 1, k = Math.min(step, l) / l;
  G.ax += (tx - G.ax) * k; G.ay += (ty - G.ay) * k;
  const a = Math.atan2(gy - G.ay, gx - G.ax);
  G.face = G.face + clamp(Math.atan2(Math.sin(a - G.face), Math.cos(a - G.face)), -.25, .25);   // 队形朝向慢慢转，不左右甩
  return false;
}

function bgSay(G, text, at, kind = 'order') { if (typeof chatSay === 'function') chatSay(G.side, `${G.cmd}（${G.name}）：${text}`, { kind, at: at || { x: G.ax, y: G.ay }, key: 'bg' + G.id + kind + G.st, gap: 25 }); }

function bgThink(G) {
  const us = bgUnits(G), vs = bgVehs(G);
  if (!us.length && !vs.length) { G.dead = true; bgSay(G, '战斗群已失去战斗力。', null, 'report'); return; }
  const foes = bgFoes(G), near = foes.filter(o => dist(o.x, o.y, G.ax, G.ay) < BG.contact);
  const goal = bgGoal(G);
  if (G.st === 'asm') {
    const sl = bgSlots(G, 'fight'); bgOrder(G, sl, 'move');
    const lg = bgLag(G, sl);
    if (lg < 45 || S.t - G.stT > (G.asmT || BG.asm)) { G.st = 'move'; G.stT = S.t; bgSay(G, `${lg < 45 ? '集合完毕' : '集合时限已到，大部已到，未到齐的随后跟进'}，全群成行军队形向${(ptByKey(G.key) || {}).name || '任务地域'}开进。`); }   // asmT：按最远一个成员的路程算的集合时限（brain.js）
    return;
  }
  if (near.length && G.st !== 'fight') { G.st = 'fight'; G.stT = S.t; bgSay(G, `前方发现敌人 ${near.length} 股，就地展开成战斗队形。`, near[0]); }
  if (G.st === 'fight' && !near.length && S.t - G.stT > 15) { G.st = 'move'; G.stT = S.t; }
  const mode = G.st === 'move' ? 'march' : 'fight', sl0 = bgSlots(G, mode), lag = bgLag(G, sl0);
  if (G.st === 'move') {
    if (lag < BG.lag && bgAdvance(G, goal.x, goal.y, BG.pace)) { G.st = 'hold'; G.stT = S.t; G.face = goal.face; bgSay(G, '到达任务地域，按防御队形展开、构筑工事。'); }
  } else if (G.st === 'fight') {
    const ours = us.reduce((a, u) => a + teamsOf(u).reduce((b, q) => b + q.men.length, 0), 0) + vs.reduce((a, v) => a + bgPow(v), 0);
    const theirs = near.reduce((a, o) => a + bgPow(o), 0), r = ours / Math.max(1, theirs);
    const c = near.reduce((a, o) => [a[0] + o.x / near.length, a[1] + o.y / near.length], [0, 0]);
    const fa = Math.atan2(c[1] - G.ay, c[0] - G.ax);
    G.face = G.face + clamp(Math.atan2(Math.sin(fa - G.face), Math.cos(fa - G.face)), -.35, .35);
    if (r > (G.agg || 1.6) && lag < BG.lag) { bgAdvance(G, c[0], c[1], BG.pace * .6); G.amove = true; }   // 占优：成战斗队形向敌推进（反冲击任务 agg 1.2）
    else if (r < .6) { G.ax -= Math.cos(G.face) * 6; G.ay -= Math.sin(G.face) * 6; G.amove = false; if (S.t - (G.wT ?? -99) > 30) { G.wT = S.t; bgSay(G, `敌我兵力约 ${r.toFixed(1)} 比 1，交替掩护后撤重整。`); } }
    else G.amove = false;
  } else if (G.st === 'hold') {
    if (dist(G.ax, G.ay, goal.x, goal.y) > 60) { G.st = 'move'; G.stT = S.t; }   // 任务变了（据点易手）
  }
  if (!passInf(G.ax, G.ay)) { const j = nearestPassable(ci(G.ax, G.ay), G.side); if (j >= 0) { G.ax = cellCX(j); G.ay = cellCY(j); } }
  bgOrder(G, bgSlots(G, mode), G.st === 'fight' && G.amove ? 'amove' : G.st === 'hold' ? 'hold' : 'move');
}

// —— 侦察组：前出观察 ——
function bgRecon(G) {
  const rs = bgRecs(G);
  if (!rs.length) return;
  const all = S.teams.filter(q => q.side !== G.side && q.men.length);
  const front = G.side === 'e' ? 1 : -1;   // 守方的敌人在南（海岸方向）
  rs.forEach((q, i) => {
    const danger = all.some(o => dist(o.x, o.y, q.x, q.y) < 150) || q.sup > 40;
    const op = q.op && !danger && S.t - (q.opT ?? -99) < 60 ? q.op : null;
    if (!op) {
      let best = null, bs = -1e9;
      for (let k = 0; k < 40; k++) {
        const a = Math.PI / 2 * front + (i ? .5 : -.5) + gauss() * .45, r = BG.recNear + Math.random() * (BG.recFar - BG.recNear);
        const x = clamp(G.ax + Math.cos(a) * r, 30, W - 30), y = clamp(G.ay + Math.sin(a) * r, 30, H - 30);
        if (!isLand(x, y) || !passInf(x, y)) continue;
        const fd = all.reduce((m, o) => Math.min(m, dist(o.x, o.y, x, y)), 1e9);
        if (fd < 180) continue;
        const sc = (1 - coverAt(x, y)) * 2.5 + (TER.elev[ci(x, y)] || 0) * 3 - Math.abs(fd - 300) / 200 + Math.random() * .3;
        if (sc > bs) { bs = sc; best = { x: Math.round(x), y: Math.round(y) }; }
      }
      if (best) { q.op = best; q.opT = S.t; aiGo(q, best.x, best.y, 'move', best.x, best.y + 200 * front); }
    }
    // 报告：观察点附近新发现的敌人
    const seen = all.filter(o => dist(o.x, o.y, q.x, q.y) < BG.recR);
    if (seen.length && S.t - (q.repT ?? -99) > 40) {
      q.repT = S.t;
      const men = seen.reduce((a, o) => a + o.men.length, 0), vs = (S.veh || []).filter(v => v.side !== G.side && !v.dead && dist(v.x, v.y, q.x, q.y) < BG.recR).length;
      bgSay(G, `侦察组报告：${typeof cmdWhere === 'function' ? cmdWhere(q.x, q.y) : gridRef(q.x, q.y)}一带发现敌步兵约 ${men} 人${vs ? `、车辆 ${vs} 辆` : ''}。`, q, 'intel');
    }
  });
}

function bgStep(dt) {
  if (!S || !S.bgs || !S.bgs.length || S.phase !== 'battle') return;
  for (const G of S.bgs) {
    if (G.dead || (G.thT -= dt) > 0) continue;
    G.thT = 1;
    bgThink(G);
    if (!G.dead) bgRecon(G);
  }
  if (S.bgs.some(G => G.dead)) {
    // done：已由编组的一方（brain.js）自行安置
    for (const G of S.bgs) if (G.dead && !G.done) { for (const u of bgUnits(G)) { u.role = 'reserve'; for (const q of teamsOf(u)) { q.bg = null; q.role = 'reserve'; } } for (const v of bgVehs(G)) v.cmd = null; }
    S.bgs = S.bgs.filter(G => !G.dead);
  }
}
HOOK.step.push(bgStep);
// 侦察组视野（望远镜、观察点居高临下）
HOOK.visionE.push(() => S && S.bgs ? S.bgs.filter(G => G.side === 'e').flatMap(G => bgRecs(G).map(q => ({ x: q.x, y: q.y, r: BG.recR, h: 1.2 }))) : []);
HOOK.visionP.push(() => S && S.bgs ? S.bgs.filter(G => G.side === 'p').flatMap(G => bgRecs(G).map(q => ({ x: q.x, y: q.y, r: BG.recR, h: 1.2 }))) : []);

// 画面：战斗群标号（北约式方框 + 编制记号「X」旅 /「III」团）与名称，远看时显示
function bgDraw() {
  if (!S || !S.bgs || !S.bgs.length || R.s > 3) return;
  const ctx = R.ctx;
  const at = [];
  for (const G of S.bgs) {
    if (G.side === 'e' && !(S.role === 'spectate' || R.eye === 'all') && !spotted(G.ax, G.ay)) continue;
    const col = G.side === 'p' ? COL.g : COL.enemy, w = px(22), h = px(14), x = G.ax;
    let y = G.ay;
    while (at.some(o => Math.abs(o[0] - x) < w * 1.2 && Math.abs(o[1] - y) < h * 2.6)) y += h * 2.8;   // 两个战斗群在同一处集合：标号上下错开，不叠在一起
    at.push([x, y]);
    ctx.save(); ctx.strokeStyle = col; ctx.fillStyle = rgba(COL.bg, .7); ctx.lineWidth = px(1.4);
    ctx.fillRect(x - w / 2, y - h / 2, w, h); ctx.strokeRect(x - w / 2, y - h / 2, w, h);
    ctx.beginPath(); ctx.moveTo(x - w / 2, y + h / 2); ctx.lineTo(x + w / 2, y - h / 2); ctx.moveTo(x - w / 2, y - h / 2); ctx.lineTo(x + w / 2, y + h / 2); ctx.stroke();   // 步兵记号
    ctx.fillStyle = col; ctx.font = font(10); ctx.textAlign = 'center';
    ctx.fillText(G.ech || 'X', x, y - h / 2 - px(3));
    ctx.fillText(G.name, x, y + h / 2 + px(11));
    ctx.restore();
  }
}
HOOK.drawTop.push(bgDraw);
