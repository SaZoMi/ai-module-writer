import { data, takaro, checkPermission, TakaroUserError } from '@takaro/helpers';

async function main() {
  const { pog, player, gameServerId, module: mod } = data;

  await checkPermission(pog, 'MINIGAMES_MANAGE');

  const moduleId = mod.id;

  const r = await takaro.variable.variableControllerSearch({
    filters: { key: ['minigames_active_round'], moduleId: [moduleId], gameServerId: [gameServerId] },
    limit: 1,
  });

  if (!r.data.data.length) {
    throw new TakaroUserError('No active round to skip.');
  }

  await takaro.variable.variableControllerDelete(r.data.data[0].id);

  await takaro.gameserver.gameServerControllerSendMessage(gameServerId, {
    message: '⏭️ The active round was cancelled by an admin.',
  });

  await pog.pm('✅ Round cancelled.');
}

await main();
