'use strict';
// 战机武器系统（亲自驾驶飞机时，v3pilot.js）：数字键选武器（再按一次收起），F 开火——
//   选中时打开对应的弹舱门（v3g.js 画舱门、舱里的弹），歼-20 的侧弹舱门开了以后挂架把霹雳-10 推出舱外；外挂的不用等；
//   平显：选中武器的大环——导引头 / 火控雷达能锁定的偏离角，按真实角度画在视野里（座舱里的平显玻璃只有十度宽，装不下）；
//     环里、射程内的目标出锁定框，锁稳了框变红，这时按 F 才发射；连按 F 依次打环里还没挨打的红框目标
//   弹按真实参数在三维里飞：内埋的先被弹射臂推出舱外再点火，侧弹舱、外挂的在挂架上点火；助推加速、比例导引、过载限制、近炸引信；
//     空空命中按单发杀伤概率结算（missile.js msSamHit：隐身、干扰弹打折），对地按精确制导弹药的毁伤（missile.js msPgmHit）
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
  ls6: { nm: '雷石-6', k: 'gb', sk: 'gps', M: 0, R: 60, LD: 6, Rmin: 800, g: 4, cone: 10, lk: 1, pk: .9, ms: 'bomb', pg: 'ls6' }   // 500 公斤级航弹加滑翔组件，高空投放约 60 公里
};
// 每型飞机挂什么、挂在哪（main 主弹舱 / side 侧弹舱 / ext 外挂）；数量从推演里的计数分出来——o.aam 是中距 + 近距的总数，sr 是近距弹分走的枚数
const FW_LOAD = {
  j20: [{ w: 'pl15', bay: 'main' }, { w: 'pl10', bay: 'side', sr: 2 }],   // 主弹舱 4 枚霹雳-15，两侧小弹舱各 1 枚霹雳-10
  j50: [{ w: 'pl15', bay: 'main' }, { w: 'pl10', bay: 'main', sr: 2 }],
  j36: [{ w: 'pl15', bay: 'main' }, { w: 'pl17', bay: 'main' }],
  j36s: [{ w: 'pl15', bay: 'main' }, { w: 'ls6', bay: 'main' }],
  j35: [{ w: 'ft8', bay: 'main' }],
  j35s: [{ w: 'ld10', bay: 'main' }],
  j16d: [{ w: 'ld10', bay: 'ext' }],
  j15t: [{ w: 'kd88', bay: 'ext' }]
};
// 推演里的计数字段：空空弹 aam（霹雳-17 是 aamL），空地导弹、滑翔炸弹 agmN，小直径炸弹、反辐射弹 gbN（carrier.js 的型号表）
const fwField = w => w === 'pl17' ? 'aamL' : FW_W[w].k === 'aam' ? 'aam' : FW_W[w].k === 'agm' || w === 'ls6' ? 'agmN' : 'gbN';
// 挂点（模型坐标，米：x 前、y 左、z 上；对着用户给的模型的弹舱量的，见 v3g.js V3G_BAY）：main 主弹舱（长弹一排；mainS：短弹前后两排）、
//   side 侧弹舱（sideX：挂架推出舱外以后）、ext 外挂；舱里的弹按剩几枚画几枚，发射时从下一个挂点出去
const FW_ST = {
  j20: { main: [[.15, .16, 1.62], [.15, -.16, 1.62], [.15, .48, 1.5], [.15, -.48, 1.5]], mainS: [[1.3, .2, 1.55], [1.3, -.2, 1.55], [-1, .2, 1.55], [-1, -.2, 1.55], [1.3, .5, 1.5], [1.3, -.5, 1.5], [-1, .5, 1.5], [-1, -.5, 1.5]],
    side: [[-.7, 1.24, 1.66], [-.7, -1.24, 1.66]], sideX: [[-.7, 1.62, 1.12], [-.7, -1.62, 1.12]] },
  j31: { main: [[0, .3, 1.28], [0, -.3, 1.28], [0, .7, 1.26], [0, -.7, 1.26]], mainS: [[.95, .3, 1.24], [.95, -.3, 1.24], [-.95, .3, 1.24], [-.95, -.3, 1.24], [.95, .7, 1.22], [.95, -.7, 1.22], [-.95, .7, 1.22], [-.95, -.7, 1.22]] },
  j16: { ext: [[-.6, 2.6, 1.02], [-.6, -2.6, 1.02], [-1.2, 4.1, 1.12], [-1.2, -4.1, 1.12]] }
};
// 这一舱这种弹用哪组挂点（短弹前后两排）
const fwSlots = (T, bay, Wd) => (bay === 'main' && T.mainS && ((typeof V3MS === 'object' && V3MS[Wd.ms]) || {}).L <= 2.4 ? T.mainS : T[bay]) || null;

