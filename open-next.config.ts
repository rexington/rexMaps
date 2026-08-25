import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Minimal config: rexMaps is a client-heavy SPA, so no incremental cache is
// configured. If ISR/caching is ever needed, add the R2 incremental cache
// override here (see opennext.js.org/cloudflare/caching).
export default defineCloudflareConfig({});
