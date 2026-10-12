const test = require('node:test');
const assert = require('node:assert/strict');
const { peerPercentile, scoreCapabilities } = require('../src/template-scoring');

test('maps peer quartiles to intuitive percentiles', () => {
  const peer = { q25: 10, median: 20, q75: 30 };
  assert.equal(peerPercentile(10, peer), 25);
  assert.equal(peerPercentile(20, peer), 50);
  assert.equal(peerPercentile(30, peer), 75);
});

test('returns four separate capability dimensions without inventing utility evidence', () => {
  const template = { observed: { levels: { 18: {
    dps: { q25: 100, median: 200, q75: 300 }, deathsPerRun: { q25: 0, median: 1, q75: 2 },
    defensivesPerMinute: { q25: 1, median: 2, q75: 3 }, controlsPerMinute: { q25: 1, median: 2, q75: 3 },
    utility: { status: 'insufficient_after_counter_fix' },
  } } } };
  const result = scoreCapabilities([{ ranking: { amount: 200 }, summary: { durationMinutes: 10, deaths: 0, defensives: 20, controls: 20 } }], template, 18);
  assert.equal(result.capabilities.output.score, 50);
  assert.equal(result.capabilities.interrupts.score, null);
  assert.equal(result.capabilities.chores.controlScore, 50);
});
