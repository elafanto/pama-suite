import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/dashboard' },
  { path: '/dashboard', name: 'dashboard', component: () => import('@/modules/dashboard/DashboardView.vue'), meta: { title: 'Dashboard', icon: '🏠', group: 'Overview' } },

  { path: '/billing',   name: 'billing',   component: () => import('@/modules/billing/BillingView.vue'),     meta: { title: 'Billing', icon: '🧾', group: 'Sales & Purchase' } },
  { path: '/purchases', name: 'purchases', component: () => import('@/modules/purchases/PurchasesView.vue'), meta: { title: 'Purchases', icon: '📥', group: 'Sales & Purchase' } },
  { path: '/banking',   name: 'banking',   component: () => import('@/modules/banking/BankingView.vue'),     meta: { title: 'Banking', icon: '🏦', group: 'Sales & Purchase' } },

  { path: '/inventory', name: 'inventory', component: () => import('@/modules/inventory/InventoryView.vue'), meta: { title: 'Inventory', icon: '📊', group: 'Inventory & Masters' } },
  { path: '/items',     name: 'items',     component: () => import('@/modules/items/ItemsView.vue'),         meta: { title: 'Items', icon: '📦', group: 'Inventory & Masters' } },
  { path: '/parties',   name: 'parties',   component: () => import('@/modules/parties/PartiesView.vue'),     meta: { title: 'Parties', icon: '👥', group: 'Inventory & Masters' } },

  { path: '/boxcalc',   name: 'boxcalc',   component: () => import('@/modules/boxcalc/BoxCalcView.vue'),     meta: { title: 'BoxCalc', icon: '🧮', group: 'Tools' } },

  { path: '/accounting',name: 'accounting',component: () => import('@/modules/accounting/AccountingView.vue'),meta: { title: 'Accounting', icon: '📒', group: 'Finance' } },
  { path: '/reports',   name: 'reports',   component: () => import('@/modules/reports/ReportsView.vue'),   meta: { title: 'Reports', icon: '📈', group: 'Finance' } },

  { path: '/recycle-bin', name: 'recycle-bin', component: () => import('@/modules/recyclebin/RecycleBinView.vue'), meta: { title: 'Recycle Bin', icon: '♻️', group: 'System' } },
  { path: '/settings',  name: 'settings',  component: () => import('@/modules/settings/SettingsView.vue'),   meta: { title: 'Settings', icon: '⚙️', group: 'System' } },

  { path: '/login',     name: 'login',     component: () => import('@/modules/auth/LoginView.vue'),       meta: { title: 'Login', hidden: true } },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
})

export interface NavItem { path: string; title: string; icon: string; group: string }

const visible = routes.filter((r) => r.meta?.title && !r.meta?.hidden) as RouteRecordRaw[]

export const navItems: NavItem[] = visible.map((r) => ({
  path: r.path,
  title: r.meta!.title as string,
  icon: r.meta!.icon as string,
  group: (r.meta!.group as string) || 'More',
}))

/** Ordered, grouped nav for the sidebar. */
const GROUP_ORDER = ['Overview', 'Sales & Purchase', 'Inventory & Masters', 'Tools', 'Finance', 'System']

export const navGroups: { label: string; items: NavItem[] }[] = GROUP_ORDER
  .map((label) => ({ label, items: navItems.filter((i) => i.group === label) }))
  .filter((g) => g.items.length > 0)
