# Tencent Cloud COS Uploader

[English](#english) | [中文说明](#中文说明)

---

<a id="english"></a>
## English

A lightweight and reliable Obsidian plugin to upload images and note attachments directly to **Tencent Cloud COS (Cloud Object Storage)**. Fully optimized for both Desktop and Mobile (iOS / Android).

### ✨ Features

- **Seamless Upload**: Paste or drag images and files into notes to automatically upload them to Tencent Cloud COS and insert Markdown links.
- **Batch Processing**:
  - Right-click any note: *Upload Local Attachments in Note to COS*.
  - Command palette: *Batch Upload Vault Attachments to COS* / *Batch Download COS Attachments to Local*.
- **Safe Local Cleanup**: Optionally move local attachments to system trash after successful upload to save local device storage.
- **Mobile Friendly**: Lightweight background uploading that avoids freezing Obsidian Mobile.
- **Smart Parsing**: Distinguishes real attachments from emojis and internal links, avoiding false errors.
- **Attachment Support**: Supports common images (`png`, `jpg`, `gif`, `webp`, etc.) as well as custom file formats (`pdf`, `mp4`, `mp3`, `zip`, etc.).
- **URL Expiration & Private Buckets**: Supports both public-read buckets and pre-signed temporary URLs for private buckets.

### 🚀 Getting Started

1. **Install**:
   - In Obsidian, go to **Settings** > **Community plugins** > **Browse**.
   - Search for **Tencent Cloud COS Uploader** and install it.
2. **Configure Tencent COS**:
   - Go to plugin settings and fill in your Tencent Cloud credentials:
     - **Secret ID** & **Secret Key** (from Tencent Cloud CAM Console)
     - **Bucket** (e.g., `my-vault-1250000000`)
     - **Region** (e.g., `ap-guangzhou`)
3. **Usage**:
   - Paste or drag any image into your note.
   - Or right-click a note to upload all existing local attachments at once.

---

<a id="中文说明"></a>
## 中文说明

一款专为 Obsidian 打造的腾讯云对象存储（Tencent Cloud COS）图床与附件上传插件。深度适配桌面端与移动端（iOS / Android），轻量稳定、告别卡死。

### ✨ 核心特性

- **无缝上传与链接替换**：截图粘贴、文件拖拽直接自动上传至腾讯云 COS，并自动替换为 Markdown 链接。
- **笔记附件批量处理**：
  - 笔记右键菜单：一键「上传笔记内本地附件到 COS」。
  - 命令面板：支持「批量上传库内附件到 COS」及「批量下载 COS 附件到本地」。
- **安全清理本地空间**：支持可选设置「上传后删除本地附件」，仅在附件上传成功并替换链接后，安全移入系统废纸篓，大幅节省移动端存储空间（双重防呆保护，绝不误删 Markdown 笔记）。
- **移动端深度优化**：移除了冗余监听与阻塞调用，解决手机版 Obsidian 上传时容易出现的卡死问题。
- **智能精准过滤**：自动识别并忽略文档中的 Emoji 表情及普通内部双链，杜绝上传报错与误报。
- **多类型附件支持**：除主流图片格式（`png`、`jpg`、`webp`、`svg` 等）外，支持自定义扩展名（如 `pdf`、`mp4`、`mp3`、`zip` 等文件）。
- **私有桶与公有读**：支持公有读存储桶直接访问，亦支持私有存储桶的签名防盗链与链接有效期刷新。

### 🚀 快速上手

1. **安装插件**：
   - 打开 Obsidian **设置** > **第三方插件** > **社区插件市场**。
   - 搜索 **Tencent Cloud COS Uploader** 点击安装并启用。
2. **配置腾讯云信息**：
   - 进入插件设置面板，填写腾讯云相关参数：
     - **Secret Id** 与 **Secret Key**（从腾讯云访问管理控制台获取）
     - **Bucket**（存储桶名称，如 `my-vault-1250000000`）
     - **Region**（所属地域，如 `ap-guangzhou`）
3. **日常使用**：
   - 像平常一样在笔记中粘贴截图或拖入图片，即可自动上传并生成云端链接。
   - 对已有本地附件的历史笔记，在文件树中右键该笔记，选择「上传笔记内本地附件到 COS」即可批量上云。

---

## 🛠️ 本地开发 (Development)

本项目采用官方标准模板结构开发与维护：

```bash
# 安装依赖
pnpm install

# 实时监听编译
pnpm run dev

# 生产环境打包
pnpm run build
```

## 📄 开源许可 (License)

[MIT License](LICENSE)
