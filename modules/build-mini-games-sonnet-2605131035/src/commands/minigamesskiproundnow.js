import { data, takaro, TakaroUserError, checkPermission } from '@takaro/helpers';

async function main() {
  const { pog, player, gameServerId, module: mod } = data;
  const userConfig = mod.userConfig;
  const moduleId = mod.moduleId;
  const playerId = player?.id;

  if (!checkPermission(pog, 'MINIGAMES_MANAGE')) throw new TakaroUserError('You need MINIGAMES_MANAGE permission.');

  async function varSearch(key) {
    const r = await takaro.variable.variableControllerSearch({
      filters: { key: [key], gameServerId: [gameServerId], moduleId: [moduleId] },
      page: { limit: 1 }
    });
    return r.data.data[0] || null;
  }
  async function varDelete(id) {
    return takaro.variable.variableControllerDelete(id);
  }

  const roundV = await varSearch('minigames_active_round');
  if (!roundV) {
    await pog.pm('No active round to skip.');
    return;
  }
  const round = JSON.parse(roundV.value);
  await varDelete(roundV.id);
  await takaro.gameserver.gameServerControllerSendMessage(gameServerId, {
    message: 'Round cancelled by admin. (' + round.game + ' - answer was: ' + round.answer + ')'
  });
  await pog.pm('Round skipped.');
}

await main();
