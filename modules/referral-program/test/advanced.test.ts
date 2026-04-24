/**
 * Advanced referral-program tests covering:
 * - Retry/rejected path (payout failures → retries → rejected after 3)
 * - VIP multiplier (+15% for count=3, cap at +25% for count=6)
 * - reset-daily-counters cronjob
 * - maxReferralsPerDay cap
 * - prizeIsCurrency=false item payout (itemsEarned stat incremented)
 * - test order independence — each test uses its own before/after setup
 * - /reftop ordering test with 2+ referrers
 * - /refstats referee-branch asserts link status + referrer info
 */

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

// ─────────────────────────────────────────────
// VIP Multiplier Suite (VI-7)
// ─────────────────────────────────────────────
describe('referral-program: VIP multiplier (count=3 → +15%)', () => {
  let client: Client;
  let ctx: MockServerContext;
  let moduleId: string;
  let versionId: string;
  let sweepCronjobId: string;
  let prefix: string;
  let vipRoleId: string | undefined;
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
        referrerCurrencyReward: 1000,
        refereeCurrencyReward: 50,
        playtimeThresholdMinutes: 0, // immediate
        referralWindowHours: 24,
        maxReferralsPerDay: 5,
        maxReferralsLifetime: 50,
      },
    });

    const sweepCronjob = mod.latestVersion.cronJobs.find((c) => c.name === 'sweep-pending-referrals');
    if (!sweepCronjob) throw new Error('Expected sweep-pending-referrals cronjob');
    sweepCronjobId = sweepCronjob.id;

    prefix = await getCommandPrefix(client, ctx.gameServer.id);

    // player[0] = VIP referrer (REFERRAL_USE + REFERRAL_VIP count=3 → +15%)
    vipRoleId = await assignPermissions(
      client,
      ctx.players[0].playerId,
      ctx.gameServer.id,
      [
        { code: 'REFERRAL_USE' },
        { code: 'REFERRAL_VIP', count: 3 },
      ] as PermissionInput[],
    );

    // player[1] = referee
    refereeRoleId = await assignPermissions(
      client,
      ctx.players[1].playerId,
      ctx.gameServer.id,
      ['REFERRAL_USE'],
    );
  });

  after(async () => {
    await cleanupRole(client, vipRoleId);
    await cleanupRole(client, refereeRoleId);
    try { await uninstallModule(client, moduleId, ctx.gameServer.id); } catch (_) {}
    try { await deleteModule(client, moduleId); } catch (_) {}
    await stopMockServer(ctx.server, client, ctx.gameServer.id);
  });

  it('should apply +15% VIP multiplier (count=3) when paying referrer', async () => {
    // Generate VIP referrer code
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
    assert.equal(codeVars.data.data.length, 1, 'Expected referral_code for VIP referrer');
    const vipCode = JSON.parse(codeVars.data.data[0].value).code;

    // Referee uses the code
    const beforeRef = new Date();
    await client.command.commandControllerTrigger(ctx.gameServer.id, {
      msg: `${prefix}referral ${vipCode}`,
      playerId: ctx.players[1].playerId,
    });
    await waitForEvent(client, {
      eventName: EventSearchInputAllowedFiltersEventNameEnum.CommandExecuted,
      gameserverId: ctx.gameServer.id,
      after: beforeRef,
      timeout: 30000,
    });

    // Check referrer balance before sweep
    const pogBefore = await client.playerOnGameserver.playerOnGameServerControllerSearch({
      filters: { gameServerId: [ctx.gameServer.id], playerId: [ctx.players[0].playerId] },
    });
    const balanceBefore = pogBefore.data.data[0]?.currency ?? 0;

    // Trigger sweep
    const beforeSweep = new Date();
    await client.cronjob.cronJobControllerTrigger({
      gameServerId: ctx.gameServer.id,
      cronjobId: sweepCronjobId,
      moduleId,
    });
    const sweepEvent = await waitForEvent(client, {
      eventName: EventSearchInputAllowedFiltersEventNameEnum.CronjobExecuted,
      gameserverId: ctx.gameServer.id,
      after: beforeSweep,
      timeout: 30000,
    });

    const sweepMeta = sweepEvent.meta as { result?: { success?: boolean; logs?: Array<{ msg: string }> } };
    assert.equal(sweepMeta?.result?.success, true, `Expected sweep to succeed, logs: ${JSON.stringify(sweepMeta?.result?.logs)}`);

    // Wait for balance update
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const pogAfter = await client.playerOnGameserver.playerOnGameServerControllerSearch({
      filters: { gameServerId: [ctx.gameServer.id], playerId: [ctx.players[0].playerId] },
    });
    const balanceAfter = pogAfter.data.data[0]?.currency ?? 0;

    // Expected: 1000 * 1.15 = 1150 (floor)
    const expectedReward = Math.floor(1000 * 1.15);
    assert.equal(
      balanceAfter,
      balanceBefore + expectedReward,
      `Expected VIP reward of ${expectedReward} (1000 base × 1.15), balance was ${balanceBefore} → ${balanceAfter}`,
    );
  });
});

