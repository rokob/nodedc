#include "prepared_dictionary.h"

#include <zstd.h>

#include <cstdint>
#include <memory>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace nodedc {

Napi::FunctionReference PreparedDictionary::constructor_;

namespace {

constexpr std::size_t kOutputChunkSize = 1U << 16;

struct CCtxDeleter {
  void operator()(ZSTD_CCtx* cctx) const {
    if (cctx != nullptr) {
      ZSTD_freeCCtx(cctx);
    }
  }
};

struct DCtxDeleter {
  void operator()(ZSTD_DCtx* dctx) const {
    if (dctx != nullptr) {
      ZSTD_freeDCtx(dctx);
    }
  }
};

using UniqueCCtx = std::unique_ptr<ZSTD_CCtx, CCtxDeleter>;
using UniqueDCtx = std::unique_ptr<ZSTD_DCtx, DCtxDeleter>;

Napi::Buffer<std::uint8_t> ToNodeBuffer(Napi::Env env, std::vector<std::uint8_t>&& output) {
  if (output.empty()) {
    return Napi::Buffer<std::uint8_t>::Copy(env, nullptr, 0);
  }

  return Napi::Buffer<std::uint8_t>::Copy(env, output.data(), output.size());
}

class CompressWorker final : public Napi::AsyncWorker {
 public:
  CompressWorker(Napi::Env env, PreparedDictionary* dictionary, Napi::Object owner,
                 std::vector<std::uint8_t>&& input, int compression_level, bool checksum)
      : Napi::AsyncWorker(env),
        deferred_(Napi::Promise::Deferred::New(env)),
        dictionary_(dictionary),
        owner_ref_(Napi::Persistent(owner)),
        input_(std::move(input)),
        compression_level_(compression_level),
        checksum_(checksum) {
    owner_ref_.SuppressDestruct();
  }

  ~CompressWorker() override { owner_ref_.Reset(); }

  Napi::Promise GetPromise() const { return deferred_.Promise(); }

  void Execute() override {
    try {
      output_ = dictionary_->CompressBytes(input_, compression_level_, checksum_);
    } catch (const std::exception& error) {
      SetError(error.what());
    }
  }

  void OnOK() override { deferred_.Resolve(ToNodeBuffer(Env(), std::move(output_))); }

  void OnError(const Napi::Error& error) override { deferred_.Reject(error.Value()); }

 private:
  Napi::Promise::Deferred deferred_;
  PreparedDictionary* dictionary_;
  Napi::ObjectReference owner_ref_;
  std::vector<std::uint8_t> input_;
  int compression_level_;
  bool checksum_;
  std::vector<std::uint8_t> output_;
};

class DecompressWorker final : public Napi::AsyncWorker {
 public:
  DecompressWorker(Napi::Env env, PreparedDictionary* dictionary, Napi::Object owner,
                   std::vector<std::uint8_t>&& input)
      : Napi::AsyncWorker(env),
        deferred_(Napi::Promise::Deferred::New(env)),
        dictionary_(dictionary),
        owner_ref_(Napi::Persistent(owner)),
        input_(std::move(input)) {
    owner_ref_.SuppressDestruct();
  }

  ~DecompressWorker() override { owner_ref_.Reset(); }

  Napi::Promise GetPromise() const { return deferred_.Promise(); }

  void Execute() override {
    try {
      output_ = dictionary_->DecompressBytes(input_);
    } catch (const std::exception& error) {
      SetError(error.what());
    }
  }

  void OnOK() override { deferred_.Resolve(ToNodeBuffer(Env(), std::move(output_))); }

  void OnError(const Napi::Error& error) override { deferred_.Reject(error.Value()); }

 private:
  Napi::Promise::Deferred deferred_;
  PreparedDictionary* dictionary_;
  Napi::ObjectReference owner_ref_;
  std::vector<std::uint8_t> input_;
  std::vector<std::uint8_t> output_;
};

}  // namespace

Napi::Function PreparedDictionary::Init(Napi::Env env) {
  Napi::Function ctor =
      DefineClass(env, "ZstdPreparedDictionary",
                  {
                      StaticMethod("className", &PreparedDictionary::GetClassName),
                      InstanceAccessor("algorithm", &PreparedDictionary::GetAlgorithm, nullptr),
                      InstanceAccessor("size", &PreparedDictionary::GetSize, nullptr),
                      InstanceMethod("compress", &PreparedDictionary::Compress),
                      InstanceMethod("decompress", &PreparedDictionary::Decompress),
                  });

  constructor_ = Napi::Persistent(ctor);
  constructor_.SuppressDestruct();
  return ctor;
}

