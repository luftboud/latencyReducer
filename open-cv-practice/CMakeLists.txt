cmake_minimum_required(VERSION 3.16)
project(open-cv-practice)

set(CMAKE_CXX_STANDARD 20)
set(OpenCV_DIR /opt/homebrew/Cellar/opencv/4.13.0_7/lib/cmake/opencv4)

find_package(OpenCV REQUIRED)

add_executable(open-cv-practice main.cpp)
target_link_libraries(open-cv-practice ${OpenCV_LIBS})
target_include_directories(open-cv-practice PRIVATE ${OpenCV_INCLUDE_DIRS})