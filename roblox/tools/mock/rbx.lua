-- 在普通 Lua 5.4 里模拟「够用」的 Roblox，用来真正跑军事大亨的脚本、抓运行时错误：
--   属性名写错、类型不对（比如 nil 赋给 bool 属性）、枚举名写错、服务器 / 客户端用错 API、远程事件传了不能传的东西、
--   DataStore 存了不能存的东西、脚本里 nil 当表用……
-- 不模拟物理、渲染、网络延迟：RemoteEvent 下一帧把参数（深拷贝）交给另一边；Raycast 返回测试脚本指定的结果。
local R = { errors = {}, warns = {}, sent = {} }

local unpack = table.unpack

------------------------------------------------------------ 调度：协程 + 模拟时钟；每个协程记着自己是服务器还是客户端
local clock = 0
local queue = {}
local sideOf = setmetatable({}, { __mode = "k" })
local currentSide = "server"

local function report(msg)
  table.insert(R.errors, msg)
  io.stdout:write("\n!!! 脚本出错：" .. msg .. "\n")
end
R.report = report

local function resume(co, ...)
  local prev = currentSide
  currentSide = sideOf[co] or currentSide
  local ok, err = coroutine.resume(co, ...)
  currentSide = prev
  if not ok then report(debug.traceback(co, tostring(err))) end
end

local function side()
  local co = coroutine.running()
  return sideOf[co] or currentSide
end
R.side = side

local task = {}
local function newThread(f, sd)
  local co = coroutine.create(f)
  sideOf[co] = sd or side()
  return co
end
R.newThread = newThread
function task.spawn(f, ...)
  local co = (type(f) == "thread") and f or newThread(f)
  resume(co, ...)
  return co
end
function task.defer(f, ...)
  local co = newThread(f)
  table.insert(queue, { co = co, at = clock, args = table.pack(...) })
  return co
end
function task.delay(t, f, ...)
  assert(type(t) == "number", "task.delay 第一个参数要数字")
  local co = newThread(f)
  table.insert(queue, { co = co, at = clock + t, args = table.pack(...) })
  return co
end
function task.wait(t)
  local co, main = coroutine.running()
  if main then error("task.wait 不能在主线程调用", 2) end
  local start = clock
  table.insert(queue, { co = co, at = clock + math.max(t or 0, 1 / 60), args = table.pack() })
  coroutine.yield()
  return clock - start
end
R.task = task
function R.clock() return clock end

------------------------------------------------------------ 数据类型

local function typeof(v)
  local mt = getmetatable(v)
  if type(mt) == "table" and mt.__type then return mt.__type end
  return type(v)
end
R.typeof = typeof

local function rdonly() error("只读", 2) end

-- Vector3
local V3 = { __type = "Vector3" }
local V3m = {}
local function v3(x, y, z) return setmetatable({ _x = x or 0, _y = y or 0, _z = z or 0 }, V3) end
local function isV3(v) return getmetatable(v) == V3 end
V3.__index = function(v, k)
  if k == "X" then return v._x elseif k == "Y" then return v._y elseif k == "Z" then return v._z
  elseif k == "Magnitude" then return math.sqrt(v._x * v._x + v._y * v._y + v._z * v._z)
  elseif k == "Unit" then
    local m = math.sqrt(v._x * v._x + v._y * v._y + v._z * v._z)
    return v3(v._x / m, v._y / m, v._z / m)
  end
  if V3m[k] then return V3m[k] end
  error(tostring(k) .. " is not a valid member of Vector3", 2)
end
V3.__newindex = rdonly
V3.__add = function(a, b)
  if not (isV3(a) and isV3(b)) then error("Vector3 只能和 Vector3 相加，实际：" .. typeof(a) .. " + " .. typeof(b), 2) end
  return v3(a._x + b._x, a._y + b._y, a._z + b._z)
end
V3.__sub = function(a, b)
  if not (isV3(a) and isV3(b)) then error("Vector3 只能和 Vector3 相减，实际：" .. typeof(a) .. " - " .. typeof(b), 2) end
  return v3(a._x - b._x, a._y - b._y, a._z - b._z)
end
V3.__mul = function(a, b)
  if type(a) == "number" and isV3(b) then return v3(a * b._x, a * b._y, a * b._z) end
  if isV3(a) and type(b) == "number" then return v3(a._x * b, a._y * b, a._z * b) end
  if isV3(a) and isV3(b) then return v3(a._x * b._x, a._y * b._y, a._z * b._z) end
  error("Vector3 乘法类型不对：" .. typeof(a) .. " * " .. typeof(b), 2)
end
V3.__div = function(a, b)
  if isV3(a) and type(b) == "number" then return v3(a._x / b, a._y / b, a._z / b) end
  if isV3(a) and isV3(b) then return v3(a._x / b._x, a._y / b._y, a._z / b._z) end
  error("Vector3 除法类型不对", 2)
end
V3.__unm = function(a) return v3(-a._x, -a._y, -a._z) end
V3.__eq = function(a, b) return a._x == b._x and a._y == b._y and a._z == b._z end
V3.__tostring = function(v) return string.format("%.3f, %.3f, %.3f", v._x, v._y, v._z) end
function V3m.Lerp(a, b, t) return a + (b - a) * t end
function V3m.Dot(a, b) return a._x * b._x + a._y * b._y + a._z * b._z end
function V3m.Cross(a, b) return v3(a._y * b._z - a._z * b._y, a._z * b._x - a._x * b._z, a._x * b._y - a._y * b._x) end
local Vector3 = { new = function(x, y, z)
  for _, c in ipairs({ x or 0, y or 0, z or 0 }) do
    if type(c) ~= "number" then error("Vector3.new 参数要数字，实际 " .. typeof(c), 2) end
  end
  return v3(x, y, z)
end }
Vector3.zero, Vector3.one = v3(0, 0, 0), v3(1, 1, 1)
Vector3.xAxis, Vector3.yAxis, Vector3.zAxis = v3(1, 0, 0), v3(0, 1, 0), v3(0, 0, 1)

-- Vector2、UDim、UDim2、Color3：只记数
local function record(name, fields)
  local mt = { __type = name }
  mt.__index = function(t, k)
    local v = rawget(t, "_" .. k)
    if v ~= nil then return v end
    error(tostring(k) .. " is not a valid member of " .. name, 2)
  end
  mt.__newindex = rdonly
  mt.__eq = function(a, b)
    for _, f in ipairs(fields) do if rawget(a, "_" .. f) ~= rawget(b, "_" .. f) then return false end end
    return true
  end
  return function(...)
    local args = { ... }
    local o = {}
    for i, f in ipairs(fields) do
      local v = args[i]
      if v == nil then v = 0 end
      if type(v) ~= "number" then error(name .. ".new 参数要数字，实际 " .. typeof(v), 3) end
      o["_" .. f] = v
    end
    return setmetatable(o, mt)
  end, mt
end
local newV2, V2mt = record("Vector2", { "X", "Y" })
local Vector2 = { new = function(x, y) return newV2(x, y) end }
Vector2.zero = newV2(0, 0)
V2mt.__sub = function(a, b) return newV2(a._X - b._X, a._Y - b._Y) end
V2mt.__add = function(a, b) return newV2(a._X + b._X, a._Y + b._Y) end
local newUDim = record("UDim", { "Scale", "Offset" })
local UDim = { new = function(s, o) return newUDim(s, o) end }
local newUDim2, UD2mt = record("UDim2", { "XS", "XO", "YS", "YO" })
local UDim2 = {
  new = function(a, b, c, d) return newUDim2(a, b, c, d) end,
  fromOffset = function(x, y) return newUDim2(0, x, 0, y) end,
  fromScale = function(x, y) return newUDim2(x, 0, y, 0) end,
}
local _ = UD2mt
local newC3, C3mt = record("Color3", { "R", "G", "B" })
local Color3 = {
  new = function(r, g, b) return newC3(r or 0, g or 0, b or 0) end,
  fromRGB = function(r, g, b)
    for _, c in ipairs({ r, g, b }) do
      if type(c) ~= "number" then error("Color3.fromRGB 参数要数字", 2) end
    end
    return newC3(r / 255, g / 255, b / 255)
  end,
}
local C3index = C3mt.__index
C3mt.__index = function(c, k)
  if k == "Lerp" then
    return function(a, b, t)
      if typeof(b) ~= "Color3" then error("Color3:Lerp 要 Color3", 2) end
      return newC3(a._R + (b._R - a._R) * t, a._G + (b._G - a._G) * t, a._B + (b._B - a._B) * t)
    end
  end
  return C3index(c, k)
end

-- CFrame：位置 + 3×3 旋转（列是 右、上、后）
local CF = { __type = "CFrame" }
local CFm = {}
local function cf(px, py, pz, m)
  return setmetatable({ p = v3(px, py, pz), m = m or { 1, 0, 0, 0, 1, 0, 0, 0, 1 } }, CF)
end
local function isCF(v) return getmetatable(v) == CF end
local function mmul(a, b)
  local r = {}
  for i = 0, 2 do
    for j = 0, 2 do
      r[i * 3 + j + 1] = a[i * 3 + 1] * b[j + 1] + a[i * 3 + 2] * b[3 + j + 1] + a[i * 3 + 3] * b[6 + j + 1]
    end
  end
  return r
