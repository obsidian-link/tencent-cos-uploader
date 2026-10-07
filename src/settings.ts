import { App, Notice, PluginSettingTab, Setting, debounce } from 'obsidian';
import type TencentCosPlugin from './main';
import type { TencentCosSettings } from './types';

/** 设置中类型为 string 的字段 */
type StringSettingKey = {
	[K in keyof TencentCosSettings]: TencentCosSettings[K] extends string
		? K
		: never;
}[keyof TencentCosSettings];

/** 设置中类型为 boolean 的字段 */
type BooleanSettingKey = {
	[K in keyof TencentCosSettings]: TencentCosSettings[K] extends boolean
		? K
		: never;
}[keyof TencentCosSettings];

interface TextSettingOptions {
	key: StringSettingKey;
	name: string;
	desc: string;
	placeholder: string;
	/** 写入设置前的规范化，默认 `trim()` */
	normalize?: (value: string) => string;
	/** 修改后是否（防抖）重建上传器，凭据类字段需要 */
	reinitUploader?: boolean;
	multiline?: boolean;
}

interface ToggleSettingOptions {
	key: BooleanSettingKey;
	name: string;
	desc: string;
	/** 开启时弹出的提示 */
	enabledNotice?: string;
}

const REGIONS: ReadonlyArray<readonly [value: string, label: string]> = [
	['ap-beijing-1', '北京一区（ap-beijing-1）'],
	['ap-beijing', '北京（ap-beijing）'],
	['ap-nanjing', '南京（ap-nanjing）'],
	['ap-shanghai', '上海（ap-shanghai）'],
	['ap-guangzhou', '广州（ap-guangzhou）'],
	['ap-chengdu', '成都（ap-chengdu）'],
	['ap-chongqing', '重庆（ap-chongqing）'],
	['ap-shenzhen-fsi', '深圳金融（ap-shenzhen-fsi）'],
	['ap-shanghai-fsi', '上海金融（ap-shanghai-fsi）'],
	['ap-beijing-fsi', '北京金融（ap-beijing-fsi）'],
	['ap-hongkong', '香港（ap-hongkong）'],
	['ap-singapore', '新加坡（ap-singapore）'],
	['ap-jakarta', '雅加达（ap-jakarta）'],
	['ap-seoul', '首尔（ap-seoul）'],
	['ap-bangkok', '曼谷（ap-bangkok）'],
	['ap-tokyo', '东京（ap-tokyo）'],
	['ap-mumbai', '孟买（ap-mumbai）'],
	['me-saudi-arabia', '沙特阿拉伯（me-saudi-arabia）'],
	['na-siliconvalley', '硅谷（na-siliconvalley）'],
	['na-ashburn', '弗吉尼亚（na-ashburn）'],
	['sa-saopaulo', '圣保罗（sa-saopaulo）'],
	['eu-frankfurt', '法兰克福（eu-frankfurt）'],
];

const SECONDS_PER_DAY = 24 * 60 * 60;

const EXPIRATION_OPTIONS: ReadonlyArray<readonly [days: number, label: string]> =
	[
		[1 * 30, '1个月'],
		[6 * 30, '半年'],
		[12 * 30, '1年'],
		[36 * 30, '3年'],
		[60 * 30, '5年'],
		[20 * 365, '20年'],
		[50 * 365, '50年'],
		[100 * 365, '永久'],
	];

/** 凭据变更后重建上传器的防抖时间 */
const REINIT_DEBOUNCE_MS = 2000;

export class TencentCosSettingTab extends PluginSettingTab {
	private readonly reinitUploader: () => void;

	constructor(
		app: App,
		private readonly plugin: TencentCosPlugin,
	) {
		super(app, plugin);
		this.reinitUploader = debounce(
			() => {
				void this.plugin.initUploader();
			},
			REINIT_DEBOUNCE_MS,
			true,
		);
	}



