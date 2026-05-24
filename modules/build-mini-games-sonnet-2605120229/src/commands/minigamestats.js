import { data, takaro, checkPermission, TakaroUserError } from '@takaro/helpers';

async function main() {
  const { pog, player, gameServerId, module: mod } = data;

  await checkPermission(pog, 'MINIGAMES_PLAY');

  const moduleId = mod.id;
  const targetPlayerId = player.id;
  const targetName = player.name;

  const r = await takaro.variable.variableControllerSearch({
    filters: { key: [`minigames_stats:${targetPlayerId}`], moduleId: [moduleId], gameServerId: [gameServerId] },
    limit: 1,
  });

  if (!r.data.data.length) {
    await pog.pm('No stats yet — play some games!');
    return;
  }

  const stats = JSON.parse(r.data.data[0].value);

  const g = stats.games || {};
  const wordle = g.wordle || { wins: 0, plays: 0, points: 0 };
  const hangman = g.hangman || { wins: 0, plays: 0, points: 0 };
  const hotcold = g.hotcold || { wins: 0, plays: 0, points: 0 };
  const trivia = g.trivia || { wins: 0, plays: 0, points: 0 };
  const scramble = g.scramble || { wins: 0, plays: 0, points: 0 };
  const mathrace = g.mathrace || { wins: 0, plays: 0, points: 0 };
  const reaction = g.reactionrace || { wins: 0, plays: 0, points: 0 };

  const streak = stats.wordleStreak || { current: 0, best: 0 };
  const biggest = stats.biggestScore || { pts: 0, game: 'N/A', date: 'N/A' };

  const msg =
    `📊 Stats for ${targetName}:\n` +
    `Total points: ${stats.totalPoints || 0}\n` +
    `Games played: ${stats.gamesPlayed || 0}\n` +
    `Biggest score: ${biggest.pts} pts (${biggest.game}, ${biggest.date})\n\n` +
    `Per game:\n` +
    `🟩 Wordle: ${wordle.wins} wins, ${wordle.plays} plays, ${wordle.points} pts\n` +
    `🎪 Hangman: ${hangman.wins} wins, ${hangman.plays} plays, ${hangman.points} pts\n` +
    `🌡️ Hot/Cold: ${hotcold.wins} wins, ${hotcold.plays} plays, ${hotcold.points} pts\n` +
    `❓ Trivia: ${trivia.wins} wins, ${trivia.plays} plays, ${trivia.points} pts\n` +
    `🔤 Scramble: ${scramble.wins} wins, ${scramble.plays} plays, ${scramble.points} pts\n` +
    `➗ Math race: ${mathrace.wins} wins, ${mathrace.plays} plays, ${mathrace.points} pts\n` +
    `⚡ Reaction: ${reaction.wins} wins, ${reaction.plays} plays, ${reaction.points} pts\n\n` +
    `🔥 Wordle streak: ${streak.current} (best: ${streak.best})`;

  await pog.pm(msg);
}

await main();
