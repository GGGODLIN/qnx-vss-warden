/*
 * Copyright (c) 2025-2026, BlackBerry Limited. All rights reserved.
 *
 * BlackBerry Limited and its licensors  retain all intellectual property and
 * proprietary rights in and to this software and related documentation.  Any
 * use, reproduction, disclosure or distribution of this software and related
 * documentation without an express license agreement from BlackBerry Limited
 * is strictly prohibited.
 */

#ifndef VALUE_H
#define VALUE_H

/***********************************************************************************************
 * The Value Node definition.
 **********************************************************************************************/

#include <pthread.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <sys/json.h>

// Supported datatypes.
typedef enum {
    UNDEFINED,
    BOOLEAN,
    INT8,
    INT16,
    INT32,
    INT64,
    UINT8,
    UINT16,
    UINT32,
    UINT64,
    FLOAT,
    DOUBLE,
    STRING,
    BINARY,
    VECTOR_BOOLEAN,
    VECTOR_INT8,
    VECTOR_INT16,
    VECTOR_INT32,
    VECTOR_INT64,
    VECTOR_UINT8,
    VECTOR_UINT16,
    VECTOR_UINT32,
    VECTOR_UINT64,
    VECTOR_FLOAT,
    VECTOR_DOUBLE,
    VECTOR_STRING
} datatype_t;

#define DATATYPE_MIN UNDEFINED
#define DATATYPE_MAX VECTOR_STRING

#define DATATYPE_VECTOR_MIN VECTOR_BOOLEAN
#define DATATYPE_VECTOR_MAX VECTOR_STRING

#define DATATYPE_SCALER_MIN BOOLEAN
#define DATATYPE_SCALER_MAX BINARY

// Union of all supported datatypes.
typedef union {
    bool      b;
    int8_t    i8;
    int16_t   i16;
    int32_t   i32;
    int64_t   i64;
    uint8_t   u8;
    uint16_t  u16;
    uint32_t  u32;
    uint64_t  u64;
    float     f;
    double    d;
    void     *bin;
    char     *c;
    bool     *v_b;
    int8_t   *v_i8;
    int16_t  *v_i16;
    int32_t  *v_i32;
    int64_t  *v_i64;
    uint8_t  *v_u8;
    uint16_t *v_u16;
    uint32_t *v_u32;
    uint64_t *v_u64;
    float    *v_f;
    double   *v_d;
    char     *v_c;  // Array of null terminated strings.
} value_data_t;

typedef struct {
    pthread_rwlock_t rwlock;
    datatype_t       type;
    value_data_t     data;
    size_t           nbytes;
} value_t;

/**
 * Sets the value from a JSON value.
 *
 * @note This assumes the json decoder already points to the desired value to be stored in value.
 *
 * @param dec Decoder pointing to the value to be decoded.
 * @param value The value that will store the result.
 *
 * @return EOK on success, otherwise an appropriate error code.
 */
int32_t value_set_from_json(json_decoder_t *dec, value_t *value);

/**
 * Returns the associated datatype from a string.
 *
 * @param str String name of datatype.
 *
 * @return Datatype on success, UNDEFINED datatype on failure.
 */
datatype_t value_datatype_from_str(const char *str);

/**
 * Returns the string name of a datatype.
 *
 * @param type The datatype.
 *
 * @return String name of the datatype on success or "undefined" in all other cases.
 */
const char *value_datatype_to_str(datatype_t type);

/**
 * Returns the internal buffer of a given value.
 *
 * @note the value should be locked before doing this operation.
 *
 * @param value The value to retrieve.
 * @param[out] buf Which is updated to contain the binary representation.
 * @param[out] size The size of buf in bytes.
 *
 * @return EOK on success, otherwise an appropriate error code.
 */
int32_t value_as_binary(value_t *value, void **buf, size_t *size);

/**
 * Converts the value into text.
 *
 * @note text will contain an allocated value which must be freed after use.
 *
 * @param value Value which is converted to text.
 * @param[out] text Pointer which is updated to contain the text representation of the value.
 * @param[out] size The size of the text representation including NULL terminator.
 *
 * @return EOK on success, otherwise an appropriate error code.
 */
int32_t value_as_text(value_t *value, char **text, size_t *size);

/**
 * Write a value in binary form.
 *
 * @note the value should be locked before doing this operation.
 *
 * @param value Value which will be written to.
 * @param buf_ptr The data to write, which will be consumed by the value.
 * @param size The size of the data to write.
 *
 * @return EOK on success, otherwise an appropriate error code.
 */
int32_t value_write_binary(value_t *value, void **buf_ptr, size_t size);

/**
 * Write a value in text form.
 *
 * @note the value should be locked before doing this operation.
 *
 * @param value Value which will be written to.
 * @param text_ptr Pointer to the text which is converted to binary form and written into the value.
 *                 Note, this text is consumed by this call.
 * @param size The size of the text payload including the null terminator.
 *
 * @return EOK on success, otherwise an appropriate error code.
 */
int32_t value_write_text(value_t *value, char **text_ptr, size_t size);

/**
 * @brief Clean up any resources associated with the value_t object.
 *
 * @param value The value object to clean up.
 *
 */
void value_cleanup(value_t *value);

#endif  // VALUE_H
