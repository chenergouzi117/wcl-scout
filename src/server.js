const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { loadConfig, saveCredentials, cachePath } = require('./config');
const { DiskCache } = require('./cache');
const { WclClient } = require('./wcl-client');
const { scoreCharacter, scoreRaidCharacter, summarizeDeepReport, estimateTeam } = require('./scoring');
const { compareDeepToBands, specKey } = require('./band-comparison');
const { startAddonSync } = require('./addon-sync');

const publicDir = path.join(__dirname, '..', 'public');
let config = loadConfig();
let cache = new DiskCache(cachePath, config.cacheHours * 3600_000);
const client = new WclClient(() => config);

function send(res, status, value, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(type.startsWith('application/json') ? JSON.stringify(value) : value);
}

async function body(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1_000_000) throw new Error('请求过大');
  }
  return raw ? JSON.parse(raw) : {};
}

function normalizeServer(value) {
  return String(value || '').trim().toLowerCase().replace(/[’']/g, '').replace(/\s+/g, '-');
}

async function lookupPlayer(input) {
  const startedAt = Date.now();
  const name = String(input.name || '').trim();
  const server = normalizeServer(input.server);
  const region = String(input.region || 'CN').toUpperCase();
  const mode = input.mode === 'raid' ? 'raid' : 'dungeon';
  const role = String(input.role || 'DAMAGER').toUpperCase();
  const minKeyLevel = Math.max(5, Number(input.minKeyLevel) || 15);
  const zoneId = Number(input.zoneId || (mode === 'raid' ? 53 : config.zoneId));
  const metric = mode === 'raid' ? (role === 'HEALER' ? 'hps' : 'dps') : (role === 'HEALER' ? 'points_and_healing' : 'points_and_damage');
  if (!name || !server) throw new Error('请输入角色名和服务器');
  const key = `${region}:${server}:${name}:${zoneId}:${metric}:${role}:min${minKeyLevel}`;
  const cachedEntry = cache.get(key);
  const cached = cachedEntry && (mode === 'raid' || cachedEntry.scoreVersion === 'same-key-output-v6-bands') ? cachedEntry : null;
  if (cached && (!input.deep || (
    cached.deepAnalysis?.summaryVersion >= 2
    && cached.deepAnalysis?.topCasts?.length
    && cached.bandComparison?.scoreVersion === 2
  ))) {
    addonSync?.exportAddonData();
    return { ...cached, cached: true, queryDurationMs: Date.now() - startedAt };
  }
  let character;
  let result;
  if (cached && input.deep) {
    result = { ...cached, cached: true };
    character = cached.character;
  } else {
    const data = await client.getCharacter(name, server, region, zoneId, metric);
    character = data.characterData?.character;
    if (!character) throw new Error('公开日志中没有找到该角色；请检查角色名、服务器或公开记录');
    const score = mode === 'raid' ? scoreRaidCharacter(character, role) : { ...scoreCharacter(character, { minKeyLevel }), mode, role, metricLabel: role === 'HEALER' ? '同层有效治疗分' : role === 'TANK' ? '同层坦克输出分' : '同层输出分' };
    result = { ...score, cached: false, fetchedAt: new Date().toISOString(), rateLimit: data.rateLimitData };
  }
  if (input.deep) {
    const specializationKey = specKey(character, result.spec);
    const hasMatchingStandard = (dungeon) => {
      if (!specializationKey || Number(dungeon.bestLevel) < minKeyLevel) return false;
      const standardPath = path.join(__dirname, '..', 'data', 'band-standards', 'zone-55', specializationKey, `${dungeon.id}.json`);
      if (!fs.existsSync(standardPath)) return false;
      try { return Boolean(JSON.parse(fs.readFileSync(standardPath, 'utf8')).levels?.[String(dungeon.bestLevel)]); }
      catch { return false; }
    };
    const evidence = mode === 'raid' ? result.bosses?.[0] :
      result.dungeons?.find(hasMatchingStandard) || result.dungeons?.[0];
    if (evidence?.id) {
      const deepMetric = role === 'HEALER' ? 'hps' : 'dps';
      const rankingData = await client.getEncounterRanking(character.id, evidence.id, deepMetric);
      const ranks = rankingData.characterData?.character?.encounterRankings?.ranks || [];
      const rank = ranks.find((r) => r.report?.code) || ranks[0];
      if (rank?.report?.code) {
        const report = await client.getReportSummary(rank.report.code, rank.report.fightID, character.name);
        result.deepAnalysis = summarizeDeepReport(report, role);
        result.deepAnalysis.rankingAmount = Number(rank.amount || rank.total || 0);
        result.bandComparison = compareDeepToBands({ character, spec: result.spec, deepAnalysis: result.deepAnalysis, encounterId: evidence.id });
      }
    }
  }
  result.queryDurationMs = Date.now() - startedAt;
  cache.set(key, result);
  addonSync?.exportAddonData();
  return result;
}

let addonSync;

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === 'GET' && url.pathname === '/api/health') {
      return send(res, 200, { ok: true, configured: Boolean(config.clientId && config.clientSecret), zoneId: config.zoneId });
    }
    if (req.method === 'POST' && url.pathname === '/api/settings') {
      const input = await body(req);
      if (!input.clientId || !input.clientSecret) throw new Error('Client ID和Client Secret不能为空');
      saveCredentials({ clientId: String(input.clientId).trim(), clientSecret: String(input.clientSecret).trim() });
      config = loadConfig();
      client.token = null;
      return send(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/player') {
      return send(res, 200, await lookupPlayer(await body(req)));
    }
    if (req.method === 'POST' && url.pathname === '/api/team') {
      const input = await body(req);
      const players = [];
      for (const member of (input.members || []).slice(0, 5)) {
        try { players.push(await lookupPlayer(member)); } catch (error) { players.push({ error: error.message, requested: member }); }
      }
      return send(res, 200, { players, estimate: estimateTeam(players.filter((p) => !p.error), input.targetLevel) });
    }
    if (req.method === 'POST' && url.pathname === '/api/batch') {
      const input = await body(req);
      const members = (input.members || []).slice(0, 40);
      const results = [];
      for (const member of members) {
        try { results.push(await lookupPlayer({ ...member, deep: false })); }
        catch (error) { results.push({ error: error.message, requested: member }); }
      }
      return send(res, 200, { results, count: results.length });
    }
    const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const safe = path.normalize(file).replace(/^(\.\.[/\\])+/, '');
    const target = path.join(publicDir, safe);
    if (!target.startsWith(publicDir) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) return send(res, 404, { error: 'Not found' });
    const ext = path.extname(target);
    const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
    return send(res, 200, fs.readFileSync(target), types[ext] || 'application/octet-stream');
  } catch (error) {
    return send(res, 400, { error: error.message || '请求失败' });
  }
});

server.listen(config.port, '127.0.0.1', () => {
  console.log(`WCL Scout 已启动：http://127.0.0.1:${config.port}`);
  console.log(config.clientId ? 'WCL凭据已配置。' : '首次使用请在网页中填写WCL V2凭据。');
  addonSync = startAddonSync({ lookupPlayer, cache });
});
