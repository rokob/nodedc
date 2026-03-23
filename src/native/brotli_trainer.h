#ifndef NODEDC_BROTLI_TRAINER_H_
#define NODEDC_BROTLI_TRAINER_H_

#include <napi.h>

namespace nodedc {

void RegisterBrotliTraining(Napi::Env env, Napi::Object exports);

}  // namespace nodedc

#endif  // NODEDC_BROTLI_TRAINER_H_
