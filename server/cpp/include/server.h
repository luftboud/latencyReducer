#ifndef SERVER_SERVER_H
#define SERVER_SERVER_H

#include <string>
#include <boost/asio.hpp>
#include <boost/beast/websocket.hpp>

using boost::asio::ip::tcp;
namespace websocket = boost::beast::websocket;

using websocket_type = std::shared_ptr<websocket::stream<tcp::socket>>;

struct socket_t {
private:
    websocket_type ws;

public:
    socket_t() = default;

    socket_t(const socket_t&) = delete;
    socket_t& operator=(const socket_t&) = delete;

    socket_t(socket_t&&) = default;
    socket_t& operator=(socket_t&&) = default;

    void set_ws(websocket_type websocket_stream) { ws = std::move(websocket_stream); }

    bool empty() const { return !ws; }

    ~socket_t() = default;
};

class server_t {
    std::string addr = "0.0.0.0";
    int port = 8080;

    socket_t sender;
    socket_t viewer;
public:
    server_t() = default;
    explicit server_t(std::string addr, int port): addr(addr), port(port) {}

    void launch();
    void log_participants(const std::string& buf, websocket_type socket);

    bool everybody() const { return !(sender.empty() || viewer.empty()); }
    [[nodiscard]] socket_t& get_sender() { return sender; }
    [[nodiscard]] socket_t& get_viewer() { return viewer; }
};

#endif //SERVER_SERVER_H