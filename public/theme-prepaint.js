// Generated from src/browser/; edit sources and run npm run build:browser.
(() => {
  // src/browser/helper-values.ts
  function record(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  // src/browser/themes.ts
  function decodeThemeTokens(value) {
    if (!record(value)) return {};
    return Object.fromEntries(Object.entries(value).filter((entry) => /^--[a-z][a-z0-9-]*$/.test(entry[0]) && typeof entry[1] === "string"));
  }
  function applyCachedTheme(document2, storage) {
    try {
      const id = storage.getItem("pi-dish-theme");
      if (id && id !== "solarized") document2.documentElement.dataset.theme = id;
      const tokens = JSON.parse(storage.getItem("pi-dish-theme-tokens") || "null");
      for (const [key, value] of Object.entries(decodeThemeTokens(tokens))) document2.documentElement.style.setProperty(key, value);
    } catch {
    }
  }

  // src/browser/theme-prepaint.ts
  try {
    applyCachedTheme(document, localStorage);
  } catch {
  }
})();
