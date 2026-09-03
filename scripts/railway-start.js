#!/usr/bin/env node
/**
 * Website Launch Step 4: single entry point Railway's Railpack builder can
 * auto-detect (it looks for a "start" script in the package.json at the
 * build root, which for this pnpm workspace is this repo's root
 * package.json — neither app's own package.json is "the root" from
 * Railpack's point of view).
 *
 * Both the `api` and `web` Railway services share this exact repo as
 * their build context (so pnpm workspace resolution — `@transatlantic/
 * shared: workspace:*` — works correctly for both), so this dispatches to
 * the right app's own start command using RAILWAY_SERVICE_NAME, which
 * Railway injects automatically and matches the service name exactly as
 * created (`api` / `web`).
 */
const { execSync } = require('child_process');

const service = process.env.RAILWAY_SERVICE_NAME;
const commands = {
  api: 'pnpm --filter=./apps/api start',
  web: 'pnpm --filter=./apps/web start',
};

const command = commands[service];
if (!command) {
  console.error(
    `railway-start.js: unrecognized RAILWAY_SERVICE_NAME "${service}" — expected one of: ${Object.keys(commands).join(', ')}`,
  );
  process.exit(1);
}

execSync(command, { stdio: 'inherit' });
