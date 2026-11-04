/*
 * Copyright (c) 2025, BlackBerry Limited. All rights reserved.
 *
 * BlackBerry Limited and its licensors  retain all intellectual property and
 * proprietary rights in and to this software and related documentation.  Any
 * use, reproduction, disclosure or distribution of this software and related
 * documentation without an express license agreement from BlackBerry Limited
 * is strictly prohibited.
 */

#include "metadata.h"

#include <errno.h>
#include <stdint.h>
#include <stdlib.h>
#include <sys/json.h>

#include <qpp/qlog.h>

void metadata_cleanup(metadata_t *metadata) {
    if (NULL != metadata) {
        free(metadata->metadata);
        metadata->metadata = NULL;
    }
}

int32_t get_metadata_value(const char *metadata, const char *attribute, char **value) {
    int32_t         status        = EOK;
    const char     *decoded_value = NULL;
    json_decoder_t *decoder       = NULL;

    if (NULL == attribute) {
        QLOG_WRN("NULL attribute pointer!");
        status = EINVAL;
    } else {
        decoder = json_decoder_create();
        if (decoder == NULL) {
            QLOG_WRN("Failed to create JSON decoder");
            status = ENOMEM;
            goto end;
        }
        json_decoder_error_t err = json_decoder_parse_json_str(decoder, metadata);
        if (err != JSON_DECODER_OK) {
            QLOG_WRN("Failed to parse the metadata. json error: %d", err);
            status = EINVAL;
            goto end;
        }
        err = json_decoder_push_object(decoder, NULL, false);
        if (err != JSON_DECODER_OK) {
            QLOG_WRN("Failed to push into metadata array. json error:  %d", err);
            status = EINVAL;
            goto end;
        }
        err = json_decoder_get_string(decoder, attribute, &decoded_value, false);
        if (err != JSON_DECODER_OK) {
            QLOG_WRN("Failed to get metadata attribute %s: %d", attribute, err);
            status = EINVAL;
            goto end;
        }
        *value = strdup(decoded_value);
        if (NULL == *value) {
            status = ENOMEM;
        }
    }
end:
    json_decoder_destroy(decoder);
    return status;
}
