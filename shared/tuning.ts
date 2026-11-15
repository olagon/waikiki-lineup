// Every gameplay number lives here. Meters and seconds. The dev panel (backtick) edits these live.
export const TUNING = {
  tick: 0.05, // 20 Hz simulation step, shared by client prediction and the server

  paddle: {
    speed: 2.2, // m/s
    altBonus: 0.6, // extra m/s with alternating strokes
    altWindow: 0.55, // s between alternate strokes to keep the bonus
    accel: 2.6, // 1/s approach rate toward target speed
    glide: 0.7, // 1/s decay when not paddling
    turn: 1.25, // rad/s lying down
    turnSit: 2.6, // rad/s sitting (pivot turn)
    emptySpeedFactor: 0.5,
  },
  // drain: while sprinting (alternating strokes). A steady paddle costs drainSteady, or nobody could reach the lineup.
  stamina: { max: 100, drain: 4, drainSteady: 1.5, recoverSit: 10, recoverRest: 2 },

  waves: {
    speed: 6, // m/s shoreward
    setEvery: [45, 75], // s
    perSet: [3, 5],
    setSpacing: [10, 14], // s between waves in a set
    lullEvery: 15, // s between smaller in-between waves
    face: [0.8, 2.2], // m
    peel: [3, 6], // m/s
    whitewaterReach: [40, 60], // m
  },

  dive: {
    window: 0.5, // s before the whitewater arrives
    perfect: 0.2,
    pushOk: 2, // m
    pushMiss: [6, 12], // m, scaled by whitewater strength
    tumble: 1.2, // s
    staminaHit: 12,
    turtlePush: [3, 5], // longboard and soft-top
  },

  catch: { speedFrac: 0.6, speedFracLong: 0.45, popWindow: 0.6, slopeAssist: 0.7, popTime: 0.35 },
  ride: {
    speed: [5, 9],
    gravity: 0.6, // how much of the face's pull reaches the board
    drag: 0.022, // quadratic
    pump: 1.7, // m/s^2 from pumping on the face
    turn: [2.5, 1.35, 1.2], // rad/s by board: short, long, soft
    stepRate: 0.55, // cross-step speed along the deck, fraction per second
  },
  wipeout: { hold: [1.5, 4], leash: 1 },

  night: { fullAt: 12, setSightFrac: 0.6, windowFactor: 0.8, scoreBonus: 0.1 },

  reefCut: { chance: 0.08, graceSeconds: 300, cooldownSeconds: 900, cutsceneSeconds: 8, afterHoursSeconds: 11 },
  // Tower hours in Hawaiʻi time. See NOTES.md: published schedule, to be confirmed.
  lifeguard: { open: 9, close: 17.5 },

  collide: { shortLen: 2.1, longLen: 2.9, radius: 0.35 },
  // maxRooms is the spending cap: no more than this many rooms can have people in them at once, across both breaks.
  // A room packed with 16 people around the clock costs about $10.50 a month, so 2 rooms caps the bill near $25.
  rooms: { minBots: 5, fillTo: 8, fillBelowHumans: 4, maxHumans: 16, maxRooms: 2 },

  world: { xMin: -260, xMax: 260, zMax: 330, lineupZ: 110, spawnX: 0, spawnZ: 16, towerX: 14 },
};
/** Simulation ticks are counted from this instant (ms since the Unix epoch), so every machine numbers them the same way. */
export const TICK_EPOCH_MS = 1700000000000;
export const tickTime = (tick: number) => (tick * TUNING.tick * 1000 + TICK_EPOCH_MS) / 1000; // seconds since the Unix epoch
export const tickAt = (ms: number) => Math.floor((ms - TICK_EPOCH_MS) / (TUNING.tick * 1000));
export type Tuning = typeof TUNING;
