#!/usr/bin/env node
/**
 * Convert a local module directory into the Takaro import JSON format.
 * Usage: node dist/scripts/module-to-json.js <module-dir> [output-file]
 */
import fs from 'fs';
import path from 'path';
import {
  TakaroModuleExport,
  ModuleMeta,
  ModuleCommand,
  ModuleHook,
  ModuleCronJob,
  ModuleFunction,
  ModulePermission,
  CommandArgument,
} from '../types/module.js';

const moduleDir = process.argv[2];
const outputFile = process.argv[3];

if (!moduleDir) {
  console.error('Usage: module-to-json.js <module-dir> [output-file]');
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

let meta: ModuleMeta;
try {
  meta = JSON.parse(fs.readFileSync(moduleJsonPath, 'utf-8'));
} catch (err) {
  console.error(`ERROR: Failed to parse '${moduleJsonPath}': ${(err as Error).message}`);
  process.exit(1);
}

if (!meta.name || meta.name.trim() === '') {
  console.error(`ERROR: '${moduleJsonPath}' is missing required field 'name'`);
  process.exit(1);
}

/**
 * Resolve a subdirectory within a module dir.
 * Checks src/<subdir> first, falls back to <subdir> for backward compatibility.
 */
function resolveDir(base: string, subdir: string): string | null {
  const srcPath = path.join(base, 'src', subdir);
  if (fs.existsSync(srcPath)) return srcPath;
  const directPath = path.join(base, subdir);
  if (fs.existsSync(directPath)) return directPath;
  return null;
}

// Config schema
let configSchema =
  '{"$schema":"http://json-schema.org/draft-07/schema#","type":"object","properties":{},"required":[],"additionalProperties":false}';
const configPath = path.join(moduleDir, 'config.json');
if (fs.existsSync(configPath)) {
  try {
    configSchema = JSON.stringify(JSON.parse(fs.readFileSync(configPath, 'utf-8')));
  } catch (err) {
    console.error(`ERROR: Failed to parse '${configPath}': ${(err as Error).message}`);
    process.exit(1);
  }
}

// UI schema
let uiSchema = '{}';
const uiSchemaPath = path.join(moduleDir, 'uiSchema.json');
if (fs.existsSync(uiSchemaPath)) {
  try {
    uiSchema = JSON.stringify(JSON.parse(fs.readFileSync(uiSchemaPath, 'utf-8')));
  } catch (err) {
    console.error(`ERROR: Failed to parse '${uiSchemaPath}': ${(err as Error).message}`);
    process.exit(1);
  }
}

// Commands
const commands: ModuleCommand[] = [];
const commandsDir = resolveDir(moduleDir, 'commands');
if (commandsDir) {
  for (const entry of fs.readdirSync(commandsDir)) {
    const cmdDir = path.join(commandsDir, entry);
    let cmdStat;
    try {
      cmdStat = fs.statSync(cmdDir);
    } catch {
      console.error(`WARN: ${cmdDir} could not be stat'd (broken symlink?), skipping`);
      continue;
    }
    if (!cmdStat.isDirectory()) {
      // Warn if it looks like a misplaced command file (e.g. index.js at top level)
      if (entry.endsWith('.js') || entry.endsWith('.json')) {
        console.error(`WARN: ${path.join(commandsDir, entry)} is a file, not a directory — expected a command subdirectory, skipping`);
      }
      continue;
    }

    const codePath = path.join(cmdDir, 'index.js');
    if (!fs.existsSync(codePath)) {
      console.error(`WARN: ${codePath} not found, skipping`);
      continue;
    }

    const code = fs.readFileSync(codePath, 'utf-8');
    const metaPath = path.join(cmdDir, 'command.json');
    let cmdMeta: Partial<ModuleCommand> & { arguments?: CommandArgument[] } = {
      trigger: entry,
      description: null,
      helpText: 'No help text available',
      arguments: [],
    };
    if (fs.existsSync(metaPath)) {
      try {
        cmdMeta = { ...cmdMeta, ...JSON.parse(fs.readFileSync(metaPath, 'utf-8')) };
      } catch (err) {
        console.error(`ERROR: Failed to parse '${metaPath}': ${(err as Error).message}`);
        process.exit(1);
      }
    }

    commands.push({
      name: entry,
      trigger: cmdMeta.trigger ?? entry,
      description: cmdMeta.description ?? null,
      helpText: cmdMeta.helpText ?? 'No help text available',
      function: code,
      arguments: cmdMeta.arguments ?? [],
    });
  }
}

// Hooks
const hooks: ModuleHook[] = [];
const hooksDir = resolveDir(moduleDir, 'hooks');
if (hooksDir) {
  for (const entry of fs.readdirSync(hooksDir)) {
    const hookDir = path.join(hooksDir, entry);
    let hookStat;
    try {
      hookStat = fs.statSync(hookDir);
    } catch {
      console.error(`WARN: ${hookDir} could not be stat'd (broken symlink?), skipping`);
      continue;
    }
    if (!hookStat.isDirectory()) {
      if (entry.endsWith('.js') || entry.endsWith('.json')) {
        console.error(`WARN: ${path.join(hooksDir, entry)} is a file, not a directory — expected a hook subdirectory, skipping`);
      }
      continue;
    }

    const codePath = path.join(hookDir, 'index.js');
    if (!fs.existsSync(codePath)) {
      console.error(`WARN: ${codePath} not found, skipping`);
      continue;
    }

    const metaPath = path.join(hookDir, 'hook.json');
    if (!fs.existsSync(metaPath)) {
      console.error(`ERROR: ${metaPath} is required (need eventType)`);
      process.exit(1);
    }

    const code = fs.readFileSync(codePath, 'utf-8');
    let hookMeta: Record<string, unknown>;
    try {
      hookMeta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    } catch (err) {
      console.error(`ERROR: Failed to parse '${metaPath}': ${(err as Error).message}`);
      process.exit(1);
    }

    if (!hookMeta['eventType']) {
      console.error(`ERROR: '${metaPath}' is missing required field 'eventType'`);
      process.exit(1);
    }

    hooks.push({
      name: entry,
      eventType: hookMeta['eventType'] as string,
      description: (hookMeta['description'] as string | null) ?? null,
      regex: (hookMeta['regex'] as string | null) ?? null,
      function: code,
    });
  }
}

// Cronjobs
const cronJobs: ModuleCronJob[] = [];
const cronDir = resolveDir(moduleDir, 'cronjobs');
if (cronDir) {
  for (const entry of fs.readdirSync(cronDir)) {
    const cjDir = path.join(cronDir, entry);
    let cjStat;
    try {
      cjStat = fs.statSync(cjDir);
    } catch {
      console.error(`WARN: ${cjDir} could not be stat'd (broken symlink?), skipping`);
      continue;
    }
    if (!cjStat.isDirectory()) {
      if (entry.endsWith('.js') || entry.endsWith('.json')) {
        console.error(`WARN: ${path.join(cronDir, entry)} is a file, not a directory — expected a cronjob subdirectory, skipping`);
      }
      continue;
    }

    const codePath = path.join(cjDir, 'index.js');
    if (!fs.existsSync(codePath)) {
      console.error(`WARN: ${codePath} not found, skipping`);
      continue;
    }

    const metaPath = path.join(cjDir, 'cronjob.json');
    if (!fs.existsSync(metaPath)) {
      console.error(`ERROR: ${metaPath} is required (need temporalValue)`);
      process.exit(1);
    }

    const code = fs.readFileSync(codePath, 'utf-8');
    let cronMeta: Record<string, unknown>;
    try {
      cronMeta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    } catch (err) {
      console.error(`ERROR: Failed to parse '${metaPath}': ${(err as Error).message}`);
      process.exit(1);
    }

    if (!cronMeta['temporalValue']) {
      console.error(`ERROR: '${metaPath}' is missing required field 'temporalValue'`);
      process.exit(1);
    }

    cronJobs.push({
      name: entry,
      temporalValue: cronMeta['temporalValue'] as string,
      description: (cronMeta['description'] as string | null) ?? null,
      function: code,
    });
  }
}

// Functions
const functions: ModuleFunction[] = [];
const functionsDir = resolveDir(moduleDir, 'functions');
if (functionsDir) {
  for (const entry of fs.readdirSync(functionsDir)) {
    if (!entry.endsWith('.js')) continue;
    const code = fs.readFileSync(path.join(functionsDir, entry), 'utf-8');
    functions.push({
      name: entry.replace(/\.js$/, ''),
      function: code,
    });
  }
}

// Permissions
let permissions: ModulePermission[] = [];
const permPath = path.join(moduleDir, 'permissions.json');
if (fs.existsSync(permPath)) {
  try {
    permissions = JSON.parse(fs.readFileSync(permPath, 'utf-8'));
  } catch (err) {
    console.error(`ERROR: Failed to parse '${permPath}': ${(err as Error).message}`);
    process.exit(1);
  }
}

const result: TakaroModuleExport = {
  takaroVersion: '0.0.0',
  name: meta.name,
  author: meta.author ?? 'Unknown',
  supportedGames: meta.supportedGames ?? ['all'],
  versions: [
    {
      tag: meta.version ?? 'latest',
      description: meta.description ?? 'No description',
      configSchema,
      uiSchema,
      commands,
      hooks,
      cronJobs,
      functions,
      permissions,
    },
  ],
};

const json = JSON.stringify(result, null, 2);

if (outputFile) {
  fs.writeFileSync(outputFile, json);
  console.error(`Written to ${outputFile}`);
} else {
  console.log(json);
}
