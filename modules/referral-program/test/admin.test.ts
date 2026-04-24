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

// player[0] = admin (REFERRAL_ADMIN)
// player[1] = referee target
// player[2] = referrer target

describe('referral-program: admin commands (/reflink, /refunlink)', () => {
  let client: Client;
  let ctx: MockServerContext;
  let moduleId: string;
  let versionId: string;
  let prefix: string;
  let adminRoleId: string | undefined;

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
        referrerCurrencyReward: 200,
        refereeCurrencyReward: 50,
        playtimeThresholdMinutes: 60,
        referralWindowHours: 24,
        maxReferralsPerDay: 5,
        maxReferralsLifetime: 50,
      },
    });

    prefix = await getCommandPrefix(client, ctx.gameServer.id);

    adminRoleId = await assignPermissions(
      client,
      ctx.players[0].playerId,
      ctx.gameServer.id,
      ['REFERRAL_ADMIN'],
    );
  });

  after(async () => {
    await cleanupRole(client, adminRoleId);
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

  it('should force-link and pay both rewards', async () => {
    const admin = ctx.players[0]!;
    const referee = ctx.players[1]!;
    const referrer = ctx.players[2]!;

    // Look up player names
    const [refereePog, referrerPog] = await Promise.all([
      client.playerOnGameserver.playerOnGameServerControllerSearch({
        filters: { gameServerId: [ctx.gameServer.id], playerId: [referee.playerId] },
      }),
      client.playerOnGameserver.playerOnGameServerControllerSearch({
        filters: { gameServerId: [ctx.gameServer.id], playerId: [referrer.playerId] },
      }),
    ]);

    const refereeName = refereePog.data.data[0]?.gameId ?? '';
    const referrerName = referrerPog.data.data[0]?.gameId ?? '';

    assert.ok(refereeName, 'Expected referee gameId');
    assert.ok(referrerName, 'Expected referrer gameId');

    const before = new Date();

    await client.command.commandControllerTrigger(ctx.gameServer.id, {
      msg: `${prefix}reflink ${refereeName} ${referrerName}`,
      playerId: admin.playerId,
    });

    const event = await waitForEvent(client, {
      eventName: EventSearchInputAllowedFiltersEventNameEnum.CommandExecuted,
      gameserverId: ctx.gameServer.id,
      after: before,
      timeout: 30000,
    });

    const meta = event.meta as { result?: { success?: boolean; logs?: Array<{ msg: string }> } };
    assert.equal(meta?.result?.success, true, `Expected /reflink to succeed, logs: ${JSON.stringify(meta?.result?.logs)}`);

    const logs = (meta?.result?.logs ?? []).map((l) => l.msg);
    assert.ok(
      logs.some((msg) => msg.includes('admin force-linked')),
      `Expected "admin force-linked" in logs, got: ${JSON.stringify(logs)}`,
    );

    // Verify link is created with status=paid
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const linkVars = await client.variable.variableControllerSearch({
      filters: {
        key: ['referral_link'],
        gameServerId: [ctx.gameServer.id],
        moduleId: [moduleId],
        playerId: [referee.playerId],
      },
    });
    assert.equal(linkVars.data.data.length, 1, 'Expected referral_link variable for referee');
    const link = JSON.parse(linkVars.data.data[0].value);
    assert.equal(link.status, 'paid', `Expected link status=paid, got ${link.status}`);
    assert.equal(link.referrerId, referrer.playerId, 'Expected referrerId to match referrer');
  });

  it('should remove referral link with /refunlink', async () => {
    // Depends on previous test: player[1] has a paid link
    const admin = ctx.players[0]!;
    const referee = ctx.players[1]!;

    const refereePog = await client.playerOnGameserver.playerOnGameServerControllerSearch({
      filters: { gameServerId: [ctx.gameServer.id], playerId: [referee.playerId] },
    });
    const refereeName = refereePog.data.data[0]?.gameId ?? '';
    assert.ok(refereeName, 'Expected referee gameId');

    const before = new Date();

    await client.command.commandControllerTrigger(ctx.gameServer.id, {
      msg: `${prefix}refunlink ${refereeName}`,
      playerId: admin.playerId,
    });

    const event = await waitForEvent(client, {
      eventName: EventSearchInputAllowedFiltersEventNameEnum.CommandExecuted,
      gameserverId: ctx.gameServer.id,
      after: before,
      timeout: 30000,
    });

    const meta = event.meta as { result?: { success?: boolean; logs?: Array<{ msg: string }> } };
    assert.equal(meta?.result?.success, true, `Expected /refunlink to succeed, logs: ${JSON.stringify(meta?.result?.logs)}`);

    const logs = (meta?.result?.logs ?? []).map((l) => l.msg);
    assert.ok(
      logs.some((msg) => msg.includes('admin removed link')),
      `Expected "admin removed link" in logs, got: ${JSON.stringify(logs)}`,
    );

    // Verify link is gone
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const linkVars = await client.variable.variableControllerSearch({
      filters: {
        key: ['referral_link'],
        gameServerId: [ctx.gameServer.id],
        moduleId: [moduleId],
        playerId: [referee.playerId],
      },
    });
    assert.equal(linkVars.data.data.length, 0, 'Expected referral_link variable to be deleted');
  });

  it('should deny /reflink without REFERRAL_ADMIN permission', async () => {
    // player[1] has no REFERRAL_ADMIN — use them to try the command
    const unpermissioned = ctx.players[1]!;
    const before = new Date();

    await client.command.commandControllerTrigger(ctx.gameServer.id, {
      msg: `${prefix}reflink someReferee someReferrer`,
      playerId: unpermissioned.playerId,
    });

    const event = await waitForEvent(client, {
      eventName: EventSearchInputAllowedFiltersEventNameEnum.CommandExecuted,
      gameserverId: ctx.gameServer.id,
      after: before,
      timeout: 30000,
    });

    const meta = event.meta as { result?: { success?: boolean; logs?: Array<{ msg: string }> } };
    assert.equal(meta?.result?.success, false, 'Expected /reflink to fail without REFERRAL_ADMIN');
  });
});
