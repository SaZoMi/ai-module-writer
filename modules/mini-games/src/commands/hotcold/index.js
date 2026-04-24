import { data, TakaroUserError, checkPermission } from '@takaro/helpers';
import {
  getVariable, setVariable, checkBanAndCap, awardPoints, recordPlay, todayUTC,
} from './mini-games-helpers.js';

function warmthLabel(guess, prevGuess, secret) {
  if (prevGuess === null || prevGuess === undefined) return 'Baseline';
  const dist = Math.abs(secret - guess);
  const prevDist = Math.abs(secret - prevGuess);
  if (dist < prevDist) return '🔥 Warmer';
  if (dist > prevDist) return '🧊 Colder';
  return '😐 Same';
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
  if (!puzzle || puzzle.date !== today || puzzle.hotcold === undefined || puzzle.hotcold === null) {
    await pog.pm("🌡️ Hot/Cold: Today's puzzle isn't ready yet.");
    return;
  }

  const secret = puzzle.hotcold;
  const sessionKey = `minigames_session:${pog.playerId}:hotcold`;
  const session = await getVariable(gameServerId, moduleId, sessionKey) ?? { guesses: [], solved: false, completedAt: null };

  const rawNum = args.number;
  // defaultValue "0" is used when no arg is provided; treat 0 as "no guess"
  const hasGuess = rawNum !== null && rawNum !== undefined && rawNum !== 0 && rawNum !== '0';

  // No arg — status
  if (!hasGuess) {
    if (session.solved) {
      await pog.pm(`🌡️ Hot/Cold: You SOLVED today's puzzle in ${session.guesses.length} guess(es)!`);
      return;
    }
    if (session.guesses.length === 0) {
      await pog.pm('🌡️ Hot/Cold: No guesses yet. Use /hotcold <number 1-1000>!');
      return;
    }
    if (session.guesses.length >= 8) {
      await pog.pm(`🌡️ Hot/Cold: Game over! You used all 8 guesses. The secret was ${secret}.`);
      return;
    }
    const trail = session.guesses.map((g, i) => {
      const prev = i > 0 ? session.guesses[i - 1] : null;
      return `  ${i + 1}. ${g} — ${warmthLabel(g, prev, secret)}`;
    }).join('\n');
    await pog.pm(`🌡️ Hot/Cold: ${8 - session.guesses.length} guesses left.\n${trail}\nUse /hotcold <number> to continue.`);
    return;
  }

  if (session.solved) throw new TakaroUserError("🌡️ You've already solved today's Hot/Cold!");
  if (session.guesses.length >= 8) throw new TakaroUserError(`🌡️ Game over! No guesses left. The secret was ${secret}.`);

  const guess = Math.floor(Number(rawNum));
  if (!Number.isFinite(guess) || guess < 1 || guess > 1000) {
    throw new TakaroUserError('🌡️ Guess must be a whole number between 1 and 1000.');
  }

  await checkBanAndCap(gameServerId, moduleId, pog.playerId, config);

  const prevGuess = session.guesses.length > 0 ? session.guesses[session.guesses.length - 1] : null;
  session.guesses.push(guess);
  const guessNum = session.guesses.length;

  if (guess === secret) {
    session.solved = true;
    session.completedAt = new Date().toISOString();
    await setVariable(gameServerId, moduleId, sessionKey, session);

    await recordPlay(gameServerId, moduleId, pog.playerId, 'hotcold');
    const rawPoints = Math.round(config.pointsHotColdBase * (9 - guessNum) / 8);
    const { actualPoints, multiplier, currencyPaid, cappedByDaily, clippedByDaily } = await awardPoints({
      gameServerId, moduleId, pog, game: 'hotcold', points: rawPoints, config, playerName: player.name,
    });
    const boostNote = multiplier > 1 ? ` (boost ×${multiplier.toFixed(2)})` : '';
    const currencyNote = currencyPaid > 0 ? ` +${currencyPaid} currency` : '';
    const capNote = cappedByDaily
      ? ' Daily point cap reached — no points awarded.'
      : clippedByDaily
        ? ` Daily cap clipped reward to ${actualPoints} points.`
        : '';
    await pog.pm(`🌡️ SOLVED in ${guessNum}! The secret was ${secret}. +${actualPoints} points${boostNote}${currencyNote}.${capNote}`);
  } else {
    await setVariable(gameServerId, moduleId, sessionKey, session);
    const direction = guess < secret ? '⬆️ Higher' : '⬇️ Lower';
    const warmth = warmthLabel(guess, prevGuess, secret);
    const remaining = 8 - guessNum;

    if (remaining === 0) {
      await recordPlay(gameServerId, moduleId, pog.playerId, 'hotcold');
      await pog.pm(`🌡️ ${direction}. ${warmth}. No guesses left! The secret was ${secret}.`);
    } else {
      await pog.pm(`🌡️ ${direction}. ${warmth}. (${remaining} left)`);
    }
  }
}

await main();
