'use strict';
// 战局状态：固定编成的登陆舰队、守军纵深部署（工事、雷区、铁丝网、障碍、火炮、守备队）
let S = null;
const LIMIT = 45 * 60;   // 作战时限（秒）
const HOLD = 30;         // 全部据点需同时控制的秒数
const SHIP_SPEC = {
  assault: { name: '271 型登陆艇', hp: 10, teams: 5, eng: 0 },     // 15 人 = 5 个三人组
  supply: { name: '072 型后勤登陆舰', hp: 11, teams: 4, eng: 3 },      // 4 个三人组 + 3 名工兵
  lst: { name: '072A 型坦克登陆舰', hp: 14, teams: 0, eng: 0, veh: ['tank', 'tank', 'apc'] },   // 车辆经艏门跳板逐辆驶下（vehicles.js）
  dd: { name: '054A 型护卫舰', hp: 12, teams: 0, eng: 0 }   // 沙盒中旗舰以外的驱逐舰 / 护卫舰：只在海上机动和射击，不抢滩
};
const ENEMY_SPEC = {
  bunker: { name: '机枪碉堡', hp: 16 }, coastal: { name: '岸防重炮', hp: 22 }, arty: { name: 'M777 榴弹炮阵地', hp: 10 },
  mortar: { name: 'M252 迫击炮组', hp: 6 }, aa: { name: '防空炮（M167 火神）', hp: 8 },
  tel: { name: 'M142 海马斯发射车', hp: 8 }, ascm: { name: 'NMESIS 岸舰导弹连', hp: 10 }, airfield: { name: '野战机场', hp: 50 }   // v7（missile.js / eair.js）；守方按美军装备命名
};
const ROLE_NAME = { radio: '通讯兵', rifle: '步枪手', mg: '机枪手', eng: '工兵', aa: '防空导弹手' };

// opts.sandbox：只生成地形，不放守军与舰队（沙盒模式自行部署）
function newGame(seed, level, opts = {}) {
  level = DIFF[level] ? level : 'hard';
  seed = seed || (Math.random() * 1e9) | 0;
  buildMap(seed);
  const r = rng(seed ^ 0x5f3759df);
  S = {
    seed, level, mode: opts.mode || (opts.sandbox ? 'sandbox' : 'pve'), role: opts.role || 'attack', t: 0, paused: true, speed: 1, nid: 1, over: null, briefed: false, holdT: 0, ai: null, phase: 'deploy', units: [], craters: [], pings: [],
    ships: [], teams: [], enemies: [], planes: [], shells: [], tracers: [], fx: [], smoke: [],
    mines: [], wire: [], obst: [], trench: [], supply: [], rlines: [], boats: [], recon: [], log: [],
    groups: { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [], 8: [], 9: [] }, sel: [],
    assets: { recon: 3, strike: 3, rline: 3, reserve: 9, smoke: 6 },
    points: TER.points.map(p => ({ ...p, owner: 'e', prog: 0 })),
    dd: { name: '055 型驱逐舰', x: W / 2, y: 1720, tx: W / 2, ty: 1720, hull: 3, state: 'ready', cool: 0, repairT: 0, repairDur: 16, auto: false, exposedUntil: 0, moving: false },
    stats: { lost: 0, killed: 0, shots: 0, exposed: 0, structs: 0 }, throttle: {}
  };
  if (!opts.sandbox) deployDefenses(r, DIFF[level]);
  aiInit(level);
  if (!opts.sandbox) deployFleet();
  if (typeof initCarrier === 'function') initCarrier();
  rebuildForts(); rebuildCraters(); indexUnits();
  runHook('newGame', opts);
  if (opts.sandbox) return S;
  log('舰队已在集结海域就位。对岸地形已投影至沙盘，守军部署不明。', 'info');
  log(`共 ${S.points.length} 个据点。夺取指挥所并控制七成以上据点分值，坚守 ${HOLD} 秒即胜利。`, 'info');
  return S;
}

