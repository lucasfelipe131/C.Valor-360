export function consultZarc(input: {
  uf: string;
  municipality: string;
  crop: string;
  soil: string;
  cycle: string;
}, options?: Record<string, unknown>): Promise<Record<string, unknown>>;
