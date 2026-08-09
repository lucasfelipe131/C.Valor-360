"use client";

import { useEffect, useMemo, useState } from "react";

type Municipality = { id: number; nome: string };
type ZarcWindow = { risk: 20 | 30 | 40; decendios: number[]; ranges: string[] };
type ZarcResult = {
  cropLabel: string;
  municipality: string;
  uf: string;
  safra: string;
  soilLabel: string;
  cycleLabel: string;
  management: string;
  portarias: string[];
  windows: ZarcWindow[];
  updatedAt: string;
  sourceUrl: string;
};

const UFS = ["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"];
const stateToUf: Record<string, string> = {
  acre:"AC", alagoas:"AL", amapa:"AP", amazonas:"AM", bahia:"BA", ceara:"CE",
  "distrito federal":"DF", "espirito santo":"ES", goias:"GO", maranhao:"MA",
  "mato grosso":"MT", "mato grosso do sul":"MS", "minas gerais":"MG", para:"PA",
  paraiba:"PB", parana:"PR", pernambuco:"PE", piaui:"PI", "rio de janeiro":"RJ",
  "rio grande do norte":"RN", "rio grande do sul":"RS", rondonia:"RO", roraima:"RR",
  "santa catarina":"SC", "sao paulo":"SP", sergipe:"SE", tocantins:"TO",
};

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

