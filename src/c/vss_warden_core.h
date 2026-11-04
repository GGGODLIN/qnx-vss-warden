#ifndef VSS_WARDEN_CORE_H
#define VSS_WARDEN_CORE_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define VSS_WARDEN_MAX_SIGNALS 64
#define VSS_WARDEN_MAX_OCBS 128
#define VSS_WARDEN_MAX_ALLOWED 16
#define VSS_WARDEN_MAX_ARRAY_ELEMS 16
#define VSS_WARDEN_MAX_PATH_LEN 256
#define VSS_WARDEN_MAX_STR_LEN 128

typedef enum {
  WARDEN_MODE_UNGUARDED = 0,
  WARDEN_MODE_GUARDED = 1
} vss_warden_mode_t;

typedef enum {
  WARDEN_TARGET_VALUE = 0,
  WARDEN_TARGET_CONTROL = 1,
  WARDEN_TARGET_WARDEN = 2
} vss_warden_target_kind_t;

typedef enum {
  WARDEN_DT_INT8 = 0,
  WARDEN_DT_INT16,
  WARDEN_DT_INT32,
  WARDEN_DT_INT64,
  WARDEN_DT_UINT8,
  WARDEN_DT_UINT16,
  WARDEN_DT_UINT32,
  WARDEN_DT_UINT64,
  WARDEN_DT_FLOAT,
  WARDEN_DT_DOUBLE,
  WARDEN_DT_STRING,
  WARDEN_DT_UINT32_ARRAY
} vss_warden_datatype_t;

typedef struct {
  bool ok;
  char canonical_path[VSS_WARDEN_MAX_PATH_LEN];
  vss_warden_target_kind_t target_kind;
  bool text_mode;
  bool has_priority;
  int32_t priority;
  bool has_lease_ms;
  int64_t lease_ms;
  char role[64];
} vss_warden_path_info_t;

int vss_warden_strip_jsonc_comments(const char *src, char *dst, size_t dst_cap);

bool vss_warden_canonicalize_path(const char *raw_path, vss_warden_path_info_t *out_info);

int vss_warden_execute_batch_json(const char *input_json, char *output_buf, size_t output_cap);

#ifdef __cplusplus
}
#endif

#endif
