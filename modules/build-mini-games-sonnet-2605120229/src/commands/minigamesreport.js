import { data, takaro, checkPermission, TakaroUserError } from '@takaro/helpers';

async function main() {
  const { pog, player, gameServerId, module: mod } = data;

  await checkPermission(pog, 'MINIGAMES_MANAGE');

  const moduleId = mod.id;
  const days = data.arguments.days || 7;

  // Fetch all stats variables by searching with a large limit
  const statsResult = await takaro.variable.variableControllerSearch({
    filters: { moduleId: [moduleId], gameServerId: [gameServerId] },
    limit: 200,
  });

  const allVars = statsResult.data.data || [];
  const statsVars = allVars.filter(v => v.key && v.key.startsWith('minigames_stats:'));

  let totalPoints = 0;
  let playersWhoPlayed = 0;

  const gameWins = {
    wordle: 0,
    hangman: 0,
    hotcold: 0,
    trivia: 0,
    scramble: 0,
    mathrace: 0,
    reactionrace: 0,
  };

  const playerPoints = [];

  for (const v of statsVars) {
    let stats;
    try {
      stats = JSON.parse(v.value);
    } catch {
      continue;
    }

    playersWhoPlayed++;
    const pts = stats.totalPoints || 0;
    totalPoints += pts;

    const playerId = v.key.replace('minigames_stats:', '');
    playerPoints.push({ playerId, pts });

    const g = stats.games || {};
    for (const gameName of Object.keys(gameWins)) {
      if (g[gameName]) {
        gameWins[gameName] += g[gameName].wins || 0;
      }
    }
  }

  playerPoints.sort((a, b) => b.pts - a.pts);
  const top5 = playerPoints.slice(0, 5);

  const top5Lines = top5.length
    ? top5.map((e, i) => `#${i + 1} ${e.playerId} — ${e.pts} pts`).join('\n')
    : 'No data yet.';

  const msg =
    `📊 MiniGames Report (lifetime stats — days filter not yet implemented in v1):\n` +
    `Total points awarded: ${totalPoints}\n` +
    `Players who played: ${playersWhoPlayed}\n\n` +
    `Per-game wins:\n` +
    `🟩 Wordle: ${gameWins.wordle} wins\n` +
    `🎪 Hangman: ${gameWins.hangman} wins\n` +
    `🌡️ Hot/Cold: ${gameWins.hotcold} wins\n` +
    `❓ Trivia: ${gameWins.trivia} wins\n` +
    `🔤 Scramble: ${gameWins.scramble} wins\n` +
    `➗ Math: ${gameWins.mathrace} wins\n` +
    `⚡ Reaction: ${gameWins.reactionrace} wins\n\n` +
    `Top 5 players:\n${top5Lines}`;

  await pog.pm(msg);
}

await main();
