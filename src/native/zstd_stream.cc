#include "zstd_stream.h"

#include "prepared_dictionary.h"

#include <zstd.h>

#include <cstdint>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

namespace nodedc {

Napi::FunctionReference ZstdCompressor::constructor_;
Napi::FunctionReference ZstdDecompressor::constructor_;

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

Napi::Object RequireOptionsObject(const Napi::Env& env, const Napi::Value& value) {
  if (value.IsUndefined()) {
    return Napi::Object::New(env);
  }

  if (!value.IsObject()) {
    throw Napi::TypeError::New(env, "Expected an options object.");
  }

  return value.As<Napi::Object>();
}

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
  CompressWorker(Napi::Env env, ZstdCompressor* compressor, Napi::Object owner,
                 std::vector<std::uint8_t>&& input, bool end_frame)
      : Napi::AsyncWorker(env),
        deferred_(Napi::Promise::Deferred::New(env)),
        compressor_(compressor),
        owner_ref_(Napi::Persistent(owner)),
        input_(std::move(input)),
        end_frame_(end_frame) {
    owner_ref_.SuppressDestruct();
  }

  ~CompressWorker() override { owner_ref_.Reset(); }

  Napi::Promise GetPromise() const { return deferred_.Promise(); }

  void Execute() override {
    try {
      output_ = compressor_->Process(input_.data(), input_.size(), end_frame_);
    } catch (const std::exception& error) {
      SetError(error.what());
    }
  }

  void OnOK() override { deferred_.Resolve(ToNodeBuffer(Env(), std::move(output_))); }

  void OnError(const Napi::Error& error) override { deferred_.Reject(error.Value()); }

 private:
  Napi::Promise::Deferred deferred_;
  ZstdCompressor* compressor_;
  Napi::ObjectReference owner_ref_;
  std::vector<std::uint8_t> input_;
  std::vector<std::uint8_t> output_;
  bool end_frame_;
};

}  // namespace

Napi::Function ZstdCompressor::Init(Napi::Env env) {
  Napi::Function ctor = DefineClass(env, "ZstdCompressor",
                                    {
                                        InstanceMethod("push", &ZstdCompressor::Push),
                                        InstanceMethod("pushAsync", &ZstdCompressor::PushAsync),
                                        InstanceMethod("end", &ZstdCompressor::End),
                                        InstanceMethod("endAsync", &ZstdCompressor::EndAsync),
                                    });

  constructor_ = Napi::Persistent(ctor);
  constructor_.SuppressDestruct();
  return ctor;
}

ZstdCompressor::ZstdCompressor(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<ZstdCompressor>(info), dictionary_(nullptr), cctx_(nullptr), ended_(false) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsObject()) {
    throw Napi::TypeError::New(env, "ZstdCompressor expects a prepared dictionary instance.");
  }

  dictionary_ = Napi::ObjectWrap<PreparedDictionary>::Unwrap(info[0].As<Napi::Object>());
  if (dictionary_ == nullptr) {
    throw Napi::TypeError::New(env, "Invalid prepared dictionary instance.");
  }

  dictionary_ref_ = Napi::Persistent(info[0].As<Napi::Object>());
  dictionary_ref_.SuppressDestruct();

  Napi::Object options =
      info.Length() > 1 ? RequireOptionsObject(env, info[1]) : Napi::Object::New(env);

  cctx_ = ZSTD_createCCtx();
  if (cctx_ == nullptr) {
    throw Napi::Error::New(env, "Failed to create the Zstd compression context.");
  }

  const int compression_level = PreparedDictionary::GetCompressionLevel(options);
  const bool checksum = PreparedDictionary::GetChecksumFlag(options);
  const ZSTD_CDict* cdict = dictionary_->GetOrCreateCDict(compression_level);

  PreparedDictionary::ThrowZstdError(env, ZSTD_CCtx_refCDict(cctx_, cdict),
                                     "Failed to attach the Zstd dictionary");
  PreparedDictionary::ThrowZstdError(env, ZSTD_CCtx_setParameter(cctx_, ZSTD_c_contentSizeFlag, 0),
                                     "Failed to disable the Zstd content size flag for streaming");
  PreparedDictionary::ThrowZstdError(
      env, ZSTD_CCtx_setParameter(cctx_, ZSTD_c_checksumFlag, checksum ? 1 : 0),
      "Failed to set the Zstd checksum flag");
}

ZstdCompressor::~ZstdCompressor() {
  dictionary_ref_.Reset();
  if (cctx_ != nullptr) {
    ZSTD_freeCCtx(cctx_);
    cctx_ = nullptr;
  }
}

Napi::Value ZstdCompressor::Push(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (ended_) {
    throw Napi::Error::New(env, "ZstdCompressor has already been ended.");
  }
  if (info.Length() != 1 || !info[0].IsBuffer()) {
    throw Napi::TypeError::New(env, "push expects a Buffer.");
  }

  const auto input = PreparedDictionary::AsByteVector(info[0], "input");
  return ToNodeBuffer(env, Process(input.data(), input.size(), false));
}

