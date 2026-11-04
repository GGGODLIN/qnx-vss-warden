/*
 * Copyright (c) 2025-2026, BlackBerry Limited. All rights reserved.
 *
 * BlackBerry Limited and its licensors  retain all intellectual property and
 * proprietary rights in and to this software and related documentation.  Any
 * use, reproduction, disclosure or distribution of this software and related
 * documentation without an express license agreement from BlackBerry Limited
 * is strictly prohibited.
 */

#include "value.h"

#include <ctype.h>
#include <inttypes.h>
#include <limits.h>
#include <stdlib.h>
#include <string.h>

#include <qpp/qlog.h>

#include "utils/base64.h"

// String representation of the names of supported datatypes.
static const char *s_vss_boolean_str        = "boolean";
static const char *s_vss_int8_str           = "int8";
static const char *s_vss_int16_str          = "int16";
static const char *s_vss_int32_str          = "int32";
static const char *s_vss_int64_str          = "int64";
static const char *s_vss_uint8_str          = "uint8";
static const char *s_vss_uint16_str         = "uint16";
static const char *s_vss_uint32_str         = "uint32";
static const char *s_vss_uint64_str         = "uint64";
static const char *s_vss_float_str          = "float";
static const char *s_vss_double_str         = "double";
static const char *s_vss_string_str         = "string";
static const char *s_vss_binary_str         = "binary";
static const char *s_vss_vector_boolean_str = "boolean[]";
static const char *s_vss_vector_int8_str    = "int8[]";
static const char *s_vss_vector_int16_str   = "int16[]";
static const char *s_vss_vector_int32_str   = "int32[]";
static const char *s_vss_vector_int64_str   = "int64[]";
static const char *s_vss_vector_uint8_str   = "uint8[]";
static const char *s_vss_vector_uint16_str  = "uint16[]";
static const char *s_vss_vector_uint32_str  = "uint32[]";
static const char *s_vss_vector_uint64_str  = "uint64[]";
static const char *s_vss_vector_float_str   = "float[]";
static const char *s_vss_vector_double_str  = "double[]";
static const char *s_vss_vector_string_str  = "string[]";

// Structure to define integer type ranges and info.
typedef struct {
    long long          min;   // Minimum allowed value
    unsigned long long max;   // Maximum allowed value
    size_t             size;  // Size in bytes
    const char        *name;  // Type name for error messages
} int_range_info_t;

// Information table for integer datatypes.
static const int_range_info_t s_int_range_info[23] = {
    [INT8]          = {INT8_MIN, INT8_MAX, sizeof(int8_t), "int8"},
    [VECTOR_INT8]   = {INT8_MIN, INT8_MAX, sizeof(int8_t), "int8[]"},
    [INT16]         = {INT16_MIN, INT16_MAX, sizeof(int16_t), "int16"},
    [VECTOR_INT16]  = {INT16_MIN, INT16_MAX, sizeof(int16_t), "int16[]"},
    [INT32]         = {INT32_MIN, INT32_MAX, sizeof(int32_t), "int32"},
    [VECTOR_INT32]  = {INT32_MIN, INT32_MAX, sizeof(int32_t), "int32[]"},
    [INT64]         = {INT64_MIN, INT64_MAX, sizeof(int64_t), "int64"},
    [VECTOR_INT64]  = {INT64_MIN, INT64_MAX, sizeof(int64_t), "int64[]"},
    [UINT8]         = {0, UINT8_MAX, sizeof(uint8_t), "uint8"},
    [VECTOR_UINT8]  = {0, UINT8_MAX, sizeof(uint8_t), "uint8[]"},
    [UINT16]        = {0, UINT16_MAX, sizeof(uint16_t), "uint16"},
    [VECTOR_UINT16] = {0, UINT16_MAX, sizeof(uint16_t), "uint16[]"},
    [UINT32]        = {0, UINT32_MAX, sizeof(uint32_t), "uint32"},
    [VECTOR_UINT32] = {0, UINT16_MAX, sizeof(uint16_t), "uint16[]"},
    [UINT64]        = {0, ULLONG_MAX, sizeof(uint64_t), "uint64"},
    [VECTOR_UINT64] = {0, ULLONG_MAX, sizeof(uint64_t), "uint64[]"}};

/**
 * @brief Sets a single value from JSON to either a vector or non vector value datatype.
 *
 * @param dec JSON decoder pointing to the value.
 * @param value The value node that the value will be stored in.
 * @param is_vector If it is a vector datatype or not.
 * @param idx The index in the vector that the value should be set for. If is_vector=false this must be 0.
 *
 * @return EOK on success, otherwise an appropriate error code.
 */
static int32_t value_set_from_json_simple(json_decoder_t *dec, value_t *value, uint32_t idx);

/**
 * Returns the size of a datatype.
 *
 * @note For vector datatypes a single element size is returned i.e int64_t[] returns 8.
 *
 * @param type The datatype to retrieve the size for.
 *
 * @return 0 for variable or unknown sized datatypes, otherwise a positive size.
 */
static size_t datatype_base_size(const datatype_t type);

/**
 * Returns the max string width the text representation could take up for the datatype, including the null terminator.
 *
 * @param type The datatype to be queried for max string width.
 *
 * @return 0 for variable or unknown sized datatypes, otherwise the max width a string can have for the datatype.
 */
static size_t datatype_max_string_width(const datatype_t type);