export default function ZarcPlanner() {
  const [uf, setUf] = useState("RS");
  const [municipalities, setMunicipalities] = useState<Municipality[]>([]);
  const [municipality, setMunicipality] = useState("São Luiz Gonzaga");
  const [crop, setCrop] = useState("soja");
  const [soil, setSoil] = useState("13");
  const [cycle, setCycle] = useState("21");
  const [status, setStatus] = useState<"idle"|"loading"|"ready"|"error">("idle");
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<ZarcResult | null>(null);
  const [locating, setLocating] = useState(false);
  const [municipalityStatus, setMunicipalityStatus] = useState<"loading" | "ready" | "cached" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    const cacheKey = "mp-zarc-municipalities-v1-" + uf;
    setMunicipalityStatus("loading");
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const items = JSON.parse(cached) as Municipality[];
        if (Array.isArray(items) && items.length) {
          setMunicipalities(items);
          setMunicipalityStatus("cached");
        }
      }
    } catch {
      localStorage.removeItem(cacheKey);
    }
    fetch("/api/municipalities?uf=" + encodeURIComponent(uf))
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Municípios indisponíveis")))
      .then((data: { municipalities?: Municipality[] }) => {
        if (cancelled) return;
        const items = Array.isArray(data.municipalities) ? data.municipalities : [];
        setMunicipalities(items);
        setMunicipalityStatus("ready");
        localStorage.setItem(cacheKey, JSON.stringify(items));
      })
      .catch(() => {
        if (!cancelled) setMunicipalityStatus((current) => current === "cached" ? "cached" : "error");
      });
    return () => { cancelled = true; };
  }, [uf]);

  const soilLabel = useMemo(() => ({
    "1":"Arenoso (Tipo 1)", "2":"Textura média (Tipo 2)", "3":"Argiloso (Tipo 3)",
    "11":"AD1", "12":"AD2", "13":"AD3", "14":"AD4", "15":"AD5", "16":"AD6",
  }[soil] ?? soil), [soil]);

  async function useLocation() {
    if (!navigator.geolocation) {
      setMessage("Este navegador não oferece localização.");
      return;
    }
    setLocating(true);
    setMessage("");
    navigator.geolocation.getCurrentPosition(async ({ coords }) => {
      try {
        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${coords.latitude.toFixed(6)}&lon=${coords.longitude.toFixed(6)}&accept-language=pt-BR`);
        if (!response.ok) throw new Error("Não foi possível identificar o município.");
        const data = await response.json();
        const address = data.address ?? {};
        const city = address.municipality || address.city || address.town || address.village || address.county;
        const iso = String(address["ISO3166-2-lvl4"] || address["ISO3166-2-lvl6"] || "");
        const nextUf = iso.startsWith("BR-") ? iso.slice(3, 5) : stateToUf[normalize(String(address.state || ""))];
        if (nextUf && UFS.includes(nextUf)) setUf(nextUf);
        if (city) setMunicipality(String(city));
        if (!city || !nextUf) setMessage("Localização obtida. Confira município e UF antes de consultar.");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Não foi possível usar a localização.");
      } finally {
        setLocating(false);
      }
    }, () => {
      setLocating(false);
      setMessage("Localização não autorizada. Selecione o município manualmente.");
    }, { enableHighAccuracy:false, timeout:12000, maximumAge:600000 });
  }

  async function consult() {
    if (!municipality.trim()) {
      setStatus("error");
      setMessage("Selecione um município.");
      return;
    }
    const canonicalMunicipality = municipalities.find(
      (item) => normalize(item.nome) === normalize(municipality),
    );
    if (municipalities.length && !canonicalMunicipality) {
      setStatus("error");
      setMessage("Escolha um município válido da lista do IBGE.");
      return;
    }
    const municipalityName = canonicalMunicipality?.nome ?? municipality.trim();
    setStatus("loading");
    setMessage("Consultando a Tábua de Risco oficial do MAPA…");
    setResult(null);
    try {
      const params = new URLSearchParams({ uf, municipality: municipalityName, crop, soil, cycle });
      const response = await fetch(`/api/zarc?${params.toString()}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Zoneamento indisponível para estes parâmetros.");
      setResult(data as ZarcResult);
      setStatus("ready");
      setMessage("");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Não foi possível consultar o ZARC.");
    }
  }

  return (
    <section className="zarc-panel">
      <div className="zarc-head">
        <div>
          <span className="eyebrow">ZARC · MAPA</span>
          <h2>Janela de semeadura do município</h2>
          <p>Escolha cultura e município. Solo e ciclo ficam em ajustes avançados quando você precisar refinar a consulta.</p>
        </div>
        <button className="button secondary" type="button" onClick={useLocation} disabled={locating}>
          {locating ? "Localizando…" : "Usar minha localização"}
        </button>
      </div>

      <div className="zarc-form-grid">
        <label className="field"><span>Cultura / safra</span><select value={crop} onChange={(event) => { setCrop(event.target.value); setResult(null); }}>
          <option value="soja">Soja</option>
          <option value="milho-verao">Milho verão · 1ª safra</option>
          <option value="milho-safrinha">Milho safrinha · 2ª safra</option>
          <option value="trigo">Trigo</option>
        </select></label>
        <label className="field"><span>UF</span><select value={uf} onChange={(event) => { setUf(event.target.value); setMunicipality(""); }}>{UFS.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label className="field"><span>Município</span><input list="zarc-municipios" value={municipality} onChange={(event) => { setMunicipality(event.target.value); setResult(null); }} placeholder={municipalityStatus === "loading" ? "Carregando municípios…" : "Digite ou selecione"} disabled={municipalityStatus === "loading" && !municipalities.length} /><datalist id="zarc-municipios">{municipalities.map((item) => <option key={item.id} value={item.nome} />)}</datalist><small>{municipalityStatus === "ready" ? municipalities.length + " municípios do IBGE disponíveis nesta UF" : municipalityStatus === "cached" ? municipalities.length + " municípios disponíveis no cache" : municipalityStatus === "error" ? "Lista indisponível; tente novamente." : "Carregando lista oficial…"}</small></label>
      </div>

      <details className="zarc-advanced">
        <summary>Ajustar solo e ciclo</summary>
        <div className="zarc-form-grid">
          <label className="field"><span>Água disponível / tipo de solo</span><select value={soil} onChange={(event) => { setSoil(event.target.value); setResult(null); }}>
            <optgroup label="Classes atuais de água disponível"><option value="11">AD1 · menor retenção</option><option value="12">AD2</option><option value="13">AD3 · intermediária</option><option value="14">AD4</option><option value="15">AD5</option><option value="16">AD6 · maior retenção</option></optgroup>
            <optgroup label="Portarias antigas por textura"><option value="1">Arenoso · Tipo 1</option><option value="2">Textura média · Tipo 2</option><option value="3">Argiloso · Tipo 3</option></optgroup>
          </select><small>Selecionado: {soilLabel}</small></label>
          <label className="field"><span>Ciclo da cultivar</span><select value={cycle} onChange={(event) => { setCycle(event.target.value); setResult(null); }}>
            <option value="20">Grupo I · ciclo mais curto</option><option value="21">Grupo II · ciclo intermediário</option><option value="22">Grupo III · ciclo mais longo</option><option value="24">Grupo IV</option><option value="25">Grupo V</option><option value="26">Grupo VI</option>
          </select><small>Use o grupo informado na portaria ou no cadastro da cultivar.</small></label>
        </div>
      </details>
      <div className="zarc-actions"><button className="button primary" type="button" onClick={consult} disabled={status === "loading"}>{status === "loading" ? "Consultando…" : "Ver janela de semeadura"}</button><small>{soilLabel} · grupo {cycle === "20" ? "I" : cycle === "21" ? "II" : cycle === "22" ? "III" : cycle === "24" ? "IV" : cycle === "25" ? "V" : "VI"} · sequeiro</small></div>
      {message && <div className={status === "error" ? "zarc-message error" : "zarc-message"}>{message}</div>}

      {result && (
        <div className="zarc-results">
          <div className="zarc-summary"><div><span>{result.cropLabel}</span><strong>{result.municipality}/{result.uf}</strong></div><div><span>Safra consultada</span><strong>{result.safra}</strong></div><div><span>Parâmetros</span><strong>{result.soilLabel} · {result.cycleLabel}</strong></div></div>
          <div className="zarc-risk-grid">
            {result.windows.map((window) => <article key={window.risk} className={`zarc-risk risk-${window.risk}`}><span>{window.risk === 20 ? "MELHOR JANELA" : "JANELA AMPLIADA"}</span><h3>Risco {window.risk}%</h3>{window.ranges.length ? <><strong>{window.ranges.join(" · ")}</strong><small>Decêndios {window.decendios.join(", ")}</small></> : <strong>Sem indicação</strong>}</article>)}
          </div>
          <div className="zarc-source"><p><b>Fonte oficial:</b> Tábua de Risco ZARC/MAPA. O risco de 20% é apresentado como prioridade agronômica; 30% e 40% ampliam a janela com menor segurança climática.</p><a href={result.sourceUrl} target="_blank" rel="noreferrer">Abrir dados oficiais do MAPA</a>{result.portarias.length > 0 && <small>Portaria(s): {result.portarias.join(" · ")}</small>}</div>
        </div>
      )}
    </section>
  );
}
