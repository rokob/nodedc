#include "brotli_trainer.h"

#include "../../vendor/brotli/research/deorummolae.h"
#include "../../vendor/brotli/research/durchschlag.h"
#include "../../vendor/brotli/research/sieve.h"

#include <napi.h>

#include <cstdint>
#include <stdexcept>
#include <string>
#include <vector>

namespace nodedc {

namespace {

enum class BrotliTrainerEngine {
  kDm,
  kDsh,
  kSieve,
};

struct BrotliTrainOptions {
  BrotliTrainerEngine engine = BrotliTrainerEngine::kDsh;
  std::size_t block_len = 1024;
  std::size_t slice_len = 16;
  std::size_t target_dict_len = 16U << 10;
  std::size_t min_slice_pop = 2;
  std::size_t chunk_len = 0;
  std::size_t overlap_len = 0;
};

std::size_t GetSizeOption(const Napi::Object& options, const char* name, std::size_t fallback) {
  Napi::Value value = options.Get(name);
  if (value.IsUndefined()) {
    return fallback;
  }
  if (!value.IsNumber()) {
    throw std::invalid_argument(std::string(name) + " must be a number.");
  }
  const int64_t parsed = value.As<Napi::Number>().Int64Value();
  if (parsed < 0) {
    throw std::invalid_argument(std::string(name) + " must be non-negative.");
  }
  return static_cast<std::size_t>(parsed);
}

BrotliTrainOptions ParseOptions(const Napi::Env env, const Napi::Value& value) {
  BrotliTrainOptions options;
  if (value.IsUndefined()) {
    return options;
  }
  if (!value.IsObject()) {
    throw Napi::TypeError::New(env, "trainBrotliSync options must be an object.");
  }

  Napi::Object object = value.As<Napi::Object>();
  Napi::Value engine = object.Get("engine");
  if (!engine.IsUndefined()) {
    if (!engine.IsString()) {
      throw Napi::TypeError::New(env, "engine must be a string.");
    }
    const std::string parsed = engine.As<Napi::String>().Utf8Value();
    if (parsed == "dm") {
      options.engine = BrotliTrainerEngine::kDm;
    } else if (parsed == "sieve") {
      options.engine = BrotliTrainerEngine::kSieve;
    } else if (parsed == "dsh") {
      options.engine = BrotliTrainerEngine::kDsh;
    } else {
      throw Napi::TypeError::New(env, "engine must be one of: dm, dsh, sieve.");
    }
  }

  options.block_len = GetSizeOption(object, "blockLen", options.block_len);
  options.slice_len = GetSizeOption(object, "sliceLen", options.slice_len);
  options.target_dict_len = GetSizeOption(object, "targetDictLen", options.target_dict_len);
  options.min_slice_pop = GetSizeOption(object, "minSlicePop", options.min_slice_pop);
  options.chunk_len = GetSizeOption(object, "chunkLen", options.chunk_len);
  options.overlap_len = GetSizeOption(object, "overlapLen", options.overlap_len);

  if (options.target_dict_len < 256) {
    throw Napi::TypeError::New(env, "targetDictLen must be at least 256 bytes.");
  }
  if (options.slice_len < 4 || options.slice_len > 256) {
    throw Napi::TypeError::New(env, "sliceLen must be in the range [4, 256].");
  }
  if (options.block_len < 16 || options.block_len > 65536) {
    throw Napi::TypeError::New(env, "blockLen must be in the range [16, 65536].");
  }
  if (options.chunk_len != 0 && options.chunk_len <= options.overlap_len) {
    throw Napi::TypeError::New(env, "chunkLen must be greater than overlapLen.");
  }

  return options;
}

void AppendSample(
    Napi::Env env,
    const Napi::Value& value,
    std::size_t chunk_len,
    std::size_t overlap_len,
    std::vector<std::size_t>* sample_sizes,
    std::vector<std::uint8_t>* sample_data) {
  if (!value.IsBuffer()) {
    throw Napi::TypeError::New(env, "trainBrotliSync samples must be Buffers.");
  }
  Napi::Buffer<std::uint8_t> buffer = value.As<Napi::Buffer<std::uint8_t>>();
  if (buffer.Length() == 0) {
    throw Napi::TypeError::New(env, "trainBrotliSync does not support empty samples.");
  }

  if (chunk_len == 0) {
    sample_sizes->push_back(buffer.Length());
    sample_data->insert(sample_data->end(), buffer.Data(), buffer.Data() + buffer.Length());
    return;
  }

  for (std::size_t offset = 0; offset < buffer.Length(); offset += chunk_len - overlap_len) {
    const std::size_t size = std::min<std::size_t>(chunk_len, buffer.Length() - offset);
    sample_sizes->push_back(size);
    sample_data->insert(sample_data->end(), buffer.Data() + offset, buffer.Data() + offset + size);
    if (offset + size >= buffer.Length()) {
      break;
    }
  }
}

Napi::Value TrainBrotliSync(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsArray()) {
    throw Napi::TypeError::New(env, "trainBrotliSync expects an array of Buffers.");
  }

  const BrotliTrainOptions options = ParseOptions(env, info.Length() > 1 ? info[1] : env.Undefined());
  Napi::Array array = info[0].As<Napi::Array>();
  const uint32_t sample_count = array.Length();
  if (sample_count == 0) {
    throw Napi::TypeError::New(env, "trainBrotliSync requires at least one sample.");
  }

  std::vector<std::size_t> sample_sizes;
  std::vector<std::uint8_t> sample_data;
  for (uint32_t i = 0; i < sample_count; ++i) {
    AppendSample(env, array.Get(i), options.chunk_len, options.overlap_len, &sample_sizes, &sample_data);
  }

  std::string dictionary;
  switch (options.engine) {
    case BrotliTrainerEngine::kDm:
      dictionary = DM_generate(options.target_dict_len, sample_sizes, sample_data.data());
      break;
    case BrotliTrainerEngine::kSieve:
      dictionary = sieve_generate(options.target_dict_len, options.slice_len, sample_sizes, sample_data.data());
      break;
    case BrotliTrainerEngine::kDsh:
      dictionary = durchschlag_generate(
          options.target_dict_len,
          options.slice_len,
          options.block_len,
          sample_sizes,
          sample_data.data());
      break;
  }

  if (dictionary.empty()) {
    throw Napi::Error::New(env, "Brotli dictionary training failed.");
  }

  Napi::Object output = Napi::Object::New(env);
  output.Set(
      "dictionary",
      Napi::Buffer<std::uint8_t>::Copy(
          env,
          reinterpret_cast<const std::uint8_t*>(dictionary.data()),
          dictionary.size()));
  output.Set("size", Napi::Number::New(env, static_cast<double>(dictionary.size())));
  return output;
}

}  // namespace

void RegisterBrotliTraining(Napi::Env env, Napi::Object exports) {
  exports.Set("hasBrotliTrainer", Napi::Boolean::New(env, true));
  exports.Set("trainBrotliSync", Napi::Function::New(env, TrainBrotliSync));
}

}  // namespace nodedc
