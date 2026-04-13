# Optimization of the video stream decoding algorithm
> Term project for the Architecture of Computer Systems course

### Idea
Exploration of the ways to optimize the video stream decoding algorithm, in particular on surveillance devices from `Dahua Technology`, through the implementation of appropriate software based on the `Web Real-Time Communication (WebRTC)` protocol, since the use of software from developers does not provide the desired delay in video transmission from a device in motion, which is critical for tasks related to video surveillance.

### Aim 
Create software that displays images from a camera in a browser with minimal delay, and explore the features of working with an
IP camera.

### Prerequisites
- Python 3
- Node.JS
- GCC/Clang
- IP-camera Dahua DH-IPC-HFW2249S-S-IL.

Install the dependencies written in `dependencies.md` and `requirements.txt`
### Installation and Usage
Clone the repository
```
git clone https://github.com/luftboud/latencyReducer
```
Install the dependencies written in `dependencies.md` and `requirements.txt`


1. Run the server
```
cd server/cpp
mkdir build
cd build
cmake ..
make
./server
```
2. Run the client
```
cd webclient
npx server .
<y> 
```
3. Open the client via localhost and click `start` - to send a request to the websocket
4. Run the sender
```
cd sender
python<3> sender.py
```
To view the statistics for decoding and transporting the video stream, open the console in the browser.

### Project Structure
```
latencyReducer/
├── sender/ simulator of the IP-camera logic - creates a video stream & communicates with client
├── server/ main channel of communication between sender(camera) and client
└── webclient/ webclient that displays the decoded video stream in the browser
```

### Current project status
A prototype was created based on the `WebRTC protocol`, for which a `server-exchanger` was written, a `Python script` that simulates the behavior of the camera, generating a video stream and sending a request to transfer this information to the server, which, in turn, ensures the connection of the web client and the transfer of the stream for playback in the browser. We investigated the software environment and the camera features themselves, disabled some settings that affected the latency, and identified other problematic areas of the camera, particularly a delay that increased during more active movement.

### Contributors
- [Iia Maharyta](https://github.com/luftboud)
- [Vladyslav Danylyshyn](https://github.com/D-VLAD1)
- [Oksana Moskviak](https://github.com/okqsna)
- [Olena Dovbenchuk](https://github.com/Olenadovb)
