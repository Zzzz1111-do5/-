'use strict';
// 驱逐舰垂直发射系统与 901 型综合补给舰（v12）
// 装弹按公开资料估计的典型配比（导弹分两类：超音速——鹰击-18A 末段 3 马赫冲刺、鹰击-21 高超音速；普通（亚音速）——长剑-10 巡航导弹）：
//   055 型（112 单元）：红旗-9B 远程舰空导弹 56 · 长剑-10 对陆巡航导弹 24 · 鹰击-18A 16 · 鹰击-21 8 · 鱼-8 反潜导弹 8
//   052D 型（64 单元）：红旗-9B 32 · 长剑-10 12 · 鹰击-18A 12 · 鱼-8 8；052C 型（48 单元）：红旗-9 48 + 舰面发射架鹰击-62 8；
//   054A 型（32 单元）：红旗-16 32 + 舰面发射筒鹰击-83 8——每艘驱护舰都有对海 / 对陆导弹
// 用途：舰空导弹——打敌机、拦截来袭导弹（eair.js / missile.js 每发一枚先 vlsUse(舰, 'sam')，打光了就只剩近防炮）；
//   对陆——长剑-10（便宜量大，敌弹炮防空车 / 密集阵能拦）打纵深固定目标与步兵呼叫的火力点（callfire.js）；
//   鹰击-18A（掠海亚音速巡航、末段超音速冲刺）打岸防炮、岸舰导弹、沿岸防空；鹰击-21（高超音速、几乎拦不住）只留给岸舰导弹排、发射车、机场、岸防重炮。
// 补给：某舰舰空导弹不足 1/4 或对陆导弹打光，航母编队派 901 型综合补给舰（呼伦湖号）过去，靠帮横向补给 25 秒补满后返回航母；
//   没有航母时从后方（地图南缘）驶来。玩家：支援栏「垂发导弹」按钮（Y）点目标发射，按目标自动选弹。
const VLS_CLS = {
  '055': { cells: 112, load: { sam: 56, cj10: 24, yj18: 16, yj21: 8, yu8: 8 }, sam: '红旗-9B' },
  '052D': { cells: 64, load: { sam: 32, cj10: 12, yj18: 12, yu8: 8 }, sam: '红旗-9B' },
  '052C': { cells: 48, load: { sam: 48, yj62: 8 }, sam: '红旗-9' },
  '054A': { cells: 32, load: { sam: 32, yj83: 8 }, sam: '红旗-16' }
};
const VLS_NM = { sam: '舰空导弹', cj10: '长剑-10', yj18: '鹰击-18A', yj21: '鹰击-21', yu8: '鱼-8', yj62: '鹰击-62', yj83: '鹰击-83' };
const VLS_SUP = { yj18: '超音速', yj21: '高超音速', cj10: '亚音速', yj62: '亚音速', yj83: '亚音速' };
const VLS_LAND = ['cj10', 'yj18', 'yj21', 'yj62', 'yj83'];
const vlsNmS = k => MS_PGM[k].nm.includes(VLS_SUP[k]) ? MS_PGM[k].nm : `${MS_PGM[k].nm}（${VLS_SUP[k]}）`;   // 名称 + 速度类别（已含就不重复）
const VLS_ICON = typeof WI === 'object' && WI.t055 ? WI.t055 : '<path d="M3 15h18l-2 3H5z"/>';
const AOR = { spd: 26, dur: 25, near: 50, name: '901 型综合补给舰（呼伦湖号）' };

