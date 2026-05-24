import { data, takaro, checkPermission, TakaroUserError } from '@takaro/helpers';

async function main() {
  const { pog, player, gameServerId, module: mod } = data;

  await checkPermission(pog, 'MINIGAMES_MANAGE');

  const moduleId = mod.id;
  const targetPlayer = data.arguments.player;
  const key = `minigames_ban:${targetPlayer}`;

  const r = await takaro.variable.variableControllerSearch({
    filters: { key: [key], moduleId: [moduleId], gameServerId: [gameServerId] },
    limit: 1,
  });

  if (!r.data.data.length) {
    throw new TakaroUserError(`No ban found for ${targetPlayer}.`);
  }

  await takaro.variable.variableControllerDelete(r.data.data[0].id);
  await pog.pm(`✅ ${targetPlayer} unbanned from mini-games.`);
}

await main();
