'use strict';
// 渲染（五）：连队旗、舰船编组点与载员条、部署计划、阵型拖拽预览、事件波纹（全部为图形，无文字）
const MORALE_COL = { ok: COL.g, waver: COL.amber, rout: COL.enemy };

function emblem(ctx, kind, x, y, r, col) {
  ctx.fillStyle = col; ctx.strokeStyle = col; ctx.lineWidth = px(1.2);
  if (kind === 'eng') { ctx.beginPath(); ctx.arc(x, y, r * .7, 0, 7); ctx.stroke(); }
  else if (kind === 'reserve') { shape(ctx, x, y, r * .8, 4, 0); ctx.fill(); }
  else if (kind === 'enemy') { ctx.fillRect(x - r * .55, y - r * .55, r * 1.1, r * 1.1); }
  else { shape(ctx, x, y, r * .85, 3, -1.57); ctx.fill(); if (kind === 'supply') { ctx.fillStyle = 'rgba(2,10,6,.9)'; ctx.fillRect(x - r * .5, y + r * .1, r, r * .25); } }
}

function pips(ctx, n, x, y, col) {
  ctx.fillStyle = col;
  for (let i = 0; i < n; i++) { const c = i % 3, r = Math.floor(i / 3); ctx.beginPath(); ctx.arc(x + (c - 1) * px(4), y + r * px(4), px(1.3), 0, 7); ctx.fill(); }
}
const groupOf = id => +(Object.keys(S.groups).find(k => S.groups[k].includes(id)) || 0);

function drawBanners(time) {
  const ctx = R.ctx;
  for (const u of S.units) {
    if (u.x == null) continue;
    const ts = teamsOf(u);
    if (!ts.length || (u.side === 'e' && !ts.some(q => inVision(q.x, q.y)))) continue;
    const mine = u.side === 'p', sel = mine && isSel(u.id);
    let col = mine ? MORALE_COL[u.state] : COL.enemy;
    if (u.state === 'rout') col = rgba(mine ? COL.enemy : COL.amber, .4 + .6 * Math.abs(Math.sin(time * 6)));
    const top = Math.min(...ts.map(q => q.y)), bx = u.x, by = top - px(12);
    ctx.strokeStyle = rgba(STRUCT, .8); ctx.lineWidth = px(1.2);
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx, by - px(18)); ctx.stroke();
    const fw = px(14), fh = px(10), fx = bx, fy = by - px(18);
    ctx.fillStyle = 'rgba(2,10,6,.85)'; ctx.fillRect(fx, fy, fw, fh);
    ctx.strokeStyle = sel ? COL.sel : col; ctx.lineWidth = px(sel ? 2 : 1.2); ctx.strokeRect(fx, fy, fw, fh);
    emblem(ctx, mine ? (u.kind === 'eng' ? 'eng' : u.emblem || 'assault') : 'enemy', fx + fw / 2, fy + fh / 2, px(3.6), col);
    ctx.fillStyle = rgba(col, .3); ctx.fillRect(fx, fy + fh + px(2), fw, px(2));
    ctx.fillStyle = col; ctx.fillRect(fx, fy + fh + px(2), fw * u.men / Math.max(1, u.men0), px(2));
    if (mine) {
      ctx.fillStyle = rgba(COL.intel, .3); ctx.fillRect(fx, fy + fh + px(5), fw, px(1.5));
      ctx.fillStyle = COL.intel; ctx.fillRect(fx, fy + fh + px(5), fw * u.morale / 100, px(1.5));
      const g = groupOf(ts[0].id);
      if (g) pips(ctx, g, fx + fw / 2, fy + fh + px(10), COL.sel);
    }
    if (sel) {
      ctx.strokeStyle = rgba(COL.sel, .5); ctx.lineWidth = px(1); ctx.setLineDash([px(3), px(3)]);
      const xs = ts.map(q => q.x), ys = ts.map(q => q.y), pad = 8;
      ctx.strokeRect(Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) - Math.min(...xs) + pad * 2, Math.max(...ys) - Math.min(...ys) + pad * 2);
      ctx.setLineDash([]);
      const a = u.face, cx0 = u.x, cy0 = u.y;   // 朝向箭头
      ctx.strokeStyle = rgba(COL.sel, .8); ctx.lineWidth = px(1.5);
      ctx.beginPath(); ctx.moveTo(cx0, cy0); ctx.lineTo(cx0 + Math.cos(a) * 22, cy0 + Math.sin(a) * 22);
      ctx.lineTo(cx0 + Math.cos(a - .4) * 16, cy0 + Math.sin(a - .4) * 16); ctx.moveTo(cx0 + Math.cos(a) * 22, cy0 + Math.sin(a) * 22);
      ctx.lineTo(cx0 + Math.cos(a + .4) * 16, cy0 + Math.sin(a + .4) * 16); ctx.stroke();
    }
  }
}

