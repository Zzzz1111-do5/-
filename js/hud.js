'use strict';
// HUD（全战风格）：底部单位卡、右下指令图标、顶部据点图标条、左上事件、开始战斗
const ICON = {
  move: '<path d="M4 12h14M13 6l6 6-6 6"/>',
  amove: '<path d="M3 12h11M9 7l5 5-5 5"/><path d="M19 8v8M15 12h8"/>',
  charge: '<path d="M3 6l6 6-6 6M10 6l6 6-6 6M19 5v14"/>',
  hold: '<path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z"/>',
  retreat: '<path d="M20 12H6M11 6l-6 6 6 6"/>',
  clear: '<circle cx="12" cy="14" r="5"/><path d="M12 4v5M6 7l2.5 3M18 7l-2.5 3M4 21L20 5"/>',
  line: '<g class="f"><rect x="2" y="10" width="4" height="4"/><rect x="7.5" y="10" width="4" height="4"/><rect x="13" y="10" width="4" height="4"/><rect x="18.5" y="10" width="3.5" height="4"/></g>',
  wedge: '<g class="f"><path d="M12 3l3 4h-6z"/><path d="M6 11l3 4H3z"/><path d="M18 11l3 4h-6z"/><path d="M12 15l3 4h-6z"/></g>',
  loose: '<g class="f"><rect x="2" y="7" width="3.5" height="3.5"/><rect x="11" y="7" width="3.5" height="3.5"/><rect x="19" y="7" width="3" height="3.5"/><rect x="6.5" y="14" width="3.5" height="3.5"/><rect x="15" y="14" width="3.5" height="3.5"/></g>',
  fire: '<path d="M4 20l9-9M11 7l6-4 4 4-4 6z"/><circle cx="5" cy="19" r="1.5" class="f"/>',
  smoke: '<path d="M7 18a4 4 0 010-8 5 5 0 019.5-1.5A4 4 0 1117 18z"/>',
  recon: '<path d="M12 2v20M5 9l7-3 7 3M8 18l4-2 4 2"/><circle cx="12" cy="12" r="9" stroke-dasharray="2 3"/>',
  strike: '<path d="M12 2v13M4 9l8-3 8 3M8 14l4-2 4 2"/><circle cx="12" cy="20" r="2" class="f"/>',
  rline: '<path d="M4 20L18 6" stroke-dasharray="2.5 3"/><path d="M12 5h7v7"/>',
  auto: '<path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z"/><circle cx="12" cy="11" r="2.5" class="f"/>',
  ship: '<path d="M12 4l8 15H4z"/>', supply: '<path d="M12 4l8 15H4z"/><path class="f" d="M12 11l3 5H9z"/>',
  dd: '<path d="M12 3l8 6-3 10H7L4 9z"/><path d="M12 8l3 2.3-1.2 3.7h-3.6L9 10.3z"/>',
  assault: '<path class="f" d="M12 5l6 11H6z"/><circle cx="6" cy="20" r="1.4" class="f"/><circle cx="12" cy="20" r="1.4" class="f"/><circle cx="18" cy="20" r="1.4" class="f"/>',
  reserve: '<path class="f" d="M12 4l6 7-6 7-6-7z"/>', eng: '<circle cx="12" cy="12" r="6"/><path d="M8 16l8-8"/>',
  exit: '<path d="M4 14a4 4 0 018 0M12 14a4 4 0 018 0"/><path d="M3 19l2-3 2 3M9 19l2-3 2 3M15 19l2-3 2 3"/>',
  hq: '<rect x="3" y="7" width="18" height="13" stroke-dasharray="3 1.5"/><rect x="6" y="11" width="6" height="5"/><path d="M16 18V3l5 2-5 2"/>',
  town: '<rect x="3" y="11" width="6" height="9"/><rect x="10" y="8" width="5" height="12"/><rect x="16" y="13" width="5" height="7"/><path d="M12.5 3v5M11 5h3"/>',
  radar: '<path d="M5 12a7 7 0 0110-6"/><path d="M10 10l-3 10h8l-3-10"/><path d="M14 4l5-2"/>',
  battery: '<path d="M3 12a3.5 3.5 0 017 0zM10.5 14a3.5 3.5 0 017 0zM14 12a3.5 3.5 0 017 0z"/><path d="M6.5 12v8M14 14v7M17.5 12v8"/>',
  bridge: '<path d="M2 10h20M2 15h20M5 10v5M10 10v5M14 10v5M19 10v5"/>',
  cross: '<path d="M12 2v20M2 12h20"/><circle cx="12" cy="12" r="6" stroke-dasharray="3 2"/>',
  village: '<rect x="4" y="6" width="6" height="5"/><rect x="13" y="8" width="6" height="5"/><path d="M7 15v7M17 15v7"/>',
  ford: '<rect x="3" y="10" width="3" height="3"/><rect x="8" y="12" width="3" height="3"/><rect x="13" y="10" width="3" height="3"/><rect x="18" y="12" width="3" height="3"/>'
};
const svg = (k, cls = '') => `<svg viewBox="0 0 24 24" class="ic ${cls}" aria-hidden="true">${ICON[k]}</svg>`;
const BTN = [
  ['orders', [['move', '移动（右键 · 拖拽定宽与朝向）', 'M', () => setTool('move')], ['amove', '攻击前进：遇敌停下交火', 'A', () => setTool('amove')],
    ['charge', '冲锋：直扑敌阵，白刃与手榴弹', 'Q', () => setTool('charge')], ['hold', '坚守：就地构筑掩体', 'H', () => ordersNow('hold')],
    ['retreat', '撤退至滩头', 'X', () => ordersNow('retreat')], ['clear', '工兵排雷、剪铁丝网', 'N', () => setTool('clear')]]],
  ['forms', [['line', '横队：火力正面最宽', 'Z', () => formNow('line')], ['wedge', '三三制楔形：三人成组、三组成三角', 'C', () => formNow('wedge')],
    ['loose', '散开：降低炮火伤亡', 'B', () => formNow('loose')]]],
  ['support', [['fire', '舰炮射击：每发 70% 暴露坐标', 'F', () => setTool('fire')], ['smoke', '烟幕弹：遮断双方视线', 'S', () => setTool('smoke')],
    ['recon', '侦察机：纵贯全图', 'R', () => setTool('recon')], ['strike', '空袭：三连弹', 'T', () => setTool('strike')],
    ['rline', '开辟增援线', 'E', () => setTool('rline')], ['auto', '驱逐舰自动掩护', 'G', toggleAuto]]]
];
const ASSET = { smoke: 'smoke', recon: 'recon', strike: 'strike', rline: 'rline' };