// —— 挂载 ——
// 接手时把推演里的计数分到各型弹上（AI 飞的时候打掉了几枚就少几枚）；之后两边一起减，交回 AI 时它照样知道还剩多少
function fwInit(o) {
  const M = airMdl(o.kind, o.v), L = FW_LOAD[airMdlKey(o.kind, o.v)] || [];
  const tot = { aam: o.aam ?? M.aam ?? 0, aamL: o.aamL ?? M.aamL ?? 0, gbN: o.gbN ?? M.gbN ?? 0, agmN: o.agmN ?? M.agmN ?? 0 };
  const have = f => L.filter(s => fwField(s.w) === f).reduce((a, s) => a + ((o.fwN || {})[s.w] || 0), 0);
  if (o.fwN && Object.keys(tot).every(f => have(f) === (L.some(s => fwField(s.w) === f) ? tot[f] : 0))) return;   // 没变就不重分
  const N = {};
  for (const s of L) if (s.sr != null) { const f = fwField(s.w); N[s.w] = Math.min(s.sr, tot[f]); tot[f] -= N[s.w]; }   // 近距弹先分（侧弹舱各一枚）
  for (const s of L) if (s.sr == null) { const f = fwField(s.w); N[s.w] = tot[f]; tot[f] = 0; }
  o.fwN = N;
}
const fwList = o => (FW_LOAD[airMdlKey(o.kind, o.v)] || []).map(s => ({ ...s, W: FW_W[s.w], n: (o.fwN || {})[s.w] || 0 }));
const fwSelW = () => { const o = V3FP.o; return o && V3FP.k === 'air' && V3FP.ws >= 0 ? fwList(o)[V3FP.ws] || null : null; };
// 还剩几枚（交回 AI 时打光了就返航）
const fwLeft = o => fwList(o).reduce((a, s) => a + s.n, 0);
// 列表里的一行：「霹雳-15 ×4 · 霹雳-10 ×2」
const fwSum = o => { fwInit(o); return fwList(o).map(s => `${s.W.nm} ×${s.n}`).join(' · '); };
function fwTake(o) {
  fwInit(o);
  Object.assign(V3FP, { ws: -1, lk: {}, fwC: [], bay: { main: 0, side: 0, ext: 0 } });
}
// 数字键：选第 i 种（再按一次收起，舱门关上）
function fwSel(i) {
  const o = V3FP.o, L = o ? fwList(o) : [];
  if (!L[i]) return;
  V3FP.ws = V3FP.ws === i ? -1 : i;
  V3FP.lk = {};
}
// 手柄 Y、手机「武器」：换下一种（最后一种之后收起）
function fwNext() { const o = V3FP.o, n = o ? fwList(o).length : 0; if (n) { V3FP.ws = V3FP.ws + 1 >= n ? -1 : V3FP.ws + 1; V3FP.lk = {}; } }
// 交回 AI：舱门关上
function fwRelease() { V3FP.ws = -1; V3FP.lk = {}; V3FP.fwC = []; V3FP.bay = { main: 0, side: 0, ext: 0 }; }

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
  const sel = V3FP.on && V3FP.o === o ? fwSelW() : null, k = sz / V3G.M[mk].meta.len;
  for (const s of L) if (s.bay === 'ext' && T.ext) for (let i = T.ext.length - Math.min((o.fwN || {})[s.w] || 0, T.ext.length); i < T.ext.length; i++) { const p = v3gAt(key, sz, x, y, z, h, pt, rl, T.ext[i]); if (p) v3gMsl(FW_W[s.w].ms, p[0], p[1], p[2], h, k, 0, pt); }   // 翼下挂架
  for (const bk of ['main', 'side']) {
    if (!bay || !(bay[bk] > .02)) continue;
    const s = sel && sel.bay === bk ? sel : L.find(q => q.bay === bk);
    if (!s) continue;
    const Wd = FW_W[s.w], st = fwSlots(T, bk, Wd), n = Math.min((o.fwN || {})[s.w] || 0, st ? st.length : 0), e = bk === 'side' ? bay.ext || 0 : 0;
    for (let i = st ? st.length - n : 0; st && i < st.length; i++) {
      const a = st[i], X = bk === 'side' && T.sideX ? T.sideX[i % T.sideX.length] : a, p = v3gAt(key, sz, x, y, z, h, pt, rl, [lerp(a[0], X[0], e), lerp(a[1], X[1], e), lerp(a[2], X[2], e)]);
      if (p) v3gMsl(Wd.ms, p[0], p[1], p[2], h, k, 0, pt);
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
  for (const s of FW_LOAD[airMdlKey(type, v)] || []) {
    const Wd = FW_W[s.w], st = s.bay === 'side' ? T.side : fwSlots(T, s.bay, Wd);
    for (let i = 0; i < (o.fwN[s.w] || 0); i++) out.push({ w: s.w, ms: Wd.ms, bay: s.bay, v: st && st.length ? st[st.length - 1 - (i % st.length)] : null });
  }
  FW_LD.set(id, out);
  return out;
}
// 甲板上的飞机挂上的弹（v3units.js）：满载清单的前 n 枚——外挂的一直看得见，弹舱里的只在舱门开着时画；top 机轮着地处
function fwStoresGnd(type, v, key, sz, x, y, top, hd, n, bay) {
  if (!(n > 0) || typeof v3gMsl !== 'function' || typeof v3dGndAt !== 'function') return;
  const LD = fwLoadout(type, v), M = V3G.M[V3G_AIR[key] || 'j31'];
  if (!M || !M.ready) return;
  for (let i = 0; i < Math.min(n, LD.length); i++) {
    const e = LD[i];
    if (!e.v || (e.bay !== 'ext' && !(bay && bay[e.bay] > .02))) continue;
    const p = v3dGndAt(key, sz, x, y, top, hd, e.v);
    if (p) v3gMsl(e.ms, p[0], p[1], p[2], hd, sz / M.meta.len, 0, 0);
  }
}

// —— 锁定：选中武器的大环里、射程内的目标，锁定计时累计到 lk 秒变红 ——
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
  const Wd = s.W, B = fpBody(o), P = fpPose(), c0 = Math.cos(Wd.cone * Math.PI / 180), Rm = fwRange(o, Wd), out = [], seen = new Set();
  for (const c of fwCands(Wd)) {
    const L = [c.x - P.x, P.y - c.y, c.z - P.z], d = Math.hypot(L[0], L[1], L[2]);
    if (d < 1) continue;
    const ca = (L[0] * B.f[0] + L[1] * B.f[1] + L[2] * B.f[2]) / d, key = (c.t || c.k) + ':' + c.o.id;
    if (ca < c0 || d > Rm || d < Wd.Rmin) continue;
    seen.add(key);
    const t = V3FP.lk[key] = Math.min(Wd.lk, (V3FP.lk[key] || 0) + dt);
    out.push({ ...c, key, d, ca, red: t >= Wd.lk });
  }
  for (const k in V3FP.lk) if (!seen.has(k)) delete V3FP.lk[k];   // 出了环（或出了射程）重新锁
  V3FP.fwC = out.sort((a, b) => b.ca - a.ca);   // 离视轴近的在前
}
HOOK.step.push(dt => {
  if (!S) return;
  if (V3FP.on && V3FP.k === 'air' && V3FP.o) {
    fwDoors(dt);
    const s = fwSelW();
    if (s && !fpOnDeck(V3FP.o)) fwScan(V3FP.o, s, dt); else { V3FP.fwC = []; V3FP.lk = {}; }
  }
  for (const m of S.missiles || []) if (m.fw && !m.done) fwFly(m, dt);
});

