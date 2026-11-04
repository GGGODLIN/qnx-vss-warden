/*
 * Copyright (c) 2025-2026, BlackBerry Limited. All rights reserved.
 *
 * BlackBerry Limited and its licensors  retain all intellectual property and
 * proprietary rights in and to this software and related documentation.  Any
 * use, reproduction, disclosure or distribution of this software and related
 * documentation without an express license agreement from BlackBerry Limited
 * is strictly prohibited.
 */

#include "catalog.h"

#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/json.h>
#include <unistd.h>

#include <qpp/qlog.h>

#include "node.h"
#include "tree.h"
#include "utils/utils.h"

// VSS node common properties
static const char *s_vss_type_str = "type";

// VSS node branch properties
static const char *s_vss_children_str = "children";

// VSS node leaf properties
static const char *s_vss_datatype_str = "datatype";
static const char *s_vss_default_str  = "default";

// VSS node types
static const char *s_vss_actuator_str  = "actuator";
static const char *s_vss_attribute_str = "attribute";
static const char *s_vss_branch_str    = "branch";
static const char *s_vss_sensor_str    = "sensor";

static int32_t process_branch(json_decoder_t *decoder, const char *path, const char *name);
static int32_t process_metadata(json_decoder_t *decoder, const char *path, const char *name, const bool is_leaf,
                                node_t **m_node);
static int32_t process_branch_metadata(json_decoder_t *decoder, const char *path, const char *name, node_t **m_node);

int32_t process_catalog(const char *catalog_path) {
    int32_t         status  = EOK;
    json_decoder_t *decoder = json_decoder_create();
    if (decoder == NULL) {
        QLOG_ERR("Failed to create JSON decoder");
        status = ENOMEM;
        goto end;
    }

    if (NULL == catalog_path) {
        QLOG_ERR("NULL catalog path!");
        status = EINVAL;
        goto end;
    }

    QLOG_NTC("Starting %s using signal catalog %s.", SERVICE_NAME, catalog_path);

    // Parse the catalog file
    json_decoder_error_t err = json_decoder_parse_file(decoder, catalog_path);
    if (err == JSON_DECODER_PARSE_ERROR) {
        const char                *err_str   = NULL;
        int                        loc       = -1;
        json_decoder_parse_error_t parse_err = json_decoder_get_parse_error(decoder, &loc, &err_str);
        QLOG_ERR("Decoder parse error: %s (%d), offset in file %d", err_str, parse_err, loc);
        status = EINVAL;
        goto end;
    }
    if (err != JSON_DECODER_OK) {
        QLOG_ERR("Failed to parse the Signal Catalog. json error: %d", err);
        status = EIO;
        goto end;
    }

    // Navigate to root object
    err = json_decoder_push_object(decoder, NULL, false);
    if (err != JSON_DECODER_OK) {
        QLOG_ERR("Failed to push into root object. json error:  %d", err);
        status = EIO;
        goto end;
    }

    // Get catalog root node name
    const char *name = json_decoder_name(decoder);
    if (name == NULL) {
        QLOG_ERR("Failed to get root node name");
        status = ENODATA;
        goto end;
    }

    // Navigate to root node
    err = json_decoder_push_object(decoder, name, false);
    if (err != JSON_DECODER_OK) {
        QLOG_ERR("Failed to push into root node. json error:  %d", err);
        status = EIO;
        goto end;
    }

    // Get root node type
    const char *root_type = NULL;
    err                   = json_decoder_get_string(decoder, s_vss_type_str, &root_type, false);
    if (err != JSON_DECODER_OK) {
        QLOG_ERR("Failed to get root node type. json error:  %d", err);
        status = ENODATA;
        goto end;
    }

    // Validate root node type
    if (strcmp(root_type, s_vss_branch_str) != 0) {
        QLOG_ERR("Catalog root node (type '%s') should be a %s.", root_type, s_vss_branch_str);
        status = EINVAL;
        goto end;
    }
    status = process_branch(decoder, name, name);

end:
    json_decoder_destroy(decoder);
    return status;
}

/**
 * @brief Process a branch of the tree.
 *
 * Note: Nodes are added to the tree on the fly. If catalog parsing fails, the
 * caller is responsible for cleaning up the tree.
 *
 * @param decoder JSON decoder.
 * @param path Node path.
 * @param name Name of the node.
 * @return EOK for success, specific errno for failures.
 */
