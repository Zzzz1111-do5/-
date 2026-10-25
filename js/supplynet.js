'use strict';
// 陆上补给网：从滩头补给站（浮桥补给线终点）沿道路向前线延伸的前沿补给点与运输线
// S.snet.nodes：{id, x, y, parent, root, hp, maxhp, built(0..1), cut, dead, connected, rep, sab, path:[[x,y]...], t, deadT}
// parent = 上级节点 id（null 表示直接连到滩头补给站）；root = 所属 S.supply 补给线 id；path = 从上级到本节点的运输线
// 节点接通 = 已建成、未被摧毁、到上级的运输线未被切断、上级接通（或所属滩头补给线接通）
// SN_STEP：新补给点离上一个点约几格——有补给卡车（trucks.js）往前运，点可以设得更远、链可以更长
const SN_R = 220, SN_MAX = 30, SN_HP = 10, SN_FAR = 220, SN_STEP = 26, SN_STOCK0 = .35;
const SN_FRONTS = 3, SN_AHEAD = 2;   // 同时跟进的进攻方向数 · 每个方向最多先规划几段（前一段建成后卡车接着建下一段）

function snEnsure() {
  if (!S.snet || typeof S.snet !== 'object' || !Array.isArray(S.snet.nodes)) S.snet = { nodes: [], planT: 0, front: null };
  return S.snet;
}
const snLive = n => n.built >= 1 && !n.dead;
const snById = id => S.snet ? S.snet.nodes.find(n => n.id === id) : null;
const snRootLine = n => S.supply.find(L => L.id === n.root) || null;

// 上级位置：上级节点或滩头补给站
function snAnchorPos(n) {
  if (n.parent != null) { const p = snById(n.parent); return p ? [p.x, p.y] : null; }
  const L = snRootLine(n);
  return L ? [L.x, L.y] : null;
}

// 运输线中点（按路径长度）：工兵抢修位置、敌方破袭目标
function snMid(n) {
  const P = n.path && n.path.length > 1 ? n.path : (() => { const a = snAnchorPos(n); return a ? [a, [n.x, n.y]] : [[n.x, n.y]]; })();
  if (P.length < 2) return [P[0][0], P[0][1]];
  let tot = 0;
  for (let i = 1; i < P.length; i++) tot += dist(P[i - 1][0], P[i - 1][1], P[i][0], P[i][1]);
  let h = tot / 2;
  for (let i = 1; i < P.length; i++) {
    const l = dist(P[i - 1][0], P[i - 1][1], P[i][0], P[i][1]);
    if (h <= l && l > 0) return [lerp(P[i - 1][0], P[i][0], h / l), lerp(P[i - 1][1], P[i][1], h / l)];
    h -= l;
  }
  return [P[P.length - 1][0], P[P.length - 1][1]];
}

// 滩头补给站接通：本线浮桥接通，或同一滩头（160 以内）另有接通的补给站
const snRootOk = L => !!L && (L.connected || S.supply.some(o => o !== L && o.connected && dist(o.x, o.y, L.x, L.y) < 160));

// 连通性：节点按创建顺序排列，上级总在前面；递归带深度保护
function snLink() {
  const N = snEnsure().nodes, by = new Map(N.map(n => [n.id, n])), memo = new Map();
  const con = (n, depth) => {
    if (memo.has(n.id)) return memo.get(n.id);
    memo.set(n.id, false);
    let c = snLive(n) && !n.cut && depth < 40;
    if (c) {
      if (n.parent == null) c = snRootOk(snRootLine(n));
      else { const p = by.get(n.parent); c = !!p && con(p, depth + 1); }
    }
    memo.set(n.id, c);
    return c;
  };
  for (const n of N) n.connected = con(n, 0);
}

