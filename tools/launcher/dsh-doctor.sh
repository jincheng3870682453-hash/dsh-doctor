#!/bin/sh
# dsh-doctor · 点一下修复。（Linux / 任意 POSIX 系统）
DIR=$(cd "$(dirname "$0")" && pwd)

if command -v node >/dev/null 2>&1; then
  NODE=node
elif [ -x "$DIR/node" ]; then
  NODE="$DIR/node"
else
  printf '\n需要 Node.js（>=18）。如果 DSH 里能跑终端，也可以用它的 node：\n  node %s\n\n' "$DIR/dsh-doctor.mjs"
  exit 1
fi

exec "$NODE" "$DIR/dsh-doctor.mjs" "$@"
