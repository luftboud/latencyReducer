/*
Server-client integration
*/

const videoElement = document.getElementById("video");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const sendBtn = document.getElementById("sendBtn");
const inputIp = document.getElementById("input-ip");
const errorIp = document.getElementById("errorIp");
const controlsIP = document.getElementById("controlsIP");
const controlsBtn = document.getElementById("controlsBtn");

let websocketSignal;
let peerConnection;
let videoControlsStart = false;
let pendingRemoteCandidates = [];
let statsTimer;
let URL;

sendBtn.addEventListener("click", () => {
  const ip = inputIp.value.trim();

  if (!ip) {
    log("IP is empty!");
    errorIp.textContent = "IP is empty!";
    return;
  }

  URL = `ws://${ip}`;
  log("URL saved:", URL);
  errorIp.textContent = "IP saved";
  controlsIP.style.display = "none";
  controlsBtn.style.display = "flex";
});

function log(...args) {
  /*
    for the outputs 
  */
  console.log("[web-client]", ...args);
}

function controlsStarter(running) {
  /*
    controls UI buttons
  */
  startBtn.disabled = running;
  stopBtn.disabled = !running;
}

function createPeerConnection() {
  /*
    creates connection with the server
  */

  // creating peer connection
  peerConnection = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    sdpSemantics: "unified-plan",
  });

  console.log("Connection with Server was established");

  // for info on ICE connections
  peerConnection.oniceconnectionstatechange = () => {
    log("iceConnectionState =", peerConnection.iceConnectionState);

    if (peerConnection.iceConnectionState === "failed") {
      log("IceConnection failed, restarting...");
      stop();
    }
  };

  // for info on overall RTCPeerConnection state
  peerConnection.onconnectionstatechange = () => {
    log("connectionState =", peerConnection.connectionState);

    if (peerConnection.connectionState === "connected") {
      if (statsTimer) clearInterval(statsTimer);
      statsTimer = setInterval(getStats, 6000);
      getStats();
    } else if (peerConnection.connectionState === "failed") {
      log("Connection failed, restarting...");
      stop();
    }
  };

  // for info on WebRTC state
  peerConnection.onsignalingstatechange = () =>
    log("signalingState =", peerConnection.signalingState);

  // finds and connects to some ICE protocol
  peerConnection.onicecandidate = (event) => {
    if (!event.candidate) {
      log("ICE gathering finished");
      return;
    }
    log("local ICE candidate:", event.candidate.candidate);

    if (websocketSignal && websocketSignal.readyState === WebSocket.OPEN) {
      websocketSignal.send(
        JSON.stringify({
          type: "candidate",
          candidate: event.candidate,
        }),
      );

      log("send ICE candidate");
    }
  };

  peerConnection.ontrack = (event) => {
    log("Video was received");

    const stream = event.streams[0];
    if (videoElement.srcObject !== stream) {
      videoElement.srcObject = stream;
      log("Video stream attached");
    }
  };

  log("RTCPeerConnection created");
  return peerConnection;
}

// handler for offer and candidate
async function handleOffer(offer) {
  // waiting for the offer from the server
  await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
  log("offer from server was received");

  if (pendingRemoteCandidates.length > 0) {
    log("flushing pending candidates:", pendingRemoteCandidates.length);

    for (const c of pendingRemoteCandidates) {
      try {
        await peerConnection.addIceCandidate(c);
      } catch (e) {
        log("could not add ICE candidate", e);
      }
    }
    pendingRemoteCandidates = [];
  }

  const answerServer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answerServer);
  log("answer from the browser to server set");

  // sends answer to server
  websocketSignal.send(
    JSON.stringify({
      type: "answer",
      sdp: peerConnection.localDescription.sdp,
    }),
  );

  log("answer from the browser was sent to server");
}

async function addRemoteCandidate(candidate) {
  if (!peerConnection?.remoteDescription) {
    pendingRemoteCandidates.push(candidate);
    log("remoteDescription not set yet - waits in the queue");
    return;
  }

  try {
    await peerConnection.addIceCandidate(candidate);
    log("addIceCandidate OK");
  } catch (e) {
    log("addIceCandidate FAILED:", e);
  }
}

