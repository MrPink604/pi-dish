#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: ./install.sh [--links-only]

Install pi-dish dependencies and link its bridges and skills into the default
Pi and OMP agent directories. Set PI_AGENT_DIR or OMP_AGENT_DIR to override
either destination (useful for isolated installs).

  --links-only  Skip npm ci and only reconcile bridge and skill links
EOF
}

install_dependencies=1
while (($#)); do
  case "$1" in
    --links-only)
      install_dependencies=0
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "install.sh: unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
pi_agent_dir=${PI_AGENT_DIR:-"$HOME/.pi/agent"}
omp_agent_dir=${OMP_AGENT_DIR:-"$HOME/.omp/agent"}

link_path() {
  local source=$1
  local destination=$2

  mkdir -p -- "$(dirname -- "$destination")"
  if [[ -e $destination && ! -L $destination ]]; then
    echo "install.sh: refusing to replace non-symlink: $destination" >&2
    return 1
  fi

  if [[ -L $destination && $(readlink -- "$destination") == "$source" ]]; then
    printf 'linked %s -> %s\n' "$destination" "$source"
    return
  fi

  ln -sfn -- "$source" "$destination"
  printf 'linked %s -> %s\n' "$destination" "$source"
}

if ((install_dependencies)); then
  if ! command -v npm >/dev/null 2>&1; then
    echo "install.sh: npm is required to install dependencies" >&2
    exit 127
  fi
  echo "Installing npm dependencies..."
  (cd -- "$root" && npm ci --no-audit --no-fund)
fi

link_path "$root/extensions/pi-dish-bridge" \
  "$pi_agent_dir/extensions/pi-dish-bridge"
link_path "$root/extensions/pi-dish-bridge-omp" \
  "$omp_agent_dir/extensions/pi-dish-bridge-omp"

for skill in "$root"/skills/*; do
  [[ -d $skill ]] || continue
  name=${skill##*/}
  link_path "$skill" "$pi_agent_dir/skills/$name"
  link_path "$skill" "$omp_agent_dir/skills/$name"
done

echo "pi-dish installation complete. Reload running agents to load updated bridges."
