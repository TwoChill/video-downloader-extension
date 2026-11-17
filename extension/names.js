// Geplakte tekst -> veilige bestandsnaam (zonder extensie): geen pad, geen verboden tekens op Windows.
function schoonNaam(tekst) {
  let naam = String(tekst || "").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "").trim().replace(/^[. ]+|[. ]+$/g, "");
  naam = naam.slice(0, 150).replace(/^[. ]+|[. ]+$/g, "");
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(naam)) naam += "_";
  return naam;
}

function extUitUrl(url, standaard) {
  const m = new URL(url).pathname.toLowerCase().match(/\.(mp4|webm|m4v|mov|mkv|mp3|m4a|ogg|opus|wav|flac)$/);
  return m ? m[1] : standaard;
}
