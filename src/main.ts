import {
	Editor,
	MarkdownFileInfo,
	MarkdownView,
	Notice,
	Platform,
	Plugin,
	TFile,
	requestUrl,
} from 'obsidian';
import {
	buildLocalAttachmentLink,
	buildRemoteAttachmentLink,
	extractAttachmentLinks,
} from './attachment-links';
import { ImageResizer } from './image-resizer';
import { confirmOperation } from './modal';
import { TencentCosSettingTab } from './settings';
import {
	DEFAULT_SETTINGS,
	type AttachmentLink,
	type NoteContext,
	type SyncStats,
	type TencentCosSettings,
	type UploadResult,
} from './types';
import { TencentCosUploader } from './uploader';
import {
	extensionForMimeType,
	filenameFromUrl,
	getErrorMessage,
	getMimeType,
	hasFileExtension,
	isImageExtension,
	safeDecodeURIComponent,
	sanitizeFileName,
} from './utils';

const AUTO_UPLOAD_DELAY_MS = 500;
const AUTO_UPLOAD_MAX_RETRIES = 2;
const UPLOADER_NOT_READY = 'COS 上传器未初始化，请检查配置';
const BACKUP_FILE_SUFFIX = '-backup.md';

/** 单次上传阶段的结果（附带内容替换和已上传的本地文件） */
interface UploadPhaseResult extends SyncStats {
	content: string;
}

interface LocalUploadPhaseResult extends UploadPhaseResult {
	/** 成功上传的本地文件；应在笔记写回成功后再按需删除 */
	uploadedFiles: TFile[];
}

type EditorInfo = MarkdownView | MarkdownFileInfo;

function toNoteContext(file: TFile): NoteContext {
	return { noteName: file.basename || '未命名', notePath: file.path };
}

export default class TencentCosPlugin extends Plugin {
	override settings: TencentCosSettings = { ...DEFAULT_SETTINGS };
	uploader: TencentCosUploader | null = null;

	private readonly pendingAutoUploads = new Map<string, number>();
	/** 首次完成配置并连接成功时，提示一次“配置已完成” */
	private awaitingFirstSetup = false;

	override async onload(): Promise<void> {
		await this.loadSettings();
		this.awaitingFirstSetup = !this.isConfigured();

		this.addSettingTab(new TencentCosSettingTab(this.app, this));
		this.registerImagePostProcessor();
		if (Platform.isDesktop) new ImageResizer(this).register();
		this.registerEditorEvents();
		this.registerMenuEvents();
		this.registerCommands();

		// 启动阶段 vault 会为每个已有文件触发 create，等布局就绪后再监听
		this.app.workspace.onLayoutReady(() => {
			this.registerEvent(
				this.app.vault.on('create', (file) => {
					if (file instanceof TFile) this.scheduleAutoUpload(file);
				}),
			);
		});

		if (this.awaitingFirstSetup) {
			new Notice('请先在设置中配置腾讯云 COS 信息！');
		} else {
			void this.initUploader({ silent: true });
		}
	}

	override onunload(): void {
		for (const timer of this.pendingAutoUploads.values()) {
			window.clearTimeout(timer);
		}
		this.pendingAutoUploads.clear();
		new Notice('你的图床插件已卸载!');
	}