end
local function mvec(m, v) return v3(m[1] * v._x + m[2] * v._y + m[3] * v._z, m[4] * v._x + m[5] * v._y + m[6] * v._z, m[7] * v._x + m[8] * v._y + m[9] * v._z) end
CF.__index = function(c, k)
  if k == "Position" then return c.p
  elseif k == "X" then return c.p._x elseif k == "Y" then return c.p._y elseif k == "Z" then return c.p._z
  elseif k == "LookVector" then return v3(-c.m[3], -c.m[6], -c.m[9])
  elseif k == "RightVector" then return v3(c.m[1], c.m[4], c.m[7])
  elseif k == "UpVector" then return v3(c.m[2], c.m[5], c.m[8])
  end
  if CFm[k] then return CFm[k] end
  error(tostring(k) .. " is not a valid member of CFrame", 2)
end
CF.__newindex = rdonly
CF.__mul = function(a, b)
  if isCF(a) and isCF(b) then
    local p = a.p + mvec(a.m, b.p)
    return setmetatable({ p = p, m = mmul(a.m, b.m) }, CF)
  elseif isCF(a) and isV3(b) then
    return a.p + mvec(a.m, b)
  end
  error("CFrame 乘法类型不对：" .. typeof(a) .. " * " .. typeof(b), 2)
end
CF.__add = function(a, b)
  if isCF(a) and isV3(b) then return setmetatable({ p = a.p + b, m = a.m }, CF) end
  error("CFrame 只能加 Vector3", 2)
end
CF.__sub = function(a, b)
  if isCF(a) and isV3(b) then return setmetatable({ p = a.p - b, m = a.m }, CF) end
  error("CFrame 只能减 Vector3", 2)
end
CF.__tostring = function(c) return "CFrame(" .. tostring(c.p) .. ")" end
function CFm.Inverse(c)
  local m = c.m
  local t = { m[1], m[4], m[7], m[2], m[5], m[8], m[3], m[6], m[9] }
  local p = mvec(t, -c.p)
  return setmetatable({ p = p, m = t }, CF)
end
function CFm.PointToWorldSpace(c, v)
  if not isV3(v) then error("PointToWorldSpace 要 Vector3", 2) end
  return c * v
end
function CFm.PointToObjectSpace(c, v) return CFm.Inverse(c) * v end
function CFm.Lerp(a, b, t)
  if not isCF(b) then error("CFrame:Lerp 要 CFrame", 2) end
  local m = {}
  for i = 1, 9 do m[i] = a.m[i] + (b.m[i] - a.m[i]) * t end
  return setmetatable({ p = a.p:Lerp(b.p, t), m = m }, CF)
end
function CFm.GetComponents(c) return c.p._x, c.p._y, c.p._z, unpack(c.m) end
local function rotX(a) local c, s = math.cos(a), math.sin(a) return { 1, 0, 0, 0, c, -s, 0, s, c } end
local function rotY(a) local c, s = math.cos(a), math.sin(a) return { c, 0, s, 0, 1, 0, -s, 0, c } end
local function rotZ(a) local c, s = math.cos(a), math.sin(a) return { c, -s, 0, s, c, 0, 0, 0, 1 } end
local CFrame = {}
function CFrame.new(a, b, c)
  if a == nil then return cf(0, 0, 0) end
  if isV3(a) then
    if b ~= nil then error("这个模拟只支持 CFrame.new(Vector3)", 2) end
    return cf(a._x, a._y, a._z)
  end
  if type(a) ~= "number" or type(b) ~= "number" or type(c) ~= "number" then error("CFrame.new 参数不对", 2) end
  return cf(a, b, c)
end
function CFrame.Angles(x, y, z)
  for _, v in ipairs({ x, y, z }) do
    if type(v) ~= "number" then error("CFrame.Angles 参数要三个数字", 2) end
  end
  return setmetatable({ p = v3(0, 0, 0), m = mmul(mmul(rotX(x), rotY(y)), rotZ(z)) }, CF)
end
CFrame.fromEulerAnglesXYZ = CFrame.Angles
function CFrame.lookAt(at, target, up)
  if not (isV3(at) and isV3(target)) then error("CFrame.lookAt 要两个 Vector3", 2) end
  up = up or v3(0, 1, 0)
  local f = (target - at)
  if f.Magnitude < 1e-9 then error("CFrame.lookAt：两点重合", 2) end
  f = f.Unit
  local r = f:Cross(up)
  if r.Magnitude < 1e-9 then r = v3(1, 0, 0) else r = r.Unit end
  local u = r:Cross(f)
  return setmetatable({ p = at, m = { r._x, u._x, -f._x, r._y, u._y, -f._y, r._z, u._z, -f._z } }, CF)
end
CFrame.identity = cf(0, 0, 0)
function CFrame.fromMatrix(pos, vx, vy, vz)
  if not (isV3(pos) and isV3(vx) and isV3(vy)) then error("CFrame.fromMatrix 参数要 Vector3", 2) end
  vz = vz or vx:Cross(vy)
  return setmetatable({ p = pos, m = { vx._x, vy._x, vz._x, vx._y, vy._y, vz._y, vx._z, vy._z, vz._z } }, CF)
end
function CFrame.fromAxisAngle(axis, a)
  if not isV3(axis) or type(a) ~= "number" then error("CFrame.fromAxisAngle(Vector3, 数字)", 2) end
  local u = axis.Unit
  local x, y, z = u._x, u._y, u._z
  local c, s, t = math.cos(a), math.sin(a), 1 - math.cos(a)
  return setmetatable({ p = v3(0, 0, 0), m = { t * x * x + c, t * x * y - s * z, t * x * z + s * y, t * x * y + s * z, t * y * y + c, t * y * z - s * x,
    t * x * z - s * y, t * y * z + s * x, t * z * z + c } }, CF)
end

-- 枚举：只认白名单里的名字（写错了就报错）
local ENUMS = {
  Material = "Plastic SmoothPlastic Neon Wood WoodPlanks Marble Slate Concrete Granite Brick Pebble Cobblestone Rock Sandstone Basalt CrackedLava Asphalt LeafyGrass Salt Limestone Pavement Grass Ground Sand Fabric Glass ForceField Ice Metal DiamondPlate CorrodedMetal Foil Snow Mud Water Air Glacier Cardboard Carpet CeramicTiles ClayRoofTiles RoofShingles Leather Plaster Rubber",
  PartType = "Ball Block Cylinder Wedge CornerWedge",
  SurfaceType = "Smooth Studs Inlet Universal Glue Weld SmoothNoOutlines Hinge Motor SteppingMotor",
  Font = "Legacy Arial ArialBold SourceSans SourceSansBold SourceSansSemibold SourceSansLight SourceSansItalic Bodoni Garamond Cartoon Code Highway SciFi Arcade Fantasy Antique Gotham GothamMedium GothamBold GothamBlack AmaticSC Bangers Creepster DenkOne Fondamento FredokaOne GrenzeGotisch IndieFlower JosefinSans Jura Kalam LuckiestGuy Merriweather Michroma Nunito Oswald PatrickHand PermanentMarker Roboto RobotoCondensed RobotoMono Sarpanch SpecialElite TitilliumWeb Ubuntu BuilderSans BuilderSansMedium BuilderSansBold BuilderSansExtraBold Montserrat",
  EasingStyle = "Linear Sine Back Quad Quart Quint Bounce Elastic Exponential Circular Cubic",
  EasingDirection = "In Out InOut",
  TextXAlignment = "Left Center Right",
  TextYAlignment = "Top Center Bottom",
  FillDirection = "Horizontal Vertical",
  HorizontalAlignment = "Center Left Right",
  VerticalAlignment = "Center Top Bottom",
  SortOrder = "LayoutOrder Name Custom",
  AutomaticSize = "None X Y XY",
  ZIndexBehavior = "Global Sibling",
  ApplyStrokeMode = "Contextual Border",
  HighlightDepthMode = "AlwaysOnTop Occluded",
  UserInputType = "MouseButton1 MouseButton2 MouseButton3 MouseWheel MouseMovement Touch Keyboard Focus Accelerometer Gyro Gamepad1 TextInput InputMethod None",
  UserInputState = "Begin Change End Cancel None",
  KeyCode = "Unknown A B C D E F G H I J K L M N O P Q R S T U V W X Y Z Up Down Left Right Escape Space Return Tab LeftShift RightShift LeftControl RightControl One Two Three Four Five",
  MouseBehavior = "Default LockCenter LockCurrentPosition",
  CameraType = "Fixed Attach Watch Track Follow Custom Scriptable Orbital",
  RaycastFilterType = "Exclude Include Blacklist Whitelist",
  NormalId = "Right Top Back Left Bottom Front",
  ProximityPromptStyle = "Default Custom",
  SurfaceGuiSizingMode = "FixedSize PixelsPerStud",
  SortDirection = "Ascending Descending",
}
local Enum = {}
for ename, list in pairs(ENUMS) do
  local items = {}
  local i = 0
  for name in list:gmatch("%S+") do
    items[name] = setmetatable({ Name = name, EnumType = ename, Value = i }, { __type = "EnumItem", __tostring = function() return "Enum." .. ename .. "." .. name end })
    i = i + 1
  end
  Enum[ename] = setmetatable({}, { __index = function(_, k)
    local it = items[k]
    if not it then error(tostring(k) .. " is not a valid member of Enum." .. ename, 2) end
    return it
  end })
end
setmetatable(Enum, { __index = function(_, k) error("Enum." .. tostring(k) .. " 不在模拟的枚举白名单里（真没有，或者要补进 rbx.lua）", 2) end })

local TweenInfo = { new = function(t, style, dir)
  if type(t) ~= "number" then error("TweenInfo.new 第一个参数要数字", 2) end
  if style ~= nil and (typeof(style) ~= "EnumItem" or style.EnumType ~= "EasingStyle") then error("TweenInfo 缓动样式不对", 2) end
  if dir ~= nil and (typeof(dir) ~= "EnumItem" or dir.EnumType ~= "EasingDirection") then error("TweenInfo 缓动方向不对", 2) end
  return setmetatable({ Time = t }, { __type = "TweenInfo" })
end }