function vlsCls(o) {
  const nm = (o === S.dd ? S.dd.name : (o.sbxCls && o.sbxCls.name) || '') || '';
  return nm.includes('055') ? '055' : nm.includes('052D') ? '052D' : nm.includes('052C') ? '052C' : nm.includes('054A') ? '054A' : o === S.dd ? '055' : '052D';
}
function vlsOf(o) {
  if (!o) return null;
  const nm = o === S.dd ? S.dd.name : o.sbxCls && o.sbxCls.name;
  if (!o.vls || (o.vlsNm !== nm && S.phase !== 'battle')) { const c = VLS_CLS[vlsCls(o)]; o.vls = { ...c.load }; o.vls0 = { ...c.load }; o.vlsC = vlsCls(o); o.vlsNm = nm; }   // 沙盒开打前换了舰型：重新装弹
  return o.vls;
}
const vlsHas = (o, k) => { const v = vlsOf(o); return !!v && v[k] > 0; };
function vlsUse(o, k, n = 1) {
  const v = vlsOf(o);
  if (!v || !(v[k] >= n)) return false;
  v[k] -= n;
  if (typeof v8Stat === 'function') v8Stat('vls_' + k, n);
  return true;
}
const vlsSamName = o => (VLS_CLS[(vlsOf(o), o.vlsC)] || VLS_CLS['055']).sam;
// 能发射的舰：旗舰（在图上、没沉）与沙盒护航舰
function vlsShips() {
  const out = [];
  if (S.dd && S.dd.state !== 'sunk' && isFinite(S.dd.x) && S.dd.x > -999) out.push({ o: S.dd, x: S.dd.x, y: S.dd.y, nm: S.dd.name || '驱逐舰', ctl: typeof cmdCtl === 'function' ? cmdCtl(S.dd) : !!S.dd.auto });
  for (const s of S.ships) if (s.kind === 'dd' && alive(s)) out.push({ o: s, x: s.x, y: s.y, nm: `${s.label} ${(s.sbxCls && s.sbxCls.name) || '护航舰'}`, ctl: true });
  return out;
}
// 某种弹还剩多少（全舰队）
const vlsLeft = k => vlsShips().reduce((a, s) => a + ((vlsOf(s.o) || {})[k] || 0), 0);
// 打 (x, y) 用哪种弹：w = 'lacm'（自动选） / cj10 / yj18 / yj21；kind = 目标种类（可空）
function vlsWeapon(w, kind) {
  if (kind === 'eship') return ['yj21', 'yj18', 'yj83', 'yj62'].includes(w) && vlsLeft(w) > 0 ? w : ['yj18', 'yj83', 'yj62', 'yj21'].find(k => vlsLeft(k) > 0) || null;   // 打舰只用反舰导弹
  if (w !== 'lacm') return w;
  const top = ['ascm', 'tel', 'typhon', 'airfield'].includes(kind) || (kind === 'coastal' && typeof S === 'object' && S.ships.some(s => alive(s) && s.load && s.load.teams > 0));
  const coast = kind === 'coastal' || kind === 'ascm' || kind === 'aa';   // 沿岸硬目标、有防空掩护的目标：超音速的鹰击-18A 更难被拦
  const order = top ? ['yj21', 'yj18', 'cj10', 'yj62', 'yj83'] : coast ? ['yj18', 'yj83', 'cj10', 'yj62', 'yj21'] : ['cj10', 'yj62', 'yj83', 'yj18'];
  return order.find(k => vlsLeft(k) > 0) || null;
}
function vlsPick(w, x, y, ctlOnly) {
  let best = null, bd = Infinity;
  for (const s of vlsShips()) { if (ctlOnly && !s.ctl) continue; if (!vlsHas(s.o, w)) continue; const d = dist(s.x, s.y, x, y); if (d < bd) { bd = d; best = s; } }
  return best;
}
const vlsCan = (w, x, y) => { const k = vlsWeapon(w, null); return !!k && !!vlsPick(k, x, y, true); };
// 将由哪艘舰发射（通联、喊话点名：旗舰沉了以后是哪艘护航舰在打，不笼统说「驱逐舰」）
const vlsWho = (w, x, y) => { const k = vlsWeapon(w, null), s = k && vlsPick(k, x, y, true); return s ? (s.o === S.dd ? (S.dd.name || '驱逐舰') : s.nm) : '驱逐舰'; };
const vlsEta = (w, x, y) => { const k = vlsWeapon(w, null), s = k && vlsPick(k, x, y, true), W0 = MS_PGM[k]; return s ? 1.5 + dist(s.x, s.y, x, y) / (W0.sprint ? (W0.spd + W0.sprint) / 2 : W0.spd) : 99; };
// 目标对象：点附近 40 以内的工事 / 战车 / 装甲车（打活目标），否则打这一点
function vlsTgtAt(x, y) {
  let best = { x, y }, bd = 40;
  for (const e of S.enemies) if (!e.dead) { const d = dist(e.x, e.y, x, y); if (d < bd) { bd = d; best = { k: 'enemy', id: e.id, x: e.x, y: e.y, kind: e.kind }; } }
  for (const v of S.veh || []) if (v.side === 'e' && !v.dead) { const d = dist(v.x, v.y, x, y); if (d < bd) { bd = d; best = { k: 'veh', id: v.id, x: v.x, y: v.y }; } }
  for (const a of S.armor || []) if (!a.dead) { const d = dist(a.x, a.y, x, y); if (d < bd) { bd = d; best = { k: 'armor', id: a.id, x: a.x, y: a.y }; } }
  for (const e of S.eships || []) if (!e.dead) { const d = dist(e.x, e.y, x, y); if (d < Math.max(bd, 60)) { bd = d; best = { k: 'eship', id: e.id, x: e.x, y: e.y, kind: 'eship' }; } }   // 敌水面舰艇（navy.js）
  return best;
}
// 发射：返回实际发射枚数
function vlsFire(w, x, y, n = 1, why, player) {
  if (!S || S.phase !== 'battle' || !isFinite(x) || !isFinite(y)) return 0;
  const T = vlsTgtAt(x, y), k = vlsWeapon(w, T.kind);
  if (!k) { if (player) log('垂发对陆导弹已经打光，等补给舰', 'warn', 'vls0', 2); return 0; }
  let fired = 0, sh = null;
  for (let i = 0; i < n; i++) {
    const s = vlsPick(k, x, y, !player);
    if (!s || !vlsUse(s.o, k)) break;
    msPgm(k, 'p', s.x, s.y, T, 'vls', .6 + i * .8);
    S.fx.push({ kind: 'flash', x: s.x, y: s.y, r: 14, life: 0, max: .5, side: 'p' });
    fired++; sh = s;
  }
  if (!fired) return 0;
  S.stats.shots += fired;
  if (typeof v8Stat === 'function') v8Stat('vlsFire', fired);
  const W0 = MS_PGM[k], eta = Math.round(1.5 + dist(sh.x, sh.y, x, y) / (W0.sprint ? (W0.spd + W0.sprint) / 2 : W0.spd));
  log(`${sh.nm}垂直发射 ${fired} 枚${vlsNmS(k)}，约 ${eta} 秒命中；余 ${vlsLeft(k)} 枚`, 'info', null, 0, { x, y });
  if (typeof shout === 'function' && sh.o) shout(sh.o, `垂发 ${fired} 枚${vlsNmS(k)}！`);   // 发射舰头顶喊话（shout.js）
  return fired;
}

