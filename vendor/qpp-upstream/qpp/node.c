/*
 * Copyright (c) 2025, BlackBerry Limited. All rights reserved.
 *
 * BlackBerry Limited and its licensors  retain all intellectual property and
 * proprietary rights in and to this software and related documentation.  Any
 * use, reproduction, disclosure or distribution of this software and related
 * documentation without an express license agreement from BlackBerry Limited
 * is strictly prohibited.
 */

#include "node.h"

#include <libgen.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include <qpp/qlog.h>

#include "directory.h"
#include "inode.h"
#include "value.h"

static const char *s_control_path_suffix  = ".control";
static const char *s_metadata_path_suffix = ".metadata";
static const char *s_branch_metadata_name = ".branch_metadata";

static const char *get_name_from_path(const char *path);
static node_t     *create_node(const char *path, mode_t mode);
static node_t     *create_metadata_node(const char *path, mode_t mode, const char *metadata);
static void        common_node_cleanup(node_t *node);
static int32_t     get_hidden_filename(const char *value_path, const char *suffix, const size_t max_size,
                                       char *hidden_path);

/**
 * @brief Get the file or directory name from the path.
 *
 * @param path The path to process.
 *
 * @return The file or directory name, or NULL on error.
 */
static const char *get_name_from_path(const char *path) {
    const char *result = NULL;
    if (NULL == path) {
        QLOG_ERR("NULL parameter provided for path.");
        goto end;
    }

    result = strrchr(path, (int)'/');
    if (result != NULL) {
        result++;  // Increment past the "/"
    } else {
        result = path;
    }

end:
    return result;
}

/**
 * @brief Create a node object.
 *
 * @param path Path of the file or directory.
 * @param mode The mode to apply to the file or directory.
 *
 * @return The new node_t or NULL on error.
 */
static node_t *create_node(const char *path, mode_t mode) {
    // Parameter validation
    node_t *new_node = NULL;
    if ((path == NULL) || (path[0] == '\0')) {
        QLOG_ERR("Invalid path provided");
        goto end;
    }

    ino_t inode = get_inode();
    if (inode == INVALID_INODE) {
        QLOG_ERR("Failed to get inode");
        goto end;
    }

    new_node        = calloc(1, sizeof(node_t));
    char *node_path = strdup(path);
    if ((new_node == NULL) || (node_path == NULL)) {
        QLOG_ERR("Failed to allocate memory for node");
        free(new_node);
        free(node_path);
        new_node = NULL;
        goto end;
    }

    const char *node_name = get_name_from_path(node_path);
    iofunc_attr_init(&new_node->dattr.attr, mode, NULL, 0);
    new_node->dattr.version     = 0;
    new_node->dattr.attr.inode  = inode;
    new_node->dattr.attr.nbytes = 0;

    // 'name_bytes' must be the length excluding the null terminator.
    // This is later used in the dirent processing to supply d_namelen.
    new_node->name                      = node_name;
    new_node->name_bytes                = strlen(node_name);
    new_node->path                      = node_path;
    new_node->smart_tree_ctrl.next      = NULL;
    new_node->smart_tree_ctrl.parent    = NULL;
    new_node->smart_tree_ctrl.ctrl      = NULL;
    new_node->smart_tree_ctrl.meta      = NULL;
    new_node->smart_tree_ctrl.deleted   = false;
    new_node->smart_tree_ctrl.ref_count = 1;

end:
    return new_node;
}

node_t *create_dir_node(const char *path, mode_t mode) {
    // Use the mode provided, but ensure S_IFDIR is set.
    node_t *node = create_node(path, S_IFDIR | mode);
    if (node == NULL) {
        QLOG_ERR("Failed to create base node!");
        goto end;
    }

    node->filetype = DIRECTORY;
    node->cleanup  = dir_node_cleanup;
    node->dattr.attr.nlink++;  // Add a link for the directory's "." reference

end:
    return node;
}

node_t *create_dir_metadata_node(const char *path, mode_t mode, const char *metadata) {
    char    metadata_path[PATH_MAX];
    node_t *metadata_node = NULL;
    if (path == NULL) {
        QLOG_ERR("Failed to create dir with dir=NULL, invalid path.");
        goto end;
    }

    int ret = snprintf(metadata_path, sizeof(metadata_path), "%s/%s", path, s_branch_metadata_name);
    if (ret >= sizeof(metadata_path)) {
        QLOG_ERR("Failed to create dir=%s metadata, path too long.", path);
        goto end;
    }
    metadata_node = create_metadata_node(metadata_path, mode, metadata);

end:
    return metadata_node;
}

node_t *create_value_node(const char *path, const char *datatype, mode_t mode) {
    node_t *node = NULL;
    if ((NULL == path) || (NULL == datatype)) {
        QLOG_ERR("Failed to create value node. Invalid parameters!");
        goto end;
    }

    datatype_t dt = value_datatype_from_str(datatype);
    if (dt == UNDEFINED) {
        QLOG_ERR("Failed to create value node with invalid datatype!");
        goto end;
    }

    node = create_node(path, S_IFREG | mode);
    if (node == NULL) {
        QLOG_ERR("Failed to create base node!");
        goto end;
    }

    node->filetype        = VALUE;
    node->type.value.type = dt;
    node->cleanup         = value_node_cleanup;

    if (pthread_rwlock_init(&node->type.value.rwlock, NULL) != 0) {
        QLOG_ERR("Mutex init has failed. %s.", strerror(errno));
        node->cleanup(node);
        free(node);
        node = NULL;
    }

end:
    return node;
}

