import { data, takaro, checkPermission, TakaroUserError } from '@takaro/helpers';

async function main() {
  const { pog, player, gameServerId, module: mod } = data;

  await checkPermission(pog, 'MINIGAMES_MANAGE');

  const moduleId = mod.id;

  async function readVar(key) {
    const r = await takaro.variable.variableControllerSearch({
      filters: { key: [key], moduleId: [moduleId], gameServerId: [gameServerId] },
      limit: 1,
    });
    return r.data.data.length > 0 ? r.data.data[0] : null;
  }

  async function writeVar(key, value) {
    const existing = await readVar(key);
    if (existing) {
      await takaro.variable.variableControllerUpdate(existing.id, { value: JSON.stringify(value) });
    } else {
      await takaro.variable.variableControllerCreate({ key, value: JSON.stringify(value), moduleId, gameServerId });
    }
  }

  const liveGames = ['trivia', 'scramble', 'mathrace', 'reactionrace'];
  let game = data.arguments.game;

  if (game) {
    if (!liveGames.includes(game.toLowerCase())) {
      throw new TakaroUserError(`Invalid game. Must be one of: ${liveGames.join(', ')}`);
    }
    game = game.toLowerCase();
  } else {
    const enabledGames = (mod.userConfig && mod.userConfig.games)
      ? mod.userConfig.games.filter(g => liveGames.includes(g))
      : liveGames;
    if (!enabledGames.length) {
      throw new TakaroUserError('No live games are enabled.');
    }
    game = enabledGames[Math.floor(Math.random() * enabledGames.length)];
  }

  const now = new Date();
  const answerWindowSec = (mod.userConfig && mod.userConfig.liveRoundAnswerWindowSec) || 60;
  const expiresAt = new Date(now.getTime() + answerWindowSec * 1000).toISOString();

  let prompt, answer, answerType;

  if (game === 'scramble') {
    const wordlistVar = await readVar('minigames_content_wordlist');
    if (!wordlistVar) {
      throw new TakaroUserError('No word list configured. Set minigames_content_wordlist variable first.');
    }
    const wordlist = JSON.parse(wordlistVar.value);
    const longWords = wordlist.filter(w => w.length >= 4);
    if (!longWords.length) {
      throw new TakaroUserError('Word list has no words with 4+ characters.');
    }
    const word = longWords[Math.floor(Math.random() * longWords.length)];
    const shuffled = word.split('').sort(() => Math.random() - 0.5).join('');
    prompt = `🔤 SCRAMBLE! Unscramble this word: ${shuffled.toUpperCase()} — use /answer <word>`;
    answer = word.toLowerCase();
    answerType = 'text';
  } else if (game === 'mathrace') {
    const a = Math.floor(Math.random() * 29) + 2;
    const b = Math.floor(Math.random() * 29) + 2;
    const ops = ['+', '-', '*'];
    let op = ops[Math.floor(Math.random() * ops.length)];
    let result;
    if (op === '+') result = a + b;
    else if (op === '-') result = a - b;
    else result = a * b;
    prompt = `➗ MATH RACE! Solve: ${a} ${op} ${b} = ? — use /answer <number>`;
    answer = String(result);
    answerType = 'number';
  } else if (game === 'reactionrace') {
    const tokens = ['!first', '!go', '!grab', '!now', '!claim'];
    const token = tokens[Math.floor(Math.random() * tokens.length)];
    prompt = `⚡ REACTION RACE! Type in chat: ${token}`;
    answer = token;
    answerType = 'reaction';
  } else if (game === 'trivia') {
    const triviaVar = await readVar('minigames_content_trivia');
    let triviaList;
    if (triviaVar) {
      triviaList = JSON.parse(triviaVar.value);
    } else {
      triviaList = [{ question: 'What is 2+2?', answer: '4', type: 'text' }];
    }
    const item = triviaList[Math.floor(Math.random() * triviaList.length)];
    prompt = `❓ TRIVIA! ${item.question} — use /answer <choice>`;
    answer = item.answer;
    answerType = item.type || 'text';
  }

  const roundObj = {
    game,
    prompt,
    answer,
    answerType,
    startedAt: now.toISOString(),
    expiresAt,
  };

  await writeVar('minigames_active_round', roundObj);

  await takaro.gameserver.gameServerControllerSendMessage(gameServerId, {
    message: prompt,
  });

  await pog.pm(`✅ Round fired: ${game}`);
}

await main();
