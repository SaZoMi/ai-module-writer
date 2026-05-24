import { data, takaro, TakaroUserError, checkPermission } from '@takaro/helpers';

async function main() {
  const { pog, player, gameServerId, module: mod } = data;
  const userConfig = mod.userConfig;
  const moduleId = mod.moduleId;
  const playerId = player?.id;

  if (!checkPermission(pog, 'MINIGAMES_MANAGE')) throw new TakaroUserError('You need MINIGAMES_MANAGE permission.');

  const targetName = data.arguments.player;

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

  const pr = await takaro.player.playerControllerSearch({ filters: { name: [targetName] }, page: { limit: 1 } });
  if (!pr.data.data?.length) throw new TakaroUserError('Player "' + targetName + '" not found.');
  const targetId = pr.data.data[0].id;

  const statsV = await varSearch('minigames_stats:' + targetId);
  if (statsV) {
    await varDelete(statsV.id);
    await pog.pm('Reset stats for ' + targetName + '.');
  } else {
    await pog.pm(targetName + ' has no stats to reset.');
  }
}

await main();
