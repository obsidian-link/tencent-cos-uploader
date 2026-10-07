import type { TFile } from 'obsidian';
import type { AttachmentLink, UploadResult } from './types';
import { hasFileExtension, isHttpUrl, isImageExtension } from './utils';

/** `![[path|alt]]` / `[[path]]` */
const WIKI_LINK_PATTERN = /(!?)\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g;
/** `![alt](path "title")` / `[alt](<path>)` */
const MARKDOWN_LINK_PATTERN =
	/(!?)\[([^\]]*)\]\((?:<([^>]+)>|([^\s)]+))(?:\s+(?:"[^"]*"|'[^']*'))?\)/g;
/** wiki 链接尾部的宽度：`![[a.png|300]]` */
const WIKI_WIDTH_PATTERN = /\|(\d+)\]\]$/;
/** Markdown alt 尾部的宽度：`![alt*300](a.png)` */
const ALT_WIDTH_PATTERN = /\*(\d+)$/;

/**
 * 过滤空值，以及既非 URL、又无路径分隔符、也无扩展名的内容
 * （例如内部笔记名、Emoji 或纯文本锚点）。
 */
function isAttachmentCandidate(path: string): boolean {
	if (!path) return false;
	return isHttpUrl(path) || path.includes('/') || hasFileExtension(path);
}

/** 解析文本中的 wiki 链接与 Markdown 链接 */
export function extractAttachmentLinks(text: string): AttachmentLink[] {
	const links: AttachmentLink[] = [];

	for (const match of text.matchAll(WIKI_LINK_PATTERN)) {
		const path = (match[2] ?? '').trim();
		if (!isAttachmentCandidate(path)) continue;
		links.push({
			raw: match[0],
			path,
			alt: (match[3] ?? '').trim(),
			isImage: match[1] === '!',
			isExternal: isHttpUrl(path),
		});
	}

	for (const match of text.matchAll(MARKDOWN_LINK_PATTERN)) {
		const path = (match[3] ?? match[4] ?? '').trim();
		if (!isAttachmentCandidate(path)) continue;
		links.push({
			raw: match[0],
			path,
			alt: (match[2] ?? '').trim(),
			isImage: match[1] === '!',
			isExternal: isHttpUrl(path),
		});
	}

	return links;
}

/** 读取链接中携带的图片宽度（wiki 竖线语法优先，其次 alt 的 `*宽度` 后缀） */
function extractImageWidth(link: AttachmentLink): string | undefined {
	return (
		WIKI_WIDTH_PATTERN.exec(link.raw)?.[1] ||
		ALT_WIDTH_PATTERN.exec(link.alt)?.[1] ||
		undefined
	);
}

type AttachmentFile = Pick<TFile, 'name' | 'extension'>;

/** 构造指向 COS 的远程链接，保留图片宽度 */
export function buildRemoteAttachmentLink(
	link: AttachmentLink,
	file: AttachmentFile,
	uploaded: UploadResult,
): string {
	if (!isImageExtension(file.extension)) {
		return `[${link.alt || file.name}](${uploaded.url})`;
	}
	const width = extractImageWidth(link);
	return `![${uploaded.displayName}${width ? `*${width}` : ''}](${uploaded.url})`;
}

/** 构造指向本地附件的 wiki 链接，保留图片宽度 */
export function buildLocalAttachmentLink(
	link: AttachmentLink,
	file: AttachmentFile,
	linktext: string,
): string {
	if (!isImageExtension(file.extension)) {
		return `[${link.alt || file.name}](${linktext})`;
	}
	const width = extractImageWidth(link);
	return `![[${linktext}${width ? `|${width}` : ''}]]`;
}
