#!/usr/bin/env bash
# Puts the card data (scripts/card-data.ts's output) in the R2 bucket the site reads it from:
#   scripts/upload-card-data.sh [dir]    (default card-data)
# Each upload is a whole new copy under v/<version>/. Once every file is confirmed there, at its size,
# `current` is pointed at it, so the site never reads half of one day and half of another
# (app/lib/carddata.server.ts). Every other copy is then deleted, after a wait long enough for a Worker still on
# the old one (it checks `current` once a minute) to move over. A copy that doesn't check out is deleted instead
# and the site stays on the one it has.
# Needs the AWS CLI (R2 speaks S3) and an R2 API token with read and write access to the bucket:
#   R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and CLOUDFLARE_ACCOUNT_ID
set -euo pipefail

dir="${1:-card-data}"
bucket="${CARD_DATA_BUCKET:-impulsecaster-cards-data}"
# seconds: the Workers' VERSION_TTL (a minute), and time for a request already on the old copy to finish
grace="${CARD_DATA_GRACE:-120}"

[ -f "$dir/sitemap.xml" ] || { echo "No card data in $dir: run npm run card-data first" >&2; exit 1; }

export AWS_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID:?R2_ACCESS_KEY_ID is not set}"
export AWS_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY:?R2_SECRET_ACCESS_KEY is not set}"
export AWS_ENDPOINT_URL="https://${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID is not set}.r2.cloudflarestorage.com"
export AWS_DEFAULT_REGION=auto

version=$(date -u +%Y%m%dT%H%M%SZ)
prefix="v/$version/"
# never into a copy that's there already (an upload the same second), since a failed one is deleted
if [ -n "$(aws s3 ls "s3://$bucket/$prefix" 2> /dev/null || true)" ]; then echo "Card data $version is already in the bucket" >&2; exit 1; fi
aws s3 cp "$dir" "s3://$bucket/$prefix" --recursive --only-show-errors

# every file, as "<size> <path>": what was built, and what the bucket has
want=$(cd "$dir" && find . -type f -printf '%s %P\n' | LC_ALL=C sort)
have=$({ aws s3 ls "s3://$bucket/$prefix" --recursive || true; } \
    | awk -v p="$prefix" '{ size = $3; key = substr($0, index($0, p) + length(p)); print size, key }' | LC_ALL=C sort)
if [ "$want" != "$have" ]; then
    echo "Card data $version didn't upload whole; the site stays on the copy it has. Differences (< built, > in the bucket):" >&2
    diff <(printf '%s\n' "$want") <(printf '%s\n' "$have") | grep '^[<>]' | head -20 >&2 || true
    aws s3 rm "s3://$bucket/$prefix" --recursive --only-show-errors
    exit 1
fi

printf %s "$version" | aws s3 cp - "s3://$bucket/current" --content-type text/plain
echo "Card data $version is live ($(printf '%s\n' "$want" | wc -l) files, all checked)"

# the copies before this one; a newer one (another upload) deletes this one itself once it's live
old=$(aws s3 ls "s3://$bucket/v/" | awk -v v="$version/" '$1 == "PRE" && $2 < v { print $2 }')
[ -n "$old" ] || exit 0
echo "Deleting the older card data in ${grace}s, once no Worker is still reading it"
sleep "$grace"
for v in $old; do
    aws s3 rm "s3://$bucket/v/$v" --recursive --only-show-errors
    echo "Removed card data ${v%/}"
done
