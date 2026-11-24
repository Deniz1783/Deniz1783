const createBtn = document.querySelector("#create");
createBtn.addEventListener("click", async () => {
  createBtn.disabled = true; createBtn.textContent = "Creating secure session…";
  document.querySelector("#error").textContent = "";
  try {
    const response = await fetch("/api/rooms", { method: "POST" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not create session.");
    document.querySelector("#participantLink").value = data.participantUrl;
    document.querySelector("#viewerLink").value = data.viewerUrl;
    document.querySelector("#openViewer").href = data.viewerUrl;
    document.querySelector("#result").classList.remove("hidden");
  } catch (err) { document.querySelector("#error").textContent = err.message; }
  finally { createBtn.disabled = false; createBtn.textContent = "＋ Create another session"; }
});
document.querySelectorAll("[data-copy]").forEach(btn => btn.addEventListener("click", async () => {
  const input = document.getElementById(btn.dataset.copy);
  try { await navigator.clipboard.writeText(input.value); btn.textContent = "COPIED"; }
  catch { input.select(); document.execCommand("copy"); btn.textContent = "COPIED"; }
  setTimeout(() => btn.textContent = "COPY", 1400);
}));