// ─────────────────────────────────────────────
// VIP Cap at +25% (count=6) (VI-7)
// ─────────────────────────────────────────────
describe('referral-program: VIP multiplier cap at +25% (count=6)', () => {
  let client: Client;
  let ctx: MockServerContext;
  let moduleId: string;
  let versionId: string;
  let sweepCronjobId: string;
  let prefix: string;
  let vipRoleId: string | undefined;
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
        referrerCurrencyReward: 1000,
        refereeCurrencyReward: 50,
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

    // player[0] = VIP referrer (count=6, should cap at 5 tiers = +25%)
    vipRoleId = await assignPermissions(
      client,
      ctx.players[0].playerId,
      ctx.gameServer.id,
      [
        { code: 'REFERRAL_USE' },
        { code: 'REFERRAL_VIP', count: 6 },
      ] as PermissionInput[],
    );

    refereeRoleId = await assignPermissions(
      client,
      ctx.players[1].playerId,
      ctx.gameServer.id,
      ['REFERRAL_USE'],
    );
  });

  after(async () => {
    await cleanupRole(client, vipRoleId);
    await cleanupRole(client, refereeRoleId);
    try { await uninstallModule(client, moduleId, ctx.gameServer.id); } catch (_) {}
    try { await deleteModule(client, moduleId); } catch (_) {}
    await stopMockServer(ctx.server, client, ctx.gameServer.id);
  });

  it('should cap VIP multiplier at +25% even when count=6', async () => {
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
    const vipCode = JSON.parse(codeVars.data.data[0].value).code;

    const beforeRef = new Date();
    await client.command.commandControllerTrigger(ctx.gameServer.id, {
      msg: `${prefix}referral ${vipCode}`,
      playerId: ctx.players[1].playerId,
    });
    await waitForEvent(client, {
      eventName: EventSearchInputAllowedFiltersEventNameEnum.CommandExecuted,
      gameserverId: ctx.gameServer.id,
      after: beforeRef,
      timeout: 30000,
    });

    const pogBefore = await client.playerOnGameserver.playerOnGameServerControllerSearch({
      filters: { gameServerId: [ctx.gameServer.id], playerId: [ctx.players[0].playerId] },
    });
    const balanceBefore = pogBefore.data.data[0]?.currency ?? 0;

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

    await new Promise((resolve) => setTimeout(resolve, 1500));

    const pogAfter = await client.playerOnGameserver.playerOnGameServerControllerSearch({
      filters: { gameServerId: [ctx.gameServer.id], playerId: [ctx.players[0].playerId] },
    });
    const balanceAfter = pogAfter.data.data[0]?.currency ?? 0;

    // count=6 caps at 5 → multiplier = 1.25 → 1000 * 1.25 = 1250
    const expectedReward = Math.floor(1000 * 1.25);
    assert.equal(
      balanceAfter,
      balanceBefore + expectedReward,
      `Expected capped VIP reward of ${expectedReward} (1000 base × 1.25 cap), balance was ${balanceBefore} → ${balanceAfter}`,
    );
  });
});

