type ProducerIdentity = {
  id: string;
  name: string;
  crmCode?: string;
  valor360ExternalKey?: string;
  valor360BootstrapKey?: string;
  crmSource?: string;
  document: string;
  phone: string;
  email: string;
  city: string;
  properties: string;
  area: number;
  cultures?: string[];
  notes: string;
  fields: unknown[];
  registrations?: unknown[];
};

// The authenticated bootstrap carries the previously bound Manual ID. A CRM
// key or a matching name alone cannot merge two independent Manual producers.
export function reconcileValor360Bootstrap<T extends ProducerIdentity>(
  current: T[], incoming: T[], referencedProducerIds: string[] = [],
): T[] {
  const byId = new Map(current.map(producer => [producer.id, producer]));
  const consumed = new Set<string>();
  const references = new Set(referencedProducerIds);
  const result = incoming.map(producer => {
    const existing = byId.get(producer.id);
    consumed.add(producer.id);
    const bootstrapKey = producer.valor360BootstrapKey;
    const shadow = bootstrapKey && bootstrapKey !== producer.id ? byId.get(bootstrapKey) : undefined;
    // Older bootstraps minted a second local view keyed by the CRM key. Retire
    // only that reconstructable, unedited view; preserve enriched/referenced
    // rows for explicit review instead of silently losing local work.
    if (shadow && shadow.crmSource === "VALOR 360" && shadow.crmCode === bootstrapKey &&
        !references.has(shadow.id) && !shadow.fields.length && !shadow.registrations?.length &&
        !shadow.document && shadow.notes === producer.notes &&
        ["name", "phone", "email", "city", "properties", "area"].every(key =>
          String(shadow[key as keyof T] ?? "") === String(producer[key as keyof T] ?? "")) &&
        JSON.stringify(shadow.cultures ?? []) === JSON.stringify(producer.cultures ?? [])) {
      consumed.add(shadow.id);
    }
    if (!existing) return producer;
    return {
      ...producer, ...existing,
      valor360ExternalKey: producer.valor360ExternalKey,
      valor360BootstrapKey: producer.valor360BootstrapKey,
      name: producer.name || existing.name,
      crmCode: producer.crmCode || existing.crmCode,
      phone: producer.phone || existing.phone,
      email: producer.email || existing.email,
      city: existing.city || producer.city,
      properties: existing.properties || producer.properties,
      area: existing.area || producer.area,
      cultures: Array.from(new Set([...(producer.cultures ?? []), ...(existing.cultures ?? [])])),
      notes: Array.from(new Set([existing.notes, producer.notes].filter(Boolean))).join("\n"),
      fields: existing.fields ?? [],
      registrations: existing.registrations ?? [],
      crmSource: "VALOR 360",
    };
  });
  return [...result, ...current.filter(producer => !consumed.has(producer.id))];
}
