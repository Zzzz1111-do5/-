-- 军事大亨：真人对战（排位）
--   服内快速匹配：同一个服务器里两个人都在排队，直接在本服的竞技场开打；
--   跨服匹配：排队的人写进 MemoryStore 的有序映射（每 10 秒刷新，60 秒过期），每个服务器每 3 秒看一遍：
--     积分差在窗口内（等得越久窗口越大）、在别的服务器、还没被认领的，userId 小的一方发起——先认领自己、再认领对方（UpdateAsync，谁先改到算谁的），
--     预留一个对战服务器（ReserveServer），把访问码写进对方的记录、再用 MessagingService 通知对方的服务器，两边各自存档后传送过去；
--   对战服务器（预留服务器：PrivateServerId 不空、PrivateServerOwnerId 为 0）：两个人都到了 5 秒后自动开打，打完记对战积分，8 秒后传送回普通服务器；
--     对手 75 秒还没来就把先到的人送回去（积分不变）。
-- 所有 MemoryStore / MessagingService / TeleportService 调用都包在 pcall 里（Studio 里传送不了：服内匹配照样能用）
local Players = game:GetService("Players")
local MSS = game:GetService("MemoryStoreService")
local MS = game:GetService("MessagingService")
local TS = game:GetService("TeleportService")

local Match = {}

