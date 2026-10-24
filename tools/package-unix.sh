#!/usr/bin/env bash
# 打包 Linux / macOS 发行包：dsh-doctor-unix.tar.gz
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
out="$root/dist/release"
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT

mkdir -p "$out" "$stage/plugin/lib"

sed "s#'../plugin/lib/index.js'#'./plugin/lib/index.mjs'#" "$root/tools/cli.mjs" > "$stage/dsh-doctor.mjs"
cp "$root/plugin/lib/index.js" "$stage/plugin/lib/index.mjs"
cp "$root/plugin/package.json" "$stage/plugin/package.json"
cp "$root/tools/launcher/dsh-doctor.sh" "$stage/dsh-doctor.sh"
cp "$root/tools/launcher/dsh-doctor.command" "$stage/dsh-doctor.command"

chmod +x "$stage/dsh-doctor.sh" "$stage/dsh-doctor.command"

tar -czf "$out/dsh-doctor-unix.tar.gz" -C "$stage" .
echo "built $out/dsh-doctor-unix.tar.gz"
tar -tzf "$out/dsh-doctor-unix.tar.gz"
