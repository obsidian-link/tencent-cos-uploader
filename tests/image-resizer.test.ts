// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageResizer } from '../src/image-resizer';
import { Notice } from './mocks/obsidian';

type Listener = (event: never) => void;

/** 记录挂在共享 document 上的监听，用例结束后统一移除，避免串扰 */
const documentCleanups: Array<() => void> = [];

interface FakeEditor {
	content: string;
	getValue: () => string;
	offsetToPos: (offset: number) => { line: number; ch: number };
	replaceRange: ReturnType<typeof vi.fn>;
	setCursor: ReturnType<typeof vi.fn>;
}

function createEditor(content: string): FakeEditor {
	return {
		content,
		getValue() {
			return this.content;
		},
		offsetToPos: (offset) => ({ line: 0, ch: offset }),
		replaceRange: vi.fn(),
		setCursor: vi.fn(),
	};
}

/** 搭建缩放器、假插件、Markdown 视图与一张图片 */
function setup(options: {
	content: string;
	src: string;
	initialWidth?: number;
	/** 注册时是否已有活动的 Markdown 视图，默认有 */
	hasActiveView?: boolean;
}) {
	const editor = createEditor(options.content);
	const container = document.createElement('div');
	container.className = 'markdown-source-view';
	document.body.appendChild(container);

	const img = document.createElement('img');
	img.src = options.src;
	container.appendChild(img);
	// jsdom 不做布局：用内联 width 模拟 offsetWidth
	let width = options.initialWidth ?? 200;
	Object.defineProperty(img, 'offsetWidth', { get: () => width });
	const originalSet = img.setCssStyles.bind(img);
	img.setCssStyles = (styles) => {
		originalSet(styles);
		if (styles.width) width = parseInt(styles.width, 10);
	};

	const leafListeners: Listener[] = [];
	const view = { containerEl: container, editor };
	const plugin = {
		app: {
			workspace: {
				getActiveViewOfType: vi.fn((): typeof view | null =>
					options.hasActiveView === false ? null : view,
				),
				on: vi.fn((_name: string, listener: Listener) => {
					leafListeners.push(listener);
					return {};
				}),
			},
		},
		registerDomEvent: vi.fn(
			(target: Document, type: string, listener: EventListener) => {
				target.addEventListener(type, listener);
				documentCleanups.push(() => target.removeEventListener(type, listener));
			},
		),
		registerEvent: vi.fn(),
	};

	const resizer = new ImageResizer(plugin as never);
	resizer.register();
	return { editor, container, img, plugin, view, leafListeners };
}

function mouse(type: string, clientX: number, clientY = 0): MouseEvent {
	return new MouseEvent(type, { clientX, clientY, bubbles: true, cancelable: true });
}

/** 模拟一次“按下 → 移动 → 松开”的拖拽 */
async function drag(img: HTMLElement, fromX: number, toX: number): Promise<void> {
	img.dispatchEvent(mouse('mousedown', fromX));
	document.dispatchEvent(mouse('mousemove', toX, 40));
	document.dispatchEvent(mouse('mouseup', toX));
	await Promise.resolve();
}

beforeEach(() => {
	// Obsidian 对 DOM 的扩展
	HTMLElement.prototype.setCssStyles = function (styles) {
		Object.assign(this.style, styles);
	};
	vi.stubGlobal('createDiv', (options?: { cls?: string; attr?: Record<string, string> }) => {
		const div = document.createElement('div');
		if (options?.cls) div.className = options.cls;
		for (const [key, value] of Object.entries(options?.attr ?? {})) {
			div.setAttribute(key, value);
		}
		return div;
	});
	document.body.replaceChildren();
	Notice.reset();
});