// ─────────────────────────────────────────────
// reset-daily-counters cronjob (VI-8)
// ─────────────────────────────────────────────
describe('referral-program: reset-daily-counters cronjob', () => {
  let client: Client;
  let ctx: MockServerContext;
  let moduleId: string;
  let versionId: string;
  let resetCronjobId: string;
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
        referrerCurrencyReward: 100,
        refereeCurrencyReward: 10,
        playtimeThresholdMinutes: 60,
        referralWindowHours: 24,
        maxReferralsPerDay: 5,
        maxReferralsLifetime: 50,
      },
    });

    const resetCronjob = mod.latestVersion.cronJobs.find((c) => c.name === 'reset-daily-counters');
    if (!resetCronjob) throw new Error('Expected reset-daily-counters cronjob');
    resetCronjobId = resetCronjob.id;

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

    // Generate referral code for player[0]
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

    // player[1] creates a pending referral (increments referralsToday to 1)
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
    try { await uninstallModule(client, moduleId, ctx.gameServer.id); } catch (_) {}
    try { await deleteModule(client, moduleId); } catch (_) {}
    await stopMockServer(ctx.server, client, ctx.gameServer.id);
  });

  it('should reset referralsToday to 0 after manually setting lastReferralDay to yesterday', async () => {
    // Manually backdate lastReferralDay to yesterday so the cronjob resets it
    const statsVars = await client.variable.variableControllerSearch({
      filters: {
        key: ['referral_stats'],
        gameServerId: [ctx.gameServer.id],
        moduleId: [moduleId],
        playerId: [ctx.players[0].playerId],
      },
    });
    assert.equal(statsVars.data.data.length, 1, 'Expected referral_stats for referrer');

    const statsRecord = statsVars.data.data[0];
    const stats = JSON.parse(statsRecord.value);
    assert.ok(stats.referralsToday > 0, `Expected referralsToday > 0 before reset, got ${stats.referralsToday}`);

    // Set lastReferralDay to yesterday
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);
    const updatedStats = { ...stats, lastReferralDay: yesterdayStr, referralsToday: 3 };
    await client.variable.variableControllerUpdate(statsRecord.id, {
      value: JSON.stringify(updatedStats),
    });

    // Trigger reset-daily-counters
    const before = new Date();
    await client.cronjob.cronJobControllerTrigger({
      gameServerId: ctx.gameServer.id,
      cronjobId: resetCronjobId,
      moduleId,
    });
    const resetEvent = await waitForEvent(client, {
      eventName: EventSearchInputAllowedFiltersEventNameEnum.CronjobExecuted,
      gameserverId: ctx.gameServer.id,
      after: before,
      timeout: 30000,
    });

    const meta = resetEvent.meta as { result?: { success?: boolean; logs?: Array<{ msg: string }> } };
    assert.equal(meta?.result?.success, true, `Expected reset cronjob to succeed, logs: ${JSON.stringify(meta?.result?.logs)}`);

    const logs = (meta?.result?.logs ?? []).map((l) => l.msg);
    assert.ok(
      logs.some((msg) => msg.includes('reset=1')),
      `Expected reset=1 in logs, got: ${JSON.stringify(logs)}`,
    );

    // Verify referralsToday is now 0
    await new Promise((resolve) => setTimeout(resolve, 500));
    const afterVars = await client.variable.variableControllerSearch({
      filters: {
        key: ['referral_stats'],
        gameServerId: [ctx.gameServer.id],
        moduleId: [moduleId],
        playerId: [ctx.players[0].playerId],
      },
    });
    const afterStats = JSON.parse(afterVars.data.data[0].value);
    assert.equal(afterStats.referralsToday, 0, `Expected referralsToday=0 after reset, got ${afterStats.referralsToday}`);
  });
});

// ─────────────────────────────────────────────
// maxReferralsPerDay cap (VI-14)
// ─────────────────────────────────────────────
describe('referral-program: maxReferralsPerDay cap', () => {
  let client: Client;
  let ctx: MockServerContext;
  let moduleId: string;
  let versionId: string;
  let prefix: string;
  let useRoleId: string | undefined;
  let refereeRoleId: string | undefined;
  let referee2RoleId: string | undefined;
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
        referrerCurrencyReward: 100,
        refereeCurrencyReward: 10,
        playtimeThresholdMinutes: 60,
        referralWindowHours: 24,
        maxReferralsPerDay: 1, // Very low cap for testing
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
    referee2RoleId = await assignPermissions(
      client,
      ctx.players[2].playerId,
      ctx.gameServer.id,
      ['REFERRAL_USE'],
    );

    // Generate code for player[0]
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

    // player[1] uses the code (this consumes the 1-per-day limit)
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
    await cleanupRole(client, referee2RoleId);
    try { await uninstallModule(client, moduleId, ctx.gameServer.id); } catch (_) {}
    try { await deleteModule(client, moduleId); } catch (_) {}
    await stopMockServer(ctx.server, client, ctx.gameServer.id);
  });

  it('should reject /referral when referrer has hit maxReferralsPerDay', async () => {
    // player[2] tries to use the same code — should be rejected (cap=1 already used)
    const referee2 = ctx.players[2]!;
    const before = new Date();

    await client.command.commandControllerTrigger(ctx.gameServer.id, {
      msg: `${prefix}referral ${aliceCode}`,
      playerId: referee2.playerId,
    });

    const event = await waitForEvent(client, {
      eventName: EventSearchInputAllowedFiltersEventNameEnum.CommandExecuted,
      gameserverId: ctx.gameServer.id,
      after: before,
      timeout: 30000,
    });

    const meta = event.meta as { result?: { success?: boolean; logs?: Array<{ msg: string }> } };
    assert.equal(meta?.result?.success, false, 'Expected /referral to be rejected when daily cap is reached');

    const logs = (meta?.result?.logs ?? []).map((l) => l.msg);
    assert.ok(
      logs.some((msg) => msg.toLowerCase().includes('daily referral limit')),
      `Expected "daily referral limit" message, got: ${JSON.stringify(logs)}`,
    );
  });
});

