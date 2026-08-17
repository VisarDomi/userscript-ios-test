import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import https from "node:https";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageVersion = JSON.parse(
    readFileSync(resolve(packageRoot, "package.json"), "utf8"),
).version;

export const sleep = milliseconds =>
    new Promise(resolveSleep => setTimeout(resolveSleep, milliseconds));

export function parseSelection(argv, { defaultTest = "full" } = {}) {
    const args = [...argv];

    function takeOption(name, fallback) {
        const index = args.indexOf(name);
        if (index === -1) return fallback;
        const value = args[index + 1];
        if (!value || value.startsWith("--")) {
            throw new Error(`${name} requires a value`);
        }
        args.splice(index, 2);
        return value;
    }

    const tags = [];
    while (args.includes("--tag")) tags.push(takeOption("--tag", null));

    return {
        test: takeOption("--test", defaultTest),
        site: takeOption("--site", null),
        tags,
        args,
    };
}

export function createController({
    root,
    name,
    debuggerName = `userscript-ios-test-debug v${packageVersion}`,
    debuggerSlug = "userscript-ios-test-debug",
    port = 37777,
    settleMs = 500,
    commandTimeoutMs = 90_000,
    clientTimeoutMs = 45_000,
    connectionTimeoutMs = 120_000,
}) {
    const origin = process.env.IOS_DEBUG_ORIGIN ?? `https://127.0.0.1:${port}`;
    const agent = new https.Agent({ rejectUnauthorized: false });
    let ownedServer = null;
    let lastNavigationAt = 0;

    function request(path, { method = "GET", body } = {}) {
        return new Promise((resolveRequest, rejectRequest) => {
            const url = new URL(path, origin);
            const payload = body === undefined ? null : JSON.stringify(body);
            const req = https.request(url, {
                method,
                agent,
                headers: payload ? {
                    "content-type": "application/json",
                    "content-length": Buffer.byteLength(payload),
                } : undefined,
            }, response => {
                const chunks = [];
                response.on("data", chunk => chunks.push(chunk));
                response.on("end", () => {
                    const text = Buffer.concat(chunks).toString();
                    if (
                        !response.statusCode ||
                        response.statusCode < 200 ||
                        response.statusCode >= 300
                    ) {
                        rejectRequest(new Error(
                            `${method} ${url.pathname}: HTTP ${response.statusCode}: ${text}`,
                        ));
                        return;
                    }
                    if (!text) {
                        resolveRequest(null);
                        return;
                    }
                    try {
                        resolveRequest(JSON.parse(text));
                    } catch {
                        rejectRequest(new Error(
                            `${method} ${url.pathname}: invalid JSON response`,
                        ));
                    }
                });
            });
            req.on("error", rejectRequest);
            if (payload) req.write(payload);
            req.end();
        });
    }

    async function state() {
        return request("/__debug_state");
    }

    async function ensureServer() {
        try {
            await state();
            return;
        } catch {
            ownedServer = spawn(
                "python3",
                [resolve(packageRoot, "python/bridge_server.py")],
                {
                    cwd: root,
                    stdio: ["ignore", "ignore", "inherit"],
                    env: {
                        ...process.env,
                        IOS_TEST_PROJECT_NAME: name,
                        IOS_TEST_DEBUGGER_NAME: debuggerName,
                        IOS_TEST_DEBUGGER_SLUG: debuggerSlug,
                        IOS_DEBUG_PORT: String(port),
                    },
                },
            );
        }

        for (let attempt = 0; attempt < 40; attempt++) {
            if (ownedServer.exitCode !== null) {
                throw new Error(
                    "The shared iOS test bridge failed to start.",
                );
            }
            try {
                await state();
                return;
            } catch {
                await sleep(250);
            }
        }
        throw new Error("Timed out starting the shared iOS test bridge.");
    }

    async function waitForDebugger() {
        const info = await request("/__debug_info");
        console.log(`Waiting for iPhone debugger on port ${new URL(origin).port}.`);
        console.log(`If it is not installed yet, open:\n  ${info.debuggerUrl}`);
        const deadline = Date.now() + connectionTimeoutMs;
        while (Date.now() < deadline) {
            const snapshot = await state();
            const now = Date.now() / 1000;
            if (snapshot.clients.some(client => now - client.lastSeen < 3)) {
                return info;
            }
            await sleep(250);
        }
        throw new Error(
            `No ${name} iPhone debugger is connected.\n` +
            `Install or update it from:\n  ${info.debuggerUrl}\n` +
            "Then keep Safari foregrounded and rerun the test.",
        );
    }

    function runLocal(command, args) {
        const completed = spawnSync(command, args, { cwd: root, stdio: "inherit" });
        if (completed.error) throw completed.error;
        if (completed.status !== 0) {
            throw new Error(`${command} ${args.join(" ")} failed with exit code ${completed.status}`);
        }
    }

    async function postCommand(target, code) {
        const posted = await request("/__debug_command", {
            method: "POST",
            body: { target, code },
        });
        return posted.id;
    }

    async function waitForResult(commandId) {
        const deadline = Date.now() + commandTimeoutMs;
        while (Date.now() < deadline) {
            const snapshot = await state();
            const result = [...snapshot.results]
                .reverse()
                .find(item => item.commandId === commandId);
            if (result) {
                if (!result.ok) {
                    const error = result.error?.message ?? JSON.stringify(result.error);
                    throw new Error(`Remote command ${commandId} failed: ${error}`);
                }
                return result.result;
            }
            await sleep(250);
        }
        throw new Error(`Timed out waiting for remote command ${commandId}`);
    }

    async function command(target, code, { expectResult = true } = {}) {
        const id = await postCommand(target, code);
        return expectResult ? waitForResult(id) : id;
    }

    async function navigationCommand(target, code, options) {
        const remaining = lastNavigationAt + settleMs - Date.now();
        if (remaining > 0) await sleep(remaining);
        lastNavigationAt = Date.now();
        return command(target, code, options);
    }

    async function activeClients() {
        const snapshot = await state();
        const now = Date.now() / 1000;
        return snapshot.clients.filter(client => now - client.lastSeen < 3);
    }

    async function foregroundClient() {
        const initial = await activeClients();
        if (!initial.length) throw new Error("No active iPhone debugger client");
        const commandId = await postCommand("*", `
            return {
                visibilityState: document.visibilityState,
                hasFocus: document.hasFocus(),
                href: location.href,
            };
        `);
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
            const current = await state();
            const now = Date.now() / 1000;
            // Match replies against the LIVE client list, not a snapshot taken
            // before the probe: a just-navigated foreground page registers its
            // client between snapshot and reply and would otherwise never
            // match. visibilityState is the authoritative discriminator on
            // iOS (document.hasFocus() is false even for the foreground tab);
            // hasFocus is only used to prefer a candidate, never to require.
            const live = new Map(
                current.clients
                    .filter(client => now - client.lastSeen < 3)
                    .map(client => [client.client, client]),
            );
            const replies = current.results.filter(result =>
                result.commandId === commandId && result.ok
            );
            const focused = replies.find(result =>
                result.result?.visibilityState === "visible" &&
                result.result?.hasFocus
            );
            const visible = focused ?? replies.find(result =>
                result.result?.visibilityState === "visible"
            );
            const match = visible ? live.get(visible.client) : undefined;
            if (match) return match;
            await sleep(100);
        }
        const remaining = await activeClients();
        if (remaining.length === 1) return remaining[0];
        throw new Error(
            `Could not identify the foreground Safari tab among ${remaining.length} active clients`,
        );
    }

    function navigationMatches(actualUrl, expectedUrl) {
        if (actualUrl === expectedUrl) return true;
        try {
            const actual = new URL(actualUrl);
            const expected = new URL(expectedUrl);
            return (
                actual.hostname === expected.hostname &&
                actual.pathname === expected.pathname &&
                actual.search === expected.search &&
                actual.hash === expected.hash
            );
        } catch {
            return false;
        }
    }

    async function waitForClient(predicate, description, {
        timeoutMs = clientTimeoutMs,
    } = {}) {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const snapshot = await state();
            const now = Date.now() / 1000;
            const match = [...snapshot.clients]
                .filter(client => now - client.lastSeen < 3 && predicate(client))
                .sort((left, right) => right.lastSeen - left.lastSeen)[0];
            if (match) return match;
            await sleep(250);
        }
        throw new Error(`No active iPhone debugger client for ${description}`);
    }

    async function waitForNewClient(knownClients, expectedUrl, options) {
        return waitForClient(
            client =>
                !knownClients.has(client.client) &&
                navigationMatches(client.href, expectedUrl),
            expectedUrl,
            options,
        );
    }

    async function navigate(client, url, { reloadIfSame = true } = {}) {
        const before = await state();
        const known = new Set(before.clients.map(item => item.client));
        await navigationCommand(client.client, `
            const target = ${JSON.stringify(url)};
            if (${reloadIfSame} && location.href === target) location.reload();
            else location.href = target;
            return "navigating";
        `, { expectResult: false });
        return waitForNewClient(known, url);
    }

    async function probe(client) {
        return command(client.client, `
            return {
                connected: true,
                href: location.href,
                visibilityState: document.visibilityState,
                hasFocus: document.hasFocus(),
            };
        `);
    }

    function close() {
        if (ownedServer && ownedServer.exitCode === null) ownedServer.kill();
    }

    return {
        name,
        origin,
        settleMs,
        request,
        state,
        ensureServer,
        waitForDebugger,
        runLocal,
        postCommand,
        waitForResult,
        command,
        navigationCommand,
        activeClients,
        foregroundClient,
        navigationMatches,
        waitForClient,
        waitForNewClient,
        navigate,
        probe,
        close,
    };
}

