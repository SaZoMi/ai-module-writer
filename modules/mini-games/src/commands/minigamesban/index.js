import { data, TakaroUserError, checkPermission } from '@takaro/helpers';
import { setVariable, findPlayerByGameId } from './mini-games-helpers.js';

async function main() {
  const { pog, gameServerId, arguments: args, module: mod } = data;

  if (!checkPermission(pog, 'MINIGAMES_MANAGE')) {
    throw new TakaroUserError('You do not have permission to manage mini-games.');
  }

  const moduleId = mod.moduleId;

  if (!args.player) {
    throw new TakaroUserError('Usage: /minigamesban <gameId> [hours]');
  }

  const target = await findPlayerByGameId(gameServerId, args.player);
  if (!target) {
    throw new TakaroUserError(`Player with gameId "${args.player}" not found.`);
  }

  const banData = {};
  let description = 'permanently';

  // hours defaultValue is "0" — treat 0 as "permanent" (no expiry)
  const hoursNum = Number(args.hours ?? 0);
  if (hoursNum > 0) {
    if (!isFinite(hoursNum)) {
      throw new TakaroUserError('Hours must be a positive number.');
    }
    const expiresAt = new Date(Date.now() + hoursNum * 3600 * 1000).toISOString();
    banData.expiresAt = expiresAt;
    description = `for ${hoursNum}h (until ${new Date(expiresAt).toUTCString()})`;
  }

  await setVariable(gameServerId, moduleId, `minigames_ban:${target.id}`, banData);
  await pog.pm(`🔨 ${target.name} has been banned from mini-games ${description}.`);
}

await main();
