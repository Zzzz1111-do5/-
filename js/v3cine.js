'use strict';
// 电影镜头（3D 地图里，V 键或右上角「电影」按钮；用户：增加这个游戏的电影感）：像战争片的导演一样自动找战场上好看的地方切镜头跟拍——
//   导弹点火出筒（发射架 / 舰旁低机位，镜头摇着跟导弹上去）、跟在导弹 / 战斗机后面追拍、站在航路前方看飞机呼啸而过、
//   爆炸后绕着火球慢慢转、贴地跟着开火的坦克、贴着海面跟抢滩的登陆艇，都没有就从高处绕着战线慢慢转的大全景。
//   每个镜头 4–8 秒，换镜头是硬切（电影剪辑），镜头里的运动有阻尼、带一点手持的晃动；画面上下加宽银幕黑边（2.39 : 1），不画地名、标号这些界面，
//   后期加一圈以画面中心为焦点的浅景深（v3post.js uCine）。推演照常进行，只是换了看的方式；拖动 / 按 W A S D 这些自由镜头操作就退出
// 状态只在画面里（不进 S）：V3C = { on, sh 当前镜头, E / L 镜头位置与注视点（GL 坐标）, last 上一个镜头的类型与对象 }
const V3C = { on: false, sh: null, E: null, L: null, t: 0, last: null, bars: null, k: 0 };
const V3C_LEN = { launch: 4.6, chase: 6, flyby: 5, orbit: 6.5, ground: 6, naval: 6.5, wide: 7.5 };

function v3cToggle(on = !V3C.on) {
  if (on) {
    if (typeof v3Toggle === 'function' && !V3.on) v3Toggle(true);
    if (!V3.on) return;
    if (typeof V3O === 'object' && V3O.on) v3oToggle(false);
    Object.assign(V3C, { on: true, sh: null, E: null, L: null, last: null, t: performance.now() });
    if (typeof log === 'function') log('电影镜头：自动跟拍战场上精彩的地方 · V / Esc 退出', 'info', 'v3c', 1);
  } else {
    if (V3C.on && V3.fc && V3C.E) {   // 退出：自由镜头就停在电影镜头最后的位置、看着同一个地方
      const E = V3C.E, d = [V3C.L[0] - E[0], V3C.L[1] - E[1], V3C.L[2] - E[2]], yaw = Math.atan2(-d[1], d[0]), pitch = clamp(Math.atan2(d[2], Math.hypot(d[0], d[1])), -1.45, .6);
      Object.assign(V3.fc, { x: E[0], y: -E[1], z: E[2], yaw, yawT: yaw, pitch, pitchT: pitch, cx: null, cy: null });
    }
    V3C.on = false;
  }
  v3cBars(V3C.on);
  const b = typeof document !== 'undefined' && document.getElementById('btnCine');
  if (b) { b.classList.toggle('on', V3C.on); b.setAttribute('aria-pressed', V3C.on ? 'true' : 'false'); }
}
// 宽银幕黑边：上下各一条，从 0 滑到 2.39 : 1 画幅剩下的高度（界面按钮压在上面照样能点）
function v3cBars(on) {
  if (typeof document === 'undefined') return;
  if (!V3C.bars) {
    const st = document.createElement('style');
    st.textContent = '.v3c-bar { position: fixed; left: 0; right: 0; height: 0; background: #000; z-index: 4; pointer-events: none; transition: height .9s cubic-bezier(.3, .7, .2, 1); }'
      + '#v3cTop { top: 0; } #v3cBot { bottom: 0; } #btnCine.on { color: var(--bg); background: var(--g); border-color: var(--g); }'
      // 电影镜头里收起战报、据点栏、小地图、信息卡（只留右上角的按钮好退出）
      + '#feed, #objs, #bottom, #info, #thPanel { transition: opacity .6s; } body.cine-on #feed, body.cine-on #objs, body.cine-on #bottom, body.cine-on #info, body.cine-on #thPanel { opacity: 0; pointer-events: none; }';
    document.head.appendChild(st);
    V3C.bars = ['v3cTop', 'v3cBot'].map(id => { const d = document.createElement('div'); d.id = id; d.className = 'v3c-bar'; document.body.appendChild(d); return d; });
  }
  document.body.classList.toggle('cine-on', !!on);
  const h = on ? Math.max(0, (innerHeight - innerWidth / 2.39) / 2) : 0;
  for (const d of V3C.bars) d.style.height = h + 'px';
}
if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('resize', () => { if (V3C.on) v3cBars(true); });

