'use strict';
// 写实画面：照实车俯视外形逐型建模（单位：米，x 向前、y 向右）。车体、炮塔、炮管各预渲染成贴图（sprites.js），运行时只旋转贴图，
// 履带板滚动、投影、阵营细边、炮口焰、雷达旋转在运行时画。L、B：车体长宽（不含炮管）；run：'t' 履带（tw 履带宽）/ 'w' 轮式
// tur：{ x, y 回转中心 }；gun：{ x0 起点（炮塔坐标）, len 长, r 半径, fe [位置, 长, 半径] 抽烟装置, br 炮口制退器 0/1/2 级, sl 热护套箍数, oy 横向偏移 }
const rlMbt = (L, B, c = .35) => [[L / 2, -B / 2 + c], [L / 2, B / 2 - c], [L / 2 - c, B / 2], [-L / 2 + .15, B / 2], [-L / 2, B / 2 - .2], [-L / 2, -B / 2 + .2], [-L / 2 + .15, -B / 2], [L / 2 - c, -B / 2]];
const rlWedge = (L, B, n = .6) => [[L / 2, -B / 2 + n], [L / 2, B / 2 - n], [L / 2 - n * .9, B / 2], [-L / 2 + .1, B / 2], [-L / 2, B / 2 - .1], [-L / 2, -B / 2 + .1], [-L / 2 + .1, -B / 2], [L / 2 - n * .9, -B / 2]];
const rlBox = (L, B, c = .12) => [[L / 2, -B / 2 + c], [L / 2, B / 2 - c], [L / 2 - c, B / 2], [-L / 2 + c, B / 2], [-L / 2, B / 2 - c], [-L / 2, -B / 2 + c], [-L / 2 + c, -B / 2], [L / 2 - c, -B / 2]];
const rlOct = (r, sx = 1) => Array.from({ length: 8 }, (_, i) => { const a = (i + .5) * Math.PI / 4; return [Math.cos(a) * r * sx, Math.sin(a) * r]; });
const rlMir = half => [...half, ...half.slice().reverse().map(([x, y]) => [x, -y])];   // 由右半边轮廓镜像出整圈

// —— 通用车体 ——
// 履带车：翼子板底板 → 上车体（迷彩、做旧）→ 前上装甲 → 驾驶员舱盖与潜望镜 → 车灯 → 发动机格栅 → 翼子板储物箱 → 拖缆、工具、木梁
function rlTrk(P, o) {
  const { L, B, tw } = o, hl = L / 2, hb = B / 2, g = P.g;
  const full = P.poly(o.hull), seed = o.seed || 1;
  P.part(full, P.shade(P.paint, .9), { ao: .3, bev: .06, mid: () => P.dirt(full, L, B) });
  // 翼子板上的防滑纹与边缘
  for (const s of [-1, 1]) P.line(-hl + .25, s * (hb - tw), hl - .45, s * (hb - tw), .035);
  const dk = o.deck || [[o.gl, -hb + tw], [o.gl, hb - tw], [-hl + .12, hb - tw], [-hl + .12, -hb + tw]], dp = P.poly(dk);
  P.part(dp, P.paint, { ao: .18, bev: .1, mid: () => { P.camo(dp, seed); P.dirt(dp, L, B - tw * 2); } });
  if (o.glacis !== false) { const gp = P.poly([[hl - .05, -hb + tw + .15], [hl - .05, hb - tw - .15], [o.gl, hb - tw], [o.gl, -hb + tw]]); P.part(gp, P.shade(P.paint, 1.05), { ao: .08, bev: .08, mid: () => P.camo(gp, seed + 3) }); }
  if (o.era) P.era(o.era[0], o.era[1], o.era[2], o.era[3], o.era[4], o.era[5]);
  if (o.drv) { const [x, y] = o.drv; P.hatch(x, y, .3); for (let i = 0; i < (o.peri ?? 3); i++) P.peri(x + .38, y + (i - ((o.peri ?? 3) - 1) / 2) * .24, .2, .08, Math.PI / 2); }
  if (o.lights !== false) for (const s of [-1, 1]) { P.light(hl - .32, s * (hb - .3)); P.light(hl - .32, s * (hb - .56), .16, .12); }
  for (const gr of o.grilles || []) P.grille(...gr);
  for (const b of o.boxes || []) P.box(b[0], b[1], b[2], b[3], P.shade(P.paint, b[4] || .95), { r: .06 });
  for (const c of o.cables || []) P.cable(c);
  for (const t of o.tools || []) P.tool(...t);
  if (o.beam) P.box(-hl + .08, 0, .2, B * .62, '#5d4c33', { r: .04, tex: .4 });   // 尾部自救木
  if (o.exh) P.box(o.exh[0], o.exh[1], o.exh[2], o.exh[3], '#23231f', { bev: .04, tex: .15 });
  if (o.extra) o.extra(P);
}
// 轮式车：车轮 → 车体 → 细节
function rlWhl(P, o) {
  const { L, B } = o, hl = L / 2, hb = B / 2, seed = o.seed || 2;
  for (const x of o.ax) for (const s of [-1, 1]) P.wheel(x, s * (hb - o.ww * .32), o.wl, o.ww);
  const full = P.poly(o.hull);
  P.part(full, P.paint, { ao: .25, bev: .12, mid: () => { P.camo(full, seed); P.dirt(full, L, B); } });
  if (o.drv) { const [x, y] = o.drv; P.hatch(x, y, .28); for (let i = 0; i < 3; i++) P.peri(x + .34, y + (i - 1) * .22, .18, .08, Math.PI / 2); }
  if (o.lights !== false) for (const s of [-1, 1]) P.light(hl - .38, s * (hb - .32), .2, .14);
  for (const gr of o.grilles || []) P.grille(...gr);
  for (const b of o.boxes || []) P.box(b[0], b[1], b[2], b[3], P.shade(P.paint, b[4] || .95), { r: .06 });
  for (const c of o.cables || []) P.cable(c);
  for (const t of o.tools || []) P.tool(...t);
  if (o.extra) o.extra(P);
}
// 卡车 / 轮式底盘：驾驶室（风挡、顶棚）
function rlCab(P, x, w, B, col) {
  P.box(x, 0, w, B, col || P.paint, { r: .18 });
  P.box(x + w / 2 - .18, 0, .3, B * .86, SPR_GLASS, { r: .05, tex: false, hl: .3 });
  P.box(x - .1, 0, w * .55, B * .82, P.shade(col || P.paint, 1.06), { r: .12, ao: .06 });
}
// 炮塔底板（带迷彩）
const rlTur = (P, pts, seed = 5, col) => { const p = P.poly(pts); P.part(p, col || P.paint, { ao: .32, aoA: .7, bev: .14, mid: () => P.camo(p, seed, .8) }); };

