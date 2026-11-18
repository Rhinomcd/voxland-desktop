#!/bin/bash
# Builds the dev bundle and starts it on the host desktop with an isolated profile and a CDP port.
# The profile is copied from ~/.config/vesktop on first launch so Discord is already logged in.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
repo=${VOXLAND_REPO:-$(git -C "$here" rev-parse --show-toplevel)}
state=$(realpath -m "${VOXLAND_VERIFY_DIR:-$HOME/.cache/voxland-verify}")
export VOXLAND_VERIFY_DIR=$state
port=${VOXLAND_CDP_PORT:-9447}

# shellcheck source=pid.sh
source "$here/pid.sh"
if pid=$(running_pid); then
    echo "already running: pid $pid" >&2
    exit 1
fi
if [[ -n $(ss -ltnH "sport = :$port") ]]; then
    echo "port $port is taken; set VOXLAND_CDP_PORT" >&2
    exit 1
fi

# Hyprland with a Lua config takes `eval`; older versions answer "unknown request" with exit 0 and need the legacy commands
hypr_eval() {
    local out
    out=$(hyprctl eval "$1" 2>&1) && [[ $out != *"unknown request"* ]]
}

# Hyprland only renders windows on a monitor, so the dev window goes to a headless one far from the real screens
move_to_headless_output() {
    [[ -n ${HYPRLAND_INSTANCE_SIGNATURE:-} ]] || return 0
    if ! hyprctl monitors -j | jq -e '.[] | select(.name == "voxverify")' >/dev/null; then
        hyprctl output create headless voxverify >/dev/null
        hypr_eval 'hl.monitor({ output = "voxverify", mode = "1280x1100@60", position = "20000x20000", scale = 1 })' ||
            hyprctl keyword monitor voxverify,1280x1100@60,20000x20000,1 >/dev/null
    fi
    if ! hyprctl monitors -j | jq -e '.[] | select(.name == "voxverify") | .x == 20000' >/dev/null; then
        echo "could not place the voxverify output at 20000,20000" >&2
        return 1
    fi
    local monitor workspace pids clients address
    monitor=$(hyprctl monitors -j | jq -e '.[] | select(.name == "voxverify") | .id')
    workspace=$(hyprctl monitors -j | jq -er '.[] | select(.name == "voxverify") | .activeWorkspace.name')
    # the main window maps a moment after the splash closes, so retry until it exists and sits on the output
    for _ in $(seq 50); do
        pids=$(pgrep -P "$1" | paste -sd,) || true
        clients=$(hyprctl clients -j | jq -c --argjson p "[${pids}]" '[.[] | select(.pid as $x | $p | index($x))]')
        if jq -e --argjson m "$monitor" 'length > 0 and all(.[]; .monitor == $m)' <<<"$clients" >/dev/null; then
            return 0
        fi
        for address in $(jq -r --argjson m "$monitor" '.[] | select(.monitor != $m) | .address' <<<"$clients"); do
            hypr_eval "hl.dispatch(hl.dsp.window.move({ workspace = '$workspace', follow = false, window = 'address:$address' }))" ||
                hyprctl dispatch movetoworkspacesilent "$workspace,address:$address" >/dev/null
        done
        sleep 0.2
    done
    echo "the app window never reached the voxverify output" >&2
    return 1
}

mkdir -p -m 700 "$state/config" "$state/evidence"
if [[ ! -d $state/config/vesktop ]]; then
    [[ -d ~/.config/vesktop ]] || { echo "no ~/.config/vesktop to copy; log in once with an installed Vesktop" >&2; exit 1; }
    rm -rf "$state/config/vesktop.partial"
    cp -r ~/.config/vesktop "$state/config/vesktop.partial"
    rm -f "$state/config/vesktop.partial/sessionData/"Singleton*
    mv "$state/config/vesktop.partial" "$state/config/vesktop"
fi

[[ -d $repo/node_modules ]] || (cd "$repo" && vp install --frozen-lockfile >/dev/null)
(cd "$repo" && vp run build:dev >/dev/null)
cd "$repo"
XDG_CONFIG_HOME=$state/config setsid env -u VENCORD_USER_DATA_DIR node_modules/.bin/electron --remote-debugging-port="$port" "$@" . >"$state/app.log" 2>&1 &
echo $! >"$state/pid"
trap 'echo "launch failed; stopping it. Log tail ($state/app.log):" >&2; tail -n 20 "$state/app.log" >&2; "$here/stop.sh"' EXIT

pid=$(cat "$state/pid")
# the main window is shown only once Discord has loaded and the splash page is gone
for _ in $(seq 60); do
    kill -0 "$pid" 2>/dev/null || break
    if curl -s "localhost:$port/json" | jq -e '[.[] | select(.type == "page") | .url] |
        any(test("^https://([a-z]+\\.)?discord\\.com/")) and (any(test("splash\\.html")) | not)' >/dev/null; then
        move_to_headless_output "$pid"
        trap - EXIT
        echo "ready: pid $pid, cdp $port, log $state/app.log"
        exit 0
    fi
    sleep 1
done
if kill -0 "$pid" 2>/dev/null; then echo "discord page never loaded" >&2; else echo "the app exited before discord loaded" >&2; fi
exit 1