// 固定编成：两个突击编队（各 5 艘）、一个补给编队（3 艘）、驱逐舰；航母在更南面
// 登陆兵力：10 × 15 + 3 × 15 = 195 人，另有 9 组（27 人）后备经增援线上岸
function deployFleet() {
  const slot = (kind, x, y, label, grp) => S.groups[grp].push(addShip(kind, x, y, label).id);
  for (let k = 0; k < 5; k++) slot('assault', W * (.2 + k * .045), 1600 + (k % 2) * 46, 'LA-' + (k + 1), 1);
  for (let k = 0; k < 5; k++) slot('assault', W * (.62 + k * .045), 1600 + (k % 2) * 46, 'LA-' + (k + 6), 2);
  for (let k = 0; k < 3; k++) slot('supply', W * (.45 + k * .05), 1640, 'LS-' + (k + 1), 3);
  // 第 4 编队：坦克登陆舰（2 辆中型坦克 + 1 辆装甲运兵车）与 4 辆自航泅渡的两栖坦克
  const l = addShip('lst', W * .4, 1690, 'LT-1');
  l.load.veh = SHIP_SPEC.lst.veh.slice();
  S.groups[4].push(l.id);
  if (typeof addVehicle === 'function') for (const x of [.25, .31, .67, .73]) S.groups[4].push(addVehicle('p', 'amtank', W * x, 1545, { auto: true }).id);
}

function deployDefenses(r, D) {
  const cAt = coastAt;
  for (const b of TER.beaches) {
    const w = b.x1 - b.x0;
    // 滩顶铁丝网，出口路两侧留缺口
    for (let x = b.x0 - 10; x < b.x1 + 10; x += 40) {
      const x1 = Math.min(x + 40, b.x1 + 10);
      if (Math.abs((x + x1) / 2 - b.cx) < 20) continue;
      S.wire.push({ id: S.nid++, x0: x, y0: cAt(x) - 26, x1, y1: cAt(x1) - 26, known: false, cut: false });
    }
    for (let k = 0; k < D.beachMines; k++) {
      const x = b.x0 + w * (k + .5) / D.beachMines + (r() - .5) * 20;
      S.mines.push({ id: S.nid++, x, y: cAt(x) - 12, r: 22 + r() * 8, known: false, clr: 0 });
    }
    for (let k = 0; k < 6 + D.beachMines * 2; k++) {
      const x = b.x0 + r() * w;
      S.obst.push({ id: S.nid++, x, y: cAt(x) + 14 + r() * 34, known: false, dead: false });
    }
    const tr = [];
    for (let x = b.x0 - 30; x <= b.x1 + 30; x += 22) tr.push([x, cAt(x) - 62 + (tr.length % 2 ? 6 : -6)]);
    S.trench.push({ id: S.nid++, pts: tr, known: false });
    for (let k = 0; k < D.beachBunkers; k++) {
      const x = D.beachBunkers === 1 ? b.cx + (r() - .5) * 40 : lerp(b.x0, b.x1, k ? .82 : .18);
      addEnemy('bunker', x, cAt(x) - 48);
    }
    const obj = 'E' + (TER.beaches.indexOf(b) + 1), ua = addUnit('e', 'inf', { role: 'ambush', obj });
    for (let k = 0; k < D.ambush; k++) {
      const x = lerp(b.x0, b.x1, (k + .5) / D.ambush);
      addTeam('e', x, cAt(x) - 62, ['rifle', 'rifle', 'mg'], { role: 'ambush', hold: true, obj, u: ua.id });
    }
  }
  // 岸防重炮：岬角悬崖顶
  const gunXs = ['BT', 'BT2'].map(k => S.points.find(p => p.key === k)).filter(Boolean).map(p => p.x);
  for (let x = 40; x < W - 40; x += 20)
    if (typeAt(x, coastAt(x) - 10) === T.CLIFF && gunXs.length < D.coastal && gunXs.every(g => Math.abs(g - x) > 450)) gunXs.push(x);
  for (const x of gunXs.slice(0, D.coastal)) addEnemy('coastal', x, coastAt(x) - 45);
  for (let i = 0; i < D.arty; i++) {
    const x = 200 + i * (W - 400) / Math.max(1, D.arty - 1) + (r() - .5) * 140;
    addEnemy('arty', x, clamp(coastAt(x) - 480 - r() * 120, 60, coastAt(x) - 300));
  }
  for (let i = 0; i < D.mortars; i++) {
    const b = TER.beaches[i % TER.beaches.length], x = b.cx + (r() - .5) * 140;
    addEnemy('mortar', x, coastAt(x) - 160 - r() * 50);
  }
  const aaAt = ['HQ', 'RD', 'T1', 'T2'].map(k => S.points.find(p => p.key === k)).filter(Boolean);
  for (let i = 0; i < D.aa; i++) { const p = aaAt[i % aaAt.length]; addEnemy('aa', p.x + (r() - .5) * 80, p.y + 30 + r() * 30); }
  for (const k of ['BT', 'BT2', 'RD']) {
    const p = S.points.find(p => p.key === k);
    if (p) S.mines.push({ id: S.nid++, x: p.x + (r() - .5) * 60, y: p.y + 55, r: 24, known: false, clr: 0 });
  }
  // 据点守备队
  for (const p of S.points) {
    const n = Math.max(1, ({ 1: 1, 2: 2, 3: 4 })[p.vp] + D.garrison), ug = addUnit('e', 'inf', { role: 'garrison', obj: p.key });
    for (let k = 0; k < n; k++) {
      const a = k / n * 6.28 + r(), x = p.x + Math.cos(a) * 25, y = p.y + Math.sin(a) * 20;
      if (passInf(x, y)) addTeam('e', x, y, ['rifle', 'rifle', 'mg'], { role: 'garrison', obj: p.key, u: ug.id });
    }
  }
  // 机动预备队：分驻两个镇子
  const towns = ['T1', 'T2'].map(k => S.points.find(p => p.key === k)).filter(Boolean);
  if (!towns.length) towns.push(S.points[0]);
  let ur = null;
  for (let k = 0; k < D.reserves; k++) {
    const tw = towns[Math.floor(k / 3) % towns.length];
    if (k % 3 === 0) ur = addUnit('e', 'inf', { role: 'reserve', obj: tw.key });
    addTeam('e', tw.x + (r() - .5) * 60, tw.y - 30 - r() * 30, ['rifle', 'rifle', 'mg'], { role: 'reserve', obj: tw.key, u: ur.id });
  }
}

