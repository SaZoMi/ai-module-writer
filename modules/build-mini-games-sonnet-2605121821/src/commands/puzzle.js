import { data, takaro, TakaroUserError, checkPermission } from '@takaro/helpers';

async function main() {
  const { pog, player, gameServerId, module: mod } = data;

  if (!checkPermission(pog, 'MINIGAMES_PLAY')) {
    throw new TakaroUserError('You do not have permission to use mini-games.');
  }

  const playerId = player.playerId;

  async function getVar(key) {
    const res = await takaro.variable.variableControllerSearch({
      filters: { key: [key], gameServerId: [gameServerId] }
    });
    if (res.data.data.length > 0) {
      return JSON.parse(res.data.data[0].value);
    }
    return null;
  }

  // Read today's puzzle
  const todayPuzzle = await getVar('minigames_puzzle_today');

  if (!todayPuzzle) {
    await pog.pm('📅 No daily puzzles available yet. Check back after midnight UTC!');
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  if (todayPuzzle.date !== today) {
    await pog.pm('📅 Daily puzzles are rolling over. Please try again in a moment!');
    return;
  }

  // Read session variables
  const wordleSession = await getVar(`minigames_session:${playerId}:wordle`);
  const hangmanSession = await getVar(`minigames_session:${playerId}:hangman`);
  const hotcoldSession = await getVar(`minigames_session:${playerId}:hotcold`);

  function formatStatus(game, session, totalGuesses) {
    if (!todayPuzzle[game] && game !== 'hotcold') {
      return '❌ Not available today';
    }

    if (!session) {
      return '⏳ Not started';
    }

    if (session.solved) {
      const pts = session.points || 0;
      return `✅ Solved (+${pts} pts)`;
    }

    if (session.failed) {
      return '❌ Failed';
    }

    const used = session.guesses ? session.guesses.length : (session.wrongGuesses !== undefined ? session.wrongGuesses : 0);
    return `🔵 In progress (${used}/${totalGuesses})`;
  }

  const wordleStatus = formatStatus('wordle', wordleSession, 6);
  const hangmanStatus = formatStatus('hangman', hangmanSession, 6);
  const hotcoldStatus = formatStatus('hotcold', hotcoldSession, 8);

  const message = [
    `📅 Today's Puzzles (UTC rollover at midnight):`,
    `🟩 Wordle: ${wordleStatus}`,
    `🎪 Hangman: ${hangmanStatus}`,
    `🌡️ Hot/Cold: ${hotcoldStatus}`
  ].join('\n');

  await pog.pm(message);
}

await main();
