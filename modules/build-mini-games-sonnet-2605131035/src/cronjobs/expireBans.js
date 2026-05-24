import { data, takaro } from '@takaro/helpers';

async function main() {
  const { gameServerId, module: mod } = data;
  const moduleId = mod.id;

  async function varSearchAll(keyPrefix) {
    const r = await takaro.variable.variableControllerSearch({
      filters: { gameServerId: [gameServerId], moduleId: [moduleId] },
      page: { limit: 200 }
    });
    return r.data.data.filter(v => v.key.startsWith(keyPrefix));
  }

  async function varDelete(id) {
    return takaro.variable.variableControllerDelete(id);
  }

  const allBans = await varSearchAll('minigames_ban:');
  for (const bv of allBans) {
    try {
      const ban = JSON.parse(bv.value);
      if (ban.expiresAt && new Date(ban.expiresAt) <= new Date()) {
        await varDelete(bv.id);
      }
    } catch (e) { /* skip malformed */ }
  }
}

await main();
