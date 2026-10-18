"use client";

import GoogleMap from "@/components/GoogleMap";
import { GoogleMapProvider } from "@/providers/GoogleMapProvider";

type Location = { lat: number; lng: number };

export default function CreateBusinessMapField({
  value,
  onChange,
  defaultZoom,
}: {
  value: Location | null;
  onChange: (location: Location) => void;
  defaultZoom?: number;
}) {
  return (
    <GoogleMapProvider apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAP_API_KEY!}>
      <div className="[&>div>div:last-child]:overflow-hidden [&>div>div:last-child]:rounded-xl">
        <GoogleMap value={value} onChange={onChange} defaultZoom={defaultZoom} />
      </div>
    </GoogleMapProvider>
  );
}
