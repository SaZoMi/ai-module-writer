import { data } from '@takaro/helpers';

async function main() {
  const { player, gameServerId } = data;

  // Sessions persist across disconnect — async puzzles can be resumed on reconnect.
  // Live rounds continue unless the player was the only one online (not tracked here).
  // No state change needed in v1. Log for observability.
  console.log(`miniGames onPlayerDisconnect: player=${player?.name ?? 'unknown'} disconnected from server=${gameServerId}. Async puzzle sessions persist.`);
}

await main();
