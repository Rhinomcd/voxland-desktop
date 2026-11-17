#!/bin/bash
# Stops the instance launch.sh started. Keeps $state/evidence; pass --purge to also delete the copied profile.
state=${VOXLAND_VERIFY_DIR:-$HOME/.cache/voxland-verify}
if [[ -e $state/pid ]]; then
    pid=$(cat "$state/pid")
    if grep -qa electron "/proc/$pid/cmdline" 2>/dev/null; then
        kill -- -"$pid" 2>/dev/null || kill "$pid"
        for _ in $(seq 50); do kill -0 "$pid" 2>/dev/null || break; sleep 0.1; done
    fi
    rm -f "$state/pid"
fi
if [[ -n ${HYPRLAND_INSTANCE_SIGNATURE:-} ]] && hyprctl monitors -j | jq -e '.[] | select(.name == "voxverify")' >/dev/null; then
    hyprctl output remove voxverify >/dev/null
fi
if [[ ${1:-} == --purge ]]; then
    rm -rf "$state/config" "$state/app.log"
fi
