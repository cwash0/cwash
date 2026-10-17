// Refresh the root-level static capture data from the supplied local snoop logs.
// The output contains captured secure packets: review before publishing GitHub Pages.
const fs = require("node:fs/promises");
const path = require("node:path");
const { boulevardCaptures } = require("./local-server");

async function main() {
  const root = path.resolve(__dirname, "..");
  const captures = await boulevardCaptures();
  if (captures.length !== 2 || captures.some((capture) => capture.chunks.length !== 5)) {
    throw new Error("Both Boulevard captures must be complete before packaging.");
  }
  await fs.writeFile(path.join(root, "boulevard-captures.json"), JSON.stringify({ captures }) + "\n");
  console.log("Refreshed root-level Boulevard captures (2 captures; payloads omitted from output).");
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