const RLM = {
  // ———————— 解放军 ————————
  ztz99a: { L: 7.6, B: 3.5, run: 't', tw: .6, hull: rlMbt(7.6, 3.5), tur: { x: -.4 },
    gun: { x0: 2.2, len: 5.9, r: .115, fe: [2.4, .85, .165], sl: 3, mrs: 1 },
    H: P => rlTrk(P, { L: 7.6, B: 3.5, tw: .6, hull: rlMbt(7.6, 3.5), gl: 2.3, seed: 11, era: [2.45, -1.0, 3.6, 1.0, 3, 6], drv: [1.95, 0],
      grilles: [[-3.35, -1.05, -2.25, -.08, 7], [-3.35, .08, -2.25, 1.05, 7], [-3.72, -.9, -3.5, .9, 6, false]],
      boxes: [[-1.4, 1.46, 2.6, .36], [-1.8, -1.46, 2, .36], [.4, -1.46, .9, .34, .9]], cables: [[[-3.3, -1.18], [-1.9, -1.2], [-.6, -1.15], [.3, -1.0]]], tools: [[1.3, -1.46, 1, 0], [1.2, 1.46, .9, 0, 'bar']], beam: 1 }),
    T: P => {
      const out = [[-2.5, -1.35], [-2.5, 1.35], [-1.9, 1.62], [.8, 1.62], [2.25, .42], [2.25, -.42], [.8, -1.62], [-1.9, -1.62]];
      rlTur(P, out, 21);
      for (const s of [-1, 1]) {   // 箭形楔形附加装甲
        P.plate([[.75, s * 1.6], [2.2, s * .44], [1.65, s * .36], [.45, s * 1.18]], P.shade(P.paint, 1.07), { ao: .1, bev: .08 });
        P.line(.95, s * 1.4, 1.9, s * .5, .03);
      }
      P.box(1.95, 0, .6, .82, P.shade(P.paint, .85), { r: .12 });   // 炮盾
      P.mesh(-2.46, -1.22, -1.95, 1.22, 4);
      P.box(.7, -.82, .52, .4, P.shade(P.paint, .9)); P.box(.97, -.82, .06, .3, SPR_GLASS, { tex: false });   // 炮长瞄准镜
      P.disc(.15, .98, .2, SPR_METAL); P.box(.18, .98, .32, .26, P.shade(P.paint, .82), { r: .05 }); P.box(.36, .98, .05, .18, SPR_GLASS, { tex: false });   // 车长独立周视镜
      P.cupola(-.75, .72, .42, 6); P.mg(-.55, .72, -.15, 1.3, true);
      P.hatch(-.75, -.72, .38);
      P.box(-.15, -1.18, .55, .38, '#2a2b27'); P.disc(-.15, -1.18, .1, '#3d5a68');   // 激光压制 / 告警装置
      P.smoke(.45, 1.52, 5, Math.PI / 2); P.smoke(.45, -1.52, 5, -Math.PI / 2);
      P.disc(-2.2, .95, .07, SPR_METAL); P.disc(-1.75, -1.3, .06, SPR_METAL); P.disc(-1.75, 1.3, .06, SPR_METAL);   // 气象传感器、天线座
      P.bolts([[-1.5, -1.45], [-1.0, -1.45], [-1.5, 1.45], [-1.0, 1.45]]);
    } },
  ztz96b: { L: 6.9, B: 3.4, run: 't', tw: .58, hull: rlMbt(6.9, 3.4, .4), tur: { x: -.15 },
    gun: { x0: 1.85, len: 5.6, r: .115, fe: [2.3, .8, .16], sl: 3 },
    H: P => rlTrk(P, { L: 6.9, B: 3.4, tw: .58, hull: rlMbt(6.9, 3.4, .4), gl: 2.1, seed: 12, era: [2.2, -1.0, 3.3, 1.0, 2, 6], drv: [1.85, 0], peri: 1,
      grilles: [[-2.9, -1.0, -1.95, 1.0, 9]], exh: [-2.4, -1.55, .9, .22], boxes: [[-.6, 1.45, 3.2, .36], [-1.2, -1.45, 1.6, .36], [.6, -1.45, .8, .36]],
      cables: [[[-3.2, -.95], [-2.2, -1.12], [-.8, -1.1]]], tools: [[1.1, 1.45, .9, 0]],
      extra: P => { P.box(-3.25, -.62, .48, 1.0, P.shade(P.paint, .88), { r: .22 }); P.box(-3.25, .62, .48, 1.0, P.shade(P.paint, .88), { r: .22 }); P.line(2.55, -.85, 3.1, 0); P.line(3.1, 0, 2.55, .85); } }),
    T: P => {
      rlTur(P, [[-1.8, -1], [-1.8, 1], [-1.25, 1.45], [.3, 1.56], [1.2, 1.25], [1.75, .62], [1.88, 0], [1.75, -.62], [1.2, -1.25], [.3, -1.56], [-1.25, -1.45]], 22);
      for (const s of [-1, 1]) { P.g.save(); P.g.translate(1.12, s * .86); P.g.rotate(s * .72); P.era(-.42, -.27, .42, .27, 3, 2); P.g.restore(); P.g.save(); P.g.translate(.45, s * 1.25); P.g.rotate(s * .25); P.era(-.36, -.2, .36, .2, 2, 1); P.g.restore(); }
      P.box(1.7, 0, .42, .62, P.shade(P.paint, .85), { r: .1 });
      P.cupola(-.45, .55, .4, 5); P.mg(-.25, .55, .1, 1.3, true);
      P.hatch(-.45, -.6, .36); P.box(.35, -.82, .45, .34, P.shade(P.paint, .9)); P.box(.58, -.82, .05, .26, SPR_GLASS, { tex: false });
      P.smoke(.15, 1.42, 4, Math.PI / 2 - .3); P.smoke(.15, -1.42, 4, -Math.PI / 2 + .3);
      P.box(-1.72, 0, .26, 1.5, P.shade(P.paint, .82), { r: .08 }); P.disc(-1.4, -1.0, .06, SPR_METAL);
    } },
  ztq15: { L: 6.6, B: 3.3, run: 't', tw: .55, hull: rlMbt(6.6, 3.3, .3), tur: { x: -.3 },
    gun: { x0: 1.55, len: 4.6, r: .1, fe: [1.9, .7, .145], sl: 2 },
    H: P => rlTrk(P, { L: 6.6, B: 3.3, tw: .55, hull: rlMbt(6.6, 3.3, .3), gl: 2.2, seed: 13, era: [2.3, -.95, 3.2, .95, 2, 5], drv: [1.95, -.65],
      grilles: [[-3.05, -1.0, -2.0, -.05, 6], [-3.05, .05, -2.0, 1.0, 6]], boxes: [[-1, 1.4, 2.8, .34], [-1, -1.4, 2.8, .34]], cables: [[[-3.1, .9], [-1.6, 1.05], [-.4, 1.0]]], tools: [[1.0, -1.4, .9, 0]] }),
    T: P => {
      rlTur(P, [[-2.2, -1.2], [-2.2, 1.2], [-1.6, 1.45], [.8, 1.45], [1.6, .9], [1.6, -.9], [.8, -1.45], [-1.6, -1.45]], 23);
      for (const s of [-1, 1]) P.plate([[.8, s * 1.43], [1.58, s * .9], [1.05, s * .75], [.35, s * 1.15]], P.shade(P.paint, 1.06), { ao: .1, bev: .07 });
      P.box(1.45, 0, .45, .7, P.shade(P.paint, .85), { r: .1 });
      P.disc(-.1, .9, .22, SPR_METAL); P.box(-.08, .9, .34, .28, P.shade(P.paint, .82), { r: .06 }); P.box(.1, .9, .05, .2, SPR_GLASS, { tex: false });   // 车长周视镜
      P.box(-.7, -.82, .55, .45, '#2b2c28', { r: .06 }); P.mg(-.55, -.82, 0, 1.2, true);   // 遥控武器站
      P.hatch(-.85, .55, .34); P.box(.4, -.55, .4, .3, P.shade(P.paint, .9)); P.box(.6, -.55, .05, .22, SPR_GLASS, { tex: false });
      P.smoke(.6, 1.35, 4, Math.PI / 2 - .4); P.smoke(.6, -1.35, 4, -Math.PI / 2 + .4);
      P.mesh(-2.16, -1.08, -1.65, 1.08, 3);
    } },
  ztd05: { L: 9.5, B: 3.4, run: 't', tw: .5, hull: rlBox(9.5, 3.4), tur: { x: .1 },
    gun: { x0: 1.45, len: 4.4, r: .1, br: 2, fe: [1.6, .55, .14] },
    H: P => rlTrk(P, { L: 9.5, B: 3.4, tw: .5, hull: rlBox(9.5, 3.4), gl: 3.9, seed: 14, glacis: false, drv: [3.25, -.95],
      grilles: [[2.25, .2, 3.65, 1.42, 7]], boxes: [[-1.5, 1.5, 3.5, .3], [-1.5, -1.5, 3.5, .3]], tools: [[1, -1.5, 1, 0]],
      extra: P => {
        P.plate([[4.72, -1.55], [4.72, 1.55], [3.95, 1.6], [3.95, -1.6]], P.shade(P.paint, 1.08), { ao: .12, bev: .08 });   // 防浪板（折叠在车首）
        for (let i = -3; i <= 3; i++) P.line(4.0, i * .42, 4.65, i * .42, .03);
        for (const s of [-1, 1]) P.grille(-4.7, s * 1.25 - .32, -4.2, s * 1.25 + .32, 4);   // 喷水推进器出口
        P.box(-3.6, 0, 1.1, 1.6, P.shade(P.paint, .92), { r: .08 });
      } }),
    T: P => {
      rlTur(P, [[-1.75, -1.1], [-1.75, 1.1], [-1.15, 1.42], [.9, 1.42], [1.5, .8], [1.5, -.8], [.9, -1.42], [-1.15, -1.42]], 24);
      P.box(1.38, 0, .42, .62, P.shade(P.paint, .85), { r: .1 });
      P.cupola(-.5, .62, .36, 5); P.mg(-.3, .62, 0, 1.1, true); P.hatch(-.5, -.62, .34);
      P.box(.45, -.85, .4, .32, P.shade(P.paint, .9)); P.box(.66, -.85, .05, .24, SPR_GLASS, { tex: false });
      P.smoke(.5, 1.35, 4, Math.PI / 2 - .3); P.smoke(.5, -1.35, 4, -Math.PI / 2 + .3);
      P.box(-1.66, 0, .22, 1.7, P.shade(P.paint, .85), { r: .06 });
    } },
  zbd05: { L: 9.5, B: 3.4, run: 't', tw: .5, hull: rlBox(9.5, 3.4), tur: { x: .7 },
    gun: { x0: .95, len: 2.4, r: .045, br: 1 },
    H: P => rlTrk(P, { L: 9.5, B: 3.4, tw: .5, hull: rlBox(9.5, 3.4), gl: 3.9, seed: 15, glacis: false, drv: [3.25, -.95],
      grilles: [[2.25, .2, 3.65, 1.42, 7]], boxes: [[-1.8, 1.5, 3.8, .3], [-1.8, -1.5, 3.8, .3]],
      extra: P => {
        P.plate([[4.72, -1.55], [4.72, 1.55], [3.95, 1.6], [3.95, -1.6]], P.shade(P.paint, 1.08), { ao: .12, bev: .08 });
        for (let i = -3; i <= 3; i++) P.line(4.0, i * .42, 4.65, i * .42, .03);
        for (const s of [-1, 1]) { P.grille(-4.7, s * 1.25 - .32, -4.2, s * 1.25 + .32, 4); P.box(-2.6, s * .62, 1.5, .9, P.shade(P.paint, .93), { r: .08 }); P.box(-1.0, s * .62, 1.0, .9, P.shade(P.paint, .93), { r: .08 }); for (let i = 0; i < 3; i++) P.peri(-3.3 + i * 1.1, s * 1.18, .18, .08, s > 0 ? Math.PI / 2 : -Math.PI / 2); }
      } }),
    T: P => {
      rlTur(P, [[-1, -.9], [-1, .9], [-.6, 1.12], [.6, 1.12], [1, .7], [1, -.7], [.6, -1.12], [-.6, -1.12]], 25);
      P.box(-.1, 1.24, .95, .22, SPR_METAL, { r: .08 }); P.box(.35, 1.24, .2, .16, '#7a6e4a', { r: .05 });   // 红箭-73 发射导轨
      P.hatch(-.4, .45, .3); P.box(.35, -.65, .36, .28, P.shade(P.paint, .9)); P.box(.54, -.65, .05, .2, SPR_GLASS, { tex: false });
      P.smoke(.6, -1.05, 3, -Math.PI / 2 + .4);
    } },
  zsl92b: { L: 7, B: 2.86, run: 'w', tur: { x: .9 }, hull: rlWedge(7, 2.86, .55),
    gun: { x0: .55, len: 1.4, r: .035 },
    H: P => rlWhl(P, { L: 7, B: 2.86, hull: rlWedge(7, 2.86, .55), ax: [2.2, .5, -1.9], wl: 1.05, ww: .38, drv: [2.35, -.7], seed: 16,
      grilles: [[-3.25, -.95, -2.15, .95, 7]], boxes: [[-.9, -.6, 1.6, .8, .92], [-.9, .6, 1.6, .8, .92]], tools: [[1.3, 1.22, .9, 0]],
      extra: P => { P.box(3.05, 0, .25, 2.0, P.shade(P.paint, 1.08), { r: .05 }); } }),
    T: P => { P.part(P.poly(rlOct(.72)), P.paint, { ao: .3, bev: .12 }); P.hatch(-.15, 0, .3); P.box(.4, 0, .3, .3, SPR_METAL); } },
  plz07: { L: 7.3, B: 3.2, run: 't', tw: .52, hull: rlMbt(7.3, 3.2, .3), tur: { x: -.9 },
    gun: { x0: 1.95, len: 4.3, r: .09, fe: [2.0, .6, .13], br: 2 },
    H: P => rlTrk(P, { L: 7.3, B: 3.2, tw: .52, hull: rlMbt(7.3, 3.2, .3), gl: 2.6, seed: 17, drv: [2.6, -.75], grilles: [[1.6, .15, 3.1, 1.08, 7]],
      boxes: [[-1.2, 1.36, 3.2, .3], [-1.2, -1.36, 3.2, .3]], cables: [[[2.3, -1.0], [1.2, -1.05], [.2, -1.0]]], extra: P => P.box(3.45, 0, .25, .5, SPR_METAL) }),
    T: P => {
      rlTur(P, [[-2.3, -1.45], [-2.3, 1.45], [1.4, 1.45], [1.95, .9], [1.95, -.9], [1.4, -1.45]], 26);
      P.box(1.85, 0, .4, .7, P.shade(P.paint, .85), { r: .1 });
      P.cupola(.55, .85, .42, 5); P.mg(.75, .85, 0, 1.3, true); P.hatch(-.4, -.8, .38); P.hatch(-.6, .5, .3);
      P.box(-2.22, 0, .22, 2.3, P.shade(P.paint, .82), { r: .05 }); P.grille(-1.9, -1.3, -1.1, -.45, 4);
      P.smoke(1.2, 1.4, 4, Math.PI / 2 - .3); P.smoke(1.2, -1.4, 4, -Math.PI / 2 + .3);
      P.box(-1.4, 1.1, .9, .3, P.shade(P.paint, .9));
    } },
  ptl02: { L: 7.6, B: 3, run: 'w', tur: { x: -1.5 }, hull: rlWedge(7.6, 3, .55),
    gun: { x0: 1.3, len: 4.8, r: .085, fe: [1.8, .55, .12], br: 2 },
    H: P => rlWhl(P, { L: 7.6, B: 3, hull: rlWedge(7.6, 3, .55), ax: [2.6, .9, -.9], wl: 1.15, ww: .42, drv: [2.6, .75], seed: 18,
      grilles: [[1.6, -1.15, 3.2, -.05, 7]], boxes: [[.6, 1.25, 1.6, .3]], tools: [[.4, -1.25, .9, 0]] }),
    T: P => {
      rlTur(P, [[-1.4, -1.05], [-1.4, 1.05], [.9, 1.12], [1.35, .6], [1.35, -.6], [.9, -1.12]], 27);
      P.box(1.25, 0, .36, .55, P.shade(P.paint, .85), { r: .08 }); P.hatch(-.5, .55, .32); P.hatch(-.5, -.55, .32); P.mg(-.3, .55, 0, 1, false);
      P.smoke(.5, 1.05, 4, Math.PI / 2 - .3); P.smoke(.5, -1.05, 4, -Math.PI / 2 + .3); P.box(-1.32, 0, .2, 1.5, P.shade(P.paint, .85));
    } },
  pgz07: { L: 7.6, B: 3.2, run: 't', tw: .52, hull: rlMbt(7.6, 3.2, .3), tur: { x: -.6 }, radar: [-2.3, 0, .75],
    gun: { x0: .4, len: 3.3, r: .055, br: 1, oy: 1.68 }, gun2: { x0: .4, len: 3.3, r: .055, br: 1, oy: -1.68 },
    H: P => rlTrk(P, { L: 7.6, B: 3.2, tw: .52, hull: rlMbt(7.6, 3.2, .3), gl: 2.7, seed: 19, drv: [2.65, -.75], grilles: [[1.7, .15, 3.2, 1.08, 7]], boxes: [[-1.2, 1.36, 3.4, .3], [-1.2, -1.36, 3.4, .3]] }),
    T: P => {
      rlTur(P, [[-2, -1.48], [-2, 1.48], [1.4, 1.48], [1.85, 1], [1.85, -1], [1.4, -1.48]], 28);
      for (const s of [-1, 1]) P.box(.6, s * 1.62, 1.6, .38, P.shade(P.paint, .82), { r: .12 });   // 炮耳与供弹箱
      P.disc(1.6, 0, .4, '#5d6064'); P.disc(1.6, 0, .26, '#2f3236');   // 跟踪雷达
      P.hatch(-.5, .7, .34); P.hatch(-.5, -.7, .34); P.box(-1.9, 0, .26, 1.8, P.shade(P.paint, .82));
    } },
  pgl625: { L: 8, B: 2.8, run: 'w', tur: { x: -1.3 }, hull: rlBox(8, 2.8),
    gun: { x0: .75, len: 2.2, r: .13, gat: 4 },
    H: P => rlWhl(P, { L: 8, B: 2.8, hull: rlBox(8, 2.8), ax: [2.6, .4, -1.6], wl: 1.15, ww: .42, seed: 20, lights: true,
      extra: P => { rlCab(P, 3.05, 1.7, 2.6); P.box(1.4, 0, 1.4, 2.3, P.shade(P.paint, .88), { r: .1 }); P.grille(1.0, -.9, 1.8, .9, 6); } }),
    T: P => {
      P.part(P.poly(rlOct(1.2)), P.paint, { ao: .3, bev: .14 });
      for (const s of [-1, 1]) { P.box(-.2, s * 1.32, 1.5, .44, '#2c2d28', { r: .08 }); for (let i = 0; i < 2; i++) P.disc(.45, s * 1.32 + (i - .5) * .2, .08, '#4a4b44'); }   // 飞弩-10 发射箱
      P.disc(-.55, 0, .42, '#5d6064'); P.disc(-.55, 0, .25, '#33363a');
    } },
  ld2000: { L: 9.6, B: 2.9, run: 'w', tur: { x: -1.7 }, hull: rlBox(9.6, 2.9),
    gun: { x0: .55, len: 2.4, r: .16, gat: 7 },
    H: P => rlWhl(P, { L: 9.6, B: 2.9, hull: rlBox(9.6, 2.9), ax: [3.4, 2.1, -1.5, -2.8], wl: 1.1, ww: .42, seed: 21,
      extra: P => { rlCab(P, 3.8, 1.8, 2.7); P.box(1.3, 0, 1.8, 2.4, '#5d6064', { r: .08 }); P.grille(.6, -.9, 2.0, .9, 8); P.box(-.4, 1.0, 1.0, .5, P.shade(P.paint, .85)); } }),
    T: P => {
      P.part(P.poly(rlOct(1.15)), P.paint, { ao: .3, bev: .14 });
      P.disc(-.2, 0, .78, '#d4d6d1'); P.disc(-.2, 0, .5, '#c4c6c1');   // 雷达罩（白色圆顶）
      P.box(-.95, 0, .5, 1.25, '#5d6064', { r: .1 });
    } },
  zbl08: { L: 8, B: 3, run: 'w', tur: { x: .2 }, hull: rlWedge(8, 3, .6), mast: [-1.6, 0, .4],
    gun: { x0: .85, len: 2.2, r: .045, br: 1 },
    H: P => rlWhl(P, { L: 8, B: 3, hull: rlWedge(8, 3, .6), ax: [2.7, 1.4, -1, -2.3], wl: 1.05, ww: .4, drv: [2.85, -.8], seed: 22,
      grilles: [[1.7, .15, 3.2, 1.25, 7]], boxes: [[-2.6, -.6, 1.4, .8, .92], [-2.6, .6, 1.4, .8, .92]], tools: [[.3, 1.32, .9, 0]] }),
    T: P => { rlTur(P, rlOct(.85, 1.15), 29); P.hatch(-.3, .4, .28); P.box(.35, -.45, .32, .25, P.shade(P.paint, .9)); P.smoke(.3, -.85, 3, -Math.PI / 2); } },
  zbd04a: { L: 7.2, B: 3.2, run: 't', tw: .52, hull: rlMbt(7.2, 3.2, .3), tur: { x: .3 },
    gun: { x0: 1.45, len: 2.6, r: .09, fe: [1.0, .5, .12] }, gun2: { x0: 1.3, len: 2.2, r: .04, oy: .42, br: 1 },
    H: P => rlTrk(P, { L: 7.2, B: 3.2, tw: .52, hull: rlMbt(7.2, 3.2, .3), gl: 2.6, seed: 23, drv: [2.6, -.75], grilles: [[1.6, .15, 3.1, 1.08, 7]],
      extra: P => { for (const s of [-1, 1]) P.box(-2.6, s * .6, 1.4, .9, P.shade(P.paint, .93), { r: .08 }); P.box(-3.5, 0, .2, 2.1, P.shade(P.paint, .85)); } }),
    T: P => {
      rlTur(P, [[-1.3, -1.2], [-1.3, 1.2], [1, 1.25], [1.5, .8], [1.5, -.8], [1, -1.25]], 30);
      for (const s of [-1, 1]) { P.box(-.3, s * 1.45, 1.4, .44, '#2c2d28', { r: .08 }); for (let i = 0; i < 3; i++) P.disc(.38, s * 1.45 + (i - 1) * .13, .055, '#55564e'); }   // 温压火箭发射箱
      P.box(1.4, 0, .4, .55, P.shade(P.paint, .85)); P.hatch(-.5, .55, .32); P.hatch(-.5, -.55, .32);
    } },
  ztz96m: { L: 6.9, B: 3.4, run: 't', tw: .58, hull: rlMbt(6.9, 3.4, .4), tur: { x: -.15 }, plow: 1,
    gun: { x0: 1.85, len: 5.6, r: .115, fe: [2.3, .8, .16], sl: 3 },
    H: P => { RLM.ztz96b.H(P); rlPlow(P, 3.45, 3.3, 1); },
    T: P => RLM.ztz96b.T(P) },
  gcz110: { L: 7.6, B: 3.4, run: 't', tw: .58, hull: rlBox(7.6, 3.4), tur: { x: -1.2, y: .9 },
    gun: { x0: .3, len: 3.4, r: .11, arm: 1 },
    H: P => rlTrk(P, { L: 7.6, B: 3.4, tw: .58, hull: rlBox(7.6, 3.4), gl: 3.2, glacis: false, seed: 24, lights: true, grilles: [[-3.5, -1.1, -2.2, 1.1, 8]],
      extra: P => { rlPlow(P, 3.8, 3.9, 0); rlCab(P, .7, 1.9, 1.6); P.g.save(); P.g.translate(.7, -.5); P.g.restore(); } }),
    T: P => { P.part(P.poly(rlOct(.55)), SPR_METAL, { ao: .25, bev: .1 }); } },
  zbd03: { L: 6, B: 3, run: 't', tw: .45, hull: rlMbt(6, 3, .3), tur: { x: .3 },
    gun: { x0: .85, len: 2.3, r: .045, br: 1 },
    H: P => rlTrk(P, { L: 6, B: 3, tw: .45, hull: rlMbt(6, 3, .3), gl: 2.1, seed: 25, drv: [2.05, -.7], grilles: [[1.2, .2, 2.6, 1.05, 6]],
      extra: P => { P.box(-2.3, 0, 1.2, 1.7, P.shade(P.paint, .93), { r: .08 }); P.box(-2.9, 0, .2, 2, P.shade(P.paint, .85)); } }),
    T: P => { rlTur(P, [[-.9, -.85], [-.9, .85], [.5, .95], [.9, .55], [.9, -.55], [.5, -.95]], 31); P.box(-.2, 1.05, .9, .2, SPR_METAL, { r: .06 }); P.hatch(-.35, .3, .26); P.smoke(.4, -.9, 3, -Math.PI / 2 + .3); } },

  // ———————— 美军 ————————
  m1a1: { L: 7.9, B: 3.66, run: 't', tw: .64, hull: rlMbt(7.9, 3.66, .3), tur: { x: -.4 },
    gun: { x0: 2.3, len: 5.3, r: .11, fe: [1.8, .8, .155], sl: 4, mrs: 1 },
    H: P => rlAbramsHull(P, 41),
    T: P => rlAbramsTur(P, false) },
  m1a2: { L: 7.9, B: 3.66, run: 't', tw: .64, hull: rlMbt(7.9, 3.66, .3), tur: { x: -.4 },
    gun: { x0: 2.3, len: 5.3, r: .11, fe: [1.8, .8, .155], sl: 4, mrs: 1 },
    H: P => rlAbramsHull(P, 42),
    T: P => rlAbramsTur(P, true) },
  m1150: { L: 7.9, B: 3.66, run: 't', tw: .64, hull: rlMbt(7.9, 3.66, .3), tur: { x: -.6 }, plow: 1,
    gun: null,
    H: P => { rlAbramsHull(P, 43); rlPlow(P, 3.95, 3.9, 1); },
    T: P => {
      rlTur(P, [[-2.6, -1.7], [-2.6, 1.7], [.9, 1.8], [1.9, 1], [1.9, -1], [.9, -1.8]], 44);
      for (const s of [-1, 1]) { P.box(-1.0, s * .88, 2.9, .9, '#3a3b35', { r: .12 }); P.line(-2.3, s * .88, .3, s * .88, .03); }   // 扫雷爆破索（MICLIC）发射箱
      P.box(.9, .9, .6, .5, '#2b2c28', { r: .06 }); P.mg(1.0, .9, 0, 1.2, true); P.hatch(.9, -.95, .36);
      P.box(1.55, 0, .5, .9, P.shade(P.paint, .85));   // 挖掘臂基座
    } },
  m10: { L: 7.4, B: 3.4, run: 't', tw: .58, hull: rlMbt(7.4, 3.4, .35), tur: { x: -.6 },
    gun: { x0: 1.85, len: 4.8, r: .1, fe: [1.9, .7, .145], sl: 2 },
    H: P => rlTrk(P, { L: 7.4, B: 3.4, tw: .58, hull: rlMbt(7.4, 3.4, .35), gl: 2.5, seed: 45, drv: [2.35, 0],
      grilles: [[-3.45, -1.05, -2.15, -.06, 7], [-3.45, .06, -2.15, 1.05, 7]], boxes: [[-.6, 1.48, 3.6, .34], [-.6, -1.48, 3.6, .34]], cables: [[[-3.3, -1.15], [-1.8, -1.2], [-.5, -1.1]]], tools: [[1.3, -1.48, 1, 0]] }),
    T: P => {
      rlTur(P, [[-2.45, -1.5], [-2.45, 1.5], [1.2, 1.56], [1.85, 1], [1.85, -1], [1.2, -1.56]], 46);
      P.mesh(-2.4, -1.35, -1.75, 1.35, 4); P.box(1.75, 0, .45, .72, P.shade(P.paint, .85), { r: .1 });
      P.disc(-.2, .9, .22, SPR_METAL); P.box(-.18, .9, .34, .28, P.shade(P.paint, .82), { r: .06 }); P.box(0, .9, .05, .2, SPR_GLASS, { tex: false });
      P.box(-.75, -.85, .6, .5, '#2b2c28', { r: .06 }); P.mg(-.6, -.85, 0, 1.3, true); P.hatch(-.85, .35, .34);
      P.smoke(.9, 1.42, 6, Math.PI / 2 - .4); P.smoke(.9, -1.42, 6, -Math.PI / 2 + .4);
    } },
  aav7: { L: 8.2, B: 3.3, run: 't', tw: .5, hull: [[4.1, -1.25], [4.1, 1.25], [3.45, 1.65], [-4.1, 1.65], [-4.1, -1.65], [3.45, -1.65]], tur: { x: 1.6, y: .85 },
    gun: { x0: .45, len: 1.3, r: .04, oy: .14 }, gun2: { x0: .45, len: 1.1, r: .055, oy: -.14 },
    H: P => rlTrk(P, { L: 8.2, B: 3.3, tw: .5, hull: [[4.1, -1.25], [4.1, 1.25], [3.45, 1.65], [-4.1, 1.65], [-4.1, -1.65], [3.45, -1.65]], gl: 3.4, glacis: false, seed: 47, drv: [2.9, -.95],
      deck: [[3.4, -1.15], [3.4, 1.15], [-4.0, 1.15], [-4.0, -1.15]],
      extra: P => {
        P.plate([[4.08, -1.2], [4.08, 1.2], [3.4, 1.4], [3.4, -1.4]], P.shade(P.paint, 1.08), { ao: .1, bev: .08 });   // 艏板
        for (let i = 0; i < 3; i++) { P.box(-2.6 + i * 1.25, 0, 1.15, 1.9, P.shade(P.paint, .94), { r: .06 }); P.line(-2.6 + i * 1.25, -.95, -2.6 + i * 1.25, .95, .03); }   // 载员舱顶大舱盖
        P.box(-3.95, 0, .28, 2.5, P.shade(P.paint, .86), { r: .05 });   // 尾门
        P.hatch(2.0, -.9, .3); P.grille(1.6, .2, 2.9, 1.2, 6);
      } }),
    T: P => { P.part(P.poly(rlOct(.62)), P.paint, { ao: .3, bev: .12 }); P.hatch(-.15, 0, .28); for (let i = 0; i < 4; i++) P.peri(.1 + Math.cos(i * 1.57 + .78) * .5, Math.sin(i * 1.57 + .78) * .5, .14, .07, i * 1.57 + .78 + Math.PI / 2); } },
  m2a3: { L: 6.55, B: 3.6, run: 't', tw: .55, hull: rlMbt(6.55, 3.6, .3), tur: { x: .1, y: .35 },
    gun: { x0: 1.25, len: 2.1, r: .042, br: 1 },
    H: P => rlTrk(P, { L: 6.55, B: 3.6, tw: .55, hull: rlMbt(6.55, 3.6, .3), gl: 2.2, seed: 48, drv: [2.35, -.95], grilles: [[1.5, .3, 2.95, 1.45, 7]],
      boxes: [[-.8, 1.62, 3.4, .3], [-.8, -1.62, 3.4, .3]], cables: [[[-2.9, -1.2], [-1.6, -1.25], [-.4, -1.2]]],
      extra: P => { P.box(-3.18, 0, .3, 2.3, P.shade(P.paint, .86), { r: .05 }); P.box(-2.1, 0, 1.2, 1.5, P.shade(P.paint, .93), { r: .08 }); for (let i = 0; i < 4; i++) P.peri(-2.9 + i * .7, -1.2, .18, .08, -Math.PI / 2); } }),
    T: P => {
      rlTur(P, [[-1.3, -1.1], [-1.3, 1.1], [.9, 1.15], [1.3, .7], [1.3, -.7], [.9, -1.15]], 49);
      P.box(-.3, -1.38, 1.65, .52, '#3b3c36', { r: .1 }); P.box(.5, -1.38, .1, .4, '#22231f'); P.line(-1.0, -1.38, .4, -1.38, .03);   // 陶式双联发射箱（折叠在炮塔左侧）
      P.box(1.2, 0, .3, .5, P.shade(P.paint, .85));
      P.disc(-.55, .7, .22, SPR_METAL); P.box(-.5, .7, .4, .3, P.shade(P.paint, .82), { r: .06 }); P.box(-.28, .7, .05, .22, SPR_GLASS, { tex: false });   // 车长独立观瞄（CIV）
      P.hatch(-.65, -.3, .3); P.smoke(.85, 1.0, 4, Math.PI / 2 - .5);
    } },
  m109: { L: 6.8, B: 3.2, run: 't', tw: .55, hull: rlMbt(6.8, 3.2, .3), tur: { x: -.9 },
    gun: { x0: 2.3, len: 5, r: .1, fe: [2.6, .7, .15], br: 2 },
    H: P => rlTrk(P, { L: 6.8, B: 3.2, tw: .55, hull: rlMbt(6.8, 3.2, .3), gl: 2.4, seed: 50, drv: [2.6, .75], grilles: [[1.6, -1.05, 3.1, -.1, 7]], extra: P => P.box(3.25, 0, .28, .55, SPR_METAL) }),
    T: P => {
      rlTur(P, [[-2.5, -1.55], [-2.5, 1.55], [1.8, 1.55], [2.35, 1.1], [2.35, -1.1], [1.8, -1.55]], 51);
      P.box(2.25, 0, .4, .75, P.shade(P.paint, .85), { r: .1 });
      P.cupola(.8, .9, .45, 6); P.mg(1.0, .9, 0, 1.3, true); P.hatch(-.3, -.85, .4);
      P.box(-2.4, 0, .3, 2.4, P.shade(P.paint, .85)); P.grille(-1.9, -1.35, -.9, -.45, 4); P.box(-1.2, .95, 1.4, .35, P.shade(P.paint, .9));
      P.smoke(1.6, 1.42, 4, Math.PI / 2 - .3); P.smoke(1.6, -1.42, 4, -Math.PI / 2 + .3);
    } },
  m1134: { L: 6.95, B: 2.72, run: 'w', tur: { x: -.5 }, hull: rlWedge(6.95, 2.72, .55),
    gun: { x0: .35, len: 1.3, r: .1, oy: .34, tube: 1 }, gun2: { x0: .35, len: 1.3, r: .1, oy: -.34, tube: 1 },
    H: P => rlStryker(P, 52),
    T: P => { rlTur(P, [[-.8, -.65], [-.8, .65], [.75, .65], [.9, .45], [.9, -.45], [.75, -.65]], 53); P.disc(-.3, 0, .25, SPR_METAL); } },
  m1127: { L: 6.95, B: 2.72, run: 'w', tur: { x: .3 }, hull: rlWedge(6.95, 2.72, .55), mast: [-1.6, .6, .34],
    gun: { x0: .35, len: 1.25, r: .03 },
    H: P => rlStryker(P, 54),
    T: P => { P.part(P.poly(rlOct(.5)), '#2d2e29', { ao: .25, bev: .08 }); P.box(-.15, .2, .3, .26, '#3b3c36'); P.box(.05, -.2, .25, .2, SPR_GLASS, { tex: false }); } },
  mshorad: { L: 6.95, B: 2.72, run: 'w', tur: { x: -.5 }, hull: rlWedge(6.95, 2.72, .55),
    gun: { x0: 1.15, len: 2.2, r: .04, br: 1 },
    H: P => rlStryker(P, 55),
    T: P => {
      rlTur(P, [[-1, -.95], [-1, .95], [.9, .95], [1.2, .6], [1.2, -.6], [.9, -.95]], 56);
      P.box(-.1, 1.18, 1.2, .46, '#33342e', { r: .08 }); for (let i = 0; i < 4; i++) P.disc(.45, 1.08 + (i % 2) * .2, .07, '#55564e');   // 毒刺发射吊舱
      P.box(-.1, -1.15, 1.3, .28, '#33342e', { r: .06 }); P.box(.55, -1.15, .3, .16, '#55564e');   // 地狱火导轨
      P.disc(-.55, 0, .3, '#5d6064');   // 多任务半球雷达
    } },
  m163: { L: 4.9, B: 2.7, run: 't', tw: .42, hull: [[2.45, -1.1], [2.45, 1.1], [2.1, 1.35], [-2.45, 1.35], [-2.45, -1.35], [2.1, -1.35]], tur: { x: -.5 },
    gun: { x0: .75, len: 1.9, r: .12, gat: 6 },
    H: P => rlTrk(P, { L: 4.9, B: 2.7, tw: .42, hull: [[2.45, -1.1], [2.45, 1.1], [2.1, 1.35], [-2.45, 1.35], [-2.45, -1.35], [2.1, -1.35]], gl: 1.9, seed: 57, drv: [1.6, -.65], grilles: [[1.0, .2, 2.0, 1.05, 5]],
      extra: P => { P.box(2.36, 0, .2, 2.1, P.shade(P.paint, 1.08)); P.box(-2.38, 0, .2, 1.9, P.shade(P.paint, .86)); } }),
    T: P => { P.part(P.poly(rlOct(1.0)), P.shade(P.paint, .95), { ao: .3, bev: .12 }); P.part(P.circ(-.1, 0, .62), '#2b2c28', { ao: 0, bev: .1, bevA: .7 }); P.disc(.15, .82, .3, '#5d6064'); P.box(-.4, -.45, .5, .4, P.shade(P.paint, .85)); } },
  lpws: { L: 7, B: 2.6, run: 'w', tur: { x: -.8 }, hull: rlBox(7, 2.6),
    gun: { x0: .5, len: 2.2, r: .13, gat: 6 },
    H: P => rlWhl(P, { L: 7, B: 2.6, hull: rlBox(7, 2.6), ax: [1.8, -1.8, -2.8], wl: 1, ww: .38, seed: 58,
      extra: P => { rlCab(P, 2.6, 1.8, 2.4); P.box(.8, 0, 1.2, 2.2, '#5d6064', { r: .08 }); P.grille(.4, -.8, 1.3, .8, 6); } }),
    T: P => { P.part(P.poly(rlOct(1.05)), P.paint, { ao: .3, bev: .14 }); P.disc(-.25, 0, .74, '#d4d6d1'); P.disc(-.25, 0, .48, '#c4c6c1'); P.box(-.95, 0, .45, 1.1, '#5d6064', { r: .1 }); } },
  jltv: { L: 6.2, B: 2.5, run: 'w', tur: { x: .1 }, hull: rlWedge(6.2, 2.5, .45),
    gun: { x0: .3, len: 1.3, r: .1, oy: .25, tube: 1 }, gun2: { x0: .3, len: 1.3, r: .1, oy: -.25, tube: 1 },
    H: P => rlWhl(P, { L: 6.2, B: 2.5, hull: rlWedge(6.2, 2.5, .45), ax: [1.9, -1.6], wl: .95, ww: .4, seed: 59,
      extra: P => { P.box(2.4, 0, 1.2, 2.1, P.shade(P.paint, 1.04), { r: .2 }); P.grille(2.8, -.7, 3.05, .7, 5, false); P.box(1.55, 0, .3, 2.0, SPR_GLASS, { tex: false, hl: .3 }); P.box(.3, 0, 2.1, 2.2, P.shade(P.paint, .98), { r: .15 }); P.box(-2.0, 0, 2.0, 2.1, P.shade(P.paint, .9), { r: .08 }); } }),
    T: P => { P.part(P.poly(rlOct(.55)), '#33342e', { ao: .25, bev: .1 }); } },
  avenger: { L: 4.95, B: 2.2, run: 'w', tur: { x: -.9 }, hull: rlWedge(4.95, 2.2, .4),
    gun: { x0: .5, len: 1.2, r: .03 },
    H: P => rlWhl(P, { L: 4.95, B: 2.2, hull: rlWedge(4.95, 2.2, .4), ax: [1.6, -1.6], wl: .9, ww: .36, seed: 60,
      extra: P => { P.box(1.8, 0, 1.2, 1.85, P.shade(P.paint, 1.05), { r: .2 }); P.grille(2.2, -.55, 2.42, .55, 4, false); P.box(1.1, 0, .25, 1.8, SPR_GLASS, { tex: false, hl: .3 }); } }),
    T: P => { P.part(P.poly(rlOct(.75)), P.paint, { ao: .3, bev: .1 }); for (const s of [-1, 1]) { P.box(-.1, s * 1.0, 1.35, .46, '#33342e', { r: .08 }); for (let i = 0; i < 4; i++) P.disc(.5, s * 1.0 + (i % 2 - .5) * .2, .07, '#55564e'); } P.box(.2, 0, .55, .45, SPR_GLASS, { tex: false }); } },
  m1117: { L: 6, B: 2.6, run: 'w', tur: { x: -.2 }, hull: rlWedge(6, 2.6, .5),
    gun: { x0: .6, len: 1.3, r: .035, oy: .15 }, gun2: { x0: .6, len: 1.1, r: .05, oy: -.18 },
    H: P => rlWhl(P, { L: 6, B: 2.6, hull: rlWedge(6, 2.6, .5), ax: [1.8, -1.6], wl: 1, ww: .4, seed: 61, drv: [1.8, -.6], grilles: [[2.0, .1, 2.7, 1.0, 5]], extra: P => P.box(-2.0, 0, 1.4, 1.8, P.shade(P.paint, .92), { r: .08 }) }),
    T: P => { rlTur(P, rlOct(.75), 62); P.hatch(-.25, .2, .26); } }
};
// 扫雷犁 / 推土铲（车首）
function rlPlow(P, x, w, teeth) {
  P.box(x + .32, 0, .45, w, SPR_STEEL, { r: .06 });
  if (teeth) for (let i = 0; i < 9; i++) P.box(x + .62, -w / 2 + (i + .5) * w / 9, .25, w / 9 * .55, SPR_METAL, { r: .03, ao: .05 });
  for (const s of [-1, 1]) P.box(x - .1, s * w * .3, .7, .18, SPR_METAL, { r: .04 });
}
// 斯特赖克 8×8：楔形车首、右前发动机格栅、左前驾驶员、车长舱、尾门、侧面储物
function rlStryker(P, seed) {
  rlWhl(P, { L: 6.95, B: 2.72, hull: rlWedge(6.95, 2.72, .55), ax: [2.3, 1.05, -1.1, -2.35], wl: 1.05, ww: .38, drv: [2.55, -.72], seed,
    grilles: [[1.6, .15, 2.85, 1.08, 6]], boxes: [[-.4, 1.2, 2.4, .26], [-.4, -1.2, 2.4, .26]], tools: [[.9, -1.2, .9, 0]],
    extra: P => { P.hatch(1.65, -.72, .3); P.box(-3.33, 0, .25, 2.0, P.shade(P.paint, .86), { r: .05 }); P.box(-2.3, 0, 1.4, 1.5, P.shade(P.paint, .93), { r: .08 }); P.disc(-1.4, -1.0, .06, SPR_METAL); P.disc(-1.4, 1.0, .06, SPR_METAL); } });
}
// 艾布拉姆斯车体：长前上装甲、中置驾驶员、车灯组、后部大格栅门、尾部排气栅、拖缆、侧裙板
function rlAbramsHull(P, seed) {
  rlTrk(P, { L: 7.9, B: 3.66, tw: .64, hull: rlMbt(7.9, 3.66, .3), gl: 2.45, seed, drv: [2.75, 0],
    grilles: [[-3.6, -1.15, -2.15, -.08, 9], [-3.6, .08, -2.15, 1.15, 9], [-3.92, -1.05, -3.7, 1.05, 7, false]],
    boxes: [[-.3, 1.66, 4.2, .3, .9], [-.3, -1.66, 4.2, .3, .9]], cables: [[[-3.4, -1.25], [-2.0, -1.3], [-.4, -1.22], [.9, -1.05]], [[-3.4, 1.25], [-2.0, 1.3], [-.6, 1.24]]], tools: [[1.6, 1.66, 1.1, 0], [1.6, -1.66, 1.0, 0, 'bar']] });
}
// 艾布拉姆斯炮塔：宽扁楔形、尾舱网篮、弹药殉爆泄压板、车长（M1A1 指挥塔 + M2 / M1A2 遥控武器站 + 独立热像仪）、装填手 M240、炮长主瞄准镜
function rlAbramsTur(P, v2) {
  rlTur(P, [[-2.9, -1.75], [-2.9, 1.75], [-1.6, 1.9], [.9, 1.9], [2.3, 1.05], [2.3, -1.05], [.9, -1.9], [-1.6, -1.9]], v2 ? 63 : 64);
  for (const s of [-1, 1]) P.line(.9, s * 1.85, 2.25, s * 1.05, .035);
  P.mesh(-2.86, -1.62, -1.95, 1.62, 6);
  for (const s of [-1, 1]) P.box(-1.4, s * .62, .95, 1.0, P.shade(P.paint, .95), { r: .04, ao: .04 });   // 泄压板
  P.box(2.2, 0, .5, .95, P.shade(P.paint, .85), { r: .1 });
  P.box(.62, .98, .55, .45, P.shade(P.paint, .9), { r: .05 }); P.box(.88, .98, .05, .34, SPR_GLASS, { tex: false });   // 炮长主瞄准镜（GPS）
  if (v2) { P.box(-.7, 1.0, .75, .62, '#2c2d28', { r: .08 }); P.mg(-.5, 1.0, 0, 1.4, true); P.disc(-.05, -.55, .2, SPR_METAL); P.box(0, -.55, .4, .32, P.shade(P.paint, .82), { r: .08 }); P.box(.2, -.55, .05, .24, SPR_GLASS, { tex: false }); }
  else { P.cupola(-.6, .95, .48, 6); P.mg(-.4, .95, 0, 1.4, true); }
  P.hatch(-.75, -.95, .42); P.mg(-.55, -1.05, -.25, 1.1, false);
  P.smoke(1.05, 1.7, 6, Math.PI / 2 - .55); P.smoke(1.05, -1.7, 6, -Math.PI / 2 + .55);
  P.disc(-2.05, .45, .07, SPR_METAL); P.disc(-1.85, -1.55, .06, SPR_METAL); P.disc(-1.85, 1.55, .06, SPR_METAL);
}

