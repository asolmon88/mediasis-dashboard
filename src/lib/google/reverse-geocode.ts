import "server-only";

type ReverseGeocodeInput = {
  lat: number;
  lng: number;
};

type GoogleGeocodeResponse = {
  results?: Array<{
    formatted_address?: string;
  }>;
  status?: string;
  error_message?: string;
};

const GOOGLE_GEOCODE_URL =
  "https://maps.googleapis.com/maps/api/geocode/json";

export async function reverseGeocodeLatLng({
  lat,
  lng,
}: ReverseGeocodeInput): Promise<string> {
  const apiKey = process.env.GOOGLE_MAP_SERVER_KEY;

  if (!apiKey) {
    throw new Error("GOOGLE_MAP_SERVER_KEY is not configured.");
  }

  const params = new URLSearchParams({
    latlng: `${lat},${lng}`,
    key: apiKey,
  });

  const response = await fetch(`${GOOGLE_GEOCODE_URL}?${params.toString()}`, {
    method: "GET",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("No se pudo obtener la direccion del mapa.");
  }

  const data = (await response.json()) as GoogleGeocodeResponse;
  const formattedAddress = data.results?.[0]?.formatted_address?.trim();

  if (formattedAddress) {
    return formattedAddress;
  }

  const errorMessage =
    data.error_message ||
    (data.status ? `Google Geocoding error: ${data.status}` : null);

  throw new Error(
    errorMessage || "No se pudo traducir la ubicacion a una direccion valida."
  );
}
