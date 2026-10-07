#!/bin/sh
# builds the whole-body skins: public/characters/skins/<id>.glb plus its atlas
# (<id>_color, _normal, _data, _mask .webp). the sources are cc-by sketchfab
# models downloaded outside the repo (tools/assets/sketchfab-fetch.mjs, see
# docs/assets/characters.md).
#   sh tools/characters/build-skins.sh [ids]    (default: every skin)
set -e
cd "$(dirname "$0")/../.."
OUT=.blender-tmp/characters/skins
DEST=public/characters/skins
mkdir -p "$OUT" "$DEST"
BLENDER=${BLENDER:-blender}
IDS=${1:-ronin,sentinel}
if ! "$BLENDER" -b --factory-startup --python-exit-code 1 -P tools/blender/characters/build_skins.py -- \
  --skins "$IDS" ${RENDERS:+--renders "$RENDERS"} > "$OUT/log.txt" 2>&1; then
  tail -30 "$OUT/log.txt"
  echo "blender build failed, see $OUT/log.txt"
  exit 1
fi
grep -h "\[characters" "$OUT/log.txt" || true
for id in $(echo "$IDS" | tr ',' ' '); do
  python3 tools/characters/skin_textures.py "$id"
  npx tsx tools/characters/optimize-armor.ts "$DEST/$id.glb" "$OUT/${id}_raw.glb"
  # the first-person arms, on the fp rig (tools/blender/arms) and the same atlas
  npx tsx tools/characters/optimize-armor.ts "$DEST/${id}_arms.glb" "$OUT/${id}_arms_raw.glb"
  cwebp -quiet -q 88 -m 6 "$OUT/${id}_color.png" -o "$DEST/${id}_color.webp"
  cwebp -quiet -q 90 -m 6 "$OUT/${id}_normal.png" -o "$DEST/${id}_normal.webp"
  # glow, roughness and metalness are soft, half size is plenty
  cwebp -quiet -q 90 -m 6 -resize 1024 1024 "$OUT/${id}_data.png" -o "$DEST/${id}_data.webp"
  cwebp -quiet -q 92 -m 6 -resize 1024 1024 "$OUT/${id}_mask.png" -o "$DEST/${id}_mask.webp"
done
ls -la "$DEST"
