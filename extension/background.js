importScripts("match.js");

// Een service worker kan elk moment stoppen: de lijst staat in storage.session, niet in een variabele.
// Schrijven loopt via één keten, anders overschrijven twee gelijktijdige verzoeken elkaars lijst.
let keten = Promise.resolve();
const referers = new Map(); // requestId -> Referer-header, alleen tussen "verzonden" en "antwoord"

function bewaar(tabId, item) {
  keten = keten.then(async () => {
    const key = "tab:" + tabId;
    const lijst = (await chrome.storage.session.get(key))[key] || [];
    if (lijst.some((i) => i.url === item.url)) return;
    lijst.push(item);
    await chrome.storage.session.set({ [key]: lijst });
    chrome.action.setBadgeText({ tabId, text: String(lijst.length) });
  }).catch((e) => console.error("bewaar mislukt", e));
}

chrome.webRequest.onSendHeaders.addListener(
  (d) => {
    const r = (d.requestHeaders || []).find((h) => h.name.toLowerCase() === "referer");
    if (r) referers.set(d.requestId, r.value);
  },
  { urls: ["<all_urls>"] },
  ["requestHeaders", "extraHeaders"]
);

chrome.webRequest.onHeadersReceived.addListener(
  (d) => {
    const referer = referers.get(d.requestId) || "";
    referers.delete(d.requestId);
    if (d.tabId < 0) return;
    if (d.initiator && d.initiator.startsWith("chrome-extension://")) return; // onze eigen downloadverzoeken
    const h = (d.responseHeaders || []).find((x) => x.name.toLowerCase() === "content-type");
    const label = classify(d.url, h && h.value);
    if (!label) return;
    const len = (d.responseHeaders || []).find((x) => x.name.toLowerCase() === "content-length");
    bewaar(d.tabId, { url: d.url, label, referer, size: len ? Number(len.value) : null, t: Date.now() });
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

chrome.webRequest.onErrorOccurred.addListener((d) => referers.delete(d.requestId), { urls: ["<all_urls>"] });

// [plan: leegmaken-op-main_frame] Nieuwe paginalading = lijst leegmaken, op het main_frame-verzoek zelf.
// tabs.onUpdated("loading") komt in een ander eventkanaal en kan NA de eerste videoverzoeken binnenkomen
// en die dan wissen (gemeten: lijst bleef leeg). webRequest-events zijn onderling wel in volgorde.
// pushState-navigatie (geen nieuw main_frame-verzoek) laat de lijst staan.
chrome.webRequest.onBeforeRequest.addListener(
  (d) => {
    if (d.type !== "main_frame" || d.tabId < 0) return;
    keten = keten.then(() => chrome.storage.session.remove("tab:" + d.tabId)).catch(() => {});
    chrome.action.setBadgeText({ tabId: d.tabId, text: "" });
  },
  { urls: ["<all_urls>"] }
);
// --- Downloaden: de popup geeft een job door; hier regelen we headers en het onzichtbare offscreen-document.
// [plan: referer-via-dnr] fetch() mag geen Referer/Origin zetten; veel streams eisen ze. Sessieregel alleen voor
// verzoeken van deze extensie (initiatorDomains) naar de host van de stream.
const regels = new Map(); // jobId -> regel-id
async function maakOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({ url: "offscreen.html", reasons: ["BLOBS"], justification: "Stream ophalen en naar het gekozen bestand schrijven" });
}
async function startJob(m) {
  const regelId = Math.floor(Math.random() * 2000000000) + 1;
  regels.set(m.id, regelId);
  if (m.referer) {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [regelId],
      addRules: [{ id: regelId, priority: 1,
        action: { type: "modifyHeaders", requestHeaders: [
          { header: "referer", operation: "set", value: m.referer },
          { header: "origin", operation: "set", value: new URL(m.referer).origin }] },
        condition: { initiatorDomains: [chrome.runtime.id], resourceTypes: ["xmlhttprequest", "other"] } }]
    });
  }
  await maakOffscreen();
  await chrome.runtime.sendMessage({ type: "run", id: m.id, job: m.job });
}
let lopend = 0;
const downloads = new Map(); // downloadId -> jobId
function status(id, state, tekst, klaar, totaal) {
  chrome.storage.session.set({ ["status:" + id]: { state, tekst } });
  chrome.runtime.sendMessage({ type: "progress", id, state, tekst, klaar, totaal }).catch(() => {});
  if (state === "bezig") {
    chrome.action.setBadgeBackgroundColor({ color: "#2563eb" });
    chrome.action.setBadgeText({ text: totaal ? Math.round(klaar / totaal * 100) + "%" : "…" });
    return;
  }
  lopend = Math.max(0, lopend - 1);
  chrome.action.setBadgeBackgroundColor({ color: state === "klaar" ? "#16794c" : "#b42318" });
  chrome.action.setBadgeText({ text: state === "klaar" ? "OK" : "!" });
  const r = regels.get(id);
  if (r) { chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [r] }); regels.delete(id); }
  if (!lopend) chrome.offscreen.closeDocument().catch(() => {});
}
chrome.runtime.onMessage.addListener((m, _s, antwoord) => {
  if (m.type === "start") {
    lopend++;
    startJob(m).then(() => antwoord({ ok: true }), (e) => { lopend--; antwoord({ ok: false, fout: e.message }); });
    return true;
  }
  if (m.type === "progress") {
    if (m.state === "bezig") status(m.id, m.state, m.tekst, m.klaar, m.totaal);
    else status(m.id, m.state, m.tekst);
  }
  if (m.type === "blob") {
    status(m.id, "bezig", "Kies in het Windows-venster waar je het opslaat", 0, 0);
    chrome.downloads.download({ url: m.url, filename: m.filename, saveAs: true, conflictAction: "uniquify" }, (dlId) => {
      if (chrome.runtime.lastError || !dlId) status(m.id, "fout", "Opslaan mislukt: " + (chrome.runtime.lastError && chrome.runtime.lastError.message));
      else downloads.set(dlId, m.id);
    });
  }
});
chrome.downloads.onChanged.addListener((d) => {
  const id = downloads.get(d.id);
  if (!id || !d.state) return;
  if (d.state.current === "complete") { downloads.delete(d.id); status(id, "klaar", "Klaar: opgeslagen"); }
  if (d.state.current === "interrupted") {
    downloads.delete(d.id);
    chrome.downloads.search({ id: d.id }, ([i]) => status(id, i && i.error === "USER_CANCELED" ? "gestopt" : "fout", i && i.error === "USER_CANCELED" ? "Geannuleerd: geen map gekozen." : "Opslaan mislukt: " + (i && i.error)));
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  keten = keten.then(() => chrome.storage.session.remove("tab:" + tabId)).catch(() => {});
});
