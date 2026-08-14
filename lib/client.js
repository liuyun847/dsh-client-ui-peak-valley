// 浏览器端插件主体:在对话框模型选择按钮左侧显示 DeepSeek API 峰/谷价状态。
// 仅当当前会话使用 DeepSeek 官方模型(provider 路由 deepseek-official)且
// API 源为官方(api.deepseek.com)时才显示。
// 格式遵循 DSH 客户端插件契约:window.__ModuleLoader__.load + 具名导出 apply/inject。
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
    // props 由 register 注入:标准 props 提供 sessionId,业务 inject 提供 connection。
    function PeakValleyIndicator(props) {
      var sessionId = props.sessionId;
      var connection = props.connection;
      // status: { visible: boolean, peak: boolean }
      var status = react.useState({ visible: false, peak: isPeak(new Date()) });
      var setStatus = status[1];

      react.useEffect(function () {
        var alive = true;

        // 判断当前会话是否使用 DeepSeek 官方模型 + 官方 API 源。
        // 返回 true 才允许显示峰/谷价指示。
        function isOfficialSource() {
          return new Promise(function (resolve) {
            if (connection === undefined || connection.api === undefined || connection.api.sessions === undefined) {
              resolve(false);
              return;
            }
            connection.api.sessions
              .models({ sessionId: sessionId })
              .then(function (modelsRes) {
                var modelsOk = modelsRes && modelsRes.result && modelsRes.result.ok;
                var current = modelsOk ? modelsRes.result.value.current : undefined;
                if (current === undefined || current.provider !== OFFICIAL_PROVIDER || typeof current.model !== "string" || !current.model.startsWith("deepseek-")) {
                  return false;
                }
                // 官方源:未显式改配 baseURL,或 baseURL 仍为官方地址。
                if (connection.api.settings === undefined || connection.api.settings.describe === undefined) return true;
                return connection.api.settings
                  .describe({})
                  .then(function (settingsRes) {
                    if (!settingsRes || !settingsRes.result || !settingsRes.result.ok) return true;
                    var namespaces = settingsRes.result.value.namespaces || [];
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
                  });
              })
              .then(function (official) {
                resolve(official === true);
              })
              .catch(function () {
                resolve(false);
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
        // 每 30 秒刷新一次,兼顾跨时段边界与模型/源切换。
        var timer = setInterval(refresh, 30000);
        return function () {
          alive = false;
          clearInterval(timer);
        };
      }, [sessionId]);

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

    // 插件依赖的服务(与 ui-deliverables 等官方包一致)
    var inject = ["slots", "connection"];

    function apply(ctx) {
      var slots = ctx.get("slots");
      if (slots === undefined) return;
      slots.inject("conversation.input.right", function () {
        return slots.register(
          {
            name: "conversation.input.right",
            id: "peak-valley-indicator",
            // 把 connection 服务注入组件 props(register 的业务注入面)。
            inject: function () {
              return { connection: ctx.get("connection") };
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
