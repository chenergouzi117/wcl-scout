local addonName = ...
local eventFrame = CreateFrame("Frame")
local inspectQueue = {}
local inspectingGUID

WCLScout = WCLScout or {}
local Addon = WCLScout

function Addon.KeyFor(name)
  return name and string.lower(name) or nil
end

function Addon.EnsureDB()
  WCLScoutDB = WCLScoutDB or {}
  WCLScoutDB.applicants = WCLScoutDB.applicants or {}
  WCLScoutDB.party = WCLScoutDB.party or {}
  WCLScoutDB.pending = WCLScoutDB.pending or {}
  WCLScoutDB.options = WCLScoutDB.options or { enabled = true }
end

local function mythicScore(unit)
  if not C_PlayerInfo or not C_PlayerInfo.GetPlayerMythicPlusRatingSummary then return nil end
  local ok, summary = pcall(C_PlayerInfo.GetPlayerMythicPlusRatingSummary, unit)
  if ok and summary then return summary.currentSeasonScore or summary.currentScore end
  return nil
end

local function selfItemLevel()
  if not GetAverageItemLevel then return nil end
  local _, equipped = GetAverageItemLevel()
  return equipped
end

function Addon.CollectApplicants()
  Addon.EnsureDB()
  wipe(WCLScoutDB.applicants)
  if not C_LFGList or not C_LFGList.GetApplicants then return end
  local applicants = C_LFGList.GetApplicants() or {}
  for _, applicantID in ipairs(applicants) do
    local info = C_LFGList.GetApplicantInfo(applicantID)
    local count = info and info.numMembers or 1
    for index = 1, count do
      local name, class, _, level, itemLevel, _, tank, healer, damage, role, _, dungeonScore, _, factionGroup, _, specID, isLeaver = C_LFGList.GetApplicantMemberInfo(applicantID, index)
      if name then
        WCLScoutDB.applicants[Addon.KeyFor(name)] = {
          name = name, class = class, level = level, itemLevel = itemLevel,
          role = role, tank = tank, healer = healer, damage = damage,
          dungeonScore = dungeonScore, specID = specID, isLeaver = isLeaver,
          factionGroup = factionGroup, source = "applicant", seenAt = time(),
        }
      end
    end
  end
end

function Addon.CollectParty()
  Addon.EnsureDB()
  local previous = {}
  for key, value in pairs(WCLScoutDB.party or {}) do previous[key] = value end
  wipe(WCLScoutDB.party)
  local groupSize = GetNumGroupMembers()
  if groupSize == 0 then groupSize = 1 end
  for i = 1, groupSize do
    local unit
    if IsInRaid() then unit = "raid" .. i
    elseif i == groupSize then unit = "player"
    else unit = "party" .. i end
    if UnitExists(unit) then
      local name, realm = UnitFullName(unit)
      if not realm or realm == "" then realm = GetNormalizedRealmName() end
      local fullName = realm and realm ~= "" and (name .. "-" .. realm) or name
      local old = previous[Addon.KeyFor(fullName)] or {}
      local member = {
        name = fullName, class = select(2, UnitClass(unit)), level = UnitLevel(unit),
        role = UnitGroupRolesAssigned(unit), source = IsInRaid() and "raid" or "party",
        unit = unit, guid = UnitGUID(unit), seenAt = time(),
        itemLevel = unit == "player" and selfItemLevel() or old.itemLevel,
        dungeonScore = mythicScore(unit) or old.dungeonScore,
      }
      WCLScoutDB.party[Addon.KeyFor(fullName)] = member
      if member.role == "NONE" and unit == "player" then
        member.role = GetSpecializationRole(GetSpecialization()) or "DAMAGER"
      end
    end
  end
end

function Addon.StartNextInspect()
  if inspectingGUID or InCombatLockdown() then return end
  while #inspectQueue > 0 do
    local unit = table.remove(inspectQueue, 1)
    if UnitExists(unit) and CanInspect(unit) and CheckInteractDistance(unit, 1) then
      inspectingGUID = UnitGUID(unit)
      NotifyInspect(unit)
      return
    end
  end
end

