# Video Downloader Koppeling

Chrome / Brave / Edge-extensie die video-streams (`.m3u8`, `.mp4`, `.mp3`) in een tabblad ziet en ze zelfstandig opslaat. Je kiest map en bestandsnaam in het gewone Windows-venster. Geen app, geen server, geen Python.

## Installeren (Windows, 1 commando)

1. Open **PowerShell** (Startmenu, typ `powershell`) en plak:

   ```powershell
   irm https://raw.githubusercontent.com/TwoChill/video-downloader-extension/main/install.ps1 | iex
   ```

2. Het script downloadt de extensie naar `%LOCALAPPDATA%\VideoDownloaderExtension`, zet dat pad op je klembord en opent de extensiepagina van je browser.
3. Daar drie klikken: zet **Ontwikkelaarsmodus** aan, klik **Uitgepakt laden**, plak het pad (`Ctrl+V`) en kies de map.
4. Pin het icoon via de puzzelknop.

**Bijwerken:** hetzelfde commando opnieuw draaien en daarna op de herlaadknop bij de extensie drukken.

### Handmatig (andere besturingssystemen)

1. Download de repository als ZIP (**Code** > **Download ZIP**) en pak hem uit, of `git clone` hem.
2. Open `chrome://extensions` (Brave: `brave://extensions`), zet **Ontwikkelaarsmodus** aan.
3. **Uitgepakt laden** en kies de map `extension`. Verplaats of verwijder die map daarna niet.

## Gebruik

1. Open de pagina met de video en druk op play.
2. Klik op het extensie-icoon, dan **Download** bij de stream.
3. Op het icoon loopt een percentage. Daarna verschijnt het Windows-venster: kies de map, pas de bestandsnaam aan, opslaan.

## Beperkingen

- Geen DRM (SAMPLE-AES, Widevine) en geen livestreams.
- DASH (`.mpd`) wordt nog niet ondersteund.
- HLS wordt een fragmented MP4 (alleen H.264 + AAC). Bij meerdere kwaliteiten kiest hij de beste.
- Een aparte audiotrack wordt niet met de video samengevoegd.
- Het opslagvenster komt na het ophalen; de hele video zit dan in het geheugen.
- Streamlinks verlopen vaak: laat de video starten en download meteen.

## Licenties

`extension/lib/mux-mp4.min.js` is [mux.js](https://github.com/videojs/mux.js) (Apache-2.0), zie `extension/lib/mux.js-LICENSE.txt`.
