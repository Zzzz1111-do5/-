'use strict';
// 写实贴图引擎：每个型号的车体 / 炮塔 / 炮管预先渲染成高分辨率贴图（每米 SPR_PPM 像素），运行时只旋转贴图
// 光照做成与朝向无关的「顶光」：零件边缘倒角压暗、沿边细亮线、压在下层零件上的环境阴影；朝向相关的投影在运行时按世界东南方向画
// 画笔 P（单位：米，x 向前、y 向右）：plate 多边形板件 · box 方块 · disc 圆顶 · hatch 舱盖 · cupola 指挥塔 · peri 潜望镜 · grille 格栅 · era 反应装甲 ·
//   smoke 烟幕弹发射器 · light 车灯 · cable 拖缆 · tool 随车工具 · mg 机枪 · mesh 网篮 · bag 帆布包 · line 刻线 · wheel 车轮 · cells 垂发单元
const SPR = { m: new Map(), noise: null, pat: null };
const SPR_PPM = 24;
const SPR_MAT = {
  p: { paint: '#5f6c41', camo: ['#4b5733', '#77754d', '#3e4630'], canvas: '#6a6a4a', dirt: '#5a4c36' },
  e: { paint: '#8e8260', camo: null, canvas: '#857c5f', dirt: '#6b5d43' },
  n: { paint: '#7f878c', camo: null, canvas: '#7a7f80', dirt: '#55595a' },   // 海军灰
  eg: { paint: '#cf2f22', camo: null, canvas: '#b0301f', dirt: '#7e231a' }    // 黑绿画面里的敌方：暗红涂装（look.js 着色器保留红色）
};
const SPR_RUBBER = '#272724', SPR_METAL = '#4b4d49', SPR_STEEL = '#6e706b', SPR_GLASS = '#2e4653', SPR_DARK = '#1d1e1b';

// 可平铺的细噪声（漆面颗粒、磨损）
function sprNoise() {
  if (SPR.noise) return SPR.noise;
  const n = 128, c = document.createElement('canvas'), g = c.getContext('2d'), img = g.createImageData(n, n), r = rng(4242);
  const L = [8, 16, 32, 64].map(k => { const a = new Float32Array(k * k); for (let i = 0; i < a.length; i++) a[i] = r(); return { k, a }; });
  const sm = t => t * t * (3 - 2 * t);
  const smp = ({ k, a }, u, v) => { const x = u * k, y = v * k, i = Math.floor(x), j = Math.floor(y), fx = sm(x - i), fy = sm(y - j), A = (ii, jj) => a[((jj % k) + k) % k * k + ((ii % k) + k) % k]; return lerp(lerp(A(i, j), A(i + 1, j), fx), lerp(A(i, j + 1), A(i + 1, j + 1), fx), fy); };
  c.width = c.height = n;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const u = x / n, v = y / n, s = smp(L[0], u, v) * .35 + smp(L[1], u, v) * .25 + smp(L[2], u, v) * .2 + smp(L[3], u, v) * .1 + r() * .1;
    const b = clamp(s * 255, 0, 255);
    img.data.set([b, b, b, 255], (y * n + x) * 4);
  }
  g.putImageData(img, 0, 0);
  return (SPR.noise = c);
}

