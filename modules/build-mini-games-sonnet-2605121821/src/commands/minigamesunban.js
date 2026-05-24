import { data, takaro, TakaroUserError, checkPermission } from '@takaro/helpers';

async function main() {
  const { pog, player, gameServerId, module: mod } = data;

  if (!checkPermission(pog, 'MINIGAMES_MANAGE')) throw new TakaroUserError('No permission.');

  const targetPlayer = data.arguments.player;
  const targetPlayerId = targetPlayer.playerId;

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

  await deleteVar(`minigames_ban:${targetPlayerId}`);
  await pog.pm(`✅ ${targetPlayerId} unbanned from mini-games.`);
}

await main();