local RaycastParams = { new = function()
  local o = { FilterType = Enum.RaycastFilterType.Exclude, FilterDescendantsInstances = {} }
  return setmetatable({}, { __type = "RaycastParams", __index = o, __newindex = function(_, k, v)
    if k == "FilterType" then
      if typeof(v) ~= "EnumItem" or v.EnumType ~= "RaycastFilterType" then error("FilterType 要 Enum.RaycastFilterType", 2) end
    elseif k == "FilterDescendantsInstances" then
      if type(v) ~= "table" then error("FilterDescendantsInstances 要表", 2) end
      for i = 1, #v do if typeof(v[i]) ~= "Instance" then error("FilterDescendantsInstances 里有不是 Instance 的东西", 2) end end
    else
      error(tostring(k) .. " is not a valid member of RaycastParams", 2)
    end
    o[k] = v
  end })
end }

local Random = { new = function(seed)
  local s = math.floor(math.abs(seed or os.time())) % 2147483647
  if s == 0 then s = 1 end
  local function nxt()
    s = (s * 16807) % 2147483647
    return s / 2147483647
  end
  local o = {}
  function o.NextNumber(self, a, b)
    if self ~= o then error("Random:NextNumber 要用冒号调用", 2) end
    a, b = a or 0, b or 1
    return a + (b - a) * nxt()
  end
  function o.NextInteger(self, a, b)
    if self ~= o then error("Random:NextInteger 要用冒号调用", 2) end
    return a + math.floor(nxt() * (b - a + 1))
  end
  return setmetatable(o, { __type = "Random" })
end }

------------------------------------------------------------ 实例

local T = {}
T.bool = function(v) return type(v) == "boolean" end
T.number = function(v) return type(v) == "number" and v == v end
T.string = function(v) return type(v) == "string" end
for _, n in ipairs({ "Vector3", "Vector2", "CFrame", "Color3", "UDim", "UDim2" }) do
  T[n] = function(v) return typeof(v) == n end
end
T.Instance = function(v) return v == nil or typeof(v) == "Instance" end
local function E(name) return function(v) return typeof(v) == "EnumItem" and v.EnumType == name end end

local CLASS = {}
-- def(类名, 父类, { 属性 = { 类型检查, 默认值 } }, { events = {…}, ro = {…}, methods = {…}, noCreate = true })
local function def(name, parent, props, extra)
  extra = extra or {}
  CLASS[name] = { name = name, parent = parent, props = props or {}, events = extra.events or {}, ro = extra.ro or {}, methods = extra.methods or {}, noCreate = extra.noCreate }
end
local function lookup(cls, field, key)
  local c = CLASS[cls]
  while c do
    local v = c[field][key]
    if v ~= nil then return v end
    c = CLASS[c.parent]
  end
  return nil
end
local function isA(cls, want)
  local c = CLASS[cls]
  while c do
    if c.name == want then return true end
    c = CLASS[c.parent]
  end
  return false
end

local INST = { __type = "Instance" }
local Instance = {}
local tags = {}   -- 标签 → { [inst] = true }

