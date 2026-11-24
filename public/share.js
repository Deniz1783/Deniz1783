const params = new URLSearchParams(location.search);
const room = params.get("room"), token = params.get("token");
const consent = document.querySelector("#consent"), start = document.querySelector("#start");
const stop = document.querySelector("#stop"), statusEl = document.querySelector("#status");
const message = document.querySelector("#message");
let stream, pc, ws;

if (!room || !token) {
  start.disabled = true; message.textContent = "This participant link is incomplete. Ask the session creator for a new link.";
}
consent.addEventListener("change", () => start.disabled = !consent.checked);

function signalUrl() {
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${location.host}/signal?room=${encodeURIComponent(room)}&role=participant&token=${encodeURIComponent(token)}`;
}
function send(data) { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data)); }

async function startSharing() {
  message.textContent = "";
  start.disabled = true;
  try {
    // Browser permission prompt is mandatory; no capture occurs before this user action.
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24, max: 30 } },
      audio: false
    });
    statusEl.textContent = "Your selected screen is being shared live.";
    stop.classList.remove("hidden"); start.classList.add("hidden");
    stream.getVideoTracks()[0].addEventListener("ended", stopSharing);
    connectSignal();
  } catch (err) {
    start.disabled = !consent.checked;
    message.textContent = err.name === "NotAllowedError" ? "Screen sharing was cancelled or permission was denied." : `Could not start screen sharing: ${err.message}`;
  }
}
function connectSignal() {
  ws = new WebSocket(signalUrl());
  ws.onmessage = async event => {
    const msg = JSON.parse(event.data);
    try {
      if (msg.type === "peer-ready") {
        pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
        stream.getTracks().forEach(track => pc.addTrack(track, stream));
        pc.onicecandidate = e => { if (e.candidate) send({ type: "ice", candidate: e.candidate }); };
        pc.onconnectionstatechange = () => {
          if (pc.connectionState === "connected") statusEl.textContent = "Connected. Your screen is visible to the authorized viewer.";
          if (["failed", "disconnected"].includes(pc.connectionState)) statusEl.textContent = "Connection interrupted. You can stop sharing.";
        };
        await pc.setLocalDescription(await pc.createOffer());
        send({ type: "offer", sdp: pc.localDescription });
      } else if (msg.type === "answer" && pc) {
        await pc.setRemoteDescription(msg.sdp);
      } else if (msg.type === "ice" && pc && msg.candidate) {
        await pc.addIceCandidate(msg.candidate);
      } else if (msg.type === "peer-left") {
        statusEl.textContent = "Viewer disconnected. Your screen is still being shared only while you choose to keep it on.";
        if (pc) { pc.close(); pc = null; }
      }
    } catch (err) { message.textContent = `Connection error: ${err.message}`; }
  };
  ws.onclose = () => { if (stream) statusEl.textContent = "Signaling connection closed. Stop and restart if needed."; };
  ws.onerror = () => { message.textContent = "Could not connect to the session server."; };
}
function stopSharing() {
  if (stream) stream.getTracks().forEach(t => t.stop());
  stream = null;
  if (pc) { pc.close(); pc = null; }
  send({ type: "hangup" });
  if (ws) ws.close();
  statusEl.textContent = "Not sharing. Your screen capture has stopped.";
  stop.classList.add("hidden"); start.classList.remove("hidden");
  start.disabled = !consent.checked;
}
start.addEventListener("click", startSharing);
stop.addEventListener("click", stopSharing);
window.addEventListener("beforeunload", () => { if (stream) stream.getTracks().forEach(t => t.stop()); });