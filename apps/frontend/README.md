# frontend

Frontend code for static Stellar Optimizer.

## Dev Server

Run `nx serve frontend`

## Preview

To preview the production build locally, run `nx build frontend` and then `nx preview frontend`

## Feature flags

KQM Theorycrafting is switched on by `GO_KQM_THEORYCRAFTING=1` in `apps/frontend/.env`, so
it is in local development and in both production builds (the beta and released sites). Its
tab, direct route, and settings panel are gated together. Existing saved KQM settings are
preserved while it is off.

A shell environment variable overrides the `.env` value:

- `GO_KQM_THEORYCRAFTING=0 yarn nx serve frontend` hides it locally.
- `GO_KQM_THEORYCRAFTING=0 yarn nx build frontend` leaves it out of a build.

Without any value it is on for `nx serve` only. The flag is set at build time: restart the
dev server or rebuild after changing it.

## Adding new assets

Either add assets to `apps/frontend/assets` or configure the call to `viteStaticCopy` in `vite.config.mts` to copy library assets to the `assets` folder.

You can then reference them without any leading path, e.g. `notification.mp3`.