PreparedDictionary::PreparedDictionary(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<PreparedDictionary>(info), ddict_(nullptr) {
  Napi::Env env = info.Env();

  if (info.Length() != 1 || !info[0].IsBuffer()) {
    throw Napi::TypeError::New(env, "ZstdPreparedDictionary expects a single Buffer argument.");
  }

  bytes_ = AsByteVector(info[0], "dictionary");
  if (bytes_.empty()) {
    throw Napi::TypeError::New(env, "ZstdPreparedDictionary requires a non-empty dictionary.");
  }

  ddict_ = ZSTD_createDDict(bytes_.data(), bytes_.size());
  if (!ddict_) {
    throw Napi::Error::New(env, "Failed to prepare the Zstd decompression dictionary.");
  }
}

PreparedDictionary::~PreparedDictionary() {
  for (auto& [_, cdict] : cdicts_) {
    ZSTD_freeCDict(cdict);
  }
  cdicts_.clear();

  if (ddict_ != nullptr) {
    ZSTD_freeDDict(ddict_);
    ddict_ = nullptr;
  }
}

Napi::Value PreparedDictionary::GetClassName(const Napi::CallbackInfo& info) {
  return Napi::String::New(info.Env(), "ZstdPreparedDictionary");
}

Napi::Value PreparedDictionary::GetAlgorithm(const Napi::CallbackInfo& info) {
  return Napi::String::New(info.Env(), "zstd");
}

Napi::Value PreparedDictionary::GetSize(const Napi::CallbackInfo& info) {
  return Napi::Number::New(info.Env(), static_cast<double>(bytes_.size()));
}

const ZSTD_CDict_s* PreparedDictionary::GetOrCreateCDict(int compression_level) {
  std::lock_guard<std::mutex> lock(cdict_mutex_);
  auto found = cdicts_.find(compression_level);
  if (found != cdicts_.end()) {
    return found->second;
  }

  const ZSTD_CDict* cdict = ZSTD_createCDict(bytes_.data(), bytes_.size(), compression_level);
  if (!cdict) {
    throw std::runtime_error("Failed to prepare the Zstd compression dictionary.");
  }

  auto [iter, inserted] = cdicts_.emplace(compression_level, const_cast<ZSTD_CDict_s*>(cdict));
  if (!inserted) {
    ZSTD_freeCDict(const_cast<ZSTD_CDict*>(cdict));
    throw std::runtime_error("Failed to cache the Zstd compression dictionary.");
  }

  return iter->second;
}

int PreparedDictionary::GetCompressionLevel(const Napi::Object& options) {
  Napi::Value level = options.Get("quality");
  if (level.IsUndefined()) {
    return ZSTD_CLEVEL_DEFAULT;
  }

  if (!level.IsNumber()) {
    throw std::invalid_argument("The quality option must be a number.");
  }

  return level.As<Napi::Number>().Int32Value();
}

bool PreparedDictionary::GetChecksumFlag(const Napi::Object& options) {
  Napi::Value checksum = options.Get("checksum");
  if (checksum.IsUndefined()) {
    return false;
  }

  if (!checksum.IsBoolean()) {
    throw std::invalid_argument("The checksum option must be a boolean.");
  }

  return checksum.As<Napi::Boolean>().Value();
}

std::vector<std::uint8_t> PreparedDictionary::AsByteVector(const Napi::Value& value,
                                                           const char* name) {
  if (!value.IsBuffer()) {
    throw std::invalid_argument(std::string(name) + " must be a Buffer.");
  }

  Napi::Buffer<std::uint8_t> buffer = value.As<Napi::Buffer<std::uint8_t>>();
  return std::vector<std::uint8_t>(buffer.Data(), buffer.Data() + buffer.Length());
}

void PreparedDictionary::ThrowZstdError(Napi::Env env, size_t code, const char* context) {
  if (!ZSTD_isError(code)) {
    return;
  }

  throw Napi::Error::New(env, ZstdErrorMessage(code, context));
}

std::string PreparedDictionary::ZstdErrorMessage(size_t code, const char* context) {
  return std::string(context) + ": " + ZSTD_getErrorName(code);
}

Napi::Value PreparedDictionary::Compress(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsBuffer()) {
    throw Napi::TypeError::New(env, "compress expects an input Buffer.");
  }

  auto input = AsByteVector(info[0], "input");
  Napi::Object options =
      info.Length() > 1 && info[1].IsObject() ? info[1].As<Napi::Object>() : Napi::Object::New(env);
  const int compression_level = GetCompressionLevel(options);
  const bool checksum = GetChecksumFlag(options);
  auto* worker =
      new CompressWorker(env, this, Value(), std::move(input), compression_level, checksum);
  worker->Queue();
  return worker->GetPromise();
}

