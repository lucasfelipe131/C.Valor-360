import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import { register } from "node:module";

// `server-only` is a Next.js build marker, not runtime behavior. The smoke
// imports the integration module directly under Node, so resolve only that
// marker to an empty module while preserving every other package resolution.
register(
  'data:text/javascript,export async function resolve(s,c,n){if(s==="server-only")return{url:"data:text/javascript,export%20default%20%7B%7D",shortCircuit:true};return n(s,c)}',
  import.meta.url,
);

const received = [];
const server = createServer((request, response) => {
  let raw = "";
  request.setEncoding("utf8");
  request.on("data", (chunk) => { raw += chunk; });
  request.on("end", () => {
    received.push({ raw, signature: request.headers["x-valor-signature"] });
    response.writeHead(202, { "content-type": "application/json" });
    response.end('{"accepted":true}');
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
process.env.VALOR360_WEBHOOK_URL = `http://127.0.0.1:${address.port}/events`;
process.env.VALOR360_WEBHOOK_SECRET = "segredo-compartilhado";

const {
  publishManualRecordToValor,
  publishProducerToValor,
  valor360ExternalKey,
} = await import("./app/lib/valor360.ts");

assert.equal(valor360ExternalKey("Genor Brum Filho"), "genor-brum-filho");
const recordResult = await publishManualRecordToValor({
  id: "6c5b87d8-9097-48ca-a4db-5603d526fcde",
  type: "soil_analysis",
  title: "Genor · Área 1",
  producerName: "Genor Brum Filho",
  payload: {
    laboratory: "Lab Sul",
    sampleDate: "2026-08-01",
    depth: "0-20 cm",
    property: "Fazenda Boa Vista",
    values: { phosphorus: "12,5", potassium: "80" },
    document: "123.456.789-00",
    photoDataUrl: "data:image/png;base64,AAAA",
  },
});
assert.equal(recordResult.length, 2);
assert(recordResult.every((item) => item.ok));

const producerResult = await publishProducerToValor({
  id: "produtor-1",
  name: "Genor Brum Filho",
  city: "Cruz Alta",
  area: 240,
  cultures: ["Soja", "Milho"],
  document: "123.456.789-00",
  fields: [{ name: "Área 1", area: 120 }],
});
assert(producerResult.every((item) => item.ok));
assert.equal(received.length, 3);

for (const item of received) {
  const expected = createHmac("sha256", process.env.VALOR360_WEBHOOK_SECRET)
    .update(item.raw)
    .digest("hex");
  assert.equal(item.signature, `sha256=${expected}`);
  assert(!item.raw.includes("123.456.789-00"));
  assert(!item.raw.includes("base64"));
  assert.equal(JSON.parse(item.raw).clientExternalKey, "genor-brum-filho");
}
assert.deepEqual(
  received.map((item) => JSON.parse(item.raw).type),
  ["manual.record.saved", "soil_analysis.completed", "manual.producer.updated"],
);

server.close();
console.log("manual -> VALOR 360 integration smoke test passed");
