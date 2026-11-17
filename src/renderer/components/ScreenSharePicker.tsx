/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./screenSharePicker.css";
import { classNameFactory } from "@vencord/types/api/Styles";
import { Button, Card, CogWheel, FormSwitch, Heading, Margins, Paragraph, Span } from "@vencord/types/components";
import { classes, Logger, useAwaiter } from "@vencord/types/utils";
import { onceReady } from "@vencord/types/webpack";
import {
    closeModal,
    FluxDispatcher,
    Modal,
    openModal,
    Select,
    UserStore,
    useEffect,
    useState
} from "@vencord/types/webpack/common";
import type { Dispatch, SetStateAction } from "react";
import { State, useSettings, useVesktopState } from "renderer/settings";
import { isLinux, isWindows } from "renderer/utils";
import type { AudioApp, AudioAppList, AudioRequest, CaptureTarget } from "shared/screenShareAudio";

import { SimpleErrorBoundary } from "./SimpleErrorBoundary";

const StreamResolutions = ["480", "720", "1080", "1440", "2160", "0"] as const;
const StreamResolutionLabels = ["480", "720", "1080", "1440", "2160", "Source"];
const StreamFps = ["15", "30", "60"] as const;

const cl = classNameFactory("vcd-screen-picker-");

export type StreamResolution = (typeof StreamResolutions)[number];
export type StreamFps = (typeof StreamFps)[number];

type AudioChoice =
    | { kind: "window" }
    | { kind: "none" }
    | { kind: "system"; exclude: AudioApp[] }
    | { kind: "apps"; apps: AudioApp[] };

interface StreamSettings {
    audio: boolean;
    contentHint?: string;
    audioRequest?: AudioRequest;
}

export interface StreamPick extends StreamSettings {
    id: string;
}

interface Source {
    id: string;
    name: string;
    url: string;
}

export let currentSettings: StreamSettings | null = null;

if (isLinux) {
    onceReady.then(() => {
        const ownsStream = (streamKey: string) => {
            return streamKey.split(":").at(-1) === UserStore.getCurrentUser().id;
        };

        FluxDispatcher.subscribe("STREAM_CLOSE", ({ streamKey }: { streamKey: string }) => {
            if (!ownsStream(streamKey)) {
                return;
            }

            VesktopNative.virtmic.stop();
        });

        FluxDispatcher.subscribe("STREAM_UPDATE", ({ streamKey }: { streamKey: string }) => {
            if (!ownsStream(streamKey)) {
                return;
            }

            VesktopNative.virtmic.unmute();
        });
    });
}

export function openScreenSharePicker(screens: Source[], skipPicker: boolean, target: CaptureTarget | null = null) {
    let didSubmit = false;
    return new Promise<StreamPick>((resolve, reject) => {
        const key = openModal(
            props => (
                <ModalComponent
                    screens={screens}
                    target={target}
                    modalProps={props}
                    submit={async v => {
                        didSubmit = true;

                        if (isLinux && v.audioRequest) {
                            try {
                                if (v.audioRequest.kind === "none") {
                                    await VesktopNative.virtmic.stop();
                                } else {
                                    await VesktopNative.virtmic.start(v.audioRequest);
                                }
                            } catch (e) {
                                // still start the stream, just without audio
                                new Logger("VesktopScreenShare").error("Failed to set up venmic", e);
                            }
                        }

                        resolve(v);
                    }}
                    close={() => {
                        props.onClose();
                        if (!didSubmit) reject("Aborted");
                    }}
                    skipPicker={skipPicker}
                />
            ),
            {
                onCloseRequest() {
                    closeModal(key);
                    reject("Aborted");
                },
                onCloseCallback() {
                    if (!didSubmit) reject("Aborted");
                }
            }
        );
    });
}

