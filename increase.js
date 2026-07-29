import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const packagePath = resolve(root, "package.json");
const encoding = "utf8";

console.log(`Reading ${packagePath}...`);
const pkg = JSON.parse(readFileSync(packagePath, encoding));
console.log(`Found current version: ${pkg.version}`);

const nextVersion = String(Number.parseInt(pkg.version, 10) + 1);
console.log(`Incrementing to: ${nextVersion}`);

pkg.version = nextVersion;
writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`, encoding);
console.log("package.json has been updated successfully.");
