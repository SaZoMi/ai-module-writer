import { data, takaro } from '@takaro/helpers';
import {
  getVariable, setVariable, getActiveRound, buildAndFireLiveRound,
} from './mini-games-helpers.js';

async function main() {
  const { gameServerId, module: mod } = data;
  const moduleId = mod.moduleId;
  const config = mod.userConfig;

  // Check interval elapsed
  const intervalMinutes = config.liveRoundIntervalMinutes ?? 30;
  const lastFiredAt = await getVariable(gameServerId, moduleId, 'minigames_last_round_firedAt');
  if (lastFiredAt) {
    const elapsed = (Date.now() - new Date(lastFiredAt).getTime()) / 60000;
    if (elapsed < intervalMinutes) {
      console.log(`miniGames fireLiveRound: ${elapsed.toFixed(1)}min elapsed < ${intervalMinutes}min interval, skipping`);
      return;
    }
  }

  // Check player count
  const minPlayers = config.minPlayersForLiveRound ?? 2;
  const playersRes = await takaro.playerOnGameserver.playerOnGameServerControllerSearch({
    filters: { gameServerId: [gameServerId], online: [true] },
    limit: 100,
  });
  const onlineCount = playersRes.data.data.length;
  if (onlineCount < minPlayers) {
    console.log(`miniGames fireLiveRound: only ${onlineCount} players online, need ${minPlayers}, skipping`);
    return;
  }

  // Check no active round
  const existing = await getActiveRound(gameServerId, moduleId);
  if (existing) {
    console.log('miniGames fireLiveRound: round already active, skipping');
    return;
  }

  const round = await buildAndFireLiveRound(gameServerId, moduleId, config, null);
  if (!round) {
    console.log('miniGames fireLiveRound: no game could be fired (empty bank or all disabled)');
    return;
  }

  await setVariable(gameServerId, moduleId, 'minigames_last_round_firedAt', new Date().toISOString());
  console.log(`miniGames fireLiveRound: fired game=${round.game}, expiresAt=${round.expiresAt}`);
}

await main();
