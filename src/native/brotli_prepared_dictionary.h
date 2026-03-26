#ifndef NODEDC_BROTLI_PREPARED_DICTIONARY_H_
#define NODEDC_BROTLI_PREPARED_DICTIONARY_H_

#include <napi.h>

#include <cstddef>
#include <cstdint>
#include <string>
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
  const std::uint8_t* bytes() const { return bytes_.data(); }
  std::size_t size() const { return bytes_.size(); }
  static std::vector<std::uint8_t> AsByteVector(const Napi::Value& value, const char* name);
  static int GetQuality(const Napi::Object& options);
  static int GetWindowBits(const Napi::Object& options);
  std::vector<std::uint8_t> CompressBytes(const std::vector<std::uint8_t>& input, int quality,
                                          int window_bits) const;
  std::vector<std::uint8_t> DecompressBytes(const std::vector<std::uint8_t>& input) const;

 private:
  static Napi::FunctionReference constructor_;

  Napi::Value GetAlgorithm(const Napi::CallbackInfo& info);
  Napi::Value GetSize(const Napi::CallbackInfo& info);
  Napi::Value Compress(const Napi::CallbackInfo& info);
  Napi::Value Decompress(const Napi::CallbackInfo& info);

  static std::vector<std::uint8_t> CollectEncoderOutput(BrotliEncoderStateStruct* state,
                                                        const std::uint8_t* data,
                                                        std::size_t size);
  static std::string DecoderErrorMessage(BrotliDecoderStateStruct* state, const char* context);

  std::vector<std::uint8_t> bytes_;
  BrotliEncoderPreparedDictionaryStruct* prepared_;
};

}  // namespace nodedc

#endif  // NODEDC_BROTLI_PREPARED_DICTIONARY_H_
