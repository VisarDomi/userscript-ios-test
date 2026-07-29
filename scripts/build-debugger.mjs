#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import dgram from "node:dgram";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(
    await readFile(resolve(root, "debugger.config.json"), "utf8"),
);
const pkg = JSON.parse(
    await readFile(resolve(root, "package.json"), "utf8"),
);

function lanAddress() {
    if (process.env.IOS_DEBUG_HOST) return process.env.IOS_DEBUG_HOST;
    return new Promise((resolveAddress, rejectAddress) => {
        const socket = dgram.createSocket("udp4");
        socket.once("error", error => {
            socket.close();
            rejectAddress(error);
        });
        socket.connect(80, "1.1.1.1", () => {
            const address = socket.address().address;
            socket.close();
            resolveAddress(address);
        });
    });
}

const host = await lanAddress();
const port = Number(process.env.IOS_DEBUG_PORT ?? config.port);
const source = (await readFile(resolve(root, "src/debug-template.user.js"), "utf8"))
    .replaceAll("{{DEBUGGER_NAME}}", `${config.name} v${pkg.version}`)
    .replaceAll("{{VERSION}}", pkg.version)
    .replaceAll("{{HOST}}", host)
    .replaceAll("{{ORIGIN}}", `https://${host}:${port}`);
const output = resolve(root, "dist", `${config.slug}.user.js`);

await mkdir(dirname(output), { recursive: true });
await writeFile(output, source);
console.log(`Built ${output}`);
