import { data, takaro, checkPermission, TakaroUserError } from '@takaro/helpers';

async function main() {
  const { pog, player, gameServerId, module: mod } = data;

  await checkPermission(pog, 'MINIGAMES_MANAGE');

  const moduleId = mod.id;
  const targetPlayer = data.arguments.player;
  const hours = data.arguments.hours;

  const banValue = {
    expiresAt: hours ? new Date(Date.now() + hours * 3600000).toISOString() : null,
    bannedBy: player.id,
    bannedAt: new Date().toISOString(),
  };

  const key = `minigames_ban:${targetPlayer}`;

  const existing = await takaro.variable.variableControllerSearch({
    filters: { key: [key], moduleId: [moduleId], gameServerId: [gameServerId] },
    limit: 1,
  });

  if (existing.data.data.length) {
    await takaro.variable.variableControllerUpdate(existing.data.data[0].id, {
      value: JSON.stringify(banValue),
    });
  } else {
    await takaro.variable.variableControllerCreate({
      key,
      value: JSON.stringify(banValue),
      moduleId,
      gameServerId,
    });
  }

  const durationMsg = hours ? ` (expires in ${hours}h)` : ' (permanent)';
  await pog.pm(`✅ ${targetPlayer} banned from mini-games.${durationMsg}`);
}

await main();
