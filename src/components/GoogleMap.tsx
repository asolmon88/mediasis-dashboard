"use client";
import {
  AdvancedMarker,
  Map,
  MapMouseEvent,
  Pin,
  useMapsLibrary,
} from "@vis.gl/react-google-maps";
import React from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type LatLng = { lat: number; lng: number };

type GoogleMapProps = {
  value: LatLng | null;                    // <-- current form value
  onChange: (v: LatLng) => void;
  defaultZoom?: number;
}

const GoogleMap = ({ value, onChange, defaultZoom = 9 }:GoogleMapProps) => {
  const places = useMapsLibrary("places");
  const [mapCenter, setMapCenter] = React.useState<LatLng | null>(value);
  const [searchText, setSearchText] = React.useState("");
  const [searching, setSearching] = React.useState(false);
  const [suggestions, setSuggestions] = React.useState<
    google.maps.places.AutocompleteSuggestion[]
  >([]);
  const [sessionToken, setSessionToken] =
    React.useState<google.maps.places.AutocompleteSessionToken | null>(null);

  React.useEffect(() => {
    setMapCenter(value);
  }, [value]);

  React.useEffect(() => {
    if (!places) return;
    if (!searchText.trim()) {
      setSuggestions([]);
      return;
    }

    const timer = window.setTimeout(async () => {
      try {
        const token =
          sessionToken ?? new google.maps.places.AutocompleteSessionToken();

        if (!sessionToken) {
          setSessionToken(token);
        }

        const request: google.maps.places.AutocompleteRequest = {
          input: searchText,
          origin: mapCenter ?? undefined,
          locationBias: mapCenter
            ? {
                center: mapCenter,
                radius: 5000,
              }
            : undefined,
          sessionToken: token,
        };

        const { suggestions: nextSuggestions = [] } =
          await google.maps.places.AutocompleteSuggestion.fetchAutocompleteSuggestions(
            request
          );

        setSuggestions(nextSuggestions);
      } catch {
        setSuggestions([]);
      }
    }, 250);

    return () => window.clearTimeout(timer);
  }, [mapCenter, places, searchText, sessionToken]);

  const applyLocation = React.useCallback(
    (nextLocation: LatLng) => {
      onChange(nextLocation);
      setMapCenter(nextLocation);
    },
    [onChange]
  );

  const handleMapClick = (e: MapMouseEvent) => {
    const ll = e.detail?.latLng;
    if (!ll) return;
    applyLocation({ lat: ll.lat, lng: ll.lng });
  };

  const handleMarkerDragEnd = (e: google.maps.MapMouseEvent) => {
    const ll = e.latLng;
    if (!ll) return;
    applyLocation({ lat: ll.lat(), lng: ll.lng() });
  };

  const defaultCenter = { lat: 9.7489, lng: -83.7534 };

  const handleSuggestionSelect = async (
    suggestion: google.maps.places.AutocompleteSuggestion
  ) => {
    const prediction = suggestion.placePrediction;
    if (!prediction?.toPlace) return;

    const place = await prediction.toPlace();
    await place.fetchFields({ fields: ["location"] });

    const location = place.location;
    if (!location) return;

    applyLocation({ lat: location.lat(), lng: location.lng() });
    setSearchText("");
    setSuggestions([]);
    setSessionToken(null);
  };

  const runSearch = async () => {
    const query = searchText.trim();
    if (!query || !places) return;

    setSearching(true);

    try {
      const request: google.maps.places.SearchByTextRequest = {
        textQuery: query,
        fields: ["location"],
      };
      const response = await google.maps.places.Place.searchByText(request);
      const first = response?.places?.[0];
      const location = first?.location;
      if (!location) return;

      applyLocation({ lat: location.lat(), lng: location.lng() });
      setSuggestions([]);
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="w-full space-y-3">
      <div className="space-y-1">
        <div className="relative">
          <div className="flex flex-col gap-2 min-[390px]:flex-row">
            <Input
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="Escribe una referencia o direccion"
              autoComplete="off"
            />
            <Button type="button" className="shrink-0" onClick={runSearch} disabled={!places || searching}>
              Buscar
            </Button>
          </div>
          {suggestions.length > 0 && (
            <div className="absolute z-50 mt-2 max-h-52 w-full overflow-y-auto overscroll-contain rounded-md border bg-background shadow-md">
              {suggestions.map((suggestion, index) => {
                const prediction = suggestion.placePrediction;
                const label = prediction?.text?.text ?? "Resultado";

                return (
                  <button
                    key={`${label}-${index}`}
                    type="button"
                    className="w-full px-3 py-2 text-left text-sm hover:bg-muted"
                    onClick={() => void handleSuggestionSelect(suggestion)}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
      <div className="h-[clamp(15rem,38dvh,22rem)] w-full touch-none overflow-hidden rounded-xl border bg-muted">
        <Map
          mapId={process.env.NEXT_PUBLIC_MAP_ID}
          defaultZoom={defaultZoom}
          center={mapCenter ?? defaultCenter}
          onCameraChanged={(event) => setMapCenter(event.detail.center)}
          gestureHandling="greedy"
          disableDefaultUI={false}
          onClick={handleMapClick}
        />
        {value && (
          <AdvancedMarker
            position={value}
            draggable
            onDragEnd={handleMarkerDragEnd}
          >
            <Pin />
          </AdvancedMarker>
        )}
      </div>
    </div>
  );
};

export default GoogleMap;
