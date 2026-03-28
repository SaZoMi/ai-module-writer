#!/usr/bin/env node
/**
 * Convert a Takaro export JSON into a local module directory structure.
 * Usage: node dist/scripts/json-to-module.js <json-file> [output-dir]
 * If output-dir is omitted, creates under ./modules/<module-name>/
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { TakaroModuleExport, ModuleVersion } from '../types/module.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const jsonFile = process.argv[2];
const outputDirArg = process.argv[3];

if (!jsonFile) {
  console.error('Usage: json-to-module.js <json-file> [output-dir]');
  process.exit(1);
}

interface WrappedExport {
  data?: TakaroModuleExport;
}

let raw: TakaroModuleExport | WrappedExport;
try {
  raw = JSON.parse(fs.readFileSync(jsonFile, 'utf-8'));
} catch (err) {
  console.error(`ERROR: Failed to parse JSON from '${jsonFile}': ${(err as Error).message}`);
  process.exit(1);
}

// Handle both raw export data and API-wrapped format (with .data envelope)
const data: TakaroModuleExport = (raw as WrappedExport).data ?? (raw as TakaroModuleExport);

if (!data.name) {
  console.error('ERROR: Export JSON is missing required field "name"');
  process.exit(1);
}

if (!data.versions || !Array.isArray(data.versions)) {
  console.error('ERROR: Export JSON is missing required field "versions"');
  process.exit(1);
}

const { name, author = 'Unknown', supportedGames = ['all'] } = data;

// Validate module name to prevent path traversal
if (name.includes('/') || name.includes('\\') || name.includes('..')) {
  console.error(`ERROR: Module name '${name}' contains invalid path characters`);
  process.exit(1);
}

// Pick the "latest" version, or the first one
const version: ModuleVersion | undefined =
  data.versions.find((v) => v.tag === 'latest') ?? data.versions[0];
if (!version) {
  console.error('ERROR: No versions found in export');
  process.exit(1);
}

// __dirname is dist/scripts/ — go up 2 levels to reach repo root
const repoDir = path.resolve(__dirname, '..', '..');
const outputDir = outputDirArg ?? path.join(repoDir, 'modules', name);

console.error(`Extracting module '${name}' to ${outputDir}`);
fs.mkdirSync(outputDir, { recursive: true });

// Write module.json
fs.writeFileSync(
  path.join(outputDir, 'module.json'),
  JSON.stringify(
    {
      name,
      author,
      description: version.description ?? 'No description',
      version: version.tag ?? 'latest',
      supportedGames,
    },
    null,
    2,
  ) + '\n',
);

// Write config.json
try {
  const configSchema =
    typeof version.configSchema === 'string'
      ? JSON.parse(version.configSchema)
      : (version.configSchema ?? {});
  fs.writeFileSync(path.join(outputDir, 'config.json'), JSON.stringify(configSchema, null, 2) + '\n');
} catch (err) {
  console.error(`WARN: Failed to parse configSchema, falling back to {}: ${(err as Error).message}`);
  fs.writeFileSync(path.join(outputDir, 'config.json'), '{}\n');
}

// Write uiSchema.json (only if non-empty)
try {
  const uiSchema =
    typeof version.uiSchema === 'string'
      ? JSON.parse(version.uiSchema)
      : (version.uiSchema ?? {});
  if (Object.keys(uiSchema).length > 0) {
    fs.writeFileSync(path.join(outputDir, 'uiSchema.json'), JSON.stringify(uiSchema, null, 2) + '\n');
  }
} catch (err) {
  console.error(`WARN: Failed to parse uiSchema, skipping: ${(err as Error).message}`);
}

function validateEntityName(entityName: string, entityType: string): void {
  if (entityName.includes('/') || entityName.includes('\\') || entityName.includes('..')) {
    console.error(`ERROR: ${entityType} name '${entityName}' contains invalid path characters`);
    process.exit(1);
  }
}

// Extract commands into src/commands/
if (version.commands && version.commands.length > 0) {
  const cmdsDir = path.join(outputDir, 'src', 'commands');
  fs.mkdirSync(cmdsDir, { recursive: true });
  for (const cmd of version.commands) {
    validateEntityName(cmd.name, 'command');
    const cmdDir = path.join(cmdsDir, cmd.name);
    fs.mkdirSync(cmdDir, { recursive: true });
    fs.writeFileSync(path.join(cmdDir, 'index.js'), cmd.function);
    fs.writeFileSync(
      path.join(cmdDir, 'command.json'),
      JSON.stringify(
        {
          trigger: cmd.trigger,
          description: cmd.description ?? null,
          helpText: cmd.helpText ?? 'No help text available',
          arguments: cmd.arguments ?? [],
        },
        null,
        2,
      ) + '\n',
    );
    console.error(`  command: ${cmd.name}`);
  }
}

// Extract hooks into src/hooks/
if (version.hooks && version.hooks.length > 0) {
  const hooksDir = path.join(outputDir, 'src', 'hooks');
  fs.mkdirSync(hooksDir, { recursive: true });
  for (const hook of version.hooks) {
    validateEntityName(hook.name, 'hook');
    const hookDir = path.join(hooksDir, hook.name);
    fs.mkdirSync(hookDir, { recursive: true });
    fs.writeFileSync(path.join(hookDir, 'index.js'), hook.function);
    fs.writeFileSync(
      path.join(hookDir, 'hook.json'),
      JSON.stringify(
        {
          eventType: hook.eventType,
          description: hook.description ?? null,
          regex: hook.regex ?? null,
        },
        null,
        2,
      ) + '\n',
    );
    console.error(`  hook: ${hook.name}`);
  }
}

// Extract cronjobs into src/cronjobs/
if (version.cronJobs && version.cronJobs.length > 0) {
  const cronDir = path.join(outputDir, 'src', 'cronjobs');
  fs.mkdirSync(cronDir, { recursive: true });
  for (const cron of version.cronJobs) {
    validateEntityName(cron.name, 'cronjob');
    const cjDir = path.join(cronDir, cron.name);
    fs.mkdirSync(cjDir, { recursive: true });
    fs.writeFileSync(path.join(cjDir, 'index.js'), cron.function);
    fs.writeFileSync(
      path.join(cjDir, 'cronjob.json'),
      JSON.stringify(
        {
          temporalValue: cron.temporalValue,
          description: cron.description ?? null,
        },
        null,
        2,
      ) + '\n',
    );
    console.error(`  cronjob: ${cron.name}`);
  }
}

// Extract functions into src/functions/
if (version.functions && version.functions.length > 0) {
  const fnDir = path.join(outputDir, 'src', 'functions');
  fs.mkdirSync(fnDir, { recursive: true });
  for (const fn of version.functions) {
    validateEntityName(fn.name, 'function');
    fs.writeFileSync(path.join(fnDir, `${fn.name}.js`), fn.function);
    console.error(`  function: ${fn.name}`);
  }
}

// Extract permissions
if (version.permissions && version.permissions.length > 0) {
  fs.writeFileSync(
    path.join(outputDir, 'permissions.json'),
    JSON.stringify(version.permissions, null, 2) + '\n',
  );
  console.error(`  permissions: ${version.permissions.length} entries`);
}

console.error(`Done. Module extracted to ${outputDir}`);
