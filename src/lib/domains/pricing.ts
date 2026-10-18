/**
 * Domain registrations include Mediasis's US$4 service margin. TiloPay retains
 * 3% of the amount charged, so the charge is grossed up to leave the registrar
 * cost and the full margin after that deduction.
 */
export const DOMAIN_SERVICE_MARGIN_MINOR = 400;
export const DOMAIN_PROCESSOR_FEE_BASIS_POINTS = 300;
const BASIS_POINTS = 10_000;

export function calculateDomainPurchasePrice(registrarPriceMinor: number) {
  const registrarMinor = Math.max(0, Math.round(registrarPriceMinor));
  const beforeProcessorFeeMinor = registrarMinor + DOMAIN_SERVICE_MARGIN_MINOR;
  const totalMinor = Math.ceil(
    (beforeProcessorFeeMinor * BASIS_POINTS) /
      (BASIS_POINTS - DOMAIN_PROCESSOR_FEE_BASIS_POINTS),
  );

  return {
    registrarMinor,
    serviceMarginMinor: DOMAIN_SERVICE_MARGIN_MINOR,
    processorFeeMinor: totalMinor - beforeProcessorFeeMinor,
    totalMinor,
  };
}
