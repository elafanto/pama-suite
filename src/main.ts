import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { registerSW } from 'virtual:pwa-register'
import './style.css'
import App from './App.vue'
import { router } from './router'
import { useAuthStore } from './stores/auth'

registerSW({ immediate: true })

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)
app.use(router)

useAuthStore(pinia).init().catch((err) => {
  console.error('Auth init failed:', err)
})

app.mount('#app')
