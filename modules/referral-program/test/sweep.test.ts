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
  PermissionInput,
} from '../../../test/helpers/modules.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MODULE_DIR = path.resolve(__dirname, '..');

// Tests the sweep cronjob and VIP tier multiplier.
// player[0] = referrer (REFERRAL_USE)
// player[1] = referee (REFERRAL_USE)
// player[2] = VIP referrer (REFERRAL_USE + REFERRAL_VIP count=3)

describe('referral-program: sweep-pending-referrals cronjob', () => {
  let client: Client;
  let ctx: MockServerContext;
  let moduleId: string;
  let versionId: string;
  let sweepCronjobId: string;
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
        playtimeThresholdMinutes: 0, // 0 = always passes threshold
        referralWindowHours: 24,
        maxReferralsPerDay: 5,
        maxReferralsLifetime: 50,
      },
    });

    // Find sweep cronjob ID
    const sweepCronjob = mod.latestVersion.cronJobs.find((c) => c.name === 'sweep-pending-referrals');
    if (!sweepCronjob) throw new Error('Expected sweep-pending-referrals cronjob in module');
    sweepCronjobId = sweepCronjob.id;

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

    const codeVars = await client.variable.variableControllerSearch({
      filters: {
        key: ['referral_code'],
        gameServerId: [ctx.gameServer.id],
        moduleId: [moduleId],
        playerId: [ctx.players[0].playerId],
      },
    });
    aliceCode = JSON.parse(codeVars.data.data[0].value).code;

    // player[1] uses the code to create a pending referral
    const beforeRef = new Date();
    await client.command.commandControllerTrigger(ctx.gameServer.id, {
      msg: `${prefix}referral ${aliceCode}`,
      playerId: ctx.players[1].playerId,
    });
    await waitForEvent(client, {
      eventName: EventSearchInputAllowedFiltersEventNameEnum.CommandExecuted,
      gameserverId: ctx.gameServer.id,
      after: beforeRef,
      timeout: 30000,
    });
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

  async function triggerSweep(): Promise<{ success: boolean; logs: string[] }> {
    const before = new Date();
    await client.cronjob.cronJobControllerTrigger({
      gameServerId: ctx.gameServer.id,
      cronjobId: sweepCronjobId,
      moduleId,
    });
    const event = await waitForEvent(client, {
      eventName: EventSearchInputAllowedFiltersEventNameEnum.CronjobExecuted,
      gameserverId: ctx.gameServer.id,
      after: before,
      timeout: 30000,
    });
    const meta = event.meta as { result?: { success?: boolean; logs?: Array<{ msg: string }> } };
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return {
      success: meta?.result?.success ?? false,
      logs: (meta?.result?.logs ?? []).map((l) => l.msg),
    };
  }

  it('should pay referrer when threshold is met', async () => {
    // playtimeThresholdMinutes=0 means all referrals immediately cross threshold

    const referrer = ctx.players[0]!;

    // Check referrer balance before
    const pogBefore = await client.playerOnGameserver.playerOnGameServerControllerSearch({
      filters: { gameServerId: [ctx.gameServer.id], playerId: [referrer.playerId] },
    });
    const balanceBefore = pogBefore.data.data[0]?.currency ?? 0;

    const { success, logs } = await triggerSweep();
    assert.equal(success, true, `Expected sweep to succeed, logs: ${JSON.stringify(logs)}`);
    assert.ok(
      logs.some((msg) => msg.includes('paid=1')),
      `Expected paid=1 in sweep logs, got: ${JSON.stringify(logs)}`,
    );

    // Verify referral link is now paid
    const linkVars = await client.variable.variableControllerSearch({
      filters: {
        key: ['referral_link'],
        gameServerId: [ctx.gameServer.id],
        moduleId: [moduleId],
        playerId: [ctx.players[1].playerId],
      },
    });
    assert.equal(linkVars.data.data.length, 1, 'Expected referral_link variable to exist');
    const linkData = JSON.parse(linkVars.data.data[0].value);
    assert.equal(linkData.status, 'paid', `Expected link status to be 'paid', got '${linkData.status}'`);

    // Verify referrer stats
    const statsVars = await client.variable.variableControllerSearch({
      filters: {
        key: ['referral_stats'],
        gameServerId: [ctx.gameServer.id],
        moduleId: [moduleId],
        playerId: [referrer.playerId],
      },
    });
    assert.equal(statsVars.data.data.length, 1, 'Expected referral_stats for referrer');
    const stats = JSON.parse(statsVars.data.data[0].value);
    assert.equal(stats.referralsPaid, 1, 'Expected referralsPaid=1 in stats');
    assert.equal(stats.currencyEarned, 500, 'Expected currencyEarned=500 (base reward)');

    // Verify referee removed from pending index
    const indexVars = await client.variable.variableControllerSearch({
      filters: {
        key: ['referral_pending_index'],
        gameServerId: [ctx.gameServer.id],
        moduleId: [moduleId],
      },
    });
    if (indexVars.data.data.length > 0) {
      const index = JSON.parse(indexVars.data.data[0].value);
      assert.ok(
        !index.refereeIds.includes(ctx.players[1].playerId),
        'Expected referee to be removed from pending index after payout',
      );
    }

    // Verify referrer balance increased by 500
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const pogAfter = await client.playerOnGameserver.playerOnGameServerControllerSearch({
      filters: { gameServerId: [ctx.gameServer.id], playerId: [referrer.playerId] },
    });
    const balanceAfter = pogAfter.data.data[0]?.currency ?? 0;
    assert.equal(balanceAfter, balanceBefore + 500, `Expected balance to increase by 500, was ${balanceBefore} -> ${balanceAfter}`);
  });

  it('should handle empty pending index gracefully', async () => {
    // After previous test, pending index should be empty — sweep should succeed silently (no log for empty list per VI-36)
    const { success, logs } = await triggerSweep();
    assert.equal(success, true, `Expected sweep to succeed on empty index, logs: ${JSON.stringify(logs)}`);
    // When there are no pending referrals, the sweep exits immediately with no "done" log either — just success
    assert.ok(
      !logs.some((msg) => msg.includes('paid=') || msg.includes('checking')),
      `Expected no "paid=" or "checking" logs when pending list is empty, got: ${JSON.stringify(logs)}`,
    );
  });
});
