#!/bin/bash
# Copy theme textures from public/ (tracked in git) to assets/ (Vite publicDir)
# Run after git clone or when textures change

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

SRC="$PROJECT_DIR/public/rts-textures"
DST="$PROJECT_DIR/assets/rts-textures"

if [ ! -d "$SRC" ]; then
  echo "❌ Source directory not found: $SRC"
  echo "   Run 'npm run textures:generate && npm run textures:deploy' first"
  exit 1
fi

echo "📋 Copying textures: $SRC → $DST"

for theme in "$SRC"/*/; do
  theme_name=$(basename "$theme")
  mkdir -p "$DST/$theme_name"
  cp "$theme"*.png "$DST/$theme_name/"
  echo "   ✅ $theme_name"
done

echo "✅ Done. Textures ready for Vite dev server."
