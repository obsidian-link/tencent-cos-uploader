/**
 * `TencentCosUploader` 的替身：插件层测试只关心“如何调用上传器”，
 * 不应真的触达 COS SDK。
 */
import { vi } from 'vitest';

export class TencentCosUploader {
	static instances: TencentCosUploader[] = [];
	/** 非 null 时，构造函数抛出该错误 */
	static constructorError: Error | null = null;
	/** testConnection 的返回值 */
	static connectionOk = true;
	/** 非 null 时，testConnection 等待该 Promise（模拟慢网络） */
	static connectionGate: Promise<boolean> | null = null;

	static reset(): void {
		TencentCosUploader.instances = [];
		TencentCosUploader.constructorError = null;
		TencentCosUploader.connectionOk = true;
		TencentCosUploader.connectionGate = null;
	}

	uploadFile = vi.fn((file: File, _note?: unknown) =>
		Promise.resolve({
			url: `https://cos/${file.name}`,
			displayName: file.name.replace(/\.[^.]+$/, ''),
		}),
	);
	testConnection = vi.fn(
		() =>
			TencentCosUploader.connectionGate ??
			Promise.resolve(TencentCosUploader.connectionOk),
	);
	refreshSignedUrl = vi.fn((fileName: string) =>
		Promise.resolve(`https://new/${fileName}`),
	);
	downloadObject = vi.fn((_key: string) => Promise.resolve(new ArrayBuffer(4)));
	isCosUrl = vi.fn((url: string) => url.startsWith('https://cos/'));
	getObjectKeyFromUrl = vi.fn((url: string): string | null =>
		url.startsWith('https://cos/') ? url.slice('https://cos/'.length) || null : null,
	);

	constructor(public readonly settings: unknown) {
		if (TencentCosUploader.constructorError) {
			throw TencentCosUploader.constructorError;
		}
		TencentCosUploader.instances.push(this);
	}
}
