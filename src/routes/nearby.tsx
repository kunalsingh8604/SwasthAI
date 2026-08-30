import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState, useMemo } from "react";
import { MobileShell } from "@/components/MobileShell";
import { HealthcareMap, type HealthcareMapHandle } from "@/components/HealthcareMap";
import { useLanguage } from "@/hooks/useLanguage";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  MapPin, Navigation, Hospital, Pill, Stethoscope, UserRound,
  Loader2, AlertTriangle, LocateFixed, Search, X,
  Star, Phone, Clock, ShieldAlert, CheckCircle2, Copy,
  Compass, Layers, RefreshCw, Map as MapIcon, List, Radar
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  type FacilityType,
  type FilterType,
  type SortOption,
  type Coords,
  type Place,
  type GeoResult,
  DEFAULT_CENTER,
  FILTER_META,
  SEARCH_RADIUS_OPTIONS,
  fetchPlacesForLocation,
  geocodeSearch,
  fetchDrivingRoute,
} from "@/lib/healthcare-places";

type NearbySearch = {
  type?: FacilityType;
  condition?: string;
  emergency?: "1";
};

export const Route = createFileRoute("/nearby")({
  validateSearch: (s: Record<string, unknown>): NearbySearch => {
    const type = s.type;
    return {
      type:
        type === "hospital" || type === "clinic" || type === "pharmacy" || type === "doctor"
          ? type
          : undefined,
      condition: typeof s.condition === "string" ? s.condition.slice(0, 120) : undefined,
      emergency: s.emergency === "1" || s.emergency === true ? "1" : undefined,
    };
  },
  component: Nearby,
});

/* UI-only filter metadata (icons & styling) */
const FILTER_UI: Record<
  FacilityType,
  { icon: typeof Hospital; bg: string; border: string }
> = {
  hospital: { icon: Hospital, bg: "bg-red-500/10 text-red-600 dark:text-red-400", border: "border-red-500/30" },
  clinic: { icon: Stethoscope, bg: "bg-blue-500/10 text-blue-600 dark:text-blue-400", border: "border-blue-500/30" },
  pharmacy: { icon: Pill, bg: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", border: "border-emerald-500/30" },
  doctor: { icon: UserRound, bg: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400", border: "border-yellow-500/30" },
};

const LAST_GPS_KEY = "swasthai_last_gps";

function readSavedGps(): Coords | null {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(LAST_GPS_KEY) || "");
    if (typeof parsed?.lat === "number" && typeof parsed?.lng === "number") return parsed;
  } catch {
    /* ignore */
  }
  return null;
}

function saveGps(coords: Coords) {
  try {
    localStorage.setItem(LAST_GPS_KEY, JSON.stringify(coords));
  } catch {
    /* ignore */
  }
}

function requestBrowserGps(force = false): Promise<Coords> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("Geolocation is not supported by this browser"));
      return;
    }
    if (typeof window !== "undefined" && !window.isSecureContext) {
      reject(
        new Error("Location is blocked on this URL. Open the app at http://localhost:8081 (not the Network IP).")
      );
      return;
    }

    const tryOnce = (highAccuracy: boolean, timeout: number, isLast: boolean) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        (err) => {
          if (!isLast) {
            tryOnce(false, 20000, true);
            return;
          }
          reject(err);
        },
        { enableHighAccuracy: highAccuracy, timeout, maximumAge: force ? 0 : 120000 }
      );
    };

    tryOnce(true, 8000, false);
  });
}

async function requestIpLocation(): Promise<{ coords: Coords; city?: string } | null> {
  try {
    const res = await fetch("https://ipapi.co/json/");
    if (!res.ok) return null;
    const data = await res.json();
    if (typeof data.latitude !== "number" || typeof data.longitude !== "number") return null;
    return {
      coords: { lat: data.latitude, lng: data.longitude },
      city: data.city,
    };
  } catch {
    return null;
  }
}

