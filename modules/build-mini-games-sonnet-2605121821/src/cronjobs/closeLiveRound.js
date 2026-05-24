import { data, takaro, TakaroUserError, checkPermission } from '@takaro/helpers';

async function main() {
  const { gameServerId, module: mod } = data;
  const moduleId = mod.id;
  const userConfig = mod.userConfig;

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

  // STEP 1: Read active round
  const activeRoundVar = await getVar('minigames_active_round');
  if (!activeRoundVar) {
    return;
  }

  const round = activeRoundVar.value;

  // STEP 2: Check if expired
  const expiresAt = new Date(round.expiresAt);
  if (expiresAt > new Date()) {
    // Not expired yet
    return;
  }

  // STEP 3: Announce time's up with answer
  const emojiMap = {
    trivia: '❓',
    scramble: '🔤',
    mathrace: '➗',
    reactionrace: '⚡'
  };
  const emoji = emojiMap[round.game] || '🎮';
  const message = `${emoji} Time's up! Nobody got it. The answer was: ${round.answer}.`;
  await takaro.gameserver.gameServerControllerSendMessage(gameServerId, { message });

  // STEP 4: Delete active round variable
  await deleteVar('minigames_active_round');
}

await main();