function connectWebSocket() {
  websocketSignal = new WebSocket(URL);

  websocketSignal.addEventListener("open", () => {
    log("WebSocket opened:", URL);

    websocketSignal.send(
      JSON.stringify({
        type: "join",
        role: "viewer",
        ipUrl: URL
      }),
    );

    log("WebSocket sent request to join");
  });

  websocketSignal.onmessage = async (evt) => {
    log("WebSocket message:", evt.data);

    // trying to parse the JSON
    let msg;

    try {
      msg = JSON.parse(evt.data);
    } catch {
      log("WS message is not JSON, ignoring");
      return;
    }

    if (msg) {
      switch (msg.type) {
        case "offer":
          if (!msg.sdp) {
            log("Offer without SDP received");
            return;
          }
          await handleOffer({ type: "offer", sdp: msg.sdp });
          return;

        case "candidate":
          await addRemoteCandidate(msg.candidate);
          return;

        default:
          log("unknown message type:", msg.type, msg);
      }
    }
  };

  websocketSignal.onerror = (e) => log("WebSocket error:", e);
  websocketSignal.addEventListener("close", () => {
    log("WebSocket closed");
  });
}

async function getStats() {
  const stats = await peerConnection.getStats();
  stats.forEach((report) => {
    if (report.type === "candidate-pair") {
      if (report.state === "succeeded") {
        console.log("Candidate-pair report statistics:");
        const currRoundTripTime = report.currentRoundTripTime * 1000;
        const bytesReceived = report.bytesReceived;

        console.log(
          ` Time spent on sending request & receiving information back: ${currRoundTripTime} ms \n Bytes received: ${bytesReceived}`,
        );
      }
    } else if (report.type === "inbound-rtp") {
      if (report.kind === "video") {
        console.log("Received video report statistics:");
        let packetsLost = report.packetsLost;
        let framesPerSecond = report.framesPerSecond;
        let framesDropped = report.framesDropped;
        let framesDecoded = report.framesDecoded;

        let bufferDelay = report.jitterBufferDelay * 1000;
        let bufferMinDelay = report.jitterBufferMinimumDelay * 1000;
        let totalDecodeTime = report.totalDecodeTime * 1000;

        let frameDecodeTime =
          framesDecoded > 0 ? totalDecodeTime / framesDecoded : 0;
        let avgBufferDelay =
          framesDecoded > 0 ? bufferDelay / framesDecoded : 0;

        console.log(
          ` Frames per second: ${framesPerSecond} \n Number of lost packets: ${packetsLost} \n Number of dropped frames: ${framesDropped} \n Number of all decoded frames: ${framesDecoded} \n Awaiting of a buffer to make a complete video: ${bufferDelay.toFixed(2)} ms \n Average buffer delay per frame: ${avgBufferDelay.toFixed(2)} ms \n The smallest delay of a buffer making video: ${bufferMinDelay.toFixed(2)} ms \n Total time taken for decoding: ${totalDecodeTime.toFixed(2)} ms \n Time taken for decoding 1 frame: ${frameDecodeTime.toFixed(2)} ms`,
        );
      }
    }
  });
}

function start() {
  if (videoControlsStart) return;
  if (!URL) {
    log("URL is not set, press Send first");
    return;
  }
  videoControlsStart = true;
  controlsStarter(true);
  log("START clicked");
  createPeerConnection();
  connectWebSocket();
}

function stop() {
  if (!videoControlsStart) return;
  videoControlsStart = false;
  controlsStarter(false);
  log("STOP clicked");
  videoElement.srcObject = null;

  if (peerConnection) {
    peerConnection.ontrack = null;
    peerConnection.onicecandidate = null;
    peerConnection.close();
    peerConnection = null;
    log("RTCPeerConnection closed");
  }

  if (websocketSignal) {
    websocketSignal.close();
    websocketSignal = null;
    log("WebSocket closed (requested)");
  }

  if (statsTimer) {
    clearInterval(statsInterval);
    statsInterval = null;
    log("Stopped saving statistics");
  }
}

startBtn.addEventListener("click", start);
stopBtn.addEventListener("click", stop);

controlsStarter(false);
