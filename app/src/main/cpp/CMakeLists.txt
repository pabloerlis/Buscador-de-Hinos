cmake_minimum_required(VERSION 3.22.1)
project(buscador_hinos_gguf LANGUAGES C CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)
option(HINOS_OPTIMIZE_NATIVE "Compile llama/ggml/JNI with optimized Clang flags in debug APK" ON)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_SERVER OFF CACHE BOOL "" FORCE)
set(LLAMA_CURL OFF CACHE BOOL "" FORCE)
set(LLAMA_OPENSSL OFF CACHE BOOL "" FORCE)
set(GGML_NATIVE OFF CACHE BOOL "" FORCE)
set(GGML_OPENMP OFF CACHE BOOL "" FORCE)
set(GGML_LLAMAFILE OFF CACHE BOOL "" FORCE)
set(GGML_CPU_ALL_VARIANTS OFF CACHE BOOL "" FORCE)
if(ANDROID AND CMAKE_ANDROID_ARCH_ABI STREQUAL "arm64-v8a")
  set(GGML_CPU_KLEIDIAI ON CACHE BOOL "Use portable ARM64 kernels" FORCE)
endif()
include(FetchContent)
FetchContent_Declare(llamacpp
  GIT_REPOSITORY https://github.com/ggml-org/llama.cpp.git
  GIT_TAG b11960
  GIT_SHALLOW TRUE
  GIT_PROGRESS TRUE
)
FetchContent_MakeAvailable(llamacpp)
add_library(hinosllm SHARED hinos_jni.cpp)
if(ANDROID AND CMAKE_ANDROID_ARCH_ABI STREQUAL "arm64-v8a")
  target_compile_definitions(hinosllm PRIVATE HINOS_KLEIDIAI=1)
endif()
target_link_libraries(hinosllm PRIVATE llama ggml log)
target_include_directories(hinosllm PRIVATE ${llamacpp_SOURCE_DIR}/include ${llamacpp_SOURCE_DIR}/ggml/include)

# A compilação Android Debug padrão mantém -O0 nos arquivos C/C++.
# Apenas os kernels nativos são otimizados; Java, assinatura Debug e depuração permanecem.
# Flags do NDK/AGP são verificadas por scripts/qa_native_compile_flags.py, não presumidas.
if(ANDROID AND HINOS_OPTIMIZE_NATIVE)
  foreach(_hinos_native_target IN ITEMS ggml-base ggml-cpu llama hinosllm)
    if(NOT TARGET ${_hinos_native_target})
      message(FATAL_ERROR "Alvo nativo indispensável ausente: ${_hinos_native_target}")
    endif()
    get_target_property(_hinos_kind ${_hinos_native_target} TYPE)
    if(_hinos_kind STREQUAL "INTERFACE_LIBRARY")
      message(FATAL_ERROR "Alvo nativo não compilável: ${_hinos_native_target}")
    endif()
    target_compile_options(${_hinos_native_target} PRIVATE
      -O3 -gline-tables-only -fno-omit-frame-pointer)
  endforeach()
endif()
