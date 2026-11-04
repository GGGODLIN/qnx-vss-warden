#include "vss_warden_core.h"

#include <ctype.h>
#include <errno.h>
#include <limits.h>
#include <math.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef enum {
  J_NULL = 0,
  J_BOOL,
  J_NUMBER,
  J_STRING,
  J_ARRAY,
  J_OBJECT
} jtype_t;

typedef struct json_val {
  jtype_t type;
  bool bval;
  double nval;
  char *sval;
  struct {
    struct json_val **items;
    size_t count;
    size_t cap;
  } arr;
  struct {
    char **keys;
    struct json_val **vals;
    size_t count;
    size_t cap;
  } obj;
} json_val_t;

typedef struct {
  const char *s;
  size_t pos;
  size_t len;
  bool err;
} jparser_t;

static void j_skip_ws(jparser_t *p) {
  while (p->pos < p->len) {
    char c = p->s[p->pos];
    if (c == ' ' || c == '\t' || c == '\r' || c == '\n') {
      p->pos++;
    } else {
      break;
    }
  }
}

static json_val_t *j_alloc(jtype_t t) {
  json_val_t *v = (json_val_t *)calloc(1, sizeof(json_val_t));
  if (v) v->type = t;
  return v;
}

static void j_free(json_val_t *v) {
  if (!v) return;
  if (v->type == J_STRING) {
    free(v->sval);
  } else if (v->type == J_ARRAY) {
    for (size_t i = 0; i < v->arr.count; i++) {
      j_free(v->arr.items[i]);
    }
    free(v->arr.items);
  } else if (v->type == J_OBJECT) {
    for (size_t i = 0; i < v->obj.count; i++) {
      free(v->obj.keys[i]);
      j_free(v->obj.vals[i]);
    }
    free(v->obj.keys);
    free(v->obj.vals);
  }
  free(v);
}

static char *j_parse_raw_string(jparser_t *p) {
  if (p->pos >= p->len || p->s[p->pos] != '"') {
    p->err = true;
    return NULL;
  }
  p->pos++;
  size_t cap = 64;
  size_t len = 0;
  char *buf = (char *)malloc(cap);
  if (!buf) {
    p->err = true;
    return NULL;
  }
  while (p->pos < p->len) {
    char c = p->s[p->pos++];
    if (c == '"') {
      buf[len] = '\0';
      return buf;
    }
    if ((unsigned char)c < 0x20) {
      free(buf);
      p->err = true;
      return NULL;
    }
    if (c == '\\') {
      if (p->pos >= p->len) {
        free(buf);
        p->err = true;
        return NULL;
      }
      char esc = p->s[p->pos++];
      switch (esc) {
        case '"': c = '"'; break;
        case '\\': c = '\\'; break;
        case '/': c = '/'; break;
        case 'b': c = '\b'; break;
        case 'f': c = '\f'; break;
        case 'n': c = '\n'; break;
        case 'r': c = '\r'; break;
        case 't': c = '\t'; break;
        case 'u': {
          if (p->pos + 4 > p->len) {
            free(buf);
            p->err = true;
            return NULL;
          }
          unsigned int code = 0;
          for (int k = 0; k < 4; k++) {
            char hc = p->s[p->pos++];
            code <<= 4;
            if (hc >= '0' && hc <= '9') code |= (unsigned int)(hc - '0');
            else if (hc >= 'a' && hc <= 'f') code |= (unsigned int)(hc - 'a' + 10);
            else if (hc >= 'A' && hc <= 'F') code |= (unsigned int)(hc - 'A' + 10);
            else {
              free(buf);
              p->err = true;
              return NULL;
            }
          }
          c = (code < 0x80) ? (char)code : '?';
          break;
        }
        default:
          free(buf);
          p->err = true;
          return NULL;
      }
    }
    if (len + 2 >= cap) {
      cap *= 2;
      char *nb = (char *)realloc(buf, cap);
      if (!nb) {
        free(buf);
        p->err = true;
        return NULL;
      }
      buf = nb;
    }
    buf[len++] = c;
  }
  free(buf);
  p->err = true;
  return NULL;
}

static json_val_t *j_parse_value(jparser_t *p);

static json_val_t *j_parse_array(jparser_t *p) {
  p->pos++;  // skip '['
  json_val_t *v = j_alloc(J_ARRAY);
  if (!v) {
    p->err = true;
    return NULL;
  }
  j_skip_ws(p);
  if (p->pos < p->len && p->s[p->pos] == ']') {
    p->pos++;
    return v;
  }
  while (p->pos < p->len && !p->err) {
    json_val_t *item = j_parse_value(p);
    if (!item || p->err) {
      j_free(v);
      return NULL;
    }
    if (v->arr.count == v->arr.cap) {
      size_t ncap = v->arr.cap == 0 ? 8 : v->arr.cap * 2;
      json_val_t **nitems = (json_val_t **)realloc(v->arr.items, ncap * sizeof(json_val_t *));
      if (!nitems) {
        j_free(item);
        j_free(v);
        p->err = true;
        return NULL;
      }
      v->arr.items = nitems;
      v->arr.cap = ncap;
    }
    v->arr.items[v->arr.count++] = item;
    j_skip_ws(p);
    if (p->pos < p->len && p->s[p->pos] == ',') {
      p->pos++;
      j_skip_ws(p);
    } else if (p->pos < p->len && p->s[p->pos] == ']') {
      p->pos++;
      return v;
    } else {
      p->err = true;
      j_free(v);
      return NULL;
    }
  }
  p->err = true;
  j_free(v);
  return NULL;
}

static json_val_t *j_parse_object(jparser_t *p) {
  p->pos++;  // skip '{'
  json_val_t *v = j_alloc(J_OBJECT);
  if (!v) {
    p->err = true;
    return NULL;
  }
  j_skip_ws(p);
  if (p->pos < p->len && p->s[p->pos] == '}') {
    p->pos++;
    return v;
  }
  while (p->pos < p->len && !p->err) {
    j_skip_ws(p);
    char *key = j_parse_raw_string(p);
    if (!key || p->err) {
      j_free(v);
      return NULL;
    }
    j_skip_ws(p);
    if (p->pos >= p->len || p->s[p->pos] != ':') {
      free(key);
      p->err = true;
      j_free(v);
      return NULL;
    }
    p->pos++;
    j_skip_ws(p);
    json_val_t *val = j_parse_value(p);
    if (!val || p->err) {
      free(key);
      j_free(v);
      return NULL;
    }
    if (v->obj.count == v->obj.cap) {
      size_t ncap = v->obj.cap == 0 ? 8 : v->obj.cap * 2;
      char **nkeys = (char **)realloc(v->obj.keys, ncap * sizeof(char *));
      json_val_t **nvals = (json_val_t **)realloc(v->obj.vals, ncap * sizeof(json_val_t *));
      if (!nkeys || !nvals) {
        free(key);
        j_free(val);
        if (nkeys) v->obj.keys = nkeys;
        if (nvals) v->obj.vals = nvals;
        j_free(v);
        p->err = true;
        return NULL;
      }
      v->obj.keys = nkeys;
      v->obj.vals = nvals;
      v->obj.cap = ncap;
    }
    v->obj.keys[v->obj.count] = key;
    v->obj.vals[v->obj.count] = val;
    v->obj.count++;
    j_skip_ws(p);
    if (p->pos < p->len && p->s[p->pos] == ',') {
      p->pos++;
      j_skip_ws(p);
    } else if (p->pos < p->len && p->s[p->pos] == '}') {
      p->pos++;
      return v;
    } else {
      p->err = true;
      j_free(v);
      return NULL;
    }
  }
  p->err = true;
  j_free(v);
  return NULL;
}

