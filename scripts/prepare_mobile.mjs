import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const vendorFile = join("public", "vendor", "socket.io.min.js");
mkdirSync(dirname(vendorFile), { recursive: true });
copyFileSync(join("node_modules", "socket.io-client", "dist", "socket.io.min.js"), vendorFile);
console.log(`Copied ${vendorFile}`);
