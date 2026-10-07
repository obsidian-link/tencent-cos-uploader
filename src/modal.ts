import { App, ButtonComponent, Modal } from 'obsidian';

/** 二次确认对话框；关闭（含点击遮罩 / ESC）视为取消 */
class ConfirmModal extends Modal {
	private settled = false;

	constructor(
		app: App,
		private readonly heading: string,
		private readonly message: string,
		private readonly onResult: (confirmed: boolean) => void,
	) {
		super(app);
	}

	override onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: this.heading });
		contentEl.createEl('p', { text: this.message });

		const buttons = contentEl.createDiv('delete-confirm-buttons');
		new ButtonComponent(buttons).setButtonText('取消').onClick(() => {
			this.settle(false);
			this.close();
		});
		new ButtonComponent(buttons)
			.setButtonText('确认执行')
			.setCta()
			.onClick(() => {
				this.settle(true);
				this.close();
			});
	}

	override onClose(): void {
		this.settle(false);
		this.contentEl.empty();
	}

	private settle(confirmed: boolean): void {
		if (this.settled) return;
		this.settled = true;
		this.onResult(confirmed);
	}
}

/** 弹出确认框并返回用户是否确认 */
export function confirmOperation(
	app: App,
	heading: string,
	message: string,
): Promise<boolean> {
	return new Promise<boolean>((resolve) => {
		new ConfirmModal(app, heading, message, resolve).open();
	});
}
