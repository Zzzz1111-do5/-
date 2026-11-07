'use strict';
// 宣传片分镜（64 秒，30 帧）：配乐 120 拍、一小节 2 秒，换镜头都在小节上
//   开场标题（基地全景）→ 盖楼（楼一栋栋升起来）→ 工业区、空军基地 → 重生开放的新区域 → 39 个兵种布阵 → 开战
//   → 新兵种：空中炮艇、蜂群无人机、激光拦截、战况「敌机突袭」、电磁炮、弹道导弹、爱国者拦截 → 大场面 → 技能、真人对战 → 高潮快切 → 胜利 → 片尾标志
// 每个镜头：at 片中起点、dur 时长、T0 开拍时的战斗时间、rate 战斗时间走多快（0 = 定格、<1 = 慢动作）、cam(u, T) 返回镜头、card 字幕、rise 楼升起来
(function () {
  const LEN = 64;
  TR.LEN = LEN;
  const tracks = () => TR.tracks(), fx = () => TR.fx();
  const pick = (t, team, n) => tracks().filter(x => x.t === t && x.team === team)[n || 0];
  // 绕 c 一圈找个视线不被树、楼挡住的方向（从 a0 开始试，挡得最少的那个）
  const clearAng = (c, dist, h, a0) => {
    const O = TR.scene().origin, near = [];
    for (const p of TR.scene().parts) { const x = p.c[0] - O[0], y = p.c[1] - O[1], z = p.c[2] - O[2], r = Math.max(p.z[0], p.z[1], p.z[2]) / 2;
      if (p.t >= 0.5 || y + r < 2.5 || Math.hypot(x - c[0], z - c[2]) > dist + 30) continue; near.push([x, y, z, r]); }
    let best = a0, bh = 1e9;
    for (let k = 0; k < 12; k++) { const a = a0 + k * Math.PI / 6, eye = [c[0] + Math.cos(a) * dist, h, c[2] + Math.sin(a) * dist], tg = [c[0], 10, c[2]];
      let hits = 0; for (let j = 1; j < 16; j++) { const q = L3(eye, tg, j / 18); for (const n of near) if (Math.hypot(q[0] - n[0], q[1] - n[1], q[2] - n[2]) < n[3] + 3) hits++; }
      if (hits < bh) { bh = hits; best = a; } if (!hits) break; }
    return best; };
  // T0–T1 一直活着、在动的我方地面单位里，身边特效最多的那个
  const busiest = (T0, T1) => { let best = null, bn = -1;
    for (const tr of tracks()) { if (tr.team !== 1 || tr.def.air) continue; const a = TR.sampleOf(tr, T0), b = TR.sampleOf(tr, T1); if (!a.x && !a.z || a.dead || b.dead || !b.x && !b.z) continue;
      if (Math.hypot(b.x - a.x, b.z - a.z) < 20) continue;
      let n = 0; for (const e of fx()) { if (e.tt < T0) continue; if (e.tt > T1) break; const q = e.p || e.b || e.a, s = q && TR.sampleOf(tr, e.tt); if (s && Math.hypot(q[0] - s.x, q[2] - s.z) < 90) n++; }
      if (n > bn) { bn = n; best = tr; } }
    return best || pick('tank', 1, 0); };
  const evs = (k, pred) => fx().filter(e => e.k === k && (!pred || pred(e)));
  const at = (tr, T, dy) => { const p = TR.posOf(tr, T) || [0, 0, 0]; return [p[0], p[1] + 1 + (dy || 0), p[2]]; };
  const L3 = (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
  const sm = u => u * u * (3 - 2 * u);
  const dolly = (e0, e1, a0, a1, fov) => u => ({ eye: L3(e0, e1, sm(u)), at: L3(a0, a1, sm(u)), fov: fov || 50 });
  const K = (k, t, s, pos) => ({ k, t, s, pos: pos || 'left' });
  const SH = [];
  const shot = s => SH.push(s);
  TR.shots = SH;

  TR.buildTimeline = function () {
    SH.length = 0;
    const N = TR.scene().buildings.length;
    // 楼按顺序一栋栋升起来（rise 的下标是楼号，0 号不是楼）
    const riseSeq = (u, from, to) => { const r = new Array(40).fill(1); for (let k = 1; k <= N; k++) { const kk = (k - 1) / Math.max(1, N - 1); const v = (u - lerp(from, to, kk)) / 0.12; r[k] = clamp(v, 0, 1) < 1 ? easeOut(clamp(v, 0, 1)) : 1; } return r; };
    // ① 0–4 片名：从基地东南高处慢慢压下来
    shot({ at: 0, dur: 4, T0: 0, rate: 0, fadeIn: 1.0, cam: dolly([300, 230, -470], [210, 150, -330], [0, 30, 40], [0, 18, 60], 46),
      card: K('MILITARY TYCOON', '军事大亨', '盖基地 · 造兵 · 打仗', 'logo'), cardAt: [0.7, 3.6] });
    // ② 4–8 盖楼：低空绕着基地转，楼一栋栋从地里升起来
    shot({ at: 4, dur: 4, T0: 0, rate: 0, rise: u => riseSeq(u, 0.0, 0.82), units: false,
      cam: u => { const a = lerp(3.55, 4.25, sm(u)); return { eye: [Math.cos(a) * 250, 72 - 14 * u, Math.sin(a) * 250], at: [-10, 14, 0], fov: 50 }; },
      card: K('大亨经营', '盖楼 · 赚钱', '34 栋建筑，每栋都能升级'), cardAt: [0.4, 3.7] });
    // ③ 8–12 工业区、核电站、空军基地
    shot({ at: 8, dur: 4, T0: 0, rate: 0, units: false, cam: dolly([-470, 115, -190], [-280, 70, 150], [-250, 12, -40], [-40, 10, 40], 48),
      card: K('扩建', '工业区 · 空军基地', '油井、钢铁厂、核电站、跑道'), cardAt: [0.4, 3.7] });
    // ④ 12–16 重生开放的三块新区域（从航天中心的火箭扫到导弹基地）
    shot({ at: 12, dur: 4, T0: 0, rate: 0, units: false, cam: dolly([-430, 70, -400], [330, 95, -430], [-270, 34, -228], [240, 12, -215], 48),
      card: K('重生 · 最多 3 次', '开放新区域', '港口区 · 导弹基地 · 航天中心'), cardAt: [0.4, 3.7] });
    // ⑤ 16–20 布阵：贴地沿着阵线前面扫过去（定格在开战前）
    shot({ at: 16, dur: 4, T0: 0.02, rate: 0, cam: dolly([-250, 11, 352], [250, 13, 352], [-190, 7, 270], [190, 7, 270], 50),
      card: K('布阵', '39 个兵种', '步兵 · 装甲 · 防空 · 炮兵 · 空中'), cardAt: [0.4, 3.7] });
    // ⑥ 20–22 开战！坦克后面推进
    const tk = pick('tank', 1, 1) || pick('tank', 1, 0);
    shot({ at: 20, dur: 2, T0: 0, rate: 1, flash: true, cam: u => { const T = u * 2, p = at(tk, T); return { eye: [p[0] + 14, p[1] + 9, p[2] - 34 + u * 6], at: [p[0] - 4, p[1] + 4, p[2] + 70], fov: 52 }; },
      card: K('', '开战！', '', 'mid'), cardAt: [0.05, 1.8] });
    // ⑦ 22–26 空中炮艇：跟在炮艇侧后方，往下看着炮弹砸下去
    const gs = pick('gunship', 1, 0);
    shot({ at: 22, dur: 4, T0: 3.2, rate: 1, shadowR: 700, cam: u => { const T = 3.2 + u * 4, p = at(gs, T), s = TR.sampleOf(gs, T);
      const fw = [-Math.sin(s.yaw), 0, -Math.cos(s.yaw)], rt = [Math.cos(s.yaw), 0, -Math.sin(s.yaw)];
      return { eye: [p[0] - fw[0] * 95 + rt[0] * 55, p[1] + 34, p[2] - fw[2] * 95 + rt[2] * 55], at: [p[0] + fw[0] * 20 + rt[0] * 25, p[1] - 45, p[2] + fw[2] * 20 + rt[2] * 25], fov: 55 }; },
      card: K('新兵种', '空中炮艇', '高空绕大圈，105 毫米炮往下砸'), cardAt: [0.3, 3.7] });
    // ⑧ 26–28 蜂群：发射车旁边，小无人机一窝蜂飞出去
    const sw = evs('swarm')[0];
    if (sw) shot({ at: 26, dur: 2, T0: sw.tt - 0.25, rate: 1, cam: dolly([sw.p[0] + 34, sw.p[1] + 9, sw.p[2] - 30], [sw.p[0] + 26, sw.p[1] + 16, sw.p[2] - 16], [sw.p[0] - 4, sw.p[1] + 10, sw.p[2] + 30], [sw.p[0] - 6, sw.p[1] + 26, sw.p[2] + 90], 54),
      card: K('新兵种', '蜂群无人机', '一次放出 4 架，扑向敌人的车'), cardAt: [0.1, 1.9] });
    // ⑨ 28–30 激光拦截：激光车旁边往天上看，炮弹在半空被烧爆
    const li = evs('intercept', e => e.laser && e.tt > 4)[0] || evs('intercept')[0];
    if (li) { const sh = fx().find(x => x.id === li.id && (x.k === 'shell' || x.k === 'mrocket' || x.k === 'gshell')); const hp = sh ? TR.projPos(sh, li.tt - sh.tt) : [li.a[0], li.a[1] + 80, li.a[2] + 80];
      shot({ at: 28, dur: 2, T0: li.tt - 1.0, rate: 0.7, cam: dolly([li.a[0] - 22, li.a[1] + 7, li.a[2] - 30], [li.a[0] - 18, li.a[1] + 6, li.a[2] - 24], L3(li.a, hp, 0.55), L3(li.a, hp, 0.8), 56),
        card: K('新兵种', '激光防空', '光束把飞来的炮弹烧爆在半空'), cardAt: [0.1, 1.9] }); }
    // ⑩ 30–32 战况：敌机突袭（轰炸机从北边压过来，沿阵线扔炸弹）
    const fo = evs('flyover')[0];
    if (fo) { const mid = L3(fo.a, fo.b, 0.5), g = [mid[0], 2, mid[2]];
      shot({ at: 30, dur: 2, T0: fo.tt + 1.2, rate: 1.1, cam: dolly([g[0] + 70, 12, g[2] - 70], [g[0] + 64, 14, g[2] - 60], [g[0] - 10, 40, g[2] + 60], [g[0] - 10, 10, g[2] - 10], 60),
        card: K('战况', '敌机突袭', '每关一种：大雾 · 夜战 · 雷区 · 空降增援'), cardAt: [0.1, 1.9] }); }
    // ⑪ 32–34 电磁炮：炮车后面顺着光束看过去（慢动作）
    const rl = evs('rail', e => e.tt > 5 && (e.n || 0) >= 2)[0] || evs('rail')[0];
    if (rl) { const dir = norm(sub(rl.b, rl.a)), side = [dir[2], 0, -dir[0]];
      shot({ at: 32, dur: 2, T0: rl.tt - 0.55, rate: 0.55, cam: dolly(add(add(rl.a, mul(dir, -34)), add(mul(side, 10), [0, 7, 0])), add(add(rl.a, mul(dir, -30)), add(mul(side, 9), [0, 6, 0])), add(rl.a, mul(dir, 120)), add(rl.a, mul(dir, 160)), 50),
        card: K('新兵种', '电磁炮', '一发蓝光，贯穿一整排'), cardAt: [0.1, 1.9] }); }
    // ⑫ 34–36 弹道导弹发射（慢动作，从车旁边往上看）
    const bl = evs('ballistic', e => e.tt > 2)[0] || evs('ballistic')[0];
    if (bl) shot({ at: 34, dur: 2, T0: bl.tt - 0.35, rate: 0.6, cam: dolly([bl.a[0] + 62, bl.a[1] + 8, bl.a[2] - 40], [bl.a[0] + 58, bl.a[1] + 10, bl.a[2] - 36], [bl.a[0], bl.a[1] + 12, bl.a[2] + 6], [bl.a[0], bl.a[1] + 70, bl.a[2] + 40], 56),
      card: K('新兵种', '弹道导弹', '专打敌人扎堆最密的地方'), cardAt: [0.1, 1.9] });
    // ⑬ 36–38 弹道导弹落地：大爆炸
    const bb = evs('bigboom')[0];
    if (bb) shot({ at: 36, dur: 2, T0: bb.tt - 0.7, rate: 0.9, cam: dolly([bb.p[0] + 150, 60, bb.p[2] - 170], [bb.p[0] + 130, 54, bb.p[2] - 150], [bb.p[0], 12, bb.p[2]], [bb.p[0], 30, bb.p[2]], 52) });
    // ⑭ 38–40 爱国者拦截弹道导弹
    const ab = evs('abm', e => !e.miss && e.tt > 10)[0] || evs('abm', e => !e.miss)[0];
    if (ab) { const tgt = fx().find(x => x.id === ab.id && x.k === 'ballistic'); const ip = tgt ? TR.projPos(tgt, ab.tt + 0.7 - tgt.tt) : add(ab.a, [0, 150, 0]);
      const lp = ab.a, hd = norm([ip[0] - lp[0], 0, ip[2] - lp[2]]), sd = [hd[2], 0, -hd[0]];
      const e0 = add(lp, add(mul(hd, -150), add(mul(sd, 40), [0, 30, 0]))), e1 = add(e0, add(mul(hd, 14), [0, 4, 0]));
      shot({ at: 38, dur: 2, T0: ab.tt - 0.35, rate: 0.75, cam: dolly(e0, e1, L3(lp, ip, 0.3), L3(lp, ip, 0.5), 58),
        card: K('反制', '爱国者拦截', '敌我都能拦下对方的导弹'), cardAt: [0.1, 1.9] }); }
    // ⑮ 40–44 大场面：高空慢慢绕着交火中心
    const mid = TR.battleCenter(26);
    shot({ at: 40, dur: 4, T0: 24, rate: 1, shadowR: 800, cam: u => { const a = lerp(-1.9, -1.35, sm(u)); return { eye: [mid[0] + Math.cos(a) * 330, 150 - 20 * u, mid[2] + Math.sin(a) * 330], at: [mid[0], 4, mid[2] + 20], fov: 46 }; },
      card: K('单位技能', '冲锋 · 烟幕 · 急速射', '观战时点开自己的单位，按 F 放技能'), cardAt: [0.3, 3.7] });
    // ⑯ 44–48 贴地跟着冲在最前面的车（交火最密的那 4 秒）
    const fl = busiest(9.5, 13.5), fp0 = at(fl, 9.5), fp1 = at(fl, 13.5);
    const ffw = len(sub(fp1, fp0)) > 5 ? norm([fp1[0] - fp0[0], 0, fp1[2] - fp0[2]]) : [0, 0, 1], frt = [ffw[2], 0, -ffw[0]];
    shot({ at: 44, dur: 4, T0: 9.5, rate: 1, cam: u => { const T = 9.5 + u * 4, p = at(fl, T);
      return { eye: add(p, add(mul(ffw, -48 + 8 * u), add(mul(frt, 22 - 6 * u), [0, 17 - 3 * u, 0]))), at: add(p, add(mul(ffw, 55), [0, 2, 0])), fov: 52 }; },
      card: K('真人对战', '排位匹配 · 跨服对战', '还能突袭别人存下的防线'), cardAt: [0.3, 3.7] });
    // ⑰ 48–52 高潮快切：四个大爆炸各一秒
    const gb = fx().filter(e => (e.k === 'boom' && (e.s || 1) >= 1.4 && e.p[1] < 8) || e.k === 'mineboom');
    const cl = [];
    for (const e of gb) {
      if (e.tt > 8 && e.tt < 12.5) continue;   // 敌机突袭那段已经用过
      // 一个镜头 1 秒、战斗时间走 0.85 秒：只数这段时间里落下的
      const near = gb.filter(q => q.tt >= e.tt && q.tt < e.tt + 0.8 && Math.hypot(q.p[0] - e.p[0], q.p[2] - e.p[2]) < 60);
      if (near.length >= 3) { const c = near.reduce((a, q) => add(a, mul(q.p, 1 / near.length)), [0, 0, 0]);
        const spread = Math.max(...near.map(q => Math.hypot(q.p[0] - c[0], q.p[2] - c[2]))); cl.push({ tt: e.tt, n: near.length, c, d: clamp(75 + spread * 1.6, 90, 140) }); }
    }
    cl.sort((a, b) => b.n - a.n);
    const picks = [];
    for (const c of cl) { if (picks.length >= 4) break; if (!picks.some(q => Math.abs(q.tt - c.tt) < 3)) picks.push(c); }
    picks.sort((a, b) => a.tt - b.tt);
    picks.forEach((e, i) => { const c = e.c, D = e.d, ang = clearAng(c, D, 30, i * 1.7 + 0.6); shot({ at: 48 + i, dur: 1, T0: e.tt - 0.12, rate: 0.85, flash: i > 0 ? 0.4 : 0,
      cam: dolly([c[0] + Math.cos(ang) * D, 30, c[2] + Math.sin(ang) * D], [c[0] + Math.cos(ang) * D * 0.9, 27, c[2] + Math.sin(ang) * D * 0.9], [c[0], 9, c[2]], [c[0], 13, c[2]], 50) }); });
    // ⑱ 52–56 胜利：摇臂升起来看我军
    const end = (TR.finish && TR.finish.t) || 50;
    const wc = TR.armyCenter(end - 1, 1);
    shot({ at: 52, dur: 4, T0: end - 2.5, rate: 0.8, cam: dolly([wc[0] + 20, 18, wc[2] - 90], [wc[0] + 10, 150, wc[2] - 230], [wc[0], 8, wc[2] + 60], [wc[0], 0, wc[2] + 160], 50),
      card: K('', '胜利！', (TR.start && TR.start.title ? TR.start.title.replace(/\s*·\s*/g, ' · ') : '第 27 关 · 雪原战区'), 'mid'), cardAt: [0.4, 3.7] });
    // ⑲ 56–64 片尾：基地上空慢慢飘，压暗，标志
    shot({ at: 56, dur: 8, T0: 0, rate: 0, units: true, dim: 0.5, fadeOut: 1.2, cam: dolly([-320, 260, -520], [-200, 230, -420], [0, 20, 80], [0, 20, 100], 44),
      card: K('MILITARY TYCOON', '军事大亨', '现已登陆 Roblox', 'logo'), cardAt: [0.6, 7.6] });
    SH.sort((a, b) => a.at - b.at);
    return SH.map(s => ({ at: s.at, dur: s.dur, T0: s.T0, rate: s.rate, card: s.card && s.card.t }));
  };

  // 画面上的字幕卡、闪白、黑场、压暗
  const $ = id => document.getElementById(id);
  const card = $('card'), cK = card.querySelector('.k'), cT = card.querySelector('.t'), cS = card.querySelector('.s');
  let lastCard = null;
  function overlay(s, u, tl) {
    const c = s.card;
    if (c) {
      if (lastCard !== c) { cK.textContent = c.k; cT.textContent = c.t; cS.textContent = c.s; card.className = 'card ' + c.pos; card.querySelector('.r').style.display = c.k || c.s ? '' : 'none'; lastCard = c; }
      const t0 = s.cardAt ? s.cardAt[0] : 0.2, t1 = s.cardAt ? s.cardAt[1] : s.dur - 0.2;
      const a = clamp((tl - t0) / 0.35, 0, 1) * clamp((t1 - tl) / 0.3, 0, 1);
      card.style.opacity = a;
      const k = easeOut(clamp((tl - t0) / 0.5, 0, 1));
      if (c.pos === 'left') card.style.transform = `translateX(${(1 - k) * -60}px)`;
      else if (c.pos === 'mid') card.style.transform = `scale(${1.25 - 0.25 * k})`;
      else card.style.transform = `scale(${1.08 - 0.08 * k})`;
    } else card.style.opacity = 0;
    let fade = 0;
    if (s.fadeIn) fade = Math.max(fade, 1 - clamp(tl / s.fadeIn, 0, 1));
    if (s.fadeOut) fade = Math.max(fade, clamp((tl - (s.dur - s.fadeOut)) / s.fadeOut, 0, 1));
    if (s.dim) fade = Math.max(fade, s.dim * clamp(tl / 1.2, 0, 1));
    $('fade').style.opacity = fade;
    const fa = s.flash === true ? 0.85 : (s.flash || 0);
    $('flash').style.opacity = fa ? Math.max(0, fa - tl / 0.16 * fa) : 0;
    $('bars').style.setProperty('--bar', (s.card && s.card.pos === 'logo') ? '0px' : '62px');
  }

  // 第 i 帧：找镜头 → 战斗时间 → 画 → 字幕；顺便记下这一帧新出现的特效（配乐里放声音用）
  TR.cues = [];
  let prevShot = null, prevT = 0;
  // dry：只算镜头和音效点、不画（配乐那一步单独跑一遍，几个进程分段渲染也不影响音效点）
  TR.frame = async function (i, dry) {
    const t = i / FPS;
    let s = SH[0];
    for (const x of SH) if (t >= x.at) s = x;
    const tl = t - s.at, u = clamp(tl / s.dur, 0, 1);
    const T = s.T0 + tl * s.rate;
    const c = s.cam(u, T);
    // 大爆炸震一下镜头
    let shake = 0;
    for (const e of TR.fx()) {
      if (e.tt > T) break;
      if ((e.k === 'boom' || e.k === 'bigboom' || e.k === 'mineboom') && T - e.tt < 0.5 && s.rate > 0) {
        const d = len(sub(e.p, c.eye)); const amp = (e.k === 'bigboom' ? 3 : (e.s || 1)) * (1 - (T - e.tt) / 0.5);
        if (d < 260) shake += amp * (260 - d) / 260 * 0.9;
      }
    }
    if (shake > 0) { const n = i * 1.37; c.eye = [c.eye[0] + (hash(n) - .5) * shake, c.eye[1] + (hash(n + 3) - .5) * shake, c.eye[2] + (hash(n + 7) - .5) * shake]; }
    if (!dry) { TR.render({ T, eye: c.eye, at: c.at, fov: c.fov, rise: s.rise ? s.rise(u) : null, units: s.units !== false, shadowR: s.shadowR }); overlay(s, u, tl); }
    const rt = norm(cross(norm(sub(c.at, c.eye)), [0, 1, 0]));
    // 音效点
    if (s !== prevShot) { TR.cues.push({ t, k: 'cut', big: !!s.flash, card: s.card ? s.card.t : null }); prevT = T - 1e-6; prevShot = s; }
    if (s.rate > 0) for (const e of TR.fx()) {
      if (e.tt > T) break;
      if (e.tt > prevT && e.tt <= T) {
        const p = e.p || e.a; if (!p) continue;
        const d = len(sub(p, c.eye));
        if (d < 900) TR.cues.push({ t, k: e.k, u: e.u, s: e.s, d: Math.round(d), x: Math.round(dot(sub(p, c.eye), rt)), slow: s.rate < 0.95 });
      }
    }
    prevT = T;
    if (!dry) await new Promise(r => requestAnimationFrame(() => r()));
    return { shot: SH.indexOf(s), T };
  };
  TR.sampleOf = (tr, T) => sample(tr, T) || { yaw: 0, pitch: 0 };
  TR.projPos = projPos;
  TR.battleCenter = T => { let sx = 0, sz = 0, n = 0; for (const tr of tracks()) { const s = sample(tr, T); if (s && !s.dead && !tr.def.jet) { sx += s.x; sz += s.z; n++; } } return n ? [sx / n, 0, sz / n] : [0, 0, 570]; };
  TR.armyCenter = (T, team) => { let sx = 0, sz = 0, n = 0; for (const tr of tracks()) { if (tr.team !== team) continue; const s = sample(tr, T); if (s && !s.dead && !tr.def.air) { sx += s.x; sz += s.z; n++; } } return n ? [sx / n, 0, sz / n] : [0, 0, 500]; };
})();
