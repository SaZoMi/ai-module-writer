import { data, takaro, TakaroUserError, checkPermission } from '@takaro/helpers';

async function main() {
  const { player, gameServerId } = data;

  // v1: no-op — sessions and live rounds persist across disconnects.
  // Registered for future extensibility (e.g. session cleanup, AFK detection).
  // Player info is available via player.playerId and player.name if needed.
  return;
}

await main();
