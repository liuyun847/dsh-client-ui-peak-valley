// 浏览器端插件主体:在对话框模型选择按钮左侧显示 DeepSeek API 峰/谷价状态。
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
    function PeakValleyIndicator() {
      var state = react.useState(function () { return new Date(); });
      var now = state[0];
      var setNow = state[1];
      react.useEffect(function () {
        // 每 30 秒刷新一次,跨时段边界时状态自动切换
        var timer = setInterval(function () { setNow(new Date()); }, 30000);
        return function () { clearInterval(timer); };
      }, []);
      var peak = isPeak(now);
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
    var inject = ["slots"];

    function apply(ctx) {
      var slots = ctx.get("slots");
      if (slots === undefined) return;
      slots.inject("conversation.input.right", function () {
        return slots.register(
          { name: "conversation.input.right", id: "peak-valley-indicator" },
          PeakValleyIndicator
        );
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