// 炮管贴图：圆柱明暗（两边暗、中线亮）、热护套箍、抽烟装置鼓包、炮口制退器、炮口校正镜；转管炮画多根细管
function rlGunSpr(gun, side) {
  const key = `gun:${gun.len}:${gun.r}:${gun.fe ? gun.fe.join(',') : ''}:${gun.br || 0}:${gun.sl || 0}:${gun.gat || 0}:${gun.tube || 0}:${gun.arm || 0}`;
  return sprGet(key, side, gun.len + .6, Math.max(gun.r * 6, .6), P => {
    const g = P.g, L = gun.len, r = gun.r, x0 = -L / 2;
    const cyl = (x, len, rad, col = '#34352f') => {
      const gr = g.createLinearGradient(0, -rad, 0, rad);
      gr.addColorStop(0, rlShade(col, .55)); gr.addColorStop(.35, rlShade(col, 1.35)); gr.addColorStop(.6, col); gr.addColorStop(1, rlShade(col, .5));
      P.part(P.rr(x, -rad, len, rad * 2, rad * .6), col, { ao: .08, bev: 0, tex: .12, grad: false });
      g.fillStyle = gr; P.rr(x, -rad, len, rad * 2, rad * .6)(); g.fill();
      g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = .02; P.rr(x, -rad, len, rad * 2, rad * .6)(); g.stroke();
    };
    if (gun.tube) { cyl(x0, L, r, '#3d4036'); g.fillStyle = '#1a1b18'; g.beginPath(); g.arc(x0 + L, 0, r * .7, 0, 7); g.fill(); return; }   // 导弹发射管
    if (gun.arm) { cyl(x0, L, r, '#4d4f4a'); P.box(x0 + L - .25, 0, .5, .7, SPR_METAL); return; }   // 吊臂
    if (gun.gat) { for (let i = 0; i < Math.min(4, gun.gat); i++) cyl(x0, L, r * .35, '#2e2f2b'); cyl(x0, L * .25, r * 1.1, '#3a3b36'); return; }
    cyl(x0, L, r, P.side === 'p' ? '#3c4231' : '#5e5743');
    if (gun.sl) for (let i = 1; i <= gun.sl; i++) { const x = x0 + L * (.15 + .8 * i / (gun.sl + 1)); g.strokeStyle = 'rgba(0,0,0,.45)'; g.lineWidth = .035; g.beginPath(); g.moveTo(x, -r); g.lineTo(x, r); g.stroke(); }
    if (gun.fe) cyl(x0 + gun.fe[0], gun.fe[1], gun.fe[2], P.side === 'p' ? '#40472f' : '#655d48');
    if (gun.br) { cyl(x0 + L - .42, .42, r * 1.55, '#2e2f2b'); if (gun.br > 1) { g.fillStyle = '#121310'; g.fillRect(x0 + L - .34, -r * 1.56, .07, r * 3.1); g.fillRect(x0 + L - .17, -r * 1.56, .07, r * 3.1); } }
    if (gun.mrs) P.box(x0 + L - .1, -r * .2, .16, .12, SPR_METAL, { ao: .03, bev: .01 });
  });
}

