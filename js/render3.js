'use strict';
// 渲染（三）：弹道、曳光、爆炸、工具预览、文字标注（飞机在 carrier.js）

// 炮弹：弹头按屏幕像素画小点；落点圈只在瞄准工具激活时（我方）或即将落地时（敌方来袭，淡、去重）显示
function drawShells(time) {
  const ctx = R.ctx, tool = typeof U === 'object' ? U.tool : null, aim = tool === 'fire' || tool === 'smoke' || tool === 'strike' || tool === 'cas', rings = new Set();
  for (const s of S.shells) {
    if (s.t < 0) continue;
    const u = s.t / s.dur, sx = s.fuzzy ? s.fx0 : s.x0, sy = s.fuzzy ? s.fy0 : s.y0;
    const h = s.kind === 'bomb' ? 0 : Math.min(90, dist(sx, sy, s.x1, s.y1) * .22);
    const P = v => [lerp(sx, s.x1, v), lerp(sy, s.y1, v) - Math.sin(Math.PI * v) * h];
    const col = s.side === 'p' ? (s.kind === 'bomb' ? COL.amber : s.kind === 'smoke' ? COL.smoke : COL.g) : COL.enemy;
    const [hx, hy] = P(u);
    if (!inView(hx, hy, 120) && !inView(s.x1, s.y1, 60)) continue;
    if (s.fuzzy) {
      // 模糊弹道：来源被故意打散，只给大致方向（淡）
      const jx = gauss() * 3, jy = gauss() * 3;
      ctx.setLineDash([px(4), px(7)]);
      for (const [w, a] of [[3.5, .06], [1, .3]]) {
        ctx.lineWidth = px(w); ctx.strokeStyle = rgba(COL.enemy, a);
        ctx.beginPath();
        for (let v = 0; v <= u; v += .04) { const [x, y] = P(v); ctx.lineTo(x + jx * v, y + jy * v); }
        ctx.stroke();
      }
      ctx.setLineDash([]);
      const gr = ctx.createRadialGradient(sx, sy, 0, sx, sy, 22);
      gr.addColorStop(0, rgba(COL.enemy, .12)); gr.addColorStop(1, rgba(COL.enemy, 0));
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(sx, sy, 22, 0, 7); ctx.fill();
    } else {
      ctx.lineWidth = px(1.4); ctx.strokeStyle = rgba(col, .7);
      ctx.beginPath();
      for (let v = Math.max(0, u - .18); v <= u; v += .02) ctx.lineTo(...P(v));
      ctx.stroke();
      if (s.side === 'p' && !R.fig) {   // 远看：尾随的小字符（数码雨风格）
        ctx.font = font(7); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        for (let i = 1; i <= 4; i++) {
          const v = u - i * .05;
          if (v < 0) break;
          const [tx, ty] = P(v);
          ctx.fillStyle = rgba(col, .6 * (1 - i / 5));
          ctx.fillText(GLYPHS[(i * 13 + Math.floor(s.t * 12)) % GLYPHS.length], tx, ty);
        }
      }
    }
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(hx, hy, Math.max(px(1.6), Math.min(s.fuzzy ? 3 : 2.2, px(2.2))), 0, 7); ctx.fill();
    const R0 = s.kind === 'cb' ? 22 : s.kind === 'smoke' ? 40 : (POWER[s.kind] || POWER.arty).R, key = Math.round(s.x1 / 25) + ',' + Math.round(s.y1 / 25);
    if (s.side === 'p') {
      if (aim && !rings.has(key)) {
        rings.add(key);
        ctx.strokeStyle = rgba(col, .2 + u * .3); ctx.lineWidth = px(1); ctx.setLineDash([px(2), px(4)]);
        ctx.beginPath(); ctx.arc(s.x1, s.y1, R0, 0, 7); ctx.stroke(); ctx.setLineDash([]);
      } else if (!aim) {   // 落点：小十字
        const c = Math.max(px(3), 1.5);
        ctx.strokeStyle = rgba(col, .25 + u * .3); ctx.lineWidth = px(1);
        ctx.beginPath(); ctx.moveTo(s.x1 - c, s.y1); ctx.lineTo(s.x1 + c, s.y1); ctx.moveTo(s.x1, s.y1 - c); ctx.lineTo(s.x1, s.y1 + c); ctx.stroke();
      }
    } else if (u > .55 && inVision(s.x1, s.y1) && !rings.has(key)) {   // 敌炮来袭：落地前淡淡的预警圈
      rings.add(key);
      ctx.strokeStyle = rgba(COL.enemy, .08 + (u - .55) * .45); ctx.lineWidth = px(1); ctx.setLineDash([px(2), px(4)]);
      ctx.beginPath(); ctx.arc(s.x1, s.y1, R0, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    }
  }
}

function drawTracers() {
  const ctx = R.ctx;
  for (const t of S.tracers) {
    if (!inView(t.x0, t.y0, 20) && !inView(t.x1, t.y1, 20)) continue;
    const a = 1 - t.life / t.max;
    if (t.fuzzy) {   // 敌方模糊曳光：只示意方向
      const gr = ctx.createLinearGradient(t.x0, t.y0, t.x1, t.y1);
      gr.addColorStop(0, rgba(COL.enemy, 0)); gr.addColorStop(1, rgba(COL.enemy, .3 * a));
      ctx.strokeStyle = gr; ctx.lineWidth = px(2);
      ctx.beginPath(); ctx.moveTo(t.x0, t.y0); ctx.lineTo(t.x1, t.y1); ctx.stroke();
      continue;
    }
    const u = t.life / t.max, u0 = Math.max(0, u - .4);
    ctx.strokeStyle = rgba(t.side === 'p' ? COL.g : COL.enemy, .85 * a); ctx.lineWidth = px(1);
    ctx.beginPath(); ctx.moveTo(lerp(t.x0, t.x1, u0), lerp(t.y0, t.y1, u0)); ctx.lineTo(lerp(t.x0, t.x1, u), lerp(t.y0, t.y1, u)); ctx.stroke();
  }
}

// drawPlanes（飞机剪影、尾迹、盘旋圈）见 carrier.js

// 爆炸：细琥珀冲击环 + 短暂白芯；远看少量小字符飞溅，近看改为细小碎片（不再满屏字符）
function drawFx() {
  const ctx = R.ctx;
  for (const f of S.fx) {
    if (!inView(f.x, f.y, f.r * 2 + 10)) continue;
    const u = f.life / f.max;
    if (f.kind === 'flash') {
      ctx.fillStyle = rgba(f.side === 'e' ? COL.enemy : COL.g, (1 - u) * .9);
      ctx.beginPath(); ctx.arc(f.x, f.y, Math.min(f.r, Math.max(1.5, px(6))) * (1 - u * .5), 0, 7); ctx.fill();
      continue;
    }
    ctx.strokeStyle = rgba(COL.amber, (1 - u) * .75); ctx.lineWidth = px(1.2);
    ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (.25 + .75 * Math.sqrt(u)), 0, 7); ctx.stroke();
    if (u < .3) { ctx.fillStyle = rgba('#fff3d6', (.3 - u) * 1.6); ctx.beginPath(); ctx.arc(f.x, f.y, f.r * .4, 0, 7); ctx.fill(); }
    if (u > .7) continue;
    if (!R.fig) {
      if (f.r < 12) continue;
      ctx.font = font(7); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = rgba(COL.g, (1 - u / .7) * .6);
      for (let k = 0; k < 5; k++) {
        const a = k * 1.26 + f.y * .13, d = f.r * (.35 + 1.1 * u);
        ctx.fillText(GLYPHS[(k * 7 + Math.floor(f.x + f.life * 18)) % GLYPHS.length], f.x + Math.cos(a) * d, f.y + Math.sin(a) * d + u * 8);
      }
    } else {
      ctx.fillStyle = rgba(STRUCT, (1 - u / .7) * .6);
      for (let k = 0; k < 8; k++) {
        const a = k * .79 + f.y * .13, d = f.r * (.3 + 1.1 * u) * (.7 + ((k * 37) % 10) / 20), z = .5 + (k % 3) * .25;
        ctx.fillRect(f.x + Math.cos(a) * d - z / 2, f.y + Math.sin(a) * d - z / 2 + u * 4, z, z);
      }
    }
  }
}

