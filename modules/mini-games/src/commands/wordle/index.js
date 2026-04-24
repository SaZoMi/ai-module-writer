import { data, TakaroUserError, checkPermission } from '@takaro/helpers';
import {
  getVariable, setVariable, checkBanAndCap, awardPoints, recordPlay, updateWordleStreak,
  getContentBank, todayUTC,
} from './mini-games-helpers.js';

function computeWordleFeedback(guess, target) {
  // Standard Wordle feedback: 🟩 = right spot, 🟨 = wrong spot, ⬜ = not in word
  const result = Array(5).fill('⬜');
  const targetArr = target.split('');
  const guessArr = guess.split('');
  const targetUsed = Array(5).fill(false);
  const guessUsed = Array(5).fill(false);

  // First pass: right spot
  for (let i = 0; i < 5; i++) {
    if (guessArr[i] === targetArr[i]) {
      result[i] = '🟩';
      targetUsed[i] = true;
      guessUsed[i] = true;
    }
  }
  // Second pass: wrong spot
  for (let i = 0; i < 5; i++) {
    if (guessUsed[i]) continue;
    for (let j = 0; j < 5; j++) {
      if (targetUsed[j]) continue;
      if (guessArr[i] === targetArr[j]) {
        result[i] = '🟨';
        targetUsed[j] = true;
        break;
      }
    }
  }
  return result.join('');
}

async function main() {
  const { pog, player, gameServerId, arguments: args, module: mod } = data;

  if (!checkPermission(pog, 'MINIGAMES_PLAY')) {
    throw new TakaroUserError('You do not have permission to use mini-games.');
  }

  const moduleId = mod.moduleId;
  const config = mod.userConfig;

  // Get today's puzzle
  const today = todayUTC();
  const puzzle = await getVariable(gameServerId, moduleId, 'minigames_puzzle_today');

  if (!puzzle || puzzle.date !== today || !puzzle.wordle) {
    await pog.pm("🟩 Wordle: Today's puzzle isn't set up yet. Ask an admin to run /minigamesfirenow or wait for midnight rollover.");
    return;
  }

  const target = puzzle.wordle.toLowerCase();
  const sessionKey = `minigames_session:${pog.playerId}:wordle`;
  const session = await getVariable(gameServerId, moduleId, sessionKey) ?? { guesses: [], solved: false, completedAt: null };

  // '__status__' is the sentinel defaultValue used when no guess is provided
  const rawGuess = args.guess ? args.guess.toLowerCase().trim() : null;
  const guess = (rawGuess && rawGuess !== '__status__') ? rawGuess : null;

  // No arg — show status
  if (!guess) {
    if (session.solved) {
      await pog.pm(`🟩 Wordle: You SOLVED today's puzzle in ${session.guesses.length}/6! Well done.`);
      return;
    }
    if (session.guesses.length === 0) {
      await pog.pm('🟩 Wordle: No guesses yet. Use /wordle <5-letter-word> to guess!');
      return;
    }
    const history = session.guesses.map((g, i) => `  ${i + 1}. ${g.toUpperCase()} ${computeWordleFeedback(g, target)}`).join('\n');
    await pog.pm(`🟩 Wordle: ${session.guesses.length}/6 guesses used.\n${history}\nUse /wordle <guess> to continue.`);
    return;
  }

  // Validate guess
  if (session.solved) {
    throw new TakaroUserError("🟩 You've already solved today's Wordle!");
  }
  if (session.guesses.length >= 6) {
    throw new TakaroUserError("🟩 You've used all 6 guesses. The word was: " + target.toUpperCase());
  }

  // Check ban (throws if banned; no longer throws on cap-exhausted)
  await checkBanAndCap(gameServerId, moduleId, pog.playerId, config);

  if (!/^[a-z]{5}$/.test(guess)) {
    throw new TakaroUserError('🟩 Wordle guess must be exactly 5 letters (a-z only).');
  }

  // Validate word is in bank
  const bank = await getContentBank(gameServerId, moduleId, 'minigames_content_wordle', { words: [] });
  const validWords = (bank.words ?? []).map(w => w.toLowerCase()).filter(w => /^[a-z]{5}$/.test(w));
  if (!validWords.includes(guess)) {
    throw new TakaroUserError(`🟩 "${guess.toUpperCase()}" is not in the word list. Try a different word.`);
  }

  // Apply guess
  session.guesses.push(guess);
  const feedback = computeWordleFeedback(guess, target);
  const guessNum = session.guesses.length;

  if (guess === target) {
    session.solved = true;
    session.completedAt = new Date().toISOString();
    await setVariable(gameServerId, moduleId, sessionKey, session);

    // Record play attempt (session completed — win)
    await recordPlay(gameServerId, moduleId, pog.playerId, 'wordle');

    const rawPoints = Math.round(config.pointsWordleBase * (7 - guessNum) / 6);
    const { actualPoints, multiplier, currencyPaid, cappedByDaily, clippedByDaily } = await awardPoints({
      gameServerId, moduleId, pog, game: 'wordle', points: rawPoints, config, playerName: player.name,
    });
    await updateWordleStreak(gameServerId, moduleId, pog.playerId, true);

    const statsKey = `minigames_stats:${pog.playerId}`;
    const stats = await getVariable(gameServerId, moduleId, statsKey);
    const streak = stats?.streaks?.wordle?.current ?? 1;
    const boostNote = multiplier > 1 ? ` (boost ×${multiplier.toFixed(2)})` : '';
    const currencyNote = currencyPaid > 0 ? ` +${currencyPaid} currency` : '';
    const capNote = cappedByDaily
      ? ' Daily point cap reached — no points awarded.'
      : clippedByDaily
        ? ` Daily cap clipped reward to ${actualPoints} points.`
        : '';
    await pog.pm(`🟩 ${feedback} SOLVED in ${guessNum}! +${actualPoints} points${boostNote}${currencyNote}.${capNote} Streak: ${streak} 🔥`);
  } else {
    await setVariable(gameServerId, moduleId, sessionKey, session);
    const remaining = 6 - guessNum;

    if (remaining === 0) {
      // Record play attempt (session completed — loss)
      await recordPlay(gameServerId, moduleId, pog.playerId, 'wordle');
      await updateWordleStreak(gameServerId, moduleId, pog.playerId, false);
      await pog.pm(`🟩 ${feedback} No guesses left! The word was: ${target.toUpperCase()}. Better luck tomorrow!`);
    } else {
      await pog.pm(`🟩 ${feedback} (${remaining}/6 left)`);
    }
  }
}

await main();
