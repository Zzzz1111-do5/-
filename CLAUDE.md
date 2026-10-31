# 暗剑 Darksword · 给 Claude 的项目说明

## 沟通
- 用户说中文：回复、提交说明、代码注释、游戏内文字一律用中文。
- README.md 是仓库建立时留下的，与本项目无关；项目说明以本文件和 docs/ 为准。

## 项目是什么
- 两栖登陆作战沙盘游戏，浏览器运行：index.html 按顺序加载 js/ 下的普通脚本（共享全局变量，没有构建步骤）。
- 安卓版用 Capacitor 打包（android/、capacitor.config.json；`npm run sync` 生成商店版网页 www/ 并同步到安卓工程）。
- 电脑版（Steam）用 Electron 打包：desktop/（main.js 外壳、preload.js 给网页的 `window.dsDesktop`）；`cd desktop && npm ci && npm start` 试玩，`npm run dist:win` 打 Windows 包。
- 商店版（安卓、电脑）与网页版的差别都在 js/platform.js（要在 menu.js 之前加载）：「退出游戏」、全屏、安卓返回键、首次打开的《用户协议》《隐私政策》确认（legal/）。`tools/build_www.mjs --app` 生成商店版网页。
- 上架：docs/release.md（Steam、TapTap 步骤与每次更新要改的版本号）、docs/store.md（商店文案）、store/（商店素材，`tools/store_assets.js` 与 `tools/make_icons.py` 生成；宣传片 `tools/trailer.js`，视频不进仓库）、.github/workflows/release.yml（推 v 开头的标签打全部安装包）。
- 网页版：`bash tools/publish_pages.sh` 生成 www/ 并推到 gh-pages 分支（GitHub Pages）。
- 默认地图 8400 × 5600（core.js MAP_K = 2.8，W0 × H0）；大海域地图在 MAPGEN 里登记、建图前 setWorld 换尺寸（海岛战役 isle.js：6000 × 12000，远海只在 3D 里铺一块平面）。西、东、南三边都是海的地图（海岛），3D 写实画面里地图外是无边海面（view3d.js v3OceanBuild / v3OceanDraw：跟着镜头走、铺到雾的尽头），北边是陆地时把岛按北缘镜像延伸约 3 公里再收出北岸（只是远景）。
- 画面默认「写实」（设置里还能选黑绿 / 数码，look.js）；对局默认 3D——view3d.js 自由镜头、真实天空与地表贴图、实时太阳阴影、海面（法线贴图按像素大小分层淡出，远处不出噪点），v3post.js 后期；黑绿 / 数码画面四周是 v3table.js 的沙盘桌。
- 坦克装甲车、飞机、直升机、导弹、单兵用的是用户给的模型，原封不动导入（js/v3g.js 渲染，js/mdl/<键>.js；转换工具 tools/v3gconv.py、tools/v3gbake.js、配置 tools/v3gmodels.json、预览 tools/v3gview.html）；兵种 → 模型的对照表在 v3g.js 的 V3G_VEH / V3G_AIR / V3G_MSL。舰艇是 Sketchfab 上 CC-BY 的模型（v3utex.js、assets/models），甲板牵引车、挂弹车、导弹挂载架（rack）是 v3x.js 的导入模型（tools/sfmodel.js + tools/sfmodels.json，密钥只从环境变量 SKETCHFAB_TOKEN 读）。
- Sketchfab 下载的车辆模型（全部 CC-BY-4.0，署名在 tools/v3gmodels.json 的 credit，烘焙时自动写进 docs/credits.md、legal/credits.html；v3g.js 的 V3G_CRED 是游戏里的致谢表）：
  先 `python3 -I tools/sfprep.py <gltf.zip> <新空目录> [贴图最长边]` 解压并缩贴图，再 `node tools/v3gbake.js <上级目录> <键>`。v3gmodels.json 新选项：tri0 / tri0Flags 近看网格减面（Permissive 才减得动零件多的）、
  texMax 记录贴图缩到多大（署名里写明改动）、opaque 作者误设成半透明的材质按不透明画、roughMin 涂装按哑光、level 把摆成倾斜飞行姿态的飞机摆正、rot 补转；
  部件规则：kind each（每个连通块各成一个部件，车轮；byNode / cluster 把轮毂轮胎合成一个轮，roll 按半径换算转角）、kind chain（自转 → 平移 → 俯仰 → 随炮塔转，q / a2 / e / e2 / q3 / a3 / g2）、triBelow（按三角形高度挑起落架）。
