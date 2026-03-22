(() => {
const STORAGE_KEY = "wellness-journal-state-v1";

const DEFAULT_SETTINGS = {
  auto_suggest_threshold: 3,
  auto_suggest_window_days: 14,
  api_key: "",
  setup_complete: false,
  hidden_buttons: [],
};

const DEFAULT_BUTTON_CONFIG = [
  { name: "Dog walk", type: "multi-tap" },
  { name: "Coffee", type: "multi-tap" },
  { name: "Adderall", type: "multi-tap" },
  { name: "Cannabis", type: "single-tap" },
  { name: "Alcohol", type: "single-tap" },
  { name: "Exercise", type: "multi-tap" },
  { name: "Laundry", type: "multi-tap" },
  { name: "Made dinner", type: "single-tap" },
  { name: "TV before bed", type: "single-tap" },
  { name: "Reading before bed", type: "single-tap" },
];

function slugify(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function createId(prefix = "id") {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function createDefaultButtons() {
  const now = new Date().toISOString();

  return DEFAULT_BUTTON_CONFIG.map((button) => ({
    id: `default-${slugify(button.name)}`,
    name: button.name,
    type: button.type,
    usage_count: 0,
    auto_added: false,
    date_added: now,
  }));
}

function sanitizeButton(button) {
  if (!button || !button.name) {
    return null;
  }

  return {
    id: button.id || createId("button"),
    name: String(button.name).trim(),
    type: button.type === "single-tap" ? "single-tap" : "multi-tap",
    usage_count: Number.isFinite(button.usage_count) ? button.usage_count : 0,
    auto_added: Boolean(button.auto_added),
    date_added: button.date_added || new Date().toISOString(),
  };
}

function sanitizeState(candidate = {}) {
  const buttons = Array.isArray(candidate.buttons)
    ? candidate.buttons.map(sanitizeButton).filter(Boolean)
    : createDefaultButtons();

  return {
    version: 1,
    entries: Array.isArray(candidate.entries) ? candidate.entries.filter(Boolean) : [],
    buttons: buttons.length ? buttons : createDefaultButtons(),
    settings: {
      ...DEFAULT_SETTINGS,
      ...(candidate.settings || {}),
    },
    cache: {
      answers: {},
      ...(candidate.cache || {}),
    },
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return sanitizeState();
    }

    return sanitizeState(JSON.parse(raw));
  } catch (error) {
    console.error("Failed to load state", error);
    return sanitizeState();
  }
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizeState(state)));
}

function createEntry({ type, data, rawInput = "" }) {
  return {
    id: createId("entry"),
    timestamp: new Date().toISOString(),
    type,
    data,
    raw_input: rawInput,
  };
}

function exportState(state) {
  const sanitized = sanitizeState(state);
  const clone = JSON.parse(JSON.stringify(sanitized));
  clone.settings.api_key = "";
  return JSON.stringify(clone, null, 2);
}

function importState(jsonText, existingApiKey = "") {
  const parsed = JSON.parse(jsonText);
  const sanitized = sanitizeState(parsed);
  sanitized.settings.api_key = existingApiKey;
  return sanitized;
}

function downloadJson(filename, content) {
  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

window.StorageUtils = {
  createDefaultButtons,
  createEntry,
  createId,
  downloadJson,
  exportState,
  importState,
  loadState,
  saveState,
  sanitizeState,
};
})();
