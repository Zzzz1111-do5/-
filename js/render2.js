'use strict';
// 渲染（二）：工事、烟幕、补给/增援线、据点、敌我单位
// 舰船为俯视剪影（见 ships.js），小方块 = 士兵，红色 = 敌方（仅视野内或已标定）
const MO = [[0, -4.6], [-4.6, 3.4], [4.6, 3.4]];   // 三人组成三角（放大绘制以便辨认）

function drawForts(time) {
  const ctx = R.ctx;
  ctx.lineWidth = px(1.2);
  for (const t of S.trench) if (t.known) {
    ctx.strokeStyle = rgba(COL.enemy, .4); ctx.lineWidth = px(2);
    ctx.beginPath(); for (const [x, y] of t.pts) ctx.lineTo(x, y); ctx.stroke();
  }
  ctx.lineWidth = px(1.1);
  for (const w of S.wire) if (w.known) {
    const n = Math.max(2, Math.round(dist(w.x0, w.y0, w.x1, w.y1) / 7));
    ctx.strokeStyle = rgba(COL.enemy, w.cut ? .18 : .7);
    ctx.beginPath();
    for (let s = 0; s <= n; s++) {
      const x = lerp(w.x0, w.x1, s / n), y = lerp(w.y0, w.y1, s / n);
      if (w.cut && s % 2) continue;
      ctx.moveTo(x - 2.5, y - 2.5); ctx.lineTo(x + 2.5, y + 2.5); ctx.moveTo(x + 2.5, y - 2.5); ctx.lineTo(x - 2.5, y + 2.5);
    }
    ctx.stroke();
  }
  for (const m of S.mines) if (m.known && m.clr < 1) {
    ctx.setLineDash([px(3), px(3)]); ctx.strokeStyle = rgba(COL.enemy, .75);
    ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = rgba(COL.enemy, .1); ctx.fill();
    if (m.clr > 0) { ctx.strokeStyle = COL.amber; ctx.lineWidth = px(2); ctx.beginPath(); ctx.arc(m.x, m.y, m.r + 3, -1.57, -1.57 + m.clr * 6.283); ctx.stroke(); ctx.lineWidth = px(1.1); }
  }
  ctx.strokeStyle = rgba(COL.enemy, .8);
  for (const o of S.obst) if (o.known && !o.dead) {
    ctx.beginPath(); ctx.moveTo(o.x - 3, o.y - 3); ctx.lineTo(o.x + 3, o.y + 3); ctx.moveTo(o.x + 3, o.y - 3); ctx.lineTo(o.x - 3, o.y + 3); ctx.stroke();
  }
}

function drawSmoke(time) {
  const ctx = R.ctx;
  for (const s of S.smoke) {
    const a = Math.min(1, (s.until - S.t) / 6), r = s.r * a;
    for (let k = 0; k < 7; k++) {
      const ang = k * .9 + time * .05, d = r * .45 * ((k * 37) % 10) / 10, x = s.x + Math.cos(ang) * d, y = s.y + Math.sin(ang) * d - k;
      const gr = ctx.createRadialGradient(x, y, 0, x, y, r * .7);
      gr.addColorStop(0, rgba(COL.smoke, .22 * a)); gr.addColorStop(1, rgba(COL.smoke, 0));
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, y, r * .7, 0, 7); ctx.fill();
    }
  }
}

