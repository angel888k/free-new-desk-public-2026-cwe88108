#include "named_pipe_server.h"
#include <windows.h>
#include <sddl.h>
#include <array>
#include <thread>
#include <vector>

namespace {
constexpr DWORD ioTimeoutMs=2000;
constexpr std::size_t maxFrameBytes=64*1024;

PSECURITY_DESCRIPTOR current_user_security(){
  HANDLE token=nullptr;
  if(!OpenProcessToken(GetCurrentProcess(),TOKEN_QUERY,&token))return nullptr;
  DWORD size=0;
  GetTokenInformation(token,TokenUser,nullptr,0,&size);
  std::vector<unsigned char> user(size);
  const BOOL found=GetTokenInformation(token,TokenUser,user.data(),size,&size);
  CloseHandle(token);
  if(!found)return nullptr;
  LPWSTR sid=nullptr;
  if(!ConvertSidToStringSidW(reinterpret_cast<TOKEN_USER*>(user.data())->User.Sid,&sid))return nullptr;
  const std::wstring dacl=L"D:P(A;;GA;;;"+std::wstring(sid)+L")";
  LocalFree(sid);
  PSECURITY_DESCRIPTOR descriptor=nullptr;
  if(!ConvertStringSecurityDescriptorToSecurityDescriptorW(dacl.c_str(),SDDL_REVISION_1,&descriptor,nullptr))return nullptr;
  return descriptor;
}

bool finish_io(HANDLE pipe,OVERLAPPED& operation,BOOL started,DWORD& bytes,DWORD timeout){
  if(!started&&GetLastError()!=ERROR_IO_PENDING)return false;
  if(GetOverlappedResultEx(pipe,&operation,&bytes,timeout,FALSE))return true;
  // The buffer and OVERLAPPED must stay alive until cancellation has completed.
  CancelIoEx(pipe,&operation);
  GetOverlappedResult(pipe,&operation,&bytes,TRUE);
  return false;
}
}

NamedPipeServer::NamedPipeServer(std::wstring pipeName,Handler handler):pipeName_(std::move(pipeName)),handler_(std::move(handler)){}

int NamedPipeServer::run(){
  constexpr std::size_t listenerCount=4;
  const auto descriptor=current_user_security();
  if(!descriptor)return 2;
  SECURITY_ATTRIBUTES security{sizeof(SECURITY_ATTRIBUTES),descriptor,FALSE};
  std::array<HANDLE,listenerCount> pipes{},events{};
  bool initialized=true;
  for(std::size_t i=0;i<listenerCount;++i){
    // Hold and reuse every instance: there is no gap in which a new server can own the name.
    const DWORD first=i==0?FILE_FLAG_FIRST_PIPE_INSTANCE:0;
    pipes[i]=CreateNamedPipeW(pipeName_.c_str(),PIPE_ACCESS_DUPLEX|FILE_FLAG_OVERLAPPED|first,
      PIPE_TYPE_BYTE|PIPE_READMODE_BYTE|PIPE_WAIT|PIPE_REJECT_REMOTE_CLIENTS,
      static_cast<DWORD>(listenerCount),64*1024,64*1024,0,&security);
    events[i]=CreateEventW(nullptr,TRUE,FALSE,nullptr);
    if(pipes[i]==INVALID_HANDLE_VALUE||!events[i]){initialized=false;break;}
  }
  LocalFree(descriptor);
  if(!initialized){
    for(auto pipe:pipes)if(pipe&&pipe!=INVALID_HANDLE_VALUE)CloseHandle(pipe);
    for(auto event:events)if(event)CloseHandle(event);
    return 2;
  }

  std::vector<std::thread> listeners;
  listeners.reserve(listenerCount);
  for(std::size_t i=0;i<listenerCount;++i){
    listeners.emplace_back([this,pipe=pipes[i],event=events[i]](){
      for(;;){
        OVERLAPPED connect{};connect.hEvent=event;
        const BOOL started=ConnectNamedPipe(pipe,&connect);
        const DWORD error=started?ERROR_SUCCESS:GetLastError();
        DWORD bytes=0;
        const bool connected=started||error==ERROR_PIPE_CONNECTED||
          (error==ERROR_IO_PENDING&&finish_io(pipe,connect,FALSE,bytes,INFINITE));
        if(!connected){DisconnectNamedPipe(pipe);continue;}

        std::string pending;
        std::array<char,4096> buffer{};
        ULONGLONG deadline=GetTickCount64()+ioTimeoutMs;
        bool healthy=true;
        while(healthy){
          const ULONGLONG now=GetTickCount64();
          if(now>=deadline)break;
          OVERLAPPED read{};read.hEvent=event;
          if(!finish_io(pipe,read,ReadFile(pipe,buffer.data(),static_cast<DWORD>(buffer.size()),nullptr,&read),
              bytes,static_cast<DWORD>(deadline-now))||bytes==0)break;
          pending.append(buffer.data(),bytes);
          std::size_t pos=0;
          while((pos=pending.find('\n'))!=std::string::npos){
            if(pos>maxFrameBytes){healthy=false;break;}
            const auto line=pending.substr(0,pos);
            pending.erase(0,pos+1);
            const std::string response=handler_(line)+"\n";
            if(response.size()>maxFrameBytes+1){healthy=false;break;}
            OVERLAPPED write{};write.hEvent=event;
            if(!finish_io(pipe,write,WriteFile(pipe,response.data(),static_cast<DWORD>(response.size()),nullptr,&write),
                bytes,ioTimeoutMs)||bytes!=response.size()){healthy=false;break;}
            // Complete frames reset the deadline; drip-fed partial frames cannot occupy a slot forever.
            deadline=GetTickCount64()+ioTimeoutMs;
          }
          if(pending.size()>maxFrameBytes)break;
        }
        // FlushFileBuffers waits for the client to read and would undo the write deadline.
        DisconnectNamedPipe(pipe);
      }
    });
  }
  for(auto& listener:listeners)listener.join();
  for(auto pipe:pipes)CloseHandle(pipe);
  for(auto event:events)CloseHandle(event);
  return 0;
}
