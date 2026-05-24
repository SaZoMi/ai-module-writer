import { data, takaro, checkPermission, TakaroUserError } from '@takaro/helpers';

async function main() {
  const { pog, player, gameServerId, module: mod } = data;

  const moduleId = data.module.id;
  const playerId = player.id;

  // Read today's puzzle variable
  const puzzleSearch = await takaro.variable.variableControllerSearch({
    filters: { key: ['minigames_puzzle_today'], moduleId: [moduleId], gameServerId: [gameServerId] },
    limit: 1
  });

  let puzzleData = null;
  if (puzzleSearch.data.data.length > 0) {
    try {
      puzzleData = JSON.parse(puzzleSearch.data.data[0].value);
    } catch (e) {
      puzzleData = null;
    }
  }

  // Read player sessions for wordle, hangman, hotcold
  const [wordleSearch, hangmanSearch, hotcoldSearch] = await Promise.all([
    takaro.variable.variableControllerSearch({
      filters: { key: [`minigames_session:${playerId}:wordle`], moduleId: [moduleId], gameServerId: [gameServerId] },
      limit: 1
    }),
    takaro.variable.variableControllerSearch({
      filters: { key: [`minigames_session:${playerId}:hangman`], moduleId: [moduleId], gameServerId: [gameServerId] },
      limit: 1
    }),
    takaro.variable.variableControllerSearch({
      filters: { key: [`minigames_session:${playerId}:hotcold`], moduleId: [moduleId], gameServerId: [gameServerId] },
      limit: 1
    })
  ]);

  // Parse sessions
  const wordleSession = wordleSearch.data.data.length > 0 ? JSON.parse(wordleSearch.data.data[0].value) : null;
  const hangmanSession = hangmanSearch.data.data.length > 0 ? JSON.parse(hangmanSearch.data.data[0].value) : null;
  const hotcoldSession = hotcoldSearch.data.data.length > 0 ? JSON.parse(hotcoldSearch.data.data[0].value) : null;

  // Calculate time until next UTC midnight
  const now = new Date();
  const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
  const msLeft = midnight - now;
  const hoursLeft = Math.floor(msLeft / (1000 * 60 * 60));
  const minutesLeft = Math.floor((msLeft % (1000 * 60 * 60)) / (1000 * 60));

  // Build wordle status
  let wordleStatus;
  if (!puzzleData || puzzleData.wordle === undefined || puzzleData.wordle === null) {
    wordleStatus = 'Not available today';
  } else if (!wordleSession) {
    wordleStatus = 'Not played';
  } else {
    const guessCount = (wordleSession.guesses || []).length;
    if (wordleSession.solved) {
      wordleStatus = `Played (${guessCount}/6 guesses, solved)`;
    } else if (guessCount >= 6) {
      wordleStatus = `Played (${guessCount}/6 guesses, failed)`;
    } else {
      wordleStatus = `In progress (${guessCount}/6 guesses)`;
    }
  }

  // Build hangman status
  let hangmanStatus;
  if (!puzzleData || puzzleData.hangman === undefined || puzzleData.hangman === null) {
    hangmanStatus = 'Not available today';
  } else if (!hangmanSession) {
    hangmanStatus = 'Not played';
  } else {
    if (hangmanSession.solved) {
      hangmanStatus = 'Played (solved)';
    } else if (hangmanSession.failed || (hangmanSession.wrongGuesses && hangmanSession.wrongGuesses.length >= 6)) {
      hangmanStatus = 'Played (failed)';
    } else {
      hangmanStatus = 'In progress';
    }
  }

  // Build hotcold status
  let hotcoldStatus;
  if (!puzzleData || puzzleData.hotcold === undefined || puzzleData.hotcold === null) {
    hotcoldStatus = 'Not available today';
  } else if (!hotcoldSession) {
    hotcoldStatus = 'Not played';
  } else {
    if (hotcoldSession.solved) {
      hotcoldStatus = `Played (solved)`;
    } else if ((hotcoldSession.guesses || []).length >= 8) {
      hotcoldStatus = 'Played (failed)';
    } else {
      hotcoldStatus = `In progress (${(hotcoldSession.guesses || []).length}/8 guesses)`;
    }
  }

  const message = `🎮 Today's puzzles (resets in ${hoursLeft}h ${minutesLeft}m):\n🟩 Wordle: ${wordleStatus}\n🎪 Hangman: ${hangmanStatus}\n🌡️ Hot/Cold: ${hotcoldStatus}`;
  await pog.pm(message);
}

await main();
