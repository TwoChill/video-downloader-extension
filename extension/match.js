// Bepaalt of een netwerkverzoek een video/audio-bron is. Geeft een label of null.
// Segmenten (.ts, .m4s, video/mp2t) tellen niet: dat zijn stukjes van een stream, niet de stream.
function classify(url, contentType) {
  var path = "";
  try { path = new URL(url).pathname.toLowerCase(); } catch (e) { return null; }
  var ct = (contentType || "").toLowerCase().split(";")[0].trim();

  if (/\.(ts|m4s|aac|vtt|srt|jpg|jpeg|png|gif|webp|css|js|json|woff2?)$/.test(path)) return null;
  if (ct === "video/mp2t" || ct === "video/iso.segment" || ct === "audio/aac") return null;

  if (/\.m3u8$/.test(path) || /mpegurl/.test(ct)) return "HLS";
  if (/\.mpd$/.test(path) || ct === "application/dash+xml") return "DASH";
  if (/\.(mp4|webm|m4v|mov|mkv)$/.test(path) || /^video\//.test(ct)) return "Video";
  if (/\.(mp3|m4a|ogg|opus|wav|flac)$/.test(path) || /^audio\//.test(ct)) return "Audio";
  return null;
}
