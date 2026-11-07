// 宣传片（1080p，片长按分镜累加，约 78 秒）：跟着游戏自己的进行曲剪——固定 120 拍、一小节 2 秒，换幕和切镜头都在重拍上
//   用户：凸显各型装备建模、主画面里要有两军对抗、两边的体系化作战要凸显——
//   开场 低空掠海、舰队驶向雪山海岸 → 第一幕 体系破击（我方：预警机发现 → 电子战压制 → 火箭军打击；守方：雷达发现 → 爱国者拦截；
//   空战：歼-20 前出跟踪 → 数据链 → 歼-16 导弹卡车发射）→ 第二幕 强行登陆（抢滩、舰炮、守方炮火反击、滩头对射、堑壕）
//   → 第三幕 纵深攻防（坦克交战、炮兵、直升机、轰炸）→ 编辑器、图鉴、部署 → 高潮 → 片尾标志（胜利号角）
//   画面上：杀伤链字幕条（发现 → 引导 → 打击 → 毁伤，攻方绿、守方红）、装备名牌；两军都画（R.eye = 'all'：游戏平时只画侦察到的敌人）
// 地图：台湾东海岸雪山图（用户选的）。这张图的地形来自 Miguel Cueva 的「Taiwan (East coast)」（CC BY-NC-SA 4.0）——
//   用了它的这一版只能非商用：片尾署名、注明本片按 CC BY-NC-SA 4.0 发布，不写上架平台（商店素材 store_assets.js 仍用程序生成的地图）
// 画面：同一局（固定地图与随机数）逐帧推演、逐帧截图。推演和画面的随机数分开存：画画用掉的随机数不影响战局，
//   所以先不画画「侦察」一遍，记下每一发导弹（谁、从哪、打什么、结局）、每一发车炮、每一处爆炸、部队在哪；
//   分镜里写的是「找哪种事件」（q），按侦察记录定开拍时刻和要跟的导弹 / 车辆编号——正式渲染时同一局再推一遍，编号、时刻都对得上
// 声音：渲染时让游戏自己的音效系统按每一帧的镜头判断该响什么（声像、远近），只记下来；录音时按剪辑时间线回放，叠在进行曲上
// 用法：NODE_PATH=$(npm root -g) node tools/trailer.js [输出目录，默认 store/video] [步骤，默认 shots,audio,edit；另有 scout、plan]
//   需要 Playwright 与 ffmpeg；没有显卡的机器上要几个小时（逐帧渲染占大半）；输出 trailer_1080p.mp4（不进仓库）
//   plan：只侦察并列出每个镜头定下的时刻与对象（不渲染）
//   调试：ONLY=A,B 只渲染这几个镜头，FROM=30 FRAMES=8 每个镜头只渲染从第 30 帧起的 8 帧（不推演跳过的帧），SCOUT=reuse 用上次的侦察结果；W=1280 H=720 改分辨率
//   每个镜头渲染完就存 <镜头>.mp4 和它的音效记录 <镜头>.sfx.json：SKIP=1 跳过两样都有的镜头（中断了接着渲）；
//   SFXONLY=1 只走一遍记音效、不截图（镜头的视频已经有了；可以用小窗口跑：W=640 H=360，声像按画面比例算，和 1080p 一样）；
//   没有显卡时可以开两个进程分头渲（ONLY 各给一半、输出目录分开），最后把 trailer_shots 里的文件拷到一起再跑 audio,edit
//   RS=0.6667：游戏画布（3D、地形、标号）按这个比例的分辨率渲、浏览器放大，字幕卡、编辑器等界面照样按 1080p——软件渲染时省一半时间
'use strict';
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const { ROOT, LAUNCH, sleep, boot, battle, serve } = require('./store_assets.js');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'store', 'video'));
const STEPS = (process.argv[3] || 'shots,audio,edit').split(',');
const FPS = 30, PRE = 1, MAP = 'tw', SCOUT_END = 1500;   // 帧率、录音提前 1 秒开录（前面放一声对齐用的哔）、地图、侦察推演到第几秒
const SHOT_DIR = path.join(OUT, 'trailer_shots'), SFX = path.join(OUT, 'trailer_sfx.json');
const lerp = (a, b, u) => a + (b - a) * u, ease = u => u * u * (3 - 2 * u), clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// —— 杀伤链（体系作战）：画面下方一条，从发现到毁伤逐节点亮起；同一条链跨几个镜头，i 是这个镜头亮到第几节 ——
const CHAINS = {
  p1: { side: 'p', hd: 'KILL CHAIN // 攻方 · 联合火力打击', n: ['空警-600 预警探测', '东风-17 高超音速突防', '摧毁爱国者阵地'] },
  e1: { side: 'e', hd: 'KILL CHAIN // 守方 · 一体化防空反导', n: ['哨兵雷达 发现来袭', '爱国者 齐射拦截', '拦截弹爬升'] },
  p4: { side: 'p', hd: 'KILL CHAIN // 攻方 · 舰载机突击', n: ['福建舰 电磁弹射', '飞腾-8 精确制导', '摧毁岸防工事'] },
  p5: { side: 'p', hd: 'KILL CHAIN // 攻方 · 舰载远程火力', n: ['空警-600 指示目标', '055 长剑-10 齐射', '纵深打击'] },
  e2: { side: 'e', hd: 'KILL CHAIN // 守方 · 野战防空', n: ['雷达 发现来袭', '防空车 拦截', '空中拦截'] }
};
// —— 分镜 ——
//   at（片中起点）按数组顺序累加；dur 时长。推演里的开拍时刻：T 写死，或 q 按侦察记录找事件（L 发射、X 导弹结束、V 车炮对射、C 航母弹射、P 某型飞机在空中；
//   F 步兵、工事对射；cont 紧接上一个镜头、X: 'prev' 上一个镜头那一发命中前），lead 提前几秒开拍
//   spd 每帧推演几步（1 = 真实速度，默认 2）；rig 镜头：
//     chase 跟在对象后面（o 对象、d 距离、yo 相对航向的方位、pit 俯角，[起, 止] 之间缓动）· look 镜头钉在 at 附近（off [前, 右, 上]）一直看着对象 ·
//     two 两军同框：A 在前景、B 在远处（镜头在 A 身后、B→A 的延长线转 yo，看向 A 与 B 之间 f 处）· orbit 绕对象转 · pt 固定的点按 [距离, 方位, 俯角] 起止缓动
//     对象：['pl', 编号] 我机 · ['ea', 编号] 敌机 · ['m', 编号] 导弹 · ['v', 编号] 车辆 · ['e', 编号] 工事 · ['s', 编号] 舰船 · ['dd'] 驱逐舰 · ['cv'] 航母 · ['xy', x, y, z]；
//     'M' / 'SRC' / 'IMP' / 'A' / 'B' 由 q 找到的事件填上（导弹、发射点、落点、射手、目标）
//   旧的取景 tg：fleet 舰队、cv 航母、ships 舰艇最密的一群、land 登陆部队最密处、boom 本镜头时段里炸得最集中处、landing 部队刚上岸的地方、trench 堑壕；
//   fov 视场角倍数（< 1 长焦）；chain 杀伤链 [链, 第几节]；tag 装备名牌 [名称, 说明, 攻方 p / 守方 e]；card 字幕卡；flash 开头一闪（换幕，配乐重击）；fire 真实爆炸放大一些、隔几帧在旁边再炸一团（S.fx 只是画面）
const C = (kick, title, sub, at, out, pos) => ({ kick, title, sub, at, out, pos: pos || 'left' });
const SHOTS = [
  { id: 'A', dur: 6, T: 20, tg: 'fleet', ahead: 700, cam: [[2700, -1.36, -0.045], [2000, -1.30, -0.07]], card: C('DARKSWORD // JOINT AMPHIBIOUS WARFARE', '体系对体系的登陆战', '海 · 空 · 天 · 电 · 陆　实时推演', 1.2, 5.3), fadeIn: .9 },
  // 第一幕：体系破击——守方爱国者齐射拦截 → 东风-17 突防摧毁爱国者阵地 → 055 垂发 → 歼-16D 反辐射压制 → 舰载机弹射、精确制导炸弹 → 歼-20 掌握制空权
  { id: 'B1', warm: 14, dur: 4, q: { P: { k: ['kj600'], after: 60 } }, rig: { k: 'chase', o: 'A', d: [95, 62], yo: [2.3, 1.8], pit: [-0.10, -0.05] }, chain: ['p1', 0], tag: ['空警-600', '舰载预警机 · 远在视距外发现目标', 'p'], card: C('PHASE 01 // SYSTEM STRIKE', '先打体系', '预警 · 电子战 · 火箭军 · 联合火力', .1, 1.9), flash: true },   // 字幕卡下去以后才出杀伤链、名牌
  { id: 'B5', dur: 2, spd: 1, q: { L: { side: 'e', kind: 'sam', src: 'samv', tg: 'msl', dense: true }, lead: 0.5 }, rig: { k: 'pt', o: 'SRC', cam: [[220, -2.3, -0.2], [190, -2.15, -0.17]], tz: 25 }, fov: .85, chain: ['e1', 1], tag: ['爱国者 PAC-3', '哨兵雷达引导 · 四弹齐射拦截来袭弹道导弹', 'e'] },
  { id: 'B6', dur: 2, spd: 1, q: { cont: true }, rig: { k: 'chase', o: 'M', d: [110, 150], yo: [1.35, 1.2], pit: [-0.08, -0.04] }, chain: ['e1', 2] },   // 侧面跟拍：烟迹在旁边，不挡镜头
  { id: 'B3', dur: 2, spd: 1, q: { X: { kind: 'tbm', w: 'df17' }, lead: 2 }, rig: { k: 'look', o: 'M', at: 'IMP', off: [-760, 380, 140], abs: true }, chain: ['p1', 1], tag: ['东风-17', '高超音速滑翔弹头 · 机动突防', 'p'] },
  { id: 'B4', dur: 2, spd: 1, q: { cont: true }, rig: { k: 'pt', o: 'IMP', cam: [[270, -1.9, -0.20], [230, -1.75, -0.18]] }, fire: true, chain: ['p1', 2] },
  { id: 'BY', warm: 14, dur: 2, spd: 1, q: { L: { side: 'p', kind: 'pgm', w: 'yj18' }, lead: 0.5 }, rig: { k: 'look', o: 'M', at: 'SRC', off: [95, 62, 9], abs: true }, fov: .8, tag: ['055 型驱逐舰', '垂直发射 · 鹰击-18 打击岸上目标', 'p'] },
  { id: 'BL', warm: 14, dur: 2, spd: 1, q: { L: { side: 'p', kind: 'pgm', w: 'ld10' }, lead: 0.5 }, rig: { k: 'chase', o: 'SRCP', d: [46, 40], yo: [1.25, 1.0], pit: [-0.02, 0.02] }, tag: ['歼-16D', '电子侦察测出雷达 · 雷电-10 反辐射导弹', 'p'] },
  { id: 'BC', warm: 14, dur: 2, spd: 1, q: { C: { k: ['j35', 'j15'] }, lead: 0.6 }, rig: { k: 'look', o: 'A', at: 'A', off: [48, -17, 5] }, chain: ['p4', 0], tag: ['福建舰 · 歼-35', '电磁弹射 · 舰载隐身战斗机出击', 'p'] },
  { id: 'BF', warm: 14, dur: 2, spd: 1, q: { L: { side: 'p', kind: 'pgm', w: 'ft8' }, lead: 0.5 }, rig: { k: 'chase', o: 'SRCP', d: [40, 36], yo: [1.35, 1.15], pit: [0.06, 0.08] }, chain: ['p4', 1] },
  { id: 'BG', dur: 2, spd: 1, q: { cont: true }, rig: { k: 'pt', o: 'IMP', cam: [[330, -2.0, -0.26], [280, -1.8, -0.23]] }, fire: true, chain: ['p4', 2] },
  { id: 'B7', warm: 14, dur: 2, cone: 326, q: { P: { k: ['j20'] } }, rig: { k: 'chase', o: 'A', d: [46, 34], yo: [0.6, 0.3], pit: [-0.12, -0.08] }, tag: ['歼-20', '隐身战斗机 · 夺取制空权', 'p'] },
  // 第二幕：强行登陆——抢滩、壕里的守军、步兵与工事对射、坦克对坦克、守方反坦克车打登陆舰
  { id: 'F', dur: 4, q: { T: 'landing', lead: 26 }, rig: { k: 'chase', o: 'SHIP', d: [120, 85], yo: [0.6, 0.35], pit: [-0.12, -0.09] }, card: C('PHASE 02 // ASSAULT', '再强行登陆', '抢滩 · 舰炮火力 · 夺取登陆场', .15, 3.7), flash: true },
  { id: 'I', dur: 4, q: { T: 'landing', lead: -50 }, tg: 'trench', cam: [[115, -1.3, -0.40], [80, -1.05, -0.34]] },
  { id: 'I2', dur: 4, q: { F: { after: 0 } }, rig: { k: 'two', o: 'A', b: 'B', d: [62, 50], yo: [0.35, 0.22], pit: [-0.16, -0.12], f: .5 }, fov: .75 },   // 步兵与工事对射：攻方在前景，守方阵地在远处
  { id: 'G', dur: 4, q: { F: { after: 120, bunker: true } }, rig: { k: 'two', o: 'A', b: 'B', d: [70, 56], yo: [0.45, 0.3], pit: [-0.2, -0.16], f: .55 }, fov: .75, tag: ['登陆突击队', '步兵冲击守方火力点', 'p'] },   // 坦克对射那一段双方都放了烟幕、看不清：改拍步兵冲击工事（B 换成离攻方最近的守方工事）
  { id: 'H', warm: 14, dur: 4, T: 850, pick: [['ftr', 'F-35A 闪电 II', '守方战斗机 · 争夺登陆场上空的制空权'], ['ftrb', 'F-35B 闪电 II', '守方短距起降战斗机 · 争夺制空权'], ['c17', 'C-17 运输机', '守方 · 空运增援']], rig: { k: 'chase', o: null, d: [62, 48], yo: [2.5, 2.2], pit: [-0.06, -0.03] } },   // 守方装备：开拍时挑一架在空中的 F-35（没有就 C-17），从前侧方回看
  // 第三幕：纵深攻防——055 长剑-10 齐射；守方防空车拦截鹰击-18、击落我方飞机；步兵与工事对射；战区逐级指挥
  { id: 'J', dur: 4, spd: 1, q: { L: { side: 'p', kind: 'pgm', w: 'cj10', src: 'vls', dense: true }, after: 1100, lead: 1.2 }, rig: { k: 'look', o: 'SRC', at: 'SRC', off: [105, 75, 10], tz: 34, abs: true }, fov: .8, chain: ['p5', 1], card: C('PHASE 03 // DEPTH', '向纵深推进', '战区 → 师 → 团 → 营　逐级指挥', .15, 2.6), flash: true },
  { id: 'J2', dur: 2, spd: 1, q: { X: 'prev', lead: 1.4 }, rig: { k: 'look', o: 'M', at: 'IMP', off: [-380, 300, 90], abs: true }, fire: true, chain: ['p5', 2] },
  { id: 'JE1', dur: 2, spd: 1, q: { L: { side: 'e', kind: 'sam', src: 'samv', tg: 'msl', out: 'kill' }, after: 1100, lead: 1.2 }, rig: { k: 'look', o: 'TGT', at: 'SRC', off: [-70, -45, 7], abs: true }, chain: ['e2', 1], tag: ['@SRC', '野战防空 · 拦截来袭的鹰击-18', 'e'] },   // 从发射车身后看向来袭的鹰击-18：来袭弹、拦截弹、空中爆炸都在画面里
  { id: 'JE2', dur: 2, spd: 1, q: { L: { side: 'e', kind: 'sam', src: 'samv', tg: 'msl', out: 'kill' }, after: 1121, lead: 0.8 }, rig: { k: 'chase', o: 'TGT', d: [34, 42], yo: [0.28, 0.18], pit: [-0.12, -0.09] }, chain: ['e2', 2] },   // 跟在来袭的鹰击-18 后面：前方是防空阵地，拦截弹迎面打上来
  { id: 'JA', warm: 14, dur: 2, spd: 1, q: { L: { side: 'e', kind: 'sam', src: 'samv', tg: 'plane', out: 'kill' }, lead: 0.8 }, rig: { k: 'chase', o: 'TGT', d: [60, 80], yo: [0.7, 0.5], pit: [-0.16, -0.12] }, tag: ['@SRC', '击落低空突防的我方飞机', 'e'] },   // 跟着被打的那架飞机：防空导弹从下面打上来
  { id: 'I3', dur: 4, q: { F: { after: 450 } }, rig: { k: 'two', o: 'A', b: 'B', d: [80, 60], yo: [-0.4, -0.25], pit: [-0.14, -0.1], f: .5 }, fov: .75 },
  { id: 'K', dur: 4, q: { T: 'landing', lead: -360 }, tg: 'land', hud: true, cam: [[5200, -1.5708, -1.02], [4200, -1.5708, -0.88]] },
  // 编辑器、内容一览：最后拍（编辑器只是盖在上面；部署会换掉战局，放最后）
  { id: 'L', dur: 4, ui: 'eanim', card: C('EDITOR // DESIGN ANYTHING', '想怎么设计就怎么设计', '参数 · 模型 · 部件 · 局部动画 · 特效', .2, 3.8, 'low') },
  { id: 'M1', dur: 4 / 3, ui: 'codex', card: C('ORDER OF BATTLE', '一百多种兵力', '', .05, 1.3, 'low') },
  { id: 'M2', dur: 4 / 3, ui: 'etrail', card: C('MISSILE TRAILS', '尾烟、尾焰自己设计', '', .05, 1.3, 'low') },
  { id: 'M3', dur: 4 / 3, ui: 'deploy', card: C('SANDBOX', '自由部署 · 攻守对抗', '', .05, 1.3, 'low') },
  { id: 'N', dur: 4, q: { T: 'landing', lead: -620 }, tg: 'boom', fire: true, cam: [[650, -1.5708, -0.30], [520, -1.5708, -0.27]], fov: .8, flash: true, booms: [0, .5, 1, 1.5, 2, 2.25, 2.5, 2.75, 3, 3.25, 3.5] },
  { id: 'O', dur: 8, q: { T: 'landing', lead: -628 }, tg: 'land', end: true }
];
{ let t = 0; SHOTS.forEach((s, i) => { s.at = t; t += s.dur; const P = SHOTS[i - 1], N = SHOTS[i + 1], k = s.chain && s.chain[0]; if (k) { s.chF = !(P && P.chain && P.chain[0] === k); s.chL = !(N && N.chain && N.chain[0] === k); } }); }   // chF / chL：这条链在这个镜头淡入 / 淡出
const LEN = Math.round(SHOTS.reduce((a, s) => a + s.dur, 0));
const SIDE_C = { p: '61, 255, 138', e: '255, 96, 72' };

