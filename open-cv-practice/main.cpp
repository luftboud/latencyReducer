#include <iostream>
#include <opencv2/opencv.hpp>

int main() {
    std::string url =
        "rtsp://admin:iloveacs2026@192.168.1.150:554/cam/realmonitor?channel=1&subtype=1";

    cv::VideoCapture cap(url);

    if (!cap.isOpened()) {
        std::cerr << "Cannot open Dahua stream\n";
        return 1;
    }

    cv::Mat frame;
    
    while (true) {
        if (!cap.read(frame) || frame.empty()) {
            std::cerr << "Cannot read frame\n";
            break;
        }

        cv::imshow("Dahua stream", frame);

        if (cv::waitKey(1) == 27) break;
    }

    cap.release();
    cv::destroyAllWindows();
    return 0;
}