Napi::Value ZstdCompressor::PushAsync(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (ended_) {
    throw Napi::Error::New(env, "ZstdCompressor has already been ended.");
  }
  if (info.Length() != 1 || !info[0].IsBuffer()) {
    throw Napi::TypeError::New(env, "pushAsync expects a Buffer.");
  }

  auto input = PreparedDictionary::AsByteVector(info[0], "input");
  auto* worker = new CompressWorker(env, this, Value(), std::move(input), false);
  worker->Queue();
  return worker->GetPromise();
}

Napi::Value ZstdCompressor::End(const Napi::CallbackInfo& info) {
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

Napi::Value ZstdCompressor::EndAsync(const Napi::CallbackInfo& info) {
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

std::vector<std::uint8_t> ZstdCompressor::Process(const std::uint8_t* data, std::size_t size,
                                                  bool end_frame) {
  std::lock_guard<std::mutex> lock(mutex_);
  ZSTD_inBuffer in = {data, size, 0};
  std::vector<std::uint8_t> output;

  while (true) {
    const std::size_t previous_in = in.pos;
    const std::size_t previous_size = output.size();
    output.resize(previous_size + kOutputChunkSize);

    ZSTD_outBuffer out = {output.data() + previous_size, kOutputChunkSize, 0};
    const size_t remaining =
        ZSTD_compressStream2(cctx_, &out, &in, end_frame ? ZSTD_e_end : ZSTD_e_continue);
    if (ZSTD_isError(remaining) != 0U) {
      throw std::runtime_error(std::string("Zstd streaming compression failed: ") +
                               ZSTD_getErrorName(remaining));
    }

    output.resize(previous_size + out.pos);

    if (end_frame) {
      if (remaining == 0) {
        break;
      }
    } else if (in.pos == in.size) {
      break;
    }

    if (in.pos == previous_in && out.pos == 0) {
      throw std::runtime_error("Zstd streaming compression made no progress.");
    }
  }

  return output;
}

Napi::Function ZstdDecompressor::Init(Napi::Env env) {
  Napi::Function ctor = DefineClass(env, "ZstdDecompressor",
                                    {
                                        InstanceMethod("push", &ZstdDecompressor::Push),
                                        InstanceMethod("end", &ZstdDecompressor::End),
                                    });

  constructor_ = Napi::Persistent(ctor);
  constructor_.SuppressDestruct();
  return ctor;
}

ZstdDecompressor::ZstdDecompressor(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<ZstdDecompressor>(info),
      dictionary_(nullptr),
      dctx_(nullptr),
      pending_hint_(0),
      ended_(false) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsObject()) {
    throw Napi::TypeError::New(env, "ZstdDecompressor expects a prepared dictionary instance.");
  }

  dictionary_ = Napi::ObjectWrap<PreparedDictionary>::Unwrap(info[0].As<Napi::Object>());
  if (dictionary_ == nullptr) {
    throw Napi::TypeError::New(env, "Invalid prepared dictionary instance.");
  }

  dictionary_ref_ = Napi::Persistent(info[0].As<Napi::Object>());
  dictionary_ref_.SuppressDestruct();

  dctx_ = ZSTD_createDCtx();
  if (dctx_ == nullptr) {
    throw Napi::Error::New(env, "Failed to create the Zstd decompression context.");
  }

  PreparedDictionary::ThrowZstdError(env, ZSTD_DCtx_refDDict(dctx_, dictionary_->ddict()),
                                     "Failed to attach the Zstd dictionary");
}

ZstdDecompressor::~ZstdDecompressor() {
  dictionary_ref_.Reset();
  if (dctx_ != nullptr) {
    ZSTD_freeDCtx(dctx_);
    dctx_ = nullptr;
  }
}

Napi::Value ZstdDecompressor::Push(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (ended_) {
    throw Napi::Error::New(env, "ZstdDecompressor has already been ended.");
  }
  if (info.Length() != 1 || !info[0].IsBuffer()) {
    throw Napi::TypeError::New(env, "push expects a Buffer.");
  }

  const auto input = PreparedDictionary::AsByteVector(info[0], "input");
  return Process(env, input.data(), input.size());
}

Napi::Value ZstdDecompressor::End(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() != 0) {
    throw Napi::TypeError::New(env, "end does not accept arguments.");
  }
  if (ended_) {
    return env.Undefined();
  }

  ended_ = true;
  if (pending_hint_ != 0) {
    throw Napi::Error::New(env, "Incomplete Zstd stream: more input is required.");
  }

  return env.Undefined();
}

Napi::Buffer<std::uint8_t> ZstdDecompressor::Process(Napi::Env env, const std::uint8_t* data,
                                                     std::size_t size) {
  ZSTD_inBuffer in = {data, size, 0};
  std::vector<std::uint8_t> output;

  while (in.pos < in.size) {
    const std::size_t previous_in = in.pos;
    const std::size_t previous_size = output.size();
    output.resize(previous_size + kOutputChunkSize);

    ZSTD_outBuffer out = {output.data() + previous_size, kOutputChunkSize, 0};
    pending_hint_ = ZSTD_decompressStream(dctx_, &out, &in);
    PreparedDictionary::ThrowZstdError(env, pending_hint_, "Zstd streaming decompression failed");

    output.resize(previous_size + out.pos);

    if (in.pos == previous_in && out.pos == 0) {
      throw Napi::Error::New(env, "Zstd streaming decompression made no progress.");
    }
  }

  return Napi::Buffer<std::uint8_t>::Copy(env, output.data(), output.size());
}

}  // namespace nodedc