- 每型装备「身上能动的功能」与真实参数在 js/vfn.js 的 VFN（逐型查的资料，出处写在注释里）：炮塔回转速度（推演里的转速也用它，vfnTrav）、炮管俯仰范围与速度（直瞄按目标高低、间瞄按射程算弹道仰角、对空按飞机高度）、
  后坐、发射架起竖（布雷德利陶式、爱国者 38°）、跳板（上下车时放下）、加特林炮管束开火时转、雷达转、扫雷犁放下、车轮按里程滚。v3g.js v3gVeh 每帧调 vfnParts 算 8 个部件参数。
  车辆型号 → 模型在 V3G_VEH（美军：布雷德利、M109、斯特赖克、爱国者、M163、C-RAM、M1150、M-ATV、悍马；解放军：ZBD-04、PTL-02、PGL-625、PzH2000（代 PLZ-07）、LAV-25（代 ZSL-92B / 08 式））。
  飞机模型（F-22、F-35、A-10、AH-64、UH-60、C-17、B-2、P-8、MQ-9、歼-15、歼-36、歼-50、运-20、轰-6、E-2D、X-47B、RQ-4）已烘焙进 js/mdl，但还没接进 V3G_AIR（起落架、旋翼待核对）。
- 模型加工都在 v3g.js 的 v3gPrep 里（上传缓冲区之前）：歼-31 尾喷口、舵面（V3G_PIT）；歼-20、歼-31 的弹舱（V3G_BAY：按真实弹舱位置把机腹蒙皮多边形裁剪切开，切出的舱门绕铰链转，补弹舱井）；坦克炮管拆成单独部件（V3G_GUN：开炮后坐、复进，车体后坐翘起）；M1A1 裙板上原有的 64 块 ARAT 拆成能逐块消失的 'era' 部件（V3G_ERA：块号编在顶点 |y| 里，一次绘制，块后面补焦黑底板）。实例参数 8 个（iC、iD）：iC.x 炮塔转角，iD 0 主弹舱开度、1 侧弹舱开度、2 炮管后坐；坦克 iC.yzw、iD.x 是炸掉的反应装甲块（各 16 位）；vfn.js 管的车辆按它那套参数槽。着色器部件模式：1 收起、2 尾喷口、3 炮管、4 反应装甲块、5 链式部件。
- 航母甲板（cvdeck.js、v3det.js）：飞机按机身 / 机翼 / 平尾三块矩形占位（cvShape），滑行每步先试、会碰上别的飞机或舰岛就原地等（cvFollow；互相挡住的低优先级那架倒一点让路，20 秒还过不去才硬走）；
  滑行令 c.tx：甲板上同一时间只滑一架（滑去弹射器、着舰后滑回机位），刚着舰的优先；滑行时折着机翼，到偏流板后展开完才上弹射器；出机位先顺机头拖 6 米再往舷内拐。
  每个机位旁一辆挂弹车 + 一个导弹挂载架（rack，0.62 倍），整备时一趟挂一枚（v3dArmQ / v3dArmLoaded / v3dArmBay，满载清单 fpwpn.js fwLoadout），挂弹时弹舱门开着，挂上的弹留在飞机上（fwStoresGnd）；牵引车不再瞬移。