// 页面里的字幕卡、杀伤链、装备名牌、遮罩、闪白（游戏开始界面的字体与辉光；字先乱码再定格，和开始界面的解码效果一样）
const OVERLAY_CSS = `
#trShade, #trFlash { position: fixed; inset: 0; z-index: 98; pointer-events: none; opacity: 0; }
#trFlash { z-index: 99; background: #e8fff0; }
#trCard { position: fixed; z-index: 100; pointer-events: none; color: #3dff8a; opacity: 0; }
#trCard .k { font: 15px "Silkscreen", monospace; letter-spacing: .5em; color: rgba(198, 247, 216, .82); }
#trCard .t { font: 700 66px/1.15 "Noto Sans SC", sans-serif; letter-spacing: .12em; margin-top: 12px; white-space: nowrap;
  text-shadow: 0 0 20px rgba(61, 255, 138, .6), 0 0 2px rgba(216, 255, 232, .85); }
#trCard .r { height: 2px; margin-top: 16px; background: linear-gradient(90deg, #3dff8a, rgba(61, 255, 138, 0)); box-shadow: 0 0 10px #3dff8a; }
#trCard .s { font: 400 24px "Noto Sans SC", sans-serif; letter-spacing: .22em; color: rgba(214, 255, 228, .9); margin-top: 16px; white-space: nowrap; }
#trCard.logo { left: 50% !important; top: 47% !important; text-align: center; display: flex; flex-direction: column; align-items: center; }
#trCard.logo .t { order: 1; } #trCard.logo .k { order: 2; margin-top: 18px; } #trCard.logo .r { order: 3; } #trCard.logo .s { order: 4; }
#trCard.logo .t { font-size: 150px; letter-spacing: .16em; margin-right: -.16em; }
#trCard.logo .k { font-size: 30px; letter-spacing: .62em; margin-right: -.62em; color: rgba(214, 255, 228, .9); }
#trCard.logo .r { margin: 22px auto 0; background: linear-gradient(90deg, rgba(61, 255, 138, 0), #3dff8a, rgba(61, 255, 138, 0)); }
#trCard.logo .s { font-size: 28px; letter-spacing: .4em; margin-right: -.4em; margin-top: 30px; }
#trCred { position: fixed; z-index: 100; left: 0; right: 0; bottom: 5%; text-align: center; pointer-events: none; opacity: 0; font: 400 13px/1.9 "Noto Sans SC", sans-serif; letter-spacing: .06em; color: rgba(214, 255, 228, .6); white-space: nowrap; }
#trChain { position: fixed; z-index: 100; left: 7vw; bottom: 8.5%; pointer-events: none; opacity: 0; --c: 61, 255, 138; }
#trChain .hd { font: 14px "Silkscreen", monospace; letter-spacing: .4em; color: rgba(var(--c), .95); margin-bottom: 12px; text-shadow: 0 0 10px rgba(var(--c), .5); }
#trChain .row { display: flex; align-items: center; }
#trChain .n { font: 400 21px "Noto Sans SC", sans-serif; letter-spacing: .08em; padding: 9px 16px; border: 1px solid rgba(var(--c), .3); background: rgba(2, 8, 5, .6); color: rgba(220, 235, 225, .4); white-space: nowrap; }
#trChain .n.on { color: #f4fff8; border-color: rgba(var(--c), .9); box-shadow: 0 0 16px rgba(var(--c), .35), inset 0 0 10px rgba(var(--c), .15); }
#trChain .n.cur { background: rgba(var(--c), .22); box-shadow: 0 0 26px rgba(var(--c), .6), inset 0 0 14px rgba(var(--c), .3); }
#trChain .a { position: relative; width: 46px; height: 2px; background: rgba(var(--c), .22); }
#trChain .a i { position: absolute; left: 0; top: 0; bottom: 0; background: rgb(var(--c)); box-shadow: 0 0 8px rgb(var(--c)); }
#trChain .a b { position: absolute; right: -3px; top: -5px; border: 6px solid transparent; border-left: 8px solid rgba(var(--c), .75); border-right: 0; }
#trTag { position: fixed; z-index: 100; left: 7vw; top: 10%; pointer-events: none; opacity: 0; --c: 61, 255, 138; }
#trTag .sd { font: 13px "Silkscreen", monospace; letter-spacing: .45em; color: rgba(var(--c), .95); text-shadow: 0 0 8px rgba(var(--c), .6); }
#trTag .nm { font: 700 46px/1.15 "Noto Sans SC", sans-serif; letter-spacing: .1em; color: #f2fff6; margin-top: 8px; padding-left: 14px; border-left: 4px solid rgb(var(--c)); text-shadow: 0 0 16px rgba(var(--c), .5), 0 2px 6px rgba(0, 0, 0, .6); white-space: nowrap; }
#trTag .sb { font: 400 20px "Noto Sans SC", sans-serif; letter-spacing: .16em; color: rgba(228, 242, 233, .9); margin-top: 8px; padding-left: 18px; text-shadow: 0 1px 4px rgba(0, 0, 0, .8); white-space: nowrap; }
body.trChat #chat { box-shadow: 0 0 0 2px #3dff8a, 0 0 32px rgba(61, 255, 138, .55) !important; }
body.trClean > :not(#stage):not(#trShade):not(#trFlash):not(#trCard):not(#trChain):not(#trTag):not(#trCred):not(script):not(style), body.trClean #stage > :not(#cv):not(#cv3):not(#cvt) { visibility: hidden !important; }
#pauseBand { display: none !important; }`;
function overlayState(sh, t) {   // 本镜头第 t 秒的字幕卡、杀伤链、名牌、遮罩、闪白、黑场
  const st = { flash: 0, black: 0, shade: 0, card: null, chain: null, tag: null, cred: 0 };
  if (sh.flash) st.flash = [.6, .32, .12][Math.round(t * FPS)] || 0;
  if (sh.fadeIn) st.black = clamp(1 - t / sh.fadeIn, 0, 1);
  const c = sh.card;
  if (c) {
    const a = clamp((t - c.at) / .3, 0, 1) * clamp((c.out - t) / .3, 0, 1);
    if (a > 0) st.card = { ...c, a, rev: clamp((t - c.at) / .55, 0, 1), rule: ease(clamp((t - c.at - .1) / .5, 0, 1)), slide: (1 - ease(clamp((t - c.at) / .4, 0, 1))) * -24 };
    st.shade = c.pos === 'left' ? a * .9 : c.pos === 'low' ? a * .8 : a * .55;
  }
  if (sh.chain) {   // 杀伤链：这一节在镜头开头亮起（前一节到这一节的箭头先走满）；链的头一节淡入、最后一节淡出
    const [k, i] = sh.chain, CH = CHAINS[k];
    const a = (sh.chF && !sh.card ? clamp(t / .25, 0, 1) : 1) * (sh.chL ? clamp((sh.dur - t) / .3, 0, 1) : 1) * (sh.card ? clamp((t - c.out) / .25, 0, 1) : 1);
    st.chain = { k, i, side: CH.side, hd: CH.hd, n: CH.n, a, fill: ease(clamp(t / .3, 0, 1)), pulse: .5 + .5 * Math.cos(t * 7) };
    st.shade = Math.max(st.shade, a * .42);
  }
  if (sh.tag) {
    const a = clamp((t - .12) / .3, 0, 1) * clamp((sh.dur - .15 - t) / .25, 0, 1) * (sh.card ? clamp((t - c.out) / .25, 0, 1) : 1);
    st.tag = { nm: sh.tag[0], sb: sh.tag[1], side: sh.tag[2], a, rev: clamp((t - .12) / .45, 0, 1), slide: (1 - ease(clamp((t - .12) / .4, 0, 1))) * -20 };
  }
  if (sh.end) {   // 片尾：镜头拉远到整段雪山海岸，压暗，标志解码出现，再出副题与署名，最后黑场
    st.shade = .82 * ease(clamp((t - 1.4) / 1.6, 0, 1));
    if (t > 2) st.card = { pos: 'logo', kick: 'DARKSWORD', title: '暗剑', sub: t > 3.4 ? '体系对抗 · 两栖登陆' : '', a: clamp((t - 2) / .4, 0, 1), rev: clamp((t - 2) / .8, 0, 1), rule: ease(clamp((t - 2.4) / .7, 0, 1)), slide: 0, subA: clamp((t - 3.4) / .5, 0, 1) };
    st.cred = clamp((t - 3.8) / .6, 0, 1);
    st.black = clamp((t - 7.1) / .9, 0, 1);
  }
  return st;
}

