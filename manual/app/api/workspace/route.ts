import { after, NextRequest, NextResponse } from "next/server";
import { ensureAccessSchema, sessionFromRequest } from "../../lib/access";
import { producerSyncFingerprint, producerSyncKey, publishWorkspaceToValor, valor360Configured } from "../../lib/valor360";

// Impressões digitais já publicadas por workspace. Cada autosave (a cada alteração, com 700 ms de espera) republicava
// todos os produtores dentro da requisição; agora só os alterados vão para o VALOR 360, e fora do caminho da resposta.
const publishedFingerprints = new Map<string, Map<string, string>>();

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let workspaceSchemaReady: Promise<void> | undefined;

async function ensureWorkspaceSchema() {
  const pool = await ensureAccessSchema();
  if (!workspaceSchemaReady) {
    workspaceSchemaReady = pool.query(
      "CREATE TABLE IF NOT EXISTS app_workspace_data (" +
        "workspace_id UUID PRIMARY KEY," +
        "producers JSONB NOT NULL DEFAULT '[]'::jsonb," +
        "soil_analyses JSONB NOT NULL DEFAULT '[]'::jsonb," +
        "professional_profile JSONB NOT NULL DEFAULT '{}'::jsonb," +
        "updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()" +
      ");" +
      "ALTER TABLE app_workspace_data ADD COLUMN IF NOT EXISTS professional_profile JSONB NOT NULL DEFAULT '{}'::jsonb;",
    ).then(() => undefined).catch((error) => {
      workspaceSchemaReady = undefined;
      throw error;
    });
  }
  await workspaceSchemaReady;
  return pool;
}

function noStore(response: NextResponse) {
  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}

export async function GET(request: NextRequest) {
  try {
    const session = await sessionFromRequest(request);
    if (!session) return NextResponse.json({ error: "Sessão expirada." }, { status: 401 });
    const pool = await ensureWorkspaceSchema();
    const result = await pool.query(
      'SELECT producers, soil_analyses AS "soilAnalyses", professional_profile AS "professionalProfile", updated_at AS "updatedAt" ' +
      "FROM app_workspace_data WHERE workspace_id = $1 LIMIT 1",
      [session.user.id],
    );
    const row = result.rows[0];
    return noStore(NextResponse.json({
      producers: Array.isArray(row?.producers) ? row.producers : [],
      soilAnalyses: Array.isArray(row?.soilAnalyses) ? row.soilAnalyses : [],
      professionalProfile: row?.professionalProfile && typeof row.professionalProfile === "object" && !Array.isArray(row.professionalProfile) ? row.professionalProfile : {},
      updatedAt: row?.updatedAt ?? null,
      hasData: Boolean(row),
      storage: "postgresql",
    }));
  } catch (error) {
    console.error("workspace:get", error);
    return NextResponse.json({ error: "Não foi possível carregar o backup da conta." }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await sessionFromRequest(request);
    if (!session) return NextResponse.json({ error: "Sessão expirada." }, { status: 401 });
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > 12 * 1024 * 1024) {
      return NextResponse.json({ error: "A base excedeu o limite de 12 MB por sincronização." }, { status: 413 });
    }
    const body = JSON.parse(raw) as { producers?: unknown; soilAnalyses?: unknown; professionalProfile?: unknown };
    if (!Array.isArray(body.producers) || !Array.isArray(body.soilAnalyses) || !body.professionalProfile || typeof body.professionalProfile !== "object" || Array.isArray(body.professionalProfile)) {
      return NextResponse.json({ error: "Formato de backup inválido." }, { status: 400 });
    }
    if (body.producers.length > 5000 || body.soilAnalyses.length > 2500) {
      return NextResponse.json({ error: "Quantidade de registros acima do limite de segurança." }, { status: 413 });
    }
    const producers = body.producers as unknown[];
    const soilAnalyses = body.soilAnalyses as unknown[];
    const pool = await ensureWorkspaceSchema();
    const result = await pool.query(
      "INSERT INTO app_workspace_data (workspace_id, producers, soil_analyses, professional_profile) " +
      "VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb) " +
      "ON CONFLICT (workspace_id) DO UPDATE SET " +
      "producers = EXCLUDED.producers, soil_analyses = EXCLUDED.soil_analyses, professional_profile = EXCLUDED.professional_profile, updated_at = NOW() " +
      'RETURNING updated_at AS "updatedAt"',
      [session.user.id, JSON.stringify(body.producers), JSON.stringify(body.soilAnalyses), JSON.stringify(body.professionalProfile)],
    );
    const ownerUserId = session.valor360OwnerId ?? undefined;
    const workspaceKey = session.user.id;
    const known = publishedFingerprints.get(workspaceKey) ?? new Map<string, string>();
    const next = new Map<string, string>();
    const changed: unknown[] = [];
    for (const producer of producers) {
      const key = producerSyncKey(producer);
      if (!key) continue;
      const digest = producerSyncFingerprint(producer, soilAnalyses);
      next.set(key, digest);
      if (known.get(key) !== digest) changed.push(producer);
    }
    publishedFingerprints.set(workspaceKey, next);
    const configured = valor360Configured();
    if (configured && changed.length) {
      after(async () => {
        try {
          const outcome = await publishWorkspaceToValor(changed, soilAnalyses, ownerUserId);
          // Falha parcial: esquece o que foi publicado para que o próximo salvamento tente de novo.
          if (outcome.failed > 0) publishedFingerprints.delete(workspaceKey);
        } catch (error) {
          publishedFingerprints.delete(workspaceKey);
          console.error("workspace:publish", error);
        }
      });
    }
    return noStore(NextResponse.json({
      saved: true,
      updatedAt: result.rows[0]?.updatedAt ?? new Date().toISOString(),
      storage: "postgresql",
      integration: {
        configured,
        queued: configured ? changed.length : 0,
        unchanged: producers.length - changed.length,
        mode: "background",
      },
    }));
  } catch (error) {
    console.error("workspace:put", error);
    return NextResponse.json({ error: "Não foi possível salvar o backup da conta." }, { status: 500 });
  }
}
