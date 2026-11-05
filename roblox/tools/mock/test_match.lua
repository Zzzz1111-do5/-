-- 军事大亨：对战服务器（跨服匹配预留的服务器）的模拟测试，每次一个全新的「服务器」（run.py 跑 test.lua 后接着跑这个）：
--   duel：两个人带着传送数据进来 → 到齐 5 秒后自动开打排位 → 打完记对战积分、存档 → 8 秒后都送回普通服务器
--   timeout：只来了一个人，对手一直不来 → 75 秒后把他送回去，积分不变
local R = dofile(MOCK_DIR .. "/rbx.lua")
local V3 = R.Vector3.new
local RS = R.services.ReplicatedStorage
local SSS = R.services.ServerScriptService
local Players = R.services.Players
local MODE = TEST_ARGS:match("timeout") and "timeout" or "duel"

local fails = {}
local function check(ok, msg)
  if ok then print("  ✓ " .. msg) else print("  ✗ " .. msg); table.insert(fails, msg) end
end
local function listLua(dir)
  local p = io.popen('ls "' .. dir .. '"')
  local out = {}
  for f in p:lines() do if f:match("%.lua$") then table.insert(out, f) end end
  p:close()
  return out
end

R.scriptFrom("ModuleScript", "Config", SRC_DIR .. "/Config.lua", RS)
local main = R.scriptFrom("Script", "Main", SRC_DIR .. "/Main/init.server.lua", SSS)
for _, f in ipairs(listLua(SRC_DIR .. "/Main")) do
  if f ~= "init.server.lua" then R.scriptFrom("ModuleScript", f:gsub("%.lua$", ""), SRC_DIR .. "/Main/" .. f, main) end
end
local Config = R.require(RS:FindFirstChild("Config"))

-- 这是一台预留服务器；两位玩家的存档（A 的部队强、B 弱）、传送数据
R.privateServerId, R.privateServerOwnerId, R.jobId = "ps-7", 0, "job-match"
local function save(uid, army, pvp)
  R.store[Config.SaveKey .. "/u" .. uid] = { v = 2, cash = 3000, level = 8, best = 8, owned = { house1 = true, barracks = true, hq = true, factory1 = true, tankfac = true }, hq = 1, tech = 2, army = army, pvp = pvp, t = os.time() }
end
local strong, weak = {}, {}
for i = 1, 8 do table.insert(strong, { t = (i % 2 == 0) and "tank" or "ifv", x = (i - 4.5) * 28, z = 260 }) end
for i = 1, 3 do table.insert(weak, { t = "inf", x = (i - 2) * 20, z = 260 }) end
save(100, strong, 1000)
save(200, weak, 1040)
R.joinData = { [100] = { mode = "match", a = 100, b = 200 }, [200] = { mode = "match", a = 100, b = 200 } }

