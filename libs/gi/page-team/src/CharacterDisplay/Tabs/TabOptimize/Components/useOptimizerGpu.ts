import {
  OPTIMIZER_GPU_EVENT,
  optimizerGpuEnabled,
  optimizerGpuSupported,
  setOptimizerGpuEnabled,
} from '@genshin-optimizer/gi/solver'
import { useSyncExternalStore } from 'react'

const subscribe = (onChange: () => void) => {
  window.addEventListener(OPTIMIZER_GPU_EVENT, onChange)
  // (another tab changed it)
  window.addEventListener('storage', onChange)
  return () => {
    window.removeEventListener(OPTIMIZER_GPU_EVENT, onChange)
    window.removeEventListener('storage', onChange)
  }
}

/**
 * The optimizer's GPU setting (one for the whole app: the Optimize tab and Team Optimize):
 * whether the browser can use the GPU, whether the user lets it, and its setter
 */
export function useOptimizerGpu() {
  const enabled = useSyncExternalStore(subscribe, optimizerGpuEnabled)
  return {
    supported: optimizerGpuSupported(),
    enabled,
    setEnabled: setOptimizerGpuEnabled,
  }
}
