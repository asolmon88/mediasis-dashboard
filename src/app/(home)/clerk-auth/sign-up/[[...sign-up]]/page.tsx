import { SignUp } from "@clerk/nextjs";

export default function DashboardClerkSignUpPage() {
  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <SignUp routing="path" path="/clerk-auth/sign-up" fallbackRedirectUrl="/admin" />
    </div>
  );
}
