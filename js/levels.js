'use strict';
// 闯关模式（v14）：三章十关，按真实作战顺序递进——
//   第一章 海战：先夺制海权（击沉敌水面舰艇编队八成吨位），否则登陆船队过不去；
//   第二章 登陆：制海权在手，强行登陆、夺取登陆场；
//   第三章 陆战：滩头已巩固，从登陆场向纵深推进，夺取指挥所与要地。
// 每关固定预算，守方由 AI 按本关风格布好（看不到具体部署，只给一份有误差的情报），玩家自己在沙盒里部署进攻方，再观战或亲自指挥。
// 进度存在本浏览器（localStorage 'bh-levels'），存不了就全部开放。
const LV_ZONE = 300;   // 陆战关：滩头阵地纵深（海岸线以北）
const LV_CH = {
  1: ['第一章 · 海战', '夺取制海权', '击沉敌水面舰艇编队八成吨位（15 分钟内）；我方驱逐舰、护卫舰、航母全损即失败。只能部署舰艇、舰载机 / 战区航空兵与支援火力。'],
  2: ['第二章 · 登陆', '夺取登陆场', '制海权已在手。强行登陆，控制指挥所与七成据点分值并坚守 30 秒。'],
  3: ['第三章 · 陆战', '向纵深推进', '滩头已巩固、各滩头出口在我手中。部队直接部署在滩头阵地（虚线区），向内陆攻击，控制指挥所与七成据点分值。']
};
const LV_DEFS = [
  { n: 1, ch: 1, kind: 'naval', nm: '前出侦巡', seed: 110111, p: 3000, lv: 'normal', fleet: ['e_lcs', 'e_lcs', 'e_ffg'], ascm: 0, af: 0,
    brief: '敌濒海战斗舰与护卫舰在岛前海域巡逻。用驱逐舰垂发鹰击-18A 与舰载机先敌发现、先敌打击。' },
  { n: 2, ch: 1, kind: 'naval', nm: '突破岛链', seed: 220222, p: 5000, lv: 'hard', fleet: ['e_ddg', 'e_ffg', 'e_ffg', 'e_lcs'], ascm: 1, af: 0,
    brief: '一艘宙斯盾驱逐舰带护卫舰编队，岸上有 NMESIS 岸舰导弹。宙斯盾拦截能力强：要么饱和攻击，要么用难拦的超音速 / 高超音速导弹。' },
  { n: 3, ch: 1, kind: 'naval', nm: '决战制海', seed: 330333, p: 9000, lv: 'hell', fleet: ['e_cg', 'e_ddg3', 'e_ddg', 'e_ffg', 'e_ffg', 'e_lcs'], ascm: 2, af: 1,
    brief: '敌水面主力：巡洋舰、两艘伯克级、护卫舰，岸基 F-35A / F-22A 掩护。先夺制空权再打舰，或用 055 的鹰击-21 直接破防。' },
  { n: 4, ch: 2, kind: 'landing', nm: '抢滩', seed: 440444, p: 6000, eB: 3000, style: 'bal', lv: 'normal',
    brief: '守军按常规均衡布防。选一处正面宽、离指挥所近的滩头主攻，佯攻牵制预备队。' },
  { n: 5, ch: 2, kind: 'landing', nm: '突破要塞', seed: 550555, p: 8000, eB: 5000, style: 'fort', lv: 'hard',
    brief: '守军修了层层碉堡与雷场。先用舰炮、垂发导弹、轰炸机砸烂工事，扫雷、爆破再上。' },
  { n: 6, ch: 2, kind: 'landing', nm: '立体攻防', seed: 660666, p: 10000, eB: 7000, style: 'air', lv: 'hard',
    brief: '守军纵深有大机场与成群的攻击机、武装直升机。先打掉机场或夺取制空权，再抢滩。' },
  { n: 7, ch: 2, kind: 'landing', nm: '强攻纵深', seed: 770777, p: 12000, eB: 9500, style: 'deep', lv: 'hell',
    brief: '守军放你上岸，再用强大预备队、坦克与机械化空降合围反击。登陆场要站得稳、补给线要守得住。' },
  { n: 8, ch: 3, kind: 'ground', nm: '扩大登陆场', seed: 880888, p: 7000, eB: 5000, style: 'armor', lv: 'hard',
    brief: '守军装甲部队集结在内陆城镇。步坦协同、反坦克导弹组随队，别让坦克单独冲。' },
  { n: 9, ch: 3, kind: 'ground', nm: '纵深攻坚', seed: 990999, p: 9500, eB: 8000, style: 'fort', lv: 'hell',
    brief: '内陆要点筑有碉堡群与反坦克阵地。炮兵、航空兵先打，工兵、爆破组跟进。' },
  { n: 10, ch: 3, kind: 'ground', nm: '决战', seed: 101010, p: 14000, eB: 14000, style: 'deep', lv: 'hell',
    brief: '守军全部力量：装甲、空降、航空兵、纵深炮兵。夺取指挥所即决定战局。' }
];
const LV_KEY = 'bh-levels';
const LV = { el: null, mem: null };
function lvProg() {
  if (LV.mem) return LV.mem;
  let o = null;
  try { o = JSON.parse(localStorage.getItem(LV_KEY) || 'null'); } catch (e) { o = { open: true }; }   // 存储不可用：全部开放
  return LV.mem = o && typeof o === 'object' ? o : { done: [] };
}
function lvSave(n) {
  const P = lvProg();
  P.done = [...new Set([...(P.done || []), n])];
  try { localStorage.setItem(LV_KEY, JSON.stringify(P)); } catch (e) { /* 只在本次有效 */ }
}
const lvOpenN = () => { const P = lvProg(); return P.open ? 99 : Math.max(0, ...(P.done || [])) + 1; };
const lvDef = n => LV_DEFS.find(d => d.n === n) || null;

