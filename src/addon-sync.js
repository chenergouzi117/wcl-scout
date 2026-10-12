const fs = require('node:fs');
const path = require('node:path');

function findWowRoot() {
  const projectRoot = path.join(__dirname, '..');
  let saved = '';
  try { saved = fs.readFileSync(path.join(projectRoot, 'wow-path.txt'), 'utf8').trim(); } catch {}
  const candidates = [
    process.env.WCL_WOW_ROOT, saved,
    'C:\\Program Files (x86)\\World of Warcraft\\_retail_',
    ...['C:', 'D:', 'E:', 'F:'].flatMap((drive) => [
      `${drive}\\World of Warcraft\\_retail_`,
      `${drive}\\Games\\World of Warcraft\\_retail_`,
      `${drive}\\Program Files (x86)\\World of Warcraft\\_retail_`,
    ]),
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(path.join(candidate, 'Interface', 'AddOns', 'WCLScout')))
    || candidates.find((candidate) => fs.existsSync(path.join(candidate, 'WTF', 'Account')))
    || candidates[0];
}

const wowRoot = findWowRoot();
const installedDataPath = path.join(wowRoot, 'Interface', 'AddOns', 'WCLScout', 'Data.lua');
const workspaceDataPath = path.join(__dirname, '..', 'addon', 'WCLScout', 'Data.lua');

function luaString(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n');
}

function luaArray(items, mapper) {
  return `{ ${items.map(mapper).join(', ')} }`;
}

function ratingLua(rating) {
  const deep = rating.deepAnalysis;
  const numericScore = Number(rating.outputScore) || 0;
  const chineseTier = /[一-鿿]/.test(String(rating.outputTier || '')) ? rating.outputTier : numericScore >= 95 ? '顶尖段' : numericScore >= 75 ? '高玩段' : numericScore >= 25 ? '大众段' : '靠后段';
  const comparison = rating.bandComparison;
  const dimensions = comparison?.dimensions || {};
  const comparisonLua = comparison ? `, comparison={ overallScore=${comparison.overallScore == null ? 'nil' : Number(comparison.overallScore)}, policy="${luaString(comparison.policy)}", output=${dimensions.output?.score == null ? 'nil' : Number(dimensions.output.score)}, rotation=${dimensions.rotation?.score == null ? 'nil' : Number(dimensions.rotation.score)}, survival=${dimensions.survival?.score == null ? 'nil' : Number(dimensions.survival.score)}, interrupts=${dimensions.interrupts?.score == null ? 'nil' : Number(dimensions.interrupts.score)}, chores=${dimensions.chores?.score == null ? 'nil' : Number(dimensions.chores.score)} }` : '';
  const deepLua = deep ? `, deep={ encounter="${luaString(deep.encounter)}", keyLevel=${Number(deep.keyLevel) || 0}, durationMinutes=${Number(deep.durationMinutes) || 0}, deaths=${Number(deep.deaths) || 0}, interrupts=${Number(deep.interrupts) || 0}, dispels=${Number(deep.dispels) || 0}, defensives=${Number(deep.defensives) || 0}, controls=${Number(deep.controls) || 0}, castsPerMinute=${Number(deep.castsPerMinute) || 0}, topDamage=${luaArray((deep.topDamage || []).slice(0, 6), (x) => `{ name="${luaString(x.name)}", spellID=${Number(x.spellID) || 0}, total=${Number(x.total) || 0}, hits=${Number(x.uses) || 0} }`)}, topCasts=${luaArray((deep.topCasts || []).slice(0, 10), (x) => `{ name="${luaString(x.name)}", spellID=${Number(x.spellID) || 0}, casts=${Number(x.casts) || 0} }`)}, note="${luaString(deep.note)}" }` : '';
  return `{ outputGrade="${luaString(rating.outputGrade)}", outputTier="${luaString(chineseTier)}", outputScore=${numericScore}, highestLevel=${Number(rating.highestLevel) || 0}, minKeyLevel=${Number(rating.minKeyLevel) || 15}, playerScore=${Number(rating.playerScore) || 0}, sampleCount=${Number(rating.sampleCount) || 0}, confidence="${luaString(rating.confidence)}", metricLabel="${luaString(rating.metricLabel || '表现分')}", mode="${luaString(rating.mode || 'dungeon')}", role="${luaString(rating.role || 'DAMAGER')}", fetchedAt="${luaString(rating.fetchedAt)}", queryDurationMs=${Number(rating.queryDurationMs) || 0}${deepLua}${comparisonLua} }`;
}

