# dsh-client-ui-peak-valley

DSH(DeepSeek Harness)Web 客户端插件:在对话框**模型选择按钮左侧**显示当前 DeepSeek API 的**峰/谷价**状态。

- 🟢 绿色方块 + 「谷价」:空闲时段
- 🟠 橙色方块 + 「峰价」:高峰时段

判定规则(与官方定价一致):高峰时段为北京时间 **09:00–12:00、14:00–18:00**,其余为空闲(谷)时段。按 `Asia/Shanghai` 时区计算,不依赖浏览器本地时区;每 30 秒自动刷新,跨时段自动切换。

## 安装

在 DSH profile 目录(例如 `~/.dsh/profiles/web/`)下:

1. 添加依赖:

   ```jsonc
   // package.json
   {
     "dependencies": {
       "dsh-client-ui-peak-valley": "github:<你的用户名>/dsh-client-ui-peak-valley"
     }
   }
   ```

   然后 `pnpm install`(或 `npm install`)。

2. 在 `cordis.patch.yml` 中注册插件行:

   ```yaml
   - insert:
       - id: peak-valley
         name: 'dsh-client-ui-peak-valley'
   ```

3. 重启 `dsh web`,刷新页面后生效。

> 也可以先 `npm publish` 发布到 npm registry,再把依赖改为 `"dsh-client-ui-peak-valley": "^0.1.0"`。

## 工作原理

- 通过 `dsh.client` 声明(见 `package.json`)注册为浏览器端插件。
- 在 `conversation.input.right` 座位注册 UI——该座位恰好渲染在模型选择按钮(`conversation.input.model`)的左侧,不替换任何原生 UI。
- 颜色使用主题 token(`--dsw-alias-state-success-primary` / `--dsw-alias-state-warn-primary`),自动适配浅色/深色主题。

## 开发

```bash
# 本地直接安装依赖后即可开发
pnpm install
# 修改 lib/client.js 后,按上述安装方式重新安装/重启生效
```

## License

MIT
