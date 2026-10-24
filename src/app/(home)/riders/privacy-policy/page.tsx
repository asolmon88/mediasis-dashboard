import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy | Mediasis",
  description:
    "Privacy Policy for the Mediasis rider delivery application, including account, location, delivery, and support data practices.",
};

const lastUpdated = "May 7, 2026";

const sections = [
  {
    title: "1. Who We Are",
    body: [
      "This Privacy Policy explains how Mediasis collects, uses, shares, protects, and deletes personal information when riders use the Mediasis mobile application and related services.",
      "Mediasis is a rider food delivery application used to receive delivery offers, navigate to pickup and dropoff locations, update delivery progress, communicate when needed for delivery support, and submit proof of delivery.",
    ],
  },
  {
    title: "2. Information We Collect",
    body: [
      "Account and identity information: name, phone number, email address, country code, profile photo, account status, rider approval status, and authentication information such as OTP verification records.",
      "Rider verification information: identity document images, driving license information, vehicle registration documents, insurance documents where applicable, vehicle type, vehicle model, vehicle color, vehicle plate number, and rider or vehicle verification status.",
      "Payment and payout information: bank account or IBAN details and related payout information where required to pay riders.",
      "Location information: precise device location, latitude and longitude, pickup location, dropoff location, pickup address, dropoff address, route and distance information, online status, and delivery progress locations.",
      "Delivery and order information: delivery IDs, order IDs, delivery status, assigned rider information, pharmacy or pickup details, customer name and contact details needed to complete a delivery, delivery fee, estimated preparation time, cancellation reason, timestamps, proof photos, receiver signatures, and delivery notes.",
      "Device, app, and diagnostic information: device type, operating system, app version, IP address, session information, notification tokens, error logs, performance data, and security events.",
      "Communications and support information: messages, call actions started from the app, support requests, feedback, and information you provide when contacting us.",
    ],
  },
  {
    title: "3. Location Data",
    body: [
      "Mediasis uses precise location to help riders find nearby delivery offers, calculate routes, navigate to pharmacies and customers, update customers and stores about delivery progress, improve safety, and prevent fraud.",
      "When a rider goes online, accepts an offer, or has an active delivery, Mediasis may collect and process location data while the app is open and, where enabled by the operating system and required for active delivery tracking, while the app is in the background.",
      "You can stop active delivery location use by going offline when you are not delivering, completing or cancelling the active delivery according to app rules, or changing location permissions in your device settings. If location permission is disabled, rider matching, route guidance, online status, delivery tracking, and related app features may not work.",
    ],
  },
  {
    title: "4. How We Use Information",
    body: [
      "We use personal information to create and secure rider accounts, verify rider eligibility, manage rider approval, provide OTP login, match riders with delivery offers, calculate pickup and dropoff information, show route and order details, process delivery status changes, support delivery proof, provide customer and pharmacy communication where needed, process payouts, prevent abuse and fraud, troubleshoot the app, send important notifications, provide support, meet legal obligations, and improve Mediasis services.",
    ],
  },
  {
    title: "5. Permissions Used By The App",
    body: [
      "Location permission is used for rider online status, delivery matching, route guidance, active delivery tracking, and estimated arrival updates.",
      "Camera, photo, and file access may be used for profile photos, identity verification, vehicle or license documents, delivery proof photos, and receiver signatures.",
      "Notification permission is used to send delivery offers, order updates, account status updates, reminders, and important service messages.",
      "Phone and device communication features may be used when a rider chooses to call a customer, pharmacy, or support contact from inside the app.",
      "Network access is required to connect to Mediasis services, Supabase, maps and routing services, notification services, and other infrastructure needed for the app to function.",
    ],
  },
  {
    title: "6. When We Share Information",
    body: [
      "We share information only as needed to operate Mediasis, complete deliveries, comply with law, protect users, or support our services.",
      "We may share rider name, delivery status, approximate or precise delivery progress, and necessary contact or delivery information with pharmacies, customers, dispatch or operations teams, and other parties involved in a delivery.",
      "We may share information with service providers that help us run the app, including hosting, database, storage, authentication, maps, routing, push notification, analytics, diagnostics, payment or payout, fraud prevention, and customer support providers.",
      "We may disclose information if required by law, regulation, legal process, government request, safety investigation, fraud prevention, dispute resolution, or to enforce our terms and policies.",
      "If Mediasis is involved in a merger, acquisition, financing, reorganization, or sale of assets, information may be transferred as part of that transaction, subject to appropriate protection.",
    ],
  },
  {
    title: "7. Third Party Services",
    body: [
      "Mediasis may use third party services and SDKs such as Supabase for backend, authentication, database, and storage; Google Maps, geocoding, and routing services for maps and navigation; OneSignal for push notifications; Apple and Google platform services for app distribution, permissions, crash diagnostics, and operating system features; and hosting, monitoring, analytics, and support providers used to operate the service.",
      "These providers process information according to their own privacy notices and our instructions where applicable. We require service providers to protect user data with safeguards appropriate for the data they process.",
    ],
  },
  {
    title: "8. Data Retention And Deletion",
    body: [
      "We keep personal information for as long as needed to provide Mediasis services, operate rider accounts, complete deliveries, process payouts, maintain business records, resolve disputes, prevent fraud, comply with legal obligations, and enforce our agreements.",
      "Delivery records, proof of delivery, payout records, verification documents, and safety or fraud records may be retained for longer periods where needed for operational, legal, tax, accounting, compliance, or dispute reasons.",
      "You may request account deletion or deletion of eligible personal information by contacting us. Some information may be retained where required or permitted by law, for security, fraud prevention, delivery records, payment records, dispute handling, or legitimate business purposes.",
    ],
  },
  {
    title: "9. Your Choices And Rights",
    body: [
      "You may request access to, correction of, deletion of, or a copy of your personal information, subject to applicable law and verification of your identity.",
      "You can control app permissions such as location, camera, photos, and notifications through your device settings. Disabling permissions may limit or prevent delivery, tracking, verification, proof, notification, or support features.",
      "You can opt out of non-essential push notifications through device settings. We may still send service messages that are necessary for account, delivery, safety, security, or legal reasons.",
    ],
  },
  {
    title: "10. Security",
    body: [
      "We use reasonable administrative, technical, and organizational safeguards designed to protect personal information from unauthorized access, loss, misuse, alteration, and disclosure. No internet or mobile service can be guaranteed to be completely secure, so riders should also protect their device, phone number, and account access.",
    ],
  },
  {
    title: "11. Children",
    body: [
      "Mediasis is intended for delivery riders who are legally eligible to work or provide delivery services in their location. The app is not directed to children, and we do not knowingly collect personal information from children under 13 or from anyone below the minimum legal age required to use the service.",
    ],
  },
  {
    title: "12. International Processing",
    body: [
      "Your information may be processed and stored in countries other than the country where you live. Where required, we use appropriate safeguards for international transfers and process information according to this Privacy Policy and applicable law.",
    ],
  },
  {
    title: "13. Changes To This Policy",
    body: [
      "We may update this Privacy Policy from time to time. When we make changes, we will update the Last updated date above and, where required, provide additional notice through the app, website, store listing, or other appropriate channels.",
    ],
  },
  {
    title: "14. Contact Us",
    body: [
      "For privacy questions, data requests, account deletion requests, or complaints, contact Mediasis at privacy@mediasis.cr.",
      "If the developer or legal entity listed in the Apple App Store or Google Play listing is different from Mediasis, that listing entity is responsible for keeping this policy, store privacy labels, data safety forms, and in-app disclosures accurate and up to date.",
    ],
  },
];

