'use strict';
// 选中编队的成员高亮（战区面板的卡片、地图上的番号牌 thpanel.js；指挥部的团标 hq.js）：
//   所属的每个兵、每辆车脚下一圈琥珀色的光；刚点开时全身闪一下光（2D 叠一层亮光；3D 模型整体发光，v3units.js uHl），脚下荡开一圈光环；
//   每个兵头顶一条血量（单兵伤势 combat.js manHp），每辆车头顶一条结构值（车体 hp / maxhp，近看写出数值）；
//   远看画不出单兵时每个小组一圈光、一条兵力（人数 × 伤势）；看不见的敌方成员不标
const SFX = { S: null, key: '', t0: -1e9, at: -1, tm: new Set(), vh: new Set(), spr: null, ring: null };
const SFX_FLASH = 1.5;   // 闪光时长（秒，真实时间）

// 选中了哪些编队 → 成员（小组、车辆）；每 0.25 秒（真实时间）重收一次，选中的编队变了就闪一下
function sfxScan() {
  const now = performance.now();
  if (SFX.S === S && now - SFX.at < 250) return;
  SFX.S = S; SFX.at = now;
  SFX.tm.clear(); SFX.vh.clear();
  if (!S || S.phase !== 'battle') { SFX.key = ''; return; }
  const Gs = new Set();
  if (typeof THU === 'object' && THU.sel.size && typeof thF === 'function') for (const id of THU.sel) { const F = thF(id); if (F) for (const R0 of thRegsOf(F)) { const G = thG(R0); if (G) Gs.add(G); } }
  if (typeof HQ === 'object' && HQ.selB && typeof hqSelB === 'function') { const B = hqSelB(); if (B) for (const G of hqRegs(B.side, B)) Gs.add(G); }
  for (const G of Gs) {
    for (const u of bgUnits(G)) for (const q of teamsOf(u)) if (q.men.length) SFX.tm.add(q);
    for (const v of bgVehs(G)) SFX.vh.add(v);
  }
  const key = [...Gs].map(G => G.id).sort((a, b) => a - b).join(',');
  if (key !== SFX.key) { SFX.key = key; if (key) SFX.t0 = now; }
}
// 再点一次（同一个番号牌、同一张卡片）也闪
function sfxPing() { SFX.at = -1; SFX.t0 = performance.now(); }
const sfxOn = () => !!S && S.phase === 'battle' && (SFX.tm.size > 0 || SFX.vh.size > 0);
const sfxHas = o => SFX.tm.has(o) || SFX.vh.has(o);
const sfxSeen = o => !S.ctl || o.side === S.ctl || specAll() || inVision(o.x, o.y);
// 闪光：刚点开 1 → 衰减到 0，中间脉动两下；u：光环荡开的进度（0 → 1，闪完为 null）
function sfxFlash() { const t = (performance.now() - SFX.t0) / 1000; return t < 0 || t > SFX_FLASH ? 0 : (1 - t / SFX_FLASH) * (.62 + .38 * Math.cos(t * 8.5)); }
function sfxU() { const t = (performance.now() - SFX.t0) / 1000; return t >= 0 && t < SFX_FLASH * .8 ? t / (SFX_FLASH * .8) : null; }
// 3D 模型的发光强度（v3units.js 着色器 uHl）：常亮一层，刚点开时再亮一阵
const sfxHl = () => sfxOn() ? .3 + sfxFlash() * 1.15 : 0;

// 小组里每个人的位置与血量（与 render2.js drawTeamBody、v3units.js 的站位一致：MO 三角站位按朝向转，落在房子轮廓里的挪到墙根）；ks：3D 远处的放大
function sfxMen(q, ks = 1) {
  const f = typeof faceDraw === 'function' ? faceDraw(q) : faceOf(q), c = Math.cos(f + 1.57), s = Math.sin(f + 1.57), h = manHp(q), out = [];
  for (let i = 0; i < Math.min(3, q.men.length); i++) {
    let x = q.x + (MO[i][0] * c - MO[i][1] * s) * ks, y = q.y + (MO[i][0] * s + MO[i][1] * c) * ks;
    const bo = typeof bldOut === 'function' && bldOut(x, y, .5);
    if (bo) [x, y] = bo;
    out.push([x, y, h[i]]);
  }
  return out;
}
// 小组的兵力：活着的人的血量之和 / 满员（至少按 3 人算）
const sfxTeamHp = q => manHp(q).reduce((a, v) => a + v, 0) / Math.max(3, q.men.length);
const sfxCol = f => f > .6 ? COL.g : f > .3 ? COL.amber : COL.enemy;

