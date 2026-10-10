# SHILL TAKEOVER

A touch-first Canvas survival game made with Vite and TypeScript. Float through the supplied Springhill storefront scene, avoid Floaters, collect feet, and evade Bibi after the 25th foot. Best survival time is stored locally per device; this first version has no shared leaderboard or backend.

## Requirements

- Node.js 20.19+ or 22.12+
- npm (included with Node.js)

## Install and run

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. On phones, use portrait orientation and hold the playfield to float upward; release to descend. On desktop, use the mouse or hold Space/Arrow Up. When the browser tab is hidden, the run pauses and offers a resume screen when you return.

On Windows PowerShell, if the `npm.ps1` shim is blocked by execution policy, use the equivalent `npm.cmd install`, `npm.cmd run dev`, `npm.cmd run test`, and `npm.cmd run build` commands.

## Tests and production build

```sh
npm run test
npm run build
npm run preview
```

Vitest covers the timer, feet counter, exact 25-foot Bibi trigger, collision geometry, game-over transition, high-score persistence, and fresh-run reset. The build output is `dist/`.

## Artwork

The six supplied images are copied to `public/images-for-shill/` with their original names and folder casing. The storefront photograph is `background/IMG_4390.JPG`. Portrait art is cut out against its black/white photo matte for the player, Floater, and Bibi; the two game-over illustrations remain full images. Missing artwork degrades to simple Canvas fallbacks rather than stopping play.

## GitHub Pages

Vite is configured with a relative base so built scripts and images work from a repository subpath. Push the project to a GitHub repository, set **Settings → Pages → Build and deployment → Source** to **GitHub Actions**, and push to the `main` branch (or run the workflow manually). The included workflow installs, tests, builds, and deploys `dist/`. A static host can also serve `dist/`; no server-side services are required.

## Future shared leaderboard

The current personal best uses `localStorage` on the current browser/device. No cross-device or shared leaderboard is claimed. A future leaderboard can be added behind a storage/service interface without changing local run mechanics.