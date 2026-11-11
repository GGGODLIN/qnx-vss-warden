#include <json-c/json.h>
#include <sys/json.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

struct frame {struct json_object *object; int index;};
struct host_json_decoder {struct json_object *root; struct frame frames[64]; int depth;};
struct host_json_encoder {char *text;};
static struct json_object *item(struct frame *frame, const char **key) {
  if (!frame->object) return NULL;
  if (json_object_is_type(frame->object, json_type_array)) return json_object_array_get_idx(frame->object, frame->index);
  int i = 0;
  json_object_object_foreach(frame->object, name, value) {
    if (i++ == frame->index) {if (key) *key = name; return value;}
  }
  return NULL;
}
static struct json_object *lookup(json_decoder_t *d, const char *name) {
  if (d->depth == 0) return d->root;
  struct frame *f = &d->frames[d->depth - 1];
  struct json_object *value = NULL;
  if (name) json_object_object_get_ex(f->object, name, &value);
  else value = item(f, NULL);
  return value;
}
json_decoder_t *json_decoder_create(void) {return calloc(1, sizeof(json_decoder_t));}
void json_decoder_destroy(json_decoder_t *d) {if (d) {json_object_put(d->root); free(d);}}
int json_decoder_parse_json_str(json_decoder_t *d, const char *text) {
  d->root = json_tokener_parse(text);
  return d->root ? 0 : 1;
}
int json_decoder_parse_file(json_decoder_t *d, const char *file) {
  d->root = json_object_from_file(file);
  return d->root ? 0 : 1;
}
static int push(json_decoder_t *d, const char *name, enum json_type type) {
  struct json_object *v = lookup(d, name);
  if (!v || !json_object_is_type(v, type) || d->depth == 64) return 1;
  d->frames[d->depth++] = (struct frame){v, 0};
  return 0;
}
int json_decoder_push_object(json_decoder_t *d, const char *name, bool unused) {(void)unused; return push(d, name, json_type_object);}
int json_decoder_push_array(json_decoder_t *d, const char *name, bool unused) {(void)unused; return push(d, name, json_type_array);}
int json_decoder_pop(json_decoder_t *d) {if (!d->depth) return 1; d->depth--; if (d->depth) d->frames[d->depth-1].index++; return 0;}
int json_decoder_length(json_decoder_t *d) {
  struct json_object *v = d->frames[d->depth-1].object;
  return json_object_is_type(v, json_type_array) ? (int)json_object_array_length(v) : json_object_object_length(v);
}
const char *json_decoder_name(json_decoder_t *d) {const char *key = NULL; item(&d->frames[d->depth-1], &key); return key;}
int json_decoder_position_property(json_decoder_t *d, const char *name) {
  struct frame *f = &d->frames[d->depth-1];
  int i = 0;
  json_object_object_foreach(f->object, key, val) {(void)val; if (strcmp(key, name)==0) {f->index=i; return 0;} i++;}
  return 1;
}
int json_decoder_position_index(json_decoder_t *d, int i) {d->frames[d->depth-1].index=i; return 0;}
int json_decoder_index(json_decoder_t *d) {return d->frames[d->depth-1].index;}
int json_decoder_previous(json_decoder_t *d) {d->frames[d->depth-1].index--; return 0;}
int json_decoder_remove_node(json_decoder_t *d, const char *name) {json_object_object_del(d->frames[d->depth-1].object, name); return 0;}
int json_decoder_get_string(json_decoder_t *d, const char *name, const char **out, bool unused) {
  (void)unused; struct json_object *v=lookup(d,name);
  if (!v || !json_object_is_type(v,json_type_string)) return 1;
  *out=json_object_get_string(v); if (!name) d->frames[d->depth-1].index++; return 0;
}
int json_decoder_get_double(json_decoder_t *d, const char *name, double *out, bool unused) {
  (void)unused; struct json_object *v=lookup(d,name);
  if (!v || !(json_object_is_type(v,json_type_double)||json_object_is_type(v,json_type_int))) return 1;
  *out=json_object_get_double(v); if (!name) d->frames[d->depth-1].index++; return 0;
}
int json_decoder_get_int_ll(json_decoder_t *d, const char *name, long long *out, bool unused) {
  (void)unused; struct json_object *v=lookup(d,name);
  if (!v || !json_object_is_type(v,json_type_int)) return 1;
  *out=json_object_get_int64(v); if (!name) d->frames[d->depth-1].index++; return 0;
}
int json_decoder_get_bool(json_decoder_t *d, const char *name, bool *out, bool unused) {
  (void)unused; struct json_object *v=lookup(d,name);
  if (!v || !json_object_is_type(v,json_type_boolean)) return 1;
  *out=json_object_get_boolean(v); if (!name) d->frames[d->depth-1].index++; return 0;
}
int json_decoder_get_status(json_decoder_t *d, bool unused) {(void)d; (void)unused; return 0;}
int json_decoder_get_parse_error(json_decoder_t *d, int *loc, const char **error) {(void)d; *loc=0; *error="host json parse error"; return 1;}
json_encoder_t *json_encoder_create(void) {return calloc(1,sizeof(json_encoder_t));}
void json_encoder_destroy(json_encoder_t *e) {if (e) {free(e->text); free(e);}}
void json_encoder_set_option(json_encoder_t *e,int option) {(void)e; (void)option;}
int json_encoder_add_from_decoder(json_encoder_t *e,const char *name,json_decoder_t *d,const char *property) {
  (void)name; struct json_object *v=lookup(d,property); if (!v) return 1;
  free(e->text); e->text=strdup(json_object_to_json_string_ext(v,JSON_C_TO_STRING_PLAIN)); return e->text?0:1;
}
const char *json_encoder_buffer(json_encoder_t *e) {return e->text;}
