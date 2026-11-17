#!/bin/bash
# Stops the instance launch.sh started. Keeps $state/evidence; pass --purge to also delete the copied profile.
state=$(realpath -m "${VOXLAND_VERIFY_DIR:-$HOME/.cache/voxland-verify}")
# shellcheck source=pid.sh
source "$(dirname "$0")/pid.sh"
if pid=$(running_pid); then
    kill -- -"$pid" 2>/dev/null || kill "$pid"
    for _ in $(seq 50); do kill -0 "$pid" 2>/dev/null || break; sleep 0.1; done
    kill -KILL -- -"$pid" 2>/dev/null
    sleep 0.2
    if kill -0 "$pid" 2>/dev/null; then
        echo "pid $pid survived SIGKILL; leaving $state in place" >&2
        exit 1
    fi
fi
rm -f "$state/pid"
# the output is shared by every instance, so it goes only when no window is left on it
if [[ -n ${HYPRLAND_INSTANCE_SIGNATURE:-} ]] && monitor=$(hyprctl monitors -j | jq -e '.[] | select(.name == "voxverify") | .id'); then
    hyprctl clients -j | jq -e --argjson m "$monitor" 'any(.[]; .monitor == $m)' >/dev/null || hyprctl output remove voxverify >/dev/null
fi
if [[ ${1:-} == --purge ]]; then
    rm -rf "$state/config" "$state/app.log"
fi
