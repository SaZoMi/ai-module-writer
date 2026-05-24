import { data, takaro, TakaroUserError, checkPermission } from '@takaro/helpers';

async function main() {
  const { pog, gameServerId, module: mod } = data;
  const userConfig = mod.userConfig;
  const moduleId = mod.moduleId;

  if (!checkPermission(pog, 'MINIGAMES_MANAGE')) throw new TakaroUserError('You need MINIGAMES_MANAGE permission.');

  const forcedGame = data.arguments.game?.toLowerCase();
  const validLiveGames = ['trivia', 'scramble', 'mathrace', 'reactionrace'];
  if (forcedGame && !validLiveGames.includes(forcedGame)) {
    throw new TakaroUserError('Valid live games: trivia, scramble, mathrace, reactionrace');
  }

  let enabledGames = validLiveGames.filter(g => {
    if (g === 'trivia') return userConfig.enableTrivia !== false;
    if (g === 'scramble') return userConfig.enableScramble !== false;
    if (g === 'mathrace') return userConfig.enableMathRace !== false;
    if (g === 'reactionrace') return userConfig.enableReactionRace !== false;
    return true;
  });
  if (forcedGame) enabledGames = [forcedGame];
  if (enabledGames.length === 0) throw new TakaroUserError('No live games are enabled.');

  const chosenGame = enabledGames[Math.floor(Math.random() * enabledGames.length)];
  const answerWindowSec = userConfig.liveRoundAnswerWindowSec || 60;
  const expiresAt = new Date(Date.now() + answerWindowSec * 1000).toISOString();
  const round = { game: chosenGame, startedAt: new Date().toISOString(), expiresAt };

  async function varSearch(key) {
    const r = await takaro.variable.variableControllerSearch({
      filters: { key: [key], gameServerId: [gameServerId], moduleId: [moduleId] },
      page: { limit: 1 }
    });
    return r.data.data[0] || null;
  }
  async function varCreate(key, val) {
    return takaro.variable.variableControllerCreate({ key, value: JSON.stringify(val), gameServerId, moduleId });
  }
  async function varUpdate(id, val) {
    return takaro.variable.variableControllerUpdate(id, { value: JSON.stringify(val) });
  }
  async function broadcast(msg) {
    await takaro.gameserver.gameServerControllerSendMessage(gameServerId, { message: msg });
  }
  async function saveRound(r) {
    const existing = await varSearch('minigames_active_round');
    if (existing) await varUpdate(existing.id, r);
    else await varCreate('minigames_active_round', r);
  }

  function decodeHtmlEntities(s) {
    if (!s) return s;
    return s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;/g, "'")
            .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
  }
  function shuffleArray(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
    return a;
  }

  if (chosenGame === 'trivia') {
    let question = null;
    try {
      const resp = await takaro.axios.get('https://opentdb.com/api.php?amount=1');
      if (resp.data.response_code === 0 && resp.data.results?.length > 0) {
        const q = resp.data.results[0];
        const correct = decodeHtmlEntities(q.correct_answer);
        const incorrects = q.incorrect_answers.map(a => decodeHtmlEntities(a));
        question = { prompt: decodeHtmlEntities(q.question), answer: correct, displayedOptions: shuffleArray([correct, ...incorrects]) };
      }
    } catch (e) { question = null; }

    if (!question) {
      const triviaV = await varSearch('minigames_content_trivia');
      if (triviaV) {
        const bank = JSON.parse(triviaV.value);
        const qs = bank.questions || [];
        if (qs.length > 0) {
          const q = qs[Math.floor(Math.random() * qs.length)];
          if (q.options && typeof q.answerIndex === 'number') {
            question = { prompt: q.question, answer: q.options[q.answerIndex], displayedOptions: shuffleArray(q.options) };
          } else if (q.answer) {
            question = { prompt: q.question, answer: q.answer, displayedOptions: null };
          }
        }
      }
    }
    if (!question) throw new TakaroUserError('No trivia content available.');

    round.prompt = question.prompt;
    round.answer = question.answer;
    round.answerType = 'text';
    round.displayedOptions = question.displayedOptions;
    await saveRound(round);

    let ann = 'TRIVIA: ' + question.prompt;
    if (question.displayedOptions) ann += ' | Options: ' + question.displayedOptions.join(', ');
    ann += ' - /answer <choice> (' + answerWindowSec + 's)';
    await broadcast(ann);

  } else if (chosenGame === 'scramble') {
    const wordlistV = await varSearch('minigames_content_wordlist');
    if (!wordlistV) throw new TakaroUserError('No wordlist configured (minigames_content_wordlist).');
    const bank = JSON.parse(wordlistV.value);
    const words = (bank.words || []).filter(w => w.length >= 4);
    if (!words.length) throw new TakaroUserError('Wordlist is empty.');

    const word = words[Math.floor(Math.random() * words.length)].toLowerCase();
    let scrambled = word;
    for (let i = 0; i < 5; i++) {
      const arr = word.split('');
      for (let j = arr.length - 1; j > 0; j--) { const k = Math.floor(Math.random()*(j+1)); [arr[j],arr[k]]=[arr[k],arr[j]]; }
      scrambled = arr.join('');
      if (scrambled !== word) break;
    }
    round.prompt = scrambled.toUpperCase();
    round.answer = word;
    round.answerType = 'text';
    await saveRound(round);
    await broadcast('SCRAMBLE: ' + round.prompt + ' - /answer <word> (' + answerWindowSec + 's)');

  } else if (chosenGame === 'mathrace') {
    function genMath() {
      const ops = ['+', '-', '*', '/'];
      const op = ops[Math.floor(Math.random() * ops.length)];
      let a = Math.floor(Math.random() * 29) + 2, b = Math.floor(Math.random() * 29) + 2;
      let expr, ans;
      if (op === '/') { const q = Math.floor(Math.random()*20)+1; a = b*q; expr = a+' / '+b; ans = q; }
      else if (op === '*') { expr = a+' * '+b; ans = a*b; }
      else if (op === '+') { expr = a+' + '+b; ans = a+b; }
      else { if (a<b) { const tmp=a; a=b; b=tmp; } expr = a+' - '+b; ans = a-b; }
      if (ans < -500 || ans > 10000) return genMath();
      return { expr, ans };
    }
    const { expr, ans } = genMath();
    round.prompt = expr;
    round.answer = ans;
    round.answerType = 'number';
    await saveRound(round);
    await broadcast('MATH: ' + expr + ' = ? - /answer <number> (' + answerWindowSec + 's)');

  } else if (chosenGame === 'reactionrace') {
    const tokens = ['!first', '!go', '!grab', '!now', '!claim'];
    const token = tokens[Math.floor(Math.random() * tokens.length)];
    round.prompt = token;
    round.answer = token;
    round.answerType = 'rawchat';
    await saveRound(round);
    await broadcast('REACTION: first to type ' + token + ' in chat wins! (' + answerWindowSec + 's)');
  }

  const lrV = await varSearch('minigames_last_round_firedAt');
  if (lrV) await varUpdate(lrV.id, new Date().toISOString());
  else await varCreate('minigames_last_round_firedAt', new Date().toISOString());

  await pog.pm('Live round fired: ' + chosenGame);
}

await main();
