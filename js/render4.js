'use strict';
// 渲染（四）：不用文字，用形状表达——据点建筑、房屋、弹坑、士兵、排旗、部署计划、阵型预览、事件波纹
const PKIND = k => k === 'HQ' ? 'hq' : k === 'RD' ? 'radar' : k.startsWith('BT') ? 'battery' : ({ E: 'exit', T: 'town', B: 'bridge', X: 'cross', V: 'village', F: 'ford' })[k[0]];
const STRUCT = '#d9ffe6';
let TOWN_CELLS = [], TOWN_SEED = null;
const viewRect = () => { const a = toWorld(0, 0), b = toWorld(CAM.vw, CAM.vh); return [a.x - 20, a.y - 20, b.x + 20, b.y + 20]; };

function drawCraters() {
  const ctx = R.ctx, [x0, y0, x1, y1] = viewRect();
  for (const c of S.craters) {
    if (c.x < x0 || c.x > x1 || c.y < y0 || c.y > y1) continue;
    // 弹坑：焦黑坑底 + 翻起的土圈
    ctx.fillStyle = 'rgba(112,94,66,.5)'; ctx.beginPath(); ctx.ellipse(c.x, c.y, c.r * 1.25, c.r * 1.05, 0, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(28,22,16,.72)'; ctx.beginPath(); ctx.ellipse(c.x + c.r * .08, c.y + c.r * .08, c.r * .85, c.r * .7, 0, 0, 7); ctx.fill();
  }
}

// 城镇格画成房屋：俯视屋顶（坡屋顶两坡明暗、平顶女儿墙），带东南向投影；全图时是一簇簇小色块，像卫星图上的村镇
// 屋顶配色：红瓦、灰瓦、蓝色彩钢、水泥平顶、深色瓦
const ROOF = [[158, 74, 52], [120, 118, 112], [72, 104, 138], [170, 166, 156], [92, 84, 78], [176, 96, 64]];
const ROOF_G = ROOF.map(c => { const l = c[0] * .3 + c[1] * .59 + c[2] * .11; return [l, l, l]; });   // 黑绿画面：屋顶只留明暗（红瓦不能和敌方红色混在一起）
function drawBuildings() {
  if (CELL * R.s < 2.5) return;
  if (TOWN_SEED !== TER.seed) { TOWN_SEED = TER.seed; TOWN_CELLS = townBld().list; }
  const ctx = R.ctx, [x0, y0, x1, y1] = viewRect();
  const sh = .45 + .9 * smooth(5, 14, CELL * R.s);
  ctx.fillStyle = 'rgba(10,14,8,.38)';
  for (const b of TOWN_CELLS) {
    if (b.x < x0 || b.x > x1 || b.y < y0 || b.y > y1) continue;
    const w = b.r ? b.h : b.w, h = b.r ? b.w : b.h;
    ctx.fillRect(b.x + b.dx - w / 2 + sh, b.y + b.dy - h / 2 + sh, w, h);
  }
  for (const b of TOWN_CELLS) {
    if (b.x < x0 || b.x > x1 || b.y < y0 || b.y > y1) continue;
    const w = b.r ? b.h : b.w, h = b.r ? b.w : b.h, x = b.x + b.dx - w / 2, y = b.y + b.dy - h / 2, c = ROOF_G[b.f ? 3 : b.c];
    const tone = k => `rgb(${c[0] * k | 0},${c[1] * k | 0},${c[2] * k | 0})`;
    if (b.f) {   // 平顶：女儿墙一圈亮边
      ctx.fillStyle = tone(.86); ctx.fillRect(x, y, w, h);
      ctx.fillStyle = tone(1.04); ctx.fillRect(x + .7, y + .7, w - 1.4, h - 1.4);
      ctx.fillStyle = tone(.9); ctx.fillRect(x + 1.4, y + 1.4, w - 2.8, h - 2.8);
    } else if (w > h) {   // 坡屋顶：北坡受光、南坡背光
      ctx.fillStyle = tone(1.12); ctx.fillRect(x, y, w, h / 2);
      ctx.fillStyle = tone(.74); ctx.fillRect(x, y + h / 2, w, h / 2);
    } else {   // 西坡受光、东坡背光
      ctx.fillStyle = tone(1.1); ctx.fillRect(x, y, w / 2, h);
      ctx.fillStyle = tone(.76); ctx.fillRect(x + w / 2, y, w / 2, h);
    }
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
  if (R.m3d && typeof V3_PT === 'object' && V3_PT.includes(k)) { drawStructureMarks(ctx, p, x, y, time); return; }   // 3D：建筑是立体模型（v3units.js），据点标记由立着的菱形标表示，贴图里只留占领进度
  // 混凝土工事（灰色实体、深色边线、东南向投影），围栏为细虚线
  ctx.strokeStyle = 'rgba(28,28,26,.8)'; ctx.fillStyle = '#8f8b82'; ctx.lineWidth = px(1);
  const box = (bx, by, w, h) => {
    ctx.save(); ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fillRect(bx - w / 2 + 1.2, by - h / 2 + 1.2, w, h); ctx.restore();
    ctx.fillRect(bx - w / 2, by - h / 2, w, h); ctx.strokeRect(bx - w / 2, by - h / 2, w, h);
    ctx.save(); ctx.fillStyle = 'rgba(255,255,255,.14)'; ctx.fillRect(bx - w / 2, by - h / 2, w, Math.min(1.2, h / 3)); ctx.restore();
  };
  if (k === 'exit') {
    for (const sx of [-17, 17]) { ctx.beginPath(); ctx.arc(x + sx, y, 6, 0, Math.PI); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x + sx - 3, y + 3); ctx.lineTo(x + sx + 3, y + 3); ctx.stroke(); }
    for (let i = -3; i <= 3; i++) if (i) { const tx = x + i * 8; ctx.beginPath(); ctx.moveTo(tx - 2.5, y + 14); ctx.lineTo(tx, y + 9); ctx.lineTo(tx + 2.5, y + 14); ctx.closePath(); ctx.fill(); ctx.stroke(); }   // 龙牙（混凝土锥）
  } else if (k === 'hq') {
    ctx.setLineDash([px(5), px(2)]); ctx.strokeRect(x - 28, y - 20, 56, 40); ctx.setLineDash([]);
    ctx.fillStyle = '#6e6a62'; ctx.fillRect(x - 6, y + 18, 12, 4); ctx.fillStyle = '#7d8064';
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
  if (!R.m3d) flag(ctx, x + (k === 'bridge' ? 0 : 22), y - (k === 'bridge' ? 6 : 8), p.owner, p.vp, p.prog, time);
  drawStructureMarks(ctx, p, x, y, time);
}
// 占领进度弧、占领半径（争夺中或悬停时）
function drawStructureMarks(ctx, p, x, y, time) {
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

// 俯视单兵（静态姿势：炮组等；小组里的士兵带整套动作，见 manim.js）——远看只画一个点
function drawMan(ctx, x0, y0, a, role, col, det, side, prone) {
  if (!det) { const d = Math.max(px(1.8), 1.4); ctx.fillStyle = col; ctx.fillRect(x0 - d / 2, y0 - d / 2, d, d); return; }
  manDraw(ctx, x0, y0, a, role, col, side, prone ? { ...MAN_IDLE, prone: true } : null);
}
