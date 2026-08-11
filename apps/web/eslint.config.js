import eslint from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "eslint.config.js", "scripts"] },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.es2022 },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      "no-restricted-globals": [
        "error",
        { name: "fetch", message: "Use an injected repository adapter." },
      ],
    },
  },
  {
    files: ["src/adapters/http-*-repository.ts"],
    rules: { "no-restricted-globals": "off" },
  },
  {
    files: ["src/adapters/http-journey-repository.test.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: [
      "src/i18n/i18n.tsx",
      "src/auth/auth.tsx",
      "src/features/journeys/journey-data.tsx",
    ],
    rules: { "react-refresh/only-export-components": "off" },
  },
);
