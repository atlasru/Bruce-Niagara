# Portrait UI implementation

Base: upstream Bruce tag `1.15`, commit `00eab49a2fcef33c2caacb1d6133341238d94477`.
Target: `lilygo-t-embed-cc1101-niagara`, Lilygo T-Embed CC1101, 170 × 320 display.

## Rendering and controls

`src/core/niagara_menu.cpp` draws a single-column menu using a temporary framebuffer, with direct rendering as an allocation fallback. Long focused labels scroll after 1.2 seconds. The file picker uses the same renderer; legacy filename scrolling is disabled so it cannot overpaint the new screen.

The renderer reads `bruceConfig.priColor`, `secColor` and `bgColor` each frame. Custom-color previews therefore affect the visible UI immediately. A foreground identical to the background receives a readable fallback. Theme border and heading preferences are supported; navigation labels stay visible. New themes reset previous asset flags before loading.

Hardware testing established rotation `2` as wheel-below portrait. The initial native reference remains `BRUCE_NIAGARA_ROTATION=0`; the corrected direction is derived in `niagara_menu.h`. Explicit portrait selection is stored in the `niagara-ui` Preferences namespace and survives restarts.

`boards/lilygo-t-embed-cc1101/interface.cpp` and RotaryEncoder 1.5.3 are unchanged from the base tag. Button debounce, stale queued-step clearing, post-movement selection delay and the menu's selection guard are preserved.

## Compatibility fixes

- FastLED 3.10.3 is pinned; 3.10.8 introduced a template name that collided with Bruce's `FP` font macro.
- The build script calls the unified Xtensa toolchain used by Arduino ESP32 3.x.
- `custom_offline_assets=yes` preserves the original web content using local gzip compression instead of a remote minifier.

## Validation

- The target builds successfully with Arduino ESP32 3.3.6 and Xtensa GCC 14.2.0.
- Image checksum and validation hash passed esptool checks.
- The merged bootloader, partition table and app were checked against their component files.
- The app-only image was written at `0x10000` and passed a separate flash digest verification.
- Portrait direction, menu navigation, UI Color and UI Theme were confirmed on one physical T-Embed CC1101.
- All four locally compressed web assets passed a byte-for-byte gzip round-trip check.
- The board input implementation matches upstream 1.15.

`build-info.json` identifies the tested artifact. Hardware-specific identifiers, settings and device backups are not distributed.

## Scope

Individual RF/IR/WiFi app screens and keyboards retain their upstream layouts. Favorites, alphabetical jumping and animations are not implemented. Themes supply colors and border/heading choices; category-image artwork is not rendered by this launcher.

## Illustrations

`home.png` and `settings.png` are generated layout illustrations using the bundled TFT font and example lime palette. They are not device screenshots. Regenerate from the repository root with `python docs/niagara/preview.py` (Pillow required).