function ScreenPicker({ screens, chooseScreen }: { screens: Source[]; chooseScreen: (id: string) => void }) {
    return (
        <div className={cl("screen-grid")}>
            {screens.map(({ id, name, url }) => (
                <label key={id} className={cl("screen-label")}>
                    <input
                        type="radio"
                        className={cl("screen-radio")}
                        name="screen"
                        value={id}
                        onChange={() => chooseScreen(id)}
                    />

                    <img src={url} alt="" />
                    <Paragraph className={cl("screen-name")}>{name}</Paragraph>
                </label>
            ))}
        </div>
    );
}

function AudioSettingsModal({ modalProps, close }: { modalProps: any; close: () => void }) {
    const Settings = useSettings();

    return (
        <Modal
            {...modalProps}
            size="lg"
            title="Audio Settings"
            actions={[{ text: "Back", variant: "secondary", onClick: close }]}
        >
            <div className={cl("venmic-settings")}>
                <FormSwitch
                    title="Initial Mute"
                    description="Fix an initial audio spike caused by chromium."
                    hideBorder
                    onChange={v => (Settings.audio = { ...Settings.audio, mute: v })}
                    value={Settings.audio?.mute ?? true}
                />
                <FormSwitch
                    title="Microphone Workaround"
                    description="Work around an issue that causes the microphone to be shared instead of the correct audio. Only enable if you're experiencing this issue."
                    hideBorder
                    onChange={v => (Settings.audio = { ...Settings.audio, workaround: v })}
                    value={Settings.audio?.workaround ?? false}
                />
                <FormSwitch
                    title="Only Speakers"
                    description={
                        'When sharing entire desktop audio, only share apps that play to a speaker. You may want to disable this when using "mix bussing".'
                    }
                    hideBorder
                    onChange={v => (Settings.audio = { ...Settings.audio, onlySpeakers: v })}
                    value={Settings.audio?.onlySpeakers ?? true}
                />
                <FormSwitch
                    title="Only Default Speakers"
                    description={
                        <>
                            When sharing entire desktop audio, only share apps that play to the <b>default</b> speakers.
                            You may want to disable this when using "mix bussing".
                        </>
                    }
                    hideBorder
                    onChange={v => (Settings.audio = { ...Settings.audio, onlyDefaultSpeakers: v })}
                    value={Settings.audio?.onlyDefaultSpeakers ?? true}
                />
                <FormSwitch
                    title="Ignore Inputs"
                    description="Exclude nodes that are intended to capture audio."
                    hideBorder
                    onChange={v => (Settings.audio = { ...Settings.audio, ignoreInputMedia: v })}
                    value={Settings.audio?.ignoreInputMedia ?? true}
                />
                <FormSwitch
                    title="Ignore Virtual"
                    description={
                        'Exclude virtual nodes, such as nodes belonging to loopbacks. This might be useful when using "mix bussing".'
                    }
                    hideBorder
                    onChange={v => (Settings.audio = { ...Settings.audio, ignoreVirtual: v })}
                    value={Settings.audio?.ignoreVirtual ?? false}
                />
                <FormSwitch
                    title="Ignore Devices"
                    description="Exclude device nodes, such as nodes belonging to microphones or speakers."
                    hideBorder
                    onChange={v =>
                        (Settings.audio = {
                            ...Settings.audio,
                            ignoreDevices: v,
                            deviceSelect: v ? false : Settings.audio?.deviceSelect
                        })
                    }
                    value={Settings.audio?.ignoreDevices ?? true}
                />
                <FormSwitch
                    title="Device Selection"
                    description={
                        <>
                            Allow to select devices such as microphones. Requires <b>Ignore Devices</b> to be turned
                            off.
                        </>
                    }
                    hideBorder
                    onChange={value => (Settings.audio = { ...Settings.audio, deviceSelect: value })}
                    value={Settings.audio?.deviceSelect ?? false}
                    disabled={Settings.audio?.ignoreDevices}
                />
            </div>
        </Modal>
    );
}

