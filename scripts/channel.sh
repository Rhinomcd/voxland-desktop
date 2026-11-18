#!/bin/bash
# Builds a Voxland release channel from GitHub and installs it for the current user.
# stable tracks main, nightly tracks dev. `timer` schedules a nightly rebuild with systemd.
set -euo pipefail

usage() {
    echo "usage: $0 install <stable|nightly> [--force]" >&2
    echo "       $0 timer" >&2
    exit 2
}

data=${XDG_DATA_HOME:-$HOME/.local/share}
voxdata=$data/voxland
bin=$HOME/.local/bin/voxland-channel

select_channel() {
    root=$voxdata/$1
    case $1 in
        stable)
            branch=main name=Voxland install_dir=$HOME/.local/opt/voxland
            profile=${XDG_CONFIG_HOME:-$HOME/.config}/vesktop
            launch_args=() desktop_extra="MimeType=x-scheme-handler/discord;"
            ;;
        nightly)
            branch=dev name="Voxland Nightly" install_dir=$HOME/.local/opt/voxland-nightly
            profile=$root/profile
            launch_args=("--user-data-dir=$profile") desktop_extra=""
            ;;
        *) usage ;;
    esac
}

running() {
    pgrep -f "^$install_dir/vesktop( |$)" >/dev/null
}

checkout() {
    local dir=$root/$1
    [[ -d $dir/.git ]] || git clone -q --filter=blob:none --no-checkout "https://github.com/Rhinomcd/$1.git" "$dir"
    git -C "$dir" fetch -q --prune origin
    git -C "$dir" checkout -qf --detach "origin/$branch"
    git -C "$dir" rev-parse --short HEAD
}

replace_dir() {
    rm -rf "$2.new" "$2.old"
    cp -a "$1" "$2.new"
    [[ ! -e $2 ]] || mv "$2" "$2.old"
    mv "$2.new" "$2"
    rm -rf "$2.old"
}

write_desktop_entry() {
    local exec_line="\"$install_dir/vesktop\"" arg
    for arg in "${launch_args[@]}"; do exec_line+=" \"$arg\""; done
    mkdir -p "$data/applications"
    cat >"$data/applications/$(basename "$install_dir").desktop" <<EOF
[Desktop Entry]
Name=$name
GenericName=Internet Messenger
Comment=Discord client, $channel channel (built from $branch)
Exec=$exec_line %U
Icon=voxland
Terminal=false
Type=Application
StartupWMClass=vesktop
Categories=Network;InstantMessaging;Chat;
Keywords=discord;vencord;vesktop;voxland;chat;
$desktop_extra
EOF
}

point_profile_at_mod() {
    local state=$profile/state.json
    mkdir -p "$profile"
    [[ -s $state ]] || echo '{}' >"$state"
    jq --arg dir "$root/mod" '.vencordDir = $dir' "$state" >"$state.tmp"
    mv "$state.tmp" "$state"
}

install_channel() {
    channel=$1
    local force=${2:-}
    select_channel "$channel"
    mkdir -p "$root"
    exec 9>"$voxdata/channel.lock"
    flock -n 9 || { echo "another channel build is running" >&2; exit 1; }

    if running; then
        echo "$name is running; quit it and rerun to update"
        return 0
    fi

    local mod_sha desktop_sha stamp
    mod_sha=$(checkout voxland)
    desktop_sha=$(checkout voxland-desktop)
    stamp="voxland@$mod_sha voxland-desktop@$desktop_sha"
    if [[ $force != --force && -d $install_dir && $(cat "$root/installed" 2>/dev/null) == "$stamp" ]]; then
        echo "$name is already at $stamp"
        return 0
    fi

    echo "building $name: $stamp"
    (cd "$root/voxland" && vp install --frozen-lockfile && vp run build)
    (cd "$root/voxland-desktop" && vp install --frozen-lockfile && vp run package:dir)

    if running; then
        echo "$name was started during the build; quit it and rerun to install"
        return 0
    fi
    local unpacked
    unpacked=$(find "$root/voxland-desktop/dist" -maxdepth 1 -type d -name 'linux*-unpacked' | head -n1)
    [[ -n $unpacked ]] || { echo "electron-builder produced no linux-unpacked dir" >&2; exit 1; }
    mkdir -p "$(dirname "$install_dir")"
    replace_dir "$root/voxland/dist" "$root/mod"
    replace_dir "$unpacked" "$install_dir"
    point_profile_at_mod
    write_desktop_entry
    echo "$stamp" >"$root/installed"

    if [[ $channel == stable && -f $root/voxland-desktop/scripts/channel.sh ]]; then
        mkdir -p "$(dirname "$bin")"
        install -m755 "$root/voxland-desktop/scripts/channel.sh" "$bin.tmp"
        mv "$bin.tmp" "$bin"
    fi
    echo "installed $name: $stamp"
}

install_timer() {
    local units=${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user
    mkdir -p "$units" "$(dirname "$bin")"
    install -m755 "$0" "$bin.tmp"
    mv "$bin.tmp" "$bin"
    cat >"$units/voxland-nightly.service" <<EOF
[Unit]
Description=Build and install Voxland Nightly from the dev branch

[Service]
Type=oneshot
Environment=PATH=$PATH
ExecStart=$bin install nightly
EOF
    cat >"$units/voxland-nightly.timer" <<EOF
[Unit]
Description=Rebuild Voxland Nightly every night

[Timer]
OnCalendar=*-*-* 04:00
Persistent=true

[Install]
WantedBy=timers.target
EOF
    systemctl --user daemon-reload
    systemctl --user enable --now voxland-nightly.timer
    systemctl --user list-timers voxland-nightly.timer --no-pager
}

case ${1:-} in
    install) [[ $# -ge 2 ]] || usage; install_channel "$2" "${3:-}" ;;
    timer) install_timer ;;
    *) usage ;;
esac
