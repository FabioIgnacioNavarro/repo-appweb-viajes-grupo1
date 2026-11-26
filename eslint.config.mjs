import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  {
    ignores: [
      ".agents/**",
      "dist/**",
      "dist-tests/**",
      "node_modules/**",
      "playwright-report/**",
      "test-results/**",
      "carga/resultados/**",
      "web/aplicacion.js",
      "web/legacy-demo/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["carga/k6/**/*.js"],
    languageOptions: {
      globals: {
        __ENV: "readonly",
        __VU: "readonly",
        __ITER: "readonly",
      },
    },
  },
  {
    files: ["src/**/*.ts", "tests/**/*.{ts,mts,mjs}", "scripts/**/*.{js,mjs}", "carga/**/*.{js,mjs}"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: ["web/src/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
    },
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-namespace": [
        "error",
        {
          allowDeclarations: true,
        },
      ],
    },
  },
  {
    files: ["src/*/dominio.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "express", message: "El dominio no debe depender de Express." },
            { name: "pg", message: "El dominio no debe depender del driver PostgreSQL." },
            { name: "ws", message: "El dominio no debe depender de WebSocket de infraestructura." },
            { name: "dotenv", message: "El dominio no debe leer configuración de entorno." },
            { name: "node:http", message: "El dominio no debe importar node:http." },
            { name: "node:https", message: "El dominio no debe importar node:https." },
          ],
          patterns: [
            {
              group: ["./http", "./postgres", "./servidor", "../compartido/cliente-servicios"],
              message: "El dominio no debe importar adaptadores de infraestructura.",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message: "El dominio no debe acceder a process.env; pasalo por puerto/configuración.",
        },
      ],
    },
  }
);
