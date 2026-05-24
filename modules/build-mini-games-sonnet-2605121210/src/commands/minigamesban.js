import { data, takaro, TakaroUserError, checkPermission } from '@takaro/helpers';

async function main() {
  const { pog, player, gameServerId } = data;
  const moduleId = data.module.moduleId;

  if (!checkPermission(pog, 'MINIGAMES_MANAGE')) {
    throw new TakaroUserError('You do not have permission to use this command.');
  }

  const targetPlayerId = data.arguments.player;
  const hours = data.arguments.hours;

  async function readVar(key) {
    const res = await takaro.variable.variableControllerSearch({
      filters: { key: [key], gameServerId: [gameServerId], moduleId: [moduleId] },
      page: 0, limit: 1
    });
    return res.data.data.length > 0 ? { id: res.data.data[0].id, value: JSON.parse(res.data.data[0].value) } : null;
  }

  async function writeVar(key, value, existingId) {
    if (existingId) {
      await takaro.variable.variableControllerUpdate(existingId, { value: JSON.stringify(value) });
    } else {
      await takaro.variable.variableControllerCreate({ key, value: JSON.stringify(value), gameServerId, moduleId });
    }
  }

  const banKey = `minigames_ban:${targetPlayerId}`;
  const existing = await readVar(banKey);

  const banData = {};
  if (hours) {
    banData.expiresAt = new Date(Date.now() + hours * 3600000).toISOString();
    banData.permanent = false;
  } else {
    banData.permanent = true;
  }
  banData.bannedBy = player.id;
  banData.bannedAt = new Date().toISOString();

  await writeVar(banKey, banData, existing ? existing.id : null);

  let targetName = targetPlayerId;
  try {
    const targetPlayerInfo = await takaro.player.playerControllerGetOne(targetPlayerId);
    targetName = targetPlayerInfo.data.data.name || targetPlayerId;
  } catch (e) {
    // fall back to ID
  }

  await pog.pm(`✅ ${targetName} banned from mini-games${hours ? ` for ${hours} hours` : ' permanently'}.`);
}

await main();
