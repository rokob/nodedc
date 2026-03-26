#include "brotli_stream.h"

#include "brotli_prepared_dictionary.h"

#include <brotli/decode.h>
#include <brotli/encode.h>
#include <brotli/shared_dictionary.h>

#include "../../vendor/brotli/c/dec/static_init.h"
#include "../../vendor/brotli/c/enc/static_init.h"

#include <cstdint>
#include <stdexcept>
#include <vector>

namespace nodedc {

Napi::FunctionReference BrotliCompressor::constructor_;
Napi::FunctionReference BrotliDecompressor::constructor_;

namespace {

constexpr std::size_t kOutputChunkSize = 1U << 16;

Napi::Buffer<std::uint8_t> ToNodeBuffer(Napi::Env env, std::vector<std::uint8_t>&& output) {
  if (output.empty()) {
    return Napi::Buffer<std::uint8_t>::Copy(env, nullptr, 0);
  }

  return Napi::Buffer<std::uint8_t>::Copy(env, output.data(), output.size());
}

Napi::Promise MakeResolvedBufferPromise(Napi::Env env, std::vector<std::uint8_t>&& output) {
  auto deferred = Napi::Promise::Deferred::New(env);
  deferred.Resolve(ToNodeBuffer(env, std::move(output)));
  return deferred.Promise();
}

class CompressWorker final : public Napi::AsyncWorker {
 public:
  CompressWorker(Napi::Env env, BrotliCompressor* compressor, Napi::Object owner,
                 std::vector<std::uint8_t>&& input, bool finish)
      : Napi::AsyncWorker(env),
        deferred_(Napi::Promise::Deferred::New(env)),
        compressor_(compressor),
        owner_ref_(Napi::Persistent(owner)),
        input_(std::move(input)),
        finish_(finish) {
    owner_ref_.SuppressDestruct();
  }

  ~CompressWorker() override { owner_ref_.Reset(); }

  Napi::Promise GetPromise() const { return deferred_.Promise(); }

  void Execute() override {
    try {
      output_ = compressor_->Process(input_.data(), input_.size(), finish_);
    } catch (const std::exception& error) {
      SetError(error.what());
    }
  }

  void OnOK() override { deferred_.Resolve(ToNodeBuffer(Env(), std::move(output_))); }

  void OnError(const Napi::Error& error) override { deferred_.Reject(error.Value()); }

 private:
  Napi::Promise::Deferred deferred_;
  BrotliCompressor* compressor_;
  Napi::ObjectReference owner_ref_;
  std::vector<std::uint8_t> input_;
  std::vector<std::uint8_t> output_;
  bool finish_;
};

}  // namespace

Napi::Function BrotliCompressor::Init(Napi::Env env) {
  Napi::Function ctor = DefineClass(env, "BrotliCompressor",
                                    {
                                        InstanceMethod("push", &BrotliCompressor::Push),
                                        InstanceMethod("pushAsync", &BrotliCompressor::PushAsync),
                                        InstanceMethod("end", &BrotliCompressor::End),
                                        InstanceMethod("endAsync", &BrotliCompressor::EndAsync),
                                    });

  constructor_ = Napi::Persistent(ctor);
  constructor_.SuppressDestruct();
  return ctor;
}

Napi::Function BrotliDecompressor::Init(Napi::Env env) {
  Napi::Function ctor = DefineClass(env, "BrotliDecompressor",
                                    {
                                        InstanceMethod("push", &BrotliDecompressor::Push),
                                        InstanceMethod("end", &BrotliDecompressor::End),
                                    });

  constructor_ = Napi::Persistent(ctor);
  constructor_.SuppressDestruct();
  return ctor;
}

BrotliCompressor::BrotliCompressor(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<BrotliCompressor>(info),
      dictionary_(nullptr),
      state_(nullptr),
      ended_(false) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsObject()) {
    throw Napi::TypeError::New(env, "BrotliCompressor expects a prepared dictionary instance.");
  }

  dictionary_ = Napi::ObjectWrap<BrotliPreparedDictionary>::Unwrap(info[0].As<Napi::Object>());
  if (dictionary_ == nullptr) {
    throw Napi::TypeError::New(env, "Invalid Brotli prepared dictionary instance.");
  }

  dictionary_ref_ = Napi::Persistent(info[0].As<Napi::Object>());
  dictionary_ref_.SuppressDestruct();

