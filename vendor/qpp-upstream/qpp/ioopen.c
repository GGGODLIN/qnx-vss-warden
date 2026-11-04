/*
 * Copyright (c) 2024-2026, BlackBerry Limited. All rights reserved.
 *
 * BlackBerry Limited and its licensors  retain all intellectual property and
 * proprietary rights in and to this software and related documentation.  Any
 * use, reproduction, disclosure or distribution of this software and related
 * documentation without an express license agreement from BlackBerry Limited
 * is strictly prohibited.
 */

#include <fcntl.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <qpp/qlog.h>

#include "connect_funcs.h"
#include "io_funcs.h"
#include "node.h"
#include "resmgr_attrs.h"
#include "tree.h"

/**
 * When opening a path, different modifiers can be used to control where the path should get
 * redirected before finishing the path resolution.
 *
 * @note If no modifier is given then OP_MODE_REGULAR is assumed. Multiple redirect paths will cause a failure.
 */
typedef enum {
    OP_MODE_REG,
    OP_MODE_CTRL,
    OP_MODE_META
} op_mode_type_t;

typedef struct {
    op_mode_type_t redirect;
    bool           text_mode;
    datatype_t     expected_datatype;
    char          *path;
    char          *metadata_attr;
} io_path_info_t;

/**
 * @brief Creates and attaches the OCB using the given iofunc handlers.
 *
 * @param ctp Context provided by resource manager interface.
 * @param msg io_open message containing path.
 * @param iofuncs Which io_funcs should be used for the open OCB. This can either be the text or binary interface.
 * @param node Which node is the OCB attaching to.
 *
 * @return EOK on success, otherwise an appropriate error code.
 */
static int open_handler(resmgr_context_t *ctp, io_open_t *msg, const resmgr_io_funcs_t *iofuncs, node_t *node) {
    node_lock(node);
    int status = iofunc_open(ctp, msg, &node->dattr.attr, NULL, NULL);
    if (status != EOK) {
        goto end;
    }
    // Create the OCB and add a reference to the associated node.
    IOFUNC_OCB_T *new_ocb = iofunc_ocb_calloc(ctp, &node->dattr);
    if (NULL == new_ocb) {
        QLOG_ERR("Failed to allocate ocb for node %s!", node->path);
        status = ENOMEM;
        goto end;
    }
    new_ocb->node = node;
    status        = iofunc_ocb_attach(ctp, msg, &new_ocb->base_ocb, &node->dattr.attr, iofuncs);
    if (status != EOK) {
        QLOG_ERR("Failed to attach ocb for node %s!", node->path);
    }
end:
    node_unlock(node);
    return status;
}

/**
 * @brief Parses the path from an io-open call.
 *
 * @param path_info Filled with information interpreted from the provided path.
 * @param path Path containing encoded information.
 * @param path_len Size of path not including null terminator.
 *
 * @return EOK on success, otherwise an appropriate error code.
 */
static int32_t parse_path(io_path_info_t *path_info, const char *path, int path_len) {
    int32_t    status        = EOK;
    const char path_delim[2] = "?";
    const char mod_delim[2]  = ",";
    char      *save_ptr      = NULL;
    char      *mod_string    = NULL;

    if ((path_info == NULL) || (path == NULL)) {
        status = EINVAL;
        goto end;
    }

    path_info->path = strndup(path, (size_t)path_len);
    if (path_info->path == NULL) {
        status = ENOMEM;
        goto end;
    }

    // Skip the first one as it is always the path.
    (void)strtok_r(path_info->path, path_delim, &save_ptr);
    char *tok = strtok_r(NULL, path_delim, &save_ptr);
    if (tok != NULL) {
        // The path has a modifier. Save it and ensure no other '?' characters exist.
        mod_string = tok;
        if (strtok_r(NULL, path_delim, &save_ptr) != NULL) {
            QLOG_WRN("Invalid path contains mutiple '?' modifier characters: %*s", path_len, path);
            status = EINVAL;
            goto end;
        }

        // Now split the modifiers again by comma.
        tok = strtok_r(mod_string, mod_delim, &save_ptr);
        do {
            if (strcmp(tok, "text") == 0) {
                if (!path_info->text_mode) {
                    path_info->text_mode = true;
                } else {
                    QLOG_WRN("Invalid path=%s: Only one \"text\" modifier is allowed.", path_info->path);
                    status = EINVAL;
                }
            } else if (strcmp(tok, "control") == 0) {
                if (path_info->redirect == OP_MODE_REG) {
                    path_info->redirect = OP_MODE_CTRL;
                } else {
                    QLOG_WRN("Invalid path=%s: Only one redirect modifier is allowed.", path_info->path);
                    status = EINVAL;
                }
            } else if (strcmp(tok, "metadata") == 0) {
                if (path_info->redirect == OP_MODE_REG) {
                    path_info->redirect = OP_MODE_META;
                } else {
                    QLOG_WRN("Invalid path=%s: Only one redirect modifier is allowed.", path_info->path);
                    status = EINVAL;
                }
            } else if (strncmp(tok, "metadata=", sizeof("metadata=") - 1UL) == 0) {
                if (path_info->redirect == OP_MODE_REG) {
                    path_info->redirect      = OP_MODE_META;
                    path_info->metadata_attr = strdup(tok + (sizeof("metadata=") - 1UL));
                } else {
                    QLOG_WRN("Invalid path=%s: Only one redirect modifier is allowed.", path_info->path);
                    status = EINVAL;
                }
            } else if (strncmp(tok, "datatype=", sizeof("datatype=") - 1UL) == 0) {
                if (path_info->expected_datatype == UNDEFINED) {
                    const char *datatype         = tok + (sizeof("datatype=") - 1UL);
                    path_info->expected_datatype = value_datatype_from_str(datatype);
                    if (path_info->expected_datatype == UNDEFINED) {
                        QLOG_WRN("Unknown datatype=%s used in open()", datatype);
                        status = EINVAL;
                    }
                } else {
                    QLOG_WRN("Invalid path=%s: Multiple datatype modifiers found", path_info->path);
                    status = EINVAL;
                }
            } else {
                QLOG_WRN("Unknown modifier=%s token in open()", tok);
                status = EINVAL;
            }
            tok = strtok_r(NULL, mod_delim, &save_ptr);
        } while ((tok != NULL) && (status == EOK));
    }

end:
    return status;
}

