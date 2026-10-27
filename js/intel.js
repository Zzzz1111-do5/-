'use strict';
// 态势感知（双方）：把各自所有传感器（地面部队、观察所、舰船、侦察机 / 预警机、雷达、无人机）看到的敌人汇成一张「敌情图」，
//   看不见了也不立刻忘：记下最后位置、航向航速，按推算位置继续标着（越久越淡），两分钟没再看到、或者回头去看那里已经没人才划掉；
//   态势感知度 = 敌情图上 60 秒内确认过的敌兵力 / 敌方全部兵力（步兵每人 1、坦克 6、其余车辆 3、舰船 5–8、工事火炮 3）。
// 双方都主动去补盲区：每格（200 × 200）记「最后一次看到这里的时刻」，按关注度（滩头、据点、敌集结处、跟丢了的目标）× 多久没看过排出最该看的地方——
//   守方派 MQ-9A「死神」无人机（eair.js type 'mq9'，中空长航时、光电 / 红外转塔，看得远看得清）飞过去盘旋侦察，看完再去下一处；
//   攻方（AI 指挥航母时）态势感知度低于五成五就派侦察机去最该看的地方照相。
// 画面：敌情图上看不见的敌人画成虚线框（推算位置 + 多少秒前看到的）；据点条下方显示态势感知度（观战显示双方，对战只显示本方）。
// 状态（纯 JSON）：S.intel = { p: {轨迹}, e: {轨迹}, lk: { p: [每格最后看到的时刻], e: [...] }, sa: { p, e }, t, tk }
//   轨迹 key → { k 种类 team / veh / ship / fort, x, y, vx, vy, t 最后看到, t0 首次看到, n 兵力, nm 名称 }
const INTEL = { keep: 120, fresh: 60, dr: 12, cell: 200, ghost: 1.5, task: 40, saRecon: .55 };