// —— 侦察：不画画推演一遍，记下每一发导弹、车炮、爆炸，以及登陆部队、舰队、航母的位置 ——
//   事件：['L', 时刻, 导弹号, 类, 侧, 型号, 来源, x0, y0, tx, ty, 目标] 发射 · ['X', 时刻, 导弹号, 结局, x, y] 结束 ·
//   ['V', 时刻, 侧, 射手号, 目标号, x0, y0, x1, y1, 目标类, 射手车种, 射手型号] 车炮 · ['B', 时刻, x, y, r] 爆炸
//   ['A', 时刻, 导弹号, 飞机侧, 飞机号, 机型] 空射导弹出自哪架飞机（airmdl.js 的离机记录）· ['C', 时刻, 飞机号, 机型] 航母弹射起飞 · ['T', 时刻, 侧, x0, y0, x1, y1] 曳光（步兵、工事对射）
async function scout(b) {
  const p = await boot(b, 1280, 720);
  await p.evaluate(PAGE_FNS);
  await battle(p, 0, MAP);
  await p.evaluate(() => { window.requestAnimationFrame = () => 0; R.eye = 'all'; }); await sleep(1500);   // 已排上的那一帧跑完（暂停中，不推演）
  const r = await p.evaluate(last => {
    __seed(13);   // 渲染时推演也从这个随机数开始：两遍战局一模一样
    const samp = [], ev = [], seenM = new Map(), seenS = new WeakSet(), seenB = new WeakSet(), seenC = new WeakSet(), seenT = new WeakSet(), avg = A => A.length ? [A.reduce((a, q) => a + q.x, 0) / A.length, A.reduce((a, q) => a + q.y, 0) / A.length] : null;
    let i = 0, landT = null;
    while (S.t < last && !S.over) {
      step(1 / 30); i++;
      const t = +S.t.toFixed(3), now = new Set();
      for (const m of S.missiles || []) {
        now.add(m.id);
        if (!seenM.has(m.id)) { seenM.set(m.id, {}); ev.push(['L', t, m.id, m.kind, m.side, m.rf || m.w || '', typeof m.src === 'object' && m.src ? String(m.src.id ?? '') : String(m.src ?? ''), Math.round(m.x0), Math.round(m.y0), Math.round(m.tx), Math.round(m.ty), m.tgt ? (m.tgt.k || '') + ':' + (m.tgt.id ?? '') : '']); }
        const s = seenM.get(m.id); s.icp = m.icp; s.ph = m.ph; s.x = Math.round(m.x); s.y = Math.round(m.y); s.tg = m.tgt;
        if (!s.a && m.t >= 0 && typeof AIRV === 'object' && AIRV.mv) { if (typeof airRelScan === 'function') airRelScan(); const rr = AIRV.mv.get(m.id); if (rr) { s.a = 1; const L = rr.side === 'p' ? S.planes || [] : (S.eair && S.eair.fly) || [], o = L.find(q => q.id === rr.id); ev.push(['A', t, m.id, rr.side, rr.id, o ? (rr.side === 'p' ? airSilKey(o.kind, o.v) : o.type) : '']); } }
      }
      for (const [id, s] of seenM) if (!now.has(id) && !s.end) {   // 结局：被拦截 icp · 目标没了（飞机击落、来袭弹被拦下）kill · 目标还在 miss · 打地面的 hit
        s.end = 1;
        const g = s.tg, gone = !g ? null : g.k === 'eair' ? !((S.eair && S.eair.fly) || []).some(a => a.id === g.id && !a.dead) : g.k === 'plane' ? !(S.planes || []).some(p => p.id === g.id && !p.dead) : g.k === 'msl' ? !(S.missiles || []).some(q => q.id === g.id && !q.done) : null;
        ev.push(['X', t, id, s.icp ? 'icp' : gone === true ? 'kill' : gone === false ? 'miss' : s.ph === 'wait' ? 'wait' : 'hit', s.x, s.y]);
      }
      for (const p of S.planes || []) if (p.phase === 'roll' && !seenC.has(p)) { seenC.add(p); ev.push(['C', t, p.id, airSilKey(p.kind, p.v)]); }   // 弹射起飞（航母弹射器上的滑跑）
      for (const s of S.vshots || []) if (!seenS.has(s)) { seenS.add(s); if (s.k !== 'flame') { const v = (S.veh || []).find(o => o.id === s.src); ev.push(['V', t, s.side, s.src, s.tg, Math.round(s.x0), Math.round(s.y0), Math.round(s.x1), Math.round(s.y1), s.tk || '', v ? v.type : '', v ? vehModel(v) : '']); } }
      for (const f of S.fx) if (f.kind === 'boom' && !seenB.has(f)) { seenB.add(f); ev.push(['B', t, Math.round(f.x), Math.round(f.y), Math.round(f.r)]); }
      if (landT != null) for (const r of S.tracers) if (!seenT.has(r)) { seenT.add(r); if (!r.fuzzy && !r.cw) ev.push(['T', t, r.side, Math.round(r.x0), Math.round(r.y0), Math.round(r.x1), Math.round(r.y1)]); }   // 曳光（上岸以后；看不见射手的模糊弹道画面上不画，不记）
      if (landT == null && S.teams.some(q => q.side === 'p' && q.men.length && isLand(q.x, q.y))) landT = t;   // 第一组人上岸
      if (i % 15 === 0) samp.push({ t: S.t, land: window.__land(), fleet: avg(S.ships.filter(s => !s.dead)), cv: S.cv && !S.cv.dead ? [S.cv.x, S.cv.y] : null,
        pl: (S.planes || []).filter(p => !p.dead && p.phase === 'out' && (p.alt ?? 1) > .12).map(p => airSilKey(p.kind, p.v)) });
    }
    return { samp, ev, landT };
  }, SCOUT_END);
  await p.close();
  return r;
}
async function scoutSaved(b) {
  console.log('侦察推演…');
  const sc = await scout(b);
  fs.writeFileSync(path.join(OUT, 'trailer_scout.json'), JSON.stringify(sc));
  console.log(`第一组人上岸：第 ${sc.landT} 秒；事件 ${sc.ev.length} 条`);
  for (let t = 0; t < sc.samp[sc.samp.length - 1].t; t += 30) {   // 每 30 秒：导弹、车炮、爆炸数、登陆部队位置——选镜头时间时看
    const E = sc.ev.filter(q => q[1] >= t && q[1] < t + 30), s = sc.samp.find(q => q.t >= t + 29.9), n = k => E.filter(q => q[0] === k).length;
    console.log(`${String(t).padStart(4)}–${t + 30} 秒：导弹 ${n('L')}，车炮 ${n('V')}，爆炸 ${n('B')}；空中 ${s ? s.pl.join(',') : '-'}；登陆部队 ${s && s.land ? s.land.map(Math.round) : '-'}`);
  }
  return sc;
}