- 爆炸反应装甲（js/era.js，vehicles.js vehDamage 先过 eraHit）：用的就是模型上原有的块——布局登记在 models.js 的 RLE（99A、96B、15 式首上和炮塔正面的块，2D 贴图照它画；M1A1 / M1A2 裙板的 ARAT，与 3D 模型的块一一对应），按块记（v.era.h / v.era.t 炸掉的块号）。来弹按来向落在迎弹面某一点，正好打在还在的块上才挡（破甲弹挡九成多，重型的削弱穿甲弹三成），块炸掉后那里就是本体装甲；炸掉的块 2D 画成焦黑空位（rlEraUsed）、3D 从模型上消失。96 式 3D 模型本身没挂反应装甲。攻顶导弹不管用。
- 亲自操纵（3D 里 P 键 / 「驾驶」按钮，js/v3pilot.js）：055 驱逐舰（舰桥视角，车钟、转舵、主炮、垂发）；升空的战斗机（歼-20、歼-50、歼-36）、歼-35、歼-15T、歼-16D 用飞控物理引擎 js/flight.js 真飞（六自由度 + 电传飞控，正常律 / 直接律），操纵照《战争雷霆》：默认鼠标瞄准（教官把机头带向准星，fpInstr），M 切鼠标摇杆；键盘杆量有平滑、死区、指数响应曲线；能横滚、筋斗；受力回馈（手柄震动、抖振、黑视红视、头随过载晃，G 开关）；追尾镜头（手动操纵时跟机体姿态翻），V 切座舱视角（座舱盖、平显玻璃透明）；手柄也能飞。画面上除了武器平显不画任何标识（地名、番号牌、状态行、按键提示都不画）。
  武器系统 js/fpwpn.js：数字键选武器（再按收起）、F 开火；选中时打开对应弹舱门（歼-20 侧弹舱把霹雳-10 连挂架推出舱外），开着时画舱里的弹；武器按真实参数（FW_W：霹雳-15 / 10 / 17、雷电-10、KD-88、飞腾-8、雷石-6），各机型挂载 FW_LOAD、挂点 FW_ST；平显画选中武器的大环（导引头 / 火控能锁的偏离角，按真实角度），环里射程内的目标出锁定框，锁稳了变红才能打；弹在三维里飞（助推、比例导引、过载限制、近炸引信，m.fw / m.z3，missile.js 不再推演它），命中走 msSamHit / msPgmHit。玩家开的飞机 v3AirZ 返回真实高度（不受高度档上限）。「驾驶」列表里还能选待命的飞机登机（fpBoard：派出这一架，舰载机坐在座舱里看登机、牵引车一路拖到偏流板后（cvdeck.js 见到 p.fpBrd）、上弹射器、弹射，离舰后物理引擎接手，满油门加力；陆基的从战区机场直接飞来）。被操纵的单位推演里用 fpDriving(o) 判断，AI 让出指挥。
- 飞机按真实世界的速度飞（carrier.js AIR_K = 1，型号表 spd 是真实巡航速度，米 / 秒）；机载雷达按真实探测距离（carrier.js AIR_REAL，airwar.js awSeen），锁定、发射仍按游戏里的火控距离。
- 主菜单「闯关」是 levels.js（三章十关，按预算自己布兵），「海岛战役」是 isle.js，都建在沙盒（sandbox.js）上；两者都记在 S.lv 里（海岛是 S.lv.isle），闯关的逻辑要跳过海岛。

## 代码约定
- 全部状态在全局 `S`（纯 JSON，可存档）；类型数组、渲染缓存放在 S 之外，S 换了就重建。
- 模块之间用 core.js 的 `HOOK`（newGame / step / impact / visionP / visionE / drawUnder / drawOver / drawTop / frame / pointer / key）挂接；调用后加载的文件里的函数，先判断 `typeof fn === 'function'`。
- 每个文件开头 `'use strict';`；两格缩进、单引号、分号，紧凑写法；注释用简短中文，写清楚为什么这么做。
- 司令发言（作战通联 chat.js）已删除：commander.js 的 chatSay 不再记录、不显示（CMD_TALK 关着），AI 指挥官照样下令执行；对局里没有操作按钮了（编队面板、命令 / 阵型 / 支援栏都去掉），我方全部资产由 AI 指挥（cmdAll 恒为真），玩家布好兵就看、可以亲自驾驶（P）。
- 沙盒 / 闯关布兵是 TABS 式（sandbox.js sbxUI）：底部兵种栏（分类页签 + 大卡片：白色图标、名称、点数），顶上双方预算，右下「开始战斗」「观战」，其余工具收在左上角「部署工具」；配色透明黑、细边框不明显，地图上布兵的兵种也画白色。

