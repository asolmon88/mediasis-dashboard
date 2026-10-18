export default async function ProtectedPage({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <>{children}</>
}
