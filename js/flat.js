'use strict';
// 白色平原（MAPGEN.flat，沙盒「地图」里选）：16.8 × 11.2 公里的一整块灰色平台（默认地图的四倍大），浮在超新星遗迹星云的正中间（v3neb.js），
//   淡淡的百米 / 千米方格（terrain.js uWh），没有河、林、镇、路、山，也没有海——只比兵力与战法。
//   进攻方把步兵、车辆直接摆进南缘往北 FLAT.zone 米的出发阵地（sandbox.js 按 TER.flat 处理，同闯关的陆战关），守方部署在出发阵地以北 FLAT.gap 米以外；
//   舰艇、舰载机这类要海的兵种在这张图上不出现（flatAllow）。航空兵从战区机场出动，北部纵深有守方空军基地。
//   据点：出发阵地前沿 6 处出发线（开战时归进攻方）、北面的指挥所、西 / 东 / 北三个要点、雷达站、两个集结地（只是方位，没有房子）。
//   「海岸线」放在图外南边（coastAt 恒为 H + 60）：全图都是陆地，按离岸距离算纵深的代码照常用；集结海域、航母位置也挪到图外（补给线朝南通到图外）。
//   地图大，寻路、视野等按格子开的数组也大：grid.js 对超过 120 万格的地图改用单精度、少缓存几张流场（BIG_N）
const FLAT = { w: 16800, h: 11200, zone: 2800, gap: 800, nb: 6, el: .012, off: 60 };   // 出发阵地纵深 2.8 公里（原来 1 公里，一个加强团摆不开）
MAPGEN.flat = { w: FLAT.w, h: FLAT.h, build: buildFlat, nm: '白色平原' };
const FLAT_SECT = ['甲', '乙', '丙', '丁', '戊', '己'];

function buildFlat(seed) {
  const r = rng(seed), C0 = H + FLAT.off;
  STAGING_Y = H + 400; CARRIER_Y = H + 700;   // 没有集结海域：后方在图外南边
  const coast = new Float32Array(W + 1).fill(C0);
  const type = new Uint8Array(GW * GH).fill(T.FIELD), elev = new Float32Array(GW * GH).fill(FLAT.el);   // 一整块平地（3D 里约 5 米高的平台）
  // 出发地段：沿南缘均匀排 6 处（甲区到己区），沙盒、AI 部署按它们分主攻、助攻（与登陆地图的滩头同一套结构）
  const beaches = [];
  for (let k = 0; k < FLAT.nb; k++) { const cx = W * (k + .5) / FLAT.nb + (r() - .5) * 500, w = 480 + r() * 80; beaches.push({ name: FLAT_SECT[k] + '区', x0: cx - w / 2, x1: cx + w / 2, cx }); }
  const hq = { x: W * (.4 + r() * .2), y: 1000 + r() * 500 };
  const fy = C0 - FLAT.zone;   // 出发阵地前沿
  const t1 = { x: W * (.16 + r() * .1), y: fy - 3300 - r() * 900 }, t2 = { x: W * (.74 + r() * .1), y: fy - 3300 - r() * 900 }, t3 = { x: W * (.3 + r() * .4), y: 2600 + r() * 700 };
  TER = { seed, type, elev, coast, beaches, mouths: [], rivers: [], massif: { x: W / 2, y: 600, r: 1, h: 0 }, bridges: [], fords: [], points: [], roads: [],
    roadY: new Float32Array(GW + 1).fill(fy), flat: true, towns: { vills: [], town1: t1, town2: t2, town3: t3, hq } };
  if (typeof eaRunwayFit === 'function') TER.af = afSite(r, [t1, t2, t3, hq], hq);   // 守方空军基地：指挥所一带的纵深（mapgen2.js）
  const P = [], add = (key, name, x, y, vp) => { if (!P.some(p => dist(p.x, p.y, x, y) < 300)) P.push({ key, name, x: Math.round(x), y: Math.round(y), vp }); };
  beaches.forEach((b, i) => add('E' + (i + 1), b.name + '出发线', b.cx, fy - 30, 1));
  add('HQ', '指挥所', hq.x, hq.y, 3);
  add('T1', '西要点', t1.x, t1.y, 2); add('T2', '东要点', t2.x, t2.y, 2); add('T3', '北要点', t3.x, t3.y, 2);
  add('RD', '雷达站', W * (.35 + r() * .3), fy - 4800 - r() * 700, 2);
  add('X1', '西集结地', W * (.3 + r() * .08), fy - 1300 - r() * 400, 1);
  add('X2', '东集结地', W * (.62 + r() * .08), fy - 1300 - r() * 400, 1);
  if (TER.af) for (const p of P) {   // 据点不压在机场场区上：挪到场区南面
    const [cx, cy] = afWorld(TER.af, 0, 110);
    if (dist(p.x, p.y, cx, cy) < 700) p.y = Math.min(fy - FLAT.gap - 200, cy + 900);
  }
  TER.points = P;
  setPathRows(GH);
}
// 沙盒：进攻方的出发阵地（南缘往北 FLAT.zone 米以内）；守方部署须在出发阵地以北 FLAT.gap 以外
const flatZone = (x, y) => !!(TER && TER.flat) && coastAt(x) - y >= FLAT.off && coastAt(x) - y <= FLAT.zone;
const flatFront = (x, y) => !!(TER && TER.flat) && coastAt(x) - y < FLAT.zone + FLAT.gap;
// 这张图上能用的兵种：没有海，舰艇、舰载机、岸防、滩头障碍、登陆艇、增援线都不要
const FLAT_NO_AT = ['sea', 'esea', 'shore', 'coast', 'air'], FLAT_NO_KIND = ['ship', 'eship', 'esub', 'dd', 'cv'], FLAT_NO_ID = ['p_lcac', 'p_rline', 'p_reserve'];
const flatAllow = c => { const s = (c && c.spawn) || {}; return !FLAT_NO_AT.includes(s.at) && !FLAT_NO_KIND.includes(s.kind) && !FLAT_NO_ID.includes(c.id); };

