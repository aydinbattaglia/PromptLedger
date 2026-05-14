import type { AdapterFactory } from './types.js';

const registry = new Map<string, AdapterFactory>();

export function registerAdapter(hostnameFragment: string, factory: AdapterFactory): void {
  registry.set(hostnameFragment, factory);
}

export function getAdapter(hostname: string): AdapterFactory | undefined {
  for (const [fragment, factory] of registry) {
    if (hostname.includes(fragment)) return factory;
  }
  return undefined;
}
