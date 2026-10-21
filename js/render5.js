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

// 连队旗：屏幕尺寸随缩放略变（全图小一点、近看稍大）；相互重叠时先左右错开、再向上叠放，旗杆/引线指回连队
// BANNER_HITS 记录本帧旗框（世界坐标），bannerAt(p) 供点选使用
const BANNER_HITS = [];
function bannerAt(p) {
  const m = px(3);
  for (const b of BANNER_HITS) if (p.x >= b.x0 - m && p.x <= b.x1 + m && p.y >= b.y0 - m && p.y <= b.y1 + m) return b.id;
  return null;
}

// 错开后的连队旗也能点选（ui.js pickAt 只认默认位置）：鼠标左键松开、未拖框且无工具时，命中我方旗框即选中该连队
if (typeof HOOK === 'object') HOOK.pointer.push((e, ph, p) => {
  if (ph !== 'up' || e.pointerType === 'touch' || e.button !== 0 || S.phase === 'sandbox') return false;
  const D = U.down, id = D && !D.pan && !U.box && !U.tool ? bannerAt(p) : null, u = id != null && UNIT_MAP.get(id);
  if (!u || u.side !== 'p') return false;
  S.sel = D.add ? (S.sel.includes(id) ? S.sel.filter(i => i !== id) : [...S.sel, id]) : [id];
  U.down = null; updateHud();
  return true;
});

function drawBanners(time) {
  const ctx = R.ctx, bk = lerp(.82, 1.12, smooth(1, 6, R.zr)), list = [], placed = [];
  BANNER_HITS.length = 0;
  for (const u of S.units) {
    if (u.x == null || !inView(u.x, u.y, 80)) continue;
    const ts = teamsOf(u);
    if (!ts.length || (u.side === 'e' && !ts.some(q => inVision(q.x, q.y)))) continue;
    list.push({ u, ts, top: Math.min(...ts.map(q => q.y)), sel: u.side === 'p' && isSel(u.id) });
  }
  // 选中的先占位，其次我方，再按纵向位置
  list.sort((a, b) => (b.sel - a.sel) || ((a.u.side === 'p' ? 0 : 1) - (b.u.side === 'p' ? 0 : 1)) || a.top - b.top);
  const fw = px(14 * bk), fh = px(10 * bk), pole = px(18 * bk), gap = px(3);
  for (const { u, ts, top, sel } of list) {
    const mine = u.side === 'p', bx = u.x, by = top - px(10 * bk), boxH = fh + (mine ? px(12 * bk) : px(5 * bk));
    let fx = bx, fy = by - pole;
    for (let i = 0; i < 15; i++) {   // 候选位：原位、右移、左移，再上移一层……与已放置的旗框重叠就换下一个
      const x0 = bx + [0, 1, -1][i % 3] * (fw + gap), y0 = by - pole - Math.floor(i / 3) * (boxH + gap);
      if (!placed.some(r => x0 < r[2] + gap && x0 + fw > r[0] - gap && y0 < r[3] + gap && y0 + boxH > r[1] - gap) || i === 14) { fx = x0; fy = y0; break; }
    }
    placed.push([fx, fy, fx + fw, fy + boxH]);
    BANNER_HITS.push({ id: u.id, x0: fx, y0: fy, x1: fx + fw, y1: fy + fh });
    let col = mine ? MORALE_COL[u.state] : COL.enemy;
    if (u.state === 'rout') col = rgba(mine ? COL.enemy : COL.amber, .4 + .6 * Math.abs(Math.sin(time * 6)));
    const moved = fx !== bx || fy < by - pole - 1e-6;
    ctx.strokeStyle = rgba(STRUCT, moved ? .45 : .7); ctx.lineWidth = px(1);
    ctx.beginPath(); ctx.moveTo(bx, by);
    if (fx !== bx) ctx.lineTo(fx, Math.min(by, fy + boxH + px(3)));   // 引线：连队 → 旗杆下端
    ctx.lineTo(fx, fy); ctx.stroke();
    ctx.fillStyle = 'rgba(2,10,6,.88)'; ctx.fillRect(fx, fy, fw, fh);
    ctx.strokeStyle = sel ? COL.sel : col; ctx.lineWidth = px(sel ? 1.8 : 1.1); ctx.strokeRect(fx, fy, fw, fh);
    emblem(ctx, mine ? (u.kind === 'eng' ? 'eng' : u.emblem || 'assault') : 'enemy', fx + fw / 2, fy + fh / 2, px(3.6 * bk), col);
    const bw = px(1.8 * bk);
    ctx.fillStyle = rgba(col, .25); ctx.fillRect(fx, fy + fh + px(2), fw, bw);
    ctx.fillStyle = col; ctx.fillRect(fx, fy + fh + px(2), fw * u.men / Math.max(1, u.men0), bw);
    if (mine) {
      ctx.fillStyle = rgba(COL.intel, .25); ctx.fillRect(fx, fy + fh + px(2) + bw + px(1.5), fw, px(1.4));
      ctx.fillStyle = COL.intel; ctx.fillRect(fx, fy + fh + px(2) + bw + px(1.5), fw * u.morale / 100, px(1.4));
      const g = groupOf(ts[0].id);
      if (g) pips(ctx, g, fx + fw / 2, fy + fh + px(10 * bk), COL.sel);
    }
    if (sel) {   // 选中：四角括号框住全连 + 朝向箭头
      const xs = ts.map(q => q.x), ys = ts.map(q => q.y), pad = 7, x0 = Math.min(...xs) - pad, y0 = Math.min(...ys) - pad, x1 = Math.max(...xs) + pad, y1 = Math.max(...ys) + pad;
      const c = Math.min(px(8), (x1 - x0) / 3, (y1 - y0) / 3);
      ctx.strokeStyle = rgba(COL.sel, .75); ctx.lineWidth = px(1.2);
      ctx.beginPath();
      for (const [cx, cy, sx, sy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x1, y1, -1, -1], [x0, y1, 1, -1]]) { ctx.moveTo(cx + sx * c, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + sy * c); }
      ctx.stroke();
      const a = u.face, cx0 = u.x, cy0 = u.y, L = Math.max(16, px(18));
      ctx.strokeStyle = rgba(COL.sel, .7); ctx.lineWidth = px(1.2);
      ctx.beginPath(); ctx.moveTo(cx0, cy0); ctx.lineTo(cx0 + Math.cos(a) * L, cy0 + Math.sin(a) * L);
      ctx.lineTo(cx0 + Math.cos(a - .4) * L * .72, cy0 + Math.sin(a - .4) * L * .72); ctx.moveTo(cx0 + Math.cos(a) * L, cy0 + Math.sin(a) * L);
      ctx.lineTo(cx0 + Math.cos(a + .4) * L * .72, cy0 + Math.sin(a + .4) * L * .72); ctx.stroke();
    }
  }
}

