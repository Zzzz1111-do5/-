'use strict';
// 士兵喊话（固定机制，双方通用）：排、车组、舰艇自己的请求与报告不再占用指挥官通联，在当事单位头顶冒一句短话——
//   「请求火力支援！」「向东镇冲击！」「弹药告急！」「舰炮约 3 秒后到！」；完整的那句仍记在通联「详」档里（lv 2）。
//   气泡跟着单位走，显示 4 秒（最后 0.8 秒淡出）；同一单位同时只留一句，新的顶掉旧的；同一单位同一句 12 秒内不重复；
//   敌方的话只在那里看得见时显示（观战按所选视野）；几个气泡挤在一处时往上错开
// 指向：小组 / 排（各组中心）/ 车辆 / 舰艇 / 驱逐舰 S.dd / 战斗群（锚点）/ 坐标 {x, y}
// 状态（纯 JSON）：S.shouts = [{ key, ref, side, text, t0, dur }]，S.shK = { key|text: 上次时间 }
const SH = { dur: 4, fade: .8, rep: 12, max: 40, wrap: 13 };

function shRef(o) {
  if (!o || !S) return null;
  if (o === S.dd) return { k: 'dd' };
  if (o.men && S.teams.includes(o)) return { k: 't', id: o.id };
  if (Array.isArray(o.us) && Array.isArray(o.vs)) return { k: 'g', id: o.id };
  if (S.units.includes(o)) return { k: 'u', id: o.id };
  if (S.veh && S.veh.includes(o)) return { k: 'v', id: o.id };
  if (S.ships.includes(o)) return { k: 's', id: o.id };
  return isFinite(o.x) && isFinite(o.y) ? { k: 'p', x: Math.round(o.x), y: Math.round(o.y) } : null;
}
// 气泡的锚点（世界坐标）与离地高度；单位没了返回 null
function shPos(r) {
  if (r.k === 'p') return { x: r.x, y: r.y, h: 8 };
  if (r.k === 'dd') return S.dd && S.dd.state !== 'sunk' ? { x: S.dd.x, y: S.dd.y, h: 34 } : null;
  if (r.k === 't') { const q = S.teams.find(q => q.id === r.id); return q && q.men.length ? { x: q.x, y: q.y, h: 9 } : null; }
  if (r.k === 'u') {
    const u = UNIT_MAP.get(r.id), ts = u ? teamsOf(u).filter(q => q.men.length && !q.ride) : [];
    if (!ts.length) return null;
    return { x: ts.reduce((a, q) => a + q.x, 0) / ts.length, y: Math.min(...ts.map(q => q.y)), h: 9 };
  }
  if (r.k === 'v') { const v = vehById(r.id); return v && !v.dead ? { x: v.x, y: v.y, h: (vehSp(v).len || 10) * .7 } : null; }
  if (r.k === 's') { const s = S.ships.find(s => s.id === r.id); return s && alive(s) ? { x: s.x, y: s.y, h: 26 } : null; }
  if (r.k === 'g') { const G = (S.bgs || []).find(G => G.id === r.id); return G && !G.dead ? { x: G.ax, y: G.ay, h: 22 } : null; }
  return null;
}

// 喊一句：o 说话的单位，side 不填按单位所属；opts.delay 晚几秒冒出来，opts.dur 显示多久
function shout(o, text, opts) {
  if (!S || !o || !text) return false;
  const r = shRef(o);
  if (!r) return false;
  opts = opts || {};
  const side = opts.side || (o.side === 'e' ? 'e' : 'p'), key = r.k + (r.id ?? `${r.x}_${r.y}`);
  const K = S.shK && typeof S.shK === 'object' ? S.shK : (S.shK = {});
  if (S.t - (K[key + '|' + text] ?? -99) < SH.rep) return false;
  K[key + '|' + text] = S.t;
  const L = Array.isArray(S.shouts) ? S.shouts : (S.shouts = []);
  const t0 = S.t + Math.max(0, +opts.delay || 0);
  L.push({ key, ref: r, side, text: String(text), t0, dur: opts.dur || SH.dur });
  if (L.length > SH.max) L.splice(0, L.length - SH.max);
  return true;
}

// 同一单位只显示已冒出来的最新一句（延后冒出的那句冒出来时才顶掉前一句）
function shCur() {
  const cur = new Map();
  for (const m of S.shouts) if (m.t0 <= S.t && S.t < m.t0 + m.dur) { const o = cur.get(m.key); if (!o || m.t0 >= o.t0) cur.set(m.key, m); }
  return cur;
}
function shStep() {
  if (!S || !Array.isArray(S.shouts) || !S.shouts.length) return;
  const cur = shCur();
  S.shouts = S.shouts.filter(m => m.t0 > S.t || cur.get(m.key) === m);
  if (S.shK && (S.shKT = (S.shKT || 0) + 1) % 300 === 0) for (const k in S.shK) if (S.t - S.shK[k] > SH.rep) delete S.shK[k];   // 偶尔清掉过期的去重记录
}
HOOK.step.push(shStep);

