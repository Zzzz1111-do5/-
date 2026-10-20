'use strict';
// 界面：输入、指令、编组、HUD、主循环
const U = { tool: null, mouse: null, box: null, down: null, hoverText: '', logKey: null };
const $ = id => document.getElementById(id);
const CARDS = [
  { k: 'assault', name: '突击登陆舰', note: '15 人 · 5 个小队', key: 'Q', svg: '<polygon points="12,3 21,20 3,20"/>' },
  { k: 'supply', name: '补给登陆舰', note: '4 小队 + 3 工兵 · 抢滩即建补给线', key: 'W', svg: '<polygon points="12,3 21,20 3,20"/><polygon class="f" points="12,11 15,17 9,17"/>' },
  { k: 'rline', name: '增援线', note: '点选已抢滩的舰', key: 'E', svg: '<path d="M4 21 L20 4" stroke-dasharray="2 4"/><polygon class="f" points="20,4 14,6 18,10"/>' },
  { k: 'strike', name: '空袭', note: '三连弹 · 会被防空击落', key: 'R', svg: '<path d="M12 3 L20 19 L12 14 L4 19 Z"/>' },
  { k: 'recon', name: '侦察机', note: '纵贯全图 · 视野 20 秒', key: 'T', svg: '<path d="M12 5 L18 18 L12 14 L6 18 Z"/><circle cx="12" cy="12" r="10" stroke-dasharray="2 3"/>' }
];

function setTool(t) {
  U.tool = U.tool === t ? null : t;
  updateHud();
}

function evWorld(e) {
  const r = R.cv.getBoundingClientRect();
  return toWorld(e.clientX - r.left, e.clientY - r.top);
}

function shipAt(p, pred = () => true) {
  let best = null, bd = 16;
  for (const s of S.ships) if (alive(s) && pred(s)) { const d = dist(p.x, p.y, s.x, s.y); if (d < bd) { bd = d; best = s; } }
  return best;
}
const movable = s => s.state === 'idle' || s.state === 'move';

function applyTool(p) {
  const t = U.tool;
  if (t === 'assault' || t === 'supply') { if (deployShip(t, p.x, p.y) && S.cards[t] <= 0) U.tool = null; }
  else if (t === 'rline') {
    const s = shipAt(p, s => s.state === 'beached');
    if (!s) log('请点选一艘已抢滩的登陆舰作为增援线终点', 'warn', 'rl', 2);
    else if (buildRLine(s)) U.tool = null;
    else log('该滩头已有增援线', 'warn', 'rl2', 2);
  } else if (t === 'strike' || t === 'recon') { if (launchPlane(t, p.x, p.y)) U.tool = null; }
  else if (t === 'aim') {
    const D = S.destroyer;
    if (!destroyerFire(p.x, p.y)) log(D.state === 'sunk' ? '驱逐舰已沉没' : D.state === 'repair' ? '驱逐舰损管中，无法射击' : `舰炮装填中（${Math.ceil(D.cool)}s）`, 'warn', 'ddno', 2);
  } else if (t === 'move') { if (orderMove(S.sel, p.x, p.y)) U.tool = null; }
  updateHud();
}

function hoverAt(p) {
  const D = S.destroyer;
  const s = shipAt(p);
  if (s) return `${s.label} ${SHIP_SPEC[s.kind].name} · 船体 ${Math.max(0, s.hp).toFixed(1)}/${s.maxhp} · ${{ idle: '待命', move: '航行', unloading: '卸载中', beached: '已抢滩' }[s.state]}`;
  if (dist(p.x, p.y, D.x, D.y) < 18) return `DD-17 驱逐舰 · 船体 ${D.hull}/3 · 射击有 70% 概率暴露坐标`;
  for (const q of S.squads) if (q.side === 'p' && dist(p.x, p.y, q.x, q.y) < 9)
    return q.kind === 'eng' ? `工兵组 · ${q.men.length} 人${q.working ? ' · 抢修中' : ''}` :
      `第 ${q.no} 小队 · ${q.men.length} 人 · 弹药 ${q.ammo | 0}${q.men.includes('radio') ? '' : ' · 通讯兵阵亡'}`;
  for (const e of S.enemies) if ((e.known || inVision(e.x, e.y)) && dist(p.x, p.y, e.x, e.y) < 12)
    return ENEMY_SPEC[e.kind].name + (e.dead ? ' · 已摧毁' : inVision(e.x, e.y) ? '' : ' · 已标定（视野外）');
  for (const q of S.squads) if (q.side === 'e' && inVision(q.x, q.y) && dist(p.x, p.y, q.x, q.y) < 9) return `敌步兵 · ${q.men.length} 人`;
  for (const o of S.objectives) if (dist(p.x, p.y, o.x, o.y) < 20) return `目标 ${o.key}「${o.name}」· ${o.owner === 'p' ? '我方控制' : '敌方控制'} · ${Math.round(o.prog * 100)}%`;
  if (p.x < 0 || p.y < 0 || p.x > W || p.y > H) return '';
  return `${gridRef(p.x, p.y)} · ${T_NAME[terrainAt(p.x, p.y)]}`;
}

