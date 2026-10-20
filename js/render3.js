'use strict';
// 渲染（三）：弹道、曳光、飞机、爆炸、工具预览、文字标注

function drawShells(time) {
  const ctx = R.ctx;
  for (const s of S.shells) {
    if (s.t < 0) continue;
    const u = s.t / s.dur, sx = s.fuzzy ? s.fx0 : s.x0, sy = s.fuzzy ? s.fy0 : s.y0;
    const h = s.kind === 'bomb' ? 0 : Math.min(90, dist(sx, sy, s.x1, s.y1) * .22);
    const P = v => [lerp(sx, s.x1, v), lerp(sy, s.y1, v) - Math.sin(Math.PI * v) * h];
    const col = s.side === 'p' ? (s.kind === 'bomb' ? COL.amber : COL.g) : COL.enemy;
    if (s.fuzzy) {
      // 模糊弹道：来源被故意打散，只给大致方向
      const jx = gauss() * 3, jy = gauss() * 3;
      ctx.setLineDash([px(4), px(7)]);
      for (const [w, a] of [[6, .1], [1.3, .4]]) {
        ctx.lineWidth = px(w); ctx.strokeStyle = rgba(COL.enemy, a);
        ctx.beginPath();
        for (let v = 0; v <= u; v += .04) { const [x, y] = P(v); ctx.lineTo(x + jx * v, y + jy * v); }
        ctx.stroke();
      }
      ctx.setLineDash([]);
      const gr = ctx.createRadialGradient(sx, sy, 0, sx, sy, 30);
      gr.addColorStop(0, rgba(COL.enemy, .22)); gr.addColorStop(1, rgba(COL.enemy, 0));
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(sx, sy, 30, 0, 7); ctx.fill();
    } else {
      ctx.lineWidth = px(2); ctx.strokeStyle = rgba(col, .8);
      ctx.beginPath();
      for (let v = Math.max(0, u - .18); v <= u; v += .02) ctx.lineTo(...P(v));
      ctx.stroke();
    }
    const [hx, hy] = P(u);
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(hx, hy, s.fuzzy ? 3 : 2.2, 0, 7); ctx.fill();
    if (s.side === 'p' || inVision(s.x1, s.y1)) {
      ctx.strokeStyle = rgba(col, .25 + u * .4); ctx.lineWidth = px(1); ctx.setLineDash([px(2), px(3)]);
      ctx.beginPath(); ctx.arc(s.x1, s.y1, s.kind === 'cb' ? 22 : POWER[s.kind].R, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    }
  }
}

function drawTracers() {
  const ctx = R.ctx;
  for (const t of S.tracers) {
    const a = 1 - t.life / t.max;
    if (t.fuzzy) {
      const gr = ctx.createLinearGradient(t.x0, t.y0, t.x1, t.y1);
      gr.addColorStop(0, rgba(COL.enemy, 0)); gr.addColorStop(1, rgba(COL.enemy, .45 * a));
      ctx.strokeStyle = gr; ctx.lineWidth = px(3);
    } else {
      const u = t.life / t.max, u0 = Math.max(0, u - .4);
      ctx.strokeStyle = rgba(t.side === 'p' ? COL.g : COL.enemy, .9 * a); ctx.lineWidth = px(1.2);
      ctx.beginPath(); ctx.moveTo(lerp(t.x0, t.x1, u0), lerp(t.y0, t.y1, u0)); ctx.lineTo(lerp(t.x0, t.x1, u), lerp(t.y0, t.y1, u)); ctx.stroke();
      continue;
    }
    ctx.beginPath(); ctx.moveTo(t.x0, t.y0); ctx.lineTo(t.x1, t.y1); ctx.stroke();
  }
}

function drawPlanes(time) {
  const ctx = R.ctx;
  for (const p of S.planes) {
    const k = p.kind === 'strike' ? 1.2 : .9;
    ctx.strokeStyle = COL.intel; ctx.fillStyle = rgba(COL.intel, .2); ctx.lineWidth = px(1.6);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - 9 * k); ctx.lineTo(p.x - 8 * k, p.y + 6 * k); ctx.lineTo(p.x, p.y + 2 * k); ctx.lineTo(p.x + 8 * k, p.y + 6 * k);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    if (p.kind === 'recon') {
      ctx.strokeStyle = rgba(COL.intel, .3); ctx.lineWidth = px(1); ctx.setLineDash([px(2), px(5)]);
      ctx.beginPath(); ctx.arc(p.x, p.y, 70, time * 2, time * 2 + 4.5); ctx.stroke(); ctx.setLineDash([]);
    }
  }
  ctx.fillStyle = rgba(COL.intel, .18);
  for (const r of S.recon) ctx.fillRect(r.x - 1, r.y - 1, 2, 2);
}