static json_val_t *j_parse_value(jparser_t *p) {
  j_skip_ws(p);
  if (p->pos >= p->len) {
    p->err = true;
    return NULL;
  }
  char c = p->s[p->pos];
  if (c == '{') return j_parse_object(p);
  if (c == '[') return j_parse_array(p);
  if (c == '"') {
    char *s = j_parse_raw_string(p);
    if (!s || p->err) return NULL;
    json_val_t *v = j_alloc(J_STRING);
    if (!v) {
      free(s);
      p->err = true;
      return NULL;
    }
    v->sval = s;
    return v;
  }
  if (strncmp(&p->s[p->pos], "true", 4) == 0) {
    p->pos += 4;
    json_val_t *v = j_alloc(J_BOOL);
    if (v) v->bval = true;
    return v;
  }
  if (strncmp(&p->s[p->pos], "false", 5) == 0) {
    p->pos += 5;
    json_val_t *v = j_alloc(J_BOOL);
    if (v) v->bval = false;
    return v;
  }
  if (strncmp(&p->s[p->pos], "null", 4) == 0) {
    p->pos += 4;
    return j_alloc(J_NULL);
  }
  if (c == '-' || (c >= '0' && c <= '9')) {
    const char *start = &p->s[p->pos];
    char *endptr = NULL;
    double d = strtod(start, &endptr);
    if (endptr == start || !isfinite(d)) {
      p->err = true;
      return NULL;
    }
    p->pos += (size_t)(endptr - start);
    json_val_t *v = j_alloc(J_NUMBER);
    if (v) v->nval = d;
    return v;
  }
  p->err = true;
  return NULL;
}

static json_val_t *j_parse_root(const char *str) {
  if (!str) return NULL;
  jparser_t p = {str, 0, strlen(str), false};
  j_skip_ws(&p);
  if (p.pos >= p.len) return NULL;
  json_val_t *root = j_parse_value(&p);
  if (!root || p.err) {
    j_free(root);
    return NULL;
  }
  j_skip_ws(&p);
  if (p.pos != p.len) {
    j_free(root);
    return NULL;
  }
  return root;
}

static json_val_t *j_obj_get(const json_val_t *obj, const char *key) {
  if (!obj || obj->type != J_OBJECT || !key) return NULL;
  for (size_t i = 0; i < obj->obj.count; i++) {
    if (strcmp(obj->obj.keys[i], key) == 0) {
      return obj->obj.vals[i];
    }
  }
  return NULL;
}

int vss_warden_strip_jsonc_comments(const char *src, char *dst, size_t dst_cap) {
  if (!src || !dst || dst_cap == 0) return -1;
  size_t i = 0;
  size_t out = 0;
  bool in_string = false;

  while (src[i] != '\0') {
    if (out + 2 >= dst_cap) return -1;
    char c = src[i];
    if (in_string) {
      if (c == '\\' && src[i + 1] != '\0') {
        dst[out++] = src[i++];
        dst[out++] = src[i++];
        continue;
      }
      if (c == '"') {
        in_string = false;
      }
      dst[out++] = src[i++];
    } else {
      if (c == '"') {
        in_string = true;
        dst[out++] = src[i++];
      } else if (c == '/' && src[i + 1] == '*') {
        i += 2;
        bool closed = false;
        while (src[i] != '\0') {
          if (src[i] == '*' && src[i + 1] == '/') {
            i += 2;
            closed = true;
            break;
          }
          i++;
        }
        if (!closed) return -1;
        dst[out++] = ' ';
      } else if (c == '/' && src[i + 1] == '/') {
        i += 2;
        while (src[i] != '\0' && src[i] != '\n') {
          i++;
        }
      } else {
        dst[out++] = src[i++];
      }
    }
  }
  dst[out] = '\0';
  return 0;
}

bool vss_warden_canonicalize_path(const char *raw_path, vss_warden_path_info_t *out_info) {
  if (!raw_path || !out_info) return false;
  memset(out_info, 0, sizeof(*out_info));
  out_info->target_kind = WARDEN_TARGET_VALUE;

  while (*raw_path == ' ' || *raw_path == '\t' || *raw_path == '\r' || *raw_path == '\n') {
    raw_path++;
  }
  size_t raw_len = strlen(raw_path);
  while (raw_len > 0 && (raw_path[raw_len - 1] == ' ' || raw_path[raw_len - 1] == '\t' ||
                         raw_path[raw_len - 1] == '\r' || raw_path[raw_len - 1] == '\n')) {
    raw_len--;
  }
  if (raw_len == 0 || raw_len >= VSS_WARDEN_MAX_PATH_LEN * 2) return false;

  char trimmed_raw[VSS_WARDEN_MAX_PATH_LEN * 2];
  memcpy(trimmed_raw, raw_path, raw_len);
  trimmed_raw[raw_len] = '\0';
  raw_path = trimmed_raw;

  const char *qmark = strchr(raw_path, '?');
  size_t path_part_len = raw_len;
  if (qmark != NULL) {
    if (strchr(qmark + 1, '?') != NULL) {
      return false;
    }
    path_part_len = (size_t)(qmark - raw_path);
    char mod_buf[VSS_WARDEN_MAX_PATH_LEN];
    size_t mod_len = strlen(qmark + 1);
    if (mod_len == 0 || mod_len >= sizeof(mod_buf)) return false;
    memcpy(mod_buf, qmark + 1, mod_len + 1);

    char *saveptr = NULL;
    char *tok = strtok_r(mod_buf, ",", &saveptr);
    while (tok != NULL) {
      while (*tok == ' ' || *tok == '\t') tok++;
      size_t tlen = strlen(tok);
      while (tlen > 0 && (tok[tlen - 1] == ' ' || tok[tlen - 1] == '\t')) {
        tok[--tlen] = '\0';
      }
      if (strcmp(tok, "text") == 0) {
        out_info->text_mode = true;
      } else if (strcmp(tok, "control") == 0) {
        out_info->target_kind = WARDEN_TARGET_CONTROL;
      } else if (strcmp(tok, "warden") == 0) {
        out_info->target_kind = WARDEN_TARGET_WARDEN;
      } else if (strncmp(tok, "priority=", 9) == 0) {
        char *endptr = NULL;
        long parsed_prio = strtol(tok + 9, &endptr, 10);
        if (endptr != tok + 9 && *endptr == '\0') {
          out_info->has_priority = true;
          out_info->priority = (int32_t)parsed_prio;
        }
      } else if (strncmp(tok, "lease=", 6) == 0) {
        char *endptr = NULL;
        long long parsed_lease = strtoll(tok + 6, &endptr, 10);
        if (endptr != tok + 6 && *endptr == '\0') {
          out_info->has_lease_ms = true;
          out_info->lease_ms = (int64_t)parsed_lease;
        }
      } else if (strncmp(tok, "as=", 3) == 0) {
        snprintf(out_info->role, sizeof(out_info->role), "%s", tok + 3);
      }
      tok = strtok_r(NULL, ",", &saveptr);
    }
  }

  char work[VSS_WARDEN_MAX_PATH_LEN];
  if (path_part_len == 0 || path_part_len >= sizeof(work)) return false;
  memcpy(work, raw_path, path_part_len);
  work[path_part_len] = '\0';

  const char *p = work;
  if (strncmp(p, "/dev/signal/", 12) == 0) {
    p += 12;
  }
  while (*p == '/') p++;

  char cleaned[VSS_WARDEN_MAX_PATH_LEN];
  snprintf(cleaned, sizeof(cleaned), "%s", p);
  size_t clen = strlen(cleaned);
  while (clen > 0 && cleaned[clen - 1] == '/') {
    cleaned[--clen] = '\0';
  }
  if (clen == 0) return false;

  // Check if path uses slash notation or dot notation
  bool has_slash = (strchr(cleaned, '/') != NULL);
  if (!has_slash) {
    for (size_t i = 0; i < clen; i++) {
      if (cleaned[i] == '.') cleaned[i] = '/';
    }
  } else {
    char *last_slash = strrchr(cleaned, '/');
    char *leaf = last_slash ? (last_slash + 1) : cleaned;
    if (leaf[0] == '.') {
      size_t leaf_len = strlen(leaf);
      if (leaf_len > 9 && strcmp(leaf + leaf_len - 8, ".control") == 0) {
        out_info->target_kind = WARDEN_TARGET_CONTROL;
        size_t name_len = leaf_len - 1 - 8;
        memmove(leaf, leaf + 1, name_len);
        leaf[name_len] = '\0';
      }
    }
  }

  // Validate no empty segments
  size_t final_len = strlen(cleaned);
  if (final_len == 0 || cleaned[0] == '/' || cleaned[final_len - 1] == '/') return false;
  for (size_t i = 0; i + 1 < final_len; i++) {
    if (cleaned[i] == '/' && cleaned[i + 1] == '/') return false;
  }

  snprintf(out_info->canonical_path, sizeof(out_info->canonical_path), "%s", cleaned);
  out_info->ok = true;
  return true;
}

