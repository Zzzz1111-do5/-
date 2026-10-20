'use strict';
// 地图生成（二）：暗礁、城镇、道路与桥梁、渡口、据点
function finishMap(r, cAt, headland) {
  const { type, beaches, mouthX, rx } = TER;
  const rxAt = y => rx[clamp(Math.floor(y / CELL), 0, GH - 1)];
  const eachCell = (x, y, rad, fn) => {
    for (let gy = Math.max(0, Math.floor((y - rad) / CELL)); gy <= Math.min(GH - 1, Math.ceil((y + rad) / CELL)); gy++)
      for (let gx = Math.max(0, Math.floor((x - rad) / CELL)); gx <= Math.min(GW - 1, Math.ceil((x + rad) / CELL)); gx++) {
        const px = gx * CELL + 5, py = gy * CELL + 5;
        if (dist(px, py, x, y) < rad) fn(gy * GW + gx, px, py);
      }
  };

  // 暗礁：海图上已标出，舰船不可通过
  for (let k = 0; k < 5; k++) {
    const x = 80 + r() * (W - 160), y = Math.min(cAt(x) + 85 + r() * 150, 830), rad = 20 + r() * 26;
    eachCell(x, y, rad, i => { if (isWater(type[i]) && r() < .85) type[i] = T.REEF; });
  }

  // 城镇：河口渔村、山脊后的镇子、北部指挥所
  const awayRiver = (p, gap) => { const d = p.x - rxAt(p.y); if (Math.abs(d) < gap) p.x += (d < 0 ? -1 : 1) * (gap - Math.abs(d) + 10); return p; };
  const side = r() < .5 ? -1 : 1, vx = mouthX + side * (80 + r() * 30);
  const village = awayRiver({ x: vx, y: cAt(vx) - 85 }, 50);
  const tx = W / 2 + (r() - .5) * 420;
  const town = awayRiver({ x: tx, y: cAt(tx) - 340 }, 85);
  const hq = awayRiver({ x: (TER.massif.x < W / 2 ? W * .7 : W * .3) + (r() - .5) * 160, y: 95 + r() * 30 }, 70);
  const blob = (p, rad, dens) => eachCell(p.x, p.y, rad, i => {
    const t = type[i];
    if (!isWater(t) && t !== T.RIVER && t !== T.BEACH && t !== T.CLIFF && r() < dens) type[i] = T.TOWN;
  });
  blob(village, 36, .75); blob(town, 58, .8); blob(hq, 46, .8);
  TER.towns = { village, town, hq };

  // 道路：海岸公路、各滩头出口路、通往镇子和指挥所的主干道；跨河处成为桥梁
  const roadY = new Float32Array(GW + 1);
  for (let k = 0; k <= GW; k++) {
    let s = 0, n = 0;
    for (let dx = -80; dx <= 80; dx += 10) { s += cAt(k * CELL + dx); n++; }
    roadY[k] = s / n - 120;
  }
  const rdY = x => roadY[clamp(Math.round(x / CELL), 0, GW)];
  TER.roadY = roadY;
  const bridgeCells = [];
  const road = pts => {
    for (let k = 1; k < pts.length; k++) {
      const [x0, y0] = pts[k - 1], [x1, y1] = pts[k], n = Math.ceil(dist(x0, y0, x1, y1) / 4);
      for (let s = 0; s <= n; s++) {
        const i = ci(lerp(x0, x1, s / n), lerp(y0, y1, s / n)), t = type[i];
        if (t === T.RIVER) { type[i] = T.BRIDGE; bridgeCells.push(i); }
        else if (!isWater(t) && t !== T.TOWN && t !== T.BEACH && t !== T.BRIDGE && t !== T.CLIFF) type[i] = T.ROAD;
      }
    }
  };
  const coastal = [];
  for (let x = 10; x <= W - 10; x += 40) coastal.push([x, rdY(x)]);
  road(coastal);
  for (const b of beaches) road([[b.cx, cAt(b.cx) - 20], [b.cx, rdY(b.cx)]]);
  const crossX = town.x;
  road([[crossX, rdY(crossX)], [town.x + (r() - .5) * 40, lerp(rdY(crossX), town.y, .5)], [town.x, town.y],
    [lerp(town.x, hq.x, .5) + (r() - .5) * 120, lerp(town.y, hq.y, .5)], [hq.x, hq.y]]);
  road([[village.x, village.y], [village.x, rdY(village.x)]]);

  const bridges = [];
  for (const i of bridgeCells) {
    const x = cellCX(i), y = cellCY(i), b = bridges.find(b => dist(b.x, b.y, x, y) < 40);
    if (b) { b.n++; b.x += (x - b.x) / b.n; b.y += (y - b.y) / b.n; } else bridges.push({ x, y, n: 1 });
  }
  bridges.sort((a, b) => b.y - a.y);
  TER.bridges = bridges;

  // 渡口：避开桥梁的一段浅水
  const fy = clamp(rdY(mouthX) - 150 - r() * 130, 120, H - 100), fgy = Math.floor(fy / CELL);
  if (!bridges.some(b => Math.abs(b.y - fy) < 90)) {
    for (let gy = fgy; gy <= fgy + 1; gy++) for (let gx = 0; gx < GW; gx++) if (type[gy * GW + gx] === T.RIVER) type[gy * GW + gx] = T.FORD;
    TER.ford = { x: rx[fgy], y: fgy * CELL + 10 };
  }

  // 据点：滩头出口优先，其余按重要性，彼此至少相隔 70
  const P = [];
  const add = (key, name, x, y, vp) => { if (!P.some(p => dist(p.x, p.y, x, y) < 70)) P.push({ key, name, x, y, vp }); };
  beaches.forEach((b, i) => add('E' + (i + 1), b.name + '出口', b.cx, cAt(b.cx) - 45, 1));
  add('HQ', '指挥所', hq.x, hq.y, 3);
  add('TW', '镇中心', town.x, town.y, 2);
  let best = null, be = -1;
  for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
    const x = gx * CELL + 5, y = gy * CELL + 5, i = gy * GW + gx, d = cAt(x) - y;
    if (x > W * .2 && x < W * .8 && d > 150 && d < 420 && type[i] !== T.TOWN && TER.elev[i] > be && Math.abs(x - rxAt(y)) > 60) { be = TER.elev[i]; best = { x, y }; }
  }
  if (best) add('RD', '雷达站', best.x, best.y, 2);
  best = null; be = -1;
  for (let x = 40; x < W - 40; x += 10) {
    const y = cAt(x) - 40, e = TER.elev[ci(x, y)];
    if (headland(x) && e > be) { be = e; best = { x, y }; }
  }
  if (best) add('BT', '岸防炮台', best.x, best.y, 2);
  if (bridges[0]) add('B1', '海岸公路桥', bridges[0].x, bridges[0].y, 2);
  if (bridges[1]) add('B2', '北桥', bridges[1].x, bridges[1].y, 2);
  add('XR', '十字路口', crossX, rdY(crossX), 1);
  add('VL', '渔村', village.x, village.y, 1);
  if (TER.ford) add('FD', '渡口', TER.ford.x, TER.ford.y, 1);
  TER.points = P;
}
