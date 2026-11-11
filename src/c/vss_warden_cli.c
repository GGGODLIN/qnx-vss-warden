#include "vss_warden_core.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define CLI_MAX_INPUT (1024 * 1024)
#define CLI_MAX_OUTPUT (2 * 1024 * 1024)

#include "vss_warden_presets.h"

int main(int argc, char **argv) {
  const char *preset_id = NULL;
  uint32_t seed = 0;
  bool has_seed = false;
  for (int i = 1; i < argc; i++) {
    if (strcmp(argv[i], "--preset") == 0 && i + 1 < argc) {
      preset_id = argv[++i];
    } else if (strcmp(argv[i], "--seed") == 0 && i + 1 < argc) {
      char *end = NULL;
      const char *text = argv[++i];
      unsigned long long value = strtoull(text, &end, 10);
      if (!text[0] || text[0] == '-' || *end || value > UINT32_MAX) return 1;
      seed = (uint32_t)value;
      has_seed = true;
    } else {
      fputs("Usage: vss-warden-cli [--preset <id> [--seed <uint32>]]\n", stderr);
      return 1;
    }
  }
  if (has_seed && !preset_id) return 1;

  char *out_buf = (char *)malloc(CLI_MAX_OUTPUT);
  if (!out_buf) return 1;

  if (preset_id != NULL) {
    const char *preset_json = get_builtin_preset_json(preset_id);
    if (preset_json == NULL) {
      fputs("{\"ok\":false,\"status\":\"EINVAL\",\"mode\":\"guarded\",\"errorMessage\":\"Unknown preset ID\",\"steps\":[]}\n", stdout);
      free(out_buf);
      return 1;
    }
    int result = has_seed
        ? vss_warden_execute_seeded_preset(preset_json, seed, out_buf, CLI_MAX_OUTPUT)
        : vss_warden_execute_batch_json(preset_json, out_buf, CLI_MAX_OUTPUT);
    if (result != 0) {
      free(out_buf);
      return 1;
    }
    fputs(out_buf, stdout);
    free(out_buf);
    return 0;
  }

  char *in_buf = (char *)malloc(CLI_MAX_INPUT);
  if (!in_buf) {
    free(out_buf);
    return 1;
  }

  size_t total_read = 0;
  while (total_read + 1 < CLI_MAX_INPUT) {
    size_t n = fread(in_buf + total_read, 1, CLI_MAX_INPUT - 1 - total_read, stdin);
    if (n == 0) break;
    total_read += n;
  }
  in_buf[total_read] = '\0';

  vss_warden_execute_batch_json(in_buf, out_buf, CLI_MAX_OUTPUT);
  fputs(out_buf, stdout);

  free(in_buf);
  free(out_buf);
  return 0;
}
