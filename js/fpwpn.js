'use strict';
// 战机武器系统（亲自驾驶飞机时，v3pilot.js）：数字键选武器（再按一次收起），F / 鼠标左键开火，空格机炮（按住连发，有航炮的机型）——
//   选中时打开对应的弹舱门（v3g.js 画舱门、舱里的弹），歼-20 的侧弹舱门开了以后挂架把霹雳-10 推出舱外；外挂的不用等；
//   平显：选中武器的大环——导引头 / 火控雷达能锁定的偏离角，按真实角度画在视野里；环里、射程内的目标都标一个小菱形，
//     其中一个是「选定目标」（默认离机头最近的；R 键或鼠标右键单击换下一个），只有它在锁定：框是绿的，锁稳了变红——
//     红了才能打（导弹）；按开火时还在锁就等锁稳了自动打出去（按下后 2.5 秒内）。滑翔炸弹没有选定目标时可以投在准星下的地面上
//   弹按真实参数在三维里飞：内埋的先被弹射臂推出舱外再点火，侧弹舱、外挂的在挂架上点火；助推加速、比例导引、过载限制、近炸引信；
//     空空命中按单发杀伤概率结算（missile.js msSamHit：隐身、干扰弹打折），对地按精确制导弹药的毁伤（missile.js msPgmHit）
//   画面右下角是武器表：每种弹的键位、余弹，机炮余弹；选中的那行亮着
const FW_G = 9.81, FW_A = 340, FW_HUD = '#7dffb0', FW_RED = '#ff4a4a';   // 重力加速度、音速（米 / 秒，低空）、平显绿、锁定红
// 武器的真实参数（公开资料；官方未公布的按外界估算）：nm 名称、k 种类（aam 空空 / arm 反辐射 / agm 空地 / gb 制导炸弹）、sk 导引（rf 主动雷达 / ir 红外成像 / tv 电视 / gps 卫星惯导 / ar 被动雷达）、
//   M 最大马赫数（炸弹 0：没有发动机，滑翔）、R 最大射程（公里；炸弹另按投放高度、速度算滑翔距离，LD 升阻比）、Rmin 最小射程（米）、tb 发动机工作秒数（KD-88 是涡喷，一直有推力）、
//   g 最大过载、cone 大环半径（度）、lk 锁稳要几秒、pk 单发杀伤概率、ms 3D 弹形（v3msl.js V3MS）、pg 对地毁伤（missile.js MS_PGM）
const FW_W = {
  pl15: { nm: '霹雳-15', k: 'aam', sk: 'rf', M: 4, R: 200, Rmin: 1000, tb: 8, g: 40, cone: 15, lk: 1.2, pk: .8, ms: 'pl15' },   // 4 米 × 203 毫米、约 210 公斤，双脉冲发动机，有源相控阵导引头 + 双向数据链；射程外界估算 200 公里以上
  pl10: { nm: '霹雳-10', k: 'aam', sk: 'ir', M: 4, R: 20, Rmin: 300, tb: 4, g: 60, cone: 20, lk: .6, pk: .85, ms: 'pl10' },   // 3 米 × 160 毫米、89 公斤，红外成像导引头 ±90° 离轴发射，推力矢量
  pl17: { nm: '霹雳-17', k: 'aam', sk: 'rf', M: 4, R: 400, Rmin: 3000, tb: 14, g: 25, cone: 12, lk: 1.6, pk: .7, ms: 'pl17' },   // 约 6 米，打预警机、加油机一类的大目标；射程外界估算约 400 公里
  ld10: { nm: '雷电-10', k: 'arm', sk: 'ar', M: 3, R: 60, Rmin: 2000, tb: 8, g: 20, cone: 25, lk: 1, pk: .8, ms: 'ld10', pg: 'ld10' },   // 反辐射导弹（霹雳-12 的弹体改），追防空雷达的辐射；出口型射程 60 公里
  kd88: { nm: 'KD-88', k: 'agm', sk: 'tv', M: .85, R: 180, Rmin: 3000, tb: 1e9, g: 8, cone: 8, lk: 1.5, pk: .9, ms: 'kd88', pg: 'kd88' },   // 涡喷动力亚音速空地导弹，末段电视 / 红外成像，射程约 180 公里
  ft8: { nm: '飞腾-8', k: 'gb', sk: 'gps', M: 0, R: 60, LD: 7, Rmin: 500, g: 6, cone: 10, lk: .8, pk: .9, ms: 'sdb', pg: 'ft8' },   // 百公斤级小直径炸弹：展开弹翼滑翔，卫星惯导 + 末端成像
  ls6: { nm: '雷石-6', k: 'gb', sk: 'gps', M: 0, R: 60, LD: 6, Rmin: 800, g: 4, cone: 12, lk: 1, pk: .9, ms: 'bomb', pg: 'ls6' },   // 500 公斤级航弹加滑翔组件，高空投放约 60 公里（歼-16 对地满挂 6 枚）
  kd20: { nm: '空地-20', k: 'agm', sk: 'gps', M: .75, R: 1500, Rmin: 5000, tb: 1e9, g: 3, cone: 10, lk: 2, pk: .9, ms: 'kd20', pg: 'kd20' },   // 长剑-20 的空射型（轰-6K 翼下 6 枚）：涡扇动力亚音速巡航导弹，惯导 + 卫星 + 地形匹配，射程外界估算 1500 公里以上
  ba7: { nm: '蓝箭-7', k: 'agm', sk: 'tv', M: 1, R: 8, Rmin: 500, tb: 3, g: 15, cone: 10, lk: .8, pk: .9, ms: 'agm', pg: 'ba7' }   // 攻击-2 翼下 4 枚：半主动激光 / 红外成像的轻型空地导弹（射程按外界估算）
};
// 每型飞机挂什么、挂在哪（main 主弹舱 / side 侧弹舱 / ext 外挂）；数量从推演里的计数分出来——o.aam 是中距 + 近距的总数，sr 是近距弹分走的枚数
//   数量都按真实的典型挂法（carrier.js 型号表 AIR_MDL 的计数，AI 出击、2D / 3D 画的弹都是这个数）
const FW_LOAD = {
  j20: [{ w: 'pl15', bay: 'main' }, { w: 'pl10', bay: 'side', sr: 2 }],   // 主弹舱 4 枚霹雳-15，两侧小弹舱各 1 枚霹雳-10
  j50: [{ w: 'pl15', bay: 'main' }, { w: 'pl10', bay: 'main', sr: 2 }],
  j35: [{ w: 'ft8', bay: 'main' }, { w: 'pl15', bay: 'main' }],   // 主弹舱：内侧前后两排 4 枚飞腾-8，外侧 2 枚霹雳-15 自卫
  j35s: [{ w: 'ld10', bay: 'main' }],   // 主弹舱 4 枚雷电-10
  j16d: [{ w: 'ld10', bay: 'ext' }, { w: 'pl15', bay: 'ext' }],
  j16: [{ w: 'ls6', bay: 'ext' }, { w: 'pl15', bay: 'ext' }, { w: 'pl10', bay: 'ext', sr: 2 }],   // 对地满挂：6 枚雷石-6（翼下内侧、中间、进气道下），外侧 2 枚霹雳-15、翼尖 2 枚霹雳-10   // 翼下内侧、中间挂架 4 枚雷电-10，外侧 2 枚霹雳-15；翼尖、进气道下的电子战吊舱见 FW_POD
  j16m: [{ w: 'pl15', bay: 'ext' }, { w: 'pl10', bay: 'ext', sr: 2 }],   // 导弹卡车：8 枚霹雳-15（翼下内侧、中间、外侧，进气道下），翼尖 2 枚霹雳-10
  j15t: [{ w: 'kd88', bay: 'ext' }, { w: 'pl15', bay: 'ext' }, { w: 'pl10', bay: 'ext', sr: 2 }],   // 翼下内侧 2 枚 KD-88、外侧 2 枚霹雳-15、翼尖 2 枚霹雳-10
  h6k: [{ w: 'kd20', bay: 'ext' }],   // 翼下 6 个挂架各 1 枚空地-20（推演里由 AI 发射：carrier.js bomberStd）
  gj2: [{ w: 'ba7', bay: 'ext' }]   // 两侧内挂架的双联导轨各 2 枚蓝箭-7
};
// 不消耗的吊舱（一直挂着画）：[弹形（v3msl.js V3MS）, 挂点组]——歼-16D 翼尖电子战吊舱（取代翼尖导弹导轨）、进气道下两个大型电子干扰吊舱
const FW_POD = { j16d: [['tpod', 'tip'], ['jpod', 'jpod']] };
// 航炮（真实参数）：歼-15、歼-16 是侧卫系的 GSh-30-1 30 毫米单管航炮——右侧边条根部，射速约 1650 发 / 分、初速 860 米 / 秒、备弹 150 发（约 5.5 秒）；
//   歼-20、歼-35、歼-50 没有航炮（隐身机身上没有炮口），歼-16D 拆掉了航炮换电子战设备。at：炮口（模型坐标，米：x 前、y 左、z 上）
const FW_GUN = { j15t: { nm: '30 毫米航炮', n: 150, rpm: 1650, v0: 860, at: [3.9, -1.5, 2.55] }, j16: { nm: '30 毫米航炮', n: 150, rpm: 1650, v0: 860, at: [3.9, -1.5, 2.1] } };
FW_GUN.j16m = FW_GUN.j16;
const fwGunOf = o => o ? FW_GUN[airMdlKey(o.kind, o.v)] || null : null;
// 海战（navy.js 给的 p.asm）：出击时换挂的反舰导弹画在哪组挂点、几枚——轰-6K 换挂 2 枚鹰击-12（占内侧两个挂架，不挂空地-20），歼-35 翼下外挂 2 枚鹰击-83K（弹舱装不下）
const FW_ASM = { h6k: { st: 'kd20', n: 2 }, j31: { st: 'asm', n: 2 } };
// 推演里的计数字段：空空弹 aam（霹雳-17 是 aamL），空地导弹、滑翔炸弹 agmN，小直径炸弹、反辐射弹 gbN（carrier.js 的型号表）
const fwField = w => w === 'pl17' ? 'aamL' : FW_W[w].k === 'aam' ? 'aam' : FW_W[w].k === 'agm' ? 'agmN' : 'gbN';   // 滑翔炸弹（飞腾-8、雷石-6）、反辐射弹都记在 gbN
// 挂点（模型坐标，米：x 前、y 左、z 上；对着用户给的模型的弹舱量的，见 v3g.js V3G_BAY）：main 主弹舱（长弹一排；mainS：短弹前后两排）、
//   side 侧弹舱（sideX：挂架推出舱外以后）、ext 外挂；舱里的弹按剩几枚画几枚，发射时从下一个挂点出去
const FW_ST = {
  // 歼-20（新模型，起落架补上、整架抬高 1.25 米后的坐标）：主弹舱内侧两枚、外侧两枚霹雳-15 挂在舱顶下；侧弹舱里一枚霹雳-10，开舱后连挂架推出舱外、往下
  j20: { main: [[.05, .2, 1.37], [.05, -.2, 1.37], [.05, .56, 1.36], [.05, -.56, 1.36]], mainS: [[1.2, .2, 1.37], [1.2, -.2, 1.37], [-1, .2, 1.37], [-1, -.2, 1.37], [1.2, .55, 1.36], [1.2, -.55, 1.36], [-1, .55, 1.36], [-1, -.55, 1.36]],
    side: [[.15, 1.32, 2], [.15, -1.32, 2]], sideX: [[.15, 1.75, 1.6], [.15, -1.75, 1.6]] },
  j31: { main: [[0, .3, 1.28], [0, -.3, 1.28], [0, .7, 1.26], [0, -.7, 1.26]], mainS: [[.95, .3, 1.24], [.95, -.3, 1.24], [-.95, .3, 1.24], [-.95, -.3, 1.24], [.95, .7, 1.22], [.95, -.7, 1.22], [-.95, .7, 1.22], [-.95, -.7, 1.22]],
    pl15: [[0, .7, 1.26], [0, -.7, 1.26]], ft8: [[.95, .3, 1.24], [.95, -.3, 1.24], [-.95, .3, 1.24], [-.95, -.3, 1.24]],   // 对地挂法：霹雳-15 在外侧一排，飞腾-8 在内侧前后两排
    asm: [[-.9, 3, 1.42], [-.9, -3, 1.42]] },   // 翼下挂架（机翼下表面约 1.83 米）：海战外挂的鹰击-83K
  // 歼-16：翼下内侧、中间挂架（ext / 雷电-10），外侧挂架（霹雳-15），翼尖（电子战吊舱，取代导弹导轨），进气道下（大型干扰吊舱）
  // 霹雳-15：外侧挂架两枚在前（对地满挂只挂这两枚），导弹卡车再挂中间、内侧挂架和两个进气道挂点（共 8 枚）
  j16: { ext: [[-.6, 2.6, 1.02], [-.6, -2.6, 1.02], [-1.2, 4.1, 1.12], [-1.2, -4.1, 1.12]], pl15: [[-4, 5.9, 1.04], [-4, -5.9, 1.04], [-1.2, 4.1, 1.15], [-1.2, -4.1, 1.15], [-.6, 2.6, 1.05], [-.6, -2.6, 1.05], [1, 1.4, .9], [1, -1.4, .9]],
    tip: [[-4.9, 7.51, 1.36], [-4.9, -7.51, 1.36]], jpod: [[1, 1.4, .85], [1, -1.4, .85]],
    // 对地满挂（歼-16，不是 D 型）：500 公斤级炸弹比雷电-10 粗，弹心再低一点；进气道下两枚先打（离机身中线近、投放时不碰外侧的）
    ls6: [[.7, 1.4, .66], [.7, -1.4, .66], [-1.2, 4.1, .94], [-1.2, -4.1, .94], [-.5, 2.6, .84], [-.5, -2.6, .84]], pl10: [[-4.9, 7.51, 1.36], [-4.9, -7.51, 1.36]] },
  // 歼-15：翼下内、外侧挂架（v3g.js V3G_FOLD 补的挂架，下沿 2.27 / 2.30 米；位置照模型原来挂的弹），弹心在挂架下沿下面一个弹半径；重弹（鹰击 / KD-88）挂内侧，霹雳-15 外侧，霹雳-10 在翼尖导轨上——都在折叠线外，折翼时跟着翻
  j15: { ext: [[-4.1, 5.65, 2.15], [-4.1, -5.65, 2.15], [-2.64, 3.88, 2.09], [-2.64, -3.88, 2.09]],
    kd88: [[-2.64, 3.88, 2.09], [-2.64, -3.88, 2.09]], pl15: [[-4.1, 5.65, 2.15], [-4.1, -5.65, 2.15]], pl10: [[-5.4, 7.66, 2.48], [-5.4, -7.66, 2.48]] },
  // 轰-6K（模型转过 180°，这里是转过以后的坐标）：翼下外、中、内三对挂架，弹顶离机翼下表面约 0.12 米；外侧的先打
  h6k: { kd20: [[-3.75, 12.5, 1.96], [-3.75, -12.5, 1.96], [-1.6, 9.5, 2.12], [-1.6, -9.5, 2.12], [.6, 6.5, 2.26], [.6, -6.5, 2.26]] },
  // 攻击-2（用 MQ-9 的外形）：两侧内挂架（下沿约 1.15 米）的双联导轨
  'mq9~': { ba7: [[-.2, 2.06, 1.04], [-.2, -2.06, 1.04], [-.2, 1.74, 1.04], [-.2, -1.74, 1.04]] },
  // 歼-50：一个舱里挂两种弹，按武器各给一组挂点（不互相重叠；先打的排前面——靠舱门的下层先出去）。模型补了起落架、整架抬高过（v3g.js V3G_GEAR），高度按抬高后的；
  //   两个机腹弹舱（中间隔着一道中线凹槽，公开照片的样子）：每舱下层两枚、上层一枚霹雳-15，霹雳-10 在上层内侧
  j50: { pl15: [[-.8, .75, 1.51], [-.8, -.75, 1.51], [-.8, 1.45, 1.51], [-.8, -1.45, 1.51], [-.8, 1.1, 1.81], [-.8, -1.1, 1.81]], pl10: [[-1.1, .72, 1.82], [-1.1, -.72, 1.82]] }
};
// 这一舱这种弹用哪组挂点：按武器单给的优先（w 武器键），否则短弹前后两排（mainS）、长弹一排
const fwSlots = (T, bay, Wd, w) => (w && bay !== 'side' && T[w]) || (bay === 'main' && T.mainS && ((typeof V3MS === 'object' && V3MS[Wd.ms]) || {}).L <= 2.4 ? T.mainS : T[bay]) || null;

