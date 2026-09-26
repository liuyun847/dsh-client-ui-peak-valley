// 浏览器端插件主体:在对话框模型选择按钮左侧显示 DeepSeek API 峰/谷价状态。
// 只要当前会话选中的模型 id 含 "deepseek"(不区分大小写)就显示,
// 不区分提供方(官方适配器 / 各类中转网关 / 自定义 provider 一律同等对待)。
// 格式遵循 DSH 客户端插件契约:window.__ModuleLoader__.load + 具名导出 apply/inject。
//
// 适配 DSH 0.1.2-alpha.3:
//  - 会话当前模型改为标准 props 的 useProjection('modelSelection')(投影的
//    next ?? lastUsed 是权威来源,替代已移除的 connection.api.sessions.models);
//  - 移除了旧的 provider / settings.describe baseURL 来源校验:模型 id 命中即显示,
//    故组件不再需要 remote 服务,注入面收窄为 slots。
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

    // 显示条件:模型 id 含该子串即视为 DeepSeek(大小写不敏感)。
    // 例:deepseek-chat、deepseek/deepseek-v4.1-flash(中转网关的
    // "厂商/模型" 形式)均命中;provider 不参与判定。
    var DEEPSEEK_MARKER = "deepseek";

    function isDeepSeekModel(model) {
      return typeof model === "string" && model.toLowerCase().indexOf(DEEPSEEK_MARKER) !== -1;
    }

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
    // props 由 register 注入:标准 props 提供 sessionId/useProjection。
    function PeakValleyIndicator(props) {
      var sessionId = props.sessionId;
      // useProjection 是标准 keyed hook,必须在组件渲染顶层调用(React Hooks
      // 规则:不能在 useEffect 回调/Promise 内调用,否则抛 Invalid hook call)。
      // 返回 modelSelection 投影({ lastUsed, next })或 undefined(能力缺失)。
      var projected = props.useProjection === undefined
        ? undefined
        : props.useProjection("modelSelection");
      // 权威会话模型选择:投影的 next(未消费的最近选择)回退 lastUsed(最近
      // 一次实际使用);两者皆缺则视为无法判定。
      var current = projected == null ? undefined : (projected.next ?? projected.lastUsed);
      // 是否 DeepSeek:只看模型 id 是否含 "deepseek",provider 不参与判定。
      var isDeepSeek = current != null && isDeepSeekModel(current.model);
      // 投影值变化 → 依赖键变化 → effect 重跑,模型切换即时重新判定,
      // 不必等 30 秒轮询兜底。
      var modelKey = current == null ? "" : current.provider + "/" + current.model;
      // status: { visible: boolean, peak: boolean }
      var status = react.useState({ visible: isDeepSeek, peak: isPeak(new Date()) });
      var setStatus = status[1];

      react.useEffect(function () {
        // 非 DeepSeek 模型:无需轮询,直接隐藏。
        if (!isDeepSeek) {
          setStatus({ visible: false, peak: isPeak(new Date()) });
          return undefined;
        }
        function refresh() {
          setStatus({ visible: true, peak: isPeak(new Date()) });
        }
        refresh();
        // 每 30 秒刷新一次,跨时段边界自动切换。
        var timer = setInterval(refresh, 30000);
        return function () {
          clearInterval(timer);
        };
      }, [sessionId, modelKey, isDeepSeek]);

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

    // 插件依赖的服务:仅需 slots。
    // 注:若日后要读设置/远程面,再补 "remote"、"remote.settings" 等注入项。
    var inject = ["slots"];

    function apply(ctx) {
      var slots = ctx.get("slots");
      if (slots === undefined) return;
      slots.inject("conversation.input.right", function () {
        return slots.register(
          {
            name: "conversation.input.right",
            id: "peak-valley-indicator",
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
