#include <napi.h>

#include "brotli_prepared_dictionary.h"
#include "prepared_dictionary.h"
#include "zstd_stream.h"

namespace {

Napi::Value GetBindingInfo(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Object result = Napi::Object::New(env);
  result.Set("version", Napi::String::New(env, "0.0.0-scaffold"));
  result.Set("napiVersion", Napi::Number::New(env, NAPI_VERSION));
  return result;
}

}  // namespace

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("version", Napi::String::New(env, "0.1.0-zstd-phase1"));
  exports.Set("napiVersion", Napi::Number::New(env, NAPI_VERSION));
  exports.Set("getBindingInfo", Napi::Function::New(env, GetBindingInfo));
  exports.Set("BrotliPreparedDictionary", nodedc::BrotliPreparedDictionary::Init(env));
  exports.Set("ZstdPreparedDictionary", nodedc::PreparedDictionary::Init(env));
  exports.Set("ZstdCompressor", nodedc::ZstdCompressor::Init(env));
  exports.Set("ZstdDecompressor", nodedc::ZstdDecompressor::Init(env));
  return exports;
}

NODE_API_MODULE(nodedc, Init)