function buildHud() {
  for (const [grp, list] of BTN) $(grp).innerHTML = list.map(([k, tip, key]) =>
    `<button class="ib" id="b-${k}" type="button" title="${tip}（${key}）" aria-label="${tip}">${svg(k)}<kbd>${key}</kbd>${ASSET[k] ? `<em id="n-${k}"></em>` : ''}</button>`).join('');
  for (const [, list] of BTN) for (const [k, , , fn] of list) $('b-' + k).addEventListener('click', fn);
  $('btnPause').addEventListener('click', togglePause);
  $('btnSpeed').addEventListener('click', () => { S.speed = S.speed === 1 ? 2 : S.speed === 2 ? 4 : 1; updateHud(); });
  $('btnHelp').addEventListener('click', () => { $('brief').hidden = false; });
  $('btnStart').addEventListener('click', () => { startBattle(); updateHud(); });
  $('zIn').addEventListener('click', () => camZoomAt(CAM.vw / 2, CAM.vh / 2, 1.3));
  $('zOut').addEventListener('click', () => camZoomAt(CAM.vw / 2, CAM.vh / 2, .77));
  $('zFit').addEventListener('click', () => { CAM.z = CAM.fit; camClamp(); });
  for (const b of document.querySelectorAll('#diff button')) b.addEventListener('click', () => { U.level = b.dataset.lv; updateHud(); });
  $('btnBrief').addEventListener('click', () => { if (S.phase === 'deploy' && S.level !== U.level) restart(false); S.briefed = true; $('brief').hidden = true; updateHud(); });
  $('btnNew').addEventListener('click', e => {
    const b = e.currentTarget;
    if (b.dataset.armed) { restart(true); return; }
    b.dataset.armed = '1'; b.classList.add('hot');
    setTimeout(() => { delete b.dataset.armed; b.classList.remove('hot'); }, 2500);
  });
  $('btnAgain').addEventListener('click', () => restart(true));
  $('cards').addEventListener('pointerdown', e => {   // 卡片会随战况重建，用 pointerdown 保证点得中
    const c = e.target.closest('.uc'); if (!c) return;
    const id = c.dataset.id === 'DD' ? 'DD' : +c.dataset.id;
    S.sel = e.shiftKey || e.ctrlKey ? (S.sel.includes(id) ? S.sel.filter(i => i !== id) : [...S.sel, id]) : [id];
    updateHud();
  });
  $('cards').addEventListener('dblclick', () => centerOnSel());
  $('objs').addEventListener('click', e => { const c = e.target.closest('[data-k]'); if (c) { const p = S.points.find(p => p.key === c.dataset.k); camCenter(p.x, p.y); } });
  $('feed').addEventListener('click', e => { const c = e.target.closest('[data-x]'); if (c) camCenter(+c.dataset.x, +c.dataset.y); });
  mmBind($('mm'));
  const LEG = [['ship', '突击登陆舰'], ['supply', '补给登陆舰'], ['dd', '驱逐舰'], ['assault', '步兵连'], ['eng', '工兵'], ['reserve', '增援班'],
    ['exit', '滩头出口'], ['battery', '岸防炮台'], ['radar', '雷达站'], ['bridge', '桥梁'], ['cross', '十字路口'], ['town', '镇中心'], ['village', '渔村'], ['ford', '渡口'], ['hq', '指挥所']];
  $('legend').innerHTML = LEG.map(([k, n], i) => `<span class="${i > 5 ? 'e' : ''}">${svg(k)}${n}</span>`).join('');
}

