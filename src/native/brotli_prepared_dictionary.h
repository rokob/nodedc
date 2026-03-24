#ifndef NODEDC_BROTLI_PREPARED_DICTIONARY_H_
#define NODEDC_BROTLI_PREPARED_DICTIONARY_H_

#include <napi.h>

#include <cstddef>
#include <cstdint>
#include <vector>

struct BrotliEncoderPreparedDictionaryStruct;
struct BrotliDecoderStateStruct;
struct BrotliEncoderStateStruct;

namespace nodedc {

class BrotliPreparedDictionary : public Napi::ObjectWrap<BrotliPreparedDictionary> {
 public:
  static Napi::Function Init(Napi::Env env);
  BrotliPreparedDictionary(const Napi::CallbackInfo& info);
  ~BrotliPreparedDictionary() override;

  const BrotliEncoderPreparedDictionaryStruct* prepared() const { return prepared_; }
  static std::vector<std::uint8_t> AsByteVector(const Napi::Value& value, const char* name);
  static int GetQuality(const Napi::Object& options);
  static int GetWindowBits(const Napi::Object& options);

 private:
  static Napi::FunctionReference constructor_;

  Napi::Value GetAlgorithm(const Napi::CallbackInfo& info);
  Napi::Value GetSize(const Napi::CallbackInfo& info);
  Napi::Value CompressSync(const Napi::CallbackInfo& info);
  Napi::Value DecompressSync(const Napi::CallbackInfo& info);

  static Napi::Buffer<std::uint8_t> CollectEncoderOutput(Napi::Env env,
                                                         BrotliEncoderStateStruct* state,
                                                         const std::uint8_t* data,
                                                         std::size_t size);

  std::vector<std::uint8_t> bytes_;
  BrotliEncoderPreparedDictionaryStruct* prepared_;
};

}  // namespace nodedc

#endif  // NODEDC_BROTLI_PREPARED_DICTIONARY_H_
