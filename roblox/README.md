# 军事大亨（Roblox 版）

和网页版《暗剑》是两个独立的项目：这里是 Roblox 上的大亨游戏，网页版没有任何改动。

**玩法**：每个玩家分到一块基地 → 踩发光的按钮盖居民楼、工厂、银行，每秒自动赚钱 → 盖兵营、坦克工厂、防空车间、炮兵阵地、直升机场，花钱生产部队（部队从工厂开出来，停到前面蓝色的部署区）→ 点「布阵」摆位置 → 点「开战」打这一关的 AI 敌军。打赢拿奖励、进下一关，敌军越来越强、兵种越来越多；后期花钱升级「军工科技」（全军血量、伤害）。

- 兵种克制：坦克克步兵，武装直升机克坦克，防空车克直升机，步兵人多能打直升机，自行火炮打扎堆的步兵（射程最远，被贴近就危险）。
- 每一关的敌军开打前就摆在对面（左上角也写着），可以照着配兵。
- 部队上限：没有指挥部 4 个，指挥部 1～4 级是 10 / 18 / 30 / 40 个。
- 存档：建筑、关卡、部队和阵位、科技、现金都会存；离线最多两小时，按在线收入的两成算离线收益。
- 一个服务器最多 6 个人（6 块基地并排，各打各的关卡）。

## 打开、测试

1. 装 [Roblox Studio](https://create.roblox.com/)，登录。
2. Studio 里「文件 → 打开」（或直接双击）`MilitaryTycoon.rbxlx`。
3. 点上面的「测试 → 开始游戏」（Play）。地图、基地、建筑都是开始游戏时由脚本生成的，所以编辑模式下场景是空的，这是正常的。

没发布之前存档用不了，进游戏会提示「存档没读到」，照样能玩，只是退出不保存。

## 发布到 Roblox

1. Studio「文件 → 发布到 Roblox」（Publish to Roblox），选「新体验」，填名字、描述，创建。
2. 「主页 → 游戏设置」（Game Settings）：
   - **安全（Security）→ 打开「允许 Studio 访问 API 服务」**（Enable Studio Access to API Services），这样在 Studio 里测试也能存档；线上服务器本来就能存。
   - **地点（Places）→ 选这个地点 → 最多玩家数（Max Players）设成 6**（一个服务器只有 6 块基地，多出来的人会被提示换服务器）。
3. 在 [Creator Dashboard](https://create.roblox.com/dashboard/creations) 里把这个体验设成「公开」（Public），别人就能玩了。

改了脚本以后，在 Studio 里再「文件 → 发布到 Roblox」一次就更新了。

## 改数值

全部在 `src/Config.lua`（Studio 里是 ReplicatedStorage → Config）：

- `Config.Buildings`：建筑的价格、收入、解锁顺序（`req`）、位置、大小；指挥部的上限（`cap`）和升级价（`up`）。
- `Config.Units`：兵种的价格、血量、伤害、射速、射程、速度、对装甲 / 飞机 / 步兵的伤害倍数。
- `Config.EnemyBudget` / `EnemyTypes` / `Reward`：每关敌军的预算、出现的兵种、胜利奖励。
- `Config.Tech`：军工科技每级的加成和价格。
- `Config.Sounds`：音效。默认没有声音；在 Studio 工具箱（Toolbox → 音频）里找声音，把 `rbxassetid://数字` 填进去就有了。
- `Config.SaveKey`：存档名字，改了就是一套新存档（老进度不会删，只是不读了）。

## 文件

```
src/Config.lua              共享配置（ReplicatedStorage.Config，ModuleScript）
src/Main/init.server.lua    服务器主脚本（ServerScriptService.Main）：地图、经济、存档、生产、布阵、战斗流程
src/Main/Models.lua         零件拼的模型：地图、建筑、购买按钮、兵种（Main 下的 ModuleScript）
src/Main/Battle.lua         战斗推演：选目标、开火、溅射、炮弹、关卡敌军、排阵（Main 下的 ModuleScript）
src/Client.client.lua       客户端（StarterPlayerScripts.Client）：界面、布阵、观战镜头、开火爆炸特效
build.mjs                   把 src/ 打包成 MilitaryTycoon.rbxlx
default.project.json        用 Rojo 的话按这个同步
tools/luacheck.mjs          语法和变量名检查
tools/mock/                 在普通 Lua 里模拟 Roblox，真跑一遍服务器和客户端脚本的测试
```

改了 `src/` 里的脚本以后：

```bash
node roblox/tools/luacheck.mjs
```

```bash
python3 roblox/tools/mock/run.py roblox/tools/mock/test.lua 20
```

```bash
node roblox/build.mjs
```

第二条是模拟测试：一个机器人玩家进服、盖楼、点界面生产部队、布阵、开战，连续玩 20 分钟（模拟时间），再退出重进测存档；会打出每一场的结果和每栋楼盖好的时间。需要系统里有 Lua 5.4 运行库（Debian / Ubuntu 的 `liblua5.4-0`）。

## 以后可以加

- 真人对战：匹配另一个玩家，用双方的部署阵型打一场。
- 重生（Rebirth）：清空进度换永久加成，延长后期。
- 通行证 / 开发者商品：双倍收入、多一个部队上限等。
- 用 Roblox 资源商店里的模型替换零件拼的坦克、直升机。
