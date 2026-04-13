#ifndef SERVER_SOCKET_H
#define SERVER_SOCKET_H

#include <boost/asio/ip/tcp.hpp>
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

    [[nodiscard]] websocket_type get_ws() { return ws; }

    bool empty() const { return !ws; }

    ~socket_t() = default;
};


#endif //SERVER_SOCKET_H
