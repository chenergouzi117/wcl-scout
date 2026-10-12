const test = require('node:test');
const assert = require('node:assert/strict');
const { summarizeDeepReport } = require('../src/scoring');

test('counts nested WCL interrupt details rather than outer table rows', () => {
  const report = {
    reportCode: 'x', fightID: 1, fight: { name: 'Dungeon', startTime: 0, endTime: 60000, keystoneLevel: 18 },
    tables: {
      casts: { data: { entries: [] } }, damage: { data: { entries: [] } }, healing: { data: { entries: [] } },
      deaths: { data: { entries: [] } }, dispels: { data: { entries: [{ entries: [] }] } },
      interrupts: { data: { entries: [{ entries: [
        { details: [{ name: 'Player', total: 6 }] },
        { details: [{ name: 'Player', total: 3 }] },
      ] }] } },
    },
  };
  assert.equal(summarizeDeepReport(report).interrupts, 9);
});
