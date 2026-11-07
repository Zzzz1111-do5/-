-- 军事大亨（客户端）：操作和镜头——
--   free 在基地里走 / 战场上自己当兵（Roblox 默认镜头）；deploy 布阵；battle 观战；drive 开车 / 开直升机 / 开喷气机（追尾镜头，本地算位置，20 次 / 秒发给服务器）
--   布阵：镜头按屏幕上没被面板挡住的那块自动拉近、框住部署区；点部队选中（Shift 加选、双击选同兵种、空地上拖框多选、下面一排兵种点一下选一类），
--     按住拖动摆放（几个一起拖保持队形）、点空地放下（几个一起：就地排成一块，步兵在前）；服务器直接摆到位；「看敌军」看这一关的敌军摆在哪
--   观战（开战默认）：自动导播——还没接火从我军背后看过去，接火后框住交火的单位、平滑推拉；点单位跟着它（追尾），Tab 换下一个；
--     拖动 / WASD 平移变自由镜头，空格或「自动镜头」回自动；鼠标指着单位显示名称、血量；拿枪或「操控小人」切回自己的小人
--   拿枪：按住左键连发（狙击枪、火箭筒一下一发），R 换弹；手机点屏幕开火
--   支援技能：点技能键（或按 Z X V B N），地上出现范围圈跟着鼠标，左键放下（手机点一下战场），右键 / Esc 取消
--   战斗事件：命中标记、飘伤害数字、连杀播报、战报滚动条、首领来袭、结算评星
local Players = game:GetService("Players")
local UIS = game:GetService("UserInputService")
local PPS = game:GetService("ProximityPromptService")
local GuiService = game:GetService("GuiService")

local Play = {}

local function wrap(a)
  return (a + math.pi) % (2 * math.pi) - math.pi
end

