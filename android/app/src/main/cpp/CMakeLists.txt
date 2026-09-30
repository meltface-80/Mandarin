# The app's native code: Media3's Opus JNI wrapper (opus_jni.cc, from
# androidx/media 1.8.0, Apache 2.0) over libopus, which is fetched here and
# built static. The result is libopusV2JNI.so, which
# androidx.media3.decoder.opus.OpusLibrary loads.
cmake_minimum_required(VERSION 3.22.1 FATAL_ERROR)
project(mandarinNative C CXX)
set(CMAKE_CXX_STANDARD 11)

include(FetchContent)
FetchContent_Declare(opus
  URL https://github.com/xiph/opus/releases/download/v1.5.2/opus-1.5.2.tar.gz
  URL_HASH SHA256=65c1d2f78b9f2fb20082c38cbe47c951ad5839345876e46941612ee87f9a7ce1
  DOWNLOAD_EXTRACT_TIMESTAMP TRUE)
# A decoder only: no docs, tests or programs, and no float-free build — the
# whole point is opus_multistream_decode_float.
set(OPUS_BUILD_SHARED_LIBRARY OFF CACHE BOOL "" FORCE)
set(OPUS_BUILD_TESTING OFF CACHE BOOL "" FORCE)
set(OPUS_BUILD_PROGRAMS OFF CACHE BOOL "" FORCE)
set(OPUS_INSTALL_PKG_CONFIG_MODULE OFF CACHE BOOL "" FORCE)
set(OPUS_INSTALL_CMAKE_CONFIG_MODULE OFF CACHE BOOL "" FORCE)
FetchContent_MakeAvailable(opus)

add_library(opusV2JNI SHARED opus_jni.cc)
find_library(android_log_lib log)
target_link_libraries(opusV2JNI PRIVATE android PRIVATE opus PRIVATE ${android_log_lib})
# 16 KB ELF alignment, as Android 15 asks of every native library.
target_link_options(opusV2JNI PRIVATE "-Wl,-z,max-page-size=16384")