// —— 按侦察记录定下每个镜头的开拍时刻和对象 ——
//   推演只能往前走、各镜头在推演里的时段不能重叠；剪辑顺序（分镜顺序）和推演顺序可以不同：按分镜顺序逐个找「时段还空着的、最早的那一次」
function planShots(sc) {
  const ev = sc.ev, X = new Map(ev.filter(e => e[0] === 'X').map(e => [e[2], e])), A = new Map(ev.filter(e => e[0] === 'A').map(e => [e[2], e]));
  const has = (v, x) => v == null || [].concat(v).includes(x);
  const okL = (e, L) => e[0] === 'L' && has(L.side, e[4]) && has(L.kind, e[3]) && has(L.w, e[5]) && has(L.src, e[6]) && (!L.tg || String(e[11]).startsWith(L.tg));
  const outOf = e => { const x = X.get(e[2]); return x ? x[3] : 'live'; };
  const landT = sc.landT ?? 300, placed = [], plan = [], tEnd = sc.samp.length ? sc.samp[sc.samp.length - 1].t : SCOUT_END;
  const free = (T, span) => T >= 0 && T + span <= tEnd && placed.every(([a, b]) => T + span <= a + 1e-6 || T >= b - 1e-6);
  const TGK = { msl: 'm', plane: 'pl', eair: 'ea', veh: 'v', enemy: 'e' };
  const refOf = e => { const x = X.get(e[2]), r = { M: ['m', e[2]], SRC: ['xy', e[7], e[8]], IMP: x ? ['xy', x[4], x[5]] : ['xy', e[9], e[10]] }, [tk, tid] = String(e[11]).split(':');
    if (TGK[tk] && tid !== '' && tid != null) r.TGT = [TGK[tk], +tid];   // 导弹打的目标：来袭弹、飞机、车辆、工事
    if (A.get(e[2])) r.SRCP = [A.get(e[2])[3] === 'p' ? 'pl' : 'ea', A.get(e[2])[4]]; return r; };
  // 先定时刻写死的（T、按上岸时刻算的），再按分镜顺序找其余的；prev 是分镜里的上一个镜头（cont 紧接着换个机位拍、X: 'prev' 跳到那一发命中前）
  const sim = SHOTS.filter(o => !o.ui), fixedT = s => (s.T != null && !s.q) || (s.q && s.q.T === 'landing'), res = new Map();
  for (const s of [...sim.filter(fixedT), ...sim.filter(o => !fixedT(o))]) {
    const prev = res.get((sim[sim.indexOf(s) - 1] || {}).id) || null;
    const q = s.q || {}, spd = s.spd || 2, span = s.dur * spd, lead = q.lead != null ? q.lead : 1;
    let T = null, ref = {}, hit = null;
    const fail = why => { throw new Error(`镜头 ${s.id}：${why}（${JSON.stringify(q)}）`); };
    if (s.T != null && !s.q) T = s.T;
    else if (q.cont) { if (!prev) fail('上一个镜头还没定下来'); T = prev.T + prev.span; ref = prev.ref; hit = prev.e; }
    else if (q.X === 'prev') { const e = prev && prev.e, x = e && X.get(e[2]); if (!x) fail('上一个镜头没有导弹可接'); T = Math.max(x[1] - lead, prev.T + prev.span); ref = { ...prev.ref, IMP: ['xy', x[4], x[5]] }; hit = e; }
    else if (q.T === 'landing') T = landT - lead;
    else if (q.L || q.X) {   // 某类导弹发射（从发射前 lead 秒开拍）/ 落地、命中（落地前 lead 秒开拍）：时段空着的最早一次
      const Q = q.L || q.X, M = ev.filter(e => okL(e, Q) && e[1] >= (q.after || 0) && (!q.from || (A.get(e[2]) && has(q.from, A.get(e[2])[5]))) && (!Q.out || outOf(e) === Q.out) && (q.L || X.get(e[2])));
      let e = M.find(e => free((q.L ? e[1] : X.get(e[2])[1]) - lead, span));
      if (e && Q.dense) { const G = M.filter(o => Math.abs(o[1] - e[1]) < .3), d = o => G.reduce((a, g) => a + Math.hypot(g[7] - o[7], g[8] - o[8]), 0); e = G.reduce((a, o) => d(o) < d(a) ? o : a, e); }
      if (!e) fail('侦察记录里找不到时段空着的');
      T = (q.L ? e[1] : X.get(e[2])[1]) - lead; ref = refOf(e); hit = e;
    } else if (q.V) {   // 车炮对射：以每一发为起点，看这一段里同一辆车打了几发、对面在附近还击了几发（两军都有火力的优先）
      const V = ev.filter(e => e[0] === 'V' && has(q.V.side, e[2]) && has(q.V.tk, e[9]) && has(q.V.type, e[10]) && e[1] > landT - 30), V2 = q.V.late ? V.slice(Math.floor(V.length / 2)) : V;
      let best = null;
      for (const e of V2) {
        if (!free(e[1] - .6, span)) continue;
        const w = V.filter(o => o[3] === e[3] && o[1] >= e[1] && o[1] < e[1] + span).length, opp = ev.filter(o => o[0] === 'V' && o[2] !== e[2] && o[1] >= e[1] && o[1] < e[1] + span && Math.hypot(o[5] - e[5], o[6] - e[6]) < 900).length;
        const sc2 = w * 2 + opp + (e[9] === 'veh' ? 2 : 0);   // 打车辆的（坦克对坦克）优先
        if (!best || sc2 > best.sc) best = { sc: sc2, e };
      }
      if (!best) fail('侦察记录里没有时段空着的车炮对射');
      const e = best.e;
      T = e[1] - .6; ref = { A: ['v', e[3]], B: e[4] != null ? ['v', e[4]] : ['xy', e[7], e[8]], Bxy: ['xy', e[7], e[8]], nmA: e[11] || '' };
    } else if (q.F) {   // 步兵、工事对射：曳光按 300 米的格子分，两边都在打的格子（双方发数里少的那一边越多越好），镜头在攻方射手身后看向守方
      const Tr = ev.filter(e => e[0] === 'T' && e[1] >= (q.F.after != null ? landT + q.F.after : landT)), G = 300;
      let best = null;
      for (let t = Math.ceil(Tr.length ? Tr[0][1] : 0); Tr.length && t < Tr[Tr.length - 1][1]; t += 1) {
        if (!free(t, span)) continue;
        const W = Tr.filter(e => e[1] >= t && e[1] < t + span), cell = new Map();
        for (const e of W) { const k = Math.floor((e[3] + e[5]) / 2 / G) + ',' + Math.floor((e[4] + e[6]) / 2 / G); const c = cell.get(k) || cell.set(k, { p: [], e: [] }).get(k); c[e[2] === 'p' ? 'p' : 'e'].push(e); }
        for (const c of cell.values()) { const sc2 = Math.min(c.p.length, c.e.length) * 2 + (c.p.length + c.e.length) / 4; if (!best || sc2 > best.sc) best = { sc: sc2, t, c }; }
      }
      if (!best || !best.c.p.length || !best.c.e.length) fail('侦察记录里没有两边对射的地段');
      const m = A0 => [A0.reduce((a, e) => a + e[3], 0) / A0.length, A0.reduce((a, e) => a + e[4], 0) / A0.length];
      const pa = m(best.c.p), pb = m(best.c.e);
      T = best.t; ref = { A: ['xy', Math.round(pa[0]), Math.round(pa[1])], B: ['xy', Math.round(pb[0]), Math.round(pb[1])], n: [best.c.p.length, best.c.e.length] };
    } else if (q.C) {   // 航母弹射：某型飞机开始在弹射器上滑跑前 lead 秒开拍
      const e = ev.find(e => e[0] === 'C' && has(q.C.k, e[3]) && free(e[1] - lead, span));
      if (!e) fail('侦察记录里找不到时段空着的弹射起飞');
      T = e[1] - lead; ref = { A: ['pl', e[2]] };
    } else if (q.P) {   // 某型飞机在空中：开拍时在页面里挑一架
      const o = sc.samp.find(o => o.t >= (q.P.after ?? 0) && o.pl.some(k => q.P.k.includes(k)) && free(o.t, span));
      if (!o) fail('侦察记录里这型飞机不在空中');
      T = o.t;
    }
    if (T == null) fail('没定下开拍时刻');
    T = Math.round(T * 30) / 30;   // 落在推演步上
    if (!free(T, span)) fail(`推演第 ${T.toFixed(1)}–${(T + span).toFixed(1)} 秒和别的镜头重叠`);
    placed.push([T, T + span]);
    plan.push({ id: s.id, T, ref });   // ref.nmA：对射镜头里射手的型号（名牌 '@A' 换成它）
    res.set(s.id, { T, span, ref, e: hit });
  }
  return plan;
}
// 页面里的取景函数（侦察与渲染共用，不用随机数）
const PAGE_FNS = () => {
  const avg = A => A.length ? [A.reduce((a, q) => a + q.x, 0) / A.length, A.reduce((a, q) => a + q.y, 0) / A.length] : null;
  window.__land = () => {   // 登陆部队最密的一团
    const U = [...(S.veh || []).filter(v => v.side === 'p' && !v.dead && isLand(v.x, v.y)), ...S.teams.filter(q => q.side === 'p' && q.men.length && isLand(q.x, q.y))];
    const near = q => U.filter(o => dist(o.x, o.y, q.x, q.y) < 240), b = U.reduce((a, q) => !a || near(q).length > near(a).length ? q : a, null);
    return b ? avg(near(b)) : null;
  };
  window.__fleet = () => avg(S.ships.filter(s => !s.dead));
  window.__trench = first => {   // 堑壕：登陆部队 900 米以内、壕里站着守军的那一段（开拍时选定那一组守军，之后一直对着它，打光了才换）
    const L = window.__land(), E = S.teams.filter(q => q.side === 'e' && q.men.length && q.inTrench && !q.ride);
    if (!first && window.__trP) { const o = E.find(q => q.id === window.__trId); if (o) window.__trP = [o.x, o.y]; return window.__trP; }   // 那组守军打光了：镜头留在那段堑壕上，不跳去别处
    const o = L && E.filter(q => dist(q.x, q.y, L[0], L[1]) < 900).reduce((a, q) => !a || dist(q.x, q.y, L[0], L[1]) < dist(a.x, a.y, L[0], L[1]) ? q : a, null);
    if (o) { window.__trId = o.id; window.__trP = [o.x, o.y]; return window.__trP; }
    return L;
  };
  window.__ships = reset => {   // 舰艇最密的一群（舰队分成几群时平均位置落在空海上）：开拍时选定这几艘，之后一直跟着，中途不换群
    if (reset || !window.__grp) { const A = S.ships.filter(s => !s.dead), near = q => A.filter(o => dist(o.x, o.y, q.x, q.y) < 300), c = A.reduce((a, q) => !a || near(q).length > near(a).length ? q : a, null); window.__grp = c ? near(c) : []; }
    return avg(window.__grp.filter(s => !s.dead));
  };
  window.__cvp = () => S.cv && !S.cv.dead ? [S.cv.x, S.cv.y] : window.__fleet();
  // 按种类 + 编号找对象：{ x, y, z（3D 高度）, h 航向 }；没了返回 null
  window.__obj = r => {
    if (!r) return null;
    const k = r[0], id = r[1], air = o => ({ x: o.x, y: o.y, z: v3AirZ(o), h: o.heading || 0 });
    if (k === 'xy') return { x: r[1], y: r[2], z: r[3] ?? (r[1] >= 0 && r[2] >= 0 && r[1] <= W && r[2] <= H ? v3Ht(r[1], r[2]) : 0) + 2, h: 0 };
    if (k === 'pl') { const o = (S.planes || []).find(q => q.id === id); return o && !o.dead && isFinite(o.x) ? air(o) : null; }
    if (k === 'ea') { const o = S.eair && S.eair.fly.find(q => q.id === id); return o && !o.dead && isFinite(o.x) ? air(o) : null; }
    if (k === 'm') {
      const m = (S.missiles || []).find(q => q.id === id);
      if (!m || m.t < 0 || m.done || !isFinite(m.x)) return null;
      const rp = typeof airRelPos === 'function' ? airRelPos(m, true) : null;   // 刚离机：从挂点接上弹道（同 v3fx.js）
      if (rp) return { x: rp.x, y: rp.y, z: airRelZ(rp, m), h: rp.h };
      const z0 = m.z3 != null ? m.z3 : v3AltZ(m.x, m.y, m.z * (m.kind === 'tbm' ? 620 : V3_AIR), -2.6, 2), VP = typeof v3MslPos === 'function' ? v3MslPos(m, z0) : null;
      return { x: VP ? VP.x : m.x, y: VP ? VP.y : m.y, z: VP ? VP.z : z0, h: Math.atan2(m.ty - m.y, m.tx - m.x) };
    }
    if (k === 'v') { const v = (S.veh || []).find(q => q.id === id); return v && isFinite(v.x) ? { x: v.x, y: v.y, z: v3Ht(v.x, v.y) + 2.5, h: v.heading || 0, dead: v.dead } : null; }
    if (k === 'e') { const e = S.enemies.find(q => q.id === id); return e ? { x: e.x, y: e.y, z: v3Ht(e.x, e.y) + 2.5, h: 0, dead: e.dead } : null; }
    if (k === 's') { const s = S.ships.find(q => q.id === id); return s && !s.dead ? { x: s.x, y: s.y, z: 5, h: s.heading || 0 } : null; }
    if (k === 'dd') return S.dd && isFinite(S.dd.x) ? { x: S.dd.x, y: S.dd.y, z: 8, h: S.dd.heading ?? -Math.PI / 2 } : null;
    if (k === 'cv') return S.cv && !S.cv.dead ? { x: S.cv.x, y: S.cv.y, z: 20, h: S.cv.heading || 0 } : null;
    return null;
  };
  // 开拍时挑一架某型飞机（在空中飞的；先找离登陆场近的），之后一直跟着它
  window.__pickPl = ks => {
    const A = (S.planes || []).filter(p => !p.dead && isFinite(p.x) && p.phase === 'out' && (p.alt ?? 1) > .12 && ks.includes(airSilKey(p.kind, p.v)));
    const E = (S.eair && S.eair.fly || []).filter(a => !a.dead && isFinite(a.x) && ks.includes(a.type));
    const o = A[0] || E[0];
    return o ? [A[0] ? 'pl' : 'ea', o.id] : null;
  };
  // 镜头：返回 { eye: [x, y, z], yaw, pitch }；M 是这个镜头的记忆（上一帧对象的位置、平滑后的航向、镜头钉住的位置）
  const look = (E, T) => { const dx = T[0] - E[0], dy = T[1] - E[1], dz = T[2] - E[2]; return { eye: E, yaw: Math.atan2(dy, dx), pitch: Math.atan2(dz, Math.hypot(dx, dy)) }; };
  const aim = (tg, tz, d, yaw, pitch) => { const cp = Math.cos(pitch); return { eye: [tg[0] - Math.cos(yaw) * cp * d, tg[1] - Math.sin(yaw) * cp * d, tz - Math.sin(pitch) * d], yaw, pitch }; };
  const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
  window.__rig = (R, u, M) => {
    const e = u * u * (3 - 2 * u), L = v => Array.isArray(v) ? v[0] + (v[1] - v[0]) * e : (v ?? 0);
    const A = window.__obj(R.o);
    if (A) {   // 航向按相邻两帧的位置算（导弹、飞机转弯时镜头跟着转），平滑一下
      if (M.p) { const dx = A.x - M.p.x, dy = A.y - M.p.y, dz = A.z - M.p.z, dl = Math.hypot(dx, dy); if (dl > .4) { const h = Math.atan2(dy, dx); M.h = M.h == null ? h : M.h + wrap(h - M.h) * .22; M.pp = M.pp == null ? Math.atan2(dz, dl) : M.pp * .8 + Math.atan2(dz, dl) * .2; } }
      if (M.h == null) M.h = A.h;
      M.p = A;
    }
    const P = A || M.p || (R.at && window.__obj(R.at)) || (R.fb && window.__obj(R.fb));   // 对象没了（导弹命中、飞机被击落）：镜头停在原处，看着最后的位置；还没发射：先看着发射点
    if (!P) return null;
    if (R.k === 'chase') {
      if (!A && M.eye) return look(M.eye, [P.x, P.y, P.z]);
      const yaw = (R.abs ? 0 : M.h ?? P.h) + L(R.yo), r = aim([P.x, P.y], P.z, L(R.d), yaw, L(R.pit));
      M.eye = r.eye; return r;
    }
    if (R.k === 'look') {   // 镜头钉在 at（发射点、落点或对象开拍时的位置）旁边：off 按对象航向的 [前, 右, 上]
      if (!M.eye) { const o = (R.at && window.__obj(R.at)) || P, h = R.abs ? 0 : (o.h || M.h || 0), f = R.off || [0, 0, 0], gz = o.x >= 0 && o.y >= 0 && o.x <= W && o.y <= H ? v3Ht(o.x, o.y) : 0;
        M.eye = [o.x + Math.cos(h) * f[0] - Math.sin(h) * f[1], o.y + Math.sin(h) * f[0] + Math.cos(h) * f[1], Math.max(gz, o.z) + f[2]]; }
      return look(M.eye, [P.x, P.y, P.z + (R.tz || 0)]);
    }
    if (R.k === 'two') {   // 两军同框：A 在前景，B 在远处
      const B = window.__obj(R.b) || M.b || window.__obj(R.bxy);
      if (B) M.b = B;
      if (!B) return aim([P.x, P.y], P.z, L(R.d), (M.h ?? P.h) + Math.PI + L(R.yo), L(R.pit));
      const ba = Math.atan2(B.y - P.y, B.x - P.x);   // A 看向 B 的方向；镜头在 A 身后、偏开 yo
      if (M.ba == null) M.ba = ba; else M.ba += wrap(ba - M.ba) * .05;
      const f = R.f ?? .45, tx = P.x + (B.x - P.x) * f, ty = P.y + (B.y - P.y) * f, tz = P.z + (B.z - P.z) * f, yaw = M.ba + L(R.yo), d = L(R.d), pit = L(R.pit), cp = Math.cos(pit);
      const eye = [P.x - Math.cos(yaw) * cp * d, P.y - Math.sin(yaw) * cp * d, P.z - Math.sin(pit) * d];
      if (!M.t0) M.t0 = [tx, ty, tz]; else M.t0 = [M.t0[0] + (tx - M.t0[0]) * .15, M.t0[1] + (ty - M.t0[1]) * .15, M.t0[2] + (tz - M.t0[2]) * .15];
      return look(eye, M.t0);
    }
    if (R.k === 'orbit') return aim([P.x, P.y], P.z + (R.tz || 0), L(R.d), L(R.yaw), L(R.pit));
    if (R.k === 'pt') { const [a, b] = R.cam; return aim([P.x, P.y], P.z + (R.tz || 0), lerp(a[0], b[0], e), lerp(a[1], b[1], e), lerp(a[2], b[2], e)); }   // tz：看着对象上方多高
    return null;
  };
};

