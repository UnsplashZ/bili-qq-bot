const { escapeHtml, formatNumber } = require('../core/formatters');
const ICONS = require('./icons');

/**
 * 渲染番剧内容
 * @param {Object} data - 番剧数据
 * @returns {String} HTML 字符串
 */
function renderBangumiContent(data) {
    const info = data.data;
    const releaseDate = info.publish?.release_date_show || '未知';
    const isFinish = info.publish?.is_finish === 1;
    const seasonType = info.season_type;
    const typeDesc = info.type_desc || '';
    const stylesArr = info.styles || [];
    const isMovieOrDoc = (seasonType === 2 || seasonType === 3)
        || stylesArr.includes('电影') || stylesArr.includes('纪录片')
        || /电影|纪录/.test(typeDesc);

    let statusText = '';
    const styles = info.styles || [];
    const areas = info.areas || [];
    const areaStr = areas.length > 0 ? areas.map(a => a.name).join('/') : '';
    const stylesStr = styles.length > 0 ? styles.join('/') : '';
    const metaSuffix = `${areaStr}${stylesStr ? (areaStr ? ' ' + stylesStr : stylesStr) : ''}`.trim();

    if (isFinish) {
        const epDesc = (info.new_ep?.desc || '').replace(/,\s*/g, ' ');
        statusText = isMovieOrDoc
            ? `${releaseDate}开播`
            : `${releaseDate}开播 ${epDesc}`;
    } else {
        const pubTime = info.publish?.pub_time || '';
        let updateSchedule = '';
        if (pubTime) {
            const dateStr = pubTime.replace(' ', 'T');
            const date = new Date(dateStr);
            if (!isNaN(date.getTime())) {
                const days = ['日', '一', '二', '三', '四', '五', '六'];
                const weekday = days[date.getDay()];
                const time = pubTime.split(' ')[1].substring(0, 5);
                updateSchedule = `每周${weekday} ${time}更新`;
            }
        }
        let epUpdateText = '';
        if (!isMovieOrDoc) {
            const epTitle = info.new_ep?.title || info.new_ep?.index_show || '';
            if (epTitle) {
                const epNumber = parseInt(epTitle, 10);
                if (!isNaN(epNumber)) {
                    epUpdateText = `更新至第${epNumber}集`;
                }
            }
        }
        statusText = isMovieOrDoc
            ? `${releaseDate}开播`
            : `${releaseDate}开播 连载中${epUpdateText ? ' ' + epUpdateText : ''}${updateSchedule ? ' ' + updateSchedule : ''}`;
    }

    return `
        <div class="cover-container">
            <img class="cover bangumi" src="${info.cover}" />
        </div>
        <div class="content">
            <div class="title">${escapeHtml(info.title)}</div>
            <div class="status-line">
                <span class="status-prefix">${statusText}</span>
                ${metaSuffix ? `<span class="status-meta">${metaSuffix}</span>` : ''}
            </div>
            <div class="stats">
                <span class="stat-item">${ICONS.view} ${formatNumber(info.stat?.views)}</span>
                <span class="stat-item">${ICONS.heart} ${formatNumber(info.stat?.follow)}</span>
                <span class="stat-item">${ICONS.comment} ${formatNumber(info.stat?.danmakus)}</span>
                <span class="stat-item">${ICONS.star} ${info.rating?.score || 'N/A'}分</span>
            </div>
            <div class="text-content">${escapeHtml(info.desc || '')}</div>
        </div>
    `;
}

module.exports = { renderBangumiContent };
