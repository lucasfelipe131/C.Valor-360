"use client";

import { useMemo, useState } from "react";
import fertilizerData from "./fertilizer-formulas.json";
import {
  calculateNutrientRemoval,
  NUTRIENT_PROFILES,
} from "../../src/lib/agronomic-calculators.js";

type Nutrient = "N" | "P2O5" | "K2O" | "S";
type Crop = "Soja" | "Milho" | "Trigo" | "Canola";
type Basis = "extraction" | "export";

type Formula = {
  id: string;
  name: string;
  maker: string;
  category: string;
  nutrients: Record<string, number>;
};

type SoilAnalysisInput = {
  id: string;
  sampleCode?: string;
  property?: string;
  producerId?: string;
  targetCrop?: string;
  savedAt?: string;
  values?: Partial<Record<"ph" | "organicMatter" | "phosphorus" | "potassium" | "sulfur", string>>;
};

type ProducerInput = { id: string; name: string };

const nutrientLabels: Record<Nutrient, string> = { N: "N", P2O5: "P₂O₅", K2O: "K₂O", S: "S" };

function format(value: number, digits = 1) {
  return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Number.isFinite(value) ? value : 0);
}

function currency(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number.isFinite(value) ? value : 0);
}

export default function NutrientRemovalCalculator({
  analyses = [],
  producers = [],
}: {
  analyses?: SoilAnalysisInput[];
  producers?: ProducerInput[];
}) {
  const formulas = fertilizerData as Formula[];
  const [crop, setCrop] = useState<Crop>("Soja");
  const [yieldValue, setYieldValue] = useState(70);
  const [yieldUnit, setYieldUnit] = useState<"sc/ha" | "kg/ha" | "t/ha">("sc/ha");
  const [basis, setBasis] = useState<Basis>("export");
  const [targetNutrient, setTargetNutrient] = useState<Nutrient>("P2O5");
  const [credits, setCredits] = useState<Record<Nutrient, number>>({ N: 0, P2O5: 0, K2O: 0, S: 0 });
  const [efficiencies, setEfficiencies] = useState<Record<Nutrient, number>>({ N: 70, P2O5: 85, K2O: 90, S: 80 });
  const [selectedIds, setSelectedIds] = useState<string[]>(() => {
    const preferred = ["04-28-08", "05-20-20", "02-20-20", "KCL"];
    return preferred.map((term) => formulas.find((item) => item.id === term || item.name.includes(term))?.id).filter(Boolean) as string[];
  });
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [search, setSearch] = useState("");
  const [selectedAnalysisId, setSelectedAnalysisId] = useState(analyses[0]?.id ?? "");
  const [analysisMessage, setAnalysisMessage] = useState("");
  const [soilAdjustments, setSoilAdjustments] = useState<Record<Nutrient, number>>({ N: 0, P2O5: 0, K2O: 0, S: 0 });

  const nutrientCalculation = useMemo(() => calculateNutrientRemoval({
    crop,
    yieldValue,
    yieldUnit,
    basis,
    credits,
    efficiencies,
    soilAdjustments,
  }), [basis, credits, crop, efficiencies, soilAdjustments, yieldUnit, yieldValue]);
  const profile = nutrientCalculation.profile;
  const yieldTon = nutrientCalculation.yieldTon;
  const demand = nutrientCalculation.demand as Record<Nutrient, number>;
  const fertilizerTargets = nutrientCalculation.fertilizerTargets as Record<Nutrient, number>;

  const selected = selectedIds.map((id) => formulas.find((item) => item.id === id)).filter(Boolean) as Formula[];
  const options = formulas.filter((item) => !selectedIds.includes(item.id) && `${item.name} ${item.maker}`.toLowerCase().includes(search.toLowerCase())).slice(0, 8);

  const selectedAnalysis = analyses.find((item) => item.id === selectedAnalysisId);
  const producerNameFor = (producerId?: string) =>
    producers.find((item) => item.id === producerId)?.name ?? "Produtor não vinculado";

  function soilNumber(value: unknown) {
    const parsed = Number(String(value ?? "").replace(",", "."));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function applySoilAnalysis() {
    if (!selectedAnalysis) {
      setAnalysisMessage("Selecione uma análise salva.");
      return;
    }
    const nextCrop = (["Soja", "Milho", "Trigo", "Canola"].includes(selectedAnalysis.targetCrop ?? "")
      ? selectedAnalysis.targetCrop
      : crop) as Crop;
    const values = selectedAnalysis.values ?? {};
    const phosphorus = soilNumber(values.phosphorus);
    const potassium = soilNumber(values.potassium);
    const sulfur = soilNumber(values.sulfur);
    const organicMatter = soilNumber(values.organicMatter);
    const adjustments: Record<Nutrient, number> = {
      N: nextCrop === "Soja" || !organicMatter ? 0 : organicMatter < 2 ? 30 : organicMatter < 3 ? 15 : 0,
      P2O5: !phosphorus ? 0 : phosphorus < 6 ? 60 : phosphorus < 12 ? 40 : phosphorus < 20 ? 20 : 0,
      K2O: !potassium ? 0 : potassium < 60 ? 60 : potassium < 90 ? 35 : potassium < 120 ? 15 : 0,
      S: !sulfur ? 0 : sulfur < 5 ? 20 : sulfur < 10 ? 10 : 0,
    };
    setCrop(nextCrop);
    setSoilAdjustments(adjustments);
    setAnalysisMessage("Análise aplicada. Os ajustes aparecem nos cartões e as fórmulas foram reclassificadas.");
  }

  const suggestions = useMemo(() => {
    const nutrients = ["N", "P2O5", "K2O", "S"] as Nutrient[];
    return formulas.map((formula) => {
      const guarantee = Number(formula.nutrients[targetNutrient]) || 0;
      if (guarantee <= 0 || fertilizerTargets[targetNutrient] <= 0) return { formula, score: Number.POSITIVE_INFINITY };
      const dose = fertilizerTargets[targetNutrient] * 100 / guarantee;
      const score = nutrients.reduce((total, key) => {
        const target = fertilizerTargets[key];
        if (target <= 0) return total;
        const supplied = dose * (Number(formula.nutrients[key]) || 0) / 100;
        const relativeGap = Math.abs(supplied - target) / Math.max(target, 1);
        return total + relativeGap + (supplied < target ? 0.35 : 0);
      }, 0);
      return { formula, score };
    }).filter((item) => Number.isFinite(item.score)).sort((a, b) => a.score - b.score).slice(0, 6);
  }, [fertilizerTargets, formulas, targetNutrient]);
  function toggle(id: string) {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id].slice(-4));
    setSearch("");
  }

  function metrics(formula: Formula) {
    const guarantee = Number(formula.nutrients[targetNutrient]) || 0;
    const dose = guarantee > 0 ? (fertilizerTargets[targetNutrient] * 100) / guarantee : 0;
    const supplied = Object.fromEntries((["N", "P2O5", "K2O", "S"] as Nutrient[]).map((key) => [key, dose * (Number(formula.nutrients[key]) || 0) / 100])) as Record<Nutrient, number>;
    const price = prices[formula.id] || 0;
    const cost = dose * price / 1000;
    const equivalentDoses = Object.fromEntries((["N", "P2O5", "K2O", "S"] as Nutrient[]).map((key) => {
      const nutrient = Number(formula.nutrients[key]) || 0;
      return [key, nutrient > 0 ? fertilizerTargets[key] * 100 / nutrient : 0];
    })) as Record<Nutrient, number>;
    return { dose, supplied, price, cost, equivalentDoses };
  }

  return (
    <div className="nutrient-removal-module">
      <section className="content-panel nutrient-setup">
        <div className="calc-title"><span className="calc-card-icon">NPK</span><div><span className="eyebrow">EXTRAÇÃO E EXPORTAÇÃO</span><h2>Necessidade de adubação por produtividade</h2></div></div>
        <div className="soil-analysis-link">
          <label className="field">
            <span>Análise de solo salva</span>
            <div className="input-wrap">
              <select value={selectedAnalysisId} onChange={(event) => { setSelectedAnalysisId(event.target.value); setAnalysisMessage(""); }}>
                <option value="">Selecione uma análise</option>
                {analyses.map((analysis) => (
                  <option key={analysis.id} value={analysis.id}>
                    {producerNameFor(analysis.producerId) + " · " + (analysis.property || analysis.sampleCode || "Amostra")}
                  </option>
                ))}
              </select>
            </div>
          </label>
          <button type="button" className="button primary" onClick={applySoilAnalysis} disabled={!selectedAnalysisId}>Usar análise no cálculo</button>
          <small>{analyses.length ? "Importa os indicadores estruturados; o PDF original não é necessário." : "Salve uma análise na guia Análises de solo para reutilizá-la aqui."}</small>
        </div>
        {analysisMessage && <p className="soil-analysis-message">{analysisMessage}</p>}
        <div className="nutrient-main-fields">
          <label className="field"><span>Cultura</span><div className="input-wrap"><select value={crop} onChange={(event) => setCrop(event.target.value as Crop)}>{Object.keys(NUTRIENT_PROFILES).map((item) => <option key={item}>{item}</option>)}</select></div></label>
          <label className="field"><span>Produtividade esperada</span><div className="input-wrap"><input type="number" min={0} step={0.1} value={yieldValue} onChange={(event) => setYieldValue(Number(event.target.value) || 0)} /><select value={yieldUnit} onChange={(event) => setYieldUnit(event.target.value as typeof yieldUnit)}><option>sc/ha</option><option>kg/ha</option><option>t/ha</option></select></div></label>
          <label className="field"><span>Base do planejamento</span><div className="input-wrap"><select value={basis} onChange={(event) => setBasis(event.target.value as Basis)}><option value="export">Reposição da exportação</option><option value="extraction">Demanda pela extração</option></select></div></label>
          <label className="field"><span>Nutriente-alvo da fórmula</span><div className="input-wrap"><select value={targetNutrient} onChange={(event) => setTargetNutrient(event.target.value as Nutrient)}>{(["N", "P2O5", "K2O", "S"] as Nutrient[]).map((item) => <option value={item} key={item}>{nutrientLabels[item]}</option>)}</select></div></label>
        </div>
        <div className="nutrient-reference"><b>{format(yieldTon, 2)} t/ha</b><span>{profile.source}</span><p>{profile.note}</p></div>
        <div className="nutrient-demand-grid">
          {(["N", "P2O5", "K2O", "S"] as Nutrient[]).map((key) => (
            <article key={key}>
              <header><span>{nutrientLabels[key]}</span><strong>{format(demand[key])} kg/ha</strong></header>
              <small>{format(profile[basis][key], 1)} kg/t × {format(yieldTon, 2)} t/ha{soilAdjustments[key] > 0 ? " + " + format(soilAdjustments[key]) + " kg/ha pelo diagnóstico do solo" : ""}</small>
              <label><span>Crédito solo/palhada</span><input type="number" min={0} step={0.1} value={credits[key]} onChange={(event) => setCredits({ ...credits, [key]: Number(event.target.value) || 0 })} /></label>
              <label><span>Eficiência</span><input type="number" min={1} max={100} step={1} value={efficiencies[key]} onChange={(event) => setEfficiencies({ ...efficiencies, [key]: Number(event.target.value) || 1 })} /><b>%</b></label>
              <footer><span>Meta via fertilizante</span><b>{format(fertilizerTargets[key])} kg/ha</b></footer>
            </article>
          ))}
        </div>
      </section>

      <section className="content-panel nutrient-formulas">
        <div className="comparison-heading"><div><span className="eyebrow">ESCOLHA E COMPARE</span><h2>Fórmulas para atender {nutrientLabels[targetNutrient]}</h2><p>A dose principal iguala o nutriente-alvo; as outras colunas mostram cobertura, déficit ou excesso.</p></div><span className="comparison-limit">{selectedIds.length}/4 selecionadas</span></div>
        {!!suggestions.length && (
          <div className="fertilizer-suggestions">
            <div><span className="eyebrow">MELHOR ENCAIXE CALCULADO</span><p>Ranking pela cobertura conjunta de N, P₂O₅, K₂O e S na dose do nutriente-alvo.</p></div>
            <div>
              {suggestions.map(({ formula }, index) => (
                <button type="button" key={formula.id} onClick={() => toggle(formula.id)}>
                  <b>{index + 1}</b><span>{formula.name}<small>{formula.maker}</small></span>
                </button>
              ))}
            </div>
            <button type="button" className="button secondary" onClick={() => setSelectedIds(suggestions.slice(0, 4).map((item) => item.formula.id))}>Comparar as 4 melhores</button>
          </div>
        )}
        <div className="comparison-add"><label className="search-box"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar fórmula ou fabricante…" /></label>{search && <div className="comparison-search-results">{options.map((formula) => <button key={formula.id} onClick={() => toggle(formula.id)}><span><strong>{formula.name}</strong><small>{formula.maker} · {formula.category}</small></span><b>+</b></button>)}</div>}</div>
        <div className="nutrient-comparison-grid">
          {selected.map((formula) => {
            const result = metrics(formula);
            return (
              <article key={formula.id}>
                <header><div><span>{formula.maker}</span><h3>{formula.name}</h3><small>{formula.category}</small></div><button aria-label={`Remover ${formula.name}`} onClick={() => toggle(formula.id)}>×</button></header>
                <div className="nutrient-dose"><span>Dose para {nutrientLabels[targetNutrient]}</span><strong>{result.dose > 0 ? `${format(result.dose)} kg/ha` : "Não fornece"}</strong></div>
                <label className="field"><span>Preço do fertilizante</span><div className="input-wrap"><b>R$</b><input type="number" min={0} step={10} value={result.price || ""} onChange={(event) => setPrices({ ...prices, [formula.id]: Number(event.target.value) || 0 })} placeholder="0,00" /><b>/t</b></div></label>
                <div className="nutrient-cost"><span>Custo/ha</span><strong>{result.price && result.dose ? currency(result.cost) : "Informe o preço"}</strong></div>
                <div className="coverage-list">
                  {(["N", "P2O5", "K2O", "S"] as Nutrient[]).map((key) => {
                    const balance = result.supplied[key] - fertilizerTargets[key];
                    const coverage = fertilizerTargets[key] > 0 ? result.supplied[key] / fertilizerTargets[key] * 100 : 100;
                    return <div key={key} className={coverage >= 99 ? "covered" : "deficit"}><span><b>{nutrientLabels[key]}</b><small>{format(result.supplied[key])} / {format(fertilizerTargets[key])} kg/ha</small></span><strong>{coverage >= 99 ? `+${format(Math.max(0, balance))}` : format(balance)} kg/ha</strong></div>;
                  })}
                </div>
                <details><summary>Dose equivalente por nutriente</summary>{(["N", "P2O5", "K2O", "S"] as Nutrient[]).map((key) => <span key={key}><b>{nutrientLabels[key]}</b>{result.equivalentDoses[key] > 0 ? `${format(result.equivalentDoses[key])} kg/ha` : "não fornece"}</span>)}</details>
              </article>
            );
          })}
        </div>
        <small className="comparison-disclaimer">Ferramenta de planejamento. A leitura do solo usa faixas de triagem para P, K, S e matéria orgânica; confirme método do laboratório e tabelas regionais, como CQFS-RS/SC, antes da recomendação final. A dose deve considerar expectativa realista de produtividade, cultura anterior, fonte, eficiência e época/modo de aplicação. Evite definir uma mistura apenas pelo maior valor sem avaliar excedentes e limites de aplicação.</small>
      </section>
    </div>
  );
}
