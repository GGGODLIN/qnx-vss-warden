#ifndef QPP_WARDEN_H
#define QPP_WARDEN_H

#include "ocb.h"

int qpp_warden_compile(node_t *node, const char *path, const char *metadata);
void qpp_warden_destroy(node_t *node);
int qpp_warden_open(rm_ocb_t *ocb, resmgr_context_t *ctp, const char *path, bool diagnostic);
int qpp_warden_write(rm_ocb_t *ocb, void **buffer, size_t bytes, bool text);
int qpp_warden_read(resmgr_context_t *ctp, io_read_t *msg, rm_ocb_t *ocb);
int qpp_warden_refresh(node_t *node);
void qpp_warden_close(rm_ocb_t *ocb);

#endif
