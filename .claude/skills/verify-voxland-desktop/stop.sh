#!/bin/bash
# Stops the instance launch.sh started. Keeps $state/evidence; pass --purge to also delete the copied profile.
state=${VOXLAND_VERIFY_DIR:-$HOME/.cache/voxland-verify}
if [[ -e $state/pid ]]; then
    kill -- -"$(cat "$state/pid")" 2>/dev/null || kill "$(cat "$state/pid")" 2>/dev/null
    rm -f "$state/pid"
fi
if [[ -n ${HYPRLAND_INSTANCE_SIGNATURE:-} ]] && hyprctl monitors -j | jq -e '.[] | select(.name == "voxverify")' >/dev/null; then
    hyprctl output remove voxverify >/dev/null
fi
if [[ ${1:-} == --purge ]]; then
    rm -rf "$state/config" "$state/app.log"
fi
