"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import {
  deleteRecord,
  exportRecords,
  importRecords,
  listRecords,
  recordTypeLabels,
  type RecordType,
  type SavedRecord,
} from "./records";

const filters: Array<{ key: "all" | RecordType; label: string }> = [
  { key: "all", label: "Todos" },
  { key: "quote", label: "Cotações" },
  { key: "soil_analysis", label: "Solo" },
  { key: "spray_recommendation", label: "Pulverizações" },
  { key: "fertilizer_comparison", label: "Fertilizantes" },
  { key: "field_analysis", label: "Talhões" },
  { key: "photo_diagnosis", label: "Diagnósticos" },
  { key: "season_report", label: "Safras" },
  { key: "calculator", label: "Calculadoras" },
  { key: "crm_import", label: "CRM" },
  { key: "producer_change", label: "Produtores" },
  { key: "land_registry", label: "Matrículas" },
  { key: "system_change", label: "Sistema" },
];

function dateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Data não informada"
    : date.toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

export default function RecordsArchive() {
  const [records, setRecords] = useState<SavedRecord[]>([]);
  const [filter, setFilter] = useState<"all" | RecordType>("all");
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("");

  async function refresh() {
    setStatus("loading");
    try {
      setRecords(await listRecords());
      setStatus("ready");
      setMessage("");
    } catch (error) {
      setStatus("error");
      setMessage(
        error instanceof Error ? error.message : "Não foi possível abrir o histórico.",
      );
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function makeBackup() {
    try {
      const content = await exportRecords();
      const blob = new Blob([content], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `manual-do-agronomo-backup-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setMessage("Backup gerado com os registros sincronizados e o cache local deste usuário.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível gerar o backup.");
    }
  }

  async function restoreBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const imported = await importRecords(await file.text());
      setMessage(`${imported} registros e os cadastros locais foram restaurados. Recarregue o app para atualizar todas as telas.`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível restaurar o backup.");
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Excluir este registro da conta e de todos os dispositivos sincronizados?")) return;
    try {
      await deleteRecord(id);
      await refresh();
      setMessage("Registro excluído da conta.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível excluir o registro.");
    }
  }

  const visible = useMemo(
    () => records.filter((record) => filter === "all" || record.type === filter),
    [filter, records],
  );

  return (
    <section className="content-panel records-archive">
      <div className="panel-title">
        <div>
          <span className="eyebrow">ARQUIVO DA CONTA</span>
          <h2>Histórico técnico, cadastral e comercial</h2>
        </div>
        <div className="records-backup-actions">
          <button className="button secondary small" onClick={() => void makeBackup()}>Exportar backup</button>
          <label className="button secondary small file-button">Restaurar backup<input type="file" accept=".json,application/json" onChange={(event) => void restoreBackup(event)} /></label>
          <button className="button secondary small" onClick={() => void refresh()}>Atualizar</button>
        </div>
      </div>
      <p className="records-intro">
        Os registros são sincronizados no PostgreSQL desta conta e mantêm uma cópia local para consulta quando a conexão estiver indisponível.
        O backup continua disponível para portabilidade e conferência.
      </p>
      {message && <p className="crm-message">{message}</p>}
      <div className="records-filter">
        {filters.map((item) => (
          <button
            key={item.key}
            className={filter === item.key ? "active" : ""}
            onClick={() => setFilter(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {status === "loading" && <div className="records-empty">Consultando registros…</div>}
      {status === "error" && (
        <div className="records-empty error">
          <strong>Arquivo local temporariamente indisponível</strong>
          <p>{message}</p>
        </div>
      )}
      {status === "ready" && !visible.length && (
        <div className="records-empty">
          Nenhum registro salvo nesta categoria.
        </div>
      )}
      <div className="records-grid">
        {visible.map((record) => (
          <details key={record.id} className="record-card">
            <summary>
              <span>
                <small>{recordTypeLabels[record.type]}</small>
                <strong>{record.title || recordTypeLabels[record.type]}</strong>
                <b>{record.producerName || "Sem produtor informado"}</b>
              </span>
              <time>{dateTime(record.updatedAt)}</time>
            </summary>
            <div className="record-detail">
              <pre>{JSON.stringify(record.payload, null, 2)}</pre>
              <button className="button secondary small" onClick={() => void remove(record.id)}>Excluir da conta</button>
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}
