'use strict';
// HUD 面板、主循环与启动
function buildHud() {
  $('hand').innerHTML = CARDS.map(c => `
    <button class="card" id="card-${c.k}" data-k="${c.k}" type="button">
      <svg viewBox="0 0 24 24" aria-hidden="true">${c.svg}</svg>
      <span class="cn">${c.name}</span><span class="cc" id="cnt-${c.k}"></span>
      <span class="ck">${c.key}</span><span class="cnote">${c.note}</span>
    </button>`).join('') + `
    <div class="card reserve"><span class="cn">增援兵力</span><span class="cc" id="cnt-reinf"></span><span class="cnote">经增援线每 14 秒一队</span></div>
    <button class="card cmd" id="btnMove" type="button"><span class="cn">移动</span><span class="ck">M</span><span class="cnote">触屏下达移动指令</span></button>`;
  for (const c of CARDS) $('card-' + c.k).addEventListener('click', () => { if (S.cards[c.k] > 0) setTool(c.k); });
  $('btnMove').addEventListener('click', () => S.sel.length ? setTool('move') : log('先选中登陆舰', 'warn', 'mv', 2));
  $('groups').innerHTML = [1, 2, 3, 4].map(n => `
    <div class="grp"><button type="button" class="gsel" id="gsel-${n}">G${n}<span id="gcnt-${n}"></span></button>
    <button type="button" class="gset" id="gset-${n}">编入</button></div>`).join('');
  for (const n of [1, 2, 3, 4]) {
    $('gsel-' + n).addEventListener('click', () => selectGroup(n));
    $('gset-' + n).addEventListener('click', () => assignGroup(n));
  }
  $('btnPause').addEventListener('click', togglePause);
  $('btnSpeed').addEventListener('click', () => { S.speed = S.speed === 1 ? 2 : S.speed === 2 ? 4 : 1; updateHud(); });
  $('btnAim').addEventListener('click', () => setTool('aim'));
  $('btnAuto').addEventListener('click', toggleAuto);
  $('btnHelp').addEventListener('click', () => { $('brief').hidden = false; });
  for (const b of document.querySelectorAll('#diff button')) b.addEventListener('click', () => { U.level = b.dataset.lv; updateHud(); });
  $('btnBrief').addEventListener('click', () => {
    // 开局前选的难度立即生效；对局中途改难度则从下一局开始
    if (S.t === 0 && S.ai.level !== U.level) { newGame(undefined, U.level); buildTerrainLayer(); computeVision(); }
    S.briefed = true; $('brief').hidden = true; updateHud();
  });
  $('btnNew').addEventListener('click', e => {
    const b = e.currentTarget;
    if (b.dataset.armed) { restart(); return; }
    b.dataset.armed = '1'; b.textContent = '确认重开';
    setTimeout(() => { delete b.dataset.armed; b.textContent = '新战局'; }, 2500);
  });
  $('btnAgain').addEventListener('click', restart);
}

function restart() {
  newGame(undefined, U.level); S.briefed = true; U.tool = null; U.logKey = null;
  buildTerrainLayer(); computeVision();
  const b = $('btnNew'); delete b.dataset.armed; b.textContent = '新战局';
  updateHud();
}

const STATE_TXT = { idle: '待命', move: '航行中', unloading: '卸载中', beached: '已抢滩' };

