#!/bin/bash
# dsh-doctor · 点一下修复。（macOS 双击运行）
DIR="$(cd "$(dirname "$0")" && pwd)"

if command -v node >/dev/null 2>&1; then
  NODE=node
elif [ -x "$DIR/node" ]; then
  NODE="$DIR/node"
else
  echo
  echo "需要 Node.js（>=18）。装好后再双击我，或手动执行："
  echo "  node \"$DIR/dsh-doctor.mjs\""
  echo
  read -n 1 -s -r -p '按任意键关闭…'
  exit 1
fi

"$NODE" "$DIR/dsh-doctor.mjs" "$@"
echo
read -n 1 -s -r -p '按任意键关闭…'