/**
 * @brief Get a long long int default value (for 64-bit types) from JSON.
 *
 * @param dec JSON decoder.
 * @param type Integer datatype.
 * @param[out] value_out Pointer to store the default value in.
 *
 * @return EOK on success, otherwise an appropriate error code.
 */
static int get_int_ll_default(json_decoder_t *dec, datatype_t type, long long *value_out);

/**
 * Sets a given boolean from a string.
 *
 * @param[out] b Boolean set based on the provided string. On failure it will be unchanged.
 * @param buf    String representation of the boolean. Valid inputs are True|true|1 -> true, False|false|0 -> false.
 *
 * @return EOK if the string was successfully parsed, otherwise EBADMSG.
 */
static inline int set_bool_from_str(bool *b, const char *buf) {
    int status = EOK;
    if ((strcmp(buf, "True") == 0) || (strcmp(buf, "true") == 0) || (strcmp(buf, "1") == 0)) {
        *b = true;
    } else if ((strcmp(buf, "False") == 0) || (strcmp(buf, "false") == 0) || (strcmp(buf, "0") == 0)) {
        *b = false;
    } else {
        status = EBADMSG;
    }
    return status;
}

#ifndef UT_NO_WRITE_TEXT_HELPERS
/**
 * @brief Negative-number-safe strtoull.
 *
 * @param str String converted to unsigned long long.
 * @param str_end Pointer to last character converted into ull.
 * @param base Numerical base (10 is decimal).
 *
 * @return The converted number on success, otherwise 0 with errno set:
 *   - ERANGE on negative input.
 *   - EINVAL on null str input.
 */
static inline unsigned long long s_strtoull(const char *restrict str, char **restrict str_end, int base) {
    const char *cursor = str;
    if (NULL == cursor) {
        errno = EINVAL;
        return 0;
    }
    while (isspace(*cursor)) {
        cursor++;
    }
    if ('-' == *cursor) {
        errno = ERANGE;
        return 0;
    }
    return strtoull(cursor, str_end, base);
}
#endif  // UT_NO_WRITE_TEXT_HELPERS

/**
 * @brief Checks if a given datatype is a vector.
 *
 * @param type Datatype to check.
 *
 * @return true if the datatype is a vector, false otherwise.
 */
static inline bool datatype_is_vector(const datatype_t type) {
    return ((type >= DATATYPE_VECTOR_MIN) && (type <= DATATYPE_VECTOR_MAX));
}

/**
 * @brief Checks if a given datatype is a scaler, meaning it holds a single value.
 *
 * @param type Datatype to check.
 *
 * @return true if the datatype is a scaler, false otherwise.
 */
static inline bool datatype_is_scaler(const datatype_t type) {
    return ((type >= DATATYPE_SCALER_MIN) && (type <= DATATYPE_SCALER_MAX));
}

/**
 * @brief Checks if a given datatype is held in a pointer.
 *
 * @param type Datatype to check.
 *
 * @return true if the datatype is held in a pointer, false otherwise.
 */
static inline bool datatype_is_pointer(const datatype_t type) {
    return ((type >= DATATYPE_VECTOR_MIN) && (type <= DATATYPE_VECTOR_MAX)) || (type == STRING) || (type == BINARY);
}

int32_t value_set_from_json(json_decoder_t *dec, value_t *value) {
    int32_t status = EOK;
    if ((dec == NULL) || (value == NULL)) {
        status = EINVAL;
    } else if (datatype_is_scaler(value->type)) {
        // String size set within function as it is variable.
        status = value_set_from_json_simple(dec, value, 0U);
        if ((status == EOK) && (!datatype_is_pointer(value->type))) {
            value->nbytes = datatype_base_size(value->type);
        }
    } else if (datatype_is_vector(value->type)) {
        json_decoder_error_t dec_err = json_decoder_push_array(dec, NULL, false);
        if (dec_err == JSON_DECODER_OK) {
            // In all cases but VECTOR_STRING we can just pre-allocate the buffer.
            int    json_len  = json_decoder_length(dec);
            size_t base_size = datatype_base_size(value->type);
            value->nbytes    = base_size * (size_t)json_len;
            // 0 indicates the value type is binary, string, or vector of strings.
            // skip those datatypes for now and let the below 'if' handle them.
            if (value->nbytes > 0UL) {
                free(value->data.v_i8);  // Clear any existing data.
                value->data.v_i8 = calloc(1, value->nbytes);
                if (value->data.v_i8 == NULL) {
                    status = ENOMEM;
                }
            }

            if (status == EOK) {
                for (uint32_t i = 0; i < (uint32_t)json_len; i++) {
                    status = value_set_from_json_simple(dec, value, i);
                    if (status != EOK) {
                        break;
                    }
                }
            }
            (void)json_decoder_pop(dec);
        } else {
            QLOG_WRN("Expected JSON array when parsing value.");
            status = EINVAL;
        }
    } else {  // UNKNOWN datatype
        status = ENOSYS;
    }

    return status;
}

