// @ts-nocheck
import { clamp, float } from 'three/tsl';

/** smoothstep that is well defined when a > b (GPU smoothstep is not). */
export const ss = (a, b, x) => {
  const t = clamp(float(x).sub(a).div(float(b).sub(a)), 0, 1);
  return t.mul(t).mul(t.mul(-2).add(3));
};
/** Rec.709 luminance. */
export const luma = (c) => c.x.mul(0.2126).add(c.y.mul(0.7152)).add(c.z.mul(0.0722));
