import { data, takaro } from '@takaro/helpers';

async function main() {
  const { gameServerId, module: mod } = data;
  const moduleId = mod.id;

  async function readVar(key) {
    const r = await takaro.variable.variableControllerSearch({
      filters: { key: [key], moduleId: [moduleId], gameServerId: [gameServerId] },
      limit: 1,
    });
    return r.data.data.length > 0 ? r.data.data[0] : null;
  }

  async function writeVar(key, value) {
    const existing = await readVar(key);
    if (existing) {
      await takaro.variable.variableControllerUpdate(existing.id, { value: JSON.stringify(value) });
    } else {
      await takaro.variable.variableControllerCreate({ key, value: JSON.stringify(value), moduleId, gameServerId });
    }
  }

  // Fetch all variables for this module + server
  const r = await takaro.variable.variableControllerSearch({
    filters: { moduleId: [moduleId], gameServerId: [gameServerId] },
    limit: 200,
  });
  const allVars = r.data.data;

  // Filter to stats variables only
  const statsVars = allVars.filter((v) => v.key.startsWith('minigames_stats:'));

  // Parse each stats entry
  const entries = statsVars.map((v) => {
    const playerId = v.key.split(':')[1];
    let stats = { totalPoints: 0, perGame: {}, streaks: {} };
    try {
      stats = JSON.parse(v.value);
    } catch (_) {}
    return { playerId, stats };
  });

  // Build top-10 lists
  const topPoints = [...entries]
    .sort((a, b) => (b.stats.totalPoints ?? 0) - (a.stats.totalPoints ?? 0))
    .slice(0, 10)
    .map((e) => ({ playerId: e.playerId, points: e.stats.totalPoints ?? 0, name: null }));

  const topWordle = [...entries]
    .sort((a, b) => (b.stats.perGame?.wordle?.wins ?? 0) - (a.stats.perGame?.wordle?.wins ?? 0))
    .slice(0, 10)
    .map((e) => ({ playerId: e.playerId, wins: e.stats.perGame?.wordle?.wins ?? 0, name: null }));

  const topHangman = [...entries]
    .sort((a, b) => (b.stats.perGame?.hangman?.wins ?? 0) - (a.stats.perGame?.hangman?.wins ?? 0))
    .slice(0, 10)
    .map((e) => ({ playerId: e.playerId, wins: e.stats.perGame?.hangman?.wins ?? 0, name: null }));

  const topStreak = [...entries]
    .sort((a, b) => (b.stats.streaks?.wordle?.best ?? 0) - (a.stats.streaks?.wordle?.best ?? 0))
    .slice(0, 10)
    .map((e) => ({ playerId: e.playerId, streak: e.stats.streaks?.wordle?.best ?? 0, name: null }));

  // Write the cache variable
  await writeVar('minigames_leaderboard_cache', {
    topPoints,
    topWordle,
    topHangman,
    topStreak,
    refreshedAt: new Date().toISOString(),
  });
}

await main();
