'use strict';
// 渲染（二）：工事、烟幕、补给/增援线、据点、敌我单位
// 舰船为俯视剪影（见 ships.js）；小组远看为楔形三点（屏幕尺寸固定），近看为世界尺寸的单兵小人；红色 = 敌方（仅视野内或已标定）
const MO = [[0, -4.6], [-4.6, 3.4], [4.6, 3.4]];   // 三人组成三角（世界单位；小人约 4 单位宽，彼此留空）

// 战壕、铁丝网、雷区、障碍物（real.js drawFortsReal）
function drawForts(time) { drawFortsReal(R.ctx, time); }

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
    if (!R.m3d) {   // 3D：滩头补给站是立体模型（v3units.js v3mDepot）
      ctx.strokeRect(L.x - 5, L.y - 5, 10, 10);
      ctx.beginPath(); ctx.moveTo(L.x - 3, L.y); ctx.lineTo(L.x + 3, L.y); ctx.moveTo(L.x, L.y - 3); ctx.lineTo(L.x, L.y + 3); ctx.stroke();
    }
    if (L.connected && hoverNear(L.x, L.y, 12)) { ctx.strokeStyle = rgba(COL.g, .25); ctx.lineWidth = px(1); ctx.setLineDash([px(2), px(5)]); ctx.beginPath(); ctx.arc(L.x, L.y, 200, 0, 7); ctx.stroke(); ctx.setLineDash([]); }
  }
  ctx.lineWidth = px(1); ctx.setLineDash([px(2), px(6)]); ctx.strokeStyle = rgba(COL.intel, .3);
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
  else if (kind === 'typhon') { ctx.rect(x - 9, y - 4, 18, 8); ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.rect(x - 7.5, y - 2.6, 5.2, 5.2); ctx.moveTo(x - 4.9, y - 2.6); ctx.lineTo(x - 4.9, y + 2.6); ctx.moveTo(x - 7.5, y); ctx.lineTo(x - 2.3, y); ctx.moveTo(x, y - 2.6); ctx.lineTo(x + 7.5, y - 2.6); ctx.moveTo(x, y + 2.6); ctx.lineTo(x + 7.5, y + 2.6); }   // 堤丰：拖车 + 四联装发射箱（2×2 单元格）
  else if (kind === 'tel') { ctx.rect(x - 7, y - 2.5, 14, 5); ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x - 4, y - 2.5); ctx.lineTo(x + 6, y - 10); ctx.moveTo(x - 7, y - 2.5); ctx.lineTo(x - 7, y - 5); }   // 发射车：车体 + 斜立的起竖臂
  else if (kind === 'ascm') { ctx.rect(x - 8, y - 3, 16, 6); ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x - 6, y - 4); ctx.lineTo(x + 8, y - 10); ctx.moveTo(x - 6, y - .5); ctx.lineTo(x + 8, y - 6.5); }   // 岸舰导弹：两根平行发射筒
  else if (kind === 'airfield') {   // 野战机场：40×8 跑道 + 虚线中线
    ctx.rect(x - 20, y - 4, 40, 8); ctx.fill(); ctx.stroke();
    const ld = ctx.getLineDash(); ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(x - 17, y); ctx.lineTo(x + 17, y); ctx.stroke(); ctx.setLineDash(ld); ctx.beginPath();
  }
  else { ctx.arc(x, y, 7, 0, 7); ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x - 4, y - 4); ctx.lineTo(x + 4, y + 4); ctx.moveTo(x + 4, y - 4); ctx.lineTo(x - 4, y + 4); }
  ctx.stroke();
}

