/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2025 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { FluxDispatcher, NavigationRouter, SettingsRouter, UserStore } from "@vencord/types/webpack/common";
import { IpcCommands } from "shared/IpcEvents";

import { openScreenSharePicker } from "./components/ScreenSharePicker";
import { VesktopLogger } from "./logger";
import { createScreenShareSession } from "./screenShareSession";

type IpcCommandHandler = (data: any) => any;

const handlers = new Map<string, IpcCommandHandler>();

function respond(nonce: string, ok: boolean, data: any) {
    VesktopNative.commands.respond({ nonce, ok, data });
}

VesktopNative.commands.onCommand(async ({ message, nonce, data }) => {
    const handler = handlers.get(message);
    if (!handler) {
        return respond(nonce, false, `No handler for message: ${message}`);
    }

    try {
        const result = await handler(data);
        respond(nonce, true, result);
    } catch (err) {
        respond(nonce, false, String(err));
    }
});

export function onIpcCommand(channel: string, handler: IpcCommandHandler) {
    if (handlers.has(channel)) {
        throw new Error(`Handler for message ${channel} already exists`);
    }

    handlers.set(channel, handler);
}

export function offIpcCommand(channel: string) {
    handlers.delete(channel);
}

/* Generic Handlers */

onIpcCommand(IpcCommands.NAVIGATE, (path: string) => NavigationRouter.transitionTo(path));

onIpcCommand(IpcCommands.NAVIGATE_SETTINGS, () => {
    SettingsRouter.openUserSettings("my_account_panel");
});

onIpcCommand(IpcCommands.GET_LANGUAGES, () => navigator.languages);

const screenShareSession = createScreenShareSession(
    VesktopNative.virtmic,
    // Discord's modules load after this file, so look the dispatcher up on each call
    {
        subscribe: (event, handler) => FluxDispatcher.subscribe(event, handler),
        unsubscribe: (event, handler) => FluxDispatcher.unsubscribe(event, handler)
    },
    () => UserStore.getCurrentUser().id
);

onIpcCommand(IpcCommands.SCREEN_SHARE_PICKER, async data => {
    const pick = await openScreenSharePicker(data.screens, data.skipPicker, data.target);
    // still start the stream, just without audio
    await screenShareSession.start(pick).catch(e => VesktopLogger.error("Failed to set up venmic", e));
    return pick;
});
