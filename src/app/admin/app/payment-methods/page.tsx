import { DashboardAccessDenied } from "@/components/dashboard/DashboardAccessDenied";
import MainPage from "@/components/app/payment_methods/MainPage";
import { getOrderingAppPaymentMethods } from "./actions";

export default async function PaymentMethodsPage() {
  const result = await getOrderingAppPaymentMethods();
  if (!result.success) {
    return <DashboardAccessDenied title="Sin acceso a Métodos de pago" description={result.message} />;
  }

  return (
    <MainPage
      paymentMethods={result.paymentMethods}
      canManageAllLocations={result.canManageAllLocations}
      paymentMethodsManagedByMediasis={result.paymentMethodsManagedByMediasis}
      countryCode={result.countryCode}
      marketplaceConnection={result.marketplaceConnection}
      applePayDomains={result.applePayDomains}
      canManageApplePay={result.canManageApplePay}
    />
  );
}
