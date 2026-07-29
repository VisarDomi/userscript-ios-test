#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
    createController,
    createSession,
    parseSelection,
    phaseBannerScript,
    runBuildSteps,
} from "userscript-ios-test/controller";

const root = resolve(import.meta.dirname, "../..");
const config = JSON.parse(
    await readFile(resolve(root, "tests/ios/config.json"), "utf8"),
);
const selection = parseSelection(process.argv.slice(2), {
    defaultTest: "smoke",
});
const controller = createController({
    root,
    name: config.name,
    settleMs: 500,
});
const session = createSession({
    controller,
    sourceLabel: "my-userscript.test.user.js",
});

function assert(condition, message, details) {
    if (condition) return;
    const suffix = details === undefined
        ? ""
        : `\n${JSON.stringify(details, null, 2)}`;
    throw new Error(`${message}${suffix}`);
}

async function main() {
    if (selection.test !== "smoke") {
        throw new Error('Expected "--test smoke"');
    }
    if (selection.site && selection.site !== "example") {
        throw new Error('Expected "--site example"');
    }
    if (selection.args.length) {
        throw new Error(`Unknown arguments: ${selection.args.join(" ")}`);
    }

    await session.connect({
        allowedHosts: ["provider.example"],
        controlledCode: `
            return Boolean(
                globalThis.__myUserscriptTestPhase ||
                document.querySelector(".my-userscript-app")
            );
        `,
    });

    runBuildSteps(controller, [
        ["npx", ["tsc", "--noEmit"]],
        ["npx", ["vite", "build"]],
    ]);
    const bundle = await readFile(
        resolve(root, "dist/my-userscript.user.js"),
        "utf8",
    );

    await session.navigate("https://provider.example/supported-route");
    await session.command(`
        ${phaseBannerScript({
            globalName: "__myUserscriptTestPhase",
            elementId: "__my-userscript-test-phase",
        })}
        const source = ${JSON.stringify(bundle)};
        new Function(
            source + String.fromCharCode(10) +
            "//# sourceURL=my-userscript.test.user.js"
        )();
        return true;
    `);

    const snapshot = await session.command(`
        const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
        for (
            let attempt = 0;
            attempt < 120 && !document.querySelector(".my-userscript-app");
            attempt++
        ) {
            await wait(250);
        }
        return {
            active: Boolean(document.querySelector(".my-userscript-app")),
            href: location.href,
            title: document.title,
        };
    `);

    assert(snapshot.active, "userscript did not activate", snapshot);
    await session.showPhase({
        globalName: "__myUserscriptTestPhase",
        text: "SMOKE TEST SUCCESSFUL",
        state: "success",
    });
    console.log("PASS", snapshot);
}

try {
    await main();
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
} finally {
    await session.cleanup();
    session.close();
}
