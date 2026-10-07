import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type RequestUrlResponse, requestUrl } from 'obsidian';
import { DEFAULT_SETTINGS, type TencentCosSettings } from '../src/types';
import { TencentCosUploader } from '../src/uploader';

const cosMock = vi.hoisted(() => {
	const methods = {
		getObjectUrl: vi.fn(),
		getAuthorization: vi.fn(() => 'q-sign-mock'),
	};
	const constructed: unknown[] = [];
	class MockCOS {
		static getAuthorization = methods.getAuthorization;
		getObjectUrl = methods.getObjectUrl;
		constructor(options: unknown) {
			constructed.push(options);
		}
	}
	return { methods, constructed, MockCOS };
});

vi.mock('cos-js-sdk-v5', () => ({ default: cosMock.MockCOS }));

const SIGNED_URL = 'https://b-125.cos.ap-guangzhou.myqcloud.com/images/x.png?q-sign=abc';

function makeSettings(
	overrides: Partial<TencentCosSettings> = {},
): TencentCosSettings {
	return {
		...DEFAULT_SETTINGS,
		secretId: 'id',
		secretKey: 'key',
		bucket: 'b-125',
		region: 'ap-guangzhou',
		...overrides,
	};
}

function mockResponse(
	overrides: Partial<RequestUrlResponse> = {},
): RequestUrlResponse {
	return {
		status: 200,
		headers: {},
		arrayBuffer: new ArrayBuffer(0),
		text: '',
		json: {},
		...overrides,
	};
}

const note = { noteName: 'My Note', notePath: 'notes/my-note.md' };

function file(name: string): File {
	return new File(['data'], name, { type: 'image/png' });
}

/** 取最后一次 requestUrl 上传使用的 Key */
function lastPutKey(): string {
	const calls = vi.mocked(requestUrl).mock.calls;
	const lastCall = calls[calls.length - 1]?.[0];
	if (!lastCall) return '';
	const url = typeof lastCall === 'string' ? lastCall : (lastCall as { url: string }).url;
	const pathname = new URL(url).pathname;
	return decodeURIComponent(pathname.replace(/^\/+/, ''));
}

beforeEach(() => {
	cosMock.constructed.length = 0;
	vi.mocked(requestUrl).mockReset();
	vi.mocked(requestUrl).mockResolvedValue(mockResponse());
	cosMock.methods.getObjectUrl.mockImplementation(
		(_params: unknown, callback: (err: null, data: { Url: string }) => void) => {
			callback(null, { Url: SIGNED_URL });
			return SIGNED_URL;
		},
	);
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe('构造函数', () => {
	it('缺少 SecretId / SecretKey 时抛错', () => {
		expect(() => new TencentCosUploader(makeSettings({ secretId: '' }))).toThrow(
			'SecretId',
		);
		expect(() => new TencentCosUploader(makeSettings({ secretKey: '' }))).toThrow(
			'SecretKey',
		);
	});

	it('使用设置中的凭据创建 COS 客户端，并强制 HTTPS', () => {
		new TencentCosUploader(makeSettings());
		expect(cosMock.constructed).toEqual([
			{ SecretId: 'id', SecretKey: 'key', Protocol: 'https:' },
		]);
	});
});

describe('testConnection', () => {
	it('通过 requestUrl 测试成功时返回 true', async () => {
		const uploader = new TencentCosUploader(makeSettings());
		await expect(uploader.testConnection()).resolves.toBe(true);
		expect(requestUrl).toHaveBeenCalledWith(
			expect.objectContaining({
				url: 'https://b-125.cos.ap-guangzhou.myqcloud.com/?max-keys=1',
				method: 'GET',
			}),
		);
	});

	it('requestUrl 返回非 200 时返回 false 且不抛错', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		vi.mocked(requestUrl).mockResolvedValueOnce(
			mockResponse({ status: 403, text: 'AccessDenied' }),
		);
		const uploader = new TencentCosUploader(makeSettings());

		await expect(uploader.testConnection()).resolves.toBe(false);
	});

	it('requestUrl 抛出异常时返回 false 且不抛错', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		vi.mocked(requestUrl).mockRejectedValueOnce(new Error('Network unreachable'));
		const uploader = new TencentCosUploader(makeSettings());

		await expect(uploader.testConnection()).resolves.toBe(false);
	});
});