datatype_t value_datatype_from_str(const char *str) {
    datatype_t type;
    if (strcmp(str, s_vss_boolean_str) == 0) {
        type = BOOLEAN;
    } else if (strcmp(str, s_vss_int8_str) == 0) {
        type = INT8;
    } else if (strcmp(str, s_vss_int16_str) == 0) {
        type = INT16;
    } else if (strcmp(str, s_vss_int32_str) == 0) {
        type = INT32;
    } else if (strcmp(str, s_vss_int64_str) == 0) {
        type = INT64;
    } else if (strcmp(str, s_vss_uint8_str) == 0) {
        type = UINT8;
    } else if (strcmp(str, s_vss_uint16_str) == 0) {
        type = UINT16;
    } else if (strcmp(str, s_vss_uint32_str) == 0) {
        type = UINT32;
    } else if (strcmp(str, s_vss_uint64_str) == 0) {
        type = UINT64;
    } else if (strcmp(str, s_vss_float_str) == 0) {
        type = FLOAT;
    } else if (strcmp(str, s_vss_double_str) == 0) {
        type = DOUBLE;
    } else if (strcmp(str, s_vss_string_str) == 0) {
        type = STRING;
    } else if (strcmp(str, s_vss_binary_str) == 0) {
        type = BINARY;
    } else if (strcmp(str, s_vss_vector_boolean_str) == 0) {
        type = VECTOR_BOOLEAN;
    } else if (strcmp(str, s_vss_vector_int8_str) == 0) {
        type = VECTOR_INT8;
    } else if (strcmp(str, s_vss_vector_int16_str) == 0) {
        type = VECTOR_INT16;
    } else if (strcmp(str, s_vss_vector_int32_str) == 0) {
        type = VECTOR_INT32;
    } else if (strcmp(str, s_vss_vector_int64_str) == 0) {
        type = VECTOR_INT64;
    } else if (strcmp(str, s_vss_vector_uint8_str) == 0) {
        type = VECTOR_UINT8;
    } else if (strcmp(str, s_vss_vector_uint16_str) == 0) {
        type = VECTOR_UINT16;
    } else if (strcmp(str, s_vss_vector_uint32_str) == 0) {
        type = VECTOR_UINT32;
    } else if (strcmp(str, s_vss_vector_uint64_str) == 0) {
        type = VECTOR_UINT64;
    } else if (strcmp(str, s_vss_vector_float_str) == 0) {
        type = VECTOR_FLOAT;
    } else if (strcmp(str, s_vss_vector_double_str) == 0) {
        type = VECTOR_DOUBLE;
    } else if (strcmp(str, s_vss_vector_string_str) == 0) {
        type = VECTOR_STRING;
    } else {
        type = UNDEFINED;
    }
    return type;
}

const char *value_datatype_to_str(datatype_t type) {
    // clang-format off
    switch (type) {
        case BOOLEAN:         return s_vss_boolean_str;
        case VECTOR_BOOLEAN:  return s_vss_vector_boolean_str;
        case INT8:            return s_vss_int8_str;
        case UINT8:           return s_vss_uint8_str;
        case VECTOR_INT8:     return s_vss_vector_int8_str;
        case VECTOR_UINT8:    return s_vss_vector_uint8_str;
        case UINT16:          return s_vss_uint16_str;
        case INT16:           return s_vss_int16_str;
        case VECTOR_INT16:    return s_vss_vector_int16_str;
        case VECTOR_UINT16:   return s_vss_vector_uint16_str;
        case INT32:           return s_vss_int32_str;
        case UINT32:          return s_vss_uint32_str;
        case VECTOR_INT32:    return s_vss_vector_int32_str;
        case VECTOR_UINT32:   return s_vss_vector_uint32_str;
        case INT64:           return s_vss_int64_str;
        case UINT64:          return s_vss_uint64_str;
        case VECTOR_INT64:    return s_vss_vector_int64_str;
        case VECTOR_UINT64:   return s_vss_vector_uint64_str;
        case FLOAT:           return s_vss_float_str;
        case VECTOR_FLOAT:    return s_vss_vector_float_str;
        case DOUBLE:          return s_vss_double_str;
        case VECTOR_DOUBLE:   return s_vss_vector_double_str;
        case BINARY:          return s_vss_binary_str;
        case STRING:          return s_vss_string_str;
        case VECTOR_STRING:   return s_vss_vector_string_str;
        case UNDEFINED:
        default:              return "undefined";
    }
    // clang-format on
}

static int get_int_ll_default(json_decoder_t *dec, datatype_t type, long long *value_out) {
    int                     status = EOK;
    const int_range_info_t *info   = &s_int_range_info[type];
    long long               tmp    = 0;
    json_decoder_error_t    err    = json_decoder_get_int_ll(dec, NULL, &tmp, false);
    if (err != JSON_DECODER_OK) {
        QLOG_ERR("Failed to read JSON value");
        status = ENODATA;
    } else if (((tmp >= info->min) && (tmp <= 0)) || ((tmp > 0) && ((uint64_t)tmp <= info->max))) {
        *value_out = tmp;
    } else {
        QLOG_ERR("Default value %lld out of range [%lld, %llu]", tmp, info->min, info->max);
        status = ERANGE;
    }

    return status;
}