function Match.init(G)
  local Config = G.Config
  local MC = Config.Match
  local TOPIC = "mt_match_v1"
  local inMatch = game.PrivateServerId ~= "" and game.PrivateServerOwnerId == 0
  G.matchServer = inMatch

  local map = nil
  do
    local ok, res = pcall(function() return MSS:GetSortedMap("mt_match_v1") end)
    if ok then map = res else warn("[军事大亨] MemoryStore 不可用，只能服内匹配：" .. tostring(res)) end
  end

  local queue = {}   -- [st] = { t0 = 开始排队的时刻, key = "u123", entryT = 上次写记录的时刻 }
  G.matchQueue = queue

  local function keyOf(uid)
    return "u" .. tostring(uid)
  end
  local function entryOf(st)
    return { u = st.pl.UserId, r = st.data.pvp, n = st.pl.DisplayName, job = game.JobId, t = os.time() }
  end
  local function windowOf(q)
    return math.min(MC.maxWindow, MC.window + MC.widen * (os.clock() - q.t0))
  end
  function G.matchInfo(st)
    local q = queue[st]
    if not q then return nil end
    return { since = math.floor(os.clock() - q.t0), window = math.floor(windowOf(q)) }
  end

  local function canQueue(st)
    return G.states[st.pl] == st and st.ready and not st.battle and not st.busy and not st.teleporting and G.count(st) > 0
  end

  -- 写 / 刷新自己的排队记录（被别人认领了就不动它）
  local function publish(st, q)
    if not map then return end
    local ok, err = pcall(function()
      map:UpdateAsync(q.key, function(old)
        if type(old) == "table" and old.claimed then return nil end
        return entryOf(st)
      end, MC.expire)
    end)
    if ok then q.entryT = os.clock() else warn("[军事大亨] 写排队记录失败：" .. tostring(err)) end
  end
  local function release(key, by)
    if not map then return end
    pcall(function()
      map:UpdateAsync(key, function(old)
        if type(old) == "table" and old.claimed == by then
          old.claimed, old.code = nil, nil
          return old
        end
        return nil
      end, MC.expire)
    end)
  end
  local function drop(key)
    if map then pcall(function() map:RemoveAsync(key) end) end
  end

  -- 传送到对战服务器（先存档：对战服务器读的就是这份）
  local function go(st, code, a, b)
    local q = queue[st]
    queue[st] = nil
    if q then task.spawn(drop, q.key) end
    if G.states[st.pl] ~= st or st.battle then return end
    st.teleporting = true
    G.push(st)
    G.save(st)
    local opts = Instance.new("TeleportOptions")
    opts.ReservedServerAccessCode = code
    opts:SetTeleportData({ mode = "match", a = a, b = b })
    local ok, err = pcall(function() TS:TeleportAsync(game.PlaceId, { st.pl }, opts) end)
    if not ok then
      st.teleporting = false
      G.toast(st, "传送失败：" .. tostring(err), "bad")
      G.push(st)
    end
  end

  -- 发起跨服对战：先认领自己，再认领对方，预留服务器，通知对方，自己传过去
  local function initiate(st, q, v)
    local me = st.pl.UserId
    local ok1, mine = pcall(function()
      return map:UpdateAsync(q.key, function(old)
        if type(old) == "table" and old.claimed then return nil end
        local e = entryOf(st)
        e.claimed = me
        return e
      end, MC.expire)
    end)
    if not ok1 or type(mine) ~= "table" or mine.claimed ~= me then return end
    local okey = keyOf(v.u)
    local ok2, theirs = pcall(function()
      return map:UpdateAsync(okey, function(old)
        if type(old) ~= "table" or old.claimed then return nil end
        old.claimed = me
        return old
      end, MC.expire)
    end)
    if not ok2 or type(theirs) ~= "table" then
      release(q.key, me)
      return
    end
    local ok3, code = pcall(function() return TS:ReserveServer(game.PlaceId) end)
    if not ok3 or type(code) ~= "string" then
      warn("[军事大亨] 预留对战服务器失败：" .. tostring(code))
      release(q.key, me)
      release(okey, me)
      return
    end
    if queue[st] ~= q or not canQueue(st) then   -- 预留的这一会儿玩家取消了 / 开打了：放开对方，让他配别人
      release(okey, me)
      return
    end
    -- 访问码写进对方的记录（消息丢了，对方的服务器下一轮也能自己看到），再发消息
    pcall(function()
      map:UpdateAsync(okey, function(old)
        if type(old) == "table" and old.claimed == me then
          old.code, old.a, old.b = code, me, v.u
          return old
        end
        return nil
      end, MC.expire)
    end)
    pcall(function() MS:PublishAsync(TOPIC, { to = v.u, code = code, a = me, b = v.u, an = st.pl.DisplayName, ar = st.data.pvp }) end)
    G.toast(st, "找到对手：" .. tostring(v.n) .. "（对战积分 " .. tostring(v.r) .. "）！传送到对战服务器……", "good")
    go(st, code, me, v.u)
  end

  -- 服内两个人：直接在本服竞技场打排位
  local function startLocal(a, b)
    queue[a], queue[b] = nil, nil
    task.spawn(drop, keyOf(a.pl.UserId))
    task.spawn(drop, keyOf(b.pl.UserId))
    G.toast(a, "找到对手：" .. b.pl.DisplayName .. "（同一个服务器）！", "good")
    G.toast(b, "找到对手：" .. a.pl.DisplayName .. "（同一个服务器）！", "good")
    if not G.startDuel(a, b, true) then   -- 竞技场都在用：放回队里
      queue[a] = { t0 = os.clock(), key = keyOf(a.pl.UserId), entryT = -100 }
      queue[b] = { t0 = os.clock(), key = keyOf(b.pl.UserId), entryT = -100 }
    end
  end

  local function cycle()
    local ready = {}
    for st in pairs(queue) do
      if canQueue(st) then table.insert(ready, st) end
    end
    table.sort(ready, function(x, y) return queue[x].t0 < queue[y].t0 end)
    -- 1）服内：先到先配，挑积分最接近的
    while #ready >= 2 do
      local a = table.remove(ready, 1)
      local bi, bd = 1, math.huge
      for i, b in ipairs(ready) do
        local d = math.abs(a.data.pvp - b.data.pvp)
        if d < bd then bi, bd = i, d end
      end
      startLocal(a, table.remove(ready, bi))
    end
    -- 2）跨服
    if not map or #ready == 0 then return end
    local ok, items = pcall(function() return map:GetRangeAsync(Enum.SortDirection.Ascending, 100) end)
    if not ok or type(items) ~= "table" then return end
    for _, st in ipairs(ready) do
      local q = queue[st]
      if q and canQueue(st) then
        local mine = nil
        for _, it in ipairs(items) do
          if it.key == q.key then mine = it.value end
        end
        if type(mine) == "table" and mine.claimed and mine.claimed ~= st.pl.UserId then
          if mine.code then go(st, mine.code, mine.a, mine.b) end   -- 别的服务器认领了我（消息没收到）：自己按记录传过去
        else
          if type(mine) ~= "table" or os.clock() - q.entryT > MC.refresh then publish(st, q) end
          local me, win = st.pl.UserId, windowOf(q)
          local best, bd = nil, math.huge
          for _, it in ipairs(items) do
            local v = it.value
            if type(v) == "table" and type(v.u) == "number" and v.u > me and v.job ~= game.JobId and not v.claimed then
              local d = math.abs((tonumber(v.r) or MC.start) - st.data.pvp)
              if d <= win and d < bd then best, bd = v, d end
            end
          end
          if best then initiate(st, q, best) end
        end
      end
    end
  end

  function G.matchJoin(st)
    if inMatch or queue[st] or not st.ready then return end
    if st.battle then
      G.toast(st, "打完这一仗再匹配", "info")
      return
    end
    if G.count(st) == 0 then
      G.toast(st, "还没有部队：先造兵再来对战", "bad")
      return
    end
    queue[st] = { t0 = os.clock(), key = keyOf(st.pl.UserId), entryT = -100 }
    G.toast(st, "开始匹配真人对手：先找同服务器的，再找全服积分差不多的", "info")
    G.push(st)
  end

  -- why：给了就是被动取消（开始打关卡、离开服务器），提示一句原因
  function G.matchCancel(st, why)
    local q = queue[st]
    if not q then return end
    queue[st] = nil
    task.spawn(drop, q.key)
    if why ~= true and G.states[st.pl] == st then
      G.toast(st, why or "取消了匹配", "info")
      G.push(st)
    end
  end

  if not inMatch then
    -- 订阅要等网络回话（Studio 里没发布的游戏可能一直等）：放到后台，别卡住开服
    task.spawn(function()
      local ok, err = pcall(function()
        MS:SubscribeAsync(TOPIC, function(msg)
          local d = type(msg) == "table" and msg.Data
          if type(d) ~= "table" or type(d.to) ~= "number" or type(d.code) ~= "string" then return end
          local pl = Players:GetPlayerByUserId(d.to)
          local st = pl and G.states[pl]
          if not st or not queue[st] then return end
          G.toast(st, "找到对手：" .. tostring(d.an) .. "（对战积分 " .. tostring(d.ar) .. "）！传送到对战服务器……", "good")
          go(st, d.code, d.a, d.b)
        end)
      end)
      if not ok then warn("[军事大亨] MessagingService 不可用（跨服通知收不到，匹配表里的访问码照样能用）：" .. tostring(err)) end
    end)
    task.spawn(function()
      while true do
        task.wait(MC.tick)
        if next(queue) then
          local ok, err = pcall(cycle)
          if not ok then warn("[军事大亨] 匹配出错：" .. tostring(err)) end
        end
      end
    end)
  end

  TS.TeleportInitFailed:Connect(function(pl, _, msg)
    local st = G.states[pl]
    if st and st.teleporting then
      st.teleporting = false
      G.toast(st, "传送失败：" .. tostring(msg), "bad")
      G.push(st)
    end
  end)

  ---------------------------------------------------------------- 对战服务器

  -- 送回普通服务器（随便哪个，进去以后读存档、照样是自己的基地）
  local function sendBack(st)
    if G.states[st.pl] ~= st or st.teleporting then return end
    st.teleporting = true
    G.save(st)
    local ok, err = pcall(function() TS:TeleportAsync(game.PlaceId, { st.pl }) end)
    if not ok then
      st.teleporting = false
      G.toast(st, "传送回去失败（" .. tostring(err) .. "），可以直接退出再进游戏", "bad")
    end
  end
  G.matchSendBack = sendBack

  local M = nil        -- 这一场：{ a, b, t0, started }
  local arrived = {}   -- userId → st
  local function tryStart()
    if not M or M.started then return end
    local sa, sb = arrived[M.a], arrived[M.b]
    if not (sa and sb and G.states[sa.pl] == sa and G.states[sb.pl] == sb) then return end
    M.started = true
    for _, st in ipairs({ sa, sb }) do G.toast(st, "对手到了！" .. MC.countdown .. " 秒后开打（排位对战：赢了涨对战积分，部队不会损失）", "good") end
    task.delay(MC.countdown, function()
      local okA, okB = G.states[sa.pl] == sa, G.states[sb.pl] == sb
      if okA and okB and G.startDuel(sa, sb, true) then return end
      for _, st in ipairs({ sa, sb }) do
        if G.states[st.pl] == st then
          G.toast(st, "对手走了，这一场不算，送你回去", "info")
          sendBack(st)
        end
      end
    end)
  end

  -- 进服读完档以后调：对战服务器里认人、到齐开打；普通服务器什么都不做
  function G.matchArrive(st)
    if not inMatch then return end
    local ok, jd = pcall(function() return st.pl:GetJoinData() end)
    local td = ok and type(jd) == "table" and jd.TeleportData or nil
    if type(td) ~= "table" or td.mode ~= "match" or (td.a ~= st.pl.UserId and td.b ~= st.pl.UserId) then
      G.toast(st, "这是对战服务器，送你回普通服务器", "info")
      task.delay(3, function() sendBack(st) end)
      return
    end
    if M and (td.a ~= M.a or td.b ~= M.b) then   -- 预留服务器只打一场：别的对局的人进错了
      G.toast(st, "这一场不是你的对局，送你回普通服务器", "info")
      task.delay(3, function() sendBack(st) end)
      return
    end
    arrived[st.pl.UserId] = st
    M = M or { a = td.a, b = td.b, t0 = os.clock(), started = false }
    if not M.started then G.toast(st, "进了对战服务器，等对手进场……", "info") end
    tryStart()
  end

  -- 对战打完（Combat 的 finish 调）：对战服务器里过几秒送回去
  function G.onDuelEnd(B)
    if not inMatch or not B.ranked then return end
    task.delay(MC.back, function()
      for _, st in pairs(B.sides or {}) do sendBack(st) end
    end)
  end

  if inMatch then
    task.spawn(function()
      while true do
        task.wait(2)
        if M and not M.started and os.clock() - M.t0 > MC.waitMax then
          M.started = true
          for _, st in pairs(arrived) do
            if G.states[st.pl] == st then
              G.toast(st, "对手没进来，这一场不算，送你回去（积分不变）", "info")
              sendBack(st)
            end
          end
        end
      end
    end)
  end
end

return Match
