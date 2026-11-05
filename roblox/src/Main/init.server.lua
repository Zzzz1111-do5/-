-- 军事大亨：服务器主脚本（ServerScriptService.Main）
-- 各模块共用一个上下文 G：每个模块的 init(G) 把自己的函数挂到 G 上，模块之间通过 G 互相调用（不互相 require，免得循环引用）
--   World 地图 · Store 存档 / 排行榜 / 突袭匹配 · Economy 经济与成长 · Army 平时的部队 · Combat 战斗 · Weapons 玩家的枪
--   Models 模型 · Battle 推演
local Players = game:GetService("Players")
local RS = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local Config = require(RS:WaitForChild("Config"))
local G = {
  Config = Config,
  Models = require(script:WaitForChild("Models")),
  Battle = require(script:WaitForChild("Battle")),
  states = {},   -- [player] = st
}
local V = Vector3.new

Players.CharacterAutoLoads = false   -- 分到基地以后再生成角色，出生在自己基地里

---------------------------------------------------------------- 远程事件

local Remotes = Instance.new("Folder")
Remotes.Name = "Remotes"
G.R = {}
for _, name in ipairs({ "State", "Toast", "Action", "Fx", "Battle", "Shoot", "Drive", "Duel", "Board" }) do
  local r = Instance.new("RemoteEvent")
  r.Name = name
  r.Parent = Remotes
  G.R[name] = r
end
Remotes.Parent = RS