	async loadSettings(): Promise<void> {
		const saved = (await this.loadData()) as Partial<TencentCosSettings> | null;
		this.settings = { ...DEFAULT_SETTINGS, ...saved };
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/** （重新）创建上传器并测试连接；配置不完整时跳过。`options.silent = true` 时不弹失败通知（用于启动阶段） */
	async initUploader(options?: { silent?: boolean }): Promise<void> {
		if (!this.isConfigured()) return;
		const silent = options?.silent ?? false;

		try {
			this.uploader = new TencentCosUploader(this.settings);
			if (await this.uploader.testConnection()) {
				if (this.awaitingFirstSetup) {
					new Notice('腾讯云 COS 配置已完成！');
					this.awaitingFirstSetup = false;
				}
			} else if (!silent) {
				new Notice('COS连接测试失败，请检查配置');
			}
		} catch (error) {
			console.error('COSUploader初始化失败:', error);
			if (!silent) {
				new Notice(`插件初始化失败：${getErrorMessage(error)}`);
			}
		}
	}

	private isConfigured(): boolean {
		const { secretId, secretKey, bucket, region } = this.settings;
		return Boolean(secretId && secretKey && bucket && region);
	}

	private requireUploader(): TencentCosUploader {
		if (!this.uploader) throw new Error(UPLOADER_NOT_READY);
		return this.uploader;
	}

	// ---------------------------------------------------------------------
	// 事件与命令注册
	// ---------------------------------------------------------------------

	/** 阅读模式下将 alt 中的 `*宽度` 后缀应用为图片宽度 */
	private registerImagePostProcessor(): void {
		this.registerMarkdownPostProcessor((element) => {
			element.querySelectorAll('img').forEach((img) => {
				const match = /\*(\d+)$/.exec(img.getAttribute('alt') ?? '');
				if (!match?.[1]) return;
				const width = Number.parseInt(match[1], 10);
				if (width >= 50) {
					img.setCssStyles({ width: `${width}px`, height: 'auto' });
				}
			});
		});
	}

	private registerEditorEvents(): void {
		const { workspace } = this.app;

		this.registerEvent(
			workspace.on('editor-drop', (event, editor, info) => {
				if (event.defaultPrevented) return;
				const files = Array.from(event.dataTransfer?.files ?? []);
				if (files.length === 0 || this.settings.manualUploadMode) return;

				event.preventDefault();
				event.stopPropagation();
				void this.uploadFilesIntoEditor(files, editor, info);
			}),
		);

		this.registerEvent(
			workspace.on('editor-paste', (event, editor, info) => {
				if (event.defaultPrevented) return;
				if (this.settings.manualUploadMode) return;

				// 必须同步拷贝：异步等待之后剪贴板数据可能已失效
				const files = Array.from(
					event.clipboardData?.files ?? [],
				).filter((file) => this.isUploadableFile(file));
				if (files.length === 0) return;

				event.preventDefault();
				void this.uploadFilesIntoEditor(files, editor, info);
			}),
		);

		this.registerEvent(
			workspace.on('editor-menu', (menu, editor, info) => {
				const selection = editor.getSelection();
				if (!selection.trim()) return;

				const localLinks = extractAttachmentLinks(selection).filter(
					(link) => !link.isExternal,
				);
				if (localLinks.length === 0) return;

				menu.addItem((item) =>
					item
						.setTitle('上传附件到 COS')
						.setIcon('upload-cloud')
						.onClick(() => {
							void this.uploadSelectedLinks(
								editor,
								info,
								selection,
								localLinks,
							);
						}),
				);
			}),
		);
	}

	private registerMenuEvents(): void {
		this.registerEvent(
			this.app.workspace.on('file-menu', (menu, file) => {
				if (!(file instanceof TFile) || file.extension !== 'md') return;

				menu.addItem((item) =>
					item
						.setTitle('本地附件转存 COS')
						.setIcon('upload-cloud')
						.onClick(() => {
							void this.syncNoteFromMenu(file);
						}),
				);
				menu.addItem((item) =>
					item
						.setTitle('刷新图片有效期')
						.setIcon('refresh-cw')
						.onClick(() => {
							void this.refreshNoteImageExpiry(file);
						}),
				);
			}),
		);
	}

	private registerCommands(): void {
		this.addCommand({
			id: 'sync-all-vault-attachments-to-cos',
			name: '批量同步库内附件到 COS',
			callback: async () => {
				if (!this.uploader) {
					new Notice('请先配置 COS 设置');
					return;
				}
				const confirmed = await confirmOperation(
					this.app,
					'批量同步附件',
					'将扫描库内全部 Markdown 笔记，把本地图片和允许的附件上传到 COS，并替换链接。不会删除本地文件。',
				);
				if (confirmed) await this.syncAllVaultAttachments();
			},
		});

		this.addCommand({
			id: 'download-all-cos-attachments-to-vault',
			name: '批量下载 COS 附件到本地',
			callback: async () => {
				if (!this.uploader) {
					new Notice('请先配置 COS 设置');
					return;
				}
				const confirmed = await confirmOperation(
					this.app,
					'批量下载 COS 附件',
					'将扫描库内全部 Markdown 笔记，只下载当前 COS 配置生成的链接，保存到 Obsidian 的附件目录并替换链接。不会删除 COS 中的文件。',
				);
				if (confirmed) await this.downloadAllCosAttachments();
			},
		});
	}

	// ---------------------------------------------------------------------
	// 编辑器 / 菜单动作
	// ---------------------------------------------------------------------

	/** 依次上传拖拽 / 粘贴的文件，并把链接插入光标处 */
	private async uploadFilesIntoEditor(
		files: File[],
		editor: Editor,
		info: EditorInfo,
	): Promise<void> {
		const uploadable = files.filter((file) => this.isUploadableFile(file));
		if (uploadable.length === 0) return;

		const note = info.file;
		if (!note) {
			new Notice('未找到当前文件');
			return;
		}
		const { uploader } = this;
		if (!uploader) {
			new Notice('COS上传器未初始化，请检查配置');
			console.error('Uploader not initialized');
			return;
		}

		const context = toNoteContext(note);
		for (const file of uploadable) {
			const isImage = file.type.startsWith('image/');
			try {
				const result = await uploader.uploadFile(file, context);
				const link = isImage
					? `![${result.displayName}](${result.url})`
					: `[${file.name}](${result.url})`;
				editor.replaceRange(link, editor.getCursor());
				new Notice(`${isImage ? '图片' : '文件'}上传成功！`);
			} catch (error) {
				new Notice('文件上传失败：' + getErrorMessage(error));
				console.error('Upload error:', error);
			}
		}
	}

	private async uploadSelectedLinks(
		editor: Editor,
		info: EditorInfo,
		selection: string,
		links: AttachmentLink[],
	): Promise<void> {
		if (!this.uploader) {
			new Notice(UPLOADER_NOT_READY);
			return;
		}
		const note = info.file;
		if (!note) {
			new Notice('未找到当前笔记');
			return;
		}

		const result = await this.uploadLocalAttachmentLinks(
			note,
			selection,
			links,
		);
		if (result.uploadedCount > 0) {
			editor.replaceSelection(result.content);
			await this.deleteLocalAttachments(result.uploadedFiles);
			new Notice(
				`成功上传 ${result.uploadedCount} 个附件到 COS${result.failedCount > 0 ? `，${result.failedCount} 个失败` : ''}`,
			);
		} else if (result.failedCount > 0) {
			new Notice(`附件上传失败，共 ${result.failedCount} 个`);
		}
	}

	private async syncNoteFromMenu(note: TFile): Promise<void> {
		if (!this.uploader) {
			new Notice(UPLOADER_NOT_READY);
			return;
		}
		try {
			await this.syncNoteAttachments(note);
		} catch (error) {
			new Notice(`上传处理失败: ${getErrorMessage(error)}`);
			console.error('Upload error:', error);
		}
	}

	/** 重新签名笔记内所有图片链接，刷新有效期 */
	private async refreshNoteImageExpiry(note: TFile): Promise<void> {
		const { uploader } = this;
		if (!uploader) {
			new Notice(UPLOADER_NOT_READY);
			return;
		}

		try {
			const content = await this.app.vault.read(note);
			const imageUrls = [...content.matchAll(/!\[.*?\]\((.*?)\)/g)].map(
				(match) => match[1] ?? '',
			);
			if (imageUrls.length === 0) {
				new Notice('未找到图片链接');
				return;
			}

			let updated = content;
			for (const url of imageUrls) {
				try {
					const { pathname } = new URL(url);
					const fileName = decodeURIComponent(
						pathname.substring(pathname.lastIndexOf('/') + 1),
					);
					const signedUrl = await uploader.refreshSignedUrl(fileName);
					updated = updated.replace(url, () => signedUrl);
					new Notice(`图片 ${fileName} 有效期已刷新`);
				} catch (error) {
					new Notice(`刷新图片 ${url} 失败: ${getErrorMessage(error)}`);
					console.error('Refresh error:', error);
				}
			}

			if (updated !== content) {
				await this.app.vault.modify(note, updated);
				new Notice('所有图片链接有效期已刷新');
			}
		} catch (error) {
			new Notice(`处理失败: ${getErrorMessage(error)}`);
			console.error('Process error:', error);
		}
	}

	// ---------------------------------------------------------------------
	// 文件判定
	// ---------------------------------------------------------------------

	private getAllowedFileExtensions(): string[] {
		return this.settings.allowedFileExtensions
			.split(',')
			.map((ext) => ext.trim().replace(/^\./, '').toLowerCase())
			.filter((ext) => ext.length > 0);
	}

	/** 是否启用且允许上传该非图片文件 */
	private isAllowedFile(file: File): boolean {
		if (!this.settings.enableFileUpload) return false;
		const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
		return this.getAllowedFileExtensions().includes(extension);
	}

	/** 图片，或已启用且在白名单内的文件 */
	private isUploadableFile(file: File): boolean {
		return file.type.startsWith('image/') || this.isAllowedFile(file);
	}

	private isUploadableAttachment(file: TFile): boolean {
		return (
			isImageExtension(file.extension) ||
			(this.settings.enableFileUpload &&
				this.getAllowedFileExtensions().includes(
					file.extension.toLowerCase(),
				))
		);
	}

	/** 将笔记中的链接路径解析为库内文件 */
	private findAttachmentFile(linkPath: string, source: TFile): TFile | null {
		const [withoutAnchor = ''] = linkPath.split('#');
		const path = safeDecodeURIComponent(withoutAnchor);

		const resolved = this.app.metadataCache.getFirstLinkpathDest(
			path,
			source.path,
		);
		if (resolved) return resolved;

		const byPath = this.app.vault.getAbstractFileByPath(path);
		if (byPath instanceof TFile) return byPath;

		if (source.parent) {
			const sibling = this.app.vault.getAbstractFileByPath(
				`${source.parent.path}/${path}`,
			);
			if (sibling instanceof TFile) return sibling;
		}

		// 仅当包含扩展名时才按文件名回退搜索，避免无扩展名词汇误匹配
		const fileName = path.split('/').pop() || path;
		if (!hasFileExtension(fileName)) return null;
		return (
			this.app.vault.getFiles().find((file) => file.name === fileName) ??
			null
		);
	}

	// ---------------------------------------------------------------------
	// 上传 / 下载核心流程
	// ---------------------------------------------------------------------

	/** 上传链接指向的本地附件，返回替换链接后的文本（不删除本地文件） */
	private async uploadLocalAttachmentLinks(
		note: TFile,
		content: string,
		links: AttachmentLink[],
	): Promise<LocalUploadPhaseResult> {
		const uploader = this.requireUploader();
		const context = toNoteContext(note);
		const uploadedByPath = new Map<string, UploadResult>();
		const uploadedFiles: TFile[] = [];

		let updated = content;
		let uploadedCount = 0;
		let failedCount = 0;

		for (const link of links) {
			if (link.isExternal) continue;

			const file = this.findAttachmentFile(link.path, note);
			// 不存在或不受支持的附件直接跳过，不计入失败，避免误报
			if (!file || !this.isUploadableAttachment(file)) continue;

			try {
				let result = uploadedByPath.get(file.path);
				if (!result) {
					const data = await this.app.vault.readBinary(file);
					const upload = new File([data], file.name.replace(/\s/g, ''), {
						type: getMimeType(file.extension),
					});
					result = await uploader.uploadFile(upload, context);
					uploadedByPath.set(file.path, result);
					uploadedFiles.push(file);
				}

				const replacement = buildRemoteAttachmentLink(link, file, result);
				updated = updated.replace(link.raw, () => replacement);
				uploadedCount++;
			} catch (error) {
				console.error(`上传附件失败: ${link.path}`, error);
				failedCount++;
			}
		}

		return { content: updated, uploadedCount, failedCount, uploadedFiles };
	}

	/** 把外链图片抓取后转存到 COS（跳过已是当前 COS 的链接） */
	private async uploadExternalImageLinks(
		note: TFile,
		content: string,
		links: AttachmentLink[],
	): Promise<UploadPhaseResult> {
		const uploader = this.requireUploader();
		const context = toNoteContext(note);
		const uploadedByUrl = new Map<string, UploadResult>();

		let updated = content;
		let uploadedCount = 0;
		let failedCount = 0;

		for (const link of links) {
			if (!link.isExternal || !link.isImage || uploader.isCosUrl(link.path)) {
				continue;
			}

			try {
				let result = uploadedByUrl.get(link.path);
				if (!result) {
					const response = await requestUrl({
						url: link.path,
						method: 'GET',
					});
					const contentType =
						response.headers['content-type'] || 'image/png';
					const mimeType = (contentType.split(';')[0] ?? '').trim();

					let fileName = filenameFromUrl(link.path);
					if (!hasFileExtension(fileName)) {
						fileName += extensionForMimeType(mimeType);
					}

					const upload = new File([response.arrayBuffer], fileName, {
						type: mimeType,
					});
					result = await uploader.uploadFile(upload, context);
					uploadedByUrl.set(link.path, result);
				}

				const replacement = `![${result.displayName}](${result.url})`;
				updated = updated.replace(link.raw, () => replacement);
				uploadedCount++;
			} catch (error) {
				console.error(`上传外链图片失败: ${link.path}`, error);
				failedCount++;
			}
		}

		return { content: updated, uploadedCount, failedCount };
	}

	/** 同步单篇笔记：本地附件 + 外链图片 → COS */
	private async syncNoteAttachments(
		note: TFile,
		notify = true,
	): Promise<SyncStats> {
		const original = await this.app.vault.read(note);
		const links = extractAttachmentLinks(original);

		const local = await this.uploadLocalAttachmentLinks(note, original, links);
		const external = await this.uploadExternalImageLinks(
			note,
			local.content,
			links,
		);

		const uploadedCount = local.uploadedCount + external.uploadedCount;
		const failedCount = local.failedCount + external.failedCount;

		if (uploadedCount > 0) {
			await this.app.vault.modify(note, external.content);
			// 链接已成功写回笔记后才删除本地文件
			await this.deleteLocalAttachments(local.uploadedFiles);
			if (notify) {
				new Notice(
					`成功同步 ${uploadedCount} 个附件到 COS${failedCount > 0 ? `，${failedCount} 个失败` : ''}`,
				);
			}
		} else if (notify) {
			new Notice(
				failedCount > 0
					? `未能同步附件，${failedCount} 个链接失败或不受支持`
					: '未找到可同步的本地附件或外链图片',
			);
		}

		return { uploadedCount, failedCount };
	}

	private async syncAllVaultAttachments(): Promise<void> {
		const notes = this.app.vault
			.getMarkdownFiles()
			.filter((note) => !note.name.endsWith(BACKUP_FILE_SUFFIX));

		let uploaded = 0;
		let failedLinks = 0;
		let failedNotes = 0;

		new Notice(`开始批量同步 ${notes.length} 篇笔记中的附件…`);
		for (const note of notes) {
			try {
				const stats = await this.syncNoteAttachments(note, false);
				uploaded += stats.uploadedCount;
				failedLinks += stats.failedCount;
			} catch (error) {
				console.error(`批量同步笔记失败: ${note.path}`, error);
				failedNotes++;
			}
		}

		new Notice(
			`批量附件同步完成：上传 ${uploaded} 个${failedLinks > 0 ? `，${failedLinks} 个链接失败` : ''}${failedNotes > 0 ? `，${failedNotes} 篇笔记处理失败` : ''}`,
		);
	}

	private async downloadAllCosAttachments(): Promise<void> {
		const notes = this.app.vault.getMarkdownFiles();

		let downloaded = 0;
		let failedFiles = 0;
		let failedNotes = 0;

		new Notice(`开始从 COS 下载 ${notes.length} 篇笔记中的附件…`);
		for (const note of notes) {
			try {
				const stats = await this.downloadCosAttachmentsInNote(note);
				downloaded += stats.downloadedCount;
				failedFiles += stats.failedCount;
			} catch (error) {
				console.error(`批量下载笔记附件失败: ${note.path}`, error);
				failedNotes++;
			}
		}

		new Notice(
			`批量下载完成：下载 ${downloaded} 个附件${failedFiles > 0 ? `，${failedFiles} 个失败` : ''}${failedNotes > 0 ? `，${failedNotes} 篇笔记处理失败` : ''}`,
		);
	}

	private async downloadCosAttachmentsInNote(
		note: TFile,
	): Promise<{ downloadedCount: number; failedCount: number }> {
		const { uploader } = this;
		if (!uploader) throw new Error('COS 上传器未初始化');

		const original = await this.app.vault.read(note);
		const cosLinks = extractAttachmentLinks(original).filter(
			(link) => link.isExternal && uploader.isCosUrl(link.path),
		);
		const savedByUrl = new Map<string, TFile>();

		let updated = original;
		let downloadedCount = 0;
		let failedCount = 0;

		for (const link of cosLinks) {
			try {
				let saved = savedByUrl.get(link.path);
				if (!saved) {
					const key = uploader.getObjectKeyFromUrl(link.path);
					if (!key) throw new Error('无法解析 COS 对象路径');

					const data = await uploader.downloadObject(key);
					const localPath =
						await this.app.fileManager.getAvailablePathForAttachment(
							sanitizeFileName(filenameFromUrl(link.path)),
							note.path,
						);
					saved = await this.app.vault.createBinary(localPath, data);
					savedByUrl.set(link.path, saved);
				}

				const linktext = this.app.metadataCache.fileToLinktext(
					saved,
					note.path,
				);
				const replacement = buildLocalAttachmentLink(link, saved, linktext);
				updated = updated.replace(link.raw, () => replacement);
				downloadedCount++;
			} catch (error) {
				console.error(`下载 COS 附件失败: ${link.path}`, error);
				failedCount++;
			}
		}

		if (updated !== original) await this.app.vault.modify(note, updated);
		return { downloadedCount, failedCount };
	}

	// ---------------------------------------------------------------------
	// 本地附件清理 / 新附件自动上传
	// ---------------------------------------------------------------------

	private async deleteLocalAttachments(files: TFile[]): Promise<void> {
		if (!this.settings.deleteLocalAfterUpload) return;
		for (const file of files) {
			await this.safelyDeleteLocalAttachment(file);
		}
	}

	private async safelyDeleteLocalAttachment(file: TFile): Promise<void> {
		// 双重防呆：绝不删除 Markdown 笔记
		if (file.extension === 'md') {
			console.warn('安全保护拦截：禁止删除 Markdown 文件:', file.path);
			return;
		}
		try {
			// 遵循用户在 Obsidian 中设置的删除偏好（系统废纸篓 / 库内 .trash / 永久删除）
			await this.app.fileManager.trashFile(file);
		} catch (error) {
			console.error(`删除本地附件失败: ${file.path}`, error);
		}
	}

	/**
	 * 新附件出现后延迟检查：Obsidian 先创建文件、稍后才写入笔记链接，
	 * 因此最多重试几次等待链接出现，再自动上传。
	 */
	private scheduleAutoUpload(file: TFile, attempt = 0): void {
		if (
			this.settings.manualUploadMode ||
			!this.uploader ||
			!this.isUploadableAttachment(file)
		) {
			return;
		}

		const existing = this.pendingAutoUploads.get(file.path);
		if (existing !== undefined) window.clearTimeout(existing);

		const timer = window.setTimeout(() => {
			void this.runAutoUpload(file, attempt);
		}, AUTO_UPLOAD_DELAY_MS);
		this.pendingAutoUploads.set(file.path, timer);
	}

	private async runAutoUpload(file: TFile, attempt: number): Promise<void> {
		this.pendingAutoUploads.delete(file.path);

		const note = this.app.workspace.getActiveFile();
		if (!note || note.extension !== 'md') return;

		try {
			const content = await this.app.vault.read(note);
			const link = extractAttachmentLinks(content).find(
				(candidate) =>
					!candidate.isExternal &&
					this.findAttachmentFile(candidate.path, note)?.path ===
						file.path,
			);

			if (link) {
				const result = await this.uploadLocalAttachmentLinks(
					note,
					content,
					[link],
				);
				if (result.uploadedCount > 0) {
					await this.app.vault.modify(note, result.content);
					await this.deleteLocalAttachments(result.uploadedFiles);
					new Notice(`已自动上传附件：${file.name}`);
				}
				return;
			}
		} catch (error) {
			console.error(`自动上传附件失败: ${file.path}`, error);
			return;
		}

		if (attempt < AUTO_UPLOAD_MAX_RETRIES) {
			this.scheduleAutoUpload(file, attempt + 1);
		}
	}
}