// —— 进攻方 AI 用垂发对陆导弹（每 4 秒）：驱逐舰受指挥官控制（观战 / 自动）时；目标按价值，已有弹在飞的不重复打；
//    敌弹炮防空车 / 密集阵掩护的目标，亚音速的长剑-10 一次打两枚 ——
const VLS_VAL = { typhon: 11, ascm: 10, tel: 9, coastal: 8, airfield: 7, arty: 5, aa: 4.5, mortar: 3, bunker: 2.5 };
function vlsCommandP(dt) {
  if (!S || S.phase !== 'battle' || S.over || !S.cmd) return;
  const V = S.vlsS || (S.vlsS = { t: 6 });
  if ((V.t -= dt) > 0) return;
  V.t = 4;
  if (!vlsShips().some(s => s.ctl) || !VLS_LAND.some(k => vlsLeft(k) > 0)) return;
  const pT = S.teams.filter(q => q.side === 'p' && q.men.length), atSea = S.ships.some(s => alive(s) && s.load && s.load.teams > 0);
  const JP = typeof cmdJointPts === 'function' ? cmdJointPts() : [];
  let best = null, bv = 0;
  for (const e of S.enemies) {
    if (e.dead || e.kx == null || !VLS_VAL[e.kind] || (e.kind === 'airfield' && typeof abKeep === 'function' && abKeep())) continue;   // 打算空降夺取的机场：不炸毁（abn.js）
    if (pT.some(q => dist(q.x, q.y, e.kx, e.ky) < 70) || S.missiles.some(m => m.side === 'p' && !m.done && dist(m.tx, m.ty, e.kx, e.ky) < 50)
      || S.shells.some(s => s.side === 'p' && !s.done && dist(s.x1, s.y1, e.kx, e.ky) < 50)) continue;
    const v = VLS_VAL[e.kind] * (e.kind === 'coastal' && atSea ? 1.5 : 1) * (e.kind === 'bunker' && pT.some(q => dist(q.x, q.y, e.kx, e.ky) < 280) ? 2.2 : 1) * (JP.some(p => dist(p.x, p.y, e.kx, e.ky) < 220) ? 1.5 : 1);
    if (v > bv) { bv = v; best = e; }
  }
  if (!best || bv < 4) return;
  const k = vlsWeapon('lacm', best.kind);
  if (!k) return;
  const cover = (S.veh || []).some(v => v.side === 'e' && !v.dead && (v.type === 'sam_veh' || (v.mod && v.mod.cram)) && dist(v.x, v.y, best.kx, best.ky) < 450);
  const n = (k === 'cj10' && cover ? 2 : 1) + (best.kind === 'airfield' ? 1 : 0) + (best.kind === 'typhon' ? 2 : 0);   // 「堤丰」：一次三枚饱和它的防空，一轮打掉，别让它再齐射
  const who = vlsWho(k, best.kx, best.ky), f = vlsFire(k, best.kx, best.ky, n, 'ai');
  if (f && typeof chatSay === 'function') chatSay('p', `命令：${who}垂发 ${f} 枚${vlsNmS(k)}，打击${typeof cmdWhere === 'function' ? cmdWhere(best.kx, best.ky) : gridRef(best.kx, best.ky)}的${(ENEMY_SPEC[best.kind] || {}).name || '目标'}${cover && k === 'cj10' ? '（敌有弹炮防空掩护，双发）' : ''}。`, { kind: 'order', at: { x: best.kx, y: best.ky }, key: 'vls' + best.id, gap: 60, lv: 2 });
}

