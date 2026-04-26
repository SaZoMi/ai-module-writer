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

// Tests the player-disconnected hook:
// player[0] = referrer (REFERRAL_USE)
// player[1] = referee (REFERRAL_USE) - will disconnect after creating a pending referral

describe('referral-program: on-player-disconnect hook', () => {
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
        referrerCurrencyReward: 400,
        refereeCurrencyReward: 80,
        playtimeThresholdMinutes: 0, // Threshold = 0 so payout always fires
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
    refereeRoleId = await assignPermissions(
      client,
      ctx.players[1].playerId,
      ctx.gameServer.id,
      ['REFERRAL_USE'],
    );

    // Get player[0]'s referral code
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

    // player[1] uses the code
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

  it('should fire payout when referee disconnects (threshold=0 = immediate)', async () => {
    const referee = ctx.players[1]!;

    // Verify link is pending before trigger
    const linkVarsBefore = await client.variable.variableControllerSearch({
      filters: {
        key: ['referral_link'],
        gameServerId: [ctx.gameServer.id],
        moduleId: [moduleId],
        playerId: [referee.playerId],
      },
    });
    assert.equal(linkVarsBefore.data.data.length, 1, 'Expected referral_link to exist before hook trigger');
    const linkBefore = JSON.parse(linkVarsBefore.data.data[0].value);
    assert.equal(linkBefore.status, 'pending', 'Expected link to be pending before hook trigger');

    const before = new Date();

    // Trigger the player-disconnected hook via the API for the specific referee player.
    // The hook trigger API fires all hooks matching the eventType for the given module.
    // By passing playerId = referee, the hook runs in the context of the referee's disconnect.
    await client.hook.hookControllerTrigger({
      gameServerId: ctx.gameServer.id,
      moduleId,
      playerId: referee.playerId,
      eventType: 'player-disconnected',
      eventMeta: {},
    });

    // Wait for the hook-executed event
    const event = await waitForEvent(client, {
      eventName: EventSearchInputAllowedFiltersEventNameEnum.HookExecuted,
      gameserverId: ctx.gameServer.id,
      after: before,
      timeout: 30000,
    });

    assert.ok(event, 'Expected a hook-executed event');
    const meta = event.meta as { result?: { success?: boolean; logs?: Array<{ msg: string }> } };
    assert.equal(meta?.result?.success, true, `Expected hook to succeed, logs: ${JSON.stringify(meta?.result?.logs)}`);

    const logs = (meta?.result?.logs ?? []).map((l) => l.msg);
    assert.ok(
      logs.some((msg) => msg.includes('checkAndPayReferral result=paid')),
      `Expected "checkAndPayReferral result=paid" in hook logs, got: ${JSON.stringify(logs)}`,
    );

    // Verify link is now paid — poll until status changes
    await pollUntil(async () => {
      const vars = await client.variable.variableControllerSearch({
        filters: {
          key: ['referral_link'],
          gameServerId: [ctx.gameServer.id],
          moduleId: [moduleId],
          playerId: [referee.playerId],
        },
      });
      if (vars.data.data.length === 0) return false;
      const link = JSON.parse(vars.data.data[0].value);
      return link.status === 'paid';
    }, { timeout: 15000, interval: 200 });
    const linkVarsAfter = await client.variable.variableControllerSearch({
      filters: {
        key: ['referral_link'],
        gameServerId: [ctx.gameServer.id],
        moduleId: [moduleId],
        playerId: [referee.playerId],
      },
    });
    assert.equal(linkVarsAfter.data.data.length, 1, 'Expected referral_link to still exist after payout');
    const linkAfter = JSON.parse(linkVarsAfter.data.data[0].value);
    assert.equal(linkAfter.status, 'paid', `Expected link status=paid after hook payout, got ${linkAfter.status}`);
  });
});
