#include "brotli_prepared_dictionary.h"

#include <brotli/decode.h>
#include <brotli/encode.h>
#include <brotli/shared_dictionary.h>

#include "../../vendor/brotli/c/dec/static_init.h"
#include "../../vendor/brotli/c/enc/static_init.h"

#include <cstdint>
#include <stdexcept>
#include <string>
#include <vector>

namespace nodedc {

Napi::FunctionReference BrotliPreparedDictionary::constructor_;

namespace {

constexpr std::size_t kOutputChunkSize = 1U << 16;

Napi::Buffer<std::uint8_t> ToNodeBuffer(Napi::Env env, std::vector<std::uint8_t>&& output) {
  if (output.empty()) {
    return Napi::Buffer<std::uint8_t>::Copy(env, nullptr, 0);
  }

  return Napi::Buffer<std::uint8_t>::Copy(env, output.data(), output.size());
}

class CompressWorker final : public Napi::AsyncWorker {
 public:
  CompressWorker(Napi::Env env, BrotliPreparedDictionary* dictionary, Napi::Object owner,
                 std::vector<std::uint8_t>&& input, int quality, int window_bits)
      : Napi::AsyncWorker(env),
        deferred_(Napi::Promise::Deferred::New(env)),
        dictionary_(dictionary),
        owner_ref_(Napi::Persistent(owner)),
        input_(std::move(input)),
        quality_(quality),
        window_bits_(window_bits) {
    owner_ref_.SuppressDestruct();
  }

  ~CompressWorker() override { owner_ref_.Reset(); }

  Napi::Promise GetPromise() const { return deferred_.Promise(); }

  void Execute() override {
    try {
      output_ = dictionary_->CompressBytes(input_, quality_, window_bits_);
    } catch (const std::exception& error) {
      SetError(error.what());
    }
  }

  void OnOK() override { deferred_.Resolve(ToNodeBuffer(Env(), std::move(output_))); }

  void OnError(const Napi::Error& error) override { deferred_.Reject(error.Value()); }

