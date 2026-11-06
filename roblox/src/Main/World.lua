-- 军事大亨：地图（光影、地形世界、六块基地、约战竞技场；场景细节在 Scenery 里）
local World = {}

function World.init(G)
  local Config, Models = G.Config, G.Models
  local Scenery = require(script.Parent:WaitForChild("Scenery"))
  G.Scenery = Scenery
  local V = Vector3.new

  Scenery.lighting()
  -- 地形：一整层草地（顶面 y = 0），基地之间的山丘、四周的雪山、湖、河；树林、桥
  local groundY, info = Scenery.terrain(Config)
  G.mapInfo = info
  G.try("种树", Scenery.nature, workspace, Config, groundY, info)

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
    for _, name in ipairs({ "Buildings", "Pads", "Units", "Enemies", "Drops" }) do
      local sub = Instance.new("Folder")
      sub.Name = name
      sub.Parent = f
      plot[name] = sub
    end
    G.try("基地外围", Scenery.base, f, plot.origin, plot.color, Config)
    G.try("工业区", Scenery.industry, f, plot.origin, Config)
    G.try("战区", Scenery.theater, plot, "grass", Config)
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
    -- 竞技场也有战区样子：1 号城市废墟、2 号沙漠
    G.try("竞技场战区", Scenery.theater, { origin = origin, folder = f, field = info.field, index = 20 + i, color = Color3.fromRGB(60, 140, 230) }, (i == 1) and "urban" or "desert", Config)
    f.Parent = ArenasF
    G.arenas[i] = { index = i, origin = origin, folder = f, field = info.field, Units = units, busy = false }
  end

  -- 换战区：这块战场的地面、两边地形、道具全换（打掉首领、进新战区时；进服按关卡）
  function G.setTheater(st, th)
    if st.plot.theater == th.id then return false end
    G.try("换战区", Scenery.theater, st.plot, th.id, Config)
    return true
  end

  -- 单位的位置：战场原点 + (x, 1 + y, z)，朝向 h
  function G.unitCF(origin, x, y, z, h)
    return CFrame.new(origin + V(x, 1 + y, z)) * CFrame.Angles(0, h, 0)
  end
end

return World
