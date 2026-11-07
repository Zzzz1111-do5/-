-- 宣传片第一步：在模拟的 Roblox 里真跑游戏脚本，录下场景和一整场战斗，给 render.html 逐帧渲染
--   TR_LEVEL=27 TR_TECH=2 python3 roblox/tools/mock/run.py roblox/tools/trailer/record.lua <输出目录>
--   TR_LEVEL 打第几关、TR_TECH 敌军强弱（默认第 27 关雪原、2：一场约 50 秒、我方赢，宣传片按这个长度分镜）
-- 输出：scene.json（基地、工业区、新区域、战场的全部零件，地形；每个零件属于哪栋楼）、battle.json（每个单位每 1/20 秒的位置朝向、炮塔转角、死没死；全部特效事件和时间）
-- 录的是一个重生满 3 次、全部建筑盖好的老兵：40 个兵（含 0.9 的新兵种），打一场有战况的高关卡
local R = dofile(MOCK_DIR .. "/rbx.lua")
local typeof = R.typeof
local V3 = R.Vector3.new
local RS = R.services.ReplicatedStorage
local SSS = R.services.ServerScriptService
local Players = R.services.Players
local ws = R.workspace
local OUT = (TEST_ARGS ~= "" and TEST_ARGS) or "/tmp/trailer_rec"
os.execute('mkdir -p "' .. OUT .. '"')
math.randomseed(20261107)

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

