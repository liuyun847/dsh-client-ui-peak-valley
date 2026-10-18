// 浏览器端插件主体:在对话框模型选择按钮左侧显示 DeepSeek API 峰/谷价状态。
// 只要当前会话选中的模型 id 含 "deepseek"(不区分大小写)就显示,
// 不区分提供方(官方适配器 / 各类中转网关 / 自定义 provider 一律同等对待)。
// 格式遵循 DSH 客户端插件契约:window.__ModuleLoader__.load + 具名导出 apply/inject。
//
// 2026-10 定价规则(本插件据此判定):
//  - 高峰:北京时间周一至周五(不含中国法定节假日)09:00-12:00、14:00-18:00;
//  - 空闲(谷):其余全部时段(工作日非高峰、周末全天、法定节假日全天);
//  - 空闲价格约为高峰价格的一半,标签仍显示「谷价」,tooltip 显示完整规则。
//
// 模型来源(2026-10-18 修「新对话不显示」):
//  - 新会话还没有 modelSelection 投影,原实现取不到模型 ⇒ 一直隐藏;
//  - 现在按会话从 modelDirectories 取模型选择目录的 current。目录 current 为
//    projected.next ?? 目录默认模型,与 composer 模型按钮同源,新对话也有值;
//  - 目录不可用时回退到 projection(next → lastUsed),老行为保持不变。
window.__ModuleLoader__.load({
  id: "dsh-client-ui-peak-valley",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    var react = require("react");

    // apply() 时记下插件上下文,供组件按会话解析模型目录(见 PeakValleyIndicator)。
    var pluginContext;

    // ── 峰/谷判定(DeepSeek 官方定价时段)──────────────────────────────
    // 高峰时段:北京时间周一至周五(不含中国法定节假日)09:00-12:00、14:00-18:00。
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

    function hasOwn(object, key) {
      return Object.prototype.hasOwnProperty.call(object, key);
    }

    // ── 中国法定节假日 ────────────────────────────────────────────────
    // 只列“放假”的日期(MM-DD)。周末本身已判为空闲,调休上班的周末也按
    // 「周末全天谷价」处理,所以这里不需要记录补班日。
    // 数据来源:国务院办公厅年度节假日安排,经 https://timor.tech/api/holiday
    // 逐年校对(2024-2026 已收录)。表外年份在运行时向上面的接口补拉,
    // 并缓存 7 天;拉取失败则退化为“只看工作日/周末”。
    var STATIC_HOLIDAYS = {
      "2024": [
        "01-01",
        "02-10", "02-11", "02-12", "02-13", "02-14", "02-15", "02-16", "02-17",
        "04-04", "04-05", "04-06",
        "05-01", "05-02", "05-03", "05-04", "05-05",
        "06-08", "06-09", "06-10",
        "09-15", "09-16", "09-17",
        "10-01", "10-02", "10-03", "10-04", "10-05", "10-06", "10-07",
      ],
      "2025": [
        "01-01",
        "01-28", "01-29", "01-30", "01-31", "02-01", "02-02", "02-03", "02-04",
        "04-04", "04-05", "04-06",
        "05-01", "05-02", "05-03", "05-04", "05-05",
        "05-31", "06-01", "06-02",
        "10-01", "10-02", "10-03", "10-04", "10-05", "10-06", "10-07", "10-08",
      ],
      "2026": [
        "01-01", "01-02", "01-03",
        "02-15", "02-16", "02-17", "02-18", "02-19", "02-20", "02-21", "02-22", "02-23",
        "04-04", "04-05", "04-06",
        "05-01", "05-02", "05-03", "05-04", "05-05",
        "06-19", "06-20", "06-21",
        "09-25", "09-26", "09-27",
        "10-01", "10-02", "10-03", "10-04", "10-05", "10-06", "10-07",
      ],
    };

    var HOLIDAY_CACHE_PREFIX = "dsh-client-ui-peak-valley/holidays:";
    var HOLIDAY_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
    var HOLIDAY_API_BASE = "https://timor.tech/api/holiday/year/";

    // 年份(字符串)→ { "MM-DD": true }。静态表与运行时拉取共用这一份。
    var holidaySets = Object.create(null);
    // 已经发起过请求的年份,避免 30 秒轮询反复打接口。
    var holidayFetches = Object.create(null);
    var holidayListeners = [];

    (function seedStaticHolidays() {
      for (var year in STATIC_HOLIDAYS) {
        if (!hasOwn(STATIC_HOLIDAYS, year)) continue;
        var set = Object.create(null);
        var dates = STATIC_HOLIDAYS[year];
        for (var i = 0; i < dates.length; i++) set[dates[i]] = true;
        holidaySets[year] = set;
      }
    })();

    function notifyHolidaysChanged() {
      for (var i = 0; i < holidayListeners.length; i++) {
        try {
          holidayListeners[i]();
        } catch (error) {
          // 单个订阅者异常不应影响其他订阅者。
        }
      }
    }

    function onHolidaysChanged(listener) {
      holidayListeners.push(listener);
      return function () {
        var index = holidayListeners.indexOf(listener);
        if (index !== -1) holidayListeners.splice(index, 1);
      };
    }

    function seedHolidayDates(year, dates) {
      var key = String(year);
      var set = holidaySets[key];
      if (set === undefined) set = holidaySets[key] = Object.create(null);
      var changed = false;
      for (var i = 0; i < dates.length; i++) {
        var date = dates[i];
        if (typeof date === "string" && date.length === 5 && set[date] !== true) {
          set[date] = true;
          changed = true;
        }
      }
      if (changed) notifyHolidaysChanged();
    }

    function readHolidayCache(year) {
      try {
        if (typeof localStorage === "undefined") return false;
        var raw = localStorage.getItem(HOLIDAY_CACHE_PREFIX + year);
        if (raw === null) return false;
        var parsed = JSON.parse(raw);
        if (parsed === null || !Array.isArray(parsed.dates)) return false;
        if (typeof parsed.at !== "number" || Date.now() - parsed.at > HOLIDAY_CACHE_TTL) return false;
        seedHolidayDates(year, parsed.dates);
        return true;
      } catch (error) {
        return false;
      }
    }

    function writeHolidayCache(year, dates) {
      try {
        if (typeof localStorage === "undefined") return;
        localStorage.setItem(
          HOLIDAY_CACHE_PREFIX + year,
          JSON.stringify({ at: Date.now(), dates: dates })
        );
      } catch (error) {
        // 隐私模式或配额已满:忽略,下次仍然走网络。
      }
    }

    // 表外年份补拉节假日。同步命中缓存时立即生效;网络结果到达后通过
    // onHolidaysChanged 通知组件重算,不必等 30 秒轮询。
    function ensureHolidays(year) {
      var key = String(year);
      if (hasOwn(STATIC_HOLIDAYS, key) || hasOwn(holidaySets, key)) return;
      if (hasOwn(holidayFetches, key)) return;
      holidayFetches[key] = true;
      if (readHolidayCache(key)) return;
      if (typeof fetch !== "function") return;
      fetch(HOLIDAY_API_BASE + encodeURIComponent(key), { cache: "no-store" })
        .then(function (response) {
          if (!response.ok) throw new Error("HTTP " + response.status);
          return response.json();
        })
        .then(function (body) {
          if (body === null || body.code !== 0 || body.holiday === null || typeof body.holiday !== "object") return;
          var dates = [];
          for (var date in body.holiday) {
            if (!hasOwn(body.holiday, date)) continue;
            var info = body.holiday[date];
            // timor.tech 的键是 "MM-DD";兼容可能返回完整日期的接口形态。
            var day = date.length === 5 ? date : date.length >= 10 ? date.slice(5, 10) : "";
            if (info !== null && info.holiday === true && day !== "") dates.push(day);
          }
          // 空表 = 官方安排还没发布:不写缓存,下次会话再试。
          if (dates.length === 0) return;
          writeHolidayCache(key, dates);
          seedHolidayDates(key, dates);
        })
        .catch(function () {
          // 离线 / 接口不可用:退回工作日规则。
        });
    }

    // ── 北京时间 ──────────────────────────────────────────────────────
    // 中国大陆自 1991 年起固定 UTC+8、无夏令时;直接平移后按 UTC 读数,
    // 不受浏览器本地时区影响。weekday: 0=周日 … 6=周六。
    function beijingClock(date) {
      var shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
      return {
        year: shifted.getUTCFullYear(),
        month: shifted.getUTCMonth() + 1,
        day: shifted.getUTCDate(),
        weekday: shifted.getUTCDay(),
        minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
      };
    }

    function pad2(value) {
      return value < 10 ? "0" + value : String(value);
    }

    function isHoliday(clock) {
      var set = holidaySets[String(clock.year)];
      if (set === undefined) return false;
      return set[pad2(clock.month) + "-" + pad2(clock.day)] === true;
    }

    function isPeak(date) {
      var clock = beijingClock(date);
      // 周末全天谷价(含法定调休上班的周末 —— 规则明确“周末全天”为空闲)。
      if (clock.weekday === 0 || clock.weekday === 6) return false;
      // 工作日但落在法定节假日(含调休放假)⇒ 谷价。
      if (isHoliday(clock)) return false;
      for (var i = 0; i < PEAK_RANGES.length; i++) {
        var range = PEAK_RANGES[i];
        if (clock.minutes >= range[0] && clock.minutes < range[1]) return true;
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
    // props 由 register 注入:标准 props 提供 sessionId/useProjection;
    // 模型选择目录在渲染时按 sessionId 软取(见下方 directoryStore)。
    function PeakValleyIndicator(props) {
      var sessionId = props.sessionId;
      // useProjection 是标准 keyed hook,必须在组件渲染顶层调用(React Hooks
      // 规则:不能在 useEffect 回调/Promise 内调用,否则抛 Invalid hook call)。
      var projected = props.useProjection === undefined
        ? undefined
        : props.useProjection("modelSelection");
      var projectedNext = projected == null ? undefined : projected.next;
      var projectedLast = projected == null ? undefined : projected.lastUsed;

      // 模型选择目录 store(与 composer 模型按钮同源)。目录 current 为
      // projected.next ?? 目录默认模型,所以新会话(blank)也有值 —— 这是
      // 「新对话不显示」的修复点。
      // ⚠ 必须在渲染时解析:新会话首帧的 session scope 可能尚未就绪,
      //   若把解析放进 per-session inject,失败结果会被缓存,此后一直是空。
      var directoryStore;
      var models = pluginContext === undefined ? undefined : pluginContext.get("modelDirectories", false);
      if (models !== undefined && sessionId !== undefined) {
        try {
          directoryStore = models.directoryFor(sessionId).store;
        } catch (error) {
          directoryStore = undefined;
        }
      }
      // 新会话挂载早期 scope 可能还没就绪:短间隔重试,最多约 10 秒。
      var retryState = react.useState(0);
      var retryToken = retryState[0];
      react.useEffect(function () {
        if (directoryStore !== undefined || sessionId === undefined || retryToken >= 20) return undefined;
        var timer = setTimeout(function () {
          retryState[1](retryToken + 1);
        }, 500);
        return function () {
          clearTimeout(timer);
        };
      }, [directoryStore, sessionId, retryToken]);
      var subscribeDirectory = react.useCallback(function (onChange) {
        if (directoryStore === undefined || directoryStore === null) return function () {};
        return directoryStore.subscribe(onChange);
      }, [directoryStore]);
      var readDirectory = react.useCallback(function () {
        return directoryStore === undefined || directoryStore === null
          ? null
          : directoryStore.getSnapshot();
      }, [directoryStore]);
      var directory = react.useSyncExternalStore(subscribeDirectory, readDirectory);
      var directoryCurrent = directory == null ? undefined : directory.current;

      // 优先级与下一次请求实际使用的模型一致(next → lastUsed);新会话两者皆空,
      // 再回退到目录 current(目录默认模型)。见 ui-conversation 的 SessionInputShell。
      var current = projectedNext ?? projectedLast ?? directoryCurrent;
      // 是否 DeepSeek:只看模型 id 是否含 "deepseek",provider 不参与判定。
      var isDeepSeek = current != null && isDeepSeekModel(current.model);
      // 投影/目录值变化 → 依赖键变化 → effect 重跑,模型切换即时重新判定。
      var modelKey = current == null ? "" : current.provider + "/" + current.model;
      // status: { visible: boolean, peak: boolean }
      var status = react.useState(function () {
        return { visible: isDeepSeek, peak: isPeak(new Date()) };
      });
      var setStatus = status[1];

      react.useEffect(function () {
        // 非 DeepSeek 模型:无需轮询,直接隐藏。
        if (!isDeepSeek) {
          setStatus({ visible: false, peak: isPeak(new Date()) });
          return undefined;
        }
        function refresh() {
          var now = new Date();
          var clock = beijingClock(now);
          // 表外年份(通常是下一年)尝试补拉法定节假日;
          // 数据到达后由下面的订阅立即重算。
          ensureHolidays(clock.year);
          setStatus({ visible: true, peak: isPeak(now) });
        }
        refresh();
        // 每 30 秒刷新一次,跨时段边界自动切换。
        var timer = setInterval(refresh, 30000);
        return function () {
          clearInterval(timer);
        };
      }, [sessionId, modelKey, isDeepSeek]);

      // 节假日数据异步到达(或缓存命中)时立即重算,不用等 30 秒轮询。
      react.useEffect(function () {
        if (!isDeepSeek) return undefined;
        return onHolidaysChanged(function () {
          setStatus({ visible: true, peak: isPeak(new Date()) });
        });
      }, [isDeepSeek]);

      if (!status[0].visible) return null;
      var peak = status[0].peak;
      var title = "空闲时段价格为高峰时段价格的一半。北京时间周一至周五（不含中国法定节假日）9:00 - 12:00、14:00 - 18:00 为高峰时段；其余时段，包括周末及中国法定节假日全天均为空闲时段。";
      return react.createElement(
        "div",
        {
          className: "pv-indicator",
          title: title,
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
    // modelDirectories 属于可选增强(用于新会话),组件在渲染时按会话软取,
    // 取不到时回退到 modelSelection 投影,不阻断插件加载。
    var inject = ["slots"];

    function apply(ctx) {
      pluginContext = ctx;
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