import { execFileSync, SpawnSyncReturns } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import os from 'os';
import { Client, ModuleOutputDTO, SettingsControllerGetKeysEnum } from '@takaro/apiclient';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Absolute path to the repo root */
const REPO_ROOT = path.resolve(__dirname, '..', '..');

/** Path to the compiled module-to-json script */
const MODULE_TO_JSON_SCRIPT = path.join(REPO_ROOT, 'dist', 'scripts', 'module-to-json.js');

export interface InstallModuleConfig {
  userConfig?: Record<string, unknown>;
  systemConfig?: Record<string, unknown>;
}

/**
 * Push a local module to Takaro via the import API.
 * If a module with the same name already exists, deletes it first (idempotent).
 * Returns the imported module (found by name from module.json).
 */
export async function pushModule(
  client: Client,
  moduleDir: string,
): Promise<ModuleOutputDTO> {
  const absoluteModuleDir = path.resolve(moduleDir);

  // Convert the module dir to JSON using the compiled script
  const tempFile = path.join(os.tmpdir(), `takaro-push-${Date.now()}.json`);
  try {
    try {
      execFileSync(process.execPath, [MODULE_TO_JSON_SCRIPT, absoluteModuleDir, tempFile], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      const spawnErr = err as SpawnSyncReturns<Buffer>;
      const stderr = spawnErr.stderr?.toString().trim() ?? '';
      throw new Error(
        `module-to-json failed for '${absoluteModuleDir}'${stderr ? `:\n${stderr}` : ' (no stderr output — is dist/ built?)'}`
      );
    }

    let moduleJson: { name: string };
    try {
      moduleJson = JSON.parse(fs.readFileSync(tempFile, 'utf-8'));
    } catch (err) {
      throw new Error(`Failed to parse module-to-json output from '${tempFile}': ${err}`);
    }
    const { name } = moduleJson;

    // Delete any existing module with this name before importing (idempotent push)
    const existing = await client.module.moduleControllerSearch({
      filters: { name: [name] },
    });
    const existingModule = existing.data.data.find((m) => m.name === name);
    if (existingModule) {
      await client.module.moduleControllerRemove(existingModule.id);
    }

    // Import via API (returns void — second search below retrieves the module data)
    try {
      await client.module.moduleControllerImport(moduleJson);
    } catch (err) {
      if (existingModule) {
        throw new Error(
          `Import of '${name}' failed. Previous module version was deleted before this import failure. Cause: ${err}`,
        );
      }
      throw err;
    }

    // Find the module by name after import (import API returns void, no module data in response)
    const searchResult = await client.module.moduleControllerSearch({
      filters: { name: [name] },
    });

    const found = searchResult.data.data.find((m) => m.name === name);
    if (!found) throw new Error(`Module '${name}' not found after import`);

    return found;
  } finally {
    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
  }
}

/**
 * Install a module version on a game server.
 */
export async function installModule(
  client: Client,
  versionId: string,
  gameServerId: string,
  config?: InstallModuleConfig,
): Promise<void> {
  await client.module.moduleInstallationsControllerInstallModule({
    versionId,
    gameServerId,
    userConfig: config?.userConfig ? JSON.stringify(config.userConfig) : undefined,
    systemConfig: config?.systemConfig ? JSON.stringify(config.systemConfig) : undefined,
  });
}

/**
 * Uninstall a module from a game server.
 */
export async function uninstallModule(
  client: Client,
  moduleId: string,
  gameServerId: string,
): Promise<void> {
  await client.module.moduleInstallationsControllerUninstallModule(moduleId, gameServerId);
}

/**
 * Delete a module entirely from Takaro.
 */
export async function deleteModule(client: Client, moduleId: string): Promise<void> {
  await client.module.moduleControllerRemove(moduleId);
}

/**
 * Get the command prefix configured for a game server.
 */
export async function getCommandPrefix(client: Client, gameServerId: string): Promise<string> {
  const result = await client.settings.settingsControllerGet(
    [SettingsControllerGetKeysEnum.CommandPrefix],
    gameServerId,
  );
  const setting = result.data.data[0];
  return setting?.value ?? '/';
}

/**
 * Delete all modules whose names start with 'test-' (safety net cleanup).
 * Always re-fetches page 0 until no results remain, to avoid pagination
 * shift bugs when items are deleted from the current page.
 */
export async function cleanupTestModules(client: Client): Promise<void> {
  const limit = 100;
  const MAX_ITERATIONS = 50;
  let iterations = 0;
  while (true) {
    if (++iterations > MAX_ITERATIONS) {
      throw new Error(`cleanupTestModules exceeded ${MAX_ITERATIONS} iterations — possible infinite loop`);
    }
    const result = await client.module.moduleControllerSearch({
      limit,
      page: 0,
    });
    const mods = result.data.data.filter((m) => m.name.startsWith('test-'));
    if (mods.length === 0) break;
    for (const mod of mods) {
      await client.module.moduleControllerRemove(mod.id);
    }
  }
}

/**
 * Delete all game servers whose names start with 'test-' (orphan cleanup).
 * Mock servers register with identityToken as the name (e.g. 'test-<uuid>').
 * These are left behind when tests crash before after() runs.
 */
export async function cleanupTestGameServers(client: Client): Promise<void> {
  const limit = 100;
  const MAX_ITERATIONS = 50;
  let iterations = 0;
  while (true) {
    if (++iterations > MAX_ITERATIONS) {
      throw new Error(`cleanupTestGameServers exceeded ${MAX_ITERATIONS} iterations — possible infinite loop`);
    }
    const result = await client.gameserver.gameServerControllerSearch({
      limit,
      page: 0,
    });
    const servers = result.data.data.filter((gs) => gs.name.startsWith('test-'));
    if (servers.length === 0) break;
    for (const gs of servers) {
      await client.gameserver.gameServerControllerRemove(gs.id);
    }
  }
}
