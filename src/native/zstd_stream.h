#ifndef NODEDC_ZSTD_STREAM_H_
#define NODEDC_ZSTD_STREAM_H_

#include <napi.h>

#include <cstddef>
#include <cstdint>
#include <mutex>
#include <vector>

struct ZSTD_CCtx_s;
struct ZSTD_DCtx_s;

namespace nodedc {

class PreparedDictionary;

class ZstdCompressor : public Napi::ObjectWrap<ZstdCompressor> {
 public:
  static Napi::Function Init(Napi::Env env);
  ZstdCompressor(const Napi::CallbackInfo& info);
  ~ZstdCompressor() override;
  std::vector<std::uint8_t> Process(const std::uint8_t* data, std::size_t size, bool end_frame);

 private:
  static Napi::FunctionReference constructor_;

  Napi::Value Push(const Napi::CallbackInfo& info);
  Napi::Value PushAsync(const Napi::CallbackInfo& info);
  Napi::Value End(const Napi::CallbackInfo& info);
  Napi::Value EndAsync(const Napi::CallbackInfo& info);

  Napi::ObjectReference dictionary_ref_;
  PreparedDictionary* dictionary_;
  ZSTD_CCtx_s* cctx_;
  std::mutex mutex_;
  bool ended_;
};

class ZstdDecompressor : public Napi::ObjectWrap<ZstdDecompressor> {
 public:
  static Napi::Function Init(Napi::Env env);
  ZstdDecompressor(const Napi::CallbackInfo& info);
  ~ZstdDecompressor() override;

 private:
  static Napi::FunctionReference constructor_;

  Napi::Value Push(const Napi::CallbackInfo& info);
  Napi::Value End(const Napi::CallbackInfo& info);

  Napi::Buffer<std::uint8_t> Process(Napi::Env env, const std::uint8_t* data, std::size_t size);

  Napi::ObjectReference dictionary_ref_;
  PreparedDictionary* dictionary_;
  ZSTD_DCtx_s* dctx_;
  std::size_t pending_hint_;
  bool ended_;
};

}  // namespace nodedc

#endif  // NODEDC_ZSTD_STREAM_H_
