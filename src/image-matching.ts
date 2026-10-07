import { safeDecodeURIComponent } from './utils';

/** 渲染后 `<img>` 的来源信息 */
export interface ImageInfo {
	filename: string;
	domain: string;
	path: string;
}

/** 去掉末尾扩展名 */
const stripFileExtension = (name: string): string =>
	name.replace(/\.[^.]*$/, '');
/** 去掉文件名开头的 `数字-` 时间戳前缀 */
const stripTimestampPrefix = (name: string): string =>
	name.replace(/^\d+-/, '');

/** 取 URL / 路径最后一段（去掉查询串） */
function lastPathSegment(value: string): string {
	return value.split('/').pop()?.split('?')[0] ?? '';
}

/** 从 `<img>` 的 src 中提取文件名等信息 */
export function extractImageInfo(src: string): ImageInfo | null {
	try {
		const url = new URL(src);
		return {
			filename: lastPathSegment(url.pathname),
			domain: url.hostname,
			path: src,
		};
	} catch {
		const filename = lastPathSegment(src);
		return filename ? { filename, domain: '', path: src } : null;
	}
}

/** 逐级放宽的文件名比较：原样 → 去扩展名 → 去时间戳 → 解码后同样三步 */
export function compareFilenames(a: string, b: string): boolean {
	if (!a || !b) return false;
	if (a === b) return true;

	const aBase = stripFileExtension(a);
	const bBase = stripFileExtension(b);
	if (aBase === bBase) return true;
	if (stripTimestampPrefix(aBase) === stripTimestampPrefix(bBase)) {
		return true;
	}

	const aDecoded = safeDecodeURIComponent(a);
	const bDecoded = safeDecodeURIComponent(b);
	if (aDecoded === bDecoded) return true;

	return (
		stripTimestampPrefix(stripFileExtension(aDecoded)) ===
		stripTimestampPrefix(stripFileExtension(bDecoded))
	);
}

function filenameFromPathname(pathname: string): string {
	return safeDecodeURIComponent(pathname.split('/').pop() ?? '');
}

/** Markdown 中的图片地址是否对应当前渲染的 `<img>` */
export function isMatchingImageByUrl(
	markdownUrl: string,
	imgSrc: string,
	info: ImageInfo,
): boolean {
	if (markdownUrl === imgSrc) return true;

	if (markdownUrl.startsWith('http') && imgSrc.startsWith('http')) {
		try {
			const a = new URL(markdownUrl);
			const b = new URL(imgSrc);
			if (a.hostname === b.hostname && a.pathname === b.pathname) {
				return true;
			}
			if (
				compareFilenames(
					filenameFromPathname(a.pathname),
					filenameFromPathname(b.pathname),
				)
			) {
				return true;
			}
		} catch {
			// URL 无法解析时，继续使用下面基于文件名的匹配
		}
	}

	if (info.filename) {
		const decodedName = safeDecodeURIComponent(info.filename);
		if (
			markdownUrl.includes(info.filename) ||
			markdownUrl.includes(decodedName)
		) {
			return true;
		}
		const markdownName = safeDecodeURIComponent(
			lastPathSegment(markdownUrl),
		);
		if (compareFilenames(markdownName, decodedName)) return true;
	}

	return false;
}

/** wiki 图片名是否对应当前渲染的 `<img>` */
export function isMatchingImageByFilename(
	filename: string,
	info: ImageInfo,
): boolean {
	if (!filename || !info.filename) return false;
	return compareFilenames(filename, info.filename);
}
