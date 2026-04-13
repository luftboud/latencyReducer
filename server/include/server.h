#ifndef SERVER_SERVER_H
#define SERVER_SERVER_H

#include <string>
#include <mutex>
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
public:
    server_t() = default;
    explicit server_t(std::string addr, int port): addr(addr), port(port) {}

    void launch();
    std::string log_participants(const std::string& buf, websocket_type socket);

    bool everybody() {
        std::lock_guard<std::mutex> lock(m);
        return !(sender.empty() || viewer.empty());
    }

    socket_t& get_sender() {
        std::lock_guard<std::mutex> lock(m);
        return sender;
    }

    socket_t& get_viewer() {
        std::lock_guard<std::mutex> lock(m);
        return viewer;
    }

    void delete_socket(const std::string& role);
};

#endif //SERVER_SERVER_H