// 光斑、光环的贴图（琥珀色，画一次，按需缩放）
function sfxSprites() {
  if (SFX.spr || typeof document === 'undefined') return;
  const mk = (fn) => { const c = document.createElement('canvas'); c.width = c.height = 64; fn(c.getContext('2d')); return c; };
  const [r, g, b] = [255, 194, 74];
  SFX.spr = mk(x => { const G = x.createRadialGradient(32, 32, 0, 32, 32, 32); G.addColorStop(0, `rgba(${r},${g},${b},.95)`); G.addColorStop(.45, `rgba(${r},${g},${b},.5)`); G.addColorStop(1, `rgba(${r},${g},${b},0)`); x.fillStyle = G; x.fillRect(0, 0, 64, 64); });
  SFX.ring = mk(x => { const G = x.createRadialGradient(32, 32, 18, 32, 32, 32); G.addColorStop(0, `rgba(${r},${g},${b},0)`); G.addColorStop(.6, `rgba(${r},${g},${b},.95)`); G.addColorStop(1, `rgba(${r},${g},${b},0)`); x.fillStyle = G; x.fillRect(0, 0, 64, 64); });
}
function sfxDot(ctx, img, x, y, r, a) { if (a <= .01) return; ctx.globalAlpha = Math.min(1, a); ctx.drawImage(img, x - r, y - r, r * 2, r * 2); }
// 血条（世界坐标，w、h 已按屏幕像素换算）：黑底、按血量变色；txt 写在上面
function sfxBar(ctx, x, y, w, h, f, txt) {
  f = clamp(f, 0, 1);
  const e = px(.7);
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(0,0,0,.72)'; ctx.fillRect(x - w / 2 - e, y - h / 2 - e, w + e * 2, h + e * 2);
  ctx.fillStyle = sfxCol(f); ctx.fillRect(x - w / 2, y - h / 2, w * f, h);
  if (txt) { ctx.font = font(9); ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = rgba(COL.text, .95); ctx.fillText(txt, x, y - h / 2 - px(2.5)); }
}

// —— 2D：整帧画完（含黑绿画面的后处理 look.js）之后叠上去，琥珀色不被转成绿色：每个人身上一团光（刚点开时更亮、脚下荡开光环）、
//   头顶血量；车辆一团光、结构值。远看画不出单兵时每个小组一团光、一条兵力 ——
HOOK.frame.push(function sfxFrame() {
  sfxScan();
  if (!sfxOn() || !R.ctx || (typeof V3 === 'object' && V3.on) || (typeof INTRO === 'object' && INTRO.on && INTRO.cover)) return;   // 3D 另外画（sfx3）
  sfxSprites();
  const ctx = R.ctx, fl = sfxFlash(), u = sfxU(), a = .5 + fl * .5, bars = [], rings = [];
  ctx.save(); worldTf(ctx); ctx.globalCompositeOperation = 'lighter';
  for (const q of SFX.tm) {
    if (q.ride || !q.men.length || !inView(q.x, q.y, 30) || !sfxSeen(q)) continue;
    const men = R.fig ? sfxMen(q) : null, r = men ? Math.max(3.6, px(6)) : px(8);
    for (const [x, y, hp] of men || [[q.x, q.y]]) {
      sfxDot(ctx, SFX.spr, x, y, r * 1.3, a);
      if (fl > 0) sfxDot(ctx, SFX.spr, x, y, r, fl);   // 全身亮一下
      if (u != null) sfxDot(ctx, SFX.ring, x, y, r * (1.2 + u * 2.6), (1 - u) * .95);   // 脚下荡开一圈光环
      rings.push([x, y, r]);
      if (men) bars.push([x, y - r - px(4), Math.max(4.4, px(12)), Math.max(.8, px(2.4)), hp]);
    }
    if (!men) bars.push([q.x, q.y - r - px(4), px(15), px(2.6), sfxTeamHp(q)]);
  }
  for (const v of SFX.vh) {
    if (v.dead || v.lst || !inView(v.x, v.y, 40) || !sfxSeen(v)) continue;
    const r = Math.max((vehSp(v).len || 8) * .75, px(11));
    sfxDot(ctx, SFX.spr, v.x, v.y, r * 1.25, a);
    if (fl > 0) sfxDot(ctx, SFX.spr, v.x, v.y, r, fl);
    if (u != null) sfxDot(ctx, SFX.ring, v.x, v.y, r * (1.1 + u * 2), (1 - u) * .95);
    rings.push([v.x, v.y, r]);
    bars.push([v.x, v.y - r - px(4), Math.max(r * 1.6, px(24)), px(3.2), v.hp / Math.max(1, v.maxhp), R.zr > 2.6 ? `${Math.max(0, Math.ceil(v.hp))}/${v.maxhp}` : null]);
  }
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  ctx.strokeStyle = rgba(COL.amber, .5 + fl * .5); ctx.lineWidth = px(1.5);   // 选中圈：纯琥珀色，绿底上也醒目
  ctx.beginPath(); for (const [x, y, r] of rings) { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, 6.283); } ctx.stroke();
  for (const b of bars) sfxBar(ctx, ...b);
  ctx.restore();
});

