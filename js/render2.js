'use strict';
// 渲染（二）：各类实体。三角形 = 登陆舰，五边形 = 驱逐舰，V 形 = 飞机，小方块 = 士兵
const MO = [[0, -3.2], [-3.2, 2.4], [3.2, 2.4]];

function drawVisionRings(time) {
  const ctx = R.ctx;
  ctx.lineWidth = px(1); ctx.setLineDash([px(3), px(5)]); ctx.lineDashOffset = -time * px(8);
  ctx.strokeStyle = rgba(COL.g, .22);
  for (const q of S.squads) if (q.side === 'p' && q.men.includes('radio')) { ctx.beginPath(); ctx.arc(q.x, q.y, 95, 0, 7); ctx.stroke(); }
  ctx.setLineDash([]); ctx.lineDashOffset = 0;
}

function drawLines(time) {
  const ctx = R.ctx;
  for (const L of S.supply) {
    ctx.lineWidth = px(1.6);
    for (const g of L.segs) {
      ctx.setLineDash(g.ok ? [px(7), px(4)] : [px(2), px(5)]);
      ctx.strokeStyle = g.ok ? rgba(COL.g, .55) : rgba(COL.enemy, .35 + .3 * Math.sin(time * 9));
      ctx.beginPath(); ctx.moveTo(g.x0, g.y0); ctx.lineTo(g.x1, g.y1); ctx.stroke();
      if (!g.ok && g.rep > 0) {
        ctx.setLineDash([]); ctx.strokeStyle = COL.amber;
        ctx.beginPath(); ctx.arc((g.x0 + g.x1) / 2, (g.y0 + g.y1) / 2, 7, -Math.PI / 2, -Math.PI / 2 + g.rep * Math.PI * 2); ctx.stroke();
      }
    }
    ctx.setLineDash([]);
    const a = L.segs[0], z = L.segs[L.segs.length - 1];
    if (L.connected) for (let k = 0; k < 4; k++) {
      const u = (time * .22 + k / 4) % 1;
      ctx.fillStyle = rgba(COL.g, .9);
      ctx.fillRect(lerp(z.x1, a.x0, u) - px(1.5), lerp(z.y1, a.y0, u) - px(1.5), px(3), px(3));
    }
    ctx.strokeStyle = rgba(COL.g, L.connected ? .9 : .4); ctx.lineWidth = px(1.4);
    ctx.strokeRect(L.x - 5, L.y - 5, 10, 10);
    ctx.beginPath(); ctx.moveTo(L.x - 3, L.y); ctx.lineTo(L.x + 3, L.y); ctx.moveTo(L.x, L.y - 3); ctx.lineTo(L.x, L.y + 3); ctx.stroke();
    if (L.connected) { ctx.strokeStyle = rgba(COL.g, .07); ctx.beginPath(); ctx.arc(L.x, L.y, 170, 0, 7); ctx.stroke(); }
  }
  ctx.lineWidth = px(1.2); ctx.setLineDash([px(2), px(6)]);
  for (const L of S.rlines) {
    ctx.strokeStyle = rgba(COL.intel, .45);
    ctx.beginPath(); ctx.moveTo(L.x0, L.y0); ctx.lineTo(L.x1, L.y1); ctx.stroke();
  }
  ctx.setLineDash([]);
  for (const b of S.boats) {
    const L = S.rlines.find(l => l.id === b.line);
    ctx.fillStyle = rgba(COL.intel, .9);
    shape(ctx, b.x, b.y, 4.5, 3, Math.atan2(L.y1 - L.y0, L.x1 - L.x0)); ctx.fill();
  }
}

