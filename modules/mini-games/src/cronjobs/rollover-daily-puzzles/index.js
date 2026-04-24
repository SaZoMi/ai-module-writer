import { data, takaro } from '@takaro/helpers';
import {
  getVariable, setVariable, deleteVariable, searchVariablesByKeyPrefix,
  getContentBank, warnAdminEmptyBank, todayUTC,
} from './mini-games-helpers.js';

async function main() {
  const { gameServerId, module: mod } = data;
  const moduleId = mod.moduleId;
  const config = mod.userConfig;
  const today = todayUTC();
  const missingBanks = [];

  let wordleWord = null;
  let hangmanWord = null;
  let hotcoldSecret = null;

  // Wordle
  if (config.games?.wordle !== false) {
    const bank = await getContentBank(gameServerId, moduleId, 'minigames_content_wordle', { words: [] });
    const words = (bank.words ?? []).map(w => w.toLowerCase()).filter(w => /^[a-z]{5}$/.test(w));
    if (words.length === 0) {
      missingBanks.push('minigames_content_wordle');
    } else {
      wordleWord = words[Math.floor(Math.random() * words.length)];
    }
  }

  // Hangman — filter to a-z only (no hyphens, apostrophes, etc.) to ensure
  // letter guesses can always reveal every character
  if (config.games?.hangman !== false) {
    const bank = await getContentBank(gameServerId, moduleId, 'minigames_content_wordlist', { words: [] });
    const words = (bank.words ?? []).filter(w => /^[a-z]+$/.test(w) && w.length >= 3);
    if (words.length === 0) {
      missingBanks.push('minigames_content_wordlist');
    } else {
      hangmanWord = words[Math.floor(Math.random() * words.length)].toLowerCase();
    }
  }

  // Hot/Cold
  if (config.games?.hotcold !== false) {
    hotcoldSecret = Math.floor(Math.random() * 1000) + 1;
  }

  // Warn admin about empty banks
  await warnAdminEmptyBank(gameServerId, moduleId, missingBanks);

  // Write today's puzzle
  const puzzle = { date: today };
  if (wordleWord) puzzle.wordle = wordleWord;
  if (hangmanWord) puzzle.hangman = hangmanWord;
  if (hotcoldSecret !== null) puzzle.hotcold = hotcoldSecret;
  await setVariable(gameServerId, moduleId, 'minigames_puzzle_today', puzzle);
  console.log(`miniGames rolloverDailyPuzzles: date=${today}, wordle=${wordleWord ?? 'N/A'}, hangman=${hangmanWord ?? 'N/A'}, hotcold=${hotcoldSecret ?? 'N/A'}`);

  // Clear yesterday's player sessions (all session keys for wordle/hangman/hotcold)
  const sessionVars = await searchVariablesByKeyPrefix(gameServerId, moduleId, 'minigames_session:');
  let cleared = 0;
  for (const v of sessionVars) {
    await takaro.variable.variableControllerDelete(v.id);
    cleared++;
  }
  console.log(`miniGames rolloverDailyPuzzles: cleared ${cleared} player session variables`);

  // Reset admin warned flag for new day
  const warnVar = await getVariable(gameServerId, moduleId, 'minigames_admin_warned_empty_bank');
  if (warnVar && warnVar.date !== today) {
    await deleteVariable(gameServerId, moduleId, 'minigames_admin_warned_empty_bank');
  }
}

await main();
