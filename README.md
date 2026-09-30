# CircuitWash on GitHub Pages

This repository contains the ready-to-publish static website in `public`.

In GitHub, set **Settings → Pages → Source** to **GitHub Actions**, then push these files to `main`. The included **Deploy GitHub Pages** workflow configures the 404 page for the repository's Pages URL and uploads only `public`.

Keep `.github/workflows/pages.yml`, `scripts/pages-config.js` and the complete `public` folder (including `.nojekyll` and `assets/data`) in the commit. No server, database, hosting keys or package installation is required.

Site searches and Bluetooth activation use static JSON files. Site selection is saved in the browser. Activation requires HTTPS, a compatible Web Bluetooth browser and a nearby machine.