// 型号 → 模型：按型号名（沙盒目录名、空投车辆的 mdl）匹配，否则按阵营 + 车型
const RLM_NAME = [[/99A/, 'ztz99a'], [/96 式扫雷/, 'ztz96m'], [/GCZ/, 'gcz110'], [/96B/, 'ztz96b'], [/ZTQ-15/, 'ztq15'], [/ZTD-05/, 'ztd05'], [/ZBD-05/, 'zbd05'], [/ZSL-92/, 'zsl92b'], [/PLZ-07/, 'plz07'], [/PTL-02/, 'ptl02'],
  [/PGZ-07/, 'pgz07'], [/PGL-625/, 'pgl625'], [/LD-2000/, 'ld2000'], [/08 式/, 'zbl08'], [/ZBD-04A/, 'zbd04a'], [/ZBD-03/, 'zbd03'],
  [/M1A2/, 'm1a2'], [/M1A1/, 'm1a1'], [/M10 /, 'm10'], [/AAV/, 'aav7'], [/M2A3|布雷德利/, 'm2a3'], [/M109/, 'm109'], [/M1134/, 'm1134'], [/M1127/, 'm1127'], [/M-SHORAD/, 'mshorad'],
  [/M163/, 'm163'], [/M1150/, 'm1150'], [/LPWS|密集阵/, 'lpws'], [/JLTV/, 'jltv'], [/复仇者/, 'avenger'], [/M1117/, 'm1117']];