function drawObjectives(time) {
  const ctx = R.ctx;
  for (const o of S.objectives) {
    const col = o.owner === 'p' ? COL.g : COL.enemy;
    ctx.lineWidth = px(1.5); ctx.strokeStyle = rgba(col, .85); ctx.fillStyle = rgba(col, .08);
    shape(ctx, o.x, o.y, 15, 6, Math.PI / 6); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = rgba(col, .2); ctx.setLineDash([px(2), px(4)]);
    ctx.beginPath(); ctx.arc(o.x, o.y, 45, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    if (o.prog > 0 && o.prog < 1 || o.contested) {
      ctx.strokeStyle = o.contested ? rgba(COL.amber, .5 + .5 * Math.sin(time * 8)) : COL.g; ctx.lineWidth = px(2.5);
      ctx.beginPath(); ctx.arc(o.x, o.y, 21, -Math.PI / 2, -Math.PI / 2 + o.prog * Math.PI * 2); ctx.stroke();
    }
  }
}

function drawEnemyMark(ctx, e) {
  if (e.kind === 'bunker') {
    ctx.beginPath(); ctx.rect(e.x - 6, e.y - 6, 12, 12); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(e.x - 4, e.y + 2); ctx.lineTo(e.x + 4, e.y + 2); ctx.stroke();
  } else if (e.kind === 'arty') {
    shape(ctx, e.x, e.y, 8, 4, 0); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(e.x, e.y + 14); ctx.stroke();
  } else {
    ctx.beginPath(); ctx.arc(e.x, e.y, 7, 0, 7); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(e.x - 4, e.y - 4); ctx.lineTo(e.x + 4, e.y + 4); ctx.moveTo(e.x + 4, e.y - 4); ctx.lineTo(e.x - 4, e.y + 4); ctx.stroke();
  }
}

function drawEnemies() {
  const ctx = R.ctx;
  ctx.lineWidth = px(1.5);
  for (const e of S.enemies) {
    const vis = inVision(e.x, e.y);
    if (!vis && e.kx == null) continue;
    // 视野外只画最后一次标定的位置（目标可能已经转移）
    const m = vis ? e : { kind: e.kind, x: e.kx, y: e.ky };
    if (e.dead) {
      ctx.strokeStyle = rgba(COL.enemy, .3);
      ctx.beginPath(); ctx.moveTo(e.x - 5, e.y - 5); ctx.lineTo(e.x + 5, e.y + 5); ctx.moveTo(e.x + 5, e.y - 5); ctx.lineTo(e.x - 5, e.y + 5); ctx.stroke();
      continue;
    }
    ctx.setLineDash(vis ? [] : [px(2), px(2)]);
    ctx.strokeStyle = rgba(COL.enemy, vis ? 1 : .5); ctx.fillStyle = rgba(COL.enemy, vis ? .2 : .05);
    drawEnemyMark(ctx, m);
    ctx.setLineDash([]);
    if (vis) { ctx.fillStyle = rgba(COL.enemy, .8); ctx.fillRect(e.x - 8, e.y + 11, 16 * e.hp / e.maxhp, px(2)); }
  }
  for (const q of S.squads) {
    if (q.side !== 'e') continue;
    const vis = inVision(q.x, q.y);
    if (vis) {
      ctx.fillStyle = COL.enemy;
      q.men.forEach((m, i) => ctx.fillRect(q.x + MO[i][0] - 1.6, q.y + MO[i][1] - 1.6, 3.2, 3.2));
    } else if (q.seen && S.t - q.seen < 8) {
      ctx.strokeStyle = rgba(COL.enemy, (1 - (S.t - q.seen) / 8) * .6); ctx.lineWidth = px(1);
      ctx.strokeRect(q.sx - 6, q.sy - 6, 12, 12);
    }
  }
}

function drawSquads(time) {
  const ctx = R.ctx;
  for (const q of S.squads) {
    if (q.side !== 'p') continue;
    const low = q.kind === 'inf' && q.ammo < 6, a = low ? .45 + .45 * Math.sin(time * 10) : 1;
    q.men.forEach((m, i) => {
      const x = q.x + MO[i][0], y = q.y + MO[i][1];
      if (m === 'eng') {
        ctx.strokeStyle = rgba(COL.g, a); ctx.lineWidth = px(1.2);
        ctx.beginPath(); ctx.arc(x, y, 1.9, 0, 7); ctx.stroke();
      } else { ctx.fillStyle = rgba(COL.g, a); ctx.fillRect(x - 1.6, y - 1.6, 3.2, 3.2); }
      if (m === 'radio') {
        ctx.strokeStyle = rgba(COL.g, .25 + .25 * Math.sin(time * 3 + q.id)); ctx.lineWidth = px(1);
        ctx.beginPath(); ctx.arc(x, y, 5, 0, 7); ctx.stroke();
      }
    });
    if (q.working) {
      ctx.strokeStyle = COL.amber; ctx.lineWidth = px(1.4);
      ctx.beginPath(); ctx.arc(q.x, q.y, 8, time * 4, time * 4 + 2); ctx.stroke();
    }
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
    const sel = S.sel.includes(s.id), beached = s.state === 'beached';
    if (s.state === 'move') {
      ctx.strokeStyle = sel ? rgba(COL.sel, .7) : rgba(COL.g, .2); ctx.lineWidth = px(1); ctx.setLineDash([px(4), px(4)]);
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.tx, s.ty); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.lineWidth = px(1.6);
    ctx.strokeStyle = rgba(COL.g, beached ? .5 : 1); ctx.fillStyle = rgba(COL.g, beached ? .06 : .15);
    shape(ctx, s.x, s.y, 10, 3, s.heading); ctx.fill(); ctx.stroke();
    if (s.kind === 'supply') { ctx.fillStyle = rgba(COL.g, beached ? .5 : 1); shape(ctx, s.x, s.y, 3.6, 3, s.heading); ctx.fill(); }
    if (s.state === 'unloading') {
      ctx.strokeStyle = COL.g; ctx.lineWidth = px(2);
      ctx.beginPath(); ctx.arc(s.x, s.y, 15, -Math.PI / 2, -Math.PI / 2 + s.ut / 2.5 * Math.PI * 2); ctx.stroke();
    }
    if (sel) {
      ctx.strokeStyle = COL.sel; ctx.lineWidth = px(1.6);
      for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        ctx.beginPath(); ctx.moveTo(s.x + dx * 15, s.y + dy * 9); ctx.lineTo(s.x + dx * 15, s.y + dy * 15); ctx.lineTo(s.x + dx * 9, s.y + dy * 15); ctx.stroke();
      }
    }
    if (!beached) for (let i = 0; i < s.maxhp; i++) {
      ctx.fillStyle = rgba(s.hp > 2 ? COL.g : COL.enemy, s.hp >= i + 1 ? .9 : .15);
      ctx.fillRect(s.x - 9 + i * 3.2, s.y + 13, 2.2, 2.2);
    }
  }
}

