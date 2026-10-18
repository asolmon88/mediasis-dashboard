import { parsePhoneNumberFromString } from "libphonenumber-js/min";

/** Cloudflare Registrar requires a dot between the calling code and number. */
export function formatCloudflareRegistrantPhone(value: string) {
  const phone = parsePhoneNumberFromString(value);
  if (!phone?.isValid()) throw new Error("El teléfono del titular no es válido para registrar el dominio.");
  return `+${phone.countryCallingCode}.${phone.nationalNumber}`;
}
