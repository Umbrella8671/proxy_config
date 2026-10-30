# ~/.config/zsh/functions.zsh
# For Zsh inside a Linux container. Requires curl, jq and mihomo.
# Mihomo paths may be overridden with MIHOMO_HOME.

# -----------------------------------------------------------------------------
# Helpers restricted to Mihomo processes owned by this user and whose current
# working directory is MIHOMO_HOME. Do not kill unrelated processes by name.
# Linux /proc is available in the user's cluster container.
# -----------------------------------------------------------------------------
_mih_proc_alive() {
  emulate -L zsh
  local candidate_pid="$1" proc_state
  [[ "$candidate_pid" =~ ^[0-9]+$ ]] || return 1
  (( candidate_pid > 1 )) || return 1
  kill -0 "$candidate_pid" 2>/dev/null || return 1
  proc_state="$(ps -p "$candidate_pid" -o stat= 2>/dev/null)" || return 1
  [[ "$proc_state" != Z* && -n "$proc_state" ]]
}

_mih_any_live_process() {
  emulate -L zsh
  local candidate_pid
  (( $+commands[pgrep] )) || return 2
  for candidate_pid in ${(f)"$(pgrep -u "$EUID" -x mihomo 2>/dev/null)"}; do
    _mih_proc_alive "$candidate_pid" && return 0
  done
  return 1
}

_mih_pid_is_ours() {
  emulate -L zsh
  local candidate_pid="$1" expected_dir="$2" proc_name proc_dir
  [[ "$candidate_pid" =~ ^[0-9]+$ ]] || return 1
  (( candidate_pid > 1 )) || return 1
  _mih_proc_alive "$candidate_pid" || return 1
  [[ -r "/proc/$candidate_pid/comm" ]] || return 1
  proc_name="$(<"/proc/$candidate_pid/comm")"
  [[ "$proc_name" == mihomo ]] || return 1
  proc_dir="$(readlink -f -- "/proc/$candidate_pid/cwd" 2>/dev/null)" || return 1
  [[ "$proc_dir" == "$expected_dir" ]]
}

_mih_find_pid() {
  emulate -L zsh
  local expected_dir="$1" candidate_pid found_pid=''
  (( $+commands[pgrep] )) || return 2
  for candidate_pid in ${(f)"$(pgrep -u "$EUID" -x mihomo 2>/dev/null)"}; do
    if _mih_pid_is_ours "$candidate_pid" "$expected_dir"; then
      if [[ -n "$found_pid" ]]; then
        print -u2 'mih: multiple matching Mihomo processes; refusing to choose a PID'
        return 3
      fi
      found_pid="$candidate_pid"
    fi
  done
  [[ -n "$found_pid" ]] || return 1
  print -r -- "$found_pid"
}

