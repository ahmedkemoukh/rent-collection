import { loadEnvConfig } from '@next/env'

// Imported first by scripts so .env.local is loaded before any module reads process.env.
loadEnvConfig(process.cwd())
