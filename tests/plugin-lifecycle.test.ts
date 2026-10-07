import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Notice, Platform } from './mocks/obsidian';
import { confirmOperation } from '../src/modal';
import { DEFAULT_SETTINGS } from '../src/types';
import {
	CONFIGURED,
	createEnv,
	flushPromises,
	makeFile,
	type PluginMocks,
} from './helpers/env';
import { ImageResizer } from './mocks/image-resizer';
import { TencentCosUploader as FakeUploader } from './mocks/uploader';

vi.mock('../src/uploader', () => import('./mocks/uploader'));
vi.mock('../src/modal', () => import('./mocks/modal'));
vi.mock('../src/image-resizer', () => import('./mocks/image-resizer'));

/** 取出 addCommand 注册的命令回调 */
function commandCallback(
	addCommand: PluginMocks['addCommand'],
	id: string,
): () => Promise<void> {
	const config = addCommand.mock.calls
		.map((call) => call[0])
		.find((command) => command.id === id);
	if (!config) throw new Error(`未注册命令: ${id}`);
	return config.callback;
}

beforeEach(() => {
	FakeUploader.reset();
	ImageResizer.reset();
	Platform.isDesktop = true;
	Notice.reset();
	vi.mocked(confirmOperation).mockResolvedValue(true);
});

describe('设置读写', () => {
	it('loadSettings：已保存的值覆盖默认值，缺失字段使用默认值', async () => {
		const { plugin, pluginMocks } = createEnv();
		pluginMocks.loadData.mockResolvedValue({ bucket: 'my-bucket', publicRead: true });

		await plugin.loadSettings();

		expect(plugin.settings).toEqual({
			...DEFAULT_SETTINGS,
			bucket: 'my-bucket',
			publicRead: true,
		});
	});

	it('loadSettings：无已保存数据时使用默认设置，且不共享引用', async () => {
		const { plugin } = createEnv();

		await plugin.loadSettings();

		expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
		expect(plugin.settings).not.toBe(DEFAULT_SETTINGS);
	});

	it('saveSettings：持久化当前设置', async () => {
		const { plugin, pluginMocks } = createEnv(CONFIGURED);

		await plugin.saveSettings();

		expect(pluginMocks.saveData).toHaveBeenCalledWith(plugin.settings);
	});
});

describe('onload', () => {
	it('配置不完整：提示去设置，不创建上传器，但仍注册设置页与命令', async () => {
		const { plugin, pluginMocks } = createEnv();

		await plugin.onload();

		expect(Notice.messages).toContain('请先在设置中配置腾讯云 COS 信息！');
		expect(FakeUploader.instances).toHaveLength(0);
		expect(plugin.uploader).toBeNull();
		expect(pluginMocks.addSettingTab).toHaveBeenCalledTimes(1);
		expect(pluginMocks.addCommand.mock.calls.map((c) => c[0].id)).toEqual([
			'sync-all-vault-attachments-to-cos',
			'download-all-cos-attachments-to-vault',
		]);
	});

	it('配置完整：创建上传器并测试连接，不提示“配置完成”', async () => {
		const { plugin } = createEnv(CONFIGURED);

		await plugin.onload();
		await flushPromises();

		expect(FakeUploader.instances).toHaveLength(1);
		expect(plugin.uploader).toBe(FakeUploader.instances[0]);
		expect(FakeUploader.instances[0]?.testConnection).toHaveBeenCalledTimes(1);
		expect(Notice.messages).toEqual([]);
	});

	it('onload 不会被慢速连接测试阻塞，事件与命令先于其完成注册', async () => {
		const { plugin, handlers } = createEnv(CONFIGURED);
		let finishConnection: (ok: boolean) => void = () => undefined;
		FakeUploader.connectionGate = new Promise<boolean>((resolve) => {
			finishConnection = resolve;
		});

		await plugin.onload(); // 若被连接测试阻塞，此处会永远挂起

		expect(handlers.has('editor-paste')).toBe(true);
		expect(handlers.has('vault:create')).toBe(true);
		expect(Notice.messages).toEqual([]);

		FakeUploader.connectionOk = false;
		finishConnection(false);
		await flushPromises();
		// 启动阶段静默初始化，即使临时连不上也不弹通知打扰用户
		expect(Notice.messages).toEqual([]);
	});

	it('注册编辑器、文件菜单与图片后处理等入口', async () => {
		const { plugin, pluginMocks, handlers } = createEnv(CONFIGURED);

		await plugin.onload();

		for (const name of ['editor-drop', 'editor-paste', 'editor-menu', 'file-menu']) {
			expect(handlers.has(name)).toBe(true);
		}
		expect(pluginMocks.registerMarkdownPostProcessor).toHaveBeenCalledTimes(1);
	});

	it('桌面端注册图片缩放器；移动端不注册', async () => {
		await createEnv().plugin.onload();
		expect(ImageResizer.instances).toHaveLength(1);
		expect(ImageResizer.instances[0]?.register).toHaveBeenCalledTimes(1);

		ImageResizer.reset();
		Platform.isDesktop = false;
		await createEnv().plugin.onload();
		expect(ImageResizer.instances).toHaveLength(0);
	});

	it('onunload：提示卸载', () => {
		const { plugin } = createEnv();

		plugin.onunload();

		expect(Notice.messages).toContain('你的图床插件已卸载!');
	});
});

