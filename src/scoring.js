function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function grade(score) {
  if (score >= 95) return 'S';
  if (score >= 75) return 'A';
  if (score >= 50) return 'B';
  if (score >= 25) return 'C';
  return 'D';
}

function tier(score) {
  if (score >= 95) return '顶尖段';
  if (score >= 75) return '高玩段';
  if (score >= 25) return '大众段';
  return '靠后段';
}

function scoreCharacter(character, options = {}) {
  if (!character?.zoneRankings) return null;
  const minKeyLevel = Math.max(5, Number(options.minKeyLevel) || 15);
  const z = character.zoneRankings;
  const rankings = Array.isArray(z.rankings) ? z.rankings : [];
  const throughput = z.throughputRankings || {};
  const throughputEntries = Object.values(throughput).filter((r) =>
    Number.isFinite(r?.best_historical_percentile) && Number(r.best_level || 0) >= minKeyLevel
  );
  const active = rankings.filter((r) => {
    const damage = throughput[String(r.encounter?.id)] || {};
    return (r.totalKills || 0) > 0 && Number(damage.best_level || 0) >= minKeyLevel;
  });
  const outputScore = throughputEntries.length
    ? throughputEntries.reduce((sum, r) => sum + clamp(r.best_historical_percentile), 0) / throughputEntries.length
    : 0;
  const medianOutputScore = throughputEntries.length
    ? throughputEntries.reduce((sum, r) => sum + clamp(r.median_historical_percentile), 0) / throughputEntries.length
    : 0;
  const primary = [...(z.allStars || [])].sort((a, b) => (b.points || 0) - (a.points || 0))[0];
  const dungeons = rankings.map((r) => {
    const damage = throughput[String(r.encounter?.id)] || {};
    return {
    id: r.encounter?.id,
    name: r.encounter?.name || '未知副本',
    keyScorePercent: clamp(r.rankPercent),
    outputPercent: clamp(damage.best_historical_percentile),
    medianOutputPercent: clamp(damage.median_historical_percentile),
    runs: r.totalKills || 0,
    bestLevel: damage.best_level || r.bestRank?.ilvl || null,
    dps: damage.best_per_second_amount || 0,
  }}).filter((d) => Number(d.bestLevel || 0) >= minKeyLevel).sort((a, b) => b.outputPercent - a.outputPercent);
  const publicRunCount = dungeons.reduce((sum, d) => sum + d.runs, 0);
  const sampleCount = dungeons.length;
  const highestLevel = dungeons.reduce((max, d) => Math.max(max, Number(d.bestLevel || 0)), 0) || null;
  const confidence = sampleCount >= 6 ? '高' : sampleCount >= 3 ? '中' : '低';
  return {
    character: {
      id: character.id,
      canonicalID: character.canonicalID,
      name: character.name,
      classID: character.classID,
      server: character.server,
    },
    spec: primary?.spec || '未知',
    playerScore: primary?.points || 0,
    rankPercent: clamp(primary?.rankPercent),
    highestLevel,
    minKeyLevel,
    eligible: throughputEntries.length > 0,
    outputScore: Math.round(outputScore * 10) / 10,
    medianOutputScore: Math.round(medianOutputScore * 10) / 10,
    outputGrade: throughputEntries.length ? grade(outputScore) : '样本不足',
    outputTier: throughputEntries.length ? tier(outputScore) : '样本不足',
    technique: null,
    techniqueGrade: null,
    scoreVersion: 'same-key-output-v6-bands',
    sampleCount,
    publicRunCount,
    confidence,
    dungeons,
    caveats: [
      `只使用${minKeyLevel}层及以上的公开记录；低层记录不参与评分和置信度。`,
      '大秘总分和最高层只作为履历信息展示，不参与技术评分。',
      '限时率和词缀不计分：公开上传样本有明显选择偏差。',
      '输出分仍会受坦克路线、合波规模、队伍伤害和死亡影响，不等同于纯手法评分。',
      '技术评级需要读取多场完整报告的施法、目标选择、死亡和功能技能事件。',
      '这是基于公开记录的候选人筛选评分，不等于对玩家人格或真实水平的最终判断。',
      '没有公开记录或样本较少时，应降低置信度，而不是直接判定为低水平。',
    ],
  };
}

function scoreRaidCharacter(character, role = 'DAMAGER') {
  if (!character?.zoneRankings) return null;
  const z = character.zoneRankings;
  const rankings = Array.isArray(z.rankings) ? z.rankings : [];
  const bosses = rankings.map((r) => ({
    id: r.encounter?.id,
    name: r.encounter?.name || '未知Boss',
    bestPercent: clamp(r.rankPercent),
    medianPercent: clamp(r.medianPercent),
    kills: r.totalKills || 0,
    amount: r.bestAmount || 0,
    spec: r.bestSpec || r.spec,
  })).sort((a, b) => b.bestPercent - a.bestPercent);
  const sampleCount = bosses.reduce((sum, b) => sum + b.kills, 0);
  const performance = clamp(z.bestPerformanceAverage);
  return {
    character: { id: character.id, canonicalID: character.canonicalID, name: character.name, classID: character.classID, server: character.server },
    mode: 'raid', role,
    metricLabel: role === 'HEALER' ? '同Boss有效治疗分' : role === 'TANK' ? '同Boss坦克输出分' : '同Boss输出分',
    outputScore: Math.round(performance * 10) / 10,
    medianOutputScore: Math.round(clamp(z.medianPerformanceAverage) * 10) / 10,
    outputGrade: grade(performance),
    outputTier: tier(performance),
    recordScore: Math.round(clamp(Math.min(100, sampleCount * 3)) * 10) / 10,
    sampleCount,
    confidence: sampleCount >= 20 ? '高' : sampleCount >= 8 ? '中' : '低',
    bosses,
    scoreVersion: 'raid-role-v1',
    fetchedAt: new Date().toISOString(),
    caveats: ['治疗排名受团队承伤和其他治疗影响；坦克不能仅用输出分判断生存能力。'],
  };
}

