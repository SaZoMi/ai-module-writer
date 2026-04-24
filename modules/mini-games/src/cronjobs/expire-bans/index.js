import { data, takaro } from '@takaro/helpers';
import { searchVariablesByKeyPrefix } from './mini-games-helpers.js';

async function main() {
  const { gameServerId, module: mod } = data;
  const moduleId = mod.moduleId;

  const banVars = await searchVariablesByKeyPrefix(gameServerId, moduleId, 'minigames_ban:');
  const now = new Date();
  let deleted = 0;

  for (const v of banVars) {
    let banData;
    try { banData = JSON.parse(v.value); } catch { continue; }
    if (banData.expiresAt && new Date(banData.expiresAt) < now) {
      await takaro.variable.variableControllerDelete(v.id);
      deleted++;
    }
  }

  console.log(`miniGames expireBans: removed ${deleted} expired ban(s)`);
}

await main();
