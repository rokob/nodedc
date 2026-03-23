#include "zstd_trainer.h"

#include <napi.h>

#include "../../vendor/zstd/lib/zdict.h"

#include <cstddef>
#include <cstdint>
#include <stdexcept>
#include <string>
#include <vector>

namespace nodedc {

namespace {

struct ZstdTrainOptions {
  std::size_t dict_size = 110U * 1024U;
  int compression_level = 3;
  unsigned notification_level = 0;
  unsigned dict_id = 0;
  bool has_dict_id = false;
  unsigned k = 0;
  unsigned d = 0;
  unsigned steps = 0;
  unsigned f = 0;
  unsigned accel = 0;
  double split_point = 1.0;
  unsigned shrink = 0;
  unsigned shrink_max_regression = 0;
};

unsigned GetUnsignedOption(const Napi::Object& options, const char* name) {
  Napi::Value value = options.Get(name);
  if (value.IsUndefined()) {
    return 0;
  }
  if (!value.IsNumber()) {
    throw std::invalid_argument(std::string(name) + " must be a number.");
  }
  const int64_t parsed = value.As<Napi::Number>().Int64Value();
  if (parsed < 0) {
    throw std::invalid_argument(std::string(name) + " must be non-negative.");
  }
  return static_cast<unsigned>(parsed);
}

int GetIntOption(const Napi::Object& options, const char* name, int fallback) {
  Napi::Value value = options.Get(name);
  if (value.IsUndefined()) {
    return fallback;
  }
  if (!value.IsNumber()) {
    throw std::invalid_argument(std::string(name) + " must be a number.");
  }
  return value.As<Napi::Number>().Int32Value();
}

double GetDoubleOption(const Napi::Object& options, const char* name, double fallback) {
  Napi::Value value = options.Get(name);
  if (value.IsUndefined()) {
    return fallback;
  }
  if (!value.IsNumber()) {
    throw std::invalid_argument(std::string(name) + " must be a number.");
  }
  return value.As<Napi::Number>().DoubleValue();
}

ZstdTrainOptions ParseOptions(const Napi::Env env, const Napi::Value& value) {
  ZstdTrainOptions options;
  if (value.IsUndefined()) {
    return options;
  }
  if (!value.IsObject()) {
    throw Napi::TypeError::New(env, "trainZstdSync options must be an object.");
  }

  Napi::Object object = value.As<Napi::Object>();
  const unsigned dict_size = GetUnsignedOption(object, "dictSize");
  if (dict_size != 0) {
    options.dict_size = dict_size;
  }
  options.compression_level = GetIntOption(object, "compressionLevel", options.compression_level);
  options.notification_level = GetUnsignedOption(object, "notificationLevel");
  options.k = GetUnsignedOption(object, "k");
  options.d = GetUnsignedOption(object, "d");
  options.steps = GetUnsignedOption(object, "steps");
  options.f = GetUnsignedOption(object, "f");
  options.accel = GetUnsignedOption(object, "accel");
  options.split_point = GetDoubleOption(object, "splitPoint", options.split_point);
  options.shrink = GetUnsignedOption(object, "shrink");
  options.shrink_max_regression = GetUnsignedOption(object, "shrinkMaxRegression");

  Napi::Value dict_id = object.Get("dictId");
  if (!dict_id.IsUndefined()) {
    if (!dict_id.IsNumber()) {
      throw Napi::TypeError::New(env, "dictId must be a number.");
    }
    const int64_t parsed = dict_id.As<Napi::Number>().Int64Value();
    if (parsed < 0) {
      throw Napi::TypeError::New(env, "dictId must be non-negative.");
    }
    options.dict_id = static_cast<unsigned>(parsed);
    options.has_dict_id = true;
  }

  if (options.dict_size < 256) {
    throw Napi::TypeError::New(env, "dictSize must be at least 256 bytes.");
  }

  return options;
}

Napi::Value TrainZstdSync(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsArray()) {
    throw Napi::TypeError::New(env, "trainZstdSync expects an array of Buffers.");
  }

  const ZstdTrainOptions options = ParseOptions(env, info.Length() > 1 ? info[1] : env.Undefined());
  Napi::Array array = info[0].As<Napi::Array>();
  const uint32_t sample_count = array.Length();
  if (sample_count == 0) {
    throw Napi::TypeError::New(env, "trainZstdSync requires at least one sample.");
  }

  std::vector<size_t> sample_sizes;
  std::vector<std::uint8_t> sample_data;
  sample_sizes.reserve(sample_count);

  for (uint32_t i = 0; i < sample_count; ++i) {
    Napi::Value item = array.Get(i);
    if (!item.IsBuffer()) {
      throw Napi::TypeError::New(env, "trainZstdSync samples must be Buffers.");
    }
    Napi::Buffer<std::uint8_t> buffer = item.As<Napi::Buffer<std::uint8_t>>();
    if (buffer.Length() == 0) {
      throw Napi::TypeError::New(env, "trainZstdSync does not support empty samples.");
    }
    sample_sizes.push_back(buffer.Length());
    sample_data.insert(sample_data.end(), buffer.Data(), buffer.Data() + buffer.Length());
  }

  std::vector<std::uint8_t> dictionary(options.dict_size);
  ZDICT_fastCover_params_t params = {};
  params.k = options.k;
  params.d = options.d;
  params.steps = options.steps;
  params.f = options.f;
  params.accel = options.accel;
  params.splitPoint = options.split_point;
  params.shrinkDict = options.shrink;
  params.shrinkDictMaxRegression = options.shrink_max_regression;
  params.zParams.compressionLevel = options.compression_level;
  params.zParams.notificationLevel = options.notification_level;
  params.zParams.dictID = options.has_dict_id ? options.dict_id : 0;

  const size_t result = ZDICT_optimizeTrainFromBuffer_fastCover(
      dictionary.data(),
      dictionary.size(),
      sample_data.data(),
      sample_sizes.data(),
      sample_count,
      &params);

  if (ZDICT_isError(result)) {
    throw Napi::Error::New(env, std::string("Zstd dictionary training failed: ") + ZDICT_getErrorName(result));
  }

  const unsigned dict_id = ZDICT_getDictID(dictionary.data(), result);

  Napi::Object output = Napi::Object::New(env);
  output.Set("dictionary", Napi::Buffer<std::uint8_t>::Copy(env, dictionary.data(), result));
  output.Set("size", Napi::Number::New(env, static_cast<double>(result)));
  output.Set("dictionaryId", Napi::Number::New(env, dict_id));
  return output;
}

}  // namespace

void RegisterZstdTraining(Napi::Env env, Napi::Object exports) {
  exports.Set("trainZstdSync", Napi::Function::New(env, TrainZstdSync));
}

}  // namespace nodedc
