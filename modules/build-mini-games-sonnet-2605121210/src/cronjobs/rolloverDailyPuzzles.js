import { data, takaro, TakaroUserError, checkPermission } from '@takaro/helpers';

async function main() {
  const moduleId = data.module.moduleId;
  const { gameServerId } = data;
  const cfg = data.module.userConfig;

  // Helper: read a variable (returns {id, value} or null)
  async function readVar(key) {
    const res = await takaro.variable.variableControllerSearch({
      filters: { key: [key], gameServerId: [gameServerId], moduleId: [moduleId] },
      page: 0,
      limit: 1
    });
    return res.data.data.length > 0
      ? { id: res.data.data[0].id, value: JSON.parse(res.data.data[0].value) }
      : null;
  }

  // Helper: write a variable (create or update)
  async function writeVar(key, value, existingId) {
    if (existingId) {
      await takaro.variable.variableControllerUpdate(existingId, { value: JSON.stringify(value) });
    } else {
      await takaro.variable.variableControllerCreate({ key, value: JSON.stringify(value), gameServerId, moduleId });
    }
  }

  // Step 1: Get today's date
  const today = new Date().toISOString().slice(0, 10);

  // Step 2: Check if already rolled over today (idempotent)
  const puzzleTodayVar = await readVar('minigames_puzzle_today');
  if (puzzleTodayVar && puzzleTodayVar.value && puzzleTodayVar.value.date === today) {
    console.log('Daily puzzles already rolled over for today:', today);
    return;
  }

  // Track which banks are empty for warning
  const emptyBanks = [];

  // Step 3: Pick Wordle word
  let wordleWord = null;
  const wordleContentVar = await readVar('minigames_content_wordle');
  if (!wordleContentVar || !wordleContentVar.value || !Array.isArray(wordleContentVar.value.words) || wordleContentVar.value.words.length === 0) {
    emptyBanks.push('Wordle');
  } else {
    const validWords = wordleContentVar.value.words.filter(w => typeof w === 'string' && /^[a-z]{5}$/.test(w));
    if (validWords.length === 0) {
      emptyBanks.push('Wordle');
    } else {
      wordleWord = validWords[Math.floor(Math.random() * validWords.length)];
    }
  }

  // Step 4: Pick Hangman word
  let hangmanWord = null;
  const wordlistVar = await readVar('minigames_content_wordlist');
  if (!wordlistVar || !wordlistVar.value || !Array.isArray(wordlistVar.value.words) || wordlistVar.value.words.length === 0) {
    emptyBanks.push('Hangman');
  } else {
    const words = wordlistVar.value.words;
    hangmanWord = words[Math.floor(Math.random() * words.length)];
  }

  // Step 5: Pick Hot/Cold secret number (1–1000)
  const hotcoldSecret = Math.floor(Math.random() * 1000) + 1;

  // Step 8: Handle empty bank warnings (check before writing puzzle_today)
  if (emptyBanks.length > 0) {
    const warnVar = await readVar('minigames_admin_warned_empty_bank');
    const alreadyWarnedToday = warnVar && warnVar.value && warnVar.value.date === today;
    if (!alreadyWarnedToday) {
      const warnMsg = `[MiniGames] WARNING: Empty word banks detected for: ${emptyBanks.join(', ')}. Please add words to the content variables.`;
      await takaro.gameserver.gameServerControllerSendMessage(gameServerId, { message: warnMsg });
      await writeVar('minigames_admin_warned_empty_bank', { date: today }, warnVar ? warnVar.id : undefined);
    }
  }

  // Step 6: Write minigames_puzzle_today
  const newPuzzle = {
    date: today,
    wordle: wordleWord,
    hangman: hangmanWord,
    hotcold: hotcoldSecret
  };
  await writeVar('minigames_puzzle_today', newPuzzle, puzzleTodayVar ? puzzleTodayVar.id : undefined);

  // Step 7: Clear yesterday's player sessions
  let page = 0;
  let hasMore = true;
  while (hasMore) {
    const sessRes = await takaro.variable.variableControllerSearch({
      filters: { gameServerId: [gameServerId], moduleId: [moduleId] },
      search: { key: ['minigames_session:'] },
      page,
      limit: 100
    });
    const sessions = sessRes.data.data;
    for (const v of sessions) {
      await takaro.variable.variableControllerDelete(v.id);
    }
    if (sessions.length < 100) {
      hasMore = false;
    } else {
      page++;
    }
  }

  // Announce the rollover
  const gamesReady = [];
  if (wordleWord) gamesReady.push('Wordle');
  if (hangmanWord) gamesReady.push('Hangman');
  gamesReady.push('Hot/Cold');

  await takaro.gameserver.gameServerControllerSendMessage(gameServerId, {
    message: `🎮 Daily puzzles have reset! Today's games: ${gamesReady.join(', ')}. Use /puzzle to check your status!`
  });

  console.log('Daily puzzle rollover complete for', today);
}

await main();
