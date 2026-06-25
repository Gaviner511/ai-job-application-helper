(() => {
  const THEMES = [
    ["forest", "Forest"],
    ["ocean", "Ocean"],
    ["violet", "Violet"],
    ["rose", "Rose"],
    ["amber", "Amber"]
  ];
  const applyAccent = (accent = "forest") => {
    const normalized = THEMES.some(([value]) => value === accent) ? accent : "forest";
    document.documentElement.dataset.jahAccent = normalized;
    document.body?.classList.add("jah-unified-ui");
    const picker = document.querySelector("#jah-theme-accent");
    if (picker) picker.value = normalized;
  };

  const applyMode = (mode = "light") => {
    const normalized = mode === "dark" ? "dark" : "light";
    document.documentElement.dataset.jahMode = normalized;
    document.body?.classList.toggle("theme-dark", normalized === "dark");
    const picker = document.querySelector("#jah-theme-mode");
    if (picker) {
      picker.textContent = normalized === "dark" ? "☾" : "☼";
      picker.classList.toggle("active", normalized === "dark");
      picker.title = normalized === "dark" ? "Switch to light mode" : "Switch to dark mode";
    }
  };

  const applyUxMode = (mode = "basic") => {
    const normalized = mode === "advanced" ? "advanced" : "basic";
    document.body?.classList.toggle("mode-advanced", normalized === "advanced");
    document.body?.classList.toggle("mode-basic", normalized !== "advanced");
  };

  const readTheme = async () => {
    try {
      const stored = await chrome.storage.local.get(["jahAccentTheme", "jahThemeMode", "resumeTailorTheme", "jahUxMode"]);
      applyUxMode(stored.jahUxMode);
      return {
        accent: stored.jahAccentTheme || "forest",
        mode: stored.jahThemeMode || stored.resumeTailorTheme || "light"
      };
    } catch {
      return { accent: "forest", mode: "light" };
    }
  };

  const saveTheme = async ({ accent, mode }) => {
    if (accent) applyAccent(accent);
    applyMode(mode);
    try {
      const payload = { jahThemeMode: mode, resumeTailorTheme: mode };
      if (accent) payload.jahAccentTheme = accent;
      await chrome.storage.local.set(payload);
    } catch {}
  };

  const createPicker = async () => {
    if (document.querySelector("#jah-theme-control")) return;
    const isSettingsPage = /settings\.html(?:$|[?#])/i.test(location.href);
    const host = document.createElement("label");
    host.className = `jah-theme-control ${isSettingsPage ? "with-accent" : "mode-only"}`;
    host.id = "jah-theme-control";
    const label = document.createElement("span");
    label.textContent = "Theme";
    const select = document.createElement("select");
    select.id = "jah-theme-accent";
    select.setAttribute("aria-label", "Theme color");
    for (const [value, label] of THEMES) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      select.append(option);
    }
    const modeButton = document.createElement("button");
    modeButton.id = "jah-theme-mode";
    modeButton.type = "button";
    modeButton.className = "jah-mode-toggle";
    modeButton.setAttribute("aria-label", "Toggle dark mode");
    if (isSettingsPage) {
      host.append(label);
      host.append(select);
    }
    host.append(modeButton);
    const target = document.querySelector(".top-actions") || document.querySelector("header") || document.querySelector(".topbar") || document.querySelector("main");
    if (target) target.append(host);
    select.addEventListener("change", () => saveTheme({ accent: select.value, mode: document.documentElement.dataset.jahMode || "light" }));
    modeButton.addEventListener("click", () => {
      const current = document.documentElement.dataset.jahMode === "dark" ? "dark" : "light";
      saveTheme({ mode: current === "dark" ? "light" : "dark" });
    });
    const theme = await readTheme();
    applyAccent(theme.accent);
    applyMode(theme.mode);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", createPicker, { once: true });
  } else {
    createPicker();
  }

  chrome.storage?.onChanged?.addListener?.((changes, areaName) => {
    if (areaName !== "local") return;
    if (changes.jahAccentTheme) applyAccent(changes.jahAccentTheme.newValue);
    if (changes.jahThemeMode) applyMode(changes.jahThemeMode.newValue);
    else if (changes.resumeTailorTheme) applyMode(changes.resumeTailorTheme.newValue);
    if (changes.jahUxMode) applyUxMode(changes.jahUxMode.newValue);
  });
})();
