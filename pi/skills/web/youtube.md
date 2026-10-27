# YouTube videos

Read a video before summarizing it; the description and chapter titles are not the talk.
If a step below fails, say so first and ask, and never fill the gap with search results presented as the video's content.

## Setup (per machine)

- `yt-dlp` as a uv tool with the PO token plugin: `uv tool install --upgrade "yt-dlp[default,curl-cffi]" --with bgutil-ytdlp-pot-provider`.
  Leaving out `[default]` drops `yt-dlp-ejs`, and challenge solving fails.
- The plugin's token script (https://github.com/Brainicism/bgutil-ytdlp-pot-provider), checked out at the git tag matching the plugin version and built as its README describes (`server/` with pnpm and `tsc`).
- `~/.config/yt-dlp/config` sets `--js-runtimes node`; Node 22 or newer is required.
- A warning about `127.0.0.1:4416` is expected when no token server runs: yt-dlp falls back to the script.
- The `canvas` build is optional: without it the script logs `HTMLCanvasElement's getContext() ... not implemented` and still returns a token.

## Transcript

```bash
yt-dlp --skip-download --write-auto-subs --sub-langs en-orig --sub-format vtt -o /tmp/<id> <url>
```

- Use the `<lang>-orig` track: plain `en` is YouTube's machine translation and answers HTTP 429.
- `--list-subs` shows the tracks; prefer manual subtitles (`--write-subs`) when they exist.
- The VTT repeats rolling caption lines; strip tags and consecutive duplicates before reading.

## Video, audio and slides

```bash
yt-dlp -f "bv*[height<=720]+ba/b[height<=720]" -o "/tmp/<id>.%(ext)s" <url>
ffmpeg -i /tmp/<id>.webm -vf "fps=1/15,scale=640:-1,tile=4x4" /tmp/<id>-sheet_%02d.png
```

- Contact sheets (one frame every 15 s, 16 per image) cover a talk's slides in a few image reads; grab a full frame at a timestamp with `-ss <sec> -frames:v 1` to read small print such as a slide's source line.
- Slides carry the references a speaker does not say aloud: check them before naming a paper as cited.
- Videos without captions: transcribe the audio track with a local speech-to-text model (Whisper large-v3-turbo runs at several times realtime on a CPU) and say in the reply that the transcript is machine-made.
