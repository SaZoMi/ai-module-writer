import { data, takaro, TakaroUserError, checkPermission } from '@takaro/helpers';

async function main() {
  const { pog, player, gameServerId } = data;
  const game = data.arguments.game ? data.arguments.game.toLowerCase().trim() : null;

  if (!game) {
    await pog.pm(
      '🎮 Mini-Games — Available games:\n' +
      '🟩 /wordle — Daily 5-letter word (6 guesses)\n' +
      '🎪 /hangman — Daily word puzzle (6 wrong max)\n' +
      '🌡️ /hotcold — Daily 1-1000 number (8 guesses)\n' +
      '❓ Trivia — Live round, first correct /answer wins\n' +
      '🔤 Scramble — Live round, unscramble the word\n' +
      '➗ Math Race — Live round, solve the math first\n' +
      '⚡ Reaction Race — Live round, type the token first\n' +
      'Use /puzzle for today\'s daily status, /minigamestats for your stats.'
    );
    return;
  }

  const rules = {
    wordle: '🟩 Wordle — Guess the secret 5-letter word in 6 tries. After each guess you get color hints: 🟩 = correct letter & position, 🟨 = correct letter wrong position, ⬛ = not in word. One new word per day. Use /wordle <guess> to play.',
    hangman: '🎪 Hangman — Guess the hidden daily word one letter at a time. You have 6 wrong guesses before the man is hanged! Use /hangman <letter> to guess. New puzzle every day.',
    hotcold: '🌡️ Hot/Cold — A secret number between 1 and 1000 is chosen each day. You have 8 guesses. After each guess you\'ll be told if you\'re 🔥 Hot (close) or 🧊 Cold (far). Use /hotcold <number> to guess.',
    trivia: '❓ Trivia — A live-round game started by an admin. A trivia question is posted to chat. The first player to type /answer <answer> with the correct answer wins points! Watch chat for announcements.',
    scramble: '🔤 Scramble — A live-round game. A scrambled word is posted to chat. Unscramble it and be the first to type /answer <word> to win points! Watch chat for announcements.',
    mathrace: '➗ Math Race — A live-round game. A math problem is posted to chat. Solve it and be the first to type /answer <number> to win points! Watch chat for announcements.',
    reactionrace: '⚡ Reaction Race — A live-round game. A random token is posted to chat. Be the first player to type /answer <token> exactly to win points! Watch chat for announcements.',
  };

  const ruleText = rules[game];
  if (!ruleText) {
    throw new TakaroUserError(
      `Unknown game "${data.arguments.game}". Valid options: wordle, hangman, hotcold, trivia, scramble, mathrace, reactionrace`
    );
  }

  await pog.pm(ruleText);
}

await main();
