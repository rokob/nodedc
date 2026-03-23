#ifndef NODEDC_ZSTD_TRAINER_H_
#define NODEDC_ZSTD_TRAINER_H_

#include <napi.h>

namespace nodedc {

void RegisterZstdTraining(Napi::Env env, Napi::Object exports);

}  // namespace nodedc

#endif  // NODEDC_ZSTD_TRAINER_H_