// 开战：出发阵地上的步兵组按位置编成排（每排至多 6 组）、车辆已由 sbxSpawn 放好；部队最集中的两个地段各开一个补给站（工兵 + 通到图外南边的补给线），
//   出发线据点归进攻方——同闯关陆战关（levels.js lvGroundSpawn），只是没有补给舰：补给站直接开设在出发阵地里
function flatGroundSpawn(items) {
  const inf = items.filter(it => it.side === 'p' && it.x != null && sbxEntry(it) && sbxEntry(it).spawn.kind === 'cargo'), used = new Set();
  let k = 0;
  for (const it of inf) {
    if (used.has(it)) continue;
    const grp = inf.filter(o => !used.has(o) && dist(o.x, o.y, it.x, it.y) < 140).slice(0, 6);
    grp.forEach(o => used.add(o));
    const u = addUnit('p', 'inf', { ship: `LZ-${++k}`, emblem: 'assault', form: 'line', face: NORTH, auto: true }), eng = [];
    let mor = 0;
    for (const o of grp) {
      const c = sbxEntry(o), sp = c.spawn, sx = typeof sbxSpot === 'function' ? sbxSpot(o.x, o.y, 'p') : { x: o.x, y: o.y };
      const q = addTeam('p', sx.x, sx.y, sp.men, { unit: u.ship, u: u.id, cat: c.id, ...(sp.mod ? { mod: { ...sp.mod } } : {}), ...(sp.tag ? { sbxTag: sp.tag } : {}) });
      q.kind = q.men[0] === 'eng' ? 'eng' : 'inf';
      if (sp.eng) eng.push(q);
      mor += sp.morale || 80;
    }
    u.morale = Math.round(mor / grp.length);
    if (eng.length) { const ue = addUnit('p', 'eng', { ship: u.ship, emblem: 'eng', face: NORTH, auto: true }); for (const q of eng) q.u = ue.id; }
  }
  const all = [...S.teams.filter(q => q.side === 'p'), ...(S.veh || []).filter(v => v.side === 'p')];
  const B = TER.beaches.map(b => ({ b, n: all.filter(o => Math.abs(o.x - b.cx) < 600).length })).sort((a, c) => c.n - a.n).slice(0, 2);
  B.forEach(({ b }, j) => {
    const x = b.cx, y = coastAt(x) - 240, lbl = `LS-${j + 1}`;
    const ue = addUnit('p', 'eng', { ship: lbl, emblem: 'eng', face: NORTH, auto: true }), e = addTeam('p', x, y, ['eng', 'eng', 'eng'], { unit: lbl, u: ue.id });
    const segs = [];
    for (let i = 0; i < 4; i++) segs.push({ x0: x, y0: lerp(y, H + 300, i / 4), x1: x, y1: lerp(y, H + 300, (i + 1) / 4), ok: true, rep: 0 });   // 补给线朝南通到图外（后方）
    S.supply.push({ id: S.nid++, ship: null, eng: e.id, x, y, segs, connected: true });
    log(`${lbl} 在${b.name}出发阵地开设补给站`, 'good');
  });
  for (const p of S.points) if (/^E\d/.test(p.key)) { p.owner = 'p'; p.prog = 0; }
  if (typeof indexUnits === 'function') indexUnits();
  log('出发阵地展开完毕：补给站开设，向纵深发起进攻', 'good');
}
// 新开一局：055 旗舰没地方停（没有海）——移到图外、算作不在场
HOOK.newGame.push(() => { if (S && TER && TER.flat && S.dd) Object.assign(S.dd, { x: -9999, y: H + 9999, tx: -9999, ty: H + 9999, hull: 0, state: 'sunk', moving: false, auto: false }); });
