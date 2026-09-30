# Local preview

Run `npm run dev`, then open http://127.0.0.1:8888. Set `PORT` to use a different port.
The preview serves the root HTML pages and `assets` directly. No build step or application endpoints are involved, and environment files are not read.

To test the GitHub Pages repository path in PowerShell, run `$env:PAGES_BASE_PATH='/cwash/'; npm run dev` and open http://127.0.0.1:8888/cwash/. Run `Remove-Item Env:PAGES_BASE_PATH` before starting a root-path preview again.