function intelEnsure() {
  if (S.intel && S.intel.p && S.intel.lk) return S.intel;
  const nc = Math.ceil(W / INTEL.cell) * Math.ceil(H / INTEL.cell);
  return (S.intel = { p: {}, e: {}, lk: { p: Array(nc).fill(-999), e: Array(nc).fill(-999) }, sa: { p: 0, e: 0 }, t: 0, tk: { p: 20, e: 25 } });
}
const intelCell = (x, y) => Math.floor(clamp(y, 0, H - 1) / INTEL.cell) * Math.ceil(W / INTEL.cell) + Math.floor(clamp(x, 0, W - 1) / INTEL.cell);
// 推算位置：最后位置 + 航速 × 时间（最多推 12 秒，人和车不会一直直线走）
function intelEst(tr) {
  const k = Math.min(S.t - tr.t, INTEL.dr);
  return [clamp(tr.x + tr.vx * k, 0, W), clamp(tr.y + tr.vy * k, 0, H)];
}
// side 方要掌握的敌方实体：[key, 对象, 兵力, 名称, 种类]
function intelFoes(side) {
  const out = [], o = side === 'p' ? 'e' : 'p';
  for (const q of S.teams) if (q.side === o && q.men.length && !q.ride) out.push(['t' + q.id, q, q.men.length, '步兵', 'team']);
  for (const v of S.veh || []) if (v.side === o && !v.dead && !v.lst) out.push(['v' + v.id, v, typeof BG_TANK === 'object' && BG_TANK.includes(v.type) ? 6 : 3, typeof vehName === 'function' ? vehName(v) : '车辆', 'veh']);
  if (side === 'p') {
    for (const a of S.armor || []) if (!a.dead) out.push(['a' + a.id, a, 4, '装甲车辆', 'veh']);
    for (const e of S.enemies) if (!e.dead && e.kind !== 'airfield' && ENEMY_SPEC[e.kind]) out.push(['f' + e.id, e, 3, ENEMY_SPEC[e.kind].name, 'fort']);
    for (const e of S.eships || []) if (!e.dead) out.push(['s' + e.id, e, 6, '水面舰艇', 'ship']);
  } else {
    for (const s of S.ships) if (alive(s)) out.push(['s' + s.id, s, s.kind === 'lst' ? 8 : s.kind === 'dd' ? 6 : 5, `${s.label}${s.kind === 'dd' ? '' : '登陆舰'}`, 'ship']);
    if (S.dd && S.dd.state !== 'sunk' && isFinite(S.dd.x)) out.push(['sDD', S.dd, 7, S.dd.name || '驱逐舰', 'ship']);
    if (S.cv && S.cv.hp > 0 && isFinite(S.cv.x)) out.push(['sCV', S.cv, 8, '航空母舰', 'ship']);
  }
  return out;
}
function intelSide(I, side) {
  const T = I[side], now = S.t, radar = side === 'e' && typeof radarUp === 'function' ? radarUp() : null;
  const seen = side === 'p' ? inVision : spotted, seenO = (o, k) => k === 'ship' && side === 'e' ? shipSeen(o.x, o.y, radar) : seen(o.x, o.y);
  const live = new Set();
  let tot = 0, known = 0;
  for (const [key, o, n, nm, k] of intelFoes(side)) {
    live.add(key); tot += n;
    let tr = T[key];
    if (seenO(o, k)) {
      if (tr) {
        const d = now - tr.t;
        if (d > 0 && d < 8) { tr.vx = Math.round(lerp(tr.vx, (o.x - tr.x) / d, .5) * 10) / 10; tr.vy = Math.round(lerp(tr.vy, (o.y - tr.y) / d, .5) * 10) / 10; } else { tr.vx = 0; tr.vy = 0; }
        tr.x = Math.round(o.x); tr.y = Math.round(o.y); tr.t = now; tr.n = n; tr.nm = nm;
      } else T[key] = tr = { k, x: Math.round(o.x), y: Math.round(o.y), vx: 0, vy: 0, t: now, t0: now, n, nm };
    }
    if (tr && now - tr.t < INTEL.fresh) known += n;
  }
  for (const key in T) {
    const tr = T[key];
    if (!live.has(key) || now - tr.t > INTEL.keep) { delete T[key]; continue; }
    if (now - tr.t > 4 && tr.k !== 'fort') { const [ex, ey] = intelEst(tr); if (seen(ex, ey) && seen(tr.x, tr.y)) delete T[key]; }   // 回头看推算位置：人不在了——跟丢了，划掉
  }
  I.sa[side] = tot ? Math.round(known / tot * 100) / 100 : 1;
  // 每格最后一次看到的时刻（格中心与四角各看一眼）
  const L = I.lk[side], cw = Math.ceil(W / INTEL.cell), C = INTEL.cell;
  for (let i = 0; i < L.length; i++) {
    const x0 = (i % cw) * C, y0 = Math.floor(i / cw) * C;
    if (seen(x0 + C / 2, y0 + C / 2) || seen(x0 + C * .2, y0 + C * .2) || seen(x0 + C * .8, y0 + C * .8)) L[i] = now;
  }
}
// side 方最该去看的地方：关注度 × 多久没看过（封顶 180 秒）；返回 { x, y, age, why } 或 null
function intelTask(side) {
  const I = intelEnsure(), L = I.lk[side], cw = Math.ceil(W / INTEL.cell), C = INTEL.cell, wt = new Map();
  const add = (x, y, w, why) => { const i = intelCell(x, y), o = wt.get(i); if (!o || o.w < w) wt.set(i, { w: (o ? o.w * .3 : 0) + w, why, x, y }); };
  for (const p of S.points) {
    const mine = side === 'p' ? p.owner === 'p' : p.owner === 'e';
    add(p.x, p.y, mine ? .6 : 2.6, mine ? '己方据点周边' : `${p.name || '据点'}一带`);
  }
  for (const key in I[side]) { const tr = I[side][key], age = S.t - tr.t; if (age > 15) { const [x, y] = intelEst(tr); add(x, y, 2 + Math.min(tr.n, 12) / 6, `跟丢的${tr.nm}`); } }
  if (side === 'e') {   // 守方：各处滩头与近岸海面（敌人从这里上来）
    for (const b of TER.beaches || []) { const x = b.cx ?? ((b.x0 + b.x1) / 2); if (isFinite(x)) { add(x, coastAt(clamp(x, 0, W - 1)) - 60, 2.2, '滩头'); add(x, coastAt(clamp(x, 0, W - 1)) + 220, 1.4, '近岸海面'); } }
  } else {   // 攻方：敌纵深（据点后方的道路、预备队可能的集结处）
    for (const p of S.points) if (p.owner !== 'p') add(p.x, Math.max(60, p.y - 260), 1.2, `${p.name || '据点'}后方`);
  }
  let best = null, bs = 0;
  for (const [i, o] of wt) {
    const age = Math.min(180, S.t - L[i]), s = o.w * age;
    if (age > 25 && s > bs) { bs = s; best = { x: clamp((i % cw) * C + C / 2, 60, W - 60), y: clamp(Math.floor(i / cw) * C + C / 2, 60, H - 60), age: Math.round(age), never: L[i] < 0, why: o.why }; }
  }
  return best;
}
// 推算位置在 (x, y) r 以内的敌情（AI 用）
const intelNear = (side, x, y, r) => Object.values((S.intel && S.intel[side]) || {}).filter(tr => { const [ex, ey] = intelEst(tr); return dist(ex, ey, x, y) < r; });

