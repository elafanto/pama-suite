import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/dashboard' },
  { path: '/dashboard', name: 'dashboard', component: () => import('@/modules/dashboard/DashboardView.vue'), meta: { title: 'Dashboard', icon: '🏠' } },
  { path: '/billing',   name: 'billing',   component: () => import('@/modules/billing/BillingView.vue'),     meta: { title: 'Billing', icon: '🧾' } },
  { path: '/purchases', name: 'purchases', component: () => import('@/modules/purchases/PurchasesView.vue'), meta: { title: 'Purchases', icon: '📥' } },
  { path: '/accounting',name: 'accounting',component: () => import('@/modules/accounting/AccountingView.vue'),meta: { title: 'Accounting', icon: '📊' } },
  { path: '/parties',   name: 'parties',   component: () => import('@/modules/parties/PartiesView.vue'),     meta: { title: 'Parties', icon: '👥' } },
  { path: '/items',     name: 'items',     component: () => import('@/modules/items/ItemsView.vue'),         meta: { title: 'Items', icon: '📦' } },
  { path: '/boxcalc',   name: 'boxcalc',   component: () => import('@/modules/boxcalc/BoxCalcView.vue'),     meta: { title: 'BoxCalc', icon: '🧮' } },
  { path: '/banking',   name: 'banking',   component: () => import('@/modules/banking/BankingView.vue'),     meta: { title: 'Banking', icon: '🏦' } },
  { path: '/reports',   name: 'reports',   component: () => import('@/modules/reports/ReportsView.vue'),   meta: { title: 'Reports', icon: '📈' } },
  { path: '/settings',  name: 'settings',  component: () => import('@/modules/settings/SettingsView.vue'),   meta: { title: 'Settings', icon: '⚙️' } },
  { path: '/login',     name: 'login',     component: () => import('@/modules/auth/LoginView.vue'),       meta: { title: 'Login', hidden: true } },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
})

export const navItems = routes.filter(r => r.meta?.title && !r.meta?.hidden)
