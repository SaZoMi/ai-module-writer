import { data, takaro, TakaroUserError, checkPermission } from '@takaro/helpers';

async function main() {
  const { pog, player, gameServerId, module: mod } = data;
  const moduleId = mod.id;
  const userConfig = mod.userConfig;

  if (!checkPermission(pog, 'MINIGAMES_MANAGE')) throw new TakaroUserError('No permission.');

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

  const activeRound = await getVar('minigames_active_round');
  if (activeRound) {
    throw new TakaroUserError('A round is already active. Skip it first with /minigamesskiproundnow.');
  }

  const validGames = ['trivia', 'scramble', 'mathrace', 'reactionrace'];
  let game = data.arguments.game;

  if (game) {
    game = game.toLowerCase();
    if (!validGames.includes(game)) {
      throw new TakaroUserError(`Invalid game. Choose from: ${validGames.join(', ')}`);
    }
  } else {
    game = validGames[Math.floor(Math.random() * validGames.length)];
  }

  const answerWindowSec = (userConfig.liveRoundAnswerWindowSec ?? 60);
  const expiresAt = new Date(Date.now() + answerWindowSec * 1000).toISOString();

  let roundData = { game, expiresAt };
  let announceMsg = '';

  if (game === 'mathrace') {
    const ops = ['+', '-', '×'];
    const op = ops[Math.floor(Math.random() * ops.length)];
    const a = Math.floor(Math.random() * 19) + 2;
    const b = Math.floor(Math.random() * 9) + 2;
    let result;
    if (op === '+') result = a + b;
    else if (op === '-') result = a - b;
    else result = a * b;
    const expression = `${a} ${op} ${b}`;
    roundData.answer = String(result);
    roundData.expression = expression;
    announceMsg = `🔢 Math Race! First to answer: ${expression} = ? Type the answer in chat!`;
  } else if (game === 'reactionrace') {
    const tokens = ['!first', '!go', '!grab', '!now', '!claim'];
    const token = tokens[Math.floor(Math.random() * tokens.length)];
    roundData.answer = token;
    announceMsg = `⚡ Reaction Race! First to type "${token}" wins!`;
  } else if (game === 'scramble') {
    const wordlistVar = await getVar('minigames_wordlist');
    let wordlist = ['takaro', 'survival', 'crafting', 'mining', 'server', 'player', 'game', 'build', 'explore', 'loot'];
    if (wordlistVar && Array.isArray(wordlistVar.value)) {
      wordlist = wordlistVar.value;
    }
    const word = wordlist[Math.floor(Math.random() * wordlist.length)];
    const scrambled = word.split('').sort(() => Math.random() - 0.5).join('');
    roundData.answer = word;
    roundData.scrambled = scrambled;
    announceMsg = `🔀 Word Scramble! Unscramble: "${scrambled}" — type the answer in chat!`;
  } else if (game === 'trivia') {
    const ops = ['+', '-', '×'];
    const op = ops[Math.floor(Math.random() * ops.length)];
    const a = Math.floor(Math.random() * 19) + 2;
    const b = Math.floor(Math.random() * 9) + 2;
    let result;
    if (op === '+') result = a + b;
    else if (op === '-') result = a - b;
    else result = a * b;
    const expression = `${a} ${op} ${b}`;
    roundData.answer = String(result);
    roundData.question = `What is ${expression}?`;
    announceMsg = `❓ Trivia! What is ${expression}? Type the answer in chat!`;
  }

  await setVar('minigames_active_round', roundData);
  await takaro.gameserver.gameServerControllerSendMessage(gameServerId, { message: announceMsg });
  await pog.pm(`✅ Fired a ${game} round! Answer window: ${answerWindowSec}s.`);
}

await main();