// 补给点列表：滩头补给站 + 已建成的前沿补给点（connectedOnly 只要接通的）
function supplyPoints(connectedOnly) {
  const out = [];
  if (!S) return out;
  for (const L of S.supply) if (!connectedOnly || L.connected) out.push({ kind: 'depot', id: L.id, x: L.x, y: L.y, root: L.id, connected: !!L.connected });
  if (S.snet) for (const n of S.snet.nodes) if (snLive(n) && isFinite(n.x) && isFinite(n.y) && (!connectedOnly || n.connected)) out.push({ kind: 'node', id: n.id, x: n.x, y: n.y, root: n.root, connected: !!n.connected, stock: n.stock ?? 1 });
  if (S.para && S.para.ca) for (const k of S.para.ca) if (k.amt > 0) out.push({ kind: 'cache', id: k.id, x: k.x, y: k.y, root: null, connected: true });   // 空投补给点（para.js）
  return out;
}
// 最近的补给点；只要接通的时，存量见底（等卡车）的前沿点不算
function nearestSupply(x, y, connectedOnly) {
  let best = null, bd = Infinity;
  for (const p of supplyPoints(connectedOnly)) { if (connectedOnly && p.stock != null && p.stock <= .03) continue; const d = dist(p.x, p.y, x, y); if (d < bd) { bd = d; best = p; } }
  return best;
}

// 附近有已知敌情（不在此处设点 / 暂缓施工）
function snDanger(x, y, r) {
  for (const q of S.teams) if (q.side === 'e' && q.men.length) {
    if (inVision(q.x, q.y) ? dist(q.x, q.y, x, y) < r : q.seen != null && S.t - q.seen < 20 && dist(q.sx, q.sy, x, y) < r * .85) return true;
  }
  for (const e of S.enemies) if (!e.dead && e.kx != null && e.kind === 'bunker' && dist(e.kx, e.ky, x, y) < r + 50) return true;
  return false;
}

// —— 规划：补给线跟着推进线走——远离补给（> SN_FAR）的我方步兵按地域分成几个进攻方向（各取兵力最集中的一群，最多 SN_FRONTS 个）；
//    每个方向从离它最近的补给点（接通的，或已规划、正在建的链尾）沿寻路方向延伸约 SN_STEP 格设新补给点，一个方向最多先规划 SN_AHEAD 段，
//    卡车 / 工兵按顺序一段段建过去，不用等前一段建好才规划下一段 ——
function snFronts(pts) {
  const far = [];
  for (const u of S.units) {
    if (u.side !== 'p' || u.kind !== 'inf' || u.state === 'rout' || u.x == null || !isFinite(u.x) || !teamsOf(u).length) continue;
    let d = Infinity;
    for (const p of pts) d = Math.min(d, dist(p.x, p.y, u.x, u.y));
    if (d > SN_FAR) far.push({ x: u.x, y: u.y, m: Math.max(1, u.men || 1) });
  }
  const out = [];
  while (far.length && out.length < SN_FRONTS) {
    let core = far[0], cm = 0;
    for (const a of far) { let m = 0; for (const b of far) if (dist(a.x, a.y, b.x, b.y) < 320) m += b.m; if (m > cm) { cm = m; core = a; } }
    let fx = 0, fy = 0, fm = 0;
    for (let i = far.length - 1; i >= 0; i--) { const b = far[i]; if (dist(core.x, core.y, b.x, b.y) < 320) { fx += b.x * b.m; fy += b.y * b.m; fm += b.m; far.splice(i, 1); } }
    if (fm >= 3) out.push({ x: fx / fm, y: fy / fm, m: fm });
  }
  return out;
}
function snPlan() {
  const net = snEnsure(), N = net.nodes;
  snPrune();
  net.front = null;
  if (!S.teams.some(q => q.side === 'p' && q.kind === 'eng' && q.men.length) && !(typeof trkAny === 'function' && trkAny())) return;   // 工兵全部阵亡、也没有补给卡车：无人施工
  const pts = supplyPoints(true);
  if (!pts.length) return;
  const fronts = snFronts(pts);
  if (!fronts.length) return;
  net.front = fronts[0];
  net.fronts = fronts.map(f => ({ x: Math.round(f.x), y: Math.round(f.y) }));
  for (const front of fronts) {
    if (N.length >= SN_MAX) return;
    const f = field(front.x, front.y, 'p');
    if (!f) continue;
    // 起点：离前线（寻路距离）最近的接通补给点，或本方向已规划 / 在建的链尾（链尾的上级必须能接上）
    const pend = N.filter(n => !n.dead && n.built < 1 && isFinite(n.x));
    const ahead = pend.filter(n => isFinite(f[ci(n.x, n.y)]) && f[ci(n.x, n.y)] < Infinity && dist(n.x, n.y, front.x, front.y) < 700);
    if (ahead.length >= SN_AHEAD) continue;
    let an = null, ad = Infinity;
    for (const p of pts) { const v = f[ci(p.x, p.y)]; if (v < ad) { ad = v; an = p; } }
    for (const n of ahead) { const v = f[ci(n.x, n.y)]; if (v < ad) { ad = v; an = { kind: 'node', id: n.id, x: n.x, y: n.y, root: n.root }; } }
    if (!an || !isFinite(ad) || dist(an.x, an.y, front.x, front.y) < 150) continue;
    let x = an.x, y = an.y;
    const path = [[x, y]], trail = [[x, y]];
    for (let k = 1; k <= SN_STEP; k++) {
      const n = nextStep(f, x, y);
      if (!n) break;
      [x, y] = n;
      trail.push([x, y]);
      if (dist(x, y, front.x, front.y) < 110) break;
    }
    // 避开已知雷区、铁丝网与敌情：沿来路回退
    while (trail.length > 1) {
      const [tx, ty] = trail[trail.length - 1], i = ci(tx, ty);
      if (TP[TER.type[i]].sp && MINEC[i] !== 2 && !WIREC[i] && !snDanger(tx, ty, 110)) break;
      trail.pop();
    }
    [x, y] = trail[trail.length - 1];
    if (dist(x, y, an.x, an.y) < 80 || N.some(n => !n.dead && dist(n.x, n.y, x, y) < 70)) continue;
    for (let k = 3; k < trail.length - 1; k += 3) path.push(trail[k]);
    path.push([x, y]);
    const node = { id: S.nid++, x, y, parent: an.kind === 'node' ? an.id : null, root: an.root, hp: SN_HP, maxhp: SN_HP, built: 0, cut: false, dead: false, connected: false, rep: 0, sab: 0, path, t: S.t, deadT: null, stock: SN_STOCK0 };
    N.push(node);
    v8Stat('snPlan');
    log('工兵规划前沿补给点，补给线跟进', 'info', 'snplan', 40, { x, y });
  }
}

