#define _POSIX_C_SOURCE 200809L
#include "qpp_warden.h"
#include "vss_warden_core.h"

#include <errno.h>
#include <inttypes.h>
#include <stdatomic.h>
#include <stdio.h>
#include <string.h>
#include <time.h>
#ifdef __QNXNTO__
#include <sys/iofunc.h>
#endif

static _Atomic int next_fd = 1;

static int64_t now_ms(void) {
  struct timespec now;
  if (clock_gettime(CLOCK_MONOTONIC, &now) != 0) return -1;
  return (int64_t)now.tv_sec * 1000 + now.tv_nsec / 1000000;
}

static int execute(node_t *node, const char *operation, char *receipt, size_t capacity) {
  return vss_warden_session_execute(node->warden, operation, receipt, capacity);
}

static int sync_value(node_t *node) {
  char text[4096];
  int status = vss_warden_session_value(node->warden, text, sizeof(text));
  if (status != 0) return status;
  char *buffer = strdup(text);
  if (!buffer) return ENOMEM;
  value_t candidate = {.type = node->type.value.type};
  pthread_rwlock_init(&candidate.rwlock, NULL);
  status = value_write_text(&candidate, &buffer, strlen(text) + 1);
  free(buffer);
  bool changed = true;
  if (status == 0) {
    void *before = NULL, *after = NULL;
    size_t before_size = 0, after_size = 0;
    int before_status = value_as_binary(&node->type.value, &before, &before_size);
    status = value_as_binary(&candidate, &after, &after_size);
    changed = before_status != 0 || before_size != after_size || memcmp(before, after, after_size) != 0;
    if (status == 0 && changed) {
      buffer = strdup(text);
      if (!buffer) status = ENOMEM;
      else status = value_write_text(&node->type.value, &buffer, strlen(text) + 1);
      free(buffer);
    }
  }
  value_cleanup(&candidate);
  if (status == 0 && changed) {
    node->dattr.attr.nbytes = (off_t)node->type.value.nbytes;
    node->dattr.version++;
    if (node->dattr.version == 0) node->dattr.version++;
    iofunc_notify_trigger(node->dattr.notify, 1, IOFUNC_NOTIFY_INPUT);
  }
  return status;
}

int qpp_warden_compile(node_t *node, const char *path, const char *metadata) {
  node->warden = vss_warden_session_create(path, metadata, node->warden_control);
  if (!node->warden) return EINVAL;
  return sync_value(node);
}

void qpp_warden_destroy(node_t *node) {
  vss_warden_session_destroy(node->warden);
  node->warden = NULL;
}

int qpp_warden_open(rm_ocb_t *ocb, resmgr_context_t *ctp, const char *path, bool diagnostic) {
  ocb->warden_mode = diagnostic;
  if (!ocb->node->warden) return diagnostic ? ENOENT : 0;
  if (diagnostic) return 0;
  vss_warden_path_info_t info;
  if (!vss_warden_canonicalize_path(path, &info)) return EINVAL;
  int priority;
#ifdef __QNXNTO__
  priority = ctp->info.priority;
  if (info.has_priority && info.priority > priority) return EPERM;
#else
  priority = ctp->info.priority;
#endif
  if (info.has_priority) priority = info.priority;
  int64_t lease = info.has_lease_ms ? info.lease_ms : 1000;
  if (lease <= 0 || lease > 3600000) return EINVAL;
  int fd = atomic_fetch_add(&next_fd, 1);
  if (fd <= 0) return EMFILE;
  char quoted_path[2048], quoted_role[512], operation[4096], receipt[8192];
  if (vss_warden_json_quote(info.canonical_path, quoted_path, sizeof(quoted_path)) != 0 ||
      vss_warden_json_quote(info.role, quoted_role, sizeof(quoted_role)) != 0) return ENOBUFS;
  snprintf(operation, sizeof(operation),
           "[{\"kind\":\"OPEN\",\"fd\":%d,\"path\":%s,\"pid\":%d,\"priority\":%d,\"leaseMs\":%" PRId64 ",\"role\":%s}]",
           fd, quoted_path, ctp->info.pid, priority, lease, quoted_role);
  pthread_rwlock_wrlock(&ocb->node->type.value.rwlock);
  int status = execute(ocb->node, operation, receipt, sizeof(receipt));
  pthread_rwlock_unlock(&ocb->node->type.value.rwlock);
  if (status == 0 && !strstr(receipt, "\"opKind\":\"OPEN\",\"status\":\"EOK\"")) status = EMFILE;
  if (status == 0) ocb->warden_fd = fd;
  return status;
}

int qpp_warden_refresh(node_t *node) {
  if (!node->warden) return 0;
  int64_t now = now_ms();
  if (now < 0) return EIO;
  char operation[512], receipt[8192];
  snprintf(operation, sizeof(operation), "[{\"kind\":\"READ_WARDEN\",\"path\":\"%s\",\"nowMs\":%" PRId64 "}]", node->warden_path, now);
  int status = execute(node, operation, receipt, sizeof(receipt));
  if (status == 0) status = sync_value(node);
  return status;
}