describe('uploadFile - 默认命名', () => {
	beforeEach(() => {
		vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
	});

	it('使用 时间戳-文件名 并拼接前缀', async () => {
		const uploader = new TencentCosUploader(makeSettings({ prefix: 'images' }));

		const result = await uploader.uploadFile(file('my pic.png'));

		expect(lastPutKey()).toBe('images/1700000000000-my-pic.png');
		expect(result.displayName).toBe('1700000000000-my-pic');
		expect(result.url).toBe(`${SIGNED_URL}&response-content-disposition=inline`);
	});

	it('无前缀时不带斜杠；无扩展名时不追加点', async () => {
		const uploader = new TencentCosUploader(makeSettings());

		await uploader.uploadFile(file('README'));

		expect(lastPutKey()).toBe('1700000000000-README');
	});

	it('把 File 作为 Body 通过 requestUrl 上传到配置的 Bucket / Region', async () => {
		const uploader = new TencentCosUploader(makeSettings());
		const f = file('a.png');

		await uploader.uploadFile(f);

		const calls = vi.mocked(requestUrl).mock.calls;
		const req = calls[calls.length - 1]?.[0] as {
			url: string;
			method: string;
			contentType: string;
			headers: Record<string, string>;
		};
		expect(req.url).toBe(
			'https://b-125.cos.ap-guangzhou.myqcloud.com/1700000000000-a.png',
		);
		expect(req.method).toBe('PUT');
		expect(req.contentType).toBe('image/png');
		expect(req.headers.Host).toBe('b-125.cos.ap-guangzhou.myqcloud.com');
		expect(req.headers.Authorization).toBe('q-sign-mock');
	});

	it('未配置 Bucket 或 Region 时抛错', async () => {
		await expect(
			new TencentCosUploader(makeSettings({ bucket: '' })).uploadFile(file('a.png')),
		).rejects.toThrow('存储桶');
		await expect(
			new TencentCosUploader(makeSettings({ region: '' })).uploadFile(file('a.png')),
		).rejects.toThrow('存储桶');
	});

	it('requestUrl 网络异常时向上抛出，不再请求签名', async () => {
		vi.mocked(requestUrl).mockRejectedValue(new Error('network down'));
		const uploader = new TencentCosUploader(makeSettings());

		await expect(uploader.uploadFile(file('a.png'))).rejects.toThrow('network down');
		expect(cosMock.methods.getObjectUrl).not.toHaveBeenCalled();
	});

	it('requestUrl 返回非 200 时抛出业务错误，不再请求签名', async () => {
		vi.mocked(requestUrl).mockResolvedValue(
			mockResponse({ status: 403, text: 'Access Denied' }),
		);
		const uploader = new TencentCosUploader(makeSettings());

		await expect(uploader.uploadFile(file('a.png'))).rejects.toThrow('COS 上传失败 [HTTP 403]');
		expect(cosMock.methods.getObjectUrl).not.toHaveBeenCalled();
	});

	it('开启自定义命名但缺少笔记上下文时，仍使用默认命名', async () => {
		const uploader = new TencentCosUploader(
			makeSettings({ enableCustomNaming: true }),
		);

		await uploader.uploadFile(file('a.png'));

		expect(lastPutKey()).toBe('1700000000000-a.png');
	});
});

