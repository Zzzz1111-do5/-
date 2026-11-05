-- 军事大亨：客户端（StarterPlayerScripts.Client）
-- 各模块共用一个上下文 G：Fx 特效 · View 部队平滑显示 · UI 界面 · Play 操作和镜头
local RS = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local G = { Config = require(RS:WaitForChild("Config")), R = {}, S = nil }
local Remotes = RS:WaitForChild("Remotes")
for _, name in ipairs({ "State", "Toast", "Action", "Fx", "Battle", "Shoot", "Drive", "Duel", "Board" }) do
  G.R[name] = Remotes:WaitForChild(name)
end

for _, name in ipairs({ "Fx", "View", "UI", "Play" }) do
  require(script:WaitForChild(name)).init(G)
end

G.R.State.OnClientEvent:Connect(function(s)
  if type(s) ~= "table" then return end
  G.S = s
  G.refresh()
end)
G.R.Toast.OnClientEvent:Connect(function(msg, kind) G.toast(msg, kind) end)
G.R.Fx.OnClientEvent:Connect(function(list) G.onFx(list) end)
G.R.Battle.OnClientEvent:Connect(function(ev) G.onBattle(ev) end)
G.R.Duel.OnClientEvent:Connect(function(ev) G.onDuelInvite(ev) end)
G.R.Board.OnClientEvent:Connect(function(d) G.onBoard(d) end)

RunService.RenderStepped:Connect(function(dt)
  G.stepView(dt)
  G.stepPlay(dt)
  G.stepFx()
end)
