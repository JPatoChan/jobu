#!/bin/sh
# Connects Jobu to Claude Code on this computer, which turns on Jobu's only AI
# feature: rewrite options on the tailor page. Without it, Jobu shows nothing
# that uses Claude. macOS and Linux.
#
#   scripts/connect-claude.sh <extension id>   connect (again after moving Claude Code)
#   scripts/connect-claude.sh --remove         disconnect
#
# Jobu's profile page shows the first command with its id filled in. It finds
# claude on your PATH (or JOBU_CLAUDE), copies scripts/claude-host.sh next to
# Jobu's other files with that path, and registers it as the native messaging
# host com.jobu.claude with each Chromium browser you have. Set JOBU_HOSTS_DIR
# to register it in one folder instead, such as <user data dir>/NativeMessagingHosts
# for a browser started with --user-data-dir.
set -eu

NAME=com.jobu.claude
here=$(cd "$(dirname "$0")" && pwd)
die() { printf '%s\n' "$*" >&2; exit 1; }

if [ "$(uname)" = Darwin ]; then
  config="$HOME/Library/Application Support"
  home="$config/Jobu"
  browsers='Google/Chrome|Google/Chrome Beta|Google/Chrome Canary|Chromium|Microsoft Edge|BraveSoftware/Brave-Browser|Vivaldi'
else
  config=${XDG_CONFIG_HOME:-$HOME/.config}
  home=${XDG_DATA_HOME:-$HOME/.local/share}/jobu
  browsers='google-chrome|google-chrome-beta|google-chrome-unstable|chromium|microsoft-edge|BraveSoftware/Brave-Browser|vivaldi'
fi
host="$home/claude-host.sh"

# Prints the NativeMessagingHosts folder of each browser that's installed.
hosts_dirs() {
  if [ -n "${JOBU_HOSTS_DIR:-}" ]; then
    printf '%s\n' "$JOBU_HOSTS_DIR"
    return
  fi
  printf '%s\n' "$browsers" | tr '|' '\n' | while IFS= read -r b; do
    if [ -d "$config/$b" ]; then printf '%s\n' "$config/$b/NativeMessagingHosts"; fi
  done
}

# A shell word that's exactly $1, and a JSON string that's exactly $1.
quote() { printf "'%s'" "$(printf %s "$1" | sed "s/'/'\\\\''/g")"; }
json() { printf '"%s"' "$(printf %s "$1" | sed 's/\\/\\\\/g; s/"/\\"/g')"; }

if [ "${1:-}" = --remove ]; then
  hosts_dirs | while IFS= read -r dir; do
    if [ -f "$dir/$NAME.json" ]; then rm -f "$dir/$NAME.json" && echo "Unregistered from $dir"; fi
  done
  rm -rf "$home"
  echo 'Jobu is disconnected from Claude Code. Its AI features are off.'
  exit 0
fi

[ $# -gt 0 ] || die "Usage: $0 <extension id>    (Jobu's profile page shows the command with its id)
       $0 --remove"
origins=
for id in "$@"; do
  printf '%s\n' "$id" | grep -Eqx '[a-p]{32}' || die "\"$id\" isn't an extension id. Copy the command from Jobu's profile page, or the id from chrome://extensions."
  origins="$origins${origins:+,}\"chrome-extension://$id/\""
done

claude=${JOBU_CLAUDE:-$(command -v claude || true)}
[ -n "$claude" ] || die 'Claude Code isn’t installed, or isn’t on your PATH. Install it (https://code.claude.com/docs/en/setup), sign in by running claude once, then run this again.'
case $claude in /*) ;; *) claude="$(cd "$(dirname "$claude")" && pwd)/$(basename "$claude")" ;; esac
version=$("$claude" --version 2>/dev/null | head -n 1) || true
[ -n "$version" ] || die "$claude doesn't run. Check that Claude Code works in this terminal, then run this again."

dirs=$(hosts_dirs)
[ -n "$dirs" ] || die "Didn't find Chrome, Chromium, Edge, Brave or Vivaldi. Set JOBU_HOSTS_DIR to your browser's NativeMessagingHosts folder and run this again."

# The browser starts the host with a bare PATH, so keep this one: claude may
# be a Node script that needs node.
mkdir -p "$home"
{
  echo '#!/bin/sh'
  echo "# Written by Jobu's scripts/connect-claude.sh. Run that again if Claude Code moves."
  echo "JOBU_CLAUDE=$(quote "$claude")"
  echo "PATH=$(quote "$PATH")"
  echo 'export PATH'
  sed 1d "$here/claude-host.sh"
} >"$host.new"
chmod 755 "$host.new"
mv "$host.new" "$host"

printf '%s\n' "$dirs" | while IFS= read -r dir; do
  mkdir -p "$dir"
  cat >"$dir/$NAME.json" <<EOF
{
  "name": "$NAME",
  "description": "Connects Jobu to Claude Code",
  "path": $(json "$host"),
  "type": "stdio",
  "allowed_origins": [$origins]
}
EOF
  echo "Registered with $dir"
done

echo "Jobu is connected to $version at $claude."
echo "Reload the tailor page, or click \"Check again\" on Jobu's profile page."