// 画笔：在贴图画布上按米作画
function sprPainter(g, side) {
  const M = SPR_MAT[side] || SPR_MAT.p, ppm = SPR_PPM;
  const shade = (hex, k) => rlShade(hex, k);
  const pat = g.createPattern(sprNoise(), 'repeat');
  if (pat && pat.setTransform && typeof DOMMatrix === 'function') pat.setTransform(new DOMMatrix([1 / ppm * 1.2, 0, 0, 1 / ppm * 1.2, 0, 0]));
  const poly = pts => app => { if (!app) g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); };
  const rr = (x, y, w, h, r) => app => {
    if (!app) g.beginPath();
    r = Math.min(r || 0, w / 2, h / 2);
    g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.arcTo(x + w, y, x + w, y + r, r); g.lineTo(x + w, y + h - r); g.arcTo(x + w, y + h, x + w - r, y + h, r);
    g.lineTo(x + r, y + h); g.arcTo(x, y + h, x, y + h - r, r); g.lineTo(x, y + r); g.arcTo(x, y, x + r, y, r); g.closePath();
  };
  const circ = (x, y, r) => app => { if (!app) g.beginPath(); g.moveTo(x + r, y); g.arc(x, y, r, 0, Math.PI * 2); g.closePath(); };
  // 一个零件：环境阴影 → 底色 → 漆面颗粒 → 倒角（内缘压暗 + 沿边亮线）→ 外轮廓
  const part = (path, col, o = {}) => {
    const ao = o.ao ?? .16, bev = o.bev ?? .09;
    if (ao > 0) { g.save(); g.shadowColor = `rgba(0,0,0,${o.aoA ?? .55})`; g.shadowBlur = ao * ppm; path(); g.fillStyle = col; g.fill(); g.restore(); }
    path(); g.fillStyle = col; g.fill();
    if (o.mid) o.mid();   // 底色之上、倒角之下（迷彩、做旧）
    if (o.grad !== false) {   // 顶光：中间略亮
      g.save(); path(); g.clip();
      g.globalCompositeOperation = 'soft-light'; g.globalAlpha = .35; g.fillStyle = '#ffffff'; path(); g.fill();
      g.restore();
    }
    if (o.tex !== false && pat) { g.save(); path(); g.clip(); g.globalAlpha = o.tex ?? .22; g.globalCompositeOperation = 'overlay'; g.fillStyle = pat; g.fillRect(-60, -60, 120, 120); g.restore(); }
    if (bev > 0) {
      g.save(); path(); g.clip();
      g.shadowColor = `rgba(0,0,0,${o.bevA ?? .5})`; g.shadowBlur = bev * ppm * 1.7;
      g.beginPath(); g.rect(-80, -80, 160, 160); path(true); g.fillStyle = '#000'; g.fill('evenodd');
      g.restore();
      g.save(); path(); g.clip(); path(); g.strokeStyle = `rgba(255,255,255,${o.hl ?? .17})`; g.lineWidth = .08; g.stroke(); g.restore();
    }
    path(); g.strokeStyle = `rgba(0,0,0,${o.ol ?? .6})`; g.lineWidth = o.olw ?? .035; g.stroke();
  };
  const P = {
    g, M, side, shade, poly, rr, circ, part,
    paint: M.paint,
    plate: (pts, col = M.paint, o) => part(poly(pts), col, o),
    box: (x, y, w, h, col = M.paint, o = {}) => part(rr(x - w / 2, y - h / 2, w, h, o.r ?? .05), col, o),
    disc: (x, y, r, col = M.paint, o = {}) => {
      part(circ(x, y, r), col, { bev: r * .35, ...o });
      const gr = g.createRadialGradient(x - r * .25, y - r * .25, r * .1, x, y, r);
      gr.addColorStop(0, 'rgba(255,255,255,.22)'); gr.addColorStop(.6, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(0,0,0,.25)');
      g.fillStyle = gr; circ(x, y, r)(); g.fill();
    },
    // 舱盖：圆形盖板、内圈、铰链、把手
    hatch: (x, y, r, col = M.paint, hinge = Math.PI) => {
      P.disc(x, y, r, shade(col, .92), { ao: .1 });
      g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = .03; g.beginPath(); g.arc(x, y, r * .7, 0, 7); g.stroke();
      const hx = x + Math.cos(hinge) * r * .8, hy = y + Math.sin(hinge) * r * .8;
      g.fillStyle = SPR_METAL; g.fillRect(hx - .06, hy - r * .35, .12, r * .7);
      g.strokeStyle = SPR_DARK; g.lineWidth = .04; g.beginPath(); g.arc(x - Math.cos(hinge) * r * .35, y - Math.sin(hinge) * r * .35, r * .18, 0, 7); g.stroke();
    },
    // 潜望镜：小块深色玻璃 + 护框
    peri: (x, y, w = .22, h = .1, a = 0) => {
      g.save(); g.translate(x, y); g.rotate(a);
      part(rr(-w / 2, -h / 2 - .03, w, h + .06, .02), SPR_METAL, { ao: .06, bev: .02, tex: false });
      g.fillStyle = SPR_GLASS; g.fillRect(-w / 2 + .03, h / 2 - .02, w - .06, .05);
      g.fillStyle = 'rgba(160,200,220,.4)'; g.fillRect(-w / 2 + .04, h / 2 - .015, (w - .08) * .5, .015);
      g.restore();
    },
    // 指挥塔：带周视潜望镜的座圈 + 舱盖
    cupola: (x, y, r, n = 6, col = M.paint) => {
      P.disc(x, y, r, shade(col, .95), { ao: .14 });
      for (let i = 0; i < n; i++) { const b = i / n * Math.PI * 2; P.peri(x + Math.cos(b) * r * .82, y + Math.sin(b) * r * .82, .16, .08, b + Math.PI / 2); }
      P.hatch(x, y, r * .62, col);
    },
    // 格栅：下凹的深色进 / 排气口，百叶片带亮边
    grille: (x0, y0, x1, y1, n = 6, across = true) => {
      part(rr(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0), .04), '#2b2c27', { ao: 0, bev: .08, bevA: .7, tex: .12 });
      g.lineWidth = .045;
      for (let i = 1; i < n; i++) {
        const u = i / n;
        if (across) { const x = lerp(x0, x1, u); g.strokeStyle = 'rgba(160,160,150,.35)'; g.beginPath(); g.moveTo(x, y0 + .04); g.lineTo(x, y1 - .04); g.stroke(); g.strokeStyle = 'rgba(0,0,0,.5)'; g.beginPath(); g.moveTo(x + .05, y0 + .04); g.lineTo(x + .05, y1 - .04); g.stroke(); }
        else { const y = lerp(y0, y1, u); g.strokeStyle = 'rgba(160,160,150,.35)'; g.beginPath(); g.moveTo(x0 + .04, y); g.lineTo(x1 - .04, y); g.stroke(); g.strokeStyle = 'rgba(0,0,0,.5)'; g.beginPath(); g.moveTo(x0 + .04, y + .05); g.lineTo(x1 - .04, y + .05); g.stroke(); }
      }
    },
    // 反应装甲：一块块独立的方盒（螺栓固定）
    era: (x0, y0, x1, y1, nx, ny, col = M.paint) => {
      const cw = (x1 - x0) / nx, ch = (y1 - y0) / ny;
      for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
        const x = x0 + i * cw, y = y0 + j * ch;
        part(rr(x + .025, y + .025, cw - .05, ch - .05, .03), shade(col, .94 + ((i * 7 + j * 3) % 3) * .04), { ao: .06, bev: .05, tex: .25 });
        g.fillStyle = 'rgba(0,0,0,.45)'; g.beginPath(); g.arc(x + cw / 2, y + ch / 2, .025, 0, 7); g.fill();
      }
    },
    // 烟幕弹发射器：一排发射筒（a 朝外）
    smoke: (x, y, n, a, sp = .17) => {
      g.save(); g.translate(x, y); g.rotate(a);
      part(rr(-.12, -n * sp / 2, .26, n * sp, .04), SPR_METAL, { ao: .08, bev: .03 });
      for (let i = 0; i < n; i++) { const yy = -n * sp / 2 + sp * (i + .5); g.fillStyle = shade(M.paint, .8); g.beginPath(); g.arc(.04, yy, .07, 0, 7); g.fill(); g.fillStyle = SPR_DARK; g.beginPath(); g.arc(.06, yy, .04, 0, 7); g.fill(); }
      g.restore();
    },
    // 车灯：护框 + 玻璃
    light: (x, y, w = .22, h = .16) => { part(rr(x - w / 2, y - h / 2, w, h, .03), SPR_METAL, { ao: .06, bev: .03, tex: false }); g.fillStyle = '#c9cfc6'; g.fillRect(x - w / 2 + .04, y - h / 2 + .04, w - .08, h - .08); g.fillStyle = 'rgba(255,255,255,.5)'; g.fillRect(x - w / 2 + .05, y - h / 2 + .05, (w - .1) * .5, .03); },
    // 拖缆：钢丝绳（深色 + 一道亮线），两端绳环
    cable: pts => {
      g.lineJoin = 'round'; g.lineCap = 'round';
      g.strokeStyle = 'rgba(0,0,0,.45)'; g.lineWidth = .11; g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo(x + .02, y + .02) : g.moveTo(x + .02, y + .02)); g.stroke();
      g.strokeStyle = '#3d3e39'; g.lineWidth = .075; g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.stroke();
      g.strokeStyle = 'rgba(200,200,190,.35)'; g.lineWidth = .02; g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo(x - .015, y - .015) : g.moveTo(x - .015, y - .015)); g.stroke();
      for (const [x, y] of [pts[0], pts[pts.length - 1]]) { g.strokeStyle = '#3d3e39'; g.lineWidth = .05; g.beginPath(); g.arc(x, y, .09, 0, 7); g.stroke(); }
    },
    // 随车工具（锹 / 撬棍）：木柄 + 金属头，带卡箍
    tool: (x, y, len, a = 0, kind = 'shovel') => {
      g.save(); g.translate(x, y); g.rotate(a);
      part(rr(-len / 2, -.035, len * .75, .07, .03), '#6d5a3e', { ao: .05, bev: .015, tex: .3 });
      if (kind === 'shovel') part(rr(len * .25, -.12, len * .25, .24, .05), SPR_STEEL, { ao: .05, bev: .03 }); else part(rr(len * .25, -.04, len * .25, .08, .02), SPR_STEEL, { ao: .05, bev: .015 });
      for (const u of [-.3, .1]) { g.fillStyle = SPR_METAL; g.fillRect(len * u - .02, -.08, .04, .16); }
      g.restore();
    },
    // 机枪：枪身、枪管、弹箱
    mg: (x, y, a = 0, len = 1.2, heavy = false) => {
      g.save(); g.translate(x, y); g.rotate(a);
      part(rr(-.25, -.08, .55, .16, .03), SPR_METAL, { ao: .08, bev: .03 });
      part(rr(.25, heavy ? -.045 : -.03, len, heavy ? .09 : .06, .02), '#2e2f2b', { ao: .05, bev: .015, tex: false });
      part(rr(-.15, .08, .3, .2, .03), shade(M.paint, .75), { ao: .05, bev: .02 });
      g.restore();
    },
    // 网篮（尾舱储物架）：框、网格、里面的帆布包与水桶
    mesh: (x0, y0, x1, y1, items = 4) => {
      const w = x1 - x0, h = y1 - y0;
      part(rr(x0, y0, w, h, .05), 'rgba(40,40,36,.85)', { ao: .12, bev: .02, tex: false, grad: false });
      for (let i = 0; i < items; i++) { const r = Math.sin(i * 12.9 + x0) * .5 + .5; P.bag(x0 + w * (i % 2 ? .7 : .3) + (r - .5) * w * .15, y0 + h * (i + .5) / items, w * .38, h / items * .8, (r - .5) * .4); }
      g.strokeStyle = 'rgba(30,30,28,.9)'; g.lineWidth = .025; g.beginPath();
      for (let x = x0; x <= x1 + 1e-6; x += .2) { g.moveTo(x, y0); g.lineTo(x, y1); }
      for (let y = y0; y <= y1 + 1e-6; y += .2) { g.moveTo(x0, y); g.lineTo(x1, y); }
      g.stroke();
      g.strokeStyle = SPR_METAL; g.lineWidth = .06; g.strokeRect(x0, y0, w, h);
    },
    // 帆布包：圆角软包 + 褶皱 + 捆扎带
    bag: (x, y, w, h, a = 0) => {
      g.save(); g.translate(x, y); g.rotate(a);
      part(rr(-w / 2, -h / 2, w, h, Math.min(w, h) * .35), M.canvas, { ao: .1, bev: Math.min(w, h) * .3, tex: .35 });
      g.strokeStyle = 'rgba(0,0,0,.28)'; g.lineWidth = .025; g.beginPath(); g.moveTo(-w * .3, -h * .3); g.quadraticCurveTo(0, -h * .1, w * .3, -h * .35); g.stroke();
      g.strokeStyle = 'rgba(30,30,24,.6)'; g.lineWidth = .04; g.beginPath(); g.moveTo(-w * .15, -h / 2); g.lineTo(-w * .15, h / 2); g.moveTo(w * .2, -h / 2); g.lineTo(w * .2, h / 2); g.stroke();
      g.restore();
    },
    // 刻线（面板接缝）：深线 + 下方一道亮线
    line: (x0, y0, x1, y1, w = .03) => {
      g.strokeStyle = 'rgba(0,0,0,.38)'; g.lineWidth = w; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      g.strokeStyle = 'rgba(255,255,255,.12)'; g.lineWidth = w * .8; g.beginPath(); g.moveTo(x0 + w, y0 + w); g.lineTo(x1 + w, y1 + w); g.stroke();
    },
    bolts: (pts, r = .03) => { for (const [x, y] of pts) { g.fillStyle = 'rgba(0,0,0,.4)'; g.beginPath(); g.arc(x + .01, y + .01, r, 0, 7); g.fill(); g.fillStyle = 'rgba(255,255,255,.18)'; g.beginPath(); g.arc(x - .006, y - .006, r * .6, 0, 7); g.fill(); } },
    // 车轮（俯视看到胎面）：橡胶、胎纹
    wheel: (x, y, l, w) => {
      part(rr(x - l / 2, y - w / 2, l, w, w * .4), SPR_RUBBER, { ao: .12, bev: w * .3, tex: .3, hl: .08 });
      g.strokeStyle = 'rgba(0,0,0,.45)'; g.lineWidth = .03; g.beginPath();
      for (let u = x - l / 2 + .08; u < x + l / 2 - .05; u += .11) { g.moveTo(u, y - w / 2 + .04); g.lineTo(u + .04, y + w / 2 - .04); }
      g.stroke();
    },
    // 迷彩：在给定轮廓内画不规则色斑（解放军三色；美军沙色单色不画）
    camo: (path, seed = 1, sc = 1) => {
      if (!M.camo) return;
      g.save(); path(); g.clip();
      const r = rng(seed * 977 + 13);
      for (let i = 0; i < 26; i++) {
        const cx = (r() - .5) * 11, cy = (r() - .5) * 5, n = 7, pts = [];
        for (let k = 0; k < n; k++) { const a = k / n * Math.PI * 2, d = (.35 + r() * .55) * sc; pts.push([cx + Math.cos(a) * d * 1.6, cy + Math.sin(a) * d]); }
        g.fillStyle = M.camo[i % M.camo.length]; g.globalAlpha = .75;
        g.beginPath(); pts.forEach(([x, y], k) => k ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); g.fill();
      }
      g.restore();
    },
    // 做旧：车体下沿与履带附近的尘土
    dirt: (path, L, B) => {
      g.save(); path(); g.clip();
      const gr = g.createLinearGradient(0, -B / 2, 0, B / 2);
      gr.addColorStop(0, rgba(M.dirt, .4)); gr.addColorStop(.18, rgba(M.dirt, 0)); gr.addColorStop(.82, rgba(M.dirt, 0)); gr.addColorStop(1, rgba(M.dirt, .4));
      g.fillStyle = gr; g.fillRect(-L, -B, L * 2, B * 2);
      const g2 = g.createLinearGradient(-L / 2, 0, -L / 2 + 1.2, 0);
      g2.addColorStop(0, 'rgba(20,18,14,.35)'); g2.addColorStop(1, 'rgba(20,18,14,0)');   // 车尾排气熏黑
      g.fillStyle = g2; g.fillRect(-L, -B, L * 2, B * 2);
      g.restore();
    },
    // 垂发单元（舰艇）：nx × ny 个方形盖板
    cells: (x0, y0, x1, y1, nx, ny) => {
      part(rr(x0, y0, x1 - x0, y1 - y0, .1), '#5d6468', { ao: .1, bev: .1 });
      const cw = (x1 - x0) / nx, ch = (y1 - y0) / ny;
      for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) { g.fillStyle = (i + j) % 2 ? '#6b7276' : '#646b6f'; g.fillRect(x0 + i * cw + .05, y0 + j * ch + .05, cw - .1, ch - .1); g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = .03; g.strokeRect(x0 + i * cw + .05, y0 + j * ch + .05, cw - .1, ch - .1); }
    }
  };
  return P;
}

