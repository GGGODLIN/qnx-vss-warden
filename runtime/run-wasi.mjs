import { WASI } from "node:wasi";
import { readFileSync, openSync, closeSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const directory = mkdtempSync(path.join(os.tmpdir(), "vss-warden-wasi-"));
const inputPath = path.join(directory, "input.json");
const outputPath = path.join(directory, "output.json");
const descriptors = [];
try {
  writeFileSync(inputPath, readFileSync(0));
  descriptors.push(openSync(inputPath, "r"), openSync(outputPath, "w+"));
  const wasi = new WASI({
    version: "preview1",
    args: ["vss-warden", ...process.argv.slice(2)],
    env: {},
    preopens: {},
    stdin: descriptors[0],
    stdout: descriptors[1],
    stderr: 2,
    returnOnExit: true,
  });
  const module = new WebAssembly.Module(readFileSync(new URL("./vss-warden.wasm", import.meta.url)));
  const instance = new WebAssembly.Instance(module, wasi.getImportObject());
  const code = wasi.start(instance);
  process.stdout.write(readFileSync(outputPath));
  process.exitCode = code;
} finally {
  for (const descriptor of descriptors) closeSync(descriptor);
  rmSync(directory, { recursive: true, force: true });
}
