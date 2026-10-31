'use strict';
// 爆炸反应装甲（vehicles.js vehDamage 先过 eraHit）：就是模型上原有的那些块（models.js RLE：99A、96B、15 式车体首上和炮塔正面的块，
//   M1A1 / M1A2 裙板上 TUSK 的 ARAT 块），按块记（v.era.h / v.era.t：车体、炮塔上已经炸掉的块号）。炸掉的块在 2D 贴图上画成焦黑的空位（rlEraUsed），
//   3D 里那块从模型上消失（v3g.js V3G_ERA；3D 模型上本来就有块的只有 M1A1，96 式模型本身没挂反应装甲）。
//   来弹打在车体或炮塔迎弹那一面的某一点（瞄着中间：横向、高度都是三角分布）：那一点上正好有块、块还在 → 起爆，把金属射流炸散；
//   块已经炸掉了、或者打在没挂块的地方（首下、履带、防盾、侧后）→ 本体装甲硬扛。
//   单装药破甲弹（火箭筒、无后坐力炮，src 'at'）挡下九成多；坦克炮的穿甲弹（'ap'）只有重型反应装甲（99A）能削掉三成，那块也炸掉，轻型的不会被白白引爆；
//   攻顶导弹（'top'、'atgm'）打车顶，块帮不上
function eraOf(v) {
  if (v.era === undefined || (v.era && !Array.isArray(v.era.h))) {   // 旧存档里的 v.era 是按面计数的，换成按块记
    const M = typeof rlModelOf === 'function' ? rlModelOf(v) : null;
    v.era = M && M.era ? { h: [], t: [] } : null;
  }
  return v.era;
}
// 返回反应装甲挡过以后还剩多少毁伤
function eraHit(v, dmg, pen, sx, sy, src) {
  if ((src !== 'at' && src !== 'ap') || sx == null || v.dead || typeof rlEraBlocks !== 'function') return dmg;
  const E = eraOf(v), M = E && rlModelOf(v), R = M && M.era;
  if (!R || (src === 'ap' && !R.heavy)) return dmg;
  const part = Math.random() < .5 ? 't' : 'h', tur = part === 't';   // 一半打在炮塔上、一半打在车体上（炮塔上没挂块的，打在炮塔上就是硬扛）
  if (!R[part]) return dmg;
  const a = Math.atan2(sy - v.y, sx - v.x), ref = tur ? v.aim ?? v.heading : v.heading, rel = a - ref, d = [Math.cos(rel), Math.sin(rel)], n = [-d[1], d[0]];   // d：在车体 / 炮塔坐标里朝来弹方向
  const [L, B] = tur ? R.td || [4, 3.2] : [M.L, M.B], W = (L * Math.abs(d[1]) + B * Math.abs(d[0])) / 2;   // 迎弹面半宽
  const s = (Math.random() + Math.random() - 1) * W, z = (Math.random() + Math.random()) / 2;   // 打在迎弹面上哪一点：瞄着中间，横向、高度都是三角分布
  const BL = rlEraBlocks(M, part);
  let hit = -1, best = -1e9;
  BL.forEach((b, i) => {   // 这一点上朝着来弹的块，取最靠外的那块
    if (Math.cos(rel - b.f) < .34 || z < b.z[0] || z > b.z[1]) return;
    let lo = 1e9, hi = -1e9;
    for (const p of b.P) { const u = p[0] * n[0] + p[1] * n[1]; lo = Math.min(lo, u); hi = Math.max(hi, u); }
    const dd = b.c[0] * d[0] + b.c[1] * d[1];
    if (s >= lo && s <= hi && dd > best) { best = dd; hit = i; }
  });
  const U = E[part];
  if (hit < 0 || U.includes(hit)) return dmg;   // 没打在块上，或者这块已经炸掉了
  U.push(hit);
  // 起爆的火光：块在世界里的位置（模型米 → 游戏尺寸）
  const b = BL[hit], k = typeof vehSp === 'function' ? vehSp(v).len / M.L : 1, rot = (x, y, h) => [x * Math.cos(h) - y * Math.sin(h), x * Math.sin(h) + y * Math.cos(h)];
  let [fx, fy] = rot(b.c[0] * k, b.c[1] * k, ref);
  if (tur) { const [ox, oy] = rot(M.tur.x * k, (M.tur.y || 0) * k, v.heading); fx += ox; fy += oy; }
  S.fx.push({ kind: 'flash', x: v.x + fx, y: v.y + fy, r: 7, life: 0, max: .35, side: v.side });
  if (v.side === 'p') {
    const left = BL.length - U.length, where = tur ? '炮塔正面' : b.f === 0 ? '首上' : '车体';
    log(`${vehName(v)}${where}的反应装甲炸开一块，${src === 'ap' ? '削弱了这发穿甲弹' : '挡住了这发破甲弹'}，${tur ? '炮塔' : '车体'}上还剩 ${left} 块`, 'info', 'era' + v.id, 6, v);
  }
  return dmg * (src === 'ap' ? .7 : .08);
}
