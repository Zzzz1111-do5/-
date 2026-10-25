'use strict';
// 美军第 101 空降师（守方）：3 架 C-17A「环球霸王 III」编队空降一个战斗群——
//   伞兵 54 人：两架各 8 个班（步枪 / 机枪班 ×5、M240 火力班、标枪反坦克班、毒刺防空班），第三架 2 个标枪班 + 重装空投 5 辆车：
//   JLTV 陶式反坦克车 ×2、AN/TWQ-1 复仇者防空车 ×2（加强：备弹 12 枚、装填快、射程远）、M1097 悍马（M2 机枪）×1。
//   精锐加成（A101.mod）：精度 1.25 倍、射速 1.1 倍；防弹插板让两成的致命伤只是负伤；被压制程度打八折；连队士气 92、按精锐连队算。
//   战役：困难 1 波、地狱 2 波；沙盒：守方目录「第 101 空降师 · C-17 空降战斗群」，每买一份多一波。开战 A101.first 秒后才可用，两波间隔 A101.gap 秒。
//   守方 AI：我军上岸后，挑受威胁最大的己方据点（或刚被我军夺取、值得反冲击的据点），在其内陆一侧 180–360、离我军 260 以外、
//     避开已知我方防空的平地选空降场；C-17 从地图北缘进场，飞越空降场时依次放出伞兵与重装平台，随即北返；
//   伞兵下降 5 秒、重装平台 7 秒，下降中挨我方地面火力；落地先在空降场集合，再整连交给守方协同（ai4.js a4Adopt）增援或反冲击。
//   C-17 进 S.eair.fly（type = c17，4 点耐久、3 组干扰弹）：我方战斗机、舰空导弹、弹炮防空车、便携防空导弹都能打，跳伞前被击落机上人员装备全损。
// 状态：S.e101 = { n 剩余波数, next 下一波最早时刻, lift: {id, dz, key, t, land 落地班数, veh 落地车数, lost 损失人数, us: [连 id], vs: [车 id]} | null, ch: [下降中], done }
const A101 = { first: { normal: 200, hard: 150, hell: 110 }, gap: 160, n: { normal: 0, hard: 1, hell: 2 }, dzMin: 180, dzMax: 360, safe: 260, aaR: 360,
  mod: { pow: 1.25, rof: 1.1, hard: .2, calm: .8 }, jump: 5, heavy: 7, sig: 22 };
const A101_SQ = { rifle: ['rifle', 'rifle', 'mg'], lead: ['radio', 'rifle', 'mg'], mg: ['rifle', 'mg', 'mg'], jav: ['rifle', 'rifle', 'rifle'], stg: ['rifle', 'aa', 'rifle'], rec: ['radio', 'rifle', 'rifle'] };
const A101_ROLE = { jav: { at: 1.6, atPen: 3.4, rng: 1.5 }, mg: { sup: 1.4 }, rec: { pow: 1.6, rof: 1.25, hard: .45, calm: .45, rng: 1.25 } };   // rec：超级精锐侦察组（两组，前出侦察敌情）
// 每架的装载：班（按跳伞顺序）与重装平台。伞兵三架共 60 人（20 个班）
const A101_SAM = { n: 12, cd: 1.6, regen: 20, range: 600, pkK: 1.15 };
const A101_PAX = [
  { sq: ['lead', 'rifle', 'rifle', 'mg', 'rifle', 'jav', 'stg', 'rifle'] },
  { sq: ['lead', 'rifle', 'rifle', 'mg', 'rifle', 'jav', 'stg', 'rifle'] },
  { sq: ['rec', 'rec', 'jav', 'mg'] }
];
const A101_LOAD = [...A101_PAX.slice(0, 2), { sq: A101_PAX[2].sq, veh: [{ type: 'td', mdl: 'JLTV 陶式反坦克车' }, { type: 'td', mdl: 'JLTV 陶式反坦克车' },
  { type: 'sam_veh', mdl: 'AN/TWQ-1 复仇者防空车', samX: A101_SAM }, { type: 'sam_veh', mdl: 'AN/TWQ-1 复仇者防空车', samX: A101_SAM }, { type: 'recon', mdl: 'M1097 悍马（M2 机枪）' }] }];
