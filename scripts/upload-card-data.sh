#!/usr/bin/env bash
# Puts the card data (scripts/card-data.ts's output) in the R2 bucket the site reads it from:
#   scripts/upload-card-data.sh [dir]    (default card-data)
# Each upload is a whole new copy under v/<version>/, and `current` is pointed at it only once every file is
# there, so the site never reads half of one day and half of another (app/lib/carddata.server.ts). The three
# newest copies are kept, so a Worker still on the one before (it checks once a minute) can finish.
# Needs the AWS CLI (R2 speaks S3) and an R2 API token with read and write access to the bucket:
#   R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and CLOUDFLARE_ACCOUNT_ID
set -euo pipefail

dir="${1:-card-data}"
bucket="${CARD_DATA_BUCKET:-impulsecaster-card-data}"
keep=3

[ -f "$dir/sitemap.xml" ] || { echo "No card data in $dir: run npm run card-data first" >&2; exit 1; }

export AWS_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID:?R2_ACCESS_KEY_ID is not set}"
export AWS_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY:?R2_SECRET_ACCESS_KEY is not set}"
export AWS_ENDPOINT_URL="https://${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID is not set}.r2.cloudflarestorage.com"
export AWS_DEFAULT_REGION=auto

version=$(date -u +%Y%m%dT%H%M%SZ)
aws s3 cp "$dir" "s3://$bucket/v/$version/" --recursive --only-show-errors
printf %s "$version" | aws s3 cp - "s3://$bucket/current" --content-type text/plain
echo "Card data $version is live ($(find "$dir" -type f | wc -l) files)"

# the versions sort by date, oldest first
aws s3 ls "s3://$bucket/v/" | awk '$1 == "PRE" { print $2 }' | sort | head -n "-$keep" | while read -r old; do
    aws s3 rm "s3://$bucket/v/$old" --recursive --only-show-errors
    echo "Removed card data ${old%/}"
done
