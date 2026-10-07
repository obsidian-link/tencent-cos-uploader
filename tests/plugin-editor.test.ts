import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Notice } from './mocks/obsidian';
import { CONFIGURED, createEnv, flushPromises, makeFile } from './helpers/env';
import { TencentCosUploader as FakeUploader } from './mocks/uploader';

vi.mock('../src/uploader', () => import('./mocks/uploader'));
vi.mock('../src/modal', () => import('./mocks/modal'));
vi.mock('../src/image-resizer', () => import('./mocks/image-resizer'));

const CURSOR = { line: 3, ch: 7 };

function makeEditor(selection = '') {
	return {
		replaceRange: vi.fn(),
		replaceSelection: vi.fn(),
		getCursor: vi.fn(() => CURSOR),
		getSelection: vi.fn(() => selection),
	};
}

function image(name = 'shot.png'): File {
	return new File(['x'], name, { type: 'image/png' });
}

function pdf(name = 'doc.pdf'): File {
	return new File(['x'], name, { type: 'application/pdf' });
}

function pasteEvent(files: File[]) {
	return {
		defaultPrevented: false,
		preventDefault: vi.fn(),
		stopPropagation: vi.fn(),
		clipboardData: { files },
	};
}

function dropEvent(files: File[]) {
	return {
		defaultPrevented: false,
		preventDefault: vi.fn(),
		stopPropagation: vi.fn(),
		dataTransfer: { files },
	};
}

type EventHandler = (event: unknown, editor: unknown, info: unknown) => void;

const note = makeFile('notes/daily note.md');

async function setup(settings = {}) {
	const env = createEnv({ ...CONFIGURED, ...settings });
	await env.plugin.onload();
	const uploader = env.useFakeUploader();
	return { ...env, uploader, editor: makeEditor() };
}