-- 要录的老兵：全部建筑、重生 3 次、指挥部 4 级；40 个兵
local LEVEL = tonumber(os.getenv("TR_LEVEL") or "") or 27
local TECH = tonumber(os.getenv("TR_TECH") or "") or 2
local owned = {}
for _, b in ipairs(Config.Buildings) do owned[b.id] = true end
local lv = {}
for _, b in ipairs(Config.Buildings) do if b.income then lv[b.id] = 3 + (#b.id % 3) end end
local mix = { "inf", "inf", "inf", "inf", "inf", "inf", "mg", "mg", "at", "at", "flamer",
  "tank", "tank", "tank", "tank", "heavytank", "heavytank", "ifv", "ifv", "railgun", "railgun", "miner", "miner", "breacher",
  "laser", "laser", "sam", "spaag", "mlrs", "mlrs", "ballistic", "ballistic", "heavyarty",
  "heli", "heli", "gunship", "gunship", "swarm", "swarm", "fighter" }
local army = {}
for i, t in ipairs(mix) do table.insert(army, { t = t, x = ((i - 1) % 10 - 4.5) * 40, z = 200 + math.floor((i - 1) / 10) * 30 }) end
R.store[Config.SaveKey .. "/u8001"] = { v = 2, cash = 9e8, level = LEVEL, best = LEVEL, owned = owned, lv = lv, hq = 4, tech = TECH, army = army, wins = 50, rebirth = 3, xp = 60000,
  kills = 500, weapons = { rifle = true, smg = true, sniper = true, rpg = true }, rating = 1400, t = os.time() - 30, daily = { day = math.floor(os.time() / 86400), streak = 7 } }

print("== 启动服务器")
R.runScript(main, "server")
R.run(1)
local pl = R.addPlayer("指挥官", 8001)
R.localPlayer = pl
Players.PlayerAdded:Fire(pl)
R.run(4)
for _, e in ipairs(R.errors) do print("!!! " .. tostring(e)) end
for i = 1, math.min(5, #R.warns) do print("警告 " .. tostring(R.warns[i])) end
local plot
for _, f in ipairs(ws.Plots:GetChildren()) do
  for _, d in ipairs(f:GetDescendants()) do
    if d.ClassName == "TextLabel" and d.Text == pl.Name .. " 的基地" then plot = f end
  end
end
assert(plot, "没找到基地")
local origin = plot.Base.CFrame.Position - V3(0, 0.5, 0)
local remotes = RS.Remotes
local function action(...)
  local args = table.pack(...)
  R.as("client", function() remotes.Action:FireServer(table.unpack(args, 1, args.n)) end)
  R.run(0.1)
end
action("arrange")
R.run(1)
print("基地：" .. #plot.Buildings:GetChildren() .. " 栋楼，" .. #plot.Units:GetChildren() .. " 个兵")

-- JSON（只认这里用到的类型）
local function num(v) return string.format("%.3f", v):gsub("%.?0+$", "") end
local enc
local function encArr(t)
  local out = {}
  for i = 1, #t do out[i] = enc(t[i]) end
  return "[" .. table.concat(out, ",") .. "]"
end
function enc(v)
  local tv = type(v)
  if tv == "number" then
    if v ~= v or v == math.huge or v == -math.huge then return "0" end
    if math.floor(v) == v and math.abs(v) < 1e15 then return string.format("%d", v) end
    return (num(v))
  elseif tv == "string" then
    return '"' .. v:gsub('[%c"\\]', function(c) return string.format("\\u%04x", c:byte()) end) .. '"'
  elseif tv == "boolean" then
    return v and "true" or "false"
  elseif tv == "nil" then
    return "null"
  elseif typeof(v) == "Vector3" then
    return "[" .. num(v.X) .. "," .. num(v.Y) .. "," .. num(v.Z) .. "]"
  elseif typeof(v) == "Color3" then
    return "[" .. math.floor(v.R * 255 + 0.5) .. "," .. math.floor(v.G * 255 + 0.5) .. "," .. math.floor(v.B * 255 + 0.5) .. "]"
  elseif tv == "table" then
    if #v > 0 or next(v) == nil then return encArr(v) end
    local out = {}
    for k, x in pairs(v) do
      if type(k) == "string" and (type(x) ~= "function") and typeof(x) ~= "Instance" then table.insert(out, '"' .. k .. '":' .. enc(x)) end
    end
    return "{" .. table.concat(out, ",") .. "}"
  end
  return "null"
end
local function write(name, s)
  local f = assert(io.open(OUT .. "/" .. name, "w"))
  f:write(s)
  f:close()
  print("写好 " .. OUT .. "/" .. name .. "（" .. math.floor(#s / 1024) .. " KB）")
end

-- 场景：这块基地附近的全部零件（部队、特效、角色、牌子不要），按 CFrame 记 12 个数
local function cfArr(cf)
  local x, y, z, r00, r01, r02, r10, r11, r12, r20, r21, r22 = cf:GetComponents()
  return { x, y, z, r00, r01, r02, r10, r11, r12, r20, r21, r22 }
end
local skipF = { Units = true, Enemies = true, Drops = true, ClientUnits = true, ClientFx = true, Pads = true }
local function skip(o)
  local p = o.Parent
  while p and p ~= ws do
    if skipF[p.Name] then return true end
    if p.ClassName == "Model" and p:FindFirstChildOfClass("Humanoid") then return true end
    p = p.Parent
  end
  return false
end
local function buildingOf(o)
  local p = o.Parent
  while p and p ~= ws do
    if p.Parent and p.Parent.Name == "Buildings" then return p.Name end
    p = p.Parent
  end
end
local parts = {}
for _, o in ipairs(ws:GetDescendants()) do
  if o:IsA("BasePart") and o.ClassName ~= "Terrain" and not skip(o) then
    local cf = o.CFrame
    local d = cf.Position - origin
    local tr = o.Transparency
    if tr < 0.98 and math.abs(d.X) < 1150 and d.Z > -700 and d.Z < 1500 then
      local shape = "Block"
      if o.ClassName == "Part" then shape = o.Shape.Name elseif o.ClassName == "WedgePart" then shape = "Wedge" elseif o.ClassName == "MeshPart" then shape = "Block" end
      table.insert(parts, { s = shape, z = o.Size, c = cfArr(cf), col = o.Color, m = o.Material.Name, t = (tr > 0.01) and tr or nil, b = buildingOf(o),
        a = o:GetAttribute("Anim"), sp = o:GetAttribute("Spd") })
    end
  end
end
local fills = {}
for _, f in ipairs(R.terrainFills) do
  local d = f.p - origin
  if math.abs(d.X) < 2600 and d.Z > -1500 and d.Z < 2400 then table.insert(fills, f) end
end
local areas = {}
for _, a in ipairs(Config.Areas) do table.insert(areas, { id = a.id, name = a.name, x0 = a.x0, x1 = a.x1, z0 = a.z0, z1 = a.z1 }) end
local bl = {}
for _, b in ipairs(Config.Buildings) do table.insert(bl, { id = b.id, name = b.name, x = b.x, z = b.z, size = b.size, area = b.area }) end
write("scene.json", enc({ origin = origin, field = Config.Field, base = Config.BaseSize, areas = areas, buildings = bl, parts = parts, fills = fills, color = Config.PlotColors[1] }))
print("零件 " .. #parts .. " 个，地形 " .. #fills .. " 块")

-- 兵种表（渲染器按 model 找 glb、按 len 缩放）
local units = {}
for t, d in pairs(Config.Units) do units[t] = { model = d.model, len = d.len, size = d.size, foot = d.foot, squad = d.squad, air = d.air, jet = d.jet, prop = d.prop, name = d.name, short = d.short, cat = d.cat } end

-- 开战，录：每 1/20 秒每个单位的位置、朝向、炮塔转角、死没死；全部特效
action("battle")
local tracks, order = {}, {}
local fxs = {}
local seenSent = #R.sent
local t0 = R.clock()
local DT = 1 / 20
local finished, startInfo = nil, nil
local function folderTeam(f)
  if f == plot.Units then return 1 end
  if f == plot.Enemies then return 2 end
end
for step = 1, math.floor(150 / DT) do
  R.run(DT, DT)
  local t = R.clock() - t0
  for _, f in ipairs({ plot.Units, plot.Enemies }) do
    for _, m in ipairs(f:GetChildren()) do
      local root = m:FindFirstChild("Root")
      if root and m:GetAttribute("Type") then
        local tr = tracks[m]
        if not tr then
          tr = { id = #order + 1, t = m:GetAttribute("Type"), team = folderTeam(f), name = m.Name, bu = m:GetAttribute("BU"), f = {} }
          tracks[m] = tr
          table.insert(order, tr)
        end
        tr.bu = tr.bu or m:GetAttribute("BU")
        local cf = root.CFrame
        local p = cf.Position - origin
        local lv = cf.LookVector
        local yaw = math.atan2(-lv.X, -lv.Z)
        local pitch = math.asin(math.max(-1, math.min(1, lv.Y)))
        table.insert(tr.f, { math.floor(t * 100 + 0.5) / 100, p.X, p.Y, p.Z, yaw, pitch, m:GetAttribute("TY") or 0, m:GetAttribute("Dead") and 1 or 0, m:GetAttribute("Fly") and 1 or 0 })
      end
    end
  end
  for i = seenSent + 1, #R.sent do
    local e = R.sent[i]
    if e.name == "Fx" and type(e.args[1]) == "table" then
      for _, x in ipairs(e.args[1]) do
        local c = { tt = math.floor(t * 100 + 0.5) / 100 }
        for k, v in pairs(x) do
          if typeof(v) == "Vector3" then c[k] = v - origin elseif type(v) ~= "table" then c[k] = v end
        end
        table.insert(fxs, c)
      end
    elseif e.name == "Battle" and type(e.args[1]) == "table" and e.args[1].phase == "end" then
      finished = { t = t, result = e.args[1].result }
    elseif e.name == "Battle" and type(e.args[1]) == "table" and e.args[1].phase == "start" then
      startInfo = { title = e.args[1].title, event = e.args[1].event }
    end
  end
  seenSent = #R.sent
  if finished and t > finished.t + 3 then break end
end
local list = {}
for _, tr in ipairs(order) do table.insert(list, tr) end
local kinds = {}
for _, e in ipairs(fxs) do kinds[e.k] = (kinds[e.k] or 0) + 1 end
local ks = {}
for k, n in pairs(kinds) do table.insert(ks, k .. " " .. n) end
table.sort(ks)
print("战斗：" .. tostring(finished and finished.result) .. "，" .. string.format("%.0f", finished and finished.t or -1) .. " 秒；单位 " .. #list .. " 个；特效 " .. #fxs .. "（" .. table.concat(ks, "，") .. "）")
write("battle.json", enc({ units = units, tracks = list, fx = fxs, start = startInfo, level = LEVEL, finish = finished, dt = DT }))
TEST_CODE = 0