static int32_t value_set_from_json_simple(json_decoder_t *dec, value_t *value, uint32_t idx) {
    int32_t              status  = EOK;
    json_decoder_error_t dec_err = JSON_DECODER_OK;
    const char          *str     = NULL;
    long long            json_l  = 0;
    double               json_d  = 0.0;
    bool                 json_b  = false;

    // Cast everything to a pointer so there is one data path for all types.
    void *data_ptr = datatype_is_pointer(value->type) ? (void *)value->data.c : (void *)&value->data;

    switch (value->type) {
        case VECTOR_BOOLEAN:
        case BOOLEAN:
            dec_err = json_decoder_get_bool(dec, NULL, &json_b, false);
            if (dec_err == JSON_DECODER_OK) {
                ((bool *)data_ptr)[idx] = (bool)json_b;
            }
            break;
        case VECTOR_INT8:
        case INT8:
            status = get_int_ll_default(dec, value->type, &json_l);
            if (status == EOK) {
                ((int8_t *)data_ptr)[idx] = (int8_t)json_l;
            }
            break;
        case VECTOR_INT16:
        case INT16:
            status = get_int_ll_default(dec, value->type, &json_l);
            if (status == EOK) {
                ((int16_t *)data_ptr)[idx] = (int16_t)json_l;
            }
            break;
        case VECTOR_INT32:
        case INT32:
            status = get_int_ll_default(dec, value->type, &json_l);
            if (status == EOK) {
                ((int32_t *)data_ptr)[idx] = (int32_t)json_l;
            }
            break;
        case VECTOR_INT64:
        case INT64:
            status = get_int_ll_default(dec, value->type, &json_l);
            if (status == EOK) {
                ((int64_t *)data_ptr)[idx] = (int64_t)json_l;
            }
            break;
        case VECTOR_UINT8:
        case UINT8:
            status = get_int_ll_default(dec, value->type, &json_l);
            if (status == EOK) {
                ((uint8_t *)data_ptr)[idx] = (uint8_t)json_l;
            }
            break;
        case VECTOR_UINT16:
        case UINT16:
            status = get_int_ll_default(dec, value->type, &json_l);
            if (status == EOK) {
                ((uint16_t *)data_ptr)[idx] = (uint16_t)json_l;
            }
            break;
        case VECTOR_UINT32:
        case UINT32:
            status = get_int_ll_default(dec, value->type, &json_l);
            if (status == EOK) {
                ((uint32_t *)data_ptr)[idx] = (uint32_t)json_l;
            }
            break;
        case VECTOR_UINT64:
        case UINT64:
            status = get_int_ll_default(dec, value->type, &json_l);
            if (status == EOK) {
                ((uint64_t *)data_ptr)[idx] = (uint64_t)json_l;
            }
            break;
        case VECTOR_FLOAT:
        case FLOAT:
            dec_err = json_decoder_get_double(dec, NULL, &json_d, false);
            if (dec_err == JSON_DECODER_OK) {
                ((float *)data_ptr)[idx] = (float)json_l;
            }
            break;
        case VECTOR_DOUBLE:
        case DOUBLE:
            dec_err = json_decoder_get_double(dec, NULL, &json_d, false);
            if (dec_err == JSON_DECODER_OK) {
                ((double *)data_ptr)[idx] = (double)json_l;
            }
            break;
        case STRING:
        case VECTOR_STRING: {
            // Must get length before get_string as get_string will advance to next index on success.
            dec_err = json_decoder_get_string(dec, NULL, &str, false);
            if (dec_err == JSON_DECODER_OK) {
                size_t str_len = strlen(str);
                // First index is the same as a string
                if ((value->type == VECTOR_STRING) && (idx != 0U)) {
                    char *new_buf = realloc(value->data.v_c, value->nbytes + str_len + 1UL);
                    if (new_buf == NULL) {
                        status = ENOMEM;
                    } else {
                        value->data.v_c = new_buf;
                        (void)strcpy(&value->data.v_c[value->nbytes], str);
                        value->nbytes += str_len + 1UL;  // include \0
                    }
                } else {
                    // Clear any existing strings.
                    free(value->data.c);
                    value->data.c = strdup(str);
                    if (value->data.c == NULL) {
                        status = ENOMEM;
                    } else {
                        value->nbytes = str_len + 1UL;  // include \0
                    }
                }
            }
            break;
        }
        case BINARY: {
            dec_err = json_decoder_get_string(dec, NULL, &str, false);
            if (dec_err == JSON_DECODER_OK) {
                size_t str_len = strlen(str);
                value->nbytes  = base64_decode_size(str, str_len + 1UL);
                if (value->nbytes > 0UL) {
                    value->data.bin = calloc(1, value->nbytes);
                    if (value->data.bin != NULL) {
                        status = base64_decode(str, str_len + 1UL, (uint8_t *)value->data.bin, &value->nbytes);
                    } else {
                        status = ENOMEM;
                    }
                } else {
                    status = EBADMSG;
                }
            }
            break;
        }
        default:
            status = ENOSYS;
            break;
    }

    if (dec_err != JSON_DECODER_OK) {
        status = EIO;
    }
    return status;
}

static size_t datatype_base_size(const datatype_t type) {
    size_t base_size;
    switch (type) {
        case BOOLEAN:
        case VECTOR_BOOLEAN:
            base_size = sizeof(bool);
            break;
        case INT8:
        case UINT8:
        case VECTOR_INT8:
        case VECTOR_UINT8:
            base_size = sizeof(int8_t);
            break;
        case UINT16:
        case INT16:
        case VECTOR_INT16:
        case VECTOR_UINT16:
            base_size = sizeof(int16_t);
            break;
        case INT32:
        case UINT32:
        case VECTOR_INT32:
        case VECTOR_UINT32:
            base_size = sizeof(int32_t);
            break;
        case INT64:
        case UINT64:
        case VECTOR_INT64:
        case VECTOR_UINT64:
            base_size = sizeof(int64_t);
            break;
        case FLOAT:
        case VECTOR_FLOAT:
            base_size = sizeof(float);
            break;
        case DOUBLE:
        case VECTOR_DOUBLE:
            base_size = sizeof(double);
            break;
        // Variable or unknown
        case BINARY:
        case STRING:
        case VECTOR_STRING:
        default:
            base_size = 0UL;
            break;
    }
    return base_size;
}

