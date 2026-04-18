#!/usr/bin/env bash
set -euo pipefail

have() {
  command -v "$1" >/dev/null 2>&1
}

read_file() {
  local path="$1"
  if [[ -r "$path" ]]; then
    tr -d '\000' <"$path"
  fi
}

say() {
  printf '%s\n' "$*"
}

os_name=""
os_version=""
if [[ -r /etc/os-release ]]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  os_name="${NAME:-}"
  os_version="${VERSION_ID:-${VERSION:-}}"
fi

vendor="$(read_file /sys/class/dmi/id/sys_vendor || true)"
model="$(read_file /sys/class/dmi/id/product_name || true)"
firmware="$(read_file /sys/class/dmi/id/bios_version || true)"

say "== System =="
say "OS: ${os_name:-unknown} ${os_version:-}"
say "Kernel: $(uname -r)"
say "Architecture: $(uname -m)"
say "Vendor: ${vendor:-unknown}"
say "Model: ${model:-unknown}"
say "Firmware: ${firmware:-unknown}"

say
say "== GPU / Display Controllers =="
if have lspci; then
  lspci | grep -Ei 'vga|3d|display'
else
  say "lspci not available"
fi

say
say "== DRM Connectors =="
connector_count=0
if compgen -G '/sys/class/drm/card*-*/status' >/dev/null; then
  for status_path in /sys/class/drm/card*-*/status; do
    connector_count=$((connector_count + 1))
    connector_name="$(basename "$(dirname "$status_path")")"
    status="$(read_file "$status_path" || true)"
    say "${connector_name}: ${status:-unknown}"
  done
else
  say "No DRM connector status entries found"
fi

say
say "== Active X Displays =="
if have xrandr && [[ -n "${DISPLAY:-}" ]]; then
  xrandr --query | sed -n '1,80p'
else
  say "xrandr not available or DISPLAY is unset"
fi

say
say "== USB-C / Type-C =="
if [[ -d /sys/class/typec ]] && [[ -n "$(ls -A /sys/class/typec 2>/dev/null)" ]]; then
  ls /sys/class/typec
else
  say "No USB-C Type-C controller exposed in /sys/class/typec"
fi

say
say "== Audit Summary =="
has_typec=0
if [[ -d /sys/class/typec ]] && [[ -n "$(ls -A /sys/class/typec 2>/dev/null)" ]]; then
  has_typec=1
fi

has_hdmi=0
if compgen -G '/sys/class/drm/card*-HDMI-*/status' >/dev/null; then
  has_hdmi=1
fi

external_connected=0
external_outputs=""
if have xrandr && [[ -n "${DISPLAY:-}" ]]; then
  while IFS= read -r line; do
    connector="${line%% connected*}"
    if [[ "$connector" != eDP* && "$connector" != LVDS* ]]; then
      external_connected=$((external_connected + 1))
      external_outputs+="${connector} "
    fi
  done < <(xrandr --query | grep ' connected' || true)
fi

say "External displays currently connected: ${external_connected}"
if [[ -n "$external_outputs" ]]; then
  say "Active external output names: ${external_outputs% }"
fi
if (( has_hdmi == 1 )); then
  say "HDMI-class outputs are exposed by the graphics stack."
fi
if (( has_typec == 0 )); then
  say "No USB-C / DisplayPort Alt Mode path was detected locally."
  say "If you need one more external monitor beyond the built-in HDMI path, plan on an active USB 3.x DisplayLink adapter or dock."
else
  say "USB-C is present; verify DisplayPort Alt Mode on the exact port before buying a passive USB-C video adapter."
fi
