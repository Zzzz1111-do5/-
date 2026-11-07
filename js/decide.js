'use strict';
// 战役决策：玩家是战区司令——平时全交给各级 AI 指挥，只在几个关键处拍板，决定的后果在战场上看得见。
//   ① 决策卡（画面下方）：舰炮齐射、火箭炮覆盖、轰-6K 轰炸各一次；战役预备队（2 艘 271 型登陆艇 + 1 艘 072A 坦克登陆舰）只有你下令才登陆，
//      什么时候投、投到哪个滩头由你定（不投就一直留在大陆）。点卡后点地图选目标，右键 / Esc 取消
//   ② AI 请示（画面上方，15 秒不答按默认「先不动用」）：敌军集结反冲击、推进线久攻不下、敌炮兵阵地暴露
//   ③ 战役进度：作战时限还剩多少、据点分值离七成还差多少、指挥所拿没拿下
//   ④ 复盘（结束画面）：每张卡打在哪、打掉多少；关键时刻时间线
// 只在默认战役与海岛战役里有（沙盒、闯关按预算布兵，不额外送火力）。状态在 S.dec（纯 JSON）
const DEC_CARD = {
  naval: { nm: '舰炮齐射', sub: '055 主炮急速射 24 发', delay: 0, need: () => S.dd && S.dd.state !== 'sunk', no: '驱逐舰已沉没' },
  rocket: { nm: '火箭炮覆盖', sub: 'PHL-16 火箭炮营 36 发', delay: 22 },
  bomber: { nm: '轰-6K 轰炸', sub: '一条 500 米的炸弹带', delay: 20 },
  reserve: { nm: '战役预备队', sub: '2 艘登陆艇 + 1 艘坦克登陆舰', delay: 0 }
};
const DEC_ASK_T = 15;   // 请示等多久（秒，推演时间）
const DEC = { aim: null, el: null, ask: null, rep: false };
const decOn = () => !!(S && S.dec && S.phase === 'battle' && !S.over);
const decWhere = (x, y) => typeof cmdWhere === 'function' ? cmdWhere(x, y) : gridRef(x, y);
const decFmt = t => `${Math.floor(Math.max(0, t) / 60)}:${String(Math.floor(Math.max(0, t) % 60)).padStart(2, '0')}`;
function decEv(msg, kind = 'info') { S.dec.ev.push({ t: Math.round(S.t), msg, kind }); }

HOOK.newGame.push(() => {
  DEC.aim = null; DEC.ask = null; DEC.rep = false;
  if (S) delete S.dec;   // 开战第一步再定有没有（新开局那一刻沙盒、海岛战役的标记还没写好）
  decUi();
});
const decInit = () => { S.dec = !S.sbx || (S.lv && S.lv.isle) ? { left: { naval: 1, rocket: 1, bomber: 1, reserve: 1 }, used: [], ev: [], asked: {}, askT: -999, own: {}, ashore: false, advD: null } : null; };

// —— 敌方在一片地方的兵力（复盘算战果用）——
function decFoes(x, y, r) {
  const o = { men: 0, veh: 0, st: 0 }, r2 = r * r, d2 = (a, b) => (a - x) * (a - x) + (b - y) * (b - y);
  for (const q of S.teams) if (q.side === 'e' && q.men.length && d2(q.x, q.y) < r2) o.men += q.men.length;
  for (const v of S.veh || []) if (v.side === 'e' && !v.dead && d2(v.x, v.y) < r2) o.veh++;
  for (const a of S.armor || []) if (!a.dead && d2(a.x, a.y) < r2) o.veh++;
  for (const e of S.enemies) if (!e.dead && d2(e.x, e.y) < r2) o.st++;
  return o;
}

