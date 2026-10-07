import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Notice, requestUrl } from './mocks/obsidian';
import { CONFIGURED, createEnv, flushPromises, makeFile } from './helpers/env';
import { TencentCosUploader as FakeUploader } from './mocks/uploader';

vi.mock('../src/uploader', () => import('./mocks/uploader'));
vi.mock('../src/modal', () => import('./mocks/modal'));
vi.mock('../src/image-resizer', () => import('./mocks/image-resizer'));

const note = makeFile('notes/n.md');
const pic = makeFile('assets/pic.png');

async function setup(settings = {}) {
	const env = createEnv({ ...CONFIGURED, ...settings });
	await env.plugin.onload();
	const uploader = env.useFakeUploader();
	env.contents.set(note, '');
	env.app.metadataCache.getFirstLinkpathDest.mockImplementation(
		(linkpath: string) => (linkpath === 'pic.png' ? pic : null),
	);
	return { ...env, uploader };
}

/** 第 n 次调用 `mock` 的全局调用序号，用于断言先后顺序 */
const callOrder = (mock: { mock: { invocationCallOrder: number[] } }, index = 0): number =>
	mock.mock.invocationCallOrder[index] ?? Number.NaN;

beforeEach(() => {
	FakeUploader.reset();
	Notice.reset();
	vi.spyOn(console, 'error').mockImplementation(() => undefined);
	vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('syncNoteAttachments：本地附件', () => {
	it('上传本地图片，替换为远程链接并保留宽度，写回笔记', async () => {
		const { internals, contents, app, uploader } = await setup();
		contents.set(note, '前\n![[pic.png|300]]\n后');

		const stats = await internals.syncNoteAttachments(note);

		expect(stats).toEqual({ uploadedCount: 1, failedCount: 0 });
		expect(app.vault.modify).toHaveBeenCalledWith(
			note,
			'前\n![pic*300](https://cos/pic.png)\n后',
		);
		const [file, context] = uploader.uploadFile.mock.calls[0] ?? [];
		expect(file).toMatchObject({ name: 'pic.png', type: 'image/png' });
		expect(context).toEqual({ noteName: 'n', notePath: 'notes/n.md' });
		expect(Notice.messages).toEqual(['成功同步 1 个附件到 COS']);
	});

	it('上传文件名中的空白字符会被去除', async () => {
		const { internals, contents, app, uploader } = await setup();
		const spaced = makeFile('assets/my pic.png');
		app.metadataCache.getFirstLinkpathDest.mockReturnValue(spaced);
		contents.set(note, '![[my pic.png]]');

		await internals.syncNoteAttachments(note);

		expect(uploader.uploadFile.mock.calls[0]?.[0].name).toBe('mypic.png');
	});

	it('同一附件被多处引用：只上传一次，所有引用都被替换', async () => {
		const { internals, contents, uploader } = await setup();
		contents.set(note, '![[pic.png]] 和 ![[pic.png]]');

		const stats = await internals.syncNoteAttachments(note);

		expect(uploader.uploadFile).toHaveBeenCalledTimes(1);
		expect(stats.uploadedCount).toBe(2);
		expect(contents.get(note)).toBe('![pic](https://cos/pic.png) 和 ![pic](https://cos/pic.png)');
	});

	it('非图片附件：未启用多格式上传时跳过且不计失败', async () => {
		const { internals, contents, app, uploader } = await setup({ enableFileUpload: false });
		app.metadataCache.getFirstLinkpathDest.mockReturnValue(makeFile('assets/doc.pdf'));
		contents.set(note, '[[doc.pdf]]');

		const stats = await internals.syncNoteAttachments(note);

		expect(stats).toEqual({ uploadedCount: 0, failedCount: 0 });
		expect(uploader.uploadFile).not.toHaveBeenCalled();
		expect(app.vault.modify).not.toHaveBeenCalled();
		expect(Notice.messages).toEqual(['未找到可同步的本地附件或外链图片']);
	});

	it('非图片附件：启用且在白名单内时以带 alt 的链接替换', async () => {
		const { internals, contents, app } = await setup({ enableFileUpload: true });
		app.metadataCache.getFirstLinkpathDest.mockReturnValue(makeFile('assets/doc.pdf'));
		contents.set(note, '[文档](doc.pdf)');

		await internals.syncNoteAttachments(note);

		expect(contents.get(note)).toBe('[文档](https://cos/doc.pdf)');
	});

	it('找不到的本地文件：跳过，不报失败', async () => {
		const { internals, contents } = await setup();
		contents.set(note, '![[missing.png]]');

		const stats = await internals.syncNoteAttachments(note);

		expect(stats).toEqual({ uploadedCount: 0, failedCount: 0 });
	});

	it('上传失败：计入失败、笔记不变、不删除本地文件', async () => {
		const { internals, contents, app, uploader } = await setup({
			deleteLocalAfterUpload: true,
		});
		uploader.uploadFile.mockRejectedValue(new Error('denied'));
		contents.set(note, '![[pic.png]]');

		const stats = await internals.syncNoteAttachments(note);

		expect(stats).toEqual({ uploadedCount: 0, failedCount: 1 });
		expect(app.vault.modify).not.toHaveBeenCalled();
		expect(app.fileManager.trashFile).not.toHaveBeenCalled();
		expect(Notice.messages).toEqual(['未能同步附件，1 个链接失败或不受支持']);
	});

	it('部分失败：成功的写回，提示中带失败数量', async () => {
		const { internals, contents, app, uploader } = await setup();
		const other = makeFile('assets/other.png');
		app.metadataCache.getFirstLinkpathDest.mockImplementation((p: string) =>
			p === 'pic.png' ? pic : p === 'other.png' ? other : null,
		);
		uploader.uploadFile.mockRejectedValueOnce(new Error('boom'));
		contents.set(note, '![[pic.png]] ![[other.png]]');

		const stats = await internals.syncNoteAttachments(note);

		expect(stats).toEqual({ uploadedCount: 1, failedCount: 1 });
		expect(contents.get(note)).toBe('![[pic.png]] ![other](https://cos/other.png)');
		expect(Notice.messages).toEqual(['成功同步 1 个附件到 COS，1 个失败']);
	});

	it('notify=false 时不弹提示（批量场景）', async () => {
		const { internals, contents } = await setup();
		contents.set(note, '![[pic.png]]');

		await internals.syncNoteAttachments(note, false);

		expect(Notice.messages).toEqual([]);
	});

	it('上传器未初始化：抛出明确错误', async () => {
		const { internals, plugin, contents } = await setup();
		plugin.uploader = null;
		contents.set(note, '![[pic.png]]');

		await expect(internals.syncNoteAttachments(note)).rejects.toThrow(
			'COS 上传器未初始化，请检查配置',
		);
	});
});

describe('syncNoteAttachments：上传后删除本地附件', () => {
	it('开启后：先写回笔记，成功后才移入废纸篓', async () => {
		const { internals, contents, app } = await setup({ deleteLocalAfterUpload: true });
		contents.set(note, '![[pic.png]]');

		await internals.syncNoteAttachments(note);

		expect(app.fileManager.trashFile).toHaveBeenCalledWith(pic);
		expect(callOrder(app.vault.modify)).toBeLessThan(callOrder(app.fileManager.trashFile));
	});

	it('写回笔记失败：本地文件保持不动，避免链接丢失', async () => {
		const { internals, contents, app } = await setup({ deleteLocalAfterUpload: true });
		contents.set(note, '![[pic.png]]');
		app.vault.modify.mockRejectedValueOnce(new Error('write failed'));

		await expect(internals.syncNoteAttachments(note)).rejects.toThrow('write failed');

		expect(app.fileManager.trashFile).not.toHaveBeenCalled();
	});

	it('默认关闭：不删除本地文件', async () => {
		const { internals, contents, app } = await setup();
		contents.set(note, '![[pic.png]]');

		await internals.syncNoteAttachments(note);

		expect(app.fileManager.trashFile).not.toHaveBeenCalled();
	});

	it('同一附件被引用多次：只删除一次', async () => {
		const { internals, contents, app } = await setup({ deleteLocalAfterUpload: true });
		contents.set(note, '![[pic.png]] ![[pic.png]]');

		await internals.syncNoteAttachments(note);

		expect(app.fileManager.trashFile).toHaveBeenCalledTimes(1);
	});

	it('删除失败不会影响同步结果', async () => {
		const { internals, contents, app } = await setup({ deleteLocalAfterUpload: true });
		app.fileManager.trashFile.mockRejectedValueOnce(new Error('locked'));
		contents.set(note, '![[pic.png]]');

		await expect(internals.syncNoteAttachments(note)).resolves.toEqual({
			uploadedCount: 1,
			failedCount: 0,
		});
	});

	it('绝不删除 Markdown 笔记', async () => {
		const { internals, app } = await setup({ deleteLocalAfterUpload: true });

		await internals.safelyDeleteLocalAttachment(makeFile('notes/other.md'));

		expect(app.fileManager.trashFile).not.toHaveBeenCalled();
		expect(console.warn).toHaveBeenCalled();
	});
});

describe('syncNoteAttachments：外链图片', () => {
	function mockRemoteImage(contentType: string | undefined) {
		vi.mocked(requestUrl).mockResolvedValue({
			status: 200,
			text: '',
			json: {},
			headers: contentType ? { 'content-type': contentType } : {},
			arrayBuffer: new ArrayBuffer(4),
		});
	}

	it('抓取外链图片并转存，使用响应 MIME 与 URL 文件名', async () => {
		const { internals, contents, uploader } = await setup();
		mockRemoteImage('image/jpeg; charset=binary');
		contents.set(note, '![远程](https://example.com/p/a.jpg)');

		const stats = await internals.syncNoteAttachments(note);

		expect(requestUrl).toHaveBeenCalledWith({ url: 'https://example.com/p/a.jpg', method: 'GET' });
		expect(uploader.uploadFile.mock.calls[0]?.[0]).toMatchObject({
			name: 'a.jpg',
			type: 'image/jpeg',
		});
		expect(stats.uploadedCount).toBe(1);
		expect(contents.get(note)).toBe('![a](https://cos/a.jpg)');
	});

	it('URL 无扩展名时按 MIME 补全；无 content-type 时按 PNG', async () => {
		const { internals, contents, uploader } = await setup();
		mockRemoteImage('image/webp');
		contents.set(note, '![x](https://example.com/avatar)');
		await internals.syncNoteAttachments(note);
		expect(uploader.uploadFile.mock.calls[0]?.[0].name).toBe('avatar.webp');

		mockRemoteImage(undefined);
		contents.set(note, '![x](https://example.com/other)');
		await internals.syncNoteAttachments(note);
		expect(uploader.uploadFile.mock.calls[1]?.[0]).toMatchObject({
			name: 'other.png',
			type: 'image/png',
		});
	});

	it('已是当前 COS 的链接 / 非图片外链：不重复转存', async () => {
		const { internals, contents, uploader } = await setup();
		contents.set(note, '![ours](https://cos/old.png) [pdf](https://example.com/a.pdf)');

		const stats = await internals.syncNoteAttachments(note);

		expect(requestUrl).not.toHaveBeenCalled();
		expect(uploader.uploadFile).not.toHaveBeenCalled();
		expect(stats).toEqual({ uploadedCount: 0, failedCount: 0 });
	});

	it('同一外链出现多次：只抓取并上传一次', async () => {
		const { internals, contents, uploader } = await setup();
		mockRemoteImage('image/png');
		contents.set(note, '![a](https://example.com/x.png) ![b](https://example.com/x.png)');

		const stats = await internals.syncNoteAttachments(note);

		expect(requestUrl).toHaveBeenCalledTimes(1);
		expect(uploader.uploadFile).toHaveBeenCalledTimes(1);
		expect(stats.uploadedCount).toBe(2);
	});

	it('抓取失败：计入失败并保留原链接', async () => {
		const { internals, contents } = await setup();
		vi.mocked(requestUrl).mockRejectedValue(new Error('404'));
		contents.set(note, '![x](https://example.com/x.png)');

		const stats = await internals.syncNoteAttachments(note);

		expect(stats).toEqual({ uploadedCount: 0, failedCount: 1 });
		expect(contents.get(note)).toBe('![x](https://example.com/x.png)');
	});

	it('本地与外链混合：合并统计后一次写回', async () => {
		const { internals, contents, app } = await setup();
		mockRemoteImage('image/png');
		contents.set(note, '![[pic.png]] ![x](https://example.com/y.png)');

		const stats = await internals.syncNoteAttachments(note);

		expect(stats).toEqual({ uploadedCount: 2, failedCount: 0 });
		expect(app.vault.modify).toHaveBeenCalledTimes(1);
		expect(contents.get(note)).toBe('![pic](https://cos/pic.png) ![y](https://cos/y.png)');
	});
});

describe('downloadCosAttachmentsInNote', () => {
	it('下载当前 COS 的附件到库内，并替换为本地链接', async () => {
		const { internals, contents, app, uploader } = await setup();
		contents.set(
			note,
			'![img*300](https://cos/images/a.png) [file](https://cos/doc.pdf) ![x](https://other.com/b.png)',
		);

		const stats = await internals.downloadCosAttachmentsInNote(note);

		expect(stats).toEqual({ downloadedCount: 2, failedCount: 0 });
		expect(uploader.downloadObject.mock.calls.map((c) => c[0])).toEqual([
			'images/a.png',
			'doc.pdf',
		]);
		expect(app.fileManager.getAvailablePathForAttachment).toHaveBeenCalledWith(
			'a.png',
			'notes/n.md',
		);
		expect(contents.get(note)).toBe(
			'![[a.png|300]] [file](doc.pdf) ![x](https://other.com/b.png)',
		);
	});

	it('同一链接重复出现：只下载一次', async () => {
		const { internals, contents, uploader } = await setup();
		contents.set(note, '![a](https://cos/a.png) ![b](https://cos/a.png)');

		const stats = await internals.downloadCosAttachmentsInNote(note);

		expect(uploader.downloadObject).toHaveBeenCalledTimes(1);
		expect(stats.downloadedCount).toBe(2);
	});

	it('文件名会被清理，避免非法字符', async () => {
		const { internals, contents, app } = await setup();
		contents.set(note, '![a](https://cos/dir/my%20pic%3A1.png)');

		await internals.downloadCosAttachmentsInNote(note);

		expect(app.fileManager.getAvailablePathForAttachment.mock.calls[0]?.[0]).toBe('mypic-1.png');
	});

	it('无法解析对象路径 / 下载失败：计入失败，保留原链接，且不写回', async () => {
		const { internals, contents, app, uploader } = await setup();
		uploader.getObjectKeyFromUrl.mockReturnValueOnce(null);
		uploader.downloadObject.mockRejectedValueOnce(new Error('404'));
		contents.set(note, '![a](https://cos/a.png) ![b](https://cos/b.png)');

		const stats = await internals.downloadCosAttachmentsInNote(note);

		expect(stats).toEqual({ downloadedCount: 0, failedCount: 2 });
		expect(app.vault.modify).not.toHaveBeenCalled();
		expect(contents.get(note)).toBe('![a](https://cos/a.png) ![b](https://cos/b.png)');
	});

	it('没有 COS 链接时不改动笔记', async () => {
		const { internals, contents, app } = await setup();
		contents.set(note, '![x](https://other.com/b.png)');

		await internals.downloadCosAttachmentsInNote(note);

		expect(app.vault.modify).not.toHaveBeenCalled();
	});

	it('上传器未初始化：抛出错误', async () => {
		const { internals, plugin } = await setup();
		plugin.uploader = null;

		await expect(internals.downloadCosAttachmentsInNote(note)).rejects.toThrow(
			'COS 上传器未初始化',
		);
	});
});

describe('file-menu', () => {
	it('仅对 Markdown 文件显示两个菜单项', async () => {
		const { collectMenuItems } = await setup();

		expect(collectMenuItems('file-menu', note).map((i) => [i.title, i.icon])).toEqual([
			['本地附件转存 COS', 'upload-cloud'],
			['刷新图片有效期', 'refresh-cw'],
		]);
		expect(collectMenuItems('file-menu', pic)).toEqual([]);
		expect(collectMenuItems('file-menu', { path: 'folder' })).toEqual([]);
	});

	it('“本地附件转存”：执行同步', async () => {
		const { collectMenuItems, contents, app } = await setup();
		contents.set(note, '![[pic.png]]');

		await collectMenuItems('file-menu', note)[0]?.click();
		await flushPromises();

		expect(app.vault.modify).toHaveBeenCalledTimes(1);
	});

	it('“本地附件转存”：上传器未初始化时提示', async () => {
		const { collectMenuItems, plugin } = await setup();
		plugin.uploader = null;

		await collectMenuItems('file-menu', note)[0]?.click();
		await flushPromises();

		expect(Notice.messages).toEqual(['COS 上传器未初始化，请检查配置']);
	});

	it('“刷新图片有效期”：按文件名重新签名并替换链接', async () => {
		const { collectMenuItems, contents, uploader } = await setup();
		contents.set(
			note,
			'![a](https://h.com/images/a.png?old=1) 与 ![b](https://h.com/b%20c.png)',
		);

		await collectMenuItems('file-menu', note)[1]?.click();
		await flushPromises();

		expect(uploader.refreshSignedUrl.mock.calls.map((c) => c[0])).toEqual(['a.png', 'b c.png']);
		expect(contents.get(note)).toBe(
			'![a](https://new/a.png) 与 ![b](https://new/b c.png)',
		);
		expect(Notice.messages).toContain('所有图片链接有效期已刷新');
	});

	it('“刷新图片有效期”：替换内容中的 $ 不会被当作特殊替换模式', async () => {
		const { collectMenuItems, contents, uploader } = await setup();
		uploader.refreshSignedUrl.mockResolvedValue('https://new/$&-$1.png');
		contents.set(note, '![a](https://h.com/a.png)');

		await collectMenuItems('file-menu', note)[1]?.click();
		await flushPromises();

		expect(contents.get(note)).toBe('![a](https://new/$&-$1.png)');
	});

	it('“刷新图片有效期”：无图片链接 / 单个失败时的提示', async () => {
		const { collectMenuItems, contents, uploader, app } = await setup();

		contents.set(note, '没有图片');
		await collectMenuItems('file-menu', note)[1]?.click();
		await flushPromises();
		expect(Notice.messages).toEqual(['未找到图片链接']);

		Notice.reset();
		uploader.refreshSignedUrl.mockRejectedValue(new Error('sign error'));
		contents.set(note, '![a](https://h.com/a.png)');
		await collectMenuItems('file-menu', note)[1]?.click();
		await flushPromises();
		expect(Notice.messages).toEqual(['刷新图片 https://h.com/a.png 失败: sign error']);
		expect(app.vault.modify).not.toHaveBeenCalled();
	});
});

describe('findAttachmentFile', () => {
	it('优先使用 Obsidian 的链接解析结果，并解码与去除锚点', async () => {
		const { internals, app } = await setup();

		internals.findAttachmentFile('my%20pic.png#section', note);

		expect(app.metadataCache.getFirstLinkpathDest).toHaveBeenCalledWith('my pic.png', 'notes/n.md');
	});

	it('回退：按库内绝对路径查找', async () => {
		const { internals, app } = await setup();
		app.metadataCache.getFirstLinkpathDest.mockReturnValue(null);
		app.vault.getAbstractFileByPath.mockImplementation((path: string) =>
			path === 'assets/pic.png' ? pic : null,
		);

		expect(internals.findAttachmentFile('assets/pic.png', note)).toBe(pic);
	});

	it('回退：相对于笔记所在目录查找', async () => {
		const { internals, app } = await setup();
		app.metadataCache.getFirstLinkpathDest.mockReturnValue(null);
		app.vault.getAbstractFileByPath.mockImplementation((path: string) =>
			path === 'notes/img/pic.png' ? pic : null,
		);

		expect(internals.findAttachmentFile('img/pic.png', note)).toBe(pic);
	});

	it('回退：带扩展名时按文件名在整个库中搜索', async () => {
		const { internals, app } = await setup();
		app.metadataCache.getFirstLinkpathDest.mockReturnValue(null);
		app.vault.getFiles.mockReturnValue([note, pic]);

		expect(internals.findAttachmentFile('somewhere/else/pic.png', note)).toBe(pic);
	});

	it('无扩展名的普通词汇不会按文件名误匹配', async () => {
		const { internals, app } = await setup();
		app.metadataCache.getFirstLinkpathDest.mockReturnValue(null);
		app.vault.getFiles.mockReturnValue([makeFile('pic')]);

		expect(internals.findAttachmentFile('pic', note)).toBeNull();
	});
});

describe('文件类型判定', () => {
	it('isUploadableAttachment：图片总是可上传；其他类型取决于开关与白名单', async () => {
		const off = await setup({ enableFileUpload: false });
		expect(off.internals.isUploadableAttachment(makeFile('a.PNG'))).toBe(true);
		expect(off.internals.isUploadableAttachment(makeFile('a.pdf'))).toBe(false);

		const on = await setup({ enableFileUpload: true, allowedFileExtensions: 'pdf' });
		expect(on.internals.isUploadableAttachment(makeFile('a.PDF'))).toBe(true);
		expect(on.internals.isUploadableAttachment(makeFile('a.zip'))).toBe(false);
	});
});

describe('新附件自动上传', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	async function setupAuto(settings = {}) {
		const env = await setup(settings);
		env.app.workspace.getActiveFile.mockReturnValue(note);
		env.contents.set(note, '![[pic.png]]');
		return env;
	}

	it('新图片创建后延迟检查，笔记中已有链接则自动上传并写回', async () => {
		const { handler, uploader, contents } = await setupAuto();

		handler<(file: unknown) => void>('vault:create')(pic);
		expect(uploader.uploadFile).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(500);

		expect(uploader.uploadFile).toHaveBeenCalledTimes(1);
		expect(contents.get(note)).toBe('![pic](https://cos/pic.png)');
		expect(Notice.messages).toEqual(['已自动上传附件：pic.png']);
	});

	it('启用删除本地附件：写回后再移入废纸篓', async () => {
		const { handler, app } = await setupAuto({ deleteLocalAfterUpload: true });

		handler<(file: unknown) => void>('vault:create')(pic);
		await vi.advanceTimersByTimeAsync(500);

		expect(app.fileManager.trashFile).toHaveBeenCalledWith(pic);
		expect(callOrder(app.vault.modify)).toBeLessThan(callOrder(app.fileManager.trashFile));
	});

	it('链接尚未写入笔记时重试，最多共 3 次检查后放弃', async () => {
		const { handler, app, contents, uploader } = await setupAuto();
		contents.set(note, '还没有链接');

		handler<(file: unknown) => void>('vault:create')(pic);
		await vi.advanceTimersByTimeAsync(5000);

		expect(app.vault.read).toHaveBeenCalledTimes(3);
		expect(uploader.uploadFile).not.toHaveBeenCalled();
	});

	it('重试期间链接出现：随后一次检查成功上传', async () => {
		const { handler, contents, uploader } = await setupAuto();
		contents.set(note, '还没有链接');

		handler<(file: unknown) => void>('vault:create')(pic);
		await vi.advanceTimersByTimeAsync(500);
		contents.set(note, '![[pic.png]]');
		await vi.advanceTimersByTimeAsync(500);

		expect(uploader.uploadFile).toHaveBeenCalledTimes(1);
	});

	it('同一文件短时间内重复触发：只执行一条检查链', async () => {
		const { handler, app } = await setupAuto();

		handler<(file: unknown) => void>('vault:create')(pic);
		handler<(file: unknown) => void>('vault:create')(pic);
		await vi.advanceTimersByTimeAsync(500);

		expect(app.vault.read).toHaveBeenCalledTimes(1);
	});

	it.each([
		['手动上传模式', { manualUploadMode: true }, pic],
		['未启用多格式上传的非图片文件', {}, makeFile('assets/doc.pdf')],
	])('%s：不调度', async (_label, settings, file) => {
		const { handler, app } = await setupAuto(settings);

		handler<(f: unknown) => void>('vault:create')(file);
		await vi.advanceTimersByTimeAsync(5000);

		expect(app.vault.read).not.toHaveBeenCalled();
	});

	it('忽略文件夹等非文件对象', async () => {
		const { handler, app } = await setupAuto();

		handler<(f: unknown) => void>('vault:create')({ path: 'folder' });
		await vi.advanceTimersByTimeAsync(5000);

		expect(app.vault.read).not.toHaveBeenCalled();
	});

	it('当前活动文件不是 Markdown：不处理', async () => {
		const { handler, app } = await setupAuto();
		app.workspace.getActiveFile.mockReturnValue(pic);

		handler<(file: unknown) => void>('vault:create')(pic);
		await vi.advanceTimersByTimeAsync(5000);

		expect(app.vault.read).not.toHaveBeenCalled();
	});

	it('读取或上传出错：终止，不再重试', async () => {
		const { handler, app, uploader } = await setupAuto();
		uploader.uploadFile.mockRejectedValue(new Error('x'));

		handler<(file: unknown) => void>('vault:create')(pic);
		await vi.advanceTimersByTimeAsync(5000);

		// 上传失败只计入失败统计；链接已找到，因此不会进入重试
		expect(app.vault.read).toHaveBeenCalledTimes(1);
		expect(app.vault.modify).not.toHaveBeenCalled();
	});

	it('卸载插件时清除未执行的定时任务', async () => {
		const { handler, plugin, app } = await setupAuto();

		handler<(file: unknown) => void>('vault:create')(pic);
		plugin.onunload();
		await vi.advanceTimersByTimeAsync(5000);

		expect(app.vault.read).not.toHaveBeenCalled();
	});
});
