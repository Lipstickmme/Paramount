#!/usr/bin/env bash
# Refresh the self-hosted webfonts in public/assets/fonts/.
#
# All three faces are variable fonts, so Google serves one file per unicode
# subset and slices it with unicode-range rather than shipping a file per
# weight. We keep the latin and latin-ext files and hand-write the @font-face
# rules in fonts.css with the full weight range, which is why this script only
# fetches the binaries.
#
# Run it only when a face is replaced; the output is committed.
set -euo pipefail
cd "$(dirname "$0")/.."
UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
API='https://fonts.googleapis.com/css2?family=Archivo:wght@400..700&family=Public+Sans:wght@400..700&family=Roboto+Mono:wght@400..700&display=swap'

tmp=$(mktemp)
curl -fsS -A "$UA" "$API" -o "$tmp"

pick() { # family-slug  subset  outfile
  awk -v want="/* $2 */" 'index($0, want) { grab = 1 } grab' "$tmp" \
    | grep -m1 -A20 "font-family: '$1'" \
    | grep -m1 -o 'https://[^)]*\.woff2' || true
}

for spec in "Archivo:archivo" "Public Sans:public-sans" "Roboto Mono:roboto-mono"; do
  fam="${spec%%:*}"; slug="${spec##*:}"
  for sub in latin latin-ext; do
    url=$(python3 - "$tmp" "$fam" "$sub" <<'PY'
import re, sys
css, fam, sub = open(sys.argv[1]).read(), sys.argv[2], sys.argv[3]
for s, block in re.findall(r'/\* (\S+) \*/\n(@font-face \{.*?\n\})', css, re.S):
    if s == sub and f"font-family: '{fam}'" in block:
        print(re.search(r'url\((https://[^)]+)\)', block).group(1)); break
PY
)
    out="public/assets/fonts/${slug}$([ "$sub" = latin-ext ] && echo -ext).woff2"
    [ -n "$url" ] && curl -fsS -o "$out" "$url" && echo "  $out"
  done
done
rm -f "$tmp"
echo 'fonts refreshed — fonts.css is hand-written, check its weight ranges still match.'
