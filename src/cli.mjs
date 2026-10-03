#!/usr/bin/env node
import { open, mkdir, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  LIMITS,
  planSnapshot,
  reportJSON,
  leftoverCSV,
  picksCSV,
  printableHTML,
} from "./core.mjs";
export async function main(
  args,
  io = {
    out: (text) => process.stdout.write(text),
    error: (text) => process.stderr.write(text),
  },
) {
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
    io.out(
      "Kit Ledger\nUsage: node src/cli.mjs snapshot.json [--out NEW_DIRECTORY] [--lang en|ja]\nWithout --out: JSON report on stdout. Output directories must not exist.\n",
    );
    return 0;
  }
  if (!args[0] || args[0].startsWith("-")) {
    io.error("Expected a snapshot file. Use --help.\n");
    return 2;
  }
  let output;
  let lang = "en";
  const seen = new Set();
  for (let i = 1; i < args.length; i += 2) {
    const key = args[i],
      value = args[i + 1];
    if (!["--out", "--lang"].includes(key) || !value || seen.has(key)) {
      io.error("Invalid or repeated option. Use --help.\n");
      return 2;
    }
    seen.add(key);
    if (key === "--out") output = resolve(value);
    else lang = value;
  }
  if (!["en", "ja"].includes(lang)) {
    io.error("--lang must be en or ja.\n");
    return 2;
  }
  try {
    const file = await open(
      args[0],
      constants.O_RDONLY | (constants.O_NONBLOCK ?? 0),
    );
    let text;
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size > LIMITS.bytes)
        throw new Error(
          `Input must be a regular file of at most ${LIMITS.bytes} bytes`,
        );
      // Bounded reads also cover a file growing after stat; never allocate by file size.
      const buffer = Buffer.alloc(LIMITS.bytes + 1);
      let offset = 0;
      while (offset < buffer.length) {
        const { bytesRead } = await file.read(
          buffer,
          offset,
          buffer.length - offset,
          offset,
        );
        if (!bytesRead) break;
        offset += bytesRead;
      }
      if (offset > LIMITS.bytes)
        throw new Error(`Input exceeds ${LIMITS.bytes} bytes`);
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
        buffer.subarray(0, offset),
      );
    } finally {
      await file.close();
    }
    const report = planSnapshot(text);
    if (!output) io.out(reportJSON(report));
    else {
      // mkdir without recursive is an atomic no-overwrite gate. Never touch an existing directory.
      await mkdir(output);
      const files = {
        "plan.json": reportJSON(report),
        "leftovers.csv": leftoverCSV(report),
        "picks.csv": picksCSV(report),
        "pick-sheets.html": printableHTML(report, lang),
      };
      for (const [name, content] of Object.entries(files))
        await writeFile(resolve(output, name), content, { flag: "wx" });
      io.out(`Wrote ${Object.keys(files).length} files to ${output}\n`);
    }
    return 0;
  } catch (error) {
    io.error(`${error.code ?? "ERROR"}: ${error.message}\n`);
    return 1;
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  process.exitCode = await main(process.argv.slice(2));
