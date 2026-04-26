import { data, TakaroUserError, checkPermission } from '@takaro/helpers';
import { deleteVariable, findPlayerByGameId } from './mini-games-helpers.js';

async function main() {
  const { pog, gameServerId, arguments: args, module: mod } = data;

  if (!checkPermission(pog, 'MINIGAMES_MANAGE')) {
    throw new TakaroUserError('You do not have permission to manage mini-games.');
  }

  const moduleId = mod.moduleId;

  if (!args.player) {
    throw new TakaroUserError('Usage: /minigamesunban <gameId>');
  }

  const target = await findPlayerByGameId(gameServerId, args.player);
  if (!target) {
    throw new TakaroUserError(`Player with gameId "${args.player}" not found.`);
  }

  await deleteVariable(gameServerId, moduleId, `minigames_ban:${target.id}`);
  await pog.pm(`✅ ${target.name} has been unbanned from mini-games.`);
}

await main();
