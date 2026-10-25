'use strict';
// 地图生成（二）：暗礁、城镇、道路与桥梁、渡口、据点
function finishMap(r, cAt, headland) {
  const { type, beaches, mouths, rivers } = TER;
  const eachCell = (x, y, rad, fn) => {
    for (let gy = Math.max(0, Math.floor((y - rad) / CELL)); gy <= Math.min(GH - 1, Math.ceil((y + rad) / CELL)); gy++)
      for (let gx = Math.max(0, Math.floor((x - rad) / CELL)); gx <= Math.min(GW - 1, Math.ceil((x + rad) / CELL)); gx++) {
        const px = gx * CELL + 5, py = gy * CELL + 5;
        if (dist(px, py, x, y) < rad) fn(gy * GW + gx, px, py);
      }
  };
  const riverGap = p => Math.min(...rivers.map((rv, k) => Math.abs(p.x - riverX(k, Math.floor(p.y / CELL)))));
  const awayRiver = (p, gap) => {
    for (let k = 0; k < rivers.length; k++) {
      const d = p.x - riverX(k, Math.floor(p.y / CELL));
      if (Math.abs(d) < gap) p.x += (d < 0 ? -1 : 1) * (gap - Math.abs(d) + 10);
    }
    p.x = clamp(p.x, 80, W - 80);
    return p;
  };

  // 暗礁：海图上已标出，舰船不可通过；不进入集结海域
  for (let k = 0; k < Math.round(10 * MAP_K * MAP_K); k++) {
    const x = 100 + r() * (W - 200), y = Math.min(cAt(x) + 120 + r() * 300 * MAP_K, STAGING_Y - 90), rad = 25 + r() * 28;
    eachCell(x, y, rad, i => { if (isWater(type[i]) && r() < .85) type[i] = T.REEF; });
  }

  // 城镇：河口渔村（每条河一个）、两个内陆镇子、北部指挥所；大地图在指挥所对侧纵深再加一个北镇
  const vills = mouths.map((m, k) => { const vx = m + (r() < .5 ? -1 : 1) * (90 + r() * 30); return awayRiver({ x: vx, y: cAt(vx) - 95 }, 60); });
  const t1x = W * (.25 + r() * .15), t2x = W * (.62 + r() * .15);
  const town1 = awayRiver({ x: t1x, y: cAt(t1x) - 560 * MAP_K }, 95), town2 = awayRiver({ x: t2x, y: cAt(t2x) - 520 * MAP_K }, 95);
  const hq = awayRiver({ x: (TER.massif.x < W / 2 ? W * .68 : W * .32) + (r() - .5) * 300 * MAP_K, y: 150 + r() * 70 * MAP_K }, 80);
  let town3 = null;
  if (MAP_K > 1.2) { const x3 = hq.x < W / 2 ? W * (.7 + r() * .1) : W * (.2 + r() * .1); town3 = awayRiver({ x: x3, y: clamp(cAt(x3) - 1000 * MAP_K, 180, cAt(x3) - 700) }, 95); }
  const blob = (p, rad, dens) => eachCell(p.x, p.y, rad, i => {
    const t = type[i];
    if (!isWater(t) && t !== T.RIVER && t !== T.BEACH && t !== T.CLIFF && r() < dens) type[i] = T.TOWN;
  });
  for (const v of vills) blob(v, 40, .75);
  blob(town1, 64, .8); blob(town2, 58, .8); blob(hq, 52, .82);
  if (town3) blob(town3, 56, .8);
  TER.towns = { vills, town1, town2, town3, hq };

  // 道路：海岸公路、滩头出口路、通往两个镇子与指挥所的主干道；跨河处成为桥梁
  const roadY = new Float32Array(GW + 1);
  for (let k = 0; k <= GW; k++) {
    let s = 0, n = 0;
    for (let dx = -120; dx <= 120; dx += 10) { s += cAt(k * CELL + dx); n++; }
    roadY[k] = s / n - 170;
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
  for (let x = 10; x <= W - 10; x += 50) coastal.push([x, rdY(x)]);
  road(coastal);
  for (const b of beaches) road([[b.cx, cAt(b.cx) - 22], [b.cx, rdY(b.cx)]]);
  const via = (a, b, k) => [lerp(a.x, b.x, .5) + (r() - .5) * k, lerp(a.y, b.y, .5)];
  road([[town1.x, rdY(town1.x)], [town1.x + (r() - .5) * 60, lerp(rdY(town1.x), town1.y, .5)], [town1.x, town1.y], via(town1, hq, 180), [hq.x, hq.y]]);
  road([[town2.x, rdY(town2.x)], [town2.x + (r() - .5) * 60, lerp(rdY(town2.x), town2.y, .5)], [town2.x, town2.y], via(town2, hq, 180), [hq.x, hq.y]]);
  road([[town1.x, town1.y], via(town1, town2, 100), [town2.x, town2.y]]);
  if (town3) {   // 北镇：接最近的镇子与指挥所
    const tn = dist(town3.x, town3.y, town1.x, town1.y) < dist(town3.x, town3.y, town2.x, town2.y) ? town1 : town2;
    road([[tn.x, tn.y], via(tn, town3, 160), [town3.x, town3.y]]);
    road([[town3.x, town3.y], via(town3, hq, 160), [hq.x, hq.y]]);
  }
  for (const v of vills) road([[v.x, v.y], [v.x, rdY(v.x)]]);

  const bridges = [];
  for (const i of bridgeCells) {
    const x = cellCX(i), y = cellCY(i), b = bridges.find(b => dist(b.x, b.y, x, y) < 50);
    if (b) { b.n++; b.x += (x - b.x) / b.n; b.y += (y - b.y) / b.n; } else bridges.push({ x, y, n: 1 });
  }
  bridges.sort((a, b) => b.y - a.y);
  TER.bridges = bridges;

  // 渡口：每条河一处，避开桥梁
  TER.fords = [];
  rivers.forEach((rv, k) => {
    for (let tries = 0; tries < 10; tries++) {
      const top = Math.max(rv.top, 120), fy = top + r() * (cAt(rv.mx) - 200 - top), fgy = Math.floor(fy / CELL);
      if (bridges.some(b => Math.abs(b.y - fy) < 140) || riverX(k, fgy) < 0) continue;
      for (let gy = fgy; gy <= fgy + 1; gy++) for (let gx = 0; gx < GW; gx++) if (type[gy * GW + gx] === T.RIVER && Math.abs(gx * CELL + 5 - riverX(k, gy)) < 20) type[gy * GW + gx] = T.FORD;
      TER.fords.push({ x: riverX(k, fgy), y: fgy * CELL + 10 });
      break;
    }
  });

  // 据点：滩头出口优先，其余按重要性，彼此至少相隔 90
  const P = [];
  const add = (key, name, x, y, vp) => { if (!P.some(p => dist(p.x, p.y, x, y) < 90)) P.push({ key, name, x, y, vp }); };
  beaches.forEach((b, i) => add('E' + (i + 1), b.name + '出口', b.cx, cAt(b.cx) - 50, 1));
  add('HQ', '指挥所', hq.x, hq.y, 3);
  add('T1', '西镇', town1.x, town1.y, 2);
  add('T2', '东镇', town2.x, town2.y, 2);
  if (town3) add('T3', '北镇', town3.x, town3.y, 2);
  let best = null, be = -1;
  for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
    const x = gx * CELL + 5, y = gy * CELL + 5, i = gy * GW + gx, d = cAt(x) - y;
    if (x > W * .2 && x < W * .8 && d > 250 * MAP_K && d < 650 * MAP_K && type[i] !== T.TOWN && TER.elev[i] > be && riverGap({ x, y }) > 80) { be = TER.elev[i]; best = { x, y }; }
  }
  if (best) add('RD', '雷达站', best.x, best.y, 2);
  const heads = [];
  for (let x = 60; x < W - 60; x += 10) if (headland(x)) heads.push({ x, y: cAt(x) - 45, e: TER.elev[ci(x, cAt(x) - 45)] });
  heads.sort((a, b) => b.e - a.e);
  const bats = [];
  for (const h of heads) if (bats.length < 2 && bats.every(b => Math.abs(b.x - h.x) > 700 * MAP_K)) bats.push(h);
  // 地名按实际方位起：两座炮台分东西，桥按是否在沿海公路上、在图东/西半部命名（同侧两座时偏北者为北桥）
  const westOf = (a, b) => a.x < b.x;
  bats.forEach((h, i) => add(i ? 'BT2' : 'BT', bats.length < 2 ? '岸防炮台' : westOf(h, bats[1 - i]) ? '西岸防炮台' : '东岸防炮台', h.x, h.y, 2));
  const bs = bridges.slice(0, N_RIVER + 1).map(b => ({ b, road: Math.abs(b.y - rdY(b.x)) < 45, side: b.x < W / 2 ? '西' : '东' }));
  const rd = bs.filter(o => o.road), up = bs.filter(o => !o.road);
  for (const o of rd) o.n = rd.length < 2 ? '公路桥' : o.side + '公路桥';
  for (const o of up) o.n = up.some(q => q !== o && q.side === o.side) ? (up.some(q => q !== o && q.side === o.side && q.b.y > o.b.y) ? '北桥' : o.side + '桥') : o.side + '桥';
  if (rd.length === 2 && rd[0].side === rd[1].side) for (const o of rd) o.n = (rd.some(q => q !== o && q.b.x > o.b.x) ? '西' : '东') + '公路桥';
  const used = new Set();   // 同名桥（三条河时可能出现）按东西顺序改成「西、中、东」或加序号
  for (const o of bs) { if (used.has(o.n)) { const alt = o.n.replace(/^[西东北]/, '中'); o.n = used.has(alt) ? o.n + (bs.indexOf(o) + 1) : alt; } used.add(o.n); }
  bs.forEach((o, i) => add('B' + (i + 1), o.n, o.b.x, o.b.y, 2));
  add('X1', '西路口', town1.x, rdY(town1.x), 1);
  add('X2', '东路口', town2.x, rdY(town2.x), 1);
  const ew = (n, i) => n === 3 ? ['西', '中', '东'][i] : i ? '东' : '西';   // 按条数从西到东命名
  vills.forEach((v, i) => add('V' + (i + 1), ew(vills.length, i) + '渔村', v.x, v.y, 1));
  TER.fords.forEach((f, i) => add('F' + (i + 1), ew(TER.fords.length, i) + '渡口', f.x, f.y, 1));
  TER.points = P;
}

