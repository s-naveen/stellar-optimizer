# frontend

Frontend code for static Stellar Optimizer.

## Dev Server

Run `nx serve frontend`

## Preview

To preview the production build locally, run `nx build frontend` and then `nx preview frontend`

## Feature flags

KQM Theorycrafting is enabled for local development and disabled in production builds
(including both the beta and released sites). Its tab, direct route, and settings panel
are gated together. Existing saved KQM settings are preserved.

Use the shell environment variable `GO_KQM_THEORYCRAFTING` to override the default:

- `GO_KQM_THEORYCRAFTING=0 yarn nx serve frontend` disables it locally.
- `GO_KQM_THEORYCRAFTING=1 yarn nx build frontend` includes it in a build when ready.

The flag is set at build time. Restart the dev server or rebuild after changing it.

## Adding new assets

Either add assets to `apps/frontend/assets` or configure the call to `viteStaticCopy` in `vite.config.mts` to copy library assets to the `assets` folder.

You can then reference them without any leading path, e.g. `notification.mp3`.
