import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Notice, Setting } from './mocks/obsidian';
import { TencentCosSettingTab } from '../src/settings';
import { DEFAULT_SETTINGS, type TencentCosSettings } from '../src/types';
import type TencentCosPlugin from '../src/main';

interface FakePlugin {
	settings: TencentCosSettings;
	uploader: unknown;
	saveSettings: ReturnType<typeof vi.fn>;
	initUploader: ReturnType<typeof vi.fn>;
}

function render(overrides: Partial<TencentCosSettings> = {}) {
	const plugin: FakePlugin = {
		settings: { ...DEFAULT_SETTINGS, ...overrides },
		uploader: null,
		saveSettings: vi.fn(() => Promise.resolve()),
		initUploader: vi.fn(() => Promise.resolve()),
	};
	const tab = new TencentCosSettingTab({} as never, plugin as unknown as TencentCosPlugin);
	tab.display();
	return { plugin, tab };
}

function setting(name: string): Setting {
	const found = Setting.instances.find((s) => s.name === name);
	if (!found) throw new Error(`未找到设置项: ${name}`);
	return found;
}

/** 取文本类设置项的输入组件（单行或多行） */
function input(name: string) {
	const s = setting(name);
	const component = s.text ?? s.textArea;
	if (!component) throw new Error(`${name} 不是文本设置项`);
	return component;
}

async function type(name: string, value: string): Promise<void> {
	await input(name).changeHandler?.(value);
}

beforeEach(() => {
	Setting.instances = [];
	Notice.reset();
});

describe('display', () => {
	it('按顺序渲染全部设置项', () => {
		render();

		expect(Setting.instances.map((s) => s.name)).toEqual([
			'Secret Id',
			'Secret Key',
			'Bucket',
			'Region',
			'自定义域名',
			'存储路径前缀',
			'图片有效期',
			'公有读存储桶',
			'启用规则图片命名',
			'上传命名模板',
			'手动上传模式',
			'上传后删除本地附件',
			'启用多格式文件上传',
			'允许的文件类型',
			'测试上传',
		]);
	});

	it('用当前设置初始化各控件的值', () => {
		render({
			secretId: 'id',
			bucket: 'b-1',
			region: 'ap-beijing',
			publicRead: true,
			namingPattern: '{year}/{filename}',
			allowedFileExtensions: 'pdf',
		});

		expect(input('Secret Id').value).toBe('id');
		expect(input('Bucket').value).toBe('b-1');
		expect(setting('Region').dropdown?.value).toBe('ap-beijing');
		expect(setting('公有读存储桶').toggle?.value).toBe(true);
		expect(input('上传命名模板').value).toBe('{year}/{filename}');
		expect(input('允许的文件类型').value).toBe('pdf');
	});

	it('“允许的文件类型”使用多行输入，其余为单行', () => {
		render();

		expect(setting('允许的文件类型').textArea).not.toBeNull();
		expect(setting('允许的文件类型').text).toBeNull();
		expect(setting('Bucket').text).not.toBeNull();
	});
});

describe('文本设置项', () => {
	it('输入会被 trim 后保存', async () => {
		const { plugin } = render();

		await type('Bucket', '  my-bucket-125  ');

		expect(plugin.settings.bucket).toBe('my-bucket-125');
		expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
	});

	it.each(['Secret Id', 'Secret Key', 'Bucket'])('%s 变更后重建上传器', async (name) => {
		const { plugin } = render();

		await type(name, 'x');

		expect(plugin.initUploader).toHaveBeenCalledTimes(1);
	});

	it.each(['自定义域名', '存储路径前缀', '上传命名模板', '允许的文件类型'])(
		'%s 变更不会重建上传器',
		async (name) => {
			const { plugin } = render();

			await type(name, 'x');

			expect(plugin.initUploader).not.toHaveBeenCalled();
		},
	);

	it('自定义域名：去除首尾空白与末尾斜杠', async () => {
		const { plugin } = render();

		await type('自定义域名', '  https://img.example.com//  ');

		expect(plugin.settings.customDomain).toBe('https://img.example.com');
	});

	it('存储路径前缀：去除首尾斜杠，保留中间层级', async () => {
		const { plugin } = render();

		await type('存储路径前缀', ' /blog/images/ ');

		expect(plugin.settings.prefix).toBe('blog/images');
	});

	it('上传命名模板：去除首尾空白', async () => {
		const { plugin } = render();

		await type('上传命名模板', '  {year}/{filename}  ');

		expect(plugin.settings.namingPattern).toBe('{year}/{filename}');
	});

	it('允许的文件类型：原样保存（解析时再容错）', async () => {
		const { plugin } = render();

		await type('允许的文件类型', ' pdf, zip ');

		expect(plugin.settings.allowedFileExtensions).toBe(' pdf, zip ');
	});
});

