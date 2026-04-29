import { data, TakaroUserError, checkPermission } from '@takaro/helpers';
import {
  getCommandTargetPlayer,
  grantBuffToPlayer,
  normalizeBuffName,
} from './playtime-buff-helpers.js';

async function main() {
  const { gameServerId, pog, arguments: args, module: mod } = data;

  if (!checkPermission(pog, 'PLAYTIME_BUFF_ADMIN')) {
    throw new TakaroUserError('You do not have permission to grant playtime buffs.');
  }

  const target = getCommandTargetPlayer(args.player);
  if (!target) {
    throw new TakaroUserError('Usage: grantbuff <player> <buffName> - please choose a valid player.');
  }

  const buffName = normalizeBuffName(args.buffName);
  if (!buffName) {
    throw new TakaroUserError('Usage: grantbuff <player> <buffName> - buffName is required.');
  }

  try {
    const command = await grantBuffToPlayer(gameServerId, mod.userConfig || {}, target, buffName);
    await pog.pm(`Granted buff ${buffName} to ${target.name}.`);
    console.log(`playtime-buff-rewards: admin grant completed with command "${command}"`);
  } catch (err) {
    console.error(`playtime-buff-rewards: admin grant failed for target=${target.playerId} buff=${buffName}: ${err}`);
    throw new TakaroUserError('The buff could not be granted. Check the game server command and try again.');
  }
}

await main();