// —— 用卡 ——
function decUse(k, x, y) {
  const D = S.dec, C = DEC_CARD[k];
  if (!D || !(D.left[k] > 0)) return false;
  if (C.need && !C.need()) { log(`${C.nm}用不了：${C.no}`, 'warn'); return false; }
  x = clamp(x, 20, W - 20); y = clamp(y, 20, H - 20);
  if (k === 'naval' && dist(S.dd.x, S.dd.y, x, y) > 30000) { log(`055 主炮够不着：驱逐舰离目标 ${Math.round(dist(S.dd.x, S.dd.y, x, y) / 1000)} 公里（射程约 30 公里）`, 'warn', 'decfar', 3); return false; }
  if (k === 'reserve' && typeof fsMoving === 'function' && fsMoving()) { log('舰队还在航渡，到了集结海域才能投入战役预备队', 'warn', 'decfs', 3); return false; }
  const where = decWhere(x, y), sg = (typeof gauss === 'function' ? gauss : () => (Math.random() - .5) * 2);
  let r = 120, span = 12;
  if (k === 'naval') {
    const d = dist(S.dd.x, S.dd.y, x, y), dur = 4 + d / 700;
    for (let i = 0; i < 24; i++) { const p = typeof safeAim === 'function' ? safeAim('p', x, y, 30, POWER.naval.R) : [x + sg() * 30, y + sg() * 30]; if (p) fireShell(S.dd.x, S.dd.y, clamp(p[0], 0, W), clamp(p[1], 0, H), 'p', 'naval', dur, false, { t: -i * .45 }); }
    log(`055 型驱逐舰主炮向${where}急速射 24 发`, 'good', 'dec', 0, { x, y }); r = 110; span = 11 + dur;
  } else if (k === 'rocket') {
    for (let i = 0; i < 36; i++) { const p = typeof safeAim === 'function' ? safeAim('p', x, y, 75, POWER.naval.R) : [x + sg() * 75, y + sg() * 75]; if (p) fireShell(clamp(x + sg() * 300, 0, W), H + 2500, clamp(p[0], 0, W), clamp(p[1], 0, H), 'p', 'naval', 22, false, { t: -(i % 12) * .35 - Math.floor(i / 12) * 1.2 }); }
    log(`PHL-16 远程火箭炮营从大陆向${where}齐射 36 发，约 22 秒后落地`, 'good', 'dec', 0, { x, y }); r = 170; span = 22 + 9;
  } else if (k === 'bomber') {
    const n = 24, L = 500;   // 炸弹带沿进攻方向（自南向北）
    for (let i = 0; i < n; i++) { const by = y + L / 2 - L * i / (n - 1), bx = x + sg() * 18; if (typeof ownNear === 'function' && ownNear('p', bx, by, POWER.bomb.R + 25)) continue; fireShell(bx, by + 520, bx, clamp(by, 0, H), 'p', 'bomb', 3, false, { t: -C.delay - i * .12 }); }
    log(`轰-6K 已从战区机场起飞，约 ${C.delay} 秒后在${where}投弹`, 'good', 'dec', 0, { x, y }); r = 280; span = C.delay + 8;
  } else if (k === 'reserve') {
    const bx = x, by = coastAt(clamp(x, 0, W - 1)) + 4, sx = clamp(x, 160, W - 160), sy = H - 50, ships = [];
    for (let i = 0; i < 2; i++) ships.push(addShip('assault', sx + (i - .5) * 60, sy, `预备-${i + 1}`));
    if (SHIP_SPEC.lst) ships.push(addShip('lst', sx, sy + 25, '预备-T'));
    for (const s of ships) s.auto = false;
    if (typeof orderShips === 'function') orderShips(ships, bx, by);
    log(`战役预备队出发：2 艘 271 型登陆艇、1 艘 072A 坦克登陆舰向${decWhere(bx, by)}抢滩`, 'good', 'dec', 0, { x: bx, y: by });
    D.left[k]--;
    D.used.push({ k, t: Math.round(S.t), x: Math.round(bx), y: Math.round(by), where: decWhere(bx, by), ids: ships.map(s => s.id) });
    decEv(`投入战役预备队，在${decWhere(bx, by)}抢滩`, 'good');
    decUi(); return true;
  }
  D.left[k]--;
  D.used.push({ k, t: Math.round(S.t), x: Math.round(x), y: Math.round(y), r, where, t0: S.t + (k === 'naval' ? 3 : C.delay), t1: S.t + span + 12, b: null, a: null });
  decEv(`${C.nm}：${where}`, 'good');
  decUi(); return true;
}

