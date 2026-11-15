// @ts-nocheck
// Post: exposure -> bloom on the hot stuff -> AgX -> a little punch -> vignette -> sRGB.
import * as THREE from 'three/webgpu';
import { pass, vec4, vec3, vec2, float, screenUV, length, mix, renderOutput, agxToneMapping, texture, atan, pow, clamp, exp, min, max } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { U } from './env';
import { ss, luma } from './tsl';
import { noiseTex } from './sky';

export function createPipeline(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera): THREE.RenderPipeline {
  const pipeline = new THREE.RenderPipeline(renderer);
  const scenePass = pass(scene, camera);
  const sceneTex = scenePass.getTextureNode('output');
  // Water on the lens: beads that bend the picture behind them, drying over a couple of seconds.
  const bead = texture(noiseTex, screenUV.mul(vec2(5.5, 3.4)).add(vec2(0, U.lensWet.mul(0.06)))).r;
  const beadMask = ss(float(0.93).sub(U.lensWet.mul(0.2)), float(0.985).sub(U.lensWet.mul(0.2)), bead).mul(ss(0.0, 0.15, U.lensWet)); // a few beads, not a shower
  const beadBend = texture(noiseTex, screenUV.mul(vec2(11, 6.8))).gb.sub(0.5).mul(0.022).mul(beadMask);
  // Guard the whole chain: one bad pixel (a NaN, or a runaway highlight) would otherwise be smeared by bloom over
  // a large block of the frame. max(0, x) with the constant first drops NaNs; the upper clamp stops fireflies.
  const raw = sceneTex.sample(screenUV.add(beadBend)).rgb.mul(U.exposure);
  const exposed = vec4(min(max(vec3(0), raw), vec3(24)), 1);
  // Light shafts when the camera is under water: streaks fanning out from where the sun sits above the surface.
  const toSun = screenUV.sub(U.sunScreen), ang = atan(toSun.y, toSun.x), rad = length(toSun);
  const streak = texture(noiseTex, vec2(ang.mul(0.42).add(U.time.mul(0.013)), U.time.mul(0.021))).r.mul(texture(noiseTex, vec2(ang.mul(0.9).sub(U.time.mul(0.017)), 0.37)).g);
  const shafts = U.lightColor.mul(pow(clamp(streak.mul(2.9), 0, 1), 2.5)).mul(exp(rad.mul(-2.2))).mul(ss(0.0, 0.3, rad)).mul(U.under).mul(U.exposure).mul(0.1);
  const glow = bloom(exposed, 0.22, 0.5, 1.8);
  const mapped = agxToneMapping(exposed.rgb.add(glow.rgb).add(shafts), float(1));
  const punchy = mix(vec3(luma(mapped)), mapped, U.saturation).max(0).pow(vec3(1.12)).mul(U.grade); // AgX base is flat; add saturation and contrast
  const vignette = ss(1.25, 0.35, length(screenUV.sub(0.5).mul(2))).mul(mix(float(0.3), float(0.55), U.under)).add(mix(float(0.7), float(0.45), U.under));
  pipeline.outputColorTransform = false;
  pipeline.outputNode = renderOutput(vec4(punchy.mul(vignette), float(1)), THREE.NoToneMapping, THREE.SRGBColorSpace);
  return pipeline;
}
