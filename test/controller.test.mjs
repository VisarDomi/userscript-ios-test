import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
    createController,
    createSession,
    parseSelection,
    phaseBannerScript,
    runCaseMatrix,
} from "../src/controller.mjs";

test("parseSelection separates shared selectors from repository arguments", () => {
    const selection = parseSelection([
        "--test", "tracking",
        "--site", "asura",
        "--tag", "phone",
        "https://example.com/",
    ]);

    assert.deepEqual(selection, {
        test: "tracking",
        site: "asura",
        tags: ["phone"],
        args: ["https://example.com/"],
    });
});

test("controller URL matching is exact by default", () => {
    const controller = createController({
        root: process.cwd(),
        name: "test",
        port: 39999,
    });

    assert.equal(
        controller.navigationMatches(
            "https://example.com/path?q=1#two",
            "https://example.com/path?q=1#two",
        ),
        true,
    );
    assert.equal(
        controller.navigationMatches(
            "https://example.com/path?q=2#two",
            "https://example.com/path?q=1#two",
        ),
        false,
    );
});

test("session normalizes a controlled example.com fixture URL to the exact start URL", async () => {
    const navigations = [];
    const controller = {
        settleMs: 0,
        navigationMatches: (actual, expected) => actual === expected,
        navigationCommand: async () => {},
        waitForClient: async predicate => {
            const candidate = { client: "next", href: "https://example.com/" };
            assert.equal(predicate(candidate), true);
            navigations.push(candidate.href);
            return candidate;
        },
        close: () => {},
    };
    const actual = createSession({ controller });
    controller.ensureServer = async () => {};
    controller.waitForDebugger = async () => {};
    controller.foregroundClient = async () => ({
        client: "fixture",
        href: "https://example.com/fixture/home",
    });
    controller.command = async () => true;
    await actual.connect({ allowedHosts: ["example.com"] });

    assert.deepEqual(navigations, ["https://example.com/"]);
});

test("phase banner helper uses repository-provided global and element names", () => {
    const source = phaseBannerScript({
        globalName: "__examplePhase",
        elementId: "__example-phase",
    });
    assert.match(source, /__examplePhase/);
    assert.match(source, /__example-phase/);
});

test("case matrix continues after a failure", async () => {
    const originalWrite = process.stdout.write;
    const originalLog = console.log;
    process.stdout.write = () => true;
    console.log = () => {};
    try {
        const outcome = await runCaseMatrix({
            cases: [{ name: "one" }, { name: "two" }],
            run: testCase => {
                if (testCase.name === "one") throw new Error("expected");
                return "passed";
            },
        });
        assert.equal(outcome.failures.length, 1);
        assert.equal(outcome.results.length, 1);
        assert.equal(outcome.results[0].result, "passed");
    } finally {
        process.stdout.write = originalWrite;
        console.log = originalLog;
    }
});

test("debugger polling does not await long-running remote commands", async () => {
    const source = await readFile(
        new URL("../src/debug-template.user.js", import.meta.url),
        "utf8",
    );
    assert.match(
        source,
        /lastCommandId = Math\.max[\s\S]+for \(const command of payload\.commands \|\| \[\]\) void execute\(command\)/,
    );
    assert.doesNotMatch(
        source,
        /for \(const command of payload\.commands \|\| \[\]\) await execute\(command\)/,
    );
});