typedef struct {
  vss_warden_datatype_t kind;
  double num_val;
  char str_val[VSS_WARDEN_MAX_STR_LEN];
  uint32_t u32_arr[VSS_WARDEN_MAX_ARRAY_ELEMS];
  size_t arr_len;
} warden_val_t;

typedef struct {
  int32_t fd;
  char role[64];
  int32_t pid;
  int32_t priority;
  int64_t lease_expires_ms;
} warden_holder_t;

typedef struct {
  bool valid;
  char errno_code[16];
  char rule_id[32];
  char reason[160];
} warden_rejection_t;

typedef struct {
  char path[VSS_WARDEN_MAX_PATH_LEN];
  char datatype_str[32];
  vss_warden_datatype_t datatype;
  bool has_min;
  double min_val;
  bool has_max;
  double max_val;
  bool has_arraysize;
  size_t arraysize;
  size_t allowed_count;
  char allowed_strs[VSS_WARDEN_MAX_ALLOWED][VSS_WARDEN_MAX_STR_LEN];
  double allowed_nums[VSS_WARDEN_MAX_ALLOWED];
  warden_val_t default_val;
  warden_val_t committed_val;
  bool has_active_holder;
  warden_holder_t active_holder;
  warden_rejection_t last_rejection;
} warden_signal_t;

typedef struct {
  bool allocated;
  bool is_open;
  int32_t fd;
  size_t signal_idx;
  int32_t pid;
  int32_t priority;
  int64_t lease_ms;
  char role[64];
  bool has_standby;
  warden_val_t standby_val;
  int64_t standby_expires_ms;
  uint64_t standby_seq;
} warden_ocb_t;

typedef struct {
  vss_warden_mode_t mode;
  warden_signal_t signals[VSS_WARDEN_MAX_SIGNALS];
  size_t signal_count;
  warden_ocb_t ocbs[VSS_WARDEN_MAX_OCBS];
  size_t ocb_count;
  int64_t current_clock_ms;
  size_t last_touched_signal_idx;
  uint64_t seq_counter;
} warden_engine_t;

static bool parse_datatype_str(const char *dt, vss_warden_datatype_t *out_dt) {
  if (!dt || !out_dt) return false;
  if (strcmp(dt, "int8") == 0) *out_dt = WARDEN_DT_INT8;
  else if (strcmp(dt, "int16") == 0) *out_dt = WARDEN_DT_INT16;
  else if (strcmp(dt, "int32") == 0) *out_dt = WARDEN_DT_INT32;
  else if (strcmp(dt, "int64") == 0) *out_dt = WARDEN_DT_INT64;
  else if (strcmp(dt, "uint8") == 0) *out_dt = WARDEN_DT_UINT8;
  else if (strcmp(dt, "uint16") == 0) *out_dt = WARDEN_DT_UINT16;
  else if (strcmp(dt, "uint32") == 0) *out_dt = WARDEN_DT_UINT32;
  else if (strcmp(dt, "uint64") == 0) *out_dt = WARDEN_DT_UINT64;
  else if (strcmp(dt, "float") == 0) *out_dt = WARDEN_DT_FLOAT;
  else if (strcmp(dt, "double") == 0) *out_dt = WARDEN_DT_DOUBLE;
  else if (strcmp(dt, "string") == 0) *out_dt = WARDEN_DT_STRING;
  else if (strcmp(dt, "uint32[]") == 0) *out_dt = WARDEN_DT_UINT32_ARRAY;
  else return false;
  return true;
}

static void get_datatype_native_bounds(vss_warden_datatype_t dt, double *min_out, double *max_out, bool *is_int) {
  *is_int = true;
  switch (dt) {
    case WARDEN_DT_INT8: *min_out = -128.0; *max_out = 127.0; break;
    case WARDEN_DT_INT16: *min_out = -32768.0; *max_out = 32767.0; break;
    case WARDEN_DT_INT32: *min_out = -2147483648.0; *max_out = 2147483647.0; break;
    case WARDEN_DT_INT64: *min_out = -9007199254740991.0; *max_out = 9007199254740991.0; break;
    case WARDEN_DT_UINT8: *min_out = 0.0; *max_out = 255.0; break;
    case WARDEN_DT_UINT16: *min_out = 0.0; *max_out = 65535.0; break;
    case WARDEN_DT_UINT32:
    case WARDEN_DT_UINT32_ARRAY: *min_out = 0.0; *max_out = 4294967295.0; break;
    case WARDEN_DT_UINT64: *min_out = 0.0; *max_out = 9007199254740991.0; break;
    case WARDEN_DT_FLOAT:
    case WARDEN_DT_DOUBLE:
      *is_int = false;
      *min_out = -3.402823466e38;
      *max_out = 3.402823466e38;
      break;
    default:
      *is_int = false;
      *min_out = 0.0;
      *max_out = 0.0;
      break;
  }
}

