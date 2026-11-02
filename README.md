# 会话内查找 · DSH Session Find

在 [DSH（DeepSeek Harness）](https://github.com/deepseek-ai/deepseek-harness) 客户端里按 `Ctrl+F`，像记事本一样在当前会话中查找文本：输入即搜、显示「第几条 / 共几条」、逐条跳转，并在原位高亮全部命中。

```
 🔍  在当前会话中查找                    3/17    Aa   |ab|    ↑   ↓   ×
```

- **纯前端**：零运行时依赖，无网络请求，不上报任何数据
- **不侵入**：只读取已渲染的会话文本，不修改会话数据、不写其它组件的 DOM，高亮通过 CSS Custom Highlight API 叠加
- **贴合宿主**：颜色全部取自主题令牌，亮/暗主题自动适配；文案跟随客户端语言（中文 / English）
- **可拖拽**：默认停在窗口顶部居中，按住即可拖动，位置限制在窗口内，双击复位

> 社区插件，与 DeepSeek 官方无关。

---

## 功能

| 能力 | 说明 |
| --- | --- |
| 快捷键唤出 | `Ctrl+F`（macOS `⌘F`）打开查找条，再按一次聚焦并全选 |
| 边输边搜 | 90 ms 防抖，实时更新「当前 / 总数」 |
| 就地高亮 | 所有命中淡色标记，当前命中实色标记 |
| 逐条跳转 | `Enter` 下一个、`Shift+Enter` 上一个，到末尾自动环绕 |
| 区分大小写 | 工具行 `Aa` 开关 |
| 全字匹配 | 工具行 `\|ab\|` 开关 |
| 流式跟随 | 助手边输出边更新匹配数（250 ms 防抖），不会打断输入 |
| 拖动 / 复位 | 抓任意非控件区域拖动；双击回到顶部居中 |
| 无结果提示 | 计数区变红显示「无结果」 |
| 关闭 | `Esc` 或 `×`，同时清除全部高亮 |

---

## 安装

### 前置要求

- DSH 桌面版或 CLI，且已有一个 profile（默认位于 `~/.dsh/profiles/<name>`，Windows 为 `%USERPROFILE%\.dsh\profiles\<name>`）
- 无需 Node 构建流程：本插件是纯 JavaScript

### 方式 A：交给 DSH 助手安装（一次到位，推荐）

让 DSH 内的助手执行插件管理器工具的 `install_bundle`，`target` 指向本目录的绝对路径：

```
plugin_manager  action=install_bundle  target=D:\path\to\session-find
```

它会完成两件事：把包安装进 profile，并把 bundle 加入 profile 的启用列表。返回 `"application": "applied"` 即已在运行中的客户端激活。

### 方式 B：命令行安装依赖 + 界面启用

```powershell
dsh plugin --profile desktop add "D:\path\to\session-find"
```

注意：`dsh plugin` 只把参数转发给 pnpm，**只装了依赖、不会自动启用**。之后需在 **设置 → 插件** 里打开该 bundle（或让助手调用插件管理器的 `set_bundle`）。

### 方式 C：手工改 profile（便于理解安装结果）

编辑 `~/.dsh/profiles/<name>/package.json`：

```json
{
  "dependencies": {
    "@local/dsh-session-find": "link:C:/Users/you/dsh-plugins/session-find"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "@local/dsh-session-find"
      ]
    }
  }
}
```

`bundles` 的顺序有意义：本插件必须排在基础应用 bundle（`dsh-base` / `dsh-web-app`）之后。改完执行 `dsh plugin --profile <name> install` 或直接重启应用。

### 安装后

客户端插件模块是在**窗口启动时**加载的。安装完成后如果没看到效果，刷新窗口（`Ctrl+R`，缓存未更新时 `Ctrl+Shift+R`）或重启应用一次即可；之后长期常驻，不需要保持任何浏览器页面打开。

**验证**：设置 → 插件 中应出现「会话内查找」（含图标与描述）；在任意会话里按 `Ctrl+F` 应弹出查找条。

### 卸载

在 设置 → 插件 中停用/移除，或让助手调用插件管理器 `remove_bundle`，目标 `@local/dsh-session-find`。

---

## 使用

1. 打开任意有内容的会话，按 `Ctrl+F`。
2. 输入关键词，命中数立即出现在输入框右侧。
3. `Enter` 逐个向下、`Shift+Enter` 逐个向上；也可点工具行的 ↑ / ↓。
4. 需要精确匹配时打开 `Aa`（区分大小写）或 `|ab|`（全字匹配）。
5. `Esc` 关闭。

**关于拖动**：拖动后位置在本次运行内保留（关闭再打开仍在原处），重启应用回到顶部居中。双击查找条空白处可立即复位。

---

## 工作原理

会话界面由宿主渲染，插件只做两件事：**在合适的槽位画一条查找条**，以及**扫描已渲染的文本并叠加高亮**。

```
┌────────────── 客户端（浏览器 / 桌面窗口）──────────────┐
│  client.js                                             │
│    ├─ ctx.slots.inject('shell.overlay') → 查找条 UI    │
│    ├─ window keydown (capture) → Ctrl+F / Esc          │
│    ├─ 定位搜索区域 → TreeWalker 收集文本节点 → 匹配    │
│    └─ CSS.highlights 叠加 Range → 滚动到当前命中       │
└────────────────────────────────────────────────────────┘
┌────────────── Host（Node 进程）────────────────────────┐
│  index.js → apply() {}  // 仅作为可激活的插件行存在    │
└────────────────────────────────────────────────────────┘
```

1. **挂载**：客户端模块向 `shell.overlay`（全帧浮层，位于所有列之上、滚动容器之外）注册一个 `id: session-find` 的条目。该浮层本身是点击穿透的，查找条只在自己身上恢复指针事件。
2. **搜索区域**：不用脆弱的 class 选择器，而是用 `document.elementFromPoint()` 在内容列取样，向上取「占视口 30%–92% 面积」的最高祖先，即会话内容列（聊天区 + 标题）。取样失败时退回「面积最大的可滚动容器」。
3. **匹配**：`TreeWalker` 遍历文本节点，跳过 `input/textarea/button/script/style`、`contenteditable`（输入框）、隐藏元素以及查找条自身；逐节点 `indexOf` 收集命中，支持大小写与全字匹配。
4. **高亮**：用 `Range` 构造 `Highlight` 注册到 `CSS.highlights`，两组样式分别给「全部命中」与「当前命中」，用 `::highlight()` 上色。**不包裹、不替换任何会话 DOM**，关闭时整体删除。
5. **跟随**：查找条打开期间用 `MutationObserver`（250 ms 防抖）重扫，因此助手流式输出时计数会自动变化。
6. **兜底**：若启发的区域没有命中但整页存在该文本（例如某版本布局与启发式不符），自动放宽到全页搜索一次，避免误报「无结果」。

### 性能与上限

| 项 | 值 | 说明 |
| --- | --- | --- |
| 单次扫描文本上限 | 2,000,000 字符 | 超大会话不会被一次扫描拖住 |
| 命中上限 | 2,000 | 超出后停止收集，计数显示实际收集数 |
| 输入防抖 | 90 ms | 连续输入只扫最后一次 |
| 内容变更防抖 | 250 ms | 流式输出期间合并重扫 |

---

## 兼容性

- 需要 **Chromium 105+**：`CSS Custom Highlight API`（高亮）与 `Element.checkVisibility()`（可见性过滤）。DSH 桌面版内嵌的 Chromium 满足要求。
- 高亮不可用时**优雅降级**：计数、跳转、滚动照常，只是没有彩色标记。
- 已在 DSH `0.2.1-rc.3` 桌面版验证；插件只依赖 `shell.overlay` 槽位、`ctx.slots` 与 `locale` 服务这些稳定扩展点。
- 宿主快捷键 `Ctrl+F` 未被占用（DSH 自身用的是 `Ctrl+Alt+F` 做会话 fork），不存在抢占。

---

## 已知限制

- **只搜索已渲染的内容**：虚拟滚动未渲染的早期消息、折叠的工具详情、图片中的文字都不参与匹配。
- **匹配不跨文本节点**：如果一段文字被内联标记拆成多个节点（如 `foo**bar**`），跨节点命中会漏掉。
- **大小写不敏感模式下**极少数 Unicode（例如土耳其语 `İ`）在 `toLowerCase` 后长度变化，命中位置可能偏移一个字符。
- **位置不跨重启记忆**：拖动结果只保留在本次运行中（如需持久化，应走插件自己的存储服务，而不是 `localStorage`）。
- 未实现「方向：向上/向下」这类对话框语义，等价能力已由 `Shift+Enter` / ↑ 提供。

---

## 目录结构

```
session-find/
├── package.json         # bundle 清单：dsh.bundle.patch + dsh.client
├── cordis.patch.yml     # 在 profile 里插入 Host 插件行
├── index.js             # Host 半边（空实现，仅为拥有可激活的插件行）
├── client.js            # 客户端半边：查找条、扫描、高亮、拖拽
├── locale/
│   ├── en.json          # 插件管理页的英文标题与描述
│   └── zh.json          # 中文标题与描述
├── icon.svg             # 插件图标
├── README.md
└── LICENSE
```

关键清单字段：

```json
{
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web", "immediately": true }
  }
}
```

---

## 开发

无构建步骤：`client.js` 是一个由宿主模块加载器（`window.__ModuleLoader__.load`）载入的普通脚本，React 从模块表取得。

```powershell
# 语法校验（无需安装依赖）
node --check client.js

# 安装到本地 profile 调试
plugin_manager  action=install_bundle  target=<本目录绝对路径>
```

修改 `client.js` 后刷新窗口即可看到变化（包目录是被链接进 profile 的，改的就是生效的文件）。

调试建议：

- 查找条根节点带 `data-dsh-session-find` 属性，便于在 DevTools 里定位；
- 高亮注册在 `CSS.highlights` 的 `dsh-session-find-all` / `dsh-session-find-current` 两个键上，可在控制台直接检查；
- 若样式异常，先确认 `--dsw-alias-*` 主题令牌存在（见 DSH 的主题检查接口），不要写死颜色。

### 发布到 npm 前

- 去掉 `package.json` 的 `private: true`；
- `@local` 是占位作用域，需改成你自己的 scope（如 `@your-name/dsh-session-find`）；改名后 `cordis.patch.yml` 的 `name` 与客户端 `load({ id })` 都要同步，并重新安装；
- `files` 已包含运行所需文件，`README.md`、`LICENSE` 也在其中。

---

## 常见问题

**按 Ctrl+F 没反应？**
先确认窗口已加载新模块（刷新/重启一次）。若仍无反应，检查是否有其它插件或输入法抢占了该组合键；可临时改用界面上的入口（若你的宿主版本在插件页提供）。

**计数为 0，但屏幕上明明有这个字？**
多半是该内容尚未渲染（更早的历史、折叠块）。向上滚动加载后再试，或换更短的关键词。

**高亮不出现，但计数正常？**
内核低于 Chromium 105（无 `CSS.highlights`）。属于预期降级。

**和浏览器自带的查找冲突吗？**
不会：插件在捕获阶段拦截 `Ctrl+F` 并 `preventDefault()`，宿主与外层的原生查找不会被同时触发。

**会不会影响会话内容或上传数据？**
不会。插件只读已渲染文本，不发任何网络请求，也不写入会话事件。

---

## 许可

[MIT](LICENSE)。可自由使用、修改、分发；如需其它协议，替换 `LICENSE` 与 `package.json` 的 `license` 字段即可。

欢迎 Issue / PR。提交前请保持：无构建依赖、纯函数优先、注释解释「为什么」而非「做什么」。

---

## English

**DSH Session Find** — press `Ctrl+F` in a DSH session to search it like Notepad: live match counter, in-place highlighting, and next/previous navigation.

- Zero dependencies, no network requests, no session data is read or modified.
- Highlights are painted with the CSS Custom Highlight API, so no conversation DOM is touched.
- Bilingual UI (English / 中文) and automatic light/dark theming through `--dsw-alias-*` tokens.
- Draggable bar, top-centered by default, double-click to reset.

**Install** — either let the DSH assistant run `plugin_manager install_bundle` with this directory as `target`, or install the package into the profile with `dsh plugin --profile <name> add <path>` and enable the bundle in Settings → Plugins. The client module loads when the window boots, so reload once after installing.

**Shortcuts** — `Ctrl+F` open/focus · `Enter` next · `Shift+Enter` previous · `Esc` close · `Aa` match case · `|ab|` whole word.

**Limits** — only rendered content is searched; matches never span two text nodes; results are capped at 2,000 hits per 2 MB of scanned text.

MIT licensed.
