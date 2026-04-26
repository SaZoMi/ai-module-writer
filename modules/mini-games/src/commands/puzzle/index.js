import { data, TakaroUserError, checkPermission } from '@takaro/helpers';
import { getVariable, todayUTC } from './mini-games-helpers.js';

async function main() {
  const { pog, gameServerId, arguments: args, module: mod } = data;

  if (!checkPermission(pog, 'MINIGAMES_PLAY')) {
    throw new TakaroUserError('You do not have permission to use mini-games.');
  }

  const moduleId = mod.moduleId;
  const today = todayUTC();
  const puzzle = await getVariable(gameServerId, moduleId, 'minigames_puzzle_today');

  const now = new Date();
  const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const msLeft = midnight - now;
  const hoursLeft = Math.floor(msLeft / 3600000);
  const minsLeft = Math.floor((msLeft % 3600000) / 60000);

  const [wordleSession, hangmanSession, hotcoldSession] = await Promise.all([
    getVariable(gameServerId, moduleId, `minigames_session:${pog.playerId}:wordle`),
    getVariable(gameServerId, moduleId, `minigames_session:${pog.playerId}:hangman`),
    getVariable(gameServerId, moduleId, `minigames_session:${pog.playerId}:hotcold`),
  ]);

  function statusLabel(session, available, maxGuesses) {
    if (!available) return '❌ not available';
    if (!session) return '🔵 not started';
    if (session.solved) return '✅ solved';
    if (session.guesses?.length >= maxGuesses || session.wrongCount >= maxGuesses) return '❌ failed';
    return '🔄 in progress';
  }

  const wordleAvail = puzzle && puzzle.date === today && !!puzzle.wordle;
  const hangmanAvail = puzzle && puzzle.date === today && !!puzzle.hangman;
  const hotcoldAvail = puzzle && puzzle.date === today && puzzle.hotcold !== undefined && puzzle.hotcold !== null;

  const lines = [
    `🗓️ Today's Puzzles (${today})`,
    `  🟩 Wordle:   ${statusLabel(wordleSession, wordleAvail, 6)}`,
    `  🎪 Hangman:  ${statusLabel(hangmanSession, hangmanAvail, 6)}`,
    `  🌡️ Hot/Cold: ${statusLabel(hotcoldSession, hotcoldAvail, 8)}`,
    `⏰ Rollover in: ${hoursLeft}h ${minsLeft}m`,
  ];

  await pog.pm(lines.join('\n'));
}

await main();
