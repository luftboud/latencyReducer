cmake_minimum_required(VERSION 3.25)

set(PROJECT_NAME server)
project(${PROJECT_NAME} CXX)

add_executable(${PROJECT_NAME}
        src/main.cpp
        src/server.cpp)

find_package(Boost 1.72 REQUIRED COMPONENTS system)
target_include_directories(${PROJECT_NAME} PRIVATE ${Boost_INCLUDE_DIR})
target_link_libraries(${PROJECT_NAME} PRIVATE Boost::system)

target_include_directories(${PROJECT_NAME} PRIVATE include)