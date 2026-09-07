// 浏览器端插件主体:在对话框模型选择按钮左侧显示 DeepSeek API 峰/谷价状态。
// 仅当当前会话使用 DeepSeek 系列模型(模型 id 以 deepseek- 开头)且来源为
// 官方适配器(deepseek-official,baseURL 未改配)或 opencode-go 网关时才显示。
// 格式遵循 DSH 客户端插件契约:window.__ModuleLoader__.load + 具名导出 apply/inject。
//
// 适配 DSH 0.1.2-alpha.3:
//  - 会话当前模型改为标准 props 的 useProjection('modelSelection')(投影的
//    next ?? lastUsed 是权威来源,替代已移除的 connection.api.sessions.models);
//  - baseURL 检查改用 ctx.remote.settings.describe()(替代已移除的
//    connection.api.settings.describe;remote 服务经 inject 注入);
//  - 组件不再依赖 connection 服务,注入面收窄为 remote。
window.__ModuleLoader__.load({
  id: "dsh-client-ui-peak-valley",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    var react = require("react");

    // ── 峰/谷判定(DeepSeek 官方定价时段)──────────────────────────────
    // 高峰时段:北京时间 09:00-12:00、14:00-18:00;其余为空闲(谷)时段。
    var PEAK_RANGES = [
      [9 * 60, 12 * 60],
      [14 * 60, 18 * 60],
    ];

    // 官方 DeepSeek 适配器注册的 provider 路由 id(见 @deepseek-ai/dsh-llm-deepseek)。
    var OFFICIAL_PROVIDER = "deepseek-official";
    // opencode-go 网关 provider(自定义 DeepSeek 中转来源,同样按官方峰谷时段显示)。
    var OPENCODE_GO_PROVIDER = "opencode-go";
    // 官方 API 源(默认地址;用户显式改配为非官方地址时视为非官方)。
    var OFFICIAL_BASE_URL = "https://api.deepseek.com";

    // 取指定时刻的北京时间(分钟数),不依赖浏览器本地时区。
    function beijingMinutes(date) {
      var parts = new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        hour: "numeric",
        minute: "numeric",
        hour12: false,
      }).formatToParts(date);
      var hour = 0;
      var minute = 0;
      for (var i = 0; i < parts.length; i++) {
        var part = parts[i];
        if (part.type === "hour") hour = Number(part.value) % 24;
        else if (part.type === "minute") minute = Number(part.value);
      }
      return hour * 60 + minute;
    }

    function isPeak(date) {
      var mins = beijingMinutes(date);
      for (var i = 0; i < PEAK_RANGES.length; i++) {
        var range = PEAK_RANGES[i];
        if (mins >= range[0] && mins < range[1]) return true;
      }
      return false;
    }

    // ── 样式注入(带 data-plugin 标记,便于 HMR 清理,与官方包一致)──────
    var CSS = [
      ".pv-indicator{display:inline-flex;align-items:center;gap:5px;font-size:12px;line-height:1;color:var(--dsw-alias-label-secondary);white-space:nowrap;padding:0 6px}",
      ".pv-dot{width:9px;height:9px;border-radius:2px;flex:none}",
      ".pv-dot--valley{background:var(--dsw-alias-state-success-primary)}",
      ".pv-dot--peak{background:var(--dsw-alias-state-warn-primary)}",
    ].join("");

    var TAG_ID = "dsh-client-ui-peak-valley/peak-valley.css";
    if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(TAG_ID) + "]") === null) {
      var tag = document.createElement("style");
      tag.dataset.plugin = "dsh-client-ui-peak-valley";
      tag.dataset.pluginCss = TAG_ID;
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    // ── 组件 ────────────────────────────────────────────────────────
    // props 由 register 注入:标准 props 提供 sessionId/useProjection,
    // 业务 inject 提供 remote(alpha.3 的远程服务面)。
    function PeakValleyIndicator(props) {
      var sessionId = props.sessionId;
      var remote = props.remote;
      // useProjection 是标准 keyed hook,必须在组件渲染顶层调用(React Hooks
      // 规则:不能在 useEffect 回调/Promise 内调用,否则抛 Invalid hook call)。
      // 返回 modelSelection 投影({ lastUsed, next })或 undefined(能力缺失)。
      var projected = props.useProjection === undefined
        ? undefined
        : props.useProjection("modelSelection");
      // 权威会话模型选择:投影的 next(未消费的最近选择)回退 lastUsed(最近
      // 一次实际使用);两者皆缺则视为无法判定。
      var current = projected == null ? undefined : (projected.next ?? projected.lastUsed);
      // 投影值变化 → 依赖键变化 → effect 重跑,模型切换即时重新判定,
      // 不必等 30 秒轮询兜底。
      var modelKey = current == null ? "" : current.provider + "/" + current.model;
      // status: { visible: boolean, peak: boolean }
      var status = react.useState({ visible: false, peak: isPeak(new Date()) });
      var setStatus = status[1];

      react.useEffect(function () {
        var alive = true;

        // 判断当前会话是否使用 DeepSeek 官方模型 + 官方 API 源。
        // current 由顶层投影快照算出(effect 闭包捕获,modelKey 变化时重跑)。
        // 返回 true 才允许显示峰/谷价指示。
        function isOfficialSource() {
          return new Promise(function (resolve) {
            if (current == null || typeof current.model !== "string" || !current.model.startsWith("deepseek-")) {
              resolve(false);
              return;
            }
            // opencode-go 网关来源:视为官方定价,直接显示(该网关无 baseURL 概念)。
            if (current.provider === OPENCODE_GO_PROVIDER) {
              resolve(true);
              return;
            }
            // 官方适配器来源:provider 路由必须是 deepseek-official。
            if (current.provider !== OFFICIAL_PROVIDER) {
              resolve(false);
              return;
            }
            // 官方源:未显式改配 baseURL,或 baseURL 仍为官方地址。
            // 注:DEEPSEEK_BASE_URL 环境变量覆盖(仅受信任层生效)不在此检查
            // 范围——与旧版行为一致,只认 settings 层配置。
            if (remote === undefined || remote.settings === undefined || remote.settings.describe === undefined) {
              resolve(true);
              return;
            }
            remote.settings
              .describe()
              .then(function (settingsRes) {
                // 失败/无 value 时保守降级为官方源(与旧行为一致,不掩盖错误)。
                if (!settingsRes || !settingsRes.ok || !settingsRes.value) return true;
                var namespaces = settingsRes.value.namespaces || [];
                for (var i = 0; i < namespaces.length; i++) {
                  if (namespaces[i].ns !== "llm-deepseek") continue;
                  var value = namespaces[i].value || {};
                  var baseURL = value.baseURL;
                  // 未配置 baseURL 视为官方默认;显式配成非官方地址则不算官方源。
                  return baseURL === undefined || baseURL === OFFICIAL_BASE_URL;
                }
                return true;
              })
              .catch(function () {
                return true;
              })
              .then(function (official) {
                resolve(official === true);
              });
          });
        }

        function refresh() {
          isOfficialSource().then(function (official) {
            if (!alive) return;
            setStatus({ visible: official, peak: isPeak(new Date()) });
          });
        }

        refresh();
        // 每 30 秒刷新一次,兼顾跨时段边界与 baseURL/源切换。
        var timer = setInterval(refresh, 30000);
        return function () {
          alive = false;
          clearInterval(timer);
        };
      }, [sessionId, modelKey]);

      if (!status[0].visible) return null;
      var peak = status[0].peak;
      return react.createElement(
        "div",
        {
          className: "pv-indicator",
          title: peak ? "高峰时段(09:00-12:00 / 14:00-18:00)" : "空闲时段(谷价)",
        },
        [
          react.createElement("span", {
            key: "dot",
            className: "pv-dot " + (peak ? "pv-dot--peak" : "pv-dot--valley"),
          }),
          react.createElement("span", { key: "label" }, peak ? "峰价" : "谷价"),
        ]
      );
    }

    // 插件依赖的服务:remote 提供 settings.describe(alpha.3 远程面)。
    // remote.settings 子命名空间须单独声明(与官方 ui-settings 一致),确保就绪。
    var inject = ["slots", "remote", "remote.settings"];

    function apply(ctx) {
      var slots = ctx.get("slots");
      if (slots === undefined) return;
      slots.inject("conversation.input.right", function () {
        return slots.register(
          {
            name: "conversation.input.right",
            id: "peak-valley-indicator",
            // 把 remote 服务注入组件 props(register 的业务注入面)。
            inject: function () {
              return { remote: ctx.get("remote") };
            },
          },
          PeakValleyIndicator
        );
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
