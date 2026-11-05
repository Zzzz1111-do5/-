-- 军事大亨：服务器主脚本（ServerScriptService.Main）
-- 生成地图和基地；大亨经济（踩按钮盖楼、每秒收入、离线收益、存档）；生产部队（从工厂开出来，停到前面的部署区）、布阵；
-- 打 AI 关卡（推演在 Battle 模块，零件模型在 Models 模块）
local Players = game:GetService("Players")
local RS = game:GetService("ReplicatedStorage")
local DSS = game:GetService("DataStoreService")
local Lighting = game:GetService("Lighting")
local RunService = game:GetService("RunService")
local Debris = game:GetService("Debris")

local Config = require(RS:WaitForChild("Config"))
local Models = require(script:WaitForChild("Models"))
local Battle = require(script:WaitForChild("Battle"))

local V = Vector3.new
local F = Config.Field
local BDEF = Config.BuildingById
local UNITS = Config.Units
local GREEN = Color3.fromRGB(70, 220, 100)
local RED = Color3.fromRGB(225, 70, 60)

Players.CharacterAutoLoads = false   -- 分到基地以后再生成角色，出生在自己基地里

---------------------------------------------------------------- 远程事件

local Remotes = Instance.new("Folder")
Remotes.Name = "Remotes"
local function remote(name)
  local r = Instance.new("RemoteEvent")
  r.Name = name
  r.Parent = Remotes
  return r
end
local RState = remote("State")     -- 服务器 → 客户端：钱、关卡、部队等（每秒一次、有变化时）
local RToast = remote("Toast")     -- 服务器 → 客户端：提示文字
local RAction = remote("Action")   -- 客户端 → 服务器：生产、布阵、开战……
local RFx = remote("Fx")           -- 服务器 → 所有客户端：开火、爆炸、建成的特效（客户端自己画）
local RBattle = remote("Battle")   -- 服务器 → 客户端：开战、战况、结果
Remotes.Parent = RS

---------------------------------------------------------------- 地图

Lighting.ClockTime = 14.3
Lighting.Brightness = 2.4
Lighting.GlobalShadows = true
Lighting.OutdoorAmbient = Color3.fromRGB(125, 128, 135)
Lighting.EnvironmentDiffuseScale = 0.6
Lighting.EnvironmentSpecularScale = 0.6
if not Lighting:FindFirstChildOfClass("Atmosphere") then
  local atm = Instance.new("Atmosphere")
  atm.Density = 0.3
  atm.Offset = 0.15
  atm.Haze = 1.4
  atm.Glare = 0.2
  atm.Color = Color3.fromRGB(198, 210, 226)
  atm.Decay = Color3.fromRGB(106, 118, 140)
  atm.Parent = Lighting
end

-- 地面：地形草地，顶面在 y = 0（分块填，单次别太大）
do
  local T = workspace.Terrain
  local half = Config.PlotCount * Config.PlotSpacing / 2 + 300
  local z0 = -Config.BaseSize / 2 - 120
  local z1 = F.center + F.length / 2 + 200
  local x = -half
  while x < half do
    local w = math.min(512, half - x)
    T:FillBlock(CFrame.new(x + w / 2, -6, (z0 + z1) / 2), V(w, 12, z1 - z0), Enum.Material.Grass)
    x = x + w
  end
end

local PlotsF = Instance.new("Folder")
PlotsF.Name = "Plots"
PlotsF.Parent = workspace
local plots = {}
for i = 1, Config.PlotCount do
  local cx = (i - (Config.PlotCount + 1) / 2) * Config.PlotSpacing
  local f = Instance.new("Folder")
  f.Name = "Plot" .. i
  local plot = { index = i, origin = V(cx, 0, 0), folder = f, color = Config.PlotColors[i] or Color3.new(1, 1, 1) }
  local info = Models.plot(f, plot.origin, plot.color, i)
  plot.field = info.field
  plot.sign = info.sign
  for _, name in ipairs({ "Buildings", "Pads", "Units", "Enemies" }) do
    local sub = Instance.new("Folder")
    sub.Name = name
    sub.Parent = f
    plot[name] = sub
  end
  f.Parent = PlotsF
  plots[i] = plot
end

---------------------------------------------------------------- 数据

local states = {}   -- [player] = st：{ pl, plot, data, units = { [uid] = u }, enemy = {…}, battle, income, … }

local function newData()
  return { cash = Config.StartCash, level = 1, owned = {}, hq = 0, tech = 0, army = {}, wins = 0 }
end

