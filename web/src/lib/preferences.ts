const KEY = "ns.preferences";

export interface Preferences {
  autoDraft: boolean;
  rules: string;
}

export function readPreferences(): Preferences {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return {
      autoDraft: saved?.autoDraft !== false,
      rules: typeof saved?.rules === "string" ? saved.rules : "",
    };
  } catch {
    return { autoDraft: true, rules: "" };
  }
}

export function savePreferences(preferences: Preferences) {
  localStorage.setItem(KEY, JSON.stringify(preferences));
}

export function wordCount(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).length;
}