// —— 选目标：点卡之后点地图（2D、3D 都行：render.js toWorld）——
HOOK.pointer.push((e, kind, p) => {
  if (!DEC.aim) return false;
  if (kind !== 'down') return true;
  if (e.button === 2) { decAim(null); return true; }
  if (e.button === 0 && p) { const k = DEC.aim; decAim(null); decUse(k, p.x, p.y); }
  return true;
});
HOOK.key.push(e => { if (DEC.aim && e.key === 'Escape') { decAim(null); return true; } return false; });
function decAim(k) {
  DEC.aim = k;
  if (typeof R === 'object' && R.cv) R.cv.style.cursor = k ? 'crosshair' : '';
  decUi();
}

// —— AI 请示：一次一个，至少隔 60 秒；15 秒不答按默认 ——
function decAsk(id, title, text, opts) {
  const D = S.dec;
  if (DEC.ask || D.asked[id] || S.t - D.askT < 60) return;
  D.asked[id] = 1; D.askT = S.t;
  DEC.ask = { id, title, text, opts, t0: S.t };
  log(`${title}：${text}`, 'warn', 'decask', 0);
  decUi();
}
function decAnswer(i) {
  const A = DEC.ask;
  if (!A) return;
  DEC.ask = null;
  const o = A.opts[i] || A.opts[A.opts.length - 1];
  decEv(`请示「${A.title}」→ ${o.t}${i < 0 ? '（超时，按默认）' : ''}`, o.k ? 'good' : 'info');
  if (o.f) o.f();
  decUi();
}
function decCheck() {
  const D = S.dec;
  // 敌军集结反冲击（守方战区的反冲击火力准备，theater.js thFocusE）
  const F = typeof thFocusE === 'function' ? thFocusE() : null;
  if (F && (D.left.naval > 0 || D.left.rocket > 0)) {
    const opts = [];
    if (D.left.naval > 0 && DEC_CARD.naval.need()) opts.push({ t: '舰炮齐射', k: 1, f: () => decUse('naval', F.x, F.y) });
    if (D.left.rocket > 0) opts.push({ t: '火箭炮覆盖', k: 1, f: () => decUse('rocket', F.x, F.y) });
    opts.push({ t: '先不动用' });
    if (opts.length > 1) decAsk('ctr' + Math.round(F.x / 300) + ',' + Math.round(F.y / 300), '敌军集结反冲击', `守军正在${decWhere(F.x, F.y)}集结，准备向我反冲击。要不要现在打掉它？`, opts);
  }
  // 推进线久攻不下：两分半没往前推，预备队还在手里
  const A = S.th && S.th.p && S.th.p.adv;
  if (A && A.d != null && S.t - A.t > 150 && D.left.reserve > 0) {
    const fp = S.front && S.front.p, seg = fp && fp.seg && fp.seg.length ? fp.seg.slice().sort((a, b) => b.w - a.w)[0] : null, x = seg ? (seg.x0 + seg.x1) / 2 : W / 2;
    decAsk('stall' + Math.floor(S.t / 300), '推进线久攻不下', `推进线已经 ${Math.round((S.t - A.t) / 60)} 分钟没往前推了，我方伤亡 ${S.stats.lost} 人。要不要投入战役预备队？`,
      [{ t: '投入（点地图选滩头）', k: 1, f: () => decAim('reserve') }, { t: '再等等' }]);
  }
  // 敌炮兵阵地暴露：被标定、刚开过火
  if (D.left.bomber > 0 || D.left.rocket > 0) {
    const g = S.enemies.find(e => !e.dead && (e.kind === 'arty' || e.kind === 'mortar') && e.kx != null && S.t - (e.fireT ?? -99) < 20);
    if (g) {
      const opts = [];
      if (D.left.bomber > 0) opts.push({ t: '轰-6K 轰炸', k: 1, f: () => decUse('bomber', g.kx, g.ky) });
      if (D.left.rocket > 0) opts.push({ t: '火箭炮覆盖', k: 1, f: () => decUse('rocket', g.kx, g.ky) });
      opts.push({ t: '不管它' });
      decAsk('gun' + g.id, '敌炮兵阵地暴露', `侦察到敌${g.kind === 'mortar' ? '迫击炮' : '炮兵'}阵地在${decWhere(g.kx, g.ky)}，正在轰击我军。要不要打掉它？`, opts);
    }
  }
}