describe('uploadFile - 自定义命名模板', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		// 本地时间 2026-10-07 08:05:03
		vi.setSystemTime(new Date(2026, 9, 7, 8, 5, 3));
	});

	function customUploader(overrides: Partial<TencentCosSettings>) {
		return new TencentCosUploader(
			makeSettings({ enableCustomNaming: true, ...overrides }),
		);
	}

	it('默认模板：{notename}-{timestamp}-{counter} + 扩展名', async () => {
		const uploader = customUploader({});

		const result = await uploader.uploadFile(file('a b.png'), note);

		expect(lastPutKey()).toBe('MyNote-2026-1007-08:05:03-1.png');
		expect(result.displayName).toBe('MyNote-2026-1007-08:05:03-1');
	});

	it('支持日期目录与 {filename}', async () => {
		const uploader = customUploader({
			namingPattern: '{year}/{mon}/{day}/{filename}',
			prefix: '/blog/',
		});

		await uploader.uploadFile(file('my pic.png'), note);

		expect(lastPutKey()).toBe('blog/2026/10/07/my-pic.png');
	});

	it('{basename}{ext} 与 {month} 别名', async () => {
		const uploader = customUploader({
			namingPattern: '{month}-{basename}{ext}',
		});

		await uploader.uploadFile(file('x y.jpg'), note);

		expect(lastPutKey()).toBe('10-x-y.jpg');
	});

	it('{counter} 按笔记独立递增', async () => {
		const uploader = customUploader({ namingPattern: '{notename}-{counter}' });

		await uploader.uploadFile(file('a.png'), note);
		await uploader.uploadFile(file('b.png'), note);
		await uploader.uploadFile(file('c.png'), {
			noteName: 'Other',
			notePath: 'other.md',
		});

		const keys = vi.mocked(requestUrl).mock.calls.map((call) => {
			const param = call[0];
			const url = typeof param === 'string' ? param : param.url;
			return decodeURIComponent(new URL(url).pathname.replace(/^\/+/, ''));
		});
		expect(keys).toEqual(['MyNote-1.png', 'MyNote-2.png', 'Other-1.png']);
	});

	it('模板未写扩展名时自动追加；已写则不重复', async () => {
		const uploader = customUploader({ namingPattern: 'fixed' });
		await uploader.uploadFile(file('a.png'), note);
		expect(lastPutKey()).toBe('fixed.png');

		const withExt = customUploader({ namingPattern: 'fixed.webp' });
		await withExt.uploadFile(file('a.png'), note);
		expect(lastPutKey()).toBe('fixed.webp');
	});

	it('未知变量原样保留，且不会命中原型属性', async () => {
		const uploader = customUploader({ namingPattern: '{constructor}-{nope}' });

		await uploader.uploadFile(file('a.png'), note);

		expect(lastPutKey()).toBe('{constructor}-{nope}.png');
	});

	it('剔除 . / .. 路径段并把反斜杠视为分隔符', async () => {
		const uploader = customUploader({ namingPattern: '..\\a/./b/../c' });

		await uploader.uploadFile(file('x.png'), note);

		expect(lastPutKey()).toBe('a/b/c.png');
	});

	it('模板为空白时回退到默认模板', async () => {
		const uploader = customUploader({ namingPattern: '   ' });

		await uploader.uploadFile(file('x.png'), note);

		expect(lastPutKey()).toBe('MyNote-2026-1007-08:05:03-1.png');
	});

	it('模板仅由非法段构成时回退到 笔记名-时间戳-序号', async () => {
		const uploader = customUploader({ namingPattern: '../..' });

		await uploader.uploadFile(file('x.png'), note);

		expect(lastPutKey()).toBe('MyNote-2026-1007-08:05:03-1.png');
	});

	it('{random} 生成 8 位以内的小写字母数字', async () => {
		const uploader = customUploader({ namingPattern: '{random}' });

		await uploader.uploadFile(file('x.png'), note);

		expect(lastPutKey()).toMatch(/^[a-z0-9]{1,8}\.png$/);
	});
});

describe('签名 URL', () => {
	it('私有桶：使用签名并追加 inline 响应头', async () => {
		const uploader = new TencentCosUploader(makeSettings({ expiration: 600 }));

		const { url } = await uploader.uploadFile(file('a.png'));

		expect(url.endsWith('&response-content-disposition=inline')).toBe(true);
		expect(cosMock.methods.getObjectUrl).toHaveBeenCalledWith(
			expect.objectContaining({ Sign: true, Expires: 600 }),
			expect.any(Function),
		);
	});

	it('SDK 返回的 URL 无查询串时使用 ? 连接', async () => {
		cosMock.methods.getObjectUrl.mockImplementation(
			(_p: unknown, cb: (e: null, d: { Url: string }) => void) =>
				cb(null, { Url: 'https://h.com/k.png' }),
		);
		const uploader = new TencentCosUploader(makeSettings());

		expect(await uploader.refreshSignedUrl('k.png')).toBe(
			'https://h.com/k.png?response-content-disposition=inline',
		);
	});

	it('配置自定义域名后替换签名 URL 的 origin', async () => {
		const uploader = new TencentCosUploader(
			makeSettings({ customDomain: 'img.example.com/' }),
		);

		const url = await uploader.refreshSignedUrl('x.png');

		expect(url).toBe(
			'https://img.example.com/images/x.png?q-sign=abc&response-content-disposition=inline',
		);
	});

	it('公有读：直接拼接 URL，不调用签名接口', async () => {
		const uploader = new TencentCosUploader(
			makeSettings({ publicRead: true, prefix: 'images' }),
		);

		const { url } = await uploader.uploadFile(file('a.png'));

		expect(url).toMatch(
			/^https:\/\/b-125\.cos\.ap-guangzhou\.myqcloud\.com\/images\/\d+-a\.png$/,
		);
		expect(cosMock.methods.getObjectUrl).not.toHaveBeenCalled();
	});

	it('公有读 + 自定义域名（HTTP）', async () => {
		const uploader = new TencentCosUploader(
			makeSettings({ publicRead: true, customDomain: 'http://img.example.com/' }),
		);

		expect(await uploader.refreshSignedUrl('a.png')).toBe(
			'http://img.example.com/a.png',
		);
	});

	it('签名失败时以 Error 拒绝，并带上 SDK 的 message', async () => {
		cosMock.methods.getObjectUrl.mockImplementation(
			(_p: unknown, cb: (e: { message: string }) => void) =>
				cb({ message: 'sign failed' }),
		);
		const uploader = new TencentCosUploader(makeSettings());

		await expect(uploader.refreshSignedUrl('a.png')).rejects.toThrow('sign failed');
	});
});

