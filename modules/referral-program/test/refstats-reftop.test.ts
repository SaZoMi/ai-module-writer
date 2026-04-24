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

// player[0] = referrer (REFERRAL_USE)
// player[1] = referee (REFERRAL_USE)

describe('referral-program: /refstats and /reftop commands', () => {
  let client: Client;
  let ctx: MockServerContext;
  let moduleId: string;
  let versionId: string;
  let sweepCronjobId: string;
  let prefix: string;
  let useRoleId: string | undefined;
  let refereeRoleId: string | undefined;

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
        referrerCurrencyReward: 300,
        refereeCurrencyReward: 75,
        playtimeThresholdMinutes: 0,
        referralWindowHours: 24,
        maxReferralsPerDay: 5,
        maxReferralsLifetime: 50,
      },
    });

    const sweepCronjob = mod.latestVersion.cronJobs.find((c) => c.name === 'sweep-pending-referrals');
    if (!sweepCronjob) throw new Error('Expected sweep-pending-referrals cronjob');
    sweepCronjobId = sweepCronjob.id;

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

    // Set up a paid referral: player[0] refers player[1], sweep pays out
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
    const aliceCode = JSON.parse(codeVars.data.data[0].value).code;

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

    // Trigger sweep to pay the referrer
    const beforeSweep = new Date();
    await client.cronjob.cronJobControllerTrigger({
      gameServerId: ctx.gameServer.id,
      cronjobId: sweepCronjobId,
      moduleId,
    });
    await waitForEvent(client, {
      eventName: EventSearchInputAllowedFiltersEventNameEnum.CronjobExecuted,
      gameserverId: ctx.gameServer.id,
      after: beforeSweep,
      timeout: 30000,
    });
    await new Promise((resolve) => setTimeout(resolve, 1000));
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

  it('/refstats shows correct stats for referrer', async () => {
    const referrer = ctx.players[0]!;
    const before = new Date();

    await client.command.commandControllerTrigger(ctx.gameServer.id, {
      msg: `${prefix}refstats`,
      playerId: referrer.playerId,
    });

    const event = await waitForEvent(client, {
      eventName: EventSearchInputAllowedFiltersEventNameEnum.CommandExecuted,
      gameserverId: ctx.gameServer.id,
      after: before,
      timeout: 30000,
    });

    const meta = event.meta as { result?: { success?: boolean; logs?: Array<{ msg: string }> } };
    assert.equal(meta?.result?.success, true, `Expected /refstats to succeed`);

    const logs = (meta?.result?.logs ?? []).map((l) => l.msg);
    assert.ok(
      logs.some((msg) => msg.includes('referralsTotal=1') && msg.includes('referralsPaid=1')),
      `Expected referralsTotal=1 and referralsPaid=1 in logs, got: ${JSON.stringify(logs)}`,
    );
  });

  it('/refstats shows link info for referee', async () => {
    const referee = ctx.players[1]!;
    const before = new Date();

    await client.command.commandControllerTrigger(ctx.gameServer.id, {
      msg: `${prefix}refstats`,
      playerId: referee.playerId,
    });

    const event = await waitForEvent(client, {
      eventName: EventSearchInputAllowedFiltersEventNameEnum.CommandExecuted,
      gameserverId: ctx.gameServer.id,
      after: before,
      timeout: 30000,
    });

    const meta = event.meta as { result?: { success?: boolean; logs?: Array<{ msg: string }> } };
    assert.equal(meta?.result?.success, true, `Expected /refstats for referee to succeed`);
  });

  it('/reftop shows referrer in top list', async () => {
    const referrer = ctx.players[0]!;
    const before = new Date();

    await client.command.commandControllerTrigger(ctx.gameServer.id, {
      msg: `${prefix}reftop`,
      playerId: referrer.playerId,
    });

    const event = await waitForEvent(client, {
      eventName: EventSearchInputAllowedFiltersEventNameEnum.CommandExecuted,
      gameserverId: ctx.gameServer.id,
      after: before,
      timeout: 30000,
    });

    const meta = event.meta as { result?: { success?: boolean; logs?: Array<{ msg: string }> } };
    assert.equal(meta?.result?.success, true, `Expected /reftop to succeed, logs: ${JSON.stringify(meta?.result?.logs)}`);

    const logs = (meta?.result?.logs ?? []).map((l) => l.msg);
    assert.ok(
      logs.some((msg) => msg.includes('top') && msg.includes('referrer')),
      `Expected reftop log with "top" and "referrer", got: ${JSON.stringify(logs)}`,
    );
  });
});
