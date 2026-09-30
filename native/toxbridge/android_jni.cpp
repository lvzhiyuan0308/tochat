#include <jni.h>
#include <string>
#include <cstring>
#include <cstdint>
#include "bridge.h"
static std::string utf8(JNIEnv* env,jstring s){const jchar* chars=env->GetStringChars(s,nullptr);jsize size=env->GetStringLength(s);std::string out;for(int i=0;i<size;i++){uint32_t c=chars[i];if(c>=0xd800&&c<=0xdbff&&i+1<size){c=0x10000+((c-0xd800)<<10)+(chars[++i]-0xdc00);}if(c<128)out+=(char)c;else if(c<2048){out+=(char)(0xc0|(c>>6));out+=(char)(0x80|(c&63));}else if(c<65536){out+=(char)(0xe0|(c>>12));out+=(char)(0x80|((c>>6)&63));out+=(char)(0x80|(c&63));}else{out+=(char)(0xf0|(c>>18));out+=(char)(0x80|((c>>12)&63));out+=(char)(0x80|((c>>6)&63));out+=(char)(0x80|(c&63));}}env->ReleaseStringChars(s,chars);return out;}
static jstring text(JNIEnv* env,const char* s){jclass charset=env->FindClass("java/lang/String");auto ctor=env->GetMethodID(charset,"<init>","([BLjava/lang/String;)V");auto bytes=env->NewByteArray(strlen(s));env->SetByteArrayRegion(bytes,0,strlen(s),(const jbyte*)s);return (jstring)env->NewObject(charset,ctor,bytes,env->NewStringUTF("UTF-8"));}
extern "C" JNIEXPORT jlong JNICALL Java_org_tochat_app_Native_create(JNIEnv* e,jobject,jstring c){return (jlong)tc_create(utf8(e,c).c_str());}
extern "C" JNIEXPORT jstring JNICALL Java_org_tochat_app_Native_error(JNIEnv* e,jobject){return text(e,tc_last_error());}
extern "C" JNIEXPORT jstring JNICALL Java_org_tochat_app_Native_call(JNIEnv* e,jobject,jlong n,jstring c){auto p=tc_call((void*)n,utf8(e,c).c_str());auto s=text(e,p);tc_free(p);return s;}
extern "C" JNIEXPORT jstring JNICALL Java_org_tochat_app_Native_poll(JNIEnv* e,jobject,jlong n){auto p=tc_poll((void*)n);auto s=text(e,p);tc_free(p);return s;}
extern "C" JNIEXPORT void JNICALL Java_org_tochat_app_Native_destroy(JNIEnv*,jobject,jlong n){tc_destroy((void*)n);}
