#include <iostream>
#include <optional>

#include "server.h"

int main(int argc, char** argv) {
    std::optional<server_t> s;

    try {
        if (argc >= 3) {
            std::string addr = argv[1];
            int port = std::stoi(argv[2]);
            s.emplace(std::move(addr), port);
        } else s.emplace();

        s->launch();
        s->stop();

    } catch (const std::exception& e) {
        std::cerr << "Server error: " << e.what() << std::endl;
        s->stop();
        return 1;
    }
    return 0;
}