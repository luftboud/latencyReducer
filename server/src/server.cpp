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

static const std::string ASK_OFFER = R"({"type":"send_offer"})";
static const std::string USER_EXISTS_ERROR = R"({"type":"error","msg":"Cannot join to server. There already is user signed with the same role."})";

std::string server_t::log_participants(const std::string& buf, websocket_type socket) {
    std::lock_guard<std::mutex> lock(m);
    json::value json_content = json::parse(buf);
    std::string role;

    if (json_content.as_object()["type"].as_string() == "join" &&
        json_content.as_object()["role"].as_string() == "sender" &&
        sender.get_ws() == nullptr) {
        sender.set_ws(socket);
        std::cout << "Sender is logged" << std::endl;
        role = "sender";
    }

    else if (json_content.as_object()["type"].as_string() == "join" &&
             json_content.as_object()["role"].as_string() == "viewer" &&
             viewer.get_ws() == nullptr) {
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

void client_worker(websocket_type&& ws, server_t* server) {
    std::string curr_role;
    std::cout << "Connected user WS" << std::endl;
    try {
        ws->accept();
        while (true) {
            boost::beast::flat_buffer buff;
            ws->read(buff);

            std::string msg = boost::beast::buffers_to_string(buff.data());

            json::value json_content = json::parse(msg).as_object();
            std::string msg_type = json_content.as_object()["type"].as_string().c_str();

            if (msg_type == "join" && server->everybody()) {
                ws->text(true);
                ws->write(boost::asio::buffer(USER_EXISTS_ERROR));
                ws->close(websocket::close_code::normal);
                return;
            }

            if (msg_type == "join") {
                curr_role = server->log_participants(msg, ws);

                if (curr_role.empty()) {
                    ws->text(true);
                    ws->write(boost::asio::buffer(USER_EXISTS_ERROR));
                    ws->close(websocket::close_code::normal);
                    return;
                }

                if (server->everybody()) {
                    websocket_type sender = server->get_sender().get_ws();
                    sender->text(true);
                    sender->write(boost::asio::buffer(ASK_OFFER));
                }
                continue;
            }

            if (!server->everybody()) continue;

            if (msg_type == "offer") {
                websocket_type viewer = server->get_viewer().get_ws();
                viewer->text(true);
                viewer->write(boost::asio::buffer(msg));
            }

            else if (msg_type == "answer") {
                websocket_type sender = server->get_sender().get_ws();
                sender->text(true);
                sender->write(boost::asio::buffer(msg));
            }

            else if (curr_role == "viewer" && msg_type == "candidate") {
                websocket_type sender = server->get_sender().get_ws();
                sender->text(true);
                sender->write(boost::asio::buffer(msg));
            }

            else if (curr_role == "sender" && msg_type == "candidate") {
                websocket_type viewer = server->get_viewer().get_ws();
                viewer->text(true);
                viewer->write(boost::asio::buffer(msg));
            }

        }
    } catch (const boost::system::system_error& e) {
        server->delete_socket(curr_role);

        if (e.code() == websocket::error::closed ||
            e.code() == boost::asio::error::connection_aborted) {
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
        std::cout << "Listening...\n" << std::endl;
        while (true) {
            tcp::socket socket(io);
            acceptor.accept(socket);
            std::cout << "Connected user TCP" << std::endl;

            auto ws = std::make_shared<websocket::stream<tcp::socket>>(std::move(socket));
            std::thread(client_worker, std::move(ws), this).detach();
        }
    } catch (const std::exception& e) {
        std::cerr << "Error occurred: " << e.what() << std::endl;
    }
}