function exportAddonData(cacheValues, jobs = {}) {
  const players = new Map();
  const put = (key, rating) => {
    const normalized = key.toLowerCase();
    const existing = players.get(normalized);
    const quality = (value) => (value?.bandComparison ? 4 : 0) + (value?.deepAnalysis ? 2 : 0) + (value?.fetchedAt ? 1 : 0);
    if (!existing || quality(rating) > quality(existing)
      || (quality(rating) === quality(existing) && String(rating.fetchedAt || '') > String(existing.fetchedAt || ''))) {
      players.set(normalized, rating);
    }
  };
  for (const item of Object.values(cacheValues || {})) {
    const rating = item?.value;
    if (!rating?.character?.name || !rating.scoreVersion) continue;
    const name = rating.character.name;
    const serverName = rating.character.server?.name;
    const serverSlug = rating.character.server?.slug;
    put(name, rating);
    if (serverName) put(`${name}-${serverName}`, rating);
    if (serverSlug) put(`${name}-${serverSlug}`, rating);
    const mode = rating.mode || 'dungeon';
    const role = !rating.role || rating.role === 'NONE' ? 'DAMAGER' : rating.role;
    put(`${name}|${mode}|${role}`, rating);
    if (serverName) put(`${name}-${serverName}|${mode}|${role}`, rating);
    if (serverSlug) put(`${name}-${serverSlug}|${mode}|${role}`, rating);
  }
  const lines = ['WCLScoutData = {', `  generatedAt = ${Math.floor(Date.now() / 1000)},`, '  jobs = {'];
  for (const [key, job] of Object.entries(jobs)) {
    lines.push(`    ["${luaString(key.toLowerCase())}"] = { status="${luaString(job.status)}", deep=${job.deep ? 'true' : 'false'}, updatedAt=${Number(job.updatedAt) || 0}, message="${luaString(job.message || '')}" },`);
  }
  lines.push('  },', '  players = {');
  for (const [key, rating] of [...players.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`    ["${luaString(key)}"] = ${ratingLua(rating)},`);
  }
  lines.push('  }', '}', '');
  const output = lines.join('\n');
  fs.mkdirSync(path.dirname(workspaceDataPath), { recursive: true });
  fs.writeFileSync(workspaceDataPath, output, 'utf8');
  if (fs.existsSync(path.dirname(installedDataPath))) fs.writeFileSync(installedDataPath, output, 'utf8');
}

function findSavedVariableFiles() {
  const accountRoot = path.join(wowRoot, 'WTF', 'Account');
  if (!fs.existsSync(accountRoot)) return [];
  const files = [];
  for (const account of fs.readdirSync(accountRoot, { withFileTypes: true })) {
    if (!account.isDirectory()) continue;
    const file = path.join(accountRoot, account.name, 'SavedVariables', 'WCLScout.lua');
    if (fs.existsSync(file)) files.push(file);
  }
  return files;
}

function balancedTable(text, marker) {
  const markerIndex = text.indexOf(marker);
  if (markerIndex < 0) return '';
  const start = text.indexOf('{', markerIndex);
  if (start < 0) return '';
  let depth = 0;
  let quote = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') quote = false;
      continue;
    }
    if (ch === '"') quote = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  return '';
}

