#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  scripts/extract-video.sh <video-url> [output-dir] [base-name]

Examples:
  scripts/extract-video.sh "https://www.tiktok.com/@user/video/123"
  scripts/extract-video.sh "https://www.tiktok.com/@user/video/123" "$HOME/Desktop"
  scripts/extract-video.sh "https://www.tiktok.com/@user/video/123" "$HOME/Desktop" "Custom Title"

Behavior:
  - inspects formats with yt-dlp
  - tries a reliable audio-capable download path
  - verifies the saved file with ffprobe
  - writes a companion notes template next to the video

Requirements:
  - yt-dlp
  - ffprobe
EOF
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

infer_id_from_url() {
  local url="$1"
  local inferred=''

  inferred="$(printf '%s\n' "$url" | sed -nE 's#.*tiktok\.com/@[^/]+/video/([0-9]+).*#\1#p' | head -n 1)"
  if [[ -n "$inferred" ]]; then
    printf '%s\n' "$inferred"
    return 0
  fi

  inferred="$(printf '%s\n' "$url" | sed -nE 's#.*[?&]v=([^&]+).*#\1#p' | head -n 1)"
  if [[ -n "$inferred" ]]; then
    printf '%s\n' "$inferred"
    return 0
  fi

  return 1
}

find_downloaded_file() {
  local output_dir="$1"
  local base_name="$2"
  local id="$3"
  local candidate

  shopt -s nullglob
  for candidate in \
    "$output_dir/$base_name [$id].mp4" \
    "$output_dir/$base_name [$id].webm" \
    "$output_dir/$base_name [$id].mkv" \
    "$output_dir/$base_name [$id].mov"; do
    if [[ -f "$candidate" ]]; then
      printf '%s\n' "$candidate"
      shopt -u nullglob
      return 0
    fi
  done
  shopt -u nullglob

  return 1
}

sanitize_name() {
  printf '%s' "$1" | sed 's#[/:]# - #g; s/[<>\"|?*]//g; s/[[:space:]]\+/ /g; s/^ //; s/ $//'
}

has_audio() {
  local file="$1"
  ffprobe -v error -select_streams a -show_entries stream=codec_type -of csv=p=0 "$file" | grep -q '^audio$'
}

pick_best_known_tiktok_format() {
  local formats="$1"

  if printf '%s\n' "$formats" | grep -q '^h264_540p_774149-0'; then
    printf '%s\n' 'h264_540p_774149-0'
    return 0
  fi

  if printf '%s\n' "$formats" | grep -q '^h264_540p_774149-1'; then
    printf '%s\n' 'h264_540p_774149-1'
    return 0
  fi

  if printf '%s\n' "$formats" | grep -q '^h264_540p_240165-0'; then
    printf '%s\n' 'h264_540p_240165-0'
    return 0
  fi

  if printf '%s\n' "$formats" | grep -q '^h264_540p_240165-1'; then
    printf '%s\n' 'h264_540p_240165-1'
    return 0
  fi

  return 1
}

write_notes() {
  local notes_path="$1"
  local source_url="$2"
  local derived_from="$3"

  cat >"$notes_path" <<EOF
Suggested title:

Suggested description:

Source:
$source_url

Notes:
- Description should be derived from: $derived_from
- Verify whether the final file has an audio stream before assuming transcription is possible.
EOF
}

main() {
  if [[ $# -lt 1 ]] || [[ "${1:-}" == "--help" ]] || [[ "${1:-}" == "-h" ]]; then
    usage
    exit 0
  fi

  require_cmd yt-dlp
  require_cmd ffprobe
  require_cmd python3

  local url="$1"
  local output_dir="${2:-$HOME/Desktop}"
  local requested_name="${3:-}"

  mkdir -p "$output_dir"

  echo "Fetching metadata..."
  local metadata=''
  if ! metadata="$(yt-dlp --dump-single-json --no-warnings "$url" 2>/dev/null)"; then
    echo "Metadata fetch failed; continuing with format inspection and download fallback." >&2
    metadata=''
  fi

  local id=''
  local title=''
  local description=''

  if [[ -n "$metadata" ]]; then
    id="$(printf '%s' "$metadata" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')"
    title="$(printf '%s' "$metadata" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("title") or "")')"
    description="$(printf '%s' "$metadata" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("description") or "")')"
  fi

  if [[ -z "$id" ]]; then
    id="$(infer_id_from_url "$url" || true)"
  fi

  local base_name
  if [[ -n "$requested_name" ]]; then
    base_name="$(sanitize_name "$requested_name")"
  elif [[ -n "$title" && "$title" != "$description" ]]; then
    base_name="$(sanitize_name "$title")"
  elif [[ -n "$title" ]]; then
    base_name="$(sanitize_name "$title")"
  else
    base_name="video-${id:-download}"
  fi

  echo "Inspecting formats..."
  local format_output
  format_output="$(yt-dlp -F "$url")"
  printf '%s\n' "$format_output"

  local selected_format=''
  if [[ "$url" == *'tiktok.com/'* ]]; then
    selected_format="$(pick_best_known_tiktok_format "$format_output" || true)"
  fi

  if [[ -z "$selected_format" ]]; then
    selected_format="best"
  fi

  local output_template
  if [[ -n "$id" ]]; then
    output_template="$output_dir/$base_name [$id].%(ext)s"
  else
    output_template="$output_dir/$base_name [%(id)s].%(ext)s"
  fi
  echo "Downloading format: $selected_format"
  yt-dlp -f "$selected_format" -o "$output_template" "$url"

  local downloaded_file
  if [[ -n "$id" ]]; then
    downloaded_file="$(find_downloaded_file "$output_dir" "$base_name" "$id" || true)"
  else
    downloaded_file=''
  fi

  if [[ -z "$downloaded_file" ]]; then
    downloaded_file="$(find "$output_dir" -maxdepth 1 -type f \
      \( -name "$base_name [*].mp4" -o -name "$base_name [*].webm" -o -name "$base_name [*].mkv" -o -name "$base_name [*].mov" \) \
      -print | head -n 1)"
  fi

  if [[ -z "$downloaded_file" ]]; then
    echo "Download completed but output file could not be located." >&2
    exit 1
  fi

  if ! has_audio "$downloaded_file"; then
    echo "Downloaded file is video-only after verification: $downloaded_file"

    if [[ "$url" == *'tiktok.com/'* ]]; then
      local retry_format=''
      retry_format="$(pick_best_known_tiktok_format "$format_output" || true)"

      if [[ -n "$retry_format" && "$retry_format" != "$selected_format" ]]; then
        echo "Retrying TikTok download with verified fallback format: $retry_format"
        yt-dlp -f "$retry_format" -o "$output_template" "$url"
        downloaded_file="$(find_downloaded_file "$output_dir" "$base_name" "$id" || true)"
      fi
    fi
  fi

  echo "Verifying saved file..."
  ffprobe -v error \
    -show_entries stream=index,codec_type,codec_name,width,height,channels,sample_rate \
    -of default=noprint_wrappers=1 \
    "$downloaded_file"

  local notes_path="${downloaded_file%.*} - notes.txt"
  local derivation_hint='metadata first; if metadata is weak, inspect audio or frames manually'
  write_notes "$notes_path" "$url" "$derivation_hint"

  echo
  echo "Saved video:"
  echo "  $downloaded_file"
  echo "Saved notes template:"
  echo "  $notes_path"

  if has_audio "$downloaded_file"; then
    echo "Audio verification: PASS"
  else
    echo "Audio verification: FAIL"
    exit 1
  fi
}

main "$@"
