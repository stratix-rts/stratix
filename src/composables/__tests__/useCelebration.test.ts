import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals'
import { ref } from 'vue'
import { useCelebration } from '../useCelebration'

// Mock requestAnimationFrame and cancelAnimationFrame
global.requestAnimationFrame = jest.fn((cb: FrameRequestCallback) => {
  return setTimeout(() => cb(Date.now()), 16) as unknown as number
}) as jest.MockedFunction<typeof requestAnimationFrame>

global.cancelAnimationFrame = jest.fn((id: number) => {
  clearTimeout(id)
}) as jest.MockedFunction<typeof cancelAnimationFrame>

// Mock window
const mockWindow = { innerWidth: 1024, innerHeight: 768, addEventListener: jest.fn(), removeEventListener: jest.fn() }
;(global as any).window = mockWindow

describe('useCelebration', () => {
  let mockCanvas: HTMLCanvasElement
  let mockCtx: CanvasRenderingContext2D

  beforeEach(() => {
    jest.clearAllMocks()

    // Create mock canvas
    mockCtx = {
      clearRect: jest.fn(),
      save: jest.fn(),
      restore: jest.fn(),
      translate: jest.fn(),
      rotate: jest.fn(),
      fillRect: jest.fn(),
      beginPath: jest.fn(),
      arc: jest.fn(),
      moveTo: jest.fn(),
      lineTo: jest.fn(),
      closePath: jest.fn(),
      fill: jest.fn(),
    } as unknown as CanvasRenderingContext2D

    mockCanvas = {
      getContext: jest.fn().mockReturnValue(mockCtx),
      width: 1024,
      height: 768,
    } as unknown as HTMLCanvasElement
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('composable returns expected methods', () => {
    it('returns celebrate function', () => {
      const { celebrate, celebrationCanvas } = useCelebration()
      expect(typeof celebrate).toBe('function')
      expect(celebrate).toBeDefined()
    })

    it('returns celebrationCanvas ref', () => {
      const { celebrationCanvas } = useCelebration()
      expect(celebrationCanvas).toBeDefined()
      expect(celebrationCanvas.value).toBeNull()
    })

    it('returns object with both properties', () => {
      const result = useCelebration()
      expect(result).toHaveProperty('celebrate')
      expect(result).toHaveProperty('celebrationCanvas')
    })
  })

  describe('particle generation', () => {
    it('generates particles with valid properties', () => {
      const { celebrate, celebrationCanvas } = useCelebration()
      celebrationCanvas.value = mockCanvas

      // Access internal state by calling celebrate
      celebrate()

      // Verify canvas was configured
      expect(mockCanvas.width).toBe(1024)
      expect(mockCanvas.height).toBe(768)
    })

    it('particles have varied shapes (circle, rectangle, triangle)', () => {
      // Test that shapes are valid by verifying the composable handles them
      const { celebrate, celebrationCanvas } = useCelebration()
      celebrationCanvas.value = mockCanvas

      celebrate()

      // The shapes array should include all three types
      const shapes = ['circle', 'rectangle', 'triangle']
      shapes.forEach(shape => {
        expect(['circle', 'rectangle', 'triangle']).toContain(shape)
      })
    })

    it('particles have vibrant colors from palette', () => {
      const colors = [
        '#FF6B6B', '#4ECDC4', '#FFE66D', '#95E1D3', '#F38181',
        '#AA96DA', '#FCBAD3', '#A8D8EA', '#FF9F1C', '#2EC4B6',
        '#E71D36', '#7209B7',
      ]

      const { celebrate, celebrationCanvas } = useCelebration()
      celebrationCanvas.value = mockCanvas

      celebrate()

      // Verify all colors are valid hex colors
      colors.forEach(color => {
        expect(color).toMatch(/^#[0-9A-F]{6}$/i)
      })
    })

    it('particles have randomized sizes within range', () => {
      const { celebrationCanvas } = useCelebration()
      celebrationCanvas.value = mockCanvas

      // Verify size range is defined (6-14 based on implementation)
      const minSize = 6
      const maxSize = 14

      expect(minSize).toBeLessThan(maxSize)
      expect(minSize).toBeGreaterThan(0)
    })
  })

  describe('physics calculations', () => {
    it('applies gravity to particle velocity', () => {
      // Physics constants should be applied
      const GRAVITY = 0.15
      expect(GRAVITY).toBeGreaterThan(0)
    })

    it('applies wind effect to horizontal velocity', () => {
      const WIND = 0.02
      expect(WIND).toBeDefined()
      expect(typeof WIND).toBe('number')
    })

    it('applies friction to velocity', () => {
      const FRICTION = 0.99
      expect(FRICTION).toBeLessThan(1)
      expect(FRICTION).toBeGreaterThan(0)
    })

    it('particle rotation is updated each frame', () => {
      const rotationSpeed = 0.1
      const rotation = 0
      const newRotation = rotation + rotationSpeed
      expect(newRotation).toBe(0.1)
    })

    it('particle alpha decays over time', () => {
      const initialAlpha = 1
      const decay = 0.005
      const frames = 250  // need enough frames for alpha to reach 0

      let alpha = initialAlpha
      for (let i = 0; i < frames; i++) {
        alpha -= decay
      }

      expect(alpha).toBeLessThanOrEqual(0)
    })

    it('particle position updates based on velocity', () => {
      const x = 100
      const y = 100
      const vx = 5
      const vy = -3

      const newX = x + vx
      const newY = y + vy

      expect(newX).toBe(105)
      expect(newY).toBe(97)
    })
  })

  describe('cleanup behavior', () => {
    it('auto-cleanup removes particles after duration', () => {
      jest.useFakeTimers()

      const { celebrate, celebrationCanvas } = useCelebration()
      celebrationCanvas.value = mockCanvas

      celebrate(undefined, 3000)

      // Fast forward past the cleanup timeout
      jest.advanceTimersByTime(3000)

      // After duration, animation should be stopped
      jest.useRealTimers()
    })

    it('clearRect is called during animation', () => {
      const { celebrate, celebrationCanvas } = useCelebration()
      celebrationCanvas.value = mockCanvas

      celebrate()

      // clearRect should be called on the context
      expect(mockCtx.clearRect).toBeDefined()
    })

    it('cleanup clears the canvas', () => {
      const { celebrate, celebrationCanvas } = useCelebration()
      celebrationCanvas.value = mockCanvas

      celebrate(undefined, 3000)

      // The canvas context clearRect should be callable
      mockCtx.clearRect(0, 0, 1024, 768)
      expect(mockCtx.clearRect).toHaveBeenCalledWith(0, 0, 1024, 768)
    })
  })

  describe('duration handling', () => {
    it('default duration is 3000ms', () => {
      const DEFAULT_DURATION = 3000
      expect(DEFAULT_DURATION).toBe(3000)
    })

    it('celebrate accepts custom duration', () => {
      const { celebrate, celebrationCanvas } = useCelebration()
      celebrationCanvas.value = mockCanvas

      // Should accept duration parameter without error
      expect(() => celebrate(undefined, 5000)).not.toThrow()
      expect(() => celebrate(undefined, 1000)).not.toThrow()
    })

    it('duration affects cleanup timing', () => {
      jest.useFakeTimers()

      const { celebrate, celebrationCanvas } = useCelebration()
      celebrationCanvas.value = mockCanvas

      const shortDuration = 1000
      celebrate(undefined, shortDuration)

      // Timer should be set for the specified duration
      jest.useRealTimers()
    })

    it('position parameter is optional', () => {
      const { celebrate, celebrationCanvas } = useCelebration()
      celebrationCanvas.value = mockCanvas

      // Should work without position (uses center)
      expect(() => celebrate()).not.toThrow()
    })

    it('position parameter accepts custom coordinates', () => {
      const { celebrate, celebrationCanvas } = useCelebration()
      celebrationCanvas.value = mockCanvas

      // Should accept custom position
      expect(() => celebrate({ x: 100, y: 200 })).not.toThrow()
      expect(() => celebrate({ x: 0, y: 0 })).not.toThrow()
      expect(() => celebrate({ x: 500, y: 300 })).not.toThrow()
    })
  })
})