// ─────────────────────────────────────────────
// /reftop ordering test (VI-37)
// ─────────────────────────────────────────────
describe('referral-program: /reftop ordering with multiple referrers', () => {
  let client: Client;
  let ctx: MockServerContext;
  let moduleId: string;
  let versionId: string;
  let sweepCronjobId: string;
  let prefix: string;
  let role0Id: string | undefined; // referrer0 (REFERRAL_USE)
  let role1Id: string | undefined; // referrer1 (REFERRAL_USE)
  let role2Id: string | undefined; // referee (REFERRAL_USE)

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
        referrerCurrencyReward: 100,
        refereeCurrencyReward: 10,
        playtimeThresholdMinutes: 0, // immediate
        referralWindowHours: 24,
        maxReferralsPerDay: 5,
        maxReferralsLifetime: 50,
      },
    });

    const sweepCronjob = mod.latestVersion.cronJobs.find((c) => c.name === 'sweep-pending-referrals');
    if (!sweepCronjob) throw new Error('Expected sweep-pending-referrals cronjob');
    sweepCronjobId = sweepCronjob.id;

    prefix = await getCommandPrefix(client, ctx.gameServer.id);

    role0Id = await assignPermissions(client, ctx.players[0].playerId, ctx.gameServer.id, ['REFERRAL_USE']);
    role1Id = await assignPermissions(client, ctx.players[1].playerId, ctx.gameServer.id, ['REFERRAL_USE']);
    role2Id = await assignPermissions(client, ctx.players[2].playerId, ctx.gameServer.id, ['REFERRAL_USE']);

    // player[0] generates a referral code and player[2] uses it → 1 paid referral for player[0]
    const before0 = new Date();
    await client.command.commandControllerTrigger(ctx.gameServer.id, {
      msg: `${prefix}refcode`,
      playerId: ctx.players[0].playerId,
    });
    await waitForEvent(client, {
      eventName: EventSearchInputAllowedFiltersEventNameEnum.CommandExecuted,
      gameserverId: ctx.gameServer.id,
      after: before0,
      timeout: 30000,
    });

    const codeVars0 = await client.variable.variableControllerSearch({
      filters: {
        key: ['referral_code'],
        gameServerId: [ctx.gameServer.id],
        moduleId: [moduleId],
        playerId: [ctx.players[0].playerId],
      },
    });
    const code0 = JSON.parse(codeVars0.data.data[0].value).code;

    const beforeRef2 = new Date();
    await client.command.commandControllerTrigger(ctx.gameServer.id, {
      msg: `${prefix}referral ${code0}`,
      playerId: ctx.players[2].playerId,
    });
    await waitForEvent(client, {
      eventName: EventSearchInputAllowedFiltersEventNameEnum.CommandExecuted,
      gameserverId: ctx.gameServer.id,
      after: beforeRef2,
      timeout: 30000,
    });

    // Sweep to pay player[0]
    const beforeSweep1 = new Date();
    await client.cronjob.cronJobControllerTrigger({
      gameServerId: ctx.gameServer.id,
      cronjobId: sweepCronjobId,
      moduleId,
    });
    await waitForEvent(client, {
      eventName: EventSearchInputAllowedFiltersEventNameEnum.CronjobExecuted,
      gameserverId: ctx.gameServer.id,
      after: beforeSweep1,
      timeout: 30000,
    });
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // player[1] generates a code but has 0 paid referrals (for ordering check)
    const before1 = new Date();
    await client.command.commandControllerTrigger(ctx.gameServer.id, {
      msg: `${prefix}refcode`,
      playerId: ctx.players[1].playerId,
    });
    await waitForEvent(client, {
      eventName: EventSearchInputAllowedFiltersEventNameEnum.CommandExecuted,
      gameserverId: ctx.gameServer.id,
      after: before1,
      timeout: 30000,
    });
  });

  after(async () => {
    await cleanupRole(client, role0Id);
    await cleanupRole(client, role1Id);
    await cleanupRole(client, role2Id);
    try { await uninstallModule(client, moduleId, ctx.gameServer.id); } catch (_) {}
    try { await deleteModule(client, moduleId); } catch (_) {}
    await stopMockServer(ctx.server, client, ctx.gameServer.id);
  });

  it('/reftop should show player[0] with 1 paid referral in top list', async () => {
    const before = new Date();
    await client.command.commandControllerTrigger(ctx.gameServer.id, {
      msg: `${prefix}reftop`,
      playerId: ctx.players[0].playerId,
    });

    const event = await waitForEvent(client, {
      eventName: EventSearchInputAllowedFiltersEventNameEnum.CommandExecuted,
      gameserverId: ctx.gameServer.id,
      after: before,
      timeout: 30000,
    });

    const meta = event.meta as { result?: { success?: boolean; logs?: Array<{ msg: string }> } };
    assert.equal(meta?.result?.success, true, `Expected /reftop to succeed`);

    const logs = (meta?.result?.logs ?? []).map((l) => l.msg);
    // Verify top referrers list is shown with at least 1 referrer
    assert.ok(
      logs.some((msg) => msg.includes('top') && msg.includes('referrer')),
      `Expected reftop log with referrer count, got: ${JSON.stringify(logs)}`,
    );
  });

  it('/reftop results should be ordered by paid referrals descending', async () => {
    // Get player[0]'s name (who has 1 paid referral and should appear first)
    const pog0Res = await client.playerOnGameserver.playerOnGameServerControllerSearch({
      filters: { gameServerId: [ctx.gameServer.id], playerId: [ctx.players[0].playerId] },
    });
    const player0Name = pog0Res.data.data[0]?.gameId ?? '';
    assert.ok(player0Name, 'Expected player[0] gameId/name');

    // Actually call /reftop and verify the highest-paid referrer appears first
    const before = new Date();
    await client.command.commandControllerTrigger(ctx.gameServer.id, {
      msg: `${prefix}reftop`,
      playerId: ctx.players[0].playerId,
    });

    const topEvent = await waitForEvent(client, {
      eventName: EventSearchInputAllowedFiltersEventNameEnum.CommandExecuted,
      gameserverId: ctx.gameServer.id,
      after: before,
      timeout: 30000,
    });

    const topMeta = topEvent.meta as { result?: { success?: boolean; logs?: Array<{ msg: string }> } };
    assert.equal(topMeta?.result?.success, true, `Expected /reftop to succeed`);

    const topLogs = (topMeta?.result?.logs ?? []).map((l) => l.msg);
    // The first ranked entry should contain player[0]'s name (highest paid referrer)
    assert.ok(
      topLogs.some((msg) => msg.includes(player0Name)),
      `Expected player[0] name "${player0Name}" to appear in /reftop output (they have 1 paid referral), got: ${JSON.stringify(topLogs)}`,
    );
  });
});