// 沙盒：机械化空降战斗群——24 架 C-17A，按真实载重装机（一架只装得下一辆 M1 坦克）：
//   伞兵 60 人（3 架）、主战坦克 14 辆（M1A2 SEPv3 ×8、M1A1 ×6，各 1 架）、M2A3 布雷德利 4 辆（2 架）、M109A7 自行榴弹炮 2 辆（2 架）、
//   复仇者 + M-SHORAD 防空车各 2 辆（2 架）、JLTV 陶式反坦克车 2 辆（1 架）；6 架 AH-64E 随队先到空降场压制
const A101_MECH = [
  ...A101_PAX,
  ...Array.from({ length: 14 }, (_, i) => ({ sq: [], veh: [i < 8 ? { type: 'hv_tank', mdl: 'M1A2 SEPv3 艾布拉姆斯' } : { type: 'tank', mdl: 'M1A1 艾布拉姆斯' }] })),
  { sq: [], veh: [{ type: 'apc', mdl: 'M2A3 布雷德利' }, { type: 'apc', mdl: 'M2A3 布雷德利' }] },
  { sq: [], veh: [{ type: 'apc', mdl: 'M2A3 布雷德利' }, { type: 'apc', mdl: 'M2A3 布雷德利' }] },
  { sq: [], veh: [{ type: 'spg', mdl: 'M109A7 帕拉丁自行榴弹炮' }] },
  { sq: [], veh: [{ type: 'spg', mdl: 'M109A7 帕拉丁自行榴弹炮' }] },
  { sq: [], veh: [{ type: 'sam_veh', mdl: 'AN/TWQ-1 复仇者防空车', samX: A101_SAM }, { type: 'sam_veh', mdl: 'AN/TWQ-1 复仇者防空车', samX: A101_SAM }] },
  { sq: [], veh: [{ type: 'sam_veh', mdl: 'M-SHORAD 防空车（斯特赖克）', samX: A101_SAM }, { type: 'sam_veh', mdl: 'M-SHORAD 防空车（斯特赖克）', samX: A101_SAM }] },
  { sq: [], veh: [{ type: 'td', mdl: 'JLTV 陶式反坦克车' }, { type: 'td', mdl: 'JLTV 陶式反坦克车' }] }
];
const A101_ESC = 6;   // 随队 AH-64E
// 装载清单的文字（「M1A2 SEPv3 艾布拉姆斯 8 辆、……」）
const a101VehText = L0 => { const n = new Map(); for (const L of L0) for (const v of L.veh || []) n.set(v.mdl, (n.get(v.mdl) || 0) + 1); return [...n].map(([m, k]) => `${m} ${k} 辆`).join('、'); };
const a101Load = () => S && S.mode === 'sandbox' ? A101_MECH : A101_LOAD;
const a101Men = L0 => L0.reduce((a, L) => a + L.sq.reduce((b, k) => b + A101_SQ[k].length, 0), 0);
const a101Veh = L0 => L0.reduce((a, L) => a + (L.veh || []).length, 0);
const A101_MEN = a101Men(A101_LOAD), A101_VEH = a101Veh(A101_LOAD);

