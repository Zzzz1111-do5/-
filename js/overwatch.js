'use strict';
// 车辆射击阵地（装甲掩护）：营在坚守、展开、待机时，坦克、突击炮、步战车、侦察车不死守队形槽位，在槽位附近（前后左右 60 米内）找一处看得出去的阵地——
//   沿营的正面左右 ±35° 五条视线，从车前 SPOT_EDGE 米（林缘不算遮挡，spot.js）往外看到 OW.far 米，看得越远越好、离槽位越近越好，
//   自己背靠树林、房子（林缘射击阵地，车身有遮蔽）再加一点分；不和本营别的车挤在 OW.gap 米内——按条令车间距 45 米以上（hq.js regPltOff 排内 48–55 米、
//   theater.js TH.vgap 60 米），横向最多挪 25 米：射击阵地只在原来疏开的位置附近找，不把疏开的车又挤到一起
//   林子深处的车看不见外面，几公里的热像、主炮都白搭：占好射界才能远远发现、压制敌人，掩护步兵冲击和防守（步兵在车前就从步兵头上打）
// 每辆车记 v.ow = { sx, sy 当时的槽位, x, y 选定的阵地, t }：槽位挪动 OW.move 米以上或 OW.keep 秒后重选
const OW = { far: 400, step: 20, fan: [-.6, -.3, 0, .3, .6], keep: 25, move: 30, gap: 45 };
const OW_CAND = [[0, 0], [20, 0], [40, 0], [60, 0], [-20, 0], [0, 15], [0, -15], [0, 25], [0, -25], [20, 25], [20, -25], [40, 25], [40, -25], [-20, 25], [-20, -25]];
// 哪些车要占射界：直瞄火炮、机枪 / 机关炮的车（间瞄的自行火炮、防空车不用）
const owWants = v => { const sp = vehSp(v); return !(sp.gun && (sp.gun.ind || sp.gun.flame)) && !sp.aa && !!(sp.gun || sp.mg); };
// (x, y) 朝 a 方向看得多远（五条视线的平均，0–1）：碰到高过眼睛的树林、房子、悬崖就停；地面起伏不算挡（山坡本身看得见）
function owView(x, y, a) {
  const eye = VIS_G[ci(x, y)] + .3;
  let sum = 0;
  for (const da of OW.fan) {
    const ux = Math.cos(a + da), uy = Math.sin(a + da);
    let reach = OW.far;
    for (let r = SPOT_EDGE + OW.step; r <= OW.far; r += OW.step) {
      const px = x + ux * r, py = y + uy * r;
      if (px < 0 || py < 0 || px >= W || py >= H) { reach = r; break; }
      const i = ci(px, py);
      if (VIS_B[i] - VIS_G[i] > .3 && VIS_B[i] > eye) { reach = r; break; }
    }
    sum += reach / OW.far;
  }
  return sum / OW.fan.length;
}
// 车 v 在槽位 (sx, sy) 附近的射击阵地
function owSpot(G, v, sx, sy) {
  if (!owWants(v) || typeof VIS_G === 'undefined' || !VIS_G) return [sx, sy];
  const o = v.ow;
  if (o && dist(o.sx, o.sy, sx, sy) < OW.move && S.t - o.t < OW.keep) return [o.x, o.y];
  const cls = vehCls(v, sx, sy), lab = compOf(cls), home = lab[ci(sx, sy)] || lab[ci(v.x, v.y)];
  const fx = Math.cos(G.face), fy = Math.sin(G.face), mates = bgVehs(G).filter(m => m !== v).map(m => m.ow && S.t - m.ow.t < OW.keep ? [m.ow.x, m.ow.y] : [m.x, m.y]);   // 别的车：选好了阵地的按阵地，没选的按现在的位置
  let best = [sx, sy], bs = -1e9;
  for (const [f, l] of OW_CAND) {
    const x = clamp(sx + fx * f - fy * l, 15, W - 15), y = clamp(sy + fy * f + fx * l, 15, H - 15), i = ci(x, y);
    if (!vehPass(x, y, cls) || (home && lab[i] !== home) || TER.type[i] === T.RIVER) continue;
    if (f !== 0 || l !== 0 ? mates.some(m => dist(m[0], m[1], x, y) < OW.gap) : false) continue;   // 原位置（槽位本身已按条令疏开）总可以选
    const sc = owView(x, y, G.face) - Math.hypot(f, l) / 250 + (VIS_B[i] - VIS_G[i] > .3 ? .08 : 0);
    if (sc > bs) { bs = sc; best = [x, y]; }
  }
  v.ow = { sx: Math.round(sx), sy: Math.round(sy), x: Math.round(best[0]), y: Math.round(best[1]), t: S.t };
  return best;
}