// —— 901 型综合补给舰：S.aor = {x, y, h, st: 'go' | 'rep' | 'back', to: 'DD' | 舰 id, p 进度, n 已补给舰次} ——
function vlsNeed(o) {
  const v = vlsOf(o), v0 = o.vls0;
  if (!v || !v0) return false;
  const land0 = VLS_LAND.reduce((a, k) => a + (v0[k] || 0), 0), land = VLS_LAND.reduce((a, k) => a + (v[k] || 0), 0);
  return (v0.sam && v.sam < v0.sam * .25) || (land0 > 0 && land === 0);
}
function aorHome() {
  const c = typeof cvAll === 'function' ? cvAll().find(o => o.hp > 0 && o.x > -999) : null;
  return c ? { x: c.x + 60, y: Math.min(H - 30, c.y + 40), cv: true } : { x: W / 2, y: H + 40, cv: false };
}
function aorStep(dt) {
  if (!S || S.phase !== 'battle' || S.over) return;
  const A = S.aor;
  if (!A) {
    if ((S.aorT = (S.aorT ?? 0) - dt) > 0) return;
    S.aorT = 3;
    const s = vlsShips().find(s => vlsNeed(s.o));
    if (!s) return;
    const h = aorHome();
    S.aor = { x: h.x, y: h.y, h: Math.atan2(s.y - h.y, s.x - h.x), st: 'go', to: s.o === S.dd ? 'DD' : s.o.id, p: 0, n: (S.aorN || 0) };
    if (typeof v8Stat === 'function') v8Stat('aorGo');
    const v = vlsOf(s.o), what = v.sam < s.o.vls0.sam * .25 ? `舰空导弹只剩 ${v.sam} 枚` : '对陆导弹已经打光';
    log(`${s.nm}${what}，${h.cv ? '航母编队' : '后方'}派出${AOR.name}前往补给`, 'info', null, 0, s);
    if (typeof chatSay === 'function') chatSay('p', `报告：${s.nm}${what}。命令：${AOR.name}${h.cv ? '离开航母编队' : '从后方'}驶往该舰，靠帮横向补给导弹。`, { kind: 'order', at: s, key: 'aor', gap: 30, lv: 1 });
    return;
  }
  const tgt = A.to === 'DD' ? (S.dd && S.dd.state !== 'sunk' ? S.dd : null) : S.ships.find(s => s.id === A.to && alive(s));
  if (!tgt && A.st !== 'back') A.st = 'back';
  const sail = (x, y, v) => { const d = dist(A.x, A.y, x, y); A.h = Math.atan2(y - A.y, x - A.x); const st = Math.min(d, v * dt); A.x += Math.cos(A.h) * st; A.y += Math.sin(A.h) * st; return d; };
  if (A.st === 'go') {
    const side = tgt.x > W / 2 ? -1 : 1;   // 停在目标舰外侧（远离海岸线方向的一舷）
    if (sail(tgt.x + side * 22, tgt.y + 14, AOR.spd) < 8) { A.st = 'rep'; A.p = 0; log(`${AOR.name}与${tgt === S.dd ? (S.dd.name || '驱逐舰') : tgt.label}并靠，开始横向补给`, 'info', 'aorrep', 4, tgt); }
  } else if (A.st === 'rep') {
    const side = tgt.x > W / 2 ? -1 : 1;
    if (sail(tgt.x + side * 22, tgt.y + 14, AOR.spd * 1.3) > AOR.near) return;   // 目标舰机动：跟上再补
    if (tgt.moving || (tgt.state && tgt.state === 'move')) return;
    if ((A.p += dt / AOR.dur) >= 1) {
      const v = vlsOf(tgt);
      Object.assign(v, tgt.vls0);
      A.st = 'back'; S.aorN = (S.aorN || 0) + 1;
      if (typeof v8Stat === 'function') v8Stat('aorDone');
      const nm = tgt === S.dd ? (S.dd.name || '驱逐舰') : tgt.label;
      log(`${nm}垂发导弹补给完毕（${vlsText(tgt)}）`, 'good', null, 0, tgt);
      if (typeof chatSay === 'function') chatSay('p', `报告：${nm}导弹补给完毕，${AOR.name}返回航母编队。`, { kind: 'report', at: tgt, key: 'aorok', gap: 20, lv: 1 });
    }
  } else {
    const h = aorHome();
    if (sail(h.x, h.y, AOR.spd) < 10) S.aor = null;
  }
}
const vlsText = o => { const v = vlsOf(o); return v ? Object.keys(o.vls0).filter(k => k !== 'yu8').map(k => `${k === 'sam' ? vlsSamName(o) : VLS_NM[k]} ${v[k]}`).join(' · ') : '—'; };

