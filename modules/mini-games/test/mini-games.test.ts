import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { fileURLToPath } from 'url';
import { Client, EventSearchInputAllowedFiltersEventNameEnum } from '@takaro/apiclient';
import { createClient } from '../../../test/helpers/client.js';
import { startMockServer, stopMockServer, MockServerContext } from '../../../test/helpers/mock-server.js';
import { waitForEvent } from '../../../test/helpers/events.js';
import {
  pushModule,
  installModule,
  uninstallModule,
  deleteModule,
  getCommandPrefix,
  cleanupTestModules,
  cleanupTestGameServers,
  assignPermissions,
  cleanupRole,
} from '../../../test/helpers/modules.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MODULE_DIR = path.resolve(__dirname, '..');

// ─── Variable helpers ─────────────────────────────────────────────────────────

async function setVar(client: Client, gameServerId: string, moduleId: string, key: string, value: unknown) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  const existing = await client.variable.variableControllerSearch({
    filters: { key: [key], gameServerId: [gameServerId], moduleId: [moduleId] },
  });
  if (existing.data.data.length > 0) {
    await client.variable.variableControllerUpdate(existing.data.data[0].id, { value: serialized });
  } else {
    await client.variable.variableControllerCreate({ key, value: serialized, gameServerId, moduleId });
  }
}

async function getVar(client: Client, gameServerId: string, moduleId: string, key: string): Promise<unknown> {
  const res = await client.variable.variableControllerSearch({
    filters: { key: [key], gameServerId: [gameServerId], moduleId: [moduleId] },
  });
  if (res.data.data.length === 0) return null;
  try { return JSON.parse(res.data.data[0].value); } catch { return res.data.data[0].value; }
}

async function delVar(client: Client, gameServerId: string, moduleId: string, key: string) {
  const res = await client.variable.variableControllerSearch({
    filters: { key: [key], gameServerId: [gameServerId], moduleId: [moduleId] },
  });
  for (const v of res.data.data) {
    await client.variable.variableControllerDelete(v.id);
  }
}

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

// ─── Command trigger helper ────────────────────────────────────────────────────

async function runCommand(
  client: Client,
  ctx: MockServerContext,
  prefix: string,
  playerId: string,
  commandLine: string,
): Promise<{ success: boolean; logs: string[] }> {
  const startTime = new Date();

  await client.command.commandControllerTrigger(ctx.gameServer.id, {
    msg: `${prefix}${commandLine}`,
    playerId,
  });

  const event = await waitForEvent(client, {
    eventName: EventSearchInputAllowedFiltersEventNameEnum.CommandExecuted,
    gameserverId: ctx.gameServer.id,
    after: startTime,
    timeout: 30000,
  });

  const meta = event.meta as { result?: { success?: boolean; logs?: Array<{ msg: string }> } };
  const success = meta?.result?.success ?? false;
  const logs = (meta?.result?.logs ?? []).map((l) => l.msg);
  return { success, logs };
}

// ─── Cronjob trigger helper ────────────────────────────────────────────────────

async function runCronjob(
  client: Client,
  ctx: MockServerContext,
  moduleId: string,
  cronjobId: string,
): Promise<{ success: boolean; logs: string[] }> {
  const startTime = new Date();

  await client.cronjob.cronJobControllerTrigger({
    gameServerId: ctx.gameServer.id,
    cronjobId,
    moduleId,
  });

  const event = await waitForEvent(client, {
    eventName: EventSearchInputAllowedFiltersEventNameEnum.CronjobExecuted,
    gameserverId: ctx.gameServer.id,
    after: startTime,
    timeout: 30000,
  });

  const meta = event.meta as { result?: { success?: boolean; logs?: Array<{ msg: string }> } };
  const success = meta?.result?.success ?? false;
  const logs = (meta?.result?.logs ?? []).map((l) => l.msg);
  await new Promise((resolve) => setTimeout(resolve, 500));
  return { success, logs };
}

function getCronjobId(mod: Awaited<ReturnType<typeof pushModule>>, name: string): string {
  const cj = mod.latestVersion.cronJobs.find((c) => c.name === name);
  if (!cj) throw new Error(`Cronjob '${name}' not found in module`);
  return cj.id;
}

