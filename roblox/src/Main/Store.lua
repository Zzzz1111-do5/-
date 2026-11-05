-- 军事大亨：存档（DataStore）、突袭用的防线快照、积分匹配、排行榜、被突袭记录
-- 读档失败的玩家不存档（别拿新档盖掉老进度）；所有 DataStore 调用都包在 pcall 里（Studio 没开 API 访问时整个存档功能关掉，照样能玩）
local DSS = game:GetService("DataStoreService")
local Players = game:GetService("Players")

local Store = {}

function Store.init(G)
  local Config = G.Config
  local UNITS, BDEF = Config.Units, Config.BuildingById

  local function ds(name, ordered)
    local ok, res = pcall(function()
      if ordered then return DSS:GetOrderedDataStore(name) end
      return DSS:GetDataStore(name)
    end)
    if ok then return res end
    warn("[军事大亨] DataStore 不可用（" .. name .. "）：" .. tostring(res))
    return nil
  end
  local main = ds(Config.SaveKey)
  local defense = ds("MilitaryTycoon_def_v1")
  local raidlog = ds("MilitaryTycoon_raidlog_v1")
  local byRating = ds("MilitaryTycoon_rating_v1", true)
  local byLevel = ds("MilitaryTycoon_level_v1", true)

  function G.newData()
    return {
      cash = Config.StartCash, level = 1, best = 1, owned = {}, hq = 0, tech = 0, army = {}, wins = 0,
      rebirth = 0, xp = 0, kills = 0, weapons = { rifle = true }, rating = Config.Raid.start, raidWins = 0, duelWins = 0,
      daily = { day = 0, streak = 0 }, missions = { day = 0, list = {} },
    }
  end

  local function num(v, lo, hi, def)
    if type(v) ~= "number" or v ~= v then return def end
    if lo then v = math.max(lo, v) end
    if hi then v = math.min(hi, v) end
    return v
  end

  -- 读到的存档逐项检查（坏数据、老版本的存档、改过的配置都别让脚本出错）
  function G.cleanData(raw)
    local d = G.newData()
    if type(raw) ~= "table" then return d end
    d.cash = num(raw.cash, 0, nil, d.cash)
    d.level = math.floor(num(raw.level, 1, nil, 1))
    d.best = math.max(d.level, math.floor(num(raw.best, 1, nil, 1)))
    d.wins = num(raw.wins, 0, nil, 0)
    d.tech = math.floor(num(raw.tech, 0, Config.Tech.max, 0))
    d.rebirth = math.floor(num(raw.rebirth, 0, nil, 0))
    d.xp = math.floor(num(raw.xp, 0, nil, 0))
    d.kills = math.floor(num(raw.kills, 0, nil, 0))
    d.rating = math.floor(num(raw.rating, 0, nil, Config.Raid.start))
    d.raidWins = math.floor(num(raw.raidWins, 0, nil, 0))
    d.duelWins = math.floor(num(raw.duelWins, 0, nil, 0))
    if type(raw.owned) == "table" then
      for id, v in pairs(raw.owned) do
        if BDEF[id] and v then d.owned[id] = true end
      end
    end
    d.hq = math.floor(num(raw.hq, 0, #BDEF.hq.cap, 0))
    if d.owned.hq then d.hq = math.max(1, d.hq) else d.hq = 0 end
    if type(raw.army) == "table" then
      for _, a in ipairs(raw.army) do
        if type(a) == "table" and UNITS[a.t] and not UNITS[a.t].boss and type(a.x) == "number" and type(a.z) == "number" then
          table.insert(d.army, { t = a.t, x = a.x, z = a.z })
        end
      end
    end
    if type(raw.weapons) == "table" then
      for id, v in pairs(raw.weapons) do
        if Config.Weapons[id] and v then d.weapons[id] = true end
      end
    end
    if type(raw.daily) == "table" then
      d.daily.day = math.floor(num(raw.daily.day, 0, nil, 0))
      d.daily.streak = math.floor(num(raw.daily.streak, 0, Config.Daily.max, 0))
    end
    if type(raw.missions) == "table" and type(raw.missions.list) == "table" then
      d.missions.day = math.floor(num(raw.missions.day, 0, nil, 0))
      for _, m in ipairs(raw.missions.list) do
        if type(m) == "table" and type(m.id) == "string" then
          table.insert(d.missions.list, { id = m.id, prog = num(m.prog, 0, nil, 0), claimed = m.claimed == true })
        end
      end
    end
    d.t = num(raw.t, 0, nil, nil)
    return d
  end

  local function armyList(st)
    local army = {}
    for _, u in pairs(st.units) do
      table.insert(army, { t = u.t, x = math.floor(u.sx * 10 + 0.5) / 10, z = math.floor(u.sz * 10 + 0.5) / 10 })
    end
    return army
  end

  local function serialize(st)
    local d = st.data
    local owned, weapons = {}, {}
    for id in pairs(d.owned) do owned[id] = true end
    for id in pairs(d.weapons) do weapons[id] = true end
    local ml = {}
    for _, m in ipairs(d.missions.list) do table.insert(ml, { id = m.id, prog = m.prog, claimed = m.claimed }) end
    return {
      v = 2, cash = math.floor(d.cash), level = d.level, best = d.best, owned = owned, hq = d.hq, tech = d.tech, army = armyList(st),
      wins = d.wins or 0, rebirth = d.rebirth, xp = d.xp, kills = d.kills, weapons = weapons, rating = d.rating,
      raidWins = d.raidWins, duelWins = d.duelWins, daily = { day = d.daily.day, streak = d.daily.streak },
      missions = { day = d.missions.day, list = ml }, t = os.time(),
    }
  end

  -- 存档；同时更新防线快照（别人突袭打的就是它）和排行榜
  function G.save(st)
    if not main or not st.canSave or not st.data then return end
    local data = serialize(st)
    local key = "u" .. st.pl.UserId
    local ok, err = pcall(function() main:SetAsync(key, data) end)
    if not ok then warn("[军事大亨] 存档失败：" .. tostring(err)) end
    if #data.army > 0 and defense then
      pcall(function()
        defense:SetAsync(key, { name = st.pl.DisplayName, level = data.level, tech = data.tech, rebirth = data.rebirth, rating = data.rating, army = data.army, t = data.t })
      end)
    end
    if byRating then pcall(function() byRating:SetAsync(key, math.floor(data.rating)) end) end
    if byLevel then pcall(function() byLevel:SetAsync(key, math.floor(data.best)) end) end
  end

  function G.loadData(pl)
    if not main then return nil, false end
    for _ = 1, 3 do
      local ok, res = pcall(function() return main:GetAsync("u" .. pl.UserId) end)
      if ok then return res, true end
      warn("[军事大亨] 读档失败：" .. tostring(res))
      task.wait(1.5)
    end
    return nil, false
  end

  -- 突袭找对手：积分差不多的玩家里随机挑一个（不在线也行），读他的防线快照；找不到返回 nil（调用方换成 AI 指挥官）
  function G.findOpponent(st)
    if not byRating or not defense then return nil end
    local r = st.data.rating
    local R = Config.Raid.range
    local ok, page = pcall(function() return byRating:GetSortedAsync(false, 50, math.max(0, r - R), r + R) end)
    if not ok or not page then return nil end
    local list = {}
    local ok2, items = pcall(function() return page:GetCurrentPage() end)
    if not ok2 or type(items) ~= "table" then return nil end
    for _, it in ipairs(items) do
      if it.key ~= "u" .. st.pl.UserId then table.insert(list, it.key) end
    end
    for _ = 1, 3 do
      if #list == 0 then return nil end
      local k = table.remove(list, math.random(1, #list))
      local ok3, snap = pcall(function() return defense:GetAsync(k) end)
      if ok3 and type(snap) == "table" and type(snap.army) == "table" and #snap.army >= Config.Raid.minUnits then
        local army = {}
        for _, a in ipairs(snap.army) do
          if type(a) == "table" and UNITS[a.t] and not UNITS[a.t].boss and type(a.x) == "number" and type(a.z) == "number" then
            table.insert(army, { t = a.t, x = a.x, z = a.z })
          end
          if #army >= Config.MaxEnemy then break end
        end
        if #army > 0 then
          return {
            key = k, name = tostring(snap.name or "某位指挥官"), level = math.floor(num(snap.level, 1, nil, 1)),
            tech = math.floor(num(snap.tech, 0, Config.Tech.max, 0)), rebirth = math.floor(num(snap.rebirth, 0, nil, 0)),
            rating = math.floor(num(snap.rating, 0, nil, Config.Raid.start)), army = army,
          }
        end
      end
    end
    return nil
  end

  -- 被突袭记录：记到防守方名下，他上线时看得到
  function G.logRaid(defKey, entry)
    if not raidlog or type(defKey) ~= "string" then return end
    task.spawn(function()
      pcall(function()
        raidlog:UpdateAsync(defKey, function(old)
          local list = type(old) == "table" and old or {}
          table.insert(list, 1, entry)
          while #list > 10 do table.remove(list) end
          return list
        end)
      end)
    end)
  end
  function G.readRaidLog(pl)
    if not raidlog then return nil end
    local key = "u" .. pl.UserId
    local ok, list = pcall(function() return raidlog:GetAsync(key) end)
    if not ok or type(list) ~= "table" or #list == 0 then return nil end
    pcall(function() raidlog:SetAsync(key, {}) end)
    return list
  end

  -- 排行榜：两个榜各取前 10（名字按 UserId 查，查过的记住）
  local names = {}
  local function nameOf(key)
    if names[key] then return names[key] end
    local id = tonumber(string.sub(key, 2))
    local n = "玩家" .. tostring(id or "?")
    if id then
      local ok, res = pcall(function() return Players:GetNameFromUserIdAsync(id) end)
      if ok and res then n = res end
    end
    names[key] = n
    return n
  end
  local function top(store)
    if not store then return {} end
    local ok, page = pcall(function() return store:GetSortedAsync(false, 10) end)
    if not ok or not page then return {} end
    local ok2, items = pcall(function() return page:GetCurrentPage() end)
    if not ok2 or type(items) ~= "table" then return {} end
    local out = {}
    for i, it in ipairs(items) do out[i] = { name = nameOf(it.key), value = it.value } end
    return out
  end
  function G.readBoards()
    return top(byLevel), top(byRating)
  end
  G.storeOK = main ~= nil
end

return Store