function Nearby() {
  const { lang } = useLanguage();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const mapHandle = useRef<HealthcareMapHandle>(null);
  const cardRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [center, setCenter] = useState<Coords>(() => readSavedGps() || DEFAULT_CENTER);
  const [centerLabel, setCenterLabel] = useState("Search Location");
  const [gpsStatus, setGpsStatus] = useState<"idle" | "prompt" | "loading" | "granted" | "denied" | "approx">("idle");
  const [places, setPlaces] = useState<Place[]>([]);
  const [placesLoad, setPlacesLoad] = useState(true);
  const [mapReady, setMapReady] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const [searchRadiusM, setSearchRadiusM] = useState(5000);
  const [filter, setFilter] = useState<FilterType>("all");
  const [openNowOnly, setOpenNowOnly] = useState(false);
  const [emergencyOnly, setEmergencyOnly] = useState(false);
  const [minRating, setMinRating] = useState(0);
  const [sortBy, setSortBy] = useState<SortOption>("nearest");
  const [symptomCondition, setSymptomCondition] = useState<string | undefined>(search.condition);

  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<GeoResult[]>([]);
  const [searchLoad, setSearchLoad] = useState(false);
  const [mobileTab, setMobileTab] = useState<"list" | "map">("list");
  const [routeInfo, setRouteInfo] = useState<{ name: string; distanceKm: number; durationMin: number } | null>(null);
  const [routeLoad, setRouteLoad] = useState(false);

  useEffect(() => {
    if (search.type) setFilter(search.type);
    if (search.emergency === "1") {
      setEmergencyOnly(true);
      setSearchRadiusM(10000);
      setFilter(search.type || "hospital");
    }
    if (search.condition) {
      setSymptomCondition(search.condition);
      setMobileTab("list");
    }
  }, [search.type, search.condition, search.emergency]);

  const moveToCoords = (coords: Coords, label?: string) => {
    setCenter(coords);
    if (label) setCenterLabel(label);
  };

  const applyUserLocation = (coords: Coords, label: string) => {
    saveGps(coords);
    setGpsStatus("granted");
    mapHandle.current?.addGpsMarker(coords, lang === "hi" ? "आप यहाँ हैं (GPS)" : "You Are Here (GPS)");
    moveToCoords(coords, label);
  };

  const locateUser = async (force = false, silent = false) => {
    setGpsStatus("loading");
    try {
      const coords = await requestBrowserGps(force);
      applyUserLocation(coords, lang === "hi" ? "आपका स्थान" : "Your Location");
      if (!silent) toast.success(lang === "hi" ? "स्थान मिल गया" : "Moved to your current location");
    } catch (gpsError) {
      setGpsStatus("denied");
      if (!silent) {
        const message =
          gpsError instanceof Error
            ? gpsError.message
            : "Allow location when the browser asks, then try again.";
        toast.error(message);
      }
    }
  };

  const useCityFallback = async () => {
    setGpsStatus("loading");
    const ip = await requestIpLocation();
    if (ip) {
      applyUserLocation(ip.coords, ip.city || (lang === "hi" ? "आपका शहर" : "Your city"));
      setGpsStatus("approx");
      toast.message(lang === "hi" ? "शहर के अनुसार केंद्र दिखाए जा रहे हैं" : "Showing centres near your city (not GPS)");
      return;
    }
    setGpsStatus("denied");
    toast.error("Could not detect your city. Search a locality in the box above.");
  };

  const handleMapReady = () => {
    setMapReady(true);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (typeof navigator === "undefined" || !navigator.geolocation) {
        setGpsStatus("denied");
        return;
      }
      try {
        const status = await navigator.permissions.query({ name: "geolocation" as PermissionName });
        if (cancelled) return;
        if (status.state === "granted") {
          await locateUser(false, true);
        } else if (status.state === "denied") {
          setGpsStatus("denied");
        } else {
          setGpsStatus("prompt");
        }
        status.onchange = () => {
          if (status.state === "granted") void locateUser(false, true);
          if (status.state === "denied") setGpsStatus("denied");
        };
      } catch {
        setGpsStatus("prompt");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadNearbyFacilities = (forceRefresh = false) => {
    setPlacesLoad(true);
    setErr(null);

    fetchPlacesForLocation(center, searchRadiusM, forceRefresh)
      .then((res) => setPlaces(res))
      .catch((e: Error) => setErr(e.message || "Failed to load healthcare places."))
      .finally(() => setPlacesLoad(false));
  };

  /* Auto-search on map load and when center/radius changes */
  useEffect(() => {
    let isCancelled = false;
    setPlacesLoad(true);
    setErr(null);

    fetchPlacesForLocation(center, searchRadiusM)
      .then((res) => {
        if (!isCancelled) setPlaces(res);
      })
      .catch((e: Error) => {
        if (!isCancelled) setErr(e.message || "Failed to load healthcare places.");
      })
      .finally(() => {
        if (!isCancelled) setPlacesLoad(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [center, searchRadiusM]);

  const filteredPlaces = useMemo(() => {
    return places
      .filter((p) => {
        if (filter !== "all" && p.type !== filter) return false;
        if (openNowOnly && !p.isOpenNow) return false;
        if (emergencyOnly && !p.isEmergency) return false;
        if (minRating > 0 && p.rating < minRating) return false;
        if (query.trim()) {
          const q = query.toLowerCase().trim();
          if (!p.name.toLowerCase().includes(q) && !p.address.toLowerCase().includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => (sortBy === "rating" ? b.rating - a.rating : a.distance - b.distance));
  }, [places, filter, openNowOnly, emergencyOnly, minRating, query, sortBy]);

  const showDirections = async (p: Place) => {
    setMobileTab("map");
    setSelectedId(p.id);
    setRouteLoad(true);
    try {
      const route = await fetchDrivingRoute(center, { lat: p.lat, lng: p.lng });
      mapHandle.current?.showRoute(route.coordinates);
      setRouteInfo({
        name: p.name,
        distanceKm: route.distanceKm,
        durationMin: route.durationMin,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not get directions");
    } finally {
      setRouteLoad(false);
    }
  };

  const clearDirections = () => {
    mapHandle.current?.clearRoute();
    setRouteInfo(null);
  };

  const selectPlaceCard = (p: Place) => {
    setSelectedId(p.id);
    mapHandle.current?.flyTo({ lat: p.lat, lng: p.lng });
  };

  const handleMarkerClick = (id: number) => {
    setSelectedId(id);
    cardRefs.current[id]?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  const handleSearchChange = (val: string) => {
    setQuery(val);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (val.trim().length < 3) {
      setSuggestions([]);
      return;
    }
    searchTimeout.current = setTimeout(async () => {
      setSearchLoad(true);
      setSuggestions(await geocodeSearch(val));
      setSearchLoad(false);
    }, 350);
  };

  const selectSearchSuggestion = (res: GeoResult) => {
    setSuggestions([]);
    const title = res.display_name.split(",")[0];
    setQuery(title);
    moveToCoords({ lat: parseFloat(res.lat), lng: parseFloat(res.lon) }, title);
  };

  const triggerGPSLocate = () => {
    void locateUser(true, false);
  };

  const resetAllFilters = () => {
    setFilter("all");
    setOpenNowOnly(false);
    setEmergencyOnly(false);
    setMinRating(0);
    setQuery("");
    setSortBy("nearest");
    setSymptomCondition(undefined);
    void navigate({ search: {} });
  };

  const clearSymptomContext = () => {
    setSymptomCondition(undefined);
    setEmergencyOnly(false);
    setFilter("all");
    void navigate({ search: {} });
  };

  const copyAddress = (address: string) => {
    navigator.clipboard.writeText(address);
    toast.success("Address copied to clipboard");
  };

  return (
    <MobileShell>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-foreground md:text-3xl">
            {lang === "hi" ? "आस-पास स्वास्थ्य केंद्र" : "Nearby Healthcare"}
          </h1>
          <p className="text-xs text-muted-foreground">
            {lang === "hi"
              ? "अस्पताल, क्लीनिक और दवा दुकानें खोजें — लाइव मैप और दूरी"
              : "Discover emergency hospitals, clinics, and 24/7 pharmacies near you"}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => loadNearbyFacilities(true)}
            disabled={placesLoad}
            className="h-10 rounded-2xl px-4 font-bold shadow-sm active:scale-95"
          >
            {placesLoad ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Radar className="mr-2 h-4 w-4" />
            )}
            {lang === "hi" ? "आस-पास खोजें" : "Search Nearby"}
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={triggerGPSLocate}
            disabled={gpsStatus === "loading"}
            className="h-10 rounded-2xl border-primary/20 bg-card px-4 font-bold text-primary shadow-sm hover:bg-primary/10 active:scale-95"
          >
            {gpsStatus === "loading" ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin text-primary" />
            ) : (
              <LocateFixed className="mr-2 h-4 w-4 text-primary" />
            )}
            {lang === "hi" ? "मेरा स्थान" : "Locate Me"}
          </Button>

          <div className="flex rounded-2xl bg-muted p-1 lg:hidden">
            <button
              onClick={() => setMobileTab("list")}
              className={cn(
                "flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs font-bold transition-all",
                mobileTab === "list" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
              )}
            >
              <List className="h-3.5 w-3.5" /> List
            </button>
            <button
              onClick={() => setMobileTab("map")}
              className={cn(
                "flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs font-bold transition-all",
                mobileTab === "map" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
              )}
            >
              <MapIcon className="h-3.5 w-3.5" /> Map
            </button>
          </div>
        </div>
      </div>

      {symptomCondition && (
        <Card className="mb-4 rounded-3xl border-2 border-emerald-500/30 bg-emerald-500/10 p-4 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/20 text-emerald-700 dark:text-emerald-400">
              <Stethoscope className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-black text-foreground">
                {lang === "hi" ? "लक्षण जाँच से खोला गया" : "Opened from Symptom Checker"}
              </p>
              <p className="mt-1 text-sm text-foreground/90">
                {lang === "hi" ? "चिंता: " : "Concern: "}
                <span className="font-semibold">{symptomCondition}</span>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {lang === "hi"
                  ? `मैप पर ${filter === "all" ? "सभी केंद्र" : FILTER_META[filter as FacilityType]?.hi || filter} दिखाए जा रहे हैं।`
                  : `Showing nearby ${filter === "all" ? "care centres" : (FILTER_META[filter as FacilityType]?.en || filter).toLowerCase()} for this concern.`}
              </p>
            </div>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-9 w-9 shrink-0 rounded-xl"
              onClick={clearSymptomContext}
              aria-label={lang === "hi" ? "फ़िल्टर हटाएँ" : "Clear filter"}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </Card>
      )}

      {gpsStatus !== "granted" && gpsStatus !== "loading" && (
        <Card className="mb-4 rounded-3xl border-2 border-primary/30 bg-primary/5 p-4 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/15 text-primary">
                <LocateFixed className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-black text-foreground">
                  {gpsStatus === "denied"
                    ? lang === "hi"
                      ? "लोकेशन ब्लॉक है"
                      : "Location is blocked"
                    : lang === "hi"
                      ? "पास के केंद्र देखने के लिए लोकेशन दें"
                      : "Allow location to see centres near you"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {gpsStatus === "denied"
                    ? lang === "hi"
                      ? "ब्राउज़र एड्रेस बार में लोकेशन आइकन पर क्लिक करके Allow करें, फिर दोबारा कोशिश करें।"
                      : "Click the lock/location icon in the address bar, set Location to Allow, then try again. Use http://localhost:8081"
                    : lang === "hi"
                      ? "ब्राउज़र पॉपअप में Allow दबाएँ। तब नक्शा आपके आस-पास के अस्पताल दिखाएगा।"
                      : "Your browser will ask for permission. Tap Allow so the map can load hospitals around you."}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button
                size="sm"
                className="rounded-2xl font-bold"
                onClick={() => void locateUser(true, false)}
              >
                <LocateFixed className="mr-2 h-4 w-4" />
                {lang === "hi" ? "लोकेशन दें" : "Allow location"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="rounded-2xl font-bold"
                onClick={() => void useCityFallback()}
              >
                {lang === "hi" ? "शहर से खोजें" : "Use my city"}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {gpsStatus === "loading" && (
        <div className="mb-4 flex items-center gap-2 text-xs font-bold text-primary">
          <Loader2 className="h-4 w-4 animate-spin" />
          {lang === "hi" ? "लोकेशन मांगी जा रही है — Allow दबाएँ" : "Waiting for location — tap Allow in the browser popup"}
        </div>
      )}

      <div className="relative mb-4">
        <div className="flex items-center gap-3 rounded-2xl border-2 border-primary/15 bg-card px-4 py-3 shadow-md backdrop-blur-md transition-all focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/10">
          <Search className="h-5 w-5 shrink-0 text-primary" />
          <input
            value={query}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder={
              lang === "hi"
                ? "शहर, क्षेत्र या स्थान खोजें… (e.g. Connaught Place, AIIMS)"
                : "Search city, landmark or locality… (e.g., Connaught Place, AIIMS)"
            }
            className="flex-1 bg-transparent text-sm font-medium outline-none placeholder:text-muted-foreground/60"
          />
          {searchLoad && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
          {query && !searchLoad && (
            <button
              onClick={() => { setQuery(""); setSuggestions([]); }}
              className="rounded-full p-1 hover:bg-muted"
            >
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          )}
        </div>

        {suggestions.length > 0 && (
          <div className="absolute left-0 right-0 z-50 mt-2 overflow-hidden rounded-3xl border border-primary/20 bg-card/95 p-2 shadow-2xl backdrop-blur-xl">
            {suggestions.map((res, i) => (
              <button
                key={i}
                onClick={() => selectSearchSuggestion(res)}
                className="flex w-full items-center gap-3 rounded-2xl p-3 text-left transition-colors hover:bg-primary/10"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <MapPin className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-1 text-sm font-bold text-foreground">
                    {res.display_name.split(",")[0]}
                  </p>
                  <p className="line-clamp-1 text-xs text-muted-foreground">{res.display_name}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mb-4 space-y-3">
        {/* Search radius filter */}
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border bg-card/60 p-2 shadow-sm">
          <span className="px-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            {lang === "hi" ? "दूरी:" : "Radius:"}
          </span>
          {SEARCH_RADIUS_OPTIONS.map(({ km, meters, label }) => (
            <button
              key={km}
              onClick={() => setSearchRadiusM(meters)}
              className={cn(
                "rounded-xl px-3 py-1.5 text-xs font-bold transition-all",
                searchRadiusM === meters
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-muted text-muted-foreground hover:bg-accent"
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setFilter("all")}
            className={cn(
              "inline-flex items-center gap-2 rounded-2xl px-4 py-2.5 text-xs font-black transition-all active:scale-95",
              filter === "all"
                ? "bg-primary text-primary-foreground shadow-lg shadow-primary/25 ring-2 ring-primary/40"
                : "border bg-card text-foreground hover:bg-accent"
            )}
          >
            <Layers className="h-4 w-4" />
            {lang === "hi" ? "सभी" : "All Care"}
            {filter === "all" && !placesLoad && (
              <span className="rounded-full bg-white/20 px-2 py-0.5 text-[10px]">{filteredPlaces.length}</span>
            )}
          </button>

          {(Object.keys(FILTER_META) as FacilityType[]).map((key) => {
            const meta = FILTER_META[key];
            const ui = FILTER_UI[key];
            const Icon = ui.icon;
            const isActive = filter === key;
            return (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-2xl px-4 py-2.5 text-xs font-black transition-all active:scale-95",
                  isActive
                    ? "bg-primary text-primary-foreground shadow-lg shadow-primary/25 ring-2 ring-primary/40"
                    : "border bg-card text-foreground hover:bg-accent"
                )}
              >
                <Icon className="h-4 w-4" />
                {lang === "hi" ? meta.hi : meta.en}
                {isActive && !placesLoad && (
                  <span className="rounded-full bg-white/20 px-2 py-0.5 text-[10px]">{filteredPlaces.length}</span>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border bg-card/60 p-2 shadow-sm backdrop-blur-sm">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setOpenNowOnly(!openNowOnly)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition-all",
                openNowOnly ? "bg-emerald-500 text-white shadow-sm" : "bg-muted text-muted-foreground hover:bg-accent"
              )}
            >
              <CheckCircle2 className="h-3.5 w-3.5" /> Open Now
            </button>
            <button
              onClick={() => setEmergencyOnly(!emergencyOnly)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition-all",
                emergencyOnly ? "bg-red-500 text-white shadow-sm" : "bg-muted text-muted-foreground hover:bg-accent"
              )}
            >
              <ShieldAlert className="h-3.5 w-3.5" /> 24/7 Emergency
            </button>
            <button
              onClick={() => setMinRating(minRating === 4 ? 0 : 4)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition-all",
                minRating === 4 ? "bg-amber-500 text-white shadow-sm" : "bg-muted text-muted-foreground hover:bg-accent"
              )}
            >
              <Star className="h-3.5 w-3.5 fill-current" /> 4.0+ Stars
            </button>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Sort:</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              className="rounded-xl border bg-background px-3 py-1.5 text-xs font-bold outline-none cursor-pointer hover:bg-accent"
            >
              <option value="nearest">Nearest First 📍</option>
              <option value="rating">Top Rated ⭐</option>
            </select>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className={cn("lg:col-span-5 lg:block", mobileTab === "map" ? "hidden" : "block")}>
          {placesLoad && (
            <div className="space-y-4">
              <div className="flex items-center justify-center gap-2 py-4 text-xs font-bold text-primary animate-pulse">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span>{lang === "hi" ? "आस-पास खोज रहे हैं…" : "Fetching nearby healthcare facilities…"}</span>
              </div>
              {[1, 2, 3, 4].map((i) => (
                <Card key={i} className="animate-pulse rounded-3xl border-2 p-5 shadow-sm space-y-3">
                  <div className="flex justify-between items-center">
                    <div className="h-4 w-1/3 bg-muted rounded-lg" />
                    <div className="h-4 w-16 bg-muted rounded-full" />
                  </div>
                  <div className="h-6 w-3/4 bg-muted rounded-lg" />
                  <div className="h-4 w-1/2 bg-muted rounded-lg" />
                  <div className="flex gap-2 pt-2">
                    <div className="h-10 flex-1 bg-muted rounded-xl" />
                    <div className="h-10 w-10 bg-muted rounded-xl" />
                  </div>
                </Card>
              ))}
            </div>
          )}

          {!placesLoad && err && (
            <Card className="rounded-3xl border-2 border-destructive/20 bg-destructive/5 p-6 text-center shadow-md">
              <AlertTriangle className="mx-auto h-10 w-10 text-destructive mb-2" />
              <h3 className="font-bold text-destructive text-base">Could not load places</h3>
              <p className="text-xs text-muted-foreground mt-1 mb-4">{err}</p>
              <Button size="sm" variant="outline" onClick={() => loadNearbyFacilities(true)} className="rounded-xl font-bold">
                <RefreshCw className="mr-2 h-4 w-4" /> Retry Request
              </Button>
            </Card>
          )}

          {!placesLoad && !err && filteredPlaces.length === 0 && (
            <Card className="rounded-3xl border-2 border-dashed p-10 text-center bg-card/40">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-muted text-muted-foreground mb-4">
                <Compass className="h-8 w-8" />
              </div>
              <h3 className="text-lg font-bold text-foreground mb-1">
                {lang === "hi" ? "आस-पास कोई सुविधा नहीं मिली" : "No facilities found nearby"}
              </h3>
              <p className="text-xs text-muted-foreground max-w-xs mx-auto mb-6">
                {lang === "hi"
                  ? "अपनी खोज फ़िल्टर बदलें या किसी अन्य स्थान पर प्रयास करें।"
                  : "Try clearing active filters or searching for another neighborhood or city."}
              </p>
              <Button onClick={resetAllFilters} className="rounded-2xl font-bold shadow-md">
                Reset All Filters
              </Button>
            </Card>
          )}

          {!placesLoad && !err && filteredPlaces.length > 0 && (
            <div className="custom-scrollbar space-y-4 overflow-y-auto pr-1 lg:max-h-[calc(100vh-280px)]">
              {filteredPlaces.map((p) => {
                const isSelected = selectedId === p.id;
                const meta = FILTER_META[p.type];
                const ui = FILTER_UI[p.type];
                const TypeIcon = ui.icon;

                return (
                  <div key={p.id} ref={(el) => { cardRefs.current[p.id] = el; }}>
                    <Card
                      onClick={() => selectPlaceCard(p)}
                      className={cn(
                        "group cursor-pointer rounded-3xl border-2 p-5 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-primary/40 hover:shadow-xl relative overflow-hidden",
                        isSelected ? "border-primary bg-primary/5 ring-4 ring-primary/15 shadow-xl" : "bg-card"
                      )}
                    >
                      <div className="flex items-center justify-between gap-2 mb-3">
                        <div className="flex items-center gap-2">
                          <span className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-wider border", ui.bg, ui.border)}>
                            <TypeIcon className="h-3 w-3" />
                            {meta.label}
                          </span>
                          {p.isOpenNow ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-black text-emerald-600 dark:text-emerald-400">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" /> Open Now
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-slate-500/10 px-2.5 py-0.5 text-[10px] font-black text-slate-500">Closed</span>
                          )}
                        </div>
                        {p.isEmergency && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2.5 py-0.5 text-[10px] font-black text-red-600 border border-red-500/20">🚨 24/7</span>
                        )}
                      </div>

                      <h3 className="text-base font-black leading-snug text-foreground group-hover:text-primary transition-colors">{p.name}</h3>
                      <p className="line-clamp-2 text-xs text-muted-foreground mt-1 leading-relaxed">{p.address}</p>

                      <div className="mt-3 flex items-center gap-4 text-xs border-t border-dashed pt-3">
                        <div className="flex items-center gap-1 text-amber-500 font-black">
                          <Star className="h-3.5 w-3.5 fill-current" />
                          <span>{p.rating}</span>
                          <span className="text-[10px] font-medium text-muted-foreground">({p.reviewCount})</span>
                        </div>
                        <div className="flex items-center gap-1 font-bold text-primary">
                          <MapPin className="h-3.5 w-3.5" />
                          <span>{p.distance < 1 ? `${Math.round(p.distance * 1000)} m` : `${p.distance.toFixed(1)} km`}</span>
                        </div>
                        {p.opening_hours && (
                          <div className="flex items-center gap-1 text-[10px] text-muted-foreground truncate max-w-[140px]">
                            <Clock className="h-3 w-3 shrink-0" />
                            <span className="truncate">{p.opening_hours}</span>
                          </div>
                        )}
                      </div>

                      <div className="mt-4 grid grid-cols-3 gap-2">
                        <Button
                          size="sm"
                          className="h-10 rounded-2xl font-bold text-xs bg-primary text-primary-foreground shadow-md transition-all hover:scale-[1.02] col-span-2"
                          onClick={(e) => { e.stopPropagation(); void showDirections(p); }}
                        >
                          <Navigation className="mr-1.5 h-3.5 w-3.5" /> Directions
                        </Button>
                        {p.phone ? (
                          <Button
                            size="sm" variant="secondary"
                            className="h-10 rounded-2xl font-bold text-xs hover:bg-accent"
                            onClick={(e) => { e.stopPropagation(); window.location.href = `tel:${p.phone}`; }}
                          >
                            <Phone className="mr-1 h-3.5 w-3.5" /> Call
                          </Button>
                        ) : (
                          <Button
                            size="sm" variant="outline"
                            className="h-10 rounded-2xl font-bold text-xs hover:bg-accent"
                            onClick={(e) => { e.stopPropagation(); copyAddress(p.address); }}
                          >
                            <Copy className="mr-1 h-3.5 w-3.5" /> Copy
                          </Button>
                        )}
                      </div>
                    </Card>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className={cn("lg:col-span-7", mobileTab === "list" ? "max-lg:hidden" : "block")}>
          <Card className="map-container relative sticky top-24 overflow-hidden rounded-[2.5rem] border-2 border-primary/20 shadow-2xl bg-card">
            <HealthcareMap
              ref={mapHandle}
              center={center}
              centerLabel={centerLabel}
              searchRadiusM={searchRadiusM}
              places={filteredPlaces}
              selectedId={selectedId}
              lang={lang}
              onCenterChange={moveToCoords}
              onMarkerClick={handleMarkerClick}
              onRequestDirections={(p) => void showDirections(p)}
              onReady={handleMapReady}
            />

            <div className="absolute top-4 left-4 z-[400] flex items-center gap-2 rounded-2xl bg-card/90 px-4 py-2 text-xs font-black shadow-xl backdrop-blur-md border border-white/40">
              {placesLoad ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                  <span>Loading centers…</span>
                </>
              ) : (
                <>
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span>{filteredPlaces.length} centers visible</span>
                </>
              )}
            </div>

            {(routeLoad || routeInfo) && (
              <div className="absolute top-4 right-4 z-[400] max-w-[220px] rounded-2xl border border-white/40 bg-card/95 p-3 text-xs shadow-xl backdrop-blur-md">
                {routeLoad ? (
                  <div className="flex items-center gap-2 font-bold text-primary">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Calculating route…
                  </div>
                ) : routeInfo ? (
                  <div>
                    <p className="font-black text-foreground line-clamp-2">{routeInfo.name}</p>
                    <p className="mt-1 font-bold text-primary">
                      {routeInfo.distanceKm < 1
                        ? `${Math.round(routeInfo.distanceKm * 1000)} m`
                        : `${routeInfo.distanceKm.toFixed(1)} km`}
                      {" · "}
                      ~{routeInfo.durationMin} min drive
                    </p>
                    <button
                      type="button"
                      onClick={clearDirections}
                      className="mt-2 font-bold text-muted-foreground hover:text-foreground"
                    >
                      Clear route
                    </button>
                  </div>
                ) : null}
              </div>
            )}

            <button
              onClick={triggerGPSLocate}
              className="absolute bottom-6 left-4 z-[400] flex h-12 w-12 items-center justify-center rounded-2xl bg-card shadow-2xl border text-primary transition-all hover:scale-110 active:scale-95"
              aria-label="Locate me on map"
            >
              <LocateFixed className="h-6 w-6" />
            </button>
          </Card>

          {!mapReady && (
            <div className="mt-3 flex items-center justify-center gap-2 text-xs font-bold text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              Initialising interactive map…
            </div>
          )}
        </div>
      </div>
    </MobileShell>
  );
}
