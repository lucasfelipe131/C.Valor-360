"use client";

import { ChangeEvent, useMemo, useState } from "react";
import FieldMap, { type MapPoint } from "./FieldMap";
import { saveRecord } from "./records";

export type LandRegistration = {
  id: string;
  number: string;
  cns: string;
  registryOffice: string;
  propertyName: string;
  ownerName: string;
  municipality: string;
  areaHa: number;
  status: "active" | "pending" | "divergent";
  notes: string;
  documentName: string;
  documentUpdatedAt: string;
  points: MapPoint[];
};

export type RegistryField = {
  id: string;
  name: string;
  area: number;
  crop: string;
  points: MapPoint[];
  registrationId?: string;
};

type Props = {
  producerName: string;
  registrations: LandRegistration[];
  fields: RegistryField[];
  onRegistrationsChange: (items: LandRegistration[]) => void;
  onFieldsChange: (items: RegistryField[]) => void;
};

function emptyRegistration(): LandRegistration {
  return {
    id: "",
    number: "",
    cns: "",
    registryOffice: "",
    propertyName: "",
    ownerName: "",
    municipality: "",
    areaHa: 0,
    status: "active",
    notes: "",
    documentName: "",
    documentUpdatedAt: "",
    points: [],
  };
}

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function polygonArea(points: MapPoint[]) {
  if (points.length < 3) return 0;
  const meanLat = points.reduce((sum, point) => sum + point.lat, 0) / points.length;
  const xFactor = 111320 * Math.cos((meanLat * Math.PI) / 180);
  const yFactor = 110540;
  let twiceArea = 0;
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length];
    twiceArea +=
      point.lng * xFactor * next.lat * yFactor -
      next.lng * xFactor * point.lat * yFactor;
  });
  return Math.abs(twiceArea) / 2 / 10000;
}

function pointInside(point: MapPoint, polygon: MapPoint[]) {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current++) {
    const a = polygon[current];
    const b = polygon[previous];
    const intersects =
      a.lat > point.lat !== b.lat > point.lat &&
      point.lng <
        ((b.lng - a.lng) * (point.lat - a.lat)) / (b.lat - a.lat || Number.EPSILON) +
          a.lng;
    if (intersects) inside = !inside;
  }
  return inside;
}

