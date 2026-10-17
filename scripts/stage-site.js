// Create a deployable snapshot from the single, root-level static site.
// dist/ is generated on demand and is not committed to the repository.
const fs = require("node:fs/promises");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const files = [
  ".nojekyll", "404.html", "activate.html", "index.html",
  "boulevard-replay.html", "boulevard-replay.js", "boulevard-replay-core.js", "boulevard-captures.json"
];

async function stageSite(destination = path.join(root, "dist")) {
  const target = path.resolve(destination);
  if (target === root) throw new Error("Refusing to stage over the source site.");
  await fs.mkdir(target, { recursive: true });
  if ((await fs.readdir(target)).length) throw new Error(`Deployment staging directory is not empty: ${target}`);
  for (const file of files) await fs.copyFile(path.join(root, file), path.join(target, file));
  await fs.cp(path.join(root, "assets"), path.join(target, "assets"), { recursive: true, force: false, errorOnExist: true });
  return target;
}

if (require.main === module) {
  stageSite().then((target) => console.log(`Staged root website at ${target}`))
    .catch((error) => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { stageSite, files };
