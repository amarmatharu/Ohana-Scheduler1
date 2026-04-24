import React, { useEffect, useMemo, useState } from "react";
import { APIProvider, Map, AdvancedMarker, InfoWindow, useMap } from "@vis.gl/react-google-maps";
import { api } from "../lib/api";
import PageHeader from "../components/PageHeader";
import { Stethoscope, UserRound, MapPin } from "lucide-react";

const MAP_ID = "ohana-map";

function FitBounds({ points }) {
  const map = useMap();
  useEffect(() => {
    if (!map || !window.google || points.length === 0) return;
    const bounds = new window.google.maps.LatLngBounds();
    points.forEach((p) => bounds.extend({ lat: p.lat, lng: p.lng }));
    map.fitBounds(bounds, 80);
  }, [map, points]);
  return null;
}

export default function MapPage() {
  const apiKey = process.env.REACT_APP_GOOGLE_MAPS_API_KEY;
  const [data, setData] = useState({ therapists: [], clients: [] });
  const [active, setActive] = useState(null); // {kind:'t'|'c', item}
  const [filter, setFilter] = useState("all"); // all | therapists | clients

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get("/locations");
        setData(data);
      } catch {}
    })();
  }, []);

  const points = useMemo(() => {
    const t = filter !== "clients" ? data.therapists.map((t) => ({ ...t, kind: "t" })) : [];
    const c = filter !== "therapists" ? data.clients.map((c) => ({ ...c, kind: "c" })) : [];
    return [...t, ...c];
  }, [data, filter]);

  if (!apiKey) {
    return (
      <div className="p-10">
        <div className="bg-[#FCEBEB] border border-[#F4D6D6] rounded-md p-4 text-sm text-[#B85C5C]" data-testid="map-no-key">
          Google Maps API key is not configured.
        </div>
      </div>
    );
  }

  const center = points[0] ? { lat: points[0].lat, lng: points[0].lng } : { lat: 38.9072, lng: -77.0369 };

  return (
    <div>
      <PageHeader
        title="Map view"
        subtitle="Spatial view of therapist home locations and client locations."
        action={
          <div className="flex items-center gap-2 bg-surface border border-soft rounded-md p-1" data-testid="map-filter-group">
            {[
              { key: "all", label: "All" },
              { key: "therapists", label: "Therapists" },
              { key: "clients", label: "Clients" },
            ].map((opt) => (
              <button
                key={opt.key}
                data-testid={`map-filter-${opt.key}`}
                onClick={() => setFilter(opt.key)}
                className={`px-3 py-1.5 rounded text-sm transition-colors ${filter === opt.key ? "bg-[#274f38] text-white" : "text-[#586960] hover:bg-muted-soft"}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        }
      />
      <div className="px-10 pb-10 grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        <div className="bg-surface border border-soft rounded-lg overflow-hidden card-shadow" style={{ height: "70vh" }} data-testid="map-container">
          <APIProvider apiKey={apiKey}>
            <Map
              defaultCenter={center}
              defaultZoom={11}
              mapId={MAP_ID}
              gestureHandling="greedy"
              disableDefaultUI={false}
              streetViewControl={false}
              fullscreenControl={false}
              mapTypeControl={false}
              style={{ width: "100%", height: "100%" }}
            >
              <FitBounds points={points} />
              {points.map((p) => (
                <AdvancedMarker
                  key={`${p.kind}-${p.id}`}
                  position={{ lat: p.lat, lng: p.lng }}
                  onClick={() => setActive({ kind: p.kind, item: p })}
                >
                  <div
                    data-testid={`marker-${p.kind}-${p.id}`}
                    className={`w-10 h-10 rounded-full flex items-center justify-center shadow-md border-2 border-white ${p.kind === "t" ? "bg-[#274f38]" : "bg-[#B07C60]"}`}
                  >
                    {p.kind === "t" ? <Stethoscope size={18} className="text-white" /> : <UserRound size={18} className="text-white" />}
                  </div>
                </AdvancedMarker>
              ))}
              {active && (
                <InfoWindow
                  position={{ lat: active.item.lat, lng: active.item.lng }}
                  onCloseClick={() => setActive(null)}
                  pixelOffset={[0, -40]}
                >
                  <div className="min-w-[220px] p-1" data-testid="map-info">
                    <div className="text-xs uppercase tracking-[0.18em] text-[#586960]">{active.kind === "t" ? "Therapist" : "Client"}</div>
                    <div className="font-medium text-sm mt-1">{active.item.name}</div>
                    <div className="text-xs text-[#586960] mt-1">{active.item.home_address}</div>
                    {active.kind === "t" ? (
                      <div className="mt-2 text-xs font-mono text-[#274f38]">
                        {active.item.current_caseload_hours || 0}/{active.item.capacity_hours_per_week || 0} hr · {active.item.skill_level}
                      </div>
                    ) : (
                      <div className="mt-2 text-xs font-mono text-[#274f38]">
                        Needs {active.item.needed_hours_per_week} hr/wk · {active.item.age_group}
                      </div>
                    )}
                  </div>
                </InfoWindow>
              )}
            </Map>
          </APIProvider>
        </div>

        <aside className="bg-surface border border-soft rounded-lg card-shadow flex flex-col" data-testid="map-sidebar">
          <div className="px-5 py-4 border-b border-soft">
            <div className="text-xs uppercase tracking-[0.18em] text-muted-ohana font-semibold">Markers</div>
            <div className="mt-3 flex items-center gap-4 text-xs">
              <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-[#274f38]"></span> Therapist</span>
              <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-[#B07C60]"></span> Client</span>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-[#E3DFD5]">
            {points.length === 0 && (
              <div className="px-5 py-8 text-center text-muted-ohana text-sm">No geocoded locations yet.</div>
            )}
            {points.map((p) => (
              <button
                key={`${p.kind}-${p.id}`}
                data-testid={`sidebar-${p.kind}-${p.id}`}
                onClick={() => setActive({ kind: p.kind, item: p })}
                className="w-full text-left px-5 py-3 hover:bg-muted-soft transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${p.kind === "t" ? "bg-[#274f38]" : "bg-[#B07C60]"}`}></span>
                  <span className="text-sm font-medium">{p.name}</span>
                </div>
                <div className="text-xs text-muted-ohana mt-0.5 inline-flex items-center gap-1"><MapPin size={11}/>{p.home_address}</div>
              </button>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