function formatArea(value: number) {
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function difference(reference: number, actual: number) {
  if (!reference && !actual) return 0;
  return Number((actual - reference).toFixed(2));
}

export default function ProducerLandRegistry({
  producerName,
  registrations,
  fields,
  onRegistrationsChange,
  onFieldsChange,
}: Props) {
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<LandRegistration>(emptyRegistration());
  const [editing, setEditing] = useState(false);
  const [activeId, setActiveId] = useState(registrations[0]?.id ?? "");
  const [message, setMessage] = useState("");

  const visible = useMemo(() => {
    const term = normalize(search);
    if (!term) return registrations;
    return registrations.filter((item) =>
      normalize(
        `${item.number} ${item.cns} ${item.registryOffice} ${item.propertyName} ${item.ownerName} ${item.municipality} ${item.documentName}`,
      ).includes(term),
    );
  }, [registrations, search]);

  const active = registrations.find((item) => item.id === activeId) ?? visible[0];
  const registeredTotal = registrations.reduce((sum, item) => sum + Math.max(0, item.areaHa), 0);
  const mappedTotal = fields.reduce((sum, field) => sum + Math.max(0, field.area), 0);

  function updateRegistration(item: LandRegistration) {
    onRegistrationsChange(
      registrations.map((registration) =>
        registration.id === item.id ? item : registration,
      ),
    );
  }

  async function saveDraft() {
    if (!draft.number.trim() && !draft.propertyName.trim()) {
      setMessage("Informe ao menos o número da matrícula ou o nome do imóvel.");
      return;
    }
    const item: LandRegistration = {
      ...draft,
      id: draft.id || crypto.randomUUID(),
      number: draft.number.trim(),
      areaHa: Math.max(0, Number(draft.areaHa) || 0),
    };
    const next = draft.id
      ? registrations.map((registration) =>
          registration.id === draft.id ? item : registration,
        )
      : [item, ...registrations];
    onRegistrationsChange(next);
    setActiveId(item.id);
    setDraft(emptyRegistration());
    setEditing(false);
    setMessage("Matrícula salva; o cadastro e o croqui serão sincronizados com a conta.");
    await saveRecord({
      type: "land_registry",
      title: `Matrícula ${item.number || item.propertyName}`,
      producerName,
      payload: {
        registration: item,
        linkedFieldIds: fields
          .filter((field) => field.registrationId === item.id)
          .map((field) => field.id),
        savedAt: new Date().toISOString(),
      },
    }).catch(() => undefined);
  }

  function chooseDocument(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setDraft((current) => ({
      ...current,
      documentName: file.name.slice(0, 180),
      documentUpdatedAt: new Date(file.lastModified || Date.now()).toISOString(),
    }));
  }

  function linkField(fieldId: string, registrationId: string) {
    onFieldsChange(
      fields.map((field) =>
        field.id === fieldId
          ? { ...field, registrationId: registrationId || undefined }
          : field,
      ),
    );
  }

  const linkedFields = active
    ? fields.filter((field) => field.registrationId === active.id)
    : [];
  const linkedArea = linkedFields.reduce((sum, field) => sum + Math.max(0, field.area), 0);
  const sketchArea = active ? polygonArea(active.points) : 0;
  const outsideFields = active?.points.length
    ? linkedFields.filter(
        (field) =>
          field.points.length >= 3 &&
          field.points.some((point) => !pointInside(point, active.points)),
      )
    : [];
  const activeDifference = active ? difference(active.areaHa, linkedArea) : 0;

  return (
    <section className="land-registry-manager">
      <div className="land-registry-heading">
        <div>
          <span className="eyebrow">CADASTRO FUNDIÁRIO SINCRONIZADO</span>
          <h3>Matrículas, croquis e áreas vinculadas</h3>
          <p>
            Busca interna por matrícula, imóvel, proprietário, município e CNS/cartório.
          </p>
        </div>
        <button
          className="button secondary"
          type="button"
          onClick={() => {
            setDraft(emptyRegistration());
            setEditing(true);
            setMessage("");
          }}
        >
          Nova matrícula
        </button>
      </div>

      <div className="registry-summary-grid">
        <span><b>{registrations.length}</b>Matrículas</span>
        <span><b>{formatArea(registeredTotal)} ha</b>Área registral</span>
        <span><b>{formatArea(mappedTotal)} ha</b>Áreas mapeadas</span>
        <span className={Math.abs(mappedTotal - registeredTotal) > 0.1 ? "warning" : "ok"}>
          <b>{formatArea(mappedTotal - registeredTotal)} ha</b>Diferença total
        </span>
      </div>

      <label className="registry-search">
        <span>Buscar matrículas</span>
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Número, imóvel, proprietário, município ou cartório"
        />
      </label>

      {editing && (
        <div className="registry-form">
          <div className="registry-form-grid">
            <label><span>Número da matrícula</span><input value={draft.number} onChange={(event) => setDraft({ ...draft, number: event.target.value })} /></label>
            <label><span>CNS do cartório</span><input value={draft.cns} onChange={(event) => setDraft({ ...draft, cns: event.target.value })} /></label>
            <label><span>Cartório</span><input value={draft.registryOffice} onChange={(event) => setDraft({ ...draft, registryOffice: event.target.value })} /></label>
            <label><span>Imóvel rural</span><input value={draft.propertyName} onChange={(event) => setDraft({ ...draft, propertyName: event.target.value })} /></label>
            <label><span>Proprietário constante</span><input value={draft.ownerName} onChange={(event) => setDraft({ ...draft, ownerName: event.target.value })} /></label>
            <label><span>Município/UF</span><input value={draft.municipality} onChange={(event) => setDraft({ ...draft, municipality: event.target.value })} /></label>
            <label><span>Área registral (ha)</span><input type="number" min="0" step="0.01" value={draft.areaHa || ""} onChange={(event) => setDraft({ ...draft, areaHa: Number(event.target.value) })} /></label>
            <label><span>Situação cadastral</span><select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as LandRegistration["status"] })}><option value="active">Conferida</option><option value="pending">Pendente</option><option value="divergent">Com divergência</option></select></label>
            <label className="registry-notes"><span>Observações</span><textarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} rows={3} /></label>
          </div>
          <div className="registry-document-row">
            <label className="button secondary file-button">
              Registrar PDF/imagem de referência
              <input type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/*" onChange={chooseDocument} />
            </label>
            <small>{draft.documentName || "O PDF/imagem permanece no aparelho; os dados da matrícula e o croqui ficam sincronizados."}</small>
          </div>
          <div className="registry-form-actions">
            <button className="button secondary" type="button" onClick={() => { setEditing(false); setDraft(emptyRegistration()); }}>Cancelar</button>
            <button className="button primary" type="button" onClick={() => void saveDraft()}>Salvar matrícula</button>
          </div>
        </div>
      )}

      {message && <p className="crm-message">{message}</p>}

      <div className="registry-layout">
        <div className="registry-list">
          {visible.map((item) => (
            <button
              type="button"
              key={item.id}
              className={active?.id === item.id ? "active" : ""}
              onClick={() => setActiveId(item.id)}
            >
              <span><strong>{item.number || "Sem número"}</strong><small>{item.propertyName || "Imóvel não informado"}</small></span>
              <b>{formatArea(item.areaHa)} ha</b>
            </button>
          ))}
          {!visible.length && <p>Nenhuma matrícula encontrada nesta busca.</p>}
        </div>

        {active && (
          <div className="registry-detail">
            <div className="registry-detail-head">
              <div>
                <span className="eyebrow">MATRÍCULA {active.number || "SEM NÚMERO"}</span>
                <h4>{active.propertyName || producerName}</h4>
                <p>{active.ownerName || "Proprietário não informado"} · {active.municipality || "Município não informado"}</p>
              </div>
              <button className="button secondary small" type="button" onClick={() => { setDraft(active); setEditing(true); }}>Editar dados</button>
            </div>

            <div className="registry-cross-grid">
              <span><b>{formatArea(active.areaHa)} ha</b>Matrícula</span>
              <span><b>{formatArea(sketchArea)} ha</b>Croqui</span>
              <span><b>{formatArea(linkedArea)} ha</b>Talhões vinculados</span>
              <span className={Math.abs(activeDifference) > Math.max(0.1, active.areaHa * 0.02) ? "warning" : "ok"}><b>{formatArea(activeDifference)} ha</b>Diferença talhões × matrícula</span>
            </div>

            <FieldMap
              points={active.points}
              onChange={(points) => updateRegistration({ ...active, points })}
              referencePolygons={linkedFields.map((field) => ({
                id: field.id,
                label: field.name,
                points: field.points,
                color: "#3b82f6",
                fillColor: "#60a5fa",
              }))}
            />
            <small className="registry-map-note">Toque no mapa para desenhar o perímetro de referência da matrícula. O croqui não substitui levantamento georreferenciado ou certidão oficial.</small>

            <div className="registry-alerts">
              {active.points.length < 3 && <p className="warning">Croqui da matrícula ainda não desenhado.</p>}
              {!linkedFields.length && <p className="warning">Nenhum talhão está vinculado a esta matrícula.</p>}
              {outsideFields.length > 0 && <p className="danger">{outsideFields.length} talhão(ões) possuem vértices fora do perímetro desenhado.</p>}
              {active.points.length >= 3 && linkedFields.length > 0 && !outsideFields.length && <p className="ok">Os talhões vinculados estão contidos no croqui cadastrado.</p>}
            </div>
          </div>
        )}
      </div>

      <div className="registry-field-links">
        <div><span className="eyebrow">CRUZAMENTO</span><h4>Vincular áreas mapeadas às matrículas</h4></div>
        {fields.length ? fields.map((field) => (
          <label key={field.id}>
            <span><strong>{field.name}</strong><small>{formatArea(field.area)} ha · {field.crop}</small></span>
            <select value={field.registrationId ?? ""} onChange={(event) => linkField(field.id, event.target.value)}>
              <option value="">Sem matrícula vinculada</option>
              {registrations.map((registration) => <option key={registration.id} value={registration.id}>{registration.number || registration.propertyName}</option>)}
            </select>
          </label>
        )) : <p>Mapeie um talhão para iniciar o cruzamento.</p>}
      </div>

      <p className="registry-legal-note">
        A pesquisa é interna e usa somente os dados inseridos no aparelho. Validação jurídica, cadeia dominial e emissão de certidão devem ser feitas no cartório ou serviço oficial autorizado.
      </p>
    </section>
  );
}