 private:
  Napi::Promise::Deferred deferred_;
  BrotliPreparedDictionary* dictionary_;
  Napi::ObjectReference owner_ref_;
  std::vector<std::uint8_t> input_;
  int quality_;
  int window_bits_;
  std::vector<std::uint8_t> output_;
};

class DecompressWorker final : public Napi::AsyncWorker {
 public:
  DecompressWorker(Napi::Env env, BrotliPreparedDictionary* dictionary, Napi::Object owner,
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
  BrotliPreparedDictionary* dictionary_;
  Napi::ObjectReference owner_ref_;
  std::vector<std::uint8_t> input_;
  std::vector<std::uint8_t> output_;
};

}  // namespace

Napi::Function BrotliPreparedDictionary::Init(Napi::Env env) {
  Napi::Function ctor = DefineClass(
      env, "BrotliPreparedDictionary",
      {
          InstanceAccessor("algorithm", &BrotliPreparedDictionary::GetAlgorithm, nullptr),
          InstanceAccessor("size", &BrotliPreparedDictionary::GetSize, nullptr),
          InstanceMethod("compress", &BrotliPreparedDictionary::Compress),
          InstanceMethod("decompress", &BrotliPreparedDictionary::Decompress),
      });

  constructor_ = Napi::Persistent(ctor);
  constructor_.SuppressDestruct();
  return ctor;
}

BrotliPreparedDictionary::BrotliPreparedDictionary(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<BrotliPreparedDictionary>(info), prepared_(nullptr) {
  Napi::Env env = info.Env();

  if (info.Length() != 1 || !info[0].IsBuffer()) {
    throw Napi::TypeError::New(env, "BrotliPreparedDictionary expects a single Buffer argument.");
  }

  bytes_ = AsByteVector(info[0], "dictionary");
  if (bytes_.empty()) {
    throw Napi::TypeError::New(env, "BrotliPreparedDictionary requires a non-empty dictionary.");
  }

  prepared_ =
      BrotliEncoderPrepareDictionary(BROTLI_SHARED_DICTIONARY_RAW, bytes_.size(), bytes_.data(),
                                     BROTLI_MAX_QUALITY, nullptr, nullptr, nullptr);

  if (prepared_ == nullptr) {
    throw Napi::Error::New(env, "Failed to prepare the Brotli dictionary.");
  }
}

BrotliPreparedDictionary::~BrotliPreparedDictionary() {
  if (prepared_ != nullptr) {
    BrotliEncoderDestroyPreparedDictionary(prepared_);
    prepared_ = nullptr;
  }
}

Napi::Value BrotliPreparedDictionary::GetAlgorithm(const Napi::CallbackInfo& info) {
  return Napi::String::New(info.Env(), "brotli");
}

Napi::Value BrotliPreparedDictionary::GetSize(const Napi::CallbackInfo& info) {
  return Napi::Number::New(info.Env(), static_cast<double>(bytes_.size()));
}

std::vector<std::uint8_t> BrotliPreparedDictionary::AsByteVector(const Napi::Value& value,
                                                                 const char* name) {
  if (!value.IsBuffer()) {
    throw std::invalid_argument(std::string(name) + " must be a Buffer.");
  }

  Napi::Buffer<std::uint8_t> buffer = value.As<Napi::Buffer<std::uint8_t>>();
  return std::vector<std::uint8_t>(buffer.Data(), buffer.Data() + buffer.Length());
}

int BrotliPreparedDictionary::GetQuality(const Napi::Object& options) {
  Napi::Value quality = options.Get("quality");
  if (quality.IsUndefined()) {
    return BROTLI_DEFAULT_QUALITY;
  }
  if (!quality.IsNumber()) {
    throw std::invalid_argument("The quality option must be a number.");
  }
  return quality.As<Napi::Number>().Int32Value();
}

int BrotliPreparedDictionary::GetWindowBits(const Napi::Object& options) {
  Napi::Value window = options.Get("windowBits");
  if (window.IsUndefined()) {
    return BROTLI_DEFAULT_WINDOW;
  }
  if (!window.IsNumber()) {
    throw std::invalid_argument("The windowBits option must be a number.");
  }
  return window.As<Napi::Number>().Int32Value();
}

std::vector<std::uint8_t> BrotliPreparedDictionary::CollectEncoderOutput(
    BrotliEncoderState* state, const std::uint8_t* data, std::size_t size) {
  std::vector<std::uint8_t> output;
  size_t available_in = size;
  const uint8_t* next_in = data;

  while (true) {
    size_t chunk_size = 0;
    const uint8_t* chunk = BrotliEncoderTakeOutput(state, &chunk_size);
    if (chunk_size > 0) {
      output.insert(output.end(), chunk, chunk + chunk_size);
      continue;
    }

    if (BrotliEncoderIsFinished(state)) {
      break;
    }

    size_t available_out = 0;
    uint8_t* next_out = nullptr;
    if (!BrotliEncoderCompressStream(
            state, available_in == 0 ? BROTLI_OPERATION_FINISH : BROTLI_OPERATION_PROCESS,
            &available_in, &next_in, &available_out, &next_out, nullptr)) {
      throw std::runtime_error("Brotli compression failed.");
    }
  }

  return output;
}

std::string BrotliPreparedDictionary::DecoderErrorMessage(BrotliDecoderState* state,
                                                          const char* context) {
  const BrotliDecoderErrorCode code = BrotliDecoderGetErrorCode(state);
  const char* message = BrotliDecoderErrorString(code);
  return std::string(context) + ": " + (message ? message : "unknown error");
}

Napi::Value BrotliPreparedDictionary::Compress(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsBuffer()) {
    throw Napi::TypeError::New(env, "compress expects an input Buffer.");
  }

  auto input = AsByteVector(info[0], "input");
  Napi::Object options =
      info.Length() > 1 && info[1].IsObject() ? info[1].As<Napi::Object>() : Napi::Object::New(env);
  const int quality = GetQuality(options);
  const int window_bits = GetWindowBits(options);
  auto* worker = new CompressWorker(env, this, Value(), std::move(input), quality, window_bits);
  worker->Queue();
  return worker->GetPromise();
}

std::vector<std::uint8_t> BrotliPreparedDictionary::CompressBytes(
    const std::vector<std::uint8_t>& input, int quality, int window_bits) const {
  if (!BrotliEncoderEnsureStaticInit()) {
    throw std::runtime_error("Failed to initialize Brotli encoder static state.");
  }
  BrotliEncoderState* state = BrotliEncoderCreateInstance(nullptr, nullptr, nullptr);
  if (state == nullptr) {
    throw std::runtime_error("Failed to create the Brotli encoder state.");
  }

  if (!BrotliEncoderSetParameter(state, BROTLI_PARAM_QUALITY, static_cast<uint32_t>(quality)) ||
      !BrotliEncoderSetParameter(state, BROTLI_PARAM_LGWIN, static_cast<uint32_t>(window_bits)) ||
      !BrotliEncoderAttachPreparedDictionary(state, prepared_)) {
    BrotliEncoderDestroyInstance(state);
    throw std::runtime_error("Failed to configure the Brotli encoder state.");
  }

  std::vector<std::uint8_t> result = CollectEncoderOutput(state, input.data(), input.size());
  BrotliEncoderDestroyInstance(state);
  return result;
}

Napi::Value BrotliPreparedDictionary::Decompress(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsBuffer()) {
    throw Napi::TypeError::New(env, "decompress expects an input Buffer.");
  }

