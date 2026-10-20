'use strict';
// 渲染（二）：工事、烟幕、补给/增援线、据点、敌我单位、舰船
// 三角形 = 登陆舰，五边形 = 驱逐舰，小方块 = 士兵，红色 = 敌方（仅视野内或已标定）
const MO = [[0, -3.2], [-3.2, 2.4], [3.2, 2.4]];
const isSel = id => S.sel.includes(id);

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
  ctx.fillStyle = rgba(COL.intel, .9);
  for (const b of S.boats) { const L = S.rlines.find(l => l.id === b.line); shape(ctx, b.x, b.y, 4.5, 3, Math.atan2(L.y1 - L.y0, L.x1 - L.x0)); ctx.fill(); }
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
      ctx.fillStyle = COL.enemy;
      q.men.forEach((m, i) => ctx.fillRect(q.x + MO[i][0] - 1.6, q.y + MO[i][1] - 1.6, 3.2, 3.2));
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
    const sel = isSel(q.id), o = q.order, low = q.kind === 'inf' && q.ammo < 8, a = low ? .45 + .45 * Math.sin(time * 10) : 1;
    if (o.x != null && (sel || o.t === 'retreat')) {
      ctx.strokeStyle = rgba(o.t === 'amove' ? COL.enemy : o.t === 'retreat' ? COL.amber : COL.sel, sel ? .6 : .3); ctx.lineWidth = px(1);
      ctx.setLineDash([px(3), px(4)]); ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(o.x, o.y); ctx.stroke(); ctx.setLineDash([]);
    }
    const c = Math.cos((q.heading ?? -1.57) + 1.57), s = Math.sin((q.heading ?? -1.57) + 1.57);
    q.men.forEach((m, i) => {
      const x = q.x + MO[i][0] * c - MO[i][1] * s, y = q.y + MO[i][0] * s + MO[i][1] * c;
      if (m === 'eng') { ctx.strokeStyle = rgba(COL.g, a); ctx.lineWidth = px(1.2); ctx.beginPath(); ctx.arc(x, y, 1.9, 0, 7); ctx.stroke(); }
      else { ctx.fillStyle = rgba(m === 'mg' ? '#9dffc4' : COL.g, a); ctx.fillRect(x - 1.6, y - 1.6, 3.2, 3.2); }
      if (m === 'radio') { ctx.strokeStyle = rgba(COL.g, .25 + .25 * Math.sin(time * 3 + q.id)); ctx.lineWidth = px(1); ctx.beginPath(); ctx.arc(x, y, 5, 0, 7); ctx.stroke(); }
    });
    if (q.sup > 25) {
      ctx.strokeStyle = rgba(COL.amber, q.sup >= 60 ? .5 + .5 * Math.sin(time * 10) : .6); ctx.lineWidth = px(1.6);
      ctx.beginPath(); ctx.arc(q.x, q.y, 8, -1.57, -1.57 + q.sup / 100 * 6.283); ctx.stroke();
    }
    if (q.working) { ctx.strokeStyle = COL.amber; ctx.lineWidth = px(1.4); ctx.beginPath(); ctx.arc(q.x, q.y, 10, time * 4, time * 4 + 2); ctx.stroke(); }
    if (sel) { ctx.strokeStyle = COL.sel; ctx.lineWidth = px(1.3); ctx.beginPath(); ctx.arc(q.x, q.y, 11, 0, 7); ctx.stroke(); }
  }
}