	override display(): void {
		const { containerEl } = this;
		containerEl.empty();

		this.addTextSetting({
			key: 'secretId',
			name: 'Secret Id',
			desc: '腾讯云 API 密钥 Secret Id',
			placeholder: '输入 Secret Id',
			reinitUploader: true,
		});
		this.addTextSetting({
			key: 'secretKey',
			name: 'Secret Key',
			desc: '腾讯云 API 密钥 Secret Key',
			placeholder: '输入 Secret Key',
			reinitUploader: true,
		});
		this.addTextSetting({
			key: 'bucket',
			name: 'Bucket',
			desc: 'COS 存储桶名称',
			placeholder: '例如：my-bucket-1250000000',
			reinitUploader: true,
		});
		this.addRegionSetting();
		this.addTextSetting({
			key: 'customDomain',
			name: '自定义域名',
			desc: '可选。生成链接时使用此域名，例如：https://img.example.com。若仅配置 HTTP，可填写 http://img.example.com；未写协议时默认 HTTPS。',
			placeholder: '例如：https://img.example.com',
			normalize: (value) => value.trim().replace(/\/+$/, ''),
		});
		this.addTextSetting({
			key: 'prefix',
			name: '存储路径前缀',
			desc: '设置文件在 COS 中的存储路径前缀，例如：images',
			placeholder: '例如：images',
			normalize: (value) => value.trim().replace(/^\/+|\/+$/g, ''),
		});
		this.addExpirationSetting();
		this.addToggleSetting({
			key: 'publicRead',
			name: '公有读存储桶',
			desc: '开启后使用干净的无签名URL（需将COS存储桶设置为公有读）。关闭则使用带签名的临时URL（更安全，但URL较长）',
			enabledNotice: '已开启公有读模式，请确保COS存储桶已设置为公有读权限',
		});
		this.addToggleSetting({
			key: 'enableCustomNaming',
			name: '启用规则图片命名',
			desc: '开启后按“上传命名模板”生成文件名与子目录；关闭则继续使用原有的时间戳命名。',
			enabledNotice: '已开启规则图片命名',
		});
		this.addTextSetting({
			key: 'namingPattern',
			name: '上传命名模板',
			desc: '支持子目录和变量：{year}、{month}/{mon}、{day}、{timestamp}、{notename}、{counter}、{random}、{filename}（含扩展名）、{basename}、{ext}。例如：{year}/{mon}/{day}/{filename} 或 {notename}-{counter}{ext}。',
			placeholder: '{notename}-{timestamp}-{counter}',
		});
		this.addToggleSetting({
			key: 'manualUploadMode',
			name: '手动上传模式',
			desc: '开启后，拖拽和粘贴只由 Obsidian 保存为本地附件；选中一个或多个本地链接后右键“上传附件到 COS”即可按需上传。',
		});
		this.addToggleSetting({
			key: 'deleteLocalAfterUpload',
			name: '上传后删除本地附件',
			desc: '开启后，本地图片或附件成功上传至 COS 并在笔记中替换为远程链接后，自动将本地对应的源文件移至废纸篓，避免占用本地存储空间。',
			enabledNotice: '已开启：上传成功后将安全删除本地附件',
		});
		this.addToggleSetting({
			key: 'enableFileUpload',
			name: '启用多格式文件上传',
			desc: '开启后，拖拽或粘贴非图片文件（如 PDF、MP3 等）时也会自动上传到 COS',
			enabledNotice: '已开启多格式文件上传',
		});
		this.addTextSetting({
			key: 'allowedFileExtensions',
			name: '允许的文件类型',
			desc: '非图片文件允许上传的扩展名，用英文逗号分隔',
			placeholder: 'pdf,mp3,mp4,wav,doc,docx,zip,mov,webm',
			normalize: (value) => value,
			multiline: true,
		});
		this.addTestConnectionSetting();
	}

	private addTextSetting(options: TextSettingOptions): void {
		const {
			key,
			name,
			desc,
			placeholder,
			normalize = (value: string) => value.trim(),
			reinitUploader = false,
			multiline = false,
		} = options;

		const onChange = async (value: string): Promise<void> => {
			this.plugin.settings[key] = normalize(value);
			await this.plugin.saveSettings();
			if (reinitUploader) this.reinitUploader();
		};

		const setting = new Setting(this.containerEl)
			.setName(name)
			.setDesc(desc);
		if (multiline) {
			setting.addTextArea((text) =>
				text
					.setPlaceholder(placeholder)
					.setValue(this.plugin.settings[key])
					.onChange(onChange),
			);
		} else {
			setting.addText((text) =>
				text
					.setPlaceholder(placeholder)
					.setValue(this.plugin.settings[key])
					.onChange(onChange),
			);
		}
	}

	private addToggleSetting(options: ToggleSettingOptions): void {
		const { key, name, desc, enabledNotice } = options;
		new Setting(this.containerEl)
			.setName(name)
			.setDesc(desc)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings[key])
					.onChange(async (value) => {
						this.plugin.settings[key] = value;
						await this.plugin.saveSettings();
						if (value && enabledNotice) new Notice(enabledNotice);
					}),
			);
	}

	private addRegionSetting(): void {
		new Setting(this.containerEl)
			.setName('Region')
			.setDesc('存储桶所在地域')
			.addDropdown((dropdown) => {
				for (const [value, label] of REGIONS) {
					dropdown.addOption(value, label);
				}
				dropdown
					.setValue(this.plugin.settings.region)
					.onChange(async (value) => {
						this.plugin.settings.region = value.trim();
						await this.plugin.saveSettings();
					});
			});
	}

	private addExpirationSetting(): void {
		new Setting(this.containerEl)
			.setName('图片有效期')
			.setDesc('设置图片链接的有效期')
			.addDropdown((dropdown) => {
				for (const [days, label] of EXPIRATION_OPTIONS) {
					dropdown.addOption(String(days * SECONDS_PER_DAY), label);
				}
				dropdown
					.setValue(String(this.plugin.settings.expiration))
					.onChange(async (value) => {
						const seconds = parseInt(value, 10);
						if (Number.isNaN(seconds) || seconds <= 0) {
							new Notice('请选择有效的时间选项');
							return;
						}
						this.plugin.settings.expiration = seconds;
						await this.plugin.saveSettings();
					});
			});
	}

	private isTesting = false;

	private async testConnection(button?: { setDisabled: (d: boolean) => unknown; setButtonText: (t: string) => unknown }): Promise<void> {
		if (this.isTesting) return;
		this.isTesting = true;
		button?.setDisabled(true);
		button?.setButtonText('测试中...');

		try {
			let { uploader } = this.plugin;
			if (!uploader) {
				await this.plugin.initUploader({ silent: false });
				uploader = this.plugin.uploader;
			}
			if (!uploader) {
				new Notice('请先配置COS设置');
				return;
			}
			new Notice(
				(await uploader.testConnection())
					? 'COS连接测试成功！'
					: 'COS连接测试失败，请检查控制台日志',
			);
		} finally {
			this.isTesting = false;
			button?.setDisabled(false);
			button?.setButtonText('测试连接');
		}
	}

	private addTestConnectionSetting(): void {
		new Setting(this.containerEl)
			.setName('测试上传')
			.setDesc('测试COS连接和上传功能')
			.addButton((button) => {
				button.setButtonText('测试连接').onClick(() => {
					void this.testConnection(button);
				});
			});
	}
}
