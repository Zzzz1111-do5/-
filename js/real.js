'use strict';
// 写实画面的单位外观（SETTINGS.look === 'real'）：真实涂装代替发光描边——解放军橄榄绿、美军沙色；深色边线、西北光源明暗、东南向投影
// 各绘制函数在写实画面下改调这里的版本；阵营只用一道细的蓝 / 红边线或脚下淡圈标识，远看仍是图标
const RLP = {
  p: { hull: '#5d6c3e', tur: '#67774a', dark: '#3d4828', uni: '#56653f', helm: '#4c5a35', pack: '#3f4a2c' },
  e: { hull: '#8a7e5a', tur: '#968a65', dark: '#665d43', uni: '#867c5b', helm: '#7a7051', pack: '#625a42' }
};
const RL_EDGE = '#24251f';   // 边线、炮管、履带等深色金属
// 黑绿画面（look.js）：敌方换成同样明暗的暗红涂装，过着色器时保留红色、一眼分清敌我
const RLP_G = { e: Object.fromEntries(Object.entries(RLP.e).map(([k, v]) => [k, v])) };
const rlPal = side => side === 'e' ? (typeof greenLook === 'function' && greenLook() ? rlPalG() : RLP.e) : RLP.p;
function rlPalG() { if (!RLP_G.ok) { for (const k in RLP.e) RLP_G.e[k] = lkPaint(RLP.e[k], 'e'); RLP_G.ok = true; } return RLP_G.e; }
const _rlc = {};
// 颜色按系数提亮 / 压暗（缓存）
function rlShade(hex, k) {
  const key = hex + k, c = _rlc[key];
  if (c) return c;
  const v = [1, 3, 5].map(i => clamp(Math.round(parseInt(hex.slice(i, i + 2), 16) * k), 0, 255));
  return (_rlc[key] = `rgb(${v[0]},${v[1]},${v[2]})`);
}
// 世界坐标里的偏移（东南向，用于投影）换到朝向 h 的局部坐标
const rlLocal = (h, wx, wy) => [wx * Math.cos(h) + wy * Math.sin(h), -wx * Math.sin(h) + wy * Math.cos(h)];
// 西北来光的线性渐变（局部坐标，物体长 L、宽 B）：受光面亮、背光面暗
function rlLit(ctx, h, L, B, base) {
  const [lx, ly] = rlLocal(h, -.707, -.707), g = ctx.createLinearGradient(lx * L / 2, ly * B / 2, -lx * L / 2, -ly * B / 2);
  g.addColorStop(0, rlShade(base, 1.18)); g.addColorStop(1, rlShade(base, .78));
  return g;
}

// 车辆：投影 → 行走机构 → 车体（涂装、迷彩斑、边线、阵营细边）→ 甲板细节
function vehBodyReal(ctx, v, col, a, det, lw, time, vis, enemy) {
  const sp = vehSp(v), L = sp.len, B = sp.wid, hl = L / 2, hb = B / 2, t = v.type, P = rlPal(v.side), h = v.heading;
  if (!vis) { ctx.lineWidth = lw(1.1); ctx.strokeStyle = rgba(col, a); vehHullPath(ctx, v); ctx.stroke(); return; }   // 失去接触：只留虚线轮廓
  const [sx, sy] = rlLocal(h, 1.1, 1.1);
  ctx.save(); ctx.translate(sx, sy); ctx.fillStyle = 'rgba(0,0,0,.3)';
  ctx.beginPath(); ctx.rect(-hl, -hb, L, B); ctx.fill(); ctx.restore();
  ctx.fillStyle = '#272722'; ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = lw(.5);
  if (sp.wheel) {
    for (const wx of [-hl * .58, hl * .5]) for (const s of [-1, 1]) { ctx.beginPath(); ctx.rect(wx - L * .1, s * hb * .82 - B * .14, L * .2, B * .28); ctx.fill(); ctx.stroke(); }
  } else {
    const tw = B * (t === 'amtank' ? .2 : .26);
    for (const s of [-1, 1]) {
      const y0 = s < 0 ? -hb : hb - tw;
      ctx.beginPath(); ctx.rect(-hl, y0, L, tw); ctx.fill(); ctx.stroke();
      if (det) {   // 履带板：随里程滚动
        ctx.beginPath();
        const g = 1.5, off = ((v.odo || 0) % g + g) % g;
        for (let x = -hl + off; x < hl; x += g) { ctx.moveTo(x, y0 + .2); ctx.lineTo(x, y0 + tw - .2); }
        ctx.strokeStyle = 'rgba(120,116,104,.35)'; ctx.lineWidth = lw(.5); ctx.stroke();
        ctx.strokeStyle = 'rgba(0,0,0,.5)';
      }
    }
  }
  vehHullPath(ctx, v);
  ctx.fillStyle = det ? rlLit(ctx, h, L, B, P.hull) : P.hull; ctx.fill();
  if (det) {   // 迷彩斑（每辆车固定）
    ctx.save(); ctx.clip();
    ctx.fillStyle = P.dark;
    for (let i = 0; i < 4; i++) {
      const u = Math.sin(v.id * 12.9 + i * 7.1), w = Math.cos(v.id * 4.3 + i * 3.7);
      ctx.beginPath(); ctx.ellipse(u * hl * .8, w * hb * .7, L * .13, B * .16, i, 0, 7); ctx.fill();
    }
    ctx.restore();
    vehHullPath(ctx, v);
  }
  ctx.lineWidth = lw(.6); ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.stroke();
  ctx.lineWidth = lw(det ? .9 : 1.3); ctx.strokeStyle = rgba(col, (det ? .75 : .95) * a); ctx.stroke();   // 阵营细边
  if (det) vehDeck(ctx, v, '#141510', a, lw, time);
}

