#ifndef WARDEN_HOST_IOFUNC_H
#define WARDEN_HOST_IOFUNC_H
#include <errno.h>
#include <limits.h>
#include <pthread.h>
#include <stdbool.h>
#include <stdint.h>
#include <sys/stat.h>
#include <sys/types.h>
#define EOK 0
#ifndef ENODATA
#define ENODATA ENOENT
#endif
#define IOFUNC_ATTR_ATIME 1
#define IOFUNC_ATTR_MTIME 2
#define IOFUNC_ATTR_CTIME 4
#define IOFUNC_NOTIFY_INPUT 1
#define IOFUNC_NOTIFY_OUTPUT 2
#define IOFUNC_NOTIFY_OBAND 3
#define _IO_XTYPE_MASK 255
#define _IO_XTYPE_NONE 0
#define _RESMGR_NPARTS(n) 0
#define RESMGR_OCB_T IOFUNC_OCB_T
#define RESMGR_HANDLE_T void
#define _IO_READ_GET_NBYTES(msg) ((msg)->i.nbytes)
#define _IO_WRITE_GET_NBYTES(msg) ((msg)->i.nbytes)
#define _IO_SET_READ_NBYTES(ctp, n) ((ctp)->status = (n))
#define _IO_SET_WRITE_NBYTES(ctp, n) ((ctp)->status = (n))
#define min(a,b) ((a)<(b)?(a):(b))
typedef unsigned int uint;
typedef struct {mode_t mode; ino_t inode; off_t nbytes; unsigned flags; unsigned nlink; pthread_mutex_t mutex;} iofunc_attr_t;
typedef struct {iofunc_attr_t *attr; off_t offset;} iofunc_ocb_t;
typedef struct {int unused;} iofunc_notify_t;
typedef struct {int unused;} resmgr_io_funcs_t;
typedef struct {struct {int srcmsglen; int scoid; int priority; int pid;} info; int offset; long status; void *ocb; const void *input; char output[32768];} resmgr_context_t;
typedef struct {struct {size_t nbytes; unsigned xtype;} i;} io_write_t;
typedef io_write_t io_read_t;
typedef struct {struct {char path[1024]; unsigned path_len; unsigned ioflag; mode_t mode;} connect;} io_open_t;
typedef struct {int unused;} io_close_t;
typedef io_close_t io_notify_t;
typedef io_close_t io_lseek_t;
typedef io_close_t io_unlink_t;
typedef io_close_t io_mknod_t;
int iofunc_open(resmgr_context_t *, io_open_t *, iofunc_attr_t *, iofunc_attr_t *, void *);
int iofunc_ocb_attach(resmgr_context_t *, io_open_t *, iofunc_ocb_t *, iofunc_attr_t *, const resmgr_io_funcs_t *);
int resmgr_ocb_iofuncs(resmgr_context_t *, void **, void *);
int iofunc_write_verify(resmgr_context_t *, io_write_t *, iofunc_ocb_t *, void *);
int iofunc_read_verify(resmgr_context_t *, io_read_t *, iofunc_ocb_t *, int *);
int resmgr_msgread(resmgr_context_t *, void *, size_t, size_t);
int resmgr_msgwrite(resmgr_context_t *, const void *, size_t, size_t);
void iofunc_notify_trigger(iofunc_notify_t *, int, int);
void iofunc_notify_trigger_strict(resmgr_context_t *, iofunc_notify_t *, int, int);
void iofunc_notify_remove(resmgr_context_t *, iofunc_notify_t *);
int iofunc_close_dup_default(resmgr_context_t *, io_close_t *, iofunc_ocb_t *);
int iofunc_close_ocb_default(resmgr_context_t *, void *, iofunc_ocb_t *);
void iofunc_attr_init(iofunc_attr_t *, mode_t, void *, int);
int iofunc_attr_lock(iofunc_attr_t *);
int iofunc_attr_unlock(iofunc_attr_t *);
#endif