function intelStep(dt) {
  if (!S || S.phase !== 'battle') return;
  const I = intelEnsure();
  if ((I.t -= dt) > 0) return;
  I.t = 1;
  intelSide(I, 'p'); intelSide(I, 'e');
  // 攻方 AI：态势感知度低就派侦察机去最该看的地方（指挥官控制航母时；commander.js cmdAir 排进空中请求）
  if ((I.tk.p -= 1) <= 0) {
    I.tk.p = INTEL.task;
    if (I.sa.p < INTEL.saRecon && typeof cmdAir === 'function' && S.cmd && S.cmd.p) {
      const T = intelTask('p');
      if (T && cmdAir('recon', T.x, T.y)) { I.lastP = { ...T, t: S.t }; if (typeof chatSay === 'function') chatSay('p', `敌情不清（只掌握约 ${Math.round(I.sa.p * 100)}%），派侦察机去看看${typeof cmdWhere === 'function' ? cmdWhere(T.x, T.y) : ''}——那边${T.never ? '开战以来还没人看过' : ` ${T.age} 秒没人看过了`}。`, { kind: 'plan', lv: 1, at: T, key: 'intelP', gap: 60 }); }
    }
  }
}
HOOK.step.push(intelStep);

// —— 画面：看不见的敌情（虚线框 + 推算位置 + 多少秒前）；观战看双方时不画（全都看得见）——
function intelViewSide() {
  if (typeof R !== 'object') return null;
  if (R.eye === 'all' || R.eye === 'both') return null;
  return R.eye === 'e' || S.role === 'defend' ? 'e' : 'p';
}
HOOK.drawOver.push(function intelDraw() {
  const side = S && S.intel && S.phase === 'battle' ? intelViewSide() : null;
  if (!side || !R.ctx) return;
  const ctx = R.ctx, T = S.intel[side], col = side === 'p' ? COL.enemy : COL.g, CL = [];
  // 挨得近的（70 以内）并成一处：一个虚线框、一个标签（步兵约 N 人、车 N 辆，最近一次是多少秒前），不堆成一片字
  for (const key in T) {
    const tr = T[key], age = S.t - tr.t;
    if (age < INTEL.ghost || tr.k === 'fort') continue;   // 工事有自己的标定（e.kx）
    const [x, y] = intelEst(tr);
    if (!inView(x, y, 60)) continue;
    let c = CL.find(c => dist(c.x, c.y, x, y) < 70);
    if (!c) CL.push(c = { x, y, n: 0, men: 0, veh: [], ship: 0, age: 1e9, mv: [] });
    c.x = (c.x * c.n + x) / (c.n + 1); c.y = (c.y * c.n + y) / (c.n + 1); c.n++; c.age = Math.min(c.age, age);
    if (tr.k === 'team') c.men += tr.n; else if (tr.k === 'ship') c.ship++; else c.veh.push(tr.nm);
    if (Math.hypot(tr.vx, tr.vy) > 1) c.mv.push([tr.x, tr.y, x, y]);
  }
  ctx.save(); ctx.font = font(10); ctx.textAlign = 'center';
  for (const c of CL) {
    const a = clamp(1 - c.age / INTEL.keep, .35, 1), s = Math.max(px(9), 8 + Math.min(c.men / 2 + c.veh.length * 3 + c.ship * 6, 14));
    ctx.strokeStyle = rgba(col, a); ctx.lineWidth = px(1.6); ctx.setLineDash([px(3), px(3)]);
    ctx.beginPath(); ctx.moveTo(c.x, c.y - s); ctx.lineTo(c.x + s, c.y); ctx.lineTo(c.x, c.y + s); ctx.lineTo(c.x - s, c.y); ctx.closePath(); ctx.stroke();
    for (const [x0, y0, x1, y1] of c.mv) { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); }   // 最后位置 → 推算位置
    ctx.setLineDash([]);
    const vn = c.veh.length === 1 ? c.veh[0] : c.veh.length ? `车 ${c.veh.length} 辆` : '';
    const txt = `${[c.men && `步兵约 ${c.men} 人`, vn, c.ship && `舰船 ${c.ship}`].filter(Boolean).join('、')} · ${Math.round(c.age)}秒前`, tw = ctx.measureText(txt).width, ty = c.y - s - px(5);
    ctx.fillStyle = `rgba(0,10,6,${.72 * a})`; ctx.fillRect(c.x - tw / 2 - px(3), ty - px(10), tw + px(6), px(13));   // 标签底衬：压在城镇、林地上也看得清
    ctx.fillStyle = rgba(col, Math.min(1, a + .15)); ctx.fillText(txt, c.x, ty);
  }
  ctx.restore();
});
// —— 界面：据点条下方（制空权条再往下）的态势感知度 ——
const IN_UI = { el: null, t: 0 };
function intelHud() {
  if (typeof document === 'undefined' || typeof $ !== 'function' || !$('stage')) return;
  let el = IN_UI.el;
  if (!el) {
    el = IN_UI.el = document.createElement('div');
    el.id = 'sabar'; el.className = 'ov box'; el.hidden = true; el.setAttribute('aria-label', '态势感知');
    const st = document.createElement('style');
    st.textContent = `#sabar { left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 8px; padding: 2px 10px; font-size: 12px; pointer-events: none; }
#sabar[hidden] { display: none; } #sabar b { font-weight: 400; color: var(--mute); } #sabar .p { color: var(--g); } #sabar .e { color: var(--enemy); } #sabar i { font-style: normal; color: var(--mute); }`;
    document.head.appendChild(st);
    $('stage').appendChild(el);
  }
  const I = S && S.intel, show = !!(I && S.phase === 'battle');
  if (el.hidden !== !show) el.hidden = !show;
  if (!show) return;
  const now = performance.now();
  if (now - IN_UI.t < 500) return;
  IN_UI.t = now;
  const aw = $('airsup'), o = $('objs'), ref = aw && !aw.hidden ? aw : o, r = ref && ref.getBoundingClientRect(), top = (r && r.height ? Math.round(r.bottom + 4) : 80) + 'px';
  if (el.style.top !== top) el.style.top = top;
  const pb = $('pauseBand'), pt = Math.round(el.getBoundingClientRect().bottom + 6) + 'px';
  if (pb && pb.style.top !== pt) pb.style.top = pt;
  const pc = v => `${Math.round(v * 100)}%`, both = specAll() || R.eye === 'all' || R.eye === 'both', mine = intelViewSide() || 'p';
  const html = both ? `<b>态势感知</b><span class="p">攻方 ${pc(I.sa.p)}</span><i>·</i><span class="e">守方 ${pc(I.sa.e)}</span>` : `<b>态势感知</b><span class="${mine}">${pc(I.sa[mine])}</span><i>（掌握的敌兵力）</i>`;
  if (el.innerHTML !== html) el.innerHTML = html;
}
HOOK.frame.push(function intelHudHook() { intelHud(); });
