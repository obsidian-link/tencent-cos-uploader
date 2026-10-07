/**
 * `obsidian` 运行时的最小 mock：只实现被插件源码在 import 阶段或被测路径用到的部分。
 */
import { vi } from 'vitest';

export const Platform = { isDesktop: true, isMobile: false };

/** 记录所有 Notice 文本，便于断言 */
export class Notice {
	static messages: string[] = [];
	static reset(): void {
		Notice.messages = [];
	}
	constructor(public readonly message: string) {
		Notice.messages.push(message);
	}
}

export class TFile {
	path = '';
	name = '';
	basename = '';
	extension = '';
	parent: { path: string } | null = null;
}

export class MarkdownView {}

export const requestUrl = vi.fn();

export const debounce = <T extends unknown[]>(
	callback: (...args: T) => unknown,
) => callback;

export class Plugin {
	constructor(
		public app: unknown,
		public manifest: unknown,
	) {}
	registerEvent = vi.fn();
	registerDomEvent = vi.fn();
	registerMarkdownPostProcessor = vi.fn();
	addCommand = vi.fn();
	addSettingTab = vi.fn();
	loadData = vi.fn(() => Promise.resolve(null));
	saveData = vi.fn(() => Promise.resolve());
}

export class PluginSettingTab {
	containerEl = { empty: vi.fn() };
	constructor(
		public app: unknown,
		public plugin: unknown,
	) {}
}

type Callback<T> = (value: T) => unknown;

export class FakeTextComponent {
	placeholder = '';
	value = '';
	changeHandler: Callback<string> | null = null;
	setPlaceholder(placeholder: string): this {
		this.placeholder = placeholder;
		return this;
	}
	setValue(value: string): this {
		this.value = value;
		return this;
	}
	onChange(handler: Callback<string>): this {
		this.changeHandler = handler;
		return this;
	}
}

export class FakeToggleComponent {
	value = false;
	changeHandler: Callback<boolean> | null = null;
	setValue(value: boolean): this {
		this.value = value;
		return this;
	}
	onChange(handler: Callback<boolean>): this {
		this.changeHandler = handler;
		return this;
	}
}

export class FakeDropdownComponent {
	options = new Map<string, string>();
	value = '';
	changeHandler: Callback<string> | null = null;
	addOption(value: string, label: string): this {
		this.options.set(value, label);
		return this;
	}
	setValue(value: string): this {
		this.value = value;
		return this;
	}
	onChange(handler: Callback<string>): this {
		this.changeHandler = handler;
		return this;
	}
}

export class FakeButtonComponent {
	text = '';
	disabled = false;
	clickHandler: (() => unknown) | null = null;
	setButtonText(text: string): this {
		this.text = text;
		return this;
	}
	setDisabled(disabled: boolean): this {
		this.disabled = disabled;
		return this;
	}
	onClick(handler: () => unknown): this {
		this.clickHandler = handler;
		return this;
	}
}

/** 记录每个 Setting 及其子组件，便于在测试中驱动 onChange / onClick */
export class Setting {
	static instances: Setting[] = [];
	name = '';
	desc = '';
	text: FakeTextComponent | null = null;
	textArea: FakeTextComponent | null = null;
	toggle: FakeToggleComponent | null = null;
	dropdown: FakeDropdownComponent | null = null;
	button: FakeButtonComponent | null = null;

	constructor(public readonly containerEl: unknown) {
		Setting.instances.push(this);
	}
	setName(name: string): this {
		this.name = name;
		return this;
	}
	setDesc(desc: string): this {
		this.desc = desc;
		return this;
	}
	addText(build: Callback<FakeTextComponent>): this {
		this.text = new FakeTextComponent();
		build(this.text);
		return this;
	}
	addTextArea(build: Callback<FakeTextComponent>): this {
		this.textArea = new FakeTextComponent();
		build(this.textArea);
		return this;
	}
	addToggle(build: Callback<FakeToggleComponent>): this {
		this.toggle = new FakeToggleComponent();
		build(this.toggle);
		return this;
	}
	addDropdown(build: Callback<FakeDropdownComponent>): this {
		this.dropdown = new FakeDropdownComponent();
		build(this.dropdown);
		return this;
	}
	addButton(build: Callback<FakeButtonComponent>): this {
		this.button = new FakeButtonComponent();
		build(this.button);
		return this;
	}
}

export class ButtonComponent {
	static instances: ButtonComponent[] = [];
	text = '';
	cta = false;
	clickHandler: (() => void) | null = null;
	constructor(public readonly containerEl: unknown) {
		ButtonComponent.instances.push(this);
	}
	setButtonText(text: string): this {
		this.text = text;
		return this;
	}
	setCta(): this {
		this.cta = true;
		return this;
	}
	onClick(handler: () => void): this {
		this.clickHandler = handler;
		return this;
	}
}

export class Modal {
	static lastInstance: Modal | null = null;
	contentEl = {
		empty: vi.fn(),
		createEl: vi.fn(),
		createDiv: vi.fn(() => ({})),
	};
	constructor(public app: unknown) {}
	open(): void {
		Modal.lastInstance = this;
		(this as unknown as { onOpen(): void }).onOpen();
	}
	close(): void {
		(this as unknown as { onClose(): void }).onClose();
	}
}
