/*
 * Copyright (c) 2024-2026, BlackBerry Limited. All rights reserved.
 *
 * BlackBerry Limited and its licensors  retain all intellectual property and
 * proprietary rights in and to this software and related documentation.  Any
 * use, reproduction, disclosure or distribution of this software and related
 * documentation without an express license agreement from BlackBerry Limited
 * is strictly prohibited.
 */

#include <dirent.h>
#include <stdio.h>
#include <sys/resmgr.h>

#include <qpp/qlog.h>

#include "io_funcs.h"
#include "node.h"
#include "tree.h"

// Client Disconnect or FD close Handler.
int io_close_dup(resmgr_context_t *ctp, io_close_t *msg, RESMGR_OCB_T *ocb) {
    rm_ocb_t      *rm_ocb = (rm_ocb_t *)ocb;
    device_attr_t *dattr  = (device_attr_t *)rm_ocb->base_ocb.attr;

    node_lock(rm_ocb->node);
    QLOG_DBG1("io_close_dup! with context scoid %d, inode: %lu", ctp->info.scoid, dattr->attr.inode);

    // Unblock any threads waiting for value updates.
    iofunc_notify_trigger_strict(ctp, dattr->notify, INT_MAX, IOFUNC_NOTIFY_INPUT);
    iofunc_notify_trigger_strict(ctp, dattr->notify, INT_MAX, IOFUNC_NOTIFY_OUTPUT);
    iofunc_notify_trigger_strict(ctp, dattr->notify, INT_MAX, IOFUNC_NOTIFY_OBAND);

    // Remove client from notification list.
    iofunc_notify_remove(ctp, dattr->notify);
    node_unlock(rm_ocb->node);
    return (iofunc_close_dup_default(ctp, msg, &rm_ocb->base_ocb));
}

// Called when the last "close" for an OCB is called. After this the OCB is destroyed and ocb_free() is called.
int io_close_ocb(resmgr_context_t *ctp, void *reserved, RESMGR_OCB_T *ocb) {
    rm_ocb_t *rm_ocb = (rm_ocb_t *)ocb;
    QLOG_DBG1("io_close_ocb! with context scoid %d, node: %s", ctp->info.scoid, rm_ocb->node->path);

    // Release any nodes this ocb is holding a reference to.
    if (rm_ocb->node->filetype == DIRECTORY) {
        tree_node_release(rm_ocb->ref.dir_next_child_node);
        rm_ocb->ref.dir_next_child_node = NULL;
    }
    // Free any metadata value.
    if (rm_ocb->node->filetype == METADATA) {
        free(rm_ocb->ref.metadata_value);
        rm_ocb->ref.metadata_value = NULL;
    }

    tree_node_release(rm_ocb->node);
    rm_ocb->node = NULL;

    return iofunc_close_ocb_default(ctp, reserved, &rm_ocb->base_ocb);
}
