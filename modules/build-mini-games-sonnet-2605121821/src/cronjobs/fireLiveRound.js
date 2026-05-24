import { data, takaro, TakaroUserError, checkPermission } from '@takaro/helpers';

async function main() {
  const { gameServerId, module: mod } = data;
  const moduleId = mod.id;
  const userConfig = mod.userConfig;

  const OPENTDB_CATEGORIES = {
    general_knowledge: 9, books: 10, film: 11, music: 12, musicals_theatres: 13,
    television: 14, video_games: 15, board_games: 16, science_nature: 17,
    computers: 18, mathematics: 19, mythology: 20, sports: 21, geography: 22,
    history: 23, politics: 24, art: 25, celebrities: 26, animals: 27,
    vehicles: 28, comics: 29, gadgets: 30, anime_manga: 31, cartoon_animations: 32
  };

  function decodeHtmlEntities(s) {
    return String(s)
      .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;/g, "'")
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&eacute;/g, 'é')
      .replace(/&egrave;/g, 'è').replace(/&agrave;/g, 'à').replace(/&ntilde;/g, 'ñ')
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)));
  }

  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  async function getVar(key) {
    const res = await takaro.variable.variableControllerSearch({
      filters: { key: [key], gameServerId: [gameServerId] }
    });
    if (res.data.data.length === 0) return null;
    return { id: res.data.data[0].id, value: JSON.parse(res.data.data[0].value) };
  }

  async function setVar(key, value) {
    const existing = await getVar(key);
    if (existing) {
      await takaro.variable.variableControllerUpdate(existing.id, { value: JSON.stringify(value) });
    } else {
      await takaro.variable.variableControllerCreate({ key, value: JSON.stringify(value), gameServerId, moduleId });
    }
  }

  async function deleteVar(key) {
    const existing = await getVar(key);
    if (existing) await takaro.variable.variableControllerDelete(existing.id);
  }

  // STEP 1: Check if a round is already active
  const activeRound = await getVar('minigames_active_round');
  if (activeRound) {
    const expiresAt = new Date(activeRound.value.expiresAt);
    if (expiresAt > new Date()) {
      // Active round not yet expired, return early
      return;
    }
  }

  // STEP 2: Check elapsed time since last round
  const lastFiredVar = await getVar('minigames_last_round_firedAt');
  const intervalMinutes = userConfig.liveRoundIntervalMinutes ?? 30;
  if (lastFiredVar) {
    const lastFiredAt = new Date(lastFiredVar.value);
    const elapsedMs = Date.now() - lastFiredAt.getTime();
    if (elapsedMs < intervalMinutes * 60 * 1000) {
      return;
    }
  }

  // STEP 3: Check player count
  let count = 0;
  try {
    const playersRes = await takaro.gameserver.gameServerControllerGetPlayers(gameServerId, { filters: { online: [true] } });
    count = playersRes.data.data.length;
  } catch (e) {
    const playersRes = await takaro.gameserver.gameServerControllerGetPlayers(gameServerId);
    count = playersRes.data.meta.total;
  }
  const minPlayers = userConfig.minPlayersForLiveRound ?? 2;
  if (count < minPlayers) {
    return;
  }

  // STEP 4: Pick random enabled live game
  const gamesConfig = userConfig.games || {};
  const liveGames = ['trivia', 'scramble', 'mathrace', 'reactionrace'];
  const enabledLiveGames = liveGames.filter(g => gamesConfig[g] === true);
  if (enabledLiveGames.length === 0) {
    return;
  }
  const chosenGame = enabledLiveGames[Math.floor(Math.random() * enabledLiveGames.length)];

  const answerWindowSec = userConfig.liveRoundAnswerWindowSec ?? 60;
  const startedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + answerWindowSec * 1000).toISOString();

  let round = null;
  let announcement = '';

  // STEP 5: Generate round based on game
  if (chosenGame === 'trivia') {
    let questionData = null;

    if (userConfig.triviaQuestionSource === 'api' || !userConfig.triviaQuestionSource) {
      try {
        let url = 'https://opentdb.com/api.php?amount=1';
        const triviaCategory = userConfig.triviaApiCategory;
        if (triviaCategory && triviaCategory !== 'any') {
          const categoryId = OPENTDB_CATEGORIES[triviaCategory];
          if (categoryId) url += `&category=${categoryId}`;
        }
        const triviaDifficulty = userConfig.triviaApiDifficulty;
        if (triviaDifficulty && triviaDifficulty !== 'any') {
          url += `&difficulty=${triviaDifficulty}`;
        }
        const triviaType = userConfig.triviaApiType;
        if (triviaType && triviaType !== 'any') {
          url += `&type=${triviaType}`;
        }

        const resp = await takaro.axios.get(url);
        if (resp.data.response_code === 0 && resp.data.results && resp.data.results.length > 0) {
          const result = resp.data.results[0];
          const question = decodeHtmlEntities(result.question);
          const answer = decodeHtmlEntities(result.correct_answer);
          const incorrectAnswers = result.incorrect_answers.map(a => decodeHtmlEntities(a));
          questionData = { question, answer, type: result.type, incorrectAnswers };
        }
      } catch (e) {
        // Fall through to custom bank
      }
    }

    if (!questionData) {
      // Custom/fallback bank
      const triviaVar = await getVar('minigames_content_trivia');
      const bank = triviaVar ? triviaVar.value : { questions: [] };
      const questions = bank.questions || [];
      if (questions.length === 0) {
        // Skip with warn
        await takaro.gameserver.gameServerControllerSendMessage(gameServerId, { message: '⚠️ No trivia questions available. Skipping round.' });
        return;
      }
      const q = questions[Math.floor(Math.random() * questions.length)];
      if (q.options && Array.isArray(q.options) && q.answerIndex !== undefined) {
        // Shape: {question, options[4], answerIndex}
        questionData = {
          question: q.question,
          answer: q.options[q.answerIndex],
          type: 'multiple',
          incorrectAnswers: q.options.filter((_, i) => i !== q.answerIndex)
        };
      } else {
        // Shape: {question, answer, incorrectAnswers?}
        questionData = {
          question: q.question,
          answer: q.answer,
          type: q.incorrectAnswers ? 'multiple' : 'boolean',
          incorrectAnswers: q.incorrectAnswers || []
        };
      }
    }

    const displayedOptions = shuffle([questionData.answer, ...questionData.incorrectAnswers]);
    const optionsJoined = displayedOptions.join(', ');
    announcement = `❓ TRIVIA: ${questionData.question}? Options: ${optionsJoined} — /answer <choice> (${answerWindowSec}s)`;
    round = {
      game: 'trivia',
      prompt: questionData.question,
      answer: questionData.answer,
      answerType: 'text',
      displayedOptions,
      startedAt,
      expiresAt
    };

  } else if (chosenGame === 'scramble') {
    const wordlistVar = await getVar('minigames_content_wordlist');
    const wordlist = wordlistVar ? wordlistVar.value : { words: [] };
    const words = (wordlist.words || []).filter(w => w.length >= 4);
    if (words.length === 0) {
      await takaro.gameserver.gameServerControllerSendMessage(gameServerId, { message: '⚠️ No words available for scramble. Skipping round.' });
      return;
    }
    const original = words[Math.floor(Math.random() * words.length)];

    let scrambled = original;
    for (let attempt = 0; attempt < 5; attempt++) {
      scrambled = shuffle(original.split('')).join('');
      if (scrambled !== original) break;
    }

    announcement = `🔤 SCRAMBLE: ${scrambled} — /answer <word> (${answerWindowSec}s)`;
    round = {
      game: 'scramble',
      prompt: scrambled,
      answer: original,
      answerType: 'text',
      startedAt,
      expiresAt
    };

  } else if (chosenGame === 'mathrace') {
    const ops = ['+', '-', '×', '÷'];

    function randomInt(min, max) {
      return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    function generateSimple() {
      const op = ops[Math.floor(Math.random() * ops.length)];
      let a = randomInt(2, 30);
      let b = randomInt(2, 30);
      let result;
      if (op === '÷') {
        // ensure a is divisible by b
        b = randomInt(2, 10);
        a = b * randomInt(2, 10);
        result = a / b;
      } else if (op === '+') {
        result = a + b;
      } else if (op === '-') {
        result = a - b;
      } else {
        result = a * b;
      }
      return { expression: `${a} ${op} ${b}`, result };
    }

    function generateThreeOperand() {
      const op1 = ops[Math.floor(Math.random() * ops.length)];
      const op2 = ops[Math.floor(Math.random() * ops.length)];
      let a = randomInt(2, 30);
      let b = randomInt(2, 30);
      let c = randomInt(2, 30);

      // Evaluate left to right (no precedence)
      let intermediate;
      if (op1 === '÷') {
        b = randomInt(2, 10);
        a = b * randomInt(2, 10);
        intermediate = a / b;
      } else if (op1 === '+') {
        intermediate = a + b;
      } else if (op1 === '-') {
        intermediate = a - b;
      } else {
        intermediate = a * b;
      }

      let result;
      if (op2 === '÷') {
        c = randomInt(2, 10);
        const newIntermediate = Math.round(intermediate / c) * c;
        result = newIntermediate / c;
        return { expression: `${a} ${op1} ${b} ${op2} ${c}`, result };
      } else if (op2 === '+') {
        result = intermediate + c;
      } else if (op2 === '-') {
        result = intermediate - c;
      } else {
        result = intermediate * c;
      }
      return { expression: `${a} ${op1} ${b} ${op2} ${c}`, result };
    }

    let expression, mathResult;
    let attempts = 0;
    do {
      const useThree = Math.random() > 0.5;
      const generated = useThree ? generateThreeOperand() : generateSimple();
      expression = generated.expression;
      mathResult = generated.result;
      attempts++;
    } while ((mathResult < -500 || mathResult > 10000 || !Number.isFinite(mathResult)) && attempts < 10);

    announcement = `➗ MATH: ${expression} = ? — /answer <number> (${answerWindowSec}s)`;
    round = {
      game: 'mathrace',
      prompt: expression,
      answer: String(Math.round(mathResult * 100) / 100),
      answerType: 'number',
      startedAt,
      expiresAt
    };

  } else if (chosenGame === 'reactionrace') {
    const tokens = ['!first', '!go', '!grab', '!now', '!claim'];
    const token = tokens[Math.floor(Math.random() * tokens.length)];
    announcement = `⚡ REACTION: first to type ${token} wins! (${answerWindowSec}s)`;
    round = {
      game: 'reactionrace',
      prompt: token,
      answer: token,
      answerType: 'rawchat',
      startedAt,
      expiresAt
    };
  }

  if (!round) return;

  // STEP 6: Write active round
  await setVar('minigames_active_round', round);

  // STEP 7: Write last fired timestamp
  await setVar('minigames_last_round_firedAt', new Date().toISOString());

  // STEP 8: Announce server-wide
  await takaro.gameserver.gameServerControllerSendMessage(gameServerId, { message: announcement });
}

await main();
