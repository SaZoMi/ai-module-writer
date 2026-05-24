import { data, takaro } from '@takaro/helpers';

async function main() {
  const { gameServerId, module: mod } = data;
  const moduleId = mod.id;

  // Fetch all variables for this module + server
  const r = await takaro.variable.variableControllerSearch({
    filters: { moduleId: [moduleId], gameServerId: [gameServerId] },
    limit: 200,
  });
  const allVars = r.data.data;

  // Filter to ban variables only
  const banVars = allVars.filter((v) => v.key.startsWith('minigames_ban:'));

  const now = new Date();

  for (const v of banVars) {
    let banData = {};
    try {
      banData = JSON.parse(v.value);
    } catch (_) {}

    // Only expire timed bans; permanent bans (no expiresAt) remain
    if (banData.expiresAt && new Date(banData.expiresAt) <= now) {
      await takaro.variable.variableControllerDelete(v.id);
    }
  }
}

await main();
