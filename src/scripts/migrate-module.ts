#!/usr/bin/env node
/**
 * One-time migration script: consolidates the old scattered JSON files into a
 * single module.json per module, then deletes the old files.
 *
 * Usage: node dist/scripts/migrate-module.js <module-dir>
 */
import fs from 'fs';
import path from 'path';
import {
  LocalModuleJson,
  LocalCommandDef,
  LocalHookDef,
  LocalCronJobDef,
  LocalFunctionDef,
  CommandArgument,
  ModulePermission,
} from '../types/module.js';

const moduleDir = process.argv[2];

if (!moduleDir) {
  console.error('Usage: migrate-module.js <module-dir>');
  process.exit(1);
}

if (!fs.existsSync(moduleDir) || !fs.statSync(moduleDir).isDirectory()) {
  console.error(`ERROR: ${moduleDir} is not a directory`);
  process.exit(1);
}

const moduleJsonPath = path.join(moduleDir, 'module.json');
if (!fs.existsSync(moduleJsonPath)) {
  console.error(`ERROR: ${moduleJsonPath} not found`);
  process.exit(1);
}

// Read old module.json
let oldMeta: {
  name?: string;
  author?: string;
  description?: string;
  version?: string;
  supportedGames?: string[];
  [key: string]: unknown;
};
try {
  oldMeta = JSON.parse(fs.readFileSync(moduleJsonPath, 'utf-8'));
} catch (err) {
  console.error(`ERROR: Failed to parse '${moduleJsonPath}': ${(err as Error).message}`);
  process.exit(1);
}

if (!oldMeta.name || oldMeta.name.trim() === '') {
  console.error(`ERROR: '${moduleJsonPath}' is missing required field 'name'`);
  process.exit(1);
}

// Detect if already migrated (has commands/hooks/cronJobs/functions keys)
if (
  oldMeta['commands'] !== undefined ||
  oldMeta['hooks'] !== undefined ||
  oldMeta['cronJobs'] !== undefined ||
  oldMeta['functions'] !== undefined
) {
  console.error(`INFO: ${moduleDir} appears to already be migrated (has commands/hooks/cronJobs/functions keys), skipping.`);
  process.exit(0);
}

console.error(`Migrating ${moduleDir}...`);

// Build new consolidated module.json
const newModule: LocalModuleJson = {
  name: oldMeta.name,
  description: oldMeta.description,
  version: oldMeta.version ?? 'latest',
  supportedGames: oldMeta.supportedGames ?? ['all'],
};

if (oldMeta.author) {
  newModule.author = oldMeta.author;
}

// Read config.json
const configPath = path.join(moduleDir, 'config.json');
if (fs.existsSync(configPath)) {
  let config: Record<string, unknown>;
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
  } catch (err) {
    console.error(`ERROR: Failed to parse 'config.json': ${(err as Error).message}`);
    process.exit(1);
  }
  newModule.config = config;
  console.error(`  read config.json`);
}

// Read uiSchema.json
const uiSchemaPath = path.join(moduleDir, 'uiSchema.json');
if (fs.existsSync(uiSchemaPath)) {
  let uiSchema: Record<string, unknown>;
  try {
    uiSchema = JSON.parse(fs.readFileSync(uiSchemaPath, 'utf-8')) as Record<string, unknown>;
  } catch (err) {
    console.error(`ERROR: Failed to parse 'uiSchema.json': ${(err as Error).message}`);
    process.exit(1);
  }
  if (Object.keys(uiSchema).length > 0) {
    newModule.uiSchema = uiSchema;
  }
  console.error(`  read uiSchema.json`);
}

// Read permissions.json
const permPath = path.join(moduleDir, 'permissions.json');
if (fs.existsSync(permPath)) {
  let permissions: ModulePermission[];
  try {
    permissions = JSON.parse(fs.readFileSync(permPath, 'utf-8')) as ModulePermission[];
  } catch (err) {
    console.error(`ERROR: Failed to parse 'permissions.json': ${(err as Error).message}`);
    process.exit(1);
  }
  if (permissions.length > 0) {
    newModule.permissions = permissions;
  }
  console.error(`  read permissions.json (${permissions.length} entries)`);
}

