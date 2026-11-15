import { describe, it, expect } from 'vitest';
import { buildBody } from '../../client/characters/body';
import { ARCHETYPE_LOOKS } from '../../shared/looks';

describe('body mesh', () => {
  it('is closed and faces outward: every part has positive volume, whichever way its rings are listed', () => {
    for (const look of Object.values(ARCHETYPE_LOOKS)) {
      const g = buildBody(look), p = g.attributes.position.array as ArrayLike<number>, idx = g.index!.array as ArrayLike<number>;
      // Split into connected parts (torso, hair, each arm, leg, foot) and sum the signed volume of each.
      const part = new Int32Array(p.length / 3).fill(-1), find = (i: number): number => (part[i] < 0 ? i : (part[i] = find(part[i])));
      for (let t = 0; t < idx.length; t += 3) for (const [a, b] of [[idx[t], idx[t + 1]], [idx[t + 1], idx[t + 2]]]) { const ra = find(a), rb = find(b); if (ra !== rb) part[ra] = rb; }
      const vol = new Map<number, number>();
      for (let t = 0; t < idx.length; t += 3) {
        const [a, b, c] = [idx[t] * 3, idx[t + 1] * 3, idx[t + 2] * 3];
        const v = (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) / 6;
        vol.set(find(idx[t]), (vol.get(find(idx[t])) ?? 0) + v);
      }
      expect(vol.size).toBeGreaterThanOrEqual(7);
      for (const v of vol.values()) expect(v).toBeGreaterThan(0);
    }
  });
});
