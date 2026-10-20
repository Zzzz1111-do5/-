'use strict';
// 输入：选择、指令、编组、镜头（滚轮缩放、中键/Alt 拖动、方向键、触屏双指）
const U = { tool: null, mouse: null, box: null, down: null, hoverText: '', logKey: null, level: 'hard', touches: new Map(), pinch: null, grpT: {} };
const $ = id => document.getElementById(id);
const selTeams = () => S.sel.map(id => S.teams.find(q => q.id === id)).filter(Boolean);
const selShips = () => S.sel.map(id => S.ships.find(s => s.id === id)).filter(s => s && alive(s));
const selDD = () => S.sel.includes('DD') && S.dd.state !== 'sunk';
const movable = s => s.state === 'idle' || s.state === 'move';
const ORDER_NAME = { hold: '坚守', move: '移动', amove: '攻击前进', retreat: '撤退', clear: '排雷剪网' };

function setTool(t) { U.tool = U.tool === t ? null : t; updateHud(); }
function evPos(e) { const r = R.cv.getBoundingClientRect(); return { sx: e.clientX - r.left, sy: e.clientY - r.top }; }

function pickAt(p) {
  let best = null, bd = px(14);
  for (const q of S.teams) if (q.side === 'p') { const d = dist(p.x, p.y, q.x, q.y); if (d < bd) { bd = d; best = q.id; } }
  if (best) return best;
  bd = px(18);
  for (const s of S.ships) if (alive(s)) { const d = dist(p.x, p.y, s.x, s.y); if (d < bd) { bd = d; best = s.id; } }
  if (S.dd.state !== 'sunk' && dist(p.x, p.y, S.dd.x, S.dd.y) < Math.max(bd, px(20))) best = 'DD';
  return best;
}

function issueOrder(p, mode) {
  const teams = selTeams(), ships = selShips().filter(movable);
  let n = 0;
  if (teams.length) n += orderTeams(mode === 'clear' ? teams.filter(q => q.kind === 'eng') : teams, p.x, p.y, mode || 'move');
  if (ships.length) n += orderShips(ships, p.x, p.y);
  if (selDD() && orderDD(p.x, p.y)) n++;
  return n;
}

function applyTool(p) {
  const t = U.tool;
  if (t === 'move' || t === 'amove' || t === 'clear') { if (issueOrder(p, t)) U.tool = null; }
  else if (t === 'fire') ddFire(p.x, p.y, false);
  else if (t === 'smoke') { if (ddFire(p.x, p.y, true)) U.tool = null; }
  else if (t === 'recon' || t === 'strike') { if (launchPlane(t, p.x, p.y)) U.tool = null; }
  else if (t === 'rline') {
    const s = S.ships.find(s => s.state === 'beached' && dist(s.x, s.y, p.x, p.y) < 25);
    if (!s) log('请点选一艘已抢滩的登陆舰作为增援线终点', 'warn', 'rl0', 2);
    else if (buildRLine(s)) U.tool = null;
  }
  updateHud();
}