// —— 关卡列表 ——
const LV_CSS = `
#lvSel { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; background: rgba(1, 8, 4, .82); padding: 16px max(16px, env(safe-area-inset-right, 0px)) 16px max(16px, env(safe-area-inset-left, 0px)); }
#lvSel .lv-win { width: min(980px, 100%); max-height: calc(100vh - 32px); overflow: auto; background: var(--panel, #04130a); border: 1px solid var(--line-hi, #2a7a4a); border-radius: 8px; padding: 18px 20px; display: grid; gap: 14px; }
#lvSel header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
#lvSel h2 { margin: 0; font-size: 20px; color: var(--g, #3dff8a); letter-spacing: .08em; }
#lvSel h2 small { margin-left: 10px; font-size: 11px; color: var(--mute, #7fa98d); letter-spacing: .2em; }
#lvSel .lv-ch { display: grid; gap: 8px; }
#lvSel .lv-ch h3 { margin: 0; font-size: 14px; color: var(--g, #3dff8a); }
#lvSel .lv-ch h3 span { margin-left: 8px; color: var(--mute, #7fa98d); font-weight: 400; font-size: 12px; }
#lvSel .lv-ch p { margin: 0; color: var(--mute, #7fa98d); font-size: 12px; line-height: 1.5; }
#lvSel .lv-row { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 8px; }
#lvSel .lv-card { text-align: left; display: grid; gap: 4px; padding: 10px 12px; border: 1px solid var(--line, #1d4a2e); border-radius: 6px; background: rgba(var(--g-rgb), .04); color: var(--text, #cfe9d8); min-height: 44px; cursor: pointer; }
#lvSel .lv-card:hover:not(:disabled), #lvSel .lv-card:focus-visible { border-color: var(--g, #3dff8a); background: rgba(var(--g-rgb), .1); }
#lvSel .lv-card:disabled { opacity: .4; cursor: not-allowed; }
#lvSel .lv-card b { font-size: 14px; }
#lvSel .lv-card b i { font-style: normal; color: var(--mute, #7fa98d); margin-right: 6px; font-size: 12px; }
#lvSel .lv-card span { font-size: 12px; color: var(--mute, #7fa98d); line-height: 1.45; }
#lvSel .lv-card em { font-style: normal; font-size: 11px; color: var(--amber, #ffc857); }
#lvSel .lv-card.done em { color: var(--g, #3dff8a); }
#lvSel .lv-x { background: transparent; border: 1px solid var(--line, #1d4a2e); border-radius: 5px; color: var(--text, #cfe9d8); padding: 4px 12px; min-height: 32px; }
#sbxPanel.lvl .sbx-sides button.e, #sbxPanel.lvl [data-act="bud-"], #sbxPanel.lvl [data-act="bud+"], #sbxPanel.lvl [data-act="save"], #sbxPanel.lvl [data-act="loads"],
#sbxPanel.lvl .sbx-seedin, #sbxPanel.lvl [data-act="map"], #sbxPanel.lvl .sbx-lv, #sbxPanel.lvl [data-act="preset"] { display: none; }
#sbxPanel .sbx-lvhead { display: grid; gap: 3px; padding: 6px 8px; border: 1px solid var(--line, #1d4a2e); border-radius: 5px; background: rgba(var(--g-rgb), .05); }
#sbxPanel .sbx-lvhead b { color: var(--g, #3dff8a); font-size: 13px; }
#sbxPanel .sbx-lvhead span { font-size: 12px; color: var(--mute, #7fa98d); line-height: 1.45; }`;
function lvOpen() {
  if (typeof document === 'undefined') return;
  if (!document.getElementById('lvCss')) { const st = document.createElement('style'); st.id = 'lvCss'; st.textContent = LV_CSS; document.head.appendChild(st); }
  if (LV.el) LV.el.remove();
  const el = LV.el = document.createElement('div');
  el.id = 'lvSel'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', '闯关模式');
  const P = lvProg(), open = lvOpenN();
  el.innerHTML = `<div class="lv-win"><header><h2>闯关模式<small>CAMPAIGN · 海战 → 登陆 → 陆战</small></h2><button type="button" class="lv-x">返回</button></header>
    ${[1, 2, 3].map(c => `<section class="lv-ch"><h3>${LV_CH[c][0]}<span>${LV_CH[c][1]}</span></h3><p>${LV_CH[c][2]}</p><div class="lv-row">${LV_DEFS.filter(d => d.ch === c).map(d => {
      const done = (P.done || []).includes(d.n), lock = d.n > open;
      return `<button type="button" class="lv-card${done ? ' done' : ''}" data-n="${d.n}" ${lock ? 'disabled' : ''}><b><i>第 ${d.n} 关</i>${d.nm}</b><span>预算 ${d.p} 点 · 守军 ${({ normal: '普通', hard: '困难', hell: '地狱' })[d.lv]}</span><span>${d.brief}</span><em>${done ? '✓ 已通过' : lock ? '🔒 先通过上一关' : '可挑战'}</em></button>`;
    }).join('')}</div></section>`).join('')}</div>`;
  document.body.appendChild(el);
  el.addEventListener('click', e => {
    if (e.target === el || e.target.closest('.lv-x')) { lvClose(); if (typeof showMenu === 'function') showMenu(); return; }
    const b = e.target.closest('.lv-card');
    if (b && !b.disabled) { lvClose(); lvStart(+b.dataset.n); }
  });
  el.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); lvClose(); if (typeof showMenu === 'function') showMenu(); } });
  const first = el.querySelector('.lv-card:not(:disabled):not(.done)') || el.querySelector('.lv-card:not(:disabled)');
  if (first) first.focus({ preventScroll: true });
}
function lvClose() { if (LV.el) { LV.el.remove(); LV.el = null; } }

