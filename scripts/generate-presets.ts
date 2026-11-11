import { AUTOMOTIVE_PRESETS } from "../lib/presets.ts";
import { writeFileSync } from "node:fs";

const cases = AUTOMOTIVE_PRESETS.map((preset) => {
  const payload = JSON.stringify({ mode: "guarded", catalogJsonc: preset.catalogJsonc, operations: preset.operations });
  return `  if (strcmp(preset_id, ${JSON.stringify(preset.id)}) == 0) return ${JSON.stringify(payload)};`;
});
writeFileSync(new URL("../src/c/vss_warden_presets.h", import.meta.url),
  `/* Generated from lib/presets.ts; regenerate with npm run build:c. */\nstatic const char *get_builtin_preset_json(const char *preset_id) {\n${cases.join("\n")}\n  return NULL;\n}\n`);
