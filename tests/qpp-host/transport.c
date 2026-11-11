#include "io_funcs.h"
#include <stdlib.h>
#include <string.h>

resmgr_io_funcs_t g_io_funcs_dir, g_io_funcs_text, g_io_funcs_bin;
int iofunc_open(resmgr_context_t *c,io_open_t *m,iofunc_attr_t *a,iofunc_attr_t *p,void *x) {(void)c;(void)m;(void)a;(void)p;(void)x;return 0;}
int iofunc_ocb_attach(resmgr_context_t *c,io_open_t *m,iofunc_ocb_t *o,iofunc_attr_t *a,const resmgr_io_funcs_t *f) {(void)m;(void)f;o->attr=a;c->ocb=o;return 0;}
int resmgr_ocb_iofuncs(resmgr_context_t *c,void **o,void *unused) {(void)unused;*o=c->ocb;return 0;}
int iofunc_write_verify(resmgr_context_t *c,io_write_t *m,iofunc_ocb_t *o,void *x) {(void)c;(void)m;(void)o;(void)x;return 0;}
int iofunc_read_verify(resmgr_context_t *c,io_read_t *m,iofunc_ocb_t *o,int *n) {(void)c;(void)m;(void)o;if(n)*n=0;return 0;}
int resmgr_msgread(resmgr_context_t *c,void *b,size_t n,size_t o) {(void)o;memcpy(b,c->input,n);return (int)n;}
int resmgr_msgwrite(resmgr_context_t *c,const void *b,size_t n,size_t o) {(void)o;if(n>sizeof(c->output))return -1;memcpy(c->output,b,n);return (int)n;}
void iofunc_notify_trigger(iofunc_notify_t *n,int a,int b) {(void)n;(void)a;(void)b;}
void iofunc_notify_trigger_strict(resmgr_context_t *c,iofunc_notify_t *n,int a,int b) {(void)c;(void)n;(void)a;(void)b;}
void iofunc_notify_remove(resmgr_context_t *c,iofunc_notify_t *n) {(void)c;(void)n;}
int iofunc_close_dup_default(resmgr_context_t *c,io_close_t *m,iofunc_ocb_t *o) {(void)c;(void)m;(void)o;return 0;}
int iofunc_close_ocb_default(resmgr_context_t *c,void *r,iofunc_ocb_t *o) {(void)c;(void)r;(void)o;return 0;}
void iofunc_attr_init(iofunc_attr_t *a,mode_t m,void *p,int x) {
  (void)p;(void)x;a->mode=m;a->nlink=1;
  pthread_mutexattr_t attr;pthread_mutexattr_init(&attr);pthread_mutexattr_settype(&attr,PTHREAD_MUTEX_RECURSIVE);
  pthread_mutex_init(&a->mutex,&attr);pthread_mutexattr_destroy(&attr);
}
int iofunc_attr_lock(iofunc_attr_t *a) {return pthread_mutex_lock(&a->mutex);}
int iofunc_attr_unlock(iofunc_attr_t *a) {return pthread_mutex_unlock(&a->mutex);}
