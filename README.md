# dsh-client-ui-peak-valley

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.1.1-blue.svg)](package.json)
[![DSH Plugin](https://img.shields.io/badge/dsh-plugin-8A2BE2.svg)](https://github.com/topics/dsh-plugin)

DSH(DeepSeek Harness)Web 客户端插件:在对话框**模型选择按钮左侧**显示当前 DeepSeek API 的**峰/谷价**状态。

- 🟢 绿色方块 + 「谷价」:空闲时段
- 🟠 橙色方块 + 「峰价」:高峰时段

判定规则(与官方定价一致):高峰时段为北京时间 **09:00–12:00、14:00–18:00**,其余为空闲(谷)时段。按 `Asia/Shanghai` 时区计算,不依赖浏览器本地时区;每 30 秒自动刷新,跨时段自动切换。

**显示条件**:当前会话选中的**模型 id 含 `deepseek`**(不区分大小写)就显示,**不区分提供方**。判断依据:

- 经会话投影 `modelSelection`(`next ?? lastUsed`)取当前模型 id,命中子串 `deepseek` 即显示;
- `provider`(官方 `deepseek-official`、`opencode-go`、`commandcode`、其他中转或自定义 provider)与 `baseURL` 均不参与判定。

因此 `deepseek-chat`、`deepseek-reasoner` 以及中转网关常见的 `厂商/模型` 形式(如 `deepseek/deepseek-v4.1-flash`)都会显示。反过来,若某 provider 在模型目录里给 DeepSeek 取了不含 `deepseek` 的别名(如 `ds-v3`),或选中的是非 DeepSeek 模型(如 `minimax-m3`),则不显示。

## 安装

本包是**组合包(bundle)**:注册行(`id: peak-valley`)随包发布在包内 `cordis.patch.yml` 里,
宿主按 profile `package.json` 的 `dsh.profile.bundles` 加载 —— **不需要**再往 profile 的
`cordis.patch.yml` 里贴任何 `- insert:` 行。

在 profile 目录(如 `~/.dsh/profiles/desktop/`)下执行:

```powershell
dshpm add file:./plugins/dsh-client-ui-peak-valley --profile desktop
```

`dshpm` 是替代 `dsh plugin add` 的装卸 CLI,装包的同时会把包名写进 `dsh.profile.bundles`。
装完重启 dsh,刷新页面后生效。

- **启停**:插件页 →「已安装」区里本卡的总开关(写 `dsh.profile.bundles`);
  点开卡片后每一行还有行级开关(向 profile 的 `cordis.patch.yml` 写 `disabled` 覆盖 ——
  profile 层在包层之后应用,所以覆写优先)。
- **卸载**:`dshpm remove dsh-client-ui-peak-valley --profile desktop`。
  ⚠ 若 profile 的 pnpm 带供应链策略,`pnpm remove` 会报
  `ERR_PNPM_RESOLUTION_POLICY_VIOLATIONS_UNHANDLED`;绕过办法是进 profile 目录直接跑
  `pnpm remove dsh-client-ui-peak-valley --config.minimum-release-age=0`
  (dshpm 的 `--fast` 只对 `add` 有效 —— `pnpm remove` 不接受 `--minimum-release-age` 这类参数)。
- 发布路径不变:从 npm registry / GitHub 装(`github:liuyun847/dsh-client-ui-peak-valley`
  或 `^0.1.1`)时,同样只要包名在 `dsh.profile.bundles` 里,注册行由包内 `cordis.patch.yml` 提供。

## 工作原理

- 通过 `dsh.client` 声明(见 `package.json`)注册为浏览器端插件。
- 在 `conversation.input.right` 座位注册 UI——该座位恰好渲染在模型选择按钮(`conversation.input.model`)的左侧,不替换任何原生 UI。
- 当前模型来自标准 props 的 `useProjection('modelSelection')`(投影的 `next ?? lastUsed`),模型切换即时重新判定;仅依赖 `slots` 服务(`inject = ['slots']`)。
- 颜色使用主题 token(`--dsw-alias-state-success-primary` / `--dsw-alias-state-warn-primary`),自动适配浅色/深色主题。

## 开发

```bash
# 本地直接安装依赖后即可开发
pnpm install
# ⚠ 真正被加载的是 node_modules\dsh-client-ui-peak-valley\ 那份。本包形态**逐文件不同**,
#   别一概而论(2026-09-26 实测 fileId):`lib/index.js`、`LICENSE` 与源码**同 inode 是硬链接**
#   ⇒ 原地改即两侧生效;`README.md`、`package.json`、`cordis.patch.yml`、`lib/client.js`
#   是**独立拷贝** ⇒ 改完必须同步过去(dshpm remove + add,或手动复制并比对 SHA256),否则等于没改;
#   `.gitignore` 不在 files 白名单、不进副本,副本里那份是旧残留,不必同步。⚠ `write`/`edit` 这类"写临时文件再改名"的写入会**打断硬链接**,
#   被它改过的文件此后就是独立拷贝,同样必须同步。
# 修改 lib/client.js 后:宿主 client-hmr 会按 500ms 轮询客户端 bundle,
# 内容哈希变化即通过 SSE 让浏览器自动重载该插件(无需重启 DSH——桌面端:关掉再打开 DeepSeek Harness 窗口)。
# 若改了 package.json 的 dsh 声明,则需重新安装/重启。
# 改包内 cordis.patch.yml(属拷贝文件,按上面的拷贝同步方式同步到副本)属**包层 patch**:
#   不需要重启,但它不会自己触发重组合 —— dsh-hmr 只监视 profile 的 cordis.patch.yml、
#   home 层 cordis.patch.yml 与 profile 的 package.json 三个输入(dsh-hmr/lib/index.js:353-376),
#   包内文件不在其中;重组合时会重读全部 bundle 层,所以改完要在插件页点一下本卡
#   (或任意行级)开关、或保存 profile patch 的任意一处改动才会被读入。
```

## License

MIT