  auto input = AsByteVector(info[0], "input");
  auto* worker = new DecompressWorker(env, this, Value(), std::move(input));
  worker->Queue();
  return worker->GetPromise();
}

std::vector<std::uint8_t> BrotliPreparedDictionary::DecompressBytes(
    const std::vector<std::uint8_t>& input) const {
  if (!BrotliDecoderEnsureStaticInit()) {
    throw std::runtime_error("Failed to initialize Brotli decoder static state.");
  }
  BrotliDecoderState* state = BrotliDecoderCreateInstance(nullptr, nullptr, nullptr);
  if (state == nullptr) {
    throw std::runtime_error("Failed to create the Brotli decoder state.");
  }

  if (!BrotliDecoderAttachDictionary(state, BROTLI_SHARED_DICTIONARY_RAW, bytes_.size(),
                                     bytes_.data())) {
    BrotliDecoderDestroyInstance(state);
    throw std::runtime_error("Failed to attach the Brotli dictionary.");
  }

  size_t available_in = input.size();
  const uint8_t* next_in = input.data();
  std::vector<std::uint8_t> output;

  for (;;) {
    const std::size_t previous_size = output.size();
    output.resize(previous_size + kOutputChunkSize);

    size_t available_out = kOutputChunkSize;
    uint8_t* next_out = output.data() + previous_size;
    BrotliDecoderResult result = BrotliDecoderDecompressStream(state, &available_in, &next_in,
                                                               &available_out, &next_out, nullptr);

    output.resize(previous_size + (kOutputChunkSize - available_out));

    if (result == BROTLI_DECODER_RESULT_SUCCESS) {
      break;
    }
    if (result == BROTLI_DECODER_RESULT_NEEDS_MORE_OUTPUT) {
      continue;
    }
    if (result == BROTLI_DECODER_RESULT_NEEDS_MORE_INPUT) {
      if (available_in == 0) {
        BrotliDecoderDestroyInstance(state);
        throw std::runtime_error("Incomplete Brotli stream: more input is required.");
      }
      continue;
    }

    const std::string message = DecoderErrorMessage(state, "Brotli decompression failed");
    BrotliDecoderDestroyInstance(state);
    throw std::runtime_error(message);
  }

  BrotliDecoderDestroyInstance(state);
  return output;
}

}  // namespace nodedc
