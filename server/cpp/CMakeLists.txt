cmake_minimum_required(VERSION 3.25)

set(PROJECT_NAME server)
project(${PROJECT_NAME} C CXX)

add_executable(${PROJECT_NAME} src/main.cpp)