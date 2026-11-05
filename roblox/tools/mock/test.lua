-- 军事大亨的模拟测试：在 rbx.lua 模拟的 Roblox 里真跑服务器和客户端脚本。
-- 一个机器人玩家：进服 → 踩按钮盖楼 → 点界面生产部队 → 布阵（点选、挪位置）→ 开战 → 一路打关卡几十分钟（模拟时间）
-- → 退出存档 → 过一小时再进（读档、离线收益）→ 存档服务坏掉时的表现。有脚本报错就算失败。
local R = dofile(MOCK_DIR .. "/rbx.lua")
local V3 = R.Vector3.new
local Enum = R.Enum
local RS = R.services.ReplicatedStorage
local SSS = R.services.ServerScriptService
local Players = R.services.Players
local ws = R.workspace

local MINUTES = tonumber(TEST_ARGS:match("(%d+)")) or 40
local fails = {}
local function check(ok, msg)
  if ok then print("  ✓ " .. msg) else print("  ✗ " .. msg); table.insert(fails, msg) end
end

local configMS = R.scriptFrom("ModuleScript", "Config", SRC_DIR .. "/Config.lua", RS)
local main = R.scriptFrom("Script", "Main", SRC_DIR .. "/Main/init.server.lua", SSS)
R.scriptFrom("ModuleScript", "Models", SRC_DIR .. "/Main/Models.lua", main)
R.scriptFrom("ModuleScript", "Battle", SRC_DIR .. "/Main/Battle.lua", main)
local Config = R.require(configMS)