// 残骸：烧黑的车体、锈色斑、歪斜的炮塔
function vehWreckReal(ctx, v, sp, k) {
  const L = sp.len, B = sp.wid, M = typeof rlModelOf === 'function' ? rlModelOf(v) : null;
  ctx.save(); ctx.translate(v.x, v.y); ctx.rotate(v.kh ?? v.heading); ctx.scale(k, k);
  if (M && typeof sprGet === 'function') {   // 按实车贴图的烧毁车体：整体熏黑、锈斑，炮塔歪斜
    const sm = L / M.L, burn = draw => P => {
      draw(P); const g = P.g;
      g.save(); g.globalCompositeOperation = 'source-atop';
      g.fillStyle = 'rgba(24,21,17,.82)'; g.fillRect(-20, -20, 40, 40);
      const r = rng(M.L * 97 | 0);
      for (let i = 0; i < 7; i++) { g.fillStyle = `rgba(${110 + r() * 30 | 0},${55 + r() * 20 | 0},30,${.25 + r() * .25})`; g.beginPath(); g.ellipse((r() - .5) * M.L * .8, (r() - .5) * M.B * .8, .3 + r() * .7, .2 + r() * .5, r() * 3, 0, 7); g.fill(); }
      g.restore();
    };
    const HS = sprGet('wreck:' + M.key, 'n', M.L + 1, M.B + .6, burn(M.H)), TS = M.T ? sprGet('wreckT:' + M.key, 'n', 6.5, 4.2, burn(M.T)) : null;
    ctx.save(); ctx.scale(sm, sm);
    sprShadow(ctx, HS, 0, 0, 1, 0, v.kh ?? v.heading, .5 / sm, .5);
    sprDraw(ctx, HS, 0, 0, 1);
    if (TS) {
      ctx.translate(M.tur.x + .4, (M.tur.y || 0) + .5); ctx.rotate(.7);
      if (M.gun) { const gn = M.gun; ctx.strokeStyle = '#1b1915'; ctx.lineWidth = Math.max(gn.r || .1, .09) * 2; ctx.lineCap = 'butt'; ctx.beginPath(); ctx.moveTo(gn.x0, gn.oy || 0); ctx.lineTo(gn.x0 + gn.len * .85, gn.oy || 0); ctx.stroke(); }
      sprDraw(ctx, TS, 0, 0, 1);
    }
    ctx.restore(); ctx.restore();
    return;
  }
  vehHullPath(ctx, v); ctx.fillStyle = '#25221d'; ctx.fill();
  ctx.fillStyle = 'rgba(110,62,34,.55)'; ctx.beginPath(); ctx.ellipse(-L * .15, B * .1, L * .2, B * .22, .4, 0, 7); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = px(.8) / k; vehHullPath(ctx, v); ctx.stroke();
  if (sp.tur) {
    ctx.fillStyle = '#1c1a16'; ctx.beginPath(); ctx.arc(L * .1, B * .22, sp.tur * .9, 0, 7); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#1c1a16'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(L * .1, B * .22); ctx.lineTo(L * .1 + Math.cos(.7) * sp.bar, B * .22 + Math.sin(.7) * sp.bar); ctx.stroke();
  }
  ctx.restore();
}