function hoverAt(p) {
  const r = px(12), D = S.dd;
  for (const q of S.teams) if (q.side === 'p' && dist(p.x, p.y, q.x, q.y) < r)
    return `${teamName(q)} · ${q.men.map(m => ROLE_NAME[m]).join('/')} · 弹药 ${q.ammo | 0} · ${q.sup >= 60 ? '被压制' : q.sup > 25 ? '受压' : '状态良好'} · ${ORDER_NAME[q.order.t]}`;
  for (const s of S.ships) if (alive(s) && dist(p.x, p.y, s.x, s.y) < r * 1.4)
    return `${s.label} ${SHIP_SPEC[s.kind].name} · 船体 ${Math.max(0, s.hp).toFixed(1)}/${s.maxhp} · ${{ idle: '待命', move: '航行', unloading: '卸载中', beached: '已抢滩' }[s.state]}${s.load.teams ? ` · 载 ${s.load.teams * 3 + s.load.eng} 人` : ''}`;
  if (D.state !== 'sunk' && dist(p.x, p.y, D.x, D.y) < r * 1.6) return `DD-17 驱逐舰 · 船体 ${D.hull}/3 · 射程 1000 · 每次射击 70% 暴露`;
  for (const e of S.enemies) {
    const vis = inVision(e.x, e.y), x = vis ? e.x : e.kx, y = vis ? e.y : e.ky;
    if (x != null && dist(p.x, p.y, x, y) < r) return ENEMY_SPEC[e.kind].name + (e.dead ? ' · 已摧毁' : vis ? (e.moving ? ' · 正在转移' : e.sup > 40 ? ' · 被压制' : '') : ' · 已标定（视野外，可能已转移）');
  }
  for (const q of S.teams) if (q.side === 'e' && inVision(q.x, q.y) && dist(p.x, p.y, q.x, q.y) < r) return `敌步兵 · ${q.men.length} 人${q.sup >= 60 ? ' · 被压制' : ''}${q.inTrench ? ' · 战壕内' : ''}`;
  for (const pt of S.points) if (dist(p.x, p.y, pt.x, pt.y) < 22) return `据点「${pt.name}」${'★'.repeat(pt.vp)} · ${pt.owner === 'p' ? '我方控制' : '敌方控制'} · ${Math.round(pt.prog * 100)}%`;
  for (const m of S.mines) if (m.known && m.clr < 1 && dist(p.x, p.y, m.x, m.y) < m.r) return `雷区（已标定）${m.clr > 0 ? ` · 已排除 ${Math.round(m.clr * 100)}%` : ' · 派工兵排除'}`;
  for (const w of S.wire) if (w.known && !w.cut && segDist(p.x, p.y, w.x0, w.y0, w.x1, w.y1) < 8) return '铁丝网 · 通过极慢，工兵或爆炸可破除';
  for (const o of S.obst) if (o.known && !o.dead && dist(p.x, p.y, o.x, o.y) < 8) return '反登陆障碍 · 舰船撞上会受损';
  if (S.smoke.some(s => dist(p.x, p.y, s.x, s.y) < s.r)) return '烟幕 · 遮断双方视线';
  if (p.x < 0 || p.y < 0 || p.x > W || p.y > H) return '';
  const t = typeAt(p.x, p.y);
  return `${gridRef(p.x, p.y)} · ${TP[t].n}${isWater(t) ? '' : ` · 高程 ${Math.round(elevAt(p.x, p.y) * 60)}m`}${PV[ci(p.x, p.y)] ? '' : ' · 视野外'}`;
}

function selectGroup(n) {
  S.sel = S.groups[n].filter(id => id === 'DD' ? S.dd.state !== 'sunk' : byId(id) && (byId(id).men ? true : alive(byId(id))));
  const now = performance.now();
  if (now - (U.grpT[n] || 0) < 400 && S.sel.length) {
    const objs = S.sel.map(id => id === 'DD' ? S.dd : byId(id));
    camCenter(objs.reduce((a, o) => a + o.x, 0) / objs.length, objs.reduce((a, o) => a + o.y, 0) / objs.length);
  }
  U.grpT[n] = now;
  updateHud();
}
function assignGroup(n) {
  if (!S.sel.length) { log('先选中部队或舰船，再编入编组', 'warn', 'grp', 2); return updateHud(); }
  for (const g in S.groups) S.groups[g] = S.groups[g].filter(id => !S.sel.includes(id));
  S.groups[n] = S.sel.slice();
  log(`已编入 G${n}（${S.sel.length} 个单位）`, 'info');
  updateHud();
}
function selectUnit() {
  const ts = selTeams();
  if (!ts.length) return;
  const units = new Set(ts.map(q => q.unit));
  S.sel = S.teams.filter(q => q.side === 'p' && units.has(q.unit)).map(q => q.id);
  updateHud();
}
const ordersNow = t => { const ts = selTeams(); if (ts.length) orderTeams(ts, 0, 0, t); updateHud(); };
function togglePause() { if (!S.over) { S.paused = !S.paused; updateHud(); } }
function toggleAuto() { S.dd.auto = !S.dd.auto; log(S.dd.auto ? '驱逐舰自动掩护开启：每次射击仍有 70% 概率暴露' : '驱逐舰自动掩护关闭', 'info'); updateHud(); }

function finishSelect(p, add, touch) {
  if (U.box) {
    const b = U.box, inB = o => o.x >= b.x0 && o.x <= b.x1 && o.y >= b.y0 && o.y <= b.y1;
    let ids = S.teams.filter(q => q.side === 'p' && inB(q)).map(q => q.id);
    if (!ids.length) ids = S.ships.filter(s => movable(s) && inB(s)).map(s => s.id);
    if (S.dd.state !== 'sunk' && inB(S.dd)) ids.push('DD');
    S.sel = add ? [...new Set([...S.sel, ...ids])] : ids;
  } else {
    const id = pickAt(p);
    if (id != null) S.sel = add ? (S.sel.includes(id) ? S.sel.filter(i => i !== id) : [...S.sel, id]) : [id];
    else if (!add) S.sel = [];
    if (touch) U.hoverText = id == null ? hoverAt(p) : '';
  }
  U.box = null;
  updateHud();
}
