#!/bin/sh
# builds public/characters/armor.glb: the undersuit and every armor set in
# parallel blender processes, then merges and optimizes them.
#   sh tools/characters/build-armor.sh [set ...]    (default: all sets)
set -e
cd "$(dirname "$0")/../.."
OUT=.blender-tmp/characters
mkdir -p "$OUT"
SETS=${*:-"strafe anvil vector quill"}
BLENDER=${BLENDER:-blender}
pids=""
"$BLENDER" -b --factory-startup --python-exit-code 1 -P tools/blender/characters/build_characters.py -- \
  --sets none --out "$OUT/part_body.glb" > "$OUT/log_body.txt" 2>&1 &
pids="$pids $!"
for s in $SETS; do
  "$BLENDER" -b --factory-startup --python-exit-code 1 -P tools/blender/characters/build_characters.py -- \
    --sets "$s" --no-body --out "$OUT/part_$s.glb" > "$OUT/log_$s.txt" 2>&1 &
  pids="$pids $!"
done
fail=0
for p in $pids; do wait "$p" || fail=1; done
if [ "$fail" != 0 ]; then
  echo "a blender build failed, see $OUT/log_*.txt"
  exit 1
fi
grep -h "lod0 library" "$OUT"/log_*.txt || true
inputs="$OUT/part_body.glb"
for s in strafe anvil vector quill; do
  [ -f "$OUT/part_$s.glb" ] && inputs="$inputs $OUT/part_$s.glb"
done
npx tsx tools/characters/optimize-armor.ts public/characters/armor.glb $inputs
