import { data, takaro } from '@takaro/helpers';
import { KEY_REFERRAL_STATS, DEFAULT_STATS, todayUTC } from './referral-helpers.js';

async function main() {
  const { gameServerId, module: mod } = data;
  const moduleId = mod.moduleId;

  const today = todayUTC();
  let page = 0;
  let reset = 0;
  let skipped = 0;
  let iterations = 0;
  const limit = 100;

  while (true) {
    if (++iterations > 100) {
      console.error('reset-daily-counters: exceeded 100 iterations, aborting');
      break;
    }

    const res = await takaro.variable.variableControllerSearch({
      filters: {
        key: [KEY_REFERRAL_STATS],
        gameServerId: [gameServerId],
        moduleId: [moduleId],
      },
      page,
      limit,
    });

    const records = res.data.data;
    if (records.length === 0) break;

    for (const record of records) {
      try {
        const stats = { ...DEFAULT_STATS, ...JSON.parse(record.value) };
        // VI-18: Reset all records where lastReferralDay !== today,
        // regardless of whether referralsToday is 0.
        if (stats.lastReferralDay !== today) {
          const updated = { ...stats, referralsToday: 0 };
          await takaro.variable.variableControllerUpdate(record.id, { value: JSON.stringify(updated) });
          reset++;
        } else {
          skipped++;
        }
      } catch (err) {
        console.error(`reset-daily-counters: failed to process variable ${record.id}: ${err}`);
      }
    }

    if (records.length < limit) break;
    page++;
  }

  console.log(`reset-daily-counters: done — reset=${reset}, skipped=${skipped}`);
}

await main();
