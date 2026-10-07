import { describe, expect, it } from 'vitest';
import {
	buildLocalAttachmentLink,
	buildRemoteAttachmentLink,
	extractAttachmentLinks,
} from '../src/attachment-links';
import type { AttachmentLink, UploadResult } from '../src/types';

const uploaded: UploadResult = { url: 'https://c.example/x.png', displayName: 'x' };
const png = { name: 'a.png', extension: 'png' };
const pdf = { name: 'a.pdf', extension: 'pdf' };

function link(overrides: Partial<AttachmentLink>): AttachmentLink {
	return {
		raw: '',
		path: '',
		alt: '',
		isImage: true,
		isExternal: false,
		...overrides,
	};
}

describe('extractAttachmentLinks', () => {
	it('解析 wiki 图片及其尺寸别名', () => {
		const [first] = extractAttachmentLinks('![[my pic.png|300]]');
		expect(first).toEqual({
			raw: '![[my pic.png|300]]',
			path: 'my pic.png',
			alt: '300',
			isImage: true,
			isExternal: false,
		});
	});

	it('区分嵌入（!）与普通链接', () => {
		const links = extractAttachmentLinks('[[doc.pdf]] ![[pic.png]]');
		expect(links.map((l) => l.isImage)).toEqual([false, true]);
	});

	it('解析 Markdown 链接，含 <> 路径与 title', () => {
		const links = extractAttachmentLinks(
			'![alt*200](images/x.png) ![x](<dir/my pic.jpg>) [d](https://e.com/a.pdf "title")',
		);
		expect(links.map((l) => l.path)).toEqual([
			'images/x.png',
			'dir/my pic.jpg',
			'https://e.com/a.pdf',
		]);
		expect(links[0]?.alt).toBe('alt*200');
		expect(links[2]?.isExternal).toBe(true);
	});

	it('过滤内部笔记名、Emoji、锚点等非附件内容', () => {
		const links = extractAttachmentLinks(
			'[[笔记名]] [[:smile:]] [锚点](#section) [纯文本](hello)',
		);
		expect(links).toEqual([]);
	});

	it('保留带路径分隔符但无扩展名的链接', () => {
		const links = extractAttachmentLinks('[[folder/name]]');
		expect(links.map((l) => l.path)).toEqual(['folder/name']);
	});

	it('可重复调用且互不影响（全局正则无状态泄漏）', () => {
		const text = '![[a.png]]';
		expect(extractAttachmentLinks(text)).toHaveLength(1);
		expect(extractAttachmentLinks(text)).toHaveLength(1);
	});

	it('无链接时返回空数组', () => {
		expect(extractAttachmentLinks('just text')).toEqual([]);
	});
});

describe('buildRemoteAttachmentLink', () => {
	it('图片：使用上传后的显示名', () => {
		const result = buildRemoteAttachmentLink(
			link({ raw: '![[a.png]]' }),
			png,
			uploaded,
		);
		expect(result).toBe('![x](https://c.example/x.png)');
	});

	it('图片：保留 wiki 竖线宽度', () => {
		const result = buildRemoteAttachmentLink(
			link({ raw: '![[a.png|300]]', alt: '300' }),
			png,
			uploaded,
		);
		expect(result).toBe('![x*300](https://c.example/x.png)');
	});

	it('图片：保留 alt 的 *宽度 后缀', () => {
		const result = buildRemoteAttachmentLink(
			link({ raw: '![a*200](a.png)', alt: 'a*200' }),
			png,
			uploaded,
		);
		expect(result).toBe('![x*200](https://c.example/x.png)');
	});

	it('非图片：用 alt 或文件名作为链接文本', () => {
		expect(
			buildRemoteAttachmentLink(link({ alt: '文档' }), pdf, uploaded),
		).toBe('[文档](https://c.example/x.png)');
		expect(buildRemoteAttachmentLink(link({}), pdf, uploaded)).toBe(
			'[a.pdf](https://c.example/x.png)',
		);
	});
});

describe('buildLocalAttachmentLink', () => {
	it('图片：生成 wiki 嵌入，并保留宽度', () => {
		expect(
			buildLocalAttachmentLink(link({ raw: '![a*150](u)', alt: 'a*150' }), png, 'a.png'),
		).toBe('![[a.png|150]]');
		expect(buildLocalAttachmentLink(link({}), png, 'dir/a.png')).toBe(
			'![[dir/a.png]]',
		);
	});

	it('非图片：生成普通 Markdown 链接', () => {
		expect(buildLocalAttachmentLink(link({}), pdf, 'a.pdf')).toBe('[a.pdf](a.pdf)');
		expect(buildLocalAttachmentLink(link({ alt: '说明' }), pdf, 'a.pdf')).toBe(
			'[说明](a.pdf)',
		);
	});
});
