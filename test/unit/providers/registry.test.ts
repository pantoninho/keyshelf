import { describe, it, expect } from 'vitest';
import { ProviderRegistry } from '../../../src/providers/registry.js';
import type { Provider } from '../../../src/providers/types.js';

function makeProvider(name: string): Provider {
  return {
    name,
    resolve: async () => 'value',
    validate: async () => true,
    set: async () => {},
  };
}

describe('ProviderRegistry', () => {
  it('registers and retrieves a provider', () => {
    const registry = new ProviderRegistry();
    const provider = makeProvider('test');
    registry.register(provider);
    expect(registry.get('test')).toBe(provider);
  });

  it('throws on unknown provider', () => {
    const registry = new ProviderRegistry();
    expect(() => registry.get('missing')).toThrow(
      'Unknown provider: "missing"',
    );
  });

  it('reports whether a provider exists', () => {
    const registry = new ProviderRegistry();
    registry.register(makeProvider('test'));
    expect(registry.has('test')).toBe(true);
    expect(registry.has('missing')).toBe(false);
  });

  it('overwrites provider with same name', () => {
    const registry = new ProviderRegistry();
    const first = makeProvider('test');
    const second = makeProvider('test');
    registry.register(first);
    registry.register(second);
    expect(registry.get('test')).toBe(second);
  });
});
