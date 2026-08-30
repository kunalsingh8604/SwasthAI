import { useEffect, useRef, useCallback, useImperativeHandle, forwardRef, useState } from "react";
import type { Map as LeafletMap, Marker, Circle, MarkerClusterGroup, Polyline } from "leaflet";
import {
  type Coords,
  type FacilityType,
  type Place,
  FILTER_META,
} from "@/lib/healthcare-places";

import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";

const OSM_TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const OSM_ATTRIBUTION = "© OpenStreetMap contributors";
const DEFAULT_ZOOM = 13;

export type HealthcareMapHandle = {
  flyTo: (coords: Coords, zoom?: number) => void;
  setSearchCenter: (coords: Coords, label?: string) => void;
  addGpsMarker: (coords: Coords, label: string) => void;
  showRoute: (path: Coords[]) => void;
  clearRoute: () => void;
};

type HealthcareMapProps = {
  center: Coords;
  centerLabel?: string;
  searchRadiusM?: number;
  places: Place[];
  selectedId: number | null;
  lang: "en" | "hi";
  onCenterChange: (coords: Coords, label?: string) => void;
  onMarkerClick: (id: number) => void;
  onRequestDirections?: (place: Place) => void;
  onReady?: () => void;
  className?: string;
};

function HealthcareMapInner(
  {
    center,
    centerLabel,
    searchRadiusM = 5000,
    places,
    selectedId,
    lang,
    onCenterChange,
    onMarkerClick,
    onRequestDirections,
    onReady,
    className = "h-[450px] w-full md:h-[580px] lg:h-[650px]",
  }: HealthcareMapProps,
  ref: React.Ref<HealthcareMapHandle>
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const clusterRef = useRef<MarkerClusterGroup | null>(null);
  const markerLayerRef = useRef<import("leaflet").LayerGroup | null>(null);
  const searchPinRef = useRef<Marker | null>(null);
  const radiusCircleRef = useRef<Circle | null>(null);
  const gpsMarkerRef = useRef<Marker | null>(null);
  const routeLineRef = useRef<Polyline | null>(null);
  const LRef = useRef<typeof import("leaflet")["default"] | null>(null);
  const onCenterChangeRef = useRef(onCenterChange);
  const onMarkerClickRef = useRef(onMarkerClick);
  const onRequestDirectionsRef = useRef(onRequestDirections);
  const centerRef = useRef(center);
  const centerLabelRef = useRef(centerLabel);

  onCenterChangeRef.current = onCenterChange;
  onMarkerClickRef.current = onMarkerClick;
  onRequestDirectionsRef.current = onRequestDirections;
  centerRef.current = center;
  centerLabelRef.current = centerLabel;

  const createMarkerIcon = useCallback(
    (L: typeof import("leaflet")["default"], type: FacilityType, isSelected: boolean) => {
      const meta = FILTER_META[type];
      const size = isSelected ? 44 : 36;
      const activeClass = isSelected ? "active-map-pin" : "";

      return L.divIcon({
        className: "custom-leaflet-marker",
        iconSize: [size, size],
        iconAnchor: [size / 2, size],
        popupAnchor: [0, -size + 4],
        html: `
          <div class="${activeClass}" style="
            width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;
            background:${meta.color};border-radius:50% 50% 50% 4px;transform:rotate(-45deg);
            box-shadow:0 6px 18px ${meta.color}66;border:3px solid #ffffff;
            transition:all 0.3s cubic-bezier(0.34,1.56,0.64,1);
          ">
            <span style="transform:rotate(45deg);font-size:${isSelected ? "20px" : "16px"};">${meta.emoji}</span>
          </div>
        `,
      });
    },
    []
  );

  const createPinIcon = useCallback((L: typeof import("leaflet")["default"]) => {
    return L.divIcon({
      className: "user-center-pin",
      iconSize: [38, 38],
      iconAnchor: [19, 38],
      popupAnchor: [0, -36],
      html: `
        <div style="
          width:38px;height:38px;display:flex;align-items:center;justify-content:center;
          background:#4f46e5;border-radius:50% 50% 50% 4px;transform:rotate(-45deg);
          box-shadow:0 8px 24px rgba(79,70,229,0.5);border:3px solid #ffffff;
        ">
          <span style="transform:rotate(45deg);font-size:18px;">📍</span>
        </div>
      `,
    });
  }, []);

  const setSearchCenterInternal = useCallback(
    (coords: Coords, label?: string) => {
      const L = LRef.current;
      const map = mapRef.current;
      if (!L || !map) return;

      map.setView([coords.lat, coords.lng], 14);

      searchPinRef.current?.remove();
      radiusCircleRef.current?.remove();

      const pin = L.marker([coords.lat, coords.lng], {
        icon: createPinIcon(L),
        draggable: true,
        zIndexOffset: 800,
      }).addTo(map);

      pin.bindPopup(
        `<div style="padding:10px 14px;font-weight:700;font-size:0.85rem;color:#1e293b;">
          📍 ${label || (lang === "hi" ? "चुना गया स्थान" : "Selected Search Center")}
          <div style="font-size:0.75rem;font-weight:500;color:#64748b;margin-top:2px;">
            ${lang === "hi" ? "नया स्थान सेट करने के लिए खींचें" : "Drag pin to move search area"}
          </div>
        </div>`
      );

      pin.on("dragend", (e) => {
        const { lat, lng } = e.target.getLatLng();
        onCenterChangeRef.current({ lat, lng }, lang === "hi" ? "खींचा गया स्थान" : "Updated Location");
      });

      searchPinRef.current = pin;

      radiusCircleRef.current = L.circle([coords.lat, coords.lng], {
        radius: searchRadiusM,
        color: "#2563eb",
        weight: 1.8,
        dashArray: "6, 6",
        fillColor: "#2563eb",
        fillOpacity: 0.05,
      }).addTo(map);
    },
    [lang, createPinIcon, searchRadiusM]
  );

  useImperativeHandle(ref, () => ({
    flyTo: (coords, zoom = 16) => {
      mapRef.current?.flyTo([coords.lat, coords.lng], zoom, { animate: true, duration: 0.8 });
    },
    setSearchCenter: setSearchCenterInternal,
    addGpsMarker: (coords, label) => {
      const L = LRef.current;
      const map = mapRef.current;
      if (!L || !map) return;

      gpsMarkerRef.current?.remove();

      const userPulseIcon = L.divIcon({
        className: "",
        iconSize: [22, 22],
        html: '<div class="user-pulse"></div>',
      });

      gpsMarkerRef.current = L.marker([coords.lat, coords.lng], {
        icon: userPulseIcon,
        zIndexOffset: 1000,
      })
        .addTo(map)
        .bindPopup(
          `<div style="padding:10px 14px;font-weight:700;">📍 ${label}</div>`
        );
    },
    showRoute: (path) => {
      const L = LRef.current;
      const map = mapRef.current;
      if (!L || !map || path.length < 2) return;
      routeLineRef.current?.remove();
      const latlngs = path.map((c) => [c.lat, c.lng] as [number, number]);
      routeLineRef.current = L.polyline(latlngs, {
        color: "#2563eb",
        weight: 5,
        opacity: 0.9,
        lineJoin: "round",
      }).addTo(map);
      map.fitBounds(routeLineRef.current.getBounds(), { padding: [40, 40], maxZoom: 16 });
    },
    clearRoute: () => {
      routeLineRef.current?.remove();
      routeLineRef.current = null;
    },
  }));

  const [initError, setInitError] = useState<string | null>(null);
  const [mapTick, setMapTick] = useState(0);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  /* Initialize Leaflet map (client-only) */
  useEffect(() => {
    if (typeof window === "undefined") return;

    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;
    const sizeTimers: number[] = [];

    (async () => {
      try {
        const leafletModule = await import("leaflet");
        const L = leafletModule.default;
        (window as unknown as { L: typeof L }).L = L;
        await import("leaflet.markercluster");

        if (cancelled || !containerRef.current) return;

        if ((containerRef.current as HTMLDivElement & { _leaflet_id?: number })._leaflet_id) {
          delete (containerRef.current as HTMLDivElement & { _leaflet_id?: number })._leaflet_id;
        }

        LRef.current = L;

        const map = L.map(containerRef.current, {
          center: [centerRef.current.lat, centerRef.current.lng],
          zoom: DEFAULT_ZOOM,
          zoomControl: false,
        });

        L.control.zoom({ position: "bottomright" }).addTo(map);

        L.tileLayer(OSM_TILE_URL, {
          attribution: OSM_ATTRIBUTION,
          maxZoom: 19,
          updateWhenIdle: false,
        }).addTo(map);

        let cluster: MarkerClusterGroup | null = null;
        const withCluster = L as typeof L & { markerClusterGroup?: (opts: object) => MarkerClusterGroup };
        if (typeof withCluster.markerClusterGroup === "function") {
          cluster = withCluster.markerClusterGroup({
            maxClusterRadius: 45,
            spiderfyOnMaxZoom: true,
            showCoverageOnHover: false,
            zoomToBoundsOnClick: true,
            iconCreateFunction: (c) => {
              const count = c.getChildCount();
              let sizeClass = "small";
              if (count > 25) sizeClass = "large";
              else if (count > 10) sizeClass = "medium";

              return L.divIcon({
                html: `<div class="custom-health-cluster cluster-${sizeClass}" title="${count} healthcare places nearby — zoom in or click to expand"><span class="cluster-count">${count}</span><span class="cluster-hint">places</span></div>`,
                className: "custom-cluster-wrapper",
                iconSize: [44, 44],
              });
            },
          });
        }

        if (cluster) {
          map.addLayer(cluster);
          clusterRef.current = cluster;
        } else {
          markerLayerRef.current = L.layerGroup().addTo(map);
        }

        mapRef.current = map;

        map.on("click", (e) => {
          onCenterChangeRef.current(
            { lat: e.latlng.lat, lng: e.latlng.lng },
            lang === "hi" ? "क्लिक किया स्थान" : "Selected Map Point"
          );
        });

        const refreshSize = () => {
          if (!cancelled) map.invalidateSize();
        };
        requestAnimationFrame(refreshSize);
        sizeTimers.push(window.setTimeout(refreshSize, 50));
        sizeTimers.push(window.setTimeout(refreshSize, 250));
        sizeTimers.push(window.setTimeout(refreshSize, 800));

        setSearchCenterInternal(centerRef.current, centerLabelRef.current ?? "Search Location");
        setMapTick((n) => n + 1);
        onReadyRef.current?.();

        resizeObserver = new ResizeObserver(refreshSize);
        resizeObserver.observe(containerRef.current);
      } catch (error) {
        console.error("Leaflet map failed to start:", error);
        if (!cancelled) {
          setInitError(error instanceof Error ? error.message : "Map failed to load");
        }
      }
    })();

    return () => {
      cancelled = true;
      sizeTimers.forEach((id) => window.clearTimeout(id));
      resizeObserver?.disconnect();
      searchPinRef.current?.remove();
      searchPinRef.current = null;
      radiusCircleRef.current?.remove();
      radiusCircleRef.current = null;
      gpsMarkerRef.current?.remove();
      gpsMarkerRef.current = null;
      routeLineRef.current?.remove();
      routeLineRef.current = null;
      clusterRef.current?.clearLayers();
      clusterRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
      LRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* Sync search center pin when center or radius changes */
  useEffect(() => {
    if (!mapRef.current || !LRef.current) return;
    setSearchCenterInternal(center, centerLabel);
  }, [center.lat, center.lng, centerLabel, searchRadiusM, setSearchCenterInternal]);

  /* Render healthcare markers */
  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    const cluster = clusterRef.current;
    const layer = markerLayerRef.current;
    if (!L || !map) return;

    cluster?.clearLayers();
    layer?.clearLayers();

    places.forEach((p) => {
      const isSelected = selectedId === p.id;
      const icon = createMarkerIcon(L, p.type, isSelected);
      const marker = L.marker([p.lat, p.lng], { icon, zIndexOffset: isSelected ? 900 : 100 });

      const meta = FILTER_META[p.type];
      const distanceLabel =
        p.distance < 1 ? `${Math.round(p.distance * 1000)} m` : `${p.distance.toFixed(1)} km`;

      const popupHtml = `
        <div style="padding:14px 16px;min-width:220px;max-width:280px;font-family:inherit;">
          <div style="font-weight:800;font-size:1rem;color:#0f172a;line-height:1.2;margin-bottom:8px;">${p.name}</div>
          <div style="display:inline-block;font-size:0.7rem;font-weight:800;text-transform:uppercase;padding:3px 10px;border-radius:999px;margin-bottom:8px;
            background:${meta.color}22;color:${meta.color};border:1px solid ${meta.color}44;">
            ${meta.emoji} ${meta.label}
          </div>
          <div style="font-size:0.8rem;color:#475569;margin-bottom:8px;line-height:1.4;">
            ${p.address !== "Local Healthcare Center" ? p.address : "<em>Address not available</em>"}
          </div>
          <div style="font-size:0.85rem;color:#64748b;font-weight:700;margin-bottom:12px;">
            📍 ${distanceLabel} away
          </div>
          <button type="button" class="in-app-directions"
            style="display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:8px 12px;width:100%;
              background:#2563eb;color:#fff;border:none;border-radius:10px;font-size:0.8rem;font-weight:700;cursor:pointer;box-sizing:border-box;">
            🧭 Get Directions
          </button>
        </div>
      `;

      marker.bindPopup(popupHtml);
      marker.on("popupopen", () => {
        const btn = document.querySelector(".in-app-directions");
        btn?.addEventListener("click", (ev) => {
          ev.preventDefault();
          onRequestDirectionsRef.current?.(p);
        });
      });
      marker.on("click", () => onMarkerClickRef.current(p.id));
      if (cluster) cluster.addLayer(marker);
      else if (layer) layer.addLayer(marker);
      else marker.addTo(map);
    });
  }, [places, selectedId, createMarkerIcon, mapTick]);

  return (
    <div className="relative h-[450px] w-full md:h-[580px] lg:h-[650px]">
      <div
        ref={containerRef}
        className="absolute inset-0 z-0 h-full w-full"
        role="application"
        aria-label="Healthcare locations map"
      />
      {initError && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-muted/80 p-6 text-center text-sm font-bold text-destructive">
          Map failed to load. Refresh the page.
        </div>
      )}
    </div>
  );
}

export const HealthcareMap = forwardRef(HealthcareMapInner);
