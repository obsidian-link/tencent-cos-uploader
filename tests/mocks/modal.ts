import { vi } from 'vitest';

/** 默认确认；用例中通过 `confirmOperation.mockResolvedValueOnce(false)` 改写 */
export const confirmOperation = vi.fn(() => Promise.resolve(true));