std::vector<std::uint8_t> PreparedDictionary::CompressBytes(const std::vector<std::uint8_t>& input,
                                                            int compression_level,
                                                            bool checksum) {
  const ZSTD_CDict* cdict = GetOrCreateCDict(compression_level);

  UniqueCCtx cctx(ZSTD_createCCtx());
  if (!cctx) {
    throw std::runtime_error("Failed to create the Zstd compression context.");
  }

  size_t code = ZSTD_CCtx_refCDict(cctx.get(), cdict);
  if (ZSTD_isError(code)) {
    throw std::runtime_error(ZstdErrorMessage(code, "Failed to attach the Zstd dictionary"));
  }
  code = ZSTD_CCtx_setParameter(cctx.get(), ZSTD_c_contentSizeFlag, 1);
  if (ZSTD_isError(code)) {
    throw std::runtime_error(ZstdErrorMessage(code, "Failed to set the Zstd content size flag"));
  }
  code = ZSTD_CCtx_setParameter(cctx.get(), ZSTD_c_checksumFlag, checksum ? 1 : 0);
  if (ZSTD_isError(code)) {
    throw std::runtime_error(ZstdErrorMessage(code, "Failed to set the Zstd checksum flag"));
  }

  std::vector<std::uint8_t> output(ZSTD_compressBound(input.size()));
  const size_t written =
      ZSTD_compress2(cctx.get(), output.data(), output.size(), input.data(), input.size());
  if (ZSTD_isError(written)) {
    throw std::runtime_error(ZstdErrorMessage(written, "Zstd compression failed"));
  }

  output.resize(written);
  return output;
}

Napi::Value PreparedDictionary::Decompress(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsBuffer()) {
    throw Napi::TypeError::New(env, "decompress expects an input Buffer.");
  }

  auto input = AsByteVector(info[0], "input");
  auto* worker = new DecompressWorker(env, this, Value(), std::move(input));
  worker->Queue();
  return worker->GetPromise();
}

std::vector<std::uint8_t> PreparedDictionary::DecompressBytes(
    const std::vector<std::uint8_t>& input) const {
  UniqueDCtx dctx(ZSTD_createDCtx());
  if (!dctx) {
    throw std::runtime_error("Failed to create the Zstd decompression context.");
  }

  size_t code = ZSTD_DCtx_refDDict(dctx.get(), ddict_);
  if (ZSTD_isError(code)) {
    throw std::runtime_error(ZstdErrorMessage(code, "Failed to attach the Zstd dictionary"));
  }

  ZSTD_inBuffer in = {input.data(), input.size(), 0};
  std::vector<std::uint8_t> output;
  output.reserve(input.size());

  while (true) {
    const std::size_t previous_position = in.pos;
    const std::size_t previous_size = output.size();
    output.resize(previous_size + kOutputChunkSize);

    ZSTD_outBuffer out = {output.data() + previous_size, kOutputChunkSize, 0};
    const size_t remaining = ZSTD_decompressStream(dctx.get(), &out, &in);
    if (ZSTD_isError(remaining)) {
      throw std::runtime_error(ZstdErrorMessage(remaining, "Zstd decompression failed"));
    }

    output.resize(previous_size + out.pos);

    if (remaining == 0 && in.pos == in.size) {
      break;
    }

    if (in.pos == previous_position && out.pos == 0) {
      throw std::runtime_error("Zstd decompression made no progress.");
    }
  }

  return output;
}

}  // namespace nodedc
