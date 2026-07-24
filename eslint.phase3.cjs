module.exports = {
  env: {
    browser: true,
    es2022: true,
    node: true,
  },
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaFeatures: {jsx: true},
    ecmaVersion: 2022,
    sourceType: "module",
  },
  rules: {
    "no-debugger": "error",
    "no-duplicate-imports": "error",
    "no-unreachable": "error",
  },
};