// 补给舰画面：长船体、补给门架、并靠时两舰之间的补给索
function aorDraw(time) {
  const A = S && S.aor;
  if (!A || typeof R !== 'object' || !R.ctx) return;
  const ctx = R.ctx, k = clamp(9 / (12 * R.s), 1, 2.6), col = COL.g;
  ctx.save(); ctx.translate(A.x, A.y); ctx.rotate(A.h); ctx.scale(k, k);
  ctx.fillStyle = rgba(col, .18); ctx.strokeStyle = rgba(col, .9); ctx.lineWidth = px(1.2) / k;
  ctx.beginPath(); ctx.moveTo(30, 0); ctx.lineTo(22, -5); ctx.lineTo(-26, -5); ctx.lineTo(-28, 0); ctx.lineTo(-26, 5); ctx.lineTo(22, 5); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = rgba(col, .6);
  for (const u of [12, 4, -4]) ctx.fillRect(u - 1, -4.2, 2, 8.4);   // 补给门架
  ctx.fillRect(-24, -3.5, 8, 7);   // 艉部上层建筑
  ctx.restore();
  if (A.st === 'rep') {
    const tgt = A.to === 'DD' ? S.dd : S.ships.find(s => s.id === A.to);
    if (tgt) {
      ctx.save(); ctx.strokeStyle = rgba(COL.amber, .8); ctx.lineWidth = px(1.2); ctx.setLineDash([px(3), px(3)]); ctx.lineDashOffset = -time * 10;
      ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(tgt.x, tgt.y); ctx.stroke(); ctx.setLineDash([]);
      ctx.strokeStyle = COL.amber; ctx.lineWidth = px(2); ctx.beginPath(); ctx.arc(A.x, A.y, 36, -1.57, -1.57 + A.p * 6.283); ctx.stroke();
      ctx.restore();
    }
  }
}

