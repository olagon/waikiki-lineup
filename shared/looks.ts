// How a surfer looks. Small numbers so it fits in a few bytes on the wire. Shared so the server can assign bots.
import { Board } from './physics';

export interface Look {
  skin: number; // 0..5, light to deep
  build: number; // 0 slight, 1 medium, 2 broad, 3 kid
  hair: number; // 0 bald, 1 short, 2 long, 3 tied
  hairColor: number; // 0 black, 1 brown, 2 sun-bleached, 3 gray
  top: number; // 0 bare chest, 1 rash guard (short sleeve), 2 wetsuit top (long sleeve), 3 swimsuit
  topColor: number; // index into COLORS
  shortsColor: number;
  board: Board;
  boardColor: number;
  stringer: number; // index into COLORS, or the board color for none
}

// Linear-light albedo, light to deep: the real range of people in Hawaiʻi's lineups.
export const SKIN: [number, number, number][] = [[0.8, 0.6, 0.48], [0.66, 0.46, 0.33], [0.52, 0.34, 0.22], [0.4, 0.25, 0.15], [0.27, 0.16, 0.1], [0.15, 0.09, 0.06]];
export const HAIR: [number, number, number][] = [[0.03, 0.025, 0.02], [0.13, 0.08, 0.05], [0.42, 0.31, 0.17], [0.55, 0.55, 0.54]];
export const COLORS: [number, number, number][] = [
  [0.92, 0.89, 0.8], // 0 cream
  [0.62, 0.1, 0.08], // 1 faded red
  [0.93, 0.78, 0.1], // 2 yellow
  [0.06, 0.24, 0.6], // 3 blue
  [0.03, 0.03, 0.035], // 4 black
  [0.45, 0.78, 0.66], // 5 seafoam
  [0.9, 0.38, 0.3], // 6 coral
  [0.95, 0.95, 0.95], // 7 white
  [0.1, 0.38, 0.3], // 8 deep green
  [0.85, 0.5, 0.12], // 9 orange
  [0.35, 0.2, 0.5], // 10 purple
  [0.1, 0.1, 0.12], // 11 charcoal
  [0.6, 0.8, 0.9], // 12 pale blue
];
/** Board lengths in meters by type. */
export const BOARD_LEN = [1.85, 2.9, 2.75];

export const DEFAULT_LOOK: Look = { skin: 2, build: 1, hair: 1, hairColor: 0, top: 0, topColor: 3, shortsColor: 1, board: Board.Long, boardColor: 0, stringer: 11 };

/** Starting looks for the bot archetypes (ART.md: each must read at 50 m). */
export const ARCHETYPE_LOOKS: Record<string, Look> = {
  uncle: { skin: 3, build: 2, hair: 1, hairColor: 3, top: 0, topColor: 1, shortsColor: 1, board: Board.Long, boardColor: 0, stringer: 11 },
  grom: { skin: 2, build: 3, hair: 1, hairColor: 2, top: 1, topColor: 2, shortsColor: 3, board: Board.Short, boardColor: 7, stringer: 9 },
  instructor: { skin: 4, build: 2, hair: 1, hairColor: 0, top: 1, topColor: 1, shortsColor: 4, board: Board.Soft, boardColor: 3, stringer: 3 },
  student: { skin: 0, build: 1, hair: 2, hairColor: 1, top: 1, topColor: 12, shortsColor: 8, board: Board.Soft, boardColor: 2, stringer: 2 },
  charger: { skin: 2, build: 0, hair: 1, hairColor: 0, top: 2, topColor: 4, shortsColor: 4, board: Board.Short, boardColor: 4, stringer: 4 },
  aunty: { skin: 3, build: 1, hair: 3, hairColor: 0, top: 3, topColor: 6, shortsColor: 6, board: Board.Long, boardColor: 5, stringer: 7 },
  tourist: { skin: 1, build: 1, hair: 1, hairColor: 1, top: 0, topColor: 7, shortsColor: 10, board: Board.Soft, boardColor: 7, stringer: 3 },
};
