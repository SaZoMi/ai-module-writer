import { data, takaro, TakaroUserError, checkPermission } from '@takaro/helpers';

async function main() {
  const { pog, gameServerId } = data;
  const moduleId = data.module.moduleId;
  const cfg = data.module.userConfig;

  if (!checkPermission(pog, 'MINIGAMES_MANAGE')) {
    throw new TakaroUserError('You do not have permission to use this command.');
  }

  const validGames = ['trivia', 'scramble', 'mathrace', 'reactionrace'];
  let requestedGame = data.arguments.game;

  if (requestedGame && !validGames.includes(requestedGame.toLowerCase())) {
    throw new TakaroUserError(`Invalid game. Choose one of: ${validGames.join(', ')}`);
  }

  if (requestedGame) {
    requestedGame = requestedGame.toLowerCase();
  }

  async function readVar(key) {
    const res = await takaro.variable.variableControllerSearch({
      filters: { key: [key], gameServerId: [gameServerId], moduleId: [moduleId] },
      page: 0, limit: 1
    });
    return res.data.data.length > 0 ? { id: res.data.data[0].id, value: JSON.parse(res.data.data[0].value) } : null;
  }

  async function writeVar(key, value, existingId) {
    if (existingId) {
      await takaro.variable.variableControllerUpdate(existingId, { value: JSON.stringify(value) });
    } else {
      await takaro.variable.variableControllerCreate({ key, value: JSON.stringify(value), gameServerId, moduleId });
    }
  }

  // Determine which game to play
  let pickedGame = requestedGame;
  if (!pickedGame) {
    const enabledGames = cfg.enabledLiveGames || validGames;
    pickedGame = enabledGames[Math.floor(Math.random() * enabledGames.length)];
  }

  const now = Date.now();
  const windowSec = cfg.liveRoundAnswerWindowSec || 60;
  let questionText = '';
  let correctAnswer = '';
  let answerType = 'text';
  let announcement = '';

  if (pickedGame === 'scramble') {
    // Read wordlist or use defaults
    const wordlistVar = await readVar('minigames_content_scramble');
    let words = ['planet', 'rocket', 'jungle', 'dragon', 'castle', 'bridge', 'silver', 'forest'];
    if (wordlistVar && Array.isArray(wordlistVar.value)) {
      const longWords = wordlistVar.value.filter(w => w.length >= 4);
      if (longWords.length > 0) words = longWords;
    }
    const word = words[Math.floor(Math.random() * words.length)];
    correctAnswer = word;
    const shuffled = word.split('').sort(() => Math.random() - 0.5).join('');
    questionText = `Unscramble this word: ${shuffled}`;
    announcement = `🔤 SCRAMBLE! Unscramble: ${shuffled}`;

  } else if (pickedGame === 'mathrace') {
    const ops = ['+', '-', '*'];
    let a, b, result, op;
    let attempts = 0;
    do {
      op = ops[Math.floor(Math.random() * ops.length)];
      a = Math.floor(Math.random() * 20) + 1;
      b = Math.floor(Math.random() * 20) + 1;
      if (op === '+') result = a + b;
      else if (op === '-') result = a - b;
      else result = a * b;
      attempts++;
    } while ((result < 1 || result > 500) && attempts < 20);

    if (result < 1 || result > 500) {
      a = 5; b = 3; op = '+'; result = 8;
    }

    questionText = `Solve: ${a} ${op} ${b}`;
    correctAnswer = String(result);
    answerType = 'number';
    announcement = `🔢 MATH RACE! First to answer: ${a} ${op} ${b}`;

  } else if (pickedGame === 'reactionrace') {
    const tokens = ['!first', '!go', '!grab', '!now', '!claim'];
    const token = tokens[Math.floor(Math.random() * tokens.length)];
    correctAnswer = token;
    questionText = `Type ${token} first!`;
    announcement = `⚡ REACTION RACE! Type: ${token}`;

  } else {
    // trivia
    const triviaVar = await readVar('minigames_content_trivia');
    let question = null;
    if (triviaVar && Array.isArray(triviaVar.value) && triviaVar.value.length > 0) {
      question = triviaVar.value[Math.floor(Math.random() * triviaVar.value.length)];
    }
    if (question && question.q && question.a) {
      questionText = question.q;
      correctAnswer = question.a;
    } else {
      questionText = 'What is the capital of France?';
      correctAnswer = 'Paris';
    }
    announcement = `❓ TRIVIA! ${questionText}`;
  }

  const round = {
    game: pickedGame,
    prompt: questionText,
    answer: correctAnswer,
    answerType,
    displayedOptions: [],
    startedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + windowSec * 1000).toISOString()
  };

  const existingRound = await readVar('minigames_active_round');
  await writeVar('minigames_active_round', round, existingRound ? existingRound.id : null);

  const existingFiredAt = await readVar('minigames_last_round_firedAt');
  await writeVar('minigames_last_round_firedAt', { firedAt: new Date(now).toISOString() }, existingFiredAt ? existingFiredAt.id : null);

  await takaro.gameserver.gameServerControllerSendMessage(gameServerId, {
    message: `${announcement} — You have ${windowSec} seconds!`
  });

  await pog.pm('✅ Live round fired!');
}

await main();
