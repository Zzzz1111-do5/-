'use strict';
// HUD：指挥栏、侧栏面板、简报与结算、主循环与启动
const CMD = [
  { id: 'move', name: '移动', key: 'M', note: '行进间射击', tool: 'move' },
  { id: 'amove', name: '攻击前进', key: 'A', note: '遇敌停下交火', tool: 'amove' },
  { id: 'hold', name: '坚守', key: 'H', note: '就地构筑掩体', act: () => ordersNow('hold') },
  { id: 'retreat', name: '撤退', key: 'X', note: '撤回最近滩头', act: () => ordersNow('retreat') },
  { id: 'clear', name: '排雷剪网', key: 'C', note: '仅工兵', tool: 'clear' },
  { id: 'unit', name: '选同船', key: '双击', note: '同一艘船的小组', act: selectUnit }
];
const SUP = [
  { id: 'fire', name: '舰炮射击', key: 'F', note: '70% 暴露', tool: 'fire' },
  { id: 'smoke', name: '烟幕弹', key: 'V', asset: 'smoke', tool: 'smoke' },
  { id: 'recon', name: '侦察机', key: 'R', asset: 'recon', tool: 'recon' },
  { id: 'strike', name: '空袭', key: 'T', asset: 'strike', tool: 'strike' },
  { id: 'rline', name: '增援线', key: 'E', asset: 'rline', tool: 'rline' },
  { id: 'auto', name: '自动掩护', key: 'G', act: toggleAuto }
];