// 俯视单兵（局部坐标，+x 朝前）：投影、脚下阵营淡圈、背包、军装肩背、钢盔、武器
function drawManReal(ctx, x0, y0, a, role, col, side, prone) {
  const P = rlPal(side), k = 1.12, lw = px(1) / k;
  ctx.save(); ctx.translate(x0, y0); ctx.rotate(a); ctx.scale(k, k);
  ctx.strokeStyle = col; ctx.lineWidth = lw * .9;
  if (prone) {   // 卧倒：贴地趴平（影子很淡）、两腿分开、背包在背上、枪朝前
    ctx.beginPath(); ctx.ellipse(-1.2, 0, 3.4, 2.1, 0, 0, 7); ctx.stroke();
    const [sx, sy] = rlLocal(a, .25, .25);
    ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.beginPath(); ctx.ellipse(-1.1 + sx, sy, 2, .95, 0, 0, 7); ctx.fill();
    ctx.strokeStyle = P.uni; ctx.lineWidth = lw * 1.9; ctx.beginPath(); ctx.moveTo(-2.4, -.35); ctx.lineTo(-4.5, -1.05); ctx.moveTo(-2.4, .35); ctx.lineTo(-4.5, 1.05); ctx.stroke();
    ctx.fillStyle = P.uni; ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = lw * .5; ctx.beginPath(); ctx.ellipse(-1.1, 0, 1.75, .8, 0, 0, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = P.pack; ctx.fillRect(-1.9, -.5, 1.1, 1);
    ctx.strokeStyle = RL_EDGE; ctx.lineWidth = lw * (role === 'mg' ? 1.6 : 1.05); ctx.beginPath(); ctx.moveTo(.5, .3); ctx.lineTo(3.8, .3); ctx.stroke();
    ctx.fillStyle = P.helm; ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = lw * .6; ctx.beginPath(); ctx.arc(.75, 0, .78, 0, 7); ctx.fill(); ctx.stroke();
    ctx.restore(); return;
  }
  ctx.beginPath(); ctx.ellipse(0, 0, 2.5, 2.3, 0, 0, 7); ctx.stroke();   // 阵营淡圈（col 已含透明度 / 溃退时的琥珀色）
  const [sx, sy] = rlLocal(a, .55, .55);
  ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(-.1 + sx, sy, .95, 1.8, 0, 0, 7); ctx.fill();
  ctx.fillStyle = P.pack; ctx.fillRect(-1.75, -.75, .95, 1.5);   // 背包
  if (role === 'radio') { ctx.strokeStyle = RL_EDGE; ctx.lineWidth = lw * .7; ctx.beginPath(); ctx.moveTo(-1.5, -.6); ctx.lineTo(-3.3, -2); ctx.stroke(); }
  else if (role === 'eng') { ctx.strokeStyle = '#5a4a34'; ctx.lineWidth = lw * .9; ctx.beginPath(); ctx.moveTo(-.5, -1.2); ctx.lineTo(-2.9, -1.95); ctx.stroke(); ctx.fillStyle = '#6b6b66'; ctx.fillRect(-3.5, -2.45, 1, 1); }
  ctx.fillStyle = P.uni; ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = lw * .5;
  ctx.beginPath(); ctx.ellipse(-.1, 0, .9, 1.75, 0, 0, 7); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = RL_EDGE;
  if (role === 'mg') {
    ctx.lineWidth = lw * 1.6; ctx.beginPath(); ctx.moveTo(.2, .75); ctx.lineTo(3.9, .75); ctx.stroke();
    ctx.lineWidth = lw * .7; ctx.beginPath(); ctx.moveTo(3.1, .75); ctx.lineTo(3.7, -.1); ctx.moveTo(3.1, .75); ctx.lineTo(3.7, 1.6); ctx.stroke();
  } else { ctx.lineWidth = lw * 1.05; ctx.beginPath(); ctx.moveTo(.1, .85); ctx.lineTo(3.1, .6); ctx.stroke(); }
  if (role === 'aa') { ctx.strokeStyle = P.dark; ctx.lineWidth = lw * 2.6; ctx.beginPath(); ctx.moveTo(-2.4, -1.15); ctx.lineTo(2.2, -1.15); ctx.stroke(); }
  const [hx, hy] = rlLocal(a, -.25, -.25);
  ctx.fillStyle = P.helm; ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = lw * .6;
  ctx.beginPath(); ctx.arc(.2, 0, .82, 0, 7); ctx.fill(); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.beginPath(); ctx.arc(.2 + hx, hy, .38, 0, 7); ctx.fill();   // 钢盔受光面
  ctx.restore();
}

// 火炮阵地等线稿模型的写实配色：描边色 → 深色金属，暗底 → 涂装 / 混凝土
const RL_GUN = { col: 'rgba(30,30,26,.92)', dim: 'rgba(0,0,0,.38)', con: 'rgba(150,146,136,.95)', dark: '#857a57', sand: '#a8966e', concrete: '#8c887e' };
// 火炮阵地都是守方的：黑绿画面里涂装、混凝土换成暗红
const rlGun = () => typeof greenLook === 'function' && greenLook() ? (RL_GUN.g || (RL_GUN.g = { ...RL_GUN, con: 'rgba(170,70,60,.95)', dark: lkPaint(RL_GUN.dark, 'e'), sand: lkPaint(RL_GUN.sand, 'e'), concrete: lkPaint(RL_GUN.concrete, 'e') })) : RL_GUN;

// 飞机涂装：隐身战机深灰、大型机浅灰、A-10 深灰绿、直升机橄榄绿、无人机浅灰
function rlAirPaint(type) {
  if (type === 'j20' || type === 'j35' || type === 'j36' || type === 'j50' || type === 'f22' || type === 'f35' || type === 'gj11') return '#5f6870';
  if (type === 'a10') return '#5c6660';
  if (type === 'heli' || type === 'z10') return '#5d6650';
  if (type === 'ah64') return '#3f4433';
  if (type === 'uh60') return '#3f4536';
  if (type === 'c17') return '#7d858a';
  if (type === 'h6k' || type === 'kj600' || type === 'transport' || type === 'y20' || type === 'gj2' || type === 'wz7') return '#a4acb1';
  return '#8a949a';
}

// 工事（写实）：堑壕为翻土的深色壕沟、铁丝网为卷曲的铁丝圈、反坦克障碍为钢轨三角锥（拒马）；雷区仍用红色虚线标出（这是情报标记）
function drawFortsReal(ctx, time) {
  for (const t of S.trench) if (t.known) {
    ctx.beginPath(); for (const [x, y] of t.pts) ctx.lineTo(x, y);
    ctx.strokeStyle = 'rgba(120,98,66,.75)'; ctx.lineWidth = 4.2; ctx.stroke();   // 胸墙土
    ctx.strokeStyle = 'rgba(38,30,22,.9)'; ctx.lineWidth = 2; ctx.stroke();      // 壕底
  }
  ctx.lineWidth = px(.9);
  for (const w of S.wire) if (w.known) {
    const L = dist(w.x0, w.y0, w.x1, w.y1), n = Math.max(3, Math.round(L / 2.2)), ux = (w.x1 - w.x0) / L, uy = (w.y1 - w.y0) / L;
    ctx.strokeStyle = w.cut ? 'rgba(70,70,66,.35)' : 'rgba(58,58,54,.9)';
    ctx.beginPath();
    for (let s = 0; s <= n; s++) {
      if (w.cut && (s % 6) > 2) { ctx.stroke(); ctx.beginPath(); continue; }
      const u = s / n, o = Math.sin(s * 2.1) * 1.3, x = lerp(w.x0, w.x1, u) - uy * o, y = lerp(w.y0, w.y1, u) + ux * o;
      s ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
  }
  ctx.lineWidth = px(1);
  for (const m of S.mines) if (m.known && m.clr < 1 && inView(m.x, m.y, m.r)) {
    ctx.setLineDash([px(3), px(4)]); ctx.strokeStyle = rgba(COL.enemy, .45);
    ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    if (R.fig) {
      ctx.fillStyle = 'rgba(52,56,40,.85)';
      for (let i = 0; i < 9; i++) { const a = i * 2.4 + m.x, d = m.r * (.25 + .65 * ((i * 37 + (m.y | 0)) % 10) / 10); ctx.beginPath(); ctx.arc(m.x + Math.cos(a) * d, m.y + Math.sin(a) * d, .9, 0, 7); ctx.fill(); }
    }
    if (m.clr > 0) { ctx.strokeStyle = COL.amber; ctx.lineWidth = px(1.6); ctx.beginPath(); ctx.arc(m.x, m.y, m.r + px(3), -1.57, -1.57 + m.clr * 6.283); ctx.stroke(); ctx.lineWidth = px(1); }
  }
  for (const o of S.obst) if (o.known && !o.dead) {
    ctx.strokeStyle = 'rgba(0,0,0,.3)'; ctx.lineWidth = 1.1;
    ctx.beginPath(); ctx.moveTo(o.x - 2.4, o.y - 1.6); ctx.lineTo(o.x + 3.6, o.y + 4.4); ctx.moveTo(o.x + 3.6, o.y - 1.6); ctx.lineTo(o.x - 2.4, o.y + 4.4); ctx.stroke();   // 投影
    ctx.strokeStyle = '#3a3936'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(o.x - 3, o.y - 3); ctx.lineTo(o.x + 3, o.y + 3); ctx.moveTo(o.x + 3, o.y - 3); ctx.lineTo(o.x - 3, o.y + 3); ctx.moveTo(o.x, o.y - 3.4); ctx.lineTo(o.x, o.y + 3.4); ctx.stroke();
  }
}