static void format_committed_hex(const warden_val_t *v, char *buf, size_t cap) {
  if (!v) {
    snprintf(buf, cap, "0x00");
    return;
  }
  switch (v->kind) {
    case WARDEN_DT_INT8:
    case WARDEN_DT_UINT8: {
      uint8_t b = (uint8_t)((int32_t)v->num_val & 0xff);
      snprintf(buf, cap, "0x%02x", (unsigned int)b);
      break;
    }
    case WARDEN_DT_INT16:
    case WARDEN_DT_UINT16: {
      uint16_t w = (uint16_t)((int32_t)v->num_val & 0xffff);
      snprintf(buf, cap, "0x%04x", (unsigned int)w);
      break;
    }
    case WARDEN_DT_INT32:
    case WARDEN_DT_UINT32: {
      uint32_t dw = (uint32_t)((int64_t)v->num_val & 0xffffffffLL);
      snprintf(buf, cap, "0x%08x", dw);
      break;
    }
    case WARDEN_DT_INT64:
    case WARDEN_DT_UINT64: {
      uint64_t qw = (uint64_t)((int64_t)v->num_val);
      snprintf(buf, cap, "0x%016llx", (unsigned long long)qw);
      break;
    }
    case WARDEN_DT_FLOAT: {
      float f = (float)v->num_val;
      uint32_t bits = 0;
      memcpy(&bits, &f, sizeof(uint32_t));
      snprintf(buf, cap, "0x%08x", bits);
      break;
    }
    case WARDEN_DT_DOUBLE: {
      double d = v->num_val;
      uint64_t bits = 0;
      memcpy(&bits, &d, sizeof(uint64_t));
      snprintf(buf, cap, "0x%016llx", (unsigned long long)bits);
      break;
    }
    case WARDEN_DT_STRING: {
      size_t slen = strlen(v->str_val);
      if (slen == 0) {
        snprintf(buf, cap, "0x00");
        break;
      }
      size_t pos = (size_t)snprintf(buf, cap, "0x");
      for (size_t i = 0; i < slen && pos + 3 < cap; i++) {
        pos += (size_t)snprintf(buf + pos, cap - pos, "%02x", (unsigned char)v->str_val[i]);
      }
      break;
    }
    case WARDEN_DT_UINT32_ARRAY: {
      if (v->arr_len == 0) {
        snprintf(buf, cap, "0x00");
        break;
      }
      size_t pos = (size_t)snprintf(buf, cap, "0x");
      for (size_t i = 0; i < v->arr_len && pos + 9 < cap; i++) {
        pos += (size_t)snprintf(buf + pos, cap - pos, "%08x", v->u32_arr[i]);
      }
      break;
    }
  }
}

static bool extract_leaf_signal(warden_engine_t *eng, const char *raw_key_path, const json_val_t *node) {
  if (eng->signal_count >= VSS_WARDEN_MAX_SIGNALS) return false;
  json_val_t *dt_val = j_obj_get(node, "datatype");
  if (!dt_val || dt_val->type != J_STRING) return false;

  vss_warden_path_info_t pinfo;
  if (!vss_warden_canonicalize_path(raw_key_path, &pinfo)) return false;

  vss_warden_datatype_t dt;
  if (!parse_datatype_str(dt_val->sval, &dt)) return false;

  warden_signal_t *sig = &eng->signals[eng->signal_count++];
  memset(sig, 0, sizeof(*sig));
  snprintf(sig->path, sizeof(sig->path), "%s", pinfo.canonical_path);
  snprintf(sig->datatype_str, sizeof(sig->datatype_str), "%s", dt_val->sval);
  sig->datatype = dt;

  json_val_t *min_v = j_obj_get(node, "min");
  if (min_v && min_v->type == J_NUMBER) {
    sig->has_min = true;
    sig->min_val = min_v->nval;
  }
  json_val_t *max_v = j_obj_get(node, "max");
  if (max_v && max_v->type == J_NUMBER) {
    sig->has_max = true;
    sig->max_val = max_v->nval;
  }
  json_val_t *arr_v = j_obj_get(node, "arraysize");
  if (arr_v && arr_v->type == J_NUMBER && arr_v->nval > 0) {
    sig->has_arraysize = true;
    sig->arraysize = (size_t)arr_v->nval;
  }
  json_val_t *allowed_v = j_obj_get(node, "allowed");
  if (allowed_v && allowed_v->type == J_ARRAY) {
    for (size_t i = 0; i < allowed_v->arr.count && sig->allowed_count < VSS_WARDEN_MAX_ALLOWED; i++) {
      json_val_t *el = allowed_v->arr.items[i];
      if (el && el->type == J_STRING) {
        snprintf(sig->allowed_strs[sig->allowed_count], VSS_WARDEN_MAX_STR_LEN, "%s", el->sval);
        sig->allowed_count++;
      } else if (el && el->type == J_NUMBER) {
        sig->allowed_nums[sig->allowed_count] = el->nval;
        sig->allowed_count++;
      }
    }
  }
  sig->default_val.kind = dt;
  json_val_t *def_v = j_obj_get(node, "default");
  if (dt == WARDEN_DT_STRING) {
    if (def_v && def_v->type == J_STRING) {
      snprintf(sig->default_val.str_val, sizeof(sig->default_val.str_val), "%s", def_v->sval);
    } else {
      sig->default_val.str_val[0] = '\0';
    }
  } else if (dt == WARDEN_DT_UINT32_ARRAY) {
    if (def_v && def_v->type == J_ARRAY) {
      for (size_t i = 0; i < def_v->arr.count && sig->default_val.arr_len < VSS_WARDEN_MAX_ARRAY_ELEMS; i++) {
        json_val_t *el = def_v->arr.items[i];
        if (el && el->type == J_NUMBER && el->nval >= 0) {
          sig->default_val.u32_arr[sig->default_val.arr_len++] = (uint32_t)el->nval;
        }
      }
    }
  } else if (dt == WARDEN_DT_FLOAT || dt == WARDEN_DT_DOUBLE) {
    // Reproduces upstream qpp/value.c:438,445 bug in unguarded mode (json_l = 0 instead of json_d)
    if (eng->mode == WARDEN_MODE_UNGUARDED) {
      sig->default_val.num_val = 0.0;
    } else {
      double raw_d = (def_v && def_v->type == J_NUMBER) ? def_v->nval : 0.0;
      sig->default_val.num_val = (dt == WARDEN_DT_FLOAT) ? (double)((float)raw_d) : raw_d;
    }
  } else {
    sig->default_val.num_val = (def_v && def_v->type == J_NUMBER) ? def_v->nval : 0.0;
  }

  sig->committed_val = sig->default_val;
  return true;
}

static void walk_catalog_tree(warden_engine_t *eng, const char *prefix, const json_val_t *obj) {
  if (!obj || obj->type != J_OBJECT) return;
  for (size_t i = 0; i < obj->obj.count; i++) {
    const char *key = obj->obj.keys[i];
    const json_val_t *val = obj->obj.vals[i];
    if (!val || val->type != J_OBJECT) continue;

    char full_path[VSS_WARDEN_MAX_PATH_LEN];
    if (prefix && prefix[0] != '\0') {
      snprintf(full_path, sizeof(full_path), "%s/%s", prefix, key);
    } else {
      snprintf(full_path, sizeof(full_path), "%s", key);
    }

    json_val_t *type_v = j_obj_get(val, "type");
    json_val_t *children_v = j_obj_get(val, "children");
    if (type_v && type_v->type == J_STRING && strcmp(type_v->sval, "branch") == 0 && children_v &&
        children_v->type == J_OBJECT) {
      walk_catalog_tree(eng, full_path, children_v);
    } else if (j_obj_get(val, "datatype") != NULL) {
      extract_leaf_signal(eng, full_path, val);
    } else if (children_v && children_v->type == J_OBJECT) {
      walk_catalog_tree(eng, full_path, children_v);
    }
  }
}

static int find_signal_idx(const warden_engine_t *eng, const char *canonical_path) {
  for (size_t i = 0; i < eng->signal_count; i++) {
    if (strcmp(eng->signals[i].path, canonical_path) == 0) {
      return (int)i;
    }
  }
  return -1;
}

static warden_ocb_t *find_ocb(warden_engine_t *eng, int32_t fd) {
  for (size_t i = 0; i < eng->ocb_count; i++) {
    if (eng->ocbs[i].allocated && eng->ocbs[i].fd == fd) {
      return &eng->ocbs[i];
    }
  }
  return NULL;
}

