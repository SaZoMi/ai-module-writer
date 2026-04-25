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
  cleanupTestModules,
  cleanupTestGameServers,
} from '../../../test/helpers/modules.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MODULE_DIR = path.resolve(__dirname, '..');

/**
 * Helper to install the module with specific config.
 */
async function installWithConfig(
  client: Client,
  versionId: string,
  gameServerId: string,
  userConfig: Record<string, unknown>,
): Promise<void> {
  await installModule(client, versionId, gameServerId, { userConfig });
}

describe('server-messages: broadcast cronjob', () => {
  let client: Client;
  let ctx: MockServerContext | undefined;
  let moduleId: string;
  let versionId: string;
  let cronjobId: string;

  before(async () => {
    client = await createClient();
    await cleanupTestModules(client);
    await cleanupTestGameServers(client);

    // pushModule is idempotent: it searches for an existing module by name and
    // deletes it before re-importing. No separate orphan-cleanup block is needed
    // here — adding one would race with pushModule's own delete and hit the same
    // phantom-row on a 404, causing an unhandled error that cancels all subtests.

    ctx = await startMockServer(client);

    const mod = await pushModule(client, MODULE_DIR);
    moduleId = mod.id;
    versionId = mod.latestVersion.id;

    const cronjob = mod.latestVersion.cronJobs[0];
    if (!cronjob) throw new Error('Expected at least one cronjob in server-messages module');
    cronjobId = cronjob.id;
  });

  after(async () => {
    // Guard: if before() threw before ctx was set, nothing to tear down
    if (!ctx) return;

    // Best-effort uninstall — may already be uninstalled between tests
    try {
      await uninstallModule(client, moduleId, ctx.gameServer.id);
    } catch (_err) {
      // Ignore — may already be uninstalled
    }
    try {
      await deleteModule(client, moduleId);
    } catch (err) {
      console.error('Cleanup: failed to delete module:', err);
    }
    await stopMockServer(ctx.server, client, ctx.gameServer.id);
  });

  /**
   * Trigger the broadcast cronjob and return { success, logs }.
   * Waits for the CronjobExecuted event and adds a 1s settle delay.
   */
  async function triggerBroadcast(): Promise<{ success: boolean; logs: string[] }> {
    const triggerBefore = new Date();

    await client.cronjob.cronJobControllerTrigger({
      gameServerId: ctx!.gameServer.id,
      cronjobId,
      moduleId,
    });

    const event = await waitForEvent(client, {
      eventName: EventSearchInputAllowedFiltersEventNameEnum.CronjobExecuted,
      gameserverId: ctx!.gameServer.id,
      after: triggerBefore,
      timeout: 30000,
    });

    const meta = event.meta as { result?: { success?: boolean; logs?: Array<{ msg: string }> } };
    const success = meta?.result?.success ?? false;
    const logs = (meta?.result?.logs ?? []).map((l) => l.msg);

    // Give Takaro time to commit variable updates before the next trigger reads them
    await new Promise((resolve) => setTimeout(resolve, 1000));

    return { success, logs };
  }

  /**
   * Delete all server-messages module variables for a clean-slate state.
   * Uses pagination to handle any number of variables safely.
   * Iteration cap mirrors afk-kick's check-afk pattern to guard against
   * delete-failure loops.
   */
  async function clearModuleVariables(): Promise<void> {
    let page = 0;
    const limit = 100;
    let iterations = 0;
    while (true) {
      if (++iterations > 100) throw new Error('clearModuleVariables exceeded iteration cap — delete loop not making progress');
      const staleVars = await client.variable.variableControllerSearch({
        filters: {
          moduleId: [moduleId],
          gameServerId: [ctx!.gameServer.id],
        },
        limit,
        page,
      });
      const vars = staleVars.data.data;
      if (vars.length === 0) break;
      for (const v of vars) {
        await client.variable.variableControllerDelete(v.id);
      }
      // If we got fewer than a full page, we're done
      if (vars.length < limit) break;
      // Otherwise re-query page 0 since deletes shift the pages
      page = 0;
    }
  }

  // ---- Test: empty messages list ----

  it('empty messages array — succeeds quietly without sending', async () => {
    await installWithConfig(client, versionId, ctx!.gameServer.id, {
      messages: [],
      order: 'sequential',
    });
    try {
      const { success, logs } = await triggerBroadcast();

      assert.equal(success, true, `Expected success with empty messages, logs: ${JSON.stringify(logs)}`);
      assert.ok(
        logs.some((msg) => msg.includes('no messages configured')),
        `Expected "no messages configured" log, got: ${JSON.stringify(logs)}`,
      );
    } finally {
      await uninstallModule(client, moduleId, ctx!.gameServer.id);
    }
  });

  // ---- Test: sequential rotation ----

  it('sequential mode sends messages in order and wraps around', async () => {
    await installWithConfig(client, versionId, ctx!.gameServer.id, {
      messages: [
        { text: 'Message A' },
        { text: 'Message B' },
        { text: 'Message C' },
      ],
      order: 'sequential',
    });
    try {
      await clearModuleVariables();

      // Trigger 4 times to verify wrap-around (A, B, C, A)
      const { logs: logs0 } = await triggerBroadcast();
      const { logs: logs1 } = await triggerBroadcast();
      const { logs: logs2 } = await triggerBroadcast();
      const { logs: logs3 } = await triggerBroadcast();

      assert.ok(
        logs0.some((l) => l.includes('index=0')),
        `Expected first trigger to send index=0, got: ${JSON.stringify(logs0)}`,
      );
      assert.ok(
        logs1.some((l) => l.includes('index=1')),
        `Expected second trigger to send index=1, got: ${JSON.stringify(logs1)}`,
      );
      assert.ok(
        logs2.some((l) => l.includes('index=2')),
        `Expected third trigger to send index=2, got: ${JSON.stringify(logs2)}`,
      );
      // Wrap-around: index 3 % 3 = 0
      assert.ok(
        logs3.some((l) => l.includes('index=0')),
        `Expected fourth trigger to wrap to index=0, got: ${JSON.stringify(logs3)}`,
      );
    } finally {
      await uninstallModule(client, moduleId, ctx!.gameServer.id);
    }
  });

  // ---- Test: zero online players does not advance sequential state ----

  it('zero online players — skips tick without advancing sequential index', async () => {
    await installWithConfig(client, versionId, ctx!.gameServer.id, {
      messages: [
        { text: 'Msg 1' },
        { text: 'Msg 2' },
      ],
      order: 'sequential',
    });
    try {
      await clearModuleVariables();

      // First trigger with players online — advances index from 0 to 1
      const { logs: logsOnline } = await triggerBroadcast();
      assert.ok(
        logsOnline.some((l) => l.includes('index=0')),
        `Expected first trigger to send index=0, got: ${JSON.stringify(logsOnline)}`,
      );

      // Disconnect all players and poll until Takaro registers zero online
      await ctx!.server.executeConsoleCommand('disconnectAll');
      const disconnectMaxWait = 15000;
      const pollInterval = 1000;
      const disconnectStart = Date.now();
      let allOffline = false;
      while (Date.now() - disconnectStart < disconnectMaxWait) {
        const res = await client.playerOnGameserver.playerOnGameServerControllerSearch({
          filters: { gameServerId: [ctx!.gameServer.id], online: [true] },
          limit: 1,
        });
        if (res.data.meta.total === 0) {
          allOffline = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
      }
      assert.ok(allOffline, `Expected all players to be offline within ${disconnectMaxWait}ms`);

      // Trigger with nobody online — should skip without advancing
      const { success: skipSuccess, logs: skipLogs } = await triggerBroadcast();
      assert.equal(skipSuccess, true, `Expected skip tick to succeed, logs: ${JSON.stringify(skipLogs)}`);
      assert.ok(
        skipLogs.some((l) => l.includes('no players online')),
        `Expected "no players online" log during skipped tick, got: ${JSON.stringify(skipLogs)}`,
      );

      // Reconnect all players and poll until they are registered as online
      await ctx!.server.executeConsoleCommand('connectAll');
      const reconnectMaxWait = 30000;
      const reconnectStart = Date.now();
      const expectedCount = ctx!.players.length;
      let allOnline = false;
      while (Date.now() - reconnectStart < reconnectMaxWait) {
        const res = await client.playerOnGameserver.playerOnGameServerControllerSearch({
          filters: { gameServerId: [ctx!.gameServer.id], online: [true] },
          limit: 100,
        });
        if ((res.data.meta.total ?? 0) >= expectedCount) {
          allOnline = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
      }
      assert.ok(allOnline, `Expected all players to be back online within ${reconnectMaxWait}ms`);

      // Trigger again — should still be at index=1 (not 2, proving the skip didn't advance state)
      const { logs: logsReconnect } = await triggerBroadcast();
      assert.ok(
        logsReconnect.some((l) => l.includes('index=1')),
        `Expected post-reconnect trigger to send index=1 (state not advanced during skip), got: ${JSON.stringify(logsReconnect)}`,
      );
    } finally {
      await uninstallModule(client, moduleId, ctx!.gameServer.id);
    }
  });

  // ---- Test: placeholder rendering ----

  it('renders {playerCount} and {serverName} placeholders', async () => {
    await installWithConfig(client, versionId, ctx!.gameServer.id, {
      messages: [
        { text: 'Online: {playerCount} on {serverName}' },
      ],
      order: 'sequential',
    });
    try {
      await clearModuleVariables();

      // Fetch the configured server name to assert it appears in the rendered message
      const serverRes = await client.gameserver.gameServerControllerGetOne(ctx!.gameServer.id);
      const expectedServerName = serverRes.data.data?.name;
      assert.ok(expectedServerName, 'Expected to fetch game server name from API');

      const { success, logs } = await triggerBroadcast();

      assert.equal(success, true, `Expected success, logs: ${JSON.stringify(logs)}`);

      // The send log should contain the rendered message (no literal curly braces for known placeholders)
      const sendLog = logs.find((l) => l.includes('server-messages: sending message'));
      assert.ok(sendLog, `Expected a "sending message" log, got: ${JSON.stringify(logs)}`);
      assert.ok(
        !sendLog.includes('{playerCount}'),
        `Expected {playerCount} to be rendered, got: ${sendLog}`,
      );
      assert.ok(
        !sendLog.includes('{serverName}'),
        `Expected {serverName} to be rendered, got: ${sendLog}`,
      );
      // playerCount should be a non-zero number (players are online)
      assert.match(
        sendLog,
        /Online: \d+ on /,
        `Expected rendered playerCount in send log, got: ${sendLog}`,
      );
      // Assert the actual configured server name appears in the rendered output
      assert.ok(
        sendLog.includes(expectedServerName),
        `Expected server name "${expectedServerName}" in send log, got: ${sendLog}`,
      );
    } finally {
      await uninstallModule(client, moduleId, ctx!.gameServer.id);
    }
  });

  // ---- Test: unknown placeholders are left unchanged (VI-11: assert specific warn log) ----

  it('unknown placeholders are left unchanged and trigger a warn log', async () => {
    await installWithConfig(client, versionId, ctx!.gameServer.id, {
      messages: [
        { text: 'Hello {unknownPlaceholder} and {playerCount}' },
      ],
      order: 'sequential',
    });
    try {
      await clearModuleVariables();

      const { success, logs } = await triggerBroadcast();

      assert.equal(success, true, `Expected success, logs: ${JSON.stringify(logs)}`);

      const sendLog = logs.find((l) => l.includes('server-messages: sending message'));
      assert.ok(sendLog, `Expected a "sending message" log, got: ${JSON.stringify(logs)}`);
      assert.ok(
        sendLog.includes('{unknownPlaceholder}'),
        `Expected unknown placeholder to remain unchanged, got: ${sendLog}`,
      );
      assert.ok(
        !sendLog.includes('{playerCount}'),
        `Expected known placeholder {playerCount} to be rendered, got: ${sendLog}`,
      );

      // VI-11: assert the specific warn log line appears
      const warnLog = logs.find(
        (l) => l.includes('unrecognised placeholders') && l.includes('{unknownPlaceholder}'),
      );
      assert.ok(
        warnLog,
        `Expected "unrecognised placeholders" warn log mentioning {unknownPlaceholder}, got: ${JSON.stringify(logs)}`,
      );

      // VI-3: known placeholders should NOT appear in the warn line
      // (even if {serverName} failed to resolve, it should NOT be warned as "unrecognised")
      assert.ok(
        !warnLog.includes('{playerCount}') && !warnLog.includes('{serverName}'),
        `Warn log should not mention known placeholders, got: ${warnLog}`,
      );
    } finally {
      await uninstallModule(client, moduleId, ctx!.gameServer.id);
    }
  });

  // ---- Test: random mode — weighted shuffle-bag ----

  it('random mode — each weighted slot consumed exactly once per bag cycle', async () => {
    // 3 messages: weight 1, 2, 1 → bag of size 4: ['Msg A', 'Msg B', 'Msg B', 'Msg C'] shuffled
    await installWithConfig(client, versionId, ctx!.gameServer.id, {
      messages: [
        { text: 'Msg A', weight: 1 },
        { text: 'Msg B', weight: 2 },
        { text: 'Msg C', weight: 1 },
      ],
      order: 'random',
    });
    try {
      await clearModuleVariables();

      // Trigger exactly 4 times — one full bag cycle
      const indicesSeen: number[] = [];
      for (let i = 0; i < 4; i++) {
        const { success, logs } = await triggerBroadcast();
        assert.equal(success, true, `Expected success on trigger ${i}, logs: ${JSON.stringify(logs)}`);

        const logLine = logs.find((l) => l.includes('messageIndex='));
        assert.ok(logLine, `Expected messageIndex log on trigger ${i}, got: ${JSON.stringify(logs)}`);

        const match = logLine.match(/messageIndex=(\d+)/);
        assert.ok(match, `Expected to parse messageIndex from log: ${logLine}`);
        indicesSeen.push(parseInt(match[1]!, 10));
      }

      // After one full bag cycle (4 triggers), we expect:
      // - index 0 (Msg A, weight 1) appears 1 time
      // - index 1 (Msg B, weight 2) appears 2 times
      // - index 2 (Msg C, weight 1) appears 1 time
      const count0 = indicesSeen.filter((i) => i === 0).length;
      const count1 = indicesSeen.filter((i) => i === 1).length;
      const count2 = indicesSeen.filter((i) => i === 2).length;

      assert.equal(
        count0,
        1,
        `Expected index 0 (weight 1) exactly once in bag cycle, saw: ${count0}, full sequence: ${JSON.stringify(indicesSeen)}`,
      );
      assert.equal(
        count1,
        2,
        `Expected index 1 (weight 2) exactly twice in bag cycle, saw: ${count1}, full sequence: ${JSON.stringify(indicesSeen)}`,
      );
      assert.equal(
        count2,
        1,
        `Expected index 2 (weight 1) exactly once in bag cycle, saw: ${count2}, full sequence: ${JSON.stringify(indicesSeen)}`,
      );
    } finally {
      await uninstallModule(client, moduleId, ctx!.gameServer.id);
    }
  });

  it('random mode — rebuilds bag after exhaustion (second cycle also has correct counts)', async () => {
    // 2 messages: weight 2, 1 → bag of size 3: ['Heavy', 'Heavy', 'Light'] shuffled
    await installWithConfig(client, versionId, ctx!.gameServer.id, {
      messages: [
        { text: 'Heavy', weight: 2 },
        { text: 'Light', weight: 1 },
      ],
      order: 'random',
    });
    try {
      await clearModuleVariables();

      // Trigger 6 times = 2 full cycles
      const indicesSeen: number[] = [];
      for (let i = 0; i < 6; i++) {
        const { success, logs } = await triggerBroadcast();
        assert.equal(success, true, `Expected success on trigger ${i}, logs: ${JSON.stringify(logs)}`);
        const logLine = logs.find((l) => l.includes('messageIndex='));
        assert.ok(logLine, `Expected messageIndex log on trigger ${i}`);
        const match = logLine.match(/messageIndex=(\d+)/);
        assert.ok(match, `Expected to parse messageIndex from log: ${logLine}`);
        indicesSeen.push(parseInt(match[1]!, 10));
      }

      // Across 2 cycles of size 3 = 6 total, expect: index 0 × 4, index 1 × 2
      const count0 = indicesSeen.filter((i) => i === 0).length;
      const count1 = indicesSeen.filter((i) => i === 1).length;

      assert.equal(
        count0,
        4,
        `Expected index 0 (weight 2) 4 times across 2 cycles, saw: ${count0}, full: ${JSON.stringify(indicesSeen)}`,
      );
      assert.equal(
        count1,
        2,
        `Expected index 1 (weight 1) 2 times across 2 cycles, saw: ${count1}, full: ${JSON.stringify(indicesSeen)}`,
      );
    } finally {
      await uninstallModule(client, moduleId, ctx!.gameServer.id);
    }
  });

  // ---- Test: no immediate repeat within bag (VI-5: strengthened) ----

  it('random mode — shuffle is effective: across N cycles, not all orderings are identical', async () => {
    // 3 equal-weight messages → bag of exactly ['Alpha', 'Beta', 'Gamma'] texts (in some shuffled order).
    // A no-op shuffler returning the same order every time would make ALL cycles identical.
    // Probability math: there are 3! = 6 equally-likely permutations of 3 elements.
    // Probability that N cycles are ALL identical = (1/6)^(N-1).
    //   N=3 → (1/6)^2 ≈ 2.78% false-fail rate (too high for CI)
    //   N=4 → (1/6)^3 ≈ 0.46% false-fail rate (acceptable; adds ~15s wall-clock vs N=3)
    //   N=5 → (1/6)^4 ≈ 0.077% — reliable but adds another ~27s; not needed
    // We use N=4 as the sweet spot: reliable enough for CI while keeping runtime bounded.
    const N_CYCLES = 4;
    const BAG_SIZE = 3;
    await installWithConfig(client, versionId, ctx!.gameServer.id, {
      messages: [
        { text: 'Alpha', weight: 1 },
        { text: 'Beta', weight: 1 },
        { text: 'Gamma', weight: 1 },
      ],
      order: 'random',
    });
    try {
      await clearModuleVariables();

      const allIndices: number[] = [];
      for (let i = 0; i < N_CYCLES * BAG_SIZE; i++) {
        const { success, logs } = await triggerBroadcast();
        assert.equal(success, true, `Expected success on trigger ${i}, logs: ${JSON.stringify(logs)}`);
        const logLine = logs.find((l) => l.includes('messageIndex='));
        assert.ok(logLine, `Expected messageIndex log on trigger ${i}, got: ${JSON.stringify(logs)}`);
        const match = logLine.match(/messageIndex=(\d+)/);
        assert.ok(match, `Expected to parse messageIndex: ${logLine}`);
        allIndices.push(parseInt(match[1]!, 10));
      }

      // Split into per-cycle sequences
      const cycles: number[][] = [];
      for (let c = 0; c < N_CYCLES; c++) {
        cycles.push(allIndices.slice(c * BAG_SIZE, c * BAG_SIZE + BAG_SIZE));
      }

      // VI-5: assert that not ALL cycles have the identical ordering (no-op shuffle check)
      // (Within-cycle back-to-back repeat check is omitted: with 3 distinct equal-weight entries,
      // no permutation has adjacent repeats by definition — the check would be vacuous.)
      const firstCycleStr = JSON.stringify(cycles[0]);
      const allSame = cycles.every((c) => JSON.stringify(c) === firstCycleStr);
      assert.ok(
        !allSame,
        `All ${N_CYCLES} cycles have identical ordering ${firstCycleStr} — shuffle appears to be a no-op. ` +
          `Full sequence: ${JSON.stringify(allIndices)}`,
      );
    } finally {
      await uninstallModule(client, moduleId, ctx!.gameServer.id);
    }
  });

  // ---- Test: config change resets state ----

  it('config change resets sequential index to 0 (via reinstall)', async () => {
    // Install with 3 messages
    await installWithConfig(client, versionId, ctx!.gameServer.id, {
      messages: [
        { text: 'First' },
        { text: 'Second' },
        { text: 'Third' },
      ],
      order: 'sequential',
    });
    try {
      await clearModuleVariables();

      // Advance to index 2
      await triggerBroadcast(); // sends index 0
      await triggerBroadcast(); // sends index 1
      const { logs: atTwo } = await triggerBroadcast(); // sends index 2
      assert.ok(
        atTwo.some((l) => l.includes('index=2')),
        `Expected third trigger to send index=2, got: ${JSON.stringify(atTwo)}`,
      );

      // Reinstall with a modified message list (triggers config change).
      // Add settle delay after each operation to give Takaro time to propagate
      // the uninstall/reinstall before the next trigger reads the new config.
      await uninstallModule(client, moduleId, ctx!.gameServer.id);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await installWithConfig(client, versionId, ctx!.gameServer.id, {
        messages: [
          { text: 'NewFirst' },
          { text: 'NewSecond' },
        ],
        order: 'sequential',
      });
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // The config hash change (or re-initialization if variables were cleared) should
      // result in either "config changed" or "initializing state" — both mean a reset.
      // The index resets to 0 in both cases.
      const { logs: afterReset } = await triggerBroadcast();
      assert.ok(
        afterReset.some(
          (l) =>
            l.includes('config changed') ||
            l.includes('initializing state'),
        ),
        `Expected config-change reset log (or initializing state) after reinstall, got: ${JSON.stringify(afterReset)}`,
      );
      assert.ok(
        afterReset.some((l) => l.includes('index=0')),
        `Expected index to reset to 0 after config change, got: ${JSON.stringify(afterReset)}`,
      );
    } finally {
      await uninstallModule(client, moduleId, ctx!.gameServer.id);
    }
  });

  it('config change resets sequential index to 0 (via in-place update)', async () => {
    // Install with 3 messages
    await installWithConfig(client, versionId, ctx!.gameServer.id, {
      messages: [
        { text: 'Alpha' },
        { text: 'Beta' },
        { text: 'Gamma' },
      ],
      order: 'sequential',
    });
    try {
      await clearModuleVariables();

      // Advance index to 2
      await triggerBroadcast(); // index 0
      await triggerBroadcast(); // index 1
      const { logs: atTwo } = await triggerBroadcast(); // index 2
      assert.ok(
        atTwo.some((l) => l.includes('index=2')),
        `Expected third trigger at index=2, got: ${JSON.stringify(atTwo)}`,
      );

      // In-place update: reinstall with new userConfig on the same installation
      // (moduleInstallationsControllerInstallModule on an already-installed module
      // replaces the config, which triggers the hash-mismatch reset path).
      // Add a settle delay so Takaro propagates the config update before the
      // next trigger reads mod.userConfig in the function sandbox.
      await client.module.moduleInstallationsControllerInstallModule({
        versionId,
        gameServerId: ctx!.gameServer.id,
        userConfig: JSON.stringify({
          messages: [
            { text: 'Delta' },
            { text: 'Epsilon' },
            { text: 'Zeta' },
          ],
          order: 'sequential',
        }),
      });
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // First trigger after in-place update: hash-mismatch → reset → index=0.
      // "config changed" / "initializing state" are both acceptable reset indicators.
      const { logs: afterInPlaceReset } = await triggerBroadcast();
      assert.ok(
        afterInPlaceReset.some(
          (l) =>
            l.includes('config changed') ||
            l.includes('initializing state'),
        ),
        `Expected config-change reset log (or initializing state) after in-place update, got: ${JSON.stringify(afterInPlaceReset)}`,
      );
      assert.ok(
        afterInPlaceReset.some((l) => l.includes('index=0')),
        `Expected index to reset to 0 after in-place update, got: ${JSON.stringify(afterInPlaceReset)}`,
      );
    } finally {
      await uninstallModule(client, moduleId, ctx!.gameServer.id);
    }
  });

  it('config weight change resets random bag state', async () => {
    // Install with equal weights first
    await installWithConfig(client, versionId, ctx!.gameServer.id, {
      messages: [
        { text: 'Alpha', weight: 1 },
        { text: 'Beta', weight: 1 },
      ],
      order: 'random',
    });
    try {
      await clearModuleVariables();

      // Consume one slot
      await triggerBroadcast();

      // In-place update with changed weights (Alpha=3, Beta=1 → bag of 4).
      // Using in-place update (instead of uninstall+reinstall) avoids any question
      // of whether Takaro clears variables on uninstall — variables are guaranteed
      // to persist through an in-place config update.
      // Add a settle delay so Takaro propagates the new config before the trigger.
      await client.module.moduleInstallationsControllerInstallModule({
        versionId,
        gameServerId: ctx!.gameServer.id,
        userConfig: JSON.stringify({
          messages: [
            { text: 'Alpha', weight: 3 },
            { text: 'Beta', weight: 1 },
          ],
          order: 'random',
        }),
      });
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // First trigger after change should log config reset
      const { success, logs: resetLogs } = await triggerBroadcast();
      assert.equal(success, true, `Expected success after weight change, logs: ${JSON.stringify(resetLogs)}`);
      assert.ok(
        resetLogs.some((l) => l.includes('config changed')),
        `Expected config-change reset log after weight change, got: ${JSON.stringify(resetLogs)}`,
      );

      // After reset, bag is rebuilt from scratch with new weights [Alpha×3, Beta×1]
      // Collect this trigger's messageIndex + 3 more to complete one full 4-slot bag
      const firstIndexMatch = resetLogs.find((l) => l.includes('messageIndex='))?.match(/messageIndex=(\d+)/);
      assert.ok(firstIndexMatch, `Expected messageIndex in reset trigger logs: ${JSON.stringify(resetLogs)}`);
      const indicesSeen: number[] = [parseInt(firstIndexMatch[1]!, 10)];

      for (let i = 0; i < 3; i++) {
        const { success: s, logs: l } = await triggerBroadcast();
        assert.equal(s, true, `Expected success on follow-up trigger ${i}`);
        const m = l.find((line) => line.includes('messageIndex='))?.match(/messageIndex=(\d+)/);
        assert.ok(m, `Expected messageIndex log on trigger ${i}: ${JSON.stringify(l)}`);
        indicesSeen.push(parseInt(m[1]!, 10));
      }

      // Verify the new weighted bag: Alpha (index 0) × 3, Beta (index 1) × 1
      const countAlpha = indicesSeen.filter((i) => i === 0).length;
      const countBeta = indicesSeen.filter((i) => i === 1).length;
      assert.equal(
        countAlpha,
        3,
        `Expected Alpha (index 0, weight 3) 3 times in new bag, saw: ${countAlpha}, full: ${JSON.stringify(indicesSeen)}`,
      );
      assert.equal(
        countBeta,
        1,
        `Expected Beta (index 1, weight 1) 1 time in new bag, saw: ${countBeta}, full: ${JSON.stringify(indicesSeen)}`,
      );
    } finally {
      await uninstallModule(client, moduleId, ctx!.gameServer.id);
    }
  });

  // ---- Test: VI-9 — weight-in-sequential warn fires on install/config-change ----

  it('sequential mode with weight fields — emits warn on state initialization', async () => {
    await installWithConfig(client, versionId, ctx!.gameServer.id, {
      messages: [
        { text: 'Msg X', weight: 5 },
        { text: 'Msg Y', weight: 1 },
      ],
      order: 'sequential',
    });
    try {
      await clearModuleVariables();

      // First trigger initializes state → should emit the "weight fields ignored" warn
      const { success, logs } = await triggerBroadcast();
      assert.equal(success, true, `Expected success, logs: ${JSON.stringify(logs)}`);

      const warnLog = logs.find(
        (l) => l.includes('order=sequential') && l.includes('weight') && l.includes('ignored'),
      );
      assert.ok(
        warnLog,
        `Expected "order=sequential — weight fields on messages are ignored" warn on first trigger, got: ${JSON.stringify(logs)}`,
      );

      // Second trigger should NOT emit the warn again (fires only on state-init/reset)
      const { logs: logs2 } = await triggerBroadcast();
      const warnLog2 = logs2.find(
        (l) => l.includes('order=sequential') && l.includes('weight') && l.includes('ignored'),
      );
      assert.ok(
        !warnLog2,
        `Expected weight-ignored warn to NOT fire on second trigger (only on state-init), got: ${JSON.stringify(logs2)}`,
      );
    } finally {
      await uninstallModule(client, moduleId, ctx!.gameServer.id);
    }
  });

  // ---- Test: VI-6 — send failure does NOT advance state ----
  //
  // The plan invariant: "skip ticks without advancing state when nothing is actually sent."
  // After the VI-4 fix, sendMessage exceptions propagate and the cronjob is marked failed.
  // We cannot force sendMessage to fail in the real test harness without mocking internals
  // (which is prohibited by the repo's testing philosophy). Instead:
  // - We verify that a successful send DOES advance state (covered by sequential/random tests above).
  // - We document the invariant here and in a comment in the production code (broadcast/index.js).
  //
  // UNTESTABLE INVARIANT: "send failure does not advance state" requires the test harness to
  // inject a sendMessage failure. The repo prohibits mock-based unit tests (see AGENTS.md /
  // testing philosophy). This invariant is enforced purely in the production code:
  // `setSeqIndex` / `setBagState` is called only AFTER `gameServerControllerSendMessage` succeeds.

  // ---- Test: VI-12 — order-change does NOT invalidate state (random mode) ----

  it('random mode — changing message order (not content/weights) does not reset bag state', async () => {
    // Install with [A, B, C] all equal weight
    await installWithConfig(client, versionId, ctx!.gameServer.id, {
      messages: [
        { text: 'Msg A', weight: 1 },
        { text: 'Msg B', weight: 1 },
        { text: 'Msg C', weight: 1 },
      ],
      order: 'random',
    });
    try {
      await clearModuleVariables();

      // Consume 2 entries from the bag
      const { logs: logs0 } = await triggerBroadcast();
      const { logs: logs1 } = await triggerBroadcast();
      const idx0 = parseInt(logs0.find((l) => l.includes('messageIndex='))!.match(/messageIndex=(\d+)/)![1]!, 10);
      const idx1 = parseInt(logs1.find((l) => l.includes('messageIndex='))!.match(/messageIndex=(\d+)/)![1]!, 10);

      // Track the TEXT of the two consumed entries so we can verify the third is correct
      const msgTexts = ['Msg A', 'Msg B', 'Msg C'];
      const text0 = msgTexts[idx0]!;
      const text1 = msgTexts[idx1]!;
      const consumed = new Set([text0, text1]);
      const expectedRemainingText = msgTexts.find((t) => !consumed.has(t))!;

      // Reinstall with a DIFFERENT ordering of the same messages/weights (no actual change to content).
      // computeConfigHash for random mode sorts canonically, so a cosmetic reorder = same hash.
      await uninstallModule(client, moduleId, ctx!.gameServer.id);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await installWithConfig(client, versionId, ctx!.gameServer.id, {
        messages: [
          { text: 'Msg C', weight: 1 },
          { text: 'Msg A', weight: 1 },
          { text: 'Msg B', weight: 1 },
        ],
        order: 'random',
      });
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Trigger once — since the canonical hash is the same, state should NOT be reset
      const { logs: logs2 } = await triggerBroadcast();
      assert.ok(
        !logs2.some((l) => l.includes('config changed')),
        `Expected NO config-change reset log when only message order changes (same content+weights), got: ${JSON.stringify(logs2)}`,
      );
      // Belt-and-suspenders: also verify no silent re-init occurred
      assert.ok(
        !logs2.some((l) => l.includes('initializing state')),
        `Expected NO "initializing state" log when only message order changes, got: ${JSON.stringify(logs2)}`,
      );

      // The key invariant: bag stores TEXTS, so after cosmetic reorder the bag still refers
      // to the same messages by text. The 3rd trigger should send the one remaining text
      // that was NOT consumed in trigger 0 or 1, regardless of its new array position.
      const sendLog2 = logs2.find((l) => l.includes('server-messages: sending message'));
      assert.ok(
        sendLog2,
        `Expected a "sending message" log on 3rd trigger after reorder, got: ${JSON.stringify(logs2)}`,
      );
      assert.ok(
        sendLog2.includes(expectedRemainingText),
        `Expected 3rd trigger to send the remaining message text "${expectedRemainingText}" ` +
          `(consumed so far: ${JSON.stringify([text0, text1])}), got send log: ${sendLog2}. ` +
          `All logs: ${JSON.stringify(logs2)}`,
      );
    } finally {
      await uninstallModule(client, moduleId, ctx!.gameServer.id);
    }
  });

  // ---- Test: VI-13 — resolveServerName API-fail path ----
  //
  // This test cannot be implemented deterministically in the real-API harness: forcing
  // gameServerControllerGetOne to fail would require either intercepting the network
  // (prohibited by the no-mock policy) or deleting the game server mid-test (which breaks
  // the entire suite). The behavior is covered by:
  // 1. Production code: resolveServerName catches the error, logs it, and leaves
  //    {serverName} unchanged in the text.
  // 2. checkUnknownPlaceholders' allowlist (KNOWN_PLACEHOLDERS) ensures {serverName} does
  //    NOT appear in the "unrecognised placeholders" warn line — so there are no two
  //    contradictory log lines.
  // See modules/server-messages/src/cronjobs/broadcast/index.js for the implementation.

  // ---- Test: VI-4 — sequential OOB recovery ----

  it('sequential OOB recovery: stale index beyond message list resets to 0 and sends first message', async () => {
    // Install with 1 message
    await installWithConfig(client, versionId, ctx!.gameServer.id, {
      messages: [{ text: 'Only Message' }],
      order: 'sequential',
    });
    try {
      await clearModuleVariables();

      // Trigger once to initialize state normally (hash written + index=0).
      // We need the hash to exist so the next trigger won't re-init and overwrite our
      // stale index. The stale index is planted via variableControllerUpdate (not Create)
      // because the variable already exists after this first trigger.
      const { logs: initLogs } = await triggerBroadcast();
      assert.ok(
        initLogs.some((l) => l.includes('index=0')),
        `Expected initial trigger at index=0, got: ${JSON.stringify(initLogs)}`,
      );

      // Plant a stale sm_seq_index=5 (way out of range for a 1-message list).
      // This simulates old state surviving a config change that removed messages — e.g. a
      // prior 6-message config left index=5 in the variable. The hash is unchanged (same
      // 1-message config), so only the OOB recovery path handles it.
      // Using variableControllerUpdate on the existing variable (created by the first trigger).
      const staleVars = await client.variable.variableControllerSearch({
        filters: {
          key: ['sm_seq_index'],
          moduleId: [moduleId],
          gameServerId: [ctx!.gameServer.id],
        },
      });
      assert.ok(staleVars.data.data.length > 0, 'Expected sm_seq_index variable to exist after first trigger');
      const seqVar = staleVars.data.data[0]!;
      await client.variable.variableControllerUpdate(seqVar.id, { value: JSON.stringify(5) });

      // Trigger — OOB guard should log a warning, send message[0] ("Only Message"), and set index to 0
      const { success, logs } = await triggerBroadcast();
      assert.equal(success, true, `Expected success after OOB recovery, logs: ${JSON.stringify(logs)}`);

      const oobWarnLog = logs.find(
        (l) => l.includes('out of range') && l.includes('resetting to 0'),
      );
      assert.ok(
        oobWarnLog,
        `Expected OOB warn log mentioning "out of range" and "resetting to 0", got: ${JSON.stringify(logs)}`,
      );

      const sendLog = logs.find((l) => l.includes('server-messages: sending message'));
      assert.ok(sendLog, `Expected a "sending message" log after OOB recovery, got: ${JSON.stringify(logs)}`);
      assert.ok(
        sendLog.includes('Only Message'),
        `Expected OOB recovery to send first message "Only Message", got: ${sendLog}`,
      );

      // Post-recovery advancement: a second trigger after OOB recovery must continue
      // advancing normally. For a 1-message list, nextIndex = (0 + 1) % 1 = 0 (wraps).
      // Verify: the send succeeds, no OOB warn appears (the stale index is gone), and
      // the index is 0 again (wrapped back to start).
      const { success: success2, logs: logs2 } = await triggerBroadcast();
      assert.equal(success2, true, `Expected success on post-recovery trigger, logs: ${JSON.stringify(logs2)}`);
      assert.ok(
        !logs2.some((l) => l.includes('out of range')),
        `Expected NO OOB warn on post-recovery trigger (index was properly reset), got: ${JSON.stringify(logs2)}`,
      );
      assert.ok(
        logs2.some((l) => l.includes('index=0')),
        `Expected post-recovery trigger to send index=0 (wrapped back for 1-message list), got: ${JSON.stringify(logs2)}`,
      );
      const sendLog2 = logs2.find((l) => l.includes('server-messages: sending message'));
      assert.ok(sendLog2, `Expected a "sending message" log on post-recovery trigger, got: ${JSON.stringify(logs2)}`);
    } finally {
      await uninstallModule(client, moduleId, ctx!.gameServer.id);
    }
  });

  // ---- Test: VI-7 — random mode OOB recovery ----

  it('random mode OOB recovery: stale bag cursor with unknown text triggers bag rebuild and continues', async () => {
    // Install with 3 equal-weight messages
    await installWithConfig(client, versionId, ctx!.gameServer.id, {
      messages: [
        { text: 'Rand A', weight: 1 },
        { text: 'Rand B', weight: 1 },
        { text: 'Rand C', weight: 1 },
      ],
      order: 'random',
    });
    try {
      await clearModuleVariables();

      // Trigger once to initialize the bag state (creates sm_bag variable via production code)
      const { logs: initLogs } = await triggerBroadcast();
      assert.ok(
        initLogs.some((l) => l.includes('random mode')),
        `Expected random mode log on first trigger, got: ${JSON.stringify(initLogs)}`,
      );

      // Plant a stale bag with a 'GHOST' text that doesn't exist in the message list.
      // cursor=0 means the very next read will immediately hit the stale entry.
      // This simulates a corrupt/stale variable written by an older version of the module.
      const bagVars = await client.variable.variableControllerSearch({
        filters: {
          key: ['sm_bag'],
          moduleId: [moduleId],
          gameServerId: [ctx!.gameServer.id],
        },
      });
      assert.ok(bagVars.data.data.length > 0, 'Expected sm_bag variable to exist after first trigger');
      const bagVar = bagVars.data.data[0]!;
      const staleBag = { bag: ['GHOST', 'Rand A', 'Rand B'], cursor: 0 };
      await client.variable.variableControllerUpdate(bagVar.id, { value: JSON.stringify(staleBag) });

      // Trigger — OOB guard should detect 'GHOST' is not in the message list, log a warn,
      // rebuild the bag, and send a valid message.
      const { success, logs } = await triggerBroadcast();
      assert.equal(success, true, `Expected success after random OOB recovery, logs: ${JSON.stringify(logs)}`);

      const oobWarnLog = logs.find(
        (l) => l.includes('stale text') && l.includes('rebuilding bag'),
      );
      assert.ok(
        oobWarnLog,
        `Expected OOB warn log mentioning "stale text" and "rebuilding bag", got: ${JSON.stringify(logs)}`,
      );

      const sendLog = logs.find((l) => l.includes('server-messages: sending message'));
      assert.ok(sendLog, `Expected a "sending message" log after random OOB recovery, got: ${JSON.stringify(logs)}`);
      // The sent message should be one of the valid texts (not 'GHOST')
      const validTexts = ['Rand A', 'Rand B', 'Rand C'];
      assert.ok(
        validTexts.some((t) => sendLog.includes(t)),
        `Expected OOB recovery to send a valid message (one of ${JSON.stringify(validTexts)}), got: ${sendLog}`,
      );

      // Post-recovery: a second trigger must continue normal operation after the rebuild.
      // No OOB warn should appear, no bag-rebuild should occur (state was persisted), and a valid message must be sent.
      const { success: success2, logs: logs2 } = await triggerBroadcast();
      assert.equal(success2, true, `Expected success on post-recovery trigger, logs: ${JSON.stringify(logs2)}`);
      assert.ok(
        !logs2.some((l) => l.includes('stale text')),
        `Expected NO OOB warn on post-recovery trigger (bag was properly rebuilt), got: ${JSON.stringify(logs2)}`,
      );
      // If state was not persisted correctly, the bag would be rebuilt again on this trigger.
      // Assert that "rebuilding bag" does NOT appear — proving the bag state was saved after recovery.
      assert.ok(
        !logs2.some((l) => l.includes('rebuilding bag')),
        `Expected NO "rebuilding bag" log on post-recovery 2nd trigger (bag state should be persisted from recovery), got: ${JSON.stringify(logs2)}`,
      );
      const sendLog2 = logs2.find((l) => l.includes('server-messages: sending message'));
      assert.ok(sendLog2, `Expected a "sending message" log on post-recovery trigger, got: ${JSON.stringify(logs2)}`);
      assert.ok(
        validTexts.some((t) => sendLog2.includes(t)),
        `Expected post-recovery trigger to send a valid message, got: ${sendLog2}`,
      );
    } finally {
      await uninstallModule(client, moduleId, ctx!.gameServer.id);
    }
  });

  // ---- Test: VI-6 — duplicate message texts trigger a warn ----

  it('duplicate message texts — emits a warn on state initialization', async () => {
    await installWithConfig(client, versionId, ctx!.gameServer.id, {
      messages: [
        { text: 'Duplicate', weight: 1 },
        { text: 'Unique', weight: 1 },
        { text: 'Duplicate', weight: 1 },
      ],
      order: 'sequential',
    });
    try {
      await clearModuleVariables();

      // First trigger initializes state → should emit the duplicate-texts warn
      const { success, logs } = await triggerBroadcast();
      assert.equal(success, true, `Expected success with duplicate texts, logs: ${JSON.stringify(logs)}`);

      const warnLog = logs.find(
        (l) => l.includes('duplicate message texts'),
      );
      assert.ok(
        warnLog,
        `Expected "duplicate message texts" warn on first trigger (state init), got: ${JSON.stringify(logs)}`,
      );

      // Second trigger should NOT emit the warn again (fires only on state-init/reset)
      const { logs: logs2 } = await triggerBroadcast();
      const warnLog2 = logs2.find(
        (l) => l.includes('duplicate message texts'),
      );
      assert.ok(
        !warnLog2,
        `Expected duplicate-texts warn to NOT fire on second trigger (only on state-init), got: ${JSON.stringify(logs2)}`,
      );
    } finally {
      await uninstallModule(client, moduleId, ctx!.gameServer.id);
    }
  });

  // ---- Test: VI-6 (random mode) — duplicate texts in random mode warn fires and bag behaves correctly ----

  it('duplicate message texts in random mode — warn fires on state init, bag size matches sum of weights, A appears ~2x more often than B', async () => {
    // [A, B, A] with weights [1, 1, 1] → bag texts = ['A', 'B', 'A'] (size 3).
    // After one full cycle (3 triggers), A should appear exactly 2 times, B exactly 1 time.
    await installWithConfig(client, versionId, ctx!.gameServer.id, {
      messages: [
        { text: 'A', weight: 1 },
        { text: 'B', weight: 1 },
        { text: 'A', weight: 1 },
      ],
      order: 'random',
    });
    try {
      await clearModuleVariables();

      // First trigger initializes state → should emit the duplicate-texts warn
      const { success: s0, logs: logs0 } = await triggerBroadcast();
      assert.equal(s0, true, `Expected success on first trigger, logs: ${JSON.stringify(logs0)}`);

      const warnLog = logs0.find((l) => l.includes('duplicate message texts'));
      assert.ok(
        warnLog,
        `Expected "duplicate message texts" warn on state init (random mode), got: ${JSON.stringify(logs0)}`,
      );

      // Collect the first trigger's sent text and two more triggers to complete the bag cycle
      const sentTexts: string[] = [];

      // Extract sent text from the sending log of each trigger
      const extractSentText = (logs: string[]): string => {
        const sendLog = logs.find((l) => l.includes('server-messages: sending message'));
        assert.ok(sendLog, `Expected "sending message" log, got: ${JSON.stringify(logs)}`);
        // Log format: "server-messages: sending message index=N: <text>"
        const match = sendLog.match(/sending message index=\d+: (.+)$/);
        assert.ok(match, `Expected to parse sent text from log: ${sendLog}`);
        return match[1]!.trim();
      };

      sentTexts.push(extractSentText(logs0));

      for (let i = 1; i < 3; i++) {
        const { success, logs } = await triggerBroadcast();
        assert.equal(success, true, `Expected success on trigger ${i}, logs: ${JSON.stringify(logs)}`);
        sentTexts.push(extractSentText(logs));
      }

      // After one full bag cycle (3 triggers), bag stores texts: ['A', 'B', 'A'] (shuffled).
      // A must appear exactly 2 times, B exactly 1 time.
      const countA = sentTexts.filter((t) => t === 'A').length;
      const countB = sentTexts.filter((t) => t === 'B').length;

      assert.equal(
        countA,
        2,
        `Expected 'A' to appear 2 times in one bag cycle (combined weight from duplicates), saw: ${countA}, full sequence: ${JSON.stringify(sentTexts)}`,
      );
      assert.equal(
        countB,
        1,
        `Expected 'B' to appear 1 time in one bag cycle, saw: ${countB}, full sequence: ${JSON.stringify(sentTexts)}`,
      );

      // No errors or crashes — the findIndex collapse should not break execution
      // (all 3 triggers above returned success=true, so this is already verified)
    } finally {
      await uninstallModule(client, moduleId, ctx!.gameServer.id);
    }
  });

  // ---- Test: VI-8 — order field change (sequential → random) triggers config reset ----

  it('switching from sequential to random mode triggers config hash reset', async () => {
    // Install with sequential mode, 3 messages
    await installWithConfig(client, versionId, ctx!.gameServer.id, {
      messages: [
        { text: 'Seq A' },
        { text: 'Seq B' },
        { text: 'Seq C' },
      ],
      order: 'sequential',
    });
    try {
      await clearModuleVariables();

      // Advance sequential index to 2
      await triggerBroadcast(); // index 0
      await triggerBroadcast(); // index 1
      const { logs: atTwo } = await triggerBroadcast(); // index 2
      assert.ok(
        atTwo.some((l) => l.includes('index=2')),
        `Expected third trigger at index=2, got: ${JSON.stringify(atTwo)}`,
      );

      // In-place update: switch to random mode with the same messages
      // The `order` field is now included in the config hash, so switching mode = config change.
      await client.module.moduleInstallationsControllerInstallModule({
        versionId,
        gameServerId: ctx!.gameServer.id,
        userConfig: JSON.stringify({
          messages: [
            { text: 'Seq A', weight: 1 },
            { text: 'Seq B', weight: 1 },
            { text: 'Seq C', weight: 1 },
          ],
          order: 'random',
        }),
      });
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // First trigger after mode switch: hash mismatch → reset log → random mode bag built
      const { success, logs: resetLogs } = await triggerBroadcast();
      assert.equal(success, true, `Expected success after mode switch, logs: ${JSON.stringify(resetLogs)}`);
      assert.ok(
        resetLogs.some((l) => l.includes('config changed') || l.includes('initializing state')),
        `Expected config-change reset log after switching order=sequential → random, got: ${JSON.stringify(resetLogs)}`,
      );

      // After reset, should be in random mode (bag built, not sequential index log)
      assert.ok(
        resetLogs.some((l) => l.includes('random mode')),
        `Expected random mode log after switching to order=random, got: ${JSON.stringify(resetLogs)}`,
      );
    } finally {
      await uninstallModule(client, moduleId, ctx!.gameServer.id);
    }
  });
});
