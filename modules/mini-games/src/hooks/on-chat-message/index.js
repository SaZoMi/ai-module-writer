import { data, takaro, checkPermission } from '@takaro/helpers';
import { getActiveRound, clearActiveRound, awardPoints, recordPlay, findPogByPlayerId, checkBanAndCap } from './mini-games-helpers.js';

async function main() {
  const { gameServerId, eventData, player, module: mod } = data;

  if (!player || !player.id) {
    console.log('miniGames onChatMessage: no player in event, ignoring');
    return;
  }

  const moduleId = mod.moduleId;
  const config = mod.userConfig;

  const round = await getActiveRound(gameServerId, moduleId);
  if (!round || round.game !== 'reactionrace') return;

  // Check if expired
  if (round.expiresAt && new Date(round.expiresAt) < new Date()) return;

  const msg = (eventData?.msg ?? '').trim().toLowerCase();
  const token = round.answer.toLowerCase();

  if (msg !== token) return;

  // Potential winner — validate eligibility BEFORE clearing so a banned player
  // cannot grief the round (it stays active for someone else to win).
  const pog = await findPogByPlayerId(gameServerId, player.id);
  if (!pog) {
    console.error(`miniGames onChatMessage: could not find pog for player ${player.id}`);
    return;
  }

  // Check MINIGAMES_PLAY permission
  if (!checkPermission(pog, 'MINIGAMES_PLAY')) {
    console.log(`miniGames onChatMessage: player ${player.id} lacks MINIGAMES_PLAY, ignoring`);
    return;
  }

  // Check ban — if banned, silently ignore so the round stays active for others
  try {
    await checkBanAndCap(gameServerId, moduleId, pog.playerId, config);
  } catch {
    // Banned player; silently drop — round remains active for others
    console.log(`miniGames onChatMessage: player ${player.id} is banned, ignoring`);
    return;
  }

  // Re-read the round immediately before clearing to narrow the concurrent-winner race.
  // The first eligible writer to find the round still active and delete it wins.
  // A concurrent winner will also attempt clearActiveRound (a no-op delete) then call
  // awardPoints — the plan acknowledges this as an acceptable known limitation.
  const roundStillActive = await getActiveRound(gameServerId, moduleId);
  // Compare startedAt (unique timestamp) rather than answer (only 5 tokens, 20% reuse chance).
  // If the token happens to match a brand-new round, we don't want to credit this stale handler.
  if (!roundStillActive || roundStillActive.game !== 'reactionrace' || roundStillActive.startedAt !== round.startedAt) {
    // Another player already claimed this round, or a new round started
    return;
  }

  // Clear the round — first writer wins the race
  await clearActiveRound(gameServerId, moduleId);

  await recordPlay(gameServerId, moduleId, pog.playerId, 'reactionrace');
  const { actualPoints, multiplier, currencyPaid, cappedByDaily, clippedByDaily } = await awardPoints({
    gameServerId, moduleId, pog, game: 'reactionrace', points: config.pointsReactionRaceWin ?? 20, config,
    playerName: player.name,
  });

  const boostNote = multiplier > 1 ? ` (boost ×${multiplier.toFixed(2)})` : '';
  const currencyNote = currencyPaid > 0 ? ` +${currencyPaid} currency` : '';
  const capNote = cappedByDaily
    ? ' Daily point cap reached — no points awarded.'
    : clippedByDaily
      ? ` Daily cap clipped reward to ${actualPoints} points.`
      : '';

  await takaro.gameserver.gameServerControllerSendMessage(gameServerId, {
    message: `⚡ FIRST! @${player.name} snapped ${round.prompt}. +${actualPoints} points${boostNote}${currencyNote}.${capNote}`,
    opts: {},
  });
}

await main();
