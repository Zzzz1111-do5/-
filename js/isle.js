'use strict';
// 架空海岛地图（MAPGEN.isle）：印度洋风格的虚构热带岛屿——地名、设施、守军都是虚构的，不对应任何真实地点。
//   超大海域 6 × 12 公里：岛在北面（图里是岛的南半部，东西两侧的海岸向北收进图边，三面环海），南面是开阔大洋；
//   我方舰队在最南边集结，横渡约 8 公里海面：先打海战夺取制海权，再登岛，在同一张图上打完。
//   地形：中央山脊（热带雨林覆盖、几座裸露的山顶）、三条河（河口红树林沼泽）、向南开口的 U 形港湾（湾底港口镇）、
//   东西两个岬角（悬崖、岸防炮台）、近岸珊瑚礁（海滩、港湾口、河口留出水道）、东部沿海平原上的机场、海滩后面的种植园平地
MAPGEN.isle = { w: 6000, h: 12000, build: buildIsle };

function buildIsle(seed) {
  const r = rng(seed), ph = Array.from({ length: 12 }, () => r() * 6.28);
  const xc = W * .5 + (r() - .5) * 240, hs = W * .47, D = 3300;   // 岛的中线、图上沿处的半宽、南岸离图上沿最远处
  const U = u => xc + u * hs;   // 岛的横向比例位置 → x
  const bay = { x: U(-.33 + (r() - .5) * .04), w: 240 + r() * 40, d: 640 + r() * 100 };   // 港湾：中心、半宽、伸进岛里多深
  const capes = [{ x: U(-.74), ext: 300, w: 210 }, { x: U(.8), ext: 260, w: 190 }];   // 岬角：伸出、半宽
  const coast = new Float32Array(W + 1);
  for (let x = 0; x <= W; x++) {
    const u = (x - xc) / hs, au = Math.abs(u);
    if (au >= 1) { coast[x] = -80; continue; }   // 岛外：整列都是海
    const f = Math.pow(1 - Math.pow(au, 3.5), .45);   // 南岸正面宽而平缓（能登陆的岸段长），东西两侧陡收
    let c = D * f + f * (70 * Math.sin(x / 310 + ph[0]) + 28 * Math.sin(x / 97 + ph[1]) + 11 * Math.sin(x / 41 + ph[2]));
    for (const k of capes) c += k.ext * f * Math.exp(-(((x - k.x) / k.w) ** 2));
    const q = (x - bay.x) / bay.w; c -= bay.d * Math.exp(-((q * q) ** 1.6));   // U 形湾：湾底平、湾口不收窄
    coast[x] = c;
  }
  const cAt = x => coast[clamp(Math.round(x), 0, W)];
  const slope = x => Math.abs(cAt(x + 60) - cAt(x - 60)) / 120;

  // 河流：西、中（主河，发源于图上沿的山地）、东三条；避开港湾与岬角
  const mouths = [U(-.58 + (r() - .5) * .04), U(-.02 + (r() - .5) * .06), U(.3 + (r() - .5) * .04)], main = 1;
  const rivers = mouths.map((mx, k) => {
    const top = k === main ? -1 : cAt(mx) - (1250 + r() * 300), rx = new Float32Array(GH);
    for (let gy = 0; gy < GH; gy++) {
      const y = gy * CELL + 5;
      rx[gy] = y < top || y > cAt(mx) + 40 ? -1e9 : mx + (75 * Math.sin(y / 200 + ph[3] + k * 2) + 26 * Math.sin(y / 63 + ph[4] + k)) * smooth(0, 240, cAt(mx) - y);
    }
    return { mx, top, w: k === main ? 9 : 7, rx };
  });
  const nearMouth = (x, d) => mouths.some(m => Math.abs(x - m) < d), inBay = (x, m = 0) => Math.abs(x - bay.x) < bay.w + m;

  // 机场：东部沿海平原（离海岸约 900），跑道东西向、停机坪朝北（与 mapgen.js afReserve 同一套场区）；流进场区的河改从场区南面发源
  const ax = U(.52 + (r() - .5) * .04), ay = cAt(ax) - 950, hw = (AF_BOX.u1 + 15) * AF_K;
  const afr = { x: Math.round(ax), y: Math.round(ay), h: 0, s: -1, x0: ax - hw, x1: ax + hw, y0: ay - AF_BOX.v1 * AF_K - 20, y1: ay - AF_BOX.v0 * AF_K + 20 };
  for (const [k, rv] of rivers.entries()) {
    if (k === main || rv.mx < afr.x0 - 160 || rv.mx > afr.x1 + 160) continue;
    rv.top = Math.max(rv.top, afr.y1 + 40);
    for (let gy = 0; gy < GH; gy++) if (gy * CELL + 5 < rv.top) rv.rx[gy] = -1e9;
  }

  // 海滩：南岸平缓的岸段上六处（避开河口、港湾、岬角和东西两侧的陡岸）
  const beaches = [], NB = 7, bx0 = U(-.84), bx1 = U(.86), Lb = (bx1 - bx0) / NB;
  const clash = (x0, w) => nearMouth(x0 + w / 2, w / 2 + 90) || inBay(x0 + w / 2, w / 2 + 100) || capes.some(k => Math.abs(x0 + w / 2 - k.x) < k.w * .8 + w / 2) || slope(x0) > .6 || slope(x0 + w) > .6 ||
    beaches.some(b => x0 < b.x1 + 220 && x0 + w > b.x0 - 220);
  for (let i = 0; i < NB; i++) {
    let w = 170 + r() * 80, x0 = bx0 + i * Lb + r() * (Lb - w);
    for (let tries = 0; tries < 60 && clash(x0, w); tries++) { w = Math.max(140, w - 2); x0 = bx0 + i * Lb + r() * (Lb - w); }
    if (clash(x0, w)) continue;
    beaches.push({ name: BEACH_NAMES[beaches.length], x0, x1: x0 + w, cx: x0 + w / 2 });
  }
  const beachAt = x => beaches.findIndex(b => x >= b.x0 && x <= b.x1);

  const nk = n => Math.round(n * 2);
  const noise = valueNoise(r, nk(24), nk(48)), noise2 = valueNoise(r, nk(48), nk(96)), cliffN = valueNoise(r, nk(40), 1);
  const rf = v => { v = ((v % 2) + 2) % 2; return v > 1 ? 2 - v : v; };
  const headland = x => beachAt(x) < 0 && !nearMouth(x, 90) && !inBay(x, 60) && (capes.some(k => Math.abs(x - k.x) < k.w * 1.2) || cliffN(x / W, 0) > .5);
  // 中央山脊与几座主峰（图上沿一带），东西两侧各一片丘陵
  const massif = { x: xc - 380 + r() * 200, y: 520 + r() * 160, r: 760, h: .85 };
  const hills = [massif, { x: U(-.48), y: 900 + r() * 200, r: 500, h: .5 }, { x: U(.3), y: 760 + r() * 160, r: 540, h: .55 }, { x: U(.72), y: 640, r: 380, h: .4 }];
  for (let i = 0; i < 22; i++) { const x = U(-.85 + r() * 1.7); hills.push({ x, y: 200 + r() * Math.max(200, cAt(x) - 900), r: 70 + r() * 110, h: .12 + r() * .22 }); }
  const ridgeY = x => 1050 + 130 * Math.sin(x / 520 + ph[5]) + 60 * Math.sin(x / 170 + ph[6]);

  const type = new Uint8Array(GW * GH), elev = new Float32Array(GW * GH);
  const yMax = Math.min(H, Math.ceil(Math.max(...coast) + 900));   // 再往南全是深海（下面统一填）
  for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
    const x = gx * CELL + 5, y = gy * CELL + 5, i = gy * GW + gx;
    if (y > yMax) { type[i] = T.DEEP; continue; }
    const c = cAt(x), d = c - y, b = beachAt(x);
    if (d <= 0) {   // 海：海滩外是浅水泻湖，河口、港湾有浅滩；外面一圈断续的珊瑚礁（海滩、港湾口、河口留出水道）
      const off = -d, shoalW = b >= 0 ? 95 : nearMouth(x, 100) ? 90 : inBay(x) ? 60 : 38;
      if (off < shoalW) { type[i] = T.SHOAL; continue; }
      const gap = b >= 0 || beachAt(x - 70) >= 0 || beachAt(x + 70) >= 0 || inBay(x, 90) || nearMouth(x, 100) || c < 120;
      type[i] = !gap && off > 150 && off < 270 && noise(rf(x / W * 3), rf(y / H * 3)) > .4 ? T.REEF : T.DEEP;
      continue;
    }
    let e = .06 + Math.min(.18, d / 3000);
    e += .3 * Math.exp(-((y - ridgeY(x)) ** 2) / 90000) * smooth(0, .5, 1 - Math.abs(x - xc) / hs);
    for (const h of hills) e += h.h * Math.exp(-((x - h.x) ** 2 + (y - h.y) ** 2) / (2 * h.r * h.r));
    if (headland(x)) e += .14 * Math.exp(-((d - 70) ** 2) / 9000);   // 岬角：岸边陡起的崖顶
    e += (noise(x / W, y / H) - .5) * .2 + (noise2(x / W, y / H) - .5) * .08;
    e *= lerp(.4, 1, smooth(40, 650, d));   // 沿海平原
    if (b >= 0) e *= lerp(.35, 1, smooth(30, 240, d));   // 海滩后方平缓
    let rd = 1e9, rw = 9;
    for (const rv of rivers) { const dd = Math.abs(x - rv.rx[gy]); if (dd < rd) { rd = dd; rw = rv.w; } }
    e *= lerp(.35, 1, smooth(10, 140, rd));   // 河谷
    e = clamp(1 - Math.exp(-1.35 * Math.max(0, e)), 0, 1);   // 软压缩：高处越来越缓，不会削成一块平顶台地
    elev[i] = e;
    if (x > afr.x0 && x < afr.x1 && y > afr.y0 && y < afr.y1 && rd >= rw) { e = .26 + (e - .26) * .12; elev[i] = e; type[i] = T.FIELD; continue; }   // 机场场区：推平
    let t;
    const mang = (mouths.some(m => dist(x, y, m, cAt(m)) < 300) || (inBay(x, 70) && d < 170)) && e < .34 && noise2(rf(x / W + .5), rf(y / H * 2)) > .34;   // 红树林
    if (rd < rw) t = T.RIVER;
    else if (d < 24) t = b >= 0 ? T.BEACH : headland(x) ? T.CLIFF : mang || nearMouth(x, 80) ? T.MARSH : T.ROCKS;
    else if (mang) t = T.MARSH;
    else if (e > .84) t = T.MOUNT;   // 只有几座山顶是裸露的
    else if (d < 560 && e < .3 && noise2(rf(x / W + .37), rf(y / H + .21)) < .55) t = T.FIELD;   // 海滩后面的种植园、草地
    else if (e > .6 && noise(rf(x / W + .2), rf(y / H + .4)) > .72) t = T.HILL;   // 山上偶尔几片林间空地
    else if (noise2(rf(x / W + .1), rf(y / H + .6)) > .22 || e > .35) t = T.FOREST;   // 热带雨林：大半个岛
    else t = T.FIELD;
    type[i] = t;
  }
  TER = { seed, type, elev, coast, beaches, mouths, rivers, massif, bridges: [], fords: [], points: [], af: { x: afr.x, y: afr.y, h: afr.h, s: afr.s }, afr, isle: true,
    port: { x: bay.x, y: cAt(bay.x) - 75 } };   // 湾底的港口镇（mapgen2.js finishMap 画房子、修路、设据点）
  finishMap(r, cAt, headland);
  TER.pathY = Math.ceil(Math.max(...coast) + 700);   // 寻路带：陆地与近岸；更南的大洋上舰船直接朝目标开（units.js），3D 远海是一块平面
  setPathRows(Math.ceil((TER.pathY + 200) / CELL));
}

