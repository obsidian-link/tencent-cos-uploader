import { describe, expect, it } from 'vitest';
import {
	compareFilenames,
	extractImageInfo,
	isMatchingImageByFilename,
	isMatchingImageByUrl,
	type ImageInfo,
} from '../src/image-matching';

describe('extractImageInfo', () => {
	it('从完整 URL 提取文件名与域名，忽略查询串', () => {
		expect(
			extractImageInfo('https://b.cos.ap-x.myqcloud.com/images/1-a.png?sign=1'),
		).toEqual({
			filename: '1-a.png',
			domain: 'b.cos.ap-x.myqcloud.com',
			path: 'https://b.cos.ap-x.myqcloud.com/images/1-a.png?sign=1',
		});
	});

	it('支持 app:// 等本地协议', () => {
		expect(extractImageInfo('app://obsidian.md/x/pic.png?123')?.filename).toBe(
			'pic.png',
		);
	});

	it('非 URL 时回退到按 / 截取文件名', () => {
		expect(extractImageInfo('folder/pic.png?x=1')).toEqual({
			filename: 'pic.png',
			domain: '',
			path: 'folder/pic.png?x=1',
		});
	});

	it('无法得到文件名时返回 null', () => {
		expect(extractImageInfo('not a url/')).toBeNull();
		expect(extractImageInfo('')).toBeNull();
	});
});

describe('compareFilenames', () => {
	it.each([
		['a.png', 'a.png', true, '完全相同'],
		['a.png', 'a.jpg', true, '仅扩展名不同'],
		['1700000000-a.png', 'a.png', true, '时间戳前缀'],
		['%E4%B8%AD.png', '中.png', true, 'URL 编码'],
		['1700-%E4%B8%AD.png', '中.jpg', true, '编码 + 时间戳 + 扩展名'],
		['a.png', 'b.png', false, '不同文件'],
		['', 'a.png', false, '空值'],
		['a.png', '', false, '空值'],
	])('%s vs %s -> %s（%s）', (a, b, expected) => {
		expect(compareFilenames(a, b)).toBe(expected);
	});

	it('非法编码不抛错', () => {
		expect(() => compareFilenames('%E4%B8', 'x.png')).not.toThrow();
	});
});

describe('isMatchingImageByUrl', () => {
	const info: ImageInfo = {
		filename: '1700-a.png',
		domain: 'b.cos.ap-x.myqcloud.com',
		path: '',
	};
	const src = 'https://b.cos.ap-x.myqcloud.com/images/1700-a.png?sign=1';

	it('URL 完全相同', () => {
		expect(isMatchingImageByUrl(src, src, info)).toBe(true);
	});

	it('仅签名参数不同，域名与路径相同', () => {
		expect(
			isMatchingImageByUrl(
				'https://b.cos.ap-x.myqcloud.com/images/1700-a.png?sign=2',
				src,
				info,
			),
		).toBe(true);
	});

	it('域名不同但文件名可比对（自定义域名场景）', () => {
		expect(
			isMatchingImageByUrl('https://img.example.com/images/1700-a.png', src, info),
		).toBe(true);
	});

	it('本地相对路径包含文件名', () => {
		expect(isMatchingImageByUrl('attachments/1700-a.png', 'app://x/y', info)).toBe(
			true,
		);
	});

	it('URL 编码的 Markdown 路径匹配解码后的文件名', () => {
		const cn: ImageInfo = { filename: '%E4%B8%AD.png', domain: '', path: '' };
		expect(isMatchingImageByUrl('附件/中.png', 'app://x/%E4%B8%AD.png', cn)).toBe(
			true,
		);
	});

	it('完全无关的图片不匹配', () => {
		expect(
			isMatchingImageByUrl('https://z.com/other.png', src, info),
		).toBe(false);
	});

	it('filename 为空且 URL 不同则不匹配', () => {
		expect(
			isMatchingImageByUrl('x.png', 'y.png', { filename: '', domain: '', path: '' }),
		).toBe(false);
	});
});

describe('isMatchingImageByFilename', () => {
	const info: ImageInfo = { filename: 'a.png', domain: '', path: '' };

	it('文件名可比对时匹配', () => {
		expect(isMatchingImageByFilename('a.png', info)).toBe(true);
		expect(isMatchingImageByFilename('123-a.png', info)).toBe(true);
	});

	it('任一为空或不同则不匹配', () => {
		expect(isMatchingImageByFilename('', info)).toBe(false);
		expect(isMatchingImageByFilename('a.png', { ...info, filename: '' })).toBe(
			false,
		);
		expect(isMatchingImageByFilename('b.png', info)).toBe(false);
	});
});