function drawShipMarks() {
  const ctx = R.ctx;
  for (const s of S.ships) {
    if (!alive(s)) continue;
    const men = s.load.teams * 3 + s.load.eng, g = groupOf(s.id), y = s.y + px(18);
    if (men) { ctx.fillStyle = rgba(COL.g, .25); ctx.fillRect(s.x - px(8), y, px(16), px(2)); ctx.fillStyle = COL.g; ctx.fillRect(s.x - px(8), y, px(16) * men / 15, px(2)); }
    if (g) pips(ctx, g, s.x, y + px(6), COL.sel);
    if (S.phase === 'deploy' && s.load.teams) {   // 预设阵型小图
      const n = s.load.teams, w = defWidth(s.form, n), sl = unitSlots(n, s.form, W / 2, H / 2, NORTH, w);
      ctx.fillStyle = rgba(COL.sel, .85);
      for (const [x, yy] of sl) ctx.fillRect(s.x + (x - W / 2) * .22 - .9, s.y - 18 + (yy - H / 2) * .22 - .9, 1.8, 1.8);
    }
  }
  if (S.dd.state !== 'sunk') { const g = groupOf('DD'); if (g) pips(ctx, g, S.dd.x, S.dd.y + px(32), COL.sel); }
}

function arrow(ctx, x0, y0, x1, y1, col) {
  const mx = (x0 + x1) / 2 + (y1 - y0) * .12, my = (y0 + y1) / 2 - (x1 - x0) * .12;
  ctx.strokeStyle = col; ctx.lineWidth = px(1.4); ctx.setLineDash([px(6), px(4)]);
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(mx, my, x1, y1); ctx.stroke(); ctx.setLineDash([]);
  const a = Math.atan2(y1 - my, x1 - mx);
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1 - Math.cos(a - .4) * px(9), y1 - Math.sin(a - .4) * px(9));
  ctx.moveTo(x1, y1); ctx.lineTo(x1 - Math.cos(a + .4) * px(9), y1 - Math.sin(a + .4) * px(9)); ctx.stroke();
}

function drawPlans(time) {
  const ctx = R.ctx;
  if (S.phase !== 'deploy') return;
  const a = .06 + .04 * Math.sin(time * 2);
  ctx.fillStyle = rgba(COL.g, a); ctx.fillRect(0, STAGING_Y, W, H - STAGING_Y);
  ctx.strokeStyle = rgba(COL.g, .6); ctx.lineWidth = px(1.5); ctx.strokeRect(0, STAGING_Y, W, H - STAGING_Y);
  for (const b of TER.beaches) {   // 可登陆海滩：岸线上的绿色箭头
    for (let x = b.x0 + 10; x < b.x1; x += 22) { const y = coastAt(x) + 14; ctx.strokeStyle = rgba(COL.g, .55); ctx.beginPath(); ctx.moveTo(x - 4, y + 4); ctx.lineTo(x, y); ctx.lineTo(x + 4, y + 4); ctx.stroke(); }
  }
  for (const s of S.ships) if (s.plan) arrow(ctx, s.x, s.y, s.plan.x, s.plan.y, rgba(isSel(s.id) ? COL.sel : COL.g, .75));
  if (S.dd.plan) arrow(ctx, S.dd.x, S.dd.y, S.dd.plan.x, S.dd.plan.y, rgba(COL.intel, .75));
}

// 右键拖拽：显示阵型落位与朝向
function drawFormPreview() {
  const d = U.fdrag;
  if (!d || !d.on) return;
  const ctx = R.ctx, units = selUnits();
  const face = Math.atan2(-(d.x1 - d.x0), d.y1 - d.y0), total = dist(d.x0, d.y0, d.x1, d.y1), cx0 = (d.x0 + d.x1) / 2, cy0 = (d.y0 + d.y1) / 2;
  ctx.strokeStyle = rgba(COL.sel, .8); ctx.lineWidth = px(2);
  ctx.beginPath(); ctx.moveTo(d.x0, d.y0); ctx.lineTo(d.x1, d.y1); ctx.stroke();
  arrow(ctx, cx0, cy0, cx0 + Math.cos(face) * 30, cy0 + Math.sin(face) * 30, COL.sel);
  if (!units.length) return;
  for (const L of layoutUnits(units, cx0, cy0, face, total)) {
    ctx.fillStyle = rgba(COL.sel, .8);
    for (const [x, y] of L.slots) shape(ctx, x, y, 3.5, 3, face), ctx.fill();
  }
}

function drawPings(time) {
  const ctx = R.ctx;
  for (const p of S.pings) {
    const age = S.t - p.t;
    if (age > 3 || age < 0) continue;
    const col = p.kind === 'bad' ? COL.enemy : p.kind === 'good' ? COL.g : p.kind === 'warn' ? COL.amber : COL.intel;
    for (let k = 0; k < 2; k++) {
      const u = ((age + k * .5) % 1.5) / 1.5;
      ctx.strokeStyle = rgba(col, (1 - u) * (1 - age / 3)); ctx.lineWidth = px(2);
      ctx.beginPath(); ctx.arc(p.x, p.y, px(8) + u * px(40), 0, 7); ctx.stroke();
    }
  }
}
