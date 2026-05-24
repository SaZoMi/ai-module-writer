import { data, takaro } from '@takaro/helpers';

async function main() {
  const { gameServerId, module: mod } = data;
  const userConfig = mod.userConfig;
  const moduleId = mod.moduleId;

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

  const now = new Date();

  const intervalMin = userConfig.liveRoundIntervalMinutes || 30;
  const lastFireV = await varSearch('minigames_last_round_firedAt');
  if (lastFireV) {
    const lastFire = new Date(JSON.parse(lastFireV.value));
    const elapsedMin = (now - lastFire) / 60000;
    if (elapsedMin < intervalMin) return;
  }

  const activeRoundV = await varSearch('minigames_active_round');
  if (activeRoundV) {
    const active = JSON.parse(activeRoundV.value);
    if (new Date(active.expiresAt) > now) return;
  }

  let playerCount = 0;
  try {
    const playersR = await takaro.playerOnGameserver.playerOnGameServerControllerSearch({
      filters: { gameServerId: [gameServerId], online: [true] },
      page: { limit: 100 }
    });
    playerCount = playersR.data.data?.length || 0;
  } catch (e) {
    playerCount = 0;
  }

  const minPlayers = userConfig.minPlayersForLiveRound || 2;
  if (playerCount < minPlayers) return;

  const liveGames = ['trivia', 'scramble', 'mathrace', 'reactionrace'].filter(g => {
    if (g === 'trivia') return userConfig.enableTrivia !== false;
    if (g === 'scramble') return userConfig.enableScramble !== false;
    if (g === 'mathrace') return userConfig.enableMathRace !== false;
    if (g === 'reactionrace') return userConfig.enableReactionRace !== false;
    return true;
  });
  if (liveGames.length === 0) return;

  const chosenGame = liveGames[Math.floor(Math.random() * liveGames.length)];
  const answerWindowSec = userConfig.liveRoundAnswerWindowSec || 60;
  const expiresAt = new Date(Date.now() + answerWindowSec * 1000).toISOString();
  const round = { game: chosenGame, startedAt: now.toISOString(), expiresAt };

  function decodeHtmlEntities(s) {
    if (!s) return s;
    return s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;/g, "'")
            .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
  }

  function shuffleArray(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  async function saveRound(r) {
    const existing = await varSearch('minigames_active_round');
    if (existing) await varUpdate(existing.id, r);
    else await varCreate('minigames_active_round', r);
  }

  if (chosenGame === 'trivia') {
    let question = null;
    const source = userConfig.triviaQuestionSource || 'api';

    if (source === 'api') {
      try {
        let url = 'https://opentdb.com/api.php?amount=1';
        const diff = userConfig.triviaApiDifficulty || 'any';
        if (diff !== 'any') url += '&difficulty=' + diff;
        const type = userConfig.triviaApiType || 'any';
        if (type !== 'any') url += '&type=' + type;

        const resp = await takaro.axios.get(url);
        if (resp.data.response_code === 0 && resp.data.results?.length > 0) {
          const q = resp.data.results[0];
          const correct = decodeHtmlEntities(q.correct_answer);
          const incorrects = q.incorrect_answers.map(a => decodeHtmlEntities(a));
          question = {
            prompt: decodeHtmlEntities(q.question),
            answer: correct,
            displayedOptions: shuffleArray([correct, ...incorrects])
          };
        }
      } catch (e) {
        question = null;
      }
    }

    if (!question) {
      const triviaV = await varSearch('minigames_content_trivia');
      if (triviaV) {
        const bank = JSON.parse(triviaV.value);
        const qs = bank.questions || [];
        if (qs.length > 0) {
          const q = qs[Math.floor(Math.random() * qs.length)];
          if (q.options && typeof q.answerIndex === 'number') {
            const correct = q.options[q.answerIndex];
            const incorrects = q.options.filter((_, i) => i !== q.answerIndex);
            question = { prompt: q.question, answer: correct, displayedOptions: shuffleArray([correct, ...incorrects]) };
          } else if (q.answer) {
            const incorrects = q.incorrectAnswers || [];
            question = { prompt: q.question, answer: q.answer, displayedOptions: incorrects.length > 0 ? shuffleArray([q.answer, ...incorrects]) : null };
          }
        }
      }
    }

    if (!question) {
      const lrV = await varSearch('minigames_last_round_firedAt');
      if (lrV) await varUpdate(lrV.id, now.toISOString());
      else await varCreate('minigames_last_round_firedAt', now.toISOString());
      return;
    }

    round.prompt = question.prompt;
    round.answer = question.answer;
    round.answerType = 'text';
    round.displayedOptions = question.displayedOptions;
    await saveRound(round);

    let ann = 'TRIVIA: ' + question.prompt;
    if (question.displayedOptions) ann += ' | Options: ' + question.displayedOptions.join(', ');
    ann += ' -- /answer <choice> (' + answerWindowSec + 's)';
    await broadcast(ann);

  } else if (chosenGame === 'scramble') {
    const wordlistV = await varSearch('minigames_content_wordlist');
    if (!wordlistV) return;
    const bank = JSON.parse(wordlistV.value);
    const words = (bank.words || []).filter(w => w.length >= 4);
    if (words.length === 0) return;

    const word = words[Math.floor(Math.random() * words.length)].toLowerCase();
    let scrambled = word;
    for (let attempt = 0; attempt < 5; attempt++) {
      const arr = word.split('');
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      scrambled = arr.join('');
      if (scrambled !== word) break;
    }

    round.prompt = scrambled.toUpperCase();
    round.answer = word;
    round.answerType = 'text';
    await saveRound(round);
    await broadcast('SCRAMBLE: ' + round.prompt + ' -- /answer <word> (' + answerWindowSec + 's)');

  } else if (chosenGame === 'mathrace') {
    function generateMath() {
      const ops = ['+', '-', '*', '/'];
      const op = ops[Math.floor(Math.random() * ops.length)];
      let a = Math.floor(Math.random() * 29) + 2;
      let b = Math.floor(Math.random() * 29) + 2;
      let expr, ans;
      if (op === '/') {
        const quotient = Math.floor(Math.random() * 20) + 1;
        a = b * quotient;
        expr = a + ' / ' + b;
        ans = quotient;
      } else if (op === '*') {
        expr = a + ' * ' + b;
        ans = a * b;
      } else if (op === '+') {
        expr = a + ' + ' + b;
        ans = a + b;
      } else {
        if (a < b) { const tmp = a; a = b; b = tmp; }
        expr = a + ' - ' + b;
        ans = a - b;
      }
      if (ans < -500 || ans > 10000) return generateMath();
      return { expr, ans };
    }
    const { expr, ans } = generateMath();
    round.prompt = expr;
    round.answer = ans;
    round.answerType = 'number';
    await saveRound(round);
    await broadcast('MATH: ' + expr + ' = ? -- /answer <number> (' + answerWindowSec + 's)');

  } else if (chosenGame === 'reactionrace') {
    const tokens = ['!first', '!go', '!grab', '!now', '!claim'];
    const token = tokens[Math.floor(Math.random() * tokens.length)];
    round.prompt = token;
    round.answer = token;
    round.answerType = 'rawchat';
    await saveRound(round);
    await broadcast('REACTION: first to type ' + token + ' in chat wins! (' + answerWindowSec + 's)');
  }

  const lrV2 = await varSearch('minigames_last_round_firedAt');
  if (lrV2) await varUpdate(lrV2.id, now.toISOString());
  else await varCreate('minigames_last_round_firedAt', now.toISOString());
}

await main();