function drawFx() {
  const ctx = R.ctx;
  for (const f of S.fx) {
    const u = f.life / f.max;
    if (f.kind === 'flash') {
      ctx.fillStyle = rgba(f.side === 'e' ? COL.enemy : COL.g, 1 - u);
      ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (1 - u * .5), 0, 7); ctx.fill();
      continue;
    }
    ctx.strokeStyle = rgba(COL.amber, 1 - u); ctx.lineWidth = px(2);
    ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (.25 + .75 * Math.sqrt(u)), 0, 7); ctx.stroke();
    if (u < .3) { ctx.fillStyle = rgba('#fff3d6', (.3 - u) * 2.4); ctx.beginPath(); ctx.arc(f.x, f.y, f.r * .45, 0, 7); ctx.fill(); }
    ctx.fillStyle = rgba(COL.amber, 1 - u);
    for (let k = 0; k < 7; k++) {
      const a = k * 2.4 + f.x, d = f.r * 1.1 * u;
      ctx.fillRect(f.x + Math.cos(a) * d - 1.5, f.y + Math.sin(a) * d - 1.5, 3, 3);
    }
  }
}

function drawTool(time) {
  const ctx = R.ctx, m = U.mouse, D = S.destroyer;
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
  if (U.tool === 'assault' || U.tool === 'supply') {
    const ok = m.y >= STAGING_Y && !isLand(m.x, m.y);
    ctx.fillStyle = rgba(COL.g, .05); ctx.fillRect(0, STAGING_Y, W, H - STAGING_Y);
    ctx.strokeStyle = rgba(ok ? COL.g : COL.enemy, .7); ctx.setLineDash([px(3), px(3)]);
    shape(ctx, m.x, m.y, 10, 3, -Math.PI / 2); ctx.stroke(); ctx.setLineDash([]);
  } else if (U.tool === 'strike') {
    ctx.strokeStyle = rgba(COL.amber, .7); ctx.setLineDash([px(3), px(4)]);
    for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(m.x, m.y + 34 - i * 34, POWER.bomb.R, 0, 7); ctx.stroke(); }
    ctx.strokeStyle = rgba(COL.intel, .35); ctx.beginPath(); ctx.moveTo(m.x, H); ctx.lineTo(m.x, m.y + 70); ctx.stroke(); ctx.setLineDash([]);
  } else if (U.tool === 'recon') {
    ctx.fillStyle = rgba(COL.intel, .05); ctx.fillRect(m.x - 75, 0, 150, H);
    ctx.strokeStyle = rgba(COL.intel, .55); ctx.setLineDash([px(3), px(5)]);
    ctx.beginPath(); ctx.moveTo(m.x, 0); ctx.lineTo(m.x, H); ctx.stroke(); ctx.setLineDash([]);
  } else if (U.tool === 'aim') {
    const ok = D.state === 'ready';
    ctx.strokeStyle = rgba(ok ? COL.g : COL.enemy, .7); ctx.setLineDash([px(6), px(4)]);
    ctx.beginPath(); ctx.moveTo(D.x, D.y); ctx.lineTo(m.x, m.y); ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(m.x, m.y, POWER.naval.R, 0, 7); ctx.stroke();
  } else if (U.tool === 'rline') {
    ctx.strokeStyle = rgba(COL.intel, .5); ctx.setLineDash([px(2), px(6)]);
    ctx.beginPath(); ctx.moveTo(m.x, H - 6); ctx.lineTo(m.x, m.y); ctx.stroke(); ctx.setLineDash([]);
  }
  if (U.tool !== 'assault' && U.tool !== 'supply') {
    ctx.strokeStyle = U.tool === 'move' ? COL.sel : rgba(COL.text, .8);
    ctx.beginPath(); ctx.moveTo(m.x - 8, m.y); ctx.lineTo(m.x - 3, m.y); ctx.moveTo(m.x + 3, m.y); ctx.lineTo(m.x + 8, m.y);
    ctx.moveTo(m.x, m.y - 8); ctx.lineTo(m.x, m.y - 3); ctx.moveTo(m.x, m.y + 3); ctx.lineTo(m.x, m.y + 8); ctx.stroke();
  }
}

