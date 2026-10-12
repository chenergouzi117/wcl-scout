const { clamp } = require('./scoring');

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function peerPercentile(value, peer, lowerIsBetter = false) {
  if (!Number.isFinite(value) || !peer || !Number.isFinite(peer.q25) || !Number.isFinite(peer.median) || !Number.isFinite(peer.q75)) return null;
  let score;
  if (value <= peer.q25) score = peer.q25 === 0 ? 25 : 25 * value / peer.q25;
  else if (value <= peer.median) score = 25 + 25 * (value - peer.q25) / Math.max(1e-9, peer.median - peer.q25);
  else if (value <= peer.q75) score = 50 + 25 * (value - peer.median) / Math.max(1e-9, peer.q75 - peer.median);
  else score = 75 + 25 * (value - peer.q75) / Math.max(1e-9, peer.q75 - peer.median);
  score = clamp(score);
  return Math.round((lowerIsBetter ? 100 - score : score) * 10) / 10;
}

function scoreCapabilities(playerRuns, template, keyLevel) {
  const peer = template?.observed?.levels?.[String(keyLevel)];
  if (!peer || !playerRuns?.length) return { status: 'insufficient', reason: '没有同副本同层且同专精的可比样本' };
  const perMinute = (run, field) => Number(run.summary?.[field] || 0) / Math.max(1 / 60, Number(run.summary?.durationMinutes || 0));
  const corrected = playerRuns.filter((run) => Number(run.summary?.summaryVersion || 0) >= 2);
  const output = peerPercentile(median(playerRuns.map((run) => Number(run.ranking?.amount))), peer.dps);
  const survival = peerPercentile(median(playerRuns.map((run) => Number(run.summary?.deaths || 0))), peer.deathsPerRun, true);
  const defensive = peerPercentile(median(playerRuns.map((run) => perMinute(run, 'defensives'))), peer.defensivesPerMinute);
  const interrupt = peer.utility?.interruptsPerMinute && corrected.length
    ? peerPercentile(median(corrected.map((run) => perMinute(run, 'interrupts'))), peer.utility.interruptsPerMinute)
    : null;
  const control = peerPercentile(median(playerRuns.map((run) => perMinute(run, 'controls'))), peer.controlsPerMinute);
  const dispel = peer.utility?.dispelsPerMinute && corrected.length
    ? peerPercentile(median(corrected.map((run) => perMinute(run, 'dispels'))), peer.utility.dispelsPerMinute)
    : null;
  const choreParts = [control, dispel].filter(Number.isFinite);
  return {
    status: 'ok',
    keyLevel: Number(keyLevel),
    sampleCount: playerRuns.length,
    capabilities: {
      output: { score: output, evidence: output == null ? '不足' : '可用' },
      survival: { score: survival, defensiveScore: defensive, evidence: survival == null ? '不足' : '初步' },
      interrupts: { score: interrupt, evidence: interrupt == null ? '待校正样本' : '可用' },
      chores: { score: choreParts.length ? Math.round(choreParts.reduce((a, b) => a + b, 0) / choreParts.length * 10) / 10 : null, controlScore: control, dispelScore: dispel, evidence: choreParts.length ? '初步' : '不足' },
    },
    warning: '分数是相对同副本、同层数、同专精样本的位置；机制机会数未完成校正的项目不作强结论。',
  };
}

module.exports = { median, peerPercentile, scoreCapabilities };