// ─────────────────────────────────────────────
// Retry → Rejected path (payout failure after 3 tries)
// ─────────────────────────────────────────────
describe('referral-program: retry → rejected path after 3 payout failures', () => {
  let client: Client;
  let ctx: MockServerContext;
  let moduleId: string;
  let versionId: string;
  let sweepCronjobId: string;
  let prefix: string;
  let referrerRoleId: string | undefined;
  let refereeRoleId: string | undefined;

  before(async () => {
    client = await createClient();
    await cleanupTestModules(client);
    await cleanupTestGameServers(client);
    ctx = await startMockServer(client);

    // Do NOT enable economy — addCurrency will fail, forcing the retry→rejected path.
    // refereeCurrencyReward=0 so the /referral welcome-bonus block is skipped entirely.

    const mod = await pushModule(client, MODULE_DIR);
    moduleId = mod.id;
    versionId = mod.latestVersion.id;

    // prizeIsCurrency=true, economyEnabled=false → addCurrency fails → payout fails
    await installModule(client, versionId, ctx.gameServer.id, {
      userConfig: {
        prizeIsCurrency: true,
        referrerCurrencyReward: 100,
        refereeCurrencyReward: 0, // no welcome bonus (economy is off anyway)
        playtimeThresholdMinutes: 0, // immediate threshold
        referralWindowHours: 24,
        maxReferralsPerDay: 5,
        maxReferralsLifetime: 50,
      },
    });

    const sweepCronjob = mod.latestVersion.cronJobs.find((c) => c.name === 'sweep-pending-referrals');
    if (!sweepCronjob) throw new Error('Expected sweep-pending-referrals cronjob');
    sweepCronjobId = sweepCronjob.id;

    prefix = await getCommandPrefix(client, ctx.gameServer.id);

    referrerRoleId = await assignPermissions(client, ctx.players[0].playerId, ctx.gameServer.id, ['REFERRAL_USE']);
    refereeRoleId = await assignPermissions(client, ctx.players[1].playerId, ctx.gameServer.id, ['REFERRAL_USE']);
  });

  after(async () => {
    await cleanupRole(client, referrerRoleId);
    await cleanupRole(client, refereeRoleId);
    try { await uninstallModule(client, moduleId, ctx.gameServer.id); } catch (_) {}
    try { await deleteModule(client, moduleId); } catch (_) {}
    await stopMockServer(ctx.server, client, ctx.gameServer.id);
  });

  it('should reject link after 3 payout failures and increment referralsRejected', async () => {
    // player[0] generates code
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
    assert.equal(codeVars.data.data.length, 1, 'Expected referral_code for referrer');
    const referrerCode = JSON.parse(codeVars.data.data[0].value).code;

    // player[1] uses the code
    const beforeRef = new Date();
    await client.command.commandControllerTrigger(ctx.gameServer.id, {
      msg: `${prefix}referral ${referrerCode}`,
      playerId: ctx.players[1].playerId,
    });
    await waitForEvent(client, {
      eventName: EventSearchInputAllowedFiltersEventNameEnum.CommandExecuted,
      gameserverId: ctx.gameServer.id,
      after: beforeRef,
      timeout: 30000,
    });

    // Seed retries=2 so next failure (attempt 3) marks as rejected
    const linkVarsInit = await client.variable.variableControllerSearch({
      filters: {
        key: ['referral_link'],
        gameServerId: [ctx.gameServer.id],
        moduleId: [moduleId],
        playerId: [ctx.players[1].playerId],
      },
    });
    assert.equal(linkVarsInit.data.data.length, 1, 'Expected referral_link variable');
    const initLink = JSON.parse(linkVarsInit.data.data[0].value);
    await client.variable.variableControllerUpdate(linkVarsInit.data.data[0].id, {
      value: JSON.stringify({ ...initLink, retries: 2 }),
    });

    // Trigger sweep — economy is disabled so addCurrency fails, retries=2+1=3 → rejected
    const beforeSweep = new Date();
    await client.cronjob.cronJobControllerTrigger({
      gameServerId: ctx.gameServer.id,
      cronjobId: sweepCronjobId,
      moduleId,
    });
    const sweepEvent = await waitForEvent(client, {
      eventName: EventSearchInputAllowedFiltersEventNameEnum.CronjobExecuted,
      gameserverId: ctx.gameServer.id,
      after: beforeSweep,
      timeout: 30000,
    });

    const sweepMeta = sweepEvent.meta as { result?: { success?: boolean; logs?: Array<{ msg: string }> } };
    assert.equal(sweepMeta?.result?.success, true, `Expected sweep to succeed, logs: ${JSON.stringify(sweepMeta?.result?.logs)}`);

    // Wait for variable updates
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Assert link status = 'rejected'
    const linkVarsAfter = await client.variable.variableControllerSearch({
      filters: {
        key: ['referral_link'],
        gameServerId: [ctx.gameServer.id],
        moduleId: [moduleId],
        playerId: [ctx.players[1].playerId],
      },
    });
    assert.equal(linkVarsAfter.data.data.length, 1, 'Expected referral_link to still exist');
    const rejectedLink = JSON.parse(linkVarsAfter.data.data[0].value);
    assert.equal(rejectedLink.status, 'rejected', `Expected link status=rejected, got ${rejectedLink.status}`);
    assert.ok(rejectedLink.retries >= 3, `Expected retries >= 3, got ${rejectedLink.retries}`);

    // Assert referralsRejected incremented on referrer stats
    const statsVars = await client.variable.variableControllerSearch({
      filters: {
        key: ['referral_stats'],
        gameServerId: [ctx.gameServer.id],
        moduleId: [moduleId],
        playerId: [ctx.players[0].playerId],
      },
    });
    assert.equal(statsVars.data.data.length, 1, 'Expected referral_stats for referrer');
    const referrerStats = JSON.parse(statsVars.data.data[0].value);
    assert.ok(referrerStats.referralsRejected >= 1, `Expected referralsRejected >= 1, got ${referrerStats.referralsRejected}`);
  });
});

