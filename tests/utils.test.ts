import { describe, expect, it } from 'vitest';
import {
	extensionForMimeType,
	filenameFromUrl,
	getErrorMessage,
	getMimeType,
	hasFileExtension,
	isHttpUrl,
	isImageExtension,
	normalizeOrigin,
	safeDecodeURIComponent,
	sanitizeFileName,
	stripExtension,
} from '../src/utils';

describe('getErrorMessage', () => {
	it('读取 Error.message', () => {
		expect(getErrorMessage(new Error('boom'))).toBe('boom');
	});

	it('读取 COS SDK 抛出的普通对象的 message', () => {
		expect(getErrorMessage({ code: 'AccessDenied', message: 'denied' })).toBe(
			'denied',
		);
	});

	it('其他值转为字符串', () => {
		expect(getErrorMessage('oops')).toBe('oops');
		expect(getErrorMessage(42)).toBe('42');
		expect(getErrorMessage(null)).toBe('null');
		expect(getErrorMessage({ message: 123 })).toBe('[object Object]');
	});
});

describe('isHttpUrl', () => {
	it.each([
		['http://a.com', true],
		['HTTPS://a.com/x', true],
		['ftp://a.com', false],
		['images/a.png', false],
		['', false],
	])('%s -> %s', (value, expected) => {
		expect(isHttpUrl(value)).toBe(expected);
	});
});

describe('hasFileExtension', () => {
	it.each([
		['a.png', true],
		['dir/a.PDF', true],
		['archive.tar.gz', true],
		['noext', false],
		['emoji:)', false],
		['a.' + 'x'.repeat(11), false],
	])('%s -> %s', (value, expected) => {
		expect(hasFileExtension(value)).toBe(expected);
	});
});

describe('safeDecodeURIComponent', () => {
	it('正常解码', () => {
		expect(safeDecodeURIComponent('%E4%B8%AD%E6%96%87')).toBe('中文');
	});

	it('非法编码时返回原值而不是抛错', () => {
		expect(safeDecodeURIComponent('%E4%B8')).toBe('%E4%B8');
	});
});

describe('isImageExtension / getMimeType / extensionForMimeType', () => {
	it('图片扩展名判定不区分大小写', () => {
		expect(isImageExtension('PNG')).toBe(true);
		expect(isImageExtension('avif')).toBe(true);
		expect(isImageExtension('pdf')).toBe(false);
	});

	it('已知扩展名返回对应 MIME，未知返回 octet-stream', () => {
		expect(getMimeType('PDF')).toBe('application/pdf');
		expect(getMimeType('jpg')).toBe('image/jpeg');
		expect(getMimeType('xyz')).toBe('application/octet-stream');
	});

	it('MIME 反查扩展名，未知回退 .png', () => {
		expect(extensionForMimeType('image/jpeg')).toBe('.jpg');
		expect(extensionForMimeType('IMAGE/WEBP')).toBe('.webp');
		expect(extensionForMimeType('application/x-unknown')).toBe('.png');
	});
});

describe('normalizeOrigin', () => {
	it.each([
		['img.example.com', 'https://img.example.com'],
		['  img.example.com/  ', 'https://img.example.com'],
		['http://img.example.com//', 'http://img.example.com'],
		['https://img.example.com', 'https://img.example.com'],
	])('%j -> %j', (input, expected) => {
		expect(normalizeOrigin(input)).toBe(expected);
	});

	it('空白输入返回 null', () => {
		expect(normalizeOrigin('')).toBeNull();
		expect(normalizeOrigin('   ')).toBeNull();
	});
});

describe('filenameFromUrl', () => {
	it('解码并去除空白', () => {
		expect(filenameFromUrl('https://e.com/p/my%20pic.png')).toBe('mypic.png');
	});

	it('忽略查询串', () => {
		expect(filenameFromUrl('https://e.com/a/b.png?x=1')).toBe('b.png');
	});

	it('无文件名或非法 URL 时回退', () => {
		expect(filenameFromUrl('https://e.com/')).toBe('external-image');
		expect(filenameFromUrl('not a url')).toBe('external-image');
	});
});

describe('sanitizeFileName', () => {
	it('替换非法字符与空白', () => {
		expect(sanitizeFileName('a:b  c.png')).toBe('a-b-c.png');
	});

	it('合并连续连字符并去除首尾连字符', () => {
		expect(sanitizeFileName('--a---b--.jpg')).toBe('a-b.jpg');
	});

	it('主名为空时使用 image 兜底', () => {
		expect(sanitizeFileName('???')).toBe('image.png');
		expect(sanitizeFileName('???.gif')).toBe('image.gif');
	});

	it('无扩展名时保持无扩展名', () => {
		expect(sanitizeFileName('readme')).toBe('readme');
	});
});

describe('stripExtension', () => {
	it('去除末尾扩展名', () => {
		expect(stripExtension('a.b.png')).toBe('a.b');
	});

	it('点开头的文件名视为无扩展名', () => {
		expect(stripExtension('.env')).toBe('.env');
		expect(stripExtension('plain')).toBe('plain');
	});
});
