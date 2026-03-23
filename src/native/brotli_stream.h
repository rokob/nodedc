#ifndef NODEDC_BROTLI_STREAM_H_
#define NODEDC_BROTLI_STREAM_H_

#include <napi.h>

#include <cstddef>
#include <cstdint>

struct BrotliEncoderStateStruct;

namespace nodedc {

class BrotliPreparedDictionary;

class BrotliCompressor : public Napi::ObjectWrap<BrotliCompressor> {
 public:
  static Napi::Function Init(Napi::Env env);
  BrotliCompressor(const Napi::CallbackInfo& info);
  ~BrotliCompressor() override;

 private:
  static Napi::FunctionReference constructor_;

  Napi::Value Push(const Napi::CallbackInfo& info);
  Napi::Value End(const Napi::CallbackInfo& info);

  Napi::Buffer<std::uint8_t> Process(
      Napi::Env env,
      const std::uint8_t* data,
      std::size_t size,
      bool finish);

  Napi::ObjectReference dictionary_ref_;
  BrotliPreparedDictionary* dictionary_;
  BrotliEncoderStateStruct* state_;
  bool ended_;
};

}  // namespace nodedc

#endif  // NODEDC_BROTLI_STREAM_H_

