/**
 * Location IDs that a restricted dashboard member may assign to a new
 * location-scoped resource. This is deliberately an explicit list, never a
 * shorthand for the business-wide "all" scope.
 */
export function restrictedDefaultLocationIds(
  locations: readonly { business_location_id: string }[],
): string[] {
  return locations.map((location) => location.business_location_id);
}
