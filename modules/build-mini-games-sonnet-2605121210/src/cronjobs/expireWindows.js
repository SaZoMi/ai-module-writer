import { data, takaro, TakaroUserError, checkPermission } from '@takaro/helpers';

async function main() {
  const moduleId = data.module.moduleId;
  const { gameServerId } = data;

  const today = new Date().toISOString().slice(0, 10);

  // Search for all minigames_window:* variables for this server+module
  const winRes = await takaro.variable.variableControllerSearch({
    filters: { gameServerId: [gameServerId], moduleId: [moduleId] },
    search: { key: ['minigames_window:'] },
    page: 0, limit: 200
  });

  // Delete any variable whose key does NOT end with today's date
  for (const v of winRes.data.data) {
    if (!v.key.endsWith(today)) {
      await takaro.variable.variableControllerDelete(v.id);
    }
  }
}

await main();
