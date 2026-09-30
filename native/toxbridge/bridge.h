#pragma once
#ifdef _WIN32
#define TC_API __declspec(dllexport)
#else
#define TC_API __attribute__((visibility("default")))
#endif
extern "C" {
TC_API void* tc_create(const char* config);
TC_API const char* tc_last_error();
TC_API char* tc_call(void* node, const char* command);
TC_API char* tc_poll(void* node);
TC_API void tc_free(char* result);
TC_API void tc_destroy(void* node);
}
