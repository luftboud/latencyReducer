#include <iostream>

#include "server.h"

int main(int argc, char** argv) {
    server_t s;

    if (argc == 3) {
        std::string addr = argv[1];
        int port = std::stoi(argv[2]);
    }

    s.launch();
    return 0;
}
