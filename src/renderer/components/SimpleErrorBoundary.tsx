/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2025 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Card, ErrorBoundary, Heading, Paragraph, TextButton } from "@vencord/types/components";
import type { PropsWithChildren } from "react";

function Fallback() {
    return (
        <Card variant="danger">
            <Heading tag="h4">Something went wrong.</Heading>
            <Paragraph>
                Please make sure Voxland is fully up to date. If this keeps happening,{" "}
                <TextButton
                    variant="link"
                    onClick={() => window.open("https://github.com/Rhinomcd/voxland-desktop/issues", "_blank")}
                >
                    report it on GitHub
                </TextButton>
            </Paragraph>
        </Card>
    );
}

export function SimpleErrorBoundary({ children }: PropsWithChildren<{}>) {
    return <ErrorBoundary fallback={Fallback}>{children}</ErrorBoundary>;
}
