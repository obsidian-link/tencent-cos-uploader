import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	resolve: {
		alias: {
			// `obsidian` 包只有类型声明，运行时用轻量 mock 代替
			obsidian: fileURLToPath(
				new URL('./tests/mocks/obsidian.ts', import.meta.url),
			),
		},
	},
	test: {
		environment: 'node',
		include: ['tests/**/*.test.ts'],
		setupFiles: ['tests/setup.ts'],
		clearMocks: true,
		coverage: {
			provider: 'v8',
			include: ['src/**/*.ts'],
			reporter: ['text', 'html'],
		},
	},
});