// —— HUD：支援栏「垂发导弹」按钮（Y）；工具状态下左键点目标发射（按目标自动选弹） ——
function vlsHud() {
  if (typeof document === 'undefined' || typeof $ !== 'function' || !$('support') || !S) return;
  let b = $('b-vls');
  if (!b) {
    if (typeof ICON === 'object' && !ICON.vls) ICON.vls = VLS_ICON;
    b = document.createElement('button');
    b.className = 'ib'; b.id = 'b-vls'; b.type = 'button';
    b.title = '垂发导弹：驱逐舰垂直发射长剑-10（亚音速）/ 鹰击-18A（超音速）/ 鹰击-21（高超音速），按目标自动选弹（Y）'; b.setAttribute('aria-label', '垂发导弹');
    b.innerHTML = `<svg viewBox="0 0 24 24" class="ic" aria-hidden="true">${VLS_ICON}</svg><kbd>Y</kbd><em id="n-vls"></em>`;
    b.addEventListener('click', vlsTool);
    const ref = $('b-msl') || $('b-strike');
    ref ? ref.after(b) : $('support').appendChild(b);
  }
  const ships = S.phase === 'sandbox' ? [] : vlsShips(), n = ships.length ? VLS_LAND.reduce((a, k) => a + vlsLeft(k), 0) : 0;
  const dis = S.phase !== 'battle' || !n;
  if (b.disabled !== dis) b.disabled = dis;
  b.hidden = !ships.some(s => VLS_LAND.some(k => (vlsOf(s.o) && s.o.vls0[k]) > 0));   // 舰队里没有能打对陆导弹的舰（如只有 052C / 054A）就不显示
  b.classList.toggle('on', typeof U === 'object' && U.tool === 'vls');
  const em = $('n-vls'), t = String(n);
  if (em && em.textContent !== t) em.textContent = t;
  if (ships.length && (S.vlsTipT ?? -9) + 1 < S.t) { S.vlsTipT = S.t; b.title = `垂发导弹（Y）：长剑-10 ${vlsLeft('cj10')}（亚音速）· 鹰击-18A ${vlsLeft('yj18')}（超音速）· 鹰击-21 ${vlsLeft('yj21')}（高超音速）；舰空导弹 ${vlsLeft('sam')}。点目标发射，按目标自动选弹`; }
}
function vlsTool() {
  if (typeof U !== 'object') return;
  U.tool = U.tool === 'vls' ? null : 'vls';
  if (typeof updateHud === 'function') updateHud();
}
function vlsDrawTop() {
  if (typeof U !== 'object' || U.tool !== 'vls' || !U.mouse || typeof R !== 'object' || !R.ctx) return;
  const ctx = R.ctx, m = U.mouse, T = vlsTgtAt(m.x, m.y), k = vlsWeapon('lacm', T.kind), col = k && isLand(m.x, m.y) ? COL.g : COL.enemy, d = Math.max(10, px(12));
  ctx.strokeStyle = rgba(col, .9); ctx.lineWidth = px(1.5);
  ctx.beginPath(); ctx.moveTo(m.x - d, m.y); ctx.lineTo(m.x - d * .35, m.y); ctx.moveTo(m.x + d * .35, m.y); ctx.lineTo(m.x + d, m.y);
  ctx.moveTo(m.x, m.y - d); ctx.lineTo(m.x, m.y - d * .35); ctx.moveTo(m.x, m.y + d * .35); ctx.lineTo(m.x, m.y + d); ctx.stroke();
  if (k) { ctx.setLineDash([px(4), px(4)]); ctx.beginPath(); ctx.arc(T.x, T.y, MS_PGM[k].pw.R, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = rgba(col, .95); ctx.font = `${Math.round(px(11))}px sans-serif`; ctx.fillText(vlsNmS(k), m.x + d + px(4), m.y - px(4)); }
}

HOOK.step.push(function vlsStepHook(dt) { if (!S || S.phase !== 'battle') return; vlsCommandP(dt); aorStep(dt); });
HOOK.drawOver.push(aorDraw);
HOOK.drawTop.push(vlsDrawTop);
HOOK.frame.push(function vlsHudHook() { vlsHud(); });
HOOK.key.push(function vlsKey(e) {
  if (!S || e.ctrlKey || e.metaKey || e.altKey || e.key.toUpperCase() !== 'Y' || S.phase !== 'battle') return false;
  vlsTool(); return true;
});
HOOK.pointer.push(function vlsPointer(e, kind, p) {
  if (typeof U !== 'object' || U.tool !== 'vls' || kind !== 'down' || !p) return false;
  if (e.button === 2) { U.tool = null; return true; }
  if (e.button !== 0) return false;
  if (!isLand(p.x, p.y)) { log('垂发对陆导弹只能打陆上目标', 'warn', 'vls1', 2); return true; }
  if (vlsFire('lacm', p.x, p.y, 1, 'player', true)) U.tool = null;
  if (typeof updateHud === 'function') updateHud();
  return true;
});
HOOK.newGame.push(() => { if (S) { S.aor = null; S.aorT = 0; S.aorN = 0; S.vlsS = null; } });
