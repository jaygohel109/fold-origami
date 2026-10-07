# Fold: an origami workbench

Fold a virtual square of paper in 3D: valley, mountain, inside and outside reverse folds, open sinks, squash folds, petal folds, pull-outs, and bends to any angle, with layered paper thickness.

## Run it
Open `index.html` in a browser. It works offline because three.js is included in `lib/`.

`fold-single-file.html` is the same app in one file, but it loads three.js from a CDN, so it needs internet.

## Files
- `src/engine.js`: flat-folding geometry (splitting facets, layer order, fold operations). No browser needed.
- `src/app.js`: three.js rendering, animation, and the interface.
- `lib/`: three.js r128 and OrbitControls.
- `tests/engine.test.js`: folds the preliminary base, the waterbomb base, and reverse folds.
- `tests/birdbase.test.js`: folds a bird base with two petal folds.
Run them with `node tests/<name>.js`.

## Tutorials
Open Tutorials in the top bar: "The basics", "Squash folds", "Petal folds" (preliminary base to bird base), "Bend into 3D", "Fold a crane" (16 steps), and "Fold an elephant", an 11-step model that uses Pull out and a crimp. Glowing markers show where to tap, and Show me does a step for you. First-time visitors are offered the basics tour.

## Stand it up
Sheet → Stand it up turns the mat into a floor so side-view models like the elephant stand upright and can be orbited.

## Controls
Drag to draw a crease, then tap the side to fold. Shortcuts: V valley, M mountain, I inside reverse, O outside reverse, S sink, Q squash, P petal, B bend, U pull out, T turn over, R rotate, Space look around, Ctrl+Z undo.

## Known limits
Bends are straight hinges, so paper can't curl smoothly. Flat folds flatten any bends first. No closed sinks, and no collision checking.