const RLM_TYPE = { p: { lt_tank: 'ztq15', tank: 'ztz96b', hv_tank: 'ztz99a', amtank: 'ztd05', apc: 'zbd05', spg: 'plz07', td: 'ptl02', aa_veh: 'pgz07', sam_veh: 'pgl625', recon: 'zbl08', flame_tank: 'zbd04a', mine_tank: 'ztz96m', abv: 'zbd03' },
  e: { lt_tank: 'm10', tank: 'm1a1', hv_tank: 'm1a2', amtank: 'aav7', apc: 'm2a3', spg: 'm109', td: 'm1134', aa_veh: 'm163', sam_veh: 'mshorad', recon: 'm1127', flame_tank: 'm1150', mine_tank: 'm1150', abv: 'm2a3' } };
const RLM_KEY = new WeakMap();
function rlModelOf(v) {
  let k = RLM_KEY.get(v);
  if (k !== undefined) return k && RLM[k] && Object.assign(RLM[k], { key: k });
  const nm = typeof vehModel === 'function' ? vehModel(v) : '';
  k = (RLM_NAME.find(([re]) => re.test(nm)) || [])[1] || (v.tag === 'dozer' ? 'gcz110' : null) || (RLM_TYPE[v.side === 'e' ? 'e' : 'p'] || {})[v.type] || null;
  if (v.mod && v.mod.cram && !/LPWS|LD-2000|密集阵/.test(nm)) k = v.side === 'e' ? 'lpws' : 'ld2000';
  RLM_KEY.set(v, k);
  return k && RLM[k] && Object.assign(RLM[k], { key: k });
}

