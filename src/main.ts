import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { registerSW } from 'virtual:pwa-register'
import './style.css'
import App from './App.vue'
import { router } from './router'
import { useAuthStore } from './stores/auth'
import { stripRefreshQueryParam, consumeAppRefreshNotice } from './services/pwaRefresh'

stripRefreshQueryParam()
if (consumeAppRefreshNotice()) {
  console.info('Pama app cache cleared — running latest shell.')
}

const updateSW = registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    if (registration) {
      registration.update().catch(() => {})
      window.setInterval(() => registration.update().catch(() => {}), 60 * 60 * 1000)
    }
  },
})

;(window as Window & { __pamaUpdateSW?: typeof updateSW }).__pamaUpdateSW = updateSW

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)
app.use(router)

useAuthStore(pinia).init().catch((err) => {
  console.error('Auth init failed:', err)
})

app.mount('#app')