// Resolve src subdir
function resolveSrcDir(base: string, subdir: string): string | null {
  const srcPath = path.join(base, 'src', subdir);
  if (fs.existsSync(srcPath)) return srcPath;
  return null;
}

// Read commands
const commandsDir = resolveSrcDir(moduleDir, 'commands');
if (commandsDir) {
  const commands: Record<string, LocalCommandDef> = {};
  for (const entry of fs.readdirSync(commandsDir)) {
    const cmdDir = path.join(commandsDir, entry);
    if (!fs.statSync(cmdDir).isDirectory()) continue;

    const codePath = path.join(cmdDir, 'index.js');
    if (!fs.existsSync(codePath)) {
      console.error(`  WARN: ${codePath} not found, skipping command ${entry}`);
      continue;
    }

    const metaPath = path.join(cmdDir, 'command.json');
    let cmdMeta: Partial<LocalCommandDef> & { arguments?: CommandArgument[] } = {
      trigger: entry,
      description: null,
      helpText: 'No help text available',
      arguments: [],
    };
    if (fs.existsSync(metaPath)) {
      let parsed: typeof cmdMeta;
      try {
        parsed = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as typeof cmdMeta;
      } catch (err) {
        console.error(`ERROR: Failed to parse '${metaPath}': ${(err as Error).message}`);
        process.exit(1);
      }
      cmdMeta = { ...cmdMeta, ...parsed };
    }

    // Use relative path from module root
    const relPath = path.relative(moduleDir, codePath).replace(/\\/g, '/');
    commands[entry] = {
      trigger: cmdMeta.trigger ?? entry,
      description: cmdMeta.description ?? null,
      helpText: cmdMeta.helpText ?? 'No help text available',
      function: relPath,
      arguments: cmdMeta.arguments ?? [],
    };
    console.error(`  command: ${entry}`);
  }
  if (Object.keys(commands).length > 0) {
    newModule.commands = commands;
  }
}

// Read hooks
const hooksDir = resolveSrcDir(moduleDir, 'hooks');
if (hooksDir) {
  const hooks: Record<string, LocalHookDef> = {};
  for (const entry of fs.readdirSync(hooksDir)) {
    const hookDir = path.join(hooksDir, entry);
    if (!fs.statSync(hookDir).isDirectory()) continue;

    const codePath = path.join(hookDir, 'index.js');
    if (!fs.existsSync(codePath)) {
      console.error(`  WARN: ${codePath} not found, skipping hook ${entry}`);
      continue;
    }

    const metaPath = path.join(hookDir, 'hook.json');
    if (!fs.existsSync(metaPath)) {
      console.error(`  ERROR: ${metaPath} is required (need eventType), skipping hook ${entry}`);
      continue;
    }

    let hookMeta: Record<string, unknown>;
    try {
      hookMeta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as Record<string, unknown>;
    } catch (err) {
      console.error(`ERROR: Failed to parse '${metaPath}': ${(err as Error).message}`);
      process.exit(1);
    }
    if (!hookMeta['eventType']) {
      console.error(`  ERROR: '${metaPath}' is missing required field 'eventType', skipping`);
      continue;
    }

    const relPath = path.relative(moduleDir, codePath).replace(/\\/g, '/');
    const hookDef: LocalHookDef = {
      eventType: hookMeta['eventType'] as string,
      description: (hookMeta['description'] as string | null) ?? null,
      function: relPath,
    };
    if (hookMeta['regex'] != null) {
      hookDef.regex = hookMeta['regex'] as string;
    }
    hooks[entry] = hookDef;
    console.error(`  hook: ${entry}`);
  }
  if (Object.keys(hooks).length > 0) {
    newModule.hooks = hooks;
  }
}