// 本镜头的固定取景点（boom、landing 用侦察记录；其余逐帧跟着走）
function staticTarget(sh, sc, W, H) {
  const T = sh.T, span = sh.dur * (sh.spd || 2);
  if (sh.tg === 'boom') {   // 炸得最集中的一团（几处同时在炸时不能取总平均：会落在两处中间的空地上）
    const B = sc.ev.filter(q => q[0] === 'B' && q[1] >= T && q[1] <= T + span).map(q => [q[1], q[2], q[3], q[4]]), wt = A => A.reduce((a, q) => a + q[3], 0);
    const near = p => B.filter(q => Math.hypot(q[1] - p[1], q[2] - p[2]) < 320), c = B.reduce((a, q) => !a || wt(near(q)) > wt(near(a)) ? q : a, null);
    if (c) { const A = near(c), w = wt(A); return [A.reduce((a, q) => a + q[1] * q[3], 0) / w, A.reduce((a, q) => a + q[2] * q[3], 0) / w]; }
  }
  if (sh.tg === 'landing' || sh.tg === 'boom') {
    const s = sc.samp.find(q => q.t >= T + span && q.land) || sc.samp.slice().reverse().find(q => q.land);
    return s ? s.land : [W / 2, H / 2];
  }
  return null;
}

// —— 逐帧渲染全部镜头 ——
// 各镜头的音效记录合成一份（按时间排）；没有单独记录的镜头沿用旧的总记录里落在它时段里的
function combineSfx() {
  const old = fs.existsSync(SFX) ? JSON.parse(fs.readFileSync(SFX, 'utf8')) : [], has = SHOTS.filter(s => fs.existsSync(path.join(SHOT_DIR, s.id + '.sfx.json')));
  const snd = old.filter(([t]) => !has.some(s => t >= s.at - 1e-6 && t < s.at + s.dur - 1e-6) && t < LEN);
  for (const s of has) snd.push(...JSON.parse(fs.readFileSync(path.join(SHOT_DIR, s.id + '.sfx.json'), 'utf8')));
  snd.sort((a, b) => a[0] - b[0]);
  fs.writeFileSync(SFX, JSON.stringify(snd));
  return snd;
}
async function loadPlan(b) {
  const scf = path.join(OUT, 'trailer_scout.json');
  const sc = process.env.SCOUT === 'reuse' && fs.existsSync(scf) ? JSON.parse(fs.readFileSync(scf, 'utf8')) : await scoutSaved(b);   // SCOUT=reuse：调试时用上次的侦察结果
  const plan = planShots(sc);
  for (const q of plan) { const s = SHOTS.find(o => o.id === q.id); s.T = q.T; s.ref = q.ref; }
  for (const s of SHOTS.filter(o => !o.ui)) console.log(`镜头 ${s.id.padEnd(3)} 片中 ${s.at.toFixed(1).padStart(5)} 秒 · 推演第 ${s.T.toFixed(1).padStart(6)} 秒${Object.keys(s.ref || {}).length ? ' · ' + JSON.stringify(s.ref) : ''}`);
  return sc;
}
// 镜头参数里的 'M' 'SRC' 'IMP' 'A' 'B' 换成侦察找到的对象
const fillTag = (tg, ref) => tg && tg[0] === '@A' ? [ref.nmA || '装甲部队', tg[1], tg[2]] : tg;
const fillRig = (R, ref) => { if (!R) return null; const o = { ...R }; for (const k of ['o', 'b', 'at', 'bxy']) if (typeof o[k] === 'string') o[k] = ref[o[k]] || (k === 'o' ? ref.M || ref.A || null : null); if (o.k === 'two' && !o.bxy) o.bxy = ref.Bxy || null; return o; };   // 发射的飞机没找到：跟着导弹
async function stepShots(b) {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const sfxOnly = !!process.env.SFXONLY;
  const sc = await loadPlan(b);
  const p = await boot(b, +process.env.W || 1920, +process.env.H || 1080);
  p.on('console', m => { if (m.type() === 'error') console.warn('页面：', m.text().slice(0, 200)); });
  await p.addStyleTag({ content: OVERLAY_CSS });
  await p.evaluate(PAGE_FNS);
  await battle(p, 0, MAP);
  if (+process.env.RS > 0 && +process.env.RS < 1) await p.evaluate(rs => { R.dprCap = rs; resize(); }, +process.env.RS);   // 画布像素密度压低（render.js resize 按 R.dprCap），界面不变
  const geo = await p.evaluate(() => {
    // 接管：动画循环停掉、时钟由这里推进；音效只记录不发声（声像按 3D 镜头算）
    window.requestAnimationFrame = () => 0;
    R.eye = 'all';   // 两军都画（平时只画侦察到的敌人）：只是画面，不影响推演
    window.__vt = lastT; performance.now = () => window.__vt;
    window.__ss = 13; window.__rs = 99991;   // 推演、画面各用一份随机数（页面里别的定时器用掉的算画面的）
    for (const id of ['trShade', 'trFlash', 'trCard', 'trChain', 'trTag', 'trCred']) { const d = document.createElement('div'); d.id = id; d.className = 'mn-layer'; document.body.appendChild(d); }
    document.getElementById('trCard').innerHTML = '<div class="k"></div><div class="t"></div><div class="r"></div><div class="s"></div>';
    document.getElementById('trChain').innerHTML = '<div class="hd"></div><div class="row"></div>';
    document.getElementById('trTag').innerHTML = '<div class="sd"></div><div class="nm"></div><div class="sb"></div>';
    document.getElementById('trCred').innerHTML = '地形：「Taiwan (East coast)」by Miguel Cueva（CC BY-NC-SA 4.0）　·　模型与特效素材的署名见游戏内「致谢」<br>本片按 CC BY-NC-SA 4.0 发布，仅限非商业用途';
    AU.ctx = { state: 'running', currentTime: 0 }; AU.master = {};
    window.__snd = []; window.__st = 0; window.__rec = false;
    for (const f of ['auBoom', 'auReport', 'auThump', 'auWhistle', 'auCrack', 'auBurst', 'auEngine', 'auChirp', 'auSquelch']) window[f] = (...a) => { if (window.__rec) window.__snd.push([+window.__st.toFixed(3), f, a.map(v => typeof v === 'number' ? +v.toFixed(3) : v)]); };
    for (const f of ['auApply', 'auMusicTick', 'auUi', 'auTone', 'auWhoosh', 'auBeep', 'auHit']) window[f] = () => {};
    window.auPos = (x, y) => {
      const z = v3Ht(x, y), q = v3Proj(x, y, z), E = V3.cam.E;
      if (!q) return { pan: 0, g: 0 };
      const d = Math.hypot(x - E[0], -y - E[1], z - E[2]), w2 = CAM.vw / 2, h2 = CAM.vh / 2, off = Math.max(0, Math.abs(q.x - w2) - w2, Math.abs(q.y - h2) - h2);
      return { pan: clamp((q.x - w2) / w2, -1, 1) * .7, g: clamp(800 / (d + 450), 0, 1) * (off ? .45 * Math.exp(-off / 500) : 1) };
    };
    S.speed = 2;
    return { W, H, SEA_H: typeof SEA_H === 'number' ? SEA_H : H };
  });
  await sleep(1500);   // 已排上的那一帧跑完（暂停中，不推演），再接管时钟
  // 飞机、车辆模型先下载好（解码跟着画面走：第一次出现的模型要画上几帧才解码完——飞机镜头多预热几帧，见 warm）
  await p.evaluate(() => { const K = new Set([...Object.values(V3G_AIR), ...Object.values(V3G_VEH)].filter(k => typeof k === 'string').map(k => k.replace(/~$/, ''))); v3gPreload([...K]); });
  await p.evaluate(() => { window.__vt = lastT; __seed(window.__rs); S.paused = false; });
  const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
  const order = SHOTS.filter(s => !s.ui).sort((a, b) => a.T - b.T).concat(SHOTS.filter(s => s.ui)).filter(s => !only || only.includes(s.id));
  for (const sh0 of order) {
    const sh = { ...sh0, rig: fillRig(sh0.rig, sh0.ref || {}), tag: fillTag(sh0.tag, sh0.ref || {}), ref: undefined, q: undefined };
    const N0 = Math.round(sh.dur * FPS), F0 = +process.env.FROM || 0, N = Math.min(N0, F0 + (+process.env.FRAMES || 1e9)), dir = path.join(SHOT_DIR, sh.id), sfxf = path.join(SHOT_DIR, sh.id + '.sfx.json');
    // DRAFT=3：草稿——每个镜头只画均匀分布的 3 帧（各带 2 帧预热），其余帧照样推演、算镜头，但不画不截图；存成 draft/<镜头>_<帧>.jpg
    const DR = +process.env.DRAFT || 0, dpick = DR ? [...Array(DR)].map((_, k) => Math.round((k + .5) / DR * (N0 - 1))) : null, ddraw = i => !dpick || dpick.some(f => i >= f - 2 && i <= f);
    if (process.env.SKIP && fs.existsSync(path.join(SHOT_DIR, sh.id + '.mp4')) && fs.existsSync(sfxf)) { console.log(`镜头 ${sh.id} 已有，跳过`); continue; }   // 推演不用补：下一个镜头开拍前照样推演到它的时刻，随机数是一条连续的流
    if (!sfxOnly && !DR) { fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true }); }
    if (!sh.ui) {
      const st = await p.evaluate(T => { __seed(window.__ss); while (S.t < T - 1e-6 && !S.over) step(1 / 30); window.__ss = __rng(); __seed(window.__rs); return { t: S.t, land: window.__land(), en: S.enemies.filter(e => !e.dead).length, tm: S.teams.filter(q => q.side === 'p' && q.men.length).length }; }, sh.T);
      if (sh0.q && sh0.q.P && sh.rig) { sh.rig.o = await p.evaluate(ks => window.__pickPl(ks), sh0.q.P.k); if (!sh.rig.o) console.warn(`镜头 ${sh.id}：这一刻天上没有 ${sh0.q.P.k}`); }   // 某型飞机：开拍这一刻挑一架
      if (sh0.pick && sh.rig) {   // pick：按顺序挑第一种在空中的机型，名牌跟着换
        for (const [k, nm, sb] of sh0.pick) { const o = await p.evaluate(k => window.__pickPl([k]), k); if (o) { sh.rig.o = o; sh.tag = [nm, sb, o[0] === 'ea' ? 'e' : 'p']; break; } }
        if (!sh.rig.o) console.warn(`镜头 ${sh.id}：这一刻天上没有 ${sh0.pick.map(q => q[0])}`);
      }
      // 空射弹没记到出自哪架飞机：开拍这一刻离发射点最近的那架就是（还有半秒才放弹）；名牌 '@SRC'：发射点上那辆车的型号
      if (sh0.q && sh0.q.F && sh0.q.F.bunker && sh.rig && sh.rig.o) {
        const e = await p.evaluate(A => { const E = S.enemies.filter(o => !o.dead && isFinite(o.x)); const o = E.reduce((a, o) => !a || dist(o.x, o.y, A[1], A[2]) < dist(a.x, a.y, A[1], A[2]) ? o : a, null); return o && dist(o.x, o.y, A[1], A[2]) < 450 ? ['e', o.id] : null; }, sh.rig.o);
        if (e) sh.rig.b = e;
      }
      if (sh0.rig && sh0.rig.o === 'SHIP') {   // 跟拍的登陆舰：开拍这一刻离上岸点最近、还在开的那艘
        const L = (sc.samp.find(q => q.t >= (sc.landT ?? 0) && q.land) || {}).land || [geo.W / 2, geo.SEA_H];
        sh.rig.o = await p.evaluate(L => { const A = S.ships.filter(s => !s.dead && s.state === 'move' && isFinite(s.x)); const o = A.reduce((a, s) => !a || dist(s.x, s.y, L[0], L[1]) < dist(a.x, a.y, L[0], L[1]) ? s : a, null); return o ? ['s', o.id] : null; }, L);
        if (!sh.rig.o) console.warn(`镜头 ${sh.id}：这一刻没有在开的登陆舰`);
      }
      const R0 = sh0.ref || {}, needPl = sh0.rig && sh0.rig.o === 'SRCP' && !R0.SRCP && R0.SRC, needNm = sh0.tag && sh0.tag[0] === '@SRC' && R0.SRC;
      if (needPl || needNm) {
        const fx = await p.evaluate(([src, needPl, needNm]) => {
          const out = {}, d = o => dist(o.x, o.y, src[1], src[2]);
          if (needPl) { let bd = 4000; for (const o of S.planes || []) if (!o.dead && isFinite(o.x) && d(o) < bd) { bd = d(o); out.pl = ['pl', o.id]; } for (const o of (S.eair && S.eair.fly) || []) if (!o.dead && isFinite(o.x) && d(o) < bd) { bd = d(o); out.pl = ['ea', o.id]; } }
          if (needNm) { const v = (S.veh || []).filter(o => !o.dead).reduce((a, o) => !a || d(o) < d(a) ? o : a, null); out.nm = v && d(v) < 80 ? vehModel(v) : null; }
          return out;
        }, [R0.SRC, !!needPl, !!needNm]);
        if (needPl && fx.pl) sh.rig.o = fx.pl;
        if (needNm) sh.tag = [fx.nm || '野战防空车', sh.tag[1], sh.tag[2]];
      }
      console.log(`镜头 ${sh.id}：第 ${st.t.toFixed(1)} 秒，敌工事 ${st.en}、我 ${st.tm} 组；对象 ${sh.rig ? JSON.stringify(sh.rig.o) : sh.tg}`);
    } else await uiSetup(p, sh);
    await p.evaluate(sh => { window.__cm = {}; window.__trP = null; window.__grp = null; document.body.classList.toggle('trClean', !sh.hud && !sh.ui); document.body.classList.toggle('trChat', !!sh.chat);
      if (!sh.hud && !sh.ui && !window.__v3o) { window.__v3o = v3Overlay; window.v3Overlay = () => {}; }
      if ((sh.hud || sh.ui) && window.__v3o) { window.v3Overlay = window.__v3o; window.__v3o = null; } }, sh);
    const fixed = staticTarget(sh, sc, geo.W, geo.H);
    for (let i = F0 - (sh.warm || 8); i < N; i++) {   // 前 8 帧预热（warm：飞机镜头 14 帧）（新镜头位置的贴图、缓存，第一次出现的模型载入完——原来 2 帧，追拍的飞机头几帧只有航行灯），不推演、不截图、不记声音
      const t = Math.max(F0, i) / FPS, u = N0 > 1 ? Math.max(F0, i) / (N0 - 1) : 0;
      const ov = overlayState(sh, t);
      await p.evaluate(([i, ov, sh, t, u, glyph, f0, fixed, geo, draw]) => {
        window.__rs = __rng(); __seed(window.__ss);   // 推演用推演的随机数
        window.__rec = i >= f0;   // 预热帧里出现的旧事件被音效系统看过就算听过，正式第一帧起才记
        if (i < f0) { const seen = window.__fireS || (window.__fireS = new WeakSet()); for (const f of S.fx) seen.add(f); window.__fireQ = []; }
        if (i >= f0 && !sh.ui) {
          for (let k = 0; k < (sh.spd || 2) && !S.over; k++) step(1 / 30);   // 默认 2 倍速：每帧推演两步；spd 1 是真实速度
          if (sh.fire) {   // 新出现的真实爆炸放大 1.5 倍，5 帧后旁边再炸一团小的
            const q = window.__fireQ || (window.__fireQ = []), seen = window.__fireS || (window.__fireS = new WeakSet());
            for (const f of S.fx) if (f.kind === 'boom' && !seen.has(f)) { seen.add(f); if (f.life < .2) { f.r *= 1.5; const a = (f.x * 7 + f.y * 13) % 6.283; q.push({ i: i + 5, x: f.x + Math.cos(a) * 26, y: f.y + Math.sin(a) * 18, r: f.r * .55 }); } }
            for (const e of q.filter(e => e.i === i)) { const f = { kind: 'boom', x: e.x, y: e.y, r: e.r, life: .05, max: 1.1, side: 'e' }; seen.add(f); S.fx.push(f); }   // 自己加的不再引出下一发
            window.__fireQ = q.filter(e => e.i > i);
          }
        }
        window.__st = sh.at + t;
        window.__ss = __rng(); __seed(window.__rs);   // 画面用画面的随机数
        // 镜头（推演那两步之后再取：飞机、导弹飞得快）
        const M = window.__cm, sm = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
        let cam = null;
        if (sh.rig) cam = window.__rig(sh.rig, u, M);
        else if (sh.end) {   // 片尾：从登陆场拉远到整段雪山海岸（距离按对数插值，拉远的速度看起来均匀）
          if (!M.start) M.start = window.__land() || [geo.W / 2, geo.SEA_H - 3000];
          const v = Math.min(1, u / .55), e = v * v * (3 - 2 * v), a = M.start, tg = [a[0] + (geo.W / 2 - a[0]) * e, a[1] + (geo.SEA_H - 9000 - a[1]) * e], d = Math.exp(Math.log(600) + (Math.log(20000) - Math.log(600)) * e), yaw = -1.3 + (-1.5708 + 1.3) * e, pitch = -.45 + (-.5 + .45) * e, cp = Math.cos(pitch);   // 拉到 20 公里外：镜头最高 11 公里（V3_ZMAX）
          cam = { eye: [tg[0] - Math.cos(yaw) * cp * d, tg[1] - Math.sin(yaw) * cp * d, v3Ht(tg[0], tg[1]) - Math.sin(pitch) * d], yaw, pitch };
        } else if (!sh.ui) {
          let tg = fixed;
          if (!tg) {
            const live = (sh.tg === 'cv' ? window.__cvp() : sh.tg === 'fleet' ? window.__fleet() : sh.tg === 'ships' ? window.__ships(!M.cur) : sh.tg === 'trench' ? window.__trench(!M.cur) : window.__land()) || M.cur || [geo.W / 2, geo.H / 2];
            if (sh.ahead) live[1] -= sh.ahead;   // 舰队往岸上看：取景点放在舰队前方
            tg = M.cur ? sm(M.cur, live, .08) : live;
          }
          M.cur = tg;
          const v = u * u * (3 - 2 * u), [a, b] = sh.cam, d = a[0] + (b[0] - a[0]) * v, yaw = a[1] + (b[1] - a[1]) * v, pitch = a[2] + (b[2] - a[2]) * v, cp = Math.cos(pitch);
          cam = { eye: [tg[0] - Math.cos(yaw) * cp * d, tg[1] - Math.sin(yaw) * cp * d, v3Ht(tg[0], tg[1]) - Math.sin(pitch) * d], yaw, pitch };
          if (sh.booms && i >= f0) for (const [j, bt] of sh.booms.entries()) if (Math.round(bt * 30) === i) {   // 高潮：按拍子落下的爆炸（位置固定，不用随机数）
            const an = j * 2.39996, r = 60 + (j % 4) * 45, f = { kind: 'boom', x: tg[0] + Math.cos(an) * r, y: tg[1] + Math.sin(an) * r * .7, r: 22 + (j % 3) * 8, life: .05, max: 1.2, side: 'e' };
            (window.__fireS || (window.__fireS = new WeakSet())).add(f); S.fx.push(f);
          }
        }
        V3.fovK = sh.fov || 1;   // fov：变焦（< 1 长焦：远处的敌人和前景的车一样醒目）
        if (cam) { V3.tin = null; Object.assign(V3.fc, { x: cam.eye[0], y: cam.eye[1], z: cam.eye[2], yaw: cam.yaw, pitch: cam.pitch, yawT: cam.yaw, pitchT: cam.pitch, cx: null, cy: null }); }
        // 追拍的飞机按 cone 的速度（米 / 秒）画：带上蒸汽锥（v3aero.js 按速度画），画完改回去，不影响推演
        const cO = sh.cone && sh.rig && sh.rig.o && sh.rig.o[0] === 'pl' && (S.planes || []).find(q => q.id === sh.rig.o[1]), cS = cO ? cO.spd : 0;
        if (cO) cO.spd = sh.cone;
        if (sh.ui === 'eanim') { MAN.t = (t * .9) % 1.25; manPose('ztz99', Math.min(MAN.t, 1.2)); MIV.yaw = 2.5 + t * .22; mivDraw(); }   // 编辑器：局部动画——开炮时炮管后坐、炮塔一震（预览按帧驱动，动画循环被接管了）
        if (sh.ui === 'etrail' && typeof mfxTick === 'function') mfxTick(window.__vt);   // 导弹尾烟设计：预览、预设卡片按帧动
        if (sh.ui === 'codex' && i >= f0 && i % 10 === 0) {   // 图鉴：隔 10 帧换一个有代表性的兵种
          const cs = [...document.querySelectorAll('#cdx .cdx-card')], pick = ['055 型驱逐舰', '歼-20', '福建舰', 'ZTD-05', '东风-15B', '轰-6K'].map(k => cs.find(e => e.textContent.includes(k))).filter(Boolean), c = pick[(i / 10) % pick.length | 0];
          if (c) { c.click(); c.scrollIntoView({ block: 'nearest' }); }
        }
        const hash = n => { n = Math.imul(n ^ n >>> 16, 2246822507); n = Math.imul(n ^ n >>> 13, 3266489909); return (n ^ n >>> 16) >>> 0; };
        const dec = (s, rev) => [...s].map((ch, k, A) => k < rev * A.length || ch === ' ' || ch === '　' ? ch : glyph[hash(i * 131 + k * 7919) % glyph.length]).join('');
        // 字幕卡
        const sd = document.getElementById('trShade'), fl = document.getElementById('trFlash'), cd = document.getElementById('trCard');
        sd.style.opacity = Math.max(ov.shade, ov.black);
        sd.style.background = ov.black > ov.shade ? '#000' : ov.card && ov.card.pos === 'logo' || sh.end ? 'radial-gradient(ellipse at 50% 45%, rgba(1, 6, 3, .55), rgba(1, 6, 3, .96) 70%)'
          : ov.card && ov.card.pos === 'low' || (!ov.card && ov.chain) ? 'linear-gradient(0deg, rgba(1, 6, 3, .9), rgba(1, 6, 3, .5) 30%, rgba(1, 6, 3, 0) 50%)'
          : 'linear-gradient(90deg, rgba(1, 6, 3, .88), rgba(1, 6, 3, .45) 38%, rgba(1, 6, 3, 0) 62%)';
        if (sh.end && ov.black) { sd.style.background = `linear-gradient(rgba(0, 0, 0, ${ov.black}), rgba(0, 0, 0, ${ov.black})), radial-gradient(ellipse at 50% 45%, rgba(1, 6, 3, .55), rgba(1, 6, 3, .96) 70%)`; sd.style.opacity = 1; }
        fl.style.opacity = ov.flash;
        const c = ov.card;
        cd.style.opacity = c ? c.a : 0;
        if (c) {
          cd.classList.toggle('logo', c.pos === 'logo');   // 只切换 logo：mn-layer 要留着，菜单打开时（图鉴）别的元素都会被藏起来
          Object.assign(cd.style, c.pos === 'logo' ? { left: '', top: '', bottom: '', transform: 'translate(-50%, -50%)' } : c.pos === 'low' ? { left: '7vw', top: 'auto', bottom: '11%', transform: `translateX(${c.slide}px)` } : { left: c.pos === 'mid' ? '330px' : '7vw', top: '50%', bottom: 'auto', transform: `translate(${c.slide}px, -50%)` });
          cd.querySelector('.k').textContent = dec(c.kick, c.rev);
          cd.querySelector('.t').textContent = dec(c.title, c.rev);
          cd.querySelector('.r').style.width = c.pos === 'logo' ? `${c.rule * 760}px` : `${c.rule * 460}px`;
          const s = cd.querySelector('.s'); s.textContent = c.sub || ''; s.style.opacity = c.subA ?? 1;
        }
        const cr = document.getElementById('trCred'); cr.style.opacity = ov.cred * (1 - ov.black);
        // 杀伤链：已经走过的节点亮着，这一节高亮（呼吸），前一节到这一节的箭头按 fill 走满
        const chE = document.getElementById('trChain'), C = ov.chain;
        chE.style.opacity = C ? C.a : 0;
        if (C) {
          const col = C.side === 'e' ? '255, 96, 72' : '61, 255, 138';
          chE.style.setProperty('--c', col);
          const key = C.k + ':' + C.n.length;
          if (chE.dataset.k !== key) { chE.dataset.k = key; chE.querySelector('.row').innerHTML = C.n.map((n, j) => (j ? '<div class="a"><i></i><b></b></div>' : '') + `<div class="n">${n}</div>`).join(''); }
          chE.querySelector('.hd').textContent = C.hd;
          const ns = chE.querySelectorAll('.n'), as = chE.querySelectorAll('.a i');
          ns.forEach((n, j) => { n.classList.toggle('on', j < C.i || (j === C.i && C.fill > .6)); n.classList.toggle('cur', j === C.i && C.fill > .6); });
          as.forEach((a, j) => { a.style.width = (j + 1 < C.i ? 100 : j + 1 === C.i ? C.fill * 100 : 0) + '%'; });
        }
        // 装备名牌
        const tgE = document.getElementById('trTag'), G = ov.tag;
        tgE.style.opacity = G ? G.a : 0;
        if (G) {
          tgE.style.setProperty('--c', G.side === 'e' ? '255, 96, 72' : '61, 255, 138');
          tgE.style.transform = `translateX(${G.slide}px)`;
          tgE.querySelector('.sd').textContent = G.side === 'e' ? 'DEFENDER // 守方' : 'ASSAULT FORCE // 攻方';
          tgE.querySelector('.nm').textContent = dec(G.nm, G.rev);
          tgE.querySelector('.sb').textContent = G.sb;
        }
        acc = -1e9; window.__vt += 1000 / 30; if (draw) frame(window.__vt);   // 推演已经在上面做了，frame() 只画
        if (cO) cO.spd = cS;
      }, [i, ov, sh, t, u, GLYPHS, F0, fixed, geo, ddraw(i) || i < F0 && !DR]);
      if (DR) { if (dpick.includes(i)) { fs.mkdirSync(path.join(SHOT_DIR, 'draft'), { recursive: true }); await p.screenshot({ path: path.join(SHOT_DIR, 'draft', `${sh.id}_${String(i).padStart(3, '0')}.jpg`), type: 'jpeg', quality: 85, timeout: 0 }); } }
      else if (i >= F0 && !sfxOnly) await p.screenshot({ path: path.join(dir, String(i - F0).padStart(4, '0') + '.jpg'), type: 'jpeg', quality: 93, timeout: 0 });   // 不限时：软件渲染、机器忙的时候一帧能超过默认的 30 秒
    }
    if (!sfxOnly && !DR) {
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(dir, '%04d.jpg'), '-vf', 'scale=1920:1080:flags=lanczos', '-c:v', 'libx264', '-preset', 'medium', '-crf', '14', '-pix_fmt', 'yuv420p', path.join(SHOT_DIR, sh.id + '.mp4')]);   // 低分辨率渲的（W / H）放大到 1080p，剪辑时各镜头一样大
      fs.rmSync(dir, { recursive: true, force: true });
    }
    const rec = await p.evaluate(() => { const r = window.__snd; window.__snd = []; window.__rec = false; return r; });   // 这个镜头的音效（时间都落在它的时段里）
    if (!DR) fs.writeFileSync(sfxf, JSON.stringify(rec));   // 草稿不记音效
    console.log(`镜头 ${sh.id} 完成（${N} 帧，音效 ${rec.length} 条）`);
  }
  console.log('音效记录', combineSfx().length, '条');
  await p.close();
}
const GLYPHS = 'アイウエオカキクケコサシスセソタチツテトナニヌネノ0123456789#%&*+=<>/\\|';