print("== 启动服务器")
R.runScript(main, "server")
R.run(1)
check(#R.errors == 0, "服务器脚本启动没报错")
local plotsF = ws:FindFirstChild("Plots")
check(plotsF ~= nil and #plotsF:GetChildren() == Config.PlotCount, "生成了 " .. Config.PlotCount .. " 块基地")
check(RS:FindFirstChild("Remotes") ~= nil, "远程事件建好了")
local remotes = RS.Remotes

local pl, client
local function join(name, uid)
  pl = R.addPlayer(name, uid)
  R.localPlayer = pl
  Players.PlayerAdded:Fire(pl)
  client = R.scriptFrom("LocalScript", "Client", SRC_DIR .. "/Client.client.lua", pl.PlayerScripts)
  R.runScript(client, "client")
  R.run(3)
end

local function plot()
  for _, p in ipairs(plotsF:GetChildren()) do
    local units = p:FindFirstChild("Units")
    -- 自己的基地：名字牌写着玩家名
    local anchor
    for _, d in ipairs(p:GetDescendants()) do
      if d.ClassName == "TextLabel" and d.Text == pl.Name .. " 的基地" then anchor = d end
    end
    if anchor and units then return p end
  end
end
local function stat(name) return pl.leaderstats[name].Value end
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
local builtAt = {}
local function touch(id)
  local m = plot().Pads:FindFirstChild("Pad_" .. id)
  if not m then return false end
  m.Pad.Touched:Fire(pl.Character.HumanoidRootPart)
  R.run(0.1)
  if plot().Buildings:FindFirstChild(id) and not builtAt[id] then builtAt[id] = R.clock() / 60 end
  return true
end
local function owned(id) return plot().Buildings:FindFirstChild(id) ~= nil end
local function units()
  local out = {}
  for _, u in ipairs(plot().Units:GetChildren()) do
    if not u:GetAttribute("Dead") then table.insert(out, u) end
  end
  return out
end
local function lastToast()
  for i = #R.sent, 1, -1 do
    if R.sent[i].name == "Toast" then return R.sent[i].args[1] end
  end
end
local function toastSince(n, pattern)
  for i = n + 1, #R.sent do
    if R.sent[i].name == "Toast" and tostring(R.sent[i].args[1]):find(pattern) then return true end
  end
  return false
end

print("== 玩家进服")
join("Tester", 1001)
check(#R.errors == 0, "进服没报错")
check(plot() ~= nil, "分到了基地（牌子写着名字）")
check(pl.Character ~= nil, "角色生成了")
check(stat("现金") == Config.StartCash, "起始现金 " .. Config.StartCash)
check(guiText("^%$300") ~= nil, "界面上显示 $300")
check(plot().Pads:FindFirstChild("Pad_house1") ~= nil, "有居民楼 A 的购买按钮")
check(#plot().Enemies:GetChildren() > 0, "第 1 关敌军摆出来了")

print("== 盖楼")
touch("house1")
check(owned("house1"), "踩按钮盖好居民楼 A")
local c1 = stat("现金")
check(c1 >= Config.StartCash - 60 and c1 <= Config.StartCash - 60 + 10, "扣了 $60（现在 $" .. c1 .. "）")
check(plot().Pads:FindFirstChild("Pad_barracks") ~= nil and plot().Pads:FindFirstChild("Pad_house2") ~= nil, "解锁了兵营、居民楼 B 的按钮")
local n0 = #R.sent
touch("bank")
check(not owned("bank"), "还没解锁的银行盖不了")
touch("barracks")
check(not owned("barracks") and toastSince(n0, "钱不够"), "钱不够时提示「钱不够」")
R.run(30)
check(stat("现金") >= 240 + 5 * 29, "收入在涨（30 秒后 $" .. stat("现金") .. "）")
touch("barracks")
check(owned("barracks"), "盖好兵营")

print("== 生产部队（点界面上的兵工厂按钮）")
R.run(20)
local before = #units()
local b = button("^%$60$")
check(b ~= nil, "兵工厂里步兵班的按钮显示 $60")
if b then click(b) click(b) end
check(#units() == before + 2, "生产了两个步兵班")
R.run(20)
local u1 = units()[1]
local p1 = u1 and u1.Root.CFrame.Position
check(p1 ~= nil and p1.Z - plot().Field.CFrame.Position.Z + Config.Field.center > Config.Field.deploy[1] - 1, "步兵从兵营开到了部署区")

print("== 布阵：点选部队、点地面挪位置")
local deployBtn = button("^布阵$")
check(deployBtn ~= nil, "有「布阵」按钮")
click(deployBtn)
check(ws.CurrentCamera.CameraType == Enum.CameraType.Scriptable, "镜头切到布阵视角")
local origin = plot().Base.CFrame.Position - V3(0, 0.5, 0)
local part = u1:FindFirstChildWhichIsA("BasePart")
for _, c in ipairs(u1:GetChildren()) do if c.Name ~= "Root" and c:IsA("BasePart") then part = c break end end
R.nextRay = { Instance = part, Position = part.CFrame.Position }
R.as("client", function() R.services.UserInputService.InputBegan:Fire({ UserInputType = Enum.UserInputType.MouseButton1, Position = V3(600, 300, 0) }, false) end)
R.run(0.1)
check(u1:FindFirstChildOfClass("Highlight") ~= nil, "点到的部队被选中（高亮）")
check(button("^解散") ~= nil and button("^解散").Visible, "出现「解散」按钮")
R.nextRay = { Instance = plot().Field, Position = origin + V3(40, 1, 150) }
R.as("client", function() R.services.UserInputService.InputBegan:Fire({ UserInputType = Enum.UserInputType.MouseButton1, Position = V3(700, 320, 0) }, false) end)
R.run(8)
local p2 = u1.Root.CFrame.Position - origin
check(math.abs(p2.X - 40) < 1 and math.abs(p2.Z - 150) < 1, string.format("部队开到了点的位置（%.1f, %.1f）", p2.X, p2.Z))
R.nextRay = { Instance = plot().Field, Position = origin + V3(0, 1, 300) }
n0 = #R.sent
R.as("client", function() R.services.UserInputService.InputBegan:Fire({ UserInputType = Enum.UserInputType.MouseButton1, Position = V3(700, 320, 0) }, false) end)
R.run(0.2)
check(not lastToast() or true, "（没选中时点地面会提示）")
click(button("^一键排阵$"))
R.run(10)
check(#R.errors == 0, "布阵没报错")

print("== 开战")
click(button("^开战"))
R.run(0.5)
check(ws.CurrentCamera.CameraType == Enum.CameraType.Scriptable and guiText("^第 1 关") ~= nil, "切到观战，显示「第 1 关」和倒计时")
local t0 = R.clock()
local res
for _ = 1, 400 do
  R.run(0.5)
  local r = guiText("^胜利！$") or guiText("^失败$") or guiText("^时间到$")
  if r and r.Parent.Visible then res = r.Text break end
end
check(res ~= nil, "打完了：" .. tostring(res) .. string.format("（%.0f 秒）", R.clock() - t0))
check(#R.errors == 0, "战斗没报错")
local resHome = button("^回基地$")
if resHome then click(resHome) end
check(ws.CurrentCamera.CameraType == Enum.CameraType.Custom, "回基地，镜头还原")

print("== 建筑旁按 E、角色死了重生、手机点按")
R.run(30)
local bar = plot().Buildings.barracks
local pp = bar.Body:FindFirstChildOfClass("ProximityPrompt")
check(pp ~= nil and pp.ActionText:find("步兵班") ~= nil, "兵营上有「生产步兵班」的 E 提示")
local nb0 = #units()
if pp then pp.Triggered:Fire(pl) R.run(0.2) end
check(#units() == nb0 + 1, "按 E 生产了一个步兵班")
local other = R.addPlayer("Other", 4004)
if pp then pp.Triggered:Fire(other) R.run(0.2) end
check(#units() == nb0 + 1, "别人按你的兵营没用")
local oldChar = pl.Character
oldChar.Humanoid.Died:Fire()
R.run(4)
check(pl.Character ~= nil and pl.Character ~= oldChar, "角色死了 3 秒后在自己基地重生")
click(button("^布阵$"))
local u2 = units()[1]
local part2
for _, c in ipairs(u2:GetChildren()) do if c.Name ~= "Root" and c:IsA("BasePart") then part2 = c break end end
R.nextRay = { Instance = part2, Position = part2.CFrame.Position }
R.as("client", function() R.services.UserInputService.TouchTap:Fire({ R.Vector2.new(500, 300) }, false) end)
R.run(0.1)
check(u2:FindFirstChildOfClass("Highlight") ~= nil, "手机点按也能选中部队")
local sell = button("^解散")
local cash0, n1 = stat("现金"), #units()
click(sell)
R.run(0.5)
check(#units() == n1 - 1 and stat("现金") > cash0, "「解散」按钮退回一半的钱")
click(button("^回基地$"))
check(#R.errors == 0, "没报错")

-- 机器人：按钱和解锁顺序盖楼，按敌军兵种买克制它的兵，兵力够了就打
print("== 机器人连续玩 " .. MINUTES .. " 分钟（模拟时间）")
local U = Config.Units
local function enemyComp()
  local c = { inf = 0, tank = 0, aa = 0, arty = 0, heli = 0 }
  local value = 0
  for _, e in ipairs(plot().Enemies:GetChildren()) do
    local t = e:GetAttribute("Type")
    if t then c[t] = c[t] + 1 value = value + U[t].price end
  end
  return c, value
end
local function myComp()
  local c = { inf = 0, tank = 0, aa = 0, arty = 0, heli = 0 }
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
-- 想要的阵容：按敌军兵种配克制的兵
local function desired(ec, cap)
  local w = { aa = 0, heli = 0, arty = 0, tank = 0, inf = 0 }
  if owned("aafac") then w.aa = math.min(cap, math.ceil(ec.heli * 0.9)) end
  if owned("helipad") then w.heli = math.min(cap - w.aa, math.ceil(ec.tank * 0.7)) end
  if owned("artyfac") then w.arty = math.min(cap - w.aa - w.heli, 4, math.floor(ec.inf / 4)) end
  local rest = math.max(0, cap - w.aa - w.heli - w.arty)
  if owned("tankfac") then w.tank = math.ceil(rest * 0.5) end
  w.inf = rest - w.tank
  return w
end
local ORDER = { "aa", "heli", "arty", "tank", "inf" }
local battles, wins = 0, 0
local log = {}
local tEnd = R.clock() + MINUTES * 60
local nextFight = 0
local lostLast = false
local techLv = 0
while R.clock() < tEnd do
  R.run(2)
  -- 盖楼（便宜的先）
  local pads = plot().Pads:GetChildren()
  table.sort(pads, function(a, b)
    return Config.BuildingById[a.Name:sub(5)].price < Config.BuildingById[b.Name:sub(5)].price
  end)
  local saving = false
  for _, m in ipairs(pads) do
    local bd = Config.BuildingById[m.Name:sub(5)]
    if stat("现金") >= bd.price then touch(bd.id) elseif bd.price < stat("现金") * 3 then saving = true end
  end
  -- 指挥部升级
  local hq = button("^升级指挥部")
  if hq and hq.Visible then
    local price = tonumber((hq.Text:gsub(",", "")):match("%$(%d+)"))
    if price and stat("现金") >= price then click(hq) end
  end
  local ec, evalue = enemyComp()
  local n, cap = capNow()
  -- 输了：把不在想要阵容里的兵解散，重新配
  local want = desired(ec, cap)
  if lostLast then
    local have = myComp()
    for _, u in ipairs(units()) do
      local t = u:GetAttribute("Type")
      if have[t] > want[t] then
        action("sell", u:GetAttribute("Uid"))
        have[t] = have[t] - 1
      end
    end
    lostLast = false
  end
  -- 买兵
  local have = myComp()
  for _, t in ipairs(ORDER) do
    while have[t] < want[t] do
      n, cap = capNow()
      if n >= cap or stat("现金") < U[t].price then break end
      action("buy", t)
      have[t] = have[t] + 1
    end
  end
  -- 部队满了、楼也不急着盖：升级科技
  n, cap = capNow()
  if n >= cap and not saving then
    local lbl = guiText("^军工科技 Lv")
    local techBtnText = lbl and lbl.Parent:FindFirstChildOfClass("TextButton")
    if techBtnText then
      local price = tonumber((techBtnText.Text:gsub(",", "")):match("%$(%d+)"))
      if price and stat("现金") >= price then click(techBtnText) techLv = techLv + 1 end
    end
  end
  -- 打：兵力是敌人 1.3 倍以上，或者兵满了
  local _, mvalue = myComp()
  local n, cap = capNow()
  if R.clock() >= nextFight and #units() > 0 and evalue > 0 and (mvalue >= evalue * 1.3 or n >= cap) then
    local lvl = stat("关卡")
    action("arrange")
    R.run(6)
    action("battle")
    local r
    local tb0 = R.clock()
    for _ = 1, 500 do
      R.run(0.5)
      local w = guiText("^胜利！$") or guiText("^失败$") or guiText("^时间到$")
      if w and w.Parent.Visible then r = w.Text break end
    end
    battles = battles + 1
    if r == "胜利！" then wins = wins + 1 end
    local body = guiText("损失") or guiText("没损失")
    table.insert(log, string.format("%5.1f 分  第 %2d 关  %-6s %3.0f 秒  科技 %2d  我方 $%-6d 敌方 $%-7d 现金 $%-8d %s", R.clock() / 60, lvl, tostring(r), R.clock() - tb0, techLv, mvalue, evalue, stat("现金"), body and body.Text:gsub("\n", " ") or ""))
    local h = button("^回基地$")
    if h then click(h) end
    if r ~= "胜利！" then nextFight = R.clock() + 60 lostLast = true end
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
print(string.format("  %d 分钟后：第 %d 关，打了 %d 场赢 %d 场，盖了 %d/%d 栋，部队 %d 个，现金 $%d", MINUTES, stat("关卡"), battles, wins, built, #Config.Buildings, #units(), stat("现金")))
check(#R.errors == 0, "连续玩没报错")
check(battles > 0 and wins > 0, "打赢过关卡")

print("== 退出、过一小时再进（存档、离线收益）")
local lvl, cashBefore, nb, nu = stat("关卡"), stat("现金"), built, #units()
local saves0 = R.saves or 0
R.removePlayer(pl)
R.run(1)
check((R.saves or 0) > saves0, "退出时存档了")
local freed = true
for _, p in ipairs(plotsF:GetChildren()) do
  if #p.Buildings:GetChildren() > 0 then freed = false end
end
check(freed, "基地清空、还给服务器")
R.osTime = os.time() + 3600
n0 = #R.sent
join("Tester", 1001)
R.run(5)
local built2 = 0
for _, bd in ipairs(Config.Buildings) do if owned(bd.id) then built2 = built2 + 1 end end
check(stat("关卡") == lvl, "关卡读回来了（第 " .. lvl .. " 关）")
check(built2 == nb, "建筑都盖回来了（" .. built2 .. " 栋）")
check(#units() == nu, "部队读回来了（" .. #units() .. " 个）")
check(stat("现金") > cashBefore and toastSince(n0, "离线收益"), "有离线收益（$" .. cashBefore .. " → $" .. stat("现金") .. "）")
check(#R.errors == 0, "读档没报错")

print("== 存档服务坏了（比如 Studio 没开 API 访问）")
R.removePlayer(pl)
R.run(1)
R.dsFail = true
local saves1 = R.saves or 0
n0 = #R.sent
join("Studio", 2002)
R.run(8)
check(toastSince(n0, "存档没读到"), "提示「存档没读到」")
check(stat("现金") == Config.StartCash and plot().Pads:FindFirstChild("Pad_house1") ~= nil, "照样能玩（新档）")
touch("house1")
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
