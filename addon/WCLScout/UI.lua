local Addon = WCLScout
local ROWS = 16
local selectedPlayer
local rowButtons = {}
local classColors = RAID_CLASS_COLORS
local displayData = {}
local scrollOffset = 0

local window = CreateFrame("Frame", "WCLScoutWindow", UIParent, "BackdropTemplate")
window:SetSize(860, 600)
window:SetPoint("CENTER")
window:SetFrameStrata("DIALOG")
window:SetMovable(true)
window:EnableMouse(true)
window:RegisterForDrag("LeftButton")
window:SetScript("OnDragStart", window.StartMoving)
window:SetScript("OnDragStop", window.StopMovingOrSizing)
window:SetClampedToScreen(true)
window:SetBackdrop({ bgFile = "Interface\\DialogFrame\\UI-DialogBox-Background-Dark", edgeFile = "Interface\\DialogFrame\\UI-DialogBox-Border", edgeSize = 24, insets = { left = 7, right = 7, top = 7, bottom = 7 } })
window:Hide()

local title = window:CreateFontString(nil, "OVERLAY", "GameFontNormalLarge")
title:SetPoint("TOPLEFT", 22, -18)
title:SetText("公开战斗日志·集合石侦察")
local subtitle = window:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
subtitle:SetPoint("TOPLEFT", title, "BOTTOMLEFT", 0, -5)
subtitle:SetText("只查询你主动选择的玩家，不会自动扫描申请者")

local close = CreateFrame("Button", nil, window, "UIPanelCloseButton")
close:SetPoint("TOPRIGHT", -7, -7)
local refresh = CreateFrame("Button", nil, window, "UIPanelButtonTemplate")
refresh:SetSize(80, 24)
refresh:SetPoint("TOPRIGHT", -45, -17)
refresh:SetText("刷新名单")
refresh:SetScript("OnClick", function() Addon.CollectParty(); Addon.CollectApplicants(); Addon.RefreshUI() end)

