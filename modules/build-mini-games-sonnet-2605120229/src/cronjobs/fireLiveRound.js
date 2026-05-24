import { data, takaro } from '@takaro/helpers';

const OPENTDB_CATEGORIES = {
  general_knowledge: 9, books: 10, film: 11, music: 12, musicals_theatres: 13,
  television: 14, video_games: 15, board_games: 16, science_nature: 17,
  computers: 18, mathematics: 19, mythology: 20, sports: 21, geography: 22,
  history: 23, politics: 24, art: 25, celebrities: 26, animals: 27,
  vehicles: 28, comics: 29, gadgets: 30, anime_manga: 31, cartoon_animations: 32,
};

function decodeHtmlEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&eacute;/g, 'é')
    .replace(/&agrave;/g, 'à').replace(/&egrave;/g, 'è').replace(/&rsquo;/g, "'")
    .replace(/&ldquo;/g, '"').replace(/&rdquo;/g, '"').replace(/&hellip;/g, '…');
}

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function main() {
  const { gameServerId, module: mod } = data;
  const moduleId = mod.id;
  const userConfig = mod.userConfig;

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

  // Check elapsed time since last round
  const lastFiredVar = await readVar('minigames_last_round_firedAt');
  if (lastFiredVar) {
    let lastFiredData;
    try { lastFiredData = JSON.parse(lastFiredVar.value); } catch (e) { lastFiredData = null; }
    if (lastFiredData && lastFiredData.firedAt) {
      const elapsed = Date.now() - new Date(lastFiredData.firedAt).getTime();
      const intervalMs = (userConfig.liveRoundIntervalMinutes || 30) * 60000;
      if (elapsed < intervalMs) return;
    }
  }

  // Check player count
  try {
    const playersResult = await takaro.playerOnGameserver.playerOnGameServerControllerSearch({
      filters: { gameServerId: [gameServerId], online: [true] },
      limit: 1,
    });
    const total = playersResult.data.meta ? playersResult.data.meta.total : (playersResult.data.data ? playersResult.data.data.length : 0);
    const minPlayers = userConfig.minPlayersForLiveRound || 2;
    if (total < minPlayers) return;
  } catch (e) {
    // If player count check fails, proceed anyway
  }

  // Determine enabled games
  const games = userConfig.games || {};
  const enabledGames = ['trivia', 'scramble', 'mathrace', 'reactionrace'].filter(g => games[g] !== false);
  if (enabledGames.length === 0) return;

  const chosenGame = enabledGames[Math.floor(Math.random() * enabledGames.length)];

  const now = new Date();
  const expiresAt = new Date(now.getTime() + (userConfig.liveRoundAnswerWindowSec || 60) * 1000).toISOString();

  let roundData = null;
  let chatMessage = null;

  if (chosenGame === 'trivia') {
    let questionData = null;
    const source = userConfig.triviaQuestionSource || 'api';

    if (source === 'api' || source === undefined) {
      try {
        let url = 'https://opentdb.com/api.php?amount=1';
        const cats = userConfig.triviaApiCategory;
        if (cats && Array.isArray(cats) && !cats.includes('any') && cats.length > 0) {
          const catKey = cats[Math.floor(Math.random() * cats.length)];
          const catId = OPENTDB_CATEGORIES[catKey];
          if (catId) url += `&category=${catId}`;
        }
        const diff = userConfig.triviaApiDifficulty;
        if (diff && diff !== 'any') url += `&difficulty=${diff}`;
        const type = userConfig.triviaApiType;
        if (type && type !== 'any') url += `&type=${type}`;

        const resp = await takaro.axios.get(url);
        if (resp.data.response_code === 0 && resp.data.results && resp.data.results.length > 0) {
          const q = resp.data.results[0];
          questionData = {
            question: decodeHtmlEntities(q.question),
            answer: decodeHtmlEntities(q.correct_answer),
            incorrectAnswers: (q.incorrect_answers || []).map(a => decodeHtmlEntities(a)),
            type: q.type,
          };
        }
      } catch (e) {
        // Fall through to custom
      }
    }

    if (!questionData) {
      // Custom/fallback
      const triviaVar = await readVar('minigames_content_trivia');
      if (!triviaVar) {
        // Skip and warn
        await takaro.gameserver.gameServerControllerSendMessage(gameServerId, {
          message: '⚠️ [MiniGames] No trivia content available. Seed minigames_content_trivia.',
        });
        return;
      }
      let triviaData;
      try { triviaData = JSON.parse(triviaVar.value); } catch (e) { triviaData = []; }
      const questions = Array.isArray(triviaData) ? triviaData : [];
      if (questions.length === 0) {
        await takaro.gameserver.gameServerControllerSendMessage(gameServerId, {
          message: '⚠️ [MiniGames] No trivia content available. Seed minigames_content_trivia.',
        });
        return;
      }
      const raw = questions[Math.floor(Math.random() * questions.length)];
      if (raw.options && Array.isArray(raw.options) && raw.answerIndex !== undefined) {
        const incorrectAnswers = raw.options.filter((_, i) => i !== raw.answerIndex);
        questionData = {
          question: raw.question,
          answer: raw.options[raw.answerIndex],
          incorrectAnswers,
          type: raw.options.length === 2 ? 'boolean' : 'multiple',
        };
      } else if (raw.answer) {
        questionData = {
          question: raw.question,
          answer: raw.answer,
          incorrectAnswers: [],
          type: 'text',
        };
      } else {
        return;
      }
    }

    let displayedOptions = null;
    let answerType = 'text';

    if (questionData.type === 'multiple') {
      const options = shuffleArray([questionData.answer, ...questionData.incorrectAnswers]);
      displayedOptions = options;
      answerType = 'multiple';
      const letters = ['A', 'B', 'C', 'D'];
      const optionStr = options.map((o, i) => `${letters[i]}) ${o}`).join(', ');
      chatMessage = `❓ TRIVIA: ${questionData.question} Options: ${optionStr} — /answer <choice> (60s)`;
    } else if (questionData.type === 'boolean') {
      displayedOptions = ['True', 'False'];
      answerType = 'boolean';
      chatMessage = `❓ TRIVIA: ${questionData.question} — /answer true or false (60s)`;
    } else {
      chatMessage = `❓ TRIVIA: ${questionData.question} — /answer <guess> (60s)`;
    }

    roundData = {
      game: 'trivia',
      prompt: questionData.question,
      answer: questionData.answer,
      answerType,
      displayedOptions,
      expiresAt,
      startedAt: now.toISOString(),
    };
  } else if (chosenGame === 'scramble') {
    const wordlistVar = await readVar('minigames_content_wordlist');
    if (!wordlistVar) {
      await takaro.gameserver.gameServerControllerSendMessage(gameServerId, {
        message: '⚠️ [MiniGames] No wordlist available. Seed minigames_content_wordlist.',
      });
      return;
    }
    let wordlistData;
    try { wordlistData = JSON.parse(wordlistVar.value); } catch (e) { wordlistData = []; }
    const words = (Array.isArray(wordlistData) ? wordlistData : (wordlistData && Array.isArray(wordlistData.words) ? wordlistData.words : [])).filter(w => typeof w === 'string' && w.length >= 4);
    if (words.length === 0) {
      await takaro.gameserver.gameServerControllerSendMessage(gameServerId, {
        message: '⚠️ [MiniGames] No valid words (length >= 4) available. Seed minigames_content_wordlist.',
      });
      return;
    }

    const original = words[Math.floor(Math.random() * words.length)];
    let scrambled = original;
    for (let attempt = 0; attempt < 5; attempt++) {
      scrambled = shuffleArray(original.split('')).join('');
      if (scrambled !== original) break;
    }

    roundData = {
      game: 'scramble',
      prompt: scrambled,
      answer: original,
      answerType: 'text',
      expiresAt,
      startedAt: now.toISOString(),
    };
    chatMessage = `🔤 SCRAMBLE: ${scrambled.toUpperCase()} — /answer <word> (60s)`;
  } else if (chosenGame === 'mathrace') {
    const ops = ['+', '-', '*', '/'];
    let expression = '';
    let result = 0;
    let valid = false;

    for (let attempt = 0; attempt < 10; attempt++) {
      const use3 = Math.random() < 0.5;
      let a = Math.floor(Math.random() * 29) + 2;
      let b = Math.floor(Math.random() * 29) + 2;
      const op1 = ops[Math.floor(Math.random() * ops.length)];

      let val;
      if (op1 === '/') {
        const divisor = b;
        a = divisor * (Math.floor(Math.random() * 10) + 1);
        val = a / divisor;
      } else if (op1 === '+') {
        val = a + b;
      } else if (op1 === '-') {
        val = a - b;
      } else {
        val = a * b;
      }

      if (use3) {
        let c = Math.floor(Math.random() * 29) + 2;
        const op2 = ops[Math.floor(Math.random() * ops.length)];
        let val2;
        if (op2 === '/') {
          if (val === 0 || !Number.isInteger(val)) continue;
          const divisor2 = c;
          const newVal = divisor2 * (Math.floor(Math.random() * 10) + 1);
          // Use val as intermediate result, divide by c if val divisible by c
          if (val % c !== 0) {
            c = 1;
            val2 = val;
          } else {
            val2 = val / c;
          }
        } else if (op2 === '+') {
          val2 = val + c;
        } else if (op2 === '-') {
          val2 = val - c;
        } else {
          val2 = val * c;
        }
        result = Math.round(val2);
        if (result < -500 || result > 10000 || !Number.isFinite(result)) continue;

        const op1Display = op1 === '*' ? '×' : op1 === '-' ? '−' : op1 === '/' ? '÷' : op1;
        const op2Display = op2 === '*' ? '×' : op2 === '-' ? '−' : op2 === '/' ? '÷' : op2;
        expression = `${a} ${op1Display} ${b} ${op2Display} ${c}`;
      } else {
        result = Math.round(val);
        if (result < -500 || result > 10000 || !Number.isFinite(result)) continue;

        const op1Display = op1 === '*' ? '×' : op1 === '-' ? '−' : op1 === '/' ? '÷' : op1;
        expression = `${a} ${op1Display} ${b}`;
      }

      valid = true;
      break;
    }

    if (!valid) {
      // Fallback to simple addition
      const a = Math.floor(Math.random() * 29) + 2;
      const b = Math.floor(Math.random() * 29) + 2;
      result = a + b;
      expression = `${a} + ${b}`;
    }

    roundData = {
      game: 'mathrace',
      prompt: expression,
      answer: result,
      answerType: 'number',
      expiresAt,
      startedAt: now.toISOString(),
    };
    chatMessage = `➗ MATH: ${expression} = ? — /answer <number> (60s)`;
  } else if (chosenGame === 'reactionrace') {
    const tokens = ['!first', '!go', '!grab', '!now', '!claim'];
    const token = tokens[Math.floor(Math.random() * tokens.length)];

    roundData = {
      game: 'reactionrace',
      prompt: token,
      answer: token,
      answerType: 'rawchat',
      expiresAt,
      startedAt: now.toISOString(),
    };
    chatMessage = `⚡ REACTION: first to type ${token} wins! (60s)`;
  }

  if (!roundData || !chatMessage) return;

  // Write active round
  const activeRoundVar = await readVar('minigames_active_round');
  if (activeRoundVar) {
    await takaro.variable.variableControllerUpdate(activeRoundVar.id, { value: JSON.stringify(roundData) });
  } else {
    await takaro.variable.variableControllerCreate({ key: 'minigames_active_round', value: JSON.stringify(roundData), moduleId, gameServerId });
  }

  // Write last fired timestamp
  const lastFiredVar2 = await readVar('minigames_last_round_firedAt');
  const firedData = { firedAt: now.toISOString() };
  if (lastFiredVar2) {
    await takaro.variable.variableControllerUpdate(lastFiredVar2.id, { value: JSON.stringify(firedData) });
  } else {
    await takaro.variable.variableControllerCreate({ key: 'minigames_last_round_firedAt', value: JSON.stringify(firedData), moduleId, gameServerId });
  }

  // Send chat announcement
  await takaro.gameserver.gameServerControllerSendMessage(gameServerId, { message: chatMessage });
}

await main();
