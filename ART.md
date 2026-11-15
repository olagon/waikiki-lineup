# Waikīkī Lineup: art bible

Every visual decision answers to this file. If code and this file disagree, fix one of them on purpose.

## Direction

- **Realism goes into water and light.** People are stylized-realistic: believable proportions, materials and motion, no photoreal faces.
- **Soft, not heavy.** Waikīkī waves are rolling, crumbling walls. No barrels, no mutant lips. Queens may show one short steep section.
- **Quiet frame.** Almost no HUD. Information lives in the world (priority glow on the face, stamina in the stroke).
- **Dark, never black.** Night is silver-blue moonlight plus warm city light.
- **Respect for place.** Landmarks are natural silhouettes and simple massing. No signs, logos, tiki, hula kitsch or "tribal" decoration.

## World layout (as seen from the water)

Looking at the shore from the lineup: sand beach and palms in front, the lifeguard tower centered on the break, the high-rise skyline behind and to the left (ʻEwa side), thinning to the trees of the park on the right, then Lēʻahi's crater rim rising on the far right (east). The Koʻolau ridgeline sits behind the city in haze, often capped with trade-wind cloud. Looking out to sea: open horizon, sets as dark lines, the sun setting over the water to the right in winter and along the shore in summer.

## Palette by sun elevation

Grades are keyed to the sun's elevation, never the clock.

| Grade | Sun elevation | Sky zenith | Sky horizon | Key light | Water body | Foam | Land |
|---|---|---|---|---|---|---|---|
| Dawn glass | -6° to 6° (morning) | `#6f8fb8` | `#f3c9a8` peach-rose | `#ffd2a6` low, soft | `#7fa3b0` silver-blue, glassy | `#f1e9e2` | Lēʻahi backlit `#3a3f4a`, skyline cool `#8794a3` |
| Midday | above 35° | `#2a6fc4` | `#bfe0ee` | `#fff6e6` | shallow `#3ec9c0`, deep `#0f4f86` | `#ffffff` | sand `#e9d8b4`, Lēʻahi `#8a8a5c`, Koʻolau `#4f7a5a` in haze |
| Golden hour | 2° to 12° (evening) | `#4f7fb5` | `#ffc87a` | `#ffb45e` | `#2d7f8e`, gold glitter | `#fff1d6` | Lēʻahi `#c98a4a` warm, first windows `#ffd89a` |
| Dusk | -1° to -8° | `#2b3a6b` | `#f2a48a` salmon, `#8a6f9e` lavender band | none; sky fill only | `#3a4f6e` with pink reflections | `#c9c2cf` | silhouettes `#141a26`, windows `#ffcf8a` |
| Night | below -12° | `#0a1226` | `#1a2238`, city glow `#3a2f2a` | moon `#e8eefc` | `#0c1a2a`, glade `#cfd8ea` | `#9fb2c8` moonlit | never darker than `#05080f` |

Between grades, blend smoothly on elevation. Backlit lips at golden hour go green-gold: `#9ad27a` through `#e8d27a`.

Tone mapping is AgX. Highlights roll off; nothing clips to flat white except the sun disk and its glitter core. Bloom only on sun glints, lip glow and window lights.

## Water color by depth

| Depth | Read | Color |
|---|---|---|
| 0 to 0.5 m | sand showing through, swash | `#a8e6d8` over `#e9d8b4` |
| 0.5 to 2 m | clear turquoise over sand | `#3ec9c0` |
| 2 to 5 m | teal, mottled with dark reef patches | `#1f8f93`, reef `#2c6b5e` |
| 5 to 12 m | blue | `#1565a8` |
| beyond 12 m | deep blue | `#0c3f7a` |

Absorption per meter of path: red 0.40, green 0.065, blue 0.028 (close to pure sea water). Light scattered back by the water body is blue, about `#0a4a80` under a noon sun. Sand under water is pale coral sand `#e3dccb`. Caustics are visible to about 4 m at midday and fade with sun elevation. Reflections follow Fresnel: at grazing angles the water is sky, looking down it is depth.

## Surfers at distance

Each archetype must read at 50 m from silhouette plus one color note.