// —— 开火（F、手柄 A、手机「开火」）：打环里锁定变红、还没有弹在飞向它的目标里离视轴最近的 ——
function fwFire() {
  const o = V3FP.o;
  if (!V3FP.on || V3FP.k !== 'air' || !o) return;
  if (fpOnDeck(o)) { log('还在甲板上：弹射升空后才能开火', 'warn', 'fpdk', 2); return; }
  const s = fwSelW();
  if (!s) { log('还没选武器', 'warn', 'fw0', 2); return; }
  if (!(s.n > 0)) { log(`${s.W.nm}打光了`, 'warn', 'fw1', 2); return; }
  if (V3FP.cool > 0 || !fwReady(s)) return;
  const busy = new Set(S.missiles.filter(m => m.fw && !m.done && m.tgt).map(m => m.tgt.k + ':' + m.tgt.id));
  const c = V3FP.fwC.find(c => c.red && !busy.has((c.t || 'eair') + ':' + c.o.id)) || V3FP.fwC.find(c => c.red);
  if (!c) { log('没有锁定目标', 'warn', 'fw2', 2); return; }
  fwLaunch(o, s, c);
}
// 弹从哪个挂点出去（模型坐标 → 游戏坐标，跟着机身姿态）：按已经打掉的枚数轮换左右
function fwStation(o, s) {
  const mk = fpMdlKey(o), T = FW_ST[mk] || {}, L = s.bay === 'side' ? T.sideX : fwSlots(T, s.bay, s.W), M = typeof V3G === 'object' && V3G.M[mk];
  if (L && M && M.ready) { const n = L.length, p = fpMdlXf(o).pt(L[((n - s.n) % n + n) % n]); return [p[0], -p[1], p[2]]; }   // 剩 n 枚打第一个挂点，剩一枚打最后一个
  const P = fpPose(), B = fpBody(o);
  return [P.x - B.u[0] * 1.2, P.y + B.u[1] * 1.2, P.z - B.u[2] * 1.2];   // 模型还没下载好：机腹下面
}
function fwLaunch(o, s, c) {
  const Wd = s.W, p = fwStation(o, s), F = o.fl, B = fpBody(o);
  const vA = F ? [F.V[1], F.V[0], -F.V[2]] : [Math.cos(o.heading || 0) * (o.spd || 200), -Math.sin(o.heading || 0) * (o.spd || 200), 0];   // 飞机的速度（GL：东、北、上）
  const push = s.bay === 'main' ? (Wd.k === 'gb' ? 5 : 7) : s.bay === 'ext' ? 2 : 0;   // 内埋的被弹射臂往下推出舱外，外挂的脱离挂架
  const v = [0, 1, 2].map(i => vA[i] - B.u[i] * push);
  const ty = c.o.type, stl = typeof eaStl === 'function' && c.t === 'eair' ? eaStl(c.o) : 1, ftr = ty === 'ftr' || ty === 'ftrb' || ty === 'f22';
  const pk = Wd.pk * (Wd.k === 'aam' ? (ftr ? .9 : 1.05) * (stl < .6 ? .9 : 1) : 1);
  const m = { id: S.nid++, kind: Wd.k === 'aam' ? 'sam' : 'pgm', side: 'p', src: 'fp', x0: p[0], y0: p[1], x: p[0], y: p[1], z: .5, z3: p[2], tx: c.x, ty: c.y, t: 0, dur: Wd.M > 0 ? 80 : 150, ph: 'boost',
    tgt: { k: c.t || 'eair', id: c.o.id }, pk, w: Wd.pg || s.w, lr: s.w === 'pl17' || undefined, icp: false, sup: 0,
    fw: { w: s.w, ms: Wd.ms, v, ign: s.bay === 'main' ? .35 : s.bay === 'ext' ? .12 : 0, lit: false } };
  S.missiles.push(m);
  o.fwN[s.w]--;
  const f = fwField(s.w); o[f] = Math.max(0, (o[f] ?? 0) - 1);
  if (f === 'gbN' && o.gbN === 0) o.dropped = true;
  S.stats.shots++;
  if (Wd.k === 'aam' && typeof awStat === 'function') awStat(s.w === 'pl17' ? 'aamL' : 'aamP');
  V3FP.cool = Wd.k === 'aam' ? .5 : .8; V3FP.imp = .5;   // 挂架、弹射臂的冲击（受力回馈）
  log(`发射${Wd.nm}，打 ${(c.d / 1000).toFixed(1)} 公里外的${c.nm}（还剩 ${o.fwN[s.w]} 枚）`, 'info', 'fwl', 0, { x: c.x, y: c.y });
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
  if (air) { T = msTgtObj(m.tgt); if (T) tp = [T.x, -T.y, v3AirZ(T)]; }
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
  if (lit && m.t - F.ign < Wd.tb) { const vm = Wd.M * FW_A, k = sp < vm ? 20 * FW_G : (vm - sp) * 2; for (let i = 0; i < 3; i++) a[i] += u[i] * k; }
  else if (lit || Wd.M === 0) { const kd = Wd.M === 0 ? 4e-5 : 1.4e-5; for (let i = 0; i < 3; i++) a[i] -= u[i] * kd * sp * sp; }
  if (Wd.M === 0) a[2] += FW_G * .85;   // 炸弹的弹翼升力：滑翔（不然像石头一样掉）
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
    if (air && T && miss < 12) { m.done = true; m.x = T.x; m.y = T.y; msSamHit(m, T); return; }
    if (!air && miss < 3) { fwGround(m, T, tp[0], -tp[1]); return; }
  }
  if (!air && p[2] <= Math.max(gz, -2.6) + .3) { fwGround(m, T, m.x, m.y); return; }   // 打在地上 / 海面上
  const slow = Wd.M > 0 && m.t > F.ign + Wd.tb && sp < 260;   // 发动机停了、速度掉下来：没有能量了，自毁
  if (m.t > m.dur || slow || (air && !T && m.t > 2) || p[2] < Math.max(gz, -2.6) || m.x < -12000 || m.x > W + 12000 || m.y < -12000 || m.y > H + 12000) { m.done = true; msPuff(m.x, m.y, 'p'); }
}
function fwGround(m, T, x, y) {
  m.done = true; m.x = m.tx = x; m.y = m.ty = y;
  if (typeof msPgmHit === 'function') msPgmHit(m, T, MS_PGM[m.w] || MS_PGM.ft8);
}

