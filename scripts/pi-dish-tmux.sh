#!/usr/bin/env bash
set -euo pipefail

root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
runner="$root/scripts/supervise-tailnet.sh"
session=${PI_DISH_TMUX_SESSION:-pi-dish}
window=${PI_DISH_TMUX_WINDOW:-server}
env_file=${PI_DISH_ENV_FILE:-"$HOME/.config/pi-dish/env"}
legacy_root=${PI_DISH_LEGACY_ROOT:-}
# Always manage the default tmux server. Callers inside another tmux server
# otherwise inherit its socket through TMUX and inspect or mutate the wrong one.
unset TMUX

target="=$session:=$window"

require_tmux() {
  if ! command -v tmux >/dev/null 2>&1; then
    echo "pi-dish-tmux.sh: tmux is required" >&2
    exit 127
  fi
}

managed_window_exists() {
  tmux has-session -t "$target" 2>/dev/null
}

server_pids() {
  local proc_dir cwd
  local -a argv

  for proc_dir in /proc/[0-9]*; do
    cwd=$(readlink -- "$proc_dir/cwd" 2>/dev/null) || continue
    [[ $cwd == "$root" || (-n $legacy_root && $cwd == "$legacy_root") ]] || continue
    argv=()
    mapfile -d '' -t argv < "$proc_dir/cmdline" 2>/dev/null || true
    ((${#argv[@]} >= 2)) || continue
    [[ ${argv[0]##*/} == node ]] || continue
    [[ ${argv[1]} == server.js || ${argv[1]} == "$cwd/server.js" ]] || continue
    printf '%s\n' "${proc_dir##*/}"
  done
}

stop_server_processes() {
  local pid alive
  local -a pids=()

  mapfile -t pids < <(server_pids)
  ((${#pids[@]})) || return 0

  kill -TERM "${pids[@]}" 2>/dev/null || true
  for _ in {1..50}; do
    alive=0
    for pid in "${pids[@]}"; do
      if kill -0 "$pid" 2>/dev/null; then
        alive=1
        break
      fi
    done
    ((alive)) || return 0
    sleep 0.1
  done
  kill -KILL "${pids[@]}" 2>/dev/null || true
}

stop_service() {
  if managed_window_exists; then
    tmux kill-window -t "$target"
  fi
  stop_server_processes
}

load_endpoint() {
  if [[ -f $env_file ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$env_file"
    set +a
  fi

  if [[ -z ${HOST:-} ]]; then
    HOST=$(tailscale ip -4)
    HOST=${HOST%%$'\n'*}
  fi
  PORT=${PORT:-3333}
}

healthy() {
  load_endpoint
  curl --fail --silent --max-time 2 "http://$HOST:$PORT/api/host" >/dev/null
}

wait_until_healthy() {
  for _ in {1..100}; do
    if healthy; then
      printf 'pi-dish is healthy at http://%s:%s in tmux %s:%s\n' \
        "$HOST" "$PORT" "$session" "$window"
      return 0
    fi
    sleep 0.1
  done

  echo "pi-dish-tmux.sh: server did not become healthy" >&2
  tmux capture-pane -p -t "$target" -S -80 >&2 2>/dev/null || true
  return 1
}

start_service() {
  if managed_window_exists && healthy; then
    printf 'pi-dish is already healthy at http://%s:%s in tmux %s:%s\n' \
      "$HOST" "$PORT" "$session" "$window"
    return 0
  fi

  stop_service
  if tmux has-session -t "=$session" 2>/dev/null; then
    tmux new-window -d -t "=$session:" -n "$window" -c "$root" \
      -e "PI_DISH_ENV_FILE=$env_file" "$runner"
  else
    tmux new-session -d -s "$session" -n "$window" -c "$root" \
      -e "PI_DISH_ENV_FILE=$env_file" "$runner"
  fi
  wait_until_healthy
}

require_tmux
case ${1:-} in
  start)
    start_service
    ;;
  restart)
    stop_service
    start_service
    ;;
  stop)
    stop_service
    ;;
  status)
    if managed_window_exists && healthy; then
      printf 'pi-dish is healthy at http://%s:%s in tmux %s:%s\n' \
        "$HOST" "$PORT" "$session" "$window"
    else
      echo "pi-dish is not healthy in tmux $session:$window" >&2
      exit 1
    fi
    ;;
  *)
    echo "Usage: scripts/pi-dish-tmux.sh {start|restart|stop|status}" >&2
    exit 2
    ;;
esac