// 清理：长期无人施工且前线已远离的规划点、被毁后已无人需要的补给点（只删叶子节点）
function snPrune() {
  const N = snEnsure().nodes;
  for (let pass = 0; pass < 4; pass++) {
    const hasKid = new Set(N.filter(n => n.parent != null).map(n => n.parent));
    const near = (n, r) => S.units.some(u => u.side === 'p' && u.kind === 'inf' && u.x != null && dist(u.x, u.y, n.x, n.y) < r);
    const drop = N.filter(n => !hasKid.has(n.id) && (
      !isFinite(n.x) || !isFinite(n.y) || !snRootLine(n) || (n.parent != null && !snById(n.parent)) ||
      (!n.dead && n.built <= 0 && S.t - n.t > 60 && !near(n, 450)) ||
      (n.dead && n.built <= 0 && S.t - (n.deadT ?? n.t) > 60 && !near(n, 350))));
    if (!drop.length) break;
    const keep = N.filter(n => !drop.includes(n));
    N.length = 0; N.push(...keep);
  }
}

// 工兵施工：空闲（坚守/排雷待命）的工兵组在节点或断点 16 以内即自动作业
function snWork(dt) {
  const N = S.snet.nodes;
  if (!N.length) return;
  for (const q of S.teams) {
    if (q.side !== 'p' || q.kind !== 'eng' || !q.men.length || q.repairing) continue;
    const o = q.order;
    if ((o.t !== 'hold' && o.t !== 'clear') || o.x != null) continue;
    const rate = q.men.length / 3 * dt;
    let did = false;
    for (const n of N) {
      if (!snLive(n)) {   // 新建或重建
        if (dist(q.x, q.y, n.x, n.y) >= 16) continue;
        n.built = Math.min(1, (n.built || 0) + rate / 15);
        if (n.built >= 1) {
          Object.assign(n, { dead: false, hp: n.maxhp, cut: false, rep: 0, sab: 0, stock: Math.max(n.stock ?? 0, SN_STOCK0) });   // 工兵随身带来的一点存量，其余靠卡车
          log('前沿补给点建成', 'good', 'snbuilt', 3, n);
        }
      } else if (n.cut) {
        const m = snMid(n);
        if (dist(q.x, q.y, m[0], m[1]) >= 16) continue;
        n.rep = (n.rep || 0) + rate / 5;
        if (n.rep >= 1) { n.cut = false; n.rep = 0; n.sab = 0; log('工兵接通了一段运输线', 'good', 'snfix', 4, { x: m[0], y: m[1] }); }
      } else if (n.hp < n.maxhp) {
        if (dist(q.x, q.y, n.x, n.y) >= 16) continue;
        n.hp = Math.min(n.maxhp, n.hp + n.maxhp * rate / 8);
      } else continue;
      did = true;
      break;
    }
    if (did) q.working = true;
  }
}

