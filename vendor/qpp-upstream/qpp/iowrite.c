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
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include <qpp/qlog.h>

#include "io_funcs.h"
#include "node.h"
#include "tree.h"
#include "utils/utils.h"
#include "value.h"

// Binary mode write handler for value files.
int io_write(resmgr_context_t *ctp, io_write_t *msg, RESMGR_OCB_T *ocb) {
    int            status = EOK;
    void          *buf    = NULL;
    size_t         nbytes = 0;
    device_attr_t *dattr  = (device_attr_t *)ocb->base_ocb.attr;
    ino_t          ino    = dattr->attr.inode;

    status = iofunc_write_verify(ctp, msg, &ocb->base_ocb, NULL);
    if (status != EOK) {
        goto error;
    }

    if ((msg->i.xtype & _IO_XTYPE_MASK) != _IO_XTYPE_NONE) {
        status = ENOSYS;
        goto error;
    }

    node_t *node = ocb->node;
    if ((node == NULL) || (node->smart_tree_ctrl.deleted)) {
        QLOG_WRN("Failed to acquire node(inode=%lu)", ino);
        status = ENOENT;
        goto error;
    }
    QLOG_INF("Received write for %s (inode %lu)", node->path, ino);

    /* Extract the length of the client's message. */
    nbytes = _IO_WRITE_GET_NBYTES(msg);

    /* Filter out malicious write requests that attempt to write more
       data than they provide in the message. Also filter 0 sized writes. */
    if ((nbytes > (size_t)ctp->info.srcmsglen - (size_t)ctp->offset - sizeof(io_write_t)) || (nbytes == 0)) {
        QLOG_DBG1("nbytes = %zu", nbytes);
        status = EBADMSG;
        goto error;
    }

    // Note: buf will be consumed by value_write_binary.
    buf = malloc(nbytes);
    if (buf == NULL) {
        status = ENOMEM;
        goto error;
    }

    /*
     *  Re-read the data from the sender's message buffer.
     *  We're not assuming that all of the data fit into the
     *  resource manager library's receive buffer.
     */
    resmgr_msgread(ctp, buf, nbytes, sizeof(msg->i));
    QLOG_DBG1("Received new %zu bytes, datatype: %d", nbytes, node->type.value.type);

    pthread_rwlock_wrlock(&node->type.value.rwlock);
    status = value_write_binary(&node->type.value, &buf, nbytes);
    if (status == EOK) {
        dattr->attr.nbytes = (off_t)node->type.value.nbytes;
        increment_version(&dattr->version);
        /* set up the number of bytes (returned by client's write()) */
        _IO_SET_WRITE_NBYTES(ctp, nbytes);
        dattr->attr.flags |= IOFUNC_ATTR_MTIME | IOFUNC_ATTR_CTIME;
        iofunc_notify_trigger(dattr->notify, 1, IOFUNC_NOTIFY_INPUT);
    } else {
        QLOG_WRN("Failed to write value to path=%s with: %s", node->path, strerror(status));
    }
    pthread_rwlock_unlock(&node->type.value.rwlock);

error:
    return (status != EOK) ? status : (_RESMGR_NPARTS(0));
}
