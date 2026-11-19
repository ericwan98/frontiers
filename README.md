# Frontiers

Draw borders from memory: countries of the world, Europe, Africa or South America, US states,
French regions or Paris arrondissements.
You get a region, you draw a loop where you think it is, and you score on how much it overlaps the
real one. Land you already gave away is taken, so the next regions fit around your mistakes and the
map ends up badly stacked. The real borders show up only at the end.

The world, Europe, Africa and South America also have a capitals mode: you get a capital and drop a
pin where you think it is, on the same map without borders.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run check      # typecheck + tests + build
```

## How it works

- `scripts/build-*.mjs` build `src/maps/<id>.json`, projected with equal-area projections so
  areas and overlap compare fairly. Re-run them all with `npm run maps`.
  - `world`: 165 countries of at least 9,000 km² from Natural Earth 110m, on Equal Earth.
    Antarctica is left out; smaller countries, Western Sahara, the Falklands and other overseas
    territories are grey, and so are France's overseas departments.
  - `africa`: 49 countries from Natural Earth 50m. Somaliland is in Somalia; Western Sahara and
    the small island nations are grey.
  - `south-america`: the 12 countries from Natural Earth 50m. French Guiana and the Falklands
    are grey.
  - `europe`: 41 countries from Natural Earth 50m (`world-atlas`). Crimea is in Ukraine; Åland is
    in Finland; the Isle of Man and the Channel Islands are in the UK; microstates are left out.
  - `us`: the 48 contiguous states from the Census Bureau via `us-atlas`, in Albers equal-area.
    DC, Canada and Mexico are grey and not in play.
  - `france`: 13 metropolitan regions from github.com/gregoiredavid/france-geojson (Licence
    Ouverte), neighbours from Natural Earth.
  - `paris`: 20 arrondissements, plus the Seine and canals as landmarks, from opendata.paris.fr
    (ODbL).
- Countries carry their capital (`capital: { name, at }`), from Natural Earth's populated places
  (v5.1.2) with a few fixes in `scripts/lib.mjs`: one capital per country (Pretoria, Sucre,
  Amsterdam…), Astana and Gitega where the data is out of date. The build fails if a capital is
  more than 200 km outside its country as drawn.
- `src/maps/index.ts` lists the maps for the picker; each one loads on demand. Maps with `cities`
  set can be played in capitals mode.
- `src/seed.ts`: every game has a seed like `europe-10-K3F9X` (map, rounds, code), or
  `europe-cities-10-K3F9X` for capitals. Pasting it on
  the picker plays the same regions in the same order, so friends can compare their maps.
- `src/share.ts`: links like `/?seed=france-10-K3F9X&vs=96.x.72` replay a seed and carry the
  sender's points per region (`x` for skipped), so whoever opens it is compared region by region.
  The end card copies that link, a Wordle-style result, or a PNG of the map (`src/image.ts`).
- Today's game is the same for everyone: its seed is the date, e.g. `france-10-20261118`.
  Finishing one on consecutive days, on any map, builds a streak.
- `src/awards.ts`: the end card hands out awards for the funniest blunders (a country that ate
  its neighbour, one 5× too big, one 400 km from home, a capital underwater or in the wrong
  country…); the worst one goes into the shared
  result. Clicking an award or a row replays the game from there; Replay plays it back.
- `src/confetti.ts`, `src/sound.ts`: confetti for a great drawing or a won game, and small
  synthesised sounds (no audio files), with a mute button.
- Easy mode shows each region's real border, or each capital's real spot, right after it is
  placed, which helps with the neighbours. It is part of the seed (`europe-10-K3F9X-easy`) and has its own best scores.
- `src/game.ts`: the game. A drawing is clipped to the land in play, minus everything already
  placed. Shift-drag or the Eraser button erases. On a phone, two fingers pinch and pan.
- `src/scoring.ts`: up to 100 points per region: 75% intersection over union, 25% for the
  distance between centroids, relative to the region's size and the map's. A capital's pin scores
  100 within half a percent of the map's width (23 km on Europe, 160 km on the world), then loses
  a factor e every 5% of the width.
- A map is just `{ width, height, kmPerUnit, land, context, water?, regions }`, so another variant is
  another build script, JSON file and entry in `src/maps/index.ts`.
- There is no backend: `dist/` is static, and best scores and the game in progress live in
  `localStorage`.

## Deploy

Every push to `main` is tested, built and published to GitHub Pages by
`.github/workflows/pages.yml`.
