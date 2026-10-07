import COS from 'cos-js-sdk-v5';
import type {
	NoteContext,
	TencentCosSettings,
	UploadResult,
} from './types';
import {
	getErrorMessage,
	normalizeOrigin,
	stripExtension,
} from './utils';

const DEFAULT_NAMING_PATTERN = '{notename}-{timestamp}-{counter}';

/** 腾讯云 COS 上传 / 下载 / 签名封装 */
export class TencentCosUploader {
	private readonly cos: COS;
	/** 每篇笔记已上传的文件计数，用于 `{counter}` 变量 */
	private readonly noteCounters = new Map<string, number>();

	/**
	 * @param settings 与插件共享的设置对象引用；设置修改后无需重建即可生效
	 * （仅密钥变更需要重新创建实例）。
	 */
	constructor(private readonly settings: TencentCosSettings) {
		if (!settings.secretId || !settings.secretKey) {
			throw new Error('请先配置腾讯云 SecretId 和 SecretKey');
		}
		this.cos = new COS({
			SecretId: settings.secretId,
			SecretKey: settings.secretKey,
			Protocol: 'https:',
		});
	}

	async testConnection(): Promise<boolean> {
		try {
			await this.cos.getBucket({
				Bucket: this.settings.bucket,
				Region: this.settings.region,
				MaxKeys: 1,
			});
			return true;
		} catch (error) {
			console.error('COS连接测试失败:', error);
			return false;
		}
	}

	async uploadFile(file: File, note?: NoteContext): Promise<UploadResult> {
		const { bucket, region, prefix, enableCustomNaming } = this.settings;
		if (!bucket || !region) throw new Error('请先配置存储桶和地域信息');

		const originalName = file.name;
		const dotIndex = originalName.lastIndexOf('.');
		const extension =
			dotIndex > 0 ? originalName.substring(dotIndex + 1) : '';

		let displayName: string;
		let key: string;
		if (enableCustomNaming && note) {
			const path = this.buildCustomUploadPath(
				originalName,
				extension,
				note,
			);
			displayName = stripExtension(path.split('/').pop() || path);
			key = [prefix.replace(/^\/+|\/+$/g, ''), path]
				.filter(Boolean)
				.join('/');
		} else {
			const baseName = (
				dotIndex > 0
					? originalName.substring(0, dotIndex)
					: originalName
			).replace(/\s+/g, '-');
			displayName = `${Date.now()}-${baseName}`;
			const fileName = extension
				? `${displayName}.${extension}`
				: displayName;
			key = `${prefix ? `${prefix}/` : ''}${fileName}`;
		}

		await this.cos.putObject({
			Bucket: bucket,
			Region: region,
			Key: key,
			Body: file,
		});

		const url = await this.getSignedUrl(key);
		return { url, displayName };
	}

	/** 按文件名重新签名（文件需位于配置的前缀目录下） */
	refreshSignedUrl(fileName: string): Promise<string> {
		const { prefix } = this.settings;
		return this.getSignedUrl(prefix ? `${prefix}/${fileName}` : fileName);
	}

	async downloadObject(key: string): Promise<ArrayBuffer> {
		const { Body: body } = await this.cos.getObject({
			Bucket: this.settings.bucket,
			Region: this.settings.region,
			Key: key,
			DataType: 'arraybuffer',
		});
		if (body instanceof ArrayBuffer) return body;
		if (body instanceof Blob) return body.arrayBuffer();

		const encoded = new TextEncoder().encode(body);
		const buffer = new ArrayBuffer(encoded.byteLength);
		new Uint8Array(buffer).set(encoded);
		return buffer;
	}

	/** URL 是否指向当前配置的存储桶域名或自定义域名 */
	isCosUrl(url: string): boolean {
		try {
			const { hostname } = new URL(url);
			const customOrigin = normalizeOrigin(this.settings.customDomain);
			const candidates = [
				`${this.settings.bucket}.cos.${this.settings.region}.myqcloud.com`,
				customOrigin ? new URL(customOrigin).hostname : '',
			];
			return candidates
				.filter(Boolean)
				.some((host) => host.toLowerCase() === hostname.toLowerCase());
		} catch {
			return false;
		}
	}

	/** 从 COS 链接解析对象键；路径含 `..` 或为空时返回 null */
	getObjectKeyFromUrl(url: string): string | null {
		try {
			const key = decodeURIComponent(new URL(url).pathname).replace(
				/^\/+/,
				'',
			);
			return !key || key.split('/').includes('..') ? null : key;
		} catch {
			return null;
		}
	}

	private buildCustomUploadPath(
		fileName: string,
		extension: string,
		note: NoteContext,
	): string {
		const counter = (this.noteCounters.get(note.notePath) ?? 0) + 1;
		this.noteCounters.set(note.notePath, counter);

		const now = new Date();
		const pad = (value: number): string => String(value).padStart(2, '0');
		const year = String(now.getFullYear());
		const month = pad(now.getMonth() + 1);
		const day = pad(now.getDate());
		const timestamp = `${year}-${month}${day}-${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
		const noteName = note.noteName.replace(/\s+/g, '');

		const variables = new Map<string, string>([
			['year', year],
			['month', month],
			['mon', month],
			['day', day],
			['timestamp', timestamp],
			['notename', noteName],
			['counter', String(counter)],
			['random', Math.random().toString(36).slice(2, 10)],
			['filename', fileName.replace(/\s+/g, '-')],
			['basename', stripExtension(fileName).replace(/\s+/g, '-')],
			['ext', extension ? `.${extension}` : ''],
		]);

		const pattern =
			this.settings.namingPattern.trim() || DEFAULT_NAMING_PATTERN;
		let path = pattern
			.replace(
				/\{([a-z]+)\}/gi,
				(placeholder, name: string) =>
					variables.get(name.toLowerCase()) ?? placeholder,
			)
			.replace(/\\/g, '/')
			.split('/')
			.filter((segment) => segment && segment !== '.' && segment !== '..')
			.join('/');

		if (!path) path = `${noteName}-${timestamp}-${counter}`;

		const lastSegment = path.split('/').pop() ?? '';
		if (extension && !/\.[^./]+$/.test(lastSegment)) path += `.${extension}`;
		return path;
	}

	private getSignedUrl(key: string): Promise<string> {
		const { bucket, region, publicRead, expiration } = this.settings;
		const customOrigin = normalizeOrigin(this.settings.customDomain);

		if (publicRead) {
			const origin =
				customOrigin ?? `https://${bucket}.cos.${region}.myqcloud.com`;
			return Promise.resolve(`${origin}/${key}`);
		}

		return new Promise<string>((resolve, reject) => {
			this.cos.getObjectUrl(
				{
					Bucket: bucket,
					Region: region,
					Key: key,
					Sign: true,
					Expires: expiration,
				},
				(error, data) => {
					if (error) {
						reject(new Error(getErrorMessage(error)));
						return;
					}
					const separator = data.Url.includes('?') ? '&' : '?';
					let url = `${data.Url}${separator}response-content-disposition=inline`;
					if (customOrigin) {
						url = url.replace(/^https?:\/\/[^/]+/i, customOrigin);
					}
					resolve(url);
				},
			);
		});
	}
}