function tableEntries(table) {
  return Array.isArray(table?.data?.entries) ? table.data.entries : [];
}

function eventCount(table) {
  const countEntry = (entry) => {
    if (Array.isArray(entry?.entries)) return entry.entries.reduce((sum, child) => sum + countEntry(child), 0);
    if (Array.isArray(entry?.details)) return entry.details.reduce((sum, detail) => sum + Number(detail.total || 0), 0);
    return Number(entry?.uses ?? entry?.total ?? entry?.hitCount ?? 0);
  };
  return tableEntries(table).reduce((sum, entry) => sum + countEntry(entry), 0);
}

function summarizeDeepReport(report, role = 'DAMAGER') {
  const casts = tableEntries(report.tables.casts);
  const damage = tableEntries(report.tables.damage).sort((a, b) => (b.total || 0) - (a.total || 0));
  const healing = tableEntries(report.tables.healing).sort((a, b) => (b.total || 0) - (a.total || 0));
  const durationMs = report.fight ? report.fight.endTime - report.fight.startTime : report.tables.damage?.data?.totalTime || 0;
  const minutes = Math.max(1 / 60, durationMs / 60000);
  const castTotal = casts.reduce((sum, e) => sum + Number(e.total || e.hitCount || 0), 0);
  const defensiveNames = /shield|wall|fortitude|survival|regeneration|victory|reflection|barrier|block|barkskin|dispersion|ice block|divine protection|自愈|盾墙|破釜|再生|胜利|反射|屏障|树皮|冰箱|圣佑/i;
  const controlNames = /stun|shockwave|storm bolt|fear|intimidat|incapac|silence|knock|震荡|风暴之锤|恐惧|昏迷|沉默/i;
  const defensives = casts.filter((e) => defensiveNames.test(e.name || '')).reduce((sum, e) => sum + Number(e.total || e.hitCount || 0), 0);
  const controls = casts.filter((e) => controlNames.test(e.name || '')).reduce((sum, e) => sum + Number(e.total || e.hitCount || 0), 0);
  return {
    summaryVersion: 2,
    reportCode: report.reportCode, fightID: report.fightID, encounter: report.fight?.name,
    keyLevel: report.fight?.keystoneLevel || null, durationMinutes: Math.round(minutes * 10) / 10,
    role, deaths: tableEntries(report.tables.deaths).length,
    castsPerMinute: Math.round((castTotal / minutes) * 10) / 10,
    interrupts: eventCount(report.tables.interrupts),
    dispels: eventCount(report.tables.dispels),
    defensives, controls,
    topCasts: [...casts].sort((a, b) => Number(b.total || b.hitCount || 0) - Number(a.total || a.hitCount || 0)).slice(0, 20)
      .map((e) => ({ name: e.name, spellID: Number(e.guid) || 0, casts: Number(e.total || e.hitCount || 0) })),
    topDamage: damage.slice(0, 8).map((e) => ({ name: e.name, spellID: Number(e.guid) || 0, total: e.total || 0, uses: e.uses || e.hitCount || 0 })),
    topHealing: healing.slice(0, 8).map((e) => ({ name: e.name, total: e.total || 0, uses: e.uses || e.hitCount || 0 })),
    note: role === 'TANK' ? '坦克重点结合死亡、自保、打断控制；路线质量仍需队伍级时间线。' : role === 'HEALER' ? '治疗重点结合死亡、驱散和有效治疗；不能只看每秒治疗量。' : '输出职责重点结合技能频率、爆发技能、打断控制和死亡。',
  };
}

function estimateTeam(players, targetLevel = 10) {
  const valid = players.filter(Boolean);
  if (!valid.length) return { probability: null, confidence: '无', reason: '没有可用玩家数据' };
  const mean = valid.reduce((s, p) => s + p.outputScore, 0) / valid.length;
  const completeness = valid.length / 5;
  const highConfidence = valid.length === 5 && valid.every((p) => p.confidence !== '低');
  return {
    probability: null,
    confidence: highConfidence ? '中高' : valid.length >= 4 ? '中' : '低',
    teamScore: Math.round(mean * 10) / 10,
    evaluatedPlayers: valid.length,
    targetLevel: Math.max(15, Number(targetLevel) || 15),
    completeness: Math.round(completeness * 100),
    warning: '不估算“限时成功率”：未限时样本常未上传，概率会严重失真。队伍结果只用于展示成员表现和数据完整度。',
  };
}

module.exports = { clamp, grade, tier, scoreCharacter, scoreRaidCharacter, summarizeDeepReport, estimateTeam };