  Napi::Object options =
      info.Length() > 1 && info[1].IsObject() ? info[1].As<Napi::Object>() : Napi::Object::New(env);

  if (!BrotliEncoderEnsureStaticInit()) {
    throw Napi::Error::New(env, "Failed to initialize Brotli encoder static state.");
  }
  state_ = BrotliEncoderCreateInstance(nullptr, nullptr, nullptr);
  if (state_ == nullptr) {
    throw Napi::Error::New(env, "Failed to create the Brotli encoder state.");
  }

  const int quality = BrotliPreparedDictionary::GetQuality(options);
  const int window_bits = BrotliPreparedDictionary::GetWindowBits(options);
  if (!BrotliEncoderSetParameter(state_, BROTLI_PARAM_QUALITY, static_cast<uint32_t>(quality)) ||
      !BrotliEncoderSetParameter(state_, BROTLI_PARAM_LGWIN, static_cast<uint32_t>(window_bits)) ||
      !BrotliEncoderAttachPreparedDictionary(state_, dictionary_->prepared())) {
    BrotliEncoderDestroyInstance(state_);
    state_ = nullptr;
    throw Napi::Error::New(env, "Failed to configure the Brotli encoder state.");
  }
}

BrotliCompressor::~BrotliCompressor() {
  dictionary_ref_.Reset();
  if (state_ != nullptr) {
    BrotliEncoderDestroyInstance(state_);
    state_ = nullptr;
  }
}

Napi::Value BrotliCompressor::Push(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (ended_) {
    throw Napi::Error::New(env, "BrotliCompressor has already been ended.");
  }
  if (info.Length() != 1 || !info[0].IsBuffer()) {
    throw Napi::TypeError::New(env, "push expects a Buffer.");
  }

  const auto input = BrotliPreparedDictionary::AsByteVector(info[0], "input");
  return ToNodeBuffer(env, Process(input.data(), input.size(), false));
}

Napi::Value BrotliCompressor::PushAsync(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (ended_) {
    throw Napi::Error::New(env, "BrotliCompressor has already been ended.");
  }
  if (info.Length() != 1 || !info[0].IsBuffer()) {
    throw Napi::TypeError::New(env, "pushAsync expects a Buffer.");
  }

  auto input = BrotliPreparedDictionary::AsByteVector(info[0], "input");
  auto* worker = new CompressWorker(env, this, Value(), std::move(input), false);
  worker->Queue();
  return worker->GetPromise();
}

Napi::Value BrotliCompressor::End(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (ended_) {
    return Napi::Buffer<std::uint8_t>::Copy(env, nullptr, 0);
  }

  if (info.Length() != 0) {
    throw Napi::TypeError::New(env, "end does not accept arguments.");
  }

  ended_ = true;
  return ToNodeBuffer(env, Process(nullptr, 0, true));
}

Napi::Value BrotliCompressor::EndAsync(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (ended_) {
    return MakeResolvedBufferPromise(env, std::vector<std::uint8_t>());
  }

  if (info.Length() != 0) {
    throw Napi::TypeError::New(env, "endAsync does not accept arguments.");
  }

  ended_ = true;
  auto* worker = new CompressWorker(env, this, Value(), std::vector<std::uint8_t>(), true);
  worker->Queue();
  return worker->GetPromise();
}

std::vector<std::uint8_t> BrotliCompressor::Process(const std::uint8_t* data, std::size_t size,
                                                    bool finish) {
  std::lock_guard<std::mutex> lock(mutex_);
  size_t available_in = size;
  const uint8_t* next_in = data;
  std::vector<std::uint8_t> output;

  while (true) {
    size_t chunk_size = 0;
    const uint8_t* chunk = BrotliEncoderTakeOutput(state_, &chunk_size);
    if (chunk_size > 0) {
      output.insert(output.end(), chunk, chunk + chunk_size);
      continue;
    }

    if (finish ? BrotliEncoderIsFinished(state_)
               : (available_in == 0 && !BrotliEncoderHasMoreOutput(state_))) {
      break;
    }

    size_t available_out = 0;
    uint8_t* next_out = nullptr;
    if (!BrotliEncoderCompressStream(state_,
                                     finish ? BROTLI_OPERATION_FINISH : BROTLI_OPERATION_PROCESS,
                                     &available_in, &next_in, &available_out, &next_out, nullptr)) {
      throw std::runtime_error("Brotli streaming compression failed.");
    }

    if (!finish && available_in == 0 && !BrotliEncoderHasMoreOutput(state_)) {
      break;
    }
  }

  return output;
}