print("== 对战服务器（" .. MODE .. "）")
R.runScript(main, "server")
R.run(1)
check(#R.errors == 0, "对战服务器启动没报错")

local function join(name, uid, withClient)
  local p = R.addPlayer(name, uid)
  if withClient then R.localPlayer = p end
  Players.PlayerAdded:Fire(p)
  if withClient then
    local client = R.scriptFrom("LocalScript", "Client", SRC_DIR .. "/Client/init.client.lua", p.PlayerScripts)
    for _, f in ipairs(listLua(SRC_DIR .. "/Client")) do
      if f ~= "init.client.lua" then R.scriptFrom("ModuleScript", f:gsub("%.lua$", ""), SRC_DIR .. "/Client/" .. f, client) end
    end
    R.runScript(client, "client")
  end
  R.run(2)
  return p
end
local function guiText(p, pattern)
  for _, d in ipairs(p.PlayerGui:GetDescendants()) do
    if (d.ClassName == "TextLabel" or d.ClassName == "TextButton") and d.Text:find(pattern) then return d end
  end
end
local function toastTo(pattern)
  for _, e in ipairs(R.sent) do
    if e.name == "Toast" and tostring(e.args[1]):find(pattern) then return true end
  end
  return false
end
local function battle(phase)
  for _, e in ipairs(R.sent) do
    if e.name == "Battle" and type(e.args[1]) == "table" and e.args[1].phase == phase then return e.args[1] end
  end
end
local function backOf(uid)
  for _, t in ipairs(R.teleports) do
    if t.ids[1] == uid then return t end
  end
end

if MODE == "duel" then
  local a = join("Alpha", 100, true)
  check(guiText(a, "对战服务器") ~= nil and toastTo("等对手进场"), "先到的人看到「对战服务器：等对手」")
  R.run(3)
  check(battle("start") == nil, "对手没到之前不开打")
  join("Bravo", 200, false)
  R.run(1)
  check(toastTo("对手到了"), "对手到了：倒数开打")
  R.run(Config.Match.countdown + 1)
  local st = battle("start")
  check(st ~= nil and st.mode == "duel" and tostring(st.title):find("排位对战") ~= nil, "到齐自动开打排位对战：" .. tostring(st and st.title))
  -- 对战服务器里不能干别的
  R.as("client", function() RS.Remotes.Action:FireServer("battle") end)
  R.run(0.5)
  check(toastTo("只打这一场排位赛"), "对战服务器里点「开战」打关卡会被拦下")
  local done = nil
  for _ = 1, 600 do
    R.run(0.5)
    done = battle("end")
    if done then break end
  end
  check(done ~= nil and done.ranked == true, "排位对战打完：" .. tostring(done and done.result) .. "，" .. tostring(done and done.text):gsub("\n", " "))
  R.run(Config.Match.back + 2)
  local ta, tb = backOf(100), backOf(200)
  check(ta ~= nil and tb ~= nil and ta.code == "" and tb.code == "" and ta.place == 1234, "打完两个人都送回普通服务器（不带预留访问码）")
  local da, db = R.store[Config.SaveKey .. "/u100"], R.store[Config.SaveKey .. "/u200"]
  check(da.pvp ~= 1000 and db.pvp ~= 1040 and (da.pvp - 1000) == -(db.pvp - 1040), string.format("双方的对战积分存了档（%d → %d，%d → %d）", 1000, da.pvp, 1040, db.pvp))
  check(da.pvpGames == 1 and db.pvpGames == 1 and da.pvpWins + db.pvpWins == 1, "对战场次、胜场记上了")
  check(#da.army == #strong and #db.army == #weak, string.format("对战不损失部队（%d / %d、%d / %d）", #da.army, #strong, #db.army, #weak))
  check(Players:GetPlayerByUserId(100) == nil and Players:GetPlayerByUserId(200) == nil, "都离开了对战服务器")
else
  join("Lonely", 100, true)
  R.run(Config.Match.waitMax + 6)
  local t = backOf(100)
  check(t ~= nil and t.code == "" and toastTo("对手没进来"), "对手一直没来：" .. Config.Match.waitMax .. " 秒后送回普通服务器")
  check(battle("start") == nil, "没开打")
  local d = R.store[Config.SaveKey .. "/u100"]
  check(d.pvp == 1000 and (d.pvpGames or 0) == 0, "积分不变")
  -- 不是这一场的人进来了（理论上不会）：直接送回去
  R.joinData[300] = { mode = "match", a = 300, b = 400 }
  save(300, weak, 1000)
  join("Stranger", 300, false)
  R.run(5)
  check(backOf(300) ~= nil, "传送数据对不上的人送回普通服务器")
end

check(#R.errors == 0, "没报错")
if #R.errors > 0 then
  for _, e in ipairs(R.errors) do print("  " .. e) end
end
print(string.format("\n== 对战服务器（%s）：%d 个检查没通过，%d 个脚本错误", MODE, #fails, #R.errors))
if #fails > 0 or #R.errors > 0 then TEST_CODE = 1 end