function drawDestroyer(time) {
  const ctx = R.ctx, D = S.destroyer;
  if (D.state === 'sunk') {
    ctx.strokeStyle = rgba(COL.g, .25); ctx.lineWidth = px(1); ctx.setLineDash([px(2), px(3)]);
    shape(ctx, D.x, D.y, 13, 5, -Math.PI / 2); ctx.stroke(); ctx.setLineDash([]);
    return;
  }
  const col = D.state === 'repair' ? COL.amber : COL.g;
  ctx.lineWidth = px(1.8); ctx.strokeStyle = col; ctx.fillStyle = rgba(col, .15);
  shape(ctx, D.x, D.y, 13, 5, -Math.PI / 2); ctx.fill(); ctx.stroke();
  ctx.lineWidth = px(1.2); shape(ctx, D.x, D.y, 5.5, 5, -Math.PI / 2); ctx.stroke();
  ctx.lineWidth = px(2.2);
  if (D.state === 'repair') {
    ctx.beginPath(); ctx.arc(D.x, D.y, 19, -Math.PI / 2, -Math.PI / 2 + D.repairT / D.repairDur * Math.PI * 2); ctx.stroke();
  } else if (D.cool > 0) {
    ctx.strokeStyle = rgba(COL.g, .5);
    ctx.beginPath(); ctx.arc(D.x, D.y, 19, -Math.PI / 2, -Math.PI / 2 + (1 - D.cool / 5) * Math.PI * 2); ctx.stroke();
  }
  if (S.t < D.exposedUntil) {
    ctx.strokeStyle = rgba(COL.enemy, .5 + .5 * Math.sin(time * 12)); ctx.lineWidth = px(1.5);
    ctx.beginPath(); ctx.arc(D.x, D.y, 26, 0, 7); ctx.stroke();
  }
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = rgba(col, D.hull > i ? .95 : .15);
    shape(ctx, D.x - 8 + i * 8, D.y + 22, 3, 5, -Math.PI / 2); ctx.fill();
  }
}