beforeEach(() => {
	FakeUploader.reset();
	Notice.reset();
	vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('editor-paste', () => {
	it('粘贴图片：同步阻止默认行为，上传后在光标处插入图片链接', async () => {
		const { handler, uploader, editor } = await setup();
		const event = pasteEvent([image()]);

		handler<EventHandler>('editor-paste')(event, editor, { file: note });
		// 阻止默认粘贴必须在任何 await 之前同步完成
		expect(event.preventDefault).toHaveBeenCalledTimes(1);
		await flushPromises();

		expect(uploader.uploadFile).toHaveBeenCalledWith(expect.any(File), {
			noteName: 'daily note',
			notePath: 'notes/daily note.md',
		});
		expect(editor.replaceRange).toHaveBeenCalledWith('![shot](https://cos/shot.png)', CURSOR);
		expect(Notice.messages).toEqual(['图片上传成功！']);
	});

	it('粘贴未启用的非图片文件：不拦截，交给 Obsidian 默认处理', async () => {
		const { handler, uploader, editor } = await setup({ enableFileUpload: false });
		const event = pasteEvent([pdf()]);

		handler<EventHandler>('editor-paste')(event, editor, { file: note });
		await flushPromises();

		expect(event.preventDefault).not.toHaveBeenCalled();
		expect(uploader.uploadFile).not.toHaveBeenCalled();
	});

	it('启用多格式上传后，白名单内的文件以普通链接插入', async () => {
		const { handler, editor } = await setup({ enableFileUpload: true });
		const event = pasteEvent([pdf('report.pdf')]);

		handler<EventHandler>('editor-paste')(event, editor, { file: note });
		await flushPromises();

		expect(event.preventDefault).toHaveBeenCalled();
		expect(editor.replaceRange).toHaveBeenCalledWith('[report.pdf](https://cos/report.pdf)', CURSOR);
		expect(Notice.messages).toEqual(['文件上传成功！']);
	});

	it('启用多格式上传但扩展名不在白名单：不拦截', async () => {
		const { handler, editor } = await setup({
			enableFileUpload: true,
			allowedFileExtensions: 'zip, .MP3',
		});
		const event = pasteEvent([pdf()]);

		handler<EventHandler>('editor-paste')(event, editor, { file: note });
		await flushPromises();

		expect(event.preventDefault).not.toHaveBeenCalled();
	});

	it('白名单配置容错：忽略空格、前导点与大小写', async () => {
		const { handler, editor } = await setup({
			enableFileUpload: true,
			allowedFileExtensions: ' .PDF , zip ,, ',
		});
		const event = pasteEvent([pdf()]);

		handler<EventHandler>('editor-paste')(event, editor, { file: note });
		await flushPromises();

		expect(editor.replaceRange).toHaveBeenCalled();
	});

	it('手动上传模式：完全不处理', async () => {
		const { handler, uploader, editor } = await setup({ manualUploadMode: true });
		const event = pasteEvent([image()]);

		handler<EventHandler>('editor-paste')(event, editor, { file: note });
		await flushPromises();

		expect(event.preventDefault).not.toHaveBeenCalled();
		expect(uploader.uploadFile).not.toHaveBeenCalled();
	});

	it('事件已被其他插件处理（defaultPrevented）：不重复处理', async () => {
		const { handler, uploader, editor } = await setup();
		const event = { ...pasteEvent([image()]), defaultPrevented: true };

		handler<EventHandler>('editor-paste')(event, editor, { file: note });
		await flushPromises();

		expect(uploader.uploadFile).not.toHaveBeenCalled();
	});

	it('剪贴板无文件（纯文本粘贴）：不拦截', async () => {
		const { handler, editor } = await setup();
		const event = pasteEvent([]);

		handler<EventHandler>('editor-paste')(event, editor, { file: note });

		expect(event.preventDefault).not.toHaveBeenCalled();
	});

	it('没有 clipboardData 时安全返回', async () => {
		const { handler, editor } = await setup();
		const event = { defaultPrevented: false, preventDefault: vi.fn(), clipboardData: null };

		expect(() =>
			handler<EventHandler>('editor-paste')(event, editor, { file: note }),
		).not.toThrow();
		expect(event.preventDefault).not.toHaveBeenCalled();
	});

	it('找不到当前笔记：提示并且不上传', async () => {
		const { handler, uploader, editor } = await setup();

		handler<EventHandler>('editor-paste')(pasteEvent([image()]), editor, { file: null });
		await flushPromises();

		expect(Notice.messages).toEqual(['未找到当前文件']);
		expect(uploader.uploadFile).not.toHaveBeenCalled();
	});

	it('上传器未初始化：提示配置问题', async () => {
		const { handler, plugin, editor } = await setup();
		plugin.uploader = null;

		handler<EventHandler>('editor-paste')(pasteEvent([image()]), editor, { file: note });
		await flushPromises();

		expect(Notice.messages).toEqual(['COS上传器未初始化，请检查配置']);
	});

	it('多文件按顺序上传；某个失败不影响后续文件', async () => {
		const { handler, uploader, editor } = await setup();
		uploader.uploadFile.mockRejectedValueOnce(new Error('timeout'));
		const event = pasteEvent([image('a.png'), image('b.png')]);

		handler<EventHandler>('editor-paste')(event, editor, { file: note });
		await flushPromises();

		expect(uploader.uploadFile).toHaveBeenCalledTimes(2);
		expect(editor.replaceRange).toHaveBeenCalledTimes(1);
		expect(editor.replaceRange).toHaveBeenCalledWith('![b](https://cos/b.png)', CURSOR);
		expect(Notice.messages).toEqual(['文件上传失败：timeout', '图片上传成功！']);
	});

	it('混合粘贴：只上传受支持的文件', async () => {
		const { handler, uploader, editor } = await setup();

		handler<EventHandler>('editor-paste')(pasteEvent([pdf(), image('ok.png')]), editor, {
			file: note,
		});
		await flushPromises();

		expect(uploader.uploadFile).toHaveBeenCalledTimes(1);
		expect(uploader.uploadFile.mock.calls[0]?.[0].name).toBe('ok.png');
	});
});

describe('editor-drop', () => {
	it('拖拽图片：阻止默认并停止冒泡，上传后插入链接', async () => {
		const { handler, editor } = await setup();
		const event = dropEvent([image()]);

		handler<EventHandler>('editor-drop')(event, editor, { file: note });
		expect(event.preventDefault).toHaveBeenCalledTimes(1);
		expect(event.stopPropagation).toHaveBeenCalledTimes(1);
		await flushPromises();

		expect(editor.replaceRange).toHaveBeenCalledWith('![shot](https://cos/shot.png)', CURSOR);
	});

	it('拖拽含不受支持的文件时同样接管事件，但只上传受支持的部分', async () => {
		const { handler, uploader, editor } = await setup();
		const event = dropEvent([pdf(), image('ok.png')]);

		handler<EventHandler>('editor-drop')(event, editor, { file: note });
		await flushPromises();

		expect(event.preventDefault).toHaveBeenCalled();
		expect(uploader.uploadFile).toHaveBeenCalledTimes(1);
	});

	it('手动上传模式：交由 Obsidian 保存本地附件', async () => {
		const { handler, uploader, editor } = await setup({ manualUploadMode: true });
		const event = dropEvent([image()]);

		handler<EventHandler>('editor-drop')(event, editor, { file: note });
		await flushPromises();

		expect(event.preventDefault).not.toHaveBeenCalled();
		expect(uploader.uploadFile).not.toHaveBeenCalled();
	});

	it('拖拽的不是文件（如文本）：不拦截', async () => {
		const { handler, editor } = await setup();
		const event = dropEvent([]);

		handler<EventHandler>('editor-drop')(event, editor, { file: note });

		expect(event.preventDefault).not.toHaveBeenCalled();
	});

	it('已被其他处理者拦截：跳过', async () => {
		const { handler, uploader, editor } = await setup();
		const event = { ...dropEvent([image()]), defaultPrevented: true };

		handler<EventHandler>('editor-drop')(event, editor, { file: note });
		await flushPromises();

		expect(uploader.uploadFile).not.toHaveBeenCalled();
	});
});

describe('editor-menu：上传选中的本地附件', () => {
	it('选中包含本地附件链接时，才出现菜单项', async () => {
		const { collectMenuItems } = await setup();

		const items = collectMenuItems('editor-menu', makeEditor('![[a.png]] 与文字'), {
			file: note,
		});

		expect(items.map((i) => [i.title, i.icon])).toEqual([['上传附件到 COS', 'upload-cloud']]);
	});

	it.each([
		['空选区', ''],
		['纯空白', '   '],
		['纯文本', 'hello world'],
		['仅外链', '![x](https://example.com/a.png)'],
		['仅笔记链接', '[[some note]]'],
	])('%s：不出现菜单项', async (_label, selection) => {
		const { collectMenuItems } = await setup();

		const items = collectMenuItems('editor-menu', makeEditor(selection), { file: note });

		expect(items).toEqual([]);
	});

	it('点击后上传并替换选区；成功时提示数量', async () => {
		const { collectMenuItems, app, uploader } = await setup();
		const attachment = makeFile('assets/a.png');
		app.metadataCache.getFirstLinkpathDest.mockReturnValue(attachment);
		const editor = makeEditor('前 ![[a.png|200]] 后');

		const [item] = collectMenuItems('editor-menu', editor, { file: note });
		await item?.click();
		await flushPromises();

		expect(uploader.uploadFile).toHaveBeenCalledTimes(1);
		expect(editor.replaceSelection).toHaveBeenCalledWith('前 ![a*200](https://cos/a.png) 后');
		expect(Notice.messages).toEqual(['成功上传 1 个附件到 COS']);
	});

	it('上传器未初始化 / 无当前笔记：给出提示', async () => {
		const { collectMenuItems, plugin } = await setup();
		const editor = makeEditor('![[a.png]]');

		const [item] = collectMenuItems('editor-menu', editor, { file: note });
		plugin.uploader = null;
		await item?.click();
		await flushPromises();
		expect(Notice.messages).toEqual(['COS 上传器未初始化，请检查配置']);

		Notice.reset();
		const { collectMenuItems: collect2 } = await setup();
		const [item2] = collect2('editor-menu', editor, { file: null });
		await item2?.click();
		await flushPromises();
		expect(Notice.messages).toEqual(['未找到当前笔记']);
	});

	it('全部上传失败时，只提示失败数量且不改动选区', async () => {
		const { collectMenuItems, app, uploader } = await setup();
		app.metadataCache.getFirstLinkpathDest.mockReturnValue(makeFile('assets/a.png'));
		uploader.uploadFile.mockRejectedValue(new Error('denied'));
		const editor = makeEditor('![[a.png]]');

		const [item] = collectMenuItems('editor-menu', editor, { file: note });
		await item?.click();
		await flushPromises();

		expect(editor.replaceSelection).not.toHaveBeenCalled();
		expect(Notice.messages).toEqual(['附件上传失败，共 1 个']);
	});
});
