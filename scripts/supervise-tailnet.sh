#!/usr/bin/env bash
set -uo pipefail

root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
delay=${PI_DISH_RESTART_DELAY:-3}

while true; do
  "$root/scripts/run-tailnet.sh"
  status=$?
  if ((status == 0)); then
    exit 0
  fi
  printf 'pi-dish exited with status %d; restarting in %ss\n' "$status" "$delay" >&2
  sleep "$delay"
done