local listPanel = CreateFrame("Frame", nil, window, "BackdropTemplate")
listPanel:SetPoint("TOPLEFT", 18, -65)
listPanel:SetPoint("BOTTOMLEFT", 18, 18)
listPanel:SetWidth(320)
listPanel:SetBackdrop({ bgFile = "Interface\\Buttons\\WHITE8X8" })
listPanel:SetBackdropColor(0.035, 0.045, 0.065, 0.9)
listPanel:EnableMouseWheel(true)
listPanel:SetScript("OnMouseWheel", function(_, delta)
  local maxOffset = math.max(0, #displayData - ROWS)
  scrollOffset = math.max(0, math.min(maxOffset, scrollOffset - delta * 3))
  Addon.RefreshUI()
end)
local detail = CreateFrame("Frame", nil, window, "BackdropTemplate")
detail:SetPoint("TOPLEFT", listPanel, "TOPRIGHT", 12, 0)
detail:SetPoint("BOTTOMRIGHT", -18, 18)
detail:SetBackdrop({ bgFile = "Interface\\Buttons\\WHITE8X8" })
detail:SetBackdropColor(0.035, 0.045, 0.065, 0.9)

local playerName = detail:CreateFontString(nil, "OVERLAY", "GameFontNormalHuge")
playerName:SetPoint("TOPLEFT", 20, -24)
playerName:SetText("选择一名玩家")
local playerMeta = detail:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
playerMeta:SetPoint("TOPLEFT", playerName, "BOTTOMLEFT", 0, -8)
playerMeta:SetText("团队、小队成员和集合石申请者会出现在左侧")
local grade = detail:CreateFontString(nil, "OVERLAY", "GameFontNormalHuge")
grade:SetPoint("TOPLEFT", playerMeta, "BOTTOMLEFT", 0, -30)
local metrics = detail:CreateFontString(nil, "OVERLAY", "GameFontHighlightLarge")
metrics:SetPoint("TOPLEFT", grade, "BOTTOMLEFT", 0, -15)
metrics:SetWidth(330)
metrics:SetJustifyH("LEFT")
metrics:SetSpacing(8)
metrics:SetFontObject("GameFontHighlight")
metrics:SetWidth(470)
local note = detail:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
note:SetPoint("BOTTOMLEFT", 20, 68)
note:SetWidth(330)
note:SetJustifyH("LEFT")
note:SetText("只看15层以上样本。总分、最高层、限时率和词缀不参与技术评分。")

local queryButton = CreateFrame("Button", nil, detail, "UIPanelButtonTemplate")
queryButton:SetSize(105, 30)
queryButton:SetPoint("BOTTOMLEFT", 20, 25)
queryButton:SetText("单查")
queryButton:SetEnabled(false)
local reloadButton = CreateFrame("Button", nil, detail, "UIPanelButtonTemplate")
reloadButton:SetSize(90, 30)
reloadButton:SetPoint("BOTTOMRIGHT", -18, 25)
reloadButton:SetText("重载缓存")
reloadButton:SetScript("OnClick", ReloadUI)

StaticPopupDialogs.WCLSCOUT_QUEUED = {
  text = "已将 %s 加入摘要查询。\n\n1. 现在 /reload 提交名字\n2. 等待3–8秒\n3. 再次 /reload 载入结果\n\n若已有缓存，第二次重载后立即显示。",
  button1 = OKAY, timeout = 0, whileDead = true, hideOnEscape = true, preferredIndex = 3,
}
StaticPopupDialogs.WCLSCOUT_DEEP = {
  text = "已将 %s 加入深度查询。\n\n1. 现在 /reload 提交\n2. 正常等待5–15秒；日志网站限流时可能30–120秒\n3. 再次 /reload 载入结果\n\n缓存过的完整深度结果可秒开。",
  button1 = OKAY, timeout = 0, whileDead = true, hideOnEscape = true, preferredIndex = 3,
}
StaticPopupDialogs.WCLSCOUT_BATCH = {
  text = "已将当前列表中的 %d 名玩家加入摘要查询。不会进行高成本深度分析。\n\n现在重载提交，等待查询完成后再重载一次载入结果。",
  button1 = OKAY, timeout = 0, whileDead = true, hideOnEscape = true, preferredIndex = 3,
}
StaticPopupDialogs.WCLSCOUT_GROWTH = {
  text = "已为 %s 提交低层成长分析。\n\n现在 /reload 提交，等待查询完成后再 /reload 载入结果。只比较同副本、同层数和同专精的公开样本。",
  button1 = OKAY, timeout = 0, whileDead = true, hideOnEscape = true, preferredIndex = 3,
}

local deepButton = CreateFrame("Button", nil, detail, "UIPanelButtonTemplate")
deepButton:SetSize(105, 30)
deepButton:SetPoint("LEFT", queryButton, "RIGHT", 6, 0)
deepButton:SetText("深度分析")
deepButton:SetEnabled(false)
local growthButton = CreateFrame("Button", nil, detail, "UIPanelButtonTemplate")
growthButton:SetSize(105, 30)
growthButton:SetPoint("LEFT", deepButton, "RIGHT", 6, 0)
growthButton:SetText("成长分析")
growthButton:SetEnabled(false)

local function skillName(skill)
  if skill and skill.spellID and skill.spellID > 0 and C_Spell and C_Spell.GetSpellName then
    local localized = C_Spell.GetSpellName(skill.spellID)
    if localized then return localized end
  end
  return skill and skill.name or "未知技能"
end
local function scoreText(value)
  return type(value) == "number" and string.format("%.1f", value) or "待验证"
end

local function showDetails(player)
  selectedPlayer = player
  queryButton:SetEnabled(player ~= nil)
  deepButton:SetEnabled(player ~= nil)
  local selfName = UnitName("player")
  growthButton:SetEnabled(player ~= nil and selfName ~= nil and (player.name == selfName or player.name:match("^[^-]+") == selfName))
  if not player then return end
  local color = classColors[player.class]
  if color then playerName:SetTextColor(color.r, color.g, color.b) else playerName:SetTextColor(1, 0.82, 0) end
  playerName:SetText(player.name or "未知玩家")
  playerMeta:SetText(string.format("%s  ·  %s  ·  装等 %s  ·  大秘境分 %s", player.source == "applicant" and "集合石申请者" or "当前队伍", player.role or "未知职责", player.itemLevel and string.format("%.1f", player.itemLevel) or "—", player.dungeonScore or "—"))
  local rating = Addon.GetRating(player)
  local job = Addon.GetJob(player)
  if rating then
    grade:SetText(string.format("%s：%.1f", rating.metricLabel or "表现评分", rating.outputScore or 0))
    local deep = rating.deep
    local comparison = rating.comparison
    local deepText = "\n深度数据：|cff778195未分析|r"
    if deep then
      local minutes = math.max(deep.durationMinutes or 0, 0.1)
      if comparison then
        deepText = string.format("\n|cffe8b55b对比样本：%s %s层|r\n综合评分：|cffffffff%s|r\n输出结果：|cffffffff%s|r\n输出手法：|cffffffff%s|r\n生存能力：|cffffffff%s|r\n打断能力：|cffffffff%s|r\n杂活能力：|cffffffff%s|r", deep.encounter or "未知副本", deep.keyLevel or 0, scoreText(comparison.overallScore), scoreText(comparison.output), scoreText(comparison.rotation), scoreText(comparison.survival), scoreText(comparison.interrupts), scoreText(comparison.chores))
      else
        deepText = string.format("\n|cffe8b55b深度样本：%s %s层|r\n该专精的分层标准尚未完成，暂不用原始次数强行评级。", deep.encounter or "未知副本", deep.keyLevel or 0)
      end
    end
    metrics:SetText(string.format("%d层以上同层表现：|cffffffff%.1f|r  最高层：|cffffffff%s|r  覆盖：|cffffffff%d本|r%s", rating.minKeyLevel or 15, rating.outputScore or 0, rating.highestLevel or "—", rating.sampleCount or 0, deepText))
    queryButton:SetText("更新摘要")
  else
    grade:SetText("尚未查询")
    metrics:SetText("点击下方按钮，只查询当前选中的这一名玩家。\n\n不会自动查询列表中的其他成员或申请者。")
    queryButton:SetText("单查")
  end
  if WCLScoutDB.pending[Addon.KeyFor(player.name)] then
    if job and job.status == "working" then note:SetText("查询进度：本地助手正在读取公开日志。深度5–15秒，限流时30–120秒后再 /reload。")
    elseif job and job.status == "error" then note:SetText("查询失败：" .. (job.message or "未知错误") .. "。稍后重试。")
    else note:SetText("查询进度：待提交。现在 /reload，等待后再 /reload 载入结果。") end
  else note:SetText("默认看15层以上；本人可点成长分析查看低层记录。总分和最高层只作履历展示。") end
end

queryButton:SetScript("OnClick", function()
  if not selectedPlayer then return end
  Addon.QueueLookup(selectedPlayer, false)
  StaticPopup_Show("WCLSCOUT_QUEUED", selectedPlayer.name)
  Addon.RefreshUI()
end)
deepButton:SetScript("OnClick", function()
  if not selectedPlayer then return end
  Addon.QueueLookup(selectedPlayer, true)
  StaticPopup_Show("WCLSCOUT_DEEP", selectedPlayer.name)
  Addon.RefreshUI()
end)
growthButton:SetScript("OnClick", function()
  if not selectedPlayer then return end
  Addon.QueueLookup(selectedPlayer, true, 5)
  StaticPopup_Show("WCLSCOUT_GROWTH", selectedPlayer.name)
  Addon.RefreshUI()
end)

local batchButton = CreateFrame("Button", nil, window, "UIPanelButtonTemplate")
batchButton:SetSize(105, 24)
batchButton:SetPoint("RIGHT", refresh, "LEFT", -7, 0)
batchButton:SetText("一键全查")
batchButton:SetScript("OnClick", function()
  local count = 0
  for _, item in ipairs(displayData) do
    if not item.header then Addon.QueueLookup(item, false); count = count + 1 end
  end
  StaticPopup_Show("WCLSCOUT_BATCH", count)
  Addon.RefreshUI()
end)

local function sortedValues(source)
  local result = {}
  for _, player in pairs(source or {}) do result[#result + 1] = player end
  table.sort(result, function(a, b)
    if (a.role or "") ~= (b.role or "") then return (a.role or "") < (b.role or "") end
    return (a.name or "") < (b.name or "")
  end)
  return result
end

for i = 1, ROWS do
  local row = CreateFrame("Button", nil, listPanel)
  row:SetSize(290, 22)
  row:SetPoint("TOPLEFT", 10, -8 - (i - 1) * 23)
  row:SetHighlightTexture("Interface\\QuestFrame\\UI-QuestTitleHighlight")
  row.text = row:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  row.text:SetPoint("LEFT", 6, 0)
  row.text:SetWidth(276)
  row.text:SetJustifyH("LEFT")
  row:SetScript("OnClick", function(self) if self.player then showDetails(self.player) end end)
  rowButtons[i] = row
end

function Addon.RefreshUI()
  if not window:IsShown() then return end
  Addon.EnsureDB()
  local display = { { header = "当前团队 / 小队" } }
  for _, p in ipairs(sortedValues(WCLScoutDB.party)) do display[#display + 1] = p end
  display[#display + 1] = { header = "集合石申请者（滚轮查看更多）" }
  for _, p in ipairs(sortedValues(WCLScoutDB.applicants)) do display[#display + 1] = p end
  displayData = display
  scrollOffset = math.min(scrollOffset, math.max(0, #displayData - ROWS))
  for i, row in ipairs(rowButtons) do
    local item = displayData[i + scrollOffset]
    row.player = item and not item.header and item or nil
    if not item then row:Hide()
    else
      row:Show()
      if item.header then row.text:SetText("|cffe8b55b" .. item.header .. "|r"); row:Disable()
      else
        row:Enable()
        local rating = Addon.GetRating(item)
        local suffix = rating and string.format("  |cff63d6a3[%.0f分]|r", rating.outputScore or 0) or "  |cff778195[未查询]|r"
        local pending = WCLScoutDB.pending[Addon.KeyFor(item.name)] and " |cffffc45c●|r" or ""
        row.text:SetText((item.name or "未知") .. suffix .. pending)
      end
    end
  end
end

function Addon.ToggleUI()
  if window:IsShown() then window:Hide(); return end
  Addon.CollectParty(); Addon.CollectApplicants(); Addon.RequestPartyInspects(); window:Show(); Addon.RefreshUI()
end

local finderButton
local function attachFinderButton()
  if finderButton or not LFGListFrame then return end
  finderButton = CreateFrame("Button", nil, LFGListFrame, "UIPanelButtonTemplate")
  finderButton:SetSize(92, 24)
  finderButton:SetPoint("TOPRIGHT", LFGListFrame, "TOPRIGHT", -42, -28)
  finderButton:SetText("日志侦察")
  finderButton:SetScript("OnClick", Addon.ToggleUI)
end

if LFGListFrame then attachFinderButton()
else
  local loader = CreateFrame("Frame")
  loader:RegisterEvent("ADDON_LOADED")
  loader:SetScript("OnEvent", function(_, _, name) if name == "Blizzard_GroupFinder" then attachFinderButton() end end)
end
