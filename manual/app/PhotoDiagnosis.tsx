"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";

type DiagnosisMode = "nutrition" | "disease" | "insect" | "weed";
type DiagnosisStatus = "idle" | "preparing" | "analyzing" | "ready" | "error";

type RankedHypothesis = {
  rank: number;
  hypothesis: string;
  scientificName: string;
  confidence: number;
  severity: "baixa" | "moderada" | "alta" | "indeterminada";
  evidenceFor: string[];
  evidenceAgainst: string[];
  confirmation: string[];
  urgency: string;
};

type DiagnosisResult = {
  mode: DiagnosisMode;
  summary: string;
  imageQuality: "adequada" | "limitada" | "insuficiente";
  visibleSymptoms: string[];
  ranking: RankedHypothesis[];
  confounders: string[];
  missingEvidence: string[];
  nextSteps: string[];
  safetyNote: string;
  analyzedAt: string;
};

type PreparedPhoto = {
  id: string;
  name: string;
  preview: string;
  dataUrl: string;
};

const crops = ["Soja", "Milho", "Trigo", "Canola", "Arroz", "Feijão", "Pastagem", "Área não cultivada", "Outra"];
const stages = ["Emergência", "Vegetativo inicial", "Vegetativo avançado", "Florescimento", "Enchimento de grãos", "Maturação", "Não informado"];
const organs = ["Folhas", "Haste ou colmo", "Raízes", "Vagens, espiga ou panícula", "Planta inteira"];
const canopyPositions = ["Folhas mais novas", "Folhas mais velhas", "Toda a planta", "Sem padrão claro"];
const distributions = ["Uniforme no talhão", "Em reboleiras", "Em faixas ou bordaduras", "Plantas isoladas", "Sem informação"];