function parsePending(file) {
  const text = fs.readFileSync(file, 'utf8');
  const pending = balancedTable(text, '["pending"]');
  if (!pending) return [];
  const requests = [];
  const records = /\["[^"]+"\]\s*=\s*\{([\s\S]*?)\n\s*\},?/g;
  const field = (body, name) => body.match(new RegExp(`\\["${name}"\\]\\s*=\\s*"((?:\\\\.|[^"\\\\])*)"`))?.[1];
  for (const match of pending.matchAll(records)) {
    const name = field(match[1], 'name');
    if (!name) continue;
    const request = {
      name: name.replace(/\\"/g, '"').replace(/\\\\/g, '\\'),
      mode: field(match[1], 'mode') || 'dungeon',
      role: field(match[1], 'role') || 'DAMAGER',
      zoneId: Number(match[1].match(/\["zoneId"\]\s*=\s*(\d+)/)?.[1] || 55),
      minKeyLevel: Number(match[1].match(/\["minKeyLevel"\]\s*=\s*(\d+)/)?.[1] || 15),
      deep: /\["deep"\]\s*=\s*true/.test(match[1]),
    };
    const requestedAt = Number(match[1].match(/\["requestedAt"\]\s*=\s*(\d+)/)?.[1] || 0);
    if (requestedAt) request.requestedAt = requestedAt;
    requests.push(request);
  }
  return [...new Map(requests.map((r) => [r.name.toLowerCase(), r])).values()];
}

function splitCharacter(fullName) {
  const index = fullName.lastIndexOf('-');
  if (index <= 0 || index === fullName.length - 1) return null;
  return { name: fullName.slice(0, index), server: fullName.slice(index + 1), region: 'CN' };
}

function startAddonSync({ lookupPlayer, cache, intervalMs = 1500 }) {
  const handled = new Set();
  const jobs = {};
  exportAddonData(cache.values, jobs);
  const poll = async () => {
    for (const file of findSavedVariableFiles()) {
      let requests = [];
      try { requests = parsePending(file); } catch { continue; }
      for (const pending of requests) {
        if (pending.requestedAt && Math.floor(Date.now() / 1000) - pending.requestedAt > 3600) continue;
        const request = splitCharacter(pending.name);
        const requestKey = `${pending.name}:${pending.mode}:${pending.role}:${pending.deep}:${pending.minKeyLevel}`.toLowerCase();
        if (!request || handled.has(requestKey)) continue;
        handled.add(requestKey);
        jobs[pending.name.toLowerCase()] = { status: 'working', deep: pending.deep, updatedAt: Math.floor(Date.now() / 1000), message: pending.deep ? '正在读取施法和功能技能' : '正在读取WCL摘要' };
        exportAddonData(cache.values, jobs);
        try {
          await lookupPlayer({ ...request, mode: pending.mode, role: pending.role, zoneId: pending.zoneId, minKeyLevel: pending.minKeyLevel, deep: pending.deep });
          jobs[pending.name.toLowerCase()] = { status: 'done', deep: pending.deep, updatedAt: Math.floor(Date.now() / 1000), message: '查询已完成' };
          exportAddonData(cache.values, jobs);
          console.log(`已完成游戏内点选查询：${pending.name}`);
        } catch (error) {
          handled.delete(requestKey);
          jobs[pending.name.toLowerCase()] = { status: 'error', deep: pending.deep, updatedAt: Math.floor(Date.now() / 1000), message: error.message };
          exportAddonData(cache.values, jobs);
          console.error(`游戏内查询失败：${pending.name} - ${error.message}`);
        }
      }
    }
  };
  const timer = setInterval(() => poll().catch(() => {}), intervalMs);
  timer.unref();
  return { poll, exportAddonData: () => exportAddonData(cache.values, jobs) };
}

module.exports = { exportAddonData, findSavedVariableFiles, parsePending, splitCharacter, startAddonSync };