int qpp_warden_write(rm_ocb_t *ocb, void **buffer, size_t bytes, bool text) {
  if (ocb->warden_mode) return EBADF;
  node_t *node = ocb->node;
  if (!node->warden) {
    return text ? value_write_text(&node->type.value, (char **)buffer, bytes)
                : value_write_binary(&node->type.value, buffer, bytes);
  }
  if (!ocb->warden_fd) return EBADF;
  int64_t now = now_ms();
  if (now < 0) return EIO;
  value_t candidate = {.type = node->type.value.type};
  pthread_rwlock_init(&candidate.rwlock, NULL);
  int status = text ? value_write_text(&candidate, (char **)buffer, bytes)
                    : value_write_binary(&candidate, buffer, bytes);
  char *encoded = NULL;
  size_t encoded_size = 0;
  if (status == 0) status = value_as_text(&candidate, &encoded, &encoded_size);
  if (status == 0 && (candidate.type == FLOAT || candidate.type == DOUBLE)) {
    char precise[64];
    snprintf(precise, sizeof(precise), "%.17g", candidate.type == FLOAT ? (double)candidate.data.f : candidate.data.d);
    free(encoded);
    encoded = strdup(precise);
    if (!encoded) status = ENOMEM;
  }
  if (status == 0) {
    char value[4096], operation[8192], receipt[8192];
    if (candidate.type == STRING) {
      status = vss_warden_json_quote(encoded, value, sizeof(value));
    } else if (candidate.type == VECTOR_UINT32) {
      if (strlen(encoded) + 3 > sizeof(value)) status = ENOBUFS;
      else snprintf(value, sizeof(value), "[%s]", encoded);
    } else {
      if (strlen(encoded) + 1 > sizeof(value)) status = ENOBUFS;
      else snprintf(value, sizeof(value), "%s", encoded);
    }
    if (status == 0) {
      snprintf(operation, sizeof(operation), "[{\"kind\":\"WRITE\",\"fd\":%d,\"value\":%s,\"nowMs\":%" PRId64 "}]", ocb->warden_fd, value, now);
      status = execute(node, operation, receipt, sizeof(receipt));
      if (status == 0) {
        if (strstr(receipt, "\"opKind\":\"WRITE\",\"status\":\"ERANGE\"")) status = ERANGE;
        else if (strstr(receipt, "\"opKind\":\"WRITE\",\"status\":\"EBUSY\"")) status = EBUSY;
        else if (!strstr(receipt, "\"opKind\":\"WRITE\",\"status\":\"EOK\"")) status = EINVAL;
        int sync_status = sync_value(node);
        if (status == 0) status = sync_status;
      }
    }
  }
  free(encoded);
  value_cleanup(&candidate);
  return status;
}

int qpp_warden_read(resmgr_context_t *ctp, io_read_t *msg, rm_ocb_t *ocb) {
  if (!ocb->node->warden) return ENOENT;
  if (!ocb->warden_receipt) {
    int64_t now = now_ms();
    if (now < 0) return EIO;
    char operation[512], receipt[8192];
    snprintf(operation, sizeof(operation), "[{\"kind\":\"READ_WARDEN\",\"path\":\"%s\",\"nowMs\":%" PRId64 "}]", ocb->node->warden_path, now);
    pthread_rwlock_wrlock(&ocb->node->type.value.rwlock);
    int status = execute(ocb->node, operation, receipt, sizeof(receipt));
    if (status == 0) status = sync_value(ocb->node);
    pthread_rwlock_unlock(&ocb->node->type.value.rwlock);
    if (status != 0) return status;
    ocb->warden_receipt = strdup(receipt);
    if (!ocb->warden_receipt) return ENOMEM;
  }
  size_t length = strlen(ocb->warden_receipt);
  size_t offset = (size_t)ocb->base_ocb.offset;
  size_t bytes = offset < length ? length - offset : 0;
  if (bytes > _IO_READ_GET_NBYTES(msg)) bytes = _IO_READ_GET_NBYTES(msg);
  if (resmgr_msgwrite(ctp, ocb->warden_receipt + (offset < length ? offset : length), bytes, 0) == -1) return errno;
  _IO_SET_READ_NBYTES(ctp, bytes);
  ocb->base_ocb.offset += (off_t)bytes;
  return 0;
}

void qpp_warden_close(rm_ocb_t *ocb) {
  free(ocb->warden_receipt);
  ocb->warden_receipt = NULL;
  if (!ocb->warden_fd || !ocb->node->warden) return;
  char operation[256], receipt[8192];
  int64_t now = now_ms();
  if (now < 0) now = 0;
  snprintf(operation, sizeof(operation), "[{\"kind\":\"CLOSE\",\"fd\":%d,\"nowMs\":%" PRId64 "}]", ocb->warden_fd, now);
  pthread_rwlock_wrlock(&ocb->node->type.value.rwlock);
  if (execute(ocb->node, operation, receipt, sizeof(receipt)) == 0) (void)sync_value(ocb->node);
  pthread_rwlock_unlock(&ocb->node->type.value.rwlock);
  ocb->warden_fd = 0;
}
