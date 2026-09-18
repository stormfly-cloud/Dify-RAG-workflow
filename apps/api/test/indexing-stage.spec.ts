import { describe, expect, it } from 'vitest'
import { mapDifyIndexingStage } from '../src/knowledge/indexing-stage.js'

describe('mapDifyIndexingStage', () => {
  it.each([
    ['waiting', 'queued'],
    ['parsing', 'parsing'],
    ['cleaning', 'cleaning'],
    ['splitting', 'splitting'],
    ['indexing', 'indexing'],
    ['completed', 'review_required'],
    ['error', 'failed'],
    ['paused', 'paused'],
  ])('maps %s to %s', (difyStatus, expected) => {
    expect(mapDifyIndexingStage(difyStatus)).toBe(expected)
  })

  it('falls back to indexing for a new Dify stage', () => {
    expect(mapDifyIndexingStage('future-stage')).toBe('indexing')
  })
})
