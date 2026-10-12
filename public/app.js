const $ = (id) => document.getElementById(id);

async function api(path, payload) {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '请求失败');
  return result;
}

function render(result) {
  const rows = result.dungeons.slice(0, 8).map((d) => `<tr><td>${d.name}</td><td>${d.bestLevel ?? '—'}</td><td>${Math.round(d.dps).toLocaleString()}</td><td>${d.outputPercent.toFixed(0)}</td><td>${d.runs}</td></tr>`).join('');
  $('result').innerHTML = `
    <div class="scoreline"><div class="grade">${result.outputGrade}</div><div class="meta"><h2>${result.character.name}</h2><p>${result.character.server.name} · ${result.spec}</p><p><strong>同层/同装等输出评级</strong> · ${result.cached ? '来自本地缓存' : '刚刚从WCL更新'} · 数据置信度 ${result.confidence}</p></div></div>
    <div class="metrics"><div class="metric"><b>${result.outputScore}</b><span>${result.minKeyLevel}+同层输出分</span></div><div class="metric"><b>${result.medianOutputScore}</b><span>${result.minKeyLevel}+中位输出分</span></div><div class="metric"><b>${result.highestLevel ?? '—'}</b><span>最高层（仅履历）</span></div><div class="metric"><b>${Math.round(result.playerScore || 0)}</b><span>WCL总分（仅履历）</span></div></div>
    <p class="warning">只分析 ${result.minKeyLevel} 层及以上有成绩的副本。总分、最高层、限时率和词缀均不参与技术评分；输出分仍需结合路线、合波、队伍伤害和死亡解读。有效副本覆盖：${result.sampleCount}个。</p>
    <table><thead><tr><th>副本</th><th>匹配层数</th><th>DPS</th><th>同层输出分</th><th>完成样本</th></tr></thead><tbody>${rows}</tbody></table>`;
  $('result').classList.remove('hidden');
}

$('searchForm').addEventListener('submit', async (event) => {
  event.preventDefault(); $('status').textContent = '正在读取WCL公开记录…'; $('result').classList.add('hidden');
  try {
    const result = await api('/api/player', { name: $('name').value, server: $('server').value, region: $('region').value });
    render(result); $('status').textContent = result.rateLimit ? `API额度：已使用 ${result.rateLimit.pointsSpentThisHour.toFixed(1)} / ${result.rateLimit.limitPerHour}` : '';
  } catch (error) { $('status').textContent = error.message; }
});

$('settingsButton').onclick = () => $('settings').showModal();
$('closeSettings').onclick = () => $('settings').close();
$('settingsForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try { await api('/api/settings', { clientId: $('clientId').value, clientSecret: $('clientSecret').value }); $('settings').close(); $('status').textContent = 'API设置已保存。'; }
  catch (error) { $('status').textContent = error.message; }
});

fetch('/api/health').then((r) => r.json()).then((h) => { if (!h.configured) $('settings').showModal(); });
