#include "catalog.h"
#include "connect_funcs.h"
#include "io_funcs.h"
#include "tree.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>
#include <time.h>

static resmgr_context_t context;
static rm_ocb_t *open_path(const char *path,int priority) {
  io_open_t msg={0};
  snprintf(msg.connect.path,sizeof(msg.connect.path),"%s",path);
  msg.connect.path_len=strlen(path)+1;
  context.info.priority=priority;context.info.pid=100+priority;
  int status=io_open(&context,&msg,NULL,NULL);
  if(status) fprintf(stderr,"open %s: %d\n",path,status);
  assert(status==0);
  return context.ocb;
}
static int write_value(rm_ocb_t *ocb,const void *value,size_t size,bool text) {
  io_write_t msg={.i={.nbytes=size}};
  context.input=value;context.info.srcmsglen=(int)(size+sizeof(msg));
  return text?io_write_text(&context,&msg,ocb):io_write(&context,&msg,ocb);
}
static void diagnostic(rm_ocb_t *ocb,const char *expected) {
  io_read_t msg={.i={.nbytes=32767}};
  context.status=0;
  assert(io_read_text(&context,&msg,ocb)==0);
  context.output[context.status]=0;
  puts(context.output);
  assert(strstr(context.output,expected));
}
static void close_ocb(rm_ocb_t *ocb) {assert(io_close_ocb(&context,NULL,ocb)==0);iofunc_ocb_free(ocb);}
int main(int argc,char **argv) {
  assert(argc==2);
  node_t *root=create_dir_node("/",S_IFDIR|0755);
  assert(tree_set_root_node(root)==0);
  assert(process_catalog(argv[1])==0);
  rm_ocb_t *low=open_path("Vehicle/Speed?control,text,priority=10,lease=1000,as=IVI",10);
  rm_ocb_t *high=open_path("Vehicle/.Speed.control?text,priority=60,lease=1000,as=ADAS",60);
  assert(write_value(low,"80\n",3,true)==0);
  int8_t zero=0;
  assert(write_value(high,&zero,sizeof(zero),false)==0);
  assert(write_value(low,"110\n",4,true)==EBUSY);
  rm_ocb_t *receipt=open_path("Vehicle/Speed?warden",1);
  diagnostic(receipt,"PRIORITY_PREEMPTED");close_ocb(receipt);
  close_ocb(high);
  receipt=open_path("Vehicle/Speed?warden,text",1);
  diagnostic(receipt,"\"committedControlValue\":80");close_ocb(receipt);
  assert(write_value(low,"121\n",4,true)==ERANGE);
  close_ocb(low);
  receipt=open_path("Vehicle/Speed?warden",1);
  diagnostic(receipt,"\"committedControlValue\":0");close_ocb(receipt);
  rm_ocb_t *mode=open_path("Vehicle/Mode?control,text",10);
  assert(write_value(mode,"FAST\n",5,true)==0);
  assert(write_value(mode,"TURBO\n",6,true)==EINVAL);
  close_ocb(mode);
  rm_ocb_t *dtc=open_path("Vehicle/DTC?control,text",10);
  assert(write_value(dtc,"70000,4000000000\n",17,true)==0);
  assert(write_value(dtc,"1,2,3\n",6,true)==EINVAL);
  close_ocb(dtc);
  rm_ocb_t *temp=open_path("Vehicle/Temperature?text",10);
  io_read_t read={.i={.nbytes=100}};
  assert(io_read_text(&context,&read,temp)==0);
  assert(strstr(context.output,"22.500000"));
  assert(write_value(temp,"126\n",4,true)==ERANGE);
  assert(write_value(temp,"24.5\n",5,true)==0);
  float precise=24.123456f;
  assert(write_value(temp,&precise,sizeof(precise),false)==0);
  assert(temp->node->type.value.data.f==precise);
  assert(write_value(temp,"24.5\n",5,true)==0);
  close_ocb(temp);
  temp=open_path("Vehicle/Temperature?text",10);
  memset(context.output,0,sizeof(context.output));
  assert(io_read_text(&context,&read,temp)==0);
  assert(strstr(context.output,"24.500000"));
  context.status=-1;
  assert(io_read_text(&context,&read,temp)==0);
  assert(context.status==0);
  close_ocb(temp);
  high=open_path("Vehicle/Speed?control,text,priority=60,lease=1",60);
  assert(write_value(high,"20\n",3,true)==0);
  struct timespec wait={.tv_nsec=5000000};nanosleep(&wait,NULL);
  receipt=open_path("Vehicle/Speed?warden",1);
  diagnostic(receipt,"\"activeHolder\":null");close_ocb(receipt);close_ocb(high);
  for(int i=0;i<160;i++) {rm_ocb_t *o=open_path("Vehicle/Speed?control,text",10);assert(write_value(o,"10\n",3,true)==0);close_ocb(o);}
  puts("PASS: real upstream catalog/open/text+binary write/read/close; ERANGE/EINVAL/EBUSY; standby/default/expiry; 160 OCB reuses");
  return 0;
}
