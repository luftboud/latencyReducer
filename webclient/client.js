/*
Server-client integration
*/
import {processNetworkStats,
  processVideoStats,
  logStatistics,
  getStatisticsLog,
  saveToCSV,
  resetStatistics} from "./statistics.js";


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
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
  });

  console.log("Connection with Server was established");

  // for info on ICE connections
  peerConnection.oniceconnectionstatechange = () => {
    if (peerConnection.iceConnectionState === "failed") {
      log("IceConnection failed, restarting...");
      stop();
    }
  };

  // for info on overall RTCPeerConnection state
  peerConnection.onconnectionstatechange = () => {
    if (peerConnection.connectionState === "connected") {
      if (statsTimer) clearInterval(statsTimer);
        statsTimer = setInterval(async () => {
          try {
            await getStats();
          } catch (e) {
            log("Stats error:", e);
          }
        }, 6000);
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

    if (websocketSignal && websocketSignal.readyState === WebSocket.OPEN) {
      websocketSignal.send(
        JSON.stringify({
          type: "candidate",
          candidate: event.candidate,
        }),
      );

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

  if (pendingRemoteCandidates.length > 0) {
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
  if (!peerConnection) return;
  const stats = await peerConnection.getStats();
  const networkStats = processNetworkStats(stats);
  const videoStats = processVideoStats(stats);
  logStatistics(networkStats, videoStats);
  log(networkStats, videoStats);
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
    clearInterval(statsTimer);
    statsTimer = null;
    log("Stopped saving statistics");
    if (getStatisticsLog().length > 0) {
      saveToCSV();
    }
    resetStatistics();
  }
}

startBtn.addEventListener("click", start);
stopBtn.addEventListener("click", stop);

controlsStarter(false);
