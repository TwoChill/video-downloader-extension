const $ = (id) => document.getElementById(id);
const MIME = { mp4: "video/mp4", m4a: "audio/mp4", mp3: "audio/mpeg", aac: "audio/aac", webm: "video/webm", mkv: "video/x-matroska" };

function mb(n) { return n ? " · " + (n / 1048576 < 1 ? Math.round(n / 1024) + " KB" : (n / 1048576).toFixed(1) + " MB") : ""; }

// De popup geeft de opdracht door; een onzichtbaar offscreen-document haalt de stream op, zodat het doorloopt als de
// popup sluit. Daarna toont chrome.downloads (saveAs) het Windows-venster met map en bestandsnaam.
async function download(item, tab, statusEl, knop) {
  const ext = item.label === "HLS" ? "mp4" : extUitUrl(item.url, item.label === "Audio" ? "mp3" : "mp4");
  const id = crypto.randomUUID();
  const job = { url: item.url, label: item.label, mime: MIME[ext] || "application/octet-stream", filename: (schoonNaam(tab.title) || "video") + "." + ext };
  knop.disabled = true;
  statusEl.dataset.job = id;
  statusEl.className = "status";
  statusEl.textContent = "Starten…";
  const r = await chrome.runtime.sendMessage({ type: "start", id, referer: item.referer || tab.url, job });
  if (!r || !r.ok) { statusEl.textContent = "Mislukt: " + (r && r.fout); knop.disabled = false; }
}

chrome.runtime.onMessage.addListener((m) => {
  if (m.type !== "progress") return;
  const el = document.querySelector('[data-job="' + m.id + '"]');
  if (!el) return;
  el.textContent = m.state === "bezig" ? "Bezig: " + m.tekst : m.tekst;
  el.className = "status " + (m.state === "klaar" ? "ok" : m.state === "fout" ? "er" : "");
});

async function start() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const key = "tab:" + tab.id;
  const lijst = (await chrome.storage.session.get(key))[key] || [];
  $("leeg").hidden = lijst.length > 0;
  for (const item of lijst.slice().reverse()) {
    const div = document.createElement("div"); div.className = "item";
    const kop = document.createElement("div");
    const b = document.createElement("b"); b.textContent = item.label;
    kop.append(b, document.createTextNode(new URL(item.url).hostname + mb(item.size)));
    const u = document.createElement("div"); u.className = "url"; u.textContent = item.url;
    const st = document.createElement("div"); st.className = "status";
    const knop = document.createElement("button");
    if (item.label === "DASH") { knop.textContent = "DASH niet ondersteund"; knop.disabled = true; }
    else { knop.textContent = "Download"; knop.addEventListener("click", () => download(item, tab, st, knop)); }
    div.append(kop, u, knop, st);
    $("lijst").append(div);
  }
}
start();