function restart(briefed) {
  newGame(undefined, U.level);
  S.briefed = briefed; U.tool = null; U.logKey = null; U.cardKey = null; MX.seed = null;
  mmInit($('mm')); updateVision();
  CAM.x = W / 2; CAM.y = STAGING_Y + 120; CAM.z = CAM.fit * 2.2; camClamp();
  delete $('btnNew').dataset.armed;
  updateHud();
}

function cardList() {
  const out = [];
  for (const u of S.units) if (u.side === 'p' && teamsOf(u).length) out.push({ id: u.id, k: u.kind === 'eng' ? 'eng' : u.emblem === 'reserve' ? 'reserve' : 'assault', u });
  for (const s of S.ships) if (alive(s) && s.state !== 'beached') out.push({ id: s.id, k: s.kind === 'supply' ? 'supply' : 'ship', s });
  if (S.dd.state !== 'sunk') out.push({ id: 'DD', k: 'dd' });
  return out;
}

function updateCards() {
  const list = cardList(), key = list.map(c => c.id).join(',');
  if (key !== U.cardKey) {
    U.cardKey = key;
    $('cards').innerHTML = list.map(c => `<button class="uc" type="button" data-id="${c.id}">${svg(c.k, 'em')}<b></b><span class="bars"><i class="s"><i></i></i><i class="m"><i></i></i><i class="a"><i></i></i></span><span class="gp"></span><span class="st"></span></button>`).join('');
  }
  const els = $('cards').children;
  list.forEach((c, i) => {
    const el = els[i], [b, bars, gp, st] = [el.children[1], el.children[2], el.children[3], el.children[4]], set = (j, v) => { bars.children[j].firstChild.style.width = clamp(v, 0, 1) * 100 + '%'; };
    el.classList.toggle('sel', isSel(c.id));
    let state = '';
    if (c.u) {
      const ts = teamsOf(c.u), ammo = ts.reduce((a, q) => a + q.ammo, 0) / ts.length;
      b.textContent = c.u.men; set(0, c.u.men / c.u.men0); set(1, c.u.morale / 100); set(2, c.u.kind === 'eng' ? 1 : ammo / 60);
      state = c.u.state;
      st.innerHTML = svg(c.u.order === 'retreat' || c.u.state === 'rout' ? 'retreat' : c.u.order === 'charge' ? 'charge' : c.u.order === 'amove' ? 'amove' : c.u.order === 'hold' ? 'hold' : 'move', 'mini');
    } else if (c.s) {
      b.textContent = c.s.load.teams * 3 + c.s.load.eng; set(0, c.s.hp / c.s.maxhp); set(1, 0); set(2, 0);
      st.innerHTML = svg(c.s.plan || c.s.state === 'move' ? 'move' : 'hold', 'mini');
    } else {
      const D = S.dd;
      b.textContent = D.hull; set(0, D.hull / 3); set(1, D.state === 'repair' ? D.repairT / D.repairDur : 1 - D.cool / 5); set(2, 0);
      state = D.state === 'repair' ? 'waver' : S.t < D.exposedUntil ? 'rout' : 'ok';
      st.innerHTML = svg(D.auto ? 'auto' : 'fire', 'mini');
    }
    el.classList.toggle('waver', state === 'waver'); el.classList.toggle('rout', state === 'rout');
    const g = groupOf(c.id); gp.textContent = g ? '•'.repeat(g) : '';
  });
}

