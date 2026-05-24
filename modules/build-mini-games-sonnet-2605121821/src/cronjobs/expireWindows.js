import { data, takaro, TakaroUserError, checkPermission } from '@takaro/helpers';

async function main() {
  const { gameServerId, module: mod } = data;
  const moduleId = mod.id;

  async function getVar(key) {
    const res = await takaro.variable.variableControllerSearch({
      filters: { key: [key], gameServerId: [gameServerId] }
    });
    if (res.data.data.length === 0) return null;
    return { id: res.data.data[0].id, value: JSON.parse(res.data.data[0].value) };
  }

  async function setVar(key, value) {
    const existing = await getVar(key);
    if (existing) {
      await takaro.variable.variableControllerUpdate(existing.id, { value: JSON.stringify(value) });
    } else {
      await takaro.variable.variableControllerCreate({ key, value: JSON.stringify(value), gameServerId, moduleId });
    }
  }

  // Compute yesterday's date string (YYYY-MM-DD)
  const yesterdayDate = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  // Search for all window variables
  const res = await takaro.variable.variableControllerSearch({
    filters: { gameServerId: [gameServerId] },
    search: { key: [`minigames_window:`] },
    limit: 200
  });

  const windowVars = res.data.data || [];

  // Delete any window variable whose key contains the prior day's date
  for (const variable of windowVars) {
    if (variable.key.includes(`:${yesterdayDate}`)) {
      await takaro.variable.variableControllerDelete(variable.id);
    }
  }
}

await main();
