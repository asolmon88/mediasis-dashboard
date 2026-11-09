export const MAX_META_TOKEN_LENGTH = 4096;

export function validateMetaPixelId(value: string | null | undefined) {
  const pixelId = value?.trim() ?? "";
  if (!/^\d{5,30}$/.test(pixelId)) throw new Error("Invalid Meta pixel ID.");
  return pixelId;
}

type CurrentMetaPixelSettings = {
  meta_pixel_id_orders: string | null;
  meta_token_orders: string | null;
};

export function buildMetaPixelUpdate(
  current: CurrentMetaPixelSettings | null,
  pixelIdInput: string,
  tokenInput: string | null,
) {
  const pixelId = validateMetaPixelId(pixelIdInput);
  const tokenWasProvided = tokenInput !== null;
  const token = tokenInput?.trim() ?? null;

  if (tokenWasProvided && (!token || token.length > MAX_META_TOKEN_LENGTH)) {
    throw new Error("invalid-token");
  }
  if (!current?.meta_token_orders && !tokenWasProvided) {
    throw new Error("token-required");
  }
  if (current?.meta_pixel_id_orders && current.meta_pixel_id_orders !== pixelId && !tokenWasProvided) {
    throw new Error("token-required-for-pixel-change");
  }

  const update: { meta_pixel_id_orders: string; meta_token_orders?: string } = {
    meta_pixel_id_orders: pixelId,
  };
  if (tokenWasProvided && token) update.meta_token_orders = token;
  return update;
}