// —— 开始一关：建地图 → 守方 AI 布防 → 锁定攻方编辑 → 情报简报 ——
function lvStart(n) {
  const L = lvDef(n);
  if (!L || typeof openSandbox !== 'function') return;
  if (typeof mnHide === 'function') mnHide();
  if (typeof MENU === 'object') { MENU.pausedBy = false; MENU.game = true; MENU.last = 'lvl'; }
  if (typeof U === 'object') U.level = L.lv;
  openSandbox(L.seed);
  S.level = L.lv;
  S.lv = { n: L.n, kind: L.kind, nm: L.nm, ch: L.ch };
  S.sbx.budget = { p: L.p, e: L.eB || 30000 };
  if (L.kind === 'naval') lvNavalDefend(L);
  else if (L.kind === 'ground') lvGroundDefend(L);
  else sbxAIDefend(L.style);
  S.sbx.budget.e = Math.max(sbxSpent('e'), 1);
  S.sbx.notes.e = [];
  if (typeof SBX === 'object') { SBX.side = 'p'; SBX.sty.p = 'bal'; SBX.dir = { main: -1, feint: -2 }; SBX.pick = null; }
  lvIntel(L);
  if (typeof sbxRender === 'function') sbxRender();
  if (typeof sbxMsg === 'function') sbxMsg(`第 ${L.n} 关「${L.nm}」：预算 ${L.p} 点，部署完点「指挥进攻方」或「观战」开战`);
  if (typeof updateHud === 'function') updateHud();
}
// 海战：守方舰队在岛前海域（本方海岸外 130–330）成编队，岸上岸舰导弹、机场与歼击机按关卡配
function lvNavalDefend(L) {
  sbxClear('e');
  const cx = W / 2 + (Math.random() - .5) * 600, base = coastAt(cx) + 210;
  const slots = [[0, 0], [-130, 30], [130, 30], [-260, 70], [260, 70], [0, 110], [-390, 110], [390, 110]];
  L.fleet.forEach((id, i) => {
    const [dx, dy] = slots[i % slots.length];
    for (let k = 0; k < 30; k++) { const x = clamp(cx + dx + (k % 5 - 2) * 25, 80, W - 80), y = Math.min(STAGING_Y - 140, Math.max(coastAt(x) + 100, base + dy + Math.floor(k / 5) * 20)); if (sbxPlace(id, x, y).ok) break; }
  });
  for (let i = 0; i < (L.ascm || 0); i++) { const x = cx + (i ? 380 : -380); sbxTry('e_ascm', x, coastAt(x) - 90, 90); }
  if (L.af) {
    const hq = ptByKey('HQ') || S.points[0];
    let af = S.sbx.items.find(it => it.fixed && it.cat === 'e_airfield') || null;   // 地图自带空军基地
    for (let k = 0; k < 120 && !af; k++) { const w = k < 60 ? 900 : 2400, x = clamp(hq.x + (Math.random() - .5) * w, 170, W - 170), y = clamp(hq.y - 60 - Math.random() * 500, 50, H); if (coastAt(x) - y >= 500) af = sbxTry('e_airfield', x, y, 60); }
    if (af) for (const id of ['e_air_ftr', 'e_air_ftr', 'e_air_f22', 'e_air_f22', 'e_air_ga', 'e_air_ga']) sbxPlace(id);
  }
  for (const p of ['HQ', 'T1', 'T2', 'T3'].map(ptByKey).filter(Boolean)) sbxTry('e_garrison', p.x, p.y + 15, 40);
  sbxSync();
}
// 陆战：先按风格正常布防，再把滩头一线（海岸 260 以内）的工事、岸炮撤掉，把点数投到内陆要点的防御上
function lvGroundDefend(L) {
  sbxAIDefend(L.style);
  const keep = it => { const c = sbxEntry(it); return it.x == null || coastAt(it.x) - it.y > 260 || (c && c.spawn.ek === 'airfield'); };
  S.sbx.items = S.sbx.items.filter(it => it.side !== 'e' || keep(it));
  sbxSync();
  const pts = S.points.filter(p => !/^E\d/.test(p.key) && coastAt(p.x) - p.y > 260).sort((a, b) => (coastAt(a.x) - a.y) - (coastAt(b.x) - b.y));
  const ids = ['e_mg_bunker', 'e_at_casemate', 'e_garrison', 'e_at', 'e_mines_mx', 'e_tank', 'e_casemate', 'e_td', 'e_mortar', 'e_apc'];
  let i = 0, fail = 0;
  while (sbxLeft('e') >= 20 && fail < 40 && pts.length) {
    const p = pts[i % pts.length], id = ids[Math.floor(i / pts.length) % ids.length], a = (i * 2.4) % 6.28;
    const r = sbxTry(id, p.x + Math.cos(a) * 50, p.y + 40 + Math.abs(Math.sin(a)) * 40, 40);
    if (r) fail = 0; else fail++;
    i++;
  }
  sbxSync();
}
// 陆战关开战：滩头阵地上的步兵组按位置编成排（每排至多 6 组），车辆已由 sbxSpawn 放好；离部队最近的两处滩头各设补给站；滩头出口归我
function lvGroundSpawn(items) {
  const inf = items.filter(it => it.side === 'p' && it.x != null && sbxEntry(it) && sbxEntry(it).spawn.kind === 'cargo');
  const used = new Set();
  let k = 0;
  for (const it of inf) {
    if (used.has(it)) continue;
    const grp = inf.filter(o => !used.has(o) && dist(o.x, o.y, it.x, it.y) < 140).slice(0, 6);
    grp.forEach(o => used.add(o));
    const u = addUnit('p', 'inf', { ship: `LZ-${++k}`, emblem: 'assault', form: 'line', face: NORTH, auto: true });
    const eng = [];
    let mor = 0;
    for (const o of grp) {
      const c = sbxEntry(o), sp = c.spawn, sx = typeof sbxSpot === 'function' ? sbxSpot(o.x, o.y, 'p') : { x: o.x, y: o.y };
      const q = addTeam('p', sx.x, sx.y, sp.men, { unit: u.ship, u: u.id, cat: c.id, ...(sp.mod ? { mod: { ...sp.mod } } : {}), ...(sp.tag ? { sbxTag: sp.tag } : {}) });
      q.kind = q.men[0] === 'eng' ? 'eng' : 'inf';
      if (sp.eng) eng.push(q);
      mor += sp.morale || 80;
    }
    u.morale = Math.round(mor / grp.length);
    if (eng.length) { const ue = addUnit('p', 'eng', { ship: u.ship, emblem: 'eng', face: NORTH, auto: true }); for (const q of eng) q.u = ue.id; }
  }
  // 补给站：部队最集中的两处滩头
  const all = [...S.teams.filter(q => q.side === 'p'), ...(S.veh || []).filter(v => v.side === 'p')];
  const B = TER.beaches.map((b, i) => ({ b, i, n: all.filter(o => Math.abs(o.x - b.cx) < 400).length })).sort((a, c) => c.n - a.n).slice(0, 2);
  B.forEach(({ b }, j) => {
    const s = addShip('supply', b.cx, coastAt(b.cx) + 20, `LS-${j + 1}`);
    Object.assign(s, { bx: b.cx, by: coastAt(b.cx) - 12, load: { teams: 0, eng: 1, veh: [] } });
    disembark(s);
  });
  for (const p of S.points) if (/^E\d/.test(p.key)) { p.owner = 'p'; p.prog = 0; }
  if (typeof indexUnits === 'function') indexUnits();
  log('滩头已巩固：各滩头出口在我手中，补给站开设完毕，向纵深发起进攻', 'good');
}

