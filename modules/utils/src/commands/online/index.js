import { data } from '@takaro/helpers';
import { formatOnlinePlayersLine } from './utils-pure.js';
import { fetchOnlinePlayers } from './utils-helpers.js';

async function main() {
  const { gameServerId, pog } = data;
  const onlinePlayers = await fetchOnlinePlayers(gameServerId);
  const message = formatOnlinePlayersLine(onlinePlayers);
  console.log(`utils:online ${message}`);
  await pog.pm(message);
}

await main();