function Addon.RequestPartyInspects()
  wipe(inspectQueue)
  for _, member in pairs(WCLScoutDB.party or {}) do
    if member.unit and member.unit ~= "player" and (not member.itemLevel or member.itemLevel <= 0) then
      inspectQueue[#inspectQueue + 1] = member.unit
    end
  end
  Addon.StartNextInspect()
end

function Addon.GetJob(player)
  if not player or not WCLScoutData or not WCLScoutData.jobs then return nil end
  return WCLScoutData.jobs[Addon.KeyFor(player.name)]
end

function Addon.ClearFinishedPending()
  if not WCLScoutData or not WCLScoutData.jobs then return end
  for key in pairs(WCLScoutDB.pending or {}) do
    local job = WCLScoutData.jobs[key]
    if job and job.status == "done" then WCLScoutDB.pending[key] = nil end
  end
end

function Addon.GetRating(player)
  if not player or not WCLScoutData or not WCLScoutData.players then return nil end
  local mode = Addon.GetContext(player)
  local role = player.role == "NONE" and "DAMAGER" or (player.role or "DAMAGER")
  return WCLScoutData.players[Addon.KeyFor(player.name .. "|" .. mode .. "|" .. role)] or WCLScoutData.players[Addon.KeyFor(player.name)]
end

function Addon.GetContext(player)
  local mode = ((player and player.source == "raid") or IsInRaid()) and "raid" or "dungeon"
  if player and player.source == "applicant" and C_LFGList and C_LFGList.GetActiveEntryInfo then
    local entry = C_LFGList.GetActiveEntryInfo()
    local activityID = entry and entry.activityIDs and entry.activityIDs[1]
    local activity = activityID and C_LFGList.GetActivityInfoTable(activityID)
    if activity and activity.categoryID == 3 then mode = "raid" end
  end
  return mode, mode == "raid" and 53 or 55
end

function Addon.QueueLookup(player, deep, minKeyLevel)
  Addon.EnsureDB()
  if not player or not player.name then return end
  local mode, zoneId = Addon.GetContext(player)
  WCLScoutDB.pending[Addon.KeyFor(player.name)] = {
    name = player.name, class = player.class, role = player.role == "NONE" and "DAMAGER" or player.role,
    mode = mode, zoneId = zoneId, deep = deep and true or false, minKeyLevel = minKeyLevel or 15,
    requestedAt = time(), status = "pending",
  }
end

eventFrame:RegisterEvent("ADDON_LOADED")
eventFrame:RegisterEvent("PLAYER_LOGIN")
eventFrame:RegisterEvent("LFG_LIST_APPLICANT_LIST_UPDATED")
eventFrame:RegisterEvent("LFG_LIST_APPLICANT_UPDATED")
eventFrame:RegisterEvent("GROUP_ROSTER_UPDATE")
eventFrame:RegisterEvent("INSPECT_READY")
eventFrame:SetScript("OnEvent", function(_, event, arg1)
  if event == "ADDON_LOADED" and arg1 == addonName then Addon.EnsureDB()
  elseif event == "PLAYER_LOGIN" then Addon.CollectParty(); Addon.CollectApplicants(); Addon.ClearFinishedPending(); C_Timer.After(1, Addon.RequestPartyInspects)
  elseif event == "LFG_LIST_APPLICANT_LIST_UPDATED" or event == "LFG_LIST_APPLICANT_UPDATED" then Addon.CollectApplicants()
  elseif event == "GROUP_ROSTER_UPDATE" then Addon.CollectParty(); C_Timer.After(1, Addon.RequestPartyInspects)
  elseif event == "INSPECT_READY" and arg1 == inspectingGUID then
    for _, member in pairs(WCLScoutDB.party or {}) do
      if member.guid == arg1 and member.unit and C_PaperDollInfo and C_PaperDollInfo.GetInspectItemLevel then
        member.itemLevel = C_PaperDollInfo.GetInspectItemLevel(member.unit)
        member.dungeonScore = mythicScore(member.unit) or member.dungeonScore
      end
    end
    ClearInspectPlayer()
    inspectingGUID = nil
    C_Timer.After(0.8, Addon.StartNextInspect)
  end
  if Addon.RefreshUI then Addon.RefreshUI() end
end)

SLASH_WCLSCOUT1 = "/wcls"
SlashCmdList.WCLSCOUT = function()
  if Addon.ToggleUI then Addon.ToggleUI() end
end
