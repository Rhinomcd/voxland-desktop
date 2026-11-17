# Sourced by launch.sh and stop.sh. A pid counts only if its environment carries this instance's XDG_CONFIG_HOME,
# so a stale pid file never matches a recycled pid or the installed Vesktop.
running_pid() {
    local pid
    pid=$(cat "$state/pid" 2>/dev/null) || return 1
    tr '\0' '\n' 2>/dev/null <"/proc/$pid/environ" | grep -qxF "XDG_CONFIG_HOME=$state/config" && echo "$pid"
}
