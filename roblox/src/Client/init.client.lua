-- 军事大亨：客户端（StarterPlayerScripts.Client）
-- 各模块共用一个上下文 G：Fx 特效与音效 · View 部队平滑显示 · UI 界面 · Guide 地图指引 · Anim 建筑动画 · Weather 战区天气 · Play 操作和镜头
local RS = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local G = { Config = require(RS:WaitForChild("Config")), R = {}, S = nil }
local Remotes = RS:WaitForChild("Remotes")
for _, name in ipairs({ "State", "Toast", "Action", "Fx", "Battle", "Shoot", "Drive", "Duel", "Board", "Err" }) do
  G.R[name] = Remotes:WaitForChild(name)
end

for _, name in ipairs({ "Fx", "View", "UI", "Guide", "Anim", "Weather", "Play" }) do
  require(script:WaitForChild(name)).init(G)
end

-- 一直收不到服务器的数据：多半是服务器脚本卡住或出错了，提示一下（不然只看到一片草地，不知道怎么回事）
task.delay(20, function()
  if not G.S then
    G.toast("等了 20 秒还没收到服务器的数据：服务器脚本可能卡住或出错了。请打开 Output（输出）窗口，把红色的字截图发给开发者", "bad")
  end
end)

-- 出错都写在屏幕上方的红条里：服务器接住的错、本地脚本的错
G.R.Err.OnClientEvent:Connect(function(msg) G.showError("服务器 " .. tostring(msg)) end)
pcall(function()
  game:GetService("ScriptContext").Error:Connect(function(msg, trace, scr)
    local where = scr and scr:GetFullName() or ""
    local line = trace and string.match(trace, "[^\n]+") or ""
    G.showError("本地 " .. tostring(msg) .. ((line ~= "") and ("  @ " .. line) or (where ~= "" and ("  @ " .. where) or "")))
  end)
end)

-- 远程事件的处理：一个出错不影响别的（错误照样会上红条）
local function safe(f)
  return function(...)
    local ok, err = pcall(f, ...)
    if not ok then G.showError("本地 " .. tostring(err)) end
  end
end
G.R.State.OnClientEvent:Connect(safe(function(s)
  if type(s) ~= "table" then return end
  G.S = s
  G.refresh()
end))
G.R.Toast.OnClientEvent:Connect(safe(function(msg, kind) G.toast(msg, kind) end))
G.R.Fx.OnClientEvent:Connect(safe(function(list) G.onFx(list) end))
G.R.Battle.OnClientEvent:Connect(safe(function(ev) G.onBattle(ev) end))
G.R.Duel.OnClientEvent:Connect(safe(function(ev) G.onDuelInvite(ev) end))
G.R.Board.OnClientEvent:Connect(safe(function(d) G.onBoard(d) end))

-- 每帧：各步分开接住错误（一步出错只报一次，别的照常跑，不会整个画面卡住）
local steps = { { "部队显示", function(dt) G.stepView(dt) end }, { "操作镜头", function(dt) G.stepPlay(dt) end }, { "特效", function() G.stepFx() end },
  { "界面", function(dt) G.stepUI(dt) end }, { "地图指引", function(dt) G.stepGuide(dt) end }, { "建筑动画", function(dt) G.stepAnim(dt) end },
  { "天气", function(dt) G.stepWeather(dt) end } }
RunService.RenderStepped:Connect(function(dt)
  for _, s in ipairs(steps) do
    local ok, err = pcall(s[2], dt)
    if not ok then G.showError("本地 " .. s[1] .. "：" .. tostring(err)) end
  end
end)
