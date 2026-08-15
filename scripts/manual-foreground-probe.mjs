#!/usr/bin/env node

import { createController } from "../src/controller.mjs";

const controller = createController({
    root: new URL("..", import.meta.url).pathname,
    name: "userscript-ios-test-manual-control",
    connectionTimeoutMs: 120_000,
});

try {
    await controller.ensureServer();
    await controller.waitForDebugger();

    const client = await controller.foregroundClient();
    const result = await controller.command(client.client, `
        document.getElementById("__userscript-ios-test-connection-success")?.remove();

        const box = document.createElement("div");
        box.id = "__userscript-ios-test-connection-success";
        box.textContent = "CONNECTION SUCCESSFUL";
        Object.assign(box.style, {
            position: "fixed",
            zIndex: "2147483647",
            top: "24px",
            left: "50%",
            transform: "translateX(-50%)",
            padding: "16px 22px",
            border: "2px solid #86efac",
            borderRadius: "12px",
            background: "#052e16",
            color: "#dcfce7",
            font: "700 16px/1.2 -apple-system, BlinkMacSystemFont, sans-serif",
            letterSpacing: "0.04em",
            boxShadow: "0 12px 32px rgba(0, 0, 0, 0.35)",
        });
        document.documentElement.appendChild(box);

        return {
            href: location.href,
            title: document.title,
            visibilityState: document.visibilityState,
            hasFocus: document.hasFocus(),
            message: box.textContent,
            visible: box.isConnected,
        };
    `);

    console.log("Foreground Safari control confirmed:");
    console.log(JSON.stringify(result, null, 2));
} finally {
    controller.close();
}
