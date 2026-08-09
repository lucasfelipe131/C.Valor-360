"use client";

import type { Map as LeafletMap, LayerGroup, TileLayer } from "leaflet";
import { useEffect, useRef, useState } from "react";

export type MapPoint = {
  lat: number;
  lng: number;
};

export type MapReferencePolygon = {
  id: string;
  label: string;
  points: MapPoint[];
  color?: string;
  fillColor?: string;
};

export default function FieldMap({
  points,
  onChange,
  ndviTileUrl,
  referencePolygons = [],
}: {
  points: MapPoint[];
  onChange: (points: MapPoint[]) => void;
  ndviTileUrl?: string;
  referencePolygons?: MapReferencePolygon[];
}) {
  const elementRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const baseLayerRef = useRef<TileLayer | null>(null);
  const drawingRef = useRef<LayerGroup | null>(null);
  const ndviRef = useRef<LayerGroup | null>(null);
  const pointsRef = useRef(points);
  const onChangeRef = useRef(onChange);
  const [ready, setReady] = useState(false);
  const [baseStyle, setBaseStyle] = useState<"map" | "satellite">("satellite");
  const [selectedPoint, setSelectedPoint] = useState<number | null>(null);

  useEffect(() => {
    pointsRef.current = points;
    onChangeRef.current = onChange;
  }, [onChange, points]);

  useEffect(() => {
    let mounted = true;
    if (!elementRef.current || mapRef.current) return;

    void import("leaflet").then((module) => {
      if (!mounted || !elementRef.current || mapRef.current) return;
      const L = module.default;
      const initial = pointsRef.current[0] ?? { lat: -28.41, lng: -54.96 };
      const map = L.map(elementRef.current, {
        zoomControl: true,
        attributionControl: true,
      }).setView([initial.lat, initial.lng], pointsRef.current.length ? 15 : 11);
      map.on("click", (event) => {
        setSelectedPoint(pointsRef.current.length);
        onChangeRef.current([
          ...pointsRef.current,
          {
            lat: Number(event.latlng.lat.toFixed(6)),
            lng: Number(event.latlng.lng.toFixed(6)),
          },
        ]);
      });
      mapRef.current = map;
      setReady(true);
      window.setTimeout(() => map.invalidateSize(), 80);
    });

    return () => {
      mounted = false;
      setReady(false);
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let cancelled = false;
    void import("leaflet").then((module) => {
      if (cancelled || !mapRef.current) return;
      const L = module.default;
      baseLayerRef.current?.remove();
      const layer =
        baseStyle === "satellite"
          ? L.tileLayer(
              "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
              {
                maxZoom: 19,
                attribution:
                  "Imagem © Esri, Maxar, Earthstar Geographics e colaboradores",
              },
            )
          : L.tileLayer(
              "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
              {
                maxZoom: 19,
                attribution: "© OpenStreetMap",
              },
            );
      layer.addTo(map);
      layer.bringToBack();
      baseLayerRef.current = layer;
    });
    return () => {
      cancelled = true;
    };
  }, [baseStyle, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let cancelled = false;
    void import("leaflet").then((module) => {
      if (cancelled || !mapRef.current) return;
      const L = module.default;
      drawingRef.current?.remove();
      const group = L.layerGroup().addTo(map);
      referencePolygons.forEach((reference) => {
        if (reference.points.length < 2) return;
        const coordinates = reference.points.map((point) => [point.lat, point.lng] as [number, number]);
        const layer = reference.points.length >= 3
          ? L.polygon(coordinates, {
              color: reference.color ?? "#f59e0b",
              fillColor: reference.fillColor ?? "#fbbf24",
              fillOpacity: 0.12,
              weight: 2,
              dashArray: "7 6",
            })
          : L.polyline(coordinates, {
              color: reference.color ?? "#f59e0b",
              weight: 2,
              dashArray: "7 6",
            });
        layer.bindTooltip(reference.label || "Área de referência").addTo(group);
      });
      points.forEach((point, index) => {
        const marker = L.circleMarker([point.lat, point.lng], {
          radius: selectedPoint === index ? 9 : 7,
          color: selectedPoint === index ? "#ef4444" : "#d5f45c",
          fillColor: selectedPoint === index ? "#fff7ed" : "#092d25",
          fillOpacity: 1,
          weight: selectedPoint === index ? 3 : 2,
          bubblingMouseEvents: false,
        })
          .bindTooltip("P" + (index + 1), { permanent: true, direction: "top" })
          .addTo(group);
        marker.on("click", () => setSelectedPoint(index));
      });
      if (points.length >= 3) {
        L.polygon(points.map((point) => [point.lat, point.lng]), {
          color: "#d5f45c",
          fillColor: "#5b9f4c",
          fillOpacity: 0.18,
          weight: 2,
        }).addTo(group);
      } else if (points.length === 2) {
        L.polyline(points.map((point) => [point.lat, point.lng]), {
          color: "#d5f45c",
          weight: 2,
        }).addTo(group);
      }
      drawingRef.current = group;
      const visiblePoints = [
        ...points,
        ...referencePolygons.flatMap((reference) => reference.points),
      ];
      if (visiblePoints.length) {
        const bounds = L.latLngBounds(
          visiblePoints.map((point) => [point.lat, point.lng]),
        );
        map.fitBounds(bounds, { padding: [28, 28], maxZoom: 17 });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [points, ready, referencePolygons, selectedPoint]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let cancelled = false;
    void import("leaflet").then((module) => {
      if (cancelled || !mapRef.current) return;
      const L = module.default;
      ndviRef.current?.remove();
      const group = L.layerGroup().addTo(map);
      if (ndviTileUrl && points.length >= 3) {
        L.tileLayer(ndviTileUrl, {
          opacity: 0.72,
          maxZoom: 19,
          attribution: "Sentinel-2 · Microsoft Planetary Computer",
        }).addTo(group);
      }
      ndviRef.current = group;
    });
    return () => {
      cancelled = true;
    };
  }, [ndviTileUrl, points, ready]);

  function removeSelectedPoint() {
    if (selectedPoint === null) return;
    onChange(points.filter((_, index) => index !== selectedPoint));
    setSelectedPoint(null);
  }

  function undoLastPoint() {
    if (!points.length) return;
    onChange(points.slice(0, -1));
    setSelectedPoint(null);
  }

  function clearDrawing() {
    if (!points.length) return;
    if (!window.confirm("Remover todos os pontos deste desenho?")) return;
    onChange([]);
    setSelectedPoint(null);
  }

  return (
    <div className="field-map-shell">
      <div ref={elementRef} className="field-map" />
      <div className="map-style-switch" aria-label="Visualização do mapa">
        <button
          className={baseStyle === "satellite" ? "active" : ""}
          onClick={() => setBaseStyle("satellite")}
          type="button"
        >
          Satélite
        </button>
        <button
          className={baseStyle === "map" ? "active" : ""}
          onClick={() => setBaseStyle("map")}
          type="button"
        >
          Mapa
        </button>
      </div>
      <div className="map-point-toolbar">
        <div className="map-point-actions">
          <button type="button" onClick={undoLastPoint} disabled={!points.length}>Desfazer último</button>
          <button type="button" className="danger" onClick={removeSelectedPoint} disabled={selectedPoint === null}>Remover ponto selecionado</button>
          <button type="button" onClick={clearDrawing} disabled={!points.length}>Limpar desenho</button>
        </div>
        {!!points.length && (
          <div className="map-point-list" aria-label="Pontos do desenho">
            {points.map((point, index) => (
              <button
                type="button"
                key={index}
                className={selectedPoint === index ? "active" : ""}
                onClick={() => setSelectedPoint(index)}
                title={point.lat.toFixed(6) + ", " + point.lng.toFixed(6)}
              >
                P{index + 1}
              </button>
            ))}
          </div>
        )}
      </div>
      <span className="map-hint">{selectedPoint === null ? "Toque no mapa para adicionar um vértice; toque em um ponto para selecioná-lo." : "Ponto P" + (selectedPoint + 1) + " selecionado. Use o botão vermelho para excluir."}</span>
    </div>
  );
}
