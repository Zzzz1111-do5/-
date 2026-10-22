'use strict';
// 渲染（四）：不用文字，用形状表达——据点建筑、房屋、弹坑、士兵、连队旗、部署计划、阵型预览、事件波纹
const PKIND = k => k === 'HQ' ? 'hq' : k === 'RD' ? 'radar' : k.startsWith('BT') ? 'battery' : ({ E: 'exit', T: 'town', B: 'bridge', X: 'cross', V: 'village', F: 'ford' })[k[0]];
const STRUCT = '#d9ffe6';
let TOWN_CELLS = [], TOWN_SEED = null;
const viewRect = () => { const a = toWorld(0, 0), b = toWorld(CAM.vw, CAM.vh); return [a.x - 20, a.y - 20, b.x + 20, b.y + 20]; };

function drawCraters() {
  const ctx = R.ctx, [x0, y0, x1, y1] = viewRect();
  for (const c of S.craters) {
    if (c.x < x0 || c.x > x1 || c.y < y0 || c.y > y1) continue;
    ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.beginPath(); ctx.ellipse(c.x, c.y, c.r, c.r * .8, 0, 0, 7); ctx.fill();
    ctx.strokeStyle = rgba(COL.g, .18); ctx.lineWidth = px(1); ctx.stroke();
  }
}

// 城镇格画成房屋轮廓（屋脊线），近看才画
function drawBuildings() {
  if (CELL * R.s < 5) return;
  if (TOWN_SEED !== TER.seed) {
    TOWN_SEED = TER.seed; TOWN_CELLS = [];
    const hr = rng(TER.seed + 11);
    for (let i = 0; i < GW * GH; i++) if (TER.type[i] === T.TOWN) TOWN_CELLS.push({ x: cellCX(i), y: cellCY(i), w: 5 + hr() * 3, h: 4 + hr() * 3, r: hr() < .5 });
  }
  const ctx = R.ctx, [x0, y0, x1, y1] = viewRect();
  ctx.lineWidth = px(1);
  for (const b of TOWN_CELLS) {
    if (b.x < x0 || b.x > x1 || b.y < y0 || b.y > y1) continue;
    const w = b.r ? b.h : b.w, h = b.r ? b.w : b.h;
    ctx.fillStyle = 'rgba(2,10,6,.75)'; ctx.fillRect(b.x - w / 2, b.y - h / 2, w, h);
    ctx.strokeStyle = rgba(STRUCT, .45); ctx.strokeRect(b.x - w / 2, b.y - h / 2, w, h);
    ctx.beginPath();
    if (w > h) { ctx.moveTo(b.x - w / 2, b.y); ctx.lineTo(b.x + w / 2, b.y); } else { ctx.moveTo(b.x, b.y - h / 2); ctx.lineTo(b.x, b.y + h / 2); }
    ctx.stroke();
  }
}

// 据点旗：全图时为世界尺寸，近看时封顶约 26px 高，不再占满屏幕
function flag(ctx, x, y, owner, vp, prog, time) {
  const col = owner === 'p' ? COL.g : COL.enemy, k = Math.min(1, px(26) / 20);
  ctx.strokeStyle = rgba(STRUCT, .8); ctx.lineWidth = px(1.1);
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 20 * k); ctx.stroke();
  const wave = Math.sin(time * 3 + x) * 1.2 * k;
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.moveTo(x, y - 20 * k); ctx.lineTo(x + 10 * k, y - (18 - wave) * k); ctx.lineTo(x, y - 14 * k); ctx.closePath(); ctx.fill();
  for (let i = 1; i < vp; i++) { ctx.beginPath(); ctx.moveTo(x, y - (14 - i * 4) * k); ctx.lineTo(x + 5 * k, y - (12.5 - i * 4) * k); ctx.lineTo(x, y - (11 - i * 4) * k); ctx.fill(); }
  if (owner === 'e' && prog > 0) {   // 我方正在升起的旗
    const h = y - (2 + prog * 16) * k;
    ctx.fillStyle = COL.g; ctx.beginPath(); ctx.moveTo(x, h); ctx.lineTo(x - 8 * k, h + 2 * k); ctx.lineTo(x, h + 4 * k); ctx.fill();
  }
}