function bindInput() {
  const cv = R.cv;
  cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.addEventListener('pointerdown', e => {
    const p = evWorld(e); U.mouse = p;
    if (e.button === 2) { if (S.sel.length) orderMove(S.sel, p.x, p.y); return; }
    if (e.button !== 0) return;
    if (U.tool) { applyTool(p); return; }
    U.down = { x: p.x, y: p.y, shift: e.shiftKey };
    cv.setPointerCapture(e.pointerId);
  });
  cv.addEventListener('pointermove', e => {
    const p = evWorld(e); U.mouse = p;
    if (U.down && dist(p.x, p.y, U.down.x, U.down.y) > 6)
      U.box = { x0: Math.min(p.x, U.down.x), y0: Math.min(p.y, U.down.y), x1: Math.max(p.x, U.down.x), y1: Math.max(p.y, U.down.y) };
    U.hoverText = e.pointerType === 'mouse' ? hoverAt(p) : '';
  });
  cv.addEventListener('pointerup', e => {
    if (!U.down) return;
    const p = evWorld(e), add = U.down.shift;
    if (U.box) {
      const b = U.box, ids = S.ships.filter(s => movable(s) && s.x >= b.x0 && s.x <= b.x1 && s.y >= b.y0 && s.y <= b.y1).map(s => s.id);
      S.sel = add ? [...new Set([...S.sel, ...ids])] : ids;
    } else {
      const s = shipAt(p, movable);
      if (s) S.sel = add ? (S.sel.includes(s.id) ? S.sel.filter(i => i !== s.id) : [...S.sel, s.id]) : [s.id];
      else if (!add) { S.sel = []; if (e.pointerType !== 'mouse') U.hoverText = hoverAt(p); }
    }
    U.down = null; U.box = null;
    updateHud();
  });
  cv.addEventListener('pointerleave', () => { U.mouse = null; U.hoverText = ''; });

  window.addEventListener('keydown', e => {
    if (e.target.closest && e.target.closest('input,textarea')) return;
    const k = e.key.toUpperCase();
    if (e.code === 'Space') { e.preventDefault(); togglePause(); }
    else if (/^Digit[1-4]$/.test(e.code)) {
      e.preventDefault();
      const n = e.code.slice(5);
      e.ctrlKey || e.metaKey || e.altKey ? assignGroup(n) : selectGroup(n);
    } else if (k === 'ESCAPE') { U.tool = null; S.sel = []; updateHud(); }
    else if (k === 'F') setTool('aim');
    else if (k === 'G') toggleAuto();
    else if (k === 'M') setTool('move');
    else { const c = CARDS.find(c => c.key === k); if (c && S.cards[c.k] > 0) setTool(c.k); }
  });
}

function selectGroup(n) {
  S.sel = S.groups[n].filter(id => { const s = shipById(id); return s && movable(s); });
  updateHud();
}
function assignGroup(n) {
  if (!S.sel.length) { log('先选中登陆舰，再编入编组', 'warn', 'grp', 2); return updateHud(); }
  for (const g in S.groups) S.groups[g] = S.groups[g].filter(id => !S.sel.includes(id));
  S.groups[n] = S.sel.slice();
  log(`${S.sel.length} 艘登陆舰编入 G${n}`, 'info');
  updateHud();
}
function togglePause() { if (!S.over) { S.paused = !S.paused; updateHud(); } }
function toggleAuto() {
  S.destroyer.auto = !S.destroyer.auto;
  log(S.destroyer.auto ? '驱逐舰自动掩护开启：每次射击仍有 70% 概率暴露' : '驱逐舰自动掩护关闭', 'info');
  updateHud();
}