// —— 找镜头 ——
// 画面里导弹的位置（同 v3fx.js：低空沿地形包络、高空按海拔）
const v3cMslZ = m => m.z3 != null ? m.z3 : v3AltZ(m.x, m.y, (m.z || 0) * (m.kind === 'tbm' ? 620 : V3_AIR), -2.6, 2);
const v3cSeen = (x, y, side) => (typeof specAll === 'function' && specAll()) || side === S.ctl || side === 'p' && !S.ctl || (typeof inVision === 'function' && inVision(x, y));
// 战场上现在值得拍的东西，按分数挑一个（同类型、同一个对象接着拍的扣分，换着看）
function v3cPick() {
  const C = [], add = (k, o, sc, extra) => C.push({ k, o, sc: sc + Math.random() * 2.5 - (V3C.last && V3C.last.k === k ? 3 : 0) - (V3C.last && V3C.last.o === o ? 6 : 0), ...(extra || {}) });
  for (const m of S.missiles || []) {
    if (m.done || m.t < 0 || !isFinite(m.x) || m.x < -300 || m.x > W + 300 || m.y < -300 || m.y > H + 300 || !v3cSeen(m.x, m.y, m.side)) continue;   // 地图外的（远处大陆上刚起飞的弹道导弹）画面里不画，拍不到
    const air = m.src === 'aam' || m.src === 'fp' || (typeof AIRV === 'object' && AIRV.mv && AIRV.mv.has(m.id));
    if (m.t < 1.2 && !air) add('launch', m, 11 + (m.kind === 'tbm' || m.kind === 'sam' ? 2 : 0));
    else add('chase', m, 7 + (m.kind === 'tbm' ? 2 : 0));
  }
  const air = [...(S.planes || []).filter(p => !p.dead && (p.alt || 0) > .05 && isFinite(p.x)), ...((S.eair && S.eair.fly) || []).filter(a => !a.dead && isFinite(a.x) && (a.alt || 0) > .05)];
  for (const a of air) if (a.x > -500 && a.x < W + 500 && a.y > -500 && a.y < H + 500 && v3cSeen(a.x, a.y, S.planes.includes(a) ? 'p' : 'e')) add(Math.random() < .55 ? 'chase' : 'flyby', a, 6);
  for (const f of S.fx || []) if ((f.kind === 'boom' || f.kind === 'b2') && f.life < .6 && v3cSeen(f.x, f.y, 'x')) add('orbit', f, 8 + (f.r || 0) / 20);
  for (const v of S.veh || []) if (!v.dead && !v.lst && v.fireT != null && S.t - v.fireT < 2.5 && isLand(v.x, v.y) && v3cSeen(v.x, v.y, v.side)) add('ground', v, 6);
  for (const s of S.ships || []) if (alive(s) && s.land && s.state === 'move' && s.bx != null) add('naval', s, 4);
  add('wide', null, 1.5);
  C.sort((a, b) => b.sc - a.sc);
  return C[0];
}
// 镜头对象此刻的位置（GL 坐标）与速度方向；拍不到了返回 null
function v3cSubj(sh) {
  const o = sh.o;
  if (sh.k === 'wide') {   // 战线中段：双方地面部队的中心
    const P = S.teams.filter(q => q.men.length && !q.ride && isLand(q.x, q.y));
    const c = P.length ? P.reduce((a, q) => [a[0] + q.x / P.length, a[1] + q.y / P.length], [0, 0]) : [W / 2, H * .6];
    return { p: [c[0], -c[1], v3Ht(clamp(c[0], 0, W - 1), clamp(c[1], 0, H - 1))], d: [0, 1, 0] };
  }
  if (sh.k === 'orbit') return S.fx.includes(o) || S.t - sh.t0 < 3 ? { p: [o.x, -o.y, (o.air ? v3AltZ(o.x, o.y, Math.max(0, clamp(o.alt ?? 1, 0, 1) - .05) * V3_AIR, -2.6, 1.5) : Math.max(v3Ht(clamp(o.x, 0, W - 1), clamp(o.y, 0, H - 1)), -2.6)) + 6], d: [1, 0, 0] } : null;
  let p, hd = null;
  if (S.missiles && S.missiles.includes(o)) {   // 同 v3fx.js：垂发冲出、转向那一段按出筒的位置
    if (o.done) return null;
    const z = v3cMslZ(o), V = typeof v3MslPos === 'function' ? v3MslPos(o, z) : null;
    p = V ? [V.x, -V.y, V.z] : [o.x, -o.y, z];
  }
  else if (S.veh && S.veh.includes(o)) { if (o.dead) return null; p = [o.x, -o.y, v3Ht(clamp(o.x, 0, W - 1), clamp(o.y, 0, H - 1)) + 2]; hd = o.aim ?? o.heading; }
  else if (S.ships && S.ships.includes(o)) { if (!alive(o)) return null; p = [o.x, -o.y, -1]; hd = o.heading; }
  else { if (o.dead) return null; p = [o.x, -o.y, typeof v3AirZ === 'function' ? v3AirZ(o) : 120]; hd = o.heading; }
  // 速度方向：按上一帧的位置算（导弹、飞机）；车、船按朝向
  let d = sh.pp ? [p[0] - sh.pp[0], p[1] - sh.pp[1], p[2] - sh.pp[2]] : null, l = d ? Math.hypot(d[0], d[1], d[2]) : 0;
  if (l > .05) d = d.map(v => v / l); else d = sh.d || (hd != null ? [Math.cos(hd), -Math.sin(hd), 0] : [0, 1, 0]);
  if (hd != null && !(S.missiles && S.missiles.includes(o)) && !(o.alt > .05)) d = [Math.cos(hd), -Math.sin(hd), 0];
  sh.pp = p; sh.d = d;
  return { p, d };
}
// 新镜头：定下机位的参数（固定机位的放在哪、追拍在哪一侧）
function v3cStart(c) {
  const sh = { k: c.k, o: c.o, t0: S.t, w0: performance.now(), len: V3C_LEN[c.k] * (.85 + Math.random() * .3), sd: Math.random() < .5 ? -1 : 1, a0: Math.random() * 6.28, pp: null, d: null };
  const s = v3cSubj(sh);
  if (!s) return null;
  const { p, d } = s, side = [-d[1], d[0], 0], sl = Math.hypot(side[0], side[1]) || 1;
  side[0] /= sl; side[1] /= sl;
  if (c.k === 'launch') {   // 发射：离发射点 120–220 米的低机位，侧前方仰拍
    const r = 120 + Math.random() * 100, a = sh.a0;
    sh.fix = [p[0] + Math.cos(a) * r, p[1] + Math.sin(a) * r, Math.max(p[2], -2.6) + 6 + Math.random() * 10];
  } else if (c.k === 'flyby') {   // 掠过：站在航路前方 450 米、侧开 70 米，飞机从镜头边上呼啸而过
    sh.fix = [p[0] + d[0] * 450 + side[0] * 70 * sh.sd, p[1] + d[1] * 450 + side[1] * 70 * sh.sd, p[2] + (Math.random() < .5 ? -18 : 14)];
  }
  if (sh.fix) { const g = v3Ht(clamp(sh.fix[0], 0, W - 1), clamp(-sh.fix[1], 0, H - 1)); sh.fix[2] = Math.max(sh.fix[2], Math.max(g, -2.6) + 3); }
  return sh;
}
// 这一镜里机位、注视点该在哪（GL 坐标）
function v3cWant(sh, s, u) {
  const { p, d } = s, side = [-d[1], d[0], 0], sl = Math.hypot(side[0], side[1]) || 1, sd = sh.sd;
  side[0] /= sl; side[1] /= sl;
  switch (sh.k) {
    case 'launch': case 'flyby': return { E: sh.fix, L: p };
    case 'chase': {   // 追拍：在后上方偏一侧，越拍越往侧面绕一点；注视点在前面一点
      const m = S.missiles && S.missiles.includes(sh.o), b = m ? 34 : 70, h = m ? 7 : 14, sw = (m ? 9 : 22) * sd * (.4 + u);
      return { E: [p[0] - d[0] * b + side[0] * sw, p[1] - d[1] * b + side[1] * sw, p[2] - d[2] * b + h], L: [p[0] + d[0] * 30, p[1] + d[1] * 30, p[2] + d[2] * 30] };
    }
    case 'orbit': {   // 绕着爆炸慢慢转：半径 140、高 40，每秒转 0.13 弧度
      const a = sh.a0 + u * sh.len * .13 * sd, r = 150 - 30 * u;
      return { E: [p[0] + Math.cos(a) * r, p[1] + Math.sin(a) * r, p[2] + 34], L: p };
    }
    case 'ground': {   // 贴地跟拍开火的坦克：车后侧 26 米、离地 3 米，看车炮指的方向
      return { E: [p[0] - d[0] * 26 + side[0] * 9 * sd, p[1] - d[1] * 26 + side[1] * 9 * sd, p[2] + 2.2], L: [p[0] + d[0] * 90, p[1] + d[1] * 90, p[2] + 2] };
    }
    case 'naval': {   // 贴着海面跟抢滩的登陆艇：艇后侧、离水 4 米，看前面的海滩
      return { E: [p[0] - d[0] * 60 + side[0] * 20 * sd, p[1] - d[1] * 60 + side[1] * 20 * sd, 3.5], L: [p[0] + d[0] * 200, p[1] + d[1] * 200, 6] };
    }
    default: {   // 大全景：高处绕战线中段慢慢转
      const a = sh.a0 + u * sh.len * .05 * sd;
      return { E: [p[0] + Math.cos(a) * 1300, p[1] + Math.sin(a) * 1300, p[2] + 520], L: p };
    }
  }
}
// 每帧（view3d.js v3Draw 开头）：该换镜头就换（硬切），机位、注视点带阻尼跟上，画面中心跟着注视点（贴图、细节档都按它）
function v3cStep(now) {
  const dt = clamp((now - (V3C.t || now)) / 1000, 0, .1);
  V3C.t = now;
  let sh = V3C.sh, s = sh && v3cSubj(sh);
  const age = sh ? (now - sh.w0) / 1000 : 0;
  if (sh && !s && !sh.lost) { sh.lost = now; }   // 拍的东西没了（导弹命中、飞机被打下）：机位停住看 1.5 秒再切
  if (!sh || age > sh.len || (sh.lost && now - sh.lost > 1500)) {
    let n = null;
    for (let i = 0; i < 4 && !n; i++) { const c = v3cPick(); if (c) n = v3cStart(c); }
    if (n) { V3C.last = { k: n.k, o: n.o }; V3C.sh = sh = n; s = v3cSubj(sh); V3C.cut = true; }
  }
  if (!sh) return;
  if (s) sh.lastS = s; else s = sh.lastS;
  if (!s) return;
  const W0 = v3cWant(sh, s, clamp((now - sh.w0) / 1000 / sh.len, 0, 1)), p = s.p;
  // 阻尼加在「相对拍摄对象的偏移」上：快进时对象一帧挪几百米，镜头也不会被甩在后面；固定机位就钉在原地
  if (V3C.cut || !V3C.E) { V3C.eo = W0.E.map((v, i) => v - p[i]); V3C.lo = W0.L.map((v, i) => v - p[i]); V3C.cut = false; }
  else {
    const fast = sh.k === 'chase', ke = 1 - Math.exp(-dt * (fast ? 5 : 2.2)), kl = 1 - Math.exp(-dt * (fast ? 8 : 4));
    for (let i = 0; i < 3; i++) { V3C.eo[i] += (W0.E[i] - p[i] - V3C.eo[i]) * ke; V3C.lo[i] += (W0.L[i] - p[i] - V3C.lo[i]) * kl; }
  }
  V3C.E = sh.fix ? sh.fix.slice() : V3C.eo.map((v, i) => v + p[i]);
  V3C.L = V3C.lo.map((v, i) => v + p[i]);
  const g = v3Ht(clamp(V3C.E[0], 0, W - 1), clamp(-V3C.E[1], 0, H - 1));
  if (V3C.E[2] < Math.max(g, -2.6) + 1.5) V3C.E[2] = Math.max(g, -2.6) + 1.5;   // 不钻进地面、海面以下
  CAM.x = clamp(V3C.L[0], 0, W); CAM.y = clamp(-V3C.L[1], 0, H);
  const dist = Math.hypot(V3C.L[0] - V3C.E[0], V3C.L[1] - V3C.E[1], V3C.L[2] - V3C.E[2]);
  CAM.z = CAM.fit * clamp(1800 / Math.max(60, dist * .9), 1.2, 9);
}
// 镜头矩阵（同观察者模式 v3oCamera）：手持的晃动只转视线（几个不同频率的正弦叠起来，量很小）；视野比平时略窄一点，像长焦
function v3cCamera() {
  const E = V3C.E || [W / 2, -H / 2, 600], L0 = V3C.L || [W / 2, -H / 2 + 1, 0], now = performance.now() / 1000, dl = Math.hypot(L0[0] - E[0], L0[1] - E[1], L0[2] - E[2]);
  const hh = (V3C.sh && (V3C.sh.k === 'ground' || V3C.sh.k === 'naval' || V3C.sh.k === 'launch') ? .006 : .0025) * dl;
  const L = [L0[0] + hh * (Math.sin(now * 1.3) + .5 * Math.sin(now * 2.9 + 1)), L0[1] + hh * (Math.sin(now * 1.1 + 2) + .5 * Math.sin(now * 3.3)), L0[2] + hh * .7 * (Math.sin(now * 1.7 + 4) + .4 * Math.sin(now * 4.1))];
  const f = v3Norm([L[0] - E[0], L[1] - E[1], L[2] - E[2]]), z = [-f[0], -f[1], -f[2]];
  const x = v3Norm(v3Cross([0, 0, 1], z)), y = v3Cross(z, x);
  const view = new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -v3Dot(x, E), -v3Dot(y, E), -v3Dot(z, E), 1]);
  const alt = E[2] - Math.max(v3Ht(clamp(E[0], 0, W - 1), clamp(-E[1], 0, H - 1)), -2.6), D = clamp(Math.max(alt * 5, dl * 2.5), 520, 2600);
  const rd = v3RD(), fog = [D * 1.3 * rd, D * 2.8 * rd], asp = CAM.vw / Math.max(1, CAM.vh), fo = 1 / Math.tan(V3_FOV * .82 / 2), n = clamp(dl * .02, .8, 6), fa = Math.max(D * 4, fog[1] * 1.3), nf = 1 / (n - fa);
  const proj = new Float32Array([fo / asp, 0, 0, 0, 0, fo, 0, 0, 0, 0, (fa + n) * nf, -1, 0, 0, 2 * fa * n * nf, 0]);
  return (V3.cam = { E, x, y, z, D, rd, fog, asp, M: v3Mul(proj, view) });
}
// 快捷键：V 开关（亲自驾驶时 V 另有用处，不管）；Esc 退出；自由镜头的操作键（W A S D Q E R F）退出电影镜头、交还给你
HOOK.key.push(e => {
  if (typeof V3FP === 'object' && V3FP.on) return false;
  const k = e.key;
  if ((k === 'v' || k === 'V') && !e.ctrlKey && !e.metaKey && !e.altKey && typeof v3Can === 'function' && v3Can()) { v3cToggle(); return true; }
  if (!V3C.on) return false;
  if (k === 'Escape') { v3cToggle(false); return true; }
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'KeyR', 'KeyF'].includes(e.code)) v3cToggle(false);
  return false;
});
// 拖动地图（自由镜头操作）也退出
HOOK.pointer.push((e, kind) => { if (V3C.on && kind === 'down' && e.button !== undefined && e.button !== 0) v3cToggle(false); return false; });
HOOK.frame.push(() => { if (V3C.on && (!V3.on || (typeof V3FP === 'object' && V3FP.on) || (typeof V3O === 'object' && V3O.on))) v3cToggle(false); });
HOOK.newGame.push(() => { if (V3C.on) v3cToggle(false); });
// 右上角 3D 镜头按钮组里加「电影」
function v3cButton() {
  const c = typeof document !== 'undefined' && document.getElementById('v3ctl');
  if (!c) { setTimeout(v3cButton, 200); return; }
  if (document.getElementById('btnCine')) return;
  const b = document.createElement('button');
  b.id = 'btnCine'; b.type = 'button'; b.className = 'tb'; b.textContent = '电影'; b.title = '电影镜头（V）：自动跟拍导弹发射、空战、爆炸、坦克冲锋、抢滩，宽银幕画幅；V / Esc 退出'; b.setAttribute('aria-pressed', 'false');
  b.style.minWidth = '48px'; b.style.fontSize = '13px';
  b.addEventListener('click', () => v3cToggle());
  c.appendChild(b);
}
if (typeof document !== 'undefined' && document.addEventListener) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', v3cButton); else setTimeout(v3cButton, 0); }
