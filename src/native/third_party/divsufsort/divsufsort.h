#ifndef NODEDC_DIVSUFSORT_H_
#define NODEDC_DIVSUFSORT_H_

#include <inttypes.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef uint8_t sauchar_t;
typedef int32_t saint_t;
typedef int32_t saidx_t;

#ifndef PRIdSAINT_T
#define PRIdSAINT_T PRId32
#endif

#ifndef PRIdSAIDX_T
#define PRIdSAIDX_T PRId32
#endif

saint_t divsufsort(const sauchar_t* T, saidx_t* SA, saidx_t n);
saidx_t divbwt(const sauchar_t* T, sauchar_t* U, saidx_t* A, saidx_t n);
const char* divsufsort_version(void);
saint_t bw_transform(const sauchar_t* T, sauchar_t* U, saidx_t* SA, saidx_t n, saidx_t* idx);
saint_t inverse_bw_transform(const sauchar_t* T, sauchar_t* U, saidx_t* A, saidx_t n, saidx_t idx);
saint_t sufcheck(const sauchar_t* T, const saidx_t* SA, saidx_t n, saint_t verbose);
saidx_t sa_search(
    const sauchar_t* T,
    saidx_t Tsize,
    const sauchar_t* P,
    saidx_t Psize,
    const saidx_t* SA,
    saidx_t SAsize,
    saidx_t* left);
saidx_t sa_simplesearch(
    const sauchar_t* T,
    saidx_t Tsize,
    const saidx_t* SA,
    saidx_t SAsize,
    saint_t c,
    saidx_t* left);

#ifdef __cplusplus
}  // extern "C"
#endif

#endif  // NODEDC_DIVSUFSORT_H_