// 生成并缓存一张贴图：w × h 米、原点在中心（ox、oy 为原点在贴图中的像素位置），draw(P)
function sprGet(key, side, w, h, draw, ppm = SPR_PPM) {
  if (side === 'e' && typeof greenLook === 'function' && greenLook()) side = 'eg';   // 黑绿画面：敌方用暗红涂装（另存一份贴图）
  const k = key + ':' + side + ':' + ppm;
  let s = SPR.m.get(k);
  if (s) return s;
  const pad = 1.2, cv = document.createElement('canvas');
  cv.width = Math.ceil((w + pad * 2) * ppm); cv.height = Math.ceil((h + pad * 2) * ppm);
  const g = cv.getContext('2d');
  g.translate(cv.width / 2, cv.height / 2); g.scale(ppm, ppm);
  g.lineJoin = 'round'; g.lineCap = 'round';
  try { draw(sprPainter(g, side)); } catch (e) { console.error('sprite', key, e); }
  // 投影用的剪影：整张贴图的柔和黑影
  const sh = document.createElement('canvas'); sh.width = cv.width; sh.height = cv.height;
  const sg = sh.getContext('2d');
  sg.shadowColor = 'rgba(0,0,0,1)'; sg.shadowBlur = ppm * .35; sg.shadowOffsetX = cv.width;
  sg.drawImage(cv, -cv.width, 0);
  s = { cv, sh, ox: cv.width / 2, oy: cv.height / 2, ppm };
  SPR.m.set(k, s);
  return s;
}
// 在当前坐标系（单位：米 × sm）画贴图；rot 额外旋转
function sprDraw(ctx, s, x, y, sm, rot = 0, alpha = 1) {
  const k = sm / s.ppm;
  ctx.save(); ctx.translate(x, y); if (rot) ctx.rotate(rot); ctx.scale(k, k);
  if (alpha !== 1) ctx.globalAlpha *= alpha;
  ctx.drawImage(s.cv, -s.ox, -s.oy);
  ctx.restore();
}
// 投影：按世界东南方向偏移（wx、wy 为世界偏移，h 为当前坐标系相对世界的转角）
function sprShadow(ctx, s, x, y, sm, rot, h, d, a = .42) {
  const [lx, ly] = rlLocal(h, d, d), k = sm / s.ppm;
  ctx.save(); ctx.translate(x + lx, y + ly); if (rot) ctx.rotate(rot); ctx.scale(k, k);
  ctx.globalAlpha *= a; ctx.drawImage(s.sh, -s.ox, -s.oy);
  ctx.restore();
}
