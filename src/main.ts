import COS from 'cos-js-sdk-v5';
import {
	Platform,
	Notice,
	Setting,
	ButtonComponent,
	TFile,
	requestUrl,
	Modal,
	MarkdownView,
	Plugin,
	PluginSettingTab,
} from 'obsidian';

// 官方社区审核规范：生产环境避免向控制台频繁打印非必要的调试日志
const log = (..._args: any[]) => {};
const DEFAULT_SETTINGS = {
	secretId: '',
	secretKey: '',
	bucket: '',
	region: '',
	prefix: '',
	expiration: 12 * 30 * 24 * 60 * 60,
	publicRead: false,
	enableCustomNaming: false,
	enableFileUpload: false,
	allowedFileExtensions:
		'pdf,mp3,mp4,wav,doc,docx,xls,xlsx,ppt,pptx,zip,mov,webm',
	customDomain: '',
	manualUploadMode: false,
	namingPattern: '{notename}-{timestamp}-{counter}',
	deleteLocalAfterUpload: false,
};

class ImgurPlugin extends Plugin {
	settings: any;
	uploader: any;
	pendingAutoUploads: Map<string, any> = new Map();

	async onload() {
		(log('=== ImgurPlugin 开始加载 ==='),
			await this.loadSettings());
		let n =
			!this.settings.secretId ||
			!this.settings.secretKey ||
			!this.settings.bucket ||
			!this.settings.region;
		log('插件设置状态:', {
			hasSecretId: !!this.settings.secretId,
			hasSecretKey: !!this.settings.secretKey,
			hasBucket: !!this.settings.bucket,
			hasRegion: !!this.settings.region,
			isFirstInit: n,
		});
		let g = async () => {
			if (
				(log('初始化COS上传器，配置检查:', {
					hasSecretId: !!this.settings.secretId,
					hasSecretKey: !!this.settings.secretKey,
					hasBucket: !!this.settings.bucket,
					hasRegion: !!this.settings.region,
					bucket: this.settings.bucket,
					region: this.settings.region,
				}),
				this.settings.secretId &&
					this.settings.secretKey &&
					this.settings.bucket &&
					this.settings.region)
			)
				try {
					(log('开始创建COSUploader实例...'),
						(this.uploader = new TencentCosUploader(this.settings)),
						log('COSUploader实例创建成功'),
						log('开始测试COS连接...'),
						(await this.uploader.testConnection())
							? (log('COS连接测试通过'),
								n &&
									(new Notice('腾讯云 COS 配置已完成！'),
									(n = false)))
							: (log('COS连接测试失败'),
								new Notice('COS连接测试失败，请检查配置')));
				} catch (i: any) {
					(console.error('COSUploader初始化失败:', i),
						new Notice(`插件初始化失败：${i.message}`),
						console.error('Plugin initialization error:', i));
				}
			else log('COS配置不完整，跳过初始化');
		};
		(!this.settings.secretId ||
		!this.settings.secretKey ||
		!this.settings.bucket ||
		!this.settings.region
			? new Notice('请先在设置中配置腾讯云 COS 信息！')
			: await g(),
			Platform.isDesktop && this.registerImageResizer(),
			this.registerMarkdownPostProcessor((i) => {
				i.querySelectorAll('img').forEach((t) => {
					let k = (t.getAttribute('alt') || '').match(/\*(\d+)$/);
					if (!k) return;
					let l = Number.parseInt(k[1], 10);
					if (l >= 50) {
						t.setCssStyles({
							width: `${l}px`,
							height: 'auto',
						});
					}
				});
			}),
			this.registerEvent(
				this.app.vault.on('create', (i) => {
					i instanceof TFile &&
						this.scheduleAutoUploadForNewAttachment(i);
				}),
			),
			this.registerEvent(
				this.app.workspace.on('editor-drop', async (i, t, k) => {
					if (i.defaultPrevented) return;
					let w: any;
					log('检测到拖拽事件');
					let l = (w = i.dataTransfer) == null ? void 0 : w.files;
					if (
						(log(
							'拖拽的文件数量:',
							(l == null ? void 0 : l.length) || 0,
						),
						!l || l.length === 0)
					) {
						log('没有检测到文件，退出处理');
						return;
					}
					if (this.settings.manualUploadMode) {
						log('手动上传模式：交由 Obsidian 插入本地附件');
						return;
					}
					(i.preventDefault(), i.stopPropagation());
					for (let u = 0; u < l.length; u++) {
						let f = l[u];
						log(
							'处理拖拽文件:',
							f.name,
							'类型:',
							f.type,
							'大小:',
							f.size,
						);
						let h = f.type.startsWith('image/'),
							d = this.isAllowedFile(f);
						if (!h && !d) {
							log('跳过不支持的文件:', f.name);
							continue;
						}
						try {
							let x = k.file;
							if (!x) {
								new Notice('未找到当前文件');
								continue;
							}
							if (!this.uploader) {
								(new Notice('COS上传器未初始化，请检查配置'),
									console.error('Uploader not initialized'));
								continue;
							}
							log('开始处理拖拽的文件:', f.name);
							let A = {
									noteName: x.basename || '未命名',
									notePath: x.path,
								},
								b = await this.uploader.uploadFile(
									f,
									void 0,
									A,
								);
							log('拖拽文件上传完成，获得URL:', b.url);
							let M = t.getCursor();
							if (h)
								t.replaceRange(
									`![${b.displayName}](${b.url})`,
									M,
								);
							else {
								let E = f.name;
								t.replaceRange(`[${E}](${b.url})`, M);
							}
							(log('已插入文件链接到编辑器'),
								new Notice(`${h ? '图片' : '文件'}上传成功！`));
						} catch (x: any) {
							(new Notice('文件上传失败：' + x.message),
								console.error('Upload error:', x));
						}
					}
				}),
			),
			this.registerEvent(
				this.app.workspace.on('editor-paste', async (i, t, k) => {
					if (i.defaultPrevented) return;
					let w: any;
					log('检测到粘贴事件');
					let l = (w = i.clipboardData) == null ? void 0 : w.files;
					if (
						(log(
							'粘贴的文件数量:',
							(l == null ? void 0 : l.length) || 0,
						),
						!l || l.length === 0)
					) {
						log('没有检测到文件，退出处理');
						return;
					}
					if (this.settings.manualUploadMode) {
						log('手动上传模式：交由 Obsidian 插入本地附件');
						return;
					}
					for (let u = 0; u < l.length; u++) {
						let f = l[u];
						log(
							'处理粘贴文件:',
							f.name,
							'类型:',
							f.type,
							'大小:',
							f.size,
						);
						let h = f.type.startsWith('image/'),
							d = this.isAllowedFile(f);
						if (!h && !d) {
							log('跳过不支持的文件:', f.name);
							continue;
						}
						i.preventDefault();
						try {
							let x = k.file;
							if (!x) {
								new Notice('未找到当前文件');
								continue;
							}
							if (!this.uploader) {
								(new Notice('COS上传器未初始化，请检查配置'),
									console.error('Uploader not initialized'));
								continue;
							}
							log('开始处理粘贴的文件:', f.name);
							let A = {
									noteName: x.basename || '未命名',
									notePath: x.path,
								},
								b = await this.uploader.uploadFile(
									f,
									void 0,
									A,
								);
							log('粘贴文件上传完成，获得URL:', b.url);
							let M = t.getCursor();
							if (h)
								t.replaceRange(
									`![${b.displayName}](${b.url})`,
									M,
								);
							else {
								let E = f.name;
								t.replaceRange(`[${E}](${b.url})`, M);
							}
							(log('已插入文件链接到编辑器'),
								new Notice(`${h ? '图片' : '文件'}上传成功！`));
						} catch (x: any) {
							(new Notice('文件上传失败：' + x.message),
								console.error('Upload error:', x));
						}
					}
				}),
			),
			this.registerEvent(
				this.app.workspace.on('file-menu', (i, t) => {
					(t as any).extension === 'md' &&
						(i.addItem((k) => {
							k.setTitle('本地附件转存 COS')
								.setIcon('upload-cloud')
								.onClick(async () => {
									if (!this.uploader) {
										new Notice(
											'COS 上传器未初始化，请检查配置',
										);
										return;
									}
									try {
										await this.syncNoteAttachments(t);
									} catch (err: any) {
										new Notice(
											`上传处理失败: ${err.message}`,
										);
										console.error('Upload error:', err);
									}
								});
						}),
						i.addItem((k) => {
							k.setTitle('刷新图片有效期')
								.setIcon('refresh-cw')
								.onClick(async () => {
									try {
										let l = await this.app.vault.read(
												t as any,
											),
											w = /!\[.*?\]\((.*?)\)/g,
											u = [...l.matchAll(w)];
										if (u.length === 0) {
											new Notice('未找到图片链接');
											return;
										}
										let f = l;
										for (let h of u) {
											let d = h[1];
											try {
												let x = new URL(d).pathname,
													A = decodeURIComponent(
														x.substring(
															x.lastIndexOf('/') +
																1,
														),
													),
													b =
														await this.uploader.refreshSignedUrl(
															A,
														);
												((f = f.replace(d, b)),
													new Notice(
														`图片 ${A} 有效期已刷新`,
													));
											} catch (x: any) {
												(new Notice(
													`刷新图片 ${d} 失败: ${x.message}`,
												),
													console.error(
														'Refresh error:',
														x,
													));
											}
										}
										f !== l &&
											(await this.app.vault.modify(
												t as any,
												f,
											),
											new Notice(
												'所有图片链接有效期已刷新',
											));
									} catch (l: any) {
										(new Notice(`处理失败: ${l.message}`),
											console.error('Process error:', l));
									}
								});
						}));
				}),
			),
			this.registerEvent(
				this.app.workspace.on('editor-menu', (i, t, k) => {
					let l = t.getSelection(),
						w = this.extractAttachmentLinks(l).filter(
							(u) => !u.isExternal,
						);
					!l.trim() ||
						w.length === 0 ||
						i.addItem((u) => {
							u.setTitle('上传附件到 COS')
								.setIcon('upload-cloud')
								.onClick(async () => {
									if (!this.uploader) {
										new Notice(
											'COS 上传器未初始化，请检查配置',
										);
										return;
									}
									let f = k.file;
									if (!f) {
										new Notice('未找到当前笔记');
										return;
									}
									let h =
										await this.uploadLocalAttachmentLinks(
											f,
											l,
											w,
										);
									h.uploadedCount > 0
										? (t.replaceSelection(h.content),
											new Notice(
												`成功上传 ${h.uploadedCount} 个附件到 COS${h.failedCount > 0 ? `，${h.failedCount} 个失败` : ''}`,
											))
										: h.failedCount > 0 &&
											new Notice(
												`附件上传失败，共 ${h.failedCount} 个`,
											);
								});
						});
				}),
			),
			this.addCommand({
				id: 'sync-all-vault-attachments-to-cos',
				name: '批量同步库内附件到 COS',
				callback: async () => {
					if (!this.uploader) {
						new Notice('请先配置 COS 设置');
						return;
					}
					(await this.showOperationConfirm(
						'批量同步附件',
						'将扫描库内全部 Markdown 笔记，把本地图片和允许的附件上传到 COS，并替换链接。不会删除本地文件。',
					)) && (await this.syncAllVaultAttachments());
				},
			}),
			this.addCommand({
				id: 'download-all-cos-attachments-to-vault',
				name: '批量下载 COS 附件到本地',
				callback: async () => {
					if (!this.uploader) {
						new Notice('请先配置 COS 设置');
						return;
					}
					(await this.showOperationConfirm(
						'批量下载 COS 附件',
						'将扫描库内全部 Markdown 笔记，只下载当前 COS 配置生成的链接，保存到 Obsidian 的附件目录并替换链接。不会删除 COS 中的文件。',
					)) && (await this.downloadAllCosAttachments());
				},
			}),
			this.addSettingTab(new TencentCosSettingTab(this.app, this, g)),
			log('=== ImgurPlugin 加载完成 ==='));
	}
	onunload() {
		this.uploader && this.uploader.cleanup();
		for (let n of this.pendingAutoUploads.values()) window.clearTimeout(n);
		(this.pendingAutoUploads.clear(), new Notice('你的图床插件已卸载!'));
	}
	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData(),
		);
	}
	async saveSettings() {
		await this.saveData(this.settings);
	}
	isAllowedFile(n) {
		var i;
		if (!this.settings.enableFileUpload) return false;
		let g =
			((i = n.name.split('.').pop()) == null
				? void 0
				: i.toLowerCase()) || '';
		return this.getAllowedFileExtensions().includes(g);
	}
	getAllowedFileExtensions() {
		return this.settings.allowedFileExtensions
			.split(',')
			.map((n) => n.trim().replace(/^\./, '').toLowerCase())
			.filter((n) => n.length > 0);
	}
	isImageAttachment(n) {
		return [
			'png',
			'jpg',
			'jpeg',
			'gif',
			'svg',
			'webp',
			'bmp',
			'avif',
			'tif',
			'tiff',
		].includes(n.extension.toLowerCase());
	}
	isUploadableAttachment(n) {
		return (
			this.isImageAttachment(n) ||
			(this.settings.enableFileUpload &&
				this.getAllowedFileExtensions().includes(
					n.extension.toLowerCase(),
				))
		);
	}
	extractAttachmentLinks(n) {
		let g = [],
			i = /(!?)\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g,
			t;
		for (; (t = i.exec(n)) !== null; ) {
			let l = t[2].trim();
			// 过滤空值；对于非外链，如果既没有路径分隔符也没有文件后缀名，通常不是有效附件路径（例如内部笔记名或Emoji）
			if (
				!l ||
				(!this.isHttpUrl(l) &&
					!l.includes('/') &&
					!/\.[a-zA-Z0-9]{1,10}$/.test(l))
			) {
				continue;
			}
			g.push({
				raw: t[0],
				path: l,
				alt: (t[3] || '').trim(),
				isImage: t[1] === '!',
				isExternal: this.isHttpUrl(l),
			});
		}
		let k =
			/(!?)\[([^\]]*)\]\((?:<([^>]+)>|([^\s)]+))(?:\s+(?:"[^"]*"|'[^']*'))?\)/g;
		for (; (t = k.exec(n)) !== null; ) {
			let l = (t[3] || t[4] || '').trim();
			// 过滤空值以及非 URL 且无文件特征（无路径分隔符且无扩展名）的内容（例如 Emoji 或纯文本锚点）
			if (
				!l ||
				(!this.isHttpUrl(l) &&
					!l.includes('/') &&
					!/\.[a-zA-Z0-9]{1,10}$/.test(l))
			) {
				continue;
			}
			g.push({
				raw: t[0],
				path: l,
				alt: t[2].trim(),
				isImage: t[1] === '!',
				isExternal: this.isHttpUrl(l),
			});
		}
		return g;
	}
	isHttpUrl(n) {
		return /^https?:\/\//i.test(n);
	}
	findAttachmentFile(n, g) {
		let i = n.split('#')[0],
			t = i;
		try {
			t = decodeURIComponent(i);
		} catch (u: any) {}
		let k = this.app.metadataCache.getFirstLinkpathDest(t, g.path);
		if (k instanceof TFile) return k;
		let l = this.app.vault.getAbstractFileByPath(t);
		if (
			l instanceof TFile ||
			(g.parent &&
				((l = this.app.vault.getAbstractFileByPath(
					`${g.parent.path}/${t}`,
				)),
				l instanceof TFile))
		)
			return l;
		let w = t.split('/').pop() || t;
		// 仅当包含文件扩展名时才进行回退搜索，避免无扩展名普通词汇误匹配
		if (!/\.[a-zA-Z0-9]{1,10}$/.test(w)) return null;
		return this.app.vault.getFiles().find((u) => u.name === w) || null;
	}
	getMimeType(n) {
		return (
			{
				pdf: 'application/pdf',
				mp3: 'audio/mpeg',
				mp4: 'video/mp4',
				wav: 'audio/wav',
				doc: 'application/msword',
				docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
				xls: 'application/vnd.ms-excel',
				xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
				ppt: 'application/vnd.ms-powerpoint',
				pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
				zip: 'application/zip',
				mov: 'video/quicktime',
				webm: 'video/webm',
				png: 'image/png',
				jpg: 'image/jpeg',
				jpeg: 'image/jpeg',
				gif: 'image/gif',
				svg: 'image/svg+xml',
				webp: 'image/webp',
				bmp: 'image/bmp',
				avif: 'image/avif',
			}[n.toLowerCase()] || 'application/octet-stream'
		);
	}
	buildRemoteAttachmentLink(n, g, i) {
		var w, u;
		if (!this.isImageAttachment(g)) return `[${n.alt || g.name}](${i.url})`;
		let t = (w = n.raw.match(/\|(\d+)\]\]$/)) == null ? void 0 : w[1],
			k = (u = n.alt.match(/\*(\d+)$/)) == null ? void 0 : u[1],
			l = t || k ? `*${t || k}` : '';
		return `![${i.displayName}${l}](${i.url})`;
	}
	async safelyDeleteLocalAttachment(file: any) {
		try {
			if (!(file instanceof TFile)) return;
			// 仅在明确开启“上传后删除本地文件”时执行
			if (!this.settings.deleteLocalAfterUpload) return;
			// 双重防呆确认：绝不删除 markdown 笔记
			if (file.extension === 'md') {
				console.warn(
					'安全保护拦截：禁止删除 Markdown 文件:',
					file.path,
				);
				return;
			}
			// 优先遵循用户的废纸篓偏好，如果环境不支持则优雅回退
			const fm = this.app.fileManager as any;
			if (typeof fm.trashFile === 'function') {
				await fm.trashFile(file);
			} else {
				await this.app.vault.trash(file, false);
			}
		} catch (err: any) {
			console.error(`删除本地附件失败: ${file?.path}`, err);
		}
	}
	async uploadLocalAttachmentLinks(n, g, i) {
		if (!this.uploader) throw new Error('COS 上传器未初始化，请检查配置');
		let t = g,
			k = 0,
			l = 0,
			w = new Map(),
			u = { noteName: n.basename || '未命名', notePath: n.path },
			successfullyUploadedFiles: any[] = [];
		for (let f of i) {
			if (f.isExternal) continue;
			let h = this.findAttachmentFile(f.path, n);
			if (!h || !this.isUploadableAttachment(h)) {
				// 仅在控制台提示跳过，不计入上传失败错误计数，避免用户看到误报
				log(`跳过不支持或不存在的本地附件: ${f.path}`);
				continue;
			}
			try {
				let d = w.get(h.path);
				if (!d) {
					let A = await this.app.vault.readBinary(h),
						b = new File(
							[new Blob([A])],
							h.name.replace(/\s/g, ''),
							{
								type: this.getMimeType(h.extension),
							},
						);
					((d = await this.uploader.uploadFile(b, void 0, u)),
						w.set(h.path, d));
					if (d && d.url) {
						successfullyUploadedFiles.push(h);
					}
				}
				let x = this.buildRemoteAttachmentLink(f, h, d);
				((t = t.replace(f.raw, () => x)), k++);
			} catch (d: any) {
				(console.error(`上传附件失败: ${f.path}`, d), l++);
			}
		}
		// 如果开启了删除本地附件选项，且有成功上传的本地附件，在确保链接替换成功后安全删除本地文件
		if (
			this.settings.deleteLocalAfterUpload &&
			successfullyUploadedFiles.length > 0
		) {
			for (let localFile of successfullyUploadedFiles) {
				await this.safelyDeleteLocalAttachment(localFile);
			}
		}
		return {
			content: t,
			uploadedCount: k,
			failedCount: l,
			deletedFilesCount: successfullyUploadedFiles.length,
		};
	}
	async uploadExternalImageLinks(n, g, i) {
		if (!this.uploader) throw new Error('COS 上传器未初始化，请检查配置');
		let t = g,
			k = 0,
			l = 0,
			w = new Map(),
			u = { noteName: n.basename || '未命名', notePath: n.path };
		for (let f of i)
			if (!(!f.isExternal || !f.isImage || this.isCurrentCosUrl(f.path)))
				try {
					let h = w.get(f.path);
					if (!h) {
						let d = await requestUrl({
								url: f.path,
								method: 'GET',
							}),
							x = (d.headers['content-type'] || 'image/png')
								.split(';')[0]
								.trim(),
							A = this.filenameFromUrl(f.path);
						/\.[a-z0-9]{1,10}$/i.test(A) ||
							(A += this.extensionForMimeType(x));
						let b = new File(
							[new Blob([d.arrayBuffer], { type: x })],
							A,
							{
								type: x,
							},
						);
						((h = await this.uploader.uploadFile(b, void 0, u)),
							w.set(f.path, h));
					}
					((t = t.replace(
						f.raw,
						() =>
							`![${h == null ? void 0 : h.displayName}](${h == null ? void 0 : h.url})`,
					)),
						k++);
				} catch (h: any) {
					(console.error(`上传外链图片失败: ${f.path}`, h), l++);
				}
		return { content: t, uploadedCount: k, failedCount: l };
	}
	async syncNoteAttachments(n, g = true) {
		let i = await this.app.vault.read(n),
			t = this.extractAttachmentLinks(i),
			k = await this.uploadLocalAttachmentLinks(n, i, t),
			l = await this.uploadExternalImageLinks(n, k.content, t),
			w = k.uploadedCount + l.uploadedCount,
			u = k.failedCount + l.failedCount;
		return (
			w > 0
				? (await this.app.vault.modify(n, l.content),
					g &&
						new Notice(
							`成功同步 ${w} 个附件到 COS${u > 0 ? `，${u} 个失败` : ''}`,
						))
				: g && u > 0
					? new Notice(`未能同步附件，${u} 个链接失败或不受支持`)
					: g && new Notice('未找到可同步的本地附件或外链图片'),
			{ uploadedCount: w, failedCount: u }
		);
	}
	async showOperationConfirm(n, g) {
		return new Promise((i) => {
			new ConfirmModal(this.app, n, g, i).open();
		});
	}
	async syncAllVaultAttachments() {
		let n = this.app.vault
				.getMarkdownFiles()
				.filter((k) => !k.name.endsWith('-backup.md')),
			g = 0,
			i = 0,
			t = 0;
		new Notice(`开始批量同步 ${n.length} 篇笔记中的附件…`);
		for (let k of n)
			try {
				let l = await this.syncNoteAttachments(k, false);
				((g += l.uploadedCount), (i += l.failedCount));
			} catch (l: any) {
				(console.error(`批量同步笔记失败: ${k.path}`, l), t++);
			}
		new Notice(
			`批量附件同步完成：上传 ${g} 个${i > 0 ? `，${i} 个链接失败` : ''}${t > 0 ? `，${t} 篇笔记处理失败` : ''}`,
		);
	}
	async downloadAllCosAttachments() {
		let n = this.app.vault.getMarkdownFiles(),
			g = 0,
			i = 0,
			t = 0;
		new Notice(`开始从 COS 下载 ${n.length} 篇笔记中的附件…`);
		for (let k of n)
			try {
				let l = await this.downloadCosAttachmentsInNote(k);
				((g += l.downloadedCount), (i += l.failedCount));
			} catch (l: any) {
				(console.error(`批量下载笔记附件失败: ${k.path}`, l), t++);
			}
		new Notice(
			`批量下载完成：下载 ${g} 个附件${i > 0 ? `，${i} 个失败` : ''}${t > 0 ? `，${t} 篇笔记处理失败` : ''}`,
		);
	}
	async downloadCosAttachmentsInNote(n) {
		if (!this.uploader) throw new Error('COS 上传器未初始化');
		let g = await this.app.vault.read(n),
			i = this.extractAttachmentLinks(g).filter(
				(u) => u.isExternal && this.isCurrentCosUrl(u.path),
			),
			t = g,
			k = 0,
			l = 0,
			w = new Map();
		for (let u of i)
			try {
				let f = w.get(u.path);
				if (!f) {
					let d = this.getCosObjectKeyFromUrl(u.path);
					if (!d) throw new Error('无法解析 COS 对象路径');
					let x = await this.uploader.downloadObject(d),
						A = this.sanitizeBackupFileName(
							this.filenameFromUrl(u.path),
						),
						b =
							await this.app.fileManager.getAvailablePathForAttachment(
								A,
								n.path,
							);
					((f = await this.app.vault.createBinary(b, x)),
						w.set(u.path, f));
				}
				let h = this.buildLocalAttachmentLink(u, f, n);
				((t = t.replace(u.raw, () => h)), k++);
			} catch (f: any) {
				(console.error(`下载 COS 附件失败: ${u.path}`, f), l++);
			}
		return (
			t !== g && (await this.app.vault.modify(n, t)),
			{ downloadedCount: k, failedCount: l }
		);
	}
	buildLocalAttachmentLink(n, g, i) {
		var l, w;
		let t = this.app.metadataCache.fileToLinktext(g, i.path);
		if (!this.isImageAttachment(g)) return `[${n.alt || g.name}](${t})`;
		let k =
			((l = n.raw.match(/\|(\d+)\]\]$/)) == null ? void 0 : l[1]) ||
			((w = n.alt.match(/\*(\d+)$/)) == null ? void 0 : w[1]);
		return `![[${t}${k ? `|${k}` : ''}]]`;
	}
	isCurrentCosUrl(n) {
		try {
			let g = new URL(n),
				i = `${this.settings.bucket}.cos.${this.settings.region}.myqcloud.com`,
				t = this.settings.customDomain.trim(),
				k = t
					? new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`)
							.hostname
					: '';
			return [i, k]
				.filter(Boolean)
				.some((l) => l.toLowerCase() === g.hostname.toLowerCase());
		} catch (g: any) {
			return false;
		}
	}
	getCosObjectKeyFromUrl(n) {
		try {
			let g = decodeURIComponent(new URL(n).pathname).replace(/^\/+/, '');
			return !g || g.split('/').some((i) => i === '..') ? null : g;
		} catch (g: any) {
			return null;
		}
	}
	scheduleAutoUploadForNewAttachment(n) {
		if (
			this.settings.manualUploadMode ||
			!this.uploader ||
			!this.isUploadableAttachment(n)
		)
			return;
		let g = this.pendingAutoUploads.get(n.path);
		g && window.clearTimeout(g);
		let i = async (k) => {
				let l = this.app.workspace.getActiveFile();
				if (!(l instanceof TFile) || l.extension !== 'md') {
					this.pendingAutoUploads.delete(n.path);
					return;
				}
				try {
					let u = await this.app.vault.read(l),
						f = this.extractAttachmentLinks(u).find((h) => {
							var d;
							return (
								!h.isExternal &&
								((d = this.findAttachmentFile(h.path, l)) ==
								null
									? void 0
									: d.path) === n.path
							);
						});
					if (f) {
						let h = await this.uploadLocalAttachmentLinks(l, u, [
							f,
						]);
						(h.uploadedCount > 0 &&
							(await this.app.vault.modify(l, h.content),
							new Notice(`已自动上传附件：${n.name}`)),
							this.pendingAutoUploads.delete(n.path));
						return;
					}
				} catch (u: any) {
					(console.error(`自动上传附件失败: ${n.path}`, u),
						this.pendingAutoUploads.delete(n.path));
					return;
				}
				if (k >= 2) {
					this.pendingAutoUploads.delete(n.path);
					return;
				}
				let w = window.setTimeout(() => {
					i(k + 1);
				}, 500);
				this.pendingAutoUploads.set(n.path, w);
			},
			t = window.setTimeout(() => {
				i(0);
			}, 500);
		this.pendingAutoUploads.set(n.path, t);
	}
	filenameFromUrl(n) {
		try {
			return (
				decodeURIComponent(
					new URL(n).pathname.split('/').pop() || 'external-image',
				)
					.replace(/\.\./g, '.')
					.replace(/\s/g, '') || 'external-image'
			);
		} catch (g: any) {
			return 'external-image';
		}
	}
	extensionForMimeType(n) {
		return (
			{
				'image/gif': '.gif',
				'image/jpeg': '.jpg',
				'image/jpg': '.jpg',
				'image/png': '.png',
				'image/svg+xml': '.svg',
				'image/webp': '.webp',
			}[n.toLowerCase()] || '.png'
		);
	}
	errorMessage(n) {
		return n instanceof Error ? n.message : String(n);
	}
	escapeRegex(n) {
		return n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}
	sanitizeBackupFileName(n) {
		let g = n.lastIndexOf('.'),
			i = g > 0,
			t = i ? n.substring(0, g) : n,
			k = i ? n.substring(g + 1) : '',
			l = t
				.replace(/[\\/:*?"<>|]/g, '-')
				.replace(/\s+/g, '-')
				.replace(/-+/g, '-')
				.replace(/^-|-$/g, ''),
			w = k.replace(/[\\/:*?"<>|]/g, '').trim();
		return l ? (w ? `${l}.${w}` : l) : w ? `image.${w}` : 'image.png';
	}
	registerImageResizer() {
		(this.registerDomEvent(document, 'mousedown', (n) => {
			let g: any = n.target;
			if (g.tagName === 'IMG') {
				let i = g.closest('.markdown-preview-view'),
					t = g.closest('.markdown-source-view');
				(i || t) && this.handleImageResize(n, g);
			}
		}),
			this.registerEvent(
				this.app.workspace.on('active-leaf-change', () => {
					this.addImageResizeHandlers();
				}),
			),
			this.addImageResizeHandlers());
	}
	addImageResizeHandlers() {
		let n = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (n) {
			window.setTimeout(() => {
				n.containerEl.querySelectorAll('img').forEach((t) => {
					if (!t.hasAttribute('data-resize-enabled')) {
						t.setAttribute('data-resize-enabled', 'true');
						t.setCssStyles({ cursor: 'ew-resize' });
						t.addEventListener('mousedown', (k) => {
							k.preventDefault();
							this.handleImageResize(k, t);
						});
					}
				});
			}, 100);
		}
	}
	handleImageResize(n: MouseEvent, g: HTMLElement) {
		n.preventDefault();
		n.stopPropagation();
		let i = n.clientX,
			t = g.offsetWidth,
			k = false,
			l = (u: MouseEvent) => {
				if (!k && Math.abs(u.clientX - i) > 5) {
					k = true;
					g.setCssStyles({ cursor: 'ew-resize' });
					document.body.setCssStyles({ cursor: 'ew-resize' });
				}
				if (k) {
					let f = u.clientX - i,
						h = Math.max(50, t + f);
					g.setCssStyles({
						width: `${h}px`,
						height: 'auto',
					});
					this.showResizeTooltip(
						u.clientX,
						u.clientY,
						Math.round(h),
					);
				}
			},
			w = async () => {
				document.body.setCssStyles({ cursor: '' });
				this.hideResizeTooltip();
				if (k) {
					g.setCssStyles({ cursor: 'ew-resize' });
					await this.updateImageSizeInMarkdown(g as HTMLImageElement);
				}
				document.removeEventListener('mousemove', l);
				document.removeEventListener('mouseup', w);
			};
		document.addEventListener('mousemove', l);
		document.addEventListener('mouseup', w);
	}
	showResizeTooltip(n: number, g: number, i: number) {
		let t = document.getElementById('image-resize-tooltip');
		if (!t) {
			t = createDiv({
				cls: 'image-resize-tooltip',
				attr: { id: 'image-resize-tooltip' },
			});
			t.setCssStyles({
				position: 'fixed',
				background: 'var(--background-primary)',
				border: '1px solid var(--background-modifier-border)',
				borderRadius: '4px',
				padding: '4px 8px',
				fontSize: '12px',
				zIndex: '10000',
				pointerEvents: 'none',
				boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
			});
			document.body.appendChild(t);
		}
		t.textContent = `${i}px`;
		t.setCssStyles({
			left: `${n + 10}px`,
			top: `${g - 30}px`,
			display: 'block',
		});
	}
	hideResizeTooltip() {
		let n = document.getElementById('image-resize-tooltip');
		if (n) {
			n.setCssStyles({ display: 'none' });
		}
	}
	async updateImageSizeInMarkdown(n) {
		let g = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!g) return;
		let i = g.editor,
			t = i.getValue(),
			k = n.src,
			l = Math.round(n.offsetWidth);
		log('开始更新图片大小:', {
			imgSrc: k,
			newWidth: l,
		});
		let w = this.extractImageInfo(k);
		if (!w) {
			new Notice('无法识别图片信息');
			return;
		}
		log('提取的图片信息:', w);
		let u = false,
			f = /!\[([^\]]*?)\]\(([^)]+)\)/g,
			h;
		for (
			log('开始匹配 Markdown 图片语法');
			(h = f.exec(t)) !== null;
		) {
			let d = h[0],
				x = h[1],
				A = h[2],
				b = h.index;
			if (
				(log(`找到图片: ${d}`),
				log(`Alt文本: "${x}", URL: "${A}"`),
				this.isMatchingImageByUrl(A, k, w))
			) {
				log('图片匹配成功，开始更新宽度');
				let _ = `![${`${x.replace(/\*\d+$/, '').trim()}*${l}`}](${A})`;
				log(`替换: ${d} -> ${_}`);
				let j = i.offsetToPos(b),
					m = i.offsetToPos(b + d.length);
				(i.replaceRange(_, j, m),
					i.setCursor(j),
					(u = true),
					new Notice(`图片大小已调整为 ${l}px`));
				break;
			}
		}
		if (!u) {
			log('未找到 Markdown 格式匹配，尝试 Wiki 链接格式');
			let d = /!\[\[([^\]]+?)(?:\|[^\]]+)?\]\]/g;
			for (; (h = d.exec(t)) !== null; ) {
				let x = h[0],
					b = h[1].split('|')[0],
					M = h.index;
				if (
					(log(`找到 Wiki 图片: ${x}, 文件名: ${b}`),
					this.isMatchingImageByFilename(b, w))
				) {
					log('Wiki 图片匹配成功，保持 Wiki 格式添加宽度');
					let E = `![[${b}|${l}]]`;
					log(`替换: ${x} -> ${E}`);
					let _ = i.offsetToPos(M),
						j = i.offsetToPos(M + x.length);
					(i.replaceRange(E, _, j),
						i.setCursor(_),
						(u = true),
						new Notice(`图片大小已调整为 ${l}px`));
					break;
				}
			}
		}
		u ||
			(log('未找到匹配的图片引用'),
			new Notice('未能更新图片大小到 Markdown 源码'));
	}
	extractImageInfo(n) {
		var g;
		log('提取图片信息，源URL:', n);
		try {
			let i = new URL(n),
				l = {
					filename: (i.pathname.split('/').pop() || '').split('?')[0],
					domain: i.hostname,
					path: n,
				};
			return (log('URL解析结果:', l), l);
		} catch (i: any) {
			log('URL解析失败，尝试提取文件名');
			let t =
					((g = n.split('/').pop()) == null
						? void 0
						: g.split('?')[0]) || '',
				k = t ? { filename: t, domain: '', path: n } : null;
			return (log('文件名提取结果:', k), k);
		}
	}
	isMatchingImageByUrl(n, g, i) {
		var t;
		if (
			(log('URL匹配检查:', {
				markdownUrl: n,
				imgSrc: g,
			}),
			n === g)
		)
			return (log('URL直接匹配'), true);
		if (n.startsWith('http') && g.startsWith('http'))
			try {
				let k = new URL(n),
					l = new URL(g);
				if (k.hostname === l.hostname && k.pathname === l.pathname)
					return (log('URL域名和路径匹配'), true);
				let w = this.extractFilenameFromUrl(k.pathname),
					u = this.extractFilenameFromUrl(l.pathname);
				if (this.compareFilenames(w, u))
					return (log('URL文件名匹配'), true);
			} catch (k: any) {
				log('URL解析失败:', k);
			}
		if (i.filename) {
			let k = decodeURIComponent(i.filename);
			if (n.includes(i.filename))
				return (log('URL包含文件名匹配'), true);
			if (n.includes(k))
				return (log('URL包含解码后的文件名匹配'), true);
			let l =
					((t = n.split('/').pop()) == null
						? void 0
						: t.split('?')[0]) || '',
				w = decodeURIComponent(l);
			if (this.compareFilenames(w, k))
				return (log('提取的文件名匹配成功'), true);
		}
		return (log('URL匹配失败'), false);
	}
	isMatchingImageByFilename(n, g) {
		if (
			(log('文件名匹配检查:', {
				markdownFilename: n,
				imgInfoFilename: g.filename,
			}),
			!n || !g.filename)
		)
			return false;
		let i = this.compareFilenames(n, g.filename);
		return (log('文件名匹配结果:', i), i);
	}
	extractFilenameFromUrl(n) {
		try {
			let g = n.split('/').pop() || '';
			return decodeURIComponent(g);
		} catch (g: any) {
			return n.split('/').pop() || '';
		}
	}
	compareFilenames(n, g) {
		if (!n || !g) return false;
		if (
			(log('比较文件名:', {
				filename1: n,
				filename2: g,
			}),
			n === g)
		)
			return (log('直接匹配'), true);
		let i = n.replace(/\.[^.]*$/, ''),
			t = g.replace(/\.[^.]*$/, '');
		if (i === t) return (log('无扩展名匹配'), true);
		let k = i.replace(/^\d+-/, ''),
			l = t.replace(/^\d+-/, '');
		if (k === l) return (log('清理时间戳后匹配'), true);
		try {
			let w = encodeURIComponent(n),
				u = encodeURIComponent(g);
			if (w === u) return (log('编码后匹配'), true);
			let f = decodeURIComponent(n),
				h = decodeURIComponent(g);
			if (f === h) return (log('解码后匹配'), true);
			let d = f.replace(/^\d+-/, '').replace(/\.[^.]*$/, ''),
				x = h.replace(/^\d+-/, '').replace(/\.[^.]*$/, '');
			if (d === x) return (log('清理时间戳解码后匹配'), true);
		} catch (w: any) {
			log('编码解码失败');
		}
		return (log('所有比较都失败'), false);
	}
}

class TencentCosSettingTab extends PluginSettingTab {
	plugin: any;
	initUploader: any;
	constructor(app: any, plugin: any, initUploader: any) {
		super(app, plugin);
		this.plugin = plugin;
		this.initUploader = initUploader;
	}
	display() {
		let { containerEl: n } = this;
		n.empty();
		let g = this.debounce(async () => {
			await this.initUploader();
		}, 2e3);
		(new Setting(n)
			.setName('Secret Id')
			.setDesc('腾讯云 API 密钥 Secret Id')
			.addText((i) =>
				i
					.setPlaceholder('输入 Secret Id')
					.setValue(this.plugin.settings.secretId)
					.onChange(async (t) => {
						((this.plugin.settings.secretId = t.trim()),
							await this.plugin.saveSettings(),
							g());
					}),
			),
			new Setting(n)
				.setName('Secret Key')
				.setDesc('腾讯云 API 密钥 Secret Key')
				.addText((i) =>
					i
						.setPlaceholder('输入 Secret Key')
						.setValue(this.plugin.settings.secretKey)
						.onChange(async (t) => {
							((this.plugin.settings.secretKey = t.trim()),
								await this.plugin.saveSettings(),
								g());
						}),
				),
			new Setting(n)
				.setName('Bucket')
				.setDesc('COS 存储桶名称')
				.addText((i) =>
					i
						.setPlaceholder('例如：my-bucket-1250000000')
						.setValue(this.plugin.settings.bucket)
						.onChange(async (t) => {
							((this.plugin.settings.bucket = t.trim()),
								await this.plugin.saveSettings(),
								g());
						}),
				),
			new Setting(n)
				.setName('Region')
				.setDesc('存储桶所在地域')
				.addDropdown((i) => {
					i.addOption('ap-beijing-1', '北京一区（ap-beijing-1）')
						.addOption('ap-beijing', '北京（ap-beijing）')
						.addOption('ap-nanjing', '南京（ap-nanjing）')
						.addOption('ap-shanghai', '上海（ap-shanghai）')
						.addOption('ap-guangzhou', '广州（ap-guangzhou）')
						.addOption('ap-chengdu', '成都（ap-chengdu）')
						.addOption('ap-chongqing', '重庆（ap-chongqing）')
						.addOption(
							'ap-shenzhen-fsi',
							'深圳金融（ap-shenzhen-fsi）',
						)
						.addOption(
							'ap-shanghai-fsi',
							'上海金融（ap-shanghai-fsi）',
						)
						.addOption(
							'ap-beijing-fsi',
							'北京金融（ap-beijing-fsi）',
						)
						.addOption('ap-hongkong', '香港（ap-hongkong）')
						.addOption('ap-singapore', '新加坡（ap-singapore）')
						.addOption('ap-jakarta', '雅加达（ap-jakarta）')
						.addOption('ap-seoul', '首尔（ap-seoul）')
						.addOption('ap-bangkok', '曼谷（ap-bangkok）')
						.addOption('ap-tokyo', '东京（ap-tokyo）')
						.addOption('ap-mumbai', '孟买（ap-mumbai）')
						.addOption(
							'me-saudi-arabia',
							'沙特阿拉伯（me-saudi-arabia）',
						)
						.addOption(
							'na-siliconvalley',
							'硅谷（na-siliconvalley）',
						)
						.addOption('na-ashburn', '弗吉尼亚（na-ashburn）')
						.addOption('sa-saopaulo', '圣保罗（sa-saopaulo）')
						.addOption('eu-frankfurt', '法兰克福（eu-frankfurt）')
						.setValue(this.plugin.settings.region)
						.onChange(async (t) => {
							((this.plugin.settings.region = t.trim()),
								await this.plugin.saveSettings());
						});
				}),
			new Setting(n)
				.setName('自定义域名')
				.setDesc(
					'可选。生成链接时使用此域名，例如：https://img.example.com。若仅配置 HTTP，可填写 http://img.example.com；未写协议时默认 HTTPS。',
				)
				.addText((i) =>
					i
						.setPlaceholder('例如：https://img.example.com')
						.setValue(this.plugin.settings.customDomain)
						.onChange(async (t) => {
							((this.plugin.settings.customDomain = t
								.trim()
								.replace(/\/+$/, '')),
								await this.plugin.saveSettings());
						}),
				),
			new Setting(n)
				.setName('存储路径前缀')
				.setDesc('设置文件在 COS 中的存储路径前缀，例如：images')
				.addText((i) =>
					i
						.setPlaceholder('例如：images')
						.setValue(this.plugin.settings.prefix)
						.onChange(async (t) => {
							let k = t.trim();
							((k = k.replace(/^\/+|\/+$/g, '')),
								(this.plugin.settings.prefix = k),
								await this.plugin.saveSettings());
						}),
				),
			new Setting(n)
				.setName('图片有效期')
				.setDesc('设置图片链接的有效期')
				.addDropdown((i) => {
					i.addOption((1 * 30 * 24 * 60 * 60).toString(), '1个月')
						.addOption((6 * 30 * 24 * 60 * 60).toString(), '半年')
						.addOption((12 * 30 * 24 * 60 * 60).toString(), '1年')
						.addOption((36 * 30 * 24 * 60 * 60).toString(), '3年')
						.addOption((60 * 30 * 24 * 60 * 60).toString(), '5年')
						.addOption((20 * 365 * 24 * 60 * 60).toString(), '20年')
						.addOption((50 * 365 * 24 * 60 * 60).toString(), '50年')
						.addOption(
							(100 * 365 * 24 * 60 * 60).toString(),
							'永久',
						)
						.setValue(this.plugin.settings.expiration.toString())
						.onChange(async (t) => {
							let k = parseInt(t, 10);
							!isNaN(k) && k > 0
								? ((this.plugin.settings.expiration = k),
									await this.plugin.saveSettings())
								: new Notice('请选择有效的时间选项');
						});
				}),
			new Setting(n)
				.setName('公有读存储桶')
				.setDesc(
					'开启后使用干净的无签名URL（需将COS存储桶设置为公有读）。关闭则使用带签名的临时URL（更安全，但URL较长）',
				)
				.addToggle((i) => {
					i.setValue(this.plugin.settings.publicRead).onChange(
						async (t) => {
							((this.plugin.settings.publicRead = t),
								await this.plugin.saveSettings(),
								t &&
									new Notice(
										'已开启公有读模式，请确保COS存储桶已设置为公有读权限',
									));
						},
					);
				}),
			new Setting(n)
				.setName('启用规则图片命名')
				.setDesc(
					'开启后按“上传命名模板”生成文件名与子目录；关闭则继续使用原有的时间戳命名。',
				)
				.addToggle((i) => {
					i.setValue(
						this.plugin.settings.enableCustomNaming,
					).onChange(async (t) => {
						((this.plugin.settings.enableCustomNaming = t),
							await this.plugin.saveSettings(),
							t && new Notice('已开启规则图片命名'));
					});
				}),
			new Setting(n)
				.setName('上传命名模板')
				.setDesc(
					'支持子目录和变量：{year}、{month}/{mon}、{day}、{timestamp}、{notename}、{counter}、{random}、{filename}（含扩展名）、{basename}、{ext}。例如：{year}/{mon}/{day}/{filename} 或 {notename}-{counter}{ext}。',
				)
				.addText((i) =>
					i
						.setPlaceholder('{notename}-{timestamp}-{counter}')
						.setValue(this.plugin.settings.namingPattern)
						.onChange(async (t) => {
							((this.plugin.settings.namingPattern = t.trim()),
								await this.plugin.saveSettings());
						}),
				),
			new Setting(n)
				.setName('手动上传模式')
				.setDesc(
					'开启后，拖拽和粘贴只由 Obsidian 保存为本地附件；选中一个或多个本地链接后右键“上传附件到 COS”即可按需上传。',
				)
				.addToggle((i) => {
					i.setValue(this.plugin.settings.manualUploadMode).onChange(
						async (t) => {
							((this.plugin.settings.manualUploadMode = t),
								await this.plugin.saveSettings());
						},
					);
				}),
			new Setting(n)
				.setName('上传后删除本地附件')
				.setDesc(
					'开启后，本地图片或附件成功上传至 COS 并在笔记中替换为远程链接后，自动将本地对应的源文件移至废纸篓，避免占用本地存储空间。',
				)
				.addToggle((i) => {
					i.setValue(
						this.plugin.settings.deleteLocalAfterUpload,
					).onChange(async (t) => {
						this.plugin.settings.deleteLocalAfterUpload = t;
						await this.plugin.saveSettings();
						if (t) {
							new Notice('已开启：上传成功后将安全删除本地附件');
						}
					});
				}),
			new Setting(n)
				.setName('启用多格式文件上传')
				.setDesc(
					'开启后，拖拽或粘贴非图片文件（如 PDF、MP3 等）时也会自动上传到 COS',
				)
				.addToggle((i) => {
					i.setValue(this.plugin.settings.enableFileUpload).onChange(
						async (t) => {
							((this.plugin.settings.enableFileUpload = t),
								await this.plugin.saveSettings(),
								t && new Notice('已开启多格式文件上传'));
						},
					);
				}),
			new Setting(n)
				.setName('允许的文件类型')
				.setDesc('非图片文件允许上传的扩展名，用英文逗号分隔')
				.addTextArea((i) =>
					i
						.setPlaceholder('pdf,mp3,mp4,wav,doc,docx,zip,mov,webm')
						.setValue(this.plugin.settings.allowedFileExtensions)
						.onChange(async (t) => {
							((this.plugin.settings.allowedFileExtensions = t),
								await this.plugin.saveSettings());
						}),
				),
			new Setting(n)
				.setName('测试上传')
				.setDesc('测试COS连接和上传功能')
				.addButton((i) => {
					i.setButtonText('测试连接').onClick(async () => {
						if (!this.plugin.uploader) {
							new Notice('请先配置COS设置');
							return;
						}
						(log('开始手动测试COS连接...'),
							(await this.plugin.uploader.testConnection())
								? new Notice('COS连接测试成功！')
								: new Notice(
										'COS连接测试失败，请检查控制台日志',
									));
					});
				}));
	}
	debounce(n: (...args: any[]) => void, g: number) {
		let i: number | undefined;
		return function (...k: any[]) {
			let l = () => {
				window.clearTimeout(i);
				n(...k);
			};
			window.clearTimeout(i);
			i = window.setTimeout(l, g);
		};
	}
}

class TencentCosUploader {
	settings: any;
	cos: any;
	urlCache: Map<string, any>;
	updateInterval: number | null = null;
	noteImageCounter: Map<string, any> = new Map();
	constructor(K: any) {
		this.updateInterval = null;
		this.noteImageCounter = new Map();
		if (
			(log('COSUploader构造函数被调用，设置:', {
				hasSecretId: !!K.secretId,
				hasSecretKey: !!K.secretKey,
				bucket: K.bucket,
				region: K.region,
				prefix: K.prefix,
				expiration: K.expiration,
			}),
			(this.settings = K),
			(this.urlCache = new Map()),
			!K.secretId || !K.secretKey)
		)
			throw new Error('请先配置腾讯云 SecretId 和 SecretKey');
		try {
			(log('开始创建COS实例...'),
				(this.cos = new COS({
					SecretId: K.secretId,
					SecretKey: K.secretKey,
					Protocol: 'https:',
				})),
				log('COS实例创建成功'));
		} catch (n: any) {
			throw (console.error('COS实例创建失败:', n), n);
		}
	}
	cleanup() {
		if (this.updateInterval !== null) {
			window.clearInterval(this.updateInterval);
			this.updateInterval = null;
		}
	}
	validateConfig() {
		let K = [];
		return (
			this.settings.secretId || K.push('缺少 Secret Id'),
			this.settings.secretKey || K.push('缺少 Secret Key'),
			this.settings.bucket
				? /^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(
						this.settings.bucket.split('-')[0],
					) || K.push('存储桶名称格式不正确')
				: K.push('缺少存储桶名称'),
			this.settings.region || K.push('缺少地域信息'),
			log('COS配置验证结果:', {
				valid: K.length === 0,
				errors: K,
				config: {
					secretId: this.settings.secretId
						? `${this.settings.secretId.substring(0, 8)}...`
						: '未设置',
					secretKey: this.settings.secretKey
						? `${this.settings.secretKey.substring(0, 8)}...`
						: '未设置',
					bucket: this.settings.bucket || '未设置',
					region: this.settings.region || '未设置',
					prefix: this.settings.prefix || '无前缀',
				},
			}),
			{ valid: K.length === 0, errors: K }
		);
	}
	async testConnection() {
		try {
			return (
				log('开始测试COS连接...'),
				new Promise((K) => {
					this.cos.getBucket(
						{
							Bucket: this.settings.bucket,
							Region: this.settings.region,
							MaxKeys: 1,
						},
						(n, g) => {
							n
								? (console.error('COS连接测试失败:', n),
									console.error('错误详情:', {
										code: n.code,
										message: n.message,
										statusCode: n.statusCode,
									}),
									K(false))
								: (log('COS连接测试成功:', g), K(true));
						},
					);
				})
			);
		} catch (K: any) {
			return (console.error('COS连接测试异常:', K), false);
		}
	}
	async uploadFile(K, n, g) {
		if (!this.settings.bucket || !this.settings.region)
			throw new Error('请先配置存储桶和地域信息');
		(log('开始上传文件:', K.name, '大小:', K.size, 'bytes'),
			log('存储桶配置:', {
				bucket: this.settings.bucket,
				region: this.settings.region,
				prefix: this.settings.prefix,
			}));
		let i = K.name,
			t = i.lastIndexOf('.'),
			k = t > 0 ? i.substring(t + 1) : '',
			l,
			w,
			u;
		if (this.settings.enableCustomNaming && g) {
			let f = this.buildCustomUploadPath(i, k, g);
			((l = f.split('/').pop() || f),
				(w = this.getDisplayName(l)),
				(u = [this.settings.prefix.replace(/^\/+|\/+$/g, ''), f]
					.filter(Boolean)
					.join('/')),
				log('使用自定义命名:', u));
		} else {
			let h = (t > 0 ? i.substring(0, t) : i).replace(/\s+/g, '-');
			((w = `${Date.now()}-${h}`),
				(l = k ? `${w}.${k}` : w),
				(u = `${this.settings.prefix ? `${this.settings.prefix}/` : ''}${l}`));
		}
		return (
			log('上传路径:', u),
			new Promise((f, h) => {
				this.cos.putObject(
					{
						Bucket: this.settings.bucket,
						Region: this.settings.region,
						Key: u,
						Body: K,
					},
					async (d, x) => {
						if (d) {
							(console.error('上传错误:', d),
								console.error('错误详情:', {
									code: d.code,
									message: d.message,
									statusCode: d.statusCode,
								}),
								h(d));
							return;
						}
						log('上传成功，响应数据:', x);
						try {
							if (n)
								try {
									await n(l);
								} catch (b: any) {
									console.warn('备份原始图片失败:', b);
								}
							log('开始获取签名URL...');
							let A = await this.getSignedUrl(u);
							(log('获取到签名URL:', A),
								this.urlCache.set(u, A),
								f({ url: A, displayName: w }));
						} catch (A: any) {
							(console.error('获取签名URL失败:', A), h(A));
						}
					},
				);
			})
		);
	}
	buildCustomUploadPath(K, n, g) {
		let t = (this.noteImageCounter.get(g.notePath) || 0) + 1;
		this.noteImageCounter.set(g.notePath, t);
		let k = new Date(),
			l = String(k.getFullYear()),
			w = String(k.getMonth() + 1).padStart(2, '0'),
			u = String(k.getDate()).padStart(2, '0'),
			f = String(k.getHours()).padStart(2, '0'),
			h = String(k.getMinutes()).padStart(2, '0'),
			d = String(k.getSeconds()).padStart(2, '0'),
			x = `${l}-${w}${u}-${f}:${h}:${d}`,
			A = K.lastIndexOf('.'),
			b = (A > 0 ? K.substring(0, A) : K).replace(/\s+/g, '-'),
			M = K.replace(/\s+/g, '-'),
			E = {
				year: l,
				month: w,
				mon: w,
				day: u,
				timestamp: x,
				notename: g.noteName.replace(/\s+/g, ''),
				counter: String(t),
				random: Math.random().toString(36).slice(2, 10),
				filename: M,
				basename: b,
				ext: n ? `.${n}` : '',
			},
			j = (
				this.settings.namingPattern.trim() ||
				'{notename}-{timestamp}-{counter}'
			).replace(/\{([a-z]+)\}/gi, (v, B) => {
				var a;
				return (a = E[B.toLowerCase()]) != null ? a : v;
			});
		((j = j
			.replace(/\\/g, '/')
			.split('/')
			.filter((v) => v && v !== '.' && v !== '..')
			.join('/')),
			j || (j = `${E.notename}-${x}-${t}`));
		let m = j.split('/').pop() || '';
		return (n && !/\.[^./]+$/.test(m) && (j += `.${n}`), j);
	}
	getDisplayName(K) {
		let n = K.lastIndexOf('.');
		return n > 0 ? K.substring(0, n) : K;
	}
	customDomainOrigin() {
		let K = this.settings.customDomain.trim();
		return K
			? /^https?:\/\//i.test(K)
				? K.replace(/\/+$/, '')
				: `https://${K.replace(/\/+$/, '')}`
			: null;
	}
	getSignedUrl(K: any, n?: any, g?: any): any {
		let i = g || this.settings.expiration,
			t = n ? n + K : K;
		if (
			(log('获取URL参数:', {
				fileName: K,
				prefix: n,
				expires: i,
				bucket: this.settings.bucket,
				region: this.settings.region,
				publicRead: this.settings.publicRead,
			}),
			this.settings.publicRead)
		) {
			let k = this.settings.bucket,
				l = this.settings.region,
				w = `${k}.cos.${l}.myqcloud.com`,
				f = `${this.customDomainOrigin() || `https://${w}`}/${t}`;
			return (log('公有读URL生成成功:', f), Promise.resolve(f));
		}
		return new Promise((k, l) => {
			this.cos.getObjectUrl(
				{
					Bucket: this.settings.bucket,
					Region: this.settings.region,
					Key: t,
					Sign: true,
					Expires: i,
				},
				(w, u) => {
					if (w) {
						(console.error('获取签名URL错误:', w), l(w));
						return;
					}
					let f =
							u.Url +
							(u.Url.indexOf('?') > -1 ? '&' : '?') +
							'response-content-disposition=inline',
						h = this.customDomainOrigin();
					(h && (f = f.replace(/^https?:\/\/[^/]+/i, h)),
						log('签名URL生成成功:', f),
						k(f));
				},
			);
		});
	}
	async refreshSignedUrl(K) {
		return this.getSignedUrl(K, this.settings.prefix + '/');
	}
	async downloadObject(K) {
		let n = await this.cos.getObject({
			Bucket: this.settings.bucket,
			Region: this.settings.region,
			Key: K,
			DataType: 'arraybuffer',
		});
		return n.Body instanceof ArrayBuffer
			? n.Body
			: n.Body instanceof Blob
				? n.Body.arrayBuffer()
				: new TextEncoder().encode(n.Body).buffer;
	}
}

class ConfirmModal extends Modal {
	title: string;
	message: string;
	resolve: any;
	resolved: boolean = false;
	constructor(app: any, title: string, message: string, resolve: any) {
		super(app);
		this.title = title;
		this.message = message;
		this.resolve = resolve;
		this.resolved = false;
	}
	onOpen() {
		let { contentEl: n } = this;
		(n.empty(),
			n.createEl('h2', { text: this.title }),
			n.createEl('p', { text: this.message }));
		let g = n.createDiv('delete-confirm-buttons');
		(new ButtonComponent(g).setButtonText('取消').onClick(() => {
			(this.setResult(false), this.close());
		}),
			new ButtonComponent(g)
				.setButtonText('确认执行')
				.setCta()
				.onClick(() => {
					(this.setResult(true), this.close());
				}));
	}
	onClose() {
		(this.setResult(false), this.contentEl.empty());
	}
	setResult(n) {
		this.resolved || ((this.resolved = true), this.resolve(n));
	}
}

/* nosourcemap */
export default ImgurPlugin;