describe('开关设置项', () => {
	async function toggle(name: string, value: boolean): Promise<void> {
		await setting(name).toggle?.changeHandler?.(value);
	}

	it.each([
		['公有读存储桶', 'publicRead', '已开启公有读模式，请确保COS存储桶已设置为公有读权限'],
		['启用规则图片命名', 'enableCustomNaming', '已开启规则图片命名'],
		['上传后删除本地附件', 'deleteLocalAfterUpload', '已开启：上传成功后将安全删除本地附件'],
		['启用多格式文件上传', 'enableFileUpload', '已开启多格式文件上传'],
	] as const)('%s：开启时保存并提示，关闭时只保存', async (name, key, notice) => {
		const { plugin } = render();

		await toggle(name, true);
		expect(plugin.settings[key]).toBe(true);
		expect(Notice.messages).toEqual([notice]);

		Notice.reset();
		await toggle(name, false);
		expect(plugin.settings[key]).toBe(false);
		expect(Notice.messages).toEqual([]);
		expect(plugin.saveSettings).toHaveBeenCalledTimes(2);
	});

	it('手动上传模式：开启不弹提示', async () => {
		const { plugin } = render();

		await toggle('手动上传模式', true);

		expect(plugin.settings.manualUploadMode).toBe(true);
		expect(Notice.messages).toEqual([]);
	});
});

describe('Region', () => {
	it('提供全部地域选项，值与标签一致', () => {
		render();
		const { options } = setting('Region').dropdown ?? { options: new Map() };

		expect(options.size).toBe(22);
		expect(options.get('ap-guangzhou')).toBe('广州（ap-guangzhou）');
		expect(options.get('eu-frankfurt')).toBe('法兰克福（eu-frankfurt）');
	});

	it('选择后保存', async () => {
		const { plugin } = render();

		await setting('Region').dropdown?.changeHandler?.('ap-shanghai');

		expect(plugin.settings.region).toBe('ap-shanghai');
		expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
	});
});

describe('图片有效期', () => {
	const DAY = 24 * 60 * 60;

	it('选项值为秒数；当前值被选中', () => {
		render({ expiration: 12 * 30 * DAY });
		const dropdown = setting('图片有效期').dropdown;

		expect([...(dropdown?.options.entries() ?? [])]).toEqual([
			[String(30 * DAY), '1个月'],
			[String(180 * DAY), '半年'],
			[String(360 * DAY), '1年'],
			[String(1080 * DAY), '3年'],
			[String(1800 * DAY), '5年'],
			[String(7300 * DAY), '20年'],
			[String(18250 * DAY), '50年'],
			[String(36500 * DAY), '永久'],
		]);
		expect(dropdown?.value).toBe(String(360 * DAY));
	});

	it('选择有效选项后保存秒数', async () => {
		const { plugin } = render();

		await setting('图片有效期').dropdown?.changeHandler?.(String(30 * DAY));

		expect(plugin.settings.expiration).toBe(30 * DAY);
		expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
	});

	it.each(['abc', '', '0', '-5'])('非法值 %j：提示且不保存', async (value) => {
		const { plugin } = render();
		const before = plugin.settings.expiration;

		await setting('图片有效期').dropdown?.changeHandler?.(value);

		expect(plugin.settings.expiration).toBe(before);
		expect(plugin.saveSettings).not.toHaveBeenCalled();
		expect(Notice.messages).toEqual(['请选择有效的时间选项']);
	});
});

describe('测试连接按钮', () => {
	async function clickTest(): Promise<void> {
		await setting('测试上传').button?.clickHandler?.();
	}

	it('按钮文案', () => {
		render();
		expect(setting('测试上传').button?.text).toBe('测试连接');
	});

	it('未初始化上传器：提示先配置', async () => {
		render();

		await clickTest();

		expect(Notice.messages).toEqual(['请先配置COS设置']);
	});

	it.each([
		[true, 'COS连接测试成功！'],
		[false, 'COS连接测试失败，请检查控制台日志'],
	])('连接结果 %s -> %s', async (ok, message) => {
		const { plugin } = render();
		plugin.uploader = { testConnection: vi.fn(() => Promise.resolve(ok)) };

		await clickTest();

		expect(Notice.messages).toEqual([message]);
	});

	it('点击测试时设置防抖与按钮禁用状态，防止频繁连点', async () => {
		const { plugin } = render();
		let resolveConnection: (ok: boolean) => void = () => undefined;
		plugin.uploader = {
			testConnection: vi.fn(
				() =>
					new Promise<boolean>((resolve) => {
						resolveConnection = resolve;
					}),
			),
		};

		const btn = setting('测试上传').button;
		// 第一次点击
		const firstClick = clickTest();
		expect(btn?.disabled).toBe(true);
		expect(btn?.text).toBe('测试中...');

		// 连点第二次（应被防抖拦截，不重复发起请求）
		await clickTest();
		expect((plugin.uploader as { testConnection: ReturnType<typeof vi.fn> }).testConnection).toHaveBeenCalledTimes(1);

		// 异步完成后恢复
		resolveConnection(true);
		await firstClick;

		expect(btn?.disabled).toBe(false);
		expect(btn?.text).toBe('测试连接');
		expect(Notice.messages).toEqual(['COS连接测试成功！']);
	});
});