function OptionRadio<Settings extends object, Key extends keyof Settings>(props: {
    options: Array<string> | ReadonlyArray<string>;
    labels?: Array<string>;
    settings: Settings;
    settingsKey: Key;
    onChange: (option: string) => void;
}) {
    const { options, settings, settingsKey, labels, onChange } = props;

    return (
        <div className={cl("option-radios")}>
            {(options as string[]).map((option, idx) => (
                <label className={cl("option-radio")} data-checked={settings[settingsKey] === option} key={option}>
                    <Span weight="bold">{labels?.[idx] ?? option}</Span>
                    <input
                        className={cl("option-input")}
                        type="radio"
                        name="fps"
                        value={option}
                        checked={settings[settingsKey] === option}
                        onChange={() => onChange(option)}
                    />
                </label>
            ))}
        </div>
    );
}

function StreamSettingsUi({
    source,
    settings,
    setSettings,
    skipPicker,
    audio
}: {
    source: Source;
    settings: StreamSettings;
    setSettings: Dispatch<SetStateAction<StreamSettings>>;
    skipPicker: boolean;
    audio: AudioPickerProps;
}) {
    const qualitySettings = State.store.screenshareQuality!;

    const [thumb] = useAwaiter(
        () => (skipPicker ? Promise.resolve(source.url) : VesktopNative.capturer.getLargeThumbnail(source.id)),
        {
            fallbackValue: source.url,
            deps: [source.id]
        }
    );

    return (
        <div>
            <Heading tag="h4" className={Margins.bottom8}>
                What you're streaming
            </Heading>
            <Card className={cl("card", "preview")}>
                <img src={thumb} alt="" className={cl(isLinux ? "preview-img-linux" : "preview-img")} />
                <Paragraph>{source.name || "Your screen"}</Paragraph>
            </Card>

            <Heading tag="h4" className={Margins.bottom8}>
                Stream Settings
            </Heading>

            <Card className={cl("card")}>
                <div className={cl("quality")}>
                    <section className={cl("quality-section")}>
                        <Heading tag="h5" className={Margins.bottom8}>
                            Resolution
                        </Heading>
                        <OptionRadio
                            options={StreamResolutions}
                            labels={StreamResolutionLabels}
                            settings={qualitySettings}
                            settingsKey="resolution"
                            onChange={value => (qualitySettings.resolution = value)}
                        />
                    </section>

                    <section className={cl("quality-section")}>
                        <Heading tag="h5" className={Margins.bottom8}>
                            Frame Rate
                        </Heading>
                        <OptionRadio
                            options={StreamFps}
                            settings={qualitySettings}
                            settingsKey="frameRate"
                            onChange={value => (qualitySettings.frameRate = value)}
                        />
                    </section>
                </div>
                <div className={cl("quality")}>
                    <section className={cl("quality-section")}>
                        <Heading tag="h5" className={Margins.bottom8}>
                            Content Type
                        </Heading>
                        <div>
                            <OptionRadio
                                options={["motion", "detail"]}
                                labels={["Prefer Smoothness", "Prefer Clarity"]}
                                settings={settings}
                                settingsKey="contentHint"
                                onChange={option => setSettings(s => ({ ...s, contentHint: option }))}
                            />

                            <Paragraph className={Margins.top8}>
                                Choosing "Prefer Clarity" will result in a significantly lower framerate in exchange for
                                a much sharper and clearer image.
                            </Paragraph>
                        </div>
                        {isWindows && (
                            <FormSwitch
                                title="Stream With Audio"
                                hideBorder
                                value={settings.audio}
                                onChange={checked => setSettings(s => ({ ...s, audio: checked }))}
                                className={cl("audio")}
                            />
                        )}
                    </section>
                </div>
            </Card>

            {isLinux && <AudioPickerLinux {...audio} />}
        </div>
    );
}

