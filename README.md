# Frontiers

Draw borders from memory: countries of the world, Europe, Africa or South America, US states,
French regions or Paris arrondissements.
You get a region, you draw a loop where you think it is, and you score on how much it overlaps the
real one. Land you already gave away is taken, so the next regions fit around your mistakes and the
map ends up badly stacked. The real borders show up only at the end.

The world, Europe, Africa and South America also have a capitals mode: you get a capital and drop a
pin where you think it is, on the same map without borders.

Paris also has a streets mode: type street names and watch them light up on the map, with no end
and no timer. A name finds its faubourg and porte too: "Saint-Martin" also lights the rue du
Faubourg Saint-Martin. Counters show the names found out of about 5,400, the share of the street area
they cover (overall and per arrondissement) and their length out of about 1,570 km. Tap a found
street to see where its name comes from. Confetti mark milestones (1%, 5%, 10%… of the area, 100,
500, 1,000… names). "Replay your finds" lights them up again in the order they were found, with a chart of how
far each find is from the one before (`src/streets-chart.ts`): finds from a neighbourhood you know
sit low, names typed at random sit near the "at random" line, the median distance between two of
your finds picked at random.
Progress stays in the browser. "Copy a link to merge your finds" gives a link
that adds them to whichever browser opens it: another device, or a friend's, after its own finds and
in the order they were found, so the replay stays right. The link lists the names in that order,
deflated: about 1,200 characters for 500 names, 4,700 for 2,000. Older links, which held only which
names were found, still work.

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
  - `paris-streets`: the footprint of every named voie (about 6,200: rues, places, quais, villas…)
    from the official street register of the Ville de Paris
    (`denominations-emprises-voies-actuelles` on opendata.paris.fr, ODbL), on the same projection
    as `paris` (`scripts/paris.mjs`). Voies with a code instead of a name ("voie A/1") are drawn
    but never asked for. Lengths come from the register; the few voies without one are measured
    on their footprint. It weighs 1.8 MB and loads only when the mode starts.
- Countries carry their capital (`capital: { name, at }`), from Natural Earth's populated places
  (v5.1.2) with a few fixes in `scripts/lib.mjs`: one capital per country (Pretoria, Sucre,
  Amsterdam…), Astana and Gitega where the data is out of date. The build fails if a capital is
  more than 200 km outside its country as drawn.
- `src/maps/index.ts` lists the maps for the picker; each one loads on demand. Maps with `cities`
  set can be played in capitals mode, and maps with `streets` in streets mode.
- `src/streets.ts`: streets mode answers. One answer finds every voie that shares the distinctive
  name ("Bercy": the rue, the boulevard, the quai…). Case, accents, punctuation, the type ("rue")
  and the article ("de la") don't matter, "st" is "saint", and one wrong, missing, extra or
  swapped letter is forgiven from 5 letters on, if only one name is that close.
  `src/streets-screen.ts` is the screen; found names are saved in `localStorage`. Progress links
  number names by `order` in `paris-streets.json`: the build keeps it and adds new names at the end.
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
- Three levels, each part of the seed and with its own best scores. Easy (`europe-10-K3F9X-guided`)
  puts the real region, or the real capital, in place of your drawing or pin from the next turn
  on, so mistakes don't pile up. Normal (`-normal`) shows the real border dashed, or the real spot
  circled, while the score is up, and is the default. Hard (no ending) shows nothing until the end. Normal was called
  easy before there were levels: old `-easy` seeds, saved games and best scores read as normal.
- `src/game.ts`: the game. A drawing is clipped to the land in play, minus everything already
  placed. Shift-drag or the Eraser button erases. On a phone, two fingers pinch and pan.
- `src/scoring.ts`: up to 100 points per region: 75% intersection over union, 25% for the
  distance between centroids, relative to the region's size and the map's. A capital's pin scores
  100 within half a percent of the map's width (23 km on Europe, 160 km on the world), then loses
  a factor e every 5% of the width.
- English or French: the flag at the top right switches, and a French browser starts in French.
  Texts sit next to each other as `tr("Skip", "Passer")` (`src/i18n.ts`). French region and
  capital names come from `src/maps/fr-names.json`, built by `scripts/build-fr-names.mjs` from
  Natural Earth and IGN; `test/i18n.test.ts` checks every region has one. Saves, seeds and best
  scores hold ids, never names, so switching changes nothing in them.
- Satellite view: the 🛰️ button under the flag puts NASA Blue Marble imagery (July 2004, public
  domain) under every map but Paris, whose streets would give the borders away. `npm run satellite`
  re-runs those builders with `--satellite`: `scripts/satellite.mjs` reprojects the imagery with
  each map's own projection to `src/maps/satellite/<id>.webp` (2.4 pixels a map unit), downloading
  the sources to `.cache/` once, and writes the projection to `<id>.json`. Zoomed in past that
  image's detail, `src/satellite.ts` lays [Sentinel-2 cloudless 2025](https://s2maps.eu) tiles by
  EOX (10 m a pixel, CC BY-NC-SA 4.0, credit shown on the map) over the visible part only, cut into
  pieces small enough for one affine transform each to stay within half a screen pixel of the
  projection (`test/satellite.test.ts`). If EOX is down, the NASA image stays. It is display only:
  scores and records are shared with the plain map, and shared images show the plain map.
- A map is just `{ width, height, kmPerUnit, land, context, water?, regions }`, so another variant is
  another build script, JSON file and entry in `src/maps/index.ts`.
- There is no backend: `dist/` is static, and best scores and the game in progress live in
  `localStorage`.

## Saves

Players keep weeks of street finds in their browser: no change may lose or alter them.
`test/saves.test.ts` pins what saves rely on: the `localStorage` key and format, every name in
`order` still finding its streets, the order and grouping of the first 5,401 names, and progress
links made on 2026-11-19. A new find only appends to the save, so a name the data no longer knows
stays saved, and the save keeps the order of finds that the replay shows. If one of these tests fails, fix the change, not the test. A street the register
renames needs an alias to its new name, not a removal.

## Deploy

Every push to `main` is tested, built and published to GitHub Pages by
`.github/workflows/pages.yml`.
