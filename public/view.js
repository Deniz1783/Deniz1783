const params = new URLSearchParams(location.search);
const room = params.get("room"), token = params.get("token");
const video = document.querySelector("#remote"), placeholder = document.querySelector("#placeholder");
const statusEl = document.querySelector("#status"), state = document.querySelector("#state");
const connection = document.querySelector("#connection");
let pc, ws;
function setState(text) { state.lastChild.textContent = ` ${text}`; }
function send(data) { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data)); }

if (!room || !token) {
  statusEl.textContent = "Invalid viewer link. Create a new session.";
  document.querySelector("#disconnect").disabled = true;
} else connect();

function connect() {
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${scheme}//${location.host}/signal?room=${encodeURIComponent(room)}&role=viewer&token=${encodeURIComponent(token)}`);
  ws.onopen = () => { connection.textContent = "Connected to session server"; };
  ws.onmessage = async event => {
    const msg = JSON.parse(event.data);
    try {
      if (msg.type === "offer") {
        pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
        pc.ontrack = e => {
          video.srcObject = e.streams[0];
          placeholder.classList.add("hidden");
          statusEl.textContent = "The participant approved sharing. Live screen received.";
          setState("LIVE");
        };
        pc.onicecandidate = e => { if (e.candidate) send({ type: "ice", candidate: e.candidate }); };
        pc.onconnectionstatechange = () => {
          connection.textContent = `WebRTC: ${pc.connectionState}`;
          if (["failed", "disconnected", "closed"].includes(pc.connectionState)) {
            placeholder.classList.remove("hidden"); setState("WAITING");
          }
        };
        await pc.setRemoteDescription(msg.sdp);
        await pc.setLocalDescription(await pc.createAnswer());
        send({ type: "answer", sdp: pc.localDescription });
      } else if (msg.type === "ice" && pc && msg.candidate) {
        await pc.addIceCandidate(msg.candidate);
      } else if (msg.type === "peer-left") {
        statusEl.textContent = "The participant disconnected or stopped sharing.";
        video.srcObject = null; placeholder.classList.remove("hidden"); setState("ENDED");
        if (pc) { pc.close(); pc = null; }
      } else if (msg.type === "peer-ready") {
        statusEl.textContent = "Participant connected. Waiting for their screen-sharing approval.";
      }
    } catch (err) { statusEl.textContent = `Connection error: ${err.message}`; }
  };
  ws.onclose = () => { connection.textContent = "Session server disconnected"; };
  ws.onerror = () => { statusEl.textContent = "Could not connect. Check that the room is still active."; };
}
document.querySelector("#disconnect").addEventListener("click", () => {
  if (pc) pc.close();
  if (ws) ws.close();
  video.srcObject = null; placeholder.classList.remove("hidden");
  statusEl.textContent = "You disconnected from the session."; setState("DISCONNECTED");
  document.querySelector("#disconnect").disabled = true;
});