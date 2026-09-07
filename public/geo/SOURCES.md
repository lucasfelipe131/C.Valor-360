# Administrative map reference
Retrieved 2026-09-07 from IBGE public APIs:
- Names / UF: https://servicodados.ibge.gov.br/api/v1/localidades/municipios?orderBy=nome
- State geometry: https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR?formato=application/vnd.geo%2Bjson&qualidade=minima&intrarregiao=UF
- Municipal bounding boxes derived from: https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR?formato=application/vnd.geo%2Bjson&qualidade=minima&intrarregiao=municipio
- Documentation: https://servicodados.ibge.gov.br/api/docs/malhas?versao=3

The names endpoint returned 5571 municipalities; the simplified mesh returned 5570.
Entries without a corresponding boundary have null bounds and cannot be centered.
These generalized boundaries are navigation references, not cadastral boundaries,
property ownership, field geometry, area measurements or producer evidence.
Municipality rows: [IBGE code, name, UF, [south, west, north, east] or null].

Municipal polygons on selection: IBGE API v3 `/malhas/municipios/{codigo}` with
`formato=application/vnd.geo+json&qualidade=minima`, queried through the protected
VAL reference adapter. Responses identify the source and query time. Geometry
is never replaced by the stored navigation bounding box when unavailable.
