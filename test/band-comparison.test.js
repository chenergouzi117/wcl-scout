const test = require('node:test');
const assert = require('node:assert/strict');
const { specKey, compareDeepToBands } = require('../src/band-comparison');

test('uses Warcraft Logs class identifiers when locating standards', () => {
  assert.equal(specKey({ classID: 11 }, 'Arms'), 'warrior_arms');
  assert.equal(specKey({ classID: 1 }, 'Blood'), 'deathknight_blood');
});

test('Devourer does not inherit Arms technique weights', () => {
  const result = compareDeepToBands({ character: { classID: 12 }, spec: 'Devourer', encounterId: 12923,
    deepAnalysis: { keyLevel: 8, durationMinutes: 18, rankingAmount: 130000, deaths: 0,
      interrupts: 8, controls: 2, dispels: 0, castsPerMinute: 30,
      topCasts: [{ name: 'Void Ray', casts: 90 }] } });
  assert.equal(result.dimensions.rotation, null);
  assert.equal(result.overallScore, null);
  assert.ok(result.dimensions.output.score > 0);
});
