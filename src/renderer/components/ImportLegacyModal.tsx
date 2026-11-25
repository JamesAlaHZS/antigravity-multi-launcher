import React, { useState } from "react";
import { Download, X } from "lucide-react";
import type { LanguageCode, LegacyCodexProfileCandidate } from "@shared/types";
import { normalizeProfileName } from "@shared/profile-utils";
import { AUTH_MODE_LABELS, t } from "../i18n";

interface ImportLegacyModalProps {
  lang: LanguageCode;
  candidates: LegacyCodexProfileCandidate[];
  onImport: (ids: string[]) => Promise<void>;
  onClose: () => void;
}

export const ImportLegacyModal: React.FC<ImportLegacyModalProps> = ({
  lang,
  candidates,
  onImport,
  onClose
}) => {
  const defaultChecked = candidates.filter(
    (c) => !c.alreadyImported && c.legacyStatus === "active"
  );
  const [selected, setSelected] = useState<Set<string>>(
    new Set(defaultChecked.map((c) => c.id))
  );
  const [busy, setBusy] = useState(false);

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2 style={{ margin: 0, fontSize: 19 }}>
              {t(lang, "导入已有 Codex Profile Manager 配置", "Import Existing Codex Profiles")}
            </h2>
            <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "var(--text-muted)" }}>
              {t(
                lang,
                "无损纳管已有 Codex 多开配置与登录状态，导入后还可在配置详情页一键迁移数据目录到 F 盘以释放 C 盘空间。",
                "Import profiles non-destructively; once imported, you can migrate their storage to another drive in one click."
              )}
            </p>
          </div>
          <button className="icon-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
          <div className="running-list">
            {candidates.map((item) => (
              <label
                key={item.id}
                className="running-row"
                style={{
                  cursor: item.alreadyImported ? "default" : "pointer",
                  opacity: item.alreadyImported ? 0.6 : 1
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <input
                    type="checkbox"
                    disabled={item.alreadyImported}
                    checked={item.alreadyImported || selected.has(item.id)}
                    onChange={() => toggle(item.id)}
                  />
                  <div>
                    <div
                      style={{
                        fontWeight: 700,
                        fontSize: 13.5,
                        display: "flex",
                        alignItems: "center",
                        gap: 8
                      }}
                    >
                      <span>
                        {normalizeProfileName(item.name, "codex")} ({item.id})
                      </span>
                      {item.legacyStatus === "deleted" && (
                        <span className="status-chip warn">
                          {t(lang, "旧工具已归档", "Archived")}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      {AUTH_MODE_LABELS[lang][item.authMode]} · {item.model}
                    </div>
                    <div className="mono-text">{item.codexHome}</div>
                  </div>
                </div>
                {item.alreadyImported && (
                  <span className="status-chip pass">{t(lang, "已导入", "Imported")}</span>
                )}
              </label>
            ))}
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={onClose}>
            {t(lang, "取消", "Cancel")}
          </button>
          <button
            className="btn btn-primary"
            disabled={busy || selected.size === 0}
            onClick={async () => {
              setBusy(true);
              try {
                await onImport(Array.from(selected));
                onClose();
              } finally {
                setBusy(false);
              }
            }}
          >
            <Download size={14} />
            <span>
              {t(lang, `导入选中 (${selected.size})`, `Import Selected (${selected.size})`)}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
