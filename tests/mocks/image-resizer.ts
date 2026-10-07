import { vi } from 'vitest';

/** 缩放器依赖真实 DOM，插件层测试只验证它是否被创建并注册 */
export class ImageResizer {
	static instances: ImageResizer[] = [];

	static reset(): void {
		ImageResizer.instances = [];
	}

	register = vi.fn();

	constructor(public readonly plugin: unknown) {
		ImageResizer.instances.push(this);
	}
}