function a101Ensure() {
  if (S.e101 && Array.isArray(S.e101.ch)) return S.e101;
  const lv = S.level || 'hard', sbx = S.mode === 'sandbox';
  return (S.e101 = { n: sbx ? (S.assets && S.assets.e101) || 0 : A101.n[lv] || 0, next: (A101.first[lv] || 150) * (sbx ? .8 : 1), lift: null, ch: [], done: 0 });
}
// 空降场：据点 p 内陆一侧，按离据点近、离我军远、隐蔽好、地势开阔（伞兵好落）打分
function a101DZ(p) {
  const pT = S.teams.filter(q => q.side === 'p' && q.men.length);
  const aa = [...S.teams.filter(q => q.side === 'p' && q.men.length && q.men.includes('aa') && q.aaSeenE != null && S.t - q.aaSeenE < 180),
    ...(S.veh || []).filter(v => v.side === 'p' && !v.dead && (v.type === 'aa_veh' || v.type === 'sam_veh') && spotted(v.x, v.y))];
  let best = null, bs = -Infinity;
  for (let k = 0; k < 80; k++) {
    const a = -Math.PI / 2 + gauss() * .7, r = A101.dzMin + Math.random() * (A101.dzMax - A101.dzMin), x = clamp(p.x + Math.cos(a) * r, 60, W - 60), y = clamp(p.y + Math.sin(a) * r, 60, H - 60);
    if (!isLand(x, y) || !passInf(x, y) || coastAt(x) - y < 160) continue;
    const dp = pT.length ? Math.min(...pT.map(q => dist(q.x, q.y, x, y))) : 999;
    if (dp < A101.safe || aa.some(o => dist(o.x, o.y, x, y) < A101.aaR) || !a101DZClean(x, y)) continue;
    let open = 0;
    for (let j = 0; j < 8; j++) { const ox = x + Math.cos(j * .785) * 50, oy = y + Math.sin(j * .785) * 50; if (isLand(ox, oy) && passInf(ox, oy)) open++; }
    const s = -dist(x, y, p.x, p.y) / 120 + Math.min(dp, 600) / 160 + open * .25 + Math.random() * .3;
    if (s > bs) { bs = s; best = { x: Math.round(x), y: Math.round(y) }; }
  }
  return best;
}
// 空降场落点范围（各小队沿南北航线投放 + 散布 + 飘移）内不能有河、海、悬崖，免得伞兵一部分落在河那边、聚不到一起
function a101DZClean(x0, y0) {
  for (let dy = -140; dy <= 200; dy += 20) for (let dx = -90; dx <= 105; dx += 15) {
    const x = x0 + dx, y = y0 + dy;
    if (x < 10 || x > W - 10 || y < 10) return false;
    const t = typeAt(x, y);
    if (isWater(t) || t === T.RIVER || t === T.CLIFF || t === T.FORD) return false;
  }
  return true;
}
// 去哪儿：受威胁最大的己方据点（威胁 ≥ 2），或我军刚夺取、价值最高的据点（反冲击）
function a101Obj() {
  const thr = S.ai && S.ai.co && S.ai.co.thr;
  let best = null, bs = 0;
  for (const p of S.points) {
    let s = 0;
    if (p.owner === 'e') { const T = thr && thr[p.key]; s = T ? T[2] : S.teams.filter(q => q.side === 'p' && q.men.length && dist(q.x, q.y, p.x, p.y) < 260).length * .6; if (s < 2) continue; }
    else s = 1.5 + (p.vp || 1) * .8;
    if (s > bs) { bs = s; best = p; }
  }
  return best;
}
function a101Think() {
  const E1 = a101Ensure();
  if (E1.lift || !(E1.n > 0) || S.t < E1.next || typeof eaEnsure !== 'function') return;
  if (S.teams.filter(q => q.side === 'p' && q.men.length && isLand(q.x, q.y)).length < 5) return;
  if (!E1.force && typeof a5Hold === 'function' && a5Hold()) return;   // 留着配合总攻（ai5.js）
  const p = E1.force ? ptByKey(E1.force) || a101Obj() : a101Obj(), dz = p && a101DZ(p);
  E1.force = null;
  if (!dz) { E1.next = S.t + 10; return; }
  const E = eaEnsure(), id = S.nid++, sp = EA_SPEC.c17, LD = a101Load(), men = a101Men(LD), nv = a101Veh(LD);
  E1.lift = { id, dz, key: p.key, t: S.t, land: 0, veh: 0, lost: 0, us: [], vs: [] };
  E1.n--; E1.next = S.t + A101.gap;
  // 空降编队（按美军战略空降的做法）：三机一个楔形小队（长机居中在前，两僚机左右后方），各小队沿同一航线前后拉开纵列飞越空降场；
  // 伞兵机在最前，重装机随后——伞兵先落地占领空降场，重装平台落在他们身后
  LD.forEach((L, k) => {
    const el = Math.floor(k / 3), s = k % 3, lat = s === 0 ? 0 : s === 1 ? -38 : 38, back = el * 150 + (s ? 45 : 0);
    const lx = clamp(dz.x + lat, 40, W - 40);
    E.fly.push({ id: S.nid++, type: 'c17', lift: id, k, el, x: lx, y: -60 - back, heading: Math.PI / 2, spd: sp.spd, alt: .6, bank: 0, hp: sp.hp, flares: sp.flares,
      ph: 'in', lx, ly: dz.y + (el % 2 ? 18 : -10), sq: L.sq.slice(), veh: (L.veh || []).slice(), rel: 0, t: S.t, pv: false });
  });
  if (typeof v8Stat === 'function') v8Stat('a101Go');
  const mech = LD === A101_MECH;
  if (mech) for (let k = 0; k < A101_ESC; k++) {   // 随队阿帕奇：从北面先到，在空降场外悬停，打靠近空降场的我军
    const h = EA_SPEC.heli;
    E.fly.push({ id: S.nid++, wid: null, type: 'heli', base: null, spd: h.spd, bank: 0, x: clamp(dz.x + (k - 1.5) * 40, 20, W - 20), y: -30 - (k % 2) * 25, heading: Math.PI / 2, alt: .3, ph: 'out', tx: dz.x, ty: dz.y,
      tgt: { k: 'pt' }, flares: h.flares, hp: h.hp, t: S.t, pv: false, ammo: 1, atgm: 3, rk: 3, slot: k, esc101: true });
  }
  const wh = typeof cmdWhere === 'function' ? cmdWhere(dz.x, dz.y) : gridRef(dz.x, dz.y);
  if (typeof chatSay === 'function') chatSay('e', `命令：第 101 空降师${mech ? '机械化' : ''}空降战斗群，${LD.length} 架 C-17A 三机一队、纵列在${wh}空降——伞兵 ${men} 人，重装空投${a101VehText(LD)}${mech ? `；${A101_ESC} 架 AH-64E 随队先到空降场压制` : ''}；落地集结后${p.owner === 'p' ? `反冲击${p.name}` : `增援${p.name}`}。`, { kind: 'order', at: dz, lv: 0 });
}
// 飞行：in 进场 → 飞越空降场时按顺序放出伞兵（每 0.18 秒一个班）与重装平台 → out 北返出图
function a101Fly(a, dt) {
  const sp = EA_SPEC[a.type] || EA_SPEC.c17;
  if (a.type !== 'c17') { a.dead = true; return; }   // 旧存档里的黑鹰：直接收回
  const left = a.sq.length + a.veh.length;
  if (a.ph === 'rtb') a.ph = left && dist(a.x, a.y, a.lx, a.ly) < 320 ? 'in' : left ? 'abort' : 'out';   // 中弹：离空降场近就硬着头皮投完，远就带着人北返
  if (a.ph === 'in' || a.ph === 'drop') {
    a.alt = Math.min(.6, a.alt + dt * .2);
    const d = dist(a.x, a.y, a.lx, a.ly);
    if (a.ph === 'in') { eaSteer(a, a.lx, a.ly + 200, dt, sp.spd); if (d < 90 || a.y > a.ly - 20) { a.ph = 'drop'; a.rT = 0; } }
    else {
      eaSteer(a, a.lx, a.ly + 400, dt, sp.spd * .85);
      if ((a.rT -= dt) <= 0) { a.rT = .18; a101Release(a); }
      if (!a.sq.length && !a.veh.length) a.ph = 'out';
    }
    if (a.y > H - 60) a.ph = 'out';
    return;
  }
  a.alt = Math.min(.7, a.alt + dt * .1);
  eaSteer(a, a.x + (a.k % 3 === 1 ? -150 : a.k % 3 === 2 ? 150 : 0), -200, dt, sp.spd);   // 小队两僚机向两侧散开北返
  if (a.y < -50) { a.dead = true; a.home = true; if (a.ph === 'abort' && typeof v8Stat === 'function') v8Stat('a101Abort'); }
}
function a101Release(a) {
  const E1 = a101Ensure(), L = E1.lift && E1.lift.id === a.lift ? E1.lift : null;
  if (a.sq.length) {
    const k = a.sq.shift();
    E1.ch.push({ k: 'team', lift: a.lift, pk: a.k, role: k, men: A101_SQ[k].slice(), x: a.x + gauss() * A101.sig, y: a.y + gauss() * A101.sig, t: 0, hT: 0 });
  } else if (a.veh.length) {
    const v = a.veh.shift();
    E1.ch.push({ k: 'veh', lift: a.lift, pk: a.k, v, x: a.x + gauss() * A101.sig * .6, y: a.y + gauss() * A101.sig * .6, t: 0, hT: 0 });
  }
  if (L && !L.said) {
    L.said = true;
    const wh = typeof cmdWhere === 'function' ? cmdWhere(a.x, a.y) : gridRef(a.x, a.y);
    if (spotted(a.x, a.y) || inVision(a.x, a.y)) log(`敌 C-17 运输机编队在${wh}大规模空降，判断为美军第 101 空降师`, 'bad', null, 0, { x: a.x, y: a.y });
    if (typeof chatSay === 'function') chatSay('p', `报告：${wh}上空 ${S.eair ? S.eair.fly.filter(o => o.type === 'c17' && o.lift === a.lift && !o.dead).length : 3} 架 C-17 运输机正在空投，伞兵与重装平台成串落下，判断为美军第 101 空降师主力！命令：防空火力、战斗机全力拦截，就近部队向空降场开火，趁其集结前打掉。`, { kind: 'report', at: { x: a.x, y: a.y }, key: 'a101s', gap: 60, lv: 0 });
  }
}
// 下降：东北风飘移；伞兵每 0.5 秒挨一次我方地面火力（150 内没被压住的我步兵、220 内的自行高炮 / 弹炮防空车）
function a101Chutes(dt) {
  const E1 = a101Ensure();
  for (const c of E1.ch) {
    c.t += dt; c.x += 3 * dt; c.y -= 2 * dt;
    if (c.k === 'team' && c.men.length && (c.hT -= dt) <= 0) {
      c.hT = .5;
      let pk = 0, src = null;
      for (const q of S.teams) if (q.side === 'p' && q.men.length && q.sup < 70 && !q.ride && dist(q.x, q.y, c.x, c.y) < 150) { pk += .04 * q.men.length / 3; src = src || q; }
      for (const v of S.veh || []) if (v.side === 'p' && !v.dead && (v.type === 'aa_veh' || v.type === 'sam_veh') && dist(v.x, v.y, c.x, c.y) < 220) { pk += .1; src = v; }
      if (src) tracer(src.x, src.y, c.x + gauss() * 4, c.y - (1 - c.t / A101.jump) * 34, 'p', true);
      if (pk && Math.random() < pk) { c.men.splice(Math.floor(Math.random() * c.men.length), 1); S.stats.killed++; const L = E1.lift; if (L && L.id === c.lift) L.lost++; if (typeof v8Stat === 'function') v8Stat('a101AirKill'); }
    }
    if (c.t < (c.k === 'veh' ? A101.heavy : A101.jump)) continue;
    c.done = true;
    a101Land(c);
  }
  if (E1.ch.some(c => c.done)) E1.ch = E1.ch.filter(c => !c.done);
}
// 连队：两个伞兵连 + 侦察组（i = 2）。role = 'bg'：由战斗群（orbat.js）统一指挥，守方其他调度不来抽调
function a101Unit(L, pk, rec) {
  const p = S.points.find(o => o.key === L.key) || S.points[0], i = rec ? 2 : pk === 1 ? 1 : 0;
  if (L.us[i] != null && UNIT_MAP.get(L.us[i])) return UNIT_MAP.get(L.us[i]);
  const n = (S.e101.done || 0) * 2 + i + 1;
  const u = addUnit('e', 'inf', { role: 'bg', obj: p.key, form: 'wedge', a4n: rec ? '第 101 空降师侦察组' : `第 101 空降师 ${n} 连`, morale: rec ? 99 : 92, elite: true });
  L.us[i] = u.id; u.a4T = S.t;
  return u;
}
function a101Land(c) {
  const E1 = a101Ensure(), L = E1.lift && E1.lift.id === c.lift ? E1.lift : null;
  let x = clamp(c.x, 10, W - 10), y = clamp(c.y, 10, H - 10);
  const n = c.k === 'team' ? c.men.length : 0;
  if (isWater(typeAt(x, y))) { if (L) L.lost += n; return; }
  if (!passInf(x, y)) {
    const j = nearestPassable(ci(x, y), c.k === 'veh' ? 'vehe' : 'e');
    if (j < 0 || dist(cellCX(j), cellCY(j), x, y) > 30) { if (L) L.lost += n; return; }
    x = cellCX(j); y = cellCY(j);
  }
  if (!L) return;
  const p = S.points.find(o => o.key === L.key) || S.points[0];
  if (c.k === 'veh') {
    const v = addVehicle('e', c.v.type, x, y, { auto: true, mdl: c.v.mdl, ...(c.v.samX ? { samX: { ...c.v.samX } } : {}), a101: true });
    if (!v) return;
    v.hx = L.dz.x; v.hy = L.dz.y; v.home = L.key;
    v.cmd = { x: L.dz.x + gauss() * 30, y: L.dz.y + gauss() * 30, t: 'move', face: Math.atan2(p.y - L.dz.y, p.x - L.dz.x), until: S.t + 90, ai: 'asm' };   // 先到空降场集合，等战斗群统一行动
    L.vs.push(v.id); L.veh++;
    if (typeof v8Stat === 'function') v8Stat('a101Veh');
    return;
  }
  if (!n) return;
  const rec = c.role === 'rec', u = a101Unit(L, c.pk, rec), k = L.land;
  const q = addTeam('e', x, y, c.men, { role: 'bg', bg: true, obj: p.key, u: u.id, a101: true, mod: { ...A101.mod, ...(A101_ROLE[c.role] || {}) } });
  if (rec) { (L.rec = L.rec || []).push(q.id); q.recon = true; }
  if (q.men.includes('aa')) q.aam = 3;
  const a = k * 2.4, r = 14 + (k % 6) * 6;   // 空降场集合：围成一圈占领环形阵地
  aiGo(q, L.dz.x + Math.cos(a) * r, L.dz.y + Math.sin(a) * r, 'move', p.x, p.y);
  L.land++;
  if (typeof v8Stat === 'function') v8Stat('a101Men', q.men.length);
}
// 被击落（eaLost 调用）：机上剩下的人员与装备全损
function a101Down(a) {
  const E1 = a101Ensure(), L = E1.lift && E1.lift.id === a.lift ? E1.lift : null;
  const n = (a.sq || []).reduce((s, k) => s + A101_SQ[k].length, 0), nv = (a.veh || []).length;
  a.sq = []; a.veh = [];
  if (!n && !nv) return;
  if (L) L.lost += n;
  if (typeof v8Stat === 'function') { v8Stat('a101Lost', n); v8Stat('c17Down'); }
  const what = [n && `${n} 名伞兵`, nv && `${nv} 辆空投车辆`].filter(Boolean).join('和');
  log(`敌 C-17 运输机被击落，机上${what}全部损失`, 'good', null, 0, { x: a.x, y: a.y });
  if (typeof chatSay === 'function') chatSay('p', `报告：击落敌 C-17 运输机 1 架，机上${what}随机损失。`, { kind: 'report', at: { x: a.x, y: a.y }, key: 'c17d' + a.id, gap: 5 });
}
// 每秒：下降中的伞兵 / 平台每步处理；一波结束（运输机都回去或被击落、全部落地）后集合 15 秒，整连交给守方协同
function a101Step(dt) {
  if (!S || S.phase !== 'battle' || S.over || !(typeof eaOn === 'function' && eaOn())) return;
  const E1 = a101Ensure();
  if (E1.ch.length) a101Chutes(dt);
  if ((E1.thT = (E1.thT ?? 1) - dt) > 0) return;
  E1.thT = 1;
  const L = E1.lift;
  if (L && S.t - L.t > 3 && !E1.ch.some(c => c.lift === L.id) && !(S.eair && S.eair.fly.some(a => a.type === 'c17' && a.lift === L.id && !a.dead))) {
    if (L.endT == null) {
      L.endT = S.t;
      if (typeof chatSay === 'function') chatSay('e', `报告：第 101 空降师空降${L.land ? `完成，${L.land} 个班、${L.veh} 辆车落地，正在空降场集合` : '失败'}${L.lost ? `，空中损失 ${L.lost} 人` : ''}。`, { kind: 'report', lv: 1, at: L.dz });
    } else if (S.t - L.endT > 3) {   // 全部落地：整个空降战斗群交给战斗群指挥（orbat.js）统一集合、按队形行动，不分头交给守方协同
      E1.lift = null; E1.done++;
      const p = ptByKey(L.key), n = E1.done;
      const G = bgNew('e', `101 师第 ${n} 旅战斗队`, '旅长', { us: [L.us[0], L.us[1]].filter(id => id != null), vs: L.vs.slice(), rec: (L.rec || []).slice(), ax: L.dz.x, ay: L.dz.y, key: L.key, ech: 'X',
        face: p ? Math.atan2(p.y - L.dz.y, p.x - L.dz.x) : Math.PI / 2 });
      if (L.us[2] != null) { const ur = UNIT_MAP.get(L.us[2]); if (ur) ur.bgId = G.id; }
      bgSay(G, `全群在空降场集合，侦察组 ${G.rec.length} 个先行前出侦察敌情。`);
    }
  }
  a101Think();
}