const methodologies = {
  nutrition: {
    name: "NutriScan",
    product: "PRODUTO 01",
    icon: "N",
    eyebrow: "METODOLOGIA NUTRICIONAL",
    title: "Deficiências nutricionais",
    description: "Cruza padrão de clorose ou necrose, posição no dossel, mobilidade do nutriente, simetria e distribuição no talhão.",
    steps: ["Sintoma visual", "Mobilidade", "Contexto do talhão", "Ranking diferencial"],
    cropLabel: "Cultura",
    stageLabel: "Estádio",
    stageOptions: stages,
    stageDefault: "Vegetativo avançado",
    organLabel: "Órgão afetado",
    organOptions: organs,
    organDefault: "Folhas",
    positionLabel: "Posição na planta",
    positionOptions: canopyPositions,
    positionDefault: "Sem padrão claro",
    distributionOptions: distributions,
    distributionDefault: "Sem informação",
    photoButton: "Fotografar sintoma",
    photoHint: "Detalhe + órgão inteiro + talhão",
    photoSubject: "planta afetada",
    guidance: ["detalhe nítido do sintoma", "folha ou órgão inteiro", "padrão na planta ou no talhão"],
    notesPlaceholder: "Ex.: sintomas iniciaram nas folhas velhas; solo encharcado; adubação realizada…",
    analysisMessage: "Extraindo sintomas e comparando hipóteses nutricionais…",
    visibleLabel: "Sinais observados",
    severityLabel: "Severidade visual",
    layers: [
      ["01 · Imagem", "Cor, forma, simetria, textura e posição dos sintomas."],
      ["02 · Fisiologia", "Mobilidade dos nutrientes e resposta esperada da cultura."],
      ["03 · Campo", "Estádio, órgão, dossel e distribuição espacial informados por você."],
    ],
  },
  disease: {
    name: "FitoScan",
    product: "PRODUTO 02",
    icon: "F",
    eyebrow: "METODOLOGIA FITOPATOLÓGICA",
    title: "Doenças e danos",
    description: "Compara morfologia das lesões, sinais do patógeno, órgão afetado, avanço no dossel e condições predisponentes.",
    steps: ["Lesão e sinal", "Hospedeiro", "Epidemiologia", "Ranking diferencial"],
    cropLabel: "Cultura",
    stageLabel: "Estádio",
    stageOptions: stages,
    stageDefault: "Vegetativo avançado",
    organLabel: "Órgão afetado",
    organOptions: organs,
    organDefault: "Folhas",
    positionLabel: "Posição na planta",
    positionOptions: canopyPositions,
    positionDefault: "Sem padrão claro",
    distributionOptions: distributions,
    distributionDefault: "Sem informação",
    photoButton: "Fotografar lesão",
    photoHint: "Lesão + órgão inteiro + dossel",
    photoSubject: "planta afetada",
    guidance: ["lesão e bordas em foco", "órgão inteiro", "avanço no dossel ou talhão"],
    notesPlaceholder: "Ex.: após sequência de chuva; lesões avançando do baixeiro; presença de halo…",
    analysisMessage: "Extraindo sinais e comparando doenças e danos…",
    visibleLabel: "Sinais observados",
    severityLabel: "Severidade visual",
    layers: [
      ["01 · Imagem", "Forma, borda, halo, centro, textura e possíveis sinais do agente."],
      ["02 · Hospedeiro", "Compatibilidade entre cultura, órgão, estádio e doença."],
      ["03 · Campo", "Epidemiologia, posição no dossel e distribuição espacial informada."],
    ],
  },
  insect: {
    name: "InsetoScan",
    product: "PRODUTO 03",
    icon: "I",
    eyebrow: "METODOLOGIA ENTOMOLÓGICA",
    title: "Insetos, pragas e benéficos",
    description: "Compara morfologia, fase de vida, aparelho bucal, cultura hospedeira e padrão de dano, diferenciando pragas de organismos benéficos.",
    steps: ["Morfologia", "Fase de vida", "Hospedeiro e dano", "Ranking taxonômico"],
    cropLabel: "Cultura ou hospedeiro",
    stageLabel: "Estádio da cultura",
    stageOptions: stages,
    stageDefault: "Vegetativo avançado",
    organLabel: "Local ou dano observado",
    organOptions: ["Folhas e ponteiros", "Haste ou colmo", "Raízes e solo", "Vagens, espiga ou panícula", "Planta inteira ou armadilha"],
    organDefault: "Folhas e ponteiros",
    positionLabel: "Fase observada",
    positionOptions: ["Ovos", "Larva ou lagarta", "Ninfa", "Adulto", "Não identificada"],
    positionDefault: "Não identificada",
    distributionOptions: ["Indivíduos isolados", "Em focos ou reboleiras", "Em bordaduras", "Uniforme no talhão", "Coleta em armadilha", "Sem informação"],
    distributionDefault: "Sem informação",
    photoButton: "Fotografar inseto",
    photoHint: "Dorso + lateral + dano/hospedeiro",
    photoSubject: "inseto ou dano",
    guidance: ["vista dorsal e lateral", "referência de tamanho", "inseto junto da planta ou dano"],
    notesPlaceholder: "Ex.: cerca de 8 mm; encontrado no cartucho; raspagem nas folhas; atividade ao entardecer…",
    analysisMessage: "Comparando morfologia, fase de vida, hospedeiro e padrão de dano…",
    visibleLabel: "Características observadas",
    severityLabel: "Pressão aparente",
    layers: [
      ["01 · Morfologia", "Segmentos, antenas, asas, pernas, coloração, tamanho e fase de vida."],
      ["02 · Relação com a cultura", "Hospedeiro, local encontrado e assinatura do dano observado."],
      ["03 · Campo", "Quantidade, distribuição e possibilidade de organismo benéfico ou não alvo."],
    ],
  },
  weed: {
    name: "DaninhaScan",
    product: "PRODUTO 04",
    icon: "D",
    eyebrow: "METODOLOGIA BOTÂNICA",
    title: "Plantas daninhas",
    description: "Compara cotilédones, folhas, nervuras, pilosidade, lígula, caule, hábito de crescimento e estruturas reprodutivas.",
    steps: ["Morfologia", "Grupo botânico", "Estádio da daninha", "Ranking taxonômico"],
    cropLabel: "Cultura ou ambiente",
    stageLabel: "Estádio da cultura",
    stageOptions: stages,
    stageDefault: "Vegetativo inicial",
    organLabel: "Estrutura visível",
    organOptions: ["Planta inteira", "Folhas e cotilédones", "Caule ou colmo", "Inflorescência ou sementes", "Raiz ou órgão subterrâneo"],
    organDefault: "Planta inteira",
    positionLabel: "Grupo ou hábito aparente",
    positionOptions: ["Folha larga", "Gramínea ou ciperácea", "Trepadeira ou volúvel", "Roseta, rasteira ou prostrada", "Sem informação"],
    positionDefault: "Sem informação",
    distributionOptions: ["Uniforme no talhão", "Em reboleiras", "Em linhas ou faixas", "Em bordaduras", "Plantas isoladas", "Sem informação"],
    distributionDefault: "Sem informação",
    photoButton: "Fotografar daninha",
    photoHint: "Planta inteira + folha + lígula/flor",
    photoSubject: "planta daninha",
    guidance: ["planta inteira com escala", "folhas, caule e inserção", "lígula, flor, semente ou raiz"],
    notesPlaceholder: "Ex.: planta com 4 folhas; caule piloso; ocorre em reboleiras; área após soja…",
    analysisMessage: "Comparando estruturas botânicas e espécies semelhantes…",
    visibleLabel: "Características observadas",
    severityLabel: "Infestação visual",
    layers: [
      ["01 · Morfologia", "Cotilédones, folhas, nervuras, pilosidade, caule, lígula e inflorescência."],
      ["02 · Taxonomia", "Família, gênero, hábito de crescimento e estádio da planta daninha."],
      ["03 · Campo", "Cultura, distribuição e histórico informado, sem inferir resistência pela foto."],
    ],
  },
} as const;

function readFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Não foi possível abrir a imagem."));
    reader.readAsDataURL(file);
  });
}

async function prepareImage(file: File) {
  if (!file.type.startsWith("image/")) throw new Error("Selecione apenas imagens.");
  if (file.size > 15 * 1024 * 1024) throw new Error("Cada imagem pode ter no máximo 15 MB.");
  const original = await readFile(file);
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error("A imagem selecionada não pôde ser processada."));
    element.src = original;
  });
  const maxSide = 1600;
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("O navegador não conseguiu preparar a imagem.");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.84);
}

function confidenceClass(confidence: number) {
  if (confidence >= 70) return "high";
  if (confidence >= 45) return "medium";
  return "low";
}

export default function PhotoDiagnosis() {
  const [mode, setMode] = useState<DiagnosisMode>("nutrition");
  const [crop, setCrop] = useState("Soja");
  const [stage, setStage] = useState("Vegetativo avançado");
  const [organ, setOrgan] = useState("Folhas");
  const [canopyPosition, setCanopyPosition] = useState("Sem padrão claro");
  const [distribution, setDistribution] = useState("Sem informação");
  const [notes, setNotes] = useState("");
  const [photos, setPhotos] = useState<PreparedPhoto[]>([]);
  const [status, setStatus] = useState<DiagnosisStatus>("idle");
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<DiagnosisResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const photosRef = useRef<PreparedPhoto[]>([]);

  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);

  useEffect(() => () => {
    photosRef.current.forEach((photo) => URL.revokeObjectURL(photo.preview));
  }, []);

  const methodology = useMemo(() => methodologies[mode], [mode]);

  function selectMode(nextMode: DiagnosisMode) {
    const next = methodologies[nextMode];
    setMode(nextMode);
    setStage(next.stageDefault);
    setOrgan(next.organDefault);
    setCanopyPosition(next.positionDefault);
    setDistribution(next.distributionDefault);
    setResult(null);
    setStatus("idle");
    setMessage("");
  }

  async function addPhotos(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    if (photos.length + files.length > 3) {
      setMessage("Use no máximo três fotos por análise.");
      setStatus("error");
      return;
    }
    setStatus("preparing");
    setMessage("Otimizando as imagens para análise…");
    try {
      const prepared = await Promise.all(files.map(async (file) => ({
        id: `${file.name}-${file.lastModified}-${Math.random()}`,
        name: file.name,
        preview: URL.createObjectURL(file),
        dataUrl: await prepareImage(file),
      })));
      setPhotos((current) => [...current, ...prepared]);
      setStatus("idle");
      setMessage("");
      setResult(null);
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Não foi possível preparar as fotos.");
    }
  }

  function removePhoto(id: string) {
    setPhotos((current) => {
      const target = current.find((photo) => photo.id === id);
      if (target) URL.revokeObjectURL(target.preview);
      return current.filter((photo) => photo.id !== id);
    });
    setResult(null);
  }

  async function analyze() {
    if (!photos.length) {
      setStatus("error");
      setMessage(`Adicione pelo menos uma foto de ${methodology.photoSubject}.`);
      return;
    }
    setStatus("analyzing");
    setMessage(methodology.analysisMessage);
    setResult(null);
    try {
      const response = await fetch("/api/diagnosis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          crop,
          stage,
          organ,
          canopyPosition,
          distribution,
          notes: notes.trim(),
          images: photos.map((photo) => photo.dataUrl),
        }),
      });
      const data = (await response.json()) as DiagnosisResult & { error?: string };
      if (!response.ok) throw new Error(data.error || "A análise não pôde ser concluída.");
      setResult(data);
      setStatus("ready");
      setMessage("");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "A análise não pôde ser concluída.");
    }
  }

  function reset() {
    photos.forEach((photo) => URL.revokeObjectURL(photo.preview));
    setPhotos([]);
    setResult(null);
    setStatus("idle");
    setMessage("");
    setNotes("");
  }

  return (
    <div className="photo-diagnosis-page">
      <div className="page-heading diagnosis-heading">
        <span className="eyebrow">DIAGNÓSTICO ASSISTIDO POR IMAGEM</span>
        <h1>Da foto ao ranking técnico</h1>
        <p>Triagem visual com quatro metodologias independentes, contexto agronômico e hipóteses explicáveis.</p>
      </div>

      <div className="diagnosis-products" role="tablist" aria-label="Produto de diagnóstico">
        {(Object.keys(methodologies) as DiagnosisMode[]).map((item) => {
          const product = methodologies[item];
          return (
            <button key={item} className={mode === item ? `active ${item}` : item} onClick={() => selectMode(item)} role="tab" aria-selected={mode === item}>
              <span className="diagnosis-product-icon">{product.icon}</span>
              <div><small>{product.product}</small><strong>{product.name}</strong><p>{product.title}</p></div>
            </button>
          );
        })}
      </div>

      <section className={`diagnosis-method ${mode}`}>
        <div>
          <span className="eyebrow">{methodology.eyebrow}</span>
          <h2>{methodology.title}</h2>
          <p>{methodology.description}</p>
        </div>
        <ol>{methodology.steps.map((step, index) => <li key={step}><span>0{index + 1}</span>{step}</li>)}</ol>
      </section>

      <div className="diagnosis-workspace">
        <section className="content-panel diagnosis-input-panel">
          <div className="panel-title"><div><span className="eyebrow">CAPTURA ORIENTADA</span><h2>Fotos e contexto da lavoura</h2></div><span className="diagnosis-counter">{photos.length}/3</span></div>

          <div className="diagnosis-photo-grid">
            {photos.map((photo, index) => (
              <figure key={photo.id}>
                <img src={photo.preview} alt={`Foto ${index + 1} para diagnóstico`} />
                <figcaption>Foto {index + 1}</figcaption>
                <button onClick={() => removePhoto(photo.id)} aria-label={`Remover foto ${index + 1}`}>×</button>
              </figure>
            ))}
            {photos.length < 3 && (
              <button className="diagnosis-add-photo" onClick={() => inputRef.current?.click()} disabled={status === "preparing" || status === "analyzing"}>
                <span>+</span><strong>{photos.length ? "Adicionar outro ângulo" : methodology.photoButton}</strong><small>{methodology.photoHint}</small>
              </button>
            )}
          </div>
          <input ref={inputRef} className="hidden-input" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" multiple onChange={addPhotos} />

          <div className="diagnosis-guidance">
            <b>Para melhorar a precisão</b>
            {methodology.guidance.map((item, index) => <span key={item}>{index + 1}. {item}</span>)}
          </div>

          <div className="diagnosis-form-grid">
            <label className="field"><span>{methodology.cropLabel}</span><select value={crop} onChange={(event) => setCrop(event.target.value)}>{crops.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label className="field"><span>{methodology.stageLabel}</span><select value={stage} onChange={(event) => setStage(event.target.value)}>{methodology.stageOptions.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label className="field"><span>{methodology.organLabel}</span><select value={organ} onChange={(event) => setOrgan(event.target.value)}>{methodology.organOptions.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label className="field"><span>{methodology.positionLabel}</span><select value={canopyPosition} onChange={(event) => setCanopyPosition(event.target.value)}>{methodology.positionOptions.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label className="field"><span>Distribuição no talhão</span><select value={distribution} onChange={(event) => setDistribution(event.target.value)}>{methodology.distributionOptions.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label className="field diagnosis-notes"><span>Observações de campo</span><textarea value={notes} maxLength={800} onChange={(event) => setNotes(event.target.value)} placeholder={methodology.notesPlaceholder} /></label>
          </div>

          {(status === "preparing" || status === "analyzing") && <div className="diagnosis-progress"><i /><span>{message}</span></div>}
          {status === "error" && <p className="diagnosis-error">{message}</p>}
          <div className="form-actions">
            <button className="button primary" onClick={analyze} disabled={!photos.length || status === "preparing" || status === "analyzing"}>{status === "analyzing" ? "Analisando…" : `Gerar ranking ${methodology.name}`}</button>
            {(photos.length > 0 || result) && <button className="button secondary" onClick={reset} disabled={status === "analyzing"}>Limpar</button>}
          </div>
        </section>

        <aside className="diagnosis-side-panel">
          <span className="eyebrow">PROTOCOLO DE LEITURA</span>
          <h3>O ranking combina três camadas</h3>
          {methodology.layers.map(([title, description]) => <div key={title}><b>{title}</b><p>{description}</p></div>)}
          <small>A confiança mede compatibilidade com as evidências fornecidas; não é identificação definitiva nem recomendação de controle.</small>
        </aside>
      </div>

      {result && (
        <section className="diagnosis-results" aria-live="polite">
          <header>
            <div><span className="eyebrow">RANKING DE HIPÓTESES · {methodology.name}</span><h2>{result.summary}</h2><p>Qualidade das imagens: <b>{result.imageQuality}</b></p></div>
            <span className={`image-quality ${result.imageQuality}`}>{result.imageQuality}</span>
          </header>

          <div className="visible-symptoms"><strong>{methodology.visibleLabel}</strong>{result.visibleSymptoms.map((item) => <span key={item}>{item}</span>)}</div>
          <div className="diagnosis-ranking">
            {result.ranking.map((item, index) => (
              <article className={index === 0 ? "leader" : ""} key={`${item.rank}-${item.hypothesis}`}>
                <div className="rank-head">
                  <span className="rank-number">#{item.rank}</span>
                  <div><h3>{item.hypothesis}</h3>{item.scientificName && <small>{item.scientificName}</small>}</div>
                  <div className={`confidence ${confidenceClass(item.confidence)}`}><strong>{item.confidence}%</strong><span>compatibilidade</span></div>
                </div>
                <div className="confidence-bar"><i style={{ width: `${Math.min(100, Math.max(0, item.confidence))}%` }} /></div>
                <div className="rank-evidence">
                  <div className="supports"><b>Evidências a favor</b>{item.evidenceFor.map((evidence) => <p key={evidence}>+ {evidence}</p>)}</div>
                  <div className="contradicts"><b>O que reduz a hipótese</b>{item.evidenceAgainst.length ? item.evidenceAgainst.map((evidence) => <p key={evidence}>− {evidence}</p>) : <p>− Nenhuma contradição forte nas informações recebidas.</p>}</div>
                </div>
                <details><summary>Como confirmar no campo</summary>{item.confirmation.map((step) => <p key={step}>{step}</p>)}<strong className="rank-urgency">Prioridade: {item.urgency} · {methodology.severityLabel}: {item.severity}</strong></details>
              </article>
            ))}
          </div>

          <div className="diagnosis-conclusion-grid">
            <article><span className="eyebrow">CONFUNDIDORES</span><h3>Verifique diagnósticos semelhantes</h3>{result.confounders.map((item) => <p key={item}>• {item}</p>)}</article>
            <article><span className="eyebrow">EVIDÊNCIAS FALTANTES</span><h3>O que aumentaria a confiança</h3>{result.missingEvidence.map((item) => <p key={item}>• {item}</p>)}</article>
            <article><span className="eyebrow">PRÓXIMOS PASSOS</span><h3>Protocolo de confirmação</h3>{result.nextSteps.map((item) => <p key={item}>• {item}</p>)}</article>
          </div>
          <p className="diagnosis-disclaimer"><b>Decisão assistida:</b> {result.safetyNote}</p>
        </section>
      )}
    </div>
  );
}
