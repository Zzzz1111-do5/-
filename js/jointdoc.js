'use strict';
// 协同参数表（按方）：旅怎么把团捏成一个拳头、团怎么边打边撤——由司令—旅—团联合训练场（tools/train_joint.js）训练，没训练的用这里的默认值
// 旅（hq.js hqBdeThink）：
//   atk 攻击出发位置离目标多远 · fol 第二梯队在第一梯队后多远跟进 · sync 第一梯队等齐同时发起冲击最多等几秒
//   pass 第一梯队兵力掉到几成（或后撤）第二梯队就超越接替 · dep 防御时纵深团离目标多远
// 团的边打边撤（sa.js saDelay）：
//   bound 每一跃后撤多远 · fire 每几秒对追兵叫一次火力 · brk 有效兵力比低于后撤线的几成（且伤亡过大）就放烟幕脱离接触 · link 离主力多近算汇合
const BDE_DOC = {
  e: { atk: 340, fol: 420, sync: 60, pass: .4, dep: 260 },
  p: { atk: 340, fol: 420, sync: 60, pass: .4, dep: 260 }
};
const SA_DOC = {
  e: { bound: 110, fire: 12, brk: .5, link: 260 },
  p: { bound: 110, fire: 12, brk: .5, link: 260 }
};
// 训练场指定的候选（S.jointFix = { bde: { e, p }, sa: { e, p } }）覆盖表里的
const bdeDoc = side => ({ ...BDE_DOC[side] || BDE_DOC.e, ...(S && S.jointFix && S.jointFix.bde && S.jointFix.bde[side] || {}) });
const saDoc = side => ({ ...SA_DOC[side] || SA_DOC.e, ...(S && S.jointFix && S.jointFix.sa && S.jointFix.sa[side] || {}) });