static int32_t process_branch(json_decoder_t *decoder, const char *path, const char *name) {
    int32_t status  = EOK;
    char   *newpath = NULL;

    // Parameter validation
    if ((decoder == NULL) || (path == NULL) || (name == NULL)) {
        QLOG_ERR("NULL parameter provided");
        status = EINVAL;
        goto end;
    }

    if ((path[0] == '\0') || (name[0] == '\0')) {
        QLOG_ERR("Empty path or name provided");
        status = EINVAL;
        goto end;
    }

    QLOG_DBG2("Processing Branch %s", path);

    // Create branch node (insert will fail if creation failed)
    node_t *branch_node = create_dir_node(path, s_mode_dir);
    status              = tree_insert_node(branch_node);
    if (status != EOK) {
        QLOG_ERR("Failed to create director node for %s", path);
        dir_node_cleanup(branch_node);
        free(branch_node);
        goto end;
    }
    QLOG_DBG1("Created branch node: %s", path);

    // DESCEND into "children" list
    json_decoder_error_t err = json_decoder_push_object(decoder, s_vss_children_str, false);
    if (err != JSON_DECODER_OK) {
        QLOG_ERR("Node '%s' doesn't have a '%s' node", path, s_vss_children_str);
        status = ENOENT;
        goto end;
    }

    int num_children = json_decoder_length(decoder);
    QLOG_DBG2("Node '%s' has %d children", path, num_children);

    const char *child_name = NULL;
    const char *child_type = NULL;

    for (int i = 0; i < num_children; i++) {
        child_name = json_decoder_name(decoder);
        if (child_name == NULL) {
            QLOG_ERR("Failed to get child name");
            status = ENODATA;
            goto end;
        }
        QLOG_DBG2("Processing child %d: %s (under path %s)", i + 1, child_name, path);

        // Calculate path for child
        size_t len  = strlen(path) + strlen(child_name) + 2;  // incl. '/' and '\0'
        char  *temp = realloc(newpath, len);
        if (NULL == temp) {
            QLOG_ERR("Failed to allocate memory for path to child: %s", child_name);
            status = ENOMEM;
            goto end;
        }
        newpath = temp;

        int ret = snprintf(newpath, len, "%s/%s", path, child_name);
        if ((ret < 0)) {
            QLOG_ERR("Failed to format path string");
            status = EIO;
            goto end;
        }
        QLOG_DBG2("Path is: %s", newpath);

        // DESCEND into child_name node
        err = json_decoder_push_object(decoder, child_name, false);
        if (err != JSON_DECODER_OK) {
            QLOG_ERR("Failed to push into child node: %d", err);
            status = EIO;
            goto end;
        }

        // GET "type" and POINT to next property (or NULL, if reached the end)
        err = json_decoder_get_string(decoder, s_vss_type_str, &child_type, false);
        if (err != JSON_DECODER_OK) {
            QLOG_ERR("Failed to find type for child '%s': %d", child_name, err);
            status = ENODATA;
            goto end;
        }

        if (strcmp(child_type, s_vss_branch_str) == 0) {
            QLOG_DBG2("Handling BRANCH node '%s', under '%s'", child_name, path);
            status = process_branch(decoder, newpath, child_name);
            if (status != EOK) {
                QLOG_ERR("Failed to process branch node '%s', path: %s, error: %d", child_name, newpath, status);
                goto end;
            }

            // ASCEND from inside child_name (back to "children" list) and
            // POINT to next sibling (or NULL, if reached the end)
            err = json_decoder_pop(decoder);
            if (err != JSON_DECODER_OK) {
                QLOG_ERR("Failed to pop from branch: %d", err);
                status = EIO;
                goto end;
            }

        } else if ((strcmp(child_type, s_vss_actuator_str) == 0) || (strcmp(child_type, s_vss_attribute_str) == 0)
                   || (strcmp(child_type, s_vss_sensor_str) == 0)) {
            QLOG_DBG2("Handling LEAF node '%s', under '%s'", child_name, path);

            const char *datatype = NULL;
            err                  = json_decoder_get_string(decoder, s_vss_datatype_str, &datatype, false);
            if (err != JSON_DECODER_OK) {
                QLOG_ERR("Failed to get node 'datatype' for %s.", newpath);
                status = ENODATA;
                goto end;
            }
            // Create Value node (insert will fail if creation failed)
            node_t *f_node = create_value_node(newpath, datatype, s_mode_file);
            status         = tree_insert_node(f_node);
            if (status != EOK) {
                QLOG_ERR("Failed to create value file for '%s'", child_name);
                value_node_cleanup(f_node);
                free(f_node);
                goto end;
            }

            // Set default.
            err = json_decoder_position_property(decoder, s_vss_default_str);
            if (err == JSON_DECODER_OK) {
                status = value_set_from_json(decoder, &f_node->type.value);
                if (status != EOK) {
                    QLOG_ERR("Failed to set default for '%s', error: %s", child_name, strerror(status));
                    goto end;
                }
                increment_version(&f_node->dattr.version);
                f_node->dattr.attr.nbytes = (off_t)f_node->type.value.nbytes;
            }

            // Create actuator control file if needed
            if (strcmp(child_type, s_vss_actuator_str) == 0) {
                node_t *act_node = create_control_node(newpath, datatype, s_mode_file);
                status           = tree_insert_node(act_node);
                if (status != EOK) {
                    QLOG_ERR("Failed to create actuator control file for '%s'", newpath);
                    value_node_cleanup(act_node);
                    free(act_node);
                    goto end;
                }
                f_node->smart_tree_ctrl.ctrl = act_node;
            }

            // FINISHED handling LEAF node, and now handling its metadata

            // ASCEND from inside child_name (back to "children" list) and
            // POINT to next sibling (or NULL, if reached the end)
            err = json_decoder_pop(decoder);
            if (err != JSON_DECODER_OK) {
                QLOG_ERR("Failed to pop from leaf: %d", err);
                status = EIO;
                goto end;
            }

            // Store metadata for leaf node
            QLOG_DBG2("Store metadata for leaf node: %s", child_name);
            status = process_metadata(decoder, newpath, child_name, true, &f_node->smart_tree_ctrl.meta);
            if (status != EOK) {
                QLOG_ERR("Failed to store metadata for leaf node %s, error: %d", child_name, status);
                goto end;
            }
        } else {
            QLOG_ERR("Node type '%s' is NOT supported.", child_type);
            status = EINVAL;
            goto end;
        }
    }

    // Reached END-OF-LIST of "children"

    // Store metadata for the branch node
    status = process_branch_metadata(decoder, path, name, &branch_node->smart_tree_ctrl.meta);
    if (status != EOK) {
        QLOG_ERR("Failed to store metadata for branch node %s, error: %d", path, status);
        goto end;
    }
    // DESCEND back into node_name at the nesting-level that we started at in handle_branch_node().
    err = json_decoder_push_object(decoder, NULL, false);
    if (err != JSON_DECODER_OK) {
        QLOG_ERR("Failed to push into branch: %d", err);
        status = EIO;
    }

end:
    free(newpath);
    return status;
}

