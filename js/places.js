'use strict';
// 地名标注（固定机制）：通联里说到的地名都能在地图上找到——据点名（西镇、白滩出口、中公路桥…）、海滩名（白滩、蓝滩…）、
//   200 一格的方格网与方格号（「D7 方格」：列 A、B、C… 自西向东，行 1、2、3… 自北向南，与 core.js gridRef 一致）
// 平面地图：方格线画在地面层；方格号近看时标在每格左上角，远看时沿画面上沿、左沿标列号、行号（像地图的图廓）；
//   据点名写在据点下方，海滩名写在海面括线下方；字号按屏幕像素固定，带深色描边，压在单位、地形上也看得清；远看时互相压住的名称让位
// 3D 立体地图里的地名由 view3d.js v3Overlay 画（这里在画 3D 贴图时不画字，免得字被透视拉歪）
const PL = { cell: 200, near: 110 };

function plGrid() {
  if (!S || !TER || (typeof V3 === 'object' && V3.drawing)) return;   // 3D 的方格网在着色器里
  const ctx = R.ctx, v = R.view || [0, 0, W, H], c = PL.cell;
  ctx.save(); ctx.strokeStyle = rgba(COL.g, .18); ctx.lineWidth = px(1); ctx.setLineDash([px(10), px(5)]);
  ctx.beginPath();
  for (let x = Math.max(c, Math.ceil(v[0] / c) * c); x <= Math.min(W - 1, v[2]); x += c) { ctx.moveTo(x, Math.max(0, v[1])); ctx.lineTo(x, Math.min(H, v[3])); }
  for (let y = Math.max(c, Math.ceil(v[1] / c) * c); y <= Math.min(H - 1, v[3]); y += c) { ctx.moveTo(Math.max(0, v[0]), y); ctx.lineTo(Math.min(W, v[2]), y); }
  ctx.stroke(); ctx.restore();
}

function plText(ctx, t, x, y, col, a, size, align) {
  ctx.font = font(size); ctx.textAlign = align || 'center'; ctx.lineJoin = 'round';
  ctx.lineWidth = px(3); ctx.strokeStyle = rgba(COL.bg, .85 * a); ctx.strokeText(t, x, y);
  ctx.fillStyle = rgba(col, a); ctx.fillText(t, x, y);
}

function plLabels() {
  if (!S || !TER || (typeof V3 === 'object' && V3.drawing)) return;
  const ctx = R.ctx, v = R.view || [0, 0, W, H], c = PL.cell, used = [];
  ctx.save(); ctx.textBaseline = 'alphabetic';
  // 名称互相压住就让位（先画的优先：据点 → 海滩）
  const fits = (t, x, y, size) => {
    ctx.font = font(size);
    const w = ctx.measureText(t).width / 2 + px(3), h = px(size), r = [x - w, y - h, x + w, y + px(3)];
    if (used.some(o => r[0] < o[2] && r[2] > o[0] && r[1] < o[3] && r[3] > o[1])) return false;
    used.push(r); return true;
  };
  for (const p of S.points) {
    if (!inView(p.x, p.y, 120)) continue;
    const y = p.y + Math.max(30, px(20));
    if (fits(p.name, p.x, y, 11)) plText(ctx, p.name, p.x, y, p.owner === 'p' ? COL.g : COL.enemy, .92, 11);
  }
  for (const b of TER.beaches) {
    const y = coastAt(b.cx) + 64 + px(14);
    if (inView(b.cx, y, 200) && fits(b.name, b.cx, y, 11)) plText(ctx, b.name, b.cx, y, COL.text, .75, 11);
  }
  // 方格号
  if (c * R.s >= PL.near) {   // 近看：每格左上角
    for (let gx = Math.max(0, Math.floor(v[0] / c)); gx * c < Math.min(W, v[2]); gx++) for (let gy = Math.max(0, Math.floor(v[1] / c)); gy * c < Math.min(H, v[3]); gy++)
      plText(ctx, gridRef(gx * c + 1, gy * c + 1), gx * c + px(5), gy * c + px(14), COL.g, .65, 10, 'left');
  } else {   // 远看：画面上沿标列号、左沿标行号
    const top = Math.max(0, v[1]) + px(64), left = Math.max(0, v[0]) + px(6);   // 上沿让开顶栏
    for (let gx = Math.max(0, Math.floor(v[0] / c)); gx * c < Math.min(W, v[2]); gx++) plText(ctx, gridRef(gx * c + c / 2, 1).replace(/\d+$/, ''), gx * c + c / 2, top, COL.g, .5, 10);
    for (let gy = Math.max(0, Math.floor(v[1] / c)); gy * c < Math.min(H, v[3]); gy++) plText(ctx, String(gy + 1), left, gy * c + c / 2 + px(4), COL.g, .5, 10, 'left');
  }
  ctx.restore();
}
HOOK.drawGround.push(plGrid);
HOOK.drawTop.push(plLabels);
