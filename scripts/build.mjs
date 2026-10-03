import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
await rm(`${root}dist`, { recursive: true, force: true });
await mkdir(`${root}dist/src`, { recursive: true });
await cp(`${root}web`, `${root}dist`, { recursive: true });
await cp(`${root}src/core.mjs`, `${root}dist/src/core.mjs`);
const example = JSON.parse(
  await readFile(`${root}examples/workshop.json`, "utf8"),
);
await writeFile(
  `${root}dist/example.mjs`,
  `export default ${JSON.stringify(example, null, 2)};\n`,
);
console.log("Built dependency-free static app in dist/");
