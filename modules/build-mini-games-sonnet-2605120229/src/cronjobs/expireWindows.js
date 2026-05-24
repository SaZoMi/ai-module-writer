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

  // Filter to window variables only
  const windowVars = allVars.filter((v) => v.key.startsWith('minigames_window:'));

  const today = new Date().toISOString().slice(0, 10);

  // Delete any window that does not belong to today
  for (const v of windowVars) {
    // Key format: minigames_window:{playerId}:{YYYY-MM-DD}
    const parts = v.key.split(':');
    const datePart = parts[parts.length - 1];
    if (datePart !== today) {
      await takaro.variable.variableControllerDelete(v.id);
    }
  }
}

await main();