BrotliDecompressor::BrotliDecompressor(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<BrotliDecompressor>(info),
      dictionary_(nullptr),
      state_(nullptr),
      pending_input_hint_(0),
      ended_(false) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsObject()) {
    throw Napi::TypeError::New(env, "BrotliDecompressor expects a prepared dictionary instance.");
  }

  dictionary_ = Napi::ObjectWrap<BrotliPreparedDictionary>::Unwrap(info[0].As<Napi::Object>());
  if (dictionary_ == nullptr) {
    throw Napi::TypeError::New(env, "Invalid Brotli prepared dictionary instance.");
  }

  dictionary_ref_ = Napi::Persistent(info[0].As<Napi::Object>());
  dictionary_ref_.SuppressDestruct();

  if (!BrotliDecoderEnsureStaticInit()) {
    throw Napi::Error::New(env, "Failed to initialize Brotli decoder static state.");
  }

  state_ = BrotliDecoderCreateInstance(nullptr, nullptr, nullptr);
  if (state_ == nullptr) {
    throw Napi::Error::New(env, "Failed to create the Brotli decoder state.");
  }

  if (!BrotliDecoderAttachDictionary(state_, BROTLI_SHARED_DICTIONARY_RAW, dictionary_->size(),
                                     dictionary_->bytes())) {
    BrotliDecoderDestroyInstance(state_);
    state_ = nullptr;
    throw Napi::Error::New(env, "Failed to attach the Brotli dictionary.");
  }
}

BrotliDecompressor::~BrotliDecompressor() {
  dictionary_ref_.Reset();
  if (state_ != nullptr) {
    BrotliDecoderDestroyInstance(state_);
    state_ = nullptr;
  }
}

Napi::Value BrotliDecompressor::Push(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (ended_) {
    throw Napi::Error::New(env, "BrotliDecompressor has already been ended.");
  }
  if (info.Length() != 1 || !info[0].IsBuffer()) {
    throw Napi::TypeError::New(env, "push expects a Buffer.");
  }

  const auto input = BrotliPreparedDictionary::AsByteVector(info[0], "input");
  return ToNodeBuffer(env, Process(input.data(), input.size()));
}

Napi::Value BrotliDecompressor::End(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() != 0) {
    throw Napi::TypeError::New(env, "end does not accept arguments.");
  }
  if (ended_) {
    return env.Undefined();
  }

  ended_ = true;
  if (pending_input_hint_ != 0) {
    throw Napi::Error::New(env, "Incomplete Brotli stream: more input is required.");
  }

  return env.Undefined();
}

std::vector<std::uint8_t> BrotliDecompressor::Process(const std::uint8_t* data, std::size_t size) {
  size_t available_in = size;
  const uint8_t* next_in = data;
  std::vector<std::uint8_t> output;

  for (;;) {
    const std::size_t previous_size = output.size();
    output.resize(previous_size + kOutputChunkSize);

    size_t available_out = kOutputChunkSize;
    uint8_t* next_out = output.data() + previous_size;
    const BrotliDecoderResult result = BrotliDecoderDecompressStream(
        state_, &available_in, &next_in, &available_out, &next_out, nullptr);

    output.resize(previous_size + (kOutputChunkSize - available_out));

    if (result == BROTLI_DECODER_RESULT_SUCCESS) {
      pending_input_hint_ = 0;
      break;
    }

    if (result == BROTLI_DECODER_RESULT_NEEDS_MORE_OUTPUT) {
      continue;
    }

    if (result == BROTLI_DECODER_RESULT_NEEDS_MORE_INPUT) {
      pending_input_hint_ = available_in == 0 ? 1 : 0;
      break;
    }

    const BrotliDecoderErrorCode code = BrotliDecoderGetErrorCode(state_);
    const char* message = BrotliDecoderErrorString(code);
    throw std::runtime_error(std::string("Brotli streaming decompression failed: ") +
                             (message ? message : "unknown error"));
  }

  return output;
}

}  // namespace nodedc