// 内容一览：图鉴（隔几帧换一个兵种）、闯关部署（AI 帮我部署，看部署好的舰队与对岸）
async function uiSetup(p, sh) {
  if (sh.ui === 'eanim' || sh.ui === 'etrail') {   // 编辑器：开着它拍（盖在暂停的战局上）
    await p.evaluate(k => {
      document.body.classList.remove('trClean');
      if (!MDX.el || MDX.el.hidden) openModEditor();
      MDX.dirty = false; MDX.q = ''; MDX.pk = '';
      if (k === 'eanim') { MDX.tab = 'mdl'; MDX.sel = 'ztz99'; } else { MDX.tab = 'trl'; MDX.sel = 'pl15'; MDX_W.trl.pl15 = { ...MFX_PRE[1][1] }; }
      mdxRender();
    }, sh.ui);
    if (sh.ui === 'eanim') {
      await p.waitForFunction(() => MIV.M && MIV.M.bi && MIV.key === 'ztz99' && document.querySelector('#mdx [data-mana="demo"]'), null, { timeout: 120000, polling: 500 });
      await p.evaluate(() => {
        const b = document.querySelector('#mdx [data-mana="demo"]'); if (b) b.click();   // 「示例：开炮时炮管后坐、炮塔一震」
        manPlay(false); MAN.t = 0; MDX.keep = true; mdxRender();
        const g = (MDX_W.mdl.ztz99 && MDX_W.mdl.ztz99.ag || [])[0]; if (g && g.cp) MIV.tgt = g.cp.slice(); MIV.pit = .2; MIV.dist = 7.5; mivDraw();   // 凑近炮塔、炮管：看得清后坐
      });
    }
    await sleep(800);
    return;
  }
  await p.evaluate(k => {
    document.body.classList.remove('trClean');
    if (MDX && MDX.el && !MDX.el.hidden) { MDX.dirty = false; closeModEditor(); }   // 编辑器拍完：关掉（没保存的不存）
    if (k === 'codex') { showMenu(); openCodex(); }
    if (k === 'deploy') { if (typeof closeCodex === 'function') closeCodex(); const cx = document.getElementById('cdx'); if (cx) cx.hidden = true; if (typeof lyPop === 'function' && cx) lyPop(cx); lvClose(); lvStart(4); const a = document.querySelector('#sbxPanel [data-act="ai"]'); if (a) a.click(); }   // 先关掉上一个镜头开着的图鉴（原来没关，部署镜头的背景还是图鉴）
  }, sh.ui);
  if (sh.ui === 'deploy') {
    await p.evaluate(() => {
      const sh = S.ships, x = sh.length ? sh.reduce((a, s) => a + s.x, 0) / sh.length : W / 2, y = sh.length ? sh.reduce((a, s) => a + s.y, 0) / sh.length : H / 2, ty = (y + coastAt(x)) / 2, d = 2400, yaw = -1.5708, pitch = -0.9, cp = Math.cos(pitch);
      V3.tin = null; Object.assign(V3.fc, { x: x - Math.cos(yaw) * cp * d, y: ty - Math.sin(yaw) * cp * d, z: v3Ht(x, ty) - Math.sin(pitch) * d, yaw, pitch, yawT: yaw, pitchT: pitch, cx: null, cy: null });
    });
  }
  await sleep(300);
}