function updateHud() {
  const D = S.destroyer;
  $('clock').textContent = 'T+' + fmtT(S.t);
  $('aiLevel').textContent = DIFF[S.ai.level].name;
  for (const b of document.querySelectorAll('#diff button')) { b.classList.toggle('on', b.dataset.lv === U.level); b.setAttribute('aria-checked', b.dataset.lv === U.level); }
  $('remain').textContent = '剩余 ' + fmtT(LIMIT - S.t);
  $('btnPause').textContent = S.paused ? '▶ 继续' : '❚❚ 暂停';
  $('btnPause').classList.toggle('hot', S.paused);
  $('btnSpeed').textContent = S.speed + '×';
  $('pauseBand').hidden = !S.paused || !!S.over || !S.briefed;
  for (const c of CARDS) {
    const el = $('card-' + c.k);
    $('cnt-' + c.k).textContent = '×' + S.cards[c.k];
    el.disabled = S.cards[c.k] <= 0;
    el.classList.toggle('on', U.tool === c.k);
  }
  $('cnt-reinf').textContent = S.cards.reinf + ' 队';
  $('btnMove').classList.toggle('on', U.tool === 'move');
  $('toolHint').textContent = {
    assault: '在下方集结海域点击放置突击登陆舰', supply: '在下方集结海域点击放置补给登陆舰',
    rline: '点选一艘已抢滩的登陆舰，开辟增援线', strike: '点击目标点，攻击机自南向北投下三枚炸弹',
    recon: '点击任一位置，侦察机沿该列纵贯全图', aim: '点击设定驱逐舰射向（70% 概率暴露坐标）',
    move: '点击目标位置；落点在陆地即抢滩'
  }[U.tool] || (S.sel.length ? '右键（或「移动」）下达移动指令 · Ctrl+数字 编组' : '拖框或点击选择登陆舰 · 空格暂停');

  const ships = S.sel.map(shipById).filter(Boolean);
  $('selInfo').innerHTML = ships.length ? ships.map(s => `
    <div class="row"><span class="tri${s.kind === 'supply' ? ' sup' : ''}"></span><b>${s.label}</b>
    <span>${STATE_TXT[s.state] || '已沉没'}</span><span class="dim">载 ${s.load.squads * 3 + s.load.eng} 人</span>
    <span class="bar"><i style="width:${Math.max(0, s.hp / s.maxhp * 100)}%"></i></span></div>`).join('')
    : '<p class="dim">未选中登陆舰。拖框选择，或按 1–4 调出编组。</p>';

  for (const n of [1, 2, 3, 4]) {
    const live = S.groups[n].filter(id => { const s = shipById(id); return s && alive(s); }).length;
    $('gcnt-' + n).textContent = live ? ` · ${live} 艘` : ' · 空';
  }

  $('ddHull').innerHTML = [0, 1, 2].map(i => `<i class="${D.hull > i ? 'on' : ''}"></i>`).join('');
  $('ddState').textContent = D.state === 'sunk' ? '已沉没' : D.state === 'repair' ? '损管抢修中 · 无法掩护' : D.cool > 0 ? `装填中 ${Math.ceil(D.cool)}s` : '就绪';
  $('ddState').className = 'ddst ' + D.state;
  $('ddRepair').hidden = D.state !== 'repair';
  $('ddRepairBar').style.width = (D.repairT / D.repairDur * 100) + '%';
  $('ddExposed').hidden = !(S.t < D.exposedUntil);
  $('btnAim').disabled = D.state === 'sunk';
  $('btnAim').classList.toggle('on', U.tool === 'aim');
  $('btnAuto').textContent = '自动掩护：' + (D.auto ? '开' : '关');
  $('btnAuto').classList.toggle('on', D.auto);
  $('btnAuto').disabled = D.state === 'sunk';

  $('objs').innerHTML = S.objectives.map(o => `
    <div class="obj ${o.owner}"><b>${o.key}</b><span>${o.name}</span>
    <span class="bar"><i style="width:${o.prog * 100}%"></i></span></div>`).join('');

  const lk = S.log.length + '|' + (S.log[0] && S.log[0].t);
  if (lk !== U.logKey) {
    U.logKey = lk;
    $('intel').innerHTML = S.log.slice(0, 16).map(l => `<li class="${l.kind}"><time>${fmtT(l.t)}</time><span>${l.msg}</span></li>`).join('');
    const first = $('intel').querySelector('li span');
    if (first && S.t > 0) decode(first, S.log[0].msg, 450);
  }

  const p = S.squads.filter(q => q.side === 'p'), men = p.reduce((a, q) => a + q.men.length, 0);
  $('force').textContent = `岸上 ${men} 人 · ${p.filter(q => q.kind === 'inf').length} 个小队` + (S.holdT ? ` · 巩固 ${Math.ceil(HOLD - S.holdT)}s` : '');

  $('end').hidden = !S.over;
  if (S.over) {
    if ($('endTitle').dataset.over !== S.over) { $('endTitle').dataset.over = S.over; decode($('endTitle'), S.over === 'win' ? '滩头已巩固' : '登陆失败', 900); }
    $('endTitle').className = S.over;
    $('endStats').innerHTML = [
      ['守军 AI', DIFF[S.ai.level].name], ['作战用时', fmtT(S.t)], ['占领目标', S.objectives.filter(o => o.owner === 'p').length + ' / 3'],
      ['我方伤亡', S.stats.lost + ' 人'], ['歼敌', S.stats.killed + ' 人'],
      ['摧毁工事', (S.stats.structs || 0) + ' 处'], ['驱逐舰暴露', S.stats.exposed + ' 次'],
      ['驱逐舰', D.state === 'sunk' ? '沉没' : `船体 ${D.hull}/3`]
    ].map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('');
  }
}

