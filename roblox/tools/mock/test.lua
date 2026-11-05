-- 军事大亨 0.2 的模拟测试：在 rbx.lua 模拟的 Roblox 里真跑服务器和客户端脚本。
--   新档：进服 → 踩按钮盖楼 → 点界面生产 → 布阵 → 开战（本人上阵）→ 机器人连续玩几十分钟（模拟时间）
--   老玩家的档（全建筑、混编部队、首领关）：拿枪打、开坦克、开直升机、突袭别人的防线、和另一个玩家约战、任务、每日奖励、武器、重生、排行榜
--   导入的原模型（假装是 Studio 导入的：转了 90°、放大了 3.6 倍）能摆正、缩放、炮塔能转
--   退出存档 → 过一小时再进（读档、离线收益）→ 存档服务坏掉 → 七个人进六块地的服务器
-- 有脚本报错就算失败。用法：python3 roblox/tools/mock/run.py roblox/tools/mock/test.lua [机器人玩几分钟]
local R = dofile(MOCK_DIR .. "/rbx.lua")
local V3 = R.Vector3.new
local CF = R.CFrame.new
local Enum = R.Enum
local RS = R.services.ReplicatedStorage
local SSS = R.services.ServerScriptService
local Players = R.services.Players
local ws = R.workspace

local MINUTES = tonumber(TEST_ARGS:match("(%d+)")) or 20
local fails = {}
local function check(ok, msg)
  if ok then print("  ✓ " .. msg) else print("  ✗ " .. msg); table.insert(fails, msg) end
end

-- 装脚本：和 build.mjs 一样的结构
local function listLua(dir)
  local p = io.popen('ls "' .. dir .. '"')
  local out = {}
  for f in p:lines() do if f:match("%.lua$") then table.insert(out, f) end end
  p:close()
  return out
end
local configMS = R.scriptFrom("ModuleScript", "Config", SRC_DIR .. "/Config.lua", RS)
local um = R.make("Folder")
um._p.Name = "UnitModels"
um.Parent = RS
local main = R.scriptFrom("Script", "Main", SRC_DIR .. "/Main/init.server.lua", SSS)
for _, f in ipairs(listLua(SRC_DIR .. "/Main")) do
  if f ~= "init.server.lua" then R.scriptFrom("ModuleScript", f:gsub("%.lua$", ""), SRC_DIR .. "/Main/" .. f, main) end
end
local Config = R.require(configMS)

-- 假装导入的原模型：坦克（车身、炮塔、标记），整体绕 Y 转 90°、放大 3.6 倍（导入器可能这样换坐标）；直升机（主旋翼、尾桨）
local function fakeImport(name, parts)
  local m = R.make("Model")
  m._p.Name = name
  local rot = R.CFrame.Angles(0, math.pi / 2, 0)
  for _, e in ipairs(parts) do
    local p = R.make("MeshPart")
    p._p.Name = e[1]
    p._p.Anchored = true
    p._p.Size = e[2] * 3.6
    p._p.CFrame = CF(500, 0, 300) * rot * CF(e[3] * 3.6)
    p.Parent = m
  end
  m.Parent = ws
  return m
end
-- 原始坐标（米）：车头朝 −Z
fakeImport("tank", {
  { "Body_1", V3(3.6, 1.6, 9), V3(0, 0.8, 0) }, { "Body_2", V3(3.2, 0.4, 8), V3(0, 1.8, 0) },
  { "Turret_1", V3(2.4, 1, 3), V3(0, 2.4, 0.5) }, { "Turret_2", V3(0.3, 0.3, 5), V3(0, 2.5, -3.5) },
  { "_Front", V3(0.2, 0.2, 0.2), V3(0, 1.3, -5.5) }, { "_Top", V3(0.2, 0.2, 0.2), V3(0, 4, 0) }, { "_PivotTurret", V3(0.2, 0.2, 0.2), V3(0, 2.2, 0.5) },
})
fakeImport("heli", {
  { "Body_1", V3(2, 2, 12), V3(0, 2, 0) }, { "Rotor_1", V3(13, 0.1, 0.4), V3(0, 3.6, 0) }, { "TailRotor_1", V3(0.1, 2, 0.3), V3(0.4, 2.6, 6.2) },
  { "_Front", V3(0.2, 0.2, 0.2), V3(0, 2, -6.5) }, { "_Top", V3(0.2, 0.2, 0.2), V3(0, 5, 0) }, { "_PivotRotor", V3(0.2, 0.2, 0.2), V3(0, 3.6, 0) },
  { "_PivotTail", V3(0.2, 0.2, 0.2), V3(0.4, 2.6, 6.2) }, { "_AxisTail", V3(0.2, 0.2, 0.2), V3(1.4, 2.6, 6.2) },
})