static warden_ocb_t *find_best_standby_ocb(warden_engine_t *eng, size_t sig_idx) {
  warden_ocb_t *best = NULL;
  for (size_t i = 0; i < eng->ocb_count; i++) {
    warden_ocb_t *ocb = &eng->ocbs[i];
    if (!ocb->allocated || !ocb->is_open || ocb->signal_idx != sig_idx || !ocb->has_standby) {
      continue;
    }
    if (ocb->standby_expires_ms <= eng->current_clock_ms) {
      ocb->has_standby = false;
      continue;
    }
    if (!best || ocb->priority > best->priority ||
        (ocb->priority == best->priority && ocb->standby_seq > best->standby_seq)) {
      best = ocb;
    }
  }
  return best;
}

static void release_and_recover_signal(warden_engine_t *eng, size_t sig_idx) {
  warden_signal_t *sig = &eng->signals[sig_idx];
  warden_ocb_t *best = find_best_standby_ocb(eng, sig_idx);
  if (best != NULL) {
    sig->has_active_holder = true;
    sig->active_holder.fd = best->fd;
    snprintf(sig->active_holder.role, sizeof(sig->active_holder.role), "%s", best->role);
    sig->active_holder.pid = best->pid;
    sig->active_holder.priority = best->priority;
    sig->active_holder.lease_expires_ms = best->standby_expires_ms;
    sig->committed_val = best->standby_val;
    best->has_standby = false;
  } else {
    sig->has_active_holder = false;
    memset(&sig->active_holder, 0, sizeof(sig->active_holder));
    sig->committed_val = sig->default_val;
  }
}

static void expire_leases_up_to(warden_engine_t *eng, int *out_expired_sig_idx) {
  if (eng->mode != WARDEN_MODE_GUARDED) return;
  for (size_t i = 0; i < eng->ocb_count; i++) {
    warden_ocb_t *ocb = &eng->ocbs[i];
    if (ocb->allocated && ocb->has_standby && eng->current_clock_ms >= ocb->standby_expires_ms) {
      ocb->has_standby = false;
    }
  }
  for (size_t s = 0; s < eng->signal_count; s++) {
    warden_signal_t *sig = &eng->signals[s];
    if (sig->has_active_holder && eng->current_clock_ms >= sig->active_holder.lease_expires_ms) {
      if (out_expired_sig_idx && *out_expired_sig_idx < 0) {
        *out_expired_sig_idx = (int)s;
      }
      release_and_recover_signal(eng, s);
    }
  }
}

static void set_rejection(warden_signal_t *sig, const char *errno_code, const char *rule_id,
                          const char *reason) {
  sig->last_rejection.valid = true;
  snprintf(sig->last_rejection.errno_code, sizeof(sig->last_rejection.errno_code), "%s", errno_code);
  snprintf(sig->last_rejection.rule_id, sizeof(sig->last_rejection.rule_id), "%s", rule_id);
  snprintf(sig->last_rejection.reason, sizeof(sig->last_rejection.reason), "%s", reason);
}

typedef struct {
  char *buf;
  size_t len;
  size_t cap;
} sbuf_t;

static void sb_printf(sbuf_t *sb, const char *fmt, ...) __attribute__((format(printf, 2, 3)));
static void sb_printf(sbuf_t *sb, const char *fmt, ...) {
  if (!sb || !sb->buf || sb->len >= sb->cap) return;
  va_list ap;
  va_start(ap, fmt);
  int n = vsnprintf(sb->buf + sb->len, sb->cap - sb->len, fmt, ap);
  va_end(ap);
  if (n > 0) {
    size_t added = (size_t)n;
    if (sb->len + added < sb->cap) {
      sb->len += added;
    } else {
      sb->len = sb->cap - 1;
    }
  }
}

static void sb_json_str(sbuf_t *sb, const char *s) {
  sb_printf(sb, "\"");
  if (s) {
    for (size_t i = 0; s[i] != '\0'; i++) {
      char c = s[i];
      if (c == '"' || c == '\\') {
        sb_printf(sb, "\\%c", c);
      } else if (c == '\n') {
        sb_printf(sb, "\\n");
      } else if (c == '\r') {
        sb_printf(sb, "\\r");
      } else if (c == '\t') {
        sb_printf(sb, "\\t");
      } else if (c == '\b') {
        sb_printf(sb, "\\b");
      } else if (c == '\f') {
        sb_printf(sb, "\\f");
      } else if ((unsigned char)c < 0x20) {
        sb_printf(sb, "\\u%04x", (unsigned int)(unsigned char)c);
      } else {
        sb_printf(sb, "%c", c);
      }
    }
  }
  sb_printf(sb, "\"");
}

static void sb_warden_val(sbuf_t *sb, const warden_val_t *v) {
  if (!v) {
    sb_printf(sb, "null");
    return;
  }
  switch (v->kind) {
    case WARDEN_DT_STRING:
      sb_json_str(sb, v->str_val);
      break;
    case WARDEN_DT_UINT32_ARRAY:
      sb_printf(sb, "[");
      for (size_t i = 0; i < v->arr_len; i++) {
        if (i > 0) sb_printf(sb, ",");
        sb_printf(sb, "%u", v->u32_arr[i]);
      }
      sb_printf(sb, "]");
      break;
    case WARDEN_DT_FLOAT: {
      float f = (float)v->num_val;
      if (fabsf(f) == 0.0f) f = 0.0f;
      sb_printf(sb, "%.6g", (double)f);
      break;
    }
    case WARDEN_DT_DOUBLE: {
      double d = v->num_val;
      if (fabs(d) == 0.0) d = 0.0;
      sb_printf(sb, "%.12g", d);
      break;
    }
    default:
      sb_printf(sb, "%lld", (long long)llround(v->num_val));
      break;
  }
}

static void sb_holder(sbuf_t *sb, bool has_holder, const warden_holder_t *h) {
  if (!has_holder || !h) {
    sb_printf(sb, "null");
    return;
  }
  sb_printf(sb, "{\"fd\":%d,\"role\":", h->fd);
  sb_json_str(sb, h->role);
  sb_printf(sb, ",\"pid\":%d,\"priority\":%d,\"leaseExpiresMs\":%lld}", h->pid, h->priority,
            (long long)h->lease_expires_ms);
}

static void sb_rejection(sbuf_t *sb, const warden_rejection_t *r) {
  if (!r || !r->valid) {
    sb_printf(sb, "null");
    return;
  }
  sb_printf(sb, "{\"errnoCode\":");
  sb_json_str(sb, r->errno_code);
  sb_printf(sb, ",\"ruleId\":");
  sb_json_str(sb, r->rule_id);
  sb_printf(sb, ",\"reason\":");
  sb_json_str(sb, r->reason);
  sb_printf(sb, "}");
}

static void emit_step_receipt(sbuf_t *sb, warden_engine_t *eng, size_t step_idx, const char *op_kind,
                              const char *status, int sig_idx, bool include_warden_payload) {
  sb_printf(sb, "{\"stepIndex\":%zu,\"opKind\":", step_idx);
  sb_json_str(sb, op_kind);
  sb_printf(sb, ",\"status\":");
  sb_json_str(sb, status);

  if (sig_idx < 0 || (size_t)sig_idx >= eng->signal_count) {
    sb_printf(sb, ",\"committedControlValue\":null,\"committedHex\":\"0x00\",\"activeHolder\":null,\"lastRejection\":null}");
    return;
  }

  const warden_signal_t *sig = &eng->signals[sig_idx];
  char hex_buf[160];
  format_committed_hex(&sig->committed_val, hex_buf, sizeof(hex_buf));

  sb_printf(sb, ",\"signalPath\":");
  sb_json_str(sb, sig->path);
  sb_printf(sb, ",\"committedControlValue\":");
  sb_warden_val(sb, &sig->committed_val);
  sb_printf(sb, ",\"committedHex\":");
  sb_json_str(sb, hex_buf);
  sb_printf(sb, ",\"activeHolder\":");
  sb_holder(sb, sig->has_active_holder, &sig->active_holder);
  sb_printf(sb, ",\"lastRejection\":");
  sb_rejection(sb, &sig->last_rejection);

  if (include_warden_payload) {
    sb_printf(sb, ",\"wardenPayload\":{\"path\":");
    sb_json_str(sb, sig->path);
    sb_printf(sb, ",\"datatype\":");
    sb_json_str(sb, sig->datatype_str);
    sb_printf(sb, ",\"committedControlValue\":");
    sb_warden_val(sb, &sig->committed_val);
    sb_printf(sb, ",\"activeHolder\":");
    sb_holder(sb, sig->has_active_holder, &sig->active_holder);
    sb_printf(sb, ",\"lastRejection\":");
    sb_rejection(sb, &sig->last_rejection);
    sb_printf(sb, "}");
  }

  sb_printf(sb, "}");
}