static size_t datatype_max_string_width(const datatype_t type) {
    size_t text_size;
    // Each have max size + 1 for either a null terminator or comma.
    switch (type) {
        case BOOLEAN:
        case VECTOR_BOOLEAN:  // 6 =  strlen("true" || "false") + sizeof(',' || '\0')
            text_size = 6;
            break;
        case INT8:  // 5 =  sizeof('-') + strlen("128") + sizeof(',' || '\0')
        case UINT8:
        case VECTOR_INT8:
        case VECTOR_UINT8:
            text_size = 5;
            break;
        case UINT16:  // 7 =  sizeof('-') + strlen("32767") + sizeof(',' || '\0')
        case INT16:
        case VECTOR_INT16:
        case VECTOR_UINT16:
            text_size = 7;
            break;
        case INT32:
        case UINT32:
        case VECTOR_INT32:
        case VECTOR_UINT32:  // 12 =  sizeof('-') + strlen("2147483647") + sizeof(',' || '\0')
            text_size = 12;
            break;
        case INT64:   // 21 =  sizeof('-') + strlen("9223372036854775807") + sizeof(',' || '\0')
        case UINT64:  // 21 =  strlen("18446744073709551615") + sizeof(',' || '\0')
        case VECTOR_INT64:
        case VECTOR_UINT64:
            text_size = 21;
            break;
        case FLOAT:  // 48 = sizeof('-') + (39 digit int) + sizeof('.') + (decimal width of 6) + sizeof(',' || '\0')
        case VECTOR_FLOAT:
            // MAX number if printed as memset(float + 1, CHAR_MAX, sizeof(float) - 1);
            text_size = 48;
            break;
        case DOUBLE:  // 318 = sizeof('-') + (309 digit int) + sizeof('.') + (decimal width of 6) + sizeof(',' || '\0')
        case VECTOR_DOUBLE:
            text_size = 318;
            break;
        // Variable or unknown
        case BINARY:
        case STRING:
        case VECTOR_STRING:
        default:
            text_size = 0UL;
            break;
    }
    return text_size;
}

int32_t value_as_binary(value_t *value, void **buf, size_t *size) {
    int32_t status = EOK;
    if ((value == NULL) || (buf == NULL) || (size == NULL)) {
        QLOG_WRN("Invalid input arguments for value_as_binary(value=%p, buf=%p, size=%p)", value, buf, size);
        status = EINVAL;
    } else if (value->nbytes == 0UL) {
        QLOG_WRN("Attempted to get value=%p with empty value", value);
        status = ENODATA;
    } else if (datatype_is_pointer(value->type)) {
        // The String and Vector types in the Value union are all pointers and start at the same memory
        // location within the union. Since resmgr_msgwrite() takes a void* and does not interpret the
        // type the pointer points to, we can use any of the types within the union as the void* parameter.
        // resmgr_msgwrite will use the void* and filesize to write the correct data to the client buffer.
        *buf = value->data.bin;
    } else if (datatype_is_scaler(value->type)) {
        // We know the memory location and length of data, so just copy to client buf.
        *buf = &value->data;
    } else {  // UNKNOWN datatype
        QLOG_WRN("Unknown datatype for value=%p", value);
        status = ENOSYS;
    }

    if (status == EOK) {
        *size = value->nbytes;
    }

    return status;
}

