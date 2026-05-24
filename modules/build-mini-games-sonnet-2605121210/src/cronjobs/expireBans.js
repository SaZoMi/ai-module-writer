import { data, takaro, TakaroUserError, checkPermission } from '@takaro/helpers';

async function main() {
  const moduleId = data.module.moduleId;
  const { gameServerId } = data;

  // Search for all minigames_ban:* variables
  const bansRes = await takaro.variable.variableControllerSearch({
    filters: { gameServerId: [gameServerId], moduleId: [moduleId] },
    search: { key: ['minigames_ban:'] },
    page: 0, limit: 200
  });

  // For each ban, parse the value and delete if expiresAt is in the past
  for (const v of bansRes.data.data) {
    const ban = JSON.parse(v.value);
    if (ban.expiresAt && new Date(ban.expiresAt) <= new Date()) {
      await takaro.variable.variableControllerDelete(v.id);
    }
  }
}

await main();
