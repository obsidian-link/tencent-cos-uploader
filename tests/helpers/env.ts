import { vi, type Mock } from 'vitest';
import type { TFile } from 'obsidian';
import { TFile as MockTFile } from '../mocks/obsidian';
import TencentCosPlugin from '../../src/main';
import { DEFAULT_SETTINGS, type TencentCosSettings } from '../../src/types';
import type { TencentCosUploader } from '../../src/uploader';
import { TencentCosUploader as FakeUploaderClass } from '../mocks/uploader';

type Handler = (...args: never[]) => unknown;

export const CONFIGURED: Partial<TencentCosSettings> = {
	secretId: 'id',
	secretKey: 'key',
	bucket: 'b-125',
	region: 'ap-guangzhou',
};

/** 构造一个带有路径信息的 TFile */
export function makeFile(path: string): TFile {
	const name = path.split('/').pop() ?? path;
	const dot = name.lastIndexOf('.');
	const file = Object.assign(new MockTFile(), {
		path,
		name,
		basename: dot > 0 ? name.slice(0, dot) : name,
		extension: dot > 0 ? name.slice(dot + 1) : '',
		parent: { path: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '/' },
	});
	// 运行时是 mock 的 TFile（plugin 中的 instanceof 判断依赖它），类型上按真实 TFile 使用
	return file as unknown as TFile;
}

/** 插件内部（private）方法，仅测试中通过类型断言访问 */
export interface PluginInternals {
	syncNoteAttachments: (
		note: TFile,
		notify?: boolean,
	) => Promise<{ uploadedCount: number; failedCount: number }>;
	downloadCosAttachmentsInNote: (
		note: TFile,
	) => Promise<{ downloadedCount: number; failedCount: number }>;
	safelyDeleteLocalAttachment: (file: TFile) => Promise<void>;
	findAttachmentFile: (linkPath: string, source: TFile) => TFile | null;
	isAllowedFile: (file: File) => boolean;
	isUploadableAttachment: (file: TFile) => boolean;
}

export interface FakeMenuItem {
	title: string;
	icon: string;
	click: () => unknown;
}

/** 基类 Plugin 在测试中被替换为 vi.fn，这里提供带类型的访问入口 */
export interface PluginMocks {
	loadData: Mock<() => Promise<unknown>>;
	saveData: Mock<(data: unknown) => Promise<void>>;
	addCommand: Mock<(command: { id: string; callback: () => Promise<void> }) => void>;
	addSettingTab: Mock<(tab: unknown) => void>;
	registerMarkdownPostProcessor: Mock<(processor: (element: unknown) => void) => void>;
}

export interface Env {
	plugin: TencentCosPlugin;
	pluginMocks: PluginMocks;
	internals: PluginInternals;
	app: ReturnType<typeof createApp>;
	/** 以事件名为键记录插件注册的处理函数（vault 事件前缀 `vault:`） */
	handlers: Map<string, Handler>;
	/** 虚拟库：文件 → 文本内容 */
	contents: Map<TFile, string>;
	/** 取出已注册的事件处理函数 */
	handler: <T extends (...args: never[]) => unknown>(name: string) => T;
	/** 以 fake 上传器作为当前上传器 */
	useFakeUploader: () => FakeUploaderClass;
	/** 构造菜单并触发回调，返回收集到的菜单项 */
	collectMenuItems: (
		eventName: 'file-menu' | 'editor-menu',
		...args: unknown[]
	) => FakeMenuItem[];
}

function createApp(handlers: Map<string, Handler>, contents: Map<TFile, string>) {
	return {
		workspace: {
			on: vi.fn((name: string, callback: Handler) => {
				handlers.set(name, callback);
				return { name };
			}),
			onLayoutReady: vi.fn((callback: () => void) => callback()),
			getActiveFile: vi.fn((): TFile | null => null),
			getActiveViewOfType: vi.fn(() => null),
		},
		vault: {
			on: vi.fn((name: string, callback: Handler) => {
				handlers.set(`vault:${name}`, callback);
				return { name };
			}),
			read: vi.fn((file: TFile) => Promise.resolve(contents.get(file) ?? '')),
			modify: vi.fn((file: TFile, data: string) => {
				contents.set(file, data);
				return Promise.resolve();
			}),
			readBinary: vi.fn(() => Promise.resolve(new ArrayBuffer(8))),
			createBinary: vi.fn((path: string, _data: ArrayBuffer) =>
				Promise.resolve(makeFile(path)),
			),
			getMarkdownFiles: vi.fn((): TFile[] => []),
			getFiles: vi.fn((): TFile[] => []),
			getAbstractFileByPath: vi.fn((_path: string): TFile | null => null),
		},
		metadataCache: {
			getFirstLinkpathDest: vi.fn((_linkpath: string, _source: string): TFile | null => null),
			fileToLinktext: vi.fn((file: TFile) => file.name),
		},
		fileManager: {
			trashFile: vi.fn(() => Promise.resolve()),
			getAvailablePathForAttachment: vi.fn((name: string) =>
				Promise.resolve(`attachments/${name}`),
			),
		},
	};
}

/** 创建插件实例与全部 Obsidian 依赖的替身（尚未调用 onload） */
export function createEnv(settings: Partial<TencentCosSettings> = {}): Env {
	const handlers = new Map<string, Handler>();
	const contents = new Map<TFile, string>();
	const app = createApp(handlers, contents);
	const plugin = new TencentCosPlugin(app as never, {} as never);
	plugin.settings = { ...DEFAULT_SETTINGS, ...settings };
	// onload 会重新 loadSettings()，因此让“磁盘数据”与预设设置保持一致
	(plugin as unknown as PluginMocks).loadData.mockResolvedValue(settings);

	return {
		plugin,
		pluginMocks: plugin as unknown as PluginMocks,
		internals: plugin as unknown as PluginInternals,
		app,
		handlers,
		contents,
		handler<T extends (...args: never[]) => unknown>(name: string): T {
			const found = handlers.get(name);
			if (!found) throw new Error(`未注册事件处理函数: ${name}`);
			return found as T;
		},
		useFakeUploader() {
			const fake = new FakeUploaderClass(plugin.settings);
			plugin.uploader = fake as unknown as TencentCosUploader;
			return fake;
		},
		collectMenuItems(eventName, ...args) {
			const items: FakeMenuItem[] = [];
			const menu = {
				addItem: (build: (item: unknown) => unknown) => {
					const item: FakeMenuItem = { title: '', icon: '', click: () => undefined };
					const chain = {
						setTitle(title: string) {
							item.title = title;
							return chain;
						},
						setIcon(icon: string) {
							item.icon = icon;
							return chain;
						},
						onClick(callback: () => unknown) {
							item.click = callback;
							return chain;
						},
					};
					build(chain);
					items.push(item);
				},
			};
			const callback = handlers.get(eventName);
			if (!callback) throw new Error(`未注册事件处理函数: ${eventName}`);
			(callback as (...a: unknown[]) => unknown)(menu, ...args);
			return items;
		},
	};
}

/** 等待已触发但未 await 的异步任务（如 `void promise`）执行完 */
export async function flushPromises(): Promise<void> {
	for (let i = 0; i < 10; i++) await Promise.resolve();
}
