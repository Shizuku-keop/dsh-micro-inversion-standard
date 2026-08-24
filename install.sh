#!/bin/sh
# Install the micro-inversion-standard agent preset into the DSH user preset root.
# Usage: sh ./install.sh [DSH_HOME]
#   DSH_HOME   Override the DSH home directory (default: $HOME/.dsh)

set -eu

DSH_HOME="${1:-$HOME/.dsh}"
SRC="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/preset"
DST="$DSH_HOME/.agent-presets/micro-inversion-standard"

if [ ! -d "$SRC" ]; then
  echo "error: preset folder not found next to this script: $SRC" >&2
  exit 1
fi

# v5: transactional install — copy into a staging dir first, then swap, so
# an interrupted copy never leaves a half-installed preset behind.
STAGE="$DST.tmp"
rm -rf "$STAGE"
mkdir -p "$STAGE"
cp -R "$SRC/." "$STAGE/"
if [ -d "$DST" ] || [ -e "$DST" ]; then
  echo "Overwriting existing preset at: $DST"
  rm -rf "$DST"
fi
mv "$STAGE" "$DST"

echo
echo "Installed: $DST"
echo "Next: restart the dsh web service, create a new session,"
echo "and pick \"Micro-Inversion Standard\" from the preset selector."
