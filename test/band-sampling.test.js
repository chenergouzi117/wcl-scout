const test = require('node:test');
const assert = require('node:assert/strict');
const { tierFor } = require('../tools/collect-band-samples');

test('uses fixed dispersed bands for populous specializations', () => {
  assert.equal(tierFor(50, 2000), '顶尖段');
  assert.equal(tierFor(300, 2000), '高玩段');
  assert.equal(tierFor(800, 2000), '大众段');
  assert.equal(tierFor(1200, 2000), '靠后段');
});

test('adapts bands for a small specialization population', () => {
  assert.equal(tierFor(5, 100), '顶尖段');
  assert.equal(tierFor(20, 100), '高玩段');
  assert.equal(tierFor(60, 100), '大众段');
  assert.equal(tierFor(90, 100), '靠后段');
});
