#ifndef NODEDC_BROTLI_STREAM_H_
#define NODEDC_BROTLI_STREAM_H_

#include <napi.h>

#include <cstddef>
#include <cstdint>
#include <mutex>
#include <vector>

struct BrotliEncoderStateStruct;
struct BrotliDecoderStateStruct;

namespace nodedc {

class BrotliPreparedDictionary;

class BrotliCompressor : public Napi::ObjectWrap<BrotliCompressor> {
 public:
  static Napi::Function Init(Napi::Env env);
  BrotliCompressor(const Napi::CallbackInfo& info);
  ~BrotliCompressor() override;
  std::vector<std::uint8_t> Process(const std::uint8_t* data, std::size_t size, bool finish);

 private:
  static Napi::FunctionReference constructor_;

  Napi::Value Push(const Napi::CallbackInfo& info);
  Napi::Value PushAsync(const Napi::CallbackInfo& info);
  Napi::Value End(const Napi::CallbackInfo& info);
  Napi::Value EndAsync(const Napi::CallbackInfo& info);

  Napi::ObjectReference dictionary_ref_;
  BrotliPreparedDictionary* dictionary_;
  BrotliEncoderStateStruct* state_;
  std::mutex mutex_;
  bool ended_;
};

class BrotliDecompressor : public Napi::ObjectWrap<BrotliDecompressor> {
 public:
  static Napi::Function Init(Napi::Env env);
  BrotliDecompressor(const Napi::CallbackInfo& info);
  ~BrotliDecompressor() override;
  std::vector<std::uint8_t> Process(const std::uint8_t* data, std::size_t size);

 private:
  static Napi::FunctionReference constructor_;

  Napi::Value Push(const Napi::CallbackInfo& info);
  Napi::Value End(const Napi::CallbackInfo& info);

  Napi::ObjectReference dictionary_ref_;
  BrotliPreparedDictionary* dictionary_;
  BrotliDecoderStateStruct* state_;
  std::size_t pending_input_hint_;
  bool ended_;
};

}  // namespace nodedc

#endif  // NODEDC_BROTLI_STREAM_H_
