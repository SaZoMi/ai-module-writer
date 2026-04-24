import { data, takaro } from '@takaro/helpers';
import { searchVariablesByKeyPrefix, setVariable } from './mini-games-helpers.js';

async function main() {
  const { gameServerId, module: mod } = data;
  const moduleId = mod.moduleId;

  const allStatVars = await searchVariablesByKeyPrefix(gameServerId, moduleId, 'minigames_stats:');

  const entries = allStatVars.map(v => {
    let stats;
    try { stats = JSON.parse(v.value); } catch { return null; }
    const playerId = v.key.replace('minigames_stats:', '');
    return { playerId, stats };
  }).filter(Boolean);

  // Batch-resolve player names from Takaro — chunked into pages of 100 to stay within API limits
  const nameMap = {};
  const playerIds = entries.map(e => e.playerId);
  const CHUNK_SIZE = 100;
  if (playerIds.length > 0) {
    const chunks = [];
    for (let i = 0; i < playerIds.length; i += CHUNK_SIZE) {
      chunks.push(playerIds.slice(i, i + CHUNK_SIZE));
    }
    const results = await Promise.allSettled(chunks.map(chunk =>
      takaro.player.playerControllerSearch({
        filters: { id: chunk },
        limit: chunk.length,
      })
    ));
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'fulfilled') {
        for (const p of result.value.data.data) {
          nameMap[p.id] = p.name ?? p.id;
        }
      } else {
        console.log(`miniGames refreshLeaderboards: chunk ${i} name lookup failed (${result.reason?.message ?? result.reason}); ${chunks[i].length} players will fall back to playerIds`);
      }
    }
  }
  // Fill in any missing entries with their playerId as display name
  for (const e of entries) {
    if (!nameMap[e.playerId]) nameMap[e.playerId] = e.playerId;
  }

  function topN(arr, n) { return arr.slice(0, n); }

  const byPoints = entries
    .map(e => ({ name: nameMap[e.playerId] ?? e.playerId, value: e.stats.totalPoints ?? 0 }))
    .sort((a, b) => b.value - a.value);

  const byWordle = entries
    .map(e => ({ name: nameMap[e.playerId] ?? e.playerId, value: e.stats.perGame?.wordle?.wins ?? 0 }))
    .filter(e => e.value > 0)
    .sort((a, b) => b.value - a.value);

  const byHangman = entries
    .map(e => ({ name: nameMap[e.playerId] ?? e.playerId, value: e.stats.perGame?.hangman?.wins ?? 0 }))
    .filter(e => e.value > 0)
    .sort((a, b) => b.value - a.value);

  const byStreak = entries
    .map(e => ({ name: nameMap[e.playerId] ?? e.playerId, value: e.stats.streaks?.wordle?.best ?? 0 }))
    .filter(e => e.value > 0)
    .sort((a, b) => b.value - a.value);

  const cache = {
    topPoints: topN(byPoints, 10),
    topWordle: topN(byWordle, 10),
    topHangman: topN(byHangman, 10),
    topStreak: topN(byStreak, 10),
    refreshedAt: new Date().toISOString(),
  };

  await setVariable(gameServerId, moduleId, 'minigames_leaderboard_cache', cache);
  console.log(`miniGames refreshLeaderboards: updated, ${entries.length} players, top points = ${cache.topPoints[0]?.value ?? 0}`);
}

await main();