function drawShips(time) {
  const ctx = R.ctx;
  for (const s of S.ships) {
    if (s.state === 'sunk') {
      ctx.strokeStyle = rgba(COL.g, .25); ctx.lineWidth = px(1); ctx.setLineDash([px(2), px(3)]);
      shape(ctx, s.x, s.y, 9, 3, s.heading); ctx.stroke(); ctx.setLineDash([]);
      continue;
    }
    const sel = isSel(s.id), beached = s.state === 'beached';
    if (s.state === 'move') {
      ctx.strokeStyle = sel ? rgba(COL.sel, .7) : rgba(COL.g, .2); ctx.lineWidth = px(1); ctx.setLineDash([px(4), px(4)]);
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.tx, s.ty); ctx.stroke(); ctx.setLineDash([]);
      if (s.land) { ctx.beginPath(); ctx.moveTo(s.bx, s.by); ctx.lineTo(s.bx, s.by - 12); ctx.lineTo(s.bx + 7, s.by - 9); ctx.lineTo(s.bx, s.by - 6); ctx.stroke(); }
    }
    ctx.lineWidth = px(1.6);
    ctx.strokeStyle = rgba(COL.g, beached ? .5 : 1); ctx.fillStyle = rgba(COL.g, beached ? .06 : .15);
    shape(ctx, s.x, s.y, 10, 3, s.heading); ctx.fill(); ctx.stroke();
    if (s.kind === 'supply') { ctx.fillStyle = rgba(COL.g, beached ? .5 : 1); shape(ctx, s.x, s.y, 3.6, 3, s.heading); ctx.fill(); }
    if (s.state === 'unloading') { ctx.strokeStyle = COL.g; ctx.lineWidth = px(2); ctx.beginPath(); ctx.arc(s.x, s.y, 15, -1.57, -1.57 + s.ut / 3 * 6.283); ctx.stroke(); }
    if (sel) {
      ctx.strokeStyle = COL.sel; ctx.lineWidth = px(1.6);
      for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { ctx.beginPath(); ctx.moveTo(s.x + dx * 15, s.y + dy * 9); ctx.lineTo(s.x + dx * 15, s.y + dy * 15); ctx.lineTo(s.x + dx * 9, s.y + dy * 15); ctx.stroke(); }
    }
    if (!beached) for (let i = 0; i < s.maxhp; i++) {
      ctx.fillStyle = rgba(s.hp > 3 ? COL.g : COL.enemy, s.hp >= i + 1 ? .9 : .15);
      ctx.fillRect(s.x - 15 + i * 3, s.y + 14, 2, 2);
    }
  }
}

function drawDD(time) {
  const ctx = R.ctx, D = S.dd;
  if (D.state === 'sunk') {
    ctx.strokeStyle = rgba(COL.g, .25); ctx.lineWidth = px(1); ctx.setLineDash([px(2), px(3)]);
    shape(ctx, D.x, D.y, 13, 5, -1.57); ctx.stroke(); ctx.setLineDash([]);
    return;
  }
  const col = D.state === 'repair' ? COL.amber : COL.g, sel = isSel('DD');
  if (sel || U.tool === 'fire' || U.tool === 'smoke') {
    ctx.strokeStyle = rgba(COL.g, .12); ctx.lineWidth = px(1); ctx.setLineDash([px(4), px(8)]);
    ctx.beginPath(); ctx.arc(D.x, D.y, 1000, 0, 7); ctx.stroke(); ctx.setLineDash([]);
  }
  if (D.moving) { ctx.strokeStyle = rgba(COL.sel, .5); ctx.lineWidth = px(1); ctx.setLineDash([px(4), px(4)]); ctx.beginPath(); ctx.moveTo(D.x, D.y); ctx.lineTo(D.tx, D.ty); ctx.stroke(); ctx.setLineDash([]); }
  ctx.lineWidth = px(1.8); ctx.strokeStyle = col; ctx.fillStyle = rgba(col, .15);
  shape(ctx, D.x, D.y, 13, 5, -1.57); ctx.fill(); ctx.stroke();
  ctx.lineWidth = px(1.2); shape(ctx, D.x, D.y, 5.5, 5, -1.57); ctx.stroke();
  ctx.lineWidth = px(2.2);
  if (D.state === 'repair') { ctx.beginPath(); ctx.arc(D.x, D.y, 19, -1.57, -1.57 + D.repairT / D.repairDur * 6.283); ctx.stroke(); }
  else if (D.cool > 0) { ctx.strokeStyle = rgba(COL.g, .5); ctx.beginPath(); ctx.arc(D.x, D.y, 19, -1.57, -1.57 + (1 - D.cool / 5) * 6.283); ctx.stroke(); }
  if (S.t < D.exposedUntil) { ctx.strokeStyle = rgba(COL.enemy, .5 + .5 * Math.sin(time * 12)); ctx.lineWidth = px(1.5); ctx.beginPath(); ctx.arc(D.x, D.y, 26, 0, 7); ctx.stroke(); }
  if (sel) { ctx.strokeStyle = COL.sel; ctx.lineWidth = px(1.4); ctx.beginPath(); ctx.arc(D.x, D.y, 22, 0, 7); ctx.stroke(); }
  for (let i = 0; i < 3; i++) { ctx.fillStyle = rgba(col, D.hull > i ? .95 : .15); shape(ctx, D.x - 8 + i * 8, D.y + 22, 3, 5, -1.57); ctx.fill(); }
}
