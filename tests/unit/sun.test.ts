import { describe, it, expect } from 'vitest';
import { hstTime, hstToUtcMs, nextSunCrossing, sunPosition, moonPosition, bearingToWorld } from '../../shared/sun';

// US Naval Observatory almanac for 21.276 N 157.827 W, UTC-10 (see NOTES.md).
const ALMANAC: [number, number, number, string, string][] = [
  [2026, 3, 20, '06:35', '18:42'],
  [2026, 6, 21, '05:50', '19:16'],
  [2026, 9, 22, '06:20', '18:27'],
  [2026, 12, 21, '07:04', '17:55'],
];
declare const process: { env: Record<string, string> };
const hm = (s: string) => Number(s.slice(0, 2)) + Number(s.slice(3)) / 60;

describe('sun at Waikīkī', () => {
  for (const [y, m, d, rise, set] of ALMANAC) {
    it(`sunrise and sunset on ${y}-${m}-${d} within 2 minutes of the almanac`, () => {
      const midnight = hstToUtcMs(y, m, d, 0);
      const r = hstTime(nextSunCrossing(midnight, true)).hours;
      const s = hstTime(nextSunCrossing(midnight + 12 * 3600000, false)).hours;
      expect(Math.abs(r - hm(rise)) * 60).toBeLessThan(2);
      expect(Math.abs(s - hm(set)) * 60).toBeLessThan(2);
    });
  }

  it('scene clock is HST whatever the device time zone', () => {
    const utc = Date.UTC(2026, 10, 15, 4, 0, 0); // 04:00 UTC Nov 15 = 18:00 HST Nov 14
    for (const tz of ['America/New_York', 'Asia/Tokyo', 'Pacific/Honolulu', 'UTC']) {
      process.env.TZ = tz;
      const h = hstTime(utc);
      expect([h.year, h.month, h.day, h.hours]).toEqual([2026, 11, 14, 18]);
      expect(hstToUtcMs(2026, 11, 14, 18)).toBe(utc);
    }
  });

  it('the full moon sits opposite the sun, and winter sunsets are over the water', () => {
    const sunset = nextSunCrossing(hstToUtcMs(2026, 12, 21, 12), false);
    const sun = sunPosition(sunset), moon = moonPosition(sun);
    expect((moon.azimuth - sun.azimuth + 360) % 360).toBeCloseTo(180, 5);
    expect(moon.elevation).toBeCloseTo(-sun.elevationGeometric, 9);
    expect(bearingToWorld(sun.azimuth, 0)[2]).toBeGreaterThan(0.5); // +z is seaward
    expect(bearingToWorld(moon.azimuth, 0)[2]).toBeLessThan(-0.5); // moon rises over the land
  });
});
