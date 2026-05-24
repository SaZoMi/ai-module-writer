import { data, takaro, TakaroUserError, checkPermission } from '@takaro/helpers';

async function main() {
  const { gameServerId, module: mod } = data;
  const moduleId = mod.id;

  const today = new Date().toISOString().slice(0, 10);
  const yesterdayDate = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  async function getOrCreateVar(key, defaultValue) {
    const res = await takaro.variable.variableControllerSearch({
      filters: { key: [key], gameServerId: [gameServerId] }
    });
    if (res.data.data.length > 0) {
      return { id: res.data.data[0].id, value: JSON.parse(res.data.data[0].value) };
    }
    await takaro.variable.variableControllerCreate({
      key,
      value: JSON.stringify(defaultValue),
      gameServerId,
      moduleId
    });
    return { id: null, value: defaultValue };
  }

  async function setVar(key, value, existingId) {
    if (existingId) {
      await takaro.variable.variableControllerUpdate(existingId, { value: JSON.stringify(value) });
    } else {
      const res = await takaro.variable.variableControllerSearch({
        filters: { key: [key], gameServerId: [gameServerId] }
      });
      if (res.data.data.length > 0) {
        await takaro.variable.variableControllerUpdate(res.data.data[0].id, { value: JSON.stringify(value) });
      } else {
        await takaro.variable.variableControllerCreate({
          key,
          value: JSON.stringify(value),
          gameServerId,
          moduleId
        });
      }
    }
  }

  // Read content banks
  const wordleBank = await getOrCreateVar('minigames_content_wordle', { words: [] });
  const wordlistBank = await getOrCreateVar('minigames_content_wordlist', { words: [] });

  // Filter wordle words: exactly 5 letters, only a-z
  const wordleWords = (wordleBank.value.words || []).filter(
    w => typeof w === 'string' && w.length === 5 && /^[a-z]+$/.test(w)
  );

  // Filter hangman words: length >= 3
  const hangmanWords = (wordlistBank.value.words || []).filter(
    w => typeof w === 'string' && w.length >= 3
  );

  // Build today's puzzle object
  const puzzle = { date: today };
  const emptyGames = [];
  const emptyKeys = [];

  if (wordleWords.length > 0) {
    puzzle.wordle = wordleWords[Math.floor(Math.random() * wordleWords.length)];
  } else {
    emptyGames.push('Wordle');
    emptyKeys.push('minigames_content_wordle');
  }

  if (hangmanWords.length > 0) {
    puzzle.hangman = hangmanWords[Math.floor(Math.random() * hangmanWords.length)];
  } else {
    emptyGames.push('Hangman');
    emptyKeys.push('minigames_content_wordlist');
  }

  puzzle.hotcold = Math.floor(Math.random() * 1000) + 1;

  // Write today's puzzle
  await setVar('minigames_puzzle_today', puzzle, null);

  // Clear all session variables
  let page = 0;
  const pageSize = 100;
  let hasMore = true;
  while (hasMore) {
    const sessRes = await takaro.variable.variableControllerSearch({
      filters: { gameServerId: [gameServerId] },
      search: { key: ['minigames_session:'] },
      limit: pageSize,
      page
    });
    const sessions = sessRes.data.data || [];
    for (const s of sessions) {
      await takaro.variable.variableControllerDelete(s.id);
    }
    hasMore = sessions.length === pageSize;
    page++;
  }

  // Warn about empty banks (once per day)
  if (emptyGames.length > 0) {
    const warnKey = 'minigames_admin_warned_empty_bank';
    const warnVar = await getOrCreateVar(warnKey, { date: '' });
    if (warnVar.value.date !== today) {
      const message = `⚠️ Mini-games: No words seeded for ${emptyGames.join(', ')}. Add words to variables: ${emptyKeys.join(', ')}.`;
      await takaro.gameserver.gameServerControllerSendMessage(gameServerId, { message });
      await setVar(warnKey, { date: today }, warnVar.id);
    }
  }
}

await main();