afterEach(() => {
	for (const cleanup of documentCleanups.splice(0)) cleanup();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('绑定缩放手柄', () => {
	it('延迟 100ms 后为图片启用缩放：光标样式与标记属性', () => {
		vi.useFakeTimers();
		const { img } = setup({ content: '', src: 'https://x.com/a.png' });
		expect(img.hasAttribute('data-resize-enabled')).toBe(false);

		vi.advanceTimersByTime(100);

		expect(img.getAttribute('data-resize-enabled')).toBe('true');
		expect(img.style.cursor).toBe('ew-resize');
	});

	it('切换标签页会再次扫描，但已启用的图片不会重复绑定', () => {
		vi.useFakeTimers();
		const { img, leafListeners } = setup({ content: '', src: 'https://x.com/a.png' });
		const spy = vi.spyOn(img, 'addEventListener');
		vi.advanceTimersByTime(100);
		const afterFirst = spy.mock.calls.length;

		leafListeners[0]?.(undefined as never);
		vi.advanceTimersByTime(100);

		expect(afterFirst).toBe(1);
		expect(spy.mock.calls.length).toBe(afterFirst);
	});

	it('没有活动 Markdown 视图时不处理', () => {
		vi.useFakeTimers();
		const { img } = setup({
			content: '',
			src: 'https://x.com/a.png',
			hasActiveView: false,
		});

		vi.advanceTimersByTime(100);

		expect(img.hasAttribute('data-resize-enabled')).toBe(false);
	});
});

describe('拖拽缩放并写回源码', () => {
	it('Markdown 图片：按拖拽距离计算宽度，并以 `*宽度` 写回 alt', async () => {
		const { img, editor } = setup({
			content: '前文\n![封面](https://x.com/a.png)\n后文',
			src: 'https://x.com/a.png',
			initialWidth: 200,
		});

		await drag(img, 100, 180); // +80

		expect(img.style.width).toBe('280px');
		const start = '前文\n'.length;
		expect(editor.replaceRange).toHaveBeenCalledWith(
			'![封面*280](https://x.com/a.png)',
			{ line: 0, ch: start },
			{ line: 0, ch: start + '![封面](https://x.com/a.png)'.length },
		);
		expect(editor.setCursor).toHaveBeenCalledWith({ line: 0, ch: start });
		expect(Notice.messages).toEqual(['图片大小已调整为 280px']);
	});

	it('已有 `*宽度` 的 alt 会被替换而不是叠加', async () => {
		const { img, editor } = setup({
			content: '![封面*150](https://x.com/a.png)',
			src: 'https://x.com/a.png',
		});

		await drag(img, 0, 50);

		expect(editor.replaceRange.mock.calls[0]?.[0]).toBe('![封面*250](https://x.com/a.png)');
	});

	it('Wiki 图片：以 `|宽度` 写回并保留原文件名', async () => {
		const { img, editor } = setup({
			content: '![[photo.png]]',
			src: 'app://obsidian.md/vault/photo.png?1700',
		});

		await drag(img, 0, 100);

		expect(editor.replaceRange.mock.calls[0]?.[0]).toBe('![[photo.png|300]]');
	});

	it('宽度不会小于 50px', async () => {
		const { img, editor } = setup({
			content: '![a](https://x.com/a.png)',
			src: 'https://x.com/a.png',
			initialWidth: 120,
		});

		await drag(img, 500, 0);

		expect(img.style.width).toBe('50px');
		expect(editor.replaceRange.mock.calls[0]?.[0]).toBe('![a*50](https://x.com/a.png)');
	});

	it('移动不超过 5px 视为点击：不改样式、不写源码', async () => {
		const { img, editor } = setup({
			content: '![a](https://x.com/a.png)',
			src: 'https://x.com/a.png',
		});

		await drag(img, 100, 104);

		expect(img.style.width).toBe('');
		expect(editor.replaceRange).not.toHaveBeenCalled();
	});

	it('源码中找不到对应图片：提示失败', async () => {
		const { img, editor } = setup({
			content: '![other](https://x.com/other.png)',
			src: 'https://x.com/a.png',
		});

		await drag(img, 0, 50);

		expect(editor.replaceRange).not.toHaveBeenCalled();
		expect(Notice.messages).toEqual(['未能更新图片大小到 Markdown 源码']);
	});

	it('无法识别 <img> 来源：提示失败', async () => {
		const { img, editor } = setup({ content: '![a](x)', src: 'http://' });

		await drag(img, 0, 50);

		expect(editor.replaceRange).not.toHaveBeenCalled();
		expect(Notice.messages).toEqual(['无法识别图片信息']);
	});

	it('存在多张图片时只修改与当前 <img> 匹配的那一张', async () => {
		const { img, editor } = setup({
			content: '![a](https://x.com/a.png)\n![b](https://x.com/b.png)',
			src: 'https://x.com/b.png',
		});

		await drag(img, 0, 10);

		const text = '![a](https://x.com/a.png)\n';
		expect(editor.replaceRange.mock.calls[0]?.[1]).toEqual({ line: 0, ch: text.length });
		expect(editor.replaceRange.mock.calls[0]?.[0]).toBe('![b*210](https://x.com/b.png)');
	});

	it('拖拽结束后恢复 body 光标并隐藏提示', async () => {
		const { img } = setup({ content: '![a](https://x.com/a.png)', src: 'https://x.com/a.png' });

		img.dispatchEvent(mouse('mousedown', 0));
		document.dispatchEvent(mouse('mousemove', 60, 20));
		const tooltip = document.getElementById('image-resize-tooltip');
		expect(tooltip?.textContent).toBe('260px');
		expect(tooltip?.style.display).toBe('block');
		expect(document.body.style.cursor).toBe('ew-resize');

		document.dispatchEvent(mouse('mouseup', 60));

		expect(tooltip?.style.display).toBe('none');
		expect(document.body.style.cursor).toBe('');
	});

	it('松开鼠标后移除全局监听，之后的移动不再影响图片', async () => {
		const { img } = setup({ content: '![a](https://x.com/a.png)', src: 'https://x.com/a.png' });
		await drag(img, 0, 100);
		const widthAfterDrag = img.style.width;

		document.dispatchEvent(mouse('mousemove', 500));

		expect(img.style.width).toBe(widthAfterDrag);
	});

	it('无活动视图时只缩放显示，不写源码也不报错', async () => {
		const { img, plugin } = setup({
			content: '![a](https://x.com/a.png)',
			src: 'https://x.com/a.png',
		});
		plugin.app.workspace.getActiveViewOfType.mockReturnValue(null);

		await expect(drag(img, 0, 50)).resolves.toBeUndefined();

		expect(Notice.messages).toEqual([]);
	});
});

describe('文档级 mousedown 兜底', () => {
	it('预览 / 源码视图内的图片会触发缩放', async () => {
		const { img, editor } = setup({
			content: '![a](https://x.com/a.png)',
			src: 'https://x.com/a.png',
		});
		// 此时尚未绑定手柄（未推进定时器），走文档级监听

		await drag(img, 0, 30);

		expect(editor.replaceRange).toHaveBeenCalledTimes(1);
	});

	it('视图之外的图片与非图片元素被忽略', async () => {
		const { editor } = setup({ content: '![a](https://x.com/a.png)', src: 'https://x.com/a.png' });
		const outside = document.createElement('img');
		outside.src = 'https://x.com/a.png';
		document.body.appendChild(outside);
		const div = document.createElement('div');
		document.body.appendChild(div);

		await drag(outside, 0, 50);
		await drag(div, 0, 50);

		expect(editor.replaceRange).not.toHaveBeenCalled();
	});
});
