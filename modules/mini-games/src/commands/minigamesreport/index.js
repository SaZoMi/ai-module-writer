import { data, TakaroUserError, checkPermission } from '@takaro/helpers';
import { searchVariablesByKeyPrefix } from './mini-games-helpers.js';

async function main() {
  const { pog, gameServerId, module: mod } = data;

  if (!checkPermission(pog, 'MINIGAMES_MANAGE')) {
    throw new TakaroUserError('You do not have permission to manage mini-games.');
  }

  const moduleId = mod.moduleId;

  // Aggregate all player stats (lifetime — no date filter supported)
  const allStatVars = await searchVariablesByKeyPrefix(gameServerId, moduleId, 'minigames_stats:');
  const allStats = allStatVars.map(v => {
    try { return JSON.parse(v.value); } catch { return null; }
  }).filter(Boolean);

  const totalPlayers = allStats.length;
  const totalPoints = allStats.reduce((s, st) => s + (st.totalPoints ?? 0), 0);
  const totalGamesPlayed = allStats.reduce((s, st) => s + (st.gamesPlayed ?? 0), 0);

  // Per-game breakdown
  const gameNames = ['wordle', 'hangman', 'hotcold', 'trivia', 'scramble', 'mathrace', 'reactionrace'];
  const perGameTotals = {};
  for (const g of gameNames) {
    perGameTotals[g] = { points: 0, plays: 0, wins: 0 };
    for (const st of allStats) {
      const pg = st.perGame?.[g];
      if (pg) {
        perGameTotals[g].points += pg.points ?? 0;
        perGameTotals[g].plays += pg.plays ?? 0;
        perGameTotals[g].wins += pg.wins ?? 0;
      }
    }
  }

  // Top 5 by total points (using player ID as name; leaderboard cache has resolved names)
  const sorted = allStats
    .map((st, i) => ({ name: allStatVars[i].key.replace('minigames_stats:', ''), points: st.totalPoints ?? 0 }))
    .sort((a, b) => b.points - a.points)
    .slice(0, 5);

  const lines = [
    `📋 miniGames Report (all-time lifetime stats)`,
    `Players with stats: ${totalPlayers}`,
    `Total points awarded: ${totalPoints}`,
    `Total games played: ${totalGamesPlayed}`,
    ``,
    `Top 5 players:`,
    ...sorted.map((p, i) => `  ${i + 1}. ${p.name}: ${p.points} pts`),
    ``,
    `Per-game breakdown:`,
    ...gameNames.filter(g => perGameTotals[g].plays > 0).map(g => {
      const pg = perGameTotals[g];
      return `  ${g}: ${pg.plays} plays, ${pg.wins} wins, ${pg.points} pts`;
    }),
  ];

  await pog.pm(lines.join('\n'));
}

await main();