// Read cronjobs
const cronDir = resolveSrcDir(moduleDir, 'cronjobs');
if (cronDir) {
  const cronJobs: Record<string, LocalCronJobDef> = {};
  for (const entry of fs.readdirSync(cronDir)) {
    const cjDir = path.join(cronDir, entry);
    if (!fs.statSync(cjDir).isDirectory()) continue;

    const codePath = path.join(cjDir, 'index.js');
    if (!fs.existsSync(codePath)) {
      console.error(`  WARN: ${codePath} not found, skipping cronjob ${entry}`);
      continue;
    }

    const metaPath = path.join(cjDir, 'cronjob.json');
    if (!fs.existsSync(metaPath)) {
      console.error(`  ERROR: ${metaPath} is required (need temporalValue), skipping cronjob ${entry}`);
      continue;
    }

    let cronMeta: Record<string, unknown>;
    try {
      cronMeta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as Record<string, unknown>;
    } catch (err) {
      console.error(`ERROR: Failed to parse '${metaPath}': ${(err as Error).message}`);
      process.exit(1);
    }
    if (!cronMeta['temporalValue']) {
      console.error(`  ERROR: '${metaPath}' is missing required field 'temporalValue', skipping`);
      continue;
    }

    const relPath = path.relative(moduleDir, codePath).replace(/\\/g, '/');
    cronJobs[entry] = {
      temporalValue: cronMeta['temporalValue'] as string,
      description: (cronMeta['description'] as string | null) ?? null,
      function: relPath,
    };
    console.error(`  cronjob: ${entry}`);
  }
  if (Object.keys(cronJobs).length > 0) {
    newModule.cronJobs = cronJobs;
  }
}

// Read functions
const functionsDir = resolveSrcDir(moduleDir, 'functions');
if (functionsDir) {
  const functions: Record<string, LocalFunctionDef> = {};
  for (const entry of fs.readdirSync(functionsDir)) {
    if (!entry.endsWith('.js')) continue;
    const codePath = path.join(functionsDir, entry);
    const relPath = path.relative(moduleDir, codePath).replace(/\\/g, '/');
    const fnName = entry.replace(/\.js$/, '');
    functions[fnName] = { function: relPath };
    console.error(`  function: ${fnName}`);
  }
  if (Object.keys(functions).length > 0) {
    newModule.functions = functions;
  }
}

// Write new consolidated module.json
const newModuleJson = JSON.stringify(newModule, null, 2) + '\n';
fs.writeFileSync(moduleJsonPath, newModuleJson);

// Verify write succeeded by reading back and parsing
try {
  const readBack = fs.readFileSync(moduleJsonPath, 'utf-8');
  JSON.parse(readBack);
} catch (err) {
  console.error(`ERROR: Failed to verify written module.json: ${(err as Error).message}`);
  console.error('Aborting — old files NOT deleted to preserve data');
  process.exit(1);
}
console.error(`  wrote module.json`);

// Delete old scattered JSON files
const filesToDelete: string[] = [];

if (fs.existsSync(configPath)) filesToDelete.push(configPath);
if (fs.existsSync(uiSchemaPath)) filesToDelete.push(uiSchemaPath);
if (fs.existsSync(permPath)) filesToDelete.push(permPath);

// Delete command.json, hook.json, cronjob.json files
function findAndDeleteEntityJsons(dir: string, filename: string): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir)) {
    const entityDir = path.join(dir, entry);
    if (!fs.statSync(entityDir).isDirectory()) continue;
    const jsonPath = path.join(entityDir, filename);
    if (fs.existsSync(jsonPath)) filesToDelete.push(jsonPath);
  }
}

if (commandsDir) findAndDeleteEntityJsons(commandsDir, 'command.json');
if (hooksDir) findAndDeleteEntityJsons(hooksDir, 'hook.json');
if (cronDir) findAndDeleteEntityJsons(cronDir, 'cronjob.json');

for (const f of filesToDelete) {
  fs.unlinkSync(f);
  console.error(`  deleted ${path.relative(moduleDir, f)}`);
}

console.error(`Done. ${moduleDir} migrated to consolidated module.json`);
