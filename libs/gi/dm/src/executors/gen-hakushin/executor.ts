import type { PromiseExecutor } from '@nx/devkit'
import { getDataFromHakushin } from './hakushin'
import type { GenHakushinDataExecutorSchema } from './schema'

const runExecutor: PromiseExecutor<GenHakushinDataExecutorSchema> = async (
  options
) => {
  console.log('Running Executor for GenHakushinData', options)
  await getDataFromHakushin()
  return {
    success: true,
  }
}

export default runExecutor
