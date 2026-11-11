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
#include "ocb.h"
#include "tree.h"

// Text mode read handler. For value files opened in "?text" mode and metadata files.
int io_read_text(resmgr_context_t *ctp, io_read_t *msg, RESMGR_OCB_T *ocb) {
    int            status = EOK;
    device_attr_t *dattr  = (device_attr_t *)ocb->base_ocb.attr;
    rm_ocb_t      *rm_ocb = (rm_ocb_t *)ocb;

    ino_t ino = dattr->attr.inode;
    QLOG_DBG1("inode: %lu", ino);

    status = iofunc_read_verify(ctp, msg, &ocb->base_ocb, NULL);
    if (status != EOK) {
        goto error;
    }

    node_t *node = rm_ocb->node;
    if ((node == NULL) || (node->smart_tree_ctrl.deleted)) {
        QLOG_WRN("ioread_text, failed to acquire node(inode=%lu)", ino);
        status = ENOENT;
        goto error;
    }

    if (S_ISREG(dattr->attr.mode)) {
        QLOG_DBG1("TEXT read of file (inode %lu) %s!!", ino, node->name);

        size_t max_bytes = _IO_READ_GET_NBYTES(msg);

        // Metadata files can be read in multiple read calls. Value files must be read in one shot!
        if (node->filetype == METADATA) {
            char  *buf    = NULL;
            size_t nleft  = 0;
            size_t nbytes = 0;
            if (NULL == rm_ocb->ref.metadata_value) {
                // Reading all the metadata
                buf   = node->type.metadata.metadata;
                nleft = (size_t)dattr->attr.nbytes - (size_t)ocb->base_ocb.offset;
            } else {
                // Reading only the specified metadata attribute value.
                buf              = rm_ocb->ref.metadata_value;
                size_t meta_size = strlen(rm_ocb->ref.metadata_value) + (size_t)1;
                nleft            = meta_size - (size_t)ocb->base_ocb.offset;
            }
            nbytes = min(max_bytes, nleft);
            if (-1 == resmgr_msgwrite(ctp, buf, nbytes, 0)) {
                status = errno;
                QLOG_WRN("Failed to write to read buffer with: %s", strerror(status));
            } else {
                // Advance the offset by the number of bytes returned to the client.
                _IO_SET_READ_NBYTES(ctp, nbytes);
                ocb->base_ocb.offset += (off_t)nbytes;
            }
        } else if (node->filetype == VALUE) {
            pthread_rwlock_rdlock(&node->type.value.rwlock);
            bool  done_reading = (ocb->read_version == dattr->version) ? true : false;
            off_t filesize     = dattr->attr.nbytes;  // Size of file in binary form

            QLOG_DBG1("Text Read: Done reading? %s. filesize %ld, max_bytes %zu!!", done_reading ? "True" : "False",
                      filesize, max_bytes);

            if (!done_reading && (filesize > 0)) {
                char  *result      = NULL;
                size_t result_size = 0UL;
                status             = value_as_text(&node->type.value, &result, &result_size);
                if (status == EOK) {
                    if (max_bytes < result_size) {
                        QLOG_WRN("Read buffer size is too small: %lu (required %lu)!", max_bytes, result_size);
                        status = ENOBUFS;
                    } else if (-1 == resmgr_msgwrite(ctp, result, result_size, 0)) {
                        status = errno;
                        QLOG_WRN("Failed to write to read buffer. error: %s", strerror(errno));
                    } else {
                        // Success!
                        _IO_SET_READ_NBYTES(ctp, (long)result_size);
                        ocb->read_version = dattr->version;
                    }
                    free(result);
                }
            } else {
                // They've asked for zero bytes or they've already previously read everything
                _IO_SET_READ_NBYTES(ctp, 0);
            }
            pthread_rwlock_unlock(&node->type.value.rwlock);
        } else {
            // Unknown file type
            QLOG_WRN("Unexpected filetype for inode %lu (%s)!", ino, node->name);
            status = ENOSYS;
        }

        // Mark the access time as invalid (we just accessed it)
        if ((status == EOK) && (msg->i.nbytes > 0U)) {
            dattr->attr.flags |= IOFUNC_ATTR_ATIME;
        }
    } else if (S_ISDIR(dattr->attr.mode)) {
        QLOG_WRN("Received text read of a dir (inode %lu) %s!!", ino, node->name);
        status = ENOSYS;
    } else {
        QLOG_WRN("Received read of unknown type!!");
        status = ENOSYS;
    }

error:
    return status;
}