function label(ctx, txt, x, y, col, size = 10, align = 'left') {
  ctx.font = font(size); ctx.textAlign = align; ctx.fillStyle = col; ctx.fillText(txt, x, y);
}

function drawLabels(time) {
  const ctx = R.ctx, D = S.destroyer;
  ctx.textBaseline = 'middle';
  for (const o of S.objectives) {
    const col = o.owner === 'p' ? COL.g : COL.enemy;
    label(ctx, o.key, o.x, o.y + px(1), col, 13, 'center');
    label(ctx, o.name + (o.owner === 'p' ? ' · 已占领' : ''), o.x, o.y + 30, rgba(col, .85), 10, 'center');
  }
  const grp = id => Object.keys(S.groups).find(k => S.groups[k].includes(id));
  for (const s of S.ships) {
    if (s.state === 'sunk') continue;
    const g = grp(s.id), a = s.state === 'beached' ? .45 : .8;
    label(ctx, s.label + (s.load.squads ? ` ×${s.load.squads * 3 + s.load.eng}` : ''), s.x + 13, s.y - 9, rgba(COL.g, a), 9);
    if (g) label(ctx, 'G' + g, s.x - 13, s.y - 9, COL.sel, 9, 'right');
  }
  const st = D.state === 'sunk' ? '已沉没' : D.state === 'repair' ? `损管 ${Math.round(D.repairT / D.repairDur * 100)}%` : D.cool > 0 ? `装填 ${Math.ceil(D.cool)}s` : '就绪';
  label(ctx, 'DD-17 驱逐舰', D.x - 22, D.y - 8, rgba(D.state === 'repair' ? COL.amber : COL.g, .85), 9, 'right');
  label(ctx, st + (S.t < D.exposedUntil ? ' · 坐标暴露' : ''), D.x - 22, D.y + 5, rgba(S.t < D.exposedUntil ? COL.enemy : COL.text, .8), 9, 'right');
  for (const L of S.supply) label(ctx, L.connected ? '补给站' : '补给站 · 断线', L.x + 9, L.y + 8, rgba(L.connected ? COL.g : COL.enemy, .8), 9);
  for (const s of S.shells) if (s.fuzzy && s.t >= 0) label(ctx, '?', s.fx0, s.fy0, rgba(COL.enemy, .8), 12, 'center');
  const m = U.mouse;
  if (m && U.tool === 'aim') label(ctx, `方位 ${fmtBrg(bearing(D.x, D.y, m.x, m.y))} · ${gridRef(m.x, m.y)}`, m.x + 12, m.y - 12, COL.text, 10);
  if (m && U.hoverText) {
    ctx.font = font(10);
    const w = ctx.measureText(U.hoverText).width + px(12), x = Math.min(m.x + 14, W - w - 4), y = m.y + 16;
    ctx.fillStyle = 'rgba(2,10,6,0.85)'; ctx.fillRect(x, y, w, px(18));
    ctx.strokeStyle = rgba(COL.g, .4); ctx.lineWidth = px(1); ctx.strokeRect(x, y, w, px(18));
    label(ctx, U.hoverText, x + px(6), y + px(9.5), COL.text, 10);
  }
}
