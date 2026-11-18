import React from "react";
import { AlertTriangle, CheckCircle2, RefreshCw, X, XCircle } from "lucide-react";
import type { EnvironmentReport, LanguageCode } from "@shared/types";
import { t } from "../i18n";

interface EnvironmentModalProps {
  lang: LanguageCode;
  report: EnvironmentReport | null;
  onRefresh: () => void;
  onClose: () => void;
}

export const EnvironmentModal: React.FC<EnvironmentModalProps> = ({
  lang,
  report,
  onRefresh,
  onClose
}) => {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2 style={{ margin: 0, fontSize: 19 }}>
              {t(lang, "本地多开环境检测", "Environment Readiness")}
            </h2>
            <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "var(--text-muted)" }}>
              {t(
                lang,
                "检查 Antigravity、Codex 客户端安装路径及隔离目录读写权限。",
                "Inspect Antigravity, Codex binaries, and profile directory permissions."
              )}
            </p>
          </div>
          <button className="icon-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
          <div className="running-list">
            {(report?.checks ?? []).map((item) => (
              <div key={item.id} className="running-row" style={{ alignItems: "flex-start" }}>
                <div style={{ display: "flex", gap: 10 }}>
                  <div style={{ paddingTop: 2 }}>
                    {item.status === "pass" ? (
                      <CheckCircle2 size={18} color="var(--success)" />
                    ) : item.status === "warn" ? (
                      <AlertTriangle size={18} color="var(--warning)" />
                    ) : (
                      <XCircle size={18} color="var(--danger)" />
                    )}
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13.5, display: "flex", gap: 8 }}>
                      <span>{item.label}</span>
                      {item.engine !== "system" && (
                        <span className={`engine-badge ${item.engine}`}>{item.engine}</span>
                      )}
                    </div>
                    <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginTop: 3 }}>
                      {item.detail}
                    </div>
                    {item.path && (
                      <div className="mono-text" style={{ marginTop: 4 }}>
                        {item.path}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={onRefresh}>
            <RefreshCw size={14} />
            <span>{t(lang, "重新扫描", "Rescan")}</span>
          </button>
          <button className="btn btn-primary" onClick={onClose}>
            {t(lang, "关闭", "Close")}
          </button>
        </div>
      </div>
    </div>
  );
};
