import { takaro, TakaroUserError, checkPermission } from '@takaro/helpers';

// ─── OpenTDB category map (lifted from 7dtd_triviaTime) ───────────────────────
export const OPENTDB_CATEGORIES = {
  general_knowledge: 9, books: 10, film: 11, music: 12, musicals_theatres: 13,
  television: 14, video_games: 15, board_games: 16, science_nature: 17,
  computers: 18, mathematics: 19, mythology: 20, sports: 21, geography: 22,
  history: 23, politics: 24, art: 25, celebrities: 26, animals: 27,
  vehicles: 28, comics: 29, gadgets: 30, anime_manga: 31, cartoon_animations: 32
};

// ─── HTML entity decoder ──────────────────────────────────────────────────────
export function decodeHtmlEntities(s) {
  if (!s) return s;
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&eacute;/g, 'é')
    .replace(/&egrave;/g, 'è')
    .replace(/&ecirc;/g, 'ê')
    .replace(/&agrave;/g, 'à')
    .replace(/&ugrave;/g, 'ù')
    .replace(/&uuml;/g, 'ü')
    .replace(/&ouml;/g, 'ö')
    .replace(/&auml;/g, 'ä')
    .replace(/&ntilde;/g, 'ñ')
    .replace(/&hellip;/g, '...')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));
}

// ─── Variable helpers ─────────────────────────────────────────────────────────

export async function getVariable(gameServerId, moduleId, key) {
  const res = await takaro.variable.variableControllerSearch({
    filters: { key: [key], gameServerId: [gameServerId], moduleId: [moduleId] },
  });
  if (res.data.data.length === 0) return null;
  try {
    return JSON.parse(res.data.data[0].value);
  } catch {
    return res.data.data[0].value;
  }
}

export async function setVariable(gameServerId, moduleId, key, value) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  const existing = await takaro.variable.variableControllerSearch({
    filters: { key: [key], gameServerId: [gameServerId], moduleId: [moduleId] },
  });
  if (existing.data.data.length > 0) {
    await takaro.variable.variableControllerUpdate(existing.data.data[0].id, { value: serialized });
  } else {
    await takaro.variable.variableControllerCreate({ key, value: serialized, gameServerId, moduleId });
  }
}

export async function deleteVariable(gameServerId, moduleId, key) {
  const existing = await takaro.variable.variableControllerSearch({
    filters: { key: [key], gameServerId: [gameServerId], moduleId: [moduleId] },
  });
  if (existing.data.data.length > 0) {
    await takaro.variable.variableControllerDelete(existing.data.data[0].id);
  }
}

export async function searchVariablesByKeyPrefix(gameServerId, moduleId, prefix) {
  // Takaro variable search doesn't support prefix; page through all and filter client-side.
  const results = [];
  let page = 0;
  const limit = 100;
  while (true) {
    const res = await takaro.variable.variableControllerSearch({
      filters: { gameServerId: [gameServerId], moduleId: [moduleId] },
      page,
      limit,
      sortBy: 'key',
      sortDirection: 'asc',
    });
    const batch = res.data.data;
    for (const v of batch) {
      if (v.key.startsWith(prefix)) results.push(v);
    }
    if (batch.length < limit) break;
    page++;
  }
  return results;
}

