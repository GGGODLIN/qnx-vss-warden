#include <stdbool.h>
#include <errno.h>
#include <stdio.h>
#include <string.h>
#include <sys/iofunc.h>
#define QLOG_ERR(...) do { if (0) fprintf(stderr, __VA_ARGS__); } while (0)
#define QLOG_WRN(...) QLOG_ERR(__VA_ARGS__)
#define QLOG_NTC(...) QLOG_ERR(__VA_ARGS__)
#define QLOG_INF(...) QLOG_ERR(__VA_ARGS__)
#define QLOG_DBG1(...) QLOG_ERR(__VA_ARGS__)
#define QLOG_DBG2(...) QLOG_ERR(__VA_ARGS__)