local fxq = {}
function G.fx(e)
  fxq[#fxq + 1] = e
end
function G.toast(st, msg, kind)
  G.R.Toast:FireClient(st.pl, msg, kind or "info")
end

-- 先收导入的原模型（在铺地形、建地图之前：没锚定的模型别掉下去砸在地上散开）
local imported = G.Models.loadImported()
if #imported > 0 then print("[军事大亨] 用上了导入的原模型：" .. table.concat(imported, "、")) end
for _, name in ipairs({ "World", "Store", "Economy", "Army", "Combat", "Weapons" }) do
  require(script:WaitForChild(name)).init(G)
end

local BDEF = Config.BuildingById

---------------------------------------------------------------- 发给客户端的状态

function G.push(st)
  local d = st.data
  if not d then return end
  local counts = {}
  for _, u in pairs(st.units) do counts[u.t] = (counts[u.t] or 0) + 1 end
  local enemy = {}
  for _, e in ipairs(st.enemy) do enemy[e.t] = (enemy[e.t] or 0) + 1 end
  local hqNext = nil
  if d.owned.hq and d.hq < #BDEF.hq.cap then hqNext = BDEF.hq.up[d.hq] end
  local techNext = nil
  if d.tech < Config.Tech.max then techNext = Config.TechCost(d.tech) end
  local rank, ri = Config.RankOf(d.xp)
  local nextXp = Config.Ranks[ri + 1] and Config.Ranks[ri + 1][1] or nil
  G.missionsFresh(st)
  local ms = {}
  for i, m in ipairs(d.missions.list) do
    local def = G.missionDef[m.id]
    if def then ms[i] = { text = def.text, goal = def.goal, prog = m.prog, claimed = m.claimed } end
  end
  local dOK, dAmt, dStreak = G.dailyInfo(st)
  local weapons = {}
  for id in pairs(d.weapons) do weapons[id] = true end
  local B = st.battle
  G.R.State:FireClient(st.pl, {
    cash = d.cash, income = st.income, level = d.level, best = d.best, cap = G.capOf(d), n = G.count(st), counts = counts,
    owned = d.owned, hq = d.hq, hqNext = hqNext, tech = d.tech, techNext = techNext, plot = st.plot.index, origin = st.plot.origin,
    battle = B ~= nil, mode = B and B.mode or nil, enemy = enemy, reward = Config.Reward(d.level), save = st.canSave,
    rebirth = d.rebirth, canRebirth = G.canRebirth(d), xp = d.xp, rank = rank, nextXp = nextXp, rating = d.rating, kills = d.kills,
    weapons = weapons, daily = { ok = dOK, amount = dAmt, streak = dStreak }, missions = ms, missionReward = G.missionReward(st),
    raidCD = math.max(0, math.ceil((st.raidCD or 0) - os.clock())), power = G.powerOf(d),
  })
  if st.ls then
    st.ls.cash.Value = math.floor(d.cash)
    st.ls.level.Value = d.level
    st.ls.rank.Value = rank
  end
  st.dirty = false
end

---------------------------------------------------------------- 进出服务器

local function spawnChar(st)
  if G.states[st.pl] ~= st or not st.pl.Parent then return end
  local ok, err = pcall(function() st.pl:LoadCharacter() end)
  if not ok then warn("[军事大亨] 生成角色失败：" .. tostring(err)) end
end

local function onCharacter(st, char)
  local hrp = char:WaitForChild("HumanoidRootPart", 10)
  if hrp and G.states[st.pl] == st then
    task.wait()
    local S, o = Config.Spawn, st.plot.origin
    char:PivotTo(CFrame.lookAt(o + V(S.x, 5, S.z), o + V(S.x, 5, S.z + 10)))
  end
  local hum = char:FindFirstChildOfClass("Humanoid") or char:WaitForChild("Humanoid", 10)
  if hum then
    hum.Died:Connect(function()
      if st.driving then G.driveStop(st) end
      task.wait(Config.Hero.respawn)
      if G.states[st.pl] == st and st.pl.Character == char then spawnChar(st) end
    end)
  end
  if G.states[st.pl] == st and st.data then
    G.giveTools(st)
    G.rankTag(st)
  end
end

local function onPlayer(pl)
  if G.states[pl] then return end
  local plot = nil
  for _, p in ipairs(G.plots) do
    if not p.owner then
      plot = p
      break
    end
  end
  if not plot then
    pl:Kick("这个服务器的基地都有人了，换一个服务器吧")
    return
  end
  plot.owner = pl
  plot.sign.Text = pl.DisplayName .. " 的基地"
  local st = { pl = pl, plot = plot, units = {}, enemy = {}, pads = {}, padT = {}, nextUid = 0, income = 0, ready = false, canSave = false }
  G.states[pl] = st
  -- 排行榜（右上角玩家列表里显示）
  local ls = Instance.new("Folder")
  ls.Name = "leaderstats"
  local lv = Instance.new("IntValue")
  lv.Name = "关卡"
  lv.Value = 1
  lv.Parent = ls
  local cash = Instance.new("IntValue")
  cash.Name = "现金"
  cash.Parent = ls
  local rk = Instance.new("StringValue")
  rk.Name = "军衔"
  rk.Value = Config.Ranks[1][2]
  rk.Parent = ls
  ls.Parent = pl
  st.ls = { level = lv, cash = cash, rank = rk }
  pl.CharacterAdded:Connect(function(char) onCharacter(st, char) end)

  local raw, ok = G.loadData(pl)
  if G.states[pl] ~= st then return end   -- 读档的时候人走了
  st.data = G.cleanData(raw)
  st.canSave = ok
  local d = st.data
  G.econSetup(st)
  G.armySetup(st)
  G.makeEnemy(st)
  -- 离线收益：按在线的 OfflineRate 成，最多算 OfflineHours 小时
  local away = 0
  if type(raw) == "table" and type(raw.t) == "number" then away = os.time() - raw.t end
  if away > 60 and st.income > 0 then
    local earn = math.floor(st.income * math.min(away, Config.OfflineHours * 3600) * Config.OfflineRate)
    d.cash = d.cash + earn
    task.delay(4, function()
      if G.states[pl] == st then
        local h = (away >= 3600) and (math.floor(away / 3600) .. " 小时 " .. math.floor(away % 3600 / 60) .. " 分") or (math.floor(away / 60) .. " 分钟")
        G.toast(st, "离线收益 +$" .. Config.Fmt(earn) .. "（离开了 " .. h .. "）", "good")
      end
    end)
  end
  st.ready = true
  G.push(st)
  if pl.Character then task.spawn(onCharacter, st, pl.Character) else spawnChar(st) end
  task.delay(2, function()
    if G.states[pl] ~= st then return end
    if not ok then
      G.toast(st, "存档没读到，这次的进度不会保存（在 Studio 里测试：先发布，再在游戏设置 → 安全里打开 API 访问）", "bad")
    end
    if type(raw) ~= "table" then
      G.toast(st, "欢迎来到军事大亨！踩绿色按钮盖楼，楼会一直给你赚钱", "info")
      task.wait(6)
      if G.states[pl] == st then G.toast(st, "盖好兵营就能生产部队：右边「兵工厂」，或者走到兵营旁按 E", "info") end
      task.wait(6)
      if G.states[pl] == st then G.toast(st, "点「开战」打这一关；你本人也会上战场——拿着枪（物理栏 1）一起打，还能开自己的坦克", "info") end
    else
      local log = G.readRaidLog(pl)
      if log and G.states[pl] == st then
        local held = 0
        for _, e in ipairs(log) do
          if type(e) == "table" and e.w then held = held + 1 end
        end
        G.toast(st, "你不在的时候防线被突袭了 " .. #log .. " 次，守住 " .. held .. " 次", (held * 2 >= #log) and "good" or "bad")
      end
    end
  end)
end

Players.PlayerAdded:Connect(onPlayer)
for _, pl in ipairs(Players:GetPlayers()) do task.spawn(onPlayer, pl) end

Players.PlayerRemoving:Connect(function(pl)
  local st = G.states[pl]
  if not st then return end
  if st.battle then G.abandon(st) end
  st.battle = nil
  if st.ready then G.save(st) end
  G.states[pl] = nil
  local plot = st.plot
  for _, name in ipairs({ "Buildings", "Pads", "Units", "Enemies" }) do plot[name]:ClearAllChildren() end
  plot.owner = nil
  plot.sign.Text = "空基地"
end)

game:BindToClose(function()
  local list = {}
  for _, st in pairs(G.states) do table.insert(list, st) end
  for _, st in ipairs(list) do
    if st.ready then G.save(st) end
  end
end)

---------------------------------------------------------------- 客户端发来的操作

local ACT = {
  buy = function(st, a) G.buyUnit(st, a) end,
  move = function(st, a, b, c) G.moveUnit(st, a, b, c) end,
  sell = function(st, a) G.sellUnit(st, a) end,
  arrange = function(st) G.arrange(st) end,
  battle = function(st) G.startBattle(st) end,
  raid = function(st) G.startRaid(st) end,
  duel = function(st, a) G.duelInvite(st, a) end,
  duelYes = function(st, a) G.duelAnswer(st, a, true) end,
  duelNo = function(st, a) G.duelAnswer(st, a, false) end,
  hq = function(st) G.upgradeHQ(st) end,
  tech = function(st) G.upgradeTech(st) end,
  rebirth = function(st) G.rebirth(st) end,
  daily = function(st) G.claimDaily(st) end,
  mission = function(st, a) G.claimMission(st, a) end,
  weapon = function(st, a) G.buyWeapon(st, a) end,
  reload = function(st, a) G.reload(st, a) end,
  drive = function(st, a) G.driveStart(st, a) end,
  exit = function(st) G.driveStop(st) end,
  rejoin = function(st) G.heroJoin(st) end,
  home = function(st) G.sendHome(st) end,
}
G.R.Action.OnServerEvent:Connect(function(pl, op, a, b, c)
  local st = G.states[pl]
  if not st or not st.ready or type(op) ~= "string" then return end
  -- 限流：每秒十来次
  local now = os.clock()
  st.tokens = math.min(15, (st.tokens or 15) + (now - (st.tokT or now)) * 10)
  st.tokT = now
  if st.tokens < 1 then return end
  st.tokens = st.tokens - 1
  local f = ACT[op]
  if f then f(st, a, b, c) end
end)

G.R.Shoot.OnServerEvent:Connect(function(pl, id, aim)
  local st = G.states[pl]
  if st and type(id) == "string" then G.shoot(st, id, aim) end
end)

G.R.Drive.OnServerEvent:Connect(function(pl, d)
  local st = G.states[pl]
  if not st or type(d) ~= "table" then return end
  G.driveInput(st, d)
  if d.fire ~= nil then G.driveFire(st, d.fire) end
end)

---------------------------------------------------------------- 循环

-- 每秒：收入、按钮颜色、状态
task.spawn(function()
  while true do
    task.wait(1)
    for _, st in pairs(G.states) do
      if st.ready and st.data then
        G.econTick(st)
        G.push(st)
      end
    end
  end
end)

-- 自动存档
task.spawn(function()
  while true do
    task.wait(90)
    local list = {}
    for _, st in pairs(G.states) do table.insert(list, st) end
    for _, st in ipairs(list) do
      if G.states[st.pl] == st and st.ready then G.save(st) end
    end
  end
end)

-- 排行榜：每分钟刷新一次牌子和界面
task.spawn(function()
  task.wait(8)
  while true do
    local lv, rt = G.readBoards()
    local function lines(title, list)
      local out = { title }
      for i, e in ipairs(list) do table.insert(out, i .. ". " .. e.name .. "  " .. Config.Fmt(e.value)) end
      if #list == 0 then table.insert(out, "（暂无）") end
      return table.concat(out, "\n")
    end
    local t1, t2 = lines("最高关卡", lv), lines("突袭积分", rt)
    for _, p in ipairs(G.plots) do
      p.board[1].Text = t1
      p.board[2].Text = t2
    end
    G.R.Board:FireAllClients({ level = lv, rating = rt })
    task.wait(60)
  end
end)

-- 每帧：平时的部队开来开去；特效攒一帧发一次
RunService.Heartbeat:Connect(function(dt)
  G.armyStep(dt)
  if #fxq > 0 then
    G.R.Fx:FireAllClients(fxq)
    fxq = {}
  end
end)
