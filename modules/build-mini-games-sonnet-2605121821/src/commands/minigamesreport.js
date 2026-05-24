import { data, takaro, TakaroUserError, checkPermission } from '@takaro/helpers';

async function main() {
  const { pog, player, gameServerId, module: mod } = data;

  if (!checkPermission(pog, 'MINIGAMES_MANAGE')) throw new TakaroUserError('No permission.');

  const days = data.arguments.days ?? 7;

  // Fetch all stats variables for this game server
  let allStats = [];
  let page = 0;
  const pageSize = 100;

  while (true) {
    const res = await takaro.variable.variableControllerSearch({
      filters: { gameServerId: [gameServerId] },
      search: { key: ['minigames_stats:'] },
      page,
      limit: pageSize,
    });
    const items = res.data.data;
    allStats = allStats.concat(items);
    if (items.length < pageSize) break;
    page++;
  }

  // Filter only minigames_stats: keys
  const statsEntries = allStats.filter(v => v.key && v.key.startsWith('minigames_stats:'));

  let totalPoints = 0;
  let totalGames = 0;
  const perGame = {};
  const playerPoints = [];

  for (const entry of statsEntries) {
    let stats;
    try {
      stats = JSON.parse(entry.value);
    } catch {
      continue;
    }

    const playerId = entry.key.replace('minigames_stats:', '');
    const playerTotal = stats.totalPoints ?? 0;
    totalPoints += playerTotal;
    playerPoints.push({ playerId, pts: playerTotal });

    if (stats.games && typeof stats.games === 'object') {
      for (const [gameName, gameStats] of Object.entries(stats.games)) {
        if (!perGame[gameName]) perGame[gameName] = { wins: 0, pts: 0 };
        perGame[gameName].wins += gameStats.wins ?? 0;
        perGame[gameName].pts += gameStats.points ?? 0;
        totalGames += gameStats.wins ?? 0;
      }
    }
  }

  // Sort top 5 players
  playerPoints.sort((a, b) => b.pts - a.pts);
  const top5 = playerPoints.slice(0, 5);

  const gameEmojis = {
    wordle: '🟩',
    hangman: '🎪',
    hotcold: '🌡️',
    trivia: '❓',
    scramble: '🔀',
    mathrace: '🔢',
    reactionrace: '⚡',
  };

  let perGameLines = '';
  for (const [gameName, gStats] of Object.entries(perGame)) {
    const emoji = gameEmojis[gameName] ?? '🎮';
    perGameLines += `${emoji} ${gameName}: ${gStats.wins} wins, ${gStats.pts} pts\n`;
  }
  if (!perGameLines) perGameLines = '  (no data)\n';

  let top5Lines = '';
  top5.forEach((p, i) => {
    top5Lines += `${i + 1}. ${p.playerId}: ${p.pts} pts\n`;
  });
  if (!top5Lines) top5Lines = '  (no data)\n';

  const report = [
    `📊 Mini-Games Report (last ${days} days):`,
    `Total Points Awarded: ${totalPoints}`,
    `Total Games Played: ${totalGames}`,
    '',
    'Per Game:',
    perGameLines.trimEnd(),
    '',
    'Top 5 Players:',
    top5Lines.trimEnd(),
    '',
    '(Note: Stats are lifetime totals, not filtered by days in v1)',
  ].join('\n');

  await pog.pm(report);
}

await main();
