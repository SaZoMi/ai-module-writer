import { data, takaro, TakaroUserError, checkPermission } from '@takaro/helpers';

async function main() {
  const { pog, player, gameServerId, module: mod } = data;
  const userConfig = mod.userConfig;
  const moduleId = mod.moduleId;
  const playerId = player?.id;

  async function varSearch(key) {
    const r = await takaro.variable.variableControllerSearch({
      filters: { key: [key], gameServerId: [gameServerId], moduleId: [moduleId] },
      page: { limit: 1 }
    });
    return r.data.data[0] || null;
  }

  if (!checkPermission(pog, 'MINIGAMES_PLAY')) {
    throw new TakaroUserError('You need MINIGAMES_PLAY permission.');
  }

  const puzzleV = await varSearch('minigames_puzzle_today');
  if (!puzzleV) {
    await pog.pm('📅 No puzzles configured yet. Ask an admin to set up content banks.');
    return;
  }
  const puzzle = JSON.parse(puzzleV.value);
  const today = new Date().toISOString().slice(0, 10);

  const nextRollover = new Date();
  nextRollover.setUTCHours(24, 0, 0, 0);
  const hoursLeft = Math.floor((nextRollover - Date.now()) / 3600000);
  const minsLeft = Math.floor(((nextRollover - Date.now()) % 3600000) / 60000);

  const lines = ['📅 Today\'s Puzzles (resets in ' + hoursLeft + 'h ' + minsLeft + 'm):'];

  // Wordle status
  if (puzzle.wordle) {
    const wSess = await varSearch('minigames_session:' + playerId + ':wordle');
    const ws = wSess ? JSON.parse(wSess.value) : { guesses: [], solved: false };
    if (ws.solved) lines.push('  🟩 Wordle: ✅ Solved! (' + ws.guesses.length + '/6 guesses)');
    else if (ws.guesses.length >= 6) lines.push('  🟩 Wordle: ❌ Failed (' + ws.guesses.length + '/6 guesses used)');
    else lines.push('  🟩 Wordle: ' + ws.guesses.length + '/6 guesses used. /wordle to play!');
  } else {
    lines.push('  🟩 Wordle: Not configured (empty word bank)');
  }

  // Hangman status
  if (puzzle.hangman) {
    const hSess = await varSearch('minigames_session:' + playerId + ':hangman');
    const hs = hSess ? JSON.parse(hSess.value) : { lettersTried: [], wrongCount: 0, solved: false };
    if (hs.solved) lines.push('  🎪 Hangman: ✅ Solved!');
    else if (hs.wrongCount >= 6) lines.push('  🎪 Hangman: ❌ Failed (6/6 wrong guesses)');
    else lines.push('  🎪 Hangman: ' + hs.wrongCount + '/6 wrong guesses. /hangman to play!');
  } else {
    lines.push('  🎪 Hangman: Not configured (empty word bank)');
  }

  // Hot/Cold status
  const hcSess = await varSearch('minigames_session:' + playerId + ':hotcold');
  const hcs = hcSess ? JSON.parse(hcSess.value) : { guesses: [], solved: false };
  if (hcs.solved) lines.push('  🌡️ Hot/Cold: ✅ Solved!');
  else if (hcs.guesses.length >= 8) lines.push('  🌡️ Hot/Cold: ❌ Failed (8/8 guesses used)');
  else lines.push('  🌡️ Hot/Cold: ' + hcs.guesses.length + '/8 guesses used. /hotcold to play!');

  for (const line of lines) await pog.pm(line);
}

await main();