function updateHud() {
  const D = S.dd, deploy = S.phase === 'deploy';
  $('clock').textContent = fmtT(S.t);
  $('btnPause').innerHTML = S.paused || deploy ? '▶' : '❚❚';
  $('btnPause').classList.toggle('hot', S.paused && !deploy);
  $('btnSpeed').textContent = S.speed + '×';
  $('deploy').hidden = !deploy || !S.briefed;
  $('pauseBand').hidden = deploy || !S.paused || !!S.over || !S.briefed;
  for (const b of document.querySelectorAll('#diff button')) { b.classList.toggle('on', b.dataset.lv === U.level); b.setAttribute('aria-checked', b.dataset.lv === U.level); }
  const units = selUnits(), ships = selShips(), hasU = units.length > 0;
  for (const [grp, list] of BTN) for (const [k] of list) {
    const el = $('b-' + k);
    let dis = false;
    if (grp === 'orders') dis = k === 'clear' ? !units.some(u => u.kind === 'eng') : k === 'move' ? !(hasU || ships.length || selDD()) : !hasU || deploy;
    if (grp === 'forms') dis = !(hasU || (deploy && ships.length));
    if (grp === 'support') dis = deploy || (ASSET[k] && S.assets[ASSET[k]] <= 0) || ((k === 'fire' || k === 'smoke' || k === 'auto') && D.state === 'sunk');
    el.disabled = dis;
    el.classList.toggle('on', k === 'auto' ? D.auto : U.tool === k || (grp === 'forms' && (units.length ? units.every(u => u.form === k) : ships.length && ships.every(s => s.form === k))));
    if (ASSET[k]) $('n-' + k).textContent = S.assets[ASSET[k]];
  }
  $('reserve').textContent = S.assets.reserve;
  $('objs').innerHTML = S.points.map(p => `<button type="button" class="ob ${p.owner}${p.contested ? ' hot' : ''}" data-k="${p.key}" title="${p.name}">${svg(PKIND(p.key))}<i style="width:${p.prog * 100}%"></i></button>`).join('') +
    (S.holdT ? `<span class="hold"><i style="width:${S.holdT / HOLD * 100}%"></i></span>` : '');
  updateCards();
  const lk = S.log.length && S.log[0].id;
  if (lk !== U.logKey || S.t - (U.feedT || 0) > 1) {
    U.logKey = lk; U.feedT = S.t;
    $('feed').innerHTML = S.log.filter(l => S.t - l.t < 14).slice(0, 5).map(l => `<li class="${l.kind}" ${l.x != null ? `data-x="${l.x}" data-y="${l.y}"` : ''}>${l.msg}</li>`).join('');
  }
  $('end').hidden = !S.over;
  if (S.over) {
    if ($('endTitle').dataset.over !== S.over) { $('endTitle').dataset.over = S.over; decode($('endTitle'), S.over === 'win' ? '登陆场已巩固' : '登陆失败', 900); }
    $('endTitle').className = S.over;
    const own = S.points.filter(p => p.owner === 'p').length;
    $('endStats').innerHTML = [['守军 AI', DIFF[S.level].name], ['作战用时', fmtT(S.t)], ['夺取据点', `${own} / ${S.points.length}`], ['我方伤亡', S.stats.lost + ' 人'],
      ['歼敌', S.stats.killed + ' 人'], ['摧毁火力点', S.stats.structs + ' 处'], ['驱逐舰', D.state === 'sunk' ? '沉没' : `船体 ${D.hull}/3`]]
      .map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('');
  }
}
