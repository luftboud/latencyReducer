#ifndef SERVER_SERVER_H
#define SERVER_SERVER_H

#include <string>
#include <mutex>
#include <vector>
#include <thread>
#include <atomic>
#include <boost/asio.hpp>
#include <boost/beast/websocket.hpp>

#include "socket.h"

using boost::asio::ip::tcp;
namespace websocket = boost::beast::websocket;

class server_t {
    std::string addr = "0.0.0.0";
    int port = 8080;

    socket_t sender;
    socket_t viewer;

    std::mutex m;
    std::atomic<bool> run{true};
    std::vector<std::thread> threads;

    void client_worker(websocket_type&& ws);
public:
    server_t() = default;
    explicit server_t(std::string&& addr, int port): addr(std::move(addr)), port(port) {}

    void launch();
    void stop();

    std::string log_participants(const std::string& buf, const websocket_type &socket);

    std::pair<websocket_type, websocket_type> get_sockets() {
        std::lock_guard lock(m);
        return {sender.get_ws(), viewer.get_ws()};
    }

    void delete_socket(const std::string& role, const websocket_type &socket);
};

#endif //SERVER_SERVER_H