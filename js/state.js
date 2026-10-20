'use strict';
// 战局状态与实体工厂。S 只存放纯数据，便于暂存与热更新。
let S = null;

const SHIP_SPEC = {
  assault: { name: '突击登陆舰', hp: 6, squads: 5, eng: 0 },   // 15 人 = 5 个 3 人小队
  supply: { name: '补给登陆舰', hp: 6, squads: 4, eng: 3 }     // 15 人 = 4 个作战小队 + 3 名工兵
};
const ENEMY_SPEC = {
  bunker: { name: '机枪碉堡', hp: 14 },
  arty: { name: '岸防炮兵', hp: 10 },
  aa: { name: '防空炮', hp: 8 }
};
const LIMIT = 20 * 60;   // 作战时限（秒）
const HOLD = 60;         // 三个目标需同时坚守的秒数

function newGame(seed, level) {
  level = DIFF[level] ? level : 'hard';
  seed = seed || (Math.random() * 1e9) | 0;
  buildTerrain(seed);
  const r = rng(seed ^ 0x5f3759df);
  S = {
    seed, t: 0, paused: true, ai: null, holdT: 0, speed: 1, nid: 1, over: null, briefed: false,
    ships: [], squads: [], enemies: [], planes: [], shells: [], tracers: [], fx: [],
    supply: [], rlines: [], boats: [], recon: [], ghosts: [], log: [],
    groups: { 1: [], 2: [], 3: [], 4: [] }, sel: [],
    cards: { assault: 2, supply: 1, rline: 2, reinf: 8, strike: 2, recon: 2 },
    objectives: TER.obj.map(o => ({ ...o, owner: 'e', prog: 0 })),
    destroyer: { x: 1110, y: 765, hull: 3, state: 'ready', cool: 0, repairT: 0, repairDur: 16, auto: false, aim: null, exposedUntil: 0 },
    stats: { lost: 0, killed: 0, shots: 0, exposed: 0 }, throttle: {}
  };

  // —— 敌方部署（玩家不可见）——
  const nb = DIFF[level].bunkers, na = DIFF[level].arty;
  for (let i = 0; i < nb; i++) {
    const x = 120 + i * 960 / (nb - 1) + (r() - .5) * 80;
    addEnemy('bunker', x, coastAt(x) - 34 - r() * 26);
  }
  for (let i = 0; i < na; i++) addEnemy('arty', 200 + i * 800 / (na - 1) + (r() - .5) * 120, 50 + r() * 80);
  const [A, B, C] = S.objectives;
  addEnemy('aa', B.x + (r() - .5) * 120, B.y + 30 + r() * 30);
  addEnemy('aa', C.x + (r() - .5) * 100, C.y + 40 + r() * 30);
  for (const o of S.objectives) for (let k = 0; k < DIFF[level].garrison; k++)
    addSquad('e', o.x + (r() - .5) * 90, o.y + (r() - .5) * 60, ['rifle', 'rifle', 'rifle']);
  for (let k = 0; k < 3; k++) {
    const x = 300 + r() * 600;
    addSquad('e', x, coastAt(x) - 60 - r() * 40, ['rifle', 'rifle', 'rifle']);
  }

  aiInit(level);

  // —— 开局已在集结海域的舰船（示例部署）——
  const a1 = addShip('assault', 430, 715), a2 = addShip('assault', 470, 740), s1 = addShip('supply', 760, 725);
  S.groups[1] = [a1.id, a2.id];
  S.groups[2] = [s1.id];
  log('战局开始。敌方地形已投影至沙盘，敌军部署不明。', 'info');
  log('三个目标：A 灯塔、B 炮台高地、C 指挥所。全部占领并坚守 60 秒即胜利。', 'info');
  return S;
}

function addShip(kind, x, y) {
  const sp = SHIP_SPEC[kind];
  const n = S.ships.filter(s => s.kind === kind).length + 1;
  const s = {
    id: S.nid++, kind, x, y, tx: x, ty: y, hp: sp.hp, maxhp: sp.hp, state: 'idle', heading: -Math.PI / 2, ut: 0,
    label: (kind === 'assault' ? 'LA-' : 'LS-') + n, load: { squads: sp.squads, eng: sp.eng }
  };
  S.ships.push(s);
  return s;
}

function addSquad(side, x, y, men, extra) {
  const q = {
    id: S.nid++, side, x, y, home: { x, y }, men: men.slice(), ammo: 40, cd: Math.random(),
    kind: men[0] === 'eng' ? 'eng' : 'inf', no: S.squads.filter(s => s.side === side).length + 1,
    radioLost: false, ox: (Math.random() - .5) * 50, oy: (Math.random() - .5) * 40, ...extra
  };
  S.squads.push(q);
  return q;
}

function addEnemy(kind, x, y) {
  const e = { id: S.nid++, kind, x, y, hp: ENEMY_SPEC[kind].hp, maxhp: ENEMY_SPEC[kind].hp, cd: 2 + Math.random() * 4, dead: false };
  S.enemies.push(e);
  return e;
}

// kind: info / warn / bad / good；同类消息按 key 节流
function log(msg, kind = 'info', key, gap = 5) {
  if (key) {
    if (S.throttle[key] && S.t - S.throttle[key] < gap) return;
    S.throttle[key] = S.t;
  }
  S.log.unshift({ t: S.t, msg, kind });
  if (S.log.length > 60) S.log.length = 60;
}

const fmtT = t => {
  t = Math.max(0, Math.floor(t));
  return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
};
const shipById = id => S.ships.find(s => s.id === id);
const alive = s => s.state !== 'sunk';
