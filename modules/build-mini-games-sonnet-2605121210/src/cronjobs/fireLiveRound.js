import { data, takaro } from '@takaro/helpers';

async function main() {
  const moduleId = data.module.moduleId;
  const cfg = data.module.userConfig;
  const { gameServerId } = data;

  const OPENTDB_CATEGORIES = {
    general_knowledge: 9, books: 10, film: 11, music: 12, musicals_theatres: 13,
    television: 14, video_games: 15, board_games: 16, science_nature: 17,
    computers: 18, mathematics: 19, mythology: 20, sports: 21, geography: 22,
    history: 23, politics: 24, art: 25, celebrities: 26, animals: 27,
    vehicles: 28, comics: 29, gadgets: 30, anime_manga: 31, cartoon_animations: 32
  };

  function decodeHtmlEntities(s) {
    if (!s) return s;
    return String(s)
      .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;/g, "'")
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'");
  }

  // 1. Check if already an active round
  const activeRoundRes = await takaro.variable.variableControllerSearch({
    filters: { key: ['minigames_active_round'], gameServerId: [gameServerId], moduleId: [moduleId] },
    page: 0, limit: 1
  });
  if (activeRoundRes.data.data.length > 0) {
    const existingRound = JSON.parse(activeRoundRes.data.data[0].value);
    if (!existingRound.expiresAt || new Date(existingRound.expiresAt) > new Date()) {
      // Active round still running, skip
      return;
    }
  }

  // 2. Check elapsed time since last round
  const intervalMinutes = cfg.liveRoundIntervalMinutes || 30;
  const lastFiredRes = await takaro.variable.variableControllerSearch({
    filters: { key: ['minigames_last_round_firedAt'], gameServerId: [gameServerId], moduleId: [moduleId] },
    page: 0, limit: 1
  });
  if (lastFiredRes.data.data.length > 0) {
    const lastFired = new Date(lastFiredRes.data.data[0].value).getTime();
    if ((Date.now() - lastFired) < (intervalMinutes * 60000)) {
      return;
    }
  }

  // 3. Check player count
  const playersRes = await takaro.gameserver.gameServerControllerGetPlayers(gameServerId);
  const onlinePlayers = (playersRes.data.data || []).filter(p => p.online);
  const minPlayers = cfg.minPlayersForLiveRound || 2;
  if (onlinePlayers.length < minPlayers) {
    return;
  }

  // 4. Pick a random enabled game
  const gamesCfg = cfg.games || {};
  const enabledGames = ['trivia', 'scramble', 'mathrace', 'reactionrace'].filter(g => {
    return gamesCfg[g] !== false;
  });
  if (enabledGames.length === 0) return;
  const chosenGame = enabledGames[Math.floor(Math.random() * enabledGames.length)];

  const answerWindowSec = cfg.liveRoundAnswerWindowSec || 60;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + answerWindowSec * 1000).toISOString();
  const startedAt = now.toISOString();

  let roundData = null;
  let announceMsg = '';

  // 5. Generate round data based on chosen game
  if (chosenGame === 'trivia') {
    let questionData = null;

    // Try OpenTDB API if source is 'api' or default
    if (!cfg.triviaQuestionSource || cfg.triviaQuestionSource === 'api') {
      try {
        let url = 'https://opentdb.com/api.php?amount=1';
        const triviaCategory = cfg.triviaApiCategory;
        if (triviaCategory && triviaCategory !== 'any' && OPENTDB_CATEGORIES[triviaCategory]) {
          url += `&category=${OPENTDB_CATEGORIES[triviaCategory]}`;
        }
        const triviaDifficulty = cfg.triviaApiDifficulty;
        if (triviaDifficulty && triviaDifficulty !== 'any') {
          url += `&difficulty=${triviaDifficulty}`;
        }
        const triviaType = cfg.triviaApiType;
        if (triviaType && triviaType !== 'any') {
          url += `&type=${triviaType}`;
        }

        const apiRes = await takaro.axios.get(url);
        if (apiRes.data && apiRes.data.response_code === 0 && apiRes.data.results && apiRes.data.results.length > 0) {
          const result = apiRes.data.results[0];
          const question = decodeHtmlEntities(result.question);
          const correctAnswer = decodeHtmlEntities(result.correct_answer);
          const incorrectAnswers = result.incorrect_answers.map(decodeHtmlEntities);
          questionData = { question, answer: correctAnswer, type: result.type, incorrectAnswers };
        }
      } catch (e) {
        console.log('OpenTDB fetch failed, falling back to custom:', e.message);
      }
    }

    // Fallback to custom trivia content
    if (!questionData) {
      const customTriviaRes = await takaro.variable.variableControllerSearch({
        filters: { key: ['minigames_content_trivia'], gameServerId: [gameServerId], moduleId: [moduleId] },
        page: 0, limit: 1
      });
      if (customTriviaRes.data.data.length === 0 || !customTriviaRes.data.data[0].value) {
        console.log('No trivia content available, skipping round.');
        return;
      }
      const customQuestions = JSON.parse(customTriviaRes.data.data[0].value);
      if (!Array.isArray(customQuestions) || customQuestions.length === 0) {
        console.log('Empty trivia content, skipping round.');
        return;
      }
      const picked = customQuestions[Math.floor(Math.random() * customQuestions.length)];
      if (picked.options && picked.answerIndex !== undefined) {
        const others = picked.options.filter((_, i) => i !== picked.answerIndex);
        questionData = {
          question: picked.question,
          answer: picked.options[picked.answerIndex],
          type: 'multiple',
          incorrectAnswers: others
        };
      } else {
        questionData = { question: picked.question, answer: picked.answer, type: 'text', incorrectAnswers: [] };
      }
    }

    // Build displayed options
    const allOptions = [questionData.answer, ...questionData.incorrectAnswers];
    // Fisher-Yates shuffle
    for (let i = allOptions.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [allOptions[i], allOptions[j]] = [allOptions[j], allOptions[i]];
    }
    const displayedOptions = allOptions;

    roundData = {
      game: 'trivia',
      prompt: questionData.question,
      answer: questionData.answer,
      answerType: 'text',
      displayedOptions,
      startedAt,
      expiresAt
    };

    if (questionData.type === 'boolean') {
      announceMsg = `❓ TRIVIA: ${questionData.question}? /answer true or /answer false (${answerWindowSec}s)`;
    } else {
      announceMsg = `❓ TRIVIA: ${questionData.question} — Options: ${displayedOptions.join(', ')} — /answer <choice> (${answerWindowSec}s)`;
    }

  } else if (chosenGame === 'scramble') {
    const wordlistRes = await takaro.variable.variableControllerSearch({
      filters: { key: ['minigames_content_wordlist'], gameServerId: [gameServerId], moduleId: [moduleId] },
      page: 0, limit: 1
    });
    if (wordlistRes.data.data.length === 0 || !wordlistRes.data.data[0].value) {
      console.log('No wordlist content, skipping round.');
      return;
    }
    let wordlist = JSON.parse(wordlistRes.data.data[0].value);
    wordlist = wordlist.filter(w => typeof w === 'string' && w.length >= 4);
    if (wordlist.length === 0) {
      console.log('Empty wordlist, skipping round.');
      return;
    }

    const originalWord = wordlist[Math.floor(Math.random() * wordlist.length)];
    let scrambled = originalWord;
    for (let attempt = 0; attempt < 5 && scrambled === originalWord; attempt++) {
      const arr = originalWord.split('');
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      scrambled = arr.join('');
    }

    roundData = {
      game: 'scramble',
      prompt: scrambled,
      answer: originalWord,
      answerType: 'text',
      startedAt,
      expiresAt
    };
    announceMsg = `🔤 SCRAMBLE: ${scrambled.toUpperCase()} — /answer <word> (${answerWindowSec}s)`;

  } else if (chosenGame === 'mathrace') {
    function generateMath() {
      const ops = ['+', '-', '*', '/'];
      const useThreeOperands = Math.random() < 0.5;

      function randInt(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
      }

      function applyOp(a, op, b) {
        if (op === '+') return a + b;
        if (op === '-') return a - b;
        if (op === '*') return a * b;
        if (op === '/') return a / b;
      }

      function displayOp(op) {
        if (op === '*') return '×';
        if (op === '/') return '÷';
        return op;
      }

      if (!useThreeOperands) {
        let a, b, op, result;
        for (let tries = 0; tries < 20; tries++) {
          op = ops[Math.floor(Math.random() * ops.length)];
          a = randInt(2, 30);
          b = randInt(2, 30);
          if (op === '/') {
            a = b * randInt(2, 10);
            if (a > 30) a = b * 2;
          }
          result = applyOp(a, op, b);
          if (Number.isInteger(result) && result >= -500 && result <= 10000) {
            return { expression: `${a} ${displayOp(op)} ${b}`, result };
          }
        }
        return null;
      } else {
        let a, b, c, op1, op2, result;
        for (let tries = 0; tries < 20; tries++) {
          op1 = ops[Math.floor(Math.random() * ops.length)];
          op2 = ops[Math.floor(Math.random() * ops.length)];
          a = randInt(2, 30);
          b = randInt(2, 30);
          c = randInt(2, 30);
          if (op1 === '/') {
            a = b * randInt(2, 5);
            if (a > 30) a = b * 2;
          }
          const intermediate = applyOp(a, op1, b);
          if (!Number.isInteger(intermediate)) continue;
          if (op2 === '/') {
            if (c === 0 || intermediate % c !== 0) continue;
          }
          result = applyOp(intermediate, op2, c);
          if (Number.isInteger(result) && result >= -500 && result <= 10000) {
            return { expression: `${a} ${displayOp(op1)} ${b} ${displayOp(op2)} ${c}`, result };
          }
        }
        return null;
      }
    }

    let mathResult = null;
    for (let attempts = 0; attempts < 10; attempts++) {
      mathResult = generateMath();
      if (mathResult) break;
    }

    if (!mathResult) {
      console.log('Could not generate a valid math expression, skipping round.');
      return;
    }

    roundData = {
      game: 'mathrace',
      prompt: mathResult.expression,
      answer: mathResult.result,
      answerType: 'number',
      startedAt,
      expiresAt
    };
    announceMsg = `➗ MATH: ${mathResult.expression} = ? — /answer <number> (${answerWindowSec}s)`;

  } else if (chosenGame === 'reactionrace') {
    const tokens = ['!first', '!go', '!grab', '!now', '!claim'];
    const token = tokens[Math.floor(Math.random() * tokens.length)];
    roundData = {
      game: 'reactionrace',
      prompt: token,
      answer: token,
      answerType: 'rawchat',
      startedAt,
      expiresAt
    };
    announceMsg = `⚡ REACTION: first to type ${token} wins! (${answerWindowSec}s)`;
  }

  if (!roundData) return;

  // 6. Write minigames_active_round variable
  if (activeRoundRes.data.data.length > 0) {
    await takaro.variable.variableControllerUpdate(activeRoundRes.data.data[0].id, { value: JSON.stringify(roundData) });
  } else {
    await takaro.variable.variableControllerCreate({
      key: 'minigames_active_round',
      value: JSON.stringify(roundData),
      gameServerId,
      moduleId
    });
  }

  // 7. Write minigames_last_round_firedAt
  if (lastFiredRes.data.data.length > 0) {
    await takaro.variable.variableControllerUpdate(lastFiredRes.data.data[0].id, { value: now.toISOString() });
  } else {
    await takaro.variable.variableControllerCreate({
      key: 'minigames_last_round_firedAt',
      value: now.toISOString(),
      gameServerId,
      moduleId
    });
  }

  // 8. Announce to server
  await takaro.gameserver.gameServerControllerSendMessage(gameServerId, { message: announceMsg });
}

await main();
