# @appskord/scenes

Motikord's scene templates, style packs and renderer, shared so Klipkord can draw Motikord's cards. TypeScript source, no build step.

**Shared with Klipkord: changes must stay additive.** Motikord's output must not change; add templates, packs, fields or exports, never rename or remove one.

## API

```ts
import { drawScene, loadSceneFonts, SCENE_TEMPLATES, STYLE_PACKS } from '@appskord/scenes';

drawScene(
  ctx,
  { template: 'title-hook', slots: { kicker: 'New', headline: 'Clips that move' }, look: { style: 'bold' } },
  '9:16',
  tMs,
  cache,
);
```

- `drawScene(ctx, spec, aspect, tMs, cache?)`: draws the scene at `tMs` over the whole `ctx.canvas`: background, blocks, text in the pack fonts, and in and out motion. `spec` is `{ template, slots, look: { style, brand? }, durationMs? }`; the length defaults to the template's `defaultMs`.
- `cache?: SceneCache`: `{ image(id), fontReady(family, weight) }`. Motikord's `MediaCache` is one. Without it, images are skipped and fonts are checked on the global font set.
- `expandSpec(spec)`: the scene's layers for every size; `expandScene(scene, pack, brand?)` is Motikord's expand.
- `SCENE_TEMPLATES`, `STYLE_PACKS`, `getSceneTemplate`, `getPack`, `autoStyle`, `paceMs`, `transitionFor`, `SAFE_AREA`, and the scene model types.
- `drawFrame(ctx, clip, aspect, tMs, renderCache)`, `clipDuration`, `sceneAt`: the multi-scene renderer Motikord uses.
- `SCENE_FONTS` and `loadSceneFonts(fontFaceSet, baseUrl)`: the pack faces, each at `/fonts/<family>-latin-<weight>-normal.woff2`. The host ships its own copies of the woff2 files (Motikord's are in `apps/motikord/public/fonts`); `@appskord/brand` already bundles Inter, Archivo and Archivo Black.

Subpaths `@appskord/scenes/templates/*` and `@appskord/scenes/render/*` expose each module; Motikord's `lib/templates` and `lib/render` re-export them.

## Template ids

`title-hook`, `big-statement`, `stat-reveal`, `chart`, `quote`, `list`, `hero`, `split`, `before-after`, `steps`, `logo-sting`, `end-card`.

Style packs: `clean`, `bold`, `playful`, `corporate`. A new template or pack is a JSON file in `src/templates/scenes` or `src/templates/packs` plus its import in `src/templates/scenes.ts`.