// 城镇格里的房屋：每格一栋，位置、尺寸、朝向、屋顶色按地图种子固定。渲染画房子、步兵站位避开房子都用这一份
let BLD = null;
function townBld() {
  if (BLD && BLD.seed === TER.seed) return BLD;
  BLD = { seed: TER.seed, list: [], at: new Map() };
  const hr = rng(TER.seed + 11);
  for (let i = 0; i < GW * GH; i++) if (TER.type[i] === T.TOWN) {
    const b = { x: cellCX(i), y: cellCY(i), w: 5 + hr() * 3, h: 4 + hr() * 3, r: hr() < .5, c: (hr() * 6) | 0, f: hr() < .3, dx: (hr() - .5) * 2, dy: (hr() - .5) * 2 };   // c：屋顶色（6 种）
    BLD.list.push(b); BLD.at.set(i, b);
  }
  return BLD;
}
// 点落在房子里：推到最近的墙外（留 m 的余量，贴着墙根站），相邻格的房子也查；不在房子里返回 null
function bldOut(x, y, m = 1.2) {
  if (!TER) return null;
  const gx0 = Math.floor(x / CELL), gy0 = Math.floor(y / CELL);
  let moved = false;
  for (let pass = 0; pass < 3; pass++) {
    let hit = null;
    for (let gy = gy0 - 1; gy <= gy0 + 1 && !hit; gy++) for (let gx = gx0 - 1; gx <= gx0 + 1 && !hit; gx++) {
      if (gx < 0 || gy < 0 || gx >= GW || gy >= GH || TER.type[gy * GW + gx] !== T.TOWN) continue;
      const b = townBld().at.get(gy * GW + gx), hw = (b.r ? b.h : b.w) / 2 + m, hh = (b.r ? b.w : b.h) / 2 + m, cx = b.x + b.dx, cy = b.y + b.dy;
      if (Math.abs(x - cx) < hw && Math.abs(y - cy) < hh) hit = { cx, cy, hw, hh };
    }
    if (!hit) break;
    const ex = hit.hw - Math.abs(x - hit.cx), ey = hit.hh - Math.abs(y - hit.cy);
    if (ex < ey) x = hit.cx + (x >= hit.cx ? 1 : -1) * hit.hw; else y = hit.cy + (y >= hit.cy ? 1 : -1) * hit.hh;
    moved = true;
  }
  return moved ? [x, y] : null;
}