export function createReporter() {
    const results = [];

    async function check(ids, name, body, { continueOnFailure = false } = {}) {
        const startedAt = Date.now();
        try {
            const details = await body();
            results.push({
                ids,
                name,
                status: "PASS",
                milliseconds: Date.now() - startedAt,
                details,
            });
            console.log(`PASS ${ids.join(", ")} — ${name}`);
            return details;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            results.push({
                ids,
                name,
                status: "FAIL",
                milliseconds: Date.now() - startedAt,
                error: message,
            });
            console.error(`FAIL ${ids.join(", ")} — ${name}: ${message}`);
            if (continueOnFailure) return null;
            throw error;
        }
    }

    function skip(ids, name, reason) {
        results.push({ ids, name, status: "SKIP", reason });
        console.log(`SKIP ${ids.join(", ")} — ${name}: ${reason}`);
    }

    return { results, check, skip };
}

export function runBuildSteps(controller, steps) {
    for (const [command, args] of steps) controller.runLocal(command, args);
}

export function phaseBannerScript({
    globalName,
    elementId,
}) {
    return `
        globalThis[${JSON.stringify(globalName)}] = (text, state = "running") => {
            let box = document.getElementById(${JSON.stringify(elementId)});
            if (!box) {
                box = document.createElement("div");
                box.id = ${JSON.stringify(elementId)};
                Object.assign(box.style, {
                    position: "fixed",
                    zIndex: "2147483647",
                    top: "12px",
                    left: "12px",
                    right: "12px",
                    padding: "14px 16px",
                    borderRadius: "12px",
                    color: "white",
                    font: "700 18px/1.3 system-ui, sans-serif",
                    textAlign: "center",
                    boxShadow: "0 4px 20px #0009",
                    pointerEvents: "none",
                });
                (document.body || document.documentElement).appendChild(box);
            }
            box.style.background = state === "success"
                ? "#15803d"
                : state === "error" ? "#b91c1c" : "#1d4ed8";
            box.textContent = text;
        };
    `;
}

