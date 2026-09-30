#include "bridge.h"
#include "json.hpp"
#include <toxcore/tox.h>
#include <toxencryptsave/toxencryptsave.h>
#include <sodium.h>
#include <atomic>
#include <condition_variable>
#include <deque>
#include <filesystem>
#include <fstream>
#include <future>
#include <map>
#include <mutex>
#include <thread>
#include <vector>
#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#endif
using json = nlohmann::json;
namespace fs = std::filesystem;
static thread_local std::string last_error;
static std::string hex(const uint8_t* p, size_t n) {
  std::string s(n*2, '0'); const char* chars="0123456789ABCDEF";
  for(size_t i=0;i<n;i++){s[i*2]=chars[p[i]>>4];s[i*2+1]=chars[p[i]&15];} return s;
}
static std::vector<uint8_t> unhex(const std::string& s, size_t n) {
  if(s.size()!=n*2) throw std::runtime_error("Invalid hex length");
  std::vector<uint8_t> b(n);size_t size=0;
  if(sodium_hex2bin(b.data(),n,s.data(),s.size(),nullptr,&size,nullptr)!=0 || size!=n)throw std::runtime_error("Invalid hex");return b;
}
static char* result(const json& j){auto s=j.dump(-1,' ',false,json::error_handler_t::replace);auto p=new char[s.size()+1];memcpy(p,s.c_str(),s.size()+1);return p;}
struct Task {json command; std::promise<json> response;};
struct Transfer {fs::path path;uint64_t size=0,done=0;bool inbound=false,accepted=false;std::string name;};
struct Node {
  Tox* tox=nullptr;std::string profile,password;std::thread worker;std::atomic<bool> running{true};
  std::mutex mutex;std::condition_variable wake;std::deque<std::shared_ptr<Task>> tasks;std::deque<json> events;
  std::map<std::pair<uint32_t,uint32_t>,Transfer> files;
  std::string key(uint32_t f){uint8_t b[TOX_PUBLIC_KEY_SIZE];Tox_Err_Friend_Get_Public_Key e;if(!tox_friend_get_public_key(tox,f,b,&e))throw std::runtime_error("Unknown friend");return hex(b,sizeof(b));}
  uint32_t friendNo(const std::string& k){auto b=unhex(k,32);Tox_Err_Friend_By_Public_Key e;auto f=tox_friend_by_public_key(tox,b.data(),&e);if(e!=TOX_ERR_FRIEND_BY_PUBLIC_KEY_OK)throw std::runtime_error("Unknown friend");return f;}
  void emit(json j){std::lock_guard<std::mutex> l(mutex);if(events.size()>4096) {running=false;return;}events.push_back(std::move(j));}
  void save(){
    std::vector<uint8_t> plain(tox_get_savedata_size(tox)),cipher(plain.size()+TOX_PASS_ENCRYPTION_EXTRA_LENGTH);
    tox_get_savedata(tox,plain.data());Tox_Err_Encryption e;
    bool ok=tox_pass_encrypt(plain.data(),plain.size(),(const uint8_t*)password.data(),password.size(),cipher.data(),&e);
    sodium_memzero(plain.data(),plain.size());if(!ok)throw std::runtime_error("Profile encryption failed");
    auto p=fs::u8path(profile);if(!p.parent_path().empty())fs::create_directories(p.parent_path());auto tmp=p;tmp+=".tmp";
    {std::ofstream out(tmp,std::ios::binary|std::ios::trunc);out.write((const char*)cipher.data(),cipher.size());out.flush();if(!out)throw std::runtime_error("Cannot save profile");}
#ifdef _WIN32
    if(!MoveFileExW(tmp.c_str(),p.c_str(),MOVEFILE_REPLACE_EXISTING|MOVEFILE_WRITE_THROUGH))throw std::runtime_error("Cannot replace profile");
#else
    fs::rename(tmp,p);fs::permissions(p,fs::perms::owner_read|fs::perms::owner_write);
#endif
  }
  explicit Node(const json& c){
    profile=c.at("profile");password=c.at("password");if(password.size()<32)throw std::runtime_error("Profile password too short");
    std::vector<uint8_t> saved;auto p=fs::u8path(profile);
    if(fs::exists(p)){
      std::ifstream in(p,std::ios::binary);std::vector<uint8_t> enc((std::istreambuf_iterator<char>(in)),{});
      if(enc.size()<=TOX_PASS_ENCRYPTION_EXTRA_LENGTH || !tox_is_data_encrypted(enc.data()))throw std::runtime_error("Invalid encrypted profile");
      saved.resize(enc.size()-TOX_PASS_ENCRYPTION_EXTRA_LENGTH);Tox_Err_Decryption e;
      if(!tox_pass_decrypt(enc.data(),enc.size(),(const uint8_t*)password.data(),password.size(),saved.data(),&e))throw std::runtime_error("Cannot decrypt profile; identity was not replaced");
    }
    Tox_Err_Options_New oe;auto opts=tox_options_new(&oe);if(!opts)throw std::runtime_error("Options allocation failed");
    tox_options_set_ipv6_enabled(opts,true);tox_options_set_udp_enabled(opts,c.value("udp",true));tox_options_set_local_discovery_enabled(opts,true);
    if(c.contains("port")){tox_options_set_start_port(opts,c["port"]);tox_options_set_end_port(opts,c["port"]);}
    if(!saved.empty()){tox_options_set_savedata_type(opts,TOX_SAVEDATA_TYPE_TOX_SAVE);tox_options_set_savedata_data(opts,saved.data(),saved.size());}
    Tox_Err_New e;tox=tox_new(opts,&e);tox_options_free(opts);sodium_memzero(saved.data(),saved.size());if(!tox)throw std::runtime_error("tox_new failed: "+std::to_string(e));
    try {
      auto name=c.value("name",std::string("ToChat"));Tox_Err_Set_Info se;tox_self_set_name(tox,(const uint8_t*)name.data(),name.size(),&se);
      callbacks();save();worker=std::thread([this]{loop();});
    }catch(...){tox_kill(tox);tox=nullptr;throw;}
  }
  ~Node(){running=false;wake.notify_all();if(worker.joinable())worker.join();if(tox)tox_kill(tox);sodium_memzero(password.data(),password.size());}
  void callbacks(){
    tox_callback_self_connection_status(tox,[](Tox*,Tox_Connection s,void* u){((Node*)u)->emit({{"type","selfConnection"},{"connection",(int)s}});});
    tox_callback_friend_connection_status(tox,[](Tox*,uint32_t f,Tox_Connection s,void* u){auto n=(Node*)u;if(s==TOX_CONNECTION_NONE){for(auto it=n->files.begin();it!=n->files.end();){if(it->first.first==f)it=n->files.erase(it);else ++it;}}n->emit({{"type","connection"},{"peer",n->key(f)},{"connection",(int)s}});});
    tox_callback_friend_request(tox,[](Tox*,const uint8_t* pk,const uint8_t* data,size_t len,void* u){((Node*)u)->emit({{"type","friendRequest"},{"peer",hex(pk,32)},{"message",std::string((const char*)data,len)}});});
    tox_callback_friend_name(tox,[](Tox*,uint32_t f,const uint8_t* data,size_t len,void* u){auto n=(Node*)u;n->emit({{"type","name"},{"peer",n->key(f)},{"name",std::string((const char*)data,len)}});});
    tox_callback_friend_lossless_packet(tox,[](Tox*,uint32_t f,const uint8_t* data,size_t len,void* u){if(len<2||data[0]!=160)return;auto n=(Node*)u;n->emit({{"type","packet"},{"peer",n->key(f)},{"data",std::string((const char*)data+1,len-1)}});});
    tox_callback_file_recv(tox,[](Tox*,uint32_t f,uint32_t no,uint32_t kind,uint64_t size,const uint8_t* name,size_t len,void* u){
      auto n=(Node*)u;Tox_Err_File_Control e;
      if(kind!=TOX_FILE_KIND_DATA || size>1024ULL*1024*1024){tox_file_control(n->tox,f,no,TOX_FILE_CONTROL_CANCEL,&e);return;}
      auto filename=fs::u8path(std::string((const char*)name,len)).filename().u8string();if(filename.empty()||filename=="."||filename=="..")filename="file";
      n->files[{f,no}]={fs::path(),size,0,true,false,filename};n->emit({{"type","fileOffer"},{"peer",n->key(f)},{"number",no},{"name",filename},{"size",size}});
    });
    tox_callback_file_recv_control(tox,[](Tox*,uint32_t f,uint32_t no,Tox_File_Control c,void* u){auto n=(Node*)u;if(c==TOX_FILE_CONTROL_CANCEL){n->files.erase({f,no});n->emit({{"type","fileCancelled"},{"peer",n->key(f)},{"number",no}});}});
    tox_callback_file_chunk_request(tox,[](Tox*,uint32_t f,uint32_t no,uint64_t pos,size_t len,void* u){
      auto n=(Node*)u;auto it=n->files.find({f,no});if(it==n->files.end()||it->second.inbound)return;auto& tr=it->second;
      if(len==0){n->emit({{"type","fileDone"},{"peer",n->key(f)},{"number",no},{"path",tr.path.u8string()},{"inbound",false}});n->files.erase(it);return;}
      std::ifstream in(tr.path,std::ios::binary);in.seekg(pos);std::vector<uint8_t> b(len);in.read((char*)b.data(),len);
      if((size_t)in.gcount()!=len){Tox_Err_File_Control e;tox_file_control(n->tox,f,no,TOX_FILE_CONTROL_CANCEL,&e);n->emit({{"type","fileCancelled"},{"peer",n->key(f)},{"number",no}});n->files.erase(it);return;}
      Tox_Err_File_Send_Chunk e;if(tox_file_send_chunk(n->tox,f,no,pos,b.data(),len,&e)){auto old=tr.done;tr.done=pos+len;if(tr.done==tr.size||tr.done/(256*1024)!=old/(256*1024))n->emit({{"type","fileProgress"},{"peer",n->key(f)},{"number",no},{"done",tr.done},{"size",tr.size}});}
    });
    tox_callback_file_recv_chunk(tox,[](Tox*,uint32_t f,uint32_t no,uint64_t pos,const uint8_t* data,size_t len,void* u){
      auto n=(Node*)u;auto it=n->files.find({f,no});if(it==n->files.end()||!it->second.accepted)return;auto& tr=it->second;
      if(len==0){if(tr.done==tr.size){auto final=tr.path;final.replace_extension("");std::error_code ec;fs::rename(tr.path,final,ec);n->emit({{"type",ec?"fileCancelled":"fileDone"},{"peer",n->key(f)},{"number",no},{"path",final.u8string()},{"inbound",true}});}else n->emit({{"type","fileCancelled"},{"peer",n->key(f)},{"number",no}});n->files.erase(it);return;}
      if(pos!=tr.done || pos+len>tr.size){Tox_Err_File_Control e;tox_file_control(n->tox,f,no,TOX_FILE_CONTROL_CANCEL,&e);n->files.erase(it);return;}
      std::ofstream out(tr.path,std::ios::binary|std::ios::app);out.write((const char*)data,len);out.flush();
      if(!out){Tox_Err_File_Control e;tox_file_control(n->tox,f,no,TOX_FILE_CONTROL_CANCEL,&e);n->emit({{"type","fileCancelled"},{"peer",n->key(f)},{"number",no}});n->files.erase(it);return;}
      auto old=tr.done;tr.done=pos+len;if(tr.done==tr.size||tr.done/(256*1024)!=old/(256*1024))n->emit({{"type","fileProgress"},{"peer",n->key(f)},{"number",no},{"done",tr.done},{"size",tr.size}});
    });
  }
  json execute(const json& c){
    const auto op=c.at("op").get<std::string>();
    if(op=="info"){
      uint8_t address[TOX_ADDRESS_SIZE];tox_self_get_address(tox,address);uint8_t dht[32];tox_self_get_dht_id(tox,dht);
      json friends=json::array();std::vector<uint32_t> ids(tox_self_get_friend_list_size(tox));tox_self_get_friend_list(tox,ids.data());
      for(auto f:ids){Tox_Err_Friend_Query e;std::vector<uint8_t> name(tox_friend_get_name_size(tox,f,&e));tox_friend_get_name(tox,f,name.data(),&e);friends.push_back({{"peer",key(f)},{"name",std::string(name.begin(),name.end())},{"connection",(int)tox_friend_get_connection_status(tox,f,&e)}});}
      Tox_Err_Get_Port e;return {{"address",hex(address,sizeof(address))},{"dht",hex(dht,32)},{"port",tox_self_get_udp_port(tox,&e)},{"connection",(int)tox_self_get_connection_status(tox)},{"friends",friends}};
    }
    if(op=="bootstrap"){
      auto pk=unhex(c.at("key"),32);std::string host=c.at("host");uint16_t port=c.at("port");Tox_Err_Bootstrap e;
      bool ok=c.value("tcp",false)?tox_add_tcp_relay(tox,host.c_str(),port,pk.data(),&e):tox_bootstrap(tox,host.c_str(),port,pk.data(),&e);
      if(!ok)throw std::runtime_error("Bootstrap failed: "+std::to_string(e));return {{"ok",true}};
    }
    if(op=="add"){
      auto address=unhex(c.at("address"),38);auto msg=c.value("message",std::string("ToChat 好友请求"));Tox_Err_Friend_Add e;
      auto f=tox_friend_add(tox,address.data(),(const uint8_t*)msg.data(),msg.size(),&e);if(e!=TOX_ERR_FRIEND_ADD_OK)throw std::runtime_error("Add friend failed: "+std::to_string(e));save();return {{"peer",key(f)}};
    }
    if(op=="accept"){
      auto pk=unhex(c.at("peer"),32);Tox_Err_Friend_Add e;auto f=tox_friend_add_norequest(tox,pk.data(),&e);
      if(e==TOX_ERR_FRIEND_ADD_ALREADY_SENT)f=friendNo(c.at("peer"));else if(e!=TOX_ERR_FRIEND_ADD_OK)throw std::runtime_error("Accept friend failed");save();return {{"peer",key(f)}};
    }
    if(op=="name"){std::string name=c.at("name");Tox_Err_Set_Info e;if(!tox_self_set_name(tox,(const uint8_t*)name.data(),name.size(),&e))throw std::runtime_error("Invalid name");save();return {{"ok",true}};}
    auto f=friendNo(c.at("peer"));
    if(op=="remove"){Tox_Err_Friend_Delete e;if(!tox_friend_delete(tox,f,&e))throw std::runtime_error("Remove failed");save();return {{"ok",true}};}
    if(op=="send"){
      std::string data=c.at("data");if(data.size()>1372)throw std::runtime_error("Packet exceeds Tox limit");std::vector<uint8_t> b={160};b.insert(b.end(),data.begin(),data.end());Tox_Err_Friend_Custom_Packet e;
      if(!tox_friend_send_lossless_packet(tox,f,b.data(),b.size(),&e))throw std::runtime_error("Send failed: "+std::to_string(e));return {{"ok",true}};
    }
    if(op=="sendFile"){
      auto p=fs::u8path(c.at("path").get<std::string>());if(!fs::is_regular_file(p))throw std::runtime_error("File does not exist");auto size=fs::file_size(p);if(size>1024ULL*1024*1024)throw std::runtime_error("File exceeds 1 GiB");auto name=c.value("name",p.filename().u8string());if(name.empty()||name.size()>255||name.find('/')!=std::string::npos||name.find('\\')!=std::string::npos)throw std::runtime_error("Invalid filename");Tox_Err_File_Send e;
      auto no=tox_file_send(tox,f,TOX_FILE_KIND_DATA,size,nullptr,(const uint8_t*)name.data(),name.size(),&e);if(e!=TOX_ERR_FILE_SEND_OK)throw std::runtime_error("File send failed: "+std::to_string(e));files[{f,no}]={p,size,0,false,true,name};return {{"number",no},{"name",name},{"size",size}};
    }
    uint32_t no=c.at("number");auto it=files.find({f,no});if(it==files.end())throw std::runtime_error("Transfer no longer exists");Tox_Err_File_Control e;
    if(op=="acceptFile"){
      if(!it->second.inbound||it->second.accepted)throw std::runtime_error("Invalid transfer state");auto p=fs::u8path(c.at("path").get<std::string>());if(fs::exists(p))throw std::runtime_error("Destination exists");fs::create_directories(p.parent_path());auto part=p;part+=".part";if(fs::exists(part))throw std::runtime_error("Partial file exists");
      {std::ofstream out(part,std::ios::binary|std::ios::trunc);if(!out)throw std::runtime_error("Cannot create destination");}
      it->second.path=part;it->second.accepted=true;if(!tox_file_control(tox,f,no,TOX_FILE_CONTROL_RESUME,&e))throw std::runtime_error("Resume transfer failed");return {{"ok",true}};
    }
    if(op=="cancelFile"){tox_file_control(tox,f,no,TOX_FILE_CONTROL_CANCEL,&e);files.erase(it);return {{"ok",true}};}
    throw std::runtime_error("Unknown operation");
  }
  void loop(){
    while(running){
      std::deque<std::shared_ptr<Task>> batch;{std::lock_guard<std::mutex> l(mutex);batch.swap(tasks);}
      for(auto& t:batch){try{t->response.set_value(execute(t->command));}catch(const std::exception& e){t->response.set_value({{"error",e.what()}});}}
      try{tox_iterate(tox,this);}catch(const std::exception& e){emit({{"type","error"},{"message",e.what()}});}
      std::unique_lock<std::mutex> l(mutex);wake.wait_for(l,std::chrono::milliseconds(tox_iteration_interval(tox)),[this]{return !running||!tasks.empty();});
    }
    try{save();}catch(const std::exception& e){emit({{"type","error"},{"message",e.what()}});}
    std::lock_guard<std::mutex> l(mutex);for(auto& t:tasks)t->response.set_value({{"error","Node stopped"}});tasks.clear();
  }
};
void* tc_create(const char* config){try{if(sodium_init()<0)throw std::runtime_error("sodium_init failed");return new Node(json::parse(config));}catch(const std::exception& e){last_error=e.what();return nullptr;}}
const char* tc_last_error(){return last_error.c_str();}
char* tc_call(void* node,const char* command){try{auto n=(Node*)node;if(!n||!n->running)throw std::runtime_error("Node stopped");auto task=std::make_shared<Task>();task->command=json::parse(command);auto future=task->response.get_future();{std::lock_guard<std::mutex> l(n->mutex);n->tasks.push_back(task);}n->wake.notify_one();return result(future.get());}catch(const std::exception& e){return result({{"error",e.what()}});}}
char* tc_poll(void* node){auto n=(Node*)node;json events=json::array();std::lock_guard<std::mutex> l(n->mutex);while(!n->events.empty()&&events.size()<256){events.push_back(std::move(n->events.front()));n->events.pop_front();}return result(events);}
void tc_free(char* p){delete[] p;}
void tc_destroy(void* p){delete (Node*)p;}