// ─── Today's UTC date string ──────────────────────────────────────────────────
export function todayUTC() {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

// ─── Player lookup by name ────────────────────────────────────────────────────
export async function findPlayerByName(gameServerId, name) {
  // Search globally by name first
  const res = await takaro.player.playerControllerSearch({
    filters: { name: [name] },
    limit: 5,
  });
  const matches = res.data.data.filter(p => p.name.toLowerCase() === name.toLowerCase());
  if (matches.length === 0) return null;

  // Verify the player is on the target gameServer to avoid cross-server name collisions
  for (const player of matches) {
    const pogRes = await takaro.playerOnGameserver.playerOnGameServerControllerSearch({
      filters: { gameServerId: [gameServerId], playerId: [player.id] },
      limit: 1,
    });
    if (pogRes.data.data.length > 0) {
      return player;
    }
  }
  return null;
}

// ─── Player lookup by gameId (in-game identifier) ────────────────────────────
export async function findPlayerByGameId(gameServerId, gameId) {
  const res = await takaro.playerOnGameserver.playerOnGameServerControllerSearch({
    filters: { gameServerId: [gameServerId], gameId: [gameId] },
    limit: 1,
  });
  if (res.data.data.length === 0) return null;
  const pog = res.data.data[0];
  // Fetch the player record for name and id
  const playerRes = await takaro.player.playerControllerGetOne(pog.playerId);
  return { id: pog.playerId, name: playerRes.data.data.name, pog };
}

export async function findPogByPlayerId(gameServerId, playerId) {
  const res = await takaro.playerOnGameserver.playerOnGameServerControllerSearch({
    filters: { gameServerId: [gameServerId], playerId: [playerId] },
    limit: 1,
  });
  if (res.data.data.length === 0) return null;
  return res.data.data[0];
}

// ─── Scorer ───────────────────────────────────────────────────────────────────

export async function checkBanAndCap(gameServerId, moduleId, playerId, config) {
  // Check ban — always throws if banned
  const banKey = `minigames_ban:${playerId}`;
  const ban = await getVariable(gameServerId, moduleId, banKey);
  if (ban !== null) {
    if (ban.expiresAt && new Date(ban.expiresAt) < new Date()) {
      // Expired ban — clean it up silently
      await deleteVariable(gameServerId, moduleId, banKey);
    } else {
      const expMsg = ban.expiresAt
        ? ` until ${new Date(ban.expiresAt).toUTCString()}`
        : ' permanently';
      throw new TakaroUserError(`You are banned from mini-games${expMsg}.`);
    }
  }

  const cap = config.dailyPointsCapPerPlayer ?? 0;
  if (cap === 0) return { remainingToday: Infinity };

  const windowKey = `minigames_window:${playerId}:${todayUTC()}`;
  const window = await getVariable(gameServerId, moduleId, windowKey);
  const earned = window ? (window.earned ?? 0) : 0;
  const remaining = cap - earned;
  // Do NOT throw when cap is hit — return remainingToday: 0 so callers can still
  // participate in live rounds (they just won't earn any points). Async puzzles
  // can choose to inform the player using this value.
  return { remainingToday: Math.max(remaining, 0) };
}

export async function recordPlay(gameServerId, moduleId, playerId, game) {
  // Increment play count regardless of win/loss outcome.
  const statsKey = `minigames_stats:${playerId}`;
  const stats = await getVariable(gameServerId, moduleId, statsKey) ?? {
    totalPoints: 0,
    gamesPlayed: 0,
    biggestScore: { points: 0, game: null, at: null },
    perGame: {},
    streaks: { wordle: { current: 0, best: 0, lastSolvedDate: null } },
  };
  stats.gamesPlayed = (stats.gamesPlayed ?? 0) + 1;
  if (!stats.perGame[game]) stats.perGame[game] = { points: 0, plays: 0, wins: 0 };
  stats.perGame[game].plays = (stats.perGame[game].plays ?? 0) + 1;
  await setVariable(gameServerId, moduleId, statsKey, stats);
}

export async function awardPoints({ gameServerId, moduleId, pog, game, points, config, playerName }) {
  const { remainingToday } = await checkBanAndCap(gameServerId, moduleId, pog.playerId, config);

  // Apply boost tier
  const boostResult = checkPermission(pog, 'MINIGAMES_BOOST');
  const tier = Math.min(boostResult ? (boostResult.count ?? 0) : 0, 4);
  const multiplier = 1 + tier * 0.25;
  const boostedPoints = Math.round(points * multiplier);

  // Clip to daily cap (0 when cap is exhausted)
  const actualPoints = remainingToday === Infinity ? boostedPoints : Math.min(boostedPoints, remainingToday);
  // Full cap: player earned nothing because daily limit was already at 0
  const cappedByDaily = actualPoints === 0 && boostedPoints > 0;
  // Partial cap: player earned something but less than they would have without the cap
  const clippedByDaily = !cappedByDaily && boostedPoints > actualPoints && remainingToday < boostedPoints;

  // Update daily window only if points were earned
  if (actualPoints > 0) {
    const windowKey = `minigames_window:${pog.playerId}:${todayUTC()}`;
    const window = await getVariable(gameServerId, moduleId, windowKey) ?? { earned: 0 };
    window.earned = (window.earned ?? 0) + actualPoints;
    await setVariable(gameServerId, moduleId, windowKey, window);
  }

  // Update lifetime stats — wins always increment regardless of cap; points only if earned
  const statsKey = `minigames_stats:${pog.playerId}`;
  const stats = await getVariable(gameServerId, moduleId, statsKey) ?? {
    totalPoints: 0,
    gamesPlayed: 0,
    biggestScore: { points: 0, game: null, at: null },
    perGame: {},
    streaks: { wordle: { current: 0, best: 0, lastSolvedDate: null } },
  };

  stats.totalPoints = (stats.totalPoints ?? 0) + actualPoints;

  if (!stats.perGame[game]) stats.perGame[game] = { points: 0, plays: 0, wins: 0 };
  stats.perGame[game].points += actualPoints;
  // wins always increments — a cap-exhausted win still counts as a win on leaderboards
  stats.perGame[game].wins = (stats.perGame[game].wins ?? 0) + 1;

  if (actualPoints > 0 && actualPoints > (stats.biggestScore?.points ?? 0)) {
    stats.biggestScore = { points: actualPoints, game, at: new Date().toISOString() };
  }

  await setVariable(gameServerId, moduleId, statsKey, stats);

  // Currency conversion — skip if no points earned
  let currencyPaid = 0;
  if (actualPoints > 0) {
    const rate = config.pointsToCurrencyRate ?? 0;
    if (rate > 0) {
      currencyPaid = Math.round(actualPoints * rate);
      if (currencyPaid > 0) {
        await takaro.playerOnGameserver.playerOnGameServerControllerAddCurrency(gameServerId, pog.playerId, {
          currency: currencyPaid,
        });
      }
    }
  }

  // Big score event — only fires when actual points were earned
  if (actualPoints > 0) {
    const threshold = config.bigScoreThreshold ?? 500;
    if (actualPoints >= threshold) {
      // Use provided playerName, or fall back to fetching from Takaro, or generic label
      let displayName = playerName ?? pog.player?.name;
      if (!displayName) {
        try {
          const playerRes = await takaro.player.playerControllerGetOne(pog.playerId);
          displayName = playerRes.data.data.name;
        } catch {
          displayName = 'A player';
        }
      }
      await takaro.gameserver.gameServerControllerSendMessage(gameServerId, {
        message: `🎉 BIG SCORE! ${displayName} just scored ${actualPoints} points in ${game}!`,
        opts: {},
      });
    }
  }

  return { actualPoints, currencyPaid, newTotal: stats.totalPoints, boostedPoints, multiplier, cappedByDaily, clippedByDaily };
}

export async function updateWordleStreak(gameServerId, moduleId, playerId, solved) {
  const statsKey = `minigames_stats:${playerId}`;
  const stats = await getVariable(gameServerId, moduleId, statsKey) ?? {
    totalPoints: 0, gamesPlayed: 0,
    biggestScore: { points: 0, game: null, at: null },
    perGame: {},
    streaks: { wordle: { current: 0, best: 0, lastSolvedDate: null } },
  };
  if (!stats.streaks) stats.streaks = { wordle: { current: 0, best: 0, lastSolvedDate: null } };
  if (!stats.streaks.wordle) stats.streaks.wordle = { current: 0, best: 0, lastSolvedDate: null };

  const today = todayUTC();
  const streak = stats.streaks.wordle;

  if (solved) {
    // Extend streak only if we haven't already solved today
    if (streak.lastSolvedDate !== today) {
      // Check if yesterday was the last solve (consecutive)
      const yesterday = new Date();
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      const yesterdayStr = yesterday.toISOString().slice(0, 10);
      if (streak.lastSolvedDate === yesterdayStr || streak.lastSolvedDate === null) {
        streak.current = (streak.current ?? 0) + 1;
      } else {
        streak.current = 1; // streak broken
      }
      streak.best = Math.max(streak.best ?? 0, streak.current);
      streak.lastSolvedDate = today;
    }
  } else {
    // Failed today's puzzle — streak resets only if we haven't solved it yet
    if (streak.lastSolvedDate !== today) {
      streak.current = 0;
    }
  }

  await setVariable(gameServerId, moduleId, statsKey, stats);
}

// ─── Live round fire helpers ──────────────────────────────────────────────────

export function fisherYatesShuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export async function getActiveRound(gameServerId, moduleId) {
  return await getVariable(gameServerId, moduleId, 'minigames_active_round');
}

export async function setActiveRound(gameServerId, moduleId, round) {
  await setVariable(gameServerId, moduleId, 'minigames_active_round', round);
}

export async function clearActiveRound(gameServerId, moduleId) {
  await deleteVariable(gameServerId, moduleId, 'minigames_active_round');
}

// ─── Content bank lazy-create helpers ────────────────────────────────────────

export async function getContentBank(gameServerId, moduleId, key, defaultShape) {
  const existing = await getVariable(gameServerId, moduleId, key);
  if (existing !== null) return existing;
  // Lazy-create empty
  await setVariable(gameServerId, moduleId, key, defaultShape);
  return defaultShape;
}

// ─── Admin warning helper ─────────────────────────────────────────────────────

export async function warnAdminEmptyBank(gameServerId, moduleId, missingKeys) {
  if (missingKeys.length === 0) return;
  const warnKey = 'minigames_admin_warned_empty_bank';
  const today = todayUTC();
  const warned = await getVariable(gameServerId, moduleId, warnKey) ?? { date: null, keys: [] };

  const newKeys = missingKeys.filter(k => warned.date !== today || !warned.keys.includes(k));
  if (newKeys.length === 0) return;

  await setVariable(gameServerId, moduleId, warnKey, { date: today, keys: [...new Set([...warned.keys, ...newKeys])] });
  await takaro.gameserver.gameServerControllerSendMessage(gameServerId, {
    message: `⚠️ [miniGames] Admin notice: content bank(s) are empty — no puzzle for today. Missing variable keys: ${newKeys.join(', ')}. Paste word lists / questions via the Takaro UI Variables tab.`,
    opts: {},
  });
}

// ─── Normalise answer for comparison ──────────────────────────────────────────

export function normaliseAnswer(s) {
  if (s === null || s === undefined) return '';
  return String(s).trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

// ─── Math race expression generator ──────────────────────────────────────────

export function generateMathProblem() {
  const ops = ['+', '-', '*', '/'];
  for (let attempt = 0; attempt < 50; attempt++) {
    const useThreeOperands = Math.random() < 0.5;
    let expr, result;

    if (!useThreeOperands) {
      const a = rand(2, 30);
      const b = rand(2, 30);
      const op = ops[Math.floor(Math.random() * ops.length)];
      if (op === '/') {
        if (b === 0 || a % b !== 0) continue;
        result = a / b;
      } else if (op === '+') { result = a + b; }
      else if (op === '-') { result = a - b; }
      else { result = a * b; }
      expr = `${a} ${opSymbol(op)} ${b}`;
    } else {
      const a = rand(2, 20);
      const b = rand(2, 20);
      const c = rand(2, 20);
      const op1 = ops[Math.floor(Math.random() * ops.length)];
      const op2 = ops[Math.floor(Math.random() * ops.length)];
      // Compute left-to-right (simplified, no precedence ambiguity via display)
      let left;
      if (op1 === '/') { if (a % b !== 0) continue; left = a / b; }
      else if (op1 === '+') { left = a + b; }
      else if (op1 === '-') { left = a - b; }
      else { left = a * b; }

      if (op2 === '/') { if (left % c !== 0) continue; result = left / c; }
      else if (op2 === '+') { result = left + c; }
      else if (op2 === '-') { result = left - c; }
      else { result = left * c; }
      expr = `${a} ${opSymbol(op1)} ${b} ${opSymbol(op2)} ${c}`;
    }

    if (!Number.isInteger(result)) continue;
    if (result < -500 || result > 10000) continue;
    return { expr, result };
  }
  // Fallback: simple addition
  const a = rand(10, 99);
  const b = rand(10, 99);
  return { expr: `${a} + ${b}`, result: a + b };
}

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function opSymbol(op) {
  return op === '*' ? '×' : op === '/' ? '÷' : op;
}

// ─── Shared live-round fire logic ─────────────────────────────────────────────
// Called by both fireLiveRound cronjob and minigamesfirenow command.
// forcedGame: optional string to force a specific game; if omitted, picks randomly.
// onNoGames: callback(reason) when no game can be started (cronjob logs; command throws).
// Returns the round object that was written, or null if skipped.

const REACTION_TOKENS_LIST = ['!first', '!go', '!grab', '!now', '!claim'];

export async function buildAndFireLiveRound(gameServerId, moduleId, config, forcedGame) {
  const games = config.games ?? {};
  const liveGames = ['trivia', 'scramble', 'mathrace', 'reactionrace'].filter(g => games[g] !== false);

  let game;
  if (forcedGame) {
    if (!['trivia', 'scramble', 'mathrace', 'reactionrace'].includes(forcedGame)) {
      throw new TakaroUserError(`Unknown live game: "${forcedGame}". Valid: trivia, scramble, mathrace, reactionrace`);
    }
    if (games[forcedGame] === false) {
      throw new TakaroUserError(`Game "${forcedGame}" is disabled in config.`);
    }
    game = forcedGame;
  } else {
    if (liveGames.length === 0) return null;
    game = liveGames[Math.floor(Math.random() * liveGames.length)];
  }

  const answerWindowSec = config.liveRoundAnswerWindowSec ?? 60;
  const expiresAt = new Date(Date.now() + answerWindowSec * 1000).toISOString();
  let round;

  if (game === 'mathrace') {
    const { expr, result } = generateMathProblem();
    round = { game, prompt: expr, answer: result, answerType: 'number', startedAt: new Date().toISOString(), expiresAt };
    await setActiveRound(gameServerId, moduleId, round);
    await takaro.gameserver.gameServerControllerSendMessage(gameServerId, {
      message: `➗ MATH: ${expr} = ? — /answer <number> (${answerWindowSec}s)`,
      opts: {},
    });

  } else if (game === 'scramble') {
    const bank = await getContentBank(gameServerId, moduleId, 'minigames_content_wordlist', { words: [] });
    const words = (bank.words ?? []).filter(w => /^[a-z]+$/.test(w) && w.length >= 4);
    if (words.length === 0) {
      await warnAdminEmptyBank(gameServerId, moduleId, ['minigames_content_wordlist']);
      return null;
    }
    const word = words[Math.floor(Math.random() * words.length)].toLowerCase();
    let scrambled = word;
    for (let i = 0; i < 5 && scrambled === word; i++) {
      scrambled = fisherYatesShuffle(word.split('')).join('');
    }
    round = { game, prompt: scrambled.toUpperCase(), answer: word, answerType: 'text', startedAt: new Date().toISOString(), expiresAt };
    await setActiveRound(gameServerId, moduleId, round);
    await takaro.gameserver.gameServerControllerSendMessage(gameServerId, {
      message: `🔤 SCRAMBLE: ${scrambled.toUpperCase()} — /answer <word> (${answerWindowSec}s)`,
      opts: {},
    });

  } else if (game === 'reactionrace') {
    const token = REACTION_TOKENS_LIST[Math.floor(Math.random() * REACTION_TOKENS_LIST.length)];
    round = { game, prompt: token, answer: token, answerType: 'rawchat', startedAt: new Date().toISOString(), expiresAt };
    await setActiveRound(gameServerId, moduleId, round);
    await takaro.gameserver.gameServerControllerSendMessage(gameServerId, {
      message: `⚡ REACTION: first to type ${token} in chat wins! (${answerWindowSec}s)`,
      opts: {},
    });

  } else if (game === 'trivia') {
    let questionData = null;

    if (config.triviaQuestionSource !== 'custom') {
      try {
        let url = 'https://opentdb.com/api.php?amount=1';
        const categories = config.triviaApiCategory ?? ['any'];
        const nonAnyCategories = categories.filter(c => c !== 'any');
        if (nonAnyCategories.length > 0) {
          const catKey = nonAnyCategories[Math.floor(Math.random() * nonAnyCategories.length)];
          const catId = OPENTDB_CATEGORIES[catKey];
          if (catId) url += `&category=${catId}`;
        }
        if (config.triviaApiDifficulty && config.triviaApiDifficulty !== 'any') url += `&difficulty=${config.triviaApiDifficulty}`;
        if (config.triviaApiType && config.triviaApiType !== 'any') url += `&type=${config.triviaApiType}`;

        const response = await takaro.axios.get(url);
        if (response.data?.response_code === 0 && response.data?.results?.length > 0) {
          const q = response.data.results[0];
          questionData = {
            question: decodeHtmlEntities(q.question),
            answer: decodeHtmlEntities(q.correct_answer),
            incorrectAnswers: (q.incorrect_answers ?? []).map(decodeHtmlEntities),
            type: q.type === 'boolean' ? 'boolean' : 'multiple',
          };
        }
      } catch (apiErr) {
        console.error(`miniGames: OpenTDB fetch failed, falling back to custom bank. Error: ${apiErr}`);
      }
    }

    if (!questionData) {
      const bank = await getContentBank(gameServerId, moduleId, 'minigames_content_trivia', { questions: [] });
      const questions = bank.questions ?? [];
      if (questions.length === 0) {
        await warnAdminEmptyBank(gameServerId, moduleId, ['minigames_content_trivia']);
        return null;
      }
      const q = questions[Math.floor(Math.random() * questions.length)];
      if (q.options && typeof q.answerIndex === 'number') {
        questionData = {
          question: q.question,
          answer: q.options[q.answerIndex],
          incorrectAnswers: q.options.filter((_, i) => i !== q.answerIndex),
          type: 'multiple',
        };
      } else {
        questionData = {
          question: q.question,
          answer: q.answer,
          incorrectAnswers: q.incorrectAnswers ?? [],
          type: q.incorrectAnswers?.length > 0 ? 'multiple' : 'text',
        };
      }
    }

    let displayedOptions = null;
    let announcement;
    if (questionData.type === 'boolean') {
      displayedOptions = ['True', 'False'];
      announcement = `❓ TRIVIA: ${questionData.question}\n/answer true or /answer false (${answerWindowSec}s)`;
    } else if (questionData.type === 'multiple' && questionData.incorrectAnswers?.length > 0) {
      const allOptions = fisherYatesShuffle([questionData.answer, ...questionData.incorrectAnswers]);
      displayedOptions = allOptions;
      announcement = `❓ TRIVIA: ${questionData.question}\nOptions: ${allOptions.join(', ')} — /answer <choice> (${answerWindowSec}s)`;
    } else {
      announcement = `❓ TRIVIA: ${questionData.question} — /answer <your guess> (${answerWindowSec}s)`;
    }

    round = {
      game,
      prompt: questionData.question,
      answer: questionData.answer,
      answerType: 'text',
      displayedOptions,
      startedAt: new Date().toISOString(),
      expiresAt,
    };
    await setActiveRound(gameServerId, moduleId, round);
    await takaro.gameserver.gameServerControllerSendMessage(gameServerId, {
      message: announcement,
      opts: {},
    });
  }

  return round ?? null;
}
