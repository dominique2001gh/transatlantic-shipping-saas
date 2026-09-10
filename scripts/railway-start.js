#!/usr/bin/env node
/**
 * Website Launch Step 4: single entry point Railway's Railpack builder can
 * auto-detect (it looks for a "start" script in the package.json at the
 * build root, which for this pnpm workspace is this repo's root
 * package.json — neither app's own package.json is "the root" from
 * Railpack's point of view).
 *
 * The `api`, `web`, and `ananselogix-web` Railway services all share this
 * exact repo as their build context (so pnpm workspace resolution —
 * `@transatlantic/shared: workspace:*` — works correctly for all of
 * them), so this dispatches to the right app's own start command using
 * RAILWAY_SERVICE_NAME, which Railway injects automatically and matches
 * the service name exactly as created (`api` / `web` / `ananselogix-web`).
 *
 * `ananselogix-web` (Website Launch Step 5) is a second, separate Railway
 * service instance running the *same* apps/web Next.js app as `web` — the
 * one that will eventually sit behind ananselogix.com. It is not a
 * different app/build target, just another deployment of this one, which
 * is why it maps to the identical start command as `web` below.
 */
const { execSync } = require('child_process');

const service = process.env.RAILWAY_SERVICE_NAME;
const commands = {
  api: 'pnpm --filter=./apps/api start',
  web: 'pnpm --filter=./apps/web start',
  'ananselogix-web': 'pnpm --filter=./apps/web start',
};

const command = commands[service];
if (!command) {
  console.error(
    `railway-start.js: unrecognized RAILWAY_SERVICE_NAME "${service}" — expected one of: ${Object.keys(commands).join(', ')}`,
  );
  process.exit(1);
}

execSync(command, { stdio: 'inherit' });