-- 读到的存档逐项检查（坏数据、改过的配置都别让脚本出错）
local function cleanData(raw)
  local d = newData()
  if type(raw) ~= "table" then return d end
  if type(raw.cash) == "number" and raw.cash == raw.cash then d.cash = math.max(0, raw.cash) end
  if type(raw.level) == "number" and raw.level == raw.level then d.level = math.max(1, math.floor(raw.level)) end
  if type(raw.wins) == "number" then d.wins = raw.wins end
  if type(raw.tech) == "number" and raw.tech == raw.tech then d.tech = math.clamp(math.floor(raw.tech), 0, Config.Tech.max) end
  if type(raw.owned) == "table" then
    for id, v in pairs(raw.owned) do
      if BDEF[id] and v then d.owned[id] = true end
    end
  end
  if type(raw.hq) == "number" then d.hq = math.clamp(math.floor(raw.hq), 0, #BDEF.hq.cap) end
  if d.owned.hq then d.hq = math.max(1, d.hq) else d.hq = 0 end
  if type(raw.army) == "table" then
    for _, a in ipairs(raw.army) do
      if type(a) == "table" and UNITS[a.t] and type(a.x) == "number" and type(a.z) == "number" then
        table.insert(d.army, { t = a.t, x = a.x, z = a.z })
      end
    end
  end
  return d
end

local function incomeOf(d)
  local inc = 0
  for id in pairs(d.owned) do
    local b = BDEF[id]
    if b and b.income then
      local v = b.income
      if b.kind == "factory" and d.owned.power then v = v * Config.PowerBoost end
      inc = inc + v
    end
  end
  return inc
end

local function capOf(d)
  if d.owned.hq and d.hq >= 1 then return BDEF.hq.cap[d.hq] or BDEF.hq.cap[1] end
  return Config.BaseCap
end

local function count(st)
  local n = 0
  for _ in pairs(st.units) do n = n + 1 end
  return n
end

local function fmtTime(s)
  if s >= 3600 then return math.floor(s / 3600) .. " 小时 " .. math.floor(s % 3600 / 60) .. " 分" end
  return math.floor(s / 60) .. " 分钟"
end

-- 后面定义的函数（互相调用）
local push, toast, save, tryBuild, buyUnit, upgradeHQ, upgradeTech, makeEnemy, endBattle

local fxq = {}
local function fx(e)
  fxq[#fxq + 1] = e
end

function push(st)
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
  RState:FireClient(st.pl, {
    cash = d.cash, income = st.income, level = d.level, cap = capOf(d), n = count(st), counts = counts,
    owned = d.owned, hq = d.hq, hqNext = hqNext, plot = st.plot.index, origin = st.plot.origin,
    battle = st.battle ~= nil, enemy = enemy, reward = Config.Reward(d.level), wins = d.wins, save = st.canSave,
    tech = d.tech, techNext = techNext,
  })
  if st.ls then
    st.ls.cash.Value = math.floor(d.cash)
    st.ls.level.Value = d.level
  end
end

function toast(st, msg, kind)
  RToast:FireClient(st.pl, msg, kind or "info")
end

local function recalc(st)
  local d = st.data
  st.income = incomeOf(d)
  if st.hqLabel then
    st.hqLabel.Text = "指挥部 " .. string.rep("★", d.hq) .. "  部队上限 " .. capOf(d)
  end
  if st.hqPrompt then
    if d.hq < #BDEF.hq.cap then
      st.hqPrompt.ObjectText = "$" .. Config.Fmt(BDEF.hq.up[d.hq]) .. " → 上限 " .. BDEF.hq.cap[d.hq + 1]
    else
      st.hqPrompt.Enabled = false
    end
  end
end

---------------------------------------------------------------- 部队（平时）

local function unitCF(plot, x, y, z, h)
  return CFrame.new(plot.origin + V(x, 1 + y, z)) * CFrame.Angles(0, h, 0)
end

local function setFly(u, on)
  if u.model then u.model:SetAttribute("Fly", on) end
end

local function spawnUnit(st, t, x, z, y, h)
  st.nextUid = st.nextUid + 1
  local uid = st.nextUid
  local model, root = Models.unit(t, st.plot.color)
  model.Name = "U" .. uid
  model:SetAttribute("Uid", uid)
  model:SetAttribute("Type", t)
  model:SetAttribute("Fly", false)
  model.Parent = st.plot.Units
  local u = { uid = uid, t = t, x = x, y = y or 0, z = z, h = h or math.pi, sx = x, sz = z, model = model, root = root }
  root.CFrame = unitCF(st.plot, u.x, u.y, u.z, u.h)
  st.units[uid] = u
  return u
end

-- (x, z) 这个阵位空不空（跟别的部队的阵位比）
local function spotFree(st, x, z, size, skip)
  for _, o in pairs(st.units) do
    if o ~= skip then
      local need = (size + UNITS[o.t].size) / 2 + 1.5
      local dx, dz = o.sx - x, o.sz - z
      if dx * dx + dz * dz < need * need then return false end
    end
  end
  return true
end

-- 找个空阵位：默认按兵种排在部署区里（步兵最前，火炮最后），从中间往两边一圈圈找
local ROWOFF = { inf = 6, tank = 16, aa = 28, heli = 42, arty = 58 }
local function freeSpot(st, t, nearX, nearZ, skip)
  local D = F.deploy
  local size = UNITS[t].size
  local xmax = F.width / 2 - 6 - size / 2
  local z1, z2 = D[1] + size / 2 + 1, D[2] - size / 2 - 1
  local x0 = math.clamp(nearX or 0, -xmax, xmax)
  local z0 = math.clamp(nearZ or (D[2] - ROWOFF[t]), z1, z2)
  local step = size + 2
  for ring = 0, 14 do
    local n = math.max(1, ring * 8)
    for k = 0, n - 1 do
      local a = k / n * math.pi * 2
      local x = x0 + math.cos(a) * ring * step
      local z = z0 + math.sin(a) * ring * step * 0.6
      if math.abs(x) <= xmax and z >= z1 and z <= z2 and spotFree(st, x, z, size, skip) then
        return x, z
      end
    end
  end
  return x0, z0
end

-- 新兵从工厂开出来：出门 → 横通道 → 中间通道 → 路上 → 阵位（直升机直接飞过去）
local function exitPath(u, b)
  if UNITS[u.t].air then
    u.path = { { x = b.x, z = b.z, y = 26 }, { x = u.sx, z = u.sz, y = 26 }, { x = u.sx, z = u.sz, y = 0 } }
    setFly(u, true)
  else
    local gx = math.clamp(b.x, -36, 28)
    local roadZ = (Config.BaseSize / 2 + F.center - F.length / 2) / 2
    u.path = {
      { x = b.x, z = b.z + b.size[3] / 2 + 4, y = 0 },
      { x = b.x, z = 42, y = 0 },
      { x = gx, z = 42, y = 0 },
      { x = gx, z = roadZ, y = 0 },
      { x = u.sx, z = u.sz, y = 0 },
    }
  end
end

-- 开到新位置（直升机先升空再落）
local function goTo(u, x, z)
  if UNITS[u.t].air then
    local cruise = math.max(u.y, 14)
    u.path = { { x = u.x, z = u.z, y = cruise }, { x = x, z = z, y = cruise }, { x = x, z = z, y = 0 } }
    setFly(u, true)
  else
    u.path = { { x = x, z = z, y = 0 } }
  end
end

local function stepPath(st, u, dt)
  local wp = u.path[1]
  local sp = (UNITS[u.t].air and 24 or UNITS[u.t].speed * 2.2) * dt
  local dx, dy, dz = wp.x - u.x, wp.y - u.y, wp.z - u.z
  local dist = math.sqrt(dx * dx + dy * dy + dz * dz)
  if dist <= sp then
    u.x, u.y, u.z = wp.x, wp.y, wp.z
    table.remove(u.path, 1)
    if #u.path == 0 then
      u.path = nil
      u.h = math.pi
      setFly(u, false)
    end
  else
    u.x = u.x + dx / dist * sp
    u.y = u.y + dy / dist * sp
    u.z = u.z + dz / dist * sp
    if dx * dx + dz * dz > 0.04 then Battle.turn(u, dx, dz, dt, 5) end
  end
  if u.root and u.root.Parent then u.root.CFrame = unitCF(st.plot, u.x, u.y, u.z, u.h) end
end

---------------------------------------------------------------- 建筑

local function buildingPos(plot, b)
  return plot.origin + V(b.x, 1, b.z)
end

local function placeBuilding(st, b, fresh)
  local m, body = Models.building(st.plot.Buildings, b, buildingPos(st.plot, b), st.plot.color)
  local top = b.size[2] / 2 + 5   -- 牌子的偏移是从主体零件中心算的：大约在楼顶上方 4、5 格
  if b.income then
    Models.sign(body, b.name .. "  <font color=\"#7CFC8A\">+" .. Config.Fmt(b.income) .. "/秒</font>", top, 18, 2.6, nil, 160)
  elseif b.kind == "mil" then
    Models.sign(body, b.name .. " · 生产" .. UNITS[b.unit].name, top, 18, 2.6, nil, 160)
    local pp = Instance.new("ProximityPrompt")
    pp.ActionText = "生产" .. UNITS[b.unit].name
    pp.ObjectText = "$" .. Config.Fmt(UNITS[b.unit].price)
    pp.HoldDuration = 0
    pp.MaxActivationDistance = 24
    pp.RequiresLineOfSight = false
    pp.Parent = body
    local t = b.unit
    pp.Triggered:Connect(function(who)
      if who == st.pl then buyUnit(st, t) end
    end)
  elseif b.kind == "hq" then
    local _, label = Models.sign(body, "", top + 5, 22, 2.6, Color3.fromRGB(255, 220, 120), 220)
    st.hqLabel = label
    local pp = Instance.new("ProximityPrompt")
    pp.ActionText = "升级指挥部"
    pp.ObjectText = ""
    pp.HoldDuration = 0.4
    pp.MaxActivationDistance = 24
    pp.RequiresLineOfSight = false
    pp.Parent = body
    st.hqPrompt = pp
    pp.Triggered:Connect(function(who)
      if who == st.pl then upgradeHQ(st) end
    end)
  elseif b.kind == "power" then
    Models.sign(body, "发电厂 · 工厂收入 ×" .. Config.PowerBoost, top + 2, 18, 2.6, nil, 160)
  end
  if fresh then fx({ k = "build", p = buildingPos(st.plot, b), s = math.max(b.size[1], b.size[3]) }) end
  return m
end

-- 按钮颜色：买得起绿、买不起红（只在变的时候改，省得每秒同步）
local function padColors(st)
  for _, p in pairs(st.pads) do
    local ok = st.data.cash >= p.b.price
    if p.ok ~= ok then
      p.ok = ok
      p.pad.Color = ok and GREEN or RED
    end
  end
end

-- 重新摆购买按钮：没盖、前置已经盖好的建筑才有
local function refreshPads(st)
  st.plot.Pads:ClearAllChildren()
  st.pads = {}
  local d = st.data
  for _, b in ipairs(Config.Buildings) do
    if not d.owned[b.id] and (not b.req or d.owned[b.req]) then
      local _, pad, pp = Models.pad(st.plot.Pads, b, buildingPos(st.plot, b), st.plot.color)
      local id = b.id
      pad.Touched:Connect(function(hit)
        local who = Players:GetPlayerFromCharacter(hit.Parent)
        if who == st.pl then tryBuild(st, id, true) end
      end)
      pp.Triggered:Connect(function(who)
        if who == st.pl then tryBuild(st, id, false) end
      end)
      st.pads[id] = { pad = pad, b = b }
    end
  end
  padColors(st)
end

---------------------------------------------------------------- 玩家操作

function tryBuild(st, id, touch)
  if not st.ready then return end
  local b = BDEF[id]
  local d = st.data
  if not b or d.owned[id] or (b.req and not d.owned[b.req]) then return end
  if touch then  -- 踩着按钮不停触发：隔一会儿才算一次
    local now = os.clock()
    if now - (st.padT[id] or 0) < 1.2 then return end
    st.padT[id] = now
  end
  if d.cash < b.price then
    toast(st, "钱不够：" .. b.name .. " 还差 $" .. Config.Fmt(b.price - d.cash), "bad")
    return
  end
  d.cash = d.cash - b.price
  d.owned[id] = true
  if b.kind == "hq" then d.hq = 1 end
  placeBuilding(st, b, true)
  recalc(st)
  refreshPads(st)
  local extra = ""
  if b.income then extra = "，收入 +" .. Config.Fmt(b.income) .. "/秒" end
  toast(st, "建成：" .. b.name .. extra, "good")
  if b.kind == "mil" then
    toast(st, "可以生产" .. UNITS[b.unit].name .. "了：右边「兵工厂」，或走到建筑旁按 E", "info")
  elseif b.kind == "hq" then
    toast(st, "部队上限 " .. capOf(d) .. "；以后可以升级指挥部带更多兵", "info")
  end
  push(st)
end

function buyUnit(st, t)
  if not st.ready then return end
  local def = UNITS[t]
  if not def then return end
  local d = st.data
  local src = BDEF[Config.UnitSource[t]]
  if not src or not d.owned[src.id] then
    toast(st, "先盖" .. (src and src.name or "工厂") .. "才能生产" .. def.name, "bad")
    return
  end
  if st.battle then
    toast(st, "打仗的时候不能生产", "bad")
    return
  end
  local cap = capOf(d)
  if count(st) >= cap then
    toast(st, "部队满了（" .. cap .. "）：" .. (d.owned.hq and "升级指挥部能带更多" or "盖指挥部能带更多"), "bad")
    return
  end
  if d.cash < def.price then
    toast(st, "钱不够：" .. def.name .. " 还差 $" .. Config.Fmt(def.price - d.cash), "bad")
    return
  end
  d.cash = d.cash - def.price
  local x, z = freeSpot(st, t)
  local u = spawnUnit(st, t, src.x, src.z, def.air and 0.8 or 0, math.pi)
  u.sx, u.sz = x, z
  exitPath(u, src)
  push(st)
end

local function moveUnit(st, uid, x, z)
  if st.battle then return end
  if type(uid) ~= "number" or type(x) ~= "number" or type(z) ~= "number" then return end
  if x ~= x or z ~= z then return end
  local u = st.units[uid]
  if not u then return end
  local D = F.deploy
  local size = UNITS[u.t].size
  local xmax = F.width / 2 - 6 - size / 2
  x = math.clamp(x, -xmax, xmax)
  z = math.clamp(z, D[1] + size / 2 + 1, D[2] - size / 2 - 1)
  if not spotFree(st, x, z, size, u) then x, z = freeSpot(st, u.t, x, z, u) end
  u.sx, u.sz = x, z
  goTo(u, x, z)
end

local function sellUnit(st, uid)
  if st.battle then return end
  local u = st.units[uid]
  if not u then return end
  local refund = math.floor(UNITS[u.t].price * 0.5)
  st.data.cash = st.data.cash + refund
  if u.model then u.model:Destroy() end
  st.units[uid] = nil
  toast(st, "解散" .. UNITS[u.t].name .. "，退回 $" .. Config.Fmt(refund), "info")
  push(st)
end

local function arrange(st)
  if st.battle then return end
  local list = {}
  for _, u in pairs(st.units) do table.insert(list, u) end
  if #list == 0 then return end
  local ROW = Battle.ROW
  table.sort(list, function(a, b)
    if ROW[a.t] ~= ROW[b.t] then return ROW[a.t] < ROW[b.t] end
    return a.uid < b.uid
  end)
  local types = {}
  for i, u in ipairs(list) do types[i] = u.t end
  local slots = Battle.formation(types, F.deploy[2] - 2, -1, F.deploy[2] - F.deploy[1] - 4)
  for i, u in ipairs(list) do
    local s = slots[i]
    if s then
      u.sx, u.sz = s.x, s.z
      goTo(u, s.x, s.z)
    end
  end
  toast(st, "排好了：步兵在前，坦克、防空车、直升机，火炮在最后", "info")
end

function upgradeHQ(st)
  if not st.ready then return end
  local d = st.data
  if not d.owned.hq then
    toast(st, "先盖指挥部", "bad")
    return
  end
  if d.hq >= #BDEF.hq.cap then
    toast(st, "指挥部已经满级", "info")
    return
  end
  local price = BDEF.hq.up[d.hq]
  if d.cash < price then
    toast(st, "升级指挥部还差 $" .. Config.Fmt(price - d.cash), "bad")
    return
  end
  d.cash = d.cash - price
  d.hq = d.hq + 1
  recalc(st)
  fx({ k = "build", p = buildingPos(st.plot, BDEF.hq), s = 30 })
  toast(st, "指挥部升到 " .. d.hq .. " 级：部队上限 " .. capOf(d), "good")
  push(st)
end

function upgradeTech(st)
  if not st.ready then return end
  local d = st.data
  if d.tech >= Config.Tech.max then
    toast(st, "军工科技已经满级", "info")
    return
  end
  local price = Config.TechCost(d.tech)
  if d.cash < price then
    toast(st, "升级军工科技还差 $" .. Config.Fmt(price - d.cash), "bad")
    return
  end
  d.cash = d.cash - price
  d.tech = d.tech + 1
  toast(st, "军工科技升到 " .. d.tech .. " 级：全军血量、伤害 +" .. math.floor(d.tech * Config.Tech.bonus * 100 + 0.5) .. "%", "good")
  push(st)
end

---------------------------------------------------------------- 关卡敌军、战斗

-- 这一关的敌军先摆在敌军区（开打前就能看到对面有什么）
function makeEnemy(st)
  st.plot.Enemies:ClearAllChildren()
  st.enemy = {}
  local list, hm, dm = Battle.genEnemy(st.data.level)
  local slots = Battle.formation(list, F.enemy[1] + 2, 1, F.enemy[2] - F.enemy[1] - 4)
  for i, s in ipairs(slots) do
    local model, root = Models.unit(s.t, Config.EnemyColor)
    model.Name = "E" .. i
    model:SetAttribute("Type", s.t)
    model:SetAttribute("Fly", false)
    model.Parent = st.plot.Enemies
    root.CFrame = unitCF(st.plot, s.x, 0, s.z, 0)
    table.insert(st.enemy, { t = s.t, x = s.x, z = s.z, model = model, root = root, hm = hm, dm = dm })
  end
end

-- 推演模块用的回调：坐标换算、特效、血条、阵亡
local function battleCallbacks(st)
  local plot = st.plot
  local cb = {}
  cb.fx = fx
  function cb.world(x, y, z)
    return plot.origin + V(x, 1 + y, z)
  end
  function cb.muzzle(u)
    return u.root.CFrame:PointToWorldSpace(Models.UnitInfo[u.t].muzzle)
  end
  function cb.aim(t, hit)
    local p = plot.origin + V(t.x, 1 + t.y + Models.UnitInfo[t.t].h * 0.45, t.z)
    if not hit then p = p + V(math.random() * 8 - 4, math.random() * 2, math.random() * 8 - 4) end
    return p
  end
  function cb.hurt(u)
    if u.fill then u.fill.Size = UDim2.fromScale(math.clamp(u.hp / u.max, 0, 1), 1) end
  end
  function cb.die(u)
    if u.bar then u.bar.Enabled = false end
    local m = u.model
    if not m or not m.Parent then return end
    m:SetAttribute("Dead", true)   -- 残骸：客户端布阵时不能选
    local p = plot.origin + V(u.x, 1 + u.y, u.z)
    if u.t == "inf" then
      fx({ k = "boom", p = p + V(0, 1.5, 0), s = 0.5 })
      m:Destroy()
      return
    end
    fx({ k = "boom", p = p + V(0, 2, 0), s = 1.8 })
    m:SetAttribute("Fly", false)
    if u.def.air then   -- 直升机摔到地上
      u.root.CFrame = unitCF(plot, u.x, 0, u.z, u.h) * CFrame.Angles(0.25, 0, 0.6)
      fx({ k = "boom", p = plot.origin + V(u.x, 2, u.z), s = 1.4 })
    end
    for _, part in ipairs(m:GetDescendants()) do   -- 烧黑、起火冒烟，几秒后消失
      if part:IsA("BasePart") and part.Transparency < 1 then
        part.Color = Color3.fromRGB(38, 35, 32)
        part.Material = Enum.Material.CorrodedMetal
      end
    end
    local fire = Instance.new("Fire")
    fire.Size = 5
    fire.Heat = 9
    fire.Parent = u.root
    local smoke = Instance.new("Smoke")
    smoke.Color = Color3.fromRGB(40, 40, 40)
    smoke.Opacity = 0.35
    smoke.RiseVelocity = 7
    smoke.Size = 4
    smoke.Parent = u.root
    Debris:AddItem(m, 6)
  end
  return cb
end

-- 把推演里的位置摆到模型上（没动的不改，省同步）
local function placeAll(st, B)
  for _, u in ipairs(B.units) do
    if u.alive and u.root and u.root.Parent then
      if u.px == nil or math.abs(u.x - u.px) > 0.02 or math.abs(u.z - u.pz) > 0.02 or math.abs(u.y - u.py) > 0.02 or math.abs(u.h - u.ph) > 0.005 then
        u.px, u.pz, u.py, u.ph = u.x, u.z, u.y, u.h
        local cf = unitCF(st.plot, u.x, u.y, u.z, u.h)
        if u.def.air and u.moving then cf = cf * CFrame.Angles(-0.16, 0, 0) end   -- 直升机前飞时低头
        u.root.CFrame = cf
      end
    end
  end
end

local function startBattle(st)
  if not st.ready or st.battle then return end
  if count(st) == 0 then
    toast(st, "还没有部队：先盖兵营，再在右边「兵工厂」生产", "bad")
    return
  end
  if #st.enemy == 0 then makeEnemy(st) end
  local B = { units = {}, shells = {}, t = 0, level = st.data.level, alive1 = 0, alive2 = 0 }
  local tm = 1 + Config.Tech.bonus * st.data.tech   -- 军工科技：血量、伤害倍数
  for _, u in pairs(st.units) do
    local def = UNITS[u.t]
    u.path = nil
    u.x, u.y, u.z, u.h = u.sx, 0, u.sz, math.pi
    if not u.bar then
      u.bar, u.fill = Models.hpBar(u.root, Models.UnitInfo[u.t].h + 2.5, Color3.fromRGB(80, 220, 100))
    end
    u.bar.Enabled = true
    u.fill.Size = UDim2.fromScale(1, 1)
    if def.air then setFly(u, true) end
    table.insert(B.units, {
      uid = u.uid, t = u.t, def = def, team = 1, x = u.x, y = 0, z = u.z, h = math.pi,
      hp = def.hp * tm, max = def.hp * tm, dm = tm, cd = math.random() * def.rate, rt = 0, alive = true,
      model = u.model, root = u.root, bar = u.bar, fill = u.fill,
    })
  end
  for _, e in ipairs(st.enemy) do
    local def = UNITS[e.t]
    local bar, fill = Models.hpBar(e.root, Models.UnitInfo[e.t].h + 2.5, Color3.fromRGB(230, 70, 60))
    bar.Enabled = true
    if def.air then e.model:SetAttribute("Fly", true) end
    table.insert(B.units, {
      t = e.t, def = def, team = 2, x = e.x, y = 0, z = e.z, h = 0,
      hp = def.hp * e.hm, max = def.hp * e.hm, dm = e.dm, cd = math.random() * def.rate, rt = 0, alive = true,
      model = e.model, root = e.root, bar = bar, fill = fill,
    })
  end
  B.cb = battleCallbacks(st)
  st.battle = B
  placeAll(st, B)
  RBattle:FireClient(st.pl, { phase = "start", level = st.data.level, time = Config.BattleTime })
  push(st)
  task.spawn(function()
    local tickT = 0
    while st.battle == B do
      local dt = task.wait(Config.Tick)
      if st.battle ~= B then break end
      local ok, res = pcall(Battle.step, B, math.min(dt, 0.2))
      if not ok then
        warn("[军事大亨] 战斗推演出错：" .. tostring(res))
        res = "timeout"
      end
      placeAll(st, B)
      tickT = tickT + dt
      if tickT >= 0.5 then
        tickT = 0
        RBattle:FireClient(st.pl, { phase = "tick", t = B.t, a = B.alive1, e = B.alive2 })
      end
      if res then
        endBattle(st, res)
        break
      end
    end
  end)
end

function endBattle(st, res)
  local B = st.battle
  if not B then return end
  st.battle = nil
  local d = st.data
  local lost, lostN = {}, 0
  for _, bu in ipairs(B.units) do
    if bu.bar then bu.bar.Enabled = false end
    if bu.team == 1 then
      local u = st.units[bu.uid]
      if u then
        if bu.alive then   -- 活着的开回战前的阵位，下一仗满血
          u.x, u.y, u.z, u.h = bu.x, bu.y, bu.z, bu.h
          goTo(u, u.sx, u.sz)
        else
          st.units[bu.uid] = nil
          lost[u.t] = (lost[u.t] or 0) + 1
          lostN = lostN + 1
        end
      end
    elseif bu.alive and bu.model and bu.model.Parent then
      bu.model:SetAttribute("Fly", false)
    end
  end
  local reward = 0
  if res == "win" then
    reward = Config.Reward(d.level)
    d.cash = d.cash + reward
    d.level = d.level + 1
    d.wins = (d.wins or 0) + 1
  end
  st.enemy = {}
  RBattle:FireClient(st.pl, { phase = "end", result = res, reward = reward, lost = lost, lostN = lostN, level = d.level })
  push(st)
  task.spawn(save, st)
  task.delay((res == "win") and 3 or 2, function()
    if states[st.pl] == st and not st.battle then
      makeEnemy(st)
      push(st)
    end
  end)
end

---------------------------------------------------------------- 存档

local store = nil
do
  local ok, res = pcall(function() return DSS:GetDataStore(Config.SaveKey) end)
  if ok then store = res else warn("[军事大亨] DataStore 不可用：" .. tostring(res)) end
end

local function serialize(st)
  local d = st.data
  local army = {}
  for _, u in pairs(st.units) do
    table.insert(army, { t = u.t, x = math.floor(u.sx * 10 + 0.5) / 10, z = math.floor(u.sz * 10 + 0.5) / 10 })
  end
  local owned = {}
  for id in pairs(d.owned) do owned[id] = true end
  return { v = 1, cash = math.floor(d.cash), level = d.level, owned = owned, hq = d.hq, tech = d.tech, army = army, wins = d.wins or 0, t = os.time() }
end

function save(st)
  -- 读档失败的时候不存：别拿一份新档盖掉玩家原来的进度
  if not store or not st.canSave or not st.data then return end
  local data = serialize(st)
  local key = "u" .. st.pl.UserId
  local ok, err = pcall(function() store:SetAsync(key, data) end)
  if not ok then warn("[军事大亨] 存档失败：" .. tostring(err)) end
end

local function loadData(pl)
  if not store then return nil, false end
  for _ = 1, 3 do
    local ok, res = pcall(function() return store:GetAsync("u" .. pl.UserId) end)
    if ok then return res, true end
    warn("[军事大亨] 读档失败：" .. tostring(res))
    task.wait(1.5)
  end
  return nil, false
end

---------------------------------------------------------------- 进出服务器

local function spawnChar(st)
  if states[st.pl] ~= st or not st.pl.Parent then return end
  local ok, err = pcall(function() st.pl:LoadCharacter() end)
  if not ok then warn("[军事大亨] 生成角色失败：" .. tostring(err)) end
end

local function onCharacter(st, char)
  local hrp = char:WaitForChild("HumanoidRootPart", 10)
  if hrp and states[st.pl] == st then
    task.wait()
    char:PivotTo(CFrame.lookAt(st.plot.origin + V(0, 5, -76), st.plot.origin + V(0, 5, 0)))
  end
  local hum = char:FindFirstChildOfClass("Humanoid") or char:WaitForChild("Humanoid", 10)
  if hum then
    hum.Died:Connect(function()
      task.wait(3)
      if states[st.pl] == st and st.pl.Character == char then spawnChar(st) end
    end)
  end
end

local function onPlayer(pl)
  if states[pl] then return end
  local plot = nil
  for _, p in ipairs(plots) do
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
  states[pl] = st
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
  ls.Parent = pl
  st.ls = { level = lv, cash = cash }
  pl.CharacterAdded:Connect(function(char) onCharacter(st, char) end)

  local raw, ok = loadData(pl)
  if states[pl] ~= st then return end   -- 读档的时候人走了
  st.data = cleanData(raw)
  st.canSave = ok
  local d = st.data
  for _, b in ipairs(Config.Buildings) do
    if d.owned[b.id] then placeBuilding(st, b, false) end
  end
  recalc(st)
  refreshPads(st)
  local cap = capOf(d)
  for _, a in ipairs(d.army) do
    if count(st) < cap then
      local size = UNITS[a.t].size
      local x, z = a.x, a.z
      if z < F.deploy[1] or z > F.deploy[2] or math.abs(x) > F.width / 2 or not spotFree(st, x, z, size) then
        x, z = freeSpot(st, a.t)
      end
      spawnUnit(st, a.t, x, z, 0, math.pi)
    end
  end
  makeEnemy(st)
  -- 离线收益：按在线的 OfflineRate 成，最多算 OfflineHours 小时
  local away = 0
  if type(raw) == "table" and type(raw.t) == "number" then away = os.time() - raw.t end
  if away > 60 and st.income > 0 then
    local earn = math.floor(st.income * math.min(away, Config.OfflineHours * 3600) * Config.OfflineRate)
    d.cash = d.cash + earn
    task.delay(4, function()
      if states[pl] == st then toast(st, "离线收益 +$" .. Config.Fmt(earn) .. "（离开了 " .. fmtTime(away) .. "）", "good") end
    end)
  end
  st.ready = true
  push(st)
  if pl.Character then
    task.spawn(onCharacter, st, pl.Character)
  else
    spawnChar(st)
  end
  task.delay(2, function()
    if states[pl] ~= st then return end
    if not ok then
      toast(st, "存档没读到，这次的进度不会保存（在 Studio 里测试：先发布，再在游戏设置 → 安全里打开 API 访问）", "bad")
    end
    if type(raw) ~= "table" then
      toast(st, "欢迎来到军事大亨！踩绿色按钮盖楼，楼会一直给你赚钱", "info")
      task.wait(6)
      if states[pl] == st then toast(st, "盖好兵营就能生产部队：右边「兵工厂」，或者走到兵营旁按 E", "info") end
      task.wait(6)
      if states[pl] == st then toast(st, "部队会停到前面的蓝色部署区；点「布阵」摆位置，点「开战」打这一关的敌军", "info") end
    end
  end)
end

Players.PlayerAdded:Connect(onPlayer)
for _, pl in ipairs(Players:GetPlayers()) do task.spawn(onPlayer, pl) end

Players.PlayerRemoving:Connect(function(pl)
  local st = states[pl]
  if not st then return end
  st.battle = nil
  if st.ready then save(st) end
  states[pl] = nil
  local plot = st.plot
  for _, name in ipairs({ "Buildings", "Pads", "Units", "Enemies" }) do plot[name]:ClearAllChildren() end
  plot.owner = nil
  plot.sign.Text = "空基地"
end)

game:BindToClose(function()
  local list = {}
  for _, st in pairs(states) do table.insert(list, st) end
  for _, st in ipairs(list) do
    if st.ready then save(st) end
  end
end)

---------------------------------------------------------------- 客户端发来的操作

RAction.OnServerEvent:Connect(function(pl, op, a, b, c)
  local st = states[pl]
  if not st or not st.ready then return end
  -- 限流：每秒最多十来次
  local now = os.clock()
  st.tokens = math.min(15, (st.tokens or 15) + (now - (st.tokT or now)) * 10)
  st.tokT = now
  if st.tokens < 1 then return end
  st.tokens = st.tokens - 1
  if op == "buy" then buyUnit(st, a)
  elseif op == "move" then moveUnit(st, a, b, c)
  elseif op == "sell" then sellUnit(st, a)
  elseif op == "arrange" then arrange(st)
  elseif op == "battle" then startBattle(st)
  elseif op == "hq" then upgradeHQ(st)
  elseif op == "tech" then upgradeTech(st)
  end
end)

---------------------------------------------------------------- 循环

-- 每秒收入
task.spawn(function()
  while true do
    task.wait(1)
    for _, st in pairs(states) do
      if st.ready and st.data then
        st.data.cash = st.data.cash + st.income
        padColors(st)
        push(st)
      end
    end
  end
end)

-- 自动存档
task.spawn(function()
  while true do
    task.wait(90)
    local list = {}
    for _, st in pairs(states) do table.insert(list, st) end
    for _, st in ipairs(list) do
      if states[st.pl] == st and st.ready then save(st) end
    end
  end
end)

-- 平时部队开来开去；特效攒一帧发一次
RunService.Heartbeat:Connect(function(dt)
  for _, st in pairs(states) do
    if st.ready and not st.battle then
      for _, u in pairs(st.units) do
        if u.path then stepPath(st, u, dt) end
      end
    end
  end
  if #fxq > 0 then
    RFx:FireAllClients(fxq)
    fxq = {}
  end
end)
