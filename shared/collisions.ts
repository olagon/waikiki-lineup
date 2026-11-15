// Surfer-to-surfer contact, priority and etiquette. Pure functions; the room server is the only caller that matters.
import { TUNING as T } from './tuning';
import { Board, St, dunk, isRiding, solid, wipe, type Surfer, type World } from './physics';
import { breakDelay, peelDir, type Wave } from './waves';

/** Outcome codes sent in Collision events (value field). */
export const Hit = { Bump: 1, Dunk: 2, BothDown: 3, PriorityHolds: 4, PartyCrash: 5, TakeoffBump: 6 } as const;
export type Hit = (typeof Hit)[keyof typeof Hit];

const lenOf = (s: Surfer) => (s.board === Board.Short ? T.collide.shortLen : T.collide.longLen);

/** Distance between two surfers' capsules (board plus body along the heading), minus both radii. Negative means touching. */
export function gap(a: Surfer, b: Surfer, ax = a.x, az = a.z, bx = b.x, bz = b.z): number {
  const ha = lenOf(a) / 2 - T.collide.radius, hb = lenOf(b) / 2 - T.collide.radius;
  const dax = Math.cos(a.heading) * ha, daz = Math.sin(a.heading) * ha, dbx = Math.cos(b.heading) * hb, dbz = Math.sin(b.heading) * hb;
  // Closest distance between two short segments: sample each against the other's endpoints and center (plenty at this scale).
  let best = Infinity;
  for (const u of [-1, -0.5, 0, 0.5, 1]) for (const v of [-1, -0.5, 0, 0.5, 1]) {
    const dx = ax + dax * u - (bx + dbx * v), dz = az + daz * u - (bz + dbz * v), d = dx * dx + dz * dz;
    if (d < best) best = d;
  }
  return Math.sqrt(best) - 2 * T.collide.radius;
}

/**
 * Who has priority on a wave, among surfers riding it or lifted by it and peeling the same way as `dir`:
 * the one closest to the breaking part. Returns an index into `surfers`, or -1.
 */
export function priorityOn(wave: Wave, t: number, surfers: Surfer[], dir: number): number {
  let best = -1, bestAhead = Infinity;
  surfers.forEach((s, i) => {
    if (s.waveId !== wave.id || !(isRiding(s) || s.lift > 0) || peelDir(wave, s.x) !== dir) return;
    const ahead = wave.tb + breakDelay(wave, s.x) - t; // seconds until the section under this surfer breaks
    if (ahead < bestAhead) { bestAhead = ahead; best = i; }
  });
  return best;
}

export interface Contact { hit: Hit; /** who gets blamed (drop-in or bump-off): 0 nobody, 1 = a, 2 = b */ fault: 0 | 1 | 2 }

/**
 * Two touching surfers: decide what happens and apply it. `aHasPriority`/`bHasPriority` come from priorityOn
 * for the wave they share (both false on a wave the priority holder has given away, a party wave).
 */
export function resolve(a: Surfer, b: Surfer, w: World, wave: Wave | undefined, aHasPriority: boolean, bHasPriority: boolean): Contact | null {
  if (!solid(a) || !solid(b)) return null;
  const ra = isRiding(a), rb = isRiding(b);
  if (!ra && !rb) {
    // Paddler meets paddler: a soft push apart, both lose speed.
    const dx = a.x - b.x, dz = a.z - b.z, d = Math.hypot(dx, dz) || 1, push = 0.25;
    a.x += (dx / d) * push; a.z += (dz / d) * push; b.x -= (dx / d) * push; b.z -= (dz / d) * push;
    a.speed *= 0.5; b.speed *= 0.5;
    return { hit: Hit.Bump, fault: 0 };
  }
  if (ra !== rb) {
    // Rider meets paddler: the paddler goes under for a second, the rider loses 30% of their speed.
    const rider = ra ? a : b, paddler = ra ? b : a;
    const headOn = Math.cos(rider.heading) * Math.cos(paddler.heading) + Math.sin(rider.heading) * Math.sin(paddler.heading) < -0.5;
    if (rider.speed > 6 && headOn) { wipe(rider, w, wave, false); wipe(paddler, w, undefined, false); return { hit: Hit.BothDown, fault: 0 }; }
    dunk(paddler, 1); rider.speed *= 0.7;
    return { hit: Hit.Dunk, fault: 0 };
  }
  // Rider meets rider.
  const takeoffA = a.state === St.PopUp || a.rideTime < 1, takeoffB = b.state === St.PopUp || b.rideTime < 1;
  if (takeoffA !== takeoffB) {
    // A bump during someone's takeoff knocks them off the wave. That is a drop-in on the bumper's account.
    const down = takeoffA ? a : b;
    wipe(down, w, wave, false);
    return { hit: Hit.TakeoffBump, fault: takeoffA ? 2 : 1 };
  }
  if (aHasPriority !== bHasPriority) { wipe(aHasPriority ? b : a, w, wave, false); return { hit: Hit.PriorityHolds, fault: aHasPriority ? 2 : 1 }; }
  wipe(a, w, wave, false); wipe(b, w, wave, false);
  return { hit: Hit.PartyCrash, fault: 0 };
}

/** Respect changes, per the brief: quiet, per session, never locks anyone out. */
export const RESPECT = { start: 60, give: 6, party: 4, hoot: 2, dropIn: -12, bumpOff: -10, snake: -8 };
export const clampRespect = (r: number) => Math.max(0, Math.min(100, r));