// —— 挂载 ——
// 接手时把推演里的计数分到各型弹上（AI 飞的时候打掉了几枚就少几枚）；之后两边一起减，交回 AI 时它照样知道还剩多少
// 挂载每一行在 o.fwN 里的键：这种弹只占一行就是弹名（和原来一样，老存档照用）；同一种弹放在几处（编辑器里主弹舱 + 外挂各一行）各行分开记，不再互相盖掉
const fwKey = (L, i) => { const w = L[i].w; let n = 0; for (const s of L) if (s.w === w) n++; return n > 1 ? w + '#' + i : w; };
const fwKeyOf = (L, s) => s.key || fwKey(L, L.indexOf(s));
function fwInit(o) {
  const M = airMdl(o.kind, o.v), L = FW_LOAD[airMdlKey(o.kind, o.v)] || [], G = fwGunOf(o);
  if (G && o.gunN == null) o.gunN = G.n;   // 航炮备弹（交回 AI 再接手时接着用）
  const tot = { aam: o.aam ?? M.aam ?? 0, aamL: o.aamL ?? M.aamL ?? 0, gbN: o.gbN ?? M.gbN ?? 0, agmN: o.agmN ?? M.agmN ?? 0 };
  // 一行能分到的上限：编辑器的挂载每行写着几枚（n），型号表原来的挂载不写（这一类弹剩多少都归它）
  const cap = f => L.reduce((a, s) => a + (fwField(s.w) === f ? s.n ?? Infinity : 0), 0);
  const have = f => L.reduce((a, s, i) => a + (fwField(s.w) === f ? (o.fwN || {})[fwKey(L, i)] || 0 : 0), 0);
  if (o.fwN && Object.keys(tot).every(f => have(f) === (L.some(s => fwField(s.w) === f) ? Math.min(tot[f], cap(f)) : 0))) return;   // 没变就不重分
  const N = {}, put = (s, i, want) => { const f = fwField(s.w), k = fwKey(L, i), c = Math.max(0, Math.min(want, tot[f])); N[k] = (N[k] || 0) + c; tot[f] -= c; };
  L.forEach((s, i) => { if (s.sr != null) put(s, i, Math.min(s.sr, s.n ?? Infinity)); });   // 近距弹先分（侧弹舱各一枚）
  L.forEach((s, i) => { if (s.sr == null) put(s, i, s.n ?? Infinity); });
  o.fwN = N;
}
const fwList = o => { const L = FW_LOAD[airMdlKey(o.kind, o.v)] || []; return L.map((s, i) => { const key = fwKey(L, i); return { ...s, key, W: FW_W[s.w], n: (o.fwN || {})[key] || 0 }; }); };
const fwSelW = () => { const o = V3FP.o; return o && V3FP.k === 'air' && V3FP.ws >= 0 ? fwList(o)[V3FP.ws] || null : null; };
// 还剩几枚（交回 AI 时打光了就返航）
const fwLeft = o => fwList(o).reduce((a, s) => a + s.n, 0);
// 列表里的一行：「霹雳-15 ×4 · 霹雳-10 ×2」
const fwSum = o => { fwInit(o); return fwList(o).map(s => `${s.W.nm} ×${s.n}`).join(' · '); };
function fwTake(o) {
  fwInit(o);
  Object.assign(V3FP, { ws: -1, lk: {}, fwC: [], fwT: null, tgK: null, lkT: 0, bay: { main: 0, side: 0, ext: 0 }, bul: [], gunA: 0 });
}
// 数字键：选第 i 种（再按一次收起，舱门关上）
function fwSel(i) {
  const o = V3FP.o, L = o ? fwList(o) : [];
  if (!L[i]) return;
  V3FP.ws = V3FP.ws === i ? -1 : i;
  V3FP.lk = {}; V3FP.lkT = 0;
  if (V3FP.ws >= 0 && !(L[i].n > 0)) fwMsg(`${L[i].W.nm}已经打光了`);
}
// 手柄 Y、手机「武器」：换下一种（最后一种之后收起）
function fwNext() { const o = V3FP.o, n = o ? fwList(o).length : 0; if (n) { V3FP.ws = V3FP.ws + 1 >= n ? -1 : V3FP.ws + 1; V3FP.lk = {}; V3FP.lkT = 0; } }
// 交回 AI：舱门关上
function fwRelease() { V3FP.ws = -1; V3FP.lk = {}; V3FP.fwC = []; V3FP.fwT = null; V3FP.tgK = null; V3FP.lkT = 0; V3FP.bay = { main: 0, side: 0, ext: 0 }; V3FP.bul = []; }

