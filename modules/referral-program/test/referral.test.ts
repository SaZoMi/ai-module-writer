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
import { pollUntil } from '../../../test/helpers/poll.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MODULE_DIR = path.resolve(__dirname, '..');

// player[0] = referrer (REFERRAL_USE)
// player[1] = referee (REFERRAL_USE) — will use player[0]'s code
// player[2] = unpermissioned player (no permissions)

describe('referral-program: /referral command', () => {
  let client: Client;
  let ctx: MockServerContext;
  let moduleId: string;
  let versionId: string;
  let prefix: string;
  let useRoleId: string | undefined;
  let refereeRoleId: string | undefined;
  let aliceCode: string;

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
        playtimeThresholdMinutes: 1, // Very low for testing
        referralWindowHours: 24,
        maxReferralsPerDay: 5,
        maxReferralsLifetime: 50,
      },
    });

    prefix = await getCommandPrefix(client, ctx.gameServer.id);

    // Grant REFERRAL_USE to player[0] (referrer)
    useRoleId = await assignPermissions(
      client,
      ctx.players[0].playerId,
      ctx.gameServer.id,
      ['REFERRAL_USE'],
    );

    // Grant REFERRAL_USE to player[1] (referee)
    refereeRoleId = await assignPermissions(
      client,
      ctx.players[1].playerId,
      ctx.gameServer.id,
      ['REFERRAL_USE'],
    );

    // Generate player[0]'s referral code
    const beforeCode = new Date();
    await client.command.commandControllerTrigger(ctx.gameServer.id, {
      msg: `${prefix}refcode`,
      playerId: ctx.players[0].playerId,
    });
    await waitForEvent(client, {
      eventName: EventSearchInputAllowedFiltersEventNameEnum.CommandExecuted,
      gameserverId: ctx.gameServer.id,
      after: beforeCode,
      timeout: 30000,
    });

    // Read the generated code from variables
    const codeVars = await client.variable.variableControllerSearch({
      filters: {
        key: ['referral_code'],
        gameServerId: [ctx.gameServer.id],
        moduleId: [moduleId],
        playerId: [ctx.players[0].playerId],
      },
    });
    assert.equal(codeVars.data.data.length, 1, 'Expected referral_code variable to be created for player[0]');
    aliceCode = JSON.parse(codeVars.data.data[0].value).code;
    assert.ok(aliceCode, 'Expected to extract referral code');
  });

  after(async () => {
    await cleanupRole(client, useRoleId);
    await cleanupRole(client, refereeRoleId);
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

  it('should apply referral code and pay welcome bonus', async () => {
    const referee = ctx.players[1]!;
    const before = new Date();

    // Get balance before
    const pogBefore = await client.playerOnGameserver.playerOnGameServerControllerSearch({
      filters: { gameServerId: [ctx.gameServer.id], playerId: [referee.playerId] },
    });
    const balanceBefore = pogBefore.data.data[0]?.currency ?? 0;

    await client.command.commandControllerTrigger(ctx.gameServer.id, {
      msg: `${prefix}referral ${aliceCode}`,
      playerId: referee.playerId,
    });

    const event = await waitForEvent(client, {
      eventName: EventSearchInputAllowedFiltersEventNameEnum.CommandExecuted,
      gameserverId: ctx.gameServer.id,
      after: before,
      timeout: 30000,
    });

    assert.ok(event, 'Expected a command-executed event');
    const meta = event.meta as { result?: { success?: boolean; logs?: Array<{ msg: string }> } };
    assert.equal(meta?.result?.success, true, `Expected command to succeed, logs: ${JSON.stringify(meta?.result?.logs)}`);

    const logs = (meta?.result?.logs ?? []).map((l) => l.msg);
    assert.ok(
      logs.some((msg) => msg.includes('welcome bonus paid')),
      `Expected log to include "welcome bonus paid", got: ${JSON.stringify(logs)}`,
    );

    // Verify pending link was created
    const linkVars = await client.variable.variableControllerSearch({
      filters: {
        key: ['referral_link'],
        gameServerId: [ctx.gameServer.id],
        moduleId: [moduleId],
        playerId: [referee.playerId],
      },
    });
    assert.equal(linkVars.data.data.length, 1, 'Expected referral_link variable to be created');
    const linkData = JSON.parse(linkVars.data.data[0].value);
    assert.equal(linkData.status, 'pending', 'Expected link status to be pending');
    assert.equal(linkData.referrerId, ctx.players[0].playerId, 'Expected referrerId to match player[0]');

    // Note: referral_pending_index is no longer maintained in the referral command.
    // The sweep uses getAllPendingRefereeIds() which queries referral_link variables directly.

    // Verify balance increased by welcome bonus (100) — poll until balance updates
    const balanceAfter = await pollUntil(
      async () => {
        const pogAfter = await client.playerOnGameserver.playerOnGameServerControllerSearch({
          filters: { gameServerId: [ctx.gameServer.id], playerId: [referee.playerId] },
        });
        const bal = pogAfter.data.data[0]?.currency ?? 0;
        return bal >= balanceBefore + 100 ? bal : null;
      },
      { timeout: 15000, interval: 200 },
    );
    assert.equal(balanceAfter, balanceBefore + 100, `Expected balance to increase by 100, was ${balanceBefore} -> ${balanceAfter}`);
  });

  it('should reject self-referral', async () => {
    // player[0] tries to use their own code
    const referrer = ctx.players[0]!;
    const before = new Date();

    await client.command.commandControllerTrigger(ctx.gameServer.id, {
      msg: `${prefix}referral ${aliceCode}`,
      playerId: referrer.playerId,
    });

    const event = await waitForEvent(client, {
      eventName: EventSearchInputAllowedFiltersEventNameEnum.CommandExecuted,
      gameserverId: ctx.gameServer.id,
      after: before,
      timeout: 30000,
    });

    const meta = event.meta as { result?: { success?: boolean; logs?: Array<{ msg: string }> } };
    assert.equal(meta?.result?.success, false, 'Expected self-referral to be rejected');

    const logs = (meta?.result?.logs ?? []).map((l) => l.msg);
    assert.ok(
      logs.some((msg) => msg.toLowerCase().includes('own referral code')),
      `Expected "own referral code" message, got: ${JSON.stringify(logs)}`,
    );
  });

  it('should reject relink (player[1] already has a link)', async () => {
    // player[1] already used aliceCode in the first test
    const referee = ctx.players[1]!;
    const before = new Date();

    await client.command.commandControllerTrigger(ctx.gameServer.id, {
      msg: `${prefix}referral ${aliceCode}`,
      playerId: referee.playerId,
    });

    const event = await waitForEvent(client, {
      eventName: EventSearchInputAllowedFiltersEventNameEnum.CommandExecuted,
      gameserverId: ctx.gameServer.id,
      after: before,
      timeout: 30000,
    });

    const meta = event.meta as { result?: { success?: boolean; logs?: Array<{ msg: string }> } };
    assert.equal(meta?.result?.success, false, 'Expected relink to be rejected');

    const logs = (meta?.result?.logs ?? []).map((l) => l.msg);
    assert.ok(
      logs.some((msg) => msg.toLowerCase().includes('already used a referral code')),
      `Expected "already used a referral code" message, got: ${JSON.stringify(logs)}`,
    );
  });

  it('should reject invalid code', async () => {
    const player = ctx.players[2]!;
    const before = new Date();

    // Grant REFERRAL_USE temporarily
    const tmpRoleId = await assignPermissions(
      client,
      player.playerId,
      ctx.gameServer.id,
      ['REFERRAL_USE'],
    );

    try {
      await client.command.commandControllerTrigger(ctx.gameServer.id, {
        msg: `${prefix}referral XXXXXX`,
        playerId: player.playerId,
      });

      const event = await waitForEvent(client, {
        eventName: EventSearchInputAllowedFiltersEventNameEnum.CommandExecuted,
        gameserverId: ctx.gameServer.id,
        after: before,
        timeout: 30000,
      });

      const meta = event.meta as { result?: { success?: boolean; logs?: Array<{ msg: string }> } };
      assert.equal(meta?.result?.success, false, 'Expected invalid code to be rejected');

      const logs = (meta?.result?.logs ?? []).map((l) => l.msg);
      assert.ok(
        logs.some((msg) => msg.toLowerCase().includes('not found')),
        `Expected "not found" message, got: ${JSON.stringify(logs)}`,
      );
    } finally {
      await cleanupRole(client, tmpRoleId);
    }
  });

  it('should deny /referral without REFERRAL_USE permission', async () => {
    const player = ctx.players[2]!;
    const before = new Date();

    await client.command.commandControllerTrigger(ctx.gameServer.id, {
      msg: `${prefix}referral ${aliceCode}`,
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
  });
});