function useAudioApps(enabled: boolean) {
    const [list, setList] = useState<AudioAppList | null>(null);

    useEffect(() => {
        if (!enabled) return;

        let cancelled = false;
        let timer: ReturnType<typeof setTimeout>;
        const refresh = async () => {
            try {
                const l = await VesktopNative.virtmic.list();
                if (!cancelled) setList(l);
            } catch (e) {
                new Logger("VesktopScreenShare").error("Failed to list audio sources", e);
            }
            if (!cancelled) timer = setTimeout(refresh, 2000);
        };

        refresh();
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [enabled]);

    return list;
}

function appsOfWindow(target: CaptureTarget | null, apps: AudioApp[]) {
    if (target?.kind !== "window") return [];
    return apps.filter(a => a.pids.some(pid => target.pids.includes(pid)));
}

function defaultAudioChoice(target: CaptureTarget | null): AudioChoice {
    if (target?.kind === "window" && target.pids.length) return { kind: "window" };
    if (target?.kind === "screen") return { kind: "system", exclude: [] };
    return { kind: "none" };
}

function toAudioRequest(choice: AudioChoice, target: CaptureTarget | null): AudioRequest {
    switch (choice.kind) {
        case "none":
            return choice;
        case "system":
            return { kind: "system", exclude: choice.exclude.map(a => a.id) };
        case "apps":
            return { kind: "apps", apps: choice.apps.map(a => a.id) };
        case "window":
            return target?.kind === "window" ? { kind: "window", window: target.window } : { kind: "none" };
    }
}

function describeAudioChoice(choice: AudioChoice, target: CaptureTarget | null, apps: AudioApp[]) {
    const labels = (picked: AudioApp[]) => picked.map(p => (apps.find(a => a.id === p.id) ?? p).label).join(", ");

    switch (choice.kind) {
        case "none":
            return target
                ? { title: "No audio", detail: "Your stream will be silent" }
                : {
                      title: "No audio",
                      detail: "Couldn't tell what you're sharing"
                  };
        case "system":
            return {
                title: "All system audio",
                detail: choice.exclude.length
                    ? `Everything except Discord and ${labels(choice.exclude)}`
                    : "Everything except Discord"
            };
        case "apps":
            return { title: labels(choice.apps), detail: "Chosen by you" };
        case "window": {
            const windowApps = appsOfWindow(target, apps);
            const windowLabel = target?.kind === "window" ? target.label : "";
            return windowApps.length
                ? { title: labels(windowApps), detail: "From the window you're sharing" }
                : { title: windowLabel, detail: "From the window you're sharing, once it plays sound" };
        }
    }
}

type AudioOption = "window" | "system" | "none" | AudioApp;

function toggleApp(picked: AudioApp[], app: AudioApp) {
    return picked.some(p => p.id === app.id) ? picked.filter(p => p.id !== app.id) : [...picked, app];
}

/** Keeps picked apps listed after they go quiet, so they can still be unpicked. */
function withPicked(apps: AudioApp[], picked: AudioApp[]) {
    return [...apps, ...picked.filter(p => !apps.some(a => a.id === p.id))];
}

interface AudioPickerProps {
    list: AudioAppList | null;
    target: CaptureTarget | null;
    choice: AudioChoice;
    setChoice: (choice: AudioChoice) => void;
}

function SpeakerIcon({ muted }: { muted: boolean }) {
    return (
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
            <path
                d={
                    muted
                        ? "M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.8 8.8 0 0 0 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a9 9 0 0 0 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z"
                        : "M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05A4.5 4.5 0 0 0 16.5 12zM14 3.23v2.06a7 7 0 0 1 0 13.42v2.06A9 9 0 0 0 14 3.23z"
                }
            />
        </svg>
    );
}

function AudioPickerLinux({ list, target, choice, setChoice }: AudioPickerProps) {
    return (
        <>
            <Heading tag="h4" className={classes(Margins.top16, Margins.bottom8)}>
                Audio
            </Heading>
            <Card className={cl("card", "audio-card")}>
                <AudioPickerLinuxBody list={list} target={target} choice={choice} setChoice={setChoice} />
            </Card>
        </>
    );
}

function AudioPickerLinuxBody({ list, target, choice, setChoice }: AudioPickerProps) {
    const [editing, setEditing] = useState(false);
    const [ignorePulseWarning, setIgnorePulseWarning] = useState(false);

    if (list && !list.ok && list.isGlibCxxOutdated) {
        return (
            <Paragraph>
                Failed to retrieve Audio Sources because your C++ library is too old to run
                <a href="https://github.com/Vencord/venmic" target="_blank" rel="noreferrer">
                    venmic
                </a>
                . See{" "}
                <a
                    href="https://gist.github.com/Vendicated/b655044ffbb16b2716095a448c6d827a"
                    target="_blank"
                    rel="noreferrer"
                >
                    this guide
                </a>{" "}
                for possible solutions.
            </Paragraph>
        );
    }

    if (list?.ok && !list.hasPipewirePulse && !ignorePulseWarning) {
        return (
            <Paragraph>
                Could not find pipewire-pulse. See{" "}
                <a
                    href="https://gist.github.com/the-spyke/2de98b22ff4f978ebf0650c90e82027e#install"
                    target="_blank"
                    rel="noreferrer"
                >
                    this guide
                </a>{" "}
                on how to switch to pipewire. <br />
                You can still continue, however, please{" "}
                <b>beware that you can only share audio of apps that are running under pipewire</b>.{" "}
                <a onClick={() => setIgnorePulseWarning(true)}>I know what I'm doing!</a>
            </Paragraph>
        );
    }

    const apps = list?.ok ? list.apps : [];
    const { title, detail } = describeAudioChoice(choice, target, apps);
    const needsChoice = choice.kind === "none" && !target;

    const sourceOptions: { label: string; value: AudioOption }[] = [
        ...(target?.kind === "window" && target.pids.length
            ? [{ label: `Window you're sharing (${target.label})`, value: "window" as const }]
            : []),
        { label: "All system audio", value: "system" },
        { label: "No audio", value: "none" },
        ...withPicked(apps, choice.kind === "apps" ? choice.apps : []).map(a => ({ label: a.label, value: a }))
    ];

    const isSourceSelected = (value: AudioOption) => {
        if (typeof value === "string") return choice.kind === value;
        return choice.kind === "apps" && choice.apps.some(a => a.id === value.id);
    };

    const selectSource = (value: AudioOption) => {
        if (typeof value === "string") {
            setChoice(value === "system" ? { kind: "system", exclude: [] } : { kind: value });
            return;
        }

        const picked = toggleApp(choice.kind === "apps" ? choice.apps : [], value);
        setChoice(picked.length ? { kind: "apps", apps: picked } : { kind: "none" });
    };

    const openSettings = () =>
        openModal(props => <AudioSettingsModal modalProps={props} close={() => props.onClose()} />);

    return (
        <>
            <div className={cl("audio-row")}>
                <div className={cl("audio-icon")} data-muted={choice.kind === "none"}>
                    <SpeakerIcon muted={choice.kind === "none"} />
                </div>
                <div className={cl("audio-text")}>
                    <Paragraph weight="semibold">{title}</Paragraph>
                    <Paragraph size="sm" className={cl("audio-detail")}>
                        {detail}
                    </Paragraph>
                </div>
                <Button
                    variant={needsChoice && !editing ? "primary" : "secondary"}
                    size="small"
                    onClick={() => setEditing(e => !e)}
                >
                    {editing ? "Done" : needsChoice ? "Choose audio" : "Change"}
                </Button>
            </div>

            {editing && (
                <div className={cl("audio-panel")}>
                    <div className={cl("audio-sources")}>
                        <section>
                            <Heading tag="h5" className={Margins.bottom8}>
                                Share audio from
                            </Heading>
                            <SimpleErrorBoundary>
                                <Select
                                    options={sourceOptions}
                                    isSelected={isSourceSelected}
                                    select={selectSource}
                                    serialize={(v: AudioOption) => (typeof v === "string" ? v : v.id)}
                                    popoutPosition="top"
                                    closeOnSelect={false}
                                    renderOptionLabel={o => o.label}
                                />
                            </SimpleErrorBoundary>
                        </section>
                        {choice.kind === "system" && (
                            <section>
                                <Heading tag="h5" className={Margins.bottom8}>
                                    Leave out
                                </Heading>
                                <SimpleErrorBoundary>
                                    <Select
                                        options={withPicked(apps, choice.exclude).map(a => ({
                                            label: a.label,
                                            value: a
                                        }))}
                                        isSelected={(a: AudioApp) => choice.exclude.some(e => e.id === a.id)}
                                        select={(a: AudioApp) =>
                                            setChoice({ kind: "system", exclude: toggleApp(choice.exclude, a) })
                                        }
                                        serialize={(a: AudioApp) => a.id}
                                        popoutPosition="top"
                                        closeOnSelect={false}
                                        renderOptionLabel={o => o.label}
                                        placeholder="Nothing else"
                                    />
                                </SimpleErrorBoundary>
                            </section>
                        )}
                        <Button
                            variant="secondary"
                            size="small"
                            onClick={openSettings}
                            className={cl("settings-button", "audio-settings-button")}
                        >
                            <CogWheel className={cl("settings-button-icon")} />
                            Audio Settings
                        </Button>
                    </div>
                </div>
            )}
        </>
    );
}

function ModalComponent({
    screens,
    target,
    modalProps,
    submit,
    close,
    skipPicker
}: {
    screens: Source[];
    target: CaptureTarget | null;
    modalProps: any;
    submit: (data: StreamPick) => void;
    close: () => void;
    skipPicker: boolean;
}) {
    const [selected, setSelected] = useState<string | undefined>(skipPicker ? screens[0].id : void 0);
    const [settings, setSettings] = useState<StreamSettings>({
        contentHint: "motion",
        audio: true
    });
    const [pickedAudio, setAudioChoice] = useState<AudioChoice>();
    // Voxland's own grid (X11) tells screens from windows; the portal (Wayland) needs the picker hook
    const resolvedTarget =
        target ?? (!skipPicker && selected?.startsWith("screen:") ? { kind: "screen" as const } : null);
    const audioChoice = pickedAudio ?? defaultAudioChoice(resolvedTarget);
    const audioList = useAudioApps(isLinux && !!selected);
    useVesktopState().screenshareQuality ??= {
        resolution: "720",
        frameRate: "30"
    };

    function handleGoLive() {
        const pick = { ...settings, audioRequest: isLinux ? toAudioRequest(audioChoice, resolvedTarget) : undefined };
        currentSettings = pick;
        submit({ id: selected!, ...pick });
        close();
    }

    const showGoBack = selected && !skipPicker;
    return (
        <Modal
            {...modalProps}
            size="lg"
            title="Screen Share Picker"
            actions={[
                {
                    text: showGoBack ? "Back" : "Cancel",
                    variant: "secondary",
                    onClick: () => {
                        if (!showGoBack) return close();
                        setSelected(void 0);
                        setAudioChoice(undefined);
                    }
                },
                {
                    text: "Go Live",
                    disabled: !selected,
                    onClick: handleGoLive
                }
            ]}
        >
            {!selected ? (
                <ScreenPicker screens={screens} chooseScreen={setSelected} />
            ) : (
                <StreamSettingsUi
                    source={screens.find(s => s.id === selected)!}
                    settings={settings}
                    setSettings={setSettings}
                    skipPicker={skipPicker}
                    audio={{ list: audioList, target: resolvedTarget, choice: audioChoice, setChoice: setAudioChoice }}
                />
            )}
        </Modal>
    );
}
