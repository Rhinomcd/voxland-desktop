/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { release } from "os";

import { desktopCapturer, session } from "electron";
import { IpcCommands, IpcEvents } from "shared/IpcEvents";
import type { StreamPick } from "shared/screenShare";

import { readCaptureTarget } from "./captureTarget";
import { sendRendererCommand } from "./ipcCommands";
import { createSourcePicker } from "./pickSource";
import { handle } from "./utils/ipcWrappers";

export function registerScreenShareHandler() {
    const picker = createSourcePicker(
        { platform: process.platform, env: process.env, osRelease: release() },
        {
            getSources: width =>
                desktopCapturer.getSources({
                    types: ["window", "screen"],
                    thumbnailSize: { width, height: width * (9 / 16) }
                }),
            readCaptureTarget,
            openPicker: request => sendRendererCommand<StreamPick>(IpcCommands.SCREEN_SHARE_PICKER, request)
        }
    );

    handle(IpcEvents.CAPTURER_GET_LARGE_THUMBNAIL, (_, id: string) => picker.getLargeThumbnail(id));

    session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) =>
        callback(await picker.pickSource(request))
    );
}
