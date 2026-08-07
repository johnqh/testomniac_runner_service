import type { Plugin } from "./types.js";

const plugins = new Map<string, { plugin: Plugin; enabled: boolean }>();

export function registerPlugin(plugin: Plugin, enabled = true): void {
  plugins.set(plugin.name, { plugin, enabled });
}

export function getPlugin(name: string): Plugin | undefined {
  return plugins.get(name)?.plugin;
}

export function getEnabledPlugins(): Plugin[] {
  return Array.from(plugins.values())
    .filter(entry => entry.enabled)
    .map(entry => entry.plugin);
}

export function getAllPluginNames(): string[] {
  return Array.from(plugins.keys());
}
