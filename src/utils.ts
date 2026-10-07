const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
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
]);

const MIME_TYPES: Readonly<Record<string, string>> = {
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
};

const MIME_EXTENSIONS: Readonly<Record<string, string>> = {
	'image/gif': '.gif',
	'image/jpeg': '.jpg',
	'image/jpg': '.jpg',
	'image/png': '.png',
	'image/svg+xml': '.svg',
	'image/webp': '.webp',
};

const FILE_EXTENSION_PATTERN = /\.[a-z0-9]{1,10}$/i;
const HTTP_URL_PATTERN = /^https?:\/\//i;

/** 从任意抛出值中安全提取错误信息（兼容 COS SDK 抛出的普通对象） */
export function getErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (
		typeof error === 'object' &&
		error !== null &&
		'message' in error &&
		typeof error.message === 'string'
	) {
		return error.message;
	}
	return String(error);
}

export function isHttpUrl(value: string): boolean {
	return HTTP_URL_PATTERN.test(value);
}

/** 字符串是否以 1~10 位字母数字扩展名结尾 */
export function hasFileExtension(value: string): boolean {
	return FILE_EXTENSION_PATTERN.test(value);
}

/** 解码失败时返回原值，避免 URIError 中断流程 */
export function safeDecodeURIComponent(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

export function isImageExtension(extension: string): boolean {
	return IMAGE_EXTENSIONS.has(extension.toLowerCase());
}

export function getMimeType(extension: string): string {
	return MIME_TYPES[extension.toLowerCase()] ?? 'application/octet-stream';
}

export function extensionForMimeType(mimeType: string): string {
	return MIME_EXTENSIONS[mimeType.toLowerCase()] ?? '.png';
}

/** 将用户填写的域名规范化为不带末尾斜杠、含协议的 origin（默认 HTTPS） */
export function normalizeOrigin(domain: string): string | null {
	const trimmed = domain.trim();
	if (!trimmed) return null;
	const withProtocol = isHttpUrl(trimmed) ? trimmed : `https://${trimmed}`;
	return withProtocol.replace(/\/+$/, '');
}

/** 从 URL 中提取文件名（已解码、去除空白），失败时回退到 `external-image` */
export function filenameFromUrl(url: string): string {
	const fallback = 'external-image';
	try {
		const lastSegment = new URL(url).pathname.split('/').pop() || fallback;
		return (
			decodeURIComponent(lastSegment)
				.replace(/\.\./g, '.')
				.replace(/\s/g, '') || fallback
		);
	} catch {
		return fallback;
	}
}

/** 清理文件名中的非法字符，用于保存到本地附件目录 */
export function sanitizeFileName(name: string): string {
	const dotIndex = name.lastIndexOf('.');
	const hasExtension = dotIndex > 0;
	const base = hasExtension ? name.substring(0, dotIndex) : name;
	const extension = hasExtension ? name.substring(dotIndex + 1) : '';

	const cleanBase = base
		.replace(/[\\/:*?"<>|]/g, '-')
		.replace(/\s+/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '');
	const cleanExtension = extension.replace(/[\\/:*?"<>|]/g, '').trim();

	if (cleanBase) {
		return cleanExtension ? `${cleanBase}.${cleanExtension}` : cleanBase;
	}
	return cleanExtension ? `image.${cleanExtension}` : 'image.png';
}

/** 去除扩展名 */
export function stripExtension(fileName: string): string {
	const dotIndex = fileName.lastIndexOf('.');
	return dotIndex > 0 ? fileName.substring(0, dotIndex) : fileName;
}
