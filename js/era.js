'use strict';
// 爆炸反应装甲（vehicles.js vehDamage 先过 eraHit）：按车型在车体正面（首上装甲）、炮塔正面挂一块块的反应装甲，每块只能挡一发——
//   单装药的破甲弹（火箭筒、无后坐力炮，src = 'at'）从正面打在挂着反应装甲的地方：那块起爆，把金属射流炸散，几乎打不进去；
//   坦克炮弹（src = 'ap'，以尾翼稳定脱壳穿甲弹为主）：重型反应装甲（99A 的一类）能削掉一部分，那块也随之炸掉；轻型的挡不住穿甲弹，也不会被它白白引爆；
//   攻顶的导弹（红箭-12、标枪、地狱火：'top'、'atgm'）打的是车顶，正面的反应装甲帮不上；侧面、后面没挂；
//   挡过的那块就没了（v.era 记车体、炮塔正面各剩几块），同一面挂空了只能靠本体装甲硬扛
const ERA_BLK = { ztz99a: { hf: 18, tf: 14, heavy: true }, ztz96b: { hf: 12, tf: 12 }, ztq15: { hf: 10, tf: 8 } };   // 块数按真车估算
function eraOf(v) {
  if (v.era === undefined) {
    const M = typeof rlModelOf === 'function' ? rlModelOf(v) : null, B = M && ERA_BLK[M.key];
    v.era = B ? { hf: B.hf, tf: B.tf, hf0: B.hf, tf0: B.tf, heavy: !!B.heavy } : null;
  }
  return v.era;
}
// 返回反应装甲挡过以后还剩多少毁伤
function eraHit(v, dmg, pen, sx, sy, src) {
  if ((src !== 'at' && src !== 'ap') || sx == null || v.dead) return dmg;
  const E = eraOf(v);
  if (!E || (src === 'ap' && !E.heavy)) return dmg;
  const a = Math.atan2(sy - v.y, sx - v.x), tur = Math.random() < .5;   // 来弹方向；一半打在炮塔上、一半打在车体上
  const k = tur ? (Math.abs(vehAng(a - (v.aim ?? v.heading))) < .6 ? 'tf' : null) : (Math.abs(vehAng(a - v.heading)) < .55 ? 'hf' : null);
  if (!k || !(E[k] > 0)) return dmg;
  E[k]--;
  const r = tur ? 1.6 : 3.2;   // 起爆点：炮塔前、首上装甲
  S.fx.push({ kind: 'flash', x: v.x + Math.cos(a) * r, y: v.y + Math.sin(a) * r, r: 7, life: 0, max: .35, side: v.side });
  if (v.side === 'p') log(`${vehName(v)}的反应装甲挡住一发${src === 'ap' ? '穿甲弹（削弱）' : '破甲弹'}，${k === 'tf' ? '炮塔' : '车体'}正面还剩 ${E[k]} 块`, 'info', 'era' + v.id, 6, v);
  return dmg * (src === 'ap' ? .7 : .08);
}
