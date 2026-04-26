import { data, TakaroUserError, checkPermission } from '@takaro/helpers';

async function main() {
  const { pog, arguments: args } = data;

  if (!checkPermission(pog, 'MINIGAMES_PLAY')) {
    throw new TakaroUserError('You do not have permission to use mini-games.');
  }

  // 'all' is the defaultValue used when no game arg is provided
  const rawGame = args.game ? args.game.toLowerCase().trim() : null;
  const game = (rawGame && rawGame !== 'all') ? rawGame : null;

  const gameHelp = {
    wordle: '🟩 Wordle: Guess the daily 5-letter word in 6 tries. /wordle <guess> or /wordle to check status.',
    hangman: '🎪 Hangman: Guess the daily word letter by letter (6 wrong max). /hangman <letter|word> or /hangman for status.',
    hotcold: '🌡️ Hot/Cold: Guess the secret number 1-1000 in 8 tries. /hotcold <number> or /hotcold for status.',
    trivia: '❓ Trivia: Live rounds — first to /answer <answer> wins!',
    scramble: '🔤 Scramble: Live rounds — unscramble the word. /answer <word>',
    mathrace: '➗ Math race: Live rounds — solve the equation. /answer <number>',
    reactionrace: '⚡ Reaction race: Live rounds — type the token in chat to win!',
    answer: '📣 /answer <response> — Answer the currently active live round.',
    stats: '📊 /minigamestats [player] — View stats. /minigamestop <points|wordle|hangman|streak> — Leaderboards.',
    puzzle: '🗓️ /puzzle — Today\'s puzzle status and time until midnight rollover.',
  };

  if (game) {
    const help = gameHelp[game];
    if (!help) {
      throw new TakaroUserError(`Unknown game: "${args.game}". Valid games: wordle, hangman, hotcold, trivia, scramble, mathrace, reactionrace`);
    }
    await pog.pm(help);
    return;
  }

  const lines = [
    '🎮 miniGames — Unified mini-game module',
    '─────────────────────────────────────',
    '📅 Daily puzzles: /wordle  /hangman  /hotcold',
    '⚡ Live rounds: /answer <response>',
    '📊 Stats: /minigamestats  /minigamestop <points|wordle|hangman|streak>',
    '🗓️ Status: /puzzle',
    'Type /minigames <game> for per-game rules (e.g. /minigames wordle)',
  ];
  await pog.pm(lines.join('\n'));
}

await main();