static int32_t value_as_text_simple(value_t *value, char *const *text, size_t *size, size_t max_size, size_t idx) {
    int32_t status = EOK;
    // Cast everything to a pointer so there is one data path for all types.
    void *data_ptr = (datatype_is_pointer(value->type)) ? (void *)value->data.c : (void *)&value->data;

    // Offset the text pointer depending on how much we have read.
    char *text_ptr = &((*text)[*size]);

    // How many bytes were added by this call. If -1 that means the write failed.
    int32_t bytes_written = 0;

    size_t size_left = max_size - *size;

    switch (value->type) {
        case BOOLEAN:
        case VECTOR_BOOLEAN:
            bytes_written = snprintf(text_ptr, size_left, "%s", (((bool *)data_ptr)[idx]) ? "true" : "false");
            break;
        case INT8:
        case VECTOR_INT8:
            bytes_written = snprintf(text_ptr, size_left, "%" PRId8, ((int8_t *)data_ptr)[idx]);
            break;
        case INT16:
        case VECTOR_INT16:
            bytes_written = snprintf(text_ptr, size_left, "%" PRId16, (((int16_t *)data_ptr)[idx]));
            break;
        case INT32:
        case VECTOR_INT32:
            bytes_written = snprintf(text_ptr, size_left, "%" PRId32, (((int32_t *)data_ptr)[idx]));
            break;
        case INT64:
        case VECTOR_INT64:
            bytes_written = snprintf(text_ptr, size_left, "%" PRId64, (((int64_t *)data_ptr)[idx]));
            break;
        case UINT8:
        case VECTOR_UINT8:
            bytes_written = snprintf(text_ptr, size_left, "%" PRIu8, (((uint8_t *)data_ptr)[idx]));
            break;
        case UINT16:
        case VECTOR_UINT16:
            bytes_written = snprintf(text_ptr, size_left, "%" PRIu16, (((uint16_t *)data_ptr)[idx]));
            break;
        case UINT32:
        case VECTOR_UINT32:
            bytes_written = snprintf(text_ptr, size_left, "%" PRIu32, (((uint32_t *)data_ptr)[idx]));
            break;
        case UINT64:
        case VECTOR_UINT64:
            bytes_written = snprintf(text_ptr, size_left, "%" PRIu64, (((uint64_t *)data_ptr)[idx]));
            break;
        case FLOAT:
        case VECTOR_FLOAT:
            bytes_written = snprintf(text_ptr, size_left, "%.6f", (((float *)data_ptr)[idx]));
            break;
        case DOUBLE:
        case VECTOR_DOUBLE:
            bytes_written = snprintf(text_ptr, size_left, "%.6f", (((double *)data_ptr)[idx]));
            break;
        case BINARY: {
            size_t out_size = max_size;
            status          = base64_encode((uint8_t *)value->data.bin, value->nbytes, text_ptr, &out_size);
            bytes_written   = (int32_t)out_size - 1;  // Strip null terminator
            break;
        }
        case STRING:
        case VECTOR_STRING:
            bytes_written = (int32_t)value->nbytes - 1;
            if ((size_t)bytes_written <= size_left) {
                (void)memcpy(text_ptr, value->data.c, value->nbytes);
                if (value->type == VECTOR_STRING) {
                    for (size_t i = 0; i < (value->nbytes - 1UL); i++) {
                        if (text_ptr[i] == '\0') {
                            text_ptr[i] = ',';
                        }
                    }
                }
            }
            break;
        default:
            QLOG_WRN("Unable to convert value=%p with unknown datatype(%d) to text", value, value->type);
            status = ENOSYS;
            break;
    }

    // sprintf failure
    if (status != EOK) {
        // Other failure don't try to modify the status or size.
    } else if ((bytes_written <= 0) || ((size_t)bytes_written >= size_left)) {
        status = EINVAL;
    } else {
        *size += (size_t)bytes_written;
    }
    return status;
}

int32_t value_as_text(value_t *value, char **text, size_t *size) {
    int32_t status = EOK;
    if ((value == NULL) || (text == NULL) || (size == NULL)) {
        QLOG_WRN("Invalid input arguments for value_as_text(value=%p, text=%p, size=%p)", value, text, size);
        status = EINVAL;
        goto error;
    }

    if (value->nbytes == 0UL) {
        QLOG_WRN("Attempted to get value=%p as text with empty value", value);
        status = ENODATA;
        goto error;
    }

    // Alloc text
    size_t base_size      = datatype_base_size(value->type);
    size_t array_size     = 1;
    size_t base_text_size = datatype_max_string_width(value->type);

    // Binary is a special case as we need to do base64 encoding.
    if (value->type == BINARY) {
        base_text_size = base64_encode_size(value->nbytes);
    } else if (base_size == 0UL) {
        // For variable length datatypes just use the value size as the base size.
        base_text_size = value->nbytes;
    } else {
        array_size = value->nbytes / base_size;
    }

    size_t max_size = array_size * base_text_size;
    *text           = malloc(max_size);
    if (*text == NULL) {
        QLOG_WRN("Failed to allocate memory for text for value=%p", value);
        status = ENOMEM;
        goto error;
    }

    if (datatype_is_scaler(value->type) || (value->type == VECTOR_STRING)) {
        *size  = 0;
        status = value_as_text_simple(value, text, size, max_size, 0U);
    } else if (datatype_is_vector(value->type)) {
        *size = 0;
        for (size_t i = 0; i < array_size; i++) {
            status = value_as_text_simple(value, text, size, max_size, i);
            if (status != EOK) {
                goto error;
            }
            if (i != (array_size - 1UL)) {
                if ((*size + 1UL) < max_size) {
                    (*text)[*size] = ',';
                    (*size)++;
                    (*text)[*size] = '\0';
                } else {
                    QLOG_WRN("Failed to convert array value=%p to string: value larger than expected.", value);
                    status = EINVAL;
                    goto error;
                }
            }
        }
    } else {  // UNKNOWN datatype
        QLOG_WRN("Unknown datatype for value=%p", value);
        status = ENOSYS;
        goto error;
    }

    // Add one for the last null terminator.
    (*size)++;
error:
    if (status != EOK) {
        if (text != NULL) {
            free(*text);
            *text = NULL;
        }
    }
    return status;
}

