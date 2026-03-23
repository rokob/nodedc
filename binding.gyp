{
  "targets": [
    {
      "target_name": "nodedc",
      "sources": [
        "src/native/addon.cc",
        "src/native/brotli_prepared_dictionary.cc",
        "src/native/brotli_stream.cc",
        "src/native/prepared_dictionary.cc",
        "src/native/zstd_stream.cc",
        "vendor/brotli/c/common/constants.c",
        "vendor/brotli/c/common/context.c",
        "vendor/brotli/c/common/dictionary.c",
        "vendor/brotli/c/common/platform.c",
        "vendor/brotli/c/common/shared_dictionary.c",
        "vendor/brotli/c/common/transform.c",
        "vendor/brotli/c/enc/backward_references.c",
        "vendor/brotli/c/enc/backward_references_hq.c",
        "vendor/brotli/c/enc/bit_cost.c",
        "vendor/brotli/c/enc/block_splitter.c",
        "vendor/brotli/c/enc/brotli_bit_stream.c",
        "vendor/brotli/c/enc/cluster.c",
        "vendor/brotli/c/enc/command.c",
        "vendor/brotli/c/enc/compound_dictionary.c",
        "vendor/brotli/c/enc/compress_fragment.c",
        "vendor/brotli/c/enc/compress_fragment_two_pass.c",
        "vendor/brotli/c/enc/dictionary_hash.c",
        "vendor/brotli/c/enc/encode.c",
        "vendor/brotli/c/enc/encoder_dict.c",
        "vendor/brotli/c/enc/entropy_encode.c",
        "vendor/brotli/c/enc/fast_log.c",
        "vendor/brotli/c/enc/histogram.c",
        "vendor/brotli/c/enc/literal_cost.c",
        "vendor/brotli/c/enc/memory.c",
        "vendor/brotli/c/enc/metablock.c",
        "vendor/brotli/c/enc/static_dict.c",
        "vendor/brotli/c/enc/static_dict_lut.c",
        "vendor/brotli/c/enc/static_init.c",
        "vendor/brotli/c/enc/utf8_util.c",
        "vendor/brotli/c/dec/bit_reader.c",
        "vendor/brotli/c/dec/decode.c",
        "vendor/brotli/c/dec/huffman.c",
        "vendor/brotli/c/dec/prefix.c",
        "vendor/brotli/c/dec/state.c",
        "vendor/brotli/c/dec/static_init.c",
        "vendor/zstd/lib/common/debug.c",
        "vendor/zstd/lib/common/entropy_common.c",
        "vendor/zstd/lib/common/error_private.c",
        "vendor/zstd/lib/common/fse_decompress.c",
        "vendor/zstd/lib/common/pool.c",
        "vendor/zstd/lib/common/threading.c",
        "vendor/zstd/lib/common/xxhash.c",
        "vendor/zstd/lib/common/zstd_common.c",
        "vendor/zstd/lib/compress/fse_compress.c",
        "vendor/zstd/lib/compress/hist.c",
        "vendor/zstd/lib/compress/huf_compress.c",
        "vendor/zstd/lib/compress/zstd_compress.c",
        "vendor/zstd/lib/compress/zstd_compress_literals.c",
        "vendor/zstd/lib/compress/zstd_compress_sequences.c",
        "vendor/zstd/lib/compress/zstd_compress_superblock.c",
        "vendor/zstd/lib/compress/zstd_double_fast.c",
        "vendor/zstd/lib/compress/zstd_fast.c",
        "vendor/zstd/lib/compress/zstd_lazy.c",
        "vendor/zstd/lib/compress/zstd_ldm.c",
        "vendor/zstd/lib/compress/zstd_opt.c",
        "vendor/zstd/lib/compress/zstd_preSplit.c",
        "vendor/zstd/lib/compress/zstdmt_compress.c",
        "vendor/zstd/lib/decompress/huf_decompress.c",
        "vendor/zstd/lib/decompress/zstd_ddict.c",
        "vendor/zstd/lib/decompress/zstd_decompress.c",
        "vendor/zstd/lib/decompress/zstd_decompress_block.c"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "vendor/brotli/c/include",
        "vendor/zstd/lib"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "defines": [
        "NAPI_CPP_EXCEPTIONS",
        "BROTLI_STATIC_INIT=BROTLI_STATIC_INIT_NONE",
        "ZSTD_LEGACY_SUPPORT=0",
        "ZSTD_MULTITHREAD=0",
        "ZSTD_DISABLE_ASM=1"
      ],
      "cflags_cc": [
        "-fexceptions",
        "-std=c++20"
      ],
      "cflags_cc!": [
        "-fno-exceptions"
      ],
      "xcode_settings": {
        "CLANG_CXX_LANGUAGE_STANDARD": "c++20",
        "GCC_ENABLE_CPP_EXCEPTIONS": "YES"
      },
      "msvs_settings": {
        "VCCLCompilerTool": {
          "ExceptionHandling": 1,
          "AdditionalOptions": [
            "/std:c++20"
          ]
        }
      },
      "conditions": []
    },
    {
      "target_name": "nodedc_train",
      "sources": [
        "src/native/train_addon.cc",
        "src/native/brotli_trainer.cc",
        "src/native/zstd_trainer.cc",
        "vendor/brotli/research/deorummolae.cc",
        "vendor/brotli/research/durchschlag.cc",
        "vendor/brotli/research/sieve.cc",
        "vendor/divsufsort/lib/divsufsort.c",
        "vendor/divsufsort/lib/sssort.c",
        "vendor/divsufsort/lib/trsort.c",
        "vendor/divsufsort/lib/utils.c",
        "vendor/zstd/lib/common/debug.c",
        "vendor/zstd/lib/common/entropy_common.c",
        "vendor/zstd/lib/common/error_private.c",
        "vendor/zstd/lib/common/fse_decompress.c",
        "vendor/zstd/lib/common/pool.c",
        "vendor/zstd/lib/common/threading.c",
        "vendor/zstd/lib/common/xxhash.c",
        "vendor/zstd/lib/common/zstd_common.c",
        "vendor/zstd/lib/compress/fse_compress.c",
        "vendor/zstd/lib/compress/hist.c",
        "vendor/zstd/lib/compress/huf_compress.c",
        "vendor/zstd/lib/compress/zstd_compress.c",
        "vendor/zstd/lib/compress/zstd_compress_literals.c",
        "vendor/zstd/lib/compress/zstd_compress_sequences.c",
        "vendor/zstd/lib/compress/zstd_compress_superblock.c",
        "vendor/zstd/lib/compress/zstd_double_fast.c",
        "vendor/zstd/lib/compress/zstd_fast.c",
        "vendor/zstd/lib/compress/zstd_lazy.c",
        "vendor/zstd/lib/compress/zstd_ldm.c",
        "vendor/zstd/lib/compress/zstd_opt.c",
        "vendor/zstd/lib/compress/zstd_preSplit.c",
        "vendor/zstd/lib/compress/zstdmt_compress.c",
        "vendor/zstd/lib/dictBuilder/cover.c",
        "vendor/zstd/lib/dictBuilder/fastcover.c",
        "vendor/zstd/lib/dictBuilder/zdict.c"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "src/native/third_party/divsufsort",
        "vendor/brotli/research",
        "vendor/divsufsort/include",
        "vendor/esaxx",
        "vendor/zstd/lib"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "defines": [
        "NAPI_CPP_EXCEPTIONS",
        "HAVE_CONFIG_H=1",
        "ZSTD_LEGACY_SUPPORT=0",
        "ZSTD_MULTITHREAD=0",
        "ZSTD_DISABLE_ASM=1",
        "ZDICT_STATIC_LINKING_ONLY"
      ],
      "cflags_cc": [
        "-fexceptions",
        "-std=c++20"
      ],
      "cflags_cc!": [
        "-fno-exceptions"
      ],
      "xcode_settings": {
        "CLANG_CXX_LANGUAGE_STANDARD": "c++20",
        "GCC_ENABLE_CPP_EXCEPTIONS": "YES"
      },
      "msvs_settings": {
        "VCCLCompilerTool": {
          "ExceptionHandling": 1,
          "AdditionalOptions": [
            "/std:c++20"
          ]
        }
      }
    }
  ]
}