function drawLines(time) {
  const ctx = R.ctx;
  for (const L of S.supply) {
    ctx.lineWidth = px(1.6);
    for (const g of L.segs) {
      ctx.setLineDash(g.ok ? [px(7), px(4)] : [px(2), px(5)]);
      ctx.strokeStyle = g.ok ? rgba(COL.g, .5) : rgba(COL.enemy, .35 + .3 * Math.sin(time * 9));
      ctx.beginPath(); ctx.moveTo(g.x0, g.y0); ctx.lineTo(g.x1, g.y1); ctx.stroke();
      if (!g.ok && g.rep > 0) {
        ctx.setLineDash([]); ctx.strokeStyle = COL.amber;
        ctx.beginPath(); ctx.arc((g.x0 + g.x1) / 2, (g.y0 + g.y1) / 2, 7, -1.57, -1.57 + g.rep * 6.283); ctx.stroke();
      }
    }
    ctx.setLineDash([]);
    const a = L.segs[0], z = L.segs[L.segs.length - 1];
    if (L.connected) for (let k = 0; k < 4; k++) {
      const u = (time * .2 + k / 4) % 1;
      ctx.fillStyle = rgba(COL.g, .9); ctx.fillRect(lerp(z.x1, a.x0, u) - px(1.5), lerp(z.y1, a.y0, u) - px(1.5), px(3), px(3));
    }
    ctx.strokeStyle = rgba(COL.g, L.connected ? .9 : .4); ctx.lineWidth = px(1.4);
    ctx.strokeRect(L.x - 5, L.y - 5, 10, 10);
    ctx.beginPath(); ctx.moveTo(L.x - 3, L.y); ctx.lineTo(L.x + 3, L.y); ctx.moveTo(L.x, L.y - 3); ctx.lineTo(L.x, L.y + 3); ctx.stroke();
    if (L.connected) { ctx.strokeStyle = rgba(COL.g, .07); ctx.beginPath(); ctx.arc(L.x, L.y, 200, 0, 7); ctx.stroke(); }
  }
  ctx.lineWidth = px(1.2); ctx.setLineDash([px(2), px(6)]); ctx.strokeStyle = rgba(COL.intel, .45);
  for (const L of S.rlines) { ctx.beginPath(); ctx.moveTo(L.x0, L.y0); ctx.lineTo(L.x1, L.y1); ctx.stroke(); }
  ctx.setLineDash([]);
  for (const b of S.boats) {   // 增援艇：航向取所属增援线方向
    const L = S.rlines.find(l => l.id === b.line);
    drawBoat(ctx, b.x, b.y, L ? Math.atan2(L.y1 - L.y0, L.x1 - L.x0) : -Math.PI / 2, { n: (b.n || 1) * 3 });
  }
}

function drawPoints(time) {
  const ctx = R.ctx;
  for (const p of S.points) {
    const col = p.owner === 'p' ? COL.g : COL.enemy;
    ctx.lineWidth = px(1.5); ctx.strokeStyle = rgba(col, .9); ctx.fillStyle = rgba(col, .08);
    shape(ctx, p.x, p.y, 13 + p.vp * 2, 6, Math.PI / 6); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = rgba(col, .2); ctx.setLineDash([px(2), px(4)]);
    ctx.beginPath(); ctx.arc(p.x, p.y, 45, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    if ((p.prog > 0 && p.prog < 1) || p.contested) {
      ctx.strokeStyle = p.contested ? rgba(COL.amber, .5 + .5 * Math.sin(time * 8)) : COL.g; ctx.lineWidth = px(2.5);
      ctx.beginPath(); ctx.arc(p.x, p.y, 24, -1.57, -1.57 + p.prog * 6.283); ctx.stroke();
    }
  }
}

function enemyMark(ctx, kind, x, y) {
  ctx.beginPath();
  if (kind === 'bunker') { ctx.rect(x - 6, y - 6, 12, 12); ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x - 4, y + 2); ctx.lineTo(x + 4, y + 2); }
  else if (kind === 'coastal') { ctx.rect(x - 8, y - 8, 16, 16); ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 20); }
  else if (kind === 'arty') { shape(ctx, x, y, 8, 4, 0); ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 13); }
  else if (kind === 'mortar') { ctx.arc(x, y, 5, 0, 7); ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 4, y - 8); }
  else { ctx.arc(x, y, 7, 0, 7); ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x - 4, y - 4); ctx.lineTo(x + 4, y + 4); ctx.moveTo(x + 4, y - 4); ctx.lineTo(x - 4, y + 4); }
  ctx.stroke();
}

