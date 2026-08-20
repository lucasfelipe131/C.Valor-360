import {installValRuntimeComposition} from './core/composition.js'

installValRuntimeComposition()
await import('../server.js')
