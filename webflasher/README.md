# Bruce Niagara Web Flasher

Public site: https://atlasru.github.io/Bruce-Niagara/

A static, self-contained Web Serial installer for the T-Embed CC1101 build. Russian and English UI; no analytics, accounts or uploaded device data. Uses Espressif esptool-js 0.7.0, bundled locally with its dependencies and license notices.

The default application update writes at `0x10000` after checking the original Bruce 1.15 partition layout. A separately confirmed full installation writes the merged image at `0x0` and resets NVS settings. Neither mode requests a whole-chip erase. Chip family, 16 MB flash, security state, image size and SHA-256 are checked before writing; device MD5 is checked before showing success. Chip detection cannot prove the board model, so the user must confirm T-Embed CC1101.

Published binaries are pinned in `public/firmware.json`. Builds fetch the named release assets and verify both hashes before packaging them on the same origin as the page. Firmware binaries and `dist/` are not committed. To publish a new firmware version, update the manifest only after testing and releasing its binaries.

## Develop

Requires Node.js 24 and npm.

```sh
npm ci
npm test
npm run build
npm run serve
```

For an offline build, use `npm run build -- --firmware-dir /path/to/release-assets`. Preview at `http://127.0.0.1:4173/`. Deployment uses `.github/workflows/web-flasher-pages.yml` and the GitHub Pages Actions publishing source.

The firmware was physically flashed and tested using esptool CLI. Automated tests cover mocked transport operations and rejection paths. Browser UI has been checked; a complete hardware flash through this website remains to be tested. Keep a device backup and use a desktop browser supporting Web Serial, such as Chrome or Edge, over HTTPS or localhost.
