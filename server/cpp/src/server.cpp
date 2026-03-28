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

std::string server_t::log_participants(const std::string& buf, websocket_type socket) {
    std::lock_guard<std::mutex> lock(m);
    json::value json_content = json::parse(buf);
    std::string role;

    if (json_content.as_object()["type"].as_string() == "join" &&
        json_content.as_object()["role"].as_string() == "sender") {
        sender.set_ws(socket);
        std::cout << "Sender is logged" << std::endl;
        role = "sender";
    }

    else if (json_content.as_object()["type"].as_string() == "join" &&
             json_content.as_object()["role"].as_string() == "viewer") {
        viewer.set_ws(socket);
        std::cout << "Viewer is logged" << std::endl;
        role = "viewer";
    }

    return role;
}

void server_t::delete_socket(const std::string &role) {
    std::lock_guard<std::mutex> lock(m);
    if (role == "sender") {
        sender.set_ws(nullptr);
    } else if (role == "viewer") {
        viewer.set_ws(nullptr);
    }
}

void client_worker(websocket_type ws, server_t* server) {
    std::string curr_role;
    std::cout << "Connected user WS" << std::endl;
    try {
        ws->accept();
        while (true) {
            boost::beast::flat_buffer buff;
            ws->read(buff);

            std::string msg = boost::beast::buffers_to_string(buff.data());
            std::cout << msg << std::endl;

            if (!server->everybody()) {
                curr_role = server->log_participants(msg, ws);
                continue;
            }

            if (curr_role == "sender") {
                websocket_type sender = server->get_sender().get_ws();
                sender->text(true);
                sender->write(boost::asio::buffer("{send_offer}"));
            }

            json::value json_content = json::parse(msg);
            if (json_content.as_object()["type"].as_string() == "offer") {
                websocket_type viewer = server->get_viewer().get_ws();
                viewer->text(true);
                viewer->write(boost::asio::buffer(msg));
            }

            else if (json_content.as_object()["type"].as_string() == "answer") {
                websocket_type sender = server->get_sender().get_ws();
                sender->text(true);
                sender->write(boost::asio::buffer(msg));
            }

            else if (curr_role == "viewer" && json_content.as_object()["type"].as_string() == "candidate") {
                websocket_type sender = server->get_sender().get_ws();
                sender->text(true);
                sender->write(boost::asio::buffer(msg));
            }

            else if (curr_role == "sender" && json_content.as_object()["type"].as_string() == "candidate") {
                websocket_type viewer = server->get_viewer().get_ws();
                viewer->text(true);
                viewer->write(boost::asio::buffer(msg));
            }

        }
    } catch (const boost::system::system_error& e) {
        if (e.code() == websocket::error::closed) {
            std::cout << "Client closed websocket\n";
            server->delete_socket(curr_role);
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
        std::cout << "Listening...\n" << std::endl;
        while (true) {
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