// 断成两行（太长的在标点处断开；还长就截断加省略号）
function shLines(t) {
  if (t.length <= SH.wrap) return [t];
  let k = -1;
  for (let i = Math.min(t.length - 2, SH.wrap + 2); i >= 4; i--) if ('，、；：！？。—'.includes(t[i])) { k = i + 1; break; }
  if (k < 0) k = SH.wrap;
  const a = t.slice(0, k), b = t.slice(k);
  return [a, b.length > SH.wrap + 3 ? b.slice(0, SH.wrap + 2) + '…' : b];
}
// 画一个气泡：(x, y) 尾尖所在点，u = 一个屏幕像素合多少画布单位；used 已占的矩形（往上错开）
function shBubble(ctx, x, y, text, col, a, u, used) {
  const lines = shLines(text), fs = 10.5 * u, lh = 13 * u, padX = 5 * u, padY = 3.5 * u, tail = 5 * u;
  ctx.font = `${fs}px "IBM Plex Mono", "Noto Sans SC", monospace`;
  const w = Math.max(...lines.map(l => ctx.measureText(l).width)) + padX * 2, h = lines.length * lh + padY * 2;
  let by = y - tail - h;
  for (let k = 0; k < 4 && used.some(o => x - w / 2 < o[2] && x + w / 2 > o[0] && by < o[3] && by + h > o[1]); k++) by -= h + 2 * u;
  used.push([x - w / 2, by, x + w / 2, by + h]);
  const bx = x - w / 2, r = 3 * u;
  ctx.globalAlpha = a;
  ctx.beginPath();
  ctx.moveTo(bx + r, by); ctx.lineTo(bx + w - r, by); ctx.quadraticCurveTo(bx + w, by, bx + w, by + r); ctx.lineTo(bx + w, by + h - r); ctx.quadraticCurveTo(bx + w, by + h, bx + w - r, by + h);
  if (by + h >= y - tail - .5 * u) { ctx.lineTo(x + 4 * u, by + h); ctx.lineTo(x, y); ctx.lineTo(x - 4 * u, by + h); }   // 没被挤开时才画尾尖
  ctx.lineTo(bx + r, by + h); ctx.quadraticCurveTo(bx, by + h, bx, by + h - r); ctx.lineTo(bx, by + r); ctx.quadraticCurveTo(bx, by, bx + r, by); ctx.closePath();
  ctx.fillStyle = rgba(COL.bg, .9); ctx.fill();
  ctx.lineWidth = 1.2 * u; ctx.strokeStyle = rgba(col, .95); ctx.stroke();
  ctx.fillStyle = rgba(COL.text, 1); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  lines.forEach((l, i) => ctx.fillText(l, x, by + padY + lh * (i + .5)));
  ctx.globalAlpha = 1; ctx.textBaseline = 'alphabetic';
}
// 正在显示的气泡：[{ m, x, y, h, a }]（敌方的话看不见那里就不显示）
function shLive() {
  if (!S || !Array.isArray(S.shouts) || !S.shouts.length) return [];
  const out = [];
  for (const m of shCur().values()) {
    const p = shPos(m.ref);
    if (!p || (m.side === 'e' && !inVision(p.x, p.y))) continue;
    const left = m.t0 + m.dur - S.t, a = clamp(Math.min(left / SH.fade, (S.t - m.t0) / .15 + .2), 0, 1);
    out.push({ m, x: p.x, y: p.y, h: p.h, a });
  }
  return out;
}
// 平面地图（世界坐标）；3D 立体地图里由 view3d.js 调 shOverlay3D 画在屏幕上
function shDraw() {
  if (typeof V3 === 'object' && V3.drawing) return;
  const L = shLive();
  if (!L.length) return;
  const ctx = R.ctx, used = [];
  ctx.save();
  for (const o of L.sort((a, b) => b.y - a.y)) if (inView(o.x, o.y, 80)) shBubble(ctx, o.x, o.y - o.h - px(4), o.m.text, o.m.side === 'e' ? COL.enemy : COL.g, o.a, px(1), used);
  ctx.restore();
}
HOOK.drawTop.push(shDraw);
function shOverlay3D(ctx, proj) {
  const used = [];
  for (const o of shLive()) { const q = proj(o.x, o.y, o.h + 6); if (q && q.f < .8) shBubble(ctx, q.x, q.y, o.m.text, o.m.side === 'e' ? COL.enemy : COL.g, o.a * (1 - q.f), 1, used); }
}