export default function PrivacyPolicyPage() {
  return (
    <main className="privacy-page">
      <section className="hero" aria-labelledby="privacy-title">
        <div className="hero-content">
          <div className="brand-mark" aria-hidden="true">
            E
          </div>
          <p className="eyebrow">Mediasis Rider App</p>
          <h1 id="privacy-title">Privacy Policy</h1>
          <p className="hero-copy">
            This policy explains how Mediasis handles rider, delivery, location,
            verification, notification, and support information.
          </p>
          <p className="updated">Last updated: {lastUpdated}</p>
        </div>
      </section>

      <section className="summary" aria-label="Privacy summary">
        <div className="summary-card">
          <span className="summary-label">Core use</span>
          <p>Delivery matching, navigation, order progress, and proof of delivery.</p>
        </div>
        <div className="summary-card">
          <span className="summary-label">Sensitive data</span>
          <p>Precise location, identity documents, vehicle documents, and payout data.</p>
        </div>
        <div className="summary-card">
          <span className="summary-label">Control</span>
          <p>Riders can manage permissions in device settings and request deletion.</p>
        </div>
      </section>

      <section className="content" aria-label="Privacy policy sections">
        <div className="notice">
          <h2>App Store and Google Play disclosure summary</h2>
          <p>
            Mediasis collects personal and sensitive information only for disclosed
            app functionality, service operation, safety, fraud prevention,
            support, compliance, and rider payment purposes. Mediasis does not sell
            personal information. Mediasis does not use rider data for cross-app
            tracking unless separately disclosed and consented to where required.
          </p>
        </div>

        {sections.map((section) => (
          <article className="policy-section" key={section.title}>
            <h2>{section.title}</h2>
            {section.body.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </article>
        ))}
      </section>

      <style>{`
        :root {
          color-scheme: light;
        }

        * {
          box-sizing: border-box;
        }

        body {
          margin: 0;
          background: #fafafa;
        }

        .privacy-page {
          min-height: 100vh;
          background:
            radial-gradient(circle at top right, rgba(255, 66, 24, 0.1), transparent 34rem),
            #fafafa;
          color: #1a1a1a;
          font-family: Inter, Manrope, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          line-height: 1.65;
        }

        .hero {
          background: linear-gradient(135deg, #fff0ed 0%, #ffffff 54%, #fafafa 100%);
          border-bottom: 1px solid #eeeeee;
        }

        .hero-content {
          width: min(1040px, calc(100% - 40px));
          margin: 0 auto;
          padding: 64px 0 52px;
        }

        .brand-mark {
          display: grid;
          place-items: center;
          width: 52px;
          height: 52px;
          border-radius: 14px;
          background: #ff4218;
          color: #ffffff;
          font-size: 28px;
          font-weight: 800;
          box-shadow: 0 18px 36px rgba(255, 66, 24, 0.22);
        }

        .eyebrow {
          margin: 22px 0 8px;
          color: #e63812;
          font-size: 13px;
          font-weight: 800;
          letter-spacing: 0.12em;
          text-transform: uppercase;
        }

        h1,
        h2 {
          letter-spacing: 0;
        }

        h1 {
          max-width: 780px;
          margin: 0;
          font-size: clamp(42px, 7vw, 76px);
          line-height: 1;
          font-weight: 850;
        }

        .hero-copy {
          max-width: 740px;
          margin: 22px 0 0;
          color: #525252;
          font-size: 19px;
        }

        .updated {
          margin: 18px 0 0;
          color: #8d8d8d;
          font-size: 14px;
          font-weight: 700;
        }

        .summary {
          width: min(1040px, calc(100% - 40px));
          margin: 28px auto 0;
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 14px;
        }

        .summary-card {
          border: 1px solid #eeeeee;
          border-radius: 8px;
          background: #ffffff;
          padding: 20px;
          box-shadow: 0 12px 32px rgba(26, 26, 26, 0.04);
        }

        .summary-label {
          display: block;
          margin-bottom: 8px;
          color: #ff4218;
          font-size: 12px;
          font-weight: 850;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .summary-card p {
          margin: 0;
          color: #525252;
          font-size: 14px;
        }

        .content {
          width: min(880px, calc(100% - 40px));
          margin: 42px auto 0;
          padding-bottom: 72px;
        }

        .notice,
        .policy-section {
          border-bottom: 1px solid #eeeeee;
          padding: 30px 0;
        }

        .notice {
          border: 1px solid rgba(255, 66, 24, 0.22);
          border-radius: 8px;
          background: #fff7f5;
          padding: 24px;
          margin-bottom: 8px;
        }

        .notice h2,
        .policy-section h2 {
          margin: 0 0 12px;
          font-size: 24px;
          line-height: 1.25;
          font-weight: 820;
        }

        .notice p,
        .policy-section p {
          margin: 12px 0 0;
          color: #525252;
          font-size: 16px;
        }

        .policy-section:last-child {
          border-bottom: 0;
        }

        @media (max-width: 760px) {
          .hero-content,
          .summary,
          .content {
            width: min(100% - 28px, 1040px);
          }

          .hero-content {
            padding: 44px 0 38px;
          }

          .hero-copy {
            font-size: 17px;
          }

          .summary {
            grid-template-columns: 1fr;
            margin-top: 18px;
          }

          .content {
            margin-top: 28px;
            padding-bottom: 48px;
          }

          .notice,
          .policy-section {
            padding: 24px 0;
          }

          .notice {
            padding: 20px;
          }

          .notice h2,
          .policy-section h2 {
            font-size: 21px;
          }

          .notice p,
          .policy-section p {
            font-size: 15px;
          }
        }
      `}</style>
    </main>
  );
}
