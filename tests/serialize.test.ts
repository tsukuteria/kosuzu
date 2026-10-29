import { describe, expect, it } from 'vitest';
import { commands } from '../src/commands/index.js';
import { toCommandBodies } from '../src/commands/serialize.js';

describe('toCommandBodies', () => {
  it('restricts every command to guild installs and guild contexts while keeping its fields', () => {
    const bodies = toCommandBodies(commands);
    expect(bodies).toHaveLength(commands.length);
    expect(bodies.length).toBeGreaterThan(0);
    for (const [index, body] of bodies.entries()) {
      expect(body).toEqual({ ...commands[index]!.data.toJSON(), integration_types: [0], contexts: [0] });
      expect(body.integration_types).toEqual([0]);
      expect(body.contexts).toEqual([0]);
    }
  });
});
