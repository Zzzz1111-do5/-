'use strict';
// 团长战法表：团长按「命令 × 本团编成 × 当面敌情」查表决定打法与队形（hq.js regThink 使用）
// 表里的数是团级训练场自对弈调出来的（tools/train_reg.js：同一局面用不同打法各打多遍，按任务完成、交换比、用时打分，取最好的一组）；
// 没训练到的局面用 DOC_BASE，再按常识修正（docOf）
// 键：命令|编成|敌情
//   命令 atk 进攻（含反冲击）· def 防御
//   编成 armor 装甲团（车辆战斗力占六成以上）· mech 机步团（两成五到六成）· inf 步兵团
//   敌情 inf 步兵为主 · armor 坦克为主 · mixed 步坦合成 · fort 依托工事（碉堡、重型掩体）
// 参数：
//   form 各连队形：line 横队 · wedge 楔形（中间突前）· vee 倒楔形（两翼突前、便于合围）· echL / echR 左 / 右梯形
//   arm 坦克位置：front 坦克在步兵前（装甲先导）· mixed 步坦交错并进 · rear 坦克在步兵后火力掩护（步兵先导）
//   wid 正面宽度系数（1 = 每连约 95）· bound 交替跃进（半数前进、半数原地火力掩护）· pace 接敌后推进速度系数
//   prep 发起冲击前的火力准备秒数（舰炮 / 炮兵打目标）· flank 派出迂回的连队比例（0 / .25 / .34）
//   press 兵力比高于它就压上去（防御时为就地反冲击的门槛）· ret 兵力比低于它就后撤重整 · depth 防御时二线兵力比例
const DOC_BASE = { form: 'line', arm: 'mixed', wid: 1, bound: 0, pace: .8, prep: 0, flank: 0, press: 1.3, ret: .5, depth: .25 };
const DOC_KEYS = { form: ['line', 'wedge', 'vee', 'echL', 'echR'], arm: ['front', 'mixed', 'rear'] };
const DOCTRINE = {
  'atk|armor|armor': {form: 'echR', arm: 'front', wid: 1, bound: 1, pace: 0.8, prep: 15, flank: 0.25, press: 1, ret: 0.7},
  'atk|armor|fort': {form: 'echL', arm: 'front', wid: 1, bound: 0, pace: 1, prep: 15, flank: 0, press: 1.8, ret: 0.5},
  'atk|armor|inf': {form: 'line', arm: 'front', wid: 1, bound: 0, pace: 0.8, prep: 15, flank: 0, press: 1.3, ret: 0.7},
  'atk|armor|mixed': {form: 'echL', arm: 'mixed', wid: 1, bound: 1, pace: 0.6, prep: 30, flank: 0.34, press: 1, ret: 0.7},
  'atk|inf|armor': {form: 'line', arm: 'mixed', wid: 1, bound: 0, pace: 0.6, prep: 0, flank: 0, press: 1.3, ret: 0.5},
  'atk|inf|fort': {form: 'vee', arm: 'front', wid: 1.4, bound: 1, pace: 0.6, prep: 30, flank: 0.34, press: 1, ret: 0.5},
  'atk|inf|inf': {form: 'line', arm: 'front', wid: 0.7, bound: 1, pace: 0.6, prep: 30, flank: 0.34, press: 1.8, ret: 0.7},
  'atk|inf|mixed': {form: 'echL', arm: 'front', wid: 1.4, bound: 1, pace: 0.6, prep: 30, flank: 0, press: 1, ret: 0.3},
  'atk|mech|armor': {form: 'vee', arm: 'mixed', wid: 1.4, bound: 0, pace: 0.8, prep: 15, flank: 0, press: 1.8, ret: 0.3},
  'atk|mech|fort': {form: 'echL', arm: 'front', wid: 1, bound: 1, pace: 1, prep: 15, flank: 0, press: 1.8, ret: 0.7},
  'atk|mech|inf': {form: 'echL', arm: 'rear', wid: 1, bound: 0, pace: 0.8, prep: 30, flank: 0.25, press: 1.3, ret: 0.7},
  'atk|mech|mixed': {form: 'echR', arm: 'front', wid: 1, bound: 0, pace: 0.8, prep: 30, flank: 0.34, press: 1.8, ret: 0.3},
  'def|armor|inf': {arm: 'front', wid: 0.7, press: 2.4, ret: 0.7, depth: 0},
  'def|inf|armor': {arm: 'mixed', wid: 1, press: 1.3, ret: 0.5, depth: 0.25},
  'def|inf|inf': {arm: 'front', wid: 1, press: 1.6, ret: 0.5, depth: 0},
  'def|inf|mixed': {arm: 'mixed', wid: 1.4, press: 1.2, ret: 0.3, depth: 0.25},
  'def|mech|armor': {arm: 'rear', wid: 1.4, press: 1.6, ret: 0.5, depth: 0.25},
  'def|mech|inf': {arm: 'front', wid: 1, press: 1.2, ret: 0.3, depth: 0},
  'def|mech|mixed': {arm: 'rear', wid: 1, press: 1.6, ret: 0.7, depth: 0}
};
function docOf(task, own, foe) {
  const k = `${task}|${own}|${foe}`, d = DOCTRINE[k] || DOCTRINE[`${task}|${own}|mixed`];
  if (d) return { ...DOC_BASE, ...d, key: k };
  // 未训练的局面：常识打法——打工事先火力准备、步兵先导；对坦克步兵在前、坦克后撤火力掩护；装甲团打步兵坦克先导
  const o = { ...DOC_BASE, key: k + '*' };
  if (foe === 'fort') Object.assign(o, { arm: own === 'armor' ? 'mixed' : 'rear', prep: 20, bound: 1, pace: .7 });
  else if (foe === 'armor') Object.assign(o, { arm: 'rear', form: 'line', wid: 1.2 });
  else if (own === 'armor') Object.assign(o, { arm: 'front', form: 'wedge' });
  if (task === 'def') Object.assign(o, { arm: 'rear', form: 'line', press: 1.6 });
  return o;
}
