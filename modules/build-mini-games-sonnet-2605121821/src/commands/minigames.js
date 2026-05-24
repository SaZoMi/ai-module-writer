import { data, takaro, TakaroUserError, checkPermission } from '@takaro/helpers';

async function main() {
  const { pog, gameServerId, module: mod } = data;

  const rawGame = data.arguments.game;
  const game = (rawGame && rawGame !== 'all') ? rawGame.toLowerCase().trim() : null;

  const gameHelp = {
    wordle: 'Guess the secret 5-letter word in 6 tries. Letters marked 🟩 (right spot), 🟨 (wrong spot), ⬜ (not in word). Use: /wordle <guess>',
    hangman: 'Guess the secret word letter by letter (max 6 wrong). Use: /hangman <letter> or /hangman <word> to solve instantly.',
    hotcold: 'Guess the secret number 1-1000 in 8 tries. Get Higher/Lower + Warmer/Colder feedback. Use: /hotcold <number>',
    trivia: 'Live round. Answer first with /answer <response>. Multiple choice or true/false.',
    scramble: 'Live round. First to unscramble the word wins. Use /answer <word>.',
    mathrace: 'Live round. Solve the math problem first. Use /answer <number>.',
    reactionrace: 'Live round. Type the token shown in chat as fast as possible — no /answer needed!'
  };

  if (game) {
    const help = gameHelp[game];
    if (!help) {
      throw new TakaroUserError(
        `Unknown game "${game}". Available games: wordle, hangman, hotcold, trivia, scramble, mathrace, reactionrace`
      );
    }
    await pog.pm(`📖 ${game.charAt(0).toUpperCase() + game.slice(1)} Rules: ${help}`);
    return;
  }

  // Overview of all games
  const overview = [
    '🎮 Mini-Games Overview — use /minigames <game> for detailed rules:',
    '🟩 /wordle - Daily 5-letter word puzzle (6 guesses)',
    '🎪 /hangman - Daily word puzzle (6 wrong guesses)',
    '🌡️ /hotcold - Daily number puzzle 1-1000 (8 guesses)',
    '❓ Trivia - Live round, use /answer',
    '🔤 Scramble - Live round, use /answer',
    '➗ Math Race - Live round, use /answer',
    '⚡ Reaction Race - Live round, type token in chat',
    '📅 Use /puzzle to see your daily puzzle status.'
  ].join('\n');

  await pog.pm(overview);
}

await main();