/**
 * @brief Create a new node.
 *
 * @param ctp Context provided by resource manager interface.
 * @param msg io_open message.
 * @param path_info Information about the node to be created.
 * @param node A pointer to hold a reference to the newly created node.
 *
 * @return EOK on success ("node" points to the new node), otherwise an appropriate error code.
 */
static int32_t create_dynamic_node(resmgr_context_t *ctp, io_open_t *msg, const io_path_info_t *path_info,
                                   node_t **node) {
    int     status       = EOK;
    char   *metadata_str = NULL;
    node_t *parent       = NULL;
    char   *parent_path  = NULL;

    // Default to the binary datatype if no datatype was given.
    const char *datatype_str = "binary";
    if (path_info->expected_datatype != UNDEFINED) {
        datatype_str = value_datatype_to_str(path_info->expected_datatype);
    }

    if (!node_is_valid_path(path_info->path)) {
        status = EINVAL;
        goto cleanup;
    }

    status = tree_get_parent_by_path(path_info->path, &parent);
    if (status != EOK) {
        goto cleanup;
    }

    // Validate they have permission to create the file in the parent dir.
    status = iofunc_open(ctp, msg, NULL, &parent->dattr.attr, NULL);
    if (status != EOK) {
        goto cleanup;
    }

    // Create the node.
    const char *metadata_fmt_str = "{\n  \"datatype\":\"%s\",\n  \"type\":\"topic\"\n}\n";
    metadata_str                 = malloc(strlen(datatype_str) + strlen(metadata_fmt_str) + 1);
    if (metadata_str == NULL) {
        status = ENOMEM;
        goto cleanup;
    }

    // Create value and metadata nodes. Metadata will always have static permissions but value will use provided
    // permissions.
    (void)sprintf(metadata_str, metadata_fmt_str, datatype_str);
    node_t *new_m_node = create_value_metadata_node(path_info->path, s_mode_metadata, metadata_str);
    node_t *new_node   = create_value_node(path_info->path, datatype_str, (msg->connect.mode & 0777) | S_IFREG);
    if ((new_m_node == NULL) || (new_node == NULL)) {
        metadata_node_cleanup(new_m_node);
        value_node_cleanup(new_node);
        free(new_node);
        free(new_m_node);
        status = EINVAL;
        goto cleanup;
    }
    new_node->smart_tree_ctrl.meta = new_m_node;

    status = tree_insert_node(new_node);
    if (status != EOK) {
        goto cleanup;
    }

    status = tree_insert_node(new_m_node);
    if (status != EOK) {
        new_node->smart_tree_ctrl.deleted = true;
        tree_node_release(new_node);
        goto cleanup;
    }

    // Acquire the node. This can't fail as it was just created and the parent directory is locked.
    (void)node_acquire(new_node);

    *node = new_node;

cleanup:
    free(parent_path);
    free(metadata_str);
    tree_node_release(parent);
    return status;
}

/**
 * @brief Find the metadata attribute value requested by the client and store it in the OCB for use during the read.
 *
 * @param ctp Context provided by resource manager interface.
 * @param node The metadata node to retrieve the attribute value from.
 * @param path_info Contains the metadata attribute name that the client is looking for.
 *
 * @return EOK on success, otherwise an appropriate error code.
 */
static int32_t set_metadata_value(resmgr_context_t *ctp, node_t *node, const io_path_info_t *path_info) {
    int32_t       status  = EOK;
    IOFUNC_OCB_T *new_ocb = NULL;
    int           result  = resmgr_ocb_iofuncs(ctp, (void **)&new_ocb, NULL);
    if (result == 0) {
        char *value = NULL;
        status      = get_metadata_value(node->type.metadata.metadata, path_info->metadata_attr, &value);
        if (status == EOK) {
            QLOG_DBG2("read metadata specific attribute: %s, value: %s", path_info->metadata_attr, value);
            new_ocb->ref.metadata_value = value;
        }
    } else {
        status = errno;
    }
    return status;
}

