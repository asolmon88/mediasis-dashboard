export type TilopayTransaction = { orderNumber?: string; code?: string | number; response?: string; auth?: string; id_tilopay?: string | number; tilopayTransaction?: string | number; capture?: string; type?: string; environment?: string; amount?: string; currency?: string };

export function parseTilopayLifecycle(rows: TilopayTransaction[], orderNumber: string, expectedMinor: number, currency: string) {
  const matches = rows.filter((transaction) => {
    const providerOrder = transaction.orderNumber ?? "";
    return providerOrder === orderNumber || providerOrder.endsWith(`-${orderNumber}`);
  });
  const authorization = matches.filter((row) => !/^C-/i.test(row.orderNumber ?? "") && !/capture/i.test(`${row.capture ?? ""} ${row.type ?? ""}`));
  const capture = matches.filter((row) => /^C-/i.test(row.orderNumber ?? "") || /capture/i.test(`${row.capture ?? ""} ${row.type ?? ""}`));
  const distinct = (items: TilopayTransaction[]) => [...new Map(items.map((row) => [String(row.id_tilopay ?? row.tilopayTransaction ?? JSON.stringify(row)), row])).values()];
  if (distinct(authorization).length > 1 || distinct(capture).length > 1) throw new Error("Tilopay devolvió transacciones contradictorias para esta compra.");
  for (const row of matches) {
    const amount = Number(row.amount);
    if (!Number.isFinite(amount) || Math.round(amount * 100) !== expectedMinor || row.currency !== currency) throw new Error("Tilopay devolvió un monto o moneda que no coincide con esta compra.");
  }
  const authorized = authorization[0] ?? null;
  const captured = capture[0] ?? null;
  if (captured && String(captured.code) !== "1101") throw new Error("Tilopay devolvió una captura sin confirmación válida.");
  if (captured && authorized && String(authorized.code) !== "1") throw new Error("Tilopay devolvió estados de autorización y captura contradictorios.");
  return { authorization: authorized, capture: captured };
}
