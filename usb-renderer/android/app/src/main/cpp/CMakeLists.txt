# The USB audio driver's native side: Mandarin's usb_jni.cc (usbdevfs ioctls on
# the device node Android hands the app), read where it is in this repository,
# android/app/src/main/cpp (MANDARIN_CPP, set by app/build.gradle.kts).
cmake_minimum_required(VERSION 3.22.1 FATAL_ERROR)
project(mandarinUsbNative C CXX)
set(CMAKE_CXX_STANDARD 11)

if(NOT DEFINED MANDARIN_CPP)
  set(MANDARIN_CPP "${CMAKE_CURRENT_SOURCE_DIR}/../../../../../../android/app/src/main/cpp")
endif()

find_library(android_log_lib log)
add_library(mandarinusb SHARED "${MANDARIN_CPP}/usb_jni.cc")
target_link_libraries(mandarinusb PRIVATE android PRIVATE ${android_log_lib})
# 16 KB ELF alignment, as Android 15 asks of every native library.
target_link_options(mandarinusb PRIVATE "-Wl,-z,max-page-size=16384")