int32_t value_write_binary(value_t *value, void **buf_ptr, size_t size) {
    int32_t status = EOK;
    if ((value == NULL) || (buf_ptr == NULL) || (*buf_ptr == NULL) || (size <= 0UL)) {
        status = EINVAL;
        goto error;
    }
    void  *buf              = *buf_ptr;
    bool   is_vector        = datatype_is_vector(value->type);
    size_t exp_element_size = datatype_base_size(value->type);

    if ((value->type < DATATYPE_SCALER_MIN) || (value->type > DATATYPE_VECTOR_MAX)) {
        QLOG_ERR("Unknown datatype!");
        status = ENOSYS;
        goto error;
    }

    // Handle size validation for fixed-size types before switch.
    if (is_vector) {
        if (value->type == VECTOR_STRING) {
            if (((char *)buf)[size - 1UL] != '\0') {
                QLOG_ERR("Invalid write value=%p. String Vectors must be null terminated!", value);
                status = EBADMSG;
                goto error;
            }
        } else {
            if ((size % exp_element_size) != 0UL) {
                QLOG_ERR("Write to value=%p with invalid number of bytes. expected multiple of %zu, written %zu", value,
                         exp_element_size, size);
                status = EBADMSG;
                goto error;
            }
        }
    } else {
        if (value->type == STRING) {
            size_t str_len = strnlen((const char *)buf, size);
            if (str_len != (size - 1UL)) {
                QLOG_ERR("Invalid text write. Expected %zu characters. Found %zu!", size - 1, str_len);
                status = EBADMSG;
                goto error;
            }
        }

        // For variable size datatype exp_element_size=0 like string, binary, any datatype size if valid.
        if ((exp_element_size != 0UL) && (size != exp_element_size)) {
            QLOG_ERR("Write to value=%p with invalid number of bytes. expected: %zu, written %zu", value,
                     exp_element_size, size);
            status = EBADMSG;
            goto error;
        }
    }

    // Special validation for boolean types.
    if ((value->type == BOOLEAN) || (value->type == VECTOR_BOOLEAN)) {
        const bool *bool_buf   = buf;
        size_t      bool_count = size / exp_element_size;
        for (size_t i = 0; i < bool_count; i++) {
            if ((bool_buf[i] != true) && (bool_buf[i] != false)) {
                QLOG_ERR("write to value=%p expected a bool but found invalid value", value);
                status = EBADMSG;
                goto error;
            }
        }
    }

    if (datatype_is_pointer(value->type)) {
        // Just take over ownership of the pointer as it already contains the data we want.
        free(value->data.c);
        value->data.c = buf;
        *buf_ptr      = NULL;
    } else {
        (void)memcpy((void *)&value->data, buf, exp_element_size);
    }

    value->nbytes = size;

error:
    // Always consume the buffer even on failure.
    if (buf_ptr != NULL) {
        free(*buf_ptr);
        *buf_ptr = NULL;
    }
    return status;
}

static int32_t value_write_text_simple(const value_t *value, value_data_t *new_data, const char *text, size_t idx) {
    int32_t            status  = EOK;
    long long          ll_num  = 0;
    unsigned long long ull_num = 0UL;
    float              f_num   = 0.f;
    double             d_num   = 0.0;
    char              *end     = NULL;

    void *data_ptr = (datatype_is_pointer(value->type)) ? (void *)new_data->c : (void *)new_data;

    // Reset errno before call as it is used in most cases.
    errno = EOK;
    switch (value->type) {
        case BOOLEAN:
        case VECTOR_BOOLEAN:
            status = set_bool_from_str(&((bool *)data_ptr)[idx], text);
            break;
        case INT8:
        case VECTOR_INT8:
            ll_num = strtoll(text, &end, 10);
            if ((errno != EOK) || (end == text) || (*end != '\0') || (ll_num < INT8_MIN) || (ll_num > INT8_MAX)) {
                status = EBADMSG;
            } else {
                ((int8_t *)data_ptr)[idx] = (int8_t)ll_num;
            }
            break;
        case INT16:
        case VECTOR_INT16:
            ll_num = strtoll(text, &end, 10);
            if ((errno != EOK) || (end == text) || (*end != '\0') || (ll_num < INT16_MIN) || (ll_num > INT16_MAX)) {
                status = EBADMSG;
            } else {
                ((int16_t *)data_ptr)[idx] = (int16_t)ll_num;
            }
            break;
        case INT32:
        case VECTOR_INT32:
            ll_num = strtoll(text, &end, 10);
            if ((errno != EOK) || (end == text) || (*end != '\0') || (ll_num < INT32_MIN) || (ll_num > INT32_MAX)) {
                status = EBADMSG;
            } else {
                ((int32_t *)data_ptr)[idx] = (int32_t)ll_num;
            }
            break;
        case INT64:
        case VECTOR_INT64:
            ll_num = strtoll(text, &end, 10);
            if ((errno != EOK) || (end == text) || (*end != '\0')) {
                status = EBADMSG;
            } else {
                ((int64_t *)data_ptr)[idx] = (int64_t)ll_num;
            }
            break;
        case UINT8:
        case VECTOR_UINT8:
            ull_num = s_strtoull(text, &end, 10);
            if ((errno != EOK) || (end == text) || (*end != '\0') || (ull_num > (unsigned long long)UINT8_MAX)) {
                status = EBADMSG;
            } else {
                ((uint8_t *)data_ptr)[idx] = (uint8_t)ull_num;
            }
            break;
        case UINT16:
        case VECTOR_UINT16:
            ull_num = s_strtoull(text, &end, 10);
            if ((errno != EOK) || (end == text) || (*end != '\0') || (ull_num > (unsigned long long)UINT16_MAX)) {
                status = EBADMSG;
            } else {
                ((uint16_t *)data_ptr)[idx] = (uint16_t)ull_num;
            }
            break;
        case UINT32:
        case VECTOR_UINT32:
            ull_num = s_strtoull(text, &end, 10);
            if ((errno != EOK) || (end == text) || (*end != '\0') || (ull_num > (unsigned long long)UINT32_MAX)) {
                status = EBADMSG;
            } else {
                ((uint32_t *)data_ptr)[idx] = (uint32_t)ull_num;
            }
            break;
        case UINT64:
        case VECTOR_UINT64:
            ull_num = s_strtoull(text, &end, 10);
            if ((errno != EOK) || (end == text) || (*end != '\0')) {
                status = EBADMSG;
            } else {
                ((uint64_t *)data_ptr)[idx] = (uint64_t)ull_num;
            }
            break;
        case FLOAT:
        case VECTOR_FLOAT:
            f_num = strtof(text, &end);
            if ((errno != EOK) || (end == text) || (*end != '\0')) {
                status = EBADMSG;
            } else {
                ((float *)data_ptr)[idx] = (float)f_num;
            }
            break;
        case DOUBLE:
        case VECTOR_DOUBLE:
            d_num = strtod(text, &end);
            if ((errno != EOK) || (end == text) || (*end != '\0')) {
                status = EBADMSG;
            } else {
                ((double *)data_ptr)[idx] = (double)d_num;
            }
            break;
        default:
            QLOG_WRN("Unable to write value=%p with unknown datatype(%d) from text", value, value->type);
            status = ENOSYS;
            break;
    }
    return status;
}