/**
 * @brief Retrieve JSON metadata for a value node and create the metadata file.
 *
 * @param decoder JSON decoder.
 * @param path Node path.
 * @param name Node.
 * @param is_leaf True if this is the metadata for a value file. False for branch node.
 * @param m_node Created node on success, unchanged on failure.
 * @return EOK for success, specific errno for failures.
 */
static int32_t process_metadata(json_decoder_t *decoder, const char *path, const char *name, const bool is_leaf,
                                node_t **m_node) {
    int32_t         status  = EOK;
    json_encoder_t *encoder = NULL;

    // Parameter validation
    if ((decoder == NULL) || (path == NULL) || (name == NULL) || (m_node == NULL)) {
        QLOG_ERR("NULL parameter provided");
        status = EINVAL;
        goto end;
    }

    // Create JSON encoder
    encoder = json_encoder_create();
    if (encoder == NULL) {
        QLOG_ERR("Failed to create JSON encoder");
        status = ENOMEM;
        goto end;
    }

    // Set encoder options - this is a void function with no return value.
    json_encoder_set_option(encoder, JSON_ENCODER_AUTO_FORMAT);

    // SAVE the index of the node which the decoder is currently pointing at.
    int current_index = json_decoder_index(decoder);

    // POSITION the decoder at the node whose metadata we want to store.
    json_decoder_error_t err = json_decoder_position_property(decoder, name);
    if (err != JSON_DECODER_OK) {
        QLOG_ERR("Failed to position decoder at property '%s'. json error:  %d", name, err);
        status = ENOENT;
        goto end;
    }

    // Copy all properties from decoder to encoder
    json_encoder_error_t enc_err = json_encoder_add_from_decoder(encoder, NULL, decoder, NULL);
    if (enc_err != JSON_ENCODER_OK) {
        QLOG_ERR("Failed to add from decoder. json error:  %d", enc_err);
        status = EIO;
        goto end;
    }

    // Restore original decoder position
    err = json_decoder_position_index(decoder, current_index);
    if (err != JSON_DECODER_OK) {
        QLOG_ERR("Failed to restore decoder position. json error: %d", err);
        status = EIO;
        goto end;
    }

    // Check for errors
    if (json_decoder_get_status(decoder, true) != JSON_DECODER_OK) {
        QLOG_ERR("Decoder has errors");
        status = EIO;
        goto end;
    }

    // Get the encoded buffer
    const char *buf = json_encoder_buffer(encoder);
    if (buf == NULL) {
        QLOG_ERR("Failed to get encoder buffer");
        status = EIO;
        goto end;
    }

    node_t *metadata_node = NULL;
    if (is_leaf) {
        metadata_node = create_value_metadata_node(path, s_mode_metadata, buf);
    } else {
        metadata_node = create_dir_metadata_node(path, s_mode_metadata, buf);
    }
    status = tree_insert_node(metadata_node);
    if (status != EOK) {
        QLOG_ERR("Failed to create metadata file for '%s'", path);
        metadata_node_cleanup(metadata_node);
        free(metadata_node);
    } else {
        QLOG_DBG2("Created metadata node for %s.", path);
        *m_node = metadata_node;
    }

end:
    json_encoder_destroy(encoder);
    return status;
}

