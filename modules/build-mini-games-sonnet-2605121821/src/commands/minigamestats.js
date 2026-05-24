import { data, takaro, TakaroUserError, checkPermission } from '@takaro/helpers';

async function main() {
  const { pog, player, gameServerId, module: mod } = data;

  if (!checkPermission(pog, 'MINIGAMES_PLAY')) {
    throw new TakaroUserError('You do not have permission to use this command.');
  }

  const playerArg = data.arguments.player;

  // Determine target player
  let targetPlayerId;
  let displayName;

  if (!playerArg) {
    targetPlayerId = player.id;
    displayName = player.name;
  } else {
    // Use provided arg as player ID directly (admin-style)
    targetPlayerId = playerArg;
    displayName = 'Player';
  }

  // Helper to get a variable
  async function getVar(key) {
    const res = await takaro.variable.variableControllerSearch({
      filters: { key: [key], gameServerId: [gameServerId] }
    });
    if (res.data.data.length === 0) return null;
    return { id: res.data.data[0].id, value: JSON.parse(res.data.data[0].value) };
  }

  // Read main stats
  const statsVar = await getVar(`minigames_stats:${targetPlayerId}`);
  if (!statsVar) {
    await pog.pm('No stats found for this player yet.');
    return;
  }

  const stats = statsVar.value;

  // Get today's date string (YYYY-MM-DD)
  const today = new Date().toISOString().slice(0, 10);
  const windowVar = await getVar(`minigames_window:${targetPlayerId}:${today}`);
  const todayPoints = windowVar ? (windowVar.value.points || 0) : 0;

  // Helper to safely read per-game data
  function gameStats(gameName) {
    const g = (stats.perGame && stats.perGame[gameName]) || {};
    return {
      wins: g.wins || 0,
      plays: g.plays || 0,
      points: g.points || 0,
    };
  }

  function streakStats(gameName) {
    const s = (stats.streaks && stats.streaks[gameName]) || {};
    return {
      current: s.current || 0,
      best: s.best || 0,
    };
  }

  const biggestScore = stats.biggestScore || { points: 0, game: 'N/A' };
  const wordle = gameStats('wordle');
  const hangman = gameStats('hangman');
  const hotcold = gameStats('hotcold');
  const trivia = gameStats('trivia');
  const scramble = gameStats('scramble');
  const mathrace = gameStats('mathrace');
  const reactionrace = gameStats('reactionrace');
  const wordleStreak = streakStats('wordle');

  const msg = [
    `Stats for ${displayName}:`,
    `Total Points: ${stats.totalPoints || 0} | Games Played: ${stats.gamesPlayed || 0}`,
    `Biggest Score: ${biggestScore.points} pts (${biggestScore.game})`,
    `Today: ${todayPoints} pts earned`,
    ``,
    `Per Game:`,
    `Wordle: ${wordle.wins} wins / ${wordle.plays} plays / ${wordle.points} pts | Streak: ${wordleStreak.current} (best: ${wordleStreak.best})`,
    `Hangman: ${hangman.wins} wins / ${hangman.plays} plays / ${hangman.points} pts`,
    `Hot/Cold: ${hotcold.wins} wins / ${hotcold.plays} plays / ${hotcold.points} pts`,
    `Trivia: ${trivia.wins} wins / ${trivia.plays} plays / ${trivia.points} pts`,
    `Scramble: ${scramble.wins} wins / ${scramble.plays} plays / ${scramble.points} pts`,
    `Math Race: ${mathrace.wins} wins / ${mathrace.plays} plays / ${mathrace.points} pts`,
    `Reaction: ${reactionrace.wins} wins / ${reactionrace.plays} plays / ${reactionrace.points} pts`,
  ].join('\n');

  await pog.pm(msg);
}

await main();