function drawEnemies(time) {
  const ctx = R.ctx;
  ctx.lineWidth = px(1.5);
  for (const e of S.enemies) {
    const vis = inVision(e.x, e.y);
    if (!vis && e.kx == null) continue;
    const x = vis ? e.x : e.kx, y = vis ? e.y : e.ky;
    if (e.dead) {
      ctx.strokeStyle = rgba(COL.enemy, .3);
      ctx.beginPath(); ctx.moveTo(x - 5, y - 5); ctx.lineTo(x + 5, y + 5); ctx.moveTo(x + 5, y - 5); ctx.lineTo(x - 5, y + 5); ctx.stroke();
      continue;
    }
    ctx.setLineDash(vis ? [] : [px(2), px(2)]);
    ctx.strokeStyle = rgba(COL.enemy, vis ? 1 : .5); ctx.fillStyle = rgba(COL.enemy, vis ? .2 : .05);
    enemyMark(ctx, e.kind, x, y);
    ctx.setLineDash([]);
    if (vis) { ctx.fillStyle = rgba(COL.enemy, .8); ctx.fillRect(x - 8, y + 12, 16 * e.hp / e.maxhp, px(2)); }
    if (vis && e.sup > 40) { ctx.strokeStyle = rgba(COL.amber, .7); ctx.beginPath(); ctx.arc(x, y, 12, 0, 7); ctx.stroke(); }
  }
  for (const q of S.teams) {
    if (q.side !== 'e') continue;
    if (inVision(q.x, q.y)) {
      const a = faceOf(q), c = Math.cos(a + 1.57), s = Math.sin(a + 1.57), det = CELL * R.s >= 16;
      q.men.forEach((m, i) => drawMan(ctx, q.x + MO[i][0] * c - MO[i][1] * s, q.y + MO[i][0] * s + MO[i][1] * c, a, m, COL.enemy, det));
      if (q.sup >= 60) { ctx.strokeStyle = rgba(COL.amber, .6); ctx.lineWidth = px(1); ctx.beginPath(); ctx.arc(q.x, q.y, 7, 0, 7); ctx.stroke(); }
    } else if (q.seen && S.t - q.seen < 8) {
      ctx.strokeStyle = rgba(COL.enemy, (1 - (S.t - q.seen) / 8) * .6); ctx.lineWidth = px(1);
      ctx.strokeRect(q.sx - 6, q.sy - 6, 12, 12);
    }
  }
}

function drawTeams(time) {
  const ctx = R.ctx;
  for (const q of S.teams) {
    if (q.side !== 'p') continue;
    const sel = isSel(q.u), o = q.order, low = q.kind === 'inf' && q.ammo < 8, a = low ? .45 + .45 * Math.sin(time * 10) : 1;
    if (o.x != null && (sel || o.t === 'retreat')) {
      ctx.strokeStyle = rgba(o.t === 'amove' ? COL.enemy : o.t === 'retreat' ? COL.amber : COL.sel, sel ? .6 : .3); ctx.lineWidth = px(1);
      ctx.setLineDash([px(3), px(4)]); ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(o.x, o.y); ctx.stroke(); ctx.setLineDash([]);
    }
    const f = faceOf(q), c = Math.cos(f + 1.57), s = Math.sin(f + 1.57), det = CELL * R.s >= 16, u = unitOf(q);
    const col = rgba(u && u.state === 'rout' ? COL.amber : COL.g, a);
    q.men.forEach((m, i) => {
      const x = q.x + MO[i][0] * c - MO[i][1] * s, y = q.y + MO[i][0] * s + MO[i][1] * c;
      drawMan(ctx, x, y, f, m, col, det);
      if (m === 'radio') { ctx.strokeStyle = rgba(COL.g, .25 + .25 * Math.sin(time * 3 + q.id)); ctx.lineWidth = px(1); ctx.beginPath(); ctx.arc(x, y, 5, 0, 7); ctx.stroke(); }
    });
    if (q.sup > 25) {
      ctx.strokeStyle = rgba(COL.amber, q.sup >= 60 ? .5 + .5 * Math.sin(time * 10) : .6); ctx.lineWidth = px(1.6);
      ctx.beginPath(); ctx.arc(q.x, q.y, 8, -1.57, -1.57 + q.sup / 100 * 6.283); ctx.stroke();
    }
    if (q.working) { ctx.strokeStyle = COL.amber; ctx.lineWidth = px(1.4); ctx.beginPath(); ctx.arc(q.x, q.y, 10, time * 4, time * 4 + 2); ctx.stroke(); }
  }
}

// drawShips / drawDD / drawBoat：舰船俯视剪影已移至 ships.js