// —— 弹舱门：选中的那一舱打开（主舱约 0.5 秒）；侧弹舱先开门（0.4 秒）再把挂架推出去（0.4 秒），收的时候反过来 ——
function fwDoors(dt) {
  const s = fwSelW(), B = V3FP.bay || (V3FP.bay = { main: 0, side: 0, ext: 0 }), want = s ? s.bay : null;
  B.main = clamp(B.main + (want === 'main' ? dt : -dt) / .5, 0, 1);
  if (want === 'side') { B.side = clamp(B.side + dt / .4, 0, 1); if (B.side >= 1) B.ext = clamp(B.ext + dt / .4, 0, 1); }
  else { B.ext = clamp(B.ext - dt / .4, 0, 1); if (B.ext <= 0) B.side = clamp(B.side - dt / .4, 0, 1); }
}
const fwReady = s => s.bay === 'main' ? V3FP.bay.main >= .98 : s.bay === 'side' ? V3FP.bay.ext >= .98 : true;
// 画飞机时要的弹舱状态（v3units.js → v3g.js）：玩家开的按选中的武器；AI 的按发射时刻（airmdl.js airRelState：开舱、弹射、关舱）
function fwBay(o, side) {
  if (side !== 'e' && V3FP.on && V3FP.o === o && V3FP.bay) return V3FP.bay;
  const r = typeof airRelState === 'function' ? airRelState(side || 'p', o.id) : null;
  return r ? { main: r.bay, side: r.sbay, ext: r.sbay } : null;
}

// 飞机身上的弹（v3units.js 画飞机时调用，o 我方飞机，x y z h pt rl sz 与画飞机同一套）：外挂的一直画；弹舱打开时画舱里的——玩家开的画选中的那种，AI 的画这一舱的头一种；
//   剩几枚画几枚（打掉的从第一个挂点开始空）；侧弹舱的弹随挂架推出舱外（ext）
function fwBayMsl(o, key, sz, x, y, z, h, pt, rl, bay) {
  const mk = fpMdlKey(o), T = FW_ST[mk], L = FW_LOAD[airMdlKey(o.kind, o.v)];
  if (!T || !L || typeof v3gAt !== 'function' || typeof v3gMsl !== 'function' || !V3G.M[mk]) return;
  fwInit(o);
  const sel = V3FP.on && V3FP.o === o ? fwSelW() : null, k = sz / V3G.M[mk].meta.len, A = o.asm && o.asm.w && FW_ASM[mk];
  const put = (ms, v) => { const p = v3gAt(key, sz, x, y, z, h, pt, rl, v); if (p) v3gMsl(ms, p[0], p[1], p[2], h, k, 0, pt); };
  L.forEach((s, j) => {   // 翼下挂架：每种弹挂在自己那组挂点上，剩几枚画几枚（打掉的从第一个挂点开始空）
    const st = s.bay === 'ext' && (T[s.w] || T.ext);
    if (!st || (A && A.st === s.w)) return;   // 这组挂点换挂了反舰导弹（下面画）
    for (let i = st.length - Math.min((o.fwN || {})[fwKey(L, j)] || 0, st.length); i < st.length; i++) put(FW_W[s.w].ms, st[i]);
  });
  if (A && T[A.st]) for (let i = Math.max(0, T[A.st].length - A.n); i < T[A.st].length; i++) put(o.asm.w, T[A.st][i]);   // 海战换挂的反舰导弹（打出去以后 navy.js 清掉 p.asm）
  for (const [ms, sk] of FW_POD[airMdlKey(o.kind, o.v)] || []) for (const v of T[sk] || []) put(ms, v);   // 电子战吊舱
  for (const bk of ['main', 'side']) {
    if (!bay || !(bay[bk] > .02)) continue;
    const own = L.filter(q => q.bay === bk);   // 每种弹都有自己的挂点（不重叠）：舱里的全画；共用一组挂点的只画选中的那种（AI 的画头一种）
    const ss = own.length && own.every(q => T[q.w]) ? own : [sel && sel.bay === bk ? sel : own[0]].filter(Boolean);
    for (const s of ss) {
      const Wd = FW_W[s.w], st = fwSlots(T, bk, Wd, s.w), n = Math.min((o.fwN || {})[fwKeyOf(L, s)] || 0, st ? st.length : 0), e = bk === 'side' ? bay.ext || 0 : 0;
      for (let i = st ? st.length - n : 0; st && i < st.length; i++) {
        const a = st[i], X = bk === 'side' && T.sideX ? T.sideX[i % T.sideX.length] : a, p = v3gAt(key, sz, x, y, z, h, pt, rl, [lerp(a[0], X[0], e), lerp(a[1], X[1], e), lerp(a[2], X[2], e)]);
        if (p) v3gMsl(Wd.ms, p[0], p[1], p[2], h, k, 0, pt);
      }
    }
  }
}

// 一架满载时挂的每一枚（甲板上挂弹车按这个顺序一枚枚挂：v3det.js）：{ w 武器, ms 弹形, bay 舱, v 挂点（模型坐标）}；按机型缓存
const FW_LD = new Map();
function fwLoadout(type, v) {
  const id = type + '|' + (v || '');
  if (FW_LD.has(id)) return FW_LD.get(id);
  const mk = typeof V3G_AIR === 'object' && typeof airSilKey === 'function' ? V3G_AIR[airSilKey(type, v)] || 'j31' : 'j31', T = FW_ST[mk] || {}, o = { kind: type, v }, out = [];
  fwInit(o);   // 临时对象：按型号表满载
  const LD = FW_LOAD[airMdlKey(type, v)] || [];
  LD.forEach((s, j) => {
    const Wd = FW_W[s.w], st = s.bay === 'side' ? T.side : fwSlots(T, s.bay, Wd, s.w);
    for (let i = 0; i < (o.fwN[fwKey(LD, j)] || 0); i++) out.push({ w: s.w, ms: Wd.ms, bay: s.bay, v: st && st.length ? st[st.length - 1 - (i % st.length)] : null });
  });
  FW_LD.set(id, out);
  return out;
}
// 甲板上的飞机挂上的弹（v3units.js）：满载清单的前 n 枚——外挂的一直看得见，弹舱里的只在舱门开着时画；top 机轮着地处
function fwStoresGnd(type, v, key, sz, x, y, top, hd, n, bay, fold = 0) {   // fold：外翼折起程度（挂在外翼下的弹跟着翻上去，v3g.js V3G_FOLD）
  if (!(n > 0) || typeof v3gMsl !== 'function' || typeof v3dGndAt !== 'function') return;
  const mk = V3G_AIR[key] || 'j31', LD = fwLoadout(type, v), M = V3G.M[mk];
  if (!M || !M.ready) return;
  for (let i = 0; i < Math.min(n, LD.length); i++) {
    const e = LD[i];
    if (!e.v || (e.bay !== 'ext' && !(bay && bay[e.bay] > .02))) continue;
    const p = v3dGndAt(key, sz, x, y, top, hd, e.v, fold);
    if (p) v3gMsl(e.ms, p[0], p[1], p[2], hd, sz / M.meta.len, 0, 0, fold > 0 && typeof v3gFoldA === 'function' ? v3gFoldA(mk, e.v, fold) : 0);
  }
}

