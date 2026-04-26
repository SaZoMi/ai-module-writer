import { data, TakaroUserError, checkPermission } from '@takaro/helpers';
import {
  getVariable, setVariable, checkBanAndCap, awardPoints, recordPlay, getContentBank, todayUTC,
} from './mini-games-helpers.js';

function buildMaskedWord(word, lettersTried) {
  // Non-alpha characters (hyphens, apostrophes, spaces, etc.) are always revealed —
  // players can only guess single letters so non-alpha positions can never be guessed.
  return word.split('').map(ch => {
    if (!/^[a-z]$/.test(ch)) return ch; // always reveal non-alpha
    return lettersTried.includes(ch) ? ch.toUpperCase() : '_';
  }).join(' ');
}

async function main() {
  const { pog, player, gameServerId, arguments: args, module: mod } = data;

  if (!checkPermission(pog, 'MINIGAMES_PLAY')) {
    throw new TakaroUserError('You do not have permission to use mini-games.');
  }

  const moduleId = mod.moduleId;
  const config = mod.userConfig;
  const today = todayUTC();

  const puzzle = await getVariable(gameServerId, moduleId, 'minigames_puzzle_today');
  if (!puzzle || puzzle.date !== today || !puzzle.hangman) {
    await pog.pm("🎪 Hangman: Today's puzzle isn't ready yet. Ask an admin to run rollover or wait for midnight.");
    return;
  }

  const target = puzzle.hangman.toLowerCase();
  const sessionKey = `minigames_session:${pog.playerId}:hangman`;
  const session = await getVariable(gameServerId, moduleId, sessionKey) ?? {
    lettersTried: [], wrongCount: 0, solved: false, completedAt: null,
  };

  // '__status__' is the sentinel defaultValue used when no letter/word is provided
  const rawInput = args.letterOrWord ? args.letterOrWord.toLowerCase().trim() : null;
  const input = (rawInput && rawInput !== '__status__') ? rawInput : null;
  const masked = buildMaskedWord(target, session.lettersTried);

  // No arg — status
  if (!input) {
    if (session.solved) {
      await pog.pm(`🎪 Hangman: You SOLVED today's puzzle! Wrong guesses: ${session.wrongCount}/6.`);
      return;
    }
    if (session.wrongCount >= 6) {
      await pog.pm(`🎪 Hangman: Game over! The word was: ${target.toUpperCase()}.`);
      return;
    }
    await pog.pm(`🎪 Hangman: ${masked} (wrong ${session.wrongCount}/6, tried: ${session.lettersTried.join(', ') || 'none'})`);
    return;
  }

  // Already done?
  if (session.solved) throw new TakaroUserError("🎪 You've already solved today's Hangman!");
  if (session.wrongCount >= 6) throw new TakaroUserError("🎪 Game over! You've used all 6 wrong guesses.");

  // Check ban/cap
  await checkBanAndCap(gameServerId, moduleId, pog.playerId, config);

  if (input.length === 1) {
    // Single letter guess
    if (!/^[a-z]$/.test(input)) {
      throw new TakaroUserError('🎪 Single letter guesses must be a-z.');
    }
    if (session.lettersTried.includes(input)) {
      throw new TakaroUserError(`🎪 You already tried "${input.toUpperCase()}".`);
    }

    session.lettersTried.push(input);
    const inWord = target.includes(input);

    if (!inWord) {
      session.wrongCount++;
    }

    const newMasked = buildMaskedWord(target, session.lettersTried);
    const fullyRevealed = !newMasked.includes('_');

    if (fullyRevealed) {
      session.solved = true;
      session.completedAt = new Date().toISOString();
      await setVariable(gameServerId, moduleId, sessionKey, session);

      await recordPlay(gameServerId, moduleId, pog.playerId, 'hangman');
      const rawPoints = Math.round(config.pointsHangmanBase * (7 - session.wrongCount) / 7);
      const { actualPoints, multiplier, currencyPaid, cappedByDaily, clippedByDaily } = await awardPoints({
        gameServerId, moduleId, pog, game: 'hangman', points: rawPoints, config, playerName: player.name,
      });
      const boostNote = multiplier > 1 ? ` (boost ×${multiplier.toFixed(2)})` : '';
      const currencyNote = currencyPaid > 0 ? ` +${currencyPaid} currency` : '';
      const capNote = cappedByDaily
        ? ' Daily point cap reached — no points awarded.'
        : clippedByDaily
          ? ` Daily cap clipped reward to ${actualPoints} points.`
          : '';
      await pog.pm(`🎪 ${newMasked} — SOLVED! +${actualPoints} points${boostNote}${currencyNote}.${capNote} Wrong: ${session.wrongCount}/6.`);
    } else if (session.wrongCount >= 6) {
      await setVariable(gameServerId, moduleId, sessionKey, session);
      await recordPlay(gameServerId, moduleId, pog.playerId, 'hangman');
      await pog.pm(`🎪 Game over! "${input.toUpperCase()}" not in word. The word was: ${target.toUpperCase()}.`);
    } else {
      await setVariable(gameServerId, moduleId, sessionKey, session);
      const hint = inWord ? `"${input.toUpperCase()}" is in the word!` : `"${input.toUpperCase()}" is NOT in the word.`;
      await pog.pm(`🎪 ${newMasked} — ${hint} (wrong ${session.wrongCount}/6)`);
    }
  } else {
    // Full word guess
    if (input === target) {
      session.solved = true;
      session.completedAt = new Date().toISOString();
      await setVariable(gameServerId, moduleId, sessionKey, session);

      await recordPlay(gameServerId, moduleId, pog.playerId, 'hangman');
      const rawPoints = Math.round(config.pointsHangmanBase * (7 - session.wrongCount) / 7);
      const { actualPoints, multiplier, currencyPaid, cappedByDaily, clippedByDaily } = await awardPoints({
        gameServerId, moduleId, pog, game: 'hangman', points: rawPoints, config, playerName: player.name,
      });
      const boostNote = multiplier > 1 ? ` (boost ×${multiplier.toFixed(2)})` : '';
      const currencyNote = currencyPaid > 0 ? ` +${currencyPaid} currency` : '';
      const capNote = cappedByDaily
        ? ' Daily point cap reached — no points awarded.'
        : clippedByDaily
          ? ` Daily cap clipped reward to ${actualPoints} points.`
          : '';
      await pog.pm(`🎪 SOLVED! +${actualPoints} points${boostNote}${currencyNote}.${capNote}`);
    } else {
      // Wrong full-word guess = instant loss
      session.wrongCount = 6;
      await setVariable(gameServerId, moduleId, sessionKey, session);
      await recordPlay(gameServerId, moduleId, pog.playerId, 'hangman');
      await pog.pm(`🎪 Wrong word guess! Game over. The word was: ${target.toUpperCase()}.`);
    }
  }
}

await main();