// ———————————————— 海岛战役（主菜单「海岛战役」）————————————————
//   架空的热带海岛「棕榈岛」：岛名、地名、设施与守军都是虚构的。守方固定部署（同一个种子，每次一样）；我方按预算在沙盒里自己编成，
//   部署完点「指挥进攻方」或「观战」开战。胜利条件与登陆战役相同：夺取指挥所并控制七成据点分值、坚守 30 秒
//   eB：守方岸上布防的预算；sea：另给舰队、岸舰导弹与航空兵的预算
const ISLE = { seed: 222, p: 14000, eB: 6000, sea: 5000, style: 'bal', lv: 'hard', fleet: ['e_ddg', 'e_ffg', 'e_ffg', 'e_lcs', 'e_lcs'], ascm: 3,
  nm: '跨海登岛', island: '棕榈岛',
  brief: '架空的热带海岛（印度洋风格，岛名、地名、设施与守军都是虚构的）：中央山地覆盖雨林，河口是红树林，南岸六处海滩，湾底有港口镇，东部平原上有机场。舰队在南边大洋上集结，要横渡约 8 公里：守方一支驱护舰编队在岛南数公里外巡弋，岬角和港湾配岸舰导弹，机场有歼击机与攻击机。先夺制海权、制空权，再强行登岛，夺取指挥所。' };