// —— 平显（v3pilot.js v3fpOverlay 调用）：选中武器的大环、环里目标的锁定框（锁稳了变红）、环下方武器名与余弹 ——
function fwHud(ctx) {
  const o = V3FP.o, s = fwSelW();
  if (!o || !s || !V3.cam || fpOnDeck(o)) return;
  const B = fpBody(o), P = fpPose(), E = V3.cam.E, ck = V3FP.vw === 'cock';
  const b = ck ? [E[0], -E[1], E[2]] : [P.x, P.y, P.z], D = 4000;   // 座舱里从眼睛看出去（符号在无穷远，和窗外对齐）；跟随视角从飞机出发
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
  // 锁定框：锁的过程中是绿的，锁稳了变红；打第一个的那个框粗一些
  const first = V3FP.fwC.find(c => c.red);
  for (const c of V3FP.fwC) {
    const q = v3Proj(c.x, c.y, c.z);
    if (!q) continue;
    const r = 12;
    ctx.strokeStyle = c.red ? FW_RED : FW_HUD; ctx.lineWidth = c === first ? 2.6 : 1.6;
    ctx.strokeRect(q.x - r, q.y - r, r * 2, r * 2);
  }
  // 武器名与余弹（环的下边）
  if (low) {
    ctx.fillStyle = s.n > 0 ? FW_HUD : FW_RED; ctx.font = '13px "IBM Plex Mono", "Noto Sans SC", monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(`${s.W.nm} ×${s.n}`, low.x, Math.min(low.y + 8, CAM.vh - 40));
  }
  ctx.restore();
}