// —— 每步：记关键时刻、算战果、请示到时 ——
HOOK.step.push(dt => {
  if (!S || S.phase !== 'battle') return;
  if (S.dec === undefined) decInit();
  if (!S.dec) return;
  const D = S.dec;
  if (!D.ev.length) decEv(typeof fsMoving === 'function' && fsMoving() ? '开战：登陆编队从 50 海里外起航' : 'H 时：登陆开始');
  if (S.fs && S.fs.arrT != null && !D.arr) { D.arr = true; decEv('编队抵达集结海域，向滩头展开（作战时限开始计时）'); }
  if (!D.ashore) { const q = S.teams.find(q => q.side === 'p' && q.men.length && !q.ride && isLand(q.x, q.y)); if (q) { D.ashore = true; decEv(`首批部队在${decWhere(q.x, q.y)}上岸`); } }
  for (const p of S.points) {
    const was = D.own[p.key];
    if (was !== undefined && was !== p.owner) { if (p.owner === 'p') decEv(`夺取${p.name || p.key}`, 'good'); else if (was === 'p') decEv(`${p.name || p.key}被敌夺回`, 'bad'); }
    D.own[p.key] = p.owner;
  }
  const A = S.th && S.th.p && S.th.p.adv;
  if (A && A.d != null && (D.advD == null || A.d >= D.advD + 500)) { if (D.advD != null) decEv(`推进线推到离岸 ${Math.round(A.d)} 米`); D.advD = A.d; }
  for (const u of D.used) {
    if (u.k === 'reserve') { if (!u.done && u.ids && S.ships.some(s => u.ids.includes(s.id) && s.state === 'beached')) { u.done = true; decEv(`战役预备队在${u.where}抢滩上陆`, 'good'); } continue; }
    if (!u.b && S.t >= u.t0) u.b = decFoes(u.x, u.y, u.r);
    if (u.b && !u.a && S.t >= u.t1) u.a = decFoes(u.x, u.y, u.r);
  }
  if (DEC.ask && S.t - DEC.ask.t0 > DEC_ASK_T) decAnswer(-1);
  if ((D.ckT = (D.ckT || 0) - dt) <= 0) { D.ckT = 2; if (!S.over) decCheck(); }
});

