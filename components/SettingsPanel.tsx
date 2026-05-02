"use client";

import { useState, useEffect } from "react";
import type { ClaudeModel } from "@/lib/claude";

interface Settings {
  model: ClaudeModel;
  sessionToken: string;
  preferUpload?: boolean;
}

interface Props {
  onSave: (settings: Settings) => void;
}

const STORAGE_KEY = "3mint_settings";

export function useSettings() {
  const [settings, setSettings] = useState<Settings>({
    model: "claude-sonnet-4-6",
    sessionToken: "",
    preferUpload: false,
  });

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setSettings(JSON.parse(raw));
    } catch { /* ignore */ }
  }, []);

  const save = (s: Settings) => {
    setSettings(s);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* ignore */ }
  };

  return { settings, save };
}

export function SettingsPanel({ onSave }: Props) {
  const { settings, save } = useSettings();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Settings>(settings);
  const [showToken, setShowToken] = useState(false);

  // Keep draft in sync when settings load from localStorage
  useEffect(() => { setDraft(settings); }, [settings]);

  const handleSave = () => {
    save(draft);
    onSave(draft);
    setOpen(false);
  };

  return (
    <>
      <button className="btn-settings" onClick={() => setOpen(true)} title="Settings">
        ⚙
      </button>

      {open && (
        <div className="modal-overlay" onClick={() => setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span>Settings</span>
              <button className="modal-close" onClick={() => setOpen(false)}>✕</button>
            </div>

            <div className="modal-body">
              {/* Model selector */}
              <div className="setting-group">
                <label className="setting-label">Claude model</label>
                <div className="model-toggle">
                  {(["claude-sonnet-4-6", "claude-opus-4-7"] as ClaudeModel[]).map((m) => (
                    <button
                      key={m}
                      className={`model-btn ${draft.model === m ? "active" : ""}`}
                      onClick={() => setDraft((d) => ({ ...d, model: m }))}
                    >
                      <span className="model-name">
                        {m === "claude-sonnet-4-6" ? "Sonnet 4.6" : "Opus 4.7"}
                      </span>
                      <span className="model-cost">
                        {m === "claude-sonnet-4-6"
                          ? "$3/$15 · ~$3/day"
                          : "$5/$25 · ~$8/day"}
                      </span>
                    </button>
                  ))}
                </div>
                <div className="setting-hint">
                  Sonnet 4.6 recommended — equivalent strategy accuracy at 40% lower cost.
                  Prompt caching is active on both models.
                </div>
              </div>

              {/* Session token */}
              <div className="setting-group">
                <label className="setting-label">
                  Breeze session token
                  <span className="setting-badge">daily refresh</span>
                </label>
                <div className="token-input-wrap">
                  <input
                    type={showToken ? "text" : "password"}
                    className="token-input"
                    value={draft.sessionToken}
                    onChange={(e) => setDraft((d) => ({ ...d, sessionToken: e.target.value }))}
                    placeholder="Paste today's apisession token…"
                    spellCheck={false}
                    autoComplete="off"
                  />
                  <button
                    className="token-toggle"
                    onClick={() => setShowToken((v) => !v)}
                    type="button"
                  >
                    {showToken ? "hide" : "show"}
                  </button>
                </div>
                <div className="setting-hint">
                  Generate daily at:{" "}
                  <code>api.icicidirect.com/apiuser/login?api_key=YOUR_KEY</code>
                  <br />
                  After login, copy the <code>apisession</code> value from the redirect URL.
                  Stored only in browser localStorage.
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn-cancel" onClick={() => setOpen(false)}>Cancel</button>
              <button className="btn-primary" onClick={handleSave}>Save &amp; apply</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
