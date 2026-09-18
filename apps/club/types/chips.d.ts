declare module "/chips/nyu-chip.js" {
  export function mountNyuChip(
    container: HTMLElement,
    options?: { autoRotate?: boolean; interactionTarget?: HTMLElement },
  ): { destroy: () => void };
  export function createNyuChip(
    container: HTMLElement,
    options?: { autoRotate?: boolean; interactionTarget?: HTMLElement },
  ): { destroy: () => void };
}
