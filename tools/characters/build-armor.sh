#!/bin/sh
# builds public/characters/armor.glb and its baked atlas (armor_normal.webp,
# armor_orm.webp): the mpfb2 body and all four armor sets share one uv atlas,
# so they build and bake in a single blender run (needs the MPFB2 extension,
# so no --factory-startup).
#   sh tools/characters/build-armor.sh [atlas px]    (default 4096)
set -e
cd "$(dirname "$0")/../.."
OUT=.blender-tmp/characters
mkdir -p "$OUT"
ATLAS=${1:-4096}
BLENDER=${BLENDER:-blender}
if ! "$BLENDER" -b --python-exit-code 1 -P tools/blender/characters/build_characters.py -- \
  --sets strafe,anvil,vector,quill,edge --atlas "$ATLAS" --out "$OUT/armor_raw.glb" > "$OUT/log_armor.txt" 2>&1; then
  tail -30 "$OUT/log_armor.txt"
  echo "blender build failed, see $OUT/log_armor.txt"
  exit 1
fi
grep -h "lod0 library\|\[atlas\] wrote" "$OUT/log_armor.txt" || true
npx tsx tools/characters/optimize-armor.ts public/characters/armor.glb "$OUT/armor_raw.glb"
cwebp -quiet -q 92 -m 6 "$OUT/armor_normal.png" -o public/characters/armor_normal.webp
cwebp -quiet -q 90 -m 6 -resize 2048 2048 "$OUT/armor_orm.png" -o public/characters/armor_orm.webp  # ao, roughness detail and wear are soft: half size is plenty
ls -la public/characters/armor.glb public/characters/armor_normal.webp public/characters/armor_orm.webp
