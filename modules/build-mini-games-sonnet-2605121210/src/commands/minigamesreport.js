import { data, takaro, TakaroUserError, checkPermission } from '@takaro/helpers';

async function main() {
  const { pog, gameServerId } = data;
  const moduleId = data.module.moduleId;

  if (!checkPermission(pog, 'MINIGAMES_MANAGE')) {
    throw new TakaroUserError('You do not have permission to use this command.');
  }

  const days = data.arguments.days || 7;

  async function readVar(key) {
    const res = await takaro.variable.variableControllerSearch({
      filters: { key: [key], gameServerId: [gameServerId], moduleId: [moduleId] },
      page: 0, limit: 1
    });
    return res.data.data.length > 0 ? { id: res.data.data[0].id, value: JSON.parse(res.data.data[0].value) } : null;
  }

  // Read leaderboard cache
  const leaderboardVar = await readVar('minigames_leaderboard_cache');
  const leaderboard = leaderboardVar ? leaderboardVar.value : null;

  // Read all stats variables
  const allStatsRes = await takaro.variable.variableControllerSearch({
    filters: { gameServerId: [gameServerId], moduleId: [moduleId] },
    search: { key: ['minigames_stats:'] },
    page: 0, limit: 100
  });

  const allStats = allStatsRes.data.data || [];

  // Aggregate totals
  let totalPoints = 0;
  let totalGamesPlayed = 0;
  const perGame = {};

  for (const varRecord of allStats) {
    try {
      const stats = JSON.parse(varRecord.value);
      if (typeof stats.totalPoints === 'number') totalPoints += stats.totalPoints;
      if (typeof stats.gamesPlayed === 'number') totalGamesPlayed += stats.gamesPlayed;
      if (stats.perGame && typeof stats.perGame === 'object') {
        for (const [game, count] of Object.entries(stats.perGame)) {
          perGame[game] = (perGame[game] || 0) + (typeof count === 'number' ? count : 0);
        }
      }
    } catch (e) {
      // skip malformed records
    }
  }

  // Build per-game breakdown
  const gameEmojis = {
    trivia: '❓',
    scramble: '🔤',
    mathrace: '🔢',
    reactionrace: '⚡',
    wordle: '🟩',
    hangman: '🎪',
    numberguess: '🔮',
    memorymatrix: '🧠'
  };

  let perGameLines = '';
  const gameEntries = Object.entries(perGame);
  if (gameEntries.length === 0) {
    perGameLines = 'No per-game data available.';
  } else {
    perGameLines = gameEntries
      .sort((a, b) => b[1] - a[1])
      .map(([game, count]) => {
        const emoji = gameEmojis[game] || '🎮';
        return `${emoji} ${game}: ${count} rounds`;
      })
      .join('\n');
  }

  // Top 5 players from leaderboard cache or computed from allStats
  let top5Lines = '';
  if (leaderboard && Array.isArray(leaderboard.entries) && leaderboard.entries.length > 0) {
    top5Lines = leaderboard.entries
      .slice(0, 5)
      .map((entry, i) => `${i + 1}. ${entry.name || entry.playerId} — ${entry.points || 0} pts`)
      .join('\n');
  } else if (allStats.length > 0) {
    // Build from raw stats
    const playerPoints = [];
    for (const varRecord of allStats) {
      try {
        const stats = JSON.parse(varRecord.value);
        const pts = stats.totalPoints || 0;
        const name = stats.playerName || varRecord.key.replace('minigames_stats:', '');
        playerPoints.push({ name, pts });
      } catch (e) {}
    }
    playerPoints.sort((a, b) => b.pts - a.pts);
    top5Lines = playerPoints.slice(0, 5)
      .map((p, i) => `${i + 1}. ${p.name} — ${p.pts} pts`)
      .join('\n') || 'No players yet.';
  } else {
    top5Lines = 'No players yet.';
  }

  const report = [
    `📊 Mini-Games Report (all-time, note: ${days}-day filter not available):`,
    `Total points awarded: ${totalPoints.toLocaleString()}`,
    `Total rounds played: ${totalGamesPlayed.toLocaleString()}`,
    ``,
    `Per-game:`,
    perGameLines,
    ``,
    `Top 5 players:`,
    top5Lines
  ].join('\n');

  await pog.pm(report);
}

await main();
