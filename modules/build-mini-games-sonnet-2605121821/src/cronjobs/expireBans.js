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

  const now = new Date();

  // Search for all ban variables
  const res = await takaro.variable.variableControllerSearch({
    filters: { gameServerId: [gameServerId] },
    search: { key: ['minigames_ban:'] },
    limit: 200
  });

  const banVars = res.data.data || [];

  for (const variable of banVars) {
    let ban;
    try {
      ban = JSON.parse(variable.value);
    } catch (e) {
      // Malformed ban entry — skip
      continue;
    }

    // If expiresAt exists and has passed, delete the ban
    if (ban.expiresAt && new Date(ban.expiresAt) <= now) {
      await takaro.variable.variableControllerDelete(variable.id);
    }
    // If no expiresAt → permanent ban, skip
  }
}

await main();
