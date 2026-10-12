const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'WCLScout');
const configPath = path.join(appDir, 'config.json');
const cachePath = path.join(appDir, 'cache.json');

function readJson(file, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function loadConfig() {
  const saved = readJson(configPath);
  return {
    clientId: process.env.WCL_CLIENT_ID || saved.clientId || '',
    clientSecret: process.env.WCL_CLIENT_SECRET || saved.clientSecret || '',
    port: Number(process.env.WCL_SCOUT_PORT || saved.port || 17385),
    zoneId: Number(process.env.WCL_ZONE_ID || saved.zoneId || 55),
    cacheHours: Number(saved.cacheHours || 12),
  };
}

function saveCredentials({ clientId, clientSecret }) {
  fs.mkdirSync(appDir, { recursive: true });
  const current = readJson(configPath);
  fs.writeFileSync(configPath, JSON.stringify({ ...current, clientId, clientSecret }, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  });
}

module.exports = { appDir, cachePath, configPath, loadConfig, saveCredentials };
