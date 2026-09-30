# CircuitWash

The static website for [cwash0/cwash](https://github.com/cwash0/cwash), formerly named `cwash0/circuitwash`. Editable site files live at the repository root, with a deployment copy directly inside `production/` in the same repository:

- `index.html` — search by site name or address.
- `activate.html` — machine selection and unlimited Bluetooth activation.
- `assets/data/catalog.json` — the site catalog.
- `assets/data/sites-*.json` — static machine and cycle data.
- `.nojekyll` — serve the files directly on GitHub Pages.

There is no `public` folder, build step, server, database or package dependency. The browser remembers the selected site in `localStorage`; **Change site** returns to search.

## Publish

Commit and push this repository to `main`. The included **Deploy GitHub Pages** workflow uploads `production/` directly. Keep **Settings → Pages → Source → GitHub Actions** selected. The folder contains the HTML pages, `.nojekyll`, and all assets, including the site catalog and machine data, without a `public` subfolder.

After editing the root files, refresh the production copy before publishing: `Copy-Item index.html, activate.html, 404.html, .nojekyll -Destination production -Force` and `Copy-Item assets -Destination production -Recurse -Force` in PowerShell. Remove any retired assets from the production copy as part of the same change.

The live site is https://cwash0.github.io/cwash/. The former `/circuitwash/` URL does not follow the repository rename. [Pages settings](https://github.com/cwash0/cwash/settings/pages).

The workflow is only a publishing helper, not a website runtime.

## Local checks

`npm run dev` previews the root files at http://127.0.0.1:8888. No build or installation is needed. `npm test` runs the data, persistence, Bluetooth simulation, static route and repository-path checks.

To preview the GitHub Pages path in PowerShell, run `$env:PAGES_BASE_PATH='/cwash/'; npm run dev`, then open http://127.0.0.1:8888/cwash/. Use `Remove-Item Env:PAGES_BASE_PATH` to return to the root preview.

Machine activation requires HTTPS (or localhost), a compatible Web Bluetooth browser and a nearby machine. iOS users can use Bluefy. Commands are bundled in the downloadable static data. Tests simulate Bluetooth; physical machine operation must be checked on site.

The former source repository and old folder layout are retained locally under `.retired` for recovery. That folder is ignored by Git and must never be uploaded. This working directory retains the selected production repository's history.
