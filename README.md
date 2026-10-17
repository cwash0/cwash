# CircuitWash

The static website for [cwash0/cwash](https://github.com/cwash0/cwash), formerly named `cwash0/circuitwash`. The repository root is the single editable copy of the site:

- `index.html` — search by site name or address.
- `activate.html` — machine selection and unlimited Bluetooth activation.
- `assets/data/catalog.json` — the site catalog.
- `assets/data/sites-*.json` — static machine and cycle data.
- `boulevard-replay.html` — Boulevard B Block Bluetooth debug page.
- `.nojekyll` — serve the files directly on GitHub Pages.

There is no application build step. The published GitHub Pages site is static and has no database access. The browser remembers the selected site in `localStorage`; **Change site** returns to search.

## Publish

Commit and push this repository to `main`. The included **Deploy GitHub Pages** workflow stages only the root site's public files into a temporary `dist/` directory and uploads that bundle. Keep **Settings → Pages → Source → GitHub Actions** selected. There is no committed `production/` or `preview/` copy to refresh.

The live site is https://cwash0.github.io/cwash/. The former `/circuitwash/` URL does not follow the repository rename. [Pages settings](https://github.com/cwash0/cwash/settings/pages).

The workflow is only a publishing helper, not a website runtime.

## Local checks

Run `npm install`, then `npm run dev` to serve the root files at http://127.0.0.1:8888. `npm test` runs the data, persistence, Bluetooth simulation, diagnostic route and repository-path checks. The local server lives in `scripts/local-server.js`; it is not published by GitHub Pages.

For the captured Boulevard B Block Washer 2 Standard Eco test, open `/activate.html?site=the_boulevard_b_block&secureReplay=1` on the Netlify-hosted site. The page sends inbound Bluetooth notifications, reconstructed replies, timestamps and the attempt outcome to `/.netlify/functions/ble-log`. The function writes them to `public.ble_test_logs` in Neon and creates the table on its first successful request. In the Netlify UI, set `DB_LINK` to the PostgreSQL connection URL with the **Functions** scope (or all scopes), then redeploy. A successful page message says **Diagnostic saved to database**. The page never receives the database password or logs the outbound secure-packet bytes. GitHub Pages does not host the logging function.

For optional Netlify testing, `netlify.toml` stages the same root files into `dist/` and bundles functions from `netlify/functions/`. GitHub Pages cannot run that database function. No database URL belongs in the repository or in `netlify.toml`.

To preview the GitHub Pages path in PowerShell, run `$env:PAGES_BASE_PATH='/cwash/'; npm run dev`, then open http://127.0.0.1:8888/cwash/. Use `Remove-Item Env:PAGES_BASE_PATH` to return to the root preview.

The Boulevard B Block replay debug page is `/boulevard-replay.html` at the site root. Its adjacent `boulevard-captures.json` contains the two captured secure packets so the page works on static hosting. Publishing GitHub Pages will make those packets publicly downloadable. To refresh the JSON from the local snoop logs, run `node scripts/package-boulevard-replay.js`. That command does not deploy.

Machine activation requires HTTPS (or localhost), a compatible Web Bluetooth browser and a nearby machine. iOS users can use Bluefy. Commands are bundled in the downloadable static data. Tests simulate Bluetooth; physical machine operation must be checked on site.

The former source repository and old folder layout are retained locally under `.retired` for recovery. That folder is ignored by Git and must never be uploaded. This working directory retains the selected production repository's history.
