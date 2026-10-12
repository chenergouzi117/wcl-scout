const test = require('node:test');
const assert = require('node:assert/strict');
const { grade, scoreCharacter, estimateTeam } = require('../src/scoring');

test('grade boundaries are stable', () => {
  assert.equal(grade(95), 'S');
  assert.equal(grade(90), 'A');
  assert.equal(grade(60), 'B');
});

test('scores a character and preserves dungeon evidence', () => {
  const result = scoreCharacter({ id: 1, name: '测试', server: { name: '红云台地' }, zoneRankings: {
    bestPerformanceAverage: 42, medianPerformanceAverage: 40,
    allStars: [{ spec: 'Arms', points: 3000, rankPercent: 95 }],
    throughputRankings: { '1': { best_historical_percentile: 42, median_historical_percentile: 40, best_level: 18, best_per_second_amount: 250000 } },
    rankings: [{ encounter: { id: 1, name: '诸王之眠' }, rankPercent: 94, medianPercent: 86, totalKills: 12, bestAmount: 430, bestRank: { ilvl: 18 } }],
  }});
  assert.equal(result.spec, 'Arms');
  assert.equal(result.sampleCount, 1);
  assert.equal(result.publicRunCount, 12);
  assert.equal(result.dungeons[0].bestLevel, 18);
  assert.equal(result.outputScore, 42);
  assert.equal(result.highestLevel, 18);
  assert.equal(result.minKeyLevel, 15);
  assert.equal(result.dungeons[0].dps, 250000);
  assert.equal(result.technique, null);
  assert.equal(result.outputTier, '大众段');
});

test('team summary does not claim a timed success probability', () => {
  const estimate = estimateTeam([{ outputScore: 70, confidence: '高' }], 18);
  assert.equal(estimate.evaluatedPlayers, 1);
  assert.equal(estimate.confidence, '低');
  assert.equal(estimate.probability, null);
});

test('records below 15 do not enter scoring or confidence', () => {
  const result = scoreCharacter({ id: 2, name: '低层样本', server: { name: '测试服' }, zoneRankings: {
    allStars: [{ spec: 'Arms', points: 1200, rankPercent: 90 }],
    throughputRankings: { '1': { best_historical_percentile: 99, median_historical_percentile: 98, best_level: 14 } },
    rankings: [{ encounter: { id: 1, name: '测试副本' }, totalKills: 30 }],
  }});
  assert.equal(result.outputScore, 0);
  assert.equal(result.sampleCount, 0);
  assert.equal(result.eligible, false);
  assert.equal(result.outputGrade, '样本不足');
});

test('explicit growth analysis can include five-to-fourteen keys', () => {
  const character = { id: 12, name: '成长角色', server: { name: '红云台地' }, zoneRankings: {
    allStars: [{ spec: 'Devourer', points: 1200 }],
    throughputRankings: { '12923': { best_historical_percentile: 27, best_level: 8 } },
    rankings: [{ encounter: { id: 12923, name: '虚空之痕竞技场' }, totalKills: 1 }],
  } };
  assert.equal(scoreCharacter(character).sampleCount, 0);
  const growth = scoreCharacter(character, { minKeyLevel: 5 });
  assert.equal(growth.minKeyLevel, 5);
  assert.equal(growth.sampleCount, 1);
  assert.equal(growth.outputScore, 27);
});
