import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Layers (docs/ARCHITECTURE.md): app -> components -> modules -> platform. A layer never imports one above it, and
// a module reaches another module only through its index ("@/modules/ncf"), never its files.
const restrict = (regex, message) => ({ "no-restricted-imports": ["error", { patterns: [{ regex, message }] }] });
const MODULES = ["ncf", "suppliers", "admin"];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/platform/**"],
    rules: restrict("^@/(modules|components|app)(/|$)", "platform/ is shared by every module and must not depend on one."),
  },
  ...MODULES.map((m) => ({
    files: [`src/modules/${m}/**`],
    rules: restrict(`^@/(components|app)(/|$)|^@/modules/(?!${m}/)[^/]+/`,
      "Business rules must not depend on screens, and another module is used through its index only."),
  })),
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
