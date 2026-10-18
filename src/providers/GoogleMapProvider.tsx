"use client";
import { APIProvider } from "@vis.gl/react-google-maps";

export function GoogleMapProvider({
  children,
  ...props
}: React.ComponentProps<typeof APIProvider>) {
  return (
    <APIProvider apiKey={props.apiKey} libraries={["geometry", "places"]}>
      {children}
    </APIProvider>
  );
}
