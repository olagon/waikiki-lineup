#!/bin/sh
# Run a TypeScript tool script under Node by bundling it first. usage: tests/run.sh <file.mts> [args]
f=$1; shift
mkdir -p .look
out=".look/_tool_$$.mjs"
node_modules/.bin/esbuild "$f" --bundle --platform=node --format=esm --log-level=warning --outfile="$out" && node "$out" "$@"
code=$?
rm -f "$out"
exit $code
