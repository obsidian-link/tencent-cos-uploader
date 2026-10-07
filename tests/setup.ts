import { vi } from 'vitest';

// 插件代码使用 window.setTimeout / clearTimeout；node 环境下指向 globalThis，
// 这样 vi.useFakeTimers() 也能接管它们。jsdom 环境自带 window，无需处理。
if (typeof window === 'undefined') {
	vi.stubGlobal('window', globalThis);
}