int32_t value_write_text(value_t *value, char **text_ptr, size_t size) {
    int32_t status    = EOK;
    bool    is_vector = false;
    bool    is_scaler = false;
    char   *text      = NULL;

    // Don't write directly into the value in case of failure we need to revert.
    value_data_t new_data = {0};
    size_t       new_size = 0;

    if ((value == NULL) || (text_ptr == NULL) || (*text_ptr == NULL) || (size <= 0UL)) {
        status = EINVAL;
        goto error;
    }
    text             = *text_ptr;
    size_t base_size = datatype_base_size(value->type);
    is_vector        = datatype_is_vector(value->type);
    is_scaler        = datatype_is_scaler(value->type);

    if ((value->type == STRING) || (value->type == VECTOR_STRING)) {
        if (strnlen(text, size) != (size - 1UL)) {
            QLOG_ERR("Strings and Vector Strings must be null terminated");
            status = EBADMSG;
            goto error;
        }

        // Just consume the string as it already contains the data we need.
        new_size   = size;
        new_data.c = text;
        *text_ptr  = NULL;
        text       = NULL;
        if (value->type == VECTOR_STRING) {
            for (size_t i = 0; i < size; i++) {
                if (new_data.c[i] == ',') {
                    new_data.c[i] = '\0';
                }
            }
        }
    } else if (value->type == BINARY) {
        new_size = base64_decode_size(*text_ptr, size);
        if (new_size == 0UL) {
            QLOG_WRN("Invalid base64 input=%s size=%lu", *text_ptr, size);
            status = EBADMSG;
            goto error;
        }
        new_data.bin = calloc(1, new_size);
        if (new_data.bin == NULL) {
            status = ENOMEM;
            goto error;
        }

        status = base64_decode(*text_ptr, size, (uint8_t *)new_data.bin, &new_size);
    } else if (is_scaler) {
        status   = value_write_text_simple(value, &new_data, text, 0U);
        new_size = base_size;
    } else if (is_vector) {
        // First figure out how many elements we have. We can do this by counting
        // each comma and ensuring no consecutive or padding comma's.
        // This should be faster than multiple mallocs as it requires no syscalls.
        size_t elements = 1UL;  // Always at least 1 element.

        // Check for malformed messages with "padding" commas (e.g., ",1,2,").
        if ((text[0] == ',') || (text[size - 2UL] == ',')) {
            status = EBADMSG;
            goto error;
        }
        for (size_t i = 1UL; i < (size - 1UL); i++) {
            if (text[i] == ',') {
                elements++;
                // Check for multiple commas.
                if (text[i + 1UL] == ',') {
                    status = EBADMSG;
                    goto error;
                }
            }
        }

        new_size   = base_size * elements;
        new_data.c = calloc(1, new_size);
        if (new_data.c == NULL) {
            status = ENOMEM;
            goto error;
        }

        // NOTE: this call consumes the string.
        char       *save_ptr = NULL;
        const char *vec_tok  = strtok_r(text, ",", &save_ptr);

        // Now run through all the elements iterating to the next string each time.
        for (size_t i = 0UL; i < elements; i++) {
            status = value_write_text_simple(value, &new_data, vec_tok, i);
            if (status != EOK) {
                break;
            } else {
                vec_tok = strtok_r(NULL, ",", &save_ptr);
            }
        }
    } else {
        QLOG_ERR("Unknown datatype!");
        status = ENOSYS;
        goto error;
    }

    if (status == EOK) {
        // We must release the existing data before storing new data for anything allocated.
        if (is_vector || (value->type == STRING)) {
            free(value->data.c);
        }
        (void)memcpy(&value->data, &new_data, sizeof(new_data));
        (void)memset(&new_data, 0, sizeof(new_data));
        value->nbytes = new_size;
    }

error:
    if (is_vector || ((value != NULL) && (value->type == STRING))) {
        free(new_data.c);
    }
    // Always consume the text even on failure.
    if (text_ptr != NULL) {
        free(*text_ptr);
        *text_ptr = NULL;
    }

    return status;
}

void value_cleanup(value_t *value) {
    if (NULL != value) {
        if (datatype_is_pointer(value->type)) {
            free(value->data.c);
            value->data.c = NULL;
        }

        if (pthread_rwlock_destroy(&value->rwlock) != EOK) {
            QLOG_WRN("Failed to destroy rwlock!");
        }
    }
}