// 画面上的小组朝向：向 faceOf 平滑转过去（每帧最多约 0.2 弧度），不随寻路的每一步左右乱转
const TFACE = new WeakMap();
// 画面朝向：按真实时间限制转身速度（每秒约 3 弧度），与帧率无关；一次只在同一帧算一遍（2D、3D、贴图多次调用不重复转）
function faceDraw(q) {
  const f = faceOf(q), o = TFACE.get(q), now = typeof performance === 'object' ? performance.now() / 1000 : 0;
  if (!o || !isFinite(o.a)) { TFACE.set(q, { a: f, t: now }); return f; }
  const dt = clamp(now - o.t, 0, .1);
  if (dt > 0) { const d = Math.atan2(Math.sin(f - o.a), Math.cos(f - o.a)); o.a += clamp(d, -3 * dt, 3 * dt); o.t = now; }
  return o.a;
}
// 小组本体：远看（每格不足 10px）为楔形三点，点与间距按屏幕像素（随缩放略增），不会糊成一团；近看为世界尺寸的单兵小人
function drawTeamBody(ctx, q, f, col) {
  const c = Math.cos(f + 1.57), s = Math.sin(f + 1.57), n = q.men.length;
  if (R.fig) {
    const T = manTeam(q);   // 动作状态（manim.js）
    for (let i = 0; i < n; i++) {
      let mx = q.x + MO[i][0] * c - MO[i][1] * s, my = q.y + MO[i][0] * s + MO[i][1] * c;
      const bo = bldOut(mx, my, .5);   // 小人落在房子轮廓里：画在墙根
      if (bo) [mx, my] = bo;
      const kind = manKind(q, i, q.men[i]);
      manDraw(ctx, mx, my, f, kind, col, q.side, manAn(q, T, i, kind));
    }
    return;
  }
  const k = Math.max(1, px(2.3) / 4.6), d = px(clamp(1.5 + R.s, 1.8, 2.5));
  ctx.fillStyle = col;
  for (let i = 0; i < n; i++) ctx.fillRect(q.x + (MO[i][0] * c - MO[i][1] * s) * k - d / 2, q.y + (MO[i][0] * s + MO[i][1] * c) * k - d / 2, d, d);
}

// 压制：近看为小组下方的细琥珀条（长度 = 压制程度）；远看只在被压制住（≥60）时让三点转琥珀色（见调用处）
function supMark(ctx, q) {
  if (!R.fig || q.sup <= 25) return;
  ctx.fillStyle = rgba(COL.amber, .25); ctx.fillRect(q.x - 4.5, q.y + 7, 9, px(1.5));
  ctx.fillStyle = rgba(COL.amber, q.sup >= 60 ? .95 : .7); ctx.fillRect(q.x - 4.5, q.y + 7, 9 * Math.min(1, q.sup / 100), px(1.5));
}

function drawEnemies(time) {
  const ctx = R.ctx;
  if (typeof gunPits === 'function') gunPits(ctx);   // 空着的发射阵地（guns.js）
  ctx.lineWidth = px(1.4);
  for (const e of S.enemies) {
    if (e.kind === 'airfield' && typeof eaDrawBase === 'function' && eaOn()) continue;   // 野战机场按世界尺寸在 drawUnder 里画（eair.js）
    const vis = inVision(e.x, e.y);
    if (!vis && e.kx == null) continue;
    const x = vis ? e.x : e.kx, y = vis ? e.y : e.ky;
    if (!inView(x, y, 30)) continue;
    if (e.dead && R.m3d) continue;   // 3D：被毁阵地是立体残骸（v3units.js）
    if (e.dead && typeof gunModel === 'function' && gunModel(ctx, e, x, y, vis, time)) continue;   // 近看：炮位残骸（guns.js）
    if (e.dead) {
      ctx.strokeStyle = rgba(COL.enemy, .28); ctx.lineWidth = px(1.2);
      ctx.beginPath(); ctx.moveTo(x - 5, y - 5); ctx.lineTo(x + 5, y + 5); ctx.moveTo(x + 5, y - 5); ctx.lineTo(x - 5, y + 5); ctx.stroke();
      ctx.lineWidth = px(1.4);
      continue;
    }
    ctx.setLineDash(vis ? [] : [px(2), px(2)]);
    ctx.strokeStyle = rgba(COL.enemy, vis ? .95 : .45); ctx.fillStyle = vis ? 'rgba(30,4,10,.8)' : rgba(COL.enemy, .05);
    if (R.m3d) { /* 3D：阵地画成立体模型（v3units.js），贴图里只留血条、压制标记 */ }
    else if (!(typeof gunModel === 'function' && gunModel(ctx, e, x, y, vis, time))) enemyMark(ctx, e.kind, x, y);   // 近看：火炮建模（guns.js）
    ctx.setLineDash([]); ctx.lineWidth = px(1.4);
    if (vis && e.hp < e.maxhp) {   // 受损才显示血条
      const w = 16, yb = y + 12;
      ctx.fillStyle = rgba(COL.enemy, .2); ctx.fillRect(x - w / 2, yb, w, px(2));
      ctx.fillStyle = rgba(COL.enemy, .85); ctx.fillRect(x - w / 2, yb, w * Math.max(0, e.hp) / e.maxhp, px(2));
    }
    if (vis && e.sup > 40) {   // 被压制：上方一小段琥珀弧，不画整圈
      ctx.strokeStyle = rgba(COL.amber, .75); ctx.lineWidth = px(1.4);
      ctx.beginPath(); ctx.arc(x, y, 11 + px(2), -2.4, -.74); ctx.stroke();
    }
  }
  const agg = typeof hqAggHide === 'function';
  for (const q of S.teams) {
    if (q.side !== 'e' || !inView(q.x, q.y, 12)) continue;
    if (agg && !q.rc && hqAggHide('u', q.u)) continue;   // 远看：编进营的排画成分队符号（hq.js）
    if (inVision(q.x, q.y)) {
      if (!(R.m3d && R.m3dNear)) drawTeamBody(ctx, q, faceDraw(q), !R.fig && q.sup >= 60 ? rgba(COL.amber, .9) : COL.enemy);   // 3D 近看：步兵是立体小人
      supMark(ctx, q);
    } else if (q.seen && S.t - q.seen < 8) {   // 刚失去接触：淡出的小虚线菱形
      ctx.strokeStyle = rgba(COL.enemy, (1 - (S.t - q.seen) / 8) * .5); ctx.lineWidth = px(1); ctx.setLineDash([px(2), px(2)]);
      shape(ctx, q.sx, q.sy, Math.max(5, px(4)), 4, 0); ctx.stroke(); ctx.setLineDash([]);
    }
  }
}

