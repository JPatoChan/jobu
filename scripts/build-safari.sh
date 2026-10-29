#!/bin/sh
# Wraps Jobu as a Safari web extension for iPhone, iPad and Mac: writes an
# Xcode project to safari/ with Apple's converter. Needs a Mac with Xcode.
#
#   scripts/build-safari.sh [bundle id]      (default io.github.jpatochan.jobu)
#
# The project uses the files in extension/ where they are. Run this again
# after updating Jobu, so it has every file.
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
die() { printf '%s\n' "$*" >&2; exit 1; }

[ "$(uname)" = Darwin ] || die 'This needs a Mac with Xcode: Apple builds iPhone and iPad apps only there.'
xcrun --find safari-web-extension-converter >/dev/null 2>&1 || die 'Install Xcode from the App Store, open it once, then run this again.'

xcrun safari-web-extension-converter "$root/extension" \
  --project-location "$root/safari" \
  --app-name Jobu \
  --bundle-identifier "${1:-io.github.jpatochan.jobu}" \
  --swift --no-open --no-prompt --force

project=$(find "$root/safari" -maxdepth 3 -name '*.xcodeproj' | head -n 1)
echo "Made $project"
echo 'Open it in Xcode, choose your team under Signing & Capabilities for each target, then run the iOS app on your iPhone or iPad.'
