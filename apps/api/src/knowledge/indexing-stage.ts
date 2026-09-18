import type { DocumentLifecycleStatus } from '@heritage/contracts'

export function mapDifyIndexingStage(status: string): DocumentLifecycleStatus {
  if (status === 'waiting') return 'queued'
  if (status === 'parsing') return 'parsing'
  if (status === 'cleaning') return 'cleaning'
  if (status === 'splitting') return 'splitting'
  if (status === 'indexing') return 'indexing'
  if (status === 'completed') return 'review_required'
  if (status === 'error') return 'failed'
  if (status === 'paused') return 'paused'
  return 'indexing'
}
