#include <iostream>
#include <mutex>
#include <boost/asio.hpp>
#include <boost/beast/websocket.hpp>
#include <boost/beast/core.hpp>
#include <boost/json.hpp>
#include <utility>

#include "server.h"

using boost::asio::ip::tcp;
namespace websocket = boost::beast::websocket;
namespace json = boost::json;

static std::mutex m;

void server_t::log_participants(const std::string& buf, websocket_type socket) {
    std::lock_guard<std::mutex> lock(m);
    json::value json_content = json::parse(buf);
    auto role = json_content.as_object()["role"].as_string();
    if (role == "sender") {
        sender.set_ws(socket);
        std::cout << "Sender is logged" << std::endl;
    }
    else if (role == "viewer") {
        viewer.set_ws(socket);
        std::cout << "Viewer is logged" << std::endl;
    }
}

void client_worker(websocket_type ws, server_t* server) {
    try {
        ws->accept();
        std::cout << "Connected user WS" << std::endl;

        while (true) {
            boost::beast::flat_buffer buff;
            ws->read(buff);

            std::string msg = boost::beast::buffers_to_string(buff.data());
            std::cout << msg << std::endl;

            if (!server->everybody()) {
                server->log_participants(msg, ws);
            }
        }
    } catch (const boost::system::system_error& e) {
        if (e.code() == websocket::error::closed) {
            std::cout << "Client closed websocket\n";
            return;
        }
        std::cerr << "WS error: " << e.code() << " " << e.what() << "\n";
    } catch (const std::exception& e) {
        std::cerr << "Error in client serving: " << e.what() << std::endl;
    }
}

void server_t::launch() {
    boost::asio::io_context io;
    tcp::acceptor acceptor(io, tcp::endpoint(boost::asio::ip::make_address(addr), port));

    try {
        while (true) {
            std::cout << "Listening...\n" << std::endl;
            tcp::socket socket(io);
            acceptor.accept(socket);
            std::cout << "Connected user TCP" << std::endl;

            auto ws = std::make_shared<websocket::stream<tcp::socket>>(std::move(socket));
            std::thread(client_worker, ws, this).detach();
        }
    } catch (const std::exception& e) {
        std::cerr << "Error occurred: " << e.what() << std::endl;
    }
}