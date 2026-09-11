#include <dlfcn.h>
#include <errno.h>
#include <libproc.h>
#include <mach/mach.h>
#include <spawn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/resource.h>
#include <sys/wait.h>
#include <unistd.h>
extern char **environ;
typedef int (*jetsam_fn)(posix_spawnattr_t *,short,int,int,int);
static void *blocks[64];
static void sample(int allocated) {
  struct rusage_info_v4 usage = {0};
  int r=proc_pid_rusage(getpid(),RUSAGE_INFO_V4,(rusage_info_t*)&usage);
  printf("{\"event\":\"allocation\",\"allocatedMiB\":%d,\"usageResult\":%d,\"rssBytes\":%llu,\"footprintBytes\":%llu}\n", allocated,r,usage.ri_resident_size,usage.ri_phys_footprint);
  fflush(stdout);
}
int main(int argc,char **argv) {
  if(argc>1 && strcmp(argv[1],"child")==0){
    sample(0);
    for(int i=0;i<64;i++){
      blocks[i]=malloc(1024*1024);if(!blocks[i])return 2;
      memset(blocks[i],i+1,1024*1024);
      if((i+1)%4==0)sample(i+1);
      usleep(3000);
    }
    return 0;
  }
  if(argc>1 && strcmp(argv[1],"mach")==0){
    int old=0;int r=task_set_phys_footprint_limit(mach_task_self(),32,&old);
    printf("{\"probe\":\"mach-footprint-self\",\"result\":%d,\"oldLimitMiB\":%d,\"uid\":%d}\n",r,old,getuid());return 0;
  }
  posix_spawnattr_t attr;int r=posix_spawnattr_init(&attr);if(r)return r;
  if(argc>1 && strcmp(argv[1],"spawn")==0){
    jetsam_fn f=(jetsam_fn)dlsym(RTLD_DEFAULT,"posix_spawnattr_setjetsam_ext");
    if(!f){printf("{\"probe\":\"spawn-limit\",\"available\":false}\n");return 0;}
    r=f(&attr,0x04|0x08,3,32,32);
    printf("{\"probe\":\"spawn-limit\",\"attributeResult\":%d,\"limitMiB\":32,\"uid\":%d}\n",r,getuid());fflush(stdout);
    if(r)return r;
  }
  pid_t child;char *args[]={argv[0],"child",NULL};
  r=posix_spawn(&child,argv[0],NULL,&attr,args,environ);posix_spawnattr_destroy(&attr);
  if(r){printf("{\"event\":\"spawn\",\"error\":%d}\n",r);return 0;}
  int status=0;waitpid(child,&status,0);
  printf("{\"event\":\"terminal\",\"exit\":%d,\"signal\":%d}\n",WIFEXITED(status)?WEXITSTATUS(status):-1,WIFSIGNALED(status)?WTERMSIG(status):0);
  return 0;
}
