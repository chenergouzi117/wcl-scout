const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parsePending, splitCharacter } = require('../src/addon-sync');

test('extracts only explicitly queued player names from SavedVariables', () => {
  const file = path.join(os.tmpdir(), `wcl-scout-${process.pid}.lua`);
  fs.writeFileSync(file, 'WCLScoutDB = {\n ["pending"] = {\n ["x"] = {\n ["name"] = "玩家甲-红云台地",\n ["mode"] = "raid",\n ["role"] = "HEALER",\n ["zoneId"] = 53,\n ["deep"] = true,\n },\n },\n ["applicants"] = { ["y"] = { ["name"] = "不应查询-服务器" } } }');
  assert.deepEqual(parsePending(file), [{ name: '玩家甲-红云台地', mode: 'raid', role: 'HEALER', zoneId: 53, minKeyLevel: 15, deep: true }]);
  fs.unlinkSync(file);
});

test('preserves an explicit growth-analysis floor', () => {
  const file = path.join(os.tmpdir(), `wcl-scout-growth-${process.pid}.lua`);
  fs.writeFileSync(file, 'WCLScoutDB = { ["pending"] = { ["x"] = {\n ["name"] = "示例玩家-示例服务器",\n ["minKeyLevel"] = 5,\n ["deep"] = true,\n },\n } }');
  assert.equal(parsePending(file)[0].minKeyLevel, 5);
  fs.unlinkSync(file);
});

test('splits a full CN character name for WCL lookup', () => {
  assert.deepEqual(splitCharacter('玩家甲-红云台地'), { name: '玩家甲', server: '红云台地', region: 'CN' });
  assert.equal(splitCharacter('没有服务器'), null);
});
