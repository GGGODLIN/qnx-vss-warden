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
#include <inttypes.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include <qpp/qlog.h>

#include "io_funcs.h"
#include "node.h"
#include "resmgr_attrs.h"
#include "tree.h"
#include "value.h"

static int verify_read_request(const node_t *node);

/**
 * @brief Verify the read request is valid.
 *
 * Read must be of a regular file and the file must be a VALUE
 * file type which includes Value and Control files.
 *
 * @param node The node associated with the read request.
 *
 * @return EOK if the read request is valid, or ENOSYS if this is not a regular file or is not a value or control
 * filetype.
 */
static int verify_read_request(const node_t *node) {
    int status = EOK;
    if (!S_ISREG(node->dattr.attr.mode)) {
        QLOG_WRN("Received read of unknown type!!");
        status = ENOSYS;
    } else if (node->filetype != VALUE) {
        QLOG_WRN("ERROR unknown filetype: %d!", node->filetype);
        status = ENOSYS;
    }
    return status;
}

// Binary mode read handler for Value files.
int io_read(resmgr_context_t *ctp, io_read_t *msg, RESMGR_OCB_T *ocb) {
    size_t max_bytes = 0;
    int    status    = EOK;
    int    nonblock  = 0;

    device_attr_t *dattr = NULL;

    if ((ctp == NULL) || (msg == NULL) || (ocb == NULL) || (ocb->base_ocb.attr == NULL)) {
        QLOG_WRN("Invalid parameters passed: ctp=%p, msg=%p, ocb=%p", ctp, msg, ocb);
        status = EINVAL;
        goto end;
    }
    dattr = (device_attr_t *)ocb->base_ocb.attr;

    status = iofunc_read_verify(ctp, msg, &ocb->base_ocb, &nonblock);
    if (status != EOK) {
        QLOG_WRN("iofunc_read_verify failed with: %s", strerror(status));
        goto end;
    }

    node_t *node = ((rm_ocb_t *)ocb)->node;
    if ((node == NULL) || (node->smart_tree_ctrl.deleted)) {
        QLOG_WRN("Failed to get node!");
        status = ENOENT;
        goto end;
    }

    status = verify_read_request(node);
    if (status != EOK) {
        goto end;
    }

    max_bytes = _IO_READ_GET_NBYTES(msg);  // Client read buffer size

    pthread_rwlock_rdlock(&node->type.value.rwlock);

    QLOG_DBG1("BIN read %s: inode: %lu", node->name, node->dattr.attr.inode);
    bool done_reading = (ocb->read_version == dattr->version);
    if ((node->type.value.nbytes == 0UL) || done_reading) {
        // Nothing to read. or we have an empty file
        _IO_SET_READ_NBYTES(ctp, 0);
    } else if (max_bytes < node->type.value.nbytes) {
        QLOG_WRN("Read buffer size is too small: %lu (required %ld)!", max_bytes, node->type.value.nbytes);
        status = ENOBUFS;
    } else {
        size_t filesize = 0;
        void  *buf      = NULL;
        status          = value_as_binary(&node->type.value, &buf, &filesize);
        if (status == EOK) {
            if (-1 == resmgr_msgwrite(ctp, buf, filesize, 0)) {
                status = errno;
                QLOG_WRN("Failed to write to read buffer. error: %s", strerror(errno));
            } else {
                ocb->read_version = dattr->version;
                _IO_SET_READ_NBYTES(ctp, (long)filesize);
                dattr->attr.flags |= IOFUNC_ATTR_ATIME;
            }
        }
    }
    pthread_rwlock_unlock(&node->type.value.rwlock);

end:
    return status;
}
