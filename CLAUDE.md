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
- 默认地图 8400 × 5600（core.js MAP_K = 2.8，W0 × H0）；大海域地图在 MAPGEN 里登记、建图前 setWorld 换尺寸（海岛战役 isle.js：6000 × 12000，远海只在 3D 里铺一块平面）。
- 画面默认「写实」（设置里还能选黑绿 / 数码，look.js）；对局默认 3D——view3d.js 自由镜头、真实天空与地表贴图、实时太阳阴影、海面（法线贴图按像素大小分层淡出，远处不出噪点），v3post.js 后期；黑绿 / 数码画面四周是 v3table.js 的沙盘桌。
- 坦克装甲车、飞机、直升机、导弹、单兵用的是用户给的模型，原封不动导入（js/v3g.js 渲染，js/mdl/<键>.js；转换工具 tools/v3gconv.py、tools/v3gbake.js、配置 tools/v3gmodels.json、预览 tools/v3gview.html）；兵种 → 模型的对照表在 v3g.js 的 V3G_VEH / V3G_AIR / V3G_MSL。舰艇是 Sketchfab 上 CC-BY 的模型（v3utex.js、assets/models），甲板牵引车、挂弹车是 v3x.js 的导入模型。
- 主菜单「闯关」是 levels.js（三章十关，按预算自己布兵），「海岛战役」是 isle.js，都建在沙盒（sandbox.js）上；两者都记在 S.lv 里（海岛是 S.lv.isle），闯关的逻辑要跳过海岛。

## 代码约定
- 全部状态在全局 `S`（纯 JSON，可存档）；类型数组、渲染缓存放在 S 之外，S 换了就重建。
- 模块之间用 core.js 的 `HOOK`（newGame / step / impact / visionP / visionE / drawUnder / drawOver / drawTop / frame / pointer / key）挂接；调用后加载的文件里的函数，先判断 `typeof fn === 'function'`。
- 每个文件开头 `'use strict';`；两格缩进、单引号、分号，紧凑写法；注释用简短中文，写清楚为什么这么做。
- 通联（chatSay）说话要像人：不加「命令：」「判断：」之类的公文标签，一条最多两三句，数字用推演里的真实数字。

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
