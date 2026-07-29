#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const debuggerConfig = JSON.parse(
    readFileSync(resolve(packageRoot, "debugger.config.json"), "utf8"),
);
const pkg = JSON.parse(
    readFileSync(resolve(packageRoot, "package.json"), "utf8"),
);
const args = process.argv.slice(2);
const action = args.shift();
const configIndex = args.indexOf("--config");
const configPath = configIndex === -1 ? "tests/ios/config.json" : args[configIndex + 1];

if (!["server", "setup"].includes(action)) {
    console.error("Usage: userscript-ios-test <server|setup> [--config path]");
    process.exit(1);
}
if (!configPath) {
    console.error("--config requires a path");
    process.exit(1);
}

const projectRoot = process.cwd();
const config = JSON.parse(readFileSync(resolve(projectRoot, configPath), "utf8"));
if (!config.name) {
    console.error(`${configPath} must contain "name"`);
    process.exit(1);
}

const completed = spawnSync(
    "python3",
    [
        resolve(packageRoot, "python/bridge_server.py"),
        ...(action === "setup" ? ["--setup"] : []),
    ],
    {
        cwd: projectRoot,
        stdio: "inherit",
        env: {
            ...process.env,
            IOS_TEST_PROJECT_NAME: config.name,
            IOS_TEST_DEBUGGER_NAME: `${debuggerConfig.name} v${pkg.version}`,
            IOS_TEST_DEBUGGER_SLUG: debuggerConfig.slug,
            IOS_DEBUG_PORT: String(debuggerConfig.port),
        },
    },
);

if (completed.error) throw completed.error;
process.exitCode = completed.status ?? 1;