// —— 主循环 ——
let lastT = performance.now(), acc = 0, hudT = 0, ema = 1 / 60;
function frame(now) {
  const dt = Math.min(.1, (now - lastT) / 1000);
  lastT = now;
  // 设备跟不上时降到 1 倍像素密度，保住帧率
  ema = ema * .95 + dt * .05;
  if (ema > .045 && !R.dprCap && now > 5000 && (window.devicePixelRatio || 1) > 1) { R.dprCap = 1; resize(); }
  if (!S.paused && !S.over && S.briefed) {
    acc += dt * S.speed;
    while (acc >= 1 / 30) { step(1 / 30); acc -= 1 / 30; }
  } else computeVision();
  draw(now);
  if (now - hudT > 200) { hudT = now; updateHud(); }
  requestAnimationFrame(frame);
}

// 字符解码动效：乱码逐位落定成目标文字
function decode(el, text, dur) {
  const t0 = performance.now(), chars = [...text];
  const f = now => {
    const u = Math.min(1, (now - t0) / dur);
    el.textContent = chars.map((ch, i) => i < u * chars.length || ch === ' ' ? ch : GLYPHS[Math.random() * GLYPHS.length | 0]).join('');
    if (u < 1) requestAnimationFrame(f);
  };
  requestAnimationFrame(f);
}

// 页面背景的数码雨（低透明度，减少动效偏好下关闭）
function bgRain() {
  const c = $('bgrain');
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const g = c.getContext('2d'), fs = 16;
  let cols = [], last = 0;
  const fit = () => {
    c.width = innerWidth; c.height = innerHeight;
    cols = Array.from({ length: Math.ceil(c.width / fs) }, () => -Math.random() * 60);
    g.fillStyle = '#020704'; g.fillRect(0, 0, c.width, c.height);
  };
  fit(); addEventListener('resize', fit);
  const tick = t => {
    requestAnimationFrame(tick);
    if (t - last < 60) return;
    last = t;
    g.fillStyle = 'rgba(2,7,4,0.14)'; g.fillRect(0, 0, c.width, c.height);
    g.font = fs + 'px "Noto Sans SC", monospace';
    cols.forEach((y, i) => {
      g.fillStyle = Math.random() < .06 ? '#d8ffe8' : '#3dff8a';
      g.fillText(GLYPHS[Math.random() * GLYPHS.length | 0], i * fs, y * fs);
      cols[i] = y * fs > c.height && Math.random() > .97 ? 0 : y + 1;
    });
  };
  requestAnimationFrame(tick);
}

function start(data) {
  if (data && data.S && data.S.ai) { S = data.S; buildTerrain(S.seed); aiCache(); } else newGame();
  U.level = S.ai.level;
  initRender($('cv'));
  buildHud(); bindInput();
  $('brief').hidden = !!S.briefed;
  new ResizeObserver(() => resize()).observe($('stage'));
  computeVision(); updateHud();
  decode(document.querySelector('.brand b'), 'BEACHHEAD', 1100);
  bgRain();
  requestAnimationFrame(frame);
}

window.claude?.hot?.snapshot?.(() => ({ S }));
window.claude?.hot?.ready ? window.claude.hot.ready(start) : start(window.claude?.hot?.data ?? {});
