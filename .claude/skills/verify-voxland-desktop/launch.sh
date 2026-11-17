#!/bin/bash
# Builds the dev bundle and starts it on the host desktop with an isolated profile and a CDP port.
# The profile is copied from ~/.config/vesktop on first launch so Discord is already logged in.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
repo=${VOXLAND_REPO:-$(git -C "$here" rev-parse --show-toplevel)}
state=${VOXLAND_VERIFY_DIR:-$HOME/.cache/voxland-verify}
port=${VOXLAND_CDP_PORT:-9447}

# shellcheck source=pid.sh
source "$here/pid.sh"
if pid=$(running_pid); then
    echo "already running: pid $pid" >&2
    exit 1
fi
if ss -ltn | grep -q ":$port "; then
    echo "port $port is taken; set VOXLAND_CDP_PORT" >&2
    exit 1
fi

# Hyprland only renders windows on a monitor, so the dev window goes to a headless one far from the real screens
move_to_headless_output() {
    [[ -n ${HYPRLAND_INSTANCE_SIGNATURE:-} ]] || return 0
    if ! hyprctl monitors -j | jq -e '.[] | select(.name == "voxverify")' >/dev/null; then
        hyprctl output create headless voxverify >/dev/null
        hyprctl eval 'hl.monitor({ output = "voxverify", mode = "1280x1100@60", position = "20000x20000", scale = 1 })' >/dev/null 2>&1 ||
            hyprctl keyword monitor voxverify,1280x1100@60,20000x20000,1 >/dev/null
    fi
    local workspace pids address
    workspace=$(hyprctl monitors -j | jq -r '.[] | select(.name == "voxverify") | .activeWorkspace.name')
    pids=$(pgrep -P "$1" | paste -sd,)
    [[ -n $pids ]] || return 0
    for address in $(hyprctl clients -j | jq -r --argjson p "[$pids]" '.[] | select(.pid as $x | $p | index($x)) | .address'); do
        hyprctl eval "hl.dispatch(hl.dsp.window.move({ workspace = '$workspace', follow = false, window = 'address:$address' }))" >/dev/null 2>&1 ||
            hyprctl dispatch movetoworkspacesilent "$workspace,address:$address" >/dev/null
    done
}

mkdir -p -m 700 "$state/config" "$state/evidence"
if [[ ! -d $state/config/vesktop ]]; then
    rm -rf "$state/config/vesktop.partial"
    cp -r ~/.config/vesktop "$state/config/vesktop.partial"
    rm -f "$state/config/vesktop.partial/sessionData/"Singleton*
    mv "$state/config/vesktop.partial" "$state/config/vesktop"
fi

(cd "$repo" && pnpm build:dev >/dev/null)
cd "$repo"
XDG_CONFIG_HOME=$state/config setsid env -u VENCORD_USER_DATA_DIR node_modules/.bin/electron --remote-debugging-port="$port" "$@" . >"$state/app.log" 2>&1 &
echo $! >"$state/pid"

pid=$(cat "$state/pid")
# the main window is shown only once Discord has loaded and the splash page is gone
for _ in $(seq 60); do
    kill -0 "$pid" 2>/dev/null || break
    if curl -s "localhost:$port/json" | jq -e '[.[] | select(.type == "page") | .url] |
        any(test("^https://([a-z]+\\.)?discord\\.com/")) and (any(test("splash\\.html")) | not)' >/dev/null; then
        move_to_headless_output "$pid"
        echo "ready: pid $pid, cdp $port, log $state/app.log"
        exit 0
    fi
    sleep 1
done
echo "discord page never loaded; stopping it. Log tail ($state/app.log):" >&2
tail -n 20 "$state/app.log" >&2
"$here/stop.sh"
exit 1
