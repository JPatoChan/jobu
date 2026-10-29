#!/bin/sh
# Connects Jobu to Claude Code: a Chrome native messaging host (com.jobu.claude)
# that runs the claude CLI. scripts/connect-claude.sh copies it, with the path
# to claude, and registers it with the browser. Jobu's AI features stay off
# until it's there.
#
# Chrome starts it for each message and writes the message to stdin (its
# length in 4 bytes, native byte order, then JSON). It writes one reply back
# the same way:
#   {"type":"status"}                     -> {"type":"status","version":"2.1.0 (Claude Code)"}
#   {"type":"user","message":{...}}       -> Claude Code's result message
#   anything else, or a failure           -> {"type":"error","error":"...","detail":"..."}
#
# Claude runs with no tools and no MCP servers, in an empty folder, and the
# session isn't saved. A job description can ask it for anything, but all it
# can do is answer.
set -u
CLAUDE=${JOBU_CLAUDE:-claude}
SYSTEM='You help one person tailor their resume in Jobu, a browser extension. Follow the instructions in their message and answer with exactly what it asks for. You have no tools and cannot see their computer.'

# Exactly $1 bytes of stdin, one at a time so nothing past them is read.
take() { dd bs=1 count="$1" 2>/dev/null; }

# Writes one message: its length in bytes, little-endian (the byte order of
# every Mac and PC Chrome runs on), then the JSON.
reply() {
  n=$(printf %s "$1" | wc -c | tr -d ' ')
  printf "$(printf '\\%03o\\%03o\\%03o\\%03o' $((n & 255)) $((n >> 8 & 255)) $((n >> 16 & 255)) $((n >> 24 & 255)))"
  printf %s "$1"
}

# Text that's safe inside a JSON string: printable ASCII without quotes or
# backslashes, at most 300 characters.
plain() { LC_ALL=C tr -cd ' -~' | tr -d '"\\' | cut -c1-300; }

fail() {
  reply "{\"type\":\"error\",\"error\":\"$1\",\"detail\":\"$(printf %s "${2:-}" | plain)\"}"
  exit 0
}

len=$(take 4 | od -An -tu4 | tr -d ' \n')
case $len in '' | *[!0-9]*) exit 0 ;; esac
msg=$(take "$len")

nl='
'
case $msg in *"$nl"*) fail bad-message ;; esac

case $msg in
  '{"type":"status"}')
    version=$("$CLAUDE" --version 2>/dev/null | head -n 1 | plain)
    [ -n "$version" ] || fail no-claude "$CLAUDE"
    reply "{\"type\":\"status\",\"version\":\"$version\"}"
    ;;
  '{"type":"user","message":{"role":"user","content":'*)
    work=$(mktemp -d) || fail no-result 'Could not make a temporary folder'
    trap 'rm -rf "$work"' EXIT
    cd "$work" || fail no-result 'Could not open a temporary folder'
    # The result is the last line whose own type is result; its keys come in
    # any order, and quotes inside strings are escaped, so this can't match
    # Claude's text.
    result=$(printf '%s\n' "$msg" |
      "$CLAUDE" -p --input-format stream-json --output-format stream-json --verbose \
        --tools '' --strict-mcp-config --no-session-persistence --system-prompt "$SYSTEM" 2>"$work/err" |
      grep '"type":"result"' | tail -n 1)
    [ -n "$result" ] || fail no-result "$(tail -n 1 "$work/err")"
    reply "$result"
    ;;
  *) fail bad-message ;;
esac
