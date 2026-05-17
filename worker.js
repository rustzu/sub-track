// 订阅续期通知网站 - 基于CloudFlare Workers (完全优化版)

// 时区处理工具函数
// 常量：毫秒转换为小时/天，便于全局复用
const MS_PER_HOUR = 1000 * 60 * 60;
const MS_PER_DAY = MS_PER_HOUR * 24;

function getCurrentTimeInTimezone(timezone = 'UTC') {
  try {
    // Workers 环境下 Date 始终存储 UTC 时间，这里直接返回当前时间对象
    return new Date();
  } catch (error) {
    // 如果时区无效，返回UTC时间
    return new Date();
  }
}

function getTimestampInTimezone(timezone = 'UTC') {
  return getCurrentTimeInTimezone(timezone).getTime();
}

function convertUTCToTimezone(utcTime, timezone = 'UTC') {
  try {
    // 同 getCurrentTimeInTimezone，一律返回 Date 供后续统一处理
    return new Date(utcTime);
  } catch (error) {
    return new Date(utcTime);
  }
}

// 获取指定时区的年/月/日/时/分/秒，便于避免重复的 Intl 解析逻辑
function getTimezoneDateParts(date, timezone = 'UTC') {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const parts = formatter.formatToParts(date);
    const pick = (type) => {
      const part = parts.find((item) => item.type === type);
      return part ? Number(part.value) : 0;
    };
    return {
      year: pick('year'),
      month: pick('month'),
      day: pick('day'),
      hour: pick('hour'),
      minute: pick('minute'),
      second: pick('second'),
    };
  } catch (error) {
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour: date.getUTCHours(),
      minute: date.getUTCMinutes(),
      second: date.getUTCSeconds(),
    };
  }
}

// 计算指定日期在目标时区的午夜时间戳（毫秒），用于统一的“剩余天数”计算
function getTimezoneMidnightTimestamp(date, timezone = 'UTC') {
  const { year, month, day } = getTimezoneDateParts(date, timezone);
  return Date.UTC(year, month - 1, day, 0, 0, 0);
}

function calculateExpirationTime(expirationMinutes, timezone = 'UTC') {
  const currentTime = getCurrentTimeInTimezone(timezone);
  const expirationTime = new Date(currentTime.getTime() + expirationMinutes * 60 * 1000);
  return expirationTime;
}

function isExpired(targetTime, timezone = 'UTC') {
  const currentTime = getCurrentTimeInTimezone(timezone);
  const target = new Date(targetTime);
  return currentTime > target;
}

function formatTimeInTimezone(time, timezone = 'UTC', format = 'full') {
  try {
    const date = new Date(time);

    if (format === 'date') {
      return date.toLocaleDateString('zh-CN', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
    } else if (format === 'datetime') {
      return date.toLocaleString('zh-CN', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } else {
      // full format
      return date.toLocaleString('zh-CN', {
        timeZone: timezone,
      });
    }
  } catch (error) {
    return new Date(time).toISOString();
  }
}

function getTimezoneOffset(timezone = 'UTC') {
  try {
    const now = new Date();
    const { year, month, day, hour, minute, second } = getTimezoneDateParts(now, timezone);
    const zonedTimestamp = Date.UTC(year, month - 1, day, hour, minute, second);
    return Math.round((zonedTimestamp - now.getTime()) / MS_PER_HOUR);
  } catch (error) {
    return 0;
  }
}

// 格式化时区显示，包含UTC偏移
function formatTimezoneDisplay(timezone = 'UTC') {
  try {
    const offset = getTimezoneOffset(timezone);
    const offsetStr = offset >= 0 ? `+${offset}` : `${offset}`;

    // 时区中文名称映射
    const timezoneNames = {
      UTC: '世界标准时间',
      'Asia/Shanghai': '中国标准时间',
      'Asia/Hong_Kong': '香港时间',
      'Asia/Taipei': '台北时间',
      'Asia/Singapore': '新加坡时间',
      'Asia/Tokyo': '日本时间',
      'Asia/Seoul': '韩国时间',
      'America/New_York': '美国东部时间',
      'America/Los_Angeles': '美国太平洋时间',
      'America/Chicago': '美国中部时间',
      'America/Denver': '美国山地时间',
      'Europe/London': '英国时间',
      'Europe/Paris': '巴黎时间',
      'Europe/Berlin': '柏林时间',
      'Europe/Moscow': '莫斯科时间',
      'Australia/Sydney': '悉尼时间',
      'Australia/Melbourne': '墨尔本时间',
      'Pacific/Auckland': '奥克兰时间',
    };

    const timezoneName = timezoneNames[timezone] || timezone;
    return `${timezoneName} (UTC${offsetStr})`;
  } catch (error) {
    return timezone;
  }
}

// 兼容性函数 - 保持原有接口
function formatBeijingTime(date = new Date(), format = 'full') {
  return formatTimeInTimezone(date, 'Asia/Shanghai', format);
}

// 时区处理中间件函数
function extractTimezone(request) {
  // 优先级：URL参数 > 请求头 > 默认值
  const url = new URL(request.url);
  const timezoneParam = url.searchParams.get('timezone');

  if (timezoneParam) {
    return timezoneParam;
  }

  // 从请求头获取时区
  const timezoneHeader = request.headers.get('X-Timezone');
  if (timezoneHeader) {
    return timezoneHeader;
  }

  // 从Accept-Language头推断时区（简化处理）
  const acceptLanguage = request.headers.get('Accept-Language');
  if (acceptLanguage) {
    // 简单的时区推断逻辑
    if (acceptLanguage.includes('zh')) {
      return 'Asia/Shanghai';
    } else if (acceptLanguage.includes('en-US')) {
      return 'America/New_York';
    } else if (acceptLanguage.includes('en-GB')) {
      return 'Europe/London';
    }
  }

  // 默认返回UTC
  return 'UTC';
}

function isValidTimezone(timezone) {
  try {
    // 尝试使用该时区格式化时间
    new Date().toLocaleString('en-US', { timeZone: timezone });
    return true;
  } catch (error) {
    return false;
  }
}

// 农历转换工具函数
const lunarCalendar = {
  // 农历数据 (1900-2100年)
  lunarInfo: [
    0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0, 0x09ad0, 0x055d2, 0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255, 0x0b540,
    0x0d6a0, 0x0ada2, 0x095b0, 0x14977, 0x04970, 0x0a4b0, 0x0b4b5, 0x06a50, 0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970, 0x06566, 0x0d4a0,
    0x0ea50, 0x06e95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950, 0x0d4a0, 0x1d8a6, 0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0, 0x0d2b2,
    0x0a950, 0x0b557, 0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5b0, 0x14573, 0x052b0, 0x0a9a8, 0x0e950, 0x06aa0, 0x0aea6, 0x0ab50, 0x04b60, 0x0aae4,
    0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0, 0x096d0, 0x04dd5, 0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558, 0x0b540, 0x0b6a0, 0x195a6,
    0x095b0, 0x049b0, 0x0a974, 0x0a4b0, 0x0b27a, 0x06a50, 0x06d40, 0x0af46, 0x0ab60, 0x09570, 0x04af5, 0x04970, 0x064b0, 0x074a3, 0x0ea50, 0x06b58,
    0x055c0, 0x0ab60, 0x096d5, 0x092e0, 0x0c960, 0x0d954, 0x0d4a0, 0x0da50, 0x07552, 0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5, 0x0a950, 0x0b4a0,
    0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930, 0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260,
    0x0ea65, 0x0d530, 0x05aa0, 0x076a3, 0x096d0, 0x04bd7, 0x04ad0, 0x0a4d0, 0x1d0b6, 0x0d250, 0x0d520, 0x0dd45, 0x0b5a0, 0x056d0, 0x055b2, 0x049b0,
    0x0a577, 0x0a4b0, 0x0aa50, 0x1b255, 0x06d20, 0x0ada0,
  ],

  // 天干地支
  gan: ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'],
  zhi: ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'],

  // 农历月份
  months: ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊'],

  // 农历日期
  days: [
    '初一',
    '初二',
    '初三',
    '初四',
    '初五',
    '初六',
    '初七',
    '初八',
    '初九',
    '初十',
    '十一',
    '十二',
    '十三',
    '十四',
    '十五',
    '十六',
    '十七',
    '十八',
    '十九',
    '二十',
    '廿一',
    '廿二',
    '廿三',
    '廿四',
    '廿五',
    '廿六',
    '廿七',
    '廿八',
    '廿九',
    '三十',
  ],

  // 获取农历年天数
  lunarYearDays: function (year) {
    let sum = 348;
    for (let i = 0x8000; i > 0x8; i >>= 1) {
      sum += this.lunarInfo[year - 1900] & i ? 1 : 0;
    }
    return sum + this.leapDays(year);
  },

  // 获取闰月天数
  leapDays: function (year) {
    if (this.leapMonth(year)) {
      return this.lunarInfo[year - 1900] & 0x10000 ? 30 : 29;
    }
    return 0;
  },

  // 获取闰月月份
  leapMonth: function (year) {
    return this.lunarInfo[year - 1900] & 0xf;
  },

  // 获取农历月天数
  monthDays: function (year, month) {
    return this.lunarInfo[year - 1900] & (0x10000 >> month) ? 30 : 29;
  },

  // 公历转农历
  solar2lunar: function (year, month, day) {
    if (year < 1900 || year > 2100) return null;

    const baseDate = new Date(1900, 0, 31);
    const objDate = new Date(year, month - 1, day);
    //let offset = Math.floor((objDate - baseDate) / 86400000);
    // @ts-ignore
    let offset = Math.round((objDate - baseDate) / 86400000);

    let temp = 0;
    let lunarYear = 1900;

    for (lunarYear = 1900; lunarYear < 2101 && offset > 0; lunarYear++) {
      temp = this.lunarYearDays(lunarYear);
      offset -= temp;
    }

    if (offset < 0) {
      offset += temp;
      lunarYear--;
    }

    let lunarMonth = 1;
    let leap = this.leapMonth(lunarYear);
    let isLeap = false;

    for (lunarMonth = 1; lunarMonth < 13 && offset > 0; lunarMonth++) {
      if (leap > 0 && lunarMonth === leap + 1 && !isLeap) {
        --lunarMonth;
        isLeap = true;
        temp = this.leapDays(lunarYear);
      } else {
        temp = this.monthDays(lunarYear, lunarMonth);
      }

      if (isLeap && lunarMonth === leap + 1) isLeap = false;
      offset -= temp;
    }

    if (offset === 0 && leap > 0 && lunarMonth === leap + 1) {
      if (isLeap) {
        isLeap = false;
      } else {
        isLeap = true;
        --lunarMonth;
      }
    }

    if (offset < 0) {
      offset += temp;
      --lunarMonth;
    }

    const lunarDay = offset + 1;

    // 生成农历字符串
    const ganIndex = (lunarYear - 4) % 10;
    const zhiIndex = (lunarYear - 4) % 12;
    const yearStr = this.gan[ganIndex] + this.zhi[zhiIndex] + '年';
    const monthStr = (isLeap ? '闰' : '') + this.months[lunarMonth - 1] + '月';
    const dayStr = this.days[lunarDay - 1];

    return {
      year: lunarYear,
      month: lunarMonth,
      day: lunarDay,
      isLeap: isLeap,
      yearStr: yearStr,
      monthStr: monthStr,
      dayStr: dayStr,
      fullStr: yearStr + monthStr + dayStr,
    };
  },
};

// 1. 新增 lunarBiz 工具模块，支持农历加周期、农历转公历、农历距离天数
const lunarBiz = {
  // 农历加周期，返回新的农历日期对象
  addLunarPeriod(lunar, periodValue, periodUnit) {
    let { year, month, day, isLeap } = lunar;
    if (periodUnit === 'year') {
      year += periodValue;
      const leap = lunarCalendar.leapMonth(year);
      if (isLeap && leap === month) {
        isLeap = true;
      } else {
        isLeap = false;
      }
    } else if (periodUnit === 'month') {
      let totalMonths = (year - 1900) * 12 + (month - 1) + periodValue;
      year = Math.floor(totalMonths / 12) + 1900;
      month = (totalMonths % 12) + 1;
      const leap = lunarCalendar.leapMonth(year);
      if (isLeap && leap === month) {
        isLeap = true;
      } else {
        isLeap = false;
      }
    } else if (periodUnit === 'day') {
      const solar = lunarBiz.lunar2solar(lunar);
      const date = new Date(solar.year, solar.month - 1, solar.day + periodValue);
      return lunarCalendar.solar2lunar(date.getFullYear(), date.getMonth() + 1, date.getDate());
    }
    let maxDay = isLeap ? lunarCalendar.leapDays(year) : lunarCalendar.monthDays(year, month);
    let targetDay = Math.min(day, maxDay);
    while (targetDay > 0) {
      let solar = lunarBiz.lunar2solar({ year, month, day: targetDay, isLeap });
      if (solar) {
        return { year, month, day: targetDay, isLeap };
      }
      targetDay--;
    }
    return { year, month, day, isLeap };
  },
  // 农历转公历（遍历法，适用1900-2100年）
  lunar2solar(lunar) {
    for (let y = lunar.year - 1; y <= lunar.year + 1; y++) {
      for (let m = 1; m <= 12; m++) {
        for (let d = 1; d <= 31; d++) {
          const date = new Date(y, m - 1, d);
          if (date.getFullYear() !== y || date.getMonth() + 1 !== m || date.getDate() !== d) continue;
          const l = lunarCalendar.solar2lunar(y, m, d);
          if (l && l.year === lunar.year && l.month === lunar.month && l.day === lunar.day && l.isLeap === lunar.isLeap) {
            return { year: y, month: m, day: d };
          }
        }
      }
    }
    return null;
  },
  // 距离农历日期还有多少天
  daysToLunar(lunar) {
    const solar = lunarBiz.lunar2solar(lunar);
    const date = new Date(solar.year, solar.month - 1, solar.day);
    const now = new Date();
    return Math.ceil((date - now) / (1000 * 60 * 60 * 24));
  },
};

// 定义HTML模板
// Tailwind 精简样式：修改页面中的 Tailwind 类名后请运行 `npm run build` 重新扫描并嵌入 CSS
const EMBEDDED_TAILWIND_CSS = `*,:after,:before{--tw-border-spacing-x:0;--tw-border-spacing-y:0;--tw-translate-x:0;--tw-translate-y:0;--tw-rotate:0;--tw-skew-x:0;--tw-skew-y:0;--tw-scale-x:1;--tw-scale-y:1;--tw-pan-x: ;--tw-pan-y: ;--tw-pinch-zoom: ;--tw-scroll-snap-strictness:proximity;--tw-gradient-from-position: ;--tw-gradient-via-position: ;--tw-gradient-to-position: ;--tw-ordinal: ;--tw-slashed-zero: ;--tw-numeric-figure: ;--tw-numeric-spacing: ;--tw-numeric-fraction: ;--tw-ring-inset: ;--tw-ring-offset-width:0px;--tw-ring-offset-color:#fff;--tw-ring-color:rgba(59,130,246,.5);--tw-ring-offset-shadow:0 0 #0000;--tw-ring-shadow:0 0 #0000;--tw-shadow:0 0 #0000;--tw-shadow-colored:0 0 #0000;--tw-blur: ;--tw-brightness: ;--tw-contrast: ;--tw-grayscale: ;--tw-hue-rotate: ;--tw-invert: ;--tw-saturate: ;--tw-sepia: ;--tw-drop-shadow: ;--tw-backdrop-blur: ;--tw-backdrop-brightness: ;--tw-backdrop-contrast: ;--tw-backdrop-grayscale: ;--tw-backdrop-hue-rotate: ;--tw-backdrop-invert: ;--tw-backdrop-opacity: ;--tw-backdrop-saturate: ;--tw-backdrop-sepia: ;--tw-contain-size: ;--tw-contain-layout: ;--tw-contain-paint: ;--tw-contain-style: }::backdrop{--tw-border-spacing-x:0;--tw-border-spacing-y:0;--tw-translate-x:0;--tw-translate-y:0;--tw-rotate:0;--tw-skew-x:0;--tw-skew-y:0;--tw-scale-x:1;--tw-scale-y:1;--tw-pan-x: ;--tw-pan-y: ;--tw-pinch-zoom: ;--tw-scroll-snap-strictness:proximity;--tw-gradient-from-position: ;--tw-gradient-via-position: ;--tw-gradient-to-position: ;--tw-ordinal: ;--tw-slashed-zero: ;--tw-numeric-figure: ;--tw-numeric-spacing: ;--tw-numeric-fraction: ;--tw-ring-inset: ;--tw-ring-offset-width:0px;--tw-ring-offset-color:#fff;--tw-ring-color:rgba(59,130,246,.5);--tw-ring-offset-shadow:0 0 #0000;--tw-ring-shadow:0 0 #0000;--tw-shadow:0 0 #0000;--tw-shadow-colored:0 0 #0000;--tw-blur: ;--tw-brightness: ;--tw-contrast: ;--tw-grayscale: ;--tw-hue-rotate: ;--tw-invert: ;--tw-saturate: ;--tw-sepia: ;--tw-drop-shadow: ;--tw-backdrop-blur: ;--tw-backdrop-brightness: ;--tw-backdrop-contrast: ;--tw-backdrop-grayscale: ;--tw-backdrop-hue-rotate: ;--tw-backdrop-invert: ;--tw-backdrop-opacity: ;--tw-backdrop-saturate: ;--tw-backdrop-sepia: ;--tw-contain-size: ;--tw-contain-layout: ;--tw-contain-paint: ;--tw-contain-style: }/*! tailwindcss v3.4.19 | MIT License | https://tailwindcss.com*/*,:after,:before{box-sizing:border-box;border:0 solid #e5e7eb}:after,:before{--tw-content:""}:host,html{line-height:1.5;-webkit-text-size-adjust:100%;-moz-tab-size:4;-o-tab-size:4;tab-size:4;font-family:ui-sans-serif,system-ui,sans-serif,Apple Color Emoji,Segoe UI Emoji,Segoe UI Symbol,Noto Color Emoji;font-feature-settings:normal;font-variation-settings:normal;-webkit-tap-highlight-color:transparent}body{margin:0;line-height:inherit}hr{height:0;color:inherit;border-top-width:1px}abbr:where([title]){-webkit-text-decoration:underline dotted;text-decoration:underline dotted}h1,h2,h3,h4,h5,h6{font-size:inherit;font-weight:inherit}a{color:inherit;text-decoration:inherit}b,strong{font-weight:bolder}code,kbd,pre,samp{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,Liberation Mono,Courier New,monospace;font-feature-settings:normal;font-variation-settings:normal;font-size:1em}small{font-size:80%}sub,sup{font-size:75%;line-height:0;position:relative;vertical-align:baseline}sub{bottom:-.25em}sup{top:-.5em}table{text-indent:0;border-color:inherit;border-collapse:collapse}button,input,optgroup,select,textarea{font-family:inherit;font-feature-settings:inherit;font-variation-settings:inherit;font-size:100%;font-weight:inherit;line-height:inherit;letter-spacing:inherit;color:inherit;margin:0;padding:0}button,select{text-transform:none}button,input:where([type=button]),input:where([type=reset]),input:where([type=submit]){-webkit-appearance:button;background-color:transparent;background-image:none}:-moz-focusring{outline:auto}:-moz-ui-invalid{box-shadow:none}progress{vertical-align:baseline}::-webkit-inner-spin-button,::-webkit-outer-spin-button{height:auto}[type=search]{-webkit-appearance:textfield;outline-offset:-2px}::-webkit-search-decoration{-webkit-appearance:none}::-webkit-file-upload-button{-webkit-appearance:button;font:inherit}summary{display:list-item}blockquote,dd,dl,figure,h1,h2,h3,h4,h5,h6,hr,p,pre{margin:0}fieldset{margin:0}fieldset,legend{padding:0}menu,ol,ul{list-style:none;margin:0;padding:0}dialog{padding:0}textarea{resize:vertical}input::-moz-placeholder,textarea::-moz-placeholder{opacity:1;color:#9ca3af}input::placeholder,textarea::placeholder{opacity:1;color:#9ca3af}[role=button],button{cursor:pointer}:disabled{cursor:default}audio,canvas,embed,iframe,img,object,svg,video{display:block;vertical-align:middle}img,video{max-width:100%;height:auto}[hidden]:where(:not([hidden=until-found])){display:none}input:where(:not([type])),input:where([type=date]),input:where([type=datetime-local]),input:where([type=email]),input:where([type=month]),input:where([type=number]),input:where([type=password]),input:where([type=search]),input:where([type=tel]),input:where([type=text]),input:where([type=time]),input:where([type=url]),input:where([type=week]),select,select:where([multiple]),textarea{-webkit-appearance:none;-moz-appearance:none;appearance:none;background-color:#fff;border-color:#6b7280;border-width:1px;border-radius:0;padding:.5rem .75rem;font-size:1rem;line-height:1.5rem;--tw-shadow:0 0 #0000}input:where(:not([type])):focus,input:where([type=date]):focus,input:where([type=datetime-local]):focus,input:where([type=email]):focus,input:where([type=month]):focus,input:where([type=number]):focus,input:where([type=password]):focus,input:where([type=search]):focus,input:where([type=tel]):focus,input:where([type=text]):focus,input:where([type=time]):focus,input:where([type=url]):focus,input:where([type=week]):focus,select:focus,select:where([multiple]):focus,textarea:focus{outline:2px solid transparent;outline-offset:2px;--tw-ring-inset:var(--tw-empty,/*!*/ /*!*/);--tw-ring-offset-width:0px;--tw-ring-offset-color:#fff;--tw-ring-color:#2563eb;--tw-ring-offset-shadow:var(--tw-ring-inset) 0 0 0 var(--tw-ring-offset-width) var(--tw-ring-offset-color);--tw-ring-shadow:var(--tw-ring-inset) 0 0 0 calc(1px + var(--tw-ring-offset-width)) var(--tw-ring-color);box-shadow:var(--tw-ring-offset-shadow),var(--tw-ring-shadow),var(--tw-shadow);border-color:#2563eb}input::-moz-placeholder,textarea::-moz-placeholder{color:#6b7280;opacity:1}input::placeholder,textarea::placeholder{color:#6b7280;opacity:1}::-webkit-datetime-edit-fields-wrapper{padding:0}::-webkit-date-and-time-value{min-height:1.5em;text-align:inherit}::-webkit-datetime-edit{display:inline-flex}::-webkit-datetime-edit,::-webkit-datetime-edit-day-field,::-webkit-datetime-edit-hour-field,::-webkit-datetime-edit-meridiem-field,::-webkit-datetime-edit-millisecond-field,::-webkit-datetime-edit-minute-field,::-webkit-datetime-edit-month-field,::-webkit-datetime-edit-second-field,::-webkit-datetime-edit-year-field{padding-top:0;padding-bottom:0}select{background-image:url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3E%3Cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='m6 8 4 4 4-4'/%3E%3C/svg%3E");background-position:right .5rem center;background-repeat:no-repeat;background-size:1.5em 1.5em;padding-right:2.5rem;-webkit-print-color-adjust:exact;print-color-adjust:exact}select:where([multiple]),select:where([size]:not([size="1"])){background-image:none;background-position:0 0;background-repeat:unset;background-size:initial;padding-right:.75rem;-webkit-print-color-adjust:unset;print-color-adjust:unset}input:where([type=checkbox]),input:where([type=radio]){-webkit-appearance:none;-moz-appearance:none;appearance:none;padding:0;-webkit-print-color-adjust:exact;print-color-adjust:exact;display:inline-block;vertical-align:middle;background-origin:border-box;-webkit-user-select:none;-moz-user-select:none;user-select:none;flex-shrink:0;height:1rem;width:1rem;color:#2563eb;background-color:#fff;border-color:#6b7280;border-width:1px;--tw-shadow:0 0 #0000}input:where([type=checkbox]){border-radius:0}input:where([type=radio]){border-radius:100%}input:where([type=checkbox]):focus,input:where([type=radio]):focus{outline:2px solid transparent;outline-offset:2px;--tw-ring-inset:var(--tw-empty,/*!*/ /*!*/);--tw-ring-offset-width:2px;--tw-ring-offset-color:#fff;--tw-ring-color:#2563eb;--tw-ring-offset-shadow:var(--tw-ring-inset) 0 0 0 var(--tw-ring-offset-width) var(--tw-ring-offset-color);--tw-ring-shadow:var(--tw-ring-inset) 0 0 0 calc(2px + var(--tw-ring-offset-width)) var(--tw-ring-color);box-shadow:var(--tw-ring-offset-shadow),var(--tw-ring-shadow),var(--tw-shadow)}input:where([type=checkbox]):checked,input:where([type=radio]):checked{border-color:transparent;background-color:currentColor;background-size:100% 100%;background-position:50%;background-repeat:no-repeat}input:where([type=checkbox]):checked{background-image:url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='%23fff' viewBox='0 0 16 16'%3E%3Cpath d='M12.207 4.793a1 1 0 0 1 0 1.414l-5 5a1 1 0 0 1-1.414 0l-2-2a1 1 0 0 1 1.414-1.414L6.5 9.086l4.293-4.293a1 1 0 0 1 1.414 0'/%3E%3C/svg%3E")}@media (forced-colors:active) {input:where([type=checkbox]):checked{-webkit-appearance:auto;-moz-appearance:auto;appearance:auto}}input:where([type=radio]):checked{background-image:url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='%23fff' viewBox='0 0 16 16'%3E%3Ccircle cx='8' cy='8' r='3'/%3E%3C/svg%3E")}@media (forced-colors:active) {input:where([type=radio]):checked{-webkit-appearance:auto;-moz-appearance:auto;appearance:auto}}input:where([type=checkbox]):checked:focus,input:where([type=checkbox]):checked:hover,input:where([type=radio]):checked:focus,input:where([type=radio]):checked:hover{border-color:transparent;background-color:currentColor}input:where([type=checkbox]):indeterminate{background-image:url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 16 16'%3E%3Cpath stroke='%23fff' stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M4 8h8'/%3E%3C/svg%3E");border-color:transparent;background-color:currentColor;background-size:100% 100%;background-position:50%;background-repeat:no-repeat}@media (forced-colors:active) {input:where([type=checkbox]):indeterminate{-webkit-appearance:auto;-moz-appearance:auto;appearance:auto}}input:where([type=checkbox]):indeterminate:focus,input:where([type=checkbox]):indeterminate:hover{border-color:transparent;background-color:currentColor}input:where([type=file]){background:unset;border-color:inherit;border-width:0;border-radius:0;padding:0;font-size:unset;line-height:inherit}input:where([type=file]):focus{outline:1px solid ButtonText;outline:1px auto -webkit-focus-ring-color}.container{width:100%}@media (min-width:640px){.container{max-width:640px}}@media (min-width:768px){.container{max-width:768px}}@media (min-width:1024px){.container{max-width:1024px}}@media (min-width:1280px){.container{max-width:1280px}}@media (min-width:1536px){.container{max-width:1536px}}.form-checkbox,.form-radio{-webkit-appearance:none;-moz-appearance:none;appearance:none;padding:0;-webkit-print-color-adjust:exact;print-color-adjust:exact;display:inline-block;vertical-align:middle;background-origin:border-box;-webkit-user-select:none;-moz-user-select:none;user-select:none;flex-shrink:0;height:1rem;width:1rem;color:#2563eb;background-color:#fff;border-color:#6b7280;border-width:1px;--tw-shadow:0 0 #0000}.form-checkbox{border-radius:0}.form-radio{border-radius:100%}.form-checkbox:focus,.form-radio:focus{outline:2px solid transparent;outline-offset:2px;--tw-ring-inset:var(--tw-empty,/*!*/ /*!*/);--tw-ring-offset-width:2px;--tw-ring-offset-color:#fff;--tw-ring-color:#2563eb;--tw-ring-offset-shadow:var(--tw-ring-inset) 0 0 0 var(--tw-ring-offset-width) var(--tw-ring-offset-color);--tw-ring-shadow:var(--tw-ring-inset) 0 0 0 calc(2px + var(--tw-ring-offset-width)) var(--tw-ring-color);box-shadow:var(--tw-ring-offset-shadow),var(--tw-ring-shadow),var(--tw-shadow)}.form-checkbox:checked,.form-radio:checked{border-color:transparent;background-color:currentColor;background-size:100% 100%;background-position:50%;background-repeat:no-repeat}.form-checkbox:checked{background-image:url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='%23fff' viewBox='0 0 16 16'%3E%3Cpath d='M12.207 4.793a1 1 0 0 1 0 1.414l-5 5a1 1 0 0 1-1.414 0l-2-2a1 1 0 0 1 1.414-1.414L6.5 9.086l4.293-4.293a1 1 0 0 1 1.414 0'/%3E%3C/svg%3E")}@media (forced-colors:active) {.form-checkbox:checked{-webkit-appearance:auto;-moz-appearance:auto;appearance:auto}}.form-radio:checked{background-image:url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='%23fff' viewBox='0 0 16 16'%3E%3Ccircle cx='8' cy='8' r='3'/%3E%3C/svg%3E")}@media (forced-colors:active) {.form-radio:checked{-webkit-appearance:auto;-moz-appearance:auto;appearance:auto}}.form-checkbox:checked:focus,.form-checkbox:checked:hover,.form-radio:checked:focus,.form-radio:checked:hover{border-color:transparent;background-color:currentColor}.form-checkbox:indeterminate{background-image:url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 16 16'%3E%3Cpath stroke='%23fff' stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M4 8h8'/%3E%3C/svg%3E");border-color:transparent;background-color:currentColor;background-size:100% 100%;background-position:50%;background-repeat:no-repeat}@media (forced-colors:active) {.form-checkbox:indeterminate{-webkit-appearance:auto;-moz-appearance:auto;appearance:auto}}.form-checkbox:indeterminate:focus,.form-checkbox:indeterminate:hover{border-color:transparent;background-color:currentColor}@media (max-width:767px){.table-responsive thead{display:none}.table-responsive tbody,.table-responsive td,.table-responsive tr{display:block;width:100%}.table-responsive tr{margin-bottom:1rem;overflow:hidden;border-radius:.75rem;border:1px solid #e5e7eb;background-color:#fff;box-shadow:0 1px 2px 0 rgba(0,0,0,.05)}.table-responsive td{display:flex;align-items:flex-start;justify-content:flex-start;gap:.75rem;border-bottom:1px solid #f3f4f6;padding:.75rem 1rem}.table-responsive td:last-of-type{border-bottom:none}.table-responsive td:before{content:attr(data-label);flex-shrink:0;min-width:4rem;font-weight:600;color:#4b5563}.subscription-data-table.table-responsive td:first-child:before{min-width:5.25rem}.table-responsive .hover-wrap-narrow,.table-responsive .notes-wrap-narrow{max-width:180px;text-align:right}.table-responsive .td-content-wrapper .notes-preview{text-align:right}}.subscription-table-card{width:100%;overflow:hidden;border-radius:.75rem;border:1px solid rgba(229,231,235,.92);background-color:#fff;box-shadow:0 1px 3px rgba(15,23,42,.06)}.subscription-data-table .action-buttons-wrapper{display:flex;flex-wrap:wrap;gap:.5rem;justify-content:flex-start;align-items:center}@media (min-width:768px){.subscription-data-table{width:100%;table-layout:fixed;border-collapse:separate;border-spacing:0}.subscription-data-table thead{background-color:#f7f8f9}.subscription-data-table thead th{border-bottom:1px solid #eee;padding:1rem .75rem;text-align:left;font-size:.875rem;line-height:1.25rem;font-weight:600;color:#111827;vertical-align:middle}.subscription-data-table tbody td{border-bottom:1px solid #f0f0f0;padding:1rem .75rem;vertical-align:top;background-color:#fff}.subscription-data-table tbody tr:last-child td{border-bottom:none}.subscription-data-table tbody tr.subscription-row:hover td{background-color:#fafafa}.subscription-data-table tbody tr.subscription-row-inactive td{background-color:rgba(249,250,251,.85)}.subscription-data-table tbody tr.subscription-row-inactive:hover td{background-color:rgba(243,244,246,.9)}.subscription-data-table tbody td:nth-child(3),.subscription-data-table thead th:nth-child(3){width:28%;min-width:280px;box-sizing:border-box}.subscription-data-table tbody td:last-child,.subscription-data-table thead th:last-child{width:160px;box-sizing:border-box}}@media (max-width:767px){#systemTimeDisplay{display:none!important}}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border-width:0}.pointer-events-none{pointer-events:none}.pointer-events-auto{pointer-events:auto}.visible{visibility:visible}.invisible{visibility:hidden}.fixed{position:fixed}.absolute{position:absolute}.relative{position:relative}.inset-0{inset:0}.inset-y-0{top:0;bottom:0}.inset-y-1{top:.25rem;bottom:.25rem}.bottom-0{bottom:0}.left-0{left:0}.left-0\\.5{left:.125rem}.left-3{left:.75rem}.right-0{right:0}.right-1{right:.25rem}.right-5{right:1.25rem}.top-0{top:0}.top-1{top:.25rem}.top-1\\/2{top:50%}.top-5{top:1.25rem}.top-full{top:100%}.z-0{z-index:0}.z-10{z-index:10}.z-20{z-index:20}.z-30{z-index:30}.z-40{z-index:40}.z-50{z-index:50}.z-\\[1000\\]{z-index:1000}.z-\\[100\\]{z-index:100}.z-\\[9999\\]{z-index:9999}.col-start-1{grid-column-start:1}.row-start-1{grid-row-start:1}.mx-1{margin-left:.25rem;margin-right:.25rem}.mx-4{margin-left:1rem;margin-right:1rem}.mx-auto{margin-left:auto;margin-right:auto}.my-3{margin-top:.75rem;margin-bottom:.75rem}.mb-1{margin-bottom:.25rem}.mb-1\\.5{margin-bottom:.375rem}.mb-2{margin-bottom:.5rem}.mb-3{margin-bottom:.75rem}.mb-4{margin-bottom:1rem}.mb-6{margin-bottom:1.5rem}.ml-1{margin-left:.25rem}.ml-2{margin-left:.5rem}.ml-4{margin-left:1rem}.mr-1{margin-right:.25rem}.mr-2{margin-right:.5rem}.mt-0{margin-top:0}.mt-0\\.5{margin-top:.125rem}.mt-1{margin-top:.25rem}.mt-2{margin-top:.5rem}.mt-3{margin-top:.75rem}.mt-4{margin-top:1rem}.mt-6{margin-top:1.5rem}.line-clamp-2{overflow:hidden;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2}.block{display:block}.inline{display:inline}.flex{display:flex}.inline-flex{display:inline-flex}.table{display:table}.grid{display:grid}.\\!hidden{display:none!important}.hidden{display:none}.h-10{height:2.5rem}.h-16{height:4rem}.h-3{height:.75rem}.h-3\\.5{height:.875rem}.h-4{height:1rem}.h-5{height:1.25rem}.h-6{height:1.5rem}.h-8{height:2rem}.h-9{height:2.25rem}.max-h-60{max-height:15rem}.max-h-screen{max-height:100vh}.min-h-9{min-height:2.25rem}.min-h-dvh{min-height:100dvh}.min-h-screen{min-height:100vh}.w-10{width:2.5rem}.w-12{width:3rem}.w-3{width:.75rem}.w-3\\.5{width:.875rem}.w-32{width:8rem}.w-4{width:1rem}.w-5{width:1.25rem}.w-6{width:1.5rem}.w-8{width:2rem}.w-9{width:2.25rem}.w-\\[300px\\]{width:300px}.w-fit{width:-moz-fit-content;width:fit-content}.w-full{width:100%}.min-w-0{min-width:0}.min-w-9{min-width:2.25rem}.min-w-\\[200px\\]{min-width:200px}.max-w-2xl{max-width:42rem}.max-w-4xl{max-width:56rem}.max-w-7xl{max-width:80rem}.max-w-full{max-width:100%}.max-w-sm{max-width:24rem}.max-w-xs{max-width:20rem}.flex-1{flex:1 1 0%}.flex-shrink{flex-shrink:1}.shrink-0{flex-shrink:0}.table-fixed{table-layout:fixed}.-translate-y-1{--tw-translate-y:-0.25rem}.-translate-y-1,.-translate-y-1\\/2{transform:translate(var(--tw-translate-x),var(--tw-translate-y)) rotate(var(--tw-rotate)) skewX(var(--tw-skew-x)) skewY(var(--tw-skew-y)) scaleX(var(--tw-scale-x)) scaleY(var(--tw-scale-y))}.-translate-y-1\\/2{--tw-translate-y:-50%}.translate-x-0{--tw-translate-x:0px}.translate-x-0,.translate-x-\\[120\\%\\]{transform:translate(var(--tw-translate-x),var(--tw-translate-y)) rotate(var(--tw-rotate)) skewX(var(--tw-skew-x)) skewY(var(--tw-skew-y)) scaleX(var(--tw-scale-x)) scaleY(var(--tw-scale-y))}.translate-x-\\[120\\%\\]{--tw-translate-x:120%}.rotate-180{--tw-rotate:180deg}.rotate-180,.scale-105{transform:translate(var(--tw-translate-x),var(--tw-translate-y)) rotate(var(--tw-rotate)) skewX(var(--tw-skew-x)) skewY(var(--tw-skew-y)) scaleX(var(--tw-scale-x)) scaleY(var(--tw-scale-y))}.scale-105{--tw-scale-x:1.05;--tw-scale-y:1.05}.transform{transform:translate(var(--tw-translate-x),var(--tw-translate-y)) rotate(var(--tw-rotate)) skewX(var(--tw-skew-x)) skewY(var(--tw-skew-y)) scaleX(var(--tw-scale-x)) scaleY(var(--tw-scale-y))}@keyframes spin{to{transform:rotate(1turn)}}.animate-spin{animation:spin 1s linear infinite}.cursor-not-allowed{cursor:not-allowed}.cursor-pointer{cursor:pointer}.touch-manipulation{touch-action:manipulation}.select-none{-webkit-user-select:none;-moz-user-select:none;user-select:none}.list-decimal{list-style-type:decimal}.grid-cols-1{grid-template-columns:repeat(1,minmax(0,1fr))}.grid-cols-2{grid-template-columns:repeat(2,minmax(0,1fr))}.grid-cols-3{grid-template-columns:repeat(3,minmax(0,1fr))}.grid-cols-7{grid-template-columns:repeat(7,minmax(0,1fr))}.flex-col{flex-direction:column}.flex-wrap{flex-wrap:wrap}.items-start{align-items:flex-start}.items-center{align-items:center}.justify-end{justify-content:flex-end}.justify-center{justify-content:center}.justify-between{justify-content:space-between}.gap-1{gap:.25rem}.gap-1\\.5{gap:.375rem}.gap-2{gap:.5rem}.gap-3{gap:.75rem}.gap-4{gap:1rem}.gap-5{gap:1.25rem}.gap-6{gap:1.5rem}.gap-8{gap:2rem}.gap-x-2{-moz-column-gap:.5rem;column-gap:.5rem}.gap-y-1{row-gap:.25rem}.gap-y-2{row-gap:.5rem}.space-x-2>:not([hidden])~:not([hidden]){--tw-space-x-reverse:0;margin-right:calc(.5rem*var(--tw-space-x-reverse));margin-left:calc(.5rem*(1 - var(--tw-space-x-reverse)))}.space-x-3>:not([hidden])~:not([hidden]){--tw-space-x-reverse:0;margin-right:calc(.75rem*var(--tw-space-x-reverse));margin-left:calc(.75rem*(1 - var(--tw-space-x-reverse)))}.space-x-4>:not([hidden])~:not([hidden]){--tw-space-x-reverse:0;margin-right:calc(1rem*var(--tw-space-x-reverse));margin-left:calc(1rem*(1 - var(--tw-space-x-reverse)))}.space-x-6>:not([hidden])~:not([hidden]){--tw-space-x-reverse:0;margin-right:calc(1.5rem*var(--tw-space-x-reverse));margin-left:calc(1.5rem*(1 - var(--tw-space-x-reverse)))}.space-y-1>:not([hidden])~:not([hidden]){--tw-space-y-reverse:0;margin-top:calc(.25rem*(1 - var(--tw-space-y-reverse)));margin-bottom:calc(.25rem*var(--tw-space-y-reverse))}.space-y-2>:not([hidden])~:not([hidden]){--tw-space-y-reverse:0;margin-top:calc(.5rem*(1 - var(--tw-space-y-reverse)));margin-bottom:calc(.5rem*var(--tw-space-y-reverse))}.space-y-4>:not([hidden])~:not([hidden]){--tw-space-y-reverse:0;margin-top:calc(1rem*(1 - var(--tw-space-y-reverse)));margin-bottom:calc(1rem*var(--tw-space-y-reverse))}.space-y-6>:not([hidden])~:not([hidden]){--tw-space-y-reverse:0;margin-top:calc(1.5rem*(1 - var(--tw-space-y-reverse)));margin-bottom:calc(1.5rem*var(--tw-space-y-reverse))}.space-y-8>:not([hidden])~:not([hidden]){--tw-space-y-reverse:0;margin-top:calc(2rem*(1 - var(--tw-space-y-reverse)));margin-bottom:calc(2rem*var(--tw-space-y-reverse))}.divide-y>:not([hidden])~:not([hidden]){--tw-divide-y-reverse:0;border-top-width:calc(1px*(1 - var(--tw-divide-y-reverse)));border-bottom-width:calc(1px*var(--tw-divide-y-reverse))}.divide-gray-200>:not([hidden])~:not([hidden]){--tw-divide-opacity:1;border-color:rgb(229 231 235/var(--tw-divide-opacity,1))}.self-center{align-self:center}.justify-self-start{justify-self:start}.justify-self-end{justify-self:end}.overflow-hidden{overflow:hidden}.overflow-visible{overflow:visible}.overflow-x-auto{overflow-x:auto}.overflow-y-auto{overflow-y:auto}.overflow-x-hidden{overflow-x:hidden}.truncate{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.whitespace-normal{white-space:normal}.whitespace-nowrap{white-space:nowrap}.break-words{overflow-wrap:break-word}.rounded{border-radius:.25rem}.rounded-full{border-radius:9999px}.rounded-lg{border-radius:.5rem}.rounded-md{border-radius:.375rem}.rounded-xl{border-radius:.75rem}.rounded-t-lg{border-top-left-radius:.5rem;border-top-right-radius:.5rem}.border{border-width:1px}.border-0{border-width:0}.border-2{border-width:2px}.border-b{border-bottom-width:1px}.border-b-2{border-bottom-width:2px}.border-t{border-top-width:1px}.border-amber-200{--tw-border-opacity:1;border-color:rgb(253 230 138/var(--tw-border-opacity,1))}.border-amber-300{--tw-border-opacity:1;border-color:rgb(252 211 77/var(--tw-border-opacity,1))}.border-amber-600{--tw-border-opacity:1;border-color:rgb(217 119 6/var(--tw-border-opacity,1))}.border-emerald-200{--tw-border-opacity:1;border-color:rgb(167 243 208/var(--tw-border-opacity,1))}.border-gray-100{--tw-border-opacity:1;border-color:rgb(243 244 246/var(--tw-border-opacity,1))}.border-gray-200{--tw-border-opacity:1;border-color:rgb(229 231 235/var(--tw-border-opacity,1))}.border-gray-200\\/80{border-color:rgba(229,231,235,.8)}.border-gray-300{--tw-border-opacity:1;border-color:rgb(209 213 219/var(--tw-border-opacity,1))}.border-indigo-100{--tw-border-opacity:1;border-color:rgb(224 231 255/var(--tw-border-opacity,1))}.border-indigo-200{--tw-border-opacity:1;border-color:rgb(199 210 254/var(--tw-border-opacity,1))}.border-indigo-300{--tw-border-opacity:1;border-color:rgb(165 180 252/var(--tw-border-opacity,1))}.border-indigo-400{--tw-border-opacity:1;border-color:rgb(129 140 248/var(--tw-border-opacity,1))}.border-indigo-500{--tw-border-opacity:1;border-color:rgb(99 102 241/var(--tw-border-opacity,1))}.border-indigo-600{--tw-border-opacity:1;border-color:rgb(79 70 229/var(--tw-border-opacity,1))}.border-red-200{--tw-border-opacity:1;border-color:rgb(254 202 202/var(--tw-border-opacity,1))}.border-red-300{--tw-border-opacity:1;border-color:rgb(252 165 165/var(--tw-border-opacity,1))}.border-red-500{--tw-border-opacity:1;border-color:rgb(239 68 68/var(--tw-border-opacity,1))}.border-slate-100{--tw-border-opacity:1;border-color:rgb(241 245 249/var(--tw-border-opacity,1))}.border-slate-200{--tw-border-opacity:1;border-color:rgb(226 232 240/var(--tw-border-opacity,1))}.border-transparent{border-color:transparent}.bg-amber-500{--tw-bg-opacity:1;background-color:rgb(245 158 11/var(--tw-bg-opacity,1))}.bg-emerald-600{--tw-bg-opacity:1;background-color:rgb(5 150 105/var(--tw-bg-opacity,1))}.bg-gray-100{--tw-bg-opacity:1;background-color:rgb(243 244 246/var(--tw-bg-opacity,1))}.bg-gray-300{--tw-bg-opacity:1;background-color:rgb(209 213 219/var(--tw-bg-opacity,1))}.bg-gray-50{--tw-bg-opacity:1;background-color:rgb(249 250 251/var(--tw-bg-opacity,1))}.bg-gray-50\\/90{background-color:rgba(249,250,251,.9)}.bg-gray-500{--tw-bg-opacity:1;background-color:rgb(107 114 128/var(--tw-bg-opacity,1))}.bg-gray-600{--tw-bg-opacity:1;background-color:rgb(75 85 99/var(--tw-bg-opacity,1))}.bg-gray-900{--tw-bg-opacity:1;background-color:rgb(17 24 39/var(--tw-bg-opacity,1))}.bg-green-100{--tw-bg-opacity:1;background-color:rgb(220 252 231/var(--tw-bg-opacity,1))}.bg-green-500{--tw-bg-opacity:1;background-color:rgb(34 197 94/var(--tw-bg-opacity,1))}.bg-indigo-100{--tw-bg-opacity:1;background-color:rgb(224 231 255/var(--tw-bg-opacity,1))}.bg-indigo-50{--tw-bg-opacity:1;background-color:rgb(238 242 255/var(--tw-bg-opacity,1))}.bg-indigo-600{--tw-bg-opacity:1;background-color:rgb(79 70 229/var(--tw-bg-opacity,1))}.bg-red-50{--tw-bg-opacity:1;background-color:rgb(254 242 242/var(--tw-bg-opacity,1))}.bg-red-500{--tw-bg-opacity:1;background-color:rgb(239 68 68/var(--tw-bg-opacity,1))}.bg-sky-500{--tw-bg-opacity:1;background-color:rgb(14 165 233/var(--tw-bg-opacity,1))}.bg-sky-600{--tw-bg-opacity:1;background-color:rgb(2 132 199/var(--tw-bg-opacity,1))}.bg-slate-600{--tw-bg-opacity:1;background-color:rgb(71 85 105/var(--tw-bg-opacity,1))}.bg-slate-900{--tw-bg-opacity:1;background-color:rgb(15 23 42/var(--tw-bg-opacity,1))}.bg-slate-900\\/30{background-color:rgba(15,23,42,.3)}.bg-transparent{background-color:transparent}.bg-white{--tw-bg-opacity:1;background-color:rgb(255 255 255/var(--tw-bg-opacity,1))}.bg-white\\/95{background-color:hsla(0,0%,100%,.95)}.bg-yellow-500{--tw-bg-opacity:1;background-color:rgb(234 179 8/var(--tw-bg-opacity,1))}.bg-opacity-50{--tw-bg-opacity:0.5}.p-0{padding:0}.p-0\\.5{padding:.125rem}.p-1{padding:.25rem}.p-2{padding:.5rem}.p-3{padding:.75rem}.p-4{padding:1rem}.p-5{padding:1.25rem}.p-6{padding:1.5rem}.p-8{padding:2rem}.\\!py-1{padding-top:.25rem!important;padding-bottom:.25rem!important}.\\!py-2{padding-top:.5rem!important;padding-bottom:.5rem!important}.px-1{padding-left:.25rem;padding-right:.25rem}.px-2{padding-left:.5rem;padding-right:.5rem}.px-2\\.5{padding-left:.625rem;padding-right:.625rem}.px-3{padding-left:.75rem;padding-right:.75rem}.px-4{padding-left:1rem;padding-right:1rem}.px-5{padding-left:1.25rem;padding-right:1.25rem}.px-6{padding-left:1.5rem;padding-right:1.5rem}.py-0{padding-top:0;padding-bottom:0}.py-0\\.5{padding-top:.125rem;padding-bottom:.125rem}.py-1{padding-top:.25rem;padding-bottom:.25rem}.py-2{padding-top:.5rem;padding-bottom:.5rem}.py-2\\.5{padding-top:.625rem;padding-bottom:.625rem}.py-3{padding-top:.75rem;padding-bottom:.75rem}.py-4{padding-top:1rem;padding-bottom:1rem}.py-8{padding-top:2rem;padding-bottom:2rem}.pb-28{padding-bottom:7rem}.pb-6{padding-bottom:1.5rem}.pb-8{padding-bottom:2rem}.pl-10{padding-left:2.5rem}.pl-3{padding-left:.75rem}.pl-5{padding-left:1.25rem}.pr-10{padding-right:2.5rem}.pr-11{padding-right:2.75rem}.pr-14{padding-right:3.5rem}.pr-3{padding-right:.75rem}.pr-9{padding-right:2.25rem}.pt-1{padding-top:.25rem}.pt-2{padding-top:.5rem}.pt-24{padding-top:6rem}.pt-3{padding-top:.75rem}.pt-4{padding-top:1rem}.pt-6{padding-top:1.5rem}.pt-8{padding-top:2rem}.text-left{text-align:left}.text-center{text-align:center}.align-middle{vertical-align:middle}.font-sans{font-family:ui-sans-serif,system-ui,sans-serif,Apple Color Emoji,Segoe UI Emoji,Segoe UI Symbol,Noto Color Emoji}.text-2xl{font-size:1.5rem;line-height:2rem}.text-\\[11px\\]{font-size:11px}.text-\\[9px\\]{font-size:9px}.text-base{font-size:1rem;line-height:1.5rem}.text-lg{font-size:1.125rem;line-height:1.75rem}.text-sm{font-size:.875rem;line-height:1.25rem}.text-xl{font-size:1.25rem;line-height:1.75rem}.text-xs{font-size:.75rem;line-height:1rem}.font-bold{font-weight:700}.font-medium{font-weight:500}.font-normal{font-weight:400}.font-semibold{font-weight:600}.uppercase{text-transform:uppercase}.italic{font-style:italic}.tabular-nums{--tw-numeric-spacing:tabular-nums;font-variant-numeric:var(--tw-ordinal) var(--tw-slashed-zero) var(--tw-numeric-figure) var(--tw-numeric-spacing) var(--tw-numeric-fraction)}.leading-none{line-height:1}.leading-relaxed{line-height:1.625}.leading-snug{line-height:1.375}.leading-tight{line-height:1.25}.tracking-tight{letter-spacing:-.025em}.tracking-wide{letter-spacing:.025em}.tracking-wider{letter-spacing:.05em}.text-amber-500{--tw-text-opacity:1;color:rgb(245 158 11/var(--tw-text-opacity,1))}.text-amber-600{--tw-text-opacity:1;color:rgb(217 119 6/var(--tw-text-opacity,1))}.text-amber-800{--tw-text-opacity:1;color:rgb(146 64 14/var(--tw-text-opacity,1))}.text-blue-500{--tw-text-opacity:1;color:rgb(59 130 246/var(--tw-text-opacity,1))}.text-blue-600{--tw-text-opacity:1;color:rgb(37 99 235/var(--tw-text-opacity,1))}.text-emerald-500{--tw-text-opacity:1;color:rgb(16 185 129/var(--tw-text-opacity,1))}.text-emerald-600{--tw-text-opacity:1;color:rgb(5 150 105/var(--tw-text-opacity,1))}.text-emerald-700{--tw-text-opacity:1;color:rgb(4 120 87/var(--tw-text-opacity,1))}.text-gray-300{--tw-text-opacity:1;color:rgb(209 213 219/var(--tw-text-opacity,1))}.text-gray-400{--tw-text-opacity:1;color:rgb(156 163 175/var(--tw-text-opacity,1))}.text-gray-500{--tw-text-opacity:1;color:rgb(107 114 128/var(--tw-text-opacity,1))}.text-gray-600{--tw-text-opacity:1;color:rgb(75 85 99/var(--tw-text-opacity,1))}.text-gray-700{--tw-text-opacity:1;color:rgb(55 65 81/var(--tw-text-opacity,1))}.text-gray-800{--tw-text-opacity:1;color:rgb(31 41 55/var(--tw-text-opacity,1))}.text-gray-900{--tw-text-opacity:1;color:rgb(17 24 39/var(--tw-text-opacity,1))}.text-green-600{--tw-text-opacity:1;color:rgb(22 163 74/var(--tw-text-opacity,1))}.text-indigo-500{--tw-text-opacity:1;color:rgb(99 102 241/var(--tw-text-opacity,1))}.text-indigo-600{--tw-text-opacity:1;color:rgb(79 70 229/var(--tw-text-opacity,1))}.text-indigo-700{--tw-text-opacity:1;color:rgb(67 56 202/var(--tw-text-opacity,1))}.text-indigo-800{--tw-text-opacity:1;color:rgb(55 48 163/var(--tw-text-opacity,1))}.text-inherit{color:inherit}.text-purple-600{--tw-text-opacity:1;color:rgb(147 51 234/var(--tw-text-opacity,1))}.text-red-500{--tw-text-opacity:1;color:rgb(239 68 68/var(--tw-text-opacity,1))}.text-red-600{--tw-text-opacity:1;color:rgb(220 38 38/var(--tw-text-opacity,1))}.text-red-700{--tw-text-opacity:1;color:rgb(185 28 28/var(--tw-text-opacity,1))}.text-slate-400{--tw-text-opacity:1;color:rgb(148 163 184/var(--tw-text-opacity,1))}.text-slate-600{--tw-text-opacity:1;color:rgb(71 85 105/var(--tw-text-opacity,1))}.text-white{--tw-text-opacity:1;color:rgb(255 255 255/var(--tw-text-opacity,1))}.text-white\\/90{color:hsla(0,0%,100%,.9)}.antialiased{-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}.opacity-0{opacity:0}.opacity-100{opacity:1}.opacity-50{opacity:.5}.opacity-60{opacity:.6}.opacity-65{opacity:.65}.opacity-70{opacity:.7}.shadow-\\[0_-4px_6px_-1px_rgba\\(0\\2c 0\\2c 0\\2c 0\\.06\\)\\]{--tw-shadow:0 -4px 6px -1px rgba(0,0,0,.06);--tw-shadow-colored:0 -4px 6px -1px var(--tw-shadow-color)}.shadow-\\[0_-4px_6px_-1px_rgba\\(0\\2c 0\\2c 0\\2c 0\\.06\\)\\],.shadow-lg{box-shadow:var(--tw-ring-offset-shadow,0 0 #0000),var(--tw-ring-shadow,0 0 #0000),var(--tw-shadow)}.shadow-lg{--tw-shadow:0 10px 15px -3px rgba(0,0,0,.1),0 4px 6px -4px rgba(0,0,0,.1);--tw-shadow-colored:0 10px 15px -3px var(--tw-shadow-color),0 4px 6px -4px var(--tw-shadow-color)}.shadow-md{--tw-shadow:0 4px 6px -1px rgba(0,0,0,.1),0 2px 4px -2px rgba(0,0,0,.1);--tw-shadow-colored:0 4px 6px -1px var(--tw-shadow-color),0 2px 4px -2px var(--tw-shadow-color)}.shadow-md,.shadow-sm{box-shadow:var(--tw-ring-offset-shadow,0 0 #0000),var(--tw-ring-shadow,0 0 #0000),var(--tw-shadow)}.shadow-sm{--tw-shadow:0 1px 2px 0 rgba(0,0,0,.05);--tw-shadow-colored:0 1px 2px 0 var(--tw-shadow-color)}.shadow-xl{--tw-shadow:0 20px 25px -5px rgba(0,0,0,.1),0 8px 10px -6px rgba(0,0,0,.1);--tw-shadow-colored:0 20px 25px -5px var(--tw-shadow-color),0 8px 10px -6px var(--tw-shadow-color);box-shadow:var(--tw-ring-offset-shadow,0 0 #0000),var(--tw-ring-shadow,0 0 #0000),var(--tw-shadow)}.outline-none{outline:2px solid transparent;outline-offset:2px}.outline{outline-style:solid}.ring{--tw-ring-offset-shadow:var(--tw-ring-inset) 0 0 0 var(--tw-ring-offset-width) var(--tw-ring-offset-color);--tw-ring-shadow:var(--tw-ring-inset) 0 0 0 calc(3px + var(--tw-ring-offset-width)) var(--tw-ring-color)}.ring,.ring-1{box-shadow:var(--tw-ring-offset-shadow),var(--tw-ring-shadow),var(--tw-shadow,0 0 #0000)}.ring-1{--tw-ring-offset-shadow:var(--tw-ring-inset) 0 0 0 var(--tw-ring-offset-width) var(--tw-ring-offset-color);--tw-ring-shadow:var(--tw-ring-inset) 0 0 0 calc(1px + var(--tw-ring-offset-width)) var(--tw-ring-color)}.ring-2{--tw-ring-offset-shadow:var(--tw-ring-inset) 0 0 0 var(--tw-ring-offset-width) var(--tw-ring-offset-color);--tw-ring-shadow:var(--tw-ring-inset) 0 0 0 calc(2px + var(--tw-ring-offset-width)) var(--tw-ring-color);box-shadow:var(--tw-ring-offset-shadow),var(--tw-ring-shadow),var(--tw-shadow,0 0 #0000)}.ring-indigo-100{--tw-ring-opacity:1;--tw-ring-color:rgb(224 231 255/var(--tw-ring-opacity,1))}.ring-indigo-200{--tw-ring-opacity:1;--tw-ring-color:rgb(199 210 254/var(--tw-ring-opacity,1))}.ring-indigo-500{--tw-ring-opacity:1;--tw-ring-color:rgb(99 102 241/var(--tw-ring-opacity,1))}.ring-indigo-500\\/40{--tw-ring-color:rgba(99,102,241,.4)}.ring-red-500{--tw-ring-opacity:1;--tw-ring-color:rgb(239 68 68/var(--tw-ring-opacity,1))}.ring-red-500\\/20{--tw-ring-color:rgba(239,68,68,.2)}.blur{--tw-blur:blur(8px)}.blur,.filter{filter:var(--tw-blur) var(--tw-brightness) var(--tw-contrast) var(--tw-grayscale) var(--tw-hue-rotate) var(--tw-invert) var(--tw-saturate) var(--tw-sepia) var(--tw-drop-shadow)}.backdrop-blur-sm{--tw-backdrop-blur:blur(4px)}.backdrop-blur-sm,.backdrop-filter{-webkit-backdrop-filter:var(--tw-backdrop-blur) var(--tw-backdrop-brightness) var(--tw-backdrop-contrast) var(--tw-backdrop-grayscale) var(--tw-backdrop-hue-rotate) var(--tw-backdrop-invert) var(--tw-backdrop-opacity) var(--tw-backdrop-saturate) var(--tw-backdrop-sepia);backdrop-filter:var(--tw-backdrop-blur) var(--tw-backdrop-brightness) var(--tw-backdrop-contrast) var(--tw-backdrop-grayscale) var(--tw-backdrop-hue-rotate) var(--tw-backdrop-invert) var(--tw-backdrop-opacity) var(--tw-backdrop-saturate) var(--tw-backdrop-sepia)}.transition{transition-property:color,background-color,border-color,text-decoration-color,fill,stroke,opacity,box-shadow,transform,filter,-webkit-backdrop-filter;transition-property:color,background-color,border-color,text-decoration-color,fill,stroke,opacity,box-shadow,transform,filter,backdrop-filter;transition-property:color,background-color,border-color,text-decoration-color,fill,stroke,opacity,box-shadow,transform,filter,backdrop-filter,-webkit-backdrop-filter;transition-timing-function:cubic-bezier(.4,0,.2,1);transition-duration:.15s}.transition-opacity{transition-property:opacity;transition-timing-function:cubic-bezier(.4,0,.2,1);transition-duration:.15s}.transition-transform{transition-property:transform;transition-timing-function:cubic-bezier(.4,0,.2,1);transition-duration:.15s}.duration-200{transition-duration:.2s}.duration-300{transition-duration:.3s}.ease-out{transition-timing-function:cubic-bezier(0,0,.2,1)}.\\[appearance\\:textfield\\]{-webkit-appearance:textfield;-moz-appearance:textfield;appearance:textfield}input.login-password-field::-webkit-credentials-auto-fill-button{display:none!important}input.login-password-field::-webkit-textfield-decoration-container{pointer-events:none}input.login-password-field::-ms-clear,input.login-password-field::-ms-reveal{display:none}.placeholder\\:text-gray-400::-moz-placeholder{--tw-text-opacity:1;color:rgb(156 163 175/var(--tw-text-opacity,1))}.placeholder\\:text-gray-400::placeholder{--tw-text-opacity:1;color:rgb(156 163 175/var(--tw-text-opacity,1))}.hover\\:scale-\\[1\\.02\\]:hover{--tw-scale-x:1.02;--tw-scale-y:1.02;transform:translate(var(--tw-translate-x),var(--tw-translate-y)) rotate(var(--tw-rotate)) skewX(var(--tw-skew-x)) skewY(var(--tw-skew-y)) scaleX(var(--tw-scale-x)) scaleY(var(--tw-scale-y))}.hover\\:border-indigo-400:hover{--tw-border-opacity:1;border-color:rgb(129 140 248/var(--tw-border-opacity,1))}.hover\\:bg-amber-600:hover{--tw-bg-opacity:1;background-color:rgb(217 119 6/var(--tw-bg-opacity,1))}.hover\\:bg-emerald-700:hover{--tw-bg-opacity:1;background-color:rgb(4 120 87/var(--tw-bg-opacity,1))}.hover\\:bg-gray-100:hover{--tw-bg-opacity:1;background-color:rgb(243 244 246/var(--tw-bg-opacity,1))}.hover\\:bg-gray-50:hover{--tw-bg-opacity:1;background-color:rgb(249 250 251/var(--tw-bg-opacity,1))}.hover\\:bg-indigo-100:hover{--tw-bg-opacity:1;background-color:rgb(224 231 255/var(--tw-bg-opacity,1))}.hover\\:bg-indigo-50:hover{--tw-bg-opacity:1;background-color:rgb(238 242 255/var(--tw-bg-opacity,1))}.hover\\:bg-indigo-700:hover{--tw-bg-opacity:1;background-color:rgb(67 56 202/var(--tw-bg-opacity,1))}.hover\\:bg-red-600:hover{--tw-bg-opacity:1;background-color:rgb(220 38 38/var(--tw-bg-opacity,1))}.hover\\:bg-sky-600:hover{--tw-bg-opacity:1;background-color:rgb(2 132 199/var(--tw-bg-opacity,1))}.hover\\:bg-slate-100:hover{--tw-bg-opacity:1;background-color:rgb(241 245 249/var(--tw-bg-opacity,1))}.hover\\:text-gray-600:hover{--tw-text-opacity:1;color:rgb(75 85 99/var(--tw-text-opacity,1))}.hover\\:text-gray-800:hover{--tw-text-opacity:1;color:rgb(31 41 55/var(--tw-text-opacity,1))}.hover\\:text-gray-900:hover{--tw-text-opacity:1;color:rgb(17 24 39/var(--tw-text-opacity,1))}.hover\\:text-indigo-600:hover{--tw-text-opacity:1;color:rgb(79 70 229/var(--tw-text-opacity,1))}.hover\\:text-indigo-800:hover{--tw-text-opacity:1;color:rgb(55 48 163/var(--tw-text-opacity,1))}.hover\\:text-white:hover{--tw-text-opacity:1;color:rgb(255 255 255/var(--tw-text-opacity,1))}.focus\\:border-indigo-500:focus{--tw-border-opacity:1;border-color:rgb(99 102 241/var(--tw-border-opacity,1))}.focus\\:border-red-500:focus{--tw-border-opacity:1;border-color:rgb(239 68 68/var(--tw-border-opacity,1))}.focus\\:outline-none:focus{outline:2px solid transparent;outline-offset:2px}.focus\\:ring-2:focus{--tw-ring-offset-shadow:var(--tw-ring-inset) 0 0 0 var(--tw-ring-offset-width) var(--tw-ring-offset-color);--tw-ring-shadow:var(--tw-ring-inset) 0 0 0 calc(2px + var(--tw-ring-offset-width)) var(--tw-ring-color);box-shadow:var(--tw-ring-offset-shadow),var(--tw-ring-shadow),var(--tw-shadow,0 0 #0000)}.focus\\:ring-amber-400:focus{--tw-ring-opacity:1;--tw-ring-color:rgb(251 191 36/var(--tw-ring-opacity,1))}.focus\\:ring-emerald-400:focus{--tw-ring-opacity:1;--tw-ring-color:rgb(52 211 153/var(--tw-ring-opacity,1))}.focus\\:ring-indigo-500:focus{--tw-ring-opacity:1;--tw-ring-color:rgb(99 102 241/var(--tw-ring-opacity,1))}.focus\\:ring-indigo-500\\/25:focus{--tw-ring-color:rgba(99,102,241,.25)}.focus\\:ring-indigo-500\\/30:focus{--tw-ring-color:rgba(99,102,241,.3)}.focus\\:ring-red-400:focus{--tw-ring-opacity:1;--tw-ring-color:rgb(248 113 113/var(--tw-ring-opacity,1))}.focus\\:ring-red-500\\/20:focus{--tw-ring-color:rgba(239,68,68,.2)}.focus\\:ring-sky-400:focus{--tw-ring-opacity:1;--tw-ring-color:rgb(56 189 248/var(--tw-ring-opacity,1))}.focus\\:ring-offset-2:focus{--tw-ring-offset-width:2px}.focus-visible\\:ring-2:focus-visible{--tw-ring-offset-shadow:var(--tw-ring-inset) 0 0 0 var(--tw-ring-offset-width) var(--tw-ring-offset-color);--tw-ring-shadow:var(--tw-ring-inset) 0 0 0 calc(2px + var(--tw-ring-offset-width)) var(--tw-ring-color);box-shadow:var(--tw-ring-offset-shadow),var(--tw-ring-shadow),var(--tw-shadow,0 0 #0000)}.focus-visible\\:ring-indigo-500:focus-visible{--tw-ring-opacity:1;--tw-ring-color:rgb(99 102 241/var(--tw-ring-opacity,1))}.focus-visible\\:ring-offset-2:focus-visible{--tw-ring-offset-width:2px}.disabled\\:opacity-50:disabled{opacity:.5}.group:hover .group-hover\\:text-indigo-500{--tw-text-opacity:1;color:rgb(99 102 241/var(--tw-text-opacity,1))}.peer:checked~.peer-checked\\:translate-x-4{--tw-translate-x:1rem;transform:translate(var(--tw-translate-x),var(--tw-translate-y)) rotate(var(--tw-rotate)) skewX(var(--tw-skew-x)) skewY(var(--tw-skew-y)) scaleX(var(--tw-scale-x)) scaleY(var(--tw-scale-y))}.peer:checked~.peer-checked\\:bg-indigo-600{--tw-bg-opacity:1;background-color:rgb(79 70 229/var(--tw-bg-opacity,1))}.peer:focus-visible~.peer-focus-visible\\:ring-2{--tw-ring-offset-shadow:var(--tw-ring-inset) 0 0 0 var(--tw-ring-offset-width) var(--tw-ring-offset-color);--tw-ring-shadow:var(--tw-ring-inset) 0 0 0 calc(2px + var(--tw-ring-offset-width)) var(--tw-ring-color);box-shadow:var(--tw-ring-offset-shadow),var(--tw-ring-shadow),var(--tw-shadow,0 0 #0000)}.peer:focus-visible~.peer-focus-visible\\:ring-indigo-500\\/40{--tw-ring-color:rgba(99,102,241,.4)}.peer:focus-visible~.peer-focus-visible\\:ring-offset-2{--tw-ring-offset-width:2px}@media (min-width:640px){.sm\\:w-44{width:11rem}.sm\\:flex-row{flex-direction:row}.sm\\:items-center{align-items:center}.sm\\:p-6{padding:1.5rem}.sm\\:px-6{padding-left:1.5rem;padding-right:1.5rem}}@media (min-width:768px){.md\\:col-span-2{grid-column:span 2/span 2}.md\\:grid-cols-1{grid-template-columns:repeat(1,minmax(0,1fr))}.md\\:grid-cols-2{grid-template-columns:repeat(2,minmax(0,1fr))}.md\\:grid-cols-4{grid-template-columns:repeat(4,minmax(0,1fr))}.md\\:items-start{align-items:flex-start}.md\\:pl-8{padding-left:2rem}.md\\:pt-0{padding-top:0}}@media (min-width:1024px){.lg\\:w-40{width:10rem}.lg\\:max-w-2xl{max-width:42rem}.lg\\:max-w-md{max-width:28rem}.lg\\:flex-1{flex:1 1 0%}.lg\\:flex-row{flex-direction:row}.lg\\:items-center{align-items:center}.lg\\:justify-between{justify-content:space-between}.lg\\:space-x-3>:not([hidden])~:not([hidden]){--tw-space-x-reverse:0;margin-right:calc(.75rem*var(--tw-space-x-reverse));margin-left:calc(.75rem*(1 - var(--tw-space-x-reverse)))}.lg\\:px-8{padding-left:2rem;padding-right:2rem}}.\\[\\&\\:\\:-webkit-inner-spin-button\\]\\:appearance-none::-webkit-inner-spin-button,.\\[\\&\\:\\:-webkit-outer-spin-button\\]\\:appearance-none::-webkit-outer-spin-button{-webkit-appearance:none;appearance:none}`;

const btnPrimary =
  'inline-flex items-center justify-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50';
const btnPrimarySm =
  'inline-flex items-center gap-1 justify-center rounded-md bg-indigo-600 px-2 py-1 text-xs font-medium text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50';
const btnSecondary =
  'inline-flex items-center gap-1 justify-center rounded-md border border-indigo-300 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-800 shadow-sm transition hover:bg-indigo-100 hover:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50';
const btnDangerSm =
  'inline-flex items-center gap-1 justify-center rounded-md bg-red-500 px-2 py-1 text-xs font-medium text-white shadow-sm transition hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-2 disabled:opacity-50';
const btnSuccessSm =
  'inline-flex items-center gap-1 justify-center rounded-md bg-emerald-600 px-2 py-1 text-xs font-medium text-white shadow-sm transition hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2 disabled:opacity-50';
const btnWarningSm =
  'inline-flex items-center gap-1 justify-center rounded-md bg-amber-500 px-2 py-1 text-xs font-medium text-white shadow-sm transition hover:bg-amber-600 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:ring-offset-2 disabled:opacity-50';
const btnInfoSm =
  'inline-flex items-center gap-1 justify-center rounded-md bg-sky-500 px-2 py-1 text-xs font-medium text-white shadow-sm transition hover:bg-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-400 focus:ring-offset-2 disabled:opacity-50';
const btnOutline =
  'inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2';
/** 与登录页输入框一致：圆角 lg、浅灰边框、轻阴影、indigo focus ring */
const fieldLoginBase =
  'rounded-lg border border-gray-200 bg-white py-2 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/25';
const inputLogin = `w-full ${fieldLoginBase} px-3`;
const inputLoginSearch = `w-full ${fieldLoginBase} pl-10 pr-3`;
const inputLoginDateRight = `w-full ${fieldLoginBase} px-3 pr-10`;
const selectLogin = `w-full ${fieldLoginBase} px-3`;
const selectLoginW32 = `w-32 ${fieldLoginBase} px-3`;
const textareaLogin = `w-full ${fieldLoginBase} px-3`;
const twToast =
  'pointer-events-auto fixed top-5 right-5 z-[1000] flex translate-x-[120%] items-center rounded-lg px-5 py-3 text-sm font-medium text-white shadow-lg transition-transform duration-300 ease-out';
const twToastIn = 'translate-x-0';
const twPop =
  'fixed z-[9999] max-w-xs rounded-lg bg-gray-900 px-3 py-2 text-sm leading-snug text-white shadow-xl opacity-0 invisible transition-opacity duration-200 pointer-events-none whitespace-normal break-words';
const twPopOpen = 'opacity-100 visible';
const monthBtnBase = 'rounded-md border border-transparent px-2 py-1 text-xs text-gray-700 transition hover:bg-indigo-50 hover:text-indigo-800';
const monthBtnOn = 'border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-700 hover:text-white';
const yearBtnBase = 'rounded-md border border-transparent px-2 py-1 text-xs text-gray-800 transition hover:bg-indigo-50 hover:text-indigo-800';
const dayCellBase =
  'flex h-9 w-9 cursor-pointer select-none flex-col items-center justify-center rounded-md p-0.5 text-[11px] transition hover:bg-indigo-50 hover:scale-[1.02]';

/** 配置页：未勾选的通知渠道区块（浅色弱化） */
const cfgSectionInactive = 'rounded-xl border border-gray-200 bg-gray-50/90 p-4 mb-6 opacity-60 transition duration-200';
/** 配置页：已启用渠道区块（白底、浅 Indigo 强调） */
const cfgSectionActive = 'rounded-xl border border-indigo-300 bg-white p-4 mb-6 opacity-100 shadow-sm ring-1 ring-indigo-100 transition duration-200';

/** 线稿 SVG（置于 indigo 圆角底上时为白色描边） */
const APP_LOGO_SVG =
  '<svg class="h-5 w-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 2h10M5 6h14"/><rect width="18" height="12" x="3" y="10" rx="2"/></svg>';

/** 圆角 indigo 底 + 白色线稿；extraClass 如 shrink-0 mr-2 用于顶栏与标题间距 */
function appLogoMarkup(extraClass = '') {
  const base = 'flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-sm';
  const cls = extraClass ? `${base} ${extraClass}` : base;
  return `<div class="${cls}" aria-hidden="true" title="SubTrack">${APP_LOGO_SVG}</div>`;
}

function iconSvg(name, className = 'h-4 w-4') {
  const paths = {
    x: '<path fill-rule="evenodd" d="M4.22 4.22a.75.75 0 011.06 0L10 8.94l4.72-4.72a.75.75 0 111.06 1.06L11.06 10l4.72 4.72a.75.75 0 11-1.06 1.06L10 11.06l-4.72 4.72a.75.75 0 01-1.06-1.06L8.94 10 4.22 5.28a.75.75 0 010-1.06z" clip-rule="evenodd"/>',
    chevronLeft:
      '<path fill-rule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L9.168 10l3.602 3.71a.75.75 0 11-1.08 1.04l-4.25-4.38a.75.75 0 010-1.04l4.25-4.38a.75.75 0 011.06-.02z" clip-rule="evenodd"/>',
    chevronRight:
      '<path fill-rule="evenodd" d="M7.21 5.23a.75.75 0 011.06.02l4.25 4.38a.75.75 0 010 1.04l-4.25 4.38a.75.75 0 11-1.08-1.04L10.832 10 7.23 6.29a.75.75 0 01-.02-1.06z" clip-rule="evenodd"/>',
    externalLink:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:1;"><path fill="none"     d="M13.2 9.8a3.4 3.4 0 0 0-4.8 0L5 13.2A3.4 3.4 0 0 0 9.8 18l.3-.3m-.3-4.5a3.4 3.4 0 0 0 4.8 0L18 9.8A3.4 3.4 0 0 0 13.2 5l-1 1"/></svg>',
    magic:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:1;"><path d="m12.669 8.358l5.028 1.968c2.9 1.134 4.35 1.702 4.302 2.602s-1.561 1.313-4.588 2.138c-.901.246-1.352.369-1.664.68c-.312.313-.435.764-.681 1.665c-.825 3.026-1.238 4.54-2.138 4.588s-1.468-1.402-2.602-4.302l-1.968-5.028C7.17 9.633 6.576 8.115 7.345 7.345s2.288-.175 5.324 1.013Z"/><path  d="M9 4V2M5 5L3.5 3.5M4 9H2m3 4l-1.5 1.5m11-11L13 5"/></svg>',
    paperPlane:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="currentColor" style="opacity:1;"><path  fill-rule="evenodd" d="M1.846 7.151a.75.75 0 0 0-.228 1.376l6.517 3.915l6.22-4.355a.75.75 0 0 1 .86 1.229l-6.22 4.355l1.45 7.463a.75.75 0 0 0 1.372.256L22.792 3.94a.75.75 0 0 0-.793-1.133z" clip-rule="evenodd"/></svg>',
    save: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="currentColor" style="opacity:1;"><path  d="M17 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2V7zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3s3 1.34 3 3s-1.34 3-3 3m3-10H5V5h10z"/></svg>',
    exclamationCircle:
      '<path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm0-4a.9.9 0 100-1.8.9.9 0 000 1.8zm.75-8.25a.75.75 0 00-1.5 0v4.5a.75.75 0 001.5 0v-4.5z" clip-rule="evenodd"/>',
  };
  return `<svg class="${className}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">${paths[name] || ''}</svg>`;
}

/** 与顶栏 Logo 视觉一致的 favicon（圆角紫底 + 白线稿） */
const APP_FAVICON_DATA_URL =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#4f46e5"/><g fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" transform="translate(4 4)"><path d="M7 2h10M5 6h14"/><rect width="18" height="12" x="3" y="10" rx="2"/></g></svg>',
  );

const loginPage = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#6366f1">
  <title>登录 · SubTrack</title>
  <link rel="icon" href="${APP_FAVICON_DATA_URL}" type="image/svg+xml">
  <style>${EMBEDDED_TAILWIND_CSS}</style>
</head>
<body class="flex min-h-dvh items-center justify-center bg-gray-50 p-6 font-sans text-gray-900 antialiased">

  <main class="w-full max-w-sm">
    <div class="rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
    <header class="mb-6 text-center">
      <div class="mb-3 flex justify-center">
        ${appLogoMarkup()}
      </div>
      <h1 class="text-xl font-semibold tracking-tight text-gray-900">登录SubTrack</h1>
      <p class="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-gray-500">集中管理订阅到期时间，配置通知渠道和策略。</p>
    </header>

    <form id="loginForm" class="flex flex-col gap-4" novalidate autocomplete="on">
      <div class="relative">
        <label class="sr-only" for="username">用户名</label>
        <span class="pointer-events-none absolute left-3 top-1/2 z-10 flex -translate-y-1/2 text-gray-400" aria-hidden="true">
        <svg class="h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12c0 5.523-4.477 10-10 10S2 17.523 2 12S6.477 2 12 2s10 4.477 10 10Z"/><path d="M14.75 9.5a2.75 2.75 0 1 1-5.5 0a2.75 2.75 0 0 1 5.5 0Z"/><path d="m5.5 19l.56-.98a5 5 0 0 1 4.342-2.52h3.196a5 5 0 0 1 4.341 2.52l.56.98"/></svg>
        </span>
        <input type="text" id="username" name="username" required autocomplete="username"
          autocapitalize="none" spellcheck="false" autofocus
          class="w-full rounded-lg border border-gray-200 bg-white py-2.5 pl-10 pr-3 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/25" placeholder="用户名">
      </div>

      <div class="grid grid-cols-1">
        <label class="sr-only" for="password">密码</label>
        <input type="password" id="password" name="password" required autocomplete="current-password"
          class="login-password-field col-start-1 row-start-1 z-0 w-full rounded-lg border border-gray-200 bg-white py-2.5 pl-10 pr-14 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/25"
          placeholder="密码">
        <span class="pointer-events-none col-start-1 row-start-1 z-10 flex self-center justify-self-start pl-3 text-gray-400" aria-hidden="true">
          <svg class="h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        </span>
        <button type="button" id="togglePassword" class="col-start-1 row-start-1 z-30 mr-1 inline-flex min-h-9 min-w-9 cursor-pointer touch-manipulation items-center justify-center justify-self-end self-center rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30" title="显示或隐藏密码" aria-label="显示或隐藏密码" aria-pressed="false">
          <svg id="loginPwdIconHidden" class="pointer-events-none hidden h-6 w-6 shrink-0" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="24" height="24" aria-hidden="true"><radialGradient id="SVGP9JeDd3v" cx="63" cy="-2091.1" r="56.96" gradientTransform="matrix(1 0 0 -1 0 -2028)" gradientUnits="userSpaceOnUse"><stop offset=".5" stop-color="#FDE030"/><stop offset=".92" stop-color="#F7C02B"/><stop offset="1" stop-color="#F4A223"/></radialGradient><path fill="url(#SVGP9JeDd3v)" d="M63 119c-27.9 0-58-17.5-58-55.9S35.1 7.2 63 7.2c15.5 0 29.8 5.1 40.4 14.4C114.9 31.8 121 46.2 121 63.1s-6.1 31.2-17.6 41.4C92.8 113.8 78.4 119 63 119"/><linearGradient id="SVG8D00zdOE" x1="63" x2="63" y1="1457" y2="1345.2" gradientTransform="translate(0 -1338)" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#F4A223"/><stop offset=".381" stop-color="#F7C02B"/><stop offset=".748" stop-color="#FDE030" stop-opacity="0"/></linearGradient><path fill="url(#SVG8D00zdOE)" d="M63 119c-27.9 0-58-17.5-58-55.9S35.1 7.2 63 7.2c15.5 0 29.8 5.1 40.4 14.4C114.9 31.8 121 46.2 121 63.1s-6.1 31.2-17.6 41.4C92.8 113.8 78.4 119 63 119"/><path fill="#EB8F00" d="M110.89 29.87c5.33 8.6 8.11 18.84 8.11 30.23c0 16.9-6.1 31.2-17.6 41.4c-10.6 9.3-25 14.5-40.4 14.5c-18.06 0-37.04-7.35-48.18-22.94C23.58 110.72 43.81 119 63 119c15.4 0 29.8-5.2 40.4-14.5C114.9 94.3 121 80 121 63.1c0-12.74-3.47-24.06-10.11-33.23"/><radialGradient id="SVGK9qAkcnJ" cx="35.545" cy="72.576" r="19.444" gradientTransform="matrix(.9791 0 0 .9301 -3.756 10.846)" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#ED7770"/><stop offset=".9" stop-color="#ED7770" stop-opacity="0"/></radialGradient><circle cx="31.05" cy="78.35" r="17.5" fill="url(#SVGK9qAkcnJ)" opacity=".8"/><radialGradient id="SVGHFRV9cnD" cx="101.637" cy="72.576" r="19.444" gradientTransform="matrix(.9791 0 0 .9301 -3.756 10.846)" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#ED7770"/><stop offset=".9" stop-color="#ED7770" stop-opacity="0"/></radialGradient><circle cx="95.75" cy="78.35" r="17.5" fill="url(#SVGHFRV9cnD)" opacity=".8"/><circle cx="82.04" cy="58.16" r="18.53" fill="#FFF"/><circle cx="81.88" cy="58.16" r="8.04" fill="#422B0D"/><path fill="#896024" d="M81.1 52.69c-1.07-.56-2.59-.02-3.49 1.7s-.46 3.27.61 3.83s2.59.02 3.49-1.7s.46-3.27-.61-3.83"/><path fill="#422B0D" d="M70 92.41c-.56 0-1.12.12-1.66.36c-5.96 2.72-11.34.17-11.56.06c-1.98-.96-4.37-.16-5.35 1.81s-.2 4.35 1.76 5.34c.36.18 8.92 4.42 18.47.07A4 4 0 0 0 70 92.41"/><linearGradient id="SVGnjIWadLc" x1="48.154" x2=".527" y1="75.909" y2="123.909" gradientTransform="scale(-1 1)rotate(-55.383 -55.813 191.123)" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#FFF176"/><stop offset="1" stop-color="#FFC400"/></linearGradient><path fill="url(#SVGnjIWadLc)" d="M76.68 97.9c-1.46-1.9-4.02-6.07-8.8-12.22c-3.34-4.29-15.77-12.94-19.08-17.47c-1.71-2.34-3.15-4.69-2.23-6.42c3.06-5.77 6.93-.85 6.93-.85s-8.84-4.91-3.11-10.09c2.51-2.26 4.94-1.99 10.12 1.87c0 0 22.27 15.35 24.14 14.07c1.86-1.29-4.14-25.54-4.44-33.36c-.16-4.22-.34-7.65 3.56-8.7c5.68-1.54 6.35 6.44 6.24 5.29s1.53-4.16 5.61-4.96c3.16-.63 4.72 3.41 5.74 9.46s6.61 28.07 9.29 29.92c0 0 .94-11.93 6.74-16.18c2.63-1.93 7.22-2.7 7.79.56c.33 1.92.33 5.24-1.19 10.15c-1.31 4.21-1.22 14.66-.76 22.35c.39 6.49 1.99 16.95-12.5 24.92c-15.9 8.73-27.64-.05-34.05-8.34"/><path fill="#EB8F00" d="M79.53 33.75c-.35-3.34-.51-6.02 1.84-8.25c2.59-2.47 5.47-2.42 6.92-.95c.61.62 1.23 1.59 1.84 3.05c.94-2.41 2.69-3.48 5.16-3.84c2.87-.42 5.29 1.68 6.33 6.21c.62 2.69 7.14 28.2 8.41 29.62c0 0 .02-9.3 8.64-13.4c2.36-1.12 5.12-1.02 7.22 1.22s-.48 6.31-2.16 16.97c-.91 5.78-.65 12.64-.65 12.64s-2.74-3.68-1.4-16.56c.5-4.83 3.87-9.86 1.44-11.66c-1.57-1.16-3.16-1.39-6.13 1.35c-6.11 5.64-4.6 14.79-4.94 15.93s-1.49 1.8-3.53-3.61c-2.03-5.4-7.29-25.43-8.91-31.6c-1.31-4.98-3.14-5.39-5.42-4.18c-2.84 1.5-2 6.24-1.59 7.79c.34 1.28 3.6 18.82 5.39 24.87c.38 1.28 1.37 3.26 1.24 4.17c-.15 1-3.58 2.94-4.2-2.23c-.68-5.67-4.96-26.41-4.96-26.41s-.67-4.28-1.9-6.97c-.56-1.23-2.28-2.65-5.12-.41c-2.43 1.92-1.09 7.71-1.09 7.71l4.62 28.09s.73 3.29-.65 4.56c-1.6 1.48-4.39-.65-4.39-.65s-19.29-12.73-22.3-14.37c-3-1.64-4.85-3.55-7.69-1.72c-.82.53-2.46 2.84.29 5.21s11.91 9.7 22.66 16.79c.62.42 5.21 1.67 3.3 4.76c-1.9 3.09-5.06-1.58-5.62-2.01c-7.15-5.57-15.28-11.96-20.04-14.55c-3.58-1.95-5.73 2.12-2.35 5.87c2.21 2.46 5.63 5.66 9.6 9.01c3.88 3.27 7.09 6.55 8.77 8.75c4.11 5.36 5.9 8.38 8.69 12.3c11.9 14.34 24.49 13.81 38.02 6.33c-1.76 2.01-25.49 19.29-42.38-7.45c-1.53-2.28-3.63-5.4-6.68-9.39c-1.49-1.95-4.78-4.95-8.33-8.29S43.56 66.27 45.27 61.46c1.17-3.28 4.1-3.44 4.1-3.44s-4.38-5.13 1.29-9.15c3.08-2.18 7.76 1.14 7.76 1.14l22.1 14.21s.95.71 2.14 1.31c1.59.79 1.48-1.54 1.39-2.1c-.88-5.49-4.24-26.97-4.52-29.68"/><radialGradient id="SVGnfyk62JE" cx="58.725" cy="87.697" r="71.786" gradientTransform="scale(1 -1)rotate(38.842 248.132 -31.05)" gradientUnits="userSpaceOnUse"><stop offset=".27" stop-color="#FFF176"/><stop offset="1" stop-color="#FFC400"/></radialGradient><path fill="url(#SVGnfyk62JE)" d="M56.81 39.61c-4.11-1.2-6.83 5.6-6.83 5.6s.77-4.32 1.27-8.1c.32-2.42-.74-6.19-3.39-7.19c-2.66-.99-5.83 1.76-6.64 4.05l-3.19 8.94s1.53-2.93-1.02-7.57c-.87-2-3.2-2.91-5.2-2.04c-.38.16-.72.38-1.03.66a10.27 10.27 0 0 0-2.83 4.88c-1.95 6.9-7.48 24.93-10.37 26.91c-1.13.77-1.35.68-2.96-5.88c-.81-4.06-3.38-7.54-7.03-9.5c-2.11-1.13-5.86 1.11-5.59 3.62c.18 1.86 2.02 5.32 3.05 9.45c1.64 6.82 1.6 17.8 1.68 18.8c.61 7.33 1.76 20.98 16 25.86c12.61 4.33 25.57-5.43 30.18-12.97C61.75 80.8 66.36 63.2 66.43 62.86c.81-3.6.75-7.87-2.11-9.51c-3.52-2.04-5.9 2.77-5.9 2.77c1.12-3.1 1.74-6.36 1.82-9.65c-.06-3.3-.66-6.04-3.43-6.86"/><path fill="#EB8F00" d="M61.9 46.43c-.04-2.12-.13-7.08-4.62-8.41c-1.6-.45-3.17-.28-4.55.5c.67-3.33-.32-9.04-5.27-10.41c-1.84-.51-4.27-.12-6.41 2.61c-1.55 1.97-2.12 4.74-2.12 4.74c-.13-.28-2.03-5.71-8.04-2.59c-2.42 1.26-3.68 4.53-4.2 6.65c-3.37 11.88-9.29 25.38-9.54 24.37c.08-6.68-4.04-13.16-8.91-15.04c-2.11-1.13-7.53 1.13-7.07 4.65c.38 2.89 3.32 8.13 4.08 13.58c.59 4.21.7 20.26 3.2 26.23c0 0-.38-4.36-.6-10.77c-.24-6.83-.36-15.83-1.2-19.5c-.73-3.28-2.45-6.53-3.01-9.23c-.16-1.18 1.17-3.51 4.41-2.07s5.03 4.91 5.97 9.62c1.29 5.25.61 6.05 2.1 6.23c4.99.61 11.71-23.34 13.43-28.35c.39-1.56 1.21-2.98 2.31-4.04c2.09-2.23 4.62 1.16 4.62 1.16c1.52 3.24 1.1 3.58.23 8.02c-.62 3.16-3.43 13.55-6.05 19.3c0 0 .88.94 2.46-1.28s5.53-13.73 7.07-20.67c0 0 1.75-9.3 4.68-10.55c2.98-1.27 4.11.59 4.64 2.8s.1 5.73-1.12 10.66c-2.19 8.85-6.23 21.76-6.23 21.76s.87.72 2.18-1.14c2.65-3.79 7.01-20.51 7.01-20.51c.31-1.33 2.41-4.5 5-3.55c1.29.39 2.3 1.93 2.2 6.05c-.1 4.94-3.51 16.16-7.08 25.18c0 0 1.18.44 2.49-1.64s5.13-12.67 6-14.03s1.75-2.68 3.66-1.92c2.5 1.18 2.47 3.72 1.57 7.7c-.04.17-4.43 18.93-13.37 32.99c-4.72 7.43-12.9 12.15-25.6 13.41c9.97 2.03 23.2-4.13 28.47-12.89c8.88-14.74 13.69-32.62 13.72-32.78c.65-2.88 2-8.89-3.48-11.47c-1.31-.52-2.51-.53-3.57-.23c.32-1.67.5-3.39.54-5.14"/></svg>
          <svg id="loginPwdIconShown" class="pointer-events-none h-6 w-6 shrink-0" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="24" height="24" aria-hidden="true"><path fill="#FAFAFA" d="M34.16 106.51C18.73 106.51 6.19 87.44 6.19 64s12.55-42.51 27.97-42.51S62.13 40.56 62.13 64s-12.55 42.51-27.97 42.51"/><path fill="#B0BEC5" d="M34.16 23.49c6.63 0 12.98 4 17.87 11.27c5.22 7.75 8.1 18.14 8.1 29.24s-2.88 21.49-8.1 29.24c-4.89 7.27-11.24 11.27-17.87 11.27s-12.98-4-17.87-11.27C11.06 85.49 8.19 75.1 8.19 64s2.88-21.49 8.1-29.24c4.89-7.27 11.23-11.27 17.87-11.27m0-4C17.61 19.49 4.19 39.42 4.19 64s13.42 44.51 29.97 44.51S64.13 88.58 64.13 64S50.71 19.49 34.16 19.49"/><linearGradient id="SVGmUaXxe0S" x1="22.523" x2="22.523" y1="46.676" y2="82.083" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#424242"/><stop offset="1" stop-color="#212121"/></linearGradient><path fill="url(#SVGmUaXxe0S)" d="M25.63 59.84c-2.7-2.54-2.1-7.58 1.36-11.26c.18-.19.36-.37.55-.54c-1.54-.87-3.23-1.36-5.01-1.36c-7.19 0-13.02 7.93-13.02 17.7s5.83 17.7 13.02 17.7s13.02-7.93 13.02-17.7c0-1.75-.19-3.45-.54-5.05c-3.24 2.33-7.11 2.64-9.38.51"/><ellipse cx="93.84" cy="64" fill="#EEE" rx="29.97" ry="44.51"/><path fill="#FAFAFA" d="M93.84 106.51c-15.42 0-27.97-19.07-27.97-42.51s12.55-42.51 27.97-42.51S121.81 40.56 121.81 64s-12.54 42.51-27.97 42.51"/><path fill="#B0BEC5" d="M93.84 23.49c6.63 0 12.98 4 17.87 11.27c5.22 7.75 8.1 18.14 8.1 29.24s-2.88 21.49-8.1 29.24c-4.89 7.27-11.24 11.27-17.87 11.27s-12.98-4-17.87-11.27c-5.22-7.75-8.1-18.14-8.1-29.24s2.88-21.49 8.1-29.24c4.89-7.27 11.24-11.27 17.87-11.27m0-4c-16.55 0-29.97 19.93-29.97 44.51s13.42 44.51 29.97 44.51S123.81 88.58 123.81 64s-13.42-44.51-29.97-44.51"/><linearGradient id="SVGsunlQbYk" x1="82.209" x2="82.209" y1="46.676" y2="82.083" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#424242"/><stop offset="1" stop-color="#212121"/></linearGradient><path fill="url(#SVGsunlQbYk)" d="M85.31 59.84c-2.7-2.54-2.1-7.58 1.36-11.26c.18-.19.36-.37.55-.54c-1.54-.87-3.23-1.36-5.01-1.36c-7.19 0-13.02 7.93-13.02 17.7s5.83 17.7 13.02 17.7s13.02-7.93 13.02-17.7c0-1.75-.19-3.45-.54-5.05c-3.23 2.33-7.11 2.64-9.38.51"/></svg>
        </button>
      </div>

      <div id="errorMsg" class="hidden rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700" role="alert" aria-live="polite"></div>

      <button type="submit" id="loginSubmitBtn" class="${btnPrimary} w-full">登录</button>
    </form>

    <p class="mt-6 border-t border-gray-100 pt-4 text-center text-xs leading-relaxed text-gray-500">使用管理员账号登录；会话通过 HttpOnly Cookie 保存。</p>
    </div>
  </main>

  <script>
    (function () {
      var form = document.getElementById('loginForm');
      var errorEl = document.getElementById('errorMsg');
      var submitBtn = document.getElementById('loginSubmitBtn');
      var userInput = document.getElementById('username');
      var passInput = document.getElementById('password');
      var toggleBtn = document.getElementById('togglePassword');
      var iconPwdHidden = document.getElementById('loginPwdIconHidden');
      var iconPwdShown = document.getElementById('loginPwdIconShown');

      function clearError() {
        errorEl.textContent = '';
        errorEl.classList.add('hidden');
      }

      function showError(msg) {
        errorEl.textContent = msg;
        errorEl.classList.remove('hidden');
      }

      userInput.addEventListener('input', clearError);
      passInput.addEventListener('input', clearError);

      function syncPasswordToggleUi() {
        var revealed = passInput.type === 'text';
        /* 密码隐藏时显示第二个图标（睁眼）；明文时显示第一个图标（捂眼） */
        iconPwdHidden.classList.toggle('hidden', !revealed);
        iconPwdShown.classList.toggle('hidden', revealed);
        toggleBtn.setAttribute('aria-pressed', revealed ? 'true' : 'false');
      }

      toggleBtn.addEventListener('click', function (e) {
        e.preventDefault();
        passInput.type = passInput.type === 'password' ? 'text' : 'password';
        syncPasswordToggleUi();
      });

      syncPasswordToggleUi();

      form.addEventListener('submit', async function (e) {
        e.preventDefault();
        clearError();

        var username = userInput.value.trim();
        var password = passInput.value;

        if (!username) {
          showError('请输入用户名');
          userInput.focus();
          return;
        }
        if (!password) {
          showError('请输入密码');
          passInput.focus();
          return;
        }

        var originalContent = submitBtn.innerHTML;
        submitBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" class="animate-spin mr-2" viewBox="0 0 24 24" width="20" height="20" fill="currentColor" style="opacity:1;"><path fill-rule="evenodd" d="M12 19a7 7 0 1 0 0-14a7 7 0 0 0 0 14m0 3c5.523 0 10-4.477 10-10S17.523 2 12 2S2 6.477 2 12s4.477 10 10 10" clip-rule="evenodd" opacity=".2"/><path d="M2 12C2 6.477 6.477 2 12 2v3a7 7 0 0 0-7 7z"/></svg> 登录中…';
        submitBtn.disabled = true;
        submitBtn.setAttribute('aria-busy', 'true');

        try {
          var response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ username: username, password: password })
          });

          var result = {};
          var ct = response.headers.get('content-type') || '';
          if (ct.indexOf('application/json') !== -1) {
            try {
              result = await response.json();
            } catch (parseErr) {
              result = {};
            }
          }

          if (result.success) {
            window.location.href = '/admin';
            return;
          }

          var msg = result.message;
          if (!msg) {
            msg = response.ok ? '登录失败，请检查账号密码' : ('请求失败（' + response.status + '），请稍后重试');
          }
          showError(msg);
        } catch (err) {
          showError('网络异常，请检查连接后重试');
        } finally {
          submitBtn.innerHTML = originalContent;
          submitBtn.disabled = false;
          submitBtn.removeAttribute('aria-busy');
        }
      });
    })();
  </script>
</body>
</html>
`;

const adminPage = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SubTrack</title>
  <link rel="icon" href="${APP_FAVICON_DATA_URL}" type="image/svg+xml">
  <style>${EMBEDDED_TAILWIND_CSS}</style>
</head>
<body class="bg-gray-50 min-h-screen">
  <div id="toast-container"></div>

  <nav class="fixed top-0 left-0 right-0 z-50 border-b border-gray-200/80 bg-white/95 shadow-sm backdrop-blur-sm">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="flex justify-between h-16">
        <div class="flex items-center">
          ${appLogoMarkup('shrink-0 mr-2')}
          <span class="font-bold text-xl text-gray-800">SubTrack</span>
          <span id="systemTimeDisplay" class="ml-4 text-sm text-slate-600 font-normal mt-2"></span>
        </div>
        <div class="flex items-center space-x-4">
          <a href="/admin" class="text-indigo-600 border-indigo-600 bg-indigo-50 px-3 py-2 rounded-md text-sm font-medium flex items-center gap-1">
            <svg width="18" height="18" viewBox="0 0 48 48" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="6" width="40" height="36" rx="3" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 14H44"  stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 24H36"  stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 32H36"  stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 24H14"  stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 32H14"  stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg> 订阅列表
          </a>
          <a href="/admin/config" class="text-gray-700 hover:text-gray-900 hover:bg-slate-100 px-3 py-2 rounded-md text-sm font-medium flex items-center gap-1">
            <svg width="18" height="18" viewBox="0 0 48 48" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M18.2838 43.1713C14.9327 42.1736 11.9498 40.3213 9.58787 37.867C10.469 36.8227 11 35.4734 11 34.0001C11 30.6864 8.31371 28.0001 5 28.0001C4.79955 28.0001 4.60139 28.01 4.40599 28.0292C4.13979 26.7277 4 25.3803 4 24.0001C4 21.9095 4.32077 19.8938 4.91579 17.9995C4.94381 17.9999 4.97188 18.0001 5 18.0001C8.31371 18.0001 11 15.3138 11 12.0001C11 11.0488 10.7786 10.1493 10.3846 9.35011C12.6975 7.1995 15.5205 5.59002 18.6521 4.72314C19.6444 6.66819 21.6667 8.00013 24 8.00013C26.3333 8.00013 28.3556 6.66819 29.3479 4.72314C32.4795 5.59002 35.3025 7.1995 37.6154 9.35011C37.2214 10.1493 37 11.0488 37 12.0001C37 15.3138 39.6863 18.0001 43 18.0001C43.0281 18.0001 43.0562 17.9999 43.0842 17.9995C43.6792 19.8938 44 21.9095 44 24.0001C44 25.3803 43.8602 26.7277 43.594 28.0292C43.3986 28.01 43.2005 28.0001 43 28.0001C39.6863 28.0001 37 30.6864 37 34.0001C37 35.4734 37.531 36.8227 38.4121 37.867C36.0502 40.3213 33.0673 42.1736 29.7162 43.1713C28.9428 40.752 26.676 39.0001 24 39.0001C21.324 39.0001 19.0572 40.752 18.2838 43.1713Z" fill="none"  stroke-width="4" stroke-linejoin="round"/><path d="M24 31C27.866 31 31 27.866 31 24C31 20.134 27.866 17 24 17C20.134 17 17 20.134 17 24C17 27.866 20.134 31 24 31Z" fill="none"  stroke-width="4" stroke-linejoin="round"/></svg> 系统配置
          </a>
          <a href="/api/logout" class="text-gray-700 hover:text-gray-900 hover:bg-slate-100 px-3 py-2 rounded-md text-sm font-medium flex items-center gap-1">
            <svg width="18" height="18" viewBox="0 0 48 48" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M30 17V4H4V30H17"  stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M43 43V17H17V43H43Z" fill="none"  stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M33 30H17M33 30L28 25L33 30ZM33 30L28 35L33 30Z"  stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M17 17V43"  stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>退出登录
          </a>
        </div>
      </div>
    </div>
  </nav>
  
  <div class="max-w-7xl mx-auto px-4 pt-24 pb-8 sm:px-6 lg:px-8">
    <div class="flex flex-col gap-5 mb-6">
      <header class="w-full">
        <h2 class="text-2xl font-bold text-gray-800">订阅列表</h2>
        <p class="text-sm text-gray-500 mt-2 leading-relaxed">使用搜索与分类快速定位订阅，开启农历显示可同步查看农历日期</p>
      </header>
      <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 w-full">
        <div class="flex flex-col sm:flex-row sm:items-center gap-2 w-full lg:flex-1 lg:max-w-2xl">
          <div class="relative flex-1 min-w-[200px] lg:max-w-md">
            <input type="text" id="searchKeyword" placeholder="搜索名称、类型或备注..." class="${inputLoginSearch}">
            <span class="pointer-events-none absolute left-3 top-1/2 z-10 flex -translate-y-1/2 text-gray-400" aria-hidden="true">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:1;"><path d="m21 21l-4.34-4.34"/><circle cx="11" cy="11" r="8"/></svg>
            </span>
          </div>
          <div class="relative min-w-0 sm:w-44 lg:w-40" id="categoryFilterRoot">
            <input type="hidden" id="categoryFilter" value="">
            <button type="button" id="categoryFilterTrigger" class="${selectLogin} flex cursor-pointer items-center justify-between gap-2 text-left" aria-haspopup="listbox" aria-expanded="false" aria-controls="categoryFilterDropdown">
              <span id="categoryFilterDisplay" class="min-w-0 flex-1 truncate">全部分类</span>
              <svg id="categoryFilterChevron" class="h-4 w-4 shrink-0 text-gray-400 transition-transform duration-200" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clip-rule="evenodd"/></svg>
            </button>
            <div id="categoryFilterDropdown" class="hidden absolute left-0 right-0 top-full z-[100] mt-1 max-h-60 min-w-0 overflow-x-hidden overflow-y-auto rounded-xl border border-gray-200 bg-white px-1 py-1 shadow-lg" role="listbox" aria-labelledby="categoryFilterTrigger"></div>
          </div>
        </div>
        <div class="flex items-center space-x-2 lg:space-x-3">
        <label class="inline-flex items-center gap-1.5 text-sm text-gray-700">
          <input type="checkbox" id="listShowLunar" class="form-checkbox h-3.5 w-3.5 shrink-0 rounded border-gray-200 text-indigo-600 focus:ring-2 focus:ring-indigo-500/25">
          <span class="text-gray-700">显示农历</span>
        </label>
        <button id="addSubscriptionBtn" class="${btnPrimary} !py-2 flex items-center gap-1 shrink-0">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:1;"><circle cx="12" cy="12" r="10"/><path d="M8 12h8m-4-4v8"/></svg> 添加新订阅
        </button>
      </div>
      </div>
    </div>
    
    <div class="subscription-table-card">
      <div class="min-w-0 overflow-x-auto">
        <table class="subscription-data-table table-responsive w-full">
          <thead>
            <tr>
              <th scope="col" class="text-left">
                订阅名称
              </th>
              <th scope="col" class="text-left">
                类型
              </th>
              <th scope="col" class="text-left" id="expirySortHeader" aria-sort="ascending">
                <button type="button" id="sortByExpiryBtn" class="group inline-flex max-w-full items-center gap-1 rounded border-0 bg-transparent p-0 text-left font-inherit text-inherit cursor-pointer outline-none hover:text-indigo-600 focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2">
                  <span class="min-w-0 truncate">到期时间</span>
                  <svg id="expirySortIcon" class="h-5 w-5 shrink-0 text-slate-400 transition-transform duration-200 group-hover:text-indigo-500" width="20" height="20" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M36 19L24 31L12 19H36Z" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/></svg>
                </button>
              </th>
              <th scope="col" class="text-left" >
                提醒设置
              </th>
              <th scope="col" class="text-left" style="width: 140px;">
                状态
              </th>
              <th scope="col" class="text-left" style="width: 160px;">
                操作
              </th>
            </tr>
          </thead>
        <tbody id="subscriptionsBody">
        </tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- 添加/编辑订阅的模态框 -->
  <div id="subscriptionModal" class="fixed inset-0 z-50 hidden overflow-y-auto bg-slate-900/30 backdrop-blur-sm">
    <div class="flex min-h-dvh w-full items-center justify-center p-4 sm:p-6">
    <div class="max-h-screen w-full max-w-2xl mx-auto overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-xl">
      <div class="bg-gray-50 px-6 py-4 border-b border-gray-200 rounded-t-lg">
        <div class="flex items-center justify-between">
          <h3 id="modalTitle" class="text-lg font-medium text-gray-900">添加新订阅</h3>
          <button id="closeModal" class="text-gray-400 hover:text-gray-600">
            ${iconSvg('x', 'h-5 w-5')}
          </button>
        </div>
      </div>
      
      <form id="subscriptionForm" class="p-6 space-y-4 pt-2" novalidate>
        <input type="hidden" id="subscriptionId">
        
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div class="md:col-span-2">
            <label for="name" class="block text-sm font-medium text-gray-700 mb-1">订阅名称 <span class="text-red-500">*</span></label>
            <input type="text" id="name" required
              class="${inputLogin}">
            <div id="nameError" class="mt-1 hidden text-sm text-red-600" data-error-for="name"></div>
          </div>
          
          <div>
            <label for="customType" class="block text-sm font-medium text-gray-700 mb-1">订阅类型</label>
            <input type="text" id="customType" placeholder="例如：流媒体、云服务、软件、生日等"
              class="${inputLogin}">
            <div id="customTypeError" class="mt-1 hidden text-sm text-red-600" data-error-for="customType"></div>
          </div>

          <div>
            <label for="category" class="block text-sm font-medium text-gray-700 mb-1">分类标签 <span class="text-xs text-gray-500">可输入多个标签使用“/”分隔</span></label>
            <input type="text" id="category" placeholder="例如：个人、家庭、公司"
              class="${inputLogin}">
            <div id="categoryError" class="mt-1 hidden text-sm text-red-600" data-error-for="category"></div>
          </div>
        </div>
        
        <div class="my-3 flex items-center space-x-6">
          <label class="inline-flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" id="showLunar" class="form-checkbox h-4 w-4 rounded border-gray-200 text-indigo-600 focus:ring-2 focus:ring-indigo-500/25">
            <span class="text-gray-700">显示农历日期</span>
          </label>
          <label class="inline-flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" id="useLunar" class="form-checkbox h-4 w-4 rounded border-gray-200 text-indigo-600 focus:ring-2 focus:ring-indigo-500/25">
            <span class="text-gray-700">周期按农历</span>
          </label>
        </div>

                <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div class="md:col-span-2">
            <label for="startDate" class="block text-sm font-medium text-gray-700 mb-1">开始日期</label>
            <div class="relative">
              <input type="text" id="startDate"
                class="${inputLoginDateRight}"
                placeholder="YYYY-MM-DD 或点击右侧图标选择">
              <div class="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none text-gray-400">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="20" height="20" fill="currentColor" style="opacity:1;"><path  d="M14 11.5V6H2v5.5A2.5 2.5 0 0 0 4.5 14h7a2.5 2.5 0 0 0 2.5-2.5M5.997 8.248a.748.748 0 1 1-1.497 0a.748.748 0 0 1 1.497 0m0 2.5a.748.748 0 1 1-1.497 0a.748.748 0 0 1 1.497 0m2.752-2.5a.748.748 0 1 1-1.497 0a.748.748 0 0 1 1.497 0m0 2.5a.748.748 0 1 1-1.497 0a.748.748 0 0 1 1.497 0m2.748-2.5a.748.748 0 1 1-1.497 0a.748.748 0 0 1 1.497 0M14 4.5A2.5 2.5 0 0 0 11.5 2h-7A2.5 2.5 0 0 0 2 4.5V5h12z"/></svg>
              </div>
              <div id="startDatePicker" class="hidden absolute top-full left-0 z-50 w-[300px] rounded-xl border border-gray-200 bg-white px-3 py-2 shadow-xl">
                  <div class="flex justify-between items-center mb-1.5">
                    <button type="button" id="startDatePrevMonth" class="text-gray-600 hover:text-gray-800">
                      ${iconSvg('chevronLeft', 'h-4 w-4')}
                    </button>
                    <div class="flex items-center space-x-2">
                      <span id="startDateYear" class="font-medium text-gray-900 cursor-pointer hover:text-indigo-600">2024</span>
                      <span class="text-gray-400">|</span>
                      <span id="startDateMonth" class="font-medium text-gray-900 cursor-pointer hover:text-indigo-600">1月</span>
                    </div>
                    <button type="button" id="startDateNextMonth" class="text-gray-600 hover:text-gray-800">
                      ${iconSvg('chevronRight', 'h-4 w-4')}
                    </button>
                  </div>
                  
                  <!-- 月份选择器 -->
                  <div id="startDateMonthPicker" class="hidden mb-2">
                    <div class="flex justify-between items-center mb-2">
                      <span class="font-medium text-gray-900">选择月份</span>
                      <button type="button" id="startDateBackToCalendar" class="text-gray-600 hover:text-gray-800">
                        ${iconSvg('x', 'h-4 w-4')}
                      </button>
                    </div>
                    <div class="grid grid-cols-3 gap-1.5">
                      <button type="button" class="${monthBtnBase}" data-month="0">1月</button>
                      <button type="button" class="${monthBtnBase}" data-month="1">2月</button>
                      <button type="button" class="${monthBtnBase}" data-month="2">3月</button>
                      <button type="button" class="${monthBtnBase}" data-month="3">4月</button>
                      <button type="button" class="${monthBtnBase}" data-month="4">5月</button>
                      <button type="button" class="${monthBtnBase}" data-month="5">6月</button>
                      <button type="button" class="${monthBtnBase}" data-month="6">7月</button>
                      <button type="button" class="${monthBtnBase}" data-month="7">8月</button>
                      <button type="button" class="${monthBtnBase}" data-month="8">9月</button>
                      <button type="button" class="${monthBtnBase}" data-month="9">10月</button>
                      <button type="button" class="${monthBtnBase}" data-month="10">11月</button>
                      <button type="button" class="${monthBtnBase}" data-month="11">12月</button>
                    </div>
                  </div>
                  
                  <!-- 年份选择器 -->
                  <div id="startDateYearPicker" class="hidden mb-2">
                    <div class="flex justify-between items-center mb-1.5">
                      <span class="font-medium text-gray-900">选择年份</span>
                      <button type="button" id="startDateBackToCalendarFromYear" class="text-gray-600 hover:text-gray-800">
                        ${iconSvg('x', 'h-4 w-4')}
                      </button>
                    </div>
                    <div class="flex justify-between items-center mb-2">
                      <button type="button"  id="startDatePrevYearDecade" class="text-gray-600 hover:text-gray-800">
                        ${iconSvg('chevronLeft', 'h-4 w-4')}
                      </button>
                      <span id="startDateYearRange" class="font-medium text-gray-900">2020-2029</span>
                      <button type="button"  id="startDateNextYearDecade" class="text-gray-600 hover:text-gray-800">
                        ${iconSvg('chevronRight', 'h-4 w-4')}
                      </button>
                    </div>
                    <div id="startDateYearGrid" class="grid grid-cols-3 gap-1.5">
                      <!-- 年份按钮将通过JavaScript动态生成 -->
                    </div>
                  </div>
                  
                  <div class="grid grid-cols-7 gap-1 mb-1.5">
                    <div class="text-center text-[11px] font-semibold text-gray-600 py-0.5">日</div>
                    <div class="text-center text-[11px] font-semibold text-gray-600 py-0.5">一</div>
                    <div class="text-center text-[11px] font-semibold text-gray-600 py-0.5">二</div>
                    <div class="text-center text-[11px] font-semibold text-gray-600 py-0.5">三</div>
                    <div class="text-center text-[11px] font-semibold text-gray-600 py-0.5">四</div>
                    <div class="text-center text-[11px] font-semibold text-gray-600 py-0.5">五</div>
                    <div class="text-center text-[11px] font-semibold text-gray-600 py-0.5">六</div>
                  </div>
                  <div id="startDateCalendar" class="grid grid-cols-7 gap-1"></div>
                  
                  <!-- 回到今天按钮 -->
                  <div class="mt-1 pt-1 border-t border-gray-200">
                    <button type="button" id="startDateGoToToday" class="w-full px-3 py-0.5 text-xs text-indigo-600 hover:bg-indigo-50 rounded-md">
                      回到今天
                    </button>
                  </div>
                </div>
            </div>
            <div id="startDateLunar" class="mt-0.5 text-xs text-indigo-600 opacity-0 transition-opacity"></div>
            <div id="startDateError" class="mt-1 hidden text-sm text-red-600" data-error-for="startDate"></div>
          </div>
          
          <div>
            <label for="periodValue" class="block text-sm font-medium text-gray-700 mb-1">周期数值 <span class="text-red-500">*</span></label>
            <div class="relative">
              <input type="number" id="periodValue" min="1" value="1" required
                class="${inputLogin} pr-9 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none">
              <div class="absolute inset-y-1 right-1 flex w-6 flex-col overflow-hidden rounded-md border border-gray-200 bg-gray-50 text-gray-500 shadow-sm">
                <button type="button" class="flex flex-1 items-center justify-center hover:bg-indigo-50 hover:text-indigo-600" data-number-stepper="periodValue" data-step="1" aria-label="增加周期数值">
                  <svg class="h-3 w-3" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M10 6.5a.75.75 0 01.53.22l4 4a.75.75 0 11-1.06 1.06L10 8.31l-3.47 3.47a.75.75 0 11-1.06-1.06l4-4A.75.75 0 0110 6.5z" clip-rule="evenodd"/></svg>
                </button>
                <button type="button" class="flex flex-1 items-center justify-center border-t border-gray-200 hover:bg-indigo-50 hover:text-indigo-600" data-number-stepper="periodValue" data-step="-1" aria-label="减少周期数值">
                  <svg class="h-3 w-3" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M10 13.5a.75.75 0 01-.53-.22l-4-4a.75.75 0 011.06-1.06L10 11.69l3.47-3.47a.75.75 0 111.06 1.06l-4 4a.75.75 0 01-.53.22z" clip-rule="evenodd"/></svg>
                </button>
              </div>
            </div>
            <div id="periodValueError" class="mt-1 hidden text-sm text-red-600" data-error-for="periodValue"></div>
          </div>
          
          <div>
            <label for="periodUnit" class="block text-sm font-medium text-gray-700 mb-1">周期单位 <span class="text-red-500">*</span></label>
            <select id="periodUnit" required class="hidden">
              <option value="day">天</option>
              <option value="month" selected>月</option>
              <option value="year">年</option>
            </select>
            <div class="relative min-w-0" data-modal-select-root="periodUnit">
              <button type="button" id="periodUnitTrigger" class="${selectLogin} flex cursor-pointer items-center justify-between gap-2 text-left" aria-haspopup="listbox" aria-expanded="false" aria-controls="periodUnitDropdown">
                <span id="periodUnitDisplay" class="min-w-0 flex-1 truncate">月</span>
                <svg id="periodUnitChevron" class="h-4 w-4 shrink-0 text-gray-400 transition-transform duration-200" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clip-rule="evenodd"/></svg>
              </button>
              <div id="periodUnitDropdown" class="hidden absolute left-0 right-0 top-full z-[100] mt-1 max-h-60 min-w-0 overflow-x-hidden overflow-y-auto rounded-xl border border-gray-200 bg-white px-1 py-1 shadow-lg" role="listbox" aria-labelledby="periodUnitTrigger"></div>
            </div>
            <div id="periodUnitError" class="mt-1 hidden text-sm text-red-600" data-error-for="periodUnit"></div>
          </div>
        </div>
        
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div class="md:col-span-2">
            <div class="flex gap-3" style="align-items: flex-end;">
              <div class="relative flex-1 min-w-0">
                <label for="expiryDate" class="block text-sm font-medium text-gray-700 mb-1">到期日期 <span class="text-red-500">*</span> <span class="text-xs font-normal text-gray-500">后端自动续订时，会按当前到期日期 + 周期推算下一次到期</span></label>
                <div class="relative">
                  <input type="text" id="expiryDate" required
                    class="${inputLoginDateRight}"
                    placeholder="YYYY-MM-DD 或点击右侧图标选择">
                  <div class="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none text-gray-400">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="20" height="20" fill="currentColor" style="opacity:1;"><path  d="M14 11.5V6H2v5.5A2.5 2.5 0 0 0 4.5 14h7a2.5 2.5 0 0 0 2.5-2.5M5.997 8.248a.748.748 0 1 1-1.497 0a.748.748 0 0 1 1.497 0m0 2.5a.748.748 0 1 1-1.497 0a.748.748 0 0 1 1.497 0m2.752-2.5a.748.748 0 1 1-1.497 0a.748.748 0 0 1 1.497 0m0 2.5a.748.748 0 1 1-1.497 0a.748.748 0 0 1 1.497 0m2.748-2.5a.748.748 0 1 1-1.497 0a.748.748 0 0 1 1.497 0M14 4.5A2.5 2.5 0 0 0 11.5 2h-7A2.5 2.5 0 0 0 2 4.5V5h12z"/></svg>
                  </div>
                  <div id="expiryDatePicker" class="hidden absolute top-full left-0 z-50 w-[300px] rounded-xl border border-gray-200 bg-white px-3 py-2 shadow-xl">
                <div class="flex justify-between items-center mb-1.5">
                  <button type="button" id="expiryDatePrevMonth" class="text-gray-600 hover:text-gray-800">
                    ${iconSvg('chevronLeft', 'h-4 w-4')}
                  </button>
                  <div class="flex items-center space-x-2">
                    <span id="expiryDateYear" class="font-medium text-gray-900 cursor-pointer hover:text-indigo-600">2024</span>
                    <span class="text-gray-400">|</span>
                    <span id="expiryDateMonth" class="font-medium text-gray-900 cursor-pointer hover:text-indigo-600">1月</span>
                  </div>
                  <button type="button" id="expiryDateNextMonth" class="text-gray-600 hover:text-gray-800">
                    ${iconSvg('chevronRight', 'h-4 w-4')}
                  </button>
                </div>
                
                <!-- 月份选择器 -->
                <div id="expiryDateMonthPicker" class="hidden mb-2">
                  <div class="flex justify-between items-center mb-2">
                    <span class="font-medium text-gray-900">选择月份</span>
                    <button type="button" id="expiryDateBackToCalendar" class="text-gray-600 hover:text-gray-800">
                      ${iconSvg('x', 'h-4 w-4')}
                    </button>
                  </div>
                  <div class="grid grid-cols-3 gap-1.5">
                    <button type="button" class="${monthBtnBase}" data-month="0">1月</button>
                    <button type="button" class="${monthBtnBase}" data-month="1">2月</button>
                    <button type="button" class="${monthBtnBase}" data-month="2">3月</button>
                    <button type="button" class="${monthBtnBase}" data-month="3">4月</button>
                    <button type="button" class="${monthBtnBase}" data-month="4">5月</button>
                    <button type="button" class="${monthBtnBase}" data-month="5">6月</button>
                    <button type="button" class="${monthBtnBase}" data-month="6">7月</button>
                    <button type="button" class="${monthBtnBase}" data-month="7">8月</button>
                    <button type="button" class="${monthBtnBase}" data-month="8">9月</button>
                    <button type="button" class="${monthBtnBase}" data-month="9">10月</button>
                    <button type="button" class="${monthBtnBase}" data-month="10">11月</button>
                    <button type="button" class="${monthBtnBase}" data-month="11">12月</button>
                  </div>
                </div>
                
                <!-- 年份选择器 -->
                <div id="expiryDateYearPicker" class="hidden mb-2">
                  <div class="flex justify-between items-center mb-1.5">
                    <span class="font-medium text-gray-900">选择年份</span>
                    <button type="button" id="expiryDateBackToCalendarFromYear" class="text-gray-600 hover:text-gray-800">
                      ${iconSvg('x', 'h-4 w-4')}
                    </button>
                  </div>
                  <div class="flex justify-between items-center mb-2">
                    <button  type="button" id="expiryDatePrevYearDecade" class="text-gray-600 hover:text-gray-800">
                      ${iconSvg('chevronLeft', 'h-4 w-4')}
                    </button>
                    <span id="expiryDateYearRange" class="font-medium text-gray-900">2020-2029</span>
                    <button  type="button"  id="expiryDateNextYearDecade" class="text-gray-600 hover:text-gray-800">
                      ${iconSvg('chevronRight', 'h-4 w-4')}
                    </button>
                  </div>
                  <div id="expiryDateYearGrid" class="grid grid-cols-3 gap-1.5">
                    <!-- 年份按钮将通过JavaScript动态生成 -->
                  </div>
                </div>
                
                <div class="grid grid-cols-7 gap-1 mb-1.5">
                  <div class="text-center text-[11px] font-semibold text-gray-600 py-0.5">日</div>
                  <div class="text-center text-[11px] font-semibold text-gray-600 py-0.5">一</div>
                  <div class="text-center text-[11px] font-semibold text-gray-600 py-0.5">二</div>
                  <div class="text-center text-[11px] font-semibold text-gray-600 py-0.5">三</div>
                  <div class="text-center text-[11px] font-semibold text-gray-600 py-0.5">四</div>
                  <div class="text-center text-[11px] font-semibold text-gray-600 py-0.5">五</div>
                  <div class="text-center text-[11px] font-semibold text-gray-600 py-0.5">六</div>
                </div>
                <div id="expiryDateCalendar" class="grid grid-cols-7 gap-1"></div>
                
                <!-- 回到今天按钮 -->
                <div class="mt-1 pt-1 border-t border-gray-200">
                  <button type="button" id="expiryDateGoToToday" class="w-full px-3 py-0.5 text-xs text-indigo-600 hover:bg-indigo-50 rounded-md">
                    回到今天
                  </button>
                </div>
                  </div>
                </div>
              </div>
              <button type="button" id="calculateExpiryBtn" 
                class="${btnPrimary} shrink-0 whitespace-nowrap">
                自动计算到期日期
              </button>
            </div>
            <div id="expiryDateLunar" class="mt-0.5 text-xs text-indigo-600 opacity-0 transition-opacity"></div>
            <div id="expiryDateError" class="mt-1 hidden text-sm text-red-600" data-error-for="expiryDate"></div>
          </div>
        </div>
        
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label for="reminderValue" class="block text-sm font-medium text-gray-700 mb-1">提醒提前量</label>
            <div class="flex space-x-3">
              <div class="relative flex-1 min-w-0">
                <input type="number" id="reminderValue" min="0" value="7"
                  class="${inputLogin} pr-9 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none">
                <div class="absolute inset-y-1 right-1 flex w-6 flex-col overflow-hidden rounded-md border border-gray-200 bg-gray-50 text-gray-500 shadow-sm">
                  <button type="button" class="flex flex-1 items-center justify-center hover:bg-indigo-50 hover:text-indigo-600" data-number-stepper="reminderValue" data-step="1" aria-label="增加提醒提前量">
                    <svg class="h-3 w-3" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M10 6.5a.75.75 0 01.53.22l4 4a.75.75 0 11-1.06 1.06L10 8.31l-3.47 3.47a.75.75 0 11-1.06-1.06l4-4A.75.75 0 0110 6.5z" clip-rule="evenodd"/></svg>
                  </button>
                  <button type="button" class="flex flex-1 items-center justify-center border-t border-gray-200 hover:bg-indigo-50 hover:text-indigo-600" data-number-stepper="reminderValue" data-step="-1" aria-label="减少提醒提前量">
                    <svg class="h-3 w-3" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M10 13.5a.75.75 0 01-.53-.22l-4-4a.75.75 0 011.06-1.06L10 11.69l3.47-3.47a.75.75 0 111.06 1.06l-4 4a.75.75 0 01-.53.22z" clip-rule="evenodd"/></svg>
                  </button>
                </div>
              </div>
              <select id="reminderUnit" class="hidden">
                <option value="day" selected>天</option>
                <option value="hour">小时</option>
              </select>
              <div class="relative w-32 shrink-0" data-modal-select-root="reminderUnit">
                <button type="button" id="reminderUnitTrigger" class="${selectLoginW32} flex cursor-pointer items-center justify-between gap-2 text-left" aria-haspopup="listbox" aria-expanded="false" aria-controls="reminderUnitDropdown">
                  <span id="reminderUnitDisplay" class="min-w-0 flex-1 truncate">天</span>
                  <svg id="reminderUnitChevron" class="h-4 w-4 shrink-0 text-gray-400 transition-transform duration-200" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clip-rule="evenodd"/></svg>
                </button>
                <div id="reminderUnitDropdown" class="hidden absolute left-0 right-0 top-full z-[100] mt-1 max-h-60 min-w-0 overflow-x-hidden overflow-y-auto rounded-xl border border-gray-200 bg-white px-1 py-1 shadow-lg" role="listbox" aria-labelledby="reminderUnitTrigger"></div>
              </div>
            </div>
            <p class="text-xs text-gray-500 mt-1">0 = 仅在到期时提醒；选择“小时”需要将 Worker 定时任务调整为小时级执行</p>
            <div id="reminderValueError" class="mt-1 hidden text-sm text-red-600" data-error-for="reminderValue"></div>
          </div>
          
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">选项设置</label>
            <div class="grid grid-cols-2 gap-3">
              <label class="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                <span class="text-sm text-gray-700">启用订阅</span>
                <span class="relative inline-flex items-center">
                  <input type="checkbox" id="isActive" checked class="peer sr-only">
                  <span class="h-5 w-9 rounded-full bg-gray-300 transition peer-checked:bg-indigo-600 peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-500/40 peer-focus-visible:ring-offset-2"></span>
                  <span class="absolute left-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition peer-checked:translate-x-4"></span>
                </span>
              </label>
              <label class="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                <span class="text-sm text-gray-700">自动续订</span>
                <span class="relative inline-flex items-center">
                  <input type="checkbox" id="autoRenew" checked class="peer sr-only">
                  <span class="h-5 w-9 rounded-full bg-gray-300 transition peer-checked:bg-indigo-600 peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-500/40 peer-focus-visible:ring-offset-2"></span>
                  <span class="absolute left-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition peer-checked:translate-x-4"></span>
                </span>
              </label>
            </div>
          </div>
        </div>
        
        <div>
          <label for="notes" class="block text-sm font-medium text-gray-700 mb-1">备注</label>
          <textarea id="notes" rows="4" placeholder="可添加相关备注信息..."
            class="${textareaLogin}"></textarea>
          <div id="notesError" class="mt-1 hidden text-sm text-red-600" data-error-for="notes"></div>
        </div>
        
        <div class="flex justify-end space-x-3 pt-4 border-t border-gray-200">
          <button type="button" id="cancelBtn" 
            class="${btnOutline}">
            取消
          </button>
          <button type="submit" 
            class="${btnPrimary}">
            保存
          </button>
        </div>
      </form>
    </div>
    </div>
  </div>

  <script>
    // 兼容性函数 - 保持原有接口
    function formatBeijingTime(date = new Date(), format = 'full') {
      try {
        const timezone = 'Asia/Shanghai';
        const dateObj = new Date(date);
        
        if (format === 'date') {
          return dateObj.toLocaleDateString('zh-CN', {
            timeZone: timezone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
          });
        } else if (format === 'datetime') {
          return dateObj.toLocaleString('zh-CN', {
            timeZone: timezone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
          });
        } else {
          // full format
          return dateObj.toLocaleString('zh-CN', {
            timeZone: timezone
          });
        }
      } catch (error) {
        return new Date(date).toISOString();
      }
    }

    // 农历转换工具函数 - 前端版本
    const lunarCalendar = {
      // 农历数据 (1900-2100年)
      lunarInfo: [
        0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0, 0x09ad0, 0x055d2,
        0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255, 0x0b540, 0x0d6a0, 0x0ada2, 0x095b0, 0x14977,
        0x04970, 0x0a4b0, 0x0b4b5, 0x06a50, 0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970,
        0x06566, 0x0d4a0, 0x0ea50, 0x06e95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950,
        0x0d4a0, 0x1d8a6, 0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0, 0x0d2b2, 0x0a950, 0x0b557,
        0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5b0, 0x14573, 0x052b0, 0x0a9a8, 0x0e950, 0x06aa0,
        0x0aea6, 0x0ab50, 0x04b60, 0x0aae4, 0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0,
        0x096d0, 0x04dd5, 0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558, 0x0b540, 0x0b6a0, 0x195a6,
        0x095b0, 0x049b0, 0x0a974, 0x0a4b0, 0x0b27a, 0x06a50, 0x06d40, 0x0af46, 0x0ab60, 0x09570,
        0x04af5, 0x04970, 0x064b0, 0x074a3, 0x0ea50, 0x06b58, 0x055c0, 0x0ab60, 0x096d5, 0x092e0,
        0x0c960, 0x0d954, 0x0d4a0, 0x0da50, 0x07552, 0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5,
        0x0a950, 0x0b4a0, 0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930,
        0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260, 0x0ea65, 0x0d530,
        0x05aa0, 0x076a3, 0x096d0, 0x04bd7, 0x04ad0, 0x0a4d0, 0x1d0b6, 0x0d250, 0x0d520, 0x0dd45,
        0x0b5a0, 0x056d0, 0x055b2, 0x049b0, 0x0a577, 0x0a4b0, 0x0aa50, 0x1b255, 0x06d20, 0x0ada0
      ],

      // 天干地支
      gan: ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'],
      zhi: ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'],

      // 农历月份
      months: ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊'],

      // 农历日期
      days: ['初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
             '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
             '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十'],

      // 获取农历年天数
      lunarYearDays: function(year) {
        let sum = 348;
        for (let i = 0x8000; i > 0x8; i >>= 1) {
          sum += (this.lunarInfo[year - 1900] & i) ? 1 : 0;
        }
        return sum + this.leapDays(year);
      },

      // 获取闰月天数
      leapDays: function(year) {
        if (this.leapMonth(year)) {
          return (this.lunarInfo[year - 1900] & 0x10000) ? 30 : 29;
        }
        return 0;
      },

      // 获取闰月月份
      leapMonth: function(year) {
        return this.lunarInfo[year - 1900] & 0xf;
      },

      // 获取农历月天数
      monthDays: function(year, month) {
        return (this.lunarInfo[year - 1900] & (0x10000 >> month)) ? 30 : 29;
      },

      // 公历转农历
      solar2lunar: function(year, month, day) {
        if (year < 1900 || year > 2100) return null;

        const baseDate = new Date(1900, 0, 31);
        const objDate = new Date(year, month - 1, day);
        //let offset = Math.floor((objDate - baseDate) / 86400000);
        let offset = Math.round((objDate - baseDate) / 86400000);


        let temp = 0;
        let lunarYear = 1900;

        for (lunarYear = 1900; lunarYear < 2101 && offset > 0; lunarYear++) {
          temp = this.lunarYearDays(lunarYear);
          offset -= temp;
        }

        if (offset < 0) {
          offset += temp;
          lunarYear--;
        }

        let lunarMonth = 1;
        let leap = this.leapMonth(lunarYear);
        let isLeap = false;

        for (lunarMonth = 1; lunarMonth < 13 && offset > 0; lunarMonth++) {
          if (leap > 0 && lunarMonth === (leap + 1) && !isLeap) {
            --lunarMonth;
            isLeap = true;
            temp = this.leapDays(lunarYear);
          } else {
            temp = this.monthDays(lunarYear, lunarMonth);
          }

          if (isLeap && lunarMonth === (leap + 1)) isLeap = false;
          offset -= temp;
        }

        if (offset === 0 && leap > 0 && lunarMonth === leap + 1) {
          if (isLeap) {
            isLeap = false;
          } else {
            isLeap = true;
            --lunarMonth;
          }
        }

        if (offset < 0) {
          offset += temp;
          --lunarMonth;
        }

        const lunarDay = offset + 1;

        // 生成农历字符串
        const ganIndex = (lunarYear - 4) % 10;
        const zhiIndex = (lunarYear - 4) % 12;
        const yearStr = this.gan[ganIndex] + this.zhi[zhiIndex] + '年';
        const monthStr = (isLeap ? '闰' : '') + this.months[lunarMonth - 1] + '月';
        const dayStr = this.days[lunarDay - 1];

        return {
          year: lunarYear,
          month: lunarMonth,
          day: lunarDay,
          isLeap: isLeap,
          yearStr: yearStr,
          monthStr: monthStr,
          dayStr: dayStr,
          fullStr: yearStr + monthStr + dayStr
        };
      }
    };
	

// 新增修改，农历转公历（简化，适用1900-2100年）
function lunar2solar(lunar) {
  for (let y = lunar.year - 1; y <= lunar.year + 1; y++) {
    for (let m = 1; m <= 12; m++) {
      for (let d = 1; d <= 31; d++) {
        const date = new Date(y, m - 1, d);
        if (date.getFullYear() !== y || date.getMonth() + 1 !== m || date.getDate() !== d) continue;
        const l = lunarCalendar.solar2lunar(y, m, d);
        if (
          l &&
          l.year === lunar.year &&
          l.month === lunar.month &&
          l.day === lunar.day &&
          l.isLeap === lunar.isLeap
        ) {
          return { year: y, month: m, day: d };
        }
      }
    }
  }
  return null;
}

// 新增修改，农历加周期，前期版本
function addLunarPeriod(lunar, periodValue, periodUnit) {
  let { year, month, day, isLeap } = lunar;
  if (periodUnit === 'year') {
    year += periodValue;
    const leap = lunarCalendar.leapMonth(year);
    if (isLeap && leap === month) {
      isLeap = true;
    } else {
      isLeap = false;
    }
  } else if (periodUnit === 'month') {
    let totalMonths = (year - 1900) * 12 + (month - 1) + periodValue;
    year = Math.floor(totalMonths / 12) + 1900;
    month = (totalMonths % 12) + 1;
    const leap = lunarCalendar.leapMonth(year);
    if (isLeap && leap === month) {
      isLeap = true;
    } else {
      isLeap = false;
    }
  } else if (periodUnit === 'day') {
    const solar = lunar2solar(lunar);
    const date = new Date(solar.year, solar.month - 1, solar.day + periodValue);
    return lunarCalendar.solar2lunar(date.getFullYear(), date.getMonth() + 1, date.getDate());
  }
  let maxDay = isLeap
    ? lunarCalendar.leapDays(year)
    : lunarCalendar.monthDays(year, month);
  let targetDay = Math.min(day, maxDay);
  while (targetDay > 0) {
    let solar = lunar2solar({ year, month, day: targetDay, isLeap });
    if (solar) {
      return { year, month, day: targetDay, isLeap };
    }
    targetDay--;
  }
  return { year, month, day, isLeap };
}

// 前端版本的 lunarBiz 对象
const lunarBiz = {
  // 农历加周期，返回新的农历日期对象
  addLunarPeriod(lunar, periodValue, periodUnit) {
    return addLunarPeriod(lunar, periodValue, periodUnit);
  },
  // 农历转公历（遍历法，适用1900-2100年）
  lunar2solar(lunar) {
    return lunar2solar(lunar);
  },
  // 距离农历日期还有多少天
  daysToLunar(lunar) {
    const solar = lunarBiz.lunar2solar(lunar);
    const date = new Date(solar.year, solar.month - 1, solar.day);
    const now = new Date();
    return Math.ceil((date - now) / (1000 * 60 * 60 * 24));
  }
};



    // 农历显示相关函数
    function updateLunarDisplay(dateInputId, lunarDisplayId) {
      const dateInput = document.getElementById(dateInputId);
      const lunarDisplay = document.getElementById(lunarDisplayId);
      const showLunar = document.getElementById('showLunar');

      if (!dateInput || !lunarDisplay) {
        return;
      }

      if (!dateInput.value || !showLunar || !showLunar.checked) {
        lunarDisplay.classList.remove('opacity-100');
        lunarDisplay.classList.add('opacity-0');
        return;
      }

      const date = new Date(dateInput.value);
      const lunar = lunarCalendar.solar2lunar(date.getFullYear(), date.getMonth() + 1, date.getDate());

      if (lunar) {
        lunarDisplay.textContent = '农历：' + lunar.fullStr;
        lunarDisplay.classList.remove('opacity-0');
        lunarDisplay.classList.add('opacity-100');
      } else {
        lunarDisplay.classList.remove('opacity-100');
        lunarDisplay.classList.add('opacity-0');
      }
    }

    function toggleLunarDisplay() {
      const showLunar = document.getElementById('showLunar');
      if (!showLunar) {
        return;
      }

      updateLunarDisplay('startDate', 'startDateLunar');
      updateLunarDisplay('expiryDate', 'expiryDateLunar');

      localStorage.setItem('showLunar', String(showLunar.checked));

      if (window.startDatePicker && typeof window.startDatePicker.render === 'function') {
        window.startDatePicker.render();
      }
      if (window.expiryDatePicker && typeof window.expiryDatePicker.render === 'function') {
        window.expiryDatePicker.render();
      }
    }

    function loadLunarPreference() {
      const showLunar = document.getElementById('showLunar');
      if (!showLunar) {
        return;
      }
      
      const saved = localStorage.getItem('showLunar');
      if (saved !== null) {
        showLunar.checked = saved === 'true';
      } else {
        showLunar.checked = true; // 默认显示
      }
      toggleLunarDisplay();
    }

    function handleListLunarToggle() {
      const listShowLunar = document.getElementById('listShowLunar');
      if (!listShowLunar) {
        return;
      }
      localStorage.setItem('listShowLunar', String(listShowLunar.checked));
      renderSubscriptionTable();
    }

    function showToast(message, type = 'success', duration = 3000) {
      const container = document.getElementById('toast-container');
      const toast = document.createElement('div');
      const bg =
        type === 'success'
          ? 'bg-emerald-600'
          : type === 'error'
            ? 'bg-red-500'
            : type === 'warning'
              ? 'bg-amber-500'
              : 'bg-sky-600';
      toast.className = '${twToast} ' + bg;

      const iconSvg =
        type === 'success'
          ? '<svg class="h-4 w-4 shrink-0" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.86-9.86a.75.75 0 00-1.06-1.06L9 10.88 7.2 9.08a.75.75 0 10-1.06 1.06l2.33 2.33c.293.293.767.293 1.06 0l4.33-4.33z" clip-rule="evenodd"/></svg>'
          : type === 'error'
            ? '<svg class="h-4 w-4 shrink-0" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm0-4a.9.9 0 100-1.8.9.9 0 000 1.8zm.75-8.25a.75.75 0 00-1.5 0v4.5a.75.75 0 001.5 0v-4.5z" clip-rule="evenodd"/></svg>'
            : type === 'warning'
              ? '<svg class="h-4 w-4 shrink-0" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M8.485 3.495a1.75 1.75 0 013.03 0l6.28 10.875A1.75 1.75 0 0116.28 17H3.72a1.75 1.75 0 01-1.515-2.63l6.28-10.875zM10.75 7a.75.75 0 00-1.5 0v4a.75.75 0 001.5 0V7zM10 14.25a.875.875 0 100-1.75.875.875 0 000 1.75z" clip-rule="evenodd"/></svg>'
              : '<svg class="h-4 w-4 shrink-0" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M18 10A8 8 0 112 10a8 8 0 0116 0zM9.25 8a.75.75 0 011.5 0v6a.75.75 0 01-1.5 0V8zM10 5.75a.875.875 0 100-1.75.875.875 0 000 1.75z" clip-rule="evenodd"/></svg>';

      toast.innerHTML = '<div class="flex items-center gap-2">' + iconSvg + '<span>' + message + '</span></div>';

      container.appendChild(toast);
      requestAnimationFrame(() => toast.classList.add('${twToastIn}'));
      setTimeout(() => {
        toast.classList.remove('${twToastIn}');
        setTimeout(() => {
          if (container.contains(toast)) {
            container.removeChild(toast);
          }
        }, 320);
      }, duration);
    }

    const modalFieldErrorClasses = [
      'border-red-300',
      'bg-red-50',
      'ring-2',
      'ring-red-500/20',
      'focus:border-red-500',
      'focus:ring-red-500/20',
    ];

    function getFieldErrorTarget(fieldId) {
      return document.getElementById(fieldId + 'Trigger') || document.getElementById(fieldId);
    }

    function showFieldError(fieldId, message) {
      const field = getFieldErrorTarget(fieldId);
      const errorDiv = document.querySelector('[data-error-for="' + fieldId + '"]');
      if (errorDiv && field) {
        errorDiv.textContent = message;
        errorDiv.className = 'mt-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700';
        errorDiv.classList.remove('hidden');
        errorDiv.classList.add('block');
        field.classList.add(...modalFieldErrorClasses);
        field.setAttribute('aria-invalid', 'true');
        field.setAttribute('aria-describedby', fieldId + 'Error');
      }
    }

    function clearFieldErrors() {
      document.querySelectorAll('[data-error-for]').forEach((el) => {
        el.textContent = '';
        el.classList.add('hidden');
        el.classList.remove('block');
      });
      document.querySelectorAll('[aria-invalid="true"]').forEach((el) => {
        el.classList.remove(...modalFieldErrorClasses);
        el.removeAttribute('aria-invalid');
        el.removeAttribute('aria-describedby');
      });
    }

    function validateForm() {
      clearFieldErrors();
      let isValid = true;

      const name = document.getElementById('name').value.trim();
      if (!name) {
        showFieldError('name', '请输入订阅名称');
        isValid = false;
      }

      const periodValue = document.getElementById('periodValue').value;
      if (!periodValue || periodValue < 1) {
        showFieldError('periodValue', '周期数值必须大于0');
        isValid = false;
      }

      const expiryDate = document.getElementById('expiryDate').value;
      if (!expiryDate) {
        showFieldError('expiryDate', '请选择到期日期');
        isValid = false;
      }

      const reminderValueField = document.getElementById('reminderValue');
      const reminderValue = reminderValueField.value;
      if (reminderValue === '' || Number(reminderValue) < 0) {
        showFieldError('reminderValue', '提醒值不能为负数');
        isValid = false;
      }

      return isValid;
    }

    // 创建带悬浮提示的文本元素
    function createHoverText(text, maxLength = 30, className = 'text-sm text-gray-900') {
      if (!text || text.length <= maxLength) {
        return '<div class="' + className + '">' + text + '</div>';
      }

      const truncated = text.substring(0, maxLength) + '...';
      return (
        '<div class="relative w-full max-w-full">' +
        '<div class="block w-full max-w-full cursor-pointer truncate text-left transition hover:text-indigo-600 ' +
        className +
        '" data-full-text="' +
        text.replace(/"/g, '&quot;') +
        '">' +
        truncated +
        '</div>' +
        '<div class="${twPop}" data-pop-tip></div>' +
        '</div>'
      );
    }

    const categorySeparator = /[\/,，\s]+/;
    let subscriptionsCache = [];
    let searchDebounceTimer = null;
    let expirySortDirection = 'asc';

    function syncExpirySortUi() {
      const header = document.getElementById('expirySortHeader');
      const icon = document.getElementById('expirySortIcon');
      const btn = document.getElementById('sortByExpiryBtn');
      if (header) {
        header.setAttribute('aria-sort', expirySortDirection === 'asc' ? 'ascending' : 'descending');
      }
      if (btn) {
        btn.setAttribute(
          'aria-label',
          expirySortDirection === 'asc'
            ? '到期时间排序：从早到晚，点击切换为从晚到早'
            : '到期时间排序：从晚到早，点击切换为从早到晚',
        );
        btn.title =
          expirySortDirection === 'asc'
            ? '当前：到期由早到晚，点击切换为从晚到早'
            : '当前：到期由晚到早，点击切换为由早到晚';
      }
      if (icon) {
        icon.classList.toggle('rotate-180', expirySortDirection === 'asc');
      }
    }

    function normalizeCategoryTokens(category = '') {
      return category
        .split(categorySeparator)
        .map(token => token.trim())
        .filter(token => token.length > 0);
    }

    function closeCategoryFilterDropdown() {
      const panel = document.getElementById('categoryFilterDropdown');
      const btn = document.getElementById('categoryFilterTrigger');
      const chevron = document.getElementById('categoryFilterChevron');
      if (panel) {
        panel.classList.add('hidden');
      }
      if (btn) {
        btn.setAttribute('aria-expanded', 'false');
      }
      if (chevron) {
        chevron.classList.remove('rotate-180');
      }
    }

    function toggleCategoryFilterDropdown() {
      const panel = document.getElementById('categoryFilterDropdown');
      const btn = document.getElementById('categoryFilterTrigger');
      const chevron = document.getElementById('categoryFilterChevron');
      if (!panel || !btn) {
        return;
      }
      const willOpen = panel.classList.contains('hidden');
      if (willOpen) {
        panel.classList.remove('hidden');
        btn.setAttribute('aria-expanded', 'true');
        if (chevron) {
          chevron.classList.add('rotate-180');
        }
      } else {
        closeCategoryFilterDropdown();
      }
    }

    function categoryFilterOptionDataValue(btn) {
      const v = btn.getAttribute('data-value');
      return v === null || v === undefined ? '' : v;
    }

    function syncCategoryFilterOptionStyles(selectedValue) {
      document.querySelectorAll('.category-filter-option').forEach((btn) => {
        const v = categoryFilterOptionDataValue(btn);
        const sel = v === selectedValue;
        btn.setAttribute('aria-selected', sel ? 'true' : 'false');
        btn.className =
          'category-filter-option flex w-full min-w-0 max-w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left text-sm ' +
          (sel ? 'bg-gray-100 text-gray-900' : 'text-gray-900 hover:bg-gray-50');
        const check = btn.querySelector('[data-category-check]');
        if (check) {
          check.classList.toggle('invisible', !sel);
        }
      });
    }

    function selectCategoryFilterValue(value, labelText) {
      const hidden = document.getElementById('categoryFilter');
      const display = document.getElementById('categoryFilterDisplay');
      if (hidden) {
        hidden.value = value;
      }
      if (display) {
        display.textContent = labelText;
      }
      syncCategoryFilterOptionStyles(value);
      closeCategoryFilterDropdown();
      renderSubscriptionTable();
    }

    function populateCategoryFilter(subscriptions) {
      const hidden = document.getElementById('categoryFilter');
      const panel = document.getElementById('categoryFilterDropdown');
      const display = document.getElementById('categoryFilterDisplay');
      if (!hidden || !panel || !display) {
        return;
      }

      const previousValue = hidden.value;
      const categories = new Set();

      (subscriptions || []).forEach(subscription => {
        normalizeCategoryTokens(subscription.category).forEach(token => categories.add(token));
      });

      const sorted = Array.from(categories).sort((a, b) => a.localeCompare(b, 'zh-CN'));

      let valueToSet = '';
      if (previousValue && sorted.some(c => c.toLowerCase() === previousValue.toLowerCase())) {
        valueToSet = sorted.find(c => c.toLowerCase() === previousValue.toLowerCase());
      }

      hidden.value = valueToSet;
      display.textContent = valueToSet || '全部分类';

      const checkSvg =
        '<svg class="h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clip-rule="evenodd"/></svg>';

      panel.textContent = '';

      function mkOption(value, label, isSelected) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.setAttribute('role', 'option');
        btn.setAttribute('aria-selected', isSelected ? 'true' : 'false');
        btn.setAttribute('data-value', value);
        btn.className =
          'category-filter-option flex w-full min-w-0 max-w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left text-sm ' +
          (isSelected ? 'bg-gray-100 text-gray-900' : 'text-gray-900 hover:bg-gray-50');
        const spanLabel = document.createElement('span');
        spanLabel.className = 'min-w-0 truncate';
        spanLabel.textContent = label;
        const spanCheck = document.createElement('span');
        spanCheck.setAttribute('data-category-check', '1');
        spanCheck.className = 'shrink-0 ' + (isSelected ? 'text-gray-900' : 'invisible text-gray-900');
        spanCheck.innerHTML = checkSvg;
        btn.appendChild(spanLabel);
        btn.appendChild(spanCheck);
        btn.addEventListener('click', () => selectCategoryFilterValue(value, label));
        return btn;
      }

      panel.appendChild(mkOption('', '全部分类', valueToSet === ''));
      sorted.forEach(cat => {
        panel.appendChild(mkOption(cat, cat, valueToSet === cat));
      });

      closeCategoryFilterDropdown();
    }

    function getReminderSettings(subscription) {
      const fallbackDays = subscription.reminderDays !== undefined ? subscription.reminderDays : 7;
      let unit = subscription.reminderUnit || '';
      let value = subscription.reminderValue;

      if (unit !== 'hour') {
        unit = 'day';
      }

      if (unit === 'hour' && (value === undefined || value === null || isNaN(value))) {
        value = subscription.reminderHours !== undefined ? subscription.reminderHours : 0;
      }

      if (value === undefined || value === null || isNaN(value)) {
        value = fallbackDays;
      }

      value = Number(value);

      return {
        unit,
        value,
        displayText: unit === 'hour' ? '提前' + value + '小时' : '提前' + value + '天'
      };
    }

    function attachHoverListeners() {
      function positionTooltip(element, tooltip) {
        const rect = element.getBoundingClientRect();
        const tooltipHeight = 100;
        const viewportHeight = window.innerHeight;
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;

        let top = rect.bottom + scrollTop + 8;
        let left = rect.left;

        if (rect.bottom + tooltipHeight > viewportHeight) {
          top = rect.top + scrollTop - tooltipHeight - 8;
        }

        const maxLeft = window.innerWidth - 320 - 20;
        if (left > maxLeft) {
          left = maxLeft;
        }

        tooltip.style.left = left + 'px';
        tooltip.style.top = top + 'px';
      }

      function bindPopTip(triggers, getText) {
        triggers.forEach((el) => {
          const text = getText(el);
          const tip = el.parentElement ? el.parentElement.querySelector('[data-pop-tip]') : null;
          if (!text || !tip) {
            return;
          }
          el.addEventListener('mouseenter', () => {
            tip.textContent = text;
            positionTooltip(el, tip);
            tip.classList.add('${twPopOpen}');
          });
          el.addEventListener('mouseleave', () => {
            tip.classList.remove('${twPopOpen}');
          });
          window.addEventListener(
            'scroll',
            () => {
              if (tip.classList.contains('${twPopOpen}')) {
                tip.classList.remove('${twPopOpen}');
              }
            },
            { passive: true },
          );
        });
      }

      bindPopTip(document.querySelectorAll('[data-full-notes]'), (el) => el.getAttribute('data-full-notes'));
      bindPopTip(document.querySelectorAll('[data-full-text]'), (el) => el.getAttribute('data-full-text'));
    }

    function renderSubscriptionTable() {
      const tbody = document.getElementById('subscriptionsBody');
      if (!tbody) {
        return;
      }

      const listShowLunar = document.getElementById('listShowLunar');
      const showLunar = listShowLunar ? listShowLunar.checked : false;
      const searchInput = document.getElementById('searchKeyword');
      const keyword = searchInput ? searchInput.value.trim().toLowerCase() : '';
      const categorySelect = document.getElementById('categoryFilter');
      const selectedCategory = categorySelect ? categorySelect.value.trim().toLowerCase() : '';

      let filtered = Array.isArray(subscriptionsCache) ? [...subscriptionsCache] : [];

      if (selectedCategory) {
        filtered = filtered.filter(subscription =>
          normalizeCategoryTokens(subscription.category).some(token => token.toLowerCase() === selectedCategory)
        );
      }

      if (keyword) {
        filtered = filtered.filter(subscription => {
          const haystack = [
            subscription.name,
            subscription.customType,
            subscription.notes,
            subscription.category
          ].filter(Boolean).join(' ').toLowerCase();
          return haystack.includes(keyword);
        });
      }

      if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-8 text-center text-sm text-gray-500">没有符合条件的订阅</td></tr>';
        return;
      }

      filtered.sort((a, b) => {
        const da = new Date(a.expiryDate).getTime();
        const db = new Date(b.expiryDate).getTime();
        return expirySortDirection === 'asc' ? da - db : db - da;
      });
      tbody.innerHTML = '';

      const currentTime = new Date();

      filtered.forEach(subscription => {
        const row = document.createElement('tr');
        row.className =
          'subscription-row' + (subscription.isActive === false ? ' subscription-row-inactive' : '');

        const calendarTypeHtml = subscription.useLunar
          ? '<div class="w-fit text-xs text-green-600 px-2 py-1 rounded bg-green-100">农历</div>'
          : '<div class="w-fit text-xs text-gray-600 px-2 py-1 rounded bg-gray-100">公历</div>';

        const expiryDate = new Date(subscription.expiryDate);
        const currentDtf = new Intl.DateTimeFormat('en-US', {
          timeZone: globalTimezone,
          hour12: false,
          year: 'numeric', month: '2-digit', day: '2-digit'
        });
        const currentParts = currentDtf.formatToParts(currentTime);
        const getCurrent = type => Number(currentParts.find(x => x.type === type).value);
        const currentDateInTimezone = Date.UTC(getCurrent('year'), getCurrent('month') - 1, getCurrent('day'), 0, 0, 0);

        const expiryDtf = new Intl.DateTimeFormat('en-US', {
          timeZone: globalTimezone,
          hour12: false,
          year: 'numeric', month: '2-digit', day: '2-digit'
        });
        const expiryParts = expiryDtf.formatToParts(expiryDate);
        const getExpiry = type => Number(expiryParts.find(x => x.type === type).value);
        const expiryDateInTimezone = Date.UTC(getExpiry('year'), getExpiry('month') - 1, getExpiry('day'), 0, 0, 0);

        const daysDiff = Math.round((expiryDateInTimezone - currentDateInTimezone) / (1000 * 60 * 60 * 24));
        const diffMs = expiryDate.getTime() - currentTime.getTime();
        const diffHours = diffMs / (1000 * 60 * 60);

        const reminder = getReminderSettings(subscription);
        const isSoon = reminder.unit === 'hour'
          ? diffHours >= 0 && diffHours <= reminder.value
          : daysDiff >= 0 && daysDiff <= reminder.value;

        let statusHtml = '';
        if (!subscription.isActive) {
          statusHtml =
            '<span class="w-fit inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-600">' +
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style="opacity:1;"><path  d="M12 22C6.477 22 2 17.523 2 12S6.477 2 12 2s10 4.477 10 10c-.006 5.52-4.48 9.994-10 10Zm1-14v8h2V8h-2ZM9 8v8h2V8H9Z"/></svg>已停用</span>';
        } else if (daysDiff < 0) {
          statusHtml =
            '<span class="w-fit inline-flex items-center gap-1 rounded-full border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-700">' +
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="16" height="16" fill="currentColor" style="opacity:1;"><path  fill-rule="evenodd" d="M256 42.667c117.803 0 213.334 95.53 213.334 213.333S373.803 469.334 256 469.334S42.667 373.803 42.667 256S138.197 42.667 256 42.667m48.918 134.25L256 225.836l-48.917-48.917l-30.165 30.165L225.835 256l-48.917 48.918l30.165 30.165L256 286.166l48.918 48.917l30.165-30.165L286.166 256l48.917-48.917z"/></svg>已过期</span>';
        } else if (isSoon) {
          statusHtml =
            '<span class="w-fit inline-flex items-center gap-1 rounded-full border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium text-amber-600">' +
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" width="16" height="16" fill="currentColor" style="opacity:1;"><path  d="M30.33 25.54L20.59 7.6a3 3 0 0 0-5.27 0L5.57 25.54A3 3 0 0 0 8.21 30h19.48a3 3 0 0 0 2.64-4.43Zm-13.87-12.8a1.49 1.49 0 0 1 3 0v6.89a1.49 1.49 0 1 1-3 0ZM18 26.25a1.72 1.72 0 1 1 1.72-1.72A1.72 1.72 0 0 1 18 26.25" class="clr-i-solid clr-i-solid-path-1"/><path fill="none" d="M0 0h36v36H0z"/></svg>即将到期</span>';
        } else {
          statusHtml =
            '<span class="w-fit inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-xs font-medium text-emerald-500">' +
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style="opacity:1;"><path  fill-rule="evenodd" d="M12 1C5.925 1 1 5.925 1 12s4.925 11 11 11s11-4.925 11-11S18.075 1 12 1m4.768 9.14a1 1 0 1 0-1.536-1.28l-4.3 5.159l-2.225-2.226a1 1 0 0 0-1.414 1.414l3 3a1 1 0 0 0 1.475-.067z" clip-rule="evenodd"/></svg>正常</span>';
        }

        let periodText = '';
        if (subscription.periodValue && subscription.periodUnit) {
          const unitMap = { day: '天', month: '月', year: '年' };
          periodText = subscription.periodValue + ' ' + (unitMap[subscription.periodUnit] || subscription.periodUnit);
        }

        const autoRenewIcon = subscription.autoRenew !== false
          ? '<div class="w-fit text-xs bg-indigo-100 text-indigo-500 py-1 px-2 rounded-md">自动续订</div>'
          : '<div class="w-fit text-xs bg-gray-100 text-gray-500 py-1 px-2 rounded-md">不自动续订</div>';

        let lunarExpiryText = '';
        let startLunarText = '';
        if (showLunar) {
          const expiryDateObj = new Date(subscription.expiryDate);
          const lunarExpiry = lunarCalendar.solar2lunar(expiryDateObj.getFullYear(), expiryDateObj.getMonth() + 1, expiryDateObj.getDate());
          lunarExpiryText = lunarExpiry ? lunarExpiry.fullStr : '';

          if (subscription.startDate) {
            const startDateObj = new Date(subscription.startDate);
            const lunarStart = lunarCalendar.solar2lunar(startDateObj.getFullYear(), startDateObj.getMonth() + 1, startDateObj.getDate());
            startLunarText = lunarStart ? lunarStart.fullStr : '';
          }
        }

        let notesHtml = '';
        if (subscription.notes) {
          const notes = subscription.notes;
          const notesTitleAttr = notes.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
          notesHtml =
            '<div class="w-full min-w-0 max-w-full line-clamp-2 break-words text-left text-xs leading-snug text-gray-500" title="' +
            notesTitleAttr +
            '">' +
            notes +
            '</div>';
        }

        const nameHtml = createHoverText(subscription.name, 20, 'text-sm font-medium text-gray-900');
        const typeHtml = createHoverText(subscription.customType || '其他', 15, 'text-sm text-gray-900');
        const periodHtml = periodText ? createHoverText('周期: ' + periodText, 20, 'text-sm text-gray-500') : '';

        const categoryTokens = normalizeCategoryTokens(subscription.category);
        const categoryTagsInner = categoryTokens.map(cat =>
          '<span class="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2 py-0.5 text-xs font-medium text-gray-500"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" style="opacity:1;"><path  d="M2.587 7.314a1.99 1.99 0 0 0 0 2.822l3.296 3.28a2.013 2.013 0 0 0 2.836 0l4.67-4.647a2 2 0 0 0 .587-1.397L14 4.01A2 2 0 0 0 11.987 2l-3.25.014a2 2 0 0 0-1.41.584zM11 6a1 1 0 1 1 0-2a1 1 0 0 1 0 2"/></svg>' + cat + '</span>'
        ).join('');
        const typeFirstRowHtml =
          '<div class="flex flex-wrap items-start gap-x-2 gap-y-1">' +
            '<div class="min-w-0 flex items-center gap-1">' + typeHtml + '</div>' +
            (categoryTokens.length
              ? '<div class="flex max-w-full shrink-0 flex-wrap items-center gap-1.5">' + categoryTagsInner + '</div>'
              : '') +
          '</div>';

        function formatDateInTimezone(date, timezone) {
          const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: timezone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
          }).formatToParts(date);
          const y = parts.find(p => p.type === 'year').value;
          const m = parts.find(p => p.type === 'month').value;
          const d = parts.find(p => p.type === 'day').value;
          return y + '-' + m + '-' + d;
        }

        const expiryDateText = formatDateInTimezone(new Date(subscription.expiryDate), globalTimezone);
        const lunarHtml = lunarExpiryText ? createHoverText('农历: ' + lunarExpiryText, 25, 'text-xs text-blue-600 mt-1') : '';

        let daysLeftText = '';
        if (diffMs < 0) {
          const absDays = Math.abs(daysDiff);
          if (absDays >= 1) {
            daysLeftText = '已过期' + absDays + '天';
          } else {
            const absHours = Math.ceil(Math.abs(diffHours));
            daysLeftText = '已过期' + absHours + '小时';
          }
        } else if (daysDiff >= 1) {
          daysLeftText = '还剩' + daysDiff + '天';
        } else {
          const hoursLeft = Math.max(0, Math.ceil(diffHours));
          daysLeftText = hoursLeft > 0 ? '约 ' + hoursLeft + ' 小时后到期' : '即将到期';
        }

        const startDateText = subscription.startDate
          ? '开始: ' + formatDateInTimezone(new Date(subscription.startDate), globalTimezone) + (startLunarText ? ' (' + startLunarText + ')' : '')
          : '';
        const startDateHtml = startDateText ? createHoverText(startDateText, 30, 'text-sm text-gray-500') : '';

        const reminderExtra = reminder.value === 0
          ? '<div class="text-xs text-gray-500 mt-2">仅到期时提醒</div>'
          : (reminder.unit === 'hour' ? '<div class="text-xs text-gray-500 mt-2">小时级提醒</div>' : '');
        const reminderHtml = '<div class="flex items-center gap-1">' + reminder.displayText + '</div>' + reminderExtra;

        row.innerHTML =
          '<td data-label="订阅名称"><div class="td-content-wrapper min-w-0 max-w-full space-y-1">' +
            nameHtml +
            notesHtml +
          '</div></td>' +
          '<td data-label="类型"><div class="td-content-wrapper space-y-1">' +
            typeFirstRowHtml +
            (periodHtml ? '<div class="flex items-center gap-1">' + periodHtml + calendarTypeHtml + '</div>' : '') +
          '</div></td>' +
          '<td data-label="到期时间"><div class="td-content-wrapper space-y-1">' +
            '<div class="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm text-gray-900">' +
              '<span class="tabular-nums">' + expiryDateText + '</span>' +
              '<span class="text-xs font-normal text-gray-500 px-2 py-1 rounded bg-gray-100">' + daysLeftText + '</span>' +
            '</div>' +
            lunarHtml +
            startDateHtml +
          '</div></td>' +
          '<td data-label="提醒设置"><div class="td-content-wrapper text-gray-700">' +
            reminderHtml +
          '</div></td>' +
          '<td data-label="状态"><div class="td-content-wrapper flex flex-col gap-2">' + statusHtml + autoRenewIcon + '</div></td>' +
          '<td data-label="操作">' +
            '<div class="action-buttons-wrapper">' +
              '<button class="edit ${btnPrimarySm} whitespace-nowrap" data-id="' + subscription.id + '"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="#fff" style="opacity:1;"><path  d="M19 20H5a1 1 0 0 0 0 2h14a1 1 0 0 0 0-2M5 18h.09l4.17-.38a2 2 0 0 0 1.21-.57l9-9a1.92 1.92 0 0 0-.07-2.71L16.66 2.6A2 2 0 0 0 14 2.53l-9 9a2 2 0 0 0-.57 1.21L4 16.91a1 1 0 0 0 .29.8A1 1 0 0 0 5 18M15.27 4L18 6.73l-2 1.95L13.32 6Z"/></svg>编辑</button>' +
              '<button class="test-notify ${btnInfoSm} whitespace-nowrap" data-id="' + subscription.id + '"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="16" height="16" fill="#fff" style="opacity:1;"><path  d="M4.176 2.164C2.988 1.57 1.671 2.7 2.077 3.965l2.858 8.883a1 1 0 0 0 .787.68l11.869 1.979c.557.093.557.893 0 .986L5.723 18.471a1 1 0 0 0-.788.68l-2.858 8.886c-.407 1.265.91 2.395 2.099 1.801L29.17 17.343c1.106-.553 1.106-2.13 0-2.684z"/></svg>测试</button>' +
              '<button class="delete ${btnDangerSm} whitespace-nowrap" data-id="' + subscription.id + '"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="#fff" style="opacity:1;"><path  d="M7 21q-.825 0-1.412-.587T5 19V6q-.425 0-.712-.288T4 5t.288-.712T5 4h4q0-.425.288-.712T10 3h4q.425 0 .713.288T15 4h4q.425 0 .713.288T20 5t-.288.713T19 6v13q0 .825-.587 1.413T17 21zm3-4q.425 0 .713-.288T11 16V9q0-.425-.288-.712T10 8t-.712.288T9 9v7q0 .425.288.713T10 17m4 0q.425 0 .713-.288T15 16V9q0-.425-.288-.712T14 8t-.712.288T13 9v7q0 .425.288.713T14 17"/></svg>删除</button>' +
              (subscription.isActive
                ? '<button class="toggle-status ${btnWarningSm} whitespace-nowrap" data-id="' + subscription.id + '" data-action="deactivate"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="#fff" style="opacity:1;"><path  d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2m-2 13a1 1 0 0 1-2 0V9a1 1 0 0 1 2 0Zm6 0a1 1 0 0 1-2 0V9a1 1 0 0 1 2 0Z"/></svg>停用</button>'
                : '<button class="toggle-status ${btnSuccessSm} whitespace-nowrap" data-id="' + subscription.id + '" data-action="activate"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="16" height="16" fill="#fff" style="opacity:1;"><path  d="M64 320C64 178.6 178.6 64 320 64s256 114.6 256 256s-114.6 256-256 256S64 461.4 64 320m188.3-108.9c-7.6 4.2-12.3 12.3-12.3 20.9v176c0 8.7 4.7 16.7 12.3 20.9s16.8 4.1 24.3-.5l144-88c7.1-4.4 11.5-12.1 11.5-20.5s-4.4-16.1-11.5-20.5l-144-88c-7.4-4.5-16.7-4.7-24.3-.5z"/></svg>启用</button>') +
            '</div>' +
          '</td>';

        tbody.appendChild(row);
      });

      document.querySelectorAll('.edit').forEach(button => {
        button.addEventListener('click', editSubscription);
      });

      document.querySelectorAll('.delete').forEach(button => {
        button.addEventListener('click', deleteSubscription);
      });

      document.querySelectorAll('.toggle-status').forEach(button => {
        button.addEventListener('click', toggleSubscriptionStatus);
      });

      document.querySelectorAll('.test-notify').forEach(button => {
        button.addEventListener('click', testSubscriptionNotification);
      });

      attachHoverListeners();
    }

    const searchInput = document.getElementById('searchKeyword');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => renderSubscriptionTable(), 200);
      });
    }

    const sortByExpiryBtn = document.getElementById('sortByExpiryBtn');
    if (sortByExpiryBtn) {
      sortByExpiryBtn.addEventListener('click', () => {
        expirySortDirection = expirySortDirection === 'asc' ? 'desc' : 'asc';
        syncExpirySortUi();
        renderSubscriptionTable();
      });
    }
    syncExpirySortUi();

    const categoryTrigger = document.getElementById('categoryFilterTrigger');
    const categoryPanel = document.getElementById('categoryFilterDropdown');
    if (categoryPanel) {
      categoryPanel.addEventListener('click', e => e.stopPropagation());
    }
    if (categoryTrigger) {
      categoryTrigger.addEventListener('click', e => {
        e.stopPropagation();
        toggleCategoryFilterDropdown();
      });
    }
    document.addEventListener('click', () => closeCategoryFilterDropdown());
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        closeCategoryFilterDropdown();
      }
    });

    // 获取所有订阅并按到期时间排序
    async function loadSubscriptions(showLoading = true) {
      try {
        const listShowLunar = document.getElementById('listShowLunar');
        if (listShowLunar) {
          let savedList = localStorage.getItem('listShowLunar');
          if (savedList === null) {
            const legacy = localStorage.getItem('showLunar');
            if (legacy !== null) {
              savedList = legacy;
              localStorage.setItem('listShowLunar', legacy);
            }
          }
          if (savedList !== null) {
            listShowLunar.checked = savedList === 'true';
          } else {
            listShowLunar.checked = true;
          }
        }

        const tbody = document.getElementById('subscriptionsBody');
        if (tbody && showLoading) {
          tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-8 text-center text-sm text-gray-500"><svg xmlns="http://www.w3.org/2000/svg" class="animate-spin mr-2" viewBox="0 0 24 24" width="20" height="20" fill="currentColor" style="opacity:1;"><path fill-rule="evenodd" d="M12 19a7 7 0 1 0 0-14a7 7 0 0 0 0 14m0 3c5.523 0 10-4.477 10-10S17.523 2 12 2S2 6.477 2 12s4.477 10 10 10" clip-rule="evenodd" opacity=".2"/><path d="M2 12C2 6.477 6.477 2 12 2v3a7 7 0 0 0-7 7z"/></svg>加载中...</td></tr>';
        }

        const response = await fetch('/api/subscriptions');
        const data = await response.json();

        subscriptionsCache = Array.isArray(data) ? data : [];
        populateCategoryFilter(subscriptionsCache);
        renderSubscriptionTable();
      } catch (error) {
        const tbody = document.getElementById('subscriptionsBody');
        if (tbody) {
          tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-8 text-center text-sm text-red-600"><span class="inline-flex items-center justify-center gap-2">${iconSvg('exclamationCircle', 'h-4 w-4 shrink-0')}加载失败，请刷新页面重试</span></td></tr>';
        }
        showToast('加载订阅列表失败', 'error');
      }
    }
    
    async function testSubscriptionNotification(e) {
        const button = e.target.tagName === 'BUTTON' ? e.target : e.target.parentElement;
        const id = button.dataset.id;
        const originalContent = button.innerHTML;
        button.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" class="animate-spin mr-2" viewBox="0 0 24 24" width="20" height="20" fill="currentColor" style="opacity:1;"><path fill-rule="evenodd" d="M12 19a7 7 0 1 0 0-14a7 7 0 0 0 0 14m0 3c5.523 0 10-4.477 10-10S17.523 2 12 2S2 6.477 2 12s4.477 10 10 10" clip-rule="evenodd" opacity=".2"/><path d="M2 12C2 6.477 6.477 2 12 2v3a7 7 0 0 0-7 7z"/></svg>';
        button.disabled = true;

        try {
            const response = await fetch('/api/subscriptions/' + id + '/test-notify', { method: 'POST' });
            const result = await response.json();
            if (result.success) {
                showToast(result.message || '测试通知已发送', 'success');
            } else {
                showToast(result.message || '测试通知发送失败', 'error');
            }
        } catch (error) {
            showToast('发送测试通知时发生错误', 'error');
        } finally {
            button.innerHTML = originalContent;
            button.disabled = false;
        }
    }
    
    async function toggleSubscriptionStatus(e) {
      const id = e.target.dataset.id || e.target.parentElement.dataset.id;
      const action = e.target.dataset.action || e.target.parentElement.dataset.action;
      const isActivate = action === 'activate';
      
      const button = e.target.tagName === 'BUTTON' ? e.target : e.target.parentElement;
      const originalContent = button.innerHTML;
      button.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" class="animate-spin mr-2" viewBox="0 0 24 24" width="20" height="20" fill="currentColor" style="opacity:1;"><path fill-rule="evenodd" d="M12 19a7 7 0 1 0 0-14a7 7 0 0 0 0 14m0 3c5.523 0 10-4.477 10-10S17.523 2 12 2S2 6.477 2 12s4.477 10 10 10" clip-rule="evenodd" opacity=".2"/><path d="M2 12C2 6.477 6.477 2 12 2v3a7 7 0 0 0-7 7z"/></svg>' + (isActivate ? '启用中...' : '停用中...');
      button.disabled = true;
      
      try {
        const response = await fetch('/api/subscriptions/' + id + '/toggle-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isActive: isActivate })
        });
        
        if (response.ok) {
          showToast((isActivate ? '启用' : '停用') + '成功', 'success');
          loadSubscriptions();
        } else {
          const error = await response.json();
          showToast((isActivate ? '启用' : '停用') + '失败: ' + (error.message || '未知错误'), 'error');
          button.innerHTML = originalContent;
          button.disabled = false;
        }
      } catch (error) {
        showToast((isActivate ? '启用' : '停用') + '失败，请稍后再试', 'error');
        button.innerHTML = originalContent;
        button.disabled = false;
      }
    }
    
    document.getElementById('addSubscriptionBtn').addEventListener('click', () => {
      document.getElementById('modalTitle').textContent = '添加新订阅';
      document.getElementById('subscriptionModal').classList.remove('hidden');

      document.getElementById('subscriptionForm').reset();
      document.getElementById('subscriptionId').value = '';
      clearFieldErrors();

      const today = new Date().toISOString().split('T')[0]; // 前端使用本地时间
      document.getElementById('startDate').value = today;
      document.getElementById('category').value = '';
      document.getElementById('reminderValue').value = '7';
      document.getElementById('reminderUnit').value = 'day';
      document.getElementById('isActive').checked = true;
      document.getElementById('autoRenew').checked = true;

      loadLunarPreference();
      updateLunarDisplay('startDate', 'startDateLunar');
      updateLunarDisplay('expiryDate', 'expiryDateLunar');
      setupModalEventListeners();
    });

    // 自定义日期选择器功能
    class CustomDatePicker {
      constructor(inputId, pickerId, calendarId, monthId, yearId, prevBtnId, nextBtnId) {
        
        this.input = document.getElementById(inputId);
        this.picker = document.getElementById(pickerId);
        this.calendar = document.getElementById(calendarId);
        this.monthElement = document.getElementById(monthId);
        this.yearElement = document.getElementById(yearId);
        this.prevBtn = document.getElementById(prevBtnId);
        this.nextBtn = document.getElementById(nextBtnId);
        
        // 新增元素
        this.monthPicker = document.getElementById(pickerId.replace('Picker', 'MonthPicker'));
        this.yearPicker = document.getElementById(pickerId.replace('Picker', 'YearPicker'));
        this.backToCalendarBtn = document.getElementById(pickerId.replace('Picker', 'BackToCalendar'));
        this.backToCalendarFromYearBtn = document.getElementById(pickerId.replace('Picker', 'BackToCalendarFromYear'));
        this.goToTodayBtn = document.getElementById(pickerId.replace('Picker', 'GoToToday'));
        this.prevYearDecadeBtn = document.getElementById(pickerId.replace('Picker', 'PrevYearDecade'));
        this.nextYearDecadeBtn = document.getElementById(pickerId.replace('Picker', 'NextYearDecade'));
        this.yearRangeElement = document.getElementById(pickerId.replace('Picker', 'YearRange'));
        this.yearGrid = document.getElementById(pickerId.replace('Picker', 'YearGrid'));
        
        
        this.currentDate = new Date();
        this.selectedDate = null;
        this.currentView = 'calendar'; // 'calendar', 'month', 'year'
        this.yearDecade = Math.floor(this.currentDate.getFullYear() / 10) * 10;
        
        this.init();
      }
      
      init() {
        
        // 绑定基本事件
        if (this.input) {
          // 移除之前的事件监听器（如果存在）
          this.input.removeEventListener('click', this._forceShowHandler);
          this._forceShowHandler = () => this.forceShow();
          this.input.addEventListener('click', this._forceShowHandler);
          if (this._manualInputHandler) {
            this.input.removeEventListener('blur', this._manualInputHandler);
          }
          this._manualInputHandler = () => this.syncFromInputValue();
          this.input.addEventListener('blur', this._manualInputHandler);

          if (this._manualKeydownHandler) {
            this.input.removeEventListener('keydown', this._manualKeydownHandler);
          }
          this._manualKeydownHandler = (event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              this.syncFromInputValue();
            }
          };
          this.input.addEventListener('keydown', this._manualKeydownHandler);
        }
        
        if (this.prevBtn) {
          this.prevBtn.removeEventListener('click', this._prevHandler);
          this._prevHandler = () => this.previousMonth();
          this.prevBtn.addEventListener('click', this._prevHandler);
        }
        
        if (this.nextBtn) {
          this.nextBtn.removeEventListener('click', this._nextHandler);
          this._nextHandler = () => this.nextMonth();
          this.nextBtn.addEventListener('click', this._nextHandler);
        }
        
        // 绑定月份和年份点击事件
        if (this.monthElement) {
          this.monthElement.removeEventListener('click', this._showMonthHandler);
          this._showMonthHandler = () => this.showMonthPicker();
          this.monthElement.addEventListener('click', this._showMonthHandler);
        }
        
        if (this.yearElement) {
          this.yearElement.removeEventListener('click', this._showYearHandler);
          this._showYearHandler = () => this.showYearPicker();
          this.yearElement.addEventListener('click', this._showYearHandler);
        }
        
        // 绑定月份选择器事件
        if (this.monthPicker) {
          this.monthPicker.removeEventListener('click', this._monthSelectHandler);
          this._monthSelectHandler = (e) => {
            if (e.target.matches('button[data-month]')) {
              const month = parseInt(e.target.dataset.month);
              this.selectMonth(month);
            }
          };
          this.monthPicker.addEventListener('click', this._monthSelectHandler);
        }
        
        if (this.backToCalendarBtn) {
          this.backToCalendarBtn.removeEventListener('click', this._backToCalendarHandler);
          this._backToCalendarHandler = () => this.showCalendar();
          this.backToCalendarBtn.addEventListener('click', this._backToCalendarHandler);
        }
        
        if (this.backToCalendarFromYearBtn) {
          this.backToCalendarFromYearBtn.removeEventListener('click', this._backToCalendarFromYearHandler);
          this._backToCalendarFromYearHandler = () => this.showCalendar();
          this.backToCalendarFromYearBtn.addEventListener('click', this._backToCalendarFromYearHandler);
        }
        
        // 绑定年份选择器事件
        if (this.prevYearDecadeBtn) {
        this.prevYearDecadeBtn.removeEventListener('click', this._prevYearDecadeHandler);
        this._prevYearDecadeHandler = (e) => {
            e.stopPropagation(); // 防止事件冒泡到表单
            this.previousYearDecade();
        };
        this.prevYearDecadeBtn.addEventListener('click', this._prevYearDecadeHandler);
        }

        if (this.nextYearDecadeBtn) {
        this.nextYearDecadeBtn.removeEventListener('click', this._nextYearDecadeHandler);
        this._nextYearDecadeHandler = (e) => {
            e.stopPropagation(); // 防止事件冒泡到表单
            this.nextYearDecade();
        };
        this.nextYearDecadeBtn.addEventListener('click', this._nextYearDecadeHandler);
}
        
        // 绑定回到今天事件
        if (this.goToTodayBtn) {
          this.goToTodayBtn.removeEventListener('click', this._goToTodayHandler);
          this._goToTodayHandler = () => this.goToToday();
          this.goToTodayBtn.addEventListener('click', this._goToTodayHandler);
        }
        
        // 点击外部关闭
        if (this._outsideClickHandler) {
          document.removeEventListener('click', this._outsideClickHandler);
        }
        this._outsideClickHandler = (e) => {
          if (this.picker && !this.picker.contains(e.target) && !this.input.contains(e.target)) {
            this.hide();
          }
        };
        document.addEventListener('click', this._outsideClickHandler);
        
        // 初始化显示
        this.syncFromInputValue();
        this.render();
        this.renderYearGrid();
      }
      
      toggle() {
        
        if (this.picker && this.picker.classList.contains('hidden')) {
          this.show();
        } else {
          this.hide();
        }
      }
      
      // 强制显示日期选择器
      forceShow() {
        if (this.picker) {
          // 确保选择器显示
          this.picker.classList.remove('hidden');
          // 重置到日历视图
          this.currentView = 'calendar';
          this.hideAllViews();
          this.render();
        } else {
        }
      }
      
      show() {
        if (this.picker) {
          this.picker.classList.remove('hidden');
          this.render();
        }
      }
      
      hide() {
        if (this.picker) {
          this.picker.classList.add('hidden');
        }
      }
      
      previousMonth() {
        this.currentDate.setMonth(this.currentDate.getMonth() - 1);
        this.render();
      }
      
      nextMonth() {
        this.currentDate.setMonth(this.currentDate.getMonth() + 1);
        this.render();
      }
      
      selectDate(date) {
        this.selectedDate = date;
        if (this.input) {
          // 使用本地时间格式化，避免时区问题
          const year = date.getFullYear();
          const month = String(date.getMonth() + 1).padStart(2, '0');
          const day = String(date.getDate()).padStart(2, '0');
          this.input.value = year + '-' + month + '-' + day;
        }
        this.hide();
        
        // 触发change事件，但不冒泡到表单
        if (this.input) {
          const event = new Event('change', { bubbles: false });
          this.input.dispatchEvent(event);
        }
      }

      syncFromInputValue() {
        if (!this.input) {
          return;
        }
        const value = this.input.value.trim();
        if (!value) {
          this.selectedDate = null;
          return;
        }

        const match = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
        if (!match) {
          if (typeof showToast === 'function') {
            showToast('日期格式需为 YYYY-MM-DD', 'warning');
          }
          return;
        }

        const year = Number(match[1]);
        const month = Number(match[2]);
        const day = Number(match[3]);
        const parsed = new Date(year, month - 1, day);
        if (isNaN(parsed.getTime()) || parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) {
          if (typeof showToast === 'function') {
            showToast('请输入有效的日期', 'warning');
          }
          return;
        }

        this.selectedDate = parsed;
        this.currentDate = new Date(parsed);
        this.render();

        const event = new Event('change', { bubbles: false });
        this.input.dispatchEvent(event);
      }
      
      render() {
        if (!this.monthElement || !this.yearElement || !this.calendar) return;
        
        const year = this.currentDate.getFullYear();
        const month = this.currentDate.getMonth();
        
        // 更新月份年份显示
        this.monthElement.textContent = (month + 1) + '月';
        this.yearElement.textContent = year;
        
        // 清空日历
        this.calendar.innerHTML = '';
        
        // 获取当月第一天和最后一天
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const startDate = new Date(firstDay);
        startDate.setDate(startDate.getDate() - firstDay.getDay());
        
        // 生成日历网格
        for (let i = 0; i < 42; i++) {
          const date = new Date(startDate);
          date.setDate(startDate.getDate() + i);
          
          const dayElement = document.createElement('div');

          const isOtherMonth = date.getMonth() !== month;
          const today = new Date();
          const isToday = date.toDateString() === today.toDateString();
          const isSelected =
            this.selectedDate && date.toDateString() === this.selectedDate.toDateString();

          let cellClass = '${dayCellBase}';
          if (isOtherMonth) {
            cellClass += ' text-gray-300';
          }
          if (isSelected) {
            cellClass =
              '${dayCellBase} scale-105 bg-indigo-600 text-white shadow-md ring-1 ring-indigo-500/40';
          } else if (isToday) {
            cellClass +=
              ' border-2 border-indigo-600 bg-indigo-50 font-semibold text-indigo-800';
          }
          dayElement.className = cellClass;

          const showLunarForm = document.getElementById('showLunar');
          const calendarShowLunar = showLunarForm && showLunarForm.checked;

          let lunarText = '';
          if (calendarShowLunar) {
            try {
              const lunar = lunarCalendar.solar2lunar(date.getFullYear(), date.getMonth() + 1, date.getDate());
              if (lunar) {
                if (lunar.day === 1) {
                  lunarText = lunar.isLeap ? '闰' + lunar.monthStr.replace('闰', '') : lunar.monthStr;
                } else {
                  lunarText = lunar.dayStr;
                }
              }
            } catch (error) {
            }
          }

          let lunarLineClass = 'text-center text-[9px] leading-none ';
          if (isSelected) {
            lunarLineClass += 'text-white/90';
          } else if (isToday) {
            lunarLineClass += 'text-indigo-700';
          } else {
            lunarLineClass += 'text-gray-500';
          }

          const lunarRowHtml = calendarShowLunar
            ? '<div class="' + lunarLineClass + '">' + lunarText + '</div>'
            : '';

          dayElement.innerHTML = '<div>' + date.getDate() + '</div>' + lunarRowHtml;

          dayElement.addEventListener('click', () => this.selectDate(date));

          this.calendar.appendChild(dayElement);
        }
      }
      
      // 显示月份选择器
      showMonthPicker() {
        this.currentView = 'month';
        this.hideAllViews();
        if (this.monthPicker) {
          this.monthPicker.classList.remove('hidden');
          // 高亮当前月份
          const monthOptions = this.monthPicker.querySelectorAll('button[data-month]');
          monthOptions.forEach((option, index) => {
            option.className = '${monthBtnBase}';
            if (index === this.currentDate.getMonth()) {
              option.className = '${monthBtnBase} ${monthBtnOn}';
            }
          });
        }
      }
      
      // 显示年份选择器
      showYearPicker() {
        this.currentView = 'year';
        this.hideAllViews();
        if (this.yearPicker) {
          this.yearPicker.classList.remove('hidden');
        }
        this.renderYearGrid();
      }
      
      // 显示日历视图
      showCalendar() {
        this.currentView = 'calendar';
        this.hideAllViews();
        this.render();
      }
      
      // 隐藏所有视图
      hideAllViews() {
        if (this.monthPicker) this.monthPicker.classList.add('hidden');
        if (this.yearPicker) this.yearPicker.classList.add('hidden');
        // 注意：不隐藏日历视图，因为它是主视图
      }
      
      // 选择月份
      selectMonth(month) {
        this.currentDate.setMonth(month);
        this.showCalendar();
      }
      
      // 选择年份
      selectYear(year) {
        this.currentDate.setFullYear(year);
        this.showCalendar();
      }
      
      // 上一十年
      previousYearDecade() {
        this.yearDecade -= 10;
        this.renderYearGrid();
      }
      
      // 下一十年
      nextYearDecade() {
        this.yearDecade += 10;
        this.renderYearGrid();
      }
      
      // 渲染年份网格
      renderYearGrid() {
        if (!this.yearGrid || !this.yearRangeElement) return;
        
        const startYear = this.yearDecade;
        const endYear = this.yearDecade + 9;
        
        // 更新年份范围显示
        this.yearRangeElement.textContent = startYear + '-' + endYear;
        
        // 清空年份网格
        this.yearGrid.innerHTML = '';
        
        // 生成年份按钮
        for (let year = startYear; year <= endYear; year++) {
          const yearBtn = document.createElement('button');
          yearBtn.type = 'button';
          yearBtn.className = '${yearBtnBase}';
          yearBtn.textContent = year;
          yearBtn.dataset.year = year;
          
          // 高亮当前年份
          if (year === this.currentDate.getFullYear()) {
            yearBtn.classList.add('bg-indigo-50', 'font-medium', 'text-indigo-800', 'ring-1', 'ring-indigo-200');
          }
          
          // 限制年份范围 1900-2100
          if (year < 1900 || year > 2100) {
            yearBtn.disabled = true;
            yearBtn.classList.add('opacity-50', 'cursor-not-allowed');
          } else {
            yearBtn.addEventListener('click', () => this.selectYear(year));
          }
          
          this.yearGrid.appendChild(yearBtn);
        }
      }
      
      // 回到今天
      goToToday() {
        this.currentDate = new Date();
        this.yearDecade = Math.floor(this.currentDate.getFullYear() / 10) * 10;
        this.showCalendar();
      }
      
      destroy() {
        this.hide();
        
        // 清理事件监听器
        if (this.input && this._forceShowHandler) {
          this.input.removeEventListener('click', this._forceShowHandler);
        }
        if (this.input && this._manualInputHandler) {
          this.input.removeEventListener('blur', this._manualInputHandler);
        }
        if (this.input && this._manualKeydownHandler) {
          this.input.removeEventListener('keydown', this._manualKeydownHandler);
        }
        if (this.prevBtn && this._prevHandler) {
          this.prevBtn.removeEventListener('click', this._prevHandler);
        }
        if (this.nextBtn && this._nextHandler) {
          this.nextBtn.removeEventListener('click', this._nextHandler);
        }
        if (this.monthElement && this._showMonthHandler) {
          this.monthElement.removeEventListener('click', this._showMonthHandler);
        }
        if (this.yearElement && this._showYearHandler) {
          this.yearElement.removeEventListener('click', this._showYearHandler);
        }
        if (this.monthPicker && this._monthSelectHandler) {
          this.monthPicker.removeEventListener('click', this._monthSelectHandler);
        }
        if (this.backToCalendarBtn && this._backToCalendarHandler) {
          this.backToCalendarBtn.removeEventListener('click', this._backToCalendarHandler);
        }
        if (this.backToCalendarFromYearBtn && this._backToCalendarFromYearHandler) {
          this.backToCalendarFromYearBtn.removeEventListener('click', this._backToCalendarFromYearHandler);
        }
        if (this.prevYearDecadeBtn && this._prevYearDecadeHandler) {
          this.prevYearDecadeBtn.removeEventListener('click', this._prevYearDecadeHandler);
        }
        if (this.nextYearDecadeBtn && this._nextYearDecadeHandler) {
          this.nextYearDecadeBtn.removeEventListener('click', this._nextYearDecadeHandler);
        }
        if (this.goToTodayBtn && this._goToTodayHandler) {
          this.goToTodayBtn.removeEventListener('click', this._goToTodayHandler);
        }
        if (this._outsideClickHandler) {
          document.removeEventListener('click', this._outsideClickHandler);
        }
      }
    }

    function closeModalSelectDropdown(selectId) {
      const panel = document.getElementById(selectId + 'Dropdown');
      const trigger = document.getElementById(selectId + 'Trigger');
      const chevron = document.getElementById(selectId + 'Chevron');
      if (panel) {
        panel.classList.add('hidden');
      }
      if (trigger) {
        trigger.setAttribute('aria-expanded', 'false');
      }
      if (chevron) {
        chevron.classList.remove('rotate-180');
      }
    }

    function closeAllModalSelectDropdowns(exceptSelectId) {
      ['periodUnit', 'reminderUnit'].forEach((selectId) => {
        if (selectId !== exceptSelectId) {
          closeModalSelectDropdown(selectId);
        }
      });
    }

    function syncModalSelectDropdown(selectId) {
      const select = document.getElementById(selectId);
      const display = document.getElementById(selectId + 'Display');
      const panel = document.getElementById(selectId + 'Dropdown');
      if (!select || !display || !panel) {
        return;
      }

      const selectedOption = select.options[select.selectedIndex] || select.options[0];
      if (!selectedOption) {
        return;
      }
      display.textContent = selectedOption.textContent;

      panel.querySelectorAll('.modal-select-option').forEach((btn) => {
        const selected = btn.getAttribute('data-value') === select.value;
        btn.setAttribute('aria-selected', selected ? 'true' : 'false');
        btn.className =
          'modal-select-option flex w-full min-w-0 max-w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left text-sm ' +
          (selected ? 'bg-gray-100 text-gray-900' : 'text-gray-900 hover:bg-gray-50');
        const check = btn.querySelector('[data-modal-select-check]');
        if (check) {
          check.classList.toggle('invisible', !selected);
        }
      });
    }

    function setupModalSelectDropdown(selectId) {
      const select = document.getElementById(selectId);
      const trigger = document.getElementById(selectId + 'Trigger');
      const panel = document.getElementById(selectId + 'Dropdown');
      const chevron = document.getElementById(selectId + 'Chevron');
      if (!select || !trigger || !panel) {
        return;
      }

      if (select.dataset.modalSelectInitialized !== 'true') {
        const checkSvg =
          '<svg class="h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clip-rule="evenodd"/></svg>';

        panel.textContent = '';
        Array.from(select.options).forEach((option) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.setAttribute('role', 'option');
          btn.setAttribute('data-value', option.value);
          btn.className = 'modal-select-option flex w-full min-w-0 max-w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left text-sm text-gray-900 hover:bg-gray-50';
          const label = document.createElement('span');
          label.className = 'min-w-0 truncate';
          label.textContent = option.textContent;
          const check = document.createElement('span');
          check.setAttribute('data-modal-select-check', '1');
          check.className = 'invisible shrink-0 text-gray-900';
          check.innerHTML = checkSvg;
          btn.appendChild(label);
          btn.appendChild(check);
          btn.addEventListener('click', () => {
            select.value = option.value;
            select.dispatchEvent(new Event('change', { bubbles: true }));
            closeModalSelectDropdown(selectId);
          });
          panel.appendChild(btn);
        });

        trigger.addEventListener('click', (event) => {
          event.stopPropagation();
          closeCategoryFilterDropdown();
          closeAllModalSelectDropdowns(selectId);
          const willOpen = panel.classList.contains('hidden');
          panel.classList.toggle('hidden', !willOpen);
          trigger.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
          if (chevron) {
            chevron.classList.toggle('rotate-180', willOpen);
          }
        });

        select.addEventListener('change', () => syncModalSelectDropdown(selectId));
        select.dataset.modalSelectInitialized = 'true';
      }

      if (!window.modalSelectDropdownOutsideClickBound) {
        document.addEventListener('click', (event) => {
          if (!event.target.closest('[data-modal-select-root]')) {
            closeAllModalSelectDropdowns();
          }
        });
        window.modalSelectDropdownOutsideClickBound = true;
      }

      syncModalSelectDropdown(selectId);
      closeModalSelectDropdown(selectId);
    }

    function setupNumberSteppers() {
      document.querySelectorAll('[data-number-stepper]').forEach((button) => {
        if (button.dataset.numberStepperInitialized === 'true') {
          return;
        }
        button.addEventListener('click', () => {
          const input = document.getElementById(button.dataset.numberStepper);
          if (!input) {
            return;
          }

          const direction = Number(button.dataset.step) || 0;
          const step = input.step && input.step !== 'any' ? Number(input.step) || 1 : 1;
          const min = input.min !== '' ? Number(input.min) : -Infinity;
          const max = input.max !== '' ? Number(input.max) : Infinity;
          const current = input.value === '' || isNaN(Number(input.value))
            ? (Number.isFinite(min) ? min : 0)
            : Number(input.value);
          const next = Math.min(max, Math.max(min, current + direction * step));

          input.value = Number.isInteger(next) ? String(next) : String(Number(next.toFixed(6)));
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        });
        button.dataset.numberStepperInitialized = 'true';
      });
    }
    
    function setupModalEventListeners() {
      // 获取DOM元素
      const calculateExpiryBtn = document.getElementById('calculateExpiryBtn');
      const useLunar = document.getElementById('useLunar');
      const showLunar = document.getElementById('showLunar');
      const startDate = document.getElementById('startDate');
      const expiryDate = document.getElementById('expiryDate');
      const cancelBtn = document.getElementById('cancelBtn');
      
      // 直接绑定事件监听器（简化处理，避免重复移除的问题）
      if (calculateExpiryBtn) {
        calculateExpiryBtn.addEventListener('click', calculateExpiryDate);
      }
      if (useLunar) {
        useLunar.addEventListener('change', () => {
          updateLunarDisplay('startDate', 'startDateLunar');
          updateLunarDisplay('expiryDate', 'expiryDateLunar');
        });
      }
      if (showLunar && showLunar.dataset.lunarFormBound !== 'true') {
        showLunar.addEventListener('change', toggleLunarDisplay);
        showLunar.dataset.lunarFormBound = 'true';
      }
      if (startDate) {
        startDate.addEventListener('change', () => updateLunarDisplay('startDate', 'startDateLunar'));
      }
      if (expiryDate) {
        expiryDate.addEventListener('change', () => updateLunarDisplay('expiryDate', 'expiryDateLunar'));
      }
      if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
          document.getElementById('subscriptionModal').classList.add('hidden');
        });
      }

      setupModalSelectDropdown('periodUnit');
      setupModalSelectDropdown('reminderUnit');
      setupNumberSteppers();

      // 初始化自定义日期选择器
      try {
        // 安全地清理之前的实例
        if (window.startDatePicker && typeof window.startDatePicker.destroy === 'function') {
          window.startDatePicker.destroy();
        }
        if (window.expiryDatePicker && typeof window.expiryDatePicker.destroy === 'function') {
          window.expiryDatePicker.destroy();
        }
        
        // 清理全局变量
        window.startDatePicker = null;
        window.expiryDatePicker = null;
        
        // 确保DOM元素存在后再创建选择器
        setTimeout(() => {
          window.startDatePicker = new CustomDatePicker(
            'startDate', 'startDatePicker', 'startDateCalendar', 
            'startDateMonth', 'startDateYear', 'startDatePrevMonth', 'startDateNextMonth'
          );
          
          window.expiryDatePicker = new CustomDatePicker(
            'expiryDate', 'expiryDatePicker', 'expiryDateCalendar', 
            'expiryDateMonth', 'expiryDateYear', 'expiryDatePrevMonth', 'expiryDateNextMonth'
          );
          
        }, 50);
      } catch (error) {
        // 确保清理失败的实例
        window.startDatePicker = null;
        window.expiryDatePicker = null;
      }
    }

	// 3. 新增修改， calculateExpiryDate 函数，支持农历周期推算     
	function calculateExpiryDate() {
	  const startDate = document.getElementById('startDate').value;
	  const periodValue = parseInt(document.getElementById('periodValue').value);
	  const periodUnit = document.getElementById('periodUnit').value;
	  const useLunar = document.getElementById('useLunar').checked;

	  if (!startDate || !periodValue || !periodUnit) {
		return;
	  }

	  if (useLunar) {
		// 农历推算
		const start = new Date(startDate);
		const lunar = lunarCalendar.solar2lunar(start.getFullYear(), start.getMonth() + 1, start.getDate());
		let nextLunar = addLunarPeriod(lunar, periodValue, periodUnit);
		const solar = lunar2solar(nextLunar);
		
		// 使用与公历相同的方式创建日期  
		const expiry = new Date(startDate); // 从原始日期开始  
		expiry.setFullYear(solar.year);  
		expiry.setMonth(solar.month - 1);  
		expiry.setDate(solar.day);  
		document.getElementById('expiryDate').value = expiry.toISOString().split('T')[0];
		
		  
		  
		
		
	  } else {
		// 公历推算
		const start = new Date(startDate);
		const expiry = new Date(start);
		if (periodUnit === 'day') {
		  expiry.setDate(start.getDate() + periodValue);
		} else if (periodUnit === 'month') {
		  expiry.setMonth(start.getMonth() + periodValue);
		} else if (periodUnit === 'year') {
		  expiry.setFullYear(start.getFullYear() + periodValue);
		}
		document.getElementById('expiryDate').value = expiry.toISOString().split('T')[0];
	  }

	  // 更新农历显示
	  updateLunarDisplay('startDate', 'startDateLunar');
	  updateLunarDisplay('expiryDate', 'expiryDateLunar');
	}
    
    document.getElementById('closeModal').addEventListener('click', () => {
      document.getElementById('subscriptionModal').classList.add('hidden');
    });
    
    // 禁止点击弹窗外区域关闭弹窗，防止误操作丢失内容
    // document.getElementById('subscriptionModal').addEventListener('click', (event) => {
    //   if (event.target === document.getElementById('subscriptionModal')) {
    //     document.getElementById('subscriptionModal').classList.add('hidden');
    //   }
    // });
    
	
	// 4. 新增修改，监听 useLunar 复选框变化时也自动重新计算
	// 注意：这个事件监听器已经在 setupModalEventListeners 中处理了   
   // 新增修改，表单提交时带上 useLunar 字段
    document.getElementById('subscriptionForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      
      if (!validateForm()) {
        return;
      }
      
      const id = document.getElementById('subscriptionId').value;
      const reminderUnit = document.getElementById('reminderUnit').value;
      const reminderValue = Number(document.getElementById('reminderValue').value) || 0;

      const subscription = {
        name: document.getElementById('name').value.trim(),
        customType: document.getElementById('customType').value.trim(),
        category: document.getElementById('category').value.trim(),
        notes: document.getElementById('notes').value.trim() || '',
        isActive: document.getElementById('isActive').checked,
        autoRenew: document.getElementById('autoRenew').checked,
        startDate: document.getElementById('startDate').value,
        expiryDate: document.getElementById('expiryDate').value,
        periodValue: Number(document.getElementById('periodValue').value),
        periodUnit: document.getElementById('periodUnit').value,
        reminderUnit: reminderUnit,
        reminderValue: reminderValue,
        reminderDays: reminderUnit === 'day' ? reminderValue : 0,
        reminderHours: reminderUnit === 'hour' ? reminderValue : undefined,
        useLunar: document.getElementById('useLunar').checked
      };
      
      const submitButton = e.target.querySelector('button[type="submit"]');
      const originalContent = submitButton.innerHTML;
      submitButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" class="animate-spin mr-2" viewBox="0 0 24 24" width="20" height="20" fill="currentColor" style="opacity:1;"><path fill-rule="evenodd" d="M12 19a7 7 0 1 0 0-14a7 7 0 0 0 0 14m0 3c5.523 0 10-4.477 10-10S17.523 2 12 2S2 6.477 2 12s4.477 10 10 10" clip-rule="evenodd" opacity=".2"/><path d="M2 12C2 6.477 6.477 2 12 2v3a7 7 0 0 0-7 7z"/></svg>' + (id ? '更新中...' : '保存中...');
      submitButton.disabled = true;
      
      try {
        const url = id ? '/api/subscriptions/' + id : '/api/subscriptions';
        const method = id ? 'PUT' : 'POST';
        
        const response = await fetch(url, {
          method: method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(subscription)
        });
        
        const result = await response.json();
        
        if (result.success) {
          showToast((id ? '更新' : '添加') + '订阅成功', 'success');
          document.getElementById('subscriptionModal').classList.add('hidden');
          loadSubscriptions();
        } else {
          showToast((id ? '更新' : '添加') + '订阅失败: ' + (result.message || '未知错误'), 'error');
        }
      } catch (error) {
        showToast((id ? '更新' : '添加') + '订阅失败，请稍后再试', 'error');
      } finally {
        submitButton.innerHTML = originalContent;
        submitButton.disabled = false;
      }
    });
    
	    // 新增修改，编辑订阅时回显 useLunar 字段
    async function editSubscription(e) {
      const id = e.target.dataset.id || e.target.parentElement.dataset.id;
      
      try {
        const response = await fetch('/api/subscriptions/' + id);
        const subscription = await response.json();
        
        if (subscription) {
          document.getElementById('modalTitle').textContent = '编辑订阅';
          document.getElementById('subscriptionId').value = subscription.id;
          document.getElementById('name').value = subscription.name;
          document.getElementById('customType').value = subscription.customType || '';
          document.getElementById('category').value = subscription.category || '';
          document.getElementById('notes').value = subscription.notes || '';
          document.getElementById('isActive').checked = subscription.isActive !== false;
          document.getElementById('autoRenew').checked = subscription.autoRenew !== false;
          document.getElementById('startDate').value = subscription.startDate ? subscription.startDate.split('T')[0] : '';
          document.getElementById('expiryDate').value = subscription.expiryDate ? subscription.expiryDate.split('T')[0] : '';
          document.getElementById('periodValue').value = subscription.periodValue || 1;
          document.getElementById('periodUnit').value = subscription.periodUnit || 'month';
          const reminderUnit = subscription.reminderUnit || (subscription.reminderHours !== undefined ? 'hour' : 'day');
          let reminderValue;
          if (reminderUnit === 'hour') {
            if (subscription.reminderValue !== undefined && subscription.reminderValue !== null) {
              reminderValue = subscription.reminderValue;
            } else if (subscription.reminderHours !== undefined) {
              reminderValue = subscription.reminderHours;
            } else {
              reminderValue = 0;
            }
          } else {
            if (subscription.reminderValue !== undefined && subscription.reminderValue !== null) {
              reminderValue = subscription.reminderValue;
            } else if (subscription.reminderDays !== undefined) {
              reminderValue = subscription.reminderDays;
            } else {
              reminderValue = 7;
            }
          }
          document.getElementById('reminderUnit').value = reminderUnit;
          document.getElementById('reminderValue').value = reminderValue;
          document.getElementById('useLunar').checked = !!subscription.useLunar;
          
          clearFieldErrors();
          loadLunarPreference();
          document.getElementById('subscriptionModal').classList.remove('hidden');
          
          // 重要：编辑订阅时也需要重新设置事件监听器
          setupModalEventListeners();

          // 更新农历显示
          setTimeout(() => {
            updateLunarDisplay('startDate', 'startDateLunar');
            updateLunarDisplay('expiryDate', 'expiryDateLunar');
          }, 100);
        }
      } catch (error) {
        showToast('获取订阅信息失败', 'error');
      }
    }
    
    async function deleteSubscription(e) {
      const id = e.target.dataset.id || e.target.parentElement.dataset.id;
      
      if (!confirm('确定要删除这个订阅吗？此操作不可恢复。')) {
        return;
      }
      
      const button = e.target.tagName === 'BUTTON' ? e.target : e.target.parentElement;
      const originalContent = button.innerHTML;
      button.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" class="animate-spin mr-2" viewBox="0 0 24 24" width="20" height="20" fill="currentColor" style="opacity:1;"><path fill-rule="evenodd" d="M12 19a7 7 0 1 0 0-14a7 7 0 0 0 0 14m0 3c5.523 0 10-4.477 10-10S17.523 2 12 2S2 6.477 2 12s4.477 10 10 10" clip-rule="evenodd" opacity=".2"/><path d="M2 12C2 6.477 6.477 2 12 2v3a7 7 0 0 0-7 7z"/></svg>删除中...';
      button.disabled = true;
      
      try {
        const response = await fetch('/api/subscriptions/' + id, {
          method: 'DELETE'
        });
        
        if (response.ok) {
          showToast('删除成功', 'success');
          loadSubscriptions();
        } else {
          const error = await response.json();
          showToast('删除失败: ' + (error.message || '未知错误'), 'error');
          button.innerHTML = originalContent;
          button.disabled = false;
        }
      } catch (error) {
        showToast('删除失败，请稍后再试', 'error');
        button.innerHTML = originalContent;
        button.disabled = false;
      }
    }
    
    // 全局时区配置
    let globalTimezone = 'UTC';
    
    // 检测时区更新
    function checkTimezoneUpdate() {
      const lastUpdate = localStorage.getItem('timezoneUpdated');
      if (lastUpdate) {
        const updateTime = parseInt(lastUpdate);
        const currentTime = Date.now();
        // 如果时区更新发生在最近5秒内，则刷新页面
        if (currentTime - updateTime < 5000) {
          localStorage.removeItem('timezoneUpdated');
          window.location.reload();
        }
      }
    }
    
    // 页面加载时检查时区更新
    window.addEventListener('load', () => {
      checkTimezoneUpdate();
      const listLunarCb = document.getElementById('listShowLunar');
      if (listLunarCb && listLunarCb.dataset.listLunarBound !== 'true') {
        listLunarCb.addEventListener('change', handleListLunarToggle);
        listLunarCb.dataset.listLunarBound = 'true';
      }
      loadSubscriptions();
    });
    
    // 定期检查时区更新（每2秒检查一次）
    setInterval(checkTimezoneUpdate, 2000);

    // 实时显示系统时间和时区
    async function showSystemTime() {
      try {
        // 获取后台配置的时区
        const response = await fetch('/api/config');
        const config = await response.json();
        globalTimezone = config.TIMEZONE || 'UTC';
        
        // 格式化当前时间
        function formatTime(dt, tz) {
          const dtf = new Intl.DateTimeFormat('en-CA', {
            timeZone: tz,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
          });
          const parts = dtf.formatToParts(dt);
          const v = (t) => (parts.find((x) => x.type === t) || {}).value || '';
          return v('year') + '-' + v('month') + '-' + v('day') + ' ' + v('hour') + ':' + v('minute') + ':' + v('second');
        }
        function formatTimezoneDisplay(tz) {
          try {
            // 使用更准确的时区偏移计算方法
            const now = new Date();
            const dtf = new Intl.DateTimeFormat('en-US', {
              timeZone: tz,
              hour12: false,
              year: 'numeric', month: '2-digit', day: '2-digit',
              hour: '2-digit', minute: '2-digit', second: '2-digit'
            });
            const parts = dtf.formatToParts(now);
            const get = type => Number(parts.find(x => x.type === type).value);
            const target = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
            const utc = now.getTime();
            const offset = Math.round((target - utc) / (1000 * 60 * 60));
            
            // 时区中文名称映射
            const timezoneNames = {
              'UTC': '世界标准时间',
              'Asia/Shanghai': '中国标准时间',
              'Asia/Hong_Kong': '香港时间',
              'Asia/Taipei': '台北时间',
              'Asia/Singapore': '新加坡时间',
              'Asia/Tokyo': '日本时间',
              'Asia/Seoul': '韩国时间',
              'America/New_York': '美国东部时间',
              'America/Los_Angeles': '美国太平洋时间',
              'America/Chicago': '美国中部时间',
              'America/Denver': '美国山地时间',
              'Europe/London': '英国时间',
              'Europe/Paris': '巴黎时间',
              'Europe/Berlin': '柏林时间',
              'Europe/Moscow': '莫斯科时间',
              'Australia/Sydney': '悉尼时间',
              'Australia/Melbourne': '墨尔本时间',
              'Pacific/Auckland': '奥克兰时间'
            };
            
            const offsetStr = offset >= 0 ? '+' + offset : offset;
            const timezoneName = timezoneNames[tz] || tz;
            return timezoneName + ' (UTC' + offsetStr + ')';
          } catch (error) {
            return tz;
          }
        }
        function update() {
          const now = new Date();
          const timeStr = formatTime(now, globalTimezone);
          const tzStr = formatTimezoneDisplay(globalTimezone);
          const el = document.getElementById('systemTimeDisplay');
          if (el) {
            el.textContent = timeStr + '  ' + tzStr;
          }
        }
        update();
        // 每秒刷新
        setInterval(update, 1000);
        
        // 定期检查时区变化并重新加载订阅列表（每30秒检查一次）
        setInterval(async () => {
          try {
            const response = await fetch('/api/config');
            const config = await response.json();
            const newTimezone = config.TIMEZONE || 'UTC';
            
            if (globalTimezone !== newTimezone) {
              globalTimezone = newTimezone;
              // 重新加载订阅列表以更新天数计算
              loadSubscriptions();
            }
          } catch (error) {
          }
        }, 30000);
        
        // 初始加载订阅列表
        loadSubscriptions();
      } catch (e) {
        // 出错时显示本地时间
        const el = document.getElementById('systemTimeDisplay');
        if (el) {
          el.textContent = new Date().toLocaleString();
        }
      }
    }
    showSystemTime();
  </script>
</body>
</html>
`;

const configPage = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>系统配置 - SubTrack</title>
  <link rel="icon" href="${APP_FAVICON_DATA_URL}" type="image/svg+xml">
  <style>${EMBEDDED_TAILWIND_CSS}</style>
</head>
<body class="bg-gray-50 min-h-screen">
  <div id="toast-container"></div>

  <nav class="fixed top-0 left-0 right-0 z-50 border-b border-gray-200/80 bg-white/95 shadow-sm backdrop-blur-sm">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="flex justify-between h-16">
        <div class="flex items-center">
          ${appLogoMarkup('shrink-0 mr-2')}
          <span class="font-bold text-xl text-gray-800">SubTrack</span>
          <span id="systemTimeDisplay" class="ml-4 text-sm text-slate-600 font-normal mt-2"></span>
        </div>
        <div class="flex items-center space-x-4">
          <a href="/admin" class="text-gray-700 hover:text-gray-900 px-3 py-2  hover:bg-slate-100 rounded-md text-sm font-medium flex items-center gap-1">
            <svg width="18" height="18" viewBox="0 0 48 48" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="6" width="40" height="36" rx="3" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 14H44"  stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 24H36"  stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 32H36"  stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 24H14"  stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 32H14"  stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg> 订阅列表
          </a>
          <a href="/admin/config" class="text-indigo-600 border-indigo-600 bg-indigo-100 px-3 py-2  rounded-md text-sm font-medium flex items-center gap-1">
            <svg width="18" height="18" viewBox="0 0 48 48" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M18.2838 43.1713C14.9327 42.1736 11.9498 40.3213 9.58787 37.867C10.469 36.8227 11 35.4734 11 34.0001C11 30.6864 8.31371 28.0001 5 28.0001C4.79955 28.0001 4.60139 28.01 4.40599 28.0292C4.13979 26.7277 4 25.3803 4 24.0001C4 21.9095 4.32077 19.8938 4.91579 17.9995C4.94381 17.9999 4.97188 18.0001 5 18.0001C8.31371 18.0001 11 15.3138 11 12.0001C11 11.0488 10.7786 10.1493 10.3846 9.35011C12.6975 7.1995 15.5205 5.59002 18.6521 4.72314C19.6444 6.66819 21.6667 8.00013 24 8.00013C26.3333 8.00013 28.3556 6.66819 29.3479 4.72314C32.4795 5.59002 35.3025 7.1995 37.6154 9.35011C37.2214 10.1493 37 11.0488 37 12.0001C37 15.3138 39.6863 18.0001 43 18.0001C43.0281 18.0001 43.0562 17.9999 43.0842 17.9995C43.6792 19.8938 44 21.9095 44 24.0001C44 25.3803 43.8602 26.7277 43.594 28.0292C43.3986 28.01 43.2005 28.0001 43 28.0001C39.6863 28.0001 37 30.6864 37 34.0001C37 35.4734 37.531 36.8227 38.4121 37.867C36.0502 40.3213 33.0673 42.1736 29.7162 43.1713C28.9428 40.752 26.676 39.0001 24 39.0001C21.324 39.0001 19.0572 40.752 18.2838 43.1713Z" fill="none"  stroke-width="4" stroke-linejoin="round"/><path d="M24 31C27.866 31 31 27.866 31 24C31 20.134 27.866 17 24 17C20.134 17 17 20.134 17 24C17 27.866 20.134 31 24 31Z" fill="none"  stroke-width="4" stroke-linejoin="round"/></svg> 系统配置
          </a>
          <a href="/api/logout" class="text-gray-700 hover:text-gray-900 px-3 py-2 hover:bg-slate-100 rounded-md text-sm font-medium flex items-center gap-1">
            <svg width="18" height="18" viewBox="0 0 48 48" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M30 17V4H4V30H17"  stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M43 43V17H17V43H43Z" fill="none"  stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M33 30H17M33 30L28 25L33 30ZM33 30L28 35L33 30Z"  stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M17 17V43"  stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>退出登录
          </a>
        </div>
      </div>
    </div>
  </nav>
  
  <div class="max-w-7xl mx-auto px-4 pt-24 pb-28 sm:px-6 lg:px-8">
    <div class="bg-white rounded-lg p-5 border border-slate-200">
      <h2 class="text-2xl font-bold text-gray-800 mb-6">系统配置</h2>
      
      <form id="configForm" class="space-y-8">
        <div class="border-b border-gray-200 pb-6">
          <h3 class="text-lg font-medium text-gray-900 mb-4">管理员账户</h3>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label for="adminUsername" class="block text-sm font-medium text-gray-700">用户名</label>
              <input type="text" id="adminUsername" class="mt-1 ${inputLogin}">
            </div>
            <div>
              <label for="adminPassword" class="block text-sm font-medium text-gray-700">密码</label>
              <input type="password" id="adminPassword" placeholder="如不修改密码，请留空" class="mt-1 ${inputLogin}">
              <p class="mt-1 text-sm text-gray-500">留空表示不修改当前密码</p>
            </div>
          </div>
        </div>
        
        <div class="border-b border-gray-200 pb-6">
          <div class="grid grid-cols-1 gap-8 md:grid-cols-2 md:items-start">
            <div class="min-w-0 flex flex-col">
              <h3 class="text-lg font-medium text-gray-900 mb-4">显示设置</h3>
              <div>
                <label class="inline-flex items-center">
                  <input type="checkbox" id="showLunarGlobal" class="form-checkbox h-4 w-4 rounded border-gray-200 text-indigo-600 focus:ring-2 focus:ring-indigo-500/25" checked>
                  <span class="ml-2 text-sm text-gray-700">在通知中显示农历日期</span>
                </label>
                <p class="mt-1 text-sm text-gray-500">控制是否在通知消息中包含农历日期信息</p>
              </div>
            </div>
            <div class="min-w-0 flex flex-col border-gray-100 pt-6 md:pt-0 md:pl-8">
              <h3 class="text-lg font-medium text-gray-900 mb-2">时区设置</h3>
              <div>
                <select id="timezone" name="timezone" class="hidden"></select>
                <div class="relative min-w-0 mt-1" data-config-select-root>
                  <button type="button" id="timezoneTrigger" class="${selectLogin} flex cursor-pointer items-center justify-between gap-2 text-left" aria-haspopup="listbox" aria-expanded="false" aria-controls="timezoneDropdown">
                    <span id="timezoneDisplay" class="min-w-0 flex-1 truncate"></span>
                    <svg id="timezoneChevron" class="h-4 w-4 shrink-0 text-gray-400 transition-transform duration-200" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clip-rule="evenodd"/></svg>
                  </button>
                  <div id="timezoneDropdown" class="hidden absolute left-0 right-0 top-full z-[100] mt-1 max-h-60 min-w-0 overflow-x-hidden overflow-y-auto rounded-xl border border-gray-200 bg-white px-1 py-1 shadow-lg" role="listbox" aria-labelledby="timezoneTrigger"></div>
                </div>
                <p class="mt-1 text-sm text-gray-500">选择需要使用时区，系统会按该时区计算剩余时间（提醒 Cron 仍基于 UTC，请在 Cloudflare 控制台换算触发时间）</p>
              </div>
            </div>
          </div>
        </div>

        
        <div class="border-b border-gray-200 pb-6">
          <h3 class="text-lg font-medium text-gray-900 mb-4">通知设置</h3>
          <div class="grid grid-cols-1 md:grid-cols-1 gap-4 mb-6">
            <div>
              <label for="notificationHours" class="block text-sm font-medium text-gray-700">通知时段（UTC）</label>
              <input type="text" id="notificationHours" placeholder="例如：08, 12, 20 或输入 * 表示全天"
                class="mt-1 ${inputLogin}">
              <p class="mt-1 text-sm text-gray-500">可输入多个小时，使用逗号或空格分隔；留空则默认每天执行一次任务即可</p>
            </div>
            <div class="bg-indigo-50 border border-indigo-100 rounded-md p-3 text-sm text-indigo-700">
              <p class="font-medium mb-1">提示</p>
              <p>Cloudflare Workers Cron 以 UTC 计算，例如北京时间 08:00 需设置 Cron 为 <code>0 0 * * *</code> 并在此填入 08。</p>
              <p class="mt-1">若 Cron 已设置为每小时执行，可用该字段限制实际发送提醒的小时段。</p>
            </div>
          </div>
          <div class="mb-6">
            <label class="block text-sm font-medium text-gray-700 mb-3">通知方式（可多选）</label>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label class="inline-flex items-center">
                <input type="checkbox" name="enabledNotifiers" value="telegram" class="form-checkbox h-4 w-4 rounded border-gray-200 text-indigo-600 focus:ring-2 focus:ring-indigo-500/25">
                <span class="ml-2 text-sm text-gray-700">Telegram</span>
              </label>
              <label class="inline-flex items-center">
                <input type="checkbox" name="enabledNotifiers" value="notifyx" class="form-checkbox h-4 w-4 rounded border-gray-200 text-indigo-600 focus:ring-2 focus:ring-indigo-500/25" checked>
                <span class="ml-2 text-sm text-gray-700 font-semibold">NotifyX</span>
              </label>
              <label class="inline-flex items-center">
                <input type="checkbox" name="enabledNotifiers" value="webhook" class="form-checkbox h-4 w-4 rounded border-gray-200 text-indigo-600 focus:ring-2 focus:ring-indigo-500/25">
                <span class="ml-2 text-sm text-gray-700">Webhook 通知</span>
              </label>
              <label class="inline-flex items-center">
                <input type="checkbox" name="enabledNotifiers" value="wechatbot" class="form-checkbox h-4 w-4 rounded border-gray-200 text-indigo-600 focus:ring-2 focus:ring-indigo-500/25">
                <span class="ml-2 text-sm text-gray-700">企业微信机器人</span>
              </label>
              <label class="inline-flex items-center">
                <input type="checkbox" name="enabledNotifiers" value="email" class="form-checkbox h-4 w-4 rounded border-gray-200 text-indigo-600 focus:ring-2 focus:ring-indigo-500/25">
                <span class="ml-2 text-sm text-gray-700">邮件通知</span>
              </label>
              <label class="inline-flex items-center">
                <input type="checkbox" name="enabledNotifiers" value="bark" class="form-checkbox h-4 w-4 rounded border-gray-200 text-indigo-600 focus:ring-2 focus:ring-indigo-500/25">
                <span class="ml-2 text-sm text-gray-700">Bark</span>
              </label>
            </div>
            <div class="mt-2 flex flex-wrap gap-4">
              <a href="https://www.notifyx.cn/" target="_blank" class="text-indigo-600 hover:text-indigo-800 text-sm flex items-center hover:bg-gray-100 px-1 py-0.5 rounded">
                ${iconSvg('externalLink', 'mr-1 inline h-3.5 w-3.5')} NotifyX官网
              </a>
              <a href="https://webhook.site" target="_blank" class="text-indigo-600 hover:text-indigo-800 text-sm flex items-center hover:bg-gray-100 px-1 py-0.5 rounded">
                ${iconSvg('externalLink', 'mr-1 inline h-3.5 w-3.5')} Webhook 调试工具
              </a>
              <a href="https://developer.work.weixin.qq.com/document/path/91770" target="_blank" class="text-indigo-600 hover:text-indigo-800 text-sm flex items-center hover:bg-gray-100 px-1 py-0.5 rounded">
                ${iconSvg('externalLink', 'mr-1 inline h-3.5 w-3.5')} 企业微信机器人文档
              </a>
              <a href="https://developers.cloudflare.com/workers/tutorials/send-emails-with-resend/" target="_blank" class="text-indigo-600 hover:text-indigo-800 text-sm flex items-center hover:bg-gray-100 px-1 py-0.5 rounded">
                ${iconSvg('externalLink', 'mr-1 inline h-3.5 w-3.5')} 获取 Resend API Key
              </a>
              <a href="https://apps.apple.com/cn/app/bark-customed-notifications/id1403753865" target="_blank" class="text-indigo-600 hover:text-indigo-800 text-sm flex items-center hover:bg-gray-100 px-1 py-0.5 rounded">
                ${iconSvg('externalLink', 'mr-1 inline h-3.5 w-3.5')} Bark iOS应用
              </a>
            </div>
          </div>

          <div class="mb-6">
            <label for="thirdPartyToken" class="block text-sm font-medium text-gray-700">第三方 API 访问令牌</label>
            <div class="mt-1 flex flex-col sm:flex-row sm:items-center gap-3">
              <input type="text" id="thirdPartyToken" placeholder="建议使用随机字符串，例如：iH5s9vB3..."
                class="mt-1 min-w-0 flex-1 ${fieldLoginBase} px-3">
              <button type="button" id="generateThirdPartyToken" class="${btnSecondary} shrink-0 whitespace-nowrap">
                ${iconSvg('magic', 'mr-1 h-4 w-4')}生成令牌
              </button>
            </div>
            <p class="mt-1 text-sm text-gray-500">调用 /api/notify/{token} 接口时需携带此令牌；留空表示禁用第三方 API 推送。</p>
          </div>
          
          <div id="telegramConfig" class="${cfgSectionInactive}">
            <h4 class="text-md font-medium text-gray-900 mb-3">Telegram 配置</h4>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label for="tgBotToken" class="block text-sm font-medium text-gray-700">Bot Token</label>
                <input type="text" id="tgBotToken" placeholder="从 @BotFather 获取" class="mt-1 ${inputLogin}">
              </div>
              <div>
                <label for="tgChatId" class="block text-sm font-medium text-gray-700">Chat ID</label>
                <input type="text" id="tgChatId" placeholder="可从 @userinfobot 获取" class="mt-1 ${inputLogin}">
              </div>
            </div>
            <div class="flex justify-end">
              <button type="button" id="testTelegramBtn" class="${btnSecondary}">
                ${iconSvg('paperPlane', 'mr-1 h-5 w-5')}测试 Telegram 通知
              </button>
            </div>
          </div>
          
          <div id="notifyxConfig" class="${cfgSectionInactive}">
            <h4 class="text-md font-medium text-gray-900 mb-3">NotifyX 配置</h4>
            <div class="mb-4">
              <label for="notifyxApiKey" class="block text-sm font-medium text-gray-700">API Key</label>
              <input type="text" id="notifyxApiKey" placeholder="从 NotifyX 平台获取的 API Key" class="mt-1 ${inputLogin}">
              <p class="mt-1 text-sm text-gray-500">从 <a href="https://www.notifyx.cn/" target="_blank" class="text-indigo-600 hover:text-indigo-800">NotifyX平台</a> 获取的 API Key</p>
            </div>
            <div class="flex justify-end">
              <button type="button" id="testNotifyXBtn" class="${btnSecondary}">
                ${iconSvg('paperPlane', 'mr-1 h-5 w-5')}测试 NotifyX 通知
              </button>
            </div>
          </div>

          <div id="webhookConfig" class="${cfgSectionInactive}">
            <h4 class="text-md font-medium text-gray-900 mb-3">Webhook 通知 配置</h4>
            <div class="grid grid-cols-1 gap-4 mb-4">
              <div>
                <label for="webhookUrl" class="block text-sm font-medium text-gray-700">Webhook 通知 URL</label>
                <input type="url" id="webhookUrl" placeholder="https://your-webhook-endpoint.com/path" class="mt-1 ${inputLogin}">
                <p class="mt-1 text-sm text-gray-500">请填写自建服务或第三方平台提供的 Webhook 地址，例如 <code>https://your-webhook-endpoint.com/path</code></p>
              </div>
              <div>
                <label for="webhookMethod" class="block text-sm font-medium text-gray-700">请求方法</label>
                <select id="webhookMethod" class="hidden">
                  <option value="POST">POST</option>
                  <option value="GET">GET</option>
                  <option value="PUT">PUT</option>
                </select>
                <div class="relative min-w-0 mt-1" data-config-select-root>
                  <button type="button" id="webhookMethodTrigger" class="${selectLogin} flex cursor-pointer items-center justify-between gap-2 text-left" aria-haspopup="listbox" aria-expanded="false" aria-controls="webhookMethodDropdown">
                    <span id="webhookMethodDisplay" class="min-w-0 flex-1 truncate"></span>
                    <svg id="webhookMethodChevron" class="h-4 w-4 shrink-0 text-gray-400 transition-transform duration-200" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clip-rule="evenodd"/></svg>
                  </button>
                  <div id="webhookMethodDropdown" class="hidden absolute left-0 right-0 top-full z-[100] mt-1 max-h-60 min-w-0 overflow-x-hidden overflow-y-auto rounded-xl border border-gray-200 bg-white px-1 py-1 shadow-lg" role="listbox" aria-labelledby="webhookMethodTrigger"></div>
                </div>
              </div>
              <div>
                <label for="webhookHeaders" class="block text-sm font-medium text-gray-700">自定义请求头 (JSON格式，可选)</label>
                <textarea id="webhookHeaders" rows="3" placeholder='{"Authorization": "Bearer your-token", "Content-Type": "application/json"}' class="mt-1 ${textareaLogin}"></textarea>
                <p class="mt-1 text-sm text-gray-500">JSON格式的自定义请求头，留空使用默认</p>
              </div>
              <div>
                <label for="webhookTemplate" class="block text-sm font-medium text-gray-700">消息模板 (JSON格式，可选)</label>
                <textarea id="webhookTemplate" rows="4" placeholder='{"title": "{{title}}", "content": "{{content}}", "timestamp": "{{timestamp}}"}' class="mt-1 ${textareaLogin}"></textarea>
                <p class="mt-1 text-sm text-gray-500">支持变量: {{title}}, {{content}}, {{timestamp}}。留空使用默认格式</p>
              </div>
            </div>
            <div class="flex justify-end">
              <button type="button" id="testWebhookBtn" class="${btnSecondary}">
                ${iconSvg('paperPlane', 'mr-1 h-5 w-5')}测试 Webhook 通知
              </button>
            </div>
          </div>

          <div id="wechatbotConfig" class="${cfgSectionInactive}">
            <h4 class="text-md font-medium text-gray-900 mb-3">企业微信机器人 配置</h4>
            <div class="grid grid-cols-1 gap-4 mb-4">
              <div>
                <label for="wechatbotWebhook" class="block text-sm font-medium text-gray-700">机器人 Webhook URL</label>
                <input type="url" id="wechatbotWebhook" placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=your-key" class="mt-1 ${inputLogin}">
                <p class="mt-1 text-sm text-gray-500">从企业微信群聊中添加机器人获取的 Webhook URL</p>
              </div>
              <div>
                <label for="wechatbotMsgType" class="block text-sm font-medium text-gray-700">消息类型</label>
                <select id="wechatbotMsgType" class="hidden">
                  <option value="text">文本消息</option>
                  <option value="markdown">Markdown消息</option>
                </select>
                <div class="relative min-w-0 mt-1" data-config-select-root>
                  <button type="button" id="wechatbotMsgTypeTrigger" class="${selectLogin} flex cursor-pointer items-center justify-between gap-2 text-left" aria-haspopup="listbox" aria-expanded="false" aria-controls="wechatbotMsgTypeDropdown">
                    <span id="wechatbotMsgTypeDisplay" class="min-w-0 flex-1 truncate"></span>
                    <svg id="wechatbotMsgTypeChevron" class="h-4 w-4 shrink-0 text-gray-400 transition-transform duration-200" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clip-rule="evenodd"/></svg>
                  </button>
                  <div id="wechatbotMsgTypeDropdown" class="hidden absolute left-0 right-0 top-full z-[100] mt-1 max-h-60 min-w-0 overflow-x-hidden overflow-y-auto rounded-xl border border-gray-200 bg-white px-1 py-1 shadow-lg" role="listbox" aria-labelledby="wechatbotMsgTypeTrigger"></div>
                </div>
                <p class="mt-1 text-sm text-gray-500">选择发送的消息格式类型</p>
              </div>
              <div>
                <label for="wechatbotAtMobiles" class="block text-sm font-medium text-gray-700">@手机号 (可选)</label>
                <input type="text" id="wechatbotAtMobiles" placeholder="13800138000,13900139000" class="mt-1 ${inputLogin}">
                <p class="mt-1 text-sm text-gray-500">需要@的手机号，多个用逗号分隔，留空则不@任何人</p>
              </div>
              <div>
                <label for="wechatbotAtAll" class="block text-sm font-medium text-gray-700 mb-2">@所有人</label>
                <label class="inline-flex items-center">
                  <input type="checkbox" id="wechatbotAtAll" class="form-checkbox h-4 w-4 rounded border-gray-200 text-indigo-600 focus:ring-2 focus:ring-indigo-500/25">
                  <span class="ml-2 text-sm text-gray-700">发送消息时@所有人</span>
                </label>
              </div>
            </div>
            <div class="flex justify-end">
              <button type="button" id="testWechatBotBtn" class="${btnSecondary}">
                ${iconSvg('paperPlane', 'mr-1 h-5 w-5')}测试 企业微信机器人
              </button>
            </div>
          </div>

          <div id="emailConfig" class="${cfgSectionInactive}">
            <h4 class="text-md font-medium text-gray-900 mb-3">邮件通知 配置</h4>
            <div class="grid grid-cols-1 gap-4 mb-4">
              <div>
                <label for="resendApiKey" class="block text-sm font-medium text-gray-700">Resend API Key</label>
                <input type="text" id="resendApiKey" placeholder="re_xxxxxxxxxx" class="mt-1 ${inputLogin}">
                <p class="mt-1 text-sm text-gray-500">从 <a href="https://resend.com/api-keys" target="_blank" class="text-indigo-600 hover:text-indigo-800">Resend控制台</a> 获取的 API Key</p>
              </div>
              <div>
                <label for="emailFrom" class="block text-sm font-medium text-gray-700">发件人邮箱</label>
                <input type="email" id="emailFrom" placeholder="noreply@yourdomain.com" class="mt-1 ${inputLogin}">
                <p class="mt-1 text-sm text-gray-500">必须是已在Resend验证的域名邮箱</p>
              </div>
              <div>
                <label for="emailFromName" class="block text-sm font-medium text-gray-700">发件人名称</label>
                <input type="text" id="emailFromName" placeholder="SubTrack" class="mt-1 ${inputLogin}">
                <p class="mt-1 text-sm text-gray-500">显示在邮件中的发件人名称</p>
              </div>
              <div>
                <label for="emailTo" class="block text-sm font-medium text-gray-700">收件人邮箱</label>
                <input type="email" id="emailTo" placeholder="user@example.com" class="mt-1 ${inputLogin}">
                <p class="mt-1 text-sm text-gray-500">接收通知邮件的邮箱地址</p>
              </div>
            </div>
            <div class="flex justify-end">
              <button type="button" id="testEmailBtn" class="${btnSecondary}">
                ${iconSvg('paperPlane', 'mr-1 h-5 w-5')}测试 邮件通知
              </button>
            </div>
          </div>

          <div id="barkConfig" class="${cfgSectionInactive}">
            <h4 class="text-md font-medium text-gray-900 mb-3">Bark 配置</h4>
            <div class="grid grid-cols-1 gap-4 mb-4">
              <div>
                <label for="barkServer" class="block text-sm font-medium text-gray-700">服务器地址</label>
                <input type="url" id="barkServer" placeholder="https://api.day.app" class="mt-1 ${inputLogin}">
                <p class="mt-1 text-sm text-gray-500">Bark 服务器地址，默认为官方服务器，也可以使用自建服务器</p>
              </div>
              <div>
                <label for="barkDeviceKey" class="block text-sm font-medium text-gray-700">设备Key</label>
                <input type="text" id="barkDeviceKey" placeholder="从Bark应用获取的设备Key" class="mt-1 ${inputLogin}">
                <p class="mt-1 text-sm text-gray-500">从 <a href="https://apps.apple.com/cn/app/bark-customed-notifications/id1403753865" target="_blank" class="text-indigo-600 hover:text-indigo-800">Bark iOS 应用</a> 中获取的设备Key</p>
              </div>
              <div>
                <label for="barkIsArchive" class="block text-sm font-medium text-gray-700 mb-2">保存推送</label>
                <label class="inline-flex items-center">
                  <input type="checkbox" id="barkIsArchive" class="form-checkbox h-4 w-4 rounded border-gray-200 text-indigo-600 focus:ring-2 focus:ring-indigo-500/25">
                  <span class="ml-2 text-sm text-gray-700">保存推送到历史记录</span>
                </label>
                <p class="mt-1 text-sm text-gray-500">勾选后推送消息会保存到 Bark 的历史记录中</p>
              </div>
            </div>
            <div class="flex justify-end">
              <button type="button" id="testBarkBtn" class="${btnSecondary}">
                ${iconSvg('paperPlane', 'mr-1 h-5 w-5')}测试 Bark 通知
              </button>
            </div>
          </div>
        </div>

      </form>
    </div>
  </div>

  <div class="fixed bottom-0 left-0 right-0 z-40 border-t border-gray-200 bg-white/95 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.06)] backdrop-blur-sm">
    <div class="max-w-7xl mx-auto flex justify-end px-4 py-3 sm:px-6 lg:px-8">
      <button type="submit" id="configSaveBtn" form="configForm" class="${btnPrimary}">
        ${iconSvg('save', 'mr-1 h-5 w-5')}保存配置
      </button>
    </div>
  </div>

  <script>
    function showToast(message, type = 'success', duration = 3000) {
      const container = document.getElementById('toast-container');
      const toast = document.createElement('div');
      const bg =
        type === 'success'
          ? 'bg-emerald-600'
          : type === 'error'
            ? 'bg-red-500'
            : type === 'warning'
              ? 'bg-amber-500'
              : 'bg-sky-600';
      toast.className = '${twToast} ' + bg;

      const iconSvg =
        type === 'success'
          ? '<svg class="h-4 w-4 shrink-0" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.86-9.86a.75.75 0 00-1.06-1.06L9 10.88 7.2 9.08a.75.75 0 10-1.06 1.06l2.33 2.33c.293.293.767.293 1.06 0l4.33-4.33z" clip-rule="evenodd"/></svg>'
          : type === 'error'
            ? '<svg class="h-4 w-4 shrink-0" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm0-4a.9.9 0 100-1.8.9.9 0 000 1.8zm.75-8.25a.75.75 0 00-1.5 0v4.5a.75.75 0 001.5 0v-4.5z" clip-rule="evenodd"/></svg>'
            : type === 'warning'
              ? '<svg class="h-4 w-4 shrink-0" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M8.485 3.495a1.75 1.75 0 013.03 0l6.28 10.875A1.75 1.75 0 0116.28 17H3.72a1.75 1.75 0 01-1.515-2.63l6.28-10.875zM10.75 7a.75.75 0 00-1.5 0v4a.75.75 0 001.5 0V7zM10 14.25a.875.875 0 100-1.75.875.875 0 000 1.75z" clip-rule="evenodd"/></svg>'
              : '<svg class="h-4 w-4 shrink-0" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M18 10A8 8 0 112 10a8 8 0 0116 0zM9.25 8a.75.75 0 011.5 0v6a.75.75 0 01-1.5 0V8zM10 5.75a.875.875 0 100-1.75.875.875 0 000 1.75z" clip-rule="evenodd"/></svg>';

      toast.innerHTML = '<div class="flex items-center gap-2">' + iconSvg + '<span>' + message + '</span></div>';

      container.appendChild(toast);
      requestAnimationFrame(() => toast.classList.add('${twToastIn}'));
      setTimeout(() => {
        toast.classList.remove('${twToastIn}');
        setTimeout(() => {
          if (container.contains(toast)) {
            container.removeChild(toast);
          }
        }, 320);
      }, duration);
    }

    const CONFIG_PAGE_SELECT_IDS = ['timezone', 'webhookMethod', 'wechatbotMsgType'];

    function closeConfigSelectDropdown(selectId) {
      const panel = document.getElementById(selectId + 'Dropdown');
      const trigger = document.getElementById(selectId + 'Trigger');
      const chevron = document.getElementById(selectId + 'Chevron');
      if (panel) {
        panel.classList.add('hidden');
      }
      if (trigger) {
        trigger.setAttribute('aria-expanded', 'false');
      }
      if (chevron) {
        chevron.classList.remove('rotate-180');
      }
    }

    function closeAllConfigSelectDropdowns(exceptSelectId) {
      CONFIG_PAGE_SELECT_IDS.forEach((id) => {
        if (id !== exceptSelectId) {
          closeConfigSelectDropdown(id);
        }
      });
    }

    function syncConfigSelectDropdown(selectId) {
      const select = document.getElementById(selectId);
      const display = document.getElementById(selectId + 'Display');
      const panel = document.getElementById(selectId + 'Dropdown');
      if (!select || !display || !panel) {
        return;
      }

      const selectedOption = select.options[select.selectedIndex] || select.options[0];
      if (!selectedOption) {
        display.textContent = '';
        return;
      }
      display.textContent = selectedOption.textContent;

      panel.querySelectorAll('.modal-select-option').forEach((btn) => {
        const selected = btn.getAttribute('data-value') === select.value;
        btn.setAttribute('aria-selected', selected ? 'true' : 'false');
        btn.className =
          'modal-select-option flex w-full min-w-0 max-w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left text-sm ' +
          (selected ? 'bg-gray-100 text-gray-900' : 'text-gray-900 hover:bg-gray-50');
        const check = btn.querySelector('[data-modal-select-check]');
        if (check) {
          check.classList.toggle('invisible', !selected);
        }
      });
    }

    function fillConfigSelectDropdownPanel(selectId) {
      const select = document.getElementById(selectId);
      const panel = document.getElementById(selectId + 'Dropdown');
      if (!select || !panel) {
        return;
      }

      const checkSvg =
        '<svg class="h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clip-rule="evenodd"/></svg>';

      panel.textContent = '';
      Array.from(select.options).forEach((option) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.setAttribute('role', 'option');
        btn.setAttribute('data-value', option.value);
        btn.className = 'modal-select-option flex w-full min-w-0 max-w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left text-sm text-gray-900 hover:bg-gray-50';
        const labelEl = document.createElement('span');
        labelEl.className = 'min-w-0 truncate';
        labelEl.textContent = option.textContent;
        const check = document.createElement('span');
        check.setAttribute('data-modal-select-check', '1');
        check.className = 'invisible shrink-0 text-gray-900';
        check.innerHTML = checkSvg;
        btn.appendChild(labelEl);
        btn.appendChild(check);
        btn.addEventListener('click', () => {
          select.value = option.value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
          closeConfigSelectDropdown(selectId);
        });
        panel.appendChild(btn);
      });
    }

    function setupConfigSelectDropdown(selectId) {
      const select = document.getElementById(selectId);
      const trigger = document.getElementById(selectId + 'Trigger');
      const panel = document.getElementById(selectId + 'Dropdown');
      const chevron = document.getElementById(selectId + 'Chevron');
      if (!select || !trigger || !panel) {
        return;
      }

      if (select.dataset.configSelectInitialized !== 'true') {
        fillConfigSelectDropdownPanel(selectId);

        trigger.addEventListener('click', (event) => {
          event.stopPropagation();
          closeAllConfigSelectDropdowns(selectId);
          const willOpen = panel.classList.contains('hidden');
          panel.classList.toggle('hidden', !willOpen);
          trigger.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
          if (chevron) {
            chevron.classList.toggle('rotate-180', willOpen);
          }
        });

        select.addEventListener('change', () => syncConfigSelectDropdown(selectId));
        select.dataset.configSelectInitialized = 'true';
      }

      if (!window.configSelectDropdownOutsideClickBound) {
        document.addEventListener('click', (event) => {
          if (!event.target.closest('[data-config-select-root]')) {
            closeAllConfigSelectDropdowns();
          }
        });
        window.configSelectDropdownOutsideClickBound = true;
      }

      syncConfigSelectDropdown(selectId);
      closeConfigSelectDropdown(selectId);
    }

    async function loadConfig() {
      try {
        const response = await fetch('/api/config');
        const config = await response.json();

        document.getElementById('adminUsername').value = config.ADMIN_USERNAME || '';
        document.getElementById('tgBotToken').value = config.TG_BOT_TOKEN || '';
        document.getElementById('tgChatId').value = config.TG_CHAT_ID || '';
        document.getElementById('notifyxApiKey').value = config.NOTIFYX_API_KEY || '';
        document.getElementById('webhookUrl').value = config.WEBHOOK_URL || '';
        document.getElementById('webhookMethod').value = config.WEBHOOK_METHOD || 'POST';
        document.getElementById('webhookHeaders').value = config.WEBHOOK_HEADERS || '';
        document.getElementById('webhookTemplate').value = config.WEBHOOK_TEMPLATE || '';
        document.getElementById('wechatbotWebhook').value = config.WECHATBOT_WEBHOOK || '';
        document.getElementById('wechatbotMsgType').value = config.WECHATBOT_MSG_TYPE || 'text';
        document.getElementById('wechatbotAtMobiles').value = config.WECHATBOT_AT_MOBILES || '';
        document.getElementById('wechatbotAtAll').checked = config.WECHATBOT_AT_ALL === 'true';
        document.getElementById('resendApiKey').value = config.RESEND_API_KEY || '';
        document.getElementById('emailFrom').value = config.EMAIL_FROM || '';
        document.getElementById('emailFromName').value = config.EMAIL_FROM_NAME || 'SubTrack';
        document.getElementById('emailTo').value = config.EMAIL_TO || '';
        document.getElementById('barkServer').value = config.BARK_SERVER || 'https://api.day.app';
        document.getElementById('barkDeviceKey').value = config.BARK_DEVICE_KEY || '';
        document.getElementById('barkIsArchive').checked = config.BARK_IS_ARCHIVE === 'true';
        document.getElementById('thirdPartyToken').value = config.THIRD_PARTY_API_TOKEN || '';
        const notificationHoursInput = document.getElementById('notificationHours');
        if (notificationHoursInput) {
          // 将通知小时数组格式化为逗号分隔的字符串，便于管理员查看与编辑
          const hours = Array.isArray(config.NOTIFICATION_HOURS) ? config.NOTIFICATION_HOURS : [];
          notificationHoursInput.value = hours.join(', ');
        }
        
        // 加载农历显示设置
        document.getElementById('showLunarGlobal').checked = config.SHOW_LUNAR === true;

        // 动态生成时区选项，并设置保存的值
        generateTimezoneOptions(config.TIMEZONE || 'UTC');

        // 处理多选通知渠道
        const enabledNotifiers = config.ENABLED_NOTIFIERS || ['notifyx'];
        document.querySelectorAll('input[name="enabledNotifiers"]').forEach(checkbox => {
          checkbox.checked = enabledNotifiers.includes(checkbox.value);
        });

        toggleNotificationConfigs(enabledNotifiers);

        setupConfigSelectDropdown('timezone');
        setupConfigSelectDropdown('webhookMethod');
        setupConfigSelectDropdown('wechatbotMsgType');
      } catch (error) {
        showToast('加载配置失败，请刷新页面重试', 'error');
      }
    }
    
    // 动态生成时区选项
    function generateTimezoneOptions(selectedTimezone = 'UTC') {
      const timezoneSelect = document.getElementById('timezone');
      
      const timezones = [
        { value: 'UTC', name: '世界标准时间', offset: '+0' },
        { value: 'Asia/Shanghai', name: '中国标准时间', offset: '+8' },
        { value: 'Asia/Hong_Kong', name: '香港时间', offset: '+8' },
        { value: 'Asia/Taipei', name: '台北时间', offset: '+8' },
        { value: 'Asia/Singapore', name: '新加坡时间', offset: '+8' },
        { value: 'Asia/Tokyo', name: '日本时间', offset: '+9' },
        { value: 'Asia/Seoul', name: '韩国时间', offset: '+9' },
        { value: 'America/New_York', name: '美国东部时间', offset: '-5' },
        { value: 'America/Chicago', name: '美国中部时间', offset: '-6' },
        { value: 'America/Denver', name: '美国山地时间', offset: '-7' },
        { value: 'America/Los_Angeles', name: '美国太平洋时间', offset: '-8' },
        { value: 'Europe/London', name: '英国时间', offset: '+0' },
        { value: 'Europe/Paris', name: '巴黎时间', offset: '+1' },
        { value: 'Europe/Berlin', name: '柏林时间', offset: '+1' },
        { value: 'Europe/Moscow', name: '莫斯科时间', offset: '+3' },
        { value: 'Australia/Sydney', name: '悉尼时间', offset: '+10' },
        { value: 'Australia/Melbourne', name: '墨尔本时间', offset: '+10' },
        { value: 'Pacific/Auckland', name: '奥克兰时间', offset: '+12' }
      ];
      
      // 清空现有选项
      timezoneSelect.innerHTML = '';
      
      // 添加新选项
      timezones.forEach(tz => {
        const option = document.createElement('option');
        option.value = tz.value;
        option.textContent = tz.name + '（UTC' + tz.offset + '）';
        timezoneSelect.appendChild(option);
      });
      
      // 设置选中的时区
      timezoneSelect.value = selectedTimezone;

      if (timezoneSelect.dataset.configSelectInitialized === 'true') {
        fillConfigSelectDropdownPanel('timezone');
        syncConfigSelectDropdown('timezone');
      }
    }
    
    function toggleNotificationConfigs(enabledNotifiers) {
      const pairs = [
        ['telegram', document.getElementById('telegramConfig')],
        ['notifyx', document.getElementById('notifyxConfig')],
        ['webhook', document.getElementById('webhookConfig')],
        ['wechatbot', document.getElementById('wechatbotConfig')],
        ['email', document.getElementById('emailConfig')],
        ['bark', document.getElementById('barkConfig')],
      ];
      pairs.forEach(([key, el]) => {
        if (!el) {
          return;
        }
        el.className = enabledNotifiers.includes(key) ? '${cfgSectionActive}' : '${cfgSectionInactive}';
      });
    }

    document.querySelectorAll('input[name="enabledNotifiers"]').forEach(checkbox => {
      checkbox.addEventListener('change', () => {
        const enabledNotifiers = Array.from(document.querySelectorAll('input[name="enabledNotifiers"]:checked'))
          .map(cb => cb.value);
        toggleNotificationConfigs(enabledNotifiers);
      });
    });
    
    document.getElementById('configForm').addEventListener('submit', async (e) => {
      e.preventDefault();

      const enabledNotifiers = Array.from(document.querySelectorAll('input[name="enabledNotifiers"]:checked'))
        .map(cb => cb.value);

      if (enabledNotifiers.length === 0) {
        showToast('请至少选择一种通知方式', 'warning');
        return;
      }

      const config = {
        ADMIN_USERNAME: document.getElementById('adminUsername').value.trim(),
        TG_BOT_TOKEN: document.getElementById('tgBotToken').value.trim(),
        TG_CHAT_ID: document.getElementById('tgChatId').value.trim(),
        NOTIFYX_API_KEY: document.getElementById('notifyxApiKey').value.trim(),
        WEBHOOK_URL: document.getElementById('webhookUrl').value.trim(),
        WEBHOOK_METHOD: document.getElementById('webhookMethod').value,
        WEBHOOK_HEADERS: document.getElementById('webhookHeaders').value.trim(),
        WEBHOOK_TEMPLATE: document.getElementById('webhookTemplate').value.trim(),
        SHOW_LUNAR: document.getElementById('showLunarGlobal').checked,
        WECHATBOT_WEBHOOK: document.getElementById('wechatbotWebhook').value.trim(),
        WECHATBOT_MSG_TYPE: document.getElementById('wechatbotMsgType').value,
        WECHATBOT_AT_MOBILES: document.getElementById('wechatbotAtMobiles').value.trim(),
        WECHATBOT_AT_ALL: document.getElementById('wechatbotAtAll').checked.toString(),
        RESEND_API_KEY: document.getElementById('resendApiKey').value.trim(),
        EMAIL_FROM: document.getElementById('emailFrom').value.trim(),
        EMAIL_FROM_NAME: document.getElementById('emailFromName').value.trim(),
        EMAIL_TO: document.getElementById('emailTo').value.trim(),
        BARK_SERVER: document.getElementById('barkServer').value.trim() || 'https://api.day.app',
        BARK_DEVICE_KEY: document.getElementById('barkDeviceKey').value.trim(),
        BARK_IS_ARCHIVE: document.getElementById('barkIsArchive').checked.toString(),
        ENABLED_NOTIFIERS: enabledNotifiers,
        TIMEZONE: document.getElementById('timezone').value.trim(),
        THIRD_PARTY_API_TOKEN: document.getElementById('thirdPartyToken').value.trim(),
        // 前端先行整理通知小时列表，后端仍会再次校验
        NOTIFICATION_HOURS: (() => {
          const raw = document.getElementById('notificationHours').value.trim();
          if (!raw) {
            return [];
          }
          return raw
            .split(/[,，\s]+/)
            .map(item => item.trim())
            .filter(item => item.length > 0);
        })()
      };

      const passwordField = document.getElementById('adminPassword');
      if (passwordField.value.trim()) {
        config.ADMIN_PASSWORD = passwordField.value.trim();
      }

      const submitButton = document.getElementById('configSaveBtn');
      if (!submitButton) {
        return;
      }
      const originalContent = submitButton.innerHTML;
      submitButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" class="animate-spin mr-2" viewBox="0 0 24 24" width="20" height="20" fill="currentColor" style="opacity:1;"><path fill-rule="evenodd" d="M12 19a7 7 0 1 0 0-14a7 7 0 0 0 0 14m0 3c5.523 0 10-4.477 10-10S17.523 2 12 2S2 6.477 2 12s4.477 10 10 10" clip-rule="evenodd" opacity=".2"/><path d="M2 12C2 6.477 6.477 2 12 2v3a7 7 0 0 0-7 7z"/></svg>保存中...';
      submitButton.disabled = true;

      try {
        const response = await fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(config)
        });

        const result = await response.json();

        if (result.success) {
          showToast('配置保存成功', 'success');
          passwordField.value = '';
          
          // 更新全局时区并重新显示时间
          globalTimezone = config.TIMEZONE;
          showSystemTime();
          
          // 标记时区已更新，供其他页面检测
          localStorage.setItem('timezoneUpdated', Date.now().toString());
          
          // 如果当前在订阅列表页面，则自动刷新页面以更新时区显示
          if (window.location.pathname === '/admin') {
            window.location.reload();
          }
        } else {
          showToast('配置保存失败: ' + (result.message || '未知错误'), 'error');
        }
      } catch (error) {
        showToast('保存配置失败，请稍后再试', 'error');
      } finally {
        submitButton.innerHTML = originalContent;
        submitButton.disabled = false;
      }
    });
    
    async function testNotification(type) {
      const buttonId = type === 'telegram' ? 'testTelegramBtn' :
                      type === 'notifyx' ? 'testNotifyXBtn' :
                      type === 'wechatbot' ? 'testWechatBotBtn' :
                      type === 'email' ? 'testEmailBtn' :
                      type === 'bark' ? 'testBarkBtn' : 'testWebhookBtn';
      const button = document.getElementById(buttonId);
      const originalContent = button.innerHTML;
      const serviceName = type === 'telegram' ? 'Telegram' :
                          type === 'notifyx' ? 'NotifyX' :
                          type === 'wechatbot' ? '企业微信机器人' :
                          type === 'email' ? '邮件通知' :
                          type === 'bark' ? 'Bark' : 'Webhook 通知';

      button.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" class="animate-spin mr-2" viewBox="0 0 24 24" width="20" height="20" fill="currentColor" style="opacity:1;"><path fill-rule="evenodd" d="M12 19a7 7 0 1 0 0-14a7 7 0 0 0 0 14m0 3c5.523 0 10-4.477 10-10S17.523 2 12 2S2 6.477 2 12s4.477 10 10 10" clip-rule="evenodd" opacity=".2"/><path d="M2 12C2 6.477 6.477 2 12 2v3a7 7 0 0 0-7 7z"/></svg>测试中...';
      button.disabled = true;

      const config = {};
      if (type === 'telegram') {
        config.TG_BOT_TOKEN = document.getElementById('tgBotToken').value.trim();
        config.TG_CHAT_ID = document.getElementById('tgChatId').value.trim();

        if (!config.TG_BOT_TOKEN || !config.TG_CHAT_ID) {
          showToast('请先填写 Telegram Bot Token 和 Chat ID', 'warning');
          button.innerHTML = originalContent;
          button.disabled = false;
          return;
        }
      } else if (type === 'notifyx') {
        config.NOTIFYX_API_KEY = document.getElementById('notifyxApiKey').value.trim();

        if (!config.NOTIFYX_API_KEY) {
          showToast('请先填写 NotifyX API Key', 'warning');
          button.innerHTML = originalContent;
          button.disabled = false;
          return;
        }
      } else if (type === 'webhook') {
        config.WEBHOOK_URL = document.getElementById('webhookUrl').value.trim();
        config.WEBHOOK_METHOD = document.getElementById('webhookMethod').value;
        config.WEBHOOK_HEADERS = document.getElementById('webhookHeaders').value.trim();
        config.WEBHOOK_TEMPLATE = document.getElementById('webhookTemplate').value.trim();

        if (!config.WEBHOOK_URL) {
          showToast('请先填写 Webhook 通知 URL', 'warning');
          button.innerHTML = originalContent;
          button.disabled = false;
          return;
        }
      } else if (type === 'wechatbot') {
        config.WECHATBOT_WEBHOOK = document.getElementById('wechatbotWebhook').value.trim();
        config.WECHATBOT_MSG_TYPE = document.getElementById('wechatbotMsgType').value;
        config.WECHATBOT_AT_MOBILES = document.getElementById('wechatbotAtMobiles').value.trim();
        config.WECHATBOT_AT_ALL = document.getElementById('wechatbotAtAll').checked.toString();

        if (!config.WECHATBOT_WEBHOOK) {
          showToast('请先填写企业微信机器人 Webhook URL', 'warning');
          button.innerHTML = originalContent;
          button.disabled = false;
          return;
        }
      } else if (type === 'email') {
        config.RESEND_API_KEY = document.getElementById('resendApiKey').value.trim();
        config.EMAIL_FROM = document.getElementById('emailFrom').value.trim();
        config.EMAIL_FROM_NAME = document.getElementById('emailFromName').value.trim();
        config.EMAIL_TO = document.getElementById('emailTo').value.trim();

        if (!config.RESEND_API_KEY || !config.EMAIL_FROM || !config.EMAIL_TO) {
          showToast('请先填写 Resend API Key、发件人邮箱和收件人邮箱', 'warning');
          button.innerHTML = originalContent;
          button.disabled = false;
          return;
        }
      } else if (type === 'bark') {
        config.BARK_SERVER = document.getElementById('barkServer').value.trim() || 'https://api.day.app';
        config.BARK_DEVICE_KEY = document.getElementById('barkDeviceKey').value.trim();
        config.BARK_IS_ARCHIVE = document.getElementById('barkIsArchive').checked.toString();

        if (!config.BARK_DEVICE_KEY) {
          showToast('请先填写 Bark 设备Key', 'warning');
          button.innerHTML = originalContent;
          button.disabled = false;
          return;
        }
      }

      try {
        const response = await fetch('/api/test-notification', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: type, ...config })
        });

        const result = await response.json();

        if (result.success) {
          showToast(serviceName + ' 通知测试成功！', 'success');
        } else {
          showToast(serviceName + ' 通知测试失败: ' + (result.message || '未知错误'), 'error');
        }
      } catch (error) {
        showToast('测试失败，请稍后再试', 'error');
      } finally {
        button.innerHTML = originalContent;
        button.disabled = false;
      }
    }
    
    document.getElementById('testTelegramBtn').addEventListener('click', () => {
      testNotification('telegram');
    });
    
    document.getElementById('testNotifyXBtn').addEventListener('click', () => {
      testNotification('notifyx');
    });

    document.getElementById('testWebhookBtn').addEventListener('click', () => {
      testNotification('webhook');
    });

    document.getElementById('testWechatBotBtn').addEventListener('click', () => {
      testNotification('wechatbot');
    });

    document.getElementById('testEmailBtn').addEventListener('click', () => {
      testNotification('email');
    });

    document.getElementById('testBarkBtn').addEventListener('click', () => {
      testNotification('bark');
    });

    document.getElementById('generateThirdPartyToken').addEventListener('click', () => {
      try {
        // 生成 32 位随机令牌，避免出现特殊字符，方便写入 URL
        const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        const buffer = new Uint8Array(32);
        window.crypto.getRandomValues(buffer);
        const token = Array.from(buffer).map(v => charset[v % charset.length]).join('');
        const input = document.getElementById('thirdPartyToken');
        input.value = token;
        input.dispatchEvent(new Event('input'));
        showToast('已生成新的第三方 API 令牌，请保存配置后生效', 'info');
      } catch (error) {
        showToast('生成令牌失败，请手动输入', 'error');
      }
    });

    window.addEventListener('load', loadConfig);
    
    // 全局时区配置
    let globalTimezone = 'UTC';
    
    // 实时显示系统时间和时区
    async function showSystemTime() {
      try {
        // 获取后台配置的时区
        const response = await fetch('/api/config');
        const config = await response.json();
        globalTimezone = config.TIMEZONE || 'UTC';
        
        // 格式化当前时间
        function formatTime(dt, tz) {
          const dtf = new Intl.DateTimeFormat('en-CA', {
            timeZone: tz,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
          });
          const parts = dtf.formatToParts(dt);
          const v = (t) => (parts.find((x) => x.type === t) || {}).value || '';
          return v('year') + '-' + v('month') + '-' + v('day') + ' ' + v('hour') + ':' + v('minute') + ':' + v('second');
        }
        function formatTimezoneDisplay(tz) {
          try {
            // 使用更准确的时区偏移计算方法
            const now = new Date();
            const dtf = new Intl.DateTimeFormat('en-US', {
              timeZone: tz,
              hour12: false,
              year: 'numeric', month: '2-digit', day: '2-digit',
              hour: '2-digit', minute: '2-digit', second: '2-digit'
            });
            const parts = dtf.formatToParts(now);
            const get = type => Number(parts.find(x => x.type === type).value);
            const target = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
            const utc = now.getTime();
            const offset = Math.round((target - utc) / (1000 * 60 * 60));
            
            // 时区中文名称映射
            const timezoneNames = {
              'UTC': '世界标准时间',
              'Asia/Shanghai': '中国标准时间',
              'Asia/Hong_Kong': '香港时间',
              'Asia/Taipei': '台北时间',
              'Asia/Singapore': '新加坡时间',
              'Asia/Tokyo': '日本时间',
              'Asia/Seoul': '韩国时间',
              'America/New_York': '美国东部时间',
              'America/Los_Angeles': '美国太平洋时间',
              'America/Chicago': '美国中部时间',
              'America/Denver': '美国山地时间',
              'Europe/London': '英国时间',
              'Europe/Paris': '巴黎时间',
              'Europe/Berlin': '柏林时间',
              'Europe/Moscow': '莫斯科时间',
              'Australia/Sydney': '悉尼时间',
              'Australia/Melbourne': '墨尔本时间',
              'Pacific/Auckland': '奥克兰时间'
            };
            
            const offsetStr = offset >= 0 ? '+' + offset : offset;
            const timezoneName = timezoneNames[tz] || tz;
            return timezoneName + ' (UTC' + offsetStr + ')';
          } catch (error) {
            return tz;
          }
        }
        function update() {
          const now = new Date();
          const timeStr = formatTime(now, globalTimezone);
          const tzStr = formatTimezoneDisplay(globalTimezone);
          const el = document.getElementById('systemTimeDisplay');
          if (el) {
            el.textContent = timeStr + '  ' + tzStr;
          }
        }
        update();
        // 每秒刷新
        setInterval(update, 1000);
        
        // 定期检查时区变化并重新加载订阅列表（每30秒检查一次）
        setInterval(async () => {
          try {
            const response = await fetch('/api/config');
            const config = await response.json();
            const newTimezone = config.TIMEZONE || 'UTC';
            
            if (globalTimezone !== newTimezone) {
              globalTimezone = newTimezone;
              // 重新加载订阅列表以更新天数计算
              loadSubscriptions();
            }
          } catch (error) {
          }
        }, 30000);
      } catch (e) {
        // 出错时显示本地时间
        const el = document.getElementById('systemTimeDisplay');
        if (el) {
          el.textContent = new Date().toLocaleString();
        }
      }
    }
    showSystemTime();
  </script>
</body>
</html>
`;

// 管理页面
// 与前端一致的分类切割正则，用于提取标签信息
const CATEGORY_SEPARATOR_REGEX = /[\/,，\s]+/;

function extractTagsFromSubscriptions(subscriptions = []) {
  const tagSet = new Set();
  (subscriptions || []).forEach((sub) => {
    if (!sub || typeof sub !== 'object') {
      return;
    }
    if (Array.isArray(sub.tags)) {
      sub.tags.forEach((tag) => {
        if (typeof tag === 'string' && tag.trim().length > 0) {
          tagSet.add(tag.trim());
        }
      });
    }
    if (typeof sub.category === 'string') {
      sub.category
        .split(CATEGORY_SEPARATOR_REGEX)
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0)
        .forEach((tag) => tagSet.add(tag));
    }
    if (typeof sub.customType === 'string' && sub.customType.trim().length > 0) {
      tagSet.add(sub.customType.trim());
    }
  });
  return Array.from(tagSet);
}

const admin = {
  async handleRequest(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const pathname = url.pathname;

      const token = getCookieValue(request.headers.get('Cookie'), 'token');

      const config = await getConfig(env);
      const user = token ? await verifyJWT(token, config.JWT_SECRET) : null;

      if (!user) {
        return new Response('', {
          status: 302,
          headers: { Location: '/' },
        });
      }

      if (pathname === '/admin/config') {
        return new Response(configPage, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }

      return new Response(adminPage, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    } catch (error) {
      return new Response('服务器内部错误', {
        status: 500,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }
  },
};

// 处理API请求
const api = {
  async handleRequest(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.slice(4);
    const method = request.method;

    const config = await getConfig(env);

    if (path === '/login' && method === 'POST') {
      const body = await request.json();

      if (body.username === config.ADMIN_USERNAME && body.password === config.ADMIN_PASSWORD) {
        const token = await generateJWT(body.username, config.JWT_SECRET);

        return new Response(JSON.stringify({ success: true }), {
          headers: {
            'Content-Type': 'application/json',
            'Set-Cookie': 'token=' + token + '; HttpOnly; Path=/; SameSite=Strict; Max-Age=86400',
          },
        });
      } else {
        return new Response(JSON.stringify({ success: false, message: '用户名或密码错误' }), { headers: { 'Content-Type': 'application/json' } });
      }
    }

    if (path === '/logout' && (method === 'GET' || method === 'POST')) {
      return new Response('', {
        status: 302,
        headers: {
          Location: '/',
          'Set-Cookie': 'token=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0',
        },
      });
    }

    const token = getCookieValue(request.headers.get('Cookie'), 'token');
    const user = token ? await verifyJWT(token, config.JWT_SECRET) : null;

    if (!user && path !== '/login') {
      return new Response(JSON.stringify({ success: false, message: '未授权访问' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (path === '/config') {
      if (method === 'GET') {
        const { JWT_SECRET, ADMIN_PASSWORD, ...safeConfig } = config;
        return new Response(JSON.stringify(safeConfig), { headers: { 'Content-Type': 'application/json' } });
      }

      if (method === 'POST') {
        try {
          const newConfig = await request.json();

          const updatedConfig = {
            ...config,
            ADMIN_USERNAME: newConfig.ADMIN_USERNAME || config.ADMIN_USERNAME,
            TG_BOT_TOKEN: newConfig.TG_BOT_TOKEN || '',
            TG_CHAT_ID: newConfig.TG_CHAT_ID || '',
            NOTIFYX_API_KEY: newConfig.NOTIFYX_API_KEY || '',
            WEBHOOK_URL: newConfig.WEBHOOK_URL || '',
            WEBHOOK_METHOD: newConfig.WEBHOOK_METHOD || 'POST',
            WEBHOOK_HEADERS: newConfig.WEBHOOK_HEADERS || '',
            WEBHOOK_TEMPLATE: newConfig.WEBHOOK_TEMPLATE || '',
            SHOW_LUNAR: newConfig.SHOW_LUNAR === true,
            WECHATBOT_WEBHOOK: newConfig.WECHATBOT_WEBHOOK || '',
            WECHATBOT_MSG_TYPE: newConfig.WECHATBOT_MSG_TYPE || 'text',
            WECHATBOT_AT_MOBILES: newConfig.WECHATBOT_AT_MOBILES || '',
            WECHATBOT_AT_ALL: newConfig.WECHATBOT_AT_ALL || 'false',
            RESEND_API_KEY: newConfig.RESEND_API_KEY || '',
            EMAIL_FROM: newConfig.EMAIL_FROM || '',
            EMAIL_FROM_NAME: newConfig.EMAIL_FROM_NAME || '',
            EMAIL_TO: newConfig.EMAIL_TO || '',
            BARK_DEVICE_KEY: newConfig.BARK_DEVICE_KEY || '',
            BARK_SERVER: newConfig.BARK_SERVER || 'https://api.day.app',
            BARK_IS_ARCHIVE: newConfig.BARK_IS_ARCHIVE || 'false',
            ENABLED_NOTIFIERS: newConfig.ENABLED_NOTIFIERS || ['notifyx'],
            TIMEZONE: newConfig.TIMEZONE || config.TIMEZONE || 'UTC',
            THIRD_PARTY_API_TOKEN: newConfig.THIRD_PARTY_API_TOKEN || '',
          };

          const rawNotificationHours = Array.isArray(newConfig.NOTIFICATION_HOURS)
            ? newConfig.NOTIFICATION_HOURS
            : typeof newConfig.NOTIFICATION_HOURS === 'string'
              ? newConfig.NOTIFICATION_HOURS.split(',')
              : [];

          const sanitizedNotificationHours = rawNotificationHours
            .map((value) => String(value).trim())
            .filter((value) => value.length > 0)
            .map((value) => {
              const upperValue = value.toUpperCase();
              if (upperValue === '*' || upperValue === 'ALL') {
                return '*';
              }
              const numeric = Number(upperValue);
              if (!isNaN(numeric)) {
                return String(Math.max(0, Math.min(23, Math.floor(numeric)))).padStart(2, '0');
              }
              return upperValue;
            });

          updatedConfig.NOTIFICATION_HOURS = sanitizedNotificationHours;

          if (newConfig.ADMIN_PASSWORD) {
            updatedConfig.ADMIN_PASSWORD = newConfig.ADMIN_PASSWORD;
          }

          // 确保JWT_SECRET存在且安全
          if (!updatedConfig.JWT_SECRET || updatedConfig.JWT_SECRET === 'your-secret-key') {
            updatedConfig.JWT_SECRET = generateRandomSecret();
          }

          await env.SUB_TRACK_KV.put('config', JSON.stringify(updatedConfig));

          return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
        } catch (error) {
          return new Response(JSON.stringify({ success: false, message: '更新配置失败: ' + error.message }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }
    }

    if (path === '/test-notification' && method === 'POST') {
      try {
        const body = await request.json();
        let success = false;
        let message = '';

        if (body.type === 'telegram') {
          const testConfig = {
            ...config,
            TG_BOT_TOKEN: body.TG_BOT_TOKEN,
            TG_CHAT_ID: body.TG_CHAT_ID,
          };

          const content = '*测试通知*\n\n这是一条测试通知，用于验证Telegram通知功能是否正常工作。\n\n发送时间: ' + formatBeijingTime();
          success = await sendTelegramNotification(content, testConfig);
          message = success ? 'Telegram通知发送成功' : 'Telegram通知发送失败，请检查配置';
        } else if (body.type === 'notifyx') {
          const testConfig = {
            ...config,
            NOTIFYX_API_KEY: body.NOTIFYX_API_KEY,
          };

          const title = '测试通知';
          const content = '## 这是一条测试通知\n\n用于验证NotifyX通知功能是否正常工作。\n\n发送时间: ' + formatBeijingTime();
          const description = '测试NotifyX通知功能';

          success = await sendNotifyXNotification(title, content, description, testConfig);
          message = success ? 'NotifyX通知发送成功' : 'NotifyX通知发送失败，请检查配置';
        } else if (body.type === 'webhook') {
          const testConfig = {
            ...config,
            WEBHOOK_URL: body.WEBHOOK_URL,
            WEBHOOK_METHOD: body.WEBHOOK_METHOD,
            WEBHOOK_HEADERS: body.WEBHOOK_HEADERS,
            WEBHOOK_TEMPLATE: body.WEBHOOK_TEMPLATE,
          };

          const title = '测试通知';
          const content = '这是一条测试通知，用于验证Webhook 通知功能是否正常工作。\n\n发送时间: ' + formatBeijingTime();

          success = await sendWebhookNotification(title, content, testConfig);
          message = success ? 'Webhook 通知发送成功' : 'Webhook 通知发送失败，请检查配置';
        } else if (body.type === 'wechatbot') {
          const testConfig = {
            ...config,
            WECHATBOT_WEBHOOK: body.WECHATBOT_WEBHOOK,
            WECHATBOT_MSG_TYPE: body.WECHATBOT_MSG_TYPE,
            WECHATBOT_AT_MOBILES: body.WECHATBOT_AT_MOBILES,
            WECHATBOT_AT_ALL: body.WECHATBOT_AT_ALL,
          };

          const title = '测试通知';
          const content = '这是一条测试通知，用于验证企业微信机器人功能是否正常工作。\n\n发送时间: ' + formatBeijingTime();

          success = await sendWechatBotNotification(title, content, testConfig);
          message = success ? '企业微信机器人通知发送成功' : '企业微信机器人通知发送失败，请检查配置';
        } else if (body.type === 'email') {
          const testConfig = {
            ...config,
            RESEND_API_KEY: body.RESEND_API_KEY,
            EMAIL_FROM: body.EMAIL_FROM,
            EMAIL_FROM_NAME: body.EMAIL_FROM_NAME,
            EMAIL_TO: body.EMAIL_TO,
          };

          const title = '测试通知';
          const content = '这是一条测试通知，用于验证邮件通知功能是否正常工作。\n\n发送时间: ' + formatBeijingTime();

          success = await sendEmailNotification(title, content, testConfig);
          message = success ? '邮件通知发送成功' : '邮件通知发送失败，请检查配置';
        } else if (body.type === 'bark') {
          const testConfig = {
            ...config,
            BARK_SERVER: body.BARK_SERVER,
            BARK_DEVICE_KEY: body.BARK_DEVICE_KEY,
            BARK_IS_ARCHIVE: body.BARK_IS_ARCHIVE,
          };

          const title = '测试通知';
          const content = '这是一条测试通知，用于验证Bark通知功能是否正常工作。\n\n发送时间: ' + formatBeijingTime();

          success = await sendBarkNotification(title, content, testConfig);
          message = success ? 'Bark通知发送成功' : 'Bark通知发送失败，请检查配置';
        }

        return new Response(JSON.stringify({ success, message }), { headers: { 'Content-Type': 'application/json' } });
      } catch (error) {
        return new Response(JSON.stringify({ success: false, message: '测试通知失败: ' + error.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    if (path === '/subscriptions') {
      if (method === 'GET') {
        const subscriptions = await getAllSubscriptions(env);
        return new Response(JSON.stringify(subscriptions), { headers: { 'Content-Type': 'application/json' } });
      }

      if (method === 'POST') {
        const subscription = await request.json();
        const result = await createSubscription(subscription, env);

        return new Response(JSON.stringify(result), {
          status: result.success ? 201 : 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    if (path.startsWith('/subscriptions/')) {
      const parts = path.split('/');
      const id = parts[2];

      if (parts[3] === 'toggle-status' && method === 'POST') {
        const body = await request.json();
        const result = await toggleSubscriptionStatus(id, body.isActive, env);

        return new Response(JSON.stringify(result), {
          status: result.success ? 200 : 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (parts[3] === 'test-notify' && method === 'POST') {
        const result = await testSingleSubscriptionNotification(id, env);
        return new Response(JSON.stringify(result), { status: result.success ? 200 : 500, headers: { 'Content-Type': 'application/json' } });
      }

      if (method === 'GET') {
        const subscription = await getSubscription(id, env);

        return new Response(JSON.stringify(subscription), { headers: { 'Content-Type': 'application/json' } });
      }

      if (method === 'PUT') {
        const subscription = await request.json();
        const result = await updateSubscription(id, subscription, env);

        return new Response(JSON.stringify(result), {
          status: result.success ? 200 : 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (method === 'DELETE') {
        const result = await deleteSubscription(id, env);

        return new Response(JSON.stringify(result), {
          status: result.success ? 200 : 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // 处理第三方通知API
    if (path.startsWith('/notify/')) {
      const pathSegments = path.split('/');
      // 允许通过路径、Authorization 头或查询参数三种方式传入访问令牌
      const tokenFromPath = pathSegments[2] || '';
      const tokenFromHeader = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
      const tokenFromQuery = url.searchParams.get('token') || '';
      const providedToken = tokenFromPath || tokenFromHeader || tokenFromQuery;
      const expectedToken = config.THIRD_PARTY_API_TOKEN || '';

      if (!expectedToken) {
        return new Response(JSON.stringify({ message: '第三方 API 已禁用，请在后台配置访问令牌后使用' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (!providedToken || providedToken !== expectedToken) {
        return new Response(JSON.stringify({ message: '访问未授权，令牌无效或缺失' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (method === 'POST') {
        try {
          const body = await request.json();
          const title = body.title || '第三方通知';
          const content = body.content || '';

          if (!content) {
            return new Response(JSON.stringify({ message: '缺少必填参数 content' }), {
              status: 400,
              headers: { 'Content-Type': 'application/json' },
            });
          }

          const config = await getConfig(env);
          const bodyTagsRaw = Array.isArray(body.tags) ? body.tags : typeof body.tags === 'string' ? body.tags.split(/[,，\s]+/) : [];
          const bodyTags = Array.isArray(bodyTagsRaw)
            ? bodyTagsRaw.filter((tag) => typeof tag === 'string' && tag.trim().length > 0).map((tag) => tag.trim())
            : [];

          // 使用多渠道发送通知
          await sendNotificationToAllChannels(title, content, config, '[第三方API]', {
            metadata: { tags: bodyTags },
          });

          return new Response(
            JSON.stringify({
              message: '发送成功',
              response: {
                errcode: 0,
                errmsg: 'ok',
                msgid: 'MSGID' + Date.now(),
              },
            }),
            { headers: { 'Content-Type': 'application/json' } },
          );
        } catch (error) {
          return new Response(
            JSON.stringify({
              message: '发送失败',
              response: {
                errcode: 1,
                errmsg: error.message,
              },
            }),
            { status: 500, headers: { 'Content-Type': 'application/json' } },
          );
        }
      }
    }

    return new Response(JSON.stringify({ success: false, message: '未找到请求的资源' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  },
};

// 工具函数
function generateRandomSecret() {
  // 生成一个64字符的随机密钥
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  let result = '';
  for (let i = 0; i < 64; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

async function getConfig(env) {
  try {
    if (!env.SUB_TRACK_KV) {
      throw new Error('KV存储未绑定');
    }

    const data = await env.SUB_TRACK_KV.get('config');

    const config = data ? JSON.parse(data) : {};

    // 确保JWT_SECRET的一致性
    let jwtSecret = config.JWT_SECRET;
    if (!jwtSecret || jwtSecret === 'your-secret-key') {
      jwtSecret = generateRandomSecret();

      // 保存新的JWT密钥
      const updatedConfig = { ...config, JWT_SECRET: jwtSecret };
      await env.SUB_TRACK_KV.put('config', JSON.stringify(updatedConfig));
    }

    const finalConfig = {
      ADMIN_USERNAME: config.ADMIN_USERNAME || 'admin',
      ADMIN_PASSWORD: config.ADMIN_PASSWORD || 'password',
      JWT_SECRET: jwtSecret,
      TG_BOT_TOKEN: config.TG_BOT_TOKEN || '',
      TG_CHAT_ID: config.TG_CHAT_ID || '',
      NOTIFYX_API_KEY: config.NOTIFYX_API_KEY || '',
      WEBHOOK_URL: config.WEBHOOK_URL || '',
      WEBHOOK_METHOD: config.WEBHOOK_METHOD || 'POST',
      WEBHOOK_HEADERS: config.WEBHOOK_HEADERS || '',
      WEBHOOK_TEMPLATE: config.WEBHOOK_TEMPLATE || '',
      SHOW_LUNAR: config.SHOW_LUNAR === true,
      WECHATBOT_WEBHOOK: config.WECHATBOT_WEBHOOK || '',
      WECHATBOT_MSG_TYPE: config.WECHATBOT_MSG_TYPE || 'text',
      WECHATBOT_AT_MOBILES: config.WECHATBOT_AT_MOBILES || '',
      WECHATBOT_AT_ALL: config.WECHATBOT_AT_ALL || 'false',
      RESEND_API_KEY: config.RESEND_API_KEY || '',
      EMAIL_FROM: config.EMAIL_FROM || '',
      EMAIL_FROM_NAME: config.EMAIL_FROM_NAME || '',
      EMAIL_TO: config.EMAIL_TO || '',
      BARK_DEVICE_KEY: config.BARK_DEVICE_KEY || '',
      BARK_SERVER: config.BARK_SERVER || 'https://api.day.app',
      BARK_IS_ARCHIVE: config.BARK_IS_ARCHIVE || 'false',
      ENABLED_NOTIFIERS: config.ENABLED_NOTIFIERS || ['notifyx'],
      TIMEZONE: config.TIMEZONE || 'UTC', // 新增时区字段
      NOTIFICATION_HOURS: Array.isArray(config.NOTIFICATION_HOURS) ? config.NOTIFICATION_HOURS : [],
      THIRD_PARTY_API_TOKEN: config.THIRD_PARTY_API_TOKEN || '',
    };

    return finalConfig;
  } catch (error) {
    const defaultJwtSecret = generateRandomSecret();

    return {
      ADMIN_USERNAME: 'admin',
      ADMIN_PASSWORD: 'password',
      JWT_SECRET: defaultJwtSecret,
      TG_BOT_TOKEN: '',
      TG_CHAT_ID: '',
      NOTIFYX_API_KEY: '',
      WEBHOOK_URL: '',
      WEBHOOK_METHOD: 'POST',
      WEBHOOK_HEADERS: '',
      WEBHOOK_TEMPLATE: '',
      SHOW_LUNAR: true,
      WECHATBOT_WEBHOOK: '',
      WECHATBOT_MSG_TYPE: 'text',
      WECHATBOT_AT_MOBILES: '',
      WECHATBOT_AT_ALL: 'false',
      RESEND_API_KEY: '',
      EMAIL_FROM: '',
      EMAIL_FROM_NAME: '',
      EMAIL_TO: '',
      ENABLED_NOTIFIERS: ['notifyx'],
      NOTIFICATION_HOURS: [],
      TIMEZONE: 'UTC', // 新增时区字段
      THIRD_PARTY_API_TOKEN: '',
    };
  }
}

async function generateJWT(username, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = { username, iat: Math.floor(Date.now() / 1000) };

  const headerBase64 = btoa(JSON.stringify(header));
  const payloadBase64 = btoa(JSON.stringify(payload));

  const signatureInput = headerBase64 + '.' + payloadBase64;
  const signature = await CryptoJS.HmacSHA256(signatureInput, secret);

  return headerBase64 + '.' + payloadBase64 + '.' + signature;
}

async function verifyJWT(token, secret) {
  try {
    if (!token || !secret) {
      return null;
    }

    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    const [headerBase64, payloadBase64, signature] = parts;
    const signatureInput = headerBase64 + '.' + payloadBase64;
    const expectedSignature = await CryptoJS.HmacSHA256(signatureInput, secret);

    if (signature !== expectedSignature) {
      return null;
    }

    const payload = JSON.parse(atob(payloadBase64));
    return payload;
  } catch (error) {
    return null;
  }
}

async function getAllSubscriptions(env) {
  try {
    const data = await env.SUB_TRACK_KV.get('subscriptions');
    return data ? JSON.parse(data) : [];
  } catch (error) {
    return [];
  }
}

async function getSubscription(id, env) {
  const subscriptions = await getAllSubscriptions(env);
  return subscriptions.find((s) => s.id === id);
}

// 2. 修改 createSubscription，支持 useLunar 字段
async function createSubscription(subscription, env) {
  try {
    const subscriptions = await getAllSubscriptions(env);

    if (!subscription.name || !subscription.expiryDate) {
      return { success: false, message: '缺少必填字段' };
    }

    let expiryDate = new Date(subscription.expiryDate);
    const config = await getConfig(env);
    const timezone = config?.TIMEZONE || 'UTC';
    const currentTime = getCurrentTimeInTimezone(timezone);

    let useLunar = !!subscription.useLunar;
    if (useLunar) {
      let lunar = lunarCalendar.solar2lunar(expiryDate.getFullYear(), expiryDate.getMonth() + 1, expiryDate.getDate());

      if (lunar && subscription.periodValue && subscription.periodUnit) {
        // 如果到期日<=今天，自动推算到下一个周期
        while (expiryDate <= currentTime) {
          lunar = lunarBiz.addLunarPeriod(lunar, subscription.periodValue, subscription.periodUnit);
          const solar = lunarBiz.lunar2solar(lunar);
          expiryDate = new Date(solar.year, solar.month - 1, solar.day);
        }
        subscription.expiryDate = expiryDate.toISOString();
      }
    } else {
      if (expiryDate < currentTime && subscription.periodValue && subscription.periodUnit) {
        while (expiryDate < currentTime) {
          if (subscription.periodUnit === 'day') {
            expiryDate.setDate(expiryDate.getDate() + subscription.periodValue);
          } else if (subscription.periodUnit === 'month') {
            expiryDate.setMonth(expiryDate.getMonth() + subscription.periodValue);
          } else if (subscription.periodUnit === 'year') {
            expiryDate.setFullYear(expiryDate.getFullYear() + subscription.periodValue);
          }
        }
        subscription.expiryDate = expiryDate.toISOString();
      }
    }

    const reminderSetting = resolveReminderSetting(subscription);

    const newSubscription = {
      id: Date.now().toString(), // 前端使用本地时间戳
      name: subscription.name,
      customType: subscription.customType || '',
      category: subscription.category ? subscription.category.trim() : '',
      startDate: subscription.startDate || null,
      expiryDate: subscription.expiryDate,
      periodValue: subscription.periodValue || 1,
      periodUnit: subscription.periodUnit || 'month',
      reminderUnit: reminderSetting.unit,
      reminderValue: reminderSetting.value,
      reminderDays: reminderSetting.unit === 'day' ? reminderSetting.value : undefined,
      reminderHours: reminderSetting.unit === 'hour' ? reminderSetting.value : undefined,
      notes: subscription.notes || '',
      isActive: subscription.isActive !== false,
      autoRenew: subscription.autoRenew !== false,
      useLunar: useLunar,
      createdAt: new Date().toISOString(),
    };

    subscriptions.push(newSubscription);

    await env.SUB_TRACK_KV.put('subscriptions', JSON.stringify(subscriptions));

    return { success: true, subscription: newSubscription };
  } catch (error) {
    return { success: false, message: error && error.message ? error.message : '创建订阅失败' };
  }
}

// 3. 修改 updateSubscription，支持 useLunar 字段
async function updateSubscription(id, subscription, env) {
  try {
    const subscriptions = await getAllSubscriptions(env);
    const index = subscriptions.findIndex((s) => s.id === id);

    if (index === -1) {
      return { success: false, message: '订阅不存在' };
    }

    if (!subscription.name || !subscription.expiryDate) {
      return { success: false, message: '缺少必填字段' };
    }

    let expiryDate = new Date(subscription.expiryDate);
    const config = await getConfig(env);
    const timezone = config?.TIMEZONE || 'UTC';
    const currentTime = getCurrentTimeInTimezone(timezone);

    let useLunar = !!subscription.useLunar;
    if (useLunar) {
      let lunar = lunarCalendar.solar2lunar(expiryDate.getFullYear(), expiryDate.getMonth() + 1, expiryDate.getDate());
      if (!lunar) {
        return { success: false, message: '农历日期超出支持范围（1900-2100年）' };
      }
      if (lunar && expiryDate < currentTime && subscription.periodValue && subscription.periodUnit) {
        // 新增：循环加周期，直到 expiryDate > currentTime
        do {
          lunar = lunarBiz.addLunarPeriod(lunar, subscription.periodValue, subscription.periodUnit);
          const solar = lunarBiz.lunar2solar(lunar);
          expiryDate = new Date(solar.year, solar.month - 1, solar.day);
        } while (expiryDate < currentTime);
        subscription.expiryDate = expiryDate.toISOString();
      }
    } else {
      if (expiryDate < currentTime && subscription.periodValue && subscription.periodUnit) {
        while (expiryDate < currentTime) {
          if (subscription.periodUnit === 'day') {
            expiryDate.setDate(expiryDate.getDate() + subscription.periodValue);
          } else if (subscription.periodUnit === 'month') {
            expiryDate.setMonth(expiryDate.getMonth() + subscription.periodValue);
          } else if (subscription.periodUnit === 'year') {
            expiryDate.setFullYear(expiryDate.getFullYear() + subscription.periodValue);
          }
        }
        subscription.expiryDate = expiryDate.toISOString();
      }
    }

    const reminderSource = {
      reminderUnit: subscription.reminderUnit !== undefined ? subscription.reminderUnit : subscriptions[index].reminderUnit,
      reminderValue: subscription.reminderValue !== undefined ? subscription.reminderValue : subscriptions[index].reminderValue,
      reminderHours: subscription.reminderHours !== undefined ? subscription.reminderHours : subscriptions[index].reminderHours,
      reminderDays: subscription.reminderDays !== undefined ? subscription.reminderDays : subscriptions[index].reminderDays,
    };
    const reminderSetting = resolveReminderSetting(reminderSource);

    subscriptions[index] = {
      ...subscriptions[index],
      name: subscription.name,
      customType: subscription.customType || subscriptions[index].customType || '',
      category: subscription.category !== undefined ? subscription.category.trim() : subscriptions[index].category || '',
      startDate: subscription.startDate || subscriptions[index].startDate,
      expiryDate: subscription.expiryDate,
      periodValue: subscription.periodValue || subscriptions[index].periodValue || 1,
      periodUnit: subscription.periodUnit || subscriptions[index].periodUnit || 'month',
      reminderUnit: reminderSetting.unit,
      reminderValue: reminderSetting.value,
      reminderDays: reminderSetting.unit === 'day' ? reminderSetting.value : undefined,
      reminderHours: reminderSetting.unit === 'hour' ? reminderSetting.value : undefined,
      notes: subscription.notes || '',
      isActive: subscription.isActive !== undefined ? subscription.isActive : subscriptions[index].isActive,
      autoRenew:
        subscription.autoRenew !== undefined
          ? subscription.autoRenew
          : subscriptions[index].autoRenew !== undefined
            ? subscriptions[index].autoRenew
            : true,
      useLunar: useLunar,
      updatedAt: new Date().toISOString(),
    };

    await env.SUB_TRACK_KV.put('subscriptions', JSON.stringify(subscriptions));

    return { success: true, subscription: subscriptions[index] };
  } catch (error) {
    return { success: false, message: '更新订阅失败' };
  }
}

async function deleteSubscription(id, env) {
  try {
    const subscriptions = await getAllSubscriptions(env);
    const filteredSubscriptions = subscriptions.filter((s) => s.id !== id);

    if (filteredSubscriptions.length === subscriptions.length) {
      return { success: false, message: '订阅不存在' };
    }

    await env.SUB_TRACK_KV.put('subscriptions', JSON.stringify(filteredSubscriptions));

    return { success: true };
  } catch (error) {
    return { success: false, message: '删除订阅失败' };
  }
}

async function toggleSubscriptionStatus(id, isActive, env) {
  try {
    const subscriptions = await getAllSubscriptions(env);
    const index = subscriptions.findIndex((s) => s.id === id);

    if (index === -1) {
      return { success: false, message: '订阅不存在' };
    }

    subscriptions[index] = {
      ...subscriptions[index],
      isActive: isActive,
      updatedAt: new Date().toISOString(),
    };

    await env.SUB_TRACK_KV.put('subscriptions', JSON.stringify(subscriptions));

    return { success: true, subscription: subscriptions[index] };
  } catch (error) {
    return { success: false, message: '更新订阅状态失败' };
  }
}

async function testSingleSubscriptionNotification(id, env) {
  try {
    const subscription = await getSubscription(id, env);
    if (!subscription) {
      return { success: false, message: '未找到该订阅' };
    }
    const config = await getConfig(env);

    const title = `手动测试通知: ${subscription.name}`;

    // 检查是否显示农历（从配置中获取，默认不显示）
    const showLunar = config.SHOW_LUNAR === true;
    let lunarExpiryText = '';

    if (showLunar) {
      // 计算农历日期
      const expiryDateObj = new Date(subscription.expiryDate);
      const lunarExpiry = lunarCalendar.solar2lunar(expiryDateObj.getFullYear(), expiryDateObj.getMonth() + 1, expiryDateObj.getDate());
      lunarExpiryText = lunarExpiry ? ` (农历: ${lunarExpiry.fullStr})` : '';
    }

    // 格式化到期日期（使用所选时区）
    const timezone = config?.TIMEZONE || 'UTC';
    const formattedExpiryDate = formatTimeInTimezone(new Date(subscription.expiryDate), timezone, 'date');
    const currentTime = formatTimeInTimezone(new Date(), timezone, 'datetime');

    // 获取日历类型和自动续期状态
    const calendarType = subscription.useLunar ? '农历' : '公历';
    const autoRenewText = subscription.autoRenew ? '是' : '否';

    const commonContent = `**订阅详情**
类型: ${subscription.customType || '其他'}
日历类型: ${calendarType}
到期日期: ${formattedExpiryDate}${lunarExpiryText}
自动续期: ${autoRenewText}
备注: ${subscription.notes || '无'}
发送时间: ${currentTime}
当前时区: ${formatTimezoneDisplay(timezone)}`;

    // 使用多渠道发送
    const tags = extractTagsFromSubscriptions([subscription]);
    await sendNotificationToAllChannels(title, commonContent, config, '[手动测试]', {
      metadata: { tags },
    });

    return { success: true, message: '测试通知已发送到所有启用的渠道' };
  } catch (error) {
    return { success: false, message: '发送时发生错误: ' + error.message };
  }
}

async function sendWebhookNotification(title, content, config, metadata = {}) {
  try {
    if (!config.WEBHOOK_URL) {
      return false;
    }

    let requestBody;
    let headers = { 'Content-Type': 'application/json' };

    // 处理自定义请求头
    if (config.WEBHOOK_HEADERS) {
      try {
        const customHeaders = JSON.parse(config.WEBHOOK_HEADERS);
        headers = { ...headers, ...customHeaders };
      } catch (error) {}
    }

    const tagsArray = Array.isArray(metadata.tags)
      ? metadata.tags.filter((tag) => typeof tag === 'string' && tag.trim().length > 0).map((tag) => tag.trim())
      : [];
    const tagsBlock = tagsArray.length ? tagsArray.map((tag) => `- ${tag}`).join('\n') : '';
    const tagsLine = tagsArray.length ? '标签：' + tagsArray.join('、') : '';
    const timestamp = formatTimeInTimezone(new Date(), config?.TIMEZONE || 'UTC', 'datetime');
    const formattedMessage = [title, content, tagsLine, `发送时间：${timestamp}`]
      .filter((section) => section && section.trim().length > 0)
      .join('\n\n');

    const templateData = {
      title,
      content,
      tags: tagsBlock,
      tagsLine,
      rawTags: tagsArray,
      timestamp,
      formattedMessage,
      message: formattedMessage,
    };

    const escapeForJson = (value) => {
      if (value === null || value === undefined) {
        return '';
      }
      return JSON.stringify(String(value)).slice(1, -1);
    };

    const applyTemplate = (template, data) => {
      const templateString = JSON.stringify(template);
      const replaced = templateString.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
        if (Object.prototype.hasOwnProperty.call(data, key)) {
          return escapeForJson(data[key]);
        }
        return '';
      });
      return JSON.parse(replaced);
    };

    // 处理消息模板
    if (config.WEBHOOK_TEMPLATE) {
      try {
        const template = JSON.parse(config.WEBHOOK_TEMPLATE);
        requestBody = applyTemplate(template, templateData);
      } catch (error) {
        requestBody = {
          title,
          content,
          tags: tagsArray,
          tagsLine,
          timestamp,
          message: formattedMessage,
        };
      }
    } else {
      requestBody = {
        title,
        content,
        tags: tagsArray,
        tagsLine,
        timestamp,
        message: formattedMessage,
      };
    }

    const response = await fetch(config.WEBHOOK_URL, {
      method: config.WEBHOOK_METHOD || 'POST',
      headers: headers,
      body: JSON.stringify(requestBody),
    });

    const result = await response.text();
    return response.ok;
  } catch (error) {
    return false;
  }
}

async function sendWeComNotification(message, config) {
  // This is a placeholder. In a real scenario, you would implement the WeCom notification logic here.
  return { success: false, message: '企业微信通知功能未实现' };
}

async function sendWechatBotNotification(title, content, config) {
  try {
    if (!config.WECHATBOT_WEBHOOK) {
      return false;
    }

    // 构建消息内容
    let messageData;
    const msgType = config.WECHATBOT_MSG_TYPE || 'text';

    if (msgType === 'markdown') {
      // Markdown 消息格式
      const markdownContent = `# ${title}\n\n${content}`;
      messageData = {
        msgtype: 'markdown',
        markdown: {
          content: markdownContent,
        },
      };
    } else {
      // 文本消息格式 - 优化显示
      const textContent = `${title}\n\n${content}`;
      messageData = {
        msgtype: 'text',
        text: {
          content: textContent,
        },
      };
    }

    // 处理@功能
    if (config.WECHATBOT_AT_ALL === 'true') {
      // @所有人
      if (msgType === 'text') {
        messageData.text.mentioned_list = ['@all'];
      }
    } else if (config.WECHATBOT_AT_MOBILES) {
      // @指定手机号
      const mobiles = config.WECHATBOT_AT_MOBILES.split(',')
        .map((m) => m.trim())
        .filter((m) => m);
      if (mobiles.length > 0) {
        if (msgType === 'text') {
          messageData.text.mentioned_mobile_list = mobiles;
        }
      }
    }

    const response = await fetch(config.WECHATBOT_WEBHOOK, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messageData),
    });

    const responseText = await response.text();

    if (response.ok) {
      try {
        const result = JSON.parse(responseText);
        if (result.errcode === 0) {
          return true;
        } else {
          return false;
        }
      } catch (parseError) {
        return false;
      }
    } else {
      return false;
    }
  } catch (error) {
    return false;
  }
}

// 优化通知内容格式
function resolveReminderSetting(subscription) {
  const defaultDays = subscription && subscription.reminderDays !== undefined ? Number(subscription.reminderDays) : 7;
  let unit = subscription && subscription.reminderUnit === 'hour' ? 'hour' : 'day';

  let value;
  if (unit === 'hour') {
    if (
      subscription &&
      subscription.reminderValue !== undefined &&
      subscription.reminderValue !== null &&
      !isNaN(Number(subscription.reminderValue))
    ) {
      value = Number(subscription.reminderValue);
    } else if (
      subscription &&
      subscription.reminderHours !== undefined &&
      subscription.reminderHours !== null &&
      !isNaN(Number(subscription.reminderHours))
    ) {
      value = Number(subscription.reminderHours);
    } else {
      value = 0;
    }
  } else {
    if (
      subscription &&
      subscription.reminderValue !== undefined &&
      subscription.reminderValue !== null &&
      !isNaN(Number(subscription.reminderValue))
    ) {
      value = Number(subscription.reminderValue);
    } else if (!isNaN(defaultDays)) {
      value = Number(defaultDays);
    } else {
      value = 7;
    }
  }

  if (value < 0 || isNaN(value)) {
    value = 0;
  }

  return { unit, value };
}

function shouldTriggerReminder(reminder, daysDiff, hoursDiff) {
  if (!reminder) {
    return false;
  }
  if (reminder.unit === 'hour') {
    if (reminder.value === 0) {
      return hoursDiff >= 0 && hoursDiff < 1;
    }
    return hoursDiff >= 0 && hoursDiff <= reminder.value;
  }
  if (reminder.value === 0) {
    return daysDiff === 0;
  }
  return daysDiff >= 0 && daysDiff <= reminder.value;
}

function formatNotificationContent(subscriptions, config) {
  const showLunar = config.SHOW_LUNAR === true;
  const timezone = config?.TIMEZONE || 'UTC';
  let content = '';

  for (const sub of subscriptions) {
    const typeText = sub.customType || '其他';
    const periodText =
      sub.periodValue && sub.periodUnit
        ? `(周期: ${sub.periodValue} ${{ day: '天', month: '月', year: '年' }[sub.periodUnit] || sub.periodUnit})`
        : '';
    const categoryText = sub.category ? sub.category : '未分类';
    const reminderSetting = resolveReminderSetting(sub);

    // 格式化到期日期（使用所选时区）
    const expiryDateObj = new Date(sub.expiryDate);
    const formattedExpiryDate = formatTimeInTimezone(expiryDateObj, timezone, 'date');

    // 农历日期
    let lunarExpiryText = '';
    if (showLunar) {
      const lunarExpiry = lunarCalendar.solar2lunar(expiryDateObj.getFullYear(), expiryDateObj.getMonth() + 1, expiryDateObj.getDate());
      lunarExpiryText = lunarExpiry
        ? `
农历日期: ${lunarExpiry.fullStr}`
        : '';
    }

    // 状态和到期时间
    let statusText = '';
    let statusEmoji = '';
    if (sub.daysRemaining === 0) {
      statusEmoji = '⚠️';
      statusText = '今天到期！';
    } else if (sub.daysRemaining < 0) {
      statusEmoji = '🚨';
      statusText = `已过期 ${Math.abs(sub.daysRemaining)} 天`;
    } else {
      statusEmoji = '📅';
      statusText = `将在 ${sub.daysRemaining} 天后到期`;
    }

    const reminderSuffix = reminderSetting.value === 0 ? '（仅到期时提醒）' : reminderSetting.unit === 'hour' ? '（小时级提醒）' : '';
    const reminderText =
      reminderSetting.unit === 'hour'
        ? `提醒策略: 提前 ${reminderSetting.value} 小时${reminderSuffix}`
        : `提醒策略: 提前 ${reminderSetting.value} 天${reminderSuffix}`;

    // 获取日历类型和自动续期状态
    const calendarType = sub.useLunar ? '农历' : '公历';
    const autoRenewText = sub.autoRenew ? '是' : '否';

    // 构建格式化的通知内容
    const subscriptionContent = `${statusEmoji} **${sub.name}**
类型: ${typeText} ${periodText}
分类: ${categoryText}
日历类型: ${calendarType}
到期日期: ${formattedExpiryDate}${lunarExpiryText}
自动续期: ${autoRenewText}
${reminderText}
到期状态: ${statusText}`;

    // 添加备注
    let finalContent = sub.notes ? subscriptionContent + `\n备注: ${sub.notes}` : subscriptionContent;

    content += finalContent + '\n\n';
  }

  // 添加发送时间和时区信息
  const currentTime = formatTimeInTimezone(new Date(), timezone, 'datetime');
  content += `发送时间: ${currentTime}\n当前时区: ${formatTimezoneDisplay(timezone)}`;

  return content;
}

async function sendNotificationToAllChannels(title, commonContent, config, logPrefix = '[定时任务]', options = {}) {
  const metadata = options.metadata || {};
  if (!config.ENABLED_NOTIFIERS || config.ENABLED_NOTIFIERS.length === 0) {
    return;
  }

  if (config.ENABLED_NOTIFIERS.includes('notifyx')) {
    const notifyxContent = `## ${title}\n\n${commonContent}`;
    const success = await sendNotifyXNotification(title, notifyxContent, `SubTrack`, config);
  }
  if (config.ENABLED_NOTIFIERS.includes('telegram')) {
    const telegramContent = `*${title}*\n\n${commonContent}`;
    const success = await sendTelegramNotification(telegramContent, config);
  }
  if (config.ENABLED_NOTIFIERS.includes('webhook')) {
    const webhookContent = commonContent.replace(/(\**|\*|##|#|`)/g, '');
    const success = await sendWebhookNotification(title, webhookContent, config, metadata);
  }
  if (config.ENABLED_NOTIFIERS.includes('wechatbot')) {
    const wechatbotContent = commonContent.replace(/(\**|\*|##|#|`)/g, '');
    const success = await sendWechatBotNotification(title, wechatbotContent, config);
  }
  if (config.ENABLED_NOTIFIERS.includes('weixin')) {
    const weixinContent = `【${title}】\n\n${commonContent.replace(/(\**|\*|##|#|`)/g, '')}`;
    const result = await sendWeComNotification(weixinContent, config);
  }
  if (config.ENABLED_NOTIFIERS.includes('email')) {
    const emailContent = commonContent.replace(/(\**|\*|##|#|`)/g, '');
    const success = await sendEmailNotification(title, emailContent, config);
  }
  if (config.ENABLED_NOTIFIERS.includes('bark')) {
    const barkContent = commonContent.replace(/(\**|\*|##|#|`)/g, '');
    const success = await sendBarkNotification(title, barkContent, config);
  }
}

async function sendTelegramNotification(message, config) {
  try {
    if (!config.TG_BOT_TOKEN || !config.TG_CHAT_ID) {
      return false;
    }

    const url = 'https://api.telegram.org/bot' + config.TG_BOT_TOKEN + '/sendMessage';
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: config.TG_CHAT_ID,
        text: message,
        parse_mode: 'Markdown',
      }),
    });

    const result = await response.json();
    return result.ok;
  } catch (error) {
    return false;
  }
}

async function sendNotifyXNotification(title, content, description, config) {
  try {
    if (!config.NOTIFYX_API_KEY) {
      return false;
    }

    const url = 'https://www.notifyx.cn/api/v1/send/' + config.NOTIFYX_API_KEY;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: title,
        content: content,
        description: description || '',
      }),
    });

    const result = await response.json();
    return result.status === 'queued';
  } catch (error) {
    return false;
  }
}

async function sendBarkNotification(title, content, config) {
  try {
    if (!config.BARK_DEVICE_KEY) {
      return false;
    }

    const serverUrl = config.BARK_SERVER || 'https://api.day.app';
    const url = serverUrl + '/push';
    const payload = {
      title: title,
      body: content,
      device_key: config.BARK_DEVICE_KEY,
    };

    // 如果配置了保存推送，则添加isArchive参数
    if (config.BARK_IS_ARCHIVE === 'true') {
      payload.isArchive = 1;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(payload),
    });

    const result = await response.json();

    // Bark API返回code为200表示成功
    return result.code === 200;
  } catch (error) {
    return false;
  }
}

async function sendEmailNotification(title, content, config) {
  try {
    if (!config.RESEND_API_KEY || !config.EMAIL_FROM || !config.EMAIL_TO) {
      return false;
    }

    // 生成HTML邮件内容
    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #f5f5f5; }
        .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px 20px; text-align: center; }
        .header h1 { color: white; margin: 0; font-size: 24px; }
        .content { padding: 30px 20px; }
        .content h2 { color: #333; margin-top: 0; }
        .content p { color: #666; line-height: 1.6; margin: 16px 0; }
        .footer { background-color: #f8f9fa; padding: 20px; text-align: center; color: #666; font-size: 14px; }
        .highlight { background-color: #e3f2fd; padding: 15px; border-radius: 8px; margin: 20px 0; }
        .button { display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📅 ${title}</h1>
        </div>
        <div class="content">
            <div class="highlight">
                ${content.replace(/\n/g, '<br>')}
            </div>
            <p>此邮件由SubTrack自动发送，请及时处理相关订阅事务。</p>
        </div>
        <div class="footer">
            <p>SubTrack | 发送时间: ${formatTimeInTimezone(new Date(), config?.TIMEZONE || 'UTC', 'datetime')}</p>
        </div>
    </div>
</body>
</html>`;

    const fromEmail = config.EMAIL_FROM_NAME ? `${config.EMAIL_FROM_NAME} <${config.EMAIL_FROM}>` : config.EMAIL_FROM;

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromEmail,
        to: config.EMAIL_TO,
        subject: title,
        html: htmlContent,
        text: content, // 纯文本备用
      }),
    });

    const result = await response.json();

    if (response.ok && result.id) {
      return true;
    } else {
      return false;
    }
  } catch (error) {
    return false;
  }
}

async function sendNotification(title, content, description, config) {
  if (config.NOTIFICATION_TYPE === 'notifyx') {
    return await sendNotifyXNotification(title, content, description, config);
  } else {
    return await sendTelegramNotification(content, config);
  }
}

// 4. 修改定时任务 checkExpiringSubscriptions，支持农历周期自动续订和农历提醒
async function checkExpiringSubscriptions(env) {
  try {
    const config = await getConfig(env);
    const timezone = config?.TIMEZONE || 'UTC';
    const currentTime = getCurrentTimeInTimezone(timezone);

    const currentMidnight = getTimezoneMidnightTimestamp(currentTime, timezone); // 统一计算当天的零点时间，避免多次格式化

    const rawNotificationHours = Array.isArray(config.NOTIFICATION_HOURS) ? config.NOTIFICATION_HOURS : [];
    const normalizedNotificationHours = rawNotificationHours
      .map((value) => String(value).trim())
      .filter((value) => value.length > 0)
      .map((value) => (value === '*' ? '*' : value.toUpperCase() === 'ALL' ? 'ALL' : value.padStart(2, '0')));
    const allowAllHours = normalizedNotificationHours.includes('*') || normalizedNotificationHours.includes('ALL');
    const hourFormatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour12: false, hour: '2-digit' });
    const currentHour = hourFormatter.format(currentTime);
    const shouldNotifyThisHour = allowAllHours || normalizedNotificationHours.length === 0 || normalizedNotificationHours.includes(currentHour);

    const subscriptions = await getAllSubscriptions(env);
    const expiringSubscriptions = [];
    const updatedSubscriptions = [];
    let hasUpdates = false;

    for (const subscription of subscriptions) {
      if (subscription.isActive === false) {
        continue;
      }

      const reminderSetting = resolveReminderSetting(subscription);
      let diffMs = 0;
      let diffHours = 0;
      let daysDiff;
      if (subscription.useLunar) {
        const expiryDate = new Date(subscription.expiryDate);
        let lunar = lunarCalendar.solar2lunar(expiryDate.getFullYear(), expiryDate.getMonth() + 1, expiryDate.getDate());
        const solar = lunarBiz.lunar2solar(lunar);
        const lunarDate = new Date(solar.year, solar.month - 1, solar.day);
        const lunarMidnight = getTimezoneMidnightTimestamp(lunarDate, timezone);

        daysDiff = Math.round((lunarMidnight - currentMidnight) / MS_PER_DAY);

        diffMs = expiryDate.getTime() - currentTime.getTime();
        diffHours = diffMs / MS_PER_HOUR;

        if (daysDiff < 0 && subscription.periodValue && subscription.periodUnit && subscription.autoRenew !== false) {
          let nextLunar = lunar;
          do {
            nextLunar = lunarBiz.addLunarPeriod(nextLunar, subscription.periodValue, subscription.periodUnit);
            const solar = lunarBiz.lunar2solar(nextLunar);
            var newExpiryDate = new Date(solar.year, solar.month - 1, solar.day);
            const newLunarMidnight = getTimezoneMidnightTimestamp(newExpiryDate, timezone);
            daysDiff = Math.round((newLunarMidnight - currentMidnight) / MS_PER_DAY);
          } while (daysDiff < 0);

          diffMs = newExpiryDate.getTime() - currentTime.getTime();
          diffHours = diffMs / MS_PER_HOUR;

          const updatedSubscription = { ...subscription, expiryDate: newExpiryDate.toISOString() };
          updatedSubscriptions.push(updatedSubscription);
          hasUpdates = true;

          const shouldRemindAfterRenewal = shouldTriggerReminder(reminderSetting, daysDiff, diffHours);
          if (shouldRemindAfterRenewal) {
            expiringSubscriptions.push({
              ...updatedSubscription,
              daysRemaining: daysDiff,
              hoursRemaining: Math.round(diffHours),
            });
          }
          continue;
        }
      } else {
        const expiryDate = new Date(subscription.expiryDate);
        const expiryMidnight = getTimezoneMidnightTimestamp(expiryDate, timezone);

        daysDiff = Math.round((expiryMidnight - currentMidnight) / MS_PER_DAY);

        diffMs = expiryDate.getTime() - currentTime.getTime();
        diffHours = diffMs / MS_PER_HOUR;

        if (daysDiff < 0 && subscription.periodValue && subscription.periodUnit && subscription.autoRenew !== false) {
          const newExpiryDate = new Date(expiryDate);

          if (subscription.periodUnit === 'day') {
            newExpiryDate.setDate(expiryDate.getDate() + subscription.periodValue);
          } else if (subscription.periodUnit === 'month') {
            newExpiryDate.setMonth(expiryDate.getMonth() + subscription.periodValue);
          } else if (subscription.periodUnit === 'year') {
            newExpiryDate.setFullYear(expiryDate.getFullYear() + subscription.periodValue);
          }

          let newExpiryMidnight = getTimezoneMidnightTimestamp(newExpiryDate, timezone);
          while (newExpiryMidnight < currentMidnight) {
            if (subscription.periodUnit === 'day') {
              newExpiryDate.setDate(newExpiryDate.getDate() + subscription.periodValue);
            } else if (subscription.periodUnit === 'month') {
              newExpiryDate.setMonth(newExpiryDate.getMonth() + subscription.periodValue);
            } else if (subscription.periodUnit === 'year') {
              newExpiryDate.setFullYear(newExpiryDate.getFullYear() + subscription.periodValue);
            }
            newExpiryMidnight = getTimezoneMidnightTimestamp(newExpiryDate, timezone);
          }

          diffMs = newExpiryDate.getTime() - currentTime.getTime();
          diffHours = diffMs / MS_PER_HOUR;

          const updatedSubscription = { ...subscription, expiryDate: newExpiryDate.toISOString() };
          updatedSubscriptions.push(updatedSubscription);
          hasUpdates = true;

          const newDaysDiff = Math.round((newExpiryMidnight - currentMidnight) / MS_PER_DAY);
          const shouldRemindAfterRenewal = shouldTriggerReminder(reminderSetting, newDaysDiff, diffHours);
          if (shouldRemindAfterRenewal) {
            expiringSubscriptions.push({
              ...updatedSubscription,
              daysRemaining: newDaysDiff,
              hoursRemaining: Math.round(diffHours),
            });
          }
          continue;
        }
      }

      diffMs = new Date(subscription.expiryDate).getTime() - currentTime.getTime();
      diffHours = diffMs / MS_PER_HOUR;
      const shouldRemind = shouldTriggerReminder(reminderSetting, daysDiff, diffHours);

      if (daysDiff < 0 && subscription.autoRenew === false) {
        expiringSubscriptions.push({
          ...subscription,
          daysRemaining: daysDiff,
          hoursRemaining: Math.round(diffHours),
        });
      } else if (shouldRemind) {
        expiringSubscriptions.push({
          ...subscription,
          daysRemaining: daysDiff,
          hoursRemaining: Math.round(diffHours),
        });
      }
    }

    if (hasUpdates) {
      const mergedSubscriptions = subscriptions.map((sub) => {
        const updated = updatedSubscriptions.find((u) => u.id === sub.id);
        return updated || sub;
      });
      await env.SUB_TRACK_KV.put('subscriptions', JSON.stringify(mergedSubscriptions));
    }

    if (expiringSubscriptions.length > 0) {
      if (!shouldNotifyThisHour) {
        expiringSubscriptions.length = 0;
      } else {
        // 按到期时间排序
        expiringSubscriptions.sort((a, b) => a.daysRemaining - b.daysRemaining);

        // 使用优化的格式化函数
        const commonContent = formatNotificationContent(expiringSubscriptions, config);
        const metadataTags = extractTagsFromSubscriptions(expiringSubscriptions);

        const title = '订阅到期提醒';
        await sendNotificationToAllChannels(title, commonContent, config, '[定时任务]', {
          metadata: { tags: metadataTags },
        });
      }
    }
  } catch (error) {}
}

function getCookieValue(cookieString, key) {
  if (!cookieString) return null;

  const match = cookieString.match(new RegExp('(^| )' + key + '=([^;]+)'));
  return match ? match[2] : null;
}

async function handleRequest(request, env, ctx) {
  return new Response(loginPage, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

const CryptoJS = {
  HmacSHA256: function (message, key) {
    const keyData = new TextEncoder().encode(key);
    const messageData = new TextEncoder().encode(message);

    return Promise.resolve()
      .then(() => {
        return crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: { name: 'SHA-256' } }, false, ['sign']);
      })
      .then((cryptoKey) => {
        return crypto.subtle.sign('HMAC', cryptoKey, messageData);
      })
      .then((buffer) => {
        const hashArray = Array.from(new Uint8Array(buffer));
        return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
      });
  },
};

function getCurrentTime(config) {
  const timezone = config?.TIMEZONE || 'UTC';
  const currentTime = getCurrentTimeInTimezone(timezone);
  const formatter = new Intl.DateTimeFormat('zh-CN', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  return {
    date: currentTime,
    localString: formatter.format(currentTime),
    isoString: currentTime.toISOString(),
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 添加调试页面
    if (url.pathname === '/debug') {
      try {
        const config = await getConfig(env);
        const debugInfo = {
          timestamp: new Date().toISOString(), // 使用UTC时间戳
          pathname: url.pathname,
          kvBinding: !!env.SUB_TRACK_KV,
          configExists: !!config,
          adminUsername: config.ADMIN_USERNAME,
          hasJwtSecret: !!config.JWT_SECRET,
          jwtSecretLength: config.JWT_SECRET ? config.JWT_SECRET.length : 0,
        };

        return new Response(
          `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>调试信息</title>
  <style>${EMBEDDED_TAILWIND_CSS}</style>
</head>
<body class="min-h-screen bg-gray-100 p-6 font-sans text-gray-800 antialiased">
  <div class="mx-auto max-w-2xl">
    <h1 class="mb-6 text-xl font-semibold text-gray-900">调试信息</h1>
    <div class="mb-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <h3 class="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">基本信息</h3>
      <p class="text-sm text-gray-700"><span class="text-gray-500">时间:</span> ${debugInfo.timestamp}</p>
      <p class="mt-2 text-sm text-gray-700"><span class="text-gray-500">路径:</span> ${debugInfo.pathname}</p>
      <p class="mt-2 text-sm ${debugInfo.kvBinding ? 'text-emerald-600' : 'text-red-600'}">KV绑定: ${debugInfo.kvBinding ? '✓' : '✗'}</p>
    </div>

    <div class="mb-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <h3 class="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">配置信息</h3>
      <p class="text-sm ${debugInfo.configExists ? 'text-emerald-600' : 'text-red-600'}">配置存在: ${debugInfo.configExists ? '✓' : '✗'}</p>
      <p class="mt-2 text-sm text-gray-700"><span class="text-gray-500">管理员用户名:</span> ${debugInfo.adminUsername ?? ''}</p>
      <p class="mt-2 text-sm ${debugInfo.hasJwtSecret ? 'text-emerald-600' : 'text-red-600'}">JWT密钥: ${debugInfo.hasJwtSecret ? '✓' : '✗'} (长度: ${debugInfo.jwtSecretLength})</p>
    </div>

    <div class="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <h3 class="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">解决方案</h3>
      <ol class="list-decimal space-y-2 pl-5 text-sm text-gray-700">
        <li>确保 KV 命名空间已正确绑定为 SUB_TRACK_KV</li>
        <li>尝试访问 <a href="/" class="text-indigo-600 hover:text-indigo-800">/</a> 进行登录</li>
        <li>如果仍有问题，请检查 Cloudflare Workers 日志</li>
      </ol>
    </div>
  </div>
</body>
</html>`,
          {
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          },
        );
      } catch (error) {
        return new Response(`调试页面错误: ${error.message}`, {
          status: 500,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }
    }

    if (url.pathname.startsWith('/api')) {
      return api.handleRequest(request, env, ctx);
    } else if (url.pathname.startsWith('/admin')) {
      return admin.handleRequest(request, env, ctx);
    } else {
      return handleRequest(request, env, ctx);
    }
  },

  async scheduled(event, env, ctx) {
    const config = await getConfig(env);
    const timezone = config?.TIMEZONE || 'UTC';
    const currentTime = getCurrentTimeInTimezone(timezone);
    await checkExpiringSubscriptions(env);
  },
};
