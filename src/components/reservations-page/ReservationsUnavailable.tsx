export function ReservationsUnavailable() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6 text-center">
      <div className="max-w-md space-y-2">
        <h1 className="text-xl font-semibold">Reservaciones no disponibles</h1>
        <p className="text-muted-foreground">
          No tenés una ubicación con reservaciones activas y acceso asignado.
        </p>
      </div>
    </div>
  );
}
