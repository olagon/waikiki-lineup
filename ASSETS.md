# Assets

Every asset is CC0, public domain, or generated in code. Each entry lists source and license.

| Asset | Source | License |
|---|---|---|
| Surfer bodies, hair, boards (`client/characters/`) | Generated in code: lofted tubes skinned to a 17-bone skeleton; no scanned or downloaded meshes; no likeness of any real person | Original work |
| Skyline, palms, park trees, lifeguard tower, beach, sea floor (`client/render/shore.ts`, `terrain.ts`) | Generated in code. Buildings are generic massing with no signs, names or logos. The tower follows the general form of a beach lifeguard tower with no insignia | Original work |
| Sky, clouds, stars, moon (`client/render/sky.ts`, `atmosphere.ts`) | Computed: Rayleigh/Mie/ozone single scattering with published physical constants; procedural clouds, stars and moon | Original work |
| Water, foam, spray, noise and ripple textures (`client/ocean/`, `client/render/noise.ts`) | Generated in code at load | Original work |
| All audio (`client/audio/audio.ts`) | Synthesized in code with Web Audio. Continuous layers (distant surf, wind, whitewater hiss, city hum, lapping, rushing water, underwater rumble) are filtered pink noise. One-shots (paddle, splash, board slap, pop-up, wipeout, lift, crash, bump) are rendered from noise and envelopes into small pools and replayed with random pitch and level. Voices (hoot, "eh", "go", laugh) are formant synthesis: sounds, not words. Gulls are synthesized. No recordings, no music | Original work |
| Typeface | The device's system UI font; nothing is downloaded | n/a |
| `public/dem/leahi.u16` (Lēʻahi elevation, 256×264, decimeters) | USGS 3DEP Elevation ImageServer, `https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage`, bbox -157.8235,21.2455,-157.7885,21.2780 | Public domain (U.S. Geological Survey) |
| `public/dem/koolau.u16` (Koʻolau and southeast Oʻahu elevation, 320×330, decimeters) | Same USGS 3DEP service, bbox -157.92,21.25,-157.66,21.49 | Public domain (U.S. Geological Survey) |
