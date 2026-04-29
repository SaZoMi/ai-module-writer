import { data } from '@takaro/helpers';
import { grantPlaytimeRewards } from './playtime-buff-helpers.js';

async function main() {
  const { gameServerId, module: mod } = data;
  await grantPlaytimeRewards(gameServerId, mod);
}

await main();
