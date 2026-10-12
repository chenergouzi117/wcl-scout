const fs = require('node:fs');
const path = require('node:path');
const { loadConfig } = require('../src/config');
const { WclClient } = require('../src/wcl-client');

const zoneId = Number(process.argv[2] || 55);
const className = process.argv[3] || 'Warrior';
const specName = process.argv[4] || 'Arms';
const levels = (process.argv[5] || '18,19,20,21').split(',').map(Number);
const role = String(process.argv[6] || 'DAMAGER').toUpperCase();
const outputKey = process.argv[7] || `${className.toLowerCase()}_${specName.toLowerCase()}`;
const metric = role === 'HEALER' ? 'hps' : 'dps';
const pages = [1, 3, 6, 11];
const client = new WclClient(loadConfig);
const outputRoot = path.join(__dirname, '..', 'data', 'band-samples', `zone-${zoneId}`, outputKey);
const encounterFilter = new Set(String(process.env.WCL_ENCOUNTER_IDS || '').split(',').map(Number).filter(Boolean));

function tierFor(rank, population) {
  if (population >= 1100) {
    if (rank <= 100) return '顶尖段';
    if (rank <= 500) return '高玩段';
    if (rank <= 1000) return '大众段';
    return '靠后段';
  }
  if (population >= 500) {
    if (rank <= 50) return '顶尖段';
    if (rank <= 200) return '高玩段';
    if (rank <= 500) return '大众段';
    return '靠后段';
  }
  if (population >= 200) {
    if (rank <= 20) return '顶尖段';
    if (rank <= 80) return '高玩段';
    if (rank <= 200) return '大众段';
    return '靠后段';
  }
  const percentile = rank / Math.max(1, population);
  if (percentile <= 0.05) return '顶尖段';
  if (percentile <= 0.25) return '高玩段';
  if (percentile <= 0.75) return '大众段';
  return '靠后段';
}

function spread(pageRanks, count = 3) {
  if (pageRanks.length <= count) return pageRanks;
  return Array.from({ length: count }, (_, index) => pageRanks[Math.round(index * (pageRanks.length - 1) / Math.max(1, count - 1))]);
}

async function main() {
  const zone = (await client.getZone(zoneId)).worldData.zone;
  fs.mkdirSync(outputRoot, { recursive: true });
  const manifest = { version: 2, zone: { id: zone.id, name: zone.name }, className, specName, role, metric, levels, pages, fetchedAt: new Date().toISOString(), cells: [] };
  for (const encounter of zone.encounters) {
    if (encounterFilter.size && !encounterFilter.has(Number(encounter.id))) continue;
    for (const level of levels) {
      const file = `${encounter.id}-level-${level}.json`;
      const existingPath = path.join(outputRoot, file);
      if (fs.existsSync(existingPath)) {
        const existing = JSON.parse(fs.readFileSync(existingPath, 'utf8'));
        const validElite = level < 21 || existing.samples?.every((run) => run.comparisonTier === '顶级参考组');
        if ((existing.samples?.length || 0) >= 12 && validElite) {
          manifest.cells.push({ encounterId: encounter.id, encounterName: encounter.name, level, populationLowerBound: existing.populationLowerBound, tiers: existing.tiers, file });
          console.log(`${encounter.name} +${level}: reused ${existing.samples.length} samples`);
          continue;
        }
      }
      const bracket = Math.round((level - zone.brackets.min) / zone.brackets.bucket) + 1;
      const pageResults = [];
      const queryPages = level >= 21 ? [1] : pages;
      for (const page of queryPages) {
        const response = await client.getEncounterRankings({ encounterId: encounter.id, bracket, className, specName, page, metric });
        const payload = response.worldData?.encounter?.characterRankings || {};
        const exact = (payload.rankings || []).filter((run) => Number(run.hardModeLevel) === level && run.report?.code && !run.hidden && run.name !== 'Anonymous');
        pageResults.push({ page, hasMorePages: Boolean(payload.hasMorePages), count: Number(payload.count || exact.length), runs: exact });
      }
      let population = 0;
      for (const pageResult of pageResults) {
        if (pageResult.runs.length) population = Math.max(population, (pageResult.page - 1) * 100 + (pageResult.hasMorePages ? 101 : pageResult.count));
      }
      const samples = [];
      const nonEmptyPages = pageResults.filter((pageResult) => pageResult.runs.length).length;
      const perPage = Math.max(3, Math.ceil(12 / Math.max(1, nonEmptyPages)));
      for (const pageResult of pageResults) {
        const ranked = pageResult.runs.map((run, index) => ({ ...run, estimatedRank: (pageResult.page - 1) * 100 + index + 1 }));
        for (const run of spread(ranked, perPage)) samples.push({ ...run, comparisonTier: level >= 21 ? '顶级参考组' : tierFor(run.estimatedRank, population) });
      }
      const tierNames = level >= 21 ? ['顶级参考组'] : ['顶尖段', '高玩段', '大众段', '靠后段'];
      const tiers = Object.fromEntries(tierNames.map((name) => [name, samples.filter((run) => run.comparisonTier === name).length]));
      const cell = { encounter, level, bracket, populationLowerBound: population, sampledPages: queryPages, tierPolicy: level >= 21 ? '二十一层及以上统一作为顶级参考，不再分档' : '按同专精样本人数自适应分档', tiers, samples };
      fs.writeFileSync(path.join(outputRoot, file), `${JSON.stringify(cell, null, 2)}\n`, 'utf8');
      manifest.cells.push({ encounterId: encounter.id, encounterName: encounter.name, level, populationLowerBound: population, tiers, file });
      console.log(`${encounter.name} +${level}: ${samples.length} samples, population >= ${population}`);
    }
  }
  fs.writeFileSync(path.join(outputRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

if (require.main === module) main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });

module.exports = { tierFor, spread };