local function newSig()
  local s = { conns = {} }
  function s.Connect(self, f)
    if self ~= s then error("Connect 要用冒号调用", 2) end
    if type(f) ~= "function" then error("Connect 要函数", 2) end
    local c = { f = f, on = true, side = side() }
    table.insert(s.conns, c)
    return { Connected = true, Disconnect = function() c.on = false end }
  end
  function s.Fire(_, ...)
    local list = {}
    for _, c in ipairs(s.conns) do if c.on then list[#list + 1] = c end end
    for _, c in ipairs(list) do
      local co = newThread(c.f, c.side)
      resume(co, ...)
    end
  end
  return s
end
R.newSig = newSig

local function make(cls)
  local o = setmetatable({ _cls = cls, _p = {}, _kids = {}, _attr = {}, _ev = {}, _chg = {}, _dead = false }, INST)
  o._p.Name = cls
  return o
end

local function fire(o, prop)
  local s = o._chg[prop]
  if s then s:Fire() end
end

local function setParent(o, p)
  if o._dead then error("The Parent property of " .. o._p.Name .. " is locked", 3) end
  if p ~= nil and typeof(p) ~= "Instance" then error("Parent 要 Instance，实际 " .. typeof(p), 3) end
  local a = p
  while a do
    if a == o then error("不能把 " .. o._p.Name .. " 放进它自己的子孙里", 3) end
    a = rawget(a, "_parent")
  end
  local old = rawget(o, "_parent")
  if old == p then return end
  if old then
    for i, k in ipairs(old._kids) do
      if k == o then table.remove(old._kids, i) break end
    end
  end
  rawset(o, "_parent", p)
  if p then table.insert(p._kids, o) end
  if old and old._ev.ChildRemoved then old._ev.ChildRemoved:Fire(o) end
  if p and p._ev.ChildAdded then p._ev.ChildAdded:Fire(o) end
  if o._ev.AncestryChanged then o._ev.AncestryChanged:Fire(o, p) end
end

local function partCF(o)
  if not o._p.Anchored then
    for _, c in ipairs(o._kids) do
      if (c._cls == "Weld" or c._cls == "Motor6D") and c._p.Part1 == o and c._p.Part0 and c._p.Part0 ~= o then
        local J = c._p
        local t = J.C0 or CFrame.new()
        if J.Transform then t = t * J.Transform end
        return partCF(J.Part0) * t * (J.C1 or CFrame.new()):Inverse()
      end
    end
  end
  return o._p.CFrame or CFrame.new()
end
R.partCF = partCF

INST.__index = function(o, k)
  if k == "Parent" then return rawget(o, "_parent") end
  if k == "CFrame" and isA(o._cls, "BasePart") then return partCF(o) end
  if k == "ClassName" then return o._cls end
  if k == "Name" then return o._p.Name end
  local spec = lookup(o._cls, "props", k)
  if spec then
    local v = o._p[k]
    if v == nil then v = spec[2] end
    return v
  end
  local m = lookup(o._cls, "methods", k)
  if m then return m end
  if lookup(o._cls, "events", k) then
    local s = o._ev[k]
    if not s then
      s = newSig()
      o._ev[k] = s
    end
    return s
  end
  local ro = lookup(o._cls, "ro", k)
  if ro ~= nil then
    if type(ro) == "function" then return ro(o) end
    return ro
  end
  for _, c in ipairs(o._kids) do
    if c._p.Name == k then return c end
  end
  error(tostring(k) .. " is not a valid member of " .. o._cls .. " \"" .. tostring(o._p.Name) .. "\"", 2)
end

INST.__newindex = function(o, k, v)
  if k == "Parent" then return setParent(o, v) end
  if k == "Name" then
    if type(v) ~= "string" then error("Name 要字符串", 2) end
    o._p.Name = v
    return
  end
  local spec = lookup(o._cls, "props", k)
  if not spec then
    if lookup(o._cls, "ro", k) ~= nil then error(k .. " 是只读属性（" .. o._cls .. "）", 2) end
    error(tostring(k) .. " is not a valid member of " .. o._cls .. " \"" .. tostring(o._p.Name) .. "\"", 2)
  end
  if not spec[1](v) then
    error("给 " .. o._cls .. "." .. k .. " 赋了不对的类型：" .. typeof(v) .. "（" .. tostring(v) .. "）", 2)
  end
  if o._cls == "Humanoid" and k == "Health" then
    local max = o._p.MaxHealth or 100
    v = math.min(v, max)
    local was = o._p.Health or 100
    o._p.Health = v
    if v <= 0 and was > 0 and not rawget(o, "_died") then
      rawset(o, "_died", true)
      o.Died:Fire()
    end
    return
  end
  if o._cls == "Humanoid" and k == "MaxHealth" then
    o._p.MaxHealth = v
    if (o._p.Health or 100) > v then o._p.Health = v end
    return
  end
  o._p[k] = v
  if o._cls == "Part" and k == "Shape" and v.Name == "Ball" then
    local s = o._p.Size or v3(4, 1.2, 2)
    local m = math.min(s._x, s._y, s._z)
    o._p.Size = v3(m, m, m)
  end
  fire(o, k)
end
INST.__tostring = function(o) return o._p.Name end

local function descendants(o, out)
  for _, c in ipairs(o._kids) do
    out[#out + 1] = c
    descendants(c, out)
  end
  return out
end

local base = {}
function base.Destroy(o)
  if o._dead then return end
  for _, c in ipairs({ unpack(o._kids) }) do base.Destroy(c) end
  if rawget(o, "_parent") then setParent(o, nil) end
  o._dead = true
  for _, s in pairs(o._ev) do
    for _, c in ipairs(s.conns) do c.on = false end
  end
  for _, set in pairs(tags) do set[o] = nil end
end
local CLONE_SKIP = { Player = true, Backpack = true, PlayerGui = true }
function base.Clone(o)
  if o._p.Archivable == false or CLONE_SKIP[o._cls] then return nil end
  local map = {}
  local function copy(src)
    local c = make(src._cls)
    map[src] = c
    for k, v in pairs(src._p) do c._p[k] = v end
    for k, v in pairs(src._attr) do c._attr[k] = v end
    for _, set in pairs(tags) do
      if set[src] then set[c] = true end
    end
    for _, kid in ipairs(src._kids) do
      local kc = copy(kid)
      rawset(kc, "_parent", c)
      table.insert(c._kids, kc)
    end
    return c
  end
  local c = copy(o)
  for src, dst in pairs(map) do
    local _ = src
    for k, v in pairs(dst._p) do
      if typeof(v) == "Instance" and map[v] then dst._p[k] = map[v] end
    end
  end
  return c
end
function base.ClearAllChildren(o)
  for _, c in ipairs({ unpack(o._kids) }) do base.Destroy(c) end
end
function base.GetChildren(o) return { unpack(o._kids) } end
function base.GetDescendants(o) return descendants(o, {}) end
function base.FindFirstChild(o, name, rec)
  if type(name) ~= "string" then error("FindFirstChild 要名字字符串", 2) end
  for _, c in ipairs(o._kids) do if c._p.Name == name then return c end end
  if rec then
    for _, c in ipairs(o._kids) do
      local r = base.FindFirstChild(c, name, true)
      if r then return r end
    end
  end
  return nil
end
function base.FindFirstChildOfClass(o, cls)
  for _, c in ipairs(o._kids) do if c._cls == cls then return c end end
  return nil
end
function base.FindFirstChildWhichIsA(o, cls)
  for _, c in ipairs(o._kids) do if isA(c._cls, cls) then return c end end
  return nil
end
function base.FindFirstAncestorOfClass(o, cls)
  local a = rawget(o, "_parent")
  while a do
    if a._cls == cls then return a end
    a = rawget(a, "_parent")
  end
  return nil
end
function base.FindFirstAncestorWhichIsA(o, cls)
  local a = rawget(o, "_parent")
  while a do
    if isA(a._cls, cls) then return a end
    a = rawget(a, "_parent")
  end
  return nil
end
function base.IsA(o, cls) return isA(o._cls, cls) end
function base.IsDescendantOf(o, anc)
  local a = rawget(o, "_parent")
  while a do
    if a == anc then return true end
    a = rawget(a, "_parent")
  end
  return false
end
function base.WaitForChild(o, name, timeout)
  if type(name) ~= "string" then error("WaitForChild 要名字字符串", 2) end
  local t0 = clock
  local warned = false
  while true do
    local c = base.FindFirstChild(o, name)
    if c then return c end
    if timeout and clock - t0 >= timeout then return nil end
    if not timeout and not warned and clock - t0 > 5 then
      warned = true
      table.insert(R.warns, "Infinite yield possible on " .. o._p.Name .. ":WaitForChild(\"" .. name .. "\")")
    end
    task.wait()
  end
end
local ATTR_OK = { ["nil"] = true, boolean = true, number = true, string = true, Vector3 = true, Vector2 = true, Color3 = true, CFrame = true, UDim = true, UDim2 = true }
function base.SetAttribute(o, k, v)
  if type(k) ~= "string" then error("SetAttribute 名字要字符串", 2) end
  if not ATTR_OK[typeof(v)] then error("SetAttribute 不能存 " .. typeof(v), 2) end
  o._attr[k] = v
end
function base.GetAttribute(o, k) return o._attr[k] end
function base.GetPropertyChangedSignal(o, prop)
  if not lookup(o._cls, "props", prop) and lookup(o._cls, "ro", prop) == nil then error(prop .. " 不是 " .. o._cls .. " 的属性", 2) end
  local s = o._chg[prop]
  if not s then
    s = newSig()
    o._chg[prop] = s
  end
  return s
end
function base.GetFullName(o)
  local names = {}
  local a = o
  while a and a._cls ~= "DataModel" do
    table.insert(names, 1, a._p.Name)
    a = rawget(a, "_parent")
  end
  return table.concat(names, ".")
end
def("Instance", nil, { Archivable = { T.bool, true } }, { methods = base, noCreate = true, events = { ChildAdded = true, ChildRemoved = true, AncestryChanged = true, Destroying = true } })

-- 物体
local pv = {}
function pv.PivotTo(o, c)
  if not isCF(c) then error("PivotTo 要 CFrame", 2) end
  if o._cls == "Model" or isA(o._cls, "Model") then
    local pp = o._p.PrimaryPart or base.FindFirstChildWhichIsA(o, "BasePart")
    if pp then pp.CFrame = c end
    o._p.WorldPivot = c
  else
    o.CFrame = c
  end
end
function pv.GetPivot(o)
  if isA(o._cls, "BasePart") then return o.CFrame end
  return o._p.WorldPivot or CFrame.new()
end
def("PVInstance", "Instance", {}, { methods = pv, noCreate = true })
def("BasePart", "PVInstance", {
  Anchored = { T.bool, false }, CanCollide = { T.bool, true }, CanQuery = { T.bool, true }, CanTouch = { T.bool, true },
  CastShadow = { T.bool, true }, Massless = { T.bool, false }, Locked = { T.bool, false },
  Size = { T.Vector3, v3(4, 1.2, 2) }, CFrame = { T.CFrame, CFrame.new() }, Color = { T.Color3, newC3(0.64, 0.64, 0.64) },
  Material = { E("Material"), Enum.Material.Plastic }, Transparency = { T.number, 0 }, Reflectance = { T.number, 0 },
  TopSurface = { E("SurfaceType"), Enum.SurfaceType.Smooth }, BottomSurface = { E("SurfaceType"), Enum.SurfaceType.Smooth },
  Orientation = { T.Vector3, v3() },
  LocalTransparencyModifier = { T.number, 0 },
}, { events = { Touched = true, TouchEnded = true }, ro = { Position = function(o) return partCF(o).Position end }, noCreate = true })
def("Part", "BasePart", { Shape = { E("PartType"), Enum.PartType.Block } })
def("Terrain", "BasePart", {}, { noCreate = true, methods = {
  FillBlock = function(_, c, size, mat)
    if not isCF(c) or not isV3(size) or typeof(mat) ~= "EnumItem" or mat.EnumType ~= "Material" then error("FillBlock(CFrame, Vector3, Material) 参数不对", 2) end
    if size._x > 2048 * 4 or size._z > 2048 * 4 then error("FillBlock 区域太大", 2) end
  end,
} })
def("MeshPart", "BasePart", { TextureID = { T.string, "" }, MeshId = { T.string, "" }, DoubleSided = { T.bool, false } })
def("SurfaceAppearance", "Instance", {})
def("Attachment", "Instance", { Position = { T.Vector3, v3() }, CFrame = { T.CFrame, CFrame.new() } }, { ro = {
  WorldPosition = function(o)
    local p = rawget(o, "_parent")
    local pos = o._p.Position or v3()
    if p and isA(p._cls, "BasePart") then return partCF(p) * pos end
    return pos
  end,
} })
def("Decal", "Instance", { Transparency = { T.number, 0 }, Texture = { T.string, "" } })
def("Tool", "Model", { RequiresHandle = { T.bool, true }, CanBeDropped = { T.bool, true }, ToolTip = { T.string, "" }, Grip = { T.CFrame, CFrame.new() }, Enabled = { T.bool, true } },
  { events = { Activated = true, Deactivated = true, Equipped = true, Unequipped = true } })
def("Backpack", "Instance", {}, { noCreate = true })
def("StringValue", "Instance", { Value = { T.string, "" } })
def("Model", "PVInstance", { PrimaryPart = { function(v) return v == nil or (typeof(v) == "Instance" and isA(v._cls, "BasePart")) end, nil }, WorldPivot = { T.CFrame, CFrame.new() } })
def("Folder", "Instance", {})
def("JointInstance", "Instance", {
  Part0 = { function(v) return v == nil or (typeof(v) == "Instance" and isA(v._cls, "BasePart")) end, nil },
  Part1 = { function(v) return v == nil or (typeof(v) == "Instance" and isA(v._cls, "BasePart")) end, nil },
  C0 = { T.CFrame, CFrame.new() }, C1 = { T.CFrame, CFrame.new() }, Enabled = { T.bool, true },
}, { noCreate = true })
def("Weld", "JointInstance", {})
def("Motor6D", "JointInstance", { Transform = { T.CFrame, CFrame.new() }, MaxVelocity = { T.number, 0 }, DesiredAngle = { T.number, 0 }, CurrentAngle = { T.number, 0 } })

-- 界面
def("LayerCollector", "Instance", { Enabled = { T.bool, true }, ResetOnSpawn = { T.bool, true }, ZIndexBehavior = { E("ZIndexBehavior"), Enum.ZIndexBehavior.Global } }, { noCreate = true })
def("ScreenGui", "LayerCollector", { IgnoreGuiInset = { T.bool, false }, DisplayOrder = { T.number, 0 } })
def("SurfaceGui", "LayerCollector", {
  Face = { E("NormalId"), Enum.NormalId.Front }, SizingMode = { E("SurfaceGuiSizingMode"), Enum.SurfaceGuiSizingMode.FixedSize }, PixelsPerStud = { T.number, 50 },
  LightInfluence = { T.number, 1 }, Adornee = { T.Instance, nil }, AlwaysOnTop = { T.bool, false }, CanvasSize = { T.Vector2, newV2(800, 600) },
})
def("BillboardGui", "LayerCollector", {
  Size = { T.UDim2, newUDim2(0, 0, 0, 0) }, StudsOffset = { T.Vector3, v3() }, StudsOffsetWorldSpace = { T.Vector3, v3() }, ExtentsOffset = { T.Vector3, v3() },
  AlwaysOnTop = { T.bool, false }, LightInfluence = { T.number, 1 }, MaxDistance = { T.number, math.huge }, Brightness = { T.number, 1 }, Adornee = { T.Instance, nil },
})
local guiObj = {
  Size = { T.UDim2, newUDim2(0, 100, 0, 100) }, Position = { T.UDim2, newUDim2(0, 0, 0, 0) }, AnchorPoint = { T.Vector2, newV2(0, 0) },
  BackgroundColor3 = { T.Color3, newC3(1, 1, 1) }, BackgroundTransparency = { T.number, 0 }, BorderSizePixel = { T.number, 1 }, BorderColor3 = { T.Color3, newC3(0, 0, 0) },
  Visible = { T.bool, true }, ZIndex = { T.number, 1 }, LayoutOrder = { T.number, 0 }, AutomaticSize = { E("AutomaticSize"), Enum.AutomaticSize.None },
  ClipsDescendants = { T.bool, false }, Rotation = { T.number, 0 }, Active = { T.bool, false },
}
def("GuiObject", "Instance", guiObj, { noCreate = true })
def("Frame", "GuiObject", {})
def("ScrollingFrame", "GuiObject", { CanvasSize = { T.UDim2, newUDim2(0, 0, 0, 0) }, ScrollBarThickness = { T.number, 12 }, CanvasPosition = { T.Vector2, newV2(0, 0) } })
local textProps = {
  Text = { T.string, "Label" }, TextColor3 = { T.Color3, newC3(0, 0, 0) }, TextSize = { T.number, 14 }, Font = { E("Font"), Enum.Font.Legacy },
  TextScaled = { T.bool, false }, TextWrapped = { T.bool, false }, TextXAlignment = { E("TextXAlignment"), Enum.TextXAlignment.Center },
  TextYAlignment = { E("TextYAlignment"), Enum.TextYAlignment.Center }, TextTransparency = { T.number, 0 }, TextStrokeTransparency = { T.number, 1 },
  TextStrokeColor3 = { T.Color3, newC3(0, 0, 0) }, RichText = { T.bool, false },
}
def("TextLabel", "GuiObject", textProps)
local tb = {}
for k, v in pairs(textProps) do tb[k] = v end
tb.AutoButtonColor = { T.bool, true }
tb.Modal = { T.bool, false }
def("TextButton", "GuiObject", tb, { events = { Activated = true, MouseButton1Click = true, MouseButton1Down = true, MouseButton1Up = true } })
def("UICorner", "Instance", { CornerRadius = { T.UDim, newUDim(0, 8) } })
def("UIStroke", "Instance", { Color = { T.Color3, newC3(0, 0, 0) }, Thickness = { T.number, 1 }, Transparency = { T.number, 0 }, ApplyStrokeMode = { E("ApplyStrokeMode"), Enum.ApplyStrokeMode.Contextual } })
def("UIListLayout", "Instance", {
  FillDirection = { E("FillDirection"), Enum.FillDirection.Vertical }, HorizontalAlignment = { E("HorizontalAlignment"), Enum.HorizontalAlignment.Left },
  VerticalAlignment = { E("VerticalAlignment"), Enum.VerticalAlignment.Top }, Padding = { T.UDim, newUDim(0, 0) }, SortOrder = { E("SortOrder"), Enum.SortOrder.Name },
})
def("UIPadding", "Instance", { PaddingTop = { T.UDim, newUDim(0, 0) }, PaddingBottom = { T.UDim, newUDim(0, 0) }, PaddingLeft = { T.UDim, newUDim(0, 0) }, PaddingRight = { T.UDim, newUDim(0, 0) } })
def("UIScale", "Instance", { Scale = { T.number, 1 } })
def("UITextSizeConstraint", "Instance", { MaxTextSize = { T.number, 100 }, MinTextSize = { T.number, 1 } })

-- 其他
def("ProximityPrompt", "Instance", {
  ActionText = { T.string, "Interact" }, ObjectText = { T.string, "" }, HoldDuration = { T.number, 0 }, MaxActivationDistance = { T.number, 10 },
  RequiresLineOfSight = { T.bool, true }, KeyboardKeyCode = { E("KeyCode"), Enum.KeyCode.E }, Enabled = { T.bool, true }, Style = { E("ProximityPromptStyle"), Enum.ProximityPromptStyle.Default },
  UIOffset = { T.Vector2, newV2(0, 0) },
}, { events = { Triggered = true, TriggerEnded = true } })
def("Smoke", "Instance", { Color = { T.Color3, newC3(1, 1, 1) }, Opacity = { T.number, 0.5 }, RiseVelocity = { T.number, 1 }, Size = { T.number, 1 }, Enabled = { T.bool, true } })
def("Fire", "Instance", { Color = { T.Color3, newC3(1, 0.5, 0) }, SecondaryColor = { T.Color3, newC3(1, 0, 0) }, Heat = { T.number, 9 }, Size = { T.number, 5 }, Enabled = { T.bool, true } })
def("PointLight", "Instance", { Brightness = { T.number, 1 }, Range = { T.number, 8 }, Color = { T.Color3, newC3(1, 1, 1) }, Shadows = { T.bool, false }, Enabled = { T.bool, true } })
def("Highlight", "Instance", {
  Adornee = { T.Instance, nil }, FillColor = { T.Color3, newC3(1, 0, 0) }, OutlineColor = { T.Color3, newC3(1, 1, 1) }, FillTransparency = { T.number, 0.5 },
  OutlineTransparency = { T.number, 0 }, DepthMode = { E("HighlightDepthMode"), Enum.HighlightDepthMode.AlwaysOnTop }, Enabled = { T.bool, true },
})
def("Atmosphere", "Instance", { Density = { T.number, 0.3 }, Offset = { T.number, 0 }, Haze = { T.number, 0 }, Glare = { T.number, 0 }, Color = { T.Color3, newC3(0.78, 0.78, 0.78) }, Decay = { T.Color3, newC3(0.42, 0.44, 0.49) } })
def("IntValue", "Instance", { Value = { function(v) return type(v) == "number" and v == math.floor(v) end, 0 } })
def("Sound", "Instance", { SoundId = { T.string, "" }, Volume = { T.number, 0.5 }, RollOffMaxDistance = { T.number, 10000 }, Looped = { T.bool, false }, PlaybackSpeed = { T.number, 1 } }, { methods = { Play = function() end, Stop = function() end } })
def("Humanoid", "Instance", { Health = { T.number, 100 }, MaxHealth = { T.number, 100 }, WalkSpeed = { T.number, 16 } }, { events = { Died = true, HealthChanged = true }, methods = {
  TakeDamage = function(o, n)
    if type(n) ~= "number" then error("TakeDamage 要数字", 2) end
    o.Health = math.max(0, (o._p.Health or 100) - n)
  end,
} })
def("LuaSourceContainer", "Instance", { Source = { T.string, "" } }, { noCreate = true })
def("ModuleScript", "LuaSourceContainer", {})
def("Script", "LuaSourceContainer", { Disabled = { T.bool, false } })
def("LocalScript", "Script", {})
local function ser(v, seen, path, forStore)
  local tv = typeof(v)
  if tv == "function" or tv == "thread" then error("远程事件 / 存档里不能传 " .. tv .. "（" .. path .. "）", 0) end
  if forStore and tv ~= "table" and tv ~= "string" and tv ~= "number" and tv ~= "boolean" and tv ~= "nil" then
    error("DataStore 不能存 " .. tv .. "（" .. path .. "）", 0)
  end
  if forStore and tv == "number" and (v ~= v or v == math.huge or v == -math.huge) then error("DataStore 不能存 NaN / inf（" .. path .. "）", 0) end
  if tv ~= "table" then return v end
  if seen[v] then error("表里有循环引用（" .. path .. "）", 0) end
  seen[v] = true
  local n, nstr = 0, 0
  for k in pairs(v) do
    if type(k) == "number" then n = n + 1 elseif type(k) == "string" then nstr = nstr + 1 else error("表的键只能是字符串或数字（" .. path .. "）", 0) end
  end
  if n > 0 and nstr > 0 then error("表里数字键和字符串键混着用，Roblox 传过去会丢数据（" .. path .. "）", 0) end
  if n > 0 and n ~= #v then error("数组有空洞，Roblox 传过去会丢数据（" .. path .. "）", 0) end
  local out = {}
  for k, x in pairs(v) do out[k] = ser(x, seen, path .. "." .. tostring(k), forStore) end
  seen[v] = nil
  return out
end
R.ser = ser
def("RemoteEvent", "Instance", {}, { events = { OnServerEvent = true, OnClientEvent = true }, methods = {
  FireServer = function(o, ...)
    if side() ~= "client" then error("FireServer 只能在客户端调用", 2) end
    local args = ser({ ... }, {}, o._p.Name, false)
    local pl = R.localPlayer
    R.up = R.up or {}
    table.insert(R.up, { name = o._p.Name, args = args })
    task.defer(function() o.OnServerEvent:Fire(pl, unpack(args)) end)
  end,
  FireClient = function(o, pl, ...)
    if side() ~= "server" then error("FireClient 只能在服务器调用", 2) end
    if typeof(pl) ~= "Instance" or pl._cls ~= "Player" then error("FireClient 第一个参数要 Player", 2) end
    local args = ser({ ... }, {}, o._p.Name, false)
    table.insert(R.sent, { name = o._p.Name, args = args })
    if pl == R.localPlayer then
      local co = newThread(function() o.OnClientEvent:Fire(unpack(args)) end, "client")
      table.insert(queue, { co = co, at = clock, args = table.pack() })
    end
  end,
  FireAllClients = function(o, ...)
    if side() ~= "server" then error("FireAllClients 只能在服务器调用", 2) end
    local args = ser({ ... }, {}, o._p.Name, false)
    table.insert(R.sent, { name = o._p.Name, args = args, all = true })
    if R.localPlayer then
      local co = newThread(function() o.OnClientEvent:Fire(unpack(args)) end, "client")
      table.insert(queue, { co = co, at = clock, args = table.pack() })
    end
  end,
} })

------------------------------------------------------------ 服务和游戏

function Instance.new(cls, parent)
  local c = CLASS[cls]
  if not c or c.noCreate then error("Instance.new：不能创建 " .. tostring(cls), 2) end
  local o = make(cls)
  if parent ~= nil then o.Parent = parent end
  return o
end
R.make = make

local game = make("DataModel")
-- 服务器信息：测试里改 R.placeId / R.jobId / R.privateServerId / R.privateServerOwnerId 模拟不同的服务器（预留的对战服务器 PrivateServerId 不空、OwnerId 为 0）
def("DataModel", "Instance", {}, { noCreate = true, ro = {
  PlaceId = function() return R.placeId or 1234 end, JobId = function() return R.jobId or "job-local" end,
  PrivateServerId = function() return R.privateServerId or "" end, PrivateServerOwnerId = function() return R.privateServerOwnerId or 0 end,
}, methods = {
  GetService = function(o, name)
    if o ~= game then error("GetService 要用冒号调用", 2) end
    local s = R.services[name]
    if not s then error("模拟里没有服务 " .. tostring(name), 2) end
    return s
  end,
  BindToClose = function(_, f) R.onClose = f end,
} })
game._p.Name = "Game"

local function service(cls, props, extra)
  def(cls, extra and extra.parent or "Instance", props, extra)
  local o = make(cls)
  o.Parent = game
  return o
end
R.services = {}

local camera = make("Camera")
def("Camera", "Instance", {
  CFrame = { T.CFrame, CFrame.new(0, 20, 20) }, CameraType = { E("CameraType"), Enum.CameraType.Custom }, CameraSubject = { T.Instance, nil }, FieldOfView = { T.number, 70 },
}, { noCreate = true, ro = { ViewportSize = newV2(1280, 720) }, methods = {
  ScreenPointToRay = function(o, x, y)
    if type(x) ~= "number" or type(y) ~= "number" then error("ScreenPointToRay 要两个数字", 2) end
    return setmetatable({ Origin = o.CFrame.Position, Direction = o.CFrame.LookVector }, { __type = "Ray" })
  end,
  ViewportPointToRay = function(o, x, y)
    if type(x) ~= "number" or type(y) ~= "number" then error("ViewportPointToRay 要两个数字", 2) end
    return setmetatable({ Origin = o.CFrame.Position, Direction = o.CFrame.LookVector }, { __type = "Ray" })
  end,
} })

local ws = service("Workspace", { StreamingEnabled = { T.bool, false }, Gravity = { T.number, 196.2 }, CurrentCamera = { T.Instance, nil } }, { parent = "Model", methods = {
  Raycast = function(_, origin, dir, params)
    if not isV3(origin) or not isV3(dir) then error("Raycast(Vector3, Vector3, RaycastParams)", 2) end
    if params ~= nil and typeof(params) ~= "RaycastParams" then error("Raycast 第三个参数要 RaycastParams", 2) end
    local hit = R.nextRay
    R.nextRay = nil
    if not hit then return R.castRay(origin, dir, params) end
    if hit and params and params.FilterType == Enum.RaycastFilterType.Include then
      local ok = false
      for _, inst in ipairs(params.FilterDescendantsInstances) do
        if hit.Instance == inst or hit.Instance:IsDescendantOf(inst) then ok = true end
      end
      if not ok then return nil end
    end
    return hit
  end,
} })
local function underAny(o, list)
  for _, inst in ipairs(list) do
    if o == inst or base.IsDescendantOf(o, inst) then return true end
  end
  return false
end
function R.castRay(origin, dir, params)
  local len = dir.Magnitude
  if len < 1e-9 then return nil end
  local d = dir / len
  local best, bt, bp = nil, len, nil
  local inc = params and params.FilterType == Enum.RaycastFilterType.Include
  local list = params and params.FilterDescendantsInstances or {}
  for _, o in ipairs(descendants(ws, {})) do
    if isA(o._cls, "BasePart") and o._cls ~= "Terrain" and o._p.CanQuery ~= false and not (o._p.Transparency == 1 and o._p.CanCollide == false and o._p.Name ~= "Root") then
      local ok = true
      if params then
        local u = underAny(o, list)
        if inc then ok = u else ok = not u end
      end
      if ok then
        local cfp = partCF(o)
        local inv = CFm.Inverse(cfp)
        local lo = inv * origin
        local ld = mvec(inv.m, d)
        local h = (o._p.Size or v3(4, 1.2, 2)) / 2
        local t0, t1 = -math.huge, math.huge
        local hit = true
        for _, ax in ipairs({ { lo._x, ld._x, h._x }, { lo._y, ld._y, h._y }, { lo._z, ld._z, h._z } }) do
          local p0, dd, hh = ax[1], ax[2], ax[3]
          if math.abs(dd) < 1e-12 then
            if p0 < -hh or p0 > hh then hit = false end
          else
            local a, b = (-hh - p0) / dd, (hh - p0) / dd
            if a > b then a, b = b, a end
            t0, t1 = math.max(t0, a), math.min(t1, b)
          end
        end
        if hit and t1 >= math.max(t0, 0) then
          local t = math.max(t0, 0)
          if t < bt then best, bt, bp = o, t, origin + d * t end
        end
      end
    end
  end
  if d._y < -1e-6 and not inc then   -- 地形：y = 0 的平面
    local t = -origin._y / d._y
    if t >= 0 and t < bt then best, bt, bp = R.terrain, t, origin + d * t end
  end
  if not best then return nil end
  return { Instance = best, Position = bp, Normal = v3(0, 1, 0), Distance = bt }
end
camera.Parent = ws
ws.CurrentCamera = camera
local terrain = make("Terrain")
terrain._p.Name = "Terrain"
terrain.Parent = ws
R.terrain = terrain
R.services.Workspace = ws
R.workspace = ws

R.services.ReplicatedStorage = service("ReplicatedStorage", {})
R.services.ServerStorage = service("ServerStorage", {})
R.services.ServerScriptService = service("ServerScriptService", {})
R.services.Lighting = service("Lighting", {
  ClockTime = { T.number, 14 }, Brightness = { T.number, 2 }, GlobalShadows = { T.bool, true }, OutdoorAmbient = { T.Color3, newC3(0.5, 0.5, 0.5) },
  Ambient = { T.Color3, newC3(0, 0, 0) }, EnvironmentDiffuseScale = { T.number, 0 }, EnvironmentSpecularScale = { T.number, 0 }, ExposureCompensation = { T.number, 0 },
})
R.services.ProximityPromptService = service("ProximityPromptService", { Enabled = { T.bool, true } }, { events = { PromptTriggered = true } })
R.Heartbeat = newSig()
R.RenderStepped = newSig()
R.services.RunService = service("RunService", {}, { ro = {
  Heartbeat = function() return R.Heartbeat end,
  RenderStepped = function()
    if side() ~= "client" then error("RenderStepped 只能在客户端用", 3) end
    return R.RenderStepped
  end,
}, methods = { IsStudio = function() return true end, IsServer = function() return side() == "server" end, IsClient = function() return side() == "client" end } })
R.services.Debris = service("Debris", {}, { methods = { AddItem = function(_, inst, t)
  if typeof(inst) ~= "Instance" or type(t) ~= "number" then error("Debris:AddItem(Instance, 秒数)", 2) end
  task.delay(t, function() base.Destroy(inst) end)
end } })
R.services.TweenService = service("TweenService", {}, { methods = { Create = function(_, inst, info, props)
  if typeof(inst) ~= "Instance" or typeof(info) ~= "TweenInfo" or type(props) ~= "table" then error("TweenService:Create(Instance, TweenInfo, 表)", 2) end
  local tw = { Completed = newSig() }
  function tw.Play()
    for k, v in pairs(props) do inst[k] = v end   -- 直接跳到终点（顺便检查属性名和类型）
  end
  function tw.Cancel() end
  return setmetatable(tw, { __type = "Tween" })
end } })
R.services.CollectionService = service("CollectionService", {}, { methods = {
  AddTag = function(_, inst, tag)
    if typeof(inst) ~= "Instance" or type(tag) ~= "string" then error("AddTag(Instance, 字符串)", 2) end
    tags[tag] = tags[tag] or {}
    tags[tag][inst] = true
  end,
  GetTagged = function(_, tag)
    local out = {}
    for inst in pairs(tags[tag] or {}) do out[#out + 1] = inst end
    return out
  end,
} })
R.keys = {}
R.services.UserInputService = service("UserInputService", { MouseBehavior = { E("MouseBehavior"), Enum.MouseBehavior.Default } }, {
  events = { InputBegan = true, InputEnded = true, InputChanged = true, TouchTap = true, TouchPan = true, TouchPinch = true },
  ro = { TouchEnabled = false, KeyboardEnabled = true, MouseEnabled = true },
  methods = {
    IsKeyDown = function(_, kc)
      if typeof(kc) ~= "EnumItem" or kc.EnumType ~= "KeyCode" then error("IsKeyDown 要 Enum.KeyCode", 2) end
      return R.keys[kc.Name] == true
    end,
    GetMouseLocation = function() return newV2(640, 400) end,
    GetFocusedTextBox = function() return nil end,
  },
})

-- 存档：一张表；R.dsFail 为真时读写都报错（模拟 Studio 没开 API）
R.store = {}
R.services.DataStoreService = service("DataStoreService", {}, { methods = { GetDataStore = function(_, name)
  if side() ~= "server" then error("DataStore 只能在服务器用", 2) end
  if type(name) ~= "string" then error("GetDataStore 要名字", 2) end
  local ds = {}
  function ds.GetAsync(self, key)
    if self ~= ds then error("GetAsync 要用冒号调用", 2) end
    task.wait(0.1)
    if R.dsFail then error("模拟：DataStore 不可用") end
    local v = R.store[name .. "/" .. key]
    if v == nil then return nil end
    return ser(v, {}, key, true)
  end
  function ds.SetAsync(self, key, value)
    if self ~= ds then error("SetAsync 要用冒号调用", 2) end
    if type(key) ~= "string" then error("SetAsync 键要字符串", 2) end
    task.wait(0.1)
    if R.dsFail then error("模拟：DataStore 不可用") end
    R.store[name .. "/" .. key] = ser(value, {}, key, true)
    R.saves = (R.saves or 0) + 1
  end
  function ds.UpdateAsync(self, key, f)
    if self ~= ds then error("UpdateAsync 要用冒号调用", 2) end
    task.wait(0.1)
    if R.dsFail then error("模拟：DataStore 不可用") end
    local k = name .. "/" .. key
    local new = f(R.store[k] ~= nil and ser(R.store[k], {}, key, true) or nil)
    if new ~= nil then R.store[k] = ser(new, {}, key, true) end
    return new
  end
  return ds
end, GetOrderedDataStore = function(_, name)
  if side() ~= "server" then error("DataStore 只能在服务器用", 2) end
  R.ordered = R.ordered or {}
  R.ordered[name] = R.ordered[name] or {}
  local T = R.ordered[name]
  local ods = {}
  function ods.SetAsync(self, key, v)
    if self ~= ods then error("SetAsync 要用冒号调用", 2) end
    if type(v) ~= "number" or v ~= math.floor(v) then error("有序存档只能存整数", 2) end
    task.wait(0.05)
    if R.dsFail then error("模拟：DataStore 不可用") end
    T[key] = v
  end
  function ods.GetAsync(self, key)
    task.wait(0.05)
    return T[key]
  end
  function ods.GetSortedAsync(self, asc, size, lo, hi)
    if self ~= ods then error("GetSortedAsync 要用冒号调用", 2) end
    if type(asc) ~= "boolean" or type(size) ~= "number" or size > 100 then error("GetSortedAsync(是否升序, 每页数量 ≤ 100, 最小, 最大)", 2) end
    task.wait(0.05)
    if R.dsFail then error("模拟：DataStore 不可用") end
    local list = {}
    for k, v in pairs(T) do
      if (lo == nil or v >= lo) and (hi == nil or v <= hi) then table.insert(list, { key = k, value = v }) end
    end
    table.sort(list, function(a, b) if asc then return a.value < b.value end return a.value > b.value end)
    while #list > size do table.remove(list) end
    return { GetCurrentPage = function() return list end, IsFinished = true }
  end
  return ods
end } })

-- 内存存储（跨服务器排队用的有序映射）：R.mem[名字][键] = { v = 值, exp = 过期时刻（模拟时钟）}；R.memFail 为真时读写都报错
R.mem = {}
R.services.MemoryStoreService = service("MemoryStoreService", {}, { methods = { GetSortedMap = function(_, name)
  if side() ~= "server" then error("MemoryStore 只能在服务器用", 2) end
  if type(name) ~= "string" then error("GetSortedMap 要名字", 2) end
  R.mem[name] = R.mem[name] or {}
  local T = R.mem[name]
  local m = {}
  local function live(k)
    local e = T[k]
    if e and e.exp <= clock then
      T[k] = nil
      e = nil
    end
    return e
  end
  local function chk(self, key, f)
    if self ~= m then error(f .. " 要用冒号调用", 3) end
    if type(key) ~= "string" then error(f .. " 的键要字符串", 3) end
    task.wait(0.02)
    if R.memFail then error("模拟：MemoryStore 不可用") end
  end
  local function chkExp(exp, f)
    if type(exp) ~= "number" or exp <= 0 or exp > 3888000 then error(f .. " 要过期秒数（1–3888000）", 3) end
  end
  function m.SetAsync(self, key, value, exp)
    chk(self, key, "SetAsync")
    chkExp(exp, "SetAsync")
    T[key] = { v = ser(value, {}, key, true), exp = clock + exp }
    return true
  end
  function m.GetAsync(self, key)
    chk(self, key, "GetAsync")
    local e = live(key)
    return e and ser(e.v, {}, key, true) or nil
  end
  function m.RemoveAsync(self, key)
    chk(self, key, "RemoveAsync")
    T[key] = nil
  end
  function m.UpdateAsync(self, key, f, exp)
    chk(self, key, "UpdateAsync")
    if type(f) ~= "function" then error("UpdateAsync 第二个参数要函数", 2) end
    chkExp(exp, "UpdateAsync")
    local e = live(key)
    local new = f(e and ser(e.v, {}, key, true) or nil)
    if new == nil then return nil end
    T[key] = { v = ser(new, {}, key, true), exp = clock + exp }
    return ser(new, {}, key, true)
  end
  function m.GetRangeAsync(self, dir, count)
    if self ~= m then error("GetRangeAsync 要用冒号调用", 2) end
    if typeof(dir) ~= "EnumItem" or dir.EnumType ~= "SortDirection" or type(count) ~= "number" or count < 1 or count > 200 then
      error("GetRangeAsync(Enum.SortDirection, 1–200 个)", 2)
    end
    task.wait(0.02)
    if R.memFail then error("模拟：MemoryStore 不可用") end
    local keys = {}
    for k in pairs(T) do if live(k) then keys[#keys + 1] = k end end
    table.sort(keys, function(a, b) if dir.Name == "Descending" then return a > b end return a < b end)
    local out = {}
    for _, k in ipairs(keys) do
      if #out >= count then break end
      out[#out + 1] = { key = k, value = ser(T[k].v, {}, k, true) }
    end
    return out
  end
  return m
end } })

-- 跨服务器消息：本服务器的订阅者都收得到（自己发的也收得到，和真的一样）；R.deliver(主题, 数据) 模拟别的服务器发来的
R.subs, R.published = {}, {}
function R.deliver(topic, data)
  for _, cb in ipairs(R.subs[topic] or {}) do
    local co = newThread(function() cb({ Data = data, Sent = os.time() }) end, "server")
    table.insert(queue, { co = co, at = clock, args = table.pack() })
  end
end
R.services.MessagingService = service("MessagingService", {}, { methods = {
  PublishAsync = function(_, topic, data)
    if side() ~= "server" then error("MessagingService 只能在服务器用", 2) end
    if type(topic) ~= "string" then error("PublishAsync 要主题", 2) end
    local d = ser(data, {}, topic, true)
    task.wait(0.02)
    if R.msgFail then error("模拟：MessagingService 不可用") end
    table.insert(R.published, { topic = topic, data = d })
    R.deliver(topic, d)
  end,
  SubscribeAsync = function(_, topic, cb)
    if side() ~= "server" then error("MessagingService 只能在服务器用", 2) end
    if type(topic) ~= "string" or type(cb) ~= "function" then error("SubscribeAsync(主题, 函数)", 2) end
    if R.msgHang then task.wait(1e9) end   -- 模拟 Studio 里没发布的游戏：一直等网络，不返回
    task.wait(0.02)
    if R.msgFail then error("模拟：MessagingService 不可用") end
    R.subs[topic] = R.subs[topic] or {}
    table.insert(R.subs[topic], cb)
    return { Disconnect = function() end }
  end,
} })

-- 传送：ReserveServer 给一个预留服务器的访问码；TeleportAsync 记到 R.teleports，玩家随后离开这个服务器；R.tpFail 为真时报错（像 Studio 里）
def("TeleportOptions", "Instance", { ReservedServerAccessCode = { T.string, "" }, ServerInstanceId = { T.string, "" }, ShouldReserveServer = { T.bool, false } }, { methods = {
  SetTeleportData = function(o, d) rawset(o, "_td", ser(d, {}, "TeleportData", true)) end,
  GetTeleportData = function(o) return rawget(o, "_td") end,
} })
R.teleports = {}
local reserveN = 0
R.services.TeleportService = service("TeleportService", {}, { events = { TeleportInitFailed = true }, methods = {
  ReserveServer = function(_, placeId)
    if side() ~= "server" then error("TeleportService 只能在服务器用", 2) end
    if type(placeId) ~= "number" then error("ReserveServer 要 PlaceId", 2) end
    task.wait(0.05)
    if R.tpFail then error("模拟：Studio 里不能传送") end
    reserveN = reserveN + 1
    return "rsv-" .. reserveN, "ps-" .. reserveN
  end,
  TeleportAsync = function(_, placeId, players, opts)
    if side() ~= "server" then error("TeleportService 只能在服务器用", 2) end
    if type(placeId) ~= "number" or type(players) ~= "table" or #players == 0 then error("TeleportAsync(PlaceId, {玩家}, TeleportOptions?)", 2) end
    if opts ~= nil and (typeof(opts) ~= "Instance" or opts._cls ~= "TeleportOptions") then error("TeleportAsync 第三个参数要 TeleportOptions", 2) end
    local ids = {}
    for _, p in ipairs(players) do
      if typeof(p) ~= "Instance" or p._cls ~= "Player" then error("TeleportAsync 的玩家列表里要 Player", 2) end
      ids[#ids + 1] = p._uid
    end
    task.wait(0.05)
    if R.tpFail then error("模拟：Studio 里不能传送") end
    table.insert(R.teleports, { place = placeId, ids = ids, code = opts and opts._p.ReservedServerAccessCode or "", data = opts and rawget(opts, "_td") or nil, t = clock })
    for _, p in ipairs(players) do
      task.delay(0.3, function() if p.Parent then R.leave(p) end end)
    end
    return {}
  end,
} })

-- 玩家
R.services.Players = service("Players", { CharacterAutoLoads = { T.bool, true } }, {
  events = { PlayerAdded = true, PlayerRemoving = true },
  ro = { LocalPlayer = function() if side() == "client" then return R.localPlayer end return nil end, MaxPlayers = 6 },
  methods = {
    GetPlayers = function(o)
      local out = {}
      for _, c in ipairs(o._kids) do if c._cls == "Player" then out[#out + 1] = c end end
      return out
    end,
    GetPlayerByUserId = function(o, id)
      for _, c in ipairs(o._kids) do
        if c._cls == "Player" and c._uid == id then return c end
      end
      return nil
    end,
    GetNameFromUserIdAsync = function(_, id)
      task.wait(0.05)
      return "Name" .. tostring(id)
    end,
    GetPlayerFromCharacter = function(o, char)
      for _, c in ipairs(o._kids) do
        if c._cls == "Player" and char ~= nil and c._p.Character == char then return c end
      end
      return nil
    end,
  },
})
def("Player", "Instance", { Character = { T.Instance, nil } }, { noCreate = true, events = { CharacterAdded = true, CharacterRemoving = true }, ro = {
  UserId = function(o) return o._uid end, DisplayName = function(o) return o._p.Name end,
}, methods = {
  LoadCharacter = function(o)
    if side() ~= "server" then error("LoadCharacter 只能在服务器调用", 2) end
    if o._p.Character then base.Destroy(o._p.Character) end
    local ch = make("Model")
    ch._p.Name = o._p.Name
    local hrp = make("Part")
    hrp._p.Name = "HumanoidRootPart"
    hrp.Parent = ch
    local head = make("Part")
    head._p.Name = "Head"
    head._p.Size = v3(1, 1, 1)
    head.Parent = ch
    local hum = make("Humanoid")
    hum.Parent = ch
    ch.PrimaryPart = hrp
    hrp._p.CFrame = CFrame.new(0, 5, 0)
    head._p.CFrame = CFrame.new(0, 6.5, 0)
    ch.Parent = ws
    local bp = base.FindFirstChild(o, "Backpack")
    if bp then base.ClearAllChildren(bp) end
    o._p.Character = ch
    o.CharacterAdded:Fire(ch)
  end,
  Kick = function(o, msg) rawset(o, "_kicked", msg or "") end,
  -- 传送进来时带的数据（R.joinData[UserId]）
  GetJoinData = function(o)
    if side() ~= "server" then error("GetJoinData 只能在服务器调用", 2) end
    local td = R.joinData and R.joinData[o._uid]
    return { TeleportData = td and ser(td, {}, "TeleportData", true) or nil, SourcePlaceId = td and (R.placeId or 1234) or nil }
  end,
  GetMouse = function(o)
    if side() ~= "client" then error("GetMouse 只能在客户端用", 2) end
    R.mouse = R.mouse or { Hit = CFrame.new(0, 0, -100), TargetFilter = nil }
    return R.mouse
  end,
} })
def("PlayerGui", "Instance", {}, { noCreate = true })
def("PlayerScripts", "Instance", {}, { noCreate = true })

function R.addPlayer(name, uid)
  local pl = make("Player")
  pl._p.Name = name
  rawset(pl, "_uid", uid)
  local pg = make("PlayerGui")
  pg._p.Name = "PlayerGui"
  pg.Parent = pl
  local bp = make("Backpack")
  bp._p.Name = "Backpack"
  bp.Parent = pl
  local ps = make("PlayerScripts")
  ps._p.Name = "PlayerScripts"
  ps.Parent = pl
  -- 默认的 PlayerModule（GetControls 返回能 Enable / Disable 的东西）
  local pm = make("ModuleScript")
  pm._p.Name = "PlayerModule"
  pm.Source = "return { GetControls = function(self) return { Enable = function() end, Disable = function() end, GetMoveVector = function() return MOCK_MOVE() end } end }"
  pm.Parent = ps
  pl.Parent = R.services.Players
  return pl
end
function R.removePlayer(pl)
  R.services.Players.PlayerRemoving:Fire(pl)
  R.step(1 / 60)
  if pl._p.Character then base.Destroy(pl._p.Character) end
  setParent(pl, nil)
end
-- 在脚本线程里离开（传送走）：不推进时钟
function R.leave(pl)
  R.services.Players.PlayerRemoving:Fire(pl)
  task.defer(function()
    if pl._p.Character then base.Destroy(pl._p.Character) end
    setParent(pl, nil)
    if R.localPlayer == pl then R.localPlayer = nil end
  end)
end

------------------------------------------------------------ 跑脚本

local function luauMath()
  local m = {}
  for k, v in pairs(math) do m[k] = v end
  m.clamp = function(x, lo, hi)
    if type(x) ~= "number" or type(lo) ~= "number" or type(hi) ~= "number" then error("math.clamp 参数要数字", 2) end
    if lo > hi then error("math.clamp：max 必须 >= min", 2) end
    return math.max(lo, math.min(hi, x))
  end
  m.atan2 = function(y, x) return math.atan(y, x) end
  m.random = function(a, b)
    if a == nil then return R.rng() end
    if b == nil then return math.floor(R.rng() * a) + 1 end
    return a + math.floor(R.rng() * (b - a + 1))
  end
  return m
end
do
  local s = 12345
  R.rng = function()
    s = (s * 16807) % 2147483647
    return s / 2147483647
  end
end

local modules = {}
local function envFor(scriptInst, sd)
  local env = {
    game = game, workspace = ws, script = scriptInst, Instance = Instance, Vector3 = Vector3, Vector2 = Vector2, CFrame = CFrame,
    Color3 = Color3, UDim = UDim, UDim2 = UDim2, Enum = Enum, TweenInfo = TweenInfo, RaycastParams = RaycastParams, Random = Random,
    task = task, math = luauMath(), string = string, table = table, os = { time = function() return R.osTime or os.time() end, clock = function() return clock end },
    pairs = pairs, ipairs = ipairs, next = next, select = select, type = type, typeof = typeof, tostring = tostring, tonumber = tonumber,
    print = function(...) if R.verbose then print(...) end end,
    PROBE_SET = function(v) R.lastProbe = v end,
    warn = function(...)
      local parts = {}
      for i = 1, select("#", ...) do parts[#parts + 1] = tostring(select(i, ...)) end
      table.insert(R.warns, table.concat(parts, " "))
    end,
    error = error, assert = assert, pcall = pcall, xpcall = xpcall, setmetatable = setmetatable, getmetatable = getmetatable,
    rawget = rawget, rawset = rawset, rawequal = rawequal, unpack = table.unpack,
    MOCK_MOVE = function() R.moveCalls = (R.moveCalls or 0) + 1 return R.moveVec or v3(0, 0, 0) end,
  }
  env.require = function(ms)
    if typeof(ms) ~= "Instance" or ms._cls ~= "ModuleScript" then error("require 要 ModuleScript，实际 " .. typeof(ms), 2) end
    if modules[ms] == nil then
      local f, err = load(ms.Source, "@" .. (rawget(ms, "_path") or ms._p.Name), "t", envFor(ms, sd))
      if not f then error("模块编译失败：" .. err, 2) end
      local r = f()
      if r == nil then error("模块没有返回值：" .. ms._p.Name, 2) end
      modules[ms] = r
    end
    return modules[ms]
  end
  return env
end

-- 新建脚本实例（源码从文件读）
function R.scriptFrom(cls, name, path, parent)
  local f = assert(io.open(path, "r"))
  local src = f:read("a")
  f:close()
  local s = make(cls)
  s._p.Name = name
  s.Source = src
  rawset(s, "_path", path)
  s.Parent = parent
  return s
end

-- 测试脚本里 require 一个模块（和服务器共用同一份）
function R.require(ms) return envFor(ms, "server").require(ms) end

function R.runScript(s, sd)
  local f, err = load(s.Source, "@" .. (rawget(s, "_path") or s._p.Name), "t", envFor(s, sd))
  if not f then
    report("编译失败：" .. err)
    return
  end
  local co = newThread(f, sd)
  resume(co)
end

------------------------------------------------------------ 推进时间

function R.step(dt)
  clock = clock + dt
  if R.localPlayer then
    local co = newThread(function() R.RenderStepped:Fire(dt) end, "client")
    resume(co)
  end
  local co = newThread(function() R.Heartbeat:Fire(dt) end, "server")
  resume(co)
  for _ = 1, 50 do
    local due, rest = {}, {}
    for _, q in ipairs(queue) do
      if q.at <= clock then due[#due + 1] = q else rest[#rest + 1] = q end
    end
    if #due == 0 then break end
    queue = rest
    table.sort(due, function(a, b) return a.at < b.at end)
    for _, q in ipairs(due) do resume(q.co, unpack(q.args, 1, q.args.n)) end
  end
end
function R.run(seconds, dt)
  dt = dt or 1 / 30
  local n = math.max(1, math.floor(seconds / dt + 0.5))
  for _ = 1, n do R.step(dt) end
end

-- 在指定一边（"server" / "client"）的线程里跑 f
function R.as(sd, f, ...)
  local co = newThread(f, sd)
  resume(co, ...)
end

R.game = game
R.Enum = Enum
R.Vector3 = Vector3
R.Vector2 = Vector2
R.CFrame = CFrame
R.base = base
return R
