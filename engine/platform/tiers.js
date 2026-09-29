// @ts-check

/** @typedef {'shared' | 'transfer' | 'inline'} ThreadingTier */
/** @typedef {'high' | 'std'} PerformanceTier */

/** Tier decisions (docs/engine/08-platforms.md#tier-detection, docs/BUDGETS.md#quality-tiers). */
export class Tiers {
  /**
   * The threading tier follows cross-origin isolation (ADR-008).
   * @param {{ coi: boolean, sab: boolean }} probes
   * @param {string | null} [override] `shared` | `transfer` | `inline` from a URL parameter (tests)
   * @returns {ThreadingTier}
   */
  static threading(probes, override = null) {
    if (override === 'inline' || override === 'transfer') return override;
    if (override === 'shared' && !(probes.coi && probes.sab)) return 'transfer';
    return probes.coi && probes.sab ? 'shared' : 'transfer';
  }

  /**
   * Performance tier from the adapter and the CPU. A GPU micro-benchmark refines this later (M1 matrix).
   * @param {{ isFallback: boolean }} adapter
   * @param {number} cores
   * @param {string | null} [override] `high` | `std`
   * @returns {PerformanceTier}
   */
  static performance(adapter, cores, override = null) {
    if (override === 'high' || override === 'std') return override;
    if (adapter.isFallback) return 'std';
    return cores >= 6 ? 'high' : 'std';
  }

  /**
   * Job workers per tier (docs/BUDGETS.md#job-workers-asynchronous-work).
   * @param {ThreadingTier} threading
   * @param {PerformanceTier} perf
   * @param {number} cores
   */
  static jobWorkers(threading, perf, cores) {
    if (threading === 'inline') return 0;
    const cap = perf === 'high' ? 6 : 4;
    return Math.max(1, Math.min(cores - 2, cap));
  }
}
