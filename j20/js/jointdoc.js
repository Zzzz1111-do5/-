'use strict';
// 协同参数表（按方）：团怎么把营捏成一个拳头、营怎么边打边撤——由司令—团—营联合训练场（tools/train_joint.js）训练，没训练的用这里的默认值
// 团（hq.js hqBdeThink）：
//   atk 攻击出发位置离目标多远 · fol 第二梯队在第一梯队后多远跟进 · sync 第一梯队等齐同时发起冲击最多等几秒
//   pass 第一梯队兵力掉到几成（或后撤）第二梯队就超越接替 · dep 防御时纵深营离目标多远
// 营的边打边撤（sa.js saDelay）：
//   bound 每一跃后撤多远 · fire 每几秒对追兵叫一次火力 · brk 有效兵力比低于后撤线的几成（且伤亡过大）就放烟幕脱离接触 · link 离主力多近算汇合
const BDE_DOC = {
  e: {atk: 340, fol: 420, sync: 30, pass: 0.55, dep: 360},
  p: {atk: 260, fol: 420, sync: 90, pass: 0.3, dep: 180}
};
const SA_DOC = {
  e: {bound: 80, fire: 18, brk: 0.5, link: 200},
  p: {bound: 80, fire: 12, brk: 0.5, link: 340}
};
// 训练场指定的候选（S.jointFix = { bde: { e, p }, sa: { e, p } }）覆盖表里的
const bdeDoc = side => ({ ...BDE_DOC[side] || BDE_DOC.e, ...(S && S.jointFix && S.jointFix.bde && S.jointFix.bde[side] || {}) });
const saDoc = side => ({ ...SA_DOC[side] || SA_DOC.e, ...(S && S.jointFix && S.jointFix.sa && S.jointFix.sa[side] || {}) });
