import { data } from '@takaro/helpers';
import { getReferralLink, checkAndPayReferral } from './referral-helpers.js';

async function main() {
  const { gameServerId, player, module: mod } = data;
  const moduleId = mod.moduleId;
  const config = mod.userConfig;

  if (!player || !player.id) {
    // VI-31: Emit a single warn log when hook skips for missing pog
    console.warn('on-player-disconnect: no player data in event, skipping referral check');
    return;
  }

  // Check if this player is a referee with a pending link
  const link = await getReferralLink(gameServerId, moduleId, player.id);
  if (!link || link.status !== 'pending') {
    // No pending link, nothing to do
    return;
  }

  console.log(`on-player-disconnect: player=${player.name}(${player.id}) has pending referral link, checking threshold`);

  const result = await checkAndPayReferral(gameServerId, moduleId, player.id, config);
  console.log(`on-player-disconnect: checkAndPayReferral result=${result} for player=${player.name}`);
}

await main();
