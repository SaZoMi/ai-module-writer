#!/usr/bin/env node
// Convert a local module directory into the Takaro import JSON format.
// Usage: node module-to-json.js <module-dir> [output-file]
const fs = require('fs');
const path = require('path');

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

const meta = JSON.parse(fs.readFileSync(moduleJsonPath, 'utf-8'));

// Config schema (must be a stringified JSON in the export format)
let configSchema = '{"$schema":"http://json-schema.org/draft-07/schema#","type":"object","properties":{},"required":[],"additionalProperties":false}';
const configPath = path.join(moduleDir, 'config.json');
if (fs.existsSync(configPath)) {
  configSchema = JSON.stringify(JSON.parse(fs.readFileSync(configPath, 'utf-8')));
}

// UI schema
let uiSchema = '{}';
const uiSchemaPath = path.join(moduleDir, 'uiSchema.json');
if (fs.existsSync(uiSchemaPath)) {
  uiSchema = JSON.stringify(JSON.parse(fs.readFileSync(uiSchemaPath, 'utf-8')));
}

// Commands
const commands = [];
const commandsDir = path.join(moduleDir, 'commands');
if (fs.existsSync(commandsDir)) {
  for (const entry of fs.readdirSync(commandsDir)) {
    const cmdDir = path.join(commandsDir, entry);
    if (!fs.statSync(cmdDir).isDirectory()) continue;

    const codePath = path.join(cmdDir, 'index.js');
    if (!fs.existsSync(codePath)) {
      console.error(`WARN: ${codePath} not found, skipping`);
      continue;
    }

    const code = fs.readFileSync(codePath, 'utf-8');
    const metaPath = path.join(cmdDir, 'command.json');
    let cmdMeta = { trigger: entry, description: null, helpText: 'No help text available', arguments: [] };
    if (fs.existsSync(metaPath)) {
      cmdMeta = { ...cmdMeta, ...JSON.parse(fs.readFileSync(metaPath, 'utf-8')) };
    }

    commands.push({
      name: entry,
      trigger: cmdMeta.trigger || entry,
      description: cmdMeta.description || null,
      helpText: cmdMeta.helpText || 'No help text available',
      function: code,
      arguments: cmdMeta.arguments || [],
    });
  }
}

// Hooks
const hooks = [];
const hooksDir = path.join(moduleDir, 'hooks');
if (fs.existsSync(hooksDir)) {
  for (const entry of fs.readdirSync(hooksDir)) {
    const hookDir = path.join(hooksDir, entry);
    if (!fs.statSync(hookDir).isDirectory()) continue;

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
    const hookMeta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));

    hooks.push({
      name: entry,
      eventType: hookMeta.eventType,
      description: hookMeta.description || null,
      regex: hookMeta.regex || null,
      function: code,
    });
  }
}

// Cronjobs
const cronJobs = [];
const cronDir = path.join(moduleDir, 'cronjobs');
if (fs.existsSync(cronDir)) {
  for (const entry of fs.readdirSync(cronDir)) {
    const cjDir = path.join(cronDir, entry);
    if (!fs.statSync(cjDir).isDirectory()) continue;

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
    const cronMeta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));

    cronJobs.push({
      name: entry,
      temporalValue: cronMeta.temporalValue,
      description: cronMeta.description || null,
      function: code,
    });
  }
}

// Functions
const functions = [];
const functionsDir = path.join(moduleDir, 'functions');
if (fs.existsSync(functionsDir)) {
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
let permissions = [];
const permPath = path.join(moduleDir, 'permissions.json');
if (fs.existsSync(permPath)) {
  permissions = JSON.parse(fs.readFileSync(permPath, 'utf-8'));
}

// Assemble
const result = {
  takaroVersion: '0.0.0',
  name: meta.name,
  author: meta.author || 'Unknown',
  supportedGames: meta.supportedGames || ['all'],
  versions: [{
    tag: meta.version || 'latest',
    description: meta.description || 'No description',
    configSchema,
    uiSchema,
    commands,
    hooks,
    cronJobs,
    functions,
    permissions,
  }],
};

const json = JSON.stringify(result, null, 2);

if (outputFile) {
  fs.writeFileSync(outputFile, json);
  console.error(`Written to ${outputFile}`);
} else {
  console.log(json);
}