describe('initUploader', () => {
	it('配置不完整时直接跳过', async () => {
		const { plugin } = createEnv({ ...CONFIGURED, bucket: '' });

		await plugin.initUploader();

		expect(FakeUploader.instances).toHaveLength(0);
		expect(plugin.uploader).toBeNull();
	});

	it('连接失败：提示检查配置，但上传器仍保留', async () => {
		const { plugin } = createEnv(CONFIGURED);
		FakeUploader.connectionOk = false;

		await plugin.initUploader();

		expect(Notice.messages).toEqual(['COS连接测试失败，请检查配置']);
		expect(plugin.uploader).not.toBeNull();
	});

	it('创建失败：提示错误原因，并保留旧上传器', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const { plugin, useFakeUploader } = createEnv(CONFIGURED);
		const previous = useFakeUploader();
		FakeUploader.constructorError = new Error('请先配置腾讯云 SecretId 和 SecretKey');

		await plugin.initUploader();

		expect(Notice.messages).toEqual([
			'插件初始化失败：请先配置腾讯云 SecretId 和 SecretKey',
		]);
		expect(plugin.uploader).toBe(previous);
	});

	it('首次完成配置并连接成功时，只提示一次“配置已完成”', async () => {
		const { plugin } = createEnv(); // 启动时未配置
		await plugin.onload();
		Notice.reset();

		Object.assign(plugin.settings, CONFIGURED);
		await plugin.initUploader();
		await plugin.initUploader();

		expect(Notice.messages).toEqual(['腾讯云 COS 配置已完成！']);
	});

	it('每次调用都会基于最新设置重建上传器', async () => {
		const { plugin } = createEnv(CONFIGURED);

		await plugin.initUploader();
		await plugin.initUploader();

		expect(FakeUploader.instances).toHaveLength(2);
		expect(plugin.uploader).toBe(FakeUploader.instances[1]);
	});
});

