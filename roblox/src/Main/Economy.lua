-- 军事大亨：经济与成长（建筑、购买按钮、收入、指挥部、军工科技、重生、经验与军衔、每日奖励、每日任务、武器商店）
local Players = game:GetService("Players")

local Economy = {}

function Economy.init(G)
  local Config, Models = G.Config, G.Models
  local V = Vector3.new
  local BDEF, UNITS = Config.BuildingById, Config.Units
  local GREEN, RED = Color3.fromRGB(70, 220, 100), Color3.fromRGB(225, 70, 60)

  function G.incomeOf(d)
    local inc = 0
    for id in pairs(d.owned) do
      local b = BDEF[id]
      if b and b.income then
        local v = b.income
        if b.kind == "factory" and d.owned.power then v = v * Config.PowerBoost end
        inc = inc + v
      end
    end
    return inc * (1 + Config.Rebirth.income * (d.rebirth or 0))
  end

  function G.capOf(d)
    if d.owned.hq and d.hq >= 1 then return BDEF.hq.cap[d.hq] or BDEF.hq.cap[1] end
    return Config.BaseCap
  end

  -- 我方部队的血量、伤害倍数（军工科技 × 重生）
  function G.powerOf(d)
    return (1 + Config.Tech.bonus * d.tech) * (1 + Config.Rebirth.power * (d.rebirth or 0))
  end

  function G.recalc(st)
    local d = st.data
    st.income = G.incomeOf(d)
    if st.hqLabel then st.hqLabel.Text = "指挥部 " .. string.rep("★", d.hq) .. "  部队上限 " .. G.capOf(d) end
    if st.hqPrompt then
      if d.hq < #BDEF.hq.cap then
        st.hqPrompt.ObjectText = "$" .. Config.Fmt(BDEF.hq.up[d.hq]) .. " → 上限 " .. BDEF.hq.cap[d.hq + 1]
      else
        st.hqPrompt.Enabled = false
      end
    end
  end

  local function buildingPos(plot, b)
    return plot.origin + V(b.x, 1, b.z)
  end
  G.buildingPos = buildingPos

  function G.placeBuilding(st, b, fresh)
    local m, body = Models.building(st.plot.Buildings, b, buildingPos(st.plot, b), st.plot.color)
    local top = b.size[2] / 2 + 5   -- 牌子的偏移是从主体零件中心算的：大约在楼顶上方
    if b.income then
      Models.sign(body, b.name .. "  <font color=\"#7CFC8A\">+" .. Config.Fmt(b.income) .. "/秒</font>", top, 20, 2.8, nil, 200)
    elseif b.kind == "mil" then
      Models.sign(body, b.name .. " · " .. Models.milDesc(b), top, 22, 2.8, nil, (b.id == "airbase") and 600 or 200)
      -- 走到旁边按 E：客户端打开兵工厂对应的页签（提示上的 Tab 属性）
      local pp = Instance.new("ProximityPrompt")
      pp.ActionText = "打开兵工厂"
      pp.ObjectText = b.name
      pp.HoldDuration = 0
      pp.MaxActivationDistance = 28
      pp.RequiresLineOfSight = false
      pp:SetAttribute("Tab", UNITS[b.units[1]].cat)
      pp.Parent = body
    elseif b.kind == "hq" then
      local _, label = Models.sign(body, "", top + 5, 24, 2.8, Color3.fromRGB(255, 220, 120), 240)
      st.hqLabel = label
      local pp = Instance.new("ProximityPrompt")
      pp.ActionText = "升级指挥部"
      pp.ObjectText = ""
      pp.HoldDuration = 0.4
      pp.MaxActivationDistance = 28
      pp.RequiresLineOfSight = false
      pp.Parent = body
      st.hqPrompt = pp
      pp.Triggered:Connect(function(who)
        if who == st.pl then G.upgradeHQ(st) end
      end)
    elseif b.kind == "power" then
      Models.sign(body, "发电厂 · 工厂收入 ×" .. Config.PowerBoost, top + 2, 20, 2.8, nil, 200)
    end
    if fresh then G.fx({ k = "build", p = buildingPos(st.plot, b), s = math.max(b.size[1], b.size[3]) }) end
    return m
  end

  -- 按钮颜色：买得起绿、买不起红（只在变的时候改，省得每秒同步）
  local function padColors(st)
    for _, p in pairs(st.pads) do
      local ok = st.data.cash >= p.b.price
      if p.ok ~= ok then
        p.ok = ok
        p.pad.Color = ok and GREEN or RED
      end
    end
  end

  -- 重新摆购买按钮：没盖、前置已经盖好的建筑才有
  function G.refreshPads(st)
    st.plot.Pads:ClearAllChildren()
    st.pads = {}
    local d = st.data
    for _, b in ipairs(Config.Buildings) do
      if not d.owned[b.id] and (not b.req or d.owned[b.req]) then
        local _, pad, pp = Models.pad(st.plot.Pads, b, buildingPos(st.plot, b), st.plot.color)
        local id = b.id
        pad.Touched:Connect(function(hit)
          local who = Players:GetPlayerFromCharacter(hit.Parent)
          if who == st.pl then G.tryBuild(st, id, true) end
        end)
        pp.Triggered:Connect(function(who)
          if who == st.pl then G.tryBuild(st, id, false) end
        end)
        st.pads[id] = { pad = pad, b = b }
        if id == "airbase" and not st.airHint then   -- 空军基地盖在围墙外面，按钮在围墙里靠右
          st.airHint = true
          G.toast(st, "空军基地解锁了：购买按钮在基地里靠右边的围墙旁，盖好后跑道在围墙外面", "info")
        end
      end
    end
    padColors(st)
  end

  function G.tryBuild(st, id, touch)
    if not st.ready then return end
    local b = BDEF[id]
    local d = st.data
    if not b or d.owned[id] or (b.req and not d.owned[b.req]) then return end
    if touch then   -- 踩着按钮不停触发：隔一会儿才算一次
      local now = os.clock()
      if now - (st.padT[id] or 0) < 1.2 then return end
      st.padT[id] = now
    end
    if d.cash < b.price then
      G.toast(st, "钱不够：" .. b.name .. " 还差 $" .. Config.Fmt(b.price - d.cash), "bad")
      return
    end
    d.cash = d.cash - b.price
    d.owned[id] = true
    if b.kind == "hq" then d.hq = 1 end
    G.placeBuilding(st, b, true)
    G.recalc(st)
    G.refreshPads(st)
    G.progress(st, "build", 1)
    local extra = ""
    if b.income then extra = "，收入 +" .. Config.Fmt(b.income) .. "/秒" end
    G.toast(st, "建成：" .. b.name .. extra, "good")
    if b.kind == "mil" then
      local names = {}
      for _, u in ipairs(b.units) do table.insert(names, UNITS[u].name) end
      G.toast(st, "可以生产" .. table.concat(names, "、") .. "了：右边「兵工厂」，或者走到建筑旁按 E", "info")
    elseif b.kind == "hq" then
      G.toast(st, "部队上限 " .. G.capOf(d) .. "；以后可以升级指挥部带更多兵", "info")
    end
    G.push(st)
  end

  function G.upgradeHQ(st)
    if not st.ready then return end
    local d = st.data
    if not d.owned.hq then
      G.toast(st, "先盖指挥部", "bad")
      return
    end
    if d.hq >= #BDEF.hq.cap then
      G.toast(st, "指挥部已经满级", "info")
      return
    end
    local price = BDEF.hq.up[d.hq]
    if d.cash < price then
      G.toast(st, "升级指挥部还差 $" .. Config.Fmt(price - d.cash), "bad")
      return
    end
    d.cash = d.cash - price
    d.hq = d.hq + 1
    G.recalc(st)
    G.fx({ k = "build", p = buildingPos(st.plot, BDEF.hq), s = 30 })
    G.toast(st, "指挥部升到 " .. d.hq .. " 级：部队上限 " .. G.capOf(d), "good")
    G.push(st)
  end

  function G.upgradeTech(st)
    if not st.ready then return end
    local d = st.data
    if d.tech >= Config.Tech.max then
      G.toast(st, "军工科技已经满级", "info")
      return
    end
    local price = Config.TechCost(d.tech)
    if d.cash < price then
      G.toast(st, "升级军工科技还差 $" .. Config.Fmt(price - d.cash), "bad")
      return
    end
    d.cash = d.cash - price
    d.tech = d.tech + 1
    G.progress(st, "tech", 1)
    G.toast(st, "军工科技升到 " .. d.tech .. " 级：全军血量、伤害 +" .. math.floor(d.tech * Config.Tech.bonus * 100 + 0.5) .. "%", "good")
    G.push(st)
  end

  function G.canRebirth(d)
    return d.level >= Config.Rebirth.level and d.owned.bank == true
  end

  -- 重生：建筑、现金、关卡、部队、科技清零；武器、经验、军衔、积分留着；换永久加成
  function G.rebirth(st)
    if not st.ready or st.battle then return end
    local d = st.data
    if not G.canRebirth(d) then
      G.toast(st, "打到第 " .. Config.Rebirth.level .. " 关、盖了银行才能重生", "bad")
      return
    end
    d.rebirth = d.rebirth + 1
    d.cash = Config.StartCash
    d.owned = {}
    d.hq = 0
    d.tech = 0
    d.level = 1
    for _, u in pairs(st.units) do
      if u.model then u.model:Destroy() end
    end
    st.units = {}
    st.hqLabel, st.hqPrompt = nil, nil
    st.plot.Buildings:ClearAllChildren()
    G.recalc(st)
    G.refreshPads(st)
    G.makeEnemy(st)
    G.addXP(st, 200)
    G.fx({ k = "build", p = st.plot.origin + V(0, 1, 0), s = 120 })
    G.toast(st, "重生第 " .. d.rebirth .. " 次！收入永久 +" .. math.floor(Config.Rebirth.income * 100 * d.rebirth) .. "%，部队永久 +" .. math.floor(Config.Rebirth.power * 100 * d.rebirth) .. "%", "good")
    G.rankTag(st)
    G.push(st)
    task.spawn(G.save, st)
  end

  -- 经验、军衔；头顶的名牌（[军衔] 名字 ★重生次数）
  function G.rankTag(st)
    local char = st.pl.Character
    local head = char and char:FindFirstChild("Head")
    if not head then return end
    local tag = head:FindFirstChild("RankTag")
    if not tag then
      tag = Instance.new("BillboardGui")
      tag.Name = "RankTag"
      tag.Size = UDim2.new(10, 0, 1.4, 0)
      tag.StudsOffsetWorldSpace = V(0, 2.6, 0)
      tag.MaxDistance = 160
      tag.LightInfluence = 0
      tag.AlwaysOnTop = false
      local t = Instance.new("TextLabel")
      t.Name = "T"
      t.Size = UDim2.fromScale(1, 1)
      t.BackgroundTransparency = 1
      t.Font = Enum.Font.GothamBold
      t.TextScaled = true
      t.RichText = true
      t.TextColor3 = Color3.new(1, 1, 1)
      t.TextStrokeTransparency = 0.3
      t.Parent = tag
      tag.Parent = head
    end
    local rank = Config.RankOf(st.data.xp)
    local stars = (st.data.rebirth > 0) and ("  <font color=\"#FFD24A\">★" .. st.data.rebirth .. "</font>") or ""
    tag.T.Text = "<font color=\"#FFD86A\">[" .. rank .. "]</font> " .. st.pl.DisplayName .. stars
  end

  function G.addXP(st, n)
    local d = st.data
    local old = Config.RankOf(d.xp)
    d.xp = d.xp + math.floor(n)
    local new = Config.RankOf(d.xp)
    if new ~= old then
      G.toast(st, "晋升：" .. new .. "！", "good")
      G.rankTag(st)
      if st.ls and st.ls.rank then st.ls.rank.Value = new end
    end
  end

  -- 每日任务：今天的三个（按日期定）；kind 对上的加进度
  local function missionsFresh(st)
    local d = st.data
    local day = Config.Day(os.time())
    if d.missions.day ~= day or #d.missions.list ~= 3 then
      d.missions = { day = day, list = {} }
      for _, m in ipairs(Config.MissionsOf(day)) do table.insert(d.missions.list, { id = m.id, prog = 0, claimed = false }) end
    end
  end
  G.missionsFresh = missionsFresh
  local MBYID = {}
  for _, m in ipairs(Config.Missions) do MBYID[m.id] = m end
  G.missionDef = MBYID
  function G.progress(st, kind, n)
    if not st.data then return end
    missionsFresh(st)
    local changed = false
    for _, m in ipairs(st.data.missions.list) do
      local def = MBYID[m.id]
      if def and def.kind == kind and not m.claimed and m.prog < def.goal then
        m.prog = math.min(def.goal, m.prog + (n or 1))
        changed = true
        if m.prog >= def.goal then G.toast(st, "任务完成：" .. def.text .. "（到「任务」里领奖励）", "good") end
      end
    end
    if changed then st.dirty = true end
  end
  function G.missionReward(st)
    return math.max(400, math.floor(st.income * Config.MissionRewardSec))
  end
  function G.claimMission(st, i)
    if type(i) ~= "number" then return end
    missionsFresh(st)
    local m = st.data.missions.list[i]
    local def = m and MBYID[m.id]
    if not def or m.claimed or m.prog < def.goal then return end
    m.claimed = true
    local r = G.missionReward(st)
    st.data.cash = st.data.cash + r
    G.addXP(st, 40)
    G.toast(st, "领到任务奖励 $" .. Config.Fmt(r), "good")
    G.push(st)
  end

  -- 每日奖励：连续登录天数越多越多（最多叠到 7 天）
  function G.dailyInfo(st)
    local d = st.data
    local day = Config.Day(os.time())
    if d.daily.day == day then return false, 0, d.daily.streak end
    local streak = (d.daily.day == day - 1) and math.min(Config.Daily.max, d.daily.streak + 1) or 1
    local amount = math.floor(math.max(Config.Daily.base, st.income * Config.Daily.incomeSec) * (1 + Config.Daily.step * (streak - 1)))
    return true, amount, streak
  end
  function G.claimDaily(st)
    local ok, amount, streak = G.dailyInfo(st)
    if not ok then return end
    local d = st.data
    d.daily.day = Config.Day(os.time())
    d.daily.streak = streak
    d.cash = d.cash + amount
    G.toast(st, "每日奖励（连续第 " .. streak .. " 天）：$" .. Config.Fmt(amount), "good")
    G.push(st)
  end

  function G.buyWeapon(st, id)
    local w = Config.Weapons[id]
    if not w or not st.ready then return end
    local d = st.data
    if d.weapons[id] then return end
    if d.cash < w.price then
      G.toast(st, "买" .. w.name .. "还差 $" .. Config.Fmt(w.price - d.cash), "bad")
      return
    end
    d.cash = d.cash - w.price
    d.weapons[id] = true
    G.giveTools(st)
    G.toast(st, "买到" .. w.name .. "：在下面的物品栏里（按数字键切换）", "good")
    G.push(st)
  end

  -- 每秒：收入、按钮颜色
  function G.econTick(st)
    st.data.cash = st.data.cash + st.income
    padColors(st)
  end

  -- 进服：盖好已有的建筑、摆按钮、今天的任务
  function G.econSetup(st)
    for _, b in ipairs(Config.Buildings) do
      if st.data.owned[b.id] then G.placeBuilding(st, b, false) end
    end
    G.recalc(st)
    G.refreshPads(st)
    missionsFresh(st)
  end
end

return Economy