// 每步由 updateSupply 调用：施工、连通性、每 4 秒规划一次
function updateSupplyNet(dt) {
  if (!S) return;
  const net = snEnsure();
  if (S.phase !== 'battle') return;
  snWork(dt);
  snLink();
  if ((net.planT = (net.planT ?? 0) - dt) <= 0) { net.planT = 4; snPlan(); }
}

// 工兵任务清单（autopilot 使用）：k 为任务唯一键，pri 越小越优先
function snTasks() {
  const out = [];
  if (!S || !S.snet) return out;
  for (const n of S.snet.nodes) {
    if (snLive(n)) {
      if (n.cut) { const m = snMid(n); out.push({ k: 'e' + n.id, kind: 'edge', id: n.id, x: m[0], y: m[1], pri: 1 }); }
      else if (n.hp < n.maxhp * .7) out.push({ k: 'f' + n.id, kind: 'fix', id: n.id, x: n.x, y: n.y, pri: 2.5 });
    } else if (n.dead) out.push({ k: 'n' + n.id, kind: 'rebuild', id: n.id, x: n.x, y: n.y, pri: 2 });
    else {
      const p = n.parent != null ? snById(n.parent) : null;
      out.push({ k: 'n' + n.id, kind: 'build', id: n.id, x: n.x, y: n.y, pri: p && !snLive(p) ? 3.6 : 3 });
    }
  }
  return out;
}

function snDamage(n, dmg) {
  if (!snLive(n) || !(dmg > 0)) return;
  n.hp -= dmg;
  if (n.hp > 0) return;
  Object.assign(n, { dead: true, built: 0, hp: 0, cut: false, rep: 0, sab: 0, connected: false, deadT: S.t });
  S.fx.push({ kind: 'boom', x: n.x, y: n.y, r: 18, life: 0, max: 1, side: 'e' });
  log('前沿补给点被摧毁', 'bad', 'sndead', 5, n);
}

// 下游节点数（目标价值）
function snSubtree() {
  const N = S.snet ? S.snet.nodes : [], kids = new Map(), cnt = new Map();
  for (const n of N) if (n.parent != null) { if (!kids.has(n.parent)) kids.set(n.parent, []); kids.get(n.parent).push(n); }
  const count = (n, d) => {
    if (cnt.has(n.id)) return cnt.get(n.id);
    let c = 1;
    if (d < 40) for (const k of kids.get(n.id) || []) c += count(k, d + 1);
    cnt.set(n.id, c);
    return c;
  };
  for (const n of N) count(n, 0);
  return cnt;
}

// —— 供敌方破袭 / 炮击使用的目标（只含真实、完好的设施）——
// {kind:'node'|'edge'|'depot'|'seg', key, id, x, y, value, ref}；seg 另有 si（浮桥段序号）
function supplyTargets() {
  const out = [];
  if (!S) return out;
  const users = (x, y, r) => { let c = 0; for (const q of S.teams) if (q.side === 'p' && q.kind === 'inf' && q.men.length && dist(q.x, q.y, x, y) < r) c++; return c; };
  if (S.snet && S.snet.nodes.length) {
    const sub = snSubtree();
    for (const n of S.snet.nodes) if (snLive(n)) {
      const k = sub.get(n.id) || 1, us = n.connected ? users(n.x, n.y, SN_R) : 0;
      out.push({ kind: 'node', key: 'n' + n.id, id: n.id, x: n.x, y: n.y, value: 1 + k * .5 + us * .3, ref: n });
      if (!n.cut) { const m = snMid(n); out.push({ kind: 'edge', key: 'e' + n.id, id: n.id, x: m[0], y: m[1], value: .8 + k * .5 + (n.connected ? us * .2 : 0), ref: n }); }
    }
  }
  for (const L of S.supply) {
    if (!L.segs || !L.segs.length) continue;
    const us = L.connected ? users(L.x, L.y, 200) : 0;
    if (L.segs[0].ok) out.push({ kind: 'depot', key: 'd' + L.id, id: L.id, x: L.x, y: L.y, value: 3 + us * .3, ref: L });
    L.segs.forEach((g, si) => {
      const mx = (g.x0 + g.x1) / 2, my = (g.y0 + g.y1) / 2;
      if (g.ok && my - coastAt(mx) < 60) out.push({ kind: 'seg', key: 's' + L.id + '_' + si, id: L.id, si, x: mx, y: my, value: 1.5 + us * .2, ref: g });
    });
  }
  return out;
}

