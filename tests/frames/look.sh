#!/bin/sh
# Capture shots and tile them into .look/sheet.png for quick review. usage: tests/frames/look.sh <milestone> <ids...>
m=$1; shift
node tests/frames/capture.mjs "$m" "$@" 2>&1 | grep -v PCFSoft | tail -15
mkdir -p .look
files=""; for id in "$@"; do files="$files docs/frames/$m/$id-1440x900.png"; done
montage $files -tile 2x -geometry 760x475+2+2 -background '#111' .look/sheet.jpg 2>/dev/null; true