// 下降中的伞兵（敌方红色伞衣）与重装平台（三具大伞 + 平台）
function a101Draw() {
  const E1 = S && S.e101;
  if (!E1 || !E1.ch || !E1.ch.length || typeof R !== 'object' || !R.ctx) return;
  const ctx = R.ctx, r = Math.max(4, px(5));
  for (const c of E1.ch) {
    if (!inView(c.x, c.y, 60)) continue;   // 天上的伞衣老远就看得见：双方都画
    const T = c.k === 'veh' ? A101.heavy : A101.jump, u = clamp(c.t / T, 0, 1), h = (1 - u) * 40, x = c.x, y = c.y - h, big = c.k === 'veh';
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(c.x, c.y, r * (big ? 1.6 : .9), r * (big ? .8 : .45), 0, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(16,4,6,.85)'; ctx.strokeStyle = rgba(COL.enemy, .95); ctx.lineWidth = px(1.2);
    const cs = big ? [-1, 0, 1] : [0];
    for (const o of cs) { ctx.beginPath(); ctx.arc(x + o * r * 1.8, y - r * (big ? 2.4 : 1.6), r * (big ? 1.2 : 1), Math.PI, 0); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x + o * r * 1.8 - r, y - r * (big ? 2.4 : 1.6)); ctx.lineTo(x, y); ctx.lineTo(x + o * r * 1.8 + r, y - r * (big ? 2.4 : 1.6)); ctx.stroke(); }
    if (big) { ctx.fillStyle = rgba(COL.enemy, .9); ctx.fillRect(x - r * .9, y - r * .3, r * 1.8, r * .9); }
    else { ctx.fillStyle = rgba(COL.enemy, .95); ctx.beginPath(); ctx.arc(x, y, Math.max(1.5, px(2)), 0, 7); ctx.fill(); }
  }
}

HOOK.step.push(a101Step);
HOOK.drawOver.push(a101Draw);
HOOK.newGame.push(() => { if (S) S.e101 = null; });
