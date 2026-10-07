/** 插件持久化设置 */
export interface TencentCosSettings {
	secretId: string;
	secretKey: string;
	bucket: string;
	region: string;
	/** 对象存储路径前缀（不含首尾斜杠） */
	prefix: string;
	/** 签名 URL 有效期（秒） */
	expiration: number;
	publicRead: boolean;
	enableCustomNaming: boolean;
	enableFileUpload: boolean;
	/** 允许上传的非图片扩展名，英文逗号分隔 */
	allowedFileExtensions: string;
	customDomain: string;
	manualUploadMode: boolean;
	namingPattern: string;
	deleteLocalAfterUpload: boolean;
}

export const DEFAULT_SETTINGS: TencentCosSettings = {
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

/** 上传时用于命名模板的笔记上下文 */
export interface NoteContext {
	noteName: string;
	notePath: string;
}

/** 单个文件上传结果 */
export interface UploadResult {
	url: string;
	displayName: string;
}

/** 从 Markdown 文本中解析出的附件链接 */
export interface AttachmentLink {
	/** 原始匹配文本，用于替换 */
	raw: string;
	path: string;
	alt: string;
	isImage: boolean;
	isExternal: boolean;
}

/** 单个笔记中附件处理的统计 */
export interface SyncStats {
	uploadedCount: number;
	failedCount: number;
}