// —— 锁定：选中武器的大环里、射程内的目标都标出来；只锁一个「选定目标」（默认离机头最近，R 换），锁定计时累计到 lk 秒变红 ——
// 候选目标：空空弹打看得见的敌机；反辐射弹打已知的防空雷达（高炮、防空车）；空地导弹、炸弹打看得见的地面、海上目标（v3pilot.js fpFoes）
function fwCands(W) {
  if (W.k === 'aam') return fpFoes(true);
  if (W.k === 'arm') return (typeof airAASites === 'function' ? airAASites() : []).filter(a => a.k !== 'mp' && a.o).map(a => {
    const x = a.o.x ?? a.x, y = a.o.y ?? a.y;
    return { o: a.o, k: 'gnd', t: a.k === 'veh' ? 'veh' : 'enemy', x, y, z: fwGz(x, y) + 2, nm: a.k === 'veh' ? '防空车' : '防空阵地' };
  });
  return fpFoes(false).filter(c => c.k !== 'air');
}
const fwGz = (x, y) => typeof v3HtX === 'function' ? v3HtX(x, y) : v3Ht(clamp(x, 0, W - 1), clamp(y, 0, H - 1));
// 射程（米）：有发动机的按真实射程；炸弹按投放高度与速度滑翔（升阻比 × (离地高度 + 速度换算的高度)），不超过真实射程
function fwRange(o, Wd) {
  if (Wd.M > 0) return Wd.R * 1000;
  const P = fpPose(), v = o.fl ? o.fl.Va : o.spd || 200, h = Math.max(0, P.z - Math.max(fwGz(P.x, P.y), -2.6));
  return Math.min(Wd.R * 1000, Wd.LD * (h + v * v / (2 * FW_G)));
}
function fwScan(o, s, dt) {
  const Wd = s.W, B = fpBody(o), P = fpPose(), c0 = Math.cos(Wd.cone * Math.PI / 180), Rm = fwRange(o, Wd), out = [];
  for (const c of fwCands(Wd)) {
    const L = [c.x - P.x, P.y - c.y, c.z - P.z], d = Math.hypot(L[0], L[1], L[2]);
    if (d < 1) continue;
    const ca = (L[0] * B.f[0] + L[1] * B.f[1] + L[2] * B.f[2]) / d;
    if (ca < c0 || d > Rm || d < Wd.Rmin) continue;
    out.push({ ...c, key: (c.t || c.k) + ':' + c.o.id, d, ca });
  }
  out.sort((a, b) => b.ca - a.ca);   // 离机头近的在前
  let T = out.find(c => c.key === V3FP.tgK) || null;
  if (!T) { T = out[0] || null; V3FP.tgK = T ? T.key : null; V3FP.lkT = 0; }   // 选定的出了环、出了射程、被打掉了：换离机头最近的，重新锁
  if (T) { V3FP.lkT = Math.min(Wd.lk, (V3FP.lkT || 0) + dt); T.sel = true; T.red = V3FP.lkT >= Wd.lk; }
  V3FP.fwC = out; V3FP.fwT = T;
}
// R 键 / 鼠标右键单击：换下一个目标——按离机头的角度从近到远轮着来（到头了回到最近的），重新锁
function fwCycle() {
  if (V3FP.vw === 'tgp' && typeof ftLock === 'function') { ftLock(); return; }   // 光电吊舱里：锁定十字下的目标（再按解锁，fptgp.js）
  const L = V3FP.fwC || [];
  if (!L.length) { if (fwSelW()) fwMsg('环里没有目标：机头对准目标'); return; }
  const cur = L.find(c => c.key === V3FP.tgK), nx = cur ? L.find(c => c.ca < cur.ca - 1e-9) || L[0] : L[0];
  if (nx === cur && L.length === 1) return;
  V3FP.tgK = nx.key; V3FP.lkT = 0;
}
HOOK.step.push(dt => {
  if (!S) return;
  if (V3FP.on && V3FP.k === 'air' && V3FP.o) {
    fwDoors(dt);
    const s = fwSelW();
    if (s && !fpOnDeck(V3FP.o)) fwScan(V3FP.o, s, dt); else { V3FP.fwC = []; V3FP.fwT = null; V3FP.lkT = 0; }
    if (V3FP.fq != null) { if (S.t - V3FP.fq > 2.5 || !s) V3FP.fq = null; else if (V3FP.cool <= 0 && fwReady(s)) fwFire(true); }   // 按下开火时舱门还在开、还没锁稳：好了就打出去
    fwGunLock(V3FP.o, dt);
    fwGunStep(V3FP.o, dt);
  }
  if (V3FP.bul && V3FP.bul.length) fwBulStep(dt);
  for (const m of S.missiles || []) if (m.fw && !m.done) fwFly(m, dt);
});

