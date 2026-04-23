# Video Extraction Runbook

This runbook covers extracting a social video locally, verifying whether audio is actually present, and saving companion title/description notes.

Scripted version:

```bash
scripts/extract-video.sh "<video-url>" [output-dir] [base-name]
```

## Why this exists

Some sources, including TikTok, may advertise a muxed format as if it contains audio even when the downloaded file ends up video-only. The extraction process must verify the saved artifact, not trust format metadata alone.

## Recommended process

1. Inspect available formats before downloading.

```bash
yt-dlp -F "<video-url>"
```

Or use the script, which performs inspection, download, verification, and notes-file creation in one pass.

2. Download a preferred format to a deterministic filename.

Start with the best quality candidate, but prefer a fallback if you know a specific codec family is more reliable for the source.

```bash
yt-dlp -f "<format-id>" -o "/path/to/output.%(ext)s" "<video-url>"
```

3. Verify the saved file with `ffprobe`.

Do not assume audio is present just because `yt-dlp -F` reported an audio codec.

```bash
ffprobe -v error \
  -show_entries stream=index,codec_type,codec_name,width,height,channels,sample_rate \
  -of default=noprint_wrappers=1 \
  "/path/to/output.mp4"
```

4. If the downloaded file is video-only, retry with a different format ID.

For the TikTok case observed on 2026-04-22:

- `bytevc1_720p_715903-*` produced a video-only file after download
- `h264_540p_774149-*` produced a file with verified AAC audio

5. Validate playback of the audio stream directly.

```bash
ffmpeg -v error -i "/path/to/output.mp4" -t 10 -vn -f null -
```

If this exits cleanly, the audio stream is readable.

6. Save a companion notes file with:

- suggested title
- suggested description
- source URL
- any caveats about how the description was derived

## Title and description workflow

Use this decision order:

1. Extract page metadata.
2. If metadata is low-quality, generic, or hashtag-only, inspect the media itself.
3. If a verified audio stream exists, transcribe a short sample before writing the final description.
4. If there is no usable audio, sample frames and derive the description from on-screen text and visible themes.
5. Record whether the description came from spoken audio, captions, or visual inspection.

## TikTok-specific notes

- Always run `yt-dlp -F` first.
- Prefer explicit `-f <format-id>` selection over implicit best-format selection when reliability matters.
- Treat `ACODEC` in the format table as a hint, not proof.
- Use `ffprobe` on the saved file as the source of truth.

## Example session

```bash
yt-dlp -F "https://www.tiktok.com/@the.unconscious.gu/video/7537796826834029879"

yt-dlp -f h264_540p_774149-0 \
  -o "/home/dp/Desktop/Carl Jung - Empath Aura and Shadow Work [%(id)s] - with-audio.%(ext)s" \
  "https://www.tiktok.com/@the.unconscious.gu/video/7537796826834029879"

ffprobe -v error \
  -show_entries stream=index,codec_type,codec_name,width,height,channels,sample_rate \
  -of default=noprint_wrappers=1 \
  "/home/dp/Desktop/Carl Jung - Empath Aura and Shadow Work [7537796826834029879] - with-audio.mp4"
```

Expected verification:

- one `audio` stream, `aac`, `44100`, `2` channels
- one `video` stream, `h264`, `576x1024`