function drawShipMarks() {
  const ctx = R.ctx;
  for (const s of S.ships) {
    if (!alive(s)) continue;
    const men = s.load.teams * 3 + s.load.eng, g = groupOf(s.id), y = s.y + (typeof shipHalfH === 'function' ? shipHalfH(s) : 14) + px(5);
    if (men) { ctx.fillStyle = rgba(COL.g, .25); ctx.fillRect(s.x - px(8), y, px(16), px(2)); ctx.fillStyle = COL.g; ctx.fillRect(s.x - px(8), y, px(16) * men / 15, px(2)); }
    if (g) pips(ctx, g, s.x, y + px(6), COL.sel);
    if (S.phase === 'deploy' && s.load.teams) {   // 预设阵型小图（屏幕尺寸固定，约 30px 宽，放大后不会散成一片大方块）
      const n = s.load.teams, w = defWidth(s.form, n), sl = unitSlots(n, s.form, W / 2, H / 2, NORTH, w);
      const k = Math.min(.22, px(30) / Math.max(1, w)), d = Math.min(1.8, px(2.4)), y0 = s.y - (typeof shipHalfH === 'function' ? shipHalfH(s) : 14) - Math.max(4, px(8));
      ctx.fillStyle = rgba(COL.sel, .85);
      for (const [x, yy] of sl) ctx.fillRect(s.x + (x - W / 2) * k - d / 2, y0 + (yy - H / 2) * k - d / 2, d, d);
    }
  }
  if (S.dd.state !== 'sunk') { const g = groupOf('DD'); if (g) pips(ctx, g, S.dd.x, S.dd.y + (typeof shipHalfH === 'function' ? shipHalfH(S.dd) : 24) + px(8), COL.sel); }
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
  for (const s of S.ships) if (s.plan) arrow(ctx, s.x, s.y, s.plan.x, s.plan.y, rgba(isSel(s.id) ? COL.sel : s.kind === 'dd' ? COL.intel : COL.g, .75));   // 护航舰阵位用情报色，与登陆箭头区分
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

// 事件波纹：屏幕尺寸、细线；同一处的多条只画最新一条
function drawPings(time) {
  const ctx = R.ctx, drawn = [], near = px(26);
  for (let i = S.pings.length - 1; i >= 0; i--) {
    const p = S.pings[i], age = S.t - p.t;
    if (age > 3 || age < 0 || !inView(p.x, p.y, px(40))) continue;
    if (drawn.some(d => Math.abs(d.x - p.x) < near && Math.abs(d.y - p.y) < near)) continue;
    drawn.push(p);
    const col = p.kind === 'bad' ? COL.enemy : p.kind === 'good' ? COL.g : p.kind === 'warn' ? COL.amber : COL.intel;
    for (let k = 0; k < 2; k++) {
      const u = ((age + k * .5) % 1.5) / 1.5;
      ctx.strokeStyle = rgba(col, (1 - u) * (1 - age / 3) * .8); ctx.lineWidth = px(1.3);
      ctx.beginPath(); ctx.arc(p.x, p.y, px(6) + u * px(26), 0, 7); ctx.stroke();
    }
  }
}
