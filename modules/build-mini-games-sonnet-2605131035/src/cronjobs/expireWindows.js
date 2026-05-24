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

  const today = new Date().toISOString().slice(0, 10);
  const allWindows = await varSearchAll('minigames_window:');

  for (const wv of allWindows) {
    // Key format: minigames_window:{playerId}:{YYYY-MM-DD}
    const parts = wv.key.split(':');
    const dateStr = parts[parts.length - 1]; // Last segment is the date
    if (dateStr < today) { // Prior day
      await varDelete(wv.id);
    }
  }
}

await main();