---------------------------------------------------------------- 布阵、观战：镜头和点选
-- 单独一个函数（都写进 Play.init，局部变量会超过 Luau 一个函数 200 个的上限）。
-- 对外：G.setMode、G.toggleDeploy、G.toggleOverview、G.toggleDeployView、G.followNext、G.specAuto、G.ctlStep、G.ctlDown / Move / Up / Wheel / Pinch / Turn / Key / Rotate、G.ctlClear
local function ctlInit(G, getControls)
  local Config = G.Config
  local UNITS = Config.Units
  local F = Config.Field
  local V, V2 = Vector3.new, Vector2.new
  local RGB = Color3.fromRGB
  local player = Players.LocalPlayer
  local cam = workspace.CurrentCamera
  local ui = G.ui
  local RA = G.R.Action
  local PI = math.pi
  local ZMIN, ZMAX = F.center - F.length / 2, F.center + F.length / 2
  local ORD = {}
  for i, t in ipairs(Config.UnitOrder) do ORD[t] = i end

  local orbit = { yaw = 0, pitch = math.rad(58), dist = 420, focus = V(0, 0, 0), origin = V(0, 0, 0) }
  local camCF = nil
  local rotating = false
  local fit = true            -- 布阵：还没手动缩放 / 平移 / 转，镜头一直框住整个区（面板收起、屏幕变了跟着重新框）
  local view = "mine"         -- 布阵看哪边：mine 部署区 / enemy 敌军区
  G.deployView = view
  local spec = { mode = "auto", m = nil, lost = 0, zoomK = 1, yawOff = 0, t = 99, focus = nil, dist = 600, hot = false }
  G.spec = spec
  local ptr = nil             -- 按下去的这一下（鼠标左键 / 一根手指）
  local touchN = 0
  local pinch0, turn0 = nil, nil
  local lastClick = { m = nil, t = 0 }
  local hoverP = nil          -- 鼠标在视口里的位置（电脑）
  local hintT = -99

  local function inset()
    local ok, a = pcall(function() return GuiService:GetGuiInset() end)
    if ok and typeof(a) == "Vector2" then return a end
    return V2(0, 0)
  end
  -- 输入事件的位置不含顶栏；镜头的投影、射线都用视口坐标（含顶栏）
  local function vpOf(input)
    return V2(input.Position.X, input.Position.Y) + inset()
  end
  local function shiftDown()
    return UIS:IsKeyDown(Enum.KeyCode.LeftShift) or UIS:IsKeyDown(Enum.KeyCode.RightShift)
  end
  local function groundY()
    return orbit.origin.Y + 1
  end

  ---------------------------------------------------------------- 取景

  local function open(c)
    return c == nil or not c.collapsed
  end
  -- 屏幕上没被面板挡住的那块（视口像素）：镜头按它取景，焦点落在它中间
  local function freeRect()
    local vs = cam.ViewportSize
    local W, H = vs.X, vs.Y
    local s = (ui.scale and ui.scale.Scale) or 1
    local top = inset().Y
    local c = G.compact
    local x0, x1, y0, y1
    if G.mode == "battle" then
      if c then
        x0, x1, y0, y1 = 10 * s, W - 128 * s, top + 60 * s, H - 150 * s
      else
        x0, x1, y0, y1 = 20 * s, W - 20 * s, top + 140 * s, H - 250 * s
      end
    else
      local infoOn = ui.info and ui.info.Visible and open(ui.infoC)
      local shopOn = ui.shop and ui.shop.Visible and open(ui.shopC)
      if c then
        x0 = (infoOn and 250 or 60) * s
        x1 = W - (shopOn and 306 or 14) * s
        y0, y1 = top + 92 * s, H - 152 * s
      else
        x0 = (infoOn and 300 or 160) * s
        x1 = W - (shopOn and 350 or 20) * s
        y0, y1 = top + 118 * s, H - 182 * s
      end
    end
    if x1 - x0 < W * 0.35 then x0, x1 = W * 0.3, W * 0.7 end
    if y1 - y0 < H * 0.3 then y0, y1 = H * 0.32, H * 0.72 end
    return { x0 = x0, x1 = x1, y0 = y0, y1 = y1 }
  end
  local function shrink(r, k)
    local dx, dy = (r.x1 - r.x0) * k, (r.y1 - r.y0) * k
    return { x0 = r.x0 + dx, x1 = r.x1 - dx, y0 = r.y0 + dy, y1 = r.y1 - dy }
  end
  -- 镜头摆法：从 focus 往后退 dist、按 yaw / pitch 看过去；再横着挪一点，让 focus 正好落在空着的那块的中间
  local function rig(focus, dist, r)
    local vs = cam.ViewportSize
    local th = math.tan(math.rad(cam.FieldOfView) / 2)
    local asp = vs.X / math.max(1, vs.Y)
    local cp = math.cos(orbit.pitch)
    local look = V(math.sin(orbit.yaw) * cp, -math.sin(orbit.pitch), math.cos(orbit.yaw) * cp)
    local right = V(-math.cos(orbit.yaw), 0, math.sin(orbit.yaw))
    local up = right:Cross(look)
    local cx = (r.x0 + r.x1) / vs.X - 1
    local cy = 1 - (r.y0 + r.y1) / vs.Y
    local eye = focus - look * dist - right * (cx * dist * th * asp) - up * (cy * dist * th)
    return { eye = eye, look = look, right = right, up = up, th = th, asp = asp, W = vs.X, H = vs.Y }
  end
  -- 这些点都落进那块里时，镜头最近能离多近（离得越远点越往中间挤：二分）
  local function fitDist(pts, focus, r, dmin, dmax)
    local vs = cam.ViewportSize
    local nx0, nx1 = r.x0 / vs.X * 2 - 1, r.x1 / vs.X * 2 - 1
    local ny0, ny1 = 1 - r.y1 / vs.Y * 2, 1 - r.y0 / vs.Y * 2
    local function ok(d)
      local R = rig(focus, d, r)
      for _, p in ipairs(pts) do
        local rel = p - R.eye
        local z = rel:Dot(R.look)
        if z < 1 then return false end
        local sx = rel:Dot(R.right) / (z * R.th * R.asp)
        local sy = rel:Dot(R.up) / (z * R.th)
        if sx < nx0 or sx > nx1 or sy < ny0 or sy > ny1 then return false end
      end
      return true
    end
    if ok(dmin) then return dmin end
    if not ok(dmax) then return dmax end
    local lo, hi = dmin, dmax
    for _ = 1, 16 do
      local mid = (lo + hi) / 2
      if ok(mid) then hi = mid else lo = mid end
    end
    return hi
  end
  -- 视口上一点对应的地面：按镜头「要去」的位置算（不按正在缓动的那个），拖地图才跟手、不晃
  local function groundRig(sp, focus)
    local R = rig(focus or orbit.focus, orbit.dist, freeRect())
    local nx, ny = sp.X / R.W * 2 - 1, 1 - sp.Y / R.H * 2
    local dir = R.look + R.right * (nx * R.th * R.asp) + R.up * (ny * R.th)
    if dir.Y > -1e-3 then return nil end
    local t = (groundY() - R.eye.Y) / dir.Y
    if t <= 0 then return nil end
    return R.eye + dir * t
  end
  -- 按现在的镜头：这一点的视线和地面（战场顶面）的交点
  local function groundCam(sp)
    local ray = cam:ViewportPointToRay(sp.X, sp.Y)
    if ray.Direction.Y > -1e-4 then return nil end
    local t = (groundY() - ray.Origin.Y) / ray.Direction.Y
    if t <= 0 or t > 8000 then return nil end
    return ray.Origin + ray.Direction * t
  end

  ---------------------------------------------------------------- 单位

  local function myF(name)
    local S = G.S
    local pf = S and workspace:FindFirstChild("Plots")
    local p = pf and pf:FindFirstChild("Plot" .. tostring(S.plot))
    return p and p:FindFirstChild(name)
  end
  local function aliveIn(folder, needUid)
    local out = {}
    if not folder then return out end
    for m, e in pairs(G.vis or {}) do
      if m.Parent == folder and e.clone and e.clone.Parent and not m:GetAttribute("Dead") and (not needUid or m:GetAttribute("Uid") ~= nil) then
        out[#out + 1] = { m = m, e = e, p = e.root.Position, t = m:GetAttribute("Type") }
      end
    end
    return out
  end
  local function mineList()
    return aliveIn(myF("Units"), true)
  end
  local function enemyPreview()
    return aliveIn(myF("Enemies"), false)
  end
  -- 这一仗里还活着的单位（两边都有；其他基地里的不算）
  local function battleList()
    local B = G.battle
    local out = {}
    if not B or not B.origin then return out end
    local o = B.origin
    local f = myF("Units")
    for m, e in pairs(G.vis or {}) do
      if m.Parent and e.clone and e.clone.Parent and not m:GetAttribute("Dead") then
        local p = e.root.Position
        local rel = p - o
        if math.abs(rel.X) < F.width / 2 + 180 and rel.Z > ZMIN - 240 and rel.Z < ZMAX + 240 and rel.Y < 700 then
          local t = m:GetAttribute("Type")
          out[#out + 1] = { m = m, e = e, p = p, t = t, def = UNITS[t or ""], friend = (m.Parent == f) or (m:GetAttribute("Owner") == player.UserId) }
        end
      end
    end
    return out
  end
  local function hpOf(m)
    local r = m:FindFirstChild("Root")
    local bb = r and r:FindFirstChild("HP")
    if not (bb and bb.Enabled) then return nil end
    local bg = bb:FindFirstChildOfClass("Frame")
    local fill = bg and bg:FindFirstChild("Fill")
    return fill and fill.Size.X.Scale or nil
  end

  -- 屏幕上离这一点最近的单位（按它在屏幕上多大，至少 18 像素：小兵也好点）
  local function pickScreen(sp, list)
    local best, bk = nil, 1
    local rv = cam.CFrame.RightVector
    for _, it in ipairs(list) do
      local def = UNITS[it.t or ""]
      local size = def and def.size or 8
      local c0 = it.p + V(0, (it.m:GetAttribute("H") or 4) * 0.45, 0)
      local a = cam:WorldToViewportPoint(c0)
      if a.Z > 0 then
        local b = cam:WorldToViewportPoint(c0 + rv * size * 0.5)
        local rad = math.max(18, math.abs(b.X - a.X) + math.abs(b.Y - a.Y) + 6)
        local d = math.sqrt((a.X - sp.X) ^ 2 + (a.Y - sp.Y) ^ 2) / rad
        if d < bk then best, bk = it, d end
      end
    end
    return best
  end
  -- 点下去指着哪个单位：先看视线直接打中的，打不中找屏幕上离得近的；顺便给出地面上的点
  local castP = RaycastParams.new()
  castP.FilterType = Enum.RaycastFilterType.Include
  local function pickAt(sp, list)
    local inc = { G.unitFolder }
    local fld = (G.mode == "deploy") and myF("Field") or nil
    if fld then inc[2] = fld end
    castP.FilterDescendantsInstances = inc
    local ray = cam:ViewportPointToRay(sp.X, sp.Y)
    local res = workspace:Raycast(ray.Origin, ray.Direction * 6000, castP)
    local ground = nil
    if res then
      local c = res.Instance
      while c and c.Parent ~= G.unitFolder do c = c.Parent end
      local m = c and G.serverModelOf(c)
      if m then   -- 打中的是单位：地面的点按视线和地面的交点（拖动时按它算挪了多远）
        for _, it in ipairs(list) do
          if it.m == m then return it, groundCam(sp) end
        end
      end
      if fld and res.Instance == fld then ground = res.Position end
    end
    ground = ground or groundCam(sp)
    return pickScreen(sp, list), ground
  end

  ---------------------------------------------------------------- 选中

  local sel, selN = {}, 0
  local hls = {}
  local function selChanged()
    selN = 0
    local one = nil
    for m in pairs(sel) do
      if m.Parent then
        selN = selN + 1
        one = m
      else
        sel[m] = nil
      end
    end
    -- 高亮：选得不多时每个都加（Roblox 同时最多显示 31 个高亮）；多了只靠脚下的圈
    for m, h in pairs(hls) do
      if not sel[m] or selN > 12 then
        h:Destroy()
        hls[m] = nil
      end
    end
    if selN <= 12 then
      for m in pairs(sel) do
        local c = G.cloneOf(m)
        if c and not hls[m] then
          hls[m] = G.mk("Highlight", { FillColor = RGB(255, 220, 80), FillTransparency = 0.6, OutlineColor = RGB(255, 240, 160), OutlineTransparency = 0,
            DepthMode = Enum.HighlightDepthMode.AlwaysOnTop }, c)
        end
      end
    end
    if selN == 1 then
      G.sel = { m = one, clone = G.cloneOf(one), uid = one:GetAttribute("Uid"), t = one:GetAttribute("Type") }
      local def = UNITS[G.sel.t or ""]
      if def then ui.sellBtn.Text = "解散 +$" .. Config.Fmt(math.floor(def.price * 0.5)) end
    else
      G.sel = nil
    end
    G.selN = selN
    G.updateButtons()
  end
  local function selClear()
    for m in pairs(sel) do sel[m] = nil end
    selChanged()
  end
  G.ctlClear = selClear
  local function selectType(t, add)
    if not add then
      for m in pairs(sel) do sel[m] = nil end
    end
    for _, it in ipairs(mineList()) do
      if t == nil or it.t == t then sel[it.m] = true end
    end
    selChanged()
  end
  local function boxSelect(a, b, add)
    local x0, x1 = math.min(a.X, b.X), math.max(a.X, b.X)
    local y0, y1 = math.min(a.Y, b.Y), math.max(a.Y, b.Y)
    if not add then
      for m in pairs(sel) do sel[m] = nil end
    end
    for _, it in ipairs(mineList()) do
      local v = cam:WorldToViewportPoint(it.p + V(0, 2, 0))
      if v.Z > 0 and v.X >= x0 and v.X <= x1 and v.Y >= y0 and v.Y <= y1 then sel[it.m] = true end
    end
    selChanged()
  end

  ---------------------------------------------------------------- 摆放

  local function inZone(x, z)
    return z >= F.deploy[1] and z <= F.deploy[2] and math.abs(x) <= F.width / 2 - 4
  end
  -- 几个一起放到一点：就地排成一块（每排不超过 √(2.4n) 个；row 小的兵种在前＝朝敌人那边），整块尽量留在部署区里
  local function blockAt(items, x, z)
    table.sort(items, function(a, b)
      if a.row ~= b.row then return a.row < b.row end
      if a.t ~= b.t then return (ORD[a.t or ""] or 99) < (ORD[b.t or ""] or 99) end
      return (a.uid or 0) < (b.uid or 0)
    end)
    local cols = math.max(1, math.ceil(math.sqrt(#items * 2.4)))
    local lines = {}
    for i, it in ipairs(items) do
      local li = math.floor((i - 1) / cols) + 1
      local L = lines[li]
      if not L then
        L = { w = 0, d = 0, items = {} }
        lines[li] = L
      end
      local s = it.size + 5
      L.items[#L.items + 1] = it
      L.w = L.w + s
      L.d = math.max(L.d, s)
    end
    local depth, wmax = 0, 0
    for _, L in ipairs(lines) do
      depth = depth + L.d
      wmax = math.max(wmax, L.w)
    end
    local hw = F.width / 2 - 10
    if wmax / 2 < hw then x = math.clamp(x, -hw + wmax / 2, hw - wmax / 2) end
    local D1, D2 = F.deploy[1] + 2, F.deploy[2] - 2
    if depth < D2 - D1 then z = math.clamp(z, D1 + depth / 2, D2 - depth / 2) end
    local out = {}
    local zz = z + depth / 2
    for _, L in ipairs(lines) do
      local zc = zz - L.d / 2
      local xx = x + L.w / 2   -- 从北往南看，+X 在左：从左往右排
      for _, it in ipairs(L.items) do
        local s = it.size + 5
        out[#out + 1] = { it.uid, xx - s / 2, zc }
        xx = xx - s
      end
      zz = zz - L.d
    end
    return out
  end
  local function selItems()
    local items = {}
    for m in pairs(sel) do
      if m.Parent then
        local t = m:GetAttribute("Type")
        local def = UNITS[t or ""]
        items[#items + 1] = { uid = m:GetAttribute("Uid"), size = def and def.size or 8, row = def and def.row or 5, t = t, m = m }
      end
    end
    return items
  end
  -- 点空地：选中一个就放到这一点，几个就地排成一块
  local function groundPlan(g)
    if not (g and G.S) then return nil end
    local items = selItems()
    if #items == 0 then return nil end
    local rel = g - G.S.origin
    if #items == 1 then return { { items[1].uid, rel.X, rel.Z } }, rel end
    return blockAt(items, rel.X, rel.Z), rel
  end
  local function groundClick(g)
    if view ~= "mine" or not g then return end
    if selN == 0 then
      if os.clock() - hintT > 6 then
        hintT = os.clock()
        G.toast(G.mobile and "先点一下自己的部队（或下面一排的兵种），再点要放的位置" or "先点自己的部队选中（也能拖框、双击、点下面一排的兵种），再点要放的位置", "info")
      end
      return
    end
    local list, rel = groundPlan(g)
    if not list then return end
    if not inZone(rel.X, rel.Z) then
      G.toast("只能摆在蓝色的部署区里", "bad")
      return
    end
    RA:FireServer("place", list)
    G.playSound("click")
    selClear()
  end
  -- 拖动放手：选中的这些都挪同样一段（保持队形）
  local function dragPlan(off)
    local S = G.S
    local list, okN = {}, 0
    for m in pairs(sel) do
      local e = G.vis and G.vis[m]
      if e and m.Parent then
        local p = e.root.Position + off - S.origin
        list[#list + 1] = { m:GetAttribute("Uid"), p.X, p.Z, m }
        if inZone(p.X, p.Z) then okN = okN + 1 end
      end
    end
    return list, okN
  end
  local function dropSel(off)
    local list, okN = dragPlan(off)
    if #list == 0 then return false end
    if okN == 0 then
      G.toast("只能摆在蓝色的部署区里", "bad")
      return false
    end
    for _, e in ipairs(list) do e[4] = nil end
    RA:FireServer("place", list)
    G.playSound("click")
    return true
  end

  ---------------------------------------------------------------- 地上的圈、头顶的名字、屏幕上的框和提示

  local rings, ringN = {}, 0
  local function ring(x, z, d, color, tr)
    ringN = ringN + 1
    local r = rings[ringN]
    if not r then
      r = G.fxPart(Enum.PartType.Cylinder, V(0.25, 10, 10), CFrame.new(), color, Enum.Material.Neon, 1)
      rings[ringN] = r
    end
    r.Size = V(0.25, d, d)
    r.CFrame = CFrame.new(x, groundY() + 0.3, z) * CFrame.Angles(0, 0, PI / 2)
    r.Color = color
    r.Transparency = tr
  end
  local function ringsDone()
    for i = ringN + 1, #rings do
      if rings[i].Transparency < 1 then rings[i].Transparency = 1 end
    end
    ringN = 0
  end

  local tags = {}   -- [服务器的模型] = 头顶名字（布阵时）
  local function tagStep(on)
    for m, bb in pairs(tags) do
      if not m.Parent or not bb.Parent then
        if bb.Parent then bb:Destroy() end
        tags[m] = nil
      elseif not on then
        bb.Enabled = false
      end
    end
    if not on then return end
    for _, it in ipairs(mineList()) do
      local bb = tags[it.m]
      if not bb then
        local def = UNITS[it.t or ""]
        local name = def and (def.short or def.name) or "?"
        bb = G.mk("BillboardGui", { Name = "DeployTag", Adornee = it.e.root, Size = UDim2.fromOffset(16 + 13 * (utf8.len(name) or 2), 18),
          StudsOffsetWorldSpace = V(0, (it.m:GetAttribute("H") or 5) + 2.2, 0), AlwaysOnTop = true, LightInfluence = 0, MaxDistance = 1100 }, it.e.clone)
        local l = G.text(bb, { Name = "L", Size = UDim2.fromScale(1, 1), BackgroundTransparency = 0.35, BackgroundColor3 = RGB(16, 20, 28), TextSize = 13,
          Font = Enum.Font.GothamBold, TextXAlignment = Enum.TextXAlignment.Center, Text = name })
        G.round(l, 5)
        tags[it.m] = bb
      end
      bb.Enabled = true
      local l = bb:FindFirstChild("L")
      if l then l.TextColor3 = sel[it.m] and RGB(255, 220, 90) or RGB(235, 240, 245) end
    end
  end

  local over = G.mk("ScreenGui", { Name = "CamOverlay", ResetOnSpawn = false, IgnoreGuiInset = true, DisplayOrder = 3 }, player:WaitForChild("PlayerGui"))
  local box = G.mk("Frame", { BackgroundColor3 = RGB(120, 200, 255), BackgroundTransparency = 0.85, BorderSizePixel = 0, Visible = false }, over)
  G.mk("UIStroke", { Color = RGB(160, 220, 255), Thickness = 1.5 }, box)
  local tip = G.text(over, { AutomaticSize = Enum.AutomaticSize.XY, Size = UDim2.fromOffset(0, 0), BackgroundTransparency = 0.2, BackgroundColor3 = RGB(14, 18, 24),
    TextSize = 14, RichText = true, Visible = false, ZIndex = 5 })
  G.round(tip, 6)
  G.mk("UIPadding", { PaddingLeft = UDim.new(0, 8), PaddingRight = UDim.new(0, 8), PaddingTop = UDim.new(0, 4), PaddingBottom = UDim.new(0, 4) }, tip)

  -- 布阵时下面一排：每个兵种一个（点一下选上这一类，Shift 加选），最前面「全部」
  local chips = G.mk("ScrollingFrame", { Name = "Roster", BackgroundTransparency = 1, BorderSizePixel = 0, ScrollBarThickness = 3, AnchorPoint = V2(0.5, 1),
    Position = UDim2.new(0.5, 0, 1, -136), Size = UDim2.fromOffset(880, 36), CanvasSize = UDim2.fromOffset(0, 36), Visible = false }, ui.root)
  G.mk("UIListLayout", { FillDirection = Enum.FillDirection.Horizontal, HorizontalAlignment = Enum.HorizontalAlignment.Center, VerticalAlignment = Enum.VerticalAlignment.Center,
    Padding = UDim.new(0, 6), SortOrder = Enum.SortOrder.LayoutOrder }, chips)
  ui.roster = chips
  local chipSig, chipBtns, chipAll = "", {}, 0
  local function chipsStep(on)
    chips.Visible = on
    if not on then return end
    local c = G.compact
    if c then
      chips.Position, chips.Size = UDim2.new(0.5, 0, 1, -116), UDim2.fromOffset(680, 32)
    else
      chips.Position, chips.Size = UDim2.new(0.5, 0, 1, -136), UDim2.fromOffset(880, 36)
    end
    local all = mineList()
    local counts, order = {}, {}
    for _, it in ipairs(all) do
      local t = it.t
      if t and UNITS[t] then
        if not counts[t] then
          counts[t] = 0
          order[#order + 1] = t
        end
        counts[t] = counts[t] + 1
      end
    end
    table.sort(order, function(a, b) return (ORD[a] or 99) < (ORD[b] or 99) end)
    local sig = tostring(#all) .. (c and "c" or "")
    for _, t in ipairs(order) do sig = sig .. "," .. t .. counts[t] end
    if sig ~= chipSig then
      chipSig = sig
      chipAll = #all
      for _, b in ipairs(chipBtns) do b:Destroy() end
      chipBtns = {}
      local h = c and 28 or 32
      local total = 0
      local function add(label, n, t, i)
        local w = (c and 20 or 24) + (c and 13 or 15) * (utf8.len(label) or 2) + (c and 8 or 9) * #tostring(n)
        local b = G.button(chips, label .. " " .. n, RGB(40, 54, 72), { Size = UDim2.fromOffset(w, h), TextSize = c and 13 or 15, LayoutOrder = i }, function()
          selectType(t, shiftDown())
        end)
        b:SetAttribute("T", t or "*")
        chipBtns[#chipBtns + 1] = b
        total = total + w + 6
      end
      if #all > 0 then
        add("全部", #all, nil, 0)
        for i, t in ipairs(order) do add(UNITS[t].short or UNITS[t].name, counts[t], t, i) end
      end
      chips.CanvasSize = UDim2.fromOffset(math.max(total, 10), h + 4)
    end
    local selT = {}
    for m in pairs(sel) do selT[m:GetAttribute("Type") or ""] = true end
    for _, b in ipairs(chipBtns) do
      local t = b:GetAttribute("T")
      local lit = (t == "*" and selN > 0 and selN == chipAll) or (t ~= "*" and selT[t] == true)
      b.BackgroundColor3 = lit and RGB(176, 140, 40) or RGB(40, 54, 72)
    end
  end

  -- 鼠标指着的单位：旁边一个小框写名称、敌我、血量（电脑）
  local hoverT = 0
  local hoverIt = nil
  local function hoverStep(dt, active)
    hoverT = hoverT + dt
    if not active or G.mobile or not hoverP or (ptr and ptr.moved) or rotating then
      tip.Visible = false
      hoverIt = nil
      return
    end
    if hoverT < 0.06 then return end
    hoverT = 0
    local list
    if G.mode == "deploy" then
      list = (view == "mine") and mineList() or enemyPreview()
    else
      list = battleList()
    end
    local it = pickScreen(hoverP, list)
    hoverIt = it
    if not it then
      tip.Visible = false
      return
    end
    local def = UNITS[it.t or ""]
    local friend = (G.mode == "deploy" and view == "mine") or it.friend == true
    local s = def and def.name or "单位"
    local stars = it.m:GetAttribute("Stars") or 0
    if stars > 0 then s = s .. " <font color=\"#FFD24A\">" .. string.rep("★", stars) .. "</font>" end
    local side = friend and "<font color=\"#7CFC8A\">我方</font>" or "<font color=\"#FF8A80\">敌方</font>"
    local hp = (G.mode == "battle") and hpOf(it.m) or nil
    local extra = hp and string.format("  · 血量 %d%%", math.floor(hp * 100 + 0.5)) or ""
    if G.mode == "deploy" and view == "mine" and def then extra = "  · 射程 " .. def.range end
    if G.mode == "battle" and spec.m ~= it.m then extra = extra .. "  <font color=\"#B8C2CC\">（点一下跟随）</font>" end
    local sc = (ui.scale and ui.scale.Scale) or 1
    tip.TextSize = math.floor(14 * math.max(1, sc) + 0.5)
    tip.Text = side .. " " .. s .. extra
    tip.Position = UDim2.fromOffset(hoverP.X + 16, hoverP.Y + 14)
    tip.Visible = true
  end

  -- 选中了还没放：鼠标指着空地时画出会放到哪（绿色可以、红色不行）；拖动时画出每个的新位置
  local function ghostStep()
    if view ~= "mine" or selN == 0 or not G.S then return end
    local o = G.S.origin
    if ptr and ptr.drag and ptr.off then
      for _, e in ipairs((dragPlan(ptr.off))) do
        local def = UNITS[e[4]:GetAttribute("Type") or ""]
        ring(o.X + e[2], o.Z + e[3], ((def and def.size) or 8) + 2, inZone(e[2], e[3]) and RGB(90, 220, 120) or RGB(230, 80, 70), 0.45)
      end
      return
    end
    if G.mobile or not hoverP or hoverIt or ptr then return end
    local g = groundCam(hoverP)
    if not g then return end
    local list, rel = groundPlan(g)
    if not list then return end
    local okZ = inZone(rel.X, rel.Z)
    local sizes = {}
    for m in pairs(sel) do
      local def = UNITS[m:GetAttribute("Type") or ""]
      sizes[m:GetAttribute("Uid") or 0] = (def and def.size) or 8
    end
    for _, e in ipairs(list) do
      ring(o.X + e[2], o.Z + e[3], (sizes[e[1]] or 8) + 2, okZ and RGB(90, 220, 120) or RGB(230, 80, 70), 0.55)
    end
  end

  ---------------------------------------------------------------- 观战：自动导播、跟随

  local function baseYaw()
    local b = G.battle
    return (b and b.team == 2) and PI or 0
  end
  -- 交火的单位（离最近的敌人不到 260）：框住它们；还没接火框住我军（我军没了框敌军）。喷气机满场飞，不算
  local function directorUpdate(snap)
    local fr, en = {}, {}
    for _, it in ipairs(battleList()) do
      if not (it.def and it.def.jet) then
        if it.friend then fr[#fr + 1] = it else en[#en + 1] = it end
      end
    end
    local ENG2 = 260 * 260
    for _, a in ipairs(fr) do
      for _, b in ipairs(en) do
        local dx, dz = a.p.X - b.p.X, a.p.Z - b.p.Z
        local d2 = dx * dx + dz * dz
        if d2 < (a.near or 1e18) then a.near = d2 end
        if d2 < (b.near or 1e18) then b.near = d2 end
      end
    end
    local pts = {}
    for _, it in ipairs(fr) do
      if (it.near or 1e18) < ENG2 then pts[#pts + 1] = it.p end
    end
    for _, it in ipairs(en) do
      if (it.near or 1e18) < ENG2 then pts[#pts + 1] = it.p end
    end
    spec.hot = #pts >= 2
    if not spec.hot then
      pts = {}
      for _, it in ipairs((#fr > 0) and fr or en) do pts[#pts + 1] = it.p end
    end
    local y = groundY()
    local foc, dist
    if #pts == 0 then
      foc, dist = orbit.origin + V(0, 1, F.center), 700
    else
      local x0, x1, z0, z1 = math.huge, -math.huge, math.huge, -math.huge
      for _, p in ipairs(pts) do
        x0, x1 = math.min(x0, p.X), math.max(x1, p.X)
        z0, z1 = math.min(z0, p.Z), math.max(z1, p.Z)
      end
      foc = V((x0 + x1) / 2, y, (z0 + z1) / 2)
      local fp = { foc + V(45, 0, 30), foc + V(-45, 0, -30), foc + V(45, 0, -30), foc + V(-45, 0, 30) }
      for _, p in ipairs(pts) do
        fp[#fp + 1] = V(p.X, y, p.Z)
        fp[#fp + 1] = V(p.X, math.max(p.Y, y) + 8, p.Z)
      end
      dist = fitDist(fp, foc, shrink(freeRect(), 0.06), 90, 1500)
    end
    spec.focus, spec.dist = foc, dist
    if snap then
      orbit.focus, orbit.dist = foc, math.clamp(dist * spec.zoomK, 60, 1600)
    end
  end
  local function specAuto(keepYaw)
    spec.mode, spec.m, spec.lost, spec.zoomK, spec.yawOff, spec.t = "auto", nil, 0, 1, 0, 99
    if not keepYaw then orbit.yaw = baseYaw() end
    orbit.pitch = math.rad(42)
    G.updateButtons()
  end
  function G.specAuto()
    if G.mode ~= "battle" then return end
    specAuto(false)
  end
  local function specFree()
    if spec.mode ~= "free" then
      spec.mode, spec.m = "free", nil
      orbit.focus = V(orbit.focus.X, groundY(), orbit.focus.Z)
      G.updateButtons()
    end
  end
  local function follow(m)
    if spec.mode ~= "follow" then spec.zoomK = 1 end
    spec.mode, spec.m, spec.lost, spec.yawOff = "follow", m, 0, 0
    orbit.pitch = math.rad(24)
    G.updateButtons()
  end
  G.followUnit = follow
  -- 换下一个跟随：我方的按兵种顺序轮着来（我方没了轮敌方）
  function G.followNext(dir)
    if G.mode ~= "battle" then return end
    local fr, en = {}, {}
    for _, it in ipairs(battleList()) do
      if it.friend then fr[#fr + 1] = it else en[#en + 1] = it end
    end
    local L = (#fr > 0) and fr or en
    if #L == 0 then
      specAuto(false)
      return
    end
    table.sort(L, function(a, b)
      local oa, ob = ORD[a.t or ""] or 99, ORD[b.t or ""] or 99
      if oa ~= ob then return oa < ob end
      return a.m.Name < b.m.Name
    end)
    local idx = 0
    for i, it in ipairs(L) do
      if it.m == spec.m then idx = i end
    end
    idx = ((idx - 1 + (dir or 1)) % #L) + 1
    follow(L[idx].m)
  end
  local function followStep(dt)
    local m = spec.m
    local e = m and G.vis and G.vis[m]
    if not e or not m.Parent or m:GetAttribute("Dead") or not e.clone.Parent then
      spec.lost = spec.lost + dt
      if spec.lost > 1.6 then G.followNext(1) end   -- 跟的那个没了：停一下再换下一个
      return
    end
    spec.lost = 0
    local def = UNITS[m:GetAttribute("Type") or ""]
    orbit.focus = e.root.Position + V(0, (m:GetAttribute("H") or 4) * 0.6, 0)
    local want = ((def and def.jet) and 190 or math.clamp(((def and def.size) or 8) * 3 + 34, 50, 150)) * spec.zoomK
    orbit.dist = orbit.dist + (want - orbit.dist) * (1 - math.exp(-dt * 2.5))
    if not rotating then   -- 追尾：慢慢转到它背后
      local lv = e.root.CFrame.LookVector
      if lv.X * lv.X + lv.Z * lv.Z > 0.05 then
        local chase = math.atan2(lv.X, lv.Z) + spec.yawOff
        orbit.yaw = orbit.yaw + wrap(chase - orbit.yaw) * (1 - math.exp(-dt * 1.4))
      end
    end
  end
  local function specStep(dt)
    if spec.mode == "follow" then
      followStep(dt)
    elseif spec.mode == "auto" then
      spec.t = spec.t + dt
      if spec.t > 0.35 or not spec.focus then
        spec.t = 0
        directorUpdate(false)
      end
      orbit.focus = orbit.focus:Lerp(spec.focus, 1 - math.exp(-dt * 1.6))
      local want = math.clamp(spec.dist * spec.zoomK, 60, 1600)
      orbit.dist = orbit.dist + (want - orbit.dist) * (1 - math.exp(-dt * 1.3))
    end
  end
  local function camLabel()
    local L = ui.camL
    if not L then return end
    local line
    if spec.mode == "follow" and spec.m then
      local m = spec.m
      local def = UNITS[m:GetAttribute("Type") or ""]
      local friend = (m.Parent == myF("Units")) or m:GetAttribute("Owner") == player.UserId
      local hp = hpOf(m)
      line = "跟随：" .. (friend and "<font color=\"#7CFC8A\">我方</font> " or "<font color=\"#FF8A80\">敌方</font> ") .. (def and def.name or "单位") ..
        (hp and string.format("  · 血量 %d%%", math.floor(hp * 100 + 0.5)) or "")
    elseif spec.mode == "auto" then
      line = spec.hot and "自动镜头 · 跟着交火的地方" or "自动镜头 · 看我军推进"
    else
      line = "自由镜头"
    end
    local tipLine = G.mobile and "点单位跟随 · 单指拖动平移 · 双指缩放、旋转" or "点单位跟随 · Tab 下一个 · 空格 自动镜头 · 拖动平移 · 右键转 · 滚轮缩放"
    L.Text = line .. "\n<font size=\"" .. (G.compact and 12 or 13) .. "\" color=\"#B8C2CC\">" .. tipLine .. "</font>"
  end

  ---------------------------------------------------------------- 布阵镜头

  local function deployFit()
    local Z = (view == "enemy") and F.enemy or F.deploy
    local o = orbit.origin
    orbit.focus = o + V(0, 1, (Z[1] + Z[2]) / 2)
    local hw, y = F.width / 2 + 4, groundY()
    local z0, z1 = o.Z + Z[1] - 6, o.Z + Z[2] + 6
    local pts = { V(o.X - hw, y, z0), V(o.X + hw, y, z0), V(o.X - hw, y, z1), V(o.X + hw, y, z1), V(o.X - hw, y + 10, z1), V(o.X + hw, y + 10, z1) }
    orbit.dist = fitDist(pts, orbit.focus, shrink(freeRect(), 0.02), 120, 2200)
  end
  local function enterDeploy()
    local S = G.S
    orbit.origin = S and S.origin or V(0, 0, 0)
    orbit.yaw, orbit.pitch = 0, math.rad(58)
    view = "mine"
    G.deployView = view
    fit = true
    deployFit()
    if G.compact and not G.deployTipShown then
      G.deployTipShown = true
      G.toast("点部队选中、点空地放下 · 按住部队拖动 · 单指拖地图、双指缩放 · 下面一排点一下选一类", "info")
    end
  end
  function G.toggleDeployView()
    if G.mode ~= "deploy" then return end
    view = (view == "mine") and "enemy" or "mine"
    G.deployView = view
    fit = true
    orbit.yaw, orbit.pitch = 0, math.rad(58)
    selClear()
    deployFit()
  end
  local function enterBattle()
    local b = G.battle
    orbit.origin = (b and b.origin) or (G.S and G.S.origin) or V(0, 0, 0)
    specAuto(false)
    spec.focus = nil
    directorUpdate(true)   -- 第一帧就摆好，接着自动导播接手
  end

  local function clampFocus()
    local o = orbit.origin
    local f = orbit.focus
    if G.mode == "deploy" then
      orbit.focus = V(math.clamp(f.X, o.X - 420, o.X + 420), f.Y, math.clamp(f.Z, o.Z - 160, o.Z + ZMAX + 120))
    else
      orbit.focus = V(math.clamp(f.X, o.X - F.width / 2 - 200, o.X + F.width / 2 + 200), f.Y, math.clamp(f.Z, o.Z + ZMIN - 200, o.Z + ZMAX + 200))
    end
  end
  local function camStep(dt)
    if not UIS:GetFocusedTextBox() then   -- 键盘：WASD 平移、Q / E 转
      local fwd = V(math.sin(orbit.yaw), 0, math.cos(orbit.yaw))
      local right = V(-math.cos(orbit.yaw), 0, math.sin(orbit.yaw))
      local mv = V(0, 0, 0)
      if UIS:IsKeyDown(Enum.KeyCode.W) or UIS:IsKeyDown(Enum.KeyCode.Up) then mv = mv + fwd end
      if UIS:IsKeyDown(Enum.KeyCode.S) or UIS:IsKeyDown(Enum.KeyCode.Down) then mv = mv - fwd end
      if UIS:IsKeyDown(Enum.KeyCode.D) or UIS:IsKeyDown(Enum.KeyCode.Right) then mv = mv + right end
      if UIS:IsKeyDown(Enum.KeyCode.A) or UIS:IsKeyDown(Enum.KeyCode.Left) then mv = mv - right end
      local turn = 0
      if UIS:IsKeyDown(Enum.KeyCode.Q) then turn = turn + 1 end
      if UIS:IsKeyDown(Enum.KeyCode.E) then turn = turn - 1 end
      if turn ~= 0 then
        if G.mode == "battle" and spec.mode == "follow" then spec.yawOff = spec.yawOff + turn * dt * 1.5 else orbit.yaw = orbit.yaw + turn * dt * 1.5 end
        fit = false
      end
      if mv.Magnitude > 0 then
        if G.mode == "battle" then specFree() end
        fit = false
        orbit.focus = orbit.focus + mv.Unit * dt * 300 * (orbit.dist / 600)
      end
    end
    if G.mode == "deploy" then
      if fit then deployFit() end
    else
      specStep(dt)
    end
    clampFocus()
    local R = rig(orbit.focus, orbit.dist, freeRect())
    local want = CFrame.lookAt(R.eye, R.eye + R.look)
    local k = 8
    if ptr and ptr.pan then
      k = 24
    elseif G.mode == "battle" and spec.mode == "follow" then
      k = 12
    end
    camCF = camCF and camCF:Lerp(want, 1 - math.exp(-dt * k)) or want
    cam.CFrame = camCF
  end

  ---------------------------------------------------------------- 模式

  function G.setMode(m)
    G.mode = m
    local controls = getControls()
    if m == "free" then
      cam.CameraType = Enum.CameraType.Custom
      local hum = player.Character and player.Character:FindFirstChildOfClass("Humanoid")
      if hum then cam.CameraSubject = hum end
      if controls then controls:Enable() end
      UIS.MouseBehavior = Enum.MouseBehavior.Default
      rotating = false
    else
      camCF = cam.CFrame
      cam.CameraType = Enum.CameraType.Scriptable
      if controls then
        if m == "drive" then controls:Enable() else controls:Disable() end
      end
      if m == "deploy" then
        enterDeploy()
      elseif m == "battle" then
        enterBattle()
      end
    end
    PPS.Enabled = (m == "free")   -- 布阵、观战、开车时别误触建筑旁的 E 提示
    ptr = nil
    box.Visible = false
    tip.Visible = false
    tagStep(m == "deploy")
    chipsStep(m == "deploy")
    selClear()
  end

  function G.toggleDeploy()
    if G.mode == "deploy" then
      G.setMode("free")
    elseif G.S then
      if G.S.n == 0 then G.toast("还没有部队：先盖兵营，再在右边「兵工厂」生产", "info") end
      G.setMode("deploy")
    end
  end
  function G.toggleOverview()
    if not G.battle then return end
    if G.mode == "battle" then G.setMode("free") else G.setMode("battle") end
  end

  ---------------------------------------------------------------- 输入（Play 的输入处理在合适的地方调进来）

  function G.ctlRotate(on)
    rotating = on and true or false
  end
  function G.ctlDown(input)
    local touch = input.UserInputType == Enum.UserInputType.Touch
    if touch then
      touchN = touchN + 1
      if touchN >= 2 then   -- 第二根手指：双指缩放 / 旋转，别再拖了
        ptr = nil
        box.Visible = false
        return
      end
    end
    local sp = vpOf(input)
    local now = os.clock()
    if G.mode == "deploy" then
      if not G.S or G.S.battle then return end
      local it, g = pickAt(sp, (view == "mine") and mineList() or {})
      if it then
        local m = it.m
        local shift = shiftDown()
        if lastClick.m == m and now - lastClick.t < 0.4 then   -- 双击：选上同兵种的全部
          lastClick.m = nil
          selectType(it.t, shift)
          ptr = { input = input, sp = sp, kind = "unit", m = m, g0 = g, keep = true, touch = touch }
          return
        end
        lastClick.m, lastClick.t = m, now
        local was = sel[m] == true
        if shift then
          if was then sel[m] = nil else sel[m] = true end
          selChanged()
        elseif not was then
          for k in pairs(sel) do sel[k] = nil end
          sel[m] = true
          selChanged()
        end
        ptr = { input = input, sp = sp, kind = "unit", m = m, g0 = g, was = was, shift = shift, touch = touch }
      else
        lastClick.m = nil
        ptr = { input = input, sp = sp, kind = touch and "pan" or "box", g0 = g, f0 = orbit.focus, touch = touch, shift = shiftDown() }
      end
    elseif G.mode == "battle" then
      if G.aim then
        ptr = { input = input, sp = sp, kind = "aim", touch = touch }
        return
      end
      local it = pickAt(sp, battleList())
      if it then
        follow(it.m)
        ptr = nil
        return
      end
      ptr = { input = input, sp = sp, kind = "pan", f0 = orbit.focus, touch = touch }
    end
  end
  local function pointerMove(sp)
    local p = ptr
    if not p.moved then
      if (sp - p.sp).Magnitude < (p.touch and 12 or 6) then return end
      p.moved = true
      if p.kind == "pan" then
        if G.mode == "battle" then specFree() end
        fit = false
        p.f0 = orbit.focus
        p.g0 = groundRig(p.sp, p.f0)
      end
    end
    p.cur = sp
    if p.kind == "unit" then
      local g = groundCam(sp)
      if g and p.g0 then p.off = V(g.X - p.g0.X, 0, g.Z - p.g0.Z) end
      p.drag = true
    elseif p.kind == "box" then
      p.box = true
      local x0, x1 = math.min(p.sp.X, sp.X), math.max(p.sp.X, sp.X)
      local y0, y1 = math.min(p.sp.Y, sp.Y), math.max(p.sp.Y, sp.Y)
      box.Position = UDim2.fromOffset(x0, y0)
      box.Size = UDim2.fromOffset(x1 - x0, y1 - y0)
      box.Visible = true
    elseif p.kind == "pan" then
      p.pan = true
      local g = groundRig(sp, p.f0)
      if g and p.g0 then orbit.focus = p.f0 + V(p.g0.X - g.X, 0, p.g0.Z - g.Z) end
    end
  end
  function G.ctlMove(input)
    local ut = input.UserInputType
    local mouse = ut == Enum.UserInputType.MouseMovement
    if mouse then
      if input.Position then hoverP = vpOf(input) end
      if rotating then
        local d = input.Delta
        if d then
          if G.mode == "battle" and spec.mode == "follow" then spec.yawOff = spec.yawOff - d.X * 0.008 else orbit.yaw = orbit.yaw - d.X * 0.008 end
          orbit.pitch = math.clamp(orbit.pitch + d.Y * 0.006, 0.2, 1.45)
          fit = false
        end
        return
      end
    elseif ut ~= Enum.UserInputType.Touch then
      return
    end
    if not ptr then return end
    if ptr.touch ~= (not mouse) then return end
    if ptr.touch and ptr.input ~= input then return end
    pointerMove(mouse and (hoverP or ptr.sp) or vpOf(input))
  end
  function G.ctlUp(input)
    local touch = input.UserInputType == Enum.UserInputType.Touch
    if touch then touchN = math.max(0, touchN - 1) end
    local p = ptr
    if not p or p.touch ~= touch or (touch and p.input ~= input) then return end
    ptr = nil
    box.Visible = false
    local sp = input.Position and vpOf(input) or p.cur or p.sp
    if G.mode == "deploy" then
      if not G.S or G.S.battle then return end
      if p.kind == "unit" then
        if p.drag and p.off then
          if dropSel(p.off) then selClear() end
        elseif not p.shift and not p.keep and p.was then
          if selN > 1 then   -- 点一下一群里的一个：只留它
            for k in pairs(sel) do sel[k] = nil end
            sel[p.m] = true
            selChanged()
          else               -- 再点一下自己：取消
            selClear()
          end
        end
      elseif p.box then
        boxSelect(p.sp, sp, p.shift)
      elseif not p.moved then
        groundClick(p.g0)
      end
    elseif G.mode == "battle" then
      if p.kind == "aim" and not p.moved and G.aim and G.castAt then G.castAt(sp.X, sp.Y, true) end
    end
  end
  function G.ctlWheel(input)
    local z = input.Position.Z
    if z == 0 then return end
    local f = math.clamp(1 - 0.12 * z, 0.5, 1.6)
    if G.mode == "battle" and spec.mode ~= "free" then
      spec.zoomK = math.clamp(spec.zoomK * f, 0.3, 3)
      return
    end
    fit = false
    local nd = math.clamp(orbit.dist * f, 50, 1800)
    local k = nd / orbit.dist
    local g = hoverP and groundRig(hoverP)
    if g then   -- 朝鼠标指着的地方缩放
      local fo = orbit.focus
      orbit.focus = V(g.X + (fo.X - g.X) * k, fo.Y, g.Z + (fo.Z - g.Z) * k)
    end
    orbit.dist = nd
  end
  function G.ctlPinch(scale, state)
    if state == Enum.UserInputState.Begin then
      pinch0 = { d = orbit.dist, k = spec.zoomK }
      ptr = nil
      box.Visible = false
    elseif pinch0 and scale > 0 then
      if G.mode == "battle" and spec.mode ~= "free" then
        spec.zoomK = math.clamp(pinch0.k / scale, 0.3, 3)
      else
        fit = false
        orbit.dist = math.clamp(pinch0.d / scale, 50, 1800)
      end
      if state == Enum.UserInputState.End then pinch0 = nil end
    end
  end
  function G.ctlTurn(rot, state)   -- 双指旋转（rot 是度数）
    local followTurn = G.mode == "battle" and spec.mode == "follow"
    if state == Enum.UserInputState.Begin then
      turn0 = followTurn and spec.yawOff or orbit.yaw
    elseif turn0 then
      local y = turn0 - math.rad(rot)
      if followTurn then spec.yawOff = y else orbit.yaw = y end
      fit = false
      if state == Enum.UserInputState.End then turn0 = nil end
    end
  end
  function G.ctlKey(kc)
    if G.mode == "battle" then
      if kc == Enum.KeyCode.Tab then
        G.followNext(shiftDown() and -1 or 1)
        return true
      elseif kc == Enum.KeyCode.Space then
        specAuto(false)
        return true
      end
    elseif G.mode == "deploy" and kc == Enum.KeyCode.Space then   -- 镜头复位（重新框住整个区）
      fit = true
      orbit.yaw, orbit.pitch = 0, math.rad(58)
      return true
    end
    return false
  end

  ---------------------------------------------------------------- 每帧

  local slowT = 0
  function G.ctlStep(dt)
    local active = (G.mode == "deploy" or G.mode == "battle") and not G.drive
    if active then camStep(dt) end
    if active and G.mode == "deploy" then
      for m in pairs(sel) do
        local e = G.vis and G.vis[m]
        if e and m.Parent then
          local def = UNITS[m:GetAttribute("Type") or ""]
          local p = e.root.Position
          ring(p.X, p.Z, ((def and def.size) or 8) + 3, RGB(255, 214, 80), 0.5)
        end
      end
      ghostStep()
    end
    ringsDone()
    hoverStep(dt, active)
    slowT = slowT + dt
    if slowT > 0.25 then
      slowT = 0
      local dep = active and G.mode == "deploy" and view == "mine"
      tagStep(dep)
      chipsStep(dep)
      if active and G.mode == "battle" then camLabel() end
    end
  end
end

function Play.init(G)
  local Config = G.Config
  local UNITS = Config.Units
  local F = Config.Field
  local V = Vector3.new
  local RGB = Color3.fromRGB
  local player = Players.LocalPlayer
  local cam = workspace.CurrentCamera
  local ui = G.ui
  local RA, RShoot, RDrive = G.R.Action, G.R.Shoot, G.R.Drive
  local mouse = player:GetMouse()
  local XMAX = F.width / 2 - 6
  local ZMIN, ZMAX = F.center - F.length / 2 + 5, F.center + F.length / 2 - 5
  local JX, JZ0, JZ1 = F.width / 2 + 160, ZMIN - 200, ZMAX + 200   -- 喷气机能飞的范围（和服务器 Battle 一样）
  G.mode = "free"

  local controls = nil
  task.spawn(function()
    local ok, res = pcall(function()
      local pm = require(player:WaitForChild("PlayerScripts"):WaitForChild("PlayerModule", 15))
      return pm:GetControls()
    end)
    if ok then controls = res end
  end)

  ctlInit(G, function() return controls end)

  function G.sellSelected()
    if G.sel then
      RA:FireServer("sell", G.sel.uid)
      G.ctlClear()
    end
  end

  ---------------------------------------------------------------- 瞄准点

  local aimParams = RaycastParams.new()
  aimParams.FilterType = Enum.RaycastFilterType.Exclude
  -- 电脑：鼠标指着的地方；手机（或开车时的手机）：屏幕中间的准星
  local function aimPoint(skip)
    local ex = { G.fxFolder }
    if player.Character then table.insert(ex, player.Character) end
    if skip then table.insert(ex, skip) end
    aimParams.FilterDescendantsInstances = ex
    local ray
    if G.mobile then
      local vs = cam.ViewportSize
      ray = cam:ViewportPointToRay(vs.X / 2, vs.Y / 2)
    else
      local mp = UIS:GetMouseLocation()
      ray = cam:ViewportPointToRay(mp.X, mp.Y)
    end
    local res = workspace:Raycast(ray.Origin, ray.Direction * 3000, aimParams)
    if res then return res.Position end
    return ray.Origin + ray.Direction * 3000
  end

  ---------------------------------------------------------------- 开车

  local driveCF = nil
  local driveRot = false   -- 开车时按住右键转镜头
  local function moveVector()
    if controls then
      local ok, mv = pcall(function() return controls:GetMoveVector() end)
      if ok and typeof(mv) == "Vector3" then return mv end
    end
    local x, z = 0, 0
    if UIS:IsKeyDown(Enum.KeyCode.W) or UIS:IsKeyDown(Enum.KeyCode.Up) then z = z - 1 end
    if UIS:IsKeyDown(Enum.KeyCode.S) or UIS:IsKeyDown(Enum.KeyCode.Down) then z = z + 1 end
    if UIS:IsKeyDown(Enum.KeyCode.D) or UIS:IsKeyDown(Enum.KeyCode.Right) then x = x + 1 end
    if UIS:IsKeyDown(Enum.KeyCode.A) or UIS:IsKeyDown(Enum.KeyCode.Left) then x = x - 1 end
    return V(x, 0, z)
  end

  local preDrive = "free"
  local function startDrive(ev)
    local m = nil
    for sm in pairs(G.vis or {}) do
      if sm.Parent and sm:GetAttribute("BU") == ev.bid then m = sm end
    end
    if not m then   -- 本地还没这辆车的模型：别让服务器以为在开（角色会一直藏着），直接下车
      RA:FireServer("exit")
      G.toast("这辆车还没加载出来，过一秒再试", "info")
      return
    end
    local root = m:FindFirstChild("Root")
    local o = ev.origin or (G.battle and G.battle.origin) or V(0, 0, 0)
    local p = root.CFrame.Position - o
    local lv = root.CFrame.LookVector
    local h = math.atan2(-lv.X, -lv.Z)
    local def = UNITS[ev.t]
    G.drive = { bid = ev.bid, t = ev.t, origin = o, x = p.X, z = p.Z, y = def.air and math.max(def.alt, p.Y - 1) or 0, h = h, ty = 0, spd = def.speed, roll = 0,
      camYaw = h, camPitch = math.rad(def.air and 20 or 16), sendT = 0, nextFire = os.clock() + (ev.cd or 0), firing = false, model = m, clone = G.cloneOf(m) }
    G.drive.cf = root.CFrame
    if G.mode ~= "drive" then preDrive = G.mode end
    driveCF = cam.CFrame
    G.setMode("drive")
    ui.cross.Visible = true
    ui.fireBtn.Visible = G.mobile
    ui.upBtn.Visible = G.mobile and def.air == true
    ui.downBtn.Visible = G.mobile and def.air == true
    local tip
    if def.jet then
      tip = G.mobile and "摇杆左右转弯、上下加减速，按住「升高」「降低」调高度，转镜头瞄准，按「开火」" or "W / S 加减速，A / D 转弯，空格升高、C 降低，鼠标瞄准、按住左键开火"
      if def.bombs then tip = tip .. "；轰炸机按一下扔一串炸弹（落在飞机前方）" end
    else
      tip = (G.mobile and "摇杆开车，转镜头瞄准，按「开火」" or "WASD 开车，鼠标瞄准，按住左键开火，右键拖动转镜头") ..
        (def.air and (G.mobile and "，按住「升高」「降低」调高度" or "，空格升高、C 降低") or "")
      if def.cargo then tip = tip .. (G.mobile and "；降到最低（按住「降低」）自动放下步兵" or "；降到最低（按住 C）自动放下步兵") end
    end
    G.toast(tip .. (G.mobile and "；下车点「下车」" or "；下车按 F"), "info")
  end

  local function stopDrive()
    G.drive = nil
    ui.cross.Visible = false
    ui.fireBtn.Visible = false
    ui.upBtn.Visible = false
    ui.downBtn.Visible = false
    driveRot = false
    if G.mode == "drive" then G.setMode((preDrive == "battle" and G.battle) and "battle" or "free") end   -- 原来在观战的，下车回观战
  end

  local function driveStep(dt)
    local dr = G.drive
    if not dr then return end
    local def = UNITS[dr.t]
    local mv = moveVector()
    if not driveRot then dr.camYaw = dr.camYaw + wrap(dr.h - dr.camYaw) * math.min(1, dt * ((def.air and not def.jet) and 0 or 1.5)) end
    if def.jet then   -- 喷气机：一直往前飞，W / S 加减速，A / D 转弯（压坡度），空格 / C 升降
      dr.spd = math.clamp(dr.spd + (-mv.Z) * def.speed * 0.8 * dt, def.speed * 0.6, def.speed * 1.15)
      dr.h = dr.h - mv.X * def.turn * 1.2 * dt
      dr.roll = dr.roll + (-mv.X * 0.8 - dr.roll) * math.min(1, dt * 4)
      dr.x = dr.x - math.sin(dr.h) * dr.spd * dt
      dr.z = dr.z - math.cos(dr.h) * dr.spd * dt
      if UIS:IsKeyDown(Enum.KeyCode.Space) or dr.climb == 1 then dr.y = math.min(220, dr.y + 40 * dt) end
      if UIS:IsKeyDown(Enum.KeyCode.C) or UIS:IsKeyDown(Enum.KeyCode.LeftControl) or dr.climb == -1 then dr.y = math.max(40, dr.y - 40 * dt) end
    elseif def.air then
      local yaw = dr.camYaw
      local fwd, right = V(-math.sin(yaw), 0, -math.cos(yaw)), V(math.cos(yaw), 0, -math.sin(yaw))
      local move = right * mv.X + fwd * (-mv.Z)
      if move.Magnitude > 1 then move = move.Unit end
      dr.x = dr.x + move.X * def.speed * dt
      dr.z = dr.z + move.Z * def.speed * dt
      if UIS:IsKeyDown(Enum.KeyCode.Space) or dr.climb == 1 then dr.y = math.min(150, dr.y + 30 * dt) end
      if UIS:IsKeyDown(Enum.KeyCode.C) or UIS:IsKeyDown(Enum.KeyCode.LeftControl) or dr.climb == -1 then dr.y = math.max(def.cargo and 6 or 15, dr.y - 30 * dt) end
      dr.h = dr.h + wrap(yaw - dr.h) * math.min(1, dt * 3)
    else
      local throttle = -mv.Z
      dr.h = dr.h - mv.X * 1.4 * dt
      local sp = def.speed * 1.1 * throttle
      dr.x = dr.x - math.sin(dr.h) * sp * dt
      dr.z = dr.z - math.cos(dr.h) * sp * dt
    end
    if def.jet then
      dr.x = math.clamp(dr.x, -JX, JX)
      dr.z = math.clamp(dr.z, JZ0, JZ1)
    else
      dr.x = math.clamp(dr.x, -XMAX, XMAX)
      dr.z = math.clamp(dr.z, ZMIN, ZMAX)
    end
    local aim = aimPoint(dr.clone)
    dr.aim = aim
    local rel = aim - dr.origin
    if def.turret then dr.ty = wrap(math.atan2(-(rel.X - dr.x), -(rel.Z - dr.z)) - dr.h) end
    dr.cf = CFrame.new(dr.origin + V(dr.x, 1 + dr.y, dr.z)) * CFrame.Angles(0, dr.h, 0) * CFrame.Angles(0, 0, dr.roll)
    dr.sendT = dr.sendT + dt
    local fire = nil
    local now = os.clock()
    if dr.firing and now >= dr.nextFire then
      fire = aim
      dr.nextFire = now + (def.bombs and def.rate * 0.5 or def.rate)
    end
    if dr.sendT >= 0.05 or fire then
      dr.sendT = 0
      RDrive:FireServer({ x = dr.x, z = dr.z, h = dr.h, y = dr.y, ty = dr.ty, fire = fire })
    end
    -- 追尾镜头
    local pos = dr.cf.Position
    local back, up = def.size * 1.5 + 22, def.size * 0.6 + 9
    local yaw, pitch = dr.camYaw, dr.camPitch
    local look = V(-math.sin(yaw) * math.cos(pitch), -math.sin(pitch), -math.cos(yaw) * math.cos(pitch))
    local want = CFrame.lookAt(pos - look * back + V(0, up, 0), pos + look * 30 + V(0, up * 0.4, 0))
    driveCF = driveCF and driveCF:Lerp(want, 1 - math.exp(-dt * 10)) or want
    cam.CFrame = driveCF
  end

  ---------------------------------------------------------------- 拿枪

  local gun = { id = nil, tool = nil, nextShot = 0, firing = false }
  local ammo = {}
  local function ammoOf(id)
    local w = Config.Weapons[id]
    local a = ammo[id]
    if not a then
      a = { n = w.mag, r = 0 }
      ammo[id] = a
    end
    if a.r > 0 and os.clock() >= a.r then
      a.n = w.mag
      a.r = 0
    end
    return a
  end
  local shotParams = RaycastParams.new()
  shotParams.FilterType = Enum.RaycastFilterType.Exclude
  local function tryFire()
    local id, tool = gun.id, gun.tool
    local char = player.Character
    if not id or not tool or not char or G.drive then return end
    local w = Config.Weapons[id]
    local a = ammoOf(id)
    local now = os.clock()
    if a.r > 0 or now < gun.nextShot then return end
    if a.n <= 0 then
      a.r = now + w.reload
      return
    end
    local head = char:FindFirstChild("Head")
    local handle = tool:FindFirstChild("Handle")
    if not head or not handle then return end
    gun.nextShot = now + w.rate
    a.n = a.n - 1
    if a.n <= 0 then a.r = now + w.reload end
    local aim = aimPoint()
    if G.mobile and mouse.Hit then aim = mouse.Hit.Position end
    local dir = aim - head.Position
    if dir.Magnitude < 0.5 then return end
    shotParams.FilterDescendantsInstances = { char, G.fxFolder }
    local res = workspace:Raycast(head.Position, dir.Unit * w.range, shotParams)
    local endP = res and res.Position or (head.Position + dir.Unit * w.range)
    local mz = handle:FindFirstChild("Muzzle")
    local muzzle = mz and mz.WorldPosition or head.Position
    G.gunFx(id, muzzle, endP, w.proj and ((endP - muzzle).Magnitude / w.speed) or nil)
    RShoot:FireServer(id, aim)
  end
  local function reload()
    local id = gun.id
    if not id then return end
    local w = Config.Weapons[id]
    local a = ammoOf(id)
    if a.r > 0 or a.n >= w.mag then return end
    a.r = os.clock() + w.reload
    RA:FireServer("reload", id)
  end
  local function onChar(char)
    task.spawn(function()
      local hum = char:WaitForChild("Humanoid", 10)
      if not hum then return end
      local last, lastT = hum.Health, 0
      hum.HealthChanged:Connect(function(h)
        if h < last - 4 and G.battle and os.clock() - lastT > 0.35 then
          lastT = os.clock()
          G.playSound("hurt")
        end
        last = h
      end)
    end)
    char.ChildAdded:Connect(function(c)
      if c:IsA("Tool") and c:GetAttribute("Weapon") then
        gun.id, gun.tool = c:GetAttribute("Weapon"), c
        c.Activated:Connect(function()
          if G.mobile then tryFire() end
        end)
        if G.mode == "battle" then G.setMode("free") end   -- 观战时拿起枪：切回自己的小人
      end
    end)
    char.ChildRemoved:Connect(function(c)
      if c == gun.tool then
        gun.id, gun.tool, gun.firing = nil, nil, false
      end
    end)
  end
  player.CharacterAdded:Connect(onChar)
  if player.Character then onChar(player.Character) end

  local function ammoHud()
    local dr = G.drive
    if dr then   -- 开车：显示还要装填几秒
      local def = UNITS[dr.t]
      local left = dr.nextFire - os.clock()
      ui.ammo.Visible = true
      ui.reloadBar.Visible = false
      ui.ammo.Text = def.name .. ((left > 0.05) and string.format("  装填 %.1f 秒", left) or "  可以开火")
      return
    end
    if not gun.id then
      ui.ammo.Visible = false
      ui.reloadBar.Visible = false
      return
    end
    local w = Config.Weapons[gun.id]
    local a = ammoOf(gun.id)
    ui.ammo.Visible = true
    if a.r > 0 then
      ui.ammo.Text = w.name .. "  换弹中…"
      ui.reloadBar.Visible = true
      ui.reloadBar.Size = UDim2.fromOffset(260 * math.clamp(1 - (a.r - os.clock()) / w.reload, 0, 1), 4)
    else
      ui.ammo.Text = w.name .. "  " .. a.n .. " / " .. w.mag .. (G.mobile and "" or "   R 换弹")
      ui.reloadBar.Visible = false
    end
  end

  ---------------------------------------------------------------- 支援技能

  G.aim = nil
  local aimRing, aimStrip = nil, nil
  local aimTipShown = false
  -- 屏幕上一点对应的战场地面（战场顶面 y = 原点 + 1 的平面）
  local function groundPoint(x, y, viewport)
    local B = G.battle
    if not B or not B.origin then return nil end
    local ray = viewport and cam:ViewportPointToRay(x, y) or cam:ScreenPointToRay(x, y)
    if math.abs(ray.Direction.Y) < 1e-4 then return nil end
    local t = (B.origin.Y + 1 - ray.Origin.Y) / ray.Direction.Y
    if t <= 0 or t > 6000 then return nil end
    return ray.Origin + ray.Direction * t
  end
  function G.toggleAim(id)
    if G.aim == id then
      G.aim = nil
      return
    end
    local sk = Config.SkillById[id]
    if not sk or not G.battle or not (G.skillHave and G.skillHave[id]) then return end
    local left = (G.skillReady[id] or 0) - os.clock()
    if left > 0 then
      G.toast("「" .. sk.name .. "」还要冷却 " .. math.ceil(left) .. " 秒", "info")
      return
    end
    G.aim = id
    if not aimTipShown then
      aimTipShown = true
      G.toast(G.mobile and "点战场上的位置放下「" .. sk.name .. "」（再点一次技能键取消）" or "左键点战场放下「" .. sk.name .. "」，右键或 Esc 取消（观战镜头更好瞄）", "info")
    end
  end
  local function castAt(x, y, viewport)
    local id = G.aim
    if not id then return false end
    local p = groundPoint(x, y, viewport)
    if not p then return true end
    local rel = p - G.battle.origin
    RA:FireServer("skill", id, rel.X, rel.Z)
    G.skillReady[id] = os.clock() + Config.SkillById[id].cd   -- 先在本地进入冷却，服务器放了会再确认
    G.aim = nil
    return true
  end
  G.castAt = castAt
  local function aimUpdate()
    local sk = G.aim and Config.SkillById[G.aim]
    if sk and not G.battle then G.aim, sk = nil, nil end
    if not aimRing then
      aimRing = G.fxPart(Enum.PartType.Cylinder, V(0.3, 10, 10), CFrame.new(), RGB(255, 200, 70), Enum.Material.Neon, 1)
      aimStrip = G.fxPart(nil, V(20, 0.3, 100), CFrame.new(), RGB(255, 120, 60), Enum.Material.Neon, 1)
    end
    aimRing.Transparency, aimStrip.Transparency = 1, 1
    if not sk then return end
    local mp = G.mobile and (cam.ViewportSize / 2) or UIS:GetMouseLocation()
    local p = groundPoint(mp.X, mp.Y, true)
    if not p then return end
    if sk.kind == "strike" then
      local dir = (G.battle.team == 2) and -1 or 1
      aimStrip.Size = V(22, 0.3, sk.len)
      aimStrip.CFrame = CFrame.new(p.X, p.Y + 0.4, p.Z) * CFrame.Angles(0, (dir < 0) and math.pi or 0, 0)
      aimStrip.Transparency = 0.5
    else
      local r = sk.r or 14
      aimRing.Size = V(0.3, r * 2, r * 2)
      aimRing.Color = (sk.kind == "heal") and RGB(90, 255, 140) or ((sk.kind == "drop") and RGB(120, 190, 255) or RGB(255, 200, 70))
      aimRing.CFrame = CFrame.new(p.X, p.Y + 0.4, p.Z) * CFrame.Angles(0, 0, math.pi / 2)
      aimRing.Transparency = 0.5
    end
  end
  local KEYSK = {}
  for _, sk in ipairs(Config.Skills) do KEYSK[Enum.KeyCode[sk.key]] = sk.id end

  ---------------------------------------------------------------- 战斗事件

  -- 连杀：4 秒内接着亲手击毁算连杀
  local streak, lastKill = 0, 0
  local STREAK = { [2] = "双杀！", [3] = "三杀！", [4] = "四杀！", [5] = "五杀！" }
  local function onKill(ev)
    local now = os.clock()
    streak = (now - lastKill < 4) and (streak + 1) or 1
    lastKill = now
    if streak >= 2 then G.announce(STREAK[streak] or "超神！", RGB(255, 120, 70), nil, 1.2) end
    local def = UNITS[ev.t]
    G.feedLine("你击毁了 <font color=\"#FF8A80\">敌方" .. (def and def.name or (ev.hero and "玩家" or "单位")) .. "</font>", RGB(255, 226, 120))
  end

  G.battle = nil
  local function counterTip(enemy)
    if not enemy then return "多造一些兵再来" end
    local function n(...)
      local s = 0
      for _, t in ipairs({ ... }) do s = s + (enemy[t] or 0) end
      return s
    end
    if n("stealth") > 0 then return "敌方有隐身轰炸机：只有爱国者和战斗机打得到它" end
    if n("drone", "fighter", "bomber") > 0 then return "敌方有高空的飞机（无人机 / 战斗机 / 轰炸机）：带弹炮防空车、爱国者、单兵防空组，或者自己的战斗机" end
    if n("loiter") > 0 then return "敌方有巡飞弹：一头撞上来专炸坦克，带防空车、步战车早点把它打下来" end
    if n("ew") > 0 then return "敌方有电子战车：导弹容易被干扰偏掉，多用坦克炮、火炮，或者先端掉它" end
    if n("heavytank") > 0 then return "敌方有重型坦克：反坦克导弹组、武装直升机、攻击机、巡飞弹专克它" end
    if n("heli", "transport", "attacker") > 0 then return "敌方有直升机 / 攻击机：带上防空车、步战车、单兵防空组，或者多带步兵" end
    if n("tank", "boss", "td", "breacher") >= 2 then return "敌方装甲多：武装直升机、反坦克导弹组、突击炮、攻击机专克装甲，火箭筒也行" end
    if n("cram") > 0 then return "敌方有拦截炮：炮弹、火箭弹会被打下来，用坦克、攻击机去端掉它" end
    if n("arty", "mlrs", "howitzer", "heavyarty", "mortar") > 0 then return "敌方有炮兵：别把步兵挤成一团；拦截炮能挡炮弹，开快车冲上去端掉它" end
    if n("sniper") > 0 then return "敌方有狙击手：用迫击炮、火炮、机枪车压制，你本人也小心" end
    return "多造一些兵再来，或者升级军工科技"
  end

  function G.onBattle(ev)
    if type(ev) ~= "table" then return end
    if ev.phase == "start" then
      ui.result.Visible = false
      ui.closeModals()
      G.battle = { origin = ev.origin, team = ev.team or 1, mode = ev.mode, title = ev.title or "", t0 = os.clock(), len = ev.time or Config.BattleTime,
        enemy = G.S and G.S.enemy }
      ui.bInfo.Text = ""
      G.skillReady = {}
      G.aim = nil
      streak = 0
      G.setMode("battle")   -- 开战默认观战镜头（自动跟着交火的地方）
      if ev.boss then
        G.announce("首领来袭！", RGB(255, 90, 70), "第 " .. tostring(ev.level) .. " 关 · 猛犸重坦——血极厚，集中火力、用支援技能", 2.6)
        G.jingle("alarm")
        G.shake(0.5)
      else
        G.announce("开战！", RGB(255, 214, 90), ev.title, 1.4)
      end
      G.toast(G.mobile and "观战镜头自动跟着交火的地方，点单位跟随它；想亲自上阵点「操控小人」或拿起枪"
        or "观战镜头自动跟着交火的地方：点单位跟随，Tab 换下一个，空格回自动；想亲自上阵点「操控小人」或按 1 拿枪", "info")
    elseif ev.phase == "tick" then
      if G.battle then G.battle.t0 = os.clock() - (ev.t or 0) end
      ui.bInfo.Text = "<font color=\"#7CFC8A\">我方 " .. tostring(ev.a) .. "</font>      <font color=\"#FF8A80\">敌方 " .. tostring(ev.e) .. "</font>"
      for _, f in ipairs(ev.feed or {}) do
        local def = UNITS[f.t]
        local nm = def and def.name or "单位"
        if f.en and not f.me then
          G.feedLine("击毁 <font color=\"#FF8A80\">敌方" .. nm .. "</font>", RGB(220, 230, 240))
          if f.t == "boss" then G.announce("首领被击毁！", RGB(255, 214, 90), nil, 1.8) end
        elseif not f.en and f.mine then
          G.feedLine("<font color=\"#FF8A80\">我方" .. nm .. " 被击毁</font>", RGB(255, 140, 130))
        end
      end
    elseif ev.phase == "hit" then
      if typeof(ev.p) == "Vector3" then
        G.popText(ev.p, (ev.k and "击毁 " or "") .. "-" .. tostring(ev.d), ev.k and RGB(255, 200, 60) or RGB(255, 255, 255))
      end
      G.hitMarker(ev.k)
      G.playSound(ev.k and "kill" or "hit")
      if ev.k then onKill(ev) end
    elseif ev.phase == "theater" then
      G.announce("进入新战区：" .. tostring(ev.name), RGB(120, 220, 255), ev.desc, 3.2)
      G.jingle("win")
    elseif ev.phase == "skill" then
      G.skillReady[ev.id] = os.clock() + (ev.cd or 0)
      G.playSound("buy")
    elseif ev.phase == "hero" then
      ui.rejoinBtn.Visible = (not ev.alive) and G.battle ~= nil and G.drive == nil
    elseif ev.phase == "drive" then
      startDrive(ev)
    elseif ev.phase == "exit" then
      stopDrive()
    elseif ev.phase == "end" then
      local enemy = G.battle and G.battle.enemy
      G.battle = nil
      G.aim = nil
      preDrive = "free"
      stopDrive()
      ui.rejoinBtn.Visible = false
      if G.mode == "battle" then G.setMode("free") end
      local win = ev.result == "win"
      ui.resTitle.Text = win and "胜利！" or ((ev.result == "timeout") and "时间到" or "失败")
      ui.resTitle.TextColor3 = win and RGB(255, 214, 90) or RGB(240, 110, 100)
      ui.resStars.Text = ev.stars and (string.rep("★", ev.stars) .. string.rep("☆", 3 - ev.stars)) or ""
      local lines = {}
      if ev.record then table.insert(lines, "新纪录！最高打到第 " .. tostring(ev.level) .. " 关") end
      if ev.text then table.insert(lines, ev.text) end
      local rewardLine = nil
      if win and (ev.reward or 0) > 0 then
        table.insert(lines, "")
        rewardLine = #lines
      elseif not win and ev.mode == "pve" then
        table.insert(lines, counterTip(enemy))
      end
      if (ev.pk or 0) > 0 then table.insert(lines, "你亲手击毁 " .. tostring(ev.pk) .. " 个敌方单位") end
      if (ev.lostN or 0) > 0 then
        local parts = {}
        for _, t in ipairs(Config.UnitOrder) do
          local n = ev.lost and ev.lost[t]
          if n then table.insert(parts, UNITS[t].name .. "×" .. n) end
        end
        table.insert(lines, "损失：" .. table.concat(parts, "  "))
      elseif ev.mode ~= "duel" then
        table.insert(lines, "一个都没损失！")
      end
      local function rewardText(v)
        return "奖励 $" .. Config.Fmt(v) .. ((ev.mode == "pve") and ("，下一关：第 " .. tostring(ev.level) .. " 关") or "")
      end
      if rewardLine then lines[rewardLine] = rewardText(0) end
      ui.resBody.Text = table.concat(lines, "\n")
      ui.result.Visible = true
      G.jingle(win and "win" or "lose")
      if win then G.announce("胜利！", RGB(255, 214, 90), ev.stars and (string.rep("★", ev.stars) .. string.rep("☆", 3 - ev.stars)) or nil, 1.6) end
      -- 奖励数字滚上去
      if rewardLine then
        task.spawn(function()
          local t0 = os.clock()
          while ui.result.Visible do
            local k = math.min(1, (os.clock() - t0) / 0.9)
            lines[rewardLine] = rewardText(math.floor(ev.reward * k * (2 - k)))
            ui.resBody.Text = table.concat(lines, "\n")
            if k >= 1 then break end
            task.wait(0.03)
          end
        end)
      end
    end
    G.updateButtons()
  end

  ---------------------------------------------------------------- 输入

  local function orbitMode()
    return not G.drive and (G.mode == "deploy" or G.mode == "battle")
  end
  UIS.InputBegan:Connect(function(input, gp)
    local ut = input.UserInputType
    if ut == Enum.UserInputType.MouseButton2 and G.aim then
      G.aim = nil   -- 右键取消技能瞄准
      return
    end
    if ut == Enum.UserInputType.MouseButton2 and G.mode ~= "free" then   -- 右键拖动转镜头
      if G.drive then driveRot = true else G.ctlRotate(true) end
      UIS.MouseBehavior = Enum.MouseBehavior.LockCurrentPosition
    end
    if gp then return end
    if input.KeyCode == Enum.KeyCode.Escape and G.aim then
      G.aim = nil
      return
    end
    local skk = KEYSK[input.KeyCode]
    if skk and G.battle then
      G.toggleAim(skk)
      return
    end
    if ut == Enum.UserInputType.MouseButton1 then
      if G.aim and G.battle then
        castAt(input.Position.X, input.Position.Y, false)
      elseif G.drive then
        G.drive.firing = true
      elseif orbitMode() then
        G.ctlDown(input)
      elseif gun.id then
        gun.firing = true
        tryFire()
      end
    elseif ut == Enum.UserInputType.Touch then
      if orbitMode() then G.ctlDown(input) end
    elseif input.KeyCode == Enum.KeyCode.F and G.drive then
      RA:FireServer("exit")
    elseif input.KeyCode == Enum.KeyCode.R and gun.id then
      reload()
    elseif orbitMode() then
      G.ctlKey(input.KeyCode)
    end
  end)
  UIS.InputEnded:Connect(function(input)
    local ut = input.UserInputType
    if ut == Enum.UserInputType.MouseButton2 then
      driveRot = false
      G.ctlRotate(false)
      if G.mode ~= "free" then UIS.MouseBehavior = Enum.MouseBehavior.Default end
    elseif ut == Enum.UserInputType.MouseButton1 then
      gun.firing = false
      if G.drive then G.drive.firing = false end
      if orbitMode() then G.ctlUp(input) end
    elseif ut == Enum.UserInputType.Touch then
      if orbitMode() then G.ctlUp(input) end
    end
  end)
  UIS.InputChanged:Connect(function(input, gp)
    if G.mode == "free" then return end
    local ut = input.UserInputType
    if G.drive then
      if ut == Enum.UserInputType.MouseMovement and driveRot then
        G.drive.camYaw = G.drive.camYaw - input.Delta.X * 0.008
        G.drive.camPitch = math.clamp(G.drive.camPitch + input.Delta.Y * 0.005, -0.1, 1.2)
      end
      return
    end
    if not orbitMode() then return end
    if ut == Enum.UserInputType.MouseWheel then
      if not gp then G.ctlWheel(input) end
    elseif ut == Enum.UserInputType.MouseMovement or ut == Enum.UserInputType.Touch then
      G.ctlMove(input)
    end
  end)
  UIS.TouchTap:Connect(function(positions, gp)   -- 自己的小人上阵时（手机）：点一下放技能；布阵、观战走 ctlDown / ctlUp
    if gp or G.mode ~= "free" then return end
    local p = positions[1]
    if p and G.aim and G.battle then castAt(p.X, p.Y, false) end
  end)
  local pan0 = nil
  UIS.TouchPan:Connect(function(positions, total, velocity, state, gp)   -- 开车时单指拖动转镜头
    if not G.drive or gp or #positions ~= 1 then return end
    if state == Enum.UserInputState.Begin then
      pan0 = { yaw = G.drive.camYaw, pitch = G.drive.camPitch }
    elseif pan0 then
      G.drive.camYaw = pan0.yaw - total.X * 0.006
      G.drive.camPitch = math.clamp(pan0.pitch + total.Y * 0.004, -0.1, 1.2)
      if state == Enum.UserInputState.End then pan0 = nil end
    end
  end)
  UIS.TouchPinch:Connect(function(positions, scale, velocity, state, gp)
    if orbitMode() then G.ctlPinch(scale, state) end
  end)
  UIS.TouchRotate:Connect(function(positions, rotation, velocity, state, gp)
    if orbitMode() then G.ctlTurn(rotation, state) end
  end)
  -- 走到军工建筑旁按 E：兵工厂翻到这个建筑的页签
  PPS.PromptTriggered:Connect(function(prompt)
    local tab = prompt:GetAttribute("Tab")
    if tab and G.shopTab then G.shopTab(tab) end
  end)
  ui.fireBtn.MouseButton1Down:Connect(function()
    if G.drive then G.drive.firing = true end
  end)
  ui.fireBtn.MouseButton1Up:Connect(function()
    if G.drive then G.drive.firing = false end
  end)
  -- 手机：按住「升高」「降低」（松手或手指滑出按钮都停）
  for _, e in ipairs({ { ui.upBtn, 1 }, { ui.downBtn, -1 } }) do
    e[1].MouseButton1Down:Connect(function()
      if G.drive then G.drive.climb = e[2] end
    end)
    local function stop()
      if G.drive and G.drive.climb == e[2] then G.drive.climb = 0 end
    end
    e[1].MouseButton1Up:Connect(stop)
    e[1].MouseLeave:Connect(stop)
  end

  ---------------------------------------------------------------- 每帧

  local popT = 0
  function G.stepPlay(dt)
    if G.drive then driveStep(dt) end
    G.ctlStep(dt)   -- 布阵 / 观战的镜头、选中圈、名字、提示（别的模式下把它们藏起来）
    if gun.firing and gun.id and Config.Weapons[gun.id].auto and not G.aim then tryFire() end
    ammoHud()
    aimUpdate()
    if G.battle then
      local left = math.max(0, G.battle.len - (os.clock() - G.battle.t0))
      ui.bTitle.Text = string.format("%s   %d:%02d", G.battle.title, math.floor(left / 60), math.floor(left % 60))
    end
    -- 自己基地的楼顶隔几秒冒「+$」
    popT = popT + dt
    local S = G.S
    if popT >= 3 and S and G.mode == "free" and S.owned and not G.battle then
      popT = 0
      local mul = 1 + Config.Rebirth.income * (S.rebirth or 0)
      for id in pairs(S.owned) do
        local b = Config.BuildingById[id]
        if b and b.income then
          local v = Config.BuildingIncome(b, S.owned, S.lv and S.lv[id]) * mul
          local p = S.origin + V(b.x, 1 + b.size[2] + 2, b.z)
          if (p - cam.CFrame.Position).Magnitude < 260 then G.popText(p, "+$" .. Config.Fmt(v * 3), RGB(130, 235, 140)) end
        end
      end
    end
  end
end

return Play