describe('命令：批量同步', () => {
	const COMMAND_ID = 'sync-all-vault-attachments-to-cos';

	it('未配置上传器时提示并停止，不弹确认框', async () => {
		const { plugin, pluginMocks } = createEnv();
		await plugin.onload();
		Notice.reset();

		await commandCallback(pluginMocks.addCommand, COMMAND_ID)();

		expect(Notice.messages).toEqual(['请先配置 COS 设置']);
		expect(confirmOperation).not.toHaveBeenCalled();
	});

	it('用户取消确认：不扫描任何笔记', async () => {
		const { plugin, pluginMocks, app, useFakeUploader } = createEnv(CONFIGURED);
		await plugin.onload();
		useFakeUploader();
		vi.mocked(confirmOperation).mockResolvedValueOnce(false);

		await commandCallback(pluginMocks.addCommand, COMMAND_ID)();

		expect(app.vault.getMarkdownFiles).not.toHaveBeenCalled();
	});

	it('确认后逐篇处理，并跳过 -backup.md 备份笔记', async () => {
		const { plugin, pluginMocks, app, useFakeUploader } = createEnv(CONFIGURED);
		await plugin.onload();
		useFakeUploader();
		const a = makeFile('a.md');
		const b = makeFile('b.md');
		const backup = makeFile('a-backup.md');
		app.vault.getMarkdownFiles.mockReturnValue([a, backup, b]);
		Notice.reset();

		await commandCallback(pluginMocks.addCommand, COMMAND_ID)();

		expect(app.vault.read.mock.calls.map((c) => c[0])).toEqual([a, b]);
		expect(Notice.messages).toEqual([
			'开始批量同步 2 篇笔记中的附件…',
			'批量附件同步完成：上传 0 个',
		]);
	});

	it('单篇笔记处理异常不会中断整体，并在汇总中体现', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const { plugin, pluginMocks, app, useFakeUploader } = createEnv(CONFIGURED);
		await plugin.onload();
		useFakeUploader();
		const a = makeFile('a.md');
		const b = makeFile('b.md');
		app.vault.getMarkdownFiles.mockReturnValue([a, b]);
		app.vault.read.mockRejectedValueOnce(new Error('disk error'));
		Notice.reset();

		await commandCallback(pluginMocks.addCommand, COMMAND_ID)();

		expect(app.vault.read).toHaveBeenCalledTimes(2);
		expect(Notice.messages.at(-1)).toBe('批量附件同步完成：上传 0 个，1 篇笔记处理失败');
	});
});

describe('命令：批量下载', () => {
	const COMMAND_ID = 'download-all-cos-attachments-to-vault';

	it('未配置上传器时提示并停止', async () => {
		const { plugin, pluginMocks } = createEnv();
		await plugin.onload();
		Notice.reset();

		await commandCallback(pluginMocks.addCommand, COMMAND_ID)();

		expect(Notice.messages).toEqual(['请先配置 COS 设置']);
		expect(confirmOperation).not.toHaveBeenCalled();
	});

	it('用户取消确认：不处理任何笔记', async () => {
		const { plugin, pluginMocks, app, useFakeUploader } = createEnv(CONFIGURED);
		await plugin.onload();
		useFakeUploader();
		vi.mocked(confirmOperation).mockResolvedValueOnce(false);

		await commandCallback(pluginMocks.addCommand, COMMAND_ID)();

		expect(app.vault.getMarkdownFiles).not.toHaveBeenCalled();
	});

	it('确认后遍历全部笔记并汇总，失败笔记计入统计', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const { plugin, pluginMocks, app, useFakeUploader } = createEnv(CONFIGURED);
		await plugin.onload();
		useFakeUploader();
		const a = makeFile('a.md');
		const b = makeFile('b.md');
		app.vault.getMarkdownFiles.mockReturnValue([a, b]);
		app.vault.read.mockRejectedValueOnce(new Error('disk error'));
		Notice.reset();

		await commandCallback(pluginMocks.addCommand, COMMAND_ID)();

		expect(Notice.messages).toEqual([
			'开始从 COS 下载 2 篇笔记中的附件…',
			'批量下载完成：下载 0 个附件，1 篇笔记处理失败',
		]);
	});
});

describe('阅读模式图片宽度后处理', () => {
	async function runPostProcessor(alts: Array<string | null>) {
		const { plugin, pluginMocks } = createEnv();
		await plugin.onload();
		const processor = pluginMocks.registerMarkdownPostProcessor.mock.calls[0]?.[0];
		if (!processor) throw new Error('未注册后处理器');
		const images = alts.map((alt) => ({
			getAttribute: vi.fn(() => alt),
			setCssStyles: vi.fn(),
		}));
		processor({ querySelectorAll: () => images });
		return images;
	}

	it('alt 以 *宽度 结尾且 ≥ 50 时设置宽度', async () => {
		const [img] = await runPostProcessor(['logo*300']);
		expect(img?.setCssStyles).toHaveBeenCalledWith({ width: '300px', height: 'auto' });
	});

	it('宽度小于 50、无后缀或无 alt 时不处理', async () => {
		const images = await runPostProcessor(['tiny*20', 'plain', null]);
		for (const img of images) expect(img.setCssStyles).not.toHaveBeenCalled();
	});
});
