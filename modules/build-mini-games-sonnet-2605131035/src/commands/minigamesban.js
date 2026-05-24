import { data, takaro, TakaroUserError, checkPermission } from '@takaro/helpers';

async function main() {
  const { pog, player, gameServerId, module: mod } = data;
  const userConfig = mod.userConfig;
  const moduleId = mod.moduleId;
  const playerId = player?.id;

  if (!checkPermission(pog, 'MINIGAMES_MANAGE')) throw new TakaroUserError('You need MINIGAMES_MANAGE permission.');

  const targetName = data.arguments.player;
  const hours = data.arguments.hours;

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

  // Find target player
  const pr = await takaro.player.playerControllerSearch({ filters: { name: [targetName] }, page: { limit: 1 } });
  if (!pr.data.data?.length) throw new TakaroUserError('Player "' + targetName + '" not found.');
  const targetId = pr.data.data[0].id;

  const banData = {};
  if (hours && hours > 0) {
    banData.expiresAt = new Date(Date.now() + hours * 3600000).toISOString();
  }

  const banKey = 'minigames_ban:' + targetId;
  const existing = await varSearch(banKey);
  if (existing) await varUpdate(existing.id, banData);
  else await varCreate(banKey, banData);

  const expMsg = banData.expiresAt ? ' for ' + hours + ' hour(s)' : ' permanently';
  await pog.pm('Banned ' + targetName + expMsg + '.');
}

await main();