// 运行时：投影 → 履带（履带板随里程滚动）→ 车体贴图 → 阵营细边 → 炮塔投影与贴图 → 炮管（后坐）→ 炮口焰 → 雷达 / 桅杆
function rlVehModel(ctx, v, M, h, aim, det, lw, a, col, time) {
  const sp = vehSp(v), sm = sp.len / M.L, side = v.side === 'e' ? 'e' : 'p', L = M.L, B = M.B;
  const HS = sprGet('hull:' + M.key, side, L + 1, B + .6, M.H), TS = M.T ? sprGet('tur:' + M.key, side, 6.5, 4.2, M.T) : null;
  ctx.save(); ctx.scale(sm, sm);
  sprShadow(ctx, HS, 0, 0, 1, 0, h, 1.0 / sm);
  if (M.run === 't') {   // 履带：车体两头露出，履带板滚动
    const tw = M.tw, x0 = -L / 2 - .14, len = L + .32, g = .3, off = (((v.odo || 0) / sm) % g + g) % g;
    for (const s of [-1, 1]) {
      const y0 = s < 0 ? -B / 2 : B / 2 - tw;
      ctx.fillStyle = '#2a2a26'; ctx.fillRect(x0, y0, len, tw);
      ctx.strokeStyle = 'rgba(105,102,92,.55)'; ctx.lineWidth = .07; ctx.beginPath();
      for (let x = x0 + off; x < x0 + len; x += g) { ctx.moveTo(x, y0 + .04); ctx.lineTo(x, y0 + tw - .04); }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = .04; ctx.strokeRect(x0, y0, len, tw);
    }
  }
  sprDraw(ctx, HS, 0, 0, 1);
  ctx.beginPath(); M.hull.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath();
  ctx.lineWidth = lw(det ? .9 : 1.4) / sm; ctx.strokeStyle = rgba(col, (det ? .7 : .95) * a); ctx.stroke();   // 阵营细边
  if (M.mast) { const [mx, my, mr] = M.mast, r = time * 2; ctx.fillStyle = '#5d6064'; ctx.beginPath(); ctx.arc(mx, my, mr * .5, 0, 7); ctx.fill(); ctx.strokeStyle = '#2a2b27'; ctx.lineWidth = .12; ctx.beginPath(); ctx.moveTo(mx - Math.cos(r) * mr, my - Math.sin(r) * mr); ctx.lineTo(mx + Math.cos(r) * mr, my + Math.sin(r) * mr); ctx.stroke(); }
  if (TS) {
    const rot = vehAng(aim - h), tx = M.tur.x, ty = M.tur.y || 0, since = S.t - (v.fireT ?? -99), rec = since < .25 ? (1 - since / .25) * .6 : 0;
    ctx.save(); ctx.translate(tx, ty); ctx.rotate(rot);
    const guns = [M.gun, M.gun2].filter(Boolean);
    const drawGun = gn => {
      const GS = rlGunSpr(gn, side), cx = gn.x0 + gn.len / 2 - (gn.gat || gn.tube || gn.arm ? 0 : rec);
      sprShadow(ctx, GS, cx, gn.oy || 0, 1, 0, h + rot, .5, .35); sprDraw(ctx, GS, cx, gn.oy || 0, 1);
      if (since < .12 && sp.gun && !sp.gun.flame && !gn.tube) {
        const u = since / .12, x1 = gn.x0 + gn.len - rec, w = Math.max(gn.r, .08);
        ctx.fillStyle = rgba(COL.amber, (1 - u) * .9); ctx.beginPath(); ctx.moveTo(x1, (gn.oy || 0) - w * 2.5); ctx.lineTo(x1 + 1.8 * (1 - u * .4), gn.oy || 0); ctx.lineTo(x1, (gn.oy || 0) + w * 2.5); ctx.closePath(); ctx.fill();
        ctx.fillStyle = rgba('#fff3d6', 1 - u); ctx.beginPath(); ctx.arc(x1 + .25, gn.oy || 0, w * 3, 0, 7); ctx.fill();
      }
    };
    const outside = guns.some(gn => Math.abs(gn.oy || 0) > .9);   // 炮装在炮塔两侧（自行高炮）：先画炮再画炮塔
    if (outside) guns.forEach(drawGun);
    sprShadow(ctx, TS, 0, 0, 1, 0, h + rot, .45 / sm, .45);
    sprDraw(ctx, TS, 0, 0, 1);
    if (!outside) guns.forEach(drawGun);
    if (M.radar) {   // 炮塔后部旋转的搜索雷达
      const [rx, ry, rr] = M.radar, ra = time * 3;
      ctx.fillStyle = '#4d5054'; ctx.beginPath(); ctx.arc(rx, ry, .22, 0, 7); ctx.fill();
      ctx.save(); ctx.translate(rx, ry); ctx.rotate(ra); ctx.fillStyle = '#c9ccc6'; ctx.fillRect(-rr, -.09, rr * 2, .18); ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = .03; ctx.strokeRect(-rr, -.09, rr * 2, .18); ctx.restore();
    }
    if (S.t - (v.mgT ?? -99) < .1) { ctx.fillStyle = rgba(COL.amber, .9); ctx.beginPath(); ctx.arc(1.2, .4, .22, 0, 7); ctx.fill(); }
    ctx.restore();
  }
  ctx.restore();
}
