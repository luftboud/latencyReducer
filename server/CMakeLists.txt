cmake_minimum_required(VERSION 3.25)

set(PROJECT_NAME server)
project(${PROJECT_NAME} CXX)

set(CMAKE_CXX_STANDARD 20)

add_executable(${PROJECT_NAME}
        src/main.cpp
        src/server.cpp
)

find_package(Boost 1.85 REQUIRED COMPONENTS system json)
target_include_directories(${PROJECT_NAME} PRIVATE ${Boost_INCLUDE_DIR})
target_link_libraries(${PROJECT_NAME} PRIVATE Boost::system Boost::json ws2_32)

target_include_directories(${PROJECT_NAME} PRIVATE include)