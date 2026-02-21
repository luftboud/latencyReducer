/*
Server-client integration
*/

const URL = "ws://localhost:8000/ws";
const videoElement = document.getElementById("video");
const startBtn = document.getElementById("startBtn");
const stopBtn  = document.getElementById("stopBtn");

let websocketSignal;
let peerConnection;
let videoControlsStart = false;
let pendingRemoteCandidates = [];

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
    sdpSemantics: "unified-plan"
  });

  console.log("Connection with Server was established")

  // for info on ICE connections
  peerConnection.oniceconnectionstatechange = () => log("iceConnectionState =", peerConnection.iceConnectionState);
  // for info on overall RTCPeerConnection state
  peerConnection.onconnectionstatechange = () => log("connectionState =", peerConnection.connectionState);
  // for info on WebRTC state
  peerConnection.onsignalingstatechange = () => log("signalingState =",  peerConnection.signalingState);

  // finds and connects to some ICE protocol
  peerConnection.onicecandidate = (event) => {
    if (!event.candidate) {
      log("ICE gathering finished");
      return;
    }
    log("local ICE candidate:", event.candidate.candidate);

    if (websocketSignal && websocketSignal.readyState === WebSocket.OPEN) {
      websocketSignal.send(JSON.stringify({
        type: "candidate",
        candidate: event.candidate
      }));
      
      log("send ICE candidate");
    }
  };

  
  peerConnection.ontrack = (event) => {
    log("Video was received");
    
    const stream = event.streams[0];
    if (videoEl.srcObject !== stream) {
      videoEl.srcObject = stream;
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
  const answerServer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answerServer);
  log("answer from the browser to server set");

  // sends answer to server
  ws.send(JSON.stringify({
    type: "answer",
    answer: peerConnection.localDescription
  }));
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

  if (pendingRemoteCandidates.length > 0) {
    log("flushing pending candidates:", pendingRemoteCandidates.length);
    for (const c of pendingRemoteCandidates) {
      try { 
        await peerConnection.addIceCandidate(c); 
      } catch(e){ 
        log("could not add ICE candidate", e); 
      }
    }
    pendingRemoteCandidates = [];
  }
}

function connectWebSocket() {
  websocketSignal = new WebSocket(URL);

  websocketSignal.addEventListener("open", () => {
   log("WebSocket opened:", URL);
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

    if (msg.type === "offer") {
      const offer = msg.offer ?? msg;
      await handleOffer(offer);
      return;
    }

    if (msg.type === "candidate") {
      const cand = msg.candidate ?? msg;
      await handleRemoteCandidate(cand);
      return;
    }

    log("unknown message type:", msg.type, msg);
  };

  websocketSignal.onerror = (e) => log("WebSocket error:", e);
  websocketSignal.addEventListener("close", () => {
   log("WebSocket closed");
  });
}

function start() {
  if (videoControlsStart) return;
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
    peerConnection.close();
    peerConnection = null;
    log("RTCPeerConnection closed");
  }

  if (websocketSignal) {
    websocketSignal.close();
    websocketSignal = null;
    log("WebSocket closed (requested)");
  }
}

startBtn.addEventListener("click", start);
stopBtn.addEventListener("click", stop);

controlsStarter(false);
log("client.js loaded and ready");