// —— 开火（F、鼠标左键、手柄 A、手机「开火」）——
//   没选武器：先选上第一种还有弹的（不打出去，提示一下）——原来按一下就自动选弹、自动挑目标打出去，鼠标点一下就少一枚；
//   导弹要选定目标锁稳（红框）才打：还在锁就记下，锁稳了自动打（2.5 秒内）；舱门还没开好也是开好了再打；
//   滑翔炸弹没有选定目标时投在准星下的地面上（fwBore）
function fwFire(auto) {
  const o = V3FP.o;
  if (!V3FP.on || V3FP.k !== 'air' || !o) return;
  if (fpOnDeck(o)) { fwMsg('还在甲板上，弹射升空后才能开火'); return; }
  if (o.fl && o.fl.gnd) { fwMsg('在地面上不能开火'); return; }
  let s = fwSelW();
  if (!s) {
    const L = fwList(o), i = L.findIndex(q => q.n > 0);
    if (i < 0) { fwMsg(fwGunOf(o) ? '导弹、炸弹打光了，空格用航炮' : '弹打光了'); return; }
    V3FP.ws = i; V3FP.lkT = 0;
    fwMsg(`选上${L[i].W.nm}：机头对准目标，框变红再按开火（R 换目标）`);
    return;
  }
  if (!(s.n > 0)) { V3FP.fq = null; fwMsg(`${s.W.nm}打光了，按数字键换别的`); return; }
  const gl = s.W.k !== 'aam' && typeof ftLockTgt === 'function' ? ftLockTgt(o, s) : null;   // 对地武器：先打吊舱锁定的目标（fptgp.js；在射程外就不打）
  if (gl === 'far') { V3FP.fq = null; return; }
  const T = gl || V3FP.fwT, gb = s.W.k === 'gb';
  if (!T && !gb) { V3FP.fq = null; if (!auto) fwMsg(s.W.k === 'aam' ? '环里没有敌机：机头对准目标' : '环里没有目标：机头对准目标'); return; }
  if (V3FP.cool > 0 || !fwReady(s) || (T && !T.red)) {   // 等舱门、等冷却、等锁稳
    if (!auto) { V3FP.fq = S.t; if (T && !T.red) fwMsg('锁定中，锁稳了自动发射'); }
    return;
  }
  V3FP.fq = null;
  fwLaunch(o, s, T || fwBore(o, s));
}
// 平显上的一行短提示（打光了、还在甲板上），一秒半后消失
function fwMsg(t) { V3FP.msg = { t, at: performance.now() }; }
// 环里没有目标：空空弹沿视轴打出去（导引头在前方自己找）；对地的沿视轴往前找落地点（每 40 米一步，最远到射程），机头没对着地面就打正前方射程内的地面
function fwBore(o, s) {
  const B = fpBody(o), P = fpPose(), Wd = s.W, f = B.f;
  if (Wd.k === 'aam') return { o: null, x: P.x + f[0] * 3000, y: P.y - f[1] * 3000, z: P.z + f[2] * 3000, nm: '前方', d: 3000, bore: true };
  const Rm = Math.min(fwRange(o, Wd), 60000);
  for (let d = 150; d <= Rm; d += 40) {
    const x = P.x + f[0] * d, y = P.y - f[1] * d, z = P.z + f[2] * d, g = Math.max(fwGz(x, y), -2.6);
    if (z <= g) return { o: null, x, y, z: g, nm: '准星下的地面', d, bore: true };
  }
  const hl = Math.hypot(f[0], f[1]) || 1, d = Math.min(Rm * .8, 15000), x = P.x + f[0] / hl * d, y = P.y - f[1] / hl * d;
  return { o: null, x, y, z: Math.max(fwGz(x, y), -2.6), nm: '正前方的地面', d, bore: true };
}
// 空空弹的导引头自己找目标（沿视轴发射、或原来的目标没了）：弹速度方向 30° 锥里、导引头作用距离内离弹轴最近的敌机
function fwSeek(m, Wd, v) {
  if (!S.eair || !S.eair.fly) return null;
  const sp = Math.hypot(v[0], v[1], v[2]) || 1, R = Wd.sk === 'ir' ? 12000 : 25000, c0 = Math.cos(30 * Math.PI / 180);
  let best = null, bc = c0;
  for (const a of S.eair.fly) {
    if (a.dead || !isFinite(a.x) || !((a.alt ?? 1) > .05)) continue;
    const L = [a.x - m.x, m.y - a.y, v3AirZ(a) - m.z3], d = Math.hypot(L[0], L[1], L[2]);
    if (d < 1 || d > R) continue;
    const ca = (L[0] * v[0] + L[1] * v[1] + L[2] * v[2]) / (d * sp);
    if (ca > bc) { bc = ca; best = a; }
  }
  return best;
}
// 空空弹对这架敌机的单发杀伤概率：战斗机机动规避、隐身打折
function fwPk(Wd, a, lock) {
  const ty = a && a.type, stl = a && typeof eaStl === 'function' ? eaStl(a) : 1, ftr = ty === 'ftr' || ty === 'ftrb' || ty === 'f22';
  return Wd.pk * (Wd.k === 'aam' ? (ftr ? .9 : 1.05) * (stl < .6 ? .9 : 1) : 1) * (lock ? 1 : .85);
}
// 弹从哪个挂点出去（模型坐标 → 游戏坐标，跟着机身姿态）：按已经打掉的枚数轮换左右
function fwStation(o, s) {
  const mk = fpMdlKey(o), T = FW_ST[mk] || {}, L = s.bay === 'side' ? T.sideX : fwSlots(T, s.bay, s.W, s.w), M = typeof V3G === 'object' && V3G.M[mk];
  if (L && M && M.ready) { const n = L.length, p = fpMdlXf(o).pt(L[((n - s.n) % n + n) % n]); return [p[0], -p[1], p[2]]; }   // 剩 n 枚打第一个挂点，剩一枚打最后一个
  const P = fpPose(), B = fpBody(o);
  return [P.x - B.u[0] * 1.2, P.y + B.u[1] * 1.2, P.z - B.u[2] * 1.2];   // 模型还没下载好：机腹下面
}
function fwLaunch(o, s, c) {
  const Wd = s.W, p = fwStation(o, s), F = o.fl, B = fpBody(o);
  const vA = F ? [F.V[1], F.V[0], -F.V[2]] : [Math.cos(o.heading || 0) * (o.spd || 200), -Math.sin(o.heading || 0) * (o.spd || 200), 0];   // 飞机的速度（GL：东、北、上）
  const push = s.bay === 'main' ? (Wd.k === 'gb' ? 5 : 7) : s.bay === 'ext' ? 2 : 0;   // 内埋的被弹射臂往下推出舱外，外挂的脱离挂架
  const v = [0, 1, 2].map(i => vA[i] - B.u[i] * push);
  const pk = c.o ? fwPk(Wd, c.t === 'eair' ? c.o : null, c.red) : Wd.pk;
  const m = { id: S.nid++, kind: Wd.k === 'aam' ? 'sam' : 'pgm', side: 'p', src: 'fp', x0: p[0], y0: p[1], x: p[0], y: p[1], z: .5, z3: p[2], tx: c.x, ty: c.y, t: 0, dur: Wd.M > 0 ? 80 : 150, ph: 'boost',
    tgt: c.o ? { k: c.t || 'eair', id: c.o.id } : null, pk, w: Wd.pg || s.w, lr: s.w === 'pl17' || undefined, icp: false, sup: 0,
    fw: { w: s.w, ms: Wd.ms, v, ign: Wd.ign != null && Wd.ign >= 0 ? Wd.ign : typeof airRelIgn === 'function' ? airRelIgn(s.bay) : s.bay === 'main' ? 1.2 : s.bay === 'ext' ? .8 : .3, lit: false, bore: !c.o } };
  S.missiles.push(m);
  if (Wd.k === 'arm' && c.o && typeof ewArm === 'function') ewArm(c.o, c.nm);   // 反辐射弹盯上了：雷达可能关机规避（ew.js）
  const fk = s.key || s.w; o.fwN[fk]--;
  const f = fwField(s.w); o[f] = Math.max(0, (o[f] ?? airMdl(o.kind, o.v)[f] ?? 0) - 1);   // 推演里没记这一项的（攻击机的自卫空空弹）从型号表的满载数减
  if (f === 'gbN' && o.gbN === 0) o.dropped = true;
  S.stats.shots++;
  if (Wd.k === 'aam' && typeof awStat === 'function') awStat(s.w === 'pl17' ? 'aamL' : 'aamP');
  V3FP.cool = Wd.k === 'aam' ? .5 : .8; V3FP.imp = .5;   // 挂架、弹射臂的冲击（受力回馈）
  if (typeof fpMslOn === 'function') fpMslOn(m);   // 右上角小屏跟着这枚弹（v3pilot.js：导弹视角，V 放大 / 缩回）
  log(c.o ? `发射${Wd.nm}，打 ${(c.d / 1000).toFixed(1)} 公里外的${c.nm}（还剩 ${o.fwN[fk]} 枚）` : `发射${Wd.nm}，${Wd.k === 'aam' ? '沿机头方向打出去，导引头自己找目标' : `打${c.nm}`}（还剩 ${o.fwN[fk]} 枚）`, 'info', 'fwl', 0, { x: c.x, y: c.y });
}

// —— 弹道（每步 1/30 秒）：GL 坐标（东、北、上），游戏坐标 x = 东、y = −北 ——
//   离机：内埋的被推出舱外后自由落下，0.35 秒点火（外挂 0.12 秒，侧弹舱在挂架上直接点火）；炸弹不点火，0.3 秒后开始滑翔导引
//   推力：助推时沿弹轴约 20 g 加速到最大速度，发动机停了按阻力减速（速度越高减得越快）；涡喷的 KD-88 保持巡航速度
//   导引：比例导引（导航比 4）+ 重力补偿，横向过载不超过 g；引信：这一步里弹和目标的最近距离（相对运动按直线算）进了 12 米就炸
function fwFly(m, dt) {
  const F = m.fw, Wd = FW_W[F.w];
  if (!Wd) { m.done = true; return; }
  m.t += dt;
  const air = Wd.k === 'aam';
  let T = null, tp = null;
  if (air) {
    T = msTgtObj(m.tgt);
    if (!T && m.tgt) { m.tgt = null; F.tq = F.tv = null; }   // 原来的目标没了：导引头重新找
    if (!T && m.t > F.ign + .3) { const a = fwSeek(m, Wd, F.v); if (a) { T = a; m.tgt = { k: 'eair', id: a.id }; m.pk = fwPk(Wd, a, false); } }
    if (T) tp = [T.x, -T.y, v3AirZ(T)];
  }
  else {
    T = m.tgt ? msPgmTgt(m.tgt) : null;
    if (T) { m.tx = T.x; m.ty = T.y; }
    tp = [m.tx, -m.ty, m.tgt && m.tgt.k === 'eship' ? 4 : fwGz(m.tx, m.ty) + 1.5];
  }
  const tq0 = F.tq || tp;
  if (tp) { if (F.tq) { const k = Math.min(1, dt * 4), tv = F.tv || [0, 0, 0]; F.tv = [0, 1, 2].map(i => tv[i] + ((tp[i] - F.tq[i]) / dt - tv[i]) * k); } F.tq = tp; }
  const v = F.v, sp = Math.hypot(v[0], v[1], v[2]) || 1, u = [v[0] / sp, v[1] / sp, v[2] / sp], p0 = [m.x, -m.y, m.z3], p = p0.slice();
  const lit = Wd.M > 0 && m.t >= F.ign;
  if (lit && !F.lit) { F.lit = true; if (typeof V3F === 'object' && V3F.puff) V3F.puff.push({ x: m.x, y: m.y, z: m.z3, t0: S.t, big: false, side: 'p', air: true }); }   // 点火：空中留一团白烟
  const a = [0, 0, -FW_G];
  if (lit && m.t - F.ign < Wd.tb) { const vm = Wd.M * FW_A, k = sp < vm ? (Wd.acc || 20) * FW_G : (vm - sp) * 2; for (let i = 0; i < 3; i++) a[i] += u[i] * k; }   // acc：助推加速度（G，编辑器可改，默认 20）
  else if (lit || Wd.M === 0) { const kd = Wd.M === 0 ? 4e-5 : 1.4e-5; for (let i = 0; i < 3; i++) a[i] -= u[i] * kd * sp * sp; }
  if (Wd.M === 0) a[2] += FW_G * .85;   // 炸弹的弹翼升力：滑翔（不然像石头一样掉）
  else if (air && !tp && lit) a[2] += FW_G;   // 空空弹还在找目标：弹体升力托住，沿原方向直飞
  if (tp && m.t >= F.ign + (Wd.M === 0 ? .3 : .15)) {
    const R = [tp[0] - p[0], tp[1] - p[1], tp[2] - p[2]], Rl2 = Math.max(1, R[0] * R[0] + R[1] * R[1] + R[2] * R[2]), tv = F.tv || [0, 0, 0];
    const Om = v3Cross(R, [tv[0] - v[0], tv[1] - v[1], tv[2] - v[2]]).map(c => c / Rl2), ac = v3Cross(Om, v).map(c => c * 4);
    ac[2] += FW_G * (Wd.M === 0 ? .15 : 1);   // 重力补偿（炸弹已经有升力）
    const al = ac[0] * u[0] + ac[1] * u[1] + ac[2] * u[2];
    for (let i = 0; i < 3; i++) ac[i] -= u[i] * al;   // 只要横向的
    const am = Math.hypot(ac[0], ac[1], ac[2]), lim = Wd.g * FW_G, k = am > lim ? lim / am : 1;
    for (let i = 0; i < 3; i++) a[i] += ac[i] * k;
  }
  for (let i = 0; i < 3; i++) { v[i] += a[i] * dt; p[i] += v[i] * dt; }
  m.x = p[0]; m.y = -p[1]; m.z3 = p[2]; m.hd = Math.atan2(-v[1], v[0]);
  const gz = fwGz(m.x, m.y);
  m.z = clamp((p[2] - Math.max(gz, -2.6)) / (typeof V3_AIR === 'number' ? V3_AIR : 350), 0, 1);
  // 引信 / 落地
  if (tp) {
    const r0 = [tq0[0] - p0[0], tq0[1] - p0[1], tq0[2] - p0[2]], dr = [tp[0] - p[0] - r0[0], tp[1] - p[1] - r0[1], tp[2] - p[2] - r0[2]], dd = dr[0] * dr[0] + dr[1] * dr[1] + dr[2] * dr[2];
    const s = dd > 1e-6 ? clamp(-(r0[0] * dr[0] + r0[1] * dr[1] + r0[2] * dr[2]) / dd, 0, 1) : 1, miss = Math.hypot(r0[0] + dr[0] * s, r0[1] + dr[1] * s, r0[2] + dr[2] * s);
    if (air && T && miss < 12) { m.done = true; F.end = 'hit'; m.x = T.x; m.y = T.y; msSamHit(m, T); return; }
    if (!air && miss < 3) { F.end = 'hit'; fwGround(m, T, tp[0], -tp[1]); return; }
  }
  if (!air && p[2] <= Math.max(gz, -2.6) + .3) { F.end = T && Math.hypot(T.x - m.x, T.y - m.y) < 15 ? 'hit' : 'gnd'; fwGround(m, T, m.x, m.y); return; }   // 打在地上 / 海面上（F.end：导弹小屏上写命中 / 落地 / 自毁）
  const slow = Wd.M > 0 && m.t > F.ign + Wd.tb && sp < 260;   // 发动机停了、速度掉下来：没有能量了，自毁
  if (m.t > m.dur || slow || (air && !T && m.t > 20) || p[2] < Math.max(gz, -2.6) || m.x < -12000 || m.x > W + 12000 || m.y < -12000 || m.y > H + 12000) { m.done = true; F.end = p[2] < Math.max(gz, -2.6) ? 'gnd' : 'sd'; msPuff(m.x, m.y, 'p'); }
}
function fwGround(m, T, x, y) {
  m.done = true; m.x = m.tx = x; m.y = m.ty = y;
  if (typeof msPgmHit === 'function') msPgmHit(m, T, MS_PGM[m.w] || MS_PGM.ft8);
}

