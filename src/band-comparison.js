const fs = require('node:fs');
const path = require('node:path');

// Warcraft Logs uses its own class identifiers, which differ from Blizzard's
// in-game class identifiers. Keep this table aligned with GameData.classes.
const classNames = {
  1: 'deathknight', 2: 'druid', 3: 'hunter', 4: 'mage', 5: 'monk',
  6: 'paladin', 7: 'priest', 8: 'rogue', 9: 'shaman', 10: 'warlock',
  11: 'warrior', 12: 'demonhunter', 13: 'evoker',
};
const tierOrder = ['靠后段', '大众段', '高玩段', '顶尖段'];
const utilityActions = new Set(['charge', 'pummel', 'storm_bolt', 'spell_reflection', 'rallying_cry', 'intimidating_shout', 'heroic_leap']);
// Weights are the within-dungeon-and-level output correlations measured from
// 383 Arms runs. Weak or unstable actions (for example Overpower) are omitted.
const rotationWeightsBySpec = {
  warrior_arms: {
    colossus_smash: 0.371, avatar: 0.359, execute: 0.352, cleave: 0.299,
    bladestorm: 0.267, mortal_strike: 0.228, sweeping_strikes: 0.149,
    castsPerMinute: 0.421,
  },
};
function percentileScore(value, distribution, lowerIsBetter = false) {
  const values = (distribution || []).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!Number.isFinite(value) || !values.length) return null;
  const below = values.filter((item) => item < value).length;
  const equal = values.filter((item) => item === value).length;
  // Half-rank smoothing avoids claiming absolute 0 or 100 from a small sample.
  let score = ((below + equal * 0.5 + 0.5) / (values.length + 1)) * 100;
  if (lowerIsBetter) score = 100 - score;
  return Math.round(Math.max(0, Math.min(100, score)) * 10) / 10;
}
function normalize(value) { return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

function specKey(character, spec) {
  const className = classNames[Number(character?.classID)];
  if (!className || !spec) return null;
  return `${className}_${String(spec).toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
}

function closestTier(value, tiers, metric, lowerIsBetter = false) {
  if (!Number.isFinite(value)) return null;
  const candidates = tierOrder.map((name) => ({ name, value: Number(tiers?.[name]?.[metric]?.median) })).filter((item) => Number.isFinite(item.value));
  if (!candidates.length) return null;
  candidates.sort((a, b) => Math.abs(a.value - value) - Math.abs(b.value - value));
  return { tier: candidates[0].name, value, standardMedian: candidates[0].value, direction: lowerIsBetter ? '越低越好' : '越高越好' };
}

function closestAbilityTier(value, tiers, action) {
  const candidates = tierOrder.map((name) => ({ name, value: Number(tiers?.[name]?.aplAbilityCastsPerMinute?.[action]?.median) })).filter((item) => Number.isFinite(item.value));
  if (!candidates.length) return null;
  candidates.sort((a, b) => Math.abs(a.value - value) - Math.abs(b.value - value));
  return { tier: candidates[0].name, value, standardMedian: candidates[0].value };
}

function compareDeepToBands({ character, spec, deepAnalysis, encounterId }) {
  if (!deepAnalysis || !encounterId) return null;
  const key = specKey(character, spec);
  if (!key) return null;
  const file = path.join(__dirname, '..', 'data', 'band-standards', 'zone-55', key, `${encounterId}.json`);
  if (!fs.existsSync(file)) return null;
  const standard = JSON.parse(fs.readFileSync(file, 'utf8'));
  const level = Number(deepAnalysis.keyLevel);
  const levelData = standard.levels?.[String(level)];
  if (!levelData) return null;
  if (level >= 21) return { scoreVersion: 2, overallScore: 100, policy: levelData.policy, dimensions: { output: { score: 100 }, rotation: { score: 100 }, survival: { score: 100 }, interrupts: { score: 100 }, chores: { score: 100 } } };
  const minutes = Math.max(1 / 60, Number(deepAnalysis.durationMinutes || 0));
  const tiers = levelData.tiers;
  const rotationWeights = rotationWeightsBySpec[key] || {};
  const reference = levelData.reference;
  const dimensions = {
    output: { score: percentileScore(Number(deepAnalysis.rankingAmount), reference?.outputAmount) },
    survival: { score: percentileScore(Number(deepAnalysis.deaths || 0), reference?.deathsPerRun, true) },
    interrupts: { score: percentileScore(Number(deepAnalysis.interrupts || 0) / minutes, reference?.interruptsPerMinute) },
    chores: { score: percentileScore((Number(deepAnalysis.controls || 0) + Number(deepAnalysis.dispels || 0)) / minutes, reference?.choresPerMinute) },
  };
  const actions = new Set();
  for (const tier of Object.values(tiers || {})) for (const action of Object.keys(tier.aplAbilityCastsPerMinute || {})) actions.add(action);
  const weightedScores = [];
  for (const cast of deepAnalysis.topCasts || []) {
    const action = [...actions].find((candidate) => normalize(candidate) === normalize(cast.name));
    if (!action) continue;
    const score = percentileScore(Number(cast.casts || 0) / minutes, reference?.abilityCastsPerMinute?.[action]);
    if (score != null && !utilityActions.has(action) && rotationWeights[action]) weightedScores.push({ score, weight: rotationWeights[action] });
  }
  const totalCastWeight = Number(rotationWeights.castsPerMinute || 0);
  const totalCastScore = totalCastWeight ? percentileScore(Number(deepAnalysis.castsPerMinute), reference?.castsPerMinute) : null;
  if (weightedScores.length || totalCastScore != null) {
    const weighted = weightedScores.reduce((sum, item) => sum + item.score * item.weight, 0) + (totalCastScore != null ? totalCastScore * totalCastWeight : 0);
    const totalWeight = weightedScores.reduce((sum, item) => sum + item.weight, 0) + (totalCastScore != null ? totalCastWeight : 0);
    dimensions.rotation = {
      score: Math.round((weighted / totalWeight) * 10) / 10,
      comparedSkills: weightedScores.length,
      method: '同副本同层百分位相关强度加权',
    };
  } else {
    dimensions.rotation = null;
  }
  const available = Object.values(dimensions).filter((item) => item?.score != null).map((item) => Number(item.score)).filter(Number.isFinite);
  const overallScore = dimensions.rotation && available.length
    ? Math.round((available.reduce((sum, score) => sum + score, 0) / available.length) * 10) / 10 : null;
  return { scoreVersion: 2, overallScore, policy: levelData.policy, dimensions,
    note: dimensions.rotation ? '' : '输出手法尚未通过跨副本验证，综合分暂缓发布' };
}

module.exports = { specKey, closestTier, closestAbilityTier, percentileScore, compareDeepToBands };
