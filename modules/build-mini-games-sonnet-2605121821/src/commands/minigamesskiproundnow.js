import { data, takaro, TakaroUserError, checkPermission } from '@takaro/helpers';

async function main() {
  const { pog, player, gameServerId, module: mod } = data;

  if (!checkPermission(pog, 'MINIGAMES_MANAGE')) throw new TakaroUserError('No permission.');

  async function getVar(key) {
    const res = await takaro.variable.variableControllerSearch({
      filters: { key: [key], gameServerId: [gameServerId] }
    });
    if (res.data.data.length === 0) return null;
    return { id: res.data.data[0].id, value: JSON.parse(res.data.data[0].value) };
  }

  async function deleteVar(key) {
    const existing = await getVar(key);
    if (existing) await takaro.variable.variableControllerDelete(existing.id);
  }

  const activeRound = await getVar('minigames_active_round');
  if (!activeRound) {
    await pog.pm('No active round.');
    return;
  }

  await deleteVar('minigames_active_round');
  await takaro.gameserver.gameServerControllerSendMessage(gameServerId, { message: '⏭️ Active round cancelled by admin.' });
  await pog.pm('✅ Round cancelled.');
}

await main();
