'use strict';
// 司令战法表（守方司令 hq.js hqOrgE / hqCmdE 使用）：按「机动兵力的编成」查表，决定怎么把手上的部队编成旅、怎么给各旅派任务。
// 表里的数是司令训练场调出来的（tools/train_cmd.js：同一批部署与对手用不同战法分支推演，按守住的据点、交换比打分，逐轮淘汰），没训练到的用 CMD_BASE
// 键：机动兵力里车辆战斗力的占比——inf 步兵为主（两成五以下）· mech 步坦合成（两成五到六成）· armor 装甲为主（六成以上）
// 参数：
//   tac 战术：bal 纵深防御、机动反击 · armor 装甲机动防御 · fort 要塞固守、逐次反击 · deep 诱敌深入、两翼合围
//   nb 机动旅个数（0 按团数自动：七个团以上三个旅、四个以上两个旅）
//   mass 装甲集中：1 坦克另编装甲团、组成一个装甲旅集中使用；0 坦克分到各合成团
//   resv 战役预备队：1 留一个旅在指挥所附近不动，等第一次反击受挫或敌突入纵深才投入
//   det 判明敌主攻方向的快慢：fast 敌上陆一成多就判明（12 人、多于别处三成）· mid 30 人或多于别处六成 · slow 45 人或两倍以上
//   ctr 反击方式：all 各旅同时反冲击 · echelon 最近的旅反冲击、其余作第二梯队跟进
const CMD_BASE = { tac: null, nb: 0, mass: 0, resv: 0, det: 'mid', ctr: 'echelon' };
const CMD_DET = { fast: [12, 1.3, 150], mid: [30, 1.6, 240], slow: [45, 2.2, 330] };
const CMD_DOC = {
  'e|inf': {tac: 'fort', nb: 0, mass: 0, resv: 0, det: 'slow', ctr: 'echelon'}
};
// 机动兵力的编成键
function cmdForceKey(us, vs) {
  const inf = us.reduce((a, u) => a + teamsOf(u).reduce((b, q) => b + q.men.length, 0), 0), veh = vs.reduce((a, v) => a + (typeof bgPow === 'function' ? bgPow(v) : 4), 0), f = veh / Math.max(1, inf + veh);
  return f >= .6 ? 'armor' : f >= .25 ? 'mech' : 'inf';
}
function cmdDocOf(side, key) {
  const d = CMD_DOC[`${side}|${key}`];
  return { ...CMD_BASE, ...(d || {}), key: `${side}|${key}${d ? '' : '*'}` };
}