// —— 航炮（空格按住连发；手柄 B、手机「机炮」）——
//   炮瞄雷达（用户：机炮改成雷达近距离锁定，然后射击，有散布）：战斗机雷达的近距格斗方式——机头前 ±12° 的圆锥、2.5 公里内最近的敌机自动截获，
//     锁上后跟踪到 ±40°、3.2 公里不丢；火控按距离、两机速度、弹丸减速与下坠解出提前量（gLd.a：炮管该指的方向），平显画提前量瞄准点——
//     把航炮十字压到瞄准点附近（2.5° 以内）开火，火控把弹道修过去（真实的航炮是固定的，这一点修正相当于飞行员细修 + 火控引导）；
//   每发弹在三维里飞：初速 860 米 / 秒叠加飞机速度、重力下坠、空气阻力减速；散布：每发 σ 4 密位（GSh-30-1 散布约 8 密位的八成圆），
//     连射中后坐让炮口再晃 2.5 密位——五百米大多数打得中，一公里外散布圈比战斗机还大；
//   每三发一发曳光弹（v3fx.js 画亮黄白的弹芯 + 橙红光晕，烧 3 秒熄灭），其余看不见但照样飞、照样算命中；
//   这一步的弹道线段离敌机够近就算命中（30 毫米高爆燃烧弹：战斗机、直升机两发、大飞机六发击落），落地处 3 米内的车辆、7 米内的工事受损，6 米内的步兵被压制、可能伤亡
const FW_GLK = { cone: .21, R: 2500, keepCone: .7, keepR: 3200, assist: .105, sig: .004, wob: .0025, tr: 3, k0: 2.5e-4 };
const fwGunHeld = () => V3FP.keys.has('Space') || !!V3FP.touchGun || !!V3FP.gpGun;
const fwAirTgts = () => S.eair && S.eair.fly ? S.eair.fly.filter(a => !a.dead && isFinite(a.x) && (a.alt ?? 1) > .05) : [];
function fwGunLock(o, dt) {
  const G = fwGunOf(o), F = o.fl;
  if (!G || !F || F.gnd || fpOnDeck(o)) { V3FP.gLk = V3FP.gLd = null; return; }
  const B = fpBody(o), P = fpPose(), p = [P.x, -P.y, P.z];
  const geo = a => { const q = [a.x, -a.y, v3AirZ(a)], d = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], r = Math.hypot(d[0], d[1], d[2]) || 1; return { q, r, off: Math.acos(clamp((d[0] * B.f[0] + d[1] * B.f[1] + d[2] * B.f[2]) / r, -1, 1)) }; };
  const air = fwAirTgts();
  let L = V3FP.gLk, A = L ? air.find(a => a.id === L.id) : null, g = A ? geo(A) : null;
  if (g && (g.r > FW_GLK.keepR || g.off > FW_GLK.keepCone)) { A = g = null; }
  if (!A) {   // 截获：圆锥里「偏角 × 2 公里 + 距离」最小的
    let bs = Infinity;
    for (const a of air) { const h = geo(a); if (h.r > FW_GLK.R || h.off > FW_GLK.cone) continue; const sc = h.off * 2000 + h.r; if (sc < bs) { bs = sc; A = a; g = h; } }
    if (A) fwMsg('炮瞄雷达锁定');
  }
  if (!A) { V3FP.gLk = V3FP.gLd = null; return; }
  if (!L || L.id !== A.id) L = { id: A.id, q: g.q, v: [0, 0, 0], ac: [0, 0, 0], r: g.r, rr: 0, n: 0 };
  else if (dt > 0) {   // 目标速度、加速度（转弯）、接近率：位置差分后平滑——提前量按二阶外推，转弯的目标也打得中
    const k = Math.min(1, dt * 7), ka = Math.min(1, dt * 4);
    for (let i = 0; i < 3; i++) { const v = (g.q[i] - L.q[i]) / dt, v0 = L.v[i]; L.v[i] += (v - L.v[i]) * k; if (L.n > 3) L.ac[i] += ((L.v[i] - v0) / dt - L.ac[i]) * ka; }
    L.rr += ((g.r - L.r) / dt - L.rr) * k; L.q = g.q; L.r = g.r; L.n++;
  }
  V3FP.gLk = L;
  // 提前量：弹丸沿出膛速度方向飞（本机速度 + 炮口初速，阻力只减速不改方向），走 d 米要 t = (e^(k0 d) − 1) / (k0 v) 秒；目标按现在的速度外推，再补下坠
  const vS = [F.V[1], F.V[0], -F.V[2]], vs2 = vS[0] * vS[0] + vS[1] * vS[1] + vS[2] * vS[2];
  let t = 0, Dh = null, lam = G.v0;
  for (let it = 0; it < 4; it++) {
    const t2 = .5 * t * t, D = [g.q[0] + L.v[0] * t + L.ac[0] * t2 - p[0], g.q[1] + L.v[1] * t + L.ac[1] * t2 - p[1], g.q[2] + L.v[2] * t + L.ac[2] * t2 - p[2] + FW_G * t2], dl = Math.hypot(D[0], D[1], D[2]) || 1;
    Dh = [D[0] / dl, D[1] / dl, D[2] / dl];
    const b = Dh[0] * vS[0] + Dh[1] * vS[1] + Dh[2] * vS[2];
    lam = b + Math.sqrt(Math.max(0, b * b - vs2 + G.v0 * G.v0));   // 出膛速度大小（沿 Dh）：|λ Dh − 本机速度| = 炮口初速
    t = (Math.exp(FW_GLK.k0 * dl) - 1) / (FW_GLK.k0 * Math.max(300, lam));
  }
  const a = [0, 1, 2].map(i => (lam * Dh[i] - vS[i]) / G.v0), al = Math.hypot(a[0], a[1], a[2]) || 1;
  for (let i = 0; i < 3; i++) a[i] /= al;
  const off = Math.acos(clamp(a[0] * B.f[0] + a[1] * B.f[1] + a[2] * B.f[2], -1, 1));
  V3FP.gLd = { a, t, r: g.r, rr: L.rr, off, ok: off < FW_GLK.assist, q: g.q, nm: (typeof EA_SPEC === 'object' && EA_SPEC[A.type] || {}).name || '敌机' };
}
function fwGunStep(o, dt) {
  const G = fwGunOf(o), F = o.fl;
  if (!G || !F || F.gnd || fpOnDeck(o) || !fwGunHeld()) { V3FP.gunA = 0; return; }
  if (!(o.gunN > 0)) { if (!V3FP.gunE) { V3FP.gunE = true; fwMsg('航炮打光了'); } return; }
  V3FP.gunE = false;
  V3FP.gunA = (V3FP.gunA || 0) + G.rpm / 60 * dt;
  const B = fpBody(o), X = typeof V3G === 'object' && V3G.M[fpMdlKey(o)] && V3G.M[fpMdlKey(o)].ready ? fpMdlXf(o) : null, P = fpPose();
  const mz = X ? X.pt(G.at) : [P.x + B.f[0] * 6, -P.y + B.f[1] * 6, P.z + B.f[2] * 6], vA = [F.V[1], F.V[0], -F.V[2]], L = V3FP.bul || (V3FP.bul = []);
  // 炮管指向：锁定了就往提前量方向修（最多 2.5°），没锁就是机身轴线
  let f = B.f;
  const Ld = V3FP.gLd;
  if (Ld) { const k = Ld.off > 1e-5 ? Math.min(1, FW_GLK.assist / Ld.off) : 1, d = [0, 1, 2].map(i => B.f[i] + (Ld.a[i] - B.f[i]) * k), l = Math.hypot(d[0], d[1], d[2]) || 1; f = d.map(x => x / l); }
  const Wb = V3FP.gW || (V3FP.gW = [0, 0]);
  while (V3FP.gunA >= 1 && o.gunN > 0) {
    V3FP.gunA -= 1; o.gunN--;
    Wb[0] = Wb[0] * .8 + gauss() * FW_GLK.wob * .6; Wb[1] = Wb[1] * .8 + gauss() * FW_GLK.wob * .6;   // 后坐让炮口晃（连射越久晃得越开，松开很快回正）
    const e1 = gauss() * FW_GLK.sig + Wb[0], e2 = gauss() * FW_GLK.sig + Wb[1], d = [0, 1, 2].map(i => f[i] + B.r[i] * e1 + B.u[i] * e2);
    V3FP.gunC = ((V3FP.gunC || 0) + 1) % FW_GLK.tr;
    L.push({ p: mz.slice(), q: mz.slice(), v: [0, 1, 2].map(i => vA[i] + d[i] * G.v0), t: 0, tr: V3FP.gunC === 0 });
  }
  V3FP.gunT = performance.now(); V3FP.gunMz = mz; V3FP.imp = Math.max(V3FP.imp || 0, .22);   // 炮口焰（v3fx.js）、开火的震动
  const sm = V3FP.gSm || (V3FP.gSm = []);   // 炮口硝烟：留在空中，飞机一下就把它甩在后面（画面用，按真实时间）
  if (!sm.length || V3FP.gunT - sm[sm.length - 1].t > 45) { sm.push({ p: mz.slice(), t: V3FP.gunT, s: Math.random() }); if (sm.length > 60) sm.shift(); }
  if (L.length > 300) L.splice(0, L.length - 300);
  S.stats.shots++;
}
// 画面用的命中效果（空中高爆弹的闪光火球黑烟、地上的尘土、水面的水柱；按真实时间，v3fx.js 画）
function fwGfx(p, k) { const L = V3FP.gFx || (V3FP.gFx = []); L.push({ p: p.slice(), t: performance.now(), k, s: Math.random() }); if (L.length > 90) L.shift(); }
function fwBulStep(dt) {
  const L = V3FP.bul, air = S.eair && S.eair.fly ? S.eair.fly.filter(a => !a.dead && isFinite(a.x) && (a.alt ?? 1) > .05) : [];
  for (let i = L.length - 1; i >= 0; i--) {
    const b = L[i], p0 = b.p.slice(), v = b.v, sp = Math.hypot(v[0], v[1], v[2]) || 1, k = 2.5e-4 * sp;   // 阻力：速度越快减得越多（一千五百米外约剩七成）
    for (let j = 0; j < 3; j++) v[j] -= v[j] * k * dt;
    v[2] -= FW_G * dt;
    b.q = p0; for (let j = 0; j < 3; j++) b.p[j] += v[j] * dt;
    b.t += dt;
    let done = b.t > 4;
    for (const a of air) {   // 这一步的线段离敌机最近处
      const A = [a.x, -a.y, v3AirZ(a)], d = [b.p[0] - p0[0], b.p[1] - p0[1], b.p[2] - p0[2]], w = [A[0] - p0[0], A[1] - p0[1], A[2] - p0[2]];
      const dd = d[0] * d[0] + d[1] * d[1] + d[2] * d[2], u = dd > 1e-6 ? clamp((w[0] * d[0] + w[1] * d[1] + w[2] * d[2]) / dd, 0, 1) : 0;
      const big = a.type === 'c17' || a.type === 'b2' || a.type === 'p8', r = big ? 12 : a.type === 'heli' || a.type === 'uh60' ? 5.5 : 4;   // 弹道离机体中心多近算打中（战斗机翼展 13 米、机身高 2 米左右：4 米；原来 5.5 米太宽）
      if (Math.hypot(w[0] - d[0] * u, w[1] - d[1] * u, w[2] - d[2] * u) > r) continue;
      a.gunHit = (a.gunHit || 0) + 1; done = true;
      fwGfx([p0[0] + d[0] * u, p0[1] + d[1] * u, p0[2] + d[2] * u], 'air');   // 高爆燃烧弹在机体上炸开
      if (a.gunHit >= (big ? 6 : 2)) { eaLost(a, 'gun'); if (typeof awScore === 'function') awScore('p'); fwMsg('击落'); }
      else S.fx.push({ kind: 'flash', x: a.x, y: a.y, r: 3, life: 0, max: .25, side: 'p', air: 1, alt: a.alt ?? 1 });
      break;
    }
    if (!done) {
      const x = b.p[0], y = -b.p[1], g = Math.max(fwGz(x, y), -2.6);
      if (b.p[2] <= g) { done = true; fwGfx([x, -y, g], g < -2.5 ? 'sea' : 'gnd'); fwGunHit(x, y, g < -2.5, p0); }
    }
    if (done) L.splice(i, 1);
  }
}
// 一发落地：水面只溅水花；车辆、工事、步兵按距离受损（射手方位按这发弹的来向，方向装甲照算）
function fwGunHit(x, y, sea, from) {
  if ((V3FP.bhN = (V3FP.bhN || 0) + 1) % 2 === 0) S.fx.push({ kind: 'flash', x, y, r: sea ? 2 : 2.6, life: 0, max: .22, side: 'p' });
  if (sea) return;
  const sx = from[0], sy = -from[1];
  for (const v of S.veh || []) if (v.side === 'e' && !v.dead && dist(v.x, v.y, x, y) < 3) vehDamage(v, .35, 1.6, sx, sy, 'gau8');
  for (const a of S.armor || []) if (!a.dead && dist(a.x, a.y, x, y) < 3 && typeof damageArmor === 'function') damageArmor(a, .35);
  for (const e of S.enemies) if (!e.dead && e.kind !== 'airfield' && dist(e.x, e.y, x, y) < 7) damageEnemy(e, .12, x, y);
  for (const q of S.teams) if (q.side === 'e' && q.men.length && dist(q.x, q.y, x, y) < 6) { suppress(q, 25, sx, sy); if (Math.random() < .3 * coverAt(q.x, q.y) / .9) killMan(q); }
}
// 画面用：飞行中的炮弹（v3fx.js 画成曳光：这一步走过的一段，GL 坐标）、刚开过火（炮口焰）
const fwBul = () => V3FP.on && V3FP.bul ? V3FP.bul : [];
// 航炮准星：选定了空中目标，画按它的距离算的弹着点（提前量靠玩家自己把它压到目标上）；否则画炮弹落地点（对地扫射，3 秒内落地的）
function fwGunPip(o) {
  const G = fwGunOf(o), F = o.fl;
  if (!G || !F) return null;
  const B = fpBody(o), P = fpPose(), vA = [F.V[1], F.V[0], -F.V[2]], v = [0, 1, 2].map(i => vA[i] + B.f[i] * G.v0), p = [P.x, -P.y, P.z];
  const T = V3FP.fwT && V3FP.fwT.k === 'air' ? V3FP.fwT : null, dT = T ? Math.hypot(T.x - P.x, T.y - P.y, T.z - P.z) : 0;
  for (let t = 0, h = 1 / 30; t < 3; t += h) {
    const sp = Math.hypot(v[0], v[1], v[2]);
    for (let j = 0; j < 3; j++) v[j] -= v[j] * 2.5e-4 * sp * h;
    v[2] -= FW_G * h;
    for (let j = 0; j < 3; j++) p[j] += v[j] * h;
    if (T && Math.hypot(p[0] - P.x, p[1] + P.y, p[2] - P.z) >= dT) return { q: v3Proj(p[0], -p[1], p[2]), air: true, d: dT };
    if (!T && p[2] <= Math.max(fwGz(p[0], -p[1]), -2.6)) return { q: v3Proj(p[0], -p[1], p[2]), air: false, d: Math.hypot(p[0] - P.x, p[1] + P.y) };
  }
  return null;
}