function buildHud() {
  const btn = c => `<button class="cmd" id="c-${c.id}" type="button"><b>${c.name}</b><kbd>${c.key}</kbd><small id="cn-${c.id}">${c.note || ''}</small></button>`;
  $('orders').innerHTML = CMD.map(btn).join('');
  $('support').innerHTML = SUP.map(btn).join('');
  for (const c of [...CMD, ...SUP]) $('c-' + c.id).addEventListener('click', () => c.tool ? setTool(c.tool) : c.act());
  $('groups').innerHTML = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<div class="grp"><button type="button" class="gsel" id="gsel-${n}">G${n}<span id="gcnt-${n}"></span></button><button type="button" class="gset" id="gset-${n}" title="把选中单位编入 G${n}">编入</button></div>`).join('');
  for (let n = 1; n <= 9; n++) { $('gsel-' + n).addEventListener('click', () => selectGroup(n)); $('gset-' + n).addEventListener('click', () => assignGroup(n)); }
  $('btnPause').addEventListener('click', togglePause);
  $('btnSpeed').addEventListener('click', () => { S.speed = S.speed === 1 ? 2 : S.speed === 2 ? 4 : 1; updateHud(); });
  $('btnHelp').addEventListener('click', () => { $('brief').hidden = false; });
  $('zIn').addEventListener('click', () => camZoomAt(CAM.vw / 2, CAM.vh / 2, 1.3));
  $('zOut').addEventListener('click', () => camZoomAt(CAM.vw / 2, CAM.vh / 2, .77));
  $('zFit').addEventListener('click', () => { CAM.z = CAM.fit; camClamp(); });
  for (const b of document.querySelectorAll('#diff button')) b.addEventListener('click', () => { U.level = b.dataset.lv; updateHud(); });
  $('btnBrief').addEventListener('click', () => {
    if (S.t === 0 && S.level !== U.level) restart(false);
    S.briefed = true; $('brief').hidden = true; updateHud();
  });
  $('btnNew').addEventListener('click', e => {
    const b = e.currentTarget;
    if (b.dataset.armed) { restart(true); return; }
    b.dataset.armed = '1'; b.textContent = '确认重开';
    setTimeout(() => { delete b.dataset.armed; b.textContent = '新战局'; }, 2500);
  });
  $('btnAgain').addEventListener('click', () => restart(true));
  mmBind($('mm'));
}

function restart(briefed) {
  newGame(undefined, U.level);
  S.briefed = briefed; U.tool = null; U.logKey = null; MX.seed = null;
  mmInit($('mm')); updateVision();
  CAM.x = W / 2; CAM.y = H * .62; CAM.z = CAM.fit * 1.6; camClamp();
  const b = $('btnNew'); delete b.dataset.armed; b.textContent = '新战局';
  updateHud();
}

function selSummary() {
  const ts = selTeams(), ships = selShips(), parts = [];
  if (ts.length) {
    const men = ts.reduce((a, q) => a + q.men.length, 0), ammo = ts.reduce((a, q) => a + q.ammo, 0) / ts.length;
    const pin = ts.filter(q => q.sup >= 60).length, radio = ts.filter(q => q.kind === 'inf' && !q.men.includes('radio')).length;
    const ord = {}; for (const q of ts) ord[ORDER_NAME[q.order.t]] = (ord[ORDER_NAME[q.order.t]] || 0) + 1;
    parts.push(`<div class="row"><b>${ts.length} 个三人组 · ${men} 人</b><span class="dim">${[...new Set(ts.map(q => q.unit))].join(' ')}</span></div>
      <div class="kv"><span>平均弹药</span><span class="bar"><i style="width:${ammo / 60 * 100}%"></i></span>
      <span>被压制</span><b class="${pin ? 'warn' : ''}">${pin} 组</b><span>失去通讯兵</span><b class="${radio ? 'warn' : ''}">${radio} 组</b>
      <span>当前指令</span><b>${Object.entries(ord).map(([k, v]) => k + ' ' + v).join(' · ')}</b></div>`);
  }
  for (const s of ships) parts.push(`<div class="row"><span class="tri${s.kind === 'supply' ? ' sup' : ''}"></span><b>${s.label}</b>
    <span>${{ idle: '待命', move: '航行中', unloading: '卸载中', beached: '已抢滩' }[s.state]}</span><span class="dim">载 ${s.load.teams * 3 + s.load.eng} 人</span>
    <span class="bar"><i style="width:${Math.max(0, s.hp / s.maxhp * 100)}%"></i></span></div>`);
  if (selDD()) parts.push(`<div class="row"><b>DD-17 驱逐舰</b><span>右键在海上机动 · F 射击 · V 烟幕</span></div>`);
  return parts.join('') || '<p class="dim">未选中。拖框选择上岸小组或舰船，按 1–9 调出编组，D 选中驱逐舰。</p>';
}

function updateHud() {
  const D = S.dd;
  $('clock').textContent = 'T+' + fmtT(S.t);
  $('remain').textContent = '剩余 ' + fmtT(LIMIT - S.t);
  $('aiLevel').textContent = DIFF[S.level].name;
  for (const b of document.querySelectorAll('#diff button')) { b.classList.toggle('on', b.dataset.lv === U.level); b.setAttribute('aria-checked', b.dataset.lv === U.level); }
  $('btnPause').textContent = S.paused ? '▶ 继续' : '❚❚ 暂停';
  $('btnPause').classList.toggle('hot', S.paused);
  $('btnSpeed').textContent = S.speed + '×';
  $('pauseBand').hidden = !S.paused || !!S.over || !S.briefed;
  const own = S.points.filter(p => p.owner === 'p').length, ashore = S.teams.filter(q => q.side === 'p').reduce((a, q) => a + q.men.length, 0);
  $('force').textContent = `岸上 ${ashore} 人 · 据点 ${own}/${S.points.length}` + (S.holdT ? ` · 巩固 ${Math.ceil(HOLD - S.holdT)}s` : '');
  const hasT = selTeams().length > 0, hasEng = selTeams().some(q => q.kind === 'eng');
  for (const c of CMD) {
    const el = $('c-' + c.id);
    el.disabled = c.id === 'clear' ? !hasEng : c.id === 'move' ? !(hasT || selShips().length || selDD()) : !hasT;
    el.classList.toggle('on', U.tool === c.tool && !!c.tool);
  }
  for (const c of SUP) {
    const el = $('c-' + c.id);
    if (c.asset) $('cn-' + c.id).textContent = '剩余 ' + S.assets[c.asset];
    el.disabled = (c.asset && S.assets[c.asset] <= 0) || ((c.id === 'fire' || c.id === 'smoke' || c.id === 'auto') && D.state === 'sunk');
    el.classList.toggle('on', c.id === 'auto' ? D.auto : U.tool === c.tool);
  }
  $('reserve').textContent = `后备兵力 ${S.assets.reserve} 组 · 经增援线每 15 秒一组`;
  $('toolHint').textContent = {
    move: '右键或点击目标位置：小组按三三制队形移动；舰船落点在海滩即抢滩', amove: '点击目标：遇到敌人停下交火，清除后继续前进',
    clear: '点击雷区或铁丝网：工兵前往排除', fire: `点击射击点（射程 1000）。每发 70% 暴露坐标`, smoke: '点击位置投放烟幕：遮断双方视线 35 秒',
    recon: '点击任意位置：侦察机沿该列纵贯全图，留下 25 秒视野', strike: '点击目标：攻击机自南向北投三枚炸弹', rline: '点选一艘已抢滩的登陆舰作为增援线终点'
  }[U.tool] || (S.sel.length ? '右键下达移动 · A 攻击前进 · H 坚守 · Ctrl+数字编组' : '拖框选择 · 滚轮缩放 · 中键/Alt 拖动或方向键平移 · 空格暂停');
  $('selInfo').innerHTML = selSummary();
  for (let n = 1; n <= 9; n++) {
    const live = S.groups[n].filter(id => id === 'DD' ? D.state !== 'sunk' : byId(id) && (byId(id).men || alive(byId(id)))).length;
    $('gcnt-' + n).textContent = live ? ` · ${live}` : '';
  }
  $('ddHull').innerHTML = [0, 1, 2].map(i => `<i class="${D.hull > i ? 'on' : ''}"></i>`).join('');
  $('ddState').textContent = D.state === 'sunk' ? '已沉没' : D.state === 'repair' ? '损管抢修中 · 无法掩护' : D.cool > 0 ? `装填中 ${Math.ceil(D.cool)}s` : '就绪';
  $('ddState').className = 'ddst ' + D.state;
  $('ddRepair').hidden = D.state !== 'repair';
  $('ddRepairBar').style.width = (D.repairT / D.repairDur * 100) + '%';
  $('ddExposed').hidden = !(S.t < D.exposedUntil);
  $('pts').innerHTML = S.points.map(p => `<div class="pt ${p.owner}${p.contested ? ' hot' : ''}"><b>${p.key}</b><span>${p.name}</span><em>${'★'.repeat(p.vp)}</em><span class="bar"><i style="width:${p.prog * 100}%"></i></span></div>`).join('');
  const lk = S.log.length + '|' + (S.log[0] && S.log[0].t);
  if (lk !== U.logKey) {
    U.logKey = lk;
    $('intel').innerHTML = S.log.slice(0, 18).map(l => `<li class="${l.kind}"><time>${fmtT(l.t)}</time><span>${l.msg}</span></li>`).join('');
    const first = $('intel').querySelector('li span');
    if (first && S.t > 0) decode(first, S.log[0].msg, 450);
  }
  $('end').hidden = !S.over;
  if (S.over) {
    if ($('endTitle').dataset.over !== S.over) { $('endTitle').dataset.over = S.over; decode($('endTitle'), S.over === 'win' ? '登陆场已巩固' : '登陆失败', 900); }
    $('endTitle').className = S.over;
    $('endStats').innerHTML = [['守军 AI', DIFF[S.level].name], ['作战用时', fmtT(S.t)], ['夺取据点', `${own} / ${S.points.length}`], ['我方伤亡', S.stats.lost + ' 人'],
      ['歼敌', S.stats.killed + ' 人'], ['摧毁火力点', S.stats.structs + ' 处'], ['驱逐舰暴露', S.stats.exposed + ' 次'], ['驱逐舰', D.state === 'sunk' ? '沉没' : `船体 ${D.hull}/3`]]
      .map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('');
  }
}
