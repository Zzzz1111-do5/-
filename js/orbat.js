'use strict';
// 编制与战斗群（团 / 营战斗队，固定机制部分）：成建制、按队形行动，对地、对空、地面推进能力齐全
// 战斗群 G（S.bgs，纯 JSON）：{ id, side, name, cmd 指挥员, us: [排 id], vs: [车 id], rec: [侦察组 id], st, ax, ay 锚点, face, key 任务据点, t, stT, thT }
//   st：asm 集合 → move 行军 → fight 接敌（战斗队形）→ hold 到达后防御；delay 边打边撤（sa.js）→ link 与主力汇合
// 队形（锚点坐标系：x 向前、y 向右）：步兵排并排居中；主战坦克在步兵前方一线；步战车在步兵身后；反坦克车护两翼；防空车在中后；
//   自行火炮在后方 230；行军时横向收拢、纵向拉长（前卫坦克在前、火炮殿后）
// 移动：锚点沿寻路场向任务点推进，速度跟最慢的成员走；有成员离自己的位置 70 以上就停下等，不各走各的
// 接敌：锚点 300 内发现敌人就展开成战斗队形、正面朝敌；兵力比占优继续推进，劣势后撤重整
// 侦察组（rec）：单独前出 300–450 到林地 / 高地观察，视野 380 并入本方视野；敌人逼近 150 就换观察点
const BG = { asm: 50, lag: 90, pace: 9, contact: 300, reorder: 12, recR: 380, recFar: 450, recNear: 300 };
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

