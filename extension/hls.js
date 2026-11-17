// HLS-afspeellijsten lezen (RFC 8216). Pure functies, geen DOM: ook te testen in Node.

function resolveUrl(rel, base) { return new URL(rel, base).href; }

// KEY=waarde,KEY="waarde met komma"
function parseAttrs(s) {
  const out = {};
  const re = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    let v = m[2];
    if (v.startsWith('"')) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

// "lengte@begin" of alleen "lengte" (dan begint het waar het vorige stuk van dezelfde URL ophield)
function parseByteRange(s, prevEnd) {
  const [l, o] = s.split("@");
  return { length: parseInt(l, 10), offset: o !== undefined ? parseInt(o, 10) : prevEnd };
}

function parsePlaylist(text, baseUrl) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length);
  if (!lines.length || lines[0] !== "#EXTM3U") throw new Error("Dit is geen geldige m3u8-afspeellijst.");
  return lines.some((l) => l.startsWith("#EXT-X-STREAM-INF")) ? parseMaster(lines, baseUrl) : parseMedia(lines, baseUrl);
}

function parseMaster(lines, baseUrl) {
  const variants = [];
  const audio = {};
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith("#EXT-X-STREAM-INF:")) {
      const at = parseAttrs(l.slice(18));
      let j = i + 1;
      while (j < lines.length && lines[j].startsWith("#")) j++;
      if (j < lines.length) {
        variants.push({
          url: resolveUrl(lines[j], baseUrl),
          bandwidth: parseInt(at.BANDWIDTH || at["AVERAGE-BANDWIDTH"] || "0", 10),
          resolution: at.RESOLUTION || "", audioGroup: at.AUDIO || "", codecs: at.CODECS || ""
        });
      }
    } else if (l.startsWith("#EXT-X-MEDIA:")) {
      const at = parseAttrs(l.slice(13));
      if (at.TYPE === "AUDIO" && at.URI) {
        const g = at["GROUP-ID"] || "";
        (audio[g] = audio[g] || []).push({ url: resolveUrl(at.URI, baseUrl), name: at.NAME || "", language: at.LANGUAGE || "", isDefault: at.DEFAULT === "YES" });
      }
    }
  }
  variants.sort((a, b) => b.bandwidth - a.bandwidth);
  return { type: "master", variants, audio };
}

function parseMedia(lines, baseUrl) {
  const segments = [];
  const methods = new Set();
  const prevEnd = {};
  let seq = 0, key = null, map = null, endlist = false, dur = 0, br = null, discontinuities = 0;
  for (const l of lines) {
    if (l.startsWith("#EXT-X-MEDIA-SEQUENCE:")) seq = parseInt(l.slice(22), 10) || 0;
    else if (l.startsWith("#EXT-X-KEY:")) {
      const at = parseAttrs(l.slice(11));
      methods.add(at.METHOD);
      key = at.METHOD === "NONE" ? null : { method: at.METHOD, uri: at.URI ? resolveUrl(at.URI, baseUrl) : "", iv: at.IV || "" };
    } else if (l.startsWith("#EXT-X-MAP:")) {
      const at = parseAttrs(l.slice(11));
      map = { url: resolveUrl(at.URI, baseUrl), range: at.BYTERANGE ? parseByteRange(at.BYTERANGE, 0) : null };
    } else if (l.startsWith("#EXTINF:")) dur = parseFloat(l.slice(8)) || 0;
    else if (l.startsWith("#EXT-X-BYTERANGE:")) br = l.slice(17);
    else if (l === "#EXT-X-ENDLIST") endlist = true;
    else if (l === "#EXT-X-DISCONTINUITY") discontinuities++;
    else if (!l.startsWith("#")) {
      const url = resolveUrl(l, baseUrl);
      let range = null;
      if (br) { range = parseByteRange(br, prevEnd[url] || 0); prevEnd[url] = range.offset + range.length; br = null; }
      segments.push({ url, duration: dur, range, key, seq: seq + segments.length });
      dur = 0;
    }
  }
  return { type: "media", segments, map, endlist, methods: [...methods], discontinuities };
}

// IV: expliciet uit de playlist, anders het volgnummer van het segment als 128-bit big-endian getal.
function ivBytes(key, seq) {
  const iv = new Uint8Array(16);
  if (key.iv) {
    const hex = key.iv.replace(/^0x/i, "").padStart(32, "0");
    for (let i = 0; i < 16; i++) iv[i] = parseInt(hex.substr(i * 2, 2), 16);
  } else {
    let n = seq;
    for (let i = 15; i >= 8 && n > 0; i--) { iv[i] = n % 256; n = Math.floor(n / 256); }
  }
  return iv;
}

// Wat voor bestand komt eruit? Bepaald vóór het opslagvenster opent (de extensie staat daar al in).
function planOutput(media, audioOnly) {
  const first = media.segments[0].url.split("?")[0].toLowerCase();
  if (media.map || /\.(m4s|mp4|cmfv|cmfa|m4a|m4v)$/.test(first)) return { mode: "concat", ext: audioOnly ? "m4a" : "mp4" };
  if (/\.(aac|mp3)$/.test(first)) return { mode: "concat", ext: first.endsWith(".mp3") ? "mp3" : "aac" };
  return { mode: "transmux", ext: audioOnly ? "m4a" : "mp4" }; // .ts of zonder extensie: bij het lezen gecontroleerd (0x47)
}

// Waarom kan dit niet? null als het kan.
function unsupportedReason(media) {
  if (!media.endlist) return "Dit is een livestream (de afspeellijst heeft geen einde). Livestreams worden niet ondersteund.";
  if (!media.segments.length) return "De afspeellijst bevat geen segmenten.";
  const slecht = media.methods.find((m) => m && m !== "NONE" && m !== "AES-128");
  if (slecht) return "Deze stream is versleuteld met " + slecht + " (DRM). Dat kan een extensie niet openen.";
  return null;
}
