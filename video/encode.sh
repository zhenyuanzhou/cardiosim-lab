#!/usr/bin/env bash
# Assemble recorded frames into the final 1920×1080, 30 fps H.264 MP4 (no audio track: captions are burned in).
set -euo pipefail
FR="$1"; OUT="$2"
LIST="$FR/list.txt"; : > "$LIST"
for s in s1 s2 s3 s4 s5 s6 s7; do
  ffmpeg -y -loglevel error -framerate 30 -i "$FR/$s/f%05d.jpg" -c:v libx264 -preset slow -crf 19 -pix_fmt yuv420p -r 30 -vf "scale=1920:1080" "$FR/$s.mp4"
  echo "file '$s.mp4'" >> "$LIST"
done
ffmpeg -y -loglevel error -f concat -safe 0 -i "$LIST" -c copy -movflags +faststart "$OUT"
ffprobe -v error -show_entries format=duration:stream=width,height,r_frame_rate,codec_name -of default=nw=1 "$OUT"
