'use strict';
// 伪装与隐蔽（固定机制，双方通用）：静止、一段时间没开火、在工事里（散兵坑挖到一半以上、堑壕）或林地、城镇、丘陵里的步兵小组，
//   远处的侦察机、舰船、观察所看不出来——只有对方地面部队（步兵小组 CVL.r、车辆 CVL.rv 以内）才看得见；
//   一开火（含单兵防空导弹）就暴露 CVL.fire 秒，一移动就暴露到停下 CVL.still 秒后。
//   这样舰炮、航空兵在登陆前只能打已经发现的工事和暴露的部队，打不着躲在工事里不开火的守军（反过来进攻方挖好坑的部队也一样）。
// 实现：每次算完双方视野（logistics.js updateVision 调 cvlApply），把没被近处发现的隐蔽小组所在格从对方视野里抹掉——
//   同格还有暴露的小组、车辆、工事时不抹；被抹掉的格画面上照常显示为可见（CVL_DISP，matrix.js fogBytes / camera.js 小地图），只是看不见这个小组。
// 战前工事：守方在开战前早已构筑阵地——敌步兵还没上岸到 CVL.prepR 以内时，守方静止的小组挖坑快 CVL.prepK 倍（几秒就进入挖好的散兵坑）
// 守方火炮、迫击炮、高炮、岸防炮、发射车也一样：伪装网下、坑道里，没开火（e.fireT）、没转移阵地时，只有对方地面部队 CVL.rs 以内才看得见；
//   开火后 CVL.sfire 秒内暴露（炮口闪光、尾焰）——标定了的坐标照样记着（e.kx），转移阵地后要重新找
const CVL = { r: 70, rv: 60, still: 6, fire: 8, cover: .65, pit: .5, prepR: 320, prepK: 8, cell: 100, rs: 90, sfire: 12, vstill: 8 };
const CVL_ST = { arty: 1, mortar: 1, aa: 1, coastal: 1, tel: 1, ascm: 1 };
const cvlStHid = e => !e.dead && CVL_ST[e.kind] && !e.decoy && !e.moving && S.t - (e.fireT ?? -99) >= CVL.sfire;
// 车辆（双方）：停在林地、城镇、丘陵里熄火伪装 CVL.vstill 秒以上、没开过炮 / 机枪 / 导弹，空中、海上看不出来，地面部队 CVL.rs 以内才看得见；开阔地上的车照样一眼看见
const cvlVHid = v => !v.dead && !v.lst && !v.swim && !v.fixed && S.t - (v.movedT ?? -99) >= CVL.vstill && S.t - Math.max(v.fireT ?? -99, v.mgT ?? -99, v.samT ?? -99) >= CVL.sfire && isLand(v.x, v.y) && coverAt(v.x, v.y) <= CVL.cover;
let CVL_DISP = new Uint8Array(GW * GH);
onWorld(() => { CVL_DISP = new Uint8Array(GW * GH); });
let CVL_CLR = [];   // 上次抹掉的格（画面掩码复位用）

const cvlOn = () => !!S && !(S.v7off && S.v7off.cvl);
function cvlCovered(q) {
  if (q.inTrench) return true;
  const h = typeof digHole === 'function' ? digHole(q) : null;
  return (h && h.d >= CVL.pit) || coverAt(q.x, q.y) <= CVL.cover;
}
// 多久没暴露：移动、开火（步枪 / 机枪 fT、单兵防空导弹 aaSeen / aaSeenE）
const cvlQuiet = q => S.t - (q.movedT ?? -99) >= CVL.still && S.t - Math.max(q.fT ?? -99, q.aaSeen ?? -99, q.aaSeenE ?? -99) >= CVL.fire;
const cvlHid = q => !q.boarded && cvlQuiet(q) && isLand(q.x, q.y) && cvlCovered(q);

function cvlApply() {
  for (const i of CVL_CLR) CVL_DISP[i] = 0;
  CVL_CLR = [];
  if (!cvlOn() || S.phase !== 'battle') return;
  for (const side of ['e', 'p']) {
    const foe = side === 'e' ? 'p' : 'e', vis = side === 'e' ? PV : EV;
    // 对方的地面观察者：上岸的步兵小组、车辆（按 100 见方分桶）
    const B = new Map(), put = (x, y, r) => { const k = Math.floor(x / CVL.cell) * 1000 + Math.floor(y / CVL.cell); let a = B.get(k); if (!a) B.set(k, a = []); a.push(x, y, r); };
    for (const o of S.teams) if (o.side === foe && o.men.length && !o.ride && isLand(o.x, o.y)) put(o.x, o.y, CVL.r);
    for (const v of S.veh || []) if (v.side === foe && !v.dead && !v.lst && !v.swim && isLand(v.x, v.y)) put(v.x, v.y, CVL.rv);
    const near = (x, y, r) => {   // r：工事等按 CVL.rs 算（大于小组的发现距离）；0 = 按观察者自己的距离
      const gx = Math.floor(x / CVL.cell), gy = Math.floor(y / CVL.cell);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const a = B.get((gx + dx) * 1000 + gy + dy);
        if (a) for (let j = 0; j < a.length; j += 3) if (dist(a[j], a[j + 1], x, y) < (r || a[j + 2])) return true;
      }
      return false;
    };
    // 同格里还有暴露目标（没隐蔽的小组、车辆、工事）就不抹
    const hide = [], keep = new Set();
    for (const q of S.teams) if (q.side === side && q.men.length && !q.ride) { if (cvlHid(q)) hide.push(q); else keep.add(ci(q.x, q.y)); }
    for (const v of S.veh || []) if (v.side === side && !v.dead) { if (cvlVHid(v)) hide.push(v); else keep.add(ci(v.x, v.y)); }
    if (side === 'e') for (const e of S.enemies) if (!e.dead) { if (cvlStHid(e)) hide.push(e); else keep.add(ci(e.x, e.y)); }
    for (const q of hide) {
      const i = ci(q.x, q.y);
      if (!vis[i] || keep.has(i) || near(q.x, q.y, q.men ? 0 : CVL.rs)) continue;   // 工事、车辆按 CVL.rs 算发现距离
      vis[i] = 0;
      if (side === 'e') { CVL_DISP[i] = 1; CVL_CLR.push(i); }
    }
  }
}

// 战前工事：敌步兵还没上岸到附近时，守方静止的小组很快就有挖好的散兵坑（dig.js 的坑，坑里的人照常享受减伤）
let CVL_PT = 0;
function cvlPrep(dt) {
  if (!cvlOn() || S.phase !== 'battle' || !S.holes || (CVL_PT += dt) < .5) return;
  const t = CVL_PT; CVL_PT = 0;
  const P = S.teams.filter(o => o.side === 'p' && o.men.length && !o.ride && isLand(o.x, o.y));
  for (const q of S.teams) {
    if (q.side !== 'e' || !q.men.length || q.ride || q.hole == null || S.t - (q.movedT ?? -99) < 3) continue;
    const h = digHole(q);
    if (!h || h.d >= 1 || P.some(o => dist(o.x, o.y, q.x, q.y) < CVL.prepR)) continue;
    h.d = Math.min(1, h.d + t / DIG.t * (CVL.prepK - 1));   // dig.js 正常速度之外再加
  }
}
HOOK.step.push(cvlPrep);
