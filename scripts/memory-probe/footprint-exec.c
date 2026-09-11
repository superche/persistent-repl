/* Experimental own-process launcher; does not grant capabilities. */
#include <dlfcn.h>
#include <errno.h>
#include <limits.h>
#include <spawn.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
extern char **environ;
typedef int (*jetsam_fn)(posix_spawnattr_t *, short, int, int, int);
int main(int argc, char **argv) {
  if (argc < 3 || argv[2][0] != '/') return 64;
  char *end;
  errno = 0;
  long limit = strtol(argv[1], &end, 10);
  if (errno || *end || limit < 1 || limit > INT_MAX) return 64;
  jetsam_fn set = (jetsam_fn)dlsym(RTLD_DEFAULT, "posix_spawnattr_setjetsam_ext");
  if (!set) return 69;
  posix_spawnattr_t attr;
  int rc = posix_spawnattr_init(&attr);
  if (rc) return 71;
  rc = posix_spawnattr_setflags(&attr, POSIX_SPAWN_SETEXEC);
  if (!rc) rc = set(&attr, 0x04 | 0x08, 3, (int)limit, (int)limit);
  if (!rc) rc = posix_spawn(NULL, argv[2], NULL, &attr, argv + 2, environ);
  posix_spawnattr_destroy(&attr);
  fprintf(stderr, "footprint-exec setup failed: %d\n", rc);
  return 71;
}
