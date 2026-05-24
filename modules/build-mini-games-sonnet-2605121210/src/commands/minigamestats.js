import { data, takaro, TakaroUserError, checkPermission } from '@takaro/helpers';

async function main() {
  const { pog, player, gameServerId } = data;
  const moduleId = data.module.moduleId;
  const playerId = player?.id;
  const playerName = player?.name || 'Unknown';

  const targetArg = data.arguments.player ? data.arguments.player.trim() : null;
  if (targetArg) {
    await pog.pm(`Player lookup by name is not yet supported. Showing your own stats instead.`);
  }

  // Read stats variable
  const statsKey = `minigames_stats:${playerId}`;
  const statsRes = await takaro.variable.variableControllerSearch({
    filters: { key: [statsKey], gameServerId: [gameServerId], moduleId: [moduleId] },
    page: 0,
    limit: 1,
  });
  const statsData = statsRes.data.data.length > 0 ? JSON.parse(statsRes.data.data[0].value) : null;

  if (!statsData) {
    await pog.pm('No stats yet — start playing!');
    return;
  }

  // Read today's window variable
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const windowKey = `minigames_window:${playerId}:${today}`;
  const windowRes = await takaro.variable.variableControllerSearch({
    filters: { key: [windowKey], gameServerId: [gameServerId], moduleId: [moduleId] },
    page: 0,
    limit: 1,
  });
  const windowData = windowRes.data.data.length > 0 ? JSON.parse(windowRes.data.data[0].value) : null;

  const totalPoints = statsData.totalPoints || 0;
  const gamesPlayed = statsData.gamesPlayed || 0;
  const bestScore = statsData.bestScore || 0;
  const bestScoreGame = statsData.bestScoreGame || 'unknown';

  const wordle  = statsData.wordle  || { wins: 0, points: 0, streak: 0 };
  const hangman = statsData.hangman || { wins: 0, points: 0 };
  const hotcold = statsData.hotcold || { wins: 0, points: 0 };
  const trivia  = statsData.trivia  || { wins: 0, points: 0 };
  const scramble = statsData.scramble || { wins: 0, points: 0 };
  const math    = statsData.math    || { wins: 0, points: 0 };
  const reaction = statsData.reaction || { wins: 0, points: 0 };

  const formatNum = (n) => n.toLocaleString ? n.toLocaleString() : String(n);

  let msg =
    `📊 Stats for ${playerName}:\n` +
    `Total Points: ${formatNum(totalPoints)}\n` +
    `Games Played: ${gamesPlayed}\n` +
    `Best Score: ${bestScore} pts (${bestScoreGame})\n` +
    `\n` +
    `Per-game breakdown:\n` +
    `🟩 Wordle: ${wordle.wins} wins, ${formatNum(wordle.points)} pts` +
      (wordle.streak > 0 ? ` (streak: ${wordle.streak} 🔥)` : '') + `\n` +
    `🎪 Hangman: ${hangman.wins} wins, ${formatNum(hangman.points)} pts\n` +
    `🌡️ Hot/Cold: ${hotcold.wins} wins, ${formatNum(hotcold.points)} pts\n` +
    `❓ Trivia: ${trivia.wins} wins, ${formatNum(trivia.points)} pts\n` +
    `🔤 Scramble: ${scramble.wins} wins, ${formatNum(scramble.points)} pts\n` +
    `➗ Math: ${math.wins} wins, ${formatNum(math.points)} pts\n` +
    `⚡ Reaction: ${reaction.wins} wins, ${formatNum(reaction.points)} pts`;

  if (windowData) {
    const todayPts = windowData.points || 0;
    const cap = windowData.cap || null;
    msg += `\n\nToday's points: ${formatNum(todayPts)}`;
    if (cap) {
      msg += ` / ${formatNum(cap)} cap`;
    }
  }

  await pog.pm(msg);
}

await main();
