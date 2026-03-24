#include "brotli_stream.h"

#include "brotli_prepared_dictionary.h"

#include <brotli/encode.h>

#include "../../vendor/brotli/c/enc/static_init.h"

#include <cstdint>
#include <vector>

namespace nodedc {

Napi::FunctionReference BrotliCompressor::constructor_;

Napi::Function BrotliCompressor::Init(Napi::Env env) {
  Napi::Function ctor = DefineClass(env, "BrotliCompressor",
                                    {
                                        InstanceMethod("push", &BrotliCompressor::Push),
                                        InstanceMethod("end", &BrotliCompressor::End),
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
  return Process(env, input.data(), input.size(), false);
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
  return Process(env, nullptr, 0, true);
}

Napi::Buffer<std::uint8_t> BrotliCompressor::Process(Napi::Env env, const std::uint8_t* data,
                                                     std::size_t size, bool finish) {
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
      throw Napi::Error::New(env, "Brotli streaming compression failed.");
    }

    if (!finish && available_in == 0 && !BrotliEncoderHasMoreOutput(state_)) {
      break;
    }
  }

  return Napi::Buffer<std::uint8_t>::Copy(env, output.data(), output.size());
}

}  // namespace nodedc
