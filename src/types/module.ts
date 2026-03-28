/**
 * Shared type definitions for Takaro module structure.
 * Used by conversion scripts and test helpers.
 */

export interface CommandArgument {
  name: string;
  type: string;
  defaultValue?: string | null;
  helpText?: string;
  position?: number;
}

export interface ModuleCommand {
  name: string;
  trigger: string;
  description: string | null;
  helpText: string;
  function: string;
  arguments: CommandArgument[];
}

export interface ModuleHook {
  name: string;
  eventType: string;
  description: string | null;
  regex: string | null;
  function: string;
}

export interface ModuleCronJob {
  name: string;
  temporalValue: string;
  description: string | null;
  function: string;
}

export interface ModuleFunction {
  name: string;
  function: string;
}

export interface ModulePermission {
  permission: string;
  friendlyName: string;
  description: string;
  canHaveCount?: boolean;
}

export interface ModuleVersion {
  tag: string;
  description: string;
  configSchema: string;
  uiSchema: string;
  commands: ModuleCommand[];
  hooks: ModuleHook[];
  cronJobs: ModuleCronJob[];
  functions: ModuleFunction[];
  permissions: ModulePermission[];
}

/** The format for importing/exporting a module to/from Takaro */
export interface TakaroModuleExport {
  takaroVersion: string;
  name: string;
  author: string;
  supportedGames: string[];
  versions: ModuleVersion[];
}

/** module.json file format */
export interface ModuleMeta {
  name: string;
  author?: string;
  description?: string;
  version?: string;
  supportedGames?: string[];
}
