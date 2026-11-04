/*
 * Copyright (c) 2025-2026, BlackBerry Limited. All rights reserved.
 *
 * BlackBerry Limited and its licensors  retain all intellectual property and
 * proprietary rights in and to this software and related documentation.  Any
 * use, reproduction, disclosure or distribution of this software and related
 * documentation without an express license agreement from BlackBerry Limited
 * is strictly prohibited.
 */

#ifndef OCB_H
#define OCB_H

/***********************************************************************************************
 * The ocb functions overridden by the resource manager.
 **********************************************************************************************/
#include <stdbool.h>

#include "node.h"
#include "resmgr_attrs.h"

typedef struct rm_ocb_s {
    iofunc_ocb_t base_ocb;
    uint         read_version;  // the version of the last value read (0 indicates no previous read).
    node_t      *node;          // pointer to the tree node for this ocb.
    union {
        node_t *dir_next_child_node;  // for ioread_dir, store the next child we want to read.
        char   *metadata_value;       // for metadata read quick access, this holds the desired attribute value.
    } ref;
} rm_ocb_t;

/**
 * @brief Allocate an iofunc Open Control Block.
 *
 * @param ctp Resource manager context pointer.
 * @param attr Unused.
 *
 * @return A pointer to the allocated IOFUNC_OCB_T on success, or NULL otherwise.
 */
IOFUNC_OCB_T *iofunc_ocb_calloc(resmgr_context_t *ctp, IOFUNC_ATTR_T *attr);

/**
 * @brief Free the ocb resource.
 *
 * @param ocb The open control block to be freed.
 *
 */
void iofunc_ocb_free(IOFUNC_OCB_T *ocb);

#endif  // OCB_H
