import { data, TakaroUserError, checkPermission } from '@takaro/helpers';
import {
  getPlayerCode,
  setPlayerCode,
  setCodeLookup,
  generateUniqueCode,
} from './referral-helpers.js';

async function main() {
  const { pog, player, gameServerId, module: mod } = data;
  const moduleId = mod.moduleId;
  const config = mod.userConfig;

  if (!checkPermission(pog, 'REFERRAL_USE')) {
    throw new TakaroUserError('You do not have permission to use the referral system.');
  }

  let codeData = await getPlayerCode(gameServerId, moduleId, player.id);

  if (!codeData) {
    // VI-22: retry on collision
    const code = await generateUniqueCode(gameServerId, moduleId);
    codeData = { code, createdAt: new Date().toISOString() };
    await setPlayerCode(gameServerId, moduleId, player.id, codeData);
    await setCodeLookup(gameServerId, moduleId, code, { playerId: player.id });
    console.log(`refcode: generated code=${code} for player=${player.name}`);
  } else {
    console.log(`refcode: existing code=${codeData.code} for player=${player.name}`);
  }

  // VI-29: interpolate referralWindowHours from config instead of hardcoding "24h"
  const windowHours = config.referralWindowHours || 24;
  await pog.pm(`Your referral code is: ${codeData.code}\nShare it with new players! They use /referral ${codeData.code} within ${windowHours}h of joining.`);
}

await main();