/**
 * @brief Retrieve JSON metadata for a branch node and create the metadata file.
 *
 * @param decoder JSON decoder.
 * @param path Node path.
 * @param name Node name.
 * @param m_node Created node on success, unchanged on failure.
 * @return EOK for success, specific errno for failures.
 */
static int32_t process_branch_metadata(json_decoder_t *decoder, const char *path, const char *name, node_t **m_node) {
    int32_t status = EOK;

    // Parameter validation
    if ((decoder == NULL) || (path == NULL) || (name == NULL) || (m_node == NULL)) {
        QLOG_ERR("NULL parameter provided");
        status = EINVAL;
        goto end;
    }

    // ASCEND from "children" list (back to parent branch)
    json_decoder_error_t err = json_decoder_pop(decoder);
    if (err != JSON_DECODER_OK) {
        QLOG_ERR("Failed to pop from children list. json error: %d", err);
        status = EIO;
        goto end;
    }

    // DELETE the "children" list of this branch from the Decoder
    // in preparation for storing the node's metadata.
    // When this function returns, the Decoder points inside the branch node.
    err = json_decoder_remove_node(decoder, s_vss_children_str);
    if (err != JSON_DECODER_OK) {
        QLOG_ERR("Failed to remove children node. json error: %d", err);
        status = EIO;
        goto end;
    }

    // ASCEND from inside the branch node (back to "children" list) and
    // POINT to next sibling (or NULL, if reached the end)
    err = json_decoder_pop(decoder);
    if (err != JSON_DECODER_OK) {
        QLOG_ERR("Failed to pop from node. json error: %d", err);
        status = EIO;
        goto end;
    }

    // Back up the Decoder to point back to the branch node
    // in preparation for storing the node's metadata.
    err = json_decoder_previous(decoder);
    if (err != JSON_DECODER_OK) {
        QLOG_ERR("Failed to move to previous node. json error: %d", err);
        status = EIO;
        goto end;
    }

    err = json_decoder_get_status(decoder, true);
    if (err != JSON_DECODER_OK) {
        QLOG_ERR("JSON decoder operation failed. json error: %d", err);
        status = EIO;
        goto end;
    }
    status = process_metadata(decoder, path, name, false, m_node);

end:
    return status;
}