function drawTeams(time) {
  const ctx = R.ctx;
  // 选中排的去向：每个排一条虚线（排中心 → 各组目标的中心）与小目标点，不再每组一条
  for (const u of S.units) {
    if (u.side !== 'p' || !isSel(u.id) || u.x == null) continue;
    const ts = teamsOf(u).filter(q => q.order.x != null && q.order.t !== 'hold');
    if (!ts.length) continue;
    const t = ts[0].order.t, tx = ts.reduce((a, q) => a + q.order.x, 0) / ts.length, ty = ts.reduce((a, q) => a + q.order.y, 0) / ts.length;
    if (dist(u.x, u.y, tx, ty) < 12) continue;
    const col = t === 'amove' || t === 'charge' ? COL.enemy : t === 'retreat' ? COL.amber : COL.sel;
    ctx.strokeStyle = rgba(col, .5); ctx.lineWidth = px(1); ctx.setLineDash([px(3), px(5)]);
    ctx.beginPath(); ctx.moveTo(u.x, u.y); ctx.lineTo(tx, ty); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = rgba(col, .6);
    const d = Math.max(px(2), 1.2);
    for (const q of ts) if (inView(q.order.x, q.order.y)) ctx.fillRect(q.order.x - d / 2, q.order.y - d / 2, d, d);
  }
  const agg = typeof hqAggHide === 'function';
  for (const q of S.teams) {
    if (q.side !== 'p' || !inView(q.x, q.y, 12)) continue;
    if (agg && !q.rc && hqAggHide('u', q.u)) continue;   // 远看：编进营的排画成分队符号（hq.js）
    const low = q.kind === 'inf' && q.ammo < 8, a = low ? .55 + .4 * Math.sin(time * 8) : 1, u = unitOf(q);
    const col = rgba(!R.fig && q.sup >= 60 ? COL.amber : u && u.state === 'rout' ? COL.amber : COL.g, a);
    if (!(R.m3d && R.m3dNear)) drawTeamBody(ctx, q, faceDraw(q), col);
    supMark(ctx, q);
    if (q.working) {   // 工兵作业：小小的旋转弧
      const r = R.fig ? 7.5 : px(5.5);
      ctx.strokeStyle = rgba(COL.amber, .8); ctx.lineWidth = px(1.1);
      ctx.beginPath(); ctx.arc(q.x, q.y, r, time * 4, time * 4 + 1.6); ctx.stroke();
    }
  }
}

// drawShips / drawDD / drawBoat：舰船俯视剪影已移至 ships.js
