import { data } from '@takaro/helpers';
import {
  getAllPendingRefereeIds,
  checkAndPayReferral,
  removeFromPendingIndex,
} from './referral-helpers.js';

async function main() {
  const { gameServerId, module: mod } = data;
  const moduleId = mod.moduleId;
  const config = mod.userConfig;

  // VI-6: Use variableSearch for referral_link:* with status='pending' instead of
  // relying solely on the pending index (which has read-modify-write race risk).
  // getAllPendingRefereeIds queries all referral_link variables and filters by status.
  const refereeIds = await getAllPendingRefereeIds(gameServerId, moduleId);

  if (refereeIds.length === 0) {
    // VI-36: Skip the "no pending referrals" log (moved to debug level implied by absence)
    return;
  }

  console.log(`sweep-pending-referrals: checking ${refereeIds.length} pending referral(s)`);

  let paid = 0;
  let stillPending = 0;
  let rejected = 0;
  let noLink = 0;
  let inFlight = 0;

  for (const refereeId of refereeIds) {
    try {
      const result = await checkAndPayReferral(gameServerId, moduleId, refereeId, config);
      if (result === 'paid') paid++;
      else if (result === 'pending') stillPending++;
      else if (result === 'rejected') rejected++;
      else if (result === 'in-flight') inFlight++;
      else if (result === 'no-link') {
        noLink++;
        // Clean up stale index entry
        await removeFromPendingIndex(gameServerId, moduleId, refereeId);
      }
    } catch (err) {
      console.error(`sweep-pending-referrals: error checking referee=${refereeId}: ${err}`);
    }
  }

  console.log(`sweep-pending-referrals: done — paid=${paid}, stillPending=${stillPending}, rejected=${rejected}, noLink=${noLink}, inFlight=${inFlight}`);
}

await main();