function drawStructure(p, time) {
  const ctx = R.ctx, k = PKIND(p.key), x = p.x, y = p.y;
  ctx.strokeStyle = rgba(STRUCT, .8); ctx.fillStyle = 'rgba(2,10,6,.8)'; ctx.lineWidth = px(1.4);
  const box = (bx, by, w, h) => { ctx.fillRect(bx - w / 2, by - h / 2, w, h); ctx.strokeRect(bx - w / 2, by - h / 2, w, h); };
  if (k === 'exit') {
    for (const sx of [-17, 17]) { ctx.beginPath(); ctx.arc(x + sx, y, 6, 0, Math.PI); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x + sx - 3, y + 3); ctx.lineTo(x + sx + 3, y + 3); ctx.stroke(); }
    for (let i = -3; i <= 3; i++) if (i) { const tx = x + i * 8; ctx.beginPath(); ctx.moveTo(tx - 2.5, y + 14); ctx.lineTo(tx, y + 9); ctx.lineTo(tx + 2.5, y + 14); ctx.closePath(); ctx.stroke(); }
  } else if (k === 'hq') {
    ctx.setLineDash([px(5), px(2)]); ctx.strokeRect(x - 28, y - 20, 56, 40); ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(2,10,6,1)'; ctx.fillRect(x - 6, y + 18, 12, 4);
    box(x - 12, y - 6, 18, 12); box(x + 12, y - 8, 12, 9); box(x + 10, y + 8, 16, 8);
    ctx.beginPath(); ctx.moveTo(x - 20, y + 12); ctx.lineTo(x - 20, y - 14); ctx.moveTo(x - 24, y - 10); ctx.lineTo(x - 16, y - 10); ctx.stroke();
    ctx.fillStyle = rgba(COL.enemy, .5 + .5 * Math.sin(time * 5)); ctx.fillRect(x - 21, y - 16, 2, 2);
  } else if (k === 'town') {
    ctx.setLineDash([px(2), px(3)]); ctx.strokeRect(x - 10, y - 10, 20, 20); ctx.setLineDash([]);
    box(x + 16, y - 4, 8, 14); box(x + 16, y - 14, 5, 6);
    ctx.beginPath(); ctx.moveTo(x + 16, y - 22); ctx.lineTo(x + 16, y - 17); ctx.moveTo(x + 14, y - 20); ctx.lineTo(x + 18, y - 20); ctx.stroke();
  } else if (k === 'radar') {
    ctx.setLineDash([px(3), px(2)]); ctx.strokeRect(x - 16, y - 16, 32, 32); ctx.setLineDash([]);
    box(x - 8, y + 8, 10, 7);
    ctx.beginPath(); ctx.moveTo(x + 4, y + 10); ctx.lineTo(x + 4, y - 4); ctx.stroke();
    const a = p.owner === 'e' ? time * 1.4 : 0;
    ctx.lineWidth = px(2); ctx.beginPath(); ctx.arc(x + 4, y - 4, 8, a - .8, a + .8); ctx.stroke();
    if (p.owner === 'e') {
      const g = ctx.createLinearGradient(x + 4, y - 4, x + 4 + Math.cos(a) * 70, y - 4 + Math.sin(a) * 70);
      g.addColorStop(0, rgba(COL.enemy, .45)); g.addColorStop(1, rgba(COL.enemy, 0));
      ctx.strokeStyle = g; ctx.lineWidth = px(1.5); ctx.beginPath(); ctx.moveTo(x + 4, y - 4); ctx.lineTo(x + 4 + Math.cos(a) * 70, y - 4 + Math.sin(a) * 70); ctx.stroke();
    }
  } else if (k === 'battery') {
    for (const [dx, dy] of [[-20, 0], [0, 5], [20, 0]]) {
      ctx.beginPath(); ctx.arc(x + dx, y + dy, 7, Math.PI, 0); ctx.lineTo(x + dx + 7, y + dy + 4); ctx.lineTo(x + dx - 7, y + dy + 4); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.lineWidth = px(2.2); ctx.beginPath(); ctx.moveTo(x + dx, y + dy + 2); ctx.lineTo(x + dx, y + dy + 16); ctx.stroke(); ctx.lineWidth = px(1.4);
    }
    ctx.setLineDash([px(1.5), px(2.5)]); ctx.beginPath(); ctx.arc(x, y + 2, 34, Math.PI * .05, Math.PI * .95); ctx.stroke(); ctx.setLineDash([]);
    box(x, y - 14, 14, 7);
  } else if (k === 'bridge' && typeof isBlown === 'function' && isBlown(p.key)) {
    box(x - 9, y, 3, 14); box(x + 9, y, 3, 14);   // 桥面被炸毁，只剩桥墩（残骸由 drawBlown 绘制）
  } else if (k === 'bridge') {
    ctx.fillRect(x - 24, y - 5, 48, 10);
    ctx.beginPath(); ctx.moveTo(x - 24, y - 5); ctx.lineTo(x + 24, y - 5); ctx.moveTo(x - 24, y + 5); ctx.lineTo(x + 24, y + 5); ctx.stroke();
    ctx.lineWidth = px(1);
    for (let i = -24; i <= 24; i += 6) { ctx.beginPath(); ctx.moveTo(x + i, y - 7); ctx.lineTo(x + i, y - 5); ctx.moveTo(x + i, y + 5); ctx.lineTo(x + i, y + 7); ctx.stroke(); }
    box(x - 9, y, 3, 14); box(x + 9, y, 3, 14);
  } else if (k === 'cross') {
    ctx.setLineDash([px(4), px(2)]); ctx.lineWidth = px(2.4);
    ctx.beginPath(); ctx.arc(x, y, 13, .4, 2.7); ctx.stroke(); ctx.beginPath(); ctx.arc(x, y, 13, 3.5, 5.9); ctx.stroke(); ctx.setLineDash([]);
    ctx.lineWidth = px(1.4); ctx.beginPath(); ctx.moveTo(x - 9, y + 4); ctx.lineTo(x + 9, y + 4); ctx.stroke();
  } else if (k === 'village') {
    box(x - 10, y - 4, 8, 6); box(x + 6, y - 8, 7, 6); box(x + 2, y + 6, 9, 6);
    const cy0 = coastAt(x);
    for (const dx of [-14, 14]) { ctx.beginPath(); ctx.moveTo(x + dx, cy0 - 4); ctx.lineTo(x + dx, cy0 + 22); ctx.stroke(); }
  } else if (k === 'ford') {
    for (let i = -2; i <= 2; i++) box(x + i * 6, y + (i % 2) * 2, 3.5, 3.5);
  }
  flag(ctx, x + (k === 'bridge' ? 0 : 22), y - (k === 'bridge' ? 6 : 8), p.owner, p.vp, p.prog, time);
  const hot = (p.prog > 0 && p.prog < 1) || p.contested, hov = hoverNear(x, y, 45);
  if (hot) {   // 占领进度弧（争夺中为琥珀色闪烁）
    ctx.strokeStyle = p.contested ? rgba(COL.amber, .4 + .3 * Math.sin(time * 6)) : rgba(COL.g, .8); ctx.lineWidth = px(1.6);
    ctx.beginPath(); ctx.arc(x, y, 36, -1.57, -1.57 + p.prog * 6.283); ctx.stroke();
  }
  if (hot || hov) {   // 占领半径：只在争夺中或悬停时显示
    ctx.strokeStyle = rgba(p.owner === 'p' ? COL.g : COL.enemy, hov ? .32 : .16); ctx.lineWidth = px(1); ctx.setLineDash([px(2), px(4)]);
    ctx.beginPath(); ctx.arc(x, y, 45, 0, 7); ctx.stroke(); ctx.setLineDash([]);
  }
}
function drawStructures(time) { for (const p of S.points) if (inView(p.x, p.y, 70)) drawStructure(p, time); }

