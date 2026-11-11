#ifndef WARDEN_HOST_JSON_H
#define WARDEN_HOST_JSON_H
#include <stdbool.h>
typedef struct host_json_decoder json_decoder_t;
typedef struct host_json_encoder json_encoder_t;
typedef int json_decoder_error_t;
typedef int json_decoder_parse_error_t;
typedef int json_encoder_error_t;
#define JSON_DECODER_OK 0
#define JSON_DECODER_PARSE_ERROR 1
#define JSON_ENCODER_OK 0
#define JSON_ENCODER_AUTO_FORMAT 1
json_decoder_t *json_decoder_create(void);
void json_decoder_destroy(json_decoder_t *);
int json_decoder_parse_file(json_decoder_t *, const char *);
int json_decoder_parse_json_str(json_decoder_t *, const char *);
int json_decoder_push_object(json_decoder_t *, const char *, bool);
int json_decoder_push_array(json_decoder_t *, const char *, bool);
int json_decoder_pop(json_decoder_t *);
int json_decoder_length(json_decoder_t *);
const char *json_decoder_name(json_decoder_t *);
int json_decoder_position_property(json_decoder_t *, const char *);
int json_decoder_position_index(json_decoder_t *, int);
int json_decoder_index(json_decoder_t *);
int json_decoder_previous(json_decoder_t *);
int json_decoder_remove_node(json_decoder_t *, const char *);
int json_decoder_get_string(json_decoder_t *, const char *, const char **, bool);
int json_decoder_get_double(json_decoder_t *, const char *, double *, bool);
int json_decoder_get_int_ll(json_decoder_t *, const char *, long long *, bool);
int json_decoder_get_bool(json_decoder_t *, const char *, bool *, bool);
int json_decoder_get_status(json_decoder_t *, bool);
int json_decoder_get_parse_error(json_decoder_t *, int *, const char **);
json_encoder_t *json_encoder_create(void);
void json_encoder_destroy(json_encoder_t *);
void json_encoder_set_option(json_encoder_t *, int);
int json_encoder_add_from_decoder(json_encoder_t *, const char *, json_decoder_t *, const char *);
const char *json_encoder_buffer(json_encoder_t *);
#endif
