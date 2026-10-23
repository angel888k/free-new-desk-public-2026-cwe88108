#pragma once
#include <functional>
#include <string>
class NamedPipeServer {
 public:
  using Handler=std::function<std::string(const std::string&)>;
  NamedPipeServer(std::wstring pipeName,Handler handler);
  int run();
 private:
  std::wstring pipeName_;
  Handler handler_;
};