function drawTool(time) {
  const ctx = R.ctx, m = U.mouse, D = S.dd;
  if (U.box) {
    const b = U.box;
    ctx.strokeStyle = COL.sel; ctx.fillStyle = rgba(COL.sel, .07); ctx.lineWidth = px(1); ctx.setLineDash([px(4), px(3)]);
    ctx.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0); ctx.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0); ctx.setLineDash([]);
  }
  if (U.tool === 'rline') for (const s of S.ships) if (s.state === 'beached' && !S.rlines.some(l => l.ship === s.id)) {
    ctx.strokeStyle = rgba(COL.intel, .5 + .5 * Math.sin(time * 6)); ctx.lineWidth = px(1.5);
    ctx.beginPath(); ctx.arc(s.x, s.y, 17, 0, 7); ctx.stroke();
  }
  if (!m || !U.tool) return;
  ctx.lineWidth = px(1.2);
  if ((U.tool === 'strike' || U.tool === 'recon' || U.tool === 'cas') && typeof drawAirTool === 'function') drawAirTool(time);
  else if (U.tool === 'fire' || U.tool === 'smoke') {
    const ok = D.state === 'ready' && dist(D.x, D.y, m.x, m.y) <= 1000;
    ctx.strokeStyle = rgba(ok ? (U.tool === 'smoke' ? COL.smoke : COL.g) : COL.enemy, .7); ctx.setLineDash([px(6), px(4)]);
    ctx.beginPath(); ctx.moveTo(D.x, D.y); ctx.lineTo(m.x, m.y); ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(m.x, m.y, U.tool === 'smoke' ? 65 : POWER.naval.R, 0, 7); ctx.stroke();
  } else if (U.tool === 'rline') {
    ctx.strokeStyle = rgba(COL.intel, .5); ctx.setLineDash([px(2), px(6)]);
    ctx.beginPath(); ctx.moveTo(m.x, H - 6); ctx.lineTo(m.x, m.y); ctx.stroke(); ctx.setLineDash([]);
  } else if (U.tool === 'move' || U.tool === 'amove' || U.tool === 'charge' || U.tool === 'clear') {
    const units = selUnits();
    if (units.length && !(U.fdrag && U.fdrag.on)) {
      const cx0 = units.reduce((a, u) => a + u.x, 0) / units.length, cy0 = units.reduce((a, u) => a + u.y, 0) / units.length, f = Math.atan2(m.y - cy0, m.x - cx0);
      ctx.fillStyle = rgba(U.tool === 'move' ? COL.sel : COL.enemy, .6);
      for (const L of layoutUnits(units, m.x, m.y, f, null)) for (const [x, y] of L.slots) { shape(ctx, x, y, 3, 3, f); ctx.fill(); }
    }
  }
  const col = U.tool === 'amove' || U.tool === 'charge' ? COL.enemy : U.tool === 'move' ? COL.sel : COL.text;
  ctx.strokeStyle = col;
  ctx.beginPath(); ctx.moveTo(m.x - 8, m.y); ctx.lineTo(m.x - 3, m.y); ctx.moveTo(m.x + 3, m.y); ctx.lineTo(m.x + 8, m.y);
  ctx.moveTo(m.x, m.y - 8); ctx.lineTo(m.x, m.y - 3); ctx.moveTo(m.x, m.y + 3); ctx.lineTo(m.x, m.y + 8); ctx.stroke();
}
