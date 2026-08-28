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
  # 3 = run-tailnet.sh found another pi-dish already serving this endpoint.
  # Restarting cannot resolve that; retrying forever is how one stale
  # supervisor turns into thousands of EADDRINUSE crashes.
  if ((status == 3)); then
    printf 'pi-dish: another instance owns the endpoint; supervisor exiting\n' >&2
    exit 3
  fi
  printf 'pi-dish exited with status %d; restarting in %ss\n' "$status" "$delay" >&2
  sleep "$delay"
done
