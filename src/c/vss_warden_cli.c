#include "vss_warden_core.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define CLI_MAX_INPUT (1024 * 1024)
#define CLI_MAX_OUTPUT (2 * 1024 * 1024)

static const char *get_builtin_preset_json(const char *preset_id) {
  if (strcmp(preset_id, "preset-2-adas-vs-ivi-hijack") == 0) {
    return "{\"mode\":\"guarded\",\"catalogJsonc\":\"{\\\"Vehicle/ADAS/CruiseControl/SpeedSet\\\":{\\\"datatype\\\":\\\"int8\\\",\\\"type\\\":\\\"actuator\\\",\\\"min\\\":0,\\\"max\\\":120,\\\"default\\\":0}}\",\"operations\":[{\"kind\":\"OPEN\",\"fd\":1,\"path\":\"Vehicle/ADAS/CruiseControl/SpeedSet\",\"pid\":4102,\"priority\":10,\"leaseMs\":1000,\"role\":\"IVI_EcoMode\"},{\"kind\":\"OPEN\",\"fd\":2,\"path\":\"Vehicle/ADAS/CruiseControl/.SpeedSet.control\",\"pid\":1040,\"priority\":60,\"leaseMs\":1000,\"role\":\"ADAS_AEB\"},{\"kind\":\"WRITE\",\"fd\":1,\"value\":90,\"nowMs\":100},{\"kind\":\"WRITE\",\"fd\":2,\"value\":0,\"nowMs\":150},{\"kind\":\"WRITE\",\"fd\":1,\"value\":110,\"nowMs\":200},{\"kind\":\"READ_WARDEN\",\"path\":\"Vehicle/ADAS/CruiseControl/SpeedSet?warden,text\",\"nowMs\":210}]}";
  }
  if (strcmp(preset_id, "preset-3-crash-lease-rollback") == 0) {
    return "{\"mode\":\"guarded\",\"catalogJsonc\":\"{\\\"Vehicle/ADAS/CruiseControl/TargetSpeed\\\":{\\\"datatype\\\":\\\"int8\\\",\\\"type\\\":\\\"actuator\\\",\\\"min\\\":0,\\\"max\\\":120,\\\"default\\\":0}}\",\"operations\":[{\"kind\":\"OPEN\",\"fd\":1,\"path\":\"Vehicle/ADAS/CruiseControl/TargetSpeed\",\"pid\":2050,\"priority\":45,\"leaseMs\":600,\"role\":\"ADAS_Cruise\"},{\"kind\":\"OPEN\",\"fd\":2,\"path\":\"Vehicle/ADAS/CruiseControl/TargetSpeed?control,text\",\"pid\":1040,\"priority\":60,\"leaseMs\":500,\"role\":\"ADAS_AEB\"},{\"kind\":\"OPEN\",\"fd\":3,\"path\":\"Vehicle.ADAS.CruiseControl.TargetSpeed\",\"pid\":4102,\"priority\":15,\"leaseMs\":500,\"role\":\"IVI_Cabin\"},{\"kind\":\"WRITE\",\"fd\":1,\"value\":80,\"nowMs\":100},{\"kind\":\"WRITE\",\"fd\":2,\"value\":20,\"nowMs\":150},{\"kind\":\"CLOSE\",\"fd\":2,\"reason\":\"CRASH_DISCONNECT\",\"nowMs\":250},{\"kind\":\"ADVANCE_CLOCK\",\"deltaMs\":500},{\"kind\":\"WRITE\",\"fd\":3,\"value\":55,\"nowMs\":800}]}";
  }
  return "{\"mode\":\"guarded\",\"catalogJsonc\":\"/* Official QPP header comment */ {\\\"Vehicle/Cabin/HVAC/Station/Row1/Driver/Temperature\\\":{\\\"datatype\\\":\\\"float\\\",\\\"type\\\":\\\"actuator\\\",\\\"min\\\":-40.0,\\\"max\\\":125.0,\\\"default\\\":22.5},\\\"Vehicle/Body/Mirrors/Left/Pan\\\":{\\\"datatype\\\":\\\"int8\\\",\\\"type\\\":\\\"actuator\\\",\\\"min\\\":-100,\\\"max\\\":100,\\\"default\\\":0}}\",\"operations\":[{\"kind\":\"OPEN\",\"fd\":1,\"path\":\"Vehicle/Cabin/HVAC/Station/Row1/Driver/Temperature\",\"pid\":1010,\"priority\":30,\"leaseMs\":500,\"role\":\"HVAC_Ctrl\"},{\"kind\":\"OPEN\",\"fd\":2,\"path\":\"Vehicle.Body.Mirrors.Left.Pan\",\"pid\":1020,\"priority\":25,\"leaseMs\":500,\"role\":\"Body_Ctrl\"},{\"kind\":\"WRITE\",\"fd\":2,\"value\":-35,\"nowMs\":100},{\"kind\":\"WRITE\",\"fd\":2,\"value\":120,\"nowMs\":150}]}";
}

int main(int argc, char **argv) {
  const char *preset_id = NULL;
  for (int i = 1; i < argc; i++) {
    if (strcmp(argv[i], "--preset") == 0 && i + 1 < argc) {
      preset_id = argv[++i];
    }
  }

  char *out_buf = (char *)malloc(CLI_MAX_OUTPUT);
  if (!out_buf) return 1;

  if (preset_id != NULL) {
    const char *preset_json = get_builtin_preset_json(preset_id);
    vss_warden_execute_batch_json(preset_json, out_buf, CLI_MAX_OUTPUT);
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
