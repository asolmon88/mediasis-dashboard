/**
 * The Meta Pixel connection is available only to the Foody test business until
 * the Meta authorization flow and App Review are complete.
 */
export const META_PIXEL_PILOT_BUSINESS_ID = "787c460a-8896-4ea6-a1c3-509f93faa8f5";

export const isMetaPixelPilotBusiness = (businessId: string | null) =>
  businessId === META_PIXEL_PILOT_BUSINESS_ID;