function addShip(kind, x, y, label) {
  const sp = SHIP_SPEC[kind];
  const s = { id: S.nid++, kind, label, x, y, tx: x, ty: y, hp: sp.hp, maxhp: sp.hp, state: 'idle', heading: -Math.PI / 2, ut: 0, land: false, plan: null, form: 'line', auto: true, load: { teams: sp.teams, eng: sp.eng } };
  S.ships.push(s);
  return s;
}

function addTeam(side, x, y, men, extra) {
  const q = {
    id: S.nid++, side, x, y, men: men.slice(), ammo: 60, cd: Math.random(), sup: 0, kind: men[0] === 'eng' ? 'eng' : 'inf',
    no: S.teams.filter(s => s.side === side).length + 1, order: { t: 'hold' }, movedT: -99, hitT: -99, ...extra
  };
  S.teams.push(q);
  return q;
}

function addEnemy(kind, x, y) {
  const e = { id: S.nid++, kind, x, y, hp: ENEMY_SPEC[kind].hp, maxhp: ENEMY_SPEC[kind].hp, cd: 2 + Math.random() * 4, dead: false, kx: null, ky: null };
  S.enemies.push(e);
  return e;
}

// kind：info / warn / bad / good；同类消息按 key 节流
// at：事件发生位置（{x, y}），地图上会出现提示波纹，点击消息可跳转
function log(msg, kind = 'info', key, gap = 5, at) {
  if (key) {
    if (S.throttle[key] && S.t - S.throttle[key] < gap) return;
    S.throttle[key] = S.t;
  }
  if (at && at.x != null) { S.pings.push({ x: at.x, y: at.y, t: S.t, kind }); if (S.pings.length > 30) S.pings.shift(); }
  S.log.unshift({ t: S.t, msg, kind, x: at && at.x, y: at && at.y, id: S.nid++ });
  if (S.log.length > 80) S.log.length = 80;
}

const fmtT = t => {
  t = Math.max(0, Math.floor(t));
  return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
};
const byId = id => S.ships.find(s => s.id === id) || S.teams.find(q => q.id === id);
const alive = s => s.state !== 'sunk';
const teamName = q => q.kind === 'eng' ? `${q.unit || ''}工兵组` : `${q.unit ? q.unit + '·' : ''}${q.no}组`;