// —— 情报（有误差）：部署时显示在面板顶部与聊天里，地图上画大致位置圈 ——
function lvIntel(L) {
  const E = S.sbx.items.filter(it => it.side === 'e'), cnt = f => E.filter(it => f(sbxEntry(it) || {}, it)).length;
  const fuzz = n => n <= 0 ? '无' : n <= 2 ? `${n} 左右` : `约 ${Math.max(1, Math.round(n * (.75 + Math.random() * .5)))}`;
  const lines = [], rings = [];
  const ring = (x, y, nm) => rings.push({ x: x + (Math.random() - .5) * 200, y: y + (Math.random() - .5) * 140, r: 150, nm });
  if (L.kind === 'naval') {
    const sh = E.filter(it => (sbxEntry(it) || {}).spawn && sbxEntry(it).spawn.kind === 'eship'), aeg = sh.filter(it => /ddg|cg/.test(it.cat)).length;
    lines.push(`海上：敌水面编队 ${fuzz(sh.length)} 艘，其中宙斯盾舰（伯克级 / 提康德罗加级）${aeg ? fuzz(aeg) + ' 艘' : '未发现'}——区域防空强，单发、亚音速导弹多半被拦。`);
    if (sh.length) { const cx = sh.reduce((a, it) => a + it.x, 0) / sh.length, cy = sh.reduce((a, it) => a + it.y, 0) / sh.length; ring(cx, cy, '敌舰队'); }
  } else {
    const BS = typeof sbxBeaches === 'function' ? sbxBeaches() : [];
    if (L.kind === 'landing') {
      const st = BS.map(B => ({ B, n: E.filter(it => it.x != null && Math.abs(it.x - B.b.cx) < 260 && coastAt(it.x) - it.y < 300).length })).sort((a, b) => b.n - a.n);
      const lvl = n => n >= st[0].n * .7 ? '强' : n >= st[0].n * .35 ? '中' : '弱';
      lines.push(`滩头设防（航空照相判读）：${st.map(o => `${o.B.b.name}${lvl(o.n)}`).join('、')}。`);
    }
    const sty = { bal: '均衡纵深', armor: '装甲机动防御', air: '空地一体', fort: '要塞防御', deep: '纵深反击' }[L.style];
    lines.push(`判断：守军${Math.random() < .8 ? `可能采取「${sty}」` : '意图不明'}。`);
    const tank = cnt(c => c.spawn && c.spawn.kind === 'veh' && /tank|td|apc/.test(c.spawn.type || '')), arty = cnt(c => c.cat === 'arty');
    lines.push(`地面：坦克与战车 ${fuzz(tank)} 辆，火炮阵地 ${fuzz(arty)} 处。`);
    for (const it of E.filter(it => /e_coastal|e_how|e_hhow|e_rkt/.test(it.cat)).slice(0, 4)) ring(it.x, it.y, '疑似炮兵 / 岸炮');
    if (cnt(c => c.id === 'e_101')) lines.push('敌第 101 空降师有机械化空降战斗群待命——登陆场后方要留预备队、配防空。');
  }
  const af = E.find(it => it.cat === 'e_airfield'), air = cnt(c => c.spawn && c.spawn.kind === 'ewing'), asc = cnt(c => c.id === 'e_ascm');
  if (af) { lines.push(`空中：纵深有野战机场（自带雷达、防空），飞机 ${fuzz(air)} 架。`); ring(af.x, af.y, '敌机场'); }
  if (asc) lines.push(`岸舰导弹排 ${fuzz(asc)} 个，射程 1600，靠近海岸的舰船当心。`);
  S.lvIntel = { lines, rings };
  S.sbx.notes.p = [`第 ${L.n} 关「${L.nm}」：${LV_CH[L.ch][2]}`, L.brief, ...lines.map(t => '情报：' + t)];
  if (typeof chatSay === 'function') chatSay('sys', `第 ${L.n} 关「${L.nm}」情报简报：${lines.join(' ')}`, { kind: 'intel', lv: 0 });
}
// 部署时地图上的情报圈
HOOK.drawOver.push(function lvDraw() {
  if (!S || !S.lv || !S.lvIntel || typeof sbxOn !== 'function' || !sbxOn() || typeof R !== 'object' || !R.ctx) return;
  const ctx = R.ctx;
  ctx.save(); ctx.setLineDash([px(6), px(5)]); ctx.lineWidth = px(1.4);
  for (const g of S.lvIntel.rings) {
    ctx.strokeStyle = rgba(COL.enemy, .55); ctx.fillStyle = rgba(COL.enemy, .06);
    ctx.beginPath(); ctx.arc(g.x, g.y, g.r, 0, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = rgba(COL.enemy, .8); ctx.font = `${Math.max(11, px(12))}px ${getComputedStyle(document.body).fontFamily}`; ctx.textAlign = 'center';
    ctx.fillText(g.nm + '？', g.x, g.y);
  }
  ctx.restore();
});
// 攻方目录：海战只要舰艇、航空与支援火力；陆战不要登陆舰艇
function lvAllow(c) {
  if (!S || !S.lv || c.side !== 'p') return true;
  const s = c.spawn;
  if (S.lv.kind === 'naval') return !['cargo', 'vcargo'].includes(s.at) && s.kind !== 'ship' && !['p_abn', 'p_para', 'p_airdrop', 'p_reserve', 'p_rline', 'p_depot', 'p_relay', 'p_sortie_recon'].includes(c.id) && s.kind !== 'veh';
  if (S.lv.kind === 'ground') return s.kind !== 'ship' && !['p_lcac', 'p_rline'].includes(c.id);
  return true;
}
// 面板：关卡标题与目标
function lvPanel(el) {
  el.classList.toggle('lvl', !!S.lv);
  let h = el.querySelector('.sbx-lvhead');
  if (!S.lv) { if (h) h.remove(); return; }
  if (!h) { h = document.createElement('div'); h.className = 'sbx-lvhead'; el.querySelector('.sbx-sides').before(h); }
  const L = lvDef(S.lv.n);
  h.innerHTML = `<b>第 ${L.n} 关 · ${L.nm}</b><span>${LV_CH[L.ch][0]}：${LV_CH[L.ch][1]}</span>`;
}

// —— 打完：过关存档；结束画面加「下一关」「关卡列表」 ——
HOOK.frame.push(function lvFrame() {
  if (!S || !S.lv || !S.over || typeof document === 'undefined') return;
  if (S.lv.endDone !== S.over) {
    S.lv.endDone = S.over;
    if (S.over === 'win') lvSave(S.lv.n);
    const sh = document.querySelector('#end .sheet');
    if (!sh) return;
    for (const id of ['lvNext', 'lvList']) { const b = document.getElementById(id); if (b) b.remove(); }
    const mk = (id, txt, fn, cls) => { const b = document.createElement('button'); b.id = id; b.type = 'button'; b.className = cls; b.textContent = txt; b.addEventListener('click', fn); sh.appendChild(b); return b; };
    const nx = lvDef(S.lv.n + 1);
    if (S.over === 'win' && nx) mk('lvNext', `下一关：${nx.nm} ▸`, () => { document.getElementById('end').hidden = true; lvStart(nx.n); }, 'go');
    mk('lvList', '关卡列表', () => { document.getElementById('end').hidden = true; lvOpen(); }, 'alt');
  }
});
