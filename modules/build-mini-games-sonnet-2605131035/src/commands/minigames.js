import { data, takaro, TakaroUserError, checkPermission } from '@takaro/helpers';

async function main() {
  const { pog, player, gameServerId, module: mod } = data;
  const userConfig = mod.userConfig;
  const moduleId = mod.moduleId;
  const playerId = player?.id;

  if (!checkPermission(pog, 'MINIGAMES_PLAY')) {
    throw new TakaroUserError('You need MINIGAMES_PLAY permission.');
  }

  const game = data.arguments.game?.toLowerCase();

  const gameHelp = {
    wordle: '🟩 Wordle: Guess the daily 5-letter word in 6 tries. /wordle [guess]',
    hangman: '🎪 Hangman: Guess the daily word letter by letter (6 wrong allowed). /hangman [letter|word]',
    hotcold: '🌡️ Hot/Cold: Guess a 1–1000 number in 8 tries with hot/cold hints. /hotcold [number]',
    trivia: '❓ Trivia: First to /answer correctly wins. Live rounds every ' + (userConfig.liveRoundIntervalMinutes || 30) + ' min.',
    scramble: '🔤 Scramble: First to /answer the unscrambled word wins.',
    mathrace: '➗ Math Race: First to /answer the math expression wins.',
    reactionrace: '⚡ Reaction Race: First to type the token in chat wins.',
  };

  if (game && gameHelp[game]) {
    await pog.pm(gameHelp[game]);
  } else if (game) {
    await pog.pm('Unknown game "' + game + '". Valid: wordle, hangman, hotcold, trivia, scramble, mathrace, reactionrace');
  } else {
    const lines = [
      '🎮 miniGames — Skill-based mini-games with points & leaderboards!',
      '📅 Daily puzzles: /wordle, /hangman, /hotcold',
      '⚡ Live rounds (every ' + (userConfig.liveRoundIntervalMinutes || 30) + ' min): answer with /answer <response>',
      '📊 Stats: /minigamestats | 🏆 Leaderboards: /minigamestop <points|wordle|hangman|streak>',
      '📋 Today\'s puzzle status: /puzzle | 🎯 Game help: /minigames <gameName>',
    ];
    for (const line of lines) await pog.pm(line);
  }
}

await main();