// 破袭：node 扣血；edge 累计破坏 ≥1.5 即切断；depot / seg 切断浮桥段（depot = 靠岸第一段）
// 返回 true 表示目标仍完好（可继续破坏），false 表示已被摧毁/切断或目标无效
function hitSupply(t, dmg) {
  if (!S || !t) return false;
  dmg = +dmg;
  if (!(dmg > 0)) return false;
  if (t.kind === 'node' || t.kind === 'edge') {
    const n = snById(t.id ?? (t.ref && t.ref.id));
    if (!n || !snLive(n)) return false;
    if (t.kind === 'node') { snDamage(n, dmg); return snLive(n); }
    if (n.cut) return false;
    n.sab = (n.sab || 0) + dmg;
    if (n.sab < 1.5) return true;
    n.cut = true; n.rep = 0; n.sab = 0;
    const m = snMid(n);
    log('前沿运输线被切断', 'bad', 'snsab', 6, { x: m[0], y: m[1] });
    return false;
  }
  if (t.kind === 'depot' || t.kind === 'seg') {
    const L = S.supply.find(l => l.id === (t.id ?? (t.ref && t.ref.id)));
    const g = L && L.segs && L.segs[t.kind === 'seg' ? (t.si | 0) : 0];
    if (!g || !g.ok) return false;
    g.sab = (g.sab || 0) + dmg;
    if (g.sab < 1.5) return true;
    g.ok = false; g.rep = 0; g.sab = 0;
    log('滩头补给线被破坏，工兵前往抢修', 'bad', 'segsab', 6, { x: (g.x0 + g.x1) / 2, y: (g.y0 + g.y1) / 2 });
    return false;
  }
  return false;
}

// 炮弹/炸弹落点（由 impact() 调用）：R 内的补给点受损，R*0.8 内经过的运输线被切断
function supplyImpact(x, y, R, pw, side, src) {
  if (!S || !S.snet || !S.snet.nodes.length || !(R > 0)) return;
  const base = pw ? (pw.struct || (pw.ship ? pw.ship * 2.5 : 0) || 4) : 5;
  let cut = false, hit = false;
  for (const n of S.snet.nodes) {
    if (!snLive(n)) continue;
    const d = dist(x, y, n.x, n.y);
    if (d < R) { snDamage(n, base * (1 - d / R * .5)); hit = true; }
    if (snLive(n) && !n.cut && n.path && n.path.length > 1 && polyDist(x, y, n.path) < R * .8) { n.cut = true; n.rep = 0; cut = true; }
  }
  if (cut) log('前沿运输线被炮火切断，工兵前往抢修', 'warn', 'sncut', 6, { x, y });
  if ((cut || hit) && side === 'e' && typeof cbSupplyHit === 'function') cbSupplyHit(src, x, y);   // 是哪门炮打的补给线（cbat.js）
}