// —— 3D（view3d.js v3Overlay 调用，屏幕空间）：贴地的光圈（按透视投成椭圆）、刚点开时荡开的光环、头顶的血条；被山挡住的不画 ——
function sfx3(ctx) {
  sfxScan();
  if (!sfxOn() || typeof V3 !== 'object' || !V3.cam) return;
  sfxSprites();
  const C = V3.cam, E = C.E, fl = sfxFlash(), u = sfxU(), a = .55 + fl * .45, d0 = R.dpr || 1;
  const far = typeof v3FogR === 'function' ? v3FogR(C)[1] : C.D * 2.8;
  const camD = (x, y, z) => Math.hypot(x - E[0], y + E[1], z - E[2]);
  // 被地形挡住：从镜头到这一点沿线取几个点，有一处地面高过视线就算挡住
  const occ = (x, y, z) => { const ex = E[0], ey = -E[1], ez = E[2]; for (let k = 1; k < 12; k++) { const t = k / 12, sx = ex + (x - ex) * t, sy = ey + (y - ey) * t; if (sx >= 0 && sy >= 0 && sx < W && sy < H && v3Ht(sx, sy) > ez + (z - ez) * t + .8) return true; } return false; };
  // 地面上以 (x, y) 为心、半径 r 的圆：投影出中心和两个半轴端点，按仿射画成椭圆
  const disc = (img, x, y, r, al) => {
    if (al <= .01) return;
    const z = v3Ht(x, y) + .2, p = v3Proj(x, y, z), px1 = v3Proj(x + r, y, z), py1 = v3Proj(x, y + r, z);
    if (!p || !px1 || !py1 || p.f > .97) return;
    ctx.setTransform(d0 * (px1.x - p.x), d0 * (px1.y - p.y), d0 * (py1.x - p.x), d0 * (py1.y - p.y), d0 * p.x, d0 * p.y);
    ctx.globalAlpha = Math.min(1, al * (1 - p.f)); ctx.drawImage(img, -1, -1, 2, 2);
  };
  const bars = [];
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (const q of SFX.tm) {
    if (q.ride || !q.men.length || !sfxSeen(q)) continue;
    const z = v3Ht(q.x, q.y), d = camD(q.x, q.y, z);
    if (d > far || occ(q.x, q.y, z + 1.6)) continue;
    const ks = clamp(d / 700, 1, 1.6), near = d < 240, men = sfxMen(q, ks);
    for (const [x, y, hp] of near ? men : [[q.x, q.y]]) {
      const r = near ? 2.8 * ks : 7 * ks;
      disc(SFX.spr, x, y, r, a);
      if (u != null) disc(SFX.ring, x, y, r * (1.3 + u * 2.6), (1 - u) * .95);
      if (near) bars.push({ x, y, z: v3Ht(x, y) + 2.4 * ks, f: hp, w: clamp(2600 / d, 8, 22), h: 3 });
    }
    if (!near && d < 800) bars.push({ x: q.x, y: q.y, z: z + 4.5 * ks, f: sfxTeamHp(q), w: clamp(3200 / d, 9, 16), h: 3 });
  }
  for (const v of SFX.vh) {
    if (v.dead || v.lst || !sfxSeen(v)) continue;
    const z = v3Ht(v.x, v.y), d = camD(v.x, v.y, z), L = vehSp(v).len || 8;
    if (d > far || occ(v.x, v.y, z + 2)) continue;
    disc(SFX.spr, v.x, v.y, L * .8, a);
    if (u != null) disc(SFX.ring, v.x, v.y, L * (.9 + u * 1.8), (1 - u) * .95);
    if (d < 1200) bars.push({ x: v.x, y: v.y, z: z + 4.2, f: v.hp / Math.max(1, v.maxhp), w: clamp(6000 / d, 14, 46), h: 4, txt: d < 380 ? `${Math.max(0, Math.ceil(v.hp))}/${v.maxhp}` : null });
  }
  ctx.restore();
  // 血条、结构值（屏幕像素大小，不随透视变形）
  ctx.save(); ctx.setTransform(d0, 0, 0, d0, 0, 0); ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.font = '10px "IBM Plex Mono", monospace';
  for (const b of bars) {
    const p = v3Proj(b.x, b.y, b.z);
    if (!p || p.f > .95) continue;
    const f = clamp(b.f, 0, 1), x = p.x, y = p.y;
    ctx.globalAlpha = 1 - p.f;
    ctx.fillStyle = 'rgba(0,0,0,.75)'; ctx.fillRect(x - b.w / 2 - 1, y - b.h / 2 - 1, b.w + 2, b.h + 2);
    ctx.fillStyle = sfxCol(f); ctx.fillRect(x - b.w / 2, y - b.h / 2, b.w * f, b.h);
    if (b.txt) { ctx.fillStyle = rgba(COL.text, .95); ctx.fillText(b.txt, x, y - b.h / 2 - 3); }
  }
  ctx.restore();
}
HOOK.newGame.push(() => { SFX.S = null; SFX.key = ''; SFX.tm.clear(); SFX.vh.clear(); });
