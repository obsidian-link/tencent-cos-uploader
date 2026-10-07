import { MarkdownView, Notice, type Plugin } from 'obsidian';
import {
	extractImageInfo,
	isMatchingImageByFilename,
	isMatchingImageByUrl,
	type ImageInfo,
} from './image-matching';

const MIN_IMAGE_WIDTH = 50;
/** 鼠标移动超过该像素才视为拖拽，避免误触 */
const DRAG_THRESHOLD_PX = 5;
const TOOLTIP_ID = 'image-resize-tooltip';
const RESIZE_CURSOR = 'ew-resize';
const RESIZE_ENABLED_ATTR = 'data-resize-enabled';

/** 待写回源码的一次替换 */
interface TextReplacement {
	from: number;
	length: number;
	text: string;
}

/**
 * 拖拽缩放图片，并把最终宽度写回 Markdown 源码：
 * - Markdown 图片：`![alt*宽度](url)`
 * - Wiki 图片：`![[name|宽度]]`
 */
export class ImageResizer {
	constructor(private readonly plugin: Plugin) {}

	register(): void {
		const { plugin } = this;

		plugin.registerDomEvent(document, 'mousedown', (event) => {
			const target = event.target;
			if (!(target instanceof HTMLImageElement)) return;
			const inEditableArea =
				target.closest('.markdown-preview-view') ??
				target.closest('.markdown-source-view');
			if (inEditableArea) this.startResize(event, target);
		});

		plugin.registerEvent(
			plugin.app.workspace.on('active-leaf-change', () => {
				this.attachResizeHandlers();
			}),
		);
		this.attachResizeHandlers();
	}

	/** 为当前视图中尚未处理的图片绑定缩放手柄（延迟等待 DOM 渲染） */
	private attachResizeHandlers(): void {
		const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return;

		window.setTimeout(() => {
			view.containerEl.querySelectorAll('img').forEach((img) => {
				if (img.hasAttribute(RESIZE_ENABLED_ATTR)) return;
				img.setAttribute(RESIZE_ENABLED_ATTR, 'true');
				img.setCssStyles({ cursor: RESIZE_CURSOR });
				img.addEventListener('mousedown', (event) => {
					event.preventDefault();
					this.startResize(event, img);
				});
			});
		}, 100);
	}

	private startResize(event: MouseEvent, img: HTMLImageElement): void {
		event.preventDefault();
		event.stopPropagation();

		const startX = event.clientX;
		const startWidth = img.offsetWidth;
		let dragging = false;

		const onMouseMove = (moveEvent: MouseEvent): void => {
			if (!dragging && Math.abs(moveEvent.clientX - startX) > DRAG_THRESHOLD_PX) {
				dragging = true;
				img.setCssStyles({ cursor: RESIZE_CURSOR });
				document.body.setCssStyles({ cursor: RESIZE_CURSOR });
			}
			if (!dragging) return;

			const width = Math.max(
				MIN_IMAGE_WIDTH,
				startWidth + (moveEvent.clientX - startX),
			);
			img.setCssStyles({ width: `${width}px`, height: 'auto' });
			this.showTooltip(moveEvent.clientX, moveEvent.clientY, Math.round(width));
		};

		const onMouseUp = (): void => {
			document.removeEventListener('mousemove', onMouseMove);
			document.removeEventListener('mouseup', onMouseUp);
			document.body.setCssStyles({ cursor: '' });
			this.hideTooltip();
			if (!dragging) return;

			img.setCssStyles({ cursor: RESIZE_CURSOR });
			this.writeWidthToSource(img);
		};

		document.addEventListener('mousemove', onMouseMove);
		document.addEventListener('mouseup', onMouseUp);
	}

	private showTooltip(x: number, y: number, width: number): void {
		let tooltip = document.getElementById(TOOLTIP_ID);
		if (!tooltip) {
			tooltip = createDiv({
				cls: TOOLTIP_ID,
				attr: { id: TOOLTIP_ID },
			});
			tooltip.setCssStyles({
				position: 'fixed',
				background: 'var(--background-primary)',
				border: '1px solid var(--background-modifier-border)',
				borderRadius: '4px',
				padding: '4px 8px',
				fontSize: '12px',
				zIndex: '10000',
				pointerEvents: 'none',
				boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
			});
			document.body.appendChild(tooltip);
		}
		tooltip.textContent = `${width}px`;
		tooltip.setCssStyles({
			left: `${x + 10}px`,
			top: `${y - 30}px`,
			display: 'block',
		});
	}

	private hideTooltip(): void {
		document.getElementById(TOOLTIP_ID)?.setCssStyles({ display: 'none' });
	}

	/** 在源码中找到与 `img` 对应的图片引用，并写入新宽度 */
	private writeWidthToSource(img: HTMLImageElement): void {
		const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return;

		const { editor } = view;
		const info = extractImageInfo(img.src);
		if (!info) {
			new Notice('无法识别图片信息');
			return;
		}

		const width = Math.round(img.offsetWidth);
		const content = editor.getValue();
		const replacement =
			this.findMarkdownImage(content, img.src, info, width) ??
			this.findWikiImage(content, info, width);

		if (!replacement) {
			new Notice('未能更新图片大小到 Markdown 源码');
			return;
		}

		const from = editor.offsetToPos(replacement.from);
		const to = editor.offsetToPos(replacement.from + replacement.length);
		editor.replaceRange(replacement.text, from, to);
		editor.setCursor(from);
		new Notice(`图片大小已调整为 ${width}px`);
	}

	private findMarkdownImage(
		content: string,
		imgSrc: string,
		info: ImageInfo,
		width: number,
	): TextReplacement | null {
		for (const match of content.matchAll(/!\[([^\]]*?)\]\(([^)]+)\)/g)) {
			const [raw, alt = '', url = ''] = match;
			if (!isMatchingImageByUrl(url, imgSrc, info)) continue;

			const cleanAlt = alt.replace(/\*\d+$/, '').trim();
			return {
				from: match.index,
				length: raw.length,
				text: `![${cleanAlt}*${width}](${url})`,
			};
		}
		return null;
	}

	private findWikiImage(
		content: string,
		info: ImageInfo,
		width: number,
	): TextReplacement | null {
		for (const match of content.matchAll(
			/!\[\[([^\]]+?)(?:\|[^\]]+)?\]\]/g,
		)) {
			const name = (match[1] ?? '').split('|')[0] ?? '';
			if (!isMatchingImageByFilename(name, info)) continue;

			return {
				from: match.index,
				length: match[0].length,
				text: `![[${name}|${width}]]`,
			};
		}
		return null;
	}
}