| Archetype | Silhouette | Board | Color note |
|---|---|---|---|
| Uncle on a log | broad, upright, gray hair | 10 ft longboard, cream with a dark stringer | faded red boardshorts, bare chest |
| Grom | small, quick, crouched | 5 ft shortboard, white with neon rails | bright yellow rash guard |
| Beach-boy instructor | big, standing in waist-deep water or prone on a wide board | 11 ft soft-top, blue | red rash guard (generic, no insignia) |
| Student | stiff, arms out, wide stance | 9 ft soft-top, yellow | pale rash guard, oversized |
| Charger | lean, low stance | 6 ft shortboard, black | black wetsuit top |
| Aunty | graceful, tall stance, long tied hair | 9 ft longboard, seafoam green | coral swimsuit and shorts |
| Tourist | sits awkwardly, sunburn | 8 ft soft-top, white and blue | aloha-print-free plain shorts |

Skin tones cover the real range of Hawaiʻi's people. Bodies vary in build and age. Name tags are small, sand-white, with a Respect dot.

## Typography and UI

- One typeface: the system UI stack (`ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto`). Weights 400 and 600 only.
- Sizes: 13 px labels, 15 px body, 28 px titles. Letter spacing +0.02em on small caps labels.
- Color: sand white `#f4efe6` on glass `rgba(8, 30, 40, 0.45)` with a 16 px blur. One accent: sun gold `#ffc46b`. Injury mark: `#e2574c`.
- Priority colors: you `#ffc46b`, others `#7fd6ff`; colorblind-safe pair `#ffb000` and `#648fff`.
- Motion: 240 ms ease-out for UI, 600 ms for score cards. Nothing bounces.
- Place names carry correct ʻokina and kahakō: Waikīkī, Lēʻahi, Koʻolau, Hawaiʻi, Kūhiō.

## Golden frames

- **G1 Bay wide, golden hour.** From 30 m up and 200 m offshore, looking at the shore. Two peaks peel, one left of center and one right, each with a clean shoulder and a trail of whitewater. Ten or so surfers are scattered through the lineup as small readable figures. The skyline catches warm side light and its first windows are lit. Lēʻahi glows orange on the right. The Koʻolau fade to blue-gray haze under cloud.
- **G2 The set looms.** Camera at water level. A set wave 15 m away stands up dark against a bright sky. The lip feathers with spray blown back toward the horizon, and the sun shows green-gold through the top third of the face. A few droplets sit on the lens.
- **G3 Duck dive.** Underwater, looking up and forward. A ceiling of whitewater turbulence rolls overhead, bubbles trail down, light shafts cut through blue-green water, and the surfer pushes the nose of the board down with straight arms.
- **G4 The lineup.** Over the shoulder of the player sitting on their board. Five bots sit across the peak, each a different shape and color. One has turned and is paddling for a set wave lifting behind them.
- **G5 Takeoff.** Side view. A surfer drops down the face mid pop-up, board angled, spray off the rail, the lip starting to crumble behind.
- **G6 Down the line.** From the shoulder looking back. A surfer in trim, the wave peeling behind them into whitewater, a foam trail on the face.
- **G7 Nose ride.** Long lens, compressed. The uncle stands at the nose of his log, toes over, arms loose, in golden light, the wave a soft wall behind him.
- **G8 Wipeout.** The moment of the pitch: board and surfer separating in a burst of spray, or the underwater tumble with light filtering through foam.
- **G9 Midday clarity.** Above the shallows at noon. Turquoise water, sand ripples and reef visible through it, caustics moving over the bottom. The instructor stands waist deep, pushing a student on a soft-top into a small wave.
- **G10 Dusk.** Pastel sky, salmon to lavender to deep blue. Skyline windows lit. The last surfers are silhouettes. The full moon has just cleared the land to the east.
- **G11 Full moon.** Night in the lineup. A silver glade runs across the water to the moon. Whitewater glows pale. City lights reflect in long warm streaks. Surfers are dark shapes against the glade.
- **G12 The lifeguard.** At the tower in afternoon light. The lifeguard kneels to seal a cut on the surfer's shin. The surfer stands with the board under one arm. Generic uniform, no insignia.
