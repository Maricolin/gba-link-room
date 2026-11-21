cmake_minimum_required(VERSION 3.16)
project(kirby_link_web C)
set(CMAKE_C_STANDARD 11)
add_compile_definitions(MINIMAL_CORE=1 DISABLE_THREADING _GNU_SOURCE PATH_MAX=4096)
set(LIBMGBA_ONLY ON CACHE BOOL "" FORCE)
set(MINIMAL_CORE ON CACHE BOOL "" FORCE)
set(M_CORE_GBA ON CACHE BOOL "" FORCE)
set(M_CORE_GB OFF CACHE BOOL "" FORCE)
set(USE_PTHREADS OFF CACHE BOOL "" FORCE)
set(ENABLE_DEBUGGERS OFF CACHE BOOL "" FORCE)
set(ENABLE_SCRIPTING OFF CACHE BOOL "" FORCE)
set(BUILD_GL OFF CACHE BOOL "" FORCE)
set(BUILD_GLES2 OFF CACHE BOOL "" FORCE)
set(BUILD_GLES3 OFF CACHE BOOL "" FORCE)
add_subdirectory(vendor/mgba)
add_executable(kirby-link native/link.c vendor/mgba/src/gba/sio/lockstep.c)
target_link_libraries(kirby-link PRIVATE mgba)
# CMake's generated feature flags must match the public structure layouts.
get_target_property(MGBA_DEFINES mgba COMPILE_DEFINITIONS)
target_compile_definitions(kirby-link PRIVATE ${MGBA_DEFINES})
if(EMSCRIPTEN)
  set_target_properties(kirby-link PROPERTIES SUFFIX ".js" RUNTIME_OUTPUT_DIRECTORY "${CMAKE_SOURCE_DIR}/public/core")
  target_link_options(kirby-link PRIVATE
    "-sMODULARIZE=1" "-sEXPORT_NAME=createKirbyCore" "-sENVIRONMENT=web,worker,node"
    "-sALLOW_MEMORY_GROWTH=1" "-sINITIAL_MEMORY=134217728" "-sMAXIMUM_MEMORY=536870912"
    "-sFILESYSTEM=0" "-sNO_EXIT_RUNTIME=1"
    "-sEXPORTED_FUNCTIONS=['_malloc','_free','_link_create','_link_destroy','_link_stage_save','_link_tick','_link_video','_link_frame','_link_player_id','_link_read16','_link_audio','_link_pcm','_link_audio_rate','_link_export_save','_link_save_ptr','_link_digest']"
    "--no-entry")
endif()