function isleStart() {
  if (typeof openSandbox !== 'function') return;
  if (typeof mnHide === 'function') mnHide();
  if (typeof MENU === 'object') { MENU.pausedBy = false; MENU.game = true; MENU.last = 'isle'; }
  if (typeof U === 'object') U.level = ISLE.lv;
  if (typeof document !== 'undefined') { for (const id of ['brief', 'end']) { const e = document.getElementById(id); if (e) e.hidden = true; } }
  if (typeof sbxAIAttack === 'function' && !sbxAIAttack.isle) {   // 「AI 帮我部署」：原方案按标准预算配、用不完，在海岛上把余款补成海空兵力
    const f0 = sbxAIAttack;
    sbxAIAttack = function (...a) { const r = f0.apply(this, a); if (S && S.lv && S.lv.isle) isleTopUp(); return r; };
    sbxAIAttack.isle = true;
  }
  openSandbox(ISLE.seed, false, 'isle');
  S.level = ISLE.lv;
  S.lv = { n: 0, kind: 'landing', nm: ISLE.nm, isle: true };
  S.sbx.budget = { p: ISLE.p, e: ISLE.eB };
  isleDefend();
  S.sbx.budget.e = Math.max(sbxSpent('e'), 1);
  S.sbx.notes.e = [];
  if (typeof SBX === 'object') { SBX.side = 'p'; SBX.sty.p = 'bal'; SBX.dir = { main: -1, feint: -2 }; SBX.pick = null; }
  isleIntel();
  if (typeof sbxRender === 'function') sbxRender();
  if (typeof sbxMsg === 'function') sbxMsg(`海岛战役「${ISLE.nm}」：预算 ${ISLE.p} 点，部署完点「指挥进攻方」或「观战」开战`);
  if (typeof updateHud === 'function') updateHud();
}
// 守方固定部署：岸上按风格布防，再另给预算——驱护舰编队在岛南 2.4–3.4 公里的海面成编队巡弋，岬角炮台与港湾两侧配岸舰导弹排，
//   岛上机场停歼击机与攻击机；不编入任何真实部队番号（sandbox.js sbxCheck 挡掉第 101 空降师）
function isleDefend() {
  const mr = Math.random;
  Math.random = rng(ISLE.seed ^ 0x2545f491);   // 布防里的随机数换成按种子的：每次一样
  try {
    sbxAIDefend(ISLE.style);
    S.sbx.budget.e = sbxSpent('e') + ISLE.sea;
    const cx = clamp(W / 2 + (Math.random() - .5) * 500, 600, W - 600), base = coastAt(cx) + 2400;
    const slots = [[0, 0], [-260, 120], [260, 120], [-520, 260], [520, 260], [0, 360]];
    ISLE.fleet.forEach((id, i) => {
      const [dx, dy] = slots[i % slots.length];
      for (let k = 0; k < 30; k++) { const x = clamp(cx + dx + (k % 5 - 2) * 40, 200, W - 200), y = Math.min(STAGING_Y - 1500, base + dy + Math.floor(k / 5) * 40); if (sbxPlace(id, x, y).ok) break; }
    });
    const capes = S.points.filter(p => /^BT/.test(p.key)), pt = S.points.find(p => p.key === 'PT');
    for (const x of [...capes.map(p => p.x), ...(pt ? [pt.x - 330, pt.x + 330] : [])].slice(0, ISLE.ascm)) sbxTry('e_ascm', x, coastAt(x) - 120, 100);
    for (const id of ['e_air_ftr', 'e_air_ftr', 'e_air_ftr', 'e_air_ga', 'e_air_ga']) sbxPlace(id);
  } finally { Math.random = mr; }
  sbxSync();
}
// 余款：多开一条增援线、编后备步兵（滩头站稳后经增援线陆续上岸），再加几艘驱护舰（南边集结海域）和舰载机（航母机库装得下为止）——
//   各有上限，不为花光预算堆舰堆机（舰船、飞机多了推演也慢）；剩下的点数留给玩家自己加
const ISLE_TOP = [['p_rline', 1], ['p_reserve', 12], ['p_lci', 4], ['p_dd_h', 2], ['p_cl', 1], ['p_dd_e', 1], ['p_air_ftr', 4], ['p_air_strike', 4], ['p_air_ftr_adv', 2], ['p_air_ew', 1], ['p_air_heavy', 2]];   // p_lci：第二梯队登陆舰（各载一个加强排），滩头出口夺取后再靠岸
function isleTopUp() {
  let n = 0, k = 0;
  for (const [id, cap] of ISLE_TOP) for (let i = 0; i < cap && sbxLeft('p') >= 60; i++) {
    const c = typeof catalogById === 'function' && catalogById(id);
    if (!c) break;
    let r;
    if (c.spawn.at === 'sea') { const p = sbxSea(W / 2 + ((k % 7) - 3) * 170, STAGING_Y + 40 + (k % 3) * 50); k++; r = sbxPlace(id, p.x, p.y); }
    else r = sbxPlace(id);
    if (!(r && r.ok)) break;
    if (c.spawn.kind === 'ship') r.it.wave = 2;
    n++;
  }
  if (n && typeof sbxSay === 'function') sbxSay('p', `海岛方案补充：再编 ${n} 项——多开一条增援线、后备步兵经增援线陆续上岸，第二梯队登陆舰在滩头出口夺取后靠岸；加派驱护舰与舰载机，先打掉守方舰队与岸舰导弹、夺取制海权，再登岛。`, 'plan');
  sbxSync();
}
// 情报（有误差）：面板顶部、聊天里的简报，地图上画大致位置圈（看不到守方的具体部署）
function isleIntel() {
  const E = S.sbx.items.filter(it => it.side === 'e'), ent = it => sbxEntry(it) || {}, rings = [], lines = [];
  const fuzz = n => n <= 0 ? '无' : n <= 2 ? `${n} 左右` : `约 ${Math.max(1, Math.round(n * (.75 + Math.random() * .5)))}`;
  const ring = (x, y, nm) => rings.push({ x: x + (Math.random() - .5) * 260, y: y + (Math.random() - .5) * 180, r: 200, nm });
  const sh = E.filter(it => ent(it).spawn && ent(it).spawn.kind === 'eship');
  if (sh.length) { lines.push(`海上：岛南海面有敌水面编队 ${fuzz(sh.length)} 艘，含宙斯盾驱逐舰——区域防空强，单发、亚音速导弹多半被拦。`); ring(sh.reduce((a, it) => a + it.x, 0) / sh.length, sh.reduce((a, it) => a + it.y, 0) / sh.length, '敌舰队'); }
  const asc = E.filter(it => it.cat === 'e_ascm');
  if (asc.length) { lines.push(`岸舰导弹排 ${fuzz(asc.length)} 个（岬角、港湾一带），射程 1600，舰船靠近海岸当心。`); for (const it of asc) ring(it.x, it.y, '岸舰导弹'); }
  const air = E.filter(it => ent(it).spawn && ent(it).spawn.kind === 'ewing').length;
  if (TER.af) { lines.push(`空中：东部平原上有机场（自带雷达、防空），飞机 ${fuzz(air)} 架。`); ring(TER.af.x, TER.af.y, '敌机场'); }
  const BS = typeof sbxBeaches === 'function' ? sbxBeaches() : [];
  if (BS.length) {
    const st = BS.map(B => ({ B, n: E.filter(it => it.x != null && Math.abs(it.x - B.b.cx) < 260 && coastAt(it.x) - it.y < 300).length })).sort((a, b) => b.n - a.n), top = Math.max(1, st[0].n);
    lines.push(`滩头设防（航空照相判读）：${st.map(o => `${o.B.b.name}${o.n >= top * .7 ? '强' : o.n >= top * .35 ? '中' : '弱'}`).join('、')}。`);
  }
  S.isleIntel = { rings };
  S.sbx.notes.p = [`海岛战役「${ISLE.nm}」：${ISLE.brief}`, ...lines.map(t => '情报：' + t)];
  if (typeof chatSay === 'function') chatSay('sys', `「${ISLE.island}」情报简报：${lines.join(' ')}`, { kind: 'intel', lv: 0 });
}
// 部署时：地图上的情报圈；面板只编进攻方（守方预算、存读档、换图这些按钮藏起来）
const ISLE_CSS = `#sbxPanel.isle .sbx-sides button.e, #sbxPanel.isle [data-act="bud-"], #sbxPanel.isle [data-act="bud+"], #sbxPanel.isle [data-act="save"], #sbxPanel.isle [data-act="loads"],
#sbxPanel.isle .sbx-seedin, #sbxPanel.isle [data-act="map"], #sbxPanel.isle .sbx-lv, #sbxPanel.isle [data-act="preset"] { display: none; }`;
HOOK.frame.push(function isleFrame() {
  if (typeof SBX !== 'object' || !SBX.el || typeof document === 'undefined') return;
  const on = !!(S && S.lv && S.lv.isle);
  if (on && !document.getElementById('isleCss')) { const st = document.createElement('style'); st.id = 'isleCss'; st.textContent = ISLE_CSS; document.head.appendChild(st); }
  SBX.el.classList.toggle('isle', on);
  if (on && SBX.side === 'e' && S.phase === 'sandbox') { SBX.side = 'p'; if (typeof sbxRender === 'function') sbxRender(); }   // 守方固定部署：不让切过去改
});
HOOK.drawOver.push(function isleDraw() {
  if (!S || !S.lv || !S.lv.isle || !S.isleIntel || S.phase !== 'sandbox' || typeof R !== 'object' || !R.ctx) return;
  const ctx = R.ctx;
  ctx.save(); ctx.setLineDash([px(6), px(5)]); ctx.lineWidth = px(1.4); ctx.textAlign = 'center';
  for (const g of S.isleIntel.rings) {
    ctx.strokeStyle = rgba(COL.enemy, .55); ctx.fillStyle = rgba(COL.enemy, .06);
    ctx.beginPath(); ctx.arc(g.x, g.y, g.r, 0, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = rgba(COL.enemy, .8); ctx.font = font(12); ctx.fillText(g.nm + '？', g.x, g.y);
  }
  ctx.restore();
});
