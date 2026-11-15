// Hawaiʻi clock and sun/moon position for Waikīkī. NOAA solar position algorithm.
// Used for looks on the client and for night rules on the server, so it lives in shared/.

export const WAIKIKI_LAT = 21.276;
export const WAIKIKI_LON = -157.827;
const HST_OFFSET_MS = -10 * 3600 * 1000; // UTC-10, no daylight saving
const RAD = Math.PI / 180;

export interface HstTime { year: number; month: number; day: number; hours: number; dayNumber: number }

/** Wall-clock time in Hawaiʻi for a UTC timestamp, regardless of the device time zone. */
export function hstTime(utcMs: number): HstTime {
  const d = new Date(utcMs + HST_OFFSET_MS);
  return {
    year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(),
    hours: d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600,
    dayNumber: Math.floor((utcMs + HST_OFFSET_MS) / 86400000),
  };
}

/** UTC timestamp for a given Hawaiʻi date and fractional hour. */
export function hstToUtcMs(year: number, month: number, day: number, hours: number): number {
  return Date.UTC(year, month - 1, day) + hours * 3600000 - HST_OFFSET_MS;
}

export interface SunPos { azimuth: number; elevation: number; elevationGeometric: number }

/** Sun azimuth (degrees clockwise from north) and elevation (degrees) at Waikīkī. */
export function sunPosition(utcMs: number, lat = WAIKIKI_LAT, lon = WAIKIKI_LON): SunPos {
  const jd = utcMs / 86400000 + 2440587.5;
  const T = (jd - 2451545) / 36525;
  const L0 = (280.46646 + T * (36000.76983 + 0.0003032 * T)) % 360;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C = Math.sin(M * RAD) * (1.914602 - T * (0.004817 + 0.000014 * T))
    + Math.sin(2 * M * RAD) * (0.019993 - 0.000101 * T) + Math.sin(3 * M * RAD) * 0.000289;
  const omega = 125.04 - 1934.136 * T;
  const lambda = L0 + C - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const eps = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60 + 0.00256 * Math.cos(omega * RAD);
  const decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD));
  const y = Math.tan((eps / 2) * RAD) ** 2;
  const eot = 4 / RAD * (y * Math.sin(2 * L0 * RAD) - 2 * e * Math.sin(M * RAD) + 4 * e * y * Math.sin(M * RAD) * Math.cos(2 * L0 * RAD)
    - 0.5 * y * y * Math.sin(4 * L0 * RAD) - 1.25 * e * e * Math.sin(2 * M * RAD));
  const minutes = ((utcMs % 86400000) + 86400000) % 86400000 / 60000;
  const tst = (((minutes + eot + 4 * lon) % 1440) + 1440) % 1440;
  const ha = (tst / 4 < 0 ? tst / 4 + 180 : tst / 4 - 180) * RAD;
  const cosZen = Math.min(1, Math.max(-1, Math.sin(lat * RAD) * Math.sin(decl) + Math.cos(lat * RAD) * Math.cos(decl) * Math.cos(ha)));
  const zen = Math.acos(cosZen);
  const elGeo = 90 - zen / RAD;
  const a = Math.acos(Math.min(1, Math.max(-1, (Math.sin(lat * RAD) * cosZen - Math.sin(decl)) / (Math.cos(lat * RAD) * Math.sin(zen)))) ) / RAD;
  const azimuth = ha > 0 ? (a + 180) % 360 : (540 - a) % 360;
  // Atmospheric refraction (NOAA approximation), in degrees.
  const t = Math.tan(elGeo * RAD);
  const refr = elGeo > 85 ? 0
    : elGeo > 5 ? (58.1 / t - 0.07 / t ** 3 + 0.000086 / t ** 5) / 3600
    : elGeo > -0.575 ? (1735 + elGeo * (-518.2 + elGeo * (103.4 + elGeo * (-12.79 + elGeo * 0.711)))) / 3600
    : -20.772 / t / 3600;
  return { azimuth, elevation: elGeo + refr, elevationGeometric: elGeo };
}

/** The moon is always full: it sits opposite the sun. */
export function moonPosition(sun: SunPos): { azimuth: number; elevation: number } {
  return { azimuth: (sun.azimuth + 180) % 360, elevation: -sun.elevationGeometric };
}

/** 0 by day, ramping to 1 as the sun drops from 0° to `fullAt`° below the horizon. */
export function nightFactor(sunElevation: number, fullAt = 12): number {
  return Math.min(1, Math.max(0, -sunElevation / fullAt));
}

/** Next time after `fromMs` the sun's center crosses -0.833° (standard rise/set), going up or down. */
export function nextSunCrossing(fromMs: number, rising: boolean): number {
  const f = (ms: number) => sunPosition(ms).elevationGeometric + 0.833;
  let a = fromMs;
  for (let i = 0; i < 24 * 12 + 1; i++) {
    const b = a + 300000;
    const fa = f(a), fb = f(b);
    if (rising ? fa < 0 && fb >= 0 : fa > 0 && fb <= 0) {
      let lo = a, hi = b;
      for (let k = 0; k < 30; k++) { const mid = (lo + hi) / 2; if ((f(mid) < 0) === (fa < 0)) lo = mid; else hi = mid; }
      return (lo + hi) / 2;
    }
    a = b;
  }
  return NaN;
}

/** Compass bearing + elevation (degrees) to a world-space unit vector. +z is seaward at `seawardBearing`. */
export function bearingToWorld(azimuth: number, elevation: number, seawardBearing = 215): [number, number, number] {
  const c = Math.cos(elevation * RAD);
  return [c * Math.cos((azimuth - (seawardBearing - 90)) * RAD), Math.sin(elevation * RAD), c * Math.cos((azimuth - seawardBearing) * RAD)];
}

/** Whether the lifeguard tower is staffed at this moment (hours in Hawaiʻi time). */
export function towerOpen(utcMs: number, open: number, close: number): boolean {
  const h = hstTime(utcMs).hours;
  return h >= open && h < close;
}
