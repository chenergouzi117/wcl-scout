class WclClient {
  constructor(getConfig) {
    this.getConfig = getConfig;
    this.token = null;
    this.tokenExpiresAt = 0;
  }

  async getToken() {
    if (this.token && Date.now() < this.tokenExpiresAt - 60_000) return this.token;
    const { clientId, clientSecret } = this.getConfig();
    if (!clientId || !clientSecret) throw new Error('请先在本地页面设置日志网站的应用凭据');
    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const response = await fetch('https://www.warcraftlogs.com/oauth/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'WCLScout/0.1 personal-development',
      },
      body: 'grant_type=client_credentials',
    });
    if (!response.ok) throw new Error(`日志网站验证失败（${response.status}）`);
    const result = await response.json();
    this.token = result.access_token;
    this.tokenExpiresAt = Date.now() + Number(result.expires_in || 3600) * 1000;
    return this.token;
  }

  async query(query, variables = {}) {
    const token = await this.getToken();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await fetch('https://www.warcraftlogs.com/api/v2/client', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'User-Agent': 'WCLScout/0.2 research-template-builder',
        },
        body: JSON.stringify({ query, variables }),
      });
      if (response.status === 429 && attempt < 4) {
        const retryAfter = Number(response.headers.get('retry-after')) || (attempt + 1) * 2;
        await new Promise((resolve) => setTimeout(resolve, Math.min(30, retryAfter) * 1000));
        continue;
      }
      const result = await response.json();
      if (!response.ok || result.errors?.length) {
        throw new Error(result.errors?.map((e) => e.message).join('；') || `日志网站请求失败（${response.status}）`);
      }
      return result.data;
    }
    throw new Error('日志网站多次重试后仍被限流');
  }

  async getCharacter(name, serverSlug, region = 'CN', zoneId = 55, metric = 'points_and_damage') {
    const query = `
      query CharacterScout($name: String!, $server: String!, $region: String!, $zone: Int!, $metric: CharacterPageRankingMetricType!) {
        characterData {
          character(name: $name, serverSlug: $server, serverRegion: $region) {
            id canonicalID name classID
            server { name slug region { name slug } }
            zoneRankings(zoneID: $zone, metric: $metric)
          }
        }
        rateLimitData { limitPerHour pointsSpentThisHour pointsResetIn }
      }
    `;
    return this.query(query, { name, server: serverSlug, region: region.toUpperCase(), zone: zoneId, metric });
  }

  async getZone(zoneId = 55) {
    const query = `query ZoneForTemplates($zone: Int!) {
      worldData { zone(id: $zone) { id name brackets { min max bucket type } encounters { id name } } }
      rateLimitData { limitPerHour pointsSpentThisHour pointsResetIn }
    }`;
    return this.query(query, { zone: Number(zoneId) });
  }

  async getClasses(zoneId = 55) {
    const query = `query ClassesForTemplates($zone: Int!) {
      gameData { classes(zone_id: $zone) { id name slug specs { id name slug } } }
      rateLimitData { limitPerHour pointsSpentThisHour pointsResetIn }
    }`;
    return this.query(query, { zone: Number(zoneId) });
  }

  async getEncounterRankings({ encounterId, bracket, className, specName, page = 1, metric = 'dps' }) {
    const query = `query TemplateRanks($encounter: Int!, $bracket: Int!, $class: String!, $spec: String!, $page: Int!, $metric: CharacterRankingMetricType!) {
      worldData { encounter(id: $encounter) {
        id name
        characterRankings(bracket: $bracket, className: $class, specName: $spec, page: $page, metric: $metric, leaderboard: LogsOnly)
      } }
      rateLimitData { limitPerHour pointsSpentThisHour pointsResetIn }
    }`;
    return this.query(query, {
      encounter: Number(encounterId), bracket: Number(bracket), class: className,
      spec: specName, page: Number(page), metric,
    });
  }

  async getEncounterRanking(characterId, encounterId, metric = 'dps') {
    const query = `query DeepRank($character: Int!, $encounter: Int!, $metric: CharacterRankingMetricType!) {
      characterData { character(id: $character) { id name encounterRankings(encounterID: $encounter, metric: $metric, byBracket: true) } }
    }`;
    return this.query(query, { character: characterId, encounter: encounterId, metric });
  }

  async getReportSummary(code, fightID, playerName) {
    const rosterQuery = `query Roster($code: String!, $fight: Int!) {
      reportData { report(code: $code) { fights(fightIDs: [$fight]) { id name startTime endTime keystoneLevel difficulty } playerDetails(fightIDs: [$fight]) } }
    }`;
    const rosterData = await this.query(rosterQuery, { code, fight: fightID });
    const report = rosterData.reportData?.report;
    const details = report?.playerDetails?.data?.playerDetails || report?.playerDetails?.playerDetails || {};
    const all = [...(details.tanks || []), ...(details.healers || []), ...(details.dps || [])];
    const player = all.find((p) => p.name === playerName);
    if (!player) throw new Error('报告中没有定位到该玩家');
    const query = `query Tables($code: String!, $fight: Int!, $source: Int!) {
      reportData { report(code: $code) {
        damage: table(dataType: DamageDone, fightIDs: [$fight], sourceID: $source)
        healing: table(dataType: Healing, fightIDs: [$fight], sourceID: $source)
        casts: table(dataType: Casts, fightIDs: [$fight], sourceID: $source)
        interrupts: table(dataType: Interrupts, fightIDs: [$fight], sourceID: $source)
        dispels: table(dataType: Dispels, fightIDs: [$fight], sourceID: $source)
        deaths: table(dataType: Deaths, fightIDs: [$fight], sourceID: $source)
      }}
    }`;
    const tables = await this.query(query, { code, fight: fightID, source: player.id });
    return { fight: report.fights?.[0], player, tables: tables.reportData.report, reportCode: code, fightID };
  }
}

module.exports = { WclClient };
