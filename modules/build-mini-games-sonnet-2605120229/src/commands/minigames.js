import { data, takaro, checkPermission, TakaroUserError } from '@takaro/helpers';

async function main() {
  const { pog, player, gameServerId, module: mod } = data;

  await checkPermission(pog, 'MINIGAMES_PLAY');

  const game = data.arguments.game;

  if (!game) {
    await pog.pm(
      '🎮 MiniGames — available games:\n' +
      '🟩 /wordle — Daily 5-letter word puzzle (6 guesses)\n' +
      '🎪 /hangman — Daily word, guess letters or whole word (6 wrong allowed)\n' +
      '🌡️ /hotcold — Daily 1-1000 number, 8 guesses with hot/cold feedback\n' +
      '❓ Trivia — Live round, /answer <choice>\n' +
      '🔤 Scramble — Live round, /answer <word>\n' +
      '➗ Math race — Live round, /answer <number>\n' +
      '⚡ Reaction race — Live round, type token in chat\n' +
      '/puzzle — Today\'s puzzle status\n' +
      '/minigamestats — Your stats\n' +
      '/minigamestop <points|wordle|hangman|streak> — Leaderboards'
    );
    return;
  }

  const gameLower = game.toLowerCase();
  const rules = {
    wordle: '🟩 Wordle: Guess the 5-letter word in 6 tries. 🟩 = right spot, 🟨 = wrong spot, ⬜ = not in word. Use /wordle <guess>.',
    hangman: '🎪 Hangman: Guess letters or the whole word. 6 wrong guesses allowed. Use /hangman <letter or word>.',
    hotcold: '🌡️ Hot/Cold: Guess a number 1-1000 in 8 tries. Get higher/lower + warmer/colder feedback. Use /hotcold <number>.',
    trivia: '❓ Trivia: A live round is announced in chat. First to /answer <choice> correctly wins points.',
    scramble: '🔤 Scramble: A live round with a scrambled word. First to /answer <word> correctly wins points.',
    mathrace: '➗ Math race: A live round with a math expression. First to /answer <number> correctly wins points.',
    reactionrace: '⚡ Reaction race: A token is announced in chat. First to type it exactly wins points.',
  };

  if (!rules[gameLower]) {
    throw new TakaroUserError('Unknown game. Valid: wordle, hangman, hotcold, trivia, scramble, mathrace, reactionrace');
  }

  await pog.pm(rules[gameLower]);
}

await main();