int vss_warden_execute_batch_json(const char *input_json, char *output_buf, size_t output_cap) {
  if (!output_buf || output_cap == 0) return -1;
  sbuf_t sb = {output_buf, 0, output_cap};

  if (!input_json) {
    sb_printf(&sb, "{\"ok\":false,\"status\":\"EINVAL\",\"mode\":\"guarded\",\"errorMessage\":\"Empty input\",\"steps\":[]}\n");
    return 0;
  }

  json_val_t *req = j_parse_root(input_json);
  if (!req || req->type != J_OBJECT) {
    j_free(req);
    sb_printf(&sb, "{\"ok\":false,\"status\":\"EINVAL\",\"mode\":\"guarded\",\"errorMessage\":\"Invalid request JSON\",\"steps\":[]}\n");
    return 0;
  }

  json_val_t *mode_v = j_obj_get(req, "mode");
  const char *mode_str = (mode_v && mode_v->type == J_STRING) ? mode_v->sval : "guarded";
  vss_warden_mode_t mode =
      (strcmp(mode_str, "unguarded") == 0) ? WARDEN_MODE_UNGUARDED : WARDEN_MODE_GUARDED;

  json_val_t *cat_v = j_obj_get(req, "catalogJsonc");
  json_val_t *cat_root = NULL;

  if (cat_v && cat_v->type == J_STRING) {
    size_t clen = strlen(cat_v->sval);
    char *stripped = (char *)malloc(clen + 8);
    if (!stripped) {
      j_free(req);
      sb_printf(&sb, "{\"ok\":false,\"status\":\"EINVAL\",\"mode\":");
      sb_json_str(&sb, mode_str);
      sb_printf(&sb, ",\"errorMessage\":\"Out of memory\",\"steps\":[]}\n");
      return 0;
    }
    if (vss_warden_strip_jsonc_comments(cat_v->sval, stripped, clen + 8) != 0) {
      free(stripped);
      j_free(req);
      sb_printf(&sb, "{\"ok\":false,\"status\":\"EINVAL\",\"mode\":");
      sb_json_str(&sb, mode_str);
      sb_printf(&sb, ",\"errorMessage\":\"Unterminated block comment in catalog\",\"steps\":[]}\n");
      return 0;
    }
    cat_root = j_parse_root(stripped);
    free(stripped);
  }

  if (!cat_root || cat_root->type != J_OBJECT) {
    if (cat_root) j_free(cat_root);
    j_free(req);
    sb_printf(&sb, "{\"ok\":false,\"status\":\"EINVAL\",\"mode\":");
    sb_json_str(&sb, mode_str);
    sb_printf(&sb, ",\"errorMessage\":\"Empty or malformed JSONC catalog\",\"steps\":[]}\n");
    return 0;
  }

  warden_engine_t *eng = (warden_engine_t *)calloc(1, sizeof(warden_engine_t));
  if (!eng) {
    j_free(cat_root);
    j_free(req);
    return -1;
  }
  eng->mode = mode;

  walk_catalog_tree(eng, "", cat_root);
  j_free(cat_root);

  if (eng->signal_count == 0) {
    free(eng);
    j_free(req);
    sb_printf(&sb, "{\"ok\":false,\"status\":\"EINVAL\",\"mode\":");
    sb_json_str(&sb, mode_str);
    sb_printf(&sb, ",\"errorMessage\":\"Catalog contains zero valid VSS signals\",\"steps\":[]}\n");
    return 0;
  }

  json_val_t *ops_v = j_obj_get(req, "operations");
  if (!ops_v || ops_v->type != J_ARRAY) {
    free(eng);
    j_free(req);
    sb_printf(&sb, "{\"ok\":false,\"status\":\"EINVAL\",\"mode\":");
    sb_json_str(&sb, mode_str);
    sb_printf(&sb, ",\"errorMessage\":\"Missing operations array\",\"steps\":[]}\n");
    return 0;
  }

  sb_printf(&sb, "{\"ok\":true,\"status\":\"EOK\",\"mode\":");
  sb_json_str(&sb, mode_str);
  sb_printf(&sb, ",\"errorMessage\":null,\"steps\":[");

  for (size_t i = 0; i < ops_v->arr.count; i++) {
    if (i > 0) sb_printf(&sb, ",");
    json_val_t *op = ops_v->arr.items[i];
    json_val_t *kind_v = j_obj_get(op, "kind");
    const char *kind = (kind_v && kind_v->type == J_STRING) ? kind_v->sval : "OPEN";

    if (strcmp(kind, "OPEN") == 0) {
      json_val_t *fd_v = j_obj_get(op, "fd");
      json_val_t *path_v = j_obj_get(op, "path");
      json_val_t *pid_v = j_obj_get(op, "pid");
      json_val_t *prio_v = j_obj_get(op, "priority");
      json_val_t *lease_v = j_obj_get(op, "leaseMs");
      json_val_t *role_v = j_obj_get(op, "role");

      int32_t fd = (fd_v && fd_v->type == J_NUMBER) ? (int32_t)fd_v->nval : -1;
      const char *raw_path = (path_v && path_v->type == J_STRING) ? path_v->sval : "";

      vss_warden_path_info_t pinfo;
      if (!vss_warden_canonicalize_path(raw_path, &pinfo) || fd < 0) {
        emit_step_receipt(&sb, eng, i, "OPEN", "EINVAL", -1, false);
        continue;
      }

      int sig_idx = find_signal_idx(eng, pinfo.canonical_path);
      if (sig_idx < 0) {
        emit_step_receipt(&sb, eng, i, "OPEN", "ENOENT", -1, false);
        continue;
      }

      warden_ocb_t *ocb = find_ocb(eng, fd);
      if (!ocb) {
        if (eng->ocb_count >= VSS_WARDEN_MAX_OCBS) {
          emit_step_receipt(&sb, eng, i, "OPEN", "EINVAL", sig_idx, false);
          continue;
        }
        ocb = &eng->ocbs[eng->ocb_count++];
      } else if (ocb->is_open && eng->mode == WARDEN_MODE_GUARDED) {
        warden_signal_t *prev_sig = &eng->signals[ocb->signal_idx];
        if (prev_sig->has_active_holder && prev_sig->active_holder.fd == fd) {
          release_and_recover_signal(eng, (int)ocb->signal_idx);
        }
      }
      memset(ocb, 0, sizeof(*ocb));
      ocb->allocated = true;
      ocb->is_open = true;
      ocb->fd = fd;
      ocb->signal_idx = (size_t)sig_idx;
      ocb->pid = (pid_v && pid_v->type == J_NUMBER) ? (int32_t)pid_v->nval : 1000;
      ocb->priority = pinfo.has_priority
                          ? pinfo.priority
                          : ((prio_v && prio_v->type == J_NUMBER) ? (int32_t)prio_v->nval : 10);
      ocb->lease_ms = pinfo.has_lease_ms
                          ? pinfo.lease_ms
                          : ((lease_v && lease_v->type == J_NUMBER) ? (int64_t)lease_v->nval : 500);
      if (pinfo.role[0] != '\0') {
        snprintf(ocb->role, sizeof(ocb->role), "%s", pinfo.role);
      } else if (role_v && role_v->type == J_STRING) {
        snprintf(ocb->role, sizeof(ocb->role), "%s", role_v->sval);
      } else {
        snprintf(ocb->role, sizeof(ocb->role), "client");
      }

      eng->last_touched_signal_idx = (size_t)sig_idx;
      emit_step_receipt(&sb, eng, i, "OPEN", "EOK", sig_idx, false);
    } else if (strcmp(kind, "WRITE") == 0) {
      json_val_t *fd_v = j_obj_get(op, "fd");
      json_val_t *val_v = j_obj_get(op, "value");
      json_val_t *now_v = j_obj_get(op, "nowMs");

      if (now_v && now_v->type == J_NUMBER && (int64_t)now_v->nval > eng->current_clock_ms) {
        eng->current_clock_ms = (int64_t)now_v->nval;
      }
      expire_leases_up_to(eng, NULL);

      int32_t fd = (fd_v && fd_v->type == J_NUMBER) ? (int32_t)fd_v->nval : -1;
      warden_ocb_t *ocb = find_ocb(eng, fd);
      if (!ocb || !ocb->is_open) {
        int assoc_sig = ocb ? (int)ocb->signal_idx : -1;
        emit_step_receipt(&sb, eng, i, "WRITE", "EBADF", assoc_sig, false);
        continue;
      }

      int sig_idx = (int)ocb->signal_idx;
      eng->last_touched_signal_idx = (size_t)sig_idx;
      warden_signal_t *sig = &eng->signals[sig_idx];

      if (eng->mode == WARDEN_MODE_UNGUARDED) {
        // Raw QPP mode: no VSS min/max/allowed/arraysize checks, no priority arbitration,
        // and reproduces qpp/value.c:73 VECTOR_UINT32 UINT16_MAX (65535) cap bug.
        if (sig->datatype == WARDEN_DT_UINT32_ARRAY) {
          if (!val_v || val_v->type != J_ARRAY || val_v->arr.count == 0) {
            emit_step_receipt(&sb, eng, i, "WRITE", "EINVAL", sig_idx, false);
            continue;
          }
          bool range_err = false;
          warden_val_t nval;
          memset(&nval, 0, sizeof(nval));
          nval.kind = WARDEN_DT_UINT32_ARRAY;
          for (size_t k = 0; k < val_v->arr.count && k < VSS_WARDEN_MAX_ARRAY_ELEMS; k++) {
            json_val_t *el = val_v->arr.items[k];
            if (!el || el->type != J_NUMBER || el->nval < 0.0 || el->nval > 65535.0) {
              range_err = true;
              break;
            }
            nval.u32_arr[nval.arr_len++] = (uint32_t)el->nval;
          }
          if (range_err) {
            emit_step_receipt(&sb, eng, i, "WRITE", "ERANGE", sig_idx, false);
            continue;
          }
          sig->committed_val = nval;
          emit_step_receipt(&sb, eng, i, "WRITE", "EOK", sig_idx, false);
          continue;
        } else if (sig->datatype == WARDEN_DT_STRING) {
          if (!val_v || val_v->type != J_STRING) {
            emit_step_receipt(&sb, eng, i, "WRITE", "EINVAL", sig_idx, false);
            continue;
          }
          snprintf(sig->committed_val.str_val, sizeof(sig->committed_val.str_val), "%s", val_v->sval);
          emit_step_receipt(&sb, eng, i, "WRITE", "EOK", sig_idx, false);
          continue;
        } else {
          if (!val_v || val_v->type != J_NUMBER || !isfinite(val_v->nval)) {
            emit_step_receipt(&sb, eng, i, "WRITE", "EINVAL", sig_idx, false);
            continue;
          }
          double nat_min = 0.0, nat_max = 0.0;
          bool is_int = false;
          get_datatype_native_bounds(sig->datatype, &nat_min, &nat_max, &is_int);
          if (val_v->nval < nat_min || val_v->nval > nat_max) {
            emit_step_receipt(&sb, eng, i, "WRITE", "ERANGE", sig_idx, false);
            continue;
          }
          sig->committed_val.num_val =
              (sig->datatype == WARDEN_DT_FLOAT) ? (double)((float)val_v->nval) : val_v->nval;
          emit_step_receipt(&sb, eng, i, "WRITE", "EOK", sig_idx, false);
          continue;
        }
      }

      // Guarded VssWarden mode:
      // 1. VSS Bounds, Allowed Enum & Array-Size validation (P1)
      warden_val_t parsed_val;
      memset(&parsed_val, 0, sizeof(parsed_val));
      parsed_val.kind = sig->datatype;

      if (sig->datatype == WARDEN_DT_UINT32_ARRAY) {
        if (!val_v || val_v->type != J_ARRAY || val_v->arr.count == 0 ||
            val_v->arr.count > VSS_WARDEN_MAX_ARRAY_ELEMS ||
            (sig->has_arraysize && val_v->arr.count > sig->arraysize)) {
          set_rejection(sig, "EINVAL", "VSS_ARRAY_SIZE",
                        "Vector length violates VSS arraysize constraint");
          emit_step_receipt(&sb, eng, i, "WRITE", "EINVAL", sig_idx, false);
          continue;
        }
        double eff_min = sig->has_min ? sig->min_val : 0.0;
        double eff_max = sig->has_max ? sig->max_val : 4294967295.0;
        if (eff_min < 0.0) eff_min = 0.0;
        if (eff_max > 4294967295.0) eff_max = 4294967295.0;

        bool elem_err = false;
        const char *err_code = "ERANGE";
        for (size_t k = 0; k < val_v->arr.count; k++) {
          json_val_t *el = val_v->arr.items[k];
          if (!el || el->type != J_NUMBER || !isfinite(el->nval) || floor(el->nval) != el->nval) {
            elem_err = true;
            err_code = "EINVAL";
            break;
          }
          if (el->nval < eff_min || el->nval > eff_max) {
            elem_err = true;
            err_code = "ERANGE";
            break;
          }
          parsed_val.u32_arr[parsed_val.arr_len++] = (uint32_t)el->nval;
        }
        if (elem_err) {
          set_rejection(sig, err_code, "VSS_MIN_MAX",
                        "Vector element out of VSS [min, max] or uint32 bounds");
          emit_step_receipt(&sb, eng, i, "WRITE", err_code, sig_idx, false);
          continue;
        }
      } else if (sig->datatype == WARDEN_DT_STRING) {
        if (!val_v || val_v->type != J_STRING) {
          set_rejection(sig, "EINVAL", "VSS_ALLOWED_ENUM",
                        "Expected string value for string signal");
          emit_step_receipt(&sb, eng, i, "WRITE", "EINVAL", sig_idx, false);
          continue;
        }
        if (sig->allowed_count > 0) {
          bool matched = false;
          for (size_t a = 0; a < sig->allowed_count; a++) {
            if (strcmp(sig->allowed_strs[a], val_v->sval) == 0) {
              matched = true;
              break;
            }
          }
          if (!matched) {
            set_rejection(sig, "EINVAL", "VSS_ALLOWED_ENUM",
                          "Value is not in VSS allowed enum list");
            emit_step_receipt(&sb, eng, i, "WRITE", "EINVAL", sig_idx, false);
            continue;
          }
        }
        snprintf(parsed_val.str_val, sizeof(parsed_val.str_val), "%s", val_v->sval);
      } else {
        if (!val_v || val_v->type != J_NUMBER || !isfinite(val_v->nval)) {
          set_rejection(sig, "EINVAL", "VSS_MIN_MAX",
                        "Expected finite numeric value");
          emit_step_receipt(&sb, eng, i, "WRITE", "EINVAL", sig_idx, false);
          continue;
        }
        double nat_min = 0.0, nat_max = 0.0;
        bool is_int = false;
        get_datatype_native_bounds(sig->datatype, &nat_min, &nat_max, &is_int);
        if (is_int && floor(val_v->nval) != val_v->nval) {
          set_rejection(sig, "EINVAL", "VSS_MIN_MAX",
                        "Non-integer value for integer VSS signal");
          emit_step_receipt(&sb, eng, i, "WRITE", "EINVAL", sig_idx, false);
          continue;
        }
        double eff_min = sig->has_min ? fmax(nat_min, sig->min_val) : nat_min;
        double eff_max = sig->has_max ? fmin(nat_max, sig->max_val) : nat_max;
        if (val_v->nval < eff_min || val_v->nval > eff_max) {
          set_rejection(sig, "ERANGE", "VSS_MIN_MAX",
                        "Value violates compiled VSS [min, max] bounds");
          emit_step_receipt(&sb, eng, i, "WRITE", "ERANGE", sig_idx, false);
          continue;
        }
        if (sig->allowed_count > 0) {
          bool matched = false;
          for (size_t a = 0; a < sig->allowed_count; a++) {
            if (fabs(sig->allowed_nums[a] - val_v->nval) < 1e-6) {
              matched = true;
              break;
            }
          }
          if (!matched) {
            set_rejection(sig, "EINVAL", "VSS_ALLOWED_ENUM",
                          "Numeric value is not in VSS allowed list");
            emit_step_receipt(&sb, eng, i, "WRITE", "EINVAL", sig_idx, false);
            continue;
          }
        }
        parsed_val.num_val =
            (sig->datatype == WARDEN_DT_FLOAT) ? (double)((float)val_v->nval) : val_v->nval;
      }

      // 2. Priority Arbitration & Preemption (P2)
      if (sig->has_active_holder) {
        if (ocb->fd != sig->active_holder.fd && ocb->priority <= sig->active_holder.priority) {
          set_rejection(sig, "EBUSY", "PRIORITY_PREEMPTED",
                        "Actuator locked by higher or equal priority active holder");
          emit_step_receipt(&sb, eng, i, "WRITE", "EBUSY", sig_idx, false);
          continue;
        }
        if (ocb->fd != sig->active_holder.fd && ocb->priority > sig->active_holder.priority) {
          warden_ocb_t *prev_ocb = find_ocb(eng, sig->active_holder.fd);
          if (prev_ocb && prev_ocb->is_open &&
              sig->active_holder.lease_expires_ms > eng->current_clock_ms) {
            prev_ocb->has_standby = true;
            prev_ocb->standby_val = sig->committed_val;
            prev_ocb->standby_expires_ms = sig->active_holder.lease_expires_ms;
            prev_ocb->standby_seq = ++eng->seq_counter;
          }
        }
      }

      sig->committed_val = parsed_val;
      sig->has_active_holder = true;
      sig->active_holder.fd = ocb->fd;
      snprintf(sig->active_holder.role, sizeof(sig->active_holder.role), "%s", ocb->role);
      sig->active_holder.pid = ocb->pid;
      sig->active_holder.priority = ocb->priority;
      sig->active_holder.lease_expires_ms = eng->current_clock_ms + ocb->lease_ms;
      ocb->has_standby = false;

      emit_step_receipt(&sb, eng, i, "WRITE", "EOK", sig_idx, false);
    } else if (strcmp(kind, "CLOSE") == 0) {
      json_val_t *fd_v = j_obj_get(op, "fd");
      json_val_t *now_v = j_obj_get(op, "nowMs");
      if (now_v && now_v->type == J_NUMBER && (int64_t)now_v->nval > eng->current_clock_ms) {
        eng->current_clock_ms = (int64_t)now_v->nval;
      }
      expire_leases_up_to(eng, NULL);

      int32_t fd = (fd_v && fd_v->type == J_NUMBER) ? (int32_t)fd_v->nval : -1;
      warden_ocb_t *ocb = find_ocb(eng, fd);
      if (!ocb || !ocb->is_open) {
        int assoc_sig = ocb ? (int)ocb->signal_idx : -1;
        emit_step_receipt(&sb, eng, i, "CLOSE", "EBADF", assoc_sig, false);
        continue;
      }

      size_t sig_idx = ocb->signal_idx;
      eng->last_touched_signal_idx = sig_idx;
      ocb->is_open = false;
      ocb->has_standby = false;

      if (eng->mode == WARDEN_MODE_GUARDED) {
        warden_signal_t *sig = &eng->signals[sig_idx];
        if (sig->has_active_holder && sig->active_holder.fd == ocb->fd) {
          release_and_recover_signal(eng, sig_idx);
        }
      }

      emit_step_receipt(&sb, eng, i, "CLOSE", "EOK", (int)sig_idx, false);
    } else if (strcmp(kind, "ADVANCE_CLOCK") == 0) {
      json_val_t *delta_v = j_obj_get(op, "deltaMs");
      int64_t delta = (delta_v && delta_v->type == J_NUMBER) ? (int64_t)delta_v->nval : 0;
      if (delta > 0) {
        eng->current_clock_ms += delta;
      }
      int expired_sig = -1;
      expire_leases_up_to(eng, &expired_sig);
      int target_sig = (expired_sig >= 0) ? expired_sig : (int)eng->last_touched_signal_idx;
      if (target_sig >= 0 && (size_t)target_sig < eng->signal_count) {
        eng->last_touched_signal_idx = (size_t)target_sig;
      }
      emit_step_receipt(&sb, eng, i, "ADVANCE_CLOCK", "EOK", target_sig, false);
    } else if (strcmp(kind, "READ_WARDEN") == 0) {
      json_val_t *path_v = j_obj_get(op, "path");
      json_val_t *now_v = j_obj_get(op, "nowMs");
      if (now_v && now_v->type == J_NUMBER && (int64_t)now_v->nval > eng->current_clock_ms) {
        eng->current_clock_ms = (int64_t)now_v->nval;
      }
      expire_leases_up_to(eng, NULL);

      const char *raw_path = (path_v && path_v->type == J_STRING) ? path_v->sval : "";
      vss_warden_path_info_t pinfo;
      if (!vss_warden_canonicalize_path(raw_path, &pinfo)) {
        emit_step_receipt(&sb, eng, i, "READ_WARDEN", "EINVAL", -1, false);
        continue;
      }
      int sig_idx = find_signal_idx(eng, pinfo.canonical_path);
      if (sig_idx < 0) {
        emit_step_receipt(&sb, eng, i, "READ_WARDEN", "ENOENT", -1, false);
        continue;
      }
      eng->last_touched_signal_idx = (size_t)sig_idx;
      emit_step_receipt(&sb, eng, i, "READ_WARDEN", "EOK", sig_idx, true);
    } else {
      emit_step_receipt(&sb, eng, i, kind, "EINVAL", -1, false);
    }
  }

  sb_printf(&sb, "]}\n");
  free(eng);
  j_free(req);
  return 0;
}
