#include <iostream>
#include <array>
#include <boost/asio.hpp>

#include "server.h"

using boost::asio::ip::tcp;

void launch(const std::string& addr, int port) {
    boost::asio::io_context io;
    tcp::acceptor acceptor(io, tcp::endpoint(boost::asio::ip::make_address(addr), port));

    try {
        while (true) {
            std::cout << "Listening...\n" << std::flush;
            tcp::socket socket(io);
            acceptor.accept(socket);

            std::array<char, 1024> buffer{};
            boost::system::error_code ec;

            while (true) {
                size_t size = socket.read_some(boost::asio::buffer(buffer), ec);
                if (ec == boost::asio::error::eof) break;

                boost::asio::write(socket, boost::asio::buffer(buffer.data(), size));
            }
        }
    } catch (const std::exception& e) {
        std::cerr << "Error occurred: " << e.what() << std::endl;
    }
}