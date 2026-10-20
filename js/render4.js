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

function flag(ctx, x, y, owner, vp, prog, time) {
  const col = owner === 'p' ? COL.g : COL.enemy;
  ctx.strokeStyle = rgba(STRUCT, .8); ctx.lineWidth = px(1.2);
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 20); ctx.stroke();
  const wave = Math.sin(time * 3 + x) * 1.2;
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.moveTo(x, y - 20); ctx.lineTo(x + 10, y - 18 + wave); ctx.lineTo(x, y - 14); ctx.closePath(); ctx.fill();
  for (let k = 1; k < vp; k++) { ctx.beginPath(); ctx.moveTo(x, y - 14 + k * 4); ctx.lineTo(x + 5, y - 12.5 + k * 4); ctx.lineTo(x, y - 11 + k * 4); ctx.fill(); }
  if (owner === 'e' && prog > 0) {   // 我方正在升起的旗
    const h = y - 2 - prog * 16;
    ctx.fillStyle = COL.g; ctx.beginPath(); ctx.moveTo(x, h); ctx.lineTo(x - 8, h + 2); ctx.lineTo(x, h + 4); ctx.fill();
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
  if ((p.prog > 0 && p.prog < 1) || p.contested) {
    ctx.strokeStyle = p.contested ? rgba(COL.amber, .5 + .5 * Math.sin(time * 8)) : COL.g; ctx.lineWidth = px(2.5);
    ctx.beginPath(); ctx.arc(x, y, 36, -1.57, -1.57 + p.prog * 6.283); ctx.stroke();
  }
  ctx.strokeStyle = rgba(p.owner === 'p' ? COL.g : COL.enemy, .18); ctx.lineWidth = px(1); ctx.setLineDash([px(2), px(4)]);
  ctx.beginPath(); ctx.arc(x, y, 45, 0, 7); ctx.stroke(); ctx.setLineDash([]);
}
function drawStructures(time) { for (const p of S.points) drawStructure(p, time); }

// 俯视士兵：肩线、头、武器；通讯兵背天线，机枪手带脚架，工兵扛锹
function drawMan(ctx, x0, y0, a, role, col, det) {
  if (!det) { ctx.fillStyle = col; ctx.fillRect(x0 - 1.8, y0 - 1.8, 3.6, 3.6); return; }
  ctx.save(); ctx.translate(x0, y0); ctx.scale(1.5, 1.5);
  const c = Math.cos(a), s = Math.sin(a), x = 0, y = 0;
  ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = .9;
  ctx.beginPath(); ctx.moveTo(x - s * 1.7, y + c * 1.7); ctx.lineTo(x + s * 1.7, y - c * 1.7); ctx.stroke();
  ctx.beginPath(); ctx.arc(x, y, 1, 0, 7); ctx.fill();
  const gx = x - s * 1.1, gy = y + c * 1.1;
  if (role === 'mg') {
    ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(gx + c * 4.2, gy + s * 4.2); ctx.stroke();
    ctx.lineWidth = .6; ctx.beginPath(); ctx.moveTo(gx + c * 3, gy + s * 3); ctx.lineTo(gx + c * 3.8 - s * 1.4, gy + s * 3.8 + c * 1.4);
    ctx.moveTo(gx + c * 3, gy + s * 3); ctx.lineTo(gx + c * 3.8 + s * 1.4, gy + s * 3.8 - c * 1.4); ctx.stroke();
  } else if (role === 'eng') {
    ctx.lineWidth = .8; ctx.beginPath(); ctx.moveTo(x + s * 1.2, y - c * 1.2); ctx.lineTo(x + s * 1.2 - c * 3, y - c * 1.2 - s * 3); ctx.stroke();
    ctx.fillRect(x + s * 1.2 - c * 3.6 - .9, y - c * 1.2 - s * 3.6 - .9, 1.8, 1.8);
  } else {
    ctx.lineWidth = .75; ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(gx + c * 3.4, gy + s * 3.4); ctx.stroke();
  }
  if (role === 'radio') {
    ctx.lineWidth = .5; ctx.beginPath(); ctx.moveTo(x - c * .8, y - s * .8); ctx.lineTo(x - c * 3.6 + s * 1.2, y - s * 3.6 - c * 1.2); ctx.stroke();
  }
  ctx.restore();
}