export async function runCaseMatrix({
    cases,
    pauseMs = 0,
    run,
    formatPass = () => "PASS",
    onFailure,
}) {
    const failures = [];
    const results = [];

    for (const [index, testCase] of cases.entries()) {
        if (index > 0 && pauseMs > 0) await sleep(pauseMs);
        process.stdout.write(`[${index + 1}/${cases.length}] ${testCase.name} ... `);
        try {
            const result = await run(testCase);
            results.push({ testCase, result });
            console.log(formatPass(result, testCase));
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const failure = { testCase, error, message };
            failures.push(failure);
            if (onFailure) await onFailure(failure);
            console.log(`FAIL\n    ${message}`);
        }
    }

    return { results, failures };
}

export function createSession({
    controller,
    startUrl = "https://example.com/",
    sourceLabel = "userscript-ios-test.user.js",
}) {
    let client = null;

    function currentClient() {
        if (!client) throw new Error("No Safari tab has been claimed");
        return client;
    }

    async function command(code, { expectResult = true } = {}) {
        return controller.command(currentClient().client, code, { expectResult });
    }

    async function postCommand(code) {
        return controller.postCommand(currentClient().client, code);
    }

    async function waitForNavigation(predicate, description) {
        client = await controller.waitForClient(predicate, description);
        return client;
    }

    async function navigate(url, {
        matches = (candidate, expected) =>
            controller.navigationMatches(candidate.href, expected),
        reloadIfSame = true,
    } = {}) {
        // Re-claim the foreground client: the session client can be stale
        // (pages that reload themselves, background-tab adoption). Posting
        // the navigation to a dead client navigates nothing.
        let previous = currentClient();
        try {
            const foreground = await controller.foregroundClient();
            if (foreground) previous = foreground;
        } catch {
            // Keep the session client; navigation may still succeed.
        }
        const before = await controller.state();
        const known = new Set(before.clients.map(item => item.client));
        await controller.navigationCommand(
            previous.client,
            `
                const target = ${JSON.stringify(url)};
                if (${reloadIfSame} && location.href === target) location.reload();
                else location.href = target;
                return "navigating";
            `,
            { expectResult: false },
        );
        client = await controller.waitForClient(
            candidate =>
                !known.has(candidate.client) &&
                matches(candidate, url),
            url,
        );
        return client;
    }

    async function reload(url = currentClient().href, {
        before = "",
        matches = (candidate, expected) =>
            controller.navigationMatches(candidate.href, expected),
    } = {}) {
        // Same staleness reasoning as navigate(): re-claim the foreground
        // client before posting the reload.
        let previous = currentClient();
        try {
            const foreground = await controller.foregroundClient();
            if (foreground) previous = foreground;
        } catch {
            // Keep the session client.
        }
        const beforeState = await controller.state();
        const known = new Set(beforeState.clients.map(item => item.client));
        await controller.navigationCommand(
            previous.client,
            `
                ${before}
                history.replaceState(null, "", ${JSON.stringify(url)});
                location.reload();
                return "reloading";
            `,
            { expectResult: false },
        );
        client = await controller.waitForClient(
            candidate =>
                !known.has(candidate.client) &&
                matches(candidate, url),
            url,
        );
        return client;
    }

    async function connect({
        allowedHosts = [],
        controlledCode = "return false;",
    } = {}) {
        await controller.ensureServer();
        await controller.waitForDebugger();
        client = await controller.foregroundClient();

        if (client.href !== startUrl) {
            const hostname = new URL(client.href).hostname;
            const startHostname = new URL(startUrl).hostname;
            const controlled = hostname === startHostname ||
                allowedHosts.includes(hostname) ||
                await command(controlledCode);
            if (!controlled) {
                throw new Error(
                    "The foreground Safari tab is unrelated to this test session.\n" +
                    `Open ${startUrl} once so the harness can claim it safely.\n` +
                    `Foreground tab is currently: ${client.href}`,
                );
            }
            console.log(`Returning controlled tab from ${client.href} to ${startUrl}.`);
            await navigate(startUrl);
        }

        console.log(`Claimed foreground Safari tab at ${client.href}.`);
        return client;
    }

    async function inject(bundle, {
        before = "",
        after = "",
        label = sourceLabel,
    } = {}) {
        return command(`
            ${before}
            const source = ${JSON.stringify(bundle)};
            new Function(
                source + String.fromCharCode(10) + ${JSON.stringify(`//# sourceURL=${label}`)}
            )();
            ${after}
            return { injectedBytes: source.length };
        `);
    }

    async function showPhase({
        globalName,
        text,
        state = "running",
        pauseMs = controller.settleMs,
    }) {
        await command(`
            globalThis[${JSON.stringify(globalName)}]?.(
                ${JSON.stringify(text)},
                ${JSON.stringify(state)}
            );
            return true;
        `);
        if (pauseMs > 0) await sleep(pauseMs);
    }

    async function cleanup() {
        if (!client || client.href === startUrl) return;
        try {
            // The session client can be stale (the page reloaded itself, or
            // background tabs displaced it): reclaim the foreground tab and
            // navigate IT back to the start URL.
            let driver = null;
            try {
                driver = await controller.foregroundClient();
            } catch {
                driver = null;
            }
            if (driver === null) {
                await navigate(startUrl);
                return;
            }
            await controller.navigationCommand(
                driver.client,
                `location.href = ${JSON.stringify(startUrl)}; return "navigating";`,
                { expectResult: false },
            );
            await controller.waitForClient(
                candidate => controller.navigationMatches(candidate.href, startUrl),
                startUrl,
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error(`Could not return Safari to ${startUrl}: ${message}`);
        }
    }

    function close() {
        controller.close();
    }

    return {
        get client() {
            return client;
        },
        currentClient,
        command,
        postCommand,
        waitForNavigation,
        navigate,
        reload,
        connect,
        inject,
        showPhase,
        cleanup,
        close,
    };
}

export async function runSession(session, connectOptions, body) {
    try {
        await session.connect(connectOptions);
        return await body(session);
    } finally {
        await session.cleanup();
        session.close();
    }
}
