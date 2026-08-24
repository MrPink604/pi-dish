#!/usr/bin/env bash
set -euo pipefail

root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
env_file=${PI_DISH_ENV_FILE:-"$HOME/.config/pi-dish/env"}

if [[ -f $env_file ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$env_file"
  set +a
fi

if [[ -z ${HOST:-} ]]; then
  if ! command -v tailscale >/dev/null 2>&1; then
    echo "run-tailnet.sh: set HOST or install tailscale" >&2
    exit 127
  fi
  HOST=$(tailscale ip -4)
  HOST=${HOST%%$'\n'*}
fi

if [[ -z $HOST ]]; then
  echo "run-tailnet.sh: tailscale did not report an IPv4 address" >&2
  exit 1
fi

PORT=${PORT:-3333}
PI_DISH_TERMINAL=${PI_DISH_TERMINAL:-1}
PATH="$HOME/.local/bin:$PATH"
export HOST PORT PI_DISH_TERMINAL PATH

printf 'pi-dish -> http://%s:%s (terminal %s)\n' \
  "$HOST" "$PORT" "$([[ $PI_DISH_TERMINAL == 1 ]] && printf enabled || printf disabled)"
if [[ -n ${PI_DISH_SHARE_PORT:-} ]]; then
  printf 'shares  -> http://%s:%s (public routes only)\n' \
    "${PI_DISH_SHARE_HOST:-$HOST}" "$PI_DISH_SHARE_PORT"
fi

cd -- "$root"
exec node server.js