# -----------------------------------------------------------------------------
# mih — manage Mihomo in this container through its Unix API socket.
# config.yaml must set: external-controller-unix: ./run/mihomo.sock
# -----------------------------------------------------------------------------
mih() {
  emulate -L zsh
  setopt localoptions pipefail

  local mih_dir="${MIHOMO_HOME:-$HOME/.local/opt/mihomo}"
  local mih_run="$mih_dir/run"
  local mih_sock="$mih_run/mihomo.sock"
  local mih_pidfile="$mih_run/mihomo.pid"
  local mih_log="$mih_run/mihomo.log"
  local mih_base='http://localhost'
  local mih_real_dir mih_pid candidate_pid group encoded response current_mode version method api_path ready i
  local -a mih_api
  mih_api=(curl -fsS --noproxy '*' --connect-timeout 2 --max-time 20 --unix-socket "$mih_sock" -H 'Accept: application/json')

  case "${1:-status}" in
    start)
      if ! (( $+commands[mihomo] )); then
        print -u2 'mih: mihomo executable not found in PATH'
        return 1
      fi
      if ! (( $+commands[curl] && $+commands[pgrep] && $+commands[readlink] )); then
        print -u2 'mih: requires curl, pgrep and readlink'
        return 1
      fi
      [[ -f "$mih_dir/config.yaml" ]] || {
        print -u2 "mih: config file missing: $mih_dir/config.yaml"
        return 1
      }
      mih_real_dir="$(readlink -f -- "$mih_dir")" || return 1

      # A working API takes precedence over PID-file state. Optionally adopt a
      # manually started instance from the same directory.
      if "${mih_api[@]}" --max-time 2 "$mih_base/version" >/dev/null 2>&1; then
        if [[ ! -r "$mih_pidfile" ]]; then
          candidate_pid="$(_mih_find_pid "$mih_real_dir")"
          if [[ -n "$candidate_pid" && -d "$mih_run" && ! -L "$mih_run" ]]; then
            print -r -- "$candidate_pid" >| "$mih_pidfile" 2>/dev/null || true
          fi
        fi
        print 'mihomo already running'
        return 0
      fi

      # A running process with an unavailable socket is NOT a stale socket.
      # Never remove its socket or start another instance.
      if candidate_pid="$(_mih_find_pid "$mih_real_dir")"; then
        print -u2 "mih: Mihomo PID $candidate_pid is running, but its Unix API is unavailable"
        print -u2 'mih: check config.yaml external-controller-unix and mih logs'
        return 1
      fi
      if [[ -L "$mih_run" ]]; then
        print -u2 "mih: refusing symlinked run directory: $mih_run"
        return 1
      fi
      mkdir -p -m 700 -- "$mih_run" || return 1
      chmod 700 -- "$mih_run" || return 1

      if [[ -r "$mih_pidfile" ]]; then
        mih_pid="$(<"$mih_pidfile")"
        if _mih_proc_alive "$mih_pid"; then
          print -u2 "mih: PID file points to a running process ($mih_pid); not overwriting it"
          return 1
        fi
        rm -f -- "$mih_pidfile" || return 1
      elif [[ -e "$mih_pidfile" || -L "$mih_pidfile" ]]; then
        print -u2 "mih: unexpected PID file; inspect: $mih_pidfile"
        return 1
      fi

      if [[ -L "$mih_sock" ]]; then
        print -u2 "mih: refusing symlinked socket: $mih_sock"
        return 1
      fi
      if [[ -S "$mih_sock" ]]; then
        # If ANY Mihomo owned by this user is running, conservatively refuse
        # stale-socket cleanup (the process might be starting or restarting).
        if _mih_any_live_process; then
          print -u2 'mih: socket not responding, but a Mihomo process is running'
          print -u2 "mih: not removing $mih_sock; inspect: pgrep -af mihomo"
          return 1
        fi
        rm -f -- "$mih_sock" || return 1
      elif [[ -e "$mih_sock" ]]; then
        print -u2 "mih: socket path occupied by a non-socket: $mih_sock"
        return 1
      fi

      # Create and check log BEFORE starting the background process. This
      # avoids the old Zsh redirection failure that left no PID file.
      if [[ -L "$mih_log" ]]; then
        print -u2 "mih: refusing symlinked log file: $mih_log"
        return 1
      fi
      touch -- "$mih_log" || return 1
      chmod 600 -- "$mih_log" || return 1

      # Test the config before launching anything.
      command mihomo -t -d "$mih_dir" || return 1

      # Redirect all stdio; nohup allows it to survive the shell session.
      # We use the absolute -d path but start in the same dir so /proc/PID/cwd
      # can be safely used later to recognize the service.
      (
        cd "$mih_dir" || exit 1
        umask 077
        nohup mihomo -d "$mih_dir" >> "$mih_log" 2>&1 </dev/null &
        print -r -- "$!" >| "$mih_pidfile"
      ) || return 1

      ready=0
      for (( i=0; i<60; i++ )); do
        if "${mih_api[@]}" --max-time 2 "$mih_base/version" >/dev/null 2>&1; then
          ready=1
          break
        fi
        sleep 0.2
      done
      if (( ready )); then
        print "mihomo started (dir: $mih_dir)"
      else
        print -u2 "mih: startup did not reach the Unix API; inspect $mih_log"
        [[ -r "$mih_log" ]] && tail -n 30 -- "$mih_log" >&2
        return 1
      fi
      ;;

    stop)
      mih_real_dir="$(readlink -f -- "$mih_dir")" || return 1
      mih_pid=''
      if [[ -r "$mih_pidfile" ]]; then
        candidate_pid="$(<"$mih_pidfile")"
        if _mih_pid_is_ours "$candidate_pid" "$mih_real_dir"; then
          mih_pid="$candidate_pid"
        elif _mih_proc_alive "$candidate_pid"; then
          print -u2 "mih: PID file points to a different running process ($candidate_pid); refusing to kill it"
          return 1
        else
          rm -f -- "$mih_pidfile" || return 1
        fi
      fi
      if [[ -z "$mih_pid" ]]; then
        # Permit stopping a manually launched `mihomo -d .` instance if its
        # process cwd uniquely matches this config directory.
        mih_pid="$(_mih_find_pid "$mih_real_dir")"
      fi
      if [[ -z "$mih_pid" ]]; then
        if "${mih_api[@]}" --max-time 2 "$mih_base/version" >/dev/null 2>&1; then
          print -u2 'mih: API is running, but cannot identify its process safely; refusing to kill it'
          return 1
        fi
        print 'mihomo already stopped'
        return 0
      fi
      if ! _mih_pid_is_ours "$mih_pid" "$mih_real_dir"; then
        print -u2 "mih: PID $mih_pid is no longer the expected Mihomo process; refusing"
        return 1
      fi
      kill -TERM "$mih_pid" || return 1
      for (( i=0; i<60; i++ )); do
        if ! _mih_pid_is_ours "$mih_pid" "$mih_real_dir"; then
          break
        fi
        # Docker can show a terminated process as a zombie until reaped.
        [[ "$(ps -p "$mih_pid" -o stat= 2>/dev/null)" == Z* ]] && break
        sleep 0.2
      done
      if _mih_pid_is_ours "$mih_pid" "$mih_real_dir" &&
         [[ "$(ps -p "$mih_pid" -o stat= 2>/dev/null)" != Z* ]]; then
        print -u2 "mih: PID $mih_pid did not exit after SIGTERM; no forced kill performed"
        return 1
      fi
      [[ -f "$mih_pidfile" ]] && rm -f -- "$mih_pidfile"
      print 'mihomo stopped'
      ;;

    restart)
      mih stop || return 1
      mih start
      ;;

    status)
      response="$("${mih_api[@]}" --max-time 3 "$mih_base/version" 2>/dev/null)" || {
        print -u2 'mihomo: offline (Unix API unavailable)'
        return 1
      }
      version="$(print -r -- "$response" | jq -r '.version // "unknown"')" || return 1
      current_mode="$("${mih_api[@]}" "$mih_base/configs" | jq -r '.mode // "unknown"')" || return 1
      print "mihomo: $version | mode: $current_mode"
      "${mih_api[@]}" "$mih_base/proxies" |
        jq -r '.proxies | to_entries[] | select(.value.type == "Selector") | "\(.key): \(.value.now // "?")"'
      ;;

    logs)
      if [[ -r "$mih_log" ]]; then
        tail -n 60 -- "$mih_log"
      elif [[ -r "$mih_dir/mihomo.log" ]]; then
        tail -n 60 -- "$mih_dir/mihomo.log"
      else
        print -u2 'mih: no log file yet; start Mihomo first'
        return 1
      fi
      ;;

    mode)
      if [[ -z "${2:-}" ]]; then
        "${mih_api[@]}" "$mih_base/configs" | jq -r '.mode'
      else
        case "$2" in
          rule|global|direct) ;;
          *) print -u2 'usage: mih mode [rule|global|direct]'; return 2 ;;
        esac
        "${mih_api[@]}" -X PATCH -H 'Content-Type: application/json' \
          -d "$(jq -nc --arg mode "$2" '{mode: $mode}')" "$mih_base/configs" || return 1
        print "mode -> $2"
      fi
      ;;

    ps)
      "${mih_api[@]}" "$mih_base/proxies" |
        jq -r '.proxies | to_entries[] | select(.value.type == "Selector" or .value.type == "URLTest" or .value.type == "Fallback" or .value.type == "LoadBalance") | "\(.key) [\(.value.type)]"'
      ;;

    ls)
      group="${2:-GLOBAL}"
      encoded="$(jq -nr --arg x "$group" '$x|@uri')" || return 1
      "${mih_api[@]}" "$mih_base/proxies/$encoded" | jq -r '.all[]?' | nl -ba
      ;;

    sel)
      group="${2:-GLOBAL}"
      encoded="$(jq -nr --arg x "$group" '$x|@uri')" || return 1
      response="$("${mih_api[@]}" "$mih_base/proxies/$encoded" 2>/dev/null)" || {
        print -u2 "mih: group '$group' not found (use: mih ps)"
        return 1
      }
      if [[ -z "${3:-}" ]]; then
        print -r -- "$response" | jq -r '"current: \(.now // "not selectable")"'
      else
        "${mih_api[@]}" -X PUT -H 'Content-Type: application/json' \
          -d "$(jq -nc --arg name "$3" '{name: $name}')" \
          "$mih_base/proxies/$encoded" || return 1
        print "$group -> $3"
      fi
      ;;

    test)
      group="${2:-GLOBAL}"
      encoded="$(jq -nr --arg x "$group" '$x|@uri')" || return 1
      "${mih_api[@]}" "$mih_base/group/$encoded/delay?timeout=5000&url=https%3A%2F%2Fwww.gstatic.com%2Fgenerate_204" |
        jq -r 'if type == "object" then to_entries[] | "\(.key): \(.value)ms" else . end'
      ;;

    conns)
      "${mih_api[@]}" "$mih_base/connections" | jq -r '
        "total: \(.connectionCount // 0)",
        (.connections[]? | "\(.metadata.type // "?") \(.metadata.host // .metadata.destinationIP // "?"):\(.metadata.destinationPort // "?") -> \(.chains[-1] // "?")")'
      ;;

    kill)
      "${mih_api[@]}" -X DELETE "$mih_base/connections" || return 1
      print 'all connections closed'
      ;;

    ui)
      "${mih_api[@]}" --max-time 120 -X POST "$mih_base/upgrade/ui" || return 1
      print 'WebUI update requested; open /ui/ after the download completes'
      ;;

    api)
      shift
      method=''
      case "${1:-}" in
        GET|get) method=GET; shift ;;
        POST|post) method=POST; shift ;;
        PUT|put) method=PUT; shift ;;
        PATCH|patch) method=PATCH; shift ;;
        DELETE|delete) method=DELETE; shift ;;
      esac
      api_path="${1:-/configs}"
      if [[ "$api_path" != /* ]]; then
        print -u2 "mih: API path must start with / (got: $api_path)"
        return 2
      fi
      (( $# > 0 )) && shift
      if (( $# > 0 )); then
        [[ -n "$method" ]] || method=PATCH
        "${mih_api[@]}" -X "$method" -H 'Content-Type: application/json' \
          -d "$1" "$mih_base$api_path"
      else
        "${mih_api[@]}" -X "${method:-GET}" "$mih_base$api_path"
      fi
      ;;

    -h|--help|help)
      cat <<'HELP'
usage: mih [start|stop|restart|status|logs|mode|ps|ls|sel|test|conns|kill|ui|api]
  mih start / stop / restart       manage the Mihomo process in this container
  mih logs                         show last 60 log lines
  mih mode [rule|global|direct]    get or set proxy mode
  mih ps                           list proxy groups
  mih ls [group]                   list nodes in a group
  mih sel [group] [node]           get or set selection
  mih test [group]                 group latency test
  mih conns / mih kill             inspect or close connections
  mih ui                           update MetaCubeXD
  mih api [path] [json]            GET / PATCH
  mih api METHOD path [json]       GET / POST / PUT / PATCH / DELETE
HELP
      ;;

    *)
      print -u2 "mih: unknown command '${1:-}' (try: mih help)"
      return 2
      ;;
  esac
}

# -----------------------------------------------------------------------------
# proxy — toggle HTTP/HTTPS proxy for the CURRENT shell only (port 7890).
# -----------------------------------------------------------------------------
proxy() {
  emulate -L zsh
  local mih_proxy='http://127.0.0.1:7890'
  local mih_bypass='localhost,127.0.0.1,::1'

  case "${1:-show}" in
    on)
      export http_proxy="$mih_proxy" https_proxy="$mih_proxy" all_proxy="$mih_proxy"
      export HTTP_PROXY="$mih_proxy" HTTPS_PROXY="$mih_proxy" ALL_PROXY="$mih_proxy"
      export no_proxy="$mih_bypass" NO_PROXY="$mih_bypass"
      print "proxy ON ($mih_proxy)"
      ;;
    off)
      unset http_proxy https_proxy all_proxy no_proxy
      unset HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY
      print 'proxy OFF'
      ;;
    test)
      curl -fsS --noproxy '' -x "$mih_proxy" -o /dev/null \
        -w 'proxy connect: code=%{http_code} time=%{time_total}s\n' \
        https://www.gstatic.com/generate_204
      ;;
    show)
      if [[ -n "${https_proxy:-}" ]]; then
        print "proxy is ON: $https_proxy"
      else
        print 'proxy is OFF (use: proxy on)'
      fi
      ;;
    *)
      print -u2 'usage: proxy [on|off|show|test]'
      return 2
      ;;
  esac
}