// 吸附到与锚点同一岸（同一片连通区域，grid.js compOf）的最近可走格：队形位置落在河里时，不会被挪到河对岸让那个排绕远路过河
function bgSnap(G, x, y, cls) {
  const lab = compOf(cls), i0 = ci(G.ax, G.ay), a0 = lab[i0] || lab[Math.max(0, nearestPassable(i0, cls))] || 0;
  const i = ci(x, y), wet = j => TER.type[j] === T.RIVER;   // 河可以涉水过，但队形位置不放在河里
  if (lab[i] && !wet(i) && (!a0 || lab[i] === a0)) return [x, y];
  const gx = i % GW, gy = (i / GW) | 0;
  for (let r = 1; r <= 15; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    const nx = gx + dx, ny = gy + dy;
    if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
    const j = ny * GW + nx;
    if (lab[j] && !wet(j) && (!a0 || lab[j] === a0)) return [cellCX(j), cellCY(j)];
  }
  return [x, y];
}
// 队形位置（世界坐标）：返回 [{m 成员, k 'u'|'v', x, y}]
function bgSlots(G, mode) {
  const us = bgUnits(G).filter(u => u.state !== 'rout'), vs = bgVehs(G), out = [];   // 溃退的排先撤下去重整，不排进队形、不拖住全群
  const march = mode === 'march', lat = march ? .45 : 1, lon = march ? 1.5 : 1;
  const fx = Math.cos(G.face), fy = Math.sin(G.face), px = -fy, py = fx;
  const at = (x, y) => { let sx = clamp(G.ax + fx * x * lon + px * y * lat, 15, W - 15), sy = clamp(G.ay + fy * x * lon + py * y * lat, 15, H - 15); return [sx, sy]; };
  const wid = Math.max(1, us.length) * 95;
  us.forEach((u, i) => { const [x, y] = bgSnap(G, ...at(0, (i - (us.length - 1) / 2) * 95), G.side); out.push({ m: u, k: 'u', x, y }); });   // 排的位置落在河里、崖上：挪到同一岸最近的可走格
  const tk = vs.filter(v => BG_TANK.includes(v.type)), ifv = vs.filter(v => v.type === 'apc'), td = vs.filter(v => v.type === 'td' || v.type === 'recon');
  const aa = vs.filter(v => v.type === 'sam_veh' || v.type === 'aa_veh'), art = vs.filter(v => v.type === 'spg'), rest = vs.filter(v => ![...tk, ...ifv, ...td, ...aa, ...art].includes(v));
  // 车辆位置吸附到该车能开到的最近格（河、悬崖、密林里的位置开不进去，整群会一直等它）
  const vcls = G.side === 'e' ? 'vehe' : 'veh';
  const snap = (sx, sy) => bgSnap(G, sx, sy, vcls);
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
function bgOrder(G, sl, t0) {
  const fx = G.ax + Math.cos(G.face) * 300, fy = G.ay + Math.sin(G.face) * 300;
  for (const s of sl) {
    const t = s.t || t0;   // 槽位可逐个指定（边打边撤时掩护组 hold、后撤组 move）
    if (s.k === 'u') {
      const u = s.m, ts = teamsOf(u).filter(q => q.men.length && !q.ride && !q.rc);   // 借出去当侦察分队的组不管（recon.js）
      if (!ts.length) continue;
      // 位置没变就不重下——但有组离位置 40 以上却停着（中途遇敌停下、提前「到达」等），8 秒后重新下令，不让全群干等
      const idle = t !== 'hold' && S.t - (u.bgOT ?? -99) > 8 && ts.some(q => (q.order.t === 'hold' || q.order.x == null) && q.sup < 60 && dist(q.x, q.y, s.x, s.y) > 40);
      if (u.bgX != null && dist(u.bgX, u.bgY, s.x, s.y) < BG.reorder && u.bgT2 === t && !idle) continue;
      u.bgX = s.x; u.bgY = s.y; u.bgT2 = t; u.face = G.face; u.bgOT = S.t;
      const fs = formationSlots(ts.length, s.x, s.y, G.face);
      ts.forEach((q, i) => { if (t === 'hold' && dist(q.x, q.y, fs[i][0], fs[i][1]) < 6) return; aiGo(q, fs[i][0], fs[i][1], t === 'hold' ? 'move' : t, fx, fy); q.px = null; });
    } else {
      const v = s.m;
      if (v.rc || v.ai === 'repair' || v.ai === 'resup' || vehAmmoF(v) < .25 || (v.fuel ?? 1) < .2 || v.hp < v.maxhp * .35) continue;   // 该回去补给 / 抢修的车交给车辆 AI，补好再归队
      v.cmd = { x: s.x, y: s.y, t: t === 'amove' && v.type !== 'spg' && v.type !== 'sam_veh' ? 'amove' : 'move', face: G.face, until: S.t + 4, ai: 'bg' };
    }
  }
}
// 掉队：成员离自己位置的距离，取第 60 百分位（排按各组平均位置算）——一两辆卡住的车不拖住全群；
// 排全部到位才算（步兵是主体，不能把步兵甩下）；但掉队 20 秒还没靠近 10 的成员算卡住（隔水、交火走不开、走走停停），不再等它，随后跟进
function bgLag(G, sl) {
  const ds = [], lp = G.lp || (G.lp = {});
  let inf = 0;
  for (const s of sl) {
    let x, y;
    if (s.k === 'u') { const ts = teamsOf(s.m).filter(q => q.men.length && !q.ride && !q.rc); if (!ts.length) continue; x = ts.reduce((a, q) => a + q.x, 0) / ts.length; y = ts.reduce((a, q) => a + q.y, 0) / ts.length; }
    else { if (s.m.rc) continue; x = s.m.x; y = s.m.y; }   // 侦察分队不算掉队（recon.js）
    const k = s.k + s.m.id, r = lp[k], d = dist(x, y, s.x, s.y);
    if (!r || d <= BG.lag || d < r[0] - 10) lp[k] = [d, S.t];
    else if (S.t - r[1] > 20) continue;
    if (s.k === 'u') inf = Math.max(inf, d);
    ds.push(d);
  }
  if (!ds.length) return 0;
  ds.sort((a, b) => a - b);
  return Math.max(inf, ds[Math.floor((ds.length - 1) * .6)]);   // 车辆按第 60 百分位：主体到位就走，几辆排队过桥的随后跟上
}
// 锚点沿寻路场前进一步（最多 step），返回是否到达
function bgAdvance(G, gx, gy, step) {
  const d = dist(G.ax, G.ay, gx, gy);
  if (d < 25) return true;
  let tx = gx, ty = gy;
  if (d > 40 && !clearLine(G.ax, G.ay, gx, gy, G.side)) { const q = d > 240 ? 60 : 20, f = field(Math.round(gx / q) * q, Math.round(gy / q) * q, G.side), n = f && nextStep(f, G.ax, G.ay); if (n) [tx, ty] = n; }   // 远处的目标取整到格点：几个营共用一张流场，不每挪一步就整图重算
  const l = dist(G.ax, G.ay, tx, ty) || 1, k = Math.min(step, l) / l;
  G.ax += (tx - G.ax) * k; G.ay += (ty - G.ay) * k;
  const a = Math.atan2(gy - G.ay, gx - G.ax);
  G.face = G.face + clamp(Math.atan2(Math.sin(a - G.face), Math.cos(a - G.face)), -.25, .25);   // 队形朝向慢慢转，不左右甩
  return false;
}

// 战斗群指挥员的口令：头顶喊一句短话（shout.js，short 不给就取第一句），完整的话只记在通联详档（战斗群失去战斗力的报告仍在常规档）
function bgSay(G, text, at, kind = 'order', short) {
  if (typeof chatSay === 'function') chatSay(G.side, `${G.cmd}（${G.name}）：${text}`, { kind, at: at || { x: G.ax, y: G.ay }, key: 'bg' + G.id + kind + G.st, gap: 25, lv: kind === 'report' ? 1 : 2 });
  if (typeof shout === 'function') { const s = short || text.split(/[，。；]/)[0]; shout(at && at.men ? at : G, /[！？]$/.test(s) ? s : s + '！', { side: G.side }); }
}

// 河两岸：桥被炸、附近没有渡口，一部分成员跟锚点不在同一片连通区域（grid.js compOf），永远走不过来——
//   锚点挪到人多的一岸，过不去的排、车脱离战斗群交回原来的指挥（守方由大脑重新抽调，攻方交还自动指挥），全群照常行动，不再整连干等
function bgSplit(G) {
  if (S.t - (G.spT ?? -99) < 5) return;
  G.spT = S.t;
  const lab = compOf(G.side), us = bgUnits(G), vs = bgVehs(G), live = u => teamsOf(u).filter(q => q.men.length && !q.ride);
  const bank = u => { const n = new Map(); for (const q of live(u)) { const l = lab[ci(q.x, q.y)]; if (l) n.set(l, (n.get(l) || 0) + q.men.length); } return [...n].sort((a, b) => b[1] - a[1])[0]; };   // 排的大部分在哪一岸
  const men = new Map();
  for (const u of us) { const b = bank(u); if (b) men.set(b[0], (men.get(b[0]) || 0) + b[1]); }
  let a0 = lab[ci(G.ax, G.ay)];
  const big = [...men].sort((a, b) => b[1] - a[1])[0];
  if (big && (!a0 || (men.get(a0) || 0) < big[1] * .5)) {   // 锚点在人少的一岸（或在河里）：挪到人多一岸各组的中心
    const ts = us.flatMap(live).filter(q => lab[ci(q.x, q.y)] === big[0]), cx = ts.reduce((a, q) => a + q.x, 0) / ts.length, cy = ts.reduce((a, q) => a + q.y, 0) / ts.length;
    a0 = big[0];
    const p = ts.slice().sort((a, b) => dist(a.x, a.y, cx, cy) - dist(b.x, b.y, cx, cy))[0];
    G.ax = p.x; G.ay = p.y;
  }
  if (!a0) return;
  const cutU = us.filter(u => { const b = bank(u); return b && b[0] !== a0; });
  const cutV = vs.filter(v => !reachable(v.x, v.y, G.ax, G.ay, vehCls(v, G.ax, G.ay)));
  if (!cutU.length && !cutV.length) return;
  if (cutU.length >= us.length && cutV.length >= vs.length) return;   // 全都过不去（锚点本身孤立）：不拆
  for (const u of cutU) {
    G.us = G.us.filter(id => id !== u.id);
    u.role = 'reserve'; u.bgX = null;
    for (const q of teamsOf(u)) { q.bg = null; q.role = 'reserve'; q.px = null; }
    if (typeof shout === 'function') shout(u, '隔着河过不去，就地归建！');
  }
  for (const v of cutV) { G.vs = G.vs.filter(id => id !== v.id); v.bgG = null; v.cmd = null; }
  bgSay(G, `${[cutU.length && `${cutU.length} 个排`, cutV.length && `${cutV.length} 辆车`].filter(Boolean).join('、')}被河隔开、过不去，脱离本群就地归建；其余继续行动。`, null, 'order', '隔河的部队不等了，继续前进！');
  if (typeof v8Stat === 'function') v8Stat('bgSplit');
}

function bgThink(G) {
  const us = bgUnits(G), vs = bgVehs(G);
  if (!us.length && !vs.length) { G.dead = true; bgSay(G, '战斗群已失去战斗力。', null, 'report'); return; }
  bgSplit(G);
  const foes = bgFoes(G), near = foes.filter(o => dist(o.x, o.y, G.ax, G.ay) < BG.contact);
  const goal = bgGoal(G);
  if (G.st === 'asm') {
    const sl = bgSlots(G, 'fight'); bgOrder(G, sl, 'move');
    const lg = bgLag(G, sl);
    if (lg < 45 || S.t - G.stT > (G.asmT || BG.asm)) { G.st = 'move'; G.stT = S.t; bgSay(G, `${lg < 45 ? '集合完毕' : '集合时限已到，大部已到，未到齐的随后跟进'}，全群成行军队形向${(ptByKey(G.key) || {}).name || '任务地域'}开进。`, null, 'order', `${lg < 45 ? '集合完毕' : '不等了'}，向${(ptByKey(G.key) || {}).name || '任务地域'}开进！`); }   // asmT：按最远一个成员的路程算的集合时限（brain.js）
    return;
  }
  if (near.length && G.st !== 'fight' && G.st !== 'delay' && G.st !== 'link') { G.st = 'fight'; G.stT = S.t; G.ov = null; bgSay(G, `前方发现敌人 ${near.length} 股，就地展开成战斗队形。`, near[0]); }
  if (G.st === 'fight' && !near.length && S.t - G.stT > 15) { G.st = 'move'; G.stT = S.t; G.ov = null; }
  const mode = G.st === 'move' ? 'march' : 'fight', sl0 = bgSlots(G, mode), lag = bgLag(G, sl0);
  const L = typeof saLook === 'function' ? saLook(G) : null;   // 态势感知（sa.js）
  let custom = null;
  G.saRet = G.ret ?? .6;
  if (G.st === 'delay') {   // 边打边撤（sa.js saDelay）：两组交替掩护，往主力 / 大后方撤，一路叫火力
    const res = saDelay(G, L, () => bgSlots(G, 'fight'));
    custom = res.sl;
    if (res.done) {
      if (res.link) { G.st = 'link'; G.linkId = res.link.id; G.stT = S.t; saStat('bgLink'); }
      else { G.st = 'fight'; G.stT = S.t; }
    }
  } else if (G.st === 'link') {   // 与主力汇合：在主力身边（偏开 120）展开，兵力合起来够了再一起打回去
    const M = bgOf(G.linkId);
    if (!M || M.dead || !L) { G.st = 'move'; G.stT = S.t; }
    else {
      const a = Math.atan2(G.ay - M.ay, G.ax - M.ax), tx = M.ax + Math.cos(a) * 120, ty = M.ay + Math.sin(a) * 120;
      if (dist(G.ax, G.ay, tx, ty) > 40) { const keep = G.face; bgAdvance(G, tx, ty, BG.pace); G.face = keep; }
      if (isFinite(L.fx)) { const fa = Math.atan2(L.fy - G.ay, L.fx - G.ax); G.face += clamp(Math.atan2(Math.sin(fa - G.face), Math.cos(fa - G.face)), -.3, .3); }
      if (S.t - G.stT > 20 && L.odds >= (G.agg || 1.6) * .9) { G.st = 'move'; G.stT = S.t; bgSay(G, '与主力汇合后兵力已占优，一起打回去！', null, 'order', '兵力够了，打回去！'); saStat('bgLinkGo'); }
      else if (S.t - G.stT > 120 && !L.theirs) { G.st = 'move'; G.stT = S.t; }
    }
  }
  if (G.st === 'move') {
    if (lag < BG.lag && bgAdvance(G, goal.x, goal.y, BG.pace)) { G.st = 'hold'; G.stT = S.t; G.face = goal.face; bgSay(G, '到达任务地域，按防御队形展开、构筑工事。', null, 'order', '到了，展开构筑工事！'); }
  } else if (G.st === 'fight') {
    const ours = us.reduce((a, u) => a + teamsOf(u).reduce((b, q) => b + q.men.length, 0), 0) + vs.reduce((a, v) => a + bgPow(v), 0);
    const theirs = near.reduce((a, o) => a + bgPow(o), 0), r = ours / Math.max(1, theirs);
    const c = near.reduce((a, o) => [a[0] + o.x / near.length, a[1] + o.y / near.length], [0, 0]);
    const fa = Math.atan2(c[1] - G.ay, c[0] - G.ax);
    G.face = G.face + clamp(Math.atan2(Math.sin(fa - G.face), Math.cos(fa - G.face)), -.35, .35);
    const odds = L ? L.odds : r, pw0 = G.p0 || (G.p0 = ours);
    if (L && odds < (G.ret ?? .6) && near.length && (S.t - (G.wdEnd ?? -99) > 30 || odds < (G.ret ?? .6) * .5)) {   // 打不过：边打边撤（伤亡过大就放烟幕脱离接触）；刚撤完 30 秒内不再撤
      G.st = 'delay'; G.stT = S.t; G.wd = null; G.ov = null; G.amove = false;
      saDelayStart(G, L, odds < (G.ret ?? .6) * saP(G.side).brk && ours < pw0 * SA.brkPw);
      custom = saDelay(G, L, () => bgSlots(G, 'fight')).sl;
    } else if (odds > (G.agg || 1.6) && lag < BG.lag * 1.4) {   // 占优：成战斗队形向敌推进（反冲击任务 agg 1.2）
      if (G.a101 && L) custom = bgOverwatch(G, c[0], c[1]);   // 101：跃进—掩护，一组前进一组掩护
      else bgAdvance(G, c[0], c[1], BG.pace * .6);
      G.amove = true;
    } else {
      G.amove = false;
      if (G.a101 && L && S.t - (G.covT ?? -99) > 20) { G.covT = S.t; bgCoverPos(G, L); }   // 101 均势：就近占掩蔽好的地形，以逸待劳，标枪等敌人进来
    }
    if (!L && r < (G.ret ?? .6)) { G.ax -= Math.cos(G.face) * 6; G.ay -= Math.sin(G.face) * 6; G.amove = false; }
  } else if (G.st === 'hold') {
    if (dist(G.ax, G.ay, goal.x, goal.y) > 60) { G.st = 'move'; G.stT = S.t; }   // 任务变了（据点易手）
  }
  if (!passInf(G.ax, G.ay)) { const j = nearestPassable(ci(G.ax, G.ay), G.side); if (j >= 0) { G.ax = cellCX(j); G.ay = cellCY(j); } }
  bgOrder(G, custom || bgSlots(G, mode), G.st === 'fight' && G.amove ? 'amove' : G.st === 'hold' || G.st === 'link' ? 'hold' : 'move');
}
// 跃进—掩护前进（101 顺风时）：成员按序号分两组，一组前进一跃（90）时另一组停在原地掩护，到位后互换、超越前进；返回带 t 的槽位
function bgOverwatch(G, gx, gy) {
  const O = G.ov || (G.ov = { h: 0, t: S.t - 99, d: 99, fr: {} });
  const tag = sl => { let i = 0; for (const s of sl) s.g = i++ % 2; return sl; };
  let sl = tag(bgSlots(G, 'fight'));
  const key = s => s.k + s.m.id, mv = sl.filter(s => s.g === O.h), lag = mv.length ? bgLag(G, mv) : 0;
  if ((O.d >= 90 && lag < 35) || S.t - O.t > 25) {
    O.h ^= 1; O.t = S.t; O.d = 0; O.fr = {};
    for (const s of sl) if (s.g !== O.h) O.fr[key(s)] = s.k === 'u' ? regUnitAt(s.m) : [s.m.x, s.m.y];
  }
  if (O.d < 90) { const x0 = G.ax, y0 = G.ay; bgAdvance(G, gx, gy, BG.pace * .8); O.d += dist(x0, y0, G.ax, G.ay); }
  sl = tag(bgSlots(G, 'fight'));
  return sl.map(s => { const f = s.g !== O.h && O.fr[key(s)]; return f ? { ...s, x: f[0], y: f[1], t: 'hold' } : { ...s, t: 'amove' }; });
}
// 占掩蔽地形（101 均势时）：锚点 140 以内、不往敌人那边多靠 30、林地 / 城镇 / 高处，挪过去就地防御
function bgCoverPos(G, L) {
  const de = dist(G.ax, G.ay, L.fx, L.fy);
  let best = null, bs = (1 - coverAt(G.ax, G.ay)) * 2 + (TER.elev[ci(G.ax, G.ay)] || 0) * 1.5 + .25;
  for (let k = 0; k < 18; k++) {
    const a = k / 18 * 6.283, r = 60 + (k % 3) * 40, x = clamp(G.ax + Math.cos(a) * r, 20, W - 20), y = clamp(G.ay + Math.sin(a) * r, 20, H - 20);
    if (!passInf(x, y) || dist(x, y, L.fx, L.fy) < de - 30) continue;
    const sc = (1 - coverAt(x, y)) * 2 + (TER.elev[ci(x, y)] || 0) * 1.5 - r / 400;
    if (sc > bs) { bs = sc; best = { x, y }; }
  }
  if (!best) return;
  G.ax = best.x; G.ay = best.y;
  if (typeof saStat === 'function') saStat('bgCover');
  bgSay(G, '敌我兵力相当，就近占领有利地形，以逸待劳，等敌人进入标枪射程再打。', null, 'order', '占领有利地形，等他们进来！');
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
      bgSay(G, `侦察组报告：${typeof cmdWhere === 'function' ? cmdWhere(q.x, q.y) : gridRef(q.x, q.y)}一带发现敌步兵约 ${men} 人${vs ? `、车辆 ${vs} 辆` : ''}。`, q, 'intel', `发现敌步兵约 ${men} 人${vs ? `、车 ${vs} 辆` : ''}！`);
    }
  });
}

function bgStep(dt) {
  if (!S || !S.bgs || !S.bgs.length || S.phase !== 'battle') return;
  for (const G of S.bgs) {
    if (G.dead || (G.thT -= dt) > 0) continue;
    G.thT = 1;
    if (G.th && typeof thRegThink === 'function') thRegThink(G);   // 战区编成的营（theater.js）：沿战线的命令自己摆，其余交营长
    else if (G.reg && typeof regThink === 'function') regThink(G); else bgThink(G);   // 营（hq.js）由营长按战法表指挥
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

// 画面：战斗群标号（北约式方框 + 编制记号「X」团 /「III」营）与名称，远看时显示
function bgDraw() {
  if (!S || !S.bgs || !S.bgs.length || R.s > 3 || (typeof V3 === 'object' && V3.drawing)) return;   // 3D 立体地图里标号立在地形上方（view3d.js），地面上不再重复画
  const ctx = R.ctx;
  const at = [];
  for (const G of S.bgs) {
    if (G.reg) continue;   // 营的标号由指挥体系画（hq.js hqDraw）
    if (G.side === 'e' && !(specAll() || R.eye === 'all') && !spotted(G.ax, G.ay)) continue;
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