## AI：要求与现状
- 改 AI 之前先读 docs/ai_requirements.md（用户原话整理的硬性要求 + 实现对照），改完同步更新其中的「实现对照」。
- 默认对局的指挥体系是 js/theater.js（战区 → 师 → 团 → 营，钢铁雄心式战线推演）。它启用时关掉旧的 hq.js 司令与团（S.v7off.hq）、brain.js（br）、tf.js（tf）。所以：
  - 默认对局里不生效：js/cmddoc.js（hq.js 守方司令战法表）、js/jointdoc.js 的 BDE_DOC（hq.js 团的协同）；
  - 仍然生效：hq.js 的营长状态机 regThink（穿插、预备队、第二梯队）与 js/doctrine.js 团长战法表、js/sa.js 的态势感知与边打边撤（SA_DOC）。
- 战区司令的条令参数在 js/theater.js 的 `TH_DOC`（攻方：第二梯队比例、恢复推进的兵力比、火力准备；守方：战役预备队比例、反击兵力比、炮火准备、吃紧投入门槛、判明主攻门槛），由 tools/train_real.js 训练，记录在 docs/real_train.md。改 `TH_DOC` 时同步改 tools/train_real.js 的 `DEF`（训练场把它当「现行参数」比较）。

## 测试与训练（Node 无头运行；tools/headless.js 按 index.html 的顺序加载 js/）
- 语法检查：`for f in js/*.js; do node --check $f || echo FAIL $f; done`
- 条令符合度：`node tools/doctrine_eval.js [局数（最多 20）] [每局秒数]`。沙盒 AI 对 AI 加战役，测双方「打得像不像真的」：冲击前火力准备、局部兵力比、主攻集中、梯队、零打碎敲、步坦协同、防空伞、兵力闲置、守方预备队与纵深、反冲击兵力比等，对照条令目标范围打分，并报结局。改 AI 前后各跑一次对比。随机性大：10 局之间差几个百分点属正常波动；守方反冲击每局只有一两次，相关指标至少看 20 局。
- 训练场（同一局面配对比较、逐轮淘汰、冠军变异复赛，稳健分 = 平均 − 0.4 × 标准差，四个进程并行；成绩缓存在 tools/.cache/，不进仓库，代码改了自动作废）：
  - tools/train_real.js：战区司令 TH_DOC，打分一半胜负、一半条令符合度（`PFIX` / `EFIX` 环境变量指定对手参数）；
  - tools/train_reg.js：团长战法（js/doctrine.js）；tools/train_101.js：101 空降师；tools/train_joint.js、tools/train_cmd.js：hq.js 体系（默认对局里不生效）。
  - 一次训练常要一两个小时，放后台跑；中途打断可以重跑，已打过的局直接读缓存。
- 浏览器检查：Playwright 已全局安装（`NODE_PATH=$(npm root -g)`），打开 `file://…/index.html`，调用 `startPvE('hard')` 或 `mnSandbox()` 后用 `step(1 / 30)` 同步推演，截图、看 pageerror。

## 分支与协作
- 可能同时有几个 Claude 会话在改这个仓库，各自在 `claude/*` 分支上；main 只有初始提交。
- 开工前先 `git fetch`，找最新的开发分支，在它的基础上改；不要和正在推送的会话同时改同一批核心文件（theater.js、hq.js、brain.js、sandbox.js 等）。
