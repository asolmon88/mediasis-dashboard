import AdminHomeDashboard from '@/components/admin/AdminHomeDashboard'
import { DashboardAccessDenied } from '@/components/dashboard/DashboardAccessDenied'
import { getDashboardAuthorizationContext } from '@/lib/dashboard/auth'
import { hasDashboardPermission } from '@/lib/dashboard/auth-types'

export default async function AdminPage() {
  const context = await getDashboardAuthorizationContext()
  if (!context || !context.activeBusinessId || !hasDashboardPermission(context, 'analytics.read')) {
    return <DashboardAccessDenied title="Sin acceso a analíticas" />
  }
  return <AdminHomeDashboard />
}
