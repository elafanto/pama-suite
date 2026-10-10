import { fileURLToPath, URL } from 'node:url'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'

const tailwindConfig = fileURLToPath(new URL('./tailwind.config.js', import.meta.url))

export default {
  plugins: [
    tailwindcss({ config: tailwindConfig }),
    autoprefixer(),
  ],
}