/**
 * @brief Get the hidden filename, given the value file path and the desired suffix.
 *
 * @param value_path The full path of the value file.
 * @param suffix The hidden file suffix (.control or .metadata)
 * @param max_size The size of the hidden_path buffer.
 * @param hidden_path On success, this will be populated with the hidden file path.
 *
 * @return EOK on success, otherwise an appropriate errno.
 */
static int32_t get_hidden_filename(const char *value_path, const char *suffix, const size_t max_size,
                                   char *hidden_path) {
    int32_t status = EOK;
    if ((NULL == value_path) || (NULL == suffix) || (NULL == hidden_path)) {
        status = EINVAL;
        goto end;
    }

    // + 2 for "." hidden file name prefix and NULL terminator
    int32_t new_name_length = strlen(value_path) + strlen(suffix) + 2;
    if (new_name_length > max_size) {
        QLOG_ERR("New filename is too long!");
        status = ENAMETOOLONG;
        goto end;
    }

    const char *value_name_ptr = strrchr(value_path, '/');
    if (NULL == value_name_ptr) {
        // No "/" found. Must be tree root node.
        value_name_ptr = value_path;
    } else {
        // Advance past the "/"
        value_name_ptr++;
    }
    int32_t dir_length = value_name_ptr - value_path;
    int     res = snprintf(hidden_path, new_name_length, "%.*s.%s%s", dir_length, value_path, value_name_ptr, suffix);
    if (res < 0) {
        QLOG_ERR("Failed to construct hidden file!");
        status = EINVAL;
        goto end;
    }

end:
    return status;
}

node_t *create_value_metadata_node(const char *path, mode_t mode, const char *metadata) {
    char    metadata_path[PATH_MAX] = {0};
    node_t *metadata_node           = NULL;
    int32_t status                  = get_hidden_filename(path, s_metadata_path_suffix, PATH_MAX, metadata_path);
    if (status == EOK) {
        metadata_node = create_metadata_node(metadata_path, mode, metadata);
    }
    return metadata_node;
}

node_t *create_control_node(const char *path, const char *datatype, mode_t mode) {
    char    control_path[PATH_MAX] = {0};
    node_t *control_node           = NULL;
    int32_t status                 = get_hidden_filename(path, s_control_path_suffix, PATH_MAX, control_path);
    if (status == EOK) {
        control_node = create_value_node(control_path, datatype, mode);
    }
    return control_node;
}

/**
 * @brief Create a Metadata File node object.
 *
 * @param path Path of the metadata file.
 * @param mode The mode to apply to the file.
 * @param metadata The metadata to hold in the file.
 *
 * @return The new node_t or NULL on error.
 */
static node_t *create_metadata_node(const char *path, mode_t mode, const char *metadata) {
    node_t *node = NULL;
    if (NULL == metadata) {
        QLOG_ERR("metadata is NULL!");
        goto end;
    }

    node = create_node(path, S_IFREG | mode);
    if (node == NULL) {
        QLOG_ERR("Failed to create metadata node!");
        goto end;
    }

    node->filetype               = METADATA;
    node->cleanup                = metadata_node_cleanup;
    node->type.metadata.metadata = strdup(metadata);
    if (NULL == node->type.metadata.metadata) {
        QLOG_ERR("Failed to set metadata for node!");
        metadata_node_cleanup(node);
        free(node);
        node = NULL;
        goto end;
    }

    node->type.metadata.nbytes = strlen(metadata) + 1UL;         // Count the NULL
    node->dattr.attr.nbytes    = (off_t)strlen(metadata) + 1UL;  // Count the NULL

end:
    return node;
}

void value_node_cleanup(node_t *node) {
    if (node != NULL) {
        value_cleanup(&node->type.value);
        common_node_cleanup(node);
    }
}

void metadata_node_cleanup(node_t *node) {
    if (node != NULL) {
        metadata_cleanup(&node->type.metadata);
        common_node_cleanup(node);
    }
}

void dir_node_cleanup(node_t *node) {
    if (node != NULL) {
        directory_cleanup(&node->type.dir);
        common_node_cleanup(node);
    }
}

static void common_node_cleanup(node_t *node) {
    if (node != NULL) {
        free(node->path);
        node->name = NULL;
        node->path = NULL;

        node->smart_tree_ctrl.next   = NULL;
        node->smart_tree_ctrl.parent = NULL;
    }
}

void node_lock(node_t *node) {
    int status = iofunc_attr_lock(&node->dattr.attr);
    if (status != EOK) {
        const size_t error_buffer_len = 64;
        char         error_buffer[error_buffer_len];
        (void)strerror_r(status, error_buffer, error_buffer_len);
        QLOG_ERR("Failed to lock node for %s! %s", node->path, error_buffer);
        abort();
    }
}

void node_unlock(node_t *node) {
    int status = iofunc_attr_unlock(&node->dattr.attr);
    if (status != EOK) {
        const size_t error_buffer_len = 64;
        char         error_buffer[error_buffer_len];
        (void)strerror_r(status, error_buffer, error_buffer_len);
        QLOG_ERR("Failed to unlock node for %s! %s", node->path, error_buffer);
        abort();
    }
}

bool node_is_valid_path(const char *path) {
    bool valid = true;
    if ((path == NULL) || (*path == '\0')) {
        valid = false;
        goto end;
    }

    for (const char *p = path; *p != '\0'; p++) {
        if ((*p == '?') || (*p == '.')) {
            valid = false;
            goto end;
        }
    }

end:
    if (!valid) {
        QLOG_WRN("Failed to create node=%s with: Invalid name format. Names cannot include '.' or '?'.",
                 (path == NULL) ? "<NULL>" : path);
    }
    return valid;
}
