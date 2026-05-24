import { data, takaro, TakaroUserError, checkPermission } from '@takaro/helpers';

async function main() {
  const { pog, player, gameServerId, module: mod } = data;
  const moduleId = mod.moduleId;

  // Helper to read a variable
  async function readVar(key, playerId) {
    const filters = { key: [key], gameServerId: [gameServerId], moduleId: [moduleId] };
    if (playerId) filters.playerId = [playerId];
    const res = await takaro.variable.variableControllerSearch({
      filters,
      page: 0,
      limit: 1
    });
    return res.data.data.length > 0 ? JSON.parse(res.data.data[0].value) : null;
  }

  // Read today's puzzle config
  const puzzleToday = await readVar('minigames_puzzle_today');

  // Compute time until midnight UTC rollover
  const now = new Date();
  const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const msLeft = midnight - now;
  const hoursLeft = Math.floor(msLeft / (1000 * 60 * 60));
  const minutesLeft = Math.floor((msLeft % (1000 * 60 * 60)) / (1000 * 60));
  const timeUntilReset = `${hoursLeft}h ${minutesLeft}m`;

  // Read player sessions
  const playerId = player.id;
  const wordleSession = await readVar(`minigames_session:${playerId}:wordle`);
  const hangmanSession = await readVar(`minigames_session:${playerId}:hangman`);
  const hotcoldSession = await readVar(`minigames_session:${playerId}:hotcold`);

  // Format Wordle status
  let wordleStatus;
  if (!puzzleToday || puzzleToday.wordle === null || puzzleToday.wordle === undefined) {
    wordleStatus = '🟩 Wordle: Not configured today';
  } else if (!wordleSession || !wordleSession.guesses || wordleSession.guesses.length === 0) {
    wordleStatus = '🟩 Wordle: Not started';
  } else {
    const maxGuesses = 6;
    const guessCount = wordleSession.guesses.length;
    const solved = wordleSession.solved === true;
    if (solved) {
      wordleStatus = `🟩 Wordle: ${guessCount}/${maxGuesses} guesses — SOLVED ✅`;
    } else {
      wordleStatus = `🟩 Wordle: ${guessCount}/${maxGuesses} guesses — In progress`;
    }
  }

  // Format Hangman status
  let hangmanStatus;
  if (!puzzleToday || puzzleToday.hangman === null || puzzleToday.hangman === undefined) {
    hangmanStatus = '🎪 Hangman: Not configured today';
  } else if (!hangmanSession || (!hangmanSession.wrongGuesses && (!hangmanSession.guesses || hangmanSession.guesses.length === 0))) {
    hangmanStatus = '🎪 Hangman: Not started';
  } else {
    const maxWrong = 6;
    const wrongCount = hangmanSession.wrongGuesses ? hangmanSession.wrongGuesses.length : 0;
    const solved = hangmanSession.solved === true;
    if (solved) {
      hangmanStatus = `🎪 Hangman: ${wrongCount} wrong/${maxWrong} — SOLVED ✅`;
    } else {
      hangmanStatus = `🎪 Hangman: ${wrongCount} wrong/${maxWrong} — In progress`;
    }
  }

  // Format Hot/Cold status
  let hotcoldStatus;
  if (!puzzleToday || puzzleToday.hotcold === null || puzzleToday.hotcold === undefined) {
    hotcoldStatus = '🌡️ Hot/Cold: Not configured today';
  } else if (!hotcoldSession || !hotcoldSession.guesses || hotcoldSession.guesses.length === 0) {
    hotcoldStatus = '🌡️ Hot/Cold: Not started';
  } else {
    const guessCount = hotcoldSession.guesses.length;
    const solved = hotcoldSession.solved === true;
    if (solved) {
      hotcoldStatus = `🌡️ Hot/Cold: ${guessCount} guesses — SOLVED ✅`;
    } else {
      hotcoldStatus = `🌡️ Hot/Cold: ${guessCount} guesses — In progress`;
    }
  }

  const message = [
    `🎮 Today's Puzzles (resets in ${timeUntilReset}):`,
    wordleStatus,
    hangmanStatus,
    hotcoldStatus
  ].join('\n');

  await pog.pm(message);
}

await main();
