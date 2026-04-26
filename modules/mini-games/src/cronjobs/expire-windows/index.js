import { data, takaro } from '@takaro/helpers';
import { searchVariablesByKeyPrefix, todayUTC } from './mini-games-helpers.js';

async function main() {
  const { gameServerId, module: mod } = data;
  const moduleId = mod.moduleId;

  const today = todayUTC();
  const windowVars = await searchVariablesByKeyPrefix(gameServerId, moduleId, 'minigames_window:');

  let deleted = 0;
  for (const v of windowVars) {
    // Key format: minigames_window:{playerId}:{YYYY-MM-DD}
    const parts = v.key.split(':');
    const dateStr = parts[parts.length - 1];
    if (dateStr && dateStr < today) {
      await takaro.variable.variableControllerDelete(v.id);
      deleted++;
    }
  }

  console.log(`miniGames expireWindows: deleted ${deleted} window variables (keeping today=${today})`);
}

await main();