// —— 界面 ——
const DEC_CSS = `#decBar { position: fixed; left: 50%; bottom: 14px; transform: translateX(-50%); z-index: 25; display: flex; gap: 8px; align-items: stretch; padding: 7px 8px; max-width: calc(100vw - 24px); }
#decBar .pg { display: flex; flex-direction: column; justify-content: center; gap: 2px; padding: 0 10px 0 4px; font-size: 12px; color: var(--mute); white-space: nowrap; border-right: 1px solid var(--line); }
#decBar .pg b { color: var(--fg, #e8e8e0); font-weight: 600; }
#decBar .pg .ok { color: #7dffb0; } #decBar .pg .no { color: #ff8a7a; }
#decBar button.cd { min-width: 96px; padding: 5px 9px; text-align: left; border: 1px solid var(--line); border-radius: 4px; background: rgba(255,255,255,.04); color: var(--fg, #e8e8e0); cursor: pointer; font: inherit; }
#decBar button.cd:hover:not(:disabled) { border-color: var(--line-hi, #9a9); background: rgba(255,255,255,.1); }
#decBar button.cd.on { border-color: #ffd36b; background: rgba(255,211,107,.16); }
#decBar button.cd:disabled { opacity: .35; cursor: default; }
#decBar button.cd .n { display: block; font-size: 13px; font-weight: 600; } #decBar button.cd .s { display: block; font-size: 11px; color: var(--mute); }
#decHint { position: fixed; left: 50%; bottom: 82px; transform: translateX(-50%); z-index: 25; padding: 5px 12px; font-size: 13px; color: #ffd36b; pointer-events: none; }
#decAsk { position: fixed; left: 50%; top: 108px; transform: translateX(-50%); z-index: 41; width: min(460px, calc(100vw - 32px)); padding: 10px 12px 12px; }
#decAsk h4 { margin: 0 0 4px; font-size: 14px; color: #ffd36b; } #decAsk p { margin: 0 0 9px; font-size: 13px; line-height: 1.5; }
#decAsk .bt { display: flex; gap: 8px; flex-wrap: wrap; } #decAsk .bt button { flex: 1 1 auto; padding: 6px 10px; }
#decAsk .bar { height: 2px; margin-top: 9px; background: rgba(255,211,107,.6); transform-origin: left; }
#decRep { margin-top: 10px; text-align: left; font-size: 12px; line-height: 1.6; max-height: 38vh; overflow: auto; }
#decRep h4 { margin: 8px 0 3px; font-size: 13px; } #decRep .good { color: #7dffb0; } #decRep .bad { color: #ff8a7a; } #decRep .t { color: var(--mute); display: inline-block; min-width: 46px; }
@media (max-width: 720px) { #decBar .pg { display: none; } #decBar button.cd { min-width: 70px; } #decBar button.cd .s { display: none; } }`;
function decEl(id, cls, parent) {
  let el = document.getElementById(id);
  if (!el) { el = document.createElement('div'); el.id = id; if (cls) el.className = cls; (parent || document.getElementById('stage') || document.body).appendChild(el); }
  return el;
}
function decUi() {
  if (typeof document === 'undefined') return;
  if (!document.getElementById('decCss')) { const st = document.createElement('style'); st.id = 'decCss'; st.textContent = DEC_CSS; document.head.appendChild(st); }
  const show = decOn() && !(typeof V3FP === 'object' && V3FP.on);   // 亲自驾驶时让给驾驶的界面
  const bar = decEl('decBar', 'ov box'), hint = decEl('decHint', 'ov box'), ask = decEl('decAsk', 'ov box');
  bar.hidden = !show; hint.hidden = !(show && DEC.aim); ask.hidden = !(show && DEC.ask);
  if (!show) return;
  const D = S.dec;
  // 卡：只在数量变了 / 选中变了时重建
  const key = Object.entries(D.left).map(([k, n]) => k + n).join() + '|' + DEC.aim + '|' + (S.dd && S.dd.state);
  if (bar.dataset.k !== key) {
    bar.dataset.k = key; bar.textContent = '';
    const pg = document.createElement('div'); pg.className = 'pg'; bar.appendChild(pg);
    for (const k of Object.keys(DEC_CARD)) {
      const C = DEC_CARD[k], b = document.createElement('button'), n = D.left[k] || 0, ok = n > 0 && (!C.need || C.need());
      b.type = 'button'; b.className = 'cd' + (DEC.aim === k ? ' on' : ''); b.disabled = !ok;
      b.title = ok ? `${C.nm}：${C.sub}（剩 ${n} 次）。点一下，再点地图选目标；右键 / Esc 取消` : n > 0 ? `${C.nm}：${C.no}` : `${C.nm}：已用完`;
      const t = document.createElement('span'); t.className = 'n'; t.textContent = `${C.nm}${n > 0 ? '' : '（已用）'}`;
      const s = document.createElement('span'); s.className = 's'; s.textContent = C.sub;
      b.append(t, s);
      b.addEventListener('click', () => decAim(DEC.aim === k ? null : k));
      bar.appendChild(b);
    }
  }
  decPg(bar.querySelector('.pg'));
  if (DEC.aim) hint.textContent = DEC.aim === 'reserve' ? '点海岸选择预备队抢滩的地方 · 右键 / Esc 取消' : `点地图选择${DEC_CARD[DEC.aim].nm}的目标 · 右键 / Esc 取消`;
  if (DEC.ask) {
    const A = DEC.ask;
    if (ask.dataset.id !== A.id) {
      ask.dataset.id = A.id; ask.textContent = '';
      const h = document.createElement('h4'); h.textContent = A.title;
      const p = document.createElement('p'); p.textContent = A.text;
      const bt = document.createElement('div'); bt.className = 'bt';
      A.opts.forEach((o, i) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'tb'; b.textContent = o.t; b.addEventListener('click', () => decAnswer(i)); bt.appendChild(b); });
      const br = document.createElement('div'); br.className = 'bar';
      ask.append(h, p, bt, br);
    }
    const br = ask.querySelector('.bar'); if (br) br.style.transform = `scaleX(${clamp(1 - (S.t - A.t0) / DEC_ASK_T, 0, 1)})`;
  }
}
// 战役进度：作战时限、据点分值（七成 + 指挥所 = 胜利）
function decPg(el) {
  if (!el) return;
  const share = typeof vpShare === 'function' ? vpShare() : 0, need = typeof VP_WIN === 'number' ? VP_WIN : .7, hq = S.points.find(p => p.key === 'HQ'), left = (typeof LIMIT === 'number' ? LIMIT : 2700) - (typeof battleT === 'function' ? battleT() : S.t);
  const fs = typeof fsMoving === 'function' && fsMoving();
  const h = `<span>${fs ? `航渡中 <b>${Math.round(S.fs.left / 1000)}</b> 公里` : `时限 <b class="${left < 300 ? 'no' : ''}">${decFmt(left)}</b>`}</span><span>据点 <b class="${share >= need ? 'ok' : ''}">${Math.round(share * 100)}%</b> / ${Math.round(need * 100)}%</span><span>指挥所 <b class="${hq && hq.owner === 'p' ? 'ok' : 'no'}">${hq && hq.owner === 'p' ? '已夺取' : '未夺取'}</b>${S.holdT ? ` · 巩固 ${Math.ceil(HOLD - S.holdT)} 秒` : ''}</span>`;
  if (el.dataset.h !== h) { el.dataset.h = h; el.innerHTML = h; }
}
// 复盘：结束画面（hud.js #end）下面加关键决策与时间线
function decReport() {
  const end = document.getElementById('end'), D = S && S.dec;
  if (!end || !D) return;
  const box = end.querySelector('.box') || end;
  const el = decEl('decRep', '', box), esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  const res = u => { if (u.k === 'reserve') return u.done ? '已抢滩上陆、补进战线' : '还没上陆'; if (!u.b) return '还没落地'; const a = u.a || decFoes(u.x, u.y, u.r), m = Math.max(0, u.b.men - a.men), v = Math.max(0, u.b.veh - a.veh), s = Math.max(0, u.b.st - a.st); return m + v + s ? `打在${u.where}，那一片敌军少了 ${m} 人${v ? `、${v} 辆车` : ''}${s ? `、${s} 处火力点` : ''}` : `打在${u.where}，那一片没打掉什么`; };
  const cards = D.used.length ? D.used.map(u => `<div><span class="t">${decFmt(u.t)}</span><b>${DEC_CARD[u.k].nm}</b>：${esc(res(u))}</div>`).join('') : '<div>没有动用决策卡</div>';
  const left = Object.entries(D.left).filter(([, n]) => n > 0).map(([k]) => DEC_CARD[k].nm);
  el.innerHTML = `<h4>关键决策与战果</h4>${cards}${left.length ? `<div class="t" style="min-width:0">没用上的：${left.join('、')}</div>` : ''}<h4>时间线</h4>` +
    D.ev.slice(0, 60).map(e => `<div class="${e.kind === 'good' ? 'good' : e.kind === 'bad' ? 'bad' : ''}"><span class="t">${decFmt(e.t)}</span>${esc(e.msg)}</div>`).join('');
}
HOOK.frame.push(() => {
  if (!S) return;
  if (S.over && S.dec && !DEC.rep) { DEC.rep = true; decEv(S.over === 'win' ? '登陆场巩固，作战胜利' : '作战失利', S.over === 'win' ? 'good' : 'bad'); DEC.aim = null; DEC.ask = null; decReport(); }
  if (!S.over) DEC.rep = false;
  const now = performance.now();
  if (!DEC.uiT || now - DEC.uiT > 250) { DEC.uiT = now; decUi(); }
});