// 炮瞄雷达锁定的平显：目标方框（打得中时变红）、距离与接近率；提前量瞄准点（圆 + 中心点，旁边一圈距离弧：满圈 2 公里）；航炮十字（机身轴线，同距离处）；
//   瞄准点到目标连一条虚线——把十字压到瞄准点上（2.5° 以内火控修过去），十字、瞄准点、方框一起变红就开火
function fwGunHud(ctx, o, font) {
  const L = V3FP.gLd, B = fpBody(o), P = fpPose(), p = [P.x, -P.y, P.z];
  const at = d => v3Proj(p[0] + d[0] * L.r, -(p[1] + d[1] * L.r), p[2] + d[2] * L.r);
  const qt = v3Proj(L.q[0], -L.q[1], L.q[2]), qa = at(L.a), qb = at(B.f), red = L.ok && L.r < 2000, col = red ? FW_RED : FW_HUD;
  ctx.save(); ctx.lineWidth = 1.6; ctx.strokeStyle = ctx.fillStyle = col; ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = 2;
  if (qt) {
    ctx.strokeRect(qt.x - 12, qt.y - 12, 24, 24);
    ctx.font = font(12); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(`${L.nm} ${Math.round(L.r)}m  ${L.rr < 0 ? '接近' : '远离'} ${Math.round(Math.abs(L.rr) * 3.6)}km/h`, qt.x + 18, qt.y - 6);
    ctx.fillText(red ? '射程内 · 开火' : L.r < 2000 ? (L.ok ? '' : '把十字压到瞄准点') : '距离远', qt.x + 18, qt.y + 9);
  }
  if (qa) {
    ctx.beginPath(); ctx.arc(qa.x, qa.y, 11, 0, 6.2832); ctx.stroke(); ctx.fillRect(qa.x - 1.5, qa.y - 1.5, 3, 3);
    const f = clamp(L.r / 2000, 0, 1); ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(qa.x, qa.y, 16, -Math.PI / 2, -Math.PI / 2 + f * 6.2832); ctx.stroke(); ctx.lineWidth = 1.6;   // 距离弧
    if (qt) { ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(qt.x, qt.y); ctx.lineTo(qa.x, qa.y); ctx.stroke(); ctx.setLineDash([]); }
  }
  if (qb) { ctx.beginPath(); ctx.moveTo(qb.x - 10, qb.y); ctx.lineTo(qb.x - 3, qb.y); ctx.moveTo(qb.x + 3, qb.y); ctx.lineTo(qb.x + 10, qb.y); ctx.moveTo(qb.x, qb.y - 10); ctx.lineTo(qb.x, qb.y - 3); ctx.moveTo(qb.x, qb.y + 3); ctx.lineTo(qb.x, qb.y + 10); ctx.stroke(); }
  ctx.restore();
}
// —— 平显（v3pilot.js v3fpOverlay 调用）：选中武器的大环、环里的目标（小菱形）、选定目标的锁定框（锁稳了变红）、环下方武器名与余弹；右下角武器表；航炮准星 ——
function fwHud(ctx) {
  const o = V3FP.o, s = fwSelW(), font = n => `${n}px "IBM Plex Mono", "Noto Sans SC", monospace`;
  if (V3FP.msg && performance.now() - V3FP.msg.at < 1800) {   // 短提示：画面中间偏下
    ctx.save(); ctx.fillStyle = FW_RED; ctx.font = font(14); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 3; ctx.fillText(V3FP.msg.t, CAM.vw / 2, CAM.vh * .72); ctx.restore();
  }
  if (!o || !V3.cam || fpOnDeck(o) || (V3FP.mv != null && V3FP.mBig)) return;
  fwList0(ctx, o, font);
  if (V3FP.gLd) fwGunHud(ctx, o, font);
  const gp = fwGunOf(o) && !(o.fl && o.fl.gnd) && !V3FP.gLd ? fwGunPip(o) : null;
  if (gp && gp.q && gp.q.x > 0 && gp.q.x < CAM.vw && gp.q.y > 0 && gp.q.y < CAM.vh) {   // 航炮准星：空中目标是带中心点的小圆，对地是十字
    ctx.save(); ctx.strokeStyle = ctx.fillStyle = FW_HUD; ctx.lineWidth = 1.5; ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = 2;
    const { x, y } = gp.q;
    if (gp.air) { ctx.beginPath(); ctx.arc(x, y, 9, 0, 6.2832); ctx.stroke(); ctx.fillRect(x - 1.2, y - 1.2, 2.4, 2.4); }
    else if (gp.d < 2200) { ctx.beginPath(); ctx.moveTo(x - 8, y); ctx.lineTo(x - 3, y); ctx.moveTo(x + 3, y); ctx.lineTo(x + 8, y); ctx.moveTo(x, y - 8); ctx.lineTo(x, y - 3); ctx.moveTo(x, y + 3); ctx.lineTo(x, y + 8); ctx.stroke(); }
    ctx.restore();
  }
  if (!s) return;
  const B = fpBody(o), P = fpPose(), b = [P.x, P.y, P.z], D = 4000;   // 符号从飞机出发、在远处（和窗外对齐）
  const at = d => v3Proj(b[0] + d[0] * D, b[1] - d[1] * D, b[2] + d[2] * D);
  const cr = s.W.cone * Math.PI / 180, cc = Math.cos(cr), sc = Math.sin(cr);
  ctx.save();
  ctx.lineWidth = 1.6; ctx.strokeStyle = FW_HUD; ctx.fillStyle = FW_HUD; ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = 2;
  // 大环：绕视轴一圈的方向逐点投影（视轴偏到画面边上也照真实角度画）
  ctx.beginPath();
  let pen = false, low = null;
  for (let i = 0; i <= 72; i++) {
    const th = i / 72 * 6.2832, k1 = Math.cos(th) * sc, k2 = Math.sin(th) * sc;
    const q = at([B.f[0] * cc + B.r[0] * k1 + B.u[0] * k2, B.f[1] * cc + B.r[1] * k1 + B.u[1] * k2, B.f[2] * cc + B.r[2] * k1 + B.u[2] * k2]);
    if (!q) { pen = false; continue; }
    if (pen) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y);
    pen = true;
    if (!low || q.y > low.y) low = q;
  }
  ctx.stroke();
  // 环里的目标：小菱形；选定的那个是方框（锁的过程中绿色、四角往里收，锁稳了变红），旁边写是什么、多远
  for (const c of V3FP.fwC) {
    const q = v3Proj(c.x, c.y, c.z);
    if (!q) continue;
    if (c.sel) {
      const r = 13, k = clamp((V3FP.lkT || 0) / s.W.lk, 0, 1);
      ctx.strokeStyle = ctx.fillStyle = c.red ? FW_RED : FW_HUD; ctx.lineWidth = c.red ? 2.6 : 1.8;
      ctx.strokeRect(q.x - r, q.y - r, r * 2, r * 2);
      if (!c.red) { const g = r * (1.9 - .9 * k); ctx.beginPath(); for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { ctx.moveTo(q.x + sx * g, q.y + sy * (g - 6)); ctx.lineTo(q.x + sx * g, q.y + sy * g); ctx.lineTo(q.x + sx * (g - 6), q.y + sy * g); } ctx.stroke(); }   // 四角括号往里收：锁定进度
      ctx.font = font(12); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(`${c.nm} ${(c.d / 1000).toFixed(1)}km${c.red ? ' 锁定' : ''}`, q.x + r + 6, q.y);
    } else {
      ctx.strokeStyle = FW_HUD; ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.moveTo(q.x, q.y - 6); ctx.lineTo(q.x + 6, q.y); ctx.lineTo(q.x, q.y + 6); ctx.lineTo(q.x - 6, q.y); ctx.closePath(); ctx.stroke();
    }
  }
  // 武器名与余弹（环的下边）
  if (low) {
    ctx.fillStyle = s.n > 0 ? FW_HUD : FW_RED; ctx.font = font(13); ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const n = V3FP.fwC.length;
    ctx.fillText(`${s.W.nm} ×${s.n}${n > 1 ? ` · 环里 ${n} 个目标（R 换）` : ''}`, low.x, Math.min(low.y + 8, CAM.vh - 130));   // 不压到下面的飞行数据
  }
  ctx.restore();
}
// 右下角的武器表：「1 霹雳-15 ×4」……「空格 航炮 ×150」，选中的那行前面一个 ▶、亮着；打光的变红
function fwList0(ctx, o, font) {
  const L = fwList(o), G = fwGunOf(o), rows = L.map((s, i) => ({ k: String(i + 1), t: `${s.W.nm} ×${s.n}`, on: V3FP.ws === i, out: !(s.n > 0) }));
  if (G) rows.push({ k: '空格', t: `${G.nm} ×${o.gunN ?? G.n}`, on: fwGunHeld(), out: !(o.gunN > 0) });
  if (typeof ftFlareN === 'function') { const n = ftFlareN(o); rows.push({ k: 'Z', t: `热诱弹 ×${n}`, on: false, out: !(n > 0) }); }   // 热诱弹（fptgp.js）
  if (typeof ftOn === 'function') rows.push({ k: 'Y', t: V3FP.vw === 'tgp' ? '退出吊舱' : '光电吊舱', on: V3FP.vw === 'tgp', dim: true }, ...(typeof fiToggle === 'function' ? [{ k: 'I', t: '参数', on: typeof FI === 'object' && FI.on, dim: true }] : []));
  if (!rows.length) return;
  const lh = 18, x = CAM.vw - 16, y0 = V3FP.wtTop = CAM.vh - 16 - lh * rows.length;   // wtTop：武器表顶边（雷达告警的小圆画在它上面，v3pilot.js fpRwr）
  ctx.save(); ctx.font = font(13); ctx.textAlign = 'right'; ctx.textBaseline = 'top'; ctx.shadowColor = 'rgba(0,0,0,.7)'; ctx.shadowBlur = 3;
  rows.forEach((r, i) => { ctx.fillStyle = r.out ? FW_RED : r.on ? '#e8fff2' : r.dim ? 'rgba(125,255,176,.5)' : 'rgba(125,255,176,.75)'; ctx.fillText(`${r.on ? '▶ ' : ''}${r.k}  ${r.t}`, x, y0 + i * lh); });
  ctx.restore();
}