-- 一个老玩家的档：全部建筑、指挥部 4 级、科技 5、四把枪、40 个兵（混编）、第 10 关（首领关）
local army = {}
local mix = { "inf", "inf", "inf", "inf", "ifv", "ifv", "tank", "tank", "tank", "tank", "aa", "aa", "aa", "arty", "arty", "mlrs", "heli", "heli", "heli", "heli" }
for i = 1, 40 do table.insert(army, { t = mix[(i - 1) % #mix + 1], x = ((i - 1) % 10 - 4.5) * 30, z = 200 + math.floor((i - 1) / 10) * 30 }) end
local owned = {}
for _, b in ipairs(Config.Buildings) do owned[b.id] = true end
local now0 = os.time()
R.store[Config.SaveKey .. "/u5005"] = { v = 2, cash = 2000000, level = 10, best = 10, owned = owned, hq = 4, tech = 5, army = army, wins = 9, rebirth = 0, xp = 900,
  kills = 3, weapons = { rifle = true, smg = true, sniper = true, rpg = true }, rating = 1000, raidWins = 0, duelWins = 0,
  daily = { day = math.floor(now0 / 86400) - 1, streak = 3 }, missions = { day = 0, list = {} }, t = now0 - 30 }
-- 一位不在线玩家的防线（突袭对象）
R.store["MilitaryTycoon_def_v1/u7007"] = { name = "远方的对手", level = 8, tech = 1, rebirth = 0, rating = 1040,
  army = { { t = "inf", x = -20, z = 300 }, { t = "inf", x = 20, z = 300 }, { t = "tank", x = 0, z = 270 }, { t = "aa", x = 40, z = 240 } }, t = now0 - 99 }
R.ordered = { MilitaryTycoon_rating_v1 = { u7007 = 1040 }, MilitaryTycoon_level_v1 = { u7007 = 8 } }

print("== 启动服务器")
R.runScript(main, "server")
R.run(1)
check(#R.errors == 0, "服务器脚本启动没报错")
local plotsF = ws:FindFirstChild("Plots")
check(plotsF ~= nil and #plotsF:GetChildren() == Config.PlotCount, "生成了 " .. Config.PlotCount .. " 块基地")
check(ws:FindFirstChild("Arenas") ~= nil and #ws.Arenas:GetChildren() == #Config.Arena.xs, "生成了约战竞技场")
check(RS:FindFirstChild("Remotes") ~= nil and #RS.Remotes:GetChildren() == 9, "九个远程事件")
local tpl = R.services.ServerStorage:FindFirstChild("UnitTemplates")
check(tpl and tpl:FindFirstChild("tank") and tpl:FindFirstChild("heli") and not ws:FindFirstChild("tank"), "导入的坦克、直升机收成了模板")
local remotes = RS.Remotes

local pl
local function join(name, uid, noClient)
  local p = R.addPlayer(name, uid)
  if not noClient then R.localPlayer = p end
  Players.PlayerAdded:Fire(p)
  if not noClient then
    local client = R.scriptFrom("LocalScript", "Client", SRC_DIR .. "/Client/init.client.lua", p.PlayerScripts)
    for _, f in ipairs(listLua(SRC_DIR .. "/Client")) do
      if f ~= "init.client.lua" then R.scriptFrom("ModuleScript", f:gsub("%.lua$", ""), SRC_DIR .. "/Client/" .. f, client) end
    end
    R.runScript(client, "client")
  end
  R.run(3)
  return p
end

local function plotOf(p)
  for _, f in ipairs(plotsF:GetChildren()) do
    for _, d in ipairs(f:GetDescendants()) do
      if d.ClassName == "TextLabel" and d.Text == p.Name .. " 的基地" then return f end
    end
  end
end
local function plot() return plotOf(pl) end
local function stat(name, p) return (p or pl).leaderstats[name].Value end
local function guiText(pattern)
  for _, d in ipairs(pl.PlayerGui:GetDescendants()) do
    if (d.ClassName == "TextLabel" or d.ClassName == "TextButton") and d.Text:find(pattern) then return d end
  end
end
local function button(pattern)
  for _, d in ipairs(pl.PlayerGui:GetDescendants()) do
    if d.ClassName == "TextButton" and d.Text:find(pattern) then return d end
  end
end
local function click(btn)
  R.as("client", function() btn.Activated:Fire() end)
  R.run(0.2)
end
local function action(...)
  local args = table.pack(...)
  R.as("client", function() remotes.Action:FireServer(table.unpack(args, 1, args.n)) end)
  R.run(0.1)
end
local function actionAs(p, ...)
  local keep = R.localPlayer
  R.localPlayer = p
  action(...)
  R.localPlayer = keep
end
local builtAt = {}
local function touch(id, p)
  p = p or pl
  local m = plotOf(p).Pads:FindFirstChild("Pad_" .. id)
  if not m then return false end
  m.Pad.Touched:Fire(p.Character.HumanoidRootPart)
  R.run(0.1)
  if plotOf(p).Buildings:FindFirstChild(id) and not builtAt[id] then builtAt[id] = R.clock() / 60 end
  return true
end
local function owned(id) return plot().Buildings:FindFirstChild(id) ~= nil end
local function units(p)
  local out = {}
  for _, u in ipairs(plotOf(p or pl).Units:GetChildren()) do
    if not u:GetAttribute("Dead") then table.insert(out, u) end
  end
  return out
end
local function toastSince(n, pattern)
  for i = n + 1, #R.sent do
    if R.sent[i].name == "Toast" and tostring(R.sent[i].args[1]):find(pattern) then return true end
  end
  return false
end
local function battleEvent(n, phase)
  for i = n + 1, #R.sent do
    local e = R.sent[i]
    if e.name == "Battle" and type(e.args[1]) == "table" and e.args[1].phase == phase then return e.args[1] end
  end
end
local function waitResult(maxSec)
  for _ = 1, (maxSec or 300) * 2 do
    R.run(0.5)
    local r = guiText("^胜利！$") or guiText("^失败$") or guiText("^时间到$")
    if r and r.Parent.Visible then return r.Text end
  end
end
local function relPos(m, p)
  return m.Root.CFrame.Position - plotOf(p or pl).Base.CFrame.Position + V3(0, 0.5, 0)
end

print("== 新玩家进服")
pl = join("Tester", 1001)
check(#R.errors == 0, "进服没报错")
check(plot() ~= nil, "分到了基地（牌子写着名字）")
check(pl.Character ~= nil and pl.Character:FindFirstChild("Head") and pl.Character.Head:FindFirstChild("RankTag"), "角色生成了，头上有军衔名牌")
check(pl.Backpack:FindFirstChild("步枪") ~= nil, "背包里有步枪")
check(stat("现金") == Config.StartCash and stat("军衔") == "列兵", "起始现金 " .. Config.StartCash .. "，军衔列兵")
check(guiText("^%$300") ~= nil, "界面上显示 $300")
check(guiText("每日奖励") ~= nil, "弹出每日奖励")
local n0 = #R.sent
click(button("^领取$"))
check(stat("现金") > Config.StartCash and toastSince(n0, "每日奖励"), "领了每日奖励（$" .. stat("现金") .. "）")
check(plot().Pads:FindFirstChild("Pad_house1") ~= nil, "有居民楼 A 的购买按钮")
check(#plot().Enemies:GetChildren() > 0, "第 1 关敌军摆出来了")
check(ws:FindFirstChild("ClientUnits") and #ws.ClientUnits:GetChildren() == #plot().Enemies:GetChildren(), "客户端给每个单位做了平滑显示的复制")

print("== 盖楼、生产")
touch("house1")
check(owned("house1"), "踩按钮盖好居民楼 A")
n0 = #R.sent
touch("bank")
check(not owned("bank"), "还没解锁的银行盖不了")
R.run(40)
touch("barracks")
check(owned("barracks"), "盖好兵营")
R.run(25)
local before = #units()
local b = button("^%$60$")
check(b ~= nil, "兵工厂里步兵班的按钮显示 $60")
if b then click(b) click(b) end
check(#units() == before + 2, "生产了两个步兵班")
R.run(25)
local u1 = units()[1]
local p1 = u1 and relPos(u1)
check(p1 ~= nil and p1.Z > Config.Field.deploy[1] - 1 and p1.Z < Config.Field.deploy[2] + 1, "步兵从兵营开到了部署区")

print("== 布阵")
click(button("^布阵$"))
check(ws.CurrentCamera.CameraType == Enum.CameraType.Scriptable, "镜头切到布阵视角")
local clone
for _, c in ipairs(ws.ClientUnits:GetChildren()) do
  if c:GetAttribute("Uid") == u1:GetAttribute("Uid") then clone = c end
end
check(clone ~= nil, "找到这个步兵班的本地复制")
local part
for _, c in ipairs(clone:GetChildren()) do if c.Name ~= "Root" and c:IsA("BasePart") then part = c break end end
R.nextRay = { Instance = part, Position = part.CFrame.Position }
R.as("client", function() R.services.UserInputService.InputBegan:Fire({ UserInputType = Enum.UserInputType.MouseButton1, Position = V3(600, 300, 0) }, false) end)
R.run(0.1)
check(clone:FindFirstChildOfClass("Highlight") ~= nil, "点到的部队被选中（高亮）")
local origin = plot().Base.CFrame.Position - V3(0, 0.5, 0)
R.nextRay = { Instance = plot().Field, Position = origin + V3(60, 1, 250) }
R.as("client", function() R.services.UserInputService.InputBegan:Fire({ UserInputType = Enum.UserInputType.MouseButton1, Position = V3(700, 320, 0) }, false) end)
R.run(10)
local p2 = relPos(u1)
check(math.abs(p2.X - 60) < 1 and math.abs(p2.Z - 250) < 1, string.format("部队开到了点的位置（%.1f, %.1f）", p2.X, p2.Z))
local cp = clone.Root.CFrame.Position - origin
check((cp - p2).Magnitude < 2, "本地复制也跟过去了（平滑显示）")
click(button("^回基地$"))

print("== 开战（本人上阵）")
n0 = #R.sent
click(button("^开战"))
R.run(1)
local hrp = pl.Character.HumanoidRootPart
local hp = hrp.CFrame.Position - origin
check(battleEvent(n0, "start") ~= nil and guiText("^第 1 关") ~= nil, "开战，界面显示「第 1 关」")
check(hp.Z > Config.Field.deploy[1] and hp.Z < Config.Field.deploy[2] and pl.Character:GetAttribute("BU") ~= nil, "本人传送到了己方阵地，算一个战斗单位")
check(pl.Character.Humanoid.MaxHealth == Config.Hero.hp, "上阵血量 " .. Config.Hero.hp)
-- 拿起步枪，对着最近的敌人打
local rifle = pl.Backpack:FindFirstChild("步枪")
rifle.Parent = pl.Character
R.run(0.2)
local target = plot().Enemies:GetChildren()[1]
local fill0 = target.Root:FindFirstChild("HP") and target.Root.HP:FindFirstChildOfClass("Frame").Fill.Size.XS or 1
pl.Character.Head._p.CFrame = CF(target.Root.CFrame.Position + V3(0, 2.5, -40))
for _ = 1, 6 do
  R.as("client", function() remotes.Shoot:FireServer("rifle", target.Root.CFrame.Position + V3(0, 2, 0)) end)
  R.run(0.2)
end
local fill1 = target.Parent and target.Root:FindFirstChild("HP") and target.Root.HP:FindFirstChildOfClass("Frame").Fill.Size.XS or 0
check(fill1 < fill0, string.format("步枪打中了敌人（血条 %.2f → %.2f）", fill0, fill1))
R.as("client", function() R.services.UserInputService.InputBegan:Fire({ UserInputType = Enum.UserInputType.MouseButton1, Position = V3(640, 360, 0) }, false) end)
R.run(0.6)
R.as("client", function() R.services.UserInputService.InputEnded:Fire({ UserInputType = Enum.UserInputType.MouseButton1, Position = V3(640, 360, 0) }) end)
check(guiText("^步枪  %d+ / 30") ~= nil, "按住左键连发，弹药显示在右下角")
local res = waitResult(300)
check(res ~= nil, "打完了：" .. tostring(res))
check(pl.Character.Humanoid.MaxHealth == 100, "打完血量上限恢复")
click(button("^回基地$"))
check(#R.errors == 0, "战斗没报错")

print("== 机器人连续玩 " .. MINUTES .. " 分钟（模拟时间）")
local U = Config.Units
local function enemyComp()
  local c = { inf = 0, ifv = 0, tank = 0, aa = 0, arty = 0, mlrs = 0, heli = 0, boss = 0 }
  local value = 0
  for _, e in ipairs(plot().Enemies:GetChildren()) do
    local t = e:GetAttribute("Type")
    if t then c[t] = c[t] + 1 value = value + U[t].price end
  end
  return c, value
end
local function myComp()
  local c = { inf = 0, ifv = 0, tank = 0, aa = 0, arty = 0, mlrs = 0, heli = 0, boss = 0 }
  local value = 0
  for _, u in ipairs(units()) do
    local t = u:GetAttribute("Type")
    if t then c[t] = c[t] + 1 value = value + U[t].price end
  end
  return c, value
end
local function capNow()
  local txt = guiText("^部队 ")
  local n, cap = txt.Text:match("部队 (%d+) / (%d+)")
  return tonumber(n), tonumber(cap)
end
local function desired(ec, cap)
  local w = { aa = 0, heli = 0, arty = 0, mlrs = 0, tank = 0, ifv = 0, inf = 0 }
  if owned("aafac") then w.aa = math.min(cap, math.ceil(ec.heli * 0.9)) end
  if owned("helipad") then w.heli = math.min(cap - w.aa, math.ceil((ec.tank + ec.boss * 3) * 0.7)) end
  if owned("artyfac") then w.arty = math.min(cap - w.aa - w.heli, 3, math.floor(ec.inf / 4)) end
  local rest = math.max(0, cap - w.aa - w.heli - w.arty)
  if owned("tankfac") then
    w.tank = math.ceil(rest * 0.4)
    w.ifv = math.ceil(rest * 0.2)
  end
  w.inf = math.max(0, rest - w.tank - w.ifv)
  return w
end
local ORDER = { "aa", "heli", "arty", "tank", "ifv", "inf" }
local battles, wins = 0, 0
local log = {}
local tEnd = R.clock() + MINUTES * 60
local nextFight = 0
local lostLast = false
while R.clock() < tEnd do
  R.run(2)
  local pads = plot().Pads:GetChildren()
  table.sort(pads, function(a, b2) return Config.BuildingById[a.Name:sub(5)].price < Config.BuildingById[b2.Name:sub(5)].price end)
  local saving = false
  for _, m in ipairs(pads) do
    local bd = Config.BuildingById[m.Name:sub(5)]
    if stat("现金") >= bd.price then touch(bd.id) elseif bd.price < stat("现金") * 3 then saving = true end
  end
  local hq = button("^升级指挥部")
  if hq and hq.Visible then
    local price = tonumber((hq.Text:gsub(",", "")):match("%$(%d+)"))
    if price and stat("现金") >= price then click(hq) end
  end
  local ec, evalue = enemyComp()
  local n, cap = capNow()
  local want = desired(ec, cap)
  if lostLast then
    local have = myComp()
    for _, u in ipairs(units()) do
      local t = u:GetAttribute("Type")
      if have[t] > (want[t] or 0) then
        action("sell", u:GetAttribute("Uid"))
        have[t] = have[t] - 1
      end
    end
    lostLast = false
  end
  local have = myComp()
  for _, t in ipairs(ORDER) do
    while have[t] < (want[t] or 0) do
      n, cap = capNow()
      if n >= cap or stat("现金") < U[t].price then break end
      action("buy", t)
      have[t] = have[t] + 1
    end
  end
  n, cap = capNow()
  if n >= cap and not saving then
    local lbl = guiText("^军工科技 Lv")
    local tb = lbl and lbl.Parent:FindFirstChildOfClass("TextButton")
    if tb then
      local price = tonumber((tb.Text:gsub(",", "")):match("%$(%d+)"))
      if price and stat("现金") >= price then click(tb) end
    end
  end
  local _, mvalue = myComp()
  if R.clock() >= nextFight and #units() > 0 and evalue > 0 and (mvalue >= evalue * 1.3 or n >= cap) then
    local lvl = stat("关卡")
    action("arrange")
    R.run(8)
    action("battle")
    local tb0 = R.clock()
    local r = waitResult(400)
    battles = battles + 1
    if r == "胜利！" then wins = wins + 1 end
    local body = guiText("损失") or guiText("没损失")
    table.insert(log, string.format("%5.1f 分  第 %2d 关  %-6s %3.0f 秒  我方 $%-6d 敌方 $%-7d 现金 $%-9d %s", R.clock() / 60, lvl, tostring(r), R.clock() - tb0, mvalue, evalue, stat("现金"),
      body and body.Text:gsub("\n", " ") or ""))
    local h = button("^回基地$")
    if h then click(h) end
    if r ~= "胜利！" then
      nextFight = R.clock() + 60
      lostLast = true
    end
    R.run(4)
  end
  if #R.errors > 0 then break end
end
for _, line in ipairs(log) do print("  " .. line) end
local bl = {}
for _, bd in ipairs(Config.Buildings) do
  if builtAt[bd.id] then table.insert(bl, string.format("%s %.1f", bd.name, builtAt[bd.id])) end
end
print("  盖好的时间（分钟）：" .. table.concat(bl, "，"))
local built = 0
for _, bd in ipairs(Config.Buildings) do if owned(bd.id) then built = built + 1 end end
print(string.format("  %d 分钟后：第 %d 关，打了 %d 场赢 %d 场，盖了 %d/%d 栋，部队 %d 个，现金 $%d，军衔 %s", MINUTES, stat("关卡"), battles, wins, built, #Config.Buildings, #units(), stat("现金"), stat("军衔")))
check(#R.errors == 0, "连续玩没报错")
check(battles > 0 and wins > 0, "打赢过关卡")

print("== 退出、过一小时再进（存档、离线收益）")
local lvl, cashBefore, nb, nu = stat("关卡"), stat("现金"), built, #units()
local saves0 = R.saves or 0
R.removePlayer(pl)
R.run(1)
check((R.saves or 0) > saves0, "退出时存档了")
R.osTime = os.time() + 3600
n0 = #R.sent
pl = join("Tester", 1001)
R.run(5)
local built2 = 0
for _, bd in ipairs(Config.Buildings) do if owned(bd.id) then built2 = built2 + 1 end end
check(stat("关卡") == lvl and built2 == nb and #units() == nu, "关卡、建筑、部队都读回来了（第 " .. lvl .. " 关，" .. built2 .. " 栋，" .. #units() .. " 个）")
check(stat("现金") > cashBefore and toastSince(n0, "离线收益"), "有离线收益（$" .. cashBefore .. " → $" .. stat("现金") .. "）")
R.removePlayer(pl)
R.run(1)
R.osTime = nil

print("== 老玩家：首领关、拿枪、开坦克、开直升机")
n0 = #R.sent
pl = join("Veteran", 5005)
R.run(3)
check(stat("关卡") == 10 and #units() == 40, "读到老档：第 10 关、40 个兵")
check(guiText("首领×1") ~= nil, "第 10 关是首领关，敌军里有首领")
local anyMesh, tankModel = false, nil
for _, u in ipairs(units()) do
  if u:GetAttribute("Type") == "tank" then tankModel = u end
end
if tankModel then
  for _, d in ipairs(tankModel:GetDescendants()) do if d.ClassName == "MeshPart" then anyMesh = true end end
end
check(anyMesh and tankModel:FindFirstChild("TurretMotor", true) ~= nil, "坦克用的是导入的原模型，炮塔挂在 Motor6D 上")
do
  local mn, mx = math.huge, -math.huge
  local base = tankModel.Root.CFrame
  for _, d in ipairs(tankModel:GetDescendants()) do
    if d.ClassName == "MeshPart" then
      local lp = base:Inverse() * d.CFrame.Position
      local hz = d.Size.Z / 2
      mn, mx = math.min(mn, lp.Z - hz), math.max(mx, lp.Z + hz)
    end
  end
  check(math.abs((mx - mn) - Config.Units.tank.len) < 1.5, string.format("导入模型摆正、缩放到配置长度（%.1f 格，要 %d）", mx - mn, Config.Units.tank.len))
end
local heliModel
for _, u in ipairs(units()) do if u:GetAttribute("Type") == "heli" then heliModel = u end end
check(heliModel and heliModel:FindFirstChild("RotorMotor", true) and heliModel:FindFirstChild("TailMotor", true), "直升机的主旋翼、尾桨挂在 Motor6D 上")
-- 武器：四把都在
check(pl.Backpack:FindFirstChild("火箭筒") and pl.Backpack:FindFirstChild("狙击枪"), "买过的枪都发了")
click(button("^开战"))
R.run(1)
check(battleEvent(n0, "start") ~= nil, "首领关开打")
-- 开坦克
local tuid = tankModel:GetAttribute("Uid")
action("drive", tuid)
R.run(0.5)
check(battleEvent(n0, "drive") ~= nil and guiText("^下车") ~= nil, "坐进坦克（界面出现「下车」）")
local before2 = relPos(tankModel)
R.moveVec = V3(0, 0, -1)
R.run(2)
R.moveVec = nil
local after2 = relPos(tankModel)
check((after2 - before2).Magnitude > 20, string.format("开着坦克往前走了 %.0f 格", (after2 - before2).Magnitude))
R.as("client", function() R.services.UserInputService.InputBegan:Fire({ UserInputType = Enum.UserInputType.MouseButton1, Position = V3(640, 360, 0) }, false) end)
R.run(3)
R.as("client", function() R.services.UserInputService.InputEnded:Fire({ UserInputType = Enum.UserInputType.MouseButton1, Position = V3(640, 360, 0) }) end)
R.as("client", function() R.services.UserInputService.InputBegan:Fire({ KeyCode = Enum.KeyCode.F, UserInputType = Enum.UserInputType.Keyboard }, false) end)
R.run(0.5)
check(battleEvent(n0, "exit") ~= nil and pl.Character.HumanoidRootPart.Anchored == false, "按 F 下车，人回到战场")
-- 开直升机
action("drive", heliModel:GetAttribute("Uid"))
R.run(0.5)
R.moveVec = V3(0, 0, -1)
R.keys.Space = true
R.run(2)
R.keys.Space = nil
R.moveVec = nil
local hy = heliModel.Root.CFrame.Position.Y
check(hy > 60, string.format("开着直升机飞起来了（高度 %.0f）", hy))
action("exit")
-- 火箭筒
local rpg = pl.Backpack:FindFirstChild("火箭筒")
if pl.Character:FindFirstChildOfClass("Tool") then pl.Character:FindFirstChildOfClass("Tool").Parent = pl.Backpack end
rpg.Parent = pl.Character
R.run(0.2)
local tgt
for _, e in ipairs(plot().Enemies:GetChildren()) do if not e:GetAttribute("Dead") then tgt = e end end
if tgt then
  pl.Character.Head._p.CFrame = CF(tgt.Root.CFrame.Position + V3(0, 3, -60))
  R.as("client", function() remotes.Shoot:FireServer("rpg", tgt.Root.CFrame.Position + V3(0, 2, 0)) end)
  R.run(1)
end
local res2 = waitResult(400)
check(res2 ~= nil, "首领关打完：" .. tostring(res2))
click(button("^回基地$"))
check(#R.errors == 0, "老玩家这一段没报错")

print("== 突袭别人的防线（不在线的玩家）")
R.run(30)
n0 = #R.sent
local rating0 = tonumber((guiText("^突袭积分") or { Text = "0" }).Text:match("(%d+)"))
click(button("^突袭"))
R.run(3)
local st = battleEvent(n0, "start")
check(st ~= nil and tostring(st.title):find("的防线") ~= nil and not tostring(st.title):find("AI 指挥官"), "匹配到了一位真人玩家存下的防线：" .. tostring(st and st.title))
local res3 = waitResult(400)
check(res3 ~= nil, "突袭打完：" .. tostring(res3))
local rating1 = tonumber((guiText("^突袭积分") or { Text = "0" }).Text:match("(%d+)"))
check(rating1 ~= rating0, "积分变了（" .. tostring(rating0) .. " → " .. tostring(rating1) .. "）")
R.run(1)
local logged = false
for k, v in pairs(R.store) do
  if k:find("^MilitaryTycoon_raidlog_v1/") and type(v) == "table" and #v > 0 then logged = true end
end
check(logged, "对方的被突袭记录写上了")
click(button("^回基地$"))

print("== 约战（同服的另一个玩家）")
local rival = join("Rival", 6006, true)
R.run(2)
for _, t in ipairs({ "house1", "barracks" }) do
  R.run(40)
  touch(t, rival)
end
R.run(20)
actionAs(rival, "buy", "inf")
actionAs(rival, "buy", "inf")
R.run(25)
check(#units(rival) >= 1, "对手也有部队了（" .. #units(rival) .. " 个）")
n0 = #R.sent
action("duel", 6006)
local inv = nil
for i = n0 + 1, #R.sent do if R.sent[i].name == "Duel" then inv = R.sent[i].args[1] end end
check(inv ~= nil and inv.name == "Veteran", "对手收到约战邀请")
actionAs(rival, "duelYes", 5005)
R.run(1)
local ds = battleEvent(n0, "start")
check(ds ~= nil and ds.mode == "duel", "约战开打")
local arena = ws.Arenas.Arena1.Field.CFrame.Position
local rp = units(rival)[1].Root.CFrame.Position
check(math.abs(rp.X - arena.X) < 300 and math.abs(rp.Z - arena.Z) < 500, "对手的部队传到了竞技场")
local res4 = waitResult(400)
check(res4 ~= nil, "约战打完：" .. tostring(res4))
R.run(1)
check(#units(rival) >= 1 and relPos(units(rival)[1], rival).Z < Config.Field.deploy[2] + 5, "约战不损失部队，都回了自己基地")
click(button("^回基地$"))

print("== 任务、武器、重生、排行榜")
local mbtn = button("^任务")
click(mbtn)
check(guiText("每日任务") ~= nil, "打开任务面板")
local claim = button("^领 %$")
if claim then
  local c0 = stat("现金")
  click(claim)
  check(stat("现金") > c0, "领了任务奖励")
end
click(button("^×$"))
local lb = guiText("^1%. ")
check(plot().Board:FindFirstChildOfClass("SurfaceGui").Col2.Text:find("Name7007") ~= nil or plot().Board:FindFirstChildOfClass("SurfaceGui").Col1.Text:find("1%.") ~= nil, "基地里的排行榜牌子有数据")
local _ = lb
-- 重生：老档第 11 关、有银行 → 还不够 20 关；直接改存档里的关卡再进
R.removePlayer(pl)
R.run(1)
R.store[Config.SaveKey .. "/u5005"].level = 21
pl = join("Veteran", 5005)
R.run(3)
check(button("^重生$") ~= nil and button("^重生$").Visible, "第 21 关、有银行：出现「重生」")
click(button("^重生$"))
click(button("^确定重生$"))
R.run(1)
check(stat("关卡") == 1 and stat("现金") == Config.StartCash and #units() == 0 and #plot().Buildings:GetChildren() == 0, "重生：清零从头再来")
check(guiText("★1") ~= nil, "界面上显示重生 ★1")
touch("house1")
R.run(10)
check(stat("现金") > Config.StartCash - 60 + 5 * 10, "重生后收入有加成")
check(#R.errors == 0, "这一段没报错")
R.removePlayer(pl)
R.removePlayer(rival)
R.run(1)

print("== 存档服务坏了（比如 Studio 没开 API 访问）")
R.dsFail = true
local saves1 = R.saves or 0
n0 = #R.sent
pl = join("Studio", 2002)
R.run(8)
check(toastSince(n0, "存档没读到"), "提示「存档没读到」")
check(stat("现金") == Config.StartCash and plot().Pads:FindFirstChild("Pad_house1") ~= nil, "照样能玩（新档）")
touch("house1")
R.run(20)
touch("barracks")
R.run(30)
action("buy", "inf")
R.run(20)
n0 = #R.sent
click(button("^突袭"))
R.run(3)
local st5 = battleEvent(n0, "start")
check(st5 ~= nil and tostring(st5.title):find("AI 指挥官") ~= nil, "存档服务不可用时突袭打 AI 指挥官")
waitResult(300)
R.removePlayer(pl)
R.run(1)
check((R.saves or 0) == saves1, "读档失败时不存档（不会盖掉原来的进度）")
check(#R.errors == 0, "没报错")

print("== 七个人进一个六块地的服务器")
R.dsFail = false
R.localPlayer = nil
local list = {}
for i = 1, 7 do
  local p = R.addPlayer("P" .. i, 3000 + i)
  Players.PlayerAdded:Fire(p)
  table.insert(list, p)
end
R.run(3)
check(list[7]._kicked ~= nil, "第七个人被请出去（提示换服务器）")
check(#R.errors == 0, "多人没报错")

if #R.warns > 0 then
  print("== warn 输出")
  local seen = {}
  for _, w in ipairs(R.warns) do
    if not seen[w] then seen[w] = true print("  " .. w) end
  end
end
print(string.format("\n== %d 个检查没通过，%d 个脚本错误", #fails, #R.errors))
if #fails > 0 or #R.errors > 0 then os.exit(1) end