// Open handler.
int io_open(resmgr_context_t *ctp, io_open_t *msg, RESMGR_HANDLE_T *handle, void *extra) {
    (void)extra;
    QLOG_DBG1("open(%*s)", (int)msg->connect.path_len, msg->connect.path);
    int path_len = (int)msg->connect.path_len;

    node_t        *node      = NULL;
    int32_t        status    = ENOENT;
    io_path_info_t path_info = {.metadata_attr = NULL, .path = NULL, .redirect = OP_MODE_REG, .text_mode = false};
    status                   = parse_path(&path_info, msg->connect.path, path_len);
    if (status != EOK) {
        QLOG_WRN("Failed to open path=%*s with: %s", path_len, msg->connect.path, strerror(status));
        goto cleanup_and_release;
    }

    status = tree_get_node_by_path(path_info.path, &node);  // acquires "node". Must call tree_node_release()
    if (status == EOK) {
        // If O_CREAT is used with O_EXCL it means they want to create the file but it already exists
        // so just reject the call.
        if (((msg->connect.ioflag & O_CREAT) != 0) && ((msg->connect.ioflag & O_EXCL) != 0)) {
            status = EEXIST;
            goto cleanup_and_release;
        }

        // Ensure the datatype is correct. Do this before redirect.
        if ((path_info.expected_datatype != UNDEFINED)
            && ((node->filetype != VALUE) || (node->type.value.type != path_info.expected_datatype))) {
            QLOG_WRN("Failed to open path=%*s with: Provided datatype doesn't match", path_len, msg->connect.path);
            status = EINVAL;
            goto cleanup_and_release;
        }
    } else if (((msg->connect.ioflag & O_CREAT) != 0) && g_dynamic_creation) {
        status = create_dynamic_node(ctp, msg, &path_info, &node);
        if (status != EOK) {
            goto cleanup_and_release;
        }
    } else {
        QLOG_WRN("Node not found: %s", path_info.path);
        goto cleanup_and_release;
    }

    // Do redirect logic after creation so they can redirect to different nodes.
    if (path_info.redirect != OP_MODE_REG) {
        // Lock the parent when doing the redirect.
        node_lock(node->smart_tree_ctrl.parent);
        node_t *redirect_node = NULL;
        if (path_info.redirect == OP_MODE_META) {
            redirect_node = node->smart_tree_ctrl.meta;
        }

        if (path_info.redirect == OP_MODE_CTRL) {
            redirect_node = node->smart_tree_ctrl.ctrl;
        }

        // It's possible the redirect node doesn't exist or was marked as deleted in which case acquire will fail.
        if ((redirect_node != NULL) && !node_acquire(redirect_node)) {
            redirect_node = NULL;  // in the case of deleted mimic node DNE.
        }

        // Unlock parent before tree_node_release in case it gets deleted.
        node_unlock(node->smart_tree_ctrl.parent);

        // Release the old node.
        tree_node_release(node);
        node = redirect_node;
    }

    // This will only happen if redirect points to an invalid node (i.e value file doesn't have an associated control).
    if (node == NULL) {
        QLOG_WRN("Failed to open path=%*s with redirect", (int)msg->connect.path_len, msg->connect.path);
        status = ENOENT;
        goto cleanup_and_release;
    }

    QLOG_DBG1("Found node entry. inode: %lu, textmode=%s, filetype=%d", node->dattr.attr.inode,
              (path_info.text_mode ? "True" : "False"), node->filetype);

    // Assign the required set of iofuncs:
    // Binary Read mode: (most common use case)
    //      1. Value files (not opened with "?text")
    // Directory Read Mode:
    //      1. Reading Directory entries
    // Text Read Mode:
    //      1. Metadata files
    //      2. Value files opened with "?text"
    if ((node->filetype == VALUE) && !path_info.text_mode) {
        QLOG_DBG1("Opening value file in \"BIN Access Mode\": %s", node->path);
        status = open_handler(ctp, msg, &g_io_funcs_bin, node);
    } else if (node->filetype == DIRECTORY) {
        QLOG_DBG1("Opening directory: %s", node->path);
        status = open_handler(ctp, msg, &g_io_funcs_dir, node);
    } else {
        QLOG_DBG1("Opening value or metadata file in \"text Access Mode\": %s", node->path);
        status = open_handler(ctp, msg, &g_io_funcs_text, node);
        if ((status == EOK) && (path_info.metadata_attr != NULL)) {
            status = set_metadata_value(ctp, node, &path_info);
            if (status != EOK) {
                // Failed to get metadata. Since this will fail the open call with the OCB already created,
                // the io_close_ocb() and iofunc_ocb_free() functions will get called to clean up. io_close_ocb() will
                // handle the tree_node_release() for this node so we must not do it here.
                goto cleanup;
            }
        }
    }

cleanup_and_release:
    // Failed open. Release the node so we don't leave a dangling reference.
    if (status != EOK) {
        tree_node_release(node);
    }

cleanup:
    free(path_info.path);
    free(path_info.metadata_attr);
    return status;
}
