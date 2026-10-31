'use strict';
// 每型装备身上「能动的功能」与真实参数（逐型单独查的公开资料，出处写在各项注释里）：
//   3D 模型的部件怎么动由这里定——js/v3g.js 的 v3gVeh 每帧调 vfnParts，按车辆此刻的状态（目标、开火、行驶、上下车、扫雷）算出 8 个部件参数；
//   模型里哪块是炮塔、炮管、发射架、跳板、车轮在 tools/v3gmodels.json 的 parts（w / e / w2 / e2 / g2 权重指向下面的参数槽）。
//   参数槽：iC0 炮塔 / 转台相对车体的方位角（弧度，逆时针正）· iC1 主武器俯仰（弧度，抬起正）· iC2 雷达自转角 · iC3 车轮滚过的路程（模型米，各轮按自己的半径换成转角）
//           iD0 跳板 / 舱门开度（0–1）· iD1 发射架起竖 / 犁铲抬起（0–1）· iD2 炮管后坐（米）· iD3 副武器俯仰（弧度）或加特林炮管束转角
//   推演里的炮塔转速也从这里取（vehicles.js vehTick：vfnTrav）。
//   字段：trav 炮塔回转速度 °/s · el [俯角, 仰角] 主武器俯仰范围 °、elR 俯仰速度 °/s · rc 后坐行程（模型米）、rock 车体后坐翘起幅度 ·
//         tur3d 推演里这型车没有炮塔（装甲运兵车类型），画面上炮塔照样转向它正在打的目标 ·
//         erect { t 起竖用时 s, need 'veh' 只在打车辆时起竖 / 'any' 有目标就起竖, stop 要停车, inv 模型本身是起竖状态 } · el2 [俯, 仰] 副武器俯仰范围 ° ·
//         ramp { t 放下用时 s } · spin 雷达每分钟转数 · gat 加特林炮管束每分钟转数（开火时） · plow { t 抬放用时 s }（扫雷时放下）· roll 车轮随里程滚动
const VFN = {
  // —— 美军 ——
  // M2A3 布雷德利：炮塔 360° 连续回转，回转、俯仰最大速度都是 60°/s；25 毫米 M242 俯仰 −9° 至 +59°（Jane's 记作 −10° 至 +60°）；
  //   双联陶式发射架在炮塔左侧，射击前要先起竖锁定（同类发射架规范：起竖并锁定不超过 8 秒），起竖后俯仰 −19° 至 +29°、转速 15°/s，车要停下才打；
  //   车尾动力跳板放下供 6 名步兵上下车（未查到公开的放下用时，按液压跳板常见的 6 秒）；每侧 6 个负重轮、主动轮在前
  //   出处：美军军械教材 OD1609（Bradley 炮塔数据表）、Jane's Tanks and Combat Vehicles、afvdatabase.com
  m2a3: { trav: 60, el: [-9, 59], elR: 60, rc: .05, tur3d: 1, erect: { t: 8, need: 'veh', stop: true }, el2: [-19, 29], el2R: 15, ramp: { t: 6 }, roll: 1 },
  // M109 帕拉丁 155 毫米自行榴弹炮：炮塔 360°（M109A5 动力回转 7°/s；早期型最大 11°/s、俯仰 7°/s），俯仰 −3° 至 +75°；
  //   最大射速每分钟 4 发（持续 3 分钟），持续射速每分钟 1 发，A6 起可 15 秒内急速射 3 发；推演里自行火炮整车对准目标、停车射击，这里炮管按射程抬到弹道仰角
  //   后坐行程未查到公开数据，按同级 155 毫米榴弹炮约 0.6 米；每侧 7 个负重轮，主动轮在前
  //   出处：army-technology.com（Paladin M109A7）、weaponsystems.net（M109A5）、armyrecognition.com
  m109: { trav: 7, el: [-3, 75], elR: 7, rc: .6, rock: .02, roll: 1 },
  // 斯特赖克（M1126 步兵输送车外形，代 M1134 反坦克车、M1127 侦察车、M-SHORAD 防空车）：M151「保护者」遥控武器站 360° 连续，
  //   俯仰 −20° 至 +60°，方位最大 100°/s 以上、俯仰 50°/s 以上；车尾液压跳板（9 名步兵）；8×8，前四轮转向
  //   出处：Kongsberg Protector RWS 公开参数（维基百科 Protector RWS）、M1126 infantry carrier vehicle 条目
  stryker: { trav: 100, el: [-20, 60], elR: 50, tur3d: 1, ramp: { t: 6 }, roll: 1 },
  // M163 火神自行高炮（M113 底盘）：20 毫米 M61 六管加特林，连续射速每分钟 1000 发、短点射 3000 发（炮管束每分钟 500 转）；
  //   俯仰 −5° 至 +80°（俯仰 45–60°/s），360° 回转约 60–75°/s；AN/VPS-2 测距雷达随炮俯仰（250–5000 米）
  //   出处：维基百科 M163 VADS、afvdatabase.com、FAS
  m163: { trav: 60, el: [-5, 80], elR: 45, gat: 500 },
  // C-RAM 陆基密集阵（百人队长）：Block 1B，20 毫米 M61A1 六管，射速每分钟 4500 发（炮管束每分钟 750 转），弹舱 1550 发；
  //   俯仰 −25° 至 +85°（115°/s），方位 116°/s；陆用弹自毁（打不中在空中自炸，不落到己方阵地）
  //   出处：维基百科 Phalanx CIWS、navweaps.com
  cram: { trav: 116, el: [-25, 85], elR: 115, gat: 750 },
  // M903 爱国者发射车：行军时发射箱平放在拖车上，发射时起竖到固定仰角约 38°（模型实测 37°、与公开照片一致）；
  //   可装 4 枚 PAC-2 或最多 16 枚 PAC-3（德军按重量只装 8 枚）；起竖用时未查到公开数据，按约 12 秒
  //   出处：维基百科 MIM-104 Patriot、esut.de（M903 与 PAC-3 MSE）
  patriot: { erect: { t: 12, need: 'any', inv: true } },
  // M1150 突击破障车（M1 底盘）：全宽扫雷犁行军时抬起、扫雷时放下贴地开出通路；两具 MICLIC 直列装药火箭（另做）
  m1150: { plow: { t: 3 } },
  // M-ATV 防地雷全地形车（代 JLTV、M1117）：车顶 O-GPK 炮塔人力 / 电动回转（未查到公开转速，按 40°/s）
  matv: { trav: 40, tur3d: 1, roll: 1 },
  hmmwv: { roll: 1 },
  // —— 解放军 ——
  // ZBD-04 步兵战车（原称 97 式，代 ZBD-05、ZBD-03）：炮塔仿俄 BMP-3，100 毫米炮 / 炮射导弹 + 30 毫米 2A72 并列机关炮，360° 回转、两轴稳定；
  //   俯仰 −5° 至 +60°（BMP-3 数据），回转约 46°/s（游戏资料估算）；100 毫米炮每分钟 8–10 发，30 毫米每分钟约 300 发；载 7 名步兵
  //   出处：army-technology.com（ZBD-97 / ZBD-04A）、globalsecurity.org（Type 04）、FAS / armyrecognition（BMP-3）
  zbd97: { trav: 46, el: [-5, 60], elR: 30, rc: .2, tur3d: 1, roll: 1 },
  // PTL-02 轮式突击炮：100 毫米高膛压低后坐力滑膛炮（由 86 式反坦克炮发展），每分钟 8–10 发，最大仰角 38°（间瞄射程 13.7 公里），俯角约 −4°；
  //   炮塔在车尾，6×6；回转速度未查到公开数据（按 30°/s）
  //   出处：globalsecurity.org（PTL-02）、tanknutdave.com、army-guide.com
  ptl02: { trav: 30, el: [-4, 38], elR: 20, rc: .3, rock: .025, roll: 1 },
  // PGL-625 弹炮结合防空车：25 毫米六管加特林（射速每分钟约 3000–5000 发，炮管束按每分钟 600 转画）+ 炮塔两侧各 4 枚近程防空导弹，
  //   炮塔后部搜索雷达旋转、光电跟踪；8×8 轮式底盘；回转、俯仰速度未查到公开数据（按 90°/s、60°/s，俯仰 −5° 至 +85°）
  //   出处：armyrecognition.com（Type 625 列装）、deagel.com、defence-blog.com
  t625: { trav: 90, el: [-5, 85], elR: 60, spin: 60, gat: 600, roll: 1 },
  // PzH 2000 自行榴弹炮（代 PLZ-07）：155 毫米 52 倍径，俯仰 −2.5° 至 +65°，360° 动力回转；急速射 3 发约 9–10 秒，持续每分钟 10–13 发
  //   回转、俯仰速度与后坐行程未查到公开数据（按 15°/s、10°/s、0.75 米）
  //   出处：KNDS 官方 PzH 2000 页面、globalsecurity.org、维基百科
  pzh2000: { trav: 15, el: [-2.5, 65], elR: 10, rc: .75, rock: .02, roll: 1 },
  // LAV-25 轮式装甲车（代 ZSL-92B、08 式）：炮塔 360° 稳定，M242 25 毫米（420 发）+ M240C 并列机枪；俯仰约 −10° 至 +60°（未查到一手数据）；
  //   全两栖，车尾两具螺旋桨，水上约 10–12 公里 / 小时，入水准备 3 分钟
  //   出处：维基百科 LAV-25、globalsecurity.org、FAS
  lav25: { trav: 60, el: [-10, 60], elR: 45, rc: .05, tur3d: 1, roll: 1 }
};
const vfnOf = key => VFN[key] || null;
// 推演里的炮塔回转速度（弧度 / 秒）：有型号参数就按真实的，没有照旧 2.4
function vfnTrav(v) {
  const k = typeof rlModelOf === 'function' && typeof V3G_VEH === 'object' ? (rlModelOf(v) || {}).key : null, F = k && VFN[V3G_VEH[k] || k];
  return F && F.trav ? F.trav * Math.PI / 180 : 2.4;
}
// 每辆车画面上的动作状态（不进 S：只是动画，S 换了就重来）
const VFN_ST = new WeakMap();
const vfnSlew = (a, b, r) => a + Math.max(-r, Math.min(r, b - a));
const vfnAng = a => Math.atan2(Math.sin(a), Math.cos(a));
// 正在打的目标（主武器的，没有就机枪的）
const vfnTgt = v => (v.tg && v.tg.t && !v.tg.t.dead ? v.tg : null) || (v.mtg && v.mtg.t && !(v.mtg.t.men && !v.mtg.t.men.length) && S.t - (v.mgT ?? -99) < 3 ? v.mtg : null);
// 主武器想要的俯仰角（弧度）：直瞄按目标的高低差，间瞄（自行火炮）按射程换算的弹道仰角（最大射程 45°），对空按飞机的高度；没目标回到 0
function vfnElWant(v, F, z, gz) {
  const sp = typeof vehSp === 'function' ? vehSp(v) : {}, g = sp.gun, tg = vfnTgt(v), D2R = Math.PI / 180;
  const lo = F.el[0] * D2R, hi = F.el[1] * D2R;
  if (v.aaAt != null && S.t - v.aaAt < 1.2) {   // 对空：按正在打的那架飞机的 3D 高度仰起（vehAA 记的 aaId）
    const p = (S.planes || []).find(o => o.id === v.aaId) || (S.eair && S.eair.fly || []).find(o => o.id === v.aaId);
    if (p && typeof v3AirZ === 'function') return Math.max(lo, Math.min(hi, Math.atan2(v3AirZ(p) - z - gz, Math.max(1, Math.hypot(p.x - v.x, p.y - v.y)))));
  }
  if (!tg) return 0;
  const tx = tg.t ? tg.t.x : tg.x, ty = tg.t ? tg.t.y : tg.y, d = Math.max(1, Math.hypot(tx - v.x, ty - v.y));
  if (g && g.ind && tg === v.tg) return Math.max(lo, Math.min(hi, .5 * Math.asin(Math.min(1, d / (g.range * 1.05))) + 4 * D2R));
  const tz = typeof v3Ht === 'function' ? v3Ht(tx, ty) + (tg.k === 'veh' ? 1.2 : .9) : z;
  return Math.max(lo, Math.min(hi, Math.atan2(tz - z - gz, d)));
}
// 8 个部件参数。k：世界单位 / 模型米；h 车头朝向；aim 炮塔朝向（世界）；fs 主炮开火后几秒；z 车所在地面高度
function vfnParts(v, key, k, h, aim, dead, fs, z) {
  const F = VFN[key];
  if (!F) return null;
  const P = [0, 0, 0, 0, 0, 0, 0, 0], now = typeof performance === 'object' ? performance.now() / 1000 : S.t;
  let st = VFN_ST.get(v);
  if (!st) VFN_ST.set(v, st = { t: now, el: 0, el2: 0, er: 0, rp: 0, pl: 1, ty: 0, gs: 0, rn: (v.ride || []).length, rT: -99 });
  const dt = Math.max(0, Math.min(.2, now - st.t)), D2R = Math.PI / 180;
  st.t = now;
  P[0] = dead ? -.6 : -vfnAng(aim - h);
  if (F.tur3d && !dead) {   // 推演里没有炮塔：画面上的炮塔按真实转速转向正在打的目标，没目标时回正
    const tg = vfnTgt(v), want = tg ? -vfnAng(Math.atan2((tg.t ? tg.t.y : tg.y) - v.y, (tg.t ? tg.t.x : tg.x) - v.x) - h) : (v.aaAt != null && S.t - v.aaAt < 1.2 ? P[0] : 0);
    st.ty += Math.max(-1, Math.min(1, vfnAng(want - st.ty) / Math.max(1e-6, (F.trav || 40) * D2R * dt))) * (F.trav || 40) * D2R * dt;
    P[0] = st.ty = vfnAng(st.ty);
  }
  if (dead) { P[1] = F.el ? F.el[0] * D2R * .6 : 0; return P; }   // 残骸：炮管耷拉
  if (F.el) { st.el = vfnSlew(st.el, vfnElWant(v, F, z, 2.6 * k), (F.elR || 30) * D2R * dt); P[1] = st.el; }
  if (F.spin) P[2] = (now * F.spin / 60 * 2 * Math.PI + (v.id || 0) * 1.7) % (2 * Math.PI);
  if (F.roll) P[3] = (v.odo || 0) / k;
  if (F.ramp) {   // 跳板：等人上车（v.pick）、刚有人上下车的 8 秒里放下，车在走就收起
    const n = (v.ride || []).length;
    if (n !== st.rn) { st.rn = n; st.rT = now; }
    const want = !v.moving && ((v.pick && v.pick.length) || now - st.rT < 8);
    st.rp = vfnSlew(st.rp, want ? 1 : 0, dt / F.ramp.t); P[4] = st.rp;
  }
  if (F.erect) {   // 发射架：有合适的目标（停着车）就起竖，没目标 6 秒后收回；防空导弹发射车打飞机、拦导弹时也起竖
    const tg = vfnTgt(v), sam = S.t - (v.samT ?? -99) < 20 || (v.aaAt != null && S.t - v.aaAt < 20);
    const ok = (sam || (tg && (F.erect.need !== 'veh' || tg.k === 'veh' || tg.k === 'car'))) && !(F.erect.stop && v.moving);
    if (ok) st.eT = now;
    st.er = vfnSlew(st.er, ok || now - (st.eT ?? -99) < 6 ? 1 : 0, dt / F.erect.t); P[5] = F.erect.inv ? st.er - 1 : st.er;
    if (F.el2) { const w = st.er > .99 && tg ? Math.max(F.el2[0] * D2R, Math.min(F.el2[1] * D2R, vfnElWant(v, { el: F.el2 }, z, 3 * k))) : 0; st.el2 = vfnSlew(st.el2, w, (F.el2R || 15) * D2R * dt); P[7] = st.el2; }
  }
  if (F.plow) {   // 扫雷犁：在扫雷就放下，平时抬起
    const down = (v.order && v.order.t === 'clear') || v.ai === 'sweep';
    st.pl = vfnSlew(st.pl, down ? 0 : 1, dt / F.plow.t); P[5] = st.pl;
  }
  if (F.gat) {   // 加特林：开火时炮管束转起来（画面上按每分钟 F.gat 转，再快就是频闪），停火后 1.5 秒内慢下来
    const firing = S.t - (v.mgT ?? -99) < .6 || (v.aaAt != null && S.t - v.aaAt < .8) || fs < .6;
    st.gw = vfnSlew(st.gw || 0, firing ? 1 : 0, dt / (firing ? .3 : 1.5));
    st.gs = (st.gs + st.gw * F.gat / 60 * 2 * Math.PI * dt) % (2 * Math.PI); P[7] = st.gs;
  }
  if (F.rc && fs < .8) P[6] = F.rc * (fs < .06 ? fs / .06 : 1 - Math.min(1, (fs - .06) / .7) ** 2 * (3 - 2 * Math.min(1, (fs - .06) / .7)));
  return P;
}
