-- 军事大亨：地图（光照、地形、六块基地、约战竞技场）
local Lighting = game:GetService("Lighting")

local World = {}

function World.init(G)
  local Config, Models = G.Config, G.Models
  local V = Vector3.new
  local F = Config.Field

  Lighting.ClockTime = 14.3
  Lighting.Brightness = 2.4
  Lighting.GlobalShadows = true
  Lighting.OutdoorAmbient = Color3.fromRGB(125, 128, 135)
  Lighting.EnvironmentDiffuseScale = 0.6
  Lighting.EnvironmentSpecularScale = 0.6
  if not Lighting:FindFirstChildOfClass("Atmosphere") then
    local atm = Instance.new("Atmosphere")
    atm.Density = 0.26
    atm.Offset = 0.15
    atm.Haze = 1.2
    atm.Glare = 0.2
    atm.Color = Color3.fromRGB(198, 210, 226)
    atm.Decay = Color3.fromRGB(106, 118, 140)
    atm.Parent = Lighting
  end

  -- 地面：地形草地，顶面在 y = 0（分块填，单次别太大）；盖住基地、战场和后面的竞技场
  do
    local T = workspace.Terrain
    local half = Config.PlotCount * Config.PlotSpacing / 2 + 200
    local z0 = -Config.BaseSize / 2 - 200
    local z1 = Config.Arena.z + F.center + F.length / 2 + 200
    local x = -half
    while x < half do
      local w = math.min(512, half - x)
      local z = z0
      while z < z1 do
        local d = math.min(512, z1 - z)
        T:FillBlock(CFrame.new(x + w / 2, -6, z + d / 2), V(w, 12, d), Enum.Material.Grass)
        z = z + d
      end
      x = x + w
    end
  end

  local PlotsF = Instance.new("Folder")
  PlotsF.Name = "Plots"
  PlotsF.Parent = workspace
  G.plots = {}
  for i = 1, Config.PlotCount do
    local cx = (i - (Config.PlotCount + 1) / 2) * Config.PlotSpacing
    local f = Instance.new("Folder")
    f.Name = "Plot" .. i
    local plot = { index = i, origin = V(cx, 0, 0), folder = f, color = Config.PlotColors[i] or Color3.new(1, 1, 1) }
    local info = Models.plot(f, plot.origin, plot.color, i)
    plot.field = info.field
    plot.sign = info.sign
    plot.board = info.board
    for _, name in ipairs({ "Buildings", "Pads", "Units", "Enemies" }) do
      local sub = Instance.new("Folder")
      sub.Name = name
      sub.Parent = f
      plot[name] = sub
    end
    f.Parent = PlotsF
    G.plots[i] = plot
  end

  local ArenasF = Instance.new("Folder")
  ArenasF.Name = "Arenas"
  ArenasF.Parent = workspace
  G.arenas = {}
  for i, ax in ipairs(Config.Arena.xs) do
    local f = Instance.new("Folder")
    f.Name = "Arena" .. i
    local origin = V(ax, 0, Config.Arena.z)
    local info = Models.arena(f, origin, i)
    local units = Instance.new("Folder")
    units.Name = "Units"
    units.Parent = f
    f.Parent = ArenasF
    G.arenas[i] = { index = i, origin = origin, folder = f, field = info.field, Units = units, busy = false }
  end

  -- 单位的位置：战场原点 + (x, 1 + y, z)，朝向 h
  function G.unitCF(origin, x, y, z, h)
    return CFrame.new(origin + V(x, 1 + y, z)) * CFrame.Angles(0, h, 0)
  end
end

return World
