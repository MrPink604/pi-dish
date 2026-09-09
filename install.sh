#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: ./install.sh [--links-only]

Install pi-dish dependencies and link its bridges and skills into the default
Pi, OMP, and Prime agent directories. Set PI_AGENT_DIR, OMP_AGENT_DIR, or
PRIME_AGENT_DIR to override a destination (useful for isolated installs).

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
prime_agent_dir=${PRIME_AGENT_DIR:-"$HOME/.prime/agent"}

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
# Prime discovery-loads extensions from ~/.prime/agent/extensions. Prime
# resolves extension imports from the symlink path without realpath, so the
# wrapper's ../pi-dish-bridge/core.js import additionally needs the shared
# core linked as a sibling; the stock Pi bridge it exposes stands down under
# a prime host (foreignWrapperHost in the bridge core). Managed pi-dish
# launches still pass a generated token wrapper: if the discovery link has
# already loaded a tokenless copy into the worker, the wrapper adopts into it
# through the bridge's load sentinel rather than loading a duplicate bridge.
link_path "$root/extensions/pi-dish-bridge-prime" \
  "$prime_agent_dir/extensions/pi-dish-bridge-prime"
link_path "$root/extensions/pi-dish-bridge" \
  "$prime_agent_dir/extensions/pi-dish-bridge"

for skill in "$root"/skills/*; do
  [[ -d $skill ]] || continue
  # skills/lib is the shared CLI core the skill scripts require via realpath,
  # not a skill — linking it would plant a SKILL.md-less dir in the registry.
  [[ -f $skill/SKILL.md ]] || continue
  name=${skill##*/}
  link_path "$skill" "$pi_agent_dir/skills/$name"
  link_path "$skill" "$omp_agent_dir/skills/$name"
done

# Prime's only built-in tool (ipython) runs through a Python kernel whose
# first-use bootstrap needs uv; without it every tool call in a fresh prime
# session fails with a setup error. Ensure uv exists when the prime CLI
# pi-dish will launch is actually installed, so first-run sessions can
# execute tools.
prime_cli=${PI_DISH_PRIME_COMMAND-}
prime_cli=${prime_cli%% *}
[[ -n $prime_cli ]] || prime_cli=prime-agent
if command -v "$prime_cli" >/dev/null 2>&1 && ! command -v uv >/dev/null 2>&1; then
  echo "prime-agent found without uv (required by its Python kernel) — installing uv..."
  if curl -LsSf https://astral.sh/uv/install.sh | sh; then
    echo "uv installed to ~/.local/bin (prime bootstraps its kernel on first tool use)."
  else
    echo "install.sh: uv install failed; prime sessions will fail tool calls until it is present." >&2
    echo "  Install it yourself: curl -LsSf https://astral.sh/uv/install.sh | sh" >&2
  fi
fi

echo "pi-dish installation complete. Reload running agents to load updated bridges."
