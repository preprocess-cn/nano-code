import { useContext } from 'react'
import StdinContext from '#src/plugins/display/claude-code-ink/engine/components/StdinContext.js'

/**
 * `useStdin` is a React hook, which exposes stdin stream.
 */
const useStdin = () => useContext(StdinContext)
export default useStdin
