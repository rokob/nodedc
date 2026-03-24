#include "../../vendor/brotli/c/dec/static_init.h"

extern "C" void BrotliDecoderLazyStaticInit(void) {
  static bool ok = []() {
    BrotliDecoderLazyStaticInitInner();
    return true;
  }();
  (void)ok;
}