describe('refreshSignedUrl', () => {
	function lastSignedKey(): string {
		const calls = cosMock.methods.getObjectUrl.mock.calls;
		return (calls[calls.length - 1]?.[0] as { Key: string }).Key;
	}

	it('有前缀时在前缀目录下签名', async () => {
		await new TencentCosUploader(makeSettings({ prefix: 'images' })).refreshSignedUrl(
			'a.png',
		);
		expect(lastSignedKey()).toBe('images/a.png');
	});

	it('无前缀时不生成以 / 开头的 Key', async () => {
		await new TencentCosUploader(makeSettings()).refreshSignedUrl('a.png');
		expect(lastSignedKey()).toBe('a.png');
	});
});

describe('设置热更新', () => {
	it('与插件共享设置对象：修改后立即生效，无需重建实例', async () => {
		const settings = makeSettings({ publicRead: true });
		const uploader = new TencentCosUploader(settings);
		expect(await uploader.refreshSignedUrl('a.png')).toBe(
			'https://b-125.cos.ap-guangzhou.myqcloud.com/a.png',
		);

		settings.customDomain = 'cdn.example.com';

		expect(await uploader.refreshSignedUrl('a.png')).toBe(
			'https://cdn.example.com/a.png',
		);
	});
});

describe('downloadObject', () => {
	const uploader = () => new TencentCosUploader(makeSettings());

	it('通过签名 URL 和 requestUrl 获取 ArrayBuffer 原样返回', async () => {
		const buffer = new Uint8Array([1, 2, 3]).buffer;
		vi.mocked(requestUrl).mockResolvedValueOnce(
			mockResponse({ status: 200, arrayBuffer: buffer }),
		);

		const result = await uploader().downloadObject('a/b.png');
		expect(result).toBe(buffer);
		expect(requestUrl).toHaveBeenCalledWith({
			url: `${SIGNED_URL}&response-content-disposition=inline`,
			method: 'GET',
		});
	});

	it('下载非 200 状态码时抛出错误', async () => {
		vi.mocked(requestUrl).mockResolvedValueOnce(
			mockResponse({ status: 404, text: 'Not Found' }),
		);

		await expect(uploader().downloadObject('not-found.png')).rejects.toThrow(
			'COS 下载失败 [HTTP 404]',
		);
	});
});

describe('isCosUrl', () => {
	const uploader = new TencentCosUploader(
		makeSettings({ customDomain: 'Img.Example.com' }),
	);

	it.each([
		['https://b-125.cos.ap-guangzhou.myqcloud.com/a.png', true],
		['https://B-125.COS.ap-guangzhou.myqcloud.com/a.png', true],
		['https://img.example.com/a.png', true],
		['http://img.example.com:8080/a.png', true],
		['https://other-bucket.cos.ap-guangzhou.myqcloud.com/a.png', false],
		['https://evil.com/img.example.com/a.png', false],
		['not a url', false],
	])('%s -> %s', (url, expected) => {
		expect(uploader.isCosUrl(url)).toBe(expected);
	});

	it('未配置自定义域名时只认存储桶域名', () => {
		const plain = new TencentCosUploader(makeSettings());
		expect(plain.isCosUrl('https://img.example.com/a.png')).toBe(false);
	});
});

describe('getObjectKeyFromUrl', () => {
	const uploader = new TencentCosUploader(makeSettings());

	it('解码路径并去掉前导斜杠', () => {
		expect(
			uploader.getObjectKeyFromUrl('https://h.com/images/%E4%B8%AD.png?sign=1'),
		).toBe('images/中.png');
	});

	it('路径穿越或空路径返回 null', () => {
		expect(uploader.getObjectKeyFromUrl('https://h.com/a/..%2Fb.png')).toBeNull();
		expect(uploader.getObjectKeyFromUrl('https://h.com/')).toBeNull();
	});

	it('非法 URL 或非法编码返回 null', () => {
		expect(uploader.getObjectKeyFromUrl('nope')).toBeNull();
		expect(uploader.getObjectKeyFromUrl('https://h.com/%E4%B8')).toBeNull();
	});
});