// ─── Test suite ──────────────────────────────────────────────────────────────

describe('mini-games module', () => {
  let client: Client;
  let ctx: MockServerContext;
  let moduleId: string;
  let versionId: string;
  let mod: Awaited<ReturnType<typeof pushModule>>;
  let prefix: string;
  let manageRoleId: string | undefined;
  let playRoleId: string | undefined;

  before(async () => {
    client = await createClient();
    await cleanupTestModules(client);
    await cleanupTestGameServers(client);
    ctx = await startMockServer(client);

    mod = await pushModule(client, MODULE_DIR);
    moduleId = mod.id;
    versionId = mod.latestVersion.id;

    await installModule(client, versionId, ctx.gameServer.id, {
      userConfig: {
        liveRoundIntervalMinutes: 5,
        minPlayersForLiveRound: 1,
        liveRoundAnswerWindowSec: 15,
        pointsWordleBase: 100,
        pointsHangmanBase: 80,
        pointsHotColdBase: 60,
        pointsTriviaWin: 40,
        pointsScrambleWin: 40,
        pointsMathRaceWin: 40,
        pointsReactionRaceWin: 20,
        pointsToCurrencyRate: 0,
        dailyPointsCapPerPlayer: 0,
        bigScoreThreshold: 9999,
        triviaQuestionSource: 'custom',
      },
    });

    prefix = await getCommandPrefix(client, ctx.gameServer.id);

    // Grant MINIGAMES_PLAY and MINIGAMES_MANAGE to player[0]
    assert.ok(ctx.players[0], 'Need at least 1 player');
    playRoleId = await assignPermissions(client, ctx.players[0].playerId, ctx.gameServer.id, ['MINIGAMES_PLAY']);
    manageRoleId = await assignPermissions(client, ctx.players[0].playerId, ctx.gameServer.id, ['MINIGAMES_MANAGE']);

    // Allow the module and permissions to fully propagate before running commands
    await new Promise((r) => setTimeout(r, 2000));
  });

  after(async () => {
    await cleanupRole(client, playRoleId);
    await cleanupRole(client, manageRoleId);
    try { await uninstallModule(client, moduleId, ctx.gameServer.id); } catch {}
    try { await deleteModule(client, moduleId); } catch {}
    await stopMockServer(ctx.server, client, ctx.gameServer.id);
  });

  const player0 = () => ctx.players[0]!;

  // ─── Help command ────────────────────────────────────────────────────────────

  describe('minigames help command', () => {
    it('/minigames shows help overview', async () => {
      const { success } = await runCommand(client, ctx, prefix, player0().playerId, 'minigames');
      assert.equal(success, true);
    });

    it('/minigames wordle shows per-game help', async () => {
      const { success } = await runCommand(client, ctx, prefix, player0().playerId, 'minigames wordle');
      assert.equal(success, true);
    });
  });

  // ─── Rollover cronjob ────────────────────────────────────────────────────────

  describe('rolloverDailyPuzzles cronjob', () => {
    it('warns admin when content banks are empty and succeeds', async () => {
      // Delete any existing content banks so they are empty
      await delVar(client, ctx.gameServer.id, moduleId, 'minigames_content_wordle');
      await delVar(client, ctx.gameServer.id, moduleId, 'minigames_content_wordlist');

      const cronjobId = getCronjobId(mod, 'rolloverDailyPuzzles');
      const { success, logs } = await runCronjob(client, ctx, moduleId, cronjobId);
      assert.equal(success, true, `Cronjob failed. Logs: ${JSON.stringify(logs)}`);
    });

    it('sets minigames_puzzle_today when banks are seeded', async () => {
      await setVar(client, ctx.gameServer.id, moduleId, 'minigames_content_wordle', {
        words: ['crane', 'slate', 'tiger', 'brave', 'storm'],
      });
      await setVar(client, ctx.gameServer.id, moduleId, 'minigames_content_wordlist', {
        words: ['takaro', 'gaming', 'server', 'player', 'module'],
      });

      const cronjobId = getCronjobId(mod, 'rolloverDailyPuzzles');
      const { success, logs } = await runCronjob(client, ctx, moduleId, cronjobId);
      assert.equal(success, true, `Cronjob failed. Logs: ${JSON.stringify(logs)}`);

      const puzzle = (await getVar(client, ctx.gameServer.id, moduleId, 'minigames_puzzle_today')) as any;
      assert.ok(puzzle, 'Expected minigames_puzzle_today to be set');
      assert.equal(puzzle.date, todayUTC(), 'Puzzle date should be today');
      assert.ok(puzzle.wordle, 'Expected wordle word to be set');
      assert.ok(puzzle.hangman, 'Expected hangman word to be set');
      assert.ok(puzzle.hotcold !== undefined && puzzle.hotcold !== null, 'Expected hotcold secret to be set');
      assert.ok(/^[a-z]{5}$/.test(puzzle.wordle), `Wordle word '${puzzle.wordle}' must be 5 lowercase letters`);
    });
  });

  // ─── Wordle ─────────────────────────────────────────────────────────────────

  describe('wordle command', () => {
    before(async () => {
      // Set a known puzzle
      await setVar(client, ctx.gameServer.id, moduleId, 'minigames_puzzle_today', {
        date: todayUTC(),
        wordle: 'crane',
        hangman: 'takaro',
        hotcold: 500,
      });
      await setVar(client, ctx.gameServer.id, moduleId, 'minigames_content_wordle', {
        words: ['crane', 'slate', 'tiger', 'brave', 'storm'],
      });
      await delVar(client, ctx.gameServer.id, moduleId, `minigames_session:${player0().playerId}:wordle`);
    });

    it('shows status with no guesses', async () => {
      const { success } = await runCommand(client, ctx, prefix, player0().playerId, 'wordle');
      assert.equal(success, true);
    });

    it('rejects guess that is not 5 letters (handled as user error)', async () => {
      const { success } = await runCommand(client, ctx, prefix, player0().playerId, 'wordle abc');
      assert.equal(success, false, 'TakaroUserError should yield success=false');
    });

    it('rejects word not in bank', async () => {
      const { success } = await runCommand(client, ctx, prefix, player0().playerId, 'wordle zzzzz');
      assert.equal(success, false, 'TakaroUserError should yield success=false');
    });

    it('accepts a valid guess from the bank', async () => {
      const { success } = await runCommand(client, ctx, prefix, player0().playerId, 'wordle slate');
      assert.equal(success, true);
    });

    it('solves wordle with correct word and awards points', async () => {
      // Clear session to start fresh
      await delVar(client, ctx.gameServer.id, moduleId, `minigames_session:${player0().playerId}:wordle`);

      const { success } = await runCommand(client, ctx, prefix, player0().playerId, 'wordle crane');
      assert.equal(success, true);

      await new Promise((r) => setTimeout(r, 500));
      const stats = (await getVar(client, ctx.gameServer.id, moduleId, `minigames_stats:${player0().playerId}`)) as any;
      assert.ok(stats, 'Stats should be set after winning');
      assert.ok((stats.totalPoints ?? 0) > 0, 'Total points should be positive');
      assert.ok((stats.perGame?.wordle?.wins ?? 0) >= 1, 'Wordle wins should be at least 1');
    });
  });

  // ─── Hangman ─────────────────────────────────────────────────────────────────

  describe('hangman command', () => {
    before(async () => {
      await delVar(client, ctx.gameServer.id, moduleId, `minigames_session:${player0().playerId}:hangman`);
    });

    it('shows status with no session', async () => {
      const { success } = await runCommand(client, ctx, prefix, player0().playerId, 'hangman');
      assert.equal(success, true);
    });

    it('accepts a letter guess', async () => {
      const { success } = await runCommand(client, ctx, prefix, player0().playerId, 'hangman t');
      assert.equal(success, true);
    });

    it('solves hangman with full word', async () => {
      await delVar(client, ctx.gameServer.id, moduleId, `minigames_session:${player0().playerId}:hangman`);

      const { success } = await runCommand(client, ctx, prefix, player0().playerId, 'hangman takaro');
      assert.equal(success, true);

      await new Promise((r) => setTimeout(r, 500));
      const stats = (await getVar(client, ctx.gameServer.id, moduleId, `minigames_stats:${player0().playerId}`)) as any;
      assert.ok((stats?.perGame?.hangman?.wins ?? 0) >= 1, 'Hangman wins should be at least 1');
    });
  });

  // ─── Hot/Cold ─────────────────────────────────────────────────────────────────

  describe('hotcold command', () => {
    before(async () => {
      await setVar(client, ctx.gameServer.id, moduleId, 'minigames_puzzle_today', {
        date: todayUTC(),
        wordle: 'crane',
        hangman: 'takaro',
        hotcold: 42,
      });
      await delVar(client, ctx.gameServer.id, moduleId, `minigames_session:${player0().playerId}:hotcold`);
    });

    it('shows status with no guesses', async () => {
      const { success } = await runCommand(client, ctx, prefix, player0().playerId, 'hotcold');
      assert.equal(success, true);
    });

    it('rejects out-of-range guess', async () => {
      const { success } = await runCommand(client, ctx, prefix, player0().playerId, 'hotcold 1001');
      assert.equal(success, false, 'TakaroUserError should yield success=false');
    });

    it('accepts a valid guess', async () => {
      const { success } = await runCommand(client, ctx, prefix, player0().playerId, 'hotcold 500');
      assert.equal(success, true);
    });

    it('solves with exact guess', async () => {
      await delVar(client, ctx.gameServer.id, moduleId, `minigames_session:${player0().playerId}:hotcold`);

      const { success } = await runCommand(client, ctx, prefix, player0().playerId, 'hotcold 42');
      assert.equal(success, true);

      await new Promise((r) => setTimeout(r, 500));
      const stats = (await getVar(client, ctx.gameServer.id, moduleId, `minigames_stats:${player0().playerId}`)) as any;
      assert.ok((stats?.perGame?.hotcold?.wins ?? 0) >= 1, 'Hot/Cold wins should be at least 1');
    });
  });

  // ─── Math race live round ─────────────────────────────────────────────────────

  describe('math race live round', () => {
    before(async () => {
      await delVar(client, ctx.gameServer.id, moduleId, 'minigames_active_round');
    });

    it('fires math race via admin command', async () => {
      const { success, logs } = await runCommand(client, ctx, prefix, player0().playerId, 'minigamesfirenow mathrace');
      assert.equal(success, true, `minigamesfirenow failed. Logs: ${JSON.stringify(logs)}`);

      await new Promise((r) => setTimeout(r, 1000));
      const round = (await getVar(client, ctx.gameServer.id, moduleId, 'minigames_active_round')) as any;
      assert.ok(round, 'Expected active round after fire');
      assert.equal(round.game, 'mathrace');
      assert.ok(round.answer !== undefined, 'Round should have an answer');
    });

    it('correct /answer wins the round and awards points', async () => {
      const round = (await getVar(client, ctx.gameServer.id, moduleId, 'minigames_active_round')) as any;
      assert.ok(round, 'Need an active round for this test');

      const statsBefore = (await getVar(client, ctx.gameServer.id, moduleId, `minigames_stats:${player0().playerId}`)) as any;
      const ptsBefore = statsBefore?.totalPoints ?? 0;

      const { success } = await runCommand(client, ctx, prefix, player0().playerId, `answer ${round.answer}`);
      assert.equal(success, true);

      await new Promise((r) => setTimeout(r, 1000));

      const roundAfter = await getVar(client, ctx.gameServer.id, moduleId, 'minigames_active_round');
      assert.equal(roundAfter, null, 'Active round should be cleared after correct answer');

      const statsAfter = (await getVar(client, ctx.gameServer.id, moduleId, `minigames_stats:${player0().playerId}`)) as any;
      assert.ok((statsAfter?.totalPoints ?? 0) > ptsBefore, 'Points should increase after winning math race');
    });
  });

  // ─── Scramble live round ──────────────────────────────────────────────────────

  describe('scramble live round', () => {
    before(async () => {
      await delVar(client, ctx.gameServer.id, moduleId, 'minigames_active_round');
    });

    it('fires scramble and correct answer wins', async () => {
      const { success: fireSuccess } = await runCommand(client, ctx, prefix, player0().playerId, 'minigamesfirenow scramble');
      assert.equal(fireSuccess, true);
      await new Promise((r) => setTimeout(r, 1000));

      const round = (await getVar(client, ctx.gameServer.id, moduleId, 'minigames_active_round')) as any;
      assert.ok(round, 'Expected active scramble round');
      assert.equal(round.game, 'scramble');

      const { success } = await runCommand(client, ctx, prefix, player0().playerId, `answer ${round.answer}`);
      assert.equal(success, true);

      await new Promise((r) => setTimeout(r, 500));
      const roundAfter = await getVar(client, ctx.gameServer.id, moduleId, 'minigames_active_round');
      assert.equal(roundAfter, null, 'Round should be cleared after win');
    });
  });

  // ─── Trivia (custom bank) ──────────────────────────────────────────────────────

  describe('trivia live round (custom bank)', () => {
    before(async () => {
      await delVar(client, ctx.gameServer.id, moduleId, 'minigames_active_round');
      await setVar(client, ctx.gameServer.id, moduleId, 'minigames_content_trivia', {
        questions: [
          { question: 'What is 2 plus 2?', answer: 'four', incorrectAnswers: ['three', 'five', 'six'] },
        ],
      });
    });

    it('fires trivia and correct answer wins', async () => {
      const { success: fireSuccess } = await runCommand(client, ctx, prefix, player0().playerId, 'minigamesfirenow trivia');
      assert.equal(fireSuccess, true);
      await new Promise((r) => setTimeout(r, 1000));

      const round = (await getVar(client, ctx.gameServer.id, moduleId, 'minigames_active_round')) as any;
      assert.ok(round, 'Expected active trivia round');
      assert.equal(round.game, 'trivia');

      const { success } = await runCommand(client, ctx, prefix, player0().playerId, `answer ${round.answer}`);
      assert.equal(success, true);

      await new Promise((r) => setTimeout(r, 500));
      const roundAfter = await getVar(client, ctx.gameServer.id, moduleId, 'minigames_active_round');
      assert.equal(roundAfter, null, 'Round should be cleared after win');
    });
  });

  // ─── closeLiveRound cronjob ────────────────────────────────────────────────────

  describe('closeLiveRound cronjob', () => {
    it('closes an expired round', async () => {
      await setVar(client, ctx.gameServer.id, moduleId, 'minigames_active_round', {
        game: 'mathrace',
        prompt: '1 + 1',
        answer: 2,
        answerType: 'number',
        startedAt: new Date(Date.now() - 120000).toISOString(),
        expiresAt: new Date(Date.now() - 60000).toISOString(),
      });

      const cronjobId = getCronjobId(mod, 'closeLiveRound');
      const { success, logs } = await runCronjob(client, ctx, moduleId, cronjobId);
      assert.equal(success, true, `closeLiveRound failed. Logs: ${JSON.stringify(logs)}`);

      await new Promise((r) => setTimeout(r, 500));
      const roundAfter = await getVar(client, ctx.gameServer.id, moduleId, 'minigames_active_round');
      assert.equal(roundAfter, null, 'Expired round should be cleared');
    });
  });

  // ─── fireLiveRound cronjob ────────────────────────────────────────────────────

  describe('fireLiveRound cronjob', () => {
    before(async () => {
      await delVar(client, ctx.gameServer.id, moduleId, 'minigames_active_round');
      await delVar(client, ctx.gameServer.id, moduleId, 'minigames_last_round_firedAt');
    });

    it('fires a round when interval elapsed and players online', async () => {
      const cronjobId = getCronjobId(mod, 'fireLiveRound');
      const { success, logs } = await runCronjob(client, ctx, moduleId, cronjobId);
      assert.equal(success, true, `fireLiveRound failed. Logs: ${JSON.stringify(logs)}`);

      await new Promise((r) => setTimeout(r, 1000));
      const round = await getVar(client, ctx.gameServer.id, moduleId, 'minigames_active_round');
      assert.ok(round, 'Expected live round to be created');
      await delVar(client, ctx.gameServer.id, moduleId, 'minigames_active_round');
    });

    it('skips when interval has not elapsed', async () => {
      await setVar(client, ctx.gameServer.id, moduleId, 'minigames_last_round_firedAt', new Date().toISOString());

      const cronjobId = getCronjobId(mod, 'fireLiveRound');
      const { success, logs } = await runCronjob(client, ctx, moduleId, cronjobId);
      assert.equal(success, true, `fireLiveRound failed. Logs: ${JSON.stringify(logs)}`);

      await new Promise((r) => setTimeout(r, 500));
      const round = await getVar(client, ctx.gameServer.id, moduleId, 'minigames_active_round');
      assert.equal(round, null, 'Should not fire when interval has not elapsed');
    });
  });

  // ─── refreshLeaderboards cronjob ──────────────────────────────────────────────

  describe('refreshLeaderboards cronjob', () => {
    it('generates the leaderboard cache', async () => {
      const cronjobId = getCronjobId(mod, 'refreshLeaderboards');
      const { success, logs } = await runCronjob(client, ctx, moduleId, cronjobId);
      assert.equal(success, true, `refreshLeaderboards failed. Logs: ${JSON.stringify(logs)}`);

      const cache = (await getVar(client, ctx.gameServer.id, moduleId, 'minigames_leaderboard_cache')) as any;
      assert.ok(cache, 'Leaderboard cache should be set');
      assert.ok(Array.isArray(cache.topPoints), 'topPoints should be an array');
      assert.ok(cache.refreshedAt, 'refreshedAt should be set');
    });
  });

  // ─── Daily point cap ──────────────────────────────────────────────────────────

  describe('daily point cap', () => {
    it('clips points to the daily cap', async () => {
      // Reinstall with tight cap
      await uninstallModule(client, moduleId, ctx.gameServer.id);
      await installModule(client, versionId, ctx.gameServer.id, {
        userConfig: {
          dailyPointsCapPerPlayer: 30,
          pointsWordleBase: 100,
          triviaQuestionSource: 'custom',
          liveRoundIntervalMinutes: 5,
          minPlayersForLiveRound: 1,
          liveRoundAnswerWindowSec: 15,
        },
      });

      await delVar(client, ctx.gameServer.id, moduleId, `minigames_window:${player0().playerId}:${todayUTC()}`);
      await setVar(client, ctx.gameServer.id, moduleId, 'minigames_puzzle_today', {
        date: todayUTC(),
        wordle: 'brave',
        hangman: 'server',
        hotcold: 888,
      });
      await delVar(client, ctx.gameServer.id, moduleId, `minigames_session:${player0().playerId}:wordle`);

      const { success } = await runCommand(client, ctx, prefix, player0().playerId, 'wordle brave');
      assert.equal(success, true);

      await new Promise((r) => setTimeout(r, 500));
      const window = (await getVar(client, ctx.gameServer.id, moduleId, `minigames_window:${player0().playerId}:${todayUTC()}`)) as any;
      assert.ok(window, 'Daily window should be set');
      assert.ok((window.earned ?? 0) <= 30, `Earned ${window.earned} should be <= cap of 30`);

      // Restore config
      await uninstallModule(client, moduleId, ctx.gameServer.id);
      await installModule(client, versionId, ctx.gameServer.id, {
        userConfig: {
          triviaQuestionSource: 'custom',
          liveRoundIntervalMinutes: 5,
          minPlayersForLiveRound: 1,
          liveRoundAnswerWindowSec: 15,
          bigScoreThreshold: 9999,
        },
      });
    });
  });

  // ─── Ban / unban ──────────────────────────────────────────────────────────────

  describe('ban and unban admin commands', () => {
    it('ban sets the ban variable', async () => {
      const victim = ctx.players[1] ?? ctx.players[0];
      await runCommand(client, ctx, prefix, player0().playerId, `minigamesban ${victim.gameId}`);
      await new Promise((r) => setTimeout(r, 500));

      const ban = await getVar(client, ctx.gameServer.id, moduleId, `minigames_ban:${victim.playerId}`);
      assert.ok(ban !== null, 'Ban variable should be set');

      // Unban
      await runCommand(client, ctx, prefix, player0().playerId, `minigamesunban ${victim.gameId}`);
      await new Promise((r) => setTimeout(r, 500));

      const banAfter = await getVar(client, ctx.gameServer.id, moduleId, `minigames_ban:${victim.playerId}`);
      assert.equal(banAfter, null, 'Ban should be removed after unban');
    });
  });

  // ─── expireBans cronjob ────────────────────────────────────────────────────────

  describe('expireBans cronjob', () => {
    it('removes expired ban variables', async () => {
      const pid = player0().playerId;
      await setVar(client, ctx.gameServer.id, moduleId, `minigames_ban:${pid}`, {
        expiresAt: new Date(Date.now() - 5000).toISOString(),
      });

      const cronjobId = getCronjobId(mod, 'expireBans');
      const { success } = await runCronjob(client, ctx, moduleId, cronjobId);
      assert.equal(success, true);

      await new Promise((r) => setTimeout(r, 500));
      const banAfter = await getVar(client, ctx.gameServer.id, moduleId, `minigames_ban:${pid}`);
      assert.equal(banAfter, null, 'Expired ban should be removed');
    });
  });

  // ─── expireWindows cronjob ────────────────────────────────────────────────────

  describe('expireWindows cronjob', () => {
    it('removes old window variables', async () => {
      const pid = player0().playerId;
      await setVar(client, ctx.gameServer.id, moduleId, `minigames_window:${pid}:2000-01-01`, { earned: 100 });

      const cronjobId = getCronjobId(mod, 'expireWindows');
      const { success } = await runCronjob(client, ctx, moduleId, cronjobId);
      assert.equal(success, true);

      await new Promise((r) => setTimeout(r, 500));
      const windowAfter = await getVar(client, ctx.gameServer.id, moduleId, `minigames_window:${pid}:2000-01-01`);
      assert.equal(windowAfter, null, 'Old window variable should be deleted');
    });
  });

  // ─── Stats and leaderboard commands ──────────────────────────────────────────

  describe('stats and leaderboard commands', () => {
    it('/minigamestats returns stats', async () => {
      const { success } = await runCommand(client, ctx, prefix, player0().playerId, 'minigamestats');
      assert.equal(success, true);
    });

    it('/minigamestop points returns leaderboard', async () => {
      const { success } = await runCommand(client, ctx, prefix, player0().playerId, 'minigamestop points');
      assert.equal(success, true);
    });

    it('/puzzle shows daily puzzle status', async () => {
      const { success } = await runCommand(client, ctx, prefix, player0().playerId, 'puzzle');
      assert.equal(success, true);
    });
  });

  // ─── Admin commands ────────────────────────────────────────────────────────────

  describe('admin commands', () => {
    it('/minigamesskiproundnow cancels active round', async () => {
      await setVar(client, ctx.gameServer.id, moduleId, 'minigames_active_round', {
        game: 'mathrace',
        prompt: '2 + 2',
        answer: 4,
        answerType: 'number',
        startedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      });

      const { success } = await runCommand(client, ctx, prefix, player0().playerId, 'minigamesskiproundnow');
      assert.equal(success, true);

      await new Promise((r) => setTimeout(r, 500));
      const round = await getVar(client, ctx.gameServer.id, moduleId, 'minigames_active_round');
      assert.equal(round, null, 'Active round should be cleared');
    });

    it('/minigamesresetstats deletes stats', async () => {
      await setVar(client, ctx.gameServer.id, moduleId, `minigames_stats:${player0().playerId}`, { totalPoints: 9999 });

      const { success } = await runCommand(client, ctx, prefix, player0().playerId, `minigamesresetstats ${player0().gameId}`);
      assert.equal(success, true);

      await new Promise((r) => setTimeout(r, 500));
      const stats = await getVar(client, ctx.gameServer.id, moduleId, `minigames_stats:${player0().playerId}`);
      assert.equal(stats, null, 'Stats should be deleted after reset');
    });

    it('/minigamesreport completes successfully', async () => {
      const { success } = await runCommand(client, ctx, prefix, player0().playerId, 'minigamesreport');
      assert.equal(success, true);
    });
  });
});
