import { beforeEach, describe, expect, it, type Mock } from 'vitest';
import { ButtonComponent, Modal } from './mocks/obsidian';
import { confirmOperation } from '../src/modal';

const app = {} as never;

function buttons(): { cancel: ButtonComponent; confirm: ButtonComponent } {
	const [cancel, confirm] = ButtonComponent.instances;
	if (!cancel || !confirm) throw new Error('按钮未创建');
	return { cancel, confirm };
}

beforeEach(() => {
	ButtonComponent.instances = [];
	Modal.lastInstance = null;
});

describe('confirmOperation', () => {
	it('渲染标题、说明和两个按钮（确认按钮为主操作）', () => {
		void confirmOperation(app, '批量同步附件', '将扫描全部笔记');

		const modal = Modal.lastInstance as unknown as {
			contentEl: { createEl: Mock };
		};
		expect(modal.contentEl.createEl).toHaveBeenCalledWith('h2', { text: '批量同步附件' });
		expect(modal.contentEl.createEl).toHaveBeenCalledWith('p', { text: '将扫描全部笔记' });
		const { cancel, confirm } = buttons();
		expect([cancel.text, cancel.cta]).toEqual(['取消', false]);
		expect([confirm.text, confirm.cta]).toEqual(['确认执行', true]);
	});

	it('点击“确认执行”：返回 true', async () => {
		const result = confirmOperation(app, 't', 'm');

		buttons().confirm.clickHandler?.();

		await expect(result).resolves.toBe(true);
	});

	it('点击“取消”：返回 false', async () => {
		const result = confirmOperation(app, 't', 'm');

		buttons().cancel.clickHandler?.();

		await expect(result).resolves.toBe(false);
	});

	it('直接关闭（遮罩 / ESC）：视为取消', async () => {
		const result = confirmOperation(app, 't', 'm');

		Modal.lastInstance?.close();

		await expect(result).resolves.toBe(false);
	});

	it('结果只以第一次为准：确认后随之触发的 onClose 不会覆盖为 false', async () => {
		const result = confirmOperation(app, 't', 'm');

		buttons().confirm.clickHandler?.(); // 内部会 settle(true) 再 close() -> onClose

		await expect(result).resolves.toBe(true);
	});
});
