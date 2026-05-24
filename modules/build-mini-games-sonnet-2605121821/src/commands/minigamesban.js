import { data, takaro, TakaroUserError, checkPermission } from '@takaro/helpers';

async function main() {
  const { pog, player, gameServerId, module: mod } = data;
  const moduleId = mod.id;

  if (!checkPermission(pog, 'MINIGAMES_MANAGE')) throw new TakaroUserError('No permission.');

  const targetPlayer = data.arguments.player;
  const targetPlayerId = targetPlayer.playerId;
  const hours = data.arguments.hours;

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

  const banObj = hours
    ? { expiresAt: new Date(Date.now() + hours * 3600000).toISOString() }
    : {};

  await setVar(`minigames_ban:${targetPlayerId}`, banObj);

  const durationStr = hours ? `for ${hours}h` : 'permanently';
  await pog.pm(`🔨 ${targetPlayerId} banned from mini-games ${durationStr}.`);
}

await main();
