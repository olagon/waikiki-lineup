import * as THREE from 'three/webgpu';
import { Board } from '../../shared/physics';
import { BOARD_LEN, COLORS, type Look } from '../../shared/looks';

/** A surfboard: outline, rocker, foil, a crisp stringer, fins. x runs tail to nose, deck up. */
export function buildBoard(look: Look): THREE.BufferGeometry {
  const L = BOARD_LEN[look.board], short = look.board === Board.Short, soft = look.board === Board.Soft;
  const W = short ? 0.48 : soft ? 0.62 : 0.57, T = short ? 0.06 : soft ? 0.085 : 0.075;
  const deck = COLORS[look.boardColor] ?? COLORS[0], str = COLORS[look.stringer] ?? deck, under = soft ? [0.92, 0.92, 0.9] : [0.93, 0.92, 0.88];
  const pos: number[] = [], col: number[] = [], idx: number[] = [], S = 26, R = 12;
  for (let i = 0; i <= S; i++) {
    const u = i / S; // 0 tail .. 1 nose
    // Outline: shortboards carry their width back and come to a point; longboards and soft-tops are full and round.
    const nose = short ? Math.pow(Math.sin(Math.PI * Math.pow(u, 0.72)), 0.9) : Math.pow(Math.sin(Math.PI * Math.pow(u, 0.86)), soft ? 0.42 : 0.52);
    const hw = Math.max(0.004, (W / 2) * nose), th = Math.max(0.006, T * Math.pow(Math.sin(Math.PI * Math.min(0.97, Math.max(0.03, u))), 0.45));
    const y0 = 0.11 * Math.pow(Math.max(0, (u - 0.62) / 0.38), 2.2) * (short ? 1.4 : 1) + 0.035 * Math.pow(Math.max(0, (0.18 - u) / 0.18), 2); // rocker
    const x = (u - 0.5) * L;
    const ring: [number, number, number[]][] = [
      [-hw, th * 0.45, deck], [-hw * 0.82, th * 0.92, deck], [-hw * 0.4, th, deck], [-0.012, th * 1.03, deck], [0, th * 1.03, str], [0.012, th * 1.03, deck], [hw * 0.4, th, deck], [hw * 0.82, th * 0.92, deck],
      [hw, th * 0.45, deck], [hw * 0.75, 0.004, under], [0, 0, under], [-hw * 0.75, 0.004, under],
    ];
    for (const [z, y, c] of ring) { pos.push(x, y0 + y, z); col.push(c[0], c[1], c[2]); }
  }
  for (let i = 0; i < S; i++) for (let k = 0; k < R; k++) {
    const a = i * R + k, b = i * R + ((k + 1) % R), c = a + R, d = b + R;
    idx.push(a, b, c, b, d, c);
  }
  // Fins: thin wedges under the tail.
  const fin = (x: number, z: number, h: number, len: number) => {
    const o = pos.length / 3, c = [0.1, 0.1, 0.11];
    for (const p of [[x, 0.01, z - 0.006], [x, 0.01, z + 0.006], [x + len, 0.01, z], [x - len * 0.25, -h, z]]) { pos.push(p[0], p[1], p[2]); col.push(c[0], c[1], c[2]); }
    idx.push(o, o + 2, o + 3, o + 1, o + 3, o + 2, o, o + 3, o + 1);
  };
  const tail = -L / 2;
  if (short) { fin(tail + 0.12, 0, 0.12, 0.12); fin(tail + 0.3, -0.13, 0.11, 0.11); fin(tail + 0.3, 0.13, 0.11, 0.11); } else fin(tail + 0.22, 0, soft ? 0.14 : 0.22, 0.2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