// —— 录音：游戏自己的音频引擎实时录下来——氛围乐开场，第一幕起进行曲（固定 120 拍），强度逐幕加大，片尾胜利号角；
//    渲染时记下的音效按时间线回放；换幕处加重击（时刻都按分镜算） ——
async function stepAudio(b) {
  const snd = combineSfx();
  const PH = SHOTS.filter(s => s.flash).map(s => s.at), END = (SHOTS.find(s => s.end) || { at: LEN - 8 }).at, M0 = PH[0] ?? 6;   // 换幕时刻、片尾、进行曲从第一幕开始
  const b2 = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--allow-file-access-from-files'] });
  const p = await b2.newPage();
  await p.addInitScript(() => { window.requestAnimationFrame = () => 0; try { localStorage.clear(); localStorage.setItem('bh-settings', JSON.stringify({ intro: false, music: .9, sfx: .5, radio: .45, musicStyle: 'ambient' })); } catch (e) { /* 只影响声音 */ } });
  await p.goto((await serve()) + '/index.html', { timeout: 300000, waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => typeof MENU === 'object' && MENU.open, null, { timeout: 300000, polling: 1000 });
  const b64 = await p.evaluate(async ([snd, LEN, PRE, PH, END, M0]) => {
    auInit(); await AU.ctx.resume();
    const c = AU.ctx, d = c.createMediaStreamDestination(); AU.master.connect(d);
    // 进行曲固定 120 拍（一小节 2 秒），剪辑卡在小节线上；强度只改编制，不改速度
    window.auMarchTick = M => { while (M.next < c.currentTime + .3) { auMarchStep(M.next, .25, AU.inten, null); M.next += .25; M.step++; } };
    const rec = new MediaRecorder(d.stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 256000 }), ch = [];
    rec.ondataavailable = e => ch.push(e.data);
    const mg = AU.bus.music.gain, mv = SETTINGS.music * .5;
    window.auMusicStep = () => {};   // 开场只留氛围乐的低音持续音（A 与 E：D 大调的属音），和弦垫不要——会拖进进行曲里打架
    rec.start();
    const R0 = c.currentTime, Z = R0 + PRE;   // Z：片中第 0 秒
    mg.cancelScheduledValues(R0); mg.setValueAtTime(0, R0); mg.setValueAtTime(0, Z); mg.linearRampToValueAtTime(mv, Z + 2.5);   // 对齐哔声之前不出音乐，之后 2.5 秒淡入
    for (let k = 0, t = M0 - 2.6; t < M0 - .05; k++) { auTimp(Z + t, .035 + .17 * (t - (M0 - 2.6)) / 2.55, 33); t += Math.max(.06, .26 - k * .018); }   // 定音鼓滚奏渐强（A），落到进行曲第一拍
    auTone('ui', 'square', 1000, R0 + .5, .03, .9);   // 对齐用：片中 −0.5 秒
    const done = { march: 0, end: 0 }, hits = [[0, 'up', M0 - .4], [.35, 'hit', 1.2]];
    PH.forEach((a, k) => { if (k) hits.push([a - .7, 'up', .7]); hits.push([a, 'hit', k === PH.length - 1 ? 2.2 : 1.8 + k * .05]); });
    hits.push([END, 'hit', 2.4]); hits.sort((a, b) => a[0] - b[0]);
    let si = 0, hi = 0;
    await new Promise(res => {
      const iv = setInterval(() => {
        const g = c.currentTime - Z, ph = PH.filter(a => a <= g).length;
        AU.inten = g < M0 ? .12 + (.3 - .12) * Math.min(1, Math.max(0, g / M0)) : [.34, .34, .62, .86, 1][Math.min(4, ph)];
        if (g >= M0 - .5 && !done.march) { done.march = 1; SETTINGS.musicStyle = 'march'; AU.mus.next = Z + M0; auMusicTick(); AU.mus.step = 0; }   // 第一幕整进入进行曲第 1 小节
        if (g >= END - .3 && !done.end) {   // 片尾：进行曲停，胜利号角，接一个长和弦
          done.end = 1; AU.mus.next = 1e9; const t = Z + END;
          auFanfare(t);
          for (const m of [62, 66, 69, 74]) auBrass(t + .96, m, 6, .045, 2300);   // D 大调长和弦，撑到片尾淡出
          auBrass(t + .96, 50, 6, .04, 900); auTuba(t + .96, 38, 1.2, .1); auTimp(t + 4.5, .12, 38);
          for (let k = 0; k < 10; k++) auTimp(t + .96 + k * .07, .06 + k * .012);
          auCrash(t + .96, .06);
        }
        if (g < END) auMusicTick();
        while (hi < hits.length && hits[hi][0] <= g + .005) { const [, k, v] = hits[hi++]; if (k === 'hit') auHit(v, .75); else auWhoosh(v, true, .32); }
        while (si < snd.length && snd[si][0] <= g + .005) { const [, f, a] = snd[si++]; try { window[f](...a); } catch (e) { /* 单个声音失败不影响其他 */ } }
        if (g > LEN + 1) { clearInterval(iv); res(); }
      }, 8);
    });
    rec.stop(); await new Promise(r => rec.onstop = r);
    const u = new Uint8Array(await new Blob(ch).arrayBuffer()); let s = '';
    for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode.apply(null, u.subarray(i, i + 32768));
    return btoa(s);
  }, [snd.sort((a, b) => a[0] - b[0]), LEN, PRE, PH, END, M0]);
  fs.writeFileSync(path.join(OUT, 'trailer_rec.webm'), Buffer.from(b64, 'base64'));
  await b2.close();
  // 找对齐哔声（片中 −0.5 秒），从它往后 0.5 秒起截 LEN 秒
  //   按采样数截，不按时间戳：录音的时间戳跟墙上时钟走，没有声卡的机器上音频时钟慢一点（实测 0.3%），按时间戳截会短一截
  const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', path.join(OUT, 'trailer_rec.webm'), '-ac', '1', '-ar', '48000', '-f', 'f32le', 'pipe:1'], { maxBuffer: 1 << 30 });
  const f = new Float32Array(pcm.buffer, pcm.byteOffset, pcm.length >> 2);
  let on = f.findIndex(v => Math.abs(v) > .1);
  if (on < 0) throw new Error('录音里找不到对齐哔声');
  const start = on / 48000 + .5;
  console.log('对齐哔声在录音第', (on / 48000).toFixed(3), '秒');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(OUT, 'trailer_rec.webm'), '-af', `aresample=48000,asetpts=N/SR/TB,atrim=start=${start.toFixed(4)}:duration=${LEN},asetpts=PTS-STARTPTS,afade=t=out:st=${LEN - 1.4}:d=1.4,loudnorm=I=-14:TP=-1.5:LRA=11,apad`,
    '-t', String(LEN), '-ar', '48000', '-ac', '2', path.join(OUT, 'trailer_audio.wav')]);
}

// —— 剪辑：按时间线把各镜头接起来，配上声音 ——
function stepEdit() {
  const txt = path.join(SHOT_DIR, 'list.txt');
  fs.writeFileSync(txt, SHOTS.map(s => `file '${path.join(SHOT_DIR, s.id + '.mp4')}'`).join('\n') + '\n');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', txt, '-i', path.join(OUT, 'trailer_audio.wav'),
    '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', '-t', String(LEN), path.join(OUT, 'trailer_1080p.mp4')]);
  console.log('宣传片：', path.join(OUT, 'trailer_1080p.mp4'));
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch(LAUNCH);
  try {
    if (STEPS.includes('scout')) await scoutSaved(b);
    if (STEPS.includes('plan')) await loadPlan(b);
    if (STEPS.includes('shots')) await stepShots(b);
    if (STEPS.includes('audio')) { console.log('录音…'); await stepAudio(b); }
    if (STEPS.includes('edit')) stepEdit();
  } finally { await b.close(); }
})().catch(e => { console.error(e); process.exit(1); });