// —— 渲染（仅图形）：运输线（虚线道路、接通时有车队光点、被切断时红色闪烁）、补给点（堆叠的物资箱）、规划中的虚影 ——
function drawSupplyNet(time) {
  const N = S && S.snet && S.snet.nodes;
  if (!N || !N.length) return;
  const ctx = R.ctx, near = R.s >= 1.6;
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const line = P => { ctx.beginPath(); ctx.moveTo(P[0][0], P[0][1]); for (let i = 1; i < P.length; i++) ctx.lineTo(P[i][0], P[i][1]); };
  // 覆盖范围（极淡，避免遮挡）
  ctx.lineWidth = px(1); ctx.setLineDash([px(2), px(7)]);
  for (const n of N) if (n.connected) { ctx.strokeStyle = rgba(COL.g, .07); ctx.beginPath(); ctx.arc(n.x, n.y, SN_R, 0, 7); ctx.stroke(); }
  for (const n of N) {
    const P = n.path && n.path.length > 1 ? n.path : null;
    if (!P) continue;
    if (!snLive(n)) {   // 规划中 / 被毁：虚影
      ctx.setLineDash([px(2), px(5)]); ctx.lineWidth = px(1.4);
      ctx.strokeStyle = rgba(n.dead ? COL.enemy : COL.g, n.dead ? .25 : .38); line(P); ctx.stroke();
      continue;
    }
    ctx.setLineDash([]); ctx.strokeStyle = 'rgba(2,10,6,.7)'; ctx.lineWidth = Math.max(px(4.5), 4); line(P); ctx.stroke();
    if (n.cut) {
      ctx.setLineDash([px(2), px(5)]); ctx.lineWidth = px(1.8);
      ctx.strokeStyle = rgba(COL.enemy, .4 + .3 * Math.sin(time * 9)); line(P); ctx.stroke();
      const [mx, my] = snMid(n), r = Math.max(4, px(5));
      ctx.setLineDash([]); ctx.lineWidth = px(2); ctx.strokeStyle = rgba(COL.enemy, .65 + .35 * Math.sin(time * 9));
      ctx.beginPath(); ctx.moveTo(mx - r, my - r); ctx.lineTo(mx + r, my + r); ctx.moveTo(mx + r, my - r); ctx.lineTo(mx - r, my + r); ctx.stroke();
      if (n.rep > 0) { ctx.strokeStyle = COL.amber; ctx.beginPath(); ctx.arc(mx, my, r * 1.7, -1.57, -1.57 + n.rep * 6.283); ctx.stroke(); }
      continue;
    }
    ctx.setLineDash([px(7), px(4)]); ctx.lineWidth = px(2);
    ctx.strokeStyle = n.connected ? rgba(COL.g, .75) : rgba(COL.amber, .45); line(P); ctx.stroke();
    if (!n.connected || typeof trkDraw === 'function') continue;   // 有补给卡车模块时画真实的卡车（trucks.js）
    // 车队：沿运输线向前线移动的光点（近看为小卡车）
    const L = [0];
    for (let i = 1; i < P.length; i++) L.push(L[i - 1] + dist(P[i - 1][0], P[i - 1][1], P[i][0], P[i][1]));
    const tot = L[L.length - 1];
    if (tot < 1) continue;
    ctx.setLineDash([]);
    for (let k = 0; k < 3; k++) {
      const s = ((time * 26 / tot + k / 3 + n.id * .137) % 1) * tot;
      let i = 1;
      while (i < L.length - 1 && L[i] < s) i++;
      const l = L[i] - L[i - 1] || 1, u = (s - L[i - 1]) / l, x = lerp(P[i - 1][0], P[i][0], u), y = lerp(P[i - 1][1], P[i][1], u);
      if (near) {
        const a = Math.atan2(P[i][1] - P[i - 1][1], P[i][0] - P[i - 1][0]);
        ctx.save(); ctx.translate(x, y); ctx.rotate(a);
        const rl = realLook();   // 写实：运输线上的橄榄绿卡车
        ctx.fillStyle = rl ? '#5c663d' : 'rgba(2,10,6,.9)'; ctx.fillRect(-3, -1.6, 6, 3.2);
        ctx.strokeStyle = rl ? 'rgba(0,0,0,.55)' : rgba(COL.g, .9); ctx.lineWidth = px(1); ctx.strokeRect(-3, -1.6, 6, 3.2);
        ctx.fillStyle = rl ? RLP.p.hull : rgba(COL.g, .9); ctx.fillRect(1.6, -1.6, 1.4, 3.2);
        ctx.restore();
      } else { ctx.fillStyle = rgba(COL.g, .9); ctx.fillRect(x - px(1.5), y - px(1.5), px(3), px(3)); }
    }
  }
  ctx.setLineDash([]);
  for (const n of N) snDrawNode(ctx, n, time);
  ctx.restore();
}

