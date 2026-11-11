/*
 * Copyright (c) 2025-2026, BlackBerry Limited. All rights reserved.
 *
 * BlackBerry Limited and its licensors  retain all intellectual property and
 * proprietary rights in and to this software and related documentation.  Any
 * use, reproduction, disclosure or distribution of this software and related
 * documentation without an express license agreement from BlackBerry Limited
 * is strictly prohibited.
 */

#ifndef NODE_H
#define NODE_H

/***********************************************************************************************
 * The Node definition.
 **********************************************************************************************/

#include <stdatomic.h>
#include <stddef.h>
#include <stdlib.h>

#include <qpp/qlog.h>

#include "directory.h"
#include "metadata.h"
#include "resmgr_attrs.h"
#include "value.h"

struct node_s;

typedef enum {
    VALUE,  // Actuator Control Files are treated as VALUE files.
    METADATA,
    DIRECTORY
} filetype_t;

typedef struct node_s {
    const char   *name;        // points to index in path.
    size_t        name_bytes;  // length of name excluding the null terminator
    char         *path;
    device_attr_t dattr;

    struct {
        // node pointers are protected by parent's node lock (iofunc_attr_lock)
        struct node_s *next;    // Contains the next node in the directory
        struct node_s *parent;  // Parent of the node (NULL for tree root node).

        // Redirect node which allow for easy access to related nodes.
        struct node_s *meta;  // Optional metadata node of current node.
        struct node_s *ctrl;  // Optional control node of current node.

        // Node will be cleaned up when deleted and ref count becomes 0.
        _Atomic bool     deleted;
        _Atomic uint16_t ref_count;
    } smart_tree_ctrl;

    void (*cleanup)(struct node_s *);  // The function used to clean up a Dir, Value, or Metadata Node.
    filetype_t filetype;
    union {
        value_t     value;     // For sensor value
        metadata_t  metadata;  // For Metadata
        directory_t dir;       // For Directories
    } type;
} node_t;

/**
 * @brief Create a Directory node object.
 *
 * @param path Path of the directory. Should be checked with node_is_valid_path()
 * @param mode The mode to apply to the file or directory.
 *
 * @return The new node_t or NULL on error.
 */
node_t *create_dir_node(const char *path, mode_t mode);

/**
 * @brief Create a Directory Metadata File node object.
 *
 * @param path Path of the directory. Should be checked with node_is_valid_path()
 * @param mode The mode to apply to the file.
 * @param metadata The metadata to hold in the file. The node assumes ownership.
 *
 * @return The new node_t or NULL on error.
 */
node_t *create_dir_metadata_node(const char *path, mode_t mode, const char *metadata);

/**
 * @brief Create a Value File node object.
 *
 * @param path Path of the value file. Should be checked with node_is_valid_path()
 * @param mode The mode to apply to the file.
 * @param datatype The datatype of the Value.
 *
 * @return The new node_t or NULL on error.
 */
node_t *create_value_node(const char *path, const char *datatype, mode_t mode);

/**
 * @brief Create a Value Metadata File node object.
 *
 * @param path Path of the value file. Should be checked with node_is_valid_path()
 * @param mode The mode to apply to the file.
 * @param metadata The metadata to hold in the file. The node assumes ownership.
 *
 * @return The new node_t or NULL on error.
 */
node_t *create_value_metadata_node(const char *path, mode_t mode, const char *metadata);

/**
 * @brief Create a Control File node object.
 *
 * @param path Path of the value file associated with this control file. Should be checked with node_is_valid_path()
 * @param datatype The datatype of the control value.
 * @param mode The mode to apply to the file.
 *
 * @return The new node_t or NULL on error.
 */
node_t *create_control_node(const char *path, const char *datatype, mode_t mode);

/**
 * @brief Free the resources associated with a Directory Node.
 *
 * @param node The node to free. (node is consumed)
 *
 */
void dir_node_cleanup(node_t *node);

/**
 * @brief Free the resources associated with a Value Node.
 *
 * @param node The node to free. (node is consumed)
 *
 */
void value_node_cleanup(node_t *node);

/**
 * @brief Free the resources associated with a Metadata Node.
 *
 * @param node The node to free. (node is consumed)
 *
 */
void metadata_node_cleanup(node_t *node);

/**
 * @brief Lock the node.
 *
 * NOTE: The node must be valid. Should this fail the service is shut down.
 *
 * @param node The node to lock.
 *
 */
void node_lock(node_t *node);

/**
 * @brief Unlock the node.
 *
 * NOTE: The node must be valid. Should this fail the service is shut down.
 *
 * @param node The node to unlock.
 *
 */
void node_unlock(node_t *node);

/**
 * @brief Acquires a node by incrementing the ref count
 *
 * @param node node to be acquired.
 *
 * @return True if the node was acquired, false otherwise.
 */
static inline bool node_acquire(node_t *node) {
    bool acquired = false;
    if ((node != NULL) && !node->smart_tree_ctrl.deleted) {
        while (true) {
            uint16_t count = atomic_load(&node->smart_tree_ctrl.ref_count);
            if (count == 0) {
                // No longer exists. Though this should be impossible.
                QLOG_ERR("INTERNAL ERROR: Acquired a node with ref_count=0 which wasn't marked as deleted.");
                break;
            }
            if (atomic_compare_exchange_strong(&node->smart_tree_ctrl.ref_count, &count, count + 1U)) {
                acquired = true;
                break;
            }
        }
    }
    return acquired;
}

/**
 * @brief Releases a acquired node and returns what the new ref count is.
 *
 * @param node node to be released.
 *
 * @return Returns the new ref_count of the node after release,
 *          or 0 if node is NULL.
 */
static inline uint16_t node_release(node_t *node) {
    uint16_t count = 1;
    if (node != NULL) {
        while (true) {
            count = atomic_load(&node->smart_tree_ctrl.ref_count);
            if (count == 0U) {
                // This is a fatal error. Someone is trying to release a node that shouldn't exist.
                QLOG_ERR("FATAL ERROR: Failed to release node count ref_count=0");
                abort();
            }
            if (atomic_compare_exchange_strong(&node->smart_tree_ctrl.ref_count, &count, count - 1U)) {
                break;
            }
        }
    }
    return count - 1U;
}

/**
 * @brief Checks if a given name is valid. A name is considered valid as long as it doesn't contain any '?' or '.'
 *
 * @note This should only be checked on the path provided to create node functions as resulting path may contain '.'s
 *
 * @param path Path to be checked
 *
 * @return true if the path is valid, otherwise false.
 */
bool node_is_valid_path(const char *path);

// File and Directory modes
static const mode_t s_mode_dir      = S_IFDIR | 0555;  // read/execute
static const mode_t s_mode_file     = S_IFREG | 0666;  // read/write
static const mode_t s_mode_metadata = S_IFREG | 0444;  // read

#endif  // NODE_H
