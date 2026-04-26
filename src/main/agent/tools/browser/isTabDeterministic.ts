import type { DeterministicKernel } from '../../../browser/determinism/DeterministicKernel';

export type KernelDeterminismProbe = Pick<DeterministicKernel, 'isDeterministic'>;

/**
 * Returns true when the given tab is currently pinned by a
 * `DeterministicKernel`. Consumers pass the module-local kernel singleton (or
 * `null` when the singleton hasn't been lazily created yet) so the helper
 * never forces adapter construction just to answer a read-only query. The
 * kernel argument is also the unit-test injection seam.
 */
export function isTabDeterministic(
  tabId: string | null | undefined,
  kernel: KernelDeterminismProbe | null,
): boolean {
  if (!tabId) return false;
  if (!kernel) return false;
  return kernel.isDeterministic(tabId);
}
