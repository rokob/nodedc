#include <napi.h>

#include "brotli_trainer.h"
#include "zstd_trainer.h"

namespace {

Napi::Value GetBindingInfo(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Object result = Napi::Object::New(env);
  result.Set("version", Napi::String::New(env, "0.1.0-train"));
  result.Set("napiVersion", Napi::Number::New(env, NAPI_VERSION));
  return result;
}

}  // namespace

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("version", Napi::String::New(env, "0.1.0-train"));
  exports.Set("napiVersion", Napi::Number::New(env, NAPI_VERSION));
  exports.Set("getBindingInfo", Napi::Function::New(env, GetBindingInfo));
  nodedc::RegisterZstdTraining(env, exports);
  nodedc::RegisterBrotliTraining(env, exports);
  return exports;
}

NODE_API_MODULE(nodedc_train, Init)
