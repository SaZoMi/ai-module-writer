import { data, takaro } from '@takaro/helpers';

async function main() {
  const { gameServerId, module: mod } = data;
  const moduleId = mod.id;
  const userConfig = mod.userConfig;

  const today = new Date().toISOString().slice(0, 10);

  async function readVar(key) {
    const r = await takaro.variable.variableControllerSearch({
      filters: { key: [key], moduleId: [moduleId], gameServerId: [gameServerId] },
      limit: 1,
    });
    return r.data.data.length > 0 ? r.data.data[0] : null;
  }

  async function writeVar(key, value, existingId) {
    if (existingId) {
      await takaro.variable.variableControllerUpdate(existingId, { value: JSON.stringify(value) });
    } else {
      await takaro.variable.variableControllerCreate({ key, value: JSON.stringify(value), moduleId, gameServerId });
    }
  }

  const missingGames = [];
  const missingKeys = [];

  // Pick new Wordle word
  let wordleWord = undefined;
  const wordleVar = await readVar('minigames_content_wordle');
  if (!wordleVar) {
    missingGames.push('Wordle');
    missingKeys.push('minigames_content_wordle');
  } else {
    let wordleData;
    try { wordleData = JSON.parse(wordleVar.value); } catch (e) { wordleData = null; }
    const words = Array.isArray(wordleData) ? wordleData : (wordleData && Array.isArray(wordleData.words) ? wordleData.words : []);
    const validWords = words.filter(w => typeof w === 'string' && /^[a-z]{5}$/.test(w));
    if (validWords.length === 0) {
      missingGames.push('Wordle');
      missingKeys.push('minigames_content_wordle');
    } else {
      wordleWord = validWords[Math.floor(Math.random() * validWords.length)];
    }
  }

  // Pick new Hangman word
  let hangmanWord = undefined;
  const wordlistVar = await readVar('minigames_content_wordlist');
  if (!wordlistVar) {
    missingGames.push('Hangman');
    missingKeys.push('minigames_content_wordlist');
  } else {
    let wordlistData;
    try { wordlistData = JSON.parse(wordlistVar.value); } catch (e) { wordlistData = null; }
    const words = Array.isArray(wordlistData) ? wordlistData : (wordlistData && Array.isArray(wordlistData.words) ? wordlistData.words : []);
    if (words.length === 0) {
      missingGames.push('Hangman');
      missingKeys.push('minigames_content_wordlist');
    } else {
      hangmanWord = words[Math.floor(Math.random() * words.length)];
    }
  }

  // Pick Hot/Cold secret (always available)
  const hotcold = Math.floor(Math.random() * 1000) + 1;

  // Write today's puzzle
  const puzzleData = { date: today, hotcold };
  if (wordleWord !== undefined) puzzleData.wordle = wordleWord;
  if (hangmanWord !== undefined) puzzleData.hangman = hangmanWord;

  const existingPuzzle = await readVar('minigames_puzzle_today');
  await writeVar('minigames_puzzle_today', puzzleData, existingPuzzle ? existingPuzzle.id : null);

  // Clear yesterday's sessions
  const allVars = await takaro.variable.variableControllerSearch({
    filters: { moduleId: [moduleId], gameServerId: [gameServerId] },
    limit: 100,
  });
  const sessionVars = allVars.data.data.filter(v => v.key.startsWith('minigames_session:'));
  for (const sv of sessionVars) {
    await takaro.variable.variableControllerDelete(sv.id);
  }

  // Admin warning for missing games
  if (missingGames.length > 0) {
    const warnVar = await readVar('minigames_admin_warned_empty_bank');
    let warnData = null;
    if (warnVar) {
      try { warnData = JSON.parse(warnVar.value); } catch (e) { warnData = null; }
    }

    if (warnData && warnData.date === today) {
      // Already warned today, add any new keys to the existing list
      const existingKeys = warnData.keys || [];
      const newKeys = missingKeys.filter(k => !existingKeys.includes(k));
      if (newKeys.length > 0) {
        warnData.keys = [...existingKeys, ...newKeys];
        await writeVar('minigames_admin_warned_empty_bank', warnData, warnVar.id);
      }
    } else {
      // New day, create fresh warning record
      const newWarnData = { date: today, keys: missingKeys };
      await writeVar('minigames_admin_warned_empty_bank', newWarnData, warnVar ? warnVar.id : null);

      const gameNames = missingGames.join(', ');
      const keyNames = missingKeys.join(', ');
      await takaro.gameserver.gameServerControllerSendMessage(gameServerId, {
        message: `⚠️ [MiniGames] No puzzle today for: ${gameNames}. Seed the variable(s): ${keyNames}.`,
      });
    }
  }
}

await main();