// 补给点图标：托盘上两箱一箱（远景简化为方块加十字）；建造进度环、受损血条、被毁残骸
function snDrawNode(ctx, n, time) {
  const s = Math.max(6, px(7)), x = n.x, y = n.y, live = snLive(n);
  const col = n.dead ? COL.enemy : !live ? COL.g : n.connected ? COL.g : COL.amber;
  ctx.setLineDash([]);
  if (n.dead && !(n.built > 0)) {   // 残骸
    ctx.strokeStyle = rgba(COL.enemy, .55); ctx.lineWidth = px(1.2); ctx.fillStyle = 'rgba(2,10,6,.7)';
    for (const [dx, dy, w] of [[-.7, .2, .45], [.35, -.35, .4], [.2, .55, .35]]) { ctx.fillRect(x + dx * s - w * s / 2, y + dy * s - w * s / 2, w * s, w * s); ctx.strokeRect(x + dx * s - w * s / 2, y + dy * s - w * s / 2, w * s, w * s); }
    ctx.beginPath(); ctx.moveTo(x - s * .5, y - s * .5); ctx.lineTo(x + s * .5, y + s * .5); ctx.moveTo(x + s * .5, y - s * .5); ctx.lineTo(x - s * .5, y + s * .5); ctx.stroke();
    return;
  }
  const ghost = !live, a = ghost ? .35 + .15 * Math.sin(time * 3) : .95, k = s / 5;
  ctx.lineWidth = px(ghost ? 1 : 1.3);
  if (ghost) ctx.setLineDash([px(2), px(2)]);
  ctx.strokeStyle = rgba(col, a); ctx.fillStyle = ghost ? 'rgba(2,10,6,.35)' : 'rgba(2,10,6,.85)';
  if (s * R.s < 9) {   // 远景：方块 + 十字
    ctx.fillRect(x - s * .8, y - s * .8, s * 1.6, s * 1.6); ctx.strokeRect(x - s * .8, y - s * .8, s * 1.6, s * 1.6);
    ctx.beginPath(); ctx.moveTo(x - s * .45, y); ctx.lineTo(x + s * .45, y); ctx.moveTo(x, y - s * .45); ctx.lineTo(x, y + s * .45); ctx.stroke();
  } else {
    const box = (bx, by, w, h) => {
      ctx.fillRect(x + bx * k, y + by * k, w * k, h * k); ctx.strokeRect(x + bx * k, y + by * k, w * k, h * k);
      if (!ghost) { ctx.beginPath(); ctx.moveTo(x + bx * k, y + (by + h / 2) * k); ctx.lineTo(x + (bx + w) * k, y + (by + h / 2) * k); ctx.moveTo(x + (bx + w / 2) * k, y + by * k); ctx.lineTo(x + (bx + w / 2) * k, y + (by + h) * k); ctx.stroke(); }
    };
    ctx.beginPath(); ctx.moveTo(x - 5.6 * k, y + 4.2 * k); ctx.lineTo(x + 5.6 * k, y + 4.2 * k); ctx.stroke();   // 托盘
    box(-5.2, -.6, 4.8, 4.4); box(.4, -.6, 4.8, 4.4); box(-2.4, -5.2, 4.8, 4.2);
  }
  ctx.setLineDash([]);
  if (!live) {   // 建造 / 重建进度
    ctx.strokeStyle = rgba(COL.amber, .35); ctx.lineWidth = px(1); ctx.beginPath(); ctx.arc(x, y, s * 1.45, 0, 7); ctx.stroke();
    if (n.built > 0) { ctx.strokeStyle = COL.amber; ctx.lineWidth = px(2.2); ctx.beginPath(); ctx.arc(x, y, s * 1.45, -1.57, -1.57 + n.built * 6.283); ctx.stroke(); }
  } else {   // 存量条（卡车送来的弹药、油料）：见底时闪红
    const w = s * 1.8, yb = y - s * 1.35, st = clamp(n.stock ?? 1, 0, 1);
    ctx.fillStyle = 'rgba(2,10,6,.7)'; ctx.fillRect(x - w / 2, yb, w, px(2.2));
    ctx.fillStyle = st <= .03 ? rgba(COL.enemy, .5 + .4 * Math.sin(time * 8)) : st < .3 ? COL.amber : rgba(COL.g, .9); ctx.fillRect(x - w / 2, yb, st <= .03 ? w : w * st, px(2.2));
  }
  if (live && n.hp < n.maxhp) {
    const w = s * 1.8, yb = y + s * 1.15;
    ctx.fillStyle = rgba(COL.enemy, .35); ctx.fillRect(x - w / 2, yb, w, px(2));
    ctx.fillStyle = n.hp < n.maxhp * .4 ? COL.enemy : COL.amber; ctx.fillRect(x - w / 2, yb, w * clamp(n.hp / n.maxhp, 0, 1), px(2));
  }
}
