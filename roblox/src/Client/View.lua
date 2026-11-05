-- 军事大亨（客户端）：部队的显示
-- 服务器上的单位模型每秒只更新 20 次位置，直接看会一顿一顿的：这里每个单位本地复制一份（服务器那份在本地藏起来），
-- 每帧平滑地追服务器的位置；炮塔按模型的 TY 属性转，旋翼飞的时候转，喷气机转弯时压坡度（按转向的快慢），打掉的涂黑；
-- 自己正在开的车直接用本地算的位置（开起来不卡）
local Players = game:GetService("Players")

local View = {}

function View.init(G)
  local V = Vector3.new
  local folder = Instance.new("Folder")
  folder.Name = "ClientUnits"
  folder.Parent = workspace
  G.unitFolder = folder
  local UNITS = G.Config.Units
  local vis = {}      -- [服务器的模型] = e
  local byClone = {}  -- [本地复制] = 服务器的模型
  G.vis = vis
  local me = Players.LocalPlayer

  local function hide(m)
    for _, d in ipairs(m:GetDescendants()) do
      if d:IsA("BasePart") then d.LocalTransparencyModifier = 1 end
    end
  end

  local function track(m)
    if vis[m] or not m:IsA("Model") or not m.Parent then return end
    local sroot = m:FindFirstChild("Root")
    if not sroot then return end
    local clone = m:Clone()
    if not clone then return end
    for _, d in ipairs(clone:GetDescendants()) do
      if d:IsA("BillboardGui") or d:IsA("Fire") or d:IsA("Smoke") then d:Destroy() end
    end
    local root = clone:FindFirstChild("Root")
    if not root then
      clone:Destroy()
      return
    end
    clone.Parent = folder
    hide(m)
    local def = UNITS[m:GetAttribute("Type") or ""]
    local e = { m = m, clone = clone, root = root, sroot = sroot, cf = sroot.CFrame, ty = 0, dead = false, jet = m:GetAttribute("Jet") == true, bank = 0,
      h3 = def and (def.foot and 2.5 or def.air and 2 or 3.5) or 3,   -- 导弹瞄准的高度（离模型底面）
      turret = clone:FindFirstChild("TurretMotor", true), rotor = clone:FindFirstChild("RotorMotor", true), tail = clone:FindFirstChild("TailMotor", true) }
    if e.tail then e.axis = e.tail:GetAttribute("Axis") or V(1, 0, 0) end
    -- 血条在服务器那份的 Root 上：改成跟着本地这份走（开战时才建，所以也盯着新加的）
    for _, c in ipairs(sroot:GetChildren()) do
      if c:IsA("BillboardGui") then c.Adornee = root end
    end
    e.conn = sroot.ChildAdded:Connect(function(c)
      if c:IsA("BillboardGui") then c.Adornee = root end
    end)
    vis[m] = e
    byClone[clone] = m
  end

  -- 本地复制 → 服务器的模型（布阵点选、开车选车用）
  function G.serverModelOf(clone)
    return byClone[clone]
  end
  function G.cloneOf(m)
    local e = vis[m]
    return e and e.clone
  end
  -- 战斗单位编号（模型的 BU 属性）→ 显示用的 e（导弹跟着它的本地复制飞）
  function G.visByBid(bid)
    for m, e in pairs(vis) do
      if m:GetAttribute("BU") == bid then return e end
    end
    return nil
  end

  local function watch(f)
    f.ChildAdded:Connect(function(m)
      task.wait()
      track(m)
    end)
    for _, m in ipairs(f:GetChildren()) do track(m) end
  end
  task.spawn(function()
    local plots = workspace:WaitForChild("Plots")
    local function onPlot(p)
      for _, n in ipairs({ "Units", "Enemies" }) do
        local f = p:WaitForChild(n, 30)
        if f then watch(f) end
      end
    end
    plots.ChildAdded:Connect(onPlot)
    for _, p in ipairs(plots:GetChildren()) do task.spawn(onPlot, p) end
  end)

  local rot = 0
  function G.stepView(dt)
    rot = rot + dt * 30
    local k = 1 - math.exp(-dt * 14)
    local dr = G.drive
    for m, e in pairs(vis) do
      if not m.Parent then
        e.clone:Destroy()
        if e.conn then e.conn:Disconnect() end
        byClone[e.clone] = nil
        vis[m] = nil
      else
        local mine = dr ~= nil and dr.cf ~= nil and m:GetAttribute("BU") == dr.bid and m:GetAttribute("Owner") == me.UserId
        local target = mine and dr.cf or e.sroot.CFrame
        if mine or (target.Position - e.cf.Position).Magnitude > 150 then e.cf = target else e.cf = e.cf:Lerp(target, k) end
        local cf = e.cf
        if e.jet and not mine and not e.dead then   -- 喷气机：左转（朝向角变大）向左压坡度
          local lv = cf.LookVector
          local yaw = math.atan2(-lv.X, -lv.Z)
          local dy = (yaw - (e.yaw or yaw) + math.pi) % (2 * math.pi) - math.pi
          e.yaw = yaw
          local want = math.clamp(dy / math.max(dt, 1 / 240) * 0.55, -1.1, 1.1)
          e.bank = e.bank + (want - e.bank) * math.min(1, dt * 4)
          cf = cf * CFrame.Angles(0, 0, e.bank)
        end
        e.root.CFrame = cf
        if e.turret then
          local ty = mine and (dr.ty or 0) or (m:GetAttribute("TY") or 0)
          local diff = (ty - e.ty + math.pi) % (2 * math.pi) - math.pi
          e.ty = e.ty + diff * math.min(1, dt * 12)
          e.turret.Transform = CFrame.Angles(0, e.ty, 0)
        end
        if m:GetAttribute("Fly") then
          if e.rotor then e.rotor.Transform = CFrame.Angles(0, rot, 0) end
          if e.tail then e.tail.Transform = CFrame.fromAxisAngle(e.axis, rot * 1.7) end
        end
        if not e.dead and m:GetAttribute("Dead") then   -- 打掉了：烧黑
          e.dead = true
          for _, p in ipairs(e.clone:GetDescendants()) do
            if p.ClassName == "SurfaceAppearance" then
              p:Destroy()
            elseif p:IsA("BasePart") and p.Name ~= "Root" and p.Name ~= "TeamRing" and p.Transparency < 1 then
              p.Color = Color3.fromRGB(38, 35, 32)
              p.Material = Enum.Material.CorrodedMetal
              if p:IsA("MeshPart") then p.TextureID = "" end
            end
          end
        end
      end
    end
  end
end

return View
