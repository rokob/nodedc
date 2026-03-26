#ifndef NODEDC_PREPARED_DICTIONARY_H_
#define NODEDC_PREPARED_DICTIONARY_H_

#include <napi.h>

#include <cstddef>
#include <cstdint>
#include <mutex>
#include <string>
#include <unordered_map>
#include <vector>

struct ZSTD_CDict_s;
struct ZSTD_DDict_s;

namespace nodedc {

class PreparedDictionary : public Napi::ObjectWrap<PreparedDictionary> {
 public:
 static Napi::Function Init(Napi::Env env);
  PreparedDictionary(const Napi::CallbackInfo& info);
  ~PreparedDictionary() override;

  const ZSTD_DDict_s* ddict() const { return ddict_; }
  const ZSTD_CDict_s* GetOrCreateCDict(int compression_level);
  static int GetCompressionLevel(const Napi::Object& options);
  static bool GetChecksumFlag(const Napi::Object& options);
  static std::vector<std::uint8_t> AsByteVector(const Napi::Value& value, const char* name);
  static void ThrowZstdError(Napi::Env env, size_t code, const char* context);
  static std::string ZstdErrorMessage(size_t code, const char* context);
  std::vector<std::uint8_t> CompressBytes(const std::vector<std::uint8_t>& input,
                                          int compression_level, bool checksum);
  std::vector<std::uint8_t> DecompressBytes(const std::vector<std::uint8_t>& input) const;

 private:
  static Napi::FunctionReference constructor_;

  static Napi::Value GetClassName(const Napi::CallbackInfo& info);
  Napi::Value GetAlgorithm(const Napi::CallbackInfo& info);
  Napi::Value GetSize(const Napi::CallbackInfo& info);

  Napi::Value Compress(const Napi::CallbackInfo& info);
  Napi::Value Decompress(const Napi::CallbackInfo& info);

  std::vector<std::uint8_t> bytes_;
  ZSTD_DDict_s* ddict_;
  mutable std::mutex cdict_mutex_;
  std::unordered_map<int, ZSTD_CDict_s*> cdicts_;
};

}  // namespace nodedc

#endif  // NODEDC_PREPARED_DICTIONARY_H_
