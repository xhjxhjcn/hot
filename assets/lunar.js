/* 轻量农历（2024-2040）：基于预生成的月首表，不依赖第三方库 */
(function () {
    var START = window.__LUNAR_START__ || 2024;
    var DATA = window.__LUNAR_DATA__ || [];
    var BASE = Date.UTC(START, 0, 1);
    var GAN = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
    var ZHI = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
    var SX = ['鼠', '牛', '虎', '兔', '龙', '蛇', '马', '羊', '猴', '鸡', '狗', '猪'];
    var MON_CN = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊'];
    var DAY_CN = ['初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
        '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
        '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十'];

    function ganZhi(year) {
        var i = ((year - 4) % 60 + 60) % 60;
        return GAN[i % 10] + ZHI[i % 12];
    }
    function shengXiao(year) {
        return SX[((year - 4) % 12 + 12) % 12];
    }

    function info(date) {
        if (!DATA.length) return null;
        var abs = Math.floor((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - BASE) / 86400000);
        var lo = 0, hi = DATA.length - 1, idx = -1;
        while (lo <= hi) {
            var mid = (lo + hi) >> 1;
            if (DATA[mid][0] <= abs) { idx = mid; lo = mid + 1; } else hi = mid - 1;
        }
        if (idx < 0) return null;
        var v = DATA[idx];
        var day = abs - v[0] + 1;
        var leap = v[2] % 2;
        var month = (v[2] - leap) / 2;
        var year = v[1];
        return {
            year: year, month: month, day: day, leap: !!leap,
            monthCn: (leap ? '闰' : '') + (MON_CN[month - 1] || month),
            dayCn: DAY_CN[day - 1] || String(day),
            ganZhi: ganZhi(year) + '年', shengXiao: shengXiao(year)
        };
    }

    window.LunarInfo = { info: info, ganZhi: ganZhi, shengXiao: shengXiao };
})();
