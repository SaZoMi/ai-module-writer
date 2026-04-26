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

// player[0] has REFERRAL_USE (happy-path tests)
// player[1] has no permissions (permission-denied test)

describe('referral-program: /refcode command', () => {
  let client: Client;
  let ctx: MockServerContext;
  let moduleId: string;
  let versionId: string;
  let prefix: string;
  let useRoleId: string | undefined;

  before(async () => {
    client = await createClient();
    await cleanupTestModules(client);
    await cleanupTestGameServers(client);
    ctx = await startMockServer(client);

    await client.settings.settingsControllerSet('economyEnabled', {
      gameServerId: ctx.gameServer.id,
      value: 'true',
    });

    const mod = await pushModule(client, MODULE_DIR);
    moduleId = mod.id;
    versionId = mod.latestVersion.id;

    await installModule(client, versionId, ctx.gameServer.id, {
      userConfig: {
        prizeIsCurrency: true,
        referrerCurrencyReward: 500,
        refereeCurrencyReward: 100,
        playtimeThresholdMinutes: 60,
        referralWindowHours: 24,
        maxReferralsPerDay: 5,
        maxReferralsLifetime: 50,
      },
    });

    prefix = await getCommandPrefix(client, ctx.gameServer.id);

    useRoleId = await assignPermissions(
      client,
      ctx.players[0].playerId,
      ctx.gameServer.id,
      ['REFERRAL_USE'],
    );
  });

  after(async () => {
    await cleanupRole(client, useRoleId);
    try {
      await uninstallModule(client, moduleId, ctx.gameServer.id);
    } catch (err) {
      console.error('Cleanup: failed to uninstall module:', err);
    }
    try {
      await deleteModule(client, moduleId);
    } catch (err) {
      console.error('Cleanup: failed to delete module:', err);
    }
    await stopMockServer(ctx.server, client, ctx.gameServer.id);
  });

  it('should generate a referral code and return existing code on second call (idempotent)', async () => {
    // Combined test: first call generates, second call returns the same code.
    // Merged to eliminate test-order dependency.
    const player = ctx.players[0]!;

    // --- First call: generate code ---
    const before1 = new Date();
    await client.command.commandControllerTrigger(ctx.gameServer.id, {
      msg: `${prefix}refcode`,
      playerId: player.playerId,
    });

    const event1 = await waitForEvent(client, {
      eventName: EventSearchInputAllowedFiltersEventNameEnum.CommandExecuted,
      gameserverId: ctx.gameServer.id,
      after: before1,
      timeout: 30000,
    });

    assert.ok(event1, 'Expected a command-executed event');
    const meta1 = event1.meta as { result?: { success?: boolean; logs?: Array<{ msg: string }> } };
    assert.equal(meta1?.result?.success, true, `Expected command to succeed, logs: ${JSON.stringify(meta1?.result?.logs)}`);

    const logs1 = (meta1?.result?.logs ?? []).map((l) => l.msg);
    assert.ok(
      logs1.some((msg) => msg.includes('generated code=')),
      `Expected log to include "generated code=", got: ${JSON.stringify(logs1)}`,
    );

    // Verify variable was stored
    const codeVars = await client.variable.variableControllerSearch({
      filters: {
        key: ['referral_code'],
        gameServerId: [ctx.gameServer.id],
        moduleId: [moduleId],
        playerId: [player.playerId],
      },
    });
    assert.equal(codeVars.data.data.length, 1, 'Expected referral_code variable to be created');
    const storedCode = JSON.parse(codeVars.data.data[0].value);
    assert.ok(storedCode.code, 'Expected stored code to have a code property');
    assert.equal(storedCode.code.length, 6, 'Expected code to be 6 characters');

    // --- Second call: should return existing code (idempotent) ---
    const before2 = new Date();
    await client.command.commandControllerTrigger(ctx.gameServer.id, {
      msg: `${prefix}refcode`,
      playerId: player.playerId,
    });

    const event2 = await waitForEvent(client, {
      eventName: EventSearchInputAllowedFiltersEventNameEnum.CommandExecuted,
      gameserverId: ctx.gameServer.id,
      after: before2,
      timeout: 30000,
    });

    const meta2 = event2.meta as { result?: { success?: boolean; logs?: Array<{ msg: string }> } };
    assert.equal(meta2?.result?.success, true, `Expected command to succeed on second call`);

    const logs2 = (meta2?.result?.logs ?? []).map((l) => l.msg);
    assert.ok(
      logs2.some((msg) => msg.includes('existing code=')),
      `Expected log to include "existing code=", got: ${JSON.stringify(logs2)}`,
    );

    // Still only one variable for this player
    const codeVarsAfter = await client.variable.variableControllerSearch({
      filters: {
        key: ['referral_code'],
        gameServerId: [ctx.gameServer.id],
        moduleId: [moduleId],
        playerId: [player.playerId],
      },
    });
    assert.equal(codeVarsAfter.data.data.length, 1, 'Expected only one referral_code variable (idempotent)');
  });

  it('should deny /refcode without REFERRAL_USE permission', async () => {
    // player[1] has no permissions
    const player = ctx.players[1]!;
    const before = new Date();

    await client.command.commandControllerTrigger(ctx.gameServer.id, {
      msg: `${prefix}refcode`,
      playerId: player.playerId,
    });

    const event = await waitForEvent(client, {
      eventName: EventSearchInputAllowedFiltersEventNameEnum.CommandExecuted,
      gameserverId: ctx.gameServer.id,
      after: before,
      timeout: 30000,
    });

    const meta = event.meta as { result?: { success?: boolean; logs?: Array<{ msg: string }> } };
    assert.equal(meta?.result?.success, false, 'Expected command to fail without permission');

    const logs = (meta?.result?.logs ?? []).map((l) => l.msg);
    assert.ok(
      logs.some((msg) => msg.toLowerCase().includes('permission')),
      `Expected permission-denied message, got: ${JSON.stringify(logs)}`,
    );
  });
});
