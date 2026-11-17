// Onzichtbaar document dat het eigenlijke downloaden doet. De popup sluit zodra je ergens anders klikt;
// dit document blijft draaien en schrijft rechtstreeks naar het bestand dat je in het Windows-venster koos.
const CONCURRENT = 4;
const abortPerJob = new Map();

const meld = (id, state, tekst, klaar, totaal) =>
  chrome.runtime.sendMessage({ type: "progress", id, state, tekst, klaar: klaar || 0, totaal: totaal || 0 }).catch(() => {});

async function haal(url, signal, range) {
  const headers = {};
  if (range) headers.Range = "bytes=" + range.offset + "-" + (range.offset + range.length - 1);
  let laatste;
  for (let poging = 0; poging < 3; poging++) {
    try {
      const r = await fetch(url, { headers, credentials: "include", signal, cache: "no-store" });
      if (!r.ok && r.status !== 206) { const e = new Error("HTTP " + r.status); e.status = r.status; throw e; }
      return r;
    } catch (e) {
      if (e.name === "AbortError") throw e;
      laatste = e;
      if ([401, 403, 404, 410].includes(e.status)) break;
      await new Promise((res) => setTimeout(res, 500 * (poging + 1)));
    }
  }
  throw laatste;
}

async function schrijfHls(job, writable, signal, voortgang) {
  const sleutels = new Map();
  const sleutel = (uri) => {
    if (!sleutels.has(uri)) sleutels.set(uri, (async () => {
      const raw = new Uint8Array(await (await haal(uri, signal)).arrayBuffer());
      if (raw.length !== 16) throw new Error("Onverwachte sleutellengte (" + raw.length + " bytes)");
      return crypto.subtle.importKey("raw", raw, "AES-CBC", false, ["decrypt"]);
    })());
    return sleutels.get(uri);
  };
  let pl = parsePlaylist(await (await haal(job.url, signal)).text(), job.url);
  if (pl.type !== "media") {
    if (!pl.variants.length) throw new Error("Geen video-varianten gevonden in de hoofdlijst.");
    pl = parsePlaylist(await (await haal(pl.variants[0].url, signal)).text(), pl.variants[0].url); // beste kwaliteit
    if (pl.type !== "media") throw new Error("Onverwachte afspeellijst.");
  }
  const reden = unsupportedReason(pl);
  if (reden) throw new Error(reden);
  const { mode } = planOutput(pl, false);
  let tm = null, initGeschreven = false, uitvoer = [];
  if (mode === "transmux") {
    tm = new muxjs.Transmuxer(); // mux-mp4.min.js exporteert muxjs.Transmuxer (gemeten)
    tm.on("data", (s) => {
      if (!initGeschreven) { uitvoer.push(s.initSegment); initGeschreven = true; }
      uitvoer.push(s.data);
    });
  }
  if (pl.map) await writable.write(new Uint8Array(await (await haal(pl.map.url, signal, pl.map.range)).arrayBuffer()));
  const n = pl.segments.length;
  const haalSegment = async (i) => {
    const seg = pl.segments[i];
    let data = new Uint8Array(await (await haal(seg.url, signal, seg.range)).arrayBuffer());
    if (seg.key) data = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-CBC", iv: ivBytes(seg.key, seg.seq) }, await sleutel(seg.key.uri), data));
    return data;
  };
  const lopend = new Map();
  for (let i = 0; i < Math.min(CONCURRENT, n); i++) lopend.set(i, haalSegment(i));
  for (let i = 0; i < n; i++) {
    const data = await lopend.get(i);
    lopend.delete(i);
    if (i + CONCURRENT < n) lopend.set(i + CONCURRENT, haalSegment(i + CONCURRENT));
    if (tm) {
      if (data[0] !== 0x47) throw new Error("Stukje " + (i + 1) + " is geen MPEG-TS (kreeg 0x" + data[0].toString(16) + "). Onbekend formaat.");
      tm.push(data);
      tm.flush();
      for (const c of uitvoer) await writable.write(c);
      uitvoer = [];
    } else {
      await writable.write(data);
    }
    voortgang(i + 1, n);
  }
  if (tm && !initGeschreven) throw new Error("Omzetten naar MP4 leverde niets op: geen H.264/AAC in de stream.");
}

async function schrijfDirect(job, writable, signal, voortgang) {
  const r = await haal(job.url, signal);
  const totaal = Number(r.headers.get("content-length")) || 0;
  const lezer = r.body.getReader();
  let klaar = 0;
  for (;;) {
    const { done, value } = await lezer.read();
    if (done) break;
    await writable.write(value);
    klaar += value.length;
    voortgang(klaar, totaal);
  }
}

// [plan: blob-dan-venster] Brave zet showSaveFilePicker standaard uit (gemeten: "is not a function"). chrome.downloads met
// saveAs toont het gewone Windows-venster in elke Chromium-browser, maar heeft een URL nodig: dus eerst alles in een Blob,
// daarna de blob-URL. Het venster komt dus pas als het ophalen klaar is.
async function run(m) {
  const id = m.id;
  const job = m.job;
  const ctl = new AbortController();
  abortPerJob.set(id, ctl);
  const delen = [];
  const verzamelaar = { write: async (c) => { delen.push(c); } };
  try {
    const voortgang = (a, b) => meld(id, "bezig", job.label === "HLS" ? "stukje " + a + " van " + b : (a / 1048576).toFixed(1) + " MB", a, b);
    meld(id, "bezig", "start…");
    if (job.label === "HLS") await schrijfHls(job, verzamelaar, ctl.signal, voortgang); else await schrijfDirect(job, verzamelaar, ctl.signal, voortgang);
    const url = URL.createObjectURL(new Blob(delen, { type: job.mime }));
    chrome.runtime.sendMessage({ type: "blob", id, url, filename: job.filename });
  } catch (e) {
    if (e.name === "AbortError") meld(id, "gestopt", "Gestopt.");
    else {
      const verlopen = [401, 403, 410].includes(e.status);
      meld(id, "fout", e.message + (verlopen ? " - de link is waarschijnlijk verlopen: laat de video opnieuw starten en probeer meteen." : ""));
    }
  } finally {
    abortPerJob.delete(id);
  }
}

chrome.runtime.onMessage.addListener((m) => {
  if (m.type === "run") run(m);
  if (m.type === "stop" && abortPerJob.has(m.id)) abortPerJob.get(m.id).abort();
});
