import { data, takaro } from '@takaro/helpers';

async function main() {
  const { gameServerId, module: mod } = data;
  const moduleId = mod.id;

  async function varSearch(key) {
    const r = await takaro.variable.variableControllerSearch({
      filters: { key: [key], gameServerId: [gameServerId], moduleId: [moduleId] },
      page: { limit: 1 }
    });
    return r.data.data[0] || null;
  }

  async function varSearchAll(keyPrefix) {
    const r = await takaro.variable.variableControllerSearch({
      filters: { gameServerId: [gameServerId], moduleId: [moduleId] },
      page: { limit: 200 }
    });
    return r.data.data.filter(v => v.key.startsWith(keyPrefix));
  }

  async function varCreate(key, val) {
    return takaro.variable.variableControllerCreate({ key, value: JSON.stringify(val), gameServerId, moduleId });
  }

  async function varUpdate(id, val) {
    return takaro.variable.variableControllerUpdate(id, { value: JSON.stringify(val) });
  }

  async function varDelete(id) {
    return takaro.variable.variableControllerDelete(id);
  }

  async function broadcast(msg) {
    await takaro.gameserver.gameServerControllerSendMessage(gameServerId, { message: msg });
  }

  const today = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"

  // Read content banks
  const wordleContentV = await varSearch('minigames_content_wordle');
  const wordlistContentV = await varSearch('minigames_content_wordlist');

  const puzzle = { date: today };
  const emptyBanks = [];

  // Pick Wordle word (5 letters, a-z only)
  if (wordleContentV) {
    const bank = JSON.parse(wordleContentV.value);
    const validWords = (bank.words || []).filter(w => /^[a-z]{5}$/.test(w));
    if (validWords.length > 0) {
      puzzle.wordle = validWords[Math.floor(Math.random() * validWords.length)];
    } else {
      emptyBanks.push('minigames_content_wordle');
    }
  } else {
    emptyBanks.push('minigames_content_wordle');
  }

  // Pick Hangman word (any length from wordlist)
  if (wordlistContentV) {
    const bank = JSON.parse(wordlistContentV.value);
    const words = (bank.words || []).filter(w => w.length >= 3);
    if (words.length > 0) {
      puzzle.hangman = words[Math.floor(Math.random() * words.length)].toLowerCase();
    } else {
      emptyBanks.push('minigames_content_wordlist');
    }
  } else {
    emptyBanks.push('minigames_content_wordlist');
  }

  // Pick Hot/Cold secret (1-1000)
  puzzle.hotcold = Math.floor(Math.random() * 1000) + 1;

  // Write puzzle_today
  const puzzleV = await varSearch('minigames_puzzle_today');
  if (puzzleV) await varUpdate(puzzleV.id, puzzle);
  else await varCreate('minigames_puzzle_today', puzzle);

  // Clear all player sessions from yesterday (scan all session variables)
  const allSessions = await varSearchAll('minigames_session:');
  for (const sv of allSessions) {
    await varDelete(sv.id);
  }

  // Warn about empty banks (once per day)
  if (emptyBanks.length > 0) {
    const warnV = await varSearch('minigames_admin_warned_empty_bank');
    const warn = warnV ? JSON.parse(warnV.value) : { date: null, keys: [] };
    if (warn.date !== today) {
      const msg = '[miniGames] Empty content banks: ' + emptyBanks.join(', ') + '. Add words via the Takaro Variables tab.';
      await broadcast(msg);
      if (warnV) await varUpdate(warnV.id, { date: today, keys: emptyBanks });
      else await varCreate('minigames_admin_warned_empty_bank', { date: today, keys: emptyBanks });
    }
  }
}

await main();