// 俯视单兵（世界尺寸：肩宽约 3.9、连枪长约 5 单位）：暗底肩部 + 实心头 + 武器线；描边按屏幕像素，放大后依然纤细
// 通讯兵背电台与天线，机枪手枪管粗、带脚架，工兵背锹
function drawMan(ctx, x0, y0, a, role, col, det) {
  if (!det) { const d = Math.max(px(1.8), 1.4); ctx.fillStyle = col; ctx.fillRect(x0 - d / 2, y0 - d / 2, d, d); return; }
  const k = 1.12, lw = px(1) / k, dark = 'rgba(2,10,6,.88)';
  ctx.save(); ctx.translate(x0, y0); ctx.rotate(a); ctx.scale(k, k);
  ctx.lineWidth = lw; ctx.strokeStyle = col; ctx.fillStyle = dark;
  if (role === 'radio') {
    ctx.fillRect(-1.95, -.8, .95, 1.6); ctx.strokeRect(-1.95, -.8, .95, 1.6);
    ctx.lineWidth = lw * .8; ctx.beginPath(); ctx.moveTo(-1.7, -.7); ctx.lineTo(-3.4, -2.1); ctx.stroke(); ctx.lineWidth = lw;
  } else if (role === 'eng') {
    ctx.beginPath(); ctx.moveTo(-.5, -1.2); ctx.lineTo(-2.9, -1.95); ctx.stroke();
    ctx.fillStyle = col; ctx.fillRect(-3.5, -2.45, 1, 1); ctx.fillStyle = dark;
  }
  ctx.beginPath(); ctx.ellipse(-.1, 0, .9, 1.75, 0, 0, 7); ctx.fill();
  ctx.globalAlpha *= .35; ctx.fillStyle = col; ctx.fill(); ctx.globalAlpha /= .35; ctx.stroke();
  if (role === 'mg') {
    ctx.lineWidth = lw * 1.7; ctx.beginPath(); ctx.moveTo(.2, .75); ctx.lineTo(3.9, .75); ctx.stroke();
    ctx.lineWidth = lw * .8; ctx.beginPath(); ctx.moveTo(3.1, .75); ctx.lineTo(3.7, -.1); ctx.moveTo(3.1, .75); ctx.lineTo(3.7, 1.6); ctx.stroke();
  } else { ctx.beginPath(); ctx.moveTo(.1, .85); ctx.lineTo(3.1, .6); ctx.stroke(); }
  if (role === 'aa') { ctx.lineWidth = lw * 2.6; ctx.beginPath(); ctx.moveTo(-2.4, -1.15); ctx.lineTo(2.2, -1.15); ctx.stroke(); ctx.lineWidth = lw * .8; ctx.beginPath(); ctx.moveTo(2.2, -1.9); ctx.lineTo(2.2, -.4); ctx.stroke(); ctx.lineWidth = lw; }   // 防空导弹手：左肩扛粗短发射筒
  ctx.fillStyle = col; ctx.strokeStyle = dark; ctx.lineWidth = lw * .8;
  ctx.beginPath(); ctx.arc(.2, 0, .82, 0, 7); ctx.fill(); ctx.stroke();
  ctx.restore();
}