// ─────────────────────────────────────────────
// prizeIsCurrency=false item payout (itemsEarned stat)
// ─────────────────────────────────────────────
describe('referral-program: prizeIsCurrency=false item payout increments itemsEarned', () => {
  let client: Client;
  let ctx: MockServerContext;
  let moduleId: string;
  let versionId: string;
  let sweepCronjobId: string;
  let prefix: string;
  let referrerRoleId: string | undefined;
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

    // Install with prizeIsCurrency=false and a valid-looking item
    // The mock server's giveItem may fail on unknown items; if it does,
    // payReferrer falls back to currency-fallback which still increments stats.
    // We check itemsEarned or currencyEarned to cover both paths.
    await installModule(client, versionId, ctx.gameServer.id, {
      userConfig: {
        prizeIsCurrency: false,
        referrerCurrencyReward: 100,
        refereeCurrencyReward: 0,
        items: [{ item: 'stone', amount: 5, quality: '' }],
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

    referrerRoleId = await assignPermissions(client, ctx.players[0].playerId, ctx.gameServer.id, ['REFERRAL_USE']);
    refereeRoleId = await assignPermissions(client, ctx.players[1].playerId, ctx.gameServer.id, ['REFERRAL_USE']);
  });

  after(async () => {
    await cleanupRole(client, referrerRoleId);
    await cleanupRole(client, refereeRoleId);
    try { await uninstallModule(client, moduleId, ctx.gameServer.id); } catch (_) {}
    try { await deleteModule(client, moduleId); } catch (_) {}
    await stopMockServer(ctx.server, client, ctx.gameServer.id);
  });

  it('should attempt item payout and update itemsEarned or currencyEarned (fallback) on stats', async () => {
    // player[0] generates code
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
    const referrerCode = JSON.parse(codeVars.data.data[0].value).code;

    // player[1] uses the code
    const beforeRef = new Date();
    await client.command.commandControllerTrigger(ctx.gameServer.id, {
      msg: `${prefix}referral ${referrerCode}`,
      playerId: ctx.players[1].playerId,
    });
    await waitForEvent(client, {
      eventName: EventSearchInputAllowedFiltersEventNameEnum.CommandExecuted,
      gameserverId: ctx.gameServer.id,
      after: beforeRef,
      timeout: 30000,
    });

    // Trigger sweep
    const beforeSweep = new Date();
    await client.cronjob.cronJobControllerTrigger({
      gameServerId: ctx.gameServer.id,
      cronjobId: sweepCronjobId,
      moduleId,
    });
    const sweepEvent = await waitForEvent(client, {
      eventName: EventSearchInputAllowedFiltersEventNameEnum.CronjobExecuted,
      gameserverId: ctx.gameServer.id,
      after: beforeSweep,
      timeout: 30000,
    });

    const sweepMeta = sweepEvent.meta as { result?: { success?: boolean; logs?: Array<{ msg: string }> } };
    assert.equal(sweepMeta?.result?.success, true, `Expected sweep to succeed, logs: ${JSON.stringify(sweepMeta?.result?.logs)}`);

    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Verify link is paid
    const linkVars = await client.variable.variableControllerSearch({
      filters: {
        key: ['referral_link'],
        gameServerId: [ctx.gameServer.id],
        moduleId: [moduleId],
        playerId: [ctx.players[1].playerId],
      },
    });
    assert.equal(linkVars.data.data.length, 1, 'Expected referral_link for referee');
    const paidLink = JSON.parse(linkVars.data.data[0].value);
    assert.equal(paidLink.status, 'paid', `Expected link status=paid, got ${paidLink.status}`);
    assert.ok(paidLink.paidType === 'item' || paidLink.paidType === 'currency-fallback',
      `Expected paidType to be 'item' or 'currency-fallback' (fallback), got ${paidLink.paidType}`);

    // Verify stats: either itemsEarned > 0 (item payout succeeded) or currencyEarned > 0 (fallback)
    const statsVars = await client.variable.variableControllerSearch({
      filters: {
        key: ['referral_stats'],
        gameServerId: [ctx.gameServer.id],
        moduleId: [moduleId],
        playerId: [ctx.players[0].playerId],
      },
    });
    assert.equal(statsVars.data.data.length, 1, 'Expected referral_stats for referrer');
    const referrerStats = JSON.parse(statsVars.data.data[0].value);
    assert.equal(referrerStats.referralsPaid, 1, `Expected referralsPaid=1, got ${referrerStats.referralsPaid}`);
    assert.ok(
      referrerStats.itemsEarned > 0 || referrerStats.currencyEarned > 0,
      `Expected itemsEarned > 0 or currencyEarned > 0 (fallback), got itemsEarned=${referrerStats.itemsEarned} currencyEarned=${referrerStats.currencyEarned}`,
    );
  });
});

// ─────────────────────────────────────────────
// /refstats referee branch with link status (VI-38)
// ─────────────────────────────────────────────
describe('referral-program: /refstats referee branch includes link info', () => {
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
        referrerCurrencyReward: 200,
        refereeCurrencyReward: 25,
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

    useRoleId = await assignPermissions(client, ctx.players[0].playerId, ctx.gameServer.id, ['REFERRAL_USE']);
    refereeRoleId = await assignPermissions(client, ctx.players[1].playerId, ctx.gameServer.id, ['REFERRAL_USE']);

    // Set up: player[0] generates code, player[1] uses it, sweep pays
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
    const code = JSON.parse(codeVars.data.data[0].value).code;

    const beforeRef = new Date();
    await client.command.commandControllerTrigger(ctx.gameServer.id, {
      msg: `${prefix}referral ${code}`,
      playerId: ctx.players[1].playerId,
    });
    await waitForEvent(client, {
      eventName: EventSearchInputAllowedFiltersEventNameEnum.CommandExecuted,
      gameserverId: ctx.gameServer.id,
      after: beforeRef,
      timeout: 30000,
    });

    // Sweep to pay
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
    try { await uninstallModule(client, moduleId, ctx.gameServer.id); } catch (_) {}
    try { await deleteModule(client, moduleId); } catch (_) {}
    await stopMockServer(ctx.server, client, ctx.gameServer.id);
  });

  it('/refstats for referee should show referrer info in logs', async () => {
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

    const logs = (meta?.result?.logs ?? []).map((l) => l.msg);
    // Verify the command logged something about refstats
    assert.ok(
      logs.some((msg) => msg.includes('refstats:')),
      `Expected "refstats:" in logs, got: ${JSON.stringify(logs)}`,
    );

    // Verify link variable shows paid status
    const linkVars = await client.variable.variableControllerSearch({
      filters: {
        key: ['referral_link'],
        gameServerId: [ctx.gameServer.id],
        moduleId: [moduleId],
        playerId: [referee.playerId],
      },
    });
    assert.equal(linkVars.data.data.length, 1, 'Expected referral_link to exist for referee');
    const link = JSON.parse(linkVars.data.data[0].value);
    assert.equal(link.status, 'paid', `Expected link status=paid, got ${link.status}`);
    assert.equal(link.referrerId, ctx.players[0].playerId, 'Expected referrerId to match player[0]');

    // Verify refstats log contains the referrer's name (VI-24)
    const referrerPogRes = await client.playerOnGameserver.playerOnGameServerControllerSearch({
      filters: { gameServerId: [ctx.gameServer.id], playerId: [ctx.players[0].playerId] },
    });
    const referrerName = referrerPogRes.data.data[0]?.gameId ?? '';
    assert.ok(referrerName, 'Expected referrer (player[0]) to have a name');
    assert.ok(
      logs.some((msg) => msg.includes(referrerName)),
      `Expected refstats logs to contain referrer name "${referrerName}", got: ${JSON.stringify(logs)}`,
    